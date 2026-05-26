import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Production build is served from `/dashboard/` (Express static mount in
// server/src/index.js). `base` tells Vite to rewrite asset URLs in the
// built index.html to that prefix so HTML, JS and CSS all resolve correctly
// behind /dashboard. In dev (`npm run dev`) we keep the root path so
// localhost:5173 just works.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/dashboard/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/admin': 'http://localhost:4001',
      '/brands': 'http://localhost:4001',
    },
  },
}));
