/**
 * Dify agent 转发 —— 服务端实现
 * ===========================================================
 * 为什么必须放在服务端
 * ------------------------------------------------------------
 * Dify 的 App Key 一旦进了浏览器 bundle,任何人都能打开控制台把它捞出来,
 * 然后直接消耗你的额度。Vite 的 `VITE_` 前缀**不是**安全机制 ——
 * 它只是命名约定,带这个前缀的变量照样会被内联进 JS 产物。
 * 所以 Key 只存在于服务端环境变量,浏览器只看到同源的 /api/*。
 *
 * 同一份代码,两个运行环境
 * ------------------------------------------------------------
 *   · 生产 —— Vercel Serverless Function(api/chat-messages.ts 转进来)
 *   · 开发 —— vite.config.ts 里挂成 dev server 的中间件
 * 两边共用这一份实现,避免"本地能跑、线上不行"这种最难查的偏差。
 * 因此这里只用 Web 标准的 Request / Response,不碰任何平台专有 API。
 *
 * 换平台:Netlify 用 `export default async (req: Request) => handleChat(req)`,
 * Cloudflare Workers 直接 `export default { fetch: handleChat }`,逻辑不用动。
 */

/* ------------------------------------------------------------
   配置
   ------------------------------------------------------------ */

const DIFY_BASE = (process.env.DIFY_API_BASE || 'https://api.dify.ai/v1').replace(/\/+$/, '')
const API_KEY = process.env.DIFY_API_KEY || ''

/**
 * 对话那条路用的 Key —— **和识图那条不是同一个 Dify 应用**。
 *
 * 2026-09-23 起:对话页接的是用户自己搭的另一个 agent(「膳享+」),
 * 识图仍然走「食衡」。两个应用各有各的 Key,所以这里必须是两个变量:
 *
 *   · `DIFY_API_KEY`      —— 食衡,**只给 `/api/recognize` 用**
 *   · `DIFY_CHAT_API_KEY` —— 膳享+,**只给 `/api/chat-messages` 用**
 *
 * 没配 `DIFY_CHAT_API_KEY` 时**退回用食衡那把**,而不是留空:这样在没动过
 * 环境变量的机器上(本地、线上、别人的 clone),行为和换之前逐字一致 ——
 * 对话仍然接食衡。也就是说这是个「可选的分流」,不是「新加的必填项」:
 * 忘了配不会白屏,只是没换过去。
 *
 * ⚠️ 两把 Key 都**只存在于服务端**(理由见文件头),浏览器只看得到同源的 /api/*。
 */
const CHAT_API_KEY = process.env.DIFY_CHAT_API_KEY || API_KEY

/**
 * 单次提问的长度上限 —— 防止有人拿这个公开接口当免费文本传输通道。
 *
 * ⚠️ 2026-09-19 从 1000 提到 4000,这不是放宽限制,是**修一个已经存在的 bug**。
 *
 * 原因:对话页发的 query 不是用户那句话,而是 `buildAgentQuery()` 把档案 +
 * 当天摄入序列化成的 JSON。实测长度是**随记录增长**的:
 *
 *     种子数据                    781 字
 *     一天 4 餐 × 4 道菜          1145 字   ← 超过原来的 1000
 *     一天 4 餐 × 8 道菜          1592 字
 *
 * 也就是说,用户越是认真记录,越会撞上 400 BAD_REQUEST;而前端拿到
 * BAD_REQUEST 只会切到本地回答并提示「agent 暂时不可用」—— 症状看起来像
 * 上游挂了,实际是本地这道闸卡错了。用户记满一天就必然触发。
 *
 * 4000 是留了余量之后的值:即使再给 query 加一份食物库目录(约 1855 字)
 * 也不到上限。真正的滥用防线是上面的限流和 Vercel 自身的请求体上限,
 * 不是这个数字。
 *
 * 这个常量是导出的 —— `scripts/verify-loop.mjs` 拿它当断言的上界,
 * 这样「记录变多导致 query 变长」和「上限」的关系是被测出来的,
 * 而不是靠人去记住两边要一起改。
 */
export const MAX_QUERY_LENGTH = 4000

/* ------------------------------------------------------------
   限流
   ------------------------------------------------------------ */

/**
 * 按 IP 的滑动窗口限流,状态放在函数实例的内存里。
 *
 * 这是**尽力而为**的防护,不是严格配额:Serverless 会横向扩多个实例,
 * 每个实例各记各的。但对"作品集链接被陌生人刷额度"这个具体风险来说足够了 ——
 * 目标是抬高滥用成本,不是做到精确计费。真实业务应该用 Redis 之类的共享存储。
 */
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 12
const MAX_TRACKED_IPS = 5000

const hits = new Map<string, number[]>()

function checkRate(ip: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now()

  // 实例长期存活时,表要能自己收干净,否则内存缓慢上涨
  if (hits.size > MAX_TRACKED_IPS) {
    for (const [key, times] of hits) {
      if (times[times.length - 1] < now - WINDOW_MS) hits.delete(key)
    }
  }

  const recent = (hits.get(ip) ?? []).filter((t) => t > now - WINDOW_MS)
  if (recent.length >= MAX_PER_WINDOW) {
    return { ok: false, retryAfterSec: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) }
  }
  recent.push(now)
  hits.set(ip, recent)
  return { ok: true, retryAfterSec: 0 }
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}

/* ------------------------------------------------------------
   工具
   ------------------------------------------------------------ */

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  })
}

/**
 * 上游非 2xx 时的统一错误响应。
 * 429 原样透出,让前端能区分「额度用完了」和「配置错了」—— 两者的处理方式不同。
 */
async function upstreamError(upstream: Response): Promise<Response> {
  const detail = await upstream.text().catch(() => '')
  return json(
    {
      code: upstream.status === 429 ? 'UPSTREAM_QUOTA' : 'UPSTREAM_ERROR',
      message: `Dify 返回 ${upstream.status}${detail ? `：${detail.slice(0, 300)}` : ''}`,
    },
    upstream.status === 429 ? 429 : 502
  )
}

/**
 * 把上游响应原样交给浏览器。
 *
 * 流式这条路**必须不解析、不缓冲** —— 中间任何一层做了缓冲,打字机效果
 * 都会变成「等半天然后一次全出来」。
 */
async function relay(upstream: Response, streaming: boolean): Promise<Response> {
  if (streaming) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // 某些反向代理会缓冲响应,这个头明确要求不要
        'x-accel-buffering': 'no',
      },
    })
  }

  const data = await upstream.text()
  return new Response(data, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/* ------------------------------------------------------------
   GET /api/status —— 前端用它决定要不要显示「演示模式」
   ------------------------------------------------------------ */

export interface AgentStatus {
  available: boolean
  /** 不可用的原因,给前端做提示文案 */
  reason?: 'no-key' | 'disabled'
  rateLimit: { limit: number; windowSec: number }
}

export function handleStatus(): Response {
  // 报的是**对话**那把 key 的状态:这个接口回答的是「屏幕上那句话是模型写的
  // 还是本地预置的」,而那句话来自对话那个应用。跟着识图的 key 走的话,
  // 会出现「提示演示模式、但对话其实是通的」这种自己骗自己的状态。
  const body: AgentStatus = {
    available: Boolean(CHAT_API_KEY),
    ...(CHAT_API_KEY ? {} : { reason: 'no-key' as const }),
    rateLimit: { limit: MAX_PER_WINDOW, windowSec: WINDOW_MS / 1000 },
  }
  return json(body)
}

/* ------------------------------------------------------------
   POST /api/chat-messages —— 与 Dify 官方接口同形,只是补上了鉴权
   ------------------------------------------------------------ */

interface ChatRequestBody {
  query?: unknown
  user?: unknown
  conversation_id?: unknown
  inputs?: unknown
  response_mode?: unknown
}

export async function handleChat(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ code: 'METHOD_NOT_ALLOWED', message: '请用 POST' }, 405)
  }

  // 没配 Key 是**预期内的正常状态**,不是故障 —— 面试官打开链接时就没有 Key。
  // 所以给一个明确的 503 + 机器可读的 code,让前端体面地切到演示模式。
  if (!CHAT_API_KEY) {
    return json(
      {
        code: 'AGENT_UNAVAILABLE',
        message: '未配置 DIFY_CHAT_API_KEY，当前为演示模式。',
      },
      503
    )
  }

  const ip = clientIp(req)
  const rate = checkRate(ip)
  if (!rate.ok) {
    return json(
      { code: 'RATE_LIMITED', message: `请求过于频繁，请 ${rate.retryAfterSec} 秒后重试。` },
      429,
      { 'retry-after': String(rate.retryAfterSec) }
    )
  }

  /*
    ⚠️ **这条端点现在收两种请求体:纯 JSON(打字),以及 multipart(带图)。**

    为什么在这里加,而不是再开一条端点:对话页「发一张图」和「打一句话」在用户
    眼里是**同一件事** —— 都该由膳享+ 一个人回答。原来发图走的是 `/api/recognize`
    (食衡),于是同一个对话框里语气、能力、出错文案都是两套(实测用户的感受是
    「这跟首页功能有什么区别」)。

    膳享+ 那边**本来就能看图**:它的 LLM 节点开着 Vision(`detail: high` +
    `sys.files`),收图白名单也是开的。差的只有这一层转发。

    带图比纯文字多一跳:先把图传到 Dify 拿 `upload_file_id`,再带着它提问。
    那两跳的 `user` 必须**完全一致**(Dify 按 tenant+created_by 过滤文件,对不上
    会报「Invalid upload file id」,而文案里根本不提 user)。所以 `user` 从
    payload 里先算出来,上传和提问共用同一个常量。
  */
  const multipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data')
  let body: ChatRequestBody
  let uploadId: string | undefined

  if (multipart) {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return json({ code: 'BAD_REQUEST', message: '请求不是合法的 multipart 表单' }, 400)
    }
    try {
      body = JSON.parse(String(form.get('payload') ?? '{}')) as ChatRequestBody
    } catch {
      return json({ code: 'BAD_REQUEST', message: 'payload 不是合法 JSON' }, 400)
    }

    const file = asUpload(form.get('file'))
    if (!file) return json({ code: 'BAD_REQUEST', message: '缺少图片文件' }, 400)
    if (file.size === 0) return json({ code: 'BAD_REQUEST', message: '图片是空文件' }, 400)
    if (file.size > MAX_UPLOAD_BYTES) {
      return json({ code: 'PAYLOAD_TOO_LARGE', message: '图片太大，请换一张。' }, 413)
    }
    const type = (file.type || '').toLowerCase()
    const ext = IMAGE_EXT[type]
    if (!ext) {
      return json({ code: 'UNSUPPORTED_IMAGE', message: `不支持的图片格式：${type || '未知'}` }, 415)
    }

    const uploadUser =
      typeof body.user === 'string' && body.user ? body.user.slice(0, 64) : 'anonymous'
    const uploadForm = new FormData()
    uploadForm.append('file', new Blob([await file.arrayBuffer()], { type }), `chat${ext}`)
    uploadForm.append('user', uploadUser)

    let uploaded: Response
    try {
      uploaded = await fetch(`${DIFY_BASE}/files/upload`, {
        method: 'POST',
        headers: { authorization: `Bearer ${CHAT_API_KEY}` },
        body: uploadForm,
        signal: req.signal,
      })
    } catch (err) {
      return json(
        { code: 'UPSTREAM_UNREACHABLE', message: `无法连接 Dify：${(err as Error).message}` },
        502
      )
    }
    if (!uploaded.ok) {
      const detail = await uploaded.text().catch(() => '')
      return json(
        {
          code: 'UPLOAD_FAILED',
          message: `Dify 拒绝了这个文件（${uploaded.status}）${detail ? `：${detail.slice(0, 300)}` : ''}`,
        },
        uploaded.status === 429 ? 429 : 502
      )
    }
    uploadId = ((await uploaded.json().catch(() => ({}))) as { id?: string }).id
    if (!uploadId) return json({ code: 'UPLOAD_FAILED', message: 'Dify 没有返回 upload_file_id' }, 502)
  } else {
    try {
      body = (await req.json()) as ChatRequestBody
    } catch {
      return json({ code: 'BAD_REQUEST', message: '请求体不是合法 JSON' }, 400)
    }
  }

  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) return json({ code: 'BAD_REQUEST', message: 'query 不能为空' }, 400)
  if (query.length > MAX_QUERY_LENGTH) {
    return json({ code: 'BAD_REQUEST', message: `query 过长（上限 ${MAX_QUERY_LENGTH} 字）` }, 400)
  }

  const user = typeof body.user === 'string' && body.user ? body.user.slice(0, 64) : 'anonymous'
  const streaming = body.response_mode !== 'blocking'

  let upstream: Response
  try {
    upstream = await fetch(`${DIFY_BASE}/chat-messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${CHAT_API_KEY}`,
      },
      body: JSON.stringify({
        inputs: (body.inputs && typeof body.inputs === 'object' ? body.inputs : {}) as Record<string, unknown>,
        query,
        response_mode: streaming ? 'streaming' : 'blocking',
        user,
        // 带图那条路把 upload_file_id 带上 —— 字段名和 Dify 的约定一致
        ...(uploadId
          ? { files: [{ type: 'image', transfer_method: 'local_file', upload_file_id: uploadId }] }
          : {}),
        ...(typeof body.conversation_id === 'string' && body.conversation_id
          ? { conversation_id: body.conversation_id }
          : {}),
      }),
    })
  } catch (err) {
    // 网络层失败(域名解析不了、超时)。不当成 500 —— 这是上游不可达,
    // 前端应当和"没配 Key"一样走降级,而不是给用户看一个报错页
    return json(
      { code: 'UPSTREAM_UNREACHABLE', message: `无法连接 Dify：${(err as Error).message}` },
      502
    )
  }

  if (!upstream.ok) return upstreamError(upstream)

  return relay(upstream, streaming)
}

/* ------------------------------------------------------------
   POST /api/recognize —— 图片进,SSE 出
   ------------------------------------------------------------
   为什么是一个端点而不是两个
   ------------------------------------------------------------
   浏览器只发**一次**请求,服务端替它串起 Dify 的两步:

     ① POST {dify}/files/upload        → 拿 upload_file_id
     ② POST {dify}/chat-messages       → 带上 files:[{...upload_file_id}]

   这样做的三个理由:

     · 少一次往返,而且图片只需要过一遍网络
     · App Key 始终不出服务端,也不对外暴露「往 Dify 传任意文件」的能力
     · **Dify 要求 upload 和 chat 用同一个 `user` 字符串**(它按 tenant +
       created_by 过滤文件)。合成一个请求,这个约束就是结构性成立的,
       不是靠前后端两个地方各自记得传对一个值

   图片**不走** query 里的 images 字段 —— 见 agentContext.ts 里那段注释。
   ------------------------------------------------------------ */

/**
 * 识别请求的整体上限。
 * Vercel Serverless 的请求体上限约 4.5MB,这里留出余量。
 * 客户端那边会把长边压到 1280 / JPEG q0.8(通常 150–400KB),所以正常路径
 * 离这个上限很远 —— 它挡的是绕过前端直接打接口的情况。
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/**
 * 识别用 query 的长度上限。
 *
 * 刻意**不复用** MAX_QUERY_LENGTH:两者眼下都够用,但这条链路以后可能要往
 * query 里加一份食物库目录(约 1855 字)让模型直接回 foodId ——
 * 各留各的余量,比共用一个数字再一起改安全。
 */
const MAX_RECOGNIZE_QUERY_LENGTH = 8000

/**
 * Dify 的 allowed_file_extensions 是**按扩展名字符串**判的,不是按内容嗅探。
 *
 * 所以文件名由服务端按 MIME 决定,不用客户端给的那个 —— 客户端把一个
 * 完全正常的 JPEG 命名成 `IMG_1234.heic`(iOS 上的常见情形),Dify 会拒,
 * 而字节其实一点问题都没有。这种拒绝还特别难查:报的是格式不对,
 * 但你检查字节会发现格式是对的。
 */
const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/**
 * 从 FormData 里取文件。
 *
 * 刻意**不用 `instanceof File`**:Vercel 平台的 Request 由平台运行时构造,
 * 它的 File 和本进程的 File 未必是同一个 realm —— 跨 realm 的 instanceof
 * 会静默返回 false。症状是「用户明明传了图,服务端说没传」,
 * 而且只在线上出现。按能力判断没有这个问题。
 */
function asUpload(
  v: FormDataEntryValue | null
): { size: number; type: string; name: string; arrayBuffer(): Promise<ArrayBuffer> } | null {
  if (!v || typeof v === 'string') return null
  if (typeof v.size !== 'number' || typeof v.arrayBuffer !== 'function') return null
  return v
}

export async function handleRecognize(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ code: 'METHOD_NOT_ALLOWED', message: '请用 POST' }, 405)
  }

  // 和 handleChat 用**同一个 code** —— 前端已经有的那条降级分支
  // (没 Key → 切本地模拟 + 明确标注)不用改一行就能接上
  if (!API_KEY) {
    return json(
      { code: 'AGENT_UNAVAILABLE', message: '未配置 DIFY_API_KEY，当前为演示模式。' },
      503
    )
  }

  // 和对话共用同一个额度桶(同一个模块级 hits)。一次拍餐盘消耗**一个**令牌,
  // 不是两个 —— 浏览器只发一次请求,checkRate 也只在这里调一次。
  const ip = clientIp(req)
  const rate = checkRate(ip)
  if (!rate.ok) {
    return json(
      { code: 'RATE_LIMITED', message: `请求过于频繁，请 ${rate.retryAfterSec} 秒后重试。` },
      429,
      { 'retry-after': String(rate.retryAfterSec) }
    )
  }

  // 先看声明长度,别把 5MB 读进内存再拒绝。
  // Vercel 平台自己会在约 4.5MB 处先挡住,所以这条主要在 dev 生效
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return json({ code: 'PAYLOAD_TOO_LARGE', message: '图片太大，请换一张。' }, 413)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ code: 'BAD_REQUEST', message: '请求不是合法的 multipart 表单' }, 400)
  }

  const file = asUpload(form.get('file'))
  if (!file) return json({ code: 'BAD_REQUEST', message: '缺少图片文件' }, 400)
  if (file.size === 0) return json({ code: 'BAD_REQUEST', message: '图片是空文件' }, 400)
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ code: 'PAYLOAD_TOO_LARGE', message: '图片太大，请换一张。' }, 413)
  }

  const type = (file.type || '').toLowerCase()
  const ext = IMAGE_EXT[type]
  if (!ext) {
    return json(
      { code: 'UNSUPPORTED_IMAGE', message: `不支持的图片格式：${type || '未知'}` },
      415
    )
  }

  let payload: { query?: unknown; conversation_id?: unknown; response_mode?: unknown }
  try {
    payload = JSON.parse(String(form.get('payload') ?? '{}')) as typeof payload
  } catch {
    return json({ code: 'BAD_REQUEST', message: 'payload 不是合法 JSON' }, 400)
  }

  const query = typeof payload.query === 'string' ? payload.query.trim() : ''
  if (!query) return json({ code: 'BAD_REQUEST', message: 'query 不能为空' }, 400)
  if (query.length > MAX_RECOGNIZE_QUERY_LENGTH) {
    return json(
      { code: 'BAD_REQUEST', message: `query 过长（上限 ${MAX_RECOGNIZE_QUERY_LENGTH} 字）` },
      400
    )
  }

  // user 只在这里取**一次**,下面 upload 和 chat 用的是同一个常量。
  // Dify 按 tenant + created_by 过滤文件,两个请求的 user 对不上就报
  // 「Invalid upload file id」——而且文案里不会提 user,很容易往别处查
  const rawUser = form.get('user')
  const user = typeof rawUser === 'string' && rawUser ? rawUser.slice(0, 64) : 'anonymous'

  const streaming = payload.response_mode !== 'blocking'

  /* ---------- ① 上传 ---------- */
  const bytes = await file.arrayBuffer()

  // 重新构造 FormData,而不是把原始字节连同 content-type 一起转发。
  // 两个原因:
  //   · 文件名要由服务端定(见 IMAGE_EXT)—— 转发就等于把客户端的文件名
  //     原样交给 Dify,而那个名字可能带一个不在白名单里的扩展名
  //   · 手动设 content-type 会和 fetch 自己生成的 boundary 对不上,
  //     接收端直接解析失败。所以这里**不设** content-type,让 fetch 自己带
  const uploadForm = new FormData()
  uploadForm.append('file', new Blob([bytes], { type }), `plate${ext}`)
  uploadForm.append('user', user)

  let uploaded: Response
  try {
    uploaded = await fetch(`${DIFY_BASE}/files/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${API_KEY}` },
      body: uploadForm,
      // 客户端断开(用户点了「停止分析」)时一并取消,不白烧一次视觉调用
      signal: req.signal,
    })
  } catch (err) {
    return json(
      { code: 'UPSTREAM_UNREACHABLE', message: `无法连接 Dify：${(err as Error).message}` },
      502
    )
  }

  if (!uploaded.ok) {
    const detail = await uploaded.text().catch(() => '')
    // 单独给一个 code:这个失败几乎总是 Dify 侧的**配置**问题
    // (应用「功能」里没开图片上传、扩展名不在白名单、超过 10MB),
    // 不是网络问题。混进 UPSTREAM_ERROR 里会让人往错的方向查半天
    return json(
      {
        code: 'UPLOAD_FAILED',
        message: `Dify 拒绝了这个文件（${uploaded.status}）${detail ? `：${detail.slice(0, 300)}` : ''}`,
      },
      uploaded.status === 429 ? 429 : 502
    )
  }

  const uploadId = ((await uploaded.json().catch(() => ({}))) as { id?: string }).id
  if (!uploadId) {
    return json({ code: 'UPLOAD_FAILED', message: 'Dify 没有返回 upload_file_id' }, 502)
  }

  /* ---------- ② 带图提问 ---------- */
  let upstream: Response
  try {
    upstream = await fetch(`${DIFY_BASE}/chat-messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        inputs: {},
        query,
        response_mode: streaming ? 'streaming' : 'blocking',
        // ⚠️ 必须与上面 upload 的那个 user 完全一致
        user,
        files: [{ type: 'image', transfer_method: 'local_file', upload_file_id: uploadId }],
        ...(typeof payload.conversation_id === 'string' && payload.conversation_id
          ? { conversation_id: payload.conversation_id }
          : {}),
      }),
      signal: req.signal,
    })
  } catch (err) {
    return json(
      { code: 'UPSTREAM_UNREACHABLE', message: `无法连接 Dify：${(err as Error).message}` },
      502
    )
  }

  if (!upstream.ok) return upstreamError(upstream)

  return relay(upstream, streaming)
}
