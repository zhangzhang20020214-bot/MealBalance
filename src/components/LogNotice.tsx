import { PrimaryButton } from './ui'

/**
 * 点完「记」之后那张提示卡
 * ===========================================================
 * ## 它替掉了什么
 *
 * 2026-09-24 之前:点下「记入日记」之后**补记弹窗自己留着**,主键改写成「正在算…」,
 * 底下再挂一句「正在拿这张照片重新算一遍营养,要等十几秒。」—— 也就是把一趟十几秒
 * 的等待**画在屏幕上**,让用户守着看完。
 *
 * 用户那天的话:
 *
 *   「下一次点击进来的计算是否可以不在页面显示,用户点击后,直接说计算成功后会
 *     加载进日记等等这样的话」
 *   「用户自己选择关不关,意思就是选择后自动弹出…界面,用户点击其他地方或者
 *     点击知道了之类的按钮,就可以关闭」
 *
 * 于是:点完 → **补记弹窗当场收掉**,这张卡自己弹出来说一句「算好了会自动记进日记」
 * → 用户什么时候关它都行(点「知道了」或者点别处)。**关掉不影响那一趟** —— 它已经
 * 在飞了,算好了照样落盘。屏幕上再也没有「算到哪儿了」这个过程。
 *
 * ## 同一个位置的三句话
 *
 *   · **正在算**(「记入日记」那条) —— 「…算好了会自动记进日记。」
 *   · **算完了、而且卡还在屏上** —— 「已经记进日记了。」
 *     只有卡还在时才换这一句。用户自己关掉的**不再弹回来报一次成功** ——
 *     那不是通知,是打扰(他自己说了:关不关由他)。
 *   · **没算出来** —— 印调用方给的那句人话,再加一句「这条先留着」。
 *     ⚠️ **这一句会重新弹出来**,哪怕用户早就把卡关了。它是一趟失败唯一会说话的
 *     地方:关掉它就等于「App 收下了这顿饭,然后什么都没记」——而那正是这个仓库
 *     反复点过名的那种错(屏幕上什么都不说)。
 *
 * ## 为什么 `kind` 是一个 prop
 *
 * 「调整分量再记」那条出口**不落盘** —— 它算完是打开记录面板。两条出口共用同一张卡,
 * 话就必须分开说:对它说「会自动记进日记」是一句假话。
 *
 * ## 为什么是受控的(和 `UnloggedMealSheet` 同一条理由)
 *
 * `renderToStaticMarkup` 不跑 effect,组件内部的 `useState` 在自检里**永远是初值**
 * —— 上面那三句话一句都断言不到。做成受控的,`verify-render.mjs` 直接渲染并断言。
 */
export function LogNotice({
  open,
  kind,
  done = false,
  error = null,
  onClose,
}: {
  open: boolean
  /** 哪条出口点的 —— 两句话说的不是同一件事(见文件头) */
  kind: 'log' | 'adjust'
  /** 算完了。只有卡还在屏上时才有人看到这一句 */
  done?: boolean
  /** 没算出来(调用方给的人话)。有值时那一句换成它 */
  error?: string | null
  /** 关掉它 —— 点「知道了」和点别处是**同一个**出口(用户定的) */
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="算营养的提示">
      {/*
        点别处也能关 —— 用户点名的两个出口之一(另一个是下面那颗「知道了」)。
        和 `UnloggedMealSheet` 那层遮罩同一个写法、同一个 `aria-label`。
      */}
      <button
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
        aria-label="关闭"
      />

      <div className="animate-fade-in absolute top-1/2 left-1/2 flex w-[78%] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[20px] bg-[#FAFAFC] px-5 py-5">
        {error ? (
          <>
            {/*
              `role="status"`:这是一次操作的结果,不是装饰文字 —— 读屏用户也得
              知道刚才那一下没算出来。(和它替掉的那一行是同一个理由,那行原来
              挂在补记弹窗上。)
            */}
            <p role="status" className="text-[15px] leading-[22px] text-danger-text">
              {error}
            </p>
            {/*
              这一句和「已经记进日记了」是**同一个位置的两个反面**。没有它,用户
              只会读到「没算出来」,然后以为这顿饭没了 —— 而草稿和照片都还在,
              下次进对话页照样会问(见 `store/unlogged.ts`)。
            */}
            <p className="text-[13px] leading-[19.5px] text-muted">
              这条先留着 —— 下次进对话页还会问你。
            </p>
          </>
        ) : (
          <p className="text-[15px] leading-[22px] text-ink">
            {kind === 'adjust'
              ? '正在拿这张照片算营养，算好了打开记录面板让你改分量。'
              : done
                ? '已经记进日记了。'
                : '正在拿这张照片算营养，算好了会自动记进日记。'}
          </p>
        )}

        <PrimaryButton onClick={onClose}>知道了</PrimaryButton>
      </div>
    </div>
  )
}
