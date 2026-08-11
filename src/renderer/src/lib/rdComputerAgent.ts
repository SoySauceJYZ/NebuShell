import type { ChatTool } from '@shared/types'
import type { AgentMode } from './agentPermissions'

// 远程桌面「画面操控 Agent」的工具定义与系统提示。工具是标准 function-calling(供应商无关),
// 模型每轮拿到一张被控屏截图(W×H 像素,原点左上),用这些工具点鼠标/敲键盘去操作 GUI。

export type RdActionName =
  | 'move_mouse'
  | 'click'
  | 'double_click'
  | 'type_text'
  | 'press_key'
  | 'scroll'
  | 'wait'
  | 'screenshot'
  | 'transfer_file'
  | 'ask_user'
  | 'present_plan'
  | 'done'

/** 键入文本 / 组合键视为「风险」动作(auto 模式下需确认);移动/点击/滚动/等待视为安全。 */
export function isRiskyComputerAction(name: string): boolean {
  return name === 'type_text' || name === 'press_key'
}

const T = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ChatTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } }
})

const num = { type: 'number' as const }

const MOVE = T('move_mouse', '把鼠标移动到屏幕坐标 (x,y)。', { x: num, y: num }, ['x', 'y'])
const CLICK = T(
  'click',
  '在 (x,y) 处单击。button 可为 left/right/middle,默认 left。',
  { x: num, y: num, button: { type: 'string', enum: ['left', 'right', 'middle'] } },
  ['x', 'y']
)
const DOUBLE = T('double_click', '在 (x,y) 处双击(左键)。', { x: num, y: num }, ['x', 'y'])
const TYPE = T('type_text', '在当前焦点处键入一段文本(会正确处理大小写/符号/中文)。', { text: { type: 'string' } }, ['text'])
const KEY = T(
  'press_key',
  '按下一个组合键,如 "enter"、"ctrl+c"、"alt+F4"、"win+r"。多个键用 + 连接。',
  { keys: { type: 'string' } },
  ['keys']
)
const SCROLL = T(
  'scroll',
  '在 (x,y) 处滚动。direction 为 up/down,amount 为滚动格数(默认 3)。',
  { x: num, y: num, direction: { type: 'string', enum: ['up', 'down'] }, amount: num },
  ['x', 'y', 'direction']
)
const WAIT = T('wait', '等待若干秒后再截图(等界面加载/动画完成)。', { seconds: num })
const SHOT = T('screenshot', '重新截取当前屏幕(通常无需显式调用,每步后会自动提供新截图)。', {})
const TRANSFER = T(
  'transfer_file',
  '把控制端本机的一个文件推送到被控机的「下载」目录。path 为控制端上的绝对路径。',
  { path: { type: 'string' } },
  ['path']
)
const ASK = T(
  'ask_user',
  '需要用户澄清/决策时提问。可给若干候选项。',
  { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
  ['question']
)
const PLAN = T('present_plan', '给出将要执行的操作方案(计划模式下用),等待用户确认。', { plan: { type: 'string' } }, ['plan'])
const DONE = T('done', '目标已完成或无法继续时调用,summary 说明结果。', { summary: { type: 'string' } })

/** 按权限模式给工具集:plan 模式只给观察/计划类,不给任何输入动作。 */
export function buildRdAgentTools(mode: AgentMode): ChatTool[] {
  if (mode === 'plan') return [SHOT, PLAN, ASK, DONE]
  return [MOVE, CLICK, DOUBLE, TYPE, KEY, SCROLL, WAIT, SHOT, TRANSFER, ASK, DONE]
}

export function buildRdSystemPrompt(mode: AgentMode, screen: { w: number; h: number }): string {
  const modeHint =
    mode === 'plan'
      ? '当前为「计划模式」:只观察截图并用 present_plan 给出操作方案,不要执行任何鼠标键盘动作。'
      : mode === 'ask'
        ? '当前为「请求批准」:每一步动作都会先让用户确认后才执行。'
        : mode === 'auto'
          ? '当前为「替我审批」:移动/点击/滚动会自动执行,键入文本与组合键需用户确认。'
          : '当前为「完全访问」:所有动作自动执行。'
  return [
    '你是一个远程桌面操作助手,通过「看截图 + 点鼠标/敲键盘」来操作一台**被控 Windows 电脑**的图形界面,替用户完成任务。',
    `每一步你会收到一张被控屏截图,尺寸为 ${screen.w}×${screen.h} 像素,坐标原点在左上角,x 向右、y 向下。所有坐标都以该尺寸为准。`,
    '可用动作:move_mouse / click / double_click / type_text / press_key / scroll / wait / screenshot / transfer_file / ask_user / present_plan / done。',
    '要点:',
    '1. 一次只做少量、确定的动作;每步后都会自动收到新截图,据此判断是否成功再决定下一步。',
    '2. 打开程序:点开始菜单或任务栏,或用 press_key "win+r" 打开运行框再 type_text。',
    '3. 输入前先点好输入框获得焦点,再用 type_text;组合键(回车、复制等)用 press_key。',
    '4. 坐标要对准目标元素中心。看不清或不确定时,先移动/截图确认,必要时 ask_user。',
    '5. 完成或确实无法继续时调用 done 并说明结果。回复用简体中文。',
    modeHint
  ].join('\n')
}

/** 把 "ctrl+c"、"win+r"、"enter" 这样的组合键解析成一串 DOM code(供 InputInjector 的 key 分支使用)。 */
export function keyChordToCodes(chord: string): string[] {
  const parts = chord
    .split('+')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const codes: string[] = []
  for (const p of parts) {
    const c = KEY_ALIAS[p] ?? singleKeyToCode(p)
    if (c) codes.push(c)
  }
  return codes
}

function singleKeyToCode(k: string): string | null {
  if (/^[a-z]$/.test(k)) return 'Key' + k.toUpperCase()
  if (/^[0-9]$/.test(k)) return 'Digit' + k
  if (/^f([1-9]|1[0-2])$/.test(k)) return 'F' + k.slice(1)
  return null
}

const KEY_ALIAS: Record<string, string> = {
  ctrl: 'ControlLeft', control: 'ControlLeft',
  alt: 'AltLeft', option: 'AltLeft',
  shift: 'ShiftLeft',
  win: 'MetaLeft', meta: 'MetaLeft', cmd: 'MetaLeft', super: 'MetaLeft',
  enter: 'Enter', return: 'Enter',
  esc: 'Escape', escape: 'Escape',
  tab: 'Tab', space: 'Space', spacebar: 'Space',
  backspace: 'Backspace', bksp: 'Backspace',
  delete: 'Delete', del: 'Delete', insert: 'Insert',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  capslock: 'CapsLock',
  minus: 'Minus', equal: 'Equal', plus: 'Equal',
  comma: 'Comma', period: 'Period', slash: 'Slash', backslash: 'Backslash',
  semicolon: 'Semicolon', quote: 'Quote', backquote: 'Backquote', tilde: 'Backquote'
}
