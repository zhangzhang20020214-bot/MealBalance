import { IconTile, TypingDots } from './ui'
import { formatTime } from '../lib/date'
import { entryIcon } from '../store/derive'
import type { PendingRun } from '../store/logRun'

/**
 * 日记页上「这一餐还没落定」的那一行
 * ===========================================================
 * 用户 2026-09-24 下午的原话：
 *
 *   「我建议在计算的时候，可以在日记里显示这一餐正在计算，否则用户点击确认后
 *     并不知道是已经在算了还是没有计算」
 *
 * 他要的是**确定性**：点完「记入日记」之后那一趟要跑二十到四十秒，而那十几秒里
 * 他多半已经翻到日记页了 —— 这一行就是回答「它到底有没有在算」。
 *
 * ## 两种形态，同一个位置
 *
 *   · **正在算** —— 和一条真记录**同样的几何**（同样的高度、同样的图标位、
 *     同样的分割线缩进）。十几秒后它就地变成那一条真记录，位置不移。
 *   · **没算出来** —— 高度自适应（要印一句原因），右边一颗「收掉」。
 *
 * ## ⚠️ 一个数字都不印
 *
 * 「正在算」那个形态里**没有** kcal、没有克数 —— 和 `MealResultCard` 立的是
 * 同一条规矩：那一刻还没有数，印一个 0 或者是编一个数，都是在说一件没发生的事。
 * 这一行上唯一的时间数字是**拍照那一刻的钟点**（`meal.at`），因为那个确实知道。
 *
 * ## 为什么是受控的（和 `LogNotice` / `UnloggedMealSheet` 同一条理由）
 *
 * `renderToStaticMarkup` 不跑 effect，组件内部的 `useState` 在自检里**永远是初值**
 * —— 上面那两种形态一句都断言不到。做成受控的，`verify-render.mjs` 直接渲染并断言。
 *
 * ## 谁决定它在不在
 *
 * 由 `pendingForDate(run, date)` 决定（日期不对、或者这一趟已经落盘了，就不显示），
 * 日记页只管把它渲染出来。**不塞进 `state.meals`** —— 理由见 `DiaryScreen` 那一段。
 */
export function PendingMealRow({
  run,
  divider,
  onDismiss,
}: {
  /** 只接「正在算」和「没算出来」这两种（`pendingForDate` 的返回类型） */
  run: PendingRun
  /** 上面要不要那条分割线 —— 它不是当天第一行时才要（和真记录同一个判据） */
  divider: boolean
  /** 「收掉」—— 只收屏幕，**不碰草稿**（那条还留着，下次进对话页还会问） */
  onDismiss: () => void
}) {
  const at = new Date(run.meal.at)

  if (run.phase === 'computing') {
    return (
      <div>
        {divider && <RowDivider />}
        {/*
          几何和 `DiaryScreen` 里那一条真记录**逐字相同**（h-[66px] / gap-3 /
          px-4 py-3 / 图标 40 r12）—— 它十几秒后就要变成那一条，位置和高度
          都不能跳一下。判据在 `scripts/verify-render.mjs` 里是**并排比的**。
        */}
        <div
          role="status"
          className="flex h-[66px] w-full items-center gap-3 px-4 py-3 text-left"
        >
          <IconTile
            name={entryIcon(run.meal)}
            size={40}
            radius={12}
            // 和真记录那行同一个色调档位。这一行没有营养可算「今天这餐咸不咸」,
            // 所以不学 `entryTint` 去分 danger —— 拿不准就用中性那一个
            tone="brand"
            iconSize={20}
            src={run.meal.thumb}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] leading-[22px] text-ink">
              {run.meal.slot} · 正在算这一餐的营养…
            </span>
            <span className="text-[13px] leading-[18px] text-muted">
              {formatTime(at)} · 拍餐盘
            </span>
          </div>
          <TypingDots />
        </div>
      </div>
    )
  }

  return (
    <div>
      {divider && <RowDivider />}
      {/*
        失败这一行**没有固定高度**：它比一条真记录多两句话（原因 + 「还留着」），
        钉死 66px 会把「下次还会问你」那半句裁掉 —— 而那半句正是这一行存在的
        理由（没有它，用户读到「没算出来」只会以为这顿饭没了，而草稿和照片都在）。
      */}
      <div role="status" className="flex items-start gap-3 px-4 py-3">
        <IconTile name="warning" size={40} radius={12} tone="warn" iconSize={20} />

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] leading-[22px] text-ink">{run.meal.slot} · 没算出来</span>
          {/* 原因由调用方给（`store/logRun.ts` 的 `computeForLog` 里那三句人话之一） */}
          <span className="text-[13px] leading-[18px] text-danger-text">{run.message}</span>
          {/*
            和 `LogNotice` 失败态那句**同一个意思**，只是换了个说法适配这一行的宽度：
            这一行的存在不改变草稿的去留 —— 照片还在本机，下次进对话页照样问。
          */}
          <span className="mt-0.5 text-[12px] leading-[17.38px] text-muted">
            这条还留着，下次进对话页还会问你。
          </span>
        </div>
        {/*
          「收掉」而不是「知道了」：它收的是**日记页上这一行**，不碰草稿、也不落盘。
          和对话页那张卡上的「知道了」是两件事 —— 那边关了连同这一趟一起收
          （那是用户对那一趟说的话），这边只是他读过了。
        */}
        <button
          onClick={onDismiss}
          className="shrink-0 self-center text-[13px] leading-[18px] font-medium text-brand-deep active:opacity-60"
        >
          收掉
        </button>
      </div>
    </div>
  )
}

/** 分割线左缩进 68pt（与图标底右缘 + 间距对齐）—— 和日记页里那条同一个写法 */
function RowDivider() {
  return (
    <div className="pl-[68px]">
      <div className="h-px bg-line" />
    </div>
  )
}
