/**
 * Agent 回复的解析层
 * ===========================================================
 * 这个 Dify agent 不是聊天机器人,是**结构化输出** —— 它把一整段 JSON
 * 当作回答文本吐出来。不解析就直接渲染的话,屏幕上是一坨带 \" 的 JSON。
 *
 * 契约是探测出来的,不是猜的(见 README「接入 Dify agent」)。四种 mode:
 *   plate       餐盘复盘   dishes[{name, suitable, reason}]
 *   dish        单菜分析   dishes 同上,外加 recipe[] 与 healthModification
 *   ingredient  知识问答   只有 title / advice,没有 dishes
 *   menu        食谱/打招呼 dishes 里装的是**整餐**(名字很长,不是单个菜)
 *
 * 另有一条独立分支:blocked:true 时**根本没有 result** ——
 * 这是过敏拦截,风险信息本身就是全部内容。别把这种情况当成解析失败。
 *
 * 解析必须容错:对面是模型,不是编译器。它可能加 ``` 围栏、可能在 JSON
 * 前后裹一句客套话、可能少给字段。任何一步失败都返回 null,
 * 由调用方退回渲染纯文本 —— 宁可显示得难看,不能显示不出来。
 */

import type { FoodNutrition } from '../data/foods'

/** 风险等级。模型偶尔会给出预期外的值,统一归到 unknown */
export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown'

/**
 * 库外菜的联网营养 —— **两个键要么都在,要么都不在**。
 *
 * 所以它是个联合类型而不是两个并列的可选字段:「有数字没出处」和
 * 「有出处没数字」都是要拦的状态,而写成两个可选字段的话,它们**能表示出来**,
 * 于是下游每一处都得再判一次。这里让它们不可表示。
 */
interface WebNutrition {
  per100g: FoodNutrition
  source: string
}

export interface AgentDish {
  name: string
  /** false = 模型明确判定这道菜不合适。字段缺失按 true 处理 —— 不轻易给用户标红 */
  suitable: boolean
  reason: string
  /** 做法步骤,只有 dish 模式有 */
  recipe: string[]
  /** 健康化改良说明,只有 dish 模式有 */
  healthModification: string
  /**
   * 模型从食物库目录里挑的 foodId。**可选** —— 提示词里给了目录才有。
   *
   * 有就用、没有就退回按名字匹配,两条路 `matchDishes` 都支持(见 `DishInput`)。
   *
   * 这里**不做任何合法性判断**:模型编一个不存在的 id 和给一个真的,
   * 在字符串层面长得一模一样。校验是 `matchDishes` 的事 —— 它查不到就退回
   * 按名字匹配。在这儿拦一道只会多一处可能写错的地方。
   *
   * ⚠️ 这个字段以前**在解析这一步被丢掉了**(映射里只挑了 name/suitable/
   * reason/recipe/healthModification 五个字段),于是提示词里加了目录也不生效,
   * 而且不报错 —— 表现是「改了提示词,什么都没发生」。verify-reply.mjs 里
   * 有一节专门盯着这条链路。
   */
  foodId?: string
  /** 模型估的克数(可选)。缺省则用食物库里的常见分量 */
  grams?: number
  /**
   * 库里没有这道菜时,Dify 工作流联网查回来的每 100g 值 + 出处。
   *
   * 口径与食物库一致(每 100g、熟食、可食部、油盐已折算),所以它能直接进
   * 计算 —— 前提是 `matchDishes` **在食物库里没匹配到**。库内命中的菜不许被
   * 这个值覆盖:食物库那 58 条是同一把尺子量出来的,而搜索结果不是。
   * 顺序由 `matchDishes` 里那段 web 分支的位置保证(见那里的注释)。
   *
   * ⚠️ 和 `foodId` 一样,这个字段**在解析这一步被丢掉过一次**(映射里没挑它),
   * 表现同样是「改了上游,界面上什么都没发生」。verify-reply.mjs 里有一节
   * 端到端盯着这条链路 —— 它同时穿过解析层、转交层(`recognizeAgent.ts`)
   * 和匹配层,三层里任何一层漏转发,那一节都会红。
   *
   * 缺了它这道菜**不会消失**:`matchDishes` 会退回 `unmatched:` 哨兵,
   * 界面上如实写「不在食物库里,按 0 计」。少一个数字,好过多一道凭空消失的菜。
   */
  per100g?: FoodNutrition
  /** 上面那份 `per100g` 的出处(网页名/数据库名)。与它同生共死,不允许为空 */
  source?: string
}

/**
 * 一样「识别到的食材」—— `fridge` 模式给的那份清单。
 *
 * 和 `AgentDish` 的区别是**它没有营养、也没有适宜与否**:这是一份原料清单,
 * 不是一份菜单。所以它在卡片上是另一种块(一串「名称 · 分类」的胶囊),
 * 不能混进菜品块 —— 那会凭空多出几道「适宜」的菜。
 */
export interface AgentIngredient {
  name: string
  /**
   * 食物分类。模型给才有,缺了就只显示名字(不显示那个「 · 分类」)。
   *
   * 和 `AgentDish.foodId` 一样**不做合法性判断**:编一个分类和给一个真的,
   * 在字符串层面长得一模一样,而这里没有任何下游会拿它去查表。
   */
  category?: string
}

/**
 * 配料表 / 营养标签 —— `ingredient` 模式给的那份。
 *
 * ⚠️ **这个字段在解析这一步被丢掉过一次**(映射里只挑了 7 个键,没有
 * `nutrition`),表现和 `foodId` / `per100g` 那两处注释写的一模一样:
 * 「改了上游,界面上什么都没发生」,而且不报错。`verify-reply.mjs`
 * 里有一条端到端盯着它 —— 它同时穿过解析层和渲染层。
 *
 * ⚠️ 别和 `AgentDish.per100g` 混了。那个是**算营养用的每 100g 值**(六项齐全
 * 才有效,进得了求和);这里的是**标签上印的那几行字**,是给人看的字符串,
 * 两者口径完全不同,谁也不许喂给谁。
 */
export interface AgentNutrition {
  /** 配料表里识别出的原料(按包装上印的顺序) */
  ingredients: string[]
  /** 营养成分表:一行一项,`label` 是项目名(如「钠」),`value` 是印的数(如「800mg」) */
  labels: { label: string; value: string }[]
  /** 标签上的风险项,如「高钠」「含反式脂肪酸」 */
  riskItems: string[]
}

/**
 * 这份营养标签里有没有可显示的东西。
 *
 * 三样全空就是「没有」—— 和 `AgentReply` 那条「空壳 JSON 不如把原文交回去」
 * 的判据用的是同一件事,所以它必须能被外面问到,而不是散在渲染层里。
 */
export function nutritionHasContent(n: AgentNutrition): boolean {
  return n.ingredients.length > 0 || n.labels.length > 0 || n.riskItems.length > 0
}

export interface AgentReply {
  /** true = 命中过敏等硬拦截,此时 dishes / advice 一律为空 */
  blocked: boolean
  risk: {
    level: RiskLevel
    message: string
    /**
     * 风险条目。**不止是过敏原** —— 实测同一字段有时给 ["花生"](拦截分支),
     * 有时给 ["高油、高盐、潜在高糖"](单菜分析)。所以渲染时别当过敏原看,
     * 配色也要跟着 level 走,不能一律标红。
     */
    items: string[]
  }
  mode: string
  /**
   * 模型自己给这份回复起的标题。
   *
   * ⚠️ 2026-09-23 起它归**菜品块**(照膳享:`n.title || '推荐'`),
   * 不再归建议块。以前它是建议块的标题 —— 换块之后建议块退回兜底文案。
   */
  title: string
  dishes: AgentDish[]
  /**
   * 识别到的食材(`fridge` 模式)。没有这个模式时恒为空数组,卡片上整块不出现。
   *
   * 空数组而不是可选:调用方 `reply.ingredients.length > 0` 是唯一的判据,
   * 可选会多出「undefined 和 [] 是不是一回事」这一问,而它们在这里就是。
   */
  ingredients: AgentIngredient[]
  /** 配料表 / 营养标签(`ingredient` 模式)。三样都空时卡片上整块不出现 */
  nutrition: AgentNutrition
  advice: string[]
  disclaimer: string
}

/* ------------------------------------------------------------
   取值助手 —— 模型给什么类型都不该让解析崩掉
   ------------------------------------------------------------ */

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/**
 * 模型给的克数 —— 它有时给数字,有时给 `"150g"` 这种字符串。
 *
 * 解析不出来就**返回 undefined**,让这个键根本不出现 —— 不传 0:
 * 缺省会让 `matchDishes` 用食物库的常见分量,而 0 会变成一道真的 0g 的菜,
 * 而且是在界面上看不出来的那种。
 *
 * 上下界与取整的夹取在 `dishMatch.clampGrams` 里,这里只管把字符串变成数。
 */
function asGrams(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN
  return Number.isFinite(n) ? n : undefined
}

function asText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function asTextList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(asText).filter((s) => s.length > 0) : []
}

function asLevel(v: unknown): RiskLevel {
  return v === 'low' || v === 'medium' || v === 'high' ? v : 'unknown'
}

/**
 * 食材清单。**名字为空的那一项整个丢掉** —— 一个只有分类没有名字的胶囊
 * 在屏幕上写着「 · 蔬菜」,看着像界面坏了。
 */
function asIngredientList(v: unknown): AgentIngredient[] {
  return (Array.isArray(v) ? v : [])
    .map(asRecord)
    .map((r) => {
      const name = asText(r.name)
      const category = asText(r.category)
      return { name, ...(category ? { category } : {}) }
    })
    .filter((i) => i.name.length > 0)
}

/**
 * 营养成分表 —— 模型给的是一个**对象**(`{"钠":"800mg","能量":"1200kJ"}`),
 * 不是一个数组。这里转成有序数组,因为:
 *
 *   1. 渲染层要的是「一行一项」,对象的键顺序在 JS 里虽然有序,但那是
 *      实现细节,靠它排版等于把版式押在语言规范的一条脚注上;
 *   2. 转成数组之后 `label` 和 `value` 是**两个有名字的位置**,不会有人
 *      哪天顺手把 key 和 value 写反。
 *
 * 值为空的项丢掉(标签上印着一项没有数值,那是没识别出来)。
 */
function asLabels(v: unknown): { label: string; value: string }[] {
  return Object.entries(asRecord(v))
    .map(([label, raw]) => ({ label: label.trim(), value: asText(raw) }))
    .filter((l) => l.label.length > 0 && l.value.length > 0)
}

/**
 * 配料表 / 营养标签那一支。
 *
 * `riskItems` 在**两处**都出现过:实测膳享+ 把风险写在 `result.nutrition.riskItems`,
 * 而食衡写在顶层 `risk.items`。这里两处都收 —— 顶层那份归风险结论条(已经有),
 * 这份归营养标签块(新加),它们是两个块、两份数据,不许互相覆盖。
 */
function asNutrition(v: unknown): AgentNutrition {
  const r = asRecord(v)
  return {
    ingredients: asTextList(r.ingredients),
    labels: asLabels(r.labels),
    riskItems: asTextList(r.riskItems),
  }
}

/**
 * 营养标签那一支 —— **两个抽屉都要开(2026-09-23)**。
 *
 * 提示词里写的是 `result.nutrition.{ingredients,labels,riskItems}`,但实测膳享+
 * 拍包装时会**把 `labels` / `riskItems` 直接挂在 `result` 上** —— 那一趟的原文里
 * 连 `nutrition` 这个键都没有:
 *
 *     "labels": {"能量":"395kJ / 100g","蛋白质":"3.1g / 100g","钠":"60mg / 100g"},
 *     "riskItems": ["白砂糖","乳成分(乳糖不耐受者慎用)"],
 *
 * 而解析只看 `result.nutrition` ⇒ 这几行**悄悄没了**,卡片上「营养标签」那一块
 * 整块不显示 —— 用户看到的就是**「没有具体说含量」**,可数据在原文里一行不缺。
 * (同一条链路跑第二遍时模型又套了 `nutrition`,所以是时有时无。)
 *
 * 这和 `ingredients` 那三种形状是**同一类错**:数据在,只是放错了抽屉。
 * 两份都收,`nutrition` 那份优先 —— 它是提示词里写对的那个。
 *
 * ⚠️ **不收平铺的 `ingredients`。** 顶层那份已经被「识别到的食材」那块胶囊用掉了,
 * 再喂给这里的「配料」一行,同一串名字会在同一张卡上印两遍。
 */
function pickNutrition(resultRaw: Record<string, unknown>): AgentNutrition {
  const nested = asNutrition(resultRaw.nutrition)
  return {
    ingredients: nested.ingredients,
    labels: nested.labels.length > 0 ? nested.labels : asLabels(resultRaw.labels),
    riskItems: nested.riskItems.length > 0 ? nested.riskItems : asTextList(resultRaw.riskItems),
  }
}

/**
 * 每 100g 值里每一项的合理上界。
 *
 * 取法不是营养学判断,是「这个数在现实里可能存在吗」:
 *   · 900 kcal —— 纯油脂是理论天花板(碳水和蛋白 4、脂肪 9,没有比油更密的)
 *   · 100g    —— 每 100g 里不可能有 100g 以上的蛋白/碳水/脂肪/糖
 *   · 5000mg 钠 —— 已经是 12.8g 盐,一道菜到这一步就没有「更咸」可言了
 *
 * 和 `dishMatch.clampGrams` 的 `[5, 1000]` 是同一把尺子:一个明显错误的数字
 * 比一个保守的默认值更糟。这里的下界是 0(负的营养值没有含义)。
 */
const PER100G_LIMITS: Record<keyof FoodNutrition, number> = {
  kcal: 900,
  protein: 100,
  carb: 100,
  fat: 100,
  sodium: 5000,
  sugar: 100,
}

/**
 * 联网查回来的每 100g 值。**六项缺一不可,任何一项不合法就整个作废。**
 *
 * 为什么是「整个作废」而不是「丢掉那一项」:六项是一份营养标签,不是六个
 * 独立的数。丢掉钠,那一项会变成 0 —— 而这个 App 的核心主张就是钠,
 * 界面上看不出那是个被丢掉的键,只会显示「这道菜钠很低」。
 * 作废之后那道菜退回「不在食物库里,按 0 计」,至少是真话。
 *
 * 为什么不接字符串数字(`"168"`):上游那个代码节点(「合并营养」)保证的是
 * **数值**,它在六项全是数字时才放行。客户端再开一个口子,就等于同一份数据
 * 有两套校验标准 —— 而其中一套宽松的那边,永远不会有人去测。
 * `asGrams` 收字符串是因为克数**本来就是**模型自由生成的,没有上游把关。
 *
 * 上界见 `PER100G_LIMITS`;`NaN` / `Infinity` / 负数 / 缺失键一律作废。
 */
function asPer100g(v: unknown): FoodNutrition | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  const r = v as Record<string, unknown>

  const out: Partial<FoodNutrition> = {}
  for (const key of Object.keys(PER100G_LIMITS) as (keyof FoodNutrition)[]) {
    const n = r[key]
    if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
    if (n < 0 || n > PER100G_LIMITS[key]) return undefined
    out[key] = n
  }
  return out as FoodNutrition
}

/**
 * 从模型输出里挖出 JSON 对象 —— 容忍 ``` 围栏和前后多余的说明文字。
 */
function extractJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim()
  if (!text) return null

  // 围栏:```json {…} ``` —— 模型很爱加
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  const body = fenced ? fenced[1] : text

  const candidates = [body]
  // 前后可能裹着「好的,以下是分析结果:」之类的客套话,按首尾花括号再切一刀
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start !== -1 && end > start) candidates.push(body.slice(start, end + 1))

  for (const candidate of candidates) {
    try {
      const record = asRecord(JSON.parse(candidate) as unknown)
      if (Object.keys(record).length > 0) return record
    } catch {
      // 这个候选不是合法 JSON,试下一个
    }
  }
  return null
}

/**
 * 把 agent 的原始回答解析成结构化回复。
 * @returns 解析成功返回对象;不是结构化回复(或结构残缺到没有可展示内容)返回 null
 */
export function parseAgentReply(raw: string): AgentReply | null {
  const root = extractJson(raw)
  if (!root) return null

  const blocked = root.blocked === true
  const riskRaw = asRecord(root.risk)
  const resultRaw = asRecord(root.result)

  const risk: AgentReply['risk'] = {
    level: asLevel(riskRaw.level),
    message: asText(riskRaw.message),
    items: asTextList(riskRaw.items),
  }

  const dishes: AgentDish[] = (Array.isArray(resultRaw.dishes) ? resultRaw.dishes : [])
    .map(asRecord)
    .map((d) => {
      const foodId = asText(d.foodId)
      const grams = asGrams(d.grams)
      // 两个键同生共死:没有出处的数字不许进计算,有出处没数字更不行。
      // 少了出处,界面上那句「来自联网检索(薄荷健康)」就写不出来 ——
      // 而一个来路不明的数字出现在营养合计里,比缺一个数字糟得多。
      const per100g = asPer100g(d.per100g)
      const source = asText(d.source)
      const web: WebNutrition | null = per100g && source ? { per100g, source } : null
      return {
        name: asText(d.name),
        suitable: d.suitable !== false,
        reason: asText(d.reason),
        recipe: asTextList(d.recipe),
        healthModification: asText(d.healthModification),
        // 提示词里给了才带这两个键。带了就是「有就用」,没带就退回按名字匹配 ——
        // 条件展开而不是 `foodId: undefined`,是为了让「模型到底给没给」在
        // 下游能一眼看出来(见 store.ts 里 thumb 那处的同款注释)
        ...(foodId ? { foodId } : {}),
        ...(grams !== undefined ? { grams } : {}),
        // 同款条件展开。`?? {}` 展开出来是「两个键都不出现」,而不是
        // `per100g: undefined` —— 下游 `dishMatch` 判的是**有没有这个值**
        ...(web ?? {}),
      }
    })
    .filter((d) => d.name.length > 0)

  const reply: AgentReply = {
    blocked,
    risk,
    mode: asText(resultRaw.mode),
    title: asText(resultRaw.title),
    dishes,
    /*
      ⚠️ **配料清单有两个出处,都要接住(2026-09-23)。**

      提示词里 `ingredients` 和 `nutrition.ingredients` 是两个字段:

        · `ingredients`            —— fridge 那条路(拍食材)填的对象数组
        · `nutrition.ingredients`  —— ingredient 那条路(拍配料表)填的**字符串数组**

      实测:用户拍配料表问「读配料」,模型把配料填进了 `nutrition.ingredients`
      (`["生牛乳","白砂糖","浓缩草莓汁",…]`),而 `ingredients` 是空的 ——
      于是卡片上**配料那一块空着**,用户看到的就是「没读出来」。

      这跟「钠糖挂行」是同一类错:**数据在,只是放错了抽屉,而渲染只开了一个抽屉。**
      字符串数组转成 `{name}` 就够(渲染只用 name)。
    */
    ingredients: (() => {
      /*
        ⚠️ **同一个字段,模型会给出三种形状 —— 三种都要接住(2026-09-23)。**

        实测(同一条链路、同一张配料表照片,连跑两次):

          第一次   result.nutrition.ingredients = ["生牛乳","白砂糖",…]
          第二次   又是别的形状

        而 `asIngredientList` 只认**对象数组**(fridge 那条路填的
        `[{name,category,note}]`)。字符串数组喂进去它返回空 —— 于是卡片上
        「配料」那一块空着,用户看到的就是**「没读出来」**,可数据明明在。

        这跟本仓库另外两处是同一个毛病:钠糖两条挂错了行、`per100g` 放在
        `nutrition` 里而解析只看 `dishes` —— **数据在,只是放错了抽屉,
        而渲染只开了一个抽屉**。所以这里把三个抽屉全开:

          ① `result.ingredients`            对象数组(fridge 那条路)
          ② `result.ingredients`            字符串数组(模型偷懒时的写法)
          ③ `result.nutrition.ingredients`  字符串数组(ingredient 那条路)
        */
      const asNames = (v: unknown): { name: string; category: string; note: string }[] =>
        Array.isArray(v)
          ? v
              .map((n) => asText(n))
              .filter((n) => n.length > 0)
              .map((name) => ({ name, category: '', note: '' }))
          : []

      const direct = asIngredientList(resultRaw.ingredients)
      if (direct.length > 0) return direct
      const flat = asNames(resultRaw.ingredients)
      if (flat.length > 0) return flat
      return asNames(asRecord(resultRaw.nutrition)?.ingredients)
    })(),
    nutrition: pickNutrition(resultRaw),
    advice: asTextList(resultRaw.advice),
    disclaimer: asText(resultRaw.disclaimer),
  }

  // 拦截分支:得有拦截理由才值得渲染,否则退回纯文本
  if (reply.blocked) {
    return reply.risk.message || reply.risk.items.length > 0 ? reply : null
  }

  // 正常分支:标题、菜品、食材、营养、建议全空说明这只是一坨恰好合法的 JSON,
  // 渲染成卡片是个空壳,不如把原文交回去。
  //
  // ⚠️ 这里**必须**把 ingredients / nutrition 也数进去。只数原来那三样的话,
  // 一份「只有食材清单、没有菜品也没有建议」的 fridge 回复(以及一份只有
  // 营养标签的 ingredient 回复)**会被整份丢掉** —— 而它明明有内容可显示。
  // 这是漏字段的另一种坏法:不是「多了个空块」,是「整条回复不见了」。
  if (
    !reply.title &&
    reply.dishes.length === 0 &&
    reply.ingredients.length === 0 &&
    !nutritionHasContent(reply.nutrition) &&
    reply.advice.length === 0
  ) {
    return null
  }

  return reply
}

/**
 * 把「硬拦截」降级成**一条提醒** —— **只给对话页用**。
 *
 * ## 为什么对话页不能硬拦
 *
 * `blocked: true` 的意思是「这一条整份作废,只留风险信息」。这在**拍餐盘**那条
 * 路上是对的:那里有一份具体的建议要拦下来,而且拦的判据是**照片里的菜**。
 *
 * 搬到对话页就变成了另一件事。用户在那儿是**提问**,不是提交一份建议;
 * 拦掉的不是建议,是**回答本身**。卡片上那句「已为你拦截这条建议」在对话页
 * 甚至没有指代对象 —— 那里根本没有「这条建议」。
 *
 * 而且实测拦的往往不是「你这次问的东西」:
 *
 *   · 档案里有鸡蛋(高危)+ 今天记录里恰好有一道含蛋的菜
 *     → 用户问**任何**一句话,回来的都是「检测到高危食材/成分「鸡蛋」,已拦截」,
 *       一条建议都没有(打两次拦两次;把今天记录清空 → 打两次全放行)。
 *   · 也就是说它拦的是「**你今天已经吃过的东西**」——
 *     而「已经吃掉的」不该让用户连问题都问不成。
 *
 * 所以用户 2026-09-23 定的口径是:**聊天里干脆不拦,冲突写成建议里的一行提醒**
 * (`buildChatQuery` 末尾那句就是替他把这话说给模型听)。这一函数是那条口径的
 * **兜底**:模型没听话、还是回了 `blocked: true` 时,把 `blocked` 摘掉,
 * 让 `AgentReplyCard` 走**正常那一支** —— 风险结论条照常显示(那句话还在),
 * 只是不再宣称「已为你拦截」,也不再吞掉整条回复。
 *
 * ⚠️ 摘掉之后 `dishes` / `advice` 仍然是空的(拦截分支上游就没生成),
 * 所以屏上留下的**就是那条风险提示本身**。这正是要的效果:一条提醒,不是一堵墙。
 *
 * ## ⚠️ 等级也得跟着钉住(2026-09-24,用户当天第二次纠的)
 *
 * 光摘 `blocked` 是不够的 —— 那会让提醒**在屏幕上变淡**,而用户 2026-09-24 看到的
 * 正是这个:「可是显眼的高危提醒也没了」。
 *
 * 原因在两个分支的对齐上:`AgentReplyCard` 的拦截分支**不看 level,一律按最高那档
 * 画**(那里写死 `RISK_TONES.high`),而正常那一支按 `risk.level` 配色。模型回
 * `blocked: true` 时经常**不给 level**(`asLevel` 把任何预期外的值归成 `unknown`),
 * 于是同一条冲突:降级前是一张红卡,降级后是一条灰底的「提示」—— 等级词从
 * 「高风险」掉成「提示」,配色从 danger 掉成中性。**降级的是那句「已为你拦截」,
 * 不是这条冲突的严重程度。**
 *
 * 所以这里把 level 也钉成最高那档:屏幕上的重量和降级前一致(拦截分支本来画的就是
 * 这一档,所以这不是新增的说法,是**别在降级时把它一起降掉**)。
 *
 * ⚠️ **别在拍餐盘那条路上用它。** 那里硬拦是对的,`MealResultCard` / `ResultScreen`
 * 的「重新拍一张」也是照着拦截卡设计的。
 */
export function demoteHardBlock(reply: AgentReply): AgentReply {
  return reply.blocked
    ? { ...reply, blocked: false, risk: { ...reply.risk, level: 'high' } }
    : reply
}

/**
 * 把 `1. **减糖**:…;2. **减油**:…` 这种串成一整段的多条说明拆成列表。
 * 只在确实找到 2 条以上编号时才拆 —— 否则原样返回,
 * 免得把「每日摄入 25-30 克」里的数字误当成编号切开。
 */
export function splitNumbered(text: string): string[] {
  const parts = text
    .split(/(?=(?:^|[；;])\s*\d+[.、]\s)/)
    .map((s) =>
      s
        .replace(/^[；;\s]+/, '')
        .replace(/[；;]\s*$/, '')
        .replace(/^\d+[.、]\s*/, '')
        .trim()
    )
    .filter(Boolean)

  return parts.length >= 2 ? parts : [text]
}
