import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // HTTPS is required for camera + GPS access when testing on a phone over LAN.
  plugins: [
    basicSsl(),
    VitePWA({
      // 'prompt' lets the app choose a safe moment to activate a new version (see src/main.ts).
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'GPS Map Camera — FBR Premises Photos',
        short_name: 'GPS Map Camera',
        description: 'GPS-stamped, geo-tagged photos of business premises, machinery and utility meters for FBR sales tax registration.',
        theme_color: '#0b0d10',
        background_color: '#0b0d10',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            // Map tiles: cache so the stamp map still renders with patchy signal.
            urlPattern: /^https:\/\/(server\.arcgisonline\.com|[abcd]\.basemaps\.cartocdn\.com)\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
