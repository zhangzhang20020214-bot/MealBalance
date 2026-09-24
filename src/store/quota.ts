/**
 * 每日营养配额的推导
 * ===========================================================
 * `quotaFor(profile)` 把「基础信息 + 特殊时期 + 慢性病」算成八个配额数字。
 *
 * 为什么要有这个文件
 * ------------------------------------------------------------
 * 档案页底下的脚注一直写着「配额依据《中国居民膳食指南 2022》**结合基础信息
 * 自动计算**」,而在此之前配额是 defaults.ts 里一组**手写的常量** ——
 * 改身高、改体重、改年龄,一个数都不会动。那句话是从设计稿抄来的,而我们
 * 没有兑现它。
 *
 * 这个文件把它兑现了。而且有一个很强的验收锚点:推导出来的默认值必须和
 * 原来那组手写常量**逐字段相等** —— 也就是「自动计算」这条路算出来的,
 * 恰好就是之前人工拍出来的那组数。见 DEFAULT_PROFILE 与 verify-loop 里的断言。
 *
 * 三件事由**同一张表**驱动
 * ------------------------------------------------------------
 *   · 算(quotaFor)
 *   · 解释(quotaNotes —— 界面上「这个数为什么是这样」那几行)
 *   · 检测手改挡住了哪条调整(quotaAdvice / blockedByOverride)
 *
 * 如果这三件事各自写一套,它们迟早会互相矛盾 —— 而「界面上的解释和实际算法
 * 不一致」正是这个仓库最不能接受的东西。
 *
 * ⚠️ DELTAS 的**数组顺序就是应用顺序**,它是有承载力的:
 *   1. 先 kcal 类(孕期/哺乳期)—— 它们改的是分母
 *   2. 再比例类(糖尿病/高血脂)—— 碳水、脂肪是按**供能比**从 kcal 算的,
 *      必须排在 kcal 之后。反过来会拿孕前的 kcal 算碳水,而结果看不出来
 *   3. 再绝对值类(高血压/慢性肾病)—— 直接给一个数,不依赖 kcal
 *   (4. quotaOverrides 是最后一步,但它在 store.ts 的 updateProfile 里,
 *       不在这个文件 —— 这里的签名里没有 overrides 参数,于是
 *       「我是不是忘了套 overrides」变成一个不可表达的问题。)
 */

import { ageOn } from '../lib/age'
import type { Profile, Quota } from './types'

export type QuotaKey = keyof Quota

/**
 * 推导真正读得到的那些字段 —— **不含 `quota` 自身**。
 *
 * 这不是洁癖,是让「推导公式读了上一次的推导结果」变成一个写不出来的东西。
 * 顺带解决一个具体的别扭:`DEFAULT_PROFILE` 的 quota 是算出来的,而算它需要
 * 一个还没有 quota 的档案 —— 有了这个类型,那份常量就可以先写成
 * `Omit<Profile,'quota'>`,再补上配额。
 */
export type QuotaInput = Omit<Profile, 'quota'>

export interface QuotaField {
  key: QuotaKey
  /** 界面上的名字 */
  label: string
  /**
   * 这一项在句子里的**角色** —— 「钠**上限** 1500mg」还是「蛋白质**目标** 65g」。
   *
   * 加它是因为「依据」那行字(`quotaBasis`)只有半句话可用:「高血压 → 钠 1500mg」
   * 读起来像在陈述一个事实,而屏幕上那句建议说的是「占全天**上限**的 45%」——
   * 中间那个词没了,用户得自己把两句话接起来。
   *
   * ⚠️ 它是 `formatQuota` 的一部分,所以**档案页「这些数字为什么是这样」也跟着变**
   * (那里印的是同一串字节)。这不是副作用,是要求:两处不是同一句话的话,
   * 迟早有一处会先行改动。
   */
  role: '上限' | '目标'
  unit: string
  /** 手调的最小步长 —— 和推导的量化步长一致,不是巧合 */
  step: number
  min: number
  max: number
  /** 能不能在「手动调整」那个面板里改。碳水/脂肪/纤维/饮水保持只读 */
  adjustable: boolean
}

/**
 * 八个字段的元数据。
 *
 * `step` / `min` / `max` 同时承担两个职责:面板里的加减步长、以及**推导结果的
 * 夹取边界**。两者合一是有意的 —— 推导永远不会给出一个手调够不着的数。
 */
export const QUOTA_FIELDS: QuotaField[] = [
  { key: 'kcal', label: '热量', role: '目标', unit: 'kcal', step: 50, min: 800, max: 4000, adjustable: true },
  { key: 'protein', label: '蛋白质', role: '目标', unit: 'g', step: 5, min: 20, max: 200, adjustable: true },
  { key: 'carb', label: '碳水', role: '目标', unit: 'g', step: 5, min: 50, max: 600, adjustable: false },
  { key: 'fat', label: '脂肪', role: '目标', unit: 'g', step: 5, min: 20, max: 200, adjustable: false },
  { key: 'sodium', label: '钠', role: '上限', unit: 'mg', step: 100, min: 500, max: 5000, adjustable: true },
  { key: 'sugar', label: '添加糖', role: '上限', unit: 'g', step: 5, min: 5, max: 100, adjustable: true },
  { key: 'fiber', label: '膳食纤维', role: '目标', unit: 'g', step: 5, min: 10, max: 60, adjustable: false },
  { key: 'water', label: '饮水', role: '目标', unit: 'ml', step: 100, min: 800, max: 4000, adjustable: false },
]

const FIELD_BY_KEY = new Map(QUOTA_FIELDS.map((f) => [f.key, f]))

/** 按 key 取字段元数据 —— 拿不到就抛,而不是静默给一个默认值 */
export function quotaField(key: QuotaKey): QuotaField {
  const f = FIELD_BY_KEY.get(key)
  if (!f) throw new Error(`未知的配额项: ${key}`)
  return f
}

/** 界面上的说法,如「钠上限 1500mg」「蛋白质目标 65g」 */
export function formatQuota(key: QuotaKey, value: number): string {
  const f = quotaField(key)
  return `${f.label}${f.role} ${value}${f.unit}`
}

/* ============================================================
   基础值 —— 八项全部有出处,不是拍的
   ============================================================ */

/**
 * 活动系数。这个 App 不问「你运动量多大」,所以取一个中性值。
 * 1.4 ≈ 轻体力活动,是《中国居民膳食指南》能量需要量表的中间档。
 */
const ACTIVITY = 1.4

/** 蛋白质 1.2 g/kg —— 膳食指南对普通成人的推荐区间 1.0~1.2 的上缘 */
const PROTEIN_PER_KG = 1.2

/** 碳水、脂肪的供能比,取膳食指南推荐区间的中点 */
const CARB_RATIO = 0.5
const FAT_RATIO = 0.3

/**
 * 与基础信息无关的四项,直接取指南常量。
 *
 * 钠的口径要说清,因为设计稿在这里是不一致的:档案页写「钠 5g」,结果页却拿
 * 「500mg」当上限,两者差 10 倍。原因不是笔误,是把**食盐**和**钠**当成了
 * 同一种东西,而食物成分表里标的是钠:
 *
 *   食盐 ≤ 5g/日 → 钠 ≈ 5g × 393mg/g ≈ 1965mg ≈ 2000mg
 *
 * 两者相差约 2.5 倍,不能混用。这里统一用**钠 2000mg/日**,和食物库的 mg
 * 口径对齐 —— 若沿用餐食数据里的「5」,钠的摄入比例会永远显示成几百个百分点。
 */
const SODIUM = 2000
const SUGAR = 25
const FIBER = 30
const WATER = 2000

/**
 * Mifflin-St Jeor 基础代谢率。
 *
 * 性别不认识时按女性公式走 —— 它给出的值更低,于是配额更保守。
 * 宁可能量目标偏低一点,也不要因为一个拼错的性别把上限抬高。
 */
/**
 * 基础代谢 —— Mifflin-St Jeor。
 *
 * 年龄这一项是**现算的**(`ageOn`,从出生年月推),所以推导的输入是
 * (档案, 今天)。这里刻意不把年龄当参数收:一旦它是个传进来的数,调用方
 * 就可以传一个和档案对不上的年龄,而那种错误在结果里看不出来。
 */
function bmr(p: QuotaInput, now: Date): number {
  const s = p.gender === '男' ? 5 : -161
  return 10 * p.weight + 6.25 * p.height - 5 * ageOn(p.birth, now) + s
}

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step
}

/**
 * 夹到字段允许的区间。
 *
 * 只管上下界,**不取整** —— 取整是各步推导自己的事(`roundTo`)。两件事混在
 * 一个函数里的话,「这个数是量化过的吗」就没人说得清了。
 *
 * min/max 都取成了 step 的整数倍,所以夹取不会破坏「结果落在步长网格上」。
 */
function clamp(key: QuotaKey, v: number): number {
  const f = quotaField(key)
  return Math.min(f.max, Math.max(f.min, v))
}

/* ============================================================
   条件调整表 —— 顺序即应用顺序,见文件头
   ============================================================ */

interface QuotaDelta {
  /**
   * 触发它的那个取值。特殊时期和慢性病的字面量不重叠,所以一张表装得下。
   *
   * 类型是 `string` 而不是那两个联合类型 —— 那两张表现在是「预设 + 自由填写」,
   * 用户写的词也是合法取值(只是匹配不上这里任何一条)。代价是**这里拼错一个
   * 字不会有编译错误**,那由 verify-loop 兜:它遍历两张预设表,要求每一项都
   * 在 `quotaNotes()` 里留下一句话 —— 拼错的 source 会让它对应的那一项失声。
   */
  source: string
  /** 它会动哪几项 —— 「配额来处」那句话和「手改挡住没挡住」都读它 */
  keys: QuotaKey[]
  /**
   * 依据 —— 会**原样**印在界面上(档案页的「这些数字为什么是这样」),
   * 也会被 `scripts/make-kb.mjs` 原样抄进知识库文档。三处都是纯文本。
   *
   * ⚠️ 所以不能在这里用 Markdown。整段是当纯文本渲染的,`**加粗**` 会
   * 连同星号一起显示出来 —— 想强调就用「」。标点用全角,和界面其余文案一致。
   *
   * 这条规矩漏过一次:糖尿病那条 basis 里带着 `**区间内更严格的自设目标**`,
   * 一直没被发现 —— 因为当时唯一的星号断言只盯着**高血压**那一条。
   * 现在 verify-loop 是遍历所有条件查的(见「解释」那一节),新加一条自动被覆盖。
   */
  basis: string
  apply(q: Quota, p: QuotaInput): void
}

/**
 * 有字段、但**不动任何配额**的那几个。
 *
 * 这不是遗漏。嘌呤和钙/维 D 都不在 quota 的八个字段里,而「编一个不存在的
 * 配额来凑数」比「承认这项没有后果」糟得多。界面照样把它们列出来并说明
 * 为什么不影响 —— 否则用户会以为勾了没用。
 *
 * 2026-09-20 多了四条(青少年 / 老年 / 术后康复 / 术前准备)。它们进这张表
 * 而不是进 `DELTAS`,是因为**找不到可以套用的数**:前两项指南给的是分档区间
 * 或已经落在 App 取值里,后两项属于临床路径。写「依据」时守的是同一条底线 ——
 * 宁可写「没有可直接套用的增量」,也不为了「勾了要有后果」编一个数出来。
 */
const NO_QUOTA_EFFECT: { source: string; basis: string }[] = [
  {
    source: '痛风',
    basis: '每日配额的八项里没有嘌呤，所以痛风不改变任何上限。要控制嘌呤需要具体的食物嘌呤含量表，而食物库只存了五项营养，没有这一列 —— 编一列出来就是假数据。',
  },
  {
    source: '更年期',
    basis: '更年期主要影响钙与维生素 D 的需要量，而配额里没有这两项。（它已经不在预设里了 —— 判断它要靠激素水平，凭印象勾的代价是配额被改。自己写进来的人仍然看得到这句话。）',
  },
  {
    source: '青少年',
    basis: '《中国居民膳食指南（2022）》对 14~17 岁是按性别和活动量分档给能量与水需要量的，而 App 的推导只有一套成人公式（Mifflin-St Jeor × 1.4），没有「青少年」这一档 —— 所以这一项不改动上面任何一个数字，只把这件事告诉食衡。',
  },
  {
    source: '老年',
    basis: '《中国居民膳食指南（2022）》建议老年人每日蛋白质 1.0~1.2g/kg（做抗阻训练的老年人 ≥1.2~1.5g/kg），而 App 对所有人取的都是 1.2g/kg —— 已经落在老年人这个区间的上缘，所以这一项不改动任何数字。',
  },
  {
    source: '术后康复',
    basis: '术后恢复期确实需要更多能量和蛋白质，但增量要按手术类型、并发症和营养状况由临床营养师定 —— 《中国居民膳食指南》和知识库里那几份食养指南都没有给出可以直接套用的每日增量。所以这一项不改动配额，只把这件事告诉食衡。',
  },
  {
    source: '术前准备',
    basis: '术前营养准备（如术前的口服营养补充）属于临床路径，剂量按手术方式和营养评估定，指南里没有可以直接套用的每日增量。所以这一项不改动配额，只把这件事告诉食衡。',
  },
]

const DELTAS: QuotaDelta[] = [
  /* ---- 1. 先 kcal 类(它们改的是后面比例类的分母) ---- */
  {
    source: '孕期',
    keys: ['kcal', 'protein'],
    basis: '《中国居民膳食指南（2022）》孕中期：在非孕基础上每日增加约 300kcal、蛋白质 +15g。',
    apply(q) {
      q.kcal += 300
      q.protein += 15
    },
  },
  {
    source: '哺乳期',
    keys: ['kcal', 'protein'],
    basis: '《中国居民膳食指南（2022）》哺乳期：每日增加约 500kcal、蛋白质 +25g。',
    apply(q) {
      q.kcal += 500
      q.protein += 25
    },
  },

  /* ---- 2. 再比例类(从**调整后**的 kcal 算) ---- */
  {
    source: '糖尿病',
    keys: ['carb'],
    basis:
      '碳水供能比 50% → 45%。《成人糖尿病食养指南（2023年版）》给的区间是 45%~60%，45% 取的是这个区间的下限。选主食时优先低 GI。',
    apply(q) {
      q.carb = roundTo((q.kcal * 0.45) / 4, 5)
    },
  },
  {
    source: '高血脂',
    keys: ['fat'],
    basis:
      '脂肪供能比 30% → 25%。《成人高脂血症食养指南（2023年版）》建议脂肪供能比 20%~25%，25% 取的是这个区间的上缘。',
    apply(q) {
      q.fat = roundTo((q.kcal * 0.25) / 9, 5)
    },
  },

  /* ---- 3. 再绝对值类(给一个数,不依赖 kcal) ---- */
  {
    source: '高血压',
    keys: ['sodium'],
    basis:
      '钠 2000 → 1500mg。指南的底线是每日食盐 <5g（≈ 钠 2000mg），1500mg 是高血压人群更严格的「理想」上限（美国心脏协会的建议值），不是指南下限。',
    apply(q) {
      q.sodium = 1500
    },
  },
  {
    source: '慢性肾病',
    keys: ['protein'],
    basis:
      '蛋白质 1.2 → 0.8 g/kg。《成人慢性肾脏病食养指南（2024年版）》按分期给：1~2 期 0.8 g/kg、3~5 期 0.6 g/kg，而且都以「理想体重」（身高 − 105）计，不是实际体重。App 里没有「分期」这一项，取的是 1~2 期那个较宽松的值 —— 这一项必须由医生按你的分期和是否透析来定。',
    apply(q, p) {
      q.protein = roundTo(0.8 * p.weight, 5)
    },
  },
]

/**
 * 这个 delta 在当前档案下生效吗 —— 特殊时期和慢性病的字面量不重叠。
 *
 * 两张表都是**包含**判断(它们是列表),所以勾了「孕期 + 老年」两条都算数:
 * 孕期那条加 kcal,老年那条不改数字。用户自己写的词不匹配任何 source,
 * 自然什么都不动 —— 那不是漏掉,是 `NO_QUOTA_EFFECT` 那条依据在管。
 */
function isActive(d: QuotaDelta, p: QuotaInput): boolean {
  return p.specialStages.includes(d.source) || p.chronicConditions.includes(d.source)
}

function activeDeltas(p: QuotaInput): QuotaDelta[] {
  return DELTAS.filter((d) => isActive(d, p))
}

/* ============================================================
   推导
   ============================================================ */

/**
 * 算一遍。`excludeSource` 用于「如果这条不生效会是多少」——
 * `quotaNotes` 靠它算出每条调整各自贡献了什么。
 *
 * `now` 只喂给 BMR 的年龄那一项。默认就是当下,所以绝大多数调用方看不见它。
 */
function compute(p: QuotaInput, excludeSource?: string, now: Date = new Date()): Quota {
  // 基础代谢可能因为空档案算出负数,所以 kcal 先夹一次再去推碳水/脂肪
  const kcal = clamp('kcal', roundTo(bmr(p, now) * ACTIVITY, 50))
  const q: Quota = {
    kcal,
    protein: roundTo(PROTEIN_PER_KG * p.weight, 5),
    carb: roundTo((kcal * CARB_RATIO) / 4, 5),
    fat: roundTo((kcal * FAT_RATIO) / 9, 5),
    sodium: SODIUM,
    sugar: SUGAR,
    fiber: FIBER,
    water: WATER,
  }

  for (const d of activeDeltas(p)) {
    if (d.source === excludeSource) continue
    d.apply(q, p)
  }

  // 兜底夹取:孕期 +300 之类可能把 kcal 顶出上限,而**推导结果必须落在
  // 面板允许的区间里** —— 否则会出现一个手调够不着的数(往上加会跳回去)。
  const out = {} as Quota
  for (const f of QUOTA_FIELDS) out[f.key] = clamp(f.key, q[f.key])
  return out
}

/**
 * 档案 → 每日配额。**不含 quotaOverrides** —— 那是 updateProfile 的事。
 *
 * `now` 可注入,是为了能问出「同一个人,过一年会差多少」这种问题
 * (verify-loop 里就有一条)。生产调用一律不传。
 *
 * ⚠️ 由此带来的一件小事:配额是**编辑档案那一刻**算好存进 `Profile.quota` 的,
 *    所以它不会在用户生日那天自己变。真实产品也要面对同一件事(要么定期
 *    重算、要么把年龄在那一刻冻住),这里选了「不动」:档案页显示的年龄是
 *    当下的,配额是上次编辑时的,差一岁 = 几 kcal,而定期重算会在用户毫不知情
 *    的情况下改掉他手调过的数字旁边那个「依据」。
 */
export function quotaFor(p: QuotaInput, now: Date = new Date()): Quota {
  return compute(p, undefined, now)
}

/* ============================================================
   解释 —— 「这个数为什么是这样」
   ============================================================ */

export interface QuotaNote {
  /** 「高血压」「孕期」「痛风」 */
  source: string
  /** 「钠上限 1500mg」;不动配额的那几条是空串 */
  effect: string
  /**
   * 这条调整**实际动到了哪几项** —— 从「把这条拿掉再算一遍」的差值里来的,
   * 不是照着 `d.keys` 抄的(拼错了字的那条 source 靠这个才不会硬说改了钠)。
   *
   * 加它是为了 `quotaBasis`:结果页那条钠的建议只知道自己用的是 `sodium`,
   * 得反过来问「钠这个数是被哪条调整改的」。没有这一位的话,那句话只能去
   * **解析 `effect` 那段文字**(「钠上限 1500mg、热量目标 1900kcal」里找「钠」)
   * —— 文案一改,匹配就静默失效。
   *
   * 不动配额的那几条是空数组。
   */
  keys: QuotaKey[]
  basis: string
  /**
   * 这条调整的推导值被手改挡住了 —— 界面要写「未采用」,并给一个重新询问的入口。
   * 没有这一位的话,用户勾了高血压却看到钠还是他手调的 1200,
   * 只会以为功能坏了。
   */
  blockedByOverride: boolean
}

/**
 * 「条件调整想让某项变成 X,但它被手改钉在 Y」—— 带上是哪条条件触发的。
 *
 * 只此一处实现,上面 `QuotaNote.blockedByOverride` 和下面 `blockedAdvice`
 * 都从它派生。分成两份的话,「界面写着未采用、但点开却没有可采用的项」
 * 这种自相矛盾迟早会出现。
 */
interface BlockedChange extends QuotaChange {
  source: string
}

function blockedChanges(p: QuotaInput): BlockedChange[] {
  const full = compute(p)
  const out: BlockedChange[] = []

  for (const d of activeDeltas(p)) {
    const without = compute(p, d.source)
    for (const k of d.keys) {
      // 这条调整本来会改到它吗 —— 没改到的就没有冲突可言
      if (without[k] === full[k]) continue
      const pinned = p.quotaOverrides[k]
      // 钉的值恰好等于推导值不算挡住:用户想要的正是自动给的那个
      if (pinned === undefined || pinned === full[k]) continue
      const f = quotaField(k)
      out.push({ key: k, label: f.label, unit: f.unit, pinned, suggested: full[k], source: d.source })
    }
  }
  return out
}

/**
 * 当前档案下生效的所有调整,连同它们各自改了什么。
 *
 * 每一项都是「把这条拿掉再算一遍」和「全算一遍」对比出来的 —— 所以界面上
 * 印的字**不可能**和实际算法不一致(代价是多算几次,八个数而已)。
 */
export function quotaNotes(p: QuotaInput): QuotaNote[] {
  const full = compute(p)
  const blocked = blockedChanges(p)

  const adjusted = activeDeltas(p).map((d) => {
    const without = compute(p, d.source)
    const moved = d.keys.filter((k) => without[k] !== full[k])
    const effect = moved.map((k) => formatQuota(k, full[k])).join('、')
    return {
      source: d.source,
      effect,
      keys: moved,
      basis: d.basis,
      blockedByOverride: blocked.some((b) => b.source === d.source),
    }
  })

  const notices = NO_QUOTA_EFFECT.filter(
    (n) => p.specialStages.includes(n.source) || p.chronicConditions.includes(n.source)
  ).map((n) => ({ source: n.source, effect: '', keys: [], basis: n.basis, blockedByOverride: false }))

  return [...adjusted, ...notices]
}

/* ============================================================
   依据 —— 「这一项为什么是这个数」
   ============================================================ */

/**
 * 没有条件调整时,这一项的默认值是从哪儿来的。
 *
 * 两类得分开,因为它们**真的**是两种来处:
 *   · 热量/蛋白质/碳水/脂肪 —— 由**档案的基础信息**(性别、年龄、身高、体重)
 *     经 Mifflin-St Jeor × 活动系数算出来的,换个人就是另一个数。
 *   · 钠/添加糖/膳食纤维/饮水 —— 指南常量,和你是谁无关。
 *
 * 写成 `Record<QuotaKey, string>` 而不是 `switch`:加一项配额时忘了给它一个
 * 来处是**编译错误**,而不是界面上悄悄少半句话(「→ 钠上限 2000mg」)。
 *
 * 用「基础信息」这个词,不用「身高体重」:档案页底下那句脚注写的就是
 * 「结合**基础信息**自动计算」,一个词只该有一种说法。
 */
const BASE_SOURCE: Record<QuotaKey, string> = {
  kcal: '基础信息',
  protein: '基础信息',
  carb: '基础信息',
  fat: '基础信息',
  sodium: '膳食指南',
  sugar: '膳食指南',
  fiber: '膳食指南',
  water: '膳食指南',
}

/**
 * 「这一项为什么是这个数」的一句话 —— 「高血压 → 钠上限 1500mg」。
 *
 * ## 它和档案页印的是**同一串字节**
 *
 * 有条件调整时,这句话就是 `quotaNotes()` 那条的 `source` 加 `effect` 原样拼起来
 * 的 —— 档案页「这些数字为什么是这样」印的正是 `{source} → {effect}`。所以
 * 结果页那条建议下面写「高血压 → 钠上限 1500mg」,用户在档案页看到的会是**一模
 * 一样的一行**。这不是巧合,是 `quota.ts` 建这个文件的全部理由(见文件头):
 * 三件事由同一张表驱动,而「解释」是其中一件。
 *
 * ## 手改过的时候说手改
 *
 * `quotaFor()` 算出来的值和 `Profile.quota` 里存的值可以不一样 —— 用户手调过
 * 那一项(`quotaOverrides`)。这时候屏幕上正在用的数是**他钉的那个**,所以依据
 * 只能是「你手动设的 → 钠上限 1200mg」。拿推导值去解释屏幕上的数字,是在用一个
 * 不是它的数解释它。
 *
 * (高血压那条建议被手改挡住这件事,档案页另有「未采用」和重新询问的入口
 * —— 那里回答的是「你要不要改用 1500」,和这里回答的「这个数哪来的」是两个问题。)
 *
 * ⚠️ 参数是 `Profile` 而不是 `QuotaInput`。它不是凑巧:它要解释的是**存下来的
 * 那个数**(`Profile.quota`),而 `QuotaInput` 恰好把 `quota` 排除在外 ——
 * 那份类型是给推导函数用的,好让「推导公式读了上一次的推导结果」写不出来
 * (见它的注释)。这里要读的正是那个结果,所以收全的。
 */
export function quotaBasis(p: Profile, key: QuotaKey): string {
  const { source, value } = basisParts(p, key)
  return `${source} → ${value}`
}

/**
 * 依据的**前半句**(「谁定的」)和**后半句**(「定成了什么」),分开给。
 *
 * 存在的理由是对话页:一段回答可能同时引用三个数(热量余量、钠余量、蛋白质
 * 余量),而这三条依据的前半句往往**是同一句话**(「基础信息」)。整句整句地
 * 接起来会变成
 *
 *     依据 · 基础信息 → 热量目标 1800kcal · 基础信息 → 钠上限 2000mg ·
 *            基础信息 → 蛋白质目标 65g
 *
 * —— 引用了三次「基础信息」,而它只该说一次。所以调用方按 `source` 归并、
 * 把 `value` 用「、」连起来:
 *
 *     依据 · 基础信息 → 热量目标 1800kcal、钠上限 2000mg、蛋白质目标 65g
 *
 * ⚠️ **这两个函数和 `quotaBasis` 是同一个判据**,不是它的复制品 ——
 * 三条分支只在 `basisParts` 里写了一遍。分开写两遍的话,哪一天「什么算手改」
 * 变了(比如多一条容差),就会出现「**你手动设的** → 钠上限 2000mg」这种
 * 前半句说手改、后半句却是推导值的句子,而且两个函数各自看都自洽。
 */
export function quotaSource(p: Profile, key: QuotaKey): string {
  return basisParts(p, key).source
}

export function quotaValueBasis(p: Profile, key: QuotaKey): string {
  return basisParts(p, key).value
}

/**
 * 把若干项的依据合成**一行** —— 同「谁定的」的合起来只说一次。
 *
 *     基础信息 → 热量目标 1800kcal、钠上限 2000mg、蛋白质目标 65g
 *
 * 分开给 `quotaSource`/`quotaValueBasis` 的全部理由就在这个函数里(见上面的
 * 注释):不归并的话「基础信息」会被印三遍。
 *
 * ⚠️ **两个消费方都走这里**:对话页那行小字(`localAnswer.ts`)和发给 agent 的
 * `quotaBasis`(`agentContext.ts`)。各写一份的话,模型说的话和屏幕上那行小字
 * 迟早会用两种口径说同一件事 —— 而这个仓库最不能接受的就是那个。
 *
 * ## 归并要做**两次**,第二次是同一个来处里重复的那句
 *
 * 一条条件调整可以同时动**好几项** —— 孕中期那条动的是 kcal 和 protein 两项,
 * 而 `QuotaNote.effect` 是那条调整**整句**(「热量目标 2000kcal、蛋白质目标 80g」),
 * 不是逐项拆开的。所以按来处归并之后,同时引用这两项的调用方会拿到
 *
 *     孕期 → 热量目标 2000kcal、蛋白质目标 80g、热量目标 2000kcal、蛋白质目标 80g
 *
 * —— 同一句话印了两遍,而屏幕上另外那半句(「基础信息」)是对的,所以它读起来
 * 只像是「孕期那条比较长」。孕期的对话页问一句「今天概况」就会撞上这一支
 * (`localAnswer` 的 general 分支正好同时引 kcal 和 protein),发给 agent 的
 * 八项全量表更是每一份孕期档案都带着它。
 *
 * 按**同一来处内**的字符串去重是最贴切的判据:一个 `value` 相同的两句就是同一
 * 句话,而 `formatQuota` 带着项名,两项真不同时字符串也必然不同 —— 所以这里
 * 去不掉任何一条真信息。
 */
export function quotaBasisLine(p: Profile, keys: QuotaKey[]): string {
  /** 用 Map 而不是按 source 排序:项的先后由调用方决定,这里只负责归并 */
  const bySource = new Map<string, string[]>()
  for (const key of keys) {
    const source = quotaSource(p, key)
    const value = quotaValueBasis(p, key)
    const values = bySource.get(source)
    if (!values) bySource.set(source, [value])
    else if (!values.includes(value)) values.push(value)
  }
  return [...bySource].map(([source, values]) => `${source} → ${values.join('、')}`).join(' · ')
}

function basisParts(p: Profile, key: QuotaKey): { source: string; value: string } {
  const pinned = p.quotaOverrides[key]
  if (pinned !== undefined && pinned !== compute(p)[key]) {
    return { source: '你手动设的', value: formatQuota(key, pinned) }
  }

  const note = quotaNotes(p).find((n) => n.keys.includes(key))
  if (note) return { source: note.source, value: note.effect }

  return { source: BASE_SOURCE[key], value: formatQuota(key, p.quota[key]) }
}

/**
 * 把「被手改挡住」的那几条重新组装成一次询问 —— 档案页「配额来处」那行
 * 点开时用它。
 *
 * 没有这个函数的话,「（你手动设过,未采用）」那行就只能干看着:
 * 用户当时点了「保留我的」,此后再也没有机会改主意。
 */
export function blockedAdvice(p: QuotaInput): QuotaChange[] {
  return blockedChanges(p).map(({ key, label, unit, pinned, suggested }) => ({
    key,
    label,
    unit,
    pinned,
    suggested,
  }))
}

/* ============================================================
   手改 vs 条件调整
   ============================================================ */

export interface QuotaChange {
  key: QuotaKey
  /** 「热量」 */
  label: string
  unit: string
  /** 用户钉住的、当前生效的值 */
  pinned: number
  /** 条件调整想把它变成的值 */
  suggested: number
}

/**
 * 「档案改了之后,有哪些**被手改钉住**的项,其推导值变了」。
 *
 * 判据只看着两头,不看中间:before 和 after 的推导值不一样 ⇒ 这次编辑动了
 * 这条调整。所以**同一份档案反复保存不会反复弹问** —— 第二次 before/after
 * 的推导值相同,返回空数组。
 *
 * 调用方要先把档案存下来再问(见 ProfileScreen):这样「保留我的」就是
 * 什么都不做,点背景关掉也等于保留,不留半状态。
 */
export function quotaAdvice(before: QuotaInput, after: QuotaInput): QuotaChange[] {
  const b = compute(before)
  const a = compute(after)

  const out: QuotaChange[] = []
  for (const f of QUOTA_FIELDS) {
    const pinned = after.quotaOverrides[f.key]
    if (pinned === undefined) continue
    if (a[f.key] === b[f.key]) continue
    out.push({ key: f.key, label: f.label, unit: f.unit, pinned, suggested: a[f.key] })
  }
  return out
}
