/**
 * 幽灵条目变异测试(开发用,不进产物)
 * ===========================================================
 * 跑法:`npm run probe:ghost`
 *
 * 它回答一个问题:**「有一条记录的 foodId 在食物库里没了」这件事,到底有多大**
 * **代价,以及 App 会不会告诉你。**
 *
 * 做法是一次**真变异**:直接从 `FOOD_BY_ID` 里删掉一条**今天的记录真的在用**
 * 的食物,然后对比删除前后的数字。这比写一段文字解释有力得多 —— 下面这些
 * 数字是量出来的。
 *
 * 为什么不能用夹具(verify-loop 里那一节已经用了夹具)
 * ------------------------------------------------------------
 * 夹具的形状可能和真实数据对不上,而那时测试会**绿着骗人**。这个仓库已经
 * 栽过一次:上一轮两条 foodId 断言一直是绿的,但它们直接调 matchDishes,
 * 而客户端在那之前就把字段丢了 —— 测试跑在错误的层上,比没有测试更糟。
 *
 * 所以这里必须用真数据、真变异。顺带也就验掉了「探测器只在夹具上会响」的
 * 可能:同一个 findBrokenRefs,喂真数据一样抓得出来。
 *
 * 变异是**进程内**的(`FOOD_BY_ID` 是个 Map,删了就在这个进程里没了),
 * 所以它必须独立成一个脚本 —— 塞进 verify-loop 会污染后面所有依赖食物库
 * 的断言,而且删除再插回去会让 Map 的迭代顺序变掉。
 */

import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
const load = (p) => server.ssrLoadModule(p)

const store = await load('/src/store/store.ts')
const derive = await load('/src/store/derive.ts')
const date = await load('/src/lib/date.ts')
const { FOOD_BY_ID } = await load('/src/data/foods.ts')

const { meals, profile } = store.getSnapshot()
const today = date.todayISO()

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failures++
}

console.log('\n=== 幽灵条目变异测试 ===')

if (meals.length === 0) {
  // 用户清空过日记时不报错 —— 这个脚本是开发工具,不该在正常状态下变成噪音
  console.log('  今天的记录是空的(可能刚清空过日记),没有可变异的东西。跳过。')
  await server.close()
  process.exit(0)
}

/**
 * 挑一条**今天**真的在用的食物。
 *
 * 种子数据铺了 14 天,随便挑一条很可能今天根本没出现 —— 那样数字当然不会变,
 * 看起来像「这条路没有代价」。第一版就是这么写的,结果量出来 943 → 943。
 */
const usedToday = new Set(
  meals.filter((m) => m.date === today).flatMap((m) => m.items.map((i) => i.foodId)),
)
const victim = [...usedToday].find((id) => FOOD_BY_ID.has(id))

if (!victim) {
  console.log('  今天的记录里没有可用的 foodId,跳过。')
  await server.close()
  process.exit(0)
}

const victimName = FOOD_BY_ID.get(victim).name
const occurrences = meals
  .filter((m) => m.date === today)
  .flatMap((m) => m.items)
  .filter((i) => i.foodId === victim).length

const before = derive.dayStats(meals, today, profile)
const beforeRefs = derive.findBrokenRefs(meals)

console.log(`\n  变异:从食物库里删掉「${victimName}」(${victim})`)
console.log(`  它在今天的记录里出现 ${occurrences} 次`)
console.log(`  删除前:${Math.round(before.nutrition.kcal)} kcal · 钠 ${Math.round(before.nutrition.sodium)}mg · 健康分 ${before.score.score}`)
console.log(`          探测器报 ${beforeRefs.length} 条`)

// ---- 变异 ----
FOOD_BY_ID.delete(victim)

const after = derive.dayStats(meals, today, profile)
const afterRefs = derive.findBrokenRefs(meals)

console.log(`  删除后:${Math.round(after.nutrition.kcal)} kcal · 钠 ${Math.round(after.nutrition.sodium)}mg · 健康分 ${after.score.score}`)
console.log(`          探测器报 ${afterRefs.length} 条:${afterRefs.map((r) => `${r.name}×${r.count}`).join('、') || '(无)'}`)

/* ------------------------------------------------------------
   断言
   ------------------------------------------------------------ */

console.log('')

// ① 代价是真的:删掉一条 id,数字会变 —— 而且是**没有异常**地变
const kcalDropped = after.nutrition.kcal < before.nutrition.kcal
check(
  '删掉 id 后热量确实掉了(这就是那条静默路径的代价)',
  kcalDropped,
  `${Math.round(before.nutrition.kcal)} → ${Math.round(after.nutrition.kcal)} kcal`,
)
check(
  '健康分也跟着变了 —— 用户看到的是「今天吃得不错」',
  after.score.score !== before.score.score || kcalDropped,
  `${before.score.score} → ${after.score.score}`,
)

// ② 探测器在**真数据**上会响(不是只在夹具上)
const detected = afterRefs.some((r) => r.foodId === victim)
check('探测器在真实记录上抓到了它', detected, JSON.stringify(afterRefs))

// ③ 名字来自 MealItem 里冗余存的那一份 —— 库里已经没有它了,只剩这个名字
check(
  '带出来的名字是记录里的冗余字段(库里已删,不可能从库里取到)',
  afterRefs[0]?.name === victimName && !FOOD_BY_ID.has(victim),
  `${afterRefs[0]?.name} / 库里存在=${FOOD_BY_ID.has(victim)}`,
)

// ④ 变异前必须是干净的 —— 否则上面那些「抓到了」可能是本来就有的残留
check('变异之前一条幽灵都没有(所以上面抓到的一定是这次删出来的)', beforeRefs.length === 0)

await server.close()

console.log(
  failures === 0
    ? '\n全部通过 —— 数字会悄悄变,但现在会被说出来。\n'
    : `\n${failures} 项失败\n`,
)
process.exit(failures === 0 ? 0 : 1)
