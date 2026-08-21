import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const SERVER_PORT = process.env.WATSMYTASK_PORT ?? process.env.PLANNER_PORT ?? '5123';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(import.meta.dirname, 'src/web'),
  resolve: {
    alias: { '@shared': path.resolve(import.meta.dirname, 'src/shared') },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/web'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: false,
      },
    },
  },
});
