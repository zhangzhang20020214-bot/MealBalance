/**
 * 生成「食物库目录」提示词片段(开发用,不进产物)
 * ===========================================================
 * 跑法:`npm run catalog`
 *
 * 它把 `src/data/foods.ts` 里的 id 和名字整理成一段**可以直接粘进 Dify 提示词**
 * 的文本,写到 `dify/catalog-prompt.txt`。粘到工作流里那个 LLM 节点的提示词后面,
 * 模型就能在**封闭集合**里挑 foodId,而不是随口编一个。

 * 为什么用脚本生成而不是手写一段贴进 README
 * ------------------------------------------------------------
 * 目录是从食物库**现读**的。手抄一份的结局是:你往库里加了三条菜,而提示词里
 * 那份还是旧的 —— 于是新菜永远挑不中,而没有任何地方会报错。这个仓库里
 * `design/tokens.json` 是同一个模式(由 fetch-figma.mjs 生成),理由一样。
 *
 * 为什么不是知识库
 * ------------------------------------------------------------
 * 58 条数据大约是 700 token,塞进提示词毫无压力。用知识库(RAG)反而多一层
 * **检索失败**:检索没命中,模型就当目录里没有这道菜 —— 为了 58 条数据引入
 * 一个不可靠的检索去换一个可靠的查表,是亏的。
 * 知识库该用在**对话页**那种开放问题上,那里检索是唯一可行的办法。
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { FOODS } = await server.ssrLoadModule('/src/data/foods.ts')
await server.close()

/** 按分类分组,分类顺序照食物库文件里的顺序 */
const groups = new Map()
for (const f of FOODS) {
  if (!groups.has(f.category)) groups.set(f.category, [])
  groups.get(f.category).push(f)
}

const catalog = [...groups]
  .map(([category, foods]) => `${category}:  ${foods.map((f) => `${f.id}=${f.name}`).join('｜')}`)
  .join('\n')

/* ------------------------------------------------------------
   给模型的指令
   ------------------------------------------------------------
   四条,每条都是针对一种**已经踩过或演示过**的失败写法写的:

   · 「只能从目录里挑」—— 不说这句,模型会给库外的 id,校验不过就退回名字匹配,
     等于白加
   · 「挑不出来就不要给这个字段」—— 不说这句,模型会为了「填满字段」而编一个,
     而编的 id 和真的在格式上完全一样(校验挡得住,但白费一次)
   · 「给 id 不是给名字」—— 模型很爱把 name 的值原样抄进 foodId
   · 「单位是熟食可食部的克数」—— **不要求它给 grams**。从一张照片估重量这件事
     做不到(见 src/lib/portion.ts 的文件头),库里所有值都是「每 100g、熟食、
     可食部」的口径,所以只要它挑对了菜,克数由用户自己确认
   ------------------------------------------------------------ */
const prompt = `【食物库目录】识别菜品时,必须从下面这份目录里挑 foodId

${catalog}

挑 foodId 的四条规矩:
1. 只能从上面这份目录里挑,**不要**用目录以外的任何 id
2. foodId 填的是等号**左边**那个英文 id(比如 rice),不是右边的中文名字
3. 这道菜在目录里没有对应项时,**不要输出 foodId 这个字段** —— 不要为了填满
   字段而编一个,编出来的 id 和真的在格式上一模一样,只会白费一次校验
4. 不需要输出 grams。库里的每条都是「每 100g、熟食、可食部」的口径,
   用户会在 App 里自己确认份量
`

await mkdir('dify', { recursive: true })
await writeFile('dify/catalog-prompt.txt', prompt, 'utf8')

console.log(`\n食物库目录:${FOODS.length} 条,分 ${groups.size} 类`)
for (const [category, foods] of groups) console.log(`  ${category.padEnd(6)} ${foods.length} 条`)
console.log(`\n已写入 dify/catalog-prompt.txt(${prompt.length} 字)`)
console.log('粘到 Dify 工作流里那个 LLM 节点的提示词后面,然后跑 npm run probe:vision 验证。')
