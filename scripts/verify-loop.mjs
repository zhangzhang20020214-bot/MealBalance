/**
 * 闭环自检脚本(开发用,不进产物)
 * ===========================================================
 * 用 Node 直接跑一遍 store 的派生逻辑,确认「记录一餐 → 所有数字跟着变」
 * 不是靠肉眼在浏览器里点出来的。跑法:npm run verify
 *
 * 检查的是逻辑,不是像素 —— 像素还是得自己在浏览器里看。
 */

import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const load = (p) => server.ssrLoadModule(p)

const store = await load('/src/store/store.ts')
const derive = await load('/src/store/derive.ts')
const recognize = await load('/src/store/recognize.ts')
const adviceMod = await load('/src/store/advice.ts')
const date = await load('/src/lib/date.ts')
const { FOOD_BY_ID, FOODS, CATEGORY_ORDER } = await load('/src/data/foods.ts')
const dishMatch = await load('/src/lib/dishMatch.ts')
/*
  「这一项算不算得出营养」的**唯一**判据在这里 —— 与 `derive` 里求和用的是
  同一个函数。测试里也需要问这个问题(比如「一整盘菜是不是都落到了有值的地方」),
  就地再写一遍前缀判断就会多出第二份定义,而那正是这一轮要消灭的东西。
*/
const { per100gOf } = await load('/src/lib/nutrition.ts')
/*
  配额模块在这里先载一次:下面第 6 节要用 `quotaNotes()` 反查 specialNutrition 的
  来源。(文件后半段那个 `quotaMod` 是同一个模块,但 `const` 有 TDZ,提前用不了。)
*/
const quotaNotesOf = (await load('/src/store/quota.ts')).quotaNotes
/*
  同上:`ageOf` 在第 2 节(发给 agent 的那段 JSON)就要用,而它的正式出处
  (`typesMod`)在下面第 9 节才解构 —— TDZ 不管顺序,提前用不了。
*/
const { ageOf } = await load('/src/store/types.ts')

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failures++
}

const state = () => store.getSnapshot()
const today = date.todayISO()

/*
  首屏不再播种了 —— 上面的 load 拿到的是一份**空档案 + 空日记**(用户第一次
  打开 App 看到的就是它)。本套件要验的是「有记录时数字怎么动」,所以在这里
  **显式**把演示数据装一次。

  这不是绕过问题,是把夹具从「副作用」改成「声明」:以前这些断言是搭在
  `initialState()` 会顺手灌种子的基础上的,读的人得追到 store.ts 才知道
  第 1 节那个「0 餐」以外的东西是哪来的。而下面第 6 节里那三条
  (item 是裸词 / 带 type / severity 英文枚举)是本文件最要紧的安全断言 ——
  过敏原拦截,它们不能因为首屏行为改了就跟着一块儿消失。
*/
store.resetToSeed()
check(
  'resetToSeed 装上了演示数据',
  state().meals.length > 0 && state().profile.restrictions.length > 0,
  `${state().meals.length} 条记录 · ${state().profile.name}`
)

console.log('\n=== 1. 种子数据 ===')
const seeded = derive.dayStats(state().meals, today, state().profile)
console.log(`     今天 ${today}:${seeded.mealCount} 餐 · ${Math.round(seeded.nutrition.kcal)} kcal · 健康分 ${seeded.score.score}`)
check('种子数据落在今天', seeded.mealCount > 0, `${seeded.mealCount} 餐`)
check('健康分在 0-100', seeded.score.score >= 0 && seeded.score.score <= 100, String(seeded.score.score))

const trend = derive.weekTrend(state().meals, state().profile, 7)
check('周趋势有对比数据', trend.sodiumDeltaPct !== null, `环比 ${trend.sodiumDeltaPct}%`)
check('周趋势 7 天', trend.days.length === 7)

const warnings = derive.deriveWarnings(state().meals, state().profile)
console.log(`     警示卡 ${warnings.length} 条:${warnings.map((w) => w.title).join(' / ') || '(无)'}`)

/* ------------------------------------------------------------
   1.1 餐次 —— 六个取值、两张表、一处定义
   ------------------------------------------------------------
   这一节盯的是 2026-09-22 那次改动:餐次从四个(早/午/晚/加餐)变成六个
   (三餐 + 上午加餐/下午加餐/夜宵),因为原来那套是**把一天平铺切成四段** ——
   「加餐」只在 21:00 之后出现,上午十点和下午三点吃的那两顿被算进了午餐/晚餐,
   而且三餐的窗口长得离谱(午餐 5 小时、晚餐 6 小时)。用户的原话是
   「早午餐之间可能会有加餐、午晚餐之间也可能会有加餐,而且,你的早、午、晚餐的
   时间段也和常理不合,时间怎么可能那么长」。

   ⚠️ 这一节里最要紧的两条是「**每个取值都有钟点能落到它**」和
   「**分桶不漏记录**」。理由:这次删掉了一个取值(`加餐`),而**删取值的坏法
   是静默的** —— 一条 `slot: '加餐'` 的老记录在新表里查不到,`dayStats` 的分桶
   会把它整条漏掉(它还在 `entries` 里、合计也还加上它,但按餐次分组的那一格
   凭空少了它),界面上没有任何一处会报错。改动当天跑全套,**一条都没红** ——
   因为当时的夹具里还写着 `'加餐'`,而那些断言没有一条问过「桶加起来等于总餐数吗」。
   这两条就是补上那个问题。
   ------------------------------------------------------------ */
console.log('\n=== 1.1 餐次:六个取值、两张表、一处定义 ===')

const slotsMod = await load('/src/lib/slots.ts')
const { MEAL_SLOTS, MAIN_SLOTS, SNACK_SLOTS, SLOT_ROWS, slotAtHour, slotForClock, isMainSlot, isSnackSlot } = slotsMod

check('六个餐次', MEAL_SLOTS.length === 6, MEAL_SLOTS.join(' / '))
check('没有重复的餐次', new Set(MEAL_SLOTS).size === MEAL_SLOTS.length)
check(
  '三餐 + 三加餐**正好**是那六个（没有孤儿、也没有表外的值）',
  [...MAIN_SLOTS, ...SNACK_SLOTS].length === MEAL_SLOTS.length &&
    [...MAIN_SLOTS, ...SNACK_SLOTS].every((s) => MEAL_SLOTS.includes(s)),
  `${MAIN_SLOTS.join('/')} + ${SNACK_SLOTS.join('/')}`
)

/*
  **每个取值都有钟点能落到它。** 把一天 24 个整点全过一遍,收集落到的餐次,
  和 `MEAL_SLOTS` 比 —— 两个方向都断:
    · 少一个 = 有一个餐次**永远选不到**(死取值,面板上摆着一个点不出来的按钮)
    · 多一个 = 钟点表算出了一个不在表里的餐次
  这一条同时也是「`slotAtHour` 是全函数、不留 undefined」的证明。
*/
const reachable = [...new Set(Array.from({ length: 24 }, (_, h) => slotAtHour(h)))]
check(
  '**每一个餐次都有钟点能落到它**（没有死取值）',
  reachable.length === MEAL_SLOTS.length && MEAL_SLOTS.every((s) => reachable.includes(s)),
  `24 小时落到了 ${reachable.length} 个餐次`
)

/*
  三餐的窗口**不能长**。这是用户那句话的字面要求,所以把它写成断言:
  每个正餐窗口最多 4 小时(原来午餐 5 小时、晚餐 6 小时,正是被抱怨的那一点)。
  加餐不设上限 —— 夜宵横跨 21:00–06:00 是有意的(那 9 小时大部分在睡觉)。
*/
const windowHours = (slot) => Array.from({ length: 24 }, (_, h) => h).filter((h) => slotAtHour(h) === slot).length
const longestMain = Math.max(...MAIN_SLOTS.map(windowHours))
check(
  '**三餐的窗口都不超过 4 小时**（原来午餐 5、晚餐 6 —— 用户抱怨的就是这个）',
  longestMain <= 4,
  MAIN_SLOTS.map((s) => `${s} ${windowHours(s)}h`).join(' · ')
)

/*
  `MEAL_SLOTS` 必须是**按时间排的** —— 首页那行「每餐 kcal」和发给食衡的
  `todayIntake.meals` 都按这个顺序读。
  判据不是把那张表抄一遍,而是**从钟点表里推**:每个餐次从 6:00 起第一次出现的
  那个小时,必须严格递增。(从 6 点起扫是因为夜宵横跨午夜,线性序里它只能算 21 点。)
*/
const firstHourFrom6 = (slot) => Array.from({ length: 18 }, (_, i) => i + 6).find((h) => slotAtHour(h) === slot)
const firstHours = MEAL_SLOTS.map(firstHourFrom6)
check(
  '**`MEAL_SLOTS` 是按时间排的**（从钟点表推出来,不是抄的）',
  firstHours.every((h, i) => i === 0 || (h !== undefined && h > firstHours[i - 1])),
  MEAL_SLOTS.map((s, i) => `${s}@${firstHours[i]}`).join(' → ')
)

/*
  ⚠️ 面板上那排按钮的顺序**和 `MEAL_SLOTS` 不是同一个** —— 两行,上排三餐下排加餐。
  这一条断的是「两行合起来仍然是那六个、一个不多一个不少」:按钮少一个 = 有一个
  餐次在面板上根本选不出来(而它照样能从拍照那条路进来,于是同一天里两种记法
  能落到的餐次不一样)。
*/
const flatRows = SLOT_ROWS.flat()
check('两行按钮合起来就是那六个餐次', new Set(flatRows).size === MEAL_SLOTS.length && MEAL_SLOTS.every((s) => flatRows.includes(s)), flatRows.join(' '))
check('上排是三餐、下排是加餐', SLOT_ROWS[0].every(isMainSlot) && SLOT_ROWS[1].every(isSnackSlot), `${SLOT_ROWS[0].join('/')} ／ ${SLOT_ROWS[1].join('/')}`)
check(
  '**两个顺序确实不同**（面板要分组、列表要按时间 —— 合成一个就有一处是错的）',
  flatRows.join(',') !== MEAL_SLOTS.join(','),
  `面板 ${flatRows.join('/')} ／ 列表 ${MEAL_SLOTS.join('/')}`
)

/*
  `isMainSlot` / `isSnackSlot` 必须**恰好有一个成立** —— 这是「没有孤儿」的判据:
  两个都假 = 某一档加餐会被「今天缺哪一餐」当成正餐催,或者反过来被漏掉;
  两个都真 = 同一餐同时是正餐又是加餐,`daySummary` 会把它数进「已记录」还列进
  「待记录」。这一条的形状和忌口那两张表(见 `types.ts`)是同一个。
*/
check(
  '**每个餐次恰好是「正餐」或「加餐」之一**（不存在两个都不算的孤儿）',
  MEAL_SLOTS.every((s) => isMainSlot(s) !== isSnackSlot(s)),
  MEAL_SLOTS.map((s) => `${s}:${isMainSlot(s) ? '正' : '加'}`).join(' ')
)
check('表外的值两个都不算', !isMainSlot('加餐') && !isSnackSlot('加餐'), '「加餐」是 v7 的旧取值,已经删了')

/* ---------- 钟点 → 餐次 ---------- */
const boundary = [
  [5, '夜宵'], [6, '早餐'], [8, '早餐'],
  [9, '上午加餐'], [10, '上午加餐'],
  [11, '午餐'], [13, '午餐'],
  [14, '下午加餐'], [16, '下午加餐'],
  [17, '晚餐'], [20, '晚餐'],
  [21, '夜宵'], [23, '夜宵'],
]
const wrongBoundary = boundary.filter(([h, s]) => slotAtHour(h) !== s)
check(
  '钟点边界左闭右开（6 点整是早餐、9 点整已经是上午加餐）',
  wrongBoundary.length === 0,
  wrongBoundary.length ? wrongBoundary.map(([h, s]) => `${h}点应是${s}、实际${slotAtHour(h)}`).join('; ') : boundary.map(([h, s]) => `${h}→${s}`).join(' ')
)

const at = (h) => slotsMod.currentSlot(new Date(2026, 8, 22, h, 30))
check('`currentSlot` 只看钟点', at(7) === '早餐' && at(15) === '下午加餐' && at(22) === '夜宵', `${at(7)} / ${at(15)} / ${at(22)}`)

/*
  `slotForClock` —— v7→v8 迁移的判据。解析不出来时**返回 null**,不猜:
  猜一个等于替用户改他的记录。(迁移那边对 null 的处理是「留着不动」。)
*/
check(
  '`slotForClock` 认得 `HH:mm`',
  slotForClock('15:30') === '下午加餐' && slotForClock('21:40') === '夜宵' && slotForClock('10:15') === '上午加餐',
  `15:30→${slotForClock('15:30')} 21:40→${slotForClock('21:40')} 10:15→${slotForClock('10:15')}`
)
check(
  '读不出时间的返回 null（不猜）',
  slotForClock('') === null && slotForClock('25:00') === null && slotForClock('下午') === null,
  `''→${slotForClock('')} '25:00'→${slotForClock('25:00')}`
)

/* ---------- 图标与底色:六个取值都得有话说 ---------- */
const iconOf = (slot) => derive.entryIcon({ id: 'x', date: today, slot, time: '12:00', source: '手动记录', items: [], createdAt: 1 })
const icons = MEAL_SLOTS.map(iconOf)
check('每个餐次都有图标', icons.every((i) => typeof i === 'string' && i.length > 0), MEAL_SLOTS.map((s, i) => `${s}:${icons[i]}`).join(' '))
check('三餐的图标互不相同', new Set(MAIN_SLOTS.map(iconOf)).size === 3, MAIN_SLOTS.map(iconOf).join(' '))
check(
  '老数据里那个「加餐」也有图标兜着（不然 `<Icon name={undefined}>` 会白屏）',
  iconOf('加餐') === 'leaf',
  iconOf('加餐')
)

const tintOf = (slot) => derive.entryTint({ id: 'x', date: today, slot, time: '12:00', source: '手动记录', items: [], createdAt: 1 }, state().profile)
check(
  '暖黄底 = 早餐 + 三顿加餐（午餐晚餐是绿的 —— 这是设计稿定的,不按正餐/加餐分）',
  tintOf('早餐') === 'meal' && SNACK_SLOTS.every((s) => tintOf(s) === 'meal') && tintOf('午餐') === 'brand' && tintOf('晚餐') === 'brand',
  MEAL_SLOTS.map((s) => `${s}:${tintOf(s)}`).join(' ')
)

/* ---------- 分桶不许漏记录 ---------- */
/*
  ⚠️ 这一条是这次改动真正的守卫。`dayStats` 按 `MEAL_SLOTS` 分桶,一个不在表里的
  `slot` 会被**整条漏掉** —— 而它还在 `entries` 里、合计也还算它,所以
  「今天几餐」和「每餐 kcal 那几行」会对不上,但没有任何一处报错。
  判据:所有桶里的记录数加起来,**必须等于** `mealCount`。
  弄红它很容易:往 meals 里塞一条 `slot: '加餐'`(v7 的旧取值)。
*/
/*
  ⚠️ 用的是一份**六个餐次各一条**的夹具,不是种子数据。理由:种子数据在「今天」
  只有两三餐,桶表少了大半档也照样加得起来 —— 弄坏 `MEAL_SLOTS` 时它**不会红**,
  于是这条断言等于没写(这正是「弄坏本身是空操作」那一类)。六个餐次各来一条,
  桶表里少任何一个都会当场对不上。
*/
const sixSlotDay = MEAL_SLOTS.map((slot, i) => ({
  id: `six-${i}`,
  date: today,
  slot,
  time: '12:00',
  source: '手动记录',
  items: [{ foodId: 'rice', name: '米饭', grams: 100 }],
  createdAt: 1000 + i,
}))
const fxStats = derive.dayStats(sixSlotDay, today, state().profile)
const bucketed = fxStats.slots.reduce((n, s) => n + s.entries.length, 0)
check(
  '**分桶加起来等于总餐数**（桶表比取值范围少一个时,这一条会红）',
  bucketed === fxStats.mealCount && fxStats.mealCount === 6,
  `${bucketed} / ${fxStats.mealCount} 餐`
)
check(
  '六个餐次各占一格,顺序按时间（加餐插在两餐之间）',
  JSON.stringify(fxStats.slots.map((s) => s.slot)) === JSON.stringify(MEAL_SLOTS),
  fxStats.slots.map((s) => s.slot).join('/')
)

/* ---------- 识别:六个餐次都能组出一盘菜 ---------- */
const perSlot = MEAL_SLOTS.map((s) => {
  const r = recognize.recognizeMeal(s)
  return { slot: s, got: r.slot === s && r.items.length > 0, n: r.items.length }
})
check(
  '六个餐次都能识别出一盘菜,而且餐次原样带回来',
  perSlot.every((p) => p.got),
  perSlot.map((p) => `${p.slot}×${p.n}`).join(' ')
)

/* ---------- 只记了加餐的那句话 ---------- */
/*
  `daySummary` 在这个情形下原来会渲染「**已记录**，早餐、午餐、晚餐待记录。」
  —— `recorded.join('、')` 出来的是空串,句子第一个词就自相矛盾。
  这是个**一直存在**的 bug,只是旧模型下「加餐」只在 21:00 之后才可能出现,
  撞上的机会少;三档加餐之后上午十点记一口就会撞上。
*/
const snackOnlyMeals = [
  { id: 'so-1', date: today, slot: '上午加餐', time: '10:00', source: '手动记录', items: [], createdAt: 1 },
].map((m) => ({ ...m, items: [{ foodId: 'apple', name: '苹果', grams: 150 }] }))
const snackOnlyText = derive.daySummary(derive.dayStats(snackOnlyMeals, today, state().profile), null, state().profile)
check(
  '只记了加餐时,那句话不自相矛盾（不再是「已记录，早餐、午餐、晚餐待记录。」）',
  !snackOnlyText.includes('已记录') && snackOnlyText.includes('只记了加餐'),
  snackOnlyText
)
check('那一句里仍然点名了缺的三餐', MAIN_SLOTS.every((s) => snackOnlyText.includes(s)), snackOnlyText)

console.log('\n=== 2. 识别 → 归档 → 数字变化 ===')
let recognizedOk = 0
let adviceEmpty = 0
let missingFood = 0
/*
  ⚠️ 这个夹具原来写死 `['早餐','午餐','晚餐','加餐']`,而 `加餐` 这个取值在
  2026-09-22 已经删掉了 —— 写死的话那 50 次会**悄悄**走进「午餐/晚餐」那一支
  (`isSnackSlot('加餐')` 是 false),200 次里少测一档而一条断言都不会红。
  改成从 `MEAL_SLOTS` 取:`lib/slots.ts` 再长出第七档时,这里自动跟着走。
  (这一节上面那 24 条断言里有几条会因为夹具变了而报出来,那是**好事**。)
*/
const slots = MEAL_SLOTS
for (let i = 0; i < 200; i++) {
  const r = recognize.recognizeMeal(slots[i % slots.length])
  if (r.items.length > 0) recognizedOk++
  for (const it of r.items) if (!FOOD_BY_ID.get(it.foodId)) missingFood++
  const n = derive.nutritionOfItems(r.items)
  if (!Number.isFinite(n.kcal) || n.kcal <= 0 || !Number.isFinite(n.sodium)) {
    check('识别结果营养值有效', false, JSON.stringify(n))
  }
  const a = adviceMod.deriveAdvice(r.items, state().profile)
  if (a.length === 0) adviceEmpty++
}
check('200 次识别都出菜', recognizedOk === 200, `${recognizedOk}/200`)
check('识别出的 foodId 全部存在于食物库', missingFood === 0, `缺失 ${missingFood} 个`)
check('建议几乎不出现空数组', adviceEmpty / 200 < 0.05, `空 ${adviceEmpty}/200`)

// 真的走一遍归档
const before = derive.dayStats(state().meals, today, state().profile)
const meal = recognize.recognizeMeal('午餐')
const entry = store.addMeal({ slot: meal.slot, items: meal.items, source: '拍餐盘' })
const after = derive.dayStats(state().meals, today, state().profile)

console.log(`     归档前:${before.mealCount} 餐 · ${Math.round(before.nutrition.kcal)} kcal · 健康分 ${before.score.score}`)
console.log(`     归档后:${after.mealCount} 餐 · ${Math.round(after.nutrition.kcal)} kcal · 健康分 ${after.score.score}`)
check('餐数 +1', after.mealCount === before.mealCount + 1)
check('热量增加', after.nutrition.kcal > before.nutrition.kcal)
check('新记录带上了拍餐盘来源', entry.source === '拍餐盘')

/* ============================================================
   2.1 改一条记录(不只是删)
   ------------------------------------------------------------
   「记错了只能删掉重记」是这类 App 最先被抱怨的地方 —— 而重记会换一个 id、
   换一个 createdAt,照片还得重拍。这一节盯的是 `editMeal` 有没有**顺手把别的
   字段一起改掉**。

   被改的对象是这一节自己的夹具,不是上面那条:`editMeal` 的口径是窄的
   (只认 slot 和 items,见 store.ts 的 MealEdit),而「窄」这件事只有在
   **一条所有字段都不同的记录**上才验得出来 —— 上面那条既没有照片也不是库外菜,
   把 `thumb` 抹掉它都不会响。

   夹具挑了一个**不是今天**的日期:今天那几个数字后面第 3 节还要拿第 2 节的
   `after` 比大小,这一节不该动它们。收尾把它删掉,store 逐字节回到进来时的样子。
   ============================================================ */

console.log('\n=== 2.1 改一条记录(不只是删)===')

/*
  挑一个**种子里没有记录**的日子(种子只铺最近 14 天)。这样那一天的数字完全
  由这一节的夹具决定:`daySummary` 那几句才有确定的内容可比,今天那几个数
  (第 3 节要拿第 2 节的 `after` 比大小)也一根汗毛都动不到。
*/
const fxDate = date.lastNDays(30)[0]
/** 库外菜的那份值从真食物库里借一个完整对象 —— 手写一个缺字段的会在别处炸 */
const borrowedPer100g = FOODS[0].per100g
const fx = store.addMeal({
  slot: '午餐',
  date: fxDate,
  time: '12:30',
  source: '拍餐盘',
  thumb: 'data:image/jpeg;base64,EDITFIXTURE',
  items: [
    { foodId: 'rice', name: '米饭', grams: 150 },
    { foodId: 'web:青团', name: '青团', grams: 80, per100g: borrowedPer100g, source: '联网估算' },
  ],
})
const fxOriginalSlot = fx.slot
const fxOriginalItems = fx.items.map((i) => ({ ...i }))
/** 进来时 store 的样子 —— 收尾要逐字节回到它 */
const mealsBeforeFixture = JSON.stringify(state().meals.filter((m) => m.id !== fx.id))

// ① 改了餐次和菜品 —— 那一条跟着变
const fxStatsBefore = derive.dayStats(state().meals, fxDate, state().profile)
const newItems = [
  { foodId: 'broccoli', name: '西兰花', grams: 200 },
  { foodId: 'egg', name: '鸡蛋', grams: 50 },
]
const edited = store.editMeal(fx.id, { slot: '早餐', items: newItems })
check('editMeal 返回改完的那一条(调用方拿它当 onSaved 的参数)', edited?.id === fx.id, String(edited?.id))
check('餐次跟着改了', edited?.slot === '早餐', `${fxOriginalSlot} → ${edited?.slot}`)
check(
  '**菜品是替换,不是追加** —— 两条旧的都走了',
  JSON.stringify(edited?.items) === JSON.stringify(newItems),
  `${edited?.items.length} 项`
)
check(
  'store 里那一条也真的变了(不是只改返回值)',
  state().meals.find((m) => m.id === fx.id)?.slot === '早餐'
)

// ② 其余字段一个都没动 —— 这一轮的核心
const still = state().meals.find((m) => m.id === fx.id)
check(
  '**编辑不碰 id / date / time / source / createdAt / thumb**',
  still.id === fx.id &&
    still.date === fxDate &&
    still.time === '12:30' &&
    still.source === '拍餐盘' &&
    still.createdAt === fx.createdAt &&
    still.thumb === 'data:image/jpeg;base64,EDITFIXTURE',
  `time=${still.time} source=${still.source} thumb=${still.thumb ? '在' : '**没了**'}`
)

// ③ 只动了那一条 —— 其余逐字段相等
check(
  '**只动了那一条,别的记录一个字没变**',
  JSON.stringify(state().meals.filter((m) => m.id !== fx.id)) === mealsBeforeFixture
)

// ④ 数字跟着变(从 store 到派生,端到端)
const fxStatsAfter = derive.dayStats(state().meals, fxDate, state().profile)
check(
  '改完那一天的合计跟着变',
  fxStatsAfter.nutrition.kcal !== fxStatsBefore.nutrition.kcal,
  `${Math.round(fxStatsBefore.nutrition.kcal)} → ${Math.round(fxStatsAfter.nutrition.kcal)} kcal`
)

// ⑤ 餐次改了,分桶也跟着挪 —— 原来挂「午餐」那一格,现在挂「早餐」
check(
  '**餐次改了,`dayStats` 的分桶跟着挪**',
  !fxStatsAfter.slots.some((s) => s.slot === '午餐' && s.entries.some((e) => e.id === fx.id)) &&
    fxStatsAfter.slots.some((s) => s.slot === '早餐' && s.entries.some((e) => e.id === fx.id)),
  fxStatsAfter.slots.map((s) => s.slot).join('/')
)
/*
  ⚠️ 这里**不**拿 HomeScreen 里的 `missingSlots` 当对象 —— 它是在组件里内联
  算的(HomeScreen.tsx:90),SSR 够不到。能用的是 `daySummary` 这个纯函数,
  它内部有一份同样的「早餐/午餐/晚餐谁还缺」的判断。

  那一天只有这一条记录(种子里没有它),所以整句话是确定的 —— 改前说午餐、
  改后说早餐,一个字都不含糊。
*/
check(
  '那一天的总结改口了:从「午餐已记录」变成「早餐已记录」',
  derive.daySummary(fxStatsBefore, null, state().profile) === '午餐已记录，早餐、晚餐待记录。' &&
    derive.daySummary(fxStatsAfter, null, state().profile) === '早餐已记录，午餐、晚餐待记录。',
  `${derive.daySummary(fxStatsBefore, null, state().profile)} → ${derive.daySummary(fxStatsAfter, null, state().profile)}`
)

/*
  ⑥ 未知 id = 无事发生,而且**连 commit 都不该发生**。

  ⚠️ 这一句用 `try/catch` 包着,不是防它抛,是防它**抛了之后整个套件停在
  这里**:下面是 `mealEditIsDirty` 的真值表和 `deleteMeal` 那一节,一共十几条。
  `editMeal` 一旦改成对未知 id 抛错,裸着写的话这一句直接崩掉整个 verify-loop,
  后面十几条**一条都不再执行** —— 而输出看上去只是「少了几行」,不是「崩了」。
  这是弄坏 ⑤ 的时候查出来的:当时得到的是「0 条红」。
*/
let unknownIdResult = '抛了错'
try {
  unknownIdResult = store.editMeal('m-不存在', { slot: '早餐', items: newItems })
} catch (e) {
  unknownIdResult = `抛了错:${e.message}`
}
const wholeStateBefore = JSON.stringify(state())
check('未知 id 不抛错,返回 null', unknownIdResult === null, `${unknownIdResult}`)
check(
  '未知 id 时整棵 state 一个字没动(连落盘都没发生)',
  JSON.stringify(state()) === wholeStateBefore,
  `${state().meals.length} 条`
)

// ⑦ 改回原样 = 逐字节回到原样。这条同时说明「改回去真的等于没改」和
//    「editMeal 没有顺手写别的东西」—— 比逐字段比更难糊弄
store.editMeal(fx.id, { slot: fxOriginalSlot, items: fxOriginalItems })
const back = state().meals.find((m) => m.id === fx.id)
check(
  '**改回原样之后,那一条逐字节等于没改过**',
  JSON.stringify(back) === JSON.stringify(fx),
  JSON.stringify(back) === JSON.stringify(fx) ? '' : `${JSON.stringify(back)}`
)

/*
  **没改就真的不写。**
  这条盯的是写入路径,不是界面上那颗置灰按钮:`PrimaryButton` 根本没有
  `disabled` 这个 prop,CSR 那边只靠一个 `pointer-events-none` 的类,
  管不住键盘。而这里一次写是 `JSON.stringify` 整棵 state(含每张 base64
  缩略图)—— InlineField 已经为同一件事立过断言,这里不能只有注释。

  比的是**引用相等**,不是 `.length` 或字段相等:`meals.map(...)` 出来的新数组
  长度一样、值也一样,拿那些比的话「写了」和「没写」两边全绿。
*/
const stateBeforeNoopEdit = JSON.stringify(state())
const noopResult = store.editMeal(fx.id, { slot: back.slot, items: back.items.map((i) => ({ ...i })) })
check(
  '**原样提交 → 返回原来那个对象(引用相等),一个字都没写**',
  noopResult === back && JSON.stringify(state()) === stateBeforeNoopEdit,
  noopResult === back ? '' : '返回的不是原来那个对象 —— 说明它 commit 了一次'
)

/* ---------- ⑧ `mealEditIsDirty` 的真值表 ---------- */
const sameEdit = { slot: fx.slot, items: fx.items.map((i) => ({ ...i })) }
check('**没改 → false**(保存键该置灰)', store.mealEditIsDirty(fx, sameEdit) === false)
check('改了分量 → true', store.mealEditIsDirty(fx, { ...sameEdit, items: [{ ...fx.items[0], grams: 999 }, fx.items[1]] }) === true)
check(
  '改了餐次 → true',
  store.mealEditIsDirty(fx, { slot: '晚餐', items: sameEdit.items }) === true
)
check(
  '加一道菜 → true',
  store.mealEditIsDirty(fx, { ...sameEdit, items: [...sameEdit.items, { foodId: 'egg', name: '鸡蛋', grams: 50 }] }) === true
)
check('删一道菜 → true', store.mealEditIsDirty(fx, { ...sameEdit, items: [sameEdit.items[0]] }) === true)
check(
  '顺序换了 → true(逐项比,不排序)',
  store.mealEditIsDirty(fx, { ...sameEdit, items: [sameEdit.items[1], sameEdit.items[0]] }) === true
)
/*
  这一条是把**代价**写成断言,不是把注释抄一遍:删掉一道菜再原样加回来会被
  判成「改过」,保存键可点,写回去的其实是一模一样的数据。接受这个代价的
  理由在 store.ts 的 mealEditIsDirty 注释里 —— 而它得在这里有一双眼睛盯着,
  免得有人「顺手改成按内容排序」还以为没人发现。
*/
check(
  '**删掉再加回来 → true**(已知的代价,不是 bug)',
  store.mealEditIsDirty(fx, {
    ...sameEdit,
    items: [sameEdit.items[1], sameEdit.items[0]],
  }) === true
)

/* ---------- ⑨ `deleteMeal` ---------- */
/*
  它原来一条断言都没有。删除的入口这次要从日记页搬进编辑面板,而**搬走这个
  动作本身不会有任何东西变红** —— 所以 store 这一层得自己站住。
*/
const spare = store.addMeal({ slot: '下午加餐', date: fxDate, items: [{ foodId: 'egg', name: '鸡蛋', grams: 50 }], source: '手动记录' })
const beforeDelete = JSON.stringify(state().meals.filter((m) => m.id !== spare.id))
store.deleteMeal(spare.id)
check('deleteMeal 删掉的是那一条', !state().meals.some((m) => m.id === spare.id))
check('**deleteMeal 不动别的记录**', JSON.stringify(state().meals) === beforeDelete)
const beforeNoop = JSON.stringify(state())
store.deleteMeal('m-也不存在')
check('删一个不存在的 id 不抛错,state 也不动', JSON.stringify(state()) === beforeNoop)

// 收尾:夹具删掉,store 回到进这一节之前的样子
store.deleteMeal(fx.id)
check(
  '这一节收尾后 store 逐字节回到进来时(没给后面几节留残留)',
  JSON.stringify(state().meals) === mealsBeforeFixture,
  `${state().meals.length} 条`
)

console.log('\n=== 3. 每日目标改了,判定跟着变 ===')
const quota = state().profile.quota
store.updateProfile({ quota: { ...quota, sodium: 1200 } })
const strict = derive.dayStats(state().meals, today, state().profile)
check('钠上限收紧后健康分下降', strict.score.score <= after.score.score, `${after.score.score} → ${strict.score.score}`)
store.updateProfile({ quota })

console.log('\n=== 4. 空记录与异常输入 ===')
const empty = derive.dayStats([], today, state().profile)
check('无记录时健康分不崩', Number.isFinite(empty.score.score))
check('无记录时汇总文案可读', derive.daySummary(empty, null, state().profile).length > 5)
const ghost = derive.nutritionOfItems([{ foodId: 'not-a-real-id', name: '幽灵菜', grams: 100 }])
check('未知 foodId 按 0 计而不抛错', ghost.kcal === 0)
check('日记摘要不因空记录报错', derive.entrySummary({ items: [], id: 'x', date: today, slot: '午餐', time: '12:00', source: '手动记录', createdAt: 0 }) === '空记录')

/* ---------- 幽灵条目:唯一一处「算错了而界面上看不出来」 ----------
 *
 * `nutritionOfItems` 会静默跳过三种条目,含义各不相同:
 *
 *   · `unmatched:` 哨兵        → 「已知的不知道」,结果页早就标了「按 0 计」
 *   · `web:` 项但 per100g 没了 → 「本该有值却丢了」,比幽灵更糟(见下面的 ⑥)
 *   · 库里已经没有的普通 id    → 「不知道的不知道」,以前**没有任何地方说出来**
 *
 * 这一节测的是最后那一个的**探测器**。探测器最大的风险不是漏报,是**写成一个
 * 永远不响的东西** —— 那样加了等于没加,而且比没加更糟:它会让人以为
 * 这条已经有人管了。所以下面既要证明它**会响**,也要证明它**不乱响**。
 *
 * ⚠️ 探照范围是「哪些条目该由这个探测器负责」,所以每加一种新前缀,
 * 这里就要多一组「它不归你管」的断言 —— 少了那一组,新前缀会静默落进
 * 这个探测器的射程,变成一条每拍一道菜就多出来的假警报。
 */
const mkItem = (foodId, name) => ({ foodId, name, grams: 100 })
const mkEntry = (id, items) => ({
  id,
  date: today,
  slot: '午餐',
  time: '12:00',
  source: '手动记录',
  createdAt: 0,
  items,
})

// ① 会响:库里没有的 id 必须被抓出来,并带出冗余存下来的菜名
const ghostMeals = [mkEntry('g1', [mkItem('not-a-real-id', '幽灵菜'), mkItem('rice', '米饭')])]
const found = derive.findBrokenRefs(ghostMeals)
check('幽灵条目被抓出来', found.length === 1, `抓到 ${found.length} 条`)
check('幽灵条目带出菜名(不是只报一个 id)', found[0]?.name === '幽灵菜', String(found[0]?.name))
check('同一餐里的正常条目不受影响', !found.some((r) => r.foodId === 'rice'))

// ② 不乱响:哨兵**同样不在** FOOD_BY_ID 里,但它是设计好的行为
const sentinelId = `${dishMatch.UNMATCHED_PREFIX}土豆炖牛肉`
const sentinelMeals = [mkEntry('s1', [mkItem(sentinelId, '土豆炖牛肉')])]
check(
  '哨兵条目不算幽灵（否则每拍一道库外的菜就多一条假警报）',
  derive.findBrokenRefs(sentinelMeals).length === 0,
  JSON.stringify(derive.findBrokenRefs(sentinelMeals)),
)

// ②b 不乱响:`web:` 项**也不在** FOOD_BY_ID 里,而且它的营养是好的
const webId = `${dishMatch.WEB_PREFIX}土豆炖牛肉`
const WEB_PER100G = { kcal: 168, protein: 12.5, carb: 6, fat: 9.8, sodium: 430, sugar: 1.2 }
const webItem = { ...mkItem(webId, '土豆炖牛肉'), per100g: WEB_PER100G, source: '薄荷健康' }
check(
  '联网条目不算幽灵（否则每拍一道库外菜就多一条假警报,而它恰好出现在功能生效时）',
  derive.findBrokenRefs([mkEntry('w1', [webItem])]).length === 0,
  JSON.stringify(derive.findBrokenRefs([mkEntry('w1', [webItem])])),
)

// ③ 同一个幽灵出现在两餐里:合并成一条,count 累计
const twice = derive.findBrokenRefs([
  mkEntry('t1', [mkItem('gone-id', '下架菜')]),
  mkEntry('t2', [mkItem('gone-id', '下架菜')]),
])
check('同一道幽灵菜合并成一条', twice.length === 1, `实际 ${twice.length} 条`)
check('出现次数被累计', twice[0]?.count === 2, String(twice[0]?.count))

// ④ 边界:空输入不该炸,也不该报
check('没有记录时报 0 条', derive.findBrokenRefs([]).length === 0)
check('只有哨兵时报 0 条', derive.findBrokenRefs([mkEntry('e1', [])]).length === 0)

// ⑤ 正常的种子数据一条都不该有 —— 这张警告卡在演示里不该出现
check(
  '种子数据零幽灵（日记页不会平白多出一张警告卡）',
  derive.findBrokenRefs(state().meals).length === 0,
  JSON.stringify(derive.findBrokenRefs(state().meals)),
)

/* ---------- ⑥ 反向探测器:web 项丢了 per100g ----------
 *
 * 上面那条「`web:` 排除在幽灵之外」是有代价的:排除之后,一个 web 项如果
 * `per100g` 在哪一层被吃掉了,它就会静默算成 0,而**全 App 没有别的地方出声**。
 * 普通幽灵至少还有名字出现在日记卡上,这个连名字都还在、数字却没了 —— 更糟。
 *
 * 按构造 `matchDishes` 只在拿到合法 `per100g` 时才产出 `web:` 项,所以下面
 * 这一组夹具是**手搓**的:它模拟的正是「某一层把字段吃掉了」之后的下场。
 * 这个探测器存在的意义不是兜底,是让下一次那类 bug 有个响声。
 */
const lostWeb = derive.findLostWebNutrition([mkEntry('lw1', [mkItem(webId, '土豆炖牛肉')])])
check('web 项缺 per100g **必须**被抓出来', lostWeb.length === 1, JSON.stringify(lostWeb))
check('抓出来的这条带出菜名(界面上要写清是哪道菜)', lostWeb[0]?.name === '土豆炖牛肉', String(lostWeb[0]?.name))
check(
  '带着 per100g 的 web 项不算丢(否则每道库外菜都报一次)',
  derive.findLostWebNutrition([mkEntry('lw2', [webItem])]).length === 0,
  JSON.stringify(derive.findLostWebNutrition([mkEntry('lw2', [webItem])])),
)
check('普通库里食物不算丢', derive.findLostWebNutrition([mkEntry('lw3', [mkItem('rice', '米饭')])]).length === 0)
check('哨兵项不算丢(那是另一个探测器的事)', derive.findLostWebNutrition(sentinelMeals).length === 0)
check('种子数据零丢失', derive.findLostWebNutrition(state().meals).length === 0)
/**
 * 两个探测器的射程**必须不相交** —— 同一道菜同时出现在两张警告卡上,
 * 用户会以为有两处坏了。判据各用各的前缀,这里把那条不变量钉住。
 */
check(
  '两个探测器射程不相交',
  derive.findBrokenRefs([mkEntry('x1', [mkItem(webId, '土豆炖牛肉')])]).length === 0 &&
    derive.findLostWebNutrition([mkEntry('x2', [mkItem('not-a-real-id', '幽灵菜')])]).length === 0,
)

/* ---------- 扩库时的手滑 ----------
 * 这一条是给**改食物库的人**准备的护栏:重复 id 会让 FOOD_BY_ID 里少一条
 * (Map 后写的覆盖先写的),于是库里明明有、却匹配不到 —— 而删掉重复项
 * 的「修正」正好会制造上面那种幽灵条目。所以先在这里拦住。
 */
check(
  '食物库没有重复 id',
  FOOD_BY_ID.size === FOODS.length,
  `${FOODS.length} 条食物 / ${FOOD_BY_ID.size} 个 id`,
)

console.log('\n=== 5. 分区与日期 ===')
const d = date.lastNDays(7)
check('lastNDays 升序且长度正确', d.length === 7 && d[0] < d[6], `${d[0]} → ${d[6]}`)
check('最后一天是今天', d[6] === today)
check('fromISODate/toISODate 往返一致', date.toISODate(date.fromISODate(today)) === today)

/* ============================================================
   6. 发给 agent 的上下文
   ------------------------------------------------------------
   工作流第一步是 json.loads(sys.query),所以这段 JSON 的字段名和取值口径
   直接决定拦截灵不灵。这里盯三件事:
     · 数字和界面同源 —— 不然模型复述的数和它自己的推导对不上
     · 不发姓名
     · item 是裸词、severity 是英文枚举 —— 这两条错了拦截会**静默**失效
   ============================================================ */

console.log('\n=== 6. 发给 agent 的上下文 ===')

const { buildAgentQuery, buildChatQuery, SEND_PROFILE_TO_AGENT } = await load('/src/lib/agentContext.ts')

/** 固定时间,否则「缺哪几餐」会随跑的时辰变,断言就不稳 */
const FIXED_NOW = new Date(2026, 8, 19, 14, 30)
const QUESTION = '晚餐吃什么好？'

/** 解出来再断言 —— 只检查「字符串里含某个子串」放过的错误太多了 */
const q = JSON.parse(buildAgentQuery(state().profile, state().meals, { text: QUESTION, now: FIXED_NOW }))

check('是合法 JSON(节点 2 要 json.loads 它)', typeof q === 'object' && q !== null)
check('input.text 是用户原话', q.input.text === QUESTION, q.input.text)
check('input.images 是数组', Array.isArray(q.input.images) && q.input.images.length === 0)

/* ---------- 档案 ---------- */
const info = q.profile?.basicInfo ?? {}
check(
  'basicInfo 四个字段齐全',
  /* 发出去的是**年龄**(不是出生日期)—— 出生日期只是 App 内部存的形状 */
  info.age === ageOf(state().profile) &&
    info.gender === state().profile.gender &&
    info.heightCm === state().profile.height &&
    info.weightKg === state().profile.weight,
  JSON.stringify(info)
)

/**
 * item 必须是**裸词**。
 * 工作流判命中的写法是 `if item in haystack` —— 存「花生过敏」的话,
 * `"花生过敏" in "我吃了花生"` 是 False,过敏原拦截会静默失效,不报错。
 * 这条断言一红,就说明用户最需要的那层保护是假的。
 */
const r0 = (q.profile?.healthRestrictions ?? [])[0] ?? {}
check('忌口的 item 是裸词,不是「花生过敏」', r0.item === '花生', JSON.stringify(r0))
check('忌口带 type(决定该不该硬拦)', r0.type === 'allergy', String(r0.type))
check('severity 是英文枚举,不是「高危」', r0.severity === 'high', String(r0.severity))

/**
 * 目标要映射成工作流的枚举码。认不出的目标原样保留 ——
 * 丢掉一个真实健康目标,比多发一个模型看不懂的字符串糟得多。
 */
const goals = q.profile?.healthGoals ?? []
check('健康目标映射成枚举码', goals.includes('salt_control') && goals.includes('sugar_control'), JSON.stringify(goals))
check('默认目标的映射是满的,没有中文漏过去', !goals.some((g) => /[一-龥]/.test(g)), JSON.stringify(goals))

/**
 * 认不出的目标**原样保留** —— 不丢弃、也不猜一个最近的码。
 * 「备孕」是真信息,模型读中文毫无问题;硬映射成 balanced 才是编造事实。
 * 用户自定义目标是迟早的事,所以这条得盯住。
 */
const originalGoals = state().profile.goals
store.updateProfile({ goals: [...originalGoals, '备孕'] })
const custom = JSON.parse(buildAgentQuery(state().profile, [], { text: QUESTION, now: FIXED_NOW }))
check(
  '认不出的目标原样保留而不是被丢掉',
  (custom.profile?.healthGoals ?? []).includes('备孕') && (custom.profile?.healthGoals ?? []).includes('salt_control'),
  JSON.stringify(custom.profile?.healthGoals)
)
check('目标标记确实进得了 profile(否则上一条是假通过)', state().profile.goals.includes('备孕'))
store.updateProfile({ goals: originalGoals })

/**
 * 姓名是档案里的字段,但营养推理用不上 —— 发出去只是白给一条身份标识。
 * 用一个绝不可能出现在别处的字符串当名字,否则这条断言是自欺欺人:
 * 原来的名字是「我的档案」,它本来也不太可能出现在这段 JSON 里,测了等于没测。
 */
const MARKER = 'ZZ姓名标记ZZ'
const originalName = state().profile.name
store.updateProfile({ name: MARKER })
const withMarker = buildAgentQuery(state().profile, state().meals, { text: QUESTION, now: FIXED_NOW })
check('整段 JSON 里不含档案姓名', !withMarker.includes(MARKER), `档案名设为 ${MARKER}`)
check('姓名标记确实进得了 profile(否则上一条是假通过)', state().profile.name === MARKER)
store.updateProfile({ name: originalName })

/*
 * 这三个字段以前是**禁止出现**的 —— 那时的理由是「与其编一个空值让它以为你填了,
 * 不如不发」。现在档案页有了对应输入,所以断言反过来:它们是同一条原则的另半边。
 *
 * 注意这里问的是两个不同的问题:①填了的东西发不发得出去 ②没填的东西会不会被编。
 * 只留①的话,`specialNutrition` 这种**形状都猜不出来**的键哪天被顺手加上,没人拦得住。
 */
check(
  '填了的特殊时期/慢性病/饮食偏好真的发出去',
  'specialStage' in (q.profile ?? {}) &&
    'chronicConditions' in (q.profile ?? {}) &&
    Array.isArray(q.profile?.dietaryPreferences),
  Object.keys(q.profile ?? {}).join(',')
)

store.updateProfile({ specialStages: ['孕期'], chronicConditions: ['高血压'], dietaryPreferences: ['素食'] })
const filled = JSON.parse(buildAgentQuery(state().profile, [], { text: QUESTION, now: FIXED_NOW }))
check(
  '特殊时期映射成工作流词表里的码,而且是**列表**',
  JSON.stringify(filled.profile?.specialStage) === '["pregnancy"]',
  `${JSON.stringify(filled.profile?.specialStage)} —— 提示词里声明的是 specialStage[]（pregnancy/elderly/child/recovery）`
)
check(
  '慢性病与饮食偏好原样送达(中文,不映射)',
  JSON.stringify(filled.profile?.chronicConditions) === '["高血压"]' &&
    JSON.stringify(filled.profile?.dietaryPreferences) === '["素食"]',
  JSON.stringify({
    chronicConditions: filled.profile?.chronicConditions,
    dietaryPreferences: filled.profile?.dietaryPreferences,
  })
)
check(
  '慢性病**没有**被塞进 healthRestrictions',
  !(filled.profile?.healthRestrictions ?? []).some((r) => r.item === '高血压'),
  '忌口走的是裸词子串匹配,「高血压」不是一个能在菜名里搜到的词'
)

/**
 * `specialNutrition` 现在是**发**的。以前这里是禁止它出现,理由是形状猜不出来;
 * 2026-09-19 在工作流提示词里读到了它声明的形状(`specialNutrition[]`),所以
 * 断言从「禁止出现」升级成盯住**内容对不对**。
 *
 * 比的是 `quotaNotes()` 本身,不是写死的一段话:写死就是自证 —— 文案改了而断言
 * 没改、或者反过来,都看不出来。而这段文案是**印在档案页上**的同一份,它和配额
 * 算法分家正是最该防的事(见 agentContext.ts 那段)。
 */
check(
  'specialNutrition 与 quotaNotes() 同源(不是另写的一份文案)',
  JSON.stringify(filled.profile?.specialNutrition) ===
    JSON.stringify(quotaNotesOf(state().profile).map((n) => n.basis)),
  JSON.stringify(filled.profile?.specialNutrition)
)
check(
  'specialNutrition 里真的有孕期那条依据(否则上一条是空对空)',
  (filled.profile?.specialNutrition ?? []).some((s) => /300\s*kcal/.test(s)),
  JSON.stringify(filled.profile?.specialNutrition)
)

/**
 * 对不上词表的特殊时期**原样保留中文** —— 和「备孕」那条同一个规矩。
 *
 * 哺乳期在工作流那个词表(`pregnancy/elderly/child/recovery`)里没有对应的码,
 * 硬映射成 `pregnancy` 是编造事实:两者要加的分别是 +500 和 +300 kcal。
 * 这里同时盯住「没被套上一个最近的码」和「增量那句话仍然带得上」。
 */
store.updateProfile({ specialStages: ['哺乳期'], chronicConditions: [], dietaryPreferences: [] })
const nursing = JSON.parse(buildAgentQuery(state().profile, [], { text: QUESTION, now: FIXED_NOW }))
check(
  '词表里没有的特殊时期原样发中文,不硬套一个最近的码',
  JSON.stringify(nursing.profile?.specialStage) === '["哺乳期"]',
  JSON.stringify(nursing.profile?.specialStage)
)
check(
  '哺乳期的特殊营养里带着它自己的增量(说明没被当成孕期)',
  (nursing.profile?.specialNutrition ?? []).some((s) => /500\s*kcal/.test(s)) &&
    !(nursing.profile?.specialNutrition ?? []).some((s) => /300\s*kcal/.test(s)),
  JSON.stringify(nursing.profile?.specialNutrition)
)

/*
 * 2026-09-20:特殊阶段的预设换成了「自己能确认」的那几项,顺带把工作流那个
 * 词表里**一直没人用**的三个码接上了。这条测的就是那次接线的两头:
 *
 *   · 青少年 / 老年 / 术后康复 → child / elderly / recovery
 *   · 术前准备 → 那个词表里没有对应的码,原样发中文(和哺乳期一个待遇)
 *
 * 为什么值得单独测:映射表里拼错一个键,表现是**原样发中文** —— 模型读得懂,
 * 所以既不会报错也不会答错,只是工作流那段提示词里声明的枚举永远匹配不上。
 * 这正是本仓库反复在防的那类「静默降级」。
 */
store.updateProfile({ specialStages: ['青少年', '老年', '术后康复', '术前准备'] })
const stages = JSON.parse(buildAgentQuery(state().profile, [], { text: QUESTION, now: FIXED_NOW }))
check(
  '**工作流词表里空着的那三个码接上了**(青少年/老年/术后康复)',
  JSON.stringify(stages.profile?.specialStage) === '["child","elderly","recovery","术前准备"]',
  `${JSON.stringify(stages.profile?.specialStage)} —— 词表里没有码的「术前准备」原样发中文`
)
check(
  '**多选的特殊阶段一个都不丢**(数组长度对得上档案)',
  (stages.profile?.specialStage ?? []).length === 4,
  '以前是单值,几个阶段只会发出去一个'
)

/*
 * `无` 在列表里的正确写法是**空列表** ——「无」不在那个词表里,往列表里放一个
 * 词表外的字面量才是编数据。键照发,值为空,和 `healthRestrictions: []` 一致。
 * (2026-09-20 起这不再是「一个取值映射成空列表」:特殊阶段改成了多选,
 *  `[]` 就是它本来的形状 —— 这条断言盯的东西没变,只是来的路上少了一步。)
 *
 * 注意这条**和上面「填了的字段真的发出去」不冲突**:那个 check 问的是键在不在
 * (`'specialStage' in profile`),这里问的是值该是什么。
 */
store.updateProfile({ specialStages: [] })
const noStage = JSON.parse(buildAgentQuery(state().profile, [], { text: QUESTION, now: FIXED_NOW }))
check(
  '特殊时期是「无」时发空列表,键仍然在',
  'specialStage' in (noStage.profile ?? {}) &&
    Array.isArray(noStage.profile?.specialStage) &&
    noStage.profile.specialStage.length === 0,
  JSON.stringify(noStage.profile?.specialStage)
)
check(
  '没有生效调整时 specialNutrition 是空列表而不是缺席',
  Array.isArray(noStage.profile?.specialNutrition) && noStage.profile.specialNutrition.length === 0,
  JSON.stringify(noStage.profile?.specialNutrition)
)

/* ---------- 当天摄入 ---------- */
/**
 * 和界面同源同口径 —— 只检查「有没有写成数字」不够,数字对不上照样蒙混过关。
 * 所以拿 dayStats 反算一遍,确认发出去的确实是算出来的。
 */
const intake = q.todayIntake ?? {}
const stats = derive.dayStats(state().meals, date.toISODate(FIXED_NOW), state().profile)
check(
  '按本地日期取当天,不是 UTC',
  intake.date === date.toISODate(FIXED_NOW),
  `${intake.date} vs ${date.toISODate(FIXED_NOW)}`
)
check('钠与 dayStats 同源', intake.total?.sodium === Math.round(stats.nutrition.sodium), `${intake.total?.sodium} vs ${Math.round(stats.nutrition.sodium)}`)
check('热量与 dayStats 同源', intake.total?.kcal === Math.round(stats.nutrition.kcal), `${intake.total?.kcal} vs ${Math.round(stats.nutrition.kcal)}`)
check('配额取的是档案里的目标', intake.quota?.sodium === state().profile.quota.sodium, String(intake.quota?.sodium))
check(
  '食物展开到「名字 + 克数」这一层',
  (intake.meals ?? []).length > 0 &&
    intake.meals.every((m) => m.items.every((i) => typeof i.name === 'string' && typeof i.grams === 'number')),
  JSON.stringify(intake.meals?.[0] ?? null)
)
check('不把浮点数发给模型', Object.values(intake.total ?? {}).every(Number.isInteger), JSON.stringify(intake.total))

/* ---------- 缺餐与空记录 ---------- */
const fullDay = ['早餐', '午餐', '晚餐'].map((slot, i) => ({
  id: `v${i}`,
  // 必须跟着 FIXED_NOW 的日子走,不能取真实的今天 —— 上面那句「固定时间,
  // 否则缺哪几餐会随跑的时辰变」只有在这两处用同一个日期时才成立。
  // 用 todayISO() 的话,这个断言只在写它的那一天是绿的。
  date: date.toISODate(FIXED_NOW),
  slot,
  time: '08:00',
  source: '手动记录',
  items: [{ foodId: 'rice', name: '米饭', grams: 100 }],
  createdAt: i,
}))
const full = JSON.parse(buildAgentQuery(state().profile, fullDay, { text: QUESTION, now: FIXED_NOW }))
check('三餐记满后不再报缺餐', (full.todayIntake?.missingSlots ?? []).length === 0, JSON.stringify(full.todayIntake?.missingSlots))

const blank = JSON.parse(buildAgentQuery(state().profile, [], { text: QUESTION, now: FIXED_NOW }))
check('无记录时仍是合法 JSON,meals 为空数组', Array.isArray(blank.todayIntake?.meals) && blank.todayIntake.meals.length === 0)
check('无记录时点名缺三餐', (blank.todayIntake?.missingSlots ?? []).length === 3, JSON.stringify(blank.todayIntake?.missingSlots))

/*
  ⚠️ 三顿加餐**不算「缺了一餐」** —— 「上午加餐待记录」不是一句该说的话。
  这一条和 `daySummary` 那句是同一件事的两处(`agentContext` 和 `derive`),
  判据都走 `MAIN_SLOTS`。弄红它:把 `missingSlots` 换成 `MEAL_SLOTS`。
*/
const onlySnackDay = [
  {
    id: 'os-1',
    date: date.toISODate(FIXED_NOW),
    slot: '上午加餐',
    time: '10:00',
    source: '手动记录',
    items: [{ foodId: 'apple', name: '苹果', grams: 150 }],
    createdAt: 1,
  },
]
const onlySnack = JSON.parse(buildAgentQuery(state().profile, onlySnackDay, { text: QUESTION, now: FIXED_NOW }))
check(
  '**只记了加餐时,缺的仍然是三餐**（加餐不参与「缺哪一餐」）',
  JSON.stringify(onlySnack.todayIntake?.missingSlots) === JSON.stringify(MAIN_SLOTS),
  JSON.stringify(onlySnack.todayIntake?.missingSlots)
)
check(
  '那一餐照常发出去,而且 slotCode 是 `snack`',
  onlySnack.todayIntake?.meals?.[0]?.slot === '上午加餐' && onlySnack.todayIntake?.meals?.[0]?.slotCode === 'snack',
  JSON.stringify(onlySnack.todayIntake?.meals?.[0] ?? null)
)

/*
  **每个餐次都有一个码,而且没有表外的值。** 线上工作流今天不认这个字段
  (2026-09-22 在 `dify/` 里搜过,没有一处引用),所以这条断的不是「模型读得懂」,
  而是「三档加餐都归到 `snack`、三餐各自有自己的码」—— 少一个的话
  `SLOT_CODES[s.slot] ?? s.slot` 会把中文原样发出去,那**不会报错**。
*/
const codes = {
  早餐: 'breakfast', 午餐: 'lunch', 晚餐: 'dinner',
  上午加餐: 'snack', 下午加餐: 'snack', 夜宵: 'snack',
}
const codedDay = MEAL_SLOTS.map((slot, i) => ({
  id: `cd-${i}`,
  date: date.toISODate(FIXED_NOW),
  slot,
  time: '12:00',
  source: '手动记录',
  items: [{ foodId: 'rice', name: '米饭', grams: 100 }],
  createdAt: i,
}))
const coded = JSON.parse(buildAgentQuery(state().profile, codedDay, { text: QUESTION, now: FIXED_NOW }))
const codeWrong = (coded.todayIntake?.meals ?? []).filter((m) => m.slotCode !== codes[m.slot])
check(
  '**每个餐次都有自己的英文码,三顿加餐都是 `snack`**',
  (coded.todayIntake?.meals ?? []).length === 6 && codeWrong.length === 0,
  codeWrong.length ? codeWrong.map((m) => `${m.slot}→${m.slotCode}`).join('; ') : (coded.todayIntake?.meals ?? []).map((m) => m.slotCode).join(' ')
)
check(
  '发出去的是英文码,不是中文（兜底那半句 `?? s.slot` 没被走到）',
  (coded.todayIntake?.meals ?? []).every((m) => /^[a-z]+$/.test(m.slotCode)),
  (coded.todayIntake?.meals ?? []).map((m) => m.slotCode).join(' ')
)
check(
  '**六个餐次都发得出去,一个不漏**（顺序按时间,加餐插在两餐之间）',
  JSON.stringify((coded.todayIntake?.meals ?? []).map((m) => m.slot)) === JSON.stringify(MEAL_SLOTS),
  JSON.stringify((coded.todayIntake?.meals ?? []).map((m) => m.slot))
)
check('无记录时 total 是 0 而不是 undefined', blank.todayIntake?.total?.kcal === 0, String(blank.todayIntake?.total?.kcal))

/* ---------- mode ---------- */
/**
 * 不传就整个键都不出现 —— 发一个 null 过去是在替模型做决定。
 * 实测同一句话两次可能返回不同的 mode,所以对话页故意不传,让模型自己判。
 */
check('不传 mode 时键不出现', !('mode' in q), Object.keys(q).join(','))
check(
  '显式传 mode 时带上',
  JSON.parse(buildAgentQuery(state().profile, [], { text: QUESTION, mode: 'plate', now: FIXED_NOW })).mode === 'plate'
)

/* ---------- 开关 ---------- */
/**
 * 这个开关必须是**有意为之**的值,不能是随手改的。
 *
 * 它现在是 true —— 上游节点 7 修好之后打开的(见 agentContext.ts 里那段
 * 验证记录)。断言写死在这里,是为了让「谁把它关了」或「谁把它开了」
 * 立刻现形,而不是等到演示当天才发现 agent 读不到档案(or 反过来问什么都
 * 已拦截)。改这个开关时,这条断言会红,提醒你回去看一眼那段注释。
 */
check('把档案发给 agent 的开关是开着的', SEND_PROFILE_TO_AGENT === true, String(SEND_PROFILE_TO_AGENT))

/* ---------- 对话那份 query:大白话,不是 JSON ---------- */
/**
 * 2026-09-23 对话换成膳享+ 之后新加的一份 —— 和上面那份 JSON 是**两个应用的
 * 两种输入**,理由写在 `agentContext.ts` 的文件头。这里盯住四件事:
 *
 *   ① 它不能长得像 JSON:膳享+ 没有 `json.loads` 那一步,实测把 JSON 原样发给它,
 *      它会把 `profile` 里的忌口读成「用户吃了这些」,直接回 `blocked: true`。
 *   ② 用词必须是**档案页上的原话**(控盐 / 高危),不是工作流的枚举码
 *      (salt_control / high)—— 码是给食衡的代码节点比较用的,膳享+ 只读文字。
 *   ③ 开头那句「这是**我的情况**,不是我这餐吃的东西」是**功能性的**,不是客套:
 *      它是实测下来能稳定绕开那次误拦的那一句。
 *   ④ 没有的档案项整行不出现(写「饮食偏好:无」会让模型以为用户声明过没有偏好),
 *      一餐都没记时是**一句话**,不是一个空表。
 *
 * 用**显式构造的档案**,不搭种子的形状 —— 种子改了不该让这几条跟着飘。
 */
console.log('\n=== 6b. 对话那份 query（大白话） ===')

const chatProfile = {
  ...state().profile,
  goals: ['控盐', '控糖'],
  restrictions: [{ item: '花生', type: 'allergy', level: '高危' }],
  notes: '',
}
const chatQuery = buildChatQuery(chatProfile, state().meals, { text: QUESTION, now: FIXED_NOW })
const chatEmpty = buildChatQuery(chatProfile, [], { text: QUESTION, now: FIXED_NOW })

// ⚠️ 结尾这对 `()` 不能省 —— 少了它 `chatParsesAsJson` 拿到的是**函数本身**,
// 永远为真,这条断言就变成了永远红(或者配合 `!` 时永远绿)的空转
const chatParsesAsJson = (() => {
  try {
    JSON.parse(chatQuery)
    return true
  } catch {
    return false
  }
})()
const chatFirstChar = chatQuery.trimStart()[0]
check(
  '**对话那份不是 JSON**（膳享+ 会把 JSON 里的档案读成「用户吃了这些忌口」）',
  chatParsesAsJson === false && chatFirstChar !== '{',
  `JSON.parse 成功=${chatParsesAsJson} 首字=${JSON.stringify(chatFirstChar)}`
)
check(
  '开头声明了「这是我的情况，不是这餐吃的」',
  chatQuery.split('\n')[0].includes('不是我这餐吃的东西'),
  chatQuery.split('\n')[0]
)
check(
  '忌口写成中文原话「花生（高危）」，不是 severity 枚举',
  chatQuery.includes('花生（高危）') && !/\bhigh\b/.test(chatQuery)
)
check(
  '目标写成中文原话「控盐」，不是目标码',
  chatQuery.includes('控盐') && !chatQuery.includes('salt_control')
)
check('配额那行用的是屏幕上的说法（formatQuota 那套）', chatQuery.includes('钠上限'))
check('结尾是用户那句话本身', chatQuery.trimEnd().endsWith(QUESTION), chatQuery.slice(-30))
check(
  '**一餐都没记时是一句话，不是空表**',
  chatEmpty.includes('今天还没有记录任何一餐') && !chatEmpty.includes('今天合计'),
  chatEmpty.split('\n').slice(-4, -1).join('⏎')
)
check(
  '没有的档案项整行不出现（空 notes 不印「我要补充的：」）',
  !chatQuery.includes('我要补充的') && !chatEmpty.includes('我要补充的')
)

/* ---------- 对话页:不要整条拦下 ---------- */
/**
 * 2026-09-23 傍晚加的第五件,对应一个**用户在真实使用里撞到的 bug**:
 *
 *   档案里有鸡蛋(高危)+ 今天记录里恰好有一道含蛋的菜
 *   → 他问**任何**一句话,回来的都是「检测到高危食材/成分「鸡蛋」,已拦截」,
 *     屏幕上一条建议都没有。实测:同样的档案,今天记录里有蛋 → 打两次拦两次;
 *     把今天记录清空 → 打两次全放行。
 *
 * 根因是提示词第 1 步那句「severity = high 的过敏项**命中输入** → 直接返回
 * blocked: true」,而「输入」在模型眼里是**整段 query** —— 档案那几行和
 * 「我今天已经记录的」那几餐全在里面。拦的是「你今天已经吃过的东西」,
 * 不是「你这次问的东西」。
 *
 * 这里盯住替用户说的那两句话:基线那句**每次提问都得在**(它是主力,
 * 实测把 3 次里拦 3 次改成了 3 次放行),重问那次**多一句**把话说重的。
 */
const chatInsist = buildChatQuery(chatProfile, state().meals, { text: QUESTION, now: FIXED_NOW, insist: true })
check(
  '每次提问都说明「已经吃掉的不该整条拦下」',
  chatQuery.includes('不要整条拦下不回答') && chatEmpty.includes('不要整条拦下不回答')
)
check(
  '那句里点明了「已经记录的」是已经吃掉的，不是这次要评价的对象',
  chatQuery.includes('已经吃掉') && chatQuery.includes('不是你这次要评价的对象')
)
check(
  '重问那一次多一句把话说重的（基线那份不带它）',
  chatInsist.includes('不要返回 blocked: true') && !chatQuery.includes('不要返回 blocked: true')
)
/*
  「那两句排在用户那句话之前」**不另立断言** —— 上面那句老断言
  (`结尾是用户那句话本身`)已经盯着它了:谁把这两行挪到问题后面,它就会红。
  再写一条的话,除了多一处可能写错的地方,什么也挡不住。
*/

/* ---------- query 长度必须够一整天用 ---------- */
/**
 * 回归断言,对应一个**真实发生过的 bug**:上限原来是 1000,而
 * `buildAgentQuery` 的输出是随记录增长的 —— 种子数据 781 字没问题,
 * 记满一天就是 1145 字,于是对话和识别在用户越是认真记录的时候越会 400。
 *
 * 症状还特别容易看错方向:前端拿到 BAD_REQUEST 会切到本地回答并提示
 * 「agent 暂时不可用」,看起来像上游挂了,实际是本地这道闸卡错了。
 *
 * 上界直接取服务端的常量,不在这里写死一个数字 —— 否则两边迟早会飘。
 */
console.log('\n=== query 长度 ===')
const { MAX_QUERY_LENGTH } = await load('/api/_lib/agent.ts')

// 刻意用「加餐」凑满四餐、每餐四道菜 —— 这是一个人认真记录一天的真实量级,
// 也正是原来那道 1000 字上限会被撞破的地方
// (那一档现在叫「下午加餐」—— 六档之后写死旧取值会成一条表外的记录,
//  而这一节量的是 query 长度,长度照样算得出来,所以断不出来)
const busyItems = [...FOOD_BY_ID.values()].slice(0, 4).map((f) => ({
  foodId: f.id,
  name: f.name,
  grams: 150,
}))
const busyDay = ['早餐', '午餐', '晚餐', '下午加餐'].map((slot, i) => ({
  id: `busy-${i}`,
  date: today,
  slot,
  time: '12:30',
  source: '拍餐盘',
  items: busyItems,
  createdAt: Date.now() - i,
}))

/*
 * 档案也按**填满**算:特殊时期 + 三种慢性病 + 四条饮食偏好。
 * 这一段是新加上去的(query 里以前没有它们),所以长度预算要重新确认一次 ——
 * 「再加一份食物库目录约 1855 字也不到上限」那个估算就是在这条上失效的。
 */
const busyProfile = {
  ...state().profile,
  specialStages: ['孕期'],
  chronicConditions: ['高血压', '糖尿病', '高血脂'],
  dietaryPreferences: ['素食', '低GI', '不吃香菜', '早餐吃得少'],
}
const busyQuery = buildAgentQuery(busyProfile, busyDay, { text: QUESTION, mode: 'plate', now: FIXED_NOW })
check(
  `记满一天 + 填满档案后 query 仍在上限内(${busyQuery.length} / ${MAX_QUERY_LENGTH})`,
  busyQuery.length <= MAX_QUERY_LENGTH,
  busyQuery.length > MAX_QUERY_LENGTH ? '会 400 —— 用户记满一天就必然触发' : ''
)

/* ---------- 菜品名 → foodId ---------- */
/**
 * 「拍餐盘」这条路上最容易出错、也最难发现的一环:模型给的是菜名,
 * 营养计算只认 foodId。匹配错了不会报错,只会算出一个错的健康分。
 */
console.log('\n=== 菜品名匹配 ===')
const {
  matchDishes,
  normalizeDishName,
  isUnmatchedId,
  isWebId,
  countableItems,
  UNMATCHED_PREFIX,
  WEB_PREFIX,
  WEB_BASE_GRAMS,
  DISH_ALIASES,
} = dishMatch

const matchOne = (name) => matchDishes([{ name }]).detail[0]

/* ---------- 归一化:库里带括号,模型不带 ---------- */
check('剥掉括号注释', normalizeDishName('米饭(熟)') === '米饭', normalizeDishName('米饭(熟)'))
check('剥掉全角括号', normalizeDishName('番茄（生）') === '番茄', normalizeDishName('番茄（生）'))
check('剥掉 markdown 加粗', normalizeDishName('**红烧肉**') === '红烧肉', normalizeDishName('**红烧肉**'))
check('剥掉前置分量', normalizeDishName('一份红烧肉') === '红烧肉', normalizeDishName('一份红烧肉'))
check('剥掉前置克数', normalizeDishName('200g 米饭') === '米饭', normalizeDishName('200g 米饭'))

/* ---------- 精确(经归一化) ---------- */
const m1 = matchOne('米饭')
check('「米饭」命中 rice', m1.foodId === 'rice' && m1.via === 'exact', `${m1.foodId} / ${m1.via}`)
const m2 = matchOne('红薯')
check('「红薯」命中 sweet-potato', m2.foodId === 'sweet-potato', `${m2.foodId} / ${m2.via}`)
const m3 = matchOne('**红烧排骨**')
check('去 markdown 后命中 braised-ribs', m3.foodId === 'braised-ribs', `${m3.foodId} / ${m3.via}`)

/* ---------- 别名 ---------- */
const m4 = matchOne('白米饭')
check('「白米饭」经别名命中 rice', m4.foodId === 'rice' && m4.via === 'alias', `${m4.foodId} / ${m4.via}`)
const m5 = matchOne('西红柿炒鸡蛋')
check('「西红柿炒鸡蛋」命中 tomato-egg', m5.foodId === 'tomato-egg', `${m5.foodId} / ${m5.via}`)
const m6 = matchOne('水煮蛋')
check('「水煮蛋」命中 boiled-egg', m6.foodId === 'boiled-egg', `${m6.foodId} / ${m6.via}`)
const m7 = matchOne('豆浆')
check('「豆浆」命中 soy-milk', m7.foodId === 'soy-milk', `${m7.foodId} / ${m7.via}`)
const m8 = matchOne('西兰花')
check('「西兰花」命中 broccoli', m8.foodId === 'broccoli', `${m8.foodId} / ${m8.via}`)

/* ---------- 剥做法词:库名和模型说法只有做法不同 ---------- */
const m9 = matchOne('清炒西兰花')
check('「清炒西兰花」命中 broccoli(剥做法词)', m9.foodId === 'broccoli', `${m9.foodId} / ${m9.via}`)
const m10 = matchOne('清炒油麦菜')
check('「清炒油麦菜」命中 lettuce-stir', m10.foodId === 'lettuce-stir', `${m10.foodId} / ${m10.via}`)

/* ---------- 别名 + 双向包含 ----------
 * 「牛肉」走的是**别名**不是包含:别名表在包含之前,而表里有「牛肉」这一条。
 * 标签原来写的是「(包含)」—— 证据行打印的是 `braised-beef / alias`,和标签
 * 对不上。结论一样,但一个和证据不符的标签会让人以为覆盖了包含层,而其实没有。
 */
const m11 = matchOne('牛肉')
check('「牛肉」命中 braised-beef', m11.foodId === 'braised-beef', `${m11.foodId} / ${m11.via}`)
const m12 = matchOne('菠菜')
check('「菠菜」命中 spinach-garlic', m12.foodId === 'spinach-garlic', `${m12.foodId} / ${m12.via}`)

/* ---------- 「X汤」必须落到汤羹里 ----------
 * 这条规则是从实测长出来的,不是想出来的。加它之前,把一批真实菜名喂进
 * `npm run probe:dishes`(98 个),contains 那一层给出了两个**静默错配**:
 *
 *     番茄鸡蛋汤  →  番茄(生)     一道汤被算成一份生番茄
 *     玉米排骨汤  →  玉米(煮)     一道汤被算成一根玉米
 *
 * 落空会被界面标成「按 0 计」,错配不会 —— 用户看到的是一个偏低的热量和一个
 * 偏高的健康分,而屏幕上没有任何异常。所以宁可让它落空。
 *
 * 下面两条:第一条是那两道**已经给了别名的**汤必须落到汤羹;第二条是**没有**
 * 给别名的汤必须老老实实落空,而不是被 contains 层随手塞给一个蔬菜。
 */
const soupFixed = matchOne('番茄鸡蛋汤')
check('「番茄鸡蛋汤」落到汤羹,不是番茄(生)', soupFixed.foodId === 'seaweed-egg-soup', `${soupFixed.foodId} / ${soupFixed.via}`)
const soupCorn = matchOne('玉米排骨汤')
check('「玉米排骨汤」落到汤羹,不是玉米(煮)', soupCorn.foodId === 'wintermelon-soup', `${soupCorn.foodId} / ${soupCorn.via}`)
check('别名表里的汤全部指向汤羹那一类', Object.entries(DISH_ALIASES)
  .filter(([k]) => k.endsWith('汤'))
  .every(([, id]) => FOOD_BY_ID.get(id)?.category === '汤羹'))

/* ---------- 别名表自身的一致性 ----------
 * 两条断言,都不需要维护任何名单 —— 它们遍历整张表,所以**新加一条就自动被覆盖**。
 *
 *   1. 每个 value 都必须是库里真实存在的 id。写错一个字母,今天的行为是
 *      **静默退回按名字匹配** —— 那条别名悄无声息地失效,没有任何报错。
 *   2. 每个 key 自己走一遍完整匹配,必须落到它声明的那个 id。这条挡的是
 *      「这个 key 被前面某一层抢先命中成别的东西」—— 那样这张表就是在骗人。
 */
const aliasKeys = Object.keys(DISH_ALIASES)
const badTarget = aliasKeys.filter((k) => !FOOD_BY_ID.has(DISH_ALIASES[k]))
check('别名表每条都指向存在的 foodId', badTarget.length === 0,
  badTarget.map((k) => `${k}→${DISH_ALIASES[k]}`).join(' / '))

const shadowed = aliasKeys.filter((k) => matchOne(k).foodId !== DISH_ALIASES[k])
check('别名表每条都能落到它声明的那个 id(没被前面的层抢先)', shadowed.length === 0,
  shadowed.map((k) => `${k}→${matchOne(k).foodId}(表里写的是 ${DISH_ALIASES[k]})`).join(' / '))

/* ---------- 真实菜名的 golden 表 ----------
 * 上面的断言是**结构**上的(表指向对不对),这一张是**行为**上的:
 * 一个视觉模型看着中餐餐盘会说什么,逐条钉死它该落到哪。
 *
 * 这是唯一能挡住「改了一层,另一层的菜跟着跑偏」的东西 —— 五个匹配层互相
 * 之间有顺序耦合,单看某一层的断言察觉不到串味。
 *
 * `null` = **故意**让它落空。写 null 的每一条都是判断,不是遗漏:
 *   · 土豆炖牛肉 —— 库里只有卤牛肉,而土豆在这道菜里占一大半重量。
 *     映射过去等于把一份带主食的菜算成一小碟瘦肉,是个**看起来合理的错数字**。
 *     (它同时是「联网补营养」那条路的样板菜:库里落空 ≠ 按 0 计 ——
 *     如果上游查到了 per100g,它会落到 `web:` 那一条,见下面那一节。
 *     这张表在第 3 层(匹配)结束时就下结论,这里问的只是**匹配**的结果。)
 *   · 山药排骨汤 —— 它必须落空而不是被 contains 塞给某样蔬菜,见上面的 isSoup
 */
const GOLDEN = [
  ['米饭', 'rice'], ['白米饭', 'rice'], ['一碗米饭', 'rice'], ['200g米饭', 'rice'],
  ['糙米饭', 'brown-rice'], ['杂粮饭', 'brown-rice'], ['炒饭', 'rice'], ['蛋炒饭', 'rice'],
  ['面条', 'noodles'], ['牛肉面', 'noodles'], ['兰州拉面', 'noodles'], ['炒面', 'noodles'],
  ['小米粥', 'congee'], ['燕麦粥', 'oatmeal'], ['花卷', 'mantou'], ['吐司', 'whole-wheat-bread'],
  ['水饺', 'dumpling'], ['西瓜', 'watermelon'],
  ['水煮蛋', 'boiled-egg'], ['荷包蛋', 'fried-egg'], ['豆浆', 'soy-milk'], ['嫩豆腐', 'tofu-soft'],
  ['红烧肉', 'braised-pork'], ['糖醋排骨', 'braised-ribs'], ['梅菜扣肉', 'braised-pork'],
  ['京酱肉丝', 'pepper-pork'], ['糖醋里脊', 'pepper-pork'], ['黑椒牛柳', 'braised-beef'],
  ['香煎鸡胸肉', 'boiled-chicken'], ['番茄炒蛋', 'tomato-egg'],
  ['清蒸鲈鱼', 'steamed-fish'], ['蒜蓉粉丝蒸虾', 'boiled-shrimp'], ['酸菜鱼', 'boiled-fish-spicy'],
  ['清炒西兰花', 'broccoli'], ['干锅花菜', 'stir-veggies'], ['上汤娃娃菜', 'stir-veggies'],
  ['蚝油生菜', 'stir-veggies'], ['麻婆豆腐', 'mapo-tofu'], ['凉拌黄瓜', 'cucumber-salad'],
  ['圣女果', 'tomato-raw'],
  ['番茄鸡蛋汤', 'seaweed-egg-soup'], ['罗宋汤', 'tomato-beef-soup'],
  ['玉米排骨汤', 'wintermelon-soup'], ['冬瓜排骨汤', 'wintermelon-soup'],
  ['橙汁', 'orange-juice'], ['珍珠奶茶', 'bubble-tea'], ['黑巧克力', 'chocolate'],
  ['炒花生米', 'peanut'],
  // 故意落空的
  ['土豆炖牛肉', null], ['豆腐菌菇汤', null], ['煎饼果子', null],
  // 没有别名的汤 —— 落空,而不是被 contains 塞给某样蔬菜
  ['山药排骨汤', null],
]

const goldenBad = []
for (const [dish, want] of GOLDEN) {
  const got = matchOne(dish)
  const gotId = isUnmatchedId(got.foodId) ? null : got.foodId
  if (gotId !== want) goldenBad.push(`${dish}: 期望 ${want ?? '未收录'},实际 ${gotId ?? '未收录'}(${got.via})`)
}
check(`golden 表逐条对上(${GOLDEN.length} 条)`, goldenBad.length === 0, goldenBad.join(' / '))

/**
 * 落空的那几条**必须有克数 0 且在 unmatched 里** —— 否则结果页不会显示
 * 「按 0 计」那行警告,而热量会静静地少一块。
 */
const designed = GOLDEN.filter(([, want]) => want === null).map(([dish]) => dish)
const designedResult = matchDishes(designed.map((name) => ({ name })))
check('故意落空的菜全在 unmatched 里', designed.every((d) => designedResult.unmatched.includes(d)),
  designedResult.unmatched.join(' / '))

/* ---------- 匹配不上要明说,不能猜 ---------- */
const miss = matchDishes([{ name: '豆腐菌菇汤' }, { name: '清炒藕片' }])
check(
  '库外的菜进 unmatched',
  miss.unmatched.includes('豆腐菌菇汤') && miss.unmatched.includes('清炒藕片'),
  miss.unmatched.join(' / ')
)
check(
  '**没带联网营养的**库外菜不在 items 里参与营养计算',
  miss.items.every((i) => isUnmatchedId(i.foodId) && i.grams === 0),
  miss.items.map((i) => `${i.foodId}@${i.grams}g`).join(',')
)
check(
  '哨兵 id 带前缀且逐项唯一',
  miss.items.length === 2 && new Set(miss.items.map((i) => i.foodId)).size === 2,
  miss.items.map((i) => i.foodId).join(',')
)
check('哨兵前缀是约定的那个', UNMATCHED_PREFIX === 'unmatched:', UNMATCHED_PREFIX)

/* ============================================================
   库外菜的第二种下场:联网查到了营养
   ------------------------------------------------------------
   库里没有的菜现在分两条路,而**走哪条只取决于上游有没有查到值**:

     查到(per100g + source) → `web:<菜名>`  → 有营养,界面标「联网估算」
     没查到                   → `unmatched:<菜名>` → 按 0 计,界面给警告条

   这一节把两条路的边界钉死。最要紧的两条:
     · **库内优先** —— 同一个字段给了两种来源时必须信食物库那条
     · **同名累加** —— 覆盖会让一整份菜静默消失(热量少一半,看不出来)
   ============================================================ */
console.log('\n=== 库外菜:联网查到营养 ===')

const WEB_A = { kcal: 168, protein: 12.5, carb: 6, fat: 9.8, sodium: 430, sugar: 1.2 }
const WEB_B = { kcal: 200, protein: 10, carb: 8, fat: 12, sodium: 500, sugar: 2 }

/** 基本路径:「土豆炖牛肉」正是 golden 表里那条**故意落空**的菜 */
const web = matchDishes([{ name: '土豆炖牛肉', per100g: WEB_A, source: '薄荷健康' }])
/**
 * 走哪条路要看 `detail` 不是 `items` —— `MealItem` 上没有 `via` 这个字段
 * (`via` 是 `matchDishes` 回给调用方看的诊断信息,落盘时不存)。
 * 读 `items[i].via` 恒为 undefined,断言会**永远红**或者更糟:写成
 * `!== 'web'` 就永远是绿的。
 */
check('查到营养的库外菜走 web 那条路', web.detail[0]?.via === 'web', String(web.detail[0]?.via))
check('id 带 web 前缀(不是 unmatched)', web.items[0]?.foodId === `web:土豆炖牛肉`, String(web.items[0]?.foodId))
check(
  '前缀契约:是 web,不是 unmatched',
  isWebId(web.items[0].foodId) && !isUnmatchedId(web.items[0].foodId),
  String(web.items[0]?.foodId),
)
check('不进 unmatched(结果页不会对着真数字说按 0 计)', web.unmatched.length === 0, JSON.stringify(web.unmatched))
check(`克数落到基准 ${WEB_BASE_GRAMS}g`, web.items[0]?.grams === WEB_BASE_GRAMS, String(web.items[0]?.grams))
check('每 100g 值与出处挂在条目上', web.items[0]?.per100g?.kcal === 168 && web.items[0]?.source === '薄荷健康',
  `${web.items[0]?.per100g?.kcal} / ${web.items[0]?.source}`)
/** 它和哨兵项**必须**被 `countableItems` 分成两类 —— 那是三处判据共用的那个函数 */
check('countableItems 认它、不认哨兵',
  countableItems([web.items[0], { foodId: sentinelId, name: '清炒藕片', grams: 0 }]).length === 1,
  String(countableItems([web.items[0], { foodId: sentinelId, name: '清炒藕片', grams: 0 }]).length))

/** 反过来的半边契约:哨兵项不该被当成 web */
check('哨兵项不是 web', !isWebId(sentinelId) && isUnmatchedId(sentinelId), sentinelId)

/**
 * **库内优先。** 一道菜同时给了 foodId(或名字能匹配到库里)和 per100g 时,
 * 必须走食物库那条,而且两个键**都不该出现在条目上** ——
 * 食物库那 58 条是同一把尺子量出来的,搜索来的值不是。
 * (同 Dify 侧「合并营养」节点里的 `if d.get("foodId"): continue`。)
 */
const libFirst = matchDishes([{ name: '米饭', per100g: WEB_B, source: '瞎编的网页' }])
check('库里匹配到时联网值不参与', libFirst.items[0]?.foodId === 'rice' && libFirst.detail[0]?.via === 'exact',
  `${libFirst.items[0]?.foodId} / ${libFirst.detail[0]?.via}`)
check('库里匹配到时两个键都不挂在条目上',
  libFirst.items[0]?.per100g === undefined && libFirst.items[0]?.source === undefined,
  JSON.stringify(libFirst.items[0]))

/**
 * **同名累加,不能覆盖。** 哨兵那条分支用 `set` 是无害的(grams 恒为 0),
 * web 这条不是:两道归一化后同名的菜走覆盖,就是整个丢掉一份 ——
 * 热量直接少一半,而结果页上只是「一道菜」,看不出少了什么。
 *
 * `「一份土豆炖牛肉」` 和 `「土豆炖牛肉」` 归一化后是同一个名字
 * (normalizeDishName 会剥掉数量词),所以它们必须合成一项、克数相加。
 */
const sameName = matchDishes([
  { name: '土豆炖牛肉', per100g: WEB_A, source: '薄荷健康' },
  { name: '一份土豆炖牛肉', per100g: WEB_A, source: '薄荷健康' },
])
check('同名库外菜合并成一项', sameName.items.length === 1, `${sameName.items.length} 项`)
check('同名库外菜克数相加(不是被覆盖)',
  sameName.items[0]?.grams === WEB_BASE_GRAMS * 2,
  `${sameName.items[0]?.grams}(基准 ${WEB_BASE_GRAMS})`)

/**
 * 两份的 `per100g` 不一样时:**先到者赢**。
 * 「这道菜每 100g 是多少」在这一项里是**身份** —— 两份来自不同网页的检索值
 * 谁更对,这里判不了,所以不改写已经确立的那个。克数照加。
 */
const twoSources = matchDishes([
  { name: '土豆炖牛肉', per100g: WEB_A, source: '薄荷健康' },
  { name: '土豆炖牛肉', per100g: WEB_B, source: '另一个网页' },
])
check('两份值不同时先到者赢', twoSources.items[0]?.per100g?.kcal === 168, String(twoSources.items[0]?.per100g?.kcal))
check('先到者赢时出处也跟着第一份', twoSources.items[0]?.source === '薄荷健康', String(twoSources.items[0]?.source))
check('先到者赢不影响克数累加', twoSources.items[0]?.grams === WEB_BASE_GRAMS * 2, String(twoSources.items[0]?.grams))

/**
 * 只有一半的字段 → 当作没查到。没有出处的数字不许进计算。
 * (解析层 `asPer100g` 已经拦了一道,这里是匹配层自己的那一半:
 *  `DishInput` 是公开接口,别处也能构造。)
 */
const halfWeb = matchDishes([{ name: '土豆炖牛肉', per100g: WEB_A }])
check('只有 per100g 没有 source → 退回哨兵', isUnmatchedId(halfWeb.items[0]?.foodId), String(halfWeb.items[0]?.foodId))
const emptySource = matchDishes([{ name: '土豆炖牛肉', per100g: WEB_A, source: '  ' }])
check('source 是空白 → 退回哨兵', isUnmatchedId(emptySource.items[0]?.foodId), String(emptySource.items[0]?.foodId))

/** 模型真的给了克数时,库外菜也照用(与库内菜同一条规矩),但照样过夹取 */
const webGrams = matchDishes([{ name: '土豆炖牛肉', grams: 250, per100g: WEB_A, source: '薄荷健康' }])
check('模型给了克数就用模型的', webGrams.items[0]?.grams === 250, String(webGrams.items[0]?.grams))
/**
 * 离谱的克数 —— `clampGrams` 是**拒收**不是夹取:超出 [5,1000] 就整个退回落差参数,
 * 不会给你一个 1000。所以这里的期望值是 `WEB_BASE_GRAMS`,不是 1000。
 * (库内菜那一侧同一条规矩,只是落回的是 `defaultGrams`。)
 */
const webClamped = matchDishes([{ name: '土豆炖牛肉', grams: 99999, per100g: WEB_A, source: '薄荷健康' }])
check('离谱的克数退回基准(库外菜也过同一道闸)', webClamped.items[0]?.grams === WEB_BASE_GRAMS,
  String(webClamped.items[0]?.grams))

/* ---------- 同一 foodId 必须合并 ---------- */
/**
 * 两道菜落到同一个 foodId 时不合并,`MealSheet` 会用 `key={item.foodId}`
 * 渲染出重复 key —— 分量步进按钮会同时改好几行,而且不报错。
 */
const dup = matchDishes([{ name: '米饭' }, { name: '白米饭' }])
check('同 foodId 合并成一项', dup.items.length === 1, `${dup.items.length} 项`)
check('合并时克数相加', dup.items[0]?.grams === 300, String(dup.items[0]?.grams))
check('合并按 foodId 去重后无重复 key', new Set(dup.items.map((i) => i.foodId)).size === dup.items.length)

/* ---------- 组合名必须拆开 ---------- */
/**
 * 这两个夹具是**实测回来的**:一张纯色图走真实链路,工作流落到推荐分支,
 * dishes 里是一餐的组合名。不拆的话 findContains 会把整串当成一道菜,
 * 取「包含得更长」的那个 —— 「清蒸鱼 + 白灼西兰花 + 米饭」变成一条西兰花,
 * 鱼和米饭静默消失。那种错不会进 unmatched,界面上完全看不出来。
 */
const combo = matchDishes([{ name: '清蒸鱼 + 白灼西兰花 + 米饭' }])
check('组合名被拆成三道菜', combo.items.length === 3, combo.items.map((i) => i.name).join(' / '))
check(
  '拆开后「白灼西兰花」命中 broccoli',
  combo.items.some((i) => i.foodId === 'broccoli'),
  combo.items.map((i) => i.foodId).join(',')
)
check(
  '拆开后「米饭」命中 rice',
  combo.items.some((i) => i.foodId === 'rice'),
  combo.items.map((i) => i.foodId).join(',')
)
/** 拆开后整串名字不再作为一个菜名出现 */
check(
  '整串组合名不再出现在结果里',
  !combo.items.some((i) => i.name.includes('+')),
  combo.items.map((i) => i.name).join(' / ')
)

const combo2 = matchDishes([{ name: '燕麦粥 + 煮鸡蛋 + 牛奶' }])
check('中文顿号之外的组合也能拆', combo2.items.length === 3, String(combo2.items.length))
check(
  '拆开后各自命中(燕麦粥→oatmeal)',
  combo2.items.some((i) => i.foodId === 'oatmeal'),
  combo2.items.map((i) => i.foodId).join(',')
)

// 顿号也算组合名 —— 它只出现在枚举里,不会出现在单个菜名里
const combo3 = matchDishes([{ name: '米饭、清炒西兰花' }])
check('顿号分隔的组合名也拆', combo3.items.length === 2, String(combo3.items.length))

/**
 * 但模型给了克数时**不许拆** —— 那是整份的克数,拆成三份各自带上就是三倍,
 * 一份组合菜会顶掉大半天的热量配额,而且看不出来。
 */
const comboGrams = matchDishes([{ name: '米饭 + 白灼西兰花', grams: 200 }])
check('带克数的组合名不拆(避免克数翻倍)', comboGrams.items.length === 1, String(comboGrams.items.length))

// 模型明确指了 foodId 时不拆 —— 它指的是一个食物,不该被拆成三个
const comboId = matchDishes([{ name: '米饭 + 白灼西兰花', foodId: 'rice' }])
check('带 foodId 的组合名不拆', comboId.items.length === 1, String(comboId.items.length))

/** 逗号**不算**分隔符 —— 那更可能是模型接的一句解释,不是第二道菜 */
const notCombo = matchDishes([{ name: '红烧肉，肥而不腻' }])
check(
  '逗号后面的话不会被当成一道菜',
  !notCombo.unmatched.includes('肥而不腻'),
  notCombo.unmatched.join(' / ')
)

/* ---------- 克数:有就用、离谱就夹、没有就用库里的默认值 ---------- */
const g1 = matchDishes([{ name: '米饭', grams: 200 }]).items[0]
check('模型给的克数被采用', g1.grams === 200, String(g1.grams))
const g2 = matchDishes([{ name: '米饭', grams: 1500 }]).items[0]
check('离谱克数夹回默认值', g2.grams === FOOD_BY_ID.get('rice').defaultGrams, String(g2.grams))
const g3 = matchDishes([{ name: '米饭', grams: '150g' }]).items[0]
check('字符串克数能解析', g3.grams === 150, String(g3.grams))
const g4 = matchDishes([{ name: '米饭' }]).items[0]
check('没给克数时用食物库默认值', g4.grams === FOOD_BY_ID.get('rice').defaultGrams, String(g4.grams))
const g5 = matchDishes([{ name: '米饭', grams: 152 }]).items[0]
check('克数取整到 5g', g5.grams === 150, String(g5.grams))

/* ---------- 模型自报的 foodId 要被校验 ---------- */
const d1 = matchDishes([{ name: '某道菜', foodId: 'rice' }]).items[0]
check('模型报的合法 foodId 直接用', d1.foodId === 'rice', d1.foodId)
const d2 = matchDishes([{ name: '米饭', foodId: 'not-a-real-id' }]).items[0]
check(
  '模型编的 foodId 被拒、退回按名字匹配',
  d2.foodId === 'rice',
  d2.foodId
)

/* ---------- 展示的名字必须是用户真正吃的那道菜 ---------- */
/**
 * 营养按库里匹配到的那条算(那是有依据的近似),但名字不能用库里的 ——
 * 「清炒西兰花」匹配到「白灼西兰花」、「香煎鸡胸肉」匹配到「白切鸡」,
 * 名字跟着库里走的话,结果页会对着用户拍的东西报出另一道菜名。
 */
const named = matchDishes([{ name: '清炒西兰花' }, { name: '香煎鸡胸肉' }])
check(
  '展示名保留模型的说法,不被库名覆盖',
  named.items.map((i) => i.name).join(',') === '清炒西兰花,香煎鸡胸肉',
  named.items.map((i) => i.name).join(',')
)
check(
  '但营养仍按库里匹配到的那条算',
  named.items.every((i) => FOOD_BY_ID.has(i.foodId)),
  named.items.map((i) => i.foodId).join(',')
)

/* ---------- 每一个真实匹配都必须在食物库里 ---------- */
const realistic = matchDishes([
  { name: '红烧肉' },
  { name: '清炒西兰花' },
  { name: '米饭' },
  { name: '西红柿炒鸡蛋' },
  { name: '紫菜蛋花汤' },
  { name: '麻婆豆腐' },
  { name: '苹果' },
])
/**
 * ⚠️ 这条析取**曾经只有两项**(`FOOD_BY_ID.has || isUnmatchedId`),加了
 * `web:` 之后它就不完备了 —— 而它照样是绿的,因为这一盘菜里没有库外菜。
 * 典型的「绿着骗人」:断言写的是「要么在库里、要么是哨兵」,而第三种
 * (库外 + 联网查到)在它眼里是**不存在**的。
 *
 * 现在抽成一个判据。它和 `nutritionOfItems` 里那句「取不到来源才是 0」
 * 是同一件事的两种问法,所以用 `per100gOf` 而不是再写一遍前缀判断 ——
 * 「这道菜算不算得出来」只能有一个定义。
 */
const hasSource = (i) => FOOD_BY_ID.has(i.foodId) || per100gOf(i) !== null
check(
  '一整盘真实的菜全部落到库里的 id',
  realistic.items.every((i) => hasSource(i) || isUnmatchedId(i.foodId)),
  realistic.detail.map((d) => `${d.name}→${d.foodId}`).join(' ')
)
check(
  '真实餐盘不该有漏网的',
  realistic.unmatched.length === 0,
  realistic.unmatched.join('/')
)

/* ---------- 库里的每个名字都该能匹配到自己 ---------- */
/**
 * 反向哨兵:如果哪天往库里加了一道名字很怪的食物,而别名表没跟上,
 * 这条会红 —— 而不是等到用户拍了一盘那个菜才发现匹配不上。
 */
const selfMiss = FOODS.filter((f) => {
  const r = matchDishes([{ name: f.name }])
  return r.items[0]?.foodId !== f.id
}).map((f) => f.name)
check('库里每个名字都能匹配回自己', selfMiss.length === 0, selfMiss.join(' / '))

/* ============================================================
   分量三档
   ============================================================
   用户在「确认分量」那一步选的东西。这一步不产生任何网络请求,
   但它是**唯一**决定 `items[].grams` 的地方(真实路径上),所以算错了
   会一路错到结果页、日记、首页配额 —— 而且看起来完全正常。
*/
console.log('\n=== 分量三档 ===')
const portion = await load('/src/lib/portion.ts')
const { PORTIONS, baseGramsFor, portionGrams, portionItems, DEFAULT_PORTION, portionMeta } = portion
// countableItems / isWebId / WEB_BASE_GRAMS 在「菜品名匹配」那一节已经解构过了

/** 走一遍「基准 → 三档」,拿某个食物在某个路径下的克数 */
const gramsOf = (food, value, { engine = 'demo', current } = {}) =>
  portionGrams(baseGramsFor({ foodId: food.id, name: food.name, grams: current ?? food.defaultGrams }, engine), value)

/* ---------- 三档的定义 ---------- */
check('默认档是「常规」', DEFAULT_PORTION === 'normal', DEFAULT_PORTION)
check('三档就是少量/常规/多量', PORTIONS.map((p) => p.label).join('/') === '少量/常规/多量', PORTIONS.map((p) => p.label).join('/'))
check('常规的倍数是 1', portionMeta('normal').factor === 1, String(portionMeta('normal').factor))

/* ---------- 「常规」必须等于库里的常见分量 ----------
 * 这是整个设计锚定的那条不变量:用户选「常规」= 接受食物库的标准份量。
 * 今天库里所有 defaultGrams 都是 5 的倍数(30…500),所以取整到 5g 是个恒等变换;
 * 哪天有人加一个 `defaultGrams: 128`,取整会把它悄悄变成 130 —— 没有这条断言,
 * 这种事不会有人发现。
 */
const notIdentity = FOODS.filter((f) => gramsOf(f, 'normal') !== f.defaultGrams)
check('每个食物的「常规」都正好等于它的默认克数', notIdentity.length === 0,
  notIdentity.map((f) => `${f.name} ${f.defaultGrams}→${gramsOf(f, 'normal')}`).join(' '))

/* ---------- 单调 + 上下界 ---------- */
const notMonotonic = FOODS.filter((f) => !(gramsOf(f, 'small') < f.defaultGrams && f.defaultGrams < gramsOf(f, 'large')))
check('每个食物都满足 少量 < 常规 < 多量', notMonotonic.length === 0, notMonotonic.map((f) => f.name).join(' '))
check('「少量」永远不会等于「常规」', FOODS.every((f) => gramsOf(f, 'small') !== gramsOf(f, 'normal')))
/* 上限对齐 dishMatch 的 clampGrams:库里最大是 500g(珍珠奶茶),×1.5 也远没到 1000 */
check('「多量」仍在 [5,1000] 内', FOODS.every((f) => gramsOf(f, 'large') <= 1000),
  String(Math.max(...FOODS.map((f) => gramsOf(f, 'large')))))

/* ---------- 两个边界实物 ---------- */
const peanut = FOODS.find((f) => f.id === 'peanut')
const tea = FOODS.find((f) => f.id === 'bubble-tea')
check('炒花生 30g:少量 20g(取整到 5,且不等于常规)', gramsOf(peanut, 'small') === 20, String(gramsOf(peanut, 'small')))
check('珍珠奶茶 500g:多量 750g', gramsOf(tea, 'large') === 750, String(gramsOf(tea, 'large')))

/* ---------- 幂等:同一份输入必须给同一个数 ----------
 * 演示路径的克数是 `portion()` 在默认值上 ±15% 抖动出来的噪声。要是拿
 * **当前克数**当基准,「常规」就会变成一个每次都不同的随机数:同一盘菜照两次,
 * 「常规」给出两个数,用户只会认为这个 App 在乱来。所以演示路径的基准是
 * 库里的 defaultGrams,与当前克数无关 —— 这条断言就是在钉这件事。
 */
const noisy = { foodId: 'rice', name: '米饭', grams: 140 }
const first = portionGrams(baseGramsFor(noisy, 'demo'), 'normal')
const second = portionGrams(baseGramsFor({ ...noisy, grams: 165 }, 'demo'), 'normal')
check('演示路径:抖动过的克数不影响「常规」', first === 150 && second === 150, `${first} / ${second}`)
check('连算两次结果完全相同', gramsOf(peanut, 'large') === gramsOf(peanut, 'large'))

/* ---------- 真实路径:「常规」不改数字 ----------
 * 普通情况(一道菜一个 foodId)下,用户在确认页什么都不点直接按主按钮,
 * 结果页的数字必须和以前一模一样。这条就是那个承诺。
 */
const untouched = FOODS.filter((f) => gramsOf(f, 'normal', { engine: 'agent' }) !== f.defaultGrams)
check('真实路径 + 未合并:点「常规」不改变任何数字', untouched.length === 0,
  untouched.map((f) => f.name).join(' '))

/* ---------- 合并过的菜不许被砍回单份 ----------
 * matchDishes 把落到同一 foodId 的两道菜**相加**(见上面「合并时克数相加」
 * 那条,米饭 + 白米饭 = 300g)。要是基准取 defaultGrams,用户随手点一下「常规」
 * 就会把它静默砍回 150g —— 没有提示的数据改写,界面上看不出来。
 */
check('合并过的菜仍然是 300g', dup.items[0]?.grams === 300, String(dup.items[0]?.grams))
const mergedAfter = portionItems(dup.items, { rice: 'normal' }, 'agent')
check('合并过的菜点「常规」后还是 300g', mergedAfter[0]?.grams === 300, String(mergedAfter[0]?.grams))
check('合并过的菜点「多量」= 450g', portionItems(dup.items, { rice: 'large' }, 'agent')[0]?.grams === 450)

/* ---------- 未收录的菜不许让这一步崩掉 ----------
 * 哨兵项故意不在 FOOD_BY_ID 里。用 `FOOD_BY_ID.get(id)!` 的写法会在第一道
 * 未收录的菜上抛 TypeError —— 而「有未收录的菜」是正常情况,不是边界情况。
 * 这条用的是 matchDishes 真实产出的形状,不是手搓的。
 */
const mixed = matchDishes([{ name: '米饭' }, { name: '豆腐菌菇汤' }])
check('夹具里确实有一道未收录的菜', mixed.unmatched.length === 1, mixed.unmatched.join('/'))
let mixedOut
try {
  mixedOut = portionItems(mixed.items, { rice: 'small' }, 'agent')
  check('未收录的菜参与这一步不抛错', true)
} catch (e) {
  check('未收录的菜参与这一步不抛错', false, String(e))
}
check('未收录的菜原样返回', mixedOut?.[1]?.foodId === mixed.items[1].foodId && mixedOut?.[1]?.grams === 0,
  JSON.stringify(mixedOut?.[1]))
check('同一份清单里可算的那道菜正常改了', mixedOut?.[0]?.grams === 90, String(mixedOut?.[0]?.grams))
check('不改动条数和顺序', mixedOut?.length === mixed.items.length)

/* ---------- countableItems:哪几道菜算得出营养 ----------
 * 「分析中」用它决定跳不跳分量页,结果页用它决定显不显示结论卡 ——
 * 两处必须是同一个定义(上一轮那个「本餐总热量 0 kcal」的结论卡就是两处各写
 * 一遍写岔了导致的)。
 */
check('countableItems 过滤掉未收录的菜', countableItems(mixed.items).length === 1,
  String(countableItems(mixed.items).length))
check('countableItems 在全是未收录时为空', countableItems([mixed.items[1]]).length === 0)
check('countableItems 不动正常清单', countableItems(realistic.items).length === realistic.items.length)

/* ============================================================
   7. 档案与配额
   ------------------------------------------------------------
   这一节盯的是「档案里的信息真的有后果」—— 特殊时期和慢性病改的是配额,
   而配额是首页健康分、日记黑卡、agent 上下文三处共用的那八个数字。

   最要紧的两条:
     · 每条条件**只动它该动的那把键**(接错键的表现是数字变了但变得没道理)
     · `switchProfile` 的**原子性**(半写的表现是编辑被静默写进另一个档案)
   ============================================================ */

console.log('\n=== 7. 档案与配额 ===')

const quotaMod = await load('/src/store/quota.ts')
const { DEFAULT_PROFILE, BLANK_PROFILE } = await load('/src/store/defaults.ts')
const KEYS = ['kcal', 'protein', 'carb', 'fat', 'sodium', 'sugar', 'fiber', 'water']

/**
 * 锚点:推导出来的默认值必须等于**当年手写的那组常量**。
 *
 * 这里刻意写死字面量,而不是拿 `DEFAULT_PROFILE.quota` 互相比 —— 后者是
 * 自己跟自己比,恒真,一条证明不了任何事的断言。而这一组数字在档案页、
 * 首页、README 里都被引用过,动它应该是一次**有意识**的决定。
 *
 * ⚠️ 红了怎么办:去修 quota.ts 里的**取整规则或系数**,不要来改这个字面量表,
 *    也不要让 defaults.ts 退回成一组手写常量 —— 那会让档案页那句
 *    「结合基础信息自动计算」重新变成假话,而且是静默的:
 *    改体重、改年龄,一个数都不会动。
 */
const DOCUMENTED_DEFAULTS = { kcal: 1800, protein: 65, carb: 225, fat: 60, sodium: 2000, sugar: 25, fiber: 30, water: 2000 }
const derived = quotaMod.quotaFor(DEFAULT_PROFILE)
{
  const bad = KEYS.filter((k) => derived[k] !== DOCUMENTED_DEFAULTS[k])
  check(
    '自动算出来的默认配额 == 文档/界面一直引用的那组数',
    bad.length === 0,
    bad.length
      ? bad.map((k) => `${k}: 算得 ${derived[k]},应为 ${DOCUMENTED_DEFAULTS[k]}`).join(' / ')
      : JSON.stringify(derived)
  )
}
check(
  '落盘的 DEFAULT_PROFILE.quota 与 quotaFor 的结果一致(没有第二份手写常量)',
  KEYS.every((k) => DEFAULT_PROFILE.quota[k] === derived[k]),
  JSON.stringify(DEFAULT_PROFILE.quota)
)
check(
  '八项都是整数且落在面板允许的区间内',
  Object.values(derived).every(Number.isInteger) &&
    quotaMod.QUOTA_FIELDS.every((f) => derived[f.key] >= f.min && derived[f.key] <= f.max),
  `step: ${quotaMod.QUOTA_FIELDS.map((f) => f.step).join('/')}`
)

/*
 * 空档案的配额不能是 0。
 * derive.ts 的除法没有零守卫 —— 全零配额会让首页那行摄入比例**无条件**渲染出
 * `NaN%`(0 餐也显示),advice.ts 的钠与蛋白质建议变成结构性不可达。这是建档
 * 引导的直接后果(以前首屏就是演示档案,永远不会走到这条路)。
 */
const blankQuota = quotaMod.quotaFor(BLANK_PROFILE)
check('空档案的八项配额都大于 0', Object.values(blankQuota).every((v) => v > 0), JSON.stringify(blankQuota))

/**
 * 每条条件只该动它声明的那几把键。
 * 这条才抓得住「delta 表接错了键」—— 只断言「钠变小了」的话,
 * 一条把 protein 也一起改掉的错误规则照样能绿。
 */
function quotaMove(patch, expectKeys, label) {
  const base = quotaMod.quotaFor(DEFAULT_PROFILE)
  const next = quotaMod.quotaFor({ ...DEFAULT_PROFILE, ...patch })
  const moved = KEYS.filter((k) => base[k] !== next[k])
  const asExpected = moved.length === expectKeys.length && expectKeys.every((k) => moved.includes(k))
  check(
    label,
    asExpected,
    moved.length ? `${moved.join('、')} → ${moved.map((k) => `${base[k]}⇒${next[k]}`).join(' ')}` : '一项都没动'
  )
  return next
}

quotaMove({ chronicConditions: ['高血压'] }, ['sodium'], '高血压只动钠')
quotaMove({ chronicConditions: ['糖尿病'] }, ['carb'], '糖尿病只动碳水')
quotaMove({ chronicConditions: ['高血脂'] }, ['fat'], '高血脂只动脂肪')
quotaMove({ chronicConditions: ['慢性肾病'] }, ['protein'], '慢性肾病只动蛋白质')
quotaMove({ specialStages: ['孕期'] }, ['kcal', 'protein'], '孕期动热量与蛋白质')
quotaMove({ specialStages: ['哺乳期'] }, ['kcal', 'protein'], '哺乳期动热量与蛋白质')
quotaMove({ chronicConditions: ['痛风'] }, [], '痛风不动任何配额(嘌呤不在那八项里)')
/*
 * 「不动数字」现在有两类,分开断言 —— 它们的失败方式不一样:
 *
 *   · 更年期 **不在预设里**了(一般人判断不出来,见 types.ts)。它在这里
 *     代表「用户自己写进来的词」这条通路:自己写的词也得有一句话,
 *     否则勾了等于没勾,连「不影响」都不告诉他。
 *   · 青少年/老年 是**新增的预设**,而且是有据可依地不动 —— 指南对这两档
 *     另有说法(分性别分档、蛋白 1.0~1.2g/kg),只是 App 的推导接不上。
 *     哪天有人给它们加了数字,这一条会红,那时候要一起改的是依据那段话。
 */
quotaMove({ specialStages: ['更年期'] }, [], '自己写进来的词(更年期)不动任何配额(钙与维 D 不在那八项里)')
quotaMove({ specialStages: ['青少年'] }, [], '青少年不动任何配额(指南按性别分档,App 只有一套成人公式)')
quotaMove({ specialStages: ['老年'] }, [], '老年不动任何配额(App 的 1.2g/kg 已落在指南给老年人的区间上缘)')

console.log(`     高血压钠 ${derived.sodium}→${quotaMod.quotaFor({ ...DEFAULT_PROFILE, chronicConditions: ['高血压'] }).sodium}mg · 孕期热量 ${derived.kcal}→${quotaMod.quotaFor({ ...DEFAULT_PROFILE, specialStages: ['孕期'] }).kcal}kcal`)

/*
 * 顺序:**比例类必须排在 kcal 类之后**。
 *
 * 这条顺序在结果里看不出来 —— 糖尿病的碳水是 205 还是 235 都像是个合理的数,
 * 但只有 235 是从**孕后**的 2100kcal 算出来的。所以只能显式断言。
 */
{
  const preg = quotaMod.quotaFor({ ...DEFAULT_PROFILE, specialStages: ['孕期'] })
  const both = quotaMod.quotaFor({ ...DEFAULT_PROFILE, specialStages: ['孕期'], chronicConditions: ['糖尿病'] })
  const fromPreg = Math.round((preg.kcal * 0.45) / 4 / 5) * 5
  const fromBase = Math.round((DOCUMENTED_DEFAULTS.kcal * 0.45) / 4 / 5) * 5
  check(
    '孕期 + 糖尿病:碳水从**孕后**的热量算,不是孕前',
    both.carb === fromPreg && fromPreg !== fromBase,
    `孕后 ${preg.kcal}kcal ⇒ ${both.carb}g(若从孕前算会是 ${fromBase}g)`
  )
}

/* ---------- 解释:每个数字都要说得出出处 ---------- */
{
  const notes = quotaMod.quotaNotes({ ...DEFAULT_PROFILE, chronicConditions: ['高血压', '痛风'] })
  const sodiumNote = notes.find((n) => n.source === '高血压')
  check('来处说明列出高血压这条,并写明改成了多少', Boolean(sodiumNote) && sodiumNote.effect.includes('1500'), sodiumNote?.effect)
  check('每条都带依据', notes.every((n) => n.basis.length > 10))
  const gout = notes.find((n) => n.source === '痛风')
  check('痛风列出来、但标明不影响配额', Boolean(gout) && gout.effect === '' && !gout.blockedByOverride, gout?.effect ?? '(缺)')

  const blocked = quotaMod.quotaNotes({ ...DEFAULT_PROFILE, chronicConditions: ['高血压'], quotaOverrides: { sodium: 1200 } })
  const bn = blocked.find((n) => n.source === '高血压')
  check('手改挡住条件调整时打上「未采用」标记', Boolean(bn) && bn.blockedByOverride, `钠钉在 1200,高血压要 1500`)
}

/**
 * 依据这段字要**遍历所有条件**查,不能只查一条。
 *
 * 理由是它真的漏过一次:档案页那条星号断言只喂了高血压,于是糖尿病 basis 里
 * 的 `**区间内更严格的自设目标**` 一路绿着——而那两行是**当纯文本渲染**的,
 * 用户看到的就是连着星号一起。同一份字符串还会被 make-kb.mjs 原样抄进知识库
 * 文档,所以错一处是三处一起错。
 *
 * 这几条都用 `types.ts` 导出的取值表遍历,不维护任何名单:
 * 新加一个慢性病或一个特殊时期,自动被覆盖。
 */
{
  const T = await load('/src/store/types.ts')
  /*
    两张预设表直接拼起来 —— 以前这里要 `filter(s => s !== '无')`,因为「无」是
    特殊时期里一个**真实取值**(它进配额推导)。现在两栏都是「多选 + 自由填写」,
    空数组就是「无」,所以那张表里没有它,这一步也就不需要了。
  */
  const ALL_SOURCES = [...T.SPECIAL_STAGES, ...T.CHRONIC_CONDITIONS]
  const patchFor = (s) =>
    T.CHRONIC_CONDITIONS.includes(s) ? { chronicConditions: [s] } : { specialStages: [s] }

  const notesOf = (s) => quotaMod.quotaNotes({ ...DEFAULT_PROFILE, ...patchFor(s) })

  /** 一个条件都不落的那些 —— 勾了却在档案页一句话都看不到,用户会以为勾了没用 */
  const silent = ALL_SOURCES.filter((s) => notesOf(s).length === 0)
  check(
    '每个条件在档案页都留下一句话(包括「不影响配额」的那两个)',
    silent.length === 0,
    silent.length ? `没话说的: ${silent.join('、')}` : `${ALL_SOURCES.length} 个条件`
  )

  const STAR = /\*\*/
  const starred = ALL_SOURCES.filter((s) => notesOf(s).some((n) => STAR.test(n.basis)))
  check(
    '**没有一条依据里漏出 Markdown 星号**(整段是纯文本渲染,星号会连着显示出来)',
    starred.length === 0,
    starred.length ? `带星号: ${starred.join('、')}` : `${ALL_SOURCES.length} 个条件全查过`
  )
  // 不自证:上一条只有在正则真的认得星号时才有意义
  check('星号正则会命中(所以上一条不是空断言)', STAR.test('是**这样**的'))

  /*
   * 标点用全角 —— 和界面其余文案、README 一致。
   * 界面文案一半全角一半半角,读起来像是两个人写的;而知识库文档是这份字符串
   * 的直接下游,不一致会一路带下去。
   */
  const HALF = /[,:;()]/
  const mixed = []
  for (const s of ALL_SOURCES) {
    for (const n of notesOf(s)) {
      const hit = n.basis.match(HALF)
      if (hit) mixed.push(`${n.source}(${hit[0]})`)
    }
  }
  check(
    '每条依据都用全角标点(半角逗号/冒号/括号不混进来)',
    mixed.length === 0,
    mixed.length ? mixed.join(' ') : '全部全角'
  )
}

/* ============================================================
   依据 —— 「这条建议/这个数是照档案里哪一条说的」
   ============================================================ */
/*
  这一节验的是**一条链**:`quotaBasis`(一个数哪来的)→ 首页那句摘要
  (`daySummaryDetail`)、日记页那两张警示卡(`Warning.basis`)、结果页那四条
  建议(`Advice.basis`)、对话页本地应答(`localAnswer`)和那一餐的结论句
  (`chatMeal.mealVerdict`)。

  它们全都是**同一个 `quotaBasis` 拼出来的** —— 所以最要紧的断言不是「某一句
  文案对不对」,而是**「没有哪一处自己写了一套」**:只要有一处绕过
  `quotaBasis` 自己造句,用户就会在两个页面上看到对同一件事的两种说法。
*/
console.log('\n=== 依据:这一条是照档案里哪一条说的 ===')
{
  const QUOTA = quotaMod
  /*
    这一节的几个模块在文件后半段才 load(那里是它们的主场:`mealVerdict` 的
    四条优先级断言)。`const` 有 TDZ,在这里用不了 —— 所以这里**各自再 load 一次**。
    vite 会缓存模块,拿到的是同一个实例,不是两份代码。
  */
  const chatMealMod = await load('/src/lib/chatMeal.ts')
  const localAnswerMod = await load('/src/lib/localAnswer.ts')

  /* ---------- ① quotaBasis:三种来处各一条 ---------- */
  const plain = DEFAULT_PROFILE // 一个条件都没有
  check(
    '没有条件调整时,说得出默认值是从哪来的(基础信息 / 膳食指南)',
    QUOTA.quotaBasis(plain, 'kcal') === `基础信息 → 热量目标 ${plain.quota.kcal}kcal` &&
      QUOTA.quotaBasis(plain, 'sodium') === `膳食指南 → 钠上限 ${plain.quota.sodium}mg`,
    `${QUOTA.quotaBasis(plain, 'kcal')} / ${QUOTA.quotaBasis(plain, 'sodium')}`
  )

  const hyper = { ...plain, chronicConditions: ['高血压'], quota: QUOTA.quotaFor({ ...plain, chronicConditions: ['高血压'] }) }
  check(
    '**有条件调整时说条件**,而不是说基础信息',
    QUOTA.quotaBasis(hyper, 'sodium') === '高血压 → 钠上限 1500mg',
    QUOTA.quotaBasis(hyper, 'sodium')
  )
  check(
    '同一个人的其它项仍然说基础信息(依据是**逐项**的,不是一个人的)',
    QUOTA.quotaBasis(hyper, 'protein') === `基础信息 → 蛋白质目标 ${hyper.quota.protein}g`,
    QUOTA.quotaBasis(hyper, 'protein')
  )

  /*
    手改那一条最要紧:**屏幕上生效的是他钉的那个数**,所以依据必须说手改。
    拿推导值去解释屏幕上的数字,是在用一个不是它的数解释它。
  */
  const pinned = { ...hyper, quotaOverrides: { sodium: 1200 }, quota: { ...hyper.quota, sodium: 1200 } }
  check(
    '**手改过的那一项说「你手动设的」**,而且写的是钉住的那个数(1200,不是 1500)',
    QUOTA.quotaBasis(pinned, 'sodium') === '你手动设的 → 钠上限 1200mg',
    QUOTA.quotaBasis(pinned, 'sodium')
  )
  check(
    '手改的值**恰好等于推导值**时不算手改(否则「你手动设的」会常驻)',
    QUOTA.quotaBasis({ ...hyper, quotaOverrides: { sodium: hyper.quota.sodium } }, 'sodium') ===
      '高血压 → 钠上限 1500mg',
    '钉了一个和推导值一样的数,依据仍然说高血压'
  )

  /* ---------- ② 归并:同一来处只说一次 ---------- */
  check(
    '**三项同来处时归并成一句**(不把「基础信息」印三遍)',
    QUOTA.quotaBasisLine(plain, ['kcal', 'protein', 'water']).split('基础信息').length - 1 === 1,
    QUOTA.quotaBasisLine(plain, ['kcal', 'protein', 'water'])
  )
  check(
    '归并只归并**来处**,每一项自己的数字一个不少',
    ['热量目标', '蛋白质目标', '饮水目标'].every((w) =>
      QUOTA.quotaBasisLine(plain, ['kcal', 'protein', 'water']).includes(w)
    ),
    QUOTA.quotaBasisLine(plain, ['kcal', 'protein', 'water'])
  )
  check(
    '来处不同的项**不**归并(中间用「 · 」隔开)',
    QUOTA.quotaBasisLine(hyper, ['kcal', 'sodium']) ===
      `基础信息 → 热量目标 ${hyper.quota.kcal}kcal · 高血压 → 钠上限 1500mg`,
    QUOTA.quotaBasisLine(hyper, ['kcal', 'sodium'])
  )

  /*
    ⚠️ 上面三组夹具用的都是**一项一动**的条件(高血压只动钠,没有条件是空的)。
    而「一条调整同时动好几项」是常态 —— 孕中期那条动 kcal 和 protein 两项,
    而 `QuotaNote.effect` 是那条调整**整句**,不是逐项拆开的。于是同时引用这
    两项的调用方(对话页问「今天概况」走的正是这一支,发给 agent 的八项全量表
    更是每一份孕期档案都带着)会拿到同一句话印两遍。
    下面两条就是钉这个的,夹具必须是**一条动两项**的那条。
  */
  const pregnant = {
    ...plain,
    specialStages: ['孕期'],
    quota: QUOTA.quotaFor({ ...plain, specialStages: ['孕期'] }),
  }
  const pregNote = QUOTA.quotaNotes(pregnant)[0]
  check(
    '取到了一条**同时动两项**的调整(下面两条的锚点:少了它,它们会变成空对空)',
    pregNote && pregNote.keys.length === 2,
    pregNote ? `${pregNote.source} → ${pregNote.keys.join('、')}` : '(没有这样的条件)'
  )
  const pregBoth = QUOTA.quotaBasisLine(pregnant, ['kcal', 'protein'])
  check(
    '**一条调整动的两项合起来时,那句话只印一遍**(第二次归并:同一个来处里的重复)',
    pregBoth.split(pregNote.effect).length - 1 === 1,
    pregBoth
  )
  check(
    '而它该说的两项都在(不是靠「只留第一项」变绿的)',
    pregNote.keys.every((k) => pregBoth.includes(QUOTA.formatQuota(k, pregnant.quota[k]))),
    pregBoth
  )
  /*
    两个半句必须来自**同一个判据**。分开写成两份的话,「什么算手改」一变
    (比如加一条容差),就会印出「**你手动设的** → 钠上限 1500mg」——
    前半句说手改、后半句却是推导值,而两个函数各自看都自洽。
  */
  check(
    '`quotaBasis` 恒等于两个半句拼起来(不是第二份判据)',
    (() => {
      const keys = ['kcal', 'protein', 'carb', 'fat', 'sodium', 'sugar', 'fiber', 'water']
      const profiles = [plain, hyper, pinned, { ...plain, specialStages: ['孕期'] }, { ...plain, quotaOverrides: { kcal: 1600 }, quota: { ...plain.quota, kcal: 1600 } }]
      return profiles.every((p) =>
        keys.every((k) => QUOTA.quotaBasis(p, k) === `${QUOTA.quotaSource(p, k)} → ${QUOTA.quotaValueBasis(p, k)}`)
      )
    })(),
    '5 份档案 × 8 项,逐个比'
  )
  check(
    '半句拆开之后**不会**出现「你手动设的 → 一个推导值」(上个断言的具体反例)',
    QUOTA.quotaValueBasis(pinned, 'sodium') === '钠上限 1200mg' &&
      QUOTA.quotaValueBasis({ ...pinned, quotaOverrides: { sodium: hyper.quota.sodium } }, 'sodium') ===
        QUOTA.quotaValueBasis(hyper, 'sodium')
  )

  /* ---------- ③ 首页那句摘要 ---------- */
  const emptyStats = derive.dayStats([], today, plain)
  check(
    '没记录时那句摘要不带依据(它一个数都没引用)',
    derive.daySummaryDetail(emptyStats, null, plain).basis === null
  )

  /*
    「上限」这两个字是唯一的判据,而它**不是靠搜字符串得来的** ——
    `daySummaryDetail` 里是那一行 `if (overSodium > 0)` 自己记下来的。
    下面两组夹具就是这两句话的分界:

      · 上限 1mg  → 必定超,句子里有「今日钠已超上限 …」→ 有依据
      · 上限 99 万 → 必定不超,但**「比昨日同期…」那句还在**,而那句话里
        同样有一个「钠」字 → 依据仍然必须是 null
  */
  {
    const meal = (date, grams) => [
      { id: `basis-${date}`, date, slot: '午餐', time: '12:30', source: '手动记录', createdAt: 0, items: [{ foodId: FOODS[0].id, name: FOODS[0].name, grams }] },
    ]
    const yesterdayISO = date.lastNDays(2)[0]
    const statsOf = (quota) => [derive.dayStats(meal(today, 200), today, quota), derive.dayStats(meal(yesterdayISO, 100), yesterdayISO, quota)]

    const tight = { ...plain, quota: { ...plain.quota, sodium: 1 } }
    const [tightToday, tightYest] = statsOf(tight)
    const d = derive.daySummaryDetail(tightToday, tightYest, tight)
    check(
      '**提到「上限」时摘要带依据**',
      d.text.includes('超上限') && d.basis === QUOTA.quotaBasis(tight, 'sodium'),
      `${d.text} ‖ ${d.basis}`
    )

    const loose = { ...plain, quota: { ...plain.quota, sodium: 999999 } }
    const [looseToday, looseYest] = statsOf(loose)
    const q = derive.daySummaryDetail(looseToday, looseYest, loose)
    check(
      '夹具真的走到了「比昨日同期」那一句(否则下面那条是空断言)',
      q.text.includes('昨日同期'),
      q.text
    )
    check(
      '**没提上限时摘要没有依据** —— 「比昨日同期…」那句里也有个「钠」字,但它比的是昨天,和档案里那条高血压无关',
      q.basis === null,
      `${q.text} ‖ ${q.basis}`
    )
    check(
      '`daySummary` 就是 `daySummaryDetail().text`(**同一份实现**,不是抄了一遍)',
      derive.daySummary(tightToday, tightYest, tight) === d.text
    )
  }

  /* ---------- ④ 日记页那两张警示卡 ---------- */
  {
    const warned = derive.deriveWarnings(state().meals, state().profile)
    check(
      '这一节的夹具真的触发了警示(否则下面两条是空断言)',
      warned.length > 0,
      warned.map((w) => w.title).join(' / ') || '(一条都没有)'
    )
    check(
      '**每条警示都带依据**,而且是从 `quotaBasis` 来的',
      warned.every((w) => w.basis === QUOTA.quotaBasis(state().profile, w.title.includes('钠') ? 'sodium' : 'sugar')),
      warned.map((w) => `${w.title} → ${w.basis}`).join(' / ')
    )
  }

  /* ---------- ⑤ 结果页那四条建议 ---------- */
  {
    const items = [{ foodId: FOODS[0].id, name: FOODS[0].name, grams: 300 }]
    const n = derive.nutritionOfItems(items)
    const at = (sodium, protein) => {
      const p = { ...plain, quota: { ...plain.quota, sodium, protein } }
      return adviceMod.deriveAdvice(items, p)
    }
    const over = at(1, 1).find((a) => a.title.includes('钠'))
    check(
      '**钠那条建议的角标就是 `quotaSource(profile, "sodium")`**',
      Boolean(over) && over.basis === QUOTA.quotaSource({ ...plain, quota: { ...plain.quota, sodium: 1, protein: 1 } }, 'sodium'),
      over?.basis
    )
    /*
      ⚠️ 判据是 `quotaSource` 而**不是** `quotaBasis` —— 这一条就是用来钉住这件事的:
      两个函数的差别只在后半句(「→ 钠上限 2000mg」),所以把源码换回 `quotaBasis`,
      上面那条会红在「膳食指南 → 钠上限 1mg ≠ 膳食指南」,下面这条会红在「有个 →」。
      两条一起,把「结果页只印谁定的、不印定成了什么」钉死。

      (那个数没有消失,它印在档案页的「这些数字为什么是这样」——见 `advice.ts` 文件头。)
    */
    check(
      '**角标里没有那个数** —— 「→ 钠上限 1500mg」那一半从这一屏撤了',
      adviceMod.deriveAdvice(items, plain).every((a) => !(a.basis ?? '').includes('→')),
      adviceMod.deriveAdvice(items, plain).map((a) => a.basis ?? '(无)').join(' / ')
    )
    check(
      '**蔬菜那条没有依据**(它引的是指南,和你是谁无关 —— 正文里已经指名道姓了)',
      (() => {
        const veg = adviceMod.deriveAdvice([{ foodId: FOODS.find((f) => f.category === '主食').id, name: '米饭', grams: 200 }], plain)
        const v = veg.find((a) => a.title.includes('蔬菜'))
        return v !== undefined && v.basis === undefined
      })(),
      '一盘只有主食的菜,蔬菜那条会出现'
    )
    check(
      '每条建议的 basis(如果有)都不为空串 —— 渲染方按 `a.basis && …` 决定画不画',
      adviceMod.deriveAdvice(items, plain).every((a) => a.basis === undefined || a.basis.length > 0)
    )
    const taboo = (() => {
      const p = {
        ...plain,
        restrictions: [{ item: '花生', type: 'allergy', level: '高危' }],
      }
      return adviceMod.deriveAdvice([{ foodId: FOODS[0].id, name: '花生炖猪蹄', grams: 200 }], p)[0]
    })()
    check(
      '**忌口那条的角标就是这条忌口的名字**',
      taboo.tone === 'danger' && taboo.basis === '花生过敏',
      taboo.basis
    )
    /*
      「（高危，逐道菜拦截）」那半句随角标撤掉了。核对下来几乎不丢东西:**正文里本来
      就写着**「风险等级:高危」(见上面 `body` 那行),丢的只是「逐道菜拦截」。

      ⚠️ 这条**不是**在验「等级走 restrictionLevel()」—— 那件事今天验不了:
      `restrictionLevel(r)` 目前恒等于 `r.level`,换成 `r.level` 是空操作(弄坏时试过,绿)。
      这条验的是「那半句确实不在角标里」,也就是它真的搬去了正文、没有两头都印。
    */
    check(
      '**角标里没有「高危」也没有「逐道菜拦截」**(它们要么在正文里,要么没了)',
      !/高危|逐道菜拦截/.test(taboo.basis ?? ''),
      taboo.basis
    )
    check(
      '**忌口那条指名了那道菜**(渲染方靠这个名字把整条挂到那一行上)',
      taboo.at === '花生炖猪蹄',
      `${taboo.title} → at=${String(taboo.at)}`
    )
    /*
      下面几条要用两道**极值菜**:钠最高的那道、糖最高的那道。
      挑法是按 `per100g` 取第一个过线的 —— 同值的并列(钠 700 有两道)时 `find`
      拿数组里靠前那道,**没有歧义**,只是「哪一道」由食物库的次序决定。

      ⚠️ 所以紧跟一条**夹具自检**:万一食物库改了数,让这两道不再是各自那一项的
      最大值(或互相重叠),下面两条 `at` 断言就会悄悄变成空转 —— 那种绿是假的,
      而且看不出来。这条自检就是用来当场喊出来的。
    */
    const salty = FOODS.find((f) => f.per100g.sodium >= 700)
    const sweet = FOODS.find((f) => f.per100g.sugar >= 45)
    check(
      '夹具自检:钠最高的那道和糖最高的那道**互不重叠**,分量拉开后谁是赢家才无歧义',
      salty.per100g.sodium > sweet.per100g.sodium && sweet.per100g.sugar > salty.per100g.sugar,
      `${salty.name}(钠${salty.per100g.sodium}/糖${salty.per100g.sugar}) · ` +
        `${sweet.name}(钠${sweet.per100g.sodium}/糖${sweet.per100g.sugar})`
    )

    /*
      ⚠️ 上面那条用的是 `plain`(一个条件都没有),所以它证明的是「跟 `quotaSource`
      走」,**证明不了「角标上真的是『高血压』」**。这一条补上:换成 `hyper`
      —— 屏幕上那个演示档案正是这一支。

      用高钠菜是为了**逼出 danger 那一支**(6mg 米饭会走「控制得很好」,
      那支也确实带 basis,但验的东西变弱了)。
    */
    check(
      '**档案里有高血压时,角标上就是「高血压」** —— 这就是用户要的那一眼',
      adviceMod
        .deriveAdvice([{ foodId: salty.id, name: salty.name, grams: 200 }], hyper)
        .find((a) => a.title.includes('钠'))?.basis === '高血压',
      adviceMod
        .deriveAdvice([{ foodId: salty.id, name: salty.name, grams: 200 }], hyper)
        .find((a) => a.title.includes('钠'))?.basis
    )

    /*
      钠/糖那两条的 `at`。⚠️ 判据是**菜名完全相等**,不是子串 —— 用 `includes`
      会把「米饭」的建议挂到「蛋炒饭」那一行上(见 `advice.ts` 文件头那段)。

      两道菜是**按 per100g 挑的极值**(钠 700 的那道、糖 45 的那道),分量也拉开,
      所以谁是钠最高、谁是糖最多都**没有并列**,期望值可以手写死。`quota` 一律压到
      1 是**逼**这两条出现的手段(阈值分别是 `q.sodium * 0.35` 和 `q.sugar * 0.4`):
      不逼的话这两条断言会因为「这条建议压根没出现」而变成空转 —— 那种绿是假的。
    */
    {
      const forced = { ...plain, quota: { ...plain.quota, sodium: 1, protein: 1, sugar: 1 } }
      const two = [
        { foodId: salty.id, name: salty.name, grams: 200 },
        { foodId: sweet.id, name: sweet.name, grams: 100 },
      ]
      const two2 = adviceMod.deriveAdvice(two, forced)
      /*
        ⚠️ **2026-09-23 改的判据:整餐级的建议一个 `at` 都不许填。**

        钠/糖那两条说的是「**这一餐**的钠偏高」,正文里点出主要贡献者是为了让人
        知道该少动哪一样 —— 但那不等于「问题出在这道菜上」。填了 `at` 就会被挂到
        那一行去,和那一行的档位打起来。实测就是这么出的:

            素炒时蔬  多吃            ← 分类规格(蔬菜类)
                      钠主要来自它     ← 同一行

        **一条建议要么说这一餐,要么说这道菜。** 位在卡尾,不挂行。
      */
      check(
        '**钠那条不挂行**(整餐级的句子不许挂到某道菜上)',
        two2.find((a) => a.title.includes('钠'))?.at === undefined,
        `at=${String(two2.find((a) => a.title.includes('钠'))?.at)}`
      )
      check(
        '**糖那条不挂行**(同上)',
        two2.find((a) => a.title.includes('添加糖'))?.at === undefined,
        `at=${String(two2.find((a) => a.title.includes('添加糖'))?.at)}`
      )
      check(
        '**整餐级的那几条一个 `at` 都没有**',
        two2.filter((a) => /钠|添加糖|蛋白质|蔬菜/.test(a.title)).every((a) => a.at === undefined),
        two2.map((a) => `${a.title}→${String(a.at)}`).join(' / ')
      )
    }
    /*
      「控制得很好」那一支也是钠,但它**不指名任何菜** —— 它是整餐级的。
      上面那条「整餐级的没有 at」只覆盖了蛋白质/蔬菜,这一条补上钠的另一支。
    */
    check(
      '**「控制得很好」那支钠不给 `at`**(它说的是整餐,不是哪一道菜)',
      (() => {
        const good = adviceMod.deriveAdvice(items, { ...plain, quota: { ...plain.quota, sodium: 99999 } })
        const a = good.find((x) => x.title.includes('控制得很好'))
        return a !== undefined && a.at === undefined
      })(),
      '钠上限调到极大时「控制得很好」那条会出现'
    )
  }

  /* ---------- ⑥ 对话页本地应答 ---------- */
  {
    const stats = derive.dayStats(state().meals, today, state().profile)
    const tr = derive.weekTrend(state().meals, state().profile, 7)
    const ask = (q) => localAnswerMod.answerLocally(q, stats, tr, state().profile)

    for (const [topic, q, key] of [
      ['钠', '今天盐吃多了吗', 'sodium'],
      ['糖', '今天糖吃多了吗', 'sugar'],
      ['蛋白', '蛋白质够不够', 'protein'],
      ['热量', '热量还剩多少', 'kcal'],
      ['饮水', '今天要喝多少水', 'water'],
    ]) {
      const a = ask(q)
      check(
        `本地应答「${topic}」那一支末尾带依据`,
        a.endsWith(`\n\n依据 · ${QUOTA.quotaBasis(state().profile, key)}`),
        a.slice(-60).replace(/\n/g, '⏎')
      )
    }

    const dinner = ask('晚餐吃什么合适')
    check(
      '**应答里的依据行永远在最后一段**(渲染方是照着末尾那行摘的)',
      [dinner, ask('今天盐吃多了吗'), ask('随便聊聊')].every((a) => a.lastIndexOf('\n\n依据 · ') > a.length - 200)
    )
    /*
      ⚠️ 判据里必须**逐个点名那三项**。第一版写的是「一处「依据 · 」+ 含一个「、」」
      —— 把三项改成只引 `kcal` 之后它照样绿:归并那句还是只有一处,而
      「基础信息 → 热量目标 1800kcal、蛋白质目标 65g」里的顿号来自**归并本身**
      (plain 那份档案的 kcal 和 protein 都归到「基础信息」),不是三项都念到了。
      它检查的是「归并的形状」,不是「该念的都念了」。
    */
    check(
      '「晚餐」那一支把三项归并成一句,而不是三行',
      (dinner.match(/依据 · /g) ?? []).length === 1 &&
        ['热量目标', '钠上限', '蛋白质目标'].every((w) => dinner.includes(w)),
      dinner.slice(dinner.indexOf('依据')).replace(/\n/g, '⏎')
    )
    check(
      '**依据里引的就是这个人档案里的数** —— 换个有高血压的档案,同一句话跟着变',
      (() => {
        const hp = { ...state().profile, chronicConditions: ['高血压'], quota: { ...state().profile.quota, sodium: 1500 } }
        return localAnswerMod.answerLocally('今天盐吃多了吗', stats, tr, hp).includes('钠上限 1500mg')
      })(),
      '同一句话、换档案、依据跟着变'
    )
  }

  /* ---------- ⑦ 对话页那一餐的结论句 ---------- */
  {
    const zero = { kcal: 0, protein: 0, carb: 0, fat: 0, sodium: 0, sugar: 0 }
    const cap = { kcal: 2000, protein: 60, carb: 250, fat: 60, sodium: 2000, sugar: 50, fiber: 25, water: 1500 }
    const ctxBase = {
      meal: { ...zero, kcal: 300, protein: 5, sodium: 900, sugar: 25 },
      before: { ...zero, kcal: 800, protein: 5, sodium: 900, sugar: 25 },
      quota: cap,
    }
    const hp = { ...state().profile, chronicConditions: ['高血压'], quota: { ...state().profile.quota, sodium: 1500 } }
    const withProfile = chatMealMod.mealVerdict({ ...ctxBase, profile: hp })
    check(
      '**结论句带上了依据**,而且说的是这个人档案里的那条',
      withProfile === '这餐钠 900mg，今天已经到上限的 90%。\n\n依据 · 高血压 → 钠上限 1500mg',
      withProfile.replace(/\n/g, '⏎')
    )
    check(
      '**不传档案时一个字都不多**(后面那条「谁赢」的断言因此不用重写)',
      chatMealMod.mealVerdict(ctxBase) === '这餐钠 900mg，今天已经到上限的 90%。'
    )
    check(
      '**连热量上限都没有那一句没有依据** —— 它一个配额数字都没引用',
      chatMealMod.mealVerdict({
        meal: { ...zero, kcal: 123, protein: 40 },
        before: { ...zero, protein: 40 },
        quota: { ...cap, kcal: 0 },
        profile: state().profile,
      }) === '这餐 123 kcal。'
    )
  }

  /* ---------- ⑧ 发给 agent 的那份依据表 ---------- */
  {
    const q = JSON.parse(
      buildAgentQuery(state().profile, state().meals, { text: '今天盐吃多了吗' })
    )
    const lines = q.profile.quotaBasis
    check('发给 agent 的 `quotaBasis` 是一行字符串', typeof lines === 'string' && lines.length > 0, lines)
    check(
      '**八项一个不少**(回答里可能出现任何一个数,模型手上得有一条能原样抄的)',
      QUOTA.QUOTA_FIELDS.every((f) => lines.includes(f.label)),
      lines
    )
    check(
      '**和屏幕上那行小字是同一处计算**(同一份档案,两边逐字节相同)',
      lines === QUOTA.quotaBasisLine(state().profile, QUOTA.QUOTA_FIELDS.map((f) => f.key))
    )
    check(
      '档案里没有依据可说的项**不会编一句** —— 八项全部有来处,所以这一条只是在钉「来处表是全的」',
      QUOTA.QUOTA_FIELDS.every((f) => QUOTA.quotaSource(state().profile, f.key).length > 0)
    )

    /*
      ⚠️ **seed 那份档案一个条件都没有**,所以上面几条全在「八项各说各的」这一种
      形状里。八项全量表的用处恰恰是有条件调整的人 —— 而一条调整同时动两项时
      (孕期动 kcal 和 protein),不归并就会把同一句话发两遍给模型,模型复述起来
      也照抄两遍。所以这里另拿一份孕期档案,把**整行**再算一次。
    */
    const preg = {
      ...state().profile,
      specialStages: ['孕期'],
      quota: QUOTA.quotaFor({ ...state().profile, specialStages: ['孕期'] }),
    }
    const pregLine = JSON.parse(buildAgentQuery(preg, state().meals, { text: '今天概况' })).profile.quotaBasis
    const pregEffect = QUOTA.quotaNotes(preg)[0].effect
    check(
      '孕期那份档案发给 agent 的依据行里,**那条调整的话也只出现一次**',
      pregLine.split(pregEffect).length - 1 === 1,
      pregLine
    )
  }
}

/* ---------- 手改 vs 条件调整 ---------- */
{
  const pinnedProfile = { ...DEFAULT_PROFILE, quotaOverrides: { kcal: 1600 } }
  const advice = quotaMod.quotaAdvice(pinnedProfile, { ...pinnedProfile, specialStages: ['孕期'] })
  check(
    '钉住热量后勾孕期 → 恰好问热量这一条',
    advice.length === 1 && advice[0].key === 'kcal' && advice[0].pinned === 1600 && advice[0].suggested === 2100,
    JSON.stringify(advice)
  )
  check(
    '没钉过的项不问(推导值直接改掉)',
    quotaMod.quotaAdvice(DEFAULT_PROFILE, { ...DEFAULT_PROFILE, specialStages: ['孕期'] }).length === 0
  )
  check(
    '同一份档案重存不反复问',
    quotaMod.quotaAdvice({ ...pinnedProfile, specialStages: ['孕期'] }, { ...pinnedProfile, specialStages: ['孕期'] }).length === 0,
    '判据只比较前后两次推导值,所以第二次返回空'
  )
}

/* ---------- quotaOverrides 的三条性质(走真实 store) ---------- */
console.log('\n=== 8. 多档案 ===')
store.resetToSeed()
const Q = () => state().profile.quota
const OV = () => state().profile.quotaOverrides

store.updateProfile({ quotaOverrides: { sodium: 1200 } })
check('手工覆盖生效,推导值被盖住', Q().sodium === 1200 && OV().sodium === 1200, `钠 ${Q().sodium}mg`)

store.updateProfile({ quotaOverrides: {} })
check('撤回覆盖(去掉那个键)就回到推导值', Q().sodium === 2000 && OV().sodium === undefined, `钠 ${Q().sodium}mg`)

store.updateProfile({ quota: { ...Q(), kcal: 999 } })
check(
  'patch 里带 quota 也绕不过重算',
  Q().kcal === DOCUMENTED_DEFAULTS.kcal,
  `传了 kcal:999,结果 ${Q().kcal} —— 手工调整的唯一入口是 quotaOverrides,没有第二条路`
)

/* ---------- 切换、往返、原子性 ---------- */
store.resetToSeed()
const homeId = state().activeProfileId
const snapshotHome = {
  profile: JSON.stringify(state().profile),
  meals: JSON.stringify(state().meals.map((m) => m.id)),
}
check('resetToSeed 之后是已建档状态', state().onboarded === true)

const otherId = store.addProfile('家人')
check(
  '新建档案不自动切过去',
  state().activeProfileId === homeId && state().profiles.some((p) => p.id === otherId),
  '误触「新建」的代价不该是一整套日记换人'
)
check('新档案是空日记', state().profiles.find((p) => p.id === otherId).meals.length === 0)
check(
  '新档案的配额也是正常的(不是 0)',
  Object.values(state().profiles.find((p) => p.id === otherId).profile.quota).every((v) => v > 0)
)

store.switchProfile(otherId)
check('切过去之后日记跟着换了', state().meals.length === 0 && state().activeProfileId === otherId)
check(
  '原档案被收进 profiles,并带着它自己那条日记',
  state().profiles.find((p) => p.id === homeId)?.meals.length === JSON.parse(snapshotHome.meals).length
)
check(
  'profiles 里绝不出现当前档案(不变量)',
  !state().profiles.some((p) => p.id === state().activeProfileId)
)

store.switchProfile(homeId)
check(
  '往返之后当前档案与日记与出发前深相等',
  JSON.stringify(state().profile) === snapshotHome.profile &&
    JSON.stringify(state().meals.map((m) => m.id)) === snapshotHome.meals,
  `${state().meals.length} 条记录`
)

/*
 * 原子性 —— 这条直接盯住那种「半写」陷阱。
 *
 * 若 switchProfile 写成「先把自己的塞进去、再把目标的取出来」,一个失效的 id
 * 会让前半执行、后半不执行:profiles 里出现同一 id 的两份,之后 find 挑到哪一份
 * 看数组顺序,用户的编辑被静默写进错的那一份。而两半各自都是合法数据,
 * persist 的守卫也看不出来。所以断言的不是「没抛异常」,是**一个字都没变**。
 */
{
  const beforeBad = JSON.stringify(state())
  store.switchProfile('p-这个-id-不存在')
  check('用不存在的 id 切换,state 一个字都没变', JSON.stringify(state()) === beforeBad)
}

/* ---------- 删除 ---------- */
store.switchProfile(otherId)
store.deleteProfile(homeId)
check('删掉非当前档案只动 profiles', state().activeProfileId === otherId && !state().profiles.some((p) => p.id === homeId))
check('现在只剩一个档案', state().profiles.length === 0)

/*
 * 删掉**最后一个**档案 = 退回未建档。
 *
 * 这里原来断言的是「不许删掉最后一个」(那时删除是空操作),理由是
 * `AppState.profile` 不能是可空的。理由还在,结论换了:不是留着不删,而是
 * 删完变回**一开始那一份**,并把 `onboarded` 翻回 false —— 于是路由表换回
 * 建档引导,App 因此有了一个「清空重来」的出口。
 *
 * 拆成四条断言,是因为它们各自会坏在不同地方:标志位坏 → 进不去引导;
 * 档案没退回空白 → 引导会带着上一份的名字和体征开屏;id 没退回 → 同一个人
 * 身上挂出第二个随机 id(`PRIMARY_ID` 那段注释说的就是这个)。
 */
store.deleteProfile(otherId)
check('删掉最后一个档案 = 还没建档(onboarded 翻回 false)', state().onboarded === false)
check(
  '基本资料退回那份空白档案(和首次打开逐字相同)',
  JSON.stringify(state().profile) === JSON.stringify(BLANK_PROFILE),
  `name=${JSON.stringify(state().profile.name)}`
)
check('日记跟着清空', state().meals.length === 0 && state().profiles.length === 0)
// 'p-self' 是 store.ts 里那个模块私有的 PRIMARY_ID,这里只能写死 ——
// 它变了这条就该红,因为「删完 = 首次打开」靠的正是这个 id 也退回去
check('当前档案 id 退回首位 id', state().activeProfileId === 'p-self', state().activeProfileId)
check(
  '空白档案仍然带着一份正常配额(不是 0)',
  Object.values(state().profile.quota).every((v) => v > 0),
  '全零配额会让首页渲染 NaN%'
)

{
  /*
    这一支走的是**还有别的档案**时的「删当前那个」,和上面那条「删最后一个」
    是两条不同的分支(上面那条会退回未建档,这条只是顺带切走)。
    上一段把状态清成了未建档,所以这里的 loneId 是一份空白档案 —— 不影响这条
    要断言的东西:切到哪一份、以及不留悬空指针。
  */
  const keepId = store.addProfile('第三份')
  const loneId = state().activeProfileId
  store.switchProfile(keepId)
  store.deleteProfile(keepId) // 删的正是当前这个
  check(
    '删掉当前档案会顺带切走,而不是留下悬空指针',
    state().activeProfileId === loneId && state().profiles.length === 0,
    `切到了 ${JSON.stringify(state().profile.name)}`
  )
}

/* ---------- 重置的**作用范围**:只动当前档案 ---------- */
{
  store.resetToSeed()
  const mine = state().activeProfileId
  store.addProfile('别人的')
  const theirsId = state().profiles[0].id
  store.switchProfile(theirsId)
  store.addMeal({ slot: '午餐', items: [{ foodId: 'rice', name: '米饭', grams: 150 }], source: '手动记录' })
  check('往另一个档案里记了一餐', state().meals.length === 1)

  store.switchProfile(mine)
  store.clearAllMeals()
  check(
    '「清空记录」只清当前档案',
    state().meals.length === 0 && state().profiles.find((p) => p.id === theirsId).meals.length === 1,
    '另一个档案的记录原样留着'
  )

  store.switchProfile(theirsId)
  // 快照非当前档案 —— 重置之后要拿它逐字节比,而不是比个大概
  const othersBefore = JSON.stringify(state().profiles)
  const othersIds = state().profiles.map((p) => p.id)
  store.resetToSeed()
  check(
    '「恢复演示数据」只换当前档案',
    state().activeProfileId === theirsId &&
      state().profile.name === DEFAULT_PROFILE.name &&
      state().meals.length > 0,
    `${state().meals.length} 条演示记录`
  )
  check(
    'profiles 里的其余档案原封不动(连顺序都没动)',
    JSON.stringify(state().profiles) === othersBefore && othersIds.length === 1,
    `profiles: ${state().profiles.map((p) => p.profile.name).join(',')}`
  )
}

/* ============================================================
   9. 词表之间的一致性
   ------------------------------------------------------------
   建档引导和档案编辑面板装的是同一批字段,而它们读的是 types.ts 里那几张
   词表。**引导里能选的东西**和**编辑里能选的东西**迟早会分家 —— 用户改档案
   时发现少了一个自己当初选的选项,就会以为选丢了。

   这一节盯的是那些「分家之后不会报错」的地方:
     · 选了一个目标,却没有对应的英文枚举码 → 原样发中文,模型读得懂,
       所以是**静默**降级(见 agentContext.ts 的 GOAL_CODES)
     · 体征区间写反 / 写窄 → 步进器一进去就是夹住的,用户怎么点都不动
   ============================================================ */

console.log('\n=== 9. 词表之间的一致性 ===')

const typesMod = await load('/src/store/types.ts')
const { GOAL_PRESETS, DIET_PRESET_WORDS, RESTRICTION_TYPES, RESTRICTION_LEVELS, BODY_LIMITS, GENDERS } = typesMod
const { AGE_RANGE, daysInMonth, clampDay, ageOn } = await load('/src/lib/age.ts')
const { GOAL_CODES } = await load('/src/lib/agentContext.ts')

/*
  ① 判据在 2026-09-22 换过一次,换掉的那条比新的**更强**,得说清为什么换。

  旧判据:「每个预设目标都必须有英文枚举码」。
  新判据:「**有码的,那个码必须原样长在线上提示词里**」+「没码的必须是中文」。

  为什么旧的不能留:「少辣」「口味清淡」从「饮食偏好」搬进了 `GOAL_PRESETS`,
  而线上那张目标词表是**封闭的**(见下面读进来的 yml)。给它们编一个
  `mild` / `light` 就能让旧断言变绿 —— 但那是一个**假绿**:模型收到一个它
  词表里没有的 token,比收到中文「少辣」更糟(中文它读得懂),而且看不出来。
  旧断言逼着人去做那件错事,所以它是错的不是漏的。

  新判据把「编码」变成了红灯:想加码,先改线上。
*/
const ymlGoals = await readFile('dify/食衡MealBalance.yml', 'utf8')

/* 自检:读不到内容的话,下面 `includes` 会全 False,而那是「读错了」不是「码错了」 */
check('  (自检)读到了线上提示词', ymlGoals.length > 1000, `${ymlGoals.length} 字符`)

const ghostCodes = Object.entries(GOAL_CODES).filter(([, code]) => !ymlGoals.includes(code))
check(
  '**GOAL_CODES 里每个码都原样长在线上提示词里**',
  ghostCodes.length === 0,
  ghostCodes.map(([k, v]) => `${k}→${v}`).join(' ') || `${Object.keys(GOAL_CODES).length} 个码`
)

/*
  ⚠️ **这一条是「形状」断言,不是「正确性」断言 —— 如实标注。**
  它只说:「没码的那个目标,发出去的时候还是它自己(中文),不会变成空、
  不会变成 undefined」。中文直传本来就是合法路径(`?? g` 兜底),
  所以这条永远不该红;它挡的是「有人想给某个目标码一个码,结果码成了空串」。

  真正管「该不该有码」的是上面那条 —— 而「哪些目标该有码」没有机器判据,
  是一个人对线上词表的判断。见下面那条「本可以做什么」的注记。
*/
const badGoals = GOAL_PRESETS.filter((g) => !GOAL_CODES[g] && !/[一-龥]/.test(g))
check(
  '  (形状)没码的预设目标仍然是中文,不是空串',
  badGoals.length === 0,
  badGoals.join(' / ') ||
    `有码 ${GOAL_PRESETS.filter((g) => GOAL_CODES[g]).length} 个 / 中文直传 ${GOAL_PRESETS.filter((g) => !GOAL_CODES[g]).length} 个`
)

/*
  码本身也得像样。发一个中文过去,工作流那边的枚举比较就永远不会命中 ——
  和 `severity` 发「高危」是同一类错。这条挡的是"补码的时候随手写成中文"。
*/
const badCodes = Object.entries(GOAL_CODES).filter(([, code]) => !/^[a-z][a-z0-9_]*$/.test(code))
check('枚举码都是小写英文/下划线', badCodes.length === 0, badCodes.map(([k, v]) => `${k}→${v}`).join(' ') || 'ok')

// ② 选项目录必须覆盖到每一个能存进档案的取值
/*
  ⚠️ `TYPE_VALUES` 是**快照**,不是派生 —— 故意的。

  它和 `RESTRICTION_TYPES` 都是从别处推出来的,一条写成派生的话,「有人悄悄
  删掉一个取值」不会有任何东西红。所以这里手写一份,和 `Object.keys` 那边
  对撞:两边不一致就说明有人动过 `RestrictionType`。

  加取值的时候要**同时改两处**。这一天它被改了两回:下午加 `dislike`、傍晚删掉
  —— **删那一回正是靠这条红的**(快照里还留着第四个值,而 `RESTRICTION_TYPES`
  只剩三个)。删取值还必须 bump `SCHEMA_VERSION`,见 persist.ts 的 v7。
*/
const TYPE_VALUES = ['allergy', 'taboo', 'drug']
check(
  '**三种忌口类型都有对应的界面选项**',
  TYPE_VALUES.every((t) => RESTRICTION_TYPES.some((o) => o.value === t)) && RESTRICTION_TYPES.length === TYPE_VALUES.length,
  RESTRICTION_TYPES.map((o) => `${o.value}=${o.label}`).join(' ')
)
check(
  '选项文字和 restrictionLabel 用的是同一套后缀',
  RESTRICTION_TYPES.every(
    (o) => typesMod.restrictionLabel({ item: '花生', type: o.value, level: '高危' }) === `花生${o.label}`
  ),
  RESTRICTION_TYPES.map((o) => o.label).join('/')
)
check(
  '三个严重程度都在目录里',
  RESTRICTION_LEVELS.length === 3 && ['高危', '中危', '低危'].every((l) => RESTRICTION_LEVELS.includes(l)),
  RESTRICTION_LEVELS.join('/')
)

// ③ 体征区间本身要成立,而且要装得下两份预置档案
const rangeOk = ['height', 'weight'].every(
  (k) => BODY_LIMITS[k].min < BODY_LIMITS[k].max && BODY_LIMITS[k].step > 0
)
check('体征区间 min < max 且步长为正', rangeOk)
/*
  年龄不在 BODY_LIMITS 里了 —— 它是从出生日期**算**出来的,所以这里验的是
  「算出来的年龄落在区间内」,而不是「存下来的年龄落在区间内」。这两条不是
  同一件事:前者才是用户真的会看到的那个数。
*/
const inside = (p) => {
  const a = ageOf(p)
  return (
    a >= AGE_RANGE.min &&
    a <= AGE_RANGE.max &&
    p.height >= BODY_LIMITS.height.min &&
    p.height <= BODY_LIMITS.height.max &&
    p.weight >= BODY_LIMITS.weight.min &&
    p.weight <= BODY_LIMITS.weight.max
  )
}
check('**演示档案的体征落在滚轮区间内**', inside(DEFAULT_PROFILE), `${ageOf(DEFAULT_PROFILE)}岁/${DEFAULT_PROFILE.height}/${DEFAULT_PROFILE.weight}`)
check('**空档案的体征也落在区间内**(否则引导第一步一进去就是夹住的)', inside(BLANK_PROFILE), `${ageOf(BLANK_PROFILE)}岁/${BLANK_PROFILE.height}/${BLANK_PROFILE.weight}`)
check(
  '**演示档案的出生年是钉住的**',
  ageOf(DEFAULT_PROFILE) === 28 && ageOf(BLANK_PROFILE) === 30,
  `演示 ${ageOf(DEFAULT_PROFILE)} 岁 / 空档案 ${ageOf(BLANK_PROFILE)} 岁 —— 理由见 lib/age.ts 的 birthForAge`
)

/*
  ③b 年龄的换算规则 —— 存的是出生日期,年龄是算出来的。
  这一组盯的是「哪一天长一岁」这个边界:算错一天,结果只在生日前后那几天不对,
  而那种错误在别的任何一条断言里都照不出来。
*/
const on = (y, m, d) => new Date(y, m - 1, d)
check(
  '生日当天就长一岁(不是第二天)',
  ageOn({ year: 1998, month: 3, day: 20 }, on(2026, 3, 20)) === 28,
  `生日当天:${ageOn({ year: 1998, month: 3, day: 20 }, on(2026, 3, 20))} 岁`
)
check(
  '生日前一天还是旧岁数',
  ageOn({ year: 1998, month: 3, day: 20 }, on(2026, 3, 19)) === 27,
  `生日前一天:${ageOn({ year: 1998, month: 3, day: 20 }, on(2026, 3, 19))} 岁`
)
check(
  '**生日那个月的 1 号不算长一岁**(粗到「月」的写法会在这里错)',
  ageOn({ year: 1998, month: 3, day: 31 }, on(2026, 3, 1)) === 27,
  '只比到月的话 3 月 1 号就把人算成 28 了'
)
check(
  '跨年:12 月生的人到次年 1 月仍是旧岁数',
  ageOn({ year: 1998, month: 12, day: 5 }, on(2026, 1, 5)) === 27,
  `${ageOn({ year: 1998, month: 12, day: 5 }, on(2026, 1, 5))} 岁`
)

// 闰年与大小月 —— clampDay 是唯一挡在「2 月 30 日」前面的东西
check('闰年 2 月是 29 天', daysInMonth(2024, 2) === 29, `${daysInMonth(2024, 2)} 天`)
check('平年 2 月是 28 天', daysInMonth(2026, 2) === 28, `${daysInMonth(2026, 2)} 天`)
check('**整百年不是闰年,除非能被 400 整除**', daysInMonth(2100, 2) === 28 && daysInMonth(2000, 2) === 29, '2100 / 2000')
check('小月是 30 天', daysInMonth(2026, 4) === 30 && daysInMonth(2026, 11) === 30, '4 月 / 11 月')
check(
  '**把 1 月 31 日滚到 2 月会夹成 28/29**',
  clampDay({ year: 2026, month: 2, day: 31 }).day === 28 && clampDay({ year: 2024, month: 2, day: 31 }).day === 29,
  '不夹的话档案里会出现一个不存在的日期,而 ageOn 照样算得出数'
)
check(
  '滚到 4 月会夹成 30,滚回 5 月不受影响',
  clampDay({ year: 2026, month: 4, day: 31 }).day === 30 && clampDay({ year: 2026, month: 5, day: 31 }).day === 31
)
check(
  '夹取不改变本来就合法的日期(引用契约:没动过就返回原对象)',
  (() => {
    const b = { year: 1998, month: 3, day: 20 }
    return clampDay(b) === b
  })()
)

// ④ 性别那两个字必须就是 bmr() 认得的那两个
check('性别选项就是两个', GENDERS.length === 2 && GENDERS.includes('女') && GENDERS.includes('男'), GENDERS.join('/'))
check(
  '**「男」算出来的热量高于「女」**(性别那块常数真的进了公式)',
  quotaMod.quotaFor({ ...BLANK_PROFILE, gender: '男' }).kcal > quotaMod.quotaFor({ ...BLANK_PROFILE, gender: '女' }).kcal,
  `${quotaMod.quotaFor({ ...BLANK_PROFILE, gender: '女' }).kcal} / ${quotaMod.quotaFor({ ...BLANK_PROFILE, gender: '男' }).kcal}`
)
// 认不出的性别走女性公式 —— 拼错的性别不该把上限抬高
check(
  '性别不认识时按女性公式走(更低、更保守)',
  quotaMod.quotaFor({ ...BLANK_PROFILE, gender: '' }).kcal === quotaMod.quotaFor({ ...BLANK_PROFILE, gender: '女' }).kcal
)

// ⑤ 预设词表本身不能有重复或空串
const dupePresets = DIET_PRESET_WORDS.filter((w, i) => !w || DIET_PRESET_WORDS.indexOf(w) !== i)
check('饮食偏好预设词无空串、无重复', dupePresets.length === 0, DIET_PRESET_WORDS.join('/'))

/* ============================================================
   ⑥ 「分析中」的阶段词表要和 Dify 那张图对得上
   ------------------------------------------------------------
   「分析中」那十来秒显示的那句话,来处是 Dify 的 `node_started` 事件
   (`data.title`),再由 `src/lib/analyzeStage.ts` 翻成阶段。

   危险的地方在于:**两边各自演化时没有任何东西会报错**。上游加一个节点、
   客户端不认识 → `stageOfNode` 返回 null → 界面安静地停在上一句上,
   一路到用户那儿才表现为「怎么一直卡在『正在识别菜品』」。
   而那一刻没有任何日志、没有任何红。

   所以这里对着 yml 逐个点名,判据是**双向**的:
     · yml 里有、词表里没有 → 漏了(上面那种,静默)
     · 词表里有、yml 里没有 → 死名字(和漏名字一样会让人误判)
   ============================================================ */

const yml = await readFile('dify/食衡MealBalance.yml', 'utf8')
/** 节点名就写在 `data.title` 里,缩进 8 格 */
const ymlTitles = [...yml.matchAll(/^ {8}title: (.+)$/gm)].map((m) => m[1].trim())

const analyzeStageMod = await load('/src/lib/analyzeStage.ts')
const { STAGE_OF_NODE, UNMAPPED_NODES, ANALYZE_STAGE_LABELS, advance, stageOfNode } = analyzeStageMod
const knownNodes = [...Object.keys(STAGE_OF_NODE), ...UNMAPPED_NODES]

check(
  '**yml 里每个节点都在词表里(映射了、或明确登记为「有意不映射」)**',
  ymlTitles.every((t) => knownNodes.includes(t)),
  ymlTitles.filter((t) => !knownNodes.includes(t)).join(' / ') || `${ymlTitles.length} 个节点全部登记`
)
/* 自检:抠不到节点名的话,上面那条是一条永远为真的空断言 */
check('  (自检)确实从 yml 里抠出了节点名', ymlTitles.length >= 10, `${ymlTitles.length} 个`)

check(
  '词表里没有 yml 中已不存在的死名字',
  knownNodes.every((t) => ymlTitles.includes(t)),
  knownNodes.filter((t) => !ymlTitles.includes(t)).join(' / ') || 'ok'
)

/*
  认不出的名字必须返回 null。别让它「退化」成某个默认阶段 ——
  那样新节点会被静默地显示成一句不相干的话,比停在原地更难查。
*/
check('认不出的节点名返回 null(不是默认阶段)', stageOfNode('将来新加的节点') === null && stageOfNode('') === null)

/* ⚠️ 别叫 `stages` —— 这个名字上面第 6 节已经用来装 query 的 JSON 了 */
const stageNames = Object.keys(ANALYZE_STAGE_LABELS)
const stageLabels = Object.values(ANALYZE_STAGE_LABELS)
check('六个阶段都有自己的文案', stageNames.length === 6, stageNames.join(' / '))
check(
  '**六句文案互不相同**(写重了就看不出阶段跳错)',
  new Set(stageLabels).size === stageLabels.length,
  stageLabels.join(' / ')
)
check(
  '每句都是「正在…」的进行时',
  stageLabels.every((l) => l.startsWith('正在')),
  stageLabels.find((l) => !l.startsWith('正在')) ?? 'ok'
)
check(
  '映射表只指向词表里存在的阶段',
  Object.values(STAGE_OF_NODE).every((s) => stageNames.includes(s)),
  Object.entries(STAGE_OF_NODE).filter(([, s]) => !stageNames.includes(s)).map(([k, v]) => `${k}→${v}`).join(' ') || 'ok'
)

/*
  单调性。这条是「晚到的 node_started 不许把进度拽回去」那条 UI 承诺的
  纯函数版本 —— verify-reply 里那条喂的是真 SSE,这条喂的是参数。
*/
check('advance 只许前进', advance('recognize', 'guide') === 'recognize' && advance('guide', 'assemble') === 'assemble')
check('advance 空值起手直接采纳(还没收到过任何节点)', advance(undefined, 'search') === 'search')
check('advance 原地不动时保持原值(同一节点重复上报不算进展)', advance('search', 'search') === 'search')

/* ============================================================
   10. 进食顺序
   ------------------------------------------------------------
   结果页那张卡后面站着的规则。纯逻辑,不碰 DOM,所以在这儿测。

   ⚠️ 放在文件**末尾**:这一节和其他节不共用夹具,插在中间要挪后面所有节的位置。
   ⚠️ 这一节里的期望值全部是**手写的字面量**。别改成「从 `CATEGORY_ROLE` 里读
   期望值再断 `CATEGORY_ROLE`」—— 那是恒真式,永远红不了(仓库里栽过两次)。
   ============================================================ */
console.log('\n=== 10. 进食顺序 ===')

const { deriveEatingOrder, CATEGORY_ROLE } = await load('/src/store/eatingOrder.ts')

/**
 * 造一份 items。`name` 允许写成和食物库**不一样**的名字 —— 模型认出来的菜名
 * 本来就未必等于库里的标准名,而屏幕上那张卡显示的必须是前者。
 */
const dish = (foodId, name, grams = 100) => ({ foodId, name, grams })

/* ---------- 九种分类各来一道:一道都不许从卡上消失 ---------- */
/*
  ⚠️ 这一节**最要紧**的一条是「菜品卡上的每一道菜都在这张卡上」—— 用户的原话是
  「进食顺序建议中任何一个菜都不要遗漏」。上一版把汤/水果/饮品/零食四类写成
  「不进顺序」,于是一盘有汤的饭菜里**汤直接从这张卡上消失**,正是这条规矩要拦的。

  所以这份 items **九个分类各来一道**,漏掉哪一类都会在这一节的断言里露头。
*/
const fullPlate = [
  dish('seaweed-egg-soup', '紫菜蛋花汤', 250), // 汤羹  → 餐前
  dish('apple', '苹果', 180), // 水果            → 餐前
  dish('lettuce-stir', '清炒油麦菜', 200), // 蔬菜    → 先吃
  dish('braised-ribs', '红烧排骨', 150), // 肉类     ┐
  dish('steamed-fish', '清蒸鱼', 150), // 水产        ├ 同属蛋白质 → 再吃
  dish('boiled-egg', '煮鸡蛋', 50), // 蛋奶豆        ┘
  dish('rice', '米饭', 150), // 主食               → 最后吃
  dish('cola', '含糖可乐', 330), // 饮品           ┐ → 随餐
  dish('chips', '薯片', 50), // 其他               ┘
]
const fullSteps = deriveEatingOrder(fullPlate)

check('  (锚点)九道菜排出了九步', fullSteps.length === 9, `${fullSteps.length} 步`)
check(
  '**菜品卡上的每一道菜都在这张卡上,一道都不许少**',
  fullPlate.every((i) => fullSteps.some((s) => s.name === i.name)),
  fullPlate
    .filter((i) => !fullSteps.some((s) => s.name === i.name))
    .map((i) => i.name)
    .join(' / ') || '一道不缺',
)
check(
  '**五档的先后:餐前(汤/水果)→ 蔬菜 → 蛋白质 → 主食 → 随餐**',
  fullSteps.map((s) => s.name).join(' → ') ===
    '紫菜蛋花汤 → 苹果 → 清炒油麦菜 → 红烧排骨 → 清蒸鱼 → 煮鸡蛋 → 米饭 → 含糖可乐 → 薯片',
  fullSteps.map((s) => s.name).join(' → '),
)
check(
  '**说明词:每一档一个说法**',
  fullSteps.map((s) => s.note).join(' / ') ===
    '餐前喝汤 / 餐前吃水果 / 先吃蔬菜 / 再吃蛋白质 / 再吃蛋白质 / 再吃蛋白质 / 最后吃主食 / 随餐 / 随餐',
  fullSteps.map((s) => s.note).join(' / '),
)

/* ---------- 汤:排第一 ---------- */
/*
  依据在 `store/eatingOrder.ts` 的文件头(上海/四川省卫健委、央广网:汤→菜→
  肉→主食)。⚠️ 别拿糖尿病指南那几十份**食谱**当依据 —— 那里的汤写在菜单**最后
  一行**,可那些菜单连主食都写在第一行,那是**菜单的写法**,不是吃法。
*/
check(
  '**汤排在第一位,说明词是「餐前喝汤」**',
  fullSteps[0]?.name === '紫菜蛋花汤' && fullSteps[0]?.note === '餐前喝汤',
  `${fullSteps[0]?.name} / ${fullSteps[0]?.note}`,
)
const soupRicePlate = [dish('seaweed-egg-soup', '紫菜蛋花汤', 250), dish('rice', '米饭', 150)]
check(
  '**只有汤和米饭时,主食仍然是「最后吃」**(不会被汤挤成「先吃主食」)',
  deriveEatingOrder(soupRicePlate)
    .map((s) => s.note)
    .join(' / ') === '餐前喝汤 / 最后吃主食',
  deriveEatingOrder(soupRicePlate)
    .map((s) => s.note)
    .join(' / '),
)

/* ---------- 水果:也在餐前 ---------- */
check(
  '**水果在最前那一档,写「餐前吃水果」**(上海市卫健委:「正餐前……如水果、清淡的汤」)',
  fullSteps[1]?.name === '苹果' && fullSteps[1]?.note === '餐前吃水果',
  `${fullSteps[1]?.name} / ${fullSteps[1]?.note}`,
)

/* ---------- 蔬菜永远「先吃」,不按位置算 ---------- */
/*
  上一版是按位置算的(第一个「先吃」、最后一个「最后吃」),于是一盘「汤 + 青菜」
  会把青菜说成「最后吃蔬菜」。现在照指南原话(「养成先吃菜,最后吃主食的习惯」)
  写死,这一条盯的就是那个错法。
*/
const soupVegPlate = [dish('seaweed-egg-soup', '紫菜蛋花汤'), dish('lettuce-stir', '清炒油麦菜')]
check(
  '**青菜是这一盘最后一道熟菜时,仍然说「先吃蔬菜」**(照指南原话,不按位置算)',
  deriveEatingOrder(soupVegPlate)
    .map((s) => s.note)
    .join(' / ') === '餐前喝汤 / 先吃蔬菜',
  deriveEatingOrder(soupVegPlate)
    .map((s) => s.note)
    .join(' / '),
)

/* ---------- 饮料和零食:不许消失,但也拿不到位置词 ---------- */
check(
  '**饮料和零食都在卡上,排在最后写「随餐」**(没有先后依据,就不替它们编一个)',
  fullSteps.slice(7).map((s) => `${s.name}=${s.note}`).join(' ') === '含糖可乐=随餐 薯片=随餐',
  fullSteps
    .slice(7)
    .map((s) => `${s.name}=${s.note}`)
    .join(' '),
)
check(
  '  「随餐」只出现在末尾,不会插到主食前面去',
  !fullSteps.slice(0, 7).some((s) => s.note === '随餐'),
  fullSteps.filter((s) => s.note === '随餐').length + ' 条随餐',
)

/* ---------- 只有两档:不该出现「再吃」 ---------- */
const twoTierPlate = [dish('braised-ribs', '红烧排骨', 150), dish('rice', '米饭', 150)]
const twoSteps = deriveEatingOrder(twoTierPlate)
check('  (锚点)只有两档的餐盘确实排出了两步', twoSteps.length === 2, `${twoSteps.length} 步`)
check(
  '**没有蔬菜时第一步就是「先吃」**(五档里只有蛋白质那一档跟着「有没有蔬菜」变)',
  twoSteps.map((s) => s.note).join(' / ') === '先吃蛋白质 / 最后吃主食',
  twoSteps.map((s) => s.note).join(' / ') || '(空)',
)
check(
  '**两档时没有「再吃」**',
  !twoSteps.some((s) => s.note.startsWith('再吃')),
  twoSteps.map((s) => s.note).join(' / '),
)

/* ---------- 只有一档:整张卡不出现 ---------- */
const oneTierPlate = [dish('rice', '米饭', 150), dish('mantou', '馒头', 100)]
check(
  '**只有一档时不给顺序**(「① 米饭 ② 馒头」不是建议,是噪音)',
  deriveEatingOrder(oneTierPlate).length === 0,
  deriveEatingOrder(oneTierPlate).map((s) => s.name).join(' → ') || '(空)',
)
check(
  '  (锚点)同一份组成加一道别的档位的菜就非空 —— 否则上面那条可能是因为函数整个坏了',
  deriveEatingOrder([...oneTierPlate, dish('lettuce-stir', '清炒油麦菜', 200)]).length === 3,
)

/* ---------- 查不到分类的菜:跳过,但不撤掉整张卡 ---------- */
const unknownPlate = [
  dish('unmatched:土豆炖牛肉', '土豆炖牛肉', 150),
  dish('web:清炒时蔬', '清炒时蔬', 200),
  dish('lettuce-stir', '清炒油麦菜', 200),
  dish('rice', '米饭', 150),
]
const unknownSteps = deriveEatingOrder(unknownPlate)
check(
  '  (锚点)这两个 foodId 在食物库里确实查不到',
  FOOD_BY_ID.get('unmatched:土豆炖牛肉') === undefined && FOOD_BY_ID.get('web:清炒时蔬') === undefined,
)
check(
  '**查不到分类的菜不进顺序**',
  !unknownSteps.some((s) => s.name === '土豆炖牛肉' || s.name === '清炒时蔬'),
  unknownSteps.map((s) => s.name).join(' → '),
)
/*
  这一条和 `advice.ts` 那条蔬菜判断**正好相反**,所以它是这一节里最该红的:
  那张卡断的是否定(「这一餐没有蔬菜」),分类未知时整条不说;这张卡断的是肯定
  (「先吃这几道」),未知的菜只是不进列表 —— 列表里没有它,不等于说了它什么。
*/
check(
  '**库里没有的菜不撤掉整张卡**(别的菜照常排)',
  unknownSteps.length === 2 && unknownSteps[0].name === '清炒油麦菜',
  unknownSteps.map((s) => s.name).join(' → ') || '(空)',
)
check(
  '  (锚点)全是库外菜时确实不成序(不是「跳过」被写成了「照样排」)',
  deriveEatingOrder([dish('web:甲', '甲'), dish('web:乙', '乙')]).length === 0,
)

/* ---------- 档内保持 items 的先后 ---------- */
const twoVegPlate = [
  dish('broccoli', '白灼西兰花', 150),
  dish('lettuce-stir', '清炒油麦菜', 200),
  dish('rice', '米饭', 150),
]
check(
  '**同一个档里保持 items 的先后**(不按克数排、不按名字排)',
  deriveEatingOrder(twoVegPlate)
    .map((s) => s.name)
    .join(' → ') === '白灼西兰花 → 清炒油麦菜 → 米饭',
  deriveEatingOrder(twoVegPlate).map((s) => s.name).join(' → '),
)

/* ---------- 名字以条目为准,不是以食物库为准 ---------- */
const aliasedPlate = [dish('lettuce-stir', '白灼油麦菜', 200), dish('rice', '米饭', 150)]
check(
  '  (锚点)库里那道菜的标准名和条目上写的确实不是一个名字',
  FOOD_BY_ID.get('lettuce-stir')?.name === '清炒油麦菜',
  FOOD_BY_ID.get('lettuce-stir')?.name ?? '(查不到)',
)
check(
  '**顺序里的菜名就是菜品卡上那个名字**(屏幕上两张卡对得上)',
  deriveEatingOrder(aliasedPlate)[0]?.name === '白灼油麦菜',
  deriveEatingOrder(aliasedPlate)[0]?.name ?? '(空)',
)

/* ---------- 分类表的覆盖与规格 ---------- */
/*
  期望值取自 `CATEGORY_ORDER`,被测的是 `CATEGORY_ROLE` —— **两个不同的常量**,
  不是自证。这一条在 `npm run typecheck` 之外还有意义:脚本走 `ssrLoadModule`,
  esbuild 只剥类型不做检查,所以「表里少了一行」在 `npm run verify` 下跑得动,
  红的就是这一条。
*/
check(
  '**分类表覆盖了 CATEGORY_ORDER 里的每一种分类**',
  CATEGORY_ORDER.every((c) => c in CATEGORY_ROLE),
  CATEGORY_ORDER.filter((c) => !(c in CATEGORY_ROLE)).join(' / ') || 'ok',
)
/*
  这一条挡的是**「某一类被写成不排」** —— 上一版汤/水果/饮品/零食四类就是这么
  没的,汤从一盘有汤的饭菜的卡上凭空消失。用户的原话是「任何一个菜都不要遗漏」,
  所以「不排」这件事今天**不允许发生**,类型上也已经从 `Role | null` 收成了 `Role`。
*/
check(
  '**九种分类全都有档位,一类都不许「不排」**',
  CATEGORY_ORDER.every((c) => CATEGORY_ROLE[c]?.group !== undefined),
  CATEGORY_ORDER.filter((c) => CATEGORY_ROLE[c]?.group === undefined).join(' / ') || '九类都有',
)
/** 手写的规格表 —— **不是**从实现里读出来的期望值 */
const ROLE_SPEC = {
  汤羹: 0,
  水果: 0,
  蔬菜: 1,
  蛋奶豆: 2,
  肉类: 2,
  水产: 2,
  主食: 3,
  饮品: 4,
  其他: 4,
}
check(
  '**九种分类落在哪一档,就是这张手写表**',
  CATEGORY_ORDER.every((c) => CATEGORY_ROLE[c]?.group === ROLE_SPEC[c]),
  // 证据直接铺出来,不写「只挑对不上的那些」那套 —— 双数组下标的 filter 看一眼
  // 就得在脑子里跑一遍,而这张表一共九行
  CATEGORY_ORDER.map((c) => `${c}=${CATEGORY_ROLE[c]?.group ?? '不排'}`).join(' '),
)

/* ---------- 边界 ---------- */
check(
  '空数组进、空数组出,不抛',
  deriveEatingOrder([]).length === 0,
  String(deriveEatingOrder([]).length),
)

/* ============================================================
   11. 一次发了 N 张照片 → 一份结果
   ------------------------------------------------------------
   对话页允许一次攒三张,每张各识别一次,再合成一餐(见 src/lib/mergeMeals.ts)。
   这一节盯的是**合成的规矩**,不是识别本身 —— 那一段在 recognizeOne 里。

   三条最要紧的:
     · 降级的那几张**一张菜都不能进结果**(那些菜是本地随机组的,和照片无关),
       但也不能让整份结果背上「演示数据」的牌子 —— 那会把真菜一起否定掉
     · 拦截那张赢,整份就是拦截卡
     · N=1 走的必须是同一条路
   ============================================================ */

console.log('\n=== 11. 多张照片合成一餐 ===')

const merge = await load('/src/lib/mergeMeals.ts')
const { mergeMeals, mergeItems } = merge

/** 一份「真」结果 —— 形状照抄 `runRecognition` 成功那条路的返回值 */
const okMeal = (name, foodId, over = {}) => ({
  slot: '午餐',
  items: [{ foodId, name, grams: 150 }],
  engine: 'agent',
  unmatched: [],
  ...over,
})
const ok = (meal) => ({ kind: 'ok', meal })
const degraded = (reason) => ({
  kind: 'degraded',
  meal: { slot: '午餐', items: [{ foodId: 'rice', name: '米饭', grams: 150 }], engine: 'demo', degradedReason: reason },
  reason,
})
const failed = { kind: 'failed', code: 'IMAGE', message: '这张图片打不开，换一张试试。' }
const cancelled = { kind: 'cancelled' }
const NET_DOWN = '连不上识别服务，本次为演示数据'

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ---------- N=1 恒等 ---------- */
/*
  ⚠️ 这一条挡的是「在开头写一句 `if (contribs.length === 1) return contribs[0].meal`」。
  抄了那条近路,N=1 和 N=3 就是两段代码,而天天在跑的那段(单张)永远测不到合并逻辑 ——
  合并里那些 `...(x ? {k:x} : {})` 全都没人验。

  故意用**有 unmatched、有 agentReply、有 noDishReason** 的那份当输入:这几个可选键
  正是「无条件写一个默认值」会露馅的地方。
*/
const RICH = okMeal('米饭', 'rice', {
  unmatched: ['豆腐菌菇汤'],
  // 这份 `agentReply` 把**全部**字段都写出来(包括食材清单和营养标签这两块),
  // 就是为了让上面那条 N=1 恒等断言真的覆盖到「合并有没有漏转发某个键」——
  // 少写一个键,那道题就少问一个字段
  agentReply: {
    blocked: false,
    risk: { level: 'low', message: '', items: [] },
    mode: 'plate',
    title: '',
    dishes: [],
    ingredients: [{ name: '番茄', category: '蔬菜' }],
    nutrition: { ingredients: ['番茄'], labels: [{ label: '钠', value: '12mg' }], riskItems: [] },
    advice: [],
    disclaimer: '',
  },
})
check('**N=1 逐字段还原那份结果**(不许抄近路)', eq(mergeMeals([ok(RICH)]), RICH), JSON.stringify(mergeMeals([ok(RICH)])))
check(
  'unmatched 是 `[]` 时这个键在,是 undefined 时**这个键不在**(N=1 的两种形状都还原)',
  eq(mergeMeals([ok(okMeal('米饭', 'rice'))]), okMeal('米饭', 'rice')) &&
    'unmatched' in mergeMeals([ok(okMeal('米饭', 'rice'))]),
  JSON.stringify(mergeMeals([ok(okMeal('米饭', 'rice'))]))
)
const NO_UNMATCHED = { slot: '午餐', items: [{ foodId: 'rice', name: '米饭', grams: 150 }], engine: 'agent' }
check(
  '**本来就没有 unmatched 键的结果,合完也不该凭空长出一个**',
  !('unmatched' in mergeMeals([ok(NO_UNMATCHED)])),
  Object.keys(mergeMeals([ok(NO_UNMATCHED)])).join(',')
)

/* ---------- 三张全成功 ---------- */
/*
  ⚠️ 这一条 2026-09-24 **整条反过来**了。

  原来写的是「三张的菜全在,而且**同名不去重**(两碗饭就是两道菜)」——
  那条规矩的原文和它被推翻的理由见 `mergeMeals.ts` 文件头第 2 条。
  现在同一道菜**合成一道**,所以夹具特意保留「两张都是米饭」这个形状:
  它同时证明「不同的菜都在」和「同一道菜只剩一条」。
*/
const THREE = [
  ok(okMeal('红烧排骨', 'braised-ribs')),
  ok(okMeal('米饭', 'rice')),
  ok(okMeal('米饭', 'rice')),
]
const three = mergeMeals(THREE)
check(
  '**三张里的同一道菜合成一道**(两张都是米饭 → 一道;另一道菜照常在)',
  three.items.length === 2 &&
    three.items.filter((i) => i.foodId === 'rice').length === 1 &&
    three.items.some((i) => i.foodId === 'braised-ribs'),
  three.items.map((i) => `${i.name}×${three.items.filter((x) => x.foodId === i.foodId).length}`).join(' / ')
)
check(
  '**合并之后 `foodId` 两两不同**(分量页 / 改一下面板拿它当 key 和档位键)',
  new Set(three.items.map((i) => i.foodId)).size === three.items.length,
  three.items.map((i) => i.foodId).join(',')
)

/* ---------- 合成那一把尺子本身(`mergeItems`) ---------- */
{
  const item = (foodId, name, grams, over = {}) => ({ foodId, name, grams, ...over })
  const PER100G = { kcal: 200, protein: 5, carb: 40, fat: 3, sodium: 100, sugar: 2 }

  /*
    ⚠️ 夹具的数字是按「能分辨三种错法」挑的:200 / **220** / 180。
    取第一个 → 200,取最后一个 → 180,相加 → 600,只有取最大才是 220。
    (写成 200/180/220 的话,「取最大」和「取最后一个」都吐 220,这条就废了一半。)
  */
  const maxed = mergeItems([
    item('braised-pork', '红烧肉', 200),
    item('braised-pork', '红烧肉（家常）', 220),
    item('braised-pork', '红烧肉', 180),
  ])
  check(
    '**同一道菜的克数取最大的那个**(不是相加 —— 相加就是把它算了两遍,那正是要修的毛病)',
    maxed.length === 1 && maxed[0].grams === 220,
    `${maxed.length} 项 / ${maxed.map((i) => i.grams).join('、')}g`
  )
  check(
    '名字取**第一次**出现的那个(后到的不覆盖)',
    maxed[0].name === '红烧肉',
    maxed[0].name
  )
  /*
    ⚠️ 这一条钉的是**上一条为什么成立**:用户要的「『红烧肉』和『红烧肉（家常）』
    算同一道」不是 `mergeItems` 自己实现的,是 `normalizeDishName` 把两个名字抹成
    同一个之后、两条拿到同一个 `foodId` 的结果。哪天有人放松那个归一化,
    这里先红 —— 而不是等到用户的日记里又出现两行。
  */
  check(
    '**「红烧肉」和「红烧肉（家常）」归一化之后是同一个名字**(所以它们同键)',
    dishMatch.normalizeDishName('红烧肉（家常）') === dishMatch.normalizeDishName('红烧肉'),
    `${dishMatch.normalizeDishName('红烧肉')} / ${dishMatch.normalizeDishName('红烧肉（家常）')}`
  )
  /*
    ⚠️ 这两道菜是**特意**挑的:它们的真 id 在库里是 `braised-pork` / `braised-ribs`
    —— **共用 `braised-` 这个前缀**。一堆人会把「前缀」当成「那一类」,
    写成 `foodId.split('-')[0]`,而两道红烧菜当场合成一道。
    (库外菜那条路的 id 就是 `web:菜名` / `unmatched:菜名`,更容易让人以为
    前缀是身份。)
    用 `rice` / `noodles` 就试不出来 —— 它俩连前缀都不一样,写错也照样绿。
  */
  const twoDishes = mergeItems([
    item('braised-pork', '红烧肉', 200),
    item('braised-ribs', '红烧排骨', 150),
  ])
  check(
    '不同的 `foodId` 一道都不合(合并的键不是「像不像」,也不是前缀)',
    twoDishes.length === 2,
    `${twoDishes.length} 项:${twoDishes.map((i) => i.name).join(' / ')}`
  )
  check(
    '顺序按**第一次**出现的下标(中间那道菜不会被挪到末尾)',
    mergeItems([item('rice', '米饭', 150), item('soup', '紫菜蛋花汤', 200), item('rice', '米饭', 100)])
      .map((i) => i.foodId)
      .join(',') === 'rice,soup',
    mergeItems([item('rice', '米饭', 150), item('soup', '紫菜蛋花汤', 200), item('rice', '米饭', 100)])
      .map((i) => i.foodId)
      .join(',')
  )
  /*
    ⚠️ 慎选标记是**这个 App 里唯一会拦住用户的东西**。同一道菜三张里只要有一张
    判了红,合并之后就得还是红的 —— 不然它会因为「另一张没那么说」而消失。
  */
  const marked = mergeItems([
    item('rice', '米饭', 150),
    item('rice', '米饭', 150, { suitable: false, reason: '这一餐的钠已经够了' }),
  ])
  check(
    '**同一道菜里有一张判了「慎选」,合并之后还是红的,而且理由跟着**',
    marked.length === 1 && marked[0].suitable === false && marked[0].reason === '这一餐的钠已经够了',
    `${marked[0]?.suitable} / ${marked[0]?.reason ?? '(没有理由)'}`
  )
  const web = mergeItems([
    item('web:青团', '青团', 80),
    item('web:青团', '青团', 60, { per100g: PER100G, source: '联网估算' }),
  ])
  check(
    '库外菜的营养值搬过来了(`per100g` 和 `source` 一起,谁查到用谁的)',
    web[0].per100g === PER100G && web[0].source === '联网估算',
    `${web[0].per100g ? '有值' : '没搬过来'} / ${web[0].source ?? '(没有来处)'}`
  )
  const origin = item('rice', '米饭', 150)
  const copy = mergeItems([origin, item('rice', '米饭', 300)])
  check(
    '合并**不写到调用方手上那些对象**(它们还挂在各自的识别结果里)',
    origin.grams === 150 && copy[0].grams === 300,
    `原来那份 ${origin.grams}g / 合并那项 ${copy[0].grams}g`
  )
  check('空数组进、空数组出', mergeItems([]).length === 0, `${mergeItems([]).length} 项`)
}
check(
  '**三张全成功 → 两个 note 都是 undefined**(没有演示数据,也没有缺张)',
  three.engine === 'agent' && three.degradedReason === undefined && three.partialNote === undefined,
  `engine=${three.engine} degraded=${three.degradedReason} partial=${three.partialNote}`
)

/* ---------- 全降级 ---------- */
const allDemo = mergeMeals([degraded(NET_DOWN), degraded(NET_DOWN), degraded(NET_DOWN)])
check(
  '**三张全降级 → 整份是演示数据,而且只报一次原因**',
  allDemo.engine === 'demo' && allDemo.degradedReason === NET_DOWN && allDemo.partialNote === undefined,
  `engine=${allDemo.engine} degraded=${allDemo.degradedReason} 菜 ${allDemo.items.length} 道`
)
check(
  '三张全降级**不把三份随机餐盘摞起来**(取第一份原样)',
  eq(allDemo, degraded(NET_DOWN).meal),
  allDemo.items.map((i) => i.name).join(' / ')
)

/* ---------- 部分降级:这次最要紧的一条 ---------- */
const partial = mergeMeals([ok(okMeal('红烧排骨', 'braised-ribs')), degraded(NET_DOWN), ok(okMeal('紫菜蛋花汤', 'seaweed-egg-soup'))])
check(
  '部分降级:真的那两张照常进结果',
  partial.items.map((i) => i.foodId).join(',') === 'braised-ribs,seaweed-egg-soup',
  partial.items.map((i) => i.name).join(' / ')
)
check(
  '**部分降级 → `degradedReason` 必须是 undefined**(否则整份真菜被标成演示数据)',
  partial.degradedReason === undefined,
  String(partial.degradedReason)
)
check(
  '**部分降级 → `partialNote` 必须指名道姓说「第 2 张」**',
  typeof partial.partialNote === 'string' && partial.partialNote.includes('第 2 张'),
  String(partial.partialNote)
)
check(
  '那句话里**不带「演示数据」四个字**(这一份不是演示数据)',
  !partial.partialNote.includes('演示数据'),
  partial.partialNote
)
check(
  '那句话里保住了降级的原因(摘掉了「，本次为演示数据」那条尾巴)',
  partial.partialNote.includes('连不上识别服务') && !partial.partialNote.includes('本次为演示数据'),
  partial.partialNote
)
check(
  '**降级那张的菜一道都没进结果**(它是本地随机组的,和照片无关)',
  !partial.items.some((i) => i.foodId === 'rice'),
  partial.items.map((i) => i.name).join(' / ')
)
check(
  '`failed` 那张也给一句话,且不是把 ImageError 的长句子塞进括号',
  mergeMeals([ok(okMeal('米饭', 'rice')), failed]).partialNote.includes('第 2 张') &&
    !mergeMeals([ok(okMeal('米饭', 'rice')), failed]).partialNote.includes('换一张试试'),
  mergeMeals([ok(okMeal('米饭', 'rice')), failed]).partialNote
)
check(
  '两张都没成时,「第 1、3 张」一起报出来',
  mergeMeals([failed, ok(okMeal('米饭', 'rice')), failed]).partialNote.includes('第 1、3 张'),
  mergeMeals([failed, ok(okMeal('米饭', 'rice')), failed]).partialNote
)
check(
  '**用户自己取消的那张不写成「没能识别」**(那不是故障)',
  mergeMeals([cancelled, ok(okMeal('米饭', 'rice'))]).partialNote === '第 1 张没有计入',
  mergeMeals([cancelled, ok(okMeal('米饭', 'rice'))]).partialNote
)

/* ---------- 拦截赢 ---------- */
// 拦截卡就是 `runRecognition` 里 `reply.blocked` 那条路的返回值:items 空 + agentReply
const BLOCKED_MEAL = okMeal('', '', {
  items: [],
  unmatched: [],
  agentReply: {
    blocked: true,
    risk: { level: 'high', message: '含花生', items: ['花生'] },
    mode: 'plate',
    title: '',
    dishes: [],
    ingredients: [],
    nutrition: { ingredients: [], labels: [], riskItems: [] },
    advice: [],
    disclaimer: '',
  },
})
const blocked = mergeMeals([ok(okMeal('红烧排骨', 'braised-ribs')), ok(BLOCKED_MEAL), ok(okMeal('米饭', 'rice'))])
check(
  '**任一张被拦截 → 整份就是那张拦截卡**(items 空、blocked 为真)',
  blocked.items.length === 0 && blocked.agentReply?.blocked === true,
  `${blocked.items.length} 道菜,blocked=${blocked.agentReply?.blocked}`
)
check('拦截时**不把另外两张的菜拼进去**(安全优先)', !blocked.items.some((i) => i.foodId === 'braised-ribs'))

/* ---------- unmatched ---------- */
const un = mergeMeals([
  ok(okMeal('米饭', 'rice', { unmatched: ['豆腐菌菇汤', '自制辣酱'] })),
  ok(okMeal('面条', 'noodles', { unmatched: ['豆腐菌菇汤'] })),
])
check(
  '**unmatched 同名只报一次**,顺序照第一次出现',
  JSON.stringify(un.unmatched) === JSON.stringify(['豆腐菌菇汤', '自制辣酱']),
  JSON.stringify(un.unmatched)
)

/* ---------- 一张都出不来 ---------- */
check('空数组 → null(没有可以合成的东西)', mergeMeals([]) === null, String(mergeMeals([])))
check(
  '**全失败 → null**(调用方据此给一条错误气泡)',
  mergeMeals([failed, failed]) === null,
  String(mergeMeals([failed, failed]))
)
check('全取消 → null(但调用方不该报错 —— 那是用户自己按的)', mergeMeals([cancelled, cancelled]) === null)

/* ---------- 不夹带预览图 ---------- */
/*
  合并结果里**不许**出现 photoUrl / thumbDataUrl。一次三张、每张都有自己的
  object URL,挑第一张摆在七道菜旁边就是在暗示一个不存在的因果;而且那个 URL
  的 revoke 归调用方管,合并结果里多一份引用就多一个「谁负责撤销」的问题。
*/
const WITH_PHOTO = okMeal('米饭', 'rice', { photoUrl: 'blob:first', thumbDataUrl: 'data:image/jpeg;base64,AA' })
const ROOT = mergeMeals([ok(okMeal('红烧排骨', 'braised-ribs')), ok(WITH_PHOTO), ok(okMeal('面条', 'noodles'))])
check(
  '**合并结果不夹带预览图**(三张各有各的照片,「这一餐那张」不成立)',
  !('photoUrl' in ROOT) && !('thumbDataUrl' in ROOT),
  // 期望值不能是「一个都没有」这种空话 —— 把三个键铺出来当锚点,
  // 否则第一张被静默丢掉时这条照样绿
  `${Object.keys(ROOT).join(',')} / ${ROOT.items.length} 道菜`
)
check(
  '那份带图的结果本身确实有 photoUrl(所以上一条不是空断言)',
  'photoUrl' in WITH_PHOTO && WITH_PHOTO.photoUrl === 'blob:first',
  String(WITH_PHOTO.photoUrl)
)

/* ============================================================
   12. 攒着还没发出去的附件
   ------------------------------------------------------------
   `renderToStaticMarkup` 不跑 effect、也点不动任何东西,所以「攒附件 → 删一张
   → 一次发出去」这一串在界面自检里一步都够不到。判据全在
   `src/lib/composer.ts` 里,这里验的是那三个函数。

   这一节盯的是两个**不崩、只是不对**的错误:少收了几张却不说,以及同一批
   发了两次(代价是六次视觉模型调用和两张一模一样的卡)。
   ============================================================ */

console.log('\n=== 12. 攒着还没发出去的附件 ===')

const composer = await load('/src/lib/composer.ts')
const { MAX_PHOTOS_PER_SEND, stage, unstage, takeAll } = composer

/** Node 24 有 File 和 URL.createObjectURL —— 这两个函数在这里是真的在跑,不是桩 */
const photo = (n) => new File([`photo-${n}`], `p${n}.jpg`, { type: 'image/jpeg' })

check('一次最多 3 张(每张 = 一次视觉模型调用)', MAX_PHOTOS_PER_SEND === 3, String(MAX_PHOTOS_PER_SEND))

/* ---------- 收下 ---------- */
{
  const staged = composer.emptyStaged()
  const dropped = stage(staged, [photo(1), photo(2)])
  check(
    '两张都收下了,而且没收的张数是 0',
    staged.photos.length === 2 && dropped === 0,
    `${staged.photos.length} 张 / 丢 ${dropped}`
  )
  check(
    '每张都有自己的 object URL(两张不能共用一串)',
    staged.photos[0].url.startsWith('blob:') && staged.photos[0].url !== staged.photos[1].url,
    `${staged.photos[0].url} vs ${staged.photos[1].url}`
  )
  check('文件名没串位(第 1 张还是第 1 张)', staged.photos[0].file.name === 'p1.jpg', staged.photos[0].file.name)
}

/*
  ⚠️ 这一节最要紧的一条。

  多选 5 张只能进 3 张,但**必须把没收的那 2 张报出来**。
  静默 `slice` 的坏法很具体:用户以为 5 张都发出去了,卡片上写着
  「识别到 3 道菜」,少的那两张没有任何地方能让他发现。
*/
{
  const staged = composer.emptyStaged()
  const dropped = stage(staged, [photo(1), photo(2), photo(3), photo(4), photo(5)])
  check(
    '**多选 5 张只收 3 张,而且报出「没收 2 张」**',
    staged.photos.length === MAX_PHOTOS_PER_SEND && dropped === 2,
    `${staged.photos.length} 张 / 丢 ${dropped}`
  )
  check(
    '收下的是**前** 3 张(报出的是没进的那两张,不是别的)',
    staged.photos.map((p) => p.file.name).join(',') === 'p1.jpg,p2.jpg,p3.jpg',
    staged.photos.map((p) => p.file.name).join(',')
  )

  // 已经满了再选 —— 一张都不收,而且要如实说「没收 3 张」
  const again = stage(staged, [photo(6), photo(7), photo(8)])
  check(
    '**满了之后再选一张也进不来,而且报的是 3 张**(不是 0)',
    staged.photos.length === MAX_PHOTOS_PER_SEND && again === 3,
    `${staged.photos.length} 张 / 丢 ${again}`
  )
}

/* ---------- 删一张 ---------- */
{
  const staged = composer.emptyStaged()
  stage(staged, [photo(1), photo(2), photo(3)])
  const gone = staged.photos[0].url
  unstage(staged, gone)
  check(
    '**删掉第 1 张之后剩下的是第 2、3 张**(按下标删会删错人)',
    staged.photos.map((p) => p.file.name).join(',') === 'p2.jpg,p3.jpg',
    staged.photos.map((p) => p.file.name).join(',')
  )
  check('被删掉那一张的 URL 不在列表里了', !staged.photos.some((p) => p.url === gone))
  // 删一个不存在的 URL 不该炸,也不该顺手删掉别的
  unstage(staged, 'blob:never-existed')
  check('删一个不存在的 URL 是空操作(不抛、也不误删)', staged.photos.length === 2, `${staged.photos.length} 张`)
}

/* ---------- 拿走 ---------- */
/*
  ⚠️ **转移,不是复制** —— `sendPhotos` 只能把同一批图发出去一次。

  复制语义下,一次双击(第二次点的时候 `busy` 还没翻过来)会把同一批发两遍:
  六次视觉模型调用、两分钟,然后对话里出现两张一模一样的卡。
*/
{
  const staged = composer.emptyStaged()
  stage(staged, [photo(1), photo(2)])
  const taken = takeAll(staged)
  check('拿走的是那两张', taken.length === 2 && taken[0].file.name === 'p1.jpg', `${taken.length} 张`)
  check(
    '**拿走之后盒子是空的**(所以第二次点发送没有图可发)',
    staged.photos.length === 0,
    `还剩 ${staged.photos.length} 张`
  )
  check(
    '第二次拿走拿到的是空表(不是同一批的副本)',
    takeAll(staged).length === 0,
    '复制语义下这里会是 2'
  )
  // 盒子换成新数组了 —— 拿走的那个数组上再 push 不该从「已经拿走的」里冒出来
  staged.photos.push({ url: 'blob:next', file: photo(9) })
  check(
    '**拿走的数组和盒子不再是同一个**(下一次攒的不会混进上一批)',
    taken.length === 2 && staged.photos.length === 1,
    `拿走 ${taken.length} / 盒子 ${staged.photos.length}`
  )
}

/* ============================================================
   13. 对话页那一餐 —— 发图那条路上的纯计算
   ------------------------------------------------------------
   `renderToStaticMarkup` 不跑 effect、也点不动任何东西,所以「攒图 → 点发送
   → 逐张识别 → 合成 → 出一句话」整段在界面自检里**一步都够不到**(和当初
   `AnalyzingScreen` 那条路是同一个处境)。这一节验的是那条路上的三个纯函数,
   它们各自有一个「不写下来下一个人一定会写错」的地方:

     1. 结论句四个分支的**顺序就是优先级**。下面四条输入**都满足四条分支的
        条件**,只差谁先说话 —— 不这么构造的话,把 `if` 调换顺序它照样绿,
        这一节就只是把代码抄了一遍。
     2. `syntheticEntry` **只进 query,永远不落盘**。它是给「这餐咸吗」那句
        提问补的上下文,不是一条待归档的记录。
     3. 每张图**一个 controller**。三张共用一个的话,第 1 张超时会把后面两张
        一起打成 aborted —— 而那两张会被读成「用户自己取消」,于是
        **一张结果都不出,也不报错**。
   ============================================================ */

console.log('\n=== 13. 对话页那一餐 ===')

const chatMeal = await load('/src/lib/chatMeal.ts')
const agentContext = await load('/src/lib/agentContext.ts')
const chatSession = await load('/src/store/chatSession.ts')

/** 拿真食物库里的第一样当那道「刚认出来的菜」—— 手写一个 foodId 会撞上库外哨兵 */
const justEaten = FOODS[0]

/** 一份营养。没写到的项按 0 —— 下面每条只改它关心的那两三项 */
const nutri = (over = {}) => ({ kcal: 0, protein: 0, carb: 0, fat: 0, sodium: 0, sugar: 0, ...over })

/**
 * 四个分支的分母。**改这里任何一个数,下面四条期望值都要重算** —— 这是故意的:
 * 期望值写死成字符串,「谁赢」才是被断言的东西(拿常量现算期望值就是拿代码
 * 验代码,永远不会红)。
 */
const verdictQuota = { kcal: 2000, protein: 60, carb: 250, fat: 60, sodium: 2000, sugar: 50, fiber: 25, water: 1500 }

/* ---------- ① 结论句:四个分支各自的优先级 ---------- */

/*
  四条输入都是「四档全中」:
      钠    before 900 + meal 900 = 1800 / 2000 = 90%   ≥ 80%
      糖    before  25 + meal  25 =   50 /   50 = 100%  ≥ 80%
      蛋白  before   5 + meal   5 =   10 /   60 =  17%  < 50%
      热量  quota.kcal > 0(兜底那一档恒成立)
  所以「说出口的是哪一句」**完全**由 `if` 的顺序决定。
*/
const vSodium = chatMeal.mealVerdict({
  meal: nutri({ kcal: 300, protein: 5, sodium: 900, sugar: 25 }),
  before: nutri({ kcal: 800, protein: 5, sodium: 900, sugar: 25 }),
  quota: verdictQuota,
})
check(
  '**四档全中时说话的是钠**(排第一:唯一一项用户当餐就能补救的)',
  vSodium === '这餐钠 900mg，今天已经到上限的 90%。',
  vSodium
)

/* 糖那一档:钠压到 10%、蛋白压到 17%,只留糖超标 */
const vSugar = chatMeal.mealVerdict({
  meal: nutri({ kcal: 300, protein: 5, sodium: 100, sugar: 30 }),
  before: nutri({ kcal: 800, protein: 5, sodium: 100, sugar: 30 }),
  quota: verdictQuota,
})
check(
  '**钠不超标时说话的是糖**',
  vSugar === '这餐添加糖 30g，今天已经到上限的 120%。',
  vSugar
)

/* 蛋白那一档:钠、糖都合规,蛋白不到一半 —— 「没吃够」和上面两条方向相反 */
const vProtein = chatMeal.mealVerdict({
  meal: nutri({ kcal: 300, protein: 5, sodium: 100, sugar: 5 }),
  before: nutri({ kcal: 800, protein: 5, sodium: 100, sugar: 5 }),
  quota: verdictQuota,
})
check(
  '**钠糖都合规、蛋白不到一半时说话的是蛋白**',
  vProtein === '这餐蛋白质 5g，今天还差 50g。',
  vProtein
)

/* 热量兜底:蛋白也够了(50/60 = 83%),前三条全不成立 */
const vKcal = chatMeal.mealVerdict({
  meal: nutri({ kcal: 123, protein: 20, sodium: 100, sugar: 5 }),
  before: nutri({ kcal: 1177, protein: 30, sodium: 100, sugar: 5 }),
  quota: verdictQuota,
})
check(
  '**前三条都不成立时,兜底说的是热量**',
  vKcal === '这餐 123 kcal，占今天配额的 65%。',
  vKcal
)
check(
  '**四句话各不相同**(有两条撞上就说明这一节的夹具没有区分度,后面四条等于白写)',
  new Set([vSodium, vSugar, vProtein, vKcal]).size === 4,
  [vSodium, vSugar, vProtein, vKcal].join(' | ')
)

/* 上限为 0 的项要跳过 —— 不跳就是一句「上限的 Infinity%」 */
{
  const v = chatMeal.mealVerdict({
    meal: nutri({ kcal: 300, sodium: 900, sugar: 30 }),
    before: nutri({ kcal: 800, sodium: 900, sugar: 30 }),
    quota: { ...verdictQuota, sodium: 0 },
  })
  check(
    '**钠上限为 0 时跳过钠那一档**(不跳会算出 Infinity%)',
    !v.includes('Infinity') && v === '这餐添加糖 30g，今天已经到上限的 120%。',
    v
  )

  const bare = chatMeal.mealVerdict({
    meal: nutri({ kcal: 123, protein: 40 }),
    before: nutri({ protein: 40 }),
    quota: { ...verdictQuota, kcal: 0 },
  })
  check(
    '连热量上限都没有时,只报这一餐自己的量(不拿一个没有分母的百分比凑数)',
    bare === '这餐 123 kcal。',
    bare
  )
}

/* ---------- ② 那条临时记录:只进 query ---------- */
{
  const profile = state().profile
  const pending = {
    slot: '午餐',
    items: [{ foodId: justEaten.id, name: justEaten.name, grams: 150 }],
    engine: 'agent',
  }
  const AT = new Date('2026-09-22T12:30:00')
  const synthetic = chatMeal.syntheticEntry(pending, AT)

  check(
    '**那条记录补的是「今天」和「这一刻」**(由调用时的 now 决定,不是写死的)',
    synthetic.date === '2026-09-22' && synthetic.time === '12:30',
    `${synthetic.date} ${synthetic.time}`
  )
  check('餐次沿用识别出来的那一餐', synthetic.slot === '午餐', synthetic.slot)
  /*
    ⚠️ 两处 `?.` 不是防御性编程:`items` 空掉的时候,**这一条必须是红的,
    不能是崩的** —— 崩掉的话整个脚本停在半路,后面几条一个字都不打印,
    而弄坏自检只会看到一句「那一行没打印出来」,分不清是「没红」还是「炸了」。
    (第一次跑就是这么绿的 —— 见 breaktest 里那条 why。)
  */
  check(
    '菜和克数原样带过去(这一层不能再动分量)',
    synthetic.items.length === 1 && synthetic.items[0]?.grams === 150,
    `${synthetic.items.length} 道 / ${synthetic.items[0]?.grams}g`
  )
  check(
    '**它不带缩略图**(那是给日记页渲染的,而这条记录永远不会被渲染)',
    !('thumb' in synthetic),
    Object.keys(synthetic).join(',')
  )

  /*
    两边都拿**空日记**当底 —— 不拿 `state().meals`。
    底里有记录的话,下面那条「不塞时搜不到」就可能被种子里的某道菜蹭绿,
    而它正是「塞了之后真的有」这句话的锚点。
  */
  const ask = { text: '这餐咸吗', now: AT }
  const alone = JSON.parse(agentContext.buildAgentQuery(profile, [], ask))
  const withIt = JSON.parse(agentContext.buildAgentQuery(profile, [synthetic], ask))
  const namesIn = (q) => q.todayIntake.meals.flatMap((m) => m.items).map((i) => i.name)
  const gramsIn = (q) =>
    q.todayIntake.meals.flatMap((m) => m.items).filter((i) => i.name === justEaten.name).map((i) => i.grams)

  /*
    ⚠️ 这一节最要紧的一条。不塞的话,食衡手上是**归档之前**的摄入,而用户问的
    正是「这餐咸吗」—— 它会拿一份少了这盘菜的数据理直气壮地答。
  */
  check(
    '**不塞这条记录时,query 里一道菜都没有**(所以下面那条不是碰巧成立)',
    namesIn(alone).length === 0,
    `${namesIn(alone).length} 样`
  )
  check(
    '**塞了之后,query 里真的有这道菜和它的克数**',
    namesIn(withIt).includes(justEaten.name) && gramsIn(withIt).includes(150),
    `${namesIn(withIt).join('、')} / 克数 ${gramsIn(withIt).join(',')}`
  )
  check(
    '而且落进了「午餐」那一餐(query 是按餐次分组的,塞错组等于没塞)',
    withIt.todayIntake.meals.some((m) => m.slot === '午餐' && m.items.some((i) => i.name === justEaten.name)),
    withIt.todayIntake.meals.map((m) => m.slot).join(',')
  )

  const mealsBefore = state().meals.length
  check(
    '**它一个字都没写进日记**(id 不在 store 里,条数也没变)',
    state().meals.length === mealsBefore && !state().meals.some((m) => m.id === synthetic.id),
    `${state().meals.length} 条`
  )
}

/* ---------- ③ 会话令牌与闸门 ---------- */
{
  const first = chatSession.beginRun()
  const a = first.newGate()
  const b = first.newGate()
  check('两张图拿到的是两个不同的闸门', a !== b)
  check('刚建的时候都还活着', !a.signal.aborted && !b.signal.aborted)

  /*
    ⚠️ 这一节最要紧的一条。`recognizeOne` 超时会 abort 掉传进去的那个 controller
    (它只有这一个掐断手段)—— 三张共用一个的话,第 1 张超时就把第 2、3 张一起
    打成 aborted,而那两张会被读成「用户自己取消」,于是**一张结果都不出、
    也不报错**:屏上是「第 2、3 张不见了」加一张只有第 1 张的卡。
  */
  a.abort()
  check(
    '**掐掉第 1 张的闸门,第 2 张还是活的**(共用一个的话这里就死了)',
    a.signal.aborted && !b.signal.aborted,
    `a=${a.signal.aborted} / b=${b.signal.aborted}`
  )

  const second = chatSession.beginRun()
  check('**又发一批时,上一批在途的闸门被掐断**(不白烧一次视觉调用)', b.signal.aborted)
  check('旧令牌不算数了', !chatSession.isCurrentRun(first.token))
  check('新令牌算数', chatSession.isCurrentRun(second.token))
  check('令牌是单调递增的', second.token > first.token, `${first.token} → ${second.token}`)
}

/* ---------- ④ 离开页面:作废 + 回收 ---------- */
{
  const run = chatSession.beginRun()
  const gate = run.newGate()
  chatSession.endRun()
  check('**离开页面之后那一批不算数了**(醒来也不往屏幕上写)', !chatSession.isCurrentRun(run.token))
  check('而且闸门真的被掐断了', gate.signal.aborted)
  check('endRun 之后 beginRun 拿到的令牌仍然是新的', chatSession.beginRun().token > run.token)
}

/*
  ---------- ⑤ 发出去的那几张,离开页面时统一回收 ----------

  这一类泄漏**一条都断言不了**,除非把它拦住:少撤一个 object URL 不会报错、
  也不会慢到能被注意到,只是每拍一张就多占住一个几 MB 的 blob
  (`composer.ts` 文件头那段话说的就是这件事)。

  所以这里把 `URL.revokeObjectURL` 换成一个记录器 —— Node 里它是可写可配置的
  (属性描述符 `{writable: true, configurable: true}`),不是只读的原生方法。
*/
{
  const revoked = []
  const realRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = (u) => revoked.push(u)

  /* 发出去的那几张 —— 从 `takeAll` 起就挂在消息气泡上,只能等离开这一页 */
  chatSession.registerUrl('blob:chat-a')
  chatSession.registerUrl('blob:chat-b')
  chatSession.registerUrl('blob:chat-a') // 同一串登记两次
  chatSession.releaseUrls()
  check(
    '**这一页发出去的那几张,离开时全部撤销**',
    ['blob:chat-a', 'blob:chat-b'].every((u) => revoked.includes(u)),
    revoked.join(',')
  )
  check(
    '同一串登记两次也只撤一次(登记表是 Set,不是数组)',
    revoked.filter((u) => u === 'blob:chat-a').length === 1,
    `${revoked.filter((u) => u === 'blob:chat-a').length} 次`
  )
  chatSession.releaseUrls()
  check(
    '**再 release 一次是空操作**(表格已经清了,不会把上一批再撤一遍)',
    revoked.length === 2,
    `${revoked.length} 次`
  )

  /* 攒了没发就走人 —— 那几张归 `composer.discardAll` */
  const staged = composer.emptyStaged()
  stage(staged, [photo(1), photo(2)])
  const unsent = staged.photos.map((p) => p.url)
  composer.discardAll(staged)
  check(
    '**选了又不想发,那几个 blob 也要还回去**(不还就等刷新页面才释放)',
    unsent.every((u) => revoked.includes(u)),
    `${unsent.length} 张 / 撤了 ${revoked.length} 次`
  )
  check('盒子也空了(不然再进这一页还看得见几张旧图)', staged.photos.length === 0, `${staged.photos.length} 张`)

  URL.revokeObjectURL = realRevoke
}

/* ============================================================
   14. 「待补记」那一份草稿
   ============================================================
   对话页发图**不记日记**（用户可能只是在问「这餐咸吗」，根本没吃），但那次识别
   留着，下次进这一页问一句。这一节验的就是那份等着被问的草稿。

   三件事各有各的坏法,而三种坏法**都不会报错**:

     · 记进去的克数 —— 错了的表现是同一顿饭在两条路上有两个克数,
       而界面上没有任何地方能看出这件事;
     · 该不该问 —— 错了的表现是弹一句问话,让用户把一道 0 kcal 的菜记进日记;
     · 预览图归谁撤 —— 错了的表现是**什么都不发生**,只在内存里慢慢涨。

   `renderToStaticMarkup` 不跑 effect、也点不动任何东西,所以「弹窗弹起 → 点
   记入日记 → 写进日记」那一串在界面自检里一步都够不到 —— 判据全在这几个
   纯函数里,这里逐条钉住。
   ============================================================ */

console.log('\n=== 14. 「待补记」那一份草稿 ===')

const unlogged = await load('/src/store/unlogged.ts')
const {
  unloggedFrom,
  worthAsking,
  shouldAskUnlogged,
  saveUnlogged,
  loadUnlogged,
  clearUnlogged,
  clearUnloggedFor,
  parseUnlogged,
  unloggedWhen,
  okPhotoBlobs,
} = unlogged
const { previewOwnership } = await load('/src/store/recognizeOne.ts')
const { normalPortionItems } = portion

/*
  夹具：两份**只差一个 `engine`** 的「同一盘菜」。

  克数刻意取库里的常见分量 **+10**，而且是个 5 的倍数 —— 于是两条断言互相
  咬得住：真实路径要求它**原样不动**，演示路径要求它**被换回**常见分量。
  取成和常见分量相等的话，「换回常见分量」那条就恒真了（下面有一条自检盯着
  这件事，改动夹具时会先红那一条，而不是红一条看不懂的）。
*/
const RICE = FOOD_BY_ID.get('rice')
const PORK = FOOD_BY_ID.get('pepper-pork')
const NOISE = 10
const SENTINEL = { foodId: 'unmatched:折耳根', name: '折耳根', grams: 0 }

const plateItems = () => [
  { foodId: RICE.id, name: RICE.name, grams: RICE.defaultGrams + NOISE },
  { foodId: PORK.id, name: PORK.name, grams: PORK.defaultGrams + NOISE },
]
/** 一份「识别结果」。`slot` 固定午餐，下面好几条要拿它当期望值 */
const plate = (engine) => ({ slot: '午餐', items: [...plateItems(), SENTINEL], engine })

check(
  '(自检) 夹具的克数落在 5 的倍数上 —— 真实路径那条「原样不动」靠这个前提',
  (RICE.defaultGrams + NOISE) % 5 === 0 && (PORK.defaultGrams + NOISE) % 5 === 0 && NOISE > 0,
  `米饭 ${RICE.defaultGrams + NOISE}g / ${PORK.name} ${PORK.defaultGrams + NOISE}g`
)

/* ---------- ① 跳过 /portion 那一屏,写进日记的克数 ---------- */
{
  const agentIn = plate('agent')
  const demoIn = plate('demo')
  const agentOut = normalPortionItems(agentIn)
  const demoOut = normalPortionItems(demoIn)

  check(
    '**真实识别那份，归一化之后逐字段等于识别结果**（用户没改分量，数字就不该动）',
    agentOut.length === agentIn.items.length &&
      agentOut.every(
        (it, i) =>
          it.foodId === agentIn.items[i].foodId &&
          it.name === agentIn.items[i].name &&
          it.grams === agentIn.items[i].grams
      ),
    agentOut.map((i) => `${i.name} ${i.grams}g`).join(' / ')
  )

  check(
    '**演示路径：噪声克数被换回库里的常见分量**（和用户在 /portion 点「常规」是同一个数）',
    demoOut[0].grams === RICE.defaultGrams && demoOut[1].grams === PORK.defaultGrams,
    `${demoOut[0].grams} / ${demoOut[1].grams}`
  )
  check(
    '**换回来的不是进来那个数**（和上一条一起才成立：一条说「等于库里的」，一条说「不等于噪声的」）',
    demoOut[0].grams !== demoIn.items[0].grams && demoOut[1].grams !== demoIn.items[1].grams,
    `进来 ${demoIn.items[0].grams} / ${demoIn.items[1].grams}`
  )

  /*
    ⚠️ 这条断的是「**这道菜还在、名字没被改**」，不是「它的克数是 0」。

    克数那半条**永远红不了**：哨兵项克数 0 走到哪儿都是 0（`baseGramsFor` 对
    库里查不到的 id 退回 `item.grams`，而 `portionGrams(0,'normal')` 的兜底值
    传的正是 0）。写成断言就是一条永远绿的假断言 —— 见 `lib/portion.ts` 里
    那段注释。所以只钉真正会坏的那一半：归一化只回答「多少克」，
    **不回答「有没有这道菜」**，把未收录的菜筛掉就是让一道菜从日记里消失。
  */
  check(
    '**未收录的那道菜还在，名字也没被改**（归一化不回答「有没有这道菜」）',
    demoOut.length === demoIn.items.length &&
      demoOut[2].foodId === SENTINEL.foodId &&
      demoOut[2].name === '折耳根',
    `${demoOut.length} 道 / 第 3 道是 ${demoOut[2]?.name}`
  )
}

/* ---------- ② 这一份值不值得问 ---------- */

/*
  ⚠️ **判据 2026-09-24 翻过一次，写清楚免得下一个人按旧版改。**

  旧判据是 `countableItems(...).length > 0`（「有几道**能算出营养的**」），
  它当时拦住的是：一份全是库外菜的结果被记进日记 → 一条 0 kcal 的记录，
  而弹窗上还写着「识别到 3 道菜」。**那件事仍然不许发生**，但发图那一刻判不了
  它了 —— 那天起**发图不算营养**（要记进日记时才调食衡算，见 `ChatScreen`
  的 `computeForLog`），库外菜和库内菜在屏上长得一模一样，没有数可比。

  所以判据挪到它真正管得着的地方：**记录那一刻**（`computeForLog` 算完还是
  一道能计量的都没有 → 不落盘）。这一层只问「值不值得占用户一次注意力」——
  模型报了菜就值得，哪怕它报的那道菜此刻还查不到营养。
*/
{
  check(
    '**有没有菜看的是「模型报了几道」**（就一道库里没有的菜，问还是要问）',
    worthAsking({ slot: '午餐', items: [SENTINEL], engine: 'demo' }) === true,
    '只有一道未收录的菜 —— 它照样是一道「模型认出来的菜」'
  )
  check(
    '有一道可计量的菜 → 问（哪怕它旁边就有一道未收录的）',
    worthAsking({ slot: '午餐', items: [SENTINEL, plateItems()[0]], engine: 'agent' }) === true
  )
  check(
    '**`items` 是空的 → 不问**（过敏拦截那一整份就是空的，全失败则走不到这里）',
    worthAsking({ slot: '午餐', items: [], engine: 'agent' }) === false
  )
}

/* ---------- ③ 从一批识别结果做出那份草稿 ---------- */
const thumbOf = (n) => `data:image/jpeg;base64,thumb-${n}`
const okOutcome = (engine = 'agent') => ({ kind: 'ok', meal: plate(engine) })
const demoMeal = (reason = '连不上识别服务，本次为演示数据') => ({ ...plate('demo'), degradedReason: reason })
const degradedOutcome = (reason) => ({ kind: 'degraded', meal: demoMeal(reason), reason })
const AT = new Date(2020, 0, 2, 8, 5).getTime()

{
  const blocked = unloggedFrom({
    meal: { slot: '午餐', items: [], engine: 'agent' },
    outcomes: [okOutcome()],
    thumbs: [thumbOf(1)],
    profileId: 'p-a',
    from: 'photo',
  })
  check('**一道菜都没有的那一次不进草稿**（点「记入日记」会写进一条 0 kcal 的记录）', blocked === null)

  const three = unloggedFrom({
    meal: plate('agent'),
    outcomes: [okOutcome(), okOutcome(), okOutcome()],
    thumbs: [thumbOf(1), thumbOf(2), thumbOf(3)],
    profileId: 'p-a',
    from: 'photo',
    now: new Date(AT),
  })
  check('三张全成功 → 小图是第 1 张的', three.thumb === thumbOf(1), String(three.thumb))
  check(
    '**草稿里的菜一道不少、顺序也没变**（含那道未收录的 —— 弹窗上显示的就是这几道）',
    JSON.stringify(three.items.map((i) => i.foodId)) ===
      JSON.stringify(plate('agent').items.map((i) => i.foodId)),
    three.items.map((i) => i.foodId).join(' / ')
  )
  check(
    '`slot` 跟着那一份结果走，而且**不挂**演示数据横幅（真实识别那份没理由挂）',
    three.slot === '午餐' && 'degradedReason' in three === false
  )
  check(
    '`at` 用的是**传进来的**那个时刻（自检要固定时间，不能读真实钟）',
    three.at === AT,
    new Date(three.at).toString()
  )

  /*
    ⚠️ 这一节最要紧的一条。发三张时小图只能代表其中一张，但**第 1 张降级、
    菜全来自第 2、3 张**的时候，把第 1 张的照片摆在那几道菜旁边就是在暗示一个
    不存在的因果 —— 正是 `mergeMeals` 拒绝带预览图的同一条理由。
  */
  const partial = unloggedFrom({
    meal: plate('agent'),
    outcomes: [degradedOutcome('连不上识别服务，本次为演示数据'), okOutcome(), okOutcome()],
    thumbs: [thumbOf(1), thumbOf(2), thumbOf(3)],
    profileId: 'p-a',
    from: 'photo',
  })
  check(
    '**第 1 张降级了 → 不拿第 1 张的小图，拿第 1 张成功的那张**',
    partial.thumb === thumbOf(2) && partial.thumb !== thumbOf(1),
    String(partial.thumb)
  )

  /*
    ⚠️ **这一份的 `outcomes` 里刻意放了一张 `ok`，而那是真实路径走不出来的组合。**

    真实的 `mergeMeals` 只在**全是降级**时才给 `engine: 'demo'`（它直接返回第一份
    降级餐盘），而那种输入下 `firstOkThumb` 本来就找不到 ok —— 于是「demo 不带小图」
    被**两条独立的保证**共同兜住，单独改掉任何一条都不会让它变红。一条怎么弄都红的
    断言是假断言，所以这里造出那个只有一条保证成立的输入。

    代价说清楚：这钉的是 `unloggedFrom` **自己的契约**（「engine 说了算」），
    不是一个人碰得到的输入。那个契约值得钉 —— 下一个人改 `mergeMeals` 的 engine
    规则时，这里必须跟着响。
  */
  const demoDraft = unloggedFrom({
    meal: demoMeal(),
    outcomes: [degradedOutcome('连不上识别服务，本次为演示数据'), { kind: 'ok', meal: demoMeal() }],
    thumbs: [thumbOf(1), thumbOf(2)],
    profileId: 'p-a',
    from: 'photo',
  })
  check(
    '**演示数据不带小图**（那份菜是本地随机组的，和照片没有任何关系）',
    demoDraft.thumb === undefined && 'thumb' in demoDraft === false,
    String(demoDraft.thumb)
  )
  check(
    '而且它自己那份「这是演示数据」跟着走（弹窗上要挂同一条横幅）',
    demoDraft.degradedReason === '连不上识别服务，本次为演示数据',
    String(demoDraft.degradedReason)
  )
  /*
    ⚠️ 这一条从前断的是「演示那份的菜也是**归一化过的**」（噪声克数被换回库里
    的常见分量）。2026-09-24 起这一层**不动克数了** —— 草稿存的是「模型说这
    一餐有哪些菜」，数要到**记进日记那一刻**才由食衡给（`store/unlogged.ts`
    文件头第 2 段）。所以判据换成反过来的那半：**原样带过去，一个数都不改**。

    为什么这件事值得钉：如果这一层哪天又顺手改起克数来，它改的是一份**没有
    营养**的清单 —— 用户不会在弹窗上看到任何差别（那屏一个数字都不印），
    而记进日记的是食衡算的那一份，于是这次改动**在屏幕上完全看不出来**。
  */
  check(
    '**这一层一个克数都不改**（草稿是菜名清单：数要到记日记那一刻才由食衡给）',
    demoDraft.items.length === demoMeal().items.length &&
      demoDraft.items.every((it, i) => it.grams === demoMeal().items[i].grams),
    demoDraft.items.map((i) => `${i.name} ${i.grams}g`).join(' / ')
  )
}

/* ---------- ③b 存进 IndexedDB 的是哪几张照片（2026-09-24） ---------- */

/*
  ⚠️ 这是新链路里**最容易静默错位**的一处。`onImage` 只在识别成功那条路上跑
  （取消的、降级的、失败的那几张根本不交），而它交回来的 blob 是按
  `batch` 的下标对齐的 —— 直接 `filter(Boolean)` 就会把**第 2 张的照片配到
  第 3 道菜上**，或者把一张降级图喂给食衡。

  后果在屏幕上长这样：用户记进日记的那一餐，菜对了、数也有，
  只是**其中一张照片是另一张图**。没有任何报错，日记里也看不出来。

  所以判据是「下标对齐 + 只挑 ok」，而且下面刻意用了一组**三种归宿混在一起**
  的输入 —— 只挑 ok 那半条和下标对齐那半条各有一个反例。
*/
{
  /*
    三张**大小各不相同**的照片（1/2/3 字节）。用「第几张」当证据的话，两张
    一样大的 blob 会让证据失去区分度 —— 那是量具的问题，不是断言的问题。
    拿对象本身比 `===` 更准：它同时钉住了「没有复制、没有重排、没有换一个」。
  */
  const [p1, p2, p3] = [1, 2, 3].map((n) => new globalThis.Blob(['x'.repeat(n)], { type: 'image/jpeg' }))
  const which = (b) => (b === p1 ? '第1张' : b === p2 ? '第2张' : b === p3 ? '第3张' : '别的')

  const both = okPhotoBlobs([okOutcome(), okOutcome()], [p1, p2])
  check(
    '两张都成功 → 两张照片，而且就是那两个（没有复制、没有换一个）',
    both.length === 2 && both[0] === p1 && both[1] === p2,
    both.map(which).join(' / ')
  )

  const mixed = okPhotoBlobs(
    [degradedOutcome('连不上识别服务，本次为演示数据'), okOutcome(), { kind: 'cancelled' }],
    [p1, p2, p3]
  )
  check(
    '**降级的、取消的那两张都不带**（它们的照片和这份清单无关，喂给食衡等于让它去认一张别的图）',
    mixed.length === 1,
    `${mixed.length} 张 —— 挑错了就是把一张别的图喂给食衡`
  )
  check(
    '**而且留下的正好是第 2 张**（按 `outcomes` 的下标对齐，不是按先后挤一挤）',
    mixed[0] === p2,
    which(mixed[0])
  )

  check(
    '**没交过 blob 的那个下标不会塞一个空洞进去**（`onImage` 没跑时那个位置是 `undefined`）',
    okPhotoBlobs([okOutcome()], [undefined]).length === 0 &&
      okPhotoBlobs([okOutcome(), okOutcome()], [undefined, p2]).length === 1,
    String(okPhotoBlobs([okOutcome()], [undefined]).length)
  )
}

/* ---------- ④ 现在该不该弹 ---------- */
{
  const mine = unloggedFrom({
    meal: plate('agent'),
    outcomes: [okOutcome()],
    thumbs: [thumbOf(1)],
    profileId: 'p-a',
    from: 'photo',
  })
  check('没有草稿 → 不弹', shouldAskUnlogged(null, 'p-a') === false)
  check(
    '**草稿是别人的 → 不弹**（弹了用户会看到一份他不认识的菜，而唯一的操作是把它记进自己的日记）',
    shouldAskUnlogged(mine, 'p-b') === false
  )
  check('是自己那份 → 弹', shouldAskUnlogged(mine, 'p-a') === true)
}

/* ---------- ⑤ 落盘、读回、清掉 ---------- */

/**
 * 假的 localStorage。三个方法就是全部契约（`StorageLike`），
 * `_dump` 只给下面那条「盘上到底躺着什么」的断言用。
 */
const fakeStorage = () => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    _dump: () => [...map.values()].join(''),
  }
}

{
  const box = fakeStorage()
  const draft = unloggedFrom({
    meal: plate('agent'),
    outcomes: [okOutcome(), okOutcome()],
    thumbs: [thumbOf(1), thumbOf(2)],
    profileId: 'p-a',
    from: 'photo',
    now: new Date(AT),
  })

  check('写成功（存储在那儿）', saveUnlogged(draft, { storage: box }) === true)

  const back = loadUnlogged('photo', { storage: box })
  /*
    ⚠️ **逐字段比，不比 `JSON.stringify` 的整串。** 两条路径构造这个对象的顺序
    不同（写入那条是 `…, thumb, at`，解析那条是 `…, at, thumb`），序列化出来的
    字符串就不一样 —— 拿整串比会因为一次**合法的字段重排**变红，而它想盯的是值。

    （`items` 可以整串比：两边都是同一个对象过了一次 JSON 往返，键序被保住了。）
  */
  check(
    '**读回来逐字段相等**（含那道未收录的菜和小图）',
    back !== null &&
      back.profileId === draft.profileId &&
      back.slot === draft.slot &&
      back.at === draft.at &&
      back.thumb === draft.thumb &&
      JSON.stringify(back.items) === JSON.stringify(draft.items),
    JSON.stringify(back)
  )
  /*
    键集**正好**这几个。这条盯的是 `store.ts` 的 `addMeal` 记过的那个坑：
    写成 `degradedReason: o.degradedReason` 而不是条件展开，内存里就会多一个
    `degradedReason: undefined` 的键（`JSON.stringify` 会跳过它，但
    `'…' in meal` 是 true）。`photoUrl` 也由这条挡着 —— 那是个刷新即死的
    object URL，存进去等于埋一个永远裂图的 img。
  */
  check(
    '**草稿的键正好这几个**（不许有 `undefined` 的空键，也不许混进 `photoUrl`）',
    JSON.stringify(Object.keys(back).sort()) ===
      JSON.stringify(['at', 'from', 'items', 'profileId', 'slot', 'thumb']),
    Object.keys(back).join(',')
  )
  check('(锚点) 盘上确实有东西 —— 上面那条不是拿一份空文本在比', box._dump().includes('折耳根') && box._dump().includes('thumb-1'))
  /*
    `from` 必须**活着回来**。它漏进白名单重建的表现是「刷新一次字段静默消失」——
    不报错、不抛，只是下一次 `loadUnlogged` 收下一份没有 `from` 的草稿，
    然后 `KEYS[undefined]` 落进一个不存在的位。上面那条键集断言抓不到它
    （键集是**读回来那份**的），所以这里单独钉一次。
  */
  check('**`from` 跟着过了一次读写**（漏进白名单重建会静默消失）', back.from === 'photo', String(back.from))

  clearUnlogged('photo', { storage: box })
  check('清掉之后读出来是 null（「问过一次的不再问」全靠这一步）', loadUnlogged('photo', { storage: box }) === null)

  /* 坏数据一律拒绝，而且**不许抛** —— 抛出去就是整页白给 */
  const KEY_SHAPE = {
    profileId: 'p-a',
    from: 'photo',
    slot: '午餐',
    at: 1,
    items: [{ foodId: 'rice', name: '米饭', grams: 150 }],
  }
  const { from: _drop, ...WITHOUT_FROM } = KEY_SHAPE
  const bad = [
    ['不是对象', 'x'],
    ['是 null', null],
    ['是数字', 42],
    ['缺 items', { profileId: 'p-a', slot: '午餐', at: 1 }],
    /* 旧形状（升级前躺在盘上的那一份）—— 文件头「两个存档位」那段说的整份丢掉 */
    ['没有 `from` 的旧形状', WITHOUT_FROM],
    ['`from` 是别的值', { ...KEY_SHAPE, from: 'camera' }],
    ['`from` 是空串', { ...KEY_SHAPE, from: '' }],
    ['items 不是数组', { ...KEY_SHAPE, items: 'x' }],
    ['items 是空的', { ...KEY_SHAPE, items: [] }],
    ['items 里是个空对象', { ...KEY_SHAPE, items: [{}] }],
    ['items 的克数是字符串', { ...KEY_SHAPE, items: [{ foodId: 'rice', name: '米饭', grams: '150' }] }],
    ['slot 不在餐次表里', { ...KEY_SHAPE, slot: 'brunch' }],
    ['slot 不是字符串', { ...KEY_SHAPE, slot: 3 }],
    ['thumb 不是字符串', { ...KEY_SHAPE, thumb: 123 }],
    ['at 不是数字', { ...KEY_SHAPE, at: '2020-01-02' }],
    ['profileId 不是字符串', { ...KEY_SHAPE, profileId: 7 }],
  ]
  let threw = null
  let accepted = []
  try {
    accepted = bad.filter(([, v]) => parseUnlogged(v) !== null).map(([label]) => label)
  } catch (e) {
    threw = e
  }
  check(
    `**${bad.length} 份坏数据全部拒收，且一份都不抛**（抛出去就是整页白给）`,
    threw === null && accepted.length === 0,
    threw ? `抛了 ${threw}` : accepted.join(' / ')
  )

  /* 形状对的那份必须收下 —— 不然上面那条可以靠「什么都不收」变绿 */
  const good = parseUnlogged(KEY_SHAPE)
  check(
    '(锚点) 形状对的那份收得下，而且 `from` 没被吃掉',
    good !== null && good.items[0].foodId === 'rice' && good.from === 'photo',
    JSON.stringify(good)
  )
  check('`from: \'text\'` 那份也收得下（打字那条路要写的就是这个值）', parseUnlogged({ ...KEY_SHAPE, from: 'text' })?.from === 'text')
}

/* ---------- ⑥ 按档案清 ---------- */
{
  const box = fakeStorage()
  const mine = unloggedFrom({
    meal: plate('agent'),
    outcomes: [okOutcome()],
    thumbs: [thumbOf(1)],
    profileId: 'p-a',
    from: 'photo',
  })
  const typed = unloggedFrom({
    meal: plate('agent'),
    outcomes: [],
    thumbs: [],
    profileId: 'p-a',
    from: 'text',
  })

  saveUnlogged(mine, { storage: box })
  clearUnloggedFor('p-b', { storage: box })
  check(
    '**清的是别人的档案 → 我这份留着**（切档案是来回的，切回来还该看得到）',
    loadUnlogged('photo', { storage: box }) !== null
  )
  clearUnloggedFor('p-a', { storage: box })
  check('清的是我这份 → 没了', loadUnlogged('photo', { storage: box }) === null)

  /*
    ⚠️ **两个位都要清。** 这一节的调用点（删档案 / 重置成演示数据）的意思是
    「这个人的东西都不留」，不是「把上次问的那一份处理掉」—— 少清一个位，
    那份草稿会指着一个已经不存在的档案活着，下次进对话页弹出来的是
    **另一个人的菜**（`shouldAskUnlogged` 本来正是拦这个的，但那份草稿
    此刻还在盘上，等于把一个本该不存在的东西留在了那儿）。
  */
  saveUnlogged(mine, { storage: box })
  saveUnlogged(typed, { storage: box })
  check(
    '(锚点) 清之前两个位上各有一份 —— 下面那条不是拿两个空位在比',
    loadUnlogged('photo', { storage: box })?.from === 'photo' && loadUnlogged('text', { storage: box })?.from === 'text'
  )
  clearUnloggedFor('p-a', { storage: box })
  check(
    '**两个位一起清**（只清 `photo` 那条实现会让这条变红）',
    loadUnlogged('photo', { storage: box }) === null && loadUnlogged('text', { storage: box }) === null
  )

  /* 反过来：只清一个位时另一个必须留着 —— 「记掉拍的那一餐」不该扔掉打字那份 */
  saveUnlogged(mine, { storage: box })
  saveUnlogged(typed, { storage: box })
  clearUnlogged('photo', { storage: box })
  check(
    '**只清 `photo` → 打字那份原封不动**（记掉拍的一餐不该顺手扔掉还没被问过的那份）',
    loadUnlogged('photo', { storage: box }) === null && loadUnlogged('text', { storage: box })?.from === 'text'
  )
}

/* ---------- 打字问出来的那一份（`from: 'text'`） ----------

  用户 2026-09-24：「如果我是问菜的做法，刷新后就不会弹出是否记入日记的窗口，
  但我觉得这个是需要的」。他定的口径是**回答里有菜名就弹**。

  这一节盯的是那条路上的三个连接处：`provisionalFromReply`（reply → 一份
  `RecognizedMeal`）、`unloggedFrom`（那份 → 草稿，`from: 'text'`）、
  以及**记入日记那一刻**由 `recognizeByNames` 把菜名交回给食衡算营养
  （见下面那节 —— 本地凑数的那一版被用户驳回过）。
*/
const { provisionalFromReply } = await load('/src/lib/recognizeAgent.ts')
const { parseAgentReply } = await load('/src/lib/agentReply.ts')

/**
 * 一份最小的合法回复 —— 只给这一节用得着的字段，其余交给解析器的默认值。
 *
 * ⚠️ 菜的清单裹在 `result` 里（模型的真实形状，见 `verify-reply.mjs` 的夹具）——
 * 平铺在顶层的话解析器拿不到 `dishes`，于是这一节会全绿着什么都不测。
 */
const replyWith = (dishes, extra = {}) =>
  parseAgentReply(
    JSON.stringify({
      blocked: false,
      risk: { level: 'low', message: '', items: [] },
      result: { mode: 'dish', title: '', dishes, advice: [], disclaimer: '' },
      ...extra,
    })
  )

{
  /*
    ① 回答里有菜名 → 一份草稿。仓里的菜走 `foodId`，库外的落哨兵 —— 和发图
    那条路走的是**同一个** `matchDishes`，所以「库里有没有这道菜」两边的答案一致。
  */
  const meal = provisionalFromReply(replyWith([{ name: RICE.name }, { name: '折耳根' }]), '午餐')
  check(
    '(锚点) 回答里的菜名能变成一份结果（仓里的配上 id，库外的落哨兵）',
    meal !== null && meal.items.length === 2 && meal.items[0].foodId === RICE.id,
    JSON.stringify(meal?.items)
  )

  const typed = meal && unloggedFrom({ meal, outcomes: [], thumbs: [], profileId: 'p-a', from: 'text' })
  check('**打字那份的 `from` 是 `text`**（写死成 `photo` 会让它顶掉他拍的那一餐）', typed?.from === 'text', String(typed?.from))
  check(
    '**打字那份不带小图**（空数组是它的真实形状 —— 它一张照片都没有）',
    typed !== null && 'thumb' in typed === false,
    String(typed?.thumb)
  )
  check(
    '餐次跟着那份结果走，`at` 是一个时刻（弹窗上那句「今天 12:30 聊到的」要用它）',
    typed?.slot === '午餐' && typeof typed?.at === 'number',
    `${typed?.slot} / ${typed?.at}`
  )

  /*
    ② 只有「未知菜品」→ 一条草稿都不写。`provisionalFromReply` 自己滤掉它们，
    返回 null —— 这里断言的是**这条路真的不写**，不是那个正则长什么样。
  */
  check(
    '**模型只回了一句「未知菜品」→ 不写草稿**（滤完一道菜都不剩）',
    provisionalFromReply(replyWith([{ name: '未知菜品' }]), '午餐') === null
  )
  check('解析不出结构（没拿到回复）→ 不写草稿', provisionalFromReply(null, '午餐') === null)

  /*
    ③ 过敏拦截 → **不写草稿**。它交回来的是一份 `items: []`，`worthAsking`
    判「不值得问」—— 拦下来的东西不该顺手变成一句「要补记这一餐吗」。
  */
  const blockedMeal = provisionalFromReply(
    replyWith([], { blocked: true, risk: { level: 'high', message: '含花生', items: ['花生'] } }),
    '午餐'
  )
  check('过敏拦截那一份的 `items` 是空的', blockedMeal !== null && blockedMeal.items.length === 0)
  check(
    '**过敏拦截 → 不写草稿**（拦下来的东西不该变成一句「要补记这一餐吗」）',
    blockedMeal !== null && unloggedFrom({ meal: blockedMeal, outcomes: [], thumbs: [], profileId: 'p-a', from: 'text' }) === null
  )

  /*
    ④ 两份**互不覆盖**：这是用户选的口径（「两份都留着」）。这一条和 ⑥ 里
    那两条不重复 —— 那两条盯的是「清」，这条盯的是「写」。
  */
  const box = fakeStorage()
  const photoDraft = unloggedFrom({
    meal: plate('agent'),
    outcomes: [okOutcome()],
    thumbs: [thumbOf(1)],
    profileId: 'p-a',
    from: 'photo',
  })
  saveUnlogged(photoDraft, { storage: box })
  if (typed) saveUnlogged(typed, { storage: box })
  check(
    '(锚点) 打字那份真的存下去了 —— 不然下面那条是拿两个空位在比',
    loadUnlogged('text', { storage: box }) !== null && loadUnlogged('photo', { storage: box }) !== null
  )
  check(
    '**先拍后打字 → 两份各在各的位上**（后写的没顶掉先写的）',
    loadUnlogged('photo', { storage: box })?.from === 'photo' && loadUnlogged('text', { storage: box })?.from === 'text'
  )
}

/* ---------- 打字那份的营养：**交给食衡**，不在本地凑 ----------

   用户 2026-09-24 驳回过一版：「算营养计入日记这件事是交给食衡 agent 来做的」。
   那一版是拿食物库的常见分量在本地配一份（`defaultPortionItems`），看着像结果、
   其实不是食衡算的数 —— 库外菜在没有联网那一步时只剩一个本地编的值。

   所以这一节拿一个假的 `/api/recognize` 盯住 `recognizeByNames` 这条链：
   请求里**没有 `file`**、query 里**带着菜名**、回来的那份**走的是同一个
   `matchDishes`**、以及认不出来时**返回 null 而不是抛**。
*/
{
  const { recognizeByNames } = await load('/src/lib/recognizeAgent.ts')

  /** 记下这一次请求长什么样 */
  let sent = null
  let upstream = ''
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/recognize')) {
      sent = init?.body instanceof FormData ? init.body : null
      return new Response(upstream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    return realFetch(url, init)
  }

  /** 一份 SSE 原文 —— `answer` 里裹着模型那坨 JSON */
  const sseWith = (payload) =>
    `data: ${JSON.stringify({ event: 'message', answer: JSON.stringify(payload) })}\n\n`
  const okReply = (dishes) =>
    sseWith({
      blocked: false,
      risk: { level: 'low', message: '', items: [] },
      result: { mode: 'plate', title: '', dishes, advice: [], disclaimer: '' },
    })

  const app = (await load('/src/store/store.ts')).getSnapshot()

  try {
    /* ---------- ① 正常一趟：没有图、菜名在 query 里 ---------- */
    upstream = okReply([{ name: RICE.name }, { name: '折耳根' }])
    const out = await recognizeByNames({
      names: [RICE.name, '折耳根'],
      slot: '午餐',
      profile: app.profile,
      meals: app.meals,
      user: 'verify-loop',
    })

    check('(锚点) 这一次真的发出去了一个请求', sent !== null)
    check(
      '**请求里没有 `file` 这一项**（有的话服务端会当成一次带图识别 —— 而它没有图）',
      sent !== null && sent.get('file') === null,
      sent === null ? '没发出去' : String(sent.get('file'))
    )

    const payload = JSON.parse(String(sent?.get('payload') ?? '{}'))
    check(
      '**菜名在 query 里**（不进 query 的话模型拿不到任何东西，只会回「未检测到图片」）',
      typeof payload.query === 'string' &&
        payload.query.includes(RICE.name) &&
        payload.query.includes('折耳根'),
      payload.query?.slice(0, 60)
    )
    check(
      '走的是**食衡**那条路（`mode: plate`），不是快路径（`stage: names` 只要菜名、不算营养）',
      payload.query.includes('"mode":"plate"') && !payload.query.includes('"stage"'),
      payload.query.includes('"stage"') ? '带了 stage —— 那一路不算营养' : '完整那一路'
    )
    check('流式（非流式会让这里白等一整趟）', payload.response_mode === 'streaming', String(payload.response_mode))

    /* ---------- ② 回来的那份和拍照那条路是同一把尺子 ---------- */
    check(
      '(锚点) 回答里的菜名变成了一份结果（仓里的配上 id，库外的落哨兵）',
      out !== null && out.items.length === 2 && out.items[0].foodId === RICE.id,
      JSON.stringify(out?.items)
    )
    check(
      '**库外的菜落哨兵、不是被丢掉**（丢掉的话「库里没有」这件事就没人知道了）',
      out !== null && out.items[1].foodId === SENTINEL.foodId,
      String(out?.items?.[1]?.foodId)
    )
    check(
      '`engine` 是 `agent`（这份克数是库里/联网给的，不是本地随机组的）',
      out?.engine === 'agent',
      String(out?.engine)
    )
    check(
      '(锚点) 带营养的那一份确实进来了 —— 不然「联网查回来的值」这条断言是空的',
      out !== null && out.items[0].grams === RICE.defaultGrams,
      `${out?.items?.[0]?.grams}g vs ${RICE.defaultGrams}g`
    )

    /* ---------- ③ 认不出来 / 上游挂了 → null，而且不抛 ---------- */
    upstream = okReply([{ name: '未知菜品' }])
    check(
      '**模型只回了一句「未知菜品」→ null**（滤完一道菜都不剩）',
      (await recognizeByNames({ names: ['折耳根'], slot: '午餐', profile: app.profile, meals: app.meals, user: 'verify-loop' })) === null
    )

    upstream = sseWith({
      blocked: true,
      risk: { level: 'high', message: '含花生', items: ['花生'] },
      result: { mode: 'plate', dishes: [] },
    })
    const blocked = await recognizeByNames({ names: [RICE.name], slot: '午餐', profile: app.profile, meals: app.meals, user: 'verify-loop' })
    check(
      '**过敏拦截那一份不带菜**（它交回来的是 items 空 —— 调用方据此不落盘）',
      blocked === null || blocked.items.length === 0,
      String(blocked?.items?.length)
    )

    upstream = ''
    check(
      '**上游一个字都没回 → null，不是抛**（抛出去会把一次正常回答推进降级分支）',
      (await recognizeByNames({ names: [RICE.name], slot: '午餐', profile: app.profile, meals: app.meals, user: 'verify-loop' })) === null
    )

    globalThis.fetch = async () => {
      throw new Error('network down')
    }
    check(
      '**网络层直接挂 → 还是 null**（同上，这条路不许把失败报出去）',
      (await recognizeByNames({ names: [RICE.name], slot: '午餐', profile: app.profile, meals: app.meals, user: 'verify-loop' })) === null
    )
  } finally {
    globalThis.fetch = realFetch
  }
}

/* ---------- ⑦ 这台机器没有存储 ---------- */
{
  let threw = null
  let loaded = 'n/a'
  let saved = 'n/a'
  try {
    loaded = loadUnlogged('photo', { storage: null })
    saved = saveUnlogged({ profileId: 'p-a', from: 'photo', slot: '午餐', items: [], at: 1 }, { storage: null })
    clearUnlogged('photo', { storage: null })
    clearUnlogged('text', { storage: null })
    clearUnloggedFor('p-a', { storage: null })
  } catch (e) {
    threw = e
  }
  check(
    '**读写全失败时一个字都不抛**（隐私模式 / 配额满；这份草稿丢了只是少问一句）',
    threw === null && loaded === null && saved === false,
    threw ? `抛了 ${threw}` : `load=${loaded} / save=${saved}`
  )
}

/* ---------- ⑧ 弹窗上那句时间前缀 ---------- */
{
  check(
    '**今天 / 昨天之外的日子说成「1月2日 8:05」**（写死字符串，不拿常量现算 —— 那是拿代码验代码）',
    unloggedWhen(AT) === '1月2日 8:05',
    unloggedWhen(AT)
  )
  const now = new Date()
  check('今天识别的说「今天」', unloggedWhen(now.getTime()).startsWith('今天 '), unloggedWhen(now.getTime()))
}

/* ---------- ⑨ 预览图归谁撤 ---------- */
{
  check(
    '传了 `onPrepared` → 交给调用方（首页：挂进 job 的预览）',
    previewOwnership({ onPrepared: () => {} }) === 'caller'
  )
  check(
    '没传 `onPrepared`、但 `attachPreview` → 还是调用方（图挂在结果里）',
    previewOwnership({ attachPreview: true }) === 'caller'
  )
  /*
    对话页就是这一种。**这一支原来漏了**：那串 object URL 谁都不撤，每识别一张
    就泄漏一个几 MB 的 blob，到刷新页面为止 —— 界面上零症状。一次三张就是三个。
  */
  check(
    '**两个都没有 → 自己撤**（漏了这一支就是每张图泄漏一个 blob，而且看不出来）',
    previewOwnership({}) === 'self'
  )
}

/* ============================================================
   15. 趋势图:日记页周/月视图里那四张图背后的算术
   ============================================================
   数全在 `src/lib/trend.ts`,画在 `src/components/TrendCharts.tsx`。这一节
   只验数;「画出来是什么样」在 `verify-render` 那一节(它渲染真组件)。

   这一节的中心是**一条口径**:「没有记录的日子不是 0」。它有三个出口
   (柱子 / 折线 / 餐次占比),而且每一个出口弄错之后**屏幕上都没有症状** ——
   少记一天和那天只吃了一点点,画出来都是一根矮柱子。所以每一条都要单独钉。
*/
{
  const trendMod = await load('/src/lib/trend.ts')
  const { daySeries, barScale, pctOf, segmentsOf, recordedCount, overCount, scoreSummary, slotShare } = trendMod

  /*
    夹具用**真的 `dayStats`**,不是手写对象:手写的 `{mealCount: 1, nutrition: {…}}`
    能骗过这一节的每一条断言,却和 App 里那一天真正算出来的东西没有任何关系。
    米饭 150g = 174 kcal / 3mg 钠(116、2 每 100g —— 手算的,不是问代码要的)。
  */
  const T_DAY = '2026-09-10'
  const T_BLANK = '2026-09-11'
  const tEntry = (date, slot, items) => ({
    id: `t-${date}-${slot}`,
    date,
    slot,
    time: '12:00',
    source: '手动记录',
    items,
    createdAt: 1,
  })
  const tRice = [{ foodId: 'rice', name: '米饭(熟)', grams: 150 }]

  const recorded = derive.dayStats([tEntry(T_DAY, '午餐', tRice)], T_DAY, state().profile)
  const blank = derive.dayStats([], T_BLANK, state().profile)
  /* 记了一餐,但那一餐的 items 是空的 —— 算出来全 0,而它**是**一条记录 */
  const zeroDay = derive.dayStats([tEntry(T_BLANK, '午餐', [])], T_BLANK, state().profile)

  check(
    '(锚点) 夹具:一天有记录、一天没有、一天记了但算出来是 0',
    recorded.mealCount === 1 && blank.mealCount === 0 && zeroDay.mealCount === 1,
    `mealCount ${recorded.mealCount} / ${blank.mealCount} / ${zeroDay.mealCount}`
  )

  /* ---------- ① 「哪几天算数」只由 daySeries 说 ---------- */

  const tSeries = daySeries([recorded, blank, zeroDay], (d) => d.nutrition.kcal)
  check(
    '有记录的那天有一个数(米饭 150g = 174 kcal)',
    tSeries[0].value === 174,
    `${tSeries[0].value} kcal`
  )
  check(
    '**没有记录的那一天是 null,不是 0**(少记一天和「那天没吃东西」是两件事)',
    tSeries[1].value === null,
    `value = ${JSON.stringify(tSeries[1].value)}`
  )
  check(
    '而「记了、算出来是 0」是一个**真的 0**(判据是 mealCount,不是 nutrition.kcal === 0)',
    tSeries[2].value === 0,
    `value = ${JSON.stringify(tSeries[2].value)}`
  )
  check(
    '有记录的天数只数非 null 的那几个',
    recordedCount(tSeries) === 2,
    `${recordedCount(tSeries)} / 3`
  )

  /* ---------- ② 上限线的边界:严格大于 ---------- */

  const tAt = [
    { date: 'a', value: 2000 },
    { date: 'b', value: 2001 },
    { date: 'c', value: null },
  ]
  check(
    '**正好卡在上限的那一天不算超**(`>` 不是 `>=`)',
    overCount(tAt, 2000) === 1,
    `2000 / 2001 / 没记录 → ${overCount(tAt, 2000)} 天超`
  )
  /*
    ⚠️ 这一条和 `TrendCharts.tsx` 里给柱子上色的那句 `p.value > limit` 必须是
    **同一个判据**。两边差一点点,屏幕上就会出现「这根柱子是绿的、而下面那句
    说它超了」—— 两个数各自看都自洽,没人会去比对。
    着色那一半在 `verify-render` 里验(要在渲染产物上数颜色)。
  */

  /* ---------- ③ 标尺:上限线必须落在图里 ---------- */

  /*
    手算:上界 = max(峰值 1000, 上限 2000) × 1.1 = 2200
          上限线画在 2000 / 2200 = 90.909…% → 一位小数 90.9
  */
  const tBelow = [{ date: 'a', value: 1000 }, { date: 'b', value: null }]
  check(
    '**一天都没超过上限时,上限线仍然在图里**(这正是这个 App 想看到的人)',
    pctOf(2000, barScale(tBelow, 2000)) === 90.9,
    `画在 ${pctOf(2000, barScale(tBelow, 2000))}%`
  )
  check(
    '一天都没记时标尺仍然 > 0(不是 0 —— 那正是除出 Infinity 的地方)',
    barScale([], 2000) > 0 && pctOf(2000, barScale([], 2000)) === 90.9,
    `空数据的上界 ${barScale([], 2000)}`
  )
  check(
    '峰值超过上限时标尺跟着峰值走',
    barScale([{ date: 'a', value: 4000 }], 2000) > 4000,
    `4000 → ${barScale([{ date: 'a', value: 4000 }], 2000)}`
  )
  check(
    '`pctOf` 把超出标尺的一律夹到 100(不画到框外面去)',
    pctOf(9999, 100) === 100 && pctOf(-5, 100) === 0 && pctOf(1, 0) === 0,
    `${pctOf(9999, 100)} / ${pctOf(-5, 100)} / ${pctOf(1, 0)}`
  )

  /* ---------- ④ 折线:空档处断开,而且下标不重来 ---------- */

  const tGap = [
    { date: 'a', value: 90 },
    { date: 'b', value: 80 },
    { date: 'c', value: null },
    { date: 'd', value: 70 },
    { date: 'e', value: 60 },
  ]
  const tSegs = segmentsOf(tGap)
  check(
    '**空档把折线切成两段**(连成一条会画出一根穿过空白日的斜线,那是在编数)',
    tSegs.length === 2,
    tSegs.map((s) => s.map((p) => p.value).join('-')).join(' | ') || '(一段都没有)'
  )
  check(
    '**第二段的下标是它原来的位置**(第 4 天就得落在 4/7 处,不是从 0 重来)',
    tSegs[1]?.[0]?.index === 3,
    `第二段第一个点的下标 = ${tSegs[1]?.[0]?.index}`
  )
  check(
    '一天都没记 → 一段都没有(不是一段空的)',
    segmentsOf([{ date: 'a', value: null }]).length === 0
  )

  /* ---------- ⑤ 平均分:空白天不进平均 ---------- */

  /*
    ⚠️ 这一节的夹具**不能**用上面那个 `recorded`(米饭 150g)。它和空白天算出来
    的分数**一模一样** —— 两边都是「热量摄入偏低」那一档扣 24 分,别的项也一样。
    分数一样的话,「滤掉空白天」和「没滤掉」算出同一个平均数,**断言恒真**。
    所以这里换一个**明确超钠**的日子:钠那一项权重最高,超了必然差出分来。
    (小笼包 420mg 钠 / 100g,1000g = 2300 kcal、4200mg —— 刻意夸张的夹具。)
  */
  const tHeavy = derive.dayStats(
    [tEntry(T_DAY, '午餐', [{ foodId: 'xiaolongbao', name: '小笼包', grams: 1000 }])],
    T_DAY,
    state().profile
  )
  const tScorePts = daySeries([tHeavy, blank], (d) => d.score.score)
  const tScore = scoreSummary(tScorePts)
  check(
    '**空白天不进平均分**(它算出来的分很低 —— 热量按「摄入偏低」扣,会把平均拉下去)',
    tScore !== null && tScore.count === 1 && Math.abs(tScore.avg - tHeavy.score.score) < 1e-9,
    `count ${tScore?.count} / avg ${tScore?.avg}`
  )
  /*
    上面那条只有在**两天的分数真的不一样**时才测得出来 —— 一样的话,「滤掉」
    和「没滤掉」算出来是同一个数,断言恒真。这是给它的非空锚点。
  */
  check(
    '(非空锚点) 而那两天的分数确实不一样,上一条才不是恒真的',
    tHeavy.score.score !== blank.score.score,
    `超钠那天 ${tHeavy.score.score} / 空白那天 ${blank.score.score}`
  )
  check(
    '一天都没记 → null(不是「平均 0 分」这种读起来像结论的错话)',
    scoreSummary(daySeries([blank], (d) => d.score.score)) === null
  )

  /* ---------- ⑥ 餐次占比:四段,加餐是三档的合计 ---------- */

  /*
    手算(每 100g):米饭 116 kcal / 白粥 46 —— 100g + 200g + 50g + 50g = 464
    早餐 100g = 116 → 116/464 = 25%;午餐 200g = 232 → 50%;加餐 50+50 = 116 → 25%
  */
  const tShareDay = derive.dayStats(
    [
      tEntry(T_DAY, '早餐', [{ foodId: 'rice', name: '米饭(熟)', grams: 100 }]),
      tEntry(T_DAY, '午餐', [{ foodId: 'rice', name: '米饭(熟)', grams: 200 }]),
      tEntry(T_DAY, '上午加餐', [{ foodId: 'rice', name: '米饭(熟)', grams: 50 }]),
      tEntry(T_DAY, '夜宵', [{ foodId: 'rice', name: '米饭(熟)', grams: 50 }]),
    ],
    T_DAY,
    state().profile
  )
  const tRows = slotShare([tShareDay])
  check(
    '(锚点) 夹具:四段里的三段有热量,晚餐一条都没记',
    tShareDay.entries.length === 4 && tRows.length === 4,
    `${tShareDay.entries.length} 条记录 → ${tRows.length} 段`
  )
  check(
    '四段的顺序和名字固定(早餐/午餐/晚餐/加餐)',
    JSON.stringify(tRows.map((r) => r.label)) === JSON.stringify(['早餐', '午餐', '晚餐', '加餐']),
    tRows.map((r) => r.label).join(' / ')
  )
  check(
    '**「加餐」是三档加餐的合计**(两笔 50g 都进同一段)',
    tRows[3].kcal === 116,
    `加餐 ${tRows[3].kcal} kcal`
  )
  check(
    '每一段的比例就是它那一份除以四段之和',
    Math.round(tRows[0].share * 100) === 25 &&
      Math.round(tRows[1].share * 100) === 50 &&
      Math.round(tRows[2].share * 100) === 0 &&
      Math.round(tRows[3].share * 100) === 25,
    tRows.map((r) => `${r.label} ${Math.round(r.share * 100)}%`).join(' / ')
  )
  /*
    分母是**有记录那些天的四段之和**,不是「天数 × 平均」。一天都没记时给 0,
    不给 NaN —— NaN 会一路画成 `width: NaN%`,浏览器把它当无效值丢掉,
    于是那条堆叠条看起来只是「空的」,而图例上写着「加餐 NaN%」。
  */
  const tEmptyRows = slotShare([blank])
  check(
    '一天都没记 → 四段各 0%(不是 NaN)',
    tEmptyRows.every((r) => r.share === 0 && r.kcal === 0),
    tEmptyRows.map((r) => `${r.label} ${r.share}`).join(' / ')
  )
}

/* ============================================================
   16. 进食多少
   ------------------------------------------------------------
   结果页「进食顺序」下面那张卡后面站着的规则。纯逻辑,不碰 DOM。

   这一节的中心是**用户那句话**:「用通俗语言来说,不要说多少 g 这种用户无法
   准确衡量的内容」。所以有一条结构性的断言 —— 那张表里**一个阿拉伯数字都
   不许有** —— 它比逐条抄一遍更管用:抄一遍只能钉住今天这 58 行,而这条钉住
   的是「以后也不许有人塞进一个 150g」。

   ⚠️ 期望值全部是**手写的字面量**,别改成从 `GUIDELINE_BY_ID` 里读出来再断它
   (恒真式,永远红不了)。
   ============================================================ */
{
  console.log('\n=== 16. 进食多少 ===')

  const { deriveEatingAmount } = await load('/src/store/eatingAmount.ts')
  const { GUIDELINE_BY_ID, tierTag } = await load('/src/data/guideline.ts')

  const eDish = (foodId, name, grams = 100) => ({ foodId, name, grams })
  const noRestrictions = { ...state().profile, restrictions: [] }

  /*
    夹具就是上面第 10 节那份**九类各一道**的盘子 —— 复用它是刻意的:两张卡
    列的是同一盘菜,而这一节最要紧的一条断言正是「两张卡的次序逐行相同」。
    两份夹具会让那条断言两边都变松。
  */
  const eAmount = deriveEatingAmount(fullPlate, noRestrictions)

  check('  (锚点)九道菜排出了九行', eAmount.length === 9, `${eAmount.length} 行`)
  check(
    '**菜品卡上的每一道菜都在这张卡上,一道都不许少**',
    fullPlate.every((i) => eAmount.some((s) => s.name === i.name)),
    fullPlate
      .filter((i) => !eAmount.some((s) => s.name === i.name))
      .map((i) => i.name)
      .join(' / ') || '一道不缺',
  )

  /* ---------- ① 两张卡逐行对齐(序号才不会是两个意思) ---------- */
  /*
    「进食顺序」那张卡和这张卡在页面上**上下挨着**,而且列的是同一盘菜。各自
    排序的后果不是排版难看:同一道菜会在两张卡上拿到**两个不同的序号**,而两个
    都不是错的 —— 屏幕上同时出现「米饭 ③」和「米饭 ①」。
  */
  check(
    '**两张卡的行序逐行相同**(同一道菜在两张卡上是同一个序号)',
    eAmount.map((s) => s.name).join(' → ') === fullSteps.map((s) => s.name).join(' → '),
    eAmount.map((s) => s.name).join(' → '),
  )

  /* ---------- ② 九行逐行钉死:档位 / 胶囊 / 量 ---------- */
  /*
    手写的规格表 —— **期望值不是从表里读出来的**。这份夹具九类各一道,正好把
    三档全覆盖(多 4 行、适量 4 行、少 1 行),而且**蛋奶豆那一行是「喝」**
    (汤和可乐是那两类里唯一的「喝」)。
  */
  const AMOUNT_SPEC = [
    //  菜名          胶囊        档         量
    ['紫菜蛋花汤', '适量喝', 'moderate', '一小碗'],
    ['苹果', '多吃', 'recommend', '一个，约一拳'],
    ['清炒油麦菜', '多吃', 'recommend', '双手一捧，可以多吃'],
    ['红烧排骨', '适量吃', 'moderate', '一个掌心'],
    ['清蒸鱼', '多吃', 'recommend', '一个掌心'],
    ['煮鸡蛋', '适量吃', 'moderate', '一个，一天一个就够'],
    ['米饭', '适量吃', 'moderate', '一小碗，约一拳'],
    ['含糖可乐', '少喝', 'limit', '不喝或少喝'],
    ['薯片', '少吃', 'limit', '能不吃就不吃'],
  ]
  const specOk = AMOUNT_SPEC.every(([name, tag, tone, amountText], i) => {
    const s = eAmount[i]
    return s && s.name === name && s.tag === tag && s.tone === tone && s.amount === amountText
  })
  check(
    '**九行逐行:菜名 / 胶囊 / 档 / 量**',
    specOk,
    eAmount.map((s) => `${s.name}=${s.tag}`).join(' ') || '(空)',
  )
  check(
    '(锚点) 那份规格表确实有九行、且和三档一一对上',
    AMOUNT_SPEC.length === 9 && new Set(AMOUNT_SPEC.map((r) => r[2])).size === 3,
    AMOUNT_SPEC.map((r) => r[2]).join(' '),
  )

  /* ---------- ③ 量词里一个阿拉伯数字都没有 ---------- */
  /*
    用户的原话:「不要说多少 g 这种用户无法准确衡量的内容」。这条断的就是它,
    而且是**扫整张表**,不是扫这一盘 —— 新加一条带克数的,这里就红。
  */
  const withDigits = Object.entries(GUIDELINE_BY_ID).filter(([, v]) => /\d/.test(v.amount))
  check(
    '**那张表里一个阿拉伯数字都没有**(用户要的「不说多少 g」)',
    withDigits.length === 0,
    withDigits.map(([id, v]) => `${id}=${v.amount}`).join(' / ') || '一条都没有',
  )
  check(
    '(锚点) 这条扫得动 —— 表非空,而且上面那条不是「表是空的」换来的',
    Object.keys(GUIDELINE_BY_ID).length === FOODS.length,
    `${Object.keys(GUIDELINE_BY_ID).length} 条`,
  )

  /* ---------- ④ 覆盖:库里每一条都有档,而且没有多余的键 ---------- */
  /*
    键是 `Food.id`(`string`,不是联合类型),所以「漏了一条」类型系统管不了。
    漏掉的后果**没有任何症状**:那道菜从卡上消失,看起来和「它没依据」一模一样。

    「没有多余的键」那一半盯的是**拼错 id**:`braised-rib`(少个 s)不会报错,
    只会让红烧排骨整行不见。
  */
  const missing = FOODS.filter((f) => !GUIDELINE_BY_ID[f.id]).map((f) => f.id)
  const extra = Object.keys(GUIDELINE_BY_ID).filter((id) => !FOOD_BY_ID.has(id))
  check('**食物库里每一条都有档**', missing.length === 0, missing.join(' / ') || '一条不缺')
  check('**表里没有食物库之外的键**(拼错 id 会静默少一行)', extra.length === 0, extra.join(' / ') || '没有多余的')

  /* ---------- ⑤ 动词跟食物走,不跟分类走 ---------- */
  /*
    蛋奶豆这一类里**同时有「喝」和「吃」**(牛奶 vs 豆腐),所以动词只能逐条给。
    要是哪天有人改成按分类推,牛奶那一行会印出「多吃牛奶」。
  */
  check(
    '**同属蛋奶豆,牛奶是「多喝」而豆腐是「多吃」**',
    tierTag(GUIDELINE_BY_ID['milk'].tier, GUIDELINE_BY_ID['milk'].verb) === '多喝' &&
      tierTag(GUIDELINE_BY_ID['tofu-firm'].tier, GUIDELINE_BY_ID['tofu-firm'].verb) === '多吃',
    `${tierTag(GUIDELINE_BY_ID['milk'].tier, GUIDELINE_BY_ID['milk'].verb)} / ${tierTag(GUIDELINE_BY_ID['tofu-firm'].tier, GUIDELINE_BY_ID['tofu-firm'].verb)}`,
  )

  /* ---------- ⑥ 入场判据:一道菜也出卡(和顺序卡**不一样**) ---------- */
  /*
    顺序那张卡的规矩是「档数 ≥ 2」—— 一道菜没有先后可言,排出来的
    「① 米饭」不是建议、是噪音。这张卡反过来:**一道菜也有「多少」可言**,
    而「我就盛了一碗面」正是最该问这一句的时候。

    这条并排断两件事,是为了让「统一它们」这个念头**当场变红**。
  */
  const oneDish = [eDish('rice', '米饭', 150)]
  check(
    '**一道菜也出卡(顺序卡那道菜不出)**',
    deriveEatingAmount(oneDish, noRestrictions).length === 1 && deriveEatingOrder(oneDish).length === 0,
    `多少 ${deriveEatingAmount(oneDish, noRestrictions).length} 行 / 顺序 ${deriveEatingOrder(oneDish).length} 步`,
  )
  /*
    ⚠️ 标签里那个「(这张卡)」不是修饰:`verify-loop` 里**另有一条同名的断言**
    (顺序卡那一节),两条都印「空数组进、空数组出,不抛」。弄坏时按标签找行的
    工具会拿到靠前那一条,于是这次弄坏看起来是绿的 —— 实测踩过。
  */
  check('空数组进、空数组出,不抛(这张卡)', deriveEatingAmount([], noRestrictions).length === 0)

  /* ---------- ⑦ 库外菜 / 哨兵项 ---------- */
  /*
    这两种菜查不到分类,也就查不到档 —— **不进这张卡,但也不撤掉整张卡**。
    判据和 `eatingOrder` 同源(那张卡断的是肯定:列表里没有它,不等于说了它
    什么),而 `advice.ts` 的蔬菜判断断的是否定,分类未知时必须整条不说。
    两处的处理**正好相反**,别来「统一」。
  */
  const withWeb = [
    eDish('rice', '米饭', 150),
    eDish('web:qingchao-shanshi', '清炒时蔬', 200),
    eDish('unmatched:清炒藕片', '清炒藕片', 0),
  ]
  const webRows = deriveEatingAmount(withWeb, noRestrictions)
  check(
    '**库外菜和哨兵项不进这张卡,但也不撤掉整张卡**',
    webRows.length === 1 && webRows[0].name === '米饭',
    webRows.map((s) => s.name).join(' / ') || '(空)',
  )

  /* ---------- ⑧ 撞上档案忌口 → 那一行改成「别吃」 ---------- */
  /*
    用户明确要的**唯一一处刻意重复**:`advice.ts` 已经为一餐弹一张红色冲突卡,
    而这张卡是逐道菜的清单 —— 撞上那一道旁边直接标「别吃」,扫一眼就知道哪盘
    不用碰。他选的是「算进去」,所以这不是疏忽。

    ⚠️ 判据走 `restrictionHit()`,`advice.ts` 走的是同一个函数。下面最后一条
    是**源码级**断言:它盯的是「两处问的是同一个问题」,不是行为 —— 行为那条
    在这里断不了(两处各写一遍子串匹配,今天的结果也一样)。
  */
  const tabooProfile = {
    ...state().profile,
    restrictions: [{ item: '花生', type: 'allergy', level: '高危' }],
  }
  /*
    源码级断言要的那份文本。`adviceSrc` 在这里现读 —— 上面 `load()` 拿到的是
    模块导出的东西,看不到「那一行是不是还写着子串匹配」。
  */
  const adviceSrc = await readFile('src/store/advice.ts', 'utf8')
  const tabooPlate = [eDish('rice', '米饭', 150), eDish('peanut', '炒花生', 30)]
  const tabooRows = deriveEatingAmount(tabooPlate, tabooProfile)
  check(
    '**撞上忌口那一行改成「别吃」,写的是哪一条**',
    tabooRows[1]?.tag === '别吃' &&
      tabooRows[1]?.tone === 'blocked' &&
      /花生过敏/.test(tabooRows[1]?.amount ?? ''),
    `${tabooRows[1]?.tag} / ${tabooRows[1]?.amount}`,
  )
  check(
    '**没撞上的那几行不受影响**(米饭还是「适量吃」)',
    tabooRows[0]?.tag === '适量吃' && tabooRows[0]?.amount === '一小碗，约一拳',
    `${tabooRows[0]?.tag} / ${tabooRows[0]?.amount}`,
  )
  check(
    '(锚点) 没有忌口时同一盘菜不标「别吃」—— 否则上面两条是恒真的',
    deriveEatingAmount(tabooPlate, noRestrictions)[1]?.tag === '适量吃',
    deriveEatingAmount(tabooPlate, noRestrictions)[1]?.tag,
  )
  check(
    '**「怎么算碰上」只有一处判据**(advice.ts 走的是同一个 restrictionHit)',
    /restrictionHit\(r, items\)/.test(adviceSrc) && !/i\.name\.includes\(keyword\)/.test(adviceSrc),
    'advice.ts 里那一行子串匹配已经搬去 types.ts',
  )

  /* ---------- ⑨ 菜名用条目自己的名字 ---------- */
  /*
    模型认出来的菜名**未必等于库里的标准名**,而屏幕上显示的必须是前者 ——
    和 `eatingOrder.ts` 那条是同一条规矩(它顺带证明了查表用的是 `foodId`,
    不是名字)。
  */
  const oddName = deriveEatingAmount([eDish('rice', '一碗白饭', 150)], noRestrictions)
  check(
    '屏幕上印的是条目里的名字,不是食物库里的名字',
    oddName[0]?.name === '一碗白饭' && oddName[0]?.amount === '一小碗，约一拳',
    `${oddName[0]?.name} / ${oddName[0]?.amount}`,
  )
}

/* ============================================================
   17. 怎么吃 —— 顺序 / 份量 / 建议并成同一张卡
   ------------------------------------------------------------
   `eatingPlan.ts` 是**只负责摆放**的第三个模块:行的来源是 `deriveEatingAmount`、
   顺序说明来自 `deriveEatingOrder`、建议来自 `deriveAdvice`。它一分规则都不新造。

   所以这一节的中心是**两条摆放的不变量**:

     · **行数 = 那一盘的道数** —— 库内菜不筛、不重排、也不改写任何一个字段,
       库外菜(联网估算 / 哨兵项)由 `eatingPlan.ts` 补成**没有档**的那种行;
     · **建议不重不漏** —— 每条建议恰好落进「某一行」或者「卡尾」之一。

   ⚠️ 第二条的措辞改过:原来这里写的是「指名了库外菜的那些**整条下沉到卡尾**」,
   那是补行**之前**的事实。现在每道菜都有一行,而 `advice.ts` 的 `at` 一律取自
   `items` ⇒ 指了名的建议**一条都不该下沉**。`tail.push` 那一支照旧留着(它本来
   就是整餐级建议要走的那一步),但今天走不到 —— 守住它的是「不重不漏」那条。

   第二条是最容易静默失败的地方:`rows` 和 `tail` 各自看都自洽,一条建议凭空
   消失不会有任何症状。所以「不重不漏」是对着 `deriveAdvice` **数条数**断的。

   ⚠️ 期望值全是**手写的字面量**(「紫菜蛋花汤」「再吃蛋白质」),不是从模块里
   读出来再断它 —— 那样是恒真式。菜名是照着食物库的 `per100g` 手算出来的:
   演示餐盘里钠最高的是紫菜蛋花汤(520mg/100g × 250g = 1300mg),高于红烧排骨
   (480 × 150 = 720)和清炒油麦菜(320 × 200 = 640)。
   ============================================================ */
{
  console.log('\n=== 17. 怎么吃 ===')

  const { deriveEatingPlan } = await load('/src/store/eatingPlan.ts')
  const { deriveEatingAmount } = await load('/src/store/eatingAmount.ts')
  const { deriveEatingOrder } = await load('/src/store/eatingOrder.ts')

  /* 演示档案**去掉忌口** —— 下面几盘菜里没有花生/香菜,但去掉能少一层耦合 */
  const noRes = { ...DEFAULT_PROFILE, restrictions: [] }
  const d = (foodId, name, grams = 100) => ({ foodId, name, grams })

  const plan = deriveEatingPlan(fullPlate, noRes)
  const amount = deriveEatingAmount(fullPlate, noRes)

  /* ---------- ① 行就是那一盘菜 ---------- */
  check('  (锚点)九道菜排出了九行', plan.rows.length === 9, `${plan.rows.length} 行`)
  /*
    这一条钉的是「新模块一个字段都不改写、一行都不筛」—— 它拿**独立调一次**
    `deriveEatingAmount` 的结果逐项比。将来有人在 `deriveEatingPlan` 里加个
    `.filter((r) => r.attached.length > 0)` 或者 `.sort()`,这里就红。

    ⚠️ 比的是**前 `amount.length` 行** —— 库内菜那一支必须逐字等于那一步的输出。
    演示餐盘九道菜全在库里,所以这份盘上就是整份对整份;库外菜那一半在 ⑥ 里。
  */
  check(
    '**行就是那一盘菜**:库内菜那几行逐项等于「进食多少」那一步',
    plan.rows.length >= amount.length &&
      amount.every(
        (s, i) =>
          plan.rows[i].name === s.name &&
          plan.rows[i].stance.kind === 'guideline' &&
          plan.rows[i].stance.tag === s.tag &&
          plan.rows[i].stance.tone === s.tone &&
          plan.rows[i].stance.amount === s.amount,
      ),
    plan.rows
      .map((r) => `${r.name}[${r.stance.kind === 'guideline' ? r.stance.tag : r.stance.kind}]`)
      .join(' → '),
  )

  /* ---------- ② 顺序说明:照指南原文,不按位置算 ---------- */
  const noteOf = (p, name) => p.rows.find((r) => r.name === name)?.note
  check(
    '**一行同时有顺序和份量**(红烧排骨那一行的说明是「再吃蛋白质」)',
    noteOf(plan, '红烧排骨') === '再吃蛋白质',
    String(noteOf(plan, '红烧排骨')),
  )
  check(
    '主食恒「最后吃」、饮品恒「随餐」(照指南原文,不是按位置算出来的)',
    noteOf(plan, '米饭') === '最后吃主食' && noteOf(plan, '含糖可乐') === '随餐',
    `${String(noteOf(plan, '米饭'))} / ${String(noteOf(plan, '含糖可乐'))}`,
  )
  /*
    「再吃」还是「先吃」取决于**有没有蔬菜那一档** —— 一盘排骨 + 米饭里,
    蛋白质就是第一个进嘴的,再说「再吃」等于凭空多出一个「先」。
  */
  const twoPlate = [d('braised-ribs', '红烧排骨', 150), d('rice', '米饭', 150)]
  const twoPlan = deriveEatingPlan(twoPlate, noRes)
  check(
    '**没有蔬菜那一档时,蛋白质说「先吃」不说「再吃」**',
    noteOf(twoPlan, '红烧排骨') === '先吃蛋白质',
    String(noteOf(twoPlan, '红烧排骨')),
  )

  /* ---------- ③ 排不出顺序的那一盘:行还在,说明缺席 ---------- */
  const onePlate = [d('rice', '米饭', 150), d('mantou', '馒头', 100)]
  const onePlan = deriveEatingPlan(onePlate, noRes)
  check(
    '  (锚点)单档那盘确实排不出顺序(否则下面那条是拿空数组换来的)',
    deriveEatingOrder(onePlate).length === 0,
    `${deriveEatingOrder(onePlate).length} 步`,
  )
  /*
    ⚠️ 这一盘在 `eatingOrder.ts` 的文件头里被点过名(「① 米饭 ② 馒头不是建议、
    是噪音」)。合并之后这两行**会出现** —— 那句话说的是「它们没有**顺序**」,
    而这张卡每一行的主语是「**吃多少**」。所以判据要的是「两行都在、说明都缺席」,
    不是「整张卡不出现」。
  */
  check(
    '**单档那盘两行都在,而顺序说明一行都没有**(不是给它兜一句「随餐」)',
    onePlan.rows.length === 2 && onePlan.rows.every((r) => r.note === undefined),
    `${onePlan.rows.length} 行 / ${onePlan.rows.map((r) => String(r.note)).join(' · ')}`,
  )

  /* ---------- ③b 同名两道菜:说明词**查表**,建议**首匹配** ---------- */
  /*
    菜名是自由文本(`MealItem` 没有 `id`),一盘里出现两条同名菜是真会发生的 ——
    用户手动记两条「米饭」就是一例。两处按名字对齐的**口径故意不同**,理由写在
    `eatingPlan.ts` 文件头那段「别把第一处也改成首匹配」上;这两条断言就是那段
    话的看门人:改错了在别处**一点症状都没有**(两行都还在,只是有一行悄悄失去了
    说明词,看起来像「这一道没有顺序可说」)。
  */
  const twinPlan = deriveEatingPlan(
    [d('lettuce-stir', '清炒油麦菜', 200), d('rice', '米饭', 150), d('rice', '米饭', 80)],
    noRes,
  )
  check(
    '**两道同名菜两行都在,而且都拿得到说明词**(查表:它是同一道菜)',
    twinPlan.rows.length === 3 &&
      twinPlan.rows.filter((r) => r.name === '米饭').every((r) => r.note === '最后吃主食'),
    twinPlan.rows.map((r) => `${r.name}:${String(r.note)}`).join(' / '),
  )
  /*
    同名**不同类**那一支 —— `noteByName` 上那个 `has` 守卫真正挡的就是它:
    两条都叫「豆腐」,一条是蔬菜(`mapo-tofu`,麻婆豆腐)、一条是蛋奶豆
    (`tofu-firm`,北豆腐),两条 step 的说明词**不一样**。留住**靠前那条**
    (判据是屏幕上从上到下读到的第一句),不是被后一条覆盖。

    ⚠️ 这一条的夹具必须**同类不同名会走岔**:上一盘两条「米饭」同属主食,
    说明词本来就相同 —— 拿它验「查表」是验不出来的(首匹配和后匹配同值)。
  */
  const twinKind = deriveEatingPlan([d('mapo-tofu', '豆腐', 150), d('tofu-firm', '豆腐', 150)], noRes)
  check(
    '**同名不同类时两行都用靠前那条的说明词**(不是被后一条覆盖)',
    twinKind.rows.length === 2 && twinKind.rows.every((r) => r.note === '先吃蔬菜'),
    twinKind.rows.map((r) => `${r.name}:${String(r.note)}`).join(' / '),
  )
  /*
    而**建议**只能挂一处,所以那边是首匹配 —— 挂到靠上那一道。这一条必须断
    「挂在第 0 行」而不是「有一行挂上了」:后者对「挂到最后一行」同样成立。
  */
  const twinPeanut = deriveEatingPlan([d('peanut', '炒花生', 30), d('peanut', '炒花生', 30)], DEFAULT_PROFILE)
  check(
    '**同名两道菜时建议只挂靠上那一道**(不是两行都挂,也不是挂到最后一行)',
    twinPeanut.rows.length === 2 &&
      twinPeanut.rows[0].attached.length === 1 &&
      twinPeanut.rows[1].attached.length === 0,
    twinPeanut.rows.map((r, i) => `第${i + 1}行挂 ${r.attached.length} 条`).join(' / '),
  )

  /* ---------- ④ 挂靠:指名了哪道菜就挂到哪一行 ---------- */
  const rowOfAdvice = (p, needle) => p.rows.find((r) => r.attached.some((a) => a.title.includes(needle)))?.name
  check(
    '**钠那条不挂行,落卡尾**(演示餐盘:紫菜蛋花汤 1300mg)',
    rowOfAdvice(plan, '钠') === undefined && plan.tail.some((a) => a.title.includes('钠')),
    `挂到=${String(rowOfAdvice(plan, '钠'))} 卡尾有=${plan.tail.some((a) => a.title.includes('钠'))}`,
  )
  check(
    '**糖那条不挂行,落卡尾**(演示餐盘:含糖可乐 35.6g)',
    rowOfAdvice(plan, '添加糖') === undefined && plan.tail.some((a) => a.title.includes('添加糖')),
    `挂到=${String(rowOfAdvice(plan, '添加糖'))} 卡尾有=${plan.tail.some((a) => a.title.includes('添加糖'))}`,
  )
  /*
    ⚠️ 判据换过一次(2026-09-23)。原来这里断的是「**同一行上可以挂两条**」——
    用的是排骨 + 米饭那一盘上钠和糖都指名了红烧排骨。那两条现在都不挂行了,
    所以这一盘上那一行挂 0 条。`attached` 那个数组本身留着(忌口那条还要用它),
    但**它现在只有一个生产者**,「两条并排」已经断不出来,不该硬凑一个夹具去演它。

    改成断这条盘的**新事实**:钠糖两条都进了卡尾,而卡尾和挂行**不重不漏**
    (下面还有一条专门断这个不变量)。
  */
  const ribRow = twoPlan.rows.find((r) => r.name === '红烧排骨')
  check(
    '**钠糖两条都落卡尾之后,那一行不再挂任何建议**',
    (ribRow?.attached.length ?? -1) === 0 &&
      twoPlan.tail.filter((a) => /钠|添加糖/.test(a.title)).length === 2,
    `那一行挂 ${ribRow?.attached.length ?? '?'} 条 / 卡尾 ${twoPlan.tail.length} 条`,
  )
  /* 忌口那条同理 —— 它指名的是**撞上忌口的那一道**,不是第一道 */
  const tabooPlan = deriveEatingPlan([d('rice', '米饭', 150), d('peanut', '炒花生', 30)], DEFAULT_PROFILE)
  check(
    '**忌口那条挂在撞上的那一行上**(不是挂在第一行上)',
    tabooPlan.rows.find((r) => r.attached.length > 0)?.name === '炒花生',
    tabooPlan.rows.map((r) => `${r.name}${r.attached.length ? '←挂' : ''}`).join(' / '),
  )

  /* ---------- ⑤ 整餐级的留在卡尾 ---------- */
  check(
    '**整餐级的两条留在卡尾**(「这一餐没有蔬菜或水果」/「蛋白质 …」)',
    twoPlan.tail.some((a) => a.title.includes('蔬菜')) && twoPlan.tail.some((a) => a.title.includes('蛋白质')),
    twoPlan.tail.map((a) => a.title.slice(0, 8)).join(' / '),
  )
  check(
    '**挂上行的那几条一个都不是整餐级的**(它们全都指了名)',
    twoPlan.rows.flatMap((r) => r.attached).every((a) => a.at !== undefined),
    twoPlan.rows.flatMap((r) => r.attached).map((a) => String(a.at)).join(' / '),
  )

  /* ---------- ⑥ 库外菜也有自己的行 ---------- */
  /*
    用户报的就是这一条:「图片识别出来的是5道菜,结果在怎么吃界面只分析了4道菜」,
    而被他抓出来的那道是**联网估算的**。根因是 `deriveEatingAmount` 按
    `GUIDELINE_BY_ID` 查表、查不到就 `continue` —— 库外菜一道都不在行上。

    `eatingPlan.ts` 现在把它们补成**没有档**的那种行。下面钉住这件事的四个面:
    行在不在、`stance` 是两种库外菜里的哪一支、建议挂到哪儿、行数对不对。

    ⚠️ 补行那一支的**弄坏点对它自己那几盘才有效**:演示餐盘九道菜全在库里,
    在它上面把补行关掉是一次**空操作**(照旧绿)。所以行数那条断言必须把
    库外菜那几盘一起数进去 —— 见下面那个循环。
  */
  const webDish = {
    foodId: 'web:qingjiao-rousi',
    name: '清炒肉丝',
    grams: 200,
    per100g: { kcal: 200, protein: 15, carb: 5, fat: 12, sodium: 900, sugar: 1, fiber: 1, water: 60 },
  }
  /** 库里没有、也没联网查到 —— 营养按 0 计的哨兵项 */
  const sentinelDish = { foodId: 'unmatched:清炒藕片', name: '清炒藕片', grams: 0 }
  const riceDish = d('rice', '米饭', 150)

  const webPlan = deriveEatingPlan([webDish, riceDish], noRes)
  check(
    '**联网估算的菜有自己的行,而且 `stance` 是 `web`**',
    webPlan.rows.length === 2 &&
      webPlan.rows[0].name === '米饭' &&
      webPlan.rows[0].stance.kind === 'guideline' &&
      webPlan.rows[1].name === '清炒肉丝' &&
      webPlan.rows[1].stance.kind === 'web',
    webPlan.rows.map((r) => `${r.name}(${r.stance.kind})`).join(' / '),
  )
  const sentinelPlan = deriveEatingPlan([sentinelDish, riceDish], noRes)
  /*
    ⚠️ 判据必须是 `'unknown'` 而**不是**「有行就行」:两种库外菜在屏上的第二行
    是两句不同的话(「联网估算 · …」/「不在食物库里 · 按 0 计」),把这一支并到
    `web` 上,屏上就会对着一条按 0 计的菜说「联网估算」。
  */
  check(
    '**哨兵项也有自己的行,而且 `stance` 是 `unknown`(不是 `web`)**',
    sentinelPlan.rows.length === 2 &&
      sentinelPlan.rows[1].name === '清炒藕片' &&
      sentinelPlan.rows[1].stance.kind === 'unknown',
    sentinelPlan.rows.map((r) => `${r.name}(${r.stance.kind})`).join(' / '),
  )
  /*
    **这一条就是用户报的那个形状在纯逻辑这边的版本**:菜品卡上有几道菜,这张卡
    就有几行。四盘一起数,其中三盘带库外菜。
  */
  {
    const plates = [
      ['演示餐盘', fullPlate],
      ['联网估算', [webDish, riceDish]],
      ['哨兵项', [sentinelDish, riceDish]],
      ['三样都有', [webDish, riceDish, sentinelDish]],
    ]
    const bad = plates
      .map(([label, items]) => [label, items, deriveEatingPlan(items, noRes).rows.length])
      .filter(([, items, n]) => n !== items.length)
      .map(([label, items, n]) => `${label}:${items.length}道→${n}行`)
    check(
      '**行数 = 菜品卡的道数**(四盘一起数,含库外菜那几盘)',
      bad.length === 0,
      bad.join(' / ') || '四盘都对得上',
    )
  }
  /*
    补行之前,钠那条指名的库外菜进不了 `rows`,于是整条被下沉到卡尾。现在它
    挂在**它自己那一行**上 —— 这正是「联网估算的菜有了行」除了行数之外的收益:
    那条建议的下文(「主要来自『清炒肉丝』」)和那道菜待在同一行里。
  */
  check(
    '**钠那条即便指名了库外菜,也照样落卡尾**(整餐级的句子不挂行)',
    webPlan.tail.some((a) => a.title.includes('钠')) &&
      webPlan.rows.every((r) => !r.attached.some((a) => a.title.includes('钠'))),
    `卡尾 ${webPlan.tail.length} 条 / ` +
      webPlan.rows.map((r, i) => `第${i + 1}行挂 ${r.attached.length} 条`).join(' '),
  )
  /*
    ⚠️ 上一条断的是**这一盘**。这一条断的是那个**不变量**本身:`advice.ts` 里每个
    `at` 都取自 `items`,而行现在每道菜都有一行 ⇒ 指了名的建议**一条都不该下沉**。
    拿五盘一起数,免得「有些盘挂得上、有些盘挂不上」在单盘断言里看不出来。
  */
  {
    const plates = [
      ['演示餐盘', fullPlate, noRes],
      ['联网估算', [webDish, riceDish], noRes],
      ['哨兵项', [sentinelDish, riceDish], noRes],
      ['三样都有', [webDish, riceDish, sentinelDish], noRes],
      ['忌口', [riceDish, d('peanut', '炒花生', 30)], DEFAULT_PROFILE],
    ]
    const bad = []
    for (const [label, items, profile] of plates) {
      const p = deriveEatingPlan(items, profile)
      const named = adviceMod.deriveAdvice(items, profile).filter((a) => a.at !== undefined).length
      const got = p.rows.flatMap((r) => r.attached).length
      if (named !== got) bad.push(`${label}:指了名 ${named} 条 → 挂上行 ${got} 条`)
    }
    check(
      '**指了名的建议一条都不下沉**(五盘一起数)',
      bad.length === 0,
      bad.join(' / ') || '五盘都挂得上',
    )
  }

  /* ---------- ⑦ 不重不漏 ---------- */
  /*
    这是这一节最重要的一条:`rows` 和 `tail` 各自看都自洽,一条建议凭空消失
    不会有任何症状。所以对着 `deriveAdvice` **数条数、对标题**。
  */
  {
    const bad = []
    for (const [label, items, profile] of [
      ['演示餐盘', fullPlate, noRes],
      ['排骨+米饭', twoPlate, noRes],
      ['单档', onePlate, noRes],
      ['库外菜', [webDish, d('rice', '米饭', 150)], noRes],
      ['忌口', [d('rice', '米饭', 150), d('peanut', '炒花生', 30)], DEFAULT_PROFILE],
    ]) {
      const p = deriveEatingPlan(items, profile)
      const want = adviceMod.deriveAdvice(items, profile).map((a) => a.title).sort()
      const got = [...p.rows.flatMap((r) => r.attached), ...p.tail].map((a) => a.title).sort()
      if (want.join('¶') !== got.join('¶')) bad.push(`${label}:${want.length}→${got.length}`)
    }
    check('**挂行的和卡尾的不重不漏** —— 两边加起来恰好是 `deriveAdvice` 那几条', bad.length === 0, bad.join(' / ') || '五盘都对得上')
  }

  /* ---------- ⑧ 一条建议都没有的那一盘 ---------- */
  /*
    卡尾那句「这一餐各项都在目标区间内,没有需要特别提醒的地方」的判据就是
    `hasAdvice`。要造出这样一盘:钠落在 20%~35% 那一档(上下两支都不触发)、
    蛋白质落在 25%~40%、糖够低、而且**有**蔬菜(否则「这一餐没有蔬菜」会响)。

    ⚠️ 配额是**按这一盘算出来的**,不是手写的数 —— 手写的数会被食物库改动静默
    作废,然后这条断言变成「拿一个不安静的盘验安静」。
  */
  const quietItems = [d('rice', '米饭', 150), d('apple', '苹果', 180)]
  const qn = derive.nutritionOfItems(quietItems)
  const quiet = {
    ...noRes,
    quota: {
      ...noRes.quota,
      sodium: Math.ceil(qn.sodium / 0.25),
      protein: Math.ceil(qn.protein / 0.3),
      sugar: 10000,
    },
  }
  const quietPlan = deriveEatingPlan(quietItems, quiet)
  check(
    '  (锚点)那一盘上 `deriveAdvice` 确实是空的(否则下面那条是空转)',
    adviceMod.deriveAdvice(quietItems, quiet).length === 0,
    `${adviceMod.deriveAdvice(quietItems, quiet).length} 条`,
  )
  check(
    '**一条建议都没有时 `hasAdvice` 为 false**,而且卡尾是空的',
    quietPlan.hasAdvice === false && quietPlan.tail.length === 0,
    `hasAdvice=${quietPlan.hasAdvice} / tail=${quietPlan.tail.length}`,
  )
  check(
    '  (锚点)而别的盘上它是 true —— 否则上一条是拿「永远是 false」换来的',
    plan.hasAdvice === true && webPlan.hasAdvice === true,
    `${plan.hasAdvice} / ${webPlan.hasAdvice}`,
  )
}

/* ============================================================
   对话页 · 每条消息的操作（`src/lib/chatOps.ts`）
   ------------------------------------------------------------
   这一节全是纯函数，因为它们原本写在点击处理里，**只能在浏览器里点出来**。
   最要紧的一条是「撤回」和「删除」的区别：它们看起来都是「去掉一条消息」，
   做错的表现是留下一条答非所问的尾巴（问句没了、答案还挂着）。
   ============================================================ */

console.log('\n=== 对话页:消息操作 ===')
{
  const ops = await load('/src/lib/chatOps.ts')

  const U = (id, content = '这餐咸吗') => ({ id, role: 'user', content })
  const A = (id, content = '回答') => ({ id, role: 'assistant', content })

  /* ---------- 撤回：从这里往后全切掉 ---------- */
  const thread = [U('u1', '第一句'), A('a1', '第一个回答'), U('u2', '第二句'), A('a2', '第二个回答')]
  const afterUndo = ops.cutFrom(thread, 'u2')
  check(
    '**撤回第二句 → 它和它之后的回答一起没掉**（只删中间一条会留下答非所问的尾巴）',
    afterUndo.length === 2 && afterUndo.map((m) => m.id).join(',') === 'u1,a1',
    afterUndo.map((m) => m.id).join(',')
  )
  check('撤回**不动**它前面的那句', afterUndo[0].id === 'u1')

  /* ---------- 删除本条：只拿掉这一条 ---------- */
  const afterDelete = ops.removeOne(thread, 'u2')
  check(
    '**删除第二句 → 只少了它自己**（前后都留着）',
    afterDelete.map((m) => m.id).join(',') === 'u1,a1,a2',
    afterDelete.map((m) => m.id).join(',')
  )
  check(
    '  (锚点)上面两条走的是**不同**的结果 —— 否则「撤回和删除不一样」是空话',
    afterUndo.length !== afterDelete.length,
    `${afterUndo.length} vs ${afterDelete.length}`
  )

  /* ---------- id 找不到时什么都不做 ---------- */
  check(
    'id 找不到时原样返回（双击同一颗按钮不该把整段对话清掉）',
    ops.cutFrom(thread, '不存在').length === 4 && ops.removeOne(thread, '不存在').length === 4
  )

  /* ---------- 「重试」重跑的是原来那句 ---------- */
  check(
    '**重试找的是**紧挨着它**往前的那句提问**，不是最早那句',
    ops.questionBefore(thread, 'a2') === '第二句',
    String(ops.questionBefore(thread, 'a2'))
  )
  check('第一条消息之前没有提问 → null（这一项就不给）', ops.questionBefore(thread, 'u1') === null)
  check(
    '往前跳过空文字的助手消息，找到的还是那句提问',
    ops.questionBefore([U('u1', '原话'), A('a1', ''), A('a2', '')], 'a2') === '原话'
  )
  check(
    '发图那条路（有图没提问）→ 空文字不算提问',
    ops.questionBefore([U('u1', ''), A('a1', '')], 'a1') === null
  )

  /* ---------- 三样按形态增减 ---------- */
  check(
    '**用户那条**：复制 + 撤回 + 删除，**没有**重试',
    ops.opsFor(U('u1'), true).join(',') === 'copy,undo,delete',
    ops.opsFor(U('u1'), true).join(',')
  )
  check(
    '**助手那条**：复制 + 重试 + 删除，**没有**撤回',
    ops.opsFor(A('a1'), true).join(',') === 'copy,retry,delete',
    ops.opsFor(A('a1'), true).join(',')
  )
  check(
    '找不到提问的助手消息 → 不给重试（一颗按下去什么都不发生的按钮）',
    ops.opsFor(A('a1'), false).join(',') === 'copy,delete',
    ops.opsFor(A('a1'), false).join(',')
  )
  check(
    '**卡片形态的消息没有文字 → 不给复制**（复制一个空串等于复制空气）',
    ops.opsFor({ role: 'assistant', content: '' }, true).join(',') === 'retry,delete',
    ops.opsFor({ role: 'assistant', content: '' }, true).join(',')
  )
  check(
    '删除**永远**在最后一项（危险项不许夹在中间）',
    [U('u1'), A('a1')].every((m) => {
      const list = ops.opsFor(m, true)
      return list[list.length - 1] === 'delete'
    })
  )
}

/* ============================================================
   对话页 · 历史记录（`src/store/chatHistory.ts`）
   ============================================================ */

console.log('\n=== 对话页:历史记录 ===')
{
  const hist = await load('/src/store/chatHistory.ts')

  const turn = (id, role, content, extra = {}) => ({ id, role, content, ...extra })
  /*
    一次会话 = 两轮问答。`at` 一个早一个晚 —— 列表是**按最近说话倒序**的，
    两份时刻一样的话那条断言就退化成「顺序等于插入顺序」。
  */
  const older = {
    id: 'c1',
    profileId: 'p-a',
    at: 1000,
    items: [turn('u1', 'user', '早餐吃什么'), turn('a1', 'assistant', '回答一'), turn('u2', 'user', '午餐呢'), turn('a2', 'assistant', '回答二')],
  }
  const newer = {
    id: 'c2',
    profileId: 'p-a',
    at: 2000,
    items: [turn('u3', 'user', '晚饭'), turn('a3', 'assistant', '回答三')],
  }
  const otherProfile = { id: 'c3', profileId: 'p-b', at: 3000, items: [turn('u4', 'user', '别人的话')] }

  /* ---------- 按档案分 ---------- */
  const mine = hist.sessionsOf([older, newer, otherProfile], 'p-a')
  check(
    '**别的档案的会话不出现在这个档案的列表里**（切到 B 不该翻出 A 问过的话）',
    mine.length === 2 && !mine.some((s) => s.profileId === 'p-b'),
    mine.map((s) => s.id).join(',')
  )
  check(
    '**列表按最近说话倒序**（不是插入顺序）',
    mine.map((s) => s.id).join(',') === 'c2,c1',
    mine.map((s) => s.id).join(',')
  )
  check('别人的那条在它自己的档案里看得到', hist.sessionsOf([older, newer, otherProfile], 'p-b').length === 1)

  /* ---------- 列表上那两句话 ---------- */
  check('「N 轮」数的是**用户说了几句**（把助手那条也算进去会翻倍）', hist.roundCount(older) === 2, String(hist.roundCount(older)))
  check('标题取**第一句用户消息**', hist.sessionTitle(older) === '早餐吃什么', hist.sessionTitle(older))
  check(
    '空会话的标题是「新对话」（一个空白行在列表里点不动也认不出）',
    hist.sessionTitle({ id: 'c9', profileId: 'p-a', at: 1, items: [] }) === '新对话'
  )
  check(
    '太长的标题会截断并带省略号',
    hist.sessionTitle({ id: 'c9', profileId: 'p-a', at: 1, items: [turn('u', 'user', '一二三四五六七八九十十一十二十三十四十五')] }) ===
      '一二三四五六七八九十十一十二…',
    hist.sessionTitle({ id: 'c9', profileId: 'p-a', at: 1, items: [turn('u', 'user', '一二三四五六七八九十十一十二十三十四十五')] })
  )

  /* ---------- 落盘：照片和小图必须被剥掉 ---------- */
  const withPics = hist.toTurn({
    id: 'u9',
    role: 'user',
    content: '这餐咸吗',
    photos: ['blob:http://localhost/1', 'blob:http://localhost/2'],
    run: { photos: 2 },
    meal: { slot: '午餐', items: [], engine: 'agent', photoUrl: 'blob:x', thumbDataUrl: 'data:image/png;base64,AAAA' },
    reply: { blocked: false, risk: { level: 'low', message: '', items: [] }, mode: 'plate', title: '', dishes: [], ingredients: [], nutrition: { ingredients: [], labels: [], riskItems: [] }, advice: [], disclaimer: '' },
  })
  check(
    '**`photos` 不落盘**（`blob:` 地址离开这个 document 就是死链接，读回来是一条空白图）',
    !('photos' in withPics),
    Object.keys(withPics).join(',')
  )
  check('**`run` 不落盘**（存下来会永远停着一个转不完的圈）', !('run' in withPics))
  check(
    '**那一餐里的两张图都不落盘**（`photoUrl` 同上是死链接；`thumbDataUrl` 是几十 KB 的 data URL，攒几次会话就把配额写满）',
    withPics.meal !== undefined && !('photoUrl' in withPics.meal) && !('thumbDataUrl' in withPics.meal),
    Object.keys(withPics.meal ?? {}).join(',')
  )
  check(
    '  (锚点)**其余字段原样留着** —— 否则上面三条可以靠「整个 meal 都不要了」通过',
    withPics.meal?.engine === 'agent' && withPics.meal?.slot === '午餐',
    JSON.stringify({ engine: withPics.meal?.engine, slot: withPics.meal?.slot })
  )
  check('结构化回复原样留着（它在卡片上占的正是那几块）', withPics.reply?.mode === 'plate')
  check(
    '**剥图片不改传进来的那个对象**（改到它 = 当前这次会话的图也消失，一个刷新前才看得见的 bug）',
    (() => {
      const meal = { slot: '午餐', items: [], engine: 'agent', photoUrl: 'blob:x' }
      hist.toTurn({ id: 'u', role: 'user', content: 'x', meal })
      return meal.photoUrl === 'blob:x'
    })()
  )

  /* ---------- 写、读、清 ---------- */
  const box = fakeStorage()
  check('写成功（存储在那儿）', hist.saveChatLog([older, newer, otherProfile], { storage: box }) === true)

  const back = hist.loadChatLog({ storage: box })
  check(
    '**读回来逐字段相等**（两份会话 + 别人的那条都在）',
    JSON.stringify(back) === JSON.stringify([older, newer, otherProfile]),
    `${back.length} 条`
  )
  check(
    '没有存储时读回空数组、写回 false（**不抛**）',
    hist.loadChatLog({ storage: null }).length === 0 && hist.saveChatLog([older], { storage: null }) === false
  )
  check(
    '盘上是一坨坏 JSON → 读回空数组（**不抛**）',
    (() => {
      const bad = fakeStorage()
      bad.setItem('mealbalance:chat:v1', '{不是 JSON')
      return hist.loadChatLog({ storage: bad }).length === 0
    })()
  )

  /* ---------- 清空：只清这个档案的 ---------- */
  const cleared = hist.clearSessionsFor([older, newer, otherProfile], 'p-a')
  check(
    '**「清空历史」只清当前档案的，别的档案不动**',
    cleared.length === 1 && cleared[0].profileId === 'p-b',
    cleared.map((s) => s.id).join(',')
  )

  /* ---------- 删一条 ---------- */
  check(
    '删掉一条会话，别的还在',
    hist.removeSession([older, newer], 'c1').map((s) => s.id).join(',') === 'c2'
  )

  /* ---------- 同 id 替换，不是插第二条 ---------- */
  const bumped = { ...older, at: 5000, items: [...older.items, turn('u5', 'user', '又一句')] }
  const merged = hist.upsertSession([older, newer], bumped)
  check(
    '**同 id 是替换不是追加**（否则每说一句列表里就多一条一样的）',
    merged.length === 2 && merged.find((s) => s.id === 'c1')?.at === 5000,
    `${merged.length} 条 / at=${merged.find((s) => s.id === 'c1')?.at}`
  )

  /* ---------- 形状不对就整份丢掉 ---------- */
  check(
    '形状不对的载荷读回空（浅校验，和 `parseUnlogged` 同一个口径）',
    hist.parseChatLog([{ id: 'c', profileId: 'p', at: 1, items: [{ id: 'x', role: '怪', content: '' }] }]) === null
  )
  check(
    '**一条消息都没有的会话读回来时被丢掉**（它在列表上占一行、点进去是空白）',
    hist.parseChatLog([{ id: 'c', profileId: 'p', at: 1, items: [] }, older])?.length === 1
  )
}

console.log('\n=== 菜品行的危险档(高危红 / 其余黄)===')
{
  /*
    用户 2026-09-24 下午看到「一盘菜里每一道都红」之后定的是「高危标红,中危标黄」。
    判据是 `types.ts` 的 `dishRiskLevel` —— 它**不是**「模型说了什么」,而是
    「这道菜碰到了你档案里哪一条忌口、那条忌口有多重」。

    ⚠️ 这一节盯的是**判据**,不是颜色:颜色那一半在 `verify-render` 的 ④g
    (渲染出来才知道红还是黄)。判据在这里能被穷举 —— 颜色只有两档。

    ⚠️ 「等级是那条忌口自己的」这两条(第二条和第三条)**不能合并**:只断「高危
    能红」的话,一个「撞上就返回高危」的实现照样全绿,而那正是最容易写出来的
    那一版 —— 红会重新变成「模型提过这道菜」的同义词,也就是用户这次要修的东西。
  */
  const { dishRiskLevel } = typesMod
  const riskDish = (name, extra = {}) => ({ foodId: `unmatched:${name}`, name, grams: 100, suitable: false, ...extra })

  check(
    '名字里就有那条忌口的词 → 那一档',
    dishRiskLevel(riskDish('花生拌饭'), [{ item: '花生', type: 'allergy', level: '高危' }]) === '高危'
  )
  check(
    '**等级取的是那一条自己的**(低危的忌口不该被当成高危)',
    dishRiskLevel(riskDish('凉拌香菜'), [{ item: '香菜', type: 'taboo', level: '低危' }]) === '低危',
    dishRiskLevel(riskDish('凉拌香菜'), [{ item: '香菜', type: 'taboo', level: '低危' }])
  )
  check(
    '**两条都沾上时取最重的那条**(不是先撞上的那条,也不是最后一条)',
    dishRiskLevel(riskDish('花生拌香菜'), [
      { item: '香菜', type: 'taboo', level: '低危' },
      { item: '花生', type: 'allergy', level: '高危' },
    ]) === '高危'
  )
  check(
    '**名字里没有、模型那句理由点了名 → 也算**(`restrictionHit` 盖不到复合菜里的过敏原)',
    dishRiskLevel(riskDish('宫保鸡丁', { reason: '含花生，你的档案里写着花生过敏' }), [
      { item: '花生', type: 'allergy', level: '高危' },
    ]) === '高危'
  )
  check(
    '**食物库 id 里的英文词也算**(「番茄炒蛋」的名字里没有「鸡蛋」两个字)',
    dishRiskLevel(
      { foodId: 'tomato-egg', name: '番茄炒蛋', grams: 150, suitable: false },
      [{ item: '鸡蛋', type: 'allergy', level: '高危' }]
    ) === '高危'
  )
  check(
    '**一条都没沾上 → undefined**(调用方按黄;这里是「不知道」,不是「安全」)',
    dishRiskLevel(riskDish('红烧肉', { reason: '高钠，血压偏高的人要少吃' }), [
      { item: '花生', type: 'allergy', level: '高危' },
    ]) === undefined
  )
  check(
    '档案里一条忌口都没写 → undefined(没告诉过 App 什么对你是危险的)',
    dishRiskLevel(riskDish('花生拌饭'), []) === undefined
  )
}

/* ============================================================
   日记页那一行 / 对话页那张卡:两把尺子
   ------------------------------------------------------------
   `store/logRun.ts` 里那两个纯函数。**两个页面共用它们**,所以它们错了
   不会在某一页上「看起来不对」—— 而是**两页一起**说同一句错话。
   `pendingForDate` 尤其要在这里钉死:它的输出直接决定日记页上有没有那一行,
   而在 `verify-render` 里只能摆几个姿势(受控组件 + 整页渲染),摆不全
   这张真值表(六种归宿 × 日期对不对)。
   ============================================================ */

console.log('\n=== 那一趟「记进日记」:日记页显示哪一行 / 对话页说哪句话 ===')

{
  const logRun = await load('/src/store/logRun.ts')
  const { pendingForDate, noticeFor } = logRun

  /** 草稿。只喂判据真正读到的三个字段(`slot` 是给图标用的,判据不看它) */
  const mealAt = (at) => ({ profileId: 'demo', slot: '午餐', items: [], at, thumb: 'data:x', })

  const noon = (() => {
    const d = new Date()
    d.setHours(12, 30, 0, 0)
    return d.getTime()
  })()
  const LAST_NIGHT = noon - 24 * 60 * 60 * 1000

  const TODAY = date.toISODate(new Date(noon))
  const YESTERDAY = date.toISODate(new Date(LAST_NIGHT))

  check('(锚点) 今天和昨天确实是两天', TODAY !== YESTERDAY, `${YESTERDAY} → ${TODAY}`)

  /*
    ⚠️ **六种归宿各一条**,不是「随便挑一个算了的」:
    这张表上每一格都对应一种屏幕上看得见 / 看不见的地方,漏一格就是漏一种
    「用户以为它在算,其实它不会来了」或者「用户以为记好了,其实还欠着」。

    前两格是**正例**(该显示),后四格是**反例**(不该显示),而且反例各有各的
    理由 —— 写成「只有 computing 显示」是量不出理由的。
  */
  const computingLog = { phase: 'computing', kind: 'log', meal: mealAt(noon) }
  const computingAdjust = { phase: 'computing', kind: 'adjust', meal: mealAt(noon) }
  const failed = { phase: 'failed', kind: 'log', meal: mealAt(noon), message: '超时了' }
  const logged = { phase: 'logged', meal: mealAt(noon) }
  const adjustReady = { phase: 'adjust-ready', meal: mealAt(noon), items: [] }

  const shown = (run, d) => pendingForDate(run, d) !== null

  check(
    '**今天那一餐正在算 → 显示**(这是这一整段存在的理由)',
    shown(computingLog, TODAY),
    '显示'
  )
  check(
    '**今天那一餐没算出来 → 也显示**(它确实还没记进去 —— 这一行是用户唯一的说法)',
    shown(failed, TODAY) && pendingForDate(failed, TODAY).message === '超时了',
    '显示,而且带着原因'
  )
  /*
    ⚠️ **日期对不上就不显示**,而日期必须从 `meal.at` 推:23:59 拍的那一餐
    显示在昨天,落盘也落在昨天(`logUnlogged` 用的是同一把尺子)。
    用别的时刻(比如「此刻」)会让那一行出现在今天,而十几秒后真记录落在昨天
    —— 看起来像这一条飞了。
  */
  check(
    '**昨天拍的那一餐不出现在今天**(它十几秒后也不落在今天 —— 同一把尺子)',
    !shown({ ...computingLog, meal: mealAt(LAST_NIGHT) }, TODAY) && shown({ ...computingLog, meal: mealAt(LAST_NIGHT) }, YESTERDAY),
    '昨天的那一行在昨天'
  )
  /*
    ⚠️ 后四格**各有各的理由**,别合并成一句「不是 computing 就不显示」:
    · `logged`       —— 真记录已经在列表里了,再来一行就是重复
    · `adjust-ready` —— 在等用户改分量,还没落盘
    · 「调整分量再记」在算 —— 同上,它**不会**自己变成一条记录
    · 下面还有一条 `null`(什么都没在跑)
  */
  check(
    '**已经落盘的不显示**(真记录已经在列表里了)',
    !shown(logged, TODAY),
    '不显示'
  )
  check(
    '**「调整分量再记」算完了不显示**(它在等用户改分量,还没落盘)',
    !shown(adjustReady, TODAY),
    '不显示'
  )
  check(
    '**「调整分量再记」在算的时候也不显示**(对这一条说「正在算这一餐」是句假话:它不会自己记进去)',
    !shown(computingAdjust, TODAY),
    '不显示'
  )
  check(
    '**什么都没在跑时不显示**',
    !shown(null, TODAY),
    '不显示'
  )

  /* ---------- 对话页那张卡 ---------- */

  const view = (run, closed) => noticeFor(run, closed)

  check(
    '**在算的时候那张卡在说「正在算」**(`done: false`、没有错误)',
    view(computingLog, false)?.done === false && view(computingLog, false)?.error === null,
    JSON.stringify(view(computingLog, false))
  )
  check(
    '**算成了那张卡改说「已经记进日记了」**(`done: true`)',
    view(logged, false)?.done === true,
    JSON.stringify(view(logged, false))
  )
  check(
    '**没算出来那张卡带着原因说**(原因原样带过去,不在这里改写)',
    view(failed, false)?.error === '超时了' && view(failed, false)?.done === false,
    JSON.stringify(view(failed, false))
  )
  /*
    ⚠️ **只有 `failed` 不看 `closed`。** 用户在等的那十几秒里完全可以把它关掉
    (关掉是允许的,他不该为此付出代价),不重弹这一趟就**一句话都没说** ——
    而屏幕上看起来和「已经记进去了」一模一样。
  */
  check(
    '**用户关过卡之后:算成了不再弹回来报一次成功**(关它就是「这句我知道了」)',
    view(logged, true) === null && view(computingLog, true) === null,
    '两条都不再出现'
  )
  check(
    '**而没算出来**必须**说 —— 关过卡也照样说**(不然用户在日记页上守着一行「没算出来」,却没人告诉他)',
    view(failed, true)?.error === '超时了',
    JSON.stringify(view(failed, true))
  )
  check(
    '**「调整分量再记」不借这张卡说话**(那一趟的去向是记录面板,不是这张卡)',
    view(adjustReady, false) === null && view(computingAdjust, false)?.kind === 'adjust',
    JSON.stringify(view(computingAdjust, false))
  )
  check('**什么都没在跑时不显示那张卡**', view(null, false) === null, '不显示')
}

await server.close()
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
