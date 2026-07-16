// 极简 tar 实现(零依赖),供容器文件后端与 `docker cp` 的 tar 流对接:
// - 写方向:构造 ustar 头(超长路径自动降级为 GNU 'L' longname 条目)
// - 读方向:流式解析 docker cp 输出(GNU 格式:ustar prefix / 'L' longname / pax 头跳过)

const BLOCK = 512

function octal(value: number, width: number): Buffer {
  // 传统 octal 字段:width-1 位八进制 + NUL
  const s = Math.max(0, Math.floor(value)).toString(8).padStart(width - 1, '0')
  return Buffer.from(s.slice(0, width - 1) + '\0', 'ascii')
}

function buildHeaderBlock(
  name: string,
  size: number,
  opts: { dir?: boolean; mode?: number; mtime?: number; typeflag?: string } = {}
): Buffer {
  const buf = Buffer.alloc(BLOCK)
  buf.write(name.slice(0, 100), 0, 'utf8') // name
  octal(opts.mode ?? (opts.dir ? 0o755 : 0o644), 8).copy(buf, 100) // mode
  octal(0, 8).copy(buf, 108) // uid
  octal(0, 8).copy(buf, 116) // gid
  octal(size, 12).copy(buf, 124) // size
  octal(opts.mtime ?? Math.floor(Date.now() / 1000), 12).copy(buf, 136) // mtime
  buf.write('        ', 148, 'ascii') // chksum 占位(8 空格)
  buf.write(opts.typeflag ?? (opts.dir ? '5' : '0'), 156, 'ascii') // typeflag
  buf.write('ustar', 257, 'ascii') // magic
  buf.write('00', 263, 'ascii') // version
  let sum = 0
  for (const b of buf) sum += b
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  return buf
}

/**
 * 生成一个条目的头部块。路径超过 100 字节时,自动在前面插入 GNU 'L' longname 条目
 * (docker/GNU tar 均支持),因此返回值可能是 1~3 个 512B 块。
 */
export function tarHeader(
  name: string,
  size: number,
  opts: { dir?: boolean; mode?: number; mtime?: number } = {}
): Buffer {
  const nameBytes = Buffer.byteLength(name, 'utf8')
  if (nameBytes <= 100) return buildHeaderBlock(name, size, opts)
  // GNU longname:'L' 条目的数据区是完整路径(含结尾 NUL)
  const data = Buffer.concat([Buffer.from(name, 'utf8'), Buffer.from([0])])
  const lHeader = buildHeaderBlock('././@LongLink', data.length, { typeflag: 'L' })
  const padded = Buffer.alloc(padTo512(data.length))
  data.copy(padded)
  return Buffer.concat([lHeader, padded, buildHeaderBlock(name.slice(0, 100), size, opts)])
}

/** 数据区按 512 对齐后的总长度。 */
export function padTo512(size: number): number {
  return Math.ceil(size / BLOCK) * BLOCK
}

/** tar 结尾:两个全零块。 */
export const TAR_TRAILER = Buffer.alloc(BLOCK * 2)

export interface TarEntryMeta {
  name: string
  size: number
  type: 'file' | 'directory' | 'symlink' | 'other'
}

function parseOctal(buf: Buffer, off: number, len: number): number {
  // GNU base-256 大数格式(首字节 0x80)
  if (buf[off] & 0x80) {
    let v = 0
    for (let i = off + 1; i < off + len; i++) v = v * 256 + buf[i]
    return v
  }
  const s = buf.toString('ascii', off, off + len).replace(/\0.*$/, '').trim()
  return s ? parseInt(s, 8) : 0
}

function headerName(buf: Buffer): string {
  const name = buf.toString('utf8', 0, 100).replace(/\0.*$/, '')
  const prefix = buf.toString('utf8', 345, 500).replace(/\0.*$/, '')
  return prefix ? `${prefix}/${name}` : name
}

function typeOf(flag: string): TarEntryMeta['type'] {
  if (flag === '0' || flag === '\0' || flag === '') return 'file'
  if (flag === '5') return 'directory'
  if (flag === '2') return 'symlink'
  return 'other'
}

/**
 * 流式 tar 解析器。push() 喂入任意大小的 chunk;每个条目依次触发
 * onEntry → onData*(仅 file)→ onEntryEnd。目录/符号链接等无数据条目也会
 * 触发 onEntry/onEntryEnd(size 为 0 或被跳过)。
 */
export class TarExtractor {
  private buf: Buffer = Buffer.alloc(0)
  private state: 'header' | 'data' | 'skip' | 'longname' | 'done' = 'header'
  private remaining = 0 // 当前数据区剩余(含条目本体,不含 padding)
  private padding = 0
  private pendingLongname: string | null = null
  private zeroBlocks = 0

  constructor(
    private handlers: {
      onEntry: (meta: TarEntryMeta) => void
      onData: (chunk: Buffer) => void
      onEntryEnd: () => void
    }
  ) {}

  push(chunk: Buffer): void {
    if (this.state === 'done') return
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    this.drain()
  }

  finish(): void {
    this.state = 'done'
    this.buf = Buffer.alloc(0)
  }

  private drain(): void {
    for (;;) {
      if (this.state === 'done') return
      if (this.state === 'header') {
        if (this.buf.length < BLOCK) return
        const header = this.buf.subarray(0, BLOCK)
        this.buf = this.buf.subarray(BLOCK)
        if (header.every((b) => b === 0)) {
          if (++this.zeroBlocks >= 2) this.state = 'done'
          continue
        }
        this.zeroBlocks = 0
        const flag = header.toString('ascii', 156, 157)
        const size = parseOctal(header, 124, 12)
        this.remaining = size
        this.padding = padTo512(size) - size
        if (flag === 'L') {
          // GNU longname:数据区是下一个条目的完整路径
          this.state = 'longname'
          this.longnameBuf = []
        } else if (flag === 'x' || flag === 'g') {
          this.state = 'skip' // pax 扩展头:跳过(docker cp 的普通输出用不到其中信息)
        } else {
          const meta: TarEntryMeta = {
            name: this.pendingLongname ?? headerName(header),
            size,
            type: typeOf(flag)
          }
          this.pendingLongname = null
          this.handlers.onEntry(meta)
          if (meta.type === 'file' && size > 0) {
            this.state = 'data'
          } else {
            // 无数据条目(目录/symlink/空文件);非 file 类型若带数据则跳过
            if (size > 0) {
              this.state = 'skip'
              this.entryEndAfterSkip = true
              continue
            }
            this.handlers.onEntryEnd()
            this.state = 'header'
          }
        }
        continue
      }
      // data / skip / longname 都要消耗 remaining + padding
      if (this.buf.length === 0) return
      const want = this.remaining > 0 ? this.remaining : this.padding
      if (want === 0) {
        this.endOfData()
        continue
      }
      const take = Math.min(want, this.buf.length)
      const piece = this.buf.subarray(0, take)
      this.buf = this.buf.subarray(take)
      if (this.remaining > 0) {
        this.remaining -= take
        if (this.state === 'data') this.handlers.onData(piece)
        else if (this.state === 'longname') this.longnameBuf.push(Buffer.from(piece))
      } else {
        this.padding -= take
      }
      if (this.remaining === 0 && this.padding === 0) this.endOfData()
    }
  }

  private longnameBuf: Buffer[] = []
  private entryEndAfterSkip = false

  private endOfData(): void {
    if (this.state === 'data') {
      this.handlers.onEntryEnd()
    } else if (this.state === 'longname') {
      this.pendingLongname = Buffer.concat(this.longnameBuf)
        .toString('utf8')
        .replace(/\0.*$/, '')
      this.longnameBuf = []
    } else if (this.state === 'skip' && this.entryEndAfterSkip) {
      this.entryEndAfterSkip = false
      this.handlers.onEntryEnd()
    }
    this.state = 'header'
  }
}
