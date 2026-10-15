import type { McCategory, McDeploy, McPort } from '../../../shared/monitorCenter'

/** 服务可被访问到的地址。ns='host' 表示宿主机网络命名空间(含 docker 发布端口)。 */
export interface ListenAddr {
  ip: string
  port: number
  ns: 'host' | 'container'
}

/** 单台主机上解析出的服务(尚未与其它主机关联)。 */
export interface RawService {
  /** 主机内稳定键:容器名 / systemd 单元 / 进程名+端口。 */
  key: string
  category: McCategory
  kind: string
  name: string
  deploy: McDeploy
  containerId?: string
  containerName?: string
  image?: string
  composeProject?: string
  unit?: string
  pid?: number
  process?: string
  cmd?: string
  ports: McPort[]
  listen: ListenAddr[]
  meta: Record<string, unknown>
  /** 没有监听端口、仅因对外连接而记录的客户端进程;建图时没有关联就丢弃。 */
  clientOnly?: boolean
}

/** 出站连接:from 服务 → remote ip:port。 */
export interface RawConn {
  from: string
  /** 'host' 或容器 id:决定 127.0.0.1 指向谁。 */
  ns: string
  ip: string
  port: number
  count: number
}

/** 由配置推断出的指向:nginx proxy_pass / 容器环境变量。 */
export interface RawRef {
  from: string
  ns: string
  kind: 'proxy' | 'config'
  host: string
  port: number
  label?: string
  evidence: string
}

export interface RawContainer {
  id: string
  name: string
  ips: string[]
  aliases: string[]
  serviceKey: string
}

export interface DiscoveryFacts {
  hostId: string
  name: string
  address: string
  hostname?: string
  ips: string[]
  discoveredAt: number
  status: 'ok' | 'error' | 'unsupported'
  error?: string
  docker: boolean
  sudo: boolean
  services: RawService[]
  conns: RawConn[]
  refs: RawRef[]
  containers: RawContainer[]
}
