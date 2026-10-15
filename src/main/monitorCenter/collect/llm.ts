// 模型端点探测:本机直接 HTTP 访问 /v1/models 与 /metrics(SGLang 为 /v1/loads),
// 移植自 resource-monitor/server/collector.js。

export interface LlmEndpointConfig {
  id: string
  baseUrl: string
  chatPath: string
  /** 为空时以 /v1/models 返回的第一个模型为准。 */
  model: string
  engine: string
  enabled: boolean
  source: 'discovered' | 'manual'
  hostId?: string
  serviceId?: string
  /** 服务只监听 127.0.0.1,本机无法直连。 */
  localOnly?: boolean
}

export interface LlmMetrics {
  running: number | null
  waiting: number | null
  inputTokensPerMin: number | null
  outputTokensPerMin: number | null
  tps: number | null
  rpm: number | null
  errorRate: number | null
  ttftP95Ms: number | null
  p95Ms: number | null
  p99Ms: number | null
  kvCacheUsage: number | null
  cacheHitRate: number | null
  utilization: number | null
  activeTokens: number | null
  tokenCapacity: number | null
  maxRunningRequests: number | null
  engineVersion: string | null
  accelerator: string | null
  acceleratorCount: number | null
  promptTokensTotal: number | null
  generationTokensTotal: number | null
  requestsTotal: number | null
}

export const emptyLlmMetrics = (): LlmMetrics => ({
  running: null,
  waiting: null,
  inputTokensPerMin: null,
  outputTokensPerMin: null,
  tps: null,
  rpm: null,
  errorRate: null,
  ttftP95Ms: null,
  p95Ms: null,
  p99Ms: null,
  kvCacheUsage: null,
  cacheHitRate: null,
  utilization: null,
  activeTokens: null,
  tokenCapacity: null,
  maxRunningRequests: null,
  engineVersion: null,
  accelerator: null,
  acceleratorCount: null,
  promptTokensTotal: null,
  generationTokensTotal: null,
  requestsTotal: null
})

interface Sample {
  name: string
  labels: Record<string, string>
  value: number
}

type Buckets = Map<number, number>

interface Previous {
  sampledAt: number
  prompt: number | null
  generation: number | null
  requests: number | null
  failure: number | null
  ttft: Buckets
  e2e: Buckets
}

type EventFn = (level: 'info' | 'warn' | 'crit', id: string, name: string, msg: string) => void

const metricKey = (name: string): string => name.replace(/:/g, '_').replace(/^vllm_/, '')

function parsePrometheus(text: string): Sample[] {
  const samples: Sample[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line[0] === '#') continue
    const match = line.match(
      /^([^\s{]+)(?:\{((?:[^"\\]|\\.|"(?:[^"\\]|\\.)*")*)\})?\s+([^\s]+)(?:\s+\d+)?$/
    )
    if (!match) continue
    const value = Number(match[3])
    if (!Number.isFinite(value)) continue
    const labels: Record<string, string> = {}
    const re = /([a-zA-Z_][\w]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:,|$)/g
    let lm: RegExpExecArray | null
    while ((lm = re.exec(match[2] || ''))) {
      labels[lm[1]] = lm[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    samples.push({ name: metricKey(match[1]), labels, value })
  }
  return samples
}

const matching = (samples: Sample[], names: string[]): Sample[] =>
  samples.filter((s) => names.some((n) => s.name === n || s.name.endsWith(`_${n}`)))

function sumMetric(samples: Sample[], names: string[]): number | null {
  const found = matching(samples, names)
  return found.length ? found.reduce((sum, s) => sum + s.value, 0) : null
}
function lastMetric(samples: Sample[], names: string[]): number | null {
  const found = matching(samples, names)
  return found.length ? found[found.length - 1].value : null
}
function averageMetric(samples: Sample[], names: string[]): number | null {
  const found = matching(samples, names)
  // 比率类指标按每个 dp_rank 等权平均,避免将百分比直接相加。
  return found.length ? found.reduce((sum, s) => sum + s.value, 0) / found.length : null
}
function firstAvailableSum(samples: Sample[], names: string[]): number | null {
  for (const name of names) {
    const value = sumMetric(samples, [name])
    if (value !== null) return value
  }
  return null
}
const percentMetric = (v: number | null): number | null =>
  v === null ? null : v <= 1 ? v * 100 : v

function histogram(samples: Sample[], names: string[]): Buckets {
  const buckets: Buckets = new Map()
  for (const s of matching(
    samples,
    names.map((n) => `${n}_bucket`)
  )) {
    if (s.labels.le === undefined) continue
    const le = s.labels.le === '+Inf' ? Infinity : Number(s.labels.le)
    if (!Number.isNaN(le)) buckets.set(le, (buckets.get(le) || 0) + s.value)
  }
  return buckets
}
function deltaMap(current: Buckets, previous?: Buckets): Buckets {
  const result: Buckets = new Map()
  if (!previous) return result
  for (const [le, value] of current) {
    const old = previous.get(le)
    if (old !== undefined) result.set(le, value >= old ? value - old : value)
  }
  return result
}
function percentileMs(buckets: Buckets, percentile: number): number | null {
  if (!buckets.size) return null
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0])
  const total = sorted.find(([le]) => le === Infinity)?.[1] ?? sorted[sorted.length - 1][1]
  if (!(total > 0)) return null
  const target = total * percentile
  for (const [le, count] of sorted) {
    if (count >= target && Number.isFinite(le)) return le * 1000
  }
  return null
}
function counterDelta(value: number | null, previous: number | null | undefined): number | null {
  if (value === null || previous === null || previous === undefined) return null
  return value >= previous ? value - previous : value
}

async function fetchProbe(
  url: string,
  asJson: boolean
): Promise<{ data: unknown; elapsed: number }> {
  const started = Date.now()
  const response = await fetch(url, {
    signal: AbortSignal.timeout(3000),
    headers: { Accept: asJson ? 'application/json' : 'text/plain' }
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
  return {
    data: asJson ? await response.json() : await response.text(),
    elapsed: Date.now() - started
  }
}

const errText = (error: unknown): string => {
  const e = error as { name?: string; message?: string; cause?: { code?: string } }
  if (e?.name === 'TimeoutError') return '3秒超时'
  return [e?.message || String(error), e?.cause?.code].filter(Boolean).join(' · ')
}

export class LlmEndpoint {
  config: LlmEndpointConfig
  busy = false
  apiOnline = false
  modelMatched: boolean | null = null
  discoveredModels: string[] = []
  status: 'running' | 'degraded' | 'down' = 'degraded'
  sourceText = '等待首次探测'
  responseMs: number | null = null
  lastProbeAt: number | null = null
  lastModelsAt: number | null = null
  lastMetricsAt: number | null = null
  lastError: string | null = null
  successes = 0
  failures = 0
  consecutiveFailures = 0
  history: Record<string, unknown>[] = []
  previous: Previous | null = null
  sglangMeta: Partial<LlmMetrics> = {}
  metrics: LlmMetrics = emptyLlmMetrics()

  constructor(
    config: LlmEndpointConfig,
    private onEvent: EventFn
  ) {
    this.config = config
    if (config.localOnly) {
      this.status = 'down'
      this.sourceText = '本机不可直连'
      this.lastError = '服务只监听 127.0.0.1,本机无法直接访问该端口'
    }
  }

  get label(): string {
    return this.config.model || this.config.baseUrl
  }

  private get isSglang(): boolean {
    return this.config.engine.trim().toLowerCase() === 'sglang'
  }

  private setStatus(status: LlmEndpoint['status'], message?: string): void {
    const old = this.status
    this.status = status
    if (old !== 'running' && status === 'running') {
      this.onEvent('info', this.config.id, this.label, `模型端点恢复：${this.config.baseUrl}`)
    } else if (old !== 'down' && status === 'down') {
      this.onEvent(
        'crit',
        this.config.id,
        this.label,
        `模型端点离线：${this.config.baseUrl}${message ? ` · ${message}` : ''}`
      )
    }
  }

  private recordFailure(kind: string, error: unknown): void {
    this.failures++
    this.lastProbeAt = Date.now()
    this.lastError = `${kind}: ${errText(error)}`
    if (kind === 'models') {
      this.apiOnline = false
      this.consecutiveFailures++
      this.setStatus(this.consecutiveFailures >= 3 ? 'down' : 'degraded', this.lastError)
    } else {
      this.sourceText = this.apiOnline ? '仅 API 健康检查（metrics 不可用）' : 'metrics 不可用'
      if (this.apiOnline) this.setStatus('degraded')
      else {
        this.consecutiveFailures++
        this.setStatus(this.consecutiveFailures >= 3 ? 'down' : 'degraded', this.lastError)
      }
    }
  }

  private async probeSglangMetadata(): Promise<void> {
    try {
      const { data } = await fetchProbe(`${this.config.baseUrl}/v1/loads`, true)
      const d = data as Record<string, unknown>
      this.sglangMeta = {
        engineVersion: (d?.version as string) ?? null,
        accelerator: (d?.accelerator as string) ?? null,
        acceleratorCount: Number.isFinite(Number(d?.num_accelerators))
          ? Number(d.num_accelerators)
          : null
      }
    } catch {
      // 元信息是低频增强数据,失败不影响 API 和指标健康状态。
    }
  }

  private async probeModels(): Promise<void> {
    try {
      const result = await fetchProbe(`${this.config.baseUrl}/v1/models`, true)
      const list = (result.data as { data?: { id?: string }[]; models?: { name?: string }[] }) || {}
      const ids = Array.isArray(list.data)
        ? list.data.map((x) => String(x?.id || '')).filter(Boolean)
        : []
      if (!this.config.model && ids.length) this.config.model = ids[0]
      this.apiOnline = true
      this.modelMatched = ids.includes(this.config.model)
      this.discoveredModels = ids
      this.responseMs = result.elapsed
      this.lastModelsAt = Date.now()
      this.lastProbeAt = this.lastModelsAt
      this.successes++
      this.consecutiveFailures = 0
      this.lastError = this.modelMatched
        ? null
        : `配置模型别名未匹配；端点返回：${ids.join(', ') || '空列表'}`
      if (!this.modelMatched) this.sourceText = 'API 在线（模型别名未匹配）'
      this.setStatus(this.modelMatched === false ? 'degraded' : 'running')
      if (this.isSglang) await this.probeSglangMetadata()
    } catch (error) {
      this.recordFailure('models', error)
    }
  }

  private parseSglang(samples: Sample[]): void {
    const throughput = sumMetric(samples, ['gen_throughput'])
    this.metrics = {
      ...emptyLlmMetrics(),
      running: sumMetric(samples, ['num_running_reqs']),
      waiting: sumMetric(samples, ['num_waiting_reqs']),
      outputTokensPerMin: throughput === null ? null : throughput * 60,
      tps: throughput,
      kvCacheUsage: percentMetric(averageMetric(samples, ['token_usage'])),
      cacheHitRate: percentMetric(averageMetric(samples, ['cache_hit_rate'])),
      utilization: percentMetric(averageMetric(samples, ['utilization'])),
      activeTokens: firstAvailableSum(samples, ['num_active_tokens', 'num_used_tokens']),
      tokenCapacity: firstAvailableSum(samples, ['memory_token_capacity', 'max_total_num_tokens']),
      maxRunningRequests: sumMetric(samples, ['max_running_requests']),
      ...this.sglangMeta
    }
  }

  private parseMetrics(samples: Sample[], sampledAt: number): void {
    const prompt = sumMetric(samples, ['prompt_tokens_total'])
    const generation = sumMetric(samples, ['generation_tokens_total'])
    let success = sumMetric(samples, ['request_success_total'])
    let failure = sumMetric(samples, ['request_failure_total'])
    const finished = matching(samples, ['finished_reason', 'finished_reason_total'])
    const failedReason = (s: Sample): boolean =>
      /fail|error|abort/i.test(s.labels.reason || s.labels.finished_reason || '')
    if (success === null && finished.length) {
      success = finished.filter((s) => !failedReason(s)).reduce((a, s) => a + s.value, 0)
    }
    if (failure === null && finished.length) {
      const failed = finished.filter(failedReason)
      failure = failed.length ? failed.reduce((a, s) => a + s.value, 0) : null
    }
    const requests = success === null && failure === null ? null : (success || 0) + (failure || 0)
    const ttft = histogram(samples, ['time_to_first_token_seconds'])
    const e2e = histogram(samples, ['e2e_request_latency_seconds'])
    const previous = this.previous
    const seconds = previous ? (sampledAt - previous.sampledAt) / 1000 : 0
    const promptDelta = previous ? counterDelta(prompt, previous.prompt) : null
    const generationDelta = previous ? counterDelta(generation, previous.generation) : null
    const requestDelta = previous ? counterDelta(requests, previous.requests) : null
    const failureDelta = previous ? counterDelta(failure, previous.failure) : null
    const intervalTtft = deltaMap(ttft, previous?.ttft)
    const intervalE2e = deltaMap(e2e, previous?.e2e)
    const valid = seconds > 0
    const cache = lastMetric(samples, ['gpu_cache_usage_perc', 'kv_cache_usage_perc'])
    this.metrics = {
      ...emptyLlmMetrics(),
      running: sumMetric(samples, ['num_requests_running']),
      waiting: sumMetric(samples, ['num_requests_waiting']),
      inputTokensPerMin: valid && promptDelta !== null ? (promptDelta / seconds) * 60 : null,
      outputTokensPerMin:
        valid && generationDelta !== null ? (generationDelta / seconds) * 60 : null,
      tps: valid && generationDelta !== null ? generationDelta / seconds : null,
      rpm: valid && requestDelta !== null ? (requestDelta / seconds) * 60 : null,
      errorRate:
        requestDelta !== null && requestDelta > 0 && failureDelta !== null
          ? (failureDelta / requestDelta) * 100
          : null,
      ttftP95Ms: percentileMs(intervalTtft, 0.95),
      p95Ms: percentileMs(intervalE2e, 0.95),
      p99Ms: percentileMs(intervalE2e, 0.99),
      kvCacheUsage: cache === null ? null : cache <= 1 ? cache * 100 : cache,
      promptTokensTotal: prompt,
      generationTokensTotal: generation,
      requestsTotal: requests
    }
    this.previous = { sampledAt, prompt, generation, requests, failure, ttft, e2e }
  }

  private async probeMetrics(): Promise<void> {
    const sglang = this.isSglang
    const path = sglang ? '/v1/loads?format=prometheus' : '/metrics'
    try {
      const result = await fetchProbe(`${this.config.baseUrl}${path}`, false)
      const sampledAt = Date.now()
      const samples = parsePrometheus(String(result.data))
      if (sglang) this.parseSglang(samples)
      else this.parseMetrics(samples, sampledAt)
      this.responseMs = result.elapsed
      this.lastMetricsAt = sampledAt
      this.lastProbeAt = sampledAt
      this.successes++
      this.sourceText = sglang ? 'SGLang /v1/loads' : 'Prometheus /metrics'
      if (sglang) this.apiOnline = true
      if (sglang || (this.apiOnline && this.modelMatched !== false)) {
        this.lastError = null
        this.consecutiveFailures = 0
        this.setStatus('running')
      } else this.setStatus('degraded')
      this.history.push({ t: sampledAt, status: this.status, ...this.metrics })
    } catch (error) {
      this.recordFailure(sglang ? 'SGLang loads' : 'metrics', error)
      this.history.push({ t: Date.now(), status: this.status, ...emptyLlmMetrics() })
    }
    if (this.history.length > 360) this.history.shift()
  }

  async probe(includeModels: boolean): Promise<void> {
    if (this.busy || this.config.localOnly || !this.config.enabled) return
    this.busy = true
    try {
      if (includeModels) await this.probeModels()
      await this.probeMetrics()
    } finally {
      this.busy = false
    }
  }

  view(): Record<string, unknown> {
    return {
      id: this.config.id,
      baseUrl: this.config.baseUrl,
      chatPath: this.config.chatPath,
      model: this.config.model || '(未知模型)',
      engine: this.config.engine,
      cost: { input: 0, output: 0 },
      status: this.status,
      apiOnline: this.apiOnline,
      modelMatched: this.modelMatched,
      discoveredModels: this.discoveredModels,
      source: this.sourceText,
      responseMs: this.responseMs,
      lastProbeAt: this.lastProbeAt,
      lastModelsAt: this.lastModelsAt,
      lastMetricsAt: this.lastMetricsAt,
      lastError: this.lastError,
      successes: this.successes,
      failures: this.failures,
      metrics: this.metrics,
      hostId: this.config.hostId,
      origin: this.config.source
    }
  }
}
