import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/mvps/label-verify/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      // Matches the /mvps/label-verify/api/* path the app actually
      // requests (see App.jsx's API_BASE, built from BASE_URL), then
      // strips the prefix before forwarding, since the backend itself
      // only knows about /api/*, not the /mvps/label-verify/ prefix.
      '/mvps/label-verify/api': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/mvps\/label-verify/, '')
      }
    }
  }
})
