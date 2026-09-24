import type { FoodNutrition } from '../data/foods'
import { ageOn, formatBirth, type Birth } from '../lib/age'

/**
 * 一天里的餐次 —— 六个。三餐各一个窄窗口,窗口之间和之后的三段是加餐。
 *
 * 三档加餐是为了让「随手记一口」**落在对的那一段**上:原来只有一个「加餐」,
 * 而它实际只在 21:00 之后出现(上午十点、下午三点吃的那两顿被算进了午餐/晚餐)。
 *
 * 时段的划分、这些取值的顺序、以及「哪个钟点算哪一餐」全在 `lib/slots.ts`,
 * **那里是唯一的定义处** —— 包括 `MEAL_SLOTS` / `MAIN_SLOTS` / `SLOT_ROWS` 那几张表。
 * 这个类型放在这里而不是那边,是因为它是**落盘类型**(`MealEntry.slot` 存的就是它),
 * 和 `persist.ts` 的版本判据绑在一起。
 *
 * ⚠️ **删掉了 `加餐` 这个取值,所以 SCHEMA_VERSION 7 → 8**,附带一条不丢数据的
 * 迁移(按每条记录自己的 `time` 改成对的那一档)。判据与代价见 `persist.ts` 的 v8 那条。
 */
export type MealSlot = '早餐' | '上午加餐' | '午餐' | '下午加餐' | '晚餐' | '夜宵'

/**
 * 这条记录是怎么来的 —— 会显示在日记里,也是区分"拍照识别"与"手动补记"的依据
 *
 * `'对话记录'` 是 2026-09-24 加的:打字问出来的那几道菜也能补记进日记了
 * (见 `store/unlogged.ts` 文件头)。它**不是**「拍餐盘」(没拍过照片),
 * 也**不是**「手动记录」(用户没填过任何一张表)—— 那两条都是假话。
 * 营养只来自食物库的常见分量,这一点和手动记的一条相同。
 */
export type MealSource = '手动记录' | '拍餐盘' | '对话记录'

/** 一餐里的一项:引用了食物库的某个食物 + 实际分量 */
export interface MealItem {
  foodId: string
  /** 冗余存一份名字:食物库换版本后旧记录仍能显示 */
  name: string
  grams: number
  /**
   * 每 100g 的值。**只有库外菜才有** —— 库里没有对应项时,Dify 工作流会去
   * 联网查一个回来,连同 `source` 一起挂在条目上(口径与食物库一致:
   * 每 100g、熟食、可食部)。库内命中的条目不存这个键,营养照旧查食物库。
   *
   * 取值必须走 `lib/nutrition.ts` 的 `per100gOf` —— 它管着「两个来源谁优先」,
   * 全 App 只有那一处定义。直接写 `FOOD_BY_ID.get(item.foodId)` 会**静默**
   * 把库外菜算成 0。
   *
   * 加这个可选字段**不需要 bump SCHEMA_VERSION**,但理由和下面的 `thumb`
   * **不一样**,别照抄那句:这里是因为**旧记录里不可能有 `web:` 开头的 foodId**
   * (那是这次才有的东西),所以旧数据缺这个键永远不会被读到。
   * 而且它必须**落盘**:归档之后日记页、首页合计、周趋势都还要拿它算。
   */
  per100g?: FoodNutrition
  /**
   * 上面那份 `per100g` 的出处(网页名/数据库名,如「薄荷健康」)。
   *
   * 和 `per100g` 同生共死,且**不允许为空串**:一个没有出处的数字不许进计算
   * (见 `agentReply.asPer100g` 那道闸门)。界面上它就是这个字段的唯一用途 ——
   * 结果页把「联网估算」标出来时,靠的正是「这一项有没有 source」。
   */
  source?: string
  /**
   * 模型判定这道菜**不能吃**(`false` = 慎选)。只有这一种取值会落盘 ——
   * 字段缺失不是「适宜」,是「模型没提」,界面上不许据此印任何
   * 「适合/安全」的话(同 `AgentDish.suitable` 那条注释)。
   *
   * ## 为什么要落进 `MealItem`,而不是渲染时回查 `agentReply.dishes`
   *
   * 配菜那一步(`matchDishes`)会**归并**(两道菜落同一个 foodId 合成一项)、
   * 也会**拆开**(组合菜按 `expandCombos` 分成几半)。回查只能按菜名对,而
   * 归并后的那一项挂着哪一半的名字是不确定的 —— 对不上就**静默**丢掉标红,
   * 而「危险的那道菜没标出来」正是用户 2026-09-24 报的那个洞。所以让它在
   * **匹配层**跟着条目走,和 `per100g` 是同一条思路。
   *
   * 加这个可选字段和 `per100g` 一样**不需要 bump SCHEMA_VERSION**:旧记录里
   * 不可能有这个键(那时候还没人写它),读到的永远是 undefined → 不标红。
   */
  suitable?: boolean
  /**
   * 模型给的理由(「含花生」)—— 界面上它就是那一行的**危险字样**。
   *
   * 只在 `suitable === false` 时印:`AgentDish.reason` 是每道菜都有的字段,
   * 「推荐」的菜也带理由,那句不是警告,跟着标红印出来就是造谣。
   *
   * 它必须**落盘**:归档之后用户还会在日记页重开这一餐 —— 只留一个红名字、
   * 不留理由,用户看不出红在哪,也就没法判断该不该在意。
   */
  reason?: string
}

/** 一条餐次记录 */
export interface MealEntry {
  id: string
  /** YYYY-MM-DD,按本地时区 */
  date: string
  slot: MealSlot
  /** HH:mm */
  time: string
  source: MealSource
  items: MealItem[]
  /** 毫秒时间戳,用于同一天内的稳定排序 */
  createdAt: number
  /**
   * 拍餐盘那张图的**缩略图**,200px 的 JPEG data URL(约 8–12KB)。
   *
   * 两条边界,都很重要:
   *
   * · **只存缩略图,不存原图。** persist.ts 会把整棵 meals 树 JSON.stringify
   *   写进 localStorage,一张 1280px 的原图 base64 之后是 1MB 量级,几餐就把
   *   5MB 的配额吃满了。尺寸就是这个取舍的全部 —— 想改大之前先算配额账。
   *
   * · **它是可选的,而且可以是空的。** 手动记录没有照片;降级成演示数据时
   *   刻意不带(那份营养是编的,配一张真照片等于把假数据坐实)。所以渲染方
   *   必须能接受 undefined —— 日记页退回图标位。
   *
   * 加这个可选字段**不需要 bump SCHEMA_VERSION**:persist.ts 的 isAppState
   * 不校验 MealEntry 的内部字段,旧数据读进来只是没有这个键。bump 的代价是
   * 把用户现有的记录全部丢弃,不值得为一个可选字段付。
   */
  thumb?: string
}

/**
 * 忌口的类型 —— 三种。**每一种都会被拿去逐道菜核对。**
 *
 * 这一格**一天里改过三次**,三代尺子并排留在这里,别只看最后一把
 * ------------------------------------------------------------
 * **上午 · 尺子是「会不会拦菜」** —— 删掉了 `preference`(「少吃」),理由是它和
 * `Profile.dietaryPreferences`(「饮食偏好」)行为完全一样:都不拦、都只是发给
 * 食衡的一句话,却是两个字段、两个 payload 键。用户当时的判词是
 * 「忌口与偏好似乎与饮食偏好有所重复」。
 *
 * **下午 · 尺子换成「具体食物 / 整体模式」** —— `dietaryPreferences` 的含义变了
 * (不再收「不拦的忌口」,改收「整体怎么吃 + 喜欢吃什么」),具体食物的负面清单
 * 按 `dislike`(「不爱吃」)加回这个数组,**它不拦**。当时修对的是那张预设词表
 * 填错了词(「不吃香菜」摆在从不拦菜的一格里)。
 *
 * **傍晚 · 尺子换成「喜欢吃的 / 不想吃的」** —— 用户的原话是「都说了不吃折耳根
 * 归忌口,偏好只记喜欢吃的」。于是 `dislike` **删掉**:这个数组里**每一种类型都
 * 会被拿去逐道菜核对**,而「饮食偏好」收窄成只收「喜欢吃什么」。判据一句话:
 *
 *     喜欢吃什么(爱吃鱼)          → 「饮食偏好」—— 只给模型看,不参与拦截
 *     不想吃的(香菜,以及「素食」这类整体) → 这个数组 —— 每一种都参与拦截
 *     口味轻重 / 健康目标(少辣、控盐) → 「饮食目标」
 *
 * ⇒ 所以**别再从这把尺子推「哪一格不拦」**:今天这里没有不拦的类型。
 * 「不拦」这件事整个不在这一层了,它只存在于「偏好」那个字段里。
 *
 * ⚠️ **加取值不需要 bump `SCHEMA_VERSION`,删取值必须 bump。**
 * 这条判据下午被写下来,傍晚就**被自己用上了**:下午那次是加(停在 v6),
 * 傍晚这次是删,于是 v6 → v7,代价是清一次本机已经记下的数据
 * (见 `persist.ts` 的 v7 那条,以及下面 `HARD_BLOCK_TYPES` 那段)。
 * 下一次动这个联合类型的人:先回去读那份版本清单。
 *
 * 这个字段不是给界面看的(档案页只读它决定显示哪个后缀),是给工作流的拦截逻辑看的。
 */
export type RestrictionType = 'allergy' | 'taboo' | 'drug'

/** 严重程度,界面上的说法 */
export type RestrictionLevel = '高危' | '中危' | '低危'

/** 一条忌口 */
export interface Restriction {
  /**
   * 忌口的**具体食物**,裸词 —— 存「花生」,不是「花生过敏」。
   *
   * 为什么这么较真:Dify 工作流判断命中的写法是 `if item in haystack`
   * 这种子串匹配。存成「花生过敏」的话,`"花生过敏" in "我吃了花生"` 是
   * False —— 过敏原拦截在最该触发的时候不触发,而且不报错,看不出来。
   */
  item: string
  type: RestrictionType
  level: RestrictionLevel
}

/** 忌口在界面上的说法 —— 存的是裸词「花生」,显示要还原成「花生过敏」 */
const RESTRICTION_SUFFIX: Record<RestrictionType, string> = {
  allergy: '过敏',
  taboo: '忌口',
  drug: '用药禁忌',
}

export function restrictionLabel(r: Restriction): string {
  return `${r.item}${RESTRICTION_SUFFIX[r.type]}`
}

/**
 * 三种类型的选择项 —— **从 `RESTRICTION_SUFFIX` 派生**,不是另抄一份。
 *
 * 面板里那排按钮的文字和存进 `type` 的值有严格的对应关系:`restrictionLabel`
 * 靠它把「花生」还原成「花生过敏」。两份表并存的话,改了其中一份就会出现
 * 「界面上写着过敏、存下来是忌口」这种查不出来的错位。
 *
 * 顺序跟着上面那张表 —— 字面量的键序在 JS 里是稳定的。
 */
export const RESTRICTION_TYPES: { value: RestrictionType; label: string }[] = (
  Object.keys(RESTRICTION_SUFFIX) as RestrictionType[]
).map((value) => ({ value, label: RESTRICTION_SUFFIX[value] }))

export const RESTRICTION_LEVELS: RestrictionLevel[] = ['高危', '中危', '低危']

/* ------------------------------------------------------------
   忌口分两段 —— 过敏归健康,忌口归饮食
   ------------------------------------------------------------
   档案页上它们是**两张卡**:「健康信息」和「饮食信息」。用户的原话是「忌口属于饮食,
   过敏属于健康」。

   ⚠️ 这一套是**唯一**一份「哪个类型属于哪一段」。档案页按它决定一条忌口出现在哪张卡,
   面板按它决定列出什么、选择器给什么选项。写成两个表达式必然走散,而走散的表现是最坏
   的一种:**某个类型两边都不认 —— 那一行在档案页上一张卡里都不出现、也就永远改不了,
   可它照样发给工作流、照样拦菜。**

   ⚠️ **档案里有两把尺子,别拿一张推另一张**(2026-09-22 一天里来回改过三次):

     分段(`HEALTH_TYPES`)       allergy|drug  /  taboo
     硬拦截(`HARD_BLOCK_TYPES`) allergy|taboo|drug  /  ——

   今天它们**恰好重合**(分段是硬拦截的一个切分),但**不是同一件事**:分段决定一条
   忌口落在哪张卡上,硬拦截决定它会不会被拿去逐道菜核对。下午有一版它们真的分开过
   (饮食段里一条拦、一条不拦),所以「今天重合」是一个**结论**,不是前提 ——
   拿分段去推「这条会不会拦」在今天是能推对的,在下午那版会推错。

   现在它是**两段对三个类型**:2 + 1。
   ------------------------------------------------------------ */

/**
 * 会被**硬拦截**的类型 —— 也就是「这个词拿去逐道菜核对」的那几类。
 *
 * ⚠️ 这一行是本地拦截(`advice.ts`)和线上工作流之间的**同一份事实**:Dify 的
 * 过敏原拦截节点判的也是 `type in ("allergy","taboo","drug")`。改这里等于同时
 * 改两边的行为 —— 而两边不一致的表现是:App 里说「已拦截」,发给食衡的请求里
 * 却没有拦(或者反过来)。
 *
 * ⚠️ **它今天又覆盖了全部类型** —— 这一天里它的形状变过三次:上午覆盖全部(三个类型
 * 全在里面)、下午变成一个真子集(`dislike`「不爱吃」不在里面)、傍晚因为 `dislike`
 * 被删掉,**又覆盖了全部**。历史记在这儿是为了让人看懂它为什么长成这样,不是为了
 * 留一条「随时可能再变」的暗示:判据已经定死在一句话上 —— **「忌口」这一格里的
 * 每一种都参与拦截,「喜欢吃什么」根本不在这张表管的那一层**(它在 `dietaryPreferences`
 * 里,那个字段从来不参与拦截)。
 *
 * 有断言盯着两件事:一条断「弹不弹冲突卡 === 在不在这张表里」(端到端,拿每种类型
 * 各造一餐各跑一次 `deriveAdvice`),一条断「它覆盖全部 `RestrictionType`、且表里
 * 没有表外的值」。
 *
 * ⚠️ 想再动这张表的人先想清楚两件事:①线上节点认不认(它判的是那三个字面量);
 * ②**不拦的那一类在界面上不能显示严重程度**,因为 `level` 会随档案发成
 * `severity`(见 `restrictionLevel`)—— 今天没有这样的类型,但两处的闸都还在。
 */
export const HARD_BLOCK_TYPES: RestrictionType[] = ['allergy', 'taboo', 'drug']

/**
 * 这个类型会不会被拿去拦菜 —— **全 App 只有这一个判据**。
 *
 * 抽出来的理由:`advice.ts`(弹不弹冲突卡)、`RestrictionSheet`(显示不显示
 * 严重程度、存的时候收不收等级)、`ProfileScreen`(行尾显不显示等级)三处都要问
 * 同一个问题。三处各写一遍 `HARD_BLOCK_TYPES.includes(...)` 迟早有一处写反,
 * 而写反的表现是**界面和拦截行为对不上**,不报错。
 *
 * ⚠️ **今天它恒为 `true`**(三种类型全在表里),所以三处 `&&` 闸和这个函数一起
 * 都「空转」。**留着,不删** —— 理由不是洁癖,是今天这一天:上午删掉一个不拦的
 * 类型时这个闸死了,下午加回来它又活了,傍晚再死。删掉它的代价已经在半天之内
 * 被验证过一次了,而留着它的代价是零。
 */
export function hardBlocks(type: RestrictionType): boolean {
  return HARD_BLOCK_TYPES.includes(type)
}

/**
 * 一条忌口**该显示、也该存下来**的等级。
 *
 * 不拦的类型没有「严重」这一说 —— 界面上那一栏根本不出现(用户定的),所以存下来
 * 的值也必须是这个常量,而不是新建行那个默认的「高危」。
 *
 * ⚠️ **保存必须走它**(`RestrictionSheet.save()`)。理由不是洁癖:`level` 会随档案
 * 发成 `severity`(见 `agentContext.ts` 的 `SEVERITY`),一条不拦的记录被当成
 * 「高危」发出去,模型读到的是**一句假的警报**,而界面上一个字都看不出来。
 *
 * ⚠️ **今天它恒等于 `r.level`**(没有不拦的类型了),所以这个 `'低危'` 分支今天
 * 走不到。和 `hardBlocks` 一样**留着不删**,理由见那边那段。
 *
 * 取「低危」而不是「中危」:它是这个枚举里唯一一个不带任何警报意味的值
 * —— 而且线上那两个拦截节点判的都是 `severity == "high"`,所以低危在线上
 * **永远不会触发硬拦截**(`dify/食衡MealBalance.yml:467` 和 `:551`)。
 */
export function restrictionLevel(r: Restriction): RestrictionLevel {
  return hardBlocks(r.type) ? r.level : '低危'
}

/**
 * 这一条忌口碰到了这盘里的哪一道菜 —— **「怎么算碰上」全 App 只有这一个判据**。
 *
 * 两个调用点:`advice.ts`(弹那张红色冲突卡)和 `eatingAmount.ts`(在那一行上
 * 标「别吃」)。两处各写一遍 `i.name.includes(r.item.trim())` 迟早会走散,而
 * 走散的表现是**同一盘菜在一张卡上是冲突、在另一张卡上安然无恙**,不报错。
 *
 * 判据是菜名子串的朴素匹配,和三处外部约定必须一致:
 *   · 线上工作流(`dify/食衡MealBalance.yml:467` 扫用户那句话、`:551` 扫菜名)
 *     判的也是子串包含;
 *   · 档案里存的是**裸词**(「花生」,不是「花生过敏」),所以这里不用剥后缀 ——
 *     存成「花生过敏」的话 `"花生过敏" in "我吃了花生"` 是 False,过敏原拦截在
 *     最该触发的时候不触发(`Restriction.item` 那段写着这件事);
 *   · 空词/空白词返回 `undefined`,不是「谁都算碰上」。
 *
 * 真实产品里应该走一份成分表,这里是个演示。
 */
/**
 * 常见过敏原 → 它在**食物库 id 里的英文词**。
 *
 * ⚠️ **这一张表是为了堵一个真实的漏**:忌口判断原来只比菜名子串
 * (`item.name.includes('鸡蛋')`),而现实里那道菜叫**「番茄炒蛋」** ——
 * 里面没有「鸡蛋」这两个字,于是鸡蛋过敏的人拍一盘番茄炒蛋,**一个字都不会被提醒**。
 * 实测就是这么漏的(拍餐盘那条路,2026-09-23)。
 *
 * 为什么查 id 而不是给 58 条菜各写一份配料表:那张表当然更准,但它要人工维护
 * 58 行、而且和营养值一样是「改一处忘一处」的活。id 里已经带着主料(`tomato-egg`
 * / `boiled-shrimp` / `braised-beef`),**它本来就是这份数据的一部分**,只是之前
 * 没人用它来判忌口。查它是零维护成本的。
 *
 * ⚠️ **它盖不全。** 只能认出 id 里带了这个词的菜:「鸡蛋 → egg」能命中
 * `tomato-egg`,但**任何藏在复合菜里、id 又没写出来的过敏原都抓不到**
 * (比如「宫保鸡丁」的**花生**是靠名字命中的,而它 id 里只有 chicken)。
 * 也就是说:**这张表是让漏变小,不是让它消失**。真要把漏堵死,得给库里的菜
 * 补一列配料,那是另一件事。
 *
 * ⚠️ 用户自己写的忌口(比如「折耳根」)不在表里 —— 那就退回原来的菜名子串,
 * 和今天的行为一致,不会因为加了这张表而少拦任何一条。
 */
const ALLERGEN_TOKENS: Record<string, string> = {
  鸡蛋: 'egg',
  蛋清: 'egg',
  蛋黄: 'egg',
  蛋: 'egg',
  花生: 'peanut',
  牛奶: 'milk',
  奶: 'milk',
  乳: 'milk',
  虾: 'shrimp',
  鱼: 'fish',
  牛肉: 'beef',
  猪肉: 'pork',
  鸡肉: 'chicken',
  鸡: 'chicken',
  大豆: 'soy',
  黄豆: 'soy',
  豆浆: 'soy',
  小麦: 'wheat',
  麸质: 'wheat',
}

export function restrictionHit(r: Restriction, items: MealItem[]): MealItem | undefined {
  /*
    `hardBlocks` 那一问,线上节点判的是 `type in ("allergy","taboo","drug")` ——
    本地不看 `type` 的话,一条不拦的忌口会弹冲突卡而请求里根本没拦:同一份档案
    两个说法,其中一个是假的。

    ⚠️ **今天它恒为 `true`**(三种类型全在表里),所以这一行空转 —— 和
    `hardBlocks` 自己一样,理由是「删掉再写回来的成本半天内被验证过两次」。
    它认的是 `hardBlocks()` 而不是就地 `HARD_BLOCK_TYPES.includes(...)`:
    同一个问题问两处,迟早有一处写反。

    `level` 也不参与判定:它是给用户看的风险提示(卡片正文里会引用),不是开关。
  */
  if (!hardBlocks(r.type)) return undefined
  const keyword = r.item.trim()
  if (!keyword) return undefined
  /*
    两条判据,任一命中就算碰上:

      · **菜名里有这个词** —— 原来那一版,也是用户自己写的忌口唯一能走的路
      · **这道菜在食物库里的 id 带了这个词的英文** —— 补的那一半,专治
        「番茄炒蛋」这种名字里不含过敏原的叫法

    库外的菜(`web:` / `unmatched:` 哨兵)的 foodId 是中文或前缀,查不到英文词,
    自动退回第一条,和今天一样。
  */
  const token = ALLERGEN_TOKENS[keyword]
  return items.find(
    (i) =>
      i.name.includes(keyword) || (token !== undefined && i.foodId.toLowerCase().includes(token))
  )
}

/**
 * 这道菜碰到了你哪一条忌口、最重的是哪一档 —— **菜品行标红还是标黄的唯一判据**。
 *
 * 用户 2026-09-24 看到的是「一盘菜里每一道都是红的」,原话:「也不要所有都标红吧,
 * 高危标红,中危标黄这样呢」。在那之前 `DishRow` 只认「模型判了慎选」这一个布尔
 * —— 慎选就红,于是红成了「模型提过这道菜」的同义词,一点信息量都没有。
 *
 * 两档从哪儿来:`Restriction.level`。这三个字**不是本地猜的**,是用户自己在
 * 「过敏与用药 / 忌口」面板里选的(和面板上那三行字是同一份数据)。所以红的
 * 意思是「这道菜碰到了**你亲手写下的**那条高危忌口」。
 *
 * 判据是**两条任一命中**:
 *
 *   · **菜里真的有它** —— 走 `restrictionHit`,和顶上那张冲突卡、和每一行那个
 *     「别吃」标是同一个判据。两边各判各的话,同一道菜会在一张卡上红、在另一张
 *     卡上黄,而用户没法判断哪一屏说了实话。
 *
 *   · **模型那句理由点了名** —— `restrictionHit` 自己那段注释写着它**盖不全**
 *     (藏在复合菜里、食物库 id 又没写出来的过敏原抓不到)。「宫保鸡丁」就是这种:
 *     名字里没有「花生」,id 里也只有 chicken。它被标了慎选、屏幕上印着
 *     「含花生，你的档案里写着花生过敏」,再把它画成黄的,就是让一行警告自己
 *     打自己的脸。名点了就是名点了。
 *
 * 一条都没对上的(模型因为高油高钠判的慎选、或者你档案里根本没写那一条)→
 * `undefined`。**调用方必须把它当成黄,不许当成「安全」** —— 分不出来的时候
 * 只能往保守那边降一档,这是「计算不出来就不算了」那条口径在这一行上的样子。
 *
 * ⚠️ 它**不动** `suitable` 那个布尔。「是不是慎选」和「有多危险」是两个问题:
 * 前者决定这一行要不要长出警告图标、名字变红和那句理由(2026-09-24 上午定的),
 * 后者只决定颜色。合成一个字段就再也表达不出「慎选,但不碰你的忌口」。
 *
 * ⚠️ `level` 到今天为止**只被印出来过**(`RestrictionSheet` 里那三行字),这是它
 * **第一次参与界面判断**。所以 `restrictionHit` 里那句「`level` 不参与判定」仍然
 * 成立 —— 它说的是**拦菜**(线上那两个节点判的是 `severity == "high"`,见
 * `agentContext.ts` 的 `SEVERITY`);这里只决定一个颜色,不会多拦掉任何一道菜。
 */
export function dishRiskLevel(
  dish: MealItem,
  restrictions: Restriction[]
): RestrictionLevel | undefined {
  const reason = dish.reason ?? ''
  let worst: RestrictionLevel | undefined
  for (const r of restrictions) {
    const keyword = r.item.trim()
    const hit =
      restrictionHit(r, [dish]) !== undefined || (keyword !== '' && reason.includes(keyword))
    if (!hit) continue
    // `RESTRICTION_LEVELS` 是按严重程度排的(高危在前),取下标最小的那一个
    if (worst === undefined || RESTRICTION_LEVELS.indexOf(r.level) < RESTRICTION_LEVELS.indexOf(worst)) {
      worst = r.level
    }
  }
  return worst
}

/** 一条忌口落在哪一段 */
export type RestrictionSection = 'health' | 'diet'

/** 档案页上每一段的那张卡的标题、那一行的名字,和它管的类型 */
export interface RestrictionSectionShape {
  key: RestrictionSection
  /** 档案页上那个分类标签 */
  category: string
  /**
   * 档案页上入口那一行的名字 —— **也是**面板的标题和「保存」键的措辞。
   * 一份,不能两处各写一个:那样「点进去的面板」和「点的那一行」迟早不是一个说法。
   */
  entry: string
  types: RestrictionType[]
}

/**
 * 健康那一段管的类型 —— **这一行是「怎么分」的唯一出处**,下面两个函数和整张表
 * 都从它派生。
 */
const HEALTH_TYPES: RestrictionType[] = ['allergy', 'drug']

export const RESTRICTION_SECTIONS: readonly RestrictionSectionShape[] = [
  { key: 'health', category: '健康信息', entry: '过敏与用药', types: HEALTH_TYPES },
  {
    key: 'diet',
    category: '饮食信息',
    /*
      `entry` 这一天改过**三次**,现在是**「忌口」**:

        · 原名「忌口与偏好」—— 和同一张卡上面那行字段名「饮食偏好」**共用结尾
          「偏好」**,用户指着这两行说「似乎有所重复」,那就是他看见的那一层。
        · 上午改成「忌口」——那一段当时只剩 `taboo`,取上位词是对的。
        · 下午加回一个类型(`dislike`「不爱吃」),名字跟着**长回去**成
          「忌口与不爱吃」—— 因为名字必须和它装的几类一一对上,否则就是**拿一个
          下位词当整段的名字**,而面板里的选择器偏偏写着「算忌口还是不爱吃」,
          入口只说「忌口」等于自己和自己打架。
        · 傍晚那个类型被删掉,名字**跟着回到「忌口」** —— 同一条规矩的第三次应用:
          名字跟着它装的东西走。

      判据一句话:**这一段的名字要点到它装的那几类**。今天只有一类,所以是上位词;
      哪天再长出第二类,名字就得跟着长(下午那一版就是那条规矩的产物)。
      和「饮食偏好」不共用结尾(「忌口」vs「偏好」),有断言盯着。
    */
    entry: '忌口',
    /*
      ⚠️ 这一段是**健康段的补集**,不是第二张字面量表。写第二张表就等于给「漏掉一个
      类型」留了一道门,而漏掉的表现是那一行在页面上彻底消失(见上面那段)。
    */
    types: RESTRICTION_TYPES.map((t) => t.value).filter((v) => !HEALTH_TYPES.includes(v)),
  },
]

/** 按 key 取那一段。key 是两个字面量、表里两段都在 —— 拿不到就是这张表被改坏了 */
export function restrictionSectionShape(key: RestrictionSection): RestrictionSectionShape {
  const s = RESTRICTION_SECTIONS.find((x) => x.key === key)
  if (!s) throw new Error(`没有这一段忌口: ${key}`)
  return s
}

/**
 * 一条忌口属于哪一段 —— **全函数**,不存在「两边都不认」的取值。
 *
 * 判据直接就是「在不在健康那一段里」,不是遍历上面那张表:补集的补集还是它自己,
 * 所以就算以后 `RestrictionType` 加了一个值,它也会自动落到饮食段,而不是变成一条
 * 谁也看不见、却照样拦菜的孤儿。
 */
export function restrictionSection(r: Restriction): RestrictionSection {
  return HEALTH_TYPES.includes(r.type) ? 'health' : 'diet'
}

/**
 * 这一段的选择器该给哪几个选项。
 *
 * ⚠️ **不要拿这个去替代 `RESTRICTION_TYPES`。** 那个常量必须保持完整 ——
 * `verify-loop.mjs:1533` 断的是 `RESTRICTION_TYPES.length === TYPE_VALUES.length`,
 * 而那条断言是这个仓库里**唯一**盯着「选择器上的字和存进去的 `type` 保持一致」的守卫。
 * 这里返回的是它的一个**视图**。
 */
export function restrictionTypeOptions(section: RestrictionSection): { value: RestrictionType; label: string }[] {
  const types = restrictionSectionShape(section).types
  return RESTRICTION_TYPES.filter((t) => types.includes(t.value))
}

/**
 * 新建一条忌口时的默认类型。
 *
 * 两个默认值都是**这一段里最该被看见的那一个**:健康段给「过敏」,饮食段给「忌口」。
 * 饮食段今天只剩这一个类型(删掉「不爱吃」之后),所以这个默认值今天是**唯一**可能的
 * 取值 —— 下午那版它有两种类型,当时这个默认值挑的是**会拦的那一种**(一条新记录
 * 大概率是「不能吃」,不是「不爱吃」;选错要用户自己去改一个他可能没注意到的选择器)。
 *
 * 仍然写死、仍然不取 `types[0]`:`types[0]` 会依赖 `RESTRICTION_SUFFIX` 的键序
 * 悄悄改掉默认值 —— 那个键序是**显示顺序**,不是重要性顺序。
 */
const DEFAULT_TYPE: Record<RestrictionSection, RestrictionType> = { health: 'allergy', diet: 'taboo' }

export function defaultRestriction(section: RestrictionSection): Restriction {
  return { item: '', type: DEFAULT_TYPE[section], level: '高危' }
}

/**
 * 「他在框里连后缀一起打了」的改写建议 —— 存「花生」,不存「花生过敏」。
 *
 * 抽成纯函数是为了**能断言**:那个提示卡只在面板的某一行展开时才渲染,而展开是组件
 * 内部状态,静态 SSR 到不了(见 `RestrictionSheet` 里那段注释)。放在这里就能直接调。
 *
 * ⚠️ 查的是**完整**的 `RESTRICTION_SUFFIX`,不是分过段的那个列表。查过滤后的列表:
 * 段外的类型 `find` 返回 undefined → `suffix` 是空串 → `endsWith('')` 恒真 →
 * `slice(0, -0)` 是空串 → 那张提示卡**静默消失**,而没有任何一条断言看得见它。
 */
export function restrictionSuffixSuggestion(item: string, type: RestrictionType): string | null {
  const suffix: string | undefined = RESTRICTION_SUFFIX[type]
  if (!suffix || item.length <= suffix.length) return null
  return item.endsWith(suffix) ? item.slice(0, -suffix.length) : null
}

/**
 * 保存前的查重 —— **扫全表,不只是这一段**。
 *
 * 两段是两个入口、两张卡,所以「花生」填成一条过敏 + 一条忌口在旧写法下没人挡;
 * 而分开之后那两行**再也不会并排出现**,用户根本看不见自己填重了。这个洞是分段
 * 新开出来的,得在这儿补上。
 *
 * 扫全表还有个故意的副作用:另一段里已经存在的重名会挡住本段的保存。今天的界面
 * 造不出这种档案,但更早的版本可能有 —— 让它挡在保存上,好过让一条自相矛盾的规则
 * 安安静静地生效。
 *
 * ⚠️ 只把**另一段**现有的行算进来比,不拿本段现有的行比:本段的行本来就在 `all`
 * 里,两边一起比的话每一条都会撞上它自己。
 *
 * ⚠️ 返回的 `entry` 有讲究:**撞到另一段时是那一段的名字**(那一行在**另一张卡**
 * 里,用户在眼前这一屏上看不见它,不说清就等于让他自己去找);在同一段里重了则是
 * 空串 —— 那两行就并排摆在眼前,再报一遍段名是废话。
 *
 * 抽成纯函数是为了**能断言**:它只在面板里渲染,而面板是组件内部状态、静态 SSR
 * 够不着(和 `restrictionSuffixSuggestion` 同一个理由)。
 */
export function findRestrictionDupe(
  all: readonly Restriction[],
  draft: readonly { item: string }[],
  section: RestrictionSection
): { word: string; entry: string } | null {
  const others = new Set<string>()
  for (const r of all) {
    if (restrictionSection(r) === section) continue
    const k = r.item.trim()
    if (k) others.add(k)
  }
  const otherEntry = RESTRICTION_SECTIONS.find((s) => s.key !== section)?.entry ?? ''

  const seen = new Set<string>()
  for (const r of draft) {
    const k = r.item.trim()
    if (!k) continue
    if (others.has(k)) return { word: k, entry: otherEntry }
    if (seen.has(k)) return { word: k, entry: '' }
    seen.add(k)
  }
  return null
}

/**
 * 保存时把这一段的草稿合回整份档案 —— **只动这一段,其余按位留在原处**。
 *
 * ⚠️ 这个函数存在的唯一理由是防一次**静默丢数据**。`updateProfile` 换的是整个
 * `restrictions` 数组,而面板的草稿现在只装本段的条目;直接写回去,在「健康信息」里
 * 保存就会把「饮食信息」那几条忌口一起删掉 —— 落盘、不报错、保存键连灰都不灰。
 *
 * 按位盖回去而不是「本段接在末尾」:不被本段认领的行留在**原来的位置**。追加虽然也
 * 保得住数据,但顺序上游看得见 —— `agentContext.ts` 是按数组序发 `healthRestrictions`
 * 的,线上节点的 `blocked_items` 也跟着这个序。
 *
 * 多出来的(`cleaned` 比原来长)接在末尾,和今天「新加的行在最后」一致;少掉的
 * (用户在面板里删了)就真的没了 —— 那正是他要的。
 */
export function mergeRestrictions(
  all: readonly Restriction[],
  cleaned: readonly Restriction[],
  section: RestrictionSection
): Restriction[] {
  const queue = cleaned.slice()
  const next: Restriction[] = []
  for (const r of all) {
    if (restrictionSection(r) !== section) {
      next.push(r)
      continue
    }
    // 这一段里被删掉的那条:队列已经空了,什么都不放 —— 它就是被删了
    const replacement = queue.shift()
    if (replacement) next.push(replacement)
  }
  return [...next, ...queue]
}

/** 每日营养目标 */
export interface Quota {
  kcal: number
  protein: number
  carb: number
  fat: number
  /** 毫克 */
  sodium: number
  /** 克 */
  sugar: number
  /** 克 —— 仅作展示目标,不参与健康分计算 */
  fiber: number
  /** 毫升 —— 同上 */
  water: number
}

/**
 * 特殊生理阶段 —— 影响热量与蛋白质目标。
 *
 * 取值存**中文**,和 `severity` 恰好相反:
 *   · `severity` 存英文枚举 —— 节点 7 有一段代码在做 `== "high"` 的比较。
 *   · 忌口的 `item` 是中文裸词 —— 模型直接读。
 * 这个字段属于哪一类,取决于工作流里引用它的那个节点是**插值引用**还是
 * **代码比较**。2026-09-19 去 Dify 里看过了:它在**提示词正文**里(插值),
 * 所以中文存得住,只在发给 agent 时按 `agentContext.ts` 的 `STAGE_CODES`
 * 映射一次 —— 那边有完整的词表对照和「映射不了怎么办」的规矩。
 *
 * ⚠️ 2026-09-20 换过一轮,三件事是一起变的:
 *
 *   1. **「更年期」从这里拿掉了。** 它不是自己能确认的事 —— 潮热、月经紊乱
 *      这些表现的个体差异很大,确诊要看激素水平。一个要化验才能确定的选项
 *      摆在引导第 3 步,结果只会是让人凭印象勾,而勾错的代价是配额被改。
 *      (它没有从代码里消失:`quota.ts` 的 `NO_QUOTA_EFFECT` 里那一条留着,
 *      自己写「更年期」的人照样看得到「钙和维生素 D 不在配额里」那句话。)
 *   2. **换成四个自己能确认的**:青少年、老年、术后康复、术前准备。
 *      前三个正好是 Dify 那段提示词里 `specialStage[]` 词表(`pregnancy /
 *      elderly / child / recovery`)**空着没用**的三个码 —— 见 STAGE_CODES。
 *   3. **从单选变成多选**,于是「无」不再是一个取值:`[]` 就是无,
 *      和 `chronicConditions` 完全一致(以前它是个真值,配额按它算)。
 *
 * 这张表因此**不再是闭合枚举** —— 下面那三栏都能自己填写。原来靠联合类型
 * 兜住的那份保证,改由 `verify-loop` 第 9 节承担:它遍历这两张表,要求每一项
 * 都在 `quotaNotes()` 里留下一句话。
 */
export const SPECIAL_STAGES: string[] = ['孕期', '哺乳期', '青少年', '老年', '术后康复', '术前准备']

/**
 * 慢性病 —— 影响对应的营养上限。
 *
 * ⚠️ 它**不是** `Restriction`。忌口走的是「裸词子串匹配」
 * (`if item in haystack`),而「高血压」不是一个能在菜名里搜到的词 ——
 * 塞进 `RestrictionType` 只会让拦截逻辑在错误的前提下跑,而且不报错。
 *
 * 和特殊时期一样,这只是**预设**:用户可以自己写(比如「甲状腺结节」),
 * 自己写的那些匹配不上任何一条调整,界面会明说它们不改配额(见 quota.ts
 * 的 `NO_QUOTA_EFFECT`)。
 */
export const CHRONIC_CONDITIONS: string[] = ['高血压', '糖尿病', '高血脂', '痛风', '慢性肾病']

/** 健康档案 —— 营养目标与忌口,分析建议都以此为依据 */
export interface Profile {
  name: string
  gender: string
  /**
   * 出生日期 —— **档案里不存年龄**,年龄是 `ageOn(birth, 今天)` 现算的。
   *
   * 存年龄的话它会过期:填进去那天 28 岁,三年后还是 28 岁,而它进的是
   * BMR 公式 → 配额跟着一起停在原地。出生日期不会过期。
   */
  birth: Birth
  height: number
  weight: number
  goals: string[]
  restrictions: Restriction[]
  /**
   * 饮食偏好 —— 自由词,**只收「喜欢吃什么」**。
   *
   * 判据(用户 2026-09-22 傍晚定,这一天里换了三次,见 `RestrictionType` 那段):
   *
   * ```
   * 喜欢吃什么（爱吃鱼）        → 这里 —— 只给模型看,不参与拦截
   * 不想吃的（香菜、「素食」这类整体） → 「忌口」面板 —— 每一种都参与拦截
   * 口味轻重 / 健康目标         → 「饮食目标」（少辣、控盐）
   * ```
   *
   * 所以这一格今天是**唯一一处「不参与拦截」的饮食信息**,而且它不在 `restrictions`
   * 那个数组里 —— 那里面现在每一种类型都会被拿去逐道菜核对。
   *
   * ⚠️ 这条分界**没有机器判据**(一个自由词是不是菜名,机器认不出来),所以
   * 界面必须把它说明白,否则用户会在错误的框里填错东西 —— 而且是**静默**失效:
   * 把「花生」填进这一格,拦截一点都不会触发。那句说明在 `InlineField.tsx` 的
   * `hint` 里,**它的真假由上一段那张表保着**。
   *
   * 下午那一版这一格还收「整体怎么吃」(素食、清真、低GI)—— 因为当时的判据是
   * 「具体食物 / 整体模式」。傍晚判据换成「喜欢吃的 / 不想吃的」之后,那三个词
   * 进了「忌口」面板的预设(见 `TABOO_PRESET_WORDS`)。
   */
  dietaryPreferences: string[]
  /**
   * 特殊阶段 —— 选自 `SPECIAL_STAGES` 或用户自己写的词。`[]` 就是「没有」。
   *
   * 自己写的词**不匹配任何一条配额调整**(调整表按字面量匹配),界面会说明
   * 它们不改配额、只影响食衡给的建议 —— 见 quota.ts 的 `NO_QUOTA_EFFECT`。
   */
  specialStages: string[]
  /** 慢性病 —— 同上,预设 + 自由填写,`[]` 就是「没有」 */
  chronicConditions: string[]
  /**
   * 引导最后一步的「还有要补充的吗」—— 一句话,原样发给食衡。
   *
   * 它没有预设、没有选项、也不进任何推导:存在的理由是**前面四栏都装不下的
   * 那部分**。用户在吃什么药、医生交代过什么、家里几个人吃饭 —— 这些每一条
   * 都不足以单开一个字段,凑在一起却常常比档案里那二十个字段更有用。
   *
   * 空串 = 没补充(引导里选「否」就是它)。它**不是可选的**:少一个键会让
   * `agentContext` 多一处 `?? ''`,而那种兜底一旦写下来就没人知道它是给谁兜的。
   */
  notes: string
  /**
   * 用户手工改过的配额项。推导时**最后**盖上去 —— 手改是这一项的最终值,
   * 但条件调整想让位给手改时会先弹一句问(见 quotaAdvice)。
   *
   * 为什么要有这个字段:`quota` 本身是「推导 + 手改」的结果,光看它分不出
   * 哪一项是人定的。而「改了钠之后又勾上高血压」必须区分对待 —— 没有这个
   * 记录,重算就会把手改的值静默吃掉,而且用户不知道为什么。
   */
  quotaOverrides: Partial<Quota>
  /** 每日营养目标 —— 由 quotaFor() 推导后再盖上 quotaOverrides */
  quota: Quota
}

/**
 * 非当前档案的一个槽位。
 *
 * 当前档案的数据在 `AppState.profile` / `AppState.meals` 上,**不在这里** ——
 * 所以「每个档案的数据在任一时刻恰好存在一份」是一条结构性保证,而不是靠
 * 纪律维持的。代价是 `switchProfile` 得做一次移出移入,而它必须原子(见 store.ts)。
 */
export interface ProfileSlot {
  id: string
  profile: Profile
  meals: MealEntry[]
}

/** 落盘的整体状态 —— 一个对象,一个 key,读写都简单 */
export interface AppState {
  /** schema 版本。不匹配时丢弃旧数据重新播种,避免读到结构不符的旧值 */
  version: number
  /** 当前档案的日记。其余档案的日记在 `profiles[i].meals` */
  meals: MealEntry[]
  /** 当前档案 —— 全 App 唯一的读写入口,52 个调用点都读这里 */
  profile: Profile
  /** 其余档案(**不含**当前这个) */
  profiles: ProfileSlot[]
  /**
   * 当前档案的 id。
   *
   * 它和 `profiles` 是一对:`profiles` 里绝不会出现这个 id。
   * 这个不变量由 `switchProfile` 一处维护,并有一条断言盯着(见 verify-loop)。
   */
  activeProfileId: string
  /**
   * 是否走过建档引导。
   *
   * 取代了原来的 `seeded` —— 那个字段只被写、从没被读过。区别在于
   * 「有没有档案」和「灌没灌演示数据」现在是同一件事的两面:首屏第一次打开
   * 拿到的是空档案 + 空日记,引导里点「先用演示档案看看」或走完三步建档
   * 都会把它置为 true。
   */
  onboarded: boolean
}

/** 营养合计,字段与 FoodNutrition 对齐,便于相加 */
export type Nutrition = FoodNutrition

/* ------------------------------------------------------------
   建档引导与档案编辑共用的词表与区间
   ------------------------------------------------------------
   放在这里而不是各自写一份:引导和编辑面板装的是同一批字段,
   两处各写一套的话,「引导里能选的目标」和「编辑里能选的目标」迟早不一样,
   而用户改档案时发现少了一个自己当初选的选项,就会以为选丢了。
   ------------------------------------------------------------ */

/**
 * 预设的**饮食目标** —— 那排一点就有的胶囊。用户还能自己写自由词。
 *
 * 这一格收的是**健康目标 + 口味轻重**两件事(判据见 `Profile.dietaryPreferences`
 * 上面那张表):「控盐」是健康目标,「少辣」「口味清淡」是口味轻重 ——
 * 它们既不是「不想吃的具体东西」(那是「忌口」),也不是「喜欢吃什么」(那是「饮食偏好」)。
 *
 * ⚠️ **不再要求每一项都有英文码。** 原来这里是「每一项都必须在 `GOAL_CODES` 里
 * 有一个英文码,verify-loop 有一条断言盯着」。那条断言今天撤了,因为线上提示词
 * 里的目标词表是**封闭的**(`dify/食衡MealBalance.yml`),给「少辣」编一个
 * 表里没有的 `mild` 比中文直传**更差** —— 模型拿到一个它认不出的 token,
 * 而且看不出来。走的是 `agentContext.ts` 那条 `GOAL_CODES[g] ?? g` 兜底
 * (「备孕」「增肌」一直走这条路)。
 *
 * 换来的新断言是一条**更强**的:凡是有码的,那个码必须原样长在线上提示词里。
 * 于是「编码」这件事从「随便编一个」变成「必须先改线上」。
 */
export const GOAL_PRESETS = [
  '控盐',
  '控糖',
  '控油',
  '均衡饮食',
  '身材管理',
  '减重',
  // 2026-09-22 从「饮食偏好」搬过来的 —— 那两格当时按「拦不拦」分,
  // 它们拦不住,就落到了偏好里。判据换成「具体食物 / 整体模式」之后,
  // 它们是**口味轻重**,该在这儿。
  '少辣',
  '口味清淡',
]

/**
 * 饮食偏好的预设词 —— **只有「喜欢吃什么」,三颗**。
 *
 * 只是「点一下省得打字」,没有对应的枚举码 —— 偏好本来就是给模型看的一句话
 * (定义见 `Profile.dietaryPreferences`)。预设的价值在于**收敛同义词**:
 * 没有它,用户会填出「爱喝汤」「喜欢喝汤」两种写法,而模型只能自己猜
 * 它们是不是一回事。
 *
 * ⚠️ **这张表换过四次判据,四个坑都记在这儿**(一天之内):
 *
 * · 最早有「不吃香菜」「忌生冷」—— 那两个是**不想吃的具体食物**,该进「忌口」。
 *   点一下就把一句忌口送进一个从不参与拦截的格子,全程没有任何提示。
 *   它们不是被挪走了,是**删了**。
 * · 后来有「少辣」「少油」「口味清淡」—— 判据是「拦不拦」的时候它们拦不住,
 *   就落在了这儿;判据换成「具体食物 / 整体模式」之后它们该进**「饮食目标」**
 *   (口味轻重),于是搬走了。
 * · 今天下午还多出「素食」「清真」「低GI」(当时判据是「整体模式」),傍晚
 *   用户把判据改成**「喜欢吃的 / 不想吃的」**,那三个词跟着进了
 *   `TABOO_PRESET_WORDS` —— 它们是「不想吃的」,不是「喜欢吃的」。
 *
 * 所以这条禁的是**句式**,不只是那几个词:「不吃…」「忌…」「不爱吃…」开头
 * 的一律不许进这张表(verify-render 有一条形状断言盯着)。判据一句话:
 * **它是「想吃」还是「不想吃」?** 这一格只收前者。
 */
export const DIET_PRESET_WORDS = ['爱吃鱼', '爱吃粗粮', '爱吃甜食']

/**
 * 「忌口」面板里那三颗预设胶囊 —— **点一下就会真的参与拦截**。
 *
 * 2026-09-22 傍晚从 `DIET_PRESET_WORDS` 搬过来的:那三个词是「不想吃的」,
 * 按用户当场定的判据(「偏好只记喜欢吃的」)它们不能待在偏好里。
 *
 * ⚠️ **它们和「香菜」不一样,不是菜名** —— 「素食」永远不会出现在某道菜的名字里。
 * 所以放进这个面板之后:本地那道逐道菜核对的闸几乎永远不会命中(这是可以接受的,
 * 它们本来就是给食衡看的一整类说法),但**它们确实进了拦截那条线**,
 * 而且会随档案发成 `healthRestrictions[]`。
 *
 * ⚠️ **所以预设胶囊插进去的行给「低危」,不给 `defaultRestriction` 那个「高危」。**
 * 线上那两个拦截节点判的都是 `severity == "high" and type in (...)` —— 给「高危」
 * 就等于让用户问一句「素食晚餐吃什么」被 App 自己拦下来
 * (`dify/食衡MealBalance.yml:467` 扫的就是用户这句话)。低危在线上永不触发硬拦截,
 * 但本地照样核对、照样发给食衡。
 */
export const TABOO_PRESET_WORDS = ['素食', '清真', '低GI']

/**
 * 点一下那排胶囊会插进去的那一行。
 *
 * ⚠️ **等级写死「低危」,不走 `defaultRestriction()` 的「高危」。** 手工「添加一条」
 * 那条路给高危是对的(绝大多数忌口是「不能吃」),但胶囊这三颗不是:
 * 线上那两个拦截节点判的是 `severity == "high" and type in (...)` —— 给高危就等于
 * 让用户问一句「素食晚餐吃什么」被 App 自己拦下来(`dify/食衡MealBalance.yml:467`
 * 扫的就是用户这句话本身)。低危在线上永不触发硬拦截,本地照样逐道菜核对、
 * 照样发成 `healthRestrictions`。
 *
 * ⚠️ 类型写死 `taboo`:这张表的名字就是它。断言盯着「插进去的行属于饮食段」
 * (`restrictionSection`),因为一个落到健康段的「素食」会出现在**另一张卡**里。
 *
 * 抽成纯函数是为了能断言 —— 点击处理在组件内部,静态 SSR 够不着。
 */
export function tabooPresetRestriction(word: string): Restriction {
  return { item: word, type: 'taboo', level: '低危' }
}

/**
 * 那排胶囊各自的「加过了没有」—— 加过的那颗置灰。
 *
 * 不是洁癖:不置灰的话连点两下就撞上 `findRestrictionDupe`,底下弹出
 * 「「素食」填了两条,只留一条就够」—— 那是**手误**的措辞,而用户是照着我们
 * 给的按钮点的。置灰之后那颗胶囊自己就是「已经有了」的说明。
 *
 * ⚠️ 给错段时返回**空数组**,判据是「这一行会落到哪一段」,不是 `section === 'diet'`
 * 这个字面量:将来 `taboo` 要是被挪到健康段,这排胶囊会跟着走,而不是留在饮食段里
 * 往**另一张卡**插行(插进去的行在眼前这一屏上根本不出现,用户只会觉得点了没反应)。
 *
 * 比的是 `trim()` 之后的原词;判据和查重那条一样,不另立一套。
 */
export function tabooPresetChips(
  section: RestrictionSection,
  draft: readonly { item: string }[]
): { word: string; taken: boolean }[] {
  if (restrictionSection(tabooPresetRestriction('')) !== section) return []
  const have = new Set(draft.map((r) => r.item.trim()).filter(Boolean))
  return TABOO_PRESET_WORDS.map((word) => ({ word, taken: have.has(word) }))
}

/**
 * 体征里**数值**那两项的合理区间 —— 引导和编辑面板的滚轮都用它。
 *
 * 上界不是医学判断,是**防手滑**:一个体重输成 550kg 的人,kcal 会被
 * `quotaFor` 夹到上限 4000,而界面不会告诉他为什么。
 *
 * 出生日期不在这张表里:它没有「区间和步长」,是年、月、日三个轮子拼出来的,
 * 范围分别由 `birthYearRange()`(按年龄区间反推)、月份常量、`daysInMonth()`
 * (当月有几天,2 月和大小月都不同)给出。
 */
export const BODY_LIMITS = {
  height: { min: 130, max: 210, step: 1, unit: 'cm' },
  weight: { min: 30, max: 150, step: 1, unit: 'kg' },
} as const

/** 出生日期的「月」那一列 —— 1–12 是常量,不需要按今天反推 */
export const MONTH_LIMITS = { min: 1, max: 12, step: 1, unit: '月' } as const

/** 体征那三项 —— 引导、编辑面板、滚轮面板都按这个形状读写 */
export interface BodyValues {
  birth: Birth
  height: number
  weight: number
}

/**
 * 这份档案今天几岁 —— **全 App 问年龄只有这一个入口**。
 *
 * 之所以要有个入口而不是各处写 `ageOn(p.birth, new Date())`:换算规则只有
 * 一条(生日那个月没过就减一岁),而它进 BMR 公式。散着写的话,哪天有人
 * 在某一处写成 `getFullYear() - birth.year`,那个地方会静默地多算一岁。
 *
 * 参数只要「有出生年月的东西」,不是整个 `Profile`:引导和编辑面板手里拿的是
 * 各自那份草稿,它们都不是 `Profile`(没有 quota、没有忌口),而它们照样要
 * 显示「按这个算你现在几岁」。
 */
export function ageOf(p: { birth: Birth }, now: Date = new Date()): number {
  return ageOn(p.birth, now)
}

/**
 * 体征那三行的显示名、顺序和**值怎么写** —— 建档引导和编辑档案两边都照着它铺。
 *
 * 值也放进这张表(而不是「标签在这里、单位在那里」)是因为三项的写法本来就
 * **不是同一种**:出生日期要 `1998年3月20日`(没有单位),身高体重要带单位。
 * 分开写的话,两处各拼一次,迟早会拼出两种写法 —— 而「档案页写 165cm、
 * 引导里写 165 厘米」这种不一致,是看不出来该改哪一处的。
 */
export const BODY_FIELDS = [
  { key: 'birth', label: '出生日期', text: (v: BodyValues) => formatBirth(v.birth) },
  { key: 'height', label: '身高', text: (v: BodyValues) => `${v.height}cm` },
  { key: 'weight', label: '体重', text: (v: BodyValues) => `${v.weight}kg` },
] as const

export const GENDERS = ['女', '男'] as const
