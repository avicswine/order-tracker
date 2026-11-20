/**
 * Rotina diária do DIFAL (aprovada pelo José em 20/11/2026): todo dia útil às 16h (Brasília; HORA_ROTINA_DIFAL) atualiza as notas,
 * monta a lista do dia (no prazo, estados com cobrança) e manda um resumo por WhatsApp.
 *   DIFAL_ROTINA=1          liga o agendamento (sem ela, só roda pelo botão de simulação)
 *   DIFAL_ROTINA_ENVIAR=1   modo completo: também gera os lotes, envia ao portal e consulta o resultado.
 *                           Só vale com o portal em PRODUÇÃO: lote de teste aceito trava a nota real (não dá para desfazer).
 *   DIFAL_WHATSAPP_NUMERO   número que recebe o aviso (vazio: só registra no log)
 * O pagamento continua com o José. Atrasadas ficam de fora (decisão dele). Mensagem sem nome nem CPF de cliente.
 */
import type { PrismaClient } from '@prisma/client'
import { importarNotas } from './importar'
import { preencherLogisticaMl } from './logisticaMl'
import { gerarLoteDasNotas, listarGuiasPendentes, proximoDiaUtil, HORA_ROTINA_DIFAL, type GuiaPendente } from './guias'
import { LIMITE_GUIAS_POR_LOTE } from './gnre'
import { consultarLoteGnre, enviarLoteGnre } from './lotesGnre'
import { ambienteGnre, SITUACAO_GUIA } from './portalGnre'
import { sendMessage } from '../whatsapp'
import { dataBR, meiaNoiteBR, somarDias } from '../separacao/datas'

const DIAS_IMPORTACAO = 3
/** tempo para o portal processar o lote antes da consulta */
const ESPERA_RESULTADO_MS = 30_000
const PAINEL_DIFAL = 'https://order-tracker-production-4189.up.railway.app/difal'
const EMPRESAS = ['AVIC', 'AGRO']

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))
const somaDifal = (gs: GuiaPendente[]) => gs.reduce((s, g) => s + g.difalCalculado, 0)

export interface ResultadoRotina {
  mensagem: string
  enviadaWhatsapp: boolean
  /** a rotina não rodou (fim de semana, feriado ou já em andamento) */
  pulou?: string
}

/** última execução de verdade (não a simulação), para o painel mostrar se deu certo */
export interface UltimaExecucao {
  em: Date
  ok: boolean
  enviadaWhatsapp: boolean
  resumo: string
}
let ultima: UltimaExecucao | null = null
export const ultimaExecucaoRotina = () => ultima

let rodando = false

/** importa as notas dos últimos dias e o tipo de envio do ML; o que falhar entra no aviso */
async function atualizarDados(prisma: PrismaClient, hoje: string, falhas: string[]) {
  try {
    const imp = await importarNotas(prisma, { desde: meiaNoiteBR(somarDias(hoje, -DIAS_IMPORTACAO)) })
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

/** gera, envia e consulta um lote por empresa (uma vez por dia); devolve uma linha por lote para a mensagem */
async function enviarLotesDoDia(prisma: PrismaClient, hoje: string, doDia: GuiaPendente[]): Promise<string[]> {
  const linhas: string[] = []
  for (const emp of EMPRESAS) {
    const notas = doDia.filter((g) => g.empresa === emp)
    if (!notas.length) continue
    const jaTem = await prisma.difalLoteGnre.findFirst({ where: { empresa: emp, criadoEm: { gte: meiaNoiteBR(hoje) } }, select: { id: true } })
    if (jaTem) {
      linhas.push(`${emp}: já existe lote de hoje (${jaTem.id}); não gerei outro`)
      continue
    }
    for (let i = 0; i < notas.length; i += LIMITE_GUIAS_POR_LOTE) {
      try {
        const lote = await gerarLoteDasNotas(prisma, notas.slice(i, i + LIMITE_GUIAS_POR_LOTE).map((g) => g.id))
        await enviarLoteGnre(prisma, lote.loteId)
        await dorme(ESPERA_RESULTADO_MS)
        const r = await consultarLoteGnre(prisma, lote.loteId)
        const conta: Record<string, number> = {}
        for (const g of r.guias) conta[g.situacaoGuia] = (conta[g.situacaoGuia] ?? 0) + 1
        const resumo = Object.entries(conta).map(([s, n]) => `${n} ${SITUACAO_GUIA[s]?.toLowerCase() ?? `situação ${s}`}`).join(', ')
        linhas.push(`${emp}: lote ${lote.loteId} · ${resumo || r.situacao.descricao}`)
      } catch (e) {
        linhas.push(`${emp}: falhou (${(e as Error).message})`)
      }
    }
  }
  return linhas
}

/** monta o texto do dia; no modo completo, gera e envia os lotes antes */
async function montarMensagem(prisma: PrismaClient, hoje: string, simulacao: boolean): Promise<string> {
  const falhas: string[] = []
  // na simulação (botão) usa os dados já importados: importar leva minutos e a tela não pode esperar
  if (!simulacao) await atualizarDados(prisma, hoje, falhas)

  // lista do dia: igual ao painel (no prazo, estados com cobrança), só o que está pronto e sem guia
  const pendentes = await listarGuiasPendentes(prisma)
  const doDia = pendentes.filter((g) => !g.atrasada && g.estadoComCobranca && g.pronta && !g.guiaGeradaEm)
  const atrasadas = pendentes.filter((g) => g.atrasada && g.estadoComCobranca).length
  const porEmpresa = (emp: string) => doDia.filter((g) => g.empresa === emp)

  const producao = ambienteGnre() === 'producao'
  const pedeCompleto = process.env.DIFAL_ROTINA_ENVIAR === '1'
  let linhasPortal: string[]
  if (!doDia.length) linhasPortal = []
  else if (!pedeCompleto) linhasPortal = ['Gere o lote no painel (modo só aviso).']
  else if (!producao) linhasPortal = ['Modo completo parado: o portal está em TESTE (guia de teste travaria a nota real). Gere o lote no painel.']
  else if (simulacao) linhasPortal = [`Modo completo: às ${HORA_ROTINA_DIFAL}h geraria e enviaria ao portal o lote de ${EMPRESAS.filter((e) => porEmpresa(e).length).join(' e ')}.`]
  else linhasPortal = await enviarLotesDoDia(prisma, hoje, doDia)

  // sem nome nem CPF de cliente
  return [
    `DIFAL ${hoje.split('-').reverse().slice(0, 2).join('/')}${producao ? '' : ' (portal em TESTE)'}: ${doDia.length} guia(s) para pagar, ${brl(somaDifal(doDia))}`,
    ...EMPRESAS.filter((e) => porEmpresa(e).length).map((e) => `${e}: ${porEmpresa(e).length} (${brl(somaDifal(porEmpresa(e)))})`),
    ...linhasPortal,
    ...(atrasadas ? [`Atrasadas esperando decisão: ${atrasadas}`] : []),
    ...falhas.map((f) => `Atenção: ${f}`),
    `Painel: ${PAINEL_DIFAL}`,
  ].join('\n')
}

async function avisarWhatsapp(mensagem: string): Promise<boolean> {
  const numero = process.env.DIFAL_WHATSAPP_NUMERO?.trim()
  if (!numero) return false
  const r = await sendMessage('avic', numero, mensagem)
  if (!r.ok) console.error('[DIFAL rotina] WhatsApp não enviou:', r.error)
  return r.ok
}

/**
 * @param simulacao  true = não importa, não gera lote, não envia ao portal nem WhatsApp: só devolve o texto (botão do painel)
 * @param agendada   true = chamada pelo agendador (respeita dia útil)
 */
export async function rodarRotinaDifal(prisma: PrismaClient, { simulacao, agendada }: { simulacao: boolean; agendada: boolean }): Promise<ResultadoRotina> {
  const hoje = dataBR()
  // a simulação só lê: não disputa a trava com a rotina das 16h
  if (simulacao) return { mensagem: await montarMensagem(prisma, hoje, true), enviadaWhatsapp: false }

  if (agendada && proximoDiaUtil(hoje) !== hoje) return { mensagem: '', enviadaWhatsapp: false, pulou: `${hoje} não é dia útil bancário` }
  if (rodando) return { mensagem: '', enviadaWhatsapp: false, pulou: 'rotina já em andamento' }
  rodando = true
  try {
    const mensagem = await montarMensagem(prisma, hoje, false)
    const enviadaWhatsapp = await avisarWhatsapp(mensagem)
    ultima = { em: new Date(), ok: true, enviadaWhatsapp, resumo: mensagem.split('\n')[0] }
    console.log(`[DIFAL rotina] ${enviadaWhatsapp ? 'WhatsApp enviado' : 'sem WhatsApp (número vazio ou falha)'}\n${mensagem}`)
    return { mensagem, enviadaWhatsapp }
  } catch (e) {
    // erro nunca passa em silêncio: vai para o WhatsApp e para o painel (só a mensagem, sem dados de cliente)
    const motivo = String((e as Error).message).split('\n')[0].slice(0, 200)
    const mensagem = `DIFAL: a rotina das ${HORA_ROTINA_DIFAL}h falhou (${motivo}). Confira no painel: ${PAINEL_DIFAL}`
    const enviadaWhatsapp = await avisarWhatsapp(mensagem).catch((err) => {
      console.error('[DIFAL rotina] aviso da falha também não foi pelo WhatsApp:', (err as Error).message)
      return false
    })
    ultima = { em: new Date(), ok: false, enviadaWhatsapp, resumo: `falhou: ${motivo}` }
    console.error(`[DIFAL rotina] falhou: ${motivo}`)
    return { mensagem, enviadaWhatsapp }
  } finally {
    rodando = false
  }
}
