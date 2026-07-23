/** Path helpers shared by the SFTP explorer panes. Remote paths are POSIX;
 * local paths may be Windows (backslash) or POSIX. */

/** basename tolerating both '/' and '\\' separators. */
export function baseName(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** Parent of a remote (POSIX) path. */
export function remoteParent(path: string): string {
  if (path === '/' || path === '') return '/'
  const t = path.replace(/\/+$/, '')
  const i = t.lastIndexOf('/')
  return i <= 0 ? '/' : t.slice(0, i)
}

/** Parent of a local path (Windows- and POSIX-aware). Stays at drive/fs root. */
export function localParent(p: string): string {
  const t = p.replace(/[\\/]+$/, '')
  if (/^[a-zA-Z]:$/.test(t)) return `${t}\\` // C: -> C:\
  const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'))
  if (i < 0) return p
  const parent = t.slice(0, i)
  if (/^[a-zA-Z]:$/.test(parent)) return `${parent}\\`
  return parent || '/'
}

/** Join a name onto a local directory, guessing the separator from the dir. */
export function localJoin(dir: string, name: string): string {
  const sep = dir.includes('\\') || /^[a-zA-Z]:/.test(dir) ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + name
}

/** Join a name onto a remote (POSIX) directory. */
export function remoteJoin(dir: string, name: string): string {
  const d = dir.replace(/\/+$/, '')
  return d === '' ? `/${name}` : `${d}/${name}`
}

/** Drive root of a local Windows path ('D:\\foo' -> 'D:\\'); POSIX paths root at '/'. */
export function localRoot(p: string): string {
  const m = /^([a-zA-Z]):/.exec(p)
  return m ? `${m[1]}:\\` : '/'
}
