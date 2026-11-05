import type { Attachment } from '@shared/types'
import { buildConversationDigest, type ConversationRef } from '@shared/conversationDigest'
import { attachmentFromText } from './attachments'

/**
 * @ 引用历史会话:全文进附件缓存(read_attachment 可检索),
 * 随消息走的预览是「最初需求 + 最近部分」。整理逻辑在 @shared/conversationDigest。
 */

export { buildConversationDigest, type ConversationRef }

/** 载入被引用的会话并转成附件;会话为空或读取失败时返回 null。 */
export async function conversationAttachment(ref: ConversationRef): Promise<Attachment | null> {
  const messages = await window.api.agentChat.load(ref.hostId, ref.convId)
  if (!messages.length) return null
  const { text, preview } = buildConversationDigest(messages, ref)
  return attachmentFromText(`会话: ${ref.title}`, text, 'conversation', preview)
}
