import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/reading-center.svg', 'icons/apple-touch-icon-180x180.png', 'icons/favicon.ico'],
      manifest: {
        name: 'ReadingCenter 閱讀中心',
        short_name: '閱讀中心',
        description: '個人閱讀管理中心',
        lang: 'zh-Hant',
        theme_color: '#70675f',
        background_color: '#f3efe7',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icons/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//]
      }
    })
  ],
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/component/**/*.test.tsx'],
    setupFiles: ['tests/component/setup.ts']
  }
})
