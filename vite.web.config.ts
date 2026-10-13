import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, type Plugin, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build of the web edition (headless Linux server + browser), alongside the Electron
// build in electron.vite.config.ts. Two modes:
//   vite build -c vite.web.config.ts --mode client  → out/web/client (browser bundle)
//   vite build -c vite.web.config.ts --mode server  → out/web/server/index.js (Node)
// Both alias `electron` to a shim so src/preload and src/main are reused unchanged.

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
const SERVER_PORT = Number(process.env.NEBUSHELL_DEV_SERVER_PORT ?? 18080)

/** Ship the app icon as /icon.png (favicon) without pulling in the whole resources dir. */
function emitIcon(): Plugin {
  return {
    name: 'nebu-web-icon',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'icon.png',
        source: readFileSync(resolve('resources/icon.png'))
      })
    }
  }
}

export default defineConfig(({ mode }): UserConfig => {
  if (mode === 'server') {
    return {
      define: {
        __NEBU_VERSION__: JSON.stringify(pkg.version),
        // ws's optional native addons get stubbed as empty objects when bundled, and ws
        // would then call bufferUtil.unmask() on the stub. Use its own opt-out switches.
        'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('1'),
        'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('1')
      },
      resolve: {
        alias: {
          electron: resolve('src/web/server/electronShim.ts')
        }
      },
      ssr: {
        // One self-contained file: the server needs no node_modules at runtime.
        noExternal: true,
        // ssh2's optional native accelerator; its require() is guarded and falls back to JS.
        external: ['cpu-features']
      },
      build: {
        ssr: resolve('src/web/server/index.ts'),
        outDir: 'out/web/server',
        emptyOutDir: true,
        target: 'node22',
        minify: false,
        sourcemap: true,
        rollupOptions: {
          external: [/\.node$/, 'cpu-features'],
          output: { format: 'cjs', entryFileNames: 'index.js', inlineDynamicImports: true }
        }
      }
    }
  }

  return {
    root: resolve('src/web/client'),
    base: '/',
    publicDir: false,
    envDir: resolve('.'),
    define: {
      'import.meta.env.VITE_NEBU_WEB': JSON.stringify('true'),
      // src/preload checks this to pick exposeInMainWorld vs plain assignment.
      'process.contextIsolated': 'false'
    },
    resolve: {
      alias: {
        electron: resolve('src/web/client/electronShim.ts'),
        '@electron-toolkit/preload': resolve('src/web/client/toolkitPreloadShim.ts'),
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), emitIcon()],
    server: {
      port: 15174,
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${SERVER_PORT}`,
        '/ws': { target: `ws://127.0.0.1:${SERVER_PORT}`, ws: true }
      }
    },
    build: {
      outDir: resolve('out/web/client'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 8000
    }
  }
})
