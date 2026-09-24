/**
 * Agent 回复解析自检(开发用,不进产物)
 * ===========================================================
 * 解析器的输入是**模型输出**,不是编译器输出 —— 它会加围栏、会裹客套话、
 * 会少给字段。所以这里的用例全部围绕「对面不守规矩时会不会崩」来写。
 *
 * 跑法:npm run verify:reply
 */

import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { parseAgentReply, splitNumbered, demoteHardBlock } = await server.ssrLoadModule('/src/lib/agentReply.ts')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failures++
}

/* ============================================================
   夹具 —— 取自真实探测结果(见 README「接入 Dify agent」),
   只保留结构,不含任何个人信息
   ============================================================ */

/** 餐盘复盘:两条菜,一条不适宜 */
const PLATE = JSON.stringify({
  blocked: false,
  risk: { level: 'low', message: '午餐摄入钠含量较高,晚餐需重点控盐。', items: [] },
  result: {
    mode: 'plate',
    title: '午餐回顾与晚餐建议',
    dishes: [
      { name: '红烧肉', suitable: false, reason: '高油、高盐、高蛋白。' },
      { name: '米饭', suitable: true, reason: '主食来源,但升糖指数较高。' },
    ],
    advice: ['先喝汤 → 再吃蛋白质 → 最后吃主食。', '全天饮水 1500-1700ml。'],
    disclaimer: '本建议仅供参考。',
  },
})

/** 过敏拦截:没有 result */
const BLOCKED = JSON.stringify({
  blocked: true,
  risk: { level: 'high', message: '宫保鸡丁常含花生,与你的过敏原冲突。', items: ['花生'] },
})

/** 单菜分析:带做法与改良说明 */
const DISH = JSON.stringify({
  blocked: false,
  risk: { level: 'low', message: '红烧排骨油脂和钠偏高。', items: [] },
  result: {
    mode: 'dish',
    title: '红烧排骨健康改良建议',
    dishes: [
      {
        name: '红烧排骨',
        suitable: true,
        reason: '传统做法高油高糖高盐。',
        recipe: ['排骨冷水下锅焯水。', '炒糖色。', '炖煮 30-40 分钟。'],
        healthModification:
          '1. **减糖**:冰糖用量减少50%,或使用代糖;2. **减油**:焯水后煸炒倒掉多余脂肪;3. **减盐**:使用低钠酱油;4. **搭配**:配大量绿叶蔬菜。',
      },
    ],
    advice: ['每次控制在 100g 以内。'],
    disclaimer: '本建议仅供参考。',
  },
})

/** 知识问答:没有 dishes */
const INGREDIENT = JSON.stringify({
  blocked: false,
  risk: { level: 'low', message: '', items: [] },
  result: {
    mode: 'ingredient',
    title: '膳食纤维的作用说明',
    ingredients: [],
    dishes: [],
    nutrition: { ingredients: ['膳食纤维'], labels: {}, riskItems: [] },
    advice: ['建议成人每日摄入 25-30 克。'],
    disclaimer: '本建议仅供参考。',
  },
})

/* ============================================================
   正常路径
   ============================================================ */

console.log('\n=== 结构解析 ===')

{
  const r = parseAgentReply(PLATE)
  check('plate 解析成功', r !== null)
  check('plate 菜品数 = 2', r?.dishes.length === 2, `实际 ${r?.dishes.length}`)
  check('plate 保留 suitable  标志', r?.dishes[0].suitable === false && r?.dishes[1].suitable === true)
  check('plate risk.level 保留', r?.risk.level === 'low')
  check('plate 不是拦截', r?.blocked === false)
}

{
  const r = parseAgentReply(BLOCKED)
  check('blocked 解析成功', r !== null)
  check('blocked 标记为拦截', r?.blocked === true)
  check('blocked 带出过敏原', r?.risk.items[0] === '花生', JSON.stringify(r?.risk.items))
  check('blocked level = high', r?.risk.level === 'high')
  check('blocked 没有菜品', r?.dishes.length === 0)
}

/* ---------- 对话页:硬拦截只当提醒 ---------- */
/**
 * 2026-09-23 傍晚加的口径:用户要的是「聊天里干脆不拦,冲突写成建议里的一行提醒」。
 *
 * 这三条盯的是那条例外**没有把信息弄丢** —— 降级只摘 `blocked` 这一个标记,
 * 风险的那句话和那个过敏原必须原样还在(它们是屏幕上唯一剩下的内容)。
 * 摘多了的话,屏幕上会是一张空的提醒条,而那看起来像界面坏了。
 */
{
  const r = demoteHardBlock(parseAgentReply(BLOCKED))
  check('对话页降级:拦截标记被摘掉', r?.blocked === false)
  check(
    '对话页降级:风险那句话还在(屏上就剩它了)',
    r?.risk.message === '宫保鸡丁常含花生,与你的过敏原冲突。',
    r?.risk.message
  )
  check('对话页降级:过敏原还在', r?.risk.items[0] === '花生', JSON.stringify(r?.risk.items))
  check('对话页降级:level 还是 high(提醒条靠它配色)', r?.risk.level === 'high', r?.risk.level)

  // 放行的那份不该被复制一遍 —— 降级是「拦截才做的事」,不是无条件改写
  const ok = parseAgentReply(PLATE)
  check('放行的那份原封不动退回(同一个对象)', demoteHardBlock(ok) === ok)
}

{
  const r = parseAgentReply(DISH)
  check('dish 解析出做法步骤', r?.dishes[0].recipe.length === 3, `实际 ${r?.dishes[0].recipe.length}`)
  check('dish 解析出改良说明', (r?.dishes[0].healthModification.length ?? 0) > 0)
  check('dish mode 保留', r?.mode === 'dish')
}

{
  const r = parseAgentReply(INGREDIENT)
  check('ingredient 解析成功', r !== null)
  check('ingredient 没有菜品', r?.dishes.length === 0)
  check('ingredient 有建议', (r?.advice.length ?? 0) > 0)
}

/* ------------------------------------------------------------
   营养标签的**第二个抽屉**(2026-09-23)
   ------------------------------------------------------------
   实测膳享+ 拍包装时会把 `labels` / `riskItems` **直接挂在 `result` 上** ——
   那一趟的原文里连 `nutrition` 这个键都没有。只认 `result.nutrition` 的话
   这几行**悄悄没了**,卡片上「营养标签」那一块整块不显示,用户看到的就是
   **「没有具体说含量」**(2026-09-23 用户原话),可数据在原文里一行不缺。

   这和 `ingredients` 那三种形状是同一类错:数据在,只是放错了抽屉。
   ------------------------------------------------------------ */
{
  const FLAT = JSON.stringify({
    blocked: false,
    risk: { level: 'medium', message: '含添加糖', items: ['白砂糖'] },
    result: {
      mode: 'ingredient',
      title: '配料与营养标签解读',
      ingredients: [{ name: '生牛乳' }, { name: '白砂糖' }],
      labels: { 能量: '395kJ / 100g', 钠: '60mg / 100g' },
      riskItems: ['白砂糖', '食品用香精'],
      advice: ['按 250ml 算，添加糖约 25g。'],
    },
  })
  const r = parseAgentReply(FLAT)
  check('平铺的 labels 收下了(否则「含量」那一块整块不显示)', r?.nutrition.labels.length === 2, `实际 ${r?.nutrition.labels.length} 项`)
  check('  而且项目名和数值都没串位', r?.nutrition.labels[0].label === '能量' && r?.nutrition.labels[0].value === '395kJ / 100g', JSON.stringify(r?.nutrition.labels[0]))
  check('平铺的 riskItems 也收下了', r?.nutrition.riskItems.length === 2, JSON.stringify(r?.nutrition.riskItems))
  /*
    锚点:顶层那份 ingredients **不许**被收进营养块 —— 它已经被「识别到的食材」
    那块胶囊用掉了,再收一遍,同一串名字会在同一张卡上印两遍。
  */
  check('  (锚点)而营养块里只有 2 项 labels,说明顶层 ingredients 没被顺带收进来', r?.nutrition.ingredients.length === 0)
  check('顶层那份归胶囊(识别到的食材仍是 2 样)', r?.ingredients.length === 2, JSON.stringify(r?.ingredients.map((i) => i.name)))
}
{
  /* 两个抽屉都有时,提示词里写对的那份(`nutrition`)优先 */
  const BOTH = JSON.stringify({
    blocked: false,
    risk: { level: 'low', message: '', items: [] },
    result: {
      mode: 'ingredient',
      title: 't',
      labels: { 钠: '平铺那份' },
      nutrition: { ingredients: [], labels: { 钠: '嵌套那份' }, riskItems: [] },
      advice: ['a'],
    },
  })
  const r = parseAgentReply(BOTH)
  check('两个抽屉都有时,`nutrition` 那份优先(它是提示词里写对的那个)', r?.nutrition.labels[0]?.value === '嵌套那份', JSON.stringify(r?.nutrition.labels))
}

/* ============================================================
   对面不守规矩时 —— 这几条才是这个自检存在的理由
   ============================================================ */

console.log('\n=== 容错 ===')

{
  check('代码围栏能剥掉', parseAgentReply('```json\n' + PLATE + '\n```') !== null)
  check('裸围栏也能剥', parseAgentReply('```\n' + PLATE + '\n```') !== null)
  check('前面有客套话能挖出来', parseAgentReply('好的,以下是分析结果:\n' + PLATE + '\n希望有帮助!') !== null)
  check('前后有换行空白不影响', parseAgentReply('\n\n  ' + PLATE + '  \n\n') !== null)
}

{
  check('纯文本返回 null（走气泡降级）', parseAgentReply('红烧肉偏咸,晚餐清淡些就好。') === null)
  check('空字符串返回 null', parseAgentReply('') === null)
  check('只有空白返回 null', parseAgentReply('   \n  ') === null)
  check('截断的 JSON 返回 null', parseAgentReply('{"blocked":false,"result":{"tit') === null)
  check('合法但没有内容的 JSON 返回 null', parseAgentReply('{}') === null)
  check('只有 key 没有内容的 JSON 返回 null', parseAgentReply('{"hello":"world"}') === null)
  check('拦截但没给理由的返回 null', parseAgentReply('{"blocked":true}') === null)
}

{
  // 模型偶尔会给错类型 —— 不该让整个解析炸掉
  const weird = JSON.stringify({
    blocked: false,
    risk: { level: 'catastrophic', message: 42, items: 'not-an-array' },
    result: { mode: 'plate', title: '标题', dishes: [null, 'string', { name: '有效菜' }], advice: [1, '有效建议'] },
  })
  const r = parseAgentReply(weird)
  check('异常类型不崩', r !== null)
  check('未知 risk.level 归为 unknown', r?.risk.level === 'unknown', String(r?.risk.level))
  check('非字符串 message 归空', r?.risk.message === '')
  check('非数组 items 归空', Array.isArray(r?.risk.items) && r.risk.items.length === 0)
  check('dishes 里的垃圾条目被过滤', r?.dishes.length === 1, `实际 ${r?.dishes.length}`)
  check('advice 里的非字符串被过滤', r?.advice.length === 1, `实际 ${r?.advice.length}`)
}

{
  // suitable 字段缺失时不该给用户标红
  const r = parseAgentReply(JSON.stringify({ result: { title: 't', dishes: [{ name: '菜' }] } }))
  check('suitable 缺失时默认视为适宜', r?.dishes[0].suitable === true)
}

/* ============================================================
   编号拆分
   ============================================================ */

console.log('\n=== 编号拆分 ===')

{
  const parts = splitNumbered(
    '1. **减糖**:冰糖用量减少50%;2. **减油**:焯水后煸炒;3. **减盐**:使用低钠酱油;4. **搭配**:配绿叶蔬菜。'
  )
  check('四条编号拆成四条', parts.length === 4, `实际 ${parts.length}`)
  check('编号前缀已剥掉', !/^\d+[.、]/.test(parts[0] ?? ''), parts[0])
  check('无残留分号', !parts[0]?.endsWith(';') && !parts[0]?.endsWith('；'), parts[0])
  check('粗体标记保留（交给渲染层处理）', parts[0]?.includes('**减糖**') === true)
}

{
  const one = splitNumbered('每日摄入 25-30 克。')
  check('没有编号时原样返回', one.length === 1 && one[0] === '每日摄入 25-30 克。')
}

{
  // 「25-30 克」这类数字不该被误当成编号切开
  const two = splitNumbered('建议每日摄入 25 克膳食纤维,来源为全谷物、蔬菜、水果和豆类。')
  check('句中数字不误切', two.length === 1, `实际切了 ${two.length} 段`)
}

/* ============================================================
   客户端识别链路 —— 模型答的是「说明」而不是菜名
   ------------------------------------------------------------
   实测(scripts/probe-vision.mjs 第 3 步)会走到这个分支:一张纯色方图
   走真实链路,模型回「未知菜品 (图片无法识别)」—— 它答对了,那张图里
   确实没有菜。但这个名字一旦当成菜往下走,就会变成结果页里的一行
   「未知菜品 · 估算 0g」和日记里的一条叫「未知菜品」的记录。

   这一节把 /api/recognize 换成一段**写死的 SSE**,测的是客户端那一半:
   从流里攒出 raw、解析、过滤、匹配的整条路。
   ============================================================ */
console.log('\n=== 客户端识别链路 ===')

const { runRecognition } = await server.ssrLoadModule('/src/lib/recognizeAgent.ts')
const store = await server.ssrLoadModule('/src/store/store.ts')

const appState = store.getSnapshot()

/** 下一次请求该吐什么(SSE 原文) */
let upstream = ''
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/recognize')) {
    return new Response(upstream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  return realFetch(url, init)
}

/** 一条菜 —— 这个 agent 只会给 name/suitable/reason,没有克数 */
const dish = (name) => ({ name, suitable: true, reason: '' })

/** 把一份 AgentReply 裹成 SSE,喂给 runRecognition */
async function recognize(dishes) {
  upstream = `data: ${JSON.stringify({
    event: 'message',
    answer: JSON.stringify({
      blocked: false,
      risk: { level: 'low', message: '', items: [] },
      result: { mode: 'plate', title: '午餐复盘', dishes, advice: [], disclaimer: '' },
    }),
  })}\n\n`

  return runRecognition({
    image: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
    slot: '午餐',
    profile: appState.profile,
    meals: appState.meals,
  })
}

// ① 全是占位名 —— 模型没认出东西
const nothing = await recognize([dish('未知菜品 (图片无法识别)')])
check('占位名不会被当成一道菜', nothing.items.length === 0, `${nothing.items.length} 项`)
check('模型的回答原话被带出来', nothing.noDishReason === '未知菜品 (图片无法识别)', String(nothing.noDishReason))
check('不塞进 unmatched 让用户去修正面板里找', (nothing.unmatched ?? []).length === 0)
/**
 * 这一条是**不能抛错**那一条:抛出去会让 plate.ts 降级成随机组菜,
 * 结果页就会说「以下菜品为演示数据」—— 可模型明明看过这张图了。
 */
check('**不降级成本地演示数据**', nothing.engine === 'agent' && !nothing.degradedReason)

// ② 真菜里混了个占位名 —— 保留认得出的,不当成一道菜
const mixed = await recognize([dish('未知菜品'), dish('米饭')])
check('混合时保留认得出的菜', mixed.items.some((i) => i.foodId === 'rice'), JSON.stringify(mixed.items))
check('混合时丢掉占位名', !JSON.stringify(mixed.items).includes('未知'), JSON.stringify(mixed.items))
check('混合时不说「没认出菜品」', mixed.noDishReason === undefined, String(mixed.noDishReason))

// ③ 正常一条 —— 确认这一节没有把好路径改坏
const normal = await recognize([dish('米饭'), dish('清炒西兰花')])
const matchedIds = normal.items.map((i) => i.foodId)
check('正常菜名照旧匹配食物库', matchedIds.includes('rice') && matchedIds.length === 2, matchedIds.join('/'))
check('正常结果不带任何「没认出」的说明', normal.noDishReason === undefined)

/* ============================================================
   真实阶段 —— 让「分析中」那一屏有东西可说
   ------------------------------------------------------------
   Dify 每个节点的开始/结束都会推 `node_started` / `node_finished`,而
   `api/_lib/agent.ts` **原样透传**(那段「必须不解析、不缓冲」的注释是对的)。
   问题是 `runRecognition` 那个循环一直只认 message / error,其余静默丢弃 ——
   于是界面上那十来秒只有一个不动的转圈。

   这一节测的就是那根线接上没有。它只能在这里测:阶段的**渲染**在
   verify-render 里断(首帧 = 压缩),**词表与节点映射**在 verify-loop 第 9 节
   断(对着 yml 逐个数),而「事件真的走到了回调」只有喂一段真 SSE 才看得见。
   ============================================================ */
console.log('\n=== 真实阶段 ===')

const { ANALYZE_STAGE_LABELS } = await server.ssrLoadModule('/src/lib/analyzeStage.ts')

/** 一串事件 → SSE 原文 */
const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')

/** 一个节点开始了。`node_id` 在这儿没人读,但真实事件里有,照抄形状 */
const nodeStarted = (title) => ({ event: 'node_started', data: { title, node_id: 'n', status: 'running' } })

/** 那条正常回答(和上面 `recognize()` 里裹的是同一份) */
const answerOf = (dishes) => ({
  event: 'message',
  answer: JSON.stringify({
    blocked: false,
    risk: { level: 'low', message: '', items: [] },
    result: { mode: 'plate', title: '午餐复盘', dishes, advice: [], disclaimer: '' },
  }),
})

/** 跑一遍识别,把回调收到的阶段按顺序收集起来 */
async function stagesOf(events, { withCallback = true } = {}) {
  upstream = sse(events)
  const got = []
  const meal = await runRecognition({
    image: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
    slot: '午餐',
    profile: appState.profile,
    meals: appState.meals,
    ...(withCallback ? { onStage: (s) => got.push(s) } : {}),
  })
  return { got, meal }
}

/*
 * ① 真实拓扑序。断言的是**回调收到的序列**,不是「回调被调用过」——
 * 只验后者的话,把事件顺序接到两个错的阶段上也照样绿。
 *
 * 这里刻意把 `搜索转文本` 和 `营养折算` 都塞进去:它们和 `Bocha Web Search`
 * 同属「联网查营养」一档,连着跑三个节点**不该**报三次。
 */
const forward = await stagesOf([
  nodeStarted('用户输入'),
  nodeStarted('代码执行'),
  nodeStarted('知识检索'),
  nodeStarted('LLM'),
  nodeStarted('抽取库外菜'),
  nodeStarted('有没有库外菜'),
  nodeStarted('Bocha Web Search'),
  nodeStarted('搜索转文本'),
  nodeStarted('营养折算'),
  nodeStarted('合并营养'),
  nodeStarted('代码执行 2'),
  nodeStarted('直接回复'),
  answerOf([dish('米饭')]),
])
check(
  '阶段按真实节点依次报出来',
  forward.got.join(',') === 'guide,recognize,search,assemble',
  forward.got.map((s) => ANALYZE_STAGE_LABELS[s]).join(' → ') || '(一次都没报)'
)
check('  顺带确认这条链路的菜照常匹配(回调没有打断主流程)', forward.meal.items.some((i) => i.foodId === 'rice'))

/*
 * ② 单调性。`node_started` 不保证按拓扑序到达(分支、重试、传输层错序),
 * 而**回退**在屏幕上就是「明明显示到第四步了,又跳回第二步」。
 *
 * 喂法:把 `知识检索` 挪到 `LLM` **之后**。它该被整条丢掉 ——
 * 序列里不许出现第二个 guide,也不许在 recognize 之后回到 guide。
 */
const late = await stagesOf([
  nodeStarted('LLM'),
  nodeStarted('知识检索'),
  nodeStarted('合并营养'),
  answerOf([dish('米饭')]),
])
check(
  '**晚到的旧节点不会把进度拽回去**',
  late.got.join(',') === 'recognize,assemble',
  late.got.map((s) => ANALYZE_STAGE_LABELS[s]).join(' → ') || '(一次都没报)'
)
const rank = ['compress', 'upload', 'guide', 'recognize', 'search', 'assemble']
const monotone = late.got.every((s, i) => i === 0 || rank.indexOf(s) > rank.indexOf(late.got[i - 1]))
check('  序列本身严格递增(逐项比对,不只是看首尾)', monotone, late.got.join(','))

/*
 * ③ 认不出的节点名**什么都不做**。Dify 里加一个节点是上游的事,客户端猜错
 * 比不动更糟 —— 猜错的表现是屏幕上冒出一句和工作流无关的话。
 */
const unknown = await stagesOf([nodeStarted('将来新加的节点'), answerOf([dish('米饭')])])
check('认不出的节点名不触发回调(也不当成空阶段)', unknown.got.length === 0, unknown.got.join(',') || '(正确地什么都没报)')

/*
 * ④ 不传回调 —— 对话那条路根本不经过 `runRecognition`,而这一节的所有断言
 * 都得先证明「加了个可选参数没有把老路径改坏」。
 */
const noCb = await stagesOf([nodeStarted('LLM'), answerOf([dish('米饭')])], { withCallback: false })
check('不传 onStage 时整条链路照常跑通', noCb.meal.items.some((i) => i.foodId === 'rice'), JSON.stringify(noCb.meal.items))

/*
 * ⑤ 过敏拦截那条分支**不经过 LLM** —— 图上是
 * `代码执行 → 条件分支 →(true) 直接回复 2`,所以只会报一个 assemble。
 * 这一条挡的是「按时间硬切阶段」那种写法:它会在没有识别的情况下
 * 也让「正在识别菜品」走一遍。
 *
 * ⚠️ 这里必须喂一条**真的拦截回答**(`blocked: true`),不能图省事喂
 * `answerOf([])` —— 空菜品清单走的是另一条路,`runRecognition` 会当成
 * 「工作流配错了」直接抛错(那是刻意的,见它里面那段 Vision 开关的说明),
 * 于是这条断言测的就不是拦截分支了。
 */
const blockedAnswer = {
  event: 'message',
  answer: JSON.stringify({
    blocked: true,
    risk: { level: 'high', message: '宫保鸡丁常含花生，与你的过敏原冲突。', items: ['花生'] },
  }),
}

const intercepted = await stagesOf([
  nodeStarted('代码执行'),
  nodeStarted('条件分支'),
  nodeStarted('直接回复 2'),
  blockedAnswer,
])
check(
  '拦截分支不谎称「正在识别菜品」',
  !intercepted.got.includes('recognize') && intercepted.got.includes('assemble'),
  intercepted.got.map((s) => ANALYZE_STAGE_LABELS[s]).join(' → ') || '(一次都没报)'
)
check('  确认这一跑真的走了拦截(不是悄悄走了别的分支)', intercepted.meal.agentReply?.blocked === true)

/* ============================================================
   节点失败 —— 要说得出是**哪个**节点
   ------------------------------------------------------------
   Dify 把节点失败报成 `node_finished` + `status: 'failed'`。这条事件原来被
   整个循环丢掉了,于是「`营养折算` 炸了」在界面上表现成:

       识别失败（模型没有返回任何内容），本次为演示数据

   **那句话把人引向完全错误的方向** —— 它暗示模型答了但答得不对,而实际上
   多半是某个节点在模型之前(或之后)就炸了,模型根本没参与。按前者去查提示词
   和 Vision 开关能查一下午;按后者去看 Dify 的节点日志,五分钟。
   ============================================================ */
console.log('\n=== 节点失败 ===')

/** 一个节点失败了 */
const nodeFailed = (title, error) => ({
  event: 'node_finished',
  data: { title, status: 'failed', error },
})

/** 跑一遍,把抛出来的异常拿回来(不抛就返回 null) */
async function failureOf(events) {
  upstream = sse(events)
  try {
    await runRecognition({
      image: new Blob([new Uint8Array(8)], { type: 'image/jpeg' }),
      slot: '午餐',
      profile: appState.profile,
      meals: appState.meals,
    })
    return null
  } catch (err) {
    return err
  }
}

const broke = await failureOf([
  nodeStarted('知识检索'),
  nodeStarted('LLM'),
  nodeFailed('营养折算', 'ValueError: could not convert string to float'),
])
check(
  '**失败时说得出是哪个节点**(不是「模型没有返回任何内容」)',
  broke?.message === '节点「营养折算」执行失败',
  broke?.message ?? '(居然没抛错)'
)
check('  上游那段英文异常不糊到用户脸上', !String(broke?.message).includes('ValueError'))

/** 把 console.warn 截下来 —— 「细节进 console」这件事也得有人盯着 */
async function warningsWhile(promise) {
  const real = console.warn
  const lines = []
  console.warn = (...a) => lines.push(a.map(String).join(' '))
  try {
    await promise
  } finally {
    console.warn = real
  }
  return lines
}

/*
 * ⚠️ 上一条**必须**配这一条:光断言「失败时提节点」的话,把判据写成
 * 「只要出现过 failed 就抛」也能通过 —— 而那会把本来能出结果的跑法打死。
 * 工作流是有兜底分支的(`合并营养` 对空输入是容忍的),有的节点失败无害。
 */
const harmless = [nodeStarted('LLM'), nodeFailed('Bocha Web Search', 'timeout: 30s'), answerOf([dish('米饭')])]
const recovered = await failureOf(harmless)
check('**有节点失败但回答照常拿到时,不许报错**', recovered === null, recovered?.message ?? 'ok')

/*
 * 但那条失败**也不能就这么没了** —— 用户看不到它(结果是好的),开发者总得
 * 看得到,否则「联网那条分支悄悄退化成只用食物库」这种事永远没人发现。
 * 这一条盯的就是「细节进 console」那半句真的接上了。
 */
const warned = await warningsWhile(failureOf(harmless))
check(
  '  同一次失败的细节仍然进了 console(用户看不到,开发者看得到)',
  warned.some((l) => l.includes('Bocha Web Search') && l.includes('timeout: 30s')),
  warned.join(' ｜ ') || '(console.warn 一次都没响 → 这条失败被彻底吞掉了)'
)

/*
 * 没失败、也没回答 —— 文案得退回到原来那句。这条是防「新判据把老路径
 * 一起改了口径」:那时候报「节点…失败」就是凭空捏造一个不存在的节点。
 */
const silent = await failureOf([nodeStarted('LLM')])
check('没失败也没回答时,仍然是「模型没有返回任何内容」', silent?.message === '模型没有返回任何内容', silent?.message ?? '(居然没抛错)')

/* 名字缺失时不许把这条失败整个吞掉,也不许编一个名字 */
const nameless = await failureOf([
  { event: 'node_finished', data: { status: 'failed', error: 'boom' } },
])
check('节点名缺失时给个不撒谎的兜底(不是静默丢掉)', nameless?.message === '节点「未命名节点」执行失败', nameless?.message ?? '(居然没抛错)')

/* ============================================================
   ④ 模型从食物库目录里挑 foodId —— 提示词加目录的那条路
   ------------------------------------------------------------
   这是**唯一**能证明「提示词里加了目录真的生效」的一段测试,因为这条字段
   在客户端要穿过三层,任何一层漏掉,表现都是**改了提示词但什么都没发生**:

       SSE → parseAgentReply(映射)  → matchDishes(有就用)
                 ↑ 丢掉过一次            ↑ 也丢掉过一次

   直接调 matchDishes 测不出这个 —— verify-loop 里那两条「模型报的合法
   foodId 直接用 / 编的 foodId 被拒」两条都一直是绿的,而那条路根本走不通。
   ============================================================ */
console.log('\n=== 模型自己挑 foodId ===')

/**
 * 库里没有的名菜 —— 名字怎么匹配都落不到任何一条,只能靠 foodId。
 * 用「黑椒牛柳」不行(我给它加了别名),所以挑一个**故意没有别名**的:
 * 「土豆炖牛肉」是刻意留的落空项(见 dishMatch 里 DISH_ALIASES 的注释)。
 */
const ID_ONLY = '土豆炖牛肉'

const withId = await recognize([{ ...dish(ID_ONLY), foodId: 'braised-beef' }])
check(
  '模型挑的 foodId 穿到了匹配层(名字匹配不到也照样进库)',
  withId.items.some((i) => i.foodId === 'braised-beef'),
  JSON.stringify(withId.items),
)
check('挑了 foodId 就不再是「按 0 计」', (withId.unmatched ?? []).length === 0, JSON.stringify(withId.unmatched))
check('展示的名字仍然是模型说的那个', withId.items[0]?.name === ID_ONLY, String(withId.items[0]?.name))

// 编一个不存在的 id:必须退回按名字匹配,而不是变成一条静默的 0
const bogus = await recognize([{ ...dish('米饭'), foodId: 'rice-typo-xxx' }])
check('编造的 foodId 被拒、退回按名字匹配', bogus.items[0]?.foodId === 'rice', JSON.stringify(bogus.items))

// 克数:数字与字符串两种写法
const gramsNum = await recognize([{ ...dish('米饭'), grams: 200 }])
check('模型给的数字克数被采用', gramsNum.items[0]?.grams === 200, String(gramsNum.items[0]?.grams))
const gramsStr = await recognize([{ ...dish('米饭'), grams: '150g' }])
check('模型给的字符串克数也能解析', gramsStr.items[0]?.grams === 150, String(gramsStr.items[0]?.grams))
const gramsBad = await recognize([{ ...dish('米饭'), grams: '约一碗' }])
check('解析不出的克数退回食物库默认值(而不是 0)', gramsBad.items[0]?.grams === 150, String(gramsBad.items[0]?.grams))

// 没给这两个字段时,行为和以前完全一样
const noFields = await recognize([dish('米饭')])
check('两个字段都不给时行为不变', noFields.items[0]?.foodId === 'rice' && noFields.items[0]?.grams === 150,
  JSON.stringify(noFields.items[0]))

/* ============================================================
   ⑤ 库外菜的联网营养 —— 也是三层,而且中间那层最容易漏
   ------------------------------------------------------------
   `per100g` / `source` 从 SSE 到结果页要穿过**同一批**三层:

       SSE → parseAgentReply(映射) → recognizeAgent(转交) → matchDishes(有就用)
                 ↑ 第 2 层                   ↑ 第 3 层

   第 3 层(`recognizeAgent.ts` 里那个 `named.map(...)`)最容易被忘:它不做任何
   判断、只是搬运,漏了不报错,而它两头的单元测试**各自都是绿的**
   (agentReply 有自己的解析断言,dishMatch 有自己的匹配断言)。
   上一轮 foodId 就是这么丢的,所以这一节走的是**端到端**。

   断言里那句「不是按 0 计」写成 `isUnmatchedId(...) === false` 而不是看文案 ——
   文案会改,前缀是契约。
   ============================================================ */
console.log('\n=== 库外菜的联网营养 ===')

const { WEB_BASE_GRAMS, isUnmatchedId, isWebId } = await server.ssrLoadModule('/src/lib/dishMatch.ts')

/** 一道联网查到营养的菜 —— `per100g` 是 Dify 那个「合并营养」节点会给出的形状 */
const WEB_DISH = '土豆炖牛肉'
const webNutrition = { kcal: 168, protein: 12.5, carb: 6, fat: 9.8, sodium: 430, sugar: 1.2 }
const webDish = { ...dish(WEB_DISH), per100g: webNutrition, source: '薄荷健康' }

const withWeb = await recognize([webDish])
check(
  'per100g 穿到了匹配层(菜名匹配不到也照样有营养)',
  withWeb.items[0]?.foodId === `web:${WEB_DISH}`,
  JSON.stringify(withWeb.items),
)
check(
  '**它不是「按 0 计」那一类**',
  isWebId(withWeb.items[0].foodId) && !isUnmatchedId(withWeb.items[0].foodId),
  String(withWeb.items[0]?.foodId),
)
check('不进 unmatched(否则结果页会对着真数字说按 0 计)', (withWeb.unmatched ?? []).length === 0,
  JSON.stringify(withWeb.unmatched))
check('每 100g 值原样带到条目上', withWeb.items[0]?.per100g?.kcal === 168, JSON.stringify(withWeb.items[0]?.per100g))
check('出处也带到了(界面那句「来自联网检索(薄荷健康)」靠它)', withWeb.items[0]?.source === '薄荷健康',
  String(withWeb.items[0]?.source))
check(`克数落到基准 ${WEB_BASE_GRAMS}g`, withWeb.items[0]?.grams === WEB_BASE_GRAMS, String(withWeb.items[0]?.grams))

/**
 * **库内优先** —— 同一个字段给了两种来源,必须信食物库那条。
 * 断言的是「两个键**不存在**」而不是「值不对」:条件展开的契约是键不出现,
 * 留着 `per100g: undefined` 会让下游的 `'per100g' in item` 判断失真
 * (同这个文件里 foodId 那条)。
 */
const libWins = await recognize([
  { ...dish('米饭'), per100g: { kcal: 999, protein: 1, carb: 1, fat: 1, sodium: 1, sugar: 1 }, source: '瞎编的网页' },
])
check('库里命中时**不受**联网值影响', libWins.items[0]?.foodId === 'rice', String(libWins.items[0]?.foodId))
check('库里命中时两个键都不出现', !('per100g' in libWins.items[0]) && !('source' in libWins.items[0]),
  JSON.stringify(libWins.items[0]))

/**
 * 四连拒收 —— **不认这个 per100g,就退回哨兵项**,而不是把这道菜丢掉。
 * 「丢掉」会让结果页少一道菜且毫无提示:识别出来三道菜只显示两道,
 * 用户只会以为 App 漏看了。所以每条断言都同时看两件事:落回哨兵 + 菜还在。
 */
const bad = async (label, per100g, source = '薄荷健康') => {
  const r = await recognize([{ ...dish(WEB_DISH), per100g, ...(source === null ? {} : { source }) }])
  const it = r.items[0]
  check(
    `${label} → 退回未收录,但**菜还在**`,
    r.items.length === 1 && isUnmatchedId(it.foodId) && (r.unmatched ?? []).includes(WEB_DISH),
    `${r.items.length} 项 / ${it?.foodId} / unmatched=${JSON.stringify(r.unmatched)}`,
  )
}
await bad('缺一个键', { kcal: 168, protein: 12.5, carb: 6, fat: 9.8, sodium: 430 })
await bad('值是字符串', { ...webNutrition, kcal: '168' })
await bad('越上界(热量 1200)', { ...webNutrition, kcal: 1200 })
await bad('负值', { ...webNutrition, sodium: -1 })

// 出处为空 —— 没有出处的数字不许进计算
const blankSource = await recognize([{ ...dish(WEB_DISH), per100g: webNutrition, source: '   ' }])
check('出处是空白 → 同样退回未收录', isUnmatchedId(blankSource.items[0]?.foodId),
  `${blankSource.items[0]?.foodId} / per100g=${JSON.stringify(blankSource.items[0]?.per100g)}`)

/**
 * 组合名 + per100g **不拆** —— 那是**整份**的口径。
 * 拆了的话一份的营养会被当成三份各自一份,克数与营养一起翻三倍,而且不出声。
 */
const combo = await recognize([
  { ...dish('清蒸鱼 + 白灼西兰花 + 米饭'), per100g: webNutrition, source: '薄荷健康' },
])
check('带 per100g 的组合名不拆(整份口径)', combo.items.length === 1, `${combo.items.length} 项`)

/* ============================================================
   ⑤b 「慎选 + 理由」也要穿过同一批三层(2026-09-24)
   ------------------------------------------------------------
   和上面 foodId、per100g 是**同一条链路**、同一个坑:

       SSE → parseAgentReply(映射) → recognizeAgent(转交) → matchDishes(带上)
                 ↑ 一直没丢过            ↑ 就是在这里丢的

   用户 2026-09-24 第二次纠的原话:「可是显眼的高危提醒也没了,就算不单独写个提醒,
   起码也要**标红危险内容**吧」,随后定的是「在菜品那里把危险的字样和菜品标红」。
   而 `dishInputs` 那个纯搬运函数只挑了 name / foodId / grams / per100g / source
   —— 模型明说了「含花生」,卡片上那道菜和别的菜长得一模一样,一个字都不提。

   ⚠️ 这一段必须走**端到端**:`agentReply` 那边断自己解析对了、`dishMatch` 那边
   断自己匹配对了,**两头的单元测试各自都是绿的**,漏的正好是中间那一段。
   ============================================================ */
console.log('\n=== 慎选 + 理由穿过三层 ===')

const PEANUT = '花生拌菠菜'
const flagged = await recognize([{ ...dish('米饭'), suitable: false, reason: `含花生，你的档案里写着花生过敏` }])
check(
  '**模型标的慎选穿到了条目上**(从前在这一层被丢掉,屏上一声不响)',
  flagged.items[0]?.suitable === false,
  JSON.stringify(flagged.items[0]),
)
check(
  '  理由(要标红的那句「危险字样」)一字不差地跟到了条目上',
  flagged.items[0]?.reason === '含花生，你的档案里写着花生过敏',
  String(flagged.items[0]?.reason),
)

/**
 * 反方向:模型**没标慎选**时这两个键不许出现。
 *
 * ⚠️ 这道菜**带着理由**(「推荐」的菜也有理由:那是模型夸它的,不是警告)。
 * 拿一道没有理由的菜来断这一条是**空断言** —— 它会因为「本来就没理由」而通过,
 * 和「判据对不对」一点关系都没有(这个仓库踩过好几次:否定断言最容易假绿)。
 *
 * 断了「值不等于 false」也是不够的:`suitable: undefined` 这种残渣会让下游每处
 * 都得再判一次(同上面 foodId 那条:条件展开的契约是键不出现)。
 */
const markedNone = await recognize([{ ...dish('米饭'), reason: '糙米升糖慢，适合你' }])
check(
  '没标慎选时这两个键都不出现(不留 `suitable: undefined` 这种残渣)',
  !('suitable' in markedNone.items[0]) && !('reason' in markedNone.items[0]),
  JSON.stringify(markedNone.items[0]),
)

/**
 * 组合菜 —— 用户嘴里那个「进餐组合」。
 * 拆成两半之后**每一半都得继续带着慎选**:丢了的话屏幕上就是两行干净的菜,
 * 而那道菜里有花生这件事在这**一步**就没了(拆分发生在配菜层,不在渲染层)。
 */
const comboFlagged = await recognize([{ ...dish(`${PEANUT} + 米饭`), suitable: false, reason: '含花生' }])
check(
  '**组合拆开的每一半都还带着慎选 + 理由**',
  comboFlagged.items.length === 2 &&
    comboFlagged.items.every((i) => i.suitable === false && i.reason === '含花生'),
  JSON.stringify(comboFlagged.items),
)

/**
 * 归并 —— 两道菜落到同一个 foodId 合成一项。**低调的那个赢**:
 * 只要有一道被标了慎选,合并后那一项就得继续标红。反过来(后到的覆盖先到的)
 * 会让「有花生的那半」被「没有花生的那半」洗白,而屏幕上完全看不出来。
 */
const mergedFlagged = await recognize([{ ...dish('米饭') }, { ...dish('白米饭'), suitable: false, reason: '含花生' }])
check(
  '**两道菜合成一项时慎选不会被抹掉**(低调的那个赢,不是后到的赢)',
  mergedFlagged.items.length === 1 && mergedFlagged.items[0]?.suitable === false,
  JSON.stringify(mergedFlagged.items),
)
check('  理由也跟着那一项走', mergedFlagged.items[0]?.reason === '含花生', String(mergedFlagged.items[0]?.reason))

/* ============================================================
   ⑥ 对话页发图失败时,屏幕上那一句
   ------------------------------------------------------------
   原来是**一句写死的话**:「这次没读出来，换个角度再拍一张。」它把 `err`
   整个丢掉 —— 超时、限流、上游节点炸、格式不对,屏幕上长得一模一样,而且
   那句话让用户去**重拍照片**。

   代价实测过:2026-09-23 用户报「我发照片过去,说是没读出来」,拿着这句
   反推不出任何东西,只能把整条链路重新量一遍。所以现在如实带上原因。

   ⚠️ 下面第 5、6 条是**源码级**的,别嫌它们土:前四条全都在测
   `chatFailMessage` 这个函数本身,而**改了函数、那条路却没用它**的话,
   前四条一个字都不会红 —— 那种绿比没有断言更糟。
   ============================================================ */
console.log('\n=== 对话页发图的失败文案 ===')

const { AgentError } = await server.ssrLoadModule('/src/lib/dify.ts')
const { chatFailMessage, TIMEOUT_MS } = await server.ssrLoadModule('/src/store/recognizeOne.ts')

/** 超时那条:理由得是「等太久」,而不是把锅甩给照片 */
const timedOutMsg = chatFailMessage(new DOMException('aborted', 'AbortError'), true)
check('超时时那句说的是等太久,不是让用户去重拍照片', timedOutMsg.includes('等太久了') && !timedOutMsg.includes('换个角度'), timedOutMsg)
check(
  '  秒数是从上限那个常量来的(改上限时这句话跟着走)',
  /超过 \d+ 秒/.test(timedOutMsg) && timedOutMsg.includes(String(TIMEOUT_MS / 1000)),
  timedOutMsg
)

/** 限流:服务端那句本来就是给人看的,原样带出来 */
const rateMsg = chatFailMessage(new AgentError('RATE_LIMITED', '请求过于频繁，请 12 秒后重试。'), false)
check('限流时把服务端那句话带上了屏', rateMsg === '这次没读出来：请求过于频繁，请 12 秒后重试。', rateMsg)

/** 上游节点炸了:得说得出是哪个节点,而且不许让用户去重拍照片 */
const nodeMsg = chatFailMessage(new AgentError('UPSTREAM_ERROR', '节点「营养折算」执行失败'), false)
check(
  '上游节点炸了时带上了节点名,不再让人重拍照片',
  nodeMsg.includes('节点「营养折算」执行失败') && !nodeMsg.includes('换个角度'),
  nodeMsg,
)

/** 拿不到人话时:给一句不撒谎的兜底,不许把「换一张」摆上去 */
const blankMsg = chatFailMessage(undefined, false)
check('拿不到原因时给一句不撒谎的兜底', blankMsg === '这次没读出来：出了个意外，直接重试一次。', blankMsg)

/** 模型答的不是格式 —— 那句开发者话不许上屏(它会叫用户去干他干不了的事) */
const unparsed = await failureOf([nodeStarted('LLM'), { event: 'message', answer: '好的，我看看这张图。' }])
check(
  '模型答的不是能识别的格式时,不再叫用户去「确认工作流输出格式」',
  unparsed?.message === '模型答的不是能识别的格式',
  unparsed?.message ?? '(居然没抛错)',
)

/** 源码级:那条路真的用了它,而不是留着旧的写死文案 */
const roSrc = readFileSync('src/store/recognizeOne.ts', 'utf8')
check('对话那条路真的调了 chatFailMessage(不是留着一句写死的)', /message:\s*chatFailMessage\(/.test(roSrc))
/*
  ⚠️ 判据是「有没有把它当**文案**写死」,不是「文件里有没有这几个字」——
  上面那段解释为什么改的注释里**原样引了**那句旧文案,拿 `includes` 去查
  它永远为真。(第一版就是这么写的,当场红了。)
*/
check(
  '  那句「换个角度再拍一张」不再被当成文案写死在这条路上',
  !/message:\s*['"`][^'"`]*换个角度/.test(roSrc),
)

/* ============================================================
   ⑦ 两个墙钟是一对 —— 客户端必须先放弃
   ------------------------------------------------------------
   2026-09-23 那次超时牵出来的一件事:`src/store/recognizeOne.ts` 的
   `TIMEOUT_MS` 和两条端点的 `maxDuration` 是**一对数**,而当时那一对是坏的
   —— 客户端 45 秒,`/api/chat-messages` 只有 30 秒。

   本地 dev server **不执行** Vercel 的 `maxDuration`,所以这一条在本地怎么
   量都量不出来,线上却是**发图必挂**:平台先把函数掐掉,前端拿到的是一句
   语焉不详的网络错误,而不是「等太久了」这句人话。

   下面是那条不变量本身。它是**跨文件**的,任何一边单独改都拦得住。
   ============================================================ */
console.log('\n=== 两个墙钟是一对 ===')

const budgetOf = (file) => Number(/maxDuration:\s*(\d+)/.exec(readFileSync(file, 'utf8'))?.[1])
const chatBudget = budgetOf('api/chat-messages.ts')
const plateBudget = budgetOf('api/recognize.ts')

check(
  '客户端墙钟小于线上服务端的预算(否则平台先掐,拿到的不是人话)',
  TIMEOUT_MS / 1000 < chatBudget,
  `客户端 ${TIMEOUT_MS / 1000}s / chat-messages ${chatBudget}s`,
)
check(
  '发图那条和拍餐盘那条拿到同样的预算(两条干的是同一种活)',
  chatBudget === plateBudget,
  `chat-messages ${chatBudget}s / recognize ${plateBudget}s`,
)

globalThis.fetch = realFetch

await server.close()

console.log(failures === 0 ? '\n全部通过\n' : `\n${failures} 项失败\n`)
process.exit(failures === 0 ? 0 : 1)
