/**
 * 日期工具
 *
 * 全程使用**本地时区**的 YYYY-MM-DD 字符串作为「哪一天」的标识。
 * 不用 Date 对象做 key、也不用 toISOString(),因为后者会转成 UTC ——
 * 在东八区,晚上 8 点之后记录的餐次会被算到"昨天"去,这是很常见的坑。
 */

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** Date → 本地时区的 YYYY-MM-DD */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** YYYY-MM-DD → 本地时区当天 00:00 的 Date */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(): string {
  return toISODate(new Date())
}

/** 星期五 · 9月18日 —— 首页与日记页的标题行 */
export function formatDateLabel(iso: string): string {
  const d = fromISODate(iso)
  return `${WEEKDAYS[d.getDay()]} · ${d.getMonth() + 1}月${d.getDate()}日`
}

/** 今天 / 昨天 / 9月16日 —— 日记列表里更省字的写法 */
export function formatRelativeDay(iso: string): string {
  const today = todayISO()
  if (iso === today) return '今天'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (iso === toISODate(y)) return '昨天'
  return formatDateLabel(iso).split(' · ')[1]
}

/** 最近 n 天(含今天),**从早到晚**排列 —— 趋势图按时间正序画 */
export function lastNDays(n: number): string[] {
  const out: string[] = []
  const d = new Date()
  d.setDate(d.getDate() - (n - 1))
  for (let i = 0; i < n; i++) {
    out.push(toISODate(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/**
 * 一 · 9/18 —— 趋势图横轴上那个标签。
 *
 * 为什么是「星期几简称 + 月/日」两截:周视图七天里,「一」到「日」一眼就能
 * 认出是哪一天;而月视图那三十格里,光有星期几认不出是哪一周。
 * 两截都印的话,一行放得下七个(每个三四个字符),放不下三十个 ——
 * 所以月视图那边只印首尾两个,判据在 `TrendCharts.tsx` 里。
 *
 * ⚠️ 不复用 `formatDateLabel`(「星期五 · 9月18日」):它一个标签就有十一个
 * 字符,七个连起来是 77 字符,在 370pt 宽的卡片里必然换行 —— 而横轴标签
 * 一换行,它就变成了正文。
 */
export function weekdayShort(iso: string): string {
  const d = fromISODate(iso)
  return `${WEEKDAYS[d.getDay()].slice(2)} · ${d.getMonth() + 1}/${d.getDate()}`
}

/** HH:mm */
export function formatTime(d: Date): string {
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 两个 ISO 日期相差几天(a - b) */
export function daysBetween(a: string, b: string): number {
  const ms = fromISODate(a).getTime() - fromISODate(b).getTime()
  return Math.round(ms / 86_400_000)
}
