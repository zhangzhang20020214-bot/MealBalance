/**
 * 分量三档 —— 少量 / 常规 / 多量
 * ===========================================================
 * 为什么需要这一步:结果页原来每道菜写「**估算** 150g」,但那个 150 既不是从
 * 照片里推出来的,也不是模型给的 —— 它是 `data/foods.ts` 里 `rice.defaultGrams`
 * 这个**常量**。界面用「估算」这个词,把一个常量说成了推断结果。
 *
 * 而「从一张照片估出重量」这件事本身做不到。所以不去让模型猜得更准,而是把
 * 这个问题交还给唯一知道答案的人。
 *
 * 为什么是**三档**而不是让用户填克数
 * ------------------------------------------------------------
 * 没人知道自己那碗饭是 180g 还是 250g。逼着填,换来的只会是一个**看起来很
 * 精确的错数字** —— 正是这一步要消灭的那个东西。能答出来的是「大份还是小份」。
 * 三档 + 默认「常规」还顺带保证了快速路径只需多点一下。
 *
 * 纯逻辑,不碰 DOM —— 可在 Node 里直接测(scripts/verify-loop.mjs)。
 */

import { clampGrams, countableItems, isWebId } from './dishMatch'
import { FOOD_BY_ID } from '../data/foods'
// 只借它的类型 —— `verbatimModuleSyntax` 下这一行整个被擦掉，不产生运行期依赖。
// (先例:`lib/chatMeal.ts` 也是这么引 `RecognizedMeal` 的。)
import type { RecognizedMeal } from '../store/recognize'
import type { MealItem } from '../store/types'

export type PortionValue = 'small' | 'normal' | 'large'

/**
 * 三档的倍数。要调口味**只改这一处**。
 *
 * 0.6 / 1 / 1.5 是按「一顿饭里同一道菜的分量差异」挑的:米饭 90 / 150 / 225g,
 * 正好覆盖小碗到大碗。乘完取整到 5g,所以误差不超过 2.5g —— 这一步本来就是
 * 粗调,数字比「150g」更细反而更假。
 */
export const PORTIONS: { value: PortionValue; label: string; factor: number }[] = [
  { value: 'small', label: '少量', factor: 0.6 },
  { value: 'normal', label: '常规', factor: 1 },
  { value: 'large', label: '多量', factor: 1.5 },
]

/** 默认档 —— 用户的选择是「必经,但默认全部常规」,所以进来就能直接确认 */
export const DEFAULT_PORTION: PortionValue = 'normal'

export function portionMeta(value: PortionValue): { value: PortionValue; label: string; factor: number } {
  // PORTIONS 是常量表,value 是联合类型,查不到不可能发生
  return PORTIONS.find((p) => p.value === value) ?? PORTIONS[1]
}

/**
 * 三档的**基准克数** —— 为什么分两条路
 * ------------------------------------------------------------
 * `engine === 'agent'`(真模型走通):用**这道菜当前的克数**。
 *   普通情况下它就等于库里的常见分量 —— `matchDishes` 里的 `clampGrams`
 *   取不到模型给的克数时退回 `food.defaultGrams`,所以「常规 = 库里的常见
 *   分量」照旧成立。但它同时保住了两种**有信息量**的克数:
 *
 *     ① **合并过的菜。** `matchDishes` 把落到同一个 foodId 的两道菜**相加**
 *        (「白灼西兰花」+「清炒西兰花」→ 西兰花 300g)。要是拿 defaultGrams
 *        当基准,用户点一下「常规」就会把它静默砍回 150g —— 一个没有提示的
 *        数据改写,用户看不出发生了什么。
 *     ② **将来模型真的开始给克数。** `dishMatch.ts` 的文件头和 README 都
 *        承诺过「提示词加一个 grams 字段,App 不用改」。拿 defaultGrams 当
 *        基准等于单方面毁掉这条承诺 —— 模型给的值会在点「常规」时被丢掉。
 *
 * `engine === 'demo'`(降级/演示数据):用**库里的 `defaultGrams`**。
 *   演示路径的克数是 `recognize.ts` 的 `portion()` 在默认值上 ±15% 抖动出来的
 *   **噪声**。拿噪声当基准,「常规」就变成一个每次都不同的随机数 ——
 *   照同一盘菜两次,「常规」给出两个克数,用户只会认为这个 App 在乱来。
 *
 * 于是有一条可以断言的不变量:**真实路径上、且没有发生合并时,点「常规」
 * 不改变任何数字**。verify-loop.mjs 有这条断言。
 *
 * 它成立得比看上去稳:`matchDishes` 里那个 `clampGrams` 已经把模型给的克数
 * **取整到 5g** 了,所以 `item.grams` 永远落在 5 的倍数上,而
 * `portionGrams(grams, 'normal')` 里的取整是个恒等变换 —— 就算哪天模型真的
 * 开始返回 `137` 这种数,它在入库那一步就已经变成 `135` 了。
 *
 * 库里没有的食物 —— 分两种,都有各自的理由:
 *
 *   · **`web:` 项(联网查到营养的库外菜)** → `item.grams`。它的克数就是
 *     `dishMatch.WEB_BASE_GRAMS`(150g),是个和 `defaultGrams` 同性质的常量,
 *     不是噪声 —— 所以下面 demo 分支那条理由对它不成立,得单独走这条。
 *     走 agent 分支时结果一样(那里本来就返回 `item.grams`),但**理由不同**:
 *     两个理由不同的情形共用一个分支,下一个人改动时必错。
 *   · **`unmatched:` 哨兵项** → `item.grams`(0)。调用方**不该**对它们调这个
 *     函数 —— 界面上没给它们控件,见 `portionItems()` 第 2 条。
 *
 * (哨兵项落到最后那行 `?? item.grams` 是**碰巧**对;web 项本来也碰巧对。
 *  把 web 显式写出来,是为了让「碰巧对」只剩哨兵一处,而那一处有断言盯着。)
 */
export function baseGramsFor(item: MealItem, engine: 'agent' | 'demo'): number {
  if (engine === 'agent') return item.grams
  if (isWebId(item.foodId)) return item.grams
  return FOOD_BY_ID.get(item.foodId)?.defaultGrams ?? item.grams
}

/**
 * 基准 × 倍数 → 克数。取整到 5g 并夹到 [5, 1000],复用 `clampGrams`,
 * 第二个参数正好当兜底值用(算出来离谱就退回首档基准)。
 */
export function portionGrams(base: number, value: PortionValue): number {
  return clampGrams(base * portionMeta(value).factor, base)
}

/**
 * 把用户选的三档写回菜清单 —— **这是这一步唯一的写入口**。
 *
 * 三条不能动的规则:
 *
 * 1. **只改 `grams`,其余字段原样保留。** 尤其是 `name`:它是**模型说的那个
 *    名字**(`dishMatch.ts` 特意用模型的说法而不是库里的),在这一步被覆盖成
 *    库里的名字就是又一次静默改写。
 *
 *    对 `web:` 项还多一条:`per100g` 和 `source` 也在这「其余字段」里。
 *    `{...item, grams}` 天然保住了它们,但这条**必须写下来** —— 哪天有人为了
 *    「少存点东西」在这里挑字段重建对象(这个仓库已经这么干过两次),
 *    用户的每一步分量操作都会把联网查到的营养和它的出处一起丢掉,
 *    而那一步之后这道菜会显示 0 kcal 且**没有任何地方会报错**。
 *    verify-loop.mjs 有一条断言盯着这两个键。
 *
 * 2. **哨兵项原样返回。** 未收录的菜(`unmatched:` 前缀)不在 `FOOD_BY_ID` 里,
 *    界面上也没有给它们三档控件,所以 `draft` 里查不到 —— 这里靠
 *    `draft[foodId] === undefined` 一个分支兜住。**不要**改成
 *    `FOOD_BY_ID.get(id)!`:那个 `!` 会在第一道未收录的菜上抛 TypeError,
 *    也就是整屏白给 —— 而「有未收录的菜」恰恰是正常情况,不是边界情况。
 *
 * 3. **不改 `items` 的顺序和条数。** 上一步的归并结果就是结果页要显示的东西,
 *    这一步只回答「多少」。
 *
 * @param items  待确认的菜(`pending.items`)
 * @param draft  foodId → 用户选的档;没有条目 = 不参与(未收录的菜)
 * @param engine 区分真实/演示,决定基准克数(见 `baseGramsFor`)
 */
export function portionItems(
  items: MealItem[],
  draft: Record<string, PortionValue>,
  engine: 'agent' | 'demo',
): MealItem[] {
  return items.map((item) => {
    const value = draft[item.foodId]
    if (value === undefined) return item
    return { ...item, grams: portionGrams(baseGramsFor(item, engine), value) }
  })
}

/* ------------------------------------------------------------
   跳过三档那一屏时的快捷路径
   ------------------------------------------------------------ */

/**
 * 「一键记入日记」写进去的菜。
 *
 * ## 它和「走一遍 `/portion`，什么都不点直接确认」**逐字段相同**
 *
 * 那是这个函数存在的全部理由。对话页那条路**不进 `/portion`**（那一屏存在的
 * 意义是「让用户说一个他答得出来的答案」，而用户在那里根本没在答那个问题），
 * 但它必须给出**同一个数** —— 否则同一个人身上会有两套克数，而界面上没有任何
 * 地方能看出这件事。
 *
 * 「什么都不点」= 每道可称的菜都取 `DEFAULT_PORTION`，正是 `PortionScreen.confirm()`
 * 里那个 `full` map（那边逐条 `choiceFor()`，而 `choiceFor` 的兜底就是它）。
 * 所以这里构造的是同一份 map，调的是同一个 `portionItems` ——
 * 不是「照着它再写一遍」。
 *
 * ## 为什么 draft 只覆盖 `countableItems`
 *
 * 因为**那一屏的 `full` map 就是那么建的**（`PortionScreen.confirm()` 里
 * `for (const item of countable)`）—— 照它建，「两边相同」就是构造出来的，
 * 不是碰巧对上的。
 *
 * ⚠️ 说清楚今天的事实：哨兵项（`unmatched:`）**填不填都一样**。
 * `baseGramsFor` 对库里查不到的 id 退回 `item.grams`（哨兵项是 0），
 * 而 `portionGrams(0, 'normal')` 是 `clampGrams(0, 0)` —— 0 小于下界 5，
 * 于是走兜底值，而兜底值传的正是 `base`，结果还是 0。
 * 所以**没有哪条断言能靠「去掉 `countableItems`」变红**，别为它写一条
 * （写出来的是一条永远绿的假断言）。留着这个口径是为了跟那一屏一致，
 * 而不是因为它今天改变了什么。
 *
 * ## 两条可以直接断言的性质
 *
 *   · `engine === 'agent'` 时它**逐字段等于 `items`**：`baseGramsFor` 返回
 *     `item.grams`，而库里的菜克数已经落在 5 的倍数上（`dishMatch.clampGrams`），
 *     乘 1 再取整是恒等变换。（`clampGrams` 对落在 [5,1000] 之内、非 5 倍数的
 *     输入会取整到最近的 5 —— 所以这条恒等**靠的是 5 倍数这个前提**，
 *     不是无条件成立的。库外菜的 `WEB_BASE_GRAMS` 和食物库的 `defaultGrams`
 *     同样是 5 的倍数。）
 *   · `engine === 'demo'` 时它把 ±15% 的抖动噪声换回库里的常见分量 ——
 *     和用户点「常规」得到的是同一个数。
 */
export function normalPortionItems(meal: RecognizedMeal): MealItem[] {
  const full: Record<string, PortionValue> = {}
  for (const item of countableItems(meal.items)) full[item.foodId] = DEFAULT_PORTION
  return portionItems(meal.items, full, meal.engine)
}
