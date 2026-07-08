import * as ContextMenu from '@radix-ui/react-context-menu'
import { Copy, ClipboardPaste, FilePenLine, PlaySquare } from 'lucide-react'

/**
 * Right-click menu for the terminal. It only opens when there is a selection; the
 * caller suppresses the event (and does a direct paste) via a capture-phase handler
 * when nothing is selected, so no-selection right-click keeps pasting as before.
 */
export function TerminalContextMenu({
  onCopy,
  onPaste,
  onEdit,
  onEditResult,
  children
}: {
  onCopy: () => void
  onPaste: () => void
  onEdit: () => void
  onEditResult: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-[70] min-w-[180px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-1 shadow-lg">
          <Item icon={Copy} label="复制" onSelect={onCopy} />
          <Item icon={ClipboardPaste} label="粘贴" onSelect={onPaste} />
          <ContextMenu.Separator className="my-1 h-px bg-[var(--panel-border)]" />
          <Item icon={FilePenLine} label="编辑" onSelect={onEdit} />
          <Item icon={PlaySquare} label="编辑执行结果" onSelect={onEditResult} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function Item({
  icon: Icon,
  label,
  onSelect
}: {
  icon: typeof Copy
  label: string
  onSelect: () => void
}): React.ReactElement {
  return (
    <ContextMenu.Item
      onSelect={onSelect}
      className="flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)]"
    >
      <Icon size={15} strokeWidth={1.75} className="text-[var(--text-muted)]" />
      {label}
    </ContextMenu.Item>
  )
}
