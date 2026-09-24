/**
 * 语音输入自检(开发用,不进产物)
 * ===========================================================
 * 跑法:npm run verify:speech
 *
 * ⚠️ 这个脚本测的是 `src/lib/speech.ts` 那**五个纯函数**,不是浏览器里的
 * 语音识别本身。这条边界必须写在最前面,因为它决定了这个脚本**不能**证明什么:
 *
 *   真的说话能不能转写、权限被拒之后什么样、播过音频之后还能不能启动 ——
 *   这些在 Node 里一条都验不了,只能人工在三端走一遍(见 README 已知限制)。
 *   一个跑得通的自检最危险的地方,就是让人以为功能被验证过了。
 *
 * 那为什么还值得写这一套:`speech.ts` 里放的是**这一整个功能里唯一会静默
 * 出错的部分** —— 叠加而不是替换的转写文本、把「用户按了停止」当成故障报错、
 * 回复期间把麦克风禁掉。这些错了都不会崩,只会让人用着别扭。它们全是纯函数,
 * 所以能在这里钉死。
 *
 * 最后两条是**结构性**的:它盯的是「这个功能有没有把整个自检搞死」。
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failures++
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const speech = await server.ssrLoadModule('/src/lib/speech.ts')

/* ------------------------------------------------------------
   1. slotFor —— 输入栏那一个槽位的三选一
   ------------------------------------------------------------ */
console.log('\n=== 1. 输入栏的槽位 ===')

// 第四个参数是附件张数,默认 0 —— 下面「攒了图」那一组单独传
const S = (listening, text, busy, attachments = 0) =>
  speech.slotFor({ listening, text, busy, attachments })

check('没在听、没打字 → 麦克风', S(false, '', false) === 'mic')
check('没在听、有字 → 发送', S(false, '今天盐吃多了吗', false) === 'send')
check('正在听 → 停止', S(true, '', false) === 'stop')

/*
  判据顺序的两条。这是这一节最要紧的断言:
  `interimResults` 会把中间结果写进输入框,所以**听着的过程中输入框一定是有字的**。
  先判 `text.trim()` 的话,识别到一半按钮就从「停止」跳成「发送」——
  用户根本按不到停止。
*/
check('**正在听 + 有字 → 仍然是停止**(不能跳成发送)', S(true, '今天', false) === 'stop')
check('正在听 + 空输入框 → 停止', S(true, '', false) === 'stop')

check('只有空白字符不算有字', S(false, '   ', false) === 'mic')

/*
  `busy` 刻意不参与分支 —— 见 slotFor 的注释。
  食衡正一个字一个字往外吐的时候,用户完全应该能开始说下一个问题:
  那是麦克风,不是正在被占用的网络连接。
*/
check('**回复中、输入框为空 → 麦克风**(不能因为忙就把麦克风禁掉)', S(false, '', true) === 'mic')
check('回复中、输入框有字 → 发送(由调用方去 disabled)', S(false, '今天', true) === 'send')
check('回复中、正在听 → 停止', S(true, '', true) === 'stop')

/*
  ---- 攒着附件(对话页一次最多三张照片) ----

  攒了三张图、一个字没打,右槽也必须是「发送」—— 否则用户攒完图之后
  找不到那个键(它显示的是麦克风),而这时他唯一想做的事就是发出去。
*/
check('**攒了图、输入框为空 → 发送**(否则用户攒完找不到发送键)', S(false, '', false, 1) === 'send')
check('攒了三张也一样 → 发送', S(false, '', false, 3) === 'send')
check('攒了图、同时有字 → 还是发送', S(false, '这餐咸吗', false, 3) === 'send')
check('**一张图都没有、也没字 → 麦克风**(别写成 `attachments >= 0`)', S(false, '', false, 0) === 'mic')
check('一张图都没有、只有空白字 → 麦克风', S(false, '   ', false, 0) === 'mic')

/*
  ⚠️ 这一条是这一组里最要紧的:附件**不能**插到 `listening` 前面。

  攒了三张图再点麦克风,输入框可能一直是空的 —— 这时候唯一挡在
  「停止 → 发送」中间的就是判据顺序。反过来的话,用户按不到停止,
  而这次口述还在往一个他按不停的按钮上写。
*/
check('**口述中 + 攒了三张图 → 仍然是停止**(附件不许插到 listening 前面)', S(true, '', false, 3) === 'stop')

/*
  识别三张要一两分钟,那段时间用户**必须**能继续攒附件 —— 所以 `busy`
  同样不许把附件那条判据带进分支。
*/
check('**识别中(busy)+ 攒了三张图 → 发送**(不能因为忙就不让发)', S(false, '', true, 3) === 'send')

/* ------------------------------------------------------------
   2. foldResults —— 替换,不是追加
   ------------------------------------------------------------ */
console.log('\n=== 2. 转写文本是替换不是追加 ===')

/** 手搭一个 SpeechRecognitionResultList 的最小形状 */
const list = (transcripts, isFinal = true) => {
  const out = { length: transcripts.length, item: (i) => out[i] }
  transcripts.forEach((t, i) => {
    const result = {
      isFinal,
      length: 1,
      item: () => result[0],
      0: { transcript: t, confidence: 1 },
    }
    out[i] = result
  })
  return out
}

check('一段结果', speech.foldResults('', list(['今天盐吃多了吗'])) === '今天盐吃多了吗')
check('前缀原样保留', speech.foldResults('今天中午', list(['吃了什么'])) === '今天中午吃了什么')
check('前缀 + 空结果 = 前缀', speech.foldResults('今天中午', list([])) === '今天中午')

/*
  ⚠️ 这一节存在的理由。

  每个 `result` 事件带的 `results` 是**这一次会话迄今为止的全部结果列表**,
  不是「刚识别出来的那一段」。所以正确写法是每次拿 `前缀 + 整段结果` 重算,
  而 `setInput(prev => prev + transcript)` 会让输入框一路叠上去:

      今 → 今天 → 今天今天盐 → 今天今天盐今天盐吃 …

  下面按「三次事件」的顺序走一遍,断言最后一次的结果**恰好**是那句话。
*/
const events = [list(['今']), list(['今天']), list(['今天盐吃多了吗'])]
let shown = ''
for (const e of events) shown = speech.foldResults('', e)
check('**三次事件之后恰好是那句话**', shown === '今天盐吃多了吗', shown)

// 反面 —— 证明上一条不是恒真的:写成「追加」会得到另一个字符串
let appended = ''
for (const e of events) appended += speech.foldResults('', e)
check('追加写法会累积成别的字符串(所以上一条不是空断言)', appended !== shown, appended)

/*
  中间结果也要拼进去。`interimResults = true` 时 `results` 里混着
  `isFinal: false` 的条目 —— 用户就是要看着自己说的话一点点变成字,
  把它们滤掉的话输入框会一直空着到说完为止。
*/
check('中间结果也拼进去', speech.foldResults('', list(['今天盐'], false)) === '今天盐')

// maxAlternatives = 1 —— 第 0 个候选之外的都不该进来
const multi = { length: 1, item: (i) => multi[i] }
multi[0] = {
  isFinal: true,
  length: 2,
  item: (i) => multi[0][i],
  0: { transcript: '清蒸鱼', confidence: 0.9 },
  1: { transcript: '青蒸鱼', confidence: 0.3 },
}
check('只取第一个候选', speech.foldResults('', multi) === '清蒸鱼')

/* ------------------------------------------------------------
   3. errorLine —— 什么时候不说话
   ------------------------------------------------------------ */
console.log('\n=== 3. 错误文案 ===')

/*
  「是我们自己叫的停」这一条 —— `plate.ts:257-259` 已经把规矩写下来了。
  停止键、组件卸载清理、看门狗超时都会发 `aborted`,不分青红皂白地报错的话
  **每一次正常停止都会弹一条「语音输入被中断了」**。
*/
check('**用户自己按的停止 → 什么都不说**', speech.errorLine('aborted', true) === null)
check('非自愿的中止 → 要说明', typeof speech.errorLine('aborted', false) === 'string')
check('非自愿的中止文案非空', (speech.errorLine('aborted', false) ?? '').length > 0)

/** lib.dom.d.ts:44456 —— 8 个成员,不是 5 个 */
const CODES = [
  'aborted',
  'audio-capture',
  'language-not-supported',
  'network',
  'no-speech',
  'not-allowed',
  'phrases-not-supported',
  'service-not-allowed',
]

const lines = CODES.map((c) => speech.errorLine(c, false))
check(
  '八个错误码全都给了话(没有一个漏成 undefined)',
  lines.every((l) => typeof l === 'string' && l.length > 0),
  JSON.stringify(CODES.filter((_, i) => typeof lines[i] !== 'string'))
)
check('没有空字符串', lines.every((l) => l.length > 0))

check('权限被拒的文案指向设置', /权限|设置/.test(speech.errorLine('not-allowed', false)))
check('没麦克风 vs 没听清 是两句不同的话', speech.errorLine('audio-capture', false) !== speech.errorLine('no-speech', false))
// 这两个 code 没人写得出对用户有意义的中文,走兜底 —— 兜底必须存在且非空
check('没写文案的 code 走兜底', /键盘/.test(speech.errorLine('phrases-not-supported', false)))
// 将来 lib.dom 加了新成员,这里也不该吐 undefined 出去
check('不认识的 code 走兜底', /键盘/.test(speech.errorLine('something-new', false)))

/* ------------------------------------------------------------
   4. pickCtor —— 两个名字都查,标准名优先
   ------------------------------------------------------------ */
console.log('\n=== 4. 找构造函数 ===')

const Stub = function StubRecognition() {}
const PrefixStub = function StubWebkitRecognition() {}

check('空对象 → undefined', speech.pickCtor({}) === undefined)
check('undefined → undefined', speech.pickCtor(undefined) === undefined)
check('null → undefined', speech.pickCtor(null) === undefined)
// Node 里的 globalThis.window 就是 undefined —— 这正是 verify-render 那个前提
check('非对象 → undefined', speech.pickCtor(7) === undefined)

check('认标准名', speech.pickCtor({ SpeechRecognition: Stub }) === Stub)
check('认前缀名(Safari)', speech.pickCtor({ webkitSpeechRecognition: PrefixStub }) === PrefixStub)
check(
  '**两个都有时标准名赢**',
  speech.pickCtor({ SpeechRecognition: Stub, webkitSpeechRecognition: PrefixStub }) === Stub
)
check('字段是 undefined 时也算没有', speech.pickCtor({ SpeechRecognition: undefined }) === undefined)

/* ------------------------------------------------------------
   5. startWatchdog —— 用假时钟驱动
   ------------------------------------------------------------ */
console.log('\n=== 5. 看门狗 ===')

/*
  WebKit bug 317741 / 321436:播过音频之后 `start()` 会挂住,而且**一个事件
  都不发** —— 没有 onresult、没有 onerror、没有 onend。界面永远停在「正在听」,
  用户只能刷新页面。

  这个函数不注入假时钟就没法验,而不验的后果很具体:README 里会多出一句
  「超时会自动收摊」,但它从没被观察到触发过。这和删掉 `confidence`
  (recognize.ts:29-37)、和 README 里那句被划掉的「估算 150g」(见「有意偏离设计稿的文案」)
  是同一把尺子。
*/
const fakeClock = () => {
  let pending = null
  let cleared = 0
  return {
    setTimer: (fn) => {
      pending = fn
      return 1
    },
    clearTimer: () => {
      cleared++
      pending = null
    },
    fire: () => pending?.(),
    get cleared() {
      return cleared
    },
    get armed() {
      return pending !== null
    },
  }
}

{
  const clock = fakeClock()
  let hits = 0
  speech.startWatchdog({ ms: 8000, onTimeout: () => hits++, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  check('刚启动时还没触发', hits === 0)
  check('定时器已经挂上', clock.armed)
  clock.fire()
  check('超时触发一次', hits === 1, String(hits))
}

{
  const clock = fakeClock()
  let hits = 0
  speech.startWatchdog({ ms: 8000, onTimeout: () => hits++, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  clock.fire()
  clock.fire() // 同一个回调被重复调用(浏览器里不会,但断言要成立)
  check('**不重入** —— 重复触发也只调一次', hits === 1, String(hits))
}

{
  const clock = fakeClock()
  let hits = 0
  const cancel = speech.startWatchdog({
    ms: 8000,
    onTimeout: () => hits++,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  cancel()
  check('取消时清了定时器', clock.cleared === 1, String(clock.cleared))
  check('取消之后不再挂着', !clock.armed)
  clock.fire()
  check('**取消之后即使回调仍然到达也不触发**', hits === 0, String(hits))
  cancel()
  check('取消是幂等的', clock.cleared === 2)
}

{
  // 不注入 —— 走真的 setTimeout,验证默认参数确实能用
  let hits = 0
  const cancel = speech.startWatchdog({ ms: 5, onTimeout: () => hits++ })
  cancel()
  await new Promise((r) => setTimeout(r, 30))
  check('默认的 setTimeout/clearTimeout 生效(取消之后没触发)', hits === 0, String(hits))
}

/* ------------------------------------------------------------
   6. 结构性的两条 —— 这个功能会不会把整个自检搞死
   ------------------------------------------------------------ */
console.log('\n=== 6. 不能把 harness 搞死 ===')

/*
  `verify-render.mjs:53` 的 `await server.ssrLoadModule(file)` 写在 `try` **之外**,
  而 Node 里没有 `window`。任何模块顶层的 `window.SpeechRecognition` 都会在
  **导入期**抛 `ReferenceError`,脚本当场死在未捕获的顶层 await 上,后面每一节
  都不再运行 —— 整个结果页、确认分量、日记缩略图、幽灵条目、AgentReplyCard。

  所以下面两条不是「顺便测一下 import」,它们就是这一节的正文:
  这两个模块**必须能在 Node 里被导入**。
*/
check('Node 里确实没有 window', typeof globalThis.window === 'undefined')

let imported = true
try {
  await server.ssrLoadModule('/src/lib/useSpeech.ts')
} catch (err) {
  imported = false
  console.log(`        导入 useSpeech.ts 失败:${err?.message ?? err}`)
}
check('**useSpeech.ts 能在 Node 里导入**(顶层没有读 window)', imported)

check('Node 里 pickCtor(window=undefined) 是 undefined', speech.pickCtor(globalThis.window) === undefined)

/* ------------------------------------------------------------
   7. 图标真的画出来了
   ------------------------------------------------------------ */
console.log('\n=== 7. 图标 ===')

/*
  `Icons.tsx:273` 对未知名字**静默返回 null** —— 拼错一个字母不报错,
  只是那个按钮空着。语音那一格是 `mic`,加完得有个地方盯着。
*/
const icons = await server.ssrLoadModule('/src/components/Icons.tsx')
const micHtml = renderToStaticMarkup(React.createElement(icons.Icon, { name: 'mic', size: 19 }))
check('mic 有 SVG 输出(拼错名字会静默返回 null)', micHtml.includes('<svg'), micHtml.slice(0, 40))
check('mic 里有一根竖长条(话筒本体)', micHtml.includes('<rect'), micHtml.slice(0, 160))

await server.close()
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
