import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import fs from 'node:fs';

const client = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'client.config.json'), 'utf8')).client;

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
  base: demo ? './' : '/',
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@app': path.resolve(__dirname, 'src/app'),
      '@client-config': path.resolve(__dirname, 'client.config.json'),
    },
  },
  server: { fs: { allow: ['.'] } },
  plugins: [
    react(),
    tailwindcss(),
    !demo && VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: client.title ?? client.name,
        short_name: client.shortName,
        lang: 'es',
        start_url: '/',
        display: 'standalone',
        background_color: '#F4F3EF',
        theme_color: '#15181C',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Librerías de exportación/importación: se descargan solo cuando se usan
        globIgnores: ['**/exceljs*', '**/jspdf*', '**/html2canvas*', '**/purify*', '**/index.es-*'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /^https:\/\/[a-z0-9-]+\.tile\.openstreetmap\.org\//, handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 14 } } },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1000, outDir: demo ? 'dist-demo' : 'dist', target: 'es2022',
    // Demo: el visor de páginas solo sirve ciertos tipos; los binarios de PGlite viajan como .wasm (mismo contenido)
    ...(demo ? { rolldownOptions: { output: { assetFileNames: (a: { names?: string[]; name?: string }) =>
      /\.(data|gz)$/.test(a.names?.[0] ?? a.name ?? '') ? 'assets/[name]-[hash].bin.wasm' : 'assets/[name]-[hash][extname]' } } } : {}),
  },
  };
});
