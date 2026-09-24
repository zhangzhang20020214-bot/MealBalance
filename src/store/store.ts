/**
 * 全局状态 —— 一个极简的外部 store,配 useSyncExternalStore 订阅。
 *
 * 为什么不上 Redux/Zustand:整个应用只有一个状态树、不到十个动作,
 * 引一个状态库只会增加概念负担。这里 40 行就够,而且是标准 React API,
 * 面试时也更好讲清楚。
 */

import { useSyncExternalStore } from 'react'
import { formatTime, todayISO } from '../lib/date'
import { BLANK_PROFILE, DEFAULT_PROFILE } from './defaults'
import { abortProfileWork } from './plate'
import { SCHEMA_VERSION, loadState, saveState } from './persist'
import { quotaAdvice, quotaFor, type QuotaChange } from './quota'
import { buildSeedMeals } from './seed'
import type { AppState, MealEntry, MealItem, MealSlot, MealSource, Profile, ProfileSlot } from './types'
import { clearUnloggedFor } from './unlogged'

/**
 * 首次启动时那个档案的 id。
 *
 * 固定值而不是随机 —— 首屏这份状态可能一次都没落盘(用户直接关掉),
 * 下次打开会重新构造一遍。用一个稳定的 id,`profiles` 里就不会出现
 * 「同一个人的两个随机 id」。
 */
const PRIMARY_ID = 'p-self'

/**
 * 首次启动:优先读盘,读不到就是一份**空档案 + 空日记**。
 *
 * ⚠️ 这里**不再播种演示数据**。原来读不到盘就灌 14 天记录 + 演示档案,
 * 于是「新用户第一次打开」看到的是一个别人的、已经填好的档案 —— 而这一版
 * 的首屏是建档引导。演示数据那条路还在,由引导里的「先用演示档案看看」和
 * 「我的」页的「恢复演示数据」显式触发(见 resetToSeed)。
 *
 * 也**不在这里落盘**:用户什么都没做之前,localStorage 里不该有东西。
 */
function initialState(): AppState {
  const loaded = loadState()
  if (loaded) return loaded

  return {
    version: SCHEMA_VERSION,
    meals: [],
    profile: BLANK_PROFILE,
    profiles: [],
    activeProfileId: PRIMARY_ID,
    onboarded: false,
  }
}

let state: AppState = initialState()
const listeners = new Set<() => void>()

function commit(next: AppState): void {
  state = next
  saveState(state)
  for (const l of listeners) l()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 必须返回稳定引用 —— 直接给 state 本身,commit 时才换新对象 */
export function getSnapshot(): AppState {
  return state
}

/**
 * 订阅整个状态树,派生值由调用方 useMemo 计算。
 *
 * 不在这里提供 selector,是因为 useSyncExternalStore 要求 getSnapshot
 * 返回稳定引用,而 selector 返回新对象会导致无限重渲染 —— 与其在每个
 * 调用点小心 memo,不如把整个 state 给出去,派生逻辑本来就便宜。
 */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/* ------------------------------------------------------------
   动作
   ------------------------------------------------------------ */

export interface NewMealInput {
  slot: MealSlot
  items: MealItem[]
  source: MealSource
  /** 默认今天 */
  date?: string
  /** 默认当前时刻 */
  time?: string
  /**
   * 拍餐盘那张图的缩略图(data URL)。可选 —— 手动记录没有照片。
   * 写入路径有两条(结果页归档、修正面板保存),两条都要带上,
   * 漏一条的表现是「改一下分量照片就没了」。
   */
  thumb?: string
}

/** 记一餐。返回新建的记录,便于调用方拿到 id 后跳转 */
export function addMeal(input: NewMealInput): MealEntry {
  const now = new Date()
  const entry: MealEntry = {
    id: `m-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    date: input.date ?? todayISO(),
    slot: input.slot,
    time: input.time ?? formatTime(now),
    source: input.source,
    items: input.items,
    createdAt: now.getTime(),
    // 条件展开而不是 `thumb: input.thumb` —— 后者会在每条记录上留一个
    // `thumb: undefined` 的键,JSON.stringify 时会被丢掉,但内存里
    // `'thumb' in entry` 是 true,写自检时容易踩
    ...(input.thumb ? { thumb: input.thumb } : {}),
  }
  commit({ ...state, meals: [...state.meals, entry] })
  return entry
}

export function deleteMeal(id: string): void {
  commit({ ...state, meals: state.meals.filter((m) => m.id !== id) })
}

/**
 * 一条记录里**可以改**的两样。
 *
 * ⚠️ **口径是刻意做窄的,不要顺手改成 `Partial<MealEntry>`。**
 * 这不是省事,是这一版最要紧的一条约束:`id / date / time / source /
 * createdAt / thumb` 根本**不在类型里**,于是「编辑一次把别的字段改坏了」
 * 写不出来 —— 它是编译期的事,不靠谁记得传对参数。
 *
 * 最值钱的是 `thumb`:照片因此**天然不会丢**,不是「记得带上」。
 * 对照创建那条路 —— 那里「不传缩略图,用户一改分量照片就没了」是个
 * 被文档记过一次的真坑(MealSheet 的 `initialThumb` 注释、ResultScreen 的
 * 归档注释),而且漏了的表现只是「少一张图」,几乎不会被发现。
 * 编辑这条路把它从「又一处要记得传的参数」变成了类型问题。
 *
 * 只改餐次和菜品是用户定的范围。时间/日期不在里面 —— 加了的话,
 * 「同一天内按 `createdAt` 还是按新 `time` 排」得先回答(见下面 editMeal)。
 */
export interface MealEdit {
  slot: MealSlot
  items: MealItem[]
}

/**
 * 改一条记录 —— **只改 `slot` 和 `items`,其余原样保留**。
 *
 * 返回改完的那一条(调用方拿它当 `onSaved` 的参数),id 不存在时返回 `null`。
 *
 * ⚠️ **`createdAt` 不更新**,这是有代价的决定,代价有两条:
 *
 * · 设成 `Date.now()` 的话,这一行保存后会**当场跳到当天列表的末尾**,
 *   而它旁边印的还是原来的 `slot · time` —— 看起来像记录被挪走了。
 *
 * · 反过来说,**不更新,行就不会动**:把一条「晚餐」改成「早餐」之后,它
 *   仍然待在当天列表原来的位置上,可能排在一条「晚餐」下面而自己写着「早餐」。
 *   (`dayStats` 只按 `createdAt` 排那串平铺的 entries;`MEAL_SLOTS` 分的是
 *   按餐次分的桶,日记页画的正是平铺的那串。)
 *   要修就得改成按餐次重排,而那会一起动到日记、首页和幽灵卡的顺序 ——
 *   为了一个「改完立刻归位」的观感,不值。**接受,并记在这儿。**
 *
 * (顺带记一笔:`createdAt` 两个生产者的语义本来就不一致 —— addMeal 写的是
 * 插入时刻,seed.ts 写的是那一餐的时刻。不碰它在这两套语义下都安全。)
 *
 * ⚠️ **未知 id 是「无事发生」,不抛错** —— 和 `deleteMeal` 的 `filter` 同一个
 * 口径。调用方可能拿着一条刚被别处删掉的 id 进来,那不是程序的错。
 *
 * **不 bump `SCHEMA_VERSION`**:bump 管的是**存储结构**,不是动作集。
 * `persist.ts` 的 `isAppState` 压根不往 `meals` 里面看,这里没有新增
 * 任何被校验的键。先例是 `MealItem.per100g` 那次(见 types.ts 的注释)。
 * —— 所以这次**不会**清掉你已有的记录。
 */
export function editMeal(id: string, edit: MealEdit): MealEntry | null {
  // 先找、再写:id 不存在时连 commit 都不发生
  const before = state.meals.find((m) => m.id === id)
  if (!before) return null

  /*
    **没改就真的不写。** 这一行不是优化,是把上面那条口径落在**写入路径**上 ——
    面板上那颗「未做修改」的置灰按钮只是 CSS(`PrimaryButton` 根本没有
    `disabled` 这个 prop),管不住键盘和「点了一下反正没反应」;
    而后端这一次写是 `JSON.stringify` 整棵 state,含每张 base64 缩略图。

    判据和 InlineField 的 `draftPatch` 是同一条:「没改就不写(否则每次开合
    都是一次落盘)」。同一个仓库里同一件事,不该一处做了一处没做。

    返回 `before`(原来那个对象,引用相等)—— 调用方拿它当 `onSaved` 的参数
    仍然是对的:它就是要保存下来的那一条。
  */
  if (!mealEditIsDirty(before, edit)) return before

  const updated: MealEntry = { ...before, ...edit }
  commit({ ...state, meals: state.meals.map((m) => (m.id === id ? updated : m)) })
  return updated
}

/**
 * 这次编辑到底改没改东西 —— 给「未做修改」那个置灰的保存键用。
 *
 * 为什么值得一个纯函数:它平时住在组件的 `useState` 里,而 SSR 冒烟测试
 * **够不到组件内部状态**,抽出来才断得了(见 scripts/verify-loop.mjs 里那一节)。
 *
 * 为什么不是洁癖:每次 `commit` 都会 `saveState` 把**整棵 state(含每张
 * base64 缩略图)**`JSON.stringify` 一遍。开一次面板什么都没动就落一次盘,
 * 这份钱不该付 —— `InlineField` 那边已经为同一件事立过断言。
 *
 * **只比 `slot` 和 `items[].foodId` / `items[].grams`** —— 因为面板就改得了这几样
 * (`MealEdit` 里也没有别的)。哪天多一个改名之类的入口,这里必须跟着加一项:
 * 漏了的后果是「改了名字 → 判成没改 → 保存键置灰、点了没反应」,
 * 也就是这个仓库点过名的那一类最难查的 bug。
 *
 * **逐项比,不排序。** 代价说清楚:删掉一道菜再原样加回来会被判成「改过」,
 * 保存键可点,写回去的其实是一模一样的数据。接受 —— 没有重排 UI,
 * 这条路只能靠「删了又加」走到;而按内容排序去比要多一份实现,
 * 换来的只是一次多写的落盘。
 */
export function mealEditIsDirty(entry: MealEntry, edit: MealEdit): boolean {
  if (entry.slot !== edit.slot) return true
  if (entry.items.length !== edit.items.length) return true
  return edit.items.some((item, i) => {
    const before = entry.items[i]
    return before.foodId !== item.foodId || before.grams !== item.grams
  })
}

/**
 * 把配额补进一份档案 —— 推导 + 盖上手工覆盖。
 *
 * 只有这一个地方做这件事,于是「改了档案但忘了重算配额」写不出来。
 */
function withQuota(profile: Profile): Profile {
  return { ...profile, quota: { ...quotaFor(profile), ...profile.quotaOverrides } }
}

/**
 * 改当前档案。
 *
 * **无条件重算配额,并盖上 `quotaOverrides`** —— 没有分支,也没有「显式传一个
 * quota 绕过重算」的路。留那条路就会出现第二个能写死配额的地方,而
 * `quotaOverrides` 当场说不清自己代表什么。手工调整的唯一入口是
 * `quotaOverrides`:它能被读、能被撤回、能在界面上解释自己。
 *
 * 所以 `patch` 里就算带了 `quota` 也会被这一行覆盖掉 —— 这是刻意的,
 * 不是漏了。要改某个数就改 `quotaOverrides`(见 QuotaSheet)。
 */
export function updateProfile(patch: Partial<Profile>): void {
  const merged: Profile = { ...state.profile, ...patch }
  commit({ ...state, profile: withQuota(merged) })
}

/**
 * 档案页上「就地改一格」的那一次写 —— 存下来,并算出**要不要问**。
 *
 * 档案页现在有十格可以就地改(见 components/InlineField.tsx),每一格改完都要走
 * 这里。这一段逻辑原来写在 ProfileEditSheet.save() 里,那张面板删掉之后它**不能
 * 只搬进某个组件的注释里** —— 它是所有就地编辑共用的那一次写。写在 store 里,
 * 「改了档案但忘了问」就写不出来(和 withQuota 只此一处是同一个理由)。
 *
 * ⚠️ **顺序不能反:先存再问。** 反过来会留下一个「档案改了、配额却没跟着定」的
 * 中间态;而且「先问」的话,「保留我的」就得自己去把改动撤回来 —— 现在的
 * 「保留我的」是**什么都不做**(点背景关掉也等于保留)。
 *
 * ⚠️ **`before` 取 `state.profile`(store 里的那一刻),不取调用方闭包里的
 * profile。** 这一行是「同一份档案反复改不会反复问」的支点:quotaAdvice 比的是
 * **这一次编辑前后**两次推导值,`before` 一旦取成上一次编辑留下的那份缓存,
 * 第二次调用就会拿一份陈旧的 before 去比,于是同一件事被问第二遍。
 *
 * ⚠️ `after` **不过 `withQuota`**,这不是漏了:quotaAdvice 内部从输入字段重算
 * (见 quota.ts 的 compute),只额外读 `after.quotaOverrides`,完全不看
 * `after.quota`。旧代码也是这么写的。
 */
export function editProfile(patch: Partial<Profile>): QuotaChange[] {
  const before = state.profile
  const after: Profile = { ...before, ...patch }
  updateProfile(patch)
  return quotaAdvice(before, after)
}

/* ------------------------------------------------------------
   多档案
   ------------------------------------------------------------ */

function newProfileId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 切到另一个档案。**每一次都换掉整套日记** —— 每个档案一条独立日记。
 *
 * 两处不能省:
 *
 * 1. **先查后写,找不到就什么都不做。** 写成「先把自己的塞进 profiles、再把
 *    目标的取出来」的话,一旦 id 失效(面板跨过一次切换、那个槽位刚被删),
 *    前半会执行、后半不会 —— `profiles` 里出现同一个 id 的两份,之后
 *    `find` 挑到哪一份看数组顺序,用户的编辑被静默写进错的那一份。而两半
 *    各自都是合法数据,persist 的守卫也看不出来。
 *
 * 2. **作废在途的拍照/识别。** 见 plate.ts 里 `abortProfileWork` 的注释:
 *    一次为 A 做的过敏拦截,产出的记录会落进 B 的日记。
 */
export function switchProfile(id: string): void {
  if (id === state.activeProfileId) return
  const target = state.profiles.find((p) => p.id === id)
  if (!target) return

  abortProfileWork()

  const outgoing: ProfileSlot = {
    id: state.activeProfileId,
    profile: state.profile,
    meals: state.meals,
  }
  commit({
    ...state,
    profile: target.profile,
    meals: target.meals,
    activeProfileId: id,
    profiles: [...state.profiles.filter((p) => p.id !== id), outgoing],
  })
}

/**
 * 新建一个空档案。
 *
 * **不自动切过去** —— 从面板里点「新建」接着就换掉日记,是把一次误触的代价
 * 放大成一整套日记换人。新建完停在列表里,用户自己决定切不切。
 *
 * 返回新 id,给调用方选中/高亮用。
 */
export function addProfile(name = '新档案'): string {
  const id = newProfileId()
  const profile = withQuota({ ...BLANK_PROFILE, name })
  commit({ ...state, profiles: [...state.profiles, { id, profile, meals: [] }] })
  return id
}

/**
 * 删掉一个档案,连同它的日记。
 *
 * **删掉最后一个 = 回到「还没建档」。** 清空日记、基本资料退回空白档案,
 * 并把 `onboarded` 翻回 false —— 路由表随之换回建档引导那一屏(见 App.tsx)。
 *
 * 这里原来写的是「不许删掉最后一个」,理由是「一个档案都不剩的话
 * `AppState.profile` 就没东西可指,而它是全 App 的读写入口」。那个理由仍然
 * 成立 —— 所以答案不是让它变成 0 个,而是让它变回**一开始那一份**:
 * `BLANK_PROFILE`,和首次打开时状态树里躺着的正是同一个对象(它自带一份正常
 * 配额,零配额会让首页渲染出 `NaN%`,见 defaults.ts)。`activeProfileId` 也退
 * 回 `PRIMARY_ID`,于是「清空重来」之后的状态和「第一次打开」逐字相同 ——
 * 同一个人身上不会挂出第二个随机 id。
 *
 * 删当前那个(**还有别的档案时**)要**顺带切走**:`profiles` 里不含当前档案,
 * 所以剩下的第一个就是下一个。切过去同样要作废在途工作。
 */
export function deleteProfile(id: string): void {
  // 只剩当前这一个,而且要删的就是它 —— 整个退回未建档
  // (`profiles` 在这一支里本来就是空的,写出来是让这份状态自解释)
  if (state.profiles.length === 0) {
    if (id !== state.activeProfileId) return

    abortProfileWork()
    // 那份「待补记」草稿指着这个已经不存在的档案了 —— 留着它下次进来会弹一份
    // 谁都不认识的菜。别人的草稿不动（见 clearUnloggedFor）
    clearUnloggedFor(id)

    commit({
      ...state,
      meals: [],
      profile: BLANK_PROFILE,
      profiles: [],
      activeProfileId: PRIMARY_ID,
      onboarded: false,
    })
    return
  }

  if (id === state.activeProfileId) {
    const next = state.profiles.find((p) => p.id !== id)
    if (!next) return
    abortProfileWork()
    clearUnloggedFor(id)
    commit({
      ...state,
      profile: next.profile,
      meals: next.meals,
      activeProfileId: next.id,
      profiles: state.profiles.filter((p) => p.id !== next.id),
    })
    return
  }

  // 删的是别的档案 —— 那它自己攒的草稿跟着走，当前这份的不动
  clearUnloggedFor(id)
  commit({ ...state, profiles: state.profiles.filter((p) => p.id !== id) })
}

/* ------------------------------------------------------------
   重置 —— 两个都**只作用于当前档案**
   ------------------------------------------------------------ */

/**
 * 清空当前档案的记录。其余档案的日记原样不动。
 *
 * 原来这里是「清空所有记录」,而那时候只有一份。多档案之后如果一个按钮
 * 清掉全部,文案会变成「清空全部档案的记录」—— 那是另一个功能,不该藏在
 * 这个位置。
 */
export function clearAllMeals(): void {
  commit({ ...state, meals: [] })
}

/**
 * 把当前档案**整个**换成演示档案 —— 基本资料和日记都换。
 *
 * 两个调用点都是这个语义:引导里的「先用演示档案看看」(用户此刻那份基本
 * 资料本来就是空的)和「我的」页的「恢复演示数据」。所以界面上必须说清
 * 它连基本资料一起换 —— 用户自己填的高血压、忌口会跟着没。
 *
 * 之前这里先调 `clearState()` 再写一份新状态,那是多余的一步:`commit` 本来
 * 就会覆盖落盘。而且多档案之后先清盘再写,中间那一瞬间盘上什么都没有。
 */
export function resetToSeed(): void {
  /*
    这份草稿是**上一个身份**在对话页攒的（`activeProfileId` 不变，换的是
    `profile` 和日记），恢复演示数据之后它已经没有任何意义了。
    按 id 清而不是一律清：别的档案攒的草稿和这一次重置无关（见 clearUnloggedFor）。
  */
  clearUnloggedFor(state.activeProfileId)

  commit({
    ...state,
    meals: buildSeedMeals(),
    profile: DEFAULT_PROFILE,
    onboarded: true,
  })
}

/**
 * 走完建档引导 —— 只翻一个标志位。
 *
 * 引导那三步是直接在 `profile` 上改的(`updateProfile`),所以这里不需要
 * 再带一份数据进来。点「先用演示档案看看」走的是 `resetToSeed`,它自己会置位。
 */
export function completeOnboarding(): void {
  commit({ ...state, onboarded: true })
}
