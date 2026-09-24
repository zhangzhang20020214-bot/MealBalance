import { AgentReplyCard } from './AgentReplyCard'
import { Icon } from './Icons'
import { MealResultCard } from './MealResultCard'
import { TypingDots } from './ui'
import { ANALYZE_STAGE_LABELS, type AnalyzeStage } from '../lib/analyzeStage'
import { demoteHardBlock, type AgentReply } from '../lib/agentReply'
import type { RecognizedMeal } from '../store/recognize'

/**
 * 消息区的渲染 —— 从 `ChatScreen` 搬出来的
 * ===========================================================
 * 搬出来不是为了少几行:`renderToStaticMarkup` **够不到组件 state**,
 * 消息渲染分支留在 `ChatScreen` 里就永远只能靠在浏览器里点出来。
 * 搬到这里之后,「一条带两张图的消息」「正在识别第 2 张,共 3 张」「一张结果卡」
 * 都变成**受 props 驱动**的 —— 摆一个 `ChatItem` 就能渲染并断言。
 *
 * `ChatItem` 也是从那边搬过来的(原来叫 `ChatMessage & { reply? }`,定义在
 * `ChatScreen` 内部)。它比 `mock.ts` 的 `ChatMessage` 多四个可选字段,而
 * **刻意没有**回去给 `ChatMessage` 加:那个类型是 `CHAT_GREETING` 这类
 * 占位常量的形状,加四个永远不填的键只会让它看起来像"对话消息本来就带图"。
 */

export interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  /**
   * 用户这条消息带出去的图 —— 就是附件条里那几串 object URL,**原样搬过来**。
   *
   * 刻意不换成一个 URL 数组 + 一张缩略图:用户会看到自己发出去的图
   * **在发出之后变糊了**。那是一个没有解释的视觉降级,而代价被
   * 「一次最多 3 张、离开页面即释放」兜住(见 `chatSession.ts`)。
   */
  photos?: string[]
  /**
   * 正在识别的那一批 —— 一条消息只挂一个,发出去时压进消息列表,
   * 出结果时原地换成 `meal`。
   *
   * ⚠️ **原来是 `{ index, total }`(「正在识别第 2 张,共 3 张」),2026-09-24
   * 去掉了 `index`。** 一批三张现在是**并发**跑的(`ChatScreen.sendPhotos`
   * 那个 `Promise.all`),同时有三张在飞的时候「第几张」没有意义:它们各自
   * 处在不同的步上,报一个数字是在描述一个不存在的顺序。`photos` 是一共几张,
   * 那个数字是真话。用户那天选的就是「正在识别 3 张…」这个说法。
   */
  run?: {
    photos: number
    /** 这三张里**最靠后**走到的那一步(由 `advance` 折叠)。有值才画,不编一个进度 */
    stage?: AnalyzeStage
  }
  /** 刚认出来的一餐 —— 渲染成结果卡 */
  meal?: RecognizedMeal
  /** agent 的结构化回复 —— 渲染成整宽卡片 */
  reply?: AgentReply
}

export type ChatItemKind = 'reply' | 'run' | 'meal' | 'bubble'

/**
 * 一条消息该渲染成什么。
 *
 * 四个字段**正常不会同时出现**:`run` 出结果时被就地换成 `meal`。但
 * 「正常不会」不是判据 —— 这个函数存在的意义就是让**顺序是一个可以断言的决定**,
 * 而不是渲染里几个 `if` 的先后。
 *
 * 顺序是 `reply → run → meal → bubble`,按「信息量大的赢」排:
 * 结构化回复 > 正在识别 > 结果卡 > 纯文字。
 *
 * ⚠️ `meal` 和 `reply` **也不会**同时出现(2026-09-23 起)。曾经会:拍图时随图
 * 打的那句话,回答是**另起一条消息**给的,两条消息各画一张卡、各顶一条一模一样
 * 的风险结论(「需注意」在屏幕上印两遍)。现在那句话跟图**一起发一趟**
 * (见 `ChatScreen.sendPhotos`),答案落在 `meal.agentReply` 里、由那张卡自己
 * 画出来 —— 没有第二条消息,也就没有「两个都画」这一支。
 */
export function chatItemKind(item: ChatItem): ChatItemKind {
  if (item.reply) return 'reply'
  if (item.run) return 'run'
  if (item.meal) return 'meal'
  return 'bubble'
}

/**
 * 「这段话是照档案里哪一条说的」—— 生产者把它缀在正文末尾,这里把它摘出来。
 *
 * ## 为什么要摘,而不是让 AI 直接分两段发
 *
 * 依据行和正文**是同一段话**:本地应答(`localAnswer.ts`)和那一餐的结论句
 * (`chatMeal.mealVerdict`)都是先算出正文、再把依据缀上去的**一个字符串**。
 * 让它们各自吐两个字段,就得改这两个函数的返回值类型,而它们各自有六处
 * 逐字比较的断言 —— 为了一个纯展示上的区分去动那些断言不值。
 *
 * 所以约定是:**正文 + `\n\n依据 · ` + 依据**,由这个函数切开。前缀
 * `\n\n依据 · ` 是契约的一部分,生产者那边改一个字,这里就再也摘不出来
 * ——(那时依据会变成正文里的普通一行:字号偏大,但不丢内容,不是静默消失)。
 *
 * ## 判据
 *
 * 只认**最后**一处 `\n\n依据 · `,而且它后面**不能再有换行** ——
 * 否则那说明它是正文中间的一句话,不是结尾那行小字。摘不出来就原样返回,
 * 正文一个字都不动。
 */
const BASIS_PREFIX = '\n\n依据 · '

export function splitBasis(text: string): { body: string; basis: string | null } {
  const at = text.lastIndexOf(BASIS_PREFIX)
  if (at === -1) return { body: text, basis: null }

  const basis = text.slice(at + BASIS_PREFIX.length)
  // 后面还有换行 = 它不是最后一行;空的 = 生产者缀了一个没有内容的依据
  if (!basis.trim() || basis.includes('\n')) return { body: text, basis: null }

  return { body: text.slice(0, at), basis }
}

/**
 * 消息区。
 *
 * 每条分支里的 `&& msg.xxx` 是**类型收窄,不是第二次判优先级** ——
 * 优先级只在 `chatItemKind` 一处,这里只是把联合类型收窄到能取到字段。
 */
export function ChatTranscript({
  items,
  busy,
  onActions,
}: {
  items: readonly ChatItem[]
  busy: boolean
  /**
   * 这条消息下面那颗「…」被按下去了。**不传就整颗不渲染** ——
   * 没有操作可做的地方不该摆一个按了没反应的图标。
   */
  onActions?: (item: ChatItem) => void
}) {
  return (
    <>
      {items.map((msg) => {
        const kind = chatItemKind(msg)
        const body =
          kind === 'reply' && msg.reply ? (
            <AgentReplyCard reply={msg.reply} />
          ) : kind === 'run' && msg.run ? (
            <RunBubble run={msg.run} />
          ) : kind === 'meal' && msg.meal ? (
            /*
              ⚠️ **配料表那条路在这里要拐个弯(2026-09-23)。**

              用户拍的是配料表 / 包装时,模型会把配料、每 100g 的数值和建议都读出来,
              只是**一道菜都没有**(`items` 空)。那种结果用「餐盘卡」渲染,屏幕上就是
              「没读出来」—— 数据明明到了(日志里一行不缺),只是卡片开错了抽屉。

              判据和结果页那条**同一个**:没有菜 + 有回复内容 → 用回复卡渲染。
              两处各写一遍是有意的:它们是两个渲染入口(对话里那张 vs 结果页那张),
              但判据必须一致,否则同一次识别在两个页面长得不一样。

              (餐盘那条路 —— 有菜、也有回复 —— 用的是 `MealResultCard`,建议接在
              同一张卡的下半块,见那个文件。)
            */
            msg.meal.items.length === 0 && msg.meal.agentReply ? (
              /*
                ⚠️ **这一句 `demoteHardBlock` 是「对话页不硬拦」的落点(2026-09-24)。**

                模型有时还是会回 `blocked: true`(发图那条路尤其:提示词让它别拦,
                它照样拦)。`parseAgentReply` 照实解析、`MealResultCard` 照实画,
                于是对话页上就是那张「已为你拦截这条建议」的红卡 —— 没有菜、
                没有做法,而用户在对话页是**提问**,那句话甚至没有指代对象
                (这里根本没有「这条建议」)。

                降级之后走的是 `AgentReplyCard` 的**正常那一支**:顶上那张结论条
                照旧把冲突写清楚(它就是全卡最醒目的东西),下面该有的菜、做法、
                建议一样不少。用户 2026-09-24 定的口径就是这句话:
                「不要硬拦截,就是第一条明显的提醒,然后后面的菜该怎么吃就怎么吃」。

                ⚠️ **只在对话页降。** 拍餐盘那条路(`ResultScreen`)的拦截卡是有
                指代对象的 —— 那里确实有一份具体的建议要拦下来,别把这一行搬过去。
              */
              <AgentReplyCard reply={demoteHardBlock(msg.meal.agentReply)} />
            ) : (
              <MealResultCard meal={msg.meal} />
            )
          ) : (
            <Bubble msg={msg} busy={busy} />
          )

        return (
          <div key={msg.id} className="flex w-full flex-col">
            {body}
            {/*
              操作入口是**一条消息下面的一颗小图标**,不是「点整条消息」。
              两个理由:
                · 卡片内部本来就有能点的地方(结果卡上的「调整分量」之类),
                  整块包一层 onClick 会把那些点击一并吃掉;
                · 这颗图标在**流布局里占位**,所以「有没有操作」在屏幕上看得见 ——
                  靠长按/双击唤起的功能没有任何可见性,用户不会去试。
              它挂在每一种渲染形态下面(卡片、气泡、结果卡都算一条消息)。
            */}
            {onActions && (
              <div className={`flex pt-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <button
                  onClick={() => onActions(msg)}
                  className="flex h-6 w-8 items-center justify-center rounded-[8px] text-faint active:bg-black/[0.05]"
                  aria-label="这条消息的操作"
                >
                  <Icon name="more" size={16} />
                </button>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

/** 一条气泡。用户那条可能带图,AI 那条空着时是三点动画 */
function Bubble({ msg, busy }: { msg: ChatItem; busy: boolean }) {
  const mine = msg.role === 'user'

  /*
    依据只从 **AI 那条**里摘。用户自己打的那句话里就算原样出现「依据 · 」,
    也**不该**被当成依据缩成小字 —— 那是他说的话,字号就是说话的字号。
    这个判断放在这里而不是 `splitBasis` 里:那个函数是纯字符串函数,
    「谁说的一句话」是气泡才知道的事。
  */
  const { body, basis } = mine ? { body: msg.content, basis: null } : splitBasis(msg.content)

  return (
    <div
      className={`max-w-[300px] px-3.5 py-[11px] text-[15px] leading-[21.72px] whitespace-pre-wrap shadow-[0_8px_24px_rgba(10,15,13,0.06)] ${
        mine
          ? // 用户:绿底白字,右下角收角 → [18,18,6,18]
            'self-end rounded-[18px_18px_6px_18px] bg-brand text-white'
          : // AI:白底深字,左下角收角 → [18,18,18,6]
            'self-start rounded-[18px_18px_18px_6px] bg-card text-ink'
      }`}
    >
      {/*
        图在文字**上面**。三张 44px 并排约 148pt,300pt 的气泡放得下 ——
        所以「一行图 + 一行字」和设计稿里那样是一条消息,不是两条。
      */}
      {msg.photos && msg.photos.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 ${body ? 'mb-2' : ''}`}>
          {msg.photos.map((url) => (
            <img
              key={url}
              src={url}
              alt="你发的照片"
              className="h-11 w-11 shrink-0 rounded-[10px] bg-black/10 object-cover"
            />
          ))}
        </div>
      )}
      {body || (busy && !mine ? <TypingDots /> : '')}
      {/*
        依据那行小字。`block` 是为了另起一行 —— 正文末尾那个 `\n\n` 已经被
        `splitBasis` 摘掉了,不留一个 `block` 的话它会接在正文最后一个字后面。
        字号比正文小两档、颜色用全 App 那个 muted,不另配一种灰。
      */}
      {basis && (
        <span className="mt-1 block text-[12px] leading-[17.38px] text-muted">依据 · {basis}</span>
      )}
    </div>
  )
}

/**
 * 「正在识别 3 张…」。
 *
 * ⚠️ 这行字原来写的是「正在识别第 2 张,共 3 张」,理由是「三张是**串行**跑的,
 * 一张慢的时候用户要知道的是『还剩几张』」。**2026-09-24 前提变了**:三张改成
 * 并发(`ChatScreen.sendPhotos`),同时有三张在飞的时候「第几张」不再是
 * 一个真实的位置 —— 三张各自处在不同的步上,谁也不算「当前那张」。
 * 剩下的「一共几张」仍然是真话,而且正是用户想确认的那件事。
 *
 * 单张时**不说张数**(「正在识别 1 张…」是句废话)。判据是 `> 1` 而不是
 * `!== undefined`,和分析页那一行(以及 `PlateJob.photos` 只在不止一张时才带)
 * 是同一把尺子。
 *
 * 阶段文案复用 `ANALYZE_STAGE_LABELS`(分析页那一套)。**不另写一份**:
 * 两处说法分叉之后,同一次识别在两个页面会说出两句不同的话。
 */
function RunBubble({ run }: { run: NonNullable<ChatItem['run']> }) {
  return (
    <div className="max-w-[300px] self-start rounded-[18px_18px_18px_6px] bg-card px-3.5 py-[11px] text-[15px] leading-[21.72px] text-ink shadow-[0_8px_24px_rgba(10,15,13,0.06)]">
      <span>
        {run.photos > 1 ? `正在识别 ${run.photos} 张…` : '正在识别…'}
      </span>
      {run.stage && <span className="text-[13px] leading-[18px] text-muted"> · {ANALYZE_STAGE_LABELS[run.stage]}</span>}
    </div>
  )
}

/*
  「等待回复」的三点动画搬去了 `ui/index.tsx`（`TypingDots`）—— 日记页那一行
  「正在算这一餐」也要用它，两处各写一份的话同一种等待在两页上会长得不一样。
  用法不变（这里是 `<TypingDots />`）。
*/
