import { useMemo, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '../components/ios/Screen'
import { Icon } from '../components/Icons'
import { AgentReplyCard } from '../components/AgentReplyCard'
import { DemoDataBanner } from '../components/DemoDataBanner'
import { DishRow } from '../components/DishRow'
import { MealSheet } from '../components/MealSheet'
import { Card, Footnote, IconTile, NavBar, NumberBadge, PrimaryButton } from '../components/ui'
import { type Advice } from '../store/advice'
import { type AmountTone } from '../store/eatingAmount'
import { deriveEatingPlan, type PlanRow } from '../store/eatingPlan'
import { countableItems, isWebId } from '../lib/dishMatch'
import { nutritionOfItems } from '../store/derive'
import { getPending, setPending, subscribePending } from '../store/recognize'
import { getPlateJob, releasePlatePreview, subscribePlateJob } from '../store/plate'
import { addMeal, useAppState } from '../store/store'
import { formatTime } from '../lib/date'

/**
 * 建议块的三种色调 —— 设计稿里三条建议分别用了红 / 琥珀 / 绿。
 *
 * `basis` 那一对色今天画的是**角标**(每条建议自己右上角那个小胶囊),
 * 不再是原来那块通栏的白底引文块。色值一个没动 —— `-line` 那档本来就是
 * 「同色系的边」,`-text` 是那一档的强色,配 `bg-card` 的白底:
 * 三套对比度一致,而且不用为「角标底色」新配三个色值。
 */
const ADVICE_TONES: Record<
  Advice['tone'],
  { card: string; title: string; body: string; icon: string; basis: string }
> = {
  danger: {
    card: 'bg-danger-bg',
    title: 'text-danger-text',
    body: 'text-danger-body',
    icon: 'text-danger',
    basis: 'border-danger-line text-danger-text',
  },
  warn: {
    card: 'bg-warn-bg',
    title: 'text-warn-text',
    body: 'text-warn-body',
    icon: 'text-warn',
    basis: 'border-warn-line text-warn-text',
  },
  brand: {
    card: 'bg-brand-bg',
    title: 'text-brand-text',
    body: 'text-brand-body',
    icon: 'text-brand-deep',
    basis: 'border-brand-line text-brand-text',
  },
}

/**
 * 「进食多少」那张卡上胶囊的四种颜色。
 *
 * ⚠️ **`plain`(适量)故意没有底色** —— 三档里只有它在说「照常吃」。给它一个
 * 底色,一屏四行就是四块颜色,反而看不出哪几行要留意。它用的是 `Tag` 组件
 * 那个「未选中」态**同一对类名**(`ui/index.tsx`),不是新配的一对灰。
 *
 * `blocked`(撞上档案忌口)比 `limit` 更硬,而且**出处完全不同**(档案,不是
 * 指南),所以走 danger 那一套而不是 warn:页面上 danger 一直的含义就是
 * 「和你档案冲突」。
 */
const AMOUNT_TONES: Record<AmountTone, string> = {
  recommend: 'bg-brand-bg text-brand-text',
  moderate: 'bg-black/[0.05] text-muted',
  limit: 'bg-warn-bg text-warn-text',
  blocked: 'bg-danger-bg text-danger-text',
}

/**
 * 「怎么吃」那一行**第二行**写什么 —— 按 `stance` 分三支,一字不少一字不多。
 *
 * ⚠️ **这两句话刻意写在渲染层,不写进 `eatingPlan.ts`。** 事实(「这一行没有档」)
 * 是数据,归那个 store;**话怎么说**归屏幕 —— 和这句空态「这一餐各项都在目标
 * 区间内」、和卡底那两条脚注待在同一层,是同一个分工。纯逻辑那边断的是
 * `stance.kind`,这里断的是屏幕上这两行字。
 *
 * 库内菜那一支的「· 」是这一层拼的(`note` 缺席时连它也不画,判据是
 * `note === undefined` 而不是空串 —— 见 `eatingPlan.ts`)。
 *
 * 「按你确认的分量」这句是核过的:能走到这个分支的菜一定是 `web:` 项,而 `web:`
 * 项**算得出营养**(`countableItems` 认它),所以 `AnalyzingScreen` 必然把用户
 * 送去过「确认分量」那一屏(那一屏上它有和库内菜一样的三档控件),克数是他自己
 * 过手选的。跳过那一屏只有一种情形 —— 一道可称的菜都没有 —— 而那一屏上
 * `hasItems` 是假的,这张卡整个不渲染。
 */
function rowLine(row: PlanRow): string {
  if (row.stance.kind === 'web') return '联网估算 · 按你确认的分量'
  if (row.stance.kind === 'unknown') return '不在食物库里 · 按 0 计'
  return row.note === undefined ? row.stance.amount : `${row.note} · ${row.stance.amount}`
}

/**
 * 单餐占全天配额多少算「多」。
 * 三餐均分是 1/3;超过这个比例就值得在这一餐的卡片上标红。
 */
const FAIR_SHARE = 1 / 3

/**
 * 分析结果 —— 对应 Figma「③ 界面原型 / 05 · 分析结果 Result」。
 *
 * 内容实际高度约 1200pt,远超视口高度,所以必须真实滚动
 * (设计改动说明里特意标注了这一点)。
 *
 * 页面上的每一个数字都来自上一屏识别出的那几道菜,再对照**当前档案**的配额算出来。
 * 所以「归档到膳食日记」不是一句空话 —— 它真的会往 store 里写一条记录,
 * 首页与日记随之改变。
 */
export default function ResultScreen() {
  const navigate = useNavigate()
  const state = useAppState()
  const [fixing, setFixing] = useState(false)

  // 识别结果只存在内存里,刷新就会丢 —— 丢了给一个明确的空状态,而不是白屏
  const pending = useSyncExternalStore(subscribePending, getPending, getPending)
  /*
    预稿还是终稿 —— 只有那一行报警的措辞不一样,别拿它去藏数字。

    预稿期间库外菜的营养还在联网查,那几道**确实**按 0 计了(它们还没有
    per100g),所以这个态不能说成「没有这回事」;但也不能沿用终稿那句
    「不在食物库里」—— 那是另一件事,说的是查完了也没有。
  */
  const plateJob = useSyncExternalStore(subscribePlateJob, getPlateJob, getPlateJob)
  const provisional = plateJob.provisional === true

  const q = state.profile.quota

  const items = useMemo(() => pending?.items ?? [], [pending])
  const n = useMemo(() => nutritionOfItems(items), [items])
  /**
   * 「怎么吃」那张卡的全部内容 —— 一行一道菜(顺序 + 份量)、挂到行上的建议、
   * 留在卡尾的整餐级建议。规则在 `store/eatingPlan.ts`,它只负责**摆放**:
   * 行的来源是 `deriveEatingAmount`、顺序说明来自 `deriveEatingOrder`、
   * 建议来自 `deriveAdvice`。
   *
   * ⚠️ 原来这里是三个 memo(`advice` / `order` / `amount`)对应三张卡。并成一张
   * 卡之后它们必然要一起算 —— 分成三个 memo 反而会让人以为可以各画各的,而
   * 「建议挂在哪一行上」正是**由行本身决定**的,那两半不能分开算。
   */
  const plan = useMemo(() => deriveEatingPlan(items, state.profile), [items, state.profile])

  /**
   * 有**能算出营养**的菜品 —— 结论/营养/建议三张卡和「归档」按钮都以它为准。
   *
   * 不能只看 `items.length > 0`:`matchDishes` 会把没匹配上的菜也放进 items
   * (带 `unmatched:` 哨兵 id、克数 0),这是为了让用户在修正面板里看得见它。
   * 但它在食物库里没有对应项,营养按 0 算 —— 全都没匹配上时,items 非空而
   * 每一项都是 0,于是会渲染出一张「本餐总热量 0 kcal,占每日 0%」的绿色结论卡,
   * 还有一张六项全是 0 的营养卡。那不是数据,是空壳。
   *
   * 判据本身在 `dishMatch.countableItems` —— 这里以前自己写了一行同义的
   * filter,而「哪些菜算得出营养」有两个定义就是上一轮那个 bug 的成因
   * (分析中页也要用同一个判据决定跳不跳「确认分量」)。
   */
  const countable = useMemo(() => countableItems(items), [items])
  const hasItems = countable.length > 0

  /**
   * 联网估算的出处说明 —— 没有这样的菜时是 `null`,整行不渲染。
   *
   * 名字和出处都从条目上现取(`MealItem.source` 是**落盘**的,不是渲染时才查的),
   * 所以归档之后日记页、首页合计都还有据可依 —— 出处不会在这一屏之后消失。
   *
   * 「哪几道菜」用条目自己的 `name`:那是模型说的菜名,和上面每行显示的是同一个。
   * 出处去重后按出现顺序列出 —— 两道菜来自同一个网页时不该写成「薄荷健康、薄荷健康」。
   */
  const webNote = useMemo(() => {
    const web = items.filter((i) => isWebId(i.foodId))
    if (web.length === 0) return null
    // 这个 filter 只为把类型收窄,不改变显示:按构造 `source` 一定有
    // (见 dishMatch 的 web 分支 —— 两个键同生共死)。即便真的缺了,
    // 那句话也只是少一个括号,不会说出一个错的出处。
    const sources = [...new Set(web.map((i) => i.source).filter((s): s is string => Boolean(s)))]
    const names = web.map((i) => `「${i.name}」`).join('')
    const from = sources.length > 0 ? `（${sources.join('、')}）` : ''
    return `${names}的营养值来自联网检索${from}，非食物库数据，口径与食物库一致（每 100g、熟食、可食部），仅供参考。`
  }, [items])

  /** 六项营养对照全天配额 —— 用的是「这一餐占全天多少」的口径 */
  const rows = useMemo(
    () => [
      { label: '热量', value: Math.round(n.kcal), unit: 'kcal', limit: q.kcal, lowerIsBetter: false },
      { label: '钠', value: Math.round(n.sodium), unit: 'mg', limit: q.sodium, lowerIsBetter: true },
      { label: '蛋白质', value: Math.round(n.protein), unit: 'g', limit: q.protein, lowerIsBetter: false },
      { label: '碳水', value: Math.round(n.carb), unit: 'g', limit: q.carb, lowerIsBetter: false },
      { label: '脂肪', value: Math.round(n.fat), unit: 'g', limit: q.fat, lowerIsBetter: false },
      { label: '添加糖', value: Math.round(n.sugar), unit: 'g', limit: q.sugar, lowerIsBetter: true },
    ],
    [n, q]
  )

  /** 结论卡文案 —— 哪一项最突出就说哪一项 */
  const conclusion = useMemo(() => {
    if (!hasItems) return { headline: '', body: '' }

    const pct = (v: number, limit: number) => Math.round((v / limit) * 100)
    const headline = `本餐总热量 ${Math.round(n.kcal)} kcal，占每日 ${pct(n.kcal, q.kcal)}%`

    const sodiumPct = pct(n.sodium, q.sodium)
    const sugarPct = pct(n.sugar, q.sugar)
    const proteinPct = pct(n.protein, q.protein)

    let body: string
    if (n.sodium / q.sodium >= FAIR_SHARE) {
      body = `钠摄入 ${Math.round(n.sodium)}mg，已达全天上限的 ${sodiumPct}%。建议下一餐以清蒸、白灼代替红烧，并搭配一份高钾蔬菜。`
    } else if (n.sugar / q.sugar >= 0.5) {
      body = `添加糖 ${Math.round(n.sugar)}g，占全天建议上限 ${sugarPct}%。添加糖指加工时额外加入的糖，水果里的果糖不计入其中。`
    } else if (n.protein / q.protein < 0.25) {
      body = `蛋白质 ${Math.round(n.protein)}g，只占全天目标的 ${proteinPct}%。这一餐偏素，可以补一份鸡蛋、豆腐或酸奶。`
    } else {
      body = `钠占全天上限的 ${sodiumPct}%，蛋白质达目标的 ${proteinPct}%。各项都在合理区间，这一餐的控制不错。`
    }
    return { headline, body }
  }, [hasItems, n, q])

  /** 归档 —— 真的写进 store,然后去日记页看结果 */
  const archive = () => {
    // 和上面那张按钮的显示条件**用同一个判断**:按钮只在 hasItems 时出现,
    // 这里的守卫是防「条件改了、按钮还在」那道缝,不是重复判断
    if (!pending || !hasItems) return
    addMeal({
      slot: pending.slot,
      items: pending.items,
      source: '拍餐盘',
      // 缩略图只在真实识别时才有(降级那次刻意不带,见 plate.ts)
      ...(pending.thumbDataUrl ? { thumb: pending.thumbDataUrl } : {}),
    })
    setPending(null)
    // 归档完成,那张预览图不会再被任何地方用到 —— 从事件处理器里释放,
    // 不是从 useEffect 的 cleanup 里(StrictMode 会立刻跑一次 cleanup,
    // 图还挂在屏幕上就被撤销了)
    releasePlatePreview()
    navigate('/diary')
  }

  /* ---------- 配料表 / 包装:没有菜,但配料和建议本身就是全部内容 ---------- */
  /*
    ⚠️ **没有菜不等于没结果(2026-09-23)。**

    用户拍的是配料表或包装时,模型会把配料、每 100g 的数值、还有针对他档案的
    建议都读出来,只是 `dishes` 是空的。以前 App 直接判「没认出菜品」报错;
    上一轮改成「照常出结果」之后,屏幕上出现了一张**全是 0 的营养卡** ——
    那比报错更糟:一页 0 看起来像算错了。

    正确的渲染在这里:和过敏拦截同一套 —— **复用对话页那张回复卡**。
    `agentReply` 里就有模型读到的全部内容(配料清单、标签数值、建议),
    餐盘卡那一套(菜品行、顺序、份量、整餐营养合计)在这一趟里**不成立**,
    因为这一趟根本没有「这一餐」。
  */
  if (
    pending &&
    pending.agentReply &&
    !pending.agentReply.blocked &&
    pending.items.length === 0 &&
    (pending.agentReply.ingredients.length > 0 || pending.agentReply.advice.length > 0)
  ) {
    return (
      <Screen tabBar={false}>
        <NavBar backLabel="返回首页" onBack={() => navigate('/')} right="分析结果" />
        <div className="flex flex-col gap-3 px-5 pt-3">
          <AgentReplyCard reply={pending.agentReply} />
        </div>
      </Screen>
    )
  }

  /* ---------- 过敏拦截:没有菜品可展示,风险信息本身就是全部内容 ---------- */
  if (pending?.agentReply?.blocked) {
    return (
      <Screen tabBar={false}>
        <NavBar backLabel="返回首页" onBack={() => navigate('/')} right="分析结果" />
        <div className="flex flex-col gap-3 px-5 pt-3">
          {/*
            复用对话页那张卡片,而不是另写一套拦截界面 —— 同一件事有两个实现,
            早晚会在配色和文案上分叉。agentReply 就是原始解析结果,直接传
          */}
          <AgentReplyCard reply={pending.agentReply} />

          {/*
            指路必须指到**真的能改**的地方。

            这里原来写的是「可以到「我的」里调整忌口设置」—— 而「我的」那一页
            只有账户、关于、隐私这些,一个忌口编辑入口都没有。一块指向不存在的
            地方的牌子比不写还糟:用户会照着走过去,然后在一个没有那件东西的
            页面上找。

            忌口真正能改的地方是**档案页**里那两个入口(过敏与用药 / 忌口),
            入口行的名字和面板标题是同一份,所以这里写的是它们。
            (⚠️ 饮食侧那个入口一天之内更过三次名:「忌口与偏好」→「忌口」→
            「忌口与不爱吃」→ 又回到「忌口」,每一次这里都跟着改了 —— 指路牌指的
            名字必须和它指的那一行**逐字相同**,否则就是把用户送去找一个已经
            不存在的东西。)
          */}
          <p className="px-2.5 text-[12px] leading-[17.38px] text-faint">
            这条餐盘里检出了与「{state.profile.name}」忌口冲突的食材，已拦截。
            如果你确认配料与档案不符，可以到「健康档案」里的「过敏与用药」或「忌口」调整。
          </p>

          <PrimaryButton icon="camera" onClick={() => navigate('/', { replace: true })}>
            重新拍一张
          </PrimaryButton>
        </div>
      </Screen>
    )
  }

  /* ---------- 空状态:直接刷新结果页会走到这里 ---------- */
  if (!pending) {
    return (
      <Screen tabBar={false}>
        <NavBar backLabel="返回首页" onBack={() => navigate('/')} right="分析结果" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <IconTile name="camera" size={64} radius={14} tone="brand" iconSize={28} />
          <p className="text-[16px] leading-[22px] font-medium text-ink">还没有待归档的分析</p>
          <p className="text-[13px] leading-[19px] text-muted">
            回到首页点「拍餐盘」，识别完成后的结果会出现在这里。
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-1 text-[15px] leading-[21px] font-medium text-brand-deep active:opacity-60"
          >
            回首页拍一餐
          </button>
        </div>
      </Screen>
    )
  }

  /**
   * 菜品卡的头部标签 —— 三种情形,不能混成一句:
   *
   *   · `noDishReason`     → 模型看过这张图,是它没认出菜(图里可能就不是吃的)
   *   · `portionConfirmed` → 用户走过「确认分量」,克数是他自己选的
   *   · 其余               → 这一步被**跳过**了(认出的菜一律没查到营养:既不在
   *                          食物库里、也没联网查到),克数是食物库的常见分量。
   *                          这里要是写「分量由你选择」,就是在说一件没发生过的事
   */
  const dishHeader = pending.noDishReason
    ? '这次没识别出菜品'
    : pending.portionConfirmed
      ? '识别菜品 · 分量由你选择'
      : '识别菜品 · 可修正'

  return (
    <Screen tabBar={false}>
      <NavBar
        backLabel="返回首页"
        onBack={() => navigate('/')}
        right={`${pending.slot} · ${formatTime(new Date())}`}
      />

      <div className="flex flex-col gap-3 px-5 pt-3">
        {/*
          降级说明 —— 放在最上面,而不是缩在角落一行小字里。
          下面这些数字全部是本地随机组的,和那张照片没有关系;
          不说清楚就等于把编出来的营养数据当成识别结果交给用户。
          「确认分量」那一屏挂的是同一个组件、同一份文案
        */}
        {pending.degradedReason && <DemoDataBanner reason={pending.degradedReason} />}

        {/* ---------- 结论卡 ---------- */}
        {/* 没有可计量的菜品时整段跳过 —— 一张写着「本餐总热量 0 kcal」的
            绿色结论卡比不显示更让人困惑 */}
        {hasItems && (
        <div className="flex items-start gap-3 rounded-[20px] border border-brand-line bg-brand-bg p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white">
            <Icon name="shieldCheck" size={20} strokeWidth={2} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[15px] leading-[18px] font-bold text-ink">{conclusion.headline}</span>
            <span className="text-[13px] leading-[18.82px] text-ink-body">{conclusion.body}</span>
          </div>
        </div>
        )}

        {/* ---------- 菜品卡 ---------- */}
        <Card>
          <div className="flex items-center gap-3 px-4 pt-3.5 pb-2">
            {/*
              用户拍的那张缩略图。只在实际走了视觉模型时显示 ——
              降级那次刻意不显示(见 plate.ts 里的说明):
              把照片摆在编出来的菜品旁边,等于暗示这个因果关系
            */}
            {pending.engine === 'agent' && pending.photoUrl && (
              <IconTile name="camera" size={40} radius={12} tone="brand" src={pending.photoUrl} />
            )}

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] leading-[15.6px] font-medium text-muted">{dishHeader}</span>
              <EngineBadge confidence={pending.confidence} engine={pending.engine} />
            </div>
          </div>

          {pending.unmatched && pending.unmatched.length > 0 && (
            <div className="mx-4 mb-2 rounded-[12px] bg-warn-bg px-3 py-2">
              <span className="text-[12px] leading-[17.38px] text-warn-body">
                {provisional ? (
                  <>
                    这几项的营养还在联网查：{pending.unmatched.join('、')}
                    。查回来之前它们按 0 计，所以这一餐的热量和健康分现在偏低。
                  </>
                ) : (
                  <>
                    这 {pending.unmatched.length} 项不在食物库里，暂时按 0 计：
                    {pending.unmatched.join('、')}。点下面「返回调整」回到上一屏，可以换成库里的相近菜品，
                    否则这一餐的热量和健康分会偏低。
                  </>
                )}
              </span>
            </div>
          )}

          {/*
            菜品行搬到 `DishRow` 了 —— 这段标记原来在本文件和对话里那张结果卡里
            **逐字节相同**地写了两遍,而「补记」那张弹窗会是第三份。
            为什么这一行值得一个组件,见 `DishRow.tsx` 文件头。
          */}
          {pending.items.map((dish, i) => (
            <DishRow key={`${dish.foodId}-${i}`} dish={dish} divider={i > 0} />
          ))}

          {/*
            ⚠️ **这一行原来叫「调整分量或增删菜品」,2026-09-23 换成了「返回调整」。**

            原来它是编辑入口,点的却是 `setFixing(true)` —— 和下面那颗主按钮打开的
            是**同一个** `MealSheet`。两个入口通一个面板,那是重复。

            而 `MealSheet` 不只是编辑器:保存时它自己调 `addMeal`,也就是**把这一餐
            记进日记**。所以它天然属于「归档前确认一下」那一步 —— 也就是主按钮。
            这一行挂在这里,用户会以为那只是个编辑按钮,按下去却顺手把这一餐归档了。

            改菜品这件事的归属现在是:

              · **分量**(少/常规/多) → 上一屏「确认分量」,那里才是「这一餐是什么」的阶段
              · **增删菜品 / 改克数** → 主按钮那一步(归档前),那个面板本来就在那儿

            这一行留着的作用只剩**导航**:识别看错了,回上一屏改。
          */}
          <button
            onClick={() => navigate('/portion')}
            className="flex h-12 w-full items-center justify-center gap-1.5 border-t border-line text-[14px] leading-[20px] font-medium text-brand-deep active:opacity-60"
          >
            <Icon name="sliders" size={16} strokeWidth={2.2} />
            返回调整
          </button>
        </Card>

        {/* ---------- 怎么吃卡(顺序 + 份量 + 建议) ---------- */}
        {/*
          夹在菜品卡和营养卡中间 —— 先看「这一盘是什么」,再看「这一桌怎么吃」,
          最后才看数字。

          ## 原来这里是三张卡,现在是一张

          顺序卡说次序、多少卡说份量 —— 两张卡列的是**同一盘菜、同一个序号**,
          却硬生生分在两处;建议卡压在最下面,它说「主要来自『红烧排骨』」的时候,
          那道菜已经在上面两屏之外了。用户的原话是「可以在推荐某道菜顺序的时候
          顺便推荐这道菜进食多少的建议」。合并的规则在 `store/eatingPlan.ts`。

          ## 守卫取三张卡里**最宽**的那个:`hasItems`

          原来:顺序卡 `order.length > 0`、多少卡 `amount.length > 0`、建议卡
          `hasItems`。并集是**对的**:一桌全是认不出来的菜时,`rows` 空着而卡尾
          照样可能挂着建议(「这一餐没有蔬菜」那类说的是整餐的构成,不需要任何
          一道菜认得出来)。

          ⚠️ 「能进那张卡的菜必然算得出营养」这个蕴含关系**今天不再成立**了 ——
          库外菜(联网估算 / 哨兵项)也有一行,而哨兵项营养按 0 计。所以这条守卫
          不是「三者取最宽」推出来的,是**它自己**:算得出营养的菜 ≥ 1。

          于是有一条**刻意的例外**:**一屏全是哨兵项时整张卡不出现**,尽管那时
          `rows` 非空(每道菜都有行)。它和结论卡 / 营养卡 / 归档按钮同一个判据,
          那一屏走的是另一套:页面明说「识别出的菜品都不在食物库里,没法估算营养」
          并给出路。「菜品卡几道 → 这张卡几行」这条不变量**只在卡出现时成立**。

          ⚠️ `rows` 空的时候**不画那个 `<ol>`** —— 一个空的 `<ol>` 会白占一段
          `gap` 的高度,而 `pb-3` 又跟着走。

          ## 一行克数都没有

          用户的原话是「不要说多少 g 这种用户无法准确衡量的内容」。量词出自
          《中国居民膳食指南》附录一的参考手势,中间不过克数 —— 拿一个不准的克数
          去换算成「四五个」,是把假精确洗成一句看着很确定的话。想「补得更准」的人
          先读 `data/guideline.ts` 的文件头。
        */}
        {hasItems && (
        <Card>
          <div className="px-4 pt-3.5 pb-2">
            <span className="text-[13px] leading-[15.6px] font-medium text-muted">
              怎么吃 · 基于「{state.profile.name}」
            </span>
          </div>

          {/*
            用 `<ol>` 而不是 `<div>`:这里的序号是**真正的次序**,顺序反了这张卡
            就是错的。对话页那张建议卡里的「1、2、3」只是计数(几条建议之间没有
            先后),所以那边用的是 `<div>` —— 两边各自都对。
            (做法步骤那一列用的也是 `<ol>`,同一种东西同一种写法。)

            ⚠️ **`<li>` 里不许出现 `rounded-[20px] bg-card` 这一对** ——
            `scripts/verify-render.mjs` 的 `slicesOf` 正是按那一对切卡的,在这里
            出现会让一张卡被切成两张,而那约二十条断言会以「没切到这张卡」的样子
            红,看着和改动毫无关系。建议块用的是 `rounded-[14px]`。
          */}
          {plan.rows.length > 0 && (
          <ol className="flex flex-col gap-2.5 px-4 pb-3">
            {plan.rows.map((row, i) => (
              <li key={`${row.name}-${i}`} className="flex items-start gap-2.5">
                <NumberBadge>{i + 1}</NumberBadge>
                {/*
                  ⚠️ 这一列是 `<div>` 不是 `<span>` —— 下面挂的建议块是个块级
                  元素,而 `<span>` 里放块级元素是无效 HTML(SSR 那套冒烟测试
                  照样跑得动,浏览器里才会报)。`<li>` 里放 `<div>` 是合法的。
                */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[15px] leading-[22px] text-ink">{row.name}</span>
                    {/*
                      态度胶囊。字号跟全 App 的说明文字同一档(11px),形状跟
                      `Tag` 那个胶囊同一族 —— 它是个**标签**,不是按钮。
                      `shrink-0`:菜名先截断,别把这两个字挤掉。

                      ⚠️ **只在库内菜那一支出**(`stance.kind === 'guideline'`)。
                      库外菜没有档 —— 指南那张表查不到它,「多吃/适量吃」是**编**不
                      出来的。宁可这一行空着,也不给它安一个不是查出来的档。
                    */}
                    {row.stance.kind === 'guideline' && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-[15.93px] font-medium ${AMOUNT_TONES[row.stance.tone]}`}
                      >
                        {row.stance.tag}
                      </span>
                    )}
                  </span>
                  {/*
                    第二行 = **顺序 · 份量**。顺序缺席时只剩份量,连那个「· 」也
                    不画 —— 判据是 `note === undefined`,不是空串(food 库里那
                    一层保证不写空串,见 `eatingPlan.ts`)。

                    ⚠️ 单档那一盘(米饭 + 馒头)**两行都在**,只是都没有顺序说明。
                    在「进食顺序」那张卡上它整张不出现(`eatingOrder.ts` 说那两行
                    是噪音——它说的是「没有**顺序**」);而这里的每一行主语是
                    「**吃多少**」,所以照样出。见 `eatingPlan.ts` 文件头。

                    库外菜那一支写的是**它的出处**(联网估算 / 不在食物库里),
                    不是量 —— 那句话归 `rowLine()`,理由写在它上面。
                  */}
                  <span className="text-[13px] leading-[18px] text-muted">{rowLine(row)}</span>
                  {/*
                    指名了**这一道菜**的建议就挂在这一行下面 —— 建议块嵌在 `li`
                    的菜名那一列里,所以天然缩进一个序号位,看得出它属于哪一行。
                    次序跟着 `deriveAdvice` 的严重程度走(见 `eatingPlan.ts`)。

                    间距由这层 `div` 出(`gap-2.5` + `pt-2.5`),`AdviceBlock`
                    自己不带外边距 —— 卡尾那一摞用的是**同一个** `gap-2.5`,
                    两处间距一致。
                  */}
                  {row.attached.length > 0 && (
                    <div className="flex flex-col gap-2.5 pt-2.5">
                      {row.attached.map((a) => (
                        <AdviceBlock key={a.title} a={a} />
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          )}

          {/*
            卡尾 —— **整餐级**的建议(「这一餐没有蔬菜或水果」「蛋白质偏少」),
            外加「指名了但挂不上」的那些(库外菜进不了行,见 `eatingPlan.ts`)。

            隔着一条细分隔线:上面是逐道菜的话,从这里开始是**对这一餐整体**的话。
          */}
          {plan.tail.length > 0 && (
            <div className={`mx-4 flex flex-col gap-2.5 pb-4 ${plan.rows.length > 0 ? 'border-t border-line pt-3' : ''}`}>
              {plan.tail.map((a) => (
                <AdviceBlock key={a.title} a={a} />
              ))}
            </div>
          )}

          {/*
            一条建议都没有 —— 这句原来是建议卡的空态,跟着那张卡搬过来。
            判据是 `plan.hasAdvice`(从**落位结果**数出来的:挂行的 + 卡尾的),
            不是「`deriveAdvice` 返回了空数组」。两者今天必然相等,但按落位数更不
            容易撒谎:真出了 bug 让一条建议凭空消失,这句话就该出现。
          */}
          {!plan.hasAdvice && (
            <p className="px-4 pb-4 text-[13px] leading-[19px] text-muted">
              这一餐各项都在目标区间内，没有需要特别提醒的地方。
            </p>
          )}

          {/*
            ## 两条脚注,次序照旧,各自留着自己的出处

            ⚠️ **不许合并。** 两段话的署名范围都是逐句核过的:顺序那条只把「菜和肉
            摆在主食前面」半句署给两份食养指南(「餐前喝汤」不在那两份里,是卫健系统
            的科普口径,出处写在 `store/eatingOrder.ts` 的文件头);份量那条署
            《中国居民膳食指南》附录一 + 准则三、四、五。合成一段就是把两段的出处
            混在一起 —— 那正是 `eatingOrder.ts` 反复警告的「引用比依据**大**」。
          */}
          {/*
            顺序那条只在**真的说了顺序**时才出现(判据 = 至少有一行带 `note`)。
            这一盘没有顺序可言的时候署那两份指南,就是「屏上一个字没提顺序,脚注
            却把顺序记在指南名下」。单档那一盘(米饭 + 馒头)走的就是这一支。
          */}
          {plan.rows.some((r) => r.note !== undefined) && (
            <div className="pb-3.5">
              <Footnote>
                先喝汤，再吃菜和肉，把主食留到最后，餐后血糖会更平缓。菜和肉摆在主食前面，是《成人糖尿病食养指南》和《成人肥胖食养指南》的建议。
              </Footnote>
            </div>
          )}

          {/*
            份量那条的条件是「**至少有一行带量词**」。
            ⚠️ 判据**不能**是「有行」:库外菜也有行之后,一屏全是联网估算的菜时
            `rows.length > 0` 为真,而屏上一个量词都没有 —— 署它就是把
            「一捧量蔬菜、一个掌心量肉…」记在一句屏上根本不存在的话名下
            (`eatingPlan.ts` 和 `eatingOrder.ts` 反复警告的「引用比依据**大**」)。
            这和上面那条同源:两条脚注都只在**它说的那件事真的出现在屏上**时才画。
          */}
          {plan.rows.some((r) => r.stance.kind === 'guideline') && (
            <div className="pb-3.5">
              <Footnote>
                一捧量蔬菜、一个掌心量肉、一小碗量主食 —— 量词出自《中国居民膳食指南》附录一的参考手势；多吃、适量吃、少吃按同一份指南的准则三、四、五。
              </Footnote>
            </div>
          )}
        </Card>
        )}

        {/* ---------- 营养卡 ---------- */}
        {hasItems && (
        <Card>
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
            <span className="text-[13px] leading-[15.6px] font-medium text-muted">本餐营养 · 对照全天配额</span>
            <span className="text-[11px] leading-[15.6px] text-faint">每餐合理占比约 33%</span>
          </div>

          {rows.map((row) => {
            const pct = (row.value / row.limit) * 100
            // 「越低越好」的项超过合理占比才标红 —— 热量吃到 40% 不算错,
            // 但钠吃到 40% 就已经把后面两餐的余量吃掉了
            const over = row.lowerIsBetter && pct / 100 > FAIR_SHARE
            return (
              <div key={row.label} className="flex flex-col gap-[7px] px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] leading-[18px] text-ink">{row.label}</span>
                  <span className="flex items-baseline gap-1.5">
                    <span
                      className={`tnum text-[13px] leading-[15.6px] font-medium ${over ? 'text-danger' : 'text-ink'}`}
                    >
                      {row.value} {row.unit}
                    </span>
                    <span className={`tnum text-[11px] leading-[15.6px] ${over ? 'text-danger' : 'text-faint'}`}>
                      占全天 {Math.round(pct)}%
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-[4px] bg-brand-bg">
                  <div
                    className={`h-full rounded-[4px] ${over ? 'bg-danger' : 'bg-brand'}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
            )
          })}
          <div className="h-3" />
        </Card>
        )}

        {/* ---------- 主按钮 ---------- */}
        {/*
          **一道有营养来源的菜都没有**时不能给「归档」按钮 —— `archive()` 会在
          `!hasItems` 处直接 return,按钮点下去**什么都不发生**,而且没有任何解释。
          这种"点了没反应"比报错更难查。

          注意判据是 `hasItems`(= `countable.length > 0`),**不是** `items.length`:
          下面那支文案说的「都不在食物库里」只覆盖了哨兵项,而联网查到营养的库外菜
          同样「不在食物库里」却**该**走归档那条路 —— 它有真实的营养值。
          两者的分界由前缀决定(`unmatched:` / `web:`),见 dishMatch。

          改成唯一的出路:打开记录面板,让用户从食物库里挑。
        */}
        {hasItems ? (
          <PrimaryButton icon="check" onClick={archive}>
            归档到膳食日记
          </PrimaryButton>
        ) : (
          <>
            <div className="rounded-[14px] border border-warn-line bg-warn-bg px-3.5 py-3">
              <span className="text-[12px] leading-[17.38px] text-warn-body">
                {/*
                  两种「没有可计量的菜」,原因完全不同,不能共用一句文案:
                  · noDishReason   → 模型看过这张图了,是它没认出菜(图里可能就不是吃的)
                  · 其余           → 认出来了,但既不在食物库里、也没联网查到营养
                  写成同一句话会把「重拍一张」和「手动挑一个」混在一起,
                  而这两条路该走哪条,恰好取决于上面这个区别。

                  ⚠️ 第二句的「不在食物库里」**不够精确,但在这里是对的**:
                  能走到这一支说明 `countable` 是空的 —— 也就是没有任何一项带
                  `web:` 前缀(那种菜食物库里没有、却算得出营养,走的是上面归档
                  那条路)。所以在这句话里「不在食物库里」等于「一点营养都算不出」。
                  改这句文案之前先确认那个等价关系还成立。
                */}
                {pending.noDishReason ? (
                  <>
                    <b className="font-semibold">这张图里没认出菜品。</b>
                    模型的回答是「{pending.noDishReason}」。可以重新拍一张，
                    或者从食物库手动记下这一餐。
                  </>
                ) : (
                  <>识别出的菜品都不在食物库里，没法估算营养。从库里挑相近的菜品记下这一餐吧。</>
                )}
              </span>
            </div>
            <PrimaryButton icon="sliders" onClick={() => setFixing(true)}>
              从食物库记下这一餐
            </PrimaryButton>
            {pending.noDishReason && (
              <PrimaryButton icon="camera" onClick={() => navigate('/', { replace: true })}>
                重新拍一张
              </PrimaryButton>
            )}
          </>
        )}

        {/*
          数据来源说明 —— 只在**真有联网估算的菜**时出现。

          为什么必须有这条:行内那句「· 联网估算」只说出了「这不是库里的数」,
          说不出「那它是哪来的」。而这个 App 对食物库那份数据的信任建立在
          「同一把尺子量出来的」之上 —— 一条检索来的值如果不说出处,用户没有
          任何办法判断该不该信它,只能默认它和库里那些一样可靠。

          ⚠️ 用页面级的细字串(`px-2.5 text-[12px]`),**不是** `Footnote` 组件。
          `Footnote` 是 px-4 / 11px,它的调用点**全部在 `Card` 内部**(本页那张
          进食顺序卡的引用就是其中一处)—— 在页面这一层用它会比下面那条免责声明
          多缩进 6px,两行并排就是错开的。
          「哪一行该用哪个」的判据是**在卡片里还是页面根下**,不是字号偏好。

          (这里原来写的是「它的**两个**调用点」,而那个数字早就不是 2 了。
          数个数没有意义、还会继续变旧,所以只留那条判据。)
        */}
        {webNote && (
          <p className="px-2.5 text-[12px] leading-[17.38px] text-faint">{webNote}</p>
        )}

        {/* ---------- 免责声明 ---------- */}
        <p className="px-2.5 text-[12px] leading-[17.38px] text-faint">
          本建议仅供参考，不构成医疗诊断或治疗意见。如有健康问题请咨询专业医生。
        </p>

        {/* 底部留白 —— 给滚动留余量,滚到底不被 Home Indicator 压住 */}
        <div className="h-6" />
      </div>

      {/* 修正分量 —— 复用记录面板,预填识别结果 */}
      <MealSheet
        open={fixing}
        onClose={() => setFixing(false)}
        initial={pending.items}
        initialSlot={pending.slot}
        source="拍餐盘"
        // 这条路径也必须带上缩略图 —— 面板是自己调 addMeal 的,
        // 不传的话用户一改分量照片就没了
        initialThumb={pending.thumbDataUrl}
        onSaved={() => {
          setPending(null)
          releasePlatePreview()
          navigate('/diary')
        }}
      />
    </Screen>
  )
}

/**
 * 一条建议 —— 图标 + 标题 + 角标 + 正文。
 *
 * **挂到某一行上的和留在卡尾的都是这一个块**,不是两份长得像的标记。同一页同一
 * 层级只能有一种写法(这条规矩在这个仓库里被咬过不止一次)。两者的区别只在
 * **位置**:挂行的嵌在 `li` 的菜名那一列里(天然缩进一个序号位),卡尾的排在
 * 最后一行之后、隔着一条细分隔线。
 *
 * ⚠️ 外边距**不在这个块上**,由调用方那层 `flex flex-col gap-2.5` 出 ——
 * 见卡尾那段注释。
 *
 * ## 角标 =「这条建议是照档案里哪一条说的」
 *
 * 由 `deriveAdvice` 逐条给,没给就不画(蔬菜那条引的是指南,正文里已经指名道姓
 * 了)。角标上就是**出处那个词**:「高血压」「膳食指南」「基础信息」「你手动设的」,
 * 忌口那条是「花生过敏」。**不带「依据 · 」前缀** —— 那个前缀是上一版那块白底
 * 引文块的,用户的原话是「这个高血压可以做个角标放右上角,让人一眼就能看出这是
 * 根据高血压来给的建议」,他明确接受「1500mg」从这一屏上消失。
 *
 * ⚠️ 代价:值那一半(「→ 钠上限 1500mg」)现在只印在档案页的「这些数字为什么是
 * 这样」。想核对那个数的人去档案页,别在这儿加回来。
 *
 * ## 为什么不用 `absolute -top-1 -right-1` 压在角上
 *
 * 仓库里唯一的先例是 `AttachmentStrip.tsx` 那颗删除角标,它压在**尺寸固定**的
 * 56×56 图上。这里的角标宽度是变的(「高血压」3 字、「你手动设的」5 字、「花生
 * 过敏」4 字),绝对定位会压住标题,而右内边距得按最长那个词算 —— 标题那行就废了。
 *
 * 所以做成**标题行右侧的一个 `shrink-0` 胶囊**:`items-start` 让它始终贴着顶,
 * 标题折成两行时它还在右上角。颜色复用 `ADVICE_TONES[].basis` 那一对现成的
 * (`-line` 描边 + `-text` 强色,底是 `bg-card`)—— 一个色值都不新配。
 *
 * ⚠️ **没有 `self-stretch`**:那是通栏引文块的写法,胶囊要的是「宽度由字数决定」。
 */
function AdviceBlock({ a }: { a: Advice }) {
  const t = ADVICE_TONES[a.tone]
  return (
    <div className={`flex items-start gap-2.5 rounded-[14px] px-3.5 py-3 ${t.card}`}>
      <Icon name={a.icon} size={18} className={`mt-px shrink-0 ${t.icon}`} strokeWidth={2} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-start justify-between gap-2">
          <span className={`min-w-0 flex-1 text-[14px] leading-[16.8px] font-medium ${t.title}`}>{a.title}</span>
          {a.basis && (
            <span
              className={`mt-px shrink-0 rounded-full border bg-card px-2 py-0.5 text-[11px] leading-[15.93px] font-medium ${t.basis}`}
            >
              {a.basis}
            </span>
          )}
        </span>
        <span className={`text-[12px] leading-[17.38px] ${t.body}`}>{a.body}</span>
      </div>
    </div>
  )
}

/**
 * 识别来源标签。
 *
 * 这一行以前显示的是「置信度 87%」,而那个数字是
 * `0.82 + Math.random() * 0.14` —— 一个随机数。README 和代码注释都写明了
 * 识别是模拟的,唯独**用户看得见的那一屏**没说,而且用一个精确到个位的
 * 百分比把这件事包装得很可信。
 *
 * 现在的三种情形:
 *   · 有 confidence → 显示数字(留给以后真的返回置信度的模型)
 *   · engine='agent' → 显示「模型识别」,不编一个数
 *   · engine='demo'  → 明说「演示数据 · 非真实识别」
 */
function EngineBadge({ confidence, engine }: { confidence?: number; engine: 'demo' | 'agent' }) {
  if (confidence !== undefined) {
    return (
      <span className="tnum text-[12px] leading-[15.6px] text-faint">
        置信度 {Math.round(confidence * 100)}%
      </span>
    )
  }
  if (engine === 'agent') {
    return <span className="text-[12px] leading-[15.6px] font-medium text-brand-deep">模型识别</span>
  }
  return <span className="text-[12px] leading-[15.6px] font-medium text-warn">演示数据 · 非真实识别</span>
}
