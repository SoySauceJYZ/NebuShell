import { ipcMain, BrowserWindow } from 'electron'
import { vaultManager } from '../vault/VaultManager'
import { streamChat } from '../llm/LlmClient'
import type { ChatMessage, ChatTool, LlmSettings, LlmSettingsPublic } from '../../shared/types'

function toPublic(settings: LlmSettings): LlmSettingsPublic {
  return {
    providers: settings.providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      models: p.models,
      hasKey: !!p.apiKey
    })),
    activeProviderId: settings.activeProviderId,
    activeModelId: settings.activeModelId
  }
}

export function registerLlmIpc(): void {
  // Public settings never include the plaintext key.
  ipcMain.handle('llm:getSettings', () => toPublic(vaultManager.getLlmSettings()))

  // Save the full provider list. A blank apiKey means "keep the existing key" for
  // that provider (matched by id).
  ipcMain.handle('llm:setSettings', (_e, incoming: LlmSettings) => {
    const existing = vaultManager.getLlmSettings()
    const merged: LlmSettings = {
      ...incoming,
      providers: incoming.providers.map((p) => {
        if (p.apiKey && p.apiKey.length > 0) return p
        const prev = existing.providers.find((x) => x.id === p.id)
        return { ...p, apiKey: prev?.apiKey ?? '' }
      })
    }
    vaultManager.setLlmSettings(merged)
    return toPublic(merged)
  })

  ipcMain.handle('llm:setActive', (_e, providerId: string, modelId: string) => {
    vaultManager.setActiveModel(providerId, modelId)
  })

  // Active streaming requests, so the renderer can abort them.
  const controllers = new Map<string, AbortController>()

  ipcMain.handle(
    'llm:chat',
    (
      e,
      runId: string,
      payload: { messages: ChatMessage[]; tools: ChatTool[]; providerId?: string; model?: string }
    ) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) throw new Error('No window')
      const settings = vaultManager.getLlmSettings()
      const provider = settings.providers.find((p) => p.id === payload.providerId)
      if (!provider) {
        win.webContents.send(`llm:error:${runId}`, '未选择模型或供应商,请在设置中添加并在输入框选择。')
        return
      }
      const model =
        payload.model ||
        provider.models.find((m) => m.id === settings.activeModelId)?.name ||
        provider.models[0]?.name ||
        ''
      const controller = new AbortController()
      controllers.set(runId, controller)
      void streamChat(
        win,
        runId,
        payload.messages,
        payload.tools,
        { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model },
        controller.signal
      ).finally(() => controllers.delete(runId))
    }
  )

  ipcMain.handle('llm:abort', (_e, runId: string) => {
    controllers.get(runId)?.abort()
    controllers.delete(runId)
  })
}
