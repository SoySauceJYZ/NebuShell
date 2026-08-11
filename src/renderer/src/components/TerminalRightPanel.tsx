import { useState, useEffect } from 'react'
import {
  History,
  Activity,
  Palette,
  FolderOpen,
  Search,
  Trash2,
  Check,
  Zap,
  Languages,
  Minus,
  Plus,
  Bot,
  X,
  RefreshCw,
  Container,
  Play,
  Pencil,
  Server,
  PanelLeft,
  PanelRight,
  ArrowLeftRight
} from 'lucide-react'
import {
  useTerminalStore,
  type RightPanelTab,
  type PanelSide,
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE
} from '../store/useTerminalStore'
import { useCommandHistoryStore, EMPTY_ENTRIES } from '../store/useCommandHistoryStore'
import { useQuickCommandsStore } from '../store/useQuickCommandsStore'
import { useVaultStore } from '../store/useVaultStore'
import { useSessionStore } from '../store/useSessionStore'
import { ENABLE_CJK_COMMAND } from '../lib/quickActions'
import { runQuickCommand, buildBatch } from '../lib/quickCommands'
import { Select } from './ui/Select'
import type { QuickCommand, Host } from '@shared/types'
import { fetchServerHistory } from '../lib/serverHistory'
import { TERMINAL_THEMES, DEFAULT_THEME_ID } from '../lib/terminalThemes'
import { SftpPanel, ContainerFilesPanel } from './SftpPanel'
import { AgentPanel } from './AgentPanel'
import { MonitorPanel } from './MonitorPanel'
import { DockerPanel } from './DockerPanel'

const TABS: { id: Exclude<RightPanelTab, null>; label: string; icon: typeof History }[] = [
  { id: 'agent', label: '智能体', icon: Bot },
  { id: 'actions', label: '快捷操作', icon: Zap },
  { id: 'history', label: '历史命令', icon: History },
  { id: 'monitor', label: '监控', icon: Activity },
  { id: 'docker', label: '容器', icon: Container },
  { id: 'theme', label: '主题', icon: Palette },
  { id: 'sftp', label: 'SFTP', icon: FolderOpen }
]

/** 一个终端标签页里,两侧停靠位都要用到的上下文。 */
interface PanelContext {
  sessionId: string
  hostId: string
  connected: boolean
  /** 有值时该终端是容器终端:SFTP 栏位换成容器内文件浏览。 */
  containerId?: string
  containerName?: string
  dockerCmd?: string
}

/** 面板正文。左右两个停靠位共用同一份,只是外壳不同。 */
function PanelBody({
  tab,
  sessionId,
  hostId,
  connected,
  containerId,
  containerName,
  dockerCmd
}: PanelContext & { tab: Exclude<RightPanelTab, null> }): React.ReactElement | null {
  if (tab === 'agent')
    return <AgentPanel sessionId={sessionId} hostId={hostId} connected={connected} />
  if (tab === 'actions') return <ActionsSection sessionId={sessionId} connected={connected} />
  if (tab === 'history')
    return <HistorySection sessionId={sessionId} hostId={hostId} connected={connected} />
  if (tab === 'monitor') return <MonitorPanel sessionId={sessionId} connected={connected} />
  if (tab === 'docker')
    return <DockerPanel sessionId={sessionId} hostId={hostId} connected={connected} />
  if (tab === 'theme') return <ThemeSection sessionId={sessionId} />
  if (tab === 'sftp')
    return (
      <div className="min-h-0 flex-1">
        {containerId ? (
          // 容器终端:文件面板浏览容器内文件系统,而不是宿主机 SFTP
          <ContainerFilesPanel
            sessionId={`${sessionId}::cfs`}
            hostId={hostId}
            containerId={containerId}
            containerName={containerName ?? containerId.slice(0, 12)}
            dockerCmd={dockerCmd ?? 'docker'}
            ownerId={sessionId}
          />
        ) : (
          <SftpPanel sessionId={`${sessionId}::sftp`} hostId={hostId} ownerId={sessionId} />
        )}
      </div>
    )
  return null
}

/** 一侧的停靠位:定宽外壳 + 贴着终端那一边的拖拽手柄。 */
function SideDock({
  side,
  tab,
  ...ctx
}: PanelContext & { side: PanelSide; tab: Exclude<RightPanelTab, null> }): React.ReactElement {
  const isLeft = side === 'left'
  const width = useTerminalStore((s) => (isLeft ? s.leftPanelWidth : s.rightPanelWidth))
  const setWidth = useTerminalStore((s) => (isLeft ? s.setLeftPanelWidth : s.setRightPanelWidth))

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const st = useTerminalStore.getState()
    const startW = isLeft ? st.leftPanelWidth : st.rightPanelWidth
    const onMove = (ev: MouseEvent): void => {
      // 手柄总在靠终端的那一侧:右侧面板往左拖变宽,左侧面板往右拖变宽。
      setWidth(startW + (isLeft ? ev.clientX - startX : startX - ev.clientX))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
  }

  return (
    <div
      className={`relative flex h-full shrink-0 flex-col bg-[var(--panel-bg)] ${
        isLeft ? 'border-r' : 'border-l'
      } border-[var(--panel-border)]`}
      style={{ width }}
    >
      <div
        onMouseDown={startResize}
        title="拖动调整宽度"
        className={`absolute top-0 z-10 h-full w-2 cursor-col-resize hover:bg-[var(--accent)]/20 ${
          isLeft ? '-right-1' : '-left-1'
        }`}
      />
      <PanelBody tab={tab} {...ctx} />
    </div>
  )
}

/**
 * 图标栏顶部的「换边」按钮。把当前面板挪到另一侧后,再点一个图标就会在右侧开出新面板,
 * 于是得到「左 · 终端 · 右」三栏。两侧都开着时它变成互换。
 */
function DockSwapButton({ sessionId }: { sessionId: string }): React.ReactElement {
  const left = useTerminalStore((s) => s.leftPanelTabBySession[sessionId] ?? null)
  const right = useTerminalStore((s) => s.rightPanelTabBySession[sessionId] ?? null)
  const movePanel = useTerminalStore((s) => s.movePanel)
  const disabled = !left && !right
  const [Icon, title] =
    left && right
      ? [ArrowLeftRight, '左右面板互换']
      : right
        ? [PanelLeft, '把面板移到左侧(再开一个就是左中右三栏)']
        : [PanelRight, '把面板移回右侧']

  return (
    <>
      <button
        disabled={disabled}
        title={disabled ? '先打开一个面板,再把它移到左侧' : title}
        onClick={() => movePanel(sessionId, right ? 'right' : 'left')}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
      >
        <Icon size={17} strokeWidth={1.75} />
      </button>
      <div className="my-1 h-px w-6 shrink-0 bg-[var(--panel-border)]" />
    </>
  )
}

/** 左侧停靠位。没有面板停在左边时不占任何空间。 */
export function TerminalLeftPanel(ctx: PanelContext): React.ReactElement | null {
  const tab = useTerminalStore((s) => s.leftPanelTabBySession[ctx.sessionId] ?? null)
  if (!tab) return null
  return <SideDock side="left" tab={tab} {...ctx} />
}

/** 右侧停靠位 + 图标栏(图标栏是唯一的面板入口,始终在最右)。 */
export function TerminalRightPanel(ctx: PanelContext): React.ReactElement {
  const { sessionId, containerId } = ctx
  const rightPanelTab = useTerminalStore((s) => s.rightPanelTabBySession[sessionId] ?? null)
  const leftPanelTab = useTerminalStore((s) => s.leftPanelTabBySession[sessionId] ?? null)
  const toggleRightPanel = useTerminalStore((s) => s.toggleRightPanel)

  return (
    <div className="flex h-full shrink-0">
      {rightPanelTab && <SideDock side="right" tab={rightPanelTab} {...ctx} />}

      <div className="flex w-11 flex-col items-center gap-1 border-l border-[var(--panel-border)] bg-[var(--nav-bg)] py-2">
        <DockSwapButton sessionId={sessionId} />
        {TABS.map((tab) => {
          const Icon = tab.icon
          // 停在哪一侧都算「打开中」,再点一次就关掉它。
          const active = rightPanelTab === tab.id || leftPanelTab === tab.id
          const label = tab.id === 'sftp' && containerId ? '容器文件' : tab.label
          return (
            <button
              key={tab.id}
              title={label}
              onClick={() => toggleRightPanel(sessionId, tab.id)}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${
                active
                  ? 'bg-[var(--nav-active-bg)] text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]'
              }`}
            >
              <Icon size={18} strokeWidth={1.75} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SectionHeader({
  title,
  action
}: {
  title: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--panel-border)] px-4">
      <span className="text-sm font-semibold text-[var(--text-dark)]">{title}</span>
      {action}
    </div>
  )
}

function ActionsSection({
  sessionId,
  connected
}: {
  sessionId: string
  connected: boolean
}): React.ReactElement {
  const items = useQuickCommandsStore((s) => s.items)
  const hydrate = useQuickCommandsStore((s) => s.hydrate)
  const remove = useQuickCommandsStore((s) => s.remove)
  const hosts = useVaultStore((s) => s.hosts)
  const openTab = useSessionStore((s) => s.openTab)
  // null = 列表视图;'new' = 新增表单;QuickCommand = 编辑该项。
  const [editing, setEditing] = useState<QuickCommand | 'new' | null>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (editing) {
    return (
      <QuickCommandForm
        sessionId={sessionId}
        connected={connected}
        hosts={hosts}
        initial={editing === 'new' ? null : editing}
        onDone={() => setEditing(null)}
      />
    )
  }

  const deleteCmd = async (cmd: QuickCommand): Promise<void> => {
    const ok = await window.api.dialog.confirm({
      message: `删除快捷命令「${cmd.title}」?`,
      confirmLabel: '删除',
      cancelLabel: '取消'
    })
    if (ok) remove(cmd.id)
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        title="快捷操作"
        action={
          <button
            onClick={() => setEditing('new')}
            title="新增快捷命令"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--text-muted)] transition hover:bg-[var(--nav-bg-hover)] hover:text-[var(--accent)]"
          >
            <Plus size={14} />
            新增
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <CjkButton sessionId={sessionId} connected={connected} />
        {items.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {items.map((cmd) => (
              <QuickCommandRow
                key={cmd.id}
                cmd={cmd}
                hosts={hosts}
                connected={connected}
                onRun={() => runQuickCommand(cmd, { sessionId, openTab, hosts })}
                onEdit={() => setEditing(cmd)}
                onDelete={() => void deleteCmd(cmd)}
              />
            ))}
          </div>
        )}
        <p className="mt-3 px-1 text-xs leading-relaxed text-[var(--text-muted)]">
          「新增」可保存一批命令:不绑定服务器则在当前终端执行;绑定服务器后点击会新开标签页连接并执行。
        </p>
      </div>
    </div>
  )
}

/** 内置的「启用中文输入」快捷操作,保留自己的“已启用”反馈状态。 */
function CjkButton({
  sessionId,
  connected
}: {
  sessionId: string
  connected: boolean
}): React.ReactElement {
  const [done, setDone] = useState(false)
  const enableCjk = (): void => {
    window.api.ssh.write(sessionId, ENABLE_CJK_COMMAND + '\n')
    setDone(true)
    window.setTimeout(() => setDone(false), 2500)
  }
  return (
    <button
      onClick={enableCjk}
      disabled={!connected}
      className="flex w-full items-start gap-3 rounded-lg border border-[var(--panel-border)] p-3 text-left transition hover:border-[var(--accent)] disabled:opacity-50"
    >
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
        <Languages size={18} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-dark)]">
          启用中文输入
          {done && (
            <span className="flex items-center gap-1 text-xs font-normal text-[var(--accent)]">
              <Check size={13} />
              已启用
            </span>
          )}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
          让当前终端支持中文的输入与显示(设置 UTF-8 locale 并使 readline 8-bit 干净)。
        </div>
      </div>
    </button>
  )
}

/** 列表里的一条自定义快捷命令:点击运行,hover 显示编辑/删除。 */
function QuickCommandRow({
  cmd,
  hosts,
  connected,
  onRun,
  onEdit,
  onDelete
}: {
  cmd: QuickCommand
  hosts: Host[]
  connected: boolean
  onRun: () => void
  onEdit: () => void
  onDelete: () => void
}): React.ReactElement {
  const boundHost = cmd.hostId ? hosts.find((h) => h.id === cmd.hostId) : undefined
  // 未绑定服务器的命令要写入当前终端,故需要活动连接;绑定服务器的命令自行新开标签,不受此限。
  const disabled = !cmd.hostId && !connected
  return (
    <div className="group relative rounded-lg border border-[var(--panel-border)] transition hover:border-[var(--accent)]">
      <button
        onClick={onRun}
        disabled={disabled}
        className="flex w-full items-start gap-3 p-3 pr-16 text-left disabled:opacity-50"
      >
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          <Play size={16} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--text-dark)]">{cmd.title}</div>
          {cmd.description && (
            <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-muted)]">
              {cmd.description}
            </div>
          )}
          {cmd.hostId && (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded bg-[var(--content-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
              <Server size={11} />
              {boundHost ? boundHost.label : '服务器已删除'}
            </span>
          )}
        </div>
      </button>
      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={onEdit}
          title="编辑"
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--text-dark)]"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={onDelete}
          title="删除"
          className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] hover:text-[var(--danger,#e5484d)]"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

/** 新增/编辑快捷命令的表单(内联在面板内)。 */
function QuickCommandForm({
  sessionId,
  connected,
  hosts,
  initial,
  onDone
}: {
  sessionId: string
  connected: boolean
  hosts: Host[]
  initial: QuickCommand | null
  onDone: () => void
}): React.ReactElement {
  const add = useQuickCommandsStore((s) => s.add)
  const update = useQuickCommandsStore((s) => s.update)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [commands, setCommands] = useState(initial?.commands ?? '')
  const [hostId, setHostId] = useState(initial?.hostId ?? '')

  const canSave = title.trim() !== '' && commands.trim() !== ''

  const save = (): void => {
    if (!canSave) return
    const payload = {
      title: title.trim(),
      description: description.trim(),
      commands,
      hostId: hostId || null
    }
    if (initial) update(initial.id, payload)
    else add(payload)
    onDone()
  }

  const test = (): void => {
    const batch = buildBatch(commands)
    if (batch && connected) window.api.ssh.write(sessionId, batch)
  }

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        title={initial ? '编辑快捷命令' : '新增快捷命令'}
        action={
          <button
            onClick={onDone}
            title="返回"
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            <X size={15} />
          </button>
        }
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <Field label="标题">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如:重启服务"
            className="input"
          />
        </Field>
        <Field label="描述">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="可选:这批命令做什么"
            className="input"
          />
        </Field>
        <Field label="命令(每行一条)">
          <textarea
            value={commands}
            onChange={(e) => setCommands(e.target.value)}
            rows={6}
            placeholder={'cd /var/www\ngit pull\nsystemctl restart nginx'}
            className="input resize-y font-mono"
          />
        </Field>
        <Field label="服务器">
          <Select
            value={hostId ?? ''}
            onChange={setHostId}
            options={[
              { value: '', label: '当前终端(不绑定)' },
              ...hosts.map((h) => ({ value: h.id, label: h.label }))
            ]}
          />
          <p className="mt-1 px-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
            选择服务器后,点击将新开标签页连接该服务器并执行;不选则在当前终端执行。
          </p>
        </Field>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--panel-border)] p-3">
        <button
          onClick={save}
          disabled={!canSave}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          保存
        </button>
        <button
          onClick={test}
          disabled={!connected || commands.trim() === ''}
          title={connected ? '在当前终端试跑这批命令' : '需要活动连接才能测试'}
          className="rounded-lg border border-[var(--panel-border)] px-3 py-1.5 text-sm font-medium text-[var(--text-dark)] transition hover:border-[var(--accent)] disabled:opacity-40"
        >
          测试
        </button>
        <button
          onClick={onDone}
          className="ml-auto rounded-lg px-3 py-1.5 text-sm text-[var(--text-muted)] transition hover:text-[var(--text-dark)]"
        >
          取消
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </span>
      {children}
    </label>
  )
}

// Fills a command into the terminal's current input line WITHOUT executing it (no '\n'),
// so the user can review/edit before pressing Enter. Shared by both sub-tabs.
function fillIntoTerminal(sessionId: string, command: string): void {
  window.api.ssh.write(sessionId, command)
}

function SearchBox({
  query,
  setQuery
}: {
  query: string
  setQuery: (v: string) => void
}): React.ReactElement {
  return (
    <div className="border-b border-[var(--panel-border)] p-2">
      <div className="flex items-center gap-2 rounded-lg bg-[var(--content-bg)] px-2.5 py-1.5">
        <Search size={14} className="text-[var(--text-muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索命令"
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>
    </div>
  )
}

function HistorySection({
  sessionId,
  hostId,
  connected
}: {
  sessionId: string
  hostId: string
  connected: boolean
}): React.ReactElement {
  const [subTab, setSubTab] = useState<'local' | 'server'>('local')

  return (
    <div className="flex h-full flex-col">
      <SectionHeader title="历史命令" />
      <div className="flex shrink-0 gap-1 border-b border-[var(--panel-border)] p-1.5">
        {(['local', 'server'] as const).map((id) => {
          const active = subTab === id
          return (
            <button
              key={id}
              onClick={() => setSubTab(id)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
                active
                  ? 'bg-[var(--nav-active-bg)] text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]'
              }`}
            >
              {id === 'local' ? '本地' : '服务器'}
            </button>
          )
        })}
      </div>
      {subTab === 'local' ? (
        <LocalHistory sessionId={sessionId} hostId={hostId} />
      ) : (
        <ServerHistory sessionId={sessionId} connected={connected} />
      )}
    </div>
  )
}

function LocalHistory({
  sessionId,
  hostId
}: {
  sessionId: string
  hostId: string
}): React.ReactElement {
  const entries = useCommandHistoryStore((s) => s.byHost[hostId] ?? EMPTY_ENTRIES)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void useCommandHistoryStore.getState().hydrate(hostId)
  }, [hostId])

  const filtered = [...entries]
    .reverse()
    .filter((e) => e.command.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end border-b border-[var(--panel-border)] px-2 py-1.5">
        {entries.length > 0 && (
          <button
            onClick={() => void useCommandHistoryStore.getState().clear(hostId)}
            title="清空该服务器的历史"
            className="flex items-center gap-1 rounded p-1 text-xs text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)]"
          >
            <Trash2 size={13} />
            清空
          </button>
        )}
      </div>
      <SearchBox query={query} setQuery={setQuery} />
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <div className="mt-10 text-center text-xs text-[var(--text-muted)]">
            {entries.length === 0 ? '暂无输入的命令' : '没有匹配的命令'}
          </div>
        )}
        {filtered.map((entry) => (
          <div
            key={entry.id}
            className="group flex items-center gap-2 px-2 hover:bg-[var(--nav-bg-hover)]"
          >
            <span
              title={entry.source === 'agent' ? '由智能体执行' : '用户输入'}
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                entry.source === 'agent'
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'bg-[var(--content-bg)] text-[var(--text-muted)]'
              }`}
            >
              {entry.source === 'agent' ? 'Agent' : 'User'}
            </span>
            <button
              onClick={() => fillIntoTerminal(sessionId, entry.command)}
              title="点击填入终端输入行(不自动执行)"
              className="min-w-0 flex-1 truncate py-2 text-left font-mono text-xs text-[var(--text-dark)]"
            >
              {entry.command}
            </button>
            <button
              onClick={() => void useCommandHistoryStore.getState().remove(hostId, entry.id)}
              title="删除这条"
              className="shrink-0 rounded p-1 text-[var(--text-muted)] opacity-0 transition hover:text-[var(--text-dark)] group-hover:opacity-100"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ServerHistory({
  sessionId,
  connected
}: {
  sessionId: string
  connected: boolean
}): React.ReactElement {
  const [commands, setCommands] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(connected)
  const [error, setError] = useState('')

  // Initial load + reload when the session/connection changes. setState only runs after
  // the await (the established pattern in MonitorPanel), guarded against unmount.
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    ;(async () => {
      try {
        const cmds = await fetchServerHistory(sessionId)
        if (!cancelled) {
          setCommands(cmds)
          setError('')
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, connected])

  // Manual refresh — an event handler, so setState here is fine.
  const refresh = async (): Promise<void> => {
    if (!connected) return
    setLoading(true)
    setError('')
    try {
      setCommands(await fetchServerHistory(sessionId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const filtered = commands.filter((c) => c.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end border-b border-[var(--panel-border)] px-2 py-1.5">
        <button
          onClick={() => void refresh()}
          disabled={!connected || loading}
          title="刷新"
          className="flex items-center gap-1 rounded p-1 text-xs text-[var(--text-muted)] hover:bg-[var(--nav-bg-hover)] disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>
      <SearchBox query={query} setQuery={setQuery} />
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!connected ? (
          <div className="mt-10 px-4 text-center text-xs text-[var(--text-muted)]">
            需要活动连接才能读取服务器历史
          </div>
        ) : error ? (
          <div className="mt-10 px-4 text-center text-xs text-[var(--danger,#e5484d)]">{error}</div>
        ) : loading && commands.length === 0 ? (
          <div className="mt-10 text-center text-xs text-[var(--text-muted)]">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="mt-10 text-center text-xs text-[var(--text-muted)]">
            {commands.length === 0 ? '未读取到服务器历史' : '没有匹配的命令'}
          </div>
        ) : (
          filtered.map((cmd, i) => (
            <button
              key={`${cmd}-${i}`}
              onClick={() => fillIntoTerminal(sessionId, cmd)}
              title="点击填入终端输入行(不自动执行)"
              className="block w-full truncate px-4 py-2 text-left font-mono text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]"
            >
              {cmd}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function ThemeSection({ sessionId }: { sessionId: string }): React.ReactElement {
  const currentId = useTerminalStore((s) => s.themeBySession[sessionId])
  const setTheme = useTerminalStore((s) => s.setTheme)
  const fontSize = useTerminalStore((s) => s.fontSizeBySession[sessionId] ?? DEFAULT_FONT_SIZE)
  const setFontSize = useTerminalStore((s) => s.setFontSize)
  const activeId = currentId ?? DEFAULT_THEME_ID

  return (
    <div className="flex h-full flex-col">
      <SectionHeader title="终端主题" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          {TERMINAL_THEMES.map((preset) => {
            const active = preset.id === activeId
            return (
              <button
                key={preset.id}
                onClick={() => setTheme(sessionId, preset.id)}
                className={`flex items-center gap-3 rounded-lg border p-2.5 text-left transition ${
                  active
                    ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
                    : 'border-[var(--panel-border)] hover:border-[var(--accent)]'
                }`}
              >
                <div
                  className="flex h-9 w-14 shrink-0 items-center justify-center rounded-md font-mono text-[11px]"
                  style={{
                    background: preset.theme.background,
                    color: preset.theme.foreground
                  }}
                >
                  $_
                </div>
                <span className="flex-1 text-sm font-medium text-[var(--text-dark)]">
                  {preset.name}
                </span>
                {active && <Check size={16} className="text-[var(--accent)]" />}
              </button>
            )
          })}
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            字号(仅终端)
          </div>
          <div className="flex items-center gap-2">
            <StepperButton
              onClick={() => setFontSize(sessionId, fontSize - 1)}
              disabled={fontSize <= MIN_FONT_SIZE}
            >
              <Minus size={15} />
            </StepperButton>
            <div className="min-w-[3.5rem] rounded-lg border border-[var(--panel-border)] py-1.5 text-center text-sm font-medium text-[var(--text-dark)]">
              {fontSize} px
            </div>
            <StepperButton
              onClick={() => setFontSize(sessionId, fontSize + 1)}
              disabled={fontSize >= MAX_FONT_SIZE}
            >
              <Plus size={15} />
            </StepperButton>
            {fontSize !== DEFAULT_FONT_SIZE && (
              <button
                onClick={() => setFontSize(sessionId, DEFAULT_FONT_SIZE)}
                className="ml-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline"
              >
                重置
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepperButton({
  onClick,
  disabled,
  children
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--panel-border)] text-[var(--text-dark)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
