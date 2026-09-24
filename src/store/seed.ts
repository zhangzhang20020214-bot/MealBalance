/**
 * 演示种子数据 —— 首次打开时灌入最近 14 天的记录
 *
 * 为什么要播种:一个空白的日记页什么也证明不了。面试官点开链接时,
 * 首页应该有健康分、日记应该有趋势、警示卡应该有内容 —— 这些都依赖历史数据。
 *
 * 为什么是 14 天而不是 7 天:日记页的「本周日均钠 ↓X%」需要一个**对比窗口**,
 * 只有 7 天数据的话上一周是空的,环比永远是 null,趋势文案出不来。
 *
 * 这 14 天是刻意编排的,讲了一个连贯的故事:
 *   - 上周(-13 ~ -7)以重口外卖为主,钠普遍 3000mg 以上
 *   - 本周(-6 ~ -1)明显改善,穿插了清淡日,钠降到 2000-3000mg
 *   - 但最近三天连续吃了甜食,添加糖超标 → 触发警示卡
 *   - 今天只记了早餐和午餐 → 首页显示"晚餐待记录"
 *
 * 这样打开就有:健康分、下降的钠趋势、两张警示卡、待记录的晚餐 —— 一个"活"的 App。
 */

import { FOOD_BY_ID } from '../data/foods'
import { fromISODate, lastNDays } from '../lib/date'
import type { MealEntry, MealItem, MealSlot, MealSource } from './types'

/** [食物 id, 克数] */
type SeedItem = [string, number]

interface SeedMeal {
  slot: MealSlot
  time: string
  source: MealSource
  items: SeedItem[]
}

/* ------------------------------------------------------------
   四种日型
   ------------------------------------------------------------ */

/** 清淡日 —— 以蒸煮为主,钠能压到 2000mg 以内 */
const LIGHT: SeedMeal[] = [
  { slot: '早餐', time: '08:00', source: '手动记录', items: [['oatmeal', 300], ['boiled-egg', 50], ['milk', 250]] },
  { slot: '下午加餐', time: '15:30', source: '手动记录', items: [['apple', 200]] },
  { slot: '午餐', time: '12:20', source: '拍餐盘', items: [['steamed-fish', 150], ['broccoli', 200], ['rice', 250]] },
  { slot: '晚餐', time: '18:40', source: '拍餐盘', items: [['boiled-shrimp', 80], ['spinach-garlic', 100], ['sweet-potato', 250], ['rice', 100]] },
]

/** 普通日 —— 家常炒菜,钠约 2800mg,略超上限 */
const NORMAL: SeedMeal[] = [
  { slot: '早餐', time: '08:10', source: '手动记录', items: [['congee', 300], ['boiled-egg', 50], ['mantou', 100]] },
  { slot: '午餐', time: '12:30', source: '拍餐盘', items: [['braised-ribs', 150], ['lettuce-stir', 200], ['rice', 250]] },
  { slot: '晚餐', time: '18:50', source: '拍餐盘', items: [['tomato-egg', 150], ['stir-veggies', 200], ['rice', 200]] },
]

/** 甜食日 —— 普通日 + 下午一块蛋糕,添加糖因此超标(最近三天用) */
const SUGARY: SeedMeal[] = [
  ...NORMAL,
  { slot: '下午加餐', time: '15:30', source: '手动记录', items: [['cake', 100]] },
]

/** 重口日 —— 外卖为主,钠 4000mg 以上,还带一杯奶茶 */
const HEAVY: SeedMeal[] = [
  { slot: '早餐', time: '08:30', source: '手动记录', items: [['xiaolongbao', 150], ['soy-milk', 300]] },
  { slot: '下午加餐', time: '15:30', source: '手动记录', items: [['bubble-tea', 500]] },
  { slot: '午餐', time: '12:40', source: '拍餐盘', items: [['twice-cooked-pork', 150], ['mapo-tofu', 150], ['rice', 250]] },
  { slot: '晚餐', time: '19:00', source: '拍餐盘', items: [['boiled-fish-spicy', 250], ['rice', 200]] },
]

/**
 * 14 天的日型排布,数组下标 0 = 14 天前,最后一项 = 昨天。
 * 上周(前 7 项)重口日居多,本周(后 6 项)明显清淡 —— 这条弧线是趋势文案的来源。
 */
const SCHEDULE: ('light' | 'normal' | 'sugary' | 'heavy')[] = [
  // -13 ~ -7:上周,重口为主
  'heavy', 'heavy', 'heavy', 'normal', 'heavy', 'normal', 'heavy',
  // -6 ~ -1:本周,明显改善,但最后三天甜食偏多
  'normal', 'light', 'normal', 'sugary', 'sugary', 'sugary',
]

const PLAN_BY_NAME = { light: LIGHT, normal: NORMAL, sugary: SUGARY, heavy: HEAVY } as const

/** 今天 —— 只记了早餐和午餐,首页会显示"晚餐待记录" */
const TODAY_MEALS: SeedMeal[] = [
  { slot: '早餐', time: '08:15', source: '手动记录', items: [['oatmeal', 300], ['boiled-egg', 50], ['milk', 250]] },
  { slot: '午餐', time: '12:30', source: '拍餐盘', items: [['steamed-fish', 150], ['broccoli', 200], ['rice', 250]] },
]

/* ------------------------------------------------------------
   生成
   ------------------------------------------------------------ */

/** 把一条种子餐次摊平成 MealEntry */
function toEntry(meal: SeedMeal, date: string, id: string): MealEntry {
  const [h, min] = meal.time.split(':').map(Number)
  const at = fromISODate(date)
  at.setHours(h, min, 0, 0)

  const items: MealItem[] = meal.items.map(([foodId, grams]) => ({
    foodId,
    // 冗余存名字:食物库换版本后,旧记录仍然显示得出菜名
    name: FOOD_BY_ID.get(foodId)?.name ?? foodId,
    grams,
  }))

  return { id, date, slot: meal.slot, time: meal.time, source: meal.source, items, createdAt: at.getTime() }
}

/**
 * 生成种子数据。
 *
 * id 与 createdAt 都是确定性的(由日期 + 下标推出),不依赖 Date.now() ——
 * 同一个种子在任何时候生成都得到相同结果,便于比对和排查问题。
 */
export function buildSeedMeals(): MealEntry[] {
  const dates = lastNDays(SCHEDULE.length + 1) // +1 是今天
  const out: MealEntry[] = []

  SCHEDULE.forEach((planName, i) => {
    const date = dates[i]
    for (const [j, meal] of PLAN_BY_NAME[planName].entries()) {
      out.push(toEntry(meal, date, `seed-${date}-${j}`))
    }
  })

  const today = dates[dates.length - 1]
  for (const [j, meal] of TODAY_MEALS.entries()) {
    out.push(toEntry(meal, today, `seed-${today}-${j}`))
  }

  return out.sort((a, b) => a.createdAt - b.createdAt)
}
