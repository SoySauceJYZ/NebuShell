import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

// The Windows x64 packages ship N-API binaries. Rebuilding node-pty can replace
// the supplied WinPTY binary and would require a separate compiler toolchain.
if (process.platform !== 'win32' || process.arch !== 'x64') {
  const require = createRequire(import.meta.url)
  const builder = require.resolve('electron-builder/cli.js')
  execFileSync(process.execPath, [builder, 'install-app-deps'], { stdio: 'inherit' })
}
