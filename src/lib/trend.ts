/**
 * 趋势图背后的算术
 * ===========================================================
 * 日记页周/月视图里那四张图(钠、热量、健康分、餐次占比)的**数**全在这儿,
 * `components/TrendCharts.tsx` 只负责把它们画出来。
 *
 * 分开的理由和 `portion.ts`、`quota.ts` 一样:算术能在 Node 里直接断言
 * (`scripts/verify-loop.mjs`),而写在 `<div style={{height: '63%'}}>` 里的
 * 百分比只能在渲染产物上搜字符串。这里**没有任何取色、字号、间距的决定**。
 *
 * 四张图共用一条口径:**没有记录的日子不是 0**。
 * ------------------------------------------------------------
 * 这是这个小模块唯一真正的难点。少记一天和那天只吃了 200mg 钠,在屏幕上
 * 长得一模一样(都是一根矮柱子),而它们的含义完全相反 —— 前者是「不知道」,
 * 后者是「很好」。三处都按这条口径处理:
 *
 *   · 柱子:没有记录的那一格**不画柱子**,留一格空位(位置对得上日期)
 *   · 健康分折线:`segmentsOf` 把序列按空档切成几段,各画各的 ——
 *     连成一条线会画出一根**穿过空白日子的斜线**,那是在编一个不存在的分数
 *   · 餐次占比:只统计有记录的那些天(和 `weekTrend` 的日均同一口径)
 *
 * 反过来,「有记录但某一项是 0」是一根**真的 0 柱子**,不是空档。判据是
 * `mealCount`,不是 `nutrition.x === 0`。
 *
 * ------------------------------------------------------------
 * 「哪几天算数」这件事,只有一个地方说
 * ------------------------------------------------------------
 * `daySeries` 把 `days` 翻成一条 `DayPoint[]`,空白天在那儿变成 `null`。
 * 这个模块里**其余每一个函数都吃这条序列**,不自己再看一次 `mealCount`:
 *
 *     daySeries(days, pick)  ──►  DayPoint[]  ──┬─► barScale(points, limit)
 *                                              ├─► recordedCount(points)
 *                                              ├─► overCount(points, limit)
 *                                              ├─► scoreSummary(points)
 *                                              └─► segmentsOf(points)
 *
 * 这么绕不是为了好看。写成「每个函数各收一份 `days`、各自 `filter(mealCount>0)`」
 * 也跑得对,但那条口径就有五份拷贝,而**改错其中一份不会有东西变红**:比如
 * `overCount` 少滤一次,一个没记录的日子算出来是 0,`0 > limit` 是假 ——
 * 于是行为完全一样,谁也不会发现它已经和 `daySeries` 不是同一件事了。
 * 吃 `DayPoint` 之后这件事由**类型**兜住:`value` 是 `number | null`,
 * 想不看 null 直接比大小,TS 当场就拦下来。
 */

import { isSnackSlot, MAIN_SLOTS } from './slots'
import { nutritionOfEntry } from '../store/derive'
import type { DayStats } from '../store/derive'

/** 一天在逐日序列里的一个点 */
export interface DayPoint {
  date: string
  /** null = 这一天没有记录 —— 和「记了但是 0」是两件事 */
  value: number | null
}

/** 一个数值在这把标尺上有多高(0–100,一位小数) */
export function pctOf(value: number, max: number): number {
  if (!(max > 0)) return 0
  return Math.round(Math.min(1, Math.max(0, value / max)) * 1000) / 10
}

/**
 * 逐日序列:有记录的天给数,没记录的天给 `null`。
 *
 * 这是全模块**唯一**一处判断「这一天算不算数」的地方(判据 `mealCount > 0`,
 * 文件头那段解释了为什么其余函数都吃它吐出来的东西)。
 */
export function daySeries(days: DayStats[], pick: (d: DayStats) => number): DayPoint[] {
  return days.map((d) => ({ date: d.date, value: d.mealCount > 0 ? pick(d) : null }))
}

/**
 * 标尺上界 —— **上限线必须落在图里**,所以上界至少要容下它。
 *
 * 只按数据最大值定标尺是最容易写出来的版本,而它的表现是:一个从来不超过
 * 上限的人(那正是这个 App 想看到的人),上限线**跑到图外面去了** ——
 * 屏上只剩几根矮柱子和一句「上限 2.0g」,而那条线在哪儿看不见。
 *
 * 留 10% 的顶部余量,让「正好等于上限」的那根柱子不会顶到框线上:
 * 顶格和超格在屏幕上必须分得出来,否则「今天刚好卡在上限」和「今天超了」
 * 长得一样。
 *
 * 空数据(一天都没记)时退化成「上限 × 1.1」,所以返回值恒 > 0 ——
 * 调用方不必再判一次 0(那正是除出 Infinity 的地方)。
 *
 * ⚠️ 只回一个数(上界),**不回上限线的高度**:那是一句 `pctOf(limit, max)`
 * 的事,多一个字段就等于同一个高度有两处算法。虚线画在哪儿由画的人现算。
 */
export function barScale(points: DayPoint[], limit: number): number {
  let peak = 0
  for (const p of points) {
    if (p.value !== null && p.value > peak) peak = p.value
  }
  const top = Math.max(peak, limit)
  return top > 0 ? top * 1.1 : 1
}

/**
 * 把序列按**空档**切成若干连续段,每段带上各自在原序列里的下标。
 *
 * 健康分那条折线用的就是它。连成一条线(即把 null 当成跳过)会画出一根
 * 从「前天 82 分」直接拉到「今天 60 分」的斜线,而中间那天根本没记录 ——
 * 那根斜线的斜率是一个**编出来的下降速度**。
 *
 * 下标要带出来,不只是为了画线:x 坐标是按**原序列的位置**算的(第 4 天就得
 * 落在 4/7 处),不是按段内位置。丢掉下标的话,一段三天的线会被拉满整个宽度,
 * 画出来的日期和底下的日期标签对不上 —— 而屏幕上不会有任何不正常的痕迹。
 */
export function segmentsOf(points: DayPoint[]): { index: number; value: number }[][] {
  const out: { index: number; value: number }[][] = []
  let run: { index: number; value: number }[] | null = null
  for (let i = 0; i < points.length; i++) {
    const v = points[i].value
    if (v === null) {
      run = null
      continue
    }
    if (!run) {
      run = []
      out.push(run)
    }
    run.push({ index: i, value: v })
  }
  return out
}

/** 有记录的天数 —— 图下面那句「N 天里有 M 天有记录」 */
export function recordedCount(points: DayPoint[]): number {
  let n = 0
  for (const p of points) if (p.value !== null) n++
  return n
}

/**
 * 序列里**超过上限**的天数。
 *
 * 边界是**严格大于**:一根正好卡在上限上的柱子是绿色的。这条和
 * `TrendCharts.tsx` 里给柱子上色的那句 `p.value > limit` 必须是同一个判据 ——
 * 两边差一点点(比如一边 `>` 一边 `>=`),屏幕上就会出现「这根柱子是绿的,
 * 而下面那句说它超了」,两个数各自看都自洽。
 *
 * (没有记录的天在这一版里连比较都进不去 —— `null` 不是数,是「不知道」。
 * 这一条由类型兜着:`p.value !== null &&` 不是防御性写法,是不写就编不过。)
 */
export function overCount(points: DayPoint[], limit: number): number {
  let n = 0
  for (const p of points) if (p.value !== null && p.value > limit) n++
  return n
}

/** 健康分那张卡的概况 —— 卡片右上角那个数、和说明句里那三个数 */
export interface ScoreSummary {
  /** 有记录的天数(和 `recordedCount` 同源) */
  count: number
  avg: number
  min: number
  max: number
}

/**
 * 有记录那些天的分数概况;**一天都没记时为 null**(不是四个 0)。
 *
 * 为什么是一个函数而不是让卡片自己 `Math.max(...)`:`TrendCharts.tsx` 的
 * 文件头写着「这个文件没有一处算术」—— 那句话要么是真的,要么就不该写。
 *
 * `null` 而不是零值,是因为这四个数会直接进句子:「有记录的 0 天平均 0 分,
 * 最高 0、最低 0」是一句读起来像结论的错话,而那句话本来该说「还没有记录」。
 *
 * ⚠️ 它吃的是**分数序列**(`daySeries(days, d => d.score.score)`),所以
 * 「空白天不进平均」这件事不是这里滤的 —— 空白天在序列里已经是 `null` 了。
 * 这很要紧:一个没记录的日子算出来的分数是**很低的**(钠 0、热量 0 ——
 * 热量那一项按「摄入偏低」扣分),把它算进平均会让「这周只记了两天」的
 * 平均分莫名其妙地掉下去。
 */
export function scoreSummary(points: DayPoint[]): ScoreSummary | null {
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]))
  if (values.length === 0) return null
  return {
    count: values.length,
    avg: values.reduce((s, v) => s + v, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

/** 餐次占比里的一行 */
export interface SlotShareRow {
  /** 早餐 / 午餐 / 晚餐 / 加餐 */
  label: string
  kcal: number
  /** 这一段占全天热量的比例(0–1);一天都没记时全是 0 */
  share: number
}

/**
 * 餐次占比 —— **四段**而不是六段。
 *
 * `MEAL_SLOTS` 是六档(三餐 + 上午加餐 / 下午加餐 / 夜宵),而那条堆叠条上
 * 放六个名字放不下,更别说三段加餐各自常常只有几十分之一。所以按
 * 「正餐 / 加餐」合成四段 —— 分组依据是 `lib/slots.ts` 的 `isSnackSlot`,
 * 不在这里再写一遍那三个字面量。
 *
 * ⚠️ 「加餐」这个词是本 App 界面上**新出现的一个说法**(它是那三档加餐的合计),
 * 所以卡片上必须写明它是什么 —— 用户刚记的那一餐叫「下午加餐」,而图上写
 * 「加餐」,不加解释的话读起来像换了一个字段。
 *
 * 这个函数吃的是 `days` 而**不是** `DayPoint[]`,和上面那四个不一样:它数的是
 * 「有记录的餐次」,不看某一天有没有整天的记录 —— 一条记录进了这个数组,
 * 它就有热量要算。空白天在这里自然贡献 0(它根本没有 entries),不需要一个
 * null 的中间态。
 *
 * 分母是**这四段之和**,也就是有记录那些天的总热量:和 `weekTrend.dailyAvg`
 * 同一口径(只统计有记录的天)。空白日子不进分母 —— 否则「这周只记了一天」
 * 会让那一天的四段各占 25%。
 */
export function slotShare(days: DayStats[]): SlotShareRow[] {
  /** 四段的桶 —— 键就是最终印在图例上的那四个字,顺序也由它定 */
  const rows: SlotShareRow[] = [
    ...MAIN_SLOTS.map((label) => ({ label, kcal: 0, share: 0 })),
    { label: '加餐', kcal: 0, share: 0 },
  ]
  const bucketOf = (slot: string): SlotShareRow | undefined =>
    rows.find((r) => r.label === slot) ?? (isSnackSlot(slot) ? rows[rows.length - 1] : undefined)

  for (const d of days) {
    for (const e of d.entries) {
      const row = bucketOf(e.slot)
      /*
        认不出的餐次落不进任何一段 —— 而它**必须看得见**,所以这里什么都不做
        而不是硬塞进「加餐」:塞进去的话,上面那条堆叠条会多出一截来路不明的
        热量,而图例里没有任何一处能解释它。今天走不到这一支
        (`MealSlot` 是封闭联合,六档全在四段里),但 `slot` 在类型上是 string。
      */
      if (!row) continue
      row.kcal += nutritionOfEntry(e).kcal
    }
  }

  /*
    分母是**四段之和**,不另算一遍全天热量。两者今天恒等(每一餐的 slot
    必定落在四段之一),但各算一遍就等于同一件事有两份判据 —— 哪天真有一餐
    落不进四段,分母会把它算进去、而堆叠条上没有它那一截,于是四段加起来
    不到 100%,而两个数各自看都自洽。
  */
  const total = rows.reduce((s, r) => s + r.kcal, 0)
  for (const r of rows) r.share = total > 0 ? r.kcal / total : 0
  return rows
}
