import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: false,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3005',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'esnext'
  }
});
