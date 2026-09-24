/**
 * 渲染冒烟测试(开发用,不进产物)
 * ===========================================================
 * 用 react-dom/server 把七个页面各渲染一遍,确认:
 *   · 没有组件在渲染期抛异常
 *   · 页面确实渲染出了内容,不是一个空壳
 *   · 刷新到没有数据的中转页(结果页)时给出的是空状态,不是白屏
 *
 * 它不是视觉回归 —— 排版还得自己在浏览器里看。它挡的是"某个页面白屏了,
 * 但要手动点进去才发现"这一类问题。
 *
 * 跑法:npm run verify:render
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failures++
}

/*
  回复里那两块「常常没有」的内容 —— 食材清单(`fridge`)和营养标签(`ingredient`)。

  单独抽成一个常量,是因为 `AgentReply` 上这两个键**是必填的**(空数组而不是可选,
  见 `agentReply.ts` 里那段注释:写成可选会多出「undefined 和 [] 是不是一回事」这一问),
  于是下面每一份手写夹具都得把它们带上。

  写成 `...NO_EXTRA_BLOCKS` 而不是每份各写一遍,是为了让「这份夹具**故意**没有这两块」
  和「这份夹具忘了写、于是渲染时读到 undefined.length」在屏幕上长得不一样 ——
  后者是崩,不是悄悄变绿。定义放在文件最上面,是因为第一处用到它的夹具在结果页
  那一节(远早于卡片那一节),`const` 有暂时性死区,放后面读不到。
*/
const NO_EXTRA_BLOCKS = { ingredients: [], nutrition: { ingredients: [], labels: [], riskItems: [] } }

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })

/*
  首屏不再播种了(用户第一次打开看到的是一份空档案 + 建档引导),所以下面的
  页面循环必须在**演示数据**上跑 —— 否则 `/profile` 那条期望的「花生过敏」
  会红,而它挡的是一个真实的派生回归(裸词 item + type 拼出界面文案)。

  显式装一次,而不是靠 initialState() 的副作用 —— 读的人不必再追到 store.ts
  才知道这些断言的数据是哪来的。
*/
const store = await server.ssrLoadModule('/src/store/store.ts')
store.resetToSeed()
check(
  'resetToSeed 装上了演示数据',
  store.getSnapshot().profile.restrictions.length > 0,
  `${store.getSnapshot().meals.length} 条记录`
)

/**
 * 每个页面单独渲染。
 *
 * 不用 BrowserRouter —— 它在 Node 里没有 document。MemoryRouter 提供
 * useNavigate / useLocation 需要的上下文,且不需要真实历史记录。
 */
const CASES = [
  ['/', '/src/screens/HomeScreen.tsx', ['健康分', '拍餐盘', '今日餐次']],
  ['/diary', '/src/screens/DiaryScreen.tsx', ['膳食日记', '摄入概览', '餐次记录']],
  // 「花生过敏」是 item(「花生」)+ type(allergy)拼出来的,不是存在档案里的 —
  // 存的是裸词,因为工作流拦的是裸词的子串匹配。这条顺手挡住那个派生回归
  // 「营养目标」是四个分类标签之一、「过敏与用药」是健康信息那张卡里入口行的名字
  // （两个都是这次重命名之后才有的词，顺手挡住改回去）
  ['/profile', '/src/screens/ProfileScreen.tsx', ['健康档案', '营养目标', '过敏与用药', '花生过敏']],
  // 「清空当前档案的记录」在多档案之后点了名 —— 原来那句「清空所有记录」
  // 只作用于当前档案,是要么变成谎话、要么变成一个没人敢按的按钮
  ['/me', '/src/screens/MeScreen.tsx', ['我的', '餐次记录', '清空当前档案的记录']],
  ['/result', '/src/screens/ResultScreen.tsx', ['还没有待归档的分析', '回首页拍一餐']],
  ['/portion', '/src/screens/PortionScreen.tsx', ['没有待确认的餐', '回首页拍一餐']],
  // 「语音输入」这条同时证明两件事 —— 见下面「对话页的语音按钮」那一节
  ['/chat', '/src/screens/ChatScreen.tsx', ['对话', '输入你的问题', '语音输入']],
  // 分析页**不在这里** —— 它渲染什么完全取决于 plate store 的 job 状态,
  // 而新建的模块里没有任务。三种状态在下面单独测
]

// 路由表上的七个页面(分析页不在这里,见 CASES 上方的注释)
console.log('\n=== 七个页面各渲染一遍 ===')

for (const [route, file, expects] of CASES) {
  const mod = await server.ssrLoadModule(file)
  const Screen = mod.default

  let html = ''
  let error = null
  try {
    html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { initialEntries: [route] }, React.createElement(Screen))
    )
  } catch (err) {
    error = err
  }

  if (error) {
    check(`${route} 渲染成功`, false, error.message)
    continue
  }

  const missing = expects.filter((t) => !html.includes(t))
  const ok = html.length > 400 && missing.length === 0
  check(
    `${route.padEnd(11)} 渲染出内容`,
    ok,
    ok ? `${(html.length / 1024).toFixed(1)} KB` : missing.length ? `缺: ${missing.join(' / ')}` : `${html.length} 字节`
  )
}

console.log('\n=== 渲染产物里不该出现的东西 ===')
const home = await server.ssrLoadModule('/src/screens/HomeScreen.tsx')
const homeHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/'] }, React.createElement(home.default))
)
check('首页不含真实姓名', !homeHtml.includes('张颖'))

/**
 * 手机号必须**独立成串**才算命中。
 * 直接搜 `1[3-9]\d{9}` 会误报:评分环的 stroke-dasharray 是两个浮点数拼在一起,
 * 形如 `214.1309552686803 223.05…`,从中截出来的 11 位数字看着就是手机号。
 * 加前后边界(不能紧邻数字或小数点)才能真正区分。
 */
const PHONE = /(?<![\d.])1[3-9]\d{9}(?![\d.])/
const phoneHit = homeHtml.match(PHONE)
check('首页不含未脱敏手机号', !phoneHit, phoneHit ? phoneHit[0] : '')

/*
 * 首页 CTA 那句小字原来写的是「识别菜品 · **估算分量** · 计算营养 · 风险分级」。
 * 分析中那三步文案改了之后,首页这一句就成了**唯一还在宣称 App 估算分量**的
 * 地方 —— 而它是用户进来第一眼看到的东西。两处必须一起改。
 */
check('**首页 CTA 不再宣称 App 估算分量**', !homeHtml.includes('估算分量'))
check('首页 CTA 讲的是现在真实的流程', homeHtml.includes('确认分量'))

/**
 * `/portion` 是三处字符串约定的交点:路由表、分析中页的跳转目标。上面那种
 * 渲染测试**绕过了路由表**(直接 load 组件文件、用 MemoryRouter 摆一个地址),
 * 所以路由写错、或者跳转目标拼错,它一个都不会红 —— 页面照渲染,只是永远
 * 到不了。这里把这几处对齐一下。
 *
 * (App.tsx 自己带 BrowserRouter,在 Node 里没法渲染,所以只能读源码比对。)
 */
const appSrc = await readFile('src/App.tsx', 'utf8')
const analyzingSrc = await readFile('src/screens/AnalyzingScreen.tsx', 'utf8')
check('路由表注册了 /portion', /path="\/portion"/.test(appSrc))
check('分析中页的跳转目标就是 /portion', analyzingSrc.includes("'/portion'"))
check('确认页跳去的是已注册的 /result', /path="\/result"/.test(appSrc))

/*
  建档守卫也在同一张路由表上,同样只能读源码比对(理由见上)。

  为什么值得单独盯一条:这个守卫的失效方式是**静默**的 —— 少了它,
  新用户第一次打开看到的就是一份空档案的空首页,而不是引导,
  而页面照样渲染、自检照样全绿。
*/
check('路由表注册了 /welcome', /path="\/welcome"/.test(appSrc))
check('没走完建档时整张表换掉(不是渲染期跳转)', /!onboarded/.test(appSrc))
check(
  '对话页按当前档案上了 key',
  /<ChatScreen\s+key=\{activeProfileId\}/.test(appSrc),
  appSrc.match(/<ChatScreen[^>]*>/)?.[0] ?? '没找到 ChatScreen'
)

/* ============================================================
   分析中 —— 三种状态
   ------------------------------------------------------------
   这一页渲染什么完全由 plate store 的 job 决定,而且**渲染期不跑 effect**,
   所以它现在可以完全脱离时间断言:直接摆好 job 的状态再渲染。

   三个状态都必须有内容:一直转圈不给出路,和报错白屏一样糟。
   ============================================================ */

console.log('\n=== 分析中:三种状态 ===')
const analyzing = await server.ssrLoadModule('/src/screens/AnalyzingScreen.tsx')
const plate = await server.ssrLoadModule('/src/store/plate.ts')
const { ANALYZE_STAGE_LABELS } = await server.ssrLoadModule('/src/lib/analyzeStage.ts')

const renderAnalyzing = () =>
  renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/analyzing'] },
      React.createElement(analyzing.default)
    )
  )

// ① 没有任务 —— 直接打开这一页 / 刷新
plate.stopPlateJob()
const idleHtml = renderAnalyzing()
check('没有任务时给出「去拍餐盘」，不是白屏', idleHtml.includes('还没有待分析的照片') && idleHtml.includes('去拍餐盘'))
check('没有任务时不谎称正在分析', !idleHtml.includes('正在分析餐盘'))

/*
 * ② 正在分析。
 *
 * `startPlateJob` 是同步的:它设完 'preparing' 就返回,真正的异步工作
 * (压缩 + 请求)要等到微任务才推进。所以**紧接着同步渲染**拿到的一定是
 * 进行中的那一帧 —— 这是确定的,不是"大概是"。
 * 传进去的文件在 Node 里解不开(没有 Image),但那条失败路径晚一步才发生,
 * 正好用它测第三种状态。
 */
const fakeFile = (name) => new File([new Uint8Array(16)], name, { type: 'image/jpeg' })
plate.startPlateJob([fakeFile('a.jpg')], '午餐')
const busyHtml = renderAnalyzing()
check('有任务时显示正在分析', busyHtml.includes('正在分析餐盘'))
/*
 * 第一帧渲染的是**压缩**那一步。这是确定的,不是「大概」:
 * `startPlateJob` 同步写完 `{ stage: 'preparing', step: 'compress' }` 才返回,
 * 压缩真正开始要等到微任务。
 *
 * ⚠️ 这一条原来断言的是三步文案(『识别菜品』+『对照健康档案生成建议』)。
 * 那三步由 `STEP_MS = 1150` 的定时器驱动,和真实任务**毫无关系** ——
 * 断言一直绿着,而屏幕上那句「正在匹配食物成分数据库」是编的。
 * 现在渲染的是 `job.step`,它的来处是 Dify 的 `node_started` 事件。
 *
 * 其余五个阶段的**渲染**在这儿断不到:那需要真的把 job 推到
 * 'recognizing' 并让上游推节点事件,而 Node 里没有 `Image`,
 * `prepareImage` 必然先失败(下面第三条断言正是踩这个)。
 * 接线本身由 verify-reply 的「真实阶段」那一节端到端盯着,
 * 词表与映射由 verify-loop 第 9 节盯着。
 */
check(
  '进行中显示的是真实阶段(首帧 = 压缩)',
  busyHtml.includes(ANALYZE_STAGE_LABELS.compress),
  busyHtml.match(/正在[^<]*/g)?.join(' / ') ?? '(一句「正在…」都没有)'
)
/*
 * 而且**不许预告后面几步**。旧版那个清单是一上来把三句全列出来、
 * 再用「完成 / 进行中」的样式区分 —— 那不只是假的,它还把
 * 「后面还有几步」这个承诺写死在了屏幕上(条件分支会让步数根本不固定)。
 */
const premature = ['guide', 'recognize', 'search', 'assemble'].filter((s) =>
  busyHtml.includes(ANALYZE_STAGE_LABELS[s])
)
check(
  '**首帧不预告还没走到的阶段**(旧版一次列全三步)',
  premature.length === 0,
  premature.map((s) => ANALYZE_STAGE_LABELS[s]).join(' / ') || '(只显示了当前这一步)'
)
/*
 * 第一步原来写的是「识别菜品**与估算分量**」。分量现在由用户在「确认分量」那一步
 * 自己选(见 src/lib/portion.ts),App 不再估算它 —— 这句话留着就变成了新的假话。
 * 同一个说法在首页 CTA 上也有一份,那边单独断言(见下面首页那一节)。
 */
check('**不再声称 App 在估算分量**', !busyHtml.includes('估算分量'))
check('不再承诺一个写死的秒数', !busyHtml.includes('约需 8 秒'), busyHtml.match(/约需[^<]*/)?.[0] ?? '')
check('提供了「停止分析」', busyHtml.includes('停止分析'))

/*
 * ②b 一次几张 —— 进度行。
 *
 * ⚠️ 这一行原来写的是「正在识别第 2 张,共 3 张」,**2026-09-24 改成了只说
 * 张数**。前提变了:三张现在是**并发**跑的(`plate.ts` 那个 `Promise.all`),
 * 同时有三张在飞的时候「第几张」不是一个真实的位置 —— 它们各自处在不同的步上
 * (`compress` / `upload` / `recognize` 混着),报一个数字是在描述一个不存在的
 * 顺序。剩下的「一共几张」仍然是真话,而且正是用户想确认的那件事。
 *
 * 单张时**不许**出现张数:那是句废话,而它占掉的那一行高度在「分析中」这一屏
 * 上是真的紧。
 *
 * 同样用的是同步首帧:见上面那段「`startPlateJob` 是同步的」。
 */
check(
  '**单张时不说「正在识别 1 张…」**(废话,而且白占一行)',
  !busyHtml.includes('正在识别') && busyHtml.includes('识别完成后自动跳转'),
  busyHtml.match(/正在识别[^<]*/)?.[0] ?? '(没有张数,只有那句「识别完成后自动跳转」)'
)

plate.startPlateJob([fakeFile('a.jpg'), fakeFile('b.jpg'), fakeFile('c.jpg')], '午餐')
const threeBusyHtml = renderAnalyzing()
/*
  ⚠️ 判据是**整行相等**,不是 `includes`。这一行字里只有一个数字,而
  「正在识别 1 张…」照样含有「正在识别」—— 只 includes 的话,把张数写成 1
  (说的是「只收了一张」,3 张时是句假话)那条断言照样绿。同理写死成
  「正在识别 2 张…」也绿。整行对下来就没有这些缝。
*/
const threeLine = threeBusyHtml.match(/正在识别[^<]*/)?.[0] ?? ''
check(
  '**三张时首帧就写着「正在识别 3 张…」**',
  threeLine === '正在识别 3 张…',
  threeLine || '(没有那一行)'
)

// ③ 图片本身解不开 —— 给错误态,并且要有出路
await new Promise((r) => setTimeout(r, 0))
const errHtml = renderAnalyzing()
check('图片解不开时给错误态而不是一直转圈', errHtml.includes('这张图片用不了'))
check('错误态给出「换一张」的出路', errHtml.includes('换一张'))
check('错误态给出「手动记录」的退路', errHtml.includes('手动记录这一餐'))

/* ------------------------------------------------------------
   plate.ts 的源级顺序不变量:done 之前必须写好了 pending
   ------------------------------------------------------------
   ⚠️ 这两行的**先后**是渲染期完全看不见的,但它决定结果页显示什么:

     分析页订阅的是 job,看到 `stage: 'done'` 就跳结果页;结果页整个从
     `recognize.pending` 渲染。两行调过来,订阅方会在「已经 done」的那一帧里
     读到一份**还没写进去的旧结果**(或者 null)—— 表现是结果页显示上一张照片
     的菜,或者干脆是空状态,而分析页自己一切正常、控制台一声不吭。

   为什么只能读源码:`renderToStaticMarkup` 不跑 effect、也不跑异步,两条语句
   谁先谁后在屏幕上没有任何痕迹。同一手法在路由表那三个 `replace` 上也用过。

   ⚠️ 判据是**这两个标记在 `run()` 里必须严格一替一个**,而且以 setPending 打头。

   写成「每个 done 的前一个标记是 setPending」是不够的 —— 那样把两行调过来之后
   它**照样绿**:`abortProfileWork()` 里那次 `setPending(null)` 恰好顶在了前面,
   而它和这次识别毫无关系。(这条判据的第一版就是这么写的,弄坏之后没红,才发现。)
   所以既要收窄到 `run()` 里,又要求整条序列严格交替 —— 中间多出一次 setPending
   或者开头就是 done,都算红。
   ------------------------------------------------------------ */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const plateSrc = stripComments(await readFile('src/store/plate.ts', 'utf8'))
// 只看 run() 这一支:别处的 setPending(null)(开始新任务 / 切档案)与这次识别无关
const runAt = plateSrc.indexOf('async function run(')
const runEnd = plateSrc.indexOf('\n}\n', runAt)
const runSrc = runAt === -1 ? '' : plateSrc.slice(runAt, runEnd === -1 ? undefined : runEnd)
const marks = [...runSrc.matchAll(/setPending\(|stage: 'done'/g)].map((m) => m[0])
const doneCount = marks.filter((m) => m === "stage: 'done'").length
check(
  '**run() 里 pending 和 done 严格一替一个,且以 setPending 打头**',
  // 前半句是锚点:改成 helper 之后标记会一个不剩,而「空序列每个元素都满足」
  // 恒真 —— 没有这个下界,这条断言会自己变成一句空话。
  // (一次几张之后落地只剩**一条**路了 —— 原来 ok / degraded 各一条 ——
  //  所以下界是 1 而不是 2。判据本身没变:setPending 必须先出现。)
  doneCount >= 1 &&
    marks.length === doneCount * 2 &&
    marks.every((w, i) => w === (i % 2 === 0 ? 'setPending(' : "stage: 'done'")),
  `${doneCount} 条 done;序列 ${marks.join(' → ') || '(一个标记都没扫到)'}`
)

/* ------------------------------------------------------------
   一次几张 —— 三处都是「一起发」,不是一张接一张
   ------------------------------------------------------------
   用户 2026-09-24:「首页入口同一次发的三张图,app是一张一张读的,哪怕这三张图
   只是同一道食物的不同角度照片」。

   同一段形状原来在**三个地方**各有一份(首页 `plate.ts`、对话页 `ChatScreen`、
   「记入日记」`logRun`),所以三条一起钉 —— **只改一两处**是这件事最容易出的错,
   而漏掉哪一处都是「还是那么慢」。

   ⚠️ 判据为什么是这两条:
     · `await Promise.all(` —— 收出来的数组**天然按下标**。
     · **没有 `outcomes.push(`** —— `push` 的顺序是**完成顺序**,而三处下游
       (`mergeMeals` 按传入顺序拼菜、`okPhotoBlobs`、`firstOkThumb`)全都假设
       `outcomes[i]` 就是第 i 张。错位**不会崩、也不会报错**,是静默配错图。
       所以「一起发」不能只看有没有 `Promise.all` —— 保留 `for` + `await` 再补
       一个空的 `Promise.all` 也能骗过前半条。
   ------------------------------------------------------------ */
/* 名字带 `Batch`:这一套里 `chatPageSrc` / `logRunSrc` 这些名字底下别处已经占了 */
const batchChatSrc = stripComments(await readFile('src/screens/ChatScreen.tsx', 'utf8'))
const batchLogRunSrc = stripComments(await readFile('src/store/logRun.ts', 'utf8'))

const batchSources = [
  ['首页 plate.ts', 'src/store/plate.ts', plateSrc],
  ['对话页 ChatScreen', 'src/screens/ChatScreen.tsx', batchChatSrc],
  ['记入日记 logRun', 'src/store/logRun.ts', batchLogRunSrc],
]

for (const [where, path, src] of batchSources) {
  check(
    `**${where}:几张是 \`Promise.all\` 一起发的**`,
    /const outcomes[^=]*= await Promise\.all\(/.test(src),
    src.match(/const outcomes[^=]*= await Promise\.all\(/)?.[0] ??
      (src.includes('Promise.all(') ? '有 Promise.all,但它不是收 outcomes 的那一次' : '没有 Promise.all')
  )
  check(
    `**${where}:没有 \`outcomes.push\`**(push 的顺序是完成顺序,会静默配错图)`,
    !src.includes('outcomes.push('),
    src.includes('outcomes.push(') ? '还在 push —— 顺序 = 完成顺序' : `(源码里没有,${path})`
  )
  /*
    锚点。少了这条,上面两条在 `recognizeOne` 被改名之后会一起变成**空话**:
    「没有 outcomes.push(」本来就成立,而 Promise.all 那句也不含函数名。
  */
  check(
    `**${where}:还在调 \`recognizeOne\`**(锚点 —— 上游改名之后上面两条就不作数了)`,
    src.includes('recognizeOne('),
    src.includes('recognizeOne(') ? '在调' : '找不到 recognizeOne 的调用'
  )
}

/*
  ⚠️ 阶段文字也必须**折成单调的**。

  三张同时在飞,第 1 张迟到的「正在识别菜品」会在第 3 张已经报到「正在生成回答」
  之后到达 —— 把回调给的值直接写进去(`step: next` / `stage: next`),那一行字
  会在几个阶段之间来回跳,用户看到的是一个**反复倒退**的进度条。

  判据是**原始写法必须消失**,而不是「有 `advance`」:留着那一行再补一个
  `advance` 是照样会跳的。
*/
for (const [where, src] of [
  ['首页 plate.ts', plateSrc],
  ['对话页 ChatScreen', batchChatSrc],
]) {
  check(
    `**${where}:阶段用 \`advance\` 折过,不是把回调那个值直接写进去**`,
    src.includes('advance(') && !/step: next|stage: next/.test(src),
    !src.includes('advance(')
      ? '没有 advance'
      : (src.match(/(?:step|stage): next/)?.[0] ?? '') || 'advance 在,原始写法也没了'
  )
}

/*
  ⚠️ 对话页原来靠一个 `activeIndex` 挡迟到的 `onStage`(`activeIndex !== i + 1`
  就丢掉)。那个判据的**前提是一次只有一张在跑** —— 并发之后失效:三张都是
  「当前那张」,于是它一个都挡不住。

  留一条**墓碑**:这个名字再出现就说明有人把那个判据搬回来了。
  (`activeIndex` 不是通用词,只在这条防线里用过,所以拿它当锚点不会误伤。)
*/
check(
  '**对话页不再用 `activeIndex` 挡迟到的阶段**(并发下三张都是「当前那张」,那个判据失效)',
  !batchChatSrc.includes('activeIndex'),
  batchChatSrc.includes('activeIndex')
    ? '又出现了 —— 它挡不住并发,该用 advance'
    : '(没有了,挡迟到的那件事归 advance 管)'
)

/* ============================================================
   结果页 —— 演示数据 / 模型识别 / 过敏拦截
   ------------------------------------------------------------
   这一页以前用一个随机数渲染「置信度 87%」,而界面上没有任何地方说明
   识别是模拟的。这里盯住三条:不编数字、降级必须说出来、有照片才显示照片。
   ============================================================ */

console.log('\n=== 结果页:三种来源 ===')
const result = await server.ssrLoadModule('/src/screens/ResultScreen.tsx')
const recognize = await server.ssrLoadModule('/src/store/recognize.ts')

const renderResult = () =>
  renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: ['/result'] }, React.createElement(result.default))
  )

const RICE = [{ foodId: 'rice', name: '米饭', grams: 150 }]
const notBlocked = {
  blocked: false,
  risk: { level: 'low', message: '', items: [] },
  mode: 'plate',
  title: '午餐复盘',
  dishes: [],
  ...NO_EXTRA_BLOCKS,
  advice: [],
  disclaimer: '',
}

// ① 本地降级
recognize.setPending({
  slot: '午餐',
  items: RICE,
  engine: 'demo',
  degradedReason: '未配置 Dify Key，本次为演示数据',
})
const demoHtml = renderResult()
check('降级结果明说「不是识别结果」', demoHtml.includes('演示数据') && demoHtml.includes('不是识别结果'))
check('降级结果标出「非真实识别」', demoHtml.includes('非真实识别'))
check('**降级结果不编造置信度**', !demoHtml.includes('置信度'))
check('降级结果不展示照片', !demoHtml.includes('blob:'))

// ② 真实识别
recognize.setPending({
  slot: '午餐',
  items: RICE,
  engine: 'agent',
  photoUrl: 'blob:fake-preview',
  thumbDataUrl: 'data:image/jpeg;base64,AAAA',
  unmatched: ['豆腐菌菇汤'],
  agentReply: notBlocked,
})
const agentHtml = renderResult()
check('模型识别显示用户拍的那张图', agentHtml.includes('blob:fake-preview'))
check('模型识别标出「模型识别」', agentHtml.includes('模型识别'))
check('**模型识别也不编造置信度**', !agentHtml.includes('置信度'))
check('没有降级说明', !agentHtml.includes('不是识别结果'))
check('未匹配的菜被显式标出', agentHtml.includes('豆腐菌菇汤') && agentHtml.includes('按 0 计'))
check('正常结果给「归档」按钮', agentHtml.includes('归档到膳食日记'))

/**
 * ③ 一道菜都没匹配上。
 *
 * ⚠️ `items` 必须写成**哨兵项**,不能写空数组 —— 这个 fixture 一开始就是 `[]`,
 * 于是它绿了很久却什么都没测到:`matchDishes` 从来不产出空数组,它会把
 * 匹配不上的菜也放进 items(带 `unmatched:` 前缀、克数 0),好让用户在修正面板里
 * 看得见。真正的故障是「items 非空但每一项都是 0 kcal」—— 那种情况下
 * 结论卡会渲染成「本餐总热量 0 kcal,占每日 0%」,营养卡六项全是 0。
 * 断言没变,但只有喂对形状才真的在断言。
 */
const UNMATCHED_ITEMS = [
  { foodId: 'unmatched:清炒藕片', name: '清炒藕片', grams: 0 },
  { foodId: 'unmatched:番茄牛腩汤', name: '番茄牛腩汤', grams: 0 },
]

recognize.setPending({
  slot: '午餐',
  items: UNMATCHED_ITEMS,
  engine: 'agent',
  unmatched: ['清炒藕片', '番茄牛腩汤'],
  agentReply: notBlocked,
})
const noneHtml = renderResult()
check('**没有可归档的菜时不给归档按钮**', !noneHtml.includes('归档到膳食日记'))
check('一道都没匹配上时给出路', noneHtml.includes('从食物库记下这一餐'))
check('不渲染「本餐总热量 0 kcal」这种空结论', !noneHtml.includes('本餐总热量'))
check('不渲染「本餐营养」空卡', !noneHtml.includes('本餐营养'))
check('未匹配的菜仍然列出来让用户看得见', noneHtml.includes('清炒藕片'))
check('明说这些菜不在食物库里', noneHtml.includes('按 0 计'))

/**
 * ③b 模型看过图了,但没认出菜品。
 *
 * 实测会走到这里:一张纯色方图 → 模型回「未知菜品 (图片无法识别)」。
 * 这不是降级(请求到了模型、图也看见了),所以**不许**说「演示数据」;
 * 也不许把它当成一道菜 —— 那会渲染出「未知菜品 · 估算 0g」这么一行,
 * 归档后日记里还会多一条叫「未知菜品」的记录。
 */
recognize.setPending({
  slot: '午餐',
  items: [],
  engine: 'agent',
  noDishReason: '未知菜品 (图片无法识别)',
  photoUrl: 'blob:not-a-plate',
  agentReply: notBlocked,
})
const noDishHtml = renderResult()
check('没认出菜时明说没认出来', noDishHtml.includes('这张图里没认出菜品'))
check('把模型的原话如实带出来', noDishHtml.includes('未知菜品 (图片无法识别)'))
check('**不把这次算成降级**(模型真的看过图)', !noDishHtml.includes('不是识别结果'))
/**
 * 结论卡上那句话里的总热量 —— 「数字真的落地了吗」这一类断言全靠它。
 *
 * ⚠️ 定义在**这里**(和下面的 `GRAM_READOUT` 挨着,不住在它第一次被用到的那一节):
 * 结果页新开的 ③d 也要用它,而那一节在这一行**上面**。
 * 放下面就是一个 TDZ 报错,而 `const` 的 TDZ 报错**不会告诉你原因是定义顺序** ——
 * 它长得像「这个标识符没定义」,很容易被当成拼写错误去查。
 *
 * 两个读数工具都住在结果页各节的开头,谁的断言都能往下用。
 */
const totalKcal = (html) => Number(html.match(/本餐总热量 (\d+) kcal/)?.[1])
/**
 * 克数读数必须**锚定边界**地找,不能再用 `includes('估算 0g')`。
 *
 * 条目标签原来写的是「估算 {n}g」,那句话已经去掉了(现在写的是「{n}g」,
 * 因为那个数是用户选的份量,不是 App 估的)—— 于是旧断言变成空跑:App 再也
 * 产不出「估算 0g」这个串,它无论如何都不会失败,测试还在但是什么都没测。
 *
 * 现在直接找「菜品行里的克数读数」这个结构:`tnum` 是每行数字用的类名。
 * 注意别写成朴素的 `!includes('0g')` —— `150g` 里就含 `0g`。
 */
const GRAM_READOUT = /tnum[^>]*>\s*(\d+)\s*g\s*</
/**
 * 把页面里所有克数读数取出来当证据。
 *
 * 别退回 `html.match(/\d+g/)[0]` 那种写法:它会先撞上别的数字片段,于是断言名
 * 写着「(150g)」、打印出来的证据却是「4g」——**一条通过的断言在骗人**,
 * 比一条失败的断言更危险。要报证据就报同一个结构里的东西。
 */
const readouts = (html) => [...html.matchAll(new RegExp(GRAM_READOUT, 'g'))].map((m) => `${m[1]}g`)

/**
 * 把一页里的**卡片**按标记切开 —— 这是「按标记切卡」的**唯一**一份实现。
 *
 * `Card` 的标记是 `rounded-[20px] bg-card`;结果页那张结论卡虽然也有
 * `rounded-[20px]`,但它用的是 `bg-brand-bg`,不会混进来。
 *
 * ⚠️ 住在这一层(而不是第一次用到它的那一节)是**必须**的:结果页那节和档案页
 * 那节都要用,谁在后面定义谁就等着挨 TDZ —— 而 `const` 的 TDZ 报错长得像
 * 「这个标识符没定义」,很容易被当成拼写错误去查(见上面 `totalKcal` 那段)。
 * 原来档案页那节自己写了一份一模一样的,这次合并成一份。
 */
const slicesOf = (html) => {
  const at = [...html.matchAll(/rounded-\[20px\] bg-card/g)].map((m) => m.index)
  return at.map((start, n) => html.slice(start, n === at.length - 1 ? undefined : at[n + 1]))
}
/** 切出**装了某段文字的那一张**卡。切不到返回 `null` —— 空串会让否定断言恒真 */
const cardWith = (html, s) => slicesOf(html).find((c) => c.includes(s)) ?? null

check('**不把它当成一道菜渲染**(整卡里没有任何克数读数)', !GRAM_READOUT.test(noDishHtml),
  readouts(noDishHtml).join('/'))
// ↑ 自检:同一个正则在真的有菜品时**必须**命中,否则上面那条是空的
check('(自检)同一个正则在有菜品时确实命中', GRAM_READOUT.test(agentHtml),
  readouts(agentHtml).join('/') || '正则没命中 → 上面那条断言是空跑')
// 精确到「估算 + 数字 + g」这个组合,别写成 `!includes('估算')` ——
// 结果页另一处「没法估算营养」是句诚实的话,不该被这条连坐
check('**菜品行不再说「估算 150g」**', !/估算\s*\d+\s*g/.test(agentHtml))
check('仍然展示用户拍的那张图', noDishHtml.includes('blob:not-a-plate'))
check('不给归档按钮', !noDishHtml.includes('归档到膳食日记'))
check('给出重拍的出路', noDishHtml.includes('重新拍一张'))
check('给出手动记录的出路', noDishHtml.includes('从食物库记下这一餐'))

/* ---------- ③c 「分量由你选择」只在真走过那一步时才说 ----------
 * 上面的全未收录那条路、和过敏拦截那条路,都会**跳过**确认分量直接渲染
 * 同一张菜品卡。头部要是写「分量由你选择」,就是在说一件没发生过的事。
 */
check('**没走过确认分量时不说「分量由你选择」**', !noneHtml.includes('分量由你选择'))
recognize.setPending({
  slot: '午餐',
  items: RICE,
  engine: 'agent',
  portionConfirmed: true,
  agentReply: notBlocked,
})
check('走过确认分量后才说「分量由你选择」', renderResult().includes('分量由你选择'))

/**
 * ③d 哨兵项和联网查到营养的库外菜**同屏**。
 *
 * 这是这一整块功能唯一会被用户看见的形态,而它的断言**故意和 ③ 相反** ——
 * ③ 断言的是「一道都没匹配上时不许渲染结论卡」,这里断言的是「必须渲染」。
 * 两条一起才算把 `hasItems` 的判据钉住了:只测一边的话,把判据改成
 * 恒真或恒假都能让其中一条通过。
 *
 * ⚠️ **不要把它并进 ③。** ③ 那五条绿着是有意义的(它们描述的是「一律没查到
 * 营养」那条路),往那个夹具里加一个 web 项会让五条**集体变红,而变红的原因是对的** ——
 * 最容易被当成 bug 去修的就是这种红。新行为加到新的一节。
 *
 * 252 = 168 kcal/100g × 150g。哨兵项照旧按 0 计,所以合计就是 252 ——
 * 也就是说下面那条断言同时验证了「web 项**真的进了**合计」和「哨兵项没被算进去」。
 *
 * 这道菜**只定义一次**,下面「确认分量」那一节接着用同一个对象 ——
 * 两屏各写一份的话,改了 per100g 只改一处,另一处会绿着骗人。
 */
const WEB_DISH = {
  foodId: 'web:土豆炖牛肉',
  name: '土豆炖牛肉',
  grams: 150,
  per100g: { kcal: 168, protein: 12.5, carb: 6, fat: 9.8, sodium: 430, sugar: 1.2 },
  source: '薄荷健康',
}

const WEB_ITEMS = [{ foodId: 'unmatched:清炒藕片', name: '清炒藕片', grams: 0 }, WEB_DISH]

recognize.setPending({
  slot: '午餐',
  items: WEB_ITEMS,
  engine: 'agent',
  portionConfirmed: true,
  unmatched: ['清炒藕片'],
  agentReply: notBlocked,
})
const webMixedHtml = renderResult()

check('**有联网营养的菜就算有可归档的菜**(与 ③ 的否定式相反)', webMixedHtml.includes('归档到膳食日记'))
check('  结论卡照常渲染,而且把 web 项算进了合计', totalKcal(webMixedHtml) === 252, String(totalKcal(webMixedHtml)))
check('  营养卡照常渲染', webMixedHtml.includes('本餐营养'))
check('  两道菜都列出来', webMixedHtml.includes('清炒藕片') && webMixedHtml.includes('土豆炖牛肉'))

/**
 * 出处:行内一个标记,底部一句脚注写清来源。
 *
 * ⚠️ 行内那条**必须锚定结构**,不能只写 `includes('联网估算')` —— 那样
 * 抓不到这里唯一真正的失效方式:**标记和克数的先后写反了**。
 * 设计要求是 `150g · 联网估算`(标记在后),而上面那条「不许出现『估算 150g』」
 * 拦不住反过来的写法:标记是「· 联网估算」,`估算` 和数字之间隔着 `</span>`,
 * 那个正则匹配不上。所以只能直接钉住这两个 span 的相邻关系 ——
 * 和 `GRAM_READOUT` 是同一种锚法:认结构,不认子串。
 *
 * 用例:`\s*` 是给 span 之间的空白留的余量,`[\s\S]{0,240}?` 把匹配限制在
 * **同一行内**(一行渲染出来约 200 字符;放宽到整页就会跨行命中,
 * 那样「标记在别的菜上」也能过 —— 又是一条骗人的绿)。
 */
const ROW_MARKER = (dishName) =>
  new RegExp(`${dishName}[\\s\\S]{0,240}?tnum[^>]*>\\s*150g\\s*</span><span[^>]*>\\s*· 联网估算\\s*</span>`)

check('web 行有「联网估算」标记', webMixedHtml.includes('· 联网估算'))
check('  **标记排在克数之后、同一行**(`150g · 联网估算`)', ROW_MARKER('土豆炖牛肉').test(webMixedHtml))
/*
  ⚠️ 数的是**菜品卡那一张**里的次数,不是整页 —— 「联网估算」这四个字现在还会
  出现在「怎么吃」那一列的**第二行**上(库外菜那一行的出处,见这一节后面的
  第 ⑦ 节),按整页数会数出 2 个,而这一条问的是「`DishRow` 那个标记会不会每行
  都标」。量具必须摆在被量的那个东西所在的**那张卡**里。
*/
const webMixedCard = cardWith(webMixedHtml, '识别菜品') ?? ''
check('  标记只出现一次(哨兵那道菜不标)', (webMixedCard.match(/联网估算/g) ?? []).length === 1,
  String((webMixedCard.match(/联网估算/g) ?? []).length))
check('  **哨兵那道菜没被连坐**(不能每行都标)', !/清炒藕片[\s\S]{0,240}?· 联网估算/.test(webMixedHtml))
check('脚注写出处和口径', webMixedHtml.includes('「土豆炖牛肉」的营养值来自联网检索（薄荷健康）'))
check('  脚注明说不是食物库数据', webMixedHtml.includes('非食物库数据'))
// 措辞里带「联网」两个字的那句话不该被上一条连坐成「估算 150g」
check('**仍然不出现「估算 150g」**', !/估算\s*\d+\s*g/.test(webMixedHtml))

/**
 * 「按 0 计」**只挂在哨兵那道菜上**。
 *
 * 这里不能写成 `includes('按 0 计')` —— 那句在 ③ 里也有,而 ③ 的夹具全都
 * 是哨兵。真正要钉的是:那条警告**没有**把 web 项一起说成 0
 * (把 web 项并进 `unmatched` 是这次改动最容易犯的错,而它会渲染成
 * 「对着一个真实的数字说按 0 计」)。所以要把那条警告整句取出来看。
 */
const zeroBanner = webMixedHtml.match(/这 \d+ 项不在食物库里[^。]*。/)?.[0] ?? ''
check('「按 0 计」那条只点了哨兵菜', zeroBanner.includes('清炒藕片') && !zeroBanner.includes('土豆炖牛肉'),
  zeroBanner || '没找到那条警告 → 断言空跑')

// ④ 过敏拦截 —— 没有菜品,复用对话页那张拦截卡
recognize.setPending({
  slot: '午餐',
  items: [],
  engine: 'agent',
  agentReply: {
    blocked: true,
    risk: { level: 'high', message: '宫保鸡丁常含花生，与你的过敏原冲突。', items: ['花生'] },
    mode: '',
    title: '',
    dishes: [],
    advice: [],
    disclaimer: '',
  },
})
// 名字带 Result 前缀 —— 下面 AgentReplyCard 那一节已经用了 blockedHtml
const blockedResultHtml = renderResult()
check('拦截结果复用拦截卡', blockedResultHtml.includes('已为你拦截'))
check('拦截卡里带着过敏原', blockedResultHtml.includes('花生'))
check('**拦截时不出现归档按钮**', !blockedResultHtml.includes('归档到膳食日记'))
check('拦截时给出重新拍的出路', blockedResultHtml.includes('重新拍一张'))
/*
  ⚠️ 指路牌指的名字必须和它指的那一行**逐字相同**。饮食侧那个入口 2026-09-22
  改过三次名(「忌口与偏好」→「忌口」→「忌口与不爱吃」→ 又回到「忌口」),
  这一句指路每一次都跟着改了 —— 不改的话用户会照着走到档案页,然后找一个
  已经没有的名字。
  ⚠️ 判据对**渲染出来的文案**:`>忌口</span>` 这种结构断不了它，因为这一句是
  一整段中文里嵌着的词。所以断「这一段里出现了『忌口』、且整页没有『忌口与偏好』」，
  再拿「过敏与用药」当锚点 —— 两个名字都在，说明这一段真的渲染出来了。
*/
/*
  名字的**真值**在 `RESTRICTION_SECTIONS.diet.entry` 里,这里断的是
  「指路牌 = 那个 entry」,**不写第二份字面量** —— 写死了的话,下次改名时
  这条断言会和真值一起变旧,而它本该红。
  ⚠️ 这一天它红过两次(改名两次),而且**第二次是被自己坑的**:那句
  `!includes(旧名)` 里写的正是绕回来的当前名。教训写进上面那条注释了。
  ⚠️ 旧名字也要断「没出现」:改名最容易漏的就是「新名字加上了、旧名字还留着」,
  那时同一个页面上两句话自相矛盾。
*/
/* 这一节（拦截页）在 `typesMod` 定义之前，所以单独取一次句柄（模块是同一个） */
const typesModEarly = await server.ssrLoadModule('/src/store/types.ts')
const dietEntry = typesModEarly.restrictionSectionShape('diet').entry
check(
  '**拦截页的指路牌指的是现在的名字**（= 那一段的 entry，不是旧名）',
  blockedResultHtml.includes('过敏与用药') &&
    blockedResultHtml.includes(`「${dietEntry}」调整`) &&
    /* ⚠️ 这两个是**历史名字**,不是「当前名字的反面」。上一版这里写的是
       `!includes('或「忌口」调整')` —— 那时「忌口」正是被改掉的那个旧名;
       入口名绕回来之后那一句会**反过来卡住正确的文案**,所以换成两个真正的
       旧名。历史再加一代时,往这里再添一个,而不是把当前名写成反面。 */
    !blockedResultHtml.includes('忌口与偏好') &&
    !blockedResultHtml.includes('忌口与不爱吃'),
  blockedResultHtml.match(/可以到[^。]*。/)?.[0] ?? '没找到那一句'
)

recognize.setPending(null)

/* ============================================================
   结果页:怎么吃
   ------------------------------------------------------------
   规则本身在 `verify-loop` 第 17 节测过了。这里测的是**它有没有走到屏幕上** ——
   中间隔着 `useMemo` 和一层 JSX,都是纯函数断言照不到的地方。

   这一节是原来的两节(「进食顺序」+「进食多少」)合并来的。用户的原话是
   「就是可以在推荐某道菜顺序的时候顺便推荐这道菜进食多少的建议,健康建议也可以
   看看怎么适当合并」—— 所以屏上现在**只有一张卡**:一行一道菜,顺序和份量并排
   在同一行里,指名到某道菜的建议挂在那一行下面,整餐级的留在卡尾。

   ⚠️ 夹具必须自己 `setPending(null)` 收尾:下一节的第一条断言就是「没有 pending
   时给空状态而不是白屏」,不收尾的话红的是那一句,而它看起来和这次改动毫无关系。
   ============================================================ */
console.log('\n=== 结果页:怎么吃 ===')

/**
 * 序号徽章的类名 —— **手写**,不是从 `NumberBadge` 里读出来的。
 * 读出来再比就是拿同一个来源比它自己,恒真。这条挡的是「提取组件时把类名改坏」,
 * 而加它之前那件事**在整套断言里什么都不会红**(grep 过:原本没有任何断言锚在
 * 这个徽章的标记上)。
 *
 * (同一个常量在下面「对话页那张卡」那节里还要用一次 —— 序号徽章在两个地方是
 * **同一个组件**,两边都断一次,只断一边的话「改坏其中一处」在另一边静默通过。)
 */
const NUMBER_BADGE = 'rounded-full bg-brand-bg'

/* ---------- ① 一盘有汤、还有饮料的午饭 ---------- */
/*
  这份夹具里五道菜**分属四个档**:汤(餐前)、青菜(先吃)、排骨(再吃)、米饭
  (最后吃)、可乐(随餐)。所以下面那条「每一道菜都在这张卡上」是真的在盘它 ——
  上一版没有「随餐」这一档,可乐会从这张卡上**消失**。
*/
const PLATE = [
  { foodId: 'braised-ribs', name: '红烧排骨', grams: 150 },
  { foodId: 'lettuce-stir', name: '清炒油麦菜', grams: 200 },
  { foodId: 'rice', name: '米饭', grams: 150 },
  { foodId: 'seaweed-egg-soup', name: '紫菜蛋花汤', grams: 250 },
  { foodId: 'cola', name: '含糖可乐', grams: 330 },
]

/**
 * 从一行 `<li>` 里抠出三样东西。**手写正则**,不是从 JSX 里读类名 ——
 * 读出来再比就是拿同一个来源比它自己。
 *
 * ⚠️ 胶囊**不能按 `rounded-full` 找**:同一行里 `NumberBadge` 也是 `rounded-full`
 * (`tnum mt-px flex … rounded-full bg-brand-bg …`)而且排在前面,挂到行上的建议块
 * 里还有一个角标也是 `rounded-full`。按形状找会一路抠错。所以按**文字**找:
 * 那一行里只有胶囊会说「多吃 / 适量喝 / 别吃」这几个词。
 */
const AMOUNT_NAME = /<span class="min-w-0 flex-1 truncate text-\[15px\] leading-\[22px\] text-ink">([^<]*)<\/span>/
const AMOUNT_CHIP = /<span class="([^"]*)">(多[吃喝]|适量[吃喝]|少[吃喝]|别[吃喝])<\/span>/
/** 第二行 = **顺序说明 · 份量**;顺序缺席时只剩份量(见 `eatingPlan.ts`) */
const AMOUNT_TEXT = /<span class="text-\[13px\] leading-\[18px\] text-muted">([^<]*)<\/span>/

/**
 * 建议右上角那个**角标**。
 *
 * 认的是「胶囊 + 白底 + **描边**」这个组合:行里的档位胶囊也是 `rounded-full`,
 * 但它的底是 `bg-brand-bg` / `bg-warn-bg` / `bg-black/[0.05]`,**没有 `border`**;
 * 只有角标是 `rounded-full border bg-card` 三个一起出现。
 *
 * 取的是**整段 class 和里面的字**,不是「那行字在不在」—— 上一版断「依据 · …」
 * 在不在,而那个写法对着旧的白底引文块同样是绿的(旧写法也印着那行字)。
 * 认结构,不认子串。
 */
const BASIS_BADGES = (html) =>
  [...html.matchAll(/<span class="([^"]*rounded-full border bg-card[^"]*)">([^<]*)<\/span>/g)].map((m) => ({
    cls: m[1],
    text: m[2],
  }))

/**
 * 卡片里那一串**行本身**(`<ol>`),不含卡头和脚注。
 *
 * ⚠️ 必须切开,不能拿整张卡去断:卡尾的建议正文里也有菜名和「再吃」这类词,
 * 顺序那条脚注更是整句都带着「再吃菜和肉」。这一条**真红过** —— 两档的餐盘上
 * 步骤只有「先吃蛋白质 / 最后吃主食」,断言却被脚注误伤成了 FAIL。
 */
const listRowsOf = (card) => {
  const ol = card?.match(/<ol[\s\S]*?<\/ol>/)?.[0] ?? null
  return ol === null ? null : ol.split('<li').slice(1)
}

/** 标签:哪张卡在哪一格 —— 位置错时把整页的卡片序列打出来 */
const CARD_LABELS = (html) =>
  slicesOf(html)
    .map((c, i) => {
      const what = ['识别菜品', '怎么吃', '本餐营养'].find((t) => c.includes(t))
      return `${i}:${what ?? '?'}`
    })
    .join(' ')

recognize.setPending({ slot: '午餐', engine: 'agent', items: PLATE })
const planHtml = renderResult()
const planCard = cardWith(planHtml, '怎么吃')

check('**这一盘上渲染出了「怎么吃」卡**', planCard !== null)
// 锚点:切不到时下面每条否定断言(「没有克数」「老卡头不在」)都会静默变绿
check(
  '  (锚点)切出来的确实是那张卡,不是空串',
  planCard !== null && planCard.length > 80,
  planCard === null ? '没切到这张卡' : `${planCard.length} 字符`,
)
check(
  '**合并之后整页就三张卡,这张夹在菜品卡和本餐营养卡中间**',
  slicesOf(planHtml).length === 3 &&
    slicesOf(planHtml)[0].includes('识别菜品') &&
    slicesOf(planHtml).findIndex((c) => c.includes('怎么吃')) === 1 &&
    slicesOf(planHtml)[2].includes('本餐营养'),
  CARD_LABELS(planHtml),
)
/*
  合并前那三张卡的卡头必须**一个都不剩**。少了这条,把旧卡留下一张照样能全绿 ——
  它的行和这张卡长得几乎一样(同一份 `AMOUNT_TONES`、同一个 `NumberBadge`)。
*/
check(
  '**合并前那三张卡的卡头在屏上一个都不剩**',
  !planHtml.includes('进食顺序') && !planHtml.includes('进食多少') && !planHtml.includes('进食建议'),
  ['进食顺序', '进食多少', '进食建议'].filter((w) => planHtml.includes(w)).join(' / ') || '三个都不在',
)
/*
  卡头那句「基于「{谁}」」原来是建议卡的卡头写的,它随那张卡一起消失了 ——
  不搬过来的话,这一页就看不出这张卡是照着**谁**的档案说的了。
*/
check(
  '**卡头写着「怎么吃 · 基于『谁』」**(建议卡卡头那句跟着搬过来了)',
  planCard !== null && planCard.includes(`怎么吃 · 基于「${store.getSnapshot().profile.name}」`),
  planCard?.match(/怎么吃 · [^<]*/)?.[0] ?? '没切到',
)

/*
  ⚠️ **行数按 `<li` 数,不按类名数。** 原来那条「五步就是五个序号徽章」是拿
  `NUMBER_BADGE`(`rounded-full bg-brand-bg`)在 `<ol>` 里数出来的 —— 而那一对类名
  和 `recommend` 档的胶囊**是同一对**,当时没撞上只是因为它们在胶囊的类名里不相邻。
  那是在靠巧合站着,所以这一版的行数量具改成数行本身。
*/
const planRows = listRowsOf(planCard)
// 锚点:切不到时下面「逐行」那几条会以「数组为空」的名义全部静默变绿
check(
  '  (锚点)切出了行列表本身(不含卡头和脚注)',
  planRows !== null && planRows.length > 0,
  planRows === null ? '没切到' : `${planRows.length} 行`,
)
/*
  ⚠️ 这一条和下面那条「一道都不许少」**只覆盖库内菜那一半** —— `PLATE` 五道菜
  全在食物库里。库外菜(联网估算 / 哨兵项)那一半在第 ⑦ 节,那一节的夹具里
  两种都有。两边都留着:这一条盯的是「库内菜一行都不许筛」,那一条盯的是
  「库外菜也得有行」,红的时候机不一样。
*/
check(
  '**一行一道菜 —— 行数就是菜品卡的条数,而且一行一个序号徽章**',
  planRows !== null &&
    planRows.length === PLATE.length &&
    planRows.filter((r) => r.includes(NUMBER_BADGE)).length === planRows.length,
  planRows === null
    ? '没切到'
    : `${planRows.length} 行 / ${planRows.filter((r) => r.includes(NUMBER_BADGE)).length} 个徽章`,
)
/*
  ⚠️ 这一条是用户原话那条规矩(「进食顺序建议中任何一个菜都不要遗漏」)在**屏幕上**
  的版本。判据是拿**夹具自己的 items** 去比 —— 不是拿这张卡跟它自己比。
  (同上:这份夹具全是库内菜,库外菜那一半在第 ⑦ 节。)
*/
check(
  '**菜品卡里的每一道菜都出现在这张卡上,一道都不许少**',
  planRows !== null && PLATE.every((i) => planCard.includes(i.name)),
  planRows === null
    ? '没切到'
    : PLATE.filter((i) => !planCard.includes(i.name))
        .map((i) => i.name)
        .join(' / ') || '一道不缺',
)
check(
  '**汤排在最前、三道熟菜是 蔬菜 → 蛋白质 → 主食、「随餐」那档在最后**',
  planRows !== null &&
    ['紫菜蛋花汤', '清炒油麦菜', '红烧排骨', '米饭', '含糖可乐'].every((n, i) =>
      (planRows[i] ?? '').includes(n)
    ),
  (planRows ?? []).map((r) => r.match(AMOUNT_NAME)?.[1] ?? '?').join(' → ') || '一行都没抠出来',
)
check('卡里不出现「本餐营养」四个字', planCard !== null && !planCard.includes('本餐营养'))
check('  (锚点)那道汤确实还在这一页上(不是被整页吞了)', planHtml.includes('紫菜蛋花汤'))

/**
 * 期望值**手写**。第二行是「顺序说明 · 量」,两半各有各的来源:顺序词来自
 * `eatingOrder.ts`,量词来自 `data/guideline.ts` 那张表,中间那个「· 」是渲染方
 * 拼的(见 `eatingPlan.ts`)。左边是从规则里该长什么样,右边才是屏上印的。
 *
 * 三档的胶囊字面是「多/适量/少」+ 动词拼的(汤是「适量喝」不是「适量吃汤」),
 * 所以动词也要一起断 —— 只断档位的话,把 `verb` 写死成「吃」不会红。
 *
 * 「任何一个菜都不能少一句顺序说明」这条规矩由**这张表**覆盖(每一行的前半就是
 * 说明词),不再单数一遍:表是逐行全等的比较,少一句就是数组不等。
 */
const AMOUNT_SPEC = [
  //        菜名          胶囊      第二行(顺序说明 · 份量)
  ['紫菜蛋花汤', '适量喝', '餐前喝汤 · 一小碗'],
  ['清炒油麦菜', '多吃', '先吃蔬菜 · 双手一捧，可以多吃'],
  ['红烧排骨', '适量吃', '再吃蛋白质 · 一个掌心'],
  ['米饭', '适量吃', '最后吃主食 · 一小碗，约一拳'],
  ['含糖可乐', '少喝', '随餐 · 不喝或少喝'],
]
// 锚点:表本身得是满的,否则下面那条逐行比对会拿一张空表跟空卡比
check('  (锚点)手写的期望表是五行', AMOUNT_SPEC.length === PLATE.length, `${AMOUNT_SPEC.length} 行`)
const actualRows = (planRows ?? []).map((r) => [
  r.match(AMOUNT_NAME)?.[1] ?? null,
  r.match(AMOUNT_CHIP)?.[2] ?? null,
  r.match(AMOUNT_TEXT)?.[1] ?? null,
])
check(
  '**五行逐行:菜名 / 胶囊 / 「顺序 · 份量」**',
  JSON.stringify(actualRows) === JSON.stringify(AMOUNT_SPEC),
  actualRows.map((r) => r.join('·')).join(' | ') || '一行都没抠出来',
)
/*
  再单独钉一行字面,是因为上面那张表**可以靠两半各自都对而通过**,却把中间那个
  「· 」丢了、或者换成了「、」。而用户要的正是「推荐顺序的时候顺便把这道菜吃多少
  说了」—— 那句话在屏幕上的样子就是这一行。
*/
check(
  '**一行里同时有顺序和份量**(红烧排骨那一行恰好是 `再吃蛋白质 · 一个掌心`)',
  (planRows ?? []).some((r) => r.match(AMOUNT_TEXT)?.[1] === '再吃蛋白质 · 一个掌心'),
  (planRows ?? []).map((r) => r.match(AMOUNT_TEXT)?.[1] ?? '?').join(' | ') || '一行都没抠出来',
)

/*
  用户的原话是「不要说多少 g 这种用户无法准确衡量的内容」。这里量的是**屏幕上**
  那两行字 —— 纯函数那条只管 `amount` 字段,管不到脚注、也管不到将来有人往
  这一行里塞一个 `<span>` 包起来的读数。
*/
check(
  '**每一行的「量」里一个阿拉伯数字都没有**',
  actualRows.length > 0 && actualRows.every((r) => r[2] !== null && !/\d/.test(r[2])),
  actualRows.map((r) => r[2]).join(' / ') || '一行都没抠出来',
)
/*
  克数那条在**整张卡**上再断一次(含脚注、含挂上来的建议正文)。挂在行上的建议
  正文里是有数字的(「本餐钠约 2680mg」),但 `GRAM_READOUT` 认的是 `tnum` 那一格
  里的「数字 + g」,建议正文是普通文本 span,碰不到 —— 这条断的仍然是「没有一个
  被当成读数渲染出来的克数」。
*/
check(
  '**整张卡里没有任何克数读数**(含脚注和建议正文)',
  planCard !== null && !GRAM_READOUT.test(planCard),
  planCard === null ? '没切到' : readouts(planCard).join('/') || '无',
)
/*
  「适量」那一档**故意没有底色** —— 三档里只有它在说「照常吃」,给它一个底色
  一屏就是四块颜色,反而看不出哪几行要留意(理由写在 `ResultScreen.tsx` 那个
  `AMOUNT_TONES` 上)。

  判据写成「正好是那一对类名」而不是「不含 brand/warn/danger」:后者对一个
  空类名也成立,而空类名恰恰是把胶囊写坏的典型样子。
*/
const moderateChip = (planRows ?? []).map((r) => r.match(AMOUNT_CHIP)).find((m) => m?.[2] === '适量吃')
check(
  '**「适量」那一档没有底色**(用的是 `Tag` 未选中态那一对类名)',
  moderateChip !== undefined && moderateChip[1] === 'shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-[15.93px] font-medium bg-black/[0.05] text-muted',
  moderateChip === undefined ? '没找到「适量吃」那一行' : moderateChip[1],
)
check(
  '**「少」那一档走的是 warn 那对色**(不是 danger:它还没到和你档案冲突)',
  (planRows ?? []).some((r) => r.match(AMOUNT_CHIP)?.[1].includes('bg-warn-bg')),
  (planRows ?? []).map((r) => r.match(AMOUNT_CHIP)?.[1] ?? '?').join(' | '),
)

/* ---------- ② 「合并」这件事在屏幕上的样子:整餐级的建议留在卡尾,不挂进某一行 ---------- */
/*
  ⚠️ **2026-09-23 判据翻了。** 原来这里断的是「钠那条画在紫菜蛋花汤那一行的里面」——
  那一版把「这一餐的钠主要来自哪道菜」挂到了那道菜的行里,结果和那一行的档位打架:

      素炒时蔬  多吃            ← 分类规格
                钠主要来自它     ← 同一行

  **一条建议要么说这一餐,要么说这道菜。** 钠/糖两条说的是整餐合计,所以位置在卡尾。

  判据仍然是「在那**一行**的 `<li>` 里」,只是期望值反过来了:一行都不该有,
  而整张卡里必须有(否则是把建议弄丢了,不是挪了位置)。
*/
const inRow = (needle) => (planRows ?? []).some((r) => r.includes(needle))
check(
  '**钠那条一行都不挂,留在卡尾**(紫菜蛋花汤那一行不再有它)',
  !inRow('本餐钠约') && planCard.includes('本餐钠约'),
  `挂到 ${(planRows ?? []).filter((r) => r.includes('本餐钠约')).length} 行 / 卡里有=${planCard.includes('本餐钠约')}`,
)
check(
  '**糖那条一行都不挂,留在卡尾**(含糖可乐那一行不再有它)',
  !inRow('添加糖约') && planCard.includes('添加糖约'),
  `挂到 ${(planRows ?? []).filter((r) => r.includes('添加糖约')).length} 行 / 卡里有=${planCard.includes('添加糖约')}`,
)
check(
  '**整餐级那条不在任何一行里**(它在那条分隔线下面,不在行中间插队)',
  (planRows ?? []).every((r) => !r.includes('占全天目标')),
  (planRows ?? []).map((r, i) => (r.includes('占全天目标') ? `第 ${i + 1} 行` : null)).filter(Boolean).join(' ') ||
    '一行都没有',
)

/* ---------- ③ 两档的餐盘:卡尾那一摞 ---------- */
recognize.setPending({
  slot: '午餐',
  engine: 'agent',
  items: [
    { foodId: 'braised-ribs', name: '红烧排骨', grams: 150 },
    { foodId: 'rice', name: '米饭', grams: 150 },
  ],
})
const twoTierHtml = renderResult()
const twoCard = cardWith(twoTierHtml, '怎么吃')
const twoRows = listRowsOf(twoCard)
check(
  '**只有两档的餐盘也出这张卡**(先吃肉、最后吃饭,正是这句建议本身)',
  twoRows !== null && twoRows.length === 2,
  twoRows === null ? '没切到' : `${twoRows.length} 行`,
)
check(
  '  两档时是「先吃蛋白质 / 最后吃主食」,没有「再吃」',
  twoRows !== null && twoRows[0].includes('先吃蛋白质') && twoRows[1].includes('最后吃主食'),
  (twoRows ?? []).map((r) => r.match(AMOUNT_TEXT)?.[1] ?? '?').join(' | ') || '一行都没抠出来',
)
/*
  同一盘,改判据之后:两行的里面**都不该有**钠糖那两条 —— 它们说的是整餐合计,
  落卡尾(上面那两条已经断过一次;这里断的是**同一盘的另一侧**:行里确实空了)。
*/
check(
  '**这一行的里面不再挂钠糖**(红烧排骨那一行现在只有顺序和量)',
  !(twoRows?.[0] ?? '').includes('本餐钠约') && !(twoRows?.[0] ?? '').includes('添加糖约'),
  (twoRows?.[0] ?? '').match(/(本餐钠约|添加糖约)/g)?.join(' → ') ?? '(行里没有建议 ✓)',
)
/*
  卡尾那一摞:整餐级的两条(「这一餐没有蔬菜或水果」「蛋白质…偏少」)留在**同一张
  卡**里、在**最后一行之后**,而且和上面那一段隔着一条细分隔线 —— 上面是逐道菜
  的话,从这里开始是对这一餐整体的话。
*/
const tailAt = twoCard === null ? -1 : twoCard.indexOf('这一餐没有蔬菜或水果')
check(
  '**整餐级的两条留在同一张卡的末尾,在最后一行之后**',
  twoCard !== null &&
    tailAt > twoCard.lastIndexOf('<li') &&
    twoCard.includes('这一餐没有蔬菜或水果') &&
    twoCard.includes('占全天目标') &&
    twoCard.includes('border-t border-line'),
  tailAt < 0
    ? '卡尾那两条不在'
    : `最后一行 @${twoCard.lastIndexOf('<li')} / 卡尾 @${tailAt}`,
)

/* ---------- ④ 只有一档的餐盘:没有「顺序」可言 ---------- */
recognize.setPending({
  slot: '午餐',
  engine: 'agent',
  items: [
    { foodId: 'rice', name: '米饭', grams: 150 },
    { foodId: 'mantou', name: '馒头', grams: 100 },
  ],
})
const oneHtml = renderResult()
const oneCard = cardWith(oneHtml, '怎么吃')
const oneRows = listRowsOf(oneCard)
/*
  ⚠️ **这条判据和上一版相反。** 原来断言的是「只有一档的餐盘整张卡不出现」——
  依据是 `eatingOrder.ts` 那句「① 米饭 ② 馒头不是建议、是噪音」。它说的是
  「没有**顺序**」;而合并之后这张卡每一行的主语是「**吃多少**」,序号只是行号,
  份量那张卡今天就是这么渲染的。所以两行都在。见 `eatingPlan.ts` 文件头。
*/
check(
  '**只有一档的餐盘照样出这张卡,两行都在**(上一版的判据是「整张不出现」)',
  oneRows !== null && oneRows.length === 2,
  oneRows === null ? '没切到这张卡' : `${oneRows.length} 行`,
)
/*
  而这两行的第二行**只剩份量**,连那个「· 」都不画 —— 顺序缺席的判据是
  `note === undefined`(不是空串)。**不给它补一个「随餐」兜底**:那是替一道
  没有先后可言的菜编了一个位置。
*/
check(
  '**两行的第二行只剩份量,屏上一个字的顺序都没说**',
  oneRows !== null && oneRows.every((r) => !/随餐|最后吃|先吃|再吃|餐前/.test(r)),
  (oneRows ?? []).map((r) => r.match(AMOUNT_TEXT)?.[1] ?? '?').join(' | ') || '一行都没抠出来',
)
/*
  两条脚注**不能合并**(两段的署名范围逐句核过,理由见 `eatingPlan.ts` 文件头)。
  顺序那条的条件是「至少有一行带顺序说明」—— 这一盘屏上一个字顺序都没说,
  再把它署给那两份食养指南就是「引用比依据**大**」。份量那条的条件不同,照旧在。
*/
check(
  '**顺序那条脚注不在这一屏上**(这一盘没有顺序可言)',
  oneCard !== null && !oneCard.includes('菜和肉摆在主食前面'),
  oneCard === null ? '没切到' : (oneCard.match(/菜和肉摆在主食前面/) ? '它在' : '不在'),
)
check(
  '  份量那条脚注照旧在(它署的是量词,和有没有顺序无关)',
  oneCard !== null && oneCard.includes('一捧量蔬菜'),
  oneCard === null ? '没切到' : (oneCard.match(/一捧量蔬菜/) ? '在' : '不在'),
)
check('  (锚点)同一屏上菜品卡照常渲染,两道菜都还在', oneHtml.includes('识别菜品') && oneHtml.includes('米饭') && oneHtml.includes('馒头'))

/*
  反过来:说了顺序的那一屏,顺序那条脚注就**必须**在。只断「单档那屏没有」
  的话,「无条件删掉这条脚注」照样绿。
*/
check(
  '**两条脚注同时存在,一条都没被合掉**(这一盘说了顺序)',
  planCard !== null && planCard.includes('菜和肉摆在主食前面') && planCard.includes('一捧量蔬菜'),
  planCard === null
    ? '没切到'
    : ['菜和肉摆在主食前面', '一捧量蔬菜'].filter((t) => !planCard.includes(t)).join(' / ') || '两条都在',
)

/* ---------- ⑤ 水果:也在餐前那一档 ---------- */
recognize.setPending({
  slot: '午餐',
  engine: 'agent',
  items: [
    { foodId: 'apple', name: '苹果', grams: 180 },
    { foodId: 'lettuce-stir', name: '清炒油麦菜', grams: 200 },
    { foodId: 'rice', name: '米饭', grams: 150 },
  ],
})
const fruitRows = listRowsOf(cardWith(renderResult(), '怎么吃'))
check(
  '**水果上屏那句是「餐前吃水果」,和青菜的「先吃蔬菜」不是同一句**(名词跟着分类走)',
  fruitRows !== null &&
    fruitRows.some((r) => r.match(AMOUNT_TEXT)?.[1]?.startsWith('餐前吃水果')) &&
    fruitRows.some((r) => r.match(AMOUNT_TEXT)?.[1]?.startsWith('先吃蔬菜')),
  (fruitRows ?? []).map((r) => r.match(AMOUNT_TEXT)?.[1] ?? '?').join(' | ') || '一行都没抠出来',
)

/* ---------- ⑥ 撞上档案里的忌口 ---------- */
/*
  演示档案里本来就有「花生过敏」(`store/defaults.ts`),所以这里**不用改档案**
  就能渲染出那一行 —— 拿真数据断,比先 `updateProfile` 再还原少一个会忘的步骤。
*/
recognize.setPending({
  slot: '午餐',
  engine: 'agent',
  items: [{ foodId: 'peanut', name: '炒花生', grams: 30 }],
})
const blockedPlanHtml = renderResult()
const blockedRows = listRowsOf(cardWith(blockedPlanHtml, '怎么吃'))
const blockedRow = blockedRows?.[0] ?? ''
check(
  '**撞上忌口那一行的胶囊是「别吃」,第二行写的是撞的是哪一条**',
  blockedRow.includes('>别吃<') && blockedRow.includes('档案里写着「花生过敏」'),
  blockedRows === null
    ? '没切到这张卡'
    : `${blockedRow.match(AMOUNT_CHIP)?.[2] ?? '没胶囊'} ／ ${blockedRow.match(AMOUNT_TEXT)?.[1] ?? '没量'}`,
)
check(
  '  那一行走 danger 那对色(页面上 danger 一直是「和你档案冲突」)',
  (blockedRow.match(AMOUNT_CHIP)?.[1] ?? '').includes('bg-danger-bg'),
  blockedRow.match(AMOUNT_CHIP)?.[1] ?? '没胶囊',
)
check(
  '  **库里那道菜自己的量被换掉了**(不是两句话并排)',
  !blockedRow.includes('一小把'),
  blockedRow.match(AMOUNT_TEXT)?.[1] ?? '没量',
)
/*
  忌口那条**也挂在行上**(它指名了「炒花生」),角标就是那条忌口的名字。
  「别吃」那句和角标都还在屏上 —— 合并没有把任何一条吞掉。
*/
const blockedBadges = BASIS_BADGES(blockedRow)
check(
  '**忌口那条建议画在这一行里面,角标是「花生过敏」**',
  blockedBadges.length === 1 && blockedBadges[0].text === '花生过敏',
  blockedBadges.map((b) => b.text).join(' / ') || '这一行没有角标',
)

/*
  一道菜也出卡 —— 这是**和顺序卡刻意的不同**(那张卡要 ≥ 两档,所以同盘不出现)。
  纯函数那边有一条同义的断言,这条是它上屏之后的版本:两条都留着,因为它们红的
  时机不同(一条挡规则改坏,一条挡守卫被写成 `rows.length > 1 && …` 那一类)。
*/
recognize.setPending({
  slot: '午餐',
  engine: 'agent',
  items: [{ foodId: 'rice', name: '米饭', grams: 150 }],
})
const oneDishHtml = renderResult()
check(
  '**一碗饭也有「怎么吃」可言**(一行,第二行只剩份量)',
  listRowsOf(cardWith(oneDishHtml, '怎么吃'))?.length === 1,
  CARD_LABELS(oneDishHtml),
)
// 锚点:没有它的话,上面那条对「整页白屏」也成立
check('  (锚点)同一屏上菜品卡照常渲染', oneDishHtml.includes('识别菜品') && oneDishHtml.includes('米饭'))

/* ---------- ⑦ 库外菜也有自己的一行 ---------- */
/*
  用户报的就是这一条:「图片识别出来的是5道菜,结果在怎么吃界面只分析了4道菜」,
  而漏掉的那道是**联网估算的**。规则那一侧在 `verify-loop` 第 17 节测过了
  (行在不在、`stance` 是哪一支、行数对不对);这里测的是**它在屏幕上长什么样** ——
  中间隔着 `useMemo` 和一层 JSX,纯函数断言照不到。

  ⚠️ **这一节上一版是反过来写的**(「库外菜一道都不进行、指名它的建议整条下沉到
  卡尾」)。那个行为**已经改掉了**,别再照旧读这两条。

  夹具照旧是「钠最高的恰恰是那道库外菜」:不给它断言的话,那一行和那条建议
  任何一处悄悄消失都不会有症状。
*/
/*
  ⚠️ 名字**不能**叫 `WEB_DISH` —— 那个已经在上面的「库外菜:联网查到营养」那一节
  定义过了(土豆炖牛肉,那道菜还被「确认分量」那一节共用,文件头写着「只定义一次」)。
  另起一个是因为这一节要的是**钠最高的是那道库外菜**:上面那道 430mg/100g × 150g
  = 645mg,够不着钠那条建议的线;这一道 900 × 150 = 1350mg,稳稳是最高的。
*/
const PLAN_WEB_DISH = {
  foodId: 'web:酱爆茄子',
  name: '酱爆茄子',
  grams: 150,
  per100g: { kcal: 120, protein: 3, carb: 8, fat: 8, sodium: 900, sugar: 2 },
  source: '薄荷健康',
}
const PLAN_SENTINEL = { foodId: 'unmatched:清炒藕片', name: '清炒藕片', grams: 0 }
/** 库里那道菜 —— 两盘夹具里都用它当「库内菜那一半」 */
const RICE_DISH = { foodId: 'rice', name: '米饭', grams: 150 }

recognize.setPending({ slot: '午餐', engine: 'agent', items: [PLAN_WEB_DISH, RICE_DISH] })
const webPlanHtml = renderResult()
const webCard = cardWith(webPlanHtml, '怎么吃')
const webRows = listRowsOf(webCard)
check(
  '**联网估算的菜在卡上有自己的一行**(行数 = 菜品卡的道数)',
  webRows !== null &&
    webRows.length === 2 &&
    webRows[0].includes('米饭') &&
    webRows[1].includes('酱爆茄子'),
  (webRows ?? []).map((r) => r.match(AMOUNT_NAME)?.[1] ?? '?').join(' / ') || '没切到',
)
/*
  那一行**没有档位胶囊**。判据是 `AMOUNT_CHIP`(按文字找)而**不是**「行里没有
  `leading-[15.93px]`」—— 挂在那一行上的建议块里那个**依据角标**用的正是那一档
  字号,照类名找会一路抠错(这个坑在本文件上面 `AMOUNT_CHIP` 的注释里写着)。

  没有胶囊是**对的**:库外菜查不到档,「多吃/适量吃」编不出来。宁可这一行空着。
*/
/*
  判据是两层,缺一不可:
   · **文字层** —— 那一行里没有「多吃/适量吃/少喝/别吃」这几个词(`AMOUNT_CHIP`);
   · **结构层** —— 那一行里连**胶囊壳**都没有(`CHIP_HTML`)。
  只断文字层会漏掉一种真实的坏法:类型上给库外菜安一个档、而 `tag` 是空的,
  屏上会多出一个**空心胶囊** —— 文字层照样绿(壳里没字),而那是个看得见的坏样子。
  结构层那对类名是胶囊独有的(依据角标是 `shrink-0 rounded-full border bg-card
  px-2 py-0.5`,中间隔着 `border bg-card`)。
*/
const CHIP_HTML = /shrink-0 rounded-full px-2 py-0\.5/g
check(
  '**那一行没有档位胶囊**(库外菜没有档,编不出来)',
  // ⚠️ `=== null` 不是 `=== undefined` —— `String.match` 抠不到时返回的是 `null`,
  // 写成 `undefined` 这一条**永远是红的**,而证据那一行看着完全正常。实测踩过。
  webRows !== null &&
    webRows[1].match(AMOUNT_CHIP) === null &&
    (webRows[1].match(CHIP_HTML) ?? []).length === 0 &&
    webRows[0].match(AMOUNT_CHIP)?.[2] === '适量吃',
  webRows === null
    ? '没切到'
    : webRows.map((r) => r.match(AMOUNT_CHIP)?.[2] ?? '(无胶囊)').join(' / '),
)
check(
  '**那一行的第二行恰好是它的出处 ×「联网估算 · 按你确认的分量」**',
  (webRows?.[1] ?? '').match(AMOUNT_TEXT)?.[1] === '联网估算 · 按你确认的分量',
  (webRows?.[1] ?? '').match(AMOUNT_TEXT)?.[1] ?? '没抠到第二行',
)
/*
  ⚠️ **判据又翻了一次(2026-09-23),这次是同一个理由的最后一处。**

  原来这里断的是「点名了库外菜的那条建议,画在那道菜自己那一行里」—— 那一版
  把「这一餐的钠主要来自『酱爆茄子』」挂进了酱爆茄子那一行。可它说的是**整餐**
  的事,挂进行里就会和那一行的档位打架(多吃 vs 钠主要来自它)。所以库外菜有行
  这个收益保留,但**建议的位置改回卡尾**。

  判据仍然看「在不在那一行的 `<li>` 里」,只是期望值反了:一行都不该有,
  而整张卡里必须有 —— 否者是把建议弄丢了,不是挪了位置。
*/
check(
  '**那条建议不画在任何一行里,留在卡尾**(库外菜那一行也没例外)',
  (webRows ?? []).every((r) => !r.includes('本餐钠约')) && webCard.includes('本餐钠约'),
  `挂到 ${(webRows ?? []).filter((r) => r.includes('本餐钠约')).length} 行 / 卡里有=${webCard.includes('本餐钠约')}`,
)
check(
  '  (锚点)那道菜本身还在这一页上(菜品卡里那一条)',
  webPlanHtml.includes('酱爆茄子') && webPlanHtml.includes('识别菜品'),
)

/* 哨兵项那一行的第二行是**另一句话** —— 两种库外菜不问同一件事,别并成一支 */
recognize.setPending({ slot: '午餐', engine: 'agent', items: [PLAN_SENTINEL, RICE_DISH] })
const sentinelPlanHtml = renderResult()
const sentinelPlanCard = cardWith(sentinelPlanHtml, '怎么吃')
const sentinelPlanRows = listRowsOf(sentinelPlanCard)
check(
  '**哨兵项那一行的第二行恰好是「不在食物库里 · 按 0 计」**(不是「联网估算」)',
  sentinelPlanRows !== null &&
    sentinelPlanRows.length === 2 &&
    sentinelPlanRows[1].includes('清炒藕片') &&
    sentinelPlanRows[1].match(AMOUNT_TEXT)?.[1] === '不在食物库里 · 按 0 计',
  (sentinelPlanRows?.[1] ?? '').match(AMOUNT_TEXT)?.[1] ?? '没抠到第二行',
)

/* ---------- ⑦b 一屏全是库外菜:行照出,而量词那条脚注不出现 ---------- */
/*
  联网估算的菜**算得出营养**,所以 `hasItems` 为真、卡照常出、两行都在。
  但屏上**一个量词都没有** —— 「一捧量蔬菜、一个掌心量肉…」那条脚注署的是
  量词,而这两行的第二行写的是出处。署它就是「引用比依据**大**」。

  ⚠️ 判据**不能**再是 `plan.rows.length > 0`(上一版就是它):库外菜有行之后
  那个条件在这里为真,而屏上一个量词都没有。
*/
recognize.setPending({
  slot: '午餐',
  engine: 'agent',
  items: [PLAN_WEB_DISH, { ...PLAN_WEB_DISH, foodId: 'web:蒜蓉粉丝娃娃菜', name: '蒜蓉粉丝娃娃菜' }],
})
const allWebHtml = renderResult()
const allWebCard = cardWith(allWebHtml, '怎么吃')
const allWebRows = listRowsOf(allWebCard)
check(
  '  (锚点)这一屏确实出了卡、两行都在(否则下面那条是「卡没出来」的假象)',
  allWebRows !== null && allWebRows.length === 2,
  CARD_LABELS(allWebHtml),
)
check(
  '**一屏全是联网估算的菜时,量词那条脚注不出现**(屏上没有一个量词)',
  allWebCard !== null && !allWebCard.includes('一捧量蔬菜'),
  allWebCard === null ? '没切到' : allWebCard.match(/一捧量蔬菜/) ? '它在' : '不在',
)

/* ---------- ⑧ 一条建议都没有的餐盘 ---------- */
/*
  豆腐 + 菠菜 + 米饭:蔬菜有、蛋白 32%、钠 30%、糖 0 —— 每条规则都够不着。
  这句空态原来挂在建议卡的卡尾,跟着那张卡搬进了新卡。
*/
recognize.setPending({
  slot: '午餐',
  engine: 'agent',
  items: [
    { foodId: 'tofu-firm', name: '北豆腐', grams: 100 },
    { foodId: 'spinach-garlic', name: '蒜蓉菠菜', grams: 200 },
    { foodId: 'rice', name: '米饭', grams: 100 },
  ],
})
const quietHtml = renderResult()
const quietCard = cardWith(quietHtml, '怎么吃')
check(
  '**一条建议都没有时,那句空态照旧出现**(它原来是建议卡的空态)',
  quietCard !== null && quietCard.includes('这一餐各项都在目标区间内'),
  // ⚠️ 证据要**报实情**:写成 `: '没有那句'` 的话,这条通过时也会打印「没有那句」,
  // 一条通过却印着反话的断言比一条红的更危险(同 `readouts()` 上面那段)。
  quietCard === null ? '没切到这张卡' : quietCard.match(/这一餐[^<]*/)?.[0] ?? '没有那句',
)
// 锚点:上面那条在「整张卡不出现」时也会假绿,所以钉住这一屏确实出了卡和三行
check(
  '  (锚点)这一屏的三行和两条脚注照常渲染(空态不是「卡没出来」的假象)',
  listRowsOf(quietCard)?.length === 3 &&
    quietCard !== null &&
    quietCard.includes('菜和肉摆在主食前面') &&
    quietCard.includes('一捧量蔬菜'),
  CARD_LABELS(quietHtml),
)

/* ---------- ⑨ 分类未知的菜 ---------- */
recognize.setPending({
  slot: '午餐',
  engine: 'agent',
  items: [{ foodId: 'unmatched:清炒藕片', name: '清炒藕片', grams: 0 }],
})
const sentinelHtml = renderResult()
/*
  ⚠️ **这条断言的机制在合并时换了,别再照旧读它。** 原来它验的是
  `deriveEatingAmount` 对哨兵项吐不出行(当时那张卡的守卫是 `amount.length > 0`);
  合并后这张卡的守卫是 `hasItems`,而哨兵项的 `grams` 是 0、被 `countableItems`
  整个排除掉 —— **卡压根不渲染**,轮不到行列表说话。

  两条行为都对,但断的是两件事:`why` 不跟着改的话,这条断言看起来在验「安不了
  一个量」,实际验的是「哨兵项不算一餐」—— 而「弄坏 `deriveEatingAmount` 让它给
  库外菜安一个量」那一刀对它就是**空操作**(实测:照旧绿)。
*/
check(
  '**一盘全是哨兵项时整张卡不出现**(`hasItems` 为假 —— 哨兵项算不出营养)',
  cardWith(sentinelHtml, '怎么吃') === null,
  CARD_LABELS(sentinelHtml),
)
/*
  锚点:同上,切不到时上面那条对白屏也成立。
  ⚠️ 这里**不能**锚「健康建议」—— 全是哨兵项时 `hasItems` 是假的,结论/营养/
  建议三张卡整组不渲染(它们都以 `countable` 为准)。锚的是这一屏真正的样子:
  菜品卡还在、那道菜的名字还在,给的是「从食物库记下这一餐」那条出路。
*/
check(
  '  (锚点)这一屏本身是渲染出来了的(菜品卡 + 那道菜 + 手动记的出路)',
  sentinelHtml.includes('识别菜品') && sentinelHtml.includes('清炒藕片') && sentinelHtml.includes('从食物库记下这一餐'),
)

recognize.setPending(null)

/* ============================================================
   确认分量 —— 出结果前那一步
   ------------------------------------------------------------
   这一屏是**必经**的,所以它的三种形态都必须有内容:
   有菜(逐菜三档 + 默认常规)、没菜(空状态 + 出路)、降级(挂横幅 + 不显示照片)。
   ============================================================ */

console.log('\n=== 确认分量 ===')
const portion = await server.ssrLoadModule('/src/screens/PortionScreen.tsx')

const renderPortion = () =>
  renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: ['/portion'] }, React.createElement(portion.default))
  )

// ① 没有待确认的餐 —— 刷新 / 直接打开这一页
check('没有 pending 时给空状态而不是白屏', renderPortion().includes('没有待确认的餐'))
check('空状态给出回首页的出路', renderPortion().includes('回首页拍一餐'))

/* ---------- ② 有两道可称的菜 ----------
 * 用米饭(150g)和炒花生(30g):两个的「常规」正好是库里的默认克数,
 * 而且量级差得远,克数写错会立刻看出来。
 */
recognize.setPending({
  slot: '午餐',
  items: [
    { foodId: 'rice', name: '米饭', grams: 150 },
    { foodId: 'peanut', name: '炒花生', grams: 30 },
  ],
  engine: 'agent',
  photoUrl: 'blob:portion-preview',
  agentReply: notBlocked,
})
const portionHtml = renderPortion()

check('两道菜都列出来了', portionHtml.includes('米饭') && portionHtml.includes('炒花生'))
check('说了识别到几道菜', portionHtml.includes('识别到 2 道菜'))
check('真实识别时显示用户拍的那张图', portionHtml.includes('blob:portion-preview'))
check('没有降级说明', !portionHtml.includes('不是识别结果'))
check('克数按「常规」显示', portionHtml.includes('约 150g') && portionHtml.includes('约 30g'))

/**
 * 三档控件必须**每组一个、整组一个 tab 站**。
 * `aria-checked="true"` 只该有一项 —— 每组两个选中就是渲染逻辑错了。
 */
const radioCount = (portionHtml.match(/role="radio"/g) ?? []).length
const checkedCount = (portionHtml.match(/aria-checked="true"/g) ?? []).length
const groupCount = (portionHtml.match(/role="radiogroup"/g) ?? []).length
check('每道菜三个档位', radioCount === 6, String(radioCount))
check('每道菜恰好一个选中项', checkedCount === 2, String(checkedCount))
check('每道菜一个 radiogroup', groupCount === 2, String(groupCount))
/**
 * 默认档必须是「常规」,而且是**每一组**都默认常规 —— 快速路径靠的就是
 * 进来直接按主按钮,不用做任何判断。
 */
const normalSelected = (portionHtml.match(/<button[^>]*aria-checked="true"[^>]*>常规<\/button>/g) ?? []).length
check('**每组默认选中「常规」**', normalSelected === 2, `${normalSelected} 组`)
/**
 * 无障碍的一组必须有名字,否则读屏用户在一屏里听到几组「少量/常规/多量」,
 * 分不清在哪一行。改之前这个控件一点 ARIA 都没有。
 */
check('每组有无障碍名字', portionHtml.includes('米饭分量') && portionHtml.includes('炒花生分量'))
check('有「看分析结果」主按钮', portionHtml.includes('看分析结果'))
check('**这一屏不归档**(归档仍然在结果页)', !portionHtml.includes('归档到膳食日记'))

/* ---------- ③ 有未收录的菜 ----------
 * 列出来但不可点。不列的话,用户拍了三道菜只看见两行,会以为 App 漏了一道。
 */
recognize.setPending({
  slot: '午餐',
  items: [...RICE, { foodId: 'unmatched:豆腐菌菇汤', name: '豆腐菌菇汤', grams: 0 }],
  engine: 'agent',
  unmatched: ['豆腐菌菇汤'],
  agentReply: notBlocked,
})
const portionUnmatchedHtml = renderPortion()
check('未收录的菜也列出来', portionUnmatchedHtml.includes('豆腐菌菇汤'))
check('明说它按 0 计', portionUnmatchedHtml.includes('按 0 计'))
// 只有可称的那一道菜有控件 —— 未收录的菜不该出现三档
check('**未收录的菜没有三档控件**', (portionUnmatchedHtml.match(/role="radiogroup"/g) ?? []).length === 1)
check('只数可称的菜', portionUnmatchedHtml.includes('识别到 1 道菜'))

/* ---------- ③b 有联网查到营养的库外菜 ----------
 * 这一屏的真问题是**它有没有控制点**。web 项没有 `defaultGrams` ——
 * 它的 150g 是 `WEB_BASE_GRAMS` 这个兜底常量,不是从库里查来的,
 * 所以它比库内菜**更**需要用户过一遍手。要是它没进 `countable`,
 * 用户就会在这一屏看见一道没有任何控件的菜,而结果页却照常把它算进合计 ——
 * 「这道菜的份量是怎么定的」全 App 无人能答。
 *
 * 判据是 `countableItems`,也就是 `!isUnmatchedId` —— 这正是新开一个前缀
 * 而不是把哨兵改宽的收益:这里一行代码都不用改,web 项自动有控件。
 * 下面那条「识别到 2 道菜」把这件事变成机器可验的。
 */
const { WEB_BASE_GRAMS } = await server.ssrLoadModule('/src/lib/dishMatch.ts')

recognize.setPending({
  slot: '午餐',
  items: [...RICE, WEB_DISH, { foodId: 'unmatched:豆腐菌菇汤', name: '豆腐菌菇汤', grams: 0 }],
  engine: 'agent',
  unmatched: ['豆腐菌菇汤'],
  agentReply: notBlocked,
})
const portionWebHtml = renderPortion()

check('web 项有独立的一行', portionWebHtml.includes('土豆炖牛肉'))
check('**web 项照常有三档控件**(不是只列出来不可点)', (portionWebHtml.match(/role="radiogroup"/g) ?? []).length === 2,
  String((portionWebHtml.match(/role="radiogroup"/g) ?? []).length))
check('**「识别到 N 道菜」把 web 项数进去**(哨兵项不算)', portionWebHtml.includes('识别到 2 道菜'))
check('  默认「常规」就是基准 150g', portionWebHtml.includes(`约 ${WEB_BASE_GRAMS}g`))
check('  行内 kcal 不再显示 0', portionWebHtml.includes('约 150g · 252 kcal'))
check('页面级细字把 web 项的基准说清楚', portionWebHtml.includes(`联网查到营养的菜按一份约 ${WEB_BASE_GRAMS}g 起算`))

/**
 * 那半句**只在真有 web 项时**才出现 —— 这一屏平时就两道三道菜,
 * 多解释一个屏幕上不存在的东西只会让人去找它在哪。
 * 断言用的 `portionHtml` 是上面 ② 那个夹具(米饭 + 炒花生,都不带联网营养)。
 */
check('**没有 web 项时不说这句**', !portionHtml.includes('联网查到营养的菜'))

/* ---------- ④ 降级路径 ----------
 * 用户的选择是「降级也走这一步」,所以这一屏必须同时满足两条:
 * 挂「演示数据」横幅(**别把编出来的菜当真结果**),
 * 且不显示用户拍的那张照片(把真照片摆在这些菜旁边 = 暗示因果关系)。
 */
recognize.setPending({
  slot: '午餐',
  items: RICE,
  engine: 'demo',
  degradedReason: '未配置 Dify Key，本次为演示数据',
})
const portionDemoHtml = renderPortion()
check('降级时明说这一屏是演示数据', portionDemoHtml.includes('不是识别结果'))
check('**降级时不显示用户拍的照片**', !portionDemoHtml.includes('blob:'))
check('降级时照样能确认分量', portionDemoHtml.includes('看分析结果'))

recognize.setPending(null)

/* ============================================================
   确认分量 → 结果页:克数真的落地了吗
   ------------------------------------------------------------
   这是整个功能唯一真正重要的接缝。确认页写的是 `pending.items[].grams`,
   而结果页整个从 `pending` 渲染(`nutritionOfItems` + `deriveAdvice`)——
   顺序错了、或者写到别的对象上,屏幕上就会是一份和用户选择无关的数字,
   而**看起来完全正常**。

   这里直接照确认页 `confirm()` 的写法走一遍,把结果页渲染出来对数:
   米饭 150g = 174 kcal,90g = 104,225g = 261。
   ============================================================ */

console.log('\n=== 确认分量 → 结果页 ===')
const { portionItems } = await server.ssrLoadModule('/src/lib/portion.ts')

const RICE_MEAL = { slot: '午餐', items: [{ foodId: 'rice', name: '米饭', grams: 150 }], engine: 'agent' }

/** 照 PortionScreen 的 confirm() 走一遍,再渲染结果页 */
const confirmWith = (draft) => {
  recognize.setPending({
    ...RICE_MEAL,
    items: portionItems(RICE_MEAL.items, draft, RICE_MEAL.engine),
    portionConfirmed: true,
  })
  return renderResult()
}

// totalKcal 定义在上面(结果页各节的开头),③d 也用它

const okHtml = confirmWith({ rice: 'normal' })
check('什么都不点直接确认:克数不变(150g)', readouts(okHtml).includes('150g'), readouts(okHtml).join('/'))
check('  热量也和以前完全一样(174 kcal)', totalKcal(okHtml) === 174, String(totalKcal(okHtml)))

const smallHtml = confirmWith({ rice: 'small' })
check('改成「少量」 → 90g', readouts(smallHtml).includes('90g'), readouts(smallHtml).join('/'))
check('  热量跟着降到 104 kcal', totalKcal(smallHtml) === 104, String(totalKcal(smallHtml)))

const largeHtml = confirmWith({ rice: 'large' })
check('改成「多量」 → 225g', readouts(largeHtml).includes('225g'), readouts(largeHtml).join('/'))
check('  热量跟着涨到 261 kcal', totalKcal(largeHtml) === 261, String(totalKcal(largeHtml)))
check('走过这一步才说「分量由你选择」', largeHtml.includes('分量由你选择'))

/*
 * 演示路径的基准是库里的默认克数,所以「常规」会把抖动出来的噪声**收敛**到
 * 一个确定的数 —— 同一盘菜照两次,「常规」给的是同一个克数。
 */
recognize.setPending({
  slot: '午餐',
  items: [{ foodId: 'rice', name: '米饭', grams: 140 }],
  engine: 'demo',
  degradedReason: '未配置 Dify Key，本次为演示数据',
})
const demoConfirmed = portionItems(
  recognize.getPending().items,
  { rice: 'normal' },
  'demo'
)
check('演示路径的「常规」收敛到库里的 150g(不受抖动影响)', demoConfirmed[0].grams === 150,
  String(demoConfirmed[0].grams))

recognize.setPending(null)

/* ============================================================
   日记里的缩略图
   ------------------------------------------------------------
   照片存进了 localStorage(以 data URL 的形式),日记列表要把图标
   换成那张图。写进去和读出来是两条路径,这里验的是后者。
   ============================================================ */

console.log('\n=== 日记缩略图 ===')
// store 模块在文件开头已经加载过(ssrLoadModule 会缓存),直接用那一个
store.addMeal({
  slot: '午餐',
  items: RICE,
  source: '拍餐盘',
  thumb: 'data:image/jpeg;base64,DIARYTHUMB',
})

const diary = await server.ssrLoadModule('/src/screens/DiaryScreen.tsx')
const diaryHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/diary'] }, React.createElement(diary.default))
)
check('日记渲染出那张缩略图', diaryHtml.includes('DIARYTHUMB'))
check('缩略图用的是 img 而不是图标位', /<img[^>]+DIARYTHUMB/.test(diaryHtml))

/* ============================================================
   日记里的幽灵条目警告
   ------------------------------------------------------------
   逻辑层由 verify-loop 那一节管(会响 / 不乱响),这里验的是**它有没有
   真的接到界面上**。上一次的教训正是这个:字段丢在中间层,逻辑测试全绿,
   而屏幕上什么都不会发生。
   ============================================================ */

console.log('\n=== 日记幽灵条目警告 ===')

const renderDiary = () =>
  renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: ['/diary'] }, React.createElement(diary.default))
  )

// ① 正常状态下**不该**出现 —— 这张卡是个真警报,不能变成常驻装饰
const cleanHtml = renderDiary()
check('正常记录下不出现幽灵警告', !cleanHtml.includes('不在食物库里'), '(种子数据零幽灵,见 verify-loop)')

/*
 * ② 塞两条库里没有的记录 —— 刻意用**同一个 foodId 记两餐**,因为
 *    「条目数」和「菜数」只有在那种情况下才分叉,而这正是文案最容易
 *    印出两个互相打架的数字的地方。
 */
const ghostA = store.addMeal({
  slot: '晚餐',
  items: [{ foodId: 'ghost-dish-xyz', name: '试验下架菜', grams: 100 }],
  source: '手动记录',
})
const ghostB = store.addMeal({
  slot: '下午加餐',
  items: [{ foodId: 'ghost-dish-xyz', name: '试验下架菜', grams: 100 }],
  source: '手动记录',
})
const ghostHtml = renderDiary()
check('幽灵记录出现后卡片也出现', ghostHtml.includes('不在食物库里'))
check('卡片点名了是哪道菜(用记录里冗余的名字)', ghostHtml.includes('试验下架菜'))
check(
  '卡片解释了数字的后果,不只是报一个错',
  ghostHtml.includes('按 0 计') && ghostHtml.includes('偏低'),
)
/**
 * 一张卡上两个都叫「N 项」的数字,会在同一道菜记了两餐时当场对不上
 * (这里是 2 项记录 / 1 道菜),而用户只会以为其中一个写错了。
 * 所以断言**整张卡只有一个** `数字 + 项`。
 *
 * 按**标记**切卡,不按文案切 —— 第一版写的是 `slice(indexOf('不在食物库里'),
 * indexOf('偏低'))`,而「偏低」在前面的文案里就出现过,切出来是空串,
 * 于是断言拿到空数组、什么也没验。按文案取边界等于把断言建在文案上。
 */
const cardsOnDiary = ghostHtml.split('border-warn-line').slice(1)
const ghostCard = cardsOnDiary.find((c) => c.includes('不在食物库里')) ?? ''
const countsOnCard = ghostCard.match(/\d+ 项/g) ?? []
check(
  '卡片上只有一个「N 项」(两个同名数字会互相打架)',
  countsOnCard.length === 1,
  countsOnCard.join(' / ') || '(一个都没有)',
)
check('那个数字是条目数(2 餐 = 2)', countsOnCard[0] === '2 项', countsOnCard[0])

// ③ 删掉之后必须消失 —— 否则上面那条「会出现」可能只是渲染了同一份缓存
store.deleteMeal(ghostA.id)
store.deleteMeal(ghostB.id)
const recheckHtml = renderDiary()
check('删掉那两条记录后卡片消失', !recheckHtml.includes('不在食物库里'))

/*
 * ④ 幽灵卡和健康警示是**两张不同的卡**,不能互相顶掉。
 *
 * 这里必须比**数量**,不能断言某句固定文案还在 —— 那样写出来的是一条
 * 永远为真的空断言(比如「页面里还有『餐次记录』四个字」),绿着但什么
 * 都没验。比数量才验得动「多加一张卡时有没有挤掉另一张」。
 */
const warnCards = (html) => (html.match(/border-warn-line/g) ?? []).length
check(
  '幽灵卡是**追加**的,没有顶掉健康警示',
  warnCards(ghostHtml) === warnCards(cleanHtml) + 1,
  `健康警示 ${warnCards(cleanHtml)} 张 → 加幽灵后 ${warnCards(ghostHtml)} 张`,
)
check('移走幽灵后卡数回到原样', warnCards(recheckHtml) === warnCards(cleanHtml), `${warnCards(recheckHtml)} 张`)

/* ============================================================
   Agent 回复卡片
   ------------------------------------------------------------
   这个 agent 把 JSON 当回答文本吐出来,所以最容易出的故障是
   「解析没命中 → 卡片渲染成空壳」或「没解析 → 把原始 JSON 糊到屏幕上」。
   两条都在这里挡掉。
   ============================================================ */

console.log('\n=== Agent 回复卡片 ===')

const { AgentReplyCard } = await server.ssrLoadModule('/src/components/AgentReplyCard.tsx')

const renderCard = (reply) => renderToStaticMarkup(React.createElement(AgentReplyCard, { reply }))

/*
  块标题那一行的写法 —— 用它把「块标题」和「胶囊 / 徽章」分开。

  ⚠️ 为什么要这么绕:`'推荐'` 这个词在卡片上出现**两次**用途完全不同的地方 ——
  菜品块的兜底标题,和每道菜的胶囊(`推荐` / `慎选`)。只断言
  `!html.includes('>推荐</span>')` 的话,一道菜的回复会让它**永远红**;
  反过来,如果哪天胶囊改回别的词,同一句断言又会在标题被兜底词盖掉时**假绿**。
  锚到标题那一行的固定类名上,这两种错配就都不会发生。
*/
const CARD_BLOCK_TITLE = 'font-medium text-muted">'

/** 餐盘/食谱:三条菜 + 建议 */
const plateReply = {
  blocked: false,
  risk: { level: 'low', message: '午餐钠含量较高,晚餐建议清淡。', items: [] },
  mode: 'plate',
  title: '晚餐搭配建议',
  dishes: [
    { name: '清蒸鲈鱼', suitable: true, reason: '优质低脂蛋白。', recipe: [], healthModification: '' },
    { name: '红烧肉', suitable: false, reason: '高油高盐。', recipe: [], healthModification: '' },
  ],
  ...NO_EXTRA_BLOCKS,
  advice: ['先吃蔬菜,再吃蛋白质,最后吃主食。', '全天饮水 1500ml 以上。'],
  disclaimer: '本建议仅供参考。',
}

const plateHtml = renderCard(plateReply)
check('渲染出菜名', plateHtml.includes('清蒸鲈鱼') && plateHtml.includes('红烧肉'))
/*
  每道菜的胶囊是「推荐 / 慎选」。
  ⚠️ 锚点必须带上 `</span>`:块头那颗**整块结论**徽章里有「含慎选项」,它天生
  带着「慎选」两个字 —— 只 `includes('慎选')` 的话,把每道菜的胶囊改回「不宜」
  而块头徽章还在,这条断言照样绿(这正是 `:1782` 那条踩过的坑的同款)。
*/
check(
  '每道菜的胶囊是「推荐 / 慎选」两种标记',
  plateHtml.includes('>推荐</span>') && plateHtml.includes('>慎选</span>'),
  plateHtml.includes('适宜') || plateHtml.includes('不宜') ? '旧词还在' : ''
)
check(
  '**有慎选项时块头是「含慎选项」**',
  plateHtml.includes('>含慎选项</span>') && !plateHtml.includes('全部适合当前档案'),
)
check('渲染出建议正文', plateHtml.includes('全天饮水 1500ml 以上'))
check('渲染出风险说明', plateHtml.includes('晚餐建议清淡'))
check('渲染出免责声明(前面那个 ⚠ 也一起 —— 照膳享+ 那张卡)', plateHtml.includes('⚠ 本建议仅供参考'))
/*
  `title` 归**菜品块**,建议块退回固定文案。
  以前 `title` 是建议块的标题 —— 换块之后如果两处都还印着它,同一句话会在两个
  块头上各出现一次,读起来像有两份结论。所以数它出现的**次数**:正好一次。
*/
check(
  '**模型给的标题只出现一次(归菜品块,不再同时当建议块标题)**',
  plateHtml.split('🍽 晚餐搭配建议').length - 1 === 1,
  `${plateHtml.split('🍽 晚餐搭配建议').length - 1} 次`
)
check('建议块的标题是固定文案「💡 进食建议」', plateHtml.includes(`${CARD_BLOCK_TITLE}💡 进食建议</span>`))
check('写死的块名「涉及菜品 / 推荐搭配」已经不在界面上了', !plateHtml.includes('涉及菜品') && !plateHtml.includes('推荐搭配'))
check('每道菜的旧词「适宜 / 不宜」一个都不剩', !plateHtml.includes('适宜') && !plateHtml.includes('不宜'))
check('没有把原始 JSON 漏到屏幕上', !plateHtml.includes('"blocked"') && !plateHtml.includes('\\"'))
/*
  序号徽章在**两个地方**用同一个组件:这张卡的建议 1、2、3,和结果页「进食顺序」
  卡的第几步。两边都断一次 —— 只断一边的话,「提取时改坏类名」在另一边静默通过。
  `NUMBER_BADGE` 是上面手写的常量,不是从 `NumberBadge` 里读的(那会恒真)。
*/
check('**对话页这张卡的序号徽章是同一个写法**', plateHtml.includes(NUMBER_BADGE), NUMBER_BADGE)
check(
  '  两条建议就是两个徽章',
  plateHtml.split(NUMBER_BADGE).length - 1 === 2,
  `${plateHtml.split(NUMBER_BADGE).length - 1} 个`,
)

/** 过敏拦截:没有 result,风险信息就是全部 */
const blockedHtml = renderCard({
  blocked: true,
  risk: { level: 'high', message: '宫保鸡丁常含花生,与你的过敏原冲突。', items: ['花生'] },
  mode: '',
  title: '',
  dishes: [],
  ...NO_EXTRA_BLOCKS,
  advice: [],
  disclaimer: '',
})
check('拦截卡说明已拦截', blockedHtml.includes('已为你拦截'))
check('拦截卡标出过敏原', blockedHtml.includes('花生'))

/*
  ---------- 拦截降级之后的样子(2026-09-24) ----------

  用户的原话:「不要硬拦截,就是**第一条**明显的提醒,然后**后面的菜该怎么吃
  就怎么吃**」。「第一条」说的是**位置** —— 所以这段盯的是两样东西的先后。

  ⚠️ 判据必须是**两个下标比大小**,不能是「两样都在不在」:两样都在、而那条
  冲突被排到菜下面,屏幕上读起来是另一件事(先讲今晚吃什么,末尾补一句
  「对了这里面有花生」)。而这一屏的全部要点就是那句提醒**先被读到**。
*/
const demotedHtml = renderCard({
  blocked: false,
  risk: { level: 'high', message: '这盘里有花生，你的档案里写着花生过敏。', items: ['花生'] },
  mode: 'plate',
  title: '这餐怎么吃',
  dishes: [
    { name: '宫保鸡丁', suitable: false, reason: '含花生。', recipe: ['热锅下油'], healthModification: '' },
    { name: '清炒时蔬', suitable: true, reason: '清淡少油。', recipe: [], healthModification: '' },
  ],
  ...NO_EXTRA_BLOCKS,
  advice: ['宫保鸡丁别动，其它的照常吃。'],
  disclaimer: '本建议仅供参考。',
})
const demotedRiskAt = demotedHtml.indexOf('花生过敏')
const demotedDishAt = demotedHtml.indexOf('宫保鸡丁')
check(
  '**那条冲突排在菜前面**(顶上一条提醒，然后才是这些菜怎么吃)',
  demotedRiskAt >= 0 && demotedDishAt >= 0 && demotedRiskAt < demotedDishAt,
  `提醒 @${demotedRiskAt} / 第一道菜 @${demotedDishAt}`
)
check(
  '既然是「明显的」提醒,等级就得是高 —— 掉成「提示」那张灰条就不明显了',
  demotedHtml.includes('高风险'),
  demotedHtml.match(/高风险|需注意|风险较低|提示/)?.[0] ?? '一个等级词都没有'
)
check(
  '**而后面的菜照常画全了**(降级不是把卡掏空,只是把「拦截」那句话说成提醒)',
  demotedHtml.includes('宫保鸡丁') && demotedHtml.includes('清炒时蔬') && demotedHtml.includes('热锅下油'),
  demotedHtml.includes('热锅下油') ? '菜和做法都在' : '菜或做法少了'
)

/**
 * risk.items 不只是过敏原 —— 实测单菜分析会返回 ["高油、高盐、潜在高糖"] 这种
 * 风险条目,而同一条回复的 level 是 low。原来的写法无条件给 items 套红底,
 * 结果就是「风险较低」标题下面挂一个红色警告标签,自相矛盾。
 * 这里盯住:低风险时 items 不许用 danger 配色。
 * 菜全部适宜,否则菜品行自己的 danger 图标会让这条断言假通过。
 */
const lowItemsHtml = renderCard({
  blocked: false,
  risk: { level: 'low', message: '油脂和钠偏高,注意搭配。', items: ['高油、高盐、潜在高糖'] },
  mode: 'dish',
  title: '改良建议',
  dishes: [{ name: '红烧排骨', suitable: true, reason: '可适量。', recipe: [], healthModification: '' }],
  ...NO_EXTRA_BLOCKS,
  advice: [],
  disclaimer: '',
})
check('低风险时 risk items 不标红', !lowItemsHtml.includes('bg-danger-bg'), lowItemsHtml.match(/bg-danger[^"]*/)?.[0] ?? '')
check('低风险时 risk items 仍然显示出来', lowItemsHtml.includes('高油、高盐、潜在高糖'))
/*
  整块结论的**另一半**:一道菜都不慎选时是「全部适合当前档案」。
  判据是 `every` 不是 `some` —— 这一条和上面 plateHtml 那条一起,把两个方向
  都钉住:只测一边的话,判据写成 `some` 会在**慎选那一侧**照样绿。
*/
check(
  '**全都 suitable 时块头是「全部适合当前档案」**',
  lowItemsHtml.includes('>全部适合当前档案</span>') && !lowItemsHtml.includes('含慎选项'),
)
check('菜品块标题用的是模型给的标题,不是写死的块名', lowItemsHtml.includes('改良建议'))

/** 单菜分析:做法步骤 + 改良说明要拆行,Markdown 粗体标记要去掉 */
const dishHtml = renderCard({
  blocked: false,
  risk: { level: 'low', message: '', items: [] },
  mode: 'dish',
  title: '红烧排骨改良',
  dishes: [
    {
      name: '红烧排骨',
      suitable: true,
      reason: '传统做法高油高糖。',
      recipe: ['冷水下锅焯水。', '炒糖色。'],
      healthModification: '1. **减糖**:冰糖减半;2. **减盐**:用低钠酱油;3. **搭配**:配绿叶菜。',
    },
  ],
  ...NO_EXTRA_BLOCKS,
  advice: [],
  disclaimer: '',
})
/*
  序号是**带圈数字**(照膳享+ 那张卡)。⚠️ 顺带守住「两步就是 ①②」——
  只断文字的话,序号那格改成什么都不影响它。
*/
check(
  '渲染出做法步骤,序号是 ①②(照膳享+ 那张卡)',
  dishHtml.includes('冷水下锅焯水') && dishHtml.includes('炒糖色') && dishHtml.includes('①') && dishHtml.includes('②')
)
check('改良说明拆成多条', dishHtml.includes('冰糖减半') && dishHtml.includes('用低钠酱油') && dishHtml.includes('配绿叶菜'))
check('编号前缀已剥掉（交给有序列表渲染）', !dishHtml.includes('>1. '))
check('粗体标记转成 <strong> 而不是露出星号', dishHtml.includes('<strong') && !dishHtml.includes('**'))
check('低风险且无说明时不占地方开风险卡', !dishHtml.includes('风险较低'))

/** 知识问答:没有菜品 */
const ingredientHtml = renderCard({
  blocked: false,
  risk: { level: 'low', message: '', items: [] },
  mode: 'ingredient',
  title: '膳食纤维的作用',
  dishes: [],
  ...NO_EXTRA_BLOCKS,
  advice: ['建议成人每日摄入 25-30 克。'],
  disclaimer: '',
})
/*
  ⚠️ 这条锚点换过一次,原因值得记下来:它原来锚的是「涉及菜品 / 推荐搭配」两个
  块名。块名改成 `title || '推荐'` 之后,**两个词都不存在了** —— 于是这条断言
  在「菜品块压根没渲染」和「菜品块渲染了但标题是兜底词」两种情况下**都绿**,
  变成一条永远通过的护栏。现在锚的是**兜底词本身**(`'推荐'`):它只在
  `reply.title` 为空时才会出现,而没有菜品时整块不渲染,所以它必须不在。
*/
check(
  '无菜品时不渲染菜品卡(锚兜底标题「推荐」)',
  !ingredientHtml.includes(`${CARD_BLOCK_TITLE}推荐</span>`) && !ingredientHtml.includes('识别到的食材'),
  ingredientHtml.includes(`${CARD_BLOCK_TITLE}推荐</span>`) ? '兜底标题出现了' : ''
)
check('仍然渲染出建议', ingredientHtml.includes('25-30 克'))

/**
 * 冰箱模式 —— 提示词里 `mode` 有五个,fridge 是其中之一。
 *
 * 以前它的标题靠 mode 二选一(「推荐搭配」/「涉及菜品」),现在一律用模型给的
 * `title`,没有才退回「推荐」。所以这条断言盯的是**标题来自数据**,而不是
 * 某个 mode 对应某句话 —— 后者正是这一轮拆掉的东西。
 */
const fridgeHtml = renderCard({
  blocked: false,
  risk: { level: 'low', message: '', items: [] },
  mode: 'fridge',
  title: '冰箱食材建议',
  dishes: [{ name: '番茄炒蛋', suitable: true, reason: '低油低盐。', recipe: [], healthModification: '' }],
  ...NO_EXTRA_BLOCKS,
  advice: [],
  disclaimer: '',
})
check('菜品块标题用的是数据里的 title', fridgeHtml.includes('冰箱食材建议'))
check('兜底文案「推荐」没有盖掉真的标题', !fridgeHtml.includes(`${CARD_BLOCK_TITLE}推荐</span>`))

/* ---------- 识别到的食材(fridge 那份原料清单) ---------- */
/*
  这一块是新加的,它和菜品块**不会同时有内容**(膳享那边 `fridge` 给食材、
  `plate` 给菜),所以用一份只有食材的夹具单独验。
  夹具里第二样**故意没有 category** —— 「有分类才印『名称 · 分类』」这条规则,
  只在有一项缺分类时才验得出来。
*/
const fridgeListHtml = renderCard({
  blocked: false,
  risk: { level: 'low', message: '', items: [] },
  mode: 'fridge',
  title: '',
  dishes: [],
  ingredients: [
    { name: '番茄', category: '蔬菜' },
    { name: '鸡蛋' },
  ],
  nutrition: { ingredients: [], labels: [], riskItems: [] },
  advice: [],
  disclaimer: '',
})
check('识别到的食材块画出来了(标题前那个图标也算这一块的样子)', fridgeListHtml.includes('🥦 识别到的食材'))
check('有分类的印成「名称 · 分类」', fridgeListHtml.includes('番茄 · 蔬菜'))
check('**没分类的只印名字,不留一个孤零零的「 · 」**', fridgeListHtml.includes('>鸡蛋</span>'))
check('菜品块没有跟着冒出来', !fridgeListHtml.includes('>推荐</span>'))

/* ---------- 营养标签(配料表 / 包装) ---------- */
const labelHtml = renderCard({
  blocked: false,
  risk: { level: 'low', message: '', items: [] },
  mode: 'ingredient',
  title: '',
  dishes: [],
  ingredients: [],
  nutrition: {
    ingredients: ['小麦粉', '植物油', '食用盐'],
    // ⚠️ 解析层给的是**数组**(`{label, value}`),不是对象 —— 这里照解析后的
    // 形状写夹具。写成对象的话,渲染层遍历它只会拿到 `[object Object]`,
    // 而这条断言会以「渲染出来了」的名义通过
    labels: [
      { label: '钠', value: '800mg' },
      { label: '能量', value: '1200kJ' },
    ],
    riskItems: ['高钠'],
  },
  advice: ['建议每次不超过 50g。'],
  disclaimer: '',
})
check('营养标签块画出来了(标题前那个图标也算这一块的样子)', labelHtml.includes('🏷 营养标签'))
check('配料表印成一行', labelHtml.includes('小麦粉、植物油、食用盐'))
check('营养成分是「项目 + 数值」两个位置', labelHtml.includes('>钠</span>') && labelHtml.includes('>800mg</span>'))
check('风险项单独一行', labelHtml.includes('风险项:高钠'))
check('三样全空时这一块整块不出现', !ingredientHtml.includes('营养标签'))

/* ---------- 端到端:从**原始回答文本**一路到屏幕上 ---------- */
/*
  ⚠️ 这一节是这整块改动的重点。上面所有夹具都是**解析之后的**形状,也就是说
  它们验的是渲染层;而这次真正容易坏的地方在**解析层** —— `parseAgentReply`
  的映射里只挑了 7 个键,`ingredients` / `nutrition` 一个都没挑。漏挑的表现是
  「上游给了数据,界面上什么都没发生」,**而且不报错**。

  这个文件里已经有**两处**同款的教训成文在 `agentReply.ts`(`foodId`、`per100g`),
  所以这一条必须从原始文本开始,穿过解析 → 渲染两层。中间任何一层漏转发都红。
*/
const { parseAgentReply } = await server.ssrLoadModule('/src/lib/agentReply.ts')

const RAW_WITH_BLOCKS = JSON.stringify({
  blocked: false,
  risk: { level: 'low', message: '', items: [] },
  result: {
    mode: 'fridge',
    title: '',
    dishes: [],
    ingredients: [
      { name: '番茄', category: '蔬菜' },
      { name: '鸡蛋' },
    ],
    // 上游给的是**对象**(膳享+ 实测如此),解析层负责把它转成有序数组 ——
    // 所以这里必须写对象,写数组就是在测一件上游不会发生的事
    nutrition: { ingredients: ['小麦粉', '食用盐'], labels: { 钠: '800mg' }, riskItems: ['高钠'] },
    advice: [],
  },
})

const parsedRaw = parseAgentReply(RAW_WITH_BLOCKS)
/*
  ⚠️ 渲染包在 try 里,是为了让**上面那两条断言有机会说话**。
  解析层漏掉这两个键时,`reply.ingredients` 是 `undefined`,而渲染层第一句就是
  `reply.ingredients.length` —— 整脚本会当场崩掉,屏幕上只有一段栈,
  底下那几条断言一条都不会打印出来(表现是「测试挂了」而不是「哪一条红了」)。
  兜住之后,同一个坏法会得到一句 `FAIL **原始回答里的 ingredients 真的被挑出来了**`
  —— 它说的正是坏在哪儿。
*/
let parsedHtml = ''
try {
  parsedHtml = parsedRaw ? renderCard(parsedRaw) : ''
} catch {
  parsedHtml = '(渲染时抛异常)'
}
check('**原始回答里的 ingredients 真的被挑出来了**(解析层没漏这个键)', parsedRaw?.ingredients?.length === 2, `${parsedRaw?.ingredients?.length ?? 'null'} 样`)
check('**原始回答里的 nutrition 真的被挑出来了**', parsedRaw?.nutrition?.labels.length === 1, `${parsedRaw?.nutrition?.labels.length ?? 'null'} 项`)
check(
  '**对象形状的营养成分被转成了有序数组,且屏幕上印出了原值**',
  parsedHtml.includes('>钠</span>') && parsedHtml.includes('>800mg</span>'),
  parsedHtml.includes('[object') ? '印成了 [object Object]' : ''
)
check('食材清单也真的画到了屏幕上', parsedHtml.includes('番茄 · 蔬菜'))
/*
  最后一条盯的是**末尾那条空壳守卫**:这份回复没有 title、没有菜品、没有建议,
  以前「三样全空 → 整份丢掉」的判据会把它当成一坨没用的 JSON 直接扔掉 ——
  而它明明有两块内容。丢掉的表现不是空块,是**整条回复不见了**。
*/
check('**只有食材和营养标签的回复不会被当成空壳丢掉**', parsedRaw !== null && parsedHtml.includes('识别到的食材'))

/* ============================================================
   建档引导 · 切换档案 · 配额的来处
   ------------------------------------------------------------
   这一节要**摆好 state 再渲染**,而不是"拿当前状态渲染一遍看看有没有崩"。
   原因和上面各节一样:断言得说得出自己在断言什么。

   注意顺序 —— 下面每一段都会改 store,所以每一段都自己声明起始状态,
   最后一段负责把 store 还原成**演示档案**,后面不再有别的渲染断言。
   ============================================================ */

console.log('\n=== 建档引导:空档案的那一屏 ===')

const renderPage = (Comp, route) =>
  renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [route] }, React.createElement(Comp)))

// 空档案 + 空日记 —— 走完建档但一餐没记,这是新用户默认看到的那一屏
store.clearAllMeals()
store.updateProfile({
  name: '',
  gender: '',
  goals: [],
  restrictions: [],
  dietaryPreferences: [],
  specialStages: [],
  chronicConditions: [],
  notes: '',
  quotaOverrides: {},
})

const blankHomeHtml = renderPage(home.default, '/')
/*
  「不出现 NaN」是这一节里最要紧的一条。
  derive.ts 的除法**没有零守卫**(`n.kcal / q.kcal`),而首页那格「配额进度」
  是无条件渲染的 —— 空档案的配额只要一路算成 0,这一屏就是 NaN%。
  配额由 quotaFor() 从一个中性体征推出来,所以它不会是 0,但这条断言
  得在,因为"空档案不该是零"这件事只在 quota.ts 的注释里写着。
*/
check('**空档案首页不出现 NaN**', !blankHomeHtml.includes('NaN'), blankHomeHtml.match(/.{0,20}NaN.{0,20}/)?.[0] ?? '')
check('空档案首页不出现 undefined', !blankHomeHtml.includes('undefined'))
check('空档案首页说「今天还没有记录」', blankHomeHtml.includes('今天还没有记录'))
check('**0 餐的健康分标了「仅供参考」**', blankHomeHtml.includes('记录不足两餐'))
check('空档案首页照样渲染出健康分', blankHomeHtml.includes('健康分'))

console.log('\n=== 建档引导 ===')
const welcome = await server.ssrLoadModule('/src/screens/WelcomeScreen.tsx')
const welcomeHtml = renderPage(welcome.default, '/welcome')

check('引导渲染出来了', welcomeHtml.includes('建立健康档案'))
check('**每一步都有「先用演示档案看看」这个出口**', welcomeHtml.includes('先用演示档案看看'))
check('第 1 步标出进度', welcomeHtml.includes('第 1 / 4 步'), '四步:基本资料 / 饮食偏好 / 身体状况 / 补充说明')
check('第 1 步没有「上一步」', !welcomeHtml.includes('上一步'))
check('第 1 步问的是称呼与体征', welcomeHtml.includes('称呼') && welcomeHtml.includes('身高'))

/*
  体征三行:值**就在行里**(带单位),而轮子**不在**首屏里 —— 它是点开才弹的。
  后一条是真正的回归守卫:轮子常驻的话这张卡会变成一根柱子(三行 ×180pt),
  而那是一种「看起来只是变长了」的坏法,不写下来没人会发现。
*/
/*
  值不写死:引导读的是 store 里当前那份档案(演示档案),不是 BLANK_PROFILE。
  断言的是**形状** —— 出生日期是「年-月-日」,身高体重要带单位。
*/
const bodyRowValue = (label) => {
  const m = welcomeHtml.match(new RegExp(`${label}</span><span class="[^"]*"><span class="[^"]*">([^<]*)</span>`))
  return m ? m[1] : null
}
const bodyValues = ['出生日期', '身高', '体重'].map(bodyRowValue)
check(
  '体征三行把当前值写在行里',
  /^\d{4}年\d{1,2}月\d{1,2}日$/.test(bodyValues[0] ?? '') &&
    bodyValues.slice(1).every((v) => /^\d+(cm|kg)$/.test(v ?? '')),
  bodyValues.join(' / ')
)
check('**首屏没有常驻的轮子**(点开才弹)', !welcomeHtml.includes('role="slider"'))
check(
  '**算出来的年龄写在说明里**(否则「自动计算」是句看不见的话)',
  /算是\s*\d+\s*岁/.test(welcomeHtml),
  '引导第 1 步底下那句'
)

/* ------------------------------------------------------------
   可自填的多选组 —— 四栏「预设 + 其他栏」
   ------------------------------------------------------------
   它在引导的第 2、3 步里,而那两步是 `WelcomeScreen` 的**内部 state**,
   `renderToStaticMarkup` 只渲一次、点不动「下一步」。所以这里直接渲染
   `ChoiceChips` 本身 —— 要验的是「自己写的词和预设摆在一起、并且能删」,
   这件事和它在哪一屏无关。

   ⚠️ 代价要说清楚:第 4 步那个「没有了 / 还有要补充的」二选一也是内部
   state,静态渲染到这里就断了。下面只验得到它用到的那个 `TextArea`,
   验不到那个分支本身。
   ------------------------------------------------------------ */
console.log('\n=== 可自填的多选组 ===')
const ui = await server.ssrLoadModule('/src/components/ui/index.tsx')
const chips = (props) => renderToStaticMarkup(React.createElement(ui.ChoiceChips, props))
const PRESET_STAGES = ['孕期', '哺乳期', '青少年', '老年', '术后康复', '术前准备']

const filled = chips({
  label: '特殊阶段',
  options: PRESET_STAGES,
  value: ['孕期', '甲状腺结节'],
  onChange: () => {},
  noneLabel: '无',
  other: { placeholder: '如「备孕」' },
})
/*
  位置本身就是说明:「自己写的词排在预设后面」,和那个 ✕ 一起表示
  「这不是预设里的,是你写的」。所以断言的是**下标先后**,不是「出现过」。
*/
check(
  '自己写的词排在全部预设之后',
  filled.indexOf('甲状腺结节') > filled.lastIndexOf('术前准备'),
  `甲状腺结节@${filled.indexOf('甲状腺结节')} / 术前准备@${filled.lastIndexOf('术前准备')}`
)
check(
  '**只有自己写的词带删除键**(预设再点一下就没了,不需要 ✕)',
  (filled.match(/aria-label="移除 /g) ?? []).length === 1 && filled.includes('aria-label="移除 甲状腺结节"')
)
check(
  '选中态写在 aria-checked 上(不是只靠背景色)',
  filled.includes('role="checkbox"') && filled.includes('aria-checked="true"') && filled.includes('aria-checked="false"')
)
// 「其他栏」在不在,是这四栏和忌口那类栏目的分界 —— 所以它得是个**开关**
check('传了 other 才有输入行', filled.includes('placeholder="如「备孕」"'))

const bare = chips({ label: '慢性病', options: ['高血压', '糖尿病'], value: [], onChange: () => {}, noneLabel: '无' })
check(
  '**没传 other 就没有输入框**',
  !bare.includes('<input'),
  '忌口那类必须从给定集合里选的地方不能有这个口子'
)
check('空数组时「无」是选中态(它代表空,不是一个新选项值)', /aria-checked="true"[^>]*>无</.test(bare))

const capped = chips({ label: '健康目标', options: ['减脂', '增肌'], value: ['减脂'], onChange: () => {}, max: 1 })
check('到上限后剩下的选项变灰', capped.includes('opacity-40') && capped.includes('aria-checked="false"'))

console.log('\n=== 补充说明那块输入 ===')
const notesArea = renderToStaticMarkup(
  React.createElement(ui.TextArea, {
    label: '补充说明',
    value: '在吃二甲双胍，医生让少喝汤',
    onChange: () => {},
    placeholder: '想到什么写什么，留空也没关系',
    maxLength: 500,
    rows: 5,
  })
)
check('是多行输入,不是单行 input', notesArea.includes('<textarea') && !notesArea.includes('<input'))
check('带标签', notesArea.includes('补充说明'))
check(
  '**长度上限接到了控件上**',
  /maxlength="500"/i.test(notesArea),
  '否则「最多 500 字」就只是一句说明'
)

console.log('\n=== 体征滚轮面板 ===')
const picker = await server.ssrLoadModule('/src/components/PickerSheet.tsx')
const birth = { year: 1998, month: 3, day: 20 }
const body = { birth, height: 165, weight: 55 }
const birthSheetHtml = renderToStaticMarkup(
  React.createElement(picker.BodyPicker, { field: 'birth', value: body, onChange: () => {}, onClose: () => {} })
)
check('出生日期面板带着标题和「完成」', birthSheetHtml.includes('出生日期') && birthSheetHtml.includes('完成'))
/*
  `role="slider"` 而不是 `listbox`:这个控件对读屏和键盘来说就是「在一段区间里
  选一个数」。报列表会让读屏念出 87 个选项,而且方向键的路也断了。
*/
check(
  '**年、月、日各是一个可调区间**(三个轮子)',
  (birthSheetHtml.match(/role="slider"/g) ?? []).length === 3,
  (birthSheetHtml.match(/aria-label="出生[年月日]"/g) ?? []).join(' / ')
)
check(
  '每一列都报了当前值和上下界',
  birthSheetHtml.includes('aria-valuetext="1998年"') &&
    birthSheetHtml.includes('aria-valuetext="3月"') &&
    birthSheetHtml.includes('aria-valuetext="20日"') &&
    birthSheetHtml.includes('aria-valuemin="1926"'),
  '1998年3月20日,出生年下界是今年 −100'
)
/*
  「日」那一列的档数**随年月变** —— 3 月 31 档、2 月 28/29 档。
  这条和 verify-loop 里那组闰年断言是同一件事的两个面:那边验函数,
  这边验它真的接到了控件上。
*/
/** 三个轮子一共铺了多少行(年 + 月 + 日) */
const rowsOf = (y, m) =>
  (
    renderToStaticMarkup(
      React.createElement(picker.BodyPicker, {
        field: 'birth',
        value: { ...body, birth: { year: y, month: m, day: 1 } },
        onChange: () => {},
        onClose: () => {},
      })
    ).match(/snap-center/g) ?? []
  ).length
check(
  '「日」那一列按当月天数铺(2 月不给 31 号,闰年多一天)',
  rowsOf(2026, 4) - rowsOf(2026, 2) === 2 && rowsOf(2024, 2) - rowsOf(2026, 2) === 1,
  `4 月比 2 月多 2 行(30 vs 28),闰年 2 月再多 1 行(${rowsOf(2026, 2)} / ${rowsOf(2024, 2)} / ${rowsOf(2026, 4)} 行)`
)

const heightHtml = renderToStaticMarkup(
  React.createElement(picker.BodyPicker, { field: 'height', value: body, onChange: () => {}, onClose: () => {} })
)
check(
  '身高只有一个轮子,单位进 aria-valuetext',
  (heightHtml.match(/role="slider"/g) ?? []).length === 1 && heightHtml.includes('aria-valuetext="165cm"')
)

/*
  必填缺失时那个主按钮的样式。
  取「称呼和性别要填」**之前**最后一个 `<button`,而不是整页搜那个 class ——
  整页搜的话,`pointer-events-none opacity-40` 在别的组件里也有
  (TagsInput 的「添加」),这条断言会变成一句永远为真的话。
*/
const gateIdx = welcomeHtml.indexOf('称呼和性别要填')
const gateTag = gateIdx < 0 ? '' : welcomeHtml.slice(welcomeHtml.lastIndexOf('<button', gateIdx), gateIdx)
check(
  '**称呼/性别没填时完成键不可点(pointer-events-none + 半透明)**',
  gateTag.includes('pointer-events-none') && gateTag.includes('opacity-40'),
  gateTag.slice(0, 60) || '没找到那个按钮'
)
check('完成键没用 disabled(移动端 Safari 上 disabled 看起来像坏了)', !gateTag.includes('disabled'))

console.log('\n=== 切换档案面板 ===')
store.resetToSeed()
const firstId = store.getSnapshot().activeProfileId
const sheet = await server.ssrLoadModule('/src/components/ProfileSheet.tsx')
const sheetHtml = () =>
  renderToStaticMarkup(React.createElement(sheet.ProfileSheet, { open: true, onClose: () => {} }))

const singleHtml = sheetHtml()
check('列了当前档案', singleHtml.includes('我的档案'))
check('有「新建档案」', singleHtml.includes('新建档案'))
/*
  ⚠️ 这条原来断言的是「只有一个档案时**没有**删除入口」(那时删最后一个
  是空操作)。现在反过来了:唯一那一行也有删除键,点下去 = 退回未建档。
  数的是 aria-label 而不是「删除」两个字 —— 每颗删除键的 `aria-label`
  里也含「删除」,搜字面量等于一颗按钮数两次。
*/
check(
  '**唯一那个档案也有删除入口**',
  (singleHtml.match(/aria-label="删除档案/g) ?? []).length === 1,
  '删它 = 回到建档引导'
)
check('当前档案带语义标记,不只是画一个勾', singleHtml.includes('aria-current="true"'))

const secondId = store.addProfile('第二份')
const twoHtml = sheetHtml()
check('新建之后列表里出现第二个档案', twoHtml.includes('第二份'))
check('**新建不自动切过去**', store.getSnapshot().activeProfileId === firstId)
check('两个档案时两行都能删', (twoHtml.match(/aria-label="删除档案/g) ?? []).length === 2)
check('当前档案仍然只有一个被标记', (twoHtml.match(/aria-current="true"/g) ?? []).length === 1)

console.log('\n=== 忌口面板的空态 ===')
/*
  空态原来是一张卡片:一个感叹号图标 + 「还没有填任何忌口」。

  ⚠️ **它以前一条断言都没有** —— 那个感叹号卡片整个仓库没有任何东西盯着,
  删掉它也不会有哪一条变红。用户这次报的是「忌口那里也和其他一样,没有就写无」,
  顺手把这一处也钉上。

  为什么感叹号是错的:一条忌口都没有是一份**完全正常**的档案,不是出了什么要
  提醒的事。把它画成警告,等于替用户判定「你应该填点什么」——而「还没有」三个字
  还在暗示一个他可能根本不打算完成的状态。
*/
const restrictionSheet = await server.ssrLoadModule('/src/components/RestrictionSheet.tsx')
const sheetFor = (section, profile) =>
  renderToStaticMarkup(
    React.createElement(restrictionSheet.RestrictionSheet, { open: true, onClose: () => {}, section, profile })
  )
const noRestriction = { ...store.getSnapshot().profile, restrictions: [] }
const emptySheet = sheetFor('health', noRestriction)
/* 锚点 —— 下面几条「不在」在面板整个渲染失败时会假绿 */
check('面板渲染出来了(下面几条的前提)', emptySheet.length > 1000, `${emptySheet.length} 字符`)
check('锚点:面板标题和「添加一条」都在', emptySheet.includes('过敏与用药') && emptySheet.includes('添加一条'))
check('锚点:空态下那颗键写的是「不填 + 本段的名字」', emptySheet.includes('不填过敏与用药'))
check('**空着时就写一个「无」**', emptySheet.includes('>无</span>'))
check('**不再是一张带感叹号的提示卡**(没有忌口不是异常状态)', !emptySheet.includes('还没有填任何忌口'))
check(
  '有忌口时那个「无」就不在了(它不是常驻的装饰)',
  !sheetFor('health', {
    ...noRestriction,
    restrictions: [{ item: '花生', type: 'allergy', level: '高危' }],
  }).includes('>无</span>')
)

/*
  两段是两个**能分得开的面板**。

  这是「一个面板两段」那条设计的机器版本：标题、aria-label、保存键的措辞全都
  从 `RESTRICTION_SECTIONS` 的 `entry` 派生，所以两个入口打开的东西必须各报各的
  名字。用户点了「忌口」却看见一个标题写着「过敏与用药」的面板 —— 他会
  以为点错了，然后去找另一个入口。

  ⚠️ 各自都配一条**「健康限制」不在**：那个词是这一组分段之前的名字，页面上已经
  没有它了，留着就是一块指向不存在的地方的牌子。
  红法：把面板标题写死成字符串「健康限制」。
*/
const emptyDiet = sheetFor('diet', noRestriction)
/*
  ⚠️ 期望值从 `RESTRICTION_SECTIONS` **派生**,不写第二份字面量。
  写死的话,下次改名时这条断言会和真值一起变旧 —— 而它本该红(这次
  「忌口」→「忌口与不爱吃」就是靠它红的)。
*/
const entryOf = (s) => typesModEarly.restrictionSectionShape(s).entry
const healthEntry = entryOf('health')
const dietEntryNow = entryOf('diet')
check(
  '**两个面板的标题各是各的**（都等于自己那一段的 entry，不是同一个字符串）',
  emptySheet.includes(`>${healthEntry}</span>`) &&
    emptyDiet.includes(`>${dietEntryNow}</span>`) &&
    healthEntry !== dietEntryNow,
  `${emptySheet.includes(`>${healthEntry}</span>`)} / ${emptyDiet.includes(`>${dietEntryNow}</span>`)}`
)
check(
  '**无障碍名字也跟着分段**（两个面板在无障碍树里必须可区分）',
  emptySheet.includes(`aria-label="${healthEntry}"`) && emptyDiet.includes(`aria-label="${dietEntryNow}"`)
)
/*
  ⚠️ 这两条是**名字的历史**，不是洁癖：两个词都曾经是这一组东西的名字，页面上
  已经没有它们了。留着就是一块指向不存在的地方的牌子 —— 用户照着找，找不到。
  「健康限制」是分段之前的组头；「忌口与偏好」是饮食段那个入口的旧名（2026-09-22
  改的，因为它和同一张卡上面那行字段名「饮食偏好」共享「偏好」二字）。
*/
check(
  '**两个面板里都没有「健康限制」**（那是分段之前的名字）',
  !emptySheet.includes('健康限制') && !emptyDiet.includes('健康限制')
)
check(
  '**两个面板里都没有「忌口与偏好」**（那是饮食段入口的旧名）',
  !emptySheet.includes('忌口与偏好') && !emptyDiet.includes('忌口与偏好')
)
/*
  ⚠️ 同形的第二条,名字是**刚删掉的那一个**。改名最容易漏的就是「新名字加上了、
  旧名字还留着」—— 面板标题、说明、保存键、入口行、结果页指路牌一共五处写着
  这个名字,漏一处就是同一个页面上两个说法。
  红法:把 `RestrictionSheet` 头部那段注释里的旧名… 不算 —— **注释不算**,
  断的是渲染出来的 HTML。红法是往饮食段的说明文案里塞回「不爱吃」三个字。
*/
check(
  '**两个面板里都没有「忌口与不爱吃」**（那是上一版的入口名，已经删了）',
  !emptySheet.includes('忌口与不爱吃') && !emptyDiet.includes('忌口与不爱吃')
)
check(
  '**两个保存键的措辞不一样**（空草稿时各自说清自己不填的是什么）',
  // ⚠️ 这里必须比**整名**，不能用 `不填忌口` —— 新名字「忌口与不爱吃」
  // 把旧那三个字整个包在里面，用子串比就是一条永远为真的假绿
  emptySheet.includes(`不填${healthEntry}`) &&
    emptyDiet.includes(`不填${dietEntryNow}`) &&
    !emptyDiet.includes(`不填${healthEntry}`),
  `${emptySheet.includes(`不填${healthEntry}`)} / ${emptyDiet.includes(`不填${dietEntryNow}`)}`
)

console.log('\n=== 忌口的分段:纯函数 ===')
/*
  ⚠️ 这一节存在的原因是**选择器在 SSR 里够不着**:`Row` 的类型选择器只在
  `editing === i` 时渲染,而展开是**组件内部状态** —— `renderToStaticMarkup`
  不跑 effect、点不动任何东西,上面那一节看见的永远是一个收起的面板。

  所以这些逻辑被抽成了 `store/types.ts` 里的纯函数 —— 抽出来就是为了能在这儿
  直接调。凡是不抽的,就等于永远没有断言看得见它(那个「查了分段过滤后的表 →
  后缀变空串 → 提示卡静默消失」的 bug 就是这么来的)。
*/
const typesMod = await server.ssrLoadModule('/src/store/types.ts')
const TYPE_VALUES = typesMod.RESTRICTION_TYPES.map((t) => t.value)
const optionsOf = (s) => typesMod.restrictionTypeOptions(s).map((o) => o.value)
const optHealth = optionsOf('health')
const optDiet = optionsOf('diet')

check(
  '**选择器只给本段的那几个**（给全套的话，改一下类型那一行就跳到另一张卡去）',
  optHealth.join() === 'allergy,drug' && optDiet.join() === 'taboo',
  `健康 ${optHealth.join('/')} · 饮食 ${optDiet.join('/')}`
)
/*
  ⚠️ 这一条盯的是分段那个最坏的失败:**某个类型两边都不认** → 那一行在两张卡里
  都不出现 → 用户再也看不到、也永远改不了,可它照样随档案发给工作流、照样拦菜。
  红法:把 `drug` 同时放进两段;或者让饮食段写成第二张字面量表、漏掉 `taboo`;
  或者往 `RESTRICTION_SUFFIX` 里加一个类型而不在这张表里给它安排段落。
*/
check(
  '**两段不相交，合起来正好是全部类型**（一条不重、一条不漏）',
  optHealth.every((v) => !optDiet.includes(v)) &&
    optHealth.length + optDiet.length === TYPE_VALUES.length &&
    TYPE_VALUES.every((v) => optHealth.includes(v) || optDiet.includes(v)),
  `健康 ${optHealth.length} + 饮食 ${optDiet.length} vs 全部 ${TYPE_VALUES.length}`
)
const sectionOfType = (t) => typesMod.restrictionSection({ item: 'x', type: t, level: '低危' })
check(
  '**每个类型都落在且只落在一段里**（`restrictionSection` 是个全函数）',
  TYPE_VALUES.every((t) => sectionOfType(t) === 'health' || sectionOfType(t) === 'diet') &&
    TYPE_VALUES.filter((t) => sectionOfType(t) === 'health').length === optHealth.length &&
    TYPE_VALUES.filter((t) => sectionOfType(t) === 'diet').length === optDiet.length,
  TYPE_VALUES.map((t) => `${t}→${sectionOfType(t)}`).join(' ')
)
/*
  ⚠️ 默认值这件事**只能靠手点才发现**:新加的行带着一个不在选项里的 type 时,
  `SegmentedControl` 的 `options.findIndex` 返回 -1 → 方向键失效,而且没有任何
  一个按钮拿到 `tabIndex={0}` —— 整组 Tab 都进不去、也看不出选中了什么。
  所以第二句断的是「那个默认值**真的在选项里**」,不只是「它属于本段」。
  红法:`defaultRestriction` 写死 `'allergy'`。
*/
check(
  '**新建一行的默认类型在本段的选项里**（不在的话那一组控件整组都进不去）',
  ['health', 'diet'].every((s) => {
    const d = typesMod.defaultRestriction(s)
    return (
      typesMod.restrictionSection(d) === s &&
      typesMod.restrictionTypeOptions(s).some((o) => o.value === d.type)
    )
  }),
  ['health', 'diet'].map((s) => `${s}:${typesMod.defaultRestriction(s).type}`).join(' ')
)
/*
  ⚠️ 这里原来有一条「饮食段的默认类型不是『少吃』」。`preference` 删掉之后它的
  主语不存在了 —— 那种断言会**永远为真**,而永远为真的断言不是守卫,是噪音:
  它绿着,却什么也没说。删掉,换成下面两条真的能红的东西。

  ⚠️ **只有一个类型时不许给选择器。** 判据取
  `restrictionTypeOptions(section).length`,**不是 `section === 'diet'`** ——
  两个方向都要挡住,所以这里对着**渲染出来的 HTML** 和**纯函数**两边各断一次。

  ⚠️ 两段今天**不一样**:健康段 2 个类型(给选择器),饮食段 1 个(不给)。
  这个数字这一天里走过一个来回 —— 上午饮食段 1、下午 2、傍晚又回到 1,
  三次这条断言都是「照实记录」。**所以被钉住的不是那个数字,是「闸的判据 = 段里
  有几个类型」**;数字本身该跟着类型表走。
  红法:往 `RESTRICTION_SECTIONS.diet.types` 里塞一个不存在的类型。
*/
const optionCountOf = (s) => typesMod.restrictionTypeOptions(s).length
check(
  '**只剩一个类型的段不给选择器**（饮食段今天就是这样,那个闸真的在挡）',
  optionCountOf('health') === 2 && optionCountOf('diet') === 1,
  `健康 ${optionCountOf('health')} 项 · 饮食 ${optionCountOf('diet')} 项`
)
/*
  ⚠️ 选择器**渲染在展开态里**，而展开是组件内部状态、SSR 点不出来（上面那段
  注释已经说过这件事）。所以这个闸只能在**源码**上断（先例：`App.tsx` 那几条）。
  ⚠️ 如实说清这一条的力气有多大：它证明的是「那个条件还在，而且排在选择器前面」，
  **证明不了它真的包住了选择器**。真正保着行为的是上面那条纯函数断言
  （两段各几项）——组件里那个条件是照着它写的。
  红法：把 `RestrictionSheet.tsx` 里 `{restrictionTypeOptions(section).length > 1 && (`
  那一段整体删掉。
*/
const sheetSrcForGate = await readFile('src/components/RestrictionSheet.tsx', 'utf8')
const gateAt = sheetSrcForGate.search(/restrictionTypeOptions\(section\)\.length\s*>\s*1/)
const pickerAt = sheetSrcForGate.indexOf('label="限制类型"')
check(
  '**只有一个类型的段不渲染类型选择器**（`length > 1` 那个闸还在，且在选择器之前）',
  gateAt >= 0 && pickerAt > gateAt,
  `闸在 ${gateAt} · 选择器在 ${pickerAt}`
)
/*
  ⚠️ 紧接着这条:选择器的 label 必须**跟着这一段说自己的话**。

  这条断言这一天改了两回,如实记下来:
    · 原来断的是饮食段的 label 里用的是「偏好」那个后缀 —— `preference` 删掉之后
      那两个字在新表里什么都不是了。
    · 下午改成断「不爱吃」那个后缀 —— `dislike` 回来过一次。
    · 傍晚 `dislike` 删掉,**饮食段没有选择器了**,那个分支整个不渲染。
  于是这条**撤掉**:它的主语(饮食段那句写死的 label)已经不存在了。
  ⚠️ 撤掉而不是改成一条永远为真的:「写死的 label」和「派生出来的 label」是
  两件事,而饮食段今天取的是**派生**(`restrictionTypeOptions(section).map(o => o.label)`)
  —— 派生那条没法用一个字面量去断,而它过期不了,不需要守卫。
*/
/* 健康段那个 label 一个字没动过（「用药」是「用药禁忌」的省略写法,派生不出来） */
check('健康段选择器的 label 没被动过', sheetSrcForGate.includes(`'算过敏还是用药'`))

/*
  `mergeRestrictions` —— **这次改动里最值钱的一条**。

  `updateProfile` 换的是整个 `restrictions` 数组,而面板的草稿按段过滤之后只装
  本段的条目。直接写回去,在「过敏与用药」里保存就会把「忌口」那几条一起
  删掉 —— **落盘、不报错、保存键连灰都不灰**。这个仓库里最坏的一类失败。
*/
const MERGE_ALL = [
  { item: '花生', type: 'allergy', level: '高危' },
  { item: '香菜', type: 'taboo', level: '低危' },
]
const merged = typesMod.mergeRestrictions(MERGE_ALL, [{ item: '花生', type: 'allergy', level: '中危' }], 'health')
check(
  '**保存这一段时，另一段那几条一条不少地活下来**',
  merged.length === 2 && merged.some((r) => r.item === '香菜' && r.type === 'taboo' && r.level === '低危'),
  JSON.stringify(merged)
)
check('**本段改的那条确实改了**', merged[0].item === '花生' && merged[0].level === '中危')
check(
  '**另一段的行留在原来的位置**（追加到末尾也能保住数据，但顺序上游看得见）',
  merged[0].item === '花生' && merged[1].item === '香菜'
)
check(
  '**新加的行接在末尾**',
  (() => {
    const next = typesMod.mergeRestrictions(
      MERGE_ALL,
      [{ item: '花生', type: 'allergy', level: '高危' }, { item: '牛奶', type: 'drug', level: '高危' }],
      'health'
    )
    return next.length === 3 && next[2].item === '牛奶'
  })()
)
check(
  '**在面板里删掉的那条就真的没了**（草稿比原来短）',
  typesMod.mergeRestrictions(MERGE_ALL, [], 'health').length === 1
)
/*
  ⚠️ 上面那几条断的是 `mergeRestrictions` 这个**函数**的行为,而真正会丢数据的是
  `save` **有没有调它** —— 那是组件内部的一次点击,SSR 够不着(和 App.tsx 那几条
  读源码的理由一样)。

  所以这一条读源码。它不漂亮,但它挡住的是「换个写法之后数据静默消失」。
  红法:把 `save` 改回 `restrictions: draft` / `restrictions: cleaned`。
*/
const sheetSrc = await readFile('src/components/RestrictionSheet.tsx', 'utf8')
check(
  '**保存走的是按位合并，不是整条覆盖**（写回 draft 会连带删掉另一段）',
  /restrictions:\s*mergeRestrictions\(\s*profile\.restrictions/.test(sheetSrc),
  sheetSrc.match(/updateProfile\(\{[^}]*\}/)?.[0] ?? '没找到那次 updateProfile'
)

/*
  `restrictionSuffixSuggestion` —— 「花生过敏」→「花生」。

  ⚠️ 这个提示卡只在某一行展开时才渲染,而展开是组件内部状态,SSR 到不了 ——
  所以判据被抽成了纯函数。查的是**完整**的 `RESTRICTION_SUFFIX`,不是分段过滤后
  的那个:查过滤后的列表 → `find` 返回 undefined → `suffix` 是空串 →
  `item.endsWith('')` 恒真 → `slice(0, -0)` 是空串 → 那张卡**静默消失**,
  而这个仓库里没有任何一条断言看得见它。
  红法:改查 `restrictionTypeOptions(...)` 那个列表。
*/
check(
  '**连后缀一起打的话，建议是剥掉后缀的那个词**',
  typesMod.restrictionSuffixSuggestion('花生过敏', 'allergy') === '花生',
  String(typesMod.restrictionSuffixSuggestion('花生过敏', 'allergy'))
)
check(
  '**已经是裸词就不多嘴**（没有那张提示卡）',
  typesMod.restrictionSuffixSuggestion('花生', 'allergy') === null
)
check(
  '**每个类型查的是自己那个后缀**（四类各证一次）',
  typesMod.RESTRICTION_TYPES.every(
    (t) => typesMod.restrictionSuffixSuggestion(`花生${t.label}`, t.value) === '花生'
  ),
  typesMod.RESTRICTION_TYPES.map(
    (t) => `${t.value}:${String(typesMod.restrictionSuffixSuggestion(`花生${t.label}`, t.value))}`
  ).join(' ')
)
/*
  ⚠️ 这一条要证的是「查的是**完整表**，不是某一小段过滤后的表」——
  所以要拿一个**对它自己那一段而言在段外**的类型来举例子。
  饮食段是 `taboo|dislike`，所以 `dislike` 举不了这个例子(它在段里，
  过滤与否都查得到);能用的是 `taboo`,它是「对**健康段**而言在段外」的那一个
  (健康段是 allergy|drug)。`taboo` 恰好同时是饮食段的类型，这不影响这条判据
  ——判据问的是「查表时过没过滤」，不是「这个类型属于谁」。
  红法:把 `restrictionSuffixSuggestion` 里那张表换成
  `restrictionTypeOptions(section)` 那个列表。
*/
check(
  '**段外的类型也查得到后缀**（查分段后的表会让这张卡静默消失）',
  typesMod.restrictionSuffixSuggestion('香菜忌口', 'taboo') === '香菜',
  String(typesMod.restrictionSuffixSuggestion('香菜忌口', 'taboo'))
)

/*
  `findRestrictionDupe` —— **分段新开出来的那个洞**。

  两段是两个入口、两张卡，所以「花生」填成一条过敏 + 一条忌口在旧写法下没人挡；
  而分开之后那两行**再也不会并排出现**，用户根本看不见自己填重了。
  它只在面板里渲染，而面板的展开是组件内部状态、静态 SSR 够不着 —— 所以判据抽成了
  store 里的纯函数，这几条是它**唯一**的守卫。

  红法：改回只扫本段草稿（第 1 条）；或把 `entry` 一律返回空串（第 2 条）。
*/
const DUPE_ALL = [
  { item: '花生', type: 'allergy', level: '高危' },
  { item: '香菜', type: 'taboo', level: '低危' },
]
const dupeOf = (draft, section) => typesMod.findRestrictionDupe(DUPE_ALL, draft, section)
const healthDupe = dupeOf([{ item: '香菜' }], 'health')
check(
  '**跨段重名被挡住，而且说清了撞的是另一段**',
  healthDupe?.word === '香菜' && healthDupe?.entry === typesMod.restrictionSectionShape('diet').entry,
  healthDupe ? `「${healthDupe.word}」→「${healthDupe.entry}」` : '压根没查出来'
)
check(
  '**本段的行不和自己比**（「花生」在健康段里再存一次不算撞）',
  dupeOf([{ item: '花生' }], 'health') === null,
  String(dupeOf([{ item: '花生' }], 'health'))
)
const sameSection = dupeOf([{ item: '腰果' }, { item: '腰果' }], 'health')
check(
  '**同一段里重了两条也挡，但不报段名**（那两行就并排摆在眼前）',
  sameSection?.word === '腰果' && sameSection?.entry === '',
  sameSection ? `「${sameSection.word}」→「${sameSection.entry}」` : '压根没查出来'
)
check(
  '**空 item 不参与查重**（没填完由 `blank` 那条闸管，两条提示不该抢同一句话）',
  dupeOf([{ item: '  ' }, { item: '' }], 'health') === null
)

console.log('\n=== 「全部记录」要把另一份档案也数进去 ===')
store.switchProfile(secondId)
const demoMeals = store.getSnapshot().profiles.find((p) => p.id !== secondId).meals.length
const me = await server.ssrLoadModule('/src/screens/MeScreen.tsx')
const meHtml = renderPage(me.default, '/me')

check('**「餐次记录」是两份档案之和**', meHtml.includes(`>${demoMeals} 条<`), `${demoMeals} 条`)
check('清空按钮点名了「当前档案」', meHtml.includes('清空当前档案的记录'))
check('两个操作的组标题写明了是哪一个档案', meHtml.includes('只作用于「第二份」'))
check('恢复演示数据那行说明了基本资料会一起换', meHtml.includes('基本资料一起换'))

/*
  那两个 ConfirmSheet 的**正文**在这里断不到 —— 面板关着,`open: false` 直接
  返回 null,而 `renderToStaticMarkup` 不跑 effect,没有「点开它」的办法。
  (这和上面「分析中」那一节能断三种状态不一样:那边的状态在 store 里,
  这边的状态在组件自己的 useState 里。)

  与其写一条搜不到的断言,不如把它记下来 —— 那两句文案的覆盖在人工动线上
  (清空 / 恢复各自点一次),以及 verify-loop 里那条「scoped 到当前档案」的
  行为断言上。
*/

console.log('\n=== 配额的来处 ===')
store.switchProfile(firstId)
const profileScreen = await server.ssrLoadModule('/src/screens/ProfileScreen.tsx')

/*
  出生日期那行:来处和结果并排。这两条断言的分工是 ——
  「出生日期」保证编辑那一行和这一行**叫同一个名字**(否则用户看到「28 岁」
  找不到改它的地方),「· 28岁」保证那个真正进公式的数字在这一页看得见。
*/
const birthHtml = renderPage(profileScreen.default, '/profile')
check(
  '**档案页那一行把出生日期和算出来的年龄并排写出来**',
  /出生日期<\/span><span class="[^"]*"><span class="[^"]*">\d{4}年\d{1,2}月\d{1,2}日 · \d+岁/.test(birthHtml),
  birthHtml.match(/\d{4}年\d{1,2}月\d{1,2}日 · \d+岁/)?.[0] ?? '没找到'
)
/*
  ⚠️ 这一条原来钉的是**深色卡上那行摘要**（`{性别} · {年龄} 岁 · {身高}cm · {体重}kg`），
  而那行摘要这次被删掉了 —— 它和「基本信息」那张卡是同一批数据，年龄在那儿还写着
  第二次。

  只把断言删掉是不行的：那一行没了之后，「年龄在页面上出现几次」就重新变成一件
  没人盯着的事，而它恰恰是删那行摘要的**理由**。所以换成断**年龄只出现一次**，
  锚在旁边那一行上（「出生日期」右边的「1998年3月20日 · 28岁」）。

  红法：把深色卡上那行摘要加回去 → 年龄出现两次 → 红。
*/
check(
  '**年龄在页面上正好出现一次**（只在「出生日期」那一行里）',
  (birthHtml.match(/· \d+ ?岁/g) ?? []).length === 1,
  `数到 ${(birthHtml.match(/· \d+ ?岁/g) ?? []).length} 处`
)
check(
  '锚点：那一处就是出生日期那一行（否则上面那条在整页渲染失败时也成立）',
  /\d{4}年\d{1,2}月\d{1,2}日 · \d+岁/.test(birthHtml)
)

store.updateProfile({ chronicConditions: ['高血压'] })
const hyperHtml = renderPage(profileScreen.default, '/profile')
check('勾上高血压之后钠确实变成 1500', store.getSnapshot().profile.quota.sodium === 1500)
/*
  ⚠️ 这两条原来钉的是「钠 1500mg」,**没有那个「上限」**。

  它跟着 `formatQuota` 一起变了 —— 那个函数现在会带上每一项的**角色**
  （`QuotaField.role`：「钠**上限** 1500mg」/「蛋白质**目标** 65g」），
  因为结果页、首页、日记页和对话页新增的那行「依据 · …」用的就是它。
  用户要的是「说到哪一条 + 它改了什么」,而「钠 1500mg」说不出这一项是上限
  还是目标 —— 「蛋白质 65g」和「蛋白质上限 65g」是两句意思相反的话。

  这是**一处改动两个页面跟着变**：档案页这行字没有单独改，它是同一张表算出来的
  （见 quota.ts 文件头「三件事由同一张表驱动」）。所以断言要跟着改口径，
  而不是把档案页单独写回老样子 —— 那样两处就会各说各的。
*/
check('**档案页把这条调整写了出来**', hyperHtml.includes('钠上限 1500mg'))
check(
  '来处那行把条件和它的效果放同一句里',
  // 中间隔着 `<span class="text-muted"> → </span>`,不能直接搜「高血压 →」
  /高血压[\s\S]{0,80}钠上限 1500mg/.test(hyperHtml)
)
check('来处还写了依据', hyperHtml.includes('美国心脏协会'))
check('没有手改过时不出现「未采用」', !hyperHtml.includes('未采用'))
check('依据里没有漏出来的 Markdown 星号', !hyperHtml.includes('**'))

store.updateProfile({ quotaOverrides: { sodium: 1200 } })
const pinnedHtml = renderPage(profileScreen.default, '/profile')
check('手改之后生效值是被钉住的 1200', store.getSnapshot().profile.quota.sodium === 1200)
check('**被手改挡住时标出「未采用」**', pinnedHtml.includes('未采用'))
check('并给出重新考虑的入口(不是一句只能干看着的说明)', pinnedHtml.includes('重新考虑'))
check('界面上显示的也是 1200', pinnedHtml.includes('>1200<'))
check('被挡住时依据里同样没有漏出来的星号', !pinnedHtml.includes('**'))

/*
  这两栏都是**列表**,而列表里既可能装预设也可能装用户自己写的词 ——
  档案页不做任何分类渲染:自己写的词混在同一行里。这里断言的正是
  「混在一起、全都写出来」,因为「只显示第一个」是数组化之后最容易漏的那种坏法。
*/
store.updateProfile({ specialStages: ['孕期', '老年', '甲状腺结节'], chronicConditions: [], quotaOverrides: {} })
const multiHtml = renderPage(profileScreen.default, '/profile')
check(
  '**多个特殊阶段在一行里全写出来**(含自己写的那个)',
  multiHtml.includes('孕期、老年、甲状腺结节'),
  '以前是单值,几个阶段只会显示一个'
)
check(
  '孕期把热量和蛋白质的调整也带到了来处里',
  /孕期[\s\S]{0,80}(kcal|蛋白质)/.test(multiHtml)
)
/*
  **角色词**（上限／目标）—— 每一项的名字后面跟着的那个字。
  这次新增的「依据 · …」行印的就是这一串,而档案页这行字用的是同一个
  `formatQuota`,所以两者不可能各说各的。

  为什么非要那个字：「热量 1900kcal」和「热量**目标** 1900kcal」,
  「钠 1500mg」和「钠**上限** 1500mg」—— 少那个字,读数的人分不清这是
  一个上限还是一个目标,而这两件事对同一顿饭的建议是相反的。

  这里挑孕期来断：它同时动了**目标类**（热量、蛋白质）的两项,是唯一一处
  一屏能看到两个「目标」的地方。红法：把 `formatQuota` 里的 `${f.role}` 去掉。
*/
check(
  '**来处那几项带着角色词**（「热量目标 …kcal、蛋白质目标 …g」）',
  /热量目标 \d+kcal[\s\S]{0,40}蛋白质目标 \d+g/.test(multiHtml),
  '孕期那一条同时动了这两项，中间用「、」连着'
)

/*
  补充说明必须**有地方看**。
  一个只写得进、读不出来的字段比没有这个字段更糟 —— 这个仓库里 `seeded`
  就是前车之鉴(只被写、从没被读过)。所以这里断的不是「组件渲染出来了」,
  而是「我写进去的那句话真的出现在屏幕上」。

  ⚠️ 这句话是在**引导第 4 步「补充说明」**里写的,而它在档案页那一行的名字今天
  叫「其他补充」—— 同一个字段两个名字,他 2026-09-22 只指了档案页这一半。
  下面断的是**渲染出来的行名**,所以改的也是这一半。
*/
store.updateProfile({ notes: '在吃二甲双胍，医生让少喝汤' })
const notesShownHtml = renderPage(profileScreen.default, '/profile')
check(
  '**引导里写的补充说明在档案页看得见**',
  notesShownHtml.includes('其他补充') && notesShownHtml.includes('在吃二甲双胍，医生让少喝汤')
)
store.updateProfile({ specialStages: [], notes: '' })

/*
  档案页的十格就地编辑 —— 引导里能填的那几栏，档案页上**每一格自己就是入口**。

  这一节原来渲染的是「编辑档案」那张装着全部十格的面板，断的是「十格在那张
  面板里都在，四栏都有其他口」。面板和页头那颗「编辑」按钮一起删掉了（用户
  的原话是「不用每次都弹出全部要改的内容」），所以这一节的主语也换了：不再断
  「十格都在一张面板里」，而是断**每一格都在页面上、点了只开这一格**。

  ⚠️ 只验得到「渲染出来的东西」。点不动任何一行 —— `renderToStaticMarkup`
  不跑 effect、不派发事件，所以「点 A 之后 B 收起」「上一格打的字被写下来」
  这两件事在这里够不到，它们归 `private/check-inline-edit.mjs` 和手工走查。

  ⚠️ **下面那一行 `ssrLoadModule` 是顶层 await 且不在 try 里。** 被加载的文件
  一旦不存在（改名、挪走、删掉），它会 reject 掉整个脚本 —— 后面每一条断言都
  不会跑，终端上只剩一段 vite 的报错。上一版删掉 ProfileEditSheet.tsx 时正是
  这样：前面 700 多条全绿，而总数根本印不出来。所以**动这一行之前先确认文件在**。
*/
console.log('\n=== 档案页的十格就地编辑 ===')
const inlineField = await server.ssrLoadModule('/src/components/InlineField.tsx')

const FIELD_KEYS = inlineField.FIELD_KEYS
const specOf = (k) => inlineField.fieldSpec(k)

/* 从表里推，不写死 —— 表改了这几条跟着改 */
const expandableKeys = FIELD_KEYS.filter((k) => specOf(k).editor !== 'picker')
const pickerKeys = FIELD_KEYS.filter((k) => specOf(k).editor === 'picker')
const wordKeys = FIELD_KEYS.filter((k) => specOf(k).editor === 'chips')

/**
 * 单渲染某一格。`open` 决定抽屉在不在 —— 这是唯一能看见抽屉内容的路子。
 *
 * 草稿走 `draftSeed`,和 ProfileScreen 的 `toggle` 同一条路:不然这里渲染出的
 * 永远是一个空框,而「框里的值就是档案里那段话」正是要盯的那件事。
 */
const renderCell = (field, open) =>
  renderToStaticMarkup(
    React.createElement(inlineField.InlineField, {
      field,
      profile: store.getSnapshot().profile,
      open,
      onToggle: () => {},
      draft: inlineField.draftSeed(field, store.getSnapshot().profile),
      onDraft: () => {},
      onPatch: () => {},
    })
  )

store.updateProfile({ specialStages: ['孕期'], goals: ['控盐'], notes: '在吃二甲双胍', quotaOverrides: {} })
const cellsHtml = renderPage(profileScreen.default, '/profile')

/* ---------- 接线组：十格都在页面上 ---------- */
/* 十格**全是行式**,所以逐格点名就是逐格点标签 —— 标签是用户唯一认得出的东西。
   （上一版这里只点八格:健康目标 / 饮食偏好是块式,它们的名字借用上面的灰组头,
   得去点里面的胶囊才对得上。那两格现在也是行了。） */
check(
  '**十格逐格点名都在**(十个字段名一个一个对)',
  FIELD_KEYS.every((k) => cellsHtml.includes(`>${specOf(k).label}</span>`)),
  FIELD_KEYS.filter((k) => !cellsHtml.includes(`>${specOf(k).label}</span>`)).join(' / ') || `${FIELD_KEYS.length} 格`
)

/*
  **十个字段名必须是同一种写法。** 这正是用户这次报的那件事:

    「都说了档案格式保持一样啊，为什么还是有的标题是黑体字，有的标题是灰字？」

  所以这里不去断某一个具体的 class,而是把十格各自的标签 class 抠出来,断
  **集合大小是 1**。好处是它断的是一个**不变式**而不是一次快照:以后不管这
  个样式换成什么,只要十格一致就是绿的;而「有几格偷偷换了写法」直接变红。

  红法:把 goals 那一格换回块式(它的名字就借组头去了,抠不到标签 span)。
*/
const labelClasses = FIELD_KEYS.map(
  (k) => renderCell(k, false).match(new RegExp(`<span class="([^"]*)">${specOf(k).label}</span>`))?.[1]
)
check(
  '**十格的标签 class 完全一样**(一半黑一半灰就是这次报的问题)',
  labelClasses.every(Boolean) && new Set(labelClasses).size === 1,
  [...new Set(labelClasses)].join(' | ') || '一个标签都没抠到'
)
check(
  '而且那个 class 就是行名的样式(黑 15px)',
  labelClasses[0] === 'shrink-0 text-[15px] leading-[22px] text-ink',
  labelClasses[0] ?? '（没抠到）'
)

/*
  上面那条的反面写法,要单独留着:组头渲染成 `<div>`,行名是 `<span>`。
  万一以后有人把某一格的 label 交给 `GroupHeader`,上面那条会因为「它压根没
  渲染出标签 span」而红 —— 但那条读起来像「少了一格」,不像「名字换了写法」。
*/
check(
  '**没有哪个字段名被渲染成组头**(那正是这次改掉的写法)',
  FIELD_KEYS.every((k) => !cellsHtml.includes(`>${specOf(k).label}</div>`)),
  FIELD_KEYS.filter((k) => cellsHtml.includes(`>${specOf(k).label}</div>`)).join(' / ')
)
/*
  组头**一个都不剩**了。

  这一页原来是一张大卡 + 三个灰 12px 的 `GroupHeader`（基础信息 / 健康限制 /
  每日营养配额）。那个形状是给「卡片里的第一个孩子」用的：12px、缩进 16px，
  和行名只差一个字号 —— 坐在卡里读起来像某一个字段的小标签，不像一个分类。
  用户的原话是「分类的标题要能让用户知道你这个是分类标签而不是内容」。

  ⚠️ 数的是**那个 class 串**，不是「组头」这个词 —— 换成别的写法一样会红。
  红法：把 `<GroupHeader>基础信息</GroupHeader>` 加回第一张卡里。
*/
check(
  '**档案页一个组头都没有了**（分类标签换成了卡片外的 SectionTitle）',
  (cellsHtml.match(/px-4 pt-3 pb-1 text-\[12px\]/g) ?? []).length === 0,
  `数到 ${(cellsHtml.match(/px-4 pt-3 pb-1 text-\[12px\]/g) ?? []).length} 个`
)
check('**「补充说明」这个组头没了**(它和行名是同一个字段的两个说法)', !cellsHtml.includes('补充说明'))

/* ---------- 四个分类：一类一张卡，标签在卡片外 ---------- */
/*
  这一节是这次改动的**主断言**。用户要的是两件事：分类名对，以及标签读起来像
  标签而不是像内容。

  分四条来断，因为「标签在卡片外」这件事没法用一条正则会话说清：
    1. 四个标签是 `<h2>`（`SectionTitle` 是 h2，`GroupHeader` 是 div）
    2. 页面上正好四个
    3. 标签和卡片交错出现 —— 标0 < 卡0 < 标1 < 卡1 < …（这才是「在外面」）
    4. 每张卡里装着哪几格（次序闸表达不了这件事）
*/
const CATEGORIES = ['基本信息', '健康信息', '饮食信息', '营养目标']
const labelAt = CATEGORIES.map((c) => cellsHtml.indexOf(`>${c}</h2>`))
const cardAt = [...cellsHtml.matchAll(/rounded-\[20px\] bg-card/g)].map((m) => m.index)

check(
  '**四个分类标签各是一个 `<h2>`，而且正好四个**（这一页因此有了真正的标题大纲）',
  labelAt.every((i) => i >= 0) && (cellsHtml.match(/<h2 class="/g) ?? []).length === 4,
  CATEGORIES.filter((c, i) => labelAt[i] < 0).join(' / ') ||
    `h2 数到 ${(cellsHtml.match(/<h2 class="/g) ?? []).length} 个`
)
check(
  '**四张卡都在**（下面几条的前提；卡片整个没渲染时那几条会假绿）',
  cardAt.length === 4 && cardAt.every((i) => i >= 0),
  `数到 ${cardAt.length} 张`
)
/*
  ⚠️ 交错才是「标签在卡片外」。判据不是「标签有 px-5 或没有」那种样式细节，
  而是**位置关系**：每一个标签都在它那张卡前面，每一张卡都在下一个标签前面。
  红法：把某一个 `<SectionTitle>` 挪进它的 `<Card>` 里 → 卡0 跑到 标0 前面。
*/
check(
  '**标签和卡片交错出现**（标 → 卡 → 标 → 卡 …，也就是标签在卡片外）',
  labelAt.every((i) => i >= 0) &&
    cardAt.length === 4 &&
    labelAt.every((i, n) => i < cardAt[n]) &&
    cardAt.every((i, n) => n === cardAt.length - 1 || i < labelAt[n + 1]),
  `标签 ${labelAt.join(',')} / 卡片 ${cardAt.join(',')}`
)

/* 按四张卡的边界切开，看每张卡里装着哪几格。`slicesOf` 定义在本文件靠上的
   读数工具那一层（两边都要用，谁在后面定义谁就挨 TDZ） */
const cardSlices = slicesOf(cellsHtml)

/*
  每张卡里的字段名集合。

  ⚠️ 这是**次序闸表达不了的那件事**：`FIELD_KEYS` 能证明十格的先后没变，但证明
  不了「身高没有跑到饮食信息那张卡里」。四张卡的切法跟着 `InlineField` 里 SPECS
  的分组走，所以这里的期望值也按那个分组写。

  最后一张（营养目标）是空的：它装的是八格配额网格，不是十格里的任何一格。
*/
const CARD_FIELDS = [
  ['称呼', '性别', '出生日期', '身高', '体重'],
  ['特殊阶段', '慢性病', '其他补充'],
  ['饮食目标', '饮食偏好'],
  [],
]
const ALL_FIELD_LABELS = CARD_FIELDS.flat()
check(
  '**每张卡里的字段名分毫不差**（多一个少一个都红）',
  CARD_FIELDS.every(
    (expected, n) =>
      expected.every((l) => cardSlices[n]?.includes(`>${l}</span>`)) &&
      ALL_FIELD_LABELS.filter((l) => !expected.includes(l)).every((l) => !cardSlices[n]?.includes(`>${l}</span>`))
  ),
  CARD_FIELDS.map((expected, n) => {
    const got = ALL_FIELD_LABELS.filter((l) => cardSlices[n]?.includes(`>${l}</span>`))
    return `${n}:${got.join(',') || '空'}${got.join(',') === expected.join(',') ? '' : ` ≠ ${expected.join(',')}`}`
  }).join(' | ')
)
/*
  ⚠️ 这条挡的是**粘错地方**：上面那条断的是「每张卡里有它该有的」，而把
  `{cell('goals')}` 同时粘到两张卡里，两边的 `every` 都还是绿的。
  红法：复制一行 `{cell('goals')}` 到基本信息那张卡里。
*/
check(
  '**每个字段名在页面上正好出现一次**',
  FIELD_KEYS.every(
    (k) => (cellsHtml.match(new RegExp(`>${specOf(k).label}</span>`, 'g')) ?? []).length === 1
  ),
  FIELD_KEYS.map((k) => `${k}:${(cellsHtml.match(new RegExp(`>${specOf(k).label}</span>`, 'g')) ?? []).length}`)
    .filter((s) => !s.endsWith(':1'))
    .join(' ') || '十格各一次'
)

/* ------------------------------------------------------------
   ⚠️ 同类名字之间不许共用结尾 —— **用户报的那个 bug 的机器版本**
   ------------------------------------------------------------
   用户的原话:「忌口与偏好似乎与饮食偏好有所重复」。

   那不是「看错了」:饮食信息那张卡上，「饮食偏好」（一个字段名）和「忌口与偏好」
   （另一个入口的名字）上下相邻，两个名字的**结尾都是「偏好」** —— 读起来就是在
   说同一件事。

   ⚠️ **判据是「共用结尾」，不是「互相包含」。** 这两个词谁也不包含谁
   （「忌口与偏好」里没有「饮食」），所以子串那一路**根本抓不到这个 bug** ——
   写这条断言时我先用了子串，弄坏之后它一动不动，才发现判据错了。

   为什么单挑结尾:中文的字段名是**限定语 + 中心词**，中心词落在最后。
   两个名字共用一个中心词 = 用户读到的是「同一件事的两个说法」。
   而共用一个**前缀**不是问题:「饮食目标」和「饮食偏好」都以「饮食」开头，
   那是对的 —— 它们确实是同一张卡里的两格。

   同理**不拿渲染出来的行来比**:`restrictionLabel` 会拼出「香菜忌口」，结尾是
   「忌口」，和入口名「忌口」共用结尾 —— 但那不是重复:命名格式就是「食物 + 类型」，
   和健康卡里「花生过敏」配「过敏与用药」是同一个形状，而且它在卡片里**缩进一层**，
   和入口行不是同一层级。谁要是想「修」这条断言，先读这段。

   红法:把饮食段的 `entry` 改回 `'忌口与偏好'` —— 和「饮食偏好」共用结尾「偏好」。
   ------------------------------------------------------------ */
const TAIL = 2
const SAME_LEVEL_NAMES = [...FIELD_KEYS.map((k) => specOf(k).label), ...typesMod.RESTRICTION_SECTIONS.map((s) => s.entry)]
const clashes = []
for (const a of SAME_LEVEL_NAMES) {
  for (const b of SAME_LEVEL_NAMES) {
    if (a >= b) continue
    const shared = a.slice(-TAIL) === b.slice(-TAIL) || a.includes(b) || b.includes(a)
    if (shared) clashes.push(`「${a}」/「${b}」`)
  }
}
check(
  '**同类名字之间没有两个共用结尾**（用户报的「重复」就是这一条）',
  clashes.length === 0 && SAME_LEVEL_NAMES.length === FIELD_KEYS.length + 2,
  clashes.join(' ') || `${SAME_LEVEL_NAMES.length} 个名字的结尾两两不同`
)

/* ------------------------------------------------------------
   ⚠️ 入口名必须**管得住它装的那几类** —— 反过来的那一半
   ------------------------------------------------------------
   上面那条防的是「名字和别的名字撞车」，这一条防的是「名字和**自己的内容**
   对不上」:入口叫「忌口」而里面装着「不爱吃」，用户点进去发现自己**填过的
   「不爱吃」不在这里** —— 而它其实在，只是那一行不叫这个名字。
   2026-09-22 下午就是这么改成「忌口与不爱吃」的。

   ⚠️ 傍晚那个类型删掉了,**名字回到「忌口」**,于是判据也跟着变强:
   不再是「名字里包含每一个后缀」(一个类型的段里,「包含」和「相等」没有区别),
   而是**相等** —— 名字就是那唯一一个类型的后缀,不多一个字。
   红法:把饮食段的 `entry` 改回 `'忌口与不爱吃'`(多出来的那几个字没有类型对应)。

   健康段**不能**这么断:它装的是「过敏」「用药禁忌」，名字是「过敏与用药」——
   那个「用药」是「用药禁忌」的省略，派生不出来，所以对健康段只断「包含第一类」。
   ------------------------------------------------------------ */
const dietSectionTypes = typesMod.restrictionTypeOptions('diet').map((o) => o.label)
check(
  '**饮食段入口名 = 它那唯一一个类型的后缀**（今天就是「忌口」，多一个字都不行）',
  dietSectionTypes.length === 1 && dietEntryNow === dietSectionTypes[0],
  `${dietEntryNow} vs ${dietSectionTypes.join(' / ')}`
)
check(
  '**健康段入口名点到了它装的第一类**（名字来自表，不写字面量）',
  entryOf('health').includes(typesMod.restrictionTypeOptions('health')[0].label),
  `${entryOf('health')} vs ${typesMod.restrictionTypeOptions('health').map((o) => o.label).join(' / ')}`
)

/* ------------------------------------------------------------
   ⚠️ 哪些类型拦菜 —— 这条规矩这一天翻了两回
   ------------------------------------------------------------
   这一节原来是一条「**硬拦截覆盖全部类型**」。2026-09-22 下午判据换成
   「具体食物 / 整体模式」时它当场变成假话（`dislike`「不爱吃」故意不拦），
   于是删掉、换成「真子集」。**傍晚 `dislike` 整个删掉了,「覆盖全部类型」
   又成了真的** —— 加回来,而不是留一条已经不成立的真子集断言。

   三条各管一件事(见下)。用户那条判据在代码里的样子是第 ① 条:
   拿每一种类型各造一餐，**看冲突卡弹不弹**，和 `HARD_BLOCK_TYPES` 逐类型对撞。
   这是唯一能证明「这个类型真的走那条闸」的东西 —— 另外两条都只是它的影子。
   ------------------------------------------------------------ */

const allTypes = typesMod.RESTRICTION_TYPES.map((t) => t.value)
const adviceMod = await server.ssrLoadModule('/src/store/advice.ts')

/*
  ① 「弹不弹冲突卡」=== 「在不在 `HARD_BLOCK_TYPES` 里」，**两向都断，端到端**。

  造一餐:菜名里含那一条的 `item`，于是「命中」这件事一定发生。剩下的问题
  只有「弹不弹卡」——而它必须**只**由 `hardBlocks` 决定。

  ⚠️ 锚点先断一次「命中真的被判成了命中」:所有类型用的是同一个 `item`
  和同一道菜，所以只要有**任何一种**弹了卡，就说明匹配本身是通的。
  少了这个，把 `deriveAdvice` 里那个循环整个删掉会让下面每条都「正确地」
  期望 false，然后全绿。

  ⚠️⚠️ **这条能红在什么上、不能红在什么上 —— 验红时才发现，如实写下来。**

  它**红了才怪**在「往 `HARD_BLOCK_TYPES` 里加一个类型」上:两边读的是
  同一张表，`hardBlocks(x)` 变成 true 的同时冲突卡也跟着弹，
  `carded === blocks` 照样成立。下午实测过:把 `dislike` 加进那张表，这条
  **一动不动**（红的是 ② 和显示那两条）。**今天这张表已经覆盖了全部类型,
  所以「加一个」这个动作本身都不存在了** —— 但下面那句结论不变。

  它真正守的是**`advice.ts` 那个闸和这张表不许分家**:有人把
  `if (!hardBlocks(r.type)) continue` 换成一个写死的判断（`r.type === 'allergy'`），
  这条立刻红，而 ② 和显示那两条都不会动。

  ⇒ 所以「弹不弹 === 在不在表里」这句话里的**「弹」那一半**才是它的主语。
  想读成「这条守的是 `HARD_BLOCK_TYPES` 的内容」就错了 —— 那件事归 ②。

  红法:`advice.ts` 里把 `hardBlocks(r.type)` 换成 `r.type === 'allergy'`。
*/
const conflictCardFor = (type) => {
  const r = { item: '折耳根', type, level: '高危' }
  const p = { ...store.getSnapshot().profile, restrictions: [r] }
  const items = [{ foodId: 'unknown-x', name: '凉拌折耳根', grams: 100 }]
  return adviceMod.deriveAdvice(items, p).some((a) => a.title.includes('冲突'))
}
const blockPairs = allTypes.map((t) => [t, conflictCardFor(t), typesMod.hardBlocks(t)])
check(
  '  (锚点)这一餐确实命中了那一条限制（否则下面那条是假绿）',
  blockPairs.some(([, carded]) => carded),
  blockPairs.map(([t, c]) => `${t}:${c ? '弹' : '不弹'}`).join(' ')
)
check(
  '**弹不弹冲突卡 === 在不在 HARD_BLOCK_TYPES 里**（用户这条判据在代码里的样子）',
  blockPairs.every(([, carded, blocks]) => carded === blocks),
  blockPairs.map(([t, c, b]) => `${t}:${c ? '弹' : '不弹'}/${b ? '拦' : '不拦'}`).join(' ')
)

/*
  ② `HARD_BLOCK_TYPES` **覆盖全部类型** —— 今天一个不拦的类型都没有。

  ⚠️ 这条和 ① 不重复:① 说的是「两边一致」，一个**空**的
  `HARD_BLOCK_TYPES`（谁都不拦）和一张**全**表（谁都拦）都能让 ① 绿着。
  ② 钉的是那张表的**内容**:它必须逐个等于 `RestrictionType` —— 一条不重、
  一条不漏（拼错的 `tabo` 就是「漏」:那种值谁都不认，于是它在 ① 里既不出现、
  也不影响任何东西，静默地失效）。

  ⚠️ **它是「结论」,不是「前提」** —— `types.ts` 里那段注释写的就是这句话:
  「忌口」这一格里的每一种都参与拦截,是**用户定的判据**落到代码上的结果,
  不是「本来如此」。下午 `dislike` 在的时候这条是假话(那时断的是「真子集」),
  傍晚它被删掉,这条又成了真的。**别把它读成「以后也不许有不拦的类型」。**
  红法:把 `taboo` 从 `HARD_BLOCK_TYPES` 里拿掉。
*/
check(
  '**`HARD_BLOCK_TYPES` 覆盖全部类型**（今天没有不拦的类型 —— 结论，不是前提）',
  typesMod.HARD_BLOCK_TYPES.length === allTypes.length &&
    allTypes.every((t) => typesMod.HARD_BLOCK_TYPES.includes(t)),
  `全部 ${allTypes.join('/')} · 硬拦截 ${typesMod.HARD_BLOCK_TYPES.join('/')}`
)

/*
  ③ 等级要**原样保留**，而「不拦的类型会被收成低危」那条规矩**仍然在**。

  ⚠️ 这一天里这条也翻过一回:下午它断的是「不拦的类型算出来是低危」,
  傍晚没有不拦的类型了,那句话的主语没了。**但没有撤掉、也没有改绿** ——
  换成一条**形状**断言(每个类型的等级原样保留) + 一条**合成探针**
  (给一个表外的类型,它必须被收成低危)。

  为什么要有那条探针:只留形状那半的话,`restrictionLevel` 写成
  `return r.level` 照样绿（今天每个类型都在表里,走不到那个分支）——
  那是一条**永远为真**的断言。探针把「判据是那张表」这件事钉住:
  `'ghost'` 不是一个合法的 `RestrictionType`,只能从 JS 侧塞进来,
  它代表的就是「将来那个不拦的类型」。

  ⚠️ 「藏起来」和「存低危」是**两件事**,必须分开断 —— 这是最容易漏的
  那个静默失效:只把那一栏藏起来的话，`draft.level` 还是默认的「高危」，
  保存会把一份 `severity: "high"` 发给食衡。界面上一个字都看不出来，
  模型读到一句**假的警报**。所以下面还有两条渲染断言。
  红法:`restrictionLevel` 里的 `hardBlocks` 判据去掉。
*/
check(
  '**每个类型的等级都原样保留**（今天每一种都拦，所以这一句是恒等的）',
  allTypes.every((t) => {
    const got = typesMod.restrictionLevel({ item: 'x', type: t, level: '高危' })
    return typesMod.hardBlocks(t) ? got === '高危' : got === '低危'
  }),
  allTypes.map((t) => `${t}→${typesMod.restrictionLevel({ item: 'x', type: t, level: '高危' })}`).join(' ')
)
check(
  '**表外的类型一律收成低危**（合成探针 —— 代表「将来那个不拦的类型」）',
  typesMod.restrictionLevel({ item: 'x', type: 'ghost', level: '高危' }) === '低危',
  typesMod.restrictionLevel({ item: 'x', type: 'ghost', level: '高危' })
)
/*
  ⚠️ 两条渲染断言都**配对断**:不拦的那条不显示等级、拦的那条显示。
  只断「不拦的不显示」的话，把等级整个删掉（连「高危」都不显示了）也会绿 ——
  而那是一条比原来更糟的回归。
*/
/*
  ⚠️ 最后半条，**只能在源码上断，如实说清它的力气有多大**。

  「保存时必须过 `restrictionLevel()`」这件事真正的证据是**保存那条路上的
  输出**，而 `save()` 是组件里的一个闭包，SSR 点不出来（先例:
  `App.tsx` 那几条、以及上面这个 `length > 1` 闸）。
  所以这里断的是:那段源码里**确实有一次** `level: restrictionLevel(...)`，
  而且它就在 `save` 那个函数体内、在 `updateProfile` 之前。

  ⚠️ 它证明不了「所有写入路径都过它」—— 只证明「这条路上有它」。
  真正保着性质的是 `restrictionLevel` 本身那条纯函数断言。

  红法:把 `save()` 里的 `level: restrictionLevel({...})` 改回 `level`。
*/
const saveAt = sheetSrc.indexOf('const save = () =>')
const saveBody = saveAt < 0 ? '' : sheetSrc.slice(saveAt, sheetSrc.indexOf('mergeRestrictions(', saveAt))
check(
  '**保存那一步过了 `restrictionLevel()`**（源码断言 —— 见上面那段说清力气的注）',
  saveAt >= 0 && /level:\s*restrictionLevel\(/.test(saveBody) && /updateProfile\(/.test(sheetSrc.slice(saveAt)),
  saveAt < 0 ? '找不到 `const save`' : 'save 里有这一句'
)

const LEVELS = ['高危', '中危', '低危']
/*
  ⚠️ **合成类型 `'ghost'`,不是某个真类型。** 下午这两条用的是 `'dislike'`;
  它删掉之后「不拦的类型」在 `RestrictionType` 里一个都不剩,这两条要么变成
  只剩一半(配对断少一半就立不住)、要么就得**造一个**出来。选后者。

  `'ghost'` 会被 `restrictionLabel` 渲染成「香菜undefined」,所以锚点单独断
  「那一行渲染出来了」(`香菜`),不靠那个标签 —— 否则这两条会跟着标签一起
  变成「两边都错 ⇒ 绿」。
  红法:`RestrictionSheet` / `ProfileScreen` 里那两处 `hardBlocks(...) &&` 去掉。
*/
const GHOST_TYPE = 'ghost'
const sheetWith = (type) =>
  sheetFor('diet', { ...noRestriction, restrictions: [{ item: '香菜', type, level: '高危' }] })
check(
  '**面板收起行：不拦的类型不显示等级，拦的显示**',
  sheetWith(GHOST_TYPE).includes('香菜') &&
    !LEVELS.some((l) => sheetWith(GHOST_TYPE).includes(`>${l}</span>`)) &&
    LEVELS.some((l) => sheetWith('taboo').includes(`>${l}</span>`)),
  `表外类型 ${LEVELS.filter((l) => sheetWith(GHOST_TYPE).includes(`>${l}</span>`)).join('/') || '无'} · 忌口 ${
    LEVELS.filter((l) => sheetWith('taboo').includes(`>${l}</span>`)).join('/') || '无'
  }`
)
const profileWith = (type) => {
  /* 借一次档案渲染，借完还回去 —— 这一段在 `demoRestrictions` 定义之前，
     所以就地取、就地还，不引用那个后面才有的常量 */
  const before = store.getSnapshot().profile.restrictions
  store.updateProfile({ restrictions: [{ item: '香菜', type, level: '高危' }] })
  const html = renderPage(profileScreen.default, '/profile')
  store.updateProfile({ restrictions: before })
  return html
}
check(
  '**档案页那一行：不拦的类型不显示等级，拦的显示**',
  profileWith(GHOST_TYPE).includes('香菜') &&
    !LEVELS.some((l) => profileWith(GHOST_TYPE).includes(`>${l}</span>`)) &&
    LEVELS.some((l) => profileWith('taboo').includes(`>${l}</span>`)),
  `表外类型 ${LEVELS.filter((l) => profileWith(GHOST_TYPE).includes(`>${l}</span>`)).join('/') || '无'} · 忌口 ${
    LEVELS.filter((l) => profileWith('taboo').includes(`>${l}</span>`)).join('/') || '无'
  }`
)

/* ------------------------------------------------------------
   预设词里不许再有忌口型的词
   ------------------------------------------------------------
   「饮食偏好」是一格**从不参与拦菜**的地方，而它原来自己的预设词里摆着
   「不吃香菜」「忌生冷」—— 点一下就进了一个不会被拦截的格子，全程没有提示。
   这一格自己的 hint 还在说「要拦菜请用下面『忌口』」，和它自己的预设词互相打脸。

   ⚠️ **这一条是快照，不是不变式 —— 如实说清。** 「这个词算不算忌口」没有机器判据
   （靠的是人读一遍:能不能拿去 `in` 一个菜名）。所以它证明的只有「那两个词没有被
   加回来」，证明不了「新加的词都是干净的」。真正的守卫是这张表被人读过。
   红法:往 `DIET_PRESET_WORDS` 里加回 `'不吃香菜'`。
   ------------------------------------------------------------ */
const dietSpec = specOf('dietaryPreferences')
const dietWords = dietSpec.options
check(
  '**「饮食偏好」的预设词里没有忌口型的词**（快照 —— 新加的词仍然要人读一遍）',
  Array.isArray(dietWords) &&
    dietWords.length > 0 &&
    ['不吃香菜', '忌生冷', '不吃葱姜蒜'].every((w) => !dietWords.includes(w)),
  Array.isArray(dietWords) ? dietWords.join(' / ') : '拿不到那张表'
)
/*
  这一格自己的 placeholder 原来写的是「如『不吃葱姜蒜』」—— 又一句教人填错框的话，
  而且它和上面那张预设词表**在同一个编辑器里**。判据同上:能不能拿去 `in` 一个菜名。
*/
check(
  '**「饮食偏好」的 placeholder 也不再教用户填忌口**（快照）',
  !!dietSpec.other?.placeholder && !/不吃|忌生冷/.test(dietSpec.other.placeholder),
  dietSpec.other?.placeholder ?? '没有 placeholder'
)

/* ------------------------------------------------------------
   忌口面板上那三颗预设胶囊（2026-09-22 傍晚新加）
   ------------------------------------------------------------
   它们是**打这儿来的**:那三个词原来在 `DIET_PRESET_WORDS` 里（判据是
   「整体模式」时归偏好），判据换成「喜欢吃的 / 不想吃的」之后搬进忌口。

   ⚠️ 和别的「点一下就加一条」不同,这三颗**插进去的行会真的参与拦截**
   （本地逐道菜核对、线上随档案发）。所以断的不只是「渲染出来了」,还有
   **那一行的类型和等级** —— 尤其是等级:线上两个拦截节点判的都是
   `severity == "high"`,`高危` 会让用户问一句「素食晚餐吃什么」被 App 自己拦掉。
   ------------------------------------------------------------ */
const dietPresetChips = typesMod.TABOO_PRESET_WORDS
const chipSheet = sheetFor('diet', noRestriction)
check(
  '**忌口面板上那三颗胶囊真的渲染出来了**（面板里那排一键加的词）',
  Array.isArray(dietPresetChips) &&
    dietPresetChips.length > 0 &&
    dietPresetChips.every((w) => chipSheet.includes(`>${w}</button>`)) &&
    /* 锚点:面板本身渲染出来了,否则上面那句在整屏炸掉时会假绿 */
    chipSheet.includes('添加一条') &&
    /* ⚠️ 位置也要断:它们在「添加一条」**上方**。排到下面去的话读起来像是列表的
       补充说明,而它们其实是一键版的「添加一条」—— 排序是文案的一部分。 */
    chipSheet.indexOf(`>${dietPresetChips[0]}</button>`) < chipSheet.indexOf('添加一条'),
  Array.isArray(dietPresetChips)
    ? dietPresetChips.map((w) => `${w}:${chipSheet.includes(`>${w}</button>`)}`).join(' ')
    : '拿不到那张表'
)
/*
  ⚠️ 健康段**不许**出现这三颗 —— 它们插进去的行落在饮食段,渲染在另一张卡上会
  「点了没反应」(那一行在眼前这一屏里根本不出现)。
  判据在 `tabooPresetChips` 里（按「这一行会落到哪一段」派生,不是 `section === 'diet'`）。
*/
check(
  '**那三颗胶囊不出现在「过敏与用药」面板里**（它们插的行落在另一张卡上）',
  !Array.isArray(dietPresetChips) || !dietPresetChips.some((w) => emptySheet.includes(`>${w}</button>`)),
  Array.isArray(dietPresetChips)
    ? dietPresetChips.map((w) => `${w}:${emptySheet.includes(`>${w}</button>`)}`).join(' ')
    : '拿不到那张表'
)
/*
  ⚠️ 点出来的行:类型必须是 `taboo`（饮食段唯一的类型）、等级必须是「低危」。
  等级那半是**替用户定的一个技术判断**,理由写在 `tabooPresetRestriction` 上面。
  红法:把那个函数的 `level` 改成 `'高危'`。
*/
const presetRow = typesMod.tabooPresetRestriction(dietPresetChips[0])
check(
  '**胶囊插进去的行是「忌口 · 低危」，而且落在饮食段**（高危会让线上拦掉用户自己的提问）',
  presetRow.type === 'taboo' &&
    presetRow.level === '低危' &&
    presetRow.item === dietPresetChips[0] &&
    typesMod.restrictionSection(presetRow) === 'diet',
  `${presetRow.item} / ${presetRow.type} / ${presetRow.level} / ${typesMod.restrictionSection(presetRow)}`
)
/*
  ⚠️ 「已经加过的那颗置灰」—— 不置灰的话连点两下会撞上查重,弹出「填了两条」
  那种**手误**的措辞,而用户是照着按钮点的。
  红法:把 `tabooPresetChips` 里那个 `have.has(word)` 改成恒 `false`。
*/
const chipsEmpty = typesMod.tabooPresetChips('diet', [])
const chipsTaken = typesMod.tabooPresetChips('diet', [{ item: dietPresetChips[0] }])
check(
  '**加过的那颗胶囊标记成「已经有」，没加的不标记**',
  chipsEmpty.length === dietPresetChips.length &&
    chipsEmpty.every((c) => !c.taken) &&
    chipsTaken.find((c) => c.word === dietPresetChips[0])?.taken === true &&
    chipsTaken.filter((c) => c.taken).length === 1,
  `${chipsEmpty.filter((c) => c.taken).length} / ${chipsTaken.filter((c) => c.taken).length}`
)
check(
  '**胶囊不给到别的段**（给错段就是往另一张卡插行，用户点了没反应）',
  typesMod.tabooPresetChips('health', []).length === 0 &&
    typesMod.tabooPresetChips('diet', []).length > 0,
  `健康 ${typesMod.tabooPresetChips('health', []).length} · 饮食 ${typesMod.tabooPresetChips('diet', []).length}`
)
/*
  ⚠️ 偏好那三颗**只剩喜欢吃的**（快照,如实说清:它证明的是「那三个词不在了」,
  证明不了「新加的词都是喜好」—— 后者的守卫是人把这张表读一遍）。
  红法:往 `DIET_PRESET_WORDS` 里加回 `'素食'`。
*/
check(
  '**「饮食偏好」剩三颗,全是喜好的**（快照 —— 词表仍然要人读一遍）',
  Array.isArray(dietWords) && dietWords.join() === '爱吃鱼,爱吃粗粮,爱吃甜食',
  Array.isArray(dietWords) ? dietWords.join(' / ') : '拿不到那张表'
)
/*
  ⚠️ 那三颗也**不许再出现在偏好那一格里** —— 同一个词在两个格子里各有一次
  「点一下就进去」的机会,是这一轮改动最可能漏掉的一处。
*/
check(
  '**胶囊那三个词不在「饮食偏好」的预设词里**（一个词只属于一个格子）',
  Array.isArray(dietWords) &&
    Array.isArray(dietPresetChips) &&
    dietPresetChips.every((w) => !dietWords.includes(w)),
  Array.isArray(dietWords) ? dietWords.join(' / ') : '拿不到那张表'
)
/*
  那一格唯一的那句说明。

  ⚠️ 这句话这一天改了两回,如实记下来:
    · 原文「要拦菜请用下面『忌口』—— 那里填的词会被逐道菜核对并硬拦截」。
      下午它错在两处:指路牌用的是旧名（入口那时叫「忌口与不爱吃」），而且
      **断了一件不再是真的事**（下面那格里当时有「不爱吃」，那一类不拦）。
      于是删短成「只说这一格自己的性质」。那一版**连「忌口」两个字都不提**。
    · 傍晚「不爱吃」删掉、入口名回到「忌口」,于是**指路牌又该指回「忌口」**了
      —— 这一格和下面那一格的关系没变(那边拦、这边不拦),变的是那格的名字。
  所以这条断言也跟着翻:现在**要求**它提到 `dietEntryNow`(派生,今天就是
  「忌口」),而**不许**出现那两个旧名。

  ⚠️ 断的是**声明出来的那句话**，不是渲染出来的:这一格带 `hint` 的展开块是组件
  内部状态，静态 SSR 够不着（同 `restrictionSuffixSuggestion` 那一类）。
  红法:把 hint 里的「忌口」改成「忌口与不爱吃」。
*/
check(
  '**那一格说清它自己不拦菜，且不替下面那格下断语**',
  !!dietSpec.other?.hint &&
    dietSpec.other.hint.includes('不会被拿去拦菜') &&
    /* 指路只指到入口名本身（今天就是它），不写「栏」「格」这类会过期的说法 */
    dietSpec.other.hint.includes(dietEntryNow) &&
    /* ⚠️ 这里原来是 `!hint.includes('「忌口」')` —— 那时入口叫「忌口与不爱吃」，
       引用下位词「忌口」等于指向一个页面上不存在的名字。入口名绕了一圈又回到
       「忌口」，所以那一句**反过来**了:现在必须引用它(上面 `includes(dietEntryNow)`
       断的就是这件事)，而**旧名才是不能出现的那一个**。 */
    !dietSpec.other.hint.includes('忌口与不爱吃') &&
    !dietSpec.other.hint.includes('忌口与偏好') &&
    !dietSpec.other.hint.includes('并硬拦截'),
  dietSpec.other?.hint ?? '没有 hint'
)
/*
  ⚠️ 引导页第 2 步那一格是**同一个字段的另一个入口**，文案却在另一个文件里各写一份
  —— 换预设词表时它自动跟着改（同一张表），placeholder 是字面量、不会。原来它是
  「不吃葱姜蒜」，也就是说同一个字段在两个屏上说两种话。这一条读源码，理由是引导页
  停在第 0 步、第 2 步那一屏在 SSR 里到不了（步数是组件内部状态）。
*/
const welcomeSrc = await readFile('src/screens/WelcomeScreen.tsx', 'utf8')
/* 断的是那个**字面量**，不是这两个字出现过 —— 上面那段注释里就写着旧文案 */
const welcomePlaceholders = [...welcomeSrc.matchAll(/placeholder: '([^']*)'/g)].map((m) => m[1])
/*
  ⚠️ 期望的字面量从 `dietSpec.other.placeholder` **派生**，不写第二份。
  这两个屏装的是同一个字段，判据就是「两处写的必须是同一句话」——
  写死一个字面量的话，改了一处之后这条断言会跟着旧值一起变绿。
  红法:只改 `InlineField.tsx` 那一处 placeholder。
*/
check(
  '**引导页那一格的 placeholder 和档案页逐字相同**（同一个字段，不许两种说法）',
  welcomePlaceholders.length > 0 &&
    welcomePlaceholders.every((p) => !/不吃|忌生冷/.test(p)) &&
    welcomePlaceholders.includes(dietSpec.other.placeholder),
  welcomePlaceholders.join(' / ') || '一个 placeholder 都没读到'
)

/*
  忌口按类型拆到两张卡 —— **这是「没有孤儿行」在渲染层的断言**。

  每种类型各来一条，看它们各自落在哪张卡里。取标签走 `restrictionLabel`
  （和页面用的是同一个函数），不自己拼字符串。

  ⚠️ 这条盯的是那个最坏的失败：某个类型两边都不认 → 那一行**在两张卡里都不出现**
  → 用户再也看不到、也永远改不了，可它照样随档案发给工作流、照样拦菜。所以除了
  「该在的都在了」，还要断**合起来正好是整份数组**。
  红法：把 `restrictionSection` 的两个分支对调 → 三条全落错卡。

  ⚠️ 这里原来还有一条 `{ item:'辣', type:'preference' }`，`preference` 删掉时
  一起去掉了（它会渲染成 **`辣undefined`**，而下面 `every(... || ...)` 里那个
  `||` 会让断言**照样绿着** —— 绿着，同时页面是错的）。下午 `dislike` 回来时
  变成四条，傍晚它又走了，**回到三条**：健康段 2、饮食段 1。

  ⚠️ 例子跟着类型表走：**类型表加一个取值，这里就要加一条**，否则新类型落错卡
  也没人看得见（它不在 `THREE_TYPES` 里，`landedIn` 根本不会问它）。
  ⚠️ 这条是这一天里**唯一一条差点「静默活下来」的**:改完之后夹具里那条
  `type:'dislike'` 渲染出来的字和断言期望的字会一起变成「折耳根undefined」
  —— 两边同错 ⇒ 绿。所以它**不能等红灯**,只能靠人对着类型表数一遍。
*/
const demoRestrictions = store.getSnapshot().profile.restrictions
const THREE_TYPES = [
  { item: '花生', type: 'allergy', level: '高危' },
  { item: '二甲双胍', type: 'drug', level: '中危' },
  { item: '香菜', type: 'taboo', level: '低危' },
]
store.updateProfile({ restrictions: THREE_TYPES })
const splitHtml = renderPage(profileScreen.default, '/profile')
const splitSlices = slicesOf(splitHtml)
const landedIn = (n) => THREE_TYPES.filter((r) => splitSlices[n]?.includes(`>${typesMod.restrictionLabel(r)}</span>`))

check(
  '**过敏和用药落在健康信息那张卡里**',
  landedIn(1).length === 2 && landedIn(1).every((r) => r.type === 'allergy' || r.type === 'drug'),
  landedIn(1).map((r) => r.item).join(' / ') || '一条都没有'
)
/*
  ⚠️ 饮食段那一半断的是「**那一条**确实在饮食卡里」，不只是条数。
  只断 `length === 1` 的话，`taboo` 跑到健康卡、`drug` 跑到饮食卡（正好还是
  健康 2 / 饮食 1）照样绿 —— 而那正是这条要抓的东西。
*/
check(
  '**忌口落在饮食信息那张卡里**',
  landedIn(2).length === 1 && landedIn(2).every((r) => r.type === 'taboo'),
  landedIn(2).map((r) => r.item).join(' / ') || '一条都没有'
)
check(
  '**两张卡合起来正好是整份数组**（一条不重、一条不漏 —— 没有孤儿行）',
  landedIn(1).length + landedIn(2).length === THREE_TYPES.length &&
    new Set([...landedIn(1), ...landedIn(2)].map((r) => r.item)).size === THREE_TYPES.length,
  `健康 ${landedIn(1).length} + 饮食 ${landedIn(2).length} = ${THREE_TYPES.length}`
)
/* 这一节借了档案里的忌口来渲染，还回去 —— 下面的断言不该看见这三条 */
store.updateProfile({ restrictions: demoRestrictions })

/* ------------------------------------------------------------
   ⚠️ 演示档案**自己**也要断一次 —— 它是每一个用户第一眼看到的那份档案
   ------------------------------------------------------------
   上面那一节借的是造出来的夹具。这一节拿 `defaults.ts` 里那份**真**演示档案
   渲染一遍:一条 `type` 写错(比如删掉 `dislike` 之后还留着它)会让
   `restrictionLabel` 拼出 **`香菜undefined`**,而那一行照样渲染、页面照样
   打开、控制台一个字都不报。

   ⚠️ 判据分两半,少一半都会变成假绿:
     · 「每条都渲染成了它自己的标签」—— 两边都走 `restrictionLabel`,
       夹具写错时**两边同错**,所以这半句单独用会静默地绿(下午那版
       `FOUR_TYPES` 就是这么差点活下来的)。
     · 「整页没有 `undefined` 四个字母」—— 这半句才是真正抓住那个错的东西。
   锚点是两个入口行都在:整页渲染炸掉时,前半句会因为「找不到」而红、后半句会假绿。
   红法:`defaults.ts` 里把演示档案那条「香菜」的 `type` 改成表外的值。
*/
const demoHtmlNow = renderPage(profileScreen.default, '/profile')
check(
  '**演示档案里的每一条忌口都渲染成了自己的标签，且整页没有 `undefined`**',
  /* ⚠️ 这里用 `entryOf`（它在上面的面板那一节就定义好了），不是 `healthEntryNow`
     —— 那个常量在这一节**之后**才定义，用它就是 TDZ 报错。 */
  demoHtmlNow.includes(`>${entryOf('health')}</span>`) &&
    demoHtmlNow.includes(`>${dietEntryNow}</span>`) &&
    demoRestrictions.every((r) => demoHtmlNow.includes(typesMod.restrictionLabel(r))) &&
    !demoHtmlNow.includes('undefined'),
  `忌口 ${demoRestrictions.map((r) => typesMod.restrictionLabel(r)).join(' / ')} · undefined ${
    demoHtmlNow.includes('undefined') ? '在' : '不在'
  }`
)

/* ---------- 档案页上一行都不许「有值没名字」 ---------- */
/*
  用户 2026-09-22 报的原话:「慢性病下面有个空栏,只写了无」。

  病根:两个忌口分组各自单起一行做空态,而那一行**只有值、没有名字** ——
  渲染出来是 `慢性病 无 / 无 / 过敏与用药 增删改`,中间孤零零一个「无」,
  读起来像一个长坏了的空栏。现在那个「无」写在入口行**自己的值位**上
  (`过敏与用药  无  ›`),少了整整一行,而每一行都有名字。

  ⚠️ 判据是**结构**不是文案:`ListRow` 在没有 label 时照样渲染一个空的行名 span,
  所以「有值没名字」的签名 = 左边那个黑 15px 的 span 是空的。数它必须为 0。
  锚点:同一次渲染里两个入口行的名字都在 —— 渲染整个炸掉时 0 会假绿。

  红法:把 `restrictionBlock` 里那一个 `<ListRow value={rows.length === 0 ? '无' : '增删改'}>`
  拆回「一个无名的 `<ListRow value="无" secondary />` + 一个 `value="增删改"` 的入口行」。
  下面那对「值位两种取值」正是为了把这件事的**两头**都钉住。
*/
store.updateProfile({ restrictions: [] })
const bareHtml = renderPage(profileScreen.default, '/profile')
store.updateProfile({ restrictions: demoRestrictions })

const NAME_SLOT = '<span class="shrink-0 text-[15px] leading-[22px] text-ink"></span>'
const bareCount = bareHtml.split(NAME_SLOT).length - 1
/* 两个入口行的名字 —— 定位用；`ListRow` 的行名 span 就是这个样子。
   ⚠️ 名字从 `RESTRICTION_SECTIONS` 取，不写字面量：这里曾经写死过
   `'忌口'`，改名那天两条都红在这一个参数上，而不是红在「那一行不见了」。 */
const entryAt = (html, name) => html.indexOf(`>${name}</span>`)
const valueAfter = (html, name) => {
  const at = entryAt(html, name)
  return at < 0 ? null : />(无|增删改)<\/span>/.exec(html.slice(at, at + 400))?.[1] ?? null
}
const healthEntryNow = typesMod.restrictionSectionShape('health').entry

check(
  '**一条忌口都没有时，也没有哪一行是「有值没名字」的**（那个无名「无」不许长回来）',
  bareCount === 0 &&
    entryAt(bareHtml, healthEntryNow) >= 0 &&
    entryAt(bareHtml, dietEntryNow) >= 0,
  `无名行 ${bareCount} 个`
)
check(
  '**忌口空着时「无」写在入口行自己的值位上**',
  valueAfter(bareHtml, healthEntryNow) === '无' && valueAfter(bareHtml, dietEntryNow) === '无',
  `${healthEntryNow} ${valueAfter(bareHtml, healthEntryNow)} / ${dietEntryNow} ${valueAfter(bareHtml, dietEntryNow)}`
)
check(
  '**有忌口时同一个值位写「增删改」**（两种取值共用一个位置，不是两个说法）',
  valueAfter(splitHtml, healthEntryNow) === '增删改' && valueAfter(splitHtml, dietEntryNow) === '增删改',
  `${healthEntryNow} ${valueAfter(splitHtml, healthEntryNow)} / ${dietEntryNow} ${valueAfter(splitHtml, dietEntryNow)}`
)

/*
  词表那四格的胶囊**只在展开之后才出现** —— 收起的行上是顿号连起来的一句话。
  断一对:收起时一个 `role="checkbox"` 都没有,点开才有。

  ⚠️ 两条都带上 `wordKeys.length === 4` 的前提:`every` 在空数组上恒为真,
  表要是被改坏了(一个 chips 都不剩),这两条会变成一对假绿。
*/
check(
  '**收起的行里没有胶囊**(词表在行上是一句话,不是一排胶囊)',
  wordKeys.length === 4 && wordKeys.every((k) => !renderCell(k, false).includes('role="checkbox"')),
  wordKeys.filter((k) => renderCell(k, false).includes('role="checkbox"')).join(' / ') || `${wordKeys.length} 格`
)
check(
  '**点开之后胶囊就在展开块里**(四张词表都给得出东西)',
  wordKeys.length === 4 && wordKeys.every((k) => renderCell(k, true).includes('role="checkbox"')),
  wordKeys.filter((k) => !renderCell(k, true).includes('role="checkbox"')).join(' / ') || `${wordKeys.length} 格`
)
check(
  '**页面上 aria-expanded 的条数 === 可开合的那几格**(条数从表里取)',
  (cellsHtml.match(/aria-expanded="/g) ?? []).length === expandableKeys.length,
  `期望 ${expandableKeys.length},实际 ${(cellsHtml.match(/aria-expanded="/g) ?? []).length}`
)
check(
  '全收起时每一格都是 aria-expanded="false"',
  (cellsHtml.match(/aria-expanded="false"/g) ?? []).length === expandableKeys.length
)
check(
  '**体征那三格不带 aria-expanded**（打开的是一层对话框,不是开合块）',
  pickerKeys.length === 3 && expandableKeys.length === FIELD_KEYS.length - pickerKeys.length,
  `${pickerKeys.join(' / ')}`
)
check('收起态没有任何展开块(也就没有任何编辑控件)', !cellsHtml.includes('id="profile-field-'))

/* ---------- 开合组：开着那一格 ---------- */
const openChips = renderCell('chronicConditions', true)
check('**开着的那一格 aria-expanded="true"**', openChips.includes('aria-expanded="true"'))
check(
  '**它指向的 id 真的在同一个产物里**(不是指向一个不存在的地方)',
  (() => {
    const id = openChips.match(/aria-controls="([^"]+)"/)?.[1]
    return !!id && openChips.includes(`id="${id}"`)
  })(),
  openChips.match(/aria-controls="([^"]+)"/)?.[1] ?? '没写 aria-controls'
)
check(
  'id 里带着字段名(不是十格共用一个常量)',
  openChips.includes('id="profile-field-chronicConditions"'),
  '写成常量的话十格的 id 会撞在一起,aria-controls 指向第一格'
)
check(
  '**关着时不写 aria-controls**(收着的时候那个 id 不存在,写了就是指向空处)',
  !renderCell('chronicConditions', false).includes('aria-controls')
)

/* ---------- 自填口组：四栏能自己写、其余六格一个口都没有 ---------- */
const otherLabels = wordKeys.map((k) => (renderCell(k, true).match(/aria-label="([^"]*其他)"/) ?? [])[1])
check(
  '**四栏都能自己写**(健康目标 / 饮食偏好 / 特殊阶段 / 慢性病)',
  otherLabels.every(Boolean) && otherLabels.length === 4,
  otherLabels.join(' / ')
)
check(
  '**四个「其他」口互不相同**(不是同一格渲染了四遍)',
  new Set(otherLabels).size === wordKeys.length
)
check(
  '**其余六格开出来一个「其他」口都没有**',
  FIELD_KEYS.filter((k) => !wordKeys.includes(k)).every((k) => !/aria-label="[^"]*其他"/.test(renderCell(k, true)))
)

/* ---------- 文本组：草稿和写入规则 ---------- */
const notesOpen = renderCell('notes', true)
check(
  '**已有的补充说明被带进展开块**(是框里的值,不是旁边一句说明)',
  notesOpen.includes('>在吃二甲双胍</textarea>'),
  '补的是「读得出来」这一半:只写得进、读不出的字段比没有更糟'
)
const notesClosed = renderCell('notes', false)
check(
  '收起时那一行还在、值也还在(这条是上面那条的锚点)',
  notesClosed.includes('其他补充') && notesClosed.includes('在吃二甲双胍')
)
check('**收起时没有输入框**', !notesClosed.includes('<textarea') && !notesClosed.includes('<input'))
/*
  ⚠️ **这一条为什么住在这儿,而不是跟「每张卡里的字段名」那几条放一起。**
  它第一版就写在那儿,只读 `cellsHtml`(整页、**全是收起态**),名字却叫
  「档案页上没有旧名」—— 验红时露了馅:把旧名塞进那一格的 `note` 文案
  (「这段话会原样发给食衡……」那句,只在抽屉**展开**时渲染),它**一动不动**。
  静态渲染一次只能拿到一种开合状态,所以「整页」和「这一格开着」得一起读。

  「那一行的名字」2026-09-22 从「想告诉食衡的其他事」改成「其他补充」。
  改名最容易漏的是「新名字加上了、旧名字还留着」—— 这个字面量在这一页有三个
  出口:`InlineField` 的 `label`(渲染成行名 + 抽屉的 `aria-label`,两处都从它派生)
  和 `note` 那句说明。漏一处就是屏幕上同时挂着两个说法。

  锚点是**新名字本身**:渲染整个炸掉的页面同样「不含旧名字」,那种绿是假的。
  红法(两条都验过):
    · `InlineField` 里 `label` 改回旧名 → 新名消失 + 旧名出现,两头都红
    · `label` 不动,往 `note` 文案里塞回旧名 → 本条红(第一条红法漏掉的那种)
*/
check(
  '**档案页（整页收起 + 这一格展开）都没有「想告诉食衡的其他事」**（那是旧名，新名是「其他补充」）',
  notesClosed.includes('其他补充') &&
    notesOpen.includes('其他补充') &&
    !cellsHtml.includes('想告诉食衡的其他事') &&
    !notesOpen.includes('想告诉食衡的其他事'),
  `整页 新名 ${cellsHtml.includes('其他补充')} / 旧名 ${cellsHtml.includes('想告诉食衡的其他事')}` +
    ` · 展开 新名 ${notesOpen.includes('其他补充')} / 旧名 ${notesOpen.includes('想告诉食衡的其他事')}`
)
/*
  「清空算不算一次修改」是一条**规则**,静态渲染碰不到(`onChange` 永远不触发),
  所以它被抽成了纯函数 —— 这里直接调它。这是这一节能验到写入规则的唯一入口。
*/
check(
  '**没改就不写**(否则每次开合都是一次落盘)',
  inlineField.draftPatch('name', '  ', { ...store.getSnapshot().profile, name: '' }) === null
)
check(
  '**清空算一次修改**(空名字在那一行显示「无」,和其余九格同一个词)',
  inlineField.draftPatch('name', '', { ...store.getSnapshot().profile, name: '张颖' })?.name === ''
)
check(
  '**前后空格会被吃掉**(存的是 trim 过的值)',
  inlineField.draftPatch('notes', '  在吃二甲双胍，少喝汤  ', store.getSnapshot().profile)?.notes === '在吃二甲双胍，少喝汤'
)
/*
  这一条挡的是**静默清空**:草稿要是从空串起步,用户点开「补充说明」再点回去,
  draftPatch 会把 '' 和档案里那段话一比(不相等),然后写下去一条空 notes ——
  用户看到的是「点了一下,我写的东西没了」,而且一声不响。
*/
check(
  '**打开那一格时草稿从档案里来**(从空串起步会静默写掉一整格)',
  inlineField.draftSeed('notes', store.getSnapshot().profile) === '在吃二甲双胍' &&
    inlineField.draftSeed('name', { ...store.getSnapshot().profile, name: '张颖' }) === '张颖'
)
check('非文本框的草稿是空串(它们不走草稿这条路)', inlineField.draftSeed('goals', store.getSnapshot().profile) === '')

/* ---------- 体征组：滚轮是面板,不是行内块 ---------- */
check('**首屏没有常驻的滚轮**(三个轮子排下来就是一根柱子)', !cellsHtml.includes('role="slider"'))
check(
  '**开着体征那一格时行内也没有滚轮**(它是 z-50 的面板,塞进行里页面会跳)',
  !renderCell('height', true).includes('role="slider"') && !renderCell('birth', true).includes('role="slider"')
)
check(
  '**体征那三格开着也不长展开块**(它们没有可开合的东西)',
  pickerKeys.every((k) => !renderCell(k, true).includes(`id="profile-field-${k}"`))
)

/* ---------- 删掉的东西组 ---------- */
check('页头还有「调整」(它没被动)', cellsHtml.includes('>调整</span>'))
check('**页头不再有「编辑」**', !cellsHtml.includes('>编辑</span>'))
check('**页面上再没有「编辑档案」**(那张一次改十格的面板不存在了)', !cellsHtml.includes('编辑档案'))

/* ---------- 先存再问组：editProfile 的顺序 ---------- */
/*
  纯 store,不需要渲染任何东西。这一组盯的是档案页那十格共用的那一次写 ——
  「存下来」和「问不问」的顺序、以及 `before` 取哪一份。
*/
console.log('\n=== 改一格:先存,再问 ===')
store.updateProfile({ chronicConditions: [], quotaOverrides: { sodium: 1200 }, goals: [], specialStages: [] })
const advice1 = store.editProfile({ chronicConditions: ['高血压'] })
check(
  '**先存**:editProfile 返回之前档案已经写下去了',
  store.getSnapshot().profile.chronicConditions.includes('高血压')
)
check(
  '**再问**:钠被手改钉在 1200、高血压想把它变成 1500 —— 恰好问这一条',
  advice1.length === 1 && advice1[0].key === 'sodium' && advice1[0].pinned === 1200 && advice1[0].suggested === 1500,
  JSON.stringify(advice1)
)
const advice2 = store.editProfile({ goals: ['控糖'] })
check(
  '**同一份档案再改一次不再问第二遍**(before 取 store 里那一刻,不是陈旧缓存)',
  advice2.length === 0,
  JSON.stringify(advice2)
)
store.updateProfile({ quotaOverrides: {} })
const advice3 = store.editProfile({ specialStages: ['孕期'] })
check(
  '**没被手改钉住的不问**(孕期会改热量,但热量没人钉过)',
  advice3.length === 0,
  JSON.stringify(advice3)
)

/*
  还原来宾状态。

  `profiles` 里那个「第二份」要删掉,否则它会跟着后面的断言一路走下去 ——
  这一节之外还有几段渲染(Agent 回复卡片),它们不该被一份多出来的档案影响。
*/
store.updateProfile({ chronicConditions: [], quotaOverrides: {} })
store.deleteProfile(secondId)
store.resetToSeed()
const restored = store.getSnapshot()
check(
  '本节结束时 store 回到单档案的演示状态',
  restored.profiles.length === 0 && restored.profile.restrictions.length > 0 && restored.meals.length > 0,
  `${restored.profiles.length} 份其它档案 / ${restored.meals.length} 条记录`
)

/* ------------------------------------------------------------
   对话页的语音按钮 —— 语音输入里唯一能在这里断的部分
   ------------------------------------------------------------
   `renderToStaticMarkup` **不跑 effect**,所以依赖 `listening` 的界面在这里
   够不到(那正是上面「两个 ConfirmSheet 的正文断不到」同一个陷阱)。
   但 Node 恰好就是「浏览器不支持」那个分支,而**不支持时按钮照常渲染**是
   一个刻意的设计决定 —— 静默藏掉入口,用户分不清「App 没这功能」和
   「App 在这台机器上坏了」。所以这两条断言真的在盯东西:

     · 没有 SpeechRecognition 时组件不抛(上面 CASES 那一圈已经证明了)
     · 按钮在,且带 `aria-label="语音输入"`

  三态里只有「麦克风」和「发送」在 SSR 里可达(`input` 是空的),
  「停止」要 `listening === true`,那是纯函数 `slotFor` 的地盘 ——
  `scripts/verify-speech.mjs` 里三态全覆盖。
   ------------------------------------------------------------ */
console.log('\n=== 对话页的语音按钮 ===')

// Node 里没有 window,所以 pickCtor 必然拿不到构造函数 —— 这不是「碰巧」,
// 正是这个 harness 能替我们验「不支持分支」的原因
const speechLib = await server.ssrLoadModule('/src/lib/speech.ts')
const speechCtorMissing = speechLib.pickCtor(globalThis.window) === undefined

const chatScreen = await server.ssrLoadModule('/src/screens/ChatScreen.tsx')

/*
  ⚠️ 这一句**刻意包了 try/catch**,理由不是「怕崩」,是「别崩在这里」。

  这一页现在挂着 `UnloggedMealSheet`。那张弹窗的守卫一旦坏掉
  (`if (!open || !meal)` 不生效),常态下的 `/chat` —— `meal` 是 null、
  面板是关着的 —— 会在 `meal.at` 上抛。抛在这里的话**整个脚本当场结束**,
  下面每一节都不再执行,包括第 3240 行那一节**真正负责给这件事定性的断言**。

  那条断言会打印 FAIL 吗?不会 —— 它压根没跑到。而弄坏对照表按「有没有打印出
  带这个 label 的 FAIL 行」判红绿,于是这次真真切切的坏,**输出长得和绿一模一样**
  (这个仓库点过名的那类假绿:崩溃不是失败)。

  所以这里降级成一句会红的断言(空串 → 上面四条各自变红),把「定性」留给
  下面那一节。降级只影响这一句的报错方式,不影响它盯的东西。
*/
const chatHtml = (() => {
  try {
    return renderPage(chatScreen.default, '/chat')
  } catch (e) {
    return `✗抛了 ${e}`
  }
})()

check('Node 里没有语音识别(所以走的就是「不支持」那条分支)', speechCtorMissing)
check('**不支持时麦克风仍然渲染出来**', chatHtml.includes('aria-label="语音输入"'), '藏掉入口就分不清是没功能还是坏了')
check('输入框为空时的第三格是麦克风,不是置灰的发送键', !chatHtml.includes('aria-label="发送"'))
check('麦克风有 aria-label(读屏用户听到的是这三个词)', /aria-label="语音输入"/.test(chatHtml))

// 点它才能打开的那一屏:面板的文案在这里够不到(useState 关着),
// 但面板自身是可以直接渲染的 —— 它是 `open` 为 prop 的独立组件
const speechSheet = await server.ssrLoadModule('/src/components/SpeechSheet.tsx')
const speechSheetHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, null, React.createElement(speechSheet.SpeechSheet, { open: true, onClose: () => {} }))
)
check('**说明面板点了名:哪些浏览器能用**', speechSheetHtml.includes('Chrome') && speechSheetHtml.includes('Safari'))
check('也说明白了哪个不能用(不然等于没点名)', speechSheetHtml.includes('Firefox'))
check('写明了加密连接的要求', speechSheetHtml.includes('https'))
check('关掉时什么都不渲染(和其他面板一致)', renderToStaticMarkup(
  React.createElement(MemoryRouter, null, React.createElement(speechSheet.SpeechSheet, { open: false, onClose: () => {} }))
) === '')

/* ============================================================
   对话页里的三种消息 —— 附件、识别进度、结果卡
   ------------------------------------------------------------
   这一页整段交互都在 `useState` 里(攒附件、点发送、逐张推进),SSR 一步都
   够不到。能验的是**已经被搬成 props 驱动的那一层**:消息区从 `ChatScreen`
   挪到了 `ChatTranscript`,摆一个 `ChatItem` 就能渲染、也就能断言。

   ⚠️ 这正是当初把它搬出来的全部理由。留在 `ChatScreen` 里的话,「一条带两张
   图的消息」「正在识别第 2 张」「一张结果卡」三件事一件都断言不了。

   ⚠️ 结果卡上那两行热量**不在这里重新调一遍 `nutritionOfItem`** ——
   那是拿代码验代码,数字错了照样绿。这里用食物库/条目自带的那份 per100g
   现算一遍乘法,是**第二份算术**:它红了说明卡片上那个数字和来源对不上。

   ⚠️ `chatItemKind` 的优先级(#18)也放在这一节,而不是 `verify-loop` ——
   它住在 `ChatTranscript.tsx` 里,而 `verify-loop` 一个 `.tsx` 都不载
   (那一套是纯逻辑,不该因为某个组件写坏了 JSX 就一起红)。
   ============================================================ */

console.log('\n=== 对话页里的三种消息 ===')

const chatTranscript = await server.ssrLoadModule('/src/components/ChatTranscript.tsx')
const chatFoods = (await server.ssrLoadModule('/src/data/foods.ts')).FOOD_BY_ID
const chatDishMatch = await server.ssrLoadModule('/src/lib/dishMatch.ts')

const renderItems = (items, busy = false) =>
  renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(chatTranscript.ChatTranscript, { items, busy }))
  )

/* ---------- ① 一条消息该渲染成什么 ---------- */

const kindOf = (extra) => chatTranscript.chatItemKind({ id: 'k', role: 'assistant', content: '', ...extra })

check('纯文字 → bubble', kindOf({}) === 'bubble', kindOf({}))
check('一张结果卡 → meal', kindOf({ meal: { slot: '午餐', engine: 'agent', items: [] } }) === 'meal')
check('正在识别的一条 → run', kindOf({ run: { photos: 3 } }) === 'run')
check('结构化回复 → reply', kindOf({ reply: {} }) === 'reply')

/*
  ⚠️ 这两条才是**判优先级**的那两条 —— 上面四条各自只有一个字段,顺序怎么排
  都是那个答案。真正可能被写错的是「同时挂着两个字段时谁赢」,而它在现实里
  是会发生的一次:出结果时那一条是**就地**把 `run` 换成 `meal`,中间有一帧
  两个都在。
*/
check(
  '**又 run 又 meal 时 run 赢**(顺序是 reply → run → meal → bubble)',
  kindOf({ run: { photos: 3 }, meal: { slot: '午餐', engine: 'agent', items: [] } }) === 'run',
  kindOf({ run: { photos: 3 }, meal: { slot: '午餐', engine: 'agent', items: [] } })
)
/*
  ⚠️ 这一条在 2026-09-23 那天**翻过一次又翻回来了**,两次的理由都要留着:

    · 那天出事的那一幕是:拍配料表时随图打了一句话,回答**另起一条消息** ——
      屏幕上两条消息、两张卡,各顶着一条一模一样的「需注意」(用户原话是
      「很莫名其妙,还没放在一起」)。当时的修法是「两个都在时两张卡一起画」,
      于是这条断言翻成了 `mealReply`。
    · 当天又改了一次,而且是**按用户的原话改的**(「针对图片给一个答案,然后
      针对文字再给另一版答案?我不要这样,一起发的就一起回答」):那句话改成
      **跟图一起发一趟**,模型在一次回复里既认菜也答那句话 —— 于是 `meal` 和
      `reply` **根本不会再同时出现**,「两张一起画」那一支没有了。

  所以这条现在守的是**顺序**(真出现两个字段时谁赢),不是那个已经消失的事故。
  那个事故的守卫搬到了 ⑥ 的源级断言上:发图那条路**只许有一趟**。
*/
/* ---------- ①b 对话页发图遇上过敏:不硬拦(2026-09-24 用户定的口径) ---------- */

/*
  ⚠️ 用户的原话:「如果图片里有用户明确不能吃的,**不要硬拦截**,就是第一条
  明显的提醒,然后后面的菜该怎么吃就怎么吃」。

  这一节盯的是**前半句**。后半句(菜还在)拿不回来 —— 模型回了 `blocked`
  就没生成菜 —— 所以那边靠「再问一趟」,断言在 ⑥ 的源级那一段。

  ⚠️ **反方向那一条也得在**:拍餐盘那条路(`ResultScreen`)照旧硬拦,上面
  「拦截结果复用拦截卡」那两条就是它。两条放一起看,才说明这一层降级是
  **只给对话页**的 —— 少了下半条,下一个人完全可以把 `AgentReplyCard` 的
  拦截分支整个删掉,而这里全绿。

  ⚠️ 为什么这条断言能成立:`ChatTranscript` 里那句 `demoteHardBlock` 是
  **渲染时**降的,`meal.agentReply.blocked` 本身还是 `true` —— 所以它不是
  「上游正好没拦」,是这一层主动降的。
*/
const blockedChatHtml = renderItems([
  {
    id: 'bk1',
    role: 'assistant',
    content: '',
    meal: {
      slot: '午餐',
      engine: 'agent',
      items: [],
      agentReply: {
        blocked: true,
        risk: { level: 'high', message: '这盘里有花生，你的档案里写着花生过敏。', items: ['花生'] },
        mode: '',
        title: '',
        dishes: [],
        ...NO_EXTRA_BLOCKS,
        advice: [],
        disclaimer: '',
      },
    },
  },
])
check(
  '**对话页那张卡上不再出现「已为你拦截」**(用户 2026-09-24:不要硬拦截)',
  !blockedChatHtml.includes('已为你拦截'),
  blockedChatHtml.includes('已为你拦截') ? '那堵墙还在' : '没有了'
)
check(
  '**降级之后那句话还在**(只是从一堵墙变成卡顶上第一条提醒)',
  blockedChatHtml.includes('花生过敏') && blockedChatHtml.includes('高风险'),
  blockedChatHtml.includes('花生过敏') ? '那句话还在，等级也在' : '那句话跟着墙一起没了'
)

check(
  '**又 reply 又 meal 时 reply 赢**(顺序是 reply → run → meal → bubble)',
  kindOf({ reply: {}, meal: { slot: '午餐', engine: 'agent', items: [] } }) === 'reply',
  kindOf({ reply: {}, meal: { slot: '午餐', engine: 'agent', items: [] } })
)

/* ---------- ② 用户那条消息里的图 ---------- */

const photoHtml = renderItems([{ id: 'u1', role: 'user', content: '今晚这餐咸吗', photos: ['blob:one', 'blob:two'] }])
const imgSrcs = [...photoHtml.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1])

/*
  锚点:不带图的消息一个 `<img>` 都没有。没有它的话,「两个 img」可能被
  别的什么东西蹭绿(React 19 会给 `<img>` 额外吐一对
  `<link rel="preload" as="image">`,所以数 `blob:one` 出现几次是**错的** ——
  每张图会出现两次)。
*/
const noPhotoHtml = renderItems([{ id: 'u0', role: 'user', content: '你好' }])
check('不带图的消息一个 <img> 都没有(所以下面那条不是恒真)', !noPhotoHtml.includes('<img'))
check(
  '**一条带两张图的消息渲染出两个 <img>**',
  imgSrcs.length === 2,
  `${imgSrcs.length} 个 / preload 链接 ${(photoHtml.match(/rel="preload"/g) ?? []).length} 条`
)
check(
  '**而且 src 就是那两串**(换成缩略图或占位图,用户会看到自己发的图变糊)',
  imgSrcs.join(',') === 'blob:one,blob:two',
  imgSrcs.join(',')
)
check('文字和图片在同一条消息里(不是拆成两条)', photoHtml.includes('今晚这餐咸吗'))

/* ---------- ③ 「正在识别 3 张…」 ---------- */

/*
  ⚠️ 这个气泡原来写的是「正在识别第 2 张,共 3 张」,**2026-09-24 改成只说张数**
  —— 前提同分析页那一行:三张现在是并发跑的,「第几张」不再是一个真实的位置。
  两个页面共用同一句口径。
*/
const runHtml = renderItems([
  { id: 'r1', role: 'assistant', content: '', run: { photos: 3, stage: 'recognize' } },
])
const runLine = runHtml.match(/正在识别[^<]*/)?.[0] ?? ''
/*
  ⚠️ 同分析页那条:**整行相等**。写成 `includes('正在识别')` 的话,「正在识别 1 张…」
  (说的是「只发了一张」)照样绿。
*/
check(
  '**「正在识别 3 张…」**(写成 1 就成了「只发了一张」,一样像句话)',
  runLine === '正在识别 3 张…',
  runLine || '(没有那一行)'
)
check(
  '阶段文案用的是分析页那一套(不是另写一份)',
  runHtml.includes('正在识别菜品'),
  runHtml.match(/· [^<]*/)?.[0] ?? ''
)

/*
  两条锚点。

  ① 没有 `stage` 时不编一个进度出来 —— 少了这条,「阶段文案在」可能被
     `ANALYZE_STAGE_LABELS` 里任何一个值蹭绿。
  ② 单张时那一行**不说张数**(「正在识别 1 张…」是句废话)。两条一起钉住的是
     `photos > 1` 这个判据:只在 ① 上钉的话,判据写成 `photos >= 1` 也没人发现。

  ⚠️ 单张那条我一开始写成 `run: { photos: 1 }` —— 但**真实代码里 `photos` 直接
  就是 batch.length**,单张时它**有值、等于 1**。夹具照抄那个形状才有意义:
  写成 `photos: undefined` 的话钉的是一个线上不存在的形状。
*/
const runNoStageHtml = renderItems([
  { id: 'r2', role: 'assistant', content: '', run: { photos: 2 } },
])
check(
  '**没报阶段时一个字都不编**(那一行只有「正在识别 2 张…」)',
  runNoStageHtml.includes('正在识别 2 张') && !runNoStageHtml.includes('正在识别菜品'),
  runNoStageHtml.match(/正在识别[^<]*/)?.[0] ?? ''
)
const runOneHtml = renderItems([
  { id: 'r3', role: 'assistant', content: '', run: { photos: 1 } },
])
check(
  '**单张时那个气泡只说「正在识别…」,不说「1 张」**',
  runOneHtml.includes('正在识别…') && !runOneHtml.includes('正在识别 1 张'),
  runOneHtml.match(/正在识别[^<]*/)?.[0] ?? ''
)

/* ---------- ④ 结果卡 ---------- */

/** 库里那道菜。期望热量用手算的乘法,不用 `nutritionOfItem` */
const riceFood = chatFoods.get('rice')
/**
 * 库外那道菜带自己的 `per100g`(`per100gOf` 的兜底就是它)。
 * 顺带验「联网估算」那个角标 —— 少写它,用户会把模型估的数字当成库里的数。
 */
const webDish = {
  foodId: `${chatDishMatch.WEB_PREFIX}probe`,
  name: '某连锁店的鸡腿',
  grams: 120,
  per100g: { kcal: 200, protein: 20, carb: 5, fat: 10, sodium: 400, sugar: 1 },
}
const chatMealFixture = {
  slot: '午餐',
  engine: 'agent',
  items: [{ foodId: 'rice', name: riceFood.name, grams: 150 }, webDish],
}

const mealHtml = renderItems([{ id: 'c1', role: 'assistant', content: '', meal: chatMealFixture }])
const riceKcal = Math.round((riceFood.per100g.kcal * 150) / 100)
// 名字带 `Dish` 是为了不和结果页那一节里的 `webKcal` 撞 —— `const` 重名是
// 整个模块的 SyntaxError,和先后顺序无关
const webDishKcal = Math.round((webDish.per100g.kcal * 120) / 100)

check(
  '结果卡上每道菜的名字都在',
  mealHtml.includes(riceFood.name) && mealHtml.includes(webDish.name),
  `${riceFood.name} / ${webDish.name}`
)
/*
  ⚠️ **这张卡上一个数字都没有**（2026-09-24 用户定的口径，见 `MealResultCard`
  文件头最后一段）。克数、热量**全撤** —— 理由是这张卡走的是膳享+，而给库外菜
  查营养的那组节点只在食衡工作流里，此刻**算不出来**：库外那道会落到
  `ZERO_NUTRITION`，屏上印出一个 0。那个 0 就是当天的事故。

  否认到「一个都没有」这一级（`GRAM_READOUT` 认结构 + `kcal` 认热量），
  不是「克数是 0」那一级 —— 「数字不该是 0」是旧口径，现在一个都不印。
*/
check(
  '**对话里那张卡上:克数、热量一个都不印**(发图不算营养,要记日记时才调食衡)',
  !GRAM_READOUT.test(mealHtml) && !/\d+\s*kcal/.test(mealHtml),
  `克数 ${readouts(mealHtml).join('/') || '没有'} / 热量 ${mealHtml.match(/\d+\s*kcal/)?.[0] ?? '没有'}`
)
/*
  ⚠️ **正面控制,不能省。**

  同一个 `showNutrition` 开关也管着结果页(那边传的是默认值 `true`)。只留上面
  那条否定断言的话,开关**整个坏掉**(比如有人把默认值改成 `false`、或者把
  `{(showNutrition && …)}` 写成 `{false && …}`)时它照样绿 —— 一条区分不了
  「按新口径不印了」和「数字被谁写没了」的断言,等于没测。

  所以拿**同一份菜**(`chatMealFixture.items`)再走一趟结果页:那边的数字是真的
  (食衡那条链路给了库外菜的 `per100g`),必须照旧印出来。
*/
recognize.setPending({
  slot: '午餐',
  items: chatMealFixture.items,
  engine: 'agent',
  portionConfirmed: true,
  agentReply: notBlocked,
})
const chatItemsOnResultHtml = renderResult()
check(
  '(正面控制)**同一份菜走结果页照旧印克数**',
  chatItemsOnResultHtml.includes('150g') && chatItemsOnResultHtml.includes('120g'),
  readouts(chatItemsOnResultHtml).join('/') || '结果页也没印 → 上面那条否定是空跑'
)
check(
  '(正面控制)…**也照旧印热量**(库内按库里的 per100g、库外用它自带的那份)',
  chatItemsOnResultHtml.includes(`${riceKcal} kcal`) && chatItemsOnResultHtml.includes(`${webDishKcal} kcal`),
  `期望 ${riceKcal} / ${webDishKcal}`
)
check('头部写的是「识别到 2 道菜」', mealHtml.includes('识别到 2 道菜'))
/*
  ⚠️ 这句话必须在这张卡上。卡上没有任何归档入口,而用户刚看到 App 认出了
  两道菜 —— 不说这一句,他分不清「已经自动记了」和「还没记」,而两种猜法
  都会让他不去看那个补记弹窗。
*/
check('**并写明「还没记进日记」**(卡上没有归档入口,不说这句就是个误导)', mealHtml.includes('还没记进日记'))

/*
  锚点:一道可计量的菜都没有时,头部换一句话、正文说清为什么,而不是
  渲染一张「本餐总热量 0 kcal」的空卡。
*/
const emptyMealHtml = renderItems([
  { id: 'c0', role: 'assistant', content: '', meal: { slot: '午餐', engine: 'agent', items: [], noDishReason: '这张图里没有认得出的菜。' } },
])
check(
  '**一道菜都没有时头部换一句话,并说明原因**(不是渲染一张 0 kcal 的空卡)',
  emptyMealHtml.includes('没能认出菜品') && emptyMealHtml.includes('这张图里没有认得出的菜'),
  emptyMealHtml.includes('没能认出菜品') ? '换过了' : '还是「识别到 0 道菜」'
)

/* ---------- ④b 拍图 + 随图那句话:**一趟,答在卡上** ---------- */

/*
  ⚠️ 这一节盯的是用户 2026-09-23 在手机上看到的那一幕。他的原话是
  「针对图片给一个答案,然后针对文字再给另一版答案?我不要这样,一起发的就一起回答」
  —— 屏幕上当时是**两条消息、两张卡、两版答案**,各顶着一条一模一样的「需注意」。

  改法是**并成一趟**:随图打的那句话跟着图一起发,模型在一次回复里既认菜也答
  那句话,答案落在 `agentReply.advice` 里。所以这里要断的是**那句话真的被画出来了**
  —— 有菜的那种卡(`MealResultCard`)从前不画建议:不报错、不崩,只是用户问的那句
  静静地没有下文,而这一节拦的就是这个。
*/
const askedReply = {
  blocked: false,
  risk: { level: 'medium', message: '这餐偏咸，钠很可能超过单餐推荐值', items: ['高钠'] },
  mode: 'plate',
  title: '餐食盐分与营养评估',
  dishes: [],
  ingredients: [],
  nutrition: { ingredients: [], labels: [], riskItems: [] },
  advice: ['你问的那顿：这餐整体偏咸，晚餐建议选蒸煮类。'],
  disclaimer: '',
}
/** 有菜的一餐 + 同一趟的回复 —— 就是「拍餐盘 + 打了一句话」那一幕 */
const plateAnswerHtml = renderItems([
  { id: 'm0', role: 'assistant', content: '', meal: { ...chatMealFixture, agentReply: askedReply } },
])

check(
  '**有菜那张卡上也有模型的回答**(这张卡从前不画建议,那句话在屏幕上就没有下文)',
  plateAnswerHtml.includes('这餐整体偏咸'),
  plateAnswerHtml.includes('这餐整体偏咸') ? '在' : '不在'
)
/*
  ⚠️ 标题文案**逐字**和回复卡那块相同(`AdviceList`)。
  同一批建议在两处印成两个样子,读起来就是两份结论 —— 那正是要消掉的东西。
*/
check(
  '**建议块和回复卡那块逐字相同**(同一个组件:标题、序号、行样式)',
  plateAnswerHtml.includes(`${CARD_BLOCK_TITLE}💡 进食建议</span>`),
  plateAnswerHtml.includes(`${CARD_BLOCK_TITLE}💡 进食建议</span>`) ? '一致' : '对不上'
)
check(
  '**菜在上、回答在下**(反过来就是「先给答案,再说这是什么东西」)',
  plateAnswerHtml.indexOf(riceFood.name) < plateAnswerHtml.indexOf('这餐整体偏咸'),
  `菜 @${plateAnswerHtml.indexOf(riceFood.name)} / 回答 @${plateAnswerHtml.indexOf('这餐整体偏咸')}`
)

/* ---------- ④c 有菜那张卡顶上也要有那条冲突结论(2026-09-24) ---------- */

/*
  ⚠️ 用户 2026-09-24 的原话:「可是**显眼的高危提醒也没了**,就算不单独写个提醒,
  **起码也要标红危险内容**吧」。

  上一版把降级挂在了 `ChatTranscript` 的那条分支上 —— 而那条分支**要求
  `items.length === 0`**,也就是只在「没认出菜」时才轮到。可这条路(对话页发图、
  认出菜了)画的是 `MealResultCard`,那张卡从前**只画菜品和建议**,
  `agentReply.risk` 一个字都不画。

  所以屏幕上根本不是「提醒写得不够显眼」,是**它长在了另一张卡上** ——
  菜照常列着,那道菜里有他不能吃的东西,一个字都不提。

  ⚠️ 判据要**同时**断「在不在」和「是不是红的」:只断前半句的话,一条灰底的
  「提示」照样绿 —— 而「不明亮」正是他第二次纠的东西(等级词从「高风险」掉成
  「提示」,见 ④d)。`RISK_STRIP_HIGH` 是手写的常量,不从组件里读(那会恒真)。
*/
const RISK_STRIP_HIGH = 'text-danger-text">高风险</span>'

const plateRiskReply = {
  ...askedReply,
  risk: { level: 'high', message: '这盘里有花生，你的档案里写着花生过敏。', items: ['花生'] },
}
const plateRiskHtml = renderItems([
  { id: 'pr1', role: 'assistant', content: '', meal: { ...chatMealFixture, agentReply: plateRiskReply } },
])

check(
  '**有菜那张卡顶上也有那条冲突结论**(从前它只长在「没认出菜」那张卡上,这张一个字都不提)',
  plateRiskHtml.includes('花生过敏'),
  plateRiskHtml.includes('花生过敏') ? '在' : '不在 —— 菜照常列着,那句话没了'
)
check(
  '**而且它是红的、写着「高风险」**(一条灰底的「提示」不算「显眼的提醒」)',
  plateRiskHtml.includes(RISK_STRIP_HIGH),
  plateRiskHtml.includes(RISK_STRIP_HIGH)
    ? '红底 + 高风险'
    : // 两个事实分开报:等级词掉了和颜色掉了是两种坏法,而详情只说一个会误导
      `红字 ${plateRiskHtml.includes('text-danger-text')} / 等级词 ${
        plateRiskHtml.match(/高风险|需注意|风险较低|提示/)?.[0] ?? '一个都没有'
      }`
)
check(
  '**那条提醒排在菜前面**(用户要的是「第一条明显的提醒」,不是末尾补一句)',
  plateRiskHtml.indexOf('花生过敏') >= 0 && plateRiskHtml.indexOf('花生过敏') < plateRiskHtml.indexOf(riceFood.name),
  `提醒 @${plateRiskHtml.indexOf('花生过敏')} / 第一道菜 @${plateRiskHtml.indexOf(riceFood.name)}`
)

/*
  反方向那一条:没有冲突时**不许长出一条空条**。低风险且没话说的时候不为
  「一切正常」单开一块 —— 那是在占地方,而一条没有内容的空条更像界面坏了。
*/
const noRiskHtml = renderItems([
  {
    id: 'pr2',
    role: 'assistant',
    content: '',
    meal: {
      ...chatMealFixture,
      agentReply: { ...askedReply, risk: { level: 'unknown', message: '', items: [] } },
    },
  },
])
check(
  '**没有冲突时卡上不长出一条空条**(`message` 和 `items` 全空就不画)',
  !noRiskHtml.includes('>提示</span>'),
  noRiskHtml.includes('>提示</span>') ? '长出来了' : '没有'
)

/* ---------- ④d 降级的是「已为你拦截」,不是这条冲突的严重程度(2026-09-24) ---------- */

/*
  ⚠️ 模型回 `blocked: true` 时经常**不给 level** —— `asLevel` 把任何预期外的值
  归成 `unknown`。

  而两面是不对齐的:`AgentReplyCard` 的**拦截分支不看 level,一律按最高那档画**
  (那里写死 `RISK_TONES.high`),正常那一支才按 `risk.level` 配色。所以光摘掉
  `blocked`,同一条冲突就从一张红卡变成一条灰底的「提示」—— 屏幕上正是
  「显眼的高危提醒没了」。

  拦截降的是那句「已为你拦截」,**不是这条冲突的严重程度**。
*/
const demotedNoLevelHtml = renderItems([
  {
    id: 'bk2',
    role: 'assistant',
    content: '',
    meal: {
      slot: '午餐',
      engine: 'agent',
      items: [],
      agentReply: {
        blocked: true,
        // 模型没给 level —— 最常见的那一种
        risk: { level: 'unknown', message: '这盘里有花生，你的档案里写着花生过敏。', items: ['花生'] },
        mode: '',
        title: '',
        dishes: [],
        ...NO_EXTRA_BLOCKS,
        advice: [],
        disclaimer: '',
      },
    },
  },
])
check(
  '**降级的是那句「已为你拦截」,不是这条冲突的严重程度**(模型没给 level 时也得按最高那档画)',
  demotedNoLevelHtml.includes(RISK_STRIP_HIGH) && !demotedNoLevelHtml.includes('已为你拦截'),
  demotedNoLevelHtml.match(/高风险|需注意|风险较低|提示/)?.[0] ?? '一个等级词都没有'
)

/* ---------- ④e 危险的那道菜在菜品区被标红(2026-09-24) ---------- */

/*
  ⚠️ 用户 2026-09-24 的原话:

  「现在是有高风险提醒了,但是**菜品那里显示全餐组合是0**。你要是做不到单独提醒
   高危组合,并同时结合危险内容做进餐组合,那就不单独提醒危险,**在菜品那里把危险的
   字样和菜品标红,做个显眼标记**」

  他后来定的是「顶上那条结论条留着」,所以两处都要有:那张条说**这一餐**有冲突,
  菜品区说**是哪一道菜**、以及为什么。④c/④d 管前半句,这一节管后半句。

  ⚠️ 这里的条目**不是手搓的**,是拿真实的 `matchDishes` 走出来的:危险标记在这一层
  最容易「看起来对」而实际丢掉(归并、拆分、名字归一化都在它里面)。手搓一个
  `suitable: false` 的条目去渲染,断的只是 `DishRow` 认不认这个字段,断不出
  「模型说了这句话到底有没有走到屏幕上」—— 而那正是这个洞的形状。
*/
const FLAGGED_REASON = '含花生，你的档案里写着花生过敏'
const flaggedMatched = chatDishMatch.matchDishes([{ name: '花生拌饭', suitable: false, reason: FLAGGED_REASON }])
const flaggedMealHtml = renderItems([
  {
    id: 'f1',
    role: 'assistant',
    content: '',
    meal: { slot: '午餐', engine: 'agent', items: [...flaggedMatched.items, webDish] },
  },
])
/** 手写常量,不从组件里读(读组件会恒真,那种断言是假的) */
const DANGER_DISH = 'text-danger-text">花生拌饭</span>'

check(
  '**模型判了慎选的那道菜在菜品区是红的**(从前它和别的菜长得一模一样)',
  flaggedMealHtml.includes(DANGER_DISH),
  flaggedMealHtml.includes(DANGER_DISH) ? '红字' : '名字还是黑的'
)
check(
  '**而且底下印着模型给的理由**(用户要的「危险的字样」)',
  flaggedMealHtml.includes(FLAGGED_REASON),
  flaggedMealHtml.includes(FLAGGED_REASON) ? '印了' : '一个字都没有'
)
check(
  '没被判慎选的那道菜照旧是黑的(标红只落在有问题的那一道上)',
  flaggedMealHtml.includes(`text-ink">${webDish.name}</span>`),
  flaggedMealHtml.includes(`text-ink">${webDish.name}</span>`) ? '没有殃及' : '被一起标红了'
)
/*
  ⚠️ 判据是 `suitable === false`,**不是「有没有 reason」**。`AgentDish.reason`
  是每道菜都有的字段,「推荐」的菜也带理由 —— 把那些理由跟着印出来,是在一道
  没问题的菜底下加一句像警告的话。
*/
const praisedHtml = renderItems([
  {
    id: 'f2',
    role: 'assistant',
    content: '',
    meal: {
      slot: '午餐',
      engine: 'agent',
      items: [{ foodId: riceFood.id, name: riceFood.name, grams: 150, suitable: true, reason: '糙米升糖慢，适合你' }],
    },
  },
])
check(
  '**没被判慎选的菜不印它的理由**(推荐的理由不是警告,印出来就是造谣)',
  !praisedHtml.includes('糙米升糖慢'),
  praisedHtml.includes('糙米升糖慢') ? '跟着印出来了' : '没印'
)

/* ---------- ④g 慎选也分两档:高危红、其余黄(2026-09-24 下午) ---------- */

/*
  ⚠️ 用户看到上面那一版的实机效果之后,原话是:

  「也不要所有都标红吧,**高危标红,中危标黄**这样呢」

  也就是说 ④e 那一版把红发得太宽了 —— 红成了「模型提过这道菜」的同义词,
  一盘菜里每道都红,红就不再是信息。现在颜色由「**你档案里那条忌口的等级**」
  决定,判据住在 `types.ts` 的 `dishRiskLevel` 里(和冲突卡共用 `restrictionHit`)。

  ⚠️ **这一节自己把档案摆成已知的样子**,不靠前面某一节留下的状态:那些是
  别的断言的夹具(§档案那几节来回改过 `restrictions`),拿它当本节的输入,
  等于让「哪一节先跑」决定这一节断的是什么。

  ⚠️ 三样菜是**挑过的**,每一种只留一条通往那个颜色的路:
    · `花生拌饭` —— 名字里就有「花生」→ 走第一条判据(菜里真的有它,和冲突卡
      是同一个判据)
    · `红烧肉` —— 库里是 `braised-pork`,名字、id、理由都不沾你的忌口 → **黄**。
      它是这一节的主角:④e 那一版它就是红的,而它其实没碰到你写下的任何一条。
    · `宫保鸡丁` —— 库里是 `kungpao-chicken`,名字里没有「花生」、id 里也没有
      (`restrictionHit` 那段注释自己写着它盖不全复合菜)→ **只有「模型那句理由
      点了名」这第二条判据能把它变红**。它红了,才证明第二条真的在跑。
*/
const tierRestrictions = [
  { item: '花生', type: 'allergy', level: '高危' },
  { item: '香菜', type: 'taboo', level: '低危' },
]
const savedRestrictions = store.getSnapshot().profile.restrictions
store.updateProfile({ restrictions: tierRestrictions })

const MID_REASON = '高钠，血压偏高的人要少吃'
const tierMatched = chatDishMatch.matchDishes([
  { name: '花生拌饭', suitable: false, reason: FLAGGED_REASON },
  { name: '红烧肉', suitable: false, reason: MID_REASON },
  { name: '宫保鸡丁', suitable: false, reason: FLAGGED_REASON },
])
const tierHtml = renderItems([
  {
    id: 't1',
    role: 'assistant',
    content: '',
    meal: { slot: '午餐', engine: 'agent', items: [...tierMatched.items, webDish] },
  },
])
/** 手写常量,不从组件里读(读组件会恒真,那种断言是假的) */
const HIGH_DANGER = 'text-danger-text">花生拌饭</span>'
const HIGH_NAMED = 'text-danger-text">宫保鸡丁</span>'
const MID_WARN = 'text-warn-text">红烧肉</span>'

check(
  '**撞上你写下的那条高危忌口 → 红**(名字里就有「花生」)',
  tierHtml.includes(HIGH_DANGER),
  tierHtml.includes(HIGH_DANGER) ? '红字' : tierHtml.includes('text-warn-text">花生拌饭') ? '被降成黄了' : '名字没有颜色'
)
check(
  '**没撞上任何一条忌口的慎选菜 → 黄,不是红**(「红烧肉」被模型判了慎选,可你的忌口里没有它)',
  tierHtml.includes(MID_WARN) && !tierHtml.includes('text-danger-text">红烧肉</span>'),
  tierHtml.includes(MID_WARN) ? '黄字' : tierHtml.includes('text-danger-text">红烧肉') ? '还是红的(那一版的红发得太宽)' : '名字没有颜色'
)
check(
  '**名字和食物库 id 里都没有、模型那句理由点了名 → 照样红**(少了这条,`宫保鸡丁`会带着一句「含花生」黄着)',
  tierHtml.includes(HIGH_NAMED),
  tierHtml.includes(HIGH_NAMED) ? '红字' : tierHtml.includes('text-warn-text">宫保鸡丁') ? '被降成黄了' : '名字没有颜色'
)
check(
  '**黄那一档的警告图标也跟着换**(不是只有名字是黄的,那一格还是红的)',
  tierHtml.includes('bg-warn-bg'),
  tierHtml.includes('bg-warn-bg') ? '图标黄了' : '图标没跟着换'
)
check(
  '档次没有殃及没被判慎选的菜(它照旧是黑的)',
  tierHtml.includes(`text-ink">${webDish.name}</span>`),
  tierHtml.includes(`text-ink">${webDish.name}</span>`) ? '没有殃及' : '被一起染了色'
)

store.updateProfile({ restrictions: savedRestrictions })

/* ---------- ④f 库里没有的那一项:卡上不再有那个 0(2026-09-24) ---------- */

/*
  ⚠️ 用户 2026-09-24 在手机上看到的一整屏,原话:

  「显示的是:**没能认出菜品,这张图里没有认得出的菜**,全餐组合 0g,0kcal,
   包含多种食材,但存在严重健康冲突」

  **前两句和第三句互相打架**:下面明明列着一行菜,上面说「没有认得出的菜」。
  而且那一行是 0g / 0 kcal。

  根子在那一项:模型把**整餐当成一道菜**报回来(名字就叫「全餐组合」),食物库里
  没有这样一条,`matchDishes` 于是按设计挂上哨兵 id、克数 0、营养按 0 计 ——
  结果页那句「不在食物库里,按 0 计」就是为它写的。

  ## 这一节的判据当天翻过一次,写清楚免得下一个人按旧版改

  中间那版(同一天早些时候)判的是「**那个 0 在卡上说清了为什么**」——
  在卡上补一句「不在食物库里,按 0 计」。用户否了,给了新口径:
  「**计算不出来就不算了**」+「要记进日记时才调食衡算」。

  于是判据反过来:**一个数字都不许出现**,而且**不许把那句话补回来**。
  理由见 `MealResultCard` 文件头最后一段 —— 真正的问题从来不是「那个 0 没解释」,
  是它根本就不该出现;屏上连 0 都没有了,解释 0 的那句话就没有指代对象。

  ⚠️ 条目用真实的 `matchDishes` 走出来(不是手搓一个哨兵 id):那个兜底分支
  将来要是改了形状(比如不再挂哨兵、改成丢掉),手搓的 fixture 会一直是绿的。
*/
const wholeMealMatched = chatDishMatch.matchDishes([{ name: '全餐组合' }])
const wholeMealHtml = renderItems([
  {
    id: 'w1',
    role: 'assistant',
    content: '',
    meal: { slot: '午餐', engine: 'agent', items: wholeMealMatched.items, unmatched: wholeMealMatched.unmatched },
  },
])

check(
  '**（自检）这一项确实落在「库外」那一类**',
  wholeMealMatched.items.length === 1 && chatDishMatch.isUnmatchedId(wholeMealMatched.items[0].foodId),
  `${wholeMealMatched.items[0]?.foodId} / 哨兵项=${chatDishMatch.isUnmatchedId(wholeMealMatched.items[0]?.foodId)}`
)
check(
  '**库外那道菜在这张卡上连一个 0 都不印**(0g / 0 kcal 那两处是当天的事故现场)',
  !GRAM_READOUT.test(wholeMealHtml) && !/\d+\s*kcal/.test(wholeMealHtml),
  `克数 ${readouts(wholeMealHtml).join('/') || '没有'} / 热量 ${wholeMealHtml.match(/\d+\s*kcal/)?.[0] ?? '没有'}`
)
check(
  '**而且不许把「不在食物库里,按 0 计」补回这张卡**(那是当天被否掉的补丁)',
  !wholeMealHtml.includes('按 0 计') && !wholeMealHtml.includes('不在食物库里'),
  wholeMealHtml.includes('按 0 计') ? '补回来了' : '没有'
)
check(
  '**头部不再和下面那行打架**(下面列着菜,上面还说「没能认出菜品」)',
  !wholeMealHtml.includes('没能认出菜品') && wholeMealHtml.includes('全餐组合'),
  `「没能认出菜品」${wholeMealHtml.includes('没能认出菜品') ? '还在' : '没了'} / 那一行${
    wholeMealHtml.includes('全餐组合') ? '在' : '不在'
  }`
)
check(
  '  而「这张图里没有认得出的菜」也不该印(它下面就有菜)',
  !wholeMealHtml.includes('这张图里没有认得出的菜'),
  wholeMealHtml.includes('这张图里没有认得出的菜') ? '印了' : '没印'
)
/*
  ⚠️ **正面控制:那句话在结果页上还在。**

  上面那条只断「这张卡上没有」。少了这一条,谁把这个说法从**整个应用**里删掉
  (连同结果页那条黄色的「不在食物库里,暂时按 0 计」),它照样绿 —— 而结果页
  那条是**必需品**:哨兵项按 0 计且不抛错,不显式告知,用户会拿到一个悄悄偏低
  的热量和健康分(`recognize.ts` 的 `unmatched` 那段)。

  同一份哨兵项分别走两屏:结果页照旧说,对话那张卡一个字都不说。
*/
recognize.setPending({
  slot: '午餐',
  engine: 'agent',
  items: [wholeMealMatched.items[0], { foodId: 'rice', name: riceFood.name, grams: 150 }],
  unmatched: wholeMealMatched.unmatched,
  portionConfirmed: true,
  agentReply: notBlocked,
})
const sentinelOnResultHtml = renderResult()
check(
  '(正面控制)**同一份哨兵项走结果页照旧说「不在食物库里,按 0 计」**',
  sentinelOnResultHtml.includes('不在食物库里') && sentinelOnResultHtml.includes('按 0 计'),
  sentinelOnResultHtml.includes('按 0 计') ? '还在(对话那张卡上没有)' : '结果页也不说了 → 上面那条否定是空跑'
)

/*
  配料表那条路整份都归回复卡渲染(见 ④ 那两条),建议本来就在卡里。这一条守的是
  「改这趟调用的时候别把它一起改丢」—— 顺带把 ④b 从前那条「含量印出来了」留下:
  它是解析层那个 bug 的渲染端证据(模型把 `labels` 平铺在 `result` 上时,那一块
  整块不显示,用户看到的就是「没有具体说含量」)。
*/
const labelWholeReply = {
  ...askedReply,
  mode: 'ingredient',
  title: '配料与营养标签解读',
  ingredients: [{ name: '生牛乳' }, { name: '白砂糖' }],
  nutrition: { ingredients: [], labels: [{ label: '钠', value: '60mg / 100g' }], riskItems: ['白砂糖'] },
}
const labelWholeHtml = renderItems([
  { id: 'm1', role: 'assistant', content: '', meal: { slot: '午餐', engine: 'agent', items: [], agentReply: labelWholeReply } },
])
check(
  '**配料表那张卡:识别那块和含量那几格都还在**',
  labelWholeHtml.includes('生牛乳') && labelWholeHtml.includes('60mg / 100g'),
  `识别 ${labelWholeHtml.includes('生牛乳')} / 含量 ${labelWholeHtml.includes('60mg / 100g')}`
)
check(
  '**而且它和回答在同一张卡里**(不是「识别一张、回答另一张」—— 那是一趟回答)',
  labelWholeHtml.includes('这餐整体偏咸'),
  labelWholeHtml.includes('这餐整体偏咸') ? '在' : '不在'
)

/* ---------- ⑤ 两条横幅:演示数据 vs 部分没成功 ---------- */

/*
  两次渲染**只差一个字段**,所以这两条断的是同一件事的两面:
  `degradedReason` 在 → 横幅在;不在 → 横幅不在。
  只写前一条的话,「无条件挂横幅」照样绿。
*/
const degradedHtml = renderItems([
  { id: 'd1', role: 'assistant', content: '', meal: { ...chatMealFixture, degradedReason: '连不上识别服务，本次为演示数据' } },
])
check(
  '**`degradedReason` 有值时,「演示数据」横幅在**',
  degradedHtml.includes('以下菜品为演示数据') && degradedHtml.includes('连不上识别服务'),
  degradedHtml.includes('以下菜品为演示数据') ? '在' : '不在'
)
check(
  '**同一个 meal 不带它时,横幅一个字都没有**(所以上一条不是无条件挂的)',
  !mealHtml.includes('以下菜品为演示数据') && !mealHtml.includes('演示数据'),
  mealHtml.includes('演示数据') ? '混进来了' : '干净'
)

/*
  ⚠️ 这一节最要紧的一条。`partialNote` 说的是「这份是真的,只是少了一部分」——
  那条横幅上**一个字都不许出现「演示数据」**。写上去的代价很具体:用户会把
  屏上那几道真菜当成编的删掉。
*/
const partialHtml = renderItems([
  { id: 'p1', role: 'assistant', content: '', meal: { ...chatMealFixture, partialNote: '第 2 张没能识别，那部分没有计入' } },
])
check(
  '**`partialNote` 那句话在**',
  partialHtml.includes('第 2 张没能识别，那部分没有计入'),
  partialHtml.includes('第 2 张没能识别') ? '在' : '不在'
)
check(
  '**而它一个「演示数据」都没带**(带上就是把一份真菜标成编的)',
  !partialHtml.includes('演示数据') && !partialHtml.includes('以下菜品为演示数据'),
  partialHtml.includes('演示数据') ? '混进来了' : '干净'
)
check(
  '**带上 partialNote 之后那几道菜还在**(说「少了一部分」不等于把结果清空)',
  partialHtml.includes(riceFood.name) && partialHtml.includes(webDish.name) && partialHtml.includes('识别到 2 道菜')
)

/* ---------- ⑥ 对话页不再离开这一页 ---------- */

const chatPageSrc = stripComments(await readFile('src/screens/ChatScreen.tsx', 'utf8'))
/*
  ⚠️ **`logRunSrc` 在这里就取好**(不是等 ⑧ 那一段再取)。
  「记进日记」那一趟 2026-09-24 下午搬去了 `store/logRun.ts`,而盯它的断言
  从这一节就开始有了(`thumb: meal.thumb` 那条)。晚取一步 = 上面那几条在
  TDZ 上撞一个 `ReferenceError`,而报错行号和真正的问题差着几百行。
*/
const logRunSrc = stripComments(await readFile('src/store/logRun.ts', 'utf8'))
/*
  切源码窗口的两个小工具。**定义在第一次用到它们之前** —— 从前它们住在 ⑧b
  那一段中间,而 2026-09-24 起前面(草稿那条链)也要切窗口了,晚定义一步就是
  一个 `Cannot access 'windowBetween' before initialization`,报错行号和真正的
  问题差着几百行。
*/
const windowAfter = (src, marker, len) => {
  const i = src.indexOf(marker)
  return i === -1 ? '' : src.slice(i, i + len)
}
/*
  切成**两个标记之间**:边界永远是代码里真实存在的两个词,长度随写随变。
  理由见下面 ⑧b 那一段的长注释(固定长度切会在注释变长之后把要看的东西
  整个切在外面,或者更糟:切到下一个函数里,拿它的东西把断言蹭绿)。
*/
const windowBetween = (src, from, to) => {
  const i = src.indexOf(from)
  const j = src.indexOf(to)
  return i === -1 || j === -1 || j <= i ? '' : src.slice(i, j)
}
check(
  '取到了对话页的源码(下面几条的锚点)',
  chatPageSrc.includes('sendPhotos') && chatPageSrc.length > 2000,
  `${chatPageSrc.length} 字符`
)
check(
  '取到了那一趟的源码(`store/logRun.ts` —— ⑧b 起的那一整段都切它)',
  logRunSrc.includes('computeForLog') && logRunSrc.includes('noticeFor'),
  `${logRunSrc.length} 字符`
)
check(
  '**对话页不再往 `/analyzing` 跳**(发图不再离开这一页,也就不再丢掉整段对话)',
  !chatPageSrc.includes('/analyzing'),
  chatPageSrc.includes('/analyzing') ? '还在跳' : '没了'
)
check(
  '**也不再调 `startPlateJob`**(它第一件事是 setPending(null),会抹掉首页那条链的草稿)',
  !chatPageSrc.includes('startPlateJob'),
  chatPageSrc.includes('startPlateJob') ? '还在用' : '没用'
)
check(
  '返回首页那一个 `navigate` 还在(把整页都禁掉就是另一回事了)',
  chatPageSrc.includes("navigate('/')"),
  chatPageSrc.match(/navigate\([^)]*\)/g)?.join(' / ') ?? '一个都没有'
)
/*
  ⚠️ 上面那几条是「不再离开这一页」,下面两条是「发图那条路**只问一趟**」。

  这是 2026-09-23 那件事真正的守卫。用户当时看到的是**两条消息、两张卡、
  两版答案**(各顶着一条「需注意」),原话是「针对图片给一个答案,然后针对文字
  再给另一版答案?我不要这样,一起发的就一起回答」。做法是把第二趟并进第一趟
  —— 而**并成一个的判据在源码里,渲染层看不到**:渲染层只能验「一条消息里
  有什么」,验不出「这条消息是不是被问了第二遍」。

  取 `sendPhotos` 那一段而不是整个文件:`answer` 本身要有(打字那条路在用它),
  禁的是**发图那条路里再出现一次调用**。
*/
const photoPathSrc = chatPageSrc.slice(
  chatPageSrc.indexOf('async function sendPhotos'),
  chatPageSrc.indexOf('const onSend')
)
check(
  '取到了发图那一段源码(下面两条的锚点)',
  photoPathSrc.includes('recognizeOne') && photoPathSrc.length > 500,
  `${photoPathSrc.length} 字符`
)
check(
  '**发图那条路只问一趟**(再挂一次 `answer(...)` 就又是两版答案、两张卡)',
  !photoPathSrc.includes('answer('),
  photoPathSrc.match(/answer\([^)]*\)/g)?.join(' / ') ?? '没有第二趟'
)
check(
  '**而那句话仍然跟着图一起发**(不传 `text` 就等于用户白打了一句,而图照认)',
  photoPathSrc.includes('text: input,'),
  photoPathSrc.match(/text: [^,]*/g)?.join(' / ') ?? '没找到 text'
)

/*
  ⚠️ **「后面的菜该怎么吃就怎么吃」的来源在这里(2026-09-24)。**

  模型一旦回了 `blocked: true`,按它自己的提示词就**不再生成菜品**了 —— 所以
  上面 ①b 那一层的降级只能救回那条提醒,救不回菜。要菜就只有再问一趟,而那一趟
  落在 `recognizeOne` 里(不在这段切片里),所以单独取一次源码。

  盯三件事,缺一条这一支就是废的:

    ① 第二趟真的带着 `insist` —— 不带就是同一句话再问一遍,白跑一趟
    ② 它只给 `agent: 'chat'`  —— 拍餐盘那条路的硬拦是对的,别搬过去
    ③ 它带兜底             —— 第二趟一挂就把整份降级成演示数据,那是**更坏**的结果
*/
const retryFileSrc = stripComments(await readFile('src/store/recognizeOne.ts', 'utf8'))
const retrySrc = retryFileSrc.slice(
  retryFileSrc.indexOf('let meal = await runRecognition(arg)'),
  retryFileSrc.indexOf("return { kind: 'ok', meal }")
)
check(
  '取到了「被拦之后」那一段源码(下面三条的锚点)',
  retrySrc.includes('runRecognition') && retrySrc.length > 200,
  `${retrySrc.length} 字符`
)
check(
  '**发图那条路被拦时会再问一趟**(不然「后面的菜」根本没有来源)',
  retrySrc.includes('insist: true'),
  retrySrc.match(/insist: [^,}]*/g)?.join(' / ') ?? '第二趟没带 insist'
)
check(
  '**那一趟只在对话页跑**(拍餐盘那条路确实有一份建议要拦下来)',
  retrySrc.includes("opts.agent === 'chat'"),
  retrySrc.match(/opts\.agent[^\n]*/)?.[0] ?? '没找到那条闸'
)
check(
  '**第二趟失败不许把第一趟的结果弄丢**(宁可少一次重试,不可丢那句风险信息)',
  retrySrc.includes('catch'),
  retrySrc.includes('catch') ? '有兜底' : '没兜底 —— 第二趟一挂,手里那份也一起没了'
)

/* ---------- ⑦ 归档那个决定不在当下做 ---------- */

/*
  ⚠️ 这是这次改动里最容易被下一个人「顺手补上」的一条:卡上少一个按钮看起来
  就是个缺陷。但它是有意的 —— 用户可能只是在问「这餐咸吗」,根本没吃,而在
  那条消息旁边放一颗「记入日记」就是把这个决定推回给当下。

  「还没记进日记」那句就是它的替代品:告诉用户**有这件事没做**,并把他引到
  下次进这一页时那句问话上。前半条是锚点 —— 卡没渲染出来时后面两条会假绿。
*/
check(
  '**结果卡上没有归档入口**(锚点:「还没记进日记」在,说明卡确实渲染出来了)',
  mealHtml.includes('还没记进日记') && !mealHtml.includes('记入日记') && !mealHtml.includes('调整分量'),
  `还没记进日记 ${mealHtml.includes('还没记进日记')} / 混进来的按钮 ${
    ['记入日记', '调整分量'].filter((t) => mealHtml.includes(t)).join('、') || '(没有)'
  }`
)

/* ============================================================
   「要补记这一餐吗」那张弹窗
   ------------------------------------------------------------
   它就是⑦那条的**另一半**:决定被推迟到下次进对话页,由这张弹窗问出口。

   它是 `open` / `meal` 两个 prop 驱动的**受控**组件 —— 和 SpeechSheet、
   MealSheet 编辑态同一个手法,理由也同一条:组件内部的 `useState` 在 SSR 下
   永远是关着的,做成受控的,这段文案和三个按钮才断言得了。

   ⚠️ 每一条都必须传 `open: true` **并且给一份 `meal`**:组件在 `!open || !meal`
   时直接 `return null`,不传就是拿一条空串去 `includes`,下面每一条都会**假绿**。
   ============================================================ */

console.log('\n=== 「要补记这一餐吗」那张弹窗 ===')

const unloggedSheetMod = await server.ssrLoadModule('/src/components/UnloggedMealSheet.tsx')
const sheetNoop = () => {}
const renderUnlogged = (props) =>
  renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(unloggedSheetMod.UnloggedMealSheet, props))
  )

/** 那份草稿。含一道**未收录的菜** —— 它在弹窗上也要照常列出来 */
const draftMeal = {
  profileId: 'p-a',
  /** 这份是**拍的**那一份 —— 打字那份见下面 `textMeal`，两句文案不一样 */
  from: 'photo',
  slot: '午餐',
  items: [
    { foodId: 'rice', name: riceFood.name, grams: 150 },
    { foodId: 'unmatched:折耳根', name: '折耳根', grams: 0 },
  ],
  at: new Date(2020, 0, 2, 8, 5).getTime(),
}
const UNLOGGED_BASE = { open: true, meal: draftMeal, onLog: sheetNoop, onAdjust: sheetNoop, onDismiss: sheetNoop }

/*
  ⚠️ 渲染**包一层 try**。组件在 `!open || !meal` 时直接 `return null`；把那个判断
  弄坏之后，`meal: null` 那一半会在渲染中途抛 `TypeError`，整个自检脚本**当场崩掉**
  —— 一条断言的崩溃不打印 FAIL 行，看起来和「绿」一模一样（这个仓库点过名的那类
  假绿）。包住之后它变成一条会红、会说话的断言。
*/
const renderUnloggedSoft = (props) => {
  try {
    return renderUnlogged(props)
  } catch (e) {
    return `✗抛了 ${e}`
  }
}

const unloggedHtml = renderUnlogged(UNLOGGED_BASE)
const unloggedDegradedHtml = renderUnlogged({
  ...UNLOGGED_BASE,
  meal: { ...draftMeal, degradedReason: '连不上识别服务，本次为演示数据' },
})
/** 打字问出来的那一份 —— 句句都得对得上「我没拍照，我是打字问的」 */
const unloggedTextHtml = renderUnlogged({
  ...UNLOGGED_BASE,
  meal: { ...draftMeal, from: 'text', items: [{ foodId: 'rice', name: riceFood.name, grams: 150 }] },
})

check(
  '关着的时候什么都不渲染 —— 而且 `meal` 为 null 时也一样',
  renderUnloggedSoft({ ...UNLOGGED_BASE, open: false }) === '' &&
    renderUnloggedSoft({ ...UNLOGGED_BASE, meal: null }) === '',
  `open=false → ${renderUnloggedSoft({ ...UNLOGGED_BASE, open: false }).slice(0, 40) || '(空)'}`
)
check('弹窗确实渲染出来了(下面每一条的前提)', unloggedHtml.length > 400, `${unloggedHtml.length} 字符`)

/*
  ⚠️ 这一条从前还要求「`150g` 也在」。2026-09-24 起这一屏**一个数字都不印**
  （下面那一条专门断这件事），所以那个 `150g` 从判据里撤掉了 —— 留着它，
  这一条会和口径正好相反，而且红的原因看着像「菜没列出来」。
  菜名照旧一个都不能少，尤其**未收录的那道**：它是这份草稿存在的理由。
*/
check(
  '**几道菜都列出来了,连未收录的那道也在**(一个名字都不许少,数字由下面那条管)',
  unloggedHtml.includes(riceFood.name) && unloggedHtml.includes('折耳根'),
  `米饭 ${unloggedHtml.includes(riceFood.name)} / 折耳根 ${unloggedHtml.includes('折耳根')}`
)
/*
  ⚠️ 「调整分量再记」这五个字在弹窗里出现**两次**：一次是那颗按钮，一次是底下那句
  「想改就点上面的「调整分量再记」」。所以拿 `includes` 当判据时，**把按钮删掉那条
  断言照样绿** —— 判据被句子里的同一个词蹭绿了（这个仓库点过名的那类假绿，弄坏时
  实测过一次）。按钮那条改成认 `</button>` 收尾；另外两个词在弹窗里只出现一次，
  `includes` 就够。
*/
const ADJUST_BUTTON = /调整分量再记<\/button>/
check(
  '**三个出口都在**，而且「调整分量再记」是**一颗按钮**、不是句子里提了一下',
  ['记入日记', '不用了'].every((t) => unloggedHtml.includes(t)) && ADJUST_BUTTON.test(unloggedHtml),
  `记入日记 ${unloggedHtml.includes('记入日记')} / 不用了 ${unloggedHtml.includes('不用了')}`
    + ` / 调整分量那颗按钮 ${ADJUST_BUTTON.test(unloggedHtml)}`
)
/*
  后半截「8:05 识别到的」是在盯**拼接**,不是盯时间本身。

  `unloggedWhen` 交出来的是「1月2日 8:05」,以数字收尾,而后面紧跟的是汉字。
  少一个空格渲染成「8:05识别到的这几道菜」—— 数字和汉字粘在一起,读起来像
  「8:05识」是一个词。只看 `includes('1月2日 8:05')` 的那一版抓不到它:
  那个串在拼接前后**都在**,少的是它右边那一个空格。
*/
check(
  '**那句时间前缀在**(说的是「什么时候识别的」,不参与任何判据)',
  unloggedHtml.includes('1月2日 8:05') && unloggedHtml.includes('8:05 识别到的'),
  `${unloggedHtml.includes('1月2日') ? '在' : '不在'} / 拼接处${unloggedHtml.includes('8:05 识别到的') ? '有空格' : '粘在一起'}`
)

/*
  ⚠️ 这一屏上**一个数字都没有**(2026-09-24 起的口径),所以底下那句提示不能
  再说「分量按食物库的常见分量算的」—— 它对着的是一个此刻还不存在的数。
  它现在要说的是**按下去之后会发生什么**:要等一趟食衡,而算出来的分量不是
  用户选的。两件事都得说,而且必须在**按之前**说(理由见 `UnloggedMealSheet`
  文件头「为什么前两个出口都要等」那段)。
*/
check(
  '**这屏上一个数字都不印**(和对话里那张卡同一个口径:「要记日记时才调食衡算」)',
  !GRAM_READOUT.test(unloggedHtml) && !/\d+\s*kcal/.test(unloggedHtml),
  `克数 ${readouts(unloggedHtml).join('/') || '没有'} / 热量 ${unloggedHtml.match(/\d+\s*kcal/)?.[0] ?? '没有'}`
)
check(
  '**按之前就说清代价:要等一趟**(不说的话,用户点下去只会以为 App 卡住了)',
  unloggedHtml.includes('要等十几秒'),
  unloggedHtml.includes('要等十几秒') ? '在' : '不在 —— 用户不知道按下去会等'
)
check(
  '**而且要说清「算出来的分量不是你选的」**(跳过 /portion 那件事的诚实前提,换了个说法接着在)',
  unloggedHtml.includes('算出来的分量不是你选的'),
  unloggedHtml.includes('算出来的分量不是你选的') ? '在' : '不在'
)

/*
  ⚠️ 打字那一份（`from: 'text'`，2026-09-24）：

    · 它一张照片都没有，说「识别到的」是在陈述一件没发生过的事
      （用户看到的是一句他不认识的描述，而那份菜确实来自他问的那句话）。
    · **它也要等** —— 2026-09-24 探针实测：把菜名交给食衡、不给图，库外菜
      照样走博查联网那条链，来回 **26 秒**（`private/probe-text-agent.mjs`）。
      所以它和拍照那份一样必须说「要等十几秒」；曾经写过的「不用等」是
      本地凑数那一版的遗留，点完盯着不动的屏幕会以为它死了。

  反过来的半边也要钉：**打字那份不许出现「识别到的」**。只钉「有『聊到的』」
  是不够的 —— 两句都在的时候那条断言照样绿。
*/
check(
  '**打字那份说「聊到的」,不说「识别到的」**(它一张照片都没有)',
  unloggedTextHtml.includes('聊到的这几道菜') && !unloggedTextHtml.includes('识别到的'),
  `聊到的 ${unloggedTextHtml.includes('聊到的这几道菜')} / 识别到的 ${unloggedTextHtml.includes('识别到的')}`
)
check(
  '**打字那份照实说要等**(它同样交给食衡算,库外菜要联网 —— 实测 26 秒)',
  unloggedTextHtml.includes('要等十几秒') && !unloggedTextHtml.includes('不用等'),
  `要等十几秒 ${unloggedTextHtml.includes('要等十几秒')} / 不用等 ${unloggedTextHtml.includes('不用等')}`
)
check(
  '**而它说的那句是「问一遍食衡」,不是「拿这张照片重新算」**(它一张照片都没有)',
  unloggedTextHtml.includes('拿这几道菜问一遍食衡'),
  unloggedTextHtml.includes('拿这张照片') ? '说了「这张照片」' : '说的是那几道菜'
)
check(
  '(锚点) 两份都真的渲染出来了 —— 上面两条不是拿空串在比',
  unloggedTextHtml.length > 400 && unloggedTextHtml.includes(riceFood.name) && unloggedHtml.includes('识别到的'),
  `打字 ${unloggedTextHtml.length} 字符 / 拍的那份 ${unloggedHtml.length} 字符`
)

/* ---------- ⑦b 点完「记」之后那张提示卡(2026-09-24 下午) ---------- */

/*
  这一节替掉的是原来那五条(`busy` → 主键写「正在算…」、两颗键不接 onClick、
  `error` 印在补记弹窗上)。用户当天把「等待画在屏幕上」整段否了:

    「下一次点击进来的计算是否可以不在页面显示,用户点击后,直接说计算成功后会
      加载进日记等等这样的话」
    「用户自己选择关不关,意思就是选择后自动弹出…界面,用户点击其他地方或者
      点击知道了之类的按钮,就可以关闭」

  于是等待和失败都搬到 `LogNotice` 这张卡上,补记弹窗点完就收。

  ⚠️ 这几个状态**必须做成受控 prop**,不能是组件内部的 `useState`:
  `renderToStaticMarkup` 不跑 effect,内部状态在自检里永远是初值,这几句话一句
  都够不到(见 `LogNotice` 文件头最后一段)。

  ⚠️ 而「点「知道了」和点别处都能关」**SSR 断言不到**:React 在静态渲染里根本不
  输出事件处理器。所以那条只能看源码(数 `onClick={onClose}` 出现两次)——
  文案走渲染、接线走源码,别只留一条。
*/
const logNoticeMod = await server.ssrLoadModule('/src/components/LogNotice.tsx')
const logNoticeSrc = stripComments(await readFile('src/components/LogNotice.tsx', 'utf8'))
const renderNotice = (props) =>
  renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(logNoticeMod.LogNotice, props))
  )
const NOTICE_BASE = { open: true, kind: 'log', onClose: sheetNoop }

const noticeHtml = renderNotice(NOTICE_BASE)
const noticeDoneHtml = renderNotice({ ...NOTICE_BASE, done: true })
const noticeAdjustHtml = renderNotice({ ...NOTICE_BASE, kind: 'adjust' })
const noticeErrorHtml = renderNotice({ ...NOTICE_BASE, error: '这一趟没能算出来，稍等一下再试一次。' })

check('提示卡关着的时候什么都不渲染', renderNotice({ ...NOTICE_BASE, open: false }) === '', '')
check(
  '**点完「记入日记」屏上就有那句话:算好了会自动记进日记**(用户不用守着那十几秒)',
  noticeHtml.includes('会自动记进日记'),
  noticeHtml.includes('会自动记进日记') ? '在' : '不在 —— 用户不知道按下去之后算什么'
)
/*
  ⚠️ 后半截 `!includes('会自动记进日记')` 是**反方向**:只写正面那一句的话,
  把两句话写成一句「算好了会自动记进日记,已经记进日记了」也能过 —— 而屏幕上
  留着的是**一句已经过期的承诺**。
*/
check(
  '**算好了那句话换成「已经记进日记了」**(不把一句过期的承诺留在屏幕上)',
  noticeDoneHtml.includes('已经记进日记了') && !noticeDoneHtml.includes('会自动记进日记'),
  noticeDoneHtml.includes('已经记进日记了') ? '换了' : '还是原来那句'
)
check(
  '**「调整分量再记」那条说的是打开记录面板,不是「会自动记进日记」**(那条出口不落盘)',
  noticeAdjustHtml.includes('记录面板') && !noticeAdjustHtml.includes('会自动记进日记'),
  noticeAdjustHtml.includes('记录面板') ? '说了面板' : '说成会自动记进日记了 —— 那是一句假话'
)
/*
  ⚠️ **这张卡够不着草稿的 `from`**（`noticeFor` 只给 kind/done/error），而它两个
  来源共用 —— 打字那份点完「记入日记」看到的就是它，而那份**一张照片都没有**。
  所以这里不是「按来源分叉」，是**两条路都不许提图**：用户 2026-09-24 晚点着
  这句「正在拿这张照片算营养」问过一次「为什么写的是这张照片」。
  ⚠️ 两条出口都要查：`adjust` 那句原来也带着「拿这张照片」。
*/
check(
  '**卡上不许提「照片」**(打字那份点完也是这张卡,而它一张照片都没有)',
  !noticeHtml.includes('照片') && !noticeAdjustHtml.includes('照片'),
  noticeHtml.includes('照片') || noticeAdjustHtml.includes('照片') ? '提了照片' : '没提'
)
check(
  '**但它仍然说清按下之后算什么**（通用不等于含糊:那一句得在)',
  noticeHtml.includes('正在算这一餐的营养'),
  noticeHtml.includes('正在算这一餐的营养') ? '在' : '只剩一句「加载中」那样的话'
)
/*
  失败那一句是**这一趟唯一会说话的地方** —— 用户可能早就把卡关了,所以那一句
  必须①说的是人话(调用方给的原因)②说清这条没丢。只说「没算出来」的话,
  用户会以为这顿饭没了(而草稿和照片都还在)。
*/
check(
  '**没算出来时印的是那句原因,而且说清「这条先留着」**(不然用户以为这顿饭没了)',
  noticeErrorHtml.includes('这一趟没能算出来') && noticeErrorHtml.includes('先留着'),
  noticeErrorHtml.includes('这一趟没能算出来')
    ? `原因在 / 这条留着那句${noticeErrorHtml.includes('先留着') ? '在' : '不在'}`
    : '没了 —— 用户不知道刚才发生了什么'
)
check(
  '**那句话是给读屏的 `role="status"`**(它是一次操作的结果,不是装饰)',
  /role="status"[^>]*>[^<]*这一趟没能算出来/.test(noticeErrorHtml),
  /role="status"/.test(noticeErrorHtml) ? '有' : '没有 —— 读屏用户不知道刚才怎么了'
)
check(
  '**没出错时不挂那一行**(反方向:不许无条件挂一行空的)',
  !/role="status"/.test(noticeHtml),
  /role="status"/.test(noticeHtml) ? '挂了一行空的' : '没有'
)
check(
  '**「知道了」和点别处接的是同一个关闭**(少一个出口,就有一半人关不掉它)',
  logNoticeSrc.split('onClick={onClose}').length - 1 === 2,
  `接了几处:${logNoticeSrc.split('onClick={onClose}').length - 1}`
)
/*
  ⚠️ **草稿不许被清。** 这是「计算不出来就不算了」的后半句:算不出来只是这一次
  没记成,下次进对话页还要问(`UnloggedMealSheet` 文件头最后一段)。
  清掉的话表现是「那顿饭永远问不出来了」,而屏幕上什么都不说。
  弹窗自己是受控组件、够不着草稿 —— 所以要盯的是**调用方**那条路
  (下面 ⑧ 里 `runCompute` 的失败分支)。
*/

/*
  两次渲染**只差一个字段** —— 这两条断的是同一件事的两面,口径和结果卡
  (`degradedReason` 在 → 横幅在)完全一致。只写前一条的话,「无条件挂横幅」照样绿。
*/
check(
  '**演示数据那份挂着横幅**',
  unloggedDegradedHtml.includes('以下菜品为演示数据') && unloggedDegradedHtml.includes('连不上识别服务'),
  unloggedDegradedHtml.includes('以下菜品为演示数据') ? '在' : '不在'
)
check(
  '**真实识别那份一个字都不带**(所以上一条不是无条件挂的)',
  !unloggedHtml.includes('演示数据'),
  unloggedHtml.includes('演示数据') ? '混进来了' : '干净'
)

/* ---------- ⑧ 几处只有源码能验的不变量 ---------- */

/*
  预览图的 revoke。**这件事故障起来什么都不发生** —— 没有报错、界面完全正常,
  只是每识别一张就有一个几 MB 的 blob 再也不释放(到刷新页面为止)。没有断言
  就只能靠下一个人读注释时正好想到。

  判据本身抽成了 `previewOwnership`(verify-loop 第 14 节逐条断了三种组合),
  但**一个没人调用的纯函数等于没有** —— 所以这里再钉一次调用点。
*/
const recognizeOneSrc = stripComments(await readFile('src/store/recognizeOne.ts', 'utf8'))
const REVOKE_LINE = 'URL.revokeObjectURL(prepared.previewUrl)'
const ownerAt = recognizeOneSrc.indexOf('previewOwnership(opts)')
/*
  ⚠️ **只在这个分派块里找那一行,不能用 `indexOf` 全局找。** 全文里那串
  `URL.revokeObjectURL(prepared.previewUrl)` 有**两处**:一处是「压缩期间被取消/
  被顶替」那一支(在分派之前,合法),一处才是这里的 else 分支。全局 `indexOf`
  抓的是前面那处,于是 `revokeAt < ownerAt` —— 「顺序反了」,而代码根本没反。
  (写这段时正是这么红了一次。)
*/
const dispatchSrc = ownerAt === -1 ? '' : recognizeOneSrc.slice(ownerAt, ownerAt + 400)
check(
  '(锚点) 取到了 recognizeOne 的源码',
  recognizeOneSrc.includes('export async function recognizeOne') && recognizeOneSrc.length > 2000,
  `${recognizeOneSrc.length} 字符`
)
check(
  '**分派真的走了 `previewOwnership(opts)`,而且撤销那一行就在这个分派块里（在它之后）**'
    + '(直接写回 `else if (!attachPreview)` 就是那个漏过的老写法)',
  ownerAt !== -1 && dispatchSrc.includes("=== 'caller'") && dispatchSrc.includes(REVOKE_LINE),
  `previewOwnership@${ownerAt} / 这一块里:${dispatchSrc.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')}`
)

/*
  交给调用方的那份照片**就是发给模型的那几个字节**(2026-09-24,`onImage`)。

  ⚠️ 这条只能看源码:`recognizeOne` 里的 `prepareImage` 要真的 canvas,
  Node 跑不起来(压缩那一层的断言在 `verify-image`,它给 `prepareImage` 注了假 deps)。
  所以钉的是**两处引用的是不是同一个东西** —— `onImage` 交出去的那个标识符,
  和请求体里 `image:` 那个,必须是同一个。写成 `prepared.file`(原图,几 MB、
  可能还是 HEIC)或者 `prepared.previewUrl`(object URL,换个页面就失效)
  都会让存进 IDB 的那份**不是喂给模型的那些字节**,而功能看起来完全正常。

  另外两条顺序也是判据:
    · 在 `previewOwnership` **之后** —— 取消掉、被顶替的图走不到那儿,它们的
      照片不该进草稿(那几道菜根本不在那张卡上)。
    · 在**发请求之前** —— 识别挂了(超时/上游 500)时照片照样得存下来,
      否则用户下次点「记入日记」只会看到「那张照片已经不在本机了」。
*/
const onImageAt = recognizeOneSrc.indexOf('opts.onImage?.(prepared.blob)')
const imageArgAt = recognizeOneSrc.indexOf('image: prepared.blob')
check(
  '**`onImage` 交的就是上传那份字节**(和请求体里 `image:` 是同一个 `prepared.blob`)',
  onImageAt !== -1 && imageArgAt !== -1,
  `onImage@${onImageAt} / image:@${imageArgAt}`
)
check(
  '**而且它在预览图分派之后、发请求之前**'
    + '(太早 = 被取消的照片也进草稿;太晚 = 识别一挂照片就没了)',
  ownerAt !== -1 && onImageAt > ownerAt && onImageAt < imageArgAt,
  `分派@${ownerAt} / onImage@${onImageAt} / 发请求@${imageArgAt}`
)

/*
  草稿那条链的四步。四步缺任何一步都是**静默失效**:
  少写 → 下次进来什么都不弹;少问 profileId → 弹一份别人的菜;
  少清 → 那份菜永远问不完。
*/
check(
  '**合成完就写草稿,而且写之前先过 `unloggedFrom` 那个判据**',
  chatPageSrc.includes('unloggedFrom(') && chatPageSrc.includes('saveUnlogged('),
  `unloggedFrom ${chatPageSrc.includes('unloggedFrom(')} / saveUnlogged ${chatPageSrc.includes('saveUnlogged(')}`
)
check(
  '**挂载时先问一句「是不是这个档案的」**',
  chatPageSrc.includes('shouldAskUnlogged(') && chatPageSrc.includes('loadUnlogged()'),
  `shouldAskUnlogged ${chatPageSrc.includes('shouldAskUnlogged(')}`
)
/*
  ⚠️ 打字那条路也要写草稿（2026-09-24，用户：「问菜的做法，刷新后就不会弹出
  是否记入日记的窗口，但我觉得这个是需要的」）。从前唯一的写入口在 `sendPhotos`
  里，纯文字聊完什么都不弹。

  判据看的是**那三句连在一起**（`provisionalFromReply` → `from: 'text'` →
  `saveUnlogged`）：少任何一句都是静默失效 —— 少第一句没有菜名可存，少第二句
  落错位顶掉他拍的那一餐，少第三句什么都不发生。

  ⚠️ 位置也在判据里：这一段必须在 `answer(` 的函数体里。写进 `sendPhotos`
  与 `onSend` 之间那一段的话，上面 ④ 那一节「发图那条路不许出现 `answer(`」
  的窗口断言会跟着变味（那段窗口是两个函数之间的全部文字）。
*/
const answerSrc = windowBetween(chatPageSrc, 'async function answer(', 'async function send(')
check(
  '(锚点) `answer()` 的函数体切到了 —— 下面那条不是拿空串在比',
  answerSrc.includes('provisionalFromReply('),
  answerSrc.trim() ? `${answerSrc.length} 字符` : '切不到'
)
check(
  '**打字问出来的回答也写一份草稿**（`provisionalFromReply` → `from: \'text\'` → `saveUnlogged`）',
  answerSrc.includes('provisionalFromReply(') &&
    answerSrc.includes("from: 'text'") &&
    answerSrc.includes('saveUnlogged('),
  `provisional ${answerSrc.includes('provisionalFromReply(')} / from:text ${answerSrc.includes("from: 'text'")} / save ${answerSrc.includes('saveUnlogged(')}`
)
check(
  '**挂载时两个存档位都看**（只读 `photo` 的话打字那份永远不问）',
  chatPageSrc.includes("loadUnlogged() ?? loadUnlogged('text')"),
  chatPageSrc.includes("loadUnlogged('text')") ? '看了' : '只看了 photo 那个位'
)
/**
 * 小图是从草稿里带过来的,不是写死的一串 —— 写死的话那条记录配的就不是这张照片。
 *
 * ⚠️ 这里是**对话页**的窗口,而落盘那一步 2026-09-24 下午搬去了 `store/logRun.ts`
 * —— 所以这一条现在量化的是**同一件事的另一半**:草稿一存下来就带着图,
 * 而且落盘那一步读的是同一份草稿(而不是另拼一个对象)。真正「写进去带图」
 * 那半边在下面 ⑧b 的窗口里(`thumb: meal.thumb`)。
 */
const thumbWired = /thumb\s*:\s*meal\.thumb/.test(logRunSrc)
check(
  '**「记入日记」真的写进了日记,而且带着那张小图**(用户定的:这条记录配第 1 张成功识别的小图)',
  logRunSrc.includes('addMeal(') && thumbWired,
  `addMeal ${logRunSrc.includes('addMeal(')} / thumb: meal.thumb ${thumbWired}`
)
/*
  ⚠️ 判据**不能写成「`clearUnlogged()` 出现 ≥ 2 次」**。文件里它本来就有三处
  （两个出口 + 记录面板存完那一下），删掉其中一个还剩两处 —— 那条断言照样绿。
  数出现次数永远量不出「哪一条路清掉了」，得看**每个函数体里有没有**。
*/
/*
  ⚠️ **这四个函数 2026-09-24 下午整个搬去了 `src/store/logRun.ts`。**
  名字和顺序**原样搬的**,所以这一段的改法只是把底稿从 `chatPageSrc` 换成
  `logRunSrc` —— 锚点一个字都没动。搬家理由见那个文件头(那一趟不能再住在
  组件里:日记页够不着另一个组件的闭包,而离开这一页又会把落盘一起掐掉)。

  `dismissUnlogged` **没搬** —— 它收的是这一页的弹窗 state,只有这一页能做。
*/
const computeSrc = windowBetween(logRunSrc, 'const computeForLog', 'const runCompute')
const runComputeSrc = windowBetween(logRunSrc, 'const runCompute', 'const logUnlogged')
const logUnloggedSrc = windowBetween(logRunSrc, 'const logUnlogged', 'const adjustUnlogged')
/*
  右边界换成 `export function pendingForDate` —— `adjustUnlogged` 之后是两个纯函数
  (`pendingForDate` / `noticeFor`),它们**不是**这一趟的一部分,切进来会把
  「给屏幕的尺子」和「落盘流程」混成一段(那一段上的断言就再也量不准了)。
*/
const adjustSrc = windowBetween(logRunSrc, 'const adjustUnlogged', 'export function pendingForDate')
/*
  `dismissUnlogged` **没搬**,窗口仍然是对话页里那一段(它是那一节最后一个函数,
  后面紧跟的是那个 useEffect 的长注释,没有干净的函数名可以当右边界)。
  ⚠️ 它当天长过一次(多了「把在途那一趟掐掉」那几句),200 字符的窗口正好把
  `setAskOpen(false)` 切在外面 —— 于是锚点那条红,而红的原因是窗口太短,
  不是代码错了。给到 400,再长就让它红(锚点会说话),不悄悄放过。
*/
const dismissSrc = windowAfter(chatPageSrc, 'const dismissUnlogged', 400)

check(
  '(锚点) 那四个函数体都切到了',
  computeSrc.includes('getDraftPhotos()') &&
    runComputeSrc.includes("phase: 'failed'") &&
    logUnloggedSrc.includes('addMeal(') &&
    adjustSrc.includes("phase: 'adjust-ready'") &&
    dismissSrc.includes('setAskOpen(false)'),
  `${computeSrc.length} / ${runComputeSrc.length} / ${logUnloggedSrc.length} / ${adjustSrc.length} / ${dismissSrc.length} 字符`
)

/* ---------- ⑧b 记日记那一刻才调食衡(2026-09-24) ---------- */

/*
  ⚠️ 这一整块是用户那天定的口径的落点:
  「用户如果说加入档案日记里,那就那个时候再调用食衡agent,
    如果后续没有点击计入日记,那就不管」。

  四件事缺任何一件都是**静默失效**(不会报错,只是记进日记的数是错的):

    1. 调的是**食衡**,不是膳享+ —— 查库外菜营养的那组节点只在食衡工作流里。
       走错了不会报错,库外那道菜会一路落到 0,而屏幕上写得像一份真的结果。
    2. 调在 `addMeal` **之前** —— 反过来的话,写进日记的还是那份没营养的清单。
    3. 算完还要过 `countableItems` 那道闸 —— 一道能计量的都没有时不落盘。
    4. 失败那条路上**没有 `addMeal`** —— 宁可不记,不记假的。
*/
check(
  '**记进日记之前真的调了识别**(不调就是拿一份没营养的菜名清单落盘)',
  computeSrc.includes('recognizeOne('),
  computeSrc.includes('recognizeOne(') ? '调了' : '没调 —— 那份清单上没有数'
)
check(
  '**而且调的是食衡,不是膳享+**(查库外菜营养的那组节点只在食衡工作流里)',
  !computeSrc.includes("agent: 'chat'"),
  computeSrc.includes("agent: 'chat'") ? "写了 agent: 'chat' —— 库外那道菜会算出 0" : '没写 agent = 食衡'
)
/*
  ⚠️ **这条的窗口只能是照片那一支的尾巴**（2026-09-24 收窄过一次）。

  原来判的是整个 `computeSrc.includes('countableItems(')`。打字那一支
  （`from === 'text'`）的开头也有一处 `countableItems(` —— 于是把**函数尾
  照片那处**摘掉之后，打字那处仍然让判据为真，这条断言**弄坏了也不红**
  （breaktest 报的就是这一条：`绿 补记 | 把 countableItems 那道闸摘了`）。

  从读照片那句往后切：照片那一支只剩这一处。切不到时 `indexOf` 给 -1，
  `slice(-1)` 是最后一个字符，判据为假 —— 会红，不会静默放过
  （上面那条锚点同时盯着 `getDraftPhotos()` 在不在）。
*/
const photoTailSrc = computeSrc.slice(computeSrc.indexOf('const photos = await getDraftPhotos()'))
check(
  '**算完还要过 `countableItems` 那道闸**(一道能计量的都没有 = 不记,宁可不记不记一条 0 kcal)',
  photoTailSrc.includes('countableItems('),
  photoTailSrc.includes('countableItems(') ? '有闸' : '没闸'
)
/*
  ⚠️ 打字那份（`from: 'text'`，2026-09-24）走的是**另一个分支**，两条都是静默失效：

    · 它必须在**读照片之前**分叉。照片是单槽的（`draftPhotos` 的 `'current'`）
      —— 打字那份写下去时照片位上还留着上一批，读它会算出**上一餐的菜**，
      再用这份草稿的 `slot` / `at` 落盘。静默配错，这里最坏的一种。
    · 它**要调食衡**（`recognizeByNames`）—— 营养是食衡算的，不是本地拿食物库
      常见分量凑的。少了这一步，库外菜就永远只有一个本地编的数。
    · 函数尾那道 `countableItems` 闸在照片分支**后面**，打字那一支走不到，
      所以它得**自己再走一次**。少了它，一份全是库外菜的草稿会一路落盘成
      一条 0 kcal 的记录。
*/
const textBranchSrc = windowBetween(computeSrc, "if (meal.from === 'text') {", 'const photos = await getDraftPhotos()')
check(
  '(锚点) 打字那一支切到了（窗口的右边界是那句读照片 —— 分叉挪到它下面就切不到）',
  textBranchSrc.includes('recognizeByNames('),
  textBranchSrc.trim() ? `${textBranchSrc.length} 字符` : '切不到'
)
check(
  '**打字那一支不读照片**(读照片会拿上一批的图算出上一餐的菜)',
  !textBranchSrc.includes('getDraftPhotos'),
  textBranchSrc.includes('getDraftPhotos') ? '读了照片' : '没读'
)
check(
  '**打字那一支把菜名交给食衡算**(本地拿食物库常见分量凑的那一版被驳回过)',
  textBranchSrc.includes('recognizeByNames(') && !textBranchSrc.includes('defaultPortionItems'),
  textBranchSrc.includes('recognizeByNames(') ? '交给食衡了' : '没交 —— 营养是本地凑的'
)
check(
  '**打字那一支自己带那道闸**(函数尾那道在照片分支后面,它走不到)',
  textBranchSrc.includes('countableItems('),
  textBranchSrc.includes('countableItems(') ? '有闸' : '没闸 —— 库外菜会落成一条 0 kcal'
)
check(
  '**失败那条路上没有 `addMeal`**(`computeForLog` 只管算,落盘只在调用方的 then 里)',
  !computeSrc.includes('addMeal(') && !runComputeSrc.includes('addMeal('),
  computeSrc.includes('addMeal(') ? '算的那个函数自己落盘了' : '没有'
)
check(
  '**而失败那一支是 `return` 掉的,落盘那句根本轮不到**'
    + '(反过来的话,算失败了照样落盘 —— 那正是「记一条假的」)',
  /*
    ⚠️ 判据**只看顺序**,不看谁先谁后写在同一行:两条路都在 `runCompute` 里,
    而 `if (!res.ok) { … return }` 必须排在分派那两句之前。把 `return` 去掉
    (写成只 `setLogRun` 不 return)这一条**照样绿**,所以下面另有一条盯 `return`。
  */
  runComputeSrc.indexOf("phase: 'failed'") !== -1 &&
    runComputeSrc.indexOf("phase: 'failed'") < runComputeSrc.indexOf('logUnlogged(meal, res.items)') &&
    runComputeSrc.indexOf("phase: 'failed'") < runComputeSrc.indexOf('adjustUnlogged(meal, res.items)'),
  `失败@${runComputeSrc.indexOf("phase: 'failed'")}`
    + ` / 记@${runComputeSrc.indexOf('logUnlogged(meal, res.items)')}`
    + ` / 调@${runComputeSrc.indexOf('adjustUnlogged(meal, res.items)')}`
)
/*
  ⚠️ 上一条只量「失败态排在落盘前面」,**量不出那一支有没有 `return`**。
  没有 `return` 的话:算失败 → 写下失败态 → **接着往下走** → 拿一份不存在的
  `res.items` 去落盘(或者落一份空的)。所以这一条单独钉那句 `return`。
  窗口只切 `if (!res.ok) {` 到分派那两句之间 —— 全文数 `return` 数次数量不出
  「哪一支返回了」(`runCompute` 开头那句号对不上也 return)。
*/
const failBranch0 = windowBetween(runComputeSrc, 'if (!res.ok) {', 'if (kind === ')
check(
  '**失败那一支里确实有一句 `return`**(只写失败态不返回的话,下面照样会去落盘)',
  failBranch0.includes('return'),
  failBranch0.trim() ? failBranch0.trim().split('\n').map((l) => l.trim()).join(' ') : '切不到'
)
/*
  ⚠️ 「算不出来就不落盘」的**另一半是草稿留着**:清掉的话那顿饭永远问不出来了,
  而屏幕上什么都不说。失败那条路上不许出现 `clearUnlogged` / `dropDraftPhotos`。
*/
check(
  '**没算出来时草稿和照片都留着**(下次进来还会问,这是「不记」和「永不记」的区别)',
  !runComputeSrc.includes('clearUnlogged(') && !runComputeSrc.includes('dropDraftPhotos('),
  runComputeSrc.match(/clearUnlogged\(|dropDraftPhotos\(/)?.[0] ?? '失败分支干净'
)

/*
  ⚠️ 2026-09-24 起 `clearUnlogged` **要带上是哪个位**（两个存档位，见
  `store/unlogged.ts` 文件头）。所以判据从 `clearUnlogged()` 改成
  `clearUnlogged(meal.from)` / `clearUnlogged(from)` —— 不带参数的写法现在
  连 typecheck 都过不了，这里钉的是**清的是哪一位**这件事：清错位不会报错，
  只是把另一份没被问过的草稿留在了盘上（或者把它清掉了）。
*/
check(
  '**两个出口各自都清了草稿,而且「记入日记」是先写日记、再清草稿**'
    + '（用户定的:问过一次的不再问 —— 判据只有「草稿还在不在」这一处）',
  logUnloggedSrc.includes('clearUnlogged(meal.from)') &&
    logUnloggedSrc.indexOf('addMeal(') < logUnloggedSrc.indexOf('clearUnlogged(meal.from)') &&
    logUnloggedSrc.includes('dropDraftPhotos()') &&
    dismissSrc.includes('clearUnlogged(from)') &&
    dismissSrc.includes('dropDraftPhotos()'),
  `写日记@${logUnloggedSrc.indexOf('addMeal(')} / 清草稿@${logUnloggedSrc.indexOf('clearUnlogged(meal.from)')}`
    + ` / 不用了那条:草稿 ${dismissSrc.includes('clearUnlogged(from)')} 照片 ${dismissSrc.includes('dropDraftPhotos()')}`
)
/*
  ⚠️ 「调整分量再记」走的也是「先算」,而且预填的是**算出来的那份**
  (`setAdjustItems(items)`),不是草稿里那份菜名清单 —— 面板保存时是它自己调
  `addMeal` 的,喂错那一份就是往日记里写一条 0 kcal。
*/
/*
  ⚠️ 「调整分量再记」那条路**也是先算**的,而且交出去的是**算出来的那份**
  (`res.items`),不是草稿里那份菜名清单(`meal.items`)。面板保存时是它自己调
  `addMeal` 的,喂错那一份 = 用户改完分量一保存,写进日记的还是 0 kcal。

  搬出组件之后这一条**变了形状**:原来量的是「`adjustUnlogged` 里先 `runCompute`
  再 `setAdjustItems`」,现在是「两条出口都从 `runCompute` 那一处分派,而且两边
  拿的都是 `res.items`」。判据仍然只看**那两句分派**,全文数 `res.items` 数次数量不出
  「交给面板的是哪一份」。
*/
check(
  '**「调整分量再记」交出去的是算出来的那份,不是草稿里那份菜名清单**'
    + '(喂错那一份,用户改完分量一保存,写进日记的还是没营养的)',
  runComputeSrc.includes('adjustUnlogged(meal, res.items)') &&
    !runComputeSrc.includes('adjustUnlogged(meal, meal.items)') &&
    runComputeSrc.includes('logUnlogged(meal, res.items)'),
  runComputeSrc.includes('adjustUnlogged(meal, meal.items)')
    ? '喂的是草稿那份菜名清单'
    : '两条出口都拿 res.items'
)
check(
  '**而且面板预填的确实是这一份**(`adjust-ready` 里带着 `items`)',
  adjustSrc.includes("phase: 'adjust-ready'") && /\bitems\b/.test(adjustSrc),
  adjustSrc.trim() ? adjustSrc.trim().split('\n').map((l) => l.trim()).filter((l) => l.startsWith('setLogRun')).join(' ') : '切不到'
)

/* ---------- ⑧c 点完「记」:收屏、弹卡、失败要说出来(2026-09-24 下午) ---------- */

/*
  三条只有源码能验的不变量,**三条都是静默失效**:坏了不会报错,只是用户要么
  守着一个不动的屏幕,要么最后什么都看不到。文案那半边在 ⑦b(渲染)。
*/
/*
  ⚠️ 「收屏」和「起一趟」现在分住在两个地方(前者是这一页的弹窗 state,后者是
  store)—— 所以判据也得切成两半,**各自在自己的窗口里找**。
  全文搜「`setAskOpen(false)` 和 `startLogRun` 都在这个文件里」是假的:
  `setAskOpen(false)` 在别处也有(补记弹窗那三个出口各有一句)。
*/
const beginSrc = windowBetween(chatPageSrc, 'const beginLogRun', 'const dismissUnlogged')
check(
  '**点下去那一屏就收了**(计算不再画在页面上 —— 用户定的)',
  beginSrc.includes('setAskOpen(false)'),
  beginSrc.trim() ? beginSrc.trim().split('\n').map((l) => l.trim()).filter((l) => l.startsWith('set')).join(' / ') : '切不到'
)
check(
  '**而且当场把这一趟挂上去**(`computing` 是同步写下的 —— 落到 `await` 之后就有一帧「点了没反应」)',
  runComputeSrc.includes("setLogRun({ phase: 'computing'") &&
    runComputeSrc.indexOf("setLogRun({ phase: 'computing'") < runComputeSrc.indexOf('await computeForLog'),
  `挂上@${runComputeSrc.indexOf("setLogRun({ phase: 'computing'")} / 开算@${runComputeSrc.indexOf('await computeForLog')}`
)
/*
  ⚠️ **`startLogRun` 在整个对话页里只能出现一次,而且必须是从那两个 `on*` 属性
  里下来的。** 理由不是洁癖:`main.tsx` 里挂着 `<StrictMode>`,effect 会被双调用,
  而这一趟每跑一次就烧一趟食衡额度 —— 放进 effect 里等于用户点一次、上游算两次。
  React 从不双调用事件处理器,所以「从手势里起」是结构性安全的。

  判据用**计数 + 调用点前缀**两步:只数次数的话,把那一句搬进 `useEffect` 里
  仍然是一次(照样绿);只看 `onLog=` 的话,别处再补一句也照样绿。
*/
const startCalls = chatPageSrc.match(/startLogRun\(/g)?.length ?? 0
const beginCalls = chatPageSrc.match(/beginLogRun\(unlogged, '(log|adjust)'\)/g)?.length ?? 0
check(
  '**这一趟是从点击事件里起的,不在 effect 里**'
    + '(StrictMode 双调用 effect = 用户点一次、上游算两次)',
  startCalls === 1 && beginCalls === 2 && /onLog=\{\(\) => unlogged && beginLogRun\(unlogged, 'log'\)\}/.test(chatPageSrc),
  `startLogRun 调用 ${startCalls} 处 / 两个出口 ${beginCalls} 处`
)
/*
  ⚠️ **失败那一支必须自己把卡重新弹出来。** 用户在等的那十几秒里完全可以把它关掉
  (关掉是允许的,他不该为此付出代价),不重弹这一趟就一句话都没说 —— 而屏幕上
  看起来和「已经记进去了」一模一样。

  ⚠️ 判据**只切失败那一支**,不是全文里数 `setLogNotice` 出现了几次:数次数量不出
  「哪条路弹的」,开头那一句 `setLogNotice` 摆在那儿就能把这一条蹭绿
  (这个仓库点过名的那类假绿)。
*/
/*
  ⚠️ 右边界用 `'logUnlogged(meal, res.items)'`(失败那一支后面紧跟的分派),
  **不能写 `'return'`**:`runCompute` 里 `if (myGen !== generation) return` 那一句
  排在 `if (!res.ok)` **前面**,而 `windowBetween` 取的是**全文里第一处** ——
  右边界落在左边界之前,切出来是空串(写这段时正是这么红了一次:详情印「切不到」)。
*/
const failBranch = windowBetween(runComputeSrc, 'if (!res.ok) {', 'logUnlogged(meal, res.items)')
check(
  '**没算出来时那一趟切到失败态**(用户可能早把卡关了 —— 不重弹就等于一句话都没说)',
  failBranch.includes("phase: 'failed'"),
  failBranch.trim() ? `失败那一支:${failBranch.trim().split('\n').map((l) => l.trim()).join(' ')}` : '切不到'
)
/*
  ⚠️ **「失败永远说」这一半现在住在 `noticeFor` 里**(它把「那一趟到哪儿了」翻成
  「那张卡该说什么」,两个页面共用一把尺子)。所以判据也从 `runCompute` 挪过去:
  那一支**不许看 `closed`**。

  反方向同样要钉:`computing` / `logged` **必须**看 `closed` —— 用户关掉那张卡
  说的正是「这句我知道了」(见 `LogNotice` 文件头第 2 段),关掉之后算成了再弹回来
  报一次成功,就是把他刚说的话作废。
*/
/*
  ⚠️ 右边界用 `windowAfter`(固定长度),**不能用 `windowBetween(…, '\\n}')`**:
  `windowBetween` 取的是**全文第一处**,而 `logRunSrc` 里第一个顶格的 `}` 是
  `setLogRun` 的结尾 —— 右边界落在左边界之前,切出来是空串(和 `failBranch`
  上面那条同一个坑)。`noticeFor` 是文件里最后一个函数,取到多远都只到文件尾。
*/
const noticeSrc = windowAfter(logRunSrc, 'export function noticeFor', 900)
const failedCase = windowBetween(noticeSrc, "case 'failed':", "case 'logged':")
const loggedCase = windowBetween(noticeSrc, "case 'logged':", "case 'computing':")
const computingCase = windowAfter(noticeSrc, "case 'computing':", 200)
check(
  '(锚点) `noticeFor` 那三支都切到了',
  failedCase.includes('run.message') && loggedCase.includes('done: true') && computingCase.includes('done: false'),
  `${failedCase.length} / ${loggedCase.length} / ${computingCase.length} 字符`
)
check(
  '**失败那一支不看 `closed`**(用户在等的时候可以把卡关掉,关掉之后这一趟照样得说出来)',
  failedCase.includes('run.message') && !failedCase.includes('closed'),
  failedCase.includes('closed') ? '失败也听「关过卡」—— 那就一句话都没说' : '失败了就一定会说'
)
check(
  '**而算成了那一支看 `closed`**(关过就不再弹回来报一次成功 —— 他说了关不关由他)',
  loggedCase.includes('closed ? null') && computingCase.includes('closed ? null'),
  `成了:${loggedCase.includes('closed ? null')} / 在算:${computingCase.includes('closed ? null')}`
)

/* ---------- ⑧d 那一趟「记进日记」不跟着页面走(2026-09-24 下午) ---------- */

/*
  用户那天连报三次「还是没记进日记」(原话见 `runCompute` 的注释)。根子是:
  **点完「记入日记」之后,他最常见的下一步就是离开这一页去看日记**,而离开会
  卸载这一页 —— 卸载那段 cleanup 里当时写着 `abortLogRun()` + `logRunRef.current++`,
  于是那一趟连同落盘一起被掐掉,而且**一句话都没说**。

  这一组钉的就是那条分界:**落盘不跟着页面走,只有屏幕跟着**。
  三条都是静默失效 —— 坏了不报错,只是日记里永远少那一条。
*/
/*
  ⚠️ 窗口取卸载那一支,**不是整个文件**:`cancelLogRun()` 现在仍然出现在
  `dismissUnlogged` 里(那是用户明说「不用了」的那一刀,必须留着)。全文数它
  出现了几次,数不出「哪一处掐了在途的那一趟」—— 那正是这个仓库点过名的那类假绿。
  (`discardAll(staged)` 在这个文件里只有卸载那一处是**调用**,其余都在注释里,
   而 `chatPageSrc` 已经剥过注释。)

  ⚠️ 右边界从 `aliveRef.current = false` 换成 `const grounding`(卸载那段
  cleanup 后面紧跟的第一个真代码)。**不能写 `discardAll(staged)`** ——
  `windowBetween` 切的是 `[i, j)`,右边界自己**不在**窗口里,于是下面那条
  「切到了」的锚点会报 39 字符而红(实测就是这一版红的:锚点那行印 39 字符)。
*/
const unmountSrc = windowBetween(chatPageSrc, 'endRun()', 'const grounding')
check(
  '(锚点) 卸载那一支切到了',
  unmountSrc.includes('releaseUrls()') && unmountSrc.includes('discardAll(staged)'),
  `${unmountSrc.length} 字符`
)
check(
  '**离开这一页不再把在途那一趟掐掉**(掐了就等于「卡上说会自动记,他去看,什么都没有」)',
  !unmountSrc.includes('cancelLogRun'),
  unmountSrc.includes('cancelLogRun')
    ? '卸载里又把那一趟掐了'
    : '卸载只收屏幕,不动那一趟'
)
/*
  ⚠️ 上一条只证明「卸载里没有」,**证明不了别处没有多出来一处** —— 需要在整页上
  数一次:作废一趟的调用**全 App 只有两处**,而对话页里只许有一处(「不用了」)。
  另一处在 `abortProfileWork`(切/删档案),由下面那条单独钉。

  计数用 `cancelLogRun(`(带左括号):import 那一行是 `cancelLogRun,`,数不进去。
*/
const cancelCalls = chatPageSrc.match(/cancelLogRun\(/g)?.length ?? 0
check(
  '**对话页里「作废一趟」只出现在「不用了」那一条路上**(多出一处 = 别的地方也在偷偷掐它)',
  cancelCalls === 1 && dismissSrc.includes('cancelLogRun()'),
  `调用 ${cancelCalls} 处 / 在 dismissUnlogged 里 ${dismissSrc.includes('cancelLogRun()')}`
)
/*
  ⚠️ **切/删档案必须把在途那一趟掐掉**,否则:为档案 A(花生过敏)拍的饭还在算,
  用户切到 B —— 算完 `addMeal` 一写,**一条为 A 算出来的记录永久落进了 B 的日记**。
  比「为 A 做的拦截产出落进 B」还重,因为它写进的是日记本。

  这一条是**搬出组件之后新长出来的**:住在组件里那会儿,切档案会卸载对话页,
  卸载顺带把那一趟掐了(那正是「离开页面就不落盘」那个 bug 的另一面)。
  现在卸载不掐了,档案那条路就得自己掐 —— 不钉的话它是一处**静默失效**。
*/
const plateSrcForLogRun = stripComments(await readFile('src/store/plate.ts', 'utf8'))
/*
  ⚠️ 右边界又是那个坑:写 `'\\n}'` 会取到**全文第一处**顶格 `}`,而那在
  `abortProfileWork` 前面 —— `windowBetween` 于是返回空串,下面那条断言
  **永远绿**。`abortProfileWork` 之后的邻居是注释块,拿固定长度更省事。
*/
const abortProfileSrc = windowAfter(plateSrcForLogRun, 'function abortProfileWork', 700)
check(
  '**切/删档案会把在途那一趟掐掉**(不掐的话,为 A 算的那一餐会落进 B 的日记)',
  abortProfileSrc.includes('cancelLogRun()'),
  abortProfileSrc.trim() ? `abortProfileWork 里:${abortProfileSrc.includes('cancelLogRun()')}` : '切不到'
)
/*
  ⚠️ 反方向:**`cancelLogRun` 不写失败态**。切档案之后 B 的日记上不许冒出一句
  「没算出来 —— 这条还留着」,而 B 从没点过任何东西。判据是它那三句里没有
  `setLogRun({ phase: 'failed'`,也没有任何 `setLogRun({`(它只写 `null`)。
*/
const cancelSrc = windowAfter(logRunSrc, 'export function cancelLogRun', 220)
check(
  '**它只作废、不说话**(切成 B 之后,B 的日记上不该冒出一句他从没点过的「没算出来」)',
  cancelSrc.includes('setLogRun(null)') && !/setLogRun\(\{/.test(cancelSrc),
  cancelSrc.trim() ? cancelSrc.trim().split('\n').map((l) => l.trim()).filter((l) => l.startsWith('setLogRun')).join(' / ') : '切不到'
)
/*
  ⚠️ 落盘的判据里**没有「页面在不在」这一层**了。`logUnlogged` 在组件里那会儿
  后面跟着一句 `if (!shown) return`,三件落盘刻意排在它前面;搬出来之后那个参数
  **不是被删掉,是不再存在** —— 这里根本没有页面可以问。

  ⚠️ 判据不能写成「`shown` 一次都不出现」:那个词在注释里(剥掉了)和在
  `unlogged.ts` 里都有。所以只看 **`logUnlogged` 这一个函数体**:里面有
  `addMeal(`,而且没有 `shown` / `alive` 这类词、也没有任何挡在落盘前的 `return`。
*/
check(
  '**落盘那一趟里没有「还有没人看」这一层**(人走了不是不落盘的理由 —— 用户三次报的就是这个)',
  logUnloggedSrc.includes('addMeal(') &&
    !logUnloggedSrc.includes('shown') &&
    !logUnloggedSrc.includes('alive') &&
    !logUnloggedSrc.slice(0, logUnloggedSrc.indexOf('addMeal(')).includes('return'),
  `写日记@${logUnloggedSrc.indexOf('addMeal(')} / shown ${logUnloggedSrc.includes('shown')}`
    + ` / 落盘前的 return ${logUnloggedSrc.slice(0, logUnloggedSrc.indexOf('addMeal(')).includes('return')}`
)
/*
  ⚠️ **落盘三件的顺序:写日记 → 清草稿 → 删照片。**
  中间那一步反过来的话(先清草稿再写日记),写日记那一刻读到的是一份已经被清掉的
  草稿 —— 而草稿正是这一条记录的来源。上面那条 ⑧b 里已经钉过一次顺序,这里
  钉的是**第三步也在**:照片不清的话,用户拍的那几张能一直躺在他浏览器里。
*/
check(
  '**落盘三件齐全,而且写真排在清草稿前面**(先有记录再清来源)',
  logUnloggedSrc.indexOf('addMeal(') !== -1 &&
    logUnloggedSrc.indexOf('addMeal(') < logUnloggedSrc.indexOf('clearUnlogged(meal.from)') &&
    logUnloggedSrc.indexOf('clearUnlogged(meal.from)') < logUnloggedSrc.indexOf('dropDraftPhotos()'),
  `写日记@${logUnloggedSrc.indexOf('addMeal(')}`
    + ` / 清草稿@${logUnloggedSrc.indexOf('clearUnlogged(meal.from)')}`
    + ` / 删照片@${logUnloggedSrc.indexOf('dropDraftPhotos()')}`
)
/*
  ⚠️ **照片只属于拍的那一份。** 打字那份压根没往照片位写过东西，替它调
  `dropDraftPhotos()` 删的是**上一批照片**（可能正是他还没记的那一餐的）。
  这条钉的是「删照片那一步带条件」—— 上面那条只量顺序，量不出条件。
*/
check(
  '**删照片那一步只在 `from === \'photo\'` 时走**（打字那份不许碰照片位,那是别人的照片）',
  logUnloggedSrc.includes("meal.from === 'photo'") && dismissSrc.includes("from === 'photo'"),
  `logUnlogged ${logUnloggedSrc.includes("meal.from === 'photo'")} / 不用了那条 ${dismissSrc.includes("from === 'photo'")}`
)
/*
  ⚠️ **`aliveRef` 那一对置位整个删掉了**(2026-09-24 下午)。它当年的用处是
  「这一页还挂着没有」,而搬出去之后那个问题不存在了。留着一条**永远绿的假断言**
  比没有更糟(它看起来像还有什么东西在盯着),所以连同这一段测试一起删。
  这条盯的就是「它别再回来」。
*/
check(
  '**`aliveRef` / `logRunRef` 不许回到对话页**(落盘已经不看页面在不在,再摆一个号就是死代码)',
  !chatPageSrc.includes('aliveRef') && !chatPageSrc.includes('logRunRef'),
  `aliveRef ${chatPageSrc.includes('aliveRef')} / logRunRef ${chatPageSrc.includes('logRunRef')}`
)
/*
  ⚠️ 搬干净了没有:那四个函数**只能在 store 里有一份**。半搬(store 里一份、
  对话页还留着旧的一份)是最坏的形态 —— 两处各跑各的,改一处另一处照旧跑,
  而屏幕上看起来一模一样。
*/
check(
  '**那一趟整个住在 `store/logRun.ts`,对话页一行都没有**(半搬的话两个地方各有一份)',
  ['computeForLog', 'runCompute', 'logUnlogged', 'adjustUnlogged'].every((n) => logRunSrc.includes(`const ${n} `)) &&
    ['computeForLog', 'runCompute', 'logUnlogged', 'adjustUnlogged'].every((n) => !chatPageSrc.includes(`const ${n} `)),
  ['computeForLog', 'runCompute', 'logUnlogged', 'adjustUnlogged']
    .map((n) => `${n}:${logRunSrc.includes(`const ${n} `) ? 'store' : '-'}${chatPageSrc.includes(`const ${n} `) ? '+chat' : ''}`)
    .join(' ')
)

/* ---------- ⑧e 日记页那一行接上了没有(2026-09-24 下午) ---------- */

/*
  用户要的是**确定性**:「点完确认之后屏幕上没有反应」和「它在算」在日记页上
  长得一模一样。所以那一行必须真的接在这一页上 —— **组件写好了但没挂上去**
  是这个仓库点过名的一类失效(逻辑全绿、屏幕上什么都不发生)。
*/
const diarySrc = stripComments(await readFile('src/screens/DiaryScreen.tsx', 'utf8'))

check(
  '**日记页那一行是 `pendingForDate` 判的,不是这一页自己又判一遍**(两页共用一把尺子)',
  diarySrc.includes('pendingForDate(logRun, date)') && diarySrc.includes('useLogRun()'),
  diarySrc.includes('pendingForDate(') ? '判据在 store,调用在这一页' : '没接'
)
check(
  '**而且真的渲染出来了**(判据在、行不在 = 屏幕上什么都不发生)',
  diarySrc.includes('<PendingMealRow'),
  diarySrc.includes('<PendingMealRow') ? '挂上了' : '没挂'
)
/*
  ⚠️ **占位行不许进 `state.meals`。** `dayStats` 只按 `m.date === date` 过滤,
  一条伪记录会直接进当天营养、`mealCount`、健康分,并顺着首页黑卡和趋势一起错
  —— 而它比「少显示一行」难查得多(数字看着都合理,只是不是他吃的那份)。
  判据:这一页里**没有任何写 `meals` 的动作**(它只读 store 的记录)。
*/
check(
  '**占位行没有被塞进当天的记录表里**(塞进去就直接进营养、健康分和首页黑卡)',
  !/meals\.(push|splice|unshift)|setMeals\(/.test(diarySrc) && !diarySrc.includes('meals: [...'),
  '日记页只读记录,不造记录'
)
/*
  ⚠️ 空态那句「这一天还没有记录」和那一行**不能同屏**:前者是一句总结,后者是
  事实,同屏时用户读到的是「它到底知不知道我在记」。
*/
check(
  '**只有那一行、还没有真记录时,不说「这一天还没有记录」**(两句同屏会互相打架)',
  diarySrc.includes('view.meals.length === 0 && !pending'),
  diarySrc.includes('view.meals.length === 0 && !pending') ? '空态那个判据里带着 !pending' : '空态还是老判据'
)
/*
  ⚠️ 那一行**排在当天记录的最后**。位置不是随手放的:`dayStats` 按 `createdAt`
  升序,而 `addMeal` 固定写「此刻」当 `createdAt`,所以算完那条真记录**必然**
  落在今天已有记录之后 —— 也就是这一行的位置上,十几秒后它就地变成那一条。
  判据是「PendingMealRow 出现在那个 map 之后」,不是「这个组件在文件里」。
*/
check(
  '**那一行排在当天记录后面**(算完那条真记录就落在它那个位置上,不跳)',
  diarySrc.indexOf('view.meals.map(') !== -1 &&
    diarySrc.indexOf('view.meals.map(') < diarySrc.indexOf('<PendingMealRow'),
  `记录表@${diarySrc.indexOf('view.meals.map(')} / 那一行@${diarySrc.indexOf('<PendingMealRow')}`
)
/*
  ⚠️ 顶部那句总结也要认这一趟。不认的话:屏幕上只有那一行「正在算」,而上面
  仍写着「这一天没有记录 —— 记一餐」,两句同时在教用户两件相反的事。
*/
check(
  '**日视图顶部那句总结也认这一趟**(不然上面说「没有记录」、下面说「正在算」)',
  diarySrc.includes('这一餐还在算，算好了会记在这一天。'),
  diarySrc.includes('这一餐还在算') ? '说了' : '没说'
)

/*
  「补记」那条记录的日期和时间**必须从 `meal.at` 推**,不能用 `addMeal` 的默认值。

  `addMeal` 默认写「此刻」,而这份草稿会在 `localStorage` 里过夜:昨天 12:30 拍的
  一餐,今天早上八点进来点一下,默认值会写成**今天 08:00** —— 昨天那顿饭的数字
  记到今天头上,而弹窗上刚说过「昨天 12:30 识别到的这几道菜」。

  只盯**这一个函数体**里出现了 `date:` / `time:`,而且两边都从 `takenAt` 取。
  不写成「整个文件里搜 `toISODate`」—— 那会被别处的用法蹭绿。
*/
check(
  '**「记入日记」把日期和钟点都从 `meal.at` 推**(不然补的是「点按钮那一刻」)',
  logUnloggedSrc.includes('const takenAt = new Date(meal.at)') &&
    logUnloggedSrc.includes('date: toISODate(takenAt)') &&
    logUnloggedSrc.includes('time: formatTime(takenAt)'),
  `取时刻 ${logUnloggedSrc.includes('new Date(meal.at)')} / date ${logUnloggedSrc.includes('date: toISODate(')} / time ${logUnloggedSrc.includes('time: formatTime(')}`
)

/*
  照片存进去、记完清掉 —— 这两步是**新链路的命根子**:
  少存 = 下次点「记入日记」时无图可算(直接弹「照片已经不在了」);
  少清 = 用户拍的照片一直躺在浏览器里,而他以为早就没了。
*/
check(
  '**发图时把照片和草稿一起存下来**(少这一步,下次那两颗「记」的键什么都算不出来)',
  chatPageSrc.includes('putDraftPhotos(okPhotoBlobs(outcomes, blobs))'),
  chatPageSrc.includes('putDraftPhotos(') ? '存了' : '没存'
)

/* ============================================================
   记录面板的**编辑态**
   ------------------------------------------------------------
   日记里点一行现在打开的是「修改记录」,和创建共用一个面板。
   「点那一行」本身在 useState 里,SSR 够不到 —— 但**面板自身**是 `open` 为
   prop 的独立组件,可以直接渲染(和上面 SpeechSheet 那段同一个手法)。

   ⚠️ 编辑态**必须传 `open: true`**:组件在 `open=false` 时直接 `return null`,
   不传就是拿一条空串去 `includes`,下面每一条都会**假绿**。

   ⚠️ 还有一处 SSR 天生够不到,写在这里免得下次以为漏了:面板里「动了东西
   之后保存键写什么」需要组件状态。这里能验的两头是**编辑态没动**(→ 未做修改)
   和**创建态**(它的 dirty 恒为 true → 保存 · 共 N kcal),中间那一步
   (改完分量 → 按钮变回可点)只能手点,见下面的注释。
   ============================================================ */

console.log('\n=== 记录面板的编辑态 ===')

const dateMod = await server.ssrLoadModule('/src/lib/date.ts')
const nutritionMod = await server.ssrLoadModule('/src/lib/nutrition.ts')
const mealSheetMod = await server.ssrLoadModule('/src/components/MealSheet.tsx')
/** 取值范围 —— 「面板上能点到的」要和它对齐(见下面 ⑧ 那段注释) */
const MEAL_SLOTS_FLAT = (await server.ssrLoadModule('/src/lib/slots.ts')).MEAL_SLOTS
/** 库外菜那份每 100g 的值从真食物库里借 —— 手写一个缺字段的会在别处炸 */
const { FOOD_BY_ID: FOODS_BY_ID } = await server.ssrLoadModule('/src/data/foods.ts')
const ricePer100g = FOODS_BY_ID.get('rice').per100g

const renderSheet = (props) =>
  renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(mealSheetMod.MealSheet, props))
  )

/** 四天前 —— 既不是今天也不是昨天,副标题那一条才有区分度 */
const EDIT_DATE = dateMod.lastNDays(5)[0]

/*
  被编辑的那一条。**带照片、带库外菜** —— 这两样是「编辑一次会不会弄丢东西」
  的试纸:`thumb` 只进 save()(面板不显示它),库外菜的营养挂在条目自己身上。
*/
const WEB_ITEM = {
  foodId: 'web:青团',
  name: '青团',
  grams: 80,
  per100g: ricePer100g,
  source: '联网估算',
}
const EDIT_ENTRY = {
  id: 'm-editable',
  date: EDIT_DATE,
  slot: '午餐',
  time: '12:30',
  source: '拍餐盘',
  items: [{ foodId: 'rice', name: '米饭', grams: 150 }, WEB_ITEM],
  createdAt: 1,
  thumb: 'data:image/jpeg;base64,EDITSHEETTHUMB',
}

const editHtml = renderSheet({ open: true, entry: EDIT_ENTRY, onClose: () => {} })
const createHtml = renderSheet({ open: true, onClose: () => {} })

check('面板确实渲染出来了(下面每一条的前提)', editHtml.length > 1000, `${editHtml.length} 字符`)

// ① 标题与 aria-label:两处都要改,只改一处读屏用户听到的还是旧名
check(
  '**编辑态标题是「修改记录」**',
  editHtml.includes('>修改记录</span>') && editHtml.includes('aria-label="修改记录"'),
  `标题 ${editHtml.includes('>修改记录</span>')} / aria-label ${editHtml.includes('aria-label="修改记录"')}`
)
check(
  '**编辑态没有 `aria-label="记录一餐"`**(旧名不许回来)',
  !editHtml.includes('aria-label="记录一餐"'),
  '锚点是上面那条:新名字在'
)

// ② 删除键:只在编辑态,而且**文字说清删的是什么**
check('编辑态有「删除这一餐」', editHtml.includes('删除这一餐'))
check(
  '**创建态没有删除键**,标题仍是「记录一餐」',
  !createHtml.includes('删除这一餐') &&
    createHtml.includes('>记录一餐</span>') &&
    createHtml.includes('aria-label="记录一餐"'),
  `创建态标题在 ${createHtml.includes('>记录一餐</span>')}`
)

// ③ 副标题:说清在改哪一天的那一餐(日期本身改不了)
const expectedDay = dateMod.formatRelativeDay(EDIT_DATE)
check(
  '**编辑态那条副标题写着那一天的日期和时间**',
  editHtml.includes(expectedDay) && editHtml.includes('12:30'),
  `${expectedDay} 12:30`
)
check(
  '**它写的不是「今天」** —— 从几天前那一屏点进来的人不该被误导',
  !editHtml.includes('今天 12:30') && expectedDay !== '今天',
  `expectedDay=${expectedDay}`
)
check('创建态没有这条副标题(它没有"哪一天"可说)', !createHtml.includes(expectedDay))

// ④ 预填:那几道菜、那个分量,就是这一条现在的内容
check(
  '编辑态预填了这一条的菜品和分量',
  editHtml.includes('>米饭</span>') && editHtml.includes('150g') && editHtml.includes('>青团</span>') && editHtml.includes('80g'),
  '已选 · 2 项'
)
// 步进器的读屏名是「减少米饭 分量」/「增加米饭 分量」(Stepper 自己拼的前缀)
check('编辑态的分量步进器在(所以分量真的能改)', editHtml.includes('aria-label="减少米饭 分量"'))

/*
  ⑤ 库外菜的营养不许在预填时被抹成 0。

  这一条挡的是「预填时把条目重建成 `{ foodId, name, grams }`」—— 那样
  `per100g` 就没了,`nutritionOfItem` 对它返回 0,而界面上只是那一行的数字
  变成 0 kcal,没有任何提示。创建路径已经为同一个坑写过一次注释
  (MealSheet 的 totalKcal 那段),这是它在编辑路径上的对应物。
*/
const webKcal = Math.round(nutritionMod.nutritionOfItem(WEB_ITEM).kcal)
/*
  ⚠️ 断言的是**那一格的完整渲染文本** `93 kcal · 联网估算`,不是 `93 kcal`。
  这不是洁癖,是这条断言**曾经假绿过**:面板下半截那份食物搜索结果列表里
  每一行都写着「分类 · N kcal/100g」,而库里恰好有一道 per100g.kcal = 93 的菜
  (白灼虾)—— 于是 `includes('93 kcal')` 被一个**跟这条记录毫无关系**的
  数字满足了,预填把 per100g 丢光了它照样绿。
  这是「弄坏它,看它红不红」那一步查出来的,不是想出来的。
*/
check(
  '**编辑态里库外菜那一行的完整文本是真的(不是 0,也不靠别处的数字蹭)**',
  webKcal > 0 && editHtml.includes(`${webKcal} kcal · 联网估算`),
  `期望「${webKcal} kcal · 联网估算」(0 就说明 per100g 在预填时丢了)`
)

// ⑥ 保存键的三种文案里,SSR 够得到的两种
check(
  '**编辑态没动过任何东西 → 「未做修改」且置灰**',
  editHtml.includes('未做修改') && editHtml.includes('pointer-events-none opacity-40'),
  '两种状态:改完分量的那一半只能手点(见本节开头那段注释)'
)
const webOnlyTotal = Math.round(nutritionMod.nutritionOfItem(WEB_ITEM).kcal)
const createWithWeb = renderSheet({ open: true, initial: [WEB_ITEM], onClose: () => {} })
check(
  '**创建态(等价于"有改动")→ 「保存 · 共 N kcal」**,N 含库外菜',
  createWithWeb.includes(`保存 · 共 ${webOnlyTotal} kcal`) && !createWithWeb.includes('未做修改'),
  `期望 保存 · 共 ${webOnlyTotal} kcal`
)
check(
  '空清单时保存键说的是「请先选择食物」而不是静默置灰',
  createHtml.includes('请先选择食物')
)

// ⑦ 预填这条路**只**归 `entry`,不许漏进创建态
check(
  '**创建态没有被编辑态那份清单污染**(没传 entry 时是空清单)',
  !createHtml.includes('已选 ·') && editHtml.includes('已选 · 2 项'),
  `创建态 ${createHtml.includes('已选 ·') ? '**出现了已选清单**' : '空'}`
)

/* ------------------------------------------------------------
   ⑧ 餐次选择器 —— 六个、两行、**恰好选中一个**

   餐次从四个变成六个之后,这一排按钮是新布局(`SegmentedControl` 的
   `columns={3}` 铺成两行三列,上面三餐、下面三顿加餐)。下面几条断的是
   「六个都摆出来了」「顺序是两行那个顺序」「格子真的铺了三列」。
   ------------------------------------------------------------ */
/*
  ⚠️ 期望的顺序**在这里写死**,不从 `SLOT_ROWS` 推 —— 第一版就是推的,而它
  **永远不会红**:把 `SLOT_ROWS` 改成时间顺序之后,面板照着新顺序渲染、
  期望值也跟着变,两边一起动,断言照样绿。这是弄坏测试查出来的,不是想出来的。
  (凡是「期望值和被测代码取自同一个常量」的断言都要先这么问一遍。)

  写死的这一串不是「数据的快照」,它**就是那个设计决定本身**:上面三餐、
  下面三顿加餐(用户选的那一项)。哪天要改布局,改的就是这一行 —— 那正是
  应该被拦住的地方。

  「六个都摆出来了」那一条反过来用 `MEAL_SLOTS`(取值范围)当期望,不是
  `SLOT_ROWS`:要证的正是「面板上能点到的东西 == 能存进 `slot` 的东西」。
*/
const PICKER_ORDER = ['早餐', '午餐', '晚餐', '上午加餐', '下午加餐', '夜宵']
const idxOf = (html, s) => html.indexOf(`>${s}</button>`)
const orderInHtml = PICKER_ORDER.map((s) => idxOf(editHtml, s))
check(
  '六个餐次都摆在面板上(一个都不能少 —— 少了那一档就选不出来)',
  orderInHtml.every((i) => i > 0) && PICKER_ORDER.length === MEAL_SLOTS_FLAT.length,
  PICKER_ORDER.map((s, i) => `${s}${orderInHtml[i] > 0 ? '' : '**缺**'}`).join(' ')
)
check(
  '**顺序是「先三餐、后加餐」**(按时间排会变成一张时刻表,那是另一回事)',
  orderInHtml.every((v, i) => i === 0 || v > orderInHtml[i - 1]),
  orderInHtml.join(' < ')
)
check(
  '两行是真的铺了三列(不铺就是六个挤在一行,「上午加餐」会溢出)',
  editHtml.includes('grid-template-columns:repeat(3, minmax(0, 1fr))'),
  'columns={3} → grid-template-columns'
)

/*
  ⚠️ **恰好一个选中** —— 这条比它看起来重要:`radiogroup` 的选中态是
  `value` 撞上 `options` 里的某一项。传进来的 `slot` 要是**不在那六个里**
  (比如一条 v7 的老记录带着已经删掉的「加餐」),那么**一个都不会选中**:
  六个按钮全是灰的,而面板照样能打开、菜照样在、保存键照样可点。界面上
  只是「看不出这是哪一餐」,没有任何提示。零个选中和两个选中都是错的。
*/
const slotCheckedCount = (html) => (html.match(/aria-checked="true"/g) ?? []).length
const slotCheckedLabel = (html) => /<button[^>]*aria-checked="true"[^>]*>([^<]*)<\/button>/.exec(html)?.[1] ?? '(没有选中的)'
check(
  '**编辑态恰好一个按钮是选中的,而且就是那一条的餐次**',
  slotCheckedCount(editHtml) === 1 && slotCheckedLabel(editHtml) === EDIT_ENTRY.slot,
  `选中 ${slotCheckedCount(editHtml)} 个:${slotCheckedLabel(editHtml)}（记录是 ${EDIT_ENTRY.slot}）`
)
/*
  创建态断「选中的是六个之一」而**不**断「等于 currentSlot()」:那个值取自
  `new Date()`,而这条断言自己也调一次 `new Date()` —— 正好跨过整点时两次会
  差一个小时,变成一条一年红一次的假红。`currentSlot` 本身在第 1.1 节里用
  固定日期断过了(那边没有这个不确定性)。
*/
check(
  '创建态也恰好一个选中,而且是六个餐次之一(默认值不会落在表外)',
  slotCheckedCount(createHtml) === 1 && PICKER_ORDER.includes(slotCheckedLabel(createHtml)),
  `选中 ${slotCheckedLabel(createHtml)}`
)

/* ============================================================
   拍餐盘面板:选完图**先看一眼**再分析
   ------------------------------------------------------------
   这是这次改动的主语 —— 原来选到文件的那一刻 `startPlateJob()` 就跑了、
   `navigate('/analyzing')` 就跳了,中间没有任何停顿。现在面板自己多了一个
   状态:选好之后原地变成「这张可以吗？」+ 那张照片 + 〔开始分析〕〔重选〕。

   面板是 `open` / `picked` 两个 prop 驱动的独立组件,所以这两个状态在 SSR 里
   **都够得到** —— 同一个手法在 SpeechSheet 和 MealSheet 编辑态上用过了
   (见那两节开头的注释)。

   ⚠️ 每一条都必须传 `open: true`:组件在 `open=false` 时直接 `return null`,
   不传就是拿一条空串去 `includes`,下面每一条都会**假绿**。
   ============================================================ */

console.log('\n=== 拍餐盘面板:选完图先看一眼 ===')

const actionSheetMod = await server.ssrLoadModule('/src/components/ActionSheet.tsx')
const renderPanel = (props) =>
  renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(actionSheetMod.ActionSheet, props))
  )

const noop = () => {}
const BASE = { open: true, onClose: noop, onCamera: noop, onAlbum: noop, onManual: noop }
/** 三行来源 —— 只在**没选图**那一态里出现 */
const SOURCE_ROWS = ['拍照', '从相册选择', '手动记录']

const sourceHtml = renderPanel(BASE)
const PREVIEW_URL = 'blob:http://localhost:5173/9f1c-preview'
const PREVIEW_URLS = [
  'blob:http://localhost:5173/9f1c-a',
  'blob:http://localhost:5173/9f1c-b',
  'blob:http://localhost:5173/9f1c-c',
]
/** 预览态那一组 props。**`photos` 和 `onRemove` 必须一起给** —— 见 ActionSheet 的 `picked` */
const picked = (urls, extra = {}) => ({
  ...BASE,
  picked: { photos: urls.map((url) => ({ url })), onRemove: noop, onAdd: noop, ...extra },
  onAnalyze: noop,
})
const previewHtml = renderPanel(picked([PREVIEW_URL]))
const threeHtml = renderPanel(picked(PREVIEW_URLS))

/** 「移除这张照片」那颗角标的个数 —— 每张一个,一个不多一个不少 */
const removeCount = (html) => (html.match(/aria-label="移除这张照片"/g) ?? []).length
/** 末尾那格「＋」的个数 */
const addCount = (html) => (html.match(/aria-label="再添加一张"/g) ?? []).length

check('面板确实渲染出来了(下面每一条的前提)', sourceHtml.length > 300, `${sourceHtml.length} 字符`)

check(
  '没选图时是那三行来源(下面「都不在」那两条的锚点)',
  SOURCE_ROWS.every((t) => sourceHtml.includes(t)) && !sourceHtml.includes('开始分析'),
  SOURCE_ROWS.map((t) => `${t}${sourceHtml.includes(t) ? '' : '**缺**'}`).join(' ')
)

check(
  '**选完图之后换成了预览**:「开始分析」在、三行来源一个都不在',
  previewHtml.includes('开始分析') && SOURCE_ROWS.every((t) => !previewHtml.includes(t)),
  `开始分析 ${previewHtml.includes('开始分析')} / 混进来的来源行 ${
    SOURCE_ROWS.filter((t) => previewHtml.includes(t)).join('、') || '(没有)'
  }`
)
check('一张时说的是「这张可以吗？」', previewHtml.includes('这张可以吗'), '单张那条路的老文案')

/*
  ⚠️ **「＋」那格是这次改动的全部内容**:选完一张之后还得能再补一张。
  它和 ✕ 一样要**数个数**而不是 `includes` —— 三张四格、或者压根没画,
  在 `includes` 下都是绿的,而用户看到的分别是「多出个莫名其妙的格子」和
  「选完一张就只能重头再来」(就是改之前那一版)。
  没选图那一屏**不许有**它:那是「头一回选」,没有「再」可以加。
*/
check(
  '**选完图之后缩略图末尾有一格「＋」**(没有它就只能一张张删了重来)',
  addCount(previewHtml) === 1 && addCount(threeHtml) === 1 && addCount(sourceHtml) === 0,
  `一张 ${addCount(previewHtml)} 格 / 三张 ${addCount(threeHtml)} 格 / 没选图 ${addCount(sourceHtml)} 格`
)
check(
  '**「＋」跟在最后一张后面**(不是插在最前面)',
  previewHtml.indexOf(`<img src="${PREVIEW_URL}"`) < previewHtml.indexOf('再添加一张'),
  '那一格是「接在后面」的入口,画到前面会读成「换掉第一张」'
)
/*
  ⚠️ 那格「＋」**顶掉**了原来那颗〔重选〕,所以这一屏上不许再有「重选」——
  两颗按钮去的是同一个地方(三行来源),差别只在清不清空,而它们长得一样。
  点错的代价是「想补一张,结果把已经选好的三张全清了」。
*/
check(
  '**预览态没有「重选」那颗按钮**(它和「＋」去同一个地方,却会清空)',
  !previewHtml.includes('重选'),
  previewHtml.includes('重选') ? '「重选」回来了' : '退出口只有「＋」和每张上那颗 ✕'
)

/*
  ⚠️ 三条一组的核心。一张和几张**必须说不一样的话** —— 「这张可以吗?」在选了
  3 张时读起来像只认了第一张,而用户此刻最想确认的恰恰是「3 张都进来了没有」。
  反过来(单张时说「选好了 1 张」)也算错,所以两条分开断言,不是一条 includes。
*/
check(
  '**三张时那句话换成了张数**,而单张那句**不在了**',
  threeHtml.includes('选好了 3 张，可以吗？') && !threeHtml.includes('这张可以吗'),
  `有张数 ${threeHtml.includes('选好了 3 张')} / 混进单张那句 ${threeHtml.includes('这张可以吗')}`
)

/*
  ⚠️ 这一组挡的是「预览态渲染了,但 `<img>` 的 `src` 忘了传」—— 那种错在界面
  上就是**一块空白**,而上面每一条断言照样全绿(按钮都在、文案都在)。
  比对的是完整的 `src="..."`,不是 `includes(url)`:后者被一段注释或一个
  `alt` 里的同名串满足也算过。
*/
check(
  '**那张图真的进了 `<img src>`**(不是渲染了个空框)',
  previewHtml.includes(`<img src="${PREVIEW_URL}"`),
  previewHtml.match(/<img[^>]*>/)?.[0]?.slice(0, 80) ?? '(一个 img 都没有)'
)
check(
  '**三张的 `src` 一个不少**(不是只画了第一张)',
  PREVIEW_URLS.every((u) => threeHtml.includes(`<img src="${u}"`)),
  PREVIEW_URLS.map((u) => `${u.slice(-1)}${threeHtml.includes(`<img src="${u}"`) ? '' : '**缺**'}`).join(' ')
)

/*
  用户定的那一句:「一排缩略图,**每张能单独删**」。只数「至少有 ✕」是不够的
  —— 三张共用一个 ✕(或者只有第一张有)在 `includes` 下同样绿,而那时候用户
  点第二张上的 ✕ 会发现它根本不存在。所以数**个数**。
*/
check(
  '**每张各有一颗「移除这张照片」**(不是一张 ✕ 管三张)',
  removeCount(threeHtml) === 3 && removeCount(sourceHtml) === 0,
  `三张时 ${removeCount(threeHtml)} 颗 / 没选图时 ${removeCount(sourceHtml)} 颗`
)

/*
  「一次最多 3 张,这次没收 2 张」那行小字。**不传就不许出现** —— 无条件挂一行
  空的副标题会占掉面板高度,而多选 3 张(收得下)是常态。
*/
const NOTE = '一次最多 3 张，这次没收 2 张。'
const notedHtml = renderPanel(picked(PREVIEW_URLS, { note: NOTE }))
check(
  '**`note` 传了就得画出来**(它是「有图被没收」时唯一说出来的一句话)',
  notedHtml.includes(NOTE),
  `「${NOTE}」在产物里 ${notedHtml.includes(NOTE)}`
)

/*
  ⚠️ 「删到一张不剩」是个**合法的中间状态**:用户点了三张,一张张点掉。这时候
  该退回三行来源 —— 而不是摆一条空白的附件条加一颗「开始分析」(点下去
  `startPlateJob([])` 什么都发不出去)。
  这条同时是上面「有图才算选好」那个判据的证明:`photos: []` 和 `picked: null`
  必须走出同一个界面。
*/
check(
  '**删到一张不剩时退回三行来源**(不是一条空附件条 + 一颗「开始分析」)',
  (() => {
    const empty = renderPanel(picked([]))
    return empty === sourceHtml
  })(),
  '`photos: []` 与不传 `picked` 必须一模一样'
)

/* ------------------------------------------------------------
   「再加一张」那一屏 —— 点「＋」之后落到哪儿
   ------------------------------------------------------------
   上面那几条只证明了**入口画出来了**。这一节证的是**点下去之后那一屏**
   长什么样,而它最容易坏的地方不是崩,是「看着挺对」:

     · 三行来源只写了一遍(两屏共用),所以真正会漏的是**标题没换** ——
       用户点「＋」进来,顶上还写着「拍摄餐盘,开始量化分析」,于是
       「我刚才选的那两张还在吗」只能靠猜。
     · **已经选好的那几张必须还画着。** 这一屏上每个决定(拍照 / 相册 /
       手动记录)都作用在「已有的那几张」之上,不画就等于让用户闭着眼睛选。
   */
console.log('\n=== 面板:点「＋」之后的「再加一张」 ===')

const addingHtml = renderPanel(picked(PREVIEW_URLS, { adding: true }))
const addingOneHtml = renderPanel(picked([PREVIEW_URL], { adding: true }))

check(
  '「再加一张」那一屏渲染出来了(下面几条的锚点)',
  addingOneHtml.length > 300 && addingOneHtml.includes('再加一张'),
  `${addingOneHtml.length} 字符`
)
/*
  ⚠️ 比对的是**整句**『拍摄餐盘，开始量化分析』,不是『拍摄餐盘』那四个字 ——
  后者是面板根节点上的 `aria-label="拍摄餐盘"`,每一屏都有,拿它当判据的话
  这条断言**永远红**(或者更糟:反过来写成 includes 就永远绿)。
*/
const FIRST_CAPTION = '拍摄餐盘，开始量化分析'
check(
  '**那一屏的标题换成了「再加一张」**,而头一回选那句**不在了**',
  addingOneHtml.includes('再加一张') && !addingOneHtml.includes(FIRST_CAPTION),
  `「再加一张」${addingOneHtml.includes('再加一张')} / 混进第一回那句 ${addingOneHtml.includes(FIRST_CAPTION)}`
)
check(
  '**那一屏的三行来源都在**(「＋」的全部意义就是回这里再选一次)',
  SOURCE_ROWS.every((t) => addingOneHtml.includes(t)),
  SOURCE_ROWS.map((t) => `${t}${addingOneHtml.includes(t) ? '' : '**缺**'}`).join(' ')
)
check(
  '**已经选好的那几张还画在那一屏上**(不画的话,这屏上每个决定都是盲的)',
  PREVIEW_URLS.every((u) => addingHtml.includes(`<img src="${u}"`)),
  PREVIEW_URLS.map((u) => `${u.slice(-1)}${addingHtml.includes(`<img src="${u}"`) ? '' : '**缺**'}`).join(' ')
)
check(
  '**那一屏没有「＋」那格**(我们要去的就是这里,再摆一格是空的)',
  addCount(addingHtml) === 0 && !addingHtml.includes('开始分析'),
  `「＋」${addCount(addingHtml)} 格 / 开始分析 ${addingHtml.includes('开始分析')}`
)
/*
  ⚠️ 「在『再加一张』那一屏上把最后一张删掉」是个**合法且很容易发生**的状态
  (点进去了才发现那张是拍糊的)。这时候该退回普通来源列表 —— 已经没有什么
  可「再加」的了。判据挂在 `chosen` 上而不是 `adding` 上,这条就是它的证明。
*/
check(
  '**在「再加一张」那一屏删到一张不剩时,退回普通来源列表**(不能顶着一句「再加一张」而没有可加的东西)',
  renderPanel(picked([], { adding: true })) === sourceHtml,
  '`adding: true` 也救不了一张图都没有这件事'
)

/*
  预览态**不绕过 `open`**。这条看着多余,其实是这一节最容易写错的地方:
  分支写成 `if (picked) return <预览>` 的话,面板关着的时候预览态会浮在首页上
  —— 而 `open=false` 那条路平时没人看(它在首页默认那一屏里,而默认那一屏
  恰好是走查最容易跳过的一屏)。
*/
check(
  '**关着的时候什么都没渲染,即便 `picked` 有图**',
  renderPanel({ ...picked(PREVIEW_URLS), open: false }) === '',
  '预览分支不许绕过 open'
)

/*
  锚点:「拍餐盘」在。没有它,下面每一条在首页整个白屏时也照样绿。
  首页默认那一屏(面板关着)不该出现「开始分析」—— 它是**点开面板、选完图
  之后**才存在的东西。
*/
const homeNowHtml = renderPage(home.default, '/')
check('首页默认那一屏渲染出来了(下面几条的锚点)', homeNowHtml.includes('拍餐盘'), `${(homeNowHtml.length / 1024).toFixed(1)} KB`)
check(
  '**首页默认态不出现「开始分析」**(它是选完图之后才有的)',
  !homeNowHtml.includes('开始分析') && !homeNowHtml.includes('这张可以吗'),
  '面板默认是关着的'
)

/* ------------------------------------------------------------
   源级不变量:任务的发起点在「开始分析」里,不在选图回调里
   ------------------------------------------------------------
   上面那两条渲染断言**挡不住这次改动的主语**。面板关着的时候,
   `usePhotoPicker` 的回调里写没写 `startPlateJob()` 在渲染产物上一个字都
   看不出来 —— 而那正是原来那个 bug:选到文件的那一刻任务就跑了、页就跳了,
   「先看一眼」这一步根本不存在。

   所以这一节扫源码,两条一起才构成完整的判据:

     · picker 回调里**不许**有 startPlateJob / navigate  ← 「不立马」
     · onAnalyze 里**必须**两样都有                     ← 「要等确认」,
                                                            而且确认之后真的走

   只验前一条的话,把「开始分析」写成一个什么都不做的装饰按钮照样全绿。

   ⚠️ 两处都靠「从某个标记扫到下一个固定缩进的收尾行」取切片,对格式敏感,
   所以各自配一条**锚点**(切片里有该有的东西)。取歪了锚点先红,不会变成
   一条静默为真的空断言。注释先剥掉 —— 解释里就写着这两个词。
   ------------------------------------------------------------ */
const homeSrc = stripComments(await readFile('src/screens/HomeScreen.tsx', 'utf8'))
const sliceAt = (src, start, end) => {
  const a = src.indexOf(start)
  const b = a === -1 ? -1 : src.indexOf(end, a)
  return a === -1 || b === -1 ? '' : src.slice(a, b)
}

const homePickSrc = sliceAt(homeSrc, 'useMultiPhotoPicker(', '\n  })')
const homeAnalyzeSrc = sliceAt(homeSrc, 'onAnalyze={', '\n        }')

check(
  '取到了首页那段 picker 回调(下面几条的锚点)',
  homePickSrc.startsWith('useMultiPhotoPicker(') && homePickSrc.includes('stage(staged, files)'),
  `${homePickSrc.length} 字符:${homePickSrc.replace(/\s+/g, ' ').slice(0, 90)}`
)
check(
  '**首页选到图之后不发起任务、也不跳页**(否则「先看一眼」这一步就没了)',
  homePickSrc.length > 0 && !homePickSrc.includes('startPlateJob(') && !homePickSrc.includes('navigate('),
  homePickSrc.includes('startPlateJob(') || homePickSrc.includes('navigate(')
    ? '回调里出现了 startPlateJob / navigate'
    : '回调只把草稿攒起来'
)
/*
  ⚠️ **这一条是「＋」那条路的地基。** 这个回调里原来有一句
  `discardAll(staged)` —— 那是「重选」留下的清场,当时走到这儿的只有
  「刚打开面板、一张没选」这一种情况,先清一次是白清。

  现在不一样了:它同时是「＋再选一张」的落点,而那时候盒子里**有东西**。
  清一次的后果是「加一张 = 把前面两张吃掉」—— 屏上只是缩略图少了两张,
  没有任何提示,而且**每一屏看上去都对**(总张数有限,少一张不显眼)。
  渲染断言一条都够不到它:那是点下去之后才发生的事。
*/
check(
  '**选图回调里没有 `discardAll`**(有的话「＋」再选一张会把已经选好的顶掉)',
  homePickSrc.length > 0 && !homePickSrc.includes('discardAll('),
  homePickSrc.includes('discardAll(') ? '回调里出现了 discardAll' : '回调只往盒子里加'
)

/*
  「多选」这件事有**两层**,两层都要钉住,因为它们坏掉的后果一模一样、
  而彼此看不出来:

    · 源码这一层 —— 首页调的是哪个 hook(`useMultiPhotoPicker` 还是
      `usePhotoPicker`)。上面那条锚点的 `startsWith` 已经算住了。
    · DOM 这一层 —— 相册那个 input 上有没有 `multiple`。hook 名字对了、
      而 `useFilePicker(onPicked, false)` 那个布尔写反,相册照样只让选一张。
      见下面那条渲染断言。

  下面这条盯的是「没收的那几张说出来了」:`stage` 的返回值被丢掉的话,
  用户选了 5 张、屏上出现 3 张,而没有任何一处告诉他少了 2 张。
*/
check(
  '**没收进来的张数被接住了**(丢了它 = 选了 5 张只进 3 张,而一个字都不说)',
  homePickSrc.includes('setDropped(') && homeSrc.includes('overflowNote(dropped)'),
  `接住 ${homePickSrc.includes('setDropped(')} / 说出来 ${homeSrc.includes('overflowNote(dropped)')}`
)
/*
  ⚠️ 和上面那条是**两件事**:接住了是「有没有丢」,这条是「该不该说」。
  判据松成 `dropped >= 0` 的话,收了 3 张(一张没丢)也会挂上一句
  「这次没收 0 张」—— 一句凭空冒出来的坏消息,而渲染断言那边一个字都看不出来
  (它只会正常画出传进去的那句话)。
*/
check(
  '**没收了才说**(`dropped >= 0` 会让「一张没丢」也挂上一句坏消息)',
  homeSrc.includes('...(dropped > 0 ? { note: overflowNote(dropped) } : {}),'),
  homeSrc.includes('dropped >= 0') ? '判据松成了 >= 0' : '判据是 > 0'
)
/*
  ⚠️ **「首页也支持多选」这件事落到 DOM 上只有一个属性**:相册那个 input 带不带
  `multiple`。不带的话,相册里选 5 张只进来 1 张 —— 而屏幕上没有任何异常,
  用户只会觉得「我明明选了 5 张」。

  两个 input 里**恰好一个**带 `multiple`,而且必须**不是**带 `capture` 的那个:
  `capture` 那条是相机入口,一次快门就是一张,给它加 `multiple` 是句空话
  (见 PhotoPicker.tsx 的 @param)。数个数而不是 `includes('multiple')`,
  就是为了挡住「两个都加上了」这种看起来更整齐的写法。
*/
const fileInputs = homeNowHtml.match(/<input[^>]*type="file"[^>]*>/g) ?? []
const multiInputs = fileInputs.filter((t) => /\bmultiple\b/.test(t))
check(
  '**相册那个 input 带着 `multiple`**(不带的话相册里选 5 张只进来 1 张)',
  fileInputs.length === 2 &&
    multiInputs.length === 1 &&
    !/capture=/.test(multiInputs[0] ?? '') &&
    /capture=/.test(fileInputs.find((t) => !/\bmultiple\b/.test(t)) ?? ''),
  `${fileInputs.length} 个 file input,其中 ${multiInputs.length} 个带 multiple`
)
/*
  「每张能单独删」在源码这一侧的落点:面板上那颗 ✕ 必须接到
  `composer.unstage` —— 它才是撤 object URL 的那一个。自己写
  `staged.photos.splice(...)` 的话图删掉了,而那个几 MB 的 blob 一直到刷新
  页面才释放(没有任何断言看得见)。
*/
check(
  '**面板上的「删一张」接到了 `unstage`**(自己 splice 会漏掉那个 object URL)',
  homeSrc.includes('unstage(staged, url)'),
  '谁建的谁撤,那条规矩在 composer.ts 里'
)

/* ------------------------------------------------------------
   「＋」那条链:一格按钮,三处必须合作
   ------------------------------------------------------------
   那格「＋」本身在 AttachmentStrip 里,首页这边只有三段代码,而三段**缺一段
   都还是能跑**:

     · `picked.onAdd` —— 没有它,缩略图末尾那格根本不画(渲染断言看得见,
       但看不出它接去了哪儿)。
     · `onAdd` 的**内容** —— 必须是「回来源列表」,而且**不许 dropDraft**。
       它和「重选」在屏上一模一样,差别全在这一行里。
     · 「取消」的分支 —— 停在「再加一张」时取消要**回上一屏**。直接
       `dropDraft()` 的话,点进去又反悔 = 已经选好的全没了。

   取切片靠固定的下一行,对格式敏感,所以先各配一条锚点。
   ------------------------------------------------------------ */
const homePickedSrc = sliceAt(homeSrc, 'picked={{', '\n        }}')
const homeCloseSrc = sliceAt(homeSrc, 'onClose={() =>', '\n        }}')

check(
  '取到了面板那组 `picked`(下面两条的锚点)',
  homePickedSrc.startsWith('picked={{') && homePickedSrc.includes('onAdd:'),
  `${homePickedSrc.length} 字符:${homePickedSrc.replace(/\s+/g, ' ').slice(0, 90)}`
)
check(
  '**`onAdd` 里没有 `dropDraft()`**(那就是「再加一张」和「重选」全部的差别)',
  !homePickedSrc.includes('dropDraft'),
  homePickedSrc.includes('dropDraft') ? '「＋」顺手把草稿清了' : '只把面板拨到那一屏'
)
/*
  ⚠️ 满了(3 张)还画着那格「＋」的话,用户点进去、选一张、回来只会看到
  「这次没收 1 张」—— 白走一趟。判据要用 `MAX_PHOTOS_PER_SEND`,不许在这里
  重写一个 3:「一次几张」归 composer.ts,两处各写一遍早晚会对不上。
*/
check(
  '**还有余量时才画那格「＋」**,而且判据用的是 `MAX_PHOTOS_PER_SEND`',
  homePickedSrc.includes('MAX_PHOTOS_PER_SEND') && homePickedSrc.includes('staged.photos.length <'),
  homePickedSrc.includes('MAX_PHOTOS_PER_SEND') ? '上限取自 composer' : '这里自己写死了个数'
)
check(
  '取到了「取消」那个处理函数(下面一条的锚点)',
  homeCloseSrc.startsWith('onClose={() =>') && homeCloseSrc.includes('dropDraft()'),
  `${homeCloseSrc.length} 字符:${homeCloseSrc.replace(/\s+/g, ' ').slice(0, 90)}`
)
check(
  '**「再加一张」那一屏上点「取消」是回上一屏,不是把草稿清掉**',
  homeCloseSrc.includes('setAdding(false)') &&
    homeCloseSrc.indexOf('setAdding(false)') < homeCloseSrc.indexOf('dropDraft()'),
  '判分支必须排在 dropDraft 前面 —— 否则那几张已经没了,再回上一屏也是空的'
)

check(
  '取到了「开始分析」那个处理函数(下面几条的锚点)',
  homeAnalyzeSrc.startsWith('onAnalyze={') && homeAnalyzeSrc.includes('dropDraft()'),
  `${homeAnalyzeSrc.length} 字符:${homeAnalyzeSrc.replace(/\s+/g, ' ').slice(0, 90)}`
)
check(
  '**「开始分析」真的发起了任务并跳转**(不然它就是一颗装饰按钮)',
  homeAnalyzeSrc.includes('startPlateJob(') && homeAnalyzeSrc.includes("navigate('/analyzing')"),
  `startPlateJob ${homeAnalyzeSrc.includes('startPlateJob(')} / navigate ${homeAnalyzeSrc.includes("navigate('/analyzing')")}`
)
check(
  '**「开始分析」也走了 dropDraft**(不然那张预览的 object URL 就漏在这儿了)',
  homeAnalyzeSrc.includes('dropDraft()'),
  '三个撤销出口里的一个(开始分析 / 关面板 / 手动记录)'
)

/* ============================================================
   那行「依据 · …」—— 它有没有真的画到屏幕上
   ------------------------------------------------------------
   逻辑层由 `verify-loop` 那一节管(每一处 basis 是不是 `quotaBasis` 出来的)。
   这一节管的是**它有没有接到界面上** —— 这个仓库吃过这个亏:字段在中间层
   丢了,逻辑测试全绿,而屏幕上什么都不会发生(见下面那张幽灵条目警告卡的
   注释,同一笔账)。

   三处各有各的坑,所以三处分开断:
     · 首页那句话的 basis 是**可有可无**的(「比昨日同期…」那种日子没有),
       所以既要断「有的时候画出来了」,也要断「没有的时候一个字都不多」。
     · 日记页那张警示卡同理。
     · 对话气泡那行小字是**从正文里摘出来的**,所以最要紧的一条是
       「正文里不许再出现一遍」—— 摘不干净就会印两遍。

   ⚠️ 这一节**放在文件最后**,因为它要动 store 里的记录。前面的断言大多
   搭在当前那份状态上,插在中间会把它们改成另一回事。
   ============================================================ */

console.log('\n=== 「依据」有没有画到屏幕上 ===')

/* ---------- ① 首页黑卡底部那句 ---------- */

// 一餐把钠顶到上限之上(上限调到 1mg 是最省事的做法,不用去查食物库哪个菜咸)
store.clearAllMeals()
store.updateProfile({ chronicConditions: ['高血压'], quotaOverrides: {}, specialStages: [] })
store.updateProfile({ quotaOverrides: { sodium: 1 } })
store.addMeal({ slot: '午餐', items: RICE, source: '手动记录' })

const basisHomeHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/'] }, React.createElement(home.default))
)
check(
  '取到了首页那一屏(下面几条的锚点:那句话本身在)',
  basisHomeHtml.includes('今日钠已超上限'),
  '钠上限调到 1mg,这一餐必定超'
)
check(
  '**首页那句话下面真的画了「依据 · …」**(字段在 derive 里有了,但没接到界面上)',
  basisHomeHtml.includes('依据 · 你手动设的 → 钠上限 1mg'),
  basisHomeHtml.match(/依据 · [^<]*/)?.[0] ?? '(没有)'
)

/*
  反面:那句话**不提上限**时,依据行一个字都不该有。
  只断正面的话,「无条件画一行」照样绿 —— 而那一行会写着「依据 · …」,
  解释一句它根本没说过的话。
*/
store.updateProfile({ quotaOverrides: { sodium: 999999 } })
const noBasisHomeHtml = renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: ['/'] }, React.createElement(home.default))
)
check(
  '锚点:换了一份档案之后那句话确实不提上限了',
  !noBasisHomeHtml.includes('今日钠已超上限') && noBasisHomeHtml.includes('午餐已记录'),
  noBasisHomeHtml.match(/午餐已记录[^<]*/)?.[0] ?? ''
)
check(
  '**不提上限时首页一个字依据都不画**(不是无条件挂一行)',
  !noBasisHomeHtml.includes('依据 ·'),
  noBasisHomeHtml.includes('依据 ·') ? noBasisHomeHtml.match(/依据 · [^<]*/)?.[0] : '干净'
)

/* ---------- ② 结果页那四条建议 ---------- */

/*
  一盘卤牛肉（200g）同时踩中三条建议，而它们**恰好一半有一半没有**依据：

    · 钠 1400mg 占上限 93%  → danger，带依据
    · 蛋白质 56g 占目标 86% → brand，带依据
    · 一盘肉类没有蔬菜      → warn，**没有**依据（它引的是指南，正文里已经
                              指名道姓写了「《中国居民膳食指南 2022》」）

  所以这一屏既断「该有的画出来了」，也断「不该有的那一张没被顺手补一句」——
  只断前者的话，「给每条都挂一句依据」照样绿。
*/
store.updateProfile({ chronicConditions: ['高血压'], quotaOverrides: {} })
recognize.setPending({
  slot: '午餐',
  items: [{ foodId: 'braised-beef', name: '卤牛肉', grams: 200 }],
  engine: 'agent',
  agentReply: notBlocked,
})
const basisResultHtml = renderResult()

check(
  '取到了结果页那一屏（锚点：三条建议都在）',
  basisResultHtml.includes('占全天上限') &&
    basisResultHtml.includes('蛋白质') &&
    basisResultHtml.includes('中国居民膳食指南 2022'),
  '钠 / 蛋白质 / 蔬菜 三条'
)
/*
  这一屏上三条建议**落位各不相同**,正是合并之后要区分的那三种:
  钠那条指名了「卤牛肉」→ 挂在这一行下面;蛋白质那条是整餐级的 → 卡尾;
  蔬菜那条整餐级、而且**没有角标**。
*/
const basisBadges = BASIS_BADGES(basisResultHtml)
check(
  '(锚点) 取到了那两个角标',
  basisBadges.length === 2,
  `${basisBadges.length} 个:${basisBadges.map((b) => b.text).join(' / ') || '无'}`
)
check(
  '**钠那条的角标说的是档案里那条高血压**(不再是「依据 · 高血压 → 钠上限 1500mg」)',
  basisBadges.some((b) => b.text === '高血压'),
  basisBadges.map((b) => b.text).join(' / ') || '一个角标都没有'
)
/*
  值那一半(「钠上限 1500mg」)是这一版从屏幕上**撤掉**的 —— 用户明确接受
  「1500mg」从结果页消失(代价记在 `advice.ts` 文件头)。
  这条挡的是「顺手把那个数加回角标里」:加回去角标就不再是「一眼看出根据什么」,
  而是一句小字引文。
*/
check(
  '**「依据 · 」在全屏出现 0 次,角标里也没有那个数**(白底引文块撤干净了)',
  (basisResultHtml.match(/依据 · /g) ?? []).length === 0 && !basisResultHtml.includes('1500mg'),
  `依据 · ${(basisResultHtml.match(/依据 · /g) ?? []).length} 处 / 1500mg ${basisResultHtml.includes('1500mg') ? '还在' : '不在'}`
)
/*
  蔬菜那条**没有**角标 —— 它引的是指南、和你是谁无关，正文里已经指名道姓写了
  「《中国居民膳食指南 2022》」。给它顺手补一句正是 `advice.ts` 文件头明令
  禁止的「硬凑权威感」,所以这条要用**非空锚点**钉住:一共只有两个角标(三条
  建议里钠和蛋白质那两条才有),而且没有一个是「膳食指南」。
*/
check(
  '**蔬菜那条没有角标**(它说的是指南,和你是谁无关)',
  basisBadges.length === 2 && !basisBadges.some((b) => b.text === '膳食指南'),
  `一共 ${basisBadges.length} 个角标:${basisBadges.map((b) => b.text).join(' / ') || '无'}`
)
/*
  「依据」是**每条建议自己右上角的一个小胶囊**。
  ------------------------------------------------------------
  第一版是一行「11px + 正文那一档颜色」的小字(读起来就是正文的最后一行),
  第二版是一块通栏白底引文块,这一版才是角标 —— 用户的原话是「这个高血压可以
  做个角标放右上角,让人一眼就能看出这是根据高血压来给的建议」。
  所以这里断的是**形状**:白底(`bg-card`)、**描边**(`-line`)、那一档 tone 的
  **强色**(`-text`,不是正文那档 `-body`);而且是个**胶囊**(`rounded-full` +
  `shrink-0`,标题折行时它留在右上角),**不是通栏**(不许有 `self-stretch`)。

  ⚠️ 断 class 而不是断「那行字在不在」—— 只断字的话,把它塞回通栏白底里照样绿,
  字还印着,只是不再是角标了。
*/
check(
  '**角标是个胶囊:白底 + 描边 + 那一档 tone 的强色**(不是通栏,也不是正文那档色)',
  basisBadges.length > 0 &&
    basisBadges.every(
      (b) =>
        b.cls.includes('bg-card') &&
        b.cls.includes('-line') &&
        b.cls.includes('-text') &&
        !b.cls.includes('-body') &&
        b.cls.includes('font-medium') &&
        b.cls.includes('rounded-full') &&
        b.cls.includes('shrink-0') &&
        !b.cls.includes('self-stretch')
    ),
  basisBadges.map((b) => b.cls).join(' | ') || '一个角标都没有'
)
check(
  '两个角标各自跟着它那条建议的 tone（钠是 danger、蛋白质是 brand），不是写死的一种',
  new Set(basisBadges.map((b) => b.cls)).size === 2 &&
    basisBadges.some((b) => b.cls.includes('danger')) &&
    basisBadges.some((b) => b.cls.includes('brand')),
  basisBadges.map((b) => (b.cls.match(/text-(\w+)-text/) ?? [])[1]).join(' / ')
)

/* ---------- ③ 日记页那张警示卡 ---------- */

/*
  警示卡是「连续 N 日超标」,要的是**已完成的几天**都超 —— 所以得往回记。
  上限调回 1mg:上一步为了验「不提上限」把它抬到了 999999,那个值下永远
  不会有警示,而这一条会以「没有警示卡」的样子红掉 —— 看起来像界面的问题。
*/
store.updateProfile({ quotaOverrides: { sodium: 1 } })
const warnDays = []
for (let i = 1; i <= 3; i++) {
  const d = new Date()
  d.setDate(d.getDate() - i)
  warnDays.push(d.toISOString().slice(0, 10))
}
for (const d of warnDays) store.addMeal({ slot: '午餐', date: d, items: RICE, source: '手动记录' })

const basisDiaryHtml = renderPage(diary.default, '/diary')
check(
  '取到了日记页那一屏(锚点:警示卡确实渲染出来了)',
  basisDiaryHtml.includes('连续') && basisDiaryHtml.includes('钠摄入超上限'),
  basisDiaryHtml.match(/连续 \d+ 日[^<]*/)?.[0] ?? '(没有警示卡)'
)
/*
  ⚠️ 判据里必须带上**那一档颜色**(`text-warn-body`)。第一版写的是
  `basisDiaryHtml.includes('依据 · 你手动设的 → 钠上限 1mg')` —— 而同一页顶上那张
  黑卡印的是**一模一样的一句话**(两处都取 `quotaBasis(profile,'sodium')`,
  屏幕上生效的又是同一个手改值)。于是把 `basis={w.basis}` 删掉,这一条照样绿:
  它读的是黑卡那一处。弄坏对照表里就是这么发现它的。
*/
check(
  '**警示卡上真的画了「依据 · …」**(判据钉在警示卡那一档颜色上)',
  basisDiaryHtml.includes('text-warn-body">依据 · 你手动设的 → 钠上限 1mg'),
  basisDiaryHtml.match(/依据 · [^<]*/)?.[0] ?? '(没有)'
)
/*
  这一页上有**两处**「依据 · 」,而且它们长在同一档字号上、说的是同一句话
  (两处都取 `quotaBasis(profile,'sodium')`) —— 所以「屏上有这行字」这种判据
  区分不开它们:**去掉黑卡那一处之后,上一行照样绿**。
  靠颜色分开:黑卡那处沿用 `text-white/60`(白卡上的小字档),警示卡那处是
  `text-warn-body`。两处各数一次,少哪一处都红。
*/
const darkBasisCount = (basisDiaryHtml.match(/text-white\/60">依据 · /g) ?? []).length
const warnBasisCount = (basisDiaryHtml.match(/text-warn-body">依据 · /g) ?? []).length
check(
  '**黑卡上那句趋势也带着依据**(这一页两处,黑卡一处、警示卡一处,各数一次)',
  darkBasisCount === 1 && warnBasisCount === 1,
  `黑卡 ${darkBasisCount} 处 / 警示卡 ${warnBasisCount} 处`
)
/*
  ⚠️ 同一页上另外**两张** Notice 卡（幽灵条目 / 联网营养丢失）**没有**依据，
  而且这是有意的：那两张说的是数据出了故障，和用户档案无关 —— 给它们凑一句
  「依据 · …」就是把一条数据故障说成一条饮食建议。

  这一条扫源码而不是渲染产物：那两张卡在正常情况下根本不出现（要有坏数据才
  画得出来），渲染产物上够不到。用上面那套 `sliceAt` 把两处切片取出来看。
*/
const diarySrcForBasis = stripComments(await readFile('src/screens/DiaryScreen.tsx', 'utf8'))
const ghostNoticeSrc = sliceAt(diarySrcForBasis, '{brokenRefs.length > 0 && (', '\n        )}')
const lostNoticeSrc = sliceAt(diarySrcForBasis, '{lostWebRefs.length > 0 && (', '\n        )}')
check(
  '取到了那两张数据故障卡的切片（下面一条的锚点）',
  ghostNoticeSrc.includes('brokenRefs') && lostNoticeSrc.includes('lostWebRefs'),
  `${ghostNoticeSrc.length} / ${lostNoticeSrc.length} 字符`
)
check(
  '**数据故障那两张卡不写依据**（它们和档案无关，凑一句就是把故障说成建议）',
  !ghostNoticeSrc.includes('basis') && !lostNoticeSrc.includes('basis'),
  [ghostNoticeSrc, lostNoticeSrc].some((s) => s.includes('basis')) ? '混进来了' : '两张都没有'
)
check(
  '**而警示卡那处必须写**（否则上一条可以靠「谁都不传」变绿）',
  diarySrcForBasis.includes('basis={w.basis}'),
  '判据是「只有该写的写了」，不是「都没写」'
)

/*
  趋势统计的**窗口跟着档位走**。
  ------------------------------------------------------------
  这里原来是写死的 `weekTrend(…, 7)`,而月视图那句话印的是「**近 30 天**日均钠
  … ↓ 5%，连续 3 日未超上限」—— 两个数都取自同一个 7 天窗口。副标题说 30 天、
  数字是 7 天的,而屏幕上没有任何不一致的痕迹。

  ⚠️ 这条只能扫源码:`range` 是组件里的 `useState`,`renderToStaticMarkup`
  够不到它 —— 渲染出来的永远是日视图那一档。所以断的是**判据的形状**
  (窗口取自 `RANGE_DAYS[range]`),而不是某一次渲染的结果。
*/
const diaryTrendSrc = sliceAt(diarySrcForBasis, 'const trend = useMemo(', 'const trendUnit')
check(
  '取到了 `trend` 那个 memo（下面几条的锚点）',
  diaryTrendSrc.includes('weekTrend('),
  `${diaryTrendSrc.length} 字符`
)
check(
  '**月视图的趋势窗口不是写死的 7 天**（否则「近 30 天」那半句话里的数是 7 天的）',
  diaryTrendSrc.includes('trendDays') && !/weekTrend\([^)]*,\s*7\s*\)/.test(diaryTrendSrc),
  diaryTrendSrc.includes('trendDays') ? '窗口取自 trendDays' : '还是写死的 7'
)
check(
  '而 `trendDays` 对周/月两档取自 `RANGE_DAYS`（不另写一份 7 / 30）',
  diarySrcForBasis.includes("range === 'day' ? 7 : RANGE_DAYS[range]"),
  '日视图仍然是 7 天：那一档的趋势句说的是「这一周」,不是「这一天」'
)
/*
  「这段窗口叫什么」只有一个来源。副标题原来写死「本周控盐趋势向好」,月视图下
  配着 30 天的数据说「本周」—— 窗口改成跟着档位走之后,那句必须同时跟着走。
*/
check(
  '**副标题和黑卡那句话共用同一个 `trendUnit`**（不然刚修好的谎会从黑卡挪到页头）',
  (diarySrcForBasis.match(/\$\{trendUnit\}/g) ?? []).length >= 1 &&
    !diarySrcForBasis.includes("'本周控盐趋势向好'"),
  `trendUnit 用了 ${(diarySrcForBasis.match(/trendUnit/g) ?? []).length} 处`
)

/* ---------- ④ 对话气泡里那行小字 ---------- */

/*
  `splitBasis` 是**纯函数**,但它住在 `.tsx` 里,而 `verify-loop` 一个 `.tsx`
  都不载(那一套不该因为某个组件写坏 JSX 就一起红)—— 所以它在这一节验。
*/
const { splitBasis } = chatTranscript

check(
  '没有依据时原样返回,正文一个字都不动',
  (() => {
    const r = splitBasis('今天钠摄入约 1200mg。')
    return r.body === '今天钠摄入约 1200mg。' && r.basis === null
  })()
)
check(
  '**缀在末尾的依据被摘出来,而且正文末尾那个空行也一起摘掉**',
  (() => {
    const r = splitBasis('正文第一段。\n\n正文第二段。\n\n依据 · 高血压 → 钠上限 1500mg')
    return r.body === '正文第一段。\n\n正文第二段。' && r.basis === '高血压 → 钠上限 1500mg'
  })(),
  JSON.stringify(splitBasis('正文第一段。\n\n正文第二段。\n\n依据 · 高血压 → 钠上限 1500mg'))
)
/*
  这两条是**判据的边界**,不是凑数:
  · 中间那句不是「最后一行」,摘它会把后半段正文一起吃进小字里。
  · 空依据说明生产者缀了个空壳,摘出来会在屏上留一行光秃秃的「依据 · 」。
*/
check(
  '**「依据 · 」出现在正文中间时不摘**(它后面还有换行 = 它不是结尾那行小字)',
  (() => {
    const r = splitBasis('依据 · 这是正文里的一句话\n\n后面还有正文。')
    return r.basis === null && r.body === '依据 · 这是正文里的一句话\n\n后面还有正文。'
  })()
)
check(
  '空依据不摘(否则屏上会留一行光秃秃的「依据 · 」)',
  (() => {
    const r = splitBasis('正文。\n\n依据 · ')
    return r.basis === null && r.body === '正文。\n\n依据 · '
  })()
)

const basisBubbleHtml = renderItems([
  { id: 'b1', role: 'assistant', content: '今天钠摄入约 1200mg。\n\n依据 · 高血压 → 钠上限 1500mg' },
])
check(
  '**气泡上那行小字画出来了**',
  basisBubbleHtml.includes('依据 · 高血压 → 钠上限 1500mg'),
  basisBubbleHtml.match(/依据 · [^<]*/)?.[0] ?? '(没有)'
)
check(
  '**而正文里没有第二遍**(摘不干净就会印两遍,而两遍长得还不一样)',
  (basisBubbleHtml.match(/依据 · 高血压/g) ?? []).length === 1,
  `数到 ${(basisBubbleHtml.match(/依据 · 高血压/g) ?? []).length} 处`
)
/*
  小字必须**真的是小字** —— 摘出来了但按正文字号画,等于没摘。
  断的是那一行的 `<span>` 自己带着 `text-[12px]`(正文那层是 15px)。
*/
check(
  '那行小字带着自己那一档字号（12px，正文那层是 15px）',
  /<span class="[^"]*text-\[12px\][^"]*">依据 · /.test(basisBubbleHtml),
  basisBubbleHtml.match(/<span class="[^"]*">依据 · [^<]*/)?.[0]?.slice(0, 130) ?? '(没找到那个 span)'
)

/*
  用户自己打的那句话里出现「依据 · 」时**不许**被摘 —— 那是他说的话,
  字号就是说话的字号。这一条是 `Bubble` 里那个 `mine ?` 判断的全部意义。
*/
const userBasisHtml = renderItems([
  { id: 'b2', role: 'user', content: '这是我想说的。\n\n依据 · 我自己编的' },
])
check(
  '**用户消息里的「依据 · 」按原样渲染**(那是他说的话,不是小字)',
  userBasisHtml.includes('依据 · 我自己编的') &&
    !/text-\[12px\][^"]*"[^>]*>依据 · /.test(userBasisHtml),
  userBasisHtml.match(/<span class="[^"]*text-\[12px\][^"]*">依据 · [^<]*/)?.[0] ?? '没有小字(对的)'
)

/* ---------- ⑤ (2026-09-24 撤掉了一条) ---------- */

/*
  ⚠️ 这里原来守着**生产者那一头**:「对话页把档案递给了 `mealVerdict`」——
  漏传 `profile` 不报错,只会静默少一行「依据 · 高血压 → 钠上限 1500mg」。

  那条结论句本身当天撤掉了(发图不算营养,它没有输入 —— 见 `MealResultCard`
  文件头最后一段、`ChatScreen.sendPhotos` 里那段、`lib/chatMeal.ts` 上那行
  「现在应用里没有调用方」)。锚点没了,断言留着不成立:它要么红,要么被改成
  一句永远为真的话 —— 后者更糟,看着还在守着什么,其实什么都没守。

  上面 ④ 那一节(气泡里那行小字要不要摘、摘出来是不是真小字)**不受影响**,
  它守的是**已有那句话**的呈现。将来把结论句摆回屏上时,它还在那儿。
*/

/* ============================================================
   趋势图 —— 日记页周/月视图里的四张卡
   ============================================================
   算术在 `verify-loop` 第 15 节(那边能直接调 `lib/trend.ts`)。这一节验的是
   **画出来的东西**:格子数、颜色、虚线的高度、折线断在哪儿。

   夹具的每个数都是手算的(面条 150mg 钠/100g、小笼包 420、饺子 430、白粥 2、
   馒头 165 —— 见 `data/foods.ts`),**不是问代码要的**。尤其那个「正好等于上限」
   的日子:面条 200g = 300mg 钠,而上限就设成 300 —— 这样边界那一条才验得到
   `>` 和 `>=` 的区别。
*/
{
  const chartMod = await server.ssrLoadModule('/src/components/TrendCharts.tsx')
  const TrendCharts = chartMod.TrendCharts
  const deriveMod = await server.ssrLoadModule('/src/store/derive.ts')

  check('取到了 `TrendCharts` 这个导出', typeof TrendCharts === 'function')

  /*
    档案是**就地拼的**一个副本,只改配额,不动全局 store ——
    `renderToStaticMarkup` 这一路只读它,改 store 会影响同一进程里别的断言。
  */
  const chartProfile = {
    ...store.getSnapshot().profile,
    quota: { ...store.getSnapshot().profile.quota, sodium: 300, kcal: 2000 },
  }

  /*
    七天,其中两条是空白日(9/11、9/14)。每个日子各有分工:

      9/10 早餐 面条 200g   → 220 kcal / 300mg ← **正好等于钠上限**
      9/11 (空)
      9/12 午餐 馒头 100g   → 223 kcal / 165mg
      9/13 晚餐 小笼包 200g → 460 kcal / 840mg ← 超钠,而且是热量那张图的峰值
      9/14 (空)
      9/15 上午加餐 白粥 250g → 115 kcal / 5mg
      9/16 夜宵 饺子 150g   → 360 kcal / 645mg ← 超钠

    于是钠那张:5 根柱子、2 根琥珀色(9/13、9/16),第一根**正好卡在上限**、是绿的;
    热量那张:5 根柱子、一根都不超(上限 2000 比所有日子都高)—— 上限线落在图里
    那一档,正是 `barScale` 注释里最要紧的那种人。
  */
  const CHART_DATES = [
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13',
    '2026-09-14',
    '2026-09-15',
    '2026-09-16',
  ]
  const CHART_MEALS = [
    ['2026-09-10', '早餐', 'noodles', '面条(煮)', 200],
    ['2026-09-12', '午餐', 'mantou', '馒头', 100],
    ['2026-09-13', '晚餐', 'xiaolongbao', '小笼包', 200],
    ['2026-09-15', '上午加餐', 'congee', '白粥', 250],
    ['2026-09-16', '夜宵', 'dumpling', '猪肉饺子', 150],
  ]
  const chartDays = CHART_DATES.map((date) =>
    deriveMod.dayStats(
      CHART_MEALS.filter((m) => m[0] === date).map(([d, slot, foodId, name, grams]) => ({
        id: `c-${d}-${slot}`,
        date: d,
        slot,
        time: '12:00',
        source: '手动记录',
        items: [{ foodId, name, grams }],
        createdAt: 1,
      })),
      date,
      chartProfile
    )
  )

  check(
    '(锚点) 夹具:7 天里 5 天有记录,而且 9/10 那天**正好卡在钠上限上**',
    chartDays.length === 7 &&
      chartDays.filter((d) => d.mealCount > 0).length === 5 &&
      chartDays[0].nutrition.sodium === chartProfile.quota.sodium,
    `钠 ${chartDays[0].nutrition.sodium} / 上限 ${chartProfile.quota.sodium}`
  )

  const chartHtml = renderToStaticMarkup(
    React.createElement(TrendCharts, {
      days: chartDays,
      quota: chartProfile.quota,
      windowLabel: '本周',
    })
  )

  /* 四张卡各切一段 —— 后面的断言全在段内搜,免得串到邻卡去 */
  const titleAt = (title, next) => {
    const a = chartHtml.indexOf(title)
    const b = next ? chartHtml.indexOf(next) : chartHtml.length
    return a === -1 || b === -1 ? '' : chartHtml.slice(a, b)
  }
  const naCard = titleAt('钠 · 逐日', '热量 · 逐日')
  const kcalCard = titleAt('热量 · 逐日', '健康分 · 逐日')
  const scoreCard = titleAt('健康分 · 逐日', '餐次占比')
  const slotCard = titleAt('餐次占比')

  check(
    '(锚点) 四张卡各切出来一段',
    [naCard, kcalCard, scoreCard, slotCard].every((c) => c.length > 100),
    [naCard, kcalCard, scoreCard, slotCard].map((c) => c.length).join(' / ')
  )
  check(
    '四张卡的头都在,而且顺序就是它们出现的顺序',
    ['钠 · 逐日', '热量 · 逐日', '健康分 · 逐日', '餐次占比'].every((t) => chartHtml.includes(t))
  )

  /* ---------- 柱子:没有记录的日子留空位,不留柱子 ---------- */

  const barRow = (card) => {
    const a = card.indexOf('flex h-full items-end')
    const b = card.indexOf('<span class="sr-only"', a)
    return a === -1 || b === -1 ? '' : card.slice(a, b)
  }
  const naRow = barRow(naCard)
  const kcalRow = barRow(kcalCard)

  check(
    '(锚点) 取到了柱子那一行',
    naRow.includes('flex-1') && !naRow.includes('sr-only'),
    `${naRow.length} 字符`
  )
  check(
    '**一格一天:空的格子也占着位置**(7 格 —— 少记的那两天不是把别的柱子挤过来)',
    (naRow.match(/min-w-0 flex-1/g) ?? []).length === 7,
    `${(naRow.match(/min-w-0 flex-1/g) ?? []).length} 格`
  )
  check(
    '**而其中只有 5 格有柱子**(没记录的那两格什么都不画)',
    (naRow.match(/rounded-t-\[3px\]/g) ?? []).length === 5,
    `${(naRow.match(/rounded-t-\[3px\]/g) ?? []).length} 根`
  )

  /* ---------- 颜色:边界是严格大于 ---------- */

  const colors = (row) =>
    (row.match(/rounded-t-\[3px\] (bg-[a-z-]+)/g) ?? []).map((s) => s.split(' ')[1])
  check(
    '**正好卡在上限的那根柱子是绿的,超了的才是琥珀色**(`>` 不是 `>=`)',
    JSON.stringify(colors(naRow)) ===
      JSON.stringify(['bg-brand', 'bg-brand', 'bg-warn', 'bg-brand', 'bg-warn']),
    colors(naRow).join(' / ')
  )
  check(
    '热量那张一根都不超(上限 2000 比所有日子都高)',
    colors(kcalRow).every((c) => c === 'bg-brand') && colors(kcalRow).length === 5,
    colors(kcalRow).join(' / ')
  )

  /* ---------- 高度:手算的百分比 ---------- */

  /*
    钠:标尺上界 = max(峰值 840, 上限 300) × 1.1 = 924
        300→32.5%  165→17.9%  840→90.9%  5→0.5%  645→69.8%
    热量:标尺上界 = max(峰值 460, 上限 2000) × 1.1 = 2200
        220→10%  223→10.1%  460→20.9%  115→5.2%  360→16.4%
  */
  const heights = (row) => (row.match(/height:([\d.]+)%/g) ?? []).map((s) => s.slice(7, -1))
  check(
    '钠那张每根柱子的高度就是它那一天除以标尺',
    JSON.stringify(heights(naRow)) === JSON.stringify(['32.5', '17.9', '90.9', '0.5', '69.8']),
    heights(naRow).join(' / ')
  )
  check(
    '热量那张同理(峰值远低于上限时,柱子只占标尺的一小块)',
    JSON.stringify(heights(kcalRow)) === JSON.stringify(['10', '10.1', '20.9', '5.2', '16.4']),
    heights(kcalRow).join(' / ')
  )

  /* ---------- 上限线:画在图里,而且画在它该在的高度 ---------- */

  const limitAt = (card) => (card.match(/bottom:([\d.]+)%/) ?? [])[1]
  const bottoms = [limitAt(naCard), limitAt(kcalCard)]
  check(
    '**一天都没超上限时,上限线仍然画在图里**(不是被顶到框外面去)',
    bottoms.every((b) => b !== undefined && Number(b) > 0 && Number(b) <= 91),
    `${bottoms.join(' / ')}%`
  )
  check(
    '上限线的高度就是 上限 ÷ 标尺(钠 300/924 = 32.5%,热量 2000/2200 = 90.9%)',
    limitAt(naCard) === '32.5' && limitAt(kcalCard) === '90.9',
    `${limitAt(naCard)}% / ${limitAt(kcalCard)}%`
  )

  /* ---------- 折线:空档断开,下标不重来 ---------- */

  const polylines = scoreCard.match(/points="[^"]*"/g) ?? []
  check(
    '**折线按空档切成三段**(9/10 一段、9/12–13 一段、9/15–16 一段)',
    polylines.length === 3,
    polylines.join(' | ')
  )
  check(
    '**第二段从 33.3 开始,不是从 0 重来**(第 3 天就得落在 3/7 处,不然和横轴对不上)',
    polylines[1]?.startsWith('points="33.3') === true &&
      polylines[2]?.startsWith('points="83.3') === true,
    polylines.slice(1).join(' | ')
  )
  check(
    '只记了一天的那一段画一个点(否则「只记了一天」和「一天都没记」长得一样)',
    (scoreCard.match(/<circle /g) ?? []).length === 1,
    `${(scoreCard.match(/<circle /g) ?? []).length} 个点`
  )
  check('60 分那条参考线在', (scoreCard.match(/<line /g) ?? []).length === 1)

  /* ---------- 说明句:那几个数真的是从这七天算出来的 ---------- */

  const scored = chartDays.filter((d) => d.mealCount > 0)
  const scores = scored.map((d) => d.score.score)
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  const hi = Math.round(Math.max(...scores))
  const lo = Math.round(Math.min(...scores))

  check(
    '钠那张的说明句数的是这七天(5 天有记录、其中 2 天超上限)',
    naCard.includes('本周 7 天里有 5 天有记录，其中 2 天超上限。'),
    naCard.match(/本周 \d+ 天里有[^<]*/)?.[0] ?? '(没有那句话)'
  )
  check(
    '热量那张同上(0 天超目标 —— 那句话得说得出口)',
    kcalCard.includes('本周 7 天里有 5 天有记录，其中 0 天超目标。'),
    kcalCard.match(/本周 \d+ 天里有[^<]*/)?.[0] ?? '(没有那句话)'
  )
  check(
    '**健康分那句的平均/最高/最低只算有记录的那 5 天**',
    scoreCard.includes(`有记录的 ${scored.length} 天平均 ${avg} 分，最高 ${hi}、最低 ${lo}。`),
    scoreCard.match(/有记录的[^<]*/)?.[0] ?? '(没有那句话)'
  )
  check(
    '而且它说明了为什么那两天不连线(不说的话,断开的线看起来像画错了)',
    scoreCard.includes('没有记录的那几天不连线')
  )
  check(
    '卡片右上角那个平均分和说明句里的是同一个数(两处各算一遍就会不一样)',
    scoreCard.includes(`平均 ${avg} 分`) &&
      (scoreCard.match(new RegExp(`平均 ${avg} 分`, 'g')) ?? []).length === 2,
    `数到 ${(scoreCard.match(new RegExp(`平均 ${avg} 分`, 'g')) ?? []).length} 处`
  )

  /* ---------- 餐次占比:四段图例 ---------- */

  /*
    手算:220 + 223 + 460 + 115 + 360 = 1378
          早餐 220→16%  午餐 223→16%  晚餐 460→33%  加餐 (115+360)→34%
    加餐那一格是**三档加餐的合计** —— 只算夜宵的话是 26%,是另一个数。
  */
  check(
    '图例是四段,而且「加餐」是加餐那几档的合计(不是只算夜宵那一笔)',
    ['早餐 16%', '午餐 16%', '晚餐 33%', '加餐 34%'].every((t) => slotCard.includes(t)),
    (slotCard.match(/>[早午晚加]餐 \d+%</g) ?? []).join(' / ')
  )
  check(
    '**「加餐」这个词在这张卡上被解释了**(它是那三档的合计,不解释就像换了一个字段)',
    slotCard.includes('加餐 = 上午加餐 + 下午加餐 + 夜宵')
  )

  /* ---------- 读屏:图藏起来,话留下 ---------- */

  check(
    '**图形本身对读屏是藏起来的,但每张图有一句说人话的替代**',
    (naCard.match(/aria-hidden/g) ?? []).length >= 2 &&
      naCard.includes('sr-only">本周钠摄入逐日柱状图') &&
      kcalCard.includes('sr-only">本周热量逐日柱状图'),
    naCard.match(/sr-only">[^<]*/)?.[0] ?? '(没有那句替代)'
  )

  /* ---------- 横轴 ---------- */

  const axisOf = (card) => {
    const a = card.indexOf('flex justify-between text-[10px]')
    const b = card.indexOf('<p class="text-[11px]', a)
    return a === -1 || b === -1 ? '' : card.slice(a, b)
  }
  const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']
  const shortLabel = (iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    return `${WEEKDAY_CN[new Date(y, m - 1, d).getDay()]} · ${m}/${d}`
  }
  const axisLabels = axisOf(naCard).match(/[日一二三四五六] · \d+\/\d+/g) ?? []
  check(
    '(锚点) 取到了横轴那一行',
    axisOf(naCard).includes('leading-[14px] text-faint') && axisOf(naCard).length > 50,
    `${axisOf(naCard).length} 字符`
  )
  check(
    '**横轴七格、一格一天,顺序是从早到晚**(和柱子一一对得上)',
    JSON.stringify(axisLabels) === JSON.stringify(CHART_DATES.map(shortLabel)),
    axisLabels.join(' / ')
  )
}

/* ---------- 趋势图只在周/月两档出现 ---------- */

/*
  ⚠️ 这一段只能扫源码:`range` 是 DiaryScreen 里的 `useState`,而
  `renderToStaticMarkup` **跑不了 effect、也点不动**,渲染出来的永远是日视图。
  上面那一段验的是「周/月长什么样」,这里验的是「日视图里没有它」——
  两个方向都钉住,才不会有第三种情况。
*/
check(
  '**日视图里没有趋势图**(这一屏渲染的就是日视图 —— 判据是那四张卡上的词)',
  !basisDiaryHtml.includes('餐次占比') && !basisDiaryHtml.includes('钠 · 逐日'),
  basisDiaryHtml.includes('餐次占比') ? '日视图里混进来了' : '日视图干净'
)
check(
  "**趋势图挂在 `range !== 'day'` 那一支上**(周/月才画)",
  diarySrcForBasis.includes("range !== 'day' && ("),
  '判据是那个条件本身,不是某一次渲染的结果'
)
/*
  传 `trend.days`(整个窗口、含没有记录的天),**不是** `view.days`(那个已经
  `filter(mealCount > 0)` 过了)。传错之后柱子会等距排开 —— 少记的那一天看起来
  只是「那天吃得少」,而图上没有任何不正常的痕迹。这是这次最要紧的一条。
*/
check(
  '**传给图的是整个窗口,不是滤掉空白天的那一份**',
  diarySrcForBasis.includes('days={trend.days}') &&
    !diarySrcForBasis.includes('days={view.days}'),
  diarySrcForBasis.includes('days={view.days}')
    ? '传的是 view.days(空白天会被挤掉)'
    : '传的是 trend.days'
)
check(
  '图上那句窗口名就是这一页的 `trendUnit`(不另起一个说法)',
  diarySrcForBasis.includes('windowLabel={trendUnit}'),
  '同一页里同一段窗口只有这一个说法'
)

/* ============================================================
   对话页 · 历史抽屉 / 每条消息的操作 / 空态那两个入口
   ============================================================
   纯算术(按档案分、N 轮、撤回那一刀)在 `verify-loop`。这一节验的是
   **屏幕上画出来的东西**,以及几条只能扫源码的判断(它们是 `useState` 驱动的,
   `renderToStaticMarkup` 跑不了 effect、也点不动)。
*/
{
  const drawerMod = await server.ssrLoadModule('/src/components/ChatHistoryDrawer.tsx')
  const sheetMod = await server.ssrLoadModule('/src/components/ActionListSheet.tsx')
  const chatSrc = await readFile('src/screens/ChatScreen.tsx', 'utf8')

  /*
    ⚠️ **否定断言必须扫「去掉注释的源码」**,不能扫整份文件。
    「有没有摆那三个入口」这条要排除的词,恰好就是这一页的注释里**点名批评**的
    那三个词(注释里写着「拍冰箱 / 看菜单 / 读配料 在这条链路上没有接通」)——
    扫整份文件的话,那条断言会被自己的注释弄红,而红的原因和界面毫无关系。
    这也正是本仓库那条规矩的正例:**断言的锚点先要经得起「它自己在说什么」。**
  */
  const chatCode = chatSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const renderDrawer = (props) =>
    renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(drawerMod.ChatHistoryDrawer, {
          open: true,
          profileId: 'p-a',
          onPick: () => {},
          onNew: () => {},
          onDelete: () => {},
          onClear: () => {},
          onClose: () => {},
          ...props,
        })
      )
    )

  const SESSION_A = {
    id: 'c1',
    profileId: 'p-a',
    at: new Date('2026-09-22T12:30:00').getTime(),
    items: [
      { id: 'u1', role: 'user', content: '早餐吃什么' },
      { id: 'a1', role: 'assistant', content: '回答' },
      { id: 'u2', role: 'user', content: '午餐呢' },
      { id: 'a2', role: 'assistant', content: '回答' },
    ],
  }
  const SESSION_B = { id: 'c2', profileId: 'p-b', at: Date.now(), items: [{ id: 'u3', role: 'user', content: '别人的话' }] }

  /* ---------- 抽屉 ---------- */
  const drawerHtml = renderDrawer({ sessions: [SESSION_A, SESSION_B] })
  check('抽屉里画出了历史记录这个标题', drawerHtml.includes('历史记录'))
  check('列表上有那句「N 轮」', drawerHtml.includes('2 轮'), drawerHtml.includes('轮') ? '' : '没有「轮」')
  check('列表上的标题是第一句用户消息', drawerHtml.includes('早餐吃什么'))
  check('有「新建对话」那颗', drawerHtml.includes('新建对话'))
  check('有「清空本档案的历史」', drawerHtml.includes('清空本档案的历史'))

  const foreignHtml = renderDrawer({ sessions: [SESSION_A, SESSION_B] })
  check(
    '**别的档案的会话不出现在这个抽屉里**(屏幕上,不只是函数里)',
    !foreignHtml.includes('别人的话'),
    foreignHtml.includes('别人的话') ? '别人的会话漏出来了' : '干净'
  )

  const emptyDrawerHtml = renderDrawer({ sessions: [] })
  check(
    '**一条历史都没有时写一句话,不是留一片白**(白的看起来像加载失败)',
    emptyDrawerHtml.includes('还没有别的对话')
  )
  check(
    '  (锚点)而那一句在**有**历史时不出现 —— 否则上一条可以靠一句永远在的话通过',
    !drawerHtml.includes('还没有别的对话')
  )
  check(
    '**没有历史时不给「清空」那颗**(按下去什么都不删的按钮比没有更困惑)',
    !emptyDrawerHtml.includes('清空本档案的历史')
  )
  check('关着的时候整个不渲染', renderDrawer({ open: false, sessions: [SESSION_A] }) === '')

  /* ---------- 操作表 ---------- */
  const renderSheet = (props) =>
    renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(sheetMod.ActionListSheet, { open: true, onClose: () => {}, ...props }))
    )
  const sheetHtml = renderSheet({
    title: '这餐咸吗',
    items: [
      { icon: 'copy', label: '复制本条', onSelect: () => {} },
      { icon: 'undo', label: '撤回并重新编辑', hint: '这句话和它之后的回答都会没掉', onSelect: () => {} },
      { icon: 'trash', label: '删除本条', hint: '只删这一句', tone: 'danger', onSelect: () => {} },
    ],
  })
  check('操作表画出了每一项', sheetHtml.includes('复制本条') && sheetHtml.includes('撤回并重新编辑') && sheetHtml.includes('删除本条'))
  check('标题是那一条消息自己的话(别让用户回忆刚才点的是哪条)', sheetHtml.includes('这餐咸吗'))
  check('破坏性那一项带一句后果说明', sheetHtml.includes('这句话和它之后的回答都会没掉'))
  check('破坏性那一项用 danger 色', sheetHtml.includes('text-danger'))
  check(
    '**删除排在最后**(手指落点的肌肉记忆不该把它勾上)',
    sheetHtml.indexOf('删除本条') > sheetHtml.indexOf('撤回并重新编辑'),
    `撤回@${sheetHtml.indexOf('撤回并重新编辑')} 删除@${sheetHtml.indexOf('删除本条')}`
  )
  check('不传 items 时不渲染', renderSheet({ title: 'x', items: [] }) !== '' && !renderSheet({ title: 'x', items: [] }).includes('删除'))

  /* ---------- 每条消息下面那颗「…」 ---------- */
  const menuHtml = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(chatTranscript.ChatTranscript, {
        items: [{ id: 'u1', role: 'user', content: '这餐咸吗' }],
        busy: false,
        onActions: () => {},
      })
    )
  )
  check('**传了 onActions 时,每条消息下面有一颗操作入口**', menuHtml.includes('这条消息的操作'))
  check(
    '  (锚点)不传时**整颗不渲染** —— 没有操作可做的地方不摆一个按了没反应的图标',
    !renderItems([{ id: 'u1', role: 'user', content: '这餐咸吗' }]).includes('这条消息的操作')
  )
  check(
    '**卡片形态的消息下面也有这一颗**(结构化回复也是一条消息)',
    renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(chatTranscript.ChatTranscript, {
          items: [{ id: 'a1', role: 'assistant', content: '', reply: plateReply }],
          busy: false,
          onActions: () => {},
        })
      )
    ).includes('这条消息的操作')
  )

  /* ---------- 空态:两个真通的入口 ---------- */
  /*
    ⚠️ 这一节只扫源码。空态的条件是 `messages.length <= 1`,而
    `renderToStaticMarkup` 渲染的是**初始 state**(一条问候语)—— 也就是说
    渲染出来的那一屏**就是**空态。但它渲染不出「点了会怎样」,所以
    「这两颗各自通向哪条路」只能扫源码。
  */
  /*
    ⚠️ **2026-09-23 判据翻了:空态不再摆任何快捷键。**

    原来这里是「空态摆着『拍餐盘』和『搜菜品』两颗」+ 一行三颗快捷提问胶囊。
    用户的原话是「不要有搜菜品这样的快捷键,只保留类似于豆包聊天的干净界面」——
    撤掉的理由不只是好看:

      · 「搜菜品」根本不是对话,它打开的是首页那个手动记录面板
      · 快捷提问胶囊是**替用户决定他想问什么**,而那种界面里用户是自己想问题的

    所以现在的判据是**反向**的:那两样**都不许再出现**。而且不再切片,直接扫
    整份源码 —— 切片是为了「在空态那一块里数」,现在要断的是「整页都没有它」,
    切片反而会把「搬到别处去了」这种坏法漏掉。

    ⚠️ 发图那条路**没有丢**:输入栏本来就有附件入口(下一节那条断言盯着它)。
  */
  check(
    '**空态不再摆「搜菜品」那颗**(它不是对话,是首页那个手动记录面板)',
    !chatCode.includes('搜菜品'),
    chatCode.includes('搜菜品') ? '还在' : '没有了'
  )
  check(
    '**空态不再摆快捷提问胶囊**(用户自己想问题,不替他决定)',
    !chatCode.includes('QUICK_QUESTIONS'),
    chatCode.includes('QUICK_QUESTIONS') ? '还在' : '没有了'
  )
  check(
    '**那个手动记录面板也一并撤干净了**(不留 mealSheetOpen 这种够不着的状态)',
    !chatCode.includes('mealSheetOpen'),
    chatCode.includes('mealSheetOpen') ? '还有残留' : '没有残留'
  )
  check(
    '**没摆那三个没接通的**(拍冰箱 / 看菜单 / 读配料 —— 按下去什么都不发生的装饰)',
    !chatCode.includes('拍冰箱') && !chatCode.includes('看菜单') && !chatCode.includes('读配料')
  )
  check(
    '  (锚点)上面那条扫的确实是**这一页的源码**,不是一份空字符串 —— 否则它永远绿',
    chatCode.includes('CHAT_GREETING') && chatCode.length > 4000,
    `${chatCode.length} 字`
  )
  check(
    '「拍餐盘」走的是这一页既有的那条路(图进附件条,不跳页)',
    chatCode.includes('onClick={picker.openCamera}'),
    '同一颗相机入口'
  )

  check(
    '那句「基于「我的档案」」挪到了空态里(题头那颗位置让给了历史记录)',
    chatCode.includes('回答基于「我的档案」') && !chatCode.includes('right="基于「我的档案」"')
  )

  /* ---------- 三条只能扫源码的判断 ---------- */
  check(
    '**「重试」重跑的是原来那句提问,不是输入框里此刻的内容**',
    chatSrc.includes('await answer(question, state.meals)') && !chatSrc.includes('await answer(input'),
    chatSrc.includes('await answer(input') ? '重跑的是输入框' : '重跑的是原话'
  )
  check(
    '**「撤回并重新编辑」把原文放回输入框**(否则撤回之后那句话就找不回来了)',
    chatSrc.includes('setInput(text)') && chatSrc.includes('cutFrom(item.id)'),
    '放回输入框 + 从这里切掉'
  )
  check(
    '**每说一句就落一次盘挂在 `messages` 上**(八处改 messages 的地方不会各漏一次)',
    chatSrc.includes('}, [messages])') && chatSrc.includes('saveChatLog(next)'),
    '只有一处落盘'
  )
  check(
    '**「清空历史」之后同时开一段新的**(否则下一句又把自己写回列表,看着像没清掉)',
    chatSrc.includes('clearSessionsFor(sessions, state.activeProfileId)') && chatSrc.includes('startFresh()')
  )
  /*
    ⚠️ `\{[^}]*` 而不是 `\{[\s\S]*?` —— 后者是**惰性但无界**的:把 startFresh 里
    那一行删掉之后,它会一路跨过函数结尾、匹配到 pickSession 里那一行,
    于是这条断言**照样绿**(实测:拆掉一半还报「两条路径都清了」)。
    `[^}]*` 碰到第一个 `}` 就停,而那正好是这个函数的结尾。
  */
  const clearsUpstream = (fn) =>
    new RegExp(`const ${fn} = \\([^)]*\\) => \\{[^}]*setConversationId\\(undefined\\)`).test(chatSrc)
  check(
    '**换会话时清掉上游的 `conversationId`**(不清的话新对话第一句还带着旧对话的记忆)',
    clearsUpstream('startFresh') && clearsUpstream('pickSession'),
    `startFresh=${clearsUpstream('startFresh')} pickSession=${clearsUpstream('pickSession')}`
  )
}

/* ============================================================
   日记页那一行「正在算这一餐」（2026-09-24 下午）
   ------------------------------------------------------------
   用户的原话：

     「我建议在计算的时候，可以在日记里显示这一餐正在计算，否则用户点击确定后
       并不知道是已经在算了还是没有计算」

   这一组验的是**屏幕上真的看得见**。两半:
     · `PendingMealRow` 是受控的 —— 三态直接渲染并断言(SSR 不跑 effect,
       组件内部 state 在自检里永远是初值,受控才断言得到)。
     · 接线那一半渲染**整个日记页** —— 组件写好了但没挂上去,是这个仓库
       点过名的一类失效(逻辑全绿、屏幕上什么都不发生)。
   ============================================================ */

console.log('\n=== 日记页那一行「正在算这一餐」 ===')

const pendingMod = await server.ssrLoadModule('/src/components/PendingMealRow.tsx')
const logRunMod = await server.ssrLoadModule('/src/store/logRun.ts')

/** 今天 12:30 —— 这个钟点是这一行上**唯一**允许出现的数字(拍照那一刻,确实知道) */
const AT_TODAY = (() => {
  const d = new Date()
  d.setHours(12, 30, 0, 0)
  return d.getTime()
})()
const AT_YESTERDAY = AT_TODAY - 24 * 60 * 60 * 1000

const PENDING_MEAL = {
  profileId: 'demo',
  from: 'photo',
  slot: '午餐',
  items: [{ foodId: 'web:青团', name: '青团', grams: 80 }],
  thumb: 'data:image/jpeg;base64,PENDINGTHUMB',
  at: AT_TODAY,
}
/*
  ⚠️ 打字那份（`README` 里那条路的另一半）：`from: 'text'`、**没有 `thumb`**。
  它和上面那份在屏幕上只差第二行的来源词 —— 那正是这一组要钉的东西：
  这一行十几秒后要**就地变成那条记录**，而记录的第二行是 `{time} · {source}`。
*/
const PENDING_TEXT_MEAL = { ...PENDING_MEAL, from: 'text', thumb: undefined }

const renderPending = (run, divider = false) =>
  renderToStaticMarkup(
    React.createElement(pendingMod.PendingMealRow, { run, divider, onDismiss: () => {} })
  )

/*
  ⚠️ 「一个数字都不印」量的是**文字**,不是整段 HTML —— `h-[66px]` / `text-[15px]`
  这些类名里全是数字,拿 HTML 去搜数字永远搜得到(那会让这条断言**永远红**,
  而下一个人只会把它删掉)。
  ⚠️ 而且钟点是**允许的**:拍照那一刻确实知道是几点。所以先把它摘掉再找数字。
*/
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const stripClock = (text) => text.replace(/\d{1,2}:\d{2}/g, '')

const computingHtml = renderPending({ phase: 'computing', kind: 'log', meal: PENDING_MEAL })
const failedHtml = renderPending({
  phase: 'failed',
  kind: 'log',
  meal: PENDING_MEAL,
  message: '上游超时了，这一趟没算出来。',
})

check('那一行确实渲染出来了(下面每一条的前提)', computingHtml.length > 100, `${computingHtml.length} 字符`)

check(
  '**「正在算」那一行说的是「正在算这一餐的营养…」**(不是一句「加载中」)',
  computingHtml.includes('午餐 · 正在算这一餐的营养…'),
  textOf(computingHtml)
)
check(
  '**那一行上除了拍照的钟点,一个数字都没有**(那一刻还没有数 —— 印 0 或者编一个,都是在说一件没发生的事)',
  !/\d/.test(stripClock(textOf(computingHtml))),
  stripClock(textOf(computingHtml))
)
check(
  '**而钟点确实印着,而且印的是拍照那一刻**(和十几秒后那条真记录的 `time` 是同一个数)',
  textOf(computingHtml).includes('12:30') && textOf(computingHtml).includes('· 拍餐盘'),
  textOf(computingHtml)
)
/*
  ⚠️ 第二行整句是**那条真记录的第二行**（`DiaryScreen` 里 `{meal.time} · {meal.source}`），
  所以来源得跟着草稿走：拍的那份写「拍餐盘」，打字那份写「对话记录」。
  写死成「拍餐盘」的话，用户问一句「红烧肉怎么做」再点「记入日记」，日记页上这一行
  会写着「拍餐盘」，而十几秒后**就地变成的那条记录**写着「对话记录」——
  同一行前后两个说法，而这个组件存在的全部意义就是它会变成那一条。
*/
const computingTextHtml = renderPending({ phase: 'computing', kind: 'log', meal: PENDING_TEXT_MEAL })
check(
  '**打字那份那一行写「对话记录」,不写「拍餐盘」**（它十几秒后要变成的那条记录就是这么写的）',
  textOf(computingTextHtml).includes('· 对话记录') && !textOf(computingTextHtml).includes('拍餐盘'),
  textOf(computingTextHtml)
)
check(
  '**反过来:拍的那份仍然写「拍餐盘」**(别为了这一条把两边都改成同一个词)',
  textOf(computingHtml).includes('· 拍餐盘'),
  textOf(computingHtml)
)
/*
  ⚠️ 那条分割线**不是装饰**:它和真记录用的是同一条(`pl-[68px]` + `h-px bg-line`),
  第一行时不该有(否则卡片顶上多一条悬空的线)。
*/
check(
  '**那一行认分割线这个开关**(它是这一段的第一行时才画)',
  !computingHtml.includes('pl-[68px]') && renderPending({ phase: 'computing', kind: 'log', meal: PENDING_MEAL }, true).includes('pl-[68px]'),
  `divider=false ${computingHtml.includes('pl-[68px]')} / divider=true ${renderPending({ phase: 'computing', kind: 'log', meal: PENDING_MEAL }, true).includes('pl-[68px]')}`
)
/*
  ⚠️ 几何**必须和真记录那一行逐字相同**:它十几秒后就要变成那一条,高度或缩进
  差一点,那一行就会在算完的一瞬间跳一下。判据是那一串类名,不是「有个 h-[66px]」。
*/
check(
  '**几何和真记录那行逐字相同**(算完就地变成它,位置不能跳)',
  computingHtml.includes('flex h-[66px] w-full items-center gap-3 px-4 py-3 text-left'),
  'h-[66px] / gap-3 / px-4 py-3 / text-left'
)
check(
  '**草稿里那张小图带过来了**(那一行旁边就是刚拍的那张照片)',
  computingHtml.includes('PENDINGTHUMB'),
  computingHtml.includes('PENDINGTHUMB') ? '在' : '没带'
)
check(
  '**读屏也知道这行是个状态**(不是一段没人念的装饰)',
  computingHtml.includes('role="status"'),
  'role="status"'
)

/* ---------- 失败那一态 ---------- */

check(
  '**没算出来时那一行印的是原因,而且说清「这条还留着」**'
    + '(不说的话,用户读到「没算出来」只会以为这顿饭没了 —— 而草稿和照片都在)',
  failedHtml.includes('午餐 · 没算出来') &&
    failedHtml.includes('上游超时了，这一趟没算出来。') &&
    failedHtml.includes('这条还留着，下次进对话页还会问你。'),
  textOf(failedHtml)
)
check(
  '**「收掉」那颗在**(失败那一行关不掉的话,它会在日记页上一直挂着)',
  failedHtml.includes('收掉'),
  failedHtml.includes('收掉') ? '在' : '没有'
)
/*
  ⚠️ 反方向的两条。只写「失败那行有『没算出来』」是不够的:把两态写成同一个
  分支(不管三七二十一都印「没算出来」)照样绿。这两条各自钉一个方向。
*/
check(
  '**「正在算」那行不许出现「没算出来」(反方向)**',
  !computingHtml.includes('没算出来') && !computingHtml.includes('这条还留着'),
  computingHtml.includes('没算出来') ? '在算的时候就在报失败' : '没提前报失败'
)
check(
  '**失败那行不许还在转圈(反方向)**',
  !failedHtml.includes('正在算') && !failedHtml.includes('animate-'),
  failedHtml.includes('正在算') ? '失败态还在说「正在算」' : '失败态是静的'
)

/* ---------- 正面控制:同一份渲染里的真记录那行**有**数字 ---------- */

/*
  ⚠️ 只写否定断言(「那一行没有数字」)**必假绿**:把整个 `PendingMealRow` 渲染成
  空字符串也满足。所以配一条正面控制 —— 同一张卡里的**真记录**那一行,数字是在的。
  两条一起才说明「印不印数字」是个**有区分度的判据**,而不是「这个页面本来就没数字」。
*/
const CTRL_ITEM = {
  foodId: 'web:控制组豆浆',
  name: '控制组豆浆',
  grams: 250,
  per100g: ricePer100g,
  source: '联网估算',
}
store.addMeal({ slot: '早餐', items: [CTRL_ITEM], source: '拍餐盘' })
const ctrlAt = renderDiary().indexOf('早餐 · 控制组豆浆')
const ctrlRow = ctrlAt === -1 ? '' : renderDiary().slice(ctrlAt, ctrlAt + 400)
const ctrlText = stripClock(textOf(ctrlRow))
check(
  '**正面控制:同一张卡里的真记录那一行是有数字的**(否则上面那条否定断言是假的)',
  ctrlAt !== -1 && /\d/.test(ctrlText),
  ctrlAt === -1 ? '切不到那一条真记录' : ctrlText
)

/* ---------- 挂在日记页上(整页渲染) ---------- */

/*
  ⚠️ 每次渲染前摆姿势、渲染后立刻清干净 —— `logRun` 是**模块级单例**,
  不清的话它会顺着这个脚本后面的每一次渲染一路泄漏下去。
*/
const renderDiaryWith = (run) => {
  logRunMod.setLogRun(run)
  const html = renderDiary()
  logRunMod.setLogRun(null)
  return html
}

check(
  '**日记页上真的有这一行**(判据在、行不在 = 屏幕上什么都不发生)',
  renderDiaryWith({ phase: 'computing', kind: 'log', meal: PENDING_MEAL }).includes('正在算这一餐的营养…'),
  '挂在日记页上了'
)
/*
  ⚠️ 日期对不上就**不许出现**。这条是「那一行会不会跑到别的日子上」的判据:
  23:59 拍的那一餐和落盘那条记录用的是同一把尺子(`meal.at`),对不上的话
  用户会在今天看见一行「正在算」,而十几秒后真记录落在昨天 —— 看着像飞了。
*/
check(
  '**昨天拍的那一餐不出现在今天的日记页上**(它十几秒后也不落在这里)',
  !renderDiaryWith({ phase: 'computing', kind: 'log', meal: { ...PENDING_MEAL, at: AT_YESTERDAY } })
    .includes('正在算这一餐的营养…'),
  '日期对不上就不显示'
)
check(
  '**没算出来时日记页上也是那一行**(不是只在对话页说 —— 用户那时候多半已经在日记页了)',
  renderDiaryWith({
    phase: 'failed',
    kind: 'log',
    meal: PENDING_MEAL,
    message: '上游超时了，这一趟没算出来。',
  }).includes('这条还留着，下次进对话页还会问你。'),
  '日记页也说了'
)
/*
  ⚠️ 两种**不该**显示的情形,各一条:它们都会在屏幕上说一句假话。
  · `logged` —— 真记录已经在列表里了,再来一行就是重复,而且那一行十几秒后会
    变成第二条;
  · `adjust-ready` / 「调整分量再记」的 computing —— 那一条**不会自己变成记录**
    (要等用户在面板上点保存),说「算好了会记在这一天」是骗他。
*/
check(
  '**已经落盘的那一趟不再显示那一行**(真记录已经在列表里了,再来一行就是重复)',
  !renderDiaryWith({ phase: 'logged', meal: PENDING_MEAL }).includes('正在算这一餐的营养…'),
  '落盘了就不显示'
)
check(
  '**「调整分量再记」那一路不显示那一行**(它不会自己变成记录,要等用户点保存)',
  !renderDiaryWith({ phase: 'computing', kind: 'adjust', meal: PENDING_MEAL }).includes('正在算这一餐的营养…') &&
    !renderDiaryWith({ phase: 'adjust-ready', meal: PENDING_MEAL, items: [] }).includes('正在算'),
  '两条都不显示'
)

/* ---------- 收尾:把模块单例拨回干净状态 ---------- */

logRunMod.cancelLogRun()

await server.close()
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
