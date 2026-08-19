import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, onSessaoExpirada, tokenStorage } from '../lib/api'
import type { Operador } from '../types'

interface AuthState {
  operador: Operador | null
  carregando: boolean
  login: (nome: string, pin: string) => Promise<void>
  setup: (nome: string, pin: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [operador, setOperador] = useState<Operador | null>(null)
  const [carregando, setCarregando] = useState(true)

  const logout = useCallback(() => {
    tokenStorage.clear()
    setOperador(null)
  }, [])

  // Sessão caiu (401 em qualquer chamada) → volta para o login
  useEffect(() => {
    onSessaoExpirada(logout)
  }, [logout])

  // Ao abrir o app, valida o token salvo
  useEffect(() => {
    if (!tokenStorage.get()) {
      setCarregando(false)
      return
    }
    api.get<Operador>('/auth/me')
      .then(setOperador)
      .catch(() => tokenStorage.clear())
      .finally(() => setCarregando(false))
  }, [])

  const login = useCallback(async (nome: string, pin: string) => {
    const r = await api.post<{ token: string; operador: Operador }>('/auth/login', { nome, pin })
    tokenStorage.set(r.token)
    setOperador({ ...r.operador, ativo: true })
  }, [])

  const setup = useCallback(async (nome: string, pin: string) => {
    const r = await api.post<{ token: string; operador: Operador }>('/auth/setup', { nome, pin })
    tokenStorage.set(r.token)
    setOperador(r.operador)
  }, [])

  const value = useMemo(() => ({ operador, carregando, login, setup, logout }), [operador, carregando, login, setup, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
