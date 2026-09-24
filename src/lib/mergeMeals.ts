/**
 * 一次发了 N 张照片 → 一份结果
 * ===========================================================
 * 一次可以攒最多三张(一张全景 + 一张主食特写 + 一张汤),每张各走一次视觉识别,
 * 然后把结果**合成一餐**:屏上只有一张结果卡、一段营养、一句结论。
 * 这个文件就是那个「合」——纯函数,不碰 DOM、不碰全局状态,可在 Node 里直接测。
 *
 * 两个调用方:**对话页**(发出去的一批)和**首页「拍餐盘」**(选好的一批)。
 * 上限、合成规矩、部分失败那句话都共用这一处 —— 两条路走的是同一段代码。
 *
 * ## 四条规矩,以及它们各自的代价
 *
 * ### 1 · 只有成功的那几张出菜,降级的那几张一张也不出
 *
 * 一张降级 = 本地随机组出来的一盘菜(`recognizeMeal`),**和那张照片毫无关系**。
 * 把它拼进一份真菜里,就是把三道真菜和两道编的菜混成一份看起来完整的结果,
 * 而界面上没有任何东西能把它们分开。所以降级的贡献**整张丢掉**,
 * 由 `partialNote` 说清楚少了几号。
 *
 * 于是「全降级」是另一回事:一张成功的都没有,那就没有真菜可混 ——
 * 这时候整份结果就是**第一张降级出来的那份演示餐盘**,`degradedReason` 照旧,
 * 界面上那条「演示数据」横幅该在还在。三道各不相同的随机餐盘摞在一起没有意义。
 *
 * ### 2 · 同一道菜**合成一道**(2026-09-24 改)
 *
 * 这一条原来写的是「菜**不去重**」,理由是「两张图里都有米饭,现实里最常见的
 * 就是两碗饭、或者同一碗饭拍了两张 —— **机器分不出来**」。用户那天把它推翻了:
 *
 *   「首页入口同一次发的三张图,app是一张一张读的,哪怕这三张图只是同一道食物
 *     的不同角度照片」
 *
 * 他说得对,而原来那条错在**对这批照片的前提判断**上:一次攒三张,
 * 设计意图本来就是**同一餐的几个角度**(一张全景 + 一张主食特写 + 一张汤),
 * 不是三餐。在这个前提下,同一道菜出现在两张里更可能是**同一盘**而不是两盘。
 *
 * 两边的代价也不对称:拼接的代价是三份营养 —— 日记里三条、`nutritionOfItems`
 * 加三次,首页黑卡 / 趋势 / 发给食衡的上下文全跟着错三倍,而且**屏幕上看起来
 * 完全正常**(三道菜嘛);合成一道的代价是偶尔少一道,而那一处用户自己在
 * 分量页或「改一下」面板就能补回来。错了能改的那一边赢。
 *
 * 实现见 `mergeItems`(逐条理由在那边),一句话:键是 `foodId`、克数取最大。
 *
 * ### 3 · 任一张被过敏拦截 → 整份结果就是那张拦截卡
 *
 * 拦截卡是 `items: []` + 一段风险说明。混进去等于把「这盘你不能吃」和
 * 「另外两盘挺正常」并排放,而用户只会看到一张写着菜名的卡片。
 * 安全优先,而且和 `AnalyzingScreen` 那个 `countableItems().length` 的判据一致。
 *
 * ### 4 · N=1 走的必须是同一条路
 *
 * `mergeMeals([one])` 逐字段还原 `one` —— **不是**在开头写一句
 * `if (contribs.length === 1) return contribs[0].meal` 抄近路。抄近路的话
 * N=1 和 N=3 是两段代码,而天天在跑的那段(单张)永远测不到合并逻辑。
 *
 * ## 它**不**带预览图
 *
 * 合并结果里没有 `photoUrl` / `thumbDataUrl`,哪怕只有一张。理由是
 * 「这一餐的那张照片」在合成之后**不成立了** —— 一次三张、每张都有自己的
 * object URL,挑第一张摆在七道菜旁边就是在暗示一个不存在的因果。
 *
 * ⚠️ **这条规矩说的是「这个函数不挑」,不是「调用方不许挂」。** 谁挂、挂哪张
 * 是调用方的事,因为它才知道自己手里有哪几张图、屏上正在显示哪一张:
 *
 *   · 对话页(`ChatScreen`)一张都不挂。用户自己发出去的那几条消息气泡里
 *     已经摆着全部照片了,再从里面挑一张摆到卡片上,等于替用户指认
 *     「这盘菜是这张拍的」—— 而机器分不出来。
 *   · 首页(`plate.ts`)挂**第 1 张成功识别出来的那张**。那条链没有消息气泡,
 *     结果页那个相框是用户的照片**唯一**会出现的对方;不挂的话,拍完一张
 *     照片、结果页上却看不到它。
 *
 * 所以两个调用方都传 `attachPreview: false`(照片不跟着单张结果走),
 * 由调用方自己按下标收着、自己挑、自己撤销挑剩下的那几个 URL。
 * 这个函数从头到尾不知道照片的存在,也就不可能挑错。
 */

import type { RecognizedMeal } from '../store/recognize'
import type { RecognitionOutcome } from '../store/recognizeOne'
import type { MealItem } from '../store/types'

/** 一张没出菜的原因。`why` 缺省 = 「这一张没有了」,不编一个说法 */
interface Gap {
  /** 第几张,**1 起** —— 和用户数照片的顺序一致 */
  index: number
  why?: string
}

/**
 * `degradedReason` 尾巴上那句「，本次为演示数据」要摘掉。
 *
 * 那句话是给**整份结果**用的(「这次结果是演示数据」)。拼进「第 2 张没能识别
 * (……)」里就变成了「第 2 张是演示数据」—— 可这一张根本没进结果,
 * 结果里也没有任何演示数据。同一个字符串在两个位置是两句不同的话。
 */
const DEMO_SUFFIX = '，本次为演示数据'

/** `failed` 那一档的短说法。长句子见下面 `gapOf` 的注释 */
const UNREADABLE = '图片读不出来'

function gapOf(outcome: RecognitionOutcome, index: number): Gap | null {
  switch (outcome.kind) {
    case 'ok':
      return null
    case 'degraded':
      return { index, why: outcome.reason.replace(DEMO_SUFFIX, '') }
    /*
      用一句固定的话,不用 `ImageError.message` 原文。

      那几段原文是**写给单张那条路的**:「这张图片打不开 —— 可能是浏览器不支持的
      格式（如 HEIC），换一张或改用手动记录。」它是要独占一行、带一个「换一张」
      按钮的。塞进一个括号里会得到嵌套括号和一段读不完的句子。
      单张全失败时调用方会把原文完整地摆出来(`mergeMeals` 返回 null),
      所以这句话不是唯一出口。
    */
    case 'failed':
      return { index, why: UNREADABLE }
    case 'cancelled':
      // 用户自己取消的,不编原因 —— 「已取消」摆在这儿像是在报一个故障
      return { index }
  }
}

/**
 * 少了几张、少的是哪几张。
 *
 * 两种说法,不是三种:全都有原因时说「没能识别」,只要有一张说不出原因
 * (被取消的那张)就退回中性的「没有计入」—— 统一一句话,不在一句里
 * 混两种口径。
 *
 * ⚠️ 同原因的**合并成一组**,不逐张重复。三张全断网时逐张写会得到
 * 「第 1 张（连不上识别服务）、第 3 张（连不上识别服务）」—— 同一句话
 * 说两遍,而这张卡上每一行都是要用户读的。分组之后是「第 1、3 张（连不上识别服务）」。
 */
function noteFor(gaps: Gap[]): string {
  const groups: { indexes: number[]; why?: string }[] = []
  for (const g of gaps) {
    const hit = groups.find((x) => x.why === g.why)
    if (hit) hit.indexes.push(g.index)
    else groups.push({ indexes: [g.index], why: g.why })
  }

  const list = groups
    .map((x) => `第 ${x.indexes.join('、')} 张${x.why ? `（${x.why}）` : ''}`)
    .join('、')

  return gaps.every((g) => g.why !== undefined) ? `${list}没能识别，那部分没有计入` : `${list}没有计入`
}

/**
 * 同一道菜只留一道。**键是 `foodId`,克数取最大。**
 *
 * ## 为什么键是 `foodId` 而不是名字
 *
 * 用户要的是「『红烧肉』和『红烧肉（家常）』算同一道」,而 `foodId` 本来就是
 * `normalizeDishName` 的产物 —— 那个函数剥掉的就是括号注释、空白、前缀数量词
 * 和尾部标点(`dishMatch.ts:173`),`web:` / `unmatched:` 前缀里嵌的正是它,
 * 库内 id 也是拿它查出来的。所以按 `foodId` 建键,**他要的那条天然成立**,
 * 不用在这里再写一遍归一化(写两遍 = 早晚分叉出两个「同一道菜」的定义)。
 *
 * 还有一条更硬的理由:**单张图内部 `matchDishes` 早就按 `foodId` 归并过了**
 * (`dishMatch.ts:612-628`,两处 `merged.get(food.id)`)。跨图和图内用同一把尺子,
 * 「同一道菜」才有唯一一个定义。
 *
 * ## 克数**取最大**,和单张内部那条规矩**相反**
 *
 * ⚠️ 这里和 `matchDishes` 那条**必须不一样,别来统一**:
 *
 *   · **同一张照片**里两道菜落到同一个 `foodId` —— 那是**两盘**
 *     (「米饭 150g」和「白饭 100g」),所以要 `+=` 累加。
 *   · **换一张照片**指的是**同一盘**拍了两次 —— 累加就是把它算了两遍,
 *     而那正是这次要修的那个毛病。
 *
 * 取最大的理由:三张里往往有一张拍得最全(全景那张),那一张的估计最接近
 * 真实的量;取平均会在「一张全景 + 两张特写」时被特写拖小,取第一张则完全
 * 取决于用户先点哪张。用户 2026-09-24 定的也是这一条。
 *
 * ## 慎选标记带过去(「低调的赢」)
 *
 * 同一道菜三张里只要有一张判了 `suitable: false`,合并之后就得还是红的 ——
 * 同 `dishMatch.ts` 那个私有的 `carryMark`。不然红标会因为「另一张没那么说」
 * 而消失,而红标正是这个 App 里唯一会拦住用户的东西。
 *
 * ## 顺序 = **第一次**出现的下标
 *
 * `Map` 天然保序。反过来的话,「三张里第一张没认出来的那道菜」会跑到列表末尾,
 * 而用户看到的顺序和他选图的顺序对不上。
 *
 * ## 顺带修掉的一件事
 *
 * 合并之后**每一项的 `foodId` 两两不同**。分量页(`PortionScreen.tsx:193`)和
 * 「改一下」面板(`MealSheet.tsx:367`)今天是拿 `foodId` 当 React key、当档位键的
 * —— 三行同名时它们会**共用一个档位**:点其中一行的「多量」,三行一起变。
 * 去重之后那个毛病也没了(另有一条断言盯着这个不变量)。
 */
export function mergeItems(items: readonly MealItem[]): MealItem[] {
  const merged = new Map<string, MealItem>()

  for (const item of items) {
    const hit = merged.get(item.foodId)
    if (!hit) {
      // 复制一份再进表 —— 别改到调用方手上那些对象(它们还挂在各自的识别结果里)
      merged.set(item.foodId, { ...item })
      continue
    }

    if (item.grams > hit.grams) hit.grams = item.grams

    /*
      `per100g` 和 `source` **同生共死**(见 `MealItem` 的类型注释:「不许空串」),
      所以一起搬。同一道菜在两张图里都查到了营养的话值是同一份 —— 但一张查到、
      一张没查到是可能的(库外菜那条联网的路会失败),那就取查到的那一份。
    */
    if (hit.per100g === undefined && item.per100g !== undefined) {
      hit.per100g = item.per100g
      hit.source = item.source
    }

    // 名字取**第一次**出现的:先到的那张说了算,后到的不覆盖
    if (item.suitable === false) {
      hit.suitable = false
      if (!hit.reason && item.reason) hit.reason = item.reason
    }
  }

  return [...merged.values()]
}

/**
 * 把 N 次识别合成一份结果。**按传进来的顺序**拼菜,**同一道菜合成一道**。
 *
 * @returns 一份都出不来时返回 `null`(全失败 / 全取消 / 空数组)。
 *   调用方据此给一条错误气泡 —— 注意「全是取消」是另一回事,那不该报错。
 */
export function mergeMeals(contribs: readonly RecognitionOutcome[]): RecognizedMeal | null {
  /** 出了菜的那些 —— **只有 ok**,降级那份的菜是编的,不进合并(见文件头第 1 条) */
  const oks = contribs.flatMap((o) => (o.kind === 'ok' ? [o.meal] : []))

  /* ---------- 拦截:一张被拦,整份就是那张拦截卡 ---------- */
  const blocked = oks.find((m) => m.agentReply?.blocked)
  if (blocked) return blocked

  const gaps = contribs.flatMap((outcome, i) => {
    const gap = gapOf(outcome, i + 1)
    return gap ? [gap] : []
  })

  /* ---------- 一张成功的都没有 ---------- */
  if (oks.length === 0) {
    // 全是演示餐盘:取第一份原样交出去 —— 三道随机餐盘摞起来没有意义
    const first = contribs.flatMap((o) => (o.kind === 'degraded' ? [o.meal] : []))[0]
    return first ?? null
  }

  /* ---------- 合成 ---------- */

  /*
    下面这几处 `...(x ? {k: x} : {})` 不是啰嗦,是 N=1 恒等的前提:
    `unmatched` 在「模型看过图但一道菜都没认出来」那条路上是 `[]`、
    在别的路上是数组、在拦截那条路上**根本没有这个键**。无条件写一个
    `unmatched: []` 会凭空给一份本来没有这个键的结果加一个键。
  */
  const unmatched = [...new Set(oks.flatMap((m) => m.unmatched ?? []))]
  const anyUnmatchedKey = oks.some((m) => m.unmatched !== undefined)
  const agentReply = oks.find((m) => m.agentReply)?.agentReply
  const noDishReason = oks.find((m) => m.noDishReason)?.noDishReason

  return {
    slot: oks[0].slot,
    items: mergeItems(oks.flatMap((m) => m.items)),
    engine: 'agent',
    ...(anyUnmatchedKey ? { unmatched } : {}),
    ...(agentReply ? { agentReply } : {}),
    ...(noDishReason ? { noDishReason } : {}),
    ...(gaps.length > 0 ? { partialNote: noteFor(gaps) } : {}),
  }
}
