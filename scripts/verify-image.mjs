/**
 * 图片管线自检(开发用,不进产物)
 * ===========================================================
 * 检查的是 src/lib/image.ts —— 缩放算术和「压不下去就往下压一档」的阶梯。
 *
 * 为什么要在 Node 里测这个:这段逻辑的失败方式是**静默的**。
 * 阶梯少走一档,用户看到的是「上传失败」;fitWithin 多放大了一圈,
 * 用户看到的是「识别不准」—— 两个都不会报错,都不会有人在浏览器里点出来。
 *
 * 浏览器那半(decode/encode)靠注入假实现顶替 —— 所以这里能在没有 canvas
 * 的环境下把控制流和错误码全测了。
 */

import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const img = await server.ssrLoadModule('/src/lib/image.ts')
const { fitWithin, prepareImage, ImageError, MAX_EDGE, THUMB_EDGE } = img

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failures++
}

const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  check(label, ok, ok ? '' : `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

/* ------------------------------------------------------------
   1. fitWithin —— 纯算术
   ------------------------------------------------------------ */
console.log('\n=== 1. fitWithin ===')

eq('横图按长边缩', fitWithin(4000, 3000, 1280), { width: 1280, height: 960 })
eq('竖图按长边缩', fitWithin(3000, 4000, 1280), { width: 960, height: 1280 })
eq('正方形', fitWithin(2000, 2000, 1280), { width: 1280, height: 1280 })
eq('正好等于上限时不动', fitWithin(1280, 720, 1280), { width: 1280, height: 720 })

// 只缩不放 —— 放大会插值出不存在的细节,识别精度不会提高,只是白占体积
eq('小图不放大', fitWithin(200, 150, 1280), { width: 200, height: 150 })
eq('极小图不放大', fitWithin(60, 60, 1280), { width: 60, height: 60 })

// 极端细长:短边 round 到 0 会让 canvas 直接抛异常,所以必须兜到 1
eq('极细长的短边兜到 1', fitWithin(5000, 3, 1280), { width: 1280, height: 1 })

eq('退化输入归零', fitWithin(0, 100, 1280), { width: 0, height: 0 })
eq('非有限数归零', fitWithin(Number.NaN, 100, 1280), { width: 0, height: 0 })
eq('负数归零', fitWithin(-10, 100, 1280), { width: 0, height: 0 })

/* ------------------------------------------------------------
   2. prepareImage —— 阶梯与错误码(注入假实现)
   ------------------------------------------------------------ */
console.log('\n=== 2. prepareImage ===')

/** 造一个假文件。Node 的 File.size 由内容决定,所以体积靠字节数控制 */
function makeFile(name, type, bytes) {
  return new File([new Uint8Array(bytes)], name, { type })
}

/**
 * 假解码器:固定尺寸,encode 按调用顺序返回预设的体积。
 * 记录每次调用的参数,用来断言阶梯到底走了几档、每档传了什么。
 */
function fakeDeps({ width = 4000, height = 3000, sizes = [1000], failDecode = false } = {}) {
  const calls = []
  let i = 0
  return {
    calls,
    deps: {
      async decode() {
        if (failDecode) throw new Error('boom')
        return {
          width,
          height,
          async encode(w, h, q) {
            const size = sizes[Math.min(i, sizes.length - 1)]
            calls.push({ w, h, q, size })
            i++
            return new Blob([new Uint8Array(size)])
          },
        }
      },
      async blobToDataUrl() {
        return 'data:image/jpeg;base64,AAAA'
      },
    },
  }
}

// --- 第一档就过:只编码两次(正文 + 缩略图) ---
{
  const { deps, calls } = fakeDeps({ sizes: [1000] })
  const out = await prepareImage(makeFile('a.jpg', 'image/jpeg', 10), { deps })
  eq('第一档就过时正文尺寸是 1024×768', [calls[0].w, calls[0].h], [1024, 768])
  check('第一档用的质量是 0.8', calls[0].q === 0.8, String(calls[0].q))
  check('只编码了正文 + 缩略图两次', calls.length === 2, `${calls.length} 次`)
  eq('缩略图按 200 长边', [calls[1].w, calls[1].h], [Math.round(THUMB_EDGE), Math.round((THUMB_EDGE * 3000) / 4000)])
  check('缩略图质量 0.6', calls[1].q === 0.6, String(calls[1].q))
  check('返回了缩略图 data URL', out.thumbDataUrl.startsWith('data:'), out.thumbDataUrl.slice(0, 20))
  check('返回了预览 URL', typeof out.previewUrl === 'string' && out.previewUrl.length > 0)
  eq('记录了原图体积', out.sourceBytes, 10)
}

// --- 第一档超限:落到第二档(同尺寸、更低质量) ---
{
  const { deps, calls } = fakeDeps({ sizes: [9_000_000, 1000] })
  const out = await prepareImage(makeFile('a.jpg', 'image/jpeg', 10), { deps })
  check('第一档超限时压了第二档', calls.length === 3, `${calls.length} 次`)
  check('第二档降质量到 0.6', calls[1].q === 0.6, String(calls[1].q))
  check('第二档尺寸不变', calls[1].w === 1024, String(calls[1].w))
  check('最终用的是第二档的结果', out.blob.size === 1000, String(out.blob.size))
}

// --- 前两档都超限:第三档同时降分辨率 ---
{
  const { deps, calls } = fakeDeps({ sizes: [9_000_000, 9_000_000, 1000] })
  const out = await prepareImage(makeFile('a.jpg', 'image/jpeg', 10), { deps })
  eq('第三档降到 960 长边', [calls[2].w, calls[2].h], [960, 720])
  check('最终用的是第三档', out.blob.size === 1000, String(out.blob.size))
  eq('返回的尺寸跟着最终那一档', [out.width, out.height], [960, 720])
}

// --- 每一档都压不下去 ---
{
  const { deps } = fakeDeps({ sizes: [9_000_000] })
  let code = null
  try {
    await prepareImage(makeFile('a.jpg', 'image/jpeg', 10), { deps })
  } catch (err) {
    code = err instanceof ImageError ? err.code : `NOT_IMAGE_ERROR:${err}`
  }
  check('全部超限时抛 TOO_LARGE', code === 'TOO_LARGE', String(code))
}

/* ---------- 错误码 ---------- */
{
  let code = null
  try {
    await prepareImage(makeFile('empty.jpg', 'image/jpeg', 0), { deps: fakeDeps().deps })
  } catch (err) {
    code = err?.code
  }
  check('空文件 → EMPTY', code === 'EMPTY', String(code))
}
{
  let code = null
  try {
    await prepareImage(makeFile('doc.pdf', 'application/pdf', 10), { deps: fakeDeps().deps })
  } catch (err) {
    code = err?.code
  }
  check('非图片 → NOT_IMAGE', code === 'NOT_IMAGE', String(code))
}
{
  const { deps } = fakeDeps({ failDecode: true })
  let code = null
  try {
    await prepareImage(makeFile('a.heic', 'image/heic', 10), { deps })
  } catch (err) {
    code = err?.code
  }
  check('解码失败 → DECODE_FAILED', code === 'DECODE_FAILED', String(code))
}
{
  // 尺寸读成 0(解码器返回了坏数据)也该走 DECODE_FAILED,而不是拿 0×0 去开 canvas
  const deps = {
    async decode() {
      return { width: 0, height: 0, async encode() { return new Blob([]) } }
    },
    async blobToDataUrl() { return '' },
  }
  let code = null
  try {
    await prepareImage(makeFile('a.jpg', 'image/jpeg', 10), { deps })
  } catch (err) {
    code = err?.code
  }
  check('解码出 0 尺寸 → DECODE_FAILED', code === 'DECODE_FAILED', String(code))
}

// --- 空 type 的扩展名兜底(部分安卓选择器会给空 type) ---
{
  const { deps } = fakeDeps({ sizes: [1000] })
  const out = await prepareImage(makeFile('IMG_1234.JPG', '', 10), { deps })
  check('空 MIME 但扩展名是图片 → 放行', typeof out.previewUrl === 'string')
}
{
  let code = null
  try {
    await prepareImage(makeFile('notes.txt', '', 10), { deps: fakeDeps().deps })
  } catch (err) {
    code = err?.code
  }
  check('空 MIME 且扩展名不是图片 → NOT_IMAGE', code === 'NOT_IMAGE', String(code))
}

// --- 关闭缩略图时不该多编一次 ---
{
  const { deps, calls } = fakeDeps({ sizes: [1000] })
  const out = await prepareImage(makeFile('a.jpg', 'image/jpeg', 10), { deps, withThumb: false })
  check('withThumb:false 时只编码一次', calls.length === 1, `${calls.length} 次`)
  check('withThumb:false 时缩略图为空串', out.thumbDataUrl === '', out.thumbDataUrl)
}

check('MAX_EDGE 是 1024', MAX_EDGE === 1024, String(MAX_EDGE))

await server.close()
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
