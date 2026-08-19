import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// App de separação por bipe — servido em /separacao pelo backend em produção.
// Dev normal:    npm run dev          → http://localhost:5176/separacao
// Dev no celular: npm run dev:celular → https://<IP-do-PC>:5176/separacao
//   (modo "celular" liga HTTPS com certificado local — a câmera do navegador só
//    funciona em contexto seguro; aceite o aviso do certificado uma vez no celular)
export default defineConfig(({ mode }) => {
  const celular = mode === 'celular'
  return {
    plugins: [react(), ...(celular ? [basicSsl()] : [])],
    base: '/separacao',
    server: {
      port: 5176,
      host: celular ? true : 'localhost',
      allowedHosts: true, // permite acessar o dev server por túnel (ex.: cloudflared) para testar no celular
      proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
    },
  }
})
