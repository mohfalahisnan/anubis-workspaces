import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest',
      closeBundle() {
        mkdirSync('dist', { recursive: true })
        copyFileSync(resolve('manifest.json'), resolve('dist/manifest.json'))
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: r('./src/background.ts'),
        content: r('./src/content/instagram.ts'),
        options: r('./src/options/index.html'),
        popup: r('./src/popup/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
    target: 'chrome120',
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})
