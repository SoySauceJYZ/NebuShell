/**
 * 把用户粘贴/拖入/选择的文档抽成文本,再喂给模型。
 *
 * 没有哪个 OpenAI 兼容端点能直接消化 docx,PDF 的原生通道也只有少数厂商支持,
 * 所以统一在渲染进程抽成纯文本(PDF 逐页取文本层,docx 转 Markdown)。
 *
 * 抽完的全文不会整段塞进上下文 —— 消息里只带一段有界的 preview,完整文本按 ref 留在
 * 内存 LRU 里,模型需要更多时用 read_attachment 按需检索。和命令输出(commandOutput.ts)
 * 是同一套机制,行切片逻辑也直接复用那边的 sliceLines。
 */

import type { Attachment, AttachmentKind } from '@shared/types'
import * as pdfjs from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'
import mammoth from 'mammoth/mammoth.browser'
import { sliceLines, type ReadOptions } from './commandOutput'

// pdfjs 必须在 worker 里跑,否则大文件会卡死 UI 线程。Vite 的 ?worker 导入负责打包。
pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()

const MAX_ATTACHMENTS = 5
const MAX_DOC_BYTES = 20 * 1024 * 1024
/** 进上下文的预览上限(≈2k token);超出的部分靠 read_attachment 取。 */
const PREVIEW_CHARS = 8000
/** 平均每页字符数低于此值,基本可以断定是没有文本层的扫描件。 */
const MIN_CHARS_PER_PAGE = 20
/** 完整文本的内存缓存条数上限。 */
const STORE_CAP = 30

export const MAX_ATTACHED_DOCS = MAX_ATTACHMENTS

// 纯文本类:按扩展名放行(浏览器给的 file.type 对 .log/.conf/.yaml 之流基本是空的)。
const TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'log',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'env',
  'csv',
  'tsv',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'sql',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'pl',
  'lua',
  'swift',
  'dockerfile',
  'gitignore',
  'service',
  'properties',
  'patch',
  'diff'
])

const DOC_EXTS = new Set([...TEXT_EXTS, 'pdf', 'docx'])

/** 供 <input accept> 用。 */
export const DOC_ACCEPT = [...DOC_EXTS].map((e) => `.${e}`).join(',')

function extOf(name: string): string {
  const base = name.toLowerCase()
  const dot = base.lastIndexOf('.')
  // Dockerfile / Makefile 这类没有扩展名的,用整个文件名当扩展名去匹配。
  return dot === -1 ? base : base.slice(dot + 1)
}

export function isDocFile(file: File): boolean {
  return !file.type.startsWith('image/') && DOC_EXTS.has(extOf(file.name))
}

/** 从拖放事件里取出文档(图片交给 images.ts,两者在同一个 drop 里各取所需)。 */
export function docFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files).filter(isDocFile)
}

export function docFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && isDocFile(file)) files.push(file)
  }
  return files
}

// ---- 抽取 --------------------------------------------------------------------

interface Extracted {
  kind: AttachmentKind
  text: string
  pages?: number
}

function decodeText(buf: ArrayBuffer, name: string): string {
  const bytes = new Uint8Array(buf)
  // 二进制嗅探:文本文件里不该出现 NUL。只看开头一段就够了。
  const probe = bytes.subarray(0, 8192)
  if (probe.includes(0)) {
    throw new Error(`${name} 看起来是二进制文件,无法作为文本读取。`)
  }
  const text = new TextDecoder('utf-8').decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * 浏览器「打印成 PDF」生成的文件,ToUnicode 表常把汉字映射到「康熙部首」和「CJK 部首补充」
 * 两个区的同形字符(口 U+53E3 → ⼝ U+2F1D,页 U+9875 → ⻚ U+2EDA)。肉眼一模一样,但码位不同,
 * 模型认不出、grep 也命中不了。这里把它们折回正常汉字。
 *
 * 映射取自 Unicode 官方的 CJKRadicals.txt(部首字符 → 由该部首独立构成的统一汉字)。
 * NFKC 只覆盖康熙区,补充区(⻚⻋⻔⻢ 这些简体常用字)没有兼容映射,所以必须用显式表。
 */
const RADICAL_SRC =
  '⼀⼁⼂⼃⼄⼅⼆⼇⼈⼉⼊⼋⼌⼍⼎⼏⼐⼑⼒⼓⼔⼕⼖⼗⼘⼙⼚⼛⼜⼝⼞⼟⼠⼡⼢⼣⼤⼥⼦⼧⼨⼩⼪⼫⼬⼭⼮⼯⼰⼱⼲⼳⼴⼵⼶⼷⼸⼹⼺⼻⼼⼽⼾⼿⽀⽁⽂⽃⽄⽅⽆⽇⽈⽉⽊⽋⽌⽍⽎⽏⽐⽑⽒⽓⽔⽕⽖⽗⽘⽙⺦⽚⽛⽜⽝⽞⽟⽠⽡⽢⽣⽤⽥⽦⽧⽨⽩⽪⽫⽬⽭⽮⽯⽰⽱⽲⽳⽴⽵⽶⽷⺰⽸⽹⽺⽻⽼⽽⽾⽿⾀⾁⾂⾃⾄⾅⾆⾇⾈⾉⾊⾋⾌⾍⾎⾏⾐⾑⾒⻅⾓⾔⻈⾕⾖⾗⾘⾙⻉⾚⾛⾜⾝⾞⻋⾟⾠⾡⾢⾣⾤⾥⾦⻐⾧⻓⾨⻔⾩⾪⾫⾬⾭⾮⾯⾰⾱⻙⾲⾳⾴⻚⾵⻛⾶⻜⾷⻠⾸⾹⾺⻢⾻⾼⾽⾾⾿⿀⿁⿂⻥⿃⻦⿄⻧⿅⿆⻨⿇⿈⻩⿉⿊⿋⿌⻪⿍⿎⿏⿐⿑⻬⻫⿒⻮⻭⿓⻰⻯⿔⻳⻲⿕'
const RADICAL_UNIFIED =
  '一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿丬片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸纟缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見见角言讠谷豆豕豸貝贝赤走足身車车辛辰辵邑酉釆里金钅長长門门阜隶隹雨靑非面革韋韦韭音頁页風风飛飞食饣首香馬马骨高髟鬥鬯鬲鬼魚鱼鳥鸟鹵卤鹿麥麦麻黃黄黍黑黹黽黾鼎鼓鼠鼻齊齐斉齒齿歯龍龙竜龜龟亀龠'

const RADICAL_MAP = new Map([...RADICAL_SRC].map((c, i) => [c, [...RADICAL_UNIFIED][i]]))

function normalizeRadicals(text: string): string {
  return text.replace(/[⺀-⻳⼀-⿕]/g, (c) => RADICAL_MAP.get(c) ?? c)
}

async function extractPdf(buf: ArrayBuffer, name: string): Promise<Extracted> {
  const task = pdfjs.getDocument({ data: new Uint8Array(buf) })
  const doc = await task.promise
  try {
    const parts: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      let line = ''
      const lines: string[] = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        line += item.str
        if (item.hasEOL) {
          lines.push(line)
          line = ''
        }
      }
      if (line) lines.push(line)
      parts.push(`--- 第 ${p} 页 ---\n${normalizeRadicals(lines.join('\n').trim())}`)
      page.cleanup()
    }
    const text = parts.join('\n\n')
    // 扫描件没有文本层,抽出来只有零星的页眉页脚。与其给模型一份空文档,不如直说。
    const meaningful = text.replace(/--- 第 \d+ 页 ---/g, '').replace(/\s/g, '').length
    if (meaningful < doc.numPages * MIN_CHARS_PER_PAGE) {
      throw new Error(
        `${name} 似乎是扫描版 PDF(没有文本层),无法提取文字。可以改为截图后作为图片附加。`
      )
    }
    return { kind: 'pdf', text, pages: doc.numPages }
  } finally {
    void task.destroy()
  }
}

/**
 * docx → Markdown。
 *
 * 不用 mammoth 自带的 convertToMarkdown:它会把表格拍平成一串独立段落,行列关系全丢
 * (一张「参数 / 值」配置表就此报废)。改成走它的 HTML 输出,再自己转 Markdown ——
 * 渲染进程里有 DOMParser,不必上正则解析 HTML。
 */
function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const inline = (el: Node): string => {
    if (el.nodeType === Node.TEXT_NODE) return el.textContent ?? ''
    if (!(el instanceof HTMLElement)) return ''
    const inner = Array.from(el.childNodes).map(inline).join('')
    switch (el.tagName) {
      case 'STRONG':
      case 'B':
        return inner.trim() ? `**${inner}**` : ''
      case 'EM':
      case 'I':
        return inner.trim() ? `*${inner}*` : ''
      case 'CODE':
        return `\`${inner}\``
      case 'A': {
        const href = el.getAttribute('href')
        return href ? `[${inner}](${href})` : inner
      }
      case 'BR':
        return ' '
      case 'IMG':
        return '' // 图片对模型没意义,而且 mammoth 默认把它塞成巨大的 base64
      default:
        return inner
    }
  }

  const cell = (td: Element): string => inline(td).replace(/\|/g, '\\|').trim()

  const table = (el: HTMLTableElement): string => {
    const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
      Array.from(tr.children).map((td) => cell(td))
    )
    if (rows.length === 0) return ''
    const width = Math.max(...rows.map((r) => r.length))
    const pad = (r: string[]): string =>
      `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`
    // docx 的表格未必有表头行,统一把第一行当表头 —— Markdown 表格没有无表头的写法。
    return [
      pad(rows[0]),
      `| ${Array(width).fill('---').join(' | ')} |`,
      ...rows.slice(1).map(pad)
    ].join('\n')
  }

  const block = (el: Element, depth = 0): string => {
    switch (el.tagName) {
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        return `${'#'.repeat(Number(el.tagName[1]))} ${inline(el).trim()}`
      case 'P':
        return inline(el).trim()
      case 'PRE':
        return `\`\`\`\n${el.textContent ?? ''}\n\`\`\``
      case 'UL':
      case 'OL': {
        const ordered = el.tagName === 'OL'
        return Array.from(el.children)
          .filter((li) => li.tagName === 'LI')
          .map((li, i) => {
            // 嵌套列表作为 li 的子元素出现,递归处理并缩进。
            const nested = Array.from(li.children).filter(
              (c) => c.tagName === 'UL' || c.tagName === 'OL'
            )
            const own = Array.from(li.childNodes)
              .filter((c) => !nested.includes(c as Element))
              .map(inline)
              .join('')
              .trim()
            const marker = ordered ? `${i + 1}.` : '-'
            const head = `${'  '.repeat(depth)}${marker} ${own}`
            const sub = nested.map((n) => block(n, depth + 1)).filter(Boolean)
            return [head, ...sub].join('\n')
          })
          .join('\n')
      }
      case 'TABLE':
        return table(el as HTMLTableElement)
      default:
        return inline(el).trim()
    }
  }

  return Array.from(doc.body.children)
    .map((el) => block(el))
    .filter((s) => s.trim())
    .join('\n\n')
}

async function extractFile(file: File): Promise<Extracted> {
  if (file.size > MAX_DOC_BYTES) {
    throw new Error(`${file.name} 超过 ${MAX_DOC_BYTES / 1024 / 1024}MB,过大无法附加。`)
  }
  const ext = extOf(file.name)
  if (ext === 'doc') {
    throw new Error('旧版 .doc 是二进制格式,暂不支持。请用 Word 另存为 .docx 后再试。')
  }
  const buf = await file.arrayBuffer()
  if (ext === 'pdf') return extractPdf(buf, file.name)
  if (ext === 'docx') {
    // 走 HTML 再自己转 Markdown(见 htmlToMarkdown):保住表格的行列结构。
    const { value } = await mammoth.convertToHtml({ arrayBuffer: buf })
    const md = htmlToMarkdown(value).trim()
    if (!md) throw new Error(`${file.name} 没有可提取的文字内容。`)
    return { kind: 'docx', text: md }
  }
  if (TEXT_EXTS.has(ext)) {
    const text = decodeText(buf, file.name)
    if (!text.trim()) throw new Error(`${file.name} 是空文件。`)
    return { kind: 'text', text }
  }
  throw new Error(`不支持的文件类型 .${ext}。目前支持:文本/代码/日志、PDF、docx。`)
}

// ---- 全文缓存(只在内存,不进模型、不进持久化) ------------------------------

const store = new Map<string, { name: string; text: string }>()

function shortRef(): string {
  let r = ''
  do {
    r = Math.random().toString(36).slice(2, 8)
  } while (store.has(r))
  return r
}

/** 按需检索附件全文(grep / 头 / 尾 / 行号区间),与 read_command_output 同构。 */
export function readSavedAttachment(ref: string, opts: ReadOptions): string {
  const saved = store.get(ref)
  if (!saved) {
    return `未找到 #${ref} 对应的附件(可能已被新附件挤出缓存)。如仍需要,请让用户重新附加该文件。`
  }
  const { text, hit, total, desc } = sliceLines(saved.text, opts)
  return `#${ref} ${saved.name} 检索结果${desc ? `(${desc})` : ''} · 命中 ${hit}/${total} 行\n${text}`
}

/** 抽取一个文件并登记全文,返回随消息走的轻量 Attachment。 */
export async function buildAttachment(file: File): Promise<Attachment> {
  const { kind, text, pages } = await extractFile(file)

  const ref = shortRef()
  store.set(ref, { name: file.name, text })
  while (store.size > STORE_CAP) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }

  const truncated = text.length > PREVIEW_CHARS
  return {
    id: ref,
    name: file.name,
    kind,
    size: file.size,
    chars: text.length,
    ...(pages ? { pages } : {}),
    preview: truncated ? text.slice(0, PREVIEW_CHARS) : text,
    truncated
  }
}

/** 取回附件全文,供 UI 预览(取不到时回落到 preview)。 */
export function attachmentFullText(a: Attachment): string {
  return store.get(a.id)?.text ?? a.preview
}
