/**
 * 「记进日记」那一趟 —— 算营养 + 落盘的生命周期
 * ===========================================================
 * 用户在补记弹窗上点「记入日记」（或「调整分量再记」）之后，屏幕上跑的那十几到
 * 几十秒就是这一趟。这个模块管它：算、落盘、以及**谁该知道它现在到哪儿了**。
 *
 * ## 为什么它不在 `ChatScreen` 里（2026-09-24 下午搬出来）
 *
 * 原来这一趟住在对话页：`computeForLog` / `runCompute` / `logUnlogged` 全是那个
 * 组件的闭包，连「这一页还挂着没有」都得用 `aliveRef` 自己记。当天连着出了两次事：
 *
 *   1. 用户点完「记入日记」转身去看日记 —— 离开对话页会卸载组件，卸载那段 cleanup
 *      里当时写着 `abortLogRun()` + `logRunRef.current++`，**把他刚点的那一趟连同
 *      落盘一起掐了**，而且一句话都没说。他连报三次「到现在还是没有记到日记里啊」。
 *      （那一版先把落盘和「更新屏幕」分开，见 `logUnlogged` 里那段注释。）
 *   2. 紧接着他问：「我建议在计算的时候，可以在日记里显示这一餐正在计算，否则用户
 *      点击确定后并不知道是已经在算了还是没有计算」—— 日记页要看的那件事，
 *      恰恰是**另一个组件里的闭包**，它够不着。
 *
 * 所以整趟搬出来。搬出来之后「这一页还在不在」这个问题**不存在了**：
 * 落盘的判据里没有任何组件状态，日记页和对话页是**同一份事实的两个视图**
 * （`pendingForDate` / `noticeFor` 就是那两把尺子）。
 *
 * ## ⚠️ 只有「记入日记」那条会落盘，「调整分量再记」不会
 *
 * 后者算完接的是记录面板（面板里点保存才 `addMeal`），所以它对日记页**不显示**
 * 占位行 —— 对它说「这一餐正在算」是一句假话（见 `pendingForDate`）。
 *
 * ## ⚠️ 请求只能从手势里发起
 *
 * `startLogRun` 由点击事件调用（`onLog` / `onAdjust`），**不许放进 useEffect**：
 * `main.tsx` 里那个 `<StrictMode>` 会双调用 effect，等于每点一次烧两趟食衡额度。
 * React 从不双调用事件处理器，这条路径上的重复请求是结构性不可能的 ——
 * 和 `plate.ts` 文件头那条是同一个理由。`startLogRun` 里另外有一道幂等闸
 * （在飞的时候再点一次直接返回），挡的是**双击**。
 *
 * ## ⚠️ 切档案会静默掐掉这一趟
 *
 * 一条具体的错路：为档案 A（花生过敏）拍的饭还在算，用户切到 B —— 算完
 * `addMeal` 一写，**一条为 A 算出来的记录永久落进了 B 的日记**。比 `plate.ts`
 * 里那条「为 A 做的拦截产出落进 B」还重，因为它写进的是日记本。
 *
 * 所以 `abortProfileWork()`（`plate.ts`）里挂了 `cancelLogRun()`，切换/删除档案
 * 时把这一趟掐掉，而且**不写失败态**（否则 B 的日记上会冒出一句「没算出来」，
 * 而 B 从没点过任何东西）。草稿由 `clearUnloggedFor(id)` 收。
 *
 * ## ⚠️ 模块环
 *
 * `store.ts → plate.ts → logRun.ts → store.ts`。安全的前提和 `plate.ts` 那句
 * 一模一样：**三个方向都只在函数体里用**（`getSnapshot` / `addMeal` 是函数声明，
 * 有提升），模块求值期不会读到还没初始化的绑定。往这几个文件里加**模块顶层**的
 * 跨文件调用之前，先想清楚这一点。
 */

import { useSyncExternalStore } from 'react'
import { formatTime, toISODate } from '../lib/date'
import { countableItems } from '../lib/dishMatch'
import { mergeMeals } from '../lib/mergeMeals'
import { recognizeByNames } from '../lib/recognizeAgent'
import { dropDraftPhotos, getDraftPhotos } from './draftPhotos'
import { recognizeOne, type RecognitionOutcome } from './recognizeOne'
import { addMeal, getSnapshot } from './store'
import { clearUnlogged, type UnloggedMeal } from './unlogged'
import type { MealItem } from './types'

/**
 * 「算完还是一道能计量的菜都没有」时说的话 —— **两条路共用这一句**。
 *
 * ⚠️ 2026-09-24 改过一次。打字那份原来有自己的一句（「这几道菜没算出营养
 * （食物库里没有）」），理由是那句「联网也没查到」对它不成立 —— 当时打字这条
 * 路是在**本地**拿食物库的常见分量凑的，压根没联网。
 *
 * 现在不成立了：打字那份在记入日记这一刻**也交给食衡算**（`recognizeByNames`），
 * 库外菜走的是同一条「博查联网搜」的链。两条路的失败语义于是完全一样，
 * 各留一句只会让同一种归宿在屏幕上长成两个样子 —— 而它们本来就是一件事。
 */
const NO_NUTRITION =
  '这一餐没算出营养（食物库里没有，联网也没查到），就先不记了 —— 免得日记里多一条 0 kcal。'

/* ------------------------------------------------------------
   那一趟的状态
   ------------------------------------------------------------ */

/**
 * 四种归宿，各自对应屏幕上的一句话（或一行）：
 *
 *   · `computing`    —— 在飞。对话页那张卡说「正在算」，日记页那一行也这么写。
 *   · `logged`       —— 算完了、**已经落盘**。对话页把卡换成「已经记进日记了」，
 *                       日记页不再显示任何东西（那一行已经就地变成真记录）。
 *   · `failed`       —— 没算出来。**不落盘、草稿和照片都留着**（宁可不记，
 *                       不记一条 0 kcal），下次进对话页还会问。
 *   · `adjust-ready` —— 「调整分量再记」算好了，等用户在记录面板上改分量。
 *                       只有对话页认它（面板保存才落盘）。
 *
 * ⚠️ **只活在内存里，不落盘。** 刷新 / 关浏览器 = 这一趟就算了（用户
 * 2026-09-24 定的），草稿和照片还在，下次进对话页照样问。所以这里没有序列化，
 * 也没有「重算」通路 —— 别为它加一个存档位。
 */
export type LogRun =
  | { phase: 'computing'; kind: 'log' | 'adjust'; meal: UnloggedMeal }
  | { phase: 'logged'; meal: UnloggedMeal }
  | { phase: 'failed'; kind: 'log' | 'adjust'; meal: UnloggedMeal; message: string }
  | { phase: 'adjust-ready'; meal: UnloggedMeal; items: MealItem[] }

/** 日记页会显示的那两种（见 `pendingForDate`） */
export type PendingRun = Extract<LogRun, { phase: 'computing' | 'failed' }>

let run: LogRun | null = null
const listeners = new Set<() => void>()

/**
 * 写状态。**导出是给自检用的** —— 生产路径只有 `runCompute` 一处写它，
 * 屏幕侧一律只读（订阅）。`verify-render.mjs` 拿它直接摆出一个「正在算」的姿势，
 * 不必真的发一趟识别。
 */
export function setLogRun(next: LogRun | null): void {
  run = next
  for (const l of listeners) l()
}

export function getLogRun(): LogRun | null {
  return run
}

export function subscribeLogRun(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * 屏幕侧的唯一入口。
 *
 * 第三个参数（`getServerSnapshot`）和 `useAppState` 同一个理由：自检走的是
 * `renderToStaticMarkup`，那是服务端渲染那条路 —— 少一个参数会当场抛。
 */
export function useLogRun(): LogRun | null {
  return useSyncExternalStore(subscribeLogRun, getLogRun, getLogRun)
}

/* ------------------------------------------------------------
   取消 / 作废
   ------------------------------------------------------------ */

/**
 * 令牌。每次开始新的一趟 +1，在途的回调只有拿到**当前值**时才允许写状态或落盘。
 *
 * ⚠️ **必须是模块级变量，不能是 `useRef`** —— `plate.ts` 文件头那段理由原样适用：
 * StrictMode 的挂载序列是 mount → unmount → mount，ref 会跟着重建。
 */
let generation = 0

/**
 * 在途的闸门。**每张照片一个** —— 共用一个的话，第 1 张超时会 abort 掉信号，
 * 后面几张会被 `recognizeOne` 读成「用户自己取消」（`plate.ts` 踩过同一个坑）。
 */
let gates = new Set<AbortController>()

function abortGates(): void {
  for (const g of gates) g.abort()
  // 换一个新 Set 而不是 clear()，理由同 `plate.ts`：正在途的回调如果又建了一个闸门，
  // clear 会把新的那个一起算进「旧的」里
  gates = new Set()
}

/**
 * 把在飞的那一趟作废：掐断请求 + 令牌 +1 + 状态清空。**不写失败态**。
 *
 * 两个调用点，都不是「用户看到一句话」的场合：
 *
 *   · `dismissUnlogged`（用户点「不用了」）—— 他连这一餐都不要了，屏幕上那张
 *     补记弹窗当场收掉，没有什么可通知的。
 *   · `abortProfileWork()`（切/删档案）—— 见文件头那段：这里一个字都不能说，
 *     否则新档案的日记上会冒出一句他从没点过的「没算出来」。
 *
 * 自检也用它把 job 拨回干净状态（模块级单例会跨节泄漏到下一次渲染里）。
 */
export function cancelLogRun(): void {
  abortGates()
  generation++
  setLogRun(null)
}

/* ------------------------------------------------------------
   起一趟
   ------------------------------------------------------------ */

/**
 * 开始一趟。**从点击事件里调用** —— 理由见文件头那段 StrictMode 的说明。
 *
 * 幂等闸：已经在算的时候再点一次直接返回。挡的是双击「记入日记」——
 * 两趟都跑完就是**同一顿饭写进日记两次**，而屏幕上看起来像一次。
 */
export function startLogRun(meal: UnloggedMeal, kind: 'log' | 'adjust'): void {
  if (run?.phase === 'computing') return
  abortGates()
  void runCompute(meal, kind)
}

/* ------------------------------------------------------------
   主流程
   ------------------------------------------------------------ */

/**
 * 拿存下来的照片**重新算一遍营养** —— 记进日记之前唯一一次真的算。
 *
 * ## 为什么是现在，而不是发图那一刻
 *
 * 用户 2026-09-24 定的口径：「用户如果说加入档案日记里，那就那个时候再调用
 * 食衡agent，如果后续没有点击计入日记，那就不管」。所以发图那一刻不算
 * （对话里那张卡上一个数字都不印），算的是**现在** —— 这一趟是唯一还算得出来
 * 的地方，代价是用户要等十几到几十秒（那句提示因此必须在按之前就摆出来，
 * 见 `UnloggedMealSheet` 文件头）。
 *
 * ## 为什么是**食衡**（不传 `agent`）
 *
 * 不是随手选的：给库外菜查营养的那组节点（联网检索 + 搜索转文本 + 营养折算 +
 * 合并营养）**只在食衡工作流里**，膳享+ 没有 —— 走膳享+ 认出来的库外菜永远是 0，
 * 那正是当天那张卡上的事故（见 `MealResultCard` 文件头最后一段）。
 * 照片还是那一张，但这一趟要的是**数**，所以换一条链路问。
 *
 * ## 三种「算不出来」，一律不落盘
 *
 *   1. **IDB 里没有照片了**（清了浏览器数据 / 换了台机器 / 隐私模式）——
 *      没有输入，一趟都发不出去。
 *   2. **上游挂了、超时了，或者一张 `ok` 都没有** —— 全是演示餐盘时
 *      `mergeMeals` 会把那份**编的**餐盘原样交回来，把编出来的菜记进日记，
 *      比没记上糟得多。
 *   3. **算完还是一道能计量的菜都没有**（全库外、联网也没查到）——
 *      这正是「计算不出来就不算了」：宁可不记，不记一条 0 kcal。
 *      判据是 `countableItems`，和发图那条路上检查的是同一个（判据挪了位置，
 *      没换尺子，见 `store/unlogged.ts` 文件头第 2 段）。
 *
 * 几张**一起**发（2026-09-24 改，原来是逐张 `await`），每张自带 55 秒墙钟与
 * 取消语义，落回数组时顺序仍是 IDB 里那个顺序 —— `mergeMeals` 按传入顺序拼菜，
 * 用户看到的菜序和上次那张卡一致。
 *
 * **从不抛**：三种归宿全在返回值里。
 *
 * ## 打字来的那份（`meal.from === 'text'`）走的是**另一个分支**
 *
 * 那份草稿**一张照片都没有**（见 `store/unlogged.ts` 文件头），所以它：
 *
 *   · **不读 IDB** —— 直接拿草稿里的菜名去问食衡（`recognizeByNames`）。
 *     **营养仍然是食衡算的**：这条路上库外菜一样走它那条「抽取库外菜 →
 *     博查联网搜 → 营养折算」的链（那个分支的判据是「有没有库里没有的菜」，
 *     不是「有没有图」）。少了这一步，库里没有的菜就只剩本地那一份常见分量，
 *     那不是食衡算出来的数。
 *   · ⚠️ **不能靠「读出来是空的」来认它。** 照片是**单槽**的
 *     （`draftPhotos.ts` 的 `'current'`）—— 打字这份写下去时照片位上还留着
 *     上一批，读它会算出**上一餐的菜**，再用这份草稿的 `slot` / `at` 落盘。
 *     静默配错，是这里最坏的一种错。所以分叉必须在**读照片之前**。
 *   · 那道 `countableItems` 闸在打字这一支里**要自己再走一次** ——
 *     它在函数尾部，而那一行在照片分支的后面，走不到。
 */
const computeForLog = async (
  meal: UnloggedMeal
): Promise<{ ok: true; items: MealItem[] } | { ok: false; message: string }> => {
  if (meal.from === 'text') {
    /*
      档案和记录现取，理由同下面那段（过敏拦截的输入不能是过期的）。
      打字这一支只需要它俩，所以在这里取一次就够了。
    */
    const { profile, meals } = getSnapshot()
    const names = meal.items.map((i) => i.name)
    const out = await recognizeByNames({ names, slot: meal.slot, profile, meals })
    /*
      ⚠️ `null` 有两种成因（上游挂了 / 模型没给出可用的菜名），归宿是同一个：
      **不落盘**。和拍照那条路失败时的归宿一致。
    */
    if (!out || countableItems(out.items).length === 0) {
      return { ok: false, message: NO_NUTRITION }
    }
    return { ok: true, items: out.items }
  }

  const photos = await getDraftPhotos()
  if (photos.length === 0) {
    return { ok: false, message: '那张照片已经不在本机了，没法重新算一遍营养。再发一次图试试。' }
  }

  /*
    这一趟要用的档案和记录 —— **每次现取，不缓存**。用户可能刚记了一餐就过来点；
    而档案是过敏拦截的输入，拿一份过期的就是在为一个不存在的忌口做判断。
    （在组件里那会儿这两个值是渲染闭包里的 `state.profile` / `state.meals`。）
  */
  const { profile, meals } = getSnapshot()

  /*
    ⚠️ **几张一起发,不是一张接一张(2026-09-24 改)。**

    原来是 `for` + `await recognizeOne(...)`。这一趟和首页那条路一样,几张
    本来就是**同一餐的几个角度**,没有任何一张需要等另一张 —— 而用户此刻
    正盯着日记页那一行「正在算这一餐」等,串行就是让那一行多亮十几秒。
    同一段形状在 `store/plate.ts` 和 `screens/ChatScreen.tsx` 里各有一份,
    三处一起改了。

    ⚠️ **`outcomes` 的顺序必须 = `photos` 的顺序。** 用 `push` 的话顺序 =
    **完成顺序**,而 `mergeMeals` 是**按传入顺序**拼菜的 —— 用户看到的菜序
    会和上次那张卡上的不一致(那段注释说的「顺序就是 IDB 里那个顺序」,
    下面 `mergeMeals(outcomes)` 那句靠的正是这个)。`Promise.all` 收的就是
    map 的返回值,天然按下标。

    ⚠️ **每张一个 controller** —— `recognizeOne` 超时会 abort 掉传进来的那个,
    共用的话一张超时会把其余几张一起打成 aborted,而它把那判成「用户自己取消」,
    于是**一张都不出**(`plate.ts` 那段注释把这条写全了)。
  */
  const outcomes: RecognitionOutcome[] = await Promise.all(
    photos.map((blob, i) => {
      const gate = new AbortController()
      gates.add(gate)
      return recognizeOne({
        file: new File([blob], `meal-${i + 1}.jpg`, { type: blob.type || 'image/jpeg' }),
        // 不传 `agent` = 食衡。见上面「为什么是食衡」
        slot: meal.slot,
        profile,
        meals,
        controller: gate,
      }).finally(() => {
        gates.delete(gate)
      })
    })
  )

  const merged = mergeMeals(outcomes)
  if (!merged || !outcomes.some((o) => o.kind === 'ok')) {
    const fail = outcomes.find((o) => o.kind === 'failed')
    return { ok: false, message: fail ? fail.message : '这一趟没能算出来，稍等一下再试一次。' }
  }
  if (countableItems(merged.items).length === 0) {
    return { ok: false, message: NO_NUTRITION }
  }
  return { ok: true, items: merged.items }
}

/**
 * 起一趟、等它、按归宿分派。
 *
 * ⚠️ **`if (myGen !== generation) return` 这一句是落盘的门闩**：切档案 / 点
 * 「不用了」都把这一趟作废了，醒来时**一个字都不许写**（既不落盘也不报错）。
 * 它替掉的正是组件里那套 `logRunRef` + `aliveRef` —— 区别是那两个东西当年
 * 连「人走了」也算作废，而人走了**不是**作废的理由（见 `logUnlogged`）。
 */
const runCompute = async (meal: UnloggedMeal, kind: 'log' | 'adjust'): Promise<void> => {
  const myGen = ++generation
  setLogRun({ phase: 'computing', kind, meal })

  const res = await computeForLog(meal)
  if (myGen !== generation) return

  if (!res.ok) {
    setLogRun({ phase: 'failed', kind, meal, message: res.message })
    return
  }
  if (kind === 'log') logUnlogged(meal, res.items)
  else adjustUnlogged(meal, res.items)
}

/**
 * 算出来了 —— **落盘**。这就是用户按那颗按钮时要的那件事，屏幕只是它的回执。
 *
 * ## ⚠️ 下面三件无条件做，而且没有「还有没人看」这一层
 *
 * 这个函数在组件里那会儿，后面跟着一句 `if (!shown) return`（`shown` =
 * 「页面还在、号还对得上」），三件落盘刻意排在它前面。搬出组件之后那个参数
 * 没有了 —— **不是把它删了，是它不再存在**：这里根本没有页面可以问。
 *
 * 用户按「记入日记」要的就是这一条记录，而他按下之后最常见的下一步正是
 * **离开这一页去看日记**。那三次「怎么还是没记进日记」的成因就是这一刀
 * 砍在了落盘上。
 *
 * ## ⚠️ `date` / `time` 必须显式传，而且必须从 `meal.at` 推
 *
 * `addMeal` 的默认值是「此刻」（`input.date ?? todayISO()`、`input.time ??
 * formatTime(now)`），也就是**用户点这颗按钮的那一刻**。这份草稿会在
 * `localStorage` 里过夜 —— 昨天 12:30 拍的一餐，今天早上八点进来点一下，
 * 默认值会把它写成**今天 08:00**：
 *
 *   · 昨天那顿饭的数字记到了今天的头上（日记页、首页、趋势一起偏）
 *   · 弹窗上刚说过「昨天 12:30 识别到的这几道菜」，日记里却写着今天 08:00
 *
 * 所以这一条记录属于**拍照片那一刻**：日期和钟点都从 `at` 推。餐次
 * （`meal.slot`）本来就是那时定的，两者这才对得上。
 *
 * ⚠️ 同一个裂口在「调整分量再记」那条路上是**面板自己调 `addMeal`** 的
 * （见 `MealSheet` 的 `date` / `time`）—— 两条出口记的必须是同一个时刻。
 */
const logUnlogged = (meal: UnloggedMeal, items: MealItem[]): void => {
  const takenAt = new Date(meal.at)
  addMeal({
    slot: meal.slot,
    /*
      ⚠️ 落盘的是**刚算出来的那一份**（`items`），不是 `meal.items`。
      草稿里那份是菜名清单，一个数字都没有（见 `UnloggedMeal.items`）——
      拿它落盘就是一条 0 kcal 的记录，而它长得和一条真的记录一模一样。
    */
    items,
    /*
      来源按草稿是哪条路来的分（2026-09-24）。**不能一律写「拍餐盘」**：
      打字问出来的那几道菜既不是拍的、也不是他自己填的表，日记里写着「拍餐盘」
      是在陈述一件没发生过的事（`chatMeal.ts` 为同一件事写过一条注释：
      不是手动却写手动，那个词叫作撒谎）。
    */
    source: meal.from === 'text' ? '对话记录' : '拍餐盘',
    date: toISODate(takenAt),
    time: formatTime(takenAt),
    ...(meal.thumb ? { thumb: meal.thumb } : {}),
  })
  /*
    只清**这一份**所在的位（两个存档位，见 `store/unlogged.ts` 文件头）：
    记掉拍的那一餐不该顺手扔掉打字那份 —— 那份还没被问过。
  */
  clearUnlogged(meal.from)
  // 照片的使命到这儿就结束了 —— 不清的话它能一直躺在用户的浏览器里
  if (meal.from === 'photo') void dropDraftPhotos()
  setLogRun({ phase: 'logged', meal })
}

/**
 * 「调整分量再记」算完了 —— 交面板，**不落盘**。
 *
 * 顺序不能反：面板保存时是它自己调 `addMeal` 的，预填一份没营养的菜进去，
 * 用户改完分量一保存，写进日记的仍然是一条 0 kcal。
 *
 * 落盘在面板那边，所以这一条对日记页不显示占位行（见 `pendingForDate`）——
 * 它不会变成一条记录，说「这一餐正在算」就是一句假话。
 */
const adjustUnlogged = (meal: UnloggedMeal, items: MealItem[]): void => {
  setLogRun({ phase: 'adjust-ready', meal, items })
}

/* ------------------------------------------------------------
   给屏幕的两把尺子（纯函数，两个页面共用）
   ------------------------------------------------------------ */

/**
 * 日记页那一行该不该出现 —— **只有这一天的那一餐**。
 *
 * ⚠️ **日期从 `meal.at` 推**，和 `logUnlogged` 落盘时用的是同一把尺子：23:59
 * 拍的那一餐显示在昨天，落盘也落在昨天。用别的时刻（比如「此刻」）会让那一行
 * 出现在今天，而十几秒后真记录落在昨天 —— 看起来像这一条飞了。
 *
 * 三种「不显示」：
 *
 *   · `logged`       —— 真记录已经在列表里了，占位行就是重复的
 *   · `adjust-ready` —— 在等用户改分量，还没落盘（要等他保存）
 *   · `computing` 且是**「调整分量再记」**那一趟 —— 同上，它不会变成一条记录。
 *     （`failed` 两种都显示：不管哪条出口，这一餐都**确实**还没记进去。）
 */
export function pendingForDate(run: LogRun | null, date: string): PendingRun | null {
  if (!run) return null
  if (run.phase === 'logged' || run.phase === 'adjust-ready') return null
  if (run.phase === 'computing' && run.kind !== 'log') return null
  return toISODate(new Date(run.meal.at)) === date ? run : null
}

/** 对话页那张提示卡的四件事，全由这一趟推出来（见 `LogNotice`） */
export interface LogNoticeView {
  kind: 'log' | 'adjust'
  done: boolean
  error: string | null
}

/**
 * 对话页那张卡现在该说什么（`null` = 不该显示）。
 *
 * `closed` 是「用户自己把这张卡关掉了」（对话页自己的 state —— 它只是关掉这一页
 * 的通知，不该写进这个模块：日记页那一行不受影响）。
 *
 * ⚠️ **只有 `failed` 不看 `closed`** —— 这是刻意的，而且是用户那边一条明确的要求
 * 的另一面：他在等的那十几秒里完全可能把卡关了（关掉是允许的，他不该为此付出
 * 代价），不重弹这一趟失败就**一句话都没说**，而屏幕上看起来和「已经记进去了」
 * 一模一样。`computing` 和 `logged` 都听 `closed`：关掉就是「这句我知道了」，
 * 算成了也不许再弹回来报一次成功（`LogNotice` 文件头第 2 段）。
 *
 * 关掉这张卡时，**对话页会顺手把这一趟收掉**（`failed`/`logged` 都是终态），
 * 所以「失败永远说」不会变成一张关不掉的卡。
 */
export function noticeFor(run: LogRun | null, closed: boolean): LogNoticeView | null {
  if (!run) return null
  switch (run.phase) {
    case 'adjust-ready':
      return null
    case 'failed':
      return { kind: run.kind, done: false, error: run.message }
    case 'logged':
      return closed ? null : { kind: 'log', done: true, error: null }
    case 'computing':
      return closed ? null : { kind: run.kind, done: false, error: null }
  }
}
