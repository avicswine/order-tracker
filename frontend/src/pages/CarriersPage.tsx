import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { carriersApi } from '../lib/api'
import { CarrierFormModal } from '../components/carriers/CarrierForm'
import { Spinner } from '../components/ui/Spinner'
import { useAuth } from '../contexts/AuthContext'
import type { Carrier } from '../types'
import { TOM, seloTom } from '../lib/estilo'

export function CarriersPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Carrier | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Carrier | null>(null)

  const { data: carriers, isLoading } = useQuery({
    queryKey: ['carriers'],
    queryFn: carriersApi.list,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => carriersApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['carriers'] })
      qc.invalidateQueries({ queryKey: ['orders'] })
      setDeleteTarget(null)
    },
  })

  const handleEdit = (carrier: Carrier) => {
    setEditing(carrier)
    setFormOpen(true)
  }

  const handleCloseForm = () => {
    setFormOpen(false)
    setEditing(null)
  }

  return (
    <div className="pagina">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="pagina-titulo">Transportadoras</h1>
          <p className="pagina-subtitulo">Cadastre e gerencie suas transportadoras</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={() => setFormOpen(true)}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nova Transportadora
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="estado-carregando">
            <Spinner className="h-8 w-8" />
          </div>
        ) : carriers?.length === 0 ? (
          <div className="estado-vazio">
            <svg className="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
            </svg>
            <p className="font-medium text-slate-700">Nenhuma transportadora cadastrada</p>
          </div>
        ) : (
          <div className="tabela-caixa">
          <table className="tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>CNPJ</th>
                <th>Telefone</th>
                <th className="text-right">Pedidos</th>
                <th>Status</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {carriers?.map((carrier) => (
                <tr key={carrier.id}>
                  <td className="font-medium text-slate-900">{carrier.name}</td>
                  <td className="font-mono text-slate-600">{carrier.cnpj}</td>
                  <td className="text-slate-600">{carrier.phone}</td>
                  <td className="num">{carrier._count?.orders ?? 0}</td>
                  <td>
                    <span className={seloTom(carrier.active ? 'verde' : 'cinza')}>
                      <span className={`selo-ponto ${TOM[carrier.active ? 'verde' : 'cinza'].ponto}`} />
                      {carrier.active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(carrier)}
                          className="btn-ghost btn-sm text-primaria-700"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => setDeleteTarget(carrier)}
                          className="btn-ghost btn-sm text-red-700 hover:bg-red-50 hover:text-red-800"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Form modal */}
      <CarrierFormModal open={formOpen} onClose={handleCloseForm} carrier={editing} />

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="janela-fundo" onClick={() => setDeleteTarget(null)} />
          <div className="janela max-w-sm p-6">
            <h3 className="mb-2 text-lg font-semibold">Confirmar exclusão</h3>
            <p className="text-sm text-slate-600 mb-6">
              Tem certeza que deseja excluir <strong>{deleteTarget.name}</strong>? Essa ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-3">
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancelar</button>
              <button
                className="btn-danger"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
              >
                {deleteMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
