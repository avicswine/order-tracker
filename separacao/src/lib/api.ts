// Cliente HTTP mínimo (fetch) para /api/separacao — sem dependências extras.
const BASE = '/api/separacao'
const TOKEN_KEY = 'separacao_token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const tokenStorage = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

let aoExpirar: (() => void) | null = null
export function onSessaoExpirada(cb: () => void) {
  aoExpirar = cb
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = tokenStorage.get()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 204) return undefined as T

  const texto = await res.text()
  let dados: unknown = null
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    dados = null
  }

  if (!res.ok) {
    // 401 em rota autenticada → sessão caiu (não dispara no próprio login)
    if (res.status === 401 && token && !path.startsWith('/auth/login')) {
      tokenStorage.clear()
      aoExpirar?.()
    }
    const msg = (dados as { error?: string } | null)?.error || `Erro ${res.status}`
    throw new ApiError(res.status, msg)
  }
  return dados as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

// URL absoluta para SSE (EventSource não aceita header → token na query, como no painel)
export function urlComToken(path: string): string {
  const token = tokenStorage.get() ?? ''
  const sep = path.includes('?') ? '&' : '?'
  return `${BASE}${path}${sep}token=${encodeURIComponent(token)}`
}
