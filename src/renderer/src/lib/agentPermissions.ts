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

// ---- 本机命令的风险判定(按宿主机平台分派) --------------------------------

// PowerShell 只读命令/别名白名单(小写)。注意:rm/del/rd/ri/mv/cp 在 PowerShell 里是
// Remove-Item/Move-Item/Copy-Item 的别名,绝不能沿用 Linux 白名单 —— 未知一律视为风险。
const READONLY_PS = new Set([
  // 目录/文件读取
  'dir', 'ls', 'gci', 'get-childitem', 'cat', 'gc', 'get-content', 'type',
  'pwd', 'gl', 'get-location', 'cd', 'sl', 'set-location', 'tree',
  // 输出/回显
  'echo', 'write-output', 'write-host', 'out-string', 'out-host', 'out-null',
  // 系统/环境信息
  'whoami', 'hostname', 'ver', 'systeminfo', 'gv', 'get-variable',
  // 网络诊断
  'ipconfig', 'netstat', 'ping', 'tracert', 'pathping', 'nslookup', 'route', 'arp',
  'getmac', 'nbtstat',
  // 进程/服务(只读)
  'tasklist', 'gps', 'ps', 'gsv',
  // 查找/过滤/统计
  'where', 'where-object', 'findstr', 'sls', 'select-string', 'select', 'select-object',
  'sort', 'sort-object', 'group', 'group-object', 'measure', 'measure-object',
  'compare', 'compare-object',
  // 格式化
  'fl', 'format-list', 'ft', 'format-table', 'fw', 'format-wide',
  // 帮助/成员
  'help', 'get-help', 'gm', 'get-member', 'gcm', 'get-command'
])

// 以这些动词开头的 cmdlet 视为只读安全(Get-*、Test-* 等)。
const SAFE_PS_VERBS = ['get-', 'test-', 'measure-', 'resolve-', 'compare-', 'show-', 'find-']

// 有意落入默认拒绝(无需显式列出)的例子:Remove-Item/del/rd/ri/rm、Set-*/New-*/Add-*/
// Clear-*/Move-*/Copy-*/Rename-*、Stop-Process/taskkill、Start-Process/saps、
// Invoke-Expression(iex)/Invoke-WebRequest(iwr/curl/wget)、reg、netsh、sc、schtasks、
// format、diskpart、bcdedit、shutdown、foreach-object/%(可调用任意命令)。
function isRiskyPowershellCommand(raw: string): boolean {
  const cmd = raw.trim()
  if (!cmd) return false

  // 剥掉无害重定向(丢弃输出/合并流),剩余 > / >> 视为写文件 → 风险。
  const redir = cmd
    .replace(/\d?>>?\s*\$null/gi, '')
    .replace(/\*>+\s*\$null/gi, '')
    .replace(/2>&1/g, '')
    .replace(/\|\s*out-null/gi, '')
  if (/>>?/.test(redir)) return true

  const segments = cmd.split(/\|\||&&|[|;\n]/).map((s) => s.trim()).filter(Boolean)
  for (const seg of segments) {
    const tokens = seg.split(/\s+/)
    let i = 0
    // 段首调用符 & 后面跟的才是真正的命令
    if (tokens[i] === '&') i++
    let prog = tokens[i]
    if (!prog) return true
    // 纯变量/表达式读取(如 $env:PATH、$PSVersionTable):段内无赋值即视为只读。
    if (/^[$(]/.test(prog)) {
      if (/(^|[^=!<>])=([^=]|$)/.test(seg)) return true
      continue
    }
    prog = prog.replace(/^&/, '').replace(/^["']|["']$/g, '')
    prog = prog.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase()

    if (SUBCMD_SAFE[prog]) {
      const sub = tokens[i + 1]
      if (!sub || !SUBCMD_SAFE[prog].has(sub)) return true
      continue
    }
    if (READONLY_PS.has(prog)) continue
    if (SAFE_PS_VERBS.some((v) => prog.startsWith(v))) continue
    return true // unknown / not clearly safe → risky
  }
  return false
}

/** 本机命令风险判定:win32 → PowerShell 规则,其余平台沿用 Unix 规则。 */
export function isRiskyLocalCommand(raw: string): boolean {
  return window.electron.process.platform === 'win32'
    ? isRiskyPowershellCommand(raw)
    : isRiskyCommand(raw)
}
