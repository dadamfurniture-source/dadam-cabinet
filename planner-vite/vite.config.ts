import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/planner/embed/',
  plugins: [react()],
  build: {
    outDir: '../planner/embed',
    emptyOutDir: true,
  },
});
