/**
 * 一条消息能做哪几件事 —— 以及「撤回」和「重试」共同的那一刀
 * ===========================================================
 * 这三个判断原本写在 `ChatScreen` 的点击处理里，那样它们**只能在浏览器里
 * 点出来** —— 而「撤回要不要连后面的回答一起删」是个会答错的题：
 * 只删中间一条会留下一条答非所问的尾巴（问句没了、答案还挂着），
 * 而屏幕上没有任何东西解释那种错位。
 *
 * 提出来之后，每条规则都有一处可断言的定义（`scripts/verify-loop.mjs`）。
 *
 * ## 三种操作为什么按「条消息的形态」增减，而不是四样齐上
 *
 *   · **复制本条** 只在这条真有文字时给 —— 卡片形态的消息 `content` 是空的
 *     （内容在 `reply` / `meal` 里），复制一个空串等于复制了空气。
 *   · **撤回并重新编辑** 只有用户那条有：助手那条没有「原文」可放回输入框。
 *   · **重试** 只有助手那条有，而且**得找得到它要重跑的那句提问** ——
 *     翻一条旧对话时可能找不到（那一句在更早的会话里，或者它是这次对话的
 *     第一条）。找不到就不给这一项：给了一颗按下去什么都不发生的按钮，
 *     比没有这一项更让人困惑。
 */

/** 一条消息能做的事。顺序就是它们在面板上出现的顺序 */
export type ChatOp = 'copy' | 'undo' | 'retry' | 'delete'

/** 这个函数真正需要的两个字段（结构化，不是 `import type { ChatItem }`） */
interface OpSubject {
  role: 'user' | 'assistant'
  content: string
}

/**
 * @param hasQuestion 这条消息**之前**找不找得到一句用户提问（见 `questionBefore`）
 */
export function opsFor(item: OpSubject, hasQuestion: boolean): ChatOp[] {
  const ops: ChatOp[] = []
  if (item.content.trim()) ops.push('copy')
  if (item.role === 'user') ops.push('undo')
  else if (hasQuestion) ops.push('retry')
  ops.push('delete')
  return ops
}

/**
 * 这条消息**之前**最近的那句用户提问。
 *
 * 往回找，不是找全局第一条：一次会话里问过好几轮，
 * 「重试」要重跑的是**紧接着这一条**的那句，不是最开始那句。
 *
 * 返回 `null` 的两种情况都是真的：这是第一条消息（之前没有用户消息），
 * 或者之前那些用户消息都是空文字（发了图没提问那条路 —— `sendPhotos` 里
 * `question` 可以是空的）。
 */
export function questionBefore(items: readonly (OpSubject & { id: string })[], id: string): string | null {
  const at = items.findIndex((m) => m.id === id)
  if (at === -1) return null
  for (let i = at - 1; i >= 0; i--) {
    if (items[i].role === 'user' && items[i].content.trim()) return items[i].content.trim()
  }
  return null
}

/**
 * 从这一条**往后**全切掉（保留它前面的）。
 *
 * 「撤回并重新编辑」和「重试」共用这一刀，因为两件事都在说「从这一步开始重来」。
 *
 * ⚠️ 和「删除本条」是**两件不同的事**，别合并：删除只拿掉这一条，
 * 前后都留着（用户明确点的是「只删这一条」）。这个区别成文在
 * `ActionListSheet` 那两份 `hint` 里，用户看得见。
 *
 * id 找不到时**原样返回**：那说明这条消息已经不在列表里了（比如双击了同一颗
 * 按钮），此时正确的行为是什么都不做，而不是把整段对话清掉。
 */
export function cutFrom<T extends { id: string }>(items: readonly T[], id: string): T[] {
  const at = items.findIndex((m) => m.id === id)
  return at === -1 ? [...items] : items.slice(0, at)
}

/** 只拿掉这一条，前后的都留着 */
export function removeOne<T extends { id: string }>(items: readonly T[], id: string): T[] {
  return items.filter((m) => m.id !== id)
}
