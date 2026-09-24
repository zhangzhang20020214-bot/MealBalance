import { Icon } from './Icons'
import { formatRelativeDay, toISODate } from '../lib/date'
import { roundCount, sessionTitle, sessionsOf, type ChatSession } from '../store/chatHistory'

/**
 * 对话页左侧的历史记录抽屉
 * ===========================================================
 * 这是 App 里**唯一**一个侧栏浮层（其余面板全是底部升起，见
 * `index.css` 的 `animate-drawer-in`）。搬的是膳享那次对话页的形态。
 *
 * ## 列表在这一层过滤，不要求调用方先滤好
 *
 * `sessionsOf(sessions, profileId)` 在这里调 —— 理由和 `unlogged.ts` 里那条
 * `shouldAskUnlogged` 一样：**按档案分**是这个功能的一条硬规矩（切到 B 不该
 * 看见 A 问过的话），把它放在渲染的地方，比放在调用方多一处「谁都能忘了做」
 * 的机会。
 *
 * ## 一行两句话：标题 + 「N 轮 · 日期」
 *
 * 标题是**第一句用户消息**的开头（`sessionTitle`）—— 一条会话可能由一句问候
 * 开头，拿助手那句当标题会让列表上每一行都长得一样。日期用相对说法
 * （`今天` / `昨天` / `9月16日`），和日记页、补记弹窗是同一套。
 *
 * ## 当前这一条不画选中态
 *
 * 抽屉里点一条 = 切过去，切完抽屉就关了 —— 所以「哪条是当前的」在屏幕上看
 * 不到第二次。画一个只有一帧的选中态是白加的样式，而它还会让人以为
 * 「点一下 = 只预览不切换」。
 */

export function ChatHistoryDrawer({
  open,
  sessions,
  profileId,
  onPick,
  onNew,
  onDelete,
  onClear,
  onClose,
}: {
  open: boolean
  /** **全部**档案的会话 —— 过滤在这一层做（见文件头） */
  sessions: readonly ChatSession[]
  profileId: string
  onPick: (session: ChatSession) => void
  onNew: () => void
  /** 传的是那一整条 —— 确认框上要用它的标题说话 */
  onDelete: (session: ChatSession) => void
  onClear: () => void
  onClose: () => void
}) {
  if (!open) return null

  const mine = sessionsOf(sessions, profileId)

  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-label="历史记录">
      {/* 遮罩点一下 = 关掉。它**不是**一次「取消」——抽屉里什么都没开始做 */}
      <button
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
        aria-label="关闭"
      />

      {/*
        280pt 宽（402pt 的屏上留出 122pt 遮罩）—— 再宽就不像抽屉而像第二页。
        `z-10` 是相对那一层遮罩的：两者都在 `z-40` 里面，靠层叠顺序分先后。
      */}
      <div className="animate-drawer-in absolute inset-y-0 left-0 z-10 flex w-[280px] flex-col bg-[#FAFAFC] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2 px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-2">
          <Icon name="history" size={18} className="shrink-0 text-muted" />
          <span className="flex-1 text-[16px] leading-[22px] font-bold text-ink">历史记录</span>
          {/*
            新建对话放在**头上**而不是列在列表里：它和「点某一条」不是同一类操作
            （那些是「回到过去」，这个是「从现在开始」），混在一个列表里会让
            手指按错。
          */}
          <button
            onClick={onNew}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-card text-brand-text active:opacity-70"
            aria-label="新建对话"
          >
            <Icon name="plus" size={17} strokeWidth={2} />
          </button>
        </div>

        <div className="no-scrollbar flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          {mine.length === 0 ? (
            /*
              空态**写出来**，不是留一片白：抽屉刚打开时用户看到的是一个
              有标题、有按钮、中间空着的框 —— 不写一句的话，那看起来像列表
              加载失败（`ActionSheet` 那类面板从来没「空过」，所以这是新情况）。
            */
            <span className="px-2 py-6 text-[13px] leading-[19px] text-muted">
              还没有别的对话。聊过的话会留在这里，按档案分开存。
            </span>
          ) : (
            mine.map((s) => (
              <div key={s.id} className="flex items-center gap-1 rounded-[12px] bg-card">
                <button
                  onClick={() => onPick(s)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2.5 text-left active:opacity-70"
                >
                  <span className="w-full truncate text-[14px] leading-[20px] text-ink">{sessionTitle(s)}</span>
                  <span className="text-[11px] leading-[16px] text-faint">
                    {roundCount(s)} 轮 · {formatRelativeDay(toISODate(new Date(s.at)))}
                  </span>
                </button>
                <button
                  onClick={() => onDelete(s)}
                  className="mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-faint active:bg-black/[0.05]"
                  aria-label={`删除对话：${sessionTitle(s)}`}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        {/*
          「清空历史」只在真有东西可清时出现 —— 一颗按下去什么都不删的按钮，
          比没有这颗按钮更让人困惑（它会让人以为别处还有历史没显示出来）。
        */}
        {mine.length > 0 && (
          <div className="px-3 pb-3">
            <button
              onClick={onClear}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] bg-card text-[13px] leading-[18px] text-danger active:opacity-70"
            >
              <Icon name="trash" size={16} />
              清空本档案的历史
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
