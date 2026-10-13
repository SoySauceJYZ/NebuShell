// Stand-in for `@electron-toolkit/preload` in the browser build. The renderer only reads
// `window.electron.process.platform` / `.versions`; on the web edition "local" is the
// server, so those describe the server (filled in by entry.ts from /api/info).

export const electronAPI = {
  process: {
    platform: 'linux' as string,
    versions: {} as Record<string, string>,
    env: {} as Record<string, string>
  }
}
