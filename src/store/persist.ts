/**
 * 落盘层 —— localStorage 读写
 *
 * 为什么不用 IndexedDB:整个状态只有几 KB(几十条餐次记录),
 * 上 IndexedDB 要处理异步事务、版本迁移、游标,是纯粹的过度设计。
 * localStorage 同步、简单,在这个量级上完全够用。
 *
 * 为什么不用服务端:这是个前端演示作品,没有常驻后端。
 * 数据存在浏览器里,换个设备就看不到 —— 这个取舍是明确的,
 * 若要支持多设备同步,把这一层换成 API 调用即可,上层不用动。
 */

import { slotForClock } from '../lib/slots'
import type { AppState, MealEntry, ProfileSlot } from './types'

const KEY = 'mealbalance:v1'

/**
 * schema 版本。改动 AppState 结构时 +1,旧数据会被丢弃。
 *
 * v2:忌口从 `{label}` 改成 `{item, type}` —— 旧数据里没有 `item`,
 *     直接读会渲染出「undefined过敏」。演示数据没有迁移价值,丢弃即可。
 * v3:多档案。`AppState` 多了 `profiles` / `activeProfileId` / `onboarded`,
 *     `Profile` 多了特殊时期 / 慢性病 / 饮食偏好 / quotaOverrides。
 *     一份 v2 的载荷里没有 `profiles`,过不了下面的守卫 —— 丢弃重来。
 *
 * v2 → v3 的代价是**打开过 App 的人本地记录会重置一次**,这一条写进了 README。
 * 之所以敢丢:这是个演示作品,而且多档案之后「旧记录属于哪个档案」本来就没有
 * 答案 —— 硬迁移只能把它们全塞进第一个档案,那是一个猜出来的结果。
 *
 * v4:`Profile.age`(数字)换成 `Profile.birth`(出生日期)。旧载荷里没有 `birth`,
 *     读下去会在 `ageOn(undefined)` 上炸 —— 而且是在算配额的路上炸,不是打开
 *     就炸。这是**必须**丢的一版:没有出生年月就推不出年龄,拿「28 岁」硬顶
 *     等于替用户编了一份档案。
 *     (v2→v3 那句「写进了 README」这一次**没有做** —— README 要等 App 完工
 *      才动,这条记在 private/ 的工作笔记里,完工时一起补。)
 *
 * v5:`Profile.specialStage`(字符串,单选,`无` 是一个真值)换成
 *     `Profile.specialStages`(数组,多选 + 自由填写),另加 `Profile.notes`。
 *     旧载荷里装的是**字符串**,读下去会在 `p.specialStages.includes(...)`
 *     上炸 —— 配额推导和档案页都会碰到它。而且这一版**字段名也变了**,
 *     所以连「类型对不上但形状还在」那种侥幸都没有:旧值叫 `specialStage`,
 *     新代码一个地方都不读那个名字。
 *     同样没有迁移价值:「更年期」在新词表里根本不是一个取值,搬过去也只能
 *     丢掉;而「无」在新形状里就是 `[]`。硬迁移一次换不来任何真实信息。
 *
 * v6:`RestrictionType` 少了一个取值 —— `preference`(「少吃」)删掉了,
 *     它本来就**不拦菜**,和 `Profile.dietaryPreferences` 是同一件事的两个
 *     字段。旧载荷里那条记录的 `type` 在新表里查不到,`restrictionLabel` 会
 *     渲染成「辣undefined」(见 v2 那条,同一个病)。
 *     ⚠️ 这次**守卫抓不住它**:`isAppState` 按设计**不往 `profile` 里面看**
 *     (`:79-81` 那段),`restrictions` 是个数组、形状也对,只有里面那个字符串
 *     是过期的 —— 所以必须靠版本号拦,不能指望形状校验。
 *     迁移同样不划算:能搬的去处只有一个(把词搬进 `dietaryPreferences`),
 *     而「辣」搬进偏好里读起来是「辣」不是「少辣」,等于替用户改写了他的话。
 *
 * v7:`RestrictionType` 又**少**了一个取值 —— 下午刚加回来的 `dislike`(「不爱吃」)
 *     当天傍晚就删掉了。用户那句话是「都说了不吃折耳根归忌口,偏好只记喜欢吃的」:
 *     判据从「具体食物 / 整体模式」换成「喜欢吃的 / 不想吃的」,于是「忌口」这一格
 *     里**每一种类型都参与拦截**,而「饮食偏好」收窄成只收喜欢吃什么。
 *
 *     ⇒ 这正是下面那条判据**第一次被自己用上**:
 *
 *       删取值 → 旧载荷里那条记录的 `type` 在新表里查不到 → 渲染出「香菜undefined」→ **必须 bump**
 *       加取值 → 旧载荷里那些 `allergy/taboo/drug` 在新表里**全都还在** → **一条渲染路径都不会坏**
 *
 *     代价说清楚:**打开过 App 的人本机已经记下的每一餐、连同档案,会被清一次。**
 *     (和 v2→v3 那次一样,也同样**没有**写进 README —— README 要等 App 完工才动,
 *      这条记在 private/ 的交接笔记里,完工时一起补。)
 *
 *     ⚠️ 迁移**没做,是有意的**:这两版的差集就是那几条「不爱吃」,而它们唯一能搬的
 *     去处是「饮食偏好」—— 可那一格今天是「喜欢吃什么」。把「折耳根不爱吃」搬进去
 *     读起来是「爱吃折耳根」,等于替用户改写了他的意思。和 v6 那条同一个理由。
 *
 *     ⚠️ 下午写在这儿的那个小结(「v7 没有发生」)当时是对的 —— 加取值确实不需要
 *     bump。**加与删这两条判据都留着**,下一次动这个联合类型的人两条都会读到。
 *
 * v8:`MealSlot` **删掉**了一个取值 `加餐`,换成三个(`上午加餐` / `下午加餐` / `夜宵`)
 *     —— 判据还是那条:**删取值必须 bump**。旧载荷里 `slot: '加餐'` 的那几条,
 *     新表里查不到(`derive` 的分桶会把它们整条漏掉:那一餐还在 `entries` 里、
 *     合计也还加上它,但**按餐次分组的那一格凭空少了它**,而首页那行「今天缺哪一餐」
 *     又会说「早餐待记录」;界面上没有任何一处会报错)。
 *
 *     ⚠️ **这一版前面几版不一样:迁移做了,而且一条都不丢。**
 *     前面几次不做迁移,理由都是「搬过去等于替用户改写他的意思」(「辣」搬进偏好
 *     读起来就是「辣」;「折耳根不爱吃」搬过去读起来是「爱吃折耳根」)。这次不同:
 *     一个「加餐」要变成哪一档,答案**就写在记录自己身上** —— `MealEntry.time`。
 *     15:30 记的就是下午加餐,21:40 记的就是夜宵,这不是猜,是把它本来就该在的
 *     那一格还给它(见 `lib/slots.ts` 的 `slotForClock`)。
 *
 *     所以代价是**零**:档案、照片、其余记录逐字段原样,只有 `slot === '加餐'`
 *     那几条的 `slot` 被重写。打印不出「打开过 App 的人数据被清了一次」那句话。
 *
 *     ⚠️ 迁移**只动 `加餐` 那几条,不按时间重算全部记录**。一条 `slot: '午餐'`、
 *     `time: '15:30'` 的记录是用户**在面板上亲手选的午餐**,按时间重算会把它改成
 *     下午加餐 —— 那是替用户改主意,正是前面几版不肯做迁移的那个理由。
 *
 *     ⚠️ 迁移**在内存里做,不在这里写回**。它是幂等的(同一条记录每次算出的结果
 *     一样),而且第一次 commit 就会带着新版本号落盘;在 `loadState` 里顺手
 *     `setItem` 反而是把一次可能失败的写盘塞进模块初始化,失败时会在界面还没
 *     建起来的时候播一条提示。
 */
export const SCHEMA_VERSION = 8

/**
 * 上一个版本号 —— **只有这一版有一条迁移路径**,所以这里写的是字面量 `7`,
 * 不是 `SCHEMA_VERSION - 1`。写成减法的话,下一次 bump 会让 v8→v9 的迁移
 * 悄悄开始处理 v8 的载荷,而它压根不知道该怎么处理。
 */
const PREVIOUS_VERSION = 7

/**
 * 取 localStorage 句柄。
 * 隐私模式、禁用 Cookie、配额写满等情况都会抛异常 —— 这里探测一次,
 * 不可用就返回 null,让上层降级为纯内存运行,而不是让整个 App 崩掉。
 */
function storage(): Storage | null {
  try {
    const s = window.localStorage
    const probe = '__mb_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

/**
 * 存储句柄的**最小形状** —— 只要求三个方法,`window.localStorage` 天然满足。
 *
 * 存在的理由是注入:`store/unlogged.ts` 那三个读写函数要能在 Node 里测,
 * 而 Node 里没有 `window`(见 `image.ts` 的 `ImageDeps` 先例)。
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * 把存储句柄交出去 —— **只给 `store/unlogged.ts` 那一份独立载荷用**。
 *
 * 为什么那份载荷不并进 `AppState`(三条理由,那边文件头写全了):`isAppState`
 * 是白名单守卫,加字段要 bump `SCHEMA_VERSION`,代价是清掉用户已有的全部记录;
 * 那份草稿坏掉不该连累整本日记;`stripThumbs` 只剥 `meals`,多一份带缩略图的
 * 载荷会让「配额写满」那条路径多一个要想清楚的地方。
 *
 * 所以键名和读写都不在这个文件里 —— 这里只交出「怎么拿到 localStorage」
 * 这一件事,顺带把「探不通就返回 null」那条降级逻辑复用掉。
 */
export function appStorage(): StorageLike | null {
  return storage()
}

function isProfileSlot(v: unknown): v is ProfileSlot {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.profile === 'object' &&
    o.profile !== null &&
    Array.isArray(o.meals)
  )
}

/**
 * 最小结构校验 —— 只验关键字段,避免读到损坏数据后在各处炸开。
 *
 * **不往 `profile` 里面看。** 档案里的字段会继续长(这一版就长了四个),
 * 每加一个就在这里补一行的话,守约会变成一个永远追不上的清单;而它真正
 * 要拦的是「读进来以后在 `state.xxx.map(...)` 上抛」这一类形状问题。
 */
function isAppState(v: unknown): v is AppState {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (
    typeof o.version !== 'number' ||
    !Array.isArray(o.meals) ||
    typeof o.profile !== 'object' ||
    o.profile === null ||
    !Array.isArray(o.profiles) ||
    !o.profiles.every(isProfileSlot) ||
    typeof o.activeProfileId !== 'string' ||
    typeof o.onboarded !== 'boolean'
  ) {
    return false
  }

  // 不变量:`profiles` 里**不含**当前档案(见 types.ts 的 ProfileSlot)。
  // 违反它意味着有人把两份状态写混了 —— store.ts 的 switchProfile 正是为了
  // 不产生这种状态才写成「先查后写」。这里再拦一道:带着它跑下去的话,
  // 之后的编辑会被静默写进错的那一份,而那是看不出来的。
  return !o.profiles.some((slot) => slot.id === o.activeProfileId)
}

/**
 * v7 里的那个「加餐」—— 新表里已经没有这个取值了,所以它只能以字符串的身份
 * 出现在这里。类型上写不成 `MealSlot`,这正是这条迁移存在的理由。
 */
// ⚠️ 显式标成 `string`。标成字面量的话 `m.slot !== LEGACY_SNACK` 会被 TS 判成
// 「两个类型不可能相等」的错 —— 编译器是对的(`MealSlot` 里确实没有它了),
// 而这正是这条迁移要处理的那个**旧数据**,所以只能把宽类型写出来。
const LEGACY_SNACK: string = '加餐'

/**
 * 把一份 v7 的日记录成 v8 —— **只重写 `slot === '加餐'` 的那几条**,其余逐字段原样。
 *
 * 就地按记录自己的 `time` 定位(见 `lib/slots.ts` 的 `slotForClock`):15:30 → 下午加餐、
 * 21:40 → 夜宵。解析不出时间的**留着不动**(`slotForClock` 返回 null 时跳过),
 * 不猜 —— 那种记录本来就该由人来看,不是一次版本迁移能修的。
 *
 * 引用契约和 `stripThumbs` 一样:一条都没改到就返回**原对象/原数组**,
 * 调用方靠这个判断有没有动过。
 */
function migrateMeals(meals: MealEntry[]): { meals: MealEntry[]; changed: number } {
  let changed = 0
  const out = meals.map((m) => {
    if (m.slot !== LEGACY_SNACK) return m
    const next = slotForClock(m.time)
    if (!next) return m
    changed++
    return { ...m, slot: next }
  })
  return { meals: changed === 0 ? meals : out, changed }
}

/**
 * v7 → v8 的迁移 —— 纯函数,便于在 Node 里测(见 `scripts/verify-quota.mjs`)。
 *
 * ⚠️ **每个档案的日记都要过一遍,不只当前这份。** 多档案之后记录散在
 * `state.meals` 和 `state.profiles[i].meals` 两处 —— 只迁前者的话,被切走的那些
 * 档案里会留着新表不认的 `加餐` 取值,而它们**在切回来之前谁都不会去读**:
 * 表现是「切回旧档案,那一餐的餐次显示不出来 / 按餐次分组的格子里少了它」,
 * 而且看起来和这次的改动无关。(和 `stripThumbs` 那段注释是同一个坑。)
 */
export function migrateLegacySlots(state: AppState): AppState {
  const self = migrateMeals(state.meals)
  const profiles = state.profiles.map((slot) => {
    const r = migrateMeals(slot.meals)
    return r.changed === 0 ? slot : { ...slot, meals: r.meals }
  })
  // 版本号一律写成当前值:调完之后内存里那份必须和磁盘上下一次的判据一致,
  // 「什么都没迁到」不等于「还是 v7」
  return { ...state, version: SCHEMA_VERSION, meals: self.meals, profiles }
}

export function loadState(): AppState | null {
  const s = storage()
  if (!s) return null

  try {
    const raw = s.getItem(KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isAppState(parsed)) return null

    if (parsed.version === SCHEMA_VERSION) return parsed
    // 唯一有迁移路径的一版。其余(含比当前新的)一律丢弃 —— 演示数据没有
    // 迁移价值,写一堆用不上的迁移函数不划算
    if (parsed.version === PREVIOUS_VERSION) return migrateLegacySlots(parsed)
    return null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------
   写盘结果
   ------------------------------------------------------------
   原来 saveState 是 `void` 且**静默 catch 一切**。那时候整份状态只有几 KB,
   写失败几乎是理论问题;塞进缩略图之后不再是这样了 —— 一次拍餐盘就给每条
   记录加 8–12KB,配额是会被真正写满的。

   而"写不进去"最坏的后果不是丢一张照片,是**丢整餐的营养数据**:如果那次
   setItem 失败了就到此为止,用户刚记的一餐在内存里是好的、刷新就没了,
   而全程没有任何提示 —— 这正是这个仓库一直在避免的"静默地给出错误结果"。
   ------------------------------------------------------------ */

export interface SaveOutcome {
  ok: boolean
  /**
   * 为了写进去,丢掉了多少条记录的缩略图。
   * 大于 0 = 营养数据保住了、照片没保住 —— 需要告诉用户,但不是故障。
   */
  droppedThumbs: number
  reason?: 'quota' | 'unavailable'
  message?: string
}

/** 剥一列餐次记录上的缩略图。没剥到就返回**原数组** */
function stripMealThumbs(meals: MealEntry[]): { meals: MealEntry[]; dropped: number } {
  let dropped = 0
  const out = meals.map((m) => {
    if (!m.thumb) return m
    dropped++
    // 解构丢键,而不是 `thumb: undefined` —— 后者会留下一个键,
    // JSON.stringify 虽然会跳过 undefined,但内存里的形状和"从没有过"不一致
    const { thumb: _omit, ...rest } = m
    return rest
  })
  return { meals: dropped === 0 ? meals : out, dropped }
}

/**
 * 纯函数,便于在 Node 里测(见 scripts/verify-quota.mjs)
 *
 * ⚠️ **必须把每个档案的日记都剥一遍,不只当前这份。** 多档案之后缩略图散在
 * `state.meals` 和 `state.profiles[i].meals` 两处,只剥前者的话:配额写满时
 * `profiles` 里那些可丢的照片还留着,重试仍然超配额,于是落到下面那个
 * **硬失败**分支报「这一餐没能保存下来」—— 而 README 承诺的是「去掉所有
 * 缩略图重试一次」。表现是「偶尔就是存不进去」,而且看起来和照片无关。
 *
 * 引用契约保持原样:一张都没剥到就返回**原对象**,调用方靠这个判断「没动过」。
 */
export function stripThumbs(state: AppState): { state: AppState; dropped: number } {
  const self = stripMealThumbs(state.meals)

  let dropped = self.dropped
  const profiles = state.profiles.map((slot) => {
    const r = stripMealThumbs(slot.meals)
    dropped += r.dropped
    return r.dropped === 0 ? slot : { ...slot, meals: r.meals }
  })

  if (dropped === 0) return { state, dropped }
  return { state: { ...state, meals: self.meals, profiles }, dropped }
}

export function saveState(state: AppState): SaveOutcome {
  const s = storage()
  if (!s) {
    // 隐私模式 / 禁用存储:整份状态只能活在内存里。这不是一次性的故障,
    // 但界面该说一次 —— 用户有权知道刷新就会丢
    return publish({ ok: false, droppedThumbs: 0, reason: 'unavailable', message: '浏览器不允许本地存储，记录只在本次会话有效。' })
  }

  try {
    s.setItem(KEY, JSON.stringify(state))
    return publish({ ok: true, droppedThumbs: 0 })
  } catch {
    // 十有八九是配额满了(QuotaExceededError)。也可能是别的写失败,
    // 但对用户来说处理方式一样:先试着把最不重要的东西(照片)丢掉再写一次
  }

  const { state: lean, dropped } = stripThumbs(state)
  if (dropped > 0) {
    try {
      s.setItem(KEY, JSON.stringify(lean))
      return publish({
        ok: true,
        droppedThumbs: dropped,
        reason: 'quota',
        message: `存储空间不足，已保存营养数据，但没存下 ${dropped} 张照片。`,
      })
    } catch {
      /* 去掉照片还是写不进去,落到下面报失败 */
    }
  }

  return publish({
    ok: false,
    droppedThumbs: 0,
    reason: 'quota',
    message: '存储空间不足，这一餐没能保存下来。可以到「我的」里清理一些旧记录。',
  })
}

/* ------------------------------------------------------------
   把写盘结果播出去
   ------------------------------------------------------------
   做成一个可订阅的通知,而不是从 saveState 一路 return 到界面 ——
   写盘发生在 store 的 commit 里,离按钮的 onClick 有好几层,
   逐层往上传会把每一个中间函数的签名都染上这个返回值。

   只有**内容变化**才通知,原因有两个:一是订阅方用
   useSyncExternalStore,getSnapshot 返回的引用必须稳定;二是配额写满时
   每一次 commit 都会失败,不比较的话会反复触发同样的提示。
   ------------------------------------------------------------ */

let notice: SaveOutcome | null = null
const noticeListeners = new Set<() => void>()

function publish(outcome: SaveOutcome): SaveOutcome {
  const clean = outcome.ok && outcome.droppedThumbs === 0
  const next = clean ? null : outcome

  const changed =
    (notice === null) !== (next === null) ||
    (next !== null && notice !== null && (notice.ok !== next.ok || notice.droppedThumbs !== next.droppedThumbs))

  if (changed) {
    notice = next
    for (const l of noticeListeners) l()
  }
  return outcome
}

export function getSaveNotice(): SaveOutcome | null {
  return notice
}

export function subscribeSaveNotice(fn: () => void): () => void {
  noticeListeners.add(fn)
  return () => {
    noticeListeners.delete(fn)
  }
}

/** 用户看过了,收起提示 */
export function dismissSaveNotice(): void {
  if (notice === null) return
  notice = null
  for (const l of noticeListeners) l()
}
