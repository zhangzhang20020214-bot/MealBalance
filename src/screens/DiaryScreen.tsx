import { useMemo, useState } from 'react'
import { Screen } from '../components/ios/Screen'
import { Icon } from '../components/Icons'
import {
  Card,
  DarkCard,
  IconTile,
  PageSubtitle,
  PageTitle,
  SectionTitle,
  SegmentedControl,
} from '../components/ui'
import { MealSheet } from '../components/MealSheet'
import { PendingMealRow } from '../components/PendingMealRow'
import { TrendCharts } from '../components/TrendCharts'
import {
  dayStats,
  deriveWarnings,
  entryIcon,
  entrySummary,
  entryTint,
  findBrokenRefs,
  findLostWebNutrition,
  nutritionOfEntry,
  weekTrend,
  type DayStats,
} from '../store/derive'
import { pendingForDate, setLogRun, useLogRun } from '../store/logRun'
import { quotaBasis } from '../store/quota'
import { useAppState } from '../store/store'
import { formatDateLabel, formatRelativeDay, fromISODate, todayISO, toISODate } from '../lib/date'

type Range = 'day' | 'week' | 'month'

const RANGE_DAYS: Record<Exclude<Range, 'day'>, number> = { week: 7, month: 30 }

/**
 * 一张警示卡 —— 幽灵条目和健康警示共用同一套视觉。
 *
 * 抽出来是因为这两类卡片**挨着出现**,而挨着出现的同类东西长得不一样时,
 * 会被读成两种不同性质的东西。它们的区别应该在**文字**里,不在配色里。
 *
 * `basis` 是**可选**的,因为这张卡的四位调用方里只有健康警示有依据:
 * 「连续 2 日钠摄入超上限」里的「上限」是当前档案定的(见 `deriveWarnings`),
 * 而幽灵条目、联网营养丢失那两张说的是数据本身出了问题,和用户档案无关 ——
 * 给它们凑一句「依据」就是**把一条数据故障说成一条饮食建议**。
 */
function Notice({ title, body, basis }: { title: string; body: string; basis?: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[20px] border border-warn-line bg-warn-bg px-4 py-3.5">
      <Icon name="warning" size={20} className="mt-px shrink-0 text-warn" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] leading-[15.6px] font-medium text-warn-text">{title}</span>
        <span className="text-[12px] leading-[17.38px] text-warn-body">{body}</span>
        {/*
          和结果页那条依据同一条规矩:**字号只比正文小一档、颜色沿用正文那个**,
          不另配一种灰。这里正文是 12/17.38,所以它是 11/15.93。
        */}
        {basis && <span className="text-[11px] leading-[15.93px] text-warn-body">依据 · {basis}</span>}
      </div>
    </div>
  )
}

/**
 * 膳食日记 —— 对应 Figma「③ 界面原型 / 02 · 膳食日记 Diary」。
 *
 * 日/周/月三档是**真的**在换数据,不是装饰性的分段控件:
 * 日视图看当天明细,周/月视图看日均与逐日趋势。
 */
export default function DiaryScreen() {
  const state = useAppState()
  /** 在飞的那一趟「记进日记」（见 `store/logRun.ts`）。这一页只读它 */
  const logRun = useLogRun()
  const [range, setRange] = useState<Range>('day')
  const [dayOffset, setDayOffset] = useState(0) // 0 = 今天,负数往回翻
  const [mealSheetOpen, setMealSheetOpen] = useState(false)
  /**
   * 正在改的那一条 —— 存的是 **id,不是那条记录本身**。
   *
   * 存整个对象是这里最容易写出来、也最难发现的一版:列表拿到的是某一刻的
   * 快照,存下来之后它不会跟着 store 走,编辑面板里显示的、以及最后删掉的,
   * 都可能是**一条已经不存在或者已经变了的记录**。
   * store.ts 里 editProfile 那条注释立的是同一条规矩(「`before` 取 store
   * 里的那一刻,不取调用方闭包里的」)。
   *
   * 顺带白拿一个好处:记录一旦从 store 消失,下面的 `editing` 就是 null,
   * 面板自己就关了 —— 不需要一个 `onDeleted` 回调去记得关它。
   */
  const [editingId, setEditingId] = useState<string | null>(null)

  /** 现取 —— 见上面那段。找不到(id 被删了)就当没在编辑 */
  const editing = editingId === null ? null : (state.meals.find((m) => m.id === editingId) ?? null)

  const today = todayISO()

  /** 日视图选中的日期 */
  const date = useMemo(() => {
    const d = fromISODate(today)
    d.setDate(d.getDate() + dayOffset)
    return toISODate(d)
  }, [today, dayOffset])

  const view = useMemo(() => {
    if (range === 'day') {
      const s = dayStats(state.meals, date, state.profile)
      return { nutrition: s.nutrition, meals: s.entries, days: [s] as DayStats[], isAverage: false }
    }
    const t = weekTrend(state.meals, state.profile, RANGE_DAYS[range])
    // 周/月视图只列出有记录的日子
    return { nutrition: t.dailyAvg, meals: [], days: t.days.filter((d) => d.mealCount > 0), isAverage: true }
  }, [range, state.meals, state.profile, date])

  /**
   * **这一餐正在算** —— 用户在对话页点完「记入日记」之后，那十几到几十秒里
   * 日记页要说得出这句话（他 2026-09-24 的原话见 `PendingMealRow` 文件头）。
   *
   * ⚠️ **它不进 `state.meals`。** 一条伪记录会让 `dayStats`（`derive.ts` 里
   * 只按 `m.date === date` 过滤）把这一餐算进当天营养、`mealCount` 和健康分，
   * 再顺着首页黑卡和趋势一起错 —— 而它一个数字都没有，算出来的全是假的。
   * 它只活在 `logRun` 那一份内存状态里，由这一天的那一行**单独**渲染。
   *
   * 哪一天、哪一趟该显示，判据全在 `pendingForDate`（纯函数，`verify:loop` 直接测）。
   */
  const pending = pendingForDate(logRun, date)

  const warnings = useMemo(
    () => (range === 'day' ? deriveWarnings(state.meals, state.profile) : []),
    [range, state.meals, state.profile]
  )

  /**
   * 幽灵条目 —— 记录里指向了食物库中已经不存在的 id。
   *
   * **不按 range 过滤**:日视图的三餐数字、周/月的日均、以及首页的健康分
   * 全都受它影响,所以三档都要挂这张卡。这一点和上面的健康警示不同 ——
   * 那个只在日视图出现,因为「连续几日超标」本身就是按天数的判断。
   */
  const brokenRefs = useMemo(() => findBrokenRefs(state.meals), [state.meals])
  /**
   * 文案里的 N 是**条目数**不是菜数:同一道菜出现在三餐里,用户看到的是
   * 三处记录不对,而不是一道菜不对。所以要把每道菜的 count 加起来。
   *
   * 下面那句**只印这一个数**。菜名的列表是举例,后面不再缀「等 N 道菜」——
   * 那张卡上出现两个都叫「项」的数字时,同一道菜记了两餐就会当场对不上,
   * 而用户会以为其中一个写错了。
   */
  const brokenItemCount = brokenRefs.reduce((s, r) => s + r.count, 0)

  /**
   * 联网查到的营养丢了 —— 见下面那张卡的注释。与上面那张**分开算**,
   * 因为它们是两类问题,修法不同。
   */
  const lostWebRefs = useMemo(() => findLostWebNutrition(state.meals), [state.meals])
  const lostWebItemCount = lostWebRefs.reduce((s, r) => s + r.count, 0)

  /**
   * 趋势统计的窗口**跟着档位走**。
   *
   * ⚠️ 这里原来是写死的 `7`。月视图那句话印的是「**近 30 天**日均钠 …
   * ↓ 5%，连续 3 日未超上限」,而这两个数都取自**同一个 7 天窗口** ——
   * 也就是说那半句话在月视图下是假的:副标题说 30 天,数字是 7 天的,
   * 用户看不到任何不一致的痕迹。
   *
   * 日视图仍然是 7 天:那一档的趋势句说的是「这一周」,不是「这一天」。
   */
  const trendDays = range === 'day' ? 7 : RANGE_DAYS[range]
  const trend = useMemo(
    () => weekTrend(state.meals, state.profile, trendDays),
    [state.meals, state.profile, trendDays]
  )

  /**
   * 当前档位下这段窗口叫什么 —— 页头副标题和黑卡底部那句**共用同一个说法**。
   *
   * 副标题原来写死「本周控盐趋势向好」,月视图下配着 30 天的数据说「本周」;
   * 窗口改成跟着档位走之后,这句必须同时跟着走,否则等于把刚修好的谎
   * 从黑卡挪到了页头。
   */
  const trendUnit = range === 'month' ? '近 30 天' : '本周'

  const n = view.nutrition
  const q = state.profile.quota
  const sodiumRatio = n.sodium / q.sodium
  const sodiumTone = sodiumRatio >= 1 ? 'text-danger' : sodiumRatio >= 0.8 ? 'text-warn' : 'text-white'

  /**
   * 黑卡底部那句趋势 —— 按当前档位给不同口径的说明。
   *
   * 三档里**只有「这一天没有记录」那句没有依据**:它没提任何上限。
   * 其余每一句都白纸黑字写着「上限」(「钠超出**上限** 420mg」「钠在**上限**的
   * 62%」「连续 3 日未超**上限**」),而那个上限是当前档案定的 ——
   * 所以依据的判断标准还是那一条:句子里有没有引用档案里的数。
   */
  const trendLine = useMemo((): { text: string; basis: string | null } => {
    const basis = quotaBasis(state.profile, 'sodium')
    if (range === 'day') {
      if (view.meals.length === 0) {
        /*
          ⚠️ 有一餐**正在算**的时候不能说「这一天没有记录…或补记一餐」——
          他刚刚才补过，那一句会让他以为没点上，再去点一次。
          改成说这一行的**归宿**（下面那一行说的是「正在算」，这里说的是
          「算好了会记在这里」），两句话各说一半，不重复。
        */
        if (pending) return { text: '这一餐还在算，算好了会记在这一天。', basis: null }
        return { text: '这一天没有记录。翻回今天，或补记一餐。', basis: null }
      }
      const over = n.sodium - q.sodium
      if (over > 0) {
        return { text: `钠超出上限 ${Math.round(over)}mg，是当日最主要的失分项。`, basis }
      }
      return { text: `钠在上限的 ${Math.round(sodiumRatio * 100)}%，控制在范围内。`, basis }
    }
    const base = `${trendUnit}日均钠 ${(n.sodium / 1000).toFixed(1)}g`
    if (trend.sodiumDeltaPct === null) return { text: `${base}。`, basis }
    const dir = trend.sodiumDeltaPct <= 0 ? '↓' : '↑'
    return {
      text: `${base} ${dir} ${Math.abs(trend.sodiumDeltaPct)}%，连续 ${trend.sodiumStreak} 日未超上限。`,
      basis,
    }
  }, [range, view.meals.length, pending, n, q.sodium, sodiumRatio, trend, trendUnit, state.profile])

  const canGoForward = dayOffset < 0

  /**
   * 开创建面板。
   *
   * 「编辑中」和「创建中」是两个互斥的状态,清零写在这一处 ——
   * 日记页有两个创建入口(页头那颗、空态那行),哪天再加一个,
   * 漏掉半边就是「面板标题写着修改记录,里面却是空的」。
   */
  const openCreate = () => {
    setEditingId(null)
    setMealSheetOpen(true)
  }

  return (
    <Screen>
      <div className="flex flex-col gap-3.5 px-5 pt-1">
        {/* ---------- 页头 ---------- */}
        <header className="flex h-[54px] items-center justify-between">
          <div>
            <PageTitle>膳食日记</PageTitle>
            <PageSubtitle>
              {trend.sodiumDeltaPct !== null && trend.sodiumDeltaPct <= 0
                ? `${trendUnit}控盐趋势向好`
                : '按日查看每一餐的记录'}
            </PageSubtitle>
          </div>
          <SegmentedControl
            value={range}
            onChange={(v) => {
              setRange(v)
              setDayOffset(0)
            }}
            options={[
              { value: 'day', label: '日' },
              { value: 'week', label: '周' },
              { value: 'month', label: '月' },
            ]}
          />
        </header>

        {/* ---------- 摄入概览黑卡 ---------- */}
        <DarkCard className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] leading-[17.38px] text-white">
              {range === 'day' ? `${formatRelativeDay(date)}摄入概览` : range === 'week' ? '本周日均摄入' : '近 30 天日均'}
            </span>

            {/* 日期翻页 —— 只在日视图有意义,周/月是区间统计 */}
            {range === 'day' && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setDayOffset((o) => o - 1)}
                  className="px-1.5 py-0.5 text-white active:opacity-60"
                  aria-label="前一天"
                >
                  ←
                </button>
                <span className="tnum text-[11px] leading-[15.93px] text-white">{formatDateLabel(date)}</span>
                <button
                  onClick={() => setDayOffset((o) => Math.min(0, o + 1))}
                  disabled={!canGoForward}
                  className={`px-1.5 py-0.5 text-white ${canGoForward ? 'active:opacity-60' : 'opacity-30'}`}
                  aria-label="后一天"
                >
                  →
                </button>
              </div>
            )}
          </div>

          {/* 三等分数据行 */}
          <div className="flex">
            {[
              { v: String(Math.round(n.kcal)), u: 'kcal', l: `热量 / ${q.kcal}`, cls: 'text-white' },
              {
                v: `${(n.sodium / 1000).toFixed(1)}g`,
                u: undefined,
                l: `钠 / ${(q.sodium / 1000).toFixed(1)}g`,
                cls: sodiumTone,
              },
              {
                v: `${Math.round(n.protein)}g`,
                u: undefined,
                l: `蛋白质 / ${q.protein}g`,
                cls: 'text-white',
              },
            ].map((m) => (
              <div key={m.l} className="flex h-[55px] flex-1 flex-col justify-center gap-0.5">
                <div className="flex items-baseline gap-1">
                  <span className={`tnum text-[17px] leading-[20.57px] font-bold ${m.cls}`}>{m.v}</span>
                  {m.u && <span className="tnum text-[11px] leading-[13.31px] font-medium text-white">{m.u}</span>}
                </div>
                <span className="text-[11px] leading-[15.93px] text-white">{m.l}</span>
              </div>
            ))}
          </div>

          {/*
            句子和它的依据包在同一个盒子里(gap-0.5)—— 黑卡是 `gap-3`,
            平级的话那行小字会被推出去 12pt,读起来像另一句话。
          */}
          <div className="flex flex-col gap-0.5">
            <p className="text-[12px] leading-[17.38px] text-white">{trendLine.text}</p>

            {/*
              这张黑卡上的小字只有这一种写法 —— 和首页黑卡底部那句「依据」
              同一个档位(11/15.93),颜色比正文淡一档而不是换一种灰。
            */}
            {trendLine.basis && (
              <p className="text-[11px] leading-[15.93px] text-white/60">依据 · {trendLine.basis}</p>
            )}
          </div>
        </DarkCard>

        {/*
          幽灵条目 —— 上面黑卡里的数字**是错的**,所以这条必须排在健康警示**前面**。
          排在后面等于先给一个错的结论,再补一句「顺带一提那结论不准」。

          正常情况下这个数组是空的,卡片不出现;它出现就意味着有人改了 foodId,
          而旧记录还留在 localStorage 里 —— 见 derive.ts 里 findBrokenRefs 的注释。
        */}
        {brokenRefs.length > 0 && (
          <Notice
            title={`有 ${brokenItemCount} 项记录不在食物库里`}
            body={`${brokenRefs
              .slice(0, 3)
              .map((r) => r.name)
              .join('、')}${brokenRefs.length > 3 ? '等' : ''}无法计算营养。这里、周趋势和首页的健康分都把它们按 0 计，所以那些数字偏低。`}
          />
        )}

        {/*
          联网营养丢了 —— 和上面那张卡是**两件不同的事**,所以分开两张。

          上面那张:食物库里没有这条记录指向的东西(幽灵,数据源被改过)。
          这一张:菜是库外菜没错,但它的 `per100g` 在某一层被吃掉了,
          于是本该有的数字变成 0。

          分成两张而不是合并计数,理由是**修法不一样**:幽灵要改 id 或补回库里,
          这一条要去看是哪一层没转发字段。合并成「有 N 项算不出营养」会让两张
          该做不同事的问题共用一个入口。

          ⚠️ 这一张**正常情况下永远不出现** —— `matchDishes` 只在拿到合法
          `per100g` 时才产出 `web:` 项。它出现就等于「库外菜的营养值在哪一层
          被丢掉了,而全 App 没有别的地方会出声」,见 derive.ts 里
          findLostWebNutrition 的注释。所以这张卡的价值不是给用户看的,
          是**给下一次那个静默 bug 一个响声**。文案按「用户看不懂也得看得见」写。
        */}
        {lostWebRefs.length > 0 && (
          <Notice
            title={`有 ${lostWebItemCount} 项联网查到的营养没存下来`}
            body={`${lostWebRefs
              .slice(0, 3)
              .map((r) => r.name)
              .join('、')}${lostWebRefs.length > 3 ? '等' : ''}的营养值丢失了，现在按 0 计，热量与钠都会偏低。这条正常情况下不该出现，如果看到了请反馈。`}
          />
        )}

        {/* ---------- 警示卡 —— 由数据推导,没有超标就不出现 ---------- */}
        {warnings.map((w) => (
          <Notice key={w.title} title={w.title} body={w.body} basis={w.basis} />
        ))}

        {/*
          ---------- 趋势图 ----------

          **只在周/月两档出现**,日视图没有它。三档各有一条理由:

          · 日视图只有一个点。一根柱子的柱状图、一个点的折线,画出来是一屏
            没有信息的图形;而这一档真正该看的是「今天哪几餐、哪一项超了」,
            那已经写在上面那张黑卡和下面的餐次列表里了。
          · 周视图 7 格、月视图 30 格 —— 这两档本来就是**为了看趋势**才存在的
            (逐日汇总那张卡就是逐日一行),图是它的第一眼。

          传的是 `trend.days`(**整个窗口、含没有记录的天**),不是上面
          `view.days`(那个已经滤掉了空白天)。这一条是承重的:滤过之后再画,
          柱子的间距会变成等距的,「周三没记」和「周三记了」在图上长得一样 ——
          而少记一天和那天吃得很少是两件相反的事。判据见 `lib/trend.ts` 文件头。

          `windowLabel` 复用 `trendUnit`,不另起一个说法:这一页上「近 30 天」
          这四个字已经有一个来源,图上再写一个「30天」就是在同一页里给同一段
          窗口起两个名字。
        */}
        {range !== 'day' && (
          <>
            <SectionTitle>趋势</SectionTitle>
            <TrendCharts days={trend.days} quota={q} windowLabel={trendUnit} />
          </>
        )}

        {/* ---------- 记录区 ---------- */}
        <div className="flex items-center justify-between">
          <SectionTitle>{range === 'day' ? '餐次记录' : '逐日汇总'}</SectionTitle>
          <button
            onClick={openCreate}
            className="text-[13px] leading-[18px] font-medium text-brand-deep active:opacity-60"
          >
            + 记录一餐
          </button>
        </div>

        <Card>
          {range === 'day' ? (
            /*
              ⚠️ 空态那个判据里带着 `!pending`：只有一餐正在算的时候，
              「这一天还没有记录」和下面那行「正在算这一餐」会**同屏互相打架** ——
              前者是句总结，后者是事实，用户读到的是「它到底知不知道我在记」。
            */
            view.meals.length === 0 && !pending ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[14px] leading-[20px] text-muted">这一天还没有记录</p>
                <button
                  onClick={openCreate}
                  className="mt-2 text-[14px] leading-[20px] font-medium text-brand-deep active:opacity-60"
                >
                  记一餐
                </button>
              </div>
            ) : (
              <>
                {view.meals.map((meal, i) => (
                  <div key={meal.id}>
                    {i > 0 && (
                      // 分割线左缩进 68pt(与图标底右缘 + 间距对齐),符合 iOS 列表规范
                      <div className="pl-[68px]">
                        <div className="h-px bg-line" />
                      </div>
                    )}
                    {/*
                      点一行 = **改这一条**,不是删它。

                      这里原来是直接弹删除确认的 —— 于是「记错了」的唯一出路
                      就是删掉重记,而重记会换一个 id、换一个 createdAt,
                      照片还得重拍。删除没有消失,它挪到了编辑面板的底部
                      (见 MealSheet):先看清楚这条记的是什么,再决定是改还是删。
                    */}
                    <button
                      onClick={() => setEditingId(meal.id)}
                      className="flex h-[66px] w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.03]"
                    >
                      {/*
                        拍餐盘记的那一餐显示缩略图,其余仍是图标。
                        尺寸、圆角、外框和 IconTile 完全一致(40×40 r12),
                        所以上面那条分割线的 pl-[68px] 缩进不用动 ——
                        这是复用 IconTile 而不是另写一个 img 的主要理由
                      */}
                      <IconTile
                        name={entryIcon(meal)}
                        size={40}
                        radius={12}
                        tone={entryTint(meal, state.profile)}
                        iconSize={20}
                        src={meal.thumb}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px] leading-[22px] text-ink">
                          {meal.slot} · {entrySummary(meal)}
                        </span>
                        <span className="text-[13px] leading-[18px] text-muted">
                          {meal.time} · {meal.source}
                        </span>
                      </div>
                      <span className="tnum shrink-0 text-[15px] leading-[22px] font-medium text-ink">
                        {Math.round(nutritionOfEntry(meal).kcal)}
                      </span>
                    </button>
                  </div>
                ))}
                {/*
                  「这一餐正在算」那一行 —— **排在当天记录的最后**。

                  位置不是随手放的:`dayStats` 按 `createdAt` 升序，而 `addMeal`
                  固定写「此刻」当 `createdAt`，所以算完那条真记录**必然**落在
                  今天已有记录之后 —— 也就是**这一行的位置上**。十几秒后它就地
                  变成那一条，不跳、不换位置。
                */}
                {pending && (
                  <PendingMealRow
                    run={pending}
                    divider={view.meals.length > 0}
                    onDismiss={() => setLogRun(null)}
                  />
                )}
              </>
            )
          ) : (
            // 周 / 月:逐日一行,点行翻到那一天的明细
            <>
              {view.days.map((d, i) => {
                const over = d.nutrition.sodium > q.sodium
                return (
                  <div key={d.date}>
                    {i > 0 && (
                      <div className="pl-[68px]">
                        <div className="h-px bg-line" />
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setRange('day')
                        const diff = Math.round(
                          (fromISODate(d.date).getTime() - fromISODate(today).getTime()) / 86_400_000
                        )
                        setDayOffset(diff)
                      }}
                      className="flex h-[66px] w-full items-center gap-3 px-4 py-3 text-left active:bg-black/[0.03]"
                    >
                      <IconTile
                        name="calendar"
                        size={40}
                        radius={12}
                        tone={over ? 'danger' : 'brand'}
                        iconSize={20}
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px] leading-[22px] text-ink">
                          {formatRelativeDay(d.date)} · {d.mealCount} 餐
                        </span>
                        <span className="text-[13px] leading-[18px] text-muted">
                          健康分 {d.score.score}
                          {over ? ` · 钠超上限 ${Math.round(d.nutrition.sodium - q.sodium)}mg` : ' · 钠在范围内'}
                        </span>
                      </div>
                      <span className="tnum shrink-0 text-[15px] leading-[22px] font-medium text-ink">
                        {Math.round(d.nutrition.kcal)}
                      </span>
                    </button>
                  </div>
                )
              })}
              {view.days.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <p className="text-[14px] leading-[20px] text-muted">这段时间还没有记录</p>
                </div>
              )}
            </>
          )}
        </Card>

        {/* 底部留白,最后一行不被浮动标签栏压住 */}
        <div className="h-1" />
      </div>

      {/* 创建 —— 首页那颗「手动记录」和这里走的是同一个面板的创建态 */}
      <MealSheet open={mealSheetOpen} onClose={() => setMealSheetOpen(false)} />

      {/*
        修改 —— `open` 硬编码为 true,因为这个元素**只有在编辑时才存在**:
        `editing` 一变成 null(点了取消、或者那一条被删了)它就整个卸载了。

        ⚠️ **这个条件渲染是承重的,别顺手改成常挂。** 常挂(写成
        `open={editing !== null} entry={editing ?? undefined}`)会踩两个坑:

        · 面板的重置 effect 只依赖 `[open]`(见 MealSheet 里那行
          `eslint-disable` 的注释),而切换行时 `open` **一直是 true** ——
          于是 effect 不重跑,面板顶着「新一条」的标题和日期,里面画的还是
          **上一条的菜**。
        · `entry` 变成 undefined 的那一刻 `editing` 就翻成 false,
          `save()` 会去调 `addMeal` —— 修改静默变成新建。

        删除在这个面板**里面**(底部那行红字 → 叠一层确认),日记页不再自己
        弹确认框:两个入口就是两处会走散的口径。
      */}
      {editing && <MealSheet open entry={editing} onClose={() => setEditingId(null)} />}
    </Screen>
  )
}
