// Reads the server's own shell history file (bash/zsh). Tolerates either shell and
// strips the zsh extended-history prefix (`: <ts>:<elapsed>;cmd`).
export const SERVER_HISTORY_CMD =
  'for f in "${HISTFILE:-$HOME/.bash_history}" "$HOME/.zsh_history"; do ' +
  '[ -f "$f" ] && tail -n 500 "$f"; done'

/** Parse raw history-file text into a de-duped, most-recent-first command list. */
export function parseServerHistory(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw.split('\n')) {
    const m = line.match(/^: \d+:\d+;(.*)$/)
    const cmd = (m ? m[1] : line).trim()
    if (!cmd) continue
    // de-dupe keeping the most recent occurrence
    if (seen.has(cmd)) {
      const idx = out.indexOf(cmd)
      if (idx !== -1) out.splice(idx, 1)
    }
    seen.add(cmd)
    out.push(cmd)
  }
  return out.reverse() // most-recent-first
}

/** Fetch + parse the server's shell history over a one-off exec channel. */
export async function fetchServerHistory(sessionId: string): Promise<string[]> {
  const raw = await window.api.ssh.exec(sessionId, SERVER_HISTORY_CMD)
  return parseServerHistory(raw)
}
