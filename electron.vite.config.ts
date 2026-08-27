import { externalizeDepsPlugin, defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(projectRoot, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads may require only Electron's built-in modules. Keep
      // browser-safe dependencies such as zod inside the standalone bundle.
      externalizeDeps: false,
      rollupOptions: {
        input: resolve(projectRoot, 'src/preload/index.ts'),
        // Sandboxed Electron preloads are loaded as CommonJS scripts. Keep
        // contextIsolation/sandbox enabled and emit an unambiguous .cjs file
        // instead of relying on the package-level ESM default.
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    // Keep Vite from loading the repository's .env.local into the renderer.
    // The main process reads only the one allowlisted provider secret.
    envDir: resolve(projectRoot, '.renderer-env'),
    envPrefix: ['VITE_PUBLIC_'],
    base: './',
    resolve: {
      alias: {
        '@': resolve(projectRoot, 'src/renderer'),
        '@shared': resolve(projectRoot, 'src/shared'),
      },
    },
    plugins: [react()],
    server: {
      host: '127.0.0.1',
    },
  },
})
