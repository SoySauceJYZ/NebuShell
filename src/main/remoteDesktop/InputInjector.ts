import { mouse, keyboard, Button, Key, Point, screen } from '@nut-tree-fork/nut-js'
import type { RdInputEvent } from '../../shared/types'

// 远程桌面被控端:把控制端转发来的输入事件注入到本机真实桌面。
// 坐标为相对被控端主屏的归一化值(0..1),这里乘以主屏像素分辨率还原为绝对坐标。
// nut.js 的调用是异步的,用一个串行队列保证「先移动后按下」这类顺序不被打乱。

// 关闭 nut.js 每次操作后的自动延时,降低远程操控的延迟。
mouse.config.autoDelayMs = 0
keyboard.config.autoDelayMs = 0

/** DOM KeyboardEvent.code → nut.js Key 的映射。未收录的键会被忽略。 */
const KEY_MAP: Record<string, Key> = {
  // 字母
  KeyA: Key.A, KeyB: Key.B, KeyC: Key.C, KeyD: Key.D, KeyE: Key.E, KeyF: Key.F,
  KeyG: Key.G, KeyH: Key.H, KeyI: Key.I, KeyJ: Key.J, KeyK: Key.K, KeyL: Key.L,
  KeyM: Key.M, KeyN: Key.N, KeyO: Key.O, KeyP: Key.P, KeyQ: Key.Q, KeyR: Key.R,
  KeyS: Key.S, KeyT: Key.T, KeyU: Key.U, KeyV: Key.V, KeyW: Key.W, KeyX: Key.X,
  KeyY: Key.Y, KeyZ: Key.Z,
  // 数字(主键盘)
  Digit0: Key.Num0, Digit1: Key.Num1, Digit2: Key.Num2, Digit3: Key.Num3,
  Digit4: Key.Num4, Digit5: Key.Num5, Digit6: Key.Num6, Digit7: Key.Num7,
  Digit8: Key.Num8, Digit9: Key.Num9,
  // 小键盘
  Numpad0: Key.NumPad0, Numpad1: Key.NumPad1, Numpad2: Key.NumPad2, Numpad3: Key.NumPad3,
  Numpad4: Key.NumPad4, Numpad5: Key.NumPad5, Numpad6: Key.NumPad6, Numpad7: Key.NumPad7,
  Numpad8: Key.NumPad8, Numpad9: Key.NumPad9,
  NumpadAdd: Key.Add, NumpadSubtract: Key.Subtract, NumpadMultiply: Key.Multiply,
  NumpadDivide: Key.Divide, NumpadDecimal: Key.Decimal, NumpadEnter: Key.Enter,
  // 功能键
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  // 修饰键
  ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
  ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
  AltLeft: Key.LeftAlt, AltRight: Key.RightAlt,
  MetaLeft: Key.LeftSuper, MetaRight: Key.RightSuper,
  CapsLock: Key.CapsLock,
  // 编辑/导航
  Enter: Key.Return, Backspace: Key.Backspace, Tab: Key.Tab, Space: Key.Space,
  Escape: Key.Escape, Delete: Key.Delete, Insert: Key.Insert,
  Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
  ArrowLeft: Key.Left, ArrowUp: Key.Up, ArrowRight: Key.Right, ArrowDown: Key.Down,
  // 标点/符号
  Backquote: Key.Grave, Minus: Key.Minus, Equal: Key.Equal,
  BracketLeft: Key.LeftBracket, BracketRight: Key.RightBracket, Backslash: Key.Backslash,
  Semicolon: Key.Semicolon, Quote: Key.Quote, Comma: Key.Comma, Period: Key.Period,
  Slash: Key.Slash
}

const BUTTON_MAP: Record<number, Button> = {
  0: Button.LEFT,
  1: Button.MIDDLE,
  2: Button.RIGHT
}

/** 当前被控显示器在「全局虚拟桌面」中的物理像素边界(支持多显示器,原点可为负)。 */
interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

class InputInjector {
  /** 归一化坐标映射到的目标显示器边界。默认整块虚拟桌面从 (0,0) 起。 */
  private bounds: DisplayBounds = { x: 0, y: 0, width: 0, height: 0 }
  /** 串行队列:保证事件按到达顺序依次注入(避免 move 与 click 竞争)。 */
  private tail: Promise<void> = Promise.resolve()

  /** 设置当前被控显示器的边界(由 main 按 Electron display 换算成物理像素后传入)。 */
  setActiveDisplay(bounds: DisplayBounds): void {
    this.bounds = bounds
  }

  /** 回退:用 nut.js 量主屏分辨率作为边界(未显式 setActiveDisplay 时兜底)。 */
  async refreshScreenSize(): Promise<{ width: number; height: number }> {
    const width = await screen.width()
    const height = await screen.height()
    if (!this.bounds.width || !this.bounds.height) {
      this.bounds = { x: 0, y: 0, width, height }
    }
    return { width, height }
  }

  /** 入队一个输入事件;错误只记录不抛出,避免拖垮队列。 */
  enqueue(ev: RdInputEvent): void {
    this.tail = this.tail.then(() => this.apply(ev)).catch((e) => {
      console.error('[remoteDesktop] inject failed:', e)
    })
  }

  private async apply(ev: RdInputEvent): Promise<void> {
    if (!this.bounds.width || !this.bounds.height) await this.refreshScreenSize()
    switch (ev.type) {
      case 'move':
        await mouse.setPosition(this.toPoint(ev.x, ev.y))
        break
      case 'down':
        await mouse.setPosition(this.toPoint(ev.x, ev.y))
        await mouse.pressButton(BUTTON_MAP[ev.button] ?? Button.LEFT)
        break
      case 'up':
        await mouse.setPosition(this.toPoint(ev.x, ev.y))
        await mouse.releaseButton(BUTTON_MAP[ev.button] ?? Button.LEFT)
        break
      case 'wheel': {
        const steps = Math.max(1, Math.round(Math.abs(ev.dy) / 100))
        if (ev.dy > 0) await mouse.scrollDown(steps)
        else if (ev.dy < 0) await mouse.scrollUp(steps)
        break
      }
      case 'key': {
        const key = KEY_MAP[ev.code]
        if (key === undefined) return
        if (ev.down) await keyboard.pressKey(key)
        else await keyboard.releaseKey(key)
        break
      }
    }
  }

  private toPoint(xNorm: number, yNorm: number): Point {
    const x = Math.round(this.bounds.x + clamp01(xNorm) * this.bounds.width)
    const y = Math.round(this.bounds.y + clamp01(yNorm) * this.bounds.height)
    return new Point(x, y)
  }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

export const inputInjector = new InputInjector()
