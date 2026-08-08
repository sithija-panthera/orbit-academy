import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './', // relative asset paths so GitHub Pages subpath hosting works
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
      },
    },
  },
});
