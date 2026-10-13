import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'apps/web-angular/src',
  plugins: [tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:5173'
    }
  }
});
