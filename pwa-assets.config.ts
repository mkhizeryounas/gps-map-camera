import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Source logo is full-bleed square artwork, so no padding: iOS and Android mask the corners themselves.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background: '#16a34a' } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background: '#16a34a' } },
  },
  images: ['public/logo.svg'],
})
