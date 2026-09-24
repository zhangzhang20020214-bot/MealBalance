/**
 * 拍餐盘 —— 一次识别的生命周期
 * ===========================================================
 * 「分析中」这一屏背后其实有三件异步的事:压缩图片 → 上传识别 → 匹配食物库。
 * 这个模块把它们收成**一个可订阅的 job**,并负责三件只有它该管的事:
 *
 *   1. **取消** —— 在途请求的 AbortController
 *   2. **过期结果丢弃** —— 单调递增的 generation 令牌
 *   3. **预览图 object URL 的 revoke** —— 单一所有者,不会漏也不会撞
 *
 * ## 识别本身不在这里
 *
 * 第 ② 步(以及它前面的压缩)搬去了 `src/store/recognizeOne.ts`。
 * 切分的判据是:**那两步是「任何调用方都要做的事」,而上面这三件只有首页这条链要。**
 * 对话页也要发识别请求,但它不跳页、没有 job、还自己管着一批照片 ——
 * 复用 `startPlateJob` 会同时踩三颗雷(`setPending(null)` 抹掉上一张的结果、
 * 往全 App 唯一一份草稿里串味、被「停止分析」顺手掐断),三条都写在
 * `recognizeOne.ts` 的文件头里。
 *
 * 于是这个文件剩下的职责是一句话:**把 `recognizeOne` 的四种归宿翻译成 job 状态**,
 * 外加守住 generation 令牌和预览图的 revoke。
 *
 * ## 一次几张
 *
 * `startPlateJob` 收的是一**批**文件(1~3 张,上限在 `composer.ts`)。用户可能
 * 一张全景 + 一张主食特写 —— 和对话页那条路一样,每张各走一次识别,再交给
 * `mergeMeals` 合成一餐。
 *
 * 四件事因此和单张时不一样,每一件都在下面写了理由:
 *
 *   1. **三张一起发,不是一张接一张**(2026-09-24 改) —— 见 `run()` 里那段。
 *   2. **每张一个新 AbortController** —— 共用一个的话,第 1 张超时会把后两张
 *      的信号一起打成 aborted,而 `recognizeOne` 把那判成「用户自己取消」,
 *      于是**一张都不出、也不报错**。(对话页踩过同一个坑,见 chatSession.ts 文件头。)
 *      并发之后这条从「好习惯」变成**必须**。
 *   3. **预览图按下标收着,最后只留一张** —— 屏幕上只有一格图,另外几个
 *      几 MB 的 blob 没有任何界面会渲染它们。
 *   4. **结果里挂哪张图 = 第 1 张成功识别出来的那张** —— 理由见 `run()` 落地那段。
 *
 * ## 为什么请求必须从手势里发起,不能放进 useEffect
 *
 * 原来 AnalyzingScreen 是在 effect 里同步 `setPending(recognizeMeal())` 的。
 * 那是个纯计算,跑两遍无所谓;换成一个**会真的调视觉模型**的请求之后,
 * `main.tsx` 里的 `<StrictMode>` 会让 effect 在开发环境下双调用 ——
 * 也就是**每拍一张照片烧两次额度**。
 *
 * 所以 `startPlateJob()` 由点击事件调用。React 的 StrictMode **只双调用
 * effect,从不双调用事件处理器**,这条路径上的重复请求是结构性不可能的,
 * 不需要靠任何标志位去防。分析页只负责订阅结果并展示。
 *
 * ## 为什么令牌是模块级变量而不是 useRef
 *
 * StrictMode 的挂载序列是 mount → unmount → mount,`useRef` 会跟着重建 ——
 * 拿它当「最新一次」的凭据,第二次挂载看到的是一个空 ref,挡不住任何东西。
 * 模块级计数器活得比组件久,才真的能分辨「这是不是最新那次」。
 */

import { advance, type AnalyzeStage } from '../lib/analyzeStage'
import { mergeMeals } from '../lib/mergeMeals'
import { currentSlot } from '../lib/slots'
import { cancelLogRun } from './logRun'
import { getPending, setPending, type RecognizedMeal } from './recognize'
import { recognizeOne, type RecognitionOutcome } from './recognizeOne'
import { getSnapshot } from './store'
import type { MealItem, MealSlot } from './types'

/* ------------------------------------------------------------
   job 状态
   ------------------------------------------------------------ */

export type PlateStage =
  /** 还没有任务(直接打开分析页 / 已经停掉) */
  | 'idle'
  /** 正在解码 + 压缩 */
  | 'preparing'
  /** 正在识别 */
  | 'recognizing'
  /** 有结果了 —— 结果本身在 recognize 的 pending 里 */
  | 'done'
  /** 连结果都出不来(图片本身的问题) */
  | 'error'

export type PlateFailureCode =
  /** 图片解不开 / 不是图片 / 压完还超限 —— 重试通常没用,要换一张 */
  | 'IMAGE'
  /** 网络层失败 */
  | 'NETWORK'

export interface PlateJob {
  /** 单调递增。订阅方可以拿它判断「是不是同一个任务」 */
  id: number
  stage: PlateStage
  /**
   * 压缩后那张图的 object URL —— 分析页左边那个预览用。
   *
   * ⚠️ 它的 revoke **只在本模块里发生**(新任务开始、主动停止、显式释放)。
   * 别在组件里加 `useEffect(() => () => URL.revokeObjectURL(...), [])`:
   * StrictMode 下那个 cleanup 会在挂载后立刻跑一次,**图还挂在屏幕上就被撤销了**,
   * 表现是预览一闪变成裂图。事件处理器不会被双调用,所以清理只从事件里发起。
   */
  previewUrl?: string
  /**
   * 进行到哪一步了 —— 只给「分析中」那一屏看的进度。
   *
   * ⚠️ **刻意不并进 `stage`。** 那个字段是**路由判据**:`AnalyzingScreen`
   * 的 idle / done / error 三个分支全读它,`plate.ts` 自己也在几处按它分支。
   * 往里塞进度值,等于把「任务处于什么状态」和「进行到哪一步」搅成同一件事 ——
   * 和当初没把 `via: 'web'` 塞进 `isUnmatchedId` 是同一条理由。
   *
   * 只有 `preparing` / `recognizing` 这两个进行中的状态才带它;落地
   * (done / error)和 idle 都不带 —— 于是「任务结束了却还挂着一步进度」
   * 在类型上就是不可能的,不需要靠界面去记得忽略它。
   */
  step?: AnalyzeStage
  /**
   * 这一批一共几张 —— 「正在识别 3 张…」那个数字。
   *
   * ⚠️ **原来这里是个 `{ index, total }`,2026-09-24 去掉了 `index`。**
   * 三张现在是**并发**跑的(以前是 `for` + `await`,一张接一张),同时有三张
   * 在飞的时候「正在认第几张」**没有意义**:任意时刻它们各自处在不同的步上
   * (`compress` / `upload` / `recognize` 混着),报「第 2 张」是在描述一个
   * 不存在的顺序。剩下的「一共几张」是真话,而且正是用户要的 ——
   * 它回答了「它到底收了我几张」。
   *
   * ⚠️ **和 `step` 一样刻意不并进 `stage`**,理由同那一段:那个字段是路由判据,
   * 往里塞进度等于把「任务处于什么状态」和「进行到第几步」搅成同一件事。
   *
   * **只有一次不止一张时才带它。** 单张时「正在识别 1 张…」是句废话,而多摆
   * 一行字的代价不只是难看:那一行会占掉「分析中」这一屏本来就紧的高度。
   * 于是单张那条路的 job 形状和这次改动之前**逐字段相同**。
   */
  photos?: number
  /**
   * 有值 = 这个 `stage: 'done'` 是**提前**报的:菜名和 advice 已经在 pending 里,
   * 而「联网补库外菜营养」那一段还在后台跑。
   *
   * ⚠️ 和 `step` / `photos` 不是一回事。`stage` 依然是**路由判据**(分析页按它跳转),
   * 这个字段只回答一件事:「屏幕上那份 done 是终稿还是预稿」。结果页靠它决定
   * 那一行报警怎么写 —— 预稿期间库外菜是「正在联网查」,不是「查不到、按 0 计」。
   * 这是两句不同的话,说错哪一句都是在描述一件没发生的事。
   *
   * 终稿落地时**不带它**(`setJob` 整个重建),所以「后台跑完了」在类型上
   * 就是「这个键没有了」,不需要再拿一个布尔量去表达同一件事。
   */
  provisional?: boolean
  /** 有值 = 这次结果是**演示数据**,界面必须标注出来 */
  degradedReason?: string
  error?: { code: PlateFailureCode; message: string }
}

let job: PlateJob = { id: 0, stage: 'idle' }
const listeners = new Set<() => void>()

function setJob(next: PlateJob): void {
  job = next
  for (const l of listeners) l()
}

export function getPlateJob(): PlateJob {
  return job
}

export function subscribePlateJob(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/* ------------------------------------------------------------
   内部状态
   ------------------------------------------------------------ */

/**
 * 令牌。每次开始新任务 +1,在途的回调只有拿到**当前值**时才允许写状态。
 * 取消之后依然会有回调从 await 里醒过来 —— 挡在写状态之前,它们就无声地结束。
 */
let generation = 0

/**
 * 在途的闸门。**一次任务里每张一个** —— 共用一个的坏法见文件头第 1 条。
 *
 * 收在 Set 里而不是只留「当前那张」的引用:重试时上一批可能还有一张在途,
 * 只记最后一个是漏的。
 */
let gates = new Set<AbortController>()

function abortGates(): void {
  for (const g of gates) g.abort()
  // 换一个新 Set 而不是 clear():一个已经在途的回调如果又建了一个闸门,
  // clear 会把新的那个一起算进「旧的」里(chatSession.ts 同一条)
  gates = new Set()
}

/**
 * 上一次拍的那批文件 —— 只给「重试」用,所以 `stopPlateJob()` **不清它**:
 * 用户点重试的时候,任务早就停了,清掉就没得重试。
 */
let lastFiles: readonly File[] | null = null

function revokePreview(): void {
  if (job.previewUrl) URL.revokeObjectURL(job.previewUrl)
}

/* ------------------------------------------------------------
   开始 / 停止 / 重试
   ------------------------------------------------------------ */

/**
 * 开始一次识别。**从点击事件里调用** —— 理由见文件头那段 StrictMode 的说明。
 *
 * @param files 一批(1~3 张)。**空数组 = 什么都不做**,只把 job 拨回 idle ——
 *   类型上允许,是因为调用方那份列表是用户一张张删出来的,而「删到一张不剩」
 *   是个合法状态。真发出一个空请求才是灾难(识别 0 张、屏上一张空卡)。
 * @returns 本次任务的 id
 */
export function startPlateJob(files: readonly File[], slot: MealSlot = currentSlot()): number {
  // 上一张的预览图就是为上一次识别而存在的,新任务开始即作废
  revokePreview()
  abortGates()

  const myGen = ++generation

  if (files.length === 0) {
    setJob({ id: myGen, stage: 'idle' })
    return myGen
  }

  lastFiles = files

  // 结果页那份草稿先清掉 —— 放这里而不是分析页的 effect 里,
  // 是为了让「开始一次新识别」这个动作**原子**。分成两处的话,
  // StrictMode 下 effect 双调用会把刚写好的结果又抹掉一次
  setPending(null)
  /*
    首帧就带上张数。等到 `onPrepared` 才补的话,压缩的那一两秒里
    「正在识别 N 张…」是**缺席**的,而那一两秒恰恰是用户刚点完「开始分析」、
    最需要知道「它到底收了我几张」的时刻 —— 那一行字先不出现再冒出来,
    读起来像是刚发现少了一张。
  */
  setJob({
    id: myGen,
    stage: 'preparing',
    step: 'compress',
    ...(files.length > 1 ? { photos: files.length } : {}),
  })

  void run(myGen, files, slot)
  return myGen
}

/** 停在「分析中」不动了 / 用户点了停止。在途请求一并取消,不白烧一次视觉调用 */
export function stopPlateJob(): void {
  abortGates()
  generation++ // 在途回调全部作废
  revokePreview()
  setJob({ id: generation, stage: 'idle' })
}

/** 用同一批文件再来一次 —— 给「重试」按钮用 */
export function retryPlateJob(slot: MealSlot = currentSlot()): number | null {
  if (!lastFiles || lastFiles.length === 0) return null
  return startPlateJob(lastFiles, slot)
}

/**
 * 释放预览图。
 *
 * 从**事件处理器**里调(归档完成、明确放弃这次结果),不要从 effect cleanup 里调 ——
 * 理由同 PlateJob.previewUrl 那段注释。
 */
export function releasePlatePreview(): void {
  revokePreview()
  job = { ...job, previewUrl: undefined }
}

/**
 * 作废「属于当前档案的进行中工作」—— 切换档案、删除档案时调。
 *
 * 为什么必须有这个函数:`pending`(recognize.ts)和 `job`(本文件)都是**模块级**
 * 单例,而 `run()` 在**请求发出时**抓了一份 `{ profile, meals }`(见下方
 * `getSnapshot()` 那行)。于是一条具体的错路:
 *
 *   档案 A(花生过敏)拍餐盘 → 请求带着 A 的忌口发出 → 归档前切到档案 B
 *   → 结果页整个按 B 渲染(横幅上还写着 B 的名字)
 *   → 归档写进 **B 的日记**
 *
 * 换个说法:一次为 A 做的过敏拦截,产出的记录落进了 B。所以切换档案前必须
 * 把在途请求掐掉、把等待归档的结果清掉。
 *
 * ② **在飞的那一趟「记进日记」**(2026-09-24 下午加的)——
 *    `logRun.ts` 里那一趟比这个还重:它算完是**直接 `addMeal`** 的。
 *    为 A 拍的饭在算的时候切到 B,算完那一下就是**一条为 A 算出来的记录
 *    永久落进了 B 的日记**——比上面那条错路更重,因为它写进的是日记本。
 *    那里是**静默**掐掉的(不写失败态):B 从没点过任何东西,不该在 B 的日记上
 *    看到一句「没算出来」。草稿由 `clearUnloggedFor(id)` 收。
 *
 * 四个动作各自都是幂等的:没有在途请求时 `abort()` 空转,`setPending(null)`
 * 本来就是空值,`cancelLogRun()` 在没有那一趟时只把令牌 +1。
 *
 * ⚠️ store.ts 会 import 这个函数,而本文件又 import 了 store.ts 的
 * `getSnapshot`(`logRun.ts` 也一样)—— 存在一个模块环:
 * `store.ts → plate.ts → logRun.ts → store.ts`。安全的前提是**每个方向都只在
 * 函数体里用**,所以模块求值期不会读到还没初始化的绑定(函数声明有提升)。
 * 往这三个文件里加**模块顶层**的跨文件调用之前,先想清楚这一点。
 */
export function abortProfileWork(): void {
  stopPlateJob()
  releasePlatePreview()
  setPending(null)
  cancelLogRun()
}

/* ------------------------------------------------------------
   主流程
   ------------------------------------------------------------ */

/**
 * 一次识别的结果 → job 状态。
 *
 * 四种归宿的翻译规则(左边来自 `recognizeOne`,右边是这一屏能看见的东西):
 *
 *   ok         → `done`,结果进 `pending`
 *   degraded   → `done` + `degradedReason`,结果同样是那份本地组出来的演示餐盘
 *   cancelled  → `idle` —— 用户自己按的停止,**不是故障**,不摆错误界面
 *   failed     → `error`,只有它是真的要用户换一张图
 */
async function run(myGen: number, files: readonly File[], slot: MealSlot): Promise<void> {
  /*
    「这次结果还要不要」—— 压缩醒来、识别回来、以及每一次进度上报,三处共用
    同一个判据。写成一份而不是三处各写一遍 `myGen !== generation`:同一件事
    两个实现早晚分叉,而这里分叉的后果是「某个入口忘了挡」这种只在特定时序下
    出现的挂死。
  */
  const current = () => myGen === generation

  // 每次现取,不缓存:用户可能刚记了一餐就过来拍
  const { profile, meals } = getSnapshot()

  const total = files.length

  /*
    逐张压缩出来的预览图,**按下标对齐**。落地时只有一张会留着(见下面
    「挑哪张图」),其余的必须在这里撤掉 —— 屏幕上只有一格图,而每一张
    都是一个几 MB 的 blob。

    存数组而不是「用一张丢一张」:最后要挑的那一张,判据是「哪一张识别成功了」,
    而那件事要等**全部跑完**才知道 —— 提前丢掉就没得挑了。
  */
  const previews: (string | undefined)[] = []
  /** 200px 缩略图(data URL),同样按下标对齐。和 previews 是两回事,见 recognizeOne */
  const thumbs: (string | undefined)[] = []

  /**
   * 分析页那一格图。**哪张先压完就用哪张**,全部跑完再换成「第 1 张成功的」。
   *
   * 要的不是「第 1 张」,是**任何时刻都有图可看**:压缩要一两秒,那几秒里
   * 屏上不该退回相机图标。并发之后「先压完的是哪张」不确定(三张一起压,
   * 谁先回来取决于图的大小),但那一格只是「用户在等的时候看着自己拍的东西」,
   * 落地时按 `firstOk` 重新挑一次才是算数的那次。
   */
  let shown: string | undefined

  /** 只留 `keep` 那一张,其余预览图当场撤销 */
  const dropPreviewsExcept = (keep: string | undefined): void => {
    for (const url of previews) {
      if (url && url !== keep) URL.revokeObjectURL(url)
    }
  }

  /**
   * 把用户确认过的克数搬回终稿。
   *
   * **按菜名对齐,不按下标。** 同一道库外菜在预稿里是 `unmatched:名字`、在终稿里
   * 是 `web:名字` —— 两份里的 foodId 并不相同。按下标搬会在「同一道菜在两份里
   * 的先后不一样」时错位,而错位是静默的。
   *
   * 终稿里多出来的菜(理论上不会有)保留它自己的克数:那是库里的常见分量,
   * 不是「用户没选过」的 0。
   */
  const carryPortions = (next: readonly MealItem[], prev: readonly MealItem[]): MealItem[] => {
    const grams = new Map(prev.map((i) => [i.name, i.grams]))
    return next.map((i) => {
      const g = grams.get(i.name)
      return g === undefined || g === i.grams ? i : { ...i, grams: g }
    })
  }

  /** 每张图的**预结果**,下标对齐 `files` */
  const provisionals: (RecognizedMeal | undefined)[] = []

  /**
   * 让**快路径那份菜名**说话。
   *
   * 为什么需要它:快路径和完整那一路是**两条独立调用、各自认了一遍菜**,同一盘菜
   * 很可能给出两种说法 —— 实测同一张照片,快路径说「青椒洋葱炒肉片 / 清炒小白菜」,
   * 终稿说「青椒肉丝 / 素炒时蔬」。后果有两个,都看得见:
   *
   *   · 用户在分量页看到一套名字,进结果页变成另一套 —— 像换了盘菜
   *   · `carryPortions` 是**按菜名**搬克数的,名字对不上就搬不过去,
   *     用户亲手选的「多量」白选
   *
   * 这件事不该靠改提示词去「让两次认得一样」—— 那是要求一个随机过程两次输出
   * 同一个字符串,做不到。正确的做法是**只让一份说话**:用户在分量页上看到的是
   * 快路径那份,终稿就该 adopt 它。
   *
   * 为什么敢 adopt:`MealItem.name` **本来就是个显示副本**(见 types.ts 那句
   * 「冗余存一份名字」),营养身份挂在 `foodId` 上。两次识别指向**同一个 foodId**
   * 就说明它们说的是同一道菜,换个说法而已,营养一分不差。
   *
   * ⚠️ 判据必须**逐位**比 foodId,而且**数量也要一样**。任何一条不满足就原样
   * 返回终稿 —— 那说明两次认的不是同一批东西,硬套名字等于把 A 的菜名贴在 B 的
   * 营养上,是个看不出来的错。
   *
   * 只做单张:一次多张时预结果要等所有张都报齐,和终稿的下标对应关系不再显然,
   * 拿不准就不做 —— 退回原来的行为(名字可能不同,但不会错)。
   */
  const reconcileNames = (meal: RecognizedMeal): RecognizedMeal => {
    if (total !== 1) return meal
    const early = provisionals[0]
    if (!early || early.items.length !== meal.items.length) return meal
    if (!early.items.every((it, i) => it.foodId === meal.items[i].foodId)) return meal
    return { ...meal, items: meal.items.map((it, i) => ({ ...it, name: early.items[i].name })) }
  }
  /**
   * 预结果报出去了没有。
   *
   * **必须每一张都有才报。** 拿一张的菜去冒充「这一餐」,用户会在分量页上对着
   * 一份缺了一半的清单做决定 —— 而那几道菜不会出现在终稿里。单张时这一条
   * 自然成立(就是它自己)。
   *
   * 有一张始终没给预结果(压缩失败、降级成演示数据、模型没认出东西)时,
   * 这一趟就**没有**预结果 —— 退回原来的行为,等终稿。加速不是兜底。
   */
  let provisionalShown = false

  /**
   * 预结果落到界面上 —— 就是「提前报一次 done」。
   *
   * ⚠️ 顺序和终稿那边**完全一样**(先 `setPending`、再 `setJob`),理由也一样:
   * 订阅了 job 的分析页会在「已经 done」的那一帧里去读 pending,晚一步就会拿到
   * 上一份结果。`scripts/verify-render.mjs` 有一条**源级**不变量按调用顺序盯着
   * 终稿那两行 —— 这里是它的第二份,别把顺序反过来。
   */
  const showProvisional = (meals: RecognizedMeal[]): void => {
    const early = mergeMeals(meals.map((meal) => ({ kind: 'ok', meal }) as const))
    if (!early) return

    /*
      ⚠️ **列表不完整就不许提前弹。**

      预结果是从 LLM 节点来的,那一刻库外菜还没有营养值 —— 它们会落在
      `unmatched` 哨兵上。而分量页是按「有没有基准克数」列的:**主列表只收
      库里有营养的菜**,库外那几道只能挤在下面一行小字里解释。

      那行小字救不了这件事。用户看到的是「我拍了三道菜,屏幕上只有两道」,
      而剩下那道以小字出现 —— 读起来就是**这个 App 没认出来**。一句解释
      对抗不了一个残缺的列表。

      所以判据收在这儿:只要还有一道没归位,就**不提前弹**,让用户等终稿。
      代价是这一类照片拿不到那 7 秒的提前量;换来的是**这一屏的列表永远是完整的**。
      拿不准的时候,完整性优先于速度。
    */
    if (early.unmatched && early.unmatched.length > 0) return

    const firstOk = meals.findIndex((m) => m.items.length > 0)
    const earlyPhoto = firstOk === -1 ? undefined : previews[firstOk]
    const earlyThumb = firstOk === -1 ? undefined : thumbs[firstOk]

    /* 整个重建,而不是展开 job —— 预稿和终稿一样不带 step / photos,见 PlateJob 那段 */
    setPending({
      ...early,
      ...(earlyPhoto ? { photoUrl: earlyPhoto } : {}),
      ...(earlyThumb ? { thumbDataUrl: earlyThumb } : {}),
    })
    setJob({
      id: myGen,
      stage: 'done',
      provisional: true,
      ...(earlyPhoto ? { previewUrl: earlyPhoto } : {}),
    })
  }

  /*
    ⚠️ **三张一起发,不是一张接一张(2026-09-24 改)。**

    原来是 `for` + `await recognizeOne(...)`:每张一次视觉调用、十几到几十秒,
    三张串行下来一分多钟 —— 而这三张本来就是**同一餐的几个角度**(一张全景 +
    一张主食特写 + 一张汤),没有任何一张的结果需要等另一张。用户的原话:

      「首页入口同一次发的三张图,app是一张一张读的,哪怕这三张图只是同一道
        食物的不同角度照片」

    同一段形状在 `ChatScreen.sendPhotos` 和 `logRun.computeForLog` 里各有一份,
    三处一起改了。

    ## 为什么是 `Promise.all(map(...))`,而不是 `for (let i…) { outcomes[i] = await … }`

    **`outcomes` 的顺序必须 = `files` 的顺序。** 用 `push` 的话顺序 = **完成
    顺序**,而下面每一处都假设 `outcomes[i]` 就是第 i 张:`previews[firstOk]` /
    `thumbs[firstOk]`(落地时挑哪张图跟着结果走),以及调用方那边的
    `okPhotoBlobs` / `firstOkThumb`。错位**不会崩、也不会报错**,是**静默配错
    图** —— 结果页上那盘菜旁边摆着一张和它无关的照片,正是下面 `firstOk` 那段
    要防的事,只是换了个方向发生。`Promise.all` 收的就是 map 的返回值,
    天然按下标。

    ## 「下一张从头开始」那段为什么整个删了

    原来循环尾巴上有一句「不拨回去的话,第 2 张会顶着第 1 张最后那句话跑完」,
    靠的是**步骤跟着张数走**。并发之下没有「下一张」这个时刻,三张各自从
    `compress` 起步,进度由 `advance` 折成一条单调的线(见下面 `onStage`)。

    ⚠️ **整批的作废挡在全部回来之后,不在每张开头。** 每一张自己的作废由
    `recognizeOne` 内部的 `isCurrent` 负责(它会返回 `{ kind: 'cancelled' }`),
    这里这一次挡的是**这一批的归宿** —— 取消了就不该再往下走落地那一段。
  */
  const outcomes: RecognitionOutcome[] = await Promise.all(
    files.map(async (file, i) => {
      /*
        ⚠️ **每张一个闸门,不共用。**

        `recognizeOne` 超时时会 abort 掉传进来的那个 controller(它只有这一个
        掐断手段)。共用一个的话,第 1 张超时就把第 2、3 张的信号一起打成 aborted,
        而 `recognizeOne` 把那判成「用户自己取消」—— 于是**一张都不出、也不报错**。
        用户看到的是「第 2、3 张不见了」加一张只有第 1 张的卡,而真正发生的事情是
        那两张照片**根本没被送出去过**。

        并发之后这条从「好习惯」变成**必须**:三张同时在飞,一张超时随手就能把
        另外两张一起掐掉。

        `stopPlateJob()` 一次全掐(`abortGates`),所以「停止分析」照样管用。
      */
      const gate = new AbortController()
      gates.add(gate)

      const outcome = await recognizeOne({
        file,
        slot,
        profile,
        meals,
        controller: gate,
        isCurrent: current,
        /*
          结果里的照片不挂在这一份识别结果上 —— 一次几张时「这一餐的那张照片」
          不成立(`mergeMeals.ts` 文件头那段)。照片由本模块按下标收着,
          落地时**替整批**挑一张。
        */
        attachPreview: false,
        onPrepared: (url) => {
          previews[i] = url
          if (!shown) {
            shown = url
            /*
              展开当前 job 是没必要的(此刻它就是 preparing),重建一份更清楚。

              ⚠️ `step` 也要**折一下**再写:先压完的那张不一定是先报阶段的
              那一张,而这份重建会**整个**换掉 job —— 直接写 `'upload'`
              就是把另一张已经报到的「正在识别菜品」顶回去。同 `onStage`。
            */
            setJob({
              id: myGen,
              stage: 'recognizing',
              previewUrl: url,
              step: advance(job.step ?? 'compress', 'upload'),
              ...(total > 1 ? { photos: total } : {}),
            })
          }
        },
        onThumb: (dataUrl) => {
          thumbs[i] = dataUrl
        },
        /*
         * 真实进度 —— 上游每开始一个节点就报一次,由 recognizeAgent 保证单调。
         *
         * ⚠️ 这里必须自己再挡一次「是不是最新那个任务」:用户按下「停止分析」
         * 或另拍一张之后,在途的节点事件**还会继续到达**(abort 掐断的是
         * fetch,不是已经排进微任务队列的回调)。不挡的话,一个已经停掉的
         * 任务会被这几行重新点亮,而且它永远不会有结果 —— 分析页就此挂死。
         *
         * ⚠️ **而且必须用 `advance` 折一下,不能直接写 `step: next`(2026-09-24)。**
         * 一次只有一张在跑时,迟到的节点顶多来自同一张;现在三张同时在飞,
         * 第 1 张迟到的「正在识别菜品」会在第 3 张已经报到「正在生成回答」之后
         * 到达 —— 直接写下去,那一行字会在几个阶段之间来回跳,用户看到的是一个
         * **反复倒退**的进度条。`advance` 是单调的(只往前走),而且
         * `moved === job.step` 时连 `setJob` 都不发,免得白通知一轮订阅者。
         *
         * 展开当前 job 而不是重建一份,是为了保住 previewUrl:那一格图是
         * 用户自己拍的那张,进度更新不该把它抹掉。
         */
        onStage: (next) => {
          if (!current()) return
          const moved = advance(job.step ?? 'compress', next)
          if (moved === job.step) return
          setJob({ ...job, step: moved })
        },
        /*
         * 预结果 —— LLM 节点刚跑完,菜名、suitable、reason、advice 都在手上了。
         *
         * 和 `onStage` 同理,「是不是最新那个任务」得自己再挡一次:abort 掐断的是
         * fetch,已经排进微任务队列的回调照样会到。不挡的话一个已经停掉的任务
         * 会被重新点亮,而它永远不会有终稿。
         */
        onProvisional: (meal) => {
          if (!current()) return
          provisionals[i] = meal
          if (provisionalShown) return
          const all = provisionals.filter((m): m is RecognizedMeal => Boolean(m))
          if (all.length !== total) return
          provisionalShown = true
          showProvisional(all)
        },
      })

      gates.delete(gate)
      return outcome
    })
  )

  // 整批作废(用户点了停止 / 又拍了新的一张)—— 那份结果不再属于任何人
  if (!current()) {
    dropPreviewsExcept(undefined)
    return
  }

  /* ---------- 落地 ---------- */

  const merged = mergeMeals(outcomes)

  if (!merged) {
    /*
      ⚠️ **交过预结果之后就不能再摆错误界面了。**

      用户手里那一份是真的:菜名、suitable、reason、advice 全部来自模型的 LLM
      节点,唯一缺的是库外菜联网查回来的每 100g 营养值 —— 而那几道会留在
      「未收录、按 0 计」上,明着写出来。把整份结果收走、换成一个「识别失败」,
      是拿真东西去换一句假消息。

      照片同理:它还挂在结果页上,`dropPreviewsExcept(undefined)` 会当场把它
      变成裂图。
    */
    if (provisionalShown) {
      /*
        先落 pending 再报 done —— 规矩同上,只是这里落的**还是手里那一份**:
        后台没补上营养,所以结果一个字都没变,但那一次 done 对应哪一份结果
        必须重新宣布一次,否则订阅方读到的是一份没有对应 done 的旧值。
      */
      const kept = getPending()
      if (kept) setPending(kept)

      setJob({
        id: myGen,
        stage: 'done',
        ...(job.previewUrl ? { previewUrl: job.previewUrl } : {}),
      })
      return
    }

    dropPreviewsExcept(undefined)

    /*
      一张都没出菜。两种归宿,区别是「要不要摆一个错误界面」:

        · 有一张真的读不出来 → 错误界面。用户需要换一张,这是可行动的。
        · 全被用户自己取消 → 安静回到 idle。取消不是故障(analyzeStage 那条
          「cancelled 是另一回事」的规矩,这里原样保留)。
    */
    const failed = outcomes.find((o) => o.kind === 'failed')
    if (!failed) {
      setJob({ id: myGen, stage: 'idle' })
      return
    }
    setJob({ id: myGen, stage: 'error', error: { code: failed.code, message: failed.message } })
    return
  }

  /*
    挑哪张图跟着结果走 —— **第 1 张成功识别出来的那张**。

    为什么不是第 1 张(用户选的第一张)也不是全部:结果页那个相框只有一格。
    摆第 1 张的话,「第 1 张没认出来、第 2 张认出来了」那种情况下,那盘菜旁边
    会是一张**和它无关的照片** —— 和 recognizeOne 里「不给演示数据配真照片」
    防的是同一类错误,只是方向相反。

    全部降级(engine === 'demo')时 `firstOk` 是 -1,一张都不挂 —— 那份餐盘是
    本地随机组的,配一张真照片就是在暗示一个不存在的因果。

    挑剩下的立刻撤掉:`dropPreviewsExcept` 撤销的正是「屏幕上没有的那几张」。
  */
  const firstOk = outcomes.findIndex((o) => o.kind === 'ok')
  const photo = firstOk === -1 ? undefined : previews[firstOk]
  const thumb = firstOk === -1 ? undefined : thumbs[firstOk]

  dropPreviewsExcept(photo)

  /* 终稿认领快路径的菜名 —— 理由见上面 reconcileNames 那段 */
  const accepted = reconcileNames(merged)

  /*
    ⚠️ **`setPending` 必须先于 `setJob`。**

    反过来的话,订阅了 job 的分析页会在「已经 done」的那一帧里看到一份
    **还没写进去的旧 pending**(或者 null),于是它按 done 分支跳去结果页,
    而结果页拿到的是上一张图的结果 —— 或者直接是空状态。

    这两行今天**没有任何断言盯着**(写测试的人看不见一个顺序),
    `scripts/verify-render.mjs` 里有一条**源级**不变量按下标序列盯着它,
    别把这两行调过来 —— 照片也一样,它是 pending 的一部分。
  */
  /*
    ⚠️ **分量是用户的,不能被这一份盖掉。**

    预结果先弹出去之后,用户可能已经在分量页上把克数改完、甚至已经进了结果页;
    而这份终稿是几秒后才回来的,它带的 `items[].grams` 是**库里的基准值**。
    直接盖上去 = 用户亲手选的「多量」被悄悄换回「常规」,界面上一个字都不会提。

    所以只在用户**已经确认过分量**时才做一次搬运(按菜名对齐)。没确认过就是
    原来那条路,一个字节都没变。
  */
  const prev = getPending()
  const carried: Partial<RecognizedMeal> =
    prev?.portionConfirmed && prev.items.length > 0
      ? { items: carryPortions(accepted.items, prev.items), portionConfirmed: true }
      : {}

  setPending({
    ...accepted,
    ...carried,
    ...(photo ? { photoUrl: photo } : {}),
    ...(thumb ? { thumbDataUrl: thumb } : {}),
  })

  setJob({
    id: myGen,
    stage: 'done',
    previewUrl: photo,
    ...(accepted.degradedReason ? { degradedReason: accepted.degradedReason } : {}),
  })
}
