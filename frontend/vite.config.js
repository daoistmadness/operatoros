import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as vite from 'vite';

// vite.config.js
// Vite development server with API proxy, Vitest configuration, and JSX-in-JS transform support.
// Tech Stack: Vite / React 19 / Vitest

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'treat-js-files-as-jsx',
      async transform(code, id) {
        if (!id.match(/src\/.*\.js$/)) return null;

        return vite.transformWithEsbuild(code, id, {
          loader: 'jsx',
          jsx: 'automatic',
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'build',
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './vitest.setup.js',
  },
});
