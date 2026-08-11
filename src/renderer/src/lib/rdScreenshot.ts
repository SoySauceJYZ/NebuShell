// 从远程桌面的 <video>(被控屏解码帧)抓一帧,降采样后转 JPEG data URL,喂给视觉模型。
// 返回的 w/h 是「喂给模型的图片尺寸」——Agent 的坐标就以此为参照,再由控制端归一化后注入。

export interface Frame {
  /** data:image/jpeg;base64,... */
  dataUrl: string
  /** 降采样后的图片宽高(= 模型看到的坐标空间)。 */
  w: number
  h: number
}

/**
 * 抓取当前视频帧。maxEdge 限制长边(默认 1280),兼顾定位精度与 token 开销。
 * 视频未就绪(videoWidth 为 0)时返回 null。
 */
export function captureFrame(video: HTMLVideoElement | null, maxEdge = 1280): Frame | null {
  if (!video || !video.videoWidth || !video.videoHeight) return null
  const vw = video.videoWidth
  const vh = video.videoHeight
  const scale = Math.min(1, maxEdge / Math.max(vw, vh))
  const w = Math.round(vw * scale)
  const h = Math.round(vh * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, w, h)
  try {
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.7), w, h }
  } catch {
    // 跨源污染等极端情况(这里视频来自本地 WebRTC,一般不会发生)。
    return null
  }
}
