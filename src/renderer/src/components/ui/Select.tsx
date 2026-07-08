import * as RSelect from '@radix-ui/react-select'
import { ChevronDown, Check } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

// Radix forbids empty-string item values, so we map '' to an internal sentinel
// transparently for the "none/unset" option.
const NONE = '__none__'
const toInner = (v: string): string => (v === '' ? NONE : v)
const fromInner = (v: string): string => (v === NONE ? '' : v)

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className = ''
}: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
}): React.ReactElement {
  return (
    <RSelect.Root value={toInner(value)} onValueChange={(v) => onChange(fromInner(v))}>
      <RSelect.Trigger
        className={`input flex items-center justify-between gap-2 ${className}`}
        aria-label={placeholder}
      >
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon>
          <ChevronDown size={15} className="text-[var(--text-muted)]" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-[70] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--panel-border)] bg-[var(--panel-bg)] shadow-lg"
          style={{ minWidth: 'var(--radix-select-trigger-width)' }}
        >
          <RSelect.Viewport className="p-1">
            {options.map((opt) => (
              <RSelect.Item
                key={opt.value || NONE}
                value={toInner(opt.value)}
                className="relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-2.5 pr-8 text-sm text-[var(--text-dark)] outline-none data-[highlighted]:bg-[var(--nav-bg-hover)] data-[state=checked]:font-medium data-[state=checked]:text-[var(--accent)]"
              >
                <RSelect.ItemText>{opt.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="absolute right-2.5">
                  <Check size={14} />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}
