import { useEffect, useState, useSyncExternalStore } from 'react'
import { errorLine, foldResults, pickCtor, startWatchdog } from './speech'

/**
 * 语音输入的 React 包装 —— **薄到几乎没有逻辑**,该测的都在 `speech.ts` 里。
 *
 * 这个文件里只有三件事:把浏览器对象查出来、把实例挂到模块级单例上、
 * 把状态通过 `useSyncExternalStore` 交给 React。真正的判断(pickCtor /
 * foldResults / errorLine / slotFor / startWatchdog)全在纯函数那边,
 * 因为它们**能在自检里跑**,而这里跑不了 —— `renderToStaticMarkup` 不执行
 * effect,一切依赖 `listening` 的界面在 harness 里都够不到。
 *
 * ⚠️ 三条不能改的规矩
 * ------------------------------------------------------------
 * 1. **模块作用域里一个 `window` 都不读。** 见 `speech.ts` 文件头:那会让
 *    `scripts/verify-render.mjs` 在导入期就死掉,后面每一节都不再运行。
 *    唯一的读取点在 `supported` 的 `useState` 初始化器里 ——
 *    和 `useMediaQuery.ts:11` 同一个理由、同一个位置。
 * 2. **实例放模块级单例,不放 `useRef`** —— ref 熬不过重挂载。这正是
 *    `plate.ts` 文件头「为什么请求必须从手势里发起,不能放进 useEffect」
 *    那一节已经写下的规矩:「`startPlateJob()` 由点击事件调用。
 *    React 的 StrictMode 只双调用 effect,从不双调用事件处理器」。
 *    (引节名而不是行号 —— 那个文件头一直在长,行号引用一次就烂一次。)
 * 3. **`start()` 只从点击处理器调用,绝不从 effect 调用。** `main.tsx:10`
 *    有 `<StrictMode>`,React 19 dev 的双调用会在同一条 fiber、同一份 hook
 *    state、同一个 ref 上跑 mount → cleanup → mount。cleanup 里的 `abort()`
 *    之后 `onend` 是**异步**的,第二次 `start()` 会赶在它前面落地,浏览器
 *    仍认为在运行 → Chrome 抛 `InvalidStateError: recognition has already started`。
 */

/** 一个事件都不发时,多久之后认定它挂住了 —— 见 `startWatchdog` 的注释 */
const WATCHDOG_MS = 8000

interface SpeechSnapshot {
  listening: boolean
  /** 出错时的整句话(已经由 `errorLine` 译好)。`null` = 没话说 */
  error: string | null
}

/* ---------- 一个极小的外部 store —— 和 `store/store.ts` 同一个形状 ---------- */

let snapshot: SpeechSnapshot = { listening: false, error: null }
const listeners = new Set<() => void>()

function emit(next: SpeechSnapshot): void {
  // 内容没变就不通知:onend 和 onerror 常常紧挨着到,两次通知就是两次多余渲染
  if (next.listening === snapshot.listening && next.error === snapshot.error) return
  snapshot = next
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

const getSnapshot = (): SpeechSnapshot => snapshot

/* ---------- 模块级单例 ---------- */

let rec: SpeechRecognition | null = null
/** 我们**认为**它正在跑 —— 只有为 true 才去 abort(空闲实例上 abort,Safari 会抛) */
let started = false
/** 这次中止是不是我们自己发起的 —— 见 `errorLine` 的 `intentional` 参数 */
let intentional = false
let cancelWatchdog: (() => void) | null = null
/** 开始口述那一刻输入框里的原文。转写只负责它**后面**的部分 */
let prefix = ''

/** 读输入框当前值 —— 由挂载中的组件注册 */
let readText: (() => string) | null = null
/** 转写结果的落点 —— 由挂载中的组件注册 */
let writeText: ((text: string) => void) | null = null

/** 收摊。幂等,不 emit —— 由调用方决定说什么话 */
function hardStop(): void {
  if (cancelWatchdog) {
    cancelWatchdog()
    cancelWatchdog = null
  }

  const r = rec
  if (!r) return

  if (started) {
    started = false
    try {
      r.abort()
    } catch {
      // Safari 的 webkitSpeechRecognition 对**空闲**实例 abort 会抛 InvalidStateError。
      // 这个 catch 是必需的,不是防御性编程 —— 我们能想到的所有路径都留着它
    }
  }

  /*
    卸掉处理器,顺序在 abort 之后。
    `abort()` 触发的 `end` / `audioend` 是**异步**到的 —— 留着处理器的话,
    一次已经结束的会话会在几十毫秒后再报一次「结束了」(或者更糟:
    在下一轮已经 start 之后报上一轮的 aborted)。
    同步卸掉,那些事件到的时候已经没有接收方了。
  */
  r.onstart = r.onresult = r.onerror = r.onend = r.onaudiostart = null
}

/**
 * 开始口述。
 *
 * 由**点击处理器**调用(见文件头第 3 条),所以这里可以放心地假设
 * 「上一次调用已经结束了」—— 但仍要 `hardStop()` 兜一次:用户按了停止之后
 * 立刻再按麦克风,上一轮的 `onend` 完全可能还没到。
 */
export function startSpeech(): void {
  if (started) return

  const Ctor = pickCtor(typeof window === 'undefined' ? undefined : window)
  /*
    不支持就**什么都不做**,静静地退回去。
    调用方(ChatScreen)在 `supported === false` 时走的是说明面板那条路,
    根本不会调到这里 —— 这一行是给「类型上说有、实际没有」的那类浏览器兜底,
    它不该在这里弹任何东西:这个函数不知道界面长什么样。
  */
  if (!Ctor) return

  hardStop()
  intentional = false
  prefix = readText?.() ?? ''

  if (!rec) {
    const fresh = new Ctor()
    // `lang` **必须显式设**:不设就按浏览器界面语言走,中文菜名会被当英文转写
    fresh.lang = 'zh-CN'
    // 说完一句就结束。我们要的是一个短问题,不是一段听写 ——
    // 也正因为它是 false,第一次停顿后会自动 onend,不需要用户按停止
    fresh.continuous = false
    // 中间结果也要。否则用户对着一个不动的输入框说话,不知道有没有在听
    fresh.interimResults = true
    fresh.maxAlternatives = 1
    rec = fresh
  }
  const r = rec

  r.onstart = () => emit({ listening: true, error: null })

  r.onresult = (e) => {
    // 有东西回来了,说明它没挂住 —— 看门狗只管「一个事件都不发」那一种情况
    if (cancelWatchdog) {
      cancelWatchdog()
      cancelWatchdog = null
    }
    // 每一次都是「前缀 + 整段结果」重新算一遍,不是往后追加。
    // 追加的写法会让输入框变成「今天今天盐今天盐吃…」—— 见 foldResults 的注释
    writeText?.(foldResults(prefix, e.results))
  }

  r.onerror = (e) => {
    // 先收摊再 emit:硬失败之后不该还有别的事件进来
    const line = errorLine(e.error, intentional)
    hardStop()
    emit({ listening: false, error: line })
  }

  r.onend = () => {
    hardStop()
    /*
      正常说完一句 —— 安静地回到麦克风状态,不弹任何东西。
      错误理由**留在原地**:onerror 已经把 onend 卸掉了,能走到这里说明
      这一次没有出错,`snapshot.error` 只可能是上一次会话留下的、用户还没
      读到的(下一次 onstart 会清掉它)。
    */
    emit({ listening: false, error: snapshot.error })
  }

  cancelWatchdog = startWatchdog({
    ms: WATCHDOG_MS,
    onTimeout: () => {
      // 挂住的现场连 onend 都不会来,所以这里既收摊又得说明原因
      intentional = true
      hardStop()
      emit({
        listening: false,
        error: '没能启动语音识别。这台设备上偶尔会这样 —— 再点一次试试，或者直接用键盘输入。',
      })
    },
  })

  try {
    started = true
    r.start()
    /*
      乐观地先亮起来。真实的 `onstart` 是异步的,等它的话从点击到按钮变色
      之间有一段「按了没反应」的空窗 —— 而麦克风恰恰是最需要立刻给反馈的
      那个按钮(用户已经在说话了)。
    */
    emit({ listening: true, error: null })
  } catch {
    // Chrome 在某些状态下抛 `InvalidStateError: recognition has already started`
    started = false
    hardStop()
    emit({ listening: false, error: '语音识别没能启动。再点一次试试。' })
  }
}

/**
 * 用户按了「停止」。
 *
 * 这里**不需要「提交最后一段中间结果」这一步** —— 每次 `onresult` 都已经
 * 把当时算出来的全文写进输入框了(中间结果也写),所以 abort 之后输入框里
 * 就是用户说到哪算哪的那句话。反过来若只在 `isFinal` 时才写,abort 就会把
 * 用户刚说的半句话**丢掉**,那才是 bug。
 */
export function stopSpeech(): void {
  if (!started) {
    emit({ listening: false, error: null })
    return
  }
  // 标记「是我们叫的停」:aborted 时 errorLine 返回 null,不弹横幅。
  // 不标记的话每一次正常停止都会弹一条「语音输入被中断了」
  intentional = true
  hardStop()
  emit({ listening: false, error: null })
}

export interface UseSpeech {
  /** 这台浏览器有没有语音识别。Node 里恒为 false —— 而它**照常渲染按钮** */
  supported: boolean
  listening: boolean
  /** 要显示给用户的那句话,`null` = 没什么要说的 */
  error: string | null
  start: () => void
  stop: () => void
  clearError: () => void
}

/**
 * @param getText 读输入框**当前**值 —— 开始口述那一刻当前缀存下来
 * @param setText 写回转写结果 —— 每次拿到的都是完整的一句话,不是增量
 */
export function useSpeech(opts: { getText: () => string; setText: (text: string) => void }): UseSpeech {
  const { listening, error } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  /**
   * 在 `useState` 初始化器里探测 —— **不在模块作用域**。
   * 见文件头第 1 条。Node 里 `typeof window === 'undefined'` 成立,
   * 于是 `supported === false`,而这正是「浏览器不支持」那条分支。
   */
  const [supported] = useState(() => pickCtor(typeof window === 'undefined' ? undefined : window) !== undefined)

  /*
    每次渲染后刷新这两个回调 —— 它们闭包着 ChatScreen **当次**的 input。
    写成 ref 也是一样的道理,只是这个模块本身已经是单例了,没必要再包一层。
  */
  useEffect(() => {
    readText = opts.getText
    writeText = opts.setText
  })

  useEffect(
    () => () => {
      readText = null
      writeText = null
      /*
        离开对话页时正在听 —— 收摊。
        **只在「我们自己发起过」时才 abort**:从没 start 过的实例去 abort,
        Safari 会抛。StrictMode 的双调用走不到这里,因为 start 只从点击来。
      */
      if (!started) return
      intentional = true
      hardStop()
      emit({ listening: false, error: null })
    },
    []
  )

  return {
    supported,
    listening,
    error,
    start: startSpeech,
    stop: stopSpeech,
    clearError: () => emit({ listening: false, error: null }),
  }
}
