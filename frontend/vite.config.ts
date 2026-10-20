/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Heavy, route-specific vendors split out for long-term caching:
        // recharts only on chart pages, framer-motion only by GuestHome, qrcode only
        // by WiFiPage. Function form on purpose: the object form also moved each
        // package's *shared* dependencies into its chunk — React itself landed in
        // framer-motion's — so the entry had to import both heavy chunks and every
        // page (even login) downloaded ~200 KB gz of chart/animation code. React gets
        // its own small chunk; anything else shared is left to Rollup.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/](recharts|victory-vendor|d3-[^\\/]+)[\\/]/.test(id)) return 'recharts';
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'framer-motion';
          if (/[\\/]node_modules[\\/]qrcode[\\/]/.test(id)) return 'qrcode';
          return undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})
