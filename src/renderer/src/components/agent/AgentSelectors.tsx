import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Cpu, Settings, ShieldCheck } from 'lucide-react'
import type { LlmSettingsPublic } from '@shared/types'
import { AGENT_MODES, modeInfo, type AgentMode } from '../../lib/agentPermissions'

/**
 * 智能体的「权限模式」与「模型」下拉框。终端智能体面板与远程桌面智能体面板共用,
 * 两处外观保持一致(原来远程桌面那边用的是原生 <select>)。
 */
export function ModeSelector({
  mode,
  onChange,
  side = 'top'
}: {
  mode: AgentMode
  onChange: (m: AgentMode) => void
  /** 菜单展开方向。控件在底部输入区时向上弹(默认),在面板顶部时传 'bottom'。 */
  side?: 'top' | 'bottom'
}): React.ReactElement {
  const info = modeInfo(mode)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]">
          <ShieldCheck size={13} className="text-[var(--accent)]" />
          {info.label}
          <ChevronDown size={12} className="text-[var(--text-muted)]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side={side}
          sideOffset={6}
          className="z-[70] w-[248px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
        >
          {AGENT_MODES.map((m) => (
            <DropdownMenu.Item
              key={m.id}
              onSelect={() => onChange(m.id)}
              className="flex cursor-pointer select-none items-start gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
            >
              <Check
                size={14}
                className={`mt-0.5 shrink-0 ${m.id === mode ? 'text-[var(--accent)]' : 'text-transparent'}`}
              />
              <div className="min-w-0">
                <div className="font-medium text-[var(--text-dark)]">{m.label}</div>
                <div className="text-xs leading-snug text-[var(--text-muted)]">{m.description}</div>
              </div>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function ModelSelector({
  settings,
  activeLabel,
  onPick,
  onManage,
  side = 'top',
  activeProviderId,
  activeModelId
}: {
  settings: LlmSettingsPublic | null
  activeLabel: string
  onPick: (providerId: string, modelId: string, modelName: string) => void
  onManage: () => void
  side?: 'top' | 'bottom'
  /** 打勾的那一项。缺省跟随全局设置;远程桌面按自己会话记录的模型来判定。 */
  activeProviderId?: string | null
  activeModelId?: string | null
}): React.ReactElement {
  const providers = settings?.providers ?? []
  const activePid = activeProviderId !== undefined ? activeProviderId : settings?.activeProviderId
  const activeMid = activeModelId !== undefined ? activeModelId : settings?.activeModelId
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex max-w-[150px] items-center gap-1 rounded-md border border-[var(--panel-border)] px-2 py-1 text-xs text-[var(--text-dark)] hover:bg-[var(--nav-bg-hover)]">
          <Cpu size={13} className="shrink-0 text-[var(--accent)]" />
          <span className="truncate">{activeLabel}</span>
          <ChevronDown size={12} className="shrink-0 text-[var(--text-muted)]" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          side={side}
          sideOffset={6}
          className="z-[70] max-h-[320px] w-[240px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
        >
          {providers.length === 0 && (
            <div className="px-2.5 py-2 text-xs text-[var(--text-muted)]">还没有供应商</div>
          )}
          {providers.map((p) => (
            <div key={p.id}>
              <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {p.name}
              </div>
              {p.models.length === 0 && (
                <div className="px-2.5 py-1 text-xs text-[var(--text-muted)]">(无模型)</div>
              )}
              {p.models.map((m) => {
                const active = p.id === activePid && m.id === activeMid
                return (
                  <DropdownMenu.Item
                    key={m.id}
                    onSelect={() => onPick(p.id, m.id, m.name)}
                    className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
                  >
                    <Check
                      size={13}
                      className={`shrink-0 ${active ? 'text-[var(--accent)]' : 'text-transparent'}`}
                    />
                    <span className="truncate font-mono text-xs">{m.label || m.name}</span>
                  </DropdownMenu.Item>
                )
              })}
            </div>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--panel-border)]" />
          <DropdownMenu.Item
            onSelect={onManage}
            className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-[var(--accent)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
          >
            <Settings size={13} />
            管理供应商 / 模型
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
