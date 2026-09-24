/**
 * 「上次识别到的那一餐，要不要补记」—— 那一份草稿
 * ===========================================================
 * 用户在对话页发了几张照片，屏上出了一张结果卡。**这一餐没有被记进日记** ——
 * 他可能只是在问「这餐咸吗」，根本没吃，也可能拍完就退出了。
 *
 * 所以「记不记」这个决定被推迟到**下一次进对话页**：那时弹一句问话，
 * 他有一整晚可以想。这个文件管的就是那份等着被问的草稿。
 *
 * ## 为什么不并进 `AppState`（三条理由，任何一条单独成立就够）
 *
 * 1. **并进去要 bump `SCHEMA_VERSION`，而 `persist.ts` 的 `isAppState` 是白名单
 *    守卫** —— 代价是**清掉用户已有的全部记录**，换来的只是一份草稿的存档位。
 *    演示数据没有迁移价值那句话，在这里是「不值」，不是「不划算」。
 * 2. **它坏掉不该连累整本日记。** 独立 key 坏了大不了不弹这一句问话；
 *    并进 `AppState` 的话，一个类型不对的字段会让整份日记读不出来
 *    （`loadState` 返回 null = 档案和记录一起消失）。
 * 3. **`stripThumbs` 只剥 `meals`。** 多一份带缩略图的载荷，「配额写满时
 *    丢掉照片再试一次」那条路径上就多一个要想清楚的地方 ——
 *    而那份逻辑刚刚才因为「只剥了当前档案」被修过一次（见 `stripThumbs` 注释）。
 *
 * ## 存进去的是「模型说这一餐有哪些菜」——**数**要到记的时候才算（2026-09-24）
 *
 * 这是这个文件里最要紧的一条，而它当天**翻过一次**，写清楚免得下一个人按旧版改。
 *
 * 旧版：存进去的 `items` 是**已经算好的**一份（`normalPortionItems` 把演示路径上
 * 那些 ±15% 的噪声克数换回库里的常见分量），因为「记入日记」要跳过 `/portion`
 * 那一屏直接落盘，弹窗上印的克数就该**是**日记里的克数。
 *
 * 现在不是了。用户当天定的新口径是：**发图那一刻不算营养，等他真要记进日记了
 * 才调食衡去算**（对话里那张卡上一个数字都不印，理由见 `MealResultCard`）。
 * 于是：
 *
 *   · 那份草稿是**一份菜名清单**，`grams` 在这一层没有任何含义 —— 它不上屏
 *     （弹窗上也一个数字都不印），也不落盘（落盘的是食衡算出来的那一份）。
 *     归一化因此**搬走了**：它要保证的那件事现在由「先算再记」保证
 *     （见 `store/logRun.ts` 的 `logUnlogged`）。
 *   · 「不许把 0 kcal 写进日记」这条判据**没变，只是挪到了该管事的地方** ——
 *     从「写草稿时值不值得问」挪到「记录时算出来没有」（见 `worthAsking` 与
 *     记录那条路上的 `countableItems` 闸门）。发图时还没有数，那时判不了。
 *   · 类型上仍然**不需要 `engine` 字段**，理由和旧版一样：真正需要它的那一步
 *     不在这一层（现在它留在 `meal.engine` 上，由调用方决定要不要存小图）。
 *
 * ## 2026-09-24 起有**两个**存档位，按「哪来的」分（`from`）
 *
 * 打字问出来的回答也算一份（用户那天定的：**回答里有菜名就弹**），于是同一个人
 * 可能同时躺着两份：一份是他**拍**的那一餐，一份是他**问**到的那几道菜。
 *
 * 两件事必须记住：
 *
 *   · **两份都要留着**（用户选的，不是我想的）。所以键按来源分
 *     （`KEYS`），`saveUnlogged` 按 `meal.from` 落位 —— 后写的那份**不会**
 *     顶掉先写的那份。`clearUnlogged(from)` 也只清自己那一位。
 *   · **`from` 是必需字段，不是可选。** 它是唯一能把两份分开的东西：
 *     `thumb` 当不了判据（演示路径的照片草稿同样没有 thumb，见 `unloggedFrom`）。
 *     旧形状（没有 `from`）**整份丢掉** —— 沿用下面「形状对不上就整份丢掉」那条
 *     规矩，不加迁移。代价是升级那一刻正躺着的一句问话不再问，符合那个口径。
 *
 * 两份的**输入不同**，这是它们唯一实质的差别：拍的那份由食衡拿存下来的照片
 * 重算（`store/logRun.ts` 的 `computeForLog`），打字那份**没有照片** —— 它把
 * 草稿里的菜名交给食衡（`lib/recognizeAgent.recognizeByNames`），走的是**同一个
 * 工作流的同一个端点**，只是 `files` 是空的。
 *
 * ⚠️ 打字那份的营养**也是食衡算的**，这一点别弄错：库外菜在那条路上一样会走
 * 食衡里「抽取库外菜 → 博查联网搜 → 营养折算」那条链（那个分支的判据是
 * 「有没有库里没有的菜」，不是「有没有图」）。曾经有一版是在本地拿食物库的
 * 常见分量凑一份，那不是食衡算出来的数 —— 用户当天驳回了那个做法。
 *
 * ## 三个读写的存储是**可注入**的
 *
 * Node 里没有 `window`（见 `image.ts` 的 `ImageDeps` 先例）。不注入的话这三个
 * 函数一行都测不到，而它们要处理的全是「不崩、只是不对」的那一类。
 *
 * ⚠️ 读写真失败时（隐私模式 / 配额满）**不播任何提示**，和 `saveState` 相反。
 * 理由是这份草稿不是用户的日记，丢了只是少问一句；为它弹一条「存储空间不足」
 * 会把一次无关紧要的失败说成一次数据损失。
 */

import { formatRelativeDay, formatTime, toISODate } from '../lib/date'
import { MEAL_SLOTS } from '../lib/slots'
import { appStorage, type StorageLike } from './persist'
import type { RecognizedMeal } from './recognize'
import type { RecognitionOutcome } from './recognizeOne'
import type { MealItem, MealSlot } from './types'

/** 这份草稿是哪条路来的，也就是它住在哪个存档位（见文件头那段） */
export type UnloggedFrom = 'photo' | 'text'

/**
 * 两个存档位的键名，都带版本段，和 `mealbalance:v1` 同一个写法。
 *
 * `photo` 那个键**沿用旧名字**，所以老数据不用搬家。这里**没有**
 * `SCHEMA_VERSION` 那套迁移：形状对不上就整份丢掉（见 `parseUnlogged`），
 * 丢的是一句还没问出口的问话，不是谁的数据。
 */
const KEYS: Record<UnloggedFrom, string> = {
  photo: 'mealbalance:unlogged:v1',
  text: 'mealbalance:unlogged-text:v1',
}

export interface UnloggedMeal {
  /** 切档案之后不该在别人名下弹（见 `shouldAskUnlogged`） */
  profileId: string
  /** 这一份是拍的还是打字问来的 —— 决定住哪个位、营养怎么算（见文件头那段） */
  from: UnloggedFrom
  slot: MealSlot
  /**
   * 见文件头第 2 段：**一份菜名清单**。克数和营养在这一层不算 ——
   * 它们由「记入日记」那一刻的食衡那一趟给，落盘的是那一份。
   */
  items: MealItem[]
  /**
   * 200px 缩略图（data URL）。**只有真实识别过（`engine === 'agent'`）才有** ——
   * 演示路径那份餐盘是本地随机组的，和那张照片毫无关系，把照片摆在编出来的菜旁边
   * 就是在暗示这个因果（`recognizeOne.ts` 里那段注释原样适用）。
   */
  thumb?: string
  /** 有值 = 这一份是**演示数据**，弹窗上要挂那条横幅，和结果页口径一致 */
  degradedReason?: string
  /**
   * 识别的时刻。
   *
   * **不参与任何判据**，只给弹窗那一句「12:30 识别到的这几道菜」用。
   * 写下来是因为「要不要问」这件事和它无关 —— 昨天拍的今天照样该问。
   */
  at: number
}

/* ------------------------------------------------------------
   两个判据
   ------------------------------------------------------------ */

/**
 * 这一份**值不值得问**。
 *
 * 判据是「模型报了几道菜」，**不再是「有几道能算出营养的」**（2026-09-24 改）。
 *
 * 旧判据是 `countableItems(...).length > 0`，那时它的用处是拦住一种具体的错：
 * 一份全是库外菜的结果被记进日记，会变成一条 0 kcal 的记录，而弹窗上还写着
 * 「识别到 3 道菜」。**那件事仍然不许发生**，但发图那一刻判不了它了 ——
 * 新口径下那时候根本没有营养（不算了），库外菜和库内菜在屏上长得一样。
 *
 * 所以判据挪到它真正管得着的地方：**记录那一刻**，食衡算完还是
 * `countableItems(...).length === 0` 就不落盘（见 `store/logRun.ts` 的 `logUnlogged`）。
 * 这里只问「值不值得占用户一次注意力」—— 模型报了菜就值得，
 * 哪怕它报的那道菜此刻还查不到营养。
 *
 * 仍然兜住的三种「没什么可问的」：配料表/包装（`items` 是空的）、
 * 过敏拦截（`items` 是空的）、全失败（`mergeMeals` 返回 null，走不到这里）。
 */
export function worthAsking(meal: RecognizedMeal): boolean {
  return meal.items.length > 0
}

/**
 * 现在该不该弹。
 *
 * 只有一条判据：**这份草稿是不是当前这个档案的**。切到 B 再进对话页不该弹
 * A 攒的东西 —— 用户看到的会是一份他不认识的菜，而唯一的操作是把它记进
 * B 的日记。
 *
 * 「问过一次的不再问」不在这里：那条靠 `clearUnlogged()` ——
 * 弹窗关掉就清掉草稿，于是下次读出来是 null。判据只有一处，
 * 免得「已经问过」变成第二个可以撒谎的状态位。
 */
export function shouldAskUnlogged(meal: UnloggedMeal | null, profileId: string): boolean {
  if (!meal) return false
  return meal.profileId === profileId
}

/* ------------------------------------------------------------
   从一次识别结果做出那份草稿
   ------------------------------------------------------------ */

/**
 * 这一批里**第一张识别成功**的那张的缩略图。
 *
 * 为什么要挑「成功的那张」而不是「第 1 张」：发三张时缩略图本来就只能代表其中
 * 一张，但如果第 1 张降级了、菜全来自第 2、3 张，把第 1 张的照片摆在那几道菜
 * 旁边就是在暗示一个不存在的因果 —— 正是 `mergeMeals` 拒绝带预览图的同一条理由。
 *
 * 挑成功的那些至少保证了一件事：**这张照片的菜确实在这张卡上**。
 * 三张全成功时它就是第 1 张。
 */
function firstOkThumb(
  outcomes: readonly RecognitionOutcome[],
  thumbs: readonly (string | undefined)[]
): string | undefined {
  for (let i = 0; i < outcomes.length; i++) {
    if (outcomes[i].kind === 'ok') return thumbs[i]
  }
  return undefined
}

/**
 * 这一批里**每一张识别成功**的那张照片 —— 存起来,留给「记入日记」那一趟。
 *
 * 和 `firstOkThumb` 是两把尺子,别合并:那个挑**一张**给日记页看(挑最前面那张
 * 成功的就够),这个要挑**全部成功的**,因为食衡那一趟是**逐张**去认的 ——
 * 少一张,用户拍的那道菜就白拍了,而且不会有任何提示(他只是看到日记里少了一道)。
 *
 * 只挑 `ok` 的理由和那个函数逐字相同:降级的、取消的、失败的都不带菜,
 * 把它们的照片喂给食衡,等于让模型去认一张**和这份清单无关**的图。
 */
export function okPhotoBlobs(
  outcomes: readonly RecognitionOutcome[],
  blobs: readonly (Blob | undefined)[]
): Blob[] {
  const out: Blob[] = []
  for (let i = 0; i < outcomes.length; i++) {
    if (outcomes[i].kind !== 'ok') continue
    const blob = blobs[i]
    if (blob) out.push(blob)
  }
  return out
}

export interface UnloggedInput {
  /** 合成好的那一份结果（`mergeMeals` 的返回值，非 null） */
  meal: RecognizedMeal
  /** 这一批逐张的归宿 —— 只为了知道哪张图配得上这份结果 */
  outcomes: readonly RecognitionOutcome[]
  /** 逐张的缩略图，**按 `outcomes` 的下标对齐**；某张没算出来就是 undefined */
  thumbs: readonly (string | undefined)[]
  profileId: string
  /**
   * 这一份是哪条路来的。**必填**，没有默认值 —— 默认成 `'photo'` 就是让
   * 打字那条路悄悄落错位（落进照片那个位，顶掉他拍的那一餐）。
   */
  from: UnloggedFrom
  /** 显式传入而不是内部取，理由同 `chatMeal.syntheticEntry` 的 `now`：自检要固定时间 */
  now?: Date
}

/**
 * 做出那份草稿。**不值得问就返回 `null`**（判据见 `worthAsking`）。
 *
 * 纯函数：不落盘、不碰 DOM。落盘那一步由调用方显式调 `saveUnlogged` ——
 * 分开是为了「该不该存」和「存哪儿」各自能被单独断言。
 */
export function unloggedFrom(input: UnloggedInput): UnloggedMeal | null {
  const { meal } = input
  if (!worthAsking(meal)) return null

  // 演示路径上这张图代表不了那份菜，不给 —— 见 UnloggedMeal.thumb 那段
  const thumb = meal.engine === 'agent' ? firstOkThumb(input.outcomes, input.thumbs) : undefined

  return {
    profileId: input.profileId,
    from: input.from,
    slot: meal.slot,
    // 见文件头第 2 段：存的是一份**菜名清单**，克数在这一层不算也不印
    items: meal.items,
    ...(thumb ? { thumb } : {}),
    ...(meal.degradedReason ? { degradedReason: meal.degradedReason } : {}),
    at: (input.now ?? new Date()).getTime(),
  }
}

/* ------------------------------------------------------------
   读写
   ------------------------------------------------------------ */

/**
 * 结构校验 —— 形状不对就返回 null，**从不抛**。
 *
 * 浅校验，和 `isAppState` 同一个口径：只验「读下去会不会在 `.map` / 模板串上
 * 抛」这一级。`per100g` / `source` 这些往深里看的字段不验 —— 那会变成一份
 * 永远追不上的清单（那段注释在 `persist.ts` 里）。
 */
export function parseUnlogged(v: unknown): UnloggedMeal | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>

  if (typeof o.profileId !== 'string') return null
  /* 没有 `from` 的旧形状整份丢掉（文件头「两个存档位」那段说清了代价） */
  if (o.from !== 'photo' && o.from !== 'text') return null
  if (typeof o.slot !== 'string' || !MEAL_SLOTS.includes(o.slot as MealSlot)) return null
  if (typeof o.at !== 'number') return null
  if (o.thumb !== undefined && typeof o.thumb !== 'string') return null
  if (o.degradedReason !== undefined && typeof o.degradedReason !== 'string') return null
  if (!Array.isArray(o.items) || o.items.length === 0) return null
  if (!o.items.every(isMealItem)) return null

  /*
    可选字段**逐个条件展开**，不写 `thumb: o.thumb`。

    后者会在内存里留下一个 `thumb: undefined` 的键（`JSON.stringify` 虽然会跳过它，
    但 `'thumb' in meal` 是 true）—— `store.ts` 的 `addMeal` 为同一件事写过注释，
    自检里也正是拿「这个键在不在」当判据。

    `from` **不是可选字段**，但它照样得出现在这份重建里 —— 这里是一份**白名单**，
    没列出来的字段一个都进不去（文件头 :243-249 那条警告说的就是漏一个的后果：
    不报错，表现是「刷新一次字段静默消失」）。
  */
  return {
    profileId: o.profileId,
    from: o.from,
    slot: o.slot as MealSlot,
    items: o.items as MealItem[],
    at: o.at,
    ...(o.thumb !== undefined ? { thumb: o.thumb } : {}),
    ...(o.degradedReason !== undefined ? { degradedReason: o.degradedReason } : {}),
  }
}

function isMealItem(v: unknown): v is MealItem {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.foodId === 'string' && typeof o.name === 'string' && typeof o.grams === 'number'
}

export interface UnloggedDeps {
  /** 不传 = 用真的 localStorage。传 `null` = 当作「这台机器没有存储」 */
  storage?: StorageLike | null
}

function storeOf(deps?: UnloggedDeps): StorageLike | null {
  return deps && 'storage' in deps ? (deps.storage ?? null) : appStorage()
}

/**
 * 读某一个位上的草稿。
 *
 * 默认 `'photo'` —— 于是 `loadUnlogged()` 仍然读**拍的那份**，调用方不关心的
 * 时候不用管有两个位这件事。
 */
export function loadUnlogged(from: UnloggedFrom = 'photo', deps?: UnloggedDeps): UnloggedMeal | null {
  const s = storeOf(deps)
  if (!s) return null
  try {
    const raw = s.getItem(KEYS[from])
    if (!raw) return null
    return parseUnlogged(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * 写草稿 —— **在它自己那个位上就地覆盖**（见文件头「两个存档位」那段）。
 *
 * 同一个位上，一次新的识别完成就替换掉上一次的：用户说的就是
 * 「上次识别到的**一餐**」（单数）。代价说清楚：同一会话里连拍两批，
 * 第一批没被问过就被覆盖了 —— 这是**保守方向**的丢失，丢的只是一次记入机会。
 *
 * **跨位不覆盖**：打字那份写下去时，拍的那份原封不动（这是用户选的口径）。
 *
 * 签名里没有 `from` 参数 —— 位就是 `meal.from`，分两处传等于给了它一个
 * 可以撒谎的机会（`meal.from` 是 `'photo'` 却写进 `text` 的位）。
 *
 * @returns 写成功没有。调用方**不需要**处理 false（见文件头最后一段）
 */
export function saveUnlogged(meal: UnloggedMeal, deps?: UnloggedDeps): boolean {
  const s = storeOf(deps)
  if (!s) return false
  try {
    s.setItem(KEYS[meal.from], JSON.stringify(meal))
    return true
  } catch {
    return false
  }
}

/** 只清**这一个位** —— 另一个位上的那份（另一个来源）留着 */
export function clearUnlogged(from: UnloggedFrom, deps?: UnloggedDeps): void {
  const s = storeOf(deps)
  if (!s) return
  try {
    s.removeItem(KEYS[from])
  } catch {
    /* 删不掉就删不掉 —— 下次读出来还是那份草稿，最多多问一次 */
  }
}

/**
 * 清掉**属于这个档案**的草稿，别人的留着。
 *
 * `resetToSeed()` 和 `deleteProfile(id)` 用它：前者把当前档案整个换成演示档案
 * （而 `activeProfileId` 不变），后者删掉某一份 —— 两种情况下那份草稿都指向
 * 一个已经不存在的档案了。
 *
 * 判据比「一律清掉」多一个 `profileId` 比较，因为**切档案是来回的**：
 * 在 A 里攒的草稿、切到 B 又删掉 B，不该顺手把 A 的那份也清掉 ——
 * 那会表现成「切回 A 再进对话页，怎么不问了」。
 *
 * **两个位都要看**：这两个调用点的意思是「这个人的东西都不留」，不是
 * 「把上次问的那一份处理掉」。少清一个位，那份草稿会指着一个已经不存在的档案，
 * 表现成「在 B 里问 A 攒的那几道菜」—— 而 `shouldAskUnlogged` 本来正是拦这个的。
 */
export function clearUnloggedFor(profileId: string, deps?: UnloggedDeps): void {
  for (const from of ['photo', 'text'] as const) {
    if (loadUnlogged(from, deps)?.profileId !== profileId) continue
    clearUnlogged(from, deps)
  }
}

/**
 * 弹窗上那句时间前缀：`今天 12:30` / `昨天 12:30` / `9月16日 12:30`。
 *
 * 两个格式化函数都是现成的（日记页也在用同一对），这里只是把它们拼起来。
 * 放这儿而不是写在组件里，是为了让「今天/昨天/更早」三种情形有一处可断言的定义。
 */
export function unloggedWhen(at: number): string {
  const d = new Date(at)
  return `${formatRelativeDay(toISODate(d))} ${formatTime(d)}`
}
