/**
 * 图片管线 —— 拍照/相册选到的文件 → 能发给模型的 JPEG + 能存进日记的缩略图
 * ===========================================================
 * 为什么要把原图**重新编码**一遍,而不是直接传上去 —— 三个约束叠在一起:
 *
 *   1. **iPhone 默认拍 HEIC**,而这个 Dify 应用的 allowed_file_extensions
 *      白名单里没有 HEIC。不转码,iPhone 传的每一张都会被拒。
 *   2. **手机原图 3–8MB**,而 Vercel Serverless 的请求体上限约 4.5MB。
 *      不压缩,相当一部分照片根本发不出去。
 *   3. Dify 侧还有 10MB 的图片上限。
 *
 * 一次 canvas 重编码同时解决这三条 —— 所以这一步不是优化,是必需品。
 *
 * 为什么用 <img> 解码而不是 createImageBitmap
 * ------------------------------------------------------------
 * Safari 对 HEIC 的 <img> 解码支持最稳,而且 <img> 会自动应用 EXIF 方向 ——
 * 竖着拍的照片不会在结果页变成横的。createImageBitmap 要额外传
 * imageOrientation 才等价,漏了就悄悄转 90 度。
 *
 * 失败一律显式抛错
 * ------------------------------------------------------------
 * 解码失败(比如桌面 Chrome 打开 HEIC)、选了非图片、压完仍超限 ——
 * 全部抛带错误码的 ImageError。这里**不做任何静默兜底**:静默失败会让用户
 * 以为拍成功了,然后对着一份没送出去的图等一个不会来的结果。
 *
 * 只有 fitWithin 和 encodeLadder 是纯逻辑,可以在 Node 里直接测 ——
 * 见 scripts/verify-image.mjs。所以这个模块的顶层**不碰任何浏览器全局**,
 * document / URL / FileReader 只出现在函数体里。
 */

/* ------------------------------------------------------------
   参数
   ------------------------------------------------------------ */

/**
 * 发给模型的那张的长边上限。
 *
 * 2026-09-23 从 1280 降到 1024 —— 这是一笔**量过的账**,不是拍的:
 *
 *     1280×1707  →  LLM 节点 prompt 8416 token,首字延迟 17.7 秒
 *     1024×1366  →  LLM 节点 prompt 6928 token,首字延迟 11.8 秒
 *
 * 同一张图、同一个工作流、前后隔十几分钟。图片 token 是按**面积**算的
 * (1280² ÷ 1024² = 1.56,实测那 4400 : 2900 对得上),所以降一档省掉约
 * 1500 token 和近 6 秒的等待,而**输出那 430 个 token 的生成时间一点没变**
 * (433 → 435)—— 省下来的全是「模型开口之前」的那段。
 *
 * 为什么不继续往下压:收益是线性的,代价不是。餐盘照上最先糊掉的是小碟子
 * 和包装上的小字,而这两样恰恰是认菜和读配料表要用的。1024 是「还认得清」
 * 和「少等 6 秒」的交点。
 *
 * ⚠️ 想调回去(或调更高)之前先回去做一次上面那个对照实验 —— 高出来的
 * 不是清晰度,是白等的十几秒。
 */
export const MAX_EDGE = 1024
export const JPEG_QUALITY = 0.8

/** 存进日记的缩略图 —— 长边 200px,q0.6,约 8–12KB */
export const THUMB_EDGE = 200
export const THUMB_QUALITY = 0.6

/** 压缩后仍超过这个体积就往下压一档。Vercel 请求体上限约 4.5MB,留出余量 */
export const MAX_UPLOAD_BYTES = 3_000_000

/* ------------------------------------------------------------
   错误
   ------------------------------------------------------------ */

export type ImageErrorCode =
  /** 选了个空文件 */
  | 'EMPTY'
  /** 根本不是图片 */
  | 'NOT_IMAGE'
  /** 浏览器解不开(HEIC on Chrome 是典型) */
  | 'DECODE_FAILED'
  /** canvas 编码失败 */
  | 'ENCODE_FAILED'
  /** 压到最后一档还是超限 */
  | 'TOO_LARGE'

export class ImageError extends Error {
  constructor(
    public readonly code: ImageErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ImageError'
  }
}

/* ------------------------------------------------------------
   纯逻辑 —— 与浏览器无关,可在 Node 里测
   ------------------------------------------------------------ */

/**
 * 等比缩到长边不超过 maxEdge。
 *
 * **只缩不放** —— 一张 200×200 的图传进来仍然返回 200×200。
 * 放大会凭空插值出并不存在的细节,识别精度不会因此提高,只会让上传变慢。
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE
): { width: number; height: number } {
  // 退化输入(解码坏了、尺寸为 0)统一返回 0,由调用方当解码失败处理
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 }
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    // 至少留 1px —— round 到 0 会让 canvas 直接抛异常
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export interface EncodeRung {
  maxEdge: number
  quality: number
}

/**
 * 逐档往下压的阶梯。正常情况下第一档就过(1024px q0.8 的 JPEG 约 100–250KB),
 * 后面几档是保险 —— 遇到极端高熵的图(比如满屏叶子的照片)时
 * 单靠调质量压不到位,必须同时降分辨率。
 */
export const ENCODE_LADDER: readonly EncodeRung[] = [
  { maxEdge: MAX_EDGE, quality: JPEG_QUALITY },
  { maxEdge: MAX_EDGE, quality: 0.6 },
  { maxEdge: 960, quality: 0.6 },
  { maxEdge: 800, quality: 0.5 },
]

/* ------------------------------------------------------------
   依赖注入 —— 让上面那些逻辑能在没有 canvas 的环境里跑
   ------------------------------------------------------------ */

/**
 * 解码后的一张图。只保留「取值」和「按指定尺寸编码」两个能力 ——
 * 测试里注入一个假实现就够了,不需要真的 canvas。
 */
export interface DecodedImage {
  width: number
  height: number
  encode(width: number, height: number, quality: number): Promise<Blob>
}

export interface ImageDeps {
  decode(file: File): Promise<DecodedImage>
  blobToDataUrl(blob: Blob): Promise<string>
}

/* ------------------------------------------------------------
   浏览器实现
   ------------------------------------------------------------ */

async function decodeInBrowser(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file)
  const img = new Image()

  try {
    img.src = url
    // decode() 失败会 reject —— 这里不 catch,交给 prepareImage 统一转成
    // DECODE_FAILED,免得同一件事有两个错误出口
    await img.decode()
  } finally {
    // 解码完成后位图已经留在 img 里,撤销 object URL 不影响后续 drawImage。
    // 放在 finally 是为了失败路径也不泄漏
    URL.revokeObjectURL(url)
  }

  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    async encode(width: number, height: number, quality: number) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) throw new ImageError('ENCODE_FAILED', '当前浏览器不支持 canvas，无法压缩图片。')

      ctx.drawImage(img, 0, 0, width, height)

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality)
      })
      if (!blob) throw new ImageError('ENCODE_FAILED', '图片编码失败，请换一张试试。')
      return blob
    },
  }
}

function blobToDataUrlInBrowser(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new ImageError('ENCODE_FAILED', '缩略图读取失败。'))
    reader.readAsDataURL(blob)
  })
}

const BROWSER_DEPS: ImageDeps = {
  decode: decodeInBrowser,
  blobToDataUrl: blobToDataUrlInBrowser,
}

/* ------------------------------------------------------------
   主流程
   ------------------------------------------------------------ */

export interface PreparedImage {
  /** 真正要上传的 JPEG —— 压缩后的字节 */
  blob: Blob
  /**
   * 预览用的 object URL。**由调用方统一持有并负责 revoke** ——
   * 只有一个所有者,才不会漏也不能重复撤销。
   *
   * 实际的责任链是这样的:`recognizeOne`(`src/store/recognizeOne.ts`)调本函数
   * 拿到它,压缩完发现这次结果已经不要了就**当场撤销**;还要的话经 `onPrepared`
   * 交给它的调用方(首页那条链是 `src/store/plate.ts`),从此归对方管。
   * 也就是说,**只有一个所有者**,而且移交只发生一次。
   *
   * 它指向的是**重编码后**的那份,不是原图 —— 所以用户在结果页看到的那张,
   * 就是模型看到的那张,没有偏差。
   */
  previewUrl: string
  /** 进日记的缩略图,data URL。编码失败时是空串 */
  thumbDataUrl: string
  width: number
  height: number
  sourceName: string
  sourceBytes: number
}

export interface PrepareOptions {
  maxBytes?: number
  ladder?: readonly EncodeRung[]
  deps?: ImageDeps
  /** 只发不存时跳过缩略图编码,省一次 canvas 操作 */
  withThumb?: boolean
}

/** 扩展名兜底 —— 部分 Android 选择器会给空 type */
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i

function looksLikeImage(file: File): boolean {
  if (file.type) return file.type.startsWith('image/')
  return IMAGE_EXT_RE.test(file.name)
}

/**
 * 把一个用户选的文件处理成可上传的 JPEG(+ 可选缩略图)。
 *
 * @throws {ImageError} 非图片 / 空文件 / 解不开 / 压不下去
 */
export async function prepareImage(file: File, opts: PrepareOptions = {}): Promise<PreparedImage> {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES
  const ladder = opts.ladder ?? ENCODE_LADDER
  const deps = opts.deps ?? BROWSER_DEPS

  if (file.size === 0) {
    throw new ImageError('EMPTY', '这个文件是空的，换一张试试。')
  }
  if (!looksLikeImage(file)) {
    throw new ImageError('NOT_IMAGE', '这不是图片文件，请选择一张照片。')
  }

  let decoded: DecodedImage
  try {
    decoded = await deps.decode(file)
  } catch (err) {
    // 已经是 ImageError 就原样往上抛(比如 canvas 挂了),不要重新包装成
    // 「解码失败」—— 那会把「浏览器不支持这个格式」和「canvas 不可用」
    // 两个完全不同的问题说成同一句
    if (err instanceof ImageError) throw err
    throw new ImageError(
      'DECODE_FAILED',
      '这张图片打不开 —— 可能是浏览器不支持的格式（如 HEIC），换一张或改用手动记录。'
    )
  }

  if (!decoded.width || !decoded.height) {
    throw new ImageError('DECODE_FAILED', '这张图片的尺寸读不出来，换一张试试。')
  }

  let blob: Blob | null = null
  let finalWidth = 0
  let finalHeight = 0

  for (const rung of ladder) {
    const size = fitWithin(decoded.width, decoded.height, rung.maxEdge)
    const candidate = await decoded.encode(size.width, size.height, rung.quality)
    if (candidate.size > 0 && candidate.size <= maxBytes) {
      blob = candidate
      finalWidth = size.width
      finalHeight = size.height
      break
    }
  }

  if (!blob) {
    throw new ImageError('TOO_LARGE', '这张图片压缩后仍然太大，请换一张或改用手动记录。')
  }

  // 缩略图从**同一张已解码的图**再画一次,而不是重新解码 ——
  // 解码是这条链路上最贵的一步,没必要付两遍
  let thumbDataUrl = ''
  if (opts.withThumb !== false) {
    const thumbSize = fitWithin(decoded.width, decoded.height, THUMB_EDGE)
    const thumbBlob = await decoded.encode(thumbSize.width, thumbSize.height, THUMB_QUALITY)
    if (thumbBlob.size > 0) thumbDataUrl = await deps.blobToDataUrl(thumbBlob)
  }

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    thumbDataUrl,
    width: finalWidth,
    height: finalHeight,
    sourceName: file.name,
    sourceBytes: file.size,
  }
}
