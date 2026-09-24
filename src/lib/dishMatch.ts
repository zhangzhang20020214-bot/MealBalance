/**
 * 菜品名 → 食物库条目
 * ===========================================================
 * 视觉模型返回的是**菜名**(「红烧肉」「清炒西兰花」),而 App 的营养计算只认
 * 食物库里的 `foodId`。这一层就是两边之间的桥。
 *
 * 为什么不能只做一次字符串相等
 * ------------------------------------------------------------
 * 两边的命名习惯根本不一样:
 *
 *   · 食物库的名字**带括号或带做法**(`米饭(熟)` / `红薯(蒸)` / `面条(煮)`),
 *     模型给的是「米饭」「红薯」「面条」。
 *   · 食物库的名字**带烹调方式前缀**(`清炒油麦菜` / `白灼西兰花` / `蒜蓉菠菜`),
 *     模型很可能只说「油麦菜」「西兰花」「菠菜」。
 *   · 反过来,模型也会说得更细(「清炒西兰花」),而库里是「白灼西兰花」。
 *
 * 所以是「归一化 → 精确 → 别名 → 去做法词 → 互相包含」这样一梯一梯往下走。
 *
 * 匹配不上分两种,**别把它们混成一种**
 * ------------------------------------------------------------
 * 食物库只有 58 项,而外卖和家常菜的名字是无穷的 —— 「土豆炖牛肉」「豆腐菌菇汤」
 * 都不在库里。这里**不做任何按分类的兜底猜测**:猜一个分类等于凭空编一份营养数据,
 * 而界面上没有任何地方看得出来是编的。
 *
 * 库里没有的菜走哪条路,取决于**上游有没有联网查到营养**:
 *
 *   · 查到了(`per100g` + `source`) → `web:<菜名>`,营养用查到的值算,
 *     界面上标出「联网估算」并写出出处。见下面第 6 层匹配。
 *   · 没查到 → `unmatched:<菜名>` 哨兵,克数 0、营养按 0 计,
 *     结果页和确认分量页都显式写「不在食物库里」。
 *
 * 两种都**保留在清单里**,因为「识别出一道菜但库里没有」这件事本身对用户有用;
 * 用前缀而不是空串,是因为 `MealSheet` 用 `key={item.foodId}` 渲染列表,
 * 几道菜都用空串会撞 key、让同一个步进按钮同时改好几行。
 *
 * 别名的边界:`DISH_ALIASES` 收「同一道菜的相近版本」,不收「某个成分像」的。
 * 土豆炖牛肉库里只有卤牛肉可映射,但土豆在那道菜里占一大半重量 —— 映射过去是
 * 一个**看起来合理的错数字**,比一条「未收录、按 0 计」的警告糟得多。
 * (这道菜现在正好是联网那条路的样板:查得到就写真值,查不到才落到哨兵。)
 *
 * 纯逻辑,不碰 DOM —— 可在 Node 里直接测(scripts/verify-loop.mjs)。
 */

import { FOODS, type Food, type FoodNutrition } from '../data/foods'
import type { MealItem } from '../store/types'

/** 未收录菜品的 foodId 前缀。加前缀而不是空串,理由见文件头 */
export const UNMATCHED_PREFIX = 'unmatched:'

export function isUnmatchedId(foodId: string): boolean {
  return foodId.startsWith(UNMATCHED_PREFIX)
}

/**
 * 「库里没有、但联网查到了营养」的菜品的前缀。
 *
 * 为什么不复用 `unmatched:` 那个哨兵、只给它挂上 `per100g`:
 *
 * 1. `isUnmatchedId()` 的语义必须保持纯粹 —— 它现在等于「**我们不知道**」。
 *    `derive.ts` 里那段把「已知的不知道」和「不知道的不知道」分得很清楚,
 *    哨兵项一旦有了营养,这个名字就开始说谎。
 * 2. `countableItems()` 的判据是 `!isUnmatchedId(...)`,新前缀**自动**被算成
 *    「有营养来源」—— 结果页的 `hasItems`、分量页的档位控件、分析中页的路由
 *    三处一行都不用改。
 * 3. 结果页那条黄色「不在食物库里,按 0 计」的警告条仍然只留给真正的哨兵项。
 *    把两者合成一种,等于让「有出处的估算」和「什么都没有」共用一句文案 ——
 *    而这两件事该不该提醒用户,答案正好相反。
 */
export const WEB_PREFIX = 'web:'

export function isWebId(foodId: string): boolean {
  return foodId.startsWith(WEB_PREFIX)
}

/**
 * 库外菜的**基准克数**。
 *
 * 提示词里写死了「不需要输出 grams……用户会在 App 里自己确认份量」,
 * 所以库外菜到手时**没有克数**,而营养要乘克数才有意义 —— 这里补上那个基准。
 *
 * 取 150 的依据:它是食物库里出现最多的常见分量(`data/foods.ts` 58 项里 17 项
 * 是 150g),所以「一份库外菜」和「一份库内菜」用的是同一个量级,不是另开一把尺子。
 *
 * ⚠ 它**不是从照片推出来的**,也不是模型给的 —— 和库内菜的 `defaultGrams`
 * 一样是个常量。所以它必须像库内菜那样**在「确认分量」那一屏由用户过一遍手**
 * (用户点「常规」= 确认 150g,见 `portion.ts` 里 `baseGramsFor` 的说明)。
 * 界面上**不许**把这个数包装成「估算」—— 那正是 `ResultScreen` 里
 * 「估算 150g」那句话被删掉的原因。
 *
 * 放这里(而不是 `portion.ts` / `nutrition.ts`):它是「库里没有 ⇒ 退回一个
 * 兜底基准」这条规则的产物,和 `clampGrams` 的 `[5, 1000]` 是同一类东西,
 * 而这条规则的家就是这个文件。放 `portion.ts` 会让本文件反向 import 成环。
 */
export const WEB_BASE_GRAMS = 150

/**
 * 有营养来源的菜 —— 也就是「算得出营养」的菜。排除 `unmatched:` 哨兵项。
 *
 * 抽出来是因为**这个判断以前在结果页又写了一遍**(`ResultScreen` 的 `countable`
 * memo),而两处各写一遍的代价上一轮已经付过一次:哨兵项的 `grams` 是 0,
 * 但它们是真实存在的条目,所以 `items.length > 0` 对「一盘全没认出来的菜」
 * 也是真 —— 结果页于是渲染出一张「本餐总热量 0 kcal」的结论卡。
 * 那个 bug 之所以没被测出来,是因为测试喂的是 `items: []`,一个
 * `matchDishes` 永远不会产出的形状。
 *
 * 所以「哪些菜算得出营养」只能有**一个**定义,就放在这里。
 *
 * 2026-09-20 加 `web:` 前缀时这个判据**一个字都没改** —— 库外菜的 id 不是
 * `unmatched:` 开头,所以它自动被算进来。这正是当初选「新前缀」而不是
 * 「把哨兵改宽」的理由之一(见上面 `WEB_PREFIX` 的注释)。
 */
export function countableItems(items: MealItem[]): MealItem[] {
  return items.filter((i) => !isUnmatchedId(i.foodId))
}

/** 模型给出的一道菜。`foodId` / `grams` / `per100g` 都是**可选**的 —— 提示词给不给,这里都能跑 */
export interface DishInput {
  name: string
  /** 模型估算的克数。缺省则用食物库的常见分量 */
  grams?: number
  /** 模型从目录里挑的 foodId。会被校验,不存在则退回按名字匹配 */
  foodId?: string
  /**
   * 库外菜联网查到的每 100g 值 + 出处。**只在库里匹配不到时才生效** ——
   * 库内命中的菜走食物库的值,那是同一把尺子,不该被搜索来的数覆盖
   * (同 Dify 侧「合并营养」节点里 `if d.get("foodId"): continue`)。
   */
  per100g?: FoodNutrition
  source?: string
  /**
   * 模型对这道菜的判断(`false` = 慎选)+ 它给的理由(「含花生」)。
   *
   * ⚠️ 解析层**早就拿到**这两个字段了(`AgentDish` 上一直都有),是配菜这一步
   * 把它们丢掉的 —— 于是「模型说了含花生」在卡片上一点痕迹都没有,危险的那道菜
   * 和别的菜长得一模一样。用户 2026-09-24 要的就是「把危险的字样和菜品标红」。
   *
   * 所以归并(`merged`)和拆分(`expandCombos`)时**都不许把它们抹掉**,
   * 规则见 `carryMark`。
   */
  suitable?: boolean
  reason?: string
}

export type MatchVia = 'declared' | 'exact' | 'alias' | 'core' | 'contains' | 'web' | 'none'

export interface DishMatch {
  /** 归一化之后的菜名 */
  name: string
  foodId: string
  grams: number
  via: MatchVia
}

export interface MatchResult {
  /** 可以直接进营养计算的清单 */
  items: MealItem[]
  /** 匹配不上的菜名(已归一化、已去重)—— 界面上要显式告知,不能静默按 0 计 */
  unmatched: string[]
  /** 每道菜的匹配方式,给自检和排查用 */
  detail: DishMatch[]
}

/* ------------------------------------------------------------
   归一化
   ------------------------------------------------------------ */

/**
 * 把菜名收拾成可比较的形式。
 *
 * 去括号注释是关键的一步 —— 库里存的是「米饭(熟)」,模型说的是「米饭」,
 * 不先剥掉这层,精确匹配在最常见的主食上就全断了。
 */
export function normalizeDishName(raw: string): string {
  let s = raw.trim()
  // markdown 强调符 —— 模型很爱加粗
  s = s.replace(/[*`_]/g, '')
  // 括号注释:米饭(熟) / 番茄（生） → 米饭 / 番茄
  s = s.replace(/[（(][^）)]*[）)]/g, '')
  // 前缀数量与单位:一份红烧肉 / 200g米饭 → 红烧肉 / 米饭
  s = s.replace(/^\d+(\.\d+)?\s*(g|kg|ml|克|千克|毫升|份|个|只|条|块|碗|杯|片|勺)?\s*/i, '')
  s = s.replace(/^[一二两三四五]?\s*[小大]?\s*[份碗杯个只条块勺份]\s*/, '')
  // 尾部标点
  s = s.replace(/[\s·、,，。.；;：:!！?？]+$/g, '')
  return s.trim()
}

/**
 * 烹调方式词。剥掉它们之后剩下的词更接近「这是什么食材」,
 * 于是「清炒西兰花」和库里的「白灼西兰花」能对上。
 *
 * 顺序有讲究:长的排前面,否则「清炒」会被「炒」先吃掉一半。
 * 只在**首尾**剥,不动中间 —— 「青椒炒肉丝」中间那个「炒」是菜名的一部分。
 */
const COOKING_WORDS = [
  '清炒', '白灼', '蒜蓉', '干煸', '凉拌', '红烧', '清蒸', '水煮', '爆炒', '素炒',
  '香煎', '油焖', '醋溜', '粉蒸', '烤', '煎', '炒', '蒸', '煮', '炖', '焖', '卤', '拌', '炸',
]

/**
 * 剥掉首尾的烹调方式词。
 *
 * 剥到剥不动为止(「清炒」剥完还剩「蒜蓉」的话继续剥),但如果剥完不足 2 个字
 * 就退回原样 —— 「炒饭」剥成「饭」再拿去匹配,风险大于收益。
 */
function stripCookingWords(s: string): string {
  let out = s
  let changed = true
  while (changed) {
    changed = false
    for (const w of COOKING_WORDS) {
      if (out.length - w.length >= 2 && (out.startsWith(w) || out.endsWith(w))) {
        out = out.startsWith(w) ? out.slice(w.length) : out.slice(0, -w.length)
        changed = true
        break
      }
    }
  }
  return out.length >= 2 ? out : s
}

/* ------------------------------------------------------------
   别名表
   ------------------------------------------------------------ */

/**
 * 模型常用的说法 → 食物库 id。
 *
 * 这张表是「模型说 A,库里叫 B」这件事**显式**记下来的地方。
 * 用表而不是上模糊匹配,是因为每一条都是可以 review 的判断;
 * 模糊匹配一旦错配,错的是营养数据,而且没人看得出来。
 *
 * 收哪些、不收哪些
 * ------------------------------------------------------------
 * 大多数条目来自 `npm run probe:dishes` 的输出 —— 它把一批真实菜名喂进来,
 * 列出落空的和用 contains 兜住的。**落空不等于该收**,判据是:
 *
 *   · 库里有**同一道菜的相近版本** → 收(「糖醋排骨」→ 红烧排骨)
 *   · 只有「某个成分像」→ **不收**。比如「土豆炖牛肉」,库里有卤牛肉,
 *     但土豆在这道菜里占一大半重量,映射过去等于把一份有主食的菜算成
 *     一小碟瘦肉 —— 那是个**看起来合理的错数字**,比一条「未收录、按 0 计」
 *     的警告糟得多(见文件头「匹配不上就明说匹配不上」)。
 *
 * 收了的是近似,不是精确 —— 糖醋汁里的糖、炒饭里的油,库里那一条都不含。
 * 偏差方向统一是**偏低**,这是有意的:宁可低估,不要编一个高的。
 *
 * 导出给自检用(`scripts/verify-loop.mjs`):那里有一条断言遍历整张表,确认
 * 每个 value 都指向真实存在的 id —— 写错一个字母,今天的行为是**静默退回**
 * 按名字匹配,也就是那条别名悄无声息地失效,不报错。
 */
export const DISH_ALIASES: Record<string, string> = {
  // 主食
  白米饭: 'rice', 大米饭: 'rice', 白饭: 'rice', 米饭: 'rice', 饭: 'rice', 蒸米饭: 'rice',
  // 炒饭类:库里没有单独的蛋炒饭,米是这道菜的主体。油和蛋没算进去 → 偏低
  蛋炒饭: 'rice', 炒饭: 'rice', 扬州炒饭: 'rice',
  糙米: 'brown-rice', 杂粮饭: 'brown-rice',
  面条: 'noodles', 面: 'noodles', 拉面: 'noodles', 挂面: 'noodles', 汤面: 'noodles',
  // 面条类的变体。汤和浇头的钠/油没算 → 偏低
  牛肉面: 'noodles', 兰州拉面: 'noodles', 炒面: 'noodles', 拌面: 'noodles',
  粥: 'congee', 白粥: 'congee', 稀饭: 'congee', 小米粥: 'congee',
  燕麦: 'oatmeal', 燕麦粥: 'oatmeal', 燕麦牛奶粥: 'oatmeal',
  面包: 'whole-wheat-bread', 全麦: 'whole-wheat-bread', 吐司: 'whole-wheat-bread',
  馒头: 'mantou', 花卷: 'mantou',
  小笼包: 'xiaolongbao', 包子: 'xiaolongbao',
  饺子: 'dumpling', 水饺: 'dumpling', 蒸饺: 'dumpling',
  玉米: 'corn', 玉米段: 'corn',
  红薯: 'sweet-potato', 地瓜: 'sweet-potato', 番薯: 'sweet-potato',

  // 蛋奶豆
  鸡蛋: 'boiled-egg', 蛋: 'boiled-egg', 水煮蛋: 'boiled-egg', 白煮蛋: 'boiled-egg', 水煮鸡蛋: 'boiled-egg',
  煎蛋: 'fried-egg', 荷包蛋: 'fried-egg', 太阳蛋: 'fried-egg', 煎鸡蛋: 'fried-egg',
  牛奶: 'milk', 鲜奶: 'milk',
  豆浆: 'soy-milk',
  酸奶: 'yogurt',
  豆腐: 'tofu-firm', 老豆腐: 'tofu-firm', 北豆腐: 'tofu-firm',
  嫩豆腐: 'tofu-soft', 南豆腐: 'tofu-soft',

  // 肉类
  红烧肉: 'braised-pork', 猪肉: 'braised-pork', 五花肉: 'braised-pork',
  // 扣肉就是五花肉做的
  梅菜扣肉: 'braised-pork',
  排骨: 'braised-ribs',
  // 同为排骨;糖醋汁里的糖没算 → 偏低
  糖醋排骨: 'braised-ribs',
  宫保鸡丁: 'kungpao-chicken', 宫爆鸡丁: 'kungpao-chicken',
  鸡肉: 'boiled-chicken', 鸡胸肉: 'boiled-chicken', 鸡胸: 'boiled-chicken', 白斩鸡: 'boiled-chicken',
  鸡腿: 'roast-drumstick',
  西红柿炒鸡蛋: 'tomato-egg', 番茄炒鸡蛋: 'tomato-egg', 西红柿鸡蛋: 'tomato-egg', 番茄鸡蛋: 'tomato-egg',
  青椒肉丝: 'pepper-pork', 尖椒肉丝: 'pepper-pork',
  // 都是瘦肉丝/条的炒菜,拿「青椒肉丝」当瘦肉基准。甜面酱和糖醋汁的糖没算 → 偏低
  京酱肉丝: 'pepper-pork', 糖醋里脊: 'pepper-pork',
  回锅肉: 'twice-cooked-pork',
  牛排: 'steak',
  牛肉: 'braised-beef', 酱牛肉: 'braised-beef',
  // 牛柳是牛肉条
  黑椒牛柳: 'braised-beef',

  // 水产
  鱼: 'steamed-fish', 鲈鱼: 'steamed-fish', 清蒸鲈鱼: 'steamed-fish', 蒸鱼: 'steamed-fish',
  虾: 'boiled-shrimp', 白虾: 'boiled-shrimp', 基围虾: 'boiled-shrimp', 虾仁: 'boiled-shrimp',
  // 虾是主体;底下的粉丝没算 → 偏低
  蒜蓉粉丝蒸虾: 'boiled-shrimp',
  三文鱼: 'salmon',
  水煮鱼: 'boiled-fish-spicy', 酸菜鱼: 'boiled-fish-spicy',

  // 蔬菜
  油麦菜: 'lettuce-stir',
  菠菜: 'spinach-garlic',
  西兰花: 'broccoli', 西蓝花: 'broccoli',
  黄瓜: 'cucumber-salad', 拍黄瓜: 'cucumber-salad',
  四季豆: 'green-beans', 豆角: 'green-beans',
  麻婆豆腐: 'mapo-tofu',
  青菜: 'stir-veggies', 时蔬: 'stir-veggies', 蔬菜: 'stir-veggies', 素菜: 'stir-veggies', 炒青菜: 'stir-veggies',
  // 「素炒时蔬」那一条本来就是给这类菜兜底的:名字不认识的蔬菜炒菜
  干锅花菜: 'stir-veggies', 上汤娃娃菜: 'stir-veggies', 蚝油生菜: 'stir-veggies',
  番茄: 'tomato-raw', 西红柿: 'tomato-raw', 圣女果: 'tomato-raw',

  // 水果
  苹果: 'apple', 香蕉: 'banana', 橙子: 'orange', 橘子: 'orange', 葡萄: 'grape', 蓝莓: 'blueberry',
  西瓜: 'watermelon',

  // 汤羹
  紫菜蛋花汤: 'seaweed-egg-soup', 蛋花汤: 'seaweed-egg-soup',
  // 「番茄鸡蛋汤」必须先在这里落定,否则会掉进 contains 层命中「番茄(生)」——
  // 一条汤算成一份生番茄,而界面上看不出异常。findContains 里的 isSoup 是
  // 第二道防线,管的是这张表没预料到的汤名
  番茄鸡蛋汤: 'seaweed-egg-soup', 西红柿鸡蛋汤: 'seaweed-egg-soup',
  番茄牛腩: 'tomato-beef-soup', 牛腩汤: 'tomato-beef-soup', 番茄牛腩煲: 'tomato-beef-soup',
  // 罗宋汤就是番茄牛肉汤的洋名
  罗宋汤: 'tomato-beef-soup',
  排骨汤: 'wintermelon-soup', 冬瓜汤: 'wintermelon-soup', 冬瓜排骨汤: 'wintermelon-soup',
  // 玉米排骨汤也归这里。它本来是掉进 contains 层的:命中「玉米(煮)」——
  // 一道汤算成一根玉米。加这条之前先想清楚为什么不是「玉米」:汤的钠和
  // 排骨才是这碗东西的主体,玉米只是配料
  玉米排骨汤: 'wintermelon-soup',

  // 饮品
  咖啡: 'americano', 美式: 'americano', 美式咖啡: 'americano',
  拿铁: 'latte',
  可乐: 'cola',
  奶茶: 'bubble-tea',
  橙汁: 'orange-juice',

  // 其他
  薯片: 'chips', 薯条: 'chips',
  花生: 'peanut', 花生米: 'peanut', 炒花生米: 'peanut', 油炸花生: 'peanut',
  蛋糕: 'cake',
  巧克力: 'chocolate',
}

/* ------------------------------------------------------------
   克数
   ------------------------------------------------------------ */

/**
 * 夹取克数 —— 模型给的,或者「基准 × 份量倍数」算出来的。
 *
 * 模型偶尔会给离谱的值(一碗米饭 1500g),或者给字符串 "150g"。
 * 取不到、不是有限数、超出 [5, 1000] 一律退回 `fallback` ——
 * 一个明显错误的数字比一个保守的默认值更糟。
 *
 * 上限取 1000 而不是 2000:库里最大的常见份量是 500g(一杯奶茶),
 * 1000 已经是它的两倍。再往上就不可能是「一份菜」,而是模型把整桌的量,
 * 或者把「克」当成了「千焦」。这种值放过去,一份米饭就能顶掉全天热量配额,
 * 而界面上看不出它是错的。
 *
 * 取整到 5g:识别本来就是估算,「150g」比「152g」更诚实,也更像估算的样子。
 *
 * 导出给 `portion.ts` 复用 —— 三档份量要的正是同一套「取整到 5g + 夹到
 * [5,1000]」语义,再写一遍就会有两套边界,早晚对不上。
 */
export function clampGrams(raw: unknown, fallback: number): number {
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseFloat(raw) : Number.NaN
  if (!Number.isFinite(n) || n < 5 || n > 1000) return fallback
  return Math.round(n / 5) * 5
}

/* ------------------------------------------------------------
   匹配
   ------------------------------------------------------------ */

/** 在给定食物集合里找精确匹配(按归一化后的名字) */
function findExact(name: string, foods: Food[]): Food | undefined {
  return foods.find((f) => normalizeDishName(f.name) === name)
}

/**
 * 「汤」的判据。
 *
 * 这条规则是**从实测里长出来的**,不是想出来的:`scripts/probe-dishes.mjs` 把
 * 一批真实菜名喂进来,「番茄鸡蛋汤」命中了库里的「番茄(生)」—— 一道汤被算成
 * 一份生番茄,21 kcal 顶掉一碗蛋花汤的 250g。而界面上**看不出任何异常**,
 * 和 COMBO_SEP 那段是同一个失效模式:**错配比落空更糟**,落空会被显式标成
 * 「按 0 计」,错配不会。
 *
 * 规则本身很简单:名字以「汤」结尾的就是一道汤,而汤只能落到 `汤羹` 那一类里。
 * 不满足就直接跳过这个候选,让它继续往下走 —— 走到最后还是没匹配上,就如实
 * 标成未收录。**宁可显示「不知道」,不要显示一个错的。**
 *
 * 用 `endsWith` 而不是 `includes` 也是这个道理:「汤圆」里有「汤」但它不是汤,
 * 拿 includes 会把「汤圆」也误伤成未收录(虽然库里本来也没有汤圆)。
 */
const isSoup = (name: string) => name.endsWith('汤')

/**
 * 双向包含匹配。
 *
 * 「清炒西兰花」包含不了「白灼西兰花」,反过来也一样 —— 所以这一层只兜得住
 * 一方是另一方子串的情况(「米饭」⊂「糙米饭」、「牛肉」⊂「卤牛肉」)。
 * 真正跨过做法差异的是上一层的 stripCookingWords。
 *
 * 命中的子串至少要 2 个字,否则「饭」会匹配上库里一大半的东西。
 * 多个候选时取**匹配得更长**的那个 —— 那是更具体的一条。
 */
function findContains(name: string, foods: Food[]): Food | undefined {
  let best: { food: Food; score: number } | undefined

  for (const food of foods) {
    // 「X汤」必须落到汤羹里 —— 见上面 isSoup 的注释
    if (isSoup(name) && food.category !== '汤羹') continue

    const foodName = normalizeDishName(food.name)
    let score = 0
    if (foodName.length >= 2 && name.includes(foodName)) score = foodName.length
    else if (name.length >= 2 && foodName.includes(name)) score = name.length

    if (score >= 2 && (!best || score > best.score)) best = { food, score }
  }

  return best?.food
}

/**
 * 组合名的分隔符 —— 模型报的是「一餐」而不是「一道菜」时用的连接符。
 *
 * 实测会走到这里:一张纯色图走真实链路,工作流落到了它的推荐分支,回来的
 * `dishes` 是「燕麦粥 + 煮鸡蛋 + 牛奶」「清蒸鱼 + 白灼西兰花 + 米饭」这种
 * **一餐的组合名**。不拆的话,findContains 会把整串名字当成一道菜,
 * 而它取的是「包含得更长」的那个 —— 于是「清蒸鱼 + 白灼西兰花 + 米饭」
 * 变成**一条西兰花**,鱼和米饭静默消失,热量报小了而界面上看不出异常。
 * 那比匹配不上更糟:匹配不上会被显式标成「按 0 计」,错配不会。
 *
 * 只认 `+` / `＋` / `、` 三种,**刻意不认逗号** —— 逗号更可能是模型在名字
 * 后面接了一句解释(「红烧肉，肥而不腻」),拆开会把解释也当成一道菜。
 */
const COMBO_SEP = /[+＋、]/

/**
 * 把组合名拆成单道菜。
 *
 * 三道防线,都是为了不制造出**没有依据的数字**:
 *   · 模型给了 `grams` 的不拆 —— 那是**整份**的克数,拆成三份各自带上就是三倍
 *   · 模型给了 `foodId` 的不拆 —— 它明确指了一个食物,不该被拆成三个
 *   · 模型给了 `per100g` 的不拆 —— 同 `grams`,那是**整份**的口径。
 *     不透传 → 拆出来的每一份都没有值,整道菜按 0 计;透传给每一份 →
 *     一份的营养被当成三份各自一份,**克数与营养一起翻三倍**。
 *     两条路都不出声,所以这条防线必须写下来(同 `grams` 那条的理由)。
 * 只拆「纯名字」。我们的提示词现在前两个字段都不给,所以这条路上都会拆;
 * 哪天提示词加上了,行为也不会错。
 */
function expandCombos(dishes: DishInput[]): DishInput[] {
  const out: DishInput[] = []

  for (const dish of dishes) {
    if (
      dish.grams !== undefined ||
      dish.foodId !== undefined ||
      dish.per100g !== undefined ||
      !COMBO_SEP.test(dish.name)
    ) {
      out.push(dish)
      continue
    }
    for (const part of dish.name.split(COMBO_SEP)) {
      const name = part.trim()
      /*
        ⚠️ **拆出来的每一半都得继承母项的判断**(慎选 + 理由)。
        组合菜正是用户嘴里那个「进餐组合」:一道「花生拌菠菜配米饭」被判慎选,
        拆成两半后要是各印一行干净的菜,那道菜里有花生的提示就**在这一步没了**
        —— 而屏幕上看起来一切正常。理由同 `carryMark`。
      */
      if (!name) continue
      out.push({
        name,
        ...(dish.suitable === false ? { suitable: false } : {}),
        ...(dish.reason ? { reason: dish.reason } : {}),
      })
    }
  }

  return out
}

/**
 * 把模型返回的一串菜名匹配到食物库。
 *
 * @param dishes 模型给出的菜
 * @param foods  食物库(可注入,便于自检)
 */
export function matchDishes(dishes: DishInput[], foods: Food[] = FOODS): MatchResult {
  const detail: DishMatch[] = []
  const unmatched: string[] = []

  // 先按 foodId 归并,再输出 —— 两道菜落到同一个 foodId 时必须合成一项。
  // 不合成的话 `MealSheet` 会用 `key={item.foodId}` 渲染出重复 key,
  // 分量步进按钮会同时改好几行。
  const merged = new Map<string, MealItem>()

  /**
   * 把模型对这道菜的判断带到归并后的那一项上。
   *
   * **规则是「低调的那个赢」**:两道菜落同一个 foodId 合成一项时,只要有一道
   * 被标了慎选,合并后那一项就得继续标红。反过来(后到的覆盖先到的)会让
   * 「有花生的那半」被「没有花生的那半」洗白 —— 而这恰恰是不能出错的地方,
   * 而且洗白之后屏幕上完全看不出来。
   *
   * 理由只从**被标慎选的那道菜**上取,并且取第一条:模型对每道菜都给理由
   * (「推荐」的菜也有),先到的那个「好吃」印在一条红行上就是造谣。
   */
  const carryMark = (item: MealItem, dish: DishInput) => {
    if (dish.suitable !== false) return
    item.suitable = false
    const reason = dish.reason?.trim()
    if (reason && !item.reason) item.reason = reason
  }

  for (const dish of expandCombos(dishes)) {
    const name = normalizeDishName(dish.name)
    if (!name) continue

    let food: Food | undefined
    let via: MatchVia = 'none'

    // 1. 模型自己挑的 foodId —— 但要校验。模型编一个不存在的 id 和给一个
    //    真的 id 长得一模一样,不校验就会变成一条 kcal 为 0 的静默错数据
    if (dish.foodId) {
      const declared = foods.find((f) => f.id === dish.foodId)
      if (declared) {
        food = declared
        via = 'declared'
      }
    }

    // 2. 归一化后精确
    if (!food) {
      const hit = findExact(name, foods)
      if (hit) {
        food = hit
        via = 'exact'
      }
    }

    // 3. 别名表
    if (!food) {
      const aliasId = DISH_ALIASES[name]
      const hit = aliasId ? foods.find((f) => f.id === aliasId) : undefined
      if (hit) {
        food = hit
        via = 'alias'
      }
    }

    // 4. 剥掉做法词后再精确 —— 清炒西兰花 ↔ 白灼西兰花
    if (!food) {
      const core = stripCookingWords(name)
      if (core !== name) {
        const hit = findExact(core, foods) ?? (DISH_ALIASES[core] ? foods.find((f) => f.id === DISH_ALIASES[core]) : undefined)
        if (hit) {
          food = hit
          via = 'core'
        }
      }
    }

    // 5. 双向包含
    if (!food) {
      const hit = findContains(name, foods)
      if (hit) {
        food = hit
        via = 'contains'
      }
    }

    // 6. 库里确实没有,但工作流联网查回来了一份每 100g 值 —— 用它算
    //
    // **位置和那个 `!food` 都不能少。** 上面五层任何一层命中都说明食物库里有
    // 对应的一条,那就该用库里的值:库里那 58 条是同一把尺子量出来的,
    // 搜索结果不是。漏掉 `!food` 的后果不是「稍微不准」,而是**每一道给了联网值的
    // 菜都绕过目录**(verify-loop 里那条「库里匹配到时联网值不参与」就是拦这个的);
    // 把整块挪到最前面是同样的错。与「目录优先」直接矛盾 ——
    // 同 Dify 侧「合并营养」节点里的 `if d.get("foodId"): continue`,
    // 和 `lib/nutrition.ts` 里 `per100gOf` 的取值顺序。
    //
    // 它**不进 `unmatched`**。那个数组的语义是「不在食物库里,按 0 计」,
    // 会渲染成结果页那条黄色警告条;这一项有值、且界面上会标出来源,
    // 混进去等于对着一个真实的数字说「按 0 计」。
    //
    // `source` 要 **trim 后非空**:`'  '` 是个真值,而一个只有空白的出处
    // 在界面上会渲染成「来自联网检索()」—— 宁可当它没有出处,退回哨兵项。
    // (解析层 `asText` 已经 trim 过一道,这里是匹配层自己的那一半:
    //  `DishInput` 是公开接口,别处也能构造。)
    const source = dish.source?.trim()
    if (!food && dish.per100g && source) {
      const foodId = `${WEB_PREFIX}${name}`
      // 克数:模型给了就用模型给的(与库内菜同一条规矩 —— 同一个字段在两种菜上
      // 各有一套处理,才是真的会出错的地方),没给才落到基准 150g。
      // 两条路都过 `clampGrams` —— 它是**拒收**不是夹取(超出 [5,1000] 退回落差
      // 参数),所以库外菜也不会出现 3g 或 5000g 这种值。
      const grams = clampGrams(dish.grams, WEB_BASE_GRAMS)
      detail.push({ name, foodId, grams, via: 'web' })

      const existing = merged.get(foodId)
      // **累加,不是覆盖。** 哨兵分支那里用 `set` 是无害的(grams 恒为 0),
      // 这里不是:两道名字归一化后相同的菜(「土豆炖牛肉」/「一份土豆炖牛肉」)
      // 走覆盖就是**静默丢掉一整份**,热量直接少一半而界面上看不出来。
      // 镜像下面库内菜那条 `existing.grams += grams`。
      //
      // 两份的 `per100g` 不一样时:**先到者赢**,不覆盖已确立的值。
      // 「这道菜有多少克」和「它每 100g 是多少」是两件事 —— 后者是这一项的
      // 身份。两份来自不同网页的检索值谁更对,这里判不了,所以不改写。
      if (existing) {
        existing.grams += grams
        carryMark(existing, dish)
      } else {
        const item: MealItem = { foodId, name, grams, per100g: dish.per100g, source }
        carryMark(item, dish)
        merged.set(foodId, item)
      }
      continue
    }

    if (!food) {
      // 库里确实没有。保留在清单里但带上哨兵 id —— 用户能在修正面板里看到并处理
      unmatched.push(name)
      detail.push({ name, foodId: `${UNMATCHED_PREFIX}${name}`, grams: 0, via: 'none' })
      // 落空的一道菜照样可能被判慎选(而且它热量是 0,标红就更要紧)
      const item: MealItem = { foodId: `${UNMATCHED_PREFIX}${name}`, name, grams: 0 }
      carryMark(item, dish)
      merged.set(`${UNMATCHED_PREFIX}${name}`, item)
      continue
    }

    const grams = clampGrams(dish.grams, food.defaultGrams)
    detail.push({ name, foodId: food.id, grams, via })

    const existing = merged.get(food.id)
    if (existing) {
      existing.grams += grams
      carryMark(existing, dish)
    } else {
      // 名字用**模型说的那个**,不用库里的 —— 这两个经常不一样:
      // 「清炒西兰花」匹配到库里的「白灼西兰花」,「香煎鸡胸肉」匹配到「白切鸡」。
      // 营养按库里那条算(那是有依据的近似),但名字必须还原成用户真正吃的东西 ——
      // 拍了一盘香煎鸡胸肉,结果页写着「白切鸡」,用户只会认为识别错了。
      const item: MealItem = { foodId: food.id, name: name || food.name, grams }
      carryMark(item, dish)
      merged.set(food.id, item)
    }
  }

  return { items: [...merged.values()], unmatched, detail }
}
