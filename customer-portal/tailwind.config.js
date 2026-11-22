import tema from '../frontend/tailwind.tema.js'

/** @type {import('tailwindcss').Config} */
export default {
  // mesmo tema do painel (cores, sombras, fonte): fica em frontend/tailwind.tema.js
  presets: [tema],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../frontend/src/lib/estilo.ts'],
  plugins: [],
}
