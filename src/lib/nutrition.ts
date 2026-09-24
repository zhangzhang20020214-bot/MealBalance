/**
 * 一项菜的营养 —— 取值只有这一个入口
 * ===========================================================
 * `MealItem` 的每 100g 值有**两个来源**:
 *
 *   1. **食物库** —— `FOOD_BY_ID.get(item.foodId).per100g`。库里那 58 条
 *      是「熟食、可食部、油盐已折算」的口径,彼此可比。
 *   2. **条目自带** —— `item.per100g`。库里没有对应项时,Dify 工作流会去联网
 *      查一个每 100g 值回来,连同出处(`item.source`)一起挂在条目上。
 *
 * 以前只有来源 1,于是「取一项的营养」在六个地方各写了一遍
 * (`derive` 的求和、`advice` 两处、结果页、分量页、记录面板两处),
 * 而兜底写法还不一样:静默跳过、`?:` 计 0、`?? 0`。
 *
 * 有了来源 2 之后,这六处里**任何一处漏改都是静默算少**:值明明挂在条目上,
 * 界面显示 0,而且看不出来 —— 正是这个仓库最想避免的那种失效。所以收敛到
 * 这里:只有**一个**判据(`per100gOf`)、**一处**兜底(查不到才是 0)。
 *
 * 为什么是叶子模块(不放 `derive.ts` 或 `dishMatch.ts`)
 * ------------------------------------------------------------
 * · `derive.ts` 是派生层,而三个界面和 `portion.ts` 都要用这个函数 ——
 *   让底层 lib 反向依赖 store 的派生层,层次就反了(`derive.ts` 自己也要
 *   import 本模块,那是同一个方向上的第二笔债)。
 * · `dishMatch.ts` 的职责是「菜名 → foodId」那座桥;算营养是第二件事,
 *   而它已经背着匹配阶梯和别名表了。
 *
 * 本模块只 import `data/foods` 与 `store/types`,谁都可以安全引用。
 */

import { FOOD_BY_ID, type FoodNutrition } from '../data/foods'
import type { MealItem, Nutrition } from '../store/types'

/** 全部归零的营养值。作为求和的初值 */
export const ZERO_NUTRITION: Nutrition = {
  kcal: 0,
  protein: 0,
  carb: 0,
  fat: 0,
  sodium: 0,
  sugar: 0,
}

/**
 * 这一项每 100g 的值,取不到返回 `null`。
 *
 * **顺序是刻意的:食物库优先。** 与 `dishMatch` 里那条「目录优先」是同一条规矩
 * (`matchDishes` 一旦在库里命中,就把条目自带的 `per100g` 丢掉;Dify 侧的
 * 「合并营养」节点也是 `if d.get("foodId"): continue`)。
 *
 * 两条规则说的是同一件事,所以取值顺序也必须一致 —— 否则「同一个字段该信哪个」
 * 会在两个地方各有一套答案,而这种分歧**平时看不出来**,只在某个边界上
 * 给出两个不同的数字。
 *
 * 顺带一提:按构造,库内命中项永远不会带 `per100g`(上面那条规矩),
 * 所以这个顺序在当前代码里是个恒等选择。写下来是为了让它**继续**是。
 */
export function per100gOf(item: MealItem): FoodNutrition | null {
  const food = FOOD_BY_ID.get(item.foodId)
  if (food) return food.per100g
  return item.per100g ?? null
}

/**
 * 一项菜按实际克数折算出来的营养。**查不到来源时返回全 0,不抛错** ——
 * 少算一项,总好过整页崩掉。
 *
 * ⚠ 「不抛错」不等于「不用出声」。会走到全 0 这支的只有**一种**条目:
 * `unmatched:` 哨兵(库里没有、联网也没查到)—— 那是「已知的不知道」,
 * 结果页和分量页都会显式写「不在食物库里,按 0 计」。
 * 其余两种都是**不该**归零的:库内 id 归零说明食物库被改过(见
 * `derive.findBrokenRefs`),`web:` 项归零说明它的 `per100g` 在哪一层被吃掉了
 * (见 `derive.findLostWebNutrition`)—— 那两个探测器就是替这里出声的人。
 *
 * `grams` 参数可覆盖条目自己的克数,**只有一个调用点需要**:确认分量页。
 * 那一屏显示的是「用户当前选中那一档会写进去的克数」—— 还没提交,所以不在
 * 条目上,而屏幕上那个 kcal 必须和最终归档的数字一致(见 `portion.ts` 里
 * 「显示和提交用的是同一个函数」那段)。不覆盖的话那一屏就只剩两条路:
 * 自己再写一遍 ×grams/100(第二份算术,迟早和这里对不上),或者现造一个
 * `{...item, grams}` 的临时对象(能跑,但读的人会以为条目真的被改了)。
 */
export function nutritionOfItem(item: MealItem, grams: number = item.grams): Nutrition {
  const p = per100gOf(item)
  if (!p) return { ...ZERO_NUTRITION }

  const k = grams / 100
  return {
    kcal: p.kcal * k,
    protein: p.protein * k,
    carb: p.carb * k,
    fat: p.fat * k,
    sodium: p.sodium * k,
    sugar: p.sugar * k,
  }
}
