import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { carriersApi } from '../lib/api'
import { CarrierFormModal } from '../components/carriers/CarrierForm'
import { Spinner } from '../components/ui/Spinner'
import { useAuth } from '../contexts/AuthContext'
import type { Carrier } from '../types'

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
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transportadoras</h1>
          <p className="text-sm text-gray-500 mt-0.5">Cadastre e gerencie suas transportadoras</p>
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
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-8 w-8" />
          </div>
        ) : carriers?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <svg className="h-12 w-12 mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
            </svg>
            <p className="font-medium">Nenhuma transportadora cadastrada</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">Nome</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">CNPJ</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">Telefone</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">Pedidos</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">Status</th>
                {isAdmin && <th className="px-6 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {carriers?.map((carrier) => (
                <tr key={carrier.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-medium text-gray-900">{carrier.name}</td>
                  <td className="px-6 py-4 font-mono text-gray-600">{carrier.cnpj}</td>
                  <td className="px-6 py-4 text-gray-600">{carrier.phone}</td>
                  <td className="px-6 py-4 text-gray-600">{carrier._count?.orders ?? 0}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        carrier.active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${carrier.active ? 'bg-green-500' : 'bg-gray-400'}`} />
                      {carrier.active ? 'Ativa' : 'Inativa'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(carrier)}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => setDeleteTarget(carrier)}
                          className="text-red-500 hover:text-red-700 text-xs font-medium"
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
        )}
      </div>

      {/* Form modal */}
      <CarrierFormModal open={formOpen} onClose={handleCloseForm} carrier={editing} />

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteTarget(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirmar exclusão</h3>
            <p className="text-sm text-gray-600 mb-6">
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
