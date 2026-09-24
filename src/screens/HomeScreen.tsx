import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '../components/ios/Screen'
import { Icon } from '../components/Icons'
import {
  Card,
  DarkCard,
  IconTile,
  PageSubtitle,
  PageTitle,
  ScoreRing,
  SectionTitle,
  SHADOW_CARD,
} from '../components/ui'
import { ActionSheet } from '../components/ActionSheet'
import { MAIN_SLOTS, isMainSlot } from '../lib/slots'
import { MealSheet } from '../components/MealSheet'
import { useMultiPhotoPicker } from '../components/PhotoPicker'
import { dayStats, daySummaryDetail } from '../store/derive'
import { useAppState } from '../store/store'
import { startPlateJob } from '../store/plate'
import {
  MAX_PHOTOS_PER_SEND,
  discardAll,
  emptyStaged,
  overflowNote,
  stage,
  unstage,
} from '../lib/composer'
import { formatDateLabel, lastNDays, todayISO } from '../lib/date'

/** 卡片内的一个数据块:大号数值 + 上限说明 */
function Metric({
  value,
  unit,
  label,
  tone = 'normal',
}: {
  value: string
  unit?: string
  label: string
  tone?: 'normal' | 'warn' | 'danger'
}) {
  const tones = { normal: 'text-white', warn: 'text-warn', danger: 'text-danger' }
  return (
    <div className="flex h-[55px] flex-col justify-center gap-0.5">
      <div className="flex items-baseline gap-1">
        <span className={`tnum text-[17px] leading-[20.57px] font-bold ${tones[tone]}`}>{value}</span>
        {unit && <span className="tnum text-[11px] leading-[13.31px] font-medium text-white">{unit}</span>}
      </div>
      <span className="text-[11px] leading-[15.93px] text-white">{label}</span>
    </div>
  )
}

/**
 * 首页 —— 对应 Figma「③ 界面原型 / 01 · 首页 Home」。
 *
 * 页面上每个数字都是从餐次记录**现算**的,没有任何写死的常量。
 * 所以在「记录一餐」保存之后,健康分、摄入量、餐次摘要会同时变化 ——
 * 这就是演示要证明的闭环。
 */
export default function HomeScreen() {
  const navigate = useNavigate()
  const state = useAppState()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [mealSheetOpen, setMealSheetOpen] = useState(false)

  /** 面板停在「再加一张」那一屏(点缩略图末尾那格「＋」进来的)。见 ActionSheet */
  const [adding, setAdding] = useState(false)

  /**
   * 刚选好、还没点「开始分析」的那几张。**非空 = 面板是预览态**。
   *
   * 之所以要有这个中间态:选到图的那一刻就发请求、就跳页的话,用户没有机会
   * 看一眼「这是不是我要的那张」—— 而拍糊了、拍成上一顿是这件事最常见的失败。
   * 而多张的动机是「一张全景 + 一张主食特写」,所以要能**一张张删**:
   * 删错一张的代价不该是把选对的那两张一起重来。
   *
   * ⚠️ **多张还有第二层意思:「一张张加」。** 用户先拍了一张全景,看完觉得
   * 还得补一张主食特写 —— 那时候面板上必须有一个「再加一张」的入口,而不是
   * 只有「重选」(它会把已经选好的那张一起清掉)。落点是缩略图末尾那格「＋」,
   * 见 `adding` 和 ActionSheet 的 `picked.onAdd`。
   *
   * ⚠️ **和对话页一样是个可变的盒子 + 一个 tick 计数器**(见 ChatScreen 同款
   * 写法)。`useState<StagedPhoto[]>` 做不到这件事 —— 往数组里 push 之后
   * React 看到的是同一个数组引用,不会重渲染;而每次 `[...photos, x]` 又要把
   * 「谁建了 object URL」这件事从 `composer` 手里拿走。盒子和渲染解耦之后,
   * 建/撤 URL 的规矩仍然只在 `composer.ts` 一处。
   */
  const [staged] = useState(emptyStaged)
  const [, setStagedTick] = useState(0)
  const syncStaged = () => setStagedTick((t) => t + 1)

  /** 多选时没收进来的张数。0 = 全收下了。存下来只为了在面板上说出来 */
  const [dropped, setDropped] = useState(0)

  /**
   * 撤掉草稿(如果有)。**三个出口共用这一处**:开始分析 / 关面板 /
   * 手动记录。漏掉任何一个都不会报错,只是内存里多留住几个几 MB 的 blob ——
   * 所以它必须只有一份,不能在每个出口各写一遍。
   *
   * ⚠️ **「又选了一张」不在这个名单里。** 它原来是(那时候选一次就是换一批),
   * 现在「＋」再选一张是**接着往后放**,清掉的话就是「加一张反而少两张」。
   * 同理「＋」本身也不许走这里 —— 见下面 `picked.onAdd` 那段。
   *
   * ⚠️ 撤销**只从事件里发起**,不放 effect 的 cleanup。依赖写成 `[staged]`
   * 的那种 cleanup 会在每次草稿变化时先跑一遍,把刚建好的那些 URL 撤掉 ——
   * 屏幕上立刻是裂图,而且只在「换第二张」的时候出现,极难查。
   * 代价说清楚:攒着草稿时直接切到别的 Tab,那几个 URL 要等刷新页面才释放。
   */
  const dropDraft = () => {
    discardAll(staged)
    setDropped(0)
    syncStaged()
  }

  /**
   * 真的唤起相机/相册。
   *
   * 选到图之后**只换面板的身体,不发起任务、也不跳页** —— 见 ActionSheet
   * 文件头。任务留到用户点「开始分析」时才发起。
   *
   * 用 `URL.createObjectURL` 而不是 lib/image.ts 的 `prepareImage`:后者要
   * 解码 + canvas 重编码 + 阶梯压档,手机上一张 1~3 秒,而这一步的全部要求
   * 只是「让我看一眼这是不是我要的那张」。`createObjectURL` 是同步的、瞬时的。
   *
   * ⚠️ 多选**只挂在相册那个 input 上**(相机那条带 `capture`,不支持多选,
   * 见 PhotoPicker)。所以这里进来的可能是 1 张,也可能是 5 张 ——
   * 收不下的明说,见下面那行。
   *
   * ⚠️ **这里不 `discardAll`。** 它原来是「重选」留下的清场,而重选已经撤掉了。
   * 现在能走到这儿的有两条路:① 面板刚打开、一张没选(盒子本来就是空的);
   * ② 点末尾那格「＋」再选(**上一次选的那几张必须留着**)。先清一次的话,
   * 第二条路就变成「加一张 = 把前面两张吃掉」,而屏上只是缩略图少了两张,
   * 没有任何提示 —— 那正是这个「＋」要解决的问题本身。
   */
  const picker = useMultiPhotoPicker((files) => {
    const rest = stage(staged, files)
    setDropped(rest)
    setAdding(false)
    syncStaged()
  })

  const today = todayISO()
  const { stats, summary, summaryBasis } = useMemo(() => {
    const s = dayStats(state.meals, today, state.profile)
    const y = dayStats(state.meals, lastNDays(2)[0], state.profile)
    const d = daySummaryDetail(s, y, state.profile)
    return { stats: s, summary: d.text, summaryBasis: d.basis }
  }, [state.meals, state.profile, today])

  const n = stats.nutrition
  const q = state.profile.quota

  // 钠达到上限的 80% 就转琥珀色预警,超标转红
  const sodiumRatio = n.sodium / q.sodium
  const sodiumTone = sodiumRatio >= 1 ? 'danger' : sodiumRatio >= 0.8 ? 'warn' : 'normal'

  // 「还缺哪一餐」只数三餐 —— 加餐可有可无,列出来会变成一句催人吃零食的话。
  // 判据(哪三个是正餐)只在 lib/slots.ts 一处
  const recordedSlots = stats.slots.filter((s) => isMainSlot(s.slot)).map((s) => s.slot)
  const missingSlots = MAIN_SLOTS.filter((s) => !recordedSlots.includes(s))

  return (
    <Screen>
      <div className="flex flex-col gap-3.5 px-5 pt-1">
        {/* ---------- 页头 ---------- */}
        <header className="flex h-[54px] items-center justify-between">
          <div>
            <PageTitle>食衡</PageTitle>
            <PageSubtitle>{formatDateLabel(today)}</PageSubtitle>
          </div>

          {/* 档案胶囊 —— 108×44,r22 */}
          <button
            onClick={() => navigate('/profile')}
            className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-line bg-card px-5 active:opacity-70"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
            <span className="text-[13px] leading-[14px] font-medium tracking-[0.2px] text-ink">
              {state.profile.name}
            </span>
          </button>
        </header>

        {/* ---------- 对话入口 ---------- */}
        <button
          onClick={() => navigate('/chat')}
          className={`flex h-12 items-center gap-2.5 rounded-[14px] border border-line bg-card px-4 text-left active:opacity-80 ${SHADOW_CARD}`}
        >
          <Icon name="search" size={18} className="shrink-0 text-muted" />
          <span className="flex-1 truncate text-[15px] leading-[22px] text-muted">问问食衡：这餐怎么吃更健康？</span>
          <Icon name="chevronRight" size={16} className="shrink-0 text-faint" strokeWidth={2.2} />
        </button>

        {/* ---------- 健康分黑卡 ---------- */}
        <DarkCard className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {/* 圆环 + 中心分值 */}
            <div className="relative shrink-0">
              <ScoreRing score={stats.score.score} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="tnum text-[19px] leading-[22px] font-bold text-white">{stats.score.score}</span>
                <span className="text-[10px] leading-[14px] tracking-[0.2px] text-white/70">健康分</span>
              </div>
            </div>

            {/* 2×2 数据组 */}
            <div className="grid flex-1 grid-cols-2 gap-x-2.5 gap-y-2.5">
              <Metric
                value={String(Math.round(n.kcal))}
                unit="kcal"
                label={`已摄入 / ${q.kcal}`}
              />
              <Metric
                value={`${(n.sodium / 1000).toFixed(1)}g`}
                label={`钠 / 上限 ${(q.sodium / 1000).toFixed(1)}g`}
                tone={sodiumTone}
              />
              <Metric value={`${Math.round(n.protein)}g`} label={`蛋白质 / ${q.protein}g`} />
              <Metric value={`${Math.round((n.kcal / q.kcal) * 100)}%`} label="配额进度" />
            </div>
          </div>

          {/*
            句子和它的依据包在同一个盒子里(gap-0.5),不是黑卡的两个平级子元素
            —— 黑卡是 `gap-3`,平级的话那行小字会被推出去 12pt,读起来像另一句话。
            下面那句「记录不足两餐」反过来**必须**是平级的:它说的是环里那个分数,
            不是这句话的注解。
          */}
          <div className="flex flex-col gap-0.5">
            <p className="text-[12px] leading-[14px] tracking-[0.2px] text-white">{summary}</p>

            {/*
              「今日钠已超上限 420mg」这句话里的「上限」是**当前档案**定的 ——
              用户改过慢性病、手调过配额,这句话会跟着变,却读不出为什么。
              依据由 `daySummaryDetail` 只在**那句话真的提到上限**时给出,所以
              「比昨日同期少摄入…」那种日子这里什么都不画(见 derive.ts)。

              ⚠️ 字号档位和下面那句「记录不足两餐」**完全相同**,不另配一种灰:
              这张黑卡上「比正文小一档、更淡」的小字只有这一种写法。
            */}
            {summaryBasis && (
              <p className="text-[11px] leading-[15.93px] text-white/60">依据 · {summaryBasis}</p>
            )}
          </div>

          {/*
            `provisional`(`mealCount < 2`)在 derive.ts 里算了一阵子了,
            **在此之前没有任何渲染方** —— 而「走完建档、一餐没记」正是新用户
            默认看到的那一屏:环里写着 66,看起来像一份体检结论。
            数字本身没算错(下面几行因子写明了它怎么来的),但「只记了不到
            两餐」这件事得说出来,否则那个 66 读起来像一个结论。
          */}
          {stats.score.provisional && (
            <p className="text-[11px] leading-[15.93px] text-white/60">记录不足两餐，分数仅供参考</p>
          )}
        </DarkCard>

        {/* ---------- 拍餐盘入口(品牌渐变)---------- */}
        <button
          onClick={() => setSheetOpen(true)}
          className="flex w-full items-center gap-3 rounded-[24px] p-4 text-left shadow-[0_10px_24px_rgba(31,138,60,0.28)] transition-transform active:scale-[0.985]"
          style={{ backgroundImage: 'linear-gradient(135deg, #34C759 0%, #1F9A44 100%)' }}
        >
          <div className="flex flex-1 flex-col items-start gap-2">
            <IconTile name="camera" tone="plain" />
            <div>
              <div className="text-[20px] leading-[26px] font-bold tracking-[-0.3px] text-white">拍餐盘</div>
              {/*
                原来这里是「识别菜品 · **估算分量** · 计算营养 · 风险分级」。
                分量现在不再由 App 估算 —— 出结果前有一步让用户自己选(见
                src/lib/portion.ts),所以那个词换成了「确认分量」。
                首页这句 CTA 不改的话,用户进来第一眼看到的还是老模型
              */}
              <div className="text-[13px] leading-[18px] text-white">识别菜品 · 确认分量 · 计算营养 · 风险分级</div>
            </div>
          </div>
          <Icon name="chevronRight" size={22} className="text-white" strokeWidth={2.4} />
        </button>

        {/* ---------- 今日餐次 ---------- */}
        <div className="flex items-center justify-between">
          <SectionTitle>今日餐次</SectionTitle>
          <button
            onClick={() => setMealSheetOpen(true)}
            className="text-[13px] leading-[18px] font-medium text-brand-deep active:opacity-60"
          >
            + 手动记录
          </button>
        </div>

        <Card className="flex items-center gap-3 px-4 py-3" onClick={() => navigate('/diary')}>
          <IconTile name="calendar" radius={12} tone="brand" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] leading-[22px] font-medium text-ink">
              {stats.mealCount === 0
                ? '今天还没有记录'
                : `已记录 ${stats.mealCount} 餐${missingSlots.length ? ` · ${missingSlots.join('、')}待记录` : ''}`}
            </span>
            <span className="truncate text-[13px] leading-[18px] text-muted">
              {stats.mealCount === 0
                ? '点「拍餐盘」或「手动记录」开始'
                : stats.slots.map((s) => `${s.slot} ${Math.round(s.nutrition.kcal)} kcal`).join(' · ')}
            </span>
          </div>
          <Icon name="chevronRight" size={18} className="shrink-0 text-muted" strokeWidth={2.2} />
        </Card>
      </div>

      {/* 拍餐盘 → 操作表（选到图之后原地变成预览，见 ActionSheet 文件头） */}
      <ActionSheet
        open={sheetOpen}
        onClose={() => {
          /*
            ⚠️ **停在「再加一张」那一屏时,「取消」是回上一屏,不是关面板。**
            这里直接 dropDraft 的话,「＋」点进去又反悔 = 已经选好的那几张全没了
            —— 而那恰恰是用户最不想丢的。面板上那颗「取消」和遮罩走的是同一个
            处理函数,所以两处一起对。
          */
          if (adding) {
            setAdding(false)
            return
          }
          dropDraft()
          setSheetOpen(false)
        }}
        onCamera={picker.openCamera}
        onAlbum={picker.openAlbum}
        onManual={() => {
          dropDraft()
          setAdding(false)
          setSheetOpen(false)
          setMealSheetOpen(true)
        }}
        picked={{
          photos: staged.photos,
          /*
            删一张就少一个 URL —— 由 composer 撤,这里只把它交出去。

            ⚠️ **`dropped` 不在这里归零。** 那句话说的是「选的时候没收下几张」,
            而删掉一张并不改变这个事实:那两张仍然没有进来。归零的话,用户删掉
            一张之后会发现「没收 2 张」那句话凭空消失了,而少的那两张并没有回来。
            (它会由下一次选择覆盖,也会跟着 `dropDraft` 一起归零。)
          */
          onRemove: (url) => {
            unstage(staged, url)
            syncStaged()
          },
          /*
            「＋」—— 回三行来源,已选的那几张留着(见上面 picker 那段)。

            ⚠️ **它里面不许有 `dropDraft()`**:那就是「再加一张」和「重选」
            全部的差别,而两者点下去长得一模一样。

            ⚠️ **还有余量时才传。** 满了还摆着那一格的话,用户点进去选一张、
            回来只会看到「这次没收 1 张」—— 白走一趟。判据用
            `MAX_PHOTOS_PER_SEND`,不在这里重写一个 3:「一次几张」归 composer。
          */
          ...(staged.photos.length < MAX_PHOTOS_PER_SEND ? { onAdd: () => setAdding(true) } : {}),
          // 停在「再加一张」那一屏(标题换成「再加一张」,缩略图还画着)
          ...(adding ? { adding: true } : {}),
          // 选了 5 张只收 3 张时必须说出来,不静默丢(见 composer.stage)
          ...(dropped > 0 ? { note: overflowNote(dropped) } : {}),
        }}
        /*
          任务在**这里**发起,不是等分析页挂载后再发 —— 见 plate.ts 文件头
          关于 StrictMode 的那段:effect 会双调用,事件处理器不会。
          这一段(压缩 → /analyzing → /portion → /result)一个字都没动,
          这次只是在**链的入口前面**加了一道确认。
        */
        onAnalyze={() => {
          /*
            ⚠️ **先把文件拷出来,再 `dropDraft()`** —— 它会把盒子清空。
            顺序反了的话 `startPlateJob` 收到的是一个空数组,而它对此的反应是
            「什么都不做,只把 job 拨回 idle」(见 plate.ts 的入参说明);
            于是页面跳去 /analyzing,停在那句「还没有待分析的照片」上。

            撤掉那几个预览图的 object URL 不影响这里:**任务要的是 `File`,
            不是 URL**。分析页那一格图是 plate.ts 自己重新压出来的。
          */
          const files = staged.photos.map((p) => p.file)
          dropDraft()
          setSheetOpen(false)
          if (files.length === 0) return
          startPlateJob(files)
          navigate('/analyzing')
        }}
      />

      {/*
        两个隐藏 input。必须在 ActionSheet **外面** ——
        那个组件在 open=false 时直接 return null,挂在里面的 input
        会连同面板一起被卸载。iOS 上「选择器还开着、触发它的 input
        被移出 DOM」会取消这次选择(见 PhotoPicker.tsx 文件头第 3 条)
      */}
      {picker.inputs}

      {/* 手动记录面板 */}
      <MealSheet open={mealSheetOpen} onClose={() => setMealSheetOpen(false)} />
    </Screen>
  )
}
