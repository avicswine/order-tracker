/**
 * Rotina diária do DIFAL (aprovada pelo José em 20/11/2026): todo dia útil às 17h (Brasília) atualiza as notas,
 * monta a lista do dia (no prazo, estados com cobrança) e manda um resumo por WhatsApp.
 *   DIFAL_ROTINA=1          liga o agendamento (sem ela, só roda pelo botão de simulação)
 *   DIFAL_ROTINA_ENVIAR=1   modo completo: também gera os lotes, envia ao portal e consulta o resultado
 *   DIFAL_WHATSAPP_NUMERO   número que recebe o aviso (vazio: só registra no log)
 * O pagamento continua com o José. Atrasadas ficam de fora (decisão dele). Mensagem sem nome nem CPF de cliente.
 */
import type { PrismaClient } from '@prisma/client'
import { importarNotas } from './importar'
import { preencherLogisticaMl } from './logisticaMl'
import { gerarLoteDasNotas, listarGuiasPendentes, proximoDiaUtil } from './guias'
import { consultarLoteGnre, enviarLoteGnre } from './lotesGnre'
import { ambienteGnre, SITUACAO_GUIA } from './portalGnre'
import { sendMessage } from '../whatsapp'
import { dataBR, somarDias } from '../separacao/datas'

const DIAS_IMPORTACAO = 3
/** tempo para o portal processar o lote antes da consulta */
const ESPERA_RESULTADO_MS = 30_000
const LIMITE_GUIAS_LOTE = 50
const PAINEL_DIFAL = 'https://order-tracker-production-4189.up.railway.app/difal'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface ResultadoRotina {
  mensagem: string
  enviadaWhatsapp: boolean
  /** a rotina não rodou (fim de semana, feriado ou já em andamento) */
  pulou?: string
}

let rodando = false

/** importa as notas dos últimos dias e o tipo de envio do ML; o que falhar entra no aviso */
async function atualizarDados(prisma: PrismaClient, hoje: string, falhas: string[]) {
  try {
    const imp = await importarNotas(prisma, { desde: new Date(`${somarDias(hoje, -DIAS_IMPORTACAO)}T00:00:00-03:00`) })
    const erros = imp.flatMap((r) => r.erros)
    if (erros.length) falhas.push(`Bling: ${erros.length} nota(s) com erro (ex.: ${erros[0]})`)
  } catch (e) {
    falhas.push(`Bling: ${(e as Error).message}`)
  }
  try {
    const log = await preencherLogisticaMl(prisma)
    if (log.erros.length) falhas.push(`ML: ${log.erros[0]}`)
  } catch (e) {
    falhas.push(`ML: ${(e as Error).message}`)
  }
}

/**
 * @param simulacao  true = não gera lote, não envia ao portal nem WhatsApp: só devolve o texto (botão do painel)
 * @param agendada   true = chamada pelo agendador (respeita dia útil e as variáveis do Railway)
 */
export async function rodarRotinaDifal(prisma: PrismaClient, { simulacao, agendada }: { simulacao: boolean; agendada: boolean }): Promise<ResultadoRotina> {
  const hoje = dataBR()
  if (agendada && proximoDiaUtil(hoje) !== hoje) return { mensagem: '', enviadaWhatsapp: false, pulou: `${hoje} não é dia útil bancário` }
  if (rodando) return { mensagem: '', enviadaWhatsapp: false, pulou: 'rotina já em andamento' }
  rodando = true
  try {
    const falhas: string[] = []
    const completo = !simulacao && process.env.DIFAL_ROTINA_ENVIAR === '1'

    // 1. notas dos últimos dias (só leitura no Bling) e tipo de envio do ML (só leitura no ML).
    // Na simulação (botão) usa os dados já importados: importar leva minutos e a tela não pode esperar.
    if (!simulacao) await atualizarDados(prisma, hoje, falhas)

    // 2. lista do dia: igual ao painel (no prazo, estados com cobrança), só o que está pronto e sem guia
    const pendentes = await listarGuiasPendentes(prisma)
    const doDia = pendentes.filter((g) => !g.atrasada && g.estadoComCobranca && g.pronta && !g.guiaGeradaEm)
    const atrasadas = pendentes.filter((g) => g.atrasada && g.estadoComCobranca).length
    const total = doDia.reduce((s, g) => s + g.difalCalculado, 0)
    const porEmpresa = (emp: string) => doDia.filter((g) => g.empresa === emp)

    // 3. modo completo: gera, envia e consulta um lote por empresa (uma vez por dia)
    const linhasPortal: string[] = []
    if (completo) {
      const inicioDia = new Date(`${hoje}T00:00:00-03:00`)
      for (const emp of ['AVIC', 'AGRO']) {
        const notas = porEmpresa(emp)
        if (!notas.length) continue
        const jaTem = await prisma.difalLoteGnre.findFirst({ where: { empresa: emp, criadoEm: { gte: inicioDia } }, select: { id: true } })
        if (jaTem) {
          linhasPortal.push(`${emp}: já existe lote de hoje (${jaTem.id}); não gerei outro`)
          continue
        }
        for (let i = 0; i < notas.length; i += LIMITE_GUIAS_LOTE) {
          try {
            const lote = await gerarLoteDasNotas(prisma, notas.slice(i, i + LIMITE_GUIAS_LOTE).map((g) => g.id))
            await enviarLoteGnre(prisma, lote.loteId)
            await dorme(ESPERA_RESULTADO_MS)
            const r = await consultarLoteGnre(prisma, lote.loteId)
            const conta: Record<string, number> = {}
            for (const g of r.guias) conta[g.situacaoGuia] = (conta[g.situacaoGuia] ?? 0) + 1
            const resumo = Object.entries(conta).map(([s, n]) => `${n} ${SITUACAO_GUIA[s]?.toLowerCase() ?? `situação ${s}`}`).join(', ')
            linhasPortal.push(`${emp}: lote ${lote.loteId} · ${resumo || r.situacao.descricao}`)
          } catch (e) {
            linhasPortal.push(`${emp}: falhou (${(e as Error).message})`)
          }
        }
      }
    }

    // 4. mensagem (sem nome nem CPF de cliente)
    const teste = ambienteGnre() === 'homologacao' ? ' (portal em TESTE)' : ''
    const partes = [
      `DIFAL ${hoje.split('-').reverse().slice(0, 2).join('/')}${teste}: ${doDia.length} guia(s) para pagar, ${brl(total)}`,
      ...['AVIC', 'AGRO'].filter((e) => porEmpresa(e).length).map((e) => `${e}: ${porEmpresa(e).length} (${brl(porEmpresa(e).reduce((s, g) => s + g.difalCalculado, 0))})`),
      ...(completo ? linhasPortal : doDia.length ? ['Gere o lote no painel (modo só aviso).'] : []),
      ...(atrasadas ? [`Atrasadas esperando decisão: ${atrasadas}`] : []),
      ...falhas.map((f) => `Atenção: ${f}`),
      `Painel: ${PAINEL_DIFAL}`,
    ]
    const mensagem = partes.join('\n')

    let enviadaWhatsapp = false
    const numero = process.env.DIFAL_WHATSAPP_NUMERO?.trim()
    if (!simulacao) {
      if (numero) {
        const r = await sendMessage('avic', numero, mensagem)
        enviadaWhatsapp = r.ok
        if (!r.ok) console.error('[DIFAL rotina] WhatsApp não enviou:', r.error)
      }
      console.log(`[DIFAL rotina] ${enviadaWhatsapp ? 'WhatsApp enviado' : 'sem WhatsApp (número vazio ou falha)'}\n${mensagem}`)
    }
    return { mensagem, enviadaWhatsapp }
  } finally {
    rodando = false
  }
}
