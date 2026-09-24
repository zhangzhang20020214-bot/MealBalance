/**
 * 对话页的会话历史 —— 左侧抽屉里那份列表
 * ===========================================================
 * 对话页原来只有「这一次会话」：刷新一下，聊天内容就没了。这个文件把会话
 * 存下来，于是三件事才有可能：左侧那份历史列表、点进去翻旧对话、
 * 「撤回并重新编辑」（它得知道被撤回的那句原文是什么）。
 *
 * ## 为什么不并进 `AppState`（三条理由，和 `unlogged.ts` 是同一套）
 *
 * 1. **并进去要 bump `SCHEMA_VERSION`**，而 `persist.ts` 的 `isAppState` 是
 *    白名单守卫 —— 代价是清掉用户已有的全部记录，换来的只是聊过什么话。
 * 2. **它坏掉不该连累整本日记。** 独立 key 坏了大不了历史列表是空的；
 *    并进去的话，一个类型不对的字段会让整份日记读不出来。
 * 3. **`stripThumbs` 只剥 `meals`。** 这个文件带来的是一份**大得多**的载荷
 *    （见下面「落盘的不是 `ChatItem` 原样」），而配额写满那条路径刚刚才因为
 *    「只剥了当前档案」被修过一次 —— 再往里塞一份大载荷是在同一个地方
 *    再赌一次。
 *
 * ## 按档案分（和 `unlogged.ts` 同一个理由，但这里更要紧）
 *
 * `App.tsx` 用 `key={activeProfileId}` 强制换档案时把对话页整个重挂载，
 * 那是挡住「档案 A 的问题由带档案 B 上下文的会话回答」的那道闸门。
 * 历史记录不跟着分，那道闸门就白设了：切到 B 还能翻出 A 问过的话，
 * 而屏幕上写着的是 B 的档案。
 *
 * ## 落盘的不是 `ChatItem` 原样（两个字段必须丢掉，一个字段必须换掉）
 *
 * · **`photos` 丢掉。** 那是 `URL.createObjectURL` 出来的 `blob:` 地址，
 *   只在**当前这个 document** 里有效。存下来再读回来是一串死链接，
 *   界面上表现成一条空白图 —— 一个没有任何解释的破图。
 * · **`run` 丢掉。** 那是「正在识别第 2 张，共 3 张」的在途状态。
 *   存下来意味着下次进来屏幕上永远停着一个转不完的圈。
 * · **`meal.photoUrl` 丢掉、`meal.thumbDataUrl` 也丢掉。** 前者同上（object URL）；
 *   后者是 data URL，一个几十 KB，攒几十次会话就是几 MB —— 而配额写满会
 *   连累**整份日记**（`saveState` 写不进去）。丢掉它的代价是「翻旧对话时
 *   那张结果卡没有照片」，这句话写在界面上是看得懂的缺失，比写不进去强。
 *
 * ⚠️ `photos` 丢掉这件事**只在历史里有**：当前这次会话仍然显示原图
 * （`ChatItem.photos` 那段注释说的「不换成缩略图」一个字没改）——
 * 用户看自己刚发出去的图，和翻三天前的旧对话，本来就该是两个期待。
 *
 * ## 读写真失败时不播提示
 *
 * 和 `unlogged.ts` 同款：历史存不下只是「这次聊的没记住」，为它弹一条
 * 「存储空间不足」会把一次无关紧要的失败说成一次数据损失。
 */

import type { AgentReply } from '../lib/agentReply'
import { appStorage, type StorageLike } from './persist'
import type { RecognizedMeal } from './recognize'

/**
 * 键名带版本段，和 `mealbalance:v1` / `mealbalance:unlogged:v1` 同一个写法。
 *
 * 这里**没有** `SCHEMA_VERSION` 那套迁移：形状对不上就整份丢掉
 * （见 `parseChatLog`）。丢的是聊天记录，不是日记。
 */
const CHAT_KEY = 'mealbalance:chat:v1'

/**
 * 落在盘上的一条消息。
 *
 * 比 `ChatItem` 少三个字段（见文件头那段），所以它**不是** `ChatItem` 的别名 ——
 * 两个类型长得像但不相等这件事，正是这层映射存在的理由。
 */
export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  reply?: AgentReply
  meal?: RecognizedMeal
}

export interface ChatSession {
  id: string
  /** 见文件头第 2 段：切档案不该翻出别人名下的对话 */
  profileId: string
  /** 最后一次说话的时刻。列表按它倒序（不是创建时刻 —— 那和「最近聊的」不是一回事） */
  at: number
  items: ChatTurn[]
}

/* ------------------------------------------------------------
   `ChatItem` → `ChatTurn`：丢掉那三个字段的那一步
   ------------------------------------------------------------ */

/**
 * 输入类型是**结构化**的、不是 `import type { ChatItem }`：
 * 一个 store 反向依赖组件（`components/ChatTranscript`）会把依赖方向倒过来，
 * 而这个函数真正需要的只是这六个键，不需要那个类型本身。
 * （`ChatItem` 满足这个形状，所以调用处不用做任何转换。）
 */
export interface TurnSource {
  id: string
  role: 'user' | 'assistant'
  content: string
  photos?: string[]
  run?: unknown
  meal?: RecognizedMeal
  reply?: AgentReply
}

/** 一次会话里**真正值得留下的**那些消息 —— 见文件头那三条 */
export function toTurn(item: TurnSource): ChatTurn {
  const meal = item.meal ? withoutBlobs(item.meal) : undefined
  return {
    id: item.id,
    role: item.role,
    content: item.content,
    ...(item.reply ? { reply: item.reply } : {}),
    ...(meal ? { meal } : {}),
  }
}

/**
 * 剥掉那一餐里的两个图片字段。
 *
 * 用**解构**而不是 `delete`：`delete` 会改到传进来的那个对象，而这个函数
 * 是照着「输入只读」写的（调用方手上那份 `ChatItem.meal` 还要继续渲染，
 * 把它的照片删掉会让**当前这次会话**的图也消失 —— 一个只有刷新前才看得见的
 * bug）。条件展开那两处同理，见 `store.ts` 里 thumb 那段的注释。
 */
function withoutBlobs(meal: RecognizedMeal): RecognizedMeal {
  const { photoUrl: _photoUrl, thumbDataUrl: _thumbDataUrl, ...rest } = meal
  return rest
}

/* ------------------------------------------------------------
   纯函数：列表操作。都不碰存储，所以每条都能单独断言
   ------------------------------------------------------------ */

/** 这个档案的会话，按最近说话倒序 */
export function sessionsOf(sessions: readonly ChatSession[], profileId: string): ChatSession[] {
  return sessions.filter((s) => s.profileId === profileId).sort((a, b) => b.at - a.at)
}

/**
 * 列表上那句「N 轮」的 N。
 *
 * 数的是**用户说了几句**，不是消息总条数 —— 「轮」是问答一次，
 * 把助手那条也算进去会让每一轮都变成 2 轮。
 */
export function roundCount(session: ChatSession): number {
  return session.items.filter((t) => t.role === 'user').length
}

/**
 * 列表上那一行标题：**第一句用户消息**的开头。
 *
 * 助手那条不算（一条会话可能由一句问候开头），空会话给「新对话」——
 * 一个空白行在列表里点不动也认不出。
 *
 * 截断在 `TITLE_MAX` 个字：列表是 280pt 宽，再长就换行了，
 * 而换行的标题会把「N 轮 · 日期」那行挤掉。
 */
const TITLE_MAX = 14

export function sessionTitle(session: ChatSession): string {
  const first = session.items.find((t) => t.role === 'user' && t.content.trim())
  if (!first) return '新对话'
  const text = first.content.trim().replace(/\s+/g, ' ')
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text
}

/** 插入或替换一条会话（同 id 替换）。**返回新数组**，不改传进来的那个 */
export function upsertSession(sessions: readonly ChatSession[], session: ChatSession): ChatSession[] {
  const at = sessions.findIndex((s) => s.id === session.id)
  if (at === -1) return [...sessions, session]
  const next = [...sessions]
  next[at] = session
  return next
}

export function removeSession(sessions: readonly ChatSession[], id: string): ChatSession[] {
  return sessions.filter((s) => s.id !== id)
}

/**
 * 清空**这个档案**的会话，别人的留着。
 *
 * 和 `clearUnloggedFor` 是同一个判据、同一个理由：档案是来回切的，
 * 在 A 里点「清空历史」不该顺手清掉 B 的。
 */
export function clearSessionsFor(sessions: readonly ChatSession[], profileId: string): ChatSession[] {
  return sessions.filter((s) => s.profileId !== profileId)
}

/* ------------------------------------------------------------
   读写
   ------------------------------------------------------------ */

/**
 * 结构校验 —— 形状不对就返回 null，**从不抛**。
 *
 * 浅校验，和 `isAppState` / `parseUnlogged` 同一个口径：只验「读下去会不会在
 * `.map` / `.filter` 上抛」这一级。`reply` / `meal` 往深里看的字段不验 ——
 * 那会变成一份永远追不上的清单（那段注释在 `persist.ts` 里）。
 */
export function parseChatLog(v: unknown): ChatSession[] | null {
  if (!Array.isArray(v)) return null

  const out: ChatSession[] = []
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) return null
    const o = raw as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.profileId !== 'string') return null
    if (typeof o.at !== 'number') return null
    if (!Array.isArray(o.items)) return null

    const items: ChatTurn[] = []
    for (const t of o.items) {
      if (typeof t !== 'object' || t === null) return null
      const r = t as Record<string, unknown>
      if (typeof r.id !== 'string' || typeof r.content !== 'string') return null
      if (r.role !== 'user' && r.role !== 'assistant') return null
      items.push({
        id: r.id,
        role: r.role,
        content: r.content,
        // 条件展开，理由同 `parseUnlogged`：不留一个 `reply: undefined` 的键
        ...(r.reply !== undefined ? { reply: r.reply as AgentReply } : {}),
        ...(r.meal !== undefined ? { meal: r.meal as RecognizedMeal } : {}),
      })
    }

    // 空会话不读回来：它在列表上占一行、点进去是空白，而它没有任何内容
    if (items.length === 0) continue
    out.push({ id: o.id, profileId: o.profileId, at: o.at, items })
  }
  return out
}

export interface ChatDeps {
  /** 不传 = 用真的 localStorage。传 `null` = 当作「这台机器没有存储」 */
  storage?: StorageLike | null
}

function storeOf(deps?: ChatDeps): StorageLike | null {
  return deps && 'storage' in deps ? (deps.storage ?? null) : appStorage()
}

export function loadChatLog(deps?: ChatDeps): ChatSession[] {
  const s = storeOf(deps)
  if (!s) return []
  try {
    const raw = s.getItem(CHAT_KEY)
    if (!raw) return []
    return parseChatLog(JSON.parse(raw)) ?? []
  } catch {
    return []
  }
}

/**
 * 整份覆盖写。
 *
 * @returns 写成功没有。调用方**不需要**处理 false（见文件头最后一段）
 */
export function saveChatLog(sessions: readonly ChatSession[], deps?: ChatDeps): boolean {
  const s = storeOf(deps)
  if (!s) return false
  try {
    s.setItem(CHAT_KEY, JSON.stringify(sessions))
    return true
  } catch {
    return false
  }
}
