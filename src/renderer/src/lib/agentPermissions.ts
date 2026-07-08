export type AgentMode = 'plan' | 'ask' | 'auto' | 'full'

export interface AgentModeInfo {
  id: AgentMode
  label: string
  description: string
}

export const AGENT_MODES: AgentModeInfo[] = [
  { id: 'plan', label: '计划模式', description: '只读探索并给出方案,不执行任何写操作' },
  { id: 'ask', label: '请求批准', description: '每条命令都需要你确认后才执行' },
  { id: 'auto', label: '替我审批', description: '查看类命令自动执行,只有风险操作才请求批准' },
  { id: 'full', label: '完全访问', description: '所有命令自动执行,不再询问' }
]

export function modeInfo(mode: AgentMode): AgentModeInfo {
  return AGENT_MODES.find((m) => m.id === mode) ?? AGENT_MODES[1]
}

/** 'auto' = run now, 'ask' = need user confirm, 'block' = refuse (plan mode) */
export type Disposition = 'auto' | 'ask' | 'block'

export function disposition(mode: AgentMode, risky: boolean): Disposition {
  switch (mode) {
    case 'full':
      return 'auto'
    case 'plan':
      return risky ? 'block' : 'auto'
    case 'auto':
      return risky ? 'ask' : 'auto'
    case 'ask':
    default:
      return 'ask'
  }
}

// Commands considered read-only / safe. Anything not clearly safe is treated as risky.
const READONLY = new Set([
  'ls', 'll', 'la', 'dir', 'cat', 'tac', 'pwd', 'whoami', 'id', 'groups', 'hostname',
  'uname', 'arch', 'date', 'uptime', 'df', 'du', 'free', 'ps', 'top', 'htop', 'env',
  'printenv', 'echo', 'printf', 'which', 'type', 'command', 'stat', 'file', 'head',
  'tail', 'wc', 'grep', 'egrep', 'fgrep', 'zgrep', 'cut', 'sort', 'uniq', 'nl', 'column',
  'tr', 'rev', 'realpath', 'readlink', 'basename', 'dirname', 'history', 'cal', 'w', 'who',
  'users', 'last', 'lastlog', 'netstat', 'ss', 'ip', 'ifconfig', 'route', 'arp', 'ping',
  'traceroute', 'tracepath', 'mtr', 'dig', 'nslookup', 'host', 'getent', 'lsblk', 'lscpu',
  'lsusb', 'lspci', 'lsmod', 'lsof', 'mount', 'vmstat', 'iostat', 'mpstat', 'sar', 'dmesg',
  'journalctl', 'tree', 'md5sum', 'sha1sum', 'sha256sum', 'cksum', 'diff', 'cmp', 'comm',
  'less', 'more', 'jobs', 'true', 'false', 'seq', 'base64', 'xxd', 'od', 'hexdump',
  'strings', 'awk', 'test'
])

// Programs whose safety depends on the subcommand.
const SUBCMD_SAFE: Record<string, Set<string>> = {
  git: new Set([
    'status', 'log', 'diff', 'show', 'branch', 'remote', 'ls-files', 'rev-parse',
    'describe', 'tag', 'blame', 'shortlog', 'reflog', 'config'
  ]),
  docker: new Set([
    'ps', 'images', 'version', 'info', 'logs', 'inspect', 'stats', 'top', 'port', 'history'
  ]),
  systemctl: new Set([
    'status', 'list-units', 'list-unit-files', 'is-active', 'is-enabled', 'show', 'cat',
    'list-timers'
  ]),
  service: new Set(['status']),
  kubectl: new Set(['get', 'describe', 'logs', 'top', 'version', 'explain', 'api-resources']),
  apt: new Set(['list', 'show', 'search', 'policy']),
  'apt-get': new Set(['list', 'show']),
  yum: new Set(['list', 'info', 'search']),
  dnf: new Set(['list', 'info', 'search']),
  npm: new Set(['ls', 'list', 'view', 'outdated']),
  pip: new Set(['list', 'show', 'freeze']),
  pip3: new Set(['list', 'show', 'freeze'])
}

export function isRiskyCommand(raw: string): boolean {
  const cmd = raw.trim()
  if (!cmd) return false
  if (/\bsudo\b/.test(cmd)) return true

  // File-writing redirection (ignore the harmless /dev/null and fd-dup forms).
  const redir = cmd
    .replace(/\d?>>?\s*\/dev\/null/g, '')
    .replace(/\d?>&\d?/g, '')
    .replace(/2>&1/g, '')
  if (/>>?/.test(redir)) return true

  const segments = cmd.split(/\|\||&&|[|;]/).map((s) => s.trim()).filter(Boolean)
  for (const seg of segments) {
    const tokens = seg.split(/\s+/)
    // skip leading VAR=value env assignments
    let i = 0
    while (tokens[i] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++
    let prog = tokens[i]
    if (!prog) return true
    prog = prog.replace(/^.*\//, '')

    if (prog === 'sed') {
      if (tokens.some((t) => t === '-i' || t.startsWith('-i'))) return true
      continue
    }
    if (prog === 'find') {
      if (tokens.some((t) => ['-delete', '-exec', '-execdir', '-fprint', '-ok'].includes(t)))
        return true
      continue
    }
    if (SUBCMD_SAFE[prog]) {
      const sub = tokens[i + 1]
      if (!sub || !SUBCMD_SAFE[prog].has(sub)) return true
      continue
    }
    if (READONLY.has(prog)) continue
    return true // unknown / not clearly safe → risky
  }
  return false
}
