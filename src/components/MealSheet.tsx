import { useEffect, useMemo, useState } from 'react'
import { CATEGORY_ORDER, FOODS, type Food } from '../data/foods'
import { formatRelativeDay } from '../lib/date'
import { isUnmatchedId, isWebId } from '../lib/dishMatch'
import { nutritionOfItem } from '../lib/nutrition'
import { SLOT_ROWS, currentSlot } from '../lib/slots'
import { entrySummary } from '../store/derive'
import { addMeal, deleteMeal, editMeal, mealEditIsDirty } from '../store/store'
import type { MealEntry, MealItem, MealSlot, MealSource } from '../store/types'
import { ConfirmSheet } from './ConfirmSheet'
import { Icon } from './Icons'
import { PrimaryButton, SegmentedControl, Stepper } from './ui'

/**
 * 记录一餐 / **修改一条记录** —— 底部面板。
 *
 * ⚠️ 这一屏**原型里没有**。Figma 稿是视觉设计,只画了"信息的呈现",
 * 没画"数据从哪来"。但没有录入界面,日记永远是空的、健康分永远不变,
 * 整个 App 就还是一套会动的设计稿。
 *
 * 所以这里新增了入口 —— 用底部面板而不是新建整屏,是为了不破坏原型的
 * 导航结构:它是一层浮在当前页之上的操作,和既有的 ActionSheet 同构。
 *
 * 视觉沿用设计系统:顶部圆角 24、#FAFAFC 底、抓手条、底部安全区。
 *
 * ------------------------------------------------------------
 * 同一个面板现在管两件事,**靠 `entry` 这个 prop 分岔**:
 *
 *   · 不传 `entry` → 创建(三个调用点:首页「手动记录」、日记「+ 记录一餐」、
 *     结果页「调整分量或增删菜品」)
 *   · 传 `entry`   → 修改那一条(只有日记列表点行这一处)
 *
 * 为什么复用而不是另写一个面板:要改的三样(餐次、菜品、分量)和要记的三样
 * **完全是同一套控件、同一套交互**,另写一个就是把这一整块再抄一遍,
 * 然后让两份在「未收录的哨兵项怎么办」这类细节上慢慢走散。
 */

interface MealSheetProps {
  open: boolean
  onClose: () => void
  /** 保存成功后回调,拿到那条记录(新建的 / 改完的) */
  onSaved?: (entry: MealEntry) => void
  /**
   * **草稿模式** —— 给了它(且没传 `entry`)时,保存**不碰 store**,
   * 把改好的清单原样交回调用方。
   *
   * 为什么需要它:「确认分量」那一页要能让用户改菜品(AI 认错了),可那一餐
   * **还没归档** —— 走默认那条路一保存就 `addMeal`,用户还没看过分析,这一餐
   * 就已经进日记了。所以给一个不落库的出口。
   *
   * 和 `onSaved` 的区别是**谁负责写入**:`onSaved` 之后记录已经在 store 里了
   * (面板自己写的);`onDraft` 之后什么都没发生,写不写、怎么写由调用方定。
   */
  onDraft?: (items: MealItem[], slot: MealSlot) => void
  /**
   * **要改的那一条** —— 传了就是编辑态,不传就是创建态。
   *
   * ⚠️ 它和下面那组 `initial*` **不要同时传**。两者都是「预填」,但来源和
   * 后果完全不同:`initial*` 是**草稿**(还没进 store,保存时才 addMeal),
   * `entry` 是**已经存在的一条**(保存时 editMeal 改它、删它也是删它)。
   * 同时传的话,「保存」到底是新建还是修改没有答案。
   */
  entry?: MealEntry
  /**
   * 预填的菜品 —— 用于「修正识别结果」:从结果页点「调整分量」进来时,
   * 带上刚才识别出的那几道菜,用户改分量而不是从头再选一遍。
   */
  initial?: MealItem[]
  /** 预填的餐次 */
  initialSlot?: MealSlot
  /** 记录来源。修正识别结果时仍是「拍餐盘」,手动补记才是「手动记录」 */
  source?: MealSource
  /**
   * 预填的缩略图(data URL)。
   *
   * ⚠️ 这条路径很容易漏:结果页点「调整分量或增删菜品」时,是**这个面板
   * 自己调 addMeal()** 的,不走结果页的 archive()。不把缩略图传进来的话,
   * 用户只要动一下分量,照片就没了 —— 而且日记里那条记录看起来完全正常,
   * 只是"少了一张图",几乎不会被发现。
   *
   * (编辑态**没有**这个问题,也不需要这个 prop:`editMeal` 的口径里
   * 根本没有 `thumb`,照片是结构上改不掉的。见 store.ts 的 MealEdit。)
   */
  initialThumb?: string
  /**
   * 这一餐**属于哪一天/哪个钟点**。不传 = 今天、此刻(`addMeal` 的默认值)。
   *
   * ⚠️ 存在的理由是**一条真实发生过的口径裂口**(2026-09-24):对话页的补记
   * 弹窗有两个出口,「记入日记」是**调用方**落盘(从草稿的 `at` 推日期钟点),
   * 而「调整分量再记」是**这个面板自己**调 `addMeal` 的 —— 它从前不传这两个
   * 字段,于是同一天的同一餐,走第一条记的是「昨天 12:30 拍的」,走第二条
   * 记的是「今天 08:00 点的保存」。草稿会在浏览器里过夜,这个差看得很清楚:
   * 弹窗上写着昨天,日记里写着今天,而那顿饭的数字记到了今天的头上。
   *
   * 别处不传(首页「手动记录」、日记「+ 记录一餐」、结果页「调整分量」)——
   * 那些都是**当下**记的,默认值正是对的。
   */
  date?: string
  /** 见 `date`。两个一起传,只传一个会得到「昨天 + 此刻」这种半对的时间 */
  time?: string
}

/** 分量的增减步长:小份食物(鸡蛋、零食)用 10g,正餐用 25g */
function stepFor(grams: number): number {
  return grams < 100 ? 10 : 25
}

/**
 * 分量的上下界。
 *
 * 下界 5g 原来写在 `changeGrams` 的 `Math.max(5, ...)` 里,上界**根本不存在**
 * (一直点 + 能点到几万克,那一餐的热量会变成一个天文数字)。
 * 1000g 不是拍的:它是 `portion.ts` 里「多量」那一档的上界,同一个 App 里
 * 不该有两套克数范围。挪到 `Stepper` 的 min/max 之后,到界的表现是按钮变灰,
 * 而不是点着没反应。
 */
const MIN_GRAMS = 5
const MAX_GRAMS = 1000

export function MealSheet({
  open,
  onClose,
  onSaved,
  onDraft,
  entry,
  initial,
  initialSlot,
  source = '手动记录',
  initialThumb,
  date,
  time,
}: MealSheetProps) {
  const editing = entry !== undefined

  // 默认选中「现在该记的那一餐」(只看钟点,见 lib/slots.ts 的 currentSlot)。
  // 它原来是本文件里的一份 `inferSlot`,和 recognize.ts 的 `currentSlot` 是同一套
  // 推断的两份写法 —— 现在只有一处定义,面板和拍照记的那一餐不会再各算各的
  const [slot, setSlot] = useState<MealSlot>(entry?.slot ?? initialSlot ?? currentSlot)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<MealItem[]>(() =>
    entry ? entry.items.map((i) => ({ ...i })) : initial ? initial.map((i) => ({ ...i })) : []
  )
  /** 删除确认叠在本面板之上 —— 见下面那段「为什么是叠不是关掉再弹」 */
  const [confirmDelete, setConfirmDelete] = useState(false)

  // 每次打开重置,避免上次的残留 —— 尤其是搜索词
  useEffect(() => {
    if (open) {
      setSlot(entry?.slot ?? initialSlot ?? currentSlot())
      setQuery('')
      /*
        ⚠️ **浅拷贝整条 `MealItem`,不是重建 `{ foodId, name, grams }`。**
        重建会把 `per100g` 丢掉,而库外菜(`web:` 项)的营养值就挂在条目
        自己身上 —— 丢掉之后 `nutritionOfItem` 对它返回 0,屏幕上只是
        合计小了一点,没有任何提示。创建路径已经为这个坑写过一次注释
        (见下面 `totalKcal` 那段),这里是它在编辑路径上的同一件事。
      */
      setPicked(entry ? entry.items.map((i) => ({ ...i })) : initial ? initial.map((i) => ({ ...i })) : [])
      setConfirmDelete(false)
    }
    // entry / initial / initialSlot 只在打开的那一刻读一次,中途变化不该覆盖
    // 用户已改的分量(保存之后 store 里那条会换新对象,正是靠这一条不被打断)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** 搜索:匹配菜名或分类。空查询时按分类顺序展示全部 */
  const results = useMemo(() => {
    const q = query.trim()
    if (!q) {
      return [...FOODS].sort(
        (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
      )
    }
    return FOODS.filter((f) => f.name.includes(q) || f.category.includes(q))
  }, [query])

  /**
   * 已选菜品的合计热量。
   *
   * 走 `nutritionOfItem` 而不是自己查食物库:这个面板会被结果页用
   * `initial={pending.items}` 打开,而那里面**可能有库外菜**
   * (带 `web:` 前缀、营养来自联网检索)。以前这里写的是
   * `FOODS.find(f => f.id === item.foodId)`,对库外菜返回 undefined → 那一项
   * 按 0 加进去,于是「已选 3 项」下面那个合计比真实值小,而屏幕上没有任何
   * 提示。库外菜的每 100g 值挂在条目自己身上,`nutritionOfItem` 认这个来源。
   */
  const totalKcal = useMemo(
    () => picked.reduce((sum, item) => sum + nutritionOfItem(item).kcal, 0),
    [picked]
  )

  if (!open) return null

  const addFood = (food: Food) => {
    setPicked((prev) => {
      const existing = prev.find((p) => p.foodId === food.id)
      // 已经在清单里就累加一份,而不是插重复项
      if (existing) {
        return prev.map((p) => (p.foodId === food.id ? { ...p, grams: p.grams + food.defaultGrams } : p))
      }
      return [...prev, { foodId: food.id, name: food.name, grams: food.defaultGrams }]
    })
    setQuery('')
  }

  const changeGrams = (foodId: string, delta: number, current: number) => {
    // 下界用常量,不写字面量 —— `Stepper` 的 min 已经是 MIN_GRAMS 了,
    // 这里再写一个 5 就是同一个数两个来源,改了常量也漏这一个
    setPicked((prev) =>
      prev.map((p) => (p.foodId === foodId ? { ...p, grams: Math.max(MIN_GRAMS, current + delta) } : p))
    )
  }

  const remove = (foodId: string) => setPicked((prev) => prev.filter((p) => p.foodId !== foodId))

  /**
   * 这次改了什么 —— 只给编辑态用。
   *
   * 「没改就不许保存」不是洁癖:每次 commit 都会 saveState 把整棵 state
   * (含每张 base64 缩略图)JSON.stringify 一遍,开一次面板什么都没动
   * 就落一次盘不值当。判据在 store 的 `mealEditIsDirty` 里 —— 放那儿
   * 才断得了(SSR 够不到组件的 useState)。
   */
  const dirty = entry ? mealEditIsDirty(entry, { slot, items: picked }) : true
  const canSave = picked.length > 0 && dirty
  const saveLabel = !picked.length
    ? '请先选择食物'
    : editing && !dirty
      ? '未做修改'
      : `保存 · 共 ${Math.round(totalKcal)} kcal`

  const save = () => {
    if (!picked.length) return
    /*
      草稿模式优先于创建态 —— 理由见 `onDraft` 那段。判据里带 `!entry`:
      编辑态(日记里那条)永远走 editMeal,不能被草稿模式截走。
    */
    if (onDraft && !entry) {
      onDraft(picked, slot)
      onClose()
      return
    }
    if (entry) {
      const updated = editMeal(entry.id, { slot, items: picked })
      // updated 为 null = 这条记录在别处已经被删了。什么都不用做,关掉面板
      if (updated) onSaved?.(updated)
    } else {
      const created = addMeal({
        slot,
        items: picked,
        source,
        ...(initialThumb ? { thumb: initialThumb } : {}),
        // 见 `date` / `time` 那两个 prop:不传就是今天此刻(别处都是这样)
        ...(date ? { date } : {}),
        ...(time ? { time } : {}),
      })
      onSaved?.(created)
    }
    onClose()
  }

  return (
    <div
      className="absolute inset-0 z-40"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? '修改记录' : '记录一餐'}
    >
      <button
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
        aria-label="关闭"
      />

      <div className="animate-sheet-up absolute bottom-0 left-0 flex max-h-[90%] w-full flex-col rounded-t-[24px] bg-[#FAFAFC] backdrop-blur-2xl">
        {/* ---------- 头部 ---------- */}
        <div className="shrink-0 pt-2">
          <div className="flex h-[11px] items-center justify-center">
            <div className="h-[5px] w-9 rounded-full bg-faint" />
          </div>

          <div className="flex items-center justify-between px-4 pt-1 pb-2">
            <button onClick={onClose} className="text-[15px] leading-[21.72px] text-muted active:opacity-60">
              取消
            </button>
            <span className="text-[15px] leading-[21.72px] font-medium text-ink">
              {editing ? '修改记录' : '记录一餐'}
            </span>
            {/* 占位,让标题真正居中 */}
            <span className="w-[30px]" aria-hidden="true" />
          </div>

          {/*
            「你在改哪一天的那一餐」。

            编辑态**必须**有这一行:日期是改不了的(见 store.ts 的 MealEdit),
            而条目可以从日记往前翻好几天再点进来 —— 面板里那些菜和刚才那一屏
            对得上,于是很容易被当成今天的记录来改。写出来的是**这一条自己的**
            date,不是「今天」。
          */}
          {entry && (
            <div className="px-4 pb-2 text-center text-[12px] leading-[17.38px] text-muted">
              {formatRelativeDay(entry.date)} {entry.time}
            </div>
          )}

          {/*
            餐次选择 —— **两行**:上排三餐、下排三次加餐(见 lib/slots.ts 的 `SLOT_ROWS`)。

            六个塞一行放不下(「上午加餐」四个字),而分组之后还有一个好处:
            「午餐」和「下午加餐」摆在不同的行里,不会有人在赶时间时点错一格 ——
            这两档在时间上正好挨着(14:00 那条边界),长得也像。

            `columns={3}` 交给 `SegmentedControl` 去铺格子,以及让方向键的上下
            按行的宽度走(不传的话「下」会往右挪一格)。
          */}
          <div className="px-4 pb-2.5">
            <SegmentedControl
              value={slot}
              onChange={setSlot}
              columns={3}
              options={SLOT_ROWS.flat().map((s) => ({ value: s, label: s }))}
            />
          </div>

          <div className="px-4 pb-3">
            <div className="flex h-11 items-center gap-2.5 rounded-[12px] border border-line bg-card px-3.5">
              <Icon name="search" size={17} className="shrink-0 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索食物，如「米饭」「西兰花」"
                className="min-w-0 flex-1 bg-transparent text-[15px] leading-[21.72px] text-ink outline-none placeholder:text-faint"
              />
              {query && (
                <button onClick={() => setQuery('')} className="shrink-0 text-faint active:opacity-60">
                  <Icon name="close" size={16} strokeWidth={2.2} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ---------- 内容区:已选 + 搜索结果,一起滚动 ---------- */}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {picked.length > 0 && (
            <div className="pb-3">
              <div className="pb-1.5 text-[12px] leading-[17.38px] text-muted">已选 · {picked.length} 项</div>
              <div className="flex flex-col gap-1.5">
                {picked.map((item) => {
                  // 同上:库外菜的值挂在条目上,`FOODS.find` 找不到它
                  const kcal = Math.round(nutritionOfItem(item).kcal)
                  /*
                    未收录的哨兵项(`unmatched:`)在这一屏是**真实存在**的:
                    结果页用 `initial={pending.items}` 把整份清单交进来,里面就
                    包含它们。以前整块面板的库外项都显示 0 kcal,所以看不出区别;
                    现在真数(库外菜的联网值)和 0(什么都没查到)混排在同一列,
                    不给它们一个说法就是在两张不同的东西上写同一个「0 kcal」。

                    **去掉步进器**,不是藏起来:哨兵项的克数改了也不进任何计算
                    (`nutritionOfItem` 对它恒返回 0),留着就是一个改了数字却没有
                    任何反应的控件 —— 这个仓库把「点了没反应」列为最难查的一类。
                    留着删除键,用户仍然能把这道菜清掉。
                  */
                  const notInLibrary = isUnmatchedId(item.foodId)
                  return (
                    <div key={item.foodId} className="flex items-center gap-2 rounded-[12px] bg-card px-3 py-2">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px] leading-[20px] text-ink">{item.name}</span>
                        <span className={`text-[12px] leading-[16px] text-muted ${notInLibrary ? '' : 'tnum'}`}>
                          {notInLibrary ? '不在食物库 · 按 0 计' : `${kcal} kcal`}
                          {/* 和结果页同一句话、同一层含义:这个数字不是食物库的 */}
                          {isWebId(item.foodId) && ' · 联网估算'}
                        </span>
                      </div>

                      {/* 分量步进 —— 每一项都远超 44pt 热区 */}
                      {!notInLibrary && (
                        <Stepper
                          size="sm"
                          value={item.grams}
                          step={stepFor(item.grams)}
                          min={MIN_GRAMS}
                          max={MAX_GRAMS}
                          ariaLabel={`${item.name} 分量`}
                          display={`${item.grams}g`}
                          onChange={(next) => changeGrams(item.foodId, next - item.grams, item.grams)}
                        />
                      )}
                      <button
                        onClick={() => remove(item.foodId)}
                        className="ml-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-faint active:opacity-60"
                        aria-label={`移除 ${item.name}`}
                      >
                        <Icon name="close" size={15} strokeWidth={2.4} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="pb-1.5 text-[12px] leading-[17.38px] text-muted">
            {query.trim() ? `找到 ${results.length} 项` : '常见食物'}
          </div>

          {results.length === 0 ? (
            <p className="py-6 text-center text-[13px] leading-[20px] text-faint">
              没找到「{query.trim()}」。
              <br />
              可以先记个大概，或换个说法再搜。
            </p>
          ) : (
            <div className="flex flex-col">
              {results.map((food) => (
                <button
                  key={food.id}
                  onClick={() => addFood(food)}
                  className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left active:bg-black/[0.04]"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] leading-[20px] text-ink">{food.name}</span>
                    <span className="tnum text-[12px] leading-[16px] text-muted">
                      {food.category} · {food.per100g.kcal} kcal/100g
                    </span>
                  </div>
                  <Icon name="plus" size={17} className="shrink-0 text-brand-deep" strokeWidth={2.2} />
                </button>
              ))}
            </div>
          )}

          {/* 底部安全区留白 */}
          <div className="h-[calc(16px+env(safe-area-inset-bottom))]" />
        </div>

        {/* ---------- 底部:合计 + 保存 ---------- */}
        <div className="shrink-0 border-t border-line bg-[#FAFAFC] px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <PrimaryButton
            icon="check"
            onClick={save}
            className={canSave ? '' : 'pointer-events-none opacity-40'}
          >
            {saveLabel}
          </PrimaryButton>

          {/*
            删除 —— 只在编辑态出现,而且**放在保存键下面**。

            为什么删除键降级成一行文字、还排在保存后面:这个面板的主语是
            「改这一餐」,删除是一个出口,不是并列的第二个动作。放在主按钮
            上面或做成同等份量的按钮,会让人一眼看到「删掉」而不是「改成对的样子」——
            而用户点进来的原因几乎总是后者。

            (它原来是**点日记那一行直接弹**的确认框,所以「删除」曾经是这条路上
            唯一存在的事。现在它退到面板底部,这是这次改动的重点。)
          */}
          {entry && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="mt-2 flex h-12 w-full items-center justify-center text-[15px] leading-[20px] font-medium text-danger active:opacity-60"
            >
              删除这一餐
            </button>
          )}
        </div>
      </div>

      {/*
        删除确认**叠在编辑面板之上**(z-50 对 z-40),不是把面板关掉再弹。

        仓库里有两句互相打架的注释,这里选边的是 ProfileSheet 那句:
        「点『取消』回到列表继续挑,是用户预期里的下一步」。放在这儿就是 ——
        用户点「删除这一餐」多半是想删掉里面**一道菜**却按错了,点「取消」
        回到面板继续改才是他要的。关掉面板再弹,取消之后人就站在日记页上,
        刚才改的分量全没了(那是 RestrictionSheet 那句「闪回去」说的场景,
        那里的下一层已经做完事了,和这里不是一回事)。

        正文说的是 **`entry`(存着的那一条),不是 `picked`**。用户可能刚删掉
        两道菜还没保存就来点删除,那时候 `picked` 描述的是**一份还不存在的东西**,
        而确认框要回答的是「马上要没的是哪一条」。

        正文里**必须带日期**,不能只有 `slot · 菜名（时间）`。理由:这一层的
        背景遮罩(pure black/40)正好盖住面板上那行「9月18日 12:30」——
        而日期不在正文里的话,确认删除那一刻**屏幕上没有任何一处写着这是哪一天**
        (时间那两个字不够:12:30 每天都有)。删除不可撤销,不能让人在这里猜。

        ⚠️ 确认之后:`onConfirm` 先把记录删掉 → store 通知 → 日记页把
        `editingId` 对应的记录算成 null → **整个面板连同这个确认框一起卸载**,
        然后 ConfirmSheet 内部那句 `onClose()` 才执行。落在一个已经卸载的组件上
        是空操作(React 18 起不再警告),不是 bug —— 这里写一句,免得下次读到
        以为漏了清理。
      */}
      {entry && (
        <ConfirmSheet
          open={confirmDelete}
          tone="danger"
          title="删除这条记录？"
          body={`${formatRelativeDay(entry.date)} ${entry.slot} · ${entrySummary(entry)}（${entry.time}）。删除后首页与趋势会立刻重新计算，此操作不可撤销。`}
          confirmLabel="删除"
          onConfirm={() => deleteMeal(entry.id)}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
