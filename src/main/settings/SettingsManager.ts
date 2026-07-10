import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import {
  DEFAULT_APP_SETTINGS,
  MIN_TRANSFER_CONCURRENCY,
  MAX_TRANSFER_CONCURRENCY,
  type AppSettings
} from '../../shared/types'

/**
 * Lightweight, unencrypted persistence for non-sensitive app preferences.
 * Kept separate from the vault so settings are readable without unlocking.
 */
export class SettingsManager {
  private filePath: string
  private data: AppSettings

  constructor() {
    this.filePath = join(app.getPath('userData'), 'settings.json')
    this.data = this.load()
  }

  private load(): AppSettings {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<AppSettings>
        return this.sanitize(raw)
      }
    } catch {
      // fall through to defaults on any parse/read error
    }
    return { ...DEFAULT_APP_SETTINGS }
  }

  /** Coerce arbitrary/partial input into a valid, fully-populated settings object. */
  private sanitize(raw: Partial<AppSettings>): AppSettings {
    return {
      transferConcurrency: clampConcurrency(
        raw.transferConcurrency ?? DEFAULT_APP_SETTINGS.transferConcurrency
      )
    }
  }

  get(): AppSettings {
    return { ...this.data }
  }

  /** Merge a partial patch, persist, and return the effective settings. */
  update(patch: Partial<AppSettings>): AppSettings {
    this.data = this.sanitize({ ...this.data, ...patch })
    this.persist()
    return this.get()
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
  }
}

export function clampConcurrency(n: number): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return DEFAULT_APP_SETTINGS.transferConcurrency
  return Math.min(MAX_TRANSFER_CONCURRENCY, Math.max(MIN_TRANSFER_CONCURRENCY, v))
}

export const settingsManager = new SettingsManager()
