/**
 * Agent 契约探测(开发用,不进产物)
 * ===========================================================
 * 两件事,都是「不跑一遍就不知道」的:
 *
 *   1. **档案生效了吗** —— 用一对对照实验回答。见下面第 0 步。
 *   2. **前端还认得输出吗** —— 这个 agent 把一个 JSON 对象当回答文本吐出来,
 *      契约是模型自己选的。同一个问题两次可能返回不同的 mode
 *      (实测:同一条「午餐吃了红烧肉」第一次返回 plate,第二次返回 menu)。
 *
 * 所以:改了 Dify 里的 prompt、加了节点、换了模型之后,跑一下这个脚本。
 * 认不出不会白屏(会退回纯文本),但会变成一坨 JSON。
 *
 * 跑法:
 *   npm run dev                    # 另开一个终端,探测走的是它的 /api
 *   npm run probe                  # 用默认的一组问题
 *   npm run probe -- "红烧肉咸吗"   # 只问指定的问题
 *   PROBE_FULL=1 npm run probe     # 打印发给 agent 的完整 JSON
 *
 * 注意:这里**始终**按「档案已接通」的方式发 JSON query,不管 App 里
 * SEND_PROFILE_TO_AGENT 是开是关 —— 这个脚本的用途就是提前验证上游改好没有。
 * App 默认发的仍是纯文本,等这里全绿了再去改那个开关。
 */

import { createServer } from 'vite'

const HOST = process.env.PROBE_HOST || 'http://localhost:5173'

/** 覆盖四种 mode —— 前端的每条渲染路径都该被试到 */
const DEFAULT_QUERIES = [
  '我午餐吃了红烧肉和米饭，有点咸，晚餐怎么安排？',
  '帮我看看红烧排骨这道菜',
  '膳食纤维有什么作用？',
  '给我一份三天控盐食谱',
]

const queries = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_QUERIES

let unusable = 0

let session = 0
/**
 * 复刻前端的攒流逻辑 —— 探测的必须是前端真正会拿到的那串文本。
 *
 * 除了文本,还要把**工作流的报错**捞出来。这一步不是锦上添花:
 * 节点代码里一个缩进错就会让整个工作流在第 2 步就失败,流水线上一个
 * message 事件都不会有 —— 只收文本的话,这里看到的是「返回了空字符串」,
 * 而真正的原因(哪个节点、什么错)全被吞掉了,只能靠人再去翻 Dify 的日志。
 */
async function fetchRaw(query) {
  const res = await fetch(`${HOST}/api/chat-messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // 每次换一个 user,避免 Dify 侧的会话上下文把上一问的档案串进来
    body: JSON.stringify({ query, user: `probe-${Date.now()}-${session++}`, response_mode: 'streaming' }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  let raw = ''
  const failures = []

  for (const block of (await res.text()).split('\n\n')) {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const ev = JSON.parse(payload)
        const d = ev.data || {}
        if ((ev.event === 'message' || ev.event === 'agent_message') && ev.answer) raw += ev.answer

        if (ev.event === 'error') {
          failures.push(`上游返回错误:${d.message ?? d.code ?? '(无描述)'}`)
        } else if (ev.event === 'node_finished' && d.status === 'failed') {
          // 最有信息量的一条:它点名是哪个节点、报了什么错
          failures.push(`节点「${d.title ?? '?'}」执行失败:\n${String(d.error ?? '(无错误信息)').trim()}`)
        } else if (ev.event === 'workflow_finished' && d.status && d.status !== 'succeeded') {
          // 节点已经报过就不再重复一遍 —— 那两段堆栈是同一份
          if (failures.length === 0) failures.push(`工作流未成功结束:${d.status}`)
        }
      } catch {
        /* 半条,忽略 */
      }
    }
  }
  return { raw, failures }
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { parseAgentReply } = await server.ssrLoadModule('/src/lib/agentReply.ts')
const { buildAgentQuery } = await server.ssrLoadModule('/src/lib/agentContext.ts')
const store = await server.ssrLoadModule('/src/store/store.ts')

const state = store.getSnapshot()
const profile = state.profile

/** 和 App 用的是同一个构造函数 —— 探测的必须是真正会发出去的那段 JSON */
const jsonQuery = (text) => buildAgentQuery(profile, state.meals, { text })

/** 问一次,返回原文、解析结果和上游报错;解析不了时 reply 为 null */
async function ask(queryText) {
  const { raw, failures } = await fetchRaw(jsonQuery(queryText))
  return { raw, failures, reply: parseAgentReply(raw) }
}

/** 工作流炸了的时候,这里才是真正的原因 —— 打印在「解析不了」旁边 */
function reportFailures(failures, indent = '     ') {
  if (failures.length === 0) return
  console.log(`${indent}工作流报错:`)
  for (const f of failures) {
    for (const line of f.split('\n')) console.log(`${indent}  ${line}`)
  }
}

const restriction = profile.restrictions[0]
if (!restriction) {
  console.log('\n档案里没有任何忌口,第 0 步的对照实验做不了。先在 defaults.ts 里配一条。\n')
  await server.close()
  process.exit(1)
}

const ALLERGEN = restriction.item

/* ============================================================
   第 0 步:档案到底有没有被工作流读进去
   ------------------------------------------------------------
   用一对对照实验,把「agent 读到了我的档案吗」从要靠语气猜的事
   变成是非题。两句都发**结构化 JSON**,也就是档案已经送到的前提。

     对照 A(负):「晚餐吃什么好？」
        这句话里没有「花生」二字。正常应该给出建议。
        若返回已拦截 → 节点 7 在扫 advice 全文,把「避免花生」
        这条正确建议当成了命中。

     对照 B(正):明说刚吃了含花生的菜。
        应该被拦。这一条不拦,问题就不是误拦,是拦截压根没生效。

   A 拦了 / B 没拦,都是坏消息,而且指向不同的地方。
   ============================================================ */

console.log(`\n=== 第 0 步:档案生效了吗(档案忌口:${restriction.item} / ${restriction.type} / ${restriction.level})===`)

const NEGATIVE = '晚餐吃什么好？'
const POSITIVE = `我午餐吃了宫保鸡丁，里面有${ALLERGEN}`

let negativeBlocked = null
let positiveBlocked = null

try {
  const a = await ask(NEGATIVE)
  negativeBlocked = a.reply?.blocked ?? null
  if (a.reply === null) {
    console.log(`  ? 对照 A 拿不到有效回复 —— 「${NEGATIVE}」`)
    reportFailures(a.failures)
    if (a.raw) console.log(`    原文前 160 字:${a.raw.slice(0, 160)}`)
  } else
    console.log(
      `  ${a.reply.blocked ? '✗' : '✓'} 对照 A(不该拦)${a.reply.blocked ? '被拦截了' : '正常给了建议'} —— 「${NEGATIVE}」`
    )

  const b = await ask(POSITIVE)
  positiveBlocked = b.reply?.blocked ?? null
  if (b.reply === null) {
    console.log(`  ? 对照 B 拿不到有效回复 —— 「${POSITIVE}」`)
    reportFailures(b.failures)
    if (b.raw) console.log(`    原文前 160 字:${b.raw.slice(0, 160)}`)
  } else
    console.log(
      `  ${b.reply.blocked ? '✓' : '✗'} 对照 B(该拦)${b.reply.blocked ? '已拦截' : '**没拦住**'} —— 「${POSITIVE}」`
    )
} catch (err) {
  console.log(`  ✗ 请求失败:${err.message}`)
  console.log('     开发服务器起了吗?没配 Key 的话 /api/status 会返回 unavailable。')
}

console.log('')

if (negativeBlocked === true) {
  console.log('  ✗ 节点 7 还在扫 advice 全文 —— 「避免花生」这种正确建议被当成了命中。')
  console.log('    这是必须修的:现在打开 App 的 SEND_PROFILE_TO_AGENT,')
  console.log('    用户问什么都会被拦。改法见 README「让 agent 读到你的健康档案」。')
} else if (negativeBlocked === false && positiveBlocked === false) {
  console.log('  ✗ 该拦的没拦住 —— 档案可能没进到工作流的 profile 里。')
  console.log('    检查节点 2 是不是真的在 json.loads(sys.query),以及')
  console.log('    healthRestrictions 的 item / severity 口径(见 agentContext.ts 文件头)。')
} else if (negativeBlocked === false && positiveBlocked === true) {
  console.log('  ✓ 两层拦截都对:该拦的拦了,该放行的放行了。可以打开 SEND_PROFILE_TO_AGENT 了。')
} else {
  console.log('  ? 对照没跑全,先把上面的请求失败解决掉。')
}

/* ============================================================
   第 1 步:输出契约还认得吗
   ============================================================ */

console.log(`\n=== 第 1 步:输出契约 ===`)

if (process.env.PROBE_FULL) {
  console.log('\n=== 随请求发出的 JSON(agent 实际会看到的)===')
  console.log(jsonQuery(DEFAULT_QUERIES[0]))
  console.log('=== 全文结束 ===\n')
}

console.log(`探测 ${HOST} —— ${queries.length} 个问题\n`)

for (const query of queries) {
  console.log(`── ${query}`)

  let raw
  let failures
  try {
    ;({ raw, failures } = await fetchRaw(jsonQuery(query)))
  } catch (err) {
    console.log(`   ✗ 请求失败: ${err.message}`)
    unusable++
    continue
  }

  const reply = parseAgentReply(raw)
  if (!reply) {
    // 区分两种情况:工作流炸了(一个字都没有) vs 返回了但格式不认识。
    // 前者是上游的锅,后者才是前端解析的锅 —— 混在一起会指错方向
    console.log(raw.trim() ? '   ✗ 前端解析不了,会退回显示纯文本:' : '   ✗ 一个字都没返回 —— 工作流大概率在中途失败了:')
    if (raw.trim()) console.log(`     ${raw.slice(0, 200)}`)
    reportFailures(failures)
    unusable++
    continue
  }

  const tags = [
    `mode=${reply.mode || '(无)'}`,
    `risk=${reply.risk.level}`,
    reply.blocked ? 'BLOCKED' : '',
    `${reply.dishes.length} 菜`,
    `${reply.advice.length} 建议`,
  ].filter(Boolean)

  console.log(`   ✓ ${tags.join('  ')}`)
  if (reply.risk.items.length) console.log(`     风险条目: ${reply.risk.items.join('、')}`)
  // 拦截理由一定要打出来 —— 只有它能把「工作流误拦」和「模型自己判定」
  // 区分开,这是被拦时最有信息量的一行
  if (reply.blocked) console.log(`     拦截理由: ${reply.risk.message || '(空)'}`)

  for (const d of reply.dishes) {
    const extra = [d.recipe.length ? `做法${d.recipe.length}步` : '', d.healthModification ? '有改良说明' : '']
      .filter(Boolean)
      .join(' ')
    console.log(`     · ${d.name} [${d.suitable ? '适宜' : '不宜'}]${extra ? ` ${extra}` : ''}`)
  }
  console.log('')
}

await server.close()

console.log(
  unusable === 0
    ? '全部解析成功 —— 前端认得当前契约。\n'
    : `${unusable} 个问题解析失败 —— 契约可能变了,去看 src/lib/agentReply.ts。\n`
)
process.exit(unusable === 0 ? 0 : 1)
