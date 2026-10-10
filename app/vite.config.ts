import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Service Worker مخصص (لاستقبال التنبيهات) مع التخزين المسبق من Workbox
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      manifest: {
        name: 'كورة لايف — نتائج ومباريات مباشرة',
        short_name: 'كورة لايف',
        description: 'نتائج مباشرة، مواعيد المباريات، جداول الترتيب وتنبيهات الأهداف',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b6b3a',
        theme_color: '#0b6b3a',
        categories: ['sports', 'news'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // أثناء التطوير: تمرير /api إلى wrangler dev
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
