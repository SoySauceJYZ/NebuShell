import type { LlmErrorInfo } from '@shared/types'

/**
 * LLM 请求失败的分类与展示文案。main 只负责把原始信息(HTTP 状态 / 响应体 / 网络错误码)
 * 原样带回来,怎么跟用户解释、给哪些补救按钮,全在这里决定。
 */

export type LlmErrorKind =
  'auth' | 'rate' | 'context' | 'model' | 'server' | 'network' | 'config' | 'unknown'

export interface AgentErrorView {
  kind: LlmErrorKind
  /** 一句话标题,例如「API Key 无效或无权限」。 */
  title: string
  /** 给用户的处理建议。 */
  hint: string
  /** 服务端返回的错误说明(从 JSON 里抠出来的 error.message),可能为空。 */
  reason: string
  /** 完整的原始信息(状态码 + 美化后的响应体),放在可折叠的「详细信息」里。 */
  detail: string
  /** 适合重试(网络抖动 / 限流 / 5xx)。 */
  retryable: boolean
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
])

const CONTEXT_RE =
  /context[_ ]length|maximum context|context window|too many tokens|token limit|prompt is too long|reduce the length|input is too long|超出.*(上下文|长度)/i
const QUOTA_RE = /insufficient[_ ]quota|quota|billing|余额|欠费|credit/i
const MODEL_RE = /model[_ ]not[_ ]found|does not exist|no such model|unknown model|模型不存在/i

/** 从响应体里抠出最像「错误说明」的那句话(兼容 OpenAI / 各家兼容网关的常见格式)。 */
function extractReason(body: string): string {
  const text = body.trim()
  if (!text) return ''
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const err = j.error
    if (typeof err === 'string') return err
    if (err && typeof err === 'object') {
      const m = (err as Record<string, unknown>).message
      if (typeof m === 'string') return m
    }
    for (const k of ['message', 'msg', 'detail', 'error_msg']) {
      if (typeof j[k] === 'string') return j[k] as string
    }
  } catch {
    // 不是 JSON:HTML 错误页之类,取第一行有意义的文字
  }
  const plain = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.slice(0, 200)
}

function prettyBody(body: string): string {
  const text = body.trim()
  if (!text) return ''
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export function classifyLlmError(info: LlmErrorInfo): AgentErrorView {
  const body = info.body ?? ''
  const reason = extractReason(body)
  const haystack = `${info.message}\n${reason}\n${body}`
  const status = info.status
  const detailParts = [
    status !== undefined ? `HTTP ${status}` : '',
    info.code ? `code: ${info.code}` : '',
    info.message,
    prettyBody(body)
  ].filter(Boolean)
  const base = { reason, detail: detailParts.join('\n') }

  if (info.code === 'NO_PROVIDER' || info.code === 'BAD_CONFIG') {
    return {
      ...base,
      kind: 'config',
      title: '模型未配置',
      hint: '请在「管理供应商 / 模型」里填写 Base URL、API Key 并选择模型。',
      reason: reason || info.message,
      retryable: false
    }
  }
  if (status === 401 || status === 403) {
    return {
      ...base,
      kind: 'auth',
      title: status === 401 ? 'API Key 无效或已过期' : '没有访问该模型的权限',
      hint: '检查供应商的 API Key 是否正确、是否仍有效,以及账号是否开通了该模型。',
      retryable: false
    }
  }
  if (status === 429 || (status === 402 && QUOTA_RE.test(haystack))) {
    const quota = QUOTA_RE.test(haystack)
    return {
      ...base,
      kind: 'rate',
      title: quota ? '额度不足' : '请求过于频繁(限流)',
      hint: quota ? '账户余额或配额已用尽,请充值或换一个供应商。' : '稍等片刻再重试,或换一个模型。',
      retryable: !quota
    }
  }
  if (CONTEXT_RE.test(haystack)) {
    return {
      ...base,
      kind: 'context',
      title: '上下文超出模型上限',
      hint: '会话太长了。可以新开一个会话(用 @ 引用本会话作为背景),或换一个上下文更大的模型。',
      retryable: false
    }
  }
  if (status === 404 || MODEL_RE.test(haystack)) {
    return {
      ...base,
      kind: 'model',
      title: status === 404 && !MODEL_RE.test(haystack) ? '接口地址不存在 (404)' : '模型不存在',
      hint: '检查 Base URL 是否正确(通常以 /v1 结尾),以及模型名称是否拼写正确。',
      retryable: false
    }
  }
  if (status !== undefined && status >= 500) {
    return {
      ...base,
      kind: 'server',
      title: `模型服务端出错 (${status})`,
      hint: '这通常是供应商临时故障,稍后重试即可。',
      retryable: true
    }
  }
  if (
    (info.code && NETWORK_CODES.has(info.code)) ||
    /fetch failed|network|socket|timed? ?out|ECONN|ENOTFOUND|certificate/i.test(info.message)
  ) {
    const cert = /cert/i.test(`${info.code ?? ''} ${info.message}`)
    return {
      ...base,
      kind: 'network',
      title: cert ? 'TLS 证书校验失败' : '无法连接到模型服务',
      hint: cert
        ? '服务端证书不受信任或已过期,检查 Base URL 是否使用了自签名证书。'
        : '检查网络、代理设置以及 Base URL 的主机名和端口是否正确。',
      reason: reason || info.message,
      retryable: true
    }
  }
  if (status === 400) {
    return {
      ...base,
      kind: 'unknown',
      title: '请求被模型服务拒绝 (400)',
      hint: '可能是该模型不支持工具调用 / 图片输入,或请求参数不兼容。',
      retryable: false
    }
  }
  return {
    ...base,
    kind: 'unknown',
    title: status !== undefined ? `请求失败 (${status})` : '请求失败',
    hint: '可以重试;若反复出现,请展开详细信息排查。',
    reason: reason || info.message,
    retryable: true
  }
}

/** 一行纯文本版(给远程桌面智能体这类只显示字符串的地方用)。 */
export function llmErrorText(info: LlmErrorInfo): string {
  const v = classifyLlmError(info)
  return v.reason && v.reason !== v.title ? `${v.title}:${v.reason}` : v.title
}
