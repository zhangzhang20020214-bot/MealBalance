import { IconTile } from './ui'
import { RichText } from './AdviceList'
import { isWebId } from '../lib/dishMatch'
import { nutritionOfItem } from '../lib/nutrition'
import { dishIcon } from '../store/advice'
import { useAppState } from '../store/store'
import { dishRiskLevel, type MealItem } from '../store/types'

/**
 * 一餐里的一道菜 —— 图标 / 名字 / 克数 / 热量
 * ===========================================================
 * ## 为什么抽出来
 *
 * 这段标记在 `MealResultCard` 和 `ResultScreen` 里**已经逐字节相同**地写了两遍
 * （同一个 `h-[66px] gap-3 px-4 py-3`、同一个 `pl-[70px]` 的分隔线、同一个
 * 克数 + `· 联网估算` 的双 span；`h-` 后来因为标红那一行多了一句理由改成了
 * `min-h-`，单行时撑出来仍是 66）。「上次识别到的那一餐」那张弹窗会是第三份，
 * 而这一行里有两样东西**坏掉不会有任何提示**：
 *
 *   · **`· 联网估算` 标记。** 漏一处，库外菜在一屏上标了来源、在另一屏上没标 ——
 *     用户会以为那个数字也是食物库里的。和 ResultScreen 那段注释说的是同一件事。
 *   · **克数那两个 span 的边界。** `scripts/verify-render.mjs` 的 `GRAM_READOUT`
 *     认的是「`tnum` → 数字 → g → `<`」这样一个**独立**的 span；把标记并进同一个
 *     span 会让它在所有地方静默失配，拿它做否定断言的那条于是**假绿**。
 *
 * 抽出来的前提是**渲染结果逐字节不变** —— 所以这里是搬运，不是重写：
 * 类名、层级、两个 span 的边界、分隔线的 `pl-[70px]` 全部原样。
 * （`key` 由调用方给，因为分隔线挂在「第几行」上，而这件事只有调用方知道。）
 *
 * ## 它不决定任何数字
 *
 * 热量走 `nutritionOfItem` —— 食物库与「条目自带」两个来源的优先顺序只在
 * `lib/nutrition.ts` 里定义了一份。以前这里（结果页）写的是 `food ? … : 0`，
 * 库外菜不管有没有联网查到的值都显示 0 kcal，而合计里却算进了它 ——
 * 一行和总数对不上，界面上看不出来。
 *
 * ## 但它确实会改这一行的样子（2026-09-24）
 *
 * 上面那句「逐字节不变」说的是**抽出来的那一刻**。同一天用户又定了一条:
 * 「在菜品那里把危险的字样和菜品标红，做个显眼标记」—— 落点就是这一行:
 * 模型判了慎选的那道菜，名字变红、图标换成警告、底下多印一句它给的理由。
 *
 * 加在这**一个**组件里，是因为这一行有两个调用方（`MealResultCard` 是对话里
 * 那张卡、`ResultScreen` 是结果页）:只改一处，同一道菜在两屏上一个红一个不红,
 * 而用户没法判断哪一屏说了实话。和上面第 1 条是同一类错，解法也一样 ——
 * 同一件事只留一个实现。
 *
 * **当天下午又分了两档**:上面那句「标红」当天落地之后,屏幕上变成「一盘菜里
 * 每一道都红」—— 用户指着它说「也不要所有都标红吧,高危标红,中危标黄这样呢」。
 * 于是颜色改由 `dishRiskLevel` 决定(和冲突卡同一个判据):撞上你写下的那条
 * **高危**忌口才是红的,其余慎选一律黄。
 *
 * ⚠️ **`useAppState()` 是在这一行里读的,不是让三个调用方各自传下来的。**
 * 传下来就是三次抄写,而漏一处那屏的颜色就和别的屏对不上 —— 和上面第 1 条
 * 是同一个形状的错(同一道菜,两屏两个样子)。这一行住在一个不依赖档案的
 * 组件树里,读全局状态是这里最省事、也最不容易走散的一处。
 *
 * ⚠️ 它**不是**在判断「这菜健不健康」,而是在判断「**这菜碰没碰到你亲手写下的
 * 那条红线**」。档案里没写忌口的人,慎选菜全是黄的 —— 这不是漏标,是实话:
 * 没人告诉过 App 什么对你是危险的。
 *
 * ## 以及「这一行今天要不要印数字」（2026-09-24，`showNutrition`）
 *
 * 同一天用户又定了一条:对话页发图那一刻**一个数字都不印**（「计算不出来就不算了」
 * + 「发图不算营养，要记日记时才调食衡」）。落点还是这一行 —— 它是唯一画数字的地方。
 *
 * 于是多一个开关，默认 `true`。**默认值的方向是刻意的**:结果页、日记页那些
 * 数字是真的（食衡那条链路上「联网检索 + 合并营养」给的值），它们不该因为
 * 对话页的新口径一起消失。只有对话里那张卡和补记弹窗传 `false`。
 *
 * ⚠️ **这一档会让文件头第 2 条那两条否定断言在整屏上变成空断言。**
 * `verify-render` 的 `GRAM_READOUT` 认的是「`tnum` → 数字 → g → `<`」这样一个
 * 独立 span;整块不渲染之后，「对话那张卡上没有克数」这条断言**永远为真**,
 * 它不再能区分「按新口径不印了」和「克数那两个 span 被谁写坏了」。
 * 所以那一节必须**同时**断结果页照旧印得出来（正面控制）——
 * 只留否定断言的话，这个开关本身坏掉都不会有人知道。
 */
export function DishRow({
  dish,
  divider,
  showNutrition = true,
}: {
  dish: MealItem
  divider: boolean
  /** 见文件头最后一段。默认 `true` —— 只有对话页那条路传 `false` */
  showNutrition?: boolean
}) {
  /*
    ⚠️ 热量**在这里才算**,而且只在真的要印的时候算（见下面那个 `showNutrition`）。

    挪到 JSX 里不是洁癖:这一行现在是「对话页不印数字」的落点,而
    `nutritionOfItem` 对库外那道菜返回的正是那组 0 —— 留着这个顶层常量，
    下一个人会以为「反正算了，印出来也无妨」。
  */
  /*
    **模型判了「慎选」的那一道会长出警告的样子(2026-09-24)** ——
    名字变色、图标换成警告、底下多印一句它给的理由。**变红还是变黄是下一段的事。**

    用户的原话是「你要是做不到单独提醒高危组合,并同时结合危险内容做进餐组合,
    那就不单独提醒危险,**在菜品那里把危险的字样和菜品标红,做个显眼标记**」。
    他后来选了「顶上那条结论条留着」,所以两处都有:顶上那条说**这一餐**有冲突,
    这里说**是哪一道菜**、以及为什么。

    判据只认 `=== false`。字段缺失**不是「适宜」**,是「模型没提」—— 拿它当
    「安全」在屏幕上说出话来,是这道菜唯一不能犯的错(同 `MealItem.suitable`)。

    ⚠️ 这一行和 `AgentReplyCard` 里那张菜卡是**两处不同的写法**:那边名字仍是
    `text-ink`、靠一枚红「慎选」徽章标出来;这边名字本身就是红的。刻意不统一
    —— 两处从来不同屏(认得出菜走这张卡、认不出才轮到那张),而这一行只有
    一行半的宽度,塞不进徽章又不许把名字截断成看不清。
  */
  const flagged = dish.suitable === false

  /*
    **红还是黄,看的是「你那条忌口的等级」,不是「模型提过这道菜」(2026-09-24 下午)。**

    上面那条是上午定的,落到屏幕上就成了「一盘菜里每一道都红」—— 用户的原话是
    「也不要所有都标红吧,高危标红,中危标黄这样呢」。红一旦人人都拿,就不是信息了。

    判据在 `dishRiskLevel`(挨着 `restrictionHit`,和冲突卡同一个来源)。这里只
    做一件事:**分不出来时(`undefined`)按黄**。宁可少吓一次,不许把「不知道」
    画成「没事」。
  */
  const { profile } = useAppState()
  const riskLevel = flagged ? dishRiskLevel(dish, profile.restrictions) : undefined
  const high = riskLevel === '高危'
  const nameTone = !flagged ? 'text-ink' : high ? 'text-danger-text' : 'text-warn-text'

  return (
    <>
      {divider && (
        <div className="pl-[70px]">
          <div className="h-px bg-line" />
        </div>
      )}

      {/*
        `h-[66px]` → `min-h-[66px]`:标红那一行多一行理由,固定高度会把它切掉
        (而切掉正好是「危险的字样没了」)。单行时 min-h 撑出来仍是 66,和以前一样。
      */}
      <div className="flex min-h-[66px] items-center gap-3 px-4 py-3">
        <IconTile
          name={flagged ? 'warning' : dishIcon(dish.foodId)}
          size={42}
          radius={12}
          /*
            两档同样是「警告」的意思,只有浓度不同 —— 图标本身不换
            (换一个更轻的图标等于说「这道菜的问题不严重」,而黄说的只是
            「没撞上你写下的那条」)。
          */
          tone={!flagged ? 'brand' : high ? 'danger' : 'warn'}
          iconSize={20}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={`truncate text-[15px] leading-[22px] ${nameTone}`}>{dish.name}</span>
          {/*
            这里以前写的是「**估算** 150g」。但那个 150 既不是从照片里推出来的、
            也不是模型给的 —— 它是食物库里的 `defaultGrams` 常量,或者用户在
            上一屏亲手选的份量。继续写「估算」，就是给一个常量加一层不该有的可信度。

            ⚠️「· 联网估算」是**另一件事**，别把上面那句当理由删掉它：
            它说的是**营养值**的来源（联网检索），不是克数的来源。
            克数照旧是常量/用户选的，营养值这回真的不是食物库的。

            分两个 span 是硬约束，不是排版洁癖 —— 理由见文件头第 2 条。
            标记必须排在克数**之后** —— 反过来写会撞上「不许出现『估算 150g』」
            那条断言。
          */}
          {showNutrition && (
            <span className="flex items-center gap-1.5">
              <span className="tnum text-[13px] leading-[18px] text-muted">{dish.grams}g</span>
              {isWebId(dish.foodId) && (
                <span className="text-[13px] leading-[18px] text-faint">· 联网估算</span>
              )}
            </span>
          )}
          {/*
            模型给的理由就是那句「危险的字样」(「含花生」)。走 `RichText` ——
            它是模型写的正文,里面可能有 `**加粗**`,别的地方也是这么渲染的。
            没有理由时这一行不画(只有名字和图标是红的):宁可少一行,不编一句。
          */}
          {flagged && dish.reason && (
            <span className={`text-[13px] leading-[18px] ${high ? 'text-danger-text' : 'text-warn-text'}`}>
              ⚠ <RichText text={dish.reason} />
            </span>
          )}
        </div>
        {/*
          热量**不跟着标红**:它是这一行的数字,不是那句危险的话。红字在这个 App 里
          是「这句话在警告你」,把 150 kcal 也涂红等于说这个数字本身有问题。
        */}
        {showNutrition && (
          <span className="tnum shrink-0 text-[13px] leading-[15.6px] font-bold text-muted">
            {Math.round(nutritionOfItem(dish).kcal)} kcal
          </span>
        )}
      </div>
    </>
  )
}
