/**
 * 派生层 —— 从餐次记录算出所有展示用的数字
 * ===========================================================
 * 这是让「闭环」成立的关键:首页的健康分、今日汇总、日记的趋势、
 * 结果页的营养条,全部由这里从 meals 现算,而不是写死的常量。
 *
 * 所以记录一餐之后,所有页面会跟着变 —— 这正是演示要证明的东西。
 */

import { FOOD_BY_ID } from '../data/foods'
import { daysBetween, lastNDays, todayISO } from '../lib/date'
import { isUnmatchedId, isWebId } from '../lib/dishMatch'
import { ZERO_NUTRITION, nutritionOfItem, per100gOf } from '../lib/nutrition'
import { MAIN_SLOTS, MEAL_SLOTS, isMainSlot, isSnackSlot } from '../lib/slots'
import { quotaBasis } from './quota'
import type { MealEntry, MealItem, MealSlot, Nutrition, Profile } from './types'

/**
 * 按实际克数折算一组菜品的营养。
 *
 * 取「一项的营养」这件事本身在 `lib/nutrition.ts` —— 那里管着**两个来源**
 * (食物库 / 条目自带)谁优先。这里只负责求和。
 *
 * ⚠ 求和之前要知道:「取不到来源」的条目会被折算成 0,而它们分三种,
 * 含义完全不同,一定要分清楚:
 *
 *   · `unmatched:` 哨兵(dishMatch 产出的) → **已知的不知道**。用户拍了一道
 *     库里没有、联网也没查到的菜,结果页和确认分量页都会显式写
 *     「不在食物库里,按 0 计」。这是设计好的行为,不需要在这里再报一次
 *   · `web:` 项但 `per100g` 不见了 → **本该有值却丢了**。它只在某一层把
 *     字段吃掉之后出现(比如又加了一层映射却没转发),而那时归零**没有任何
 *     地方会说出来**。由 [findLostWebNutrition](#findlostwebnutrition) 负责
 *   · 一个**看起来正常、但库里已经没有**的 id → **不知道的不知道**。它只会在
 *     某个 foodId 被改名或从 `data/foods.ts` 删掉之后出现,而那时旧记录还躺在
 *     localStorage 里。同样按 0 计、同样没人说 —— 由
 *     [findBrokenRefs](#findbrokenrefs) 负责
 *
 * 换句话说:这里继续沉默是可以的,**前提是有人替它出声**。
 */
export function nutritionOfItems(items: MealItem[]): Nutrition {
  return items.reduce<Nutrition>((acc, item) => addNutrition(acc, nutritionOfItem(item)), {
    ...ZERO_NUTRITION,
  })
}

/**
 * 落盘记录里指向了**食物库中已经不存在的** foodId。俗称「幽灵条目」。
 * ===========================================================
 * 这是 `nutritionOfItems` 会静默归零的两种情形里的第二种,也是唯一一处
 * 「算错了而界面上看不出来」的地方。触发条件是 foodId 被改名或从
 * `data/foods.ts` 里删掉 —— 而食物库正在被频繁扩充,扩库的人手上没有护栏。
 *
 * `MealItem.name` 是**冗余存下来的**(types.ts 里写明了理由:食物库换版本后
 * 旧记录仍能显示),所以这里能报出「是哪道菜」,而不只是一个 id。
 *
 * 为什么不把食物库改成软删除(退休的食物留着不删)
 * ------------------------------------------------------------
 * 那样数字能原样保住,但会换出一个**新的静默**:退休的食物还在参与计算,
 * 而没有任何地方说明它已经不推荐了。这个仓库对这类取舍的立场是一致的
 * (见 README 里别名表的边界)——宁可把不确定说出来,也不要一个悄悄正确的数字。
 * 报出来之后,修法由人决定:改回现有 id,或者把缺的那条补回库里。
 */
export interface BrokenRef {
  foodId: string
  /** 记录里冗余存下来的菜名 —— 库里已经没有它了,只剩这个名字 */
  name: string
  /** 一共出现在几个条目里(同一道菜出现在两餐就是 2) */
  count: number
}

/**
 * 找出所有幽灵条目,按出现次数从多到少排。
 *
 * 哨兵(`unmatched:`)要显式排除 —— 它们**同样不在** `FOOD_BY_ID` 里,
 * 但含义相反:那是「我们知道的不知道」,界面上早就标了「按 0 计」。
 * 不排除的话,用户每拍一道库外的菜,日记页就会多一条假警报 ——
 * 而假警报的代价是这个真警报再也没人看(见 probe-vision 第 2 步那个恒亮的红灯)。
 *
 * `web:` 项**同理排除**,但理由不同、代价更大:它不在 `FOOD_BY_ID` 里是**设计**,
 * 营养来自条目自带的 `per100g`(`lib/nutrition.ts` 的 `per100gOf` 认它)。
 * 不排除的话,用户每拍一道联网补到营养的菜,日记页就多一条假幽灵 ——
 * 而这一条警报恰好出现在「联网功能生效了」的时候,最容易被当成功能本身的毛病。
 *
 * 排除之后空出来的那块责任,由 [findLostWebNutrition](#findlostwebnutrition) 接手:
 * 这里只回答「库里没有」,不回答「那它算得出来吗」。
 */
export function findBrokenRefs(allMeals: MealEntry[]): BrokenRef[] {
  const out = new Map<string, BrokenRef>()
  for (const meal of allMeals) {
    for (const item of meal.items) {
      if (isUnmatchedId(item.foodId)) continue
      if (isWebId(item.foodId)) continue
      if (FOOD_BY_ID.has(item.foodId)) continue
      const hit = out.get(item.foodId)
      if (hit) hit.count++
      else out.set(item.foodId, { foodId: item.foodId, name: item.name, count: 1 })
    }
  }
  return [...out.values()].sort((a, b) => b.count - a.count)
}

/**
 * 找出「本该有营养、但值已经不见了」的库外菜(`web:` 项)。
 * ===========================================================
 * 这是上面那条排除规则的**反面**:`findBrokenRefs` 跳过 `web:` 是对的,
 * 但跳过之后必须有人回答「那它还算不算得出来」—— 否则就出现一个比幽灵
 * **更糟**的状态:
 *
 *   · 普通幽灵:名字至少还出现在日记卡上,用户看得见「有这么一条」
 *   · `web:` 项丢了 `per100g`:食物库查不到(那本来就没有)、条目自带的值也没了
 *     → `nutritionOfItem` 返 0 → 这一餐的热量与钠悄悄偏低,**全 App 没有
 *     任何一个地方会出声**
 *
 * 什么时候会走到这里:按构造,`matchDishes` 只在拿到合法 `per100g` 时才产出
 * `web:` 项,所以正常流程永远进不来。它进来只有一个原因 —— **某一层把字段
 * 吃掉了**(这个仓库已经发生过两次:foodId 一次、per100g 一次,都是「改了上游、
 * 界面上什么都没发生」)。所以这个函数的存在意义不是兜底,是**让下一次那类
 * bug 有个响声**。
 *
 * 判据用 `per100gOf`,不用 `item.per100g` —— 「有没有营养来源」只能有
 * 一个定义,和取值走同一个函数(`lib/nutrition.ts` 里那段注释说的就是这件事)。
 */
export function findLostWebNutrition(allMeals: MealEntry[]): BrokenRef[] {
  const out = new Map<string, BrokenRef>()
  for (const meal of allMeals) {
    for (const item of meal.items) {
      if (!isWebId(item.foodId)) continue
      if (per100gOf(item)) continue
      const hit = out.get(item.foodId)
      if (hit) hit.count++
      else out.set(item.foodId, { foodId: item.foodId, name: item.name, count: 1 })
    }
  }
  return [...out.values()].sort((a, b) => b.count - a.count)
}

/** 一条记录的营养 */
export function nutritionOfEntry(entry: MealEntry): Nutrition {
  return nutritionOfItems(entry.items)
}

/** 多条记录求和 */
export function sumNutrition(entries: MealEntry[]): Nutrition {
  return entries.reduce<Nutrition>((acc, e) => {
    const n = nutritionOfEntry(e)
    return {
      kcal: acc.kcal + n.kcal,
      protein: acc.protein + n.protein,
      carb: acc.carb + n.carb,
      fat: acc.fat + n.fat,
      sodium: acc.sodium + n.sodium,
      sugar: acc.sugar + n.sugar,
    }
  }, { ...ZERO_NUTRITION })
}

/* ------------------------------------------------------------
   健康分
   ------------------------------------------------------------ */

export interface ScoreFactor {
  label: string
  /** 这一项扣了多少分。0 表示没问题 */
  penalty: number
  detail: string
  tone: 'brand' | 'warn' | 'danger'
}

export interface HealthScore {
  /** 0-100 */
  score: number
  factors: ScoreFactor[]
  /** 记录不足 2 餐时分数参考价值有限,UI 会加一句提示 */
  provisional: boolean
}

/**
 * 健康分 —— 满分 100,按三项扣分。
 *
 * 权重是刻意设计的:钠扣得最狠(最多 35 分),因为这个 App 的核心主张就是控盐;
 * 热量偏离次之(25 分);蛋白质不足扣 10 分。
 *
 * 每一项扣分都带 detail 文案,所以这个分数是**可解释的** ——
 * 用户能看到为什么掉了分,而不是一个神秘数字。这对健康类产品很重要。
 */
export function healthScore(n: Nutrition, profile: Profile, mealCount: number): HealthScore {
  const factors: ScoreFactor[] = []
  const q = profile.quota

  // --- 1. 钠(权重最高)---
  if (n.sodium > q.sodium) {
    const overRatio = n.sodium / q.sodium - 1
    // 用 ceil 而不是 round:只要越过阈值就至少扣一档。
    // 否则超标 4% 会算出 round(0.4)=0 分,文案说"超标"、分数却不动,自相矛盾。
    const penalty = Math.min(35, Math.ceil(overRatio / 0.1) * 5)
    factors.push({
      label: '钠摄入',
      penalty,
      detail: `超出当日上限 ${Math.round(overRatio * 100)}%`,
      tone: 'danger',
    })
  } else {
    factors.push({
      label: '钠摄入',
      penalty: 0,
      detail: `已达上限的 ${Math.round((n.sodium / q.sodium) * 100)}%，仍在范围内`,
      tone: 'brand',
    })
  }

  // --- 2. 热量偏离(过高或过低都扣)---
  const kcalRatio = n.kcal / q.kcal
  if (kcalRatio > 1.2) {
    const penalty = Math.min(25, Math.ceil((kcalRatio - 1.2) / 0.1) * 4)
    factors.push({
      label: '热量',
      penalty,
      detail: `超出目标 ${Math.round((kcalRatio - 1) * 100)}%`,
      tone: 'warn',
    })
  } else if (kcalRatio < 0.6) {
    const penalty = Math.min(25, Math.ceil((0.6 - kcalRatio) / 0.1) * 4)
    factors.push({
      label: '热量',
      penalty,
      detail: `仅达目标 ${Math.round(kcalRatio * 100)}%，摄入偏低`,
      tone: 'warn',
    })
  } else {
    factors.push({ label: '热量', penalty: 0, detail: `达目标的 ${Math.round(kcalRatio * 100)}%`, tone: 'brand' })
  }

  // --- 3. 蛋白质 ---
  if (n.protein < q.protein * 0.8) {
    const gap = Math.round(q.protein - n.protein)
    factors.push({ label: '蛋白质', penalty: 10, detail: `距目标还差 ${gap}g`, tone: 'warn' })
  } else {
    factors.push({ label: '蛋白质', penalty: 0, detail: `已达目标的 ${Math.round((n.protein / q.protein) * 100)}%`, tone: 'brand' })
  }

  const total = factors.reduce((s, f) => s + f.penalty, 0)

  return {
    score: Math.max(0, Math.min(100, 100 - total)),
    factors,
    provisional: mealCount < 2,
  }
}

/* ------------------------------------------------------------
   单日统计
   ------------------------------------------------------------ */

export interface DayStats {
  date: string
  entries: MealEntry[]
  nutrition: Nutrition
  mealCount: number
  score: HealthScore
  /** 按餐次顺序(早→晚)排列 */
  slots: { slot: string; entries: MealEntry[]; nutrition: Nutrition }[]
}

/**
 * 分桶用的餐次顺序 —— **按时间走**(加餐插在两餐之间),取自 `lib/slots.ts`。
 *
 * 这里原来是本文件内写死的一份 `SLOT_ORDER`,和 `types.ts` 的 `MEAL_SLOTS`
 * 是同四样东西的两份写法。现在只有一份:时段怎么划分、哪几个取值、
 * 什么顺序,全在 `lib/slots.ts`。
 *
 * ⚠️ 顺序**只影响 `stats.slots` 这个数组怎么排**,不影响哪一餐进哪个桶 ——
 * 但它是首页那行「每餐 kcal」和发给食衡的 `todayIntake.meals` 的实际顺序,
 * 所以别拿 `SLOT_ROWS`(面板按钮那个两行顺序)往这儿套。
 */
export function dayStats(allMeals: MealEntry[], date: string, profile: Profile): DayStats {
  const entries = allMeals
    .filter((m) => m.date === date)
    .sort((a, b) => a.createdAt - b.createdAt)

  const nutrition = sumNutrition(entries)

  const slots = MEAL_SLOTS.map((slot) => {
    const inSlot = entries.filter((e) => e.slot === slot)
    return { slot, entries: inSlot, nutrition: sumNutrition(inSlot) }
  }).filter((s) => s.entries.length > 0)

  return {
    date,
    entries,
    nutrition,
    mealCount: entries.length,
    score: healthScore(nutrition, profile, entries.length),
    slots,
  }
}

/* ------------------------------------------------------------
   一句话总结(首页黑卡底部)
   ------------------------------------------------------------ */

/**
 * 生成「早餐、午餐已记录，晚餐待记录。比昨日同期少摄入 320mg 钠」这类总结。
 * 全部由数据推导,不是写死的句子。
 *
 * ⚠️ **这句话只数三餐,不数加餐** —— 「上午加餐待记录」不是一句该说的话
 * (加餐本来就是可有可无的)。所以两边都过 `isMainSlot`,判据只有 `lib/slots.ts`
 * 那一处。
 *
 * 本体在 `daySummaryDetail` —— 它多交一句「依据」。这个只交那句话的写法留着,
 * 是因为绝大多数调用方(和断言)要的就是那段文字,而多包一层对象会让每一处
 * 都变成 `daySummary(...).text`。两个名字共用同一份实现,所以不存在
 * 「哪一句才算数」的问题。
 */
export function daySummary(stats: DayStats, yesterday: DayStats | null, profile: Profile): string {
  return daySummaryDetail(stats, yesterday, profile).text
}

/**
 * 那句话 + 它的依据。
 *
 * `basis` 只在**那句话提到了上限**时才有 —— 也就是「今日钠已超上限 420mg」那一句。
 * 「比昨日同期少摄入 320mg 钠」不提上限,它比的是昨天,和档案里那条高血压无关,
 * 所以那时候是 null。这就是 `usesLimit` 这个变量的全部用途,别把它并进
 * 「有没有提到钠」里:两句话里都有「钠」字,而依据只解释其中一句。
 */
export function daySummaryDetail(
  stats: DayStats,
  yesterday: DayStats | null,
  profile: Profile
): { text: string; basis: string | null } {
  if (stats.mealCount === 0) {
    return { text: '今天还没有记录。拍一张餐盘，或手动补记一餐。', basis: null }
  }

  const recorded = stats.slots.filter((s) => isMainSlot(s.slot)).map((s) => s.slot)
  const missing = MAIN_SLOTS.filter((s) => !recorded.includes(s))

  /*
    ⚠️ 一句都没记到时**不能**直接 `join`。原来那句是
    `` `${recorded.join('、')}已记录` `` —— 只记了加餐的时候 `recorded` 是空数组,
    渲染出来是「**已记录**，早餐、午餐、晚餐待记录。」:第一个字就自相矛盾,
    而且「已记录」前面空着一块(那个空串是 join 出来的)。
    这是个**一直存在**的 bug,只是原来「加餐」只有 21:00 之后才可能出现,
    撞上的机会少;三档加餐之后 9:00–11:00 和 14:00–17:00 记一口就会撞上。
  */
  let text = recorded.length ? `${recorded.join('、')}已记录` : '今天只记了加餐'
  if (missing.length) text += `，${missing.join('、')}待记录`
  text += '。'

  // 与昨日同期比较 —— 只说钠,因为那是这个 App 最关心的指标
  if (yesterday && yesterday.mealCount > 0) {
    const diff = Math.round(stats.nutrition.sodium - yesterday.nutrition.sodium)
    if (Math.abs(diff) >= 50) {
      text += diff < 0 ? `比昨日同期少摄入 ${-diff}mg 钠。` : `比昨日同期多摄入 ${diff}mg 钠。`
    } else {
      text += '钠摄入与昨日同期基本持平。'
    }
  }

  const overSodium = stats.nutrition.sodium - profile.quota.sodium
  /*
    「提到了上限」是这里唯一的判据,而**它不由文字判断** ——
    是这一行 `if` 自己记下来的。上面「比昨日同期…」那句里也有「钠」字,
    但那是两个日子的比较,拿档案里那条高血压去解释它是在胡说。
  */
  let usesLimit = false
  if (overSodium > 0) {
    text += `今日钠已超上限 ${Math.round(overSodium)}mg。`
    usesLimit = true
  }

  return { text, basis: usesLimit ? quotaBasis(profile, 'sodium') : null }
}

/* ------------------------------------------------------------
   周趋势(日记页)
   ------------------------------------------------------------ */

export interface WeekTrend {
  /** 7 天,从早到晚 */
  days: DayStats[]
  /** 有记录的天的日均营养 */
  dailyAvg: Nutrition
  /** 日均钠相对上一个 7 天的变化百分比;无对比数据时为 null */
  sodiumDeltaPct: number | null
  /** 从今天往前数,连续多少天钠未超上限 */
  sodiumStreak: number
}

export function weekTrend(allMeals: MealEntry[], profile: Profile, days = 7): WeekTrend {
  const dates = lastNDays(days)
  const dayList = dates.map((d) => dayStats(allMeals, d, profile))
  const active = dayList.filter((d) => d.mealCount > 0)

  // 日均只统计**有记录的天** —— 把没记录的空白天算进去会拉低日均,
  // 让"我最近吃得挺清淡"变成一个假象
  const dailyAvg = active.length
    ? divideNutrition(
        active.reduce<Nutrition>((acc, d) => addNutrition(acc, d.nutrition), { ...ZERO_NUTRITION }),
        active.length
      )
    : { ...ZERO_NUTRITION }

  // 与前一个等长窗口比较
  const prevDates = lastNDays(days * 2).slice(0, days)
  const prevActive = prevDates.map((d) => dayStats(allMeals, d, profile)).filter((d) => d.mealCount > 0)
  let sodiumDeltaPct: number | null = null
  if (active.length > 0 && prevActive.length > 0) {
    const prevAvg = divideNutrition(
      prevActive.reduce<Nutrition>((acc, d) => addNutrition(acc, d.nutrition), { ...ZERO_NUTRITION }),
      prevActive.length
    )
    if (prevAvg.sodium > 0) {
      sodiumDeltaPct = Math.round(((dailyAvg.sodium - prevAvg.sodium) / prevAvg.sodium) * 100)
    }
  }

  // 从今天往前数连续未超上限的天数
  let sodiumStreak = 0
  for (let i = dayList.length - 1; i >= 0; i--) {
    const d = dayList[i]
    if (d.mealCount === 0) break
    if (d.nutrition.sodium <= profile.quota.sodium) sodiumStreak++
    else break
  }

  return { days: dayList, dailyAvg, sodiumDeltaPct, sodiumStreak }
}

function addNutrition(a: Nutrition, b: Nutrition): Nutrition {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carb: a.carb + b.carb,
    fat: a.fat + b.fat,
    sodium: a.sodium + b.sodium,
    sugar: a.sugar + b.sugar,
  }
}

function divideNutrition(n: Nutrition, by: number): Nutrition {
  if (by === 0) return { ...ZERO_NUTRITION }
  return {
    kcal: n.kcal / by,
    protein: n.protein / by,
    carb: n.carb / by,
    fat: n.fat / by,
    sodium: n.sodium / by,
    sugar: n.sugar / by,
  }
}

/* ------------------------------------------------------------
   警示(日记页)
   ------------------------------------------------------------ */

export interface Warning {
  title: string
  body: string
  /**
   * 「这条警示是照档案里哪一条说的」。两条警示都是拿**档案里的配额**当判据的
   * (`> profile.quota.sugar` / `> profile.quota.sodium`),所以两条都有自己的依据
   * —— 和 `Advice.basis` 一样,是 `quotaNotes()` 那条原样拼出来的。
   *
   * ⚠️ 这里**不用** `basis?:`(可选):这两条分支**没有一条**能走到「依据来自指南
   * 而不是档案」的情形,写成可选就等于给下一个人留一个「这里可以不填」的错觉,
   * 而少填一次,卡上就会静默少一行。
   */
  basis: string
}

/**
 * 连续多日某项超标时给出一条警示。全部由数据推导 ——
 * 没有超标就没有警示卡,而不是永远显示同一句话。
 */
export function deriveWarnings(allMeals: MealEntry[], profile: Profile): Warning[] {
  const out: Warning[] = []
  const dates = lastNDays(7)
  const dayList = dates.map((d) => dayStats(allMeals, d, profile))

  // 只看**已完成**的日子:今天还没过完,不能断言"今天超标",
  // 更不能把它算进连续天数里 —— 否则晚上八点打开 App,警示会莫名消失。
  const settled = dayList.slice(0, -1)
  if (settled.filter((d) => d.mealCount > 0).length < 3) return out

  // 从最近一个已完成的日子往前数连续超标天数
  const streakOf = (pred: (d: DayStats) => boolean): number => {
    let n = 0
    for (let i = settled.length - 1; i >= 0; i--) {
      if (settled[i].mealCount === 0) break
      if (pred(settled[i])) n++
      else break
    }
    return n
  }

  const sugarStreak = streakOf((d) => d.nutrition.sugar > profile.quota.sugar)
  if (sugarStreak >= 2) {
    out.push({
      title: `连续 ${sugarStreak} 日添加糖摄入偏高`,
      body: '主要来源多为外卖甜口菜与含糖饮料。建议以凉拌、清蒸代替红烧，减少勾芡酱汁。',
      basis: quotaBasis(profile, 'sugar'),
    })
  }

  const sodiumStreak = streakOf((d) => d.nutrition.sodium > profile.quota.sodium)
  if (sodiumStreak >= 2) {
    out.push({
      title: `连续 ${sodiumStreak} 日钠摄入超上限`,
      body: '控盐是当前最主要的改善点。烹调时后放盐、少喝汤底，可显著降低摄入。',
      basis: quotaBasis(profile, 'sodium'),
    })
  }

  return out
}

/** 结果页的餐次标题,如「午餐 · 12:30」 */
export function entryTitle(entry: MealEntry): string {
  return `${entry.slot} · ${entry.time}`
}

/**
 * 一餐的菜名摘要,给列表行用。
 * 菜品多的时候截断 —— 一行的宽度放不下六七个菜名。
 */
export function entrySummary(entry: MealEntry): string {
  const names = entry.items.map((i) => i.name)
  if (names.length === 0) return '空记录'
  if (names.length <= 3) return names.join(' + ')
  return `${names.slice(0, 3).join(' + ')} 等 ${names.length} 项`
}

/**
 * 这一餐该用哪种图标底色。
 * 单餐钠超过全天配额的三分之一就标红 —— 一顿吃掉了一天盐分的三分之一,
 * 值得在列表里被一眼看到。
 *
 * 暖黄(`meal`)那两档一直没变:**早餐和三顿加餐**。早餐是唯一用暖色的正餐,
 * 这是设计稿定的,不是按「正餐/加餐」分的 —— 所以别顺手把它改成
 * `isMainSlot`,那会让早餐从暖黄变成绿色,而三顿加餐保持暖黄。
 */
export function entryTint(entry: MealEntry, profile: Profile): 'meal' | 'brand' | 'danger' {
  const share = nutritionOfEntry(entry).sodium / profile.quota.sodium
  if (share >= 1 / 3) return 'danger'
  return entry.slot === '早餐' || isSnackSlot(entry.slot) ? 'meal' : 'brand'
}

/**
 * 餐次对应的图标。
 *
 * 写成 `Record<MealSlot, string>` 而不是 `switch`:这张表**必须覆盖每一个餐次**,
 * 少一个就是编译错误。三顿加餐共用 `leaf`(稿子里没有给加餐单独画图标,
 * 而 `Icons.tsx` 里能表达「随手吃的一口」的只有它)。
 *
 * `?? 'leaf'` 那半句兜的是**老数据**:`MealSlot` 里已经删掉的「加餐」万一从
 * 某份没迁到的载荷里读出来,`SLOT_ICON['加餐']` 是 `undefined`,而
 * `<Icon name={undefined}>` 会在渲染时炸掉整屏 —— 一次查不出来的白屏。
 */
const SLOT_ICON: Record<MealSlot, string> = {
  早餐: 'breakfast',
  午餐: 'rice',
  晚餐: 'plate',
  上午加餐: 'leaf',
  下午加餐: 'leaf',
  夜宵: 'leaf',
}

/**
 * @param entry 只要有 `slot` 就够了 —— 收窄成 `{ slot }` 而不是 `MealEntry`,
 *   是因为日记页那条**还没落盘的占位行**(`PendingMealRow`)手上只有一份草稿,
 *   没有 `MealEntry`。图标本来就只由餐次决定,要求的字段比实际需要的多是
 *   在逼调用方去编一个假记录。
 */
export function entryIcon(entry: { slot: MealSlot }): string {
  return SLOT_ICON[entry.slot] ?? 'leaf'
}

/** 相对今天第几天的快捷判断,给日记的日期分组用 */
export function isToday(iso: string): boolean {
  return daysBetween(todayISO(), iso) === 0
}
