/**
 * 健康建议 —— 从这一餐的营养值推出来,不是一段写死的文案
 * ===========================================================
 * 设计稿里给了三条建议(红烧排骨钠高 / 先吃蔬菜再主食 / 油麦菜补钾)。
 * 那三条是针对**那一份特定餐盘**写的。如果照抄成常量,换个餐盘就会开始胡说 ——
 * 比如给一份清蒸鱼配「红烧排骨钠含量高」。
 *
 * 所以这里改成规则引擎:每条建议都由某个指标触发,并带出真实的数字。
 * 触发条件不成立就不出现,而不是永远显示同样三句话。
 *
 * 依据的引用保持克制 —— 只在规则确实来自膳食指南时标注,不硬凑权威感。
 *
 * ## `basis` —— 「这条建议是照档案里哪一条说的」
 *
 * 上面那句「不硬凑权威感」管的是**指南**;另一头是:建议句里出现的每一个
 * 上限/目标数字(「占全天上限 45%」「距全天目标 65g」),都是**当前档案**算出来的,
 * 而句子里一个字都没说它是谁定的 —— 用户改了慢性病、手调过配额,屏幕上那句话
 * 会跟着变,却读不出为什么。
 *
 * 所以每条建议带一个 `basis`,写的是**出处**:「高血压」「膳食指南」「基础信息」
 * 「你手动设的」,忌口那条是「花生过敏」。取值只有一个来源 —— `quota.ts` 的
 * `quotaSource()` / `types.ts` 的 `restrictionLabel()`,**别在渲染层现拼**。
 *
 * ### ⚠️ 它以前是「高血压 → 钠上限 1500mg」,现在只是「高血压」
 *
 * 值那一半(「钠上限 1500mg」)是 2026-09-22 从这一屏上**撤掉**的:用户的原话是
 * 「这个高血压可以做个角标放右上角,让人一眼就能看出这是根据高血压来给的建议」,
 * 他明确接受「1500mg」从结果页消失。所以文件头这儿原来那句「和档案页印的是
 * **同一串字节**」的承诺**当场作废** —— 那个数现在只印在档案页(「这些数字为什么
 * 是这样」),结果页只印「谁定的」。
 *
 * 代价记在这儿,别当成漏改:想知道 1500mg 是多少,得去档案页看。
 *
 * ⚠️ **只在这条建议的依据确实来自档案/指南时才写。** 蔬菜那条写的是
 * 「《中国居民膳食指南 2022》建议餐餐有蔬菜」—— 它和你是谁无关,正文里已经
 * 指名道姓了,所以**没有** `basis`,而不是硬凑一句「依据 · 膳食指南」。
 * 这条判据要是不写下来,下一个人会给每条建议都补一句,把它变成一行噪音。
 *
 * ## `at` —— 「这条建议指名了哪一道菜」
 *
 * 钠那条的正文里写着「主要来自『红烧排骨』」、糖那条也是、忌口那条连标题里都有
 * 菜名 —— 但那个名字**只活在字符串里**,渲染方读不出来。结果页那张「一行一道菜」
 * 的卡要把建议挂到对应的那一行上,所以把已经算出来的那个名字多存一份。
 *
 * ⚠️ **判据是菜名「完全相等」,不是子串。** 用 `includes` 会把「米饭」的建议挂到
 * 「蛋炒饭」那一行上 —— 那正是 `types.ts` 里 `restrictionHit` 那条「裸词子串」
 * 取舍的另一面:那边要宽(菜名是自由文本,「花生米」得能撞上「花生」),这边要严
 * (行是我们自己排的,名字来自同一个数组)。一盘里两道同名菜时挂到靠上那一道。
 */

import { FOOD_BY_ID, type FoodCategory } from '../data/foods'
import { nutritionOfItem, per100gOf } from '../lib/nutrition'
import { nutritionOfItems } from './derive'
import { quotaSource } from './quota'
import {
  restrictionHit,
  restrictionLabel,
  type MealItem,
  type Nutrition,
  type Profile,
} from './types'

export interface Advice {
  title: string
  body: string
  icon: string
  tone: 'brand' | 'warn' | 'danger'
  /**
   * 「这条建议是照档案里哪一条说的」—— 就是角标上那个词,见文件头。
   * 钠/糖/蛋白走 `quotaSource()`(「高血压」「膳食指南」「基础信息」「你手动设的」),
   * 忌口走 `restrictionLabel()`(「花生过敏」)。
   *
   * **没有就是没有**,不写空串:渲染方按 `a.basis && …` 决定画不画那个角标,
   * 空串会画出一个没有字的空胶囊。
   */
  basis?: string
  /**
   * 这条建议**指名的那道菜**(就是菜品卡上那个名字)。没有 = 整餐级的
   * (「这一餐没有蔬菜」「蛋白质偏少」),渲染方把它放到卡片末尾。
   *
   * ⚠️ 指名的菜**不一定在结果页那张「一行一道菜」的卡上** —— 库外菜
   * (`web:` 项)没有分类,进不了那张卡。渲染方挂不上时要把整条放到卡尾,
   * **不是丢掉**。判据与取值口径见文件头。
   */
  at?: string
}

/** 菜品的分类 -> 图标 */
export function dishIcon(foodId: string): string {
  const category: FoodCategory | undefined = FOOD_BY_ID.get(foodId)?.category
  switch (category) {
    case '主食':
      return 'rice'
    case '蛋奶豆':
      return 'breakfast'
    case '肉类':
    case '水产':
    case '其他':
      return 'plate'
    case '蔬菜':
    case '水果':
      return 'leaf'
    case '汤羹':
    case '饮品':
      return 'water'
    default:
      return 'plate'
  }
}

/** 这一餐里钠最高的一道菜 —— 建议要指名道姓,否则用户不知道从哪改起 */
function topSodiumDish(items: MealItem[]): { name: string; sodium: number } | null {
  let best: { name: string; sodium: number } | null = null
  for (const item of items) {
    // 取不到来源的项**不参与评选**,而不是按 0 参与 ——
    // 一桌全是哨兵项时,那样会让建议正文指名道姓地说「主要来自『清炒藕片』（约 0mg）」。
    // 这不是「算得少」,是**说错话**:把一道我们一无所知的菜说成钠的主要来源。
    const per100g = per100gOf(item)
    if (!per100g) continue
    const sodium = (per100g.sodium * item.grams) / 100
    if (!best || sodium > best.sodium) best = { name: item.name, sodium }
  }
  return best
}

/**
 * 生成建议。按严重程度排序(danger → warn → brand),
 * 最多返回 4 条 —— 一屏塞六条建议等于没建议。
 */
export function deriveAdvice(items: MealItem[], profile: Profile): Advice[] {
  const out: Advice[] = []
  const n: Nutrition = nutritionOfItems(items)
  const q = profile.quota

  /* --- 忌口:优先级最高,命中就必须置顶 --- */
  for (const r of profile.restrictions) {
    /*
      「这一条碰上了哪道菜」走 `restrictionHit()` —— 判据(裸词子串、`hardBlocks`
      那一问、空词不算命中)全写在 `types.ts` 那个函数里,**别搬回来**:
      `eatingAmount.ts` 的「别吃」那一行问的是同一个问题,两处各写一遍迟早走散,
      而走散的表现是同一盘菜在一张卡上是冲突、在另一张卡上安然无恙。

      (不拦的类型根本进不来,所以下面正文里引用的 `r.level` 一定是「拦的那个等级」——
      `restrictionLevel()` 保的就是这件事 —— 它从前也在这里拼 `basis`,现在那句
      「（高危，逐道菜拦截）」撤了,但这条保证仍然被下面那行正文依赖着。)
    */
    const hit = restrictionHit(r, items)
    if (hit) {
      out.push({
        title: `本餐含「${hit.name}」，与档案中的「${restrictionLabel(r)}」冲突`,
        body: `风险等级:${r.level}。请确认菜品成分,必要时替换为其他菜品。若是误识别,可在上方修正后重新分析。`,
        icon: 'alertCircle',
        tone: 'danger',
        /*
          角标上就是这一条忌口的名字(「花生过敏」)。

          ⚠️ 上一版这里是「花生过敏（高危，逐道菜拦截）」,那半句被角标撤掉了。
          核对下来几乎不丢东西:正文第二句本来就写着「风险等级:高危」,丢的只是
          「逐道菜拦截」(它的意思是「这道菜在别处也拦」,属于补充说明)。
        */
        basis: restrictionLabel(r),
        at: hit.name,
      })
    }
  }

  /* --- 钠:这个 App 的核心主张,放在最前面 --- */
  const sodiumShare = n.sodium / q.sodium
  const worst = topSodiumDish(items)
  if (sodiumShare >= 0.35) {
    out.push({
      title: `本餐钠约 ${Math.round(n.sodium)}mg，占全天上限 ${Math.round(sodiumShare * 100)}%`,
      body: worst
        ? `主要来自「${worst.name}」（约 ${Math.round(worst.sodium)}mg）。下一餐以清蒸、白灼代替红烧，并少喝汤底。`
        : '下一餐以清蒸、白灼代替红烧，并少喝汤底。',
      icon: 'alertCircle',
      tone: sodiumShare >= 0.5 ? 'danger' : 'warn',
      basis: quotaSource(profile, 'sodium'),
      /*
        ⚠️ **刻意不填 `at` —— 这一条是整餐级的,必须落卡尾。**

        它说的是「**这一餐**的钠偏高」,正文里点出主要贡献者是让人知道该少吃
        哪一样,但那不等于「问题出在这道菜上」。填了 `at`,它会被挂到那一行去,
        和那一行的档位打起来 —— 实测就是这么出的:

            素炒时蔬    多吃      ← 蔬菜类的规格
                       钠主要来自「素炒时蔬」(超上限)  ← 同一行

        两句话各自都对,摆在一起用户就没法吃了。**一条建议要么说这一餐,要么
        说这道菜**;说这一餐的句子,位置就在卡尾。
      */
    })
  } else if (sodiumShare < 0.2 && items.length > 0) {
    out.push({
      title: `本餐钠约 ${Math.round(n.sodium)}mg，控制得很好`,
      body: `仅占全天上限的 ${Math.round(sodiumShare * 100)}%，为下一餐留出了余量。`,
      icon: 'shieldCheck',
      tone: 'brand',
      basis: quotaSource(profile, 'sodium'),
      // 「控制得很好」这句是**整餐级**的:它没有指名任何一道菜,所以不给 `at`。
    })
  }

  /* --- 添加糖 --- */
  if (n.sugar > q.sugar * 0.4) {
    // 取值走 `nutritionOfItem` —— 它自带「查不到来源才是 0」那唯一一处兜底。
    // 这里以前自己写了个 `?? 0`,两份兜底并存的结果就是库外菜的高糖**算进了
    // 合计 `n.sugar`、却不参与评选**,于是「糖超标了」这条建议永远指向库内那道菜。
    const sweetest = items
      .map((i) => ({ name: i.name, sugar: nutritionOfItem(i).sugar }))
      .sort((a, b) => b.sugar - a.sugar)[0]
    out.push({
      title: `添加糖约 ${Math.round(n.sugar)}g，占全天建议上限 ${Math.round((n.sugar / q.sugar) * 100)}%`,
      body: sweetest
        ? `主要来自「${sweetest.name}」。添加糖指加工时额外加入的糖,水果里的果糖不计入其中。`
        : '添加糖指加工时额外加入的糖,水果里的果糖不计入其中。',
      icon: 'bulb',
      tone: 'warn',
      basis: quotaSource(profile, 'sugar'),
      /* 同上:整餐级的糖那条也不挂行 —— 理由见上面钠那一段 */
    })
  }

  /* --- 蛋白质 --- */
  const proteinShare = n.protein / q.protein
  if (proteinShare < 0.25 && items.length > 0) {
    out.push({
      title: `蛋白质仅 ${Math.round(n.protein)}g，这一餐偏少`,
      body: `距全天目标 ${q.protein}g 还有差距。可以补一份鸡蛋、豆腐或酸奶。`,
      icon: 'bulb',
      tone: 'warn',
      basis: quotaSource(profile, 'protein'),
      // 蛋白质这两条都是**整餐级**的(说的是这一餐的合计),不指名任何一道菜。
    })
  } else if (proteinShare >= 0.4) {
    out.push({
      title: `蛋白质 ${Math.round(n.protein)}g，占全天目标 ${Math.round(proteinShare * 100)}%`,
      body: '搭配得不错。蛋白质分散到三餐比集中在晚餐吸收更平稳。',
      icon: 'shieldCheck',
      tone: 'brand',
      basis: quotaSource(profile, 'protein'),
    })
  }

  /* --- 蔬菜:只看这一餐有没有 --- */
  /*
    三值,不是布尔。
    ------------------------------------------------------------
    这条判断查的是**分类**(`Food.category`),而分类只存在于食物库里。
    库里没有的菜(联网查到营养的 `web:` 项、什么都没查到的 `unmatched:` 哨兵)
    一律查不到分类 —— 原来的写法把它们当成「不是蔬菜」,于是
    「联网查到的清炒时蔬 + 米饭」会渲染出「**这一餐没有蔬菜或水果**」。

    那不是算错了,是**规则引擎在断言一件它不知道的事**,而且语气很确定。
    这个仓库对这类东西的立场一贯是:宁可不说,不要说一个可能错的
    (同 `dishMatch` 里那句「宁可显示『不知道』,不要显示一个错的」)。

    所以第三种取值是 `unknown`:只要有一道菜的分类未知,这条建议就**不输出**。
    代价是「一盘全没认出来的菜」也不会再收到这条提醒 —— 那是应该的,
    对着一盘不知道是什么的东西说「没有蔬菜」毫无信息量。
  */
  const veg: 'yes' | 'no' | 'unknown' = (() => {
    let sawUnknown = false
    for (const i of items) {
      const c = FOOD_BY_ID.get(i.foodId)?.category
      if (c === '蔬菜' || c === '水果') return 'yes'
      if (c === undefined) sawUnknown = true
    }
    return sawUnknown ? 'unknown' : 'no'
  })()
  if (veg === 'no' && items.length > 0) {
    out.push({
      title: '这一餐没有蔬菜或水果',
      body: '《中国居民膳食指南 2022》建议餐餐有蔬菜，每天 300–500g。下一餐补一份绿叶菜即可。',
      icon: 'leaf',
      tone: 'warn',
      // 没有 `basis`(理由见文件头)也**没有 `at`** —— 它说的是整餐的构成,
      // 指名不到任何一道菜(「这一餐缺什么」不是「哪一道菜的问题」)。
    })
  }

  const order = { danger: 0, warn: 1, brand: 2 }
  return out.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 4)
}
