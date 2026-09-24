/**
 * Web Speech API 的**缺失部分** —— 只补 `lib.dom.d.ts` 里没有的那几个。
 *
 * ⚠️ 为什么只补一部分,而不是把整份 MDN 上的定义抄进来
 * ------------------------------------------------------------
 * TS 7.0.2 自带的 `lib.dom.d.ts` 里**已经有**这些(不用我声明):
 *
 *   `SpeechRecognitionAlternative`  35500 · `SpeechRecognitionErrorEvent`  35526
 *   `SpeechRecognitionEvent`        35552 · `SpeechRecognitionResult`      35579
 *   `SpeechRecognitionResultList`   35614 · `SpeechRecognitionErrorCode`   44456
 *
 * 缺的只有三样:`interface SpeechRecognition`、`SpeechRecognitionConstructor`、
 * `Window` 上那两个字段。**重复声明一份已有的接口不是「更保险」,而是更危险**
 * —— 接口声明会**合并**,成员类型对不上就是编译错误,而 `tsconfig.json:15` 的
 * `skipLibCheck: true` 会把这个撞车**静默掉**。静默失效正是这个仓库最讨厌的
 * 失败模式,所以这里只写缺的那三样,多一行都不写。
 *
 * 两个刻意的写法
 * ------------------------------------------------------------
 * 1. **用 `on*` 属性,不声明 `addEventListener` 的重载。**
 *    本文件里的 `SpeechRecognition extends EventTarget` 只继承到 `EventTarget`
 *    的字符串重载,`addEventListener('result', e => ...)` 会把 `e` 定型成
 *    `Event`(不是 `SpeechRecognitionEvent`),逼出一处 cast。而我们要的四个
 *    回调(onstart / onresult / onerror / onend)全都有 `on*` 属性,直接用它就
 *    是精确类型 —— 不需要那份 `SpeechRecognitionEventMap`。
 * 2. **`Window` 上那两个字段是可选的(`?`)。** 这是让「这个浏览器没有语音
 *    识别」变成**类型系统逼着你处理**的一件事:`win.webkitSpeechRecognition.start()`
 *    编译不过,得先判空。写成必选就等于宣布「所有浏览器都有」,然后运行期
 *    在某台机器上炸掉 —— Firefox 默认没有、Opera 从来没有。
 */

interface SpeechRecognition extends EventTarget {
  /** BCP 47。**必须显式设**:不设就按浏览器界面语言走,中文菜名会被当英文转写 */
  lang: string
  /** `false` = 说完一句就结束。我们要的是一个短问题,不是一段听写 */
  continuous: boolean
  /** `true` = 中间结果也发 `result` 事件。否则用户对着一个静止的输入框说话 */
  interimResults: boolean
  maxAlternatives: number

  start(): void
  stop(): void
  abort(): void

  onstart: ((this: SpeechRecognition, ev: Event) => void) | null
  onend: ((this: SpeechRecognition, ev: Event) => void) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
  onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
  onaudiostart: ((this: SpeechRecognition, ev: Event) => void) | null
  onaudioend: ((this: SpeechRecognition, ev: Event) => void) | null
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition
  prototype: SpeechRecognition
}

interface Window {
  /** Chrome / Edge / Safari(带前缀)。Firefox 默认没有 */
  SpeechRecognition?: SpeechRecognitionConstructor
  /** Safari 与旧版 Chrome 用的前缀名 —— 两个都要查 */
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}
