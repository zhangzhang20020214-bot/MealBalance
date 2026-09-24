/**
 * 生成 PWA 图标(开发用,产物已提交到 public/icons)
 * ===========================================================
 * 为什么用脚本画而不是塞几张 PNG 进仓库:
 *   1. 图标和 App 的品牌色、盾牌勾的造型同源,改色只需改这一个文件
 *   2. 不引入任何图形库 —— PNG 编码用 Node 自带的 zlib 就够了
 *
 * 画法:先按行插值铺品牌渐变,再用「到线段的距离」当笔刷描出盾牌与勾,
 * 边缘用 3×3 超采样做抗锯齿。
 *
 * 跑法:npm run icons
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/* ------------------------------------------------------------
   PNG 编码
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
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([len, typeAndData, crc])
}

/** rgba: Uint8Array,长度 = w * h * 4 */
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 颜色类型:RGBA
  // 10-12 保持 0:默认压缩、默认滤波、非隔行

  // 每行前面加一个滤波类型字节(0 = None)。图小,不值得上滤波
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------
   几何 —— 坐标统一用 0..100 的设计空间,绘制时再缩放
   ------------------------------------------------------------ */

/** 盾牌外轮廓。和 App 里 shieldCheck 图标的造型对齐 */
const SHIELD = [
  [50, 12],
  [84, 25],
  [84, 50],
  [50, 89],
  [16, 50],
  [16, 25],
]

/** 勾:两段折线 */
const CHECK = [
  [33, 50],
  [45, 62],
  [68, 36],
]

/** 点到线段的距离 */
function distToSegment(px, py, [x1, y1], [x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function distToPolyline(px, py, pts) {
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, distToSegment(px, py, pts[i], pts[i + 1]))
  }
  return best
}

/** 闭合多边形:边界也算 */
function distToPolygon(px, py, pts) {
  let best = Infinity
  for (let i = 0; i < pts.length; i++) {
    best = Math.min(best, distToSegment(px, py, pts[i], pts[(i + 1) % pts.length]))
  }
  return best
}

/** 把 0..1 的覆盖度转成平滑过渡,消除锯齿 */
function smooth(edge, feather) {
  return Math.min(1, Math.max(0, edge / feather + 0.5))
}

/* ------------------------------------------------------------
   绘制
   ------------------------------------------------------------ */

const BG_TOP = [52, 199, 89] // #34C759
const BG_BOTTOM = [31, 154, 68] // #1F9A44
const FG = [255, 255, 255]

const STROKE = 7 // 线宽(设计空间的单位)
/** 图形占画布的比例。留足边距,同时满足 Android maskable 的安全区要求 */
const MARK_SCALE = 0.56

function render(size) {
  const rgba = new Uint8Array(size * size * 4)
  const SS = 3 // 每像素 3×3 超采样
  const markSize = size * MARK_SCALE
  const markOffset = (size - markSize) / 2
  // 设计空间 100 单位 → 实际像素;描边宽度也要跟着缩放
  const unit = markSize / 100
  const feather = unit * 1.2

  for (let y = 0; y < size; y++) {
    // 背景按行插值,和 App 里「拍餐盘」按钮的渐变一致
    const t = y / (size - 1)
    const bg = [
      Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
      Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
      Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
    ]

    for (let x = 0; x < size; x++) {
      let cover = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS - markOffset) / unit
          const py = (y + (sy + 0.5) / SS - markOffset) / unit

          // 到盾牌描边与勾的距离,取最近的那条 —— 两者共用同一支笔
          const d = Math.min(distToPolygon(px, py, SHIELD), distToPolyline(px, py, CHECK))
          cover += 1 - smooth(d - STROKE / 2, feather / unit)
        }
      }
      const alpha = cover / (SS * SS)

      const i = (y * size + x) * 4
      rgba[i] = Math.round(bg[0] + (FG[0] - bg[0]) * alpha)
      rgba[i + 1] = Math.round(bg[1] + (FG[1] - bg[1]) * alpha)
      rgba[i + 2] = Math.round(bg[2] + (FG[2] - bg[2]) * alpha)
      rgba[i + 3] = 255
    }
  }

  return encodePNG(size, size, rgba)
}

/* ------------------------------------------------------------
   输出
   ------------------------------------------------------------ */

const outDir = path.join(import.meta.dirname, '..', 'public', 'icons')
fs.mkdirSync(outDir, { recursive: true })

const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  // iOS 加到主屏用的尺寸。iOS 不接受 SVG,必须是 PNG
  ['apple-touch-icon.png', 180],
  ['favicon-32.png', 32],
]

for (const [name, size] of targets) {
  const file = path.join(outDir, name)
  fs.writeFileSync(file, render(size))
  console.log(`  ${name.padEnd(24)} ${size}×${size}  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`)
}

console.log('\n图标已生成到 public/icons/\n')
