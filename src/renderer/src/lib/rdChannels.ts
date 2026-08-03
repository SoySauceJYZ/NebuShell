import type { RdScreen } from '@shared/types'

// 远程桌面的两条辅助 DataChannel(由被控端作为 offer 方创建,控制端经 ondatachannel 取得):
//   - 'control':低频控制消息(显示器列表/切换、剪贴板同步、文件完成回执)。
//   - 'file'   :文件传输(begin/end 为 JSON 文本帧,中间为二进制分片)。
// 'input' 频道仍专用于高频鼠标/键盘,避免与大块数据抢占。

/** control 频道上的消息(JSON)。 */
export type ControlMsg =
  | { t: 'screens'; screens: RdScreen[]; active: string }
  | { t: 'switchDisplay'; sourceId: string }
  | { t: 'clipboard'; text: string }
  | { t: 'file-done'; name: string }

export function sendControl(ch: RTCDataChannel | null, msg: ControlMsg): void {
  if (ch && ch.readyState === 'open') ch.send(JSON.stringify(msg))
}

// ---- 剪贴板同步 -------------------------------------------------------------

const CLIPBOARD_MAX = 1024 * 1024 // 超过 1MB 的剪贴板不同步(多为图片/大块数据)

function safeReadClipboard(): string {
  try {
    return window.api.clipboard.readText()
  } catch {
    return ''
  }
}

/**
 * 双向文本剪贴板同步。每侧各自轮询本机剪贴板,变化即经 control 频道推给对端;收到对端
 * 内容则写入本机剪贴板。用 lastSeen 抑制回声(应用远端内容后不会被轮询当作本地变更再发回)。
 */
export class ClipboardSync {
  private timer: ReturnType<typeof setInterval> | null = null
  private lastSeen = ''

  constructor(private send: (text: string) => void) {}

  start(): void {
    this.lastSeen = safeReadClipboard()
    this.timer = setInterval(() => {
      const cur = safeReadClipboard()
      if (cur && cur !== this.lastSeen && cur.length <= CLIPBOARD_MAX) {
        this.lastSeen = cur
        this.send(cur)
      }
    }, 1000)
  }

  applyRemote(text: string): void {
    if (text === this.lastSeen) return
    this.lastSeen = text
    try {
      window.api.clipboard.writeText(text)
    } catch {
      /* ignore */
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

// ---- 文件传输 ---------------------------------------------------------------

const CHUNK = 64 * 1024
const HIGH_WATER = 8 * 1024 * 1024
const LOW_WATER = 2 * 1024 * 1024

/** 发送一个文件:begin(JSON) → 若干二进制分片 → end(JSON)。带背压,避免撑爆发送缓冲。 */
export async function sendFile(
  ch: RTCDataChannel,
  file: File,
  onProgress: (sent: number, total: number) => void
): Promise<void> {
  ch.send(JSON.stringify({ t: 'begin', name: file.name, size: file.size }))
  const reader = file.stream().getReader()
  let sent = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    for (let off = 0; off < value.byteLength; off += CHUNK) {
      const slice = value.subarray(off, off + CHUNK)
      await drain(ch)
      ch.send(slice)
      sent += slice.byteLength
      onProgress(sent, file.size)
    }
  }
  ch.send(JSON.stringify({ t: 'end' }))
}

function drain(ch: RTCDataChannel): Promise<void> {
  if (ch.bufferedAmount < HIGH_WATER) return Promise.resolve()
  return new Promise((resolve) => {
    ch.bufferedAmountLowThreshold = LOW_WATER
    const handler = (): void => {
      ch.removeEventListener('bufferedamountlow', handler)
      resolve()
    }
    ch.addEventListener('bufferedamountlow', handler)
  })
}

/** 接收端:按 begin → 二进制分片 → end 重组文件。DataChannel 的 binaryType 需设为 'arraybuffer'。 */
export class FileReceiver {
  private name = ''
  private size = 0
  private chunks: Uint8Array[] = []
  private received = 0

  constructor(
    private onProgress: (name: string, received: number, size: number) => void,
    private onComplete: (name: string, data: ArrayBuffer) => void
  ) {}

  handle(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      const msg = JSON.parse(data) as { t: string; name?: string; size?: number }
      if (msg.t === 'begin') {
        this.name = msg.name ?? 'file'
        this.size = msg.size ?? 0
        this.chunks = []
        this.received = 0
      } else if (msg.t === 'end') {
        const buf = concat(this.chunks, this.received)
        this.onComplete(this.name, buf)
        this.chunks = []
        this.received = 0
      }
      return
    }
    const bytes = new Uint8Array(data)
    this.chunks.push(bytes)
    this.received += bytes.byteLength
    this.onProgress(this.name, this.received, this.size)
  }
}

function concat(chunks: Uint8Array[], total: number): ArrayBuffer {
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out.buffer
}
