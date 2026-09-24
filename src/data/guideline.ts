/**
 * 指南怎么看这一道菜 —— 结果页「进食多少」那张卡的**两样东西**
 * ===========================================================
 *   ① 态度:多吃 / 适量吃 / 少吃（用户的原话是「推荐进食、禁止进食」）
 *   ② 量:一捧、一个掌心、一小碗、一杯 —— **不说克数**
 *
 * 为什么单独一个文件,不并进 `foods.ts`
 * ===========================================================
 * `foods.ts` 的文件头把自己写死了:那是**营养数据**,而且带着一句
 * 「请勿当作权威来源」。这张表是**另一回事**:它不是食物的属性,是这一版
 * 膳食指南对这类食物的一句话。两者的寿命也不一样 —— 换一份权威食物成分表,
 * `foods.ts` 整个换掉,而这 58 行一个字都不用动。
 *
 * 为什么逐条写,而不是按九个分类写一张 9 行的表
 * ===========================================================
 * 有三个分类里**装着态度相反的东西**,按分类给必然说错一半:
 *
 *   蛋奶豆   牛奶、豆浆、豆腐(准则三「多吃…奶类、全谷、大豆」)
 *            和鸡蛋(准则四「适量吃鱼、禽、蛋、瘦肉」)不是一档
 *   饮     美式咖啡(无糖)和含糖可乐(准则五「不喝或少喝含糖饮料」)
 *   其他   炒花生(准则三「坚果有益,但不宜过量」)和薯片、蛋糕、巧克力
 *
 * 一度想写「九行大类 + 一张例外名单」,放弃了:例外名单的本质就是逐条标注,
 * 只是把没写出来的那些藏进了一个默认值里。默认值会让「这一条到底是谁定的」
 * 变得查不出来 —— 而这张表存在的全部意义就是每一条都查得出来。
 *
 * 降档的判据（**只降指南原话点过名的那几样**）
 * ===========================================================
 * 库里有几条本身就是「做法」,而那个做法正好是准则五点名要少的。只有下面
 * 五样会降到「少」,其余一律按上面那条分类的准则给:
 *
 *   准则四 「少吃肥肉、烟熏和腌制肉制品」        → 红烧肉、回锅肉(五花肉)
 *   准则五 「少吃高盐和油炸食品」                → 薯片
 *   准则五 「少食用高糖食品」                    → 蛋糕、巧克力
 *   准则五 「不喝或少喝含糖饮料」                → 含糖可乐、珍珠奶茶、橙汁
 *
 * ⚠️ **不因为「红烧」「干煸」「水煮」这种字样降档。** 红烧排骨、干煸四季豆、
 * 水煮鱼、麻婆豆腐都留在自己那一档 —— 替指南对烹饪方式下判断,是这个仓库
 * 一贯不肯做的事(同 `advice.ts` 里那条「宁可不说,不要说一个可能错的」)。
 *
 * 量词的出处
 * ===========================================================
 * 全部来自《中国居民膳食指南(2022)》**附录一 常见食物的份量**:
 *
 *   附表1-3 参考手势:  双手捧=蔬菜 / 单手捧=大豆坚果 / 一把=叶茎蔬菜、水果
 *                       一个掌心=片状食物 / 一拳=球形、块状食物 / 两指=肉类
 *   附表1-2 标准物品:  碗(11cm 直口碗,量主食) / 盘(22.7cm 浅式盘,量副食)
 *                       杯(250ml,量奶、豆浆)
 *   附表1-1 标准份量:  蛋 40~50g/份(一个鸡蛋 50g) / 奶 200~250ml/份
 *
 * ⚠️ **这里一条克数都没有,是刻意的,别来「补充得更准确一点」。**
 * `lib/portion.ts` 的文件头已经说明白了:界面上那些克数是常量或者用户选的,
 * 不是从照片里推出来的。**拿一个不准的克数去换算成「几个」「几块」,是把
 * 假精确洗成一句看着很确定的话** —— 比写 150g 更糟,因为「四五个」读起来
 * 像事实。所以这里的量词是**直接照附录写的**,没有一步经过克数。
 *
 * 那 `defaultGrams` 呢 —— 它和「一拳」不是同一个东西吗
 * ------------------------------------------------------------
 * 不是。`defaultGrams` 是**录入口的默认值**(米饭 150g),它描述的是「常见
 * 一份有多少」;而这张卡要说的是「**你该吃多少**」。前者是估计,后者是建议,
 * 建议不需要知道盘子里有多少。这也是为什么这一档**不跟着这一餐的余量变**。
 */

/** 三档态度 —— 就是准则三、四、五各自的那个字 */
export type GuidelineTier = 'recommend' | 'moderate' | 'limit'

/** 动词 —— 牛奶是「喝」,豆腐是「吃」;它跟着**这一条食物**走,不跟分类走 */
export type GuidelineVerb = '吃' | '喝'

export interface GuidelineNote {
  tier: GuidelineTier
  verb: GuidelineVerb
  /** 卡片上那一行「多少」的话。**一个克数都不许出现** */
  amount: string
}

/**
 * 三档 attitudes → 胶囊上的那个词。
 *
 * `多吃` / `适量吃` / `少吃` 三个词**都是指南原文**:
 *   准则三「**多吃**蔬果、奶类、全谷、大豆」
 *   准则四「**适量吃**鱼、禽、蛋、瘦肉」
 *   准则五「**少**盐少油,控糖限酒」
 *
 * ⚠️ 拼法是 `词 + 动词`,不是写死三个词 —— 牛奶那一行要是印成「多吃牛奶」
 * 就荒唐了。所以是「多」+「喝」。
 */
const TIER_WORD: Record<GuidelineTier, string> = {
  recommend: '多',
  moderate: '适量',
  limit: '少',
}

/** 胶囊上那两个字 —— 「多吃」「适量喝」「少吃」 */
export function tierTag(tier: GuidelineTier, verb: GuidelineVerb): string {
  return `${TIER_WORD[tier]}${verb}`
}

/**
 * 逐条食物的档位。
 *
 * ⚠️ **键是 `Food.id`,而它是 `string` 不是联合类型** —— 所以「库里每一条
 * 都有档」这件事类型系统管不了,只能由 `scripts/verify-loop.mjs` 的覆盖断言
 * 盯着(它同时断「没有多余的键」:拼错一个 id 会静默少一行,而少的那一行
 * 在界面上表现为**这道菜从卡上消失了**,和「没依据」长得一模一样)。
 *
 * ⚠️ **库里加了新食物而这里没加,那道菜不会报错,只会从卡上消失。** 仓库里
 * 有先例(`SLOT_ICON`、`CATEGORY_ROLE`),做法也一样:让它红在 verify 里。
 */
export const GUIDELINE_BY_ID: Record<string, GuidelineNote> = {
  /* ---------- 主食 ---------- */
  // 精制谷物留在「适量」;全谷、杂豆、薯类进「多」—— 准则三的名字里就有「全谷」,
  // 而「（四）全谷、杂豆和薯类巧安排」是那一节的小标题。
  rice: { tier: 'moderate', verb: '吃', amount: '一小碗，约一拳' },
  mantou: { tier: 'moderate', verb: '吃', amount: '一个，约一拳' },
  noodles: { tier: 'moderate', verb: '吃', amount: '一小碗' },
  congee: { tier: 'moderate', verb: '吃', amount: '一小碗' },
  // 包子、饺子没有天然的「个数」可说 —— 库里的克数是近似值(defaultGrams),
  // 拿它除出一个「四五个」就是把假精确洗成一句看着很确定的话。用「一拳」,
  // 既不数数也不称重。
  xiaolongbao: { tier: 'moderate', verb: '吃', amount: '一拳的量，别再多' },
  dumpling: { tier: 'moderate', verb: '吃', amount: '一拳的量，别再多' },
  'brown-rice': { tier: 'recommend', verb: '吃', amount: '一小碗，约一拳' },
  'whole-wheat-bread': { tier: 'recommend', verb: '吃', amount: '一两片' },
  oatmeal: { tier: 'recommend', verb: '吃', amount: '一小碗' },
  corn: { tier: 'recommend', verb: '吃', amount: '一根' },
  'sweet-potato': { tier: 'recommend', verb: '吃', amount: '一个，约一拳' },

  /* ---------- 蛋奶豆 ---------- */
  // 奶和豆在准则三里,蛋在准则四里 —— 这个分类必须逐条给,理由见文件头。
  milk: { tier: 'recommend', verb: '喝', amount: '一杯' },
  'soy-milk': { tier: 'recommend', verb: '喝', amount: '一杯' },
  yogurt: { tier: 'recommend', verb: '喝', amount: '一杯' },
  'tofu-firm': { tier: 'recommend', verb: '吃', amount: '一块，约一个掌心' },
  'tofu-soft': { tier: 'recommend', verb: '吃', amount: '一块，约一个掌心' },
  // 准则四:「每天吃一个鸡蛋不会增加心血管疾病的发病风险」—— 那句话就是「一个」
  'boiled-egg': { tier: 'moderate', verb: '吃', amount: '一个，一天一个就够' },
  'fried-egg': { tier: 'moderate', verb: '吃', amount: '一个' },

  /* ---------- 肉类 ---------- */
  // 准则四「适量吃鱼、禽、蛋、瘦肉」—— 都在这一档,除了点名要少的那两样。
  'braised-ribs': { tier: 'moderate', verb: '吃', amount: '一个掌心' },
  'kungpao-chicken': { tier: 'moderate', verb: '吃', amount: '小半盘' },
  'boiled-chicken': { tier: 'moderate', verb: '吃', amount: '一个掌心' },
  'roast-drumstick': { tier: 'moderate', verb: '吃', amount: '一个掌心' },
  'tomato-egg': { tier: 'moderate', verb: '吃', amount: '小半盘' },
  'pepper-pork': { tier: 'moderate', verb: '吃', amount: '小半盘' },
  steak: { tier: 'moderate', verb: '吃', amount: '一个掌心，约两指厚' },
  'braised-beef': { tier: 'moderate', verb: '吃', amount: '一个掌心，约两指厚' },
  // 准则四原话「少吃肥肉」—— 这两条是五花肉,降档降的是指南点过名的那样东西
  'braised-pork': { tier: 'limit', verb: '吃', amount: '能不吃就不吃' },
  'twice-cooked-pork': { tier: 'limit', verb: '吃', amount: '能不吃就不吃' },

  /* ---------- 水产 ---------- */
  // 准则四「优先选择鱼」—— 这一类是整个准则里唯一被「优先」的
  'steamed-fish': { tier: 'recommend', verb: '吃', amount: '一个掌心' },
  'boiled-shrimp': { tier: 'recommend', verb: '吃', amount: '一手把' },
  salmon: { tier: 'recommend', verb: '吃', amount: '一个掌心，约两指厚' },
  // 水煮鱼留「适量」,不因为菜名里有「水煮」就降档 —— 见文件头那条。
  'boiled-fish-spicy': { tier: 'moderate', verb: '吃', amount: '一个掌心' },

  /* ---------- 蔬菜 ---------- */
  // 准则三「多吃蔬果」—— 整类都在「多」。附表1-3:双手捧,衡量蔬菜类食物的量
  'lettuce-stir': { tier: 'recommend', verb: '吃', amount: '双手一捧，可以多吃' },
  'spinach-garlic': { tier: 'recommend', verb: '吃', amount: '双手一捧，可以多吃' },
  broccoli: { tier: 'recommend', verb: '吃', amount: '双手一捧，可以多吃' },
  'cucumber-salad': { tier: 'recommend', verb: '吃', amount: '双手一捧' },
  'green-beans': { tier: 'recommend', verb: '吃', amount: '双手一捧' },
  // 麻婆豆腐在库里的分类是「蔬菜」(它一半是豆腐),但豆腐是**大豆制品** ——
  // 这一行的档位照大豆给,量词照副食的「盘」给。
  'mapo-tofu': { tier: 'recommend', verb: '吃', amount: '小半盘' },
  'stir-veggies': { tier: 'recommend', verb: '吃', amount: '双手一捧，可以多吃' },
  // 番茄是球形,不是叶茎 —— 附表1-3 里量它的是「一拳」,不是「一把」
  'tomato-raw': { tier: 'recommend', verb: '吃', amount: '一个，约一拳' },

  /* ---------- 水果 ---------- */
  apple: { tier: 'recommend', verb: '吃', amount: '一个，约一拳' },
  banana: { tier: 'recommend', verb: '吃', amount: '一根' },
  orange: { tier: 'recommend', verb: '吃', amount: '一个，约一拳' },
  grape: { tier: 'recommend', verb: '吃', amount: '一串，约一拳' },
  blueberry: { tier: 'recommend', verb: '吃', amount: '一小把' },
  watermelon: { tier: 'recommend', verb: '吃', amount: '一大块' },

  /* ---------- 汤羹 ---------- */
  // 汤留在「适量」。准则五里提到汤的那一句是「炖、煮菜肴汤水较多,更要减少
  // 食盐用量」—— 它说的是**做菜时少放盐**,不是「别喝汤」。所以这里不写
  // 「汤别喝完」:那是 App 里另一处(钠那条建议)的话,出处不是这一条。
  'seaweed-egg-soup': { tier: 'moderate', verb: '喝', amount: '一小碗' },
  'tomato-beef-soup': { tier: 'moderate', verb: '喝', amount: '一小碗' },
  'wintermelon-soup': { tier: 'moderate', verb: '喝', amount: '一小碗' },

  /* ---------- 饮品 ---------- */
  americano: { tier: 'moderate', verb: '喝', amount: '一杯，别加糖' },
  latte: { tier: 'moderate', verb: '喝', amount: '一杯' },
  // 准则五「不喝或少喝含糖饮料」。橙汁也在这一档 —— 它一 100ml 带 8g 糖,
  // 而指南那句的宾语是「含糖饮料」,不是「只有可乐」。
  cola: { tier: 'limit', verb: '喝', amount: '不喝或少喝' },
  'bubble-tea': { tier: 'limit', verb: '喝', amount: '不喝或少喝' },
  'orange-juice': { tier: 'limit', verb: '喝', amount: '不喝或少喝' },

  /* ---------- 其他 ---------- */
  // 准则三「（六）坚果有益,但不宜过量」—— 炒花生是全库唯一一条「有益但要限量」的
  peanut: { tier: 'moderate', verb: '吃', amount: '一小把，别过量' },
  chips: { tier: 'limit', verb: '吃', amount: '能不吃就不吃' },
  cake: { tier: 'limit', verb: '吃', amount: '能不吃就不吃' },
  chocolate: { tier: 'limit', verb: '吃', amount: '一小块，能不吃就不吃' },
}
