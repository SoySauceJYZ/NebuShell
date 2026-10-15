// NebuShell web edition: the Electron main-process backend running as a plain Node
// service (see docs/web/README.md). `electron` resolves to ./electronShim in this build,
// so the shared IPC handlers in src/main/ipc register into the shim's tables and are
// dispatched by the WebSocket hub instead of ipcMain.
import { config, HELP } from './config'
import { ipcMain } from './electronShim'
import { setBroadcastSink } from '../../main/broadcast'
import { vaultManager } from '../../main/vault/VaultManager'
import { mcpManager } from '../../main/mcp/McpManager'
import { registerVaultIpc } from '../../main/ipc/vaultIpc'
import { registerSshIpc } from '../../main/ipc/sshIpc'
import { registerSftpIpc } from '../../main/ipc/sftpIpc'
import { registerContainerFsIpc } from '../../main/ipc/containerFsIpc'
import { registerLocalIpc } from '../../main/ipc/localIpc'
import { registerFileIpc } from '../../main/ipc/fileIpc'
import { registerHistoryIpc } from '../../main/ipc/historyIpc'
import { registerLlmIpc } from '../../main/ipc/llmIpc'
import { registerAgentChatIpc } from '../../main/ipc/agentChatIpc'
import { registerCommandHistoryIpc } from '../../main/ipc/commandHistoryIpc'
import { registerQuickCommandsIpc } from '../../main/ipc/quickCommandsIpc'
import { registerSettingsIpc } from '../../main/ipc/settingsIpc'
import { registerUpdateIpc } from '../../main/ipc/updateIpc'
import { registerMcpIpc } from '../../main/ipc/mcpIpc'
import { registerProxyIpc } from '../../main/ipc/proxyIpc'
import { registerMonitorCenterIpc } from '../../main/ipc/monitorCenterIpc'
import { createWebServer } from './http'
import { attachWsHub, broadcastToClients, logoutAll } from './wsHub'
import { revokeAllSessions } from './auth'
import { initTransfers } from './transfer'
import { mkdirSync } from 'fs'

declare const __NEBU_VERSION__: string

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write(HELP)
    return
  }

  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
  setBroadcastSink(broadcastToClients)

  // Same order as src/main/index.ts, minus the desktop-only window and remote-desktop
  // handlers (no BrowserWindow, no screen to capture or inject into).
  registerVaultIpc()
  registerSshIpc()
  registerSftpIpc()
  registerContainerFsIpc()
  registerLocalIpc()
  registerFileIpc()
  registerHistoryIpc()
  registerLlmIpc()
  registerAgentChatIpc()
  registerCommandHistoryIpc()
  registerQuickCommandsIpc()
  registerSettingsIpc()
  registerUpdateIpc()
  registerMcpIpc()
  registerProxyIpc()
  registerMonitorCenterIpc()

  // Locking is a sign-out for every browser: the vault lives in this one process.
  ipcMain.removeHandler('vault:lock')
  ipcMain.handle('vault:lock', () => {
    vaultManager.lock()
    revokeAllSessions()
    // Let this reply leave before the sockets are cut.
    setTimeout(logoutAll, 50)
  })

  await initTransfers()

  const server = createWebServer()
  attachWsHub(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, resolve)
  })

  console.log(`NebuShell Web ${__NEBU_VERSION__} listening on http://${config.host}:${config.port}`)
  console.log(`  data dir: ${config.dataDir}`)
  console.log(`  server-local features: ${config.local ? 'on' : 'off (--no-local)'}`)
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && config.host !== '::1') {
    console.warn(
      '  ! Listening beyond localhost: put an HTTPS reverse proxy in front (docs/web/README.md).'
    )
  }

  const shutdown = (): void => {
    console.log('Shutting down…')
    void mcpManager.stop()
    server.close()
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
