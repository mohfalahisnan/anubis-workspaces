import { rmSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { electronSimple } from 'vite-plugin-electron/multi-env'
import { notBundle } from 'vite-plugin-electron/plugin'

const root = __dirname
const frontendRoot = path.join(root, 'packages/frontend')
const desktopRoot = path.join(root, 'apps/desktop')

export default defineConfig(({ command }) => {
  rmSync(path.join(desktopRoot, 'dist-electron'), { recursive: true, force: true })

  const isServe = command === 'serve'
  const isBuild = command === 'build'
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG

  return {
    root: frontendRoot,
    publicDir: isServe ? path.join(frontendRoot, 'public') : false,
    resolve: {
      alias: {
        '@': path.join(frontendRoot, 'src'),
      },
    },
    build: {
      outDir: path.join(frontendRoot, 'dist'),
      emptyOutDir: true,
    },
    plugins: [
      react(),
      tailwindcss(),
      electronSimple({
        main: {
          input: path.join(desktopRoot, 'electron/main/index.ts'),
          plugins: [notBundle()],
          options: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: path.join(desktopRoot, 'dist-electron/main'),
              rolldownOptions: {
                external: ['electron', 'electron-updater'],
              },
            },
          },
        },
        preload: {
          input: path.join(desktopRoot, 'electron/preload/index.ts'),
          plugins: [notBundle()],
          options: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined,
              minify: isBuild,
              outDir: path.join(desktopRoot, 'dist-electron/preload'),
              rolldownOptions: {
                external: ['electron'],
              },
            },
          },
        },
      }),
    ],
    clearScreen: false,
  }
})
