/**
 * Enviar e consultar um lote GNRE no portal, gravando o resultado. Usado pela tela (rotas) e pela rotina diária,
 * para a regra ficar num lugar só.
 */
import type { PrismaClient } from '@prisma/client'
import { ambienteGnre, consultarResultadoLote, enviarLote, portalConfigurado, type EmpresaGnre } from './portalGnre'

/** erro de regra do lote (a rota responde 404/409 com a mensagem) */
export class ErroLote extends Error {
  constructor(public status: 404 | 409, mensagem: string) {
    super(mensagem)
  }
}

const EMPRESAS_GNRE: EmpresaGnre[] = ['AVIC', 'AGRO']

export function empresaGnre(v: unknown): EmpresaGnre | null {
  const e = String(v).toUpperCase() as EmpresaGnre
  return EMPRESAS_GNRE.includes(e) ? e : null
}

export async function enviarLoteGnre(prisma: PrismaClient, loteId: string) {
  const lote = await prisma.difalLoteGnre.findUnique({ where: { id: loteId } })
  if (!lote) throw new ErroLote(404, 'lote não encontrado')
  if (lote.numeroRecibo) throw new ErroLote(409, `lote já enviado (recibo ${lote.numeroRecibo})`)
  if (lote.ambiente !== ambienteGnre()) {
    throw new ErroLote(409, `este lote foi gerado para ${lote.ambiente} e o portal está em ${ambienteGnre()}: desfaça o lote e gere de novo`)
  }
  const empresa = empresaGnre(lote.empresa)
  if (!empresa || !portalConfigurado(empresa)) throw new ErroLote(409, `certificado da ${lote.empresa} não configurado`)

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
  return { ...atualizado, tempoEstimadoMs: recibo.recibo?.tempoEstimadoMs ?? null }
}

export async function consultarLoteGnre(prisma: PrismaClient, loteId: string) {
  const lote = await prisma.difalLoteGnre.findUnique({ where: { id: loteId } })
  if (!lote) throw new ErroLote(404, 'lote não encontrado')
  if (!lote.numeroRecibo) throw new ErroLote(409, 'lote ainda não foi enviado ao portal')
  const empresa = empresaGnre(lote.empresa)
  if (!empresa || !portalConfigurado(empresa)) throw new ErroLote(409, `certificado da ${lote.empresa} não configurado`)

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
  return { situacao: resultado.situacao, guias: resultado.guias, temPdf: !!resultado.pdfGuias }
}
