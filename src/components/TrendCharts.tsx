/**
 * 日记页周/月视图里的四张趋势图
 * ===========================================================
 *   ① 钠 · 逐日柱 + 上限线
 *   ② 热量 · 逐日柱 + 目标线
 *   ③ 健康分 · 折线(空档处断开)
 *   ④ 餐次占比 · 一条堆叠条
 *
 * 数全在 `lib/trend.ts` 里算,这个文件只负责画 —— 所以它**没有一处算术**
 * (连「最高多少分」都是 `scoreSummary` 给的,不是这里 `Math.max` 出来的)。
 * 唯一的例外是横轴标签印几个(见 `Axis`),那是排版决定,不是数据结论。
 *
 * ## 三条贯穿四张图的规矩
 *
 * 1. **图是 `aria-hidden` 的,数在句子和标签里。** 一条 30 格的柱状图对读屏
 *    来说是一串没有名字的矩形;真正该被念出来的是「本周 7 天里有 5 天有记录,
 *    其中 3 天超上限」这句。所以每张图另有一个 `sr-only` 的一句总述 ——
 *    不是把图形画什么再念一遍,而是念**这一屏想告诉你的那句话**。
 * 2. **没有记录的日子不画柱子**,留一格空位,位置仍然对得上日期。少记一天和
 *    那天吃得很少在屏幕上必须分得出来(判据和理由见 `lib/trend.ts` 文件头)。
 * 3. **四张卡的头、右角那个数、说明句各只有一种写法**,所以下面那个 `ChartCard`
 *    是唯一的壳 —— 四张卡长得不一样的话,读的人会以为它们是四种东西。
 *
 * ## 一天都没记的时候
 *
 * 四张图**照常画**:钠和热量那两张是一条空槽加一条上限线(说明句写「还没有
 * 记录」);健康分那张没有线;餐次占比那条是空的。不藏起来,是因为「图在、
 * 但是空的」本身就是一句回答,而藏起来会让人以为这个版块不存在。
 */

import type { ReactNode } from 'react'
import { Card, GroupHeader } from './ui'
import { barScale, daySeries, pctOf, recordedCount, overCount, scoreSummary, segmentsOf, slotShare } from '../lib/trend'
import type { DayPoint } from '../lib/trend'
import { weekdayShort } from '../lib/date'
import type { DayStats } from '../store/derive'
import type { Quota } from '../store/types'

/** 柱子和大色块的填色 —— 只用 App 现有的色值,不新造灰阶 */
const TONE = {
  /** 在范围内 */
  ok: 'bg-brand',
  /** 越过了上限/目标 —— 和日记页黑卡上那个琥珀色是同一个 warn */
  over: 'bg-warn',
  /** 餐次占比的四段:一条绿阶 + 一个中性色 */
  早餐: 'bg-brand-tint',
  午餐: 'bg-brand',
  晚餐: 'bg-brand-deep',
  加餐: 'bg-faint',
} as const

/**
 * 钠按**克**印,和日记页黑卡上那三格数字同一个口径(那边也是
 * `(n/1000).toFixed(1)` + 'g')。两处不一致的话,同一页上会同时出现
 * 「2000mg」和「2.0g」两个说法指同一个上限。
 */
const grams = (mg: number) => `${(mg / 1000).toFixed(1)}g`

/**
 * 四张卡共用的壳:卡片内的标题 · 右上角那个数 · 图 · 说明句。
 *
 * 标题走 `GroupHeader`(卡片里的标题那一档,12/14),**不是** `SectionTitle`
 * (13px,那是卡片外的区块标题)—— 这四张是卡片,判据是「标题在卡片里还是
 * 卡片外」,不是字号偏好。右边那个数借 `items-baseline` 和它坐同一条线。
 */
function ChartCard({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  return (
    <Card>
      <div className="flex items-baseline justify-between pr-4">
        <GroupHeader>{title}</GroupHeader>
        {right && <span className="tnum text-[11px] leading-[15.93px] text-muted">{right}</span>}
      </div>
      <div className="flex flex-col gap-2 px-4 pb-4">{children}</div>
    </Card>
  )
}

/**
 * 逐日柱状图 —— 钠和热量共用。
 *
 * 柱子用 flex 盒子而不是 SVG:高度是百分比、宽度均分,这两件事 flex 本来就
 * 是对的,而换成 SVG 就得自己算 30 个矩形的 x 和 width(月视图那 30 格)。
 *
 * ⚠️ **上限线画在柱子那一层的外面**(绝对定位),不是其中一根柱子 ——
 * 它是标尺的一部分,和「有几根柱子」无关。画在柱子里面的话,一天都没记录时
 * 它就不见了,而那正是最该看见它的时候。
 *
 * ⚠️ 越过上限的判据是 `value > limit`(`limit` 是**原值**,不是那个换算过的
 * 百分比)。第一版传的是百分比、再乘回标尺去还原上限 —— 而百分比是四舍五入
 * 过的,一根**正好等于上限**的柱子有一半概率被还原成「超了」,于是它变成琥珀色。
 * 同一件事算两遍的下场,和 `quota.ts` 里那段「两个半句必须同一判据」是同一条。
 */
function BarChart({
  points,
  max,
  limit,
  label,
}: {
  points: DayPoint[]
  max: number
  limit: number
  label: string
}) {
  return (
    <div className="relative h-[88px]">
      <div
        className="absolute inset-x-0 border-t border-dashed border-faint"
        style={{ bottom: `${pctOf(limit, max)}%` }}
        aria-hidden
      />
      <div className="flex h-full items-end gap-[2px]" aria-hidden>
        {points.map((p) =>
          p.value === null ? (
            /*
              没有记录的那一天:留一格空位,**什么都不放**。
              空位和「0 柱子」在屏幕上必须分得出来 —— 0 柱子有 2px 的
              `min-h-[2px]` 和圆角,空位连一根底线都没有。
            */
            <div key={p.date} className="min-w-0 flex-1" />
          ) : (
            <div
              key={p.date}
              className={`min-h-[2px] min-w-0 flex-1 rounded-t-[3px] ${p.value > limit ? TONE.over : TONE.ok}`}
              style={{ height: `${pctOf(p.value, max)}%` }}
            />
          )
        )}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}

/**
 * 横轴标签行。
 *
 * 周视图七天全印(每格四个字符放得下);月视图三十格印不下,只印首尾两天 ——
 * 中间那些格子靠柱子的疏密读,而首尾两天足以定位「这是哪一段日子」。
 * 这不是「挑几个好看的数」:印首尾是**唯一**一个在两种格宽下都成立的规则,
 * 隔五天印一个在 30 格下要印 6 个(还是挤),在 7 格下会只剩一个。
 */
function Axis({ dates }: { dates: string[] }) {
  /*
    空数组时返回 null,而不是让它自己去取 `dates[0]` —— 那会抛
    `Cannot read properties of undefined`,而抛在渲染里等于整页白屏。
    今天四个调用点传的都是 `weekTrend(...).days`(至少一天),所以这是一道
    给下一个人留的护栏,不是一条今天走得到的分支。
  */
  if (dates.length === 0) return null
  return (
    <div className="flex justify-between text-[10px] leading-[14px] text-faint">
      {dates.length <= 7 ? (
        dates.map((d) => (
          <span key={d} className="tnum min-w-0 flex-1 text-center">
            {weekdayShort(d)}
          </span>
        ))
      ) : (
        <>
          <span className="tnum">{weekdayShort(dates[0])}</span>
          <span className="tnum">{weekdayShort(dates[dates.length - 1])}</span>
        </>
      )}
    </div>
  )
}

/**
 * 健康分折线 —— 手写 `<svg>`,除 polyline 之外什么都没用。
 *
 * ⚠️ `preserveAspectRatio="none"` 会把线的粗细一起拉伸(横向 2pt、纵向按卡片
 * 宽度变形),所以每一笔都得带 `vectorEffect="non-scaling-stroke"`。这是这个
 * 写法唯一的坑,补上之后没有别的副作用。
 *
 * x 按**原序列下标**算(`segmentsOf` 带出来的 `index`),所以断档之后那一段
 * 不会自作主张铺满右半边 —— 位置和底下的日期标签永远对得上。
 * y 是固定的 0–100(分数本来就是百分制),所以不跟数据缩放:90 分永远在
 * 那么高,这周和下周的图能直接比。
 */
function ScoreChart({ points }: { points: DayPoint[] }) {
  const n = points.length
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100)
  const y = (score: number) => 100 - Math.min(100, Math.max(0, score))
  const segs = segmentsOf(points)
  return (
    <div className="h-[88px]">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
        {/* 60 分那条参考线 —— 固定刻度下它才是一条有意义的线 */}
        <line x1="0" y1={y(60)} x2="100" y2={y(60)} stroke="#e3e8e5" strokeWidth="1" vectorEffect="non-scaling-stroke" />

        {segs.map((seg) => (
          <polyline
            key={seg[0].index}
            points={seg.map((p) => `${x(p.index)},${y(p.value)}`).join(' ')}
            fill="none"
            stroke="#34c759"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/*
          只有一个点的那一段画不出线,补一个点 —— 否则「只记了一天」看起来
          和「一天都没记」一模一样。
        */}
        {segs
          .filter((seg) => seg.length === 1)
          .map((seg) => (
            <circle
              key={`d${seg[0].index}`}
              cx={x(seg[0].index)}
              cy={y(seg[0].value)}
              r="2.5"
              fill="#34c759"
              vectorEffect="non-scaling-stroke"
            />
          ))}
      </svg>
    </div>
  )
}

/** 餐次占比 —— 一条堆叠条 + 图例 */
function SlotBar({ days }: { days: DayStats[] }) {
  const rows = slotShare(days)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-line" aria-hidden>
        {rows.map((r) => (
          <div
            key={r.label}
            className={TONE[r.label as keyof typeof TONE]}
            /*
              最小宽度 2px:加餐常常只占 1–2%,按比例算出来不到一个像素 ——
              那一截看不见时,图例上却写着「加餐 2%」,读起来像图错了。
              没有热量的那一段给 0,不然四段会各多出 2px 来。
            */
            style={{ width: `${r.share * 100}%`, minWidth: r.kcal > 0 ? 2 : 0 }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-1.5 text-[11px] leading-[15.93px] text-muted">
            <span className={`h-2 w-2 shrink-0 rounded-full ${TONE[r.label as keyof typeof TONE]}`} aria-hidden />
            {/*
              整句拼成一个模板串,而不是 `{r.label} {n}%` 三个表达式并排 ——
              后者渲染出来是三个相邻的文本节点(SSR 产物里会插 `<!-- -->`),
              断言要么搜不到、要么得写成正则绕着走。
            */}
            <span className="tnum">{`${r.label} ${Math.round(r.share * 100)}%`}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 四张图。
 *
 * `days` 就是 `weekTrend(...).days` —— **从早到晚**,长度等于当前档位的天数
 * (周 7 / 月 30)。这里不自己取日期:那样就会出现「图上 7 天、页头写 30 天」
 * 那种没人看得出来的错位(日记页刚修过一次同类的)。
 *
 * `windowLabel` 是「本周」/「近 30 天」,由日记页那边算好传进来 —— 它是
 * **那句话里的词**,不是这里的排版决定,而这页上已经有一处(`trendUnit`)在管它。
 */
export function TrendCharts({
  days,
  quota,
  windowLabel,
}: {
  days: DayStats[]
  quota: Quota
  windowLabel: string
}) {
  /*
    三条序列 —— 钠、热量、健康分。**空白天在这里变成 `null`**,后面所有
    「几天有记录 / 几天超了 / 平均多少分」都从这三条序列上读,不再回头看
    `mealCount`。理由见 `lib/trend.ts` 文件头那段。
  */
  const sodium = daySeries(days, (d) => d.nutrition.sodium)
  const kcal = daySeries(days, (d) => d.nutrition.kcal)
  const scorePts = daySeries(days, (d) => d.score.score)

  /*
    横轴的日期序列取一次,三张图共用。

    ⚠️ 三张图**必须是同一串日期**(月视图 30 格):分开取的话,三张图的格子数
    会各自跟着自己的数据走,底下的日期标签就会错开一格 —— 而屏幕上看不出
    任何异常,只是柱子对错了日子。
  */
  const dates = days.map((d) => d.date)

  const scored = recordedCount(sodium)
  const score = scoreSummary(scorePts)
  const overSodium = overCount(sodium, quota.sodium)
  const overKcal = overCount(kcal, quota.kcal)

  return (
    <div className="flex flex-col gap-3">
      <ChartCard title="钠 · 逐日" right={`上限 ${grams(quota.sodium)}`}>
        <BarChart
          points={sodium}
          max={barScale(sodium, quota.sodium)}
          limit={quota.sodium}
          label={`${windowLabel}钠摄入逐日柱状图，虚线是每日上限 ${grams(quota.sodium)}，超出的日子是琥珀色`}
        />
        <Axis dates={dates} />
        <p className="text-[11px] leading-[15.93px] text-muted">
          {scored === 0
            ? `${windowLabel}还没有记录。`
            : `${windowLabel} ${days.length} 天里有 ${scored} 天有记录，其中 ${overSodium} 天超上限。`}
        </p>
      </ChartCard>

      <ChartCard title="热量 · 逐日" right={`目标 ${quota.kcal}kcal`}>
        <BarChart
          points={kcal}
          max={barScale(kcal, quota.kcal)}
          limit={quota.kcal}
          label={`${windowLabel}热量逐日柱状图，虚线是每日目标 ${quota.kcal} 千卡，超出的日子是琥珀色`}
        />
        <Axis dates={dates} />
        <p className="text-[11px] leading-[15.93px] text-muted">
          {scored === 0
            ? `${windowLabel}还没有记录。`
            : `${windowLabel} ${days.length} 天里有 ${scored} 天有记录，其中 ${overKcal} 天超目标。`}
        </p>
      </ChartCard>

      <ChartCard title="健康分 · 逐日" right={score ? `平均 ${Math.round(score.avg)} 分` : undefined}>
        <ScoreChart points={scorePts} />
        <Axis dates={dates} />
        <p className="text-[11px] leading-[15.93px] text-muted">
          {score === null
            ? `${windowLabel}还没有记录，所以没有分数可画。`
            : `有记录的 ${score.count} 天平均 ${Math.round(score.avg)} 分，最高 ${Math.round(
                score.max
              )}、最低 ${Math.round(score.min)}。没有记录的那几天不连线 —— 那几天没有分数，连起来等于替它编一个。`}
        </p>
      </ChartCard>

      <ChartCard title="餐次占比">
        <SlotBar days={days} />
        <p className="text-[11px] leading-[15.93px] text-muted">
          按{windowLabel}有记录的日子算，每一段的热量占这四段合计的比例。加餐 = 上午加餐 + 下午加餐 + 夜宵。
        </p>
      </ChartCard>
    </div>
  )
}
