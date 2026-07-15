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

  // Query an OpenAI-compatible provider's GET /models. Uses the values currently in
  // the settings form (which may be unsaved); a blank apiKey falls back to the stored
  // key for that provider, so the renderer never has to see the plaintext key.
  ipcMain.handle(
    'llm:listModels',
    async (_e, payload: { providerId?: string; baseUrl: string; apiKey?: string }) => {
      const baseUrl = (payload.baseUrl ?? '').trim()
      if (!baseUrl) throw new Error('请先填写 Base URL')
      let apiKey = (payload.apiKey ?? '').trim()
      if (!apiKey && payload.providerId) {
        apiKey =
          vaultManager.getLlmSettings().providers.find((p) => p.id === payload.providerId)
            ?.apiKey ?? ''
      }
      const url = `${baseUrl.replace(/\/+$/, '')}/models`
      let res: Response
      try {
        res = await fetch(url, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
        })
      } catch (err) {
        throw new Error(`无法连接 ${url}:${err instanceof Error ? err.message : String(err)}`)
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`获取失败 (${res.status}) ${body.slice(0, 300)}`)
      }
      const json = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null
      const ids = (json?.data ?? [])
        .map((m) => m?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b))
    }
  )

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
        win.webContents.send(
          `llm:error:${runId}`,
          '未选择模型或供应商,请在设置中添加并在输入框选择。'
        )
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
