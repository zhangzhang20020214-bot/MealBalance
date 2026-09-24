/**
 * 进食多少 —— 结果页那张「这一盘该吃到多少」的卡的规则。
 *
 * 一行三样东西
 * ============================================================
 *   菜名          菜品卡上那个名字（不是食物库里的名字）
 *   胶囊上的字    多吃 / 适量吃 / 少吃 —— 或者「别吃」（撞上档案里的忌口时）
 *   第二行的量    双手一捧、一个掌心、一小碗、一杯 —— **一个克数都没有**
 *
 * 用户的原话是「增加进食多少建议，用通俗语言来说，不要说多少 g 这种用户
 * 无法准确衡量的内容」。这话和 `lib/portion.ts` 的文件头是**同一条**:
 * 界面上那些克数是常量或者用户自己选的,不是从照片里推出来的。所以这一档
 * 不去把克数换算成「几个」「几块」—— 那等于把一个不准的数洗成一句看着很
 * 确定的话。量词直接照《中国居民膳食指南》附录一的参考手势写,中间不过克数。
 *
 * 为什么不放进 `advice.ts`
 * ============================================================
 * 和 `eatingOrder.ts` 拒收的理由是同一条:`advice.ts` 的文件头把自己的职责
 * 写死了 —— 那里面是「从这一餐的**营养值**推出来的健康建议」。这张卡一分
 * 营养值都不看,它按**是哪一道菜**查 `data/guideline.ts` 那张表。混进去会让
 * 那个文件头变成一句假话。
 *
 * 为什么不和 `eatingOrder.ts` 合成一张卡
 * ============================================================
 * 两张卡是**两份不同的出处**,而 `eatingOrder.ts` 的文件头专门交代过这件事
 * 不能混:顺序那一档的「菜和肉在主食前面」出自两份食养指南 §2.3,而「餐前
 * 喝汤」那一档只有卫健系统的科普口径 —— 署名只署了后半句。这张卡的出处又是
 * 第三个地方(膳食指南的准则三/四/五 + 附录一)。合成一张卡就得把三个出处
 * 挤进一个脚注,而那正是那份文件反复警告的「引用比依据大」。
 * 代价说明白:同一盘菜在屏幕上出现两次(两张卡各一遍)。这是用户挑的形态。
 *
 * 忌口那一档 —— 用户明确要的**唯一一处刻意重复**
 * ============================================================
 * `advice.ts` 已经为每条命中的忌口弹一张红色冲突卡,标题里就写着「与档案中的
 * 『花生过敏』冲突」。那张卡是**一餐一条**的告警;而这张卡是**逐道菜**的清单,
 * 撞上的那一道旁边直接标「别吃」,用户扫一眼就知道是哪一盘不用碰。
 *
 * ⚠️ 问过用户了,他选的是「算进去」。所以这不是疏忽 —— 是拿「同一件事说两遍」
 * 换「这一张卡自己是完整的」。改之前先确认那个取舍还成立。
 *
 * ⚠️ 判据走 `restrictionHit()`,**不是**在这里重写一遍子串匹配。理由见那个
 * 函数:线上工作流、`advice.ts`、这里三处判的必须是同一件事。
 *
 * 纯逻辑,不碰 DOM —— 可在 Node 里直接测(`scripts/verify-loop.mjs`)。
 */

import { FOOD_BY_ID } from '../data/foods'
import { GUIDELINE_BY_ID, tierTag, type GuidelineTier } from '../data/guideline'
import { CATEGORY_ROLE } from './eatingOrder'
import { per100gOf } from '../lib/nutrition'
import { restrictionHit, restrictionLabel, type MealItem, type Profile } from './types'

/**
 * 一行的态度。
 *
 * `plain` 是「适量」那一档 —— 它不该有颜色。三档里只有它在说「照常吃」,
 * 给它一个底色会让整张卡变成一片花花绿绿,反而看不出哪几行要留意。
 *
 * `blocked` 是撞上档案忌口,不是指南里的第四档 —— 它比「少」更硬,而且出处
 * 完全不同(档案,不是指南)。
 */
export type AmountTone = GuidelineTier | 'blocked'

export interface AmountStep {
  /** 这道菜 —— **就是菜品卡上那个名字** */
  name: string
  /** 胶囊上那两个字:「多吃」「适量吃」「少吃」「别喝」 */
  tag: string
  tone: AmountTone
  /** 第二行 —— 量,或者（撞上忌口时）撞的是哪一条 */
  amount: string
}

/**
 * 从这一盘的菜品里排出「每道菜吃到多少」。**一道都排不出时返回空数组**
 * (整张卡不渲染)。
 *
 * 判据为什么是「一道」而不是 `eatingOrder` 那样的「两档」
 * ------------------------------------------------------------
 * 那张卡的规矩是**档数 ≥ 2**:一道菜没有「顺序」可言,而米饭 + 馒头排出来的
 * 「① 米饭 ② 馒头」不是建议、是噪音。
 *
 * 这张卡不一样:**一道菜也有「多少」可言**,而且那一盘恰恰最需要它 ——
 * 「我就盛了一碗面」正是要问「这一碗是多还是少」的时候。所以一道菜也出卡,
 * 两张卡的入场判据不同是有理由的,不要来「统一」。
 *
 * @param items   识别出的菜(`pending.items`)
 * @param profile 当前档案 —— 只有忌口参与,营养值一概不看
 */
export function deriveEatingAmount(items: MealItem[], profile: Profile): AmountStep[] {
  const out: AmountStep[] = []

  /*
    先按「进食顺序」那张卡的次序排一遍 —— 两张卡在这个页面上是**上下挨着的**,
    而且列的是同一盘菜。各排各的会出现两件坏事:

      · 同一道菜在两张卡上的序号不一样(上面那张按先后排,这张按菜品卡的录入
        顺序排)。屏幕上同时出现「米饭 ③」和「米饭 ①」,而两个都不是错的 ——
        这是最坏的一种不一致。
      · 两张卡的同一道菜不在同一行高上,没法对着看。

    次序直接取 `CATEGORY_ROLE`(**就是那张卡自己用的表**),档内保持 `items`
    的原序 —— 和 `deriveEatingOrder` 里那两行逐字同义。不是「照它再写一遍」:
    表是同一张,顺序的**定义**仍然只有那一处。
  */
  const rank = (foodId: string): number => {
    const category = FOOD_BY_ID.get(foodId)?.category
    // 查不到分类的菜排在最后 —— 它们本来也进不了下面那个循环(查不到档位),
    // 这个值只是让排序稳定,不参与任何判断。
    return category ? CATEGORY_ROLE[category].group : Number.MAX_SAFE_INTEGER
  }
  const ordered = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.foodId) - rank(b.item.foodId) || a.i - b.i)

  /*
    ⚠️ **营养封顶:分类规格不许越过这一餐的实际营养说话。**

    下面那张表是**按分类**给的(蔬菜类一律 `recommend`),它不看这道菜实际进了
    多少钠。于是一盘炒得极咸的时蔬在表里永远是「多吃」,而卡尾那条同时在说
    「这一餐的钠主要来自它」—— 两句话各自都对,摆在同一张卡上用户就没法吃了:

        素炒时蔬   多吃
        卡尾       本餐钠约 1800mg，主要来自「素炒时蔬」

    判据要**两条同时成立**才降档:

      · 它是这一餐**钠最多**的那一道(唯一的 argmax)
      · **这一餐的钠合计超过了配额** —— 也就是 `advice.ts` 正在说「这一餐钠偏高」
        的那个时刻

    ⚠️ 第二条**最初写的是「它自己的钠 > 一日配额的三分之一」,那是错的**。
    实测:`清炒油麦菜 320mg/100g × 200g = 640mg`,而门槛 2000÷3 = 667 ——
    差 27mg 就被挡在门外,一盘炒得极咸的菜照样标「多吃」。

    错在哪:那个门槛锚的是「这道菜的绝对量」,而矛盾锚的是**「App 正在说这一餐
    钠高」**。只要卡尾在说那句话,而它指名的菜还标着「多吃」,用户就会困惑 ——
    和那道菜自己多少毫克无关。**判据要锚在矛盾本身上。**

    降档之后 `amount` 也要改口:原来那句「多吃点」和降档是矛盾的,那句话
    必须说清「为什么这道菜掉了一档」,否则用户看到的还是一个矛盾。
  */
  const sodiumOf = (it: MealItem): number => {
    const per = per100gOf(it)
    return per ? (per.sodium * it.grams) / 100 : 0
  }
  const sodiums = items.map(sodiumOf)
  const topSodium = sodiums.length > 0 ? Math.max(...sodiums) : 0
  const mealSodium = sodiums.reduce((a, b) => a + b, 0)
  /**
   * 这一餐的钠超标了没有 —— 和 `advice.ts` 里那条钠建议**同一个判据**
   * (它看的是 `dayStats` 的合计与配额,这里看的是这一盘菜的合计)。
   * 两处不一致的话,就会出现「卡尾说超标、菜行说多吃」——正是要防的那件事。
   */
  const overSodium = mealSodium > profile.quota.sodium

  for (const { item } of ordered) {
    /*
      查表。查不到的是**分类未知的菜**:`unmatched:` 哨兵项(库里没有、也没
      联网查到)和 `web:` 项(联网查到了营养,但没有分类)。

      ⚠️ 这两种菜**不进这个列表**,和 `eatingOrder.ts` 的处理一致 —— 但它们
      **也不撤掉整张卡**。判据和那张卡同源:这张卡断的是**肯定**(「这几道
      该吃这么多」),没进列表不等于说了它什么;而 `advice.ts` 里那条蔬菜判断
      断的是**否定**(「这一餐没有蔬菜」),分类未知时必须整条不说。
      别把两处的处理看成一回事。

      ⚠️ **这里 `continue` 掉的是「档」这件事,不等于它从屏幕上消失。**
      结果页那张卡的行不是从这里一个人出的 —— `eatingPlan.ts` 会把库外菜
      补成**没有档的那种行**(菜名照列,第二行写它的出处)。所以一盘里有联网
      查到的「清炒时蔬」时,那张卡上照样有它一行,只是那一行没有胶囊、没有量词。
      (2026-09-22 之前是两回事:补行那一支不存在,用户拍的五道菜在卡上只有四行。)
    */
    const note = GUIDELINE_BY_ID[item.foodId]
    if (!note) continue

    /*
      忌口覆盖写在查表**之后**:查不到档的菜本来就不在这张卡上,也就没有
      「这一行标什么」的问题。反过来写会多出一条走不到的分支。
    */
    const hit = profile.restrictions.find((r) => restrictionHit(r, [item]) !== undefined)

    out.push(
      hit
        ? {
            name: item.name,
            tag: `别${note.verb}`,
            tone: 'blocked',
            amount: `档案里写着「${restrictionLabel(hit)}」`,
          }
        : (() => {
            /* 营养封顶 —— 理由见上面那一段 */
            const capped = note.tier === 'recommend' && sodiumOf(item) === topSodium && overSodium
            return {
              name: item.name,
              tag: tierTag(capped ? 'moderate' : note.tier, note.verb),
              tone: capped ? 'moderate' : note.tier,
              amount: capped ? '这盘偏咸，减盐的做法才算「多吃」那一档' : note.amount,
            }
          })()
    )
  }

  return out
}
