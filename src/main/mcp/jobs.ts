import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import type { Host, ProxyEntry } from '../../shared/types'
import {
  formatDuration,
  judgeCheck,
  tailLines,
  validatePattern,
  type CheckConditions
} from '../../shared/waitCheck'
import { mcpSshPool, resolveHost } from './McpSshPool'
import {
  MAX_OUTPUT,
  PROXY_EXPORTS,
  PROXY_PLACEHOLDER,
  buildRun,
  expandProxyPlaceholder,
  fail,
  inTarget,
  maskProxy,
  ok,
  proxyAddress,
  resolveProxy,
  shellQuote,
  wrap,
  type ToolExtra,
  type ToolResult
} from './toolkit'

/**
 * 后台任务:start_job 用 nohup(+setsid)在远端起进程,输出落到 /tmp/nebushell-jobs/<id>/,
 * job_status / wait_for 读这个目录判断进度 —— 不依赖 MCP 连接保持,客户端断开、
 * NebuShell 重启后任务照样在跑,用 job_id 仍能查。
 *
 * 目录结构:cmd.sh(要跑的脚本) out.log(stdout+stderr) pid start exit(结束后才有)
 *          .proxy(用了代理时的地址,任务结束即删除) stopped(被 stop_job 终止)
 */

const JOB_ROOT = '/tmp/nebushell-jobs'
const STATUS_TIMEOUT_MS = 30_000

interface JobInfo {
  id: string
  hostId: string
  hostLabel: string
  container?: string
  command: string
  cwd?: string
  proxyId?: string
  startedAt: number
}

/** 本进程启动过的任务(重启后丢失,但远端目录还在,传 host 仍可查询)。 */
const jobs = new Map<string, JobInfo>()

function jobDir(id: string): string {
  return `${JOB_ROOT}/${id}`
}

function newJobId(): string {
  return `j${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
}

const JOB_ID_RE = /^j[a-z0-9]{6,30}$/

interface JobRef {
  id: string
  host: Host
  container?: string
  info?: JobInfo
  proxy?: ProxyEntry
}

/** job_id → 主机 / 容器。不在登记表里(NebuShell 重启过)时需要调用方给 host。 */
function resolveJob(id: string, host?: string, container?: string): JobRef {
  if (!JOB_ID_RE.test(id)) throw new Error(`job_id 格式不对: ${id}`)
  const info = jobs.get(id)
  if (info) {
    const h = resolveHost(info.hostId)
    let proxy: ProxyEntry | undefined
    try {
      proxy = info.proxyId ? resolveProxy(info.proxyId) : undefined
    } catch {
      // 代理已删除:只是不能再遮掉日志里的密码,不影响查询
    }
    return { id, host: h, container: info.container, info, proxy }
  }
  if (!host)
    throw new Error(`不认识任务 ${id}(可能是 NebuShell 重启前启动的),请同时传 host(以及 container)`)
  return { id, host: resolveHost(host), container }
}

export interface JobStatus {
  state: 'running' | 'exited' | 'stopped' | 'lost' | 'missing'
  exitCode: number | null
  startedAt: number | null
  endedAt: number | null
  logBytes: number | null
  tail: string
}

/** 读一次任务状态。 */
async function readStatus(ref: JobRef, tail: number): Promise<JobStatus> {
  const script = [
    'D="$1"',
    'if [ ! -d "$D" ]; then echo "STATE missing"; exit 0; fi',
    'if [ -f "$D/stopped" ]; then echo "STATE stopped"',
    'elif [ -f "$D/exit" ]; then echo "STATE exited"',
    'elif [ -f "$D/pid" ] && kill -0 "$(cat "$D/pid")" 2>/dev/null; then echo "STATE running"',
    'else echo "STATE lost"; fi',
    'echo "EXIT $(cat "$D/exit" 2>/dev/null)"',
    'echo "START $(cat "$D/start" 2>/dev/null)"',
    'echo "END $(date -r "$D/exit" +%s 2>/dev/null)"',
    'echo "SIZE $(wc -c < "$D/out.log" 2>/dev/null)"',
    'echo "---LOG---"',
    `tail -n ${tail} "$D/out.log" 2>/dev/null`
  ].join('\n')
  const cmd = await inTarget(ref.host, ref.container, script, { args: [jobDir(ref.id)] })
  const r = await mcpSshPool.exec(ref.host, cmd, {
    timeoutMs: STATUS_TIMEOUT_MS,
    maxBytes: MAX_OUTPUT
  })
  if (r.timedOut) throw new Error('查询任务状态超时')
  const [head, ...rest] = r.stdout.split('---LOG---\n')
  if (!rest.length && r.code !== 0) throw new Error(r.stderr || `查询失败(退出码 ${r.code})`)
  const field = (k: string): string => new RegExp(`^${k} (.*)$`, 'm').exec(head)?.[1]?.trim() ?? ''
  const num = (s: string): number | null => (s && /^-?\d+$/.test(s) ? Number(s) : null)
  const state = (field('STATE') || 'lost') as JobStatus['state']
  return {
    state,
    exitCode: num(field('EXIT')),
    startedAt: num(field('START')),
    endedAt: num(field('END')),
    logBytes: num(field('SIZE')),
    tail: maskProxy(rest.join('---LOG---\n'), ref.proxy)
  }
}

const STATE_LABEL: Record<JobStatus['state'], string> = {
  running: '运行中',
  exited: '已结束',
  stopped: '已被终止',
  lost: '进程已消失(未留下退出码,可能被杀或机器重启)',
  missing: '任务目录不存在(id 不对,或 /tmp 被清理)'
}

function describeStatus(ref: JobRef, s: JobStatus): string {
  const now = Math.floor(Date.now() / 1000)
  const lines = [
    `job_id: ${ref.id}`,
    `状态: ${STATE_LABEL[s.state]}${s.state === 'exited' ? `,退出码 ${s.exitCode ?? '未知'}` : ''}`
  ]
  if (s.startedAt) {
    const end = s.endedAt ?? (s.state === 'running' ? now : null)
    if (end) lines.push(`运行时长: ${formatDuration((end - s.startedAt) * 1000)}`)
  }
  if (ref.info) lines.push(`命令: ${ref.info.command.slice(0, 300)}`)
  if (s.logBytes !== null) lines.push(`日志: ${jobDir(ref.id)}/out.log(${s.logBytes} 字节)`)
  lines.push('--- 日志末尾 ---', s.tail.trimEnd() || '(无输出)')
  return lines.join('\n')
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const t = setTimeout(done, ms)
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done)
  })
}

export function registerJobTools(server: McpServer, clientIp: string): void {
  server.registerTool(
    'start_job',
    {
      description:
        '在服务器(或容器内)后台启动一个长时间任务(下载、编译、构建镜像、打包、数据迁移等),立即返回 job_id。' +
        '进程用 nohup/setsid 脱离会话,输出写入 /tmp/nebushell-jobs/<job_id>/out.log,MCP 断开也不影响。' +
        '之后用 wait_for(job_id) 等待完成,或用 job_status 查看进度。' +
        `proxy / ${PROXY_PLACEHOLDER} 的用法与 exec_command 相同。`,
      inputSchema: {
        host: z.string().describe('主机 id 或名称'),
        command: z.string().describe('要执行的命令(可以是多行脚本)'),
        cwd: z.string().optional().describe('执行目录'),
        container: z.string().optional().describe('在该容器内运行(docker exec)'),
        proxy: z.string().optional().describe('代理 id 或名称(见 list_proxies)')
      }
    },
    wrap(
      'start_job',
      clientIp,
      (a: { command: string; container?: string }) =>
        (a.container ? `[${a.container}] ` : '') + a.command.slice(0, 500),
      async (a: {
        host: string
        command: string
        cwd?: string
        container?: string
        proxy?: string
      }) => {
        const host = resolveHost(a.host)
        const proxy = a.proxy ? resolveProxy(a.proxy) : undefined
        if (a.command.includes(PROXY_PLACEHOLDER) && !proxy) {
          return fail(`命令里用了 ${PROXY_PLACEHOLDER},但没有传 proxy 参数`)
        }
        const id = newJobId()
        const jobScript = [
          proxy ? `NEBU_PROXY=$(cat "$NEBU_JOB/.proxy")\n${PROXY_EXPORTS}` : '',
          a.cwd ? `cd ${shellQuote(a.cwd)} || exit 1` : '',
          expandProxyPlaceholder(a.command)
        ]
          .filter(Boolean)
          .join('\n')
        // 启动器:stdin 第一行是代理地址(可能为空),其余是任务脚本。
        const launcher = [
          'D="$1"',
          'umask 077',
          'mkdir -p "$D" || exit 1',
          'IFS= read -r P || true',
          '[ -n "$P" ] && printf "%s\\n" "$P" > "$D/.proxy"',
          'cat > "$D/cmd.sh"',
          'date +%s > "$D/start"',
          'S=; command -v setsid >/dev/null 2>&1 && S=setsid',
          'cd / && NEBU_JOB="$D" $S nohup sh -c \'sh "$NEBU_JOB/cmd.sh" > "$NEBU_JOB/out.log" 2>&1; echo $? > "$NEBU_JOB/exit"; rm -f "$NEBU_JOB/.proxy"\' > /dev/null 2>&1 < /dev/null &',
          'echo $! > "$D/pid"',
          'echo "PID $!"'
        ].join('\n')
        const cmd = await inTarget(host, a.container, launcher, {
          interactive: true,
          args: [jobDir(id)]
        })
        const stdin = `${proxy ? proxyAddress(proxy) : ''}\n${jobScript}\n`
        const r = await mcpSshPool.exec(host, cmd, {
          timeoutMs: 30_000,
          maxBytes: MAX_OUTPUT,
          stdin
        })
        const pid = /PID (\d+)/.exec(r.stdout)?.[1]
        if (r.code !== 0 || !pid) {
          return fail(maskProxy(r.stderr || r.stdout || `启动失败(退出码 ${r.code})`, proxy))
        }
        jobs.set(id, {
          id,
          hostId: host.id,
          hostLabel: host.label,
          container: a.container,
          command: a.command,
          cwd: a.cwd,
          proxyId: proxy?.id,
          startedAt: Date.now()
        })
        return ok(
          [
            `已在 ${host.label}${a.container ? ` 的容器 ${a.container} 内` : ''} 后台启动任务。`,
            `job_id: ${id}`,
            `pid: ${pid}`,
            `日志: ${jobDir(id)}/out.log`,
            '下一步:用 wait_for(job_id) 等它完成,或 job_status 看进度。不要用 sleep 轮询。'
          ].join('\n')
        )
      }
    )
  )

  server.registerTool(
    'job_status',
    {
      description: '查看 start_job 启动的任务:是否还在运行、退出码、运行时长、日志末尾。',
      inputSchema: {
        job_id: z.string(),
        tail_lines: z
          .number()
          .int()
          .min(0)
          .max(2000)
          .optional()
          .describe('返回日志末尾行数,默认 50'),
        host: z.string().optional().describe('NebuShell 重启后查询旧任务时需要'),
        container: z.string().optional().describe('同上,任务在容器内时需要')
      }
    },
    wrap(
      'job_status',
      clientIp,
      (a: { job_id: string }) => a.job_id,
      async (a: { job_id: string; tail_lines?: number; host?: string; container?: string }) => {
        const ref = resolveJob(a.job_id, a.host, a.container)
        const s = await readStatus(ref, a.tail_lines ?? 50)
        const res = ok(describeStatus(ref, s))
        if (s.state === 'missing') res.isError = true
        return res
      }
    )
  )

  server.registerTool(
    'list_jobs',
    {
      description:
        '列出后台任务。不传 host 时列出本次 NebuShell 运行期间通过 MCP 启动的任务;' +
        '传 host 时还会列出该主机 /tmp/nebushell-jobs 下的全部任务(包括 NebuShell 重启前的)。',
      inputSchema: { host: z.string().optional() }
    },
    wrap(
      'list_jobs',
      clientIp,
      () => '',
      async (a: { host?: string }) => {
        const known = [...jobs.values()].sort((x, y) => y.startedAt - x.startedAt)
        const lines: string[] = []
        const host = a.host ? resolveHost(a.host) : undefined
        for (const j of known) {
          if (host && j.hostId !== host.id) continue
          lines.push(
            `${j.id}\t${j.hostLabel}${j.container ? `/${j.container}` : ''}\t` +
              `${new Date(j.startedAt).toISOString()}\t${j.command.replace(/\s+/g, ' ').slice(0, 120)}`
          )
        }
        if (host) {
          const script =
            `for d in ${JOB_ROOT}/j*; do [ -d "$d" ] || continue; ` +
            'id=${d##*/}; st=running; [ -f "$d/exit" ] && st="exit=$(cat "$d/exit")"; [ -f "$d/stopped" ] && st=stopped; ' +
            'if [ "$st" = running ] && ! kill -0 "$(cat "$d/pid" 2>/dev/null)" 2>/dev/null; then st=lost; fi; ' +
            'echo "$id $st $(cat "$d/start" 2>/dev/null)"; done'
          const r = await mcpSshPool.exec(host, script, { timeoutMs: 30_000, maxBytes: MAX_OUTPUT })
          const remote = r.stdout.trim()
          lines.push(
            '',
            `--- ${host.label} 宿主机上的任务目录(id 状态 启动时间戳) ---`,
            remote || '(无)'
          )
        }
        return ok(lines.length ? `job_id\t主机\t启动时间\t命令\n${lines.join('\n')}` : '没有任务')
      }
    )
  )

  server.registerTool(
    'stop_job',
    {
      description: '终止 start_job 启动的任务(先 SIGTERM 整个进程组,5 秒后仍在运行则 SIGKILL)。',
      inputSchema: {
        job_id: z.string(),
        host: z.string().optional(),
        container: z.string().optional()
      }
    },
    wrap(
      'stop_job',
      clientIp,
      (a: { job_id: string }) => a.job_id,
      async (a: { job_id: string; host?: string; container?: string }) => {
        const ref = resolveJob(a.job_id, a.host, a.container)
        const script = [
          'D="$1"',
          'P=$(cat "$D/pid" 2>/dev/null) || { echo "NOJOB"; exit 0; }',
          'if [ -f "$D/exit" ] || ! kill -0 "$P" 2>/dev/null; then echo "NOT_RUNNING"; exit 0; fi',
          'touch "$D/stopped"',
          'kill -TERM -- "-$P" 2>/dev/null || kill -TERM "$P" 2>/dev/null',
          'i=0; while [ $i -lt 5 ] && kill -0 "$P" 2>/dev/null; do sleep 1; i=$((i+1)); done',
          'if kill -0 "$P" 2>/dev/null; then kill -KILL -- "-$P" 2>/dev/null || kill -KILL "$P"; echo KILLED; else echo TERMINATED; fi',
          'rm -f "$D/.proxy"'
        ].join('\n')
        const cmd = await inTarget(ref.host, ref.container, script, { args: [jobDir(ref.id)] })
        const r = await mcpSshPool.exec(ref.host, cmd, { timeoutMs: 30_000, maxBytes: MAX_OUTPUT })
        const out = r.stdout.trim()
        if (out.includes('NOJOB')) return fail(`任务 ${ref.id} 不存在`)
        if (out.includes('NOT_RUNNING')) return ok(`任务 ${ref.id} 已经不在运行`)
        if (r.code !== 0) return fail(r.stderr || `终止失败(退出码 ${r.code})`)
        return ok(
          `任务 ${ref.id} 已${out.includes('KILLED') ? '强制结束(SIGKILL)' : '终止(SIGTERM)'}`
        )
      }
    )
  )

  server.registerTool(
    'wait_for',
    {
      description:
        '等待任务完成,期间按间隔在 NebuShell 本地轮询,不消耗你的上下文;条件满足会提前返回。两种用法:\n' +
        '1) 传 job_id:等 start_job 的任务结束(可再加 done_when/fail_when 匹配日志,例如服务启动成功就提前返回);\n' +
        '2) 传 check_command:周期执行这条只读检查命令(如 test -f /opt/app/ready、curl -sf localhost:8080/health),' +
        '默认退出码 0 即完成。\n' +
        '超过 timeout_seconds 仍未完成时返回当前进度,任务不受影响,可以再次调用 wait_for 继续等。',
      inputSchema: {
        job_id: z.string().optional(),
        host: z
          .string()
          .optional()
          .describe('check_command 模式必填;job_id 模式在 NebuShell 重启后需要'),
        container: z.string().optional(),
        check_command: z.string().optional(),
        done_when: z
          .object({
            exit_code: z.number().int().optional(),
            output_matches: z.string().optional().describe('正则,忽略大小写')
          })
          .optional(),
        fail_when: z
          .object({ output_matches: z.string().optional().describe('正则,命中即判定失败') })
          .optional(),
        proxy: z.string().optional().describe('check_command 需要代理时'),
        interval_seconds: z.number().int().min(3).max(600).optional().describe('检查间隔,默认 15'),
        timeout_seconds: z
          .number()
          .int()
          .min(5)
          .max(1800)
          .optional()
          .describe('本次最多等多久,默认 300;到时返回进度,可再次调用')
      }
    },
    wrap(
      'wait_for',
      clientIp,
      (a: { job_id?: string; check_command?: string }) =>
        a.job_id ? `job ${a.job_id}` : (a.check_command ?? '').slice(0, 300),
      async (
        a: {
          job_id?: string
          host?: string
          container?: string
          check_command?: string
          done_when?: { exit_code?: number; output_matches?: string }
          fail_when?: { output_matches?: string }
          proxy?: string
          interval_seconds?: number
          timeout_seconds?: number
        },
        extra: ToolExtra
      ) => {
        if (!a.job_id && !a.check_command) return fail('job_id 与 check_command 至少传一个')
        const cond: CheckConditions = {
          doneExit: a.done_when?.exit_code,
          donePattern: a.done_when?.output_matches || undefined,
          failPattern: a.fail_when?.output_matches || undefined
        }
        for (const [p, f] of [
          [cond.donePattern, 'done_when.output_matches'],
          [cond.failPattern, 'fail_when.output_matches']
        ] as const) {
          const err = p ? validatePattern(p, f) : null
          if (err) return fail(err)
        }
        const intervalMs = (a.interval_seconds ?? 15) * 1000
        const deadline = Date.now() + (a.timeout_seconds ?? 300) * 1000
        const started = Date.now()
        return a.job_id
          ? waitJob(
              resolveJob(a.job_id, a.host, a.container),
              cond,
              intervalMs,
              deadline,
              started,
              extra
            )
          : waitCheck(a, cond, intervalMs, deadline, started, extra)
      }
    )
  )
}

const MAX_CHECK_ERRORS = 3

async function waitJob(
  ref: JobRef,
  cond: CheckConditions,
  intervalMs: number,
  deadline: number,
  started: number,
  extra: ToolExtra
): Promise<ToolResult> {
  let checks = 0
  let errors = 0
  let last: JobStatus | null = null
  const usePattern = !!(cond.donePattern || cond.failPattern)
  for (;;) {
    try {
      last = await readStatus(ref, usePattern ? 200 : 30)
      errors = 0
    } catch (e) {
      if (++errors >= MAX_CHECK_ERRORS) {
        return fail(`连续 ${errors} 次查询失败: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    checks++
    if (last) {
      const waited = `已等待 ${formatDuration(Date.now() - started)},检查 ${checks} 次`
      if (last.state !== 'running') {
        const res = ok(
          `[等待结束: 任务${STATE_LABEL[last.state]}] ${waited}\n${describeStatus(ref, { ...last, tail: tailLines(last.tail, 30, 8000) })}`
        )
        if (last.state !== 'exited' || last.exitCode !== 0) res.isError = true
        return res
      }
      if (usePattern) {
        // 只拿模式匹配日志;退出码条件对运行中的任务没有意义。
        const verdict = judgeCheck(
          { donePattern: cond.donePattern, failPattern: cond.failPattern },
          { output: last.tail, exitCode: null }
        )
        if (verdict !== 'continue') {
          const res = ok(
            `[等待结束: 日志${verdict === 'done' ? '命中完成条件' : '命中失败特征'}(任务仍在运行)] ${waited}\n` +
              describeStatus(ref, { ...last, tail: tailLines(last.tail, 30, 8000) })
          )
          if (verdict === 'failed') res.isError = true
          return res
        }
      }
    }
    if (extra.signal.aborted) return fail('客户端已取消等待(任务仍在运行)')
    if (Date.now() + intervalMs > deadline) {
      return ok(
        `[等待超时: 任务仍在运行] 已等待 ${formatDuration(Date.now() - started)},检查 ${checks} 次。` +
          `可以再次调用 wait_for(job_id="${ref.id}") 继续等。\n` +
          (last ? describeStatus(ref, { ...last, tail: tailLines(last.tail, 20, 6000) }) : '')
      )
    }
    await sleep(intervalMs, extra.signal)
  }
}

async function waitCheck(
  a: { host?: string; container?: string; check_command?: string; proxy?: string },
  cond: CheckConditions,
  intervalMs: number,
  deadline: number,
  started: number,
  extra: ToolExtra
): Promise<ToolResult> {
  if (!a.host) return fail('check_command 模式需要 host')
  const host = resolveHost(a.host)
  const proxy = a.proxy ? resolveProxy(a.proxy) : undefined
  const conditions: CheckConditions = {
    ...cond,
    // 没给完成条件时:退出码 0 即完成(test -f / curl -f 这类命令天然如此)。
    doneExit: cond.doneExit === undefined && !cond.donePattern ? 0 : cond.doneExit
  }
  const run = await buildRun(host, {
    command: a.check_command!,
    container: a.container,
    proxy
  })
  let checks = 0
  let errors = 0
  let lastOut = ''
  let lastCode: number | null = null
  const summary = (): string =>
    `已等待 ${formatDuration(Date.now() - started)},检查 ${checks} 次。\n` +
    `最后一次检查(退出码 ${lastCode ?? '未知'}):\n${tailLines(maskProxy(lastOut, proxy), 30, 8000) || '(无输出)'}`
  for (;;) {
    try {
      const r = await mcpSshPool.exec(host, run.cmd, {
        timeoutMs: 60_000,
        maxBytes: MAX_OUTPUT,
        stdin: run.stdin
      })
      checks++
      if (r.timedOut) throw new Error('检查命令 60 秒未返回')
      errors = 0
      lastOut = [r.stdout, r.stderr].filter((s) => s.trim()).join('\n')
      lastCode = r.code
      const verdict = judgeCheck(conditions, { output: lastOut, exitCode: r.code })
      if (verdict === 'done') return ok(`[等待结束: 条件满足] ${summary()}`)
      if (verdict === 'failed') {
        const res = ok(`[等待结束: 检测到失败特征] ${summary()}`)
        res.isError = true
        return res
      }
    } catch (e) {
      if (++errors >= MAX_CHECK_ERRORS) {
        return fail(
          `检查命令连续 ${errors} 次执行失败: ${e instanceof Error ? e.message : String(e)}`
        )
      }
    }
    if (extra.signal.aborted) return fail('客户端已取消等待')
    if (Date.now() + intervalMs > deadline) {
      return ok(`[等待超时: 条件尚未满足] ${summary()}\n可以再次调用 wait_for 继续等。`)
    }
    await sleep(intervalMs, extra.signal)
  }
}
