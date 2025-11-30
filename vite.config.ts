import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Base path for deployment - can be overridden via BASE_PATH env variable
  // For root domain: use '/' or leave empty
  // For GitHub Pages: use '/repo-name/'
  base: process.env.BASE_PATH || '/',
  optimizeDeps: {
    include: ['@mediapipe/hands'],
    exclude: []
  },
  build: {
    commonjsOptions: {
      include: [/@mediapipe/, /node_modules/],
      transformMixedEsModules: true
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'mediapipe-hands': ['@mediapipe/hands']
        },
        // Preserve module structure for MediaPipe
        format: 'es',
        preserveModules: false
      }
    }
  },
  // Ensure MediaPipe is not transformed incorrectly
  ssr: {
    noExternal: ['@mediapipe/hands']
  }
})

