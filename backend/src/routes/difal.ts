/**
 * Monitor de DIFAL: lista as notas com o imposto calculado, confronta com o que
 * o Mercado Livre cobrou e mostra o que falta recolher.
 *
 * Todas as rotas são de leitura, menos a importação, que só busca do Bling e
 * grava na nossa tabela — nada é enviado para fora.
 */
import { Router, Request, Response } from 'express'
import { query, body, validationResult } from 'express-validator'
import { prisma } from '../lib/prisma'
import { DifalResponsavel, DifalSituacao, Prisma } from '@prisma/client'
import { importarNotas, type ResultadoImportacao } from '../services/difal/importar'
import { semearAliquotas } from '../services/difal/aliquotas'
import { listarGuiasPendentes, gerarLoteDasNotas, classificarCamposExtras, listarVendasMlBarreira, marcarComprovanteMlEnviado, UFS_BARREIRA_ML } from '../services/difal/guias'
import { ErroMontagemGnre } from '../services/difal/gnre'
import { sincronizarCobrancasMl, fechamentoMensal } from '../services/difal/cobrancasMl'
import {
  statusPortal, portalConfigurado, consultarConfigUf, enviarLote, consultarResultadoLote,
  lerResultadoLote, ErroPortalGnre, ambienteGnre, type EmpresaGnre,
} from '../services/difal/portalGnre'
// A apuração das guias já pagas é dado fixo, vindo da auditoria dos comprovantes
// do Mercado Livre. Importado como módulo para entrar no build.
import historicoGuias from '../services/difal/dados/historico-guias.json'

const router = Router()

// Notas que interessam no painel: DIFAL maior que zero. As de DIFAL zero (ex.: NCM 8436 em UF de 12%,
// venda dentro do RS) somem — menos as divergentes e as que o ML cobrou, que são justamente problema.
const COM_DIFAL: Prisma.DifalNotaWhereInput = {
  OR: [{ difalCalculado: { gt: 0 } }, { situacao: 'DIVERGENTE' }, { difalCobradoMl: { gt: 0 } }],
}

// GET /difal — lista as notas do monitor
router.get(
  '/',
  [
    query('responsavel').optional().isIn(Object.values(DifalResponsavel)),
    query('situacao').optional().isIn(Object.values(DifalSituacao)),
    query('empresa').optional().trim(),
    query('uf').optional().trim().isLength({ min: 2, max: 2 }),
    query('desde').optional().isISO8601(),
    query('ate').optional().isISO8601(),
    query('busca').optional().trim(),
    query('pagina').optional().isInt({ min: 1 }),
  ],
  async (req: Request, res: Response) => {
    const erros = validationResult(req)
    if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })

    const { responsavel, situacao, empresa, uf, desde, ate, busca } = req.query
    const pagina = Number(req.query.pagina ?? 1)
    const porPagina = 100

    const where: Prisma.DifalNotaWhereInput = { AND: [COM_DIFAL] }
    if (responsavel) where.responsavel = responsavel as DifalResponsavel
    if (situacao) where.situacao = situacao as DifalSituacao
    if (empresa) where.empresa = String(empresa).toUpperCase()
    if (uf) where.clienteUf = String(uf).toUpperCase()
    if (desde || ate) {
      where.emitidaEm = {}
      if (desde) where.emitidaEm.gte = new Date(String(desde))
      if (ate) where.emitidaEm.lte = new Date(String(ate))
    }
    if (busca) {
      const t = String(busca)
      where.OR = [
        { nfNumero: { contains: t } },
        { clienteNome: { contains: t, mode: 'insensitive' } },
      ]
    }

    try {
    const [notas, total] = await Promise.all([
      prisma.difalNota.findMany({
        where,
        orderBy: { emitidaEm: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
      prisma.difalNota.count({ where }),
    ])

    // LGPD: o documento do destinatário existe só para montar a guia; não vai para a tela
    const semDocumento = notas.map(({ documentoDestinatario: _doc, clienteIe: _ie, ...resto }) => resto)
    res.json({ notas: semDocumento, total, pagina, porPagina })
    } catch (e) {
      res.status(500).json({ erro: (e as Error).message })
    }
  }
)

// GET /difal/resumo — os números do topo da tela
router.get('/resumo', [query('desde').optional().isISO8601()], async (req: Request, res: Response) => {
  const erros = validationResult(req)
  if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })
  try {
  const where: Prisma.DifalNotaWhereInput = { AND: [COM_DIFAL] }
  if (req.query.desde) where.emitidaEm = { gte: new Date(String(req.query.desde)) }

  const porResponsavel = await prisma.difalNota.groupBy({
    by: ['responsavel'],
    where,
    _count: { _all: true },
    _sum: { difalCalculado: true, difalCobradoMl: true, difalPagoGuia: true },
  })

  const aPagar = await prisma.difalNota.aggregate({
    where: { ...where, responsavel: 'NOSSO', situacao: { in: ['PENDENTE', 'ATRASADO'] } },
    _count: { _all: true },
    _sum: { difalCalculado: true },
  })

  const divergentes = await prisma.difalNota.aggregate({
    where: { ...where, situacao: 'DIVERGENTE' },
    _count: { _all: true },
    _sum: { divergencia: true },
  })

  res.json({
    porResponsavel: porResponsavel.map((r) => ({
      responsavel: r.responsavel,
      notas: r._count._all,
      calculado: r._sum.difalCalculado ?? 0,
      cobradoMl: r._sum.difalCobradoMl ?? 0,
      pagoGuia: r._sum.difalPagoGuia ?? 0,
    })),
    aPagar: { notas: aPagar._count._all, valor: aPagar._sum.difalCalculado ?? 0 },
    divergentes: { notas: divergentes._count._all, valor: divergentes._sum.divergencia ?? 0 },
  })
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// GET /difal/aliquotas — a tabela que a contabilidade pode ajustar
router.get('/aliquotas', async (_req: Request, res: Response) => {
  try {
    const lista = await prisma.difalAliquota.findMany({ orderBy: { uf: 'asc' } })
    res.json(lista)
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// PUT /difal/aliquotas/:uf — corrigir a alíquota de um estado
router.put(
  '/aliquotas/:uf',
  [
    body('aliquotaInterna').optional().isFloat({ min: 0, max: 40 }),
    body('fcp').optional().isFloat({ min: 0, max: 10 }),
    body('interestadual').optional().isIn([7, 12, '7', '12']).withMessage('alíquota interestadual é 7 ou 12 (Convênio 52/91)'),
    body('metodo').optional().isIn(['carga', 'prop']),
    body('nota').optional().trim(),
    body('codigoReceitaGnre').optional().trim().matches(/^\d{6}$/).withMessage('código de receita tem 6 dígitos'),
    body('vencimentoRegra').optional().isIn(['saida', 'dia15']),
    body('tipoDocOrigemGnre').optional().trim().matches(/^(\d{2})?$/).withMessage('tipo de documento de origem tem 2 dígitos (ou vazio, se a UF não exige)'),
    body('camposAdicionais').optional().isArray({ max: 20 }),
    body('camposAdicionais.*.codigo').isString().trim().isLength({ min: 1, max: 10 }),
    body('camposAdicionais.*.titulo').isString().isLength({ max: 120 }),
    body('camposAdicionais.*.tipo').optional().isString().isLength({ max: 2 }),
    body('camposAdicionais.*.obrigatorio').isBoolean(),
    body('exigeProduto').optional().isBoolean(),
  ],
  async (req: Request, res: Response) => {
    const erros = validationResult(req)
    if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })

    const uf = String(req.params.uf).toUpperCase()
    const { aliquotaInterna, fcp, interestadual, metodo, nota, codigoReceitaGnre, vencimentoRegra, tipoDocOrigemGnre, camposAdicionais, exigeProduto } = req.body
    try {
    const atualizada = await prisma.difalAliquota.update({
      where: { uf },
      data: {
        ...(aliquotaInterna !== undefined && { aliquotaInterna: Number(aliquotaInterna) }),
        ...(fcp !== undefined && { fcp: Number(fcp) }),
        ...(interestadual !== undefined && { interestadual: Number(interestadual) }),
        ...(metodo !== undefined && { metodo: String(metodo) }),
        ...(nota !== undefined && { nota: String(nota) }),
        ...(codigoReceitaGnre !== undefined && { codigoReceitaGnre: String(codigoReceitaGnre) }),
        ...(vencimentoRegra !== undefined && { vencimentoRegra: String(vencimentoRegra) }),
        ...(tipoDocOrigemGnre !== undefined && { tipoDocOrigemGnre: String(tipoDocOrigemGnre) }),
        ...(camposAdicionais !== undefined && {
          camposExtrasGnre: classificarCamposExtras(
            (camposAdicionais as Record<string, unknown>[]).map((c) => ({
              codigo: String(c.codigo ?? ''), titulo: String(c.titulo ?? ''), tipo: String(c.tipo ?? ''), obrigatorio: c.obrigatorio === true,
            })),
            exigeProduto === true
          ) as unknown as Prisma.InputJsonValue,
        }),
      },
    })
    res.json(atualizada)
    } catch (e) {
      // P2025 = estado não cadastrado
      const codigo = (e as { code?: string }).code
      if (codigo === 'P2025') return res.status(404).json({ erro: `estado ${uf} não cadastrado` })
      res.status(500).json({ erro: (e as Error).message })
    }
  }
)

// A importação roda em segundo plano: 90 dias de notas são minutos de chamadas ao Bling
// (detalhe + XML por nota) e o proxy do Railway devolve 502 quando a requisição passa do
// limite dele. O botão dispara e a tela consulta o andamento em /importar/status.
interface EstadoImportacao {
  emAndamento: boolean
  iniciadaEm: Date | null
  terminadaEm: Date | null
  resultado: ResultadoImportacao[] | null
  erro: string | null
}
let importacao: EstadoImportacao = { emAndamento: false, iniciadaEm: null, terminadaEm: null, resultado: null, erro: null }

// POST /difal/importar — dispara a busca das notas do Bling (só leitura no Bling) e responde na hora
router.post(
  '/importar',
  [body('dias').optional().isInt({ min: 1, max: 365 }), body('empresa').optional().trim(), body('forcar').optional().isBoolean()],
  (req: Request, res: Response) => {
    const erros = validationResult(req)
    if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })
    if (importacao.emAndamento) return res.status(409).json({ ok: false, erro: 'já existe uma importação em andamento' })
    const dias = Number(req.body?.dias ?? 90)
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
    const opcoes = {
      desde,
      empresa: req.body?.empresa ? String(req.body.empresa) : undefined,
      // forcar=true recalcula tudo (ex.: depois de mudar uma alíquota)
      forcar: req.body?.forcar === true || req.body?.forcar === 'true',
    }
    importacao = { emAndamento: true, iniciadaEm: new Date(), terminadaEm: null, resultado: null, erro: null }
    void (async () => {
      try {
        await semearAliquotas(prisma)
        importacao.resultado = await importarNotas(prisma, opcoes)
      } catch (e) {
        importacao.erro = (e as Error).message
        console.error('[DIFAL] importação falhou:', importacao.erro)
      } finally {
        importacao.emAndamento = false
        importacao.terminadaEm = new Date()
      }
    })()
    res.status(202).json({ ok: true, desde, iniciada: true })
  }
)

// GET /difal/importar/status — andamento e resultado da última importação
router.get('/importar/status', (_req: Request, res: Response) => {
  res.json(importacao)
})

// GET /difal/ml-barreira — vendas do ML nos estados que cobram na barreira: pagar nós e anexar o comprovante no ML
router.get('/ml-barreira', async (_req: Request, res: Response) => {
  try {
    res.json({ ufs: UFS_BARREIRA_ML, vendas: await listarVendasMlBarreira(prisma) })
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// POST /difal/notas/:id/comprovante-ml — José anexou o comprovante na venda do ML
router.post('/notas/:id/comprovante-ml', async (req: Request, res: Response) => {
  try {
    await marcarComprovanteMlEnviado(prisma, String(req.params.id))
    res.json({ ok: true })
  } catch (e) {
    if (e instanceof ErroMontagemGnre) return res.status(422).json({ erro: e.message })
    res.status(500).json({ erro: (e as Error).message })
  }
})

// GET /difal/guias-pendentes — notas que precisam de guia nossa e o que falta em cada uma
router.get('/guias-pendentes', [query('empresa').optional().trim()], async (req: Request, res: Response) => {
  const erros = validationResult(req)
  if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })
  try {
    const guias = await listarGuiasPendentes(
      prisma,
      req.query.empresa ? String(req.query.empresa).toUpperCase() : undefined
    )
    res.json(guias)
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// POST /difal/guias/lote — monta o XML do lote GNRE com as notas escolhidas e devolve para download.
// Não envia nada ao portal; marca as notas como "guia gerada".
router.post(
  '/guias/lote',
  [body('ids').isArray({ min: 1, max: 50 }), body('ids.*').isString().notEmpty()],
  async (req: Request, res: Response) => {
    const erros = validationResult(req)
    if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })
    try {
      const lote = await gerarLoteDasNotas(prisma, req.body.ids as string[])
      res.setHeader('Content-Type', 'application/xml; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="gnre-lote-${lote.loteId}.xml"`)
      res.setHeader('X-Lote-Id', lote.loteId)
      res.setHeader('X-Lote-Guias', String(lote.guias))
      res.setHeader('X-Lote-Total', lote.total.toFixed(2))
      res.setHeader('Access-Control-Expose-Headers', 'X-Lote-Id, X-Lote-Guias, X-Lote-Total')
      res.send(lote.xml)
    } catch (e) {
      if (e instanceof ErroMontagemGnre) return res.status(422).json({ erro: e.message })
      res.status(500).json({ erro: (e as Error).message })
    }
  }
)

// GET /difal/fechamento-mensal — o que o ML cobrou (CDIFAL) x o que calculamos, por mês e empresa
router.get('/fechamento-mensal', [query('meses').optional().isInt({ min: 1, max: 12 })], async (req: Request, res: Response) => {
  const erros = validationResult(req)
  if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })
  try {
    res.json(await fechamentoMensal(prisma, Number(req.query.meses ?? 6)))
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// POST /difal/cobrancas-ml/sincronizar — busca os lançamentos CDIFAL na fatura do ML (só leitura)
router.post('/cobrancas-ml/sincronizar', [body('meses').optional().isInt({ min: 1, max: 12 })], async (req: Request, res: Response) => {
  const erros = validationResult(req)
  if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })
  try {
    res.json(await sincronizarCobrancasMl(prisma, Number(req.body?.meses ?? 2)))
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// ------------------------------------------------------------ Portal GNRE
const EMPRESAS_GNRE: EmpresaGnre[] = ['AVIC', 'AGRO']
const empresaGnre = (v: unknown): EmpresaGnre | null =>
  EMPRESAS_GNRE.includes(String(v).toUpperCase() as EmpresaGnre) ? (String(v).toUpperCase() as EmpresaGnre) : null

function responderErroPortal(res: Response, e: unknown) {
  if (e instanceof ErroPortalGnre) return res.status(502).json({ erro: e.message })
  res.status(500).json({ erro: (e as Error).message })
}

// GET /difal/portal/status — ambiente e se o certificado de cada empresa está configurado
router.get('/portal/status', (_req: Request, res: Response) => res.json(statusPortal()))

// GET /difal/portal/config/:uf?empresa= — receitas e exigências da UF (GnreConfigUF)
router.get(
  '/portal/config/:uf',
  [query('empresa').isIn(EMPRESAS_GNRE)],
  async (req: Request, res: Response) => {
    const erros = validationResult(req)
    if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })
    const empresa = empresaGnre(req.query.empresa)!
    const uf = String(req.params.uf).toUpperCase()
    if (!/^[A-Z]{2}$/.test(uf)) return res.status(400).json({ erro: 'UF inválida' })
    try {
      const cfg = await consultarConfigUf(empresa, uf)
      // o XML bruto fica fora da resposta (grande); só o que a tela usa
      const { bruto: _bruto, ...resto } = cfg
      res.json(resto)
    } catch (e) {
      responderErroPortal(res, e)
    }
  }
)

// GET /difal/lotes — lotes gerados, do mais novo para o mais velho (sem XML nem PDF)
router.get('/lotes', async (_req: Request, res: Response) => {
  try {
    const lotes = await prisma.difalLoteGnre.findMany({
      orderBy: { criadoEm: 'desc' },
      take: 100,
      select: {
        id: true, empresa: true, ambiente: true, guias: true, total: true, criadoEm: true,
        enviadoEm: true, numeroRecibo: true, situacaoCodigo: true, situacaoDescricao: true,
        consultadoEm: true, resultadoXml: true, pdfGuias: false, xml: false,
      },
    })
    // quais já têm PDF, sem carregar o base64 na listagem
    const comPdf = new Set(
      (await prisma.difalLoteGnre.findMany({ where: { pdfGuias: { not: null } }, select: { id: true } })).map((x) => x.id)
    )
    res.json(lotes.map((l) => ({
      ...l,
      resultadoXml: undefined,
      temPdf: comPdf.has(l.id),
      guiasResultado: l.resultadoXml ? lerResultadoLote(l.resultadoXml).guias : [],
    })))
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// GET /difal/lotes/:id/xml — baixar de novo o XML do lote
router.get('/lotes/:id/xml', async (req: Request, res: Response) => {
  try {
    const lote = await prisma.difalLoteGnre.findUnique({ where: { id: String(req.params.id) } })
    if (!lote) return res.status(404).json({ erro: 'lote não encontrado' })
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="gnre-lote-${lote.id}.xml"`)
    res.send(lote.xml)
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// GET /difal/lotes/:id/pdf — PDF das guias que o portal devolveu
router.get('/lotes/:id/pdf', async (req: Request, res: Response) => {
  try {
    const lote = await prisma.difalLoteGnre.findUnique({ where: { id: String(req.params.id) }, select: { id: true, pdfGuias: true } })
    if (!lote) return res.status(404).json({ erro: 'lote não encontrado' })
    if (!lote.pdfGuias) return res.status(404).json({ erro: 'o portal ainda não devolveu o PDF deste lote' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="gnre-guias-${lote.id}.pdf"`)
    res.send(Buffer.from(lote.pdfGuias, 'base64'))
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// POST /difal/lotes/:id/enviar — transmite o lote ao portal (GnreLoteRecepcao). Não paga nada.
router.post('/lotes/:id/enviar', async (req: Request, res: Response) => {
  try {
    const lote = await prisma.difalLoteGnre.findUnique({ where: { id: String(req.params.id) } })
    if (!lote) return res.status(404).json({ erro: 'lote não encontrado' })
    if (lote.numeroRecibo) return res.status(409).json({ erro: `lote já enviado (recibo ${lote.numeroRecibo})` })
    if (lote.ambiente !== ambienteGnre()) {
      return res.status(409).json({
        erro: `este lote foi gerado para ${lote.ambiente} e o portal está em ${ambienteGnre()}: desfaça o lote e gere de novo`,
      })
    }
    const empresa = empresaGnre(lote.empresa)
    if (!empresa || !portalConfigurado(empresa)) return res.status(409).json({ erro: `certificado da ${lote.empresa} não configurado` })

    const recibo = await enviarLote(empresa, lote.xml)
    const atualizado = await prisma.difalLoteGnre.update({
      where: { id: lote.id },
      data: {
        enviadoEm: new Date(),
        numeroRecibo: recibo.recibo?.numero ?? null,
        situacaoCodigo: recibo.situacao.codigo,
        situacaoDescricao: recibo.situacao.descricao,
      },
      select: { id: true, numeroRecibo: true, situacaoCodigo: true, situacaoDescricao: true, enviadoEm: true },
    })
    res.json({ ...atualizado, tempoEstimadoMs: recibo.recibo?.tempoEstimadoMs ?? null })
  } catch (e) {
    responderErroPortal(res, e)
  }
})

// Situações da guia que garantem que ela NÃO vale para pagamento (manual GNRE): 1 = invalidada pelo
// Portal, 2 = invalidada pela UF. Erro de comunicação (3) e pendência (4) ficam de fora: a guia ainda pode valer.
const GUIA_INVALIDADA = new Set(['1', '2'])

// POST /difal/lotes/:id/desfazer — apaga o lote e devolve as notas à fila. Vale para lote que ainda não foi ao
// portal, ou que foi e teve TODAS as guias invalidadas (senão a nota ficaria presa num lote recusado).
router.post('/lotes/:id/desfazer', async (req: Request, res: Response) => {
  try {
    const lote = await prisma.difalLoteGnre.findUnique({ where: { id: String(req.params.id) }, select: { id: true, numeroRecibo: true, resultadoXml: true } })
    if (!lote) return res.status(404).json({ erro: 'lote não encontrado' })
    if (lote.numeroRecibo) {
      const guias = lote.resultadoXml ? lerResultadoLote(lote.resultadoXml).guias : []
      const todasInvalidadas = guias.length > 0 && guias.every((g) => GUIA_INVALIDADA.has(g.situacaoGuia))
      if (!todasInvalidadas) {
        return res.status(409).json({ erro: `lote já enviado ao portal (recibo ${lote.numeroRecibo}) e nem todas as guias foram invalidadas; não dá para desfazer` })
      }
    }
    const [notas] = await prisma.$transaction([
      prisma.difalNota.updateMany({ where: { guiaLoteId: lote.id }, data: { guiaGeradaEm: null, guiaLoteId: null } }),
      prisma.difalLoteGnre.delete({ where: { id: lote.id } }),
    ])
    res.json({ ok: true, notasDevolvidas: notas.count })
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message })
  }
})

// POST /difal/lotes/:id/consultar — busca o resultado do recibo (GnreResultadoLote), com PDF
router.post('/lotes/:id/consultar', async (req: Request, res: Response) => {
  try {
    const lote = await prisma.difalLoteGnre.findUnique({ where: { id: String(req.params.id) } })
    if (!lote) return res.status(404).json({ erro: 'lote não encontrado' })
    if (!lote.numeroRecibo) return res.status(409).json({ erro: 'lote ainda não foi enviado ao portal' })
    const empresa = empresaGnre(lote.empresa)
    if (!empresa || !portalConfigurado(empresa)) return res.status(409).json({ erro: `certificado da ${lote.empresa} não configurado` })

    const resultado = await consultarResultadoLote(empresa, lote.numeroRecibo, true)
    await prisma.difalLoteGnre.update({
      where: { id: lote.id },
      data: {
        consultadoEm: new Date(),
        situacaoCodigo: resultado.situacao.codigo,
        situacaoDescricao: resultado.situacao.descricao,
        resultadoXml: resultado.bruto,
        ...(resultado.pdfGuias && { pdfGuias: resultado.pdfGuias }),
      },
    })
    res.json({ situacao: resultado.situacao, guias: resultado.guias, temPdf: !!resultado.pdfGuias })
  } catch (e) {
    responderErroPortal(res, e)
  }
})

// GET /difal/historico — a apuração das guias já pagas (dez/2025 a out/2026)
// Dado fixo: veio da auditoria dos ZIPs de comprovantes do Mercado Livre.
router.get('/historico', (_req: Request, res: Response) => {
  res.json(historicoGuias)
})

export default router
