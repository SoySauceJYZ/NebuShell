import { ipcMain, app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { ChatMessage, AgentConversationMeta } from '../../shared/types'

interface ConvFile {
  id: string
  hostId: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

// hostId is a UUID, filesystem-safe — used directly as the directory name.
function dirFor(hostId: string): string {
  return join(app.getPath('userData'), 'agent-chats', hostId)
}

export function registerAgentChatIpc(): void {
  ipcMain.handle('agentChat:list', (_e, hostId: string): AgentConversationMeta[] => {
    const dir = dirFor(hostId)
    if (!existsSync(dir)) return []
    const metas: AgentConversationMeta[] = []
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      try {
        const conv: ConvFile = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        metas.push({
          id: conv.id,
          hostId: conv.hostId,
          title: conv.title,
          updatedAt: conv.updatedAt,
          messageCount: conv.messages.length
        })
      } catch {
        // skip corrupted file
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  })

  ipcMain.handle('agentChat:load', (_e, hostId: string, convId: string): ChatMessage[] => {
    const file = join(dirFor(hostId), `${convId}.json`)
    if (!existsSync(file)) return []
    try {
      const conv: ConvFile = JSON.parse(readFileSync(file, 'utf8'))
      return conv.messages
    } catch {
      return []
    }
  })

  ipcMain.handle(
    'agentChat:save',
    (_e, hostId: string, convId: string, title: string, messages: ChatMessage[]) => {
      const dir = dirFor(hostId)
      mkdirSync(dir, { recursive: true })
      const conv: ConvFile = { id: convId, hostId, title, updatedAt: Date.now(), messages }
      writeFileSync(join(dir, `${convId}.json`), JSON.stringify(conv), 'utf8')
    }
  )

  ipcMain.handle('agentChat:remove', (_e, hostId: string, convId: string) => {
    const file = join(dirFor(hostId), `${convId}.json`)
    if (existsSync(file)) unlinkSync(file)
  })
}
