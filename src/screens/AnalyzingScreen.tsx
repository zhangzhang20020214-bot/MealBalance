import { useEffect, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '../components/ios/Screen'
import { Icon } from '../components/Icons'
import { ANALYZE_STAGE_LABELS } from '../lib/analyzeStage'
import { getPending } from '../store/recognize'
import { countableItems } from '../lib/dishMatch'
import { getPlateJob, retryPlateJob, stopPlateJob, subscribePlateJob } from '../store/plate'

/**
 * 这一屏的**最短展示时间**。
 *
 * 它不是「跳转时刻」,是下限:任务再快也得让这一屏被看见一次,否则从点击到
 * 结果页就是一次没有任何反馈的闪跳。真正的跳转判据是 `settled && minShown`——
 * 两个条件,不是一个定时器。
 *
 * ⚠️ **别把它和下面那个秒表合成一个定时器。** 合成版在「任务 1 秒就落地」时会
 * 跟着停表,`minShown` 永远不为真 —— 用户卡死在分析页,而且卡的是**最快**的
 * 那条路(过敏拦截、或者一道菜都没匹配上)。
 */
const MIN_SHOW_MS = 3450

/**
 * 已用秒数等够这么久才显示。
 *
 * 秒表是整段等待里**唯一一直在动的东西** —— 「正在识别菜品」那 4~12 秒期间
 * 上面那行字一次都不会变,用户的「它是不是死了」全靠这个数回答。
 * 但快的时候(< 3 秒)闪一个「已用 0 秒」出来只是噪声,所以卡个门槛。
 */
const ELAPSED_VISIBLE_AFTER_MS = 3000

/** 任务落地后再停一下才跳 —— 让「分析完成」这四个字被看见 */
const HANDOFF_MS = 420

/**
 * 分析中 —— 对应 Figma「③ 界面原型 / 07 · 分析中 Analyzing」。
 *
 * ## 这一页不发起请求,只订阅结果
 *
 * 识别是在**点击拍照那一刻**(首页/对话页的手势处理器里)由
 * `startPlateJob()` 发起的。这一页只做两件事:把过程展示出来、把结果交出去。
 *
 * 这么分是因为 `main.tsx` 里有 `<StrictMode>`:放在这一页的 effect 里发起
 * 请求,开发环境下 effect 会跑两遍 —— 也就是每拍一张照片**烧两次视觉调用**。
 * React 只双调用 effect,从不双调用事件处理器,所以把请求放在手势里,
 * 重复请求是结构性不可能的,不需要任何标志位去防。
 *
 * 同理,这一页**不做取消清理**:StrictMode 的挂载序列是
 * mount → unmount → mount,如果在 unmount 的 cleanup 里 abort,
 * 第一次卸载就会把刚发出去的请求掐死,而且是开发环境独有的表现。
 * 取消只发生在用户点「停止分析」时。
 *
 * ## 进度是真的,不是定时器演出来的
 *
 * 这一页原来显示三步「识别菜品 / 匹配食物成分数据库 / 对照健康档案生成建议」,
 * 由一个 `STEP_MS = 1150` 的定时器驱动 —— 和真实任务**毫无关系**,上游快它
 * 也走 3.45 秒,上游卡住它照样走完然后干等。也就是说那一版**已经在骗人**,
 * 只是骗得比较含蓄。
 *
 * 现在显示的是 `job.step`,它的来处是 Dify 每个节点的 `node_started` 事件
 * (透传路径见 `api/_lib/agent.ts`)。上游快它就快、上游慢它就停在那一句上,
 * 每一句都对应工作流里真实存在的一个节点。词表和「为什么只许前进」见
 * `src/lib/analyzeStage.ts`。
 *
 * ⚠️ 注意这里**只渲染 `job`,不在渲染期读 `job.step` 之外的状态** ——
 * `scripts/verify-render.mjs` 用 `renderToStaticMarkup` 摆好 job 的状态
 * 就能断言每一帧,靠的就是「渲染期不跑 effect」。
 *
 * ## 跳转时机
 *
 * `max(3450ms, 实际耗时) + 420ms`。原来是一个写死的 420ms 定时器,
 * 和识别完成时机**完全解耦** —— 网络一慢就会提前跳到结果页,用户看到的
 * 是一屏空状态。现在必须等任务真的落地才走。
 */
export default function AnalyzingScreen() {
  const navigate = useNavigate()
  const job = useSyncExternalStore(subscribePlateJob, getPlateJob, getPlateJob)

  /** 已用毫秒。每走一秒 +1000,不读时钟 —— 见下面那段 */
  const [elapsedMs, setElapsedMs] = useState(0)
  /** 最短展示时间到了没 */
  const [minShown, setMinShown] = useState(false)

  /** 任务已落地(有结果或已失败)—— 表可以停了,页面准备收尾 */
  const settled = job.stage === 'done' || job.stage === 'error'

  /**
   * 秒表。
   *
   * 用「每次 +1000」而不是「拿当前时间减开始时间」:后者要么在渲染期读
   * `Date.now()`(渲染就不再是纯函数,这一页的静态渲染断言会跟着失稳),
   * 要么再存一个开始时刻的 state —— 多一个状态量,换来的只是把浏览器
   * 定时器的漂移换成人眼看不出的另一种偏差。
   *
   * `settled` 一变就把表停掉:任务都落地了还在数秒,是在给一个已经结束的
   * 过程计时。
   */
  useEffect(() => {
    if (settled) return
    const t = setInterval(() => setElapsedMs((ms) => ms + 1000), 1000)
    return () => clearInterval(t)
  }, [settled])

  /*
   * 最短展示时间 —— 一次性,和任务是否完成**无关**。
   * 独立成第二个定时器是必须的,理由见 MIN_SHOW_MS 上面那段。
   */
  useEffect(() => {
    const t = setTimeout(() => setMinShown(true), MIN_SHOW_MS)
    return () => clearTimeout(t)
  }, [])

  // 两个条件都满足才跳:最短展示时间到了 + 任务落地
  useEffect(() => {
    if (!settled || !minShown) return
    if (job.stage === 'error') return // 失败就停在这一页,让用户选怎么办
    const t = setTimeout(() => {
      /*
       * 有可算的菜 → 先去「确认分量」;没有 → 直接看结果。
       *
       * 判据就一条 `countableItems().length`,它同时兜住三种「没什么可称的」:
       * 模型说图里没有它认得出的菜、认出的菜一律没查到营养(既不在食物库里、
       * 也没联网查到)、过敏拦截(拦截分支的 dishes/items 都是空的)。
       * 那三种情况摆一个空的分量确认页只是让用户白点一次。
       *
       * ⚠️ 第二种的措辞是「没查到营养」,不是「不在食物库里」—— 库里没有的菜
       * 如果联网查到了值,它**是**可称的(有克数可调),这一屏照旧要去分量页。
       * 两件事在 `dishMatch` 里是两个前缀(`web:` / `unmatched:`),这里的判据
       * 两个都认。
       *
       * ⚠️ `getPending()` 在这里**命令式地读**,不挂进依赖数组 —— 下面这个
       * effect 的依赖是 `job.stage` 而不是 `job`,再塞一个 pending 订阅进来
       * 就多出一条重新触发的路径(定时器被清掉重建,跳转时机跟着漂)。
       *
       * ⚠️ **`replace: true` 是硬不变量,不是风格问题。** 整条链路只占**一个**
       * 历史条目:首页 push `/analyzing`,之后每一跳都 replace 掉自己。
       * 漏掉任何一个 replace,从结果页按浏览器返回就会回到这一页 —— 而那时
       * `job.stage` 还是 'done'、`minShown` 从 false 重新开始,于是重播一遍
       * 等待再转去分量页,变成一个按不出去的 4 秒乒乓,每绕一圈历史还长一截。
       */
      const items = getPending()?.items ?? []
      navigate(countableItems(items).length ? '/portion' : '/result', { replace: true })
    }, HANDOFF_MS)
    return () => clearTimeout(t)
  }, [settled, minShown, job.stage, navigate])

  /**
   * 那一行字。
   *
   * ⚠️ 不是拿 `job.step` 直接查表:任务落地时 `step` 就被清掉了
   * (见 plate.ts 里两处 `setJob({ stage: 'done' })`),直接查会渲染成空。
   * 「完成了」这件事由 `stage` 回答,它才是权威。
   *
   * `?? 'compress'` 那半句走不到:idle / error 两个分支在本行之前就 return 了,
   * 而进行中的两个状态(plate.ts 里)一定带着 step。它在那儿只是因为 `step`
   * 是可选的,TS 需要一个值。
   */
  const stageLabel = settled ? '分析完成' : ANALYZE_STAGE_LABELS[job.step ?? 'compress']

  /** 秒表读数。落地之后不再显示 —— 那是在给一个已经结束的过程计时 */
  const elapsedSec = elapsedMs / 1000
  const showElapsed = !settled && elapsedMs >= ELAPSED_VISIBLE_AFTER_MS

  /** 用户主动放弃 —— 在途请求一并取消,不白烧一次视觉调用 */
  function stop() {
    stopPlateJob()
    navigate('/', { replace: true })
  }

  /* ---------- 连结果都出不来:图片本身的问题 ---------- */
  if (job.stage === 'error') {
    return (
      <Screen tabBar={false} scroll={false} tone="light" background="bg-ink">
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="flex h-[84px] w-[84px] items-center justify-center rounded-[28px] bg-white/10">
            <Icon name="alertCircle" size={34} strokeWidth={1.7} className="text-white" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[19px] leading-[22.8px] font-bold text-white">这张图片用不了</h2>
            <p className="text-[13px] leading-[19px] text-white/80">{job.error?.message}</p>
          </div>

          <div className="mt-2 flex w-full max-w-[280px] flex-col gap-2">
            <button
              onClick={stop}
              className="h-12 w-full rounded-[14px] bg-brand text-[16px] font-medium text-white active:opacity-80"
            >
              换一张
            </button>
            <button
              onClick={() => navigate('/diary')}
              className="h-12 w-full rounded-[14px] bg-white/10 text-[16px] font-medium text-white active:opacity-80"
            >
              手动记录这一餐
            </button>
            {/*
              重试是给**偶发失败**留的路(比如编码时内存紧张)。
              同一张图再来一次通常还是同样的结果,所以它放在最后,不占主位
            */}
            <button
              onClick={() => {
                if (retryPlateJob() === null) navigate('/', { replace: true })
              }}
              className="h-11 w-full text-[14px] text-white/70 active:opacity-60"
            >
              重试
            </button>
          </div>
        </div>
      </Screen>
    )
  }

  /* ---------- 没有任务:直接打开这一页 / 刷新过 ---------- */
  if (job.stage === 'idle') {
    return (
      <Screen tabBar={false} scroll={false} tone="light" background="bg-ink">
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="flex h-[84px] w-[84px] items-center justify-center rounded-[28px] bg-white/10">
            <Icon name="camera" size={34} strokeWidth={1.7} className="text-white" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-[19px] leading-[22.8px] font-bold text-white">还没有待分析的照片</h2>
            <p className="text-[13px] leading-[19px] text-white/80">
              回到首页点「拍餐盘」，拍一张或从相册选一张。
            </p>
          </div>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="mt-2 h-12 w-full max-w-[280px] rounded-[14px] bg-brand text-[16px] font-medium text-white active:opacity-80"
          >
            去拍餐盘
          </button>
        </div>
      </Screen>
    )
  }

  /* ---------- 进行中 ---------- */
  return (
    <Screen tabBar={false} scroll={false} tone="light" background="bg-ink">
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-5">
        {/*
          有预览图就显示用户自己拍的那张,没有再退回相机图标。
          显示的是**压缩后**的那份 —— 也就是模型真正看到的那张,
          所以结果对不上时可以确定不是压缩弄丢的细节
        */}
        <div
          className="flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-[28px] bg-brand text-white"
          style={{ animation: 'pulse-ring 2s ease-in-out infinite' }}
        >
          {job.previewUrl ? (
            <img src={job.previewUrl} alt="待分析的餐盘" className="h-full w-full object-cover" />
          ) : (
            <Icon name="camera" size={36} strokeWidth={1.7} />
          )}
        </div>

        {/* 标题 */}
        <div className="flex h-[94px] flex-col items-center justify-center">
          <h2 className="text-[19px] leading-[22.8px] font-bold text-white">正在分析餐盘</h2>
          {/*
            原来这里写的是「约需 8 秒」。接上真实视觉模型之后耗时本来就不可预测 ——
            写死一个秒数就是一句会被现实验证的假话。改成只承诺我们真能保证的事:
            完成之后自动跳转

            ⚠️ **选了不止一张时,这句话要换成张数。** 张数是这一屏上唯一一个
            能回答「它到底收了我几张」的真实信息 —— 用户一次攒三张,而他按下
            「开始分析」之后最想确认的就是三张都被收下了。

            这里原来写的是「正在识别第 2 张,共 3 张」(逐张推进)。**2026-09-24
            改成只说张数**:三张变成**并发**跑的(`plate.ts` 那个 `Promise.all`),
            同时有三张在飞的时候「第几张」没有意义 —— 它们各自处在不同的步上,
            报一个数字是在描述一个不存在的顺序。用户那天选的就是这句。
          */}
          <p className="text-[13px] leading-[18.82px] text-white">
            {job.photos ? `正在识别 ${job.photos} 张…` : '识别完成后自动跳转'}
          </p>
        </div>

        {/*
          当前阶段 —— **单行**,不做成固定清单。

          固定清单在这里是错的:联网查营养那一步只有库外菜才走
          (`有没有库外菜` 那个条件分支),做成写死的三行就得凭空增删一行,
          而增删的依据只能是时间 —— 又回到「编一个假进度」那条路上了。

          呼吸点保留:它标的是「这一行是活的」,和上面那张图的 pulse-ring
          不是一回事(那个只是让方块别像一具尸体)。
        */}
        <div className="flex h-[94px] flex-col items-center justify-center gap-2">
          <div className="flex items-center gap-3">
            <span
              className={`h-2 w-2 shrink-0 rounded-full bg-brand ${settled ? '' : 'animate-pulse'}`}
            />
            <span className="text-[14px] leading-[20.27px] text-white">{stageLabel}</span>
          </div>

          {/*
            秒表。上面那行字在 `LLM` 那 4~12 秒里一次都不会变,「它还在动」
            这件事全靠这个数回答 —— 所以它不是装饰,是这一屏唯一的活体证据。
            `tnum` 让数字等宽:否则每秒宽度都不一样,整行会左右抖。
          */}
          {showElapsed && (
            <span className="tnum text-[13px] leading-[18.82px] text-white/70">
              已用 {elapsedSec} 秒
            </span>
          )}
        </div>

        {/* 停止 */}
        <button
          onClick={stop}
          className="flex h-11 w-full items-center justify-center text-[15px] leading-[21.72px] text-white active:opacity-60"
        >
          停止分析
        </button>
      </div>
    </Screen>
  )
}
