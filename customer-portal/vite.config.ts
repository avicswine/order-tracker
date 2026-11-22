import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/portal',
  // o portal lê o tema e as cores de status da pasta do painel (frontend/), um nível acima
  server: { port: 5174, fs: { allow: ['..'] } },
})
