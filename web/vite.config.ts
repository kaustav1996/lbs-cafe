import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // The preview build is published as a self-contained page, so asset paths must be relative.
  base: mode === 'preview' ? './' : '/',
  build: { outDir: mode === 'preview' ? 'dist-preview' : 'dist', assetsInlineLimit: 0 },
}));
