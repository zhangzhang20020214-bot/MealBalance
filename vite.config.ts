import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 从 private/dify.env 读取 Dify 凭据,注入 process.env。
 *
 * 为什么不放在 .env 里由 Vite 注入前端:
 * Vite 只把 VITE_ 前缀的变量注入客户端 bundle —— 那不是"安全",只是命名约定,
 * 任何注入到前端的值都能在浏览器里被翻出来。Dify 的 App Key 一旦泄漏,
 * 别人就能直接消耗你的额度。
 *
 * 所以 Key 只进 Node 进程的 process.env,浏览器侧永远看不到它。
 * private/ 已在 .gitignore 里,不会进仓库。
 */
function readPrivateEnv(): Record<string, string> {
  const file = path.join(import.meta.dirname, 'private', 'dify.env')
  if (!fs.existsSync(file)) return {}

  const env: Record<string, string> = {}
  for (const raw of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    env[key] = value
  }
  return env
}

const difyEnv = readPrivateEnv()
// 已存在的真实环境变量优先,方便临时覆盖
if (difyEnv.DIFY_API_KEY && !process.env.DIFY_API_KEY) process.env.DIFY_API_KEY = difyEnv.DIFY_API_KEY
if (difyEnv.DIFY_API_BASE && !process.env.DIFY_API_BASE) process.env.DIFY_API_BASE = difyEnv.DIFY_API_BASE
// 对话专用的第二把 key(另一个 Dify 应用)。不配的话 api/_lib/agent.ts 会退回
// 用 DIFY_API_KEY —— 所以这一行漏了不会白屏,只是对话没换过去。
if (difyEnv.DIFY_CHAT_API_KEY && !process.env.DIFY_CHAT_API_KEY)
  process.env.DIFY_CHAT_API_KEY = difyEnv.DIFY_CHAT_API_KEY

/* ------------------------------------------------------------
   dev 环境下把 api/ 目录当 Serverless 跑
   ------------------------------------------------------------ */

/** Connect 的 req 转成 Web 标准的 Request */
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Request(url, { method: req.method, headers })
  }

  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return new Request(url, { method: req.method, headers, body: Buffer.concat(chunks) })
}

/** Web 标准的 Response 写回 Connect 的 res,流式响应逐块透传 */
async function sendWebResponse(res: ServerResponse, web: Response): Promise<void> {
  res.statusCode = web.status
  web.headers.forEach((value, key) => res.setHeader(key, value))

  if (!web.body) {
    res.end()
    return
  }

  const reader = web.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(Buffer.from(value))
  }
  res.end()
}

/**
 * 这个插件是**开发期**的 Serverless 替身。
 *
 * 存在的意义:让 api/_lib/agent.ts 在生产(Vercel)和本地(dev server)
 * 跑的是同一份代码。否则最常见的翻车方式就是"本地直连 Dify 好好的,
 * 部署上去发现鉴权头没带上"。
 */
function apiDevServer(): Plugin {
  return {
    name: 'mealbalance:api-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (!pathname.startsWith('/api/')) return next()

        try {
          const agent = await server.ssrLoadModule('/api/_lib/agent.ts')

          let web: Response
          if (pathname === '/api/status') {
            web = agent.handleStatus()
          } else if (pathname === '/api/chat-messages') {
            web = await agent.handleChat(await toWebRequest(req))
          } else if (pathname === '/api/recognize') {
            // 新增端点必须在这里挂一行 —— 这是个硬编码的白名单,
            // 漏了不会报 404,而是**静默落到 Vite 的 SPA fallback**:
            // 前端拿到的是一个 200 + index.html,然后 SSE 解析出一堆乱码。
            // 那种报错完全指不到真正的原因
            web = await agent.handleRecognize(await toWebRequest(req))
          } else {
            return next()
          }

          await sendWebResponse(res, web)
        } catch (err) {
          // 中间件自身出错要和上游出错区分开,否则调试时会看错方向
          server.config.logger.error(`[api] ${String(err)}`)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ code: 'DEV_MIDDLEWARE_ERROR', message: String(err) }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiDevServer()],

  server: {
    port: 5173,
    /*
      不要让 watcher 盯着知识库的原始素材。

      这不是「顺手优化」—— 它真的把 dev server 打死过一次:
      `knowledge-base/` 里是几十上百 MB 的 PDF,Windows 上只要有一个文件
      被别的程序占着(PDF 阅读器开着、或系统正在建索引),chokidar 的
      `fs.watch` 就会抛 `EBUSY`,而那个错误是**未捕获**的 ——
      整个 Node 进程当场退出,报错信息只有一句 `resource busy or locked`,
      看不出和「改了哪个文件」有关系。

      实测现场:
        Error: EBUSY: resource busy or locked, watch
          '.../knowledge-base/2022年中国居民膳食指南 (中国营养学会).pdf'
        [exited with code 1]

      这些素材是**离线**用的(生成知识库文档时由脚本读),改它们不需要热更新。
      node_modules/.git 是 Vite 的默认值,这里显式带上是因为一旦指定了
      `ignored`,就不能再指望默认值还生效。
    */
    watch: { ignored: ['**/node_modules/**', '**/.git/**', '**/knowledge-base/**'] },
  },
})
