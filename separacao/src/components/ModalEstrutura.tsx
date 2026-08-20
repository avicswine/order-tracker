import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface ItemEstrutura {
  sku: string
  nome: string
  qtdEsperada: number
  origemKit: string | null
  fotoUrl: string | null
  pesoUnit: number | null
}

interface Estrutura {
  nfNumero: string
  clienteNome: string
  canal: string | null
  valorNota: number | null
  nfEmitidaEm: string | null
  empresa?: { name: string; code: string }
  status: string
  itens: ItemEstrutura[]
}

function fmtQtd(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}

// Mostra o que a NF tem de verdade (kits já explodidos até o item físico) — usado na triagem
export default function ModalEstrutura({ tarefaId, onFechar }: { tarefaId: string; onFechar: () => void }) {
  const [dados, setDados] = useState<Estrutura | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    api.get<Estrutura>(`/tarefas/${tarefaId}/estrutura`)
      .then(setDados)
      .catch(e => setErro(e instanceof Error ? e.message : 'Erro ao carregar'))
  }, [tarefaId])

  const totalUnidades = dados?.itens.reduce((s, i) => s + i.qtdEsperada, 0) ?? 0
  const pesoTotal = dados?.itens.reduce((s, i) => s + (i.pesoUnit ?? 0) * i.qtdEsperada, 0) ?? 0

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={onFechar}>
      <div className="card w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        {!dados && <div className="text-slate-500">{erro || 'Carregando itens da NF…'}</div>}
        {dados && (
          <>
            <div className="flex items-start gap-3 mb-3">
              <div className="flex-1">
                <div className="text-xl font-bold">NF {dados.nfNumero} <span className="text-base font-normal text-slate-500">{dados.empresa?.name}</span></div>
                <div className="text-slate-700">{dados.clienteNome}</div>
                <div className="text-sm text-slate-500">
                  {dados.canal ?? '—'}
                  {dados.nfEmitidaEm && ` · emitida ${new Date(dados.nfEmitidaEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
                  {dados.valorNota !== null && ` · ${dados.valorNota.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
                </div>
              </div>
              <button className="btn-secondary !py-1.5 !px-3 text-sm" onClick={onFechar}>Fechar</button>
            </div>

            <div className="text-xs text-slate-500 mb-2">
              {dados.itens.length} item(ns) físico(s) · {fmtQtd(totalUnidades)} unidade(s){pesoTotal > 0 && ` · ~${pesoTotal.toFixed(2)} kg`}
            </div>

            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 bg-slate-50">
                <tr><th className="p-2 text-left">SKU</th><th className="p-2 text-left">Produto</th><th className="p-2 text-right">Qtd</th></tr>
              </thead>
              <tbody>
                {dados.itens.map((i, idx) => (
                  <tr key={`${i.sku}-${idx}`} className="border-t border-slate-100">
                    <td className="p-2 font-semibold whitespace-nowrap align-top">{i.sku}</td>
                    <td className="p-2">
                      <div className="flex gap-2">
                        {i.fotoUrl && <img src={i.fotoUrl} alt="" className="w-10 h-10 object-cover rounded shrink-0" loading="lazy" />}
                        <div>
                          {i.nome}
                          {i.origemKit && <div className="text-xs text-slate-400">de: {i.origemKit}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="p-2 text-right font-bold align-top">{fmtQtd(i.qtdEsperada)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
