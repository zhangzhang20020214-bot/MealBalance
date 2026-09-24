/**
 * 组装知识库(开发用,不进产物)
 * ===========================================================
 * 跑法:`npm run kb` → 写出 `dify/knowledge/`(这个文件夹整个导入 Dify)
 *
 * ⚠️ 为什么用脚本**组装**,而不是把 md 手工丢进一个文件夹
 * ------------------------------------------------------------
 * 因为知识库有两个来源,它们的权威性不一样,而这个差别必须留在文件里、
 * 不能只留在谁的记忆里:
 *
 *   A. 官方指南(`knowledge-base/processed/*.md`)—— **正文**。
 *      国家卫生健康委办公厅发的「成人XX食养指南」,一份一个病,
 *      已按 PROCESS_SPEC 逐章节转录。这是内容的权威来源,原样搬进来,
 *      一个字节都不改。
 *
 *   B. 本脚本生成的三份 —— **只有官方指南给不出的东西**:
 *        · 00 口径与范围      这份知识库的边界、单位口径、不覆盖什么、冲突怎么办
 *        · 01 食衡的配额与依据 勾了某个条件之后 App 里那八个数字变成多少、依据是什么
 *        · 孕期 / 哺乳期 / 更年期  **没有对应的官方指南**,这三节只能自己写
 *
 *    A 和 B 的分工不是审美:官方指南写「高血压患者每日食盐逐步降至 5g 以下」,
 *    而 App 里高血压的配额是钠 1500mg —— 两个数不一样,而且都对。
 *    没有 01 这一份,模型拿到两个数只能自己猜哪个算数;有了它,关系是写明的。
 *
 * ⚠️ 为什么 01 里的数字必须**现读**
 * ------------------------------------------------------------
 * `quotaFor()` 算出来的值会随档案变。手抄一份进文档的结局已经能预演:
 * 文档写「高血压每日钠 <2000mg」而 App 里是 1500mg —— 同一个 App 自己打
 * 自己的脸,而且是两处都写着出处、都看起来对的那种。这和 README 警告过的
 * 「对话页说一套、拍餐盘算一套」是同一个失败,只是换了个方向。
 *
 * 所以 01 里的每个数字都是从 `quotaFor()` / `quotaNotes()` 现读的,
 * 连「依据」那段话也是 `quotaNotes().basis` 原样取出来的 ——
 * 那份 basis 就是档案页「这些数字为什么是这样」印的同一份字符串,
 * 所以文档和界面**不可能**说出不同的话。字面量只有一处例外:
 * `GUIDE_POINTERS` 里那几句「官方指南怎么讲」,它们是**引用**,
 * 每条都配着原文里的一句话,脚本会回原文核对那句话还在不在(见下)。
 *
 * ⚠️ 病名对不上是**静默**的,所以映射必须显式
 * ------------------------------------------------------------
 * App 里叫「高血脂」,官方指南叫「高脂血症」;App 里叫「痛风」,它叫
 * 「高尿酸血症与痛风」;App 里叫「慢性肾病」,它叫「慢性肾脏病」。
 * 拿 `disease === condition` 去 join,一条都匹配不上 —— 而且不会报错,
 * 只会生成一份少了五章的文档。所以下面 `CONDITION_DOC` 是手写的映射,
 * 并且双向校验(见「覆盖检查」)。
 */

import { mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'vite'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failures++
}

/** 官方指南的出处 —— 用户自己整理好的成品,只读 */
const SRC_DIR = 'knowledge-base/processed'
/** 导入 Dify 的成品 —— 这个目录整个是生成物,可以随时重建 */
const OUT_DIR = 'dify/knowledge'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { quotaFor, quotaNotes, QUOTA_FIELDS } = await server.ssrLoadModule('/src/store/quota.ts')
const { CHRONIC_CONDITIONS, SPECIAL_STAGES } = await server.ssrLoadModule('/src/store/types.ts')
const { birthForAge } = await server.ssrLoadModule('/src/lib/age.ts')

/* ------------------------------------------------------------
   1. 示例档案 —— 文档里所有具体数字都是在它上面算出来的
   ------------------------------------------------------------ */
/*
 * 为什么必须点名一份示例档案:配额是**按人算的**(热量来自身高体重年龄)。
 * 文档里写「高血压的钠上限是 1500mg」是对的(钠与体征无关),但写
 * 「高血压者的碳水上限是 200g」就**不可能是通用值** —— 它跟着热量走。
 * 所以文档统一用一份写明的示例档案,并把「你自己的数字在档案页」说清楚。
 */
const TEMPLATE = {
  name: '示例',
  gender: '女',
  /*
    档案里存的是**出生日期**(年龄由它现算),所以这里也写成出生日期 ——
    写成一个固定的 1998 年,这份模板就会随日历慢慢变老,而文档里那些
    「28 岁」的说明和数字会对不上。`birthForAge(28)` 把它钉在 28 岁
    (理由见 src/lib/age.ts)。
  */
  birth: birthForAge(28),
  height: 165,
  weight: 55,
  goals: [],
  restrictions: [],
  dietaryPreferences: [],
  // 两栏都是数组,`[]` 就是「无」;notes 是引导最后一步那段自由文本
  specialStages: [],
  chronicConditions: [],
  notes: '',
  quotaOverrides: {},
}

const base = quotaFor(TEMPLATE)
const withCond = (c) => quotaFor({ ...TEMPLATE, ...condPatch(c) })

/** 慢性病走 chronicConditions,特殊阶段走 specialStages —— 两栏都是数组,字面量不重叠 */
function condPatch(c) {
  return CHRONIC_CONDITIONS.includes(c) ? { chronicConditions: [c] } : { specialStages: [c] }
}

/** 这条条件改动了哪几项 */
function movedKeys(c) {
  const after = withCond(c)
  return QUOTA_FIELDS.filter((f) => base[f.key] !== after[f.key])
}

/** 「钠 2000mg → 1500mg」这种对比,从两次数值现算 */
function effectLine(c) {
  const after = withCond(c)
  const moved = movedKeys(c)
  if (moved.length === 0) return '不改变任何一项每日上限'
  return moved.map((f) => `${f.label} ${base[f.key]}${f.unit} → ${after[f.key]}${f.unit}`).join('；')
}

/* ------------------------------------------------------------
   2. 读官方指南 —— 只读,不改
   ------------------------------------------------------------ */

/** 极简 frontmatter 解析 —— 只认这份素材里出现过的形状 */
function frontmatter(text) {
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  if (end === -1) return null
  const out = {}
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    out[m[1]] = v
  }
  return out
}

const srcNames = (await readdir(SRC_DIR)).filter((n) => n.endsWith('.md')).sort()
const GUIDE = []
for (const name of srcNames) {
  const body = await readFile(join(SRC_DIR, name), 'utf8')
  GUIDE.push({ file: name, body, meta: frontmatter(body) ?? {} })
}

/**
 * App 的条件 → 官方指南的 `disease` 值。
 *
 * 手写而不是模糊匹配,理由见文件头。右边这一列必须是
 * `knowledge-base/processed/` 里真实存在的 `disease` 取值,
 * 写错会被下面的校验抓住(而不是静默少一章)。
 */
const CONDITION_DOC = {
  高血压: '高血压',
  糖尿病: '糖尿病',
  高血脂: '高脂血症',
  痛风: '高尿酸血症与痛风',
  慢性肾病: '慢性肾脏病',
}

/**
 * 「官方指南怎么讲」—— 唯一手写的内容,而且每条都是**引用**。
 *
 * `quote` 是原文里的一句话,脚本会回原文核对它还在不在。这不是洁癖:
 * 这几句话是用来告诉模型「App 的数字和指南的关系是什么」的,
 * 如果哪天素材被重新转录、这句话没了,而这里还留着,文档就会开始
 * 引一句原文里根本不存在的话 —— 静默的、看不出来的错。
 */
const GUIDE_POINTERS = {
  高血压: {
    quote: '食盐摄入量逐步降至 5g 以下',
    note: '该指南的食养原则是「每人每日食盐摄入量逐步降至 5g 以下」，约合钠 2000mg。App 里的 1500mg 比这条底线更严，是 App 自己取的目标值 —— 回答时不要把 1500mg 说成指南的要求。',
  },
  糖尿病: {
    quote: '碳水化合物提供的能量占总能量比例为 45%～60%',
    note: '该指南给的碳水供能比区间是 45%～60%，App 取的 45% 正好是这个区间的下限。',
  },
  高血脂: {
    quote: '脂肪摄入量以占总能量 20%～25% 为宜',
    note: '该指南建议脂肪供能比 20%～25%，App 取的 25% 是这个区间的上缘。',
  },
  痛风: {
    quote: '嘌呤含量',
    note: 'App **不改变任何配额** —— 每日配额里没有嘌呤这一项，食物库也只存了五项营养。但该指南附录里有「常见食物嘌呤含量」表：问到具体食物的嘌呤含量时，引用那张表，不要凭记忆给数字。',
  },
  慢性肾病: {
    quote: '蛋白质摄入总量为每日每公斤理想体重0.6g',
    note: '该指南按分期给蛋白质：1～2 期 0.8 g/kg、3～5 期 0.6 g/kg，而且都以**理想体重**（身高 − 105）计，不是实际体重。App 取的是 1～2 期那个较宽松的值、并用实际体重算 —— 如果用户说的是 3 期以上，App 里的数偏宽松，以医嘱为准。',
  },
}

/* ------------------------------------------------------------
   3. 自己写的三节 —— 只有**没有官方指南**的特殊时期
   ------------------------------------------------------------ */
/*
 * 慢性病那五节以前也是手写的,现在删掉了:官方指南讲的是同一件事,
 * 而且权威得多。留着就是同一件事有两套说法,检索命中哪一份不确定,
 * 而两边的措辞和数字口径并不完全一致 —— 这正是本文件开头那段
 * 「手抄一份的结局」在另一个方向上的重演。
 *
 * 这三节留着是因为**没有可替代的官方指南**:目录里没有孕产妇食养指南。
 * 所以它们被明确标成「起步版」,权威性低于其余文档。
 */
const SECTIONS = {
  孕期: {
    title: '孕期的饮食指导（起步版）',
    limit: '主要是**增加**而不是限制：孕中期起能量与蛋白质需要量上升，同时要避开几类有明确风险的食物。',
    why: '胎儿的生长发育需要额外的能量和蛋白质；同时孕期免疫状态改变，某些食源性感染对胎儿的影响远大于对成人本人。',
    how: [
      '**增加是「适量增加」，不是「一个人吃两个人的份」**：孕中期起每天大约多 300kcal（约等于一杯牛奶加一个鸡蛋），具体按 App 里按你体征算出来的那个数。',
      '**这几样绝对不能碰**：生鱼生肉（刺身、溏心蛋、未全熟的牛排）、未经巴氏消毒的奶和奶酪、酒。弓形虫和李斯特菌是真实风险，不是过度谨慎。',
      '**补充叶酸**：孕前三个月到孕早期，遵医嘱补充。',
      '**铁和钙优先从食物来**：红肉、动物血、豆制品、奶制品。是否需要额外补剂、补多少，由产检医生判断。',
      '**少食多餐**：孕中晚期胃被顶上去，一次吃不下太多，分餐比硬撑舒服。',
      '**水肿明显时限钠**：这件事和高血压那条是同一套做法，但**是否属于病理性水肿要医生判断**。',
    ],
  },
  哺乳期: {
    title: '哺乳期的饮食指导（起步版）',
    limit: '同样主要是**增加**：能量与蛋白质需要量比孕期还高一些，同时要保证水分。',
    why: '乳汁的合成要消耗母体的能量和蛋白质，哺乳期的需要量是全程最高的阶段之一。',
    how: [
      '**每天大约多 500kcal、蛋白质 +25g**，具体按 App 里按你体征算出来的那个数 —— 刻意节食减重会直接影响泌乳量。',
      '**水要喝够**：乳汁里约 87% 是水。App 的饮水目标在哺乳期只作为下限看，口渴就喝。',
      '**钙和优质蛋白**：奶制品、豆制品、鱼、蛋。如果因为宝宝过敏而忌口某类食物，要想法从别处补上对应的营养。',
      '**咖啡因和酒**：咖啡因适量（通常每天不超过 1~2 杯咖啡）一般可以，酒建议不喝；要喝的话应在喂奶之后而不是之前。',
      '**别自行「下奶偏方」**：浓汤下奶的说法没有可靠依据，喝进去的主要是脂肪和钠。真正有效的是按需哺乳、充足水分和休息。',
    ],
  },
  更年期: {
    title: '更年期的饮食指导（起步版）',
    limit: '不限制，而是要**补上**：钙与维生素 D 的需要量在这一阶段上升。',
    why: '雌激素水平下降会加速骨量流失，骨质疏松和骨折风险随之上升。钙与维生素 D 是这一阶段最值得关注的两项。',
    how: [
      '**每天 1000~1200mg 钙**：300ml 牛奶约 300mg，豆腐、深绿色叶菜、带骨小鱼也是来源。国内膳食普遍缺口不小。',
      '**维生素 D 靠食物很难吃够**：主要靠日照和补剂。是否需要补、补多少，建议问医生。',
      '**优质蛋白不要减**：这一阶段肌肉量也在流失，蛋白质摄入不足会加速它。',
      '**控制体重和钠**：代谢率下降，同样的饭量容易增重；而血压问题在这一阶段也更常见。',
      '**潮热与饮食的关系因人而异**：有人对辛辣、酒精、咖啡因敏感，可以自己试着记录几天看有没有规律 —— 它不是通用条律。',
    ],
  },
}

/* ------------------------------------------------------------
   4. 覆盖检查 —— 有问题就不生成
   ------------------------------------------------------------ */
/* 特殊阶段现在是数组,`[]` 就是「无」—— 所以词表里每一项都要有文档,不再需要过滤掉「无」 */
const SPECIAL_NEEDED = SPECIAL_STAGES

console.log('\n=== 覆盖检查 ===')

// 1) 慢性病:App 的每一项都要有官方指南,反过来也要有 —— 双向
{
  const appKeys = [...CHRONIC_CONDITIONS].sort()
  const mapKeys = Object.keys(CONDITION_DOC).sort()
  check(
    '**App 的每个慢性病都配了官方指南**(双向:不多不少)',
    appKeys.length === mapKeys.length && appKeys.every((k, i) => k === mapKeys[i]),
    `App: ${appKeys.join('/')} · 映射: ${mapKeys.join('/')}`
  )

  const diseases = GUIDE.map((g) => g.meta.disease)
  const dangling = Object.entries(CONDITION_DOC).filter(([, d]) => !diseases.includes(d))
  check(
    '映射指向的 disease 在素材里真的存在',
    dangling.length === 0,
    dangling.length ? `指不到: ${dangling.map(([c, d]) => `${c}→${d}`).join(' / ')}` : `${GUIDE.length} 份素材`
  )

  // 一个 disease 对应两份素材的话,`find` 只会取第一份 —— 静默少一份
  const dup = diseases.filter((d, i) => diseases.indexOf(d) !== i)
  check('没有两份素材写同一个 disease(否则会静默丢掉一份)', dup.length === 0, dup.join('/'))
}

// 2) 特殊时期:没有官方指南,所以每一节都得自己写了
{
  const missing = SPECIAL_NEEDED.filter((c) => !SECTIONS[c])
  check(
    '**每个特殊时期都有自己写的那一节**',
    missing.length === 0,
    missing.length ? `少了:${missing.join(' / ')}` : `${SPECIAL_NEEDED.length} 项`
  )
  const extra = Object.keys(SECTIONS).filter((k) => !SPECIAL_NEEDED.includes(k))
  check('没有写了却已经不在枚举里的条目', extra.length === 0, extra.join(' / '))
}

// 3) 引用必须还在原文里 —— 见 GUIDE_POINTERS 的注释
{
  const broken = []
  for (const [cond, p] of Object.entries(GUIDE_POINTERS)) {
    const disease = CONDITION_DOC[cond]
    const g = GUIDE.find((x) => x.meta.disease === disease)
    if (!g) {
      broken.push(`${cond}(没有素材)`)
      continue
    }
    if (!g.body.includes(p.quote)) broken.push(`${cond}(引文不在 ${g.file} 里)`)
  }
  check(
    '**每一句「官方指南怎么讲」都回原文核对过**(引文还在)',
    broken.length === 0,
    broken.length ? broken.join(' / ') : `${Object.keys(GUIDE_POINTERS).length} 句`
  )
}

// 4) 每条依据都得有东西可写
{
  const ALL = [...CHRONIC_CONDITIONS, ...SPECIAL_NEEDED]
  const noBasis = ALL.filter((c) => !quotaNotes({ ...TEMPLATE, ...condPatch(c) })[0])
  check('每个条件都拿得到一条依据', noBasis.length === 0, noBasis.join('/'))
}

if (failures > 0) {
  console.log('\n覆盖检查没过 —— **不生成文档**。')
  console.log('少一章的知识库比没有知识库更糟:检索不到的时候,没有任何人会知道。\n')
  await server.close()
  process.exit(1)
}

/* ------------------------------------------------------------
   5. 生成
   ------------------------------------------------------------ */

/** 每个条件都有的那一小块 —— 数字全部现读 */
function quotaBlock(c) {
  // basis 原样取自档案页印的同一份字符串 —— 文档和界面因此不可能说出不同的话
  const note = quotaNotes({ ...TEMPLATE, ...condPatch(c) })[0]
  const lines = [`- 改动：${effectLine(c)}`, '', '依据（与 App 档案页「这些数字为什么是这样」印的是同一份）：', '', `> ${note.basis}`]
  return lines.join('\n')
}

/** 「官方指南怎么讲」那一行 + 它出自哪一份 */
function guideLine(c) {
  const disease = CONDITION_DOC[c]
  const g = GUIDE.find((x) => x.meta.disease === disease)
  const p = GUIDE_POINTERS[c]
  if (!g || !p) return ''
  return `
**官方指南怎么讲**（详见「${g.meta.title}」）：

${p.note}
`
}

const FOOTER = `
---

## 本文的口径与边界

- **适用对象**：成人、非急性期、无并发症的日常饮食管理
- **不构成医学建议**：本文不涉及用药、剂量、急性发作期处理，也不替代个体化医嘱
- **数字从哪来**：上面的「食衡里的对应设置」由 App 的 \`quotaFor()\` 在示例档案上
  现算 —— 你自己的数字在 App 的档案页，那里会按你的年龄、身高、体重重算
`

/* ---- 00 口径与范围 ---- */
const preamble = `# 食衡知识库 · 口径与范围

这一份说明**后面那些文档的依据、单位和不覆盖的范围**。回答任何与慢性病或
特殊时期有关的饮食问题时，都应当先按这里的口径来理解，并说明这是通用建议、
不能替代医生。

## 这些文档给谁看

成人、慢性病的**非急性期**、无严重并发症的日常饮食管理。
不适用于：孕产妇的并发症处理、住院或围手术期的营养支持、
急性发作期（如痛风急性发作、糖尿病酮症）。

（收录的文档里有一份《儿童青少年生长迟缓食养指南》，它超出了这个 App 的
适用范围 —— App 的档案里没有儿童的体征字段。只在用户明确问到儿童问题时用它。）

## 单位口径

- 热量 **kcal**；蛋白质 / 碳水 / 脂肪 / 添加糖 / 膳食纤维 **g**；钠 **mg**；饮水 **ml**
- App 食物库里所有数值都是**每 100g 熟食、可食部**的口径 ——
  生食材和熟食的重量差别很大（100g 生米煮出来约 250g 米饭），不要混用
- 包装食品的「钠」和「食盐」不是一回事：钠（mg） × 2.5 ≈ 食盐（mg）

## 这个知识库里有什么

| 编号 | 文档 | 来源 |
|---|---|---|
${GUIDE.map((g, i) => `| ${String(i + 1).padStart(2, '0')} | ${g.meta.title ?? g.file} | ${g.meta.publisher ?? '—'} |`).join('\n')}

- 前两份（00、01）是**本 App 自己生成的**：这一份讲口径，01 讲 App 的配额算法
- 慢性病那几份是**官方食养指南的原文**，逐章节转录，未做改写
- 「孕期 / 哺乳期 / 更年期」三份**没有官方指南可依**，标题里标了「起步版」，
  权威性低于其余文档

## App 里那些数字是怎么来的

每日配额由 \`quotaFor()\` 从档案的年龄、性别、身高、体重算出来：

| 项 | 算法 |
|---|---|
| 热量 | Mifflin-St Jeor 基础代谢 × 1.4（轻体力活动） |
| 蛋白质 | 1.2 g/kg 体重 |
| 碳水 / 脂肪 | 各取热量 ${Math.round(base.carb * 4 / base.kcal * 100)}% / ${Math.round(base.fat * 9 / base.kcal * 100)}% 的供能比换算 |
| 钠 / 添加糖 / 膳食纤维 / 饮水 | 膳食指南常量 2000mg / 25g / 30g / 2000ml |

慢性病与特殊时期在**这个基础之上**做调整，每条调整的依据、以及它和官方指南
的关系，都写在 **01 号文档**里。

## 官方指南的数字和 App 的数字不一致时，以哪个为准

**以官方指南为准，App 的数字是本 App 自己取的目标值。** 具体关系写在 01 号文档里，
逐条说明。举两个已经对过的例子：

- 高血压：指南要求「食盐逐步降至 5g 以下」（约合钠 2000mg），App 取钠 1500mg
  —— App 更严。**不要把 1500mg 说成指南的要求。**
- 痛风：指南附录里有「常见食物嘌呤含量」表，而 App 的每日配额里**根本没有
  嘌呤这一项** —— 问到嘌呤含量，引用指南那张表，不要说「App 里有」。

## 明确不覆盖什么

这一节是给检索用的：**问到这里面的事，应当直接说「这不在我能给的范围里」，
而不是硬编一个答案。**

- **用药**：任何药物的名称、剂量、调整、相互作用
- **急性发作期的处理**：胸痛、酮症、痛风急性发作、严重水肿、妊娠并发症
- **个体化医嘱**：透析患者的蛋白质量、胰岛素的碳水计数方案、具体的补剂剂量
- **疾病诊断**：是不是高血压、血糖多少算高，这类问题只能由医生和化验单回答
- **App 知识库之外的食物成分数据**：App 的食物库只有热量、蛋白质、碳水、
  脂肪、钠五项。问到别的成分，先看有没有收录的官方指南讲过；没有就说没有

## 与其他信息的冲突怎么处理

如果用户说的和这里写的不一致（比如他说医生让他每天吃 60g 蛋白），
**以医生说的为准**，并说明这属于个体化医嘱、通用建议不适用。
`

/* ---- 01 食衡的配额与依据 ---- */
const ALL_CONDITIONS = [...CHRONIC_CONDITIONS, ...SPECIAL_NEEDED]

const quotaDoc = `# 食衡的配额与依据

这一份**不是科普**，是这个 App 内部的算法说明 —— 它回答「在食衡里勾上某个
条件之后，那八个每日上限会变成多少、依据是什么」。

其余文档讲的是食养原则；只有这一份知道 App 自己的配额。两边的数字不一致时
以官方指南为准（关系逐条写在这里）。

## 一份示例档案的配额

示例档案：**女 / 28 岁 / 165cm / 55kg / 无特殊时期 / 无慢性病**

| 项 | 每日目标 |
|---|---|
${QUOTA_FIELDS.map((f) => `| ${f.label} | ${base[f.key]} ${f.unit} |`).join('\n')}

这些数字是算出来的，不是写死的：热量来自 Mifflin-St Jeor 公式乘一个轻体力
活动系数，蛋白质按 1.2 g/kg，碳水和脂肪按供能比从热量换算。
**换一份档案就是另一组数** —— 用户自己的数字在他 App 的档案页上。

App 还允许用户手动改这八项里的四项（热量、蛋白质、钠、添加糖）。手动改过的项
会盖住条件调整，档案页会写明「（你手动设过，未采用）」。

${ALL_CONDITIONS.map(
  (c) => `## ${c}

${quotaBlock(c)}
${guideLine(c)}`
).join('\n')}
${FOOTER}`

/* ---- 自己写的那三节 ---- */
function renderSection(c) {
  const s = SECTIONS[c]
  return `# ${s.title}

> ⚠️ **起步版**：国家卫生健康委没有发布对应的食养指南，这一节是按公共营养学
> 共识写的，**权威性低于知识库里那几份官方指南**。如果有更新的权威来源，应当
> 以它为准并替换本节。

## 该限什么

${s.limit}

## 为什么

${s.why}

## 具体怎么做

${s.how.map((h) => `- ${h}`).join('\n')}

## 食衡里的对应设置

${quotaBlock(c)}
${FOOTER}`
}

console.log('\n=== 生成 ===')

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(OUT_DIR, { recursive: true })

const written = []
const write = async (name, body) => {
  await writeFile(join(OUT_DIR, name), body, 'utf8')
  written.push({ name, body })
}

await write('00-口径与范围.md', preamble)
await write('01-食衡的配额与依据.md', quotaDoc)

// 特殊时期:自己写的,序号紧跟生成的两份
let n = 1
for (const c of SPECIAL_NEEDED) {
  n += 1
  await write(`${String(n).padStart(2, '0')}-${c}.md`, renderSection(c))
}

/**
 * 官方指南:**原样**搬进来,一个字节都不改。
 *
 * 不追加、不改写、不「顺手」把 App 的配额插进去 —— 那些都在 01 里。
 * 一份转录好的官方文档和一个生成物混在一起,以后想换素材就分不清
 * 哪一段是原文了。序号写在文件名前面,导入 Dify 之后列表是排好序的。
 */
for (const g of GUIDE) {
  n += 1
  const name = `${String(n).padStart(2, '0')}-${g.meta.title ?? g.file.replace(/\.md$/, '')}.md`
  await write(name, g.body)
}

/* ------------------------------------------------------------
   6. 反向核对 —— 从**生成物**读回来
   ------------------------------------------------------------ */
/*
 * 「代码里写了 1500」不是证据(那是自证)。下面这些是从刚写出去的
 * 文件里抠出数字、再和 `quotaFor()` 比 —— 只有这样才证明得了
 * 「文档里的数字确实跟着算法走」。
 */
console.log('\n=== 反向核对 ===')

const byName = (suffix) => written.find((w) => w.name.endsWith(suffix))?.body ?? ''

{
  const doc = byName('01-食衡的配额与依据.md')
  const computed = withCond('高血压').sodium

  // 抠「钠 2000mg → 1500mg」里箭头右边那个数
  const m = doc.match(/钠\s*\d+mg\s*→\s*(\d+)mg/)
  check(
    '**01 里高血压的钠值 == quotaFor() 现算的值**(从生成物读回,不是断言代码里写了 1500)',
    Number(m?.[1]) === computed,
    `文档 ${m?.[1] ?? '(没抠到)'} / 算得 ${computed}`
  )

  // 依据必须与档案页印的那份逐字相同
  const basis = quotaNotes({ ...TEMPLATE, ...condPatch('高血压') })[0].basis
  check('01 里的依据与 quotaNotes() 逐字相同', doc.includes(basis))

  // 八项都在,而且值和 quotaFor() 一致
  const wrong = QUOTA_FIELDS.filter((f) => !doc.includes(`| ${f.label} | ${base[f.key]} ${f.unit} |`))
  check('示例档案的八项配额全都写进了 01', wrong.length === 0, wrong.map((f) => f.label).join('/'))
}

{
  // 官方指南必须是**原样**的:随便挑一份逐字节比
  const g = GUIDE[0]
  const copied = written.find((w) => w.name.endsWith('.md') && w.body === g.body)
  check('官方指南是原样搬过来的(逐字节相同,没被改写)', Boolean(copied), g.file)
  const diff = GUIDE.filter((x) => !written.some((w) => w.body === x.body))
  check('十份官方指南一份不少', diff.length === 0, diff.map((x) => x.file).join('/'))
}

{
  // 这三个特殊时期没有官方指南 —— 文档里必须自己说清楚,不能让人以为是官方的
  const missing = SPECIAL_NEEDED.filter((c) => !byName(`${c}.md`).includes('起步版'))
  check('**没有官方指南的三节都标了「起步版」**', missing.length === 0, missing.join('/'))
}

for (const w of written) {
  check(`${w.name.padEnd(34)} 写出来了`, w.body.length > 200, `${w.body.length} 字`)
}

const copiedCount = GUIDE.length
console.log(`\n共 ${written.length} 份 → ${OUT_DIR}/`)
console.log(`  生成 ${written.length - copiedCount} 份 · 官方指南原文 ${copiedCount} 份`)
console.log(`  导入 Dify 时**整个文件夹一起传**,见 README「路径 B:知识库」。`)

if (failures > 0) console.log(`\n⚠️ 有 ${failures} 项没过 —— 上面那些 03 号文档不要导入 Dify。\n`)
else console.log('')

await server.close()
process.exit(failures === 0 ? 0 : 1)
