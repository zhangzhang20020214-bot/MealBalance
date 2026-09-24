/**
 * 餐盘识别 —— 演示实现
 * ===========================================================
 * ⚠️ 这里**没有真的做图像识别**。
 *
 * 真实识别应当由 Dify 的 agent 完成(图片交给多模态模型,返回菜品与分量)。
 * 但那需要 API Key,而打开这个演示链接的人并没有 Key —— 所以这里实现的是一份
 * **本地降级**:按餐次模板从食物库里组出一份合理的餐盘,让
 * 「拍餐盘 → 分析 → 归档 → 首页数字变化」这条链路在没有后端时也能真跑通。
 *
 * 接真实识别时,把 recognizeMeal() 换成 fetch('/api/recognize'),并保留本函数
 * 作为 catch 分支即可 —— 返回值结构一致,调用方一行都不用改。
 *
 * 另一处刻意的设计:识别结果**不是写死的三道菜**,而是每次由食物库随机组合。
 * 所以同一个人连点两次「拍餐盘」会得到不同的餐盘、不同的分数、不同的建议 ——
 * 这是判断「数据是真的在流动」还是「只是几张会动的设计稿」最直接的方式。
 */

import type { AgentReply } from '../lib/agentReply'
import { FOOD_BY_ID } from '../data/foods'
import { currentSlot, isSnackSlot } from '../lib/slots'
import type { MealItem, MealSlot } from './types'

export interface RecognizedMeal {
  slot: MealSlot
  items: MealItem[]
  /**
   * 0-1。
   *
   * ⚠️ **可选,而且真实链路永远不填** —— agent 的返回契约里根本没有这个字段
   * (见 agentReply.ts 的 `AgentReply`:blocked / risk / mode / title / dishes /
   * advice / disclaimer,没有 confidence)。原来这里填的是
   * `0.82 + Math.random()*0.14`,结果页把它渲染成「置信度 87%」——
   * 那个数字是随机数,和识别质量没有任何关系。
   *
   * 改成可选而不是删掉:模型哪天真的开始返回置信度(提示词加一个字段的事),
   * 有值就显示。**没有就不显示,不编一个数补上。**
   */
  confidence?: number
  /** 'demo' = 本地降级, 'agent' = 真实模型返回 */
  engine: 'demo' | 'agent'
  /**
   * 预览用的 object URL(压缩后那份)。
   *
   * **生命周期归调用方管**(首页那条链是 src/store/plate.ts)—— 只有拿着它的
   * 那一个模块 revoke 它。两个地方各自 revoke 会撞上「一方撤销、另一方还在
   * 渲染」的经典白图。`attachPreview: false` 时这个字段**根本不出现**,
   * 见 `src/store/recognizeOne.ts`。
   */
  photoUrl?: string
  /** 归档时写进日记的 200px 缩略图(data URL)。原图不落盘,见 image.ts */
  thumbDataUrl?: string
  /**
   * 模型说了、食物库里没有、**联网也没查到的**菜名。
   *
   * 「联网也没查到」这半句不能省:库里没有的菜现在分两种,查到了营养的那些
   * (带 `web:` 前缀)有值、界面上标着出处,**不该出现在这个数组里** ——
   * 这个数组会渲染成「这 N 项不在食物库里,暂时按 0 计」,把一道有真实营养值的
   * 菜写进去就是对着一个正确的数字说它按 0 计。
   *
   * 这个字段是**诚实性要求**,不是锦上添花:`nutritionOfItems` 对未知 foodId
   * 按 0 计且不抛错,所以不显式告知的话,用户会拿到一个悄悄偏低的热量和
   * 一个悄悄偏高的健康分,而界面上看不出任何异常。
   */
  unmatched?: string[]
  /**
   * agent 的原始解析结果。
   *
   * 用来复用现成的 `AgentReplyCard` 渲染**过敏拦截卡** —— 拦截分支里
   * `dishes` 是空的(items 也是空的),结果页那套「菜品 + 营养」的 UI 没东西
   * 可渲染,自己再写一套拦截界面就等于把同一件事维护两遍。
   *
   * 风险等级也在里面(`agentReply.risk`),所以这里**不再单独放一个 risk 字段** ——
   * 同一个信息有两个来源,早晚会不一致。
   */
  agentReply?: AgentReply
  /**
   * 模型看过图了,但没认出菜品 —— 这里是它的原话。
   *
   * 和 `degradedReason` 是**两件完全不同的事**,不能合并:
   *   · degradedReason → 请求根本没到模型(没 Key / 断网),下面那些菜是本地随机组的
   *   · noDishReason   → 模型真的看了这张图,只是图里没有它认得出的菜
   * 前者要说「这是演示数据」,后者要说「没认出来」。混成一句就会出现
   * 「演示数据」配一张真实照片这种自相矛盾的界面。
   *
   * 这个状态实测会出现:一张纯色方图走真实链路,模型回「未知菜品 (图片无法识别)」。
   */
  noDishReason?: string
  /**
   * 用户走过了「确认分量」那一步没有。
   *
   * 结果页要靠它决定菜品卡的头部怎么写 —— 走过才写「分量由你选择」,没走过
   * 就保持原来的「可修正」。**必须分开**,因为「全都没收录进食物库」和
   * 「过敏拦截」这两条路会**跳过**分量确认,却仍然渲染同一张卡;不区分的话
   * 就是在说一件没发生过的事。
   *
   * 这个标记**只活在内存里**:`RecognizedMeal` 是一份还没归档的草稿,刻意
   * 从不落盘(见下面 pending 那段)。所以它不碰任何持久化类型,不用 bump
   * SCHEMA_VERSION —— 分量本身是写进 `items[].grams` 的,那才是唯一真相。
   */
  portionConfirmed?: boolean
  /**
   * 这次为什么退回本地模拟(没配 Key / 连不上 / 上游报错)。
   * 有值就说明**结果是演示数据**,界面必须说出来。
   */
  degradedReason?: string
  /**
   * 一次发了多张、其中几张没出菜 —— 少的是几号、为什么。
   *
   * ⚠️ **和 `degradedReason` 是两件事,不能合并**:
   *   · degradedReason → 这一份结果**整份是编的**(请求根本没到模型)
   *   · partialNote    → 这一份结果是**真的**,只是少了一部分(三张里废了一张)
   *
   * 把「三张里有一张没成」写成 `degradedReason`,等于**把一整份真菜标成演示数据** ——
   * 用户会以为屏幕上那三道菜也是编的,然后把它删掉。这个字段存在的唯一理由
   * 就是不让那件事发生。
   *
   * 只有对话页那条路会产生它(见 `src/lib/mergeMeals.ts`);单张识别永远没有。
   */
  partialNote?: string
}

/* ------------------------------------------------------------
   按餐次组织的候选菜品
   ------------------------------------------------------------ */

const POOLS = {
  breakfast: {
    staple: ['congee', 'oatmeal', 'whole-wheat-bread', 'mantou', 'xiaolongbao', 'sweet-potato', 'corn'],
    protein: ['boiled-egg', 'fried-egg', 'milk', 'soy-milk', 'yogurt'],
  },
  main: {
    // 荤菜池里既有一餐 300mg 钠的清蒸鱼,也有 700mg 的回锅肉 ——
    // 不刻意避开高钠项,否则永远看不到危险态,也就看不出分级到底在做什么
    protein: [
      'braised-ribs',
      'kungpao-chicken',
      'boiled-chicken',
      'roast-drumstick',
      'tomato-egg',
      'pepper-pork',
      'twice-cooked-pork',
      'steak',
      'braised-beef',
      'steamed-fish',
      'boiled-shrimp',
      'salmon',
      'boiled-fish-spicy',
      'braised-pork',
    ],
    veg: ['lettuce-stir', 'spinach-garlic', 'broccoli', 'cucumber-salad', 'green-beans', 'mapo-tofu', 'stir-veggies'],
    staple: ['rice', 'brown-rice', 'noodles', 'mantou', 'corn', 'sweet-potato'],
    soup: ['seaweed-egg-soup', 'tomato-beef-soup', 'wintermelon-soup'],
  },
  snack: {
    fruit: ['apple', 'banana', 'orange', 'grape', 'blueberry'],
    extra: ['yogurt', 'chips', 'cake', 'chocolate', 'peanut', 'latte', 'americano', 'cola', 'bubble-tea'],
  },
} as const

/* ------------------------------------------------------------
   取菜
   ------------------------------------------------------------ */

/** 从池子里不重复地抽 n 个 */
function draw(pool: readonly string[], n: number): string[] {
  const copy = [...pool]
  const out: string[] = []
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0])
  }
  return out
}

/**
 * 一份的克数。
 * 在常见分量上浮动 ±15% 并取整到 5g —— 识别本来就是个估算,
 * 给出「150g」这种整数比「152g」更诚实,也更像真实的估算输出。
 */
function portion(foodId: string): number {
  const base = FOOD_BY_ID.get(foodId)?.defaultGrams ?? 100
  const jittered = base * (0.85 + Math.random() * 0.3)
  return Math.max(10, Math.round(jittered / 5) * 5)
}

function toItems(ids: string[]): MealItem[] {
  return ids.map((foodId) => ({
    foodId,
    name: FOOD_BY_ID.get(foodId)?.name ?? foodId,
    grams: portion(foodId),
  }))
}

/** 按餐次组一份餐盘 */
function compose(slot: MealSlot): MealItem[] {
  if (slot === '早餐') {
    // 主食 1 + 蛋奶豆 1~2,偶尔加个水果
    const ids = [...draw(POOLS.breakfast.staple, 1), ...draw(POOLS.breakfast.protein, Math.random() < 0.5 ? 1 : 2)]
    if (Math.random() < 0.35) ids.push(...draw(POOLS.snack.fruit, 1))
    return toItems(ids)
  }

  // 三顿加餐(上午加餐 / 下午加餐 / 夜宵)共用这一池 —— 判据是「是不是加餐」,
  // 不逐档写一遍:`isSnackSlot` 只有一处定义,再长出第四档加餐时这里不用改
  if (isSnackSlot(slot)) {
    return toItems([...draw(POOLS.snack.fruit, 1), ...draw(POOLS.snack.extra, 1)])
  }

  // 午餐 / 晚餐:一荤 + 一素 + 主食,晚餐概率再多一道素菜和一碗汤。
  // 菜的**道数**刻意不固定 —— 固定三道菜看起来就像模板,不像识别结果。
  const ids = [...draw(POOLS.main.protein, 1), ...draw(POOLS.main.veg, slot === '晚餐' && Math.random() < 0.5 ? 2 : 1)]
  ids.push(...draw(POOLS.main.staple, 1))
  if (Math.random() < 0.3) ids.push(...draw(POOLS.main.soup, 1))
  return toItems(ids)
}

/**
 * 本地模拟识别一份餐盘。
 *
 * 这是**降级路径**,真实链路走 `src/lib/recognizeAgent.ts`(图片交给视觉模型)。
 * 两种情况会退到这里:没配 Dify Key(面试官打开链接时就是这种)、或者请求失败。
 * 无论哪种,结果都会带上 `degradedReason`,界面据此标注「演示数据」。
 *
 * **必须保持同步。** `scripts/verify-loop.mjs` 在一个循环里连着调 200 次并
 * 立刻断言返回值,改成 async 会把这个自检整个打散。异步编排放在 plate.ts 里,
 * 这一层只负责「按餐次组一份合理的餐盘」这一件纯计算的事。
 */
export function recognizeMeal(slot: MealSlot = currentSlot()): RecognizedMeal {
  return {
    slot,
    items: compose(slot),
    engine: 'demo',
    // 刻意不给 confidence —— 见 RecognizedMeal 上那段注释
  }
}

/* ------------------------------------------------------------
   待归档的分析结果
   ------------------------------------------------------------ */

/**
 * 识别结果从「分析中」传到「分析结果」页的临时中转。
 *
 * 只放在内存里,不进 localStorage —— 它是一份还没被用户确认的草稿,
 * 持久化它会让「刷新后又冒出上次没归档的结果」变成一个新的困惑点。
 * 刷新丢掉了就在结果页给一个明确的空状态,而不是白屏。
 */
let pending: RecognizedMeal | null = null
const listeners = new Set<() => void>()

export function setPending(next: RecognizedMeal | null): void {
  pending = next
  listeners.forEach((l) => l())
}

export function getPending(): RecognizedMeal | null {
  return pending
}

export function subscribePending(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
