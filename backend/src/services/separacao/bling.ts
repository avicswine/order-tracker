import type { BlingSeparacaoAdapter } from './bling-tipos'
import { blingMock } from './bling-mock'
import { blingReal } from './bling-real'

// Escolhe a fonte de dados do Bling: SEPARACAO_MOCK=1 usa dados de exemplo (dev sem tokens).
export const MODO_MOCK = process.env.SEPARACAO_MOCK === '1'

export const bling: BlingSeparacaoAdapter = MODO_MOCK ? blingMock : blingReal

if (MODO_MOCK) console.log('[Separação] MODO MOCK ativo — dados do Bling são de exemplo (SEPARACAO_MOCK=1)')
