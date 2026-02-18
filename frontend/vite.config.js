import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['cam-clubs-pediatric-protection.trycloudflare.com'],
    port: 5173,
    // Proxy /api requests to backend at 4000 during development to avoid CORS/network issues
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
})
