/**
 * 年龄 —— 档案里存的是**出生日期**,年龄是算出来的。
 *
 * 为什么要改成这样
 * ------------------------------------------------------------
 * 原来 `Profile.age` 是一个存下来的数字:填进去那天是 28,三年后还是 28。
 * 而它是 BMR 公式里的一项(见 quota.ts),也就是说配额会跟着一起停在原地。
 * 出生日期是那个**不会过期**的输入,年龄只是它在今天的读数。
 */

export interface Birth {
  year: number
  /** 1–12 */
  month: number
  /** 1–31,还得看当月有几天 */
  day: number
}

/**
 * 当月有几天。
 *
 * 用 `new Date(y, m, 0)` 而不是一张 `[31,28,31,…]` 的表:那个 `0` 是「上个月
 * 的第 0 天」,也就是**这个月的最后一天**,闰年由 Date 自己算 —— 自己写
 * `y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)` 是在重算一件已经有人
 * 算对的事,而它错的时候只在 2100 年那种地方错。
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * 把「日」夹进当月 —— 2 月没有 30 日,小月没有 31 日。
 *
 * 换年、换月之后**必须**过一遍:`birth = {1998, 1, 31}` 把月份滚到 2 月,
 * 不夹的话它就是一个不存在的日期,而 `ageOn` 照样会算出一个数来 ——
 * 静默地多算几天。换年也要过:2 月 29 日在平年不存在。
 */
export function clampDay(birth: Birth): Birth {
  const max = daysInMonth(birth.year, birth.month)
  return birth.day > max ? { ...birth, day: max } : birth
}

/**
 * 周岁。
 *
 * 用 `今年 − 出生年` 会在**每个生日之前的那些天**把人算大一岁,而这个数直接
 * 进 BMR 公式 —— 它不是一个只用来显示的字段,差一岁就是实打实的几 kcal。
 */
export function ageOn(birth: Birth, now: Date): number {
  const m = now.getMonth() + 1
  const d = now.getDate()
  const beforeBirthday = m < birth.month || (m === birth.month && d < birth.day)
  return now.getFullYear() - birth.year - (beforeBirthday ? 1 : 0)
}

/** 「1998年3月20日」—— 界面上唯一的写法 */
export function formatBirth(b: Birth): string {
  return `${b.year}年${b.month}月${b.day}日`
}

/**
 * 档案允许的年龄区间。
 *
 * 上界不是医学判断,是**防手滑**(和 BODY_LIMITS 里那两条同源):一个年龄
 * 填成 300 的人,kcal 会被 quotaFor 夹到上限 4000,而界面不会告诉他为什么。
 * 年龄改成算出来之后,这个区间管的是**出生年的可滚范围**。
 */
export const AGE_RANGE = { min: 14, max: 100 } as const

/**
 * 出生年的可滚区间 —— 由年龄区间反推。
 *
 * ⚠️ 上界(最年轻那一档)在**生日没到**的时候会算出 13 岁:今年是 2026,
 *    最晚一档是 2012,而 2012 年 12 月 31 日生的人在 9 月只有 13 岁。没有去
 *    卡死它:要让年份范围随「今天」变,就得让这张表每分钟都可能不一样,
 *    而滚轮的边界本来就不是校验 —— 没有人会去点最年轻的那一档。
 *    真要拦住,该拦的是「算出来的年龄」,不是「滚得出哪一年」。
 */
export function birthYearRange(now: Date = new Date()): { min: number; max: number } {
  return { min: now.getFullYear() - AGE_RANGE.max, max: now.getFullYear() - AGE_RANGE.min }
}

/**
 * 一份「今天正好 age 岁」的出生日期 —— 内置档案用它把年龄**钉住**。
 *
 * 取 1 月 1 日,好让一年里的任何一天算出来都正好是 age 岁(取今天的月日的话,
 * 生日没到的时候会算出 age−1)。
 *
 * 演示档案的年龄是个**固定装置**,和那 14 天记录一样是相对今天编的:它的
 * 28 岁在 README、界面文案和 verify-loop 的配额锚点(`DOCUMENTED_DEFAULTS`)
 * 里都被引用过。写成一个固定的 1998 年,那么在某个生日之后它会自己涨到 29,
 * 而那三处会在同一天悄悄变得不对 —— 缓慢的、跨年的漂移,是最难查的一类。
 */
export function birthForAge(age: number, now: Date = new Date()): Birth {
  return { year: now.getFullYear() - age, month: 1, day: 1 }
}
