import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'assets',
  server: {
    host: true,   // listen on 0.0.0.0 so LAN devices can connect
    port: 3000,
    open: true,
  },
  optimizeDeps: {
    exclude: ['jolt-physics'],
  },
  worker: {
    format: 'es',
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'making-of': resolve(__dirname, 'making-of/index.html'),
        'making-of-kelp': resolve(__dirname, 'making-of/kelp.html'),
        'making-of-creatures': resolve(__dirname, 'making-of/creatures.html'),
        'making-of-camera': resolve(__dirname, 'making-of/camera.html'),
        'making-of-rendering': resolve(__dirname, 'making-of/rendering.html'),
        'making-of-origins': resolve(__dirname, 'making-of/origins.html'),
        'making-of-ecosystem': resolve(__dirname, 'making-of/ecosystem.html'),
        'making-of-audio': resolve(__dirname, 'making-of/audio.html'),
        'making-of-performance': resolve(__dirname, 'making-of/performance.html'),
      },
    },
  },
  test: {
    environment: 'node',
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
