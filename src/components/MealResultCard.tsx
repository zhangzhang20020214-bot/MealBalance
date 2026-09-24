import { AdviceList } from './AdviceList'
import { AgentReplyCard, RiskStrip } from './AgentReplyCard'
import { DemoDataBanner } from './DemoDataBanner'
import { DishRow } from './DishRow'
import { Icon } from './Icons'
import { Card } from './ui'
import type { RecognizedMeal } from '../store/recognize'

/**
 * 对话里那张识别结果卡
 * ===========================================================
 * 和结果页那张卡**长得像,但不是同一张** —— 这里刻意不复用它,理由是两张卡
 * 回答的问题不一样:
 *
 *   · 结果页那张是**一次分析的终点**:底下挂着「调整分量或增删菜品」和
 *     「记入日记」,用户在那里做决定。
 *   · 这张是**对话里的一句话**:用户可能只是在问「这餐咸吗」,根本没打算记。
 *     所以它**一个按钮都没有**,而且这**不是省略,是这一屏的全部要点**
 *     (见计划里你定的那条第 5 条:记不记进日记留到下次进对话页再问)。
 *
 * 一旦在这里挂上「记入日记」,那个决定就被推回给当下 —— 用户刚发完图、
 * 正等着看结果,是最不适合做这个决定的时候。
 *
 * 做到这一点的办法是**结构性的**,不是自觉:`MealResultCard` 只收 `meal`,
 * 一个回调都不收。想在这里归档,得先改这个签名。
 *
 * 三处文案各说各的一件事,别合并
 * ------------------------------------------------------------
 *   · `degradedReason` → 复用 `DemoDataBanner`。它说的是「这整份是编的」,
 *     而且那句话的主语是**照片**(「你拍的照片没有被上传」),三个屏幕口径一致。
 *   · `partialNote`    → 中性底色的另一条。它说的是「这份是真的,只是少了
 *     一部分」—— 那条横幅上**一个字都不许出现「演示数据」**,否则用户会把
 *     屏上那几道真菜当成编的删掉(`RecognizedMeal.partialNote` 那段注释)。
 *   · 「这一餐还没记进日记」→ 卡片头部右边那一句。见下。
 *
 * ## 这张卡上一个数字都没有（2026-09-24）
 *
 * 用户那天先是问「这个卡你是怎么计算出来的?」,给定了一条口径:
 * **「计算不出来就不算了」**;接着给了落地方案:「用户如果说加入档案日记里,
 * 那就那个时候再调用食衡agent,如果后续没有点击计入日记,那就不管」。
 *
 * 于是这张卡上的克数与热量**全部撤掉**（`DishRow` 的 `showNutrition={false}`）,
 * 理由不是「数字不好看」:对话页发图走的是**膳享+**,而给库外菜查营养的那组
 * 节点(联网检索 + 合并营养)只在**食衡**工作流里。所以这道菜此刻的营养
 * **算不出来** —— 库外那道会一路落到 `ZERO_NUTRITION`,屏上印出一个 0。
 *
 * 那个 0 是本卡当天出过的事故现场。用户原话:「没能认出菜品,这张图里没有
 * 认得出的菜,**全餐组合 0g,0kcal**,包含多种食材,但存在严重健康冲突」——
 * 下面明明列着一行菜,上面说「没有认得出的菜」,而那一行是 0g / 0 kcal。
 *
 * ⚠️ **别在卡上补一句「不在食物库里,按 0 计」把它圆回来**(那是当天早些时候
 * 的补丁,已经撤了)。屏幕上一个 0 都没有的时候,解释那个 0 的话就没有指代对象;
 * 而且真正的问题从来不是「那个 0 没解释」,是**它根本就不该出现**。
 * 数字在**记进日记那一刻**由食衡算出来,落在日记里。
 *
 * 所以这卡现在只回答两件事:模型认出了哪些菜(名字)、以及它们有没有风险。
 */
export function MealResultCard({ meal }: { meal: RecognizedMeal }) {
  /*
    过敏拦截 —— 整份结果就是那张拦截卡(items 是空的,没有菜可渲染)。
    复用 `AgentReplyCard` 的拦截分支而不是自己再写一套:结果页也是这么做的
    (`recognize.ts` 的 `agentReply` 那段),同一件事有两份实现早晚会分叉。
  */
  if (meal.agentReply?.blocked) return <AgentReplyCard reply={meal.agentReply} />

  return (
    <div className="flex w-full flex-col gap-2">
      {meal.degradedReason && <DemoDataBanner reason={meal.degradedReason} />}

      {meal.partialNote && (
        <div className="flex items-start gap-2 rounded-[14px] border border-line bg-black/[0.03] px-3.5 py-2.5">
          <Icon name="alertCircle" size={16} className="mt-px shrink-0 text-muted" strokeWidth={2} />
          <span className="text-[12px] leading-[17.38px] text-muted">{meal.partialNote}</span>
        </div>
      )}

      {/*
        ⚠️ **这条冲突结论就画在这儿(2026-09-24)。**

        用户的原话:「如果图片里有用户明确不能吃的,不要硬拦截,就是**第一条明显的
        提醒**,然后后面的菜该怎么吃就怎么吃」,以及当天第二次纠的:「可是显眼的
        高危提醒也没了,就算不单独写个提醒,**起码也要标红危险内容**」。

        落点是这块,不是别处:对话页发图这条路**认出菜就归这张卡**
        (`ChatTranscript` 那条分支),而这张卡从前只画菜品和建议 —— `agentReply.risk`
        一个字都不画。于是「第一条明显的提醒」在屏幕上根本没有,菜照常列着,
        那道菜里有他不能吃的东西这件事一个字都不提。**不是提醒不够显眼,是它长在了
        另一张卡上**(那块在 `AgentReplyCard` 里,只有「没认出菜」时才轮到它)。
        同一个块两处各写一遍会分叉,所以用的是同一个 `RiskStrip`。

        位置:两条横幅**之下**、菜品卡**之上**。横幅说的是「这份数据的来路」
        (照片没上传 / 缺了一张),它管着下面所有东西 —— 一条高危提醒摆在
        「本次为演示数据」上面,读起来像一份真的结论。
      */}
      {meal.agentReply && <RiskStrip risk={meal.agentReply.risk} />}

      <Card>
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
          <span className="text-[13px] leading-[15.6px] font-medium text-muted">
            {/*
              ⚠️ **数的是「模型报了几道菜」(`items.length`),不是
              「几道能算出营养的」(`countableItems`)。**（2026-09-24 改回来）

              这台词当天翻过两次,写清楚第三次别再翻:中间那版数的是
              `countableItems`,于是「报了但库里没有」会印成「没能认出菜品」——
              和下面那行列着菜的行**互相打架**,那正是用户在手机上看到的一幕。

              现在不会打架了,因为屏上**没有任何数字**:一道库里没有的菜也照样是
              「模型认出来的一道菜」,它列在下面,上面就该把它数进去。
            */}
            {meal.items.length > 0 ? `识别到 ${meal.items.length} 道菜` : '没能认出菜品'}
          </span>
          {/*
            「这一餐还没记进日记」—— 这句话必须在这儿。

            这张卡上没有任何归档入口,而用户刚刚才看到 App 认出了三道菜。
            不说这句话,他分不清「已经自动记了」和「还没记」—— 而两种猜法都
            会让他不去看那个补记弹窗。它同时是那张卡的诚实声明和弹窗的引子。
          */}
          <span className="shrink-0 text-[11px] leading-[15.6px] text-faint">还没记进日记</span>
        </div>

        {/*
          「这张图里没有认得出的菜。」只说给**真的一道都没有**的那种情形
          (配料表、包装、全不是菜)。有一行菜列在下面还说这句话,是这一块最不能
          出的错 —— 判据就是「`items` 空不空」,和上面那句台词同一个数。
        */}
        {meal.items.length === 0 && (
          <p className="px-4 pb-3 text-[12px] leading-[17.38px] text-muted">
            {meal.noDishReason ?? '这张图里没有认得出的菜。'}
          </p>
        )}

        {/*
          菜品行搬到 `DishRow` 了 —— 这段标记原来在本文件和结果页里
          **逐字节相同**地写了两遍,而「补记」那张弹窗会是第三份。
          为什么这一行值得一个组件(两个 span 的边界 + `· 联网估算` 标记都是
          坏掉不报错的),见 `DishRow.tsx` 文件头。

          ⚠️ `showNutrition={false}` 是这张卡当天定的口径(见文件头最后一段):
          发图这一刻营养还算不出来,所以**这一行不印任何数字**。
          结果页那个调用方不传这个开关 —— 那里的数字是真的。
        */}
        {meal.items.map((dish, i) => (
          <DishRow key={`${dish.foodId}-${i}`} dish={dish} divider={i > 0} showNutrition={false} />
        ))}

        {/*
          ⚠️ **模型那趟回答里的建议,就画在这张卡里(2026-09-23)。**

          用户的原话是「针对图片给一个答案,然后针对文字再给另一版答案?
          我不要这样,一起发的就一起回答」—— 从那天起,随图打的那句话
          **只发一趟**(见 `ChatScreen.sendPhotos` 里那段):模型在这一趟里
          既认菜、也答那句话,答案就落在 `meal.agentReply.advice` 里。

          这就是那个「不要」的落点。以前这句话是**另起一条消息、另画一张卡**
          答的,屏幕上于是两条消息、两张卡、两版答案。现在它在同一张卡里:
          菜在上,建议在下,**同一次回答**。所以这一块不能挪出去当第三张卡。

          ⚠️ 少了它不会有任何报错 —— 只是用户问的那句话**没人答**(模型答了,
          我们没画)。而餐盘这条路不像配料表那条:那边整份结果都是回复卡渲染的,
          建议天然在里面;这边的主体是菜品行,建议得自己接上。
        */}
        {meal.agentReply && meal.agentReply.advice.length > 0 && (
          <AdviceList lines={meal.agentReply.advice} />
        )}
      </Card>
    </div>
  )
}
