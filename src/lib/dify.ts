/**
 * Dify 后端接入层
 * ===========================================================
 * 前端只请求**同源**的 `/api/*`,由服务端补上 Authorization 头再转发给 Dify。
 * Key 只存在于服务端环境变量,永远不会进入浏览器 bundle。
 *
 * 服务端实现见 api/_lib/agent.ts —— 生产走 Vercel Serverless Function,
 * 开发由 vite.config.ts 挂成 dev server 中间件,两边同一份代码。
 *
 * 本地配置:在 private/dify.env 里写(该目录已被 .gitignore 忽略)
 *   DIFY_API_BASE=https://api.dify.ai/v1
 *   DIFY_API_KEY=app-xxxxxxxxxxxxxxxx
 * 部署配置:在 Vercel 项目的环境变量里设同名的两项。
 *
 * 没有 Key 不是故障,是**预期内的正常状态** —— 面试官打开链接时就没有 Key。
 * 所以这里的每个失败路径都要能被调用方识别出来并优雅降级,
 * 而不是把异常抛到界面上变成一片空白。
 */

/** 请求前缀。接口路径与 Dify 官方保持一致,只是多了一层同源鉴权 */
const BASE = '/api'

/** 服务端返回的机器可读错误码 */
export type AgentErrorCode =
  | 'AGENT_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'UPSTREAM_QUOTA'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_UNREACHABLE'
  | 'BAD_REQUEST'
  | 'NETWORK'
  // 识别链路才会出现的三个。补进这个联合类型不是装饰 ——
  // toAgentError 是照着 body.code **原样透传**的(catch 里的 cast),
  // 类型里不写,调用方就没法对着它们做分支,只能去比字符串
  | 'UNSUPPORTED_IMAGE'
  | 'PAYLOAD_TOO_LARGE'
  /** Dify 拒绝了这次上传 —— 几乎总是它那边的配置问题,不是网络问题 */
  | 'UPLOAD_FAILED'

/** 带上错误码的异常 —— 调用方靠 code 决定怎么降级,而不是去匹配报错文案 */
export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

/**
 * 探测后端是否可用。用于在界面上如实标注当前是「真实 agent」还是「演示模式」——
 * 用户有权知道自己看到的是模型生成的,还是预置的。
 */
export async function probeAgent(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/status`, { signal, headers: { accept: 'application/json' } })
    if (!res.ok) return false
    const data = (await res.json()) as { available?: boolean }
    return Boolean(data.available)
  } catch {
    // 连不上就是不可用 —— 探测本身不该抛错,它的问题和"能不能用"是同一个答案
    return false
  }
}

/** 把非 2xx 的响应转成带错误码的异常 */
async function toAgentError(res: Response): Promise<AgentError> {
  let code: AgentErrorCode = 'UPSTREAM_ERROR'
  let message = `HTTP ${res.status}`
  try {
    const body = (await res.json()) as { code?: string; message?: string }
    if (body.code) code = body.code as AgentErrorCode
    if (body.message) message = body.message
  } catch {
    // 响应体不是 JSON(比如被网关拦截了),保留 HTTP 状态码当文案
  }
  return new AgentError(code, message)
}

export interface DifyMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface DifyChatOptions {
  /** 用户输入 */
  query: string
  /** 用户标识,用于 Dify 侧区分会话与统计 */
  user: string
  /** 传回上一轮的 conversation_id 可维持多轮上下文 */
  conversationId?: string
  /**
   * **带图提问** —— 有它就走 multipart,没有就还是纯 JSON。
   *
   * 为什么加在这里而不是另开一条路:对话页「发一张图」和「打一句话」在用户眼里
   * 是同一件事,都该由**膳享+**一个人回答。服务端那条 `/api/chat-messages`
   * 负责「先传文件、再带 upload_file_id 提问」那一跳(见 api/_lib/agent.ts)。
   *
   * ⚠️ 传进来的必须是**已经压好的图**(`lib/image.ts` 的产物),不是手机原图 ——
   * 手机原图 3~8MB,而 Dify 那边单张上限 10MB、Vercel 请求体上限约 4.5MB。
   */
  image?: Blob
  /**
   * 对应 Dify 应用里配置的输入变量。
   *
   * ⚠️ **这个应用的工作流不读它** —— 档案是塞在 `query` 的 JSON 里传的
   * （见 `agentContext.ts` 的文件头）。`/parameters` 里那个 `user_context`
   * 是个没人引用的悬空变量，往这里塞东西只会被静默丢掉。
   * 保留这个字段是因为它是 Dify 请求格式的一部分，不是给人用的。
   */
  inputs?: Record<string, string | number>
  /** 中止信号 */
  signal?: AbortSignal
}

/** Dify 流式返回的每个事件块 */
export interface DifyStreamChunk {
  event: 'message' | 'agent_message' | 'message_end' | 'error' | 'ping' | string
  task_id?: string
  message_id?: string
  conversation_id?: string
  answer?: string
  code?: string
  message?: string
  /**
   * 节点事件的负载 —— `node_started` / `node_finished` 的内容全在这里。
   *
   * ⚠️ 它一直是**有**的(`parseSse` 只是 `as DifyStreamChunk` 强转,不挑字段),
   * 缺的只是这个类型声明。所以补上它不会改变任何运行时行为 ——
   * 别以为「加了字段所以要动服务端」:服务端从头到尾都是原样透传。
   */
  data?: {
    /** 节点的显示名,和 `dify/食衡MealBalance.yml` 里的 `data.title` 一致 */
    title?: string
    /** `running` / `succeeded` / `failed` */
    status?: string
    node_id?: string
    error?: string
    /**
     * 节点跑完之后吐出来的东西,**只有 `node_finished` 才有**。
     *
     * LLM 节点这里是 `{ text: '...', usage: {...} }` —— 那个 `text` 就是模型
     * 那一整段回答。它是「分析中」这一屏能提前出结果的全部依据:
     * 工作流在 LLM 之后还要跑联网查营养,但那几秒里菜名其实已经在手上了。
     *
     * ⚠️ 别指望它一定在、也别指望它一定是字符串 —— 节点类型不同,形状就不同。
     * 取值一律当 `unknown` 处理(见 recognizeAgent 里那段)。
     */
    outputs?: Record<string, unknown>
  }
}

/**
 * 发起对话(流式)。逐块 yield 出 Dify 的事件,由调用方决定如何渲染。
 *
 * @example
 * for await (const chunk of chatStream({ query: '今天吃什么', user: 'u1' })) {
 *   if (chunk.event === 'message') append(chunk.answer!)
 * }
 */
export async function* chatStream(opts: DifyChatOptions): AsyncGenerator<DifyStreamChunk> {
  const payload = {
    inputs: opts.inputs ?? {},
    query: opts.query,
    response_mode: 'streaming',
    user: opts.user,
    ...(opts.conversationId ? { conversation_id: opts.conversationId } : {}),
  }
  /*
    两条路都打到同一个端点 —— 判据只有一个:**这次带没带图**。
    带图时**不能手动设 content-type**:multipart 的 boundary 是 fetch 自己生成
    并写进 header 的,手写一个会和它对不上,接收端直接解析失败。
  */
  const res = opts.image
    ? await fetch(`${BASE}/chat-messages`, {
        method: 'POST',
        signal: opts.signal,
        body: (() => {
          const form = new FormData()
          form.append('file', opts.image as Blob, 'chat.jpg')
          form.append('payload', JSON.stringify(payload))
          return form
        })(),
      })
    : await fetch(`${BASE}/chat-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: opts.signal,
        body: JSON.stringify(payload),
      })

  if (!res.ok) throw await toAgentError(res)
  if (!res.body) throw new AgentError('NETWORK', 'Dify 未返回响应体')

  yield* parseSse(res.body)
}

/**
 * 逐块解析 SSE 流。
 *
 * 抽出来是因为识别链路返回的是**同一种**事件流 —— Dify 的
 * `/chat-messages` 不管带不带图,吐出来的都是 `data: {json}\n\n`。
 * 拷贝一份到 recognizeStream 里意味着以后修边界 bug 要修两处。
 */
async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<DifyStreamChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Dify 用 SSE:每条消息形如 `data: {json}\n\n`
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? '' // 末尾可能是半条,留到下一轮

    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          yield JSON.parse(payload) as DifyStreamChunk
        } catch {
          // 单条解析失败不该中断整个流
        }
      }
    }
  }
}

/* ------------------------------------------------------------
   图片识别
   ------------------------------------------------------------ */

export interface DifyRecognizeOptions {
  /** 已经压好的图片(见 src/lib/image.ts —— 长边 1024 的 JPEG) */
  image: Blob
  /** 走 buildAgentQuery() 拼出来的完整 JSON,和对话用的是同一套上下文 */
  query: string
  /**
   * 用户标识。
   *
   * ⚠️ 服务端会用**同一个字符串**去调 Dify 的上传和对话两步 —— Dify 按
   * tenant + created_by 过滤文件,两边对不上就报 `Invalid upload file id`。
   * 所以这个值必须和对话页用的是同一个(见 session.ts 的 SESSION_USER),
   * 不能每次拍照现造一个。
   */
  user: string
  /**
   * 刻意**没有** conversationId。
   *
   * 识别是一次性的:每次拍的都是新的一盘菜,接上一轮对话的上下文只会让
   * 模型把上次那盘菜的记忆带进来(「和刚才那份一样」)。而且 conversation_id
   * 传过去还会让这次识别写进对话历史,污染聊天页的上下文。
   */
  signal?: AbortSignal
}

/**
 * 拍照识别:multipart 进,SSE 出。
 *
 * 浏览器只发**一次**请求 —— Dify 那两步(上传文件 → 带 files 提问)由
 * 服务端串起来,见 api/_lib/agent.ts 的 handleRecognize。
 */
export async function* recognizeStream(opts: DifyRecognizeOptions): AsyncGenerator<DifyStreamChunk> {
  const form = new FormData()
  // 文件名给一个中性的值就够了 —— 服务端会按 MIME 重写(见 IMAGE_EXT)。
  // 但**必须是个 File 而不是裸 Blob**:Blob 进 FormData 时 filename 是
  // "blob",某些接收端会因此判不出扩展名
  form.append(
    'file',
    new File([opts.image], 'plate.jpg', { type: opts.image.type || 'image/jpeg' })
  )
  form.append('user', opts.user)
  form.append(
    'payload',
    JSON.stringify({ query: opts.query, response_mode: 'streaming' satisfies 'streaming' })
  )

  // ⚠️ 不要在这里设 Content-Type。
  // multipart 的 boundary 是 fetch 自己生成并写进 header 的;手动指定一个
  // content-type(哪怕抄了 boundary)会让它和 body 里的 boundary 对不上,
  // 服务端解析直接失败。这个坑在 verify-agent.mjs 里有一条专门的断言盯着
  const res = await fetch(`${BASE}/recognize`, {
    method: 'POST',
    body: form,
    signal: opts.signal,
  })

  if (!res.ok) throw await toAgentError(res)
  if (!res.body) throw new AgentError('NETWORK', '识别接口未返回响应体')

  yield* parseSse(res.body)
}

export interface DifyTextRecognizeOptions {
  /** 走 buildAgentQuery() 拼出来的完整 JSON —— 菜名在 `input.text` 里 */
  query: string
  user: string
  signal?: AbortSignal
}

/**
 * 食衡,**不带图**的那一趟（2026-09-24）。
 *
 * 给打字问出来的那份草稿用:它在「记入日记」时要算营养,而一张照片都没有。
 * 走的是**同一个端点** `/api/recognize` —— 服务端判「有没有 `file` 这一项」
 * 决定发不发 `files`（见 api/_lib/agent.ts 里那段）。
 *
 * ⚠️ **唯一的结构差别就是没有 `file`。** 别在这里补一个空 Blob 占位:
 * 服务端会按 MIME 判扩展名,空文件先撞上「图片是空文件」那个 400。
 *
 * ⚠️ 食衡那条工作流里「联网查营养」那个分支的判据是**有没有库里没有的菜**,
 * 不是有没有图 —— 所以这条路拿得到库外菜的每 100g 值,和拍照那条一样。
 */
export async function* recognizeTextStream(
  opts: DifyTextRecognizeOptions
): AsyncGenerator<DifyStreamChunk> {
  const form = new FormData()
  /*
    ⚠️ `file` 一项**刻意不 append**。服务端判的是 `form.get('file') === null`
    （「没有这一项」）而不是空字符串 —— append 一个空串会让它变成坏请求。
  */
  form.append('user', opts.user)
  form.append(
    'payload',
    JSON.stringify({ query: opts.query, response_mode: 'streaming' satisfies 'streaming' })
  )

  const res = await fetch(`${BASE}/recognize`, {
    method: 'POST',
    body: form,
    signal: opts.signal,
  })

  if (!res.ok) throw await toAgentError(res)
  if (!res.body) throw new AgentError('NETWORK', '识别接口未返回响应体')

  yield* parseSse(res.body)
}

/** 非流式调用 —— 一次性拿完整回答,适合短问短答 */
export async function chatOnce(opts: DifyChatOptions): Promise<string> {
  const res = await fetch(`${BASE}/chat-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      inputs: opts.inputs ?? {},
      query: opts.query,
      response_mode: 'blocking',
      user: opts.user,
      ...(opts.conversationId ? { conversation_id: opts.conversationId } : {}),
    }),
  })

  if (!res.ok) throw await toAgentError(res)

  const data = (await res.json()) as { answer?: string }
  return data.answer ?? ''
}
