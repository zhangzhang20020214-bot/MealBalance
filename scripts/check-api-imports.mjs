/**
 * api/ 相对导入自检 —— 防「本地全绿、只有线上挂」
 * ===========================================================
 * 这是 2026-09-24 那次线上事故的守卫。那天 /api/status、/api/chat-messages、
 * /api/recognize **三个端点全部** 500,原因是三个转发文件都写着:
 *
 *     import { handleStatus } from './_lib/agent'   ← 少一个 .js
 *
 * package.json 是 `"type": "module"`,而 Vercel 处理 api/ 是**逐个文件**
 * 编译 TS → JS(Node 原生 ESM 解析,不打包),import 说明符**原样保留**。
 * Node 的 ESM 解析器要求相对路径写全扩展名,于是:
 *
 *     ERR_MODULE_NOT_FOUND → 函数在加载阶段就崩 → 该文件所有端点一律 500
 *
 * **这个错本地发现不了**,三条路全都躲得过去:
 *   · 手测  —— dev 走 vite.config.ts 的 ssrLoadModule,路径是写全的
 *   · tsc   —— moduleResolution 是 bundler,允许省略扩展名
 *   · build —— 同上,而且它只在类型层解析,不会在产物里补说明符
 * 所以它躲过了本地手测、躲过了 15839 行 verify 脚本、躲过了 `npm run build`。
 *
 * 因此这个检查挂在 `npm run build` **前面** —— Vercel 跑的就是它,
 * 等于每次部署自动执行。命中时**构建失败**、上一个能用的版本继续服务,
 * 而不是把「静默全挂」的版本推上线。注释挡不住人顺手删,机器挡得住。
 *
 * 为什么是「先抹注释、再正则」而不是直接正则
 * ------------------------------------------------------------
 * 因为**注释里就会提到 `'./_lib/agent'` 这个错误写法** —— api/_lib/agent.ts
 * 的文件头正在讲这件事。直接正则分不清注释和代码,会把一个**正确**的仓库
 * 判成错的,于是每次构建都红。所以必须先把注释抹成空白。
 *
 * 为什么不直接上 TypeScript 编译器拿 AST(更严谨)
 * ------------------------------------------------------------
 * 因为**这条路已经不通了**:本仓库装的是 `typescript@7`(原生版),
 * 它不再提供编译器 API —— `ts.createSourceFile` / `ts.ScriptTarget` 都不存在,
 * 顶层只导出 version 之类。所以只能自己抹注释,好在规则本身很简单。
 *
 * 抹注释的状态机要处理「`//` 出现在字符串里不算注释」这类情况,所以是
 * 逐字符走,而不是 `replace(/\/\/.*$/gm, '')`。**已知的粗糙处**:模板字面量
 * `${}` 里的内容被当成纯文本(不当作代码),正则字面量里的引号也可能骗到它。
 * 这两种情况在 api/ 下都不存在,而且方向是**宁可漏报不误报** ——
 * 误报会让构建无故变红,比漏报更烦人。
 *
 * 只扫 api/
 * ------------------------------------------------------------
 * src/ 是 Vite 打包的,那边省略扩展名是**对的**(bundler 会解析),
 * 别看到这个脚本就顺手去改 src/。
 *
 * 跑法:node scripts/check-api-imports.mjs(或 `npm run check:imports`)
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const API_DIR = join(ROOT, 'api')

/** 相对导入允许的扩展名 —— 线上产物是 .js,不是 .ts */
const OK_EXT = ['.js', '.mjs', '.cjs', '.json']

/** 递归收集 api/ 下的 .ts(跳过 .d.ts,那是类型声明不是模块) */
function collect(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collect(full))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out.sort()
}

/**
 * 把注释抹成空白,**保留换行**(这样行号还對得上原文件);
 * 字符串和模板字面量原样留着 —— import 说明符本身就在引号里,不能一起抹掉。
 */
function maskComments(src) {
  let out = ''
  let i = 0
  const n = src.length

  while (i < n) {
    const ch = src[i]

    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }

    if (ch === '/' && src[i + 1] === '*') {
      out += '  '
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) {
        out += '  '
        i += 2
      }
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      out += ch
      i++
      while (i < n) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '')
          i += 2
          continue
        }
        out += src[i]
        const closed = src[i] === quote
        i++
        if (closed) break
      }
      continue
    }

    out += ch
    i++
  }

  return out
}

if (!existsSync(API_DIR)) {
  console.log('api/ 不存在,跳过检查')
  process.exit(0)
}

const problems = []
let specifiers = 0

for (const file of collect(API_DIR)) {
  const masked = maskComments(readFileSync(file, 'utf8'))
  // 报错里的路径统一用 /,免得 Windows 上打出反斜杠、和文档对不上
  const where = relative(ROOT, file).replace(/\\/g, '/')
  const lineAt = (index) => masked.slice(0, index).split('\n').length

  const flag = (spec, index) => {
    if (!spec.startsWith('.')) return // 裸包名交给 Node 自己解析,不归这里管
    specifiers++
    if (OK_EXT.some((ext) => spec.endsWith(ext))) return

    const at = `${where}:${lineAt(index)}`
    problems.push(
      /\.tsx?$/.test(spec)
        ? `${at}  '${spec}' 写成了 .ts —— 线上是 .js,要写 '${spec.replace(/\.tsx?$/, '.js')}'`
        : `${at}  '${spec}' 缺扩展名 —— 要写 '${spec}.js'`,
    )
  }

  // 三条都要管:import ... from、export ... from、以及副作用 import '...'
  for (const re of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ]) {
    for (const m of masked.matchAll(re)) flag(m[1], m.index)
  }
}

console.log(`api/ 相对导入自检 —— ${specifiers} 条相对导入`)

if (problems.length === 0) {
  console.log('  ok   全都带扩展名,线上不会 ERR_MODULE_NOT_FOUND\n')
  process.exit(0)
}

console.log('')
for (const p of problems) console.log(` FAIL  ${p}`)
console.log(`
Vercel 把 api/ 下的 .ts **逐个**编译成 .js(Node 原生 ESM 解析,不打包),
import 说明符原样保留;而 Node 要求相对路径写全扩展名。少一个是:
ERR_MODULE_NOT_FOUND → 函数加载失败 → 该文件所有端点一律 500。
本地 dev / tsc / build 都察觉不到,理由见 api/_lib/agent.ts 文件头。
`)
process.exit(1)
