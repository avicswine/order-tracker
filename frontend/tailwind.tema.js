/**
 * Tema visual único do Order Tracker (painel e Portal Cliente leem daqui).
 * Mudou uma cor, um raio ou uma sombra? Mude só aqui.
 *
 * Contraste (WCAG AA, mínimo 4,5:1 para texto):
 *  - texto branco sobre primaria-600 (#0E5A6B): ~7,6:1
 *  - primaria-700 sobre branco: ~9,6:1
 *  - selos de status usam fundo -50/-100 com texto -800: todos acima de 7:1
 */

/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      colors: {
        // azul petróleo: botões principais, links, aba ativa, foco
        primaria: {
          50: '#EEF7F9',
          100: '#D3ECF1',
          200: '#A8D8E2',
          300: '#71BBCB',
          400: '#3D97AC',
          500: '#1B7A90',
          600: '#0E5A6B',
          700: '#0B4A59',
          800: '#093B47',
          900: '#072E38',
        },
        // grafite: menu lateral e cabeçalhos escuros
        secundaria: {
          DEFAULT: '#1E293B',
          escura: '#0F172A',
        },
      },
      fontFamily: {
        // fonte do sistema (sem baixar fonte de fora)
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      // raio: só rounded-lg (8 px); rounded-full só para selos, bolinhas e avatares
      boxShadow: {
        // três sombras: cartão, menu suspenso, janela
        cartao: '0 1px 2px 0 rgb(15 23 42 / 0.06), 0 1px 3px 0 rgb(15 23 42 / 0.04)',
        suspenso: '0 6px 16px -4px rgb(15 23 42 / 0.14)',
        janela: '0 20px 40px -12px rgb(15 23 42 / 0.30)',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'ease',
      },
    },
  },
}
