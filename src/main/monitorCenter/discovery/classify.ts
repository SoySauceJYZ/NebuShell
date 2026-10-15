// 依据进程名 / 命令行 / 镜像名识别服务类型,并抽取模型服务的关键参数。
import type { McCategory } from '../../../shared/monitorCenter'

interface Rule {
  kind: string
  category: McCategory
  /** 匹配可执行文件名 / comm / 镜像名(小写)。 */
  exe?: RegExp
  /** 匹配完整命令行(小写)——只给不会误伤其它进程参数的特征串用。 */
  args?: RegExp
}

// 顺序即优先级:模型服务与网关要排在通用的 python / node / java 之前。
const RULES: Rule[] = [
  {
    kind: 'vllm',
    category: 'llm',
    exe: /\bvllm\b|vllm-openai/,
    args: /\bvllm serve\b|vllm\.entrypoints/
  },
  {
    kind: 'sglang',
    category: 'llm',
    exe: /\bsglang\b/,
    args: /sglang\.launch_server|\bsglang serve\b/
  },
  { kind: 'ollama', category: 'llm', exe: /\bollama\b/ },
  { kind: 'lmdeploy', category: 'llm', exe: /\blmdeploy\b/, args: /lmdeploy serve/ },
  { kind: 'tgi', category: 'llm', exe: /text-generation-(launcher|router|inference)/ },
  { kind: 'tei', category: 'llm', exe: /text-embeddings-(router|inference)/ },
  { kind: 'triton', category: 'llm', exe: /tritonserver/ },
  {
    kind: 'xinference',
    category: 'llm',
    exe: /\bxinference/,
    args: /\bxinference(-local|-supervisor|-worker)?\b/
  },
  { kind: 'llama.cpp', category: 'llm', exe: /llama-server|llama\.cpp/, args: /llama_cpp\.server/ },
  { kind: 'localai', category: 'llm', exe: /\blocal-?ai\b/ },
  { kind: 'fastchat', category: 'llm', args: /fastchat\.serve/ },
  { kind: 'mindie', category: 'llm', exe: /mindie/ },

  { kind: 'openresty', category: 'gateway', exe: /\bopenresty\b/ },
  { kind: 'tengine', category: 'gateway', exe: /\btengine\b/ },
  { kind: 'nginx', category: 'gateway', exe: /\bnginx\b/ },
  { kind: 'caddy', category: 'gateway', exe: /\bcaddy\b/ },
  { kind: 'haproxy', category: 'gateway', exe: /\bhaproxy\b/ },
  { kind: 'traefik', category: 'gateway', exe: /\btraefik\b/ },
  { kind: 'envoy', category: 'gateway', exe: /\benvoy\b/ },
  { kind: 'apisix', category: 'gateway', exe: /\bapisix\b/ },
  { kind: 'kong', category: 'gateway', exe: /\bkong\b/ },

  { kind: 'mysql', category: 'data', exe: /\bmysqld?\b|\bmariadbd?\b|percona/ },
  {
    kind: 'postgres',
    category: 'data',
    exe: /\bpostgres(ql)?\b|\bpostmaster\b|pgvector|timescale/
  },
  { kind: 'redis', category: 'data', exe: /\bredis-server\b|\bredis\b|\bvalkey/ },
  { kind: 'memcached', category: 'data', exe: /\bmemcached\b/ },
  { kind: 'mongodb', category: 'data', exe: /\bmongod\b|\bmongo\b|mongodb/ },
  {
    kind: 'elasticsearch',
    category: 'data',
    exe: /elasticsearch|opensearch/,
    args: /org\.elasticsearch\.bootstrap|org\.opensearch\.bootstrap/
  },
  { kind: 'clickhouse', category: 'data', exe: /clickhouse/ },
  { kind: 'milvus', category: 'data', exe: /\bmilvus\b/ },
  { kind: 'qdrant', category: 'data', exe: /\bqdrant\b/ },
  { kind: 'weaviate', category: 'data', exe: /\bweaviate\b/ },
  { kind: 'chroma', category: 'data', exe: /\bchroma(db)?\b/ },
  { kind: 'minio', category: 'data', exe: /\bminio\b/ },
  { kind: 'etcd', category: 'data', exe: /\betcd\b/ },
  { kind: 'influxdb', category: 'data', exe: /\binfluxd?\b/ },
  { kind: 'tdengine', category: 'data', exe: /\btaosd\b|tdengine/ },
  { kind: 'kafka', category: 'data', exe: /\bkafka\b/, args: /kafka\.kafka\b/ },
  { kind: 'rabbitmq', category: 'data', exe: /rabbitmq/, args: /rabbitmq_server|-s rabbit\b/ },
  { kind: 'nats', category: 'data', exe: /\bnats-server\b|\bnats\b/ },
  { kind: 'emqx', category: 'data', exe: /\bemqx\b/ },
  { kind: 'rocketmq', category: 'data', exe: /rocketmq/, args: /org\.apache\.rocketmq/ },
  { kind: 'zookeeper', category: 'data', exe: /zookeeper/, args: /org\.apache\.zookeeper\.server/ },
  {
    kind: 'nacos',
    category: 'data',
    exe: /\bnacos\b/,
    args: /nacos-server\.jar|com\.alibaba\.nacos/
  },

  { kind: 'dify', category: 'app', exe: /langgenius|\bdify\b/ },
  { kind: 'open-webui', category: 'app', exe: /open-webui/, args: /\bopen_webui\b/ },
  { kind: 'ragflow', category: 'app', exe: /ragflow/ },
  { kind: 'fastgpt', category: 'app', exe: /fastgpt/ },
  { kind: 'one-api', category: 'app', exe: /\bone-api\b|\bnew-api\b/ },
  { kind: 'litellm', category: 'app', exe: /litellm/, args: /\blitellm\b/ },
  { kind: 'n8n', category: 'app', exe: /\bn8n\b/ },
  { kind: 'grafana', category: 'app', exe: /grafana/ },
  { kind: 'prometheus', category: 'app', exe: /\bprometheus\b/ },
  { kind: 'gitlab', category: 'app', exe: /gitlab/ },
  { kind: 'jenkins', category: 'app', exe: /jenkins/, args: /jenkins\.war/ },
  { kind: 'harbor', category: 'app', exe: /goharbor|\bharbor/ },
  { kind: 'tomcat', category: 'app', args: /org\.apache\.catalina/ },
  { kind: 'php-fpm', category: 'app', exe: /php-fpm/ },
  { kind: 'java', category: 'app', exe: /^java\b|\bjava\b/ },
  {
    kind: 'python',
    category: 'app',
    exe: /\bpython[\d.]*\b|uvicorn|gunicorn|hypercorn|uwsgi|celery/
  },
  { kind: 'node', category: 'app', exe: /^node\b|\bnode\b|\bpm2\b|next-server/ }
]

const INFRA =
  /^(sshd|systemd[\w-]*|chronyd|ntpd|rpcbind|rpc\.\w+|dnsmasq|cupsd|avahi-daemon|master|exim4?|sendmail|containerd[\w-]*|dockerd|docker-proxy|kubelet|kube-proxy|snmpd|zabbix_agent[d2]?|node_exporter|xrdp[\w-]*|xinetd|vsftpd|smbd|nmbd|rsyslogd|cockpit[\w-]*|tailscaled|zerotier-one|frpc|frps|sunloginclient|teamviewerd|gdm[\w-]*|Xorg|nvidia-persistenced|polkitd|dbus[\w-]*|named|systemd-resolve|sd-pam|agetty|cron|crond|irqbalance|udisksd|multipathd|ModemManager|NetworkManager|wpa_supplicant|colord|rtkit-daemon)$/

export interface Classified {
  kind: string
  category: McCategory
}

const exeName = (args: string): string => {
  const first = args.trim().split(/\s+/)[0] || ''
  return first.split('/').pop() || ''
}

export function classify(comm: string, args: string, image = ''): Classified {
  if (!image && INFRA.test(comm)) return { kind: comm, category: 'infra' }
  const exe = `${comm} ${exeName(args)} ${image}`.toLowerCase()
  const a = args.toLowerCase()
  for (const rule of RULES) {
    if ((rule.exe && rule.exe.test(exe)) || (rule.args && rule.args.test(a))) {
      return { kind: rule.kind, category: rule.category }
    }
  }
  return { kind: comm || 'app', category: 'app' }
}

// ---------- 命令行解析 ----------

export function tokenize(args: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(args))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

function flag(tokens: string[], names: string[]): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    for (const n of names) {
      if (t === n && i + 1 < tokens.length) return tokens[i + 1]
      if (t.startsWith(`${n}=`)) return t.slice(n.length + 1)
    }
  }
  return undefined
}

const base = (p: string): string => p.replace(/\/+$/, '').split('/').pop() || p

/** 模型服务的端口(未显式指定时的默认值)与模型名等。 */
export function llmMeta(kind: string, args: string, env: string[] = []): Record<string, unknown> {
  const t = tokenize(args)
  const meta: Record<string, unknown> = {}
  const envVal = (k: string): string | undefined =>
    env.find((e) => e.startsWith(`${k}=`))?.slice(k.length + 1)
  if (kind === 'vllm') {
    const serveIdx = t.indexOf('serve')
    const positional =
      serveIdx >= 0 && t[serveIdx + 1] && !t[serveIdx + 1].startsWith('-')
        ? t[serveIdx + 1]
        : undefined
    meta.model = flag(t, ['--model']) || positional
    meta.servedName = flag(t, ['--served-model-name'])
    meta.tp = flag(t, ['--tensor-parallel-size', '-tp'])
    meta.defaultPort = Number(flag(t, ['--port']) || 8000)
    meta.maxModelLen = flag(t, ['--max-model-len'])
  } else if (kind === 'sglang') {
    meta.model = flag(t, ['--model-path', '--model'])
    meta.servedName = flag(t, ['--served-model-name'])
    meta.tp = flag(t, ['--tp-size', '--tp', '--tensor-parallel-size'])
    meta.defaultPort = Number(flag(t, ['--port']) || 30000)
  } else if (kind === 'ollama') {
    const h = envVal('OLLAMA_HOST')
    meta.defaultPort = Number(h?.split(':').pop()) || 11434
  } else if (kind === 'lmdeploy') {
    const i = t.indexOf('api_server')
    meta.model = i >= 0 ? t[i + 1] : undefined
    meta.tp = flag(t, ['--tp'])
    meta.defaultPort = Number(flag(t, ['--server-port']) || 23333)
  } else if (kind === 'tgi' || kind === 'tei') {
    meta.model = flag(t, ['--model-id']) || envVal('MODEL_ID')
    meta.defaultPort = Number(flag(t, ['--port']) || envVal('PORT') || 80)
  } else if (kind === 'llama.cpp') {
    meta.model = flag(t, ['-m', '--model'])
    meta.defaultPort = Number(flag(t, ['--port']) || 8080)
  } else if (kind === 'xinference') {
    meta.defaultPort = Number(flag(t, ['--port', '-p']) || 9997)
  } else if (kind === 'triton') {
    meta.defaultPort = Number(flag(t, ['--http-port']) || 8000)
  }
  if (typeof meta.model === 'string') meta.modelShort = base(meta.model)
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== ''))
}

/** 给通用进程起一个可读的名字:jar 名 / python 模块 / node 脚本。 */
export function friendlyName(kind: string, comm: string, args: string): string {
  const t = tokenize(args)
  if (kind === 'java') {
    const jar = flag(t, ['-jar'])
    if (jar) return base(jar).replace(/\.jar$/, '')
    const main = [...t].reverse().find((x) => /^[a-z][\w]*(\.[\w$]+)+$/i.test(x))
    if (main) return main.split('.').pop() || 'java'
  }
  if (kind === 'python') {
    const mod = flag(t, ['-m'])
    if (mod) {
      const app = t.find((x) => /^[\w.]+:[\w]+$/.test(x))
      return app ? `${mod} ${app}` : mod
    }
    const runner = t.find((x) => /(uvicorn|gunicorn|hypercorn|celery)$/.test(x))
    const app = t.find((x) => /^[\w.]+:[\w]+$/.test(x))
    if (runner) return app ? `${base(runner)} ${app}` : base(runner)
    const script = t.find((x, i) => i > 0 && /\.py$/.test(x))
    if (script) return base(script)
  }
  if (kind === 'node') {
    const script = t.find((x, i) => i > 0 && !x.startsWith('-') && /[./]/.test(x))
    if (script) return base(script)
  }
  return comm
}

const DB_PORTS: Record<number, string> = {
  3306: 'mysql',
  5432: 'postgres',
  6379: 'redis',
  27017: 'mongodb',
  9200: 'elasticsearch',
  9000: 'minio',
  11211: 'memcached',
  5672: 'rabbitmq',
  9092: 'kafka',
  2181: 'zookeeper',
  19530: 'milvus',
  6333: 'qdrant',
  8123: 'clickhouse',
  2379: 'etcd'
}

/** 外部节点的类型猜测(仅凭端口)。 */
export function guessByPort(port: number): Classified {
  if (DB_PORTS[port]) return { kind: DB_PORTS[port], category: 'data' }
  if (port === 80 || port === 443 || port === 8080) return { kind: 'http', category: 'external' }
  if (port === 11434) return { kind: 'ollama', category: 'llm' }
  return { kind: 'tcp', category: 'external' }
}
