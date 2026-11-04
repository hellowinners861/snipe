import { defineConfig } from 'vite';

export default defineConfig({
  base: '/snipe/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1800 },
  server: { host: '0.0.0.0', allowedHosts: ['terminal.local'] },
});
