import { DemoDataBanner } from './DemoDataBanner'
import { DishRow } from './DishRow'
import { Card, PrimaryButton } from './ui'
import { unloggedWhen, type UnloggedMeal } from '../store/unlogged'

/**
 * 「上次识别到的那几道菜，要补记吗？」
 * ===========================================================
 * ## 它为什么存在
 *
 * 对话页里发图**不会自动记进日记** —— 用户可能只是在问「这餐咸吗」，根本没吃。
 * 但也不能就此把那次识别结果丢掉：它是一次真实的识别，理由充分地留着。
 * 所以决定的时刻被**推迟到下一次进对话页**：那时他有一整晚可以想
 * （见 `store/unlogged.ts` 的文件头，以及结果卡上那句「还没记进日记」——
 * 那是这句话的引子）。
 *
 * ## 为什么 `open` 是 prop（`SpeechSheet` 同一条理由）
 *
 * `renderToStaticMarkup` 不跑 effect，组件内部的 `useState` 在自检里**永远是
 * 关着的** —— 于是这一整段文案、三个按钮的写法、底下那句代价提示
 * 一句断言都够不到。做成受控的，`verify-render.mjs` 就能直接渲染并断言。
 *
 * ## 三个出口，各自的语义（2026-09-24 定：前两个都要先算一趟）
 *
 *   · **记入日记** —— 先拿存下来的照片**调一趟食衡算营养**，算出来才落盘，
 *     然后清掉草稿。**算不出来就不记**（见下面「没算出来」那段）。
 *   · **调整分量再记** —— 走同一条「先算」，算完拿**食衡那份**打开记录面板。
 *     顺序不能反：不先算，面板保存时写进去的就是一份没营养的菜。
 *     **不清草稿**：它不是「不」，是「是，但让我先改」。
 *   · **不用了 / 点遮罩** —— 两件事是同一件事（用户定的：问过一次的不再问）。
 *     所以界面上不写第二种「不」，用户也不用分辨它们的区别。
 *
 * ## 前两个出口点完，这一屏就收了（2026-09-24 下午改过）
 *
 * 用户那天的话：「下一次点击进来的计算是否可以不在页面显示，用户点击后，直接说
 * 计算成功后会加载进日记等等这样的话」。
 *
 * 在此之前，这一屏是**留下来陪等**的：主键改写成「正在算…」、两颗「记」的键都不接
 * `onClick`、底下那句提示换算成「正在拿这张照片重新算一遍营养，要等十几秒。」
 * —— 屏幕上画着那十几秒的过程。现在不画了：**点下去这一屏就收掉**，由 `LogNotice`
 * 那张提示卡说一句「算好了会自动记进日记」，用户关不关随他，那一趟照飞。
 *
 * ⚠️ **底下那句提示仍然必须在按之前说清代价**（要等，而且分量不是他选的）：
 * 用户此刻看的是几行**一个数字都没有**的菜名（`DishRow` 的 `showNutrition`），
 * 他没有任何别的线索知道按下去会发生什么。这条没变，变的是**按完之后**。
 *
 * ⚠️ 于是这一屏**不再有「按不动」这件事**：它自己收掉了，没有第二颗能双击的键。
 * （以前那两颗 `onClick={busy ? undefined : …}` 的守卫就长在这儿，现在随 `busy`
 * 一起撤掉 —— 见 `verify-render.mjs` 那一段的改动。）
 *
 * ## 「没算出来」就停在这儿
 *
 * 这是同一条口径的后半句：「计算不出来就不算了」。上游挂了、超时了、
 * 或者算完还是**一道能计量的菜都没有**（全是库外、联网也没查到）——
 * 一律**不落盘**，草稿和照片都留着，下次进来还会问。
 * 写一条 0 kcal 的记录进日记，比这次没记上糟得多：用户看不出那是「没算出来」。
 *
 * ⚠️ 那句「为什么没算出来」**不再挂在这一屏上**（这一屏已经收掉了）——
 * 由 `LogNotice` 印，而且它会**重新弹出来**，哪怕用户早把那张卡关掉了。
 */
interface UnloggedMealSheetProps {
  open: boolean
  /** 那份草稿。为 null 时整块不渲染 —— 「没有可补记的」是这一页的常态 */
  meal: UnloggedMeal | null
  /** 记入日记（调用方负责调食衡 + 落盘 + 清草稿） */
  onLog: () => void
  /** 调整分量再记（调用方负责调食衡 + 打开记录面板） */
  onAdjust: () => void
  /** 不用了 / 点遮罩 —— 调用方负责清草稿 */
  onDismiss: () => void
}

/*
  ⚠️ 这里以前还有 `busy` / `error` 两个 prop（「正在算…」和「没算出来」两个状态）。
  2026-09-24 下午随「点完就收掉这一屏」一起撤了：等待和失败现在都由 `LogNotice`
  那张提示卡说，两条出口点下去这一屏就不在屏幕上了（见文件头）。
*/
export function UnloggedMealSheet({
  open,
  meal,
  onLog,
  onAdjust,
  onDismiss,
}: UnloggedMealSheetProps) {
  if (!open || !meal) return null

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="补记上次识别的一餐">
      <button
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onDismiss}
        aria-label="关闭"
      />

      <div className="animate-sheet-up absolute bottom-0 left-0 flex max-h-[90%] w-full flex-col rounded-t-[24px] bg-[#FAFAFC] px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] backdrop-blur-2xl">
        <div className="flex h-[11px] items-center justify-center">
          <div className="h-[5px] w-9 rounded-full bg-faint" />
        </div>

        <div className="flex shrink-0 flex-col gap-1 px-1 pt-3 pb-3">
          <span className="text-[16px] leading-[22px] font-bold text-ink">要补记这一餐吗？</span>
          {/*
            说的是**什么时候**识别的。不参与任何判据（昨天拍的今天照样该问），
            但「12:30 识别到的」和「9月16日 12:30 识别到的」读起来是两件事。
            两个格式化函数都是现成的，日记页用的是同一对。
          */}
          <span className="text-[13px] leading-[19.5px] text-muted">
            {/*
              ⚠️ 中间那个空格**不能省**。`unloggedWhen` 交出来的是「今天 8:05」,
              以数字收尾 —— 直接接「识别到的」渲染成「今天 8:05识别到的这几道菜」。
              数字和汉字粘在一起,读起来像「8:05识」是另一个词。
              (日记页那句「今天摄入概览」不用空格,是因为「今天」以汉字收尾。)
            */}
            {unloggedWhen(meal.at)} 识别到的这几道菜，还没记进日记。
          </span>
        </div>

        {/*
          演示数据横幅 —— 和结果页、结果卡同一个组件、同一句话。
          有值的含义只有一个：这整份是本地随机组的，界面上必须标出来。
          （部分失败说的是另一件事，走 `partialNote`，而那一份**不进草稿**：
           它挂在那张对话里的结果卡上，而草稿存的是「要记进日记的那几道菜」。）
        */}
        {meal.degradedReason && (
          <div className="shrink-0 pb-2">
            <DemoDataBanner reason={meal.degradedReason} />
          </div>
        )}

        {/* 菜品清单 —— 可滚动区。菜多的时候按钮不能被顶出屏幕 */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <Card>
            {/*
              ⚠️ `showNutrition={false}` —— 和对话里那张卡同一个口径:
              此刻**还没有算过营养**,这一行不许印数字(一个 0 都不许)。
              那是当天出过事故的地方,见 `MealResultCard` 文件头最后一段。
            */}
            {meal.items.map((dish, i) => (
              <DishRow key={`${dish.foodId}-${i}`} dish={dish} divider={i > 0} showNutrition={false} />
            ))}

            {/* 次要出口 —— 和结果页那个「调整分量或增删菜品」同一套写法、同一个动作 */}
            <button
              onClick={onAdjust}
              className="flex h-12 w-full items-center justify-center gap-1.5 border-t border-line text-[14px] leading-[20px] font-medium text-brand-deep active:opacity-60"
            >
              调整分量再记
            </button>
          </Card>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          {/*
            这颗键**按下去就收屏**(见文件头「前两个出口点完,这一屏就收了」那段),
            所以不再需要「算的时候不接 onClick」那道守卫了 —— 它没有第二次可按的
            机会,而等待和失败都由 `LogNotice` 那张卡说。
          */}
          <PrimaryButton icon="check" onClick={onLog}>
            记入日记
          </PrimaryButton>

          {/* 见文件头那段:代价必须在按之前说清楚(按之后屏幕上就没有这一屏了) */}
          <p className="px-1 text-[12px] leading-[17.38px] text-faint">
            记进去之前会拿这张照片重新算一遍营养，要等十几秒。算出来的分量不是你选的 —— 想改就点上面的「调整分量再记」。
          </p>

          <button onClick={onDismiss} className="py-1 text-[15px] leading-[21.72px] text-muted active:opacity-60">
            不用了
          </button>
        </div>
      </div>
    </div>
  )
}
