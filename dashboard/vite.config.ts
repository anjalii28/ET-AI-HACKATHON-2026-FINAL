import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  server: {
    host: true, // Listen on all interfaces so Docker can reach it
    port: 5173,
    proxy: {
      // Feedback page calls /reviews/* — forward to Nest reviews-service when not using nginx
      '/reviews': {
        target: 'http://127.0.0.1:3003',
        changeOrigin: true,
      },
    },
  },
})
