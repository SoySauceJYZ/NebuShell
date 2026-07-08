import type { ChatTool } from '@shared/types'
import type { AgentMode } from './agentPermissions'

export interface AgentTarget {
  sessionId: string
  name: string // stable short name shown to user + used by the LLM as `target`
  host: string // host address/label for context
}

export function buildRunCommandTool(targets: AgentTarget[]): ChatTool {
  const multi = targets.length > 1
  const properties: Record<string, unknown> = {
    command: {
      type: 'string',
      description: '要执行的单条 shell 命令,例如 "df -h" 或 "systemctl status nginx"'
    }
  }
  const required = ['command']
  if (targets.length > 0) {
    properties.target = {
      type: 'string',
      enum: targets.map((t) => t.name),
      description: multi
        ? `在哪个终端执行。可选:${targets.map((t) => `${t.name}(${t.host})`).join('、')}。不填则用 ${targets[0].name}。`
        : `目标终端(当前只有 ${targets[0].name})。`
    }
    if (multi) required.push('target')
  }
  return {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        '在指定的服务器终端里执行一条 shell 命令,返回其标准输出与退出码。用于查看状态、诊断,以及在用户确认后进行运维操作。多终端时用 target 指定在哪台机器执行。',
      parameters: { type: 'object', properties, required }
    }
  }
}

export const READ_COMMAND_OUTPUT_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'read_command_output',
    description:
      '当某条命令的输出因过长被截断(结果里带有 #xxxxxx 标记)时,用它按需检索该命令的完整输出,而不是让用户重新执行命令。可按关键字过滤、取头/尾若干行、或取指定行号区间。一次尽量缩小范围(优先 grep 关键字)。',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: '要检索的输出标记(截断提示里的 #xxxxxx,只填 6 位字符)' },
        grep: { type: 'string', description: '按关键字/正则(不区分大小写)过滤行,如 "error"、"fail"' },
        head: { type: 'number', description: '只取前 N 行' },
        tail: { type: 'number', description: '只取后 N 行' },
        range: {
          type: 'array',
          items: { type: 'number' },
          description: '取行号区间 [起, 止](1 起,含端点)'
        }
      },
      required: ['ref']
    }
  }
}

export const ASK_USER_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'ask_user',
    description:
      '在需要用户做关键决策、或缺少必要信息无法继续时,向用户提问。可给出若干选项供其选择(也可让其自由输入)。收到回答后再继续。计划模式下尤其应主动用它厘清需求,而不是自行假设。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '要问用户的问题(简洁明确)' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '可选项(2~5 个,可省略;省略时用户自由输入)'
        }
      },
      required: ['question']
    }
  }
}

export const PRESENT_PLAN_TOOL: ChatTool = {
  type: 'function',
  function: {
    name: 'present_plan',
    description:
      '仅在「计划模式」下使用:当方案已经完整、可以交付执行时,调用它把最终方案呈现给用户确认。用户点「开始执行」后会自动切换到执行模式并让你逐条执行;不要在计划模式里直接尝试写操作。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '方案标题(简短)' },
        plan: { type: 'string', description: '完整方案,Markdown,含步骤与对应命令' }
      },
      required: ['plan']
    }
  }
}

const MODE_HINT: Record<AgentMode, string> = {
  plan: '当前为「计划模式」:只允许只读命令用于调查,写操作会被系统拦截。请先产出完整方案(步骤 + 对应命令)。遇到关键决策或信息不足时,主动调用 ask_user 向用户提问(尽量给选项),得到回答后再继续完善方案,不要自行臆测。方案完整后,调用 present_plan 呈现最终方案供用户确认执行(不要在本模式直接执行写操作)。',
  ask: '当前为「请求批准模式」:每条命令都需要用户逐条确认后才会执行。',
  auto: '当前为「替我审批模式」:只读命令会自动执行,风险/写操作仍需用户确认。',
  full: '当前为「完全访问模式」:命令会自动执行,请务必谨慎,破坏性操作先说明影响。'
}

export function buildSystemPrompt(targets: AgentTarget[], mode: AgentMode = 'ask'): string {
  const targetBlock =
    targets.length === 0
      ? '当前没有可用的终端连接,若需要执行命令请提示用户先打开并连接一个终端。'
      : targets.length === 1
        ? `当前目标终端:${targets[0].name}(主机 ${targets[0].host})。`
        : [
            '当前可用的终端(可跨多台服务器,用于集群部署):',
            ...targets.map((t, i) => `- ${t.name} → 主机 ${t.host}${i === 0 ? '(默认/当前)' : ''}`),
            '调用 run_command 时用 target 参数指定在哪个终端执行;不填默认第一个。集群任务请按节点分别下发命令。'
          ].join('\n')
  return [
    '你是一个嵌入 SSH 客户端里的运维助手(智能体)。你可以回答运维/Linux/网络等问题,',
    '也可以通过 run_command 工具在服务器终端上执行命令来查看状态或完成运维操作(支持多台终端)。',
    targetBlock,
    MODE_HINT[mode],
    '规则:',
    '1. 需要获取服务器真实信息或执行操作时,调用 run_command,一次一条、尽量精简,并指明 target。',
    '2. 破坏性或有风险的命令(删除、覆盖、重启服务、改配置等)务必先说明其作用与影响。',
    '3. 遇到关键决策或信息不足时,调用 ask_user 向用户提问(尽量带选项),得到回答后再继续。',
    '4. 若命令被拒绝或被拦截,请据此调整方案,不要重复强推。',
    '5. 拿到命令输出后,用简洁中文解释结论,不要机械地照抄整段输出。',
    '6. 命令输出过长时系统会自动截断,并给出 #xxxxxx 标记与总行数。若截断部分对判断很关键(例如要看完整报错),用 read_command_output 按需检索(优先 grep 关键字或取尾部),不要让用户重跑命令。',
    '7. 回答使用 Markdown。'
  ].join('\n')
}
