import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: '/planner/embed/',
  plugins: [react()],
  resolve: {
    alias: {
      // 루트 lib/ 의 floorplan-* 모듈을 단일 진실 원천으로 사용
      // (planner-vite와 detaildesign 양쪽이 같은 타입/함수를 공유)
      '@floorplan': path.resolve(__dirname, '../lib'),
    },
  },
  build: {
    outDir: '../planner/embed',
    emptyOutDir: true,
  },
});
