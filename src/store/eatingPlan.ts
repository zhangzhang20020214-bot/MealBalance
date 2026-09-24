/**
 * 怎么吃 —— 结果页那张卡的规则:一行一道菜,顺序和份量并排,建议挂到它指名的那一行上
 * ============================================================
 * 用户的原话:
 *
 *   「就是可以在推荐某道菜顺序的时候顺便推荐这道菜进食多少的建议,健康建议也可以
 *     看看怎么适当合并,然后依据高血压这种,这个高血压可以做个角标放右上角,让人
 *     一眼就能看出这是根据高血压来给的建议」
 *
 * 改之前,这三件事分在**三张卡**上,而且互相不照面:顺序卡说次序、多少卡说份量 ——
 * 两张卡列的是**同一盘菜、同一个序号**(屏上有断言守着),却硬生生分在两处;
 * 建议卡压在最下面,它说「主要来自『红烧排骨』」的时候,那道菜已经在上面两屏之外了。
 *
 * 现在是一张卡:**一行一道菜**,顺序和份量在同一行;**指名到某道菜**的建议挂在那一行
 * 下面;**整餐级**的留在卡尾;依据变成每条建议右上角的一个角标(角标不在这里,
 * 在 `ResultScreen.tsx` 的 `ADVICE_TONES`,这里只管**摆放**)。
 *
 * ## 为什么是第三个模块,而不是写进那两张卡自己的模块里
 *
 * `eatingOrder.ts` / `eatingAmount.ts` **不改**,而且合并之后它们**仍然在岗**:
 * `rows` 的 `note` 来自 `deriveEatingOrder`、`tag` / `tone` / `amount` 来自
 * `deriveEatingAmount`。这个模块只干**摆放**这一件事,它一分规则都不新造。
 * 所以那两个文件各自的对外行为和它们各自的断言一条都不用动,也不会留下死代码。
 *
 * 合并能成立靠的是一个核对过的结构事实:`src/data/foods.ts` 的 58 条 id 与
 * `src/data/guideline.ts` 的 58 个键**逐项相同**(两个方向的差集都是空)。所以
 * 「有顺序、没份量」和「有份量、没顺序」这两种菜**一道都不存在**,两张卡的行集合
 * 与行序本来一致 —— 合并是把**两份已经对齐的列表拉直**,不是拿两张不一样的表硬凑。
 *
 * ## `rows` 的行有两个来源:库内菜来自 `deriveEatingAmount`,库外菜由这里补
 *
 * 行数是**这一盘的道数**,一道不多一道不少 —— 这是用户原话那条规矩
 * (「进食顺序建议中任何一个菜都不要遗漏」)在这一屏上的最终形态,也是这个模块
 * 存在的理由。两半的来源不同:
 *
 *   · **库内菜**(`GUIDELINE_BY_ID` 查得到) —— 次序和档位都来自
 *     `deriveEatingAmount`。两张卡的入场判据**故意不同**(见 `eatingAmount.ts`
 *     文件头):顺序卡要**档数 ≥ 2**(一道菜没有「顺序」可言,米饭 + 馒头排出来的
 *     「① 米饭 ② 馒头」不是建议、是噪音),而这张卡**一道菜也出** ——
 *     「我就盛了一碗面」正是要问「这一碗是多还是少」。
 *   · **库外菜**(联网估算的 `web:` / 库里也没有的 `unmatched:`) —— 由本文件
 *     追加,见下面「库外菜也有行」那一节。
 *
 * ⚠️ **代价,以及为什么接受它:`eatingOrder.ts` 说米饭 + 馒头那两行是噪音,
 * 合并之后这张卡上会出现那两行。** 那不是把它的判据推翻了 —— 那句话说的是
 * 「它们没有**顺序**」,而这张卡每一行的主语是「**吃多少**」(米饭 适量吃 一小碗,
 * 约一拳),序号只是行号。份量那张卡今天就是这么渲染的,一行不多一行不少。
 *
 * 于是 `note` 是**可以缺席**的:档数不足两档时 `deriveEatingOrder` 返回空数组,
 * 每一行就只剩份量。渲染方按 `row.note === undefined` 决定第二行写不写那个
 * 「· 」分隔符。**这是「这道菜没有顺序可说」,不是「顺序算错了」** —— 别给它补一个
 * 「随餐」兜底。
 *
 * ## `note` 按**菜名**对齐 —— 唯一可行的办法,以及它的口径
 *
 * `MealItem` 没有 `id`(`types.ts`),`OrderStep` / `AmountStep` 也都只有 `name`,
 * 所以对齐只能按名字。
 *
 * ⚠️ 两处按名字对齐,**口径不一样,是故意的**:
 *
 *   · `note` 是**查表**(菜名 → 说明词)。一排里两道同名菜时**两道都会拿到同一句**
 *     说明 —— 它们确实是同一道菜,顺序说明也该一样。
 *   · 挂建议的 `indexByName` 是**首匹配**(同名时建议挂到靠上那一道),因为那是
 *     「挂到哪一行」,一条建议只能挂一处。口径和 `restrictionHit` 的
 *     `items.find(...)` 一致。
 *
 * 别把第一处也改成首匹配:`rows` 是按 `deriveEatingAmount` 出的,第二道同名菜
 * 照样有一行,而那一行会变成一个**光秃秃的、只剩份量的行** —— 看起来像
 * 「这一道没有顺序可说」,其实是第一道把说明词独占了。
 *
 * ⚠️ 判据是菜名**完全相等**,不是子串 —— 和 `advice.ts` 里 `at` 那条同一条理由:
 * 用 `includes` 会把「米饭」的顺序说明挂到「蛋炒饭」那一行上。
 *
 * ## `attached` / `tail` —— 挂不上就下沉,不丢
 *
 * 一条建议挂到哪一行,判据只有一个:**它指名的那道菜(`advice.at`)在不在 `rows` 里**。
 * 在 → 挂上去;不在 → **整条进 `tail`**。
 *
 * ⚠️ **库外菜也有行之后(见下一节),「指名了却挂不上」在真实输入下走不到了** ——
 * `advice.ts` 里每个 `at` 一律取自 `items`(`worst?.name` / `sweetest?.name` /
 * `restrictionHit(r, items).name`),而 `rows` 现在是**每一道菜都有一行**。
 *
 * 但这一段**不退场**,而且不是历史包袱:`tail.push(a)` 本来就是整餐级的建议要走的
 * 那一步,`idx === undefined` 只是**同一步的另一种来因**。真有一天 `at` 指到一道
 * 不在 `items` 里的菜,那条建议会进卡尾而不是**凭空消失** —— 挂到别的菜上是硬凑,
 * 不显示是把话说没了,卡尾是唯一不撒谎的位置。
 *
 * 守住它的是下面那条「**不重不漏**」的断言(把 `tail.push` 换成 `continue` 会让它红):
 * `rows` 和 `tail` 各自看都自洽,一条建议凭空消失不会有任何症状。
 *
 * ## 库外菜也有行 —— 用户报的那个「5 道菜只分析了 4 道」
 *
 * `deriveEatingAmount` 按 `GUIDELINE_BY_ID` 查表,查不到就 `continue`。于是食物库里
 * 没有的菜(`web:` 联网估算 / `unmatched:` 哨兵)**一道都不在行上**,而菜品卡上
 * 那几道菜都在。用户拍的一盘五道菜,这张卡上只有四行 —— 他把这件事报了上来。
 *
 * 原来那里写着一条理由(「菜品卡就在上面一行,那道菜好好地列在那儿」),说的是
 * **当时还独立的**菜品卡。两张卡合并之后这张卡自己就是要列全一桌菜的那张,
 * 那条理由不再成立。所以这里把它们补上:
 *
 *   · `web:` 项 —— 联网查到了营养、**没有分类**,所以指南那张表查不到它。
 *     给它一行、**不编档位**:菜名照列,没有「多吃/适量吃」胶囊、没有量词,
 *     第二行写它的出处(「联网估算 · …」,话在 `ResultScreen.tsx` 里)。
 *     收益不只是行数对得上 —— 指名它的建议(「钠主要来自『酱爆茄子』」)现在能挂到
 *     **它自己那一行**上,不用再甩到卡尾。
 *   · `unmatched:` 哨兵项 —— 库里没有、也没联网查到,营养按 0 计。**也占一行**
 *     (「不在食物库里 · 按 0 计」),这样「菜品卡上有几道菜,这张卡就有几行」
 *     永远成立,不会再出现用户报的那种形状。
 *
 * ⚠️ **不查 `noteByName`**(和库内菜那一支不同):库外菜没有 `category`,
 * `deriveEatingOrder` 眼里根本没有它,查一次只能查出 `undefined`;而万一有人手搓
 * 一个和库内菜**同名**的 web 项,查出来的是**别人的**顺序说明。同理,库外菜的
 * `stance` 里也没有档位 —— 撞上忌口时那两个字(「别吃」)是从指南 note 的动词拼的,
 * 库外菜没有 note 也就拼不出来。**这不是漏了**:红色冲突块照旧挂在这一行下面
 * (`deriveAdvice` 那条本来就会指名它),声音一点没小,少的只是胶囊上那两个字。
 *
 * ## 两条脚注**不合并**
 *
 * 顺序卡和多少卡各有各的脚注,措辞都是**逐句核过署名范围**的:顺序那条只把「菜和肉
 * 摆在主食前面」半句署给两份食养指南(「餐前喝汤」不在那两份里,是卫健系统的科普
 * 口径),份量那条署《中国居民膳食指南》附录一 + 准则三、四、五。合成一段就是把
 * 两段的出处混在一起,而那正是 `eatingOrder.ts` 反复警告的「引用比依据大」。
 * 所以维持两条,各自留在卡底,次序照旧。
 *
 * 纯逻辑,不碰 DOM —— 可在 Node 里直接测(`scripts/verify-loop.mjs`)。
 */

import { deriveAdvice, type Advice } from './advice'
import { deriveEatingAmount, type AmountTone } from './eatingAmount'
import { deriveEatingOrder } from './eatingOrder'
import { GUIDELINE_BY_ID } from '../data/guideline'
import { isWebId } from '../lib/dishMatch'
import type { MealItem, Profile } from './types'

/**
 * 一行的「态度」那一格 —— 档位胶囊上那两个字 + 量词,或者**这一道没有档**的两种来因。
 *
 * ⚠️ **写成三选一的联合类型,不是三个平铺的可选字段。** 库内菜有「胶囊 + 量词」,
 * 库外菜**两样都没有**,而且两种库外菜的第二行话不一样。写成 `tag?: string` /
 * `amount?: string` 那种形状,「有胶囊却没量词」这类半截状态就能构造出来,而类型
 * 系统一句话都不会说 —— 到了屏幕上就是一行缺了半边的字。
 *
 * (`stance`「态度」是 `eatingAmount.ts` 里 `AmountTone` 那段注释自己的用词。)
 */
export type RowStance =
  /** 库里查得到:指南那张表给了它一档 */
  | { kind: 'guideline'; tag: string; tone: AmountTone; amount: string }
  /** `web:` 联网估算的菜 —— 有营养、**没有分类**,指南那张表里查不到 */
  | { kind: 'web' }
  /** `unmatched:` 哨兵项 —— 库里没有、也没联网查到,营养按 0 计 */
  | { kind: 'unknown' }

export interface PlanRow {
  /** 这道菜 —— **就是菜品卡上那个名字**(同 `eatingAmount.AmountStep.name`) */
  name: string
  /**
   * 顺序说明词(「先吃蔬菜」「最后吃主食」「随餐」…)。
   * **不足两档时没有**(见文件头,别给它兜底),**库外菜也没有**(它们没有分类)。
   */
  note?: string
  /** 这一行的态度 —— 档位,或者「这一道没有档」的来因。见 `RowStance` */
  stance: RowStance
  /** 指名了**这道菜**的建议,按 `deriveAdvice` 的次序 */
  attached: Advice[]
}

export interface EatingPlan {
  /**
   * 一行一道菜,**行数恒等于这一盘的道数**(`items.length`)。
   *
   * 次序:库内菜按 `deriveEatingAmount` 的次序(和菜品卡同序)排在前,库外菜按
   * `items` 的原序追加在后 —— 那正是 `eatingAmount.ts` 里 `rank()` 给「查不到
   * 分类」的 `Number.MAX_SAFE_INTEGER` 的落点,不是第二套次序。见文件头。
   */
  rows: PlanRow[]
  /** 不指名任何一道菜的建议(整餐级的),外加「指名了但挂不上」的那些 */
  tail: Advice[]
  /**
   * 这一餐**一条建议都没有** —— 卡尾那句「各项都在目标区间内,没有需要特别提醒的
   * 地方」的判据。
   *
   * ⚠️ 它是**从落位结果数出来的**,不是「`deriveAdvice` 返回了空数组」。两者今天
   * 必然相等(每条建议都恰好落进 `rows` 或 `tail` 之一,那条「不重不漏」的断言盯着
   * 这件事),但按落位数更不容易撒谎:真出了 bug 让一条建议凭空消失,这句话就该
   * 出现 —— 屏幕上确实什么都没说。
   */
  hasAdvice: boolean
}

/**
 * 把这一盘菜排成「一行一道菜」的卡。
 *
 * `rows` 恒等于 `deriveEatingAmount(items, profile)` 的长度(一道不少、一道不多)——
 * **它不做任何筛选**。三张卡原来的入场判据(顺序卡的「档数 ≥ 2」、多少卡的「≥ 1 道」、
 * 建议卡的「有菜」)合并后取**最宽的那个**:有菜就出卡,`rows` 空的时候卡尾照样
 * 可能挂着建议(那正是「一桌全是认不出来的菜」那一屏)。
 *
 * @param items   识别出的菜(`pending.items`)
 * @param profile 当前档案 —— 忌口和配额都参与,但都在下游那两个模块里
 */
export function deriveEatingPlan(items: MealItem[], profile: Profile): EatingPlan {
  /*
    顺序说明按菜名建表,**查表**(不是首匹配):同名两道菜都拿同一句 —— 它们是
    同一道菜,说明词也该一样。见文件头那两处口径为什么不同。

    ⚠️ `deriveEatingOrder` **不是**按名字去重的:同一盘里记两条「米饭」会吐出
    两条 `{name:'米饭'}` 的 step(说明词也相同,因为分类相同),这两行在下面
    都拿得到说明词 —— 那正是想要的。

    真正需要 `has` 的是**同名不同类**那种:菜名是自由文本,`豆腐` 可以一条是
    `tofu-firm`(蛋奶豆)、一条是 `mapo-tofu`(蔬菜),两条 step 的说明词就不同了。
    这时候留住**靠前那条**的说明词(靠后那条的行也就跟着显示前一句),而不是
    被后一条覆盖 —— 判据是屏幕上从上到下读到的第一句。
  */
  const noteByName = new Map<string, string>()
  for (const step of deriveEatingOrder(items)) {
    if (!noteByName.has(step.name)) noteByName.set(step.name, step.note)
  }

  /*
    份量那一步就是行的来源 —— 它自己会按 `CATEGORY_ROLE` 排好序(和顺序卡逐行同序),
    所以这里**不重排**:次序的定义只在 `eatingAmount.ts` 那一处,重排一遍就是
    第二份定义,两处走散的表现是同一道菜在两张卡上序号不同。

    `note` 查不到就让它 `undefined` —— **不写空串,也不兜底成「随餐」**:渲染方按
    `row.note === undefined` 分岔,空串会让那一行出现一个光秃秃的「· 一小碗,约一拳」;
    兜底成「随餐」则是替一道没有先后可言的菜编了一个位置。
  */
  const rows: PlanRow[] = deriveEatingAmount(items, profile).map((step) => ({
    name: step.name,
    note: noteByName.get(step.name),
    stance: { kind: 'guideline', tag: step.tag, tone: step.tone, amount: step.amount },
    attached: [],
  }))

  /*
    库外菜补行 —— 上面那一支只收得下 `GUIDELINE_BY_ID` 查得到的菜。

    `hasGuideline` 看着像把 `eatingAmount.ts` 里那一行 `if (!note) continue` 抄了
    一遍,其实**定义只有一份** —— 就是那张表本身,两处都是直接查它(和
    `eatingOrder.ts` / `eatingAmount.ts` 各查一次 `CATEGORY_ROLE` 是同一种写法)。
    两处走散的后果(同一道菜出现两次、或者两边都没有)由「行数 = 菜品卡的道数」
    那条断言盯着。

    次序:直接追加。`deriveEatingAmount` 里那个 `rank()` 对查不到分类的菜给的本来
    就是 `MAX_SAFE_INTEGER`(排在最后),所以「追加」得到的次序和「把库外菜也交给
    `rank()` 排」逐项相同 —— 不是第二套次序。

    `note` 刻意不查:库外菜没有分类,`deriveEatingOrder` 眼里根本没有它。见文件头。
  */
  const hasGuideline = (item: MealItem) => Boolean(GUIDELINE_BY_ID[item.foodId])
  for (const item of items) {
    if (hasGuideline(item)) continue
    rows.push({
      name: item.name,
      stance: isWebId(item.foodId) ? { kind: 'web' } : { kind: 'unknown' },
      attached: [],
    })
  }

  /* 挂靠表:菜名 → 行号,同样是**首匹配**(同名两道菜时建议挂到靠上那一道) */
  const indexByName = new Map<string, number>()
  rows.forEach((row, i) => {
    if (!indexByName.has(row.name)) indexByName.set(row.name, i)
  })

  const tail: Advice[] = []
  for (const a of deriveAdvice(items, profile)) {
    const at = a.at
    const idx = at === undefined ? undefined : indexByName.get(at)
    // 指名了、但那一行不在(`web:` / `unmatched:` 的库外菜,或名字对不上)——
    // **整条下沉**,不是丢掉。见文件头。
    if (idx === undefined) tail.push(a)
    else rows[idx].attached.push(a)
  }

  return {
    rows,
    tail,
    hasAdvice: tail.length > 0 || rows.some((r) => r.attached.length > 0),
  }
}
