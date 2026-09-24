/**
 * 对话页里「那一餐」的两件纯计算
 * ===========================================================
 * 都是纯函数,不碰 DOM、不碰全局状态 —— 理由和 `speech.ts`、`mergeMeals.ts`
 * 一样,而且是同一个:`renderToStaticMarkup` 不跑 effect、也点不动任何东西,
 * 对话页那条路上能断言的只有这一层。放在组件里就等于没有断言。
 *
 * 两件事各有一处「不写下来下一个人一定会写错」的地方:
 *
 *   1. `syntheticEntry` —— 那条记录**只进 query,永远不落盘**。
 *   2. `mealVerdict`    —— 四个分支的**顺序**就是优先级,不能换。
 */

import { toISODate, formatTime } from './date'
import { quotaBasis, type QuotaKey } from '../store/quota'
import type { RecognizedMeal } from '../store/recognize'
import type { MealEntry, Nutrition, Profile, Quota } from '../store/types'

/* ============================================================
   1 · 把刚认出来的这一餐塞进发给 agent 的上下文
   ============================================================ */

/**
 * 刚认出来的这一餐 —— 拼成一条**临时的**日记记录。
 *
 * ## 它只进 query,永远不落盘
 *
 * 用户随图打的那句话是个**真正的提问**(「这餐咸吗」),而 agent 手上的当天
 * 摄入是**归档之前**的 —— 这盘菜还没进日记。不塞这一条,食衡会拿一份少了
 * 这盘菜的数据去回答「这餐咸吗」,而且答得理直气壮。
 *
 * 所以它是一次性的上下文补充,不是一条待归档的记录:
 *
 *   · 它**不进 store**、不写 localStorage、`publish` 那条路一个字都不碰 ——
 *     `buildAgentQuery` 只是把数组遍历一遍读走 `items`。
 *   · 用户要不要把它记进日记是**下次进对话页时那个弹窗**问的事
 *     (见计划的第 5 条)。这里替用户做了这个决定,就等于把「记不记」
 *     从「他可以想一晚上」变成「他已经记了」。
 *   · `source: '拍餐盘'` 不是「已归档」的意思,是这个字段只有那两个取值 ——
 *     写 `'手动记录'` 才是真的撒谎。
 *
 * ## 为什么不带 `thumb`
 *
 * 缩略图是**给日记页渲染的**。这条记录不会被渲染,带上它只是把一份 8~12KB
 * 的 base64 塞进每次提问的 query 里 —— 而 query 是要发给第三方的。
 *
 * ## ⚠️ 现在**应用里没有调用方**(2026-09-23)
 *
 * 它原来只有一处调用:拍图那条路拿随图打的那句话**再问一趟**时,把刚认出来的
 * 这一餐补进 query。那天起那句话跟图**一起发一趟**,由同一次调用回答
 * (见 `ChatScreen.sendPhotos` 里 `text: input` 那段),这处调用就没了。
 *
 * 函数和它那一节自检**都留着**:它不是为那一次调用写的,是为「手上有一条还没
 * 归档的餐、而用户问的就是这一餐」这件事写的 —— `agentContext` 那份 query 里
 * `todayIntake` 少一盘菜,答案会错得很自信。哪天又出现这种提问,别在现场重写
 * 一遍(那一遍十有八九会落盘,而落盘就是替用户做了「记进日记」这个决定)。
 *
 * @param now 显式传入而不是内部取,理由同 `agentContext.ts` 的 `now?: Date`:
 *   自检里要能固定时间做断言。
 */
export function syntheticEntry(meal: RecognizedMeal, now: Date = new Date()): MealEntry {
  return {
    // 只活在这一次 query 里,不会和任何已归档记录的 id 相遇
    id: 'chat-pending-meal',
    date: toISODate(now),
    slot: meal.slot,
    time: formatTime(now),
    source: '拍餐盘',
    items: meal.items,
    createdAt: now.getTime(),
  }
}

/* ============================================================
   2 · 这一餐之后,今天最该说出来的一句话
   ============================================================ */

/** 「今天这一项用得差不多了」—— 和首页钠那一格转琥珀色是同一个数(`HomeScreen`) */
const NEAR_CAP = 0.8

/** 「蛋白质还差得远」—— 到一半以下才值得单说一句 */
const PROTEIN_LOW = 0.5

export interface VerdictInput {
  /** 这一餐自己算出来的营养(`nutritionOfItems(meal.items)`) */
  meal: Nutrition
  /** 今天**不含这一餐**已经记下的合计(`dayStats(...).nutrition`) */
  before: Nutrition
  quota: Quota
  /**
   * 档案 —— 给了就在结论句后面缀一行「依据 · 高血压 → 钠上限 1500mg」。
   *
   * ⚠️ **可选,而且这里是有意为之。** 结论句里每一个「上限/配额」都是当前档案
   * 算出来的,用户读不出它是谁定的,所以真实调用点(`ChatScreen`)必须传 ——
   * 有一条源级断言盯着这件事(见 verify-render 里那句「ChatScreen 把 profile
   * 递给了 mealVerdict」)。
   *
   * 那为什么不写成必填、让「忘传」变成一个类型错误?因为断言里那四条夹具用的是
   * **一组手写的 `verdictQuota`**,刻意不等于任何真实档案(见那里的注释:期望值
   * 要写死,才验得出「谁赢」)。硬凑一个 profile 出来,依据行会印着**另一个**
   * 分母的数字 —— 而这一节要断言的只有「哪一句被说出口」。
   */
  profile?: Profile
}

const pct = (v: number, cap: number) => Math.round((v / cap) * 100)

/**
 * 结论句后面那一行依据。**不传档案就是空串**,不是「依据 · 」这样的半句。
 *
 * 和对话页本地应答那边(`localAnswer.ts` 的 `basisLine`)同一个形状:两个 `\n`
 * 开头,`依据 · ` 起头,由 `ChatTranscript` 的 `splitBasis` 摘出来渲染成小字。
 * 两处各自实现是没办法的事(一个在 lib、一个在 store,拼的项数也不同),
 * 但**前缀和换行必须一模一样** —— 不然同一个气泡里会有一个摘得到、一个摘不到。
 */
function basisSuffix(profile: Profile | undefined, key: QuotaKey): string {
  return profile ? `\n\n依据 · ${quotaBasis(profile, key)}` : ''
}

/**
 * 一句话:这一餐吃下去之后,今天哪一项最该提。
 *
 * ## 四个分支的**顺序就是优先级**,别调
 *
 *   钠 → 糖 → 蛋白 → 热量。
 *
 * 它们**不是互斥的** —— 一盘红烧肉加一碗饭完全可能同时把钠和糖都推到 80%
 * 以上,还顺手让蛋白质不达标。所以第一个 `if` 赢的那个就是答案,顺序变了
 * 答案就变了(`verify-loop` 里四条断言各自构造了一个「后面的分支也成立」的
 * 输入,换顺序第一批就红)。
 *
 * 顺序的**理由**是「哪一项最可能要用户当场做点什么」:
 *
 *   · 钠排第一 —— 它是唯一一个用户**当餐就能补救**的(汤底别喝完、下一餐
 *     清淡点),而且超标的后果是当天的。
 *   · 糖第二 —— 控糖是档案里的目标之一,但「这一餐糖多了」很少是当餐能改的。
 *   · 蛋白第三 —— 它是**没吃够**才说,和上面两条「吃多了」方向相反,所以
 *     排在所有「已经吃多了」的后面:一个人钠超标又蛋白不足时,先听到该是钠。
 *   · 热量兜底 —— 前三条都不成立时,至少把这一餐的量级说出来。
 *
 * ## 不编数字
 *
 * 「这餐钠 Xmg」里的 X 是**这一餐自己**的,「今天已经到上限的 Y%」里的 Y 是
 * **今天合计**的。两个数字各说各的,不能拿一个去凑另一个 —— 卡片上那几行
 * 热量也是这个口径(`MealResultCard` 用同一个 `nutritionOfItem`)。
 *
 * 上限为 0 的项直接跳过:那会算出 `Infinity%` 这种一眼假的数字。
 *
 * ## ⚠️ 现在**应用里没有调用方**(2026-09-24)
 *
 * 它原来只有一处调用:`ChatScreen.sendPhotos` 里发完图之后追加的那句结论句。
 * 那天用户定了新口径 —— **发图不算营养,要记进日记时才调食衡算** —— 于是发图
 * 那一刻屏上**一个数字都没有**,这句话就没有输入了(库外那道菜会让它说出
 * 「这餐 0 kcal,占今天配额的 0%」,一个长得像结论的错数字)。
 *
 * 留着而不是删掉,同样是 `syntheticEntry` 那个理由:它是为「手上有营养时那句话」
 * 写的 —— 现在营养在**记录那一刻**算出来了(`store/logRun.ts` 的 `computeForLog`),
 * 将来要把这句话摆在别处(日记页那条新记录上),它会原样用得上。
 * 那一节自检也留着(`verify-loop` 里四条优先级断言),跟着代码一起跑。
 */
export function mealVerdict({ meal, before, quota, profile }: VerdictInput): string {
  const sodium = before.sodium + meal.sodium
  if (quota.sodium > 0 && sodium / quota.sodium >= NEAR_CAP) {
    return (
      `这餐钠 ${Math.round(meal.sodium)}mg，今天已经到上限的 ${pct(sodium, quota.sodium)}%。` +
      basisSuffix(profile, 'sodium')
    )
  }

  const sugar = before.sugar + meal.sugar
  if (quota.sugar > 0 && sugar / quota.sugar >= NEAR_CAP) {
    return (
      `这餐添加糖 ${Math.round(meal.sugar)}g，今天已经到上限的 ${pct(sugar, quota.sugar)}%。` +
      basisSuffix(profile, 'sugar')
    )
  }

  const protein = before.protein + meal.protein
  if (quota.protein > 0 && protein / quota.protein < PROTEIN_LOW) {
    // `Math.max(0, …)` 不是防御性编程:浮点相加之后 `quota - protein` 可能是
    // -0.0000001,写出来就是「还差 -0g」
    return (
      `这餐蛋白质 ${Math.round(meal.protein)}g，今天还差 ${Math.round(Math.max(0, quota.protein - protein))}g。` +
      basisSuffix(profile, 'protein')
    )
  }

  const kcal = before.kcal + meal.kcal
  if (quota.kcal > 0) {
    return (
      `这餐 ${Math.round(meal.kcal)} kcal，占今天配额的 ${pct(kcal, quota.kcal)}%。` +
      basisSuffix(profile, 'kcal')
    )
  }

  /*
    连热量上限都没有(理论上不会发生)时,只报这一餐自己的量 —— 不拿一个
    没有分母的百分比凑数。

    ⚠️ **这一句没有依据,而且是对的**:它一个配额数字都没引用,所以没有任何
    「档案里的哪一条」可引。给它硬凑一句「依据 · 基础信息 → 热量目标 0kcal」
    就是把一个不存在的分母说成依据 —— 同 `deriveAdvice` 里蔬菜那条不写 basis
    的理由。
  */
  return `这餐 ${Math.round(meal.kcal)} kcal。`
}
