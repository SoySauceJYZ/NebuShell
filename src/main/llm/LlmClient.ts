import type { BrowserWindow } from 'electron'
import type { ChatMessage, ChatTool, ToolCall } from '../../shared/types'

export interface ResolvedLlm {
  baseUrl: string
  apiKey: string
  model: string
}

function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

interface StreamingToolCall {
  id: string
  name: string
  args: string
}

/**
 * Performs one streaming OpenAI-compatible chat completion. Text deltas are forwarded
 * to the renderer as they arrive; on completion the assembled assistant message
 * (content + any tool_calls) is sent back. Stateless — the renderer owns the loop.
 */
export async function streamChat(
  win: BrowserWindow,
  runId: string,
  messages: ChatMessage[],
  tools: ChatTool[],
  cfg: ResolvedLlm,
  signal?: AbortSignal
): Promise<void> {
  const send = (suffix: string, payload?: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(`llm:${suffix}:${runId}`, payload)
  }

  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    send('error', '当前模型未配置完整(base URL / key / model)')
    return
  }

  let content = ''
  const toolCalls: StreamingToolCall[] = []

  const buildMessage = (): ChatMessage => {
    const finalToolCalls: ToolCall[] = toolCalls
      .filter((t) => t && t.name)
      .map((t, i) => ({
        id: t.id || `call_${runId}_${i}`,
        type: 'function',
        function: { name: t.name, arguments: t.args || '{}' }
      }))
    return {
      role: 'assistant',
      content,
      ...(finalToolCalls.length ? { tool_calls: finalToolCalls } : {})
    }
  }

  try {
    const res = await fetch(chatUrl(cfg.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        tools: tools.length ? tools : undefined,
        tool_choice: tools.length ? 'auto' : undefined,
        stream: true
      }),
      signal
    })

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      send('error', `请求失败 (${res.status}) ${text.slice(0, 500)}`)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        let json: {
          choices?: {
            delta?: {
              content?: string
              tool_calls?: {
                index: number
                id?: string
                function?: { name?: string; arguments?: string }
              }[]
            }
          }[]
        }
        try {
          json = JSON.parse(data)
        } catch {
          continue
        }
        const delta = json.choices?.[0]?.delta
        if (!delta) continue
        if (delta.content) {
          content += delta.content
          send('delta', delta.content)
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const slot = (toolCalls[tc.index] ??= { id: '', name: '', args: '' })
            if (tc.id) slot.id = tc.id
            if (tc.function?.name) slot.name += tc.function.name
            if (tc.function?.arguments) slot.args += tc.function.arguments
          }
        }
      }
    }

    send('done', buildMessage())
  } catch (err) {
    // On user abort, deliver whatever we have so the loop can stop gracefully.
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      send('done', buildMessage())
      return
    }
    send('error', err instanceof Error ? err.message : String(err))
  }
}
