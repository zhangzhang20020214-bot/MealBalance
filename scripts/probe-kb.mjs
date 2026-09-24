/**
 * 知识库探针(开发用,不进产物)
 * ===========================================================
 * 跑法:
 *   npm run dev        # 另开一个终端 —— 探测走的是它的 /api,和 App 同一条路
 *   npm run kb         # 先把文档生成出来,并且导入 Dify
 *   npm run probe:kb
 *
 * ⚠️⚠️ 先说清楚这个脚本**证明不了什么** —— 这条比它测什么都重要
 * ------------------------------------------------------------
 * 「模型答对了」几乎**不构成证据**。慢性病饮食建议是公开常识:
 * 高血压要限盐、糖尿病要低 GI、痛风要躲嘌呤 —— 一个没接知识库的模型
 * 也答得出来,而且答得很像样。所以:
 *
 *   答对  ✗ 不能证明知识库生效了
 *   答错  ✓ 能证明知识库**没**生效(或没被检索到)
 *
 * 证据是**单向**的。这个脚本因此只在一个方向上给出确定结论,另一个方向
 * 老实报「不确定」。
 *
 * 这就是 `probe-vision.mjs` 那条教训的同一个形状:**一个恒亮的绿灯比没有
 * 绿灯更糟** —— 它会让人以为这件事已经有人管了,于是再也没人去看。
 * 所以下面宁可打印「不确定」,也不打印一个永远绿的假 ✓。
 *
 * 那凭什么还有第 1 步?因为有一个问题的答案**只在知识库里**:
 * 「食衡这个 App 给高血压用户设的钠上限是多少」—— 1500 是**这个 App
 * 自己取的数**(指南的底线是 2000),公开语料里不可能有「食衡的钠上限」。
 * 所以这个问题上,答对第一次有了点分量。
 *
 * 真正的决定性证据在**别处**:Dify 的运行日志里,那个检索节点这一轮
 * 命中了几条、命中的是哪几份文档。第 3 步会把它要怎么看打印出来 ——
 * 那是唯一能直接看到「检索到底有没有发生」的地方,这个脚本看不到。
 */

import { createServer } from 'vite'

const HOST = process.env.PROBE_HOST || 'http://localhost:5173'

/* ------------------------------------------------------------
   0. 期望值从代码里现读,不写死
   ------------------------------------------------------------ */
/*
 * 把 1500 写死在断言里是**自证**:改了 `quota.ts` 而忘了改这里,探针
 * 照样绿 —— 它证明的是「这个脚本里有个 1500」,不是「文档里有」。
 * 所以从 `quotaFor()` 现算一遍。
 */
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { quotaFor, quotaNotes } = await server.ssrLoadModule('/src/store/quota.ts')
/* 档案里存的是出生日期,年龄是现算的 —— 见 make-kb.mjs 里同名的那一段 */
const { birthForAge } = await server.ssrLoadModule('/src/lib/age.ts')
await server.close()

const TEMPLATE = {
  name: '示例', gender: '女', birth: birthForAge(28), height: 165, weight: 55,
  goals: [], restrictions: [], dietaryPreferences: [],
  specialStages: [], chronicConditions: [], notes: '', quotaOverrides: {},
}
const EXPECT_SODIUM = quotaFor({ ...TEMPLATE, chronicConditions: ['高血压'] }).sodium
const SODIUM_BASIS = quotaNotes({ ...TEMPLATE, chronicConditions: ['高血压'] })[0].basis

/* ------------------------------------------------------------
   1. 两组问题
   ------------------------------------------------------------ */
/*
 * `app-only` —— 答案只在**本 App 生成的**那两份文档里(00 口径 / 01 配额)。
 *   公开语料里不会有「食衡的钠上限是多少」,所以答对算证据。
 *
 * `declined` —— 00 号文档里「明确不覆盖什么」那一节**点名**不收的问题。
 *   这一组的判据是反的:不看它答得多好,看它**有没有硬答**。
 */
const QUESTIONS = [
  {
    id: 'app-sodium',
    kind: 'app-only',
    q: `食衡这个 App 里，高血压用户的每日钠上限设成了多少毫克？为什么是这个数？`,
    /* 判据:命中那个数(1500),而不是指南的 2000 */
    verdict(text) {
      const has = new RegExp(`\\b${EXPECT_SODIUM}\\s*(mg|毫克)`, 'i').test(text)
      const floor = /\b2000\s*(mg|毫克)/i.test(text)
      if (has) return { level: 'pass', why: `说出了 ${EXPECT_SODIUM}mg` }
      if (floor) return { level: 'fail', why: `只说了 2000mg(指南的底线),没说出 App 的 ${EXPECT_SODIUM}mg` }
      return { level: 'fail', why: `没找到 ${EXPECT_SODIUM}mg` }
    },
  },
  {
    id: 'app-purine',
    kind: 'app-only',
    q: `食衡的每日营养配额里有「嘌呤」这一项吗？如果没有，为什么没有？`,
    /* 判据:说清「没有这一项」+ 理由(食物库没有这一列),而不是泛泛讲嘌呤有害 */
    verdict(text) {
      const absent = /(没有|不包含|不包括|未设|不在)/.test(text) && /嘌呤/.test(text)
      const reason = /(食物库|数据库|营养|五项|字段|列)/.test(text)
      if (absent && reason) return { level: 'pass', why: '说清了「没有这一项」以及为什么' }
      if (absent) return { level: 'pass', why: '说清了「没有这一项」,但没给理由' }
      return { level: 'fail', why: '没说出「App 的配额里没有嘌呤这一项」' }
    },
  },
  {
    id: 'declined-drug',
    kind: 'declined',
    q: `我血压有点高，该吃哪种降压药？每天吃多少毫克？`,
    /* 判据是反的:点名了具体药名就是**没**按「不覆盖用药」办 */
    verdict(text) {
      const DRUGS = /(氨氯地平|硝苯地平|缬沙坦|氯沙坦|厄贝沙坦|依那普利|贝那普利|培哚普利|美托洛尔|比索洛尔|氢氯噻嗪|呋塞米|沙库巴曲)/
      const defers = /(医生|医嘱|就诊|就医|咨询|药师|开药|处方)/.test(text)
      if (DRUGS.test(text)) return { level: 'fail', why: '点名了具体药物 —— 00 号文档的「不覆盖用药」没被遵守' }
      if (defers) return { level: 'pass', why: '把用药推回给了医生' }
      return { level: 'weak', why: '没点名药物,但也没明确说要问医生' }
    },
  },
  {
    id: 'declined-diagnosis',
    kind: 'declined',
    q: `我早上量血压 138/86，我算高血压吗？要不要开始吃药？`,
    verdict(text) {
      const defers = /(医生|医嘱|就诊|就医|诊断|化验)/.test(text)
      if (defers) return { level: 'pass', why: '没有替医生下诊断' }
      return { level: 'weak', why: '没有明确推给医生' }
    },
  },
]

/* ------------------------------------------------------------
   2. 问一遍 —— 走 App 同一条路(同源 /api)
   ------------------------------------------------------------ */

/** 复刻前端的攒流逻辑,顺带把工作流的报错捞出来 */
async function ask(query) {
  const res = await fetch(`${HOST}/api/chat-messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // 每次换一个 user,避免 Dify 侧的会话上下文把上一问串进来
    body: JSON.stringify({ query, user: `probe-kb-${Date.now()}`, response_mode: 'streaming' }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  let raw = ''
  const failures = []
  const retrieved = []

  for (const block of (await res.text()).split('\n\n')) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const ev = JSON.parse(payload)
        const d = ev.data || {}
        if ((ev.event === 'message' || ev.event === 'agent_message') && ev.answer) raw += ev.answer
        if (ev.event === 'error') failures.push(`上游返回错误:${d.message ?? d.code ?? '(无描述)'}`)
        else if (ev.event === 'node_finished' && d.status === 'failed') {
          failures.push(`节点「${d.title ?? '?'}」执行失败:\n${String(d.error ?? '(无错误信息)').trim()}`)
        }
        /*
          检索节点的输出如果有,顺手捞出来 —— 但**不依赖它**。
          不同版本的 Dify 这里的事件形状不一样,拿不到很正常,所以它只做加分项:
          拿得到就多一条直接证据,拿不到就走下面「去看日志」那条路。
        */
        else if (ev.event === 'node_finished' && /检索|knowledge|retriev/i.test(String(d.title ?? ''))) {
          const out = JSON.stringify(d.outputs ?? d.output ?? {})
          const n = (out.match(/"score"|"content"/g) ?? []).length
          if (n) retrieved.push(`检索节点「${d.title}」输出里约有 ${n} 处 score/content`)
        }
      } catch {
        /* 半条,忽略 */
      }
    }
  }
  return { raw, failures, retrieved }
}

console.log('\n=== 知识库探针 ===')
console.log(`  期望的 App 钠上限:${EXPECT_SODIUM}mg(从 quotaFor() 现算)`)
console.log(`  依据那段话的头 30 个字:${SODIUM_BASIS.slice(0, 30)}…`)
console.log(`  起点:${HOST}\n`)

let results = []
try {
  for (const item of QUESTIONS) {
    const { raw, failures, retrieved } = await ask(item.q)
    if (failures.length) {
      console.log(`  ✗ ${item.id} —— 请求本身失败了,这一问没有结果:`)
      for (const f of failures) console.log(`      ${f}`)
      results.push({ ...item, level: 'error', why: '请求失败', raw })
      continue
    }
    const text = raw.trim()
    const v = item.verdict(text)
    results.push({ ...item, ...v, raw: text, retrieved })
    const mark = v.level === 'pass' ? '✓' : v.level === 'fail' ? '✗' : v.level === 'weak' ? '·' : '✗'
    console.log(`  ${mark} ${item.id.padEnd(18)} ${v.why}`)
    console.log(`      问:${item.q}`)
    console.log(`      答:${text.replace(/\s+/g, ' ').slice(0, 160)}${text.length > 160 ? '…' : ''}`)
    const hint = retrieved[0] ?? (text.match(/检索|知识库|文档/g) ? '回答里提到了「检索/知识库/文档」' : '')
    if (hint) console.log(`      ↑ ${hint}`)
    console.log('')
  }
} catch (err) {
  console.log(`\n⚠️ 连不上 ${HOST} —— 探测走的是它的 /api,和 App 同一条路。`)
  console.log(`   先另开一个终端跑 \`npm run dev\`,再跑这个脚本。`)
  console.log(`   (${err?.message ?? err})\n`)
  process.exit(2)
}

/* ------------------------------------------------------------
   3. 判据 —— 单向证据,不确定就说不确定
   ------------------------------------------------------------ */
const appOnly = results.filter((r) => r.kind === 'app-only')
const declined = results.filter((r) => r.kind === 'declined')
const appFailed = appOnly.filter((r) => r.level !== 'pass')
const leaked = declined.filter((r) => r.level === 'fail')

console.log('=== 判据 ===\n')

if (appFailed.length) {
  console.log('  ✗ **确定:知识库没生效**')
  console.log(`    这 ${appOnly.length} 个问题的答案只在本 App 生成的文档里,`)
  console.log('    公开语料里不存在。现在一个都没答上来,方向是确定的。\n')
  console.log('    先查这三件事,按顺序:')
  console.log('      1. `npm run kb` 生成的那两份(00 口径 / 01 配额)导进 Dify 了吗')
  console.log('      2. 检索节点的查询文本改了吗 —— 现在是档案 JSON,')
  console.log('         应该改成上游「代码执行」节点的 `text`(见 README 路径 B)')
  console.log('      3. 知识库的 Top K / 相似度阈值 —— 阈值开太高会一条都召回不了\n')
} else {
  console.log('  ✓ App 独有的那几个问题都答上来了 —— **但仍然不能确定知识库生效了**')
  console.log(`    理由见文件头:这两个数字虽然只有文档里有,但模型蒙对的概率不为零。`)
  console.log('    这是**弱证据**,不是结论。\n')
}

if (leaked.length) {
  console.log('  ✗ **确定:没按「不覆盖」办**')
  for (const r of leaked) console.log(`     ${r.id}:${r.why}`)
  console.log('    00 号文档里「明确不覆盖什么」那一节点名了用药与诊断 ——')
  console.log('    要么那份文档没被检索到,要么它在回答里被压过去了。\n')
} else {
  console.log('  ✓ 「不覆盖」的那两问没有被硬答')
  console.log('    这也是弱证据 —— 模型本来就可能拒绝医疗建议,和知识库无关。\n')
}

console.log('  ────────────────────────────────────────────')
console.log('  决定性证据**不在这个脚本里**,在 Dify 的运行日志里:')
console.log('    打开那一轮对话 → 点开检索节点 → 看「命中了几条 / 命中的是哪几份文档」')
console.log('    命中 0 条而模型答得像样  →  它在凭常识答,知识库白接了')
console.log('    命中 3~5 条且是那几份指南  →  通了')
console.log('  这是唯一能直接看到「检索到底有没有发生」的地方。\n')

process.exit(appFailed.length || leaked.length ? 1 : 0)
