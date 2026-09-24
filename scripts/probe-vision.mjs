/**
 * 视觉链路探测(开发用,不进产物)
 * ===========================================================
 * 回答一个只有真跑一遍才知道的问题:**模型到底看见图了没有?**
 *
 * 为什么不能"发一张餐盘图看它回得像不像" —— 那样根本判不出来。没开 Vision 时
 * 模型看不到图,但它**照样会说话**:它会照着 query 里的文字和 prompt 编一份
 * 看起来完全合理的菜品清单。输出格式对、菜名对、营养分析有模有样,
 * 唯一的问题是它压根没看过那张照片。光看结果分辨不出来。
 *
 * 所以这里用一对**对照实验**,把"看见没看见"变成是非题:
 *
 *   A(有图):一张纯品红色的图 + 「这张图是什么颜色的?」
 *   B(无图):同一句话,不带图
 *
 * 品红是个刻意的选择 —— 餐盘照片里不会自然出现这个颜色,所以
 * A 答"品红/洋红/粉色"就是**真的看见了**;A 说看不到图、或 A 和 B 一字不差
 * 就是没看见。
 *
 * ⚠ 但这个对照实验有个**已知局限**:agent 的人设是饮食决策助手,面对
 * 「这张图什么颜色」这类无关问题会**直接拒绝回答** —— 拒绝与否和看不看得见
 * 图无关,于是这一步得不出结论(实测就是这样)。所以判据被挪到了第 3 步:
 * **从真实餐盘照里认出真菜名**,那才只有"看见了"一种解释。第 2 步只保留了
 * 两种仍能定性的情形(A 说了看不到图 / A 和 B 一字不差),其余一律报"不确定"。
 * 一个恒亮的红灯比没有红灯更糟 —— 见第 2 步 OFF_TOPIC_REFUSAL 的注释。
 *
 * 跑法:
 *   npm run dev                # 另开一个终端
 *   npm run probe:vision
 *
 * 会顺带验掉两件 Dify 侧的配置:
 *   ① 应用「功能」→ 图片上传 开着吗(没开的话上传这一步就会挂)
 *   ② LLM 节点 → Vision 开着吗、图片来源是 sys.files 吗(看第 3 步)
 */

import zlib from 'node:zlib'
import { createServer } from 'vite'

const HOST = process.env.PROBE_HOST || 'http://localhost:5173'

/* ------------------------------------------------------------
   手搓一张纯色 PNG
   ------------------------------------------------------------
   不装任何依赖:PNG 就是一个签名 + 三个 chunk(zlib 用 Node 自带的)。
   造这张图而不是塞一张真照片进来,是为了让"看到没看到"可判定 ——
   品红不在任何餐盘里。
   ------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** 一张纯色真彩 PNG */
function solidPng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 位深 8
  ihdr[9] = 2 // 颜色类型 2 = 真彩 RGB
  // 10/11/12 保持 0:压缩方式 / 滤波方式 / 非隔行

  // 每行前面一个滤波字节(0 = None),后面跟 width 个 RGB 三元组
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3)])
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = r
    row[2 + x * 3] = g
    row[3 + x * 3] = b
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 品红 —— 餐盘照片里不会自然出现的颜色,所以"答对了"= 真的看见了 */
const MAGENTA = [255, 0, 255]
const png = solidPng(96, 96, MAGENTA)

/* ------------------------------------------------------------
   走 App 真正走的那条路:POST /api/recognize
   ------------------------------------------------------------ */

/** 和 probe-agent.mjs 同一套解析 —— 把工作流的报错也捞出来,不然只剩"没返回" */
function parseStream(text) {
  let raw = ''
  const failures = []
  for (const block of text.split('\n\n')) {
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
        } else if (ev.event === 'workflow_finished' && d.status && d.status !== 'succeeded') {
          if (failures.length === 0) failures.push(`工作流未成功结束:${d.status}`)
        }
      } catch {
        /* 半条,忽略 */
      }
    }
  }
  return { raw, failures }
}

let session = 0
const user = () => `probe-vision-${Date.now()}-${session++}`

/**
 * @param {object} opts
 * @param {Buffer} [opts.image] 带上就是带图请求
 */
async function recognize({ image, query }) {
  const form = new FormData()
  if (image) form.append('file', new Blob([image], { type: 'image/png' }), 'probe.png')
  form.append('user', user())
  form.append('payload', JSON.stringify({ query, response_mode: 'streaming' }))

  const res = await fetch(`${HOST}/api/recognize`, { method: 'POST', body: form })

  // 非 2xx 是**接口层**的拒绝(格式不对、太大、Dify 拒绝上传),带着机器可读的 code。
  // 和"模型看见了没"是两类问题,所以分开报
  if (!res.ok) {
    let detail = {}
    try {
      detail = await res.json()
    } catch {
      /* 不是 JSON */
    }
    return { httpError: { status: res.status, ...detail } }
  }

  return parseStream(await res.text())
}

/** 纯文本对话 —— 对照组用,不带图 */
async function chat(query) {
  const res = await fetch(`${HOST}/api/chat-messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, user: user(), response_mode: 'streaming' }),
  })
  if (!res.ok) {
    let detail = {}
    try {
      detail = await res.json()
    } catch {
      /* 不是 JSON */
    }
    return { httpError: { status: res.status, ...detail } }
  }
  return parseStream(await res.text())
}

/* ------------------------------------------------------------
   所有 query 都必须裹成工作流要的那段 JSON
   ------------------------------------------------------------
   第一版探测在这里踩了个坑,值得写下来:第 1、2 步直接发了**纯文本**问句,
   两次都返回「服务暂时不可用 / 本次生成结果解析失败,请重试」。
   当时看着像"上游挂了",其实是工作流节点 2 的 `json.loads(sys.query)`
   解不开纯文本,自己走的 except 分支 —— 而它**照样返回 HTTP 200**。

   所以这个探针对"上游到底怎么了"其实有三个层次,别混:
     · HTTP 非 2xx  → 接口层拒绝(没 Key / 格式不对 / 限流)
     · 200 + 「服务暂时不可用」 → query 不是工作流要的 JSON,或某个节点炸了
     · 200 + 正常结构化回复 → 走到模型了
   ------------------------------------------------------------ */

/** 和 App 用的是同一个构造函数 —— 探测的必须是真正会发出去的那段 JSON */
let jsonQuery = (text) => text
/** 工作流自己那条"解析失败"的兜底文案,用来把上面三层区分开 */
const WORKFLOW_FALLBACK = /本次生成结果解析失败/

function reportFailures(failures, indent = '     ') {
  for (const f of failures) {
    for (const line of f.split('\n')) console.log(`${indent}${line}`)
  }
}

/** 报接口层错误时,顺手把它意味着什么说清楚 —— 这个脚本的一半价值在这里 */
function explainHttpError(err) {
  console.log(`  ✗ HTTP ${err.status} ${err.code ?? ''} —— ${err.message ?? ''}`)
  if (err.code === 'AGENT_UNAVAILABLE') {
    console.log('    没有配 Dify Key。把 private/dify.env 里的 DIFY_API_KEY 填上再重启 dev。')
  } else if (err.code === 'UPLOAD_FAILED') {
    console.log('    ① 先检查 Dify 应用编排页右上角「功能」里,「图片上传」是不是开着的。')
    console.log('       (这个应用的图片上传**曾经**是关的 —— 现在的状态以第 1 步为准,不要照抄注释。)')
    console.log('    ② 再检查 allowed_file_extensions 里有没有 png。')
  } else if (err.code === 'RATE_LIMITED') {
    console.log('    限流了(12 次/分钟,和对话共用)。等一会儿再跑。')
  }
}

const BLOCKED = '  ✗ 先把这个解决掉,后面的对照实验没有意义。'

/* ------------------------------------------------------------
   先把 buildAgentQuery 装上 —— 后面每一步的 query 都要经它
   ------------------------------------------------------------ */
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const { buildAgentQuery } = await server.ssrLoadModule('/src/lib/agentContext.ts')
const { parseAgentReply } = await server.ssrLoadModule('/src/lib/agentReply.ts')
const { matchDishes, isWebId } = await server.ssrLoadModule('/src/lib/dishMatch.ts')
const store = await server.ssrLoadModule('/src/store/store.ts')

const state = store.getSnapshot()
jsonQuery = (text) => buildAgentQuery(state.profile, state.meals, { text })

/* ============================================================
   第 0 步:后端可用吗
   ============================================================ */
console.log('\n=== 第 0 步:后端状态 ===')

let available = false
try {
  const status = await (await fetch(`${HOST}/api/status`)).json()
  available = Boolean(status.available)
  console.log(`  ${available ? '✓' : '✗'} /api/status → available=${status.available}${status.reason ? ` (${status.reason})` : ''}`)
  console.log(`     限流:${status.rateLimit?.limit} 次 / ${status.rateLimit?.windowSec} 秒`)
} catch (err) {
  console.log(`  ✗ 连不上 ${HOST} —— ${err.message}`)
  console.log('     开发服务器起了吗?另开一个终端跑 npm run dev。')
}

if (!available) {
  console.log(BLOCKED)
  process.exit(1)
}
console.log('')

/* ============================================================
   第 1 步:上传这一步通不通(顺带验掉「图片上传」开关)
   ============================================================ */

console.log('=== 第 1 步:图片能不能传上去 ===')

let uploadWorks = false

/**
 * 用一句和餐盘无关的话来测这一步 —— 这一问只关心"传得上去吗",
 * 不关心模型答什么。所以即使它答非所问,也不影响结论。
 */
const UPLOAD_PROBE = '收到这张图了吗？只回答"收到"或"没收到"。'

const probe = await recognize({ image: png, query: jsonQuery(UPLOAD_PROBE) })
if (probe.httpError) {
  explainHttpError(probe.httpError)
} else {
  // 走到这里就说明 Dify 收下了那个文件 —— 接口层的"图片上传"开关是开着的
  uploadWorks = true
  console.log('  ✓ 上传这一步通了 —— Dify 收下了文件并返回了 upload_file_id')
  console.log('    (接口层的「图片上传」开关是开着的;没开的话这里会是 UPLOAD_FAILED)')
  if (probe.failures.length) {
    console.log('     但工作流报了错:')
    reportFailures(probe.failures)
  }
  if (WORKFLOW_FALLBACK.test(probe.raw)) {
    // 这一条不属于"上传"这件事,单独说清楚,免得看着像上传挂了
    console.log('     注:回复是工作流自己的兜底文案,说明它没走到模型 —— 见第 2 步的说明')
  }
}

if (!uploadWorks) {
  console.log(BLOCKED)
  process.exit(1)
}
console.log('')

/* ============================================================
   第 2 步:对照实验 —— 模型到底看见图了没有
   ============================================================ */

console.log('=== 第 2 步:对照实验(Vision 开没开)===')
console.log('  图的颜色是**品红** (255,0,255)。餐盘照片里不会自然出现这个颜色。\n')

const COLOR_Q = '这张图片的主要颜色是什么？只回答颜色名，不要解释。'

const withImage = await recognize({ image: png, query: jsonQuery(COLOR_Q) })
const withoutImage = await chat(jsonQuery(COLOR_Q))

const a = (withImage.raw || '').trim()
const b = (withoutImage.raw || '').trim()

console.log(`  A 带图:${a ? a.slice(0, 200).replace(/\s+/g, ' ') : '(空)'}`)
console.log(`  B 无图:${b ? b.slice(0, 200).replace(/\s+/g, ' ') : '(空)'}`)
if (withImage.failures?.length) reportFailures(withImage.failures)
console.log('')

/** 品红的一堆说法 —— 中文模型不一定说"品红" */
const SAW_MAGENTA = /品红|洋红|紫红|玫红|magenta|粉色|粉红|紫色/i
const ADMITS_BLIND = /看不到|无法查看|无法查看图片|没有(收到|看到|图片)|未收到|不能查看/i

/*
 * 人设把问题拦下来了 —— 这一支是**第 2 步自己的局限**,不是 Vision 的毛病。
 *
 * 「这张图什么颜色」对「饮食决策助手」是**无关问题**,所以它会拒绝回答。
 * 一旦拒绝,这一支的输出就与「看不看得见图」无关了 —— 看不见也拒,看得见也拒。
 * 换句话说:**这个对照实验对开了人设的 agent 已经失效**。
 *
 * 把它单列出来、判成「不确定」,是因为让它落进下面的 else 会**每次亮红**。
 * 一个恒亮的红灯比没有灯更糟:用户会学会无视它,于是哪天真的没开 Vision
 * 也照样被无视掉。**能出结论的判据在第 3 步** —— 认不认得出真实菜品。
 */
const OFF_TOPIC_REFUSAL = /超出(了)?(我的)?(服务)?范围|不在(我的)?服务范围|与(饮食|健康|营养)无关|无法回答.{0,6}(无关|范围)/i

const sawColor = SAW_MAGENTA.test(a)
const claimedBlind = ADMITS_BLIND.test(a)
/** A 和 B 一字不差 —— 图对输出**完全没有影响**,这是最硬的证据 */
const identical = a.length > 0 && a === b

if (WORKFLOW_FALLBACK.test(a)) {
  console.log('  ✗ 回复是工作流的兜底文案,说明它没走到模型。')
  console.log('    这**不是** Vision 的问题,是 query 没被 json.loads 吃下去,或前面某个节点炸了。')
  console.log('    看上面有没有「节点「x」执行失败」—— 那才是真正的原因。')
} else if (sawColor) {
  console.log('  ✓ **模型真的看见了这张图** —— 它报出了品红。')
  console.log('    Vision 是开着的,图片来源也是 sys.files。可以往下走了。')
} else if (claimedBlind) {
  console.log('  ✗ 模型明确说它看不到图 —— **LLM 节点的 Vision 开关没开**。')
  console.log('    图片传上去了(第 1 步是通的),但没进到模型里。')
  console.log('    改法:编排页点开那个 LLM 节点 → 打开 Vision → 图片来源选 sys.files。')
} else if (SAW_MAGENTA.test(b)) {
  console.log('  ? 无图那一组也说出了品红 —— 对照实验本身有问题(不该发生)。')
} else if (identical) {
  console.log('  ✗ **带图和不带图的回答一字不差** —— 这张图对输出没有任何影响。')
  console.log('    这是 Vision 没开最硬的证据:品红是个很极端的图,')
  console.log('    真看见了不可能给出完全相同的回答。')
  console.log('    改法:编排页点开那个 LLM 节点 → 打开 Vision → 图片来源选 sys.files。')
  console.log('    注意 Dify 的 **Agent 节点根本不支持视觉**,必须是带 Vision 的 LLM 节点。')
} else if (OFF_TOPIC_REFUSAL.test(a)) {
  console.log('  – 人设把这个问题拦了,这一步**得不出结论**(不是错误)。')
  console.log('    「这张图什么颜色」对饮食决策助手是无关问题,它会拒绝回答 ——')
  console.log('    拒绝与否和看没看见图无关,所以这个对照实验对开了人设的 agent 失效。')
  console.log('    **看第 3 步**:认得出真实菜品就是看见了,那里才是判据。')
} else {
  console.log('  – 带图那一组**没有**报出品红,也说不清是不是没看见 —— 得不出结论。')
  console.log(`    A 有图 ${a.length} 字 / B 无图 ${b.length} 字`)
  console.log('    可能是图片进了模型但没被认对(比如被当成噪点),也可能是随机性。')
  console.log('    **看第 3 步**:认得出真实菜品就是看见了,那里才是判据。')
}
console.log('')

/* ============================================================
   第 3 步:真实餐盘链路 —— 生产里真正会发的那段 JSON
   ============================================================ */

const plateQuery = buildAgentQuery(state.profile, state.meals, { text: '请分析这份餐盘', mode: 'plate' })

console.log('=== 第 3 步:真实餐盘链路 ===')
console.log(`  query 长度 ${plateQuery.length} 字(上限 8000)\n`)

const plate = await recognize({ image: png, query: plateQuery })
if (plate.httpError) {
  explainHttpError(plate.httpError)
} else {
  if (plate.failures.length) {
    console.log('  工作流报错:')
    reportFailures(plate.failures)
  }

  const reply = parseAgentReply(plate.raw)
  if (!reply) {
    console.log('  ✗ 解析不了 —— 前端会退回显示纯文本。')
    console.log(`    原文前 240 字:${plate.raw.slice(0, 240)}`)
  } else {
    console.log(`  ✓ mode=${reply.mode || '(无)'}  risk=${reply.risk.level}  ${reply.dishes.length} 菜`)
    if (reply.blocked) console.log(`     拦截理由:${reply.risk.message || '(空)'}`)

    for (const d of reply.dishes) {
      console.log(
        `     · ${d.name} [${d.suitable ? '适宜' : '不宜'}]` +
          (d.foodId ? `  ← 模型自己挑了 ${d.foodId}` : '') +
          (d.grams !== undefined ? ` ${d.grams}g` : ''),
      )
    }

    /*
     * 「Vision 到底开没开」的**判据在这里**,不在第 2 步。
     *
     * 第 2 步那个对照实验被 agent 的人设废掉了(见那边的 OFF_TOPIC_REFUSAL),
     * 而这一支是替代品,而且更强:它用的是**生产里真正会发的那段 query**,
     * 认出来的也是真实的菜名。看不见图时模型给的是「无法识别食物图片」+
     * 空 dishes(第 2 步 B 那组就是这么答的),所以「认出了真菜」反过来
     * 只有一种解释 —— 图进了模型。
     */
    const PLACEHOLDER = /未知|无法识别|未识别|无法判断/
    const realDishes = reply.dishes.filter((d) => !PLACEHOLDER.test(d.name))
    if (realDishes.length) {
      console.log(`\n  ✓ **Vision 是通的** —— 从一张真实照片里认出了 ${realDishes.length} 道菜。`)
      console.log('    这是判据:看不见图时它只会回「无法识别食物图片」+ 空 dishes,')
      console.log('    所以认得出真菜名只可能是真的看见了。第 2 步那个对照实验已被人设废掉。')
    } else if (!reply.dishes.length) {
      console.log('\n  ⚠ 没认出任何菜 —— 看不出来是 Vision 没开还是这张图里真没有菜。')
      console.log('    喂一张**确定有菜**的照片再跑一次,才能把这两件事分开。')
    }

    /*
     * 模型有没有照目录挑 —— 这是「提示词里加了食物库目录」这件事**唯一**的
     * 生效判据。
     *
     * 加了目录但这里显示 0/N,说明改动没生效,而 App 那边不会报任何错:
     * 有可能是提示词没写清「必须从目录里挑」,也有可能是**客户端把字段丢了**
     * (历史上真的丢过一次,见 agentReply.ts 里 AgentDish.foodId 的注释)。
     */
    const declared = reply.dishes.filter((d) => d.foodId).length
    if (reply.dishes.length) {
      console.log(`\n  目录命中:模型自己挑了 ${declared}/${reply.dishes.length} 个 foodId`)
      if (declared === 0) {
        console.log('    一个都没挑 —— 提示词里如果已经加了食物库目录,那就是没生效。')
      }
    }

    /*
     * 把菜名过一遍**真正的匹配器**,报出有几道落不到食物库。
     *
     * 这一步是替用户先跑一遍:食物库只有 58 项,一份外卖大概率匹配不全。
     * 界面上会显式标出「按 0 计」,但**如果这里发现匹配率很低,
     * 该修的是提示词(让模型从目录里挑 foodId),不是界面**。
     *
     * 喂进去的时候必须把 foodId / grams / per100g 一起带上 —— 不然这一步测的是
     * 「只按名字匹配」,加了目录、联网补了营养也照样报一堆落空。而这里的输出
     * 会**建议去改提示词**:一个把人引向错误结论的诊断工具比没有更糟
     * (同下面第 3 步那个恒亮的红灯)。
     */
    const matched = matchDishes(
      reply.dishes.map((d) => ({
        name: d.name,
        ...(d.foodId ? { foodId: d.foodId } : {}),
        ...(d.grams !== undefined ? { grams: d.grams } : {}),
        ...(d.per100g && d.source ? { per100g: d.per100g, source: d.source } : {}),
      })),
    )
    // 库外菜分两种:联网补到营养的(有值,界面标「联网估算」)和真没查到的
    // (按 0 计)。混成一个数报出来,会让人以为联网那一段根本没跑通。
    const web = matched.items.filter((i) => isWebId(i.foodId)).length
    console.log(
      `\n  匹配:${matched.items.length} 项进库(其中 ${web} 项来自联网检索) / ` +
        `${matched.unmatched.length} 项按 0 计` +
        (matched.unmatched.length ? ` —— ${matched.unmatched.join('、')}` : '')
    )
    if (reply.dishes.length && matched.unmatched.length / reply.dishes.length > 0.5) {
      console.log('  ⚠ 半数以上没匹配上。想改善的话在提示词里让模型从食物库目录挑 foodId ——')
      console.log('    dishMatch 已经支持 foodId / grams / per100g 三个可选字段,提示词加了就能用。')
    }
  }
}

/* ============================================================
   第 4 步:App 真正拿到的是什么
   ------------------------------------------------------------
   前三步是**手工**调的:自己 POST、自己 parseAgentReply、自己 matchDishes。
   但 App 跑的不是这条路径 —— 它跑的是 runRecognition()。两者之间还夹着
   一层「模型给的是菜名还是说明」的判断(见 NOT_A_DISH),而那一层只有
   真跑一遍才知道会落在哪一支。

   做法:把全局 fetch 的**相对 URL** 重定向到 HOST(dify.ts 里写的是
   `/api/recognize`,Node 里解析不了),然后让 runRecognition 原样跑一遍
   真实后端。打出来的就是结果页真正会拿到的那份数据。

   注意这一次多花了**一个**限流令牌(整轮 5 个,上限 12)。
   ============================================================ */

console.log('=== 第 4 步:App 真正拿到的是什么 ===')

const nodeFetch = globalThis.fetch
globalThis.fetch = (url, init) => nodeFetch(new URL(url, HOST), init)

try {
  const { runRecognition } = await server.ssrLoadModule('/src/lib/recognizeAgent.ts')
  const { isUnmatchedId } = await server.ssrLoadModule('/src/lib/dishMatch.ts')

  const meal = await runRecognition({
    image: new Blob([png], { type: 'image/png' }),
    slot: '午餐',
    profile: state.profile,
    meals: state.meals,
  })

  const countable = meal.items.filter((i) => !isUnmatchedId(i.foodId))
  const zero = meal.items.filter((i) => isUnmatchedId(i.foodId))

  console.log(`  engine=${meal.engine}`)

  if (meal.noDishReason) {
    console.log(`  · 没认出菜品 —— 模型的原话:${meal.noDishReason}`)
    console.log('    结果页会显示「这张图里没认出菜品」+ 重拍 / 手动记录两条路,不给归档按钮。')
    console.log('    这张纯色方图里确实没有菜,所以这是**正确**结果,不是故障。')
  } else if (countable.length === 0) {
    console.log('  · 认出了菜名,但一道都没落进食物库 —— 结果页会让用户手动记这一餐')
  } else {
    console.log(`  · ${countable.length} 道菜能算出营养:`)
    for (const it of countable) console.log(`      ${it.name} ${it.grams}g  (${it.foodId})`)
  }
  if (zero.length) console.log(`  · 另外 ${zero.length} 项按 0 计:${zero.map((i) => i.name).join('、')}`)
  if (meal.degradedReason) console.log(`  · ⚠ 降级了:${meal.degradedReason}`)
} catch (err) {
  console.log(`  ✗ ${err.code ?? err.name}:${err.message}`)
  console.log('    这一步抛错 = 结果页会退回本地演示数据(不会白屏,但识别白做了)。')
} finally {
  globalThis.fetch = nodeFetch
}

await server.close()
console.log('')
