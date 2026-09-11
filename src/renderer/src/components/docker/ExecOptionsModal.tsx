import { useState } from 'react'
import type { ExecShellOptions } from '../../lib/dockerContainers'

/**
 * 「自定义进入容器」:指定用户 / 工作目录 / shell 再开容器终端。
 * 以 root 排查权限问题、直奔 /app 目录、或者镜像里只有 ash 时,都靠它。
 */
export function ExecOptionsModal({
  containerName,
  onCancel,
  onConfirm
}: {
  containerName: string
  onCancel: () => void
  onConfirm: (opts: ExecShellOptions) => void
}): React.ReactElement {
  const [user, setUser] = useState('')
  const [workdir, setWorkdir] = useState('')
  const [shell, setShell] = useState('')

  const submit = (): void =>
    onConfirm({
      user: user.trim() || undefined,
      workdir: workdir.trim() || undefined,
      shell: shell.trim() || undefined
    })

  return (
    <div
      className="absolute inset-0 z-[90] flex items-center justify-center bg-black/30"
      onMouseDown={onCancel}
    >
      <div
        className="w-80 rounded-[var(--radius)] border border-[var(--panel-border)] bg-[var(--panel-bg)] p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-sm font-medium text-[var(--text-dark)]">进入容器</div>
        <div className="mb-3 truncate text-xs text-[var(--text-muted)]" title={containerName}>
          {containerName}
        </div>
        <div className="flex flex-col gap-2.5">
          <Field
            label="用户"
            placeholder="留空 = 镜像默认(常见:root)"
            value={user}
            onChange={setUser}
          />
          <Field
            label="工作目录"
            placeholder="留空 = 镜像默认(如 /app)"
            value={workdir}
            onChange={setWorkdir}
          />
          <Field
            label="Shell"
            placeholder="留空 = bash 优先,回退 sh"
            value={shell}
            onChange={setShell}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary px-3 py-1.5 text-xs">
            取消
          </button>
          <button onClick={submit} className="btn-primary px-3 py-1.5 text-xs">
            进入
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  placeholder,
  value,
  onChange
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}): React.ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <input
        className="input w-full text-xs"
        placeholder={placeholder}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
