import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
    // New versions take over after all existing windows close, preserving a journey.
    registerType: 'prompt',
    injectRegister: 'script-defer',
    includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
    manifest: {
      id: '/',
      name: 'Beyond the Glass',
      short_name: 'Beyond',
      description: 'A floating world beyond the glass. Lean, drift, and travel through black holes.',
      start_url: '/',
      scope: '/',
      display: 'fullscreen',
      background_color: '#000000',
      theme_color: '#000000',
      icons: [
        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      navigateFallback: 'index.html',
      cleanupOutdatedCaches: true,
      runtimeCaching: [{
        urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'beyond-fonts',
          cacheableResponse: { statuses: [0, 200] },
          expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
        },
      }],
    },
  })],
  // the workspace lives under a virtualized Windows app-data path; resolving
  // real paths points Vite at a location it can't read
  resolve: { preserveSymlinks: true },
  server: { port: 5199 },
})
