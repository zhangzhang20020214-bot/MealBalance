/**
 * 存储配额自检(开发用,不进产物)
 * ===========================================================
 * 缩略图进了 localStorage 之后,「写不进去」从理论问题变成会真实发生的事:
 * 一次拍餐盘给每条记录加 8–12KB,配额是会被写满的。
 *
 * 这个脚本盯的是两件事,都是**数据安全**层面的:
 *
 *   1. 配额写满时,不能静默失败 —— 用户必须知道这一餐没存下来
 *   2. 写失败之后要**丢掉照片重试一次** —— 营养数据比照片重要得多,
 *      不能因为一张图把整餐记录写没
 *
 * 跑法:npm run verify:quota
 *
 * 实现方式:用一个假 localStorage 精确控制「装得下多少」,而不是真的去
 * 塞满浏览器 —— 那样既慢又不确定,而且没法断言"丢了几张缩略图"。
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'vite'

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  → ${detail}` : ''}`)
  if (!ok) failures++
}

/* ------------------------------------------------------------
   假 localStorage —— 可以设一个字节上限,超了就抛 QuotaExceededError
   ------------------------------------------------------------ */

class FakeStorage {
  constructor(limitBytes = Infinity) {
    this.map = new Map()
    this.limit = limitBytes
  }
  /** 当前占用 */
  get used() {
    let n = 0
    for (const [k, v] of this.map) n += k.length + v.length
    return n
  }
  setItem(key, value) {
    const size = String(key).length + String(value).length
    let others = 0
    for (const [k, v] of this.map) if (k !== key) others += k.length + v.length
    if (others + size > this.limit) {
      const err = new Error('QuotaExceededError')
      err.name = 'QuotaExceededError'
      throw err
    }
    this.map.set(String(key), String(value))
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }
  removeItem(key) {
    this.map.delete(key)
  }
  clear() {
    this.map.clear()
  }
}

/** 装成浏览器 —— persist.ts 是在模块顶层通过 window.localStorage 拿句柄的 */
function installStorage(limitBytes) {
  const store = new FakeStorage(limitBytes)
  globalThis.window = { localStorage: store }
  return store
}

function uninstallStorage() {
  delete globalThis.window
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

/* ------------------------------------------------------------
   1. stripThumbs —— 纯逻辑,先单独验
   ------------------------------------------------------------ */
console.log('\n=== 1. stripThumbs ===')
const persist = await server.ssrLoadModule('/src/store/persist.ts')

const withThumbs = {
  version: 3,
  profile: { name: 'A' },
  meals: [
    { id: 'm1', date: '2026-09-19', slot: '午餐', time: '12:00', source: '拍餐盘', items: [{ foodId: 'rice', name: '米饭', grams: 150 }], createdAt: 1, thumb: 'data:image/jpeg;base64,AAAA' },
    { id: 'm2', date: '2026-09-19', slot: '晚餐', time: '19:00', source: '手动记录', items: [{ foodId: 'rice', name: '米饭', grams: 150 }], createdAt: 2 },
    { id: 'm3', date: '2026-09-18', slot: '早餐', time: '08:00', source: '拍餐盘', items: [{ foodId: 'egg', name: '鸡蛋', grams: 50 }], createdAt: 3, thumb: 'data:image/jpeg;base64,BBBB' },
  ],
  // 非当前档案也带一张 —— 多档案之后缩略图散在两处,只剥 state.meals 的话
  // 这第三张会让降级重试仍然超配额,最后落到那条硬失败分支上
  profiles: [
    {
      id: 'p-b',
      profile: { name: 'B' },
      meals: [
        { id: 'm4', date: '2026-09-17', slot: '午餐', time: '12:30', source: '拍餐盘', items: [{ foodId: 'broccoli', name: '西兰花', grams: 90 }], createdAt: 4, thumb: 'data:image/jpeg;base64,CCCC' },
        { id: 'm5', date: '2026-09-17', slot: '晚餐', time: '18:30', source: '手动记录', items: [{ foodId: 'rice', name: '米饭', grams: 100 }], createdAt: 5 },
      ],
    },
  ],
  activeProfileId: 'p-a',
  onboarded: true,
}

const stripped = persist.stripThumbs(withThumbs)
check('丢掉了 3 张缩略图(含非当前档案那张)', stripped.dropped === 3, String(stripped.dropped))
check('当前档案的缩略图键真的没了', stripped.state.meals.every((m) => !('thumb' in m)))
check('**非当前档案的缩略图也剥掉了**', stripped.state.profiles.every((p) => p.meals.every((m) => !('thumb' in m))))
check('营养数据一条不少', stripped.state.meals.length === 3 && stripped.state.profiles[0].meals.length === 2)
check(
  '菜品清单原样保留',
  JSON.stringify(stripped.state.meals.map((m) => m.items)) ===
    JSON.stringify(withThumbs.meals.map((m) => m.items))
)
check(
  '非当前档案的菜品清单也原样保留',
  JSON.stringify(stripped.state.profiles[0].meals.map((m) => m.items)) ===
    JSON.stringify(withThumbs.profiles[0].meals.map((m) => m.items))
)
// 引用契约的两个方向。调用方(saveState)靠「是不是同一个对象」判断有没有动过
check('剥掉缩略图时返回的是新对象(不改输入)', stripped.state !== withThumbs)
check('没剥到时返回同一个对象', persist.stripThumbs(stripped.state).state === stripped.state)

/* ------------------------------------------------------------
   2. 空间够 —— 什么都不该发生
   ------------------------------------------------------------ */
console.log('\n=== 2. 空间充足 ===')
installStorage(Infinity)
const okOutcome = persist.saveState(withThumbs)
check('写成功', okOutcome.ok === true)
check('没有丢缩略图', okOutcome.droppedThumbs === 0)
check('没有残留提示', persist.getSaveNotice() === null, JSON.stringify(persist.getSaveNotice()))

/* ------------------------------------------------------------
   3. 装不下缩略图,但装得下营养数据 —— 必须降级成功
   ------------------------------------------------------------ */
console.log('\n=== 3. 只放得下营养数据 ===')
/*
 * 上限要卡在「去掉缩略图刚好写进去、带着缩略图刚好写不进」之间。
 *
 * 上界不是拍的:假存储按 `key.length + value.length` 算占用,
 * key 是 'mealbalance:v1'(15 字)。所以
 *   带上缩略图 = lean + 3×(thumb 长度 + `,"thumb":""` 的键名开销)
 * 留 5 个字符的余量就足够把「带了缩略图」那一版挤出去了 ——
 * 一开始写 +200,结果两个版本都装得下,这条用例静默变成了空转。
 */
const KEY_LEN = 'mealbalance:v1'.length
const lean = JSON.stringify(persist.stripThumbs(withThumbs).state)
installStorage(KEY_LEN + lean.length + 5)

const degraded = persist.saveState(withThumbs)
check('仍然报告成功', degraded.ok === true, JSON.stringify(degraded))
check('告知丢掉了 3 张缩略图', degraded.droppedThumbs === 3, String(degraded.droppedThumbs))
check('提示文案提到了照片', /照片/.test(degraded.message ?? ''), degraded.message)

const notice = persist.getSaveNotice()
check('提示能被界面读到', notice !== null && notice.ok === true)
check(
  '提示没有被误判成"一切正常"',
  notice !== null && notice.droppedThumbs > 0,
  JSON.stringify(notice)
)

// 关键:营养数据真的落盘了
const written = JSON.parse(globalThis.window.localStorage.getItem('mealbalance:v1'))
check('记录条数正确', written.meals.length === 3, String(written.meals.length))
check('缩略图没写进去', written.meals.every((m) => !m.thumb))
// 这条是整个脚本存在的理由:照片可以丢,营养不能丢
check(
  '**营养数据完整落盘**',
  JSON.stringify(written.meals.map((m) => m.items)) ===
    JSON.stringify(withThumbs.meals.map((m) => m.items))
)
check('日期/餐次/来源都在', written.meals[0].slot === '午餐' && written.meals[0].source === '拍餐盘')

/*
  非当前档案那半张 —— 这一条是这次改动的重点。

  多档案之后缩略图散在 `state.meals` 和 `state.profiles[i].meals` 两处。只剥
  前者的表现:降级重试**仍然**超配额 → 落到下面 §4 那条硬失败分支 → 用户看到
  「存储空间不足,这一餐没能保存下来」。而那张碍事的照片在**别的档案**里,
  怎么看都跟眼前这一餐没关系。上面 §1 已经断言了纯函数会剥,这里断言的是
  真写进去的那份也别带着它。
*/
check('非当前档案的记录条数正确', written.profiles[0].meals.length === 2, String(written.profiles[0].meals.length))
check('**非当前档案的缩略图也没写进去**', written.profiles[0].meals.every((m) => !m.thumb))
check(
  '非当前档案的营养数据完整落盘',
  JSON.stringify(written.profiles[0].meals.map((m) => m.items)) ===
    JSON.stringify(withThumbs.profiles[0].meals.map((m) => m.items))
)

/* ------------------------------------------------------------
   4. 连营养数据都放不下 —— 必须冒出来,不能静默
   ------------------------------------------------------------ */
console.log('\n=== 4. 完全写不进去 ===')
/*
 * 上限必须**大于探针那次写入**(persist.storage() 会先 setItem('__mb_probe__','1')
 * 再删掉,占 13+1=14 字),否则 storage() 自己就抛异常、返回 null,
 * 走到的是「存储不可用」那条分支 —— 和这条用例要测的「配额满了」是两回事。
 * 一开始写了 10,测出来的失败原因就是 unavailable,差点当成代码有问题。
 */
installStorage(20)
const failed = persist.saveState(withThumbs)
check('报告失败', failed.ok === false, JSON.stringify(failed))
check('原因标成配额', failed.reason === 'quota', String(failed.reason))
check('有给用户看的文案', typeof failed.message === 'string' && failed.message.length > 0, failed.message)

const failNotice = persist.getSaveNotice()
check('失败真的被播出去了', failNotice !== null && failNotice.ok === false)
check('文案指向自救入口', /我的|清理/.test(failNotice?.message ?? ''), failNotice?.message)

// 同一类失败重复发生不该反复通知 —— 否则 useSyncExternalStore 会无限重渲染
let notified = 0
const unsub = persist.subscribeSaveNotice(() => notified++)
persist.saveState(withThumbs)
persist.saveState(withThumbs)
check('同样的失败不重复通知', notified === 0, `通知了 ${notified} 次`)
unsub()

/* ------------------------------------------------------------
   5. 恢复正常 —— 提示要自己消失
   ------------------------------------------------------------ */
console.log('\n=== 5. 空间恢复 ===')
persist.saveState(withThumbs) // 还是失败状态
installStorage(Infinity)
const recovered = persist.saveState(withThumbs)
check('重新写成功', recovered.ok === true && recovered.droppedThumbs === 0)
check('提示被清掉', persist.getSaveNotice() === null, JSON.stringify(persist.getSaveNotice()))

/* ------------------------------------------------------------
   6. 存储整个不可用(隐私模式)—— 不能崩,但要说明
   ------------------------------------------------------------ */
console.log('\n=== 6. 存储不可用 ===')
installStorage(Infinity)
globalThis.window.localStorage.setItem = () => {
  throw new Error('SecurityError')
}
const unavailable = persist.saveState(withThumbs)
check('报告失败', unavailable.ok === false, JSON.stringify(unavailable))
check('原因标成不可用', unavailable.reason === 'unavailable', String(unavailable.reason))
check('文案说明只在本次会话有效', /会话|存储/.test(unavailable.message ?? ''), unavailable.message)

/* ------------------------------------------------------------
   7. 读盘的形状守卫
   ------------------------------------------------------------
   多档案之后「读进来一个形状不对的对象」的代价变了:以前最多是某个字段是
   undefined,现在是 `state.profiles.map(...)` 在渲染期抛 —— 而抛的位置在
   组件里,表现是**白屏**。所以守卫要挡住的不只是「不是对象」。
   ------------------------------------------------------------ */
console.log('\n=== 7. 读盘的形状守卫 ===')

installStorage(Infinity)
const KEY = 'mealbalance:v1'
const write = (payload) => globalThis.window.localStorage.setItem(KEY, JSON.stringify(payload))
/*
  ⚠️ `version` 取的是**当前**的 `SCHEMA_VERSION`,不是写死的数字。
  写死的话每 bump 一次版本，这一条就假红一次 —— 而它要证的是「形状对了就读得回来」，
  和版本号是几无关。下面「版本不符 → 丢弃」那一条才是版本号的正主。
*/
const good = {
  version: persist.SCHEMA_VERSION,
  profile: { name: 'A' },
  meals: [],
  profiles: [],
  activeProfileId: 'p-a',
  onboarded: true,
}

write(good)
check(`形状正确的载荷读得回来(当前 schema v${persist.SCHEMA_VERSION})`, persist.loadState()?.onboarded === true)

/*
  ⚠️ 上面那条**故意**用 `persist.SCHEMA_VERSION` 而不是写死数字 —— 写死的话每
  bump 一次版本它就假红一次,而它要证的是「形状对了就读得回来」,和版本号是几无关。

  但这样一来版本号本身就没人看了。所以补一条盯**那个数字和它的历史注释**:
  `persist.ts` 的文件头按仓库惯例逐版记着「vN 改了什么」,而那个清单的最后一版
  必须就是 `SCHEMA_VERSION`。bump 了数字却没写这一版改了什么 —— 或者反过来 —— 都红。
  (这是这个仓库里唯一一处「同一个事实写在两行上」的地方,所以值得一条断言。)
  红法:把 `SCHEMA_VERSION` 改成 7。
*/
const persistSrc = await readFile(new URL('../src/store/persist.ts', import.meta.url), 'utf8')
const historyVersions = [...persistSrc.matchAll(/^\s*\*\s*v(\d+):/gm)].map((m) => Number(m[1]))
const maxHistory = Math.max(...historyVersions)
check(
  '**`SCHEMA_VERSION` 就是版本清单里的最后一版**（bump 了数字就得写清这一版改了什么）',
  historyVersions.length > 0 && maxHistory === persist.SCHEMA_VERSION,
  `清单里到 v${maxHistory}（${historyVersions.length} 版）· 常量是 v${persist.SCHEMA_VERSION}`
)

/*
  ⚠️ 这一条断的是**版本闸本身** —— 形状一点没毛病，只有版本号差一版。
  v6 的版本闸为什么不能省:`isAppState` 按设计**不往 `profile` 里面看**
  (见 persist.ts 那段),所以「一条 `type: 'preference'` 的老忌口」过得了形状
  校验，却会在 `restrictionLabel` 里渲染成「辣undefined」—— 而这个仓库最不想要的
  就是这种不报错的错。版本号是**唯一**挡得住它的东西。

  ⚠️ 2026-09-22 改了自变量:`SCHEMA_VERSION - 1` 换成 `- 2`。
  v8 给 v7 写了一条迁移,**差一版的那个载荷现在是「被迁移」而不是「被丢弃」**——
  再拿 `- 1` 去断「丢弃」会变成一条假红(而且它红得很有道理:那一版确实不该丢)。
  这条要证的东西没变,只是得挑一个**没有迁移路径**的旧版本,`- 2` 就是。
*/
write({ ...good, version: persist.SCHEMA_VERSION - 2 })
check(
  '**差两版的载荷被丢弃**（没有迁移路径的旧版本 —— 版本闸是唯一挡住旧 type 的东西）',
  persist.loadState() === null
)

/* ------------------------------------------------------------
   v7 → v8:唯一一条**不丢数据**的迁移
   ------------------------------------------------------------
   前面每一版 bump 都是「丢弃重来」,这一版不一样:一个「加餐」该变成三档里的
   哪一档,答案就写在记录自己的 `time` 上(见 lib/slots.ts 的 `slotForClock`)。
   所以这里有得可断 —— 而且**必须断**,因为「迁移写错了」的表现和「迁移没写」
   在界面上是同一种:那几条记录的餐次不对,而没有任何一处会报错。

   夹具刻意做成一份**形状完整的 v7 载荷**(连 profiles 里那一份日记也放了一条),
   并且**同时**放了不该被动到的记录 —— 「一条都没丢」和「该改的改对了」是
   两件事,分开断。
   ------------------------------------------------------------ */
const v7meals = [
  { id: 'v7-a', date: '2026-09-20', slot: '加餐', time: '15:30', source: '手动记录', items: [], createdAt: 1 },
  { id: 'v7-b', date: '2026-09-20', slot: '加餐', time: '21:40', source: '手动记录', items: [], createdAt: 2 },
  { id: 'v7-c', date: '2026-09-20', slot: '加餐', time: '10:15', source: '手动记录', items: [], createdAt: 3 },
  // 用户**亲手选的**「午餐」,时间却落在下午加餐那一段 —— 迁移不许按时间重算它
  { id: 'v7-d', date: '2026-09-20', slot: '午餐', time: '15:30', source: '手动记录', items: [], createdAt: 4 },
  // 时间写坏了的:解析不出来,**留着不动**,不猜
  { id: 'v7-e', date: '2026-09-20', slot: '加餐', time: '', source: '手动记录', items: [], createdAt: 5 },
]
const v7payload = {
  ...good,
  version: 7,
  meals: v7meals,
  profile: { name: 'A' },
  profiles: [
    {
      id: 'p-b',
      profile: { name: 'B' },
      // 别的档案里那一条 —— 只迁当前档案的话,它切回来之前谁都不会发现
      meals: [{ id: 'v7-f', date: '2026-09-19', slot: '加餐', time: '09:30', source: '手动记录', items: [], createdAt: 6 }],
    },
  ],
}
write(v7payload)
const migrated = persist.loadState()
/*
  ⚠️ `s === null` 那一支不是防御性编程,是**量具**:「v7 载荷被丢弃」这个坏法
  会让下面每一条都读不到记录。不兜的话第一条就 `Cannot read properties of null`
  当场崩掉,后面几条根本没跑 —— 而「崩了」和「红了」在两个套件的收尾那句上
  完全不一样(见 private/breaktests-slots.mjs 里第 ⑱ 刀)。
  兜住之后:每一条都如实报红,一个不漏。
*/
const slotOf = (s, id) =>
  s === null ? '(载荷被丢弃了)' : ([...s.meals, ...s.profiles.flatMap((p) => p.meals)].find((m) => m.id === id)?.slot ?? '(没了)')

check('v7 的载荷读得回来（迁移,不是丢弃）', migrated !== null)
check('迁移之后版本号写成当前值', migrated?.version === persist.SCHEMA_VERSION, `v${migrated?.version}`)
check(
  '**一条都没丢**',
  migrated !== null && migrated.meals.length + migrated.profiles[0].meals.length === 6,
  `5 + 1 = 6，读到 ${migrated === null ? '(丢弃了)' : migrated.meals.length + migrated.profiles[0].meals.length}`
)
check('15:30 那条 → 下午加餐', slotOf(migrated, 'v7-a') === '下午加餐', slotOf(migrated, 'v7-a'))
check('21:40 那条 → 夜宵', slotOf(migrated, 'v7-b') === '夜宵', slotOf(migrated, 'v7-b'))
check('10:15 那条 → 上午加餐', slotOf(migrated, 'v7-c') === '上午加餐', slotOf(migrated, 'v7-c'))
check(
  '**用户亲手选的「午餐」不许被按时间重算**',
  slotOf(migrated, 'v7-d') === '午餐',
  '按 time 重算会把它改成下午加餐 —— 那是替用户改主意'
)
check('时间解析不出来的那条原样留着（不猜）', slotOf(migrated, 'v7-e') === '加餐', slotOf(migrated, 'v7-e'))
check('**另一个档案里的那条也迁了**', slotOf(migrated, 'v7-f') === '上午加餐', slotOf(migrated, 'v7-f'))
check(
  '记录里除 slot 之外的字段逐字段没动',
  // `?? []` 不是防御:载荷被丢弃时左边是 `[]`、右边是那五条,如实报红。
  // 写成 `migrated?.meals.map(...)` 会在 null 上抛 —— `?.` 只保住了 `meals`,
  // 后面那个 `.map` 照样崩,而崩了会把这一节剩下的断言全带走。
  JSON.stringify((migrated?.meals ?? []).map((m) => ({ ...m, slot: null }))) ===
    JSON.stringify(v7meals.map((m) => ({ ...m, slot: null })))
)
check(
  '迁移是幂等的（同一份载荷再迁一次结果相同）',
  // 同上:载荷被丢弃时这个分支不成立,如实报红,不在这里再崩一次
  migrated !== null && JSON.stringify(persist.migrateLegacySlots(migrated)) === JSON.stringify(migrated)
)

write({ ...good, onboarded: undefined }) // JSON 里这个键直接消失
check('缺 onboarded 的载荷被丢弃', persist.loadState() === null, '首屏要读它决定走不走引导')

write({ ...good, activeProfileId: 7 })
check('activeProfileId 不是字符串 → 丢弃', persist.loadState() === null)

write({ ...good, profiles: [{ id: 'p-b' }] })
check('槽位缺 meals → 丢弃', persist.loadState() === null, '否则 state.profiles[i].meals.map 会在渲染期抛')

write({ ...good, profiles: [{ id: 'p-a', profile: { name: 'A' }, meals: [] }] })
check(
  '**当前档案出现在 profiles 里 → 丢弃**',
  persist.loadState() === null,
  '这是 switchProfile 写成「先写后查」会留下的半写状态:编辑会落进错的那一份,而且看不出来'
)

write({ ...good, profiles: [{ id: 'p-b', profile: { name: 'B' }, meals: [] }] })
check('合法的另一份档案照常读回', persist.loadState()?.profiles.length === 1)

uninstallStorage()
await server.close()
console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}\n`)
process.exit(failures === 0 ? 0 : 1)
