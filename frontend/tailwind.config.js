import tema from './tailwind.tema.js'

/** @type {import('tailwindcss').Config} */
export default {
  presets: [tema],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  plugins: [],
}
