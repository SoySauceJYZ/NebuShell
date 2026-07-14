/**
 * 把用户粘贴/选择的图片转成可直接发给模型的 data URL。
 *
 * 截图往往是 2K/4K 的大图,原样 base64 会让请求体膨胀到几 MB(还会挤占上下文),
 * 所以统一按最长边缩到 MAX_EDGE 以内;超过 JPEG_THRESHOLD 的再转成 JPEG。
 * 小图(图标、二维码等)保持原样,避免二次压缩糊掉细节。
 */

const MAX_EDGE = 1568
const JPEG_THRESHOLD = 400 * 1024
const MAX_IMAGES = 6

export const MAX_ATTACHED_IMAGES = MAX_IMAGES

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('无法解析该图片'))
    img.src = url
  })
}

export async function fileToDataUrl(file: File): Promise<string> {
  const original = await readAsDataUrl(file)

  // GIF 缩放会丢掉动画,SVG 交给模型也没意义 —— 原样传。
  if (file.type === 'image/gif') return original

  const img = await loadImage(original)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const needsJpeg = file.size > JPEG_THRESHOLD && file.type !== 'image/png'
  if (scale === 1 && !needsJpeg && file.size <= JPEG_THRESHOLD) return original

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.width * scale))
  canvas.height = Math.max(1, Math.round(img.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return original
  // JPEG 没有透明通道,先铺白底,免得 PNG 的透明区变成黑块。
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const out = canvas.toDataURL('image/jpeg', 0.85)
  return out.length < original.length ? out : original
}

/** 从粘贴/拖放事件里取出图片文件。 */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files).filter(isImageFile)
}

export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return []
  const files: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && isImageFile(file)) files.push(file)
  }
  return files
}
