/**
 * L0 — 终端刷新帧折叠。
 *
 * Docker BuildKit / npm / apt / pip 等的进度是靠回车(\r)、光标上移(ESC[nA)、
 * 擦除行(ESC[K)在同一区域反复"覆盖重绘"的。若只是把这些控制符删掉,每一帧的
 * 文本行都会被当成新行留下,一次 build 就能产生几万行几乎相同的输出,直接撑爆模型。
 *
 * 这里用一个极小的终端仿真:维护行缓冲 + 光标(row/col),按控制码真正地覆盖重绘,
 * 最终得到"人眼在终端里看到的那一屏结果"——进度块自然坍缩成最后一帧。
 *
 * 只处理与"重绘"相关的序列,SGR 颜色(m)、OSC 标题等一律丢弃;不追求像素级精确,
 * 目标是把刷屏输出压回到合理体积,同时不损失真正有信息量的行。
 */
export function foldTerminalOutput(raw: string): string {
  if (!raw) return ''
  // 兜底:超大输入(多为疯狂刷屏)先按字节保留首尾,避免仿真在病态单行上退化为 O(n^2)。
  const HARD_CAP = 8_000_000
  let input = raw
  if (input.length > HARD_CAP) {
    const keep = HARD_CAP / 2
    input = input.slice(0, keep) + '\n…[原始输出过大,已在折叠前预截断]…\n' + input.slice(-keep)
  }

  const lines: string[] = ['']
  let row = 0
  let col = 0

  const ensureRow = (): void => {
    while (lines.length <= row) lines.push('')
  }
  const put = (ch: string): void => {
    ensureRow()
    let l = lines[row]
    if (col > l.length) l = l + ' '.repeat(col - l.length)
    lines[row] = l.slice(0, col) + ch + l.slice(col + 1)
    col++
  }

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (ch === '\x1b') {
      const next = input[i + 1]
      // CSI: ESC [ params letter
      if (next === '[') {
        let j = i + 2
        let params = ''
        while (j < input.length && /[0-9;?]/.test(input[j])) {
          params += input[j]
          j++
        }
        const final = input[j]
        const n = parseInt(params, 10)
        const amt = isNaN(n) ? 1 : n
        switch (final) {
          case 'A':
            row = Math.max(0, row - amt)
            break
          case 'B':
            row += amt
            ensureRow()
            break
          case 'C':
            col += amt
            break
          case 'D':
            col = Math.max(0, col - amt)
            break
          case 'E':
            row += amt
            col = 0
            ensureRow()
            break
          case 'F':
            row = Math.max(0, row - amt)
            col = 0
            break
          case 'G':
            col = Math.max(0, amt - 1)
            break
          case 'H':
          case 'f': {
            const parts = params.split(';')
            const r = parseInt(parts[0], 10)
            const c = parseInt(parts[1], 10)
            row = Math.max(0, (isNaN(r) ? 1 : r) - 1)
            col = Math.max(0, (isNaN(c) ? 1 : c) - 1)
            ensureRow()
            break
          }
          case 'K': {
            ensureRow()
            const l = lines[row]
            if (isNaN(n) || n === 0) lines[row] = l.slice(0, col)
            else if (n === 1) lines[row] = ' '.repeat(Math.min(col, l.length)) + l.slice(col)
            else lines[row] = ''
            break
          }
          case 'J': {
            if (isNaN(n) || n === 0) {
              ensureRow()
              lines[row] = lines[row].slice(0, col)
              lines.length = row + 1
            } else if (n === 2 || n === 3) {
              lines.length = 0
              lines.push('')
              row = 0
              col = 0
            }
            break
          }
          default:
            break // SGR (m) 等一律忽略
        }
        i = j // 跳到终止字符,for 的 i++ 越过它
        continue
      }
      // OSC: ESC ] ... (BEL 或 ESC\ 结束) —— 窗口标题之类,整段丢弃
      if (next === ']') {
        let j = i + 2
        while (j < input.length && input[j] !== '\x07' && !(input[j] === '\x1b' && input[j + 1] === '\\')) j++
        i = input[j] === '\x1b' ? j + 1 : j
        continue
      }
      // 其他 ESC x(字符集切换等):跳过后一个字符
      i += 1
      continue
    }

    if (ch === '\n') {
      row++
      col = 0
      ensureRow()
      continue
    }
    if (ch === '\r') {
      col = 0
      continue
    }
    if (ch === '\t') {
      const stop = col + (8 - (col % 8))
      while (col < stop) put(' ')
      continue
    }
    if (ch === '\b') {
      col = Math.max(0, col - 1)
      continue
    }
    if (ch < ' ') continue // 其余控制字符丢弃

    put(ch)
  }

  // 去掉行尾空白(覆盖重绘常留下尾随空格),再合并
  return lines.map((l) => l.replace(/\s+$/, '')).join('\n')
}
