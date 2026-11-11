import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' → GitHub Pages 등 하위 경로에 올려도 그대로 동작
export default defineConfig({
  base: './',
  plugins: [react()],
});
