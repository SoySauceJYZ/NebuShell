import * as pty from 'node-pty'
import { homedir } from 'os'
import type { RdShellOpts } from '../../shared/types'

// 远程命令行(被控端)。用 node-pty(Windows 走 ConPTY)在被控机上起一个真实终端进程,
// stdout/stderr 通过回调外抛给渲染层,再经 WebRTC 的 shell DataChannel 送回控制端;控制端
// 的按键沿反向路径写回 pty。支持 PowerShell 与 cmd,第一步聚焦 Windows。

class RemoteShell {
  private procs = new Map<string, pty.IPty>()

  start(
    id: string,
    opts: RdShellOpts,
    onData: (data: string) => void,
    onExit: (code: number) => void
  ): void {
    this.kill(id)
    const isWin = process.platform === 'win32'
    let file: string
    let args: string[] = []
    if (opts.shell === 'cmd') {
      file = isWin ? 'cmd.exe' : '/bin/sh'
    } else {
      // 非 Windows 也允许:回退到用户默认 shell,便于将来跨平台。
      file = isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash'
      if (isWin) args = ['-NoLogo']
    }
    const proc = pty.spawn(file, args, {
      name: 'xterm-color',
      cols: Math.max(1, opts.cols || 80),
      rows: Math.max(1, opts.rows || 24),
      cwd: process.env.USERPROFILE || homedir(),
      env: process.env as Record<string, string>
    })
    proc.onData((d) => onData(d))
    proc.onExit(({ exitCode }) => {
      this.procs.delete(id)
      onExit(exitCode)
    })
    this.procs.set(id, proc)
  }

  write(id: string, data: string): void {
    this.procs.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.procs.get(id)?.resize(Math.max(1, cols), Math.max(1, rows))
    } catch {
      /* pty already gone */
    }
  }

  kill(id: string): void {
    const proc = this.procs.get(id)
    if (!proc) return
    this.procs.delete(id)
    try {
      proc.kill()
    } catch {
      /* ignore */
    }
  }

  killAll(): void {
    for (const id of [...this.procs.keys()]) this.kill(id)
  }
}

export const remoteShell = new RemoteShell()
