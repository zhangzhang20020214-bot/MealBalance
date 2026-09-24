#!/usr/bin/env node
/**
 * 从 Figma REST API 拉取设计稿,生成:
 *   private/design/figma-raw.json     完整原始数据(供程序化处理)
 *   private/design/figma-summary.txt  人类可读的结构摘要(供快速理解设计)
 *   design/tokens.json                提取出的设计变量(色板/字号/间距/圆角)
 *
 * ⚠️ 输出路径是刻意分开的:
 *   - 原始数据与摘要里含有设计稿的全部文字,包括账号昵称、手机号等个人信息。
 *     它们一律写进 private/(已被 .gitignore 排除),不会进入 GitHub。
 *   - tokens.json 只有颜色/字号/间距这类设计变量,不含任何文字内容,
 *     所以留在 design/ 作为仓库的公开设计参考。
 *   如果以后设计稿里出现了新的隐私字段,不需要改脚本 —— 原始数据本来就不外发。
 *
 * 用法:
 *   node scripts/fetch-figma.mjs               # 拉取整个文件
 *   node scripts/fetch-figma.mjs --depth 4     # 限制层级深度
 *   node scripts/fetch-figma.mjs --node 0-1    # 只拉某个节点
 *
 * Token 从 private/figma-token.txt 读取 —— 该目录已被 .gitignore 排除。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN_FILE = path.join(ROOT, 'private', 'figma-token.txt')
/** 含设计稿原文的产物落这里 —— private/ 已被 gitignore */
const RAW_DIR = path.join(ROOT, 'private', 'design')
/** 只放不含文字的设计变量,可以公开 */
const PUBLIC_DIR = path.join(ROOT, 'design')

const FILE_KEY = 'w50PZF6lE5ZtiNjaEqxzxW'

// ---------- 读取 token ----------
function readToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    fail(`找不到 ${path.relative(ROOT, TOKEN_FILE)}\n请先创建该文件并粘贴 Figma Personal Access Token。`)
  }
  const raw = fs.readFileSync(TOKEN_FILE, 'utf-8')
  // 取第一行形如 token 的内容,跳过中文说明行
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (t.startsWith('figd_')) return t
  }
  fail(
    '没能在 private/figma-token.txt 里找到有效 token。\n' +
      'token 应以 figd_ 开头,请确认已粘贴且未保留占位说明文字。'
  )
}

function fail(msg) {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}

// ---------- 参数解析 ----------
const argv = process.argv.slice(2)
const getArg = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? null : argv[i + 1]
}
const depth = getArg('--depth')
const nodeId = getArg('--node')

// ---------- 请求 Figma ----------
async function figma(endpoint) {
  const res = await fetch(`https://api.figma.com/v1${endpoint}`, {
    headers: { 'X-Figma-Token': readToken() },
  })

  if (res.status === 403) {
    fail('403 Forbidden —— token 无效/已撤销,或没有该文件的读取权限。')
  }
  if (res.status === 404) {
    fail(`404 Not Found —— 文件 key 不存在或无权访问:${FILE_KEY}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    fail(`请求失败 HTTP ${res.status}\n${body.slice(0, 500)}`)
  }
  return res.json()
}

// ---------- 遍历工具 ----------
const isContainer = (n) =>
  Array.isArray(n.children) && ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET', 'SECTION'].includes(n.type)

/** 把 Figma 的 0-1 数值转成 #RRGGBB */
const toHex = (c) => {
  if (!c) return null
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, '0')
  const hex = `#${h(c.r)}${h(c.g)}${h(c.b)}`.toUpperCase()
  return c.a !== undefined && c.a < 1 ? `${hex} (${Math.round(c.a * 100)}%)` : hex
}

const round = (n) => (n == null ? null : Math.round(n * 100) / 100)

// ---------- 生成结构摘要 ----------
function summarize(doc) {
  const lines = []
  const tokens = { colors: new Map(), fontSizes: new Map(), fontFamilies: new Map(), radii: new Map(), spacings: new Map() }

  const bump = (map, key) => {
    if (key == null || key === '' || key === 'MIXED') return
    map.set(key, (map.get(key) || 0) + 1)
  }

  function walk(node, indent, maxDepth) {
    if (maxDepth != null && indent > maxDepth) return

    const pad = '  '.repeat(indent)
    let line = `${pad}${node.type} "${node.name}"`

    // 尺寸与位置
    if (node.absoluteBoundingBox) {
      const b = node.absoluteBoundingBox
      line += `  [${round(b.width)}×${round(b.height)} @ ${round(b.x)},${round(b.y)}]`
    }

    // 文本内容 + 排版
    if (node.type === 'TEXT' && typeof node.characters === 'string') {
      const chars = node.characters.replace(/\n/g, '\\n')
      const truncated = chars.length > 60 ? chars.slice(0, 60) + '…' : chars
      line += `  = "${truncated}"`
      const s = node.style
      if (s) {
        line += `  ⟨${s.fontFamily} ${s.fontWeight} ${s.fontSize}px`
        if (s.lineHeightPx) line += `/${round(s.lineHeightPx)}`
        if (s.letterSpacing) line += ` ls:${round(s.letterSpacing)}`
        if (s.textAlignHorizontal && s.textAlignHorizontal !== 'LEFT') line += ` ${s.textAlignHorizontal}`
        line += '⟩'
        bump(tokens.fontSizes, s.fontSize)
        bump(tokens.fontFamilies, `${s.fontFamily} ${s.fontWeight}`)
      }
    }

    lines.push(line)

    // 收集设计变量
    if (Array.isArray(node.fills)) {
      for (const f of node.fills) {
        if (f.visible === false) continue
        if (f.type === 'SOLID') bump(tokens.colors, toHex(f.color))
        if (f.type?.startsWith('GRADIENT')) bump(tokens.colors, `gradient:${f.type}`)
      }
    }
    if (Array.isArray(node.strokes)) {
      for (const s of node.strokes) {
        if (s.visible === false) continue
        if (s.type === 'SOLID') bump(tokens.colors, `stroke:${toHex(s.color)}`)
      }
    }
    for (const k of ['cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) {
      if (typeof node[k] === 'number' && node[k] > 0) bump(tokens.radii, `${node[k]}px`)
    }
    if (typeof node.itemSpacing === 'number' && node.itemSpacing > 0) bump(tokens.spacings, `${node.itemSpacing}px`)
    for (const k of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom']) {
      if (typeof node[k] === 'number' && node[k] > 0) bump(tokens.spacings, `${node[k]}px`)
    }

    if (isContainer(node) && node.children) {
      for (const c of node.children) walk(c, indent + 1, maxDepth)
    }
  }

  for (const page of doc.document.children ?? []) {
    lines.push('')
    lines.push('═'.repeat(70))
    lines.push(`📄 页面: ${page.name}`)
    lines.push('═'.repeat(70))
    for (const child of page.children ?? []) walk(child, 0, depth ? Number(depth) : null)
  }

  // 设计变量排行
  const top = (map, n = 20) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${String(k).padEnd(28)} ×${v}`)

  lines.push('', '', '═'.repeat(70), '🎨 设计变量统计', '═'.repeat(70))
  const sect = (title, arr) => {
    lines.push('', `── ${title} ──`)
    lines.push(...(arr.length ? arr : ['(无)']))
  }
  sect('颜色(填充)', top(tokens.colors))
  sect('字号', top(tokens.fontSizes))
  sect('字体 / 字重', top(tokens.fontFamilies))
  sect('圆角', top(tokens.radii))
  sect('间距 / 内边距', top(tokens.spacings))

  return {
    text: lines.join('\n'),
    tokens: {
      colors: Object.fromEntries(tokens.colors),
      fontSizes: Object.fromEntries(tokens.fontSizes),
      fontFamilies: Object.fromEntries(tokens.fontFamilies),
      radii: Object.fromEntries(tokens.radii),
      spacings: Object.fromEntries(tokens.spacings),
    },
  }
}

// ---------- 主流程 ----------
async function main() {
  console.log(`\n🎨 正在从 Figma 拉取设计稿…`)
  console.log(`   文件 key: ${FILE_KEY}`)
  if (nodeId) console.log(`   节点:     ${nodeId}`)
  if (depth) console.log(`   深度限制: ${depth}`)

  const query = new URLSearchParams()
  if (depth) query.set('depth', depth)
  const qs = query.toString() ? `?${query}` : ''

  const doc = await figma(`/files/${FILE_KEY}${qs}`)

  fs.mkdirSync(RAW_DIR, { recursive: true })
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })

  const { text, tokens } = summarize(doc)

  // 含设计稿原文 —— 只写进 private/
  fs.writeFileSync(path.join(RAW_DIR, 'figma-raw.json'), JSON.stringify(doc, null, 2), 'utf-8')
  fs.writeFileSync(path.join(RAW_DIR, 'figma-summary.txt'), text, 'utf-8')

  // 不含文字,可公开
  fs.writeFileSync(path.join(PUBLIC_DIR, 'tokens.json'), JSON.stringify(tokens, null, 2), 'utf-8')

  const pages = doc.document.children?.length ?? 0
  const frames = countFrames(doc.document)

  console.log(`\n✅ 拉取成功`)
  console.log(`   文件名称: ${doc.name}`)
  console.log(`   页面数量: ${pages}`)
  console.log(`   画板数量: ${frames}`)
  console.log(`   更新时间: ${doc.lastModified}`)
  console.log(`\n   已写入(🔒 = 含设计稿原文,不进 Git):`)
  console.log(`   🔒 private/design/figma-raw.json      原始数据`)
  console.log(`   🔒 private/design/figma-summary.txt   结构摘要`)
  console.log(`      design/tokens.json                 设计变量(可公开)`)
  console.log(`\n👉 接下来运行: cat private/design/figma-summary.txt\n`)
}

function countFrames(node) {
  let n = 0
  const walk = (x) => {
    if (x.type === 'FRAME') n++
    for (const c of x.children ?? []) walk(c)
  }
  walk(node)
  return n
}

main().catch((e) => fail(e.stack || String(e)))
