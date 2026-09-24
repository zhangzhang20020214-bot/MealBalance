/**
 * 语音输入的**纯逻辑** —— 没有 React、没有 `window`。
 *
 * ⚠️ 「没有 `window`」不是风格偏好,是**能不能自检的前提**。
 *
 * `scripts/verify-render.mjs:53` 的 `await server.ssrLoadModule(file)` 写在
 * `try` **之外**,而 Node 里没有 `window`。任何模块顶层的 `window.SpeechRecognition`
 * 都会在**导入期**抛 `ReferenceError`,脚本当场死在未捕获的顶层 await 上,
 * **后面每一节都不再运行**(整个结果页、确认分量、日记缩略图、幽灵条目、
 * AgentReplyCard 全都不再被检查)。所以浏览器对象的查找全部走
 * `pickCtor(win)` 这种**把 `window` 当参数传进来**的写法,React 包装层
 * (`useSpeech.ts`)负责在 `useState` 初始化器里把它递进来。
 *
 * 每个函数都做成可注入的,理由同 `agentContext.ts:127-128` 的 `now?: Date`
 * ——「显式传入而不是内部取,便于自检里固定时间/固定结果做断言」。
 */

/** 麦克风/发送/停止三个状态共用输入栏那一个槽位 —— 见 ChatScreen */
export type Slot = 'stop' | 'send' | 'mic'

/**
 * 找出这台浏览器上的构造函数。
 *
 * 两个名字都查:`SpeechRecognition` 是标准名(Chrome / Edge),`webkitSpeechRecognition`
 * 是 Safari 和旧版 Chrome 的前缀名。**顺序不能反** —— 将来的 Chrome 可能两个都有,
 * 标准名更该赢。
 *
 * 参数是 `unknown` 而不是 `Window`:`verify` 那只手要能塞 `{}`、塞 `undefined`、
 * 塞一个桩进去,不需要为此造一个真的 Window。
 */
export function pickCtor(win: unknown): SpeechRecognitionConstructor | undefined {
  if (!win || typeof win !== 'object') return undefined
  const w = win as Window
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? undefined
}

/**
 * 把一次会话的**整段**识别结果折成一句话,前面接上开始口述时输入框里的原文。
 *
 * ⚠️ 这里是「替换」不是「追加」,整个语音功能最容易写错的一处。
 *
 * 每个 `result` 事件带的 `results` 是**这一次会话迄今为止的全部结果**
 * (已定的 + 正在改的当前那条),不是「刚识别出来的那一段」。所以
 * `setInput(prev => prev + transcript)` 的写法会让用户看着输入框里的字
 * 一路叠上去:
 *
 *     今 → 今天 → 今天今天盐 → 今天今天盐今天盐吃 …
 *
 * 正确做法是在 `start()` 时把已提交的前缀**存下来**,每次都拿
 * `前缀 + 整段结果` 重新算一遍。
 *
 * `interimResults = true` 时 `results` 里混着 `isFinal: false` 的中间结果,
 * 它们照样要拼进去 —— 用户就是要看着自己说的话一点点变成字。第一次停顿后
 * `continuous = false` 会触发 `onend`,那时最后一条中间结果就是最终结果。
 */
export function foldResults(prefix: string, results: SpeechRecognitionResultList): string {
  let out = prefix
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (!result) continue
    // maxAlternatives = 1,所以只有第 0 个候选有意义。中文不补空格 ——
    // 补了会变成「今天 盐 吃 多了 吗」,发给模型前还得再去掉
    out += result[0]?.transcript ?? ''
  }
  return out
}

/**
 * 某个错误码该不该出话、出哪句。
 *
 * 表是 `Partial<Record<...>>` 而不是 `Record`,因为 `SpeechRecognitionErrorCode`
 * 有 **8** 个成员(不是 5 个):
 *
 *     aborted | audio-capture | language-not-supported | network | no-speech |
 *     not-allowed | phrases-not-supported | service-not-allowed
 *
 * 后两个(`phrases-not-supported` / `service-not-allowed`)没人写得出对用户
 * 有意义的中文,它们走兜底那句话。**写一个「已知但没用」的假文案,比走兜底更糟**
 * —— 用户会照着一句没有任何信息量的话去排查。
 *
 * @param intentional 这次中止是不是**我们自己**发起的(用户按了停止、组件卸载、
 *   StrictMode 的 cleanup)。`plate.ts:257-259` 已经把这条规矩写下来了:用户按
 *   「停止分析」和超时都会让 signal 变成 aborted,但两者该有不同的表现 ——
 *   一个是用户自己取消(安静地退出),一个要说明原因。`aborted` 三个来源里
 *   有两个是我们自己,不区分的话**每一次正常停止都会弹一条错误横幅**。
 */
export function errorLine(code: SpeechRecognitionErrorCode | string, intentional: boolean): string | null {
  if (code === 'aborted') {
    return intentional ? null : '语音输入被中断了，再试一次吧。'
  }

  const LINES: Partial<Record<SpeechRecognitionErrorCode, string>> = {
    'not-allowed':
      '麦克风权限被拒绝了。到浏览器的网站设置里允许麦克风，再回来试 —— 页面里没法第二次申请。',
    'service-not-allowed': '系统不允许这个页面使用语音识别。',
    'audio-capture': '没找到可用的麦克风。检查一下设备有没有接上，或者是不是被别的程序占着。',
    'no-speech': '没听清。凑近一点、慢一点再说一次。',
    network: '语音识别服务连不上。它需要联网 —— 离线或者网络被挡时就用键盘输入吧。',
    'language-not-supported': '这台设备上的语音识别不支持中文，只能用键盘输入了。',
  }

  return LINES[code as SpeechRecognitionErrorCode] ?? '语音识别出错了，用键盘输入吧。'
}

/**
 * 输入栏那一个槽位现在该显示什么。
 *
 * 为什么三个状态共用一个槽位:输入栏固定 `h-[60px] px-5 gap-2`,每个控件
 * `h-11 w-11`。402pt 的屏去掉内边距剩 362pt,已经有 4 个子元素(相机 / 相册 /
 * 输入框 / 发送)。再塞第 5 个只剩 ~114pt 给输入框 —— 那个宽度写不下一句
 * 「今天盐吃多了吗」,等于把输入框废掉。
 *
 * ⚠️ **判据顺序不能反**:先判 `listening`。`interimResults` 会把中间结果写进
 * `input`,先判 `text.trim()` 的话识别到一半按钮就从「停止」跳成「发送」,
 * 用户根本按不到停止。
 *
 * @param busy 正在流式接收回复。**它不参与分支,这是故意的**——而且这条
 *   「不参与」正是要断言的东西。
 *
 *   现在的写法是 `disabled={busy || !input.trim()}`,直接复用会把
 *   「回复期间不能开始口述」这个限制白送进来:用户问完一个问题,食衡正在
 *   一个字一个字往外吐,这段时间他完全应该能开始说下一个问题 ——
 *   那是麦克风,不是正在被占用的网络连接。
 *
 *   把它留在签名里而不让它参与分支,是让这个决定**看得见、可断言**:
 *   `slotFor({ listening: false, text: '', busy: true }) === 'mic'`。
 *   拿掉这个字段的话,这条断言就无从写起,只能靠读一遍实现来相信它。
 *
 * @param attachments 攒着还没发出去的附件**张数**。
 *
 *   传张数而不是 `hasAttachments: boolean`,和上面 `text` 传原文、由函数自己
 *   `trim()` 是同一个口径:**判断留在这一处,调用方只负责如实报数**。
 *
 *   对话页攒了三张照片、输入框一个字没打,右槽也必须是「发送」——
 *   否则用户攒完图之后找不到那个键(它显示的是麦克风)。
 *
 *   ⚠️ 它**排在 `listening` 后面**,这条和上面那段是同一个理由的延伸:
 *   口述中 `interimResults` 正在往输入框里写字,这时候跳成「发送」,
 *   用户按不到停止。附件只会让这个坑更容易踩到 —— 攒了三张图再点麦克风,
 *   `text` 可能一直是空的,只有 `attachments` 在挡着。
 *
 *   `busy` 仍然不参与分支,而且现在理由更强了:识别三张要一两分钟,
 *   那段时间用户**必须**能继续攒附件、也**必须**能打字。
 */
export function slotFor(s: {
  listening: boolean
  text: string
  busy: boolean
  attachments: number
}): Slot {
  if (s.listening) return 'stop'
  if (s.text.trim() || s.attachments > 0) return 'send'
  return 'mic'
}

/**
 * 启动看门狗 —— 超时了还在「正在听」就主动收摊。
 *
 * ⚠️ 这条不能省。WebKit bug 317741 / 321436:**播过音频之后** `start()` 会挂住,
 * 而且**一个事件都不发** —— 没有 `onresult`、没有 `onerror`、没有 `onend`。
 * 界面永远停在「正在听」,用户只能刷新页面。一个永远转圈的状态比一句明确的
 * 失败更糟:他不知道该等还是该退。
 *
 * `setTimer` / `clearTimer` 可注入,是为了能在自检里用**假时钟**驱动它。
 * 不这么做的话,这个函数就是一句「一个从没被观察到触发过的说法」——
 * 那和删掉 `confidence`(`recognize.ts:29-37`)、和 README:1118 那句
 * 「估算 150g」是同一把尺子量出来的东西。
 *
 * 返回取消函数,幂等;取消之后即使定时器仍然回调也**不会再触发** `onTimeout`
 * (浏览器里 `clearTimeout` 是可靠的,但假时钟和我们自己的清理路径都需要这层保证)。
 */
export function startWatchdog(opts: {
  ms: number
  onTimeout: () => void
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}): () => void {
  const setTimer = opts.setTimer ?? setTimeout
  const clearTimer = opts.clearTimer ?? clearTimeout

  /** 已经了结过(超时触发过,或被取消过) */
  let done = false

  const id = setTimer(() => {
    if (done) return
    // 先置位再回调:`onTimeout` 里若同步调用了取消函数,不该有任何影响
    done = true
    opts.onTimeout()
  }, opts.ms)

  return () => {
    done = true
    clearTimer(id)
  }
}
