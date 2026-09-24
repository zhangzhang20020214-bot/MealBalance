/**
 * 服务端转发自检脚本(开发用,不进产物)
 * ===========================================================
 * 对着一个**本地假 Dify** 跑 api/_lib/agent.ts,确认:
 *   · Key 真的被补进了 Authorization 头
 *   · SSE 流是原样透传的,没有被缓冲成一次性返回
 *   · 上游出错、限流、参数非法各有正确的状态码
 *
 * 不起真网络:假上游是本地 http server,所以这个脚本可以离线反复跑。
 * 跑法:npm run verify:agent
 */

import http from 'node:http'
import { createServer } from 'vite'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failures++
}

/* ------------------------------------------------------------
   假 Dify
   ------------------------------------------------------------ */

const seen = {
  auth: null,
  bodies: [],
  /** /files/upload 收到的表单 —— 用 Request.formData() 反解,见下面 */
  uploads: [],
  uploadAuth: null,
  chatAuth: null,
}

/** 让某一次调用走特定的失败分支 */
let fakeMode = 'ok'

const fake = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const buf = Buffer.concat(chunks)
    // 用 endsWith 而不是写死 /v1/... —— 真实部署里 DIFY_API_BASE 自带 /v1,
    // 而自检里它只是一个裸端口,两边拼出来的路径不一样
    const isUpload = req.url.endsWith('/files/upload')

    seen.auth = req.headers.authorization ?? null
    if (isUpload) seen.uploadAuth = req.headers.authorization ?? null
    else seen.chatAuth = req.headers.authorization ?? null

    const fail = (status, message) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ message }))
    }

    if (req.headers.authorization !== 'Bearer test-key') {
      fail(401, 'invalid token')
      return
    }

    /* ---------- 上传 ---------- */
    if (isUpload) {
      if (fakeMode === 'upload-500') return fail(500, 'upload exploded')

      /**
       * 用**和真实接收端一样的方式**反解 multipart。
       *
       * 这一步本身就是一条断言:如果转发层手动设了 content-type,
       * 那么 header 里的 boundary 和 body 里实际的 boundary 对不上,
       * 这里会直接抛异常 —— 于是「boundary 不匹配」这种线上才暴露的问题,
       * 在自检里就红了。
       */
      let form
      try {
        const rebuilt = new Request(`http://fake${req.url}`, {
          method: 'POST',
          headers: { 'content-type': req.headers['content-type'] },
          body: buf,
        })
        form = await rebuilt.formData()
      } catch (err) {
        return fail(400, `multipart 解析失败（多半是 boundary 和 body 对不上）：${err.message}`)
      }
      seen.uploads.push(form)

      if (fakeMode === 'upload-no-id') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({}))
        return
      }

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'file-test-1' }))
      return
    }

    /* ---------- 对话 ---------- */
    let body = {}
    try {
      body = JSON.parse(buf.toString('utf-8'))
    } catch {
      /* 让下面的分支处理 */
    }
    seen.bodies.push(body)

    if (fakeMode === 'chat-500' || body.query === 'boom') {
      return fail(500, 'upstream exploded')
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' })
    // 分三次写,中间隔开 —— 如果转发层做了缓冲,测试会看到一次性到达
    res.write(`data: ${JSON.stringify({ event: 'message', answer: '你', conversation_id: 'c1' })}\n\n`)
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ event: 'message', answer: '好' })}\n\n`)
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({ event: 'message_end' })}\n\n`)
        res.end()
      }, 30)
    }, 30)
  })
})

await new Promise((r) => fake.listen(0, '127.0.0.1', r))
const upstreamBase = `http://127.0.0.1:${fake.address().port}`

/* ------------------------------------------------------------
   把 env 摆好再加载被测模块 —— agent.ts 在模块顶层读取环境变量
   ------------------------------------------------------------ */

process.env.DIFY_API_KEY = 'test-key'
/*
  ⚠️ **两把 key 都要打桩** —— 少打一个,下面 `createServer()` 加载 vite.config.ts 时
  会从 private/dify.env 把**真实的那把**注进 process.env,于是被测模块用的是真 key
  (假上游只认 'Bearer test-key',于是一路 502),而且断言挂掉时会把真实的
  Authorization 打印出来。

  同类风险对所有「模块顶层读取的环境变量」都成立:加一个新的就到这里补一行。
*/
process.env.DIFY_CHAT_API_KEY = 'test-key'
process.env.DIFY_API_BASE = upstreamBase

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const agent = await server.ssrLoadModule('/api/_lib/agent.ts')

const post = (body, ip = '10.0.0.1') =>
  agent.handleChat(
    new Request('http://local/api/chat-messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    })
  )

console.log('\n=== 1. 配置与状态 ===')
const status = await agent.handleStatus().json()
check('有 Key 时 available 为 true', status.available === true)
check('状态里不泄漏 Key', !JSON.stringify(status).includes('test-key'), JSON.stringify(status))

console.log('\n=== 2. 正常转发 ===')
const res = await post({ query: '今天盐吃多了吗', user: 'u1' })
const text = await res.text()
check('状态码 200', res.status === 200, String(res.status))
check('content-type 是 SSE', (res.headers.get('content-type') ?? '').includes('text/event-stream'))
check('声明了不要缓冲', res.headers.get('x-accel-buffering') === 'no')
// 断言失败时**只说有没有、不说是什么** —— 这一行detail 曾经原样打印过真实的
// Authorization,而这类断言恰恰是「key 没配好」时才挂,那时打印的就是线上真 key
check('Authorization 头被补上', seen.auth === 'Bearer test-key', seen.auth ? '有头但值不对' : '没有 Authorization 头')
check('分块内容完整', text.includes('"answer":"你"') && text.includes('"answer":"好"'))
check('未把 response_mode 改坏', seen.bodies.at(-1).response_mode === 'streaming')
const cid = JSON.parse(text.split('\n\n')[0].slice(6)).conversation_id
check('conversation_id 透传', cid === 'c1')

console.log('\n=== 3. 上游出错 ===')
const errRes = await post({ query: 'boom' }, '10.0.0.2')
const errBody = await errRes.json()
check('映射为 502', errRes.status === 502, String(errRes.status))
check('带上机器可读的 code', errBody.code === 'UPSTREAM_ERROR', JSON.stringify(errBody))
check('报错信息里不含 Key', !JSON.stringify(errBody).includes('test-key'))

console.log('\n=== 4. 参数校验 ===')
const empty = await post({ query: '   ' }, '10.0.0.3')
check('空 query 返回 400', empty.status === 400, String(empty.status))

// 上界直接取模块里的常量,不写死数字 —— 否则改了上限这条断言会变成假绿
const tooLong = await post({ query: 'x'.repeat(agent.MAX_QUERY_LENGTH + 1) }, '10.0.0.4')
check(`超长 query(>${agent.MAX_QUERY_LENGTH})返回 400`, tooLong.status === 400, String(tooLong.status))

/**
 * 回归:一个记满一天的日记序列化出来是 1145 字左右(见 verify-loop 里那条)。
 * 上限原来定在 1000 时,这里会 400 —— 用户越认真记录越容易撞上,
 * 而界面上的提示是「agent 暂时不可用」,指向完全错误的方向。
 */
const realistic = await post({ query: 'x'.repeat(1145) }, '10.0.0.5')
check('一天的记录长度必须放行', realistic.status === 200, String(realistic.status))
await realistic.text()

const getRes = await agent.handleChat(new Request('http://local/api/chat-messages', { method: 'GET' }))
check('GET 返回 405', getRes.status === 405, String(getRes.status))

console.log('\n=== 5. 限流 ===')
let limited = 0
let allowed = 0
for (let i = 0; i < 15; i++) {
  const r = await post({ query: 'hi' }, '10.9.9.9')
  if (r.status === 429) limited++
  else if (r.status === 200) allowed++
  await r.text()
}
check('窗口内放行 12 次', allowed === 12, `放行 ${allowed}`)
check('超出后返回 429', limited === 3, `拒绝 ${limited}`)

const other = await post({ query: 'hi' }, '10.9.9.10')
check('限流按 IP 隔离,不误伤别人', other.status === 200, String(other.status))
await other.text()

/* ------------------------------------------------------------
   6. 图片识别转发
   ------------------------------------------------------------ */
console.log('\n=== 6. 识别转发 ===')

/** 造一个 multipart 请求,形状和浏览器发的一模一样 */
function recognizeRequest({ file, payload, user = 'web-test', ip = '10.5.0.1', method = 'POST' } = {}) {
  const form = new FormData()
  if (file) {
    form.append('file', new Blob([new Uint8Array(file.bytes ?? 8)], { type: file.type }), file.name)
  }
  form.append('user', user)
  form.append('payload', JSON.stringify(payload ?? { query: '请分析这份餐盘', response_mode: 'streaming' }))
  return new Request('http://local/api/recognize', {
    method,
    headers: { 'x-forwarded-for': ip },
    body: method === 'POST' ? form : undefined,
  })
}

const JPEG = { name: 'IMG_1234.heic', type: 'image/jpeg', bytes: 8 }

// --- 正常链路 ---
fakeMode = 'ok'
const okRes = await agent.handleRecognize(recognizeRequest({ file: JPEG }))
const okText = await okRes.text()
check('识别返回 200', okRes.status === 200, String(okRes.status))
check('识别返回 SSE', (okRes.headers.get('content-type') ?? '').includes('text/event-stream'))
check('识别声明了不要缓冲', okRes.headers.get('x-accel-buffering') === 'no')
check('识别内容分块完整', okText.includes('"answer":"你"') && okText.includes('"answer":"好"'))

// 上传那一步真的被调用了,而且表单能被反解 —— boundary 对得上
const up = seen.uploads.at(-1)
check('上传真的发生了且 multipart 可解析', Boolean(up), up ? 'ok' : '没收到上传')
check('上传带上了 file 字段', Boolean(up?.get('file')), String(up?.get('file')))
check('上传带上了 user 字段', typeof up?.get('user') === 'string', String(up?.get('user')))

/**
 * 文件名必须由服务端按 MIME 决定。
 * 这里刻意用 `IMG_1234.heic` 这个名字 —— 而 Dify 的 allowed_file_extensions
 * 是按扩展名判的,照抄客户端的名字会让一张正常的 JPEG 因为叫 .heic 被拒。
 */
const uploadedFile = up?.get('file')
check(
  '上传的文件名按 MIME 重写成 .jpg',
  typeof uploadedFile === 'object' && uploadedFile.name === 'plate.jpg',
  String(uploadedFile?.name)
)
check('上传的文件 MIME 保留', uploadedFile?.type === 'image/jpeg', String(uploadedFile?.type))

// --- 两步用的是同一个 user(Dify 靠它过滤文件) ---
const chatBody = seen.bodies.at(-1)
check(
  'upload 与 chat 的 user 完全一致',
  up?.get('user') === chatBody?.user,
  `upload=${up?.get('user')} chat=${chatBody?.user}`
)

// --- 图片以 files 数组 + upload_file_id 引用 ---
check(
  'files 数组形状正确',
  JSON.stringify(chatBody?.files) ===
    JSON.stringify([{ type: 'image', transfer_method: 'local_file', upload_file_id: 'file-test-1' }]),
  JSON.stringify(chatBody?.files)
)
check('响应模式是流式', chatBody?.response_mode === 'streaming', String(chatBody?.response_mode))
check('query 原样透传', chatBody?.query === '请分析这份餐盘', String(chatBody?.query))
check(
  '两步都带上了 Authorization',
  seen.uploadAuth === 'Bearer test-key' && seen.chatAuth === 'Bearer test-key',
  `upload=${seen.uploadAuth ? '有头' : '无'} chat=${seen.chatAuth ? '有头' : '无'}`
)

// --- 不传 conversation_id 时不该凭空造一个 ---
check('没有 conversation_id 时不带这个键', !('conversation_id' in (chatBody ?? {})), JSON.stringify(chatBody))

// --- 校验与错误码 ---
/*
  ⚠️ **「没有 `file` 这一项」不是坏请求**（2026-09-24 改的口径）。

  打字问出来的那份草稿在「记入日记」时要交给食衡算营养，而它一张照片都没有
  —— 那一路只把菜名放在 query 里（见 `recognizeTextStream`）。所以这里断的是
  三件事，缺任何一件都是**静默**的：

    · 200 —— 不是 400；
    · **上传那一步没被调用** —— 没图还去传，Dify 会拿到一个空文件；
    · **`files` 键整个不出现** —— 发一个空数组是替工作流做决定，
      而工作流那边读的是「有没有这个键」。
*/
{
  const before = seen.uploads.length
  const noFile = await agent.handleRecognize(recognizeRequest({ file: null, ip: '10.5.0.2' }))
  const noFileText = await noFile.text()
  check('没有 file 是「文字那一趟」,不是坏请求', noFile.status === 200, String(noFile.status))
  check(
    '而且走通了整条链路(SSE 里有回答)',
    noFileText.includes('"answer":"你"'),
    noFileText.slice(0, 80)
  )
  check(
    '没有文件时**不**去上传',
    seen.uploads.length === before,
    `上传被调了 ${seen.uploads.length - before} 次`
  )
  const textBody = seen.bodies.at(-1)
  check(
    '没有文件时**不带** `files` 键(空数组也是替工作流做决定)',
    !('files' in (textBody ?? {})),
    JSON.stringify(textBody?.files)
  )
  check('没有文件时 query 照样原样透传', textBody?.query === '请分析这份餐盘', String(textBody?.query))
}

/*
  反过来：**声明了 `file` 但形状不对**仍然是坏请求。这两种情况不能混成同一个
  400 —— 混了的话，「文字那一趟」这个分支就永远测不出来。
*/
{
  const form = new FormData()
  form.append('file', '')
  form.append('user', 'web-test')
  form.append('payload', JSON.stringify({ query: '请分析这份餐盘', response_mode: 'streaming' }))
  const bad = await agent.handleRecognize(
    new Request('http://local/api/recognize', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.5.0.8' },
      body: form,
    })
  )
  check('声明了 file 但不是文件 → 400', bad.status === 400, String(bad.status))
  check('它的 code 是 BAD_REQUEST', (await bad.json()).code === 'BAD_REQUEST')
}

const emptyFile = await agent.handleRecognize(
  recognizeRequest({ file: { name: 'a.jpg', type: 'image/jpeg', bytes: 0 }, ip: '10.5.0.3' })
)
check('空文件返回 400', emptyFile.status === 400, String(emptyFile.status))
await emptyFile.json()

const pdf = await agent.handleRecognize(
  recognizeRequest({ file: { name: 'a.pdf', type: 'application/pdf', bytes: 8 }, ip: '10.5.0.4' })
)
const pdfBody = await pdf.json()
check('非图片返回 415', pdf.status === 415, String(pdf.status))
check('非图片的 code 是 UNSUPPORTED_IMAGE', pdfBody.code === 'UNSUPPORTED_IMAGE', JSON.stringify(pdfBody))

// payload 不是 JSON
{
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(8)], { type: 'image/jpeg' }), 'a.jpg')
  form.append('user', 'u')
  form.append('payload', '{不是 JSON')
  const r = await agent.handleRecognize(
    new Request('http://local/api/recognize', {
      method: 'POST',
      headers: { 'x-forwarded-for': '10.5.0.6' },
      body: form,
    })
  )
  check('payload 非 JSON 返回 400', r.status === 400, String(r.status))
  await r.json()
}

// 空 query
{
  const r = await agent.handleRecognize(
    recognizeRequest({ file: JPEG, ip: '10.5.0.7', payload: { query: '  ' } })
  )
  check('空 query 返回 400', r.status === 400, String(r.status))
  await r.json()
}

// 请求体不是 multipart
{
  const r = await agent.handleRecognize(
    new Request('http://local/api/recognize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.5.0.8' },
      body: JSON.stringify({ query: 'hi' }),
    })
  )
  check('非 multipart 返回 400', r.status === 400, String(r.status))
  await r.json()
}

// 声明长度超限 —— 要在读 body 之前就拒掉
{
  const r = await agent.handleRecognize(
    new Request('http://local/api/recognize', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(5 * 1024 * 1024),
        'x-forwarded-for': '10.5.0.9',
      },
      body: 'x',
    })
  )
  const b = await r.json()
  check('声明超限返回 413', r.status === 413, String(r.status))
  check('超限的 code 是 PAYLOAD_TOO_LARGE', b.code === 'PAYLOAD_TOO_LARGE', JSON.stringify(b))
}

// 上游上传失败 —— 这个 code 专门用来指向 Dify 侧的配置问题
fakeMode = 'upload-500'
const upFail = await agent.handleRecognize(recognizeRequest({ file: JPEG, ip: '10.5.1.1' }))
const upFailBody = await upFail.json()
check('上传失败返回 502', upFail.status === 502, String(upFail.status))
check('上传失败的 code 是 UPLOAD_FAILED', upFailBody.code === 'UPLOAD_FAILED', JSON.stringify(upFailBody))
check('上传失败的报错里不含 Key', !JSON.stringify(upFailBody).includes('test-key'))

fakeMode = 'upload-no-id'
const noId = await agent.handleRecognize(recognizeRequest({ file: JPEG, ip: '10.5.1.2' }))
const noIdBody = await noId.json()
check('上游没回 id 时也报 UPLOAD_FAILED', noIdBody.code === 'UPLOAD_FAILED', JSON.stringify(noIdBody))

// 上游第二步失败
fakeMode = 'chat-500'
const chatFail = await agent.handleRecognize(recognizeRequest({ file: JPEG, ip: '10.5.1.3' }))
const chatFailBody = await chatFail.json()
check('第二步失败返回 502', chatFail.status === 502, String(chatFail.status))
check('第二步失败的 code 是 UPSTREAM_ERROR', chatFailBody.code === 'UPSTREAM_ERROR', JSON.stringify(chatFailBody))

fakeMode = 'ok'

// --- 方法 ---
const recGet = await agent.handleRecognize(recognizeRequest({ method: 'GET' }))
check('识别端点 GET 返回 405', recGet.status === 405, String(recGet.status))

// --- 识别和对话共用同一个限流桶 ---
{
  const ip = '10.7.7.7'
  let limited = 0
  for (let i = 0; i < 15; i++) {
    const r = await agent.handleRecognize(recognizeRequest({ file: JPEG, ip }))
    if (r.status === 429) limited++
    else await r.text()
  }
  check('识别与对话共用 12 次/分钟的额度', limited > 0, `第 ${12 - limited + 1} 次起被拒`)
}

await server.close()
fake.close()
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
