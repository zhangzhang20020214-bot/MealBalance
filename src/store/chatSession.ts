/**
 * 对话页「发出去的那一批照片」的会话状态
 * ===========================================================
 * 三件事,都只有对话页要,而且都**必须活得比组件久**:
 *
 *   1. **令牌** —— 离开对话页(或者又发了一批)之后,在途的那一批识别醒来时
 *      不该再往屏幕上写东西。它会拿着一个已经作废的 token 无声地结束。
 *   2. **闸门** —— 离开对话页要真的掐断在途请求,不白烧视觉额度。
 *   3. **本次会话建过的 object URL 登记表** —— 用户发出去的每张图都占着一个
 *      几 MB 的 blob。那些 URL 在 `composer.takeAll` 里**故意没有撤销**
 *      (消息气泡里那张图就靠它活着),所以得有人记住它们,在卸载时一次性撤销。
 *
 * ## 为什么不放 `useRef`
 *
 * 和 `plate.ts:34-38` 是同一条:StrictMode 的挂载序列是 mount → unmount → mount,
 * `useRef` 会跟着重建 —— 拿它当「最新那一批」的凭据,第二次挂载看到的是一个
 * 空 ref,挡不住任何东西。模块级计数器活得比组件久,才真的能分辨
 * 「这是不是最新那一批」。
 *
 * ## 为什么每张图一个 controller,而不是一批一个
 *
 * `recognizeOne` 超时时会 **abort 掉传进来的那个 controller**(见它的
 * `TIMEOUT_MS` 那段:它只有这一个掐断手段)。三张共用一个的话,第 1 张超时
 * 就把闸门**永久关上**了 —— 第 2、3 张醒过来看到的是一个已经 aborted 的
 * signal,`recognizeOne` 把那判成「用户自己取消」,于是**一张都不出、也不报错**。
 * 用户看到的是「第 2、3 张不见了」加一张只有第 1 张的卡,而真正发生的事情是
 * 那两张照片**根本没被送出去过**。
 *
 * 所以每张一个新 controller,由这里统一收着,`endRun()` 一次全掐。
 * 这个坑不写下来,下一个人合并成一个是迟早的事 —— 合并之后代码看起来更干净。
 */

/** 一次「发一批照片」的运行凭据 */
export interface ChatRun {
  /** 单调递增。拿它当 `isCurrent` 的凭据 */
  token: number
  /**
   * 给**下一张**用的闸门。**每张都要拿一个新的** —— 理由见文件头。
   *
   * 做成函数而不是暴露一个 controller:调用方没有办法「忘了新建」。
   */
  newGate: () => AbortController
}

/**
 * 令牌。每开始一批 +1,在途的回调只有拿到**当前值**时才允许写状态。
 * 作废之后依然会有回调从 await 里醒过来 —— 挡在写状态之前,它们就无声地结束。
 */
let generation = 0

/** 当前这一批在途的闸门。每张一个,理由见文件头 */
let gates = new Set<AbortController>()

/**
 * 本次会话建过的 object URL。
 *
 * ⚠️ 这份登记表只在**离开页面**时清(`releaseUrls`),**不跟着 `endRun` 走**:
 * 连发两批时,第一批的照片还挂在对话气泡里,那时候撤销就是把屏幕上那几张图
 * 变成裂图。它们的寿命就是这次会话的寿命。
 */
const urls = new Set<string>()

function abortGates(): void {
  for (const g of gates) g.abort()
  // 换一个新 Set 而不是 clear():一个已经在途的回调如果又建了一个闸门
  // (重试),clear 会把新的那个一起算进「旧的」里
  gates = new Set()
}

/** 开始新的一批。上一批还挂着的先掐掉 —— 同一时刻只该有一批在跑 */
export function beginRun(): ChatRun {
  abortGates()
  const token = ++generation
  return {
    token,
    newGate: () => {
      const ctrl = new AbortController()
      gates.add(ctrl)
      return ctrl
    },
  }
}

/** 「这一批还算数吗」。在途回调写状态之前问一次 */
export function isCurrentRun(token: number): boolean {
  return token === generation
}

/**
 * 作废当前这一批:在途请求全掐、令牌作废。
 *
 * 离开对话页时调(见 `ChatScreen` 的卸载清理),也由 `beginRun` 内部调。
 * **不动那份 URL 登记表** —— 理由见 `urls`。
 */
export function endRun(): void {
  generation++ // 在途回调全部作废
  abortGates()
}

/** 记下一个「发出去之后还要活着」的 object URL */
export function registerUrl(url: string): void {
  urls.add(url)
}

/**
 * 撤销本次会话建过的全部 object URL。**离开对话页时调一次**。
 *
 * 没有它,每发一批照片就漏掉几个几 MB 的 blob,直到刷新页面为止 ——
 * 而这种漏**不会报错、也不会慢到能被注意到**,是这套代码里唯一查不出来的
 * 那类问题(见 `composer.ts` 文件头)。
 */
export function releaseUrls(): void {
  for (const u of urls) URL.revokeObjectURL(u)
  urls.clear()
}
