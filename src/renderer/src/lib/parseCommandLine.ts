/**
 * Extracts the actual command a user submitted by reading the rendered terminal line
 * (which already reflects tab-completion, history recall and paste) and stripping the
 * shell prompt prefix. Returns '' when no plausible command could be isolated, so the
 * caller can skip recording noise.
 */
// A candidate that still looks like a shell prompt (user@host … #/$) is not a command —
// this happens when the shell redraws the prompt (e.g. Enter on an empty line, or a
// duplicated prompt), producing "root@host:~# root@host:~#".
function looksLikePrompt(text: string): boolean {
  return /\S+@\S+.*[#$%>]\s*$/.test(text)
}

export function extractCommandFromLine(line: string): string {
  const trimmed = line.trimEnd()
  if (!trimmed) return ''

  // Preferred: prompts that contain a "user@host" segment, e.g.
  //   root@host:~# ls -la          or   [root@install1 ~]# docker ps
  const withUserHost = trimmed.match(/^.*?\S+@\S+.*?[#$%>]\s+(.*)$/)
  if (withUserHost) {
    const cmd = withUserHost[1].trim()
    return looksLikePrompt(cmd) ? '' : cmd
  }

  // Fallback: strip up to the first prompt symbol followed by whitespace.
  const generic = trimmed.match(/^[^#$%>]*[#$%>]\s+(.*)$/)
  if (generic) {
    const cmd = generic[1].trim()
    return looksLikePrompt(cmd) ? '' : cmd
  }

  // No recognizable prompt — don't record (avoids capturing banner/output lines).
  return ''
}
