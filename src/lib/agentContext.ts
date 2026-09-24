import type { MealEntry, Profile, Restriction } from '../store/types'
import { dayStats } from '../store/derive'
import { MAIN_SLOTS } from './slots'
import { QUOTA_FIELDS, formatQuota, quotaBasisLine, quotaNotes } from '../store/quota'
import { ageOn } from './age'
import { formatTime } from './date'

/**
 * 组装发给 agent 的 query
 * ===========================================================
 * 这个 Dify 应用的工作流第一步是**解析 JSON**:节点 2 拿 `sys.query` 做
 * `json.loads`,解出来的 `profile` 喂给后面的过敏原拦截和提示词。也就是说
 * 健康档案不是通过 Dify 的「输入变量」传的,是**塞在问题文本里**传的。
 *
 * 这一点是实测出来的,而且我一开始理解错了:
 *
 *   · `/parameters` 里确实声明了一个 `user_context` 变量 —— 但整个工作流
 *     没有任何节点引用它。往 inputs 里塞多少东西都进不了 prompt。
 *   · 用纯文本提问时 `json.loads` 失败,节点 2 走 except 把 profile 置空,
 *     于是「读档案」和「过敏原拦截」两层同时失效,而且**不报错**。
 *     实测:档案里写着花生过敏,问「晚餐吃什么好？」照样给建议。
 *
 * 所以这里构造的是 query **字符串**,不是 inputs 字典。
 *
 * 两个字段口径必须盯死
 * ------------------------------------------------------------
 *   1. `healthRestrictions[].item` 是**裸词**(「花生」),不是「花生过敏」。
 *      工作流判命中的写法是 `if item in haystack` 这种子串匹配 ——
 *      填「花生过敏」的话,`"花生过敏" in "我吃了花生"` 是 False,
 *      拦截在最该触发的时候不触发,而且看不出哪里错了。
 *   2. `severity` 是英文枚举 high / medium / low,不是「高危 / 中危 / 低危」。
 *      节点 7 判的是 `r.get("severity") == "high"`,中文字面量永远不等于它。
 *
 * 这两条不是风格问题,是「对了才拦得住」的问题,所以自检里专门盯着。
 *
 * ⚠️ **`item` 里会出现不是菜名的词**(2026-09-22 傍晚起)——
 * 「素食」「清真」「低GI」这三种整类说法现在也是忌口(见 `TABOO_PRESET_WORDS`),
 * 会原样出现在这个数组里。它们**几乎永远不会**命中某个菜名,这是可以接受的:
 * 它们本来就是给模型看的一整类约束,而不是拿来 `in` 一个菜名的。
 * 读到它们的人(包括下一个改这段提示词的人)不要以为那是脏数据。
 * 它们的 `severity` 是「低危」—— 线上两个拦截节点都同时要求
 * `severity == "high"`,所以它们**不会**把用户自己的提问拦掉。
 *
 * 为什么 JSON 里没有姓名
 * ------------------------------------------------------------
 * 档案里有 name 字段,但对营养推理没有任何用处 —— 发出去只是把一条身份
 * 标识交给第三方。年龄、性别、身高体重是算营养必需的数据,那些发。
 * 这条线是「推理需要」,不是「档案里有」。
 *
 * 2026-09-23 起有两份 query,因为对话和识图接的是**两个不同的 Dify 应用**
 * ------------------------------------------------------------
 *   · `buildAgentQuery` —— 「食衡」,**识图**用。JSON,因为食衡的工作流第一步
 *     就是 `json.loads`(上面几段说的全是它)。
 *   · `buildChatQuery`  —— 「膳享+」,**对话**用。大白话,因为它没有那一步解析;
 *     而实测把上面那坨 JSON 原样发给它,它会把 `profile` 里的**忌口当成
 *     「用户吃了这些」**,直接回 `blocked: true`(items 里甚至冒出「高钠风险」
 *     这种不是食材的东西)。同样的内容改成大白话就没有这个问题。
 *
 * 两份的**用词本来就不同**,不是同一份数据的两种排版:JSON 发的是
 * `salt_control` / `high` 这类**枚举码**(食衡的代码节点要按码比较),
 * 大白话发的是「控盐」「高危」这类**档案页上的原话**(膳享+ 只读文字)。
 * 所以别把其中一份改成由另一份反解出来 —— 反解会把码原样吐进句子里。
 */

/**
 * 分析路径。不传则由模型自己判断。
 *
 * 五个取值来自工作流里 LLM 节点提示词的原话
 * （`fridge / plate / dish / menu / ingredient`）—— 以那段提示词为准,
 * 不是从前端渲染逻辑倒推的。
 *
 * 对话页**不传** —— 用户的开放提问该让模型自己判。实测同一句话两次可能
 * 返回不同的 mode,硬塞一个反而是拿 App 的猜测覆盖模型的判断。等「拍餐盘」
 * 接真实视觉链路时,那里才该显式传 `plate`。
 */
export type AgentMode = 'fridge' | 'plate' | 'dish' | 'ingredient' | 'menu'

/**
 * 是否把健康档案塞进 query 发给 agent。
 *
 * 开着 —— 2026-09-19 上游工作流修好节点 7 之后打开,并跑过稳定性验证:
 *
 *   · 应当放行的 6 次(「晚餐吃什么好？」「膳食纤维有什么作用？」
 *     「帮我看看红烧排骨这道菜」各两次)—— 全部放行
 *   · 应当拦截的 2 次(明说吃了含花生的菜)—— 全部拦截
 *
 * 打开之前它是关的,因为节点 7 的后置校验扫 `json.dumps(result)` 全文,
 * 连 `advice` 一起扫:给一个花生过敏的人写「避免花生」这条正确建议,
 * 反而会被判定命中并拦截 —— 越需要建议的人越拿不到建议。而且不确定:
 * 同一句话两次跑可能一次拦一次不拦。
 *
 * ⚠️ 2026-09-23 对话换成膳享+ 之后这一行**仍然是 true**,但成立的理由变了:
 * 膳享+ 身上**有和节点 7 同样毛病的一个 bug** —— 实测把 JSON 那份 query 发给它,
 * 它把 profile 里的忌口读成「用户吃了这些」,直接回 `blocked: true`。所以对话
 * 那条路改发**大白话**(`buildChatQuery`),这个 bug 就绕过去了:实测大白话那份
 * 能正常回答,而且 advice 里专门写了一条【过敏警示】提醒去确认花生油。
 *
 * 所以这个开关现在管的是「**要不要**把档案发过去」,不是「用哪种格式发」——
 * 格式由调用方定:识图必须发 JSON(食衡要 `json.loads`),对话必须发大白话。
 *
 * 真遇到一个两种格式都读不懂的应用,把这一行改回 false:App 会退回只发用户
 * 那句话,agent 读不到档案但仍然可用(不会白屏)。
 * `npm run probe` 的第一对对照实验(测的是食衡那条路)仍然可以用来判断
 * 食衡该不该收档案。
 */
export const SEND_PROFILE_TO_AGENT = true

/**
 * 饮食目标 → 工作流的枚举码。
 *
 * 认不出的目标**原样保留**,不丢弃、也不猜一个最近的码 ——
 * 用户自己写进档案的目标(比如「备孕」「增肌」)是真信息,
 * 模型读中文毫无问题,丢掉才是损失。
 *
 * ⚠️ **这张表是「线上词表的本地镜像」,不是可以随便加的地方。**
 * 线上提示词里的目标词表是**封闭的**(`dify/食衡MealBalance.yml` 那段
 * `healthGoals[]`)。给一个线上没有的词编个码塞进来,模型拿到的是一个它
 * 认不出的 token —— 比中文直传**更差**,而且看不出来。
 * verify-loop 有一条断言盯着:**这张表里每一个码都必须原样长在线上 yml 里**。
 *
 * 「少辣」「口味清淡」(2026-09-22 从「饮食偏好」搬进 `GOAL_PRESETS`)
 * **故意没有码**,走的就是下面那个 `?? g` 兜底。想让它们变成真的码,
 * 得先在 Dify UI 里把词表补上 —— 不要重导入 `dify/` 那份本地 yml。
 */
export const GOAL_CODES: Record<string, string> = {
  控盐: 'salt_control',
  控糖: 'sugar_control',
  控油: 'oil_control',
  均衡饮食: 'balanced',
  身材管理: 'body_management',
  减重: 'body_management',
}

/**
 * 特殊阶段 → 工作流的枚举码。**和上面 `GOAL_CODES` 是同一条规矩**:认得出的
 * 映射成码,认不出的原样发中文。
 *
 * 词表是 2026-09-19 在 Dify 那段提示词里逐字读到的 —— 它给 `specialStage[]`
 * 列的取值是 `pregnancy / elderly / child / recovery`。
 *
 * 2026-09-20 之前本 App 的预设是 `无 / 孕期 / 哺乳期 / 更年期`,只有 `孕期`
 * 一个能对上 —— **另外三个码一直没人用**。那一轮把预设换成了自己能确认的
 * 四项(见 types.ts 的 SPECIAL_STAGES),于是:
 *
 *   · **青少年 → `child`、老年 → `elderly`、术后康复 → `recovery`。**
 *     这三个不是硬凑的:它们是工作流**自己声明**要的取值,接口早就开在那里,
 *     只是 App 这边一直没有一个能对上号的选项。
 *   · **哺乳期、术前准备 —— 那个词表里仍然没有对应的码。** 硬塞成 `pregnancy`
 *     是编造事实(孕中期 +300kcal,哺乳期 +500kcal,不是一回事);丢掉又是丢真
 *     信息。所以原样发中文,和用户自定义目标「备孕」的处理完全一致。
 *   · **用户自己写的词也走这一支** —— 原样发中文。
 *   · **`[]`(没有特殊阶段)是空列表**,不是往列表里塞一个词表外的字面量。
 *     键照发(和 `healthRestrictions: []` 一个待遇),只是值为空。
 */
export const STAGE_CODES: Record<string, string> = {
  孕期: 'pregnancy',
  青少年: 'child',
  老年: 'elderly',
  术后康复: 'recovery',
}

/** 特殊阶段列表 → 工作流那个列表。空数组是空列表,理由见 `STAGE_CODES` */
export function stageCodes(stages: readonly string[]): string[] {
  return stages.map((s) => STAGE_CODES[s] ?? s)
}

/**
 * 严重程度 → 工作流的英文枚举。
 * 节点 7 判的是 `r.get("severity") == "high"`,发「高危」过去它永远不匹配。
 */
const SEVERITY: Record<Restriction['level'], string> = {
  高危: 'high',
  中危: 'medium',
  低危: 'low',
}

/**
 * agent 需要的「这一餐是哪一餐」,由界面上的餐次映射过来。
 *
 * ⚠️ **三顿加餐都映射成 `snack`** —— 线上那条工作流里**没有任何节点认这三个码**:
 * 2026-09-22 在 `dify/` 里搜过 `breakfast|slotCode`,一个字都没有。所以这个字段
 * 目前是给模型读的一句话,把「上午加餐/下午加餐/夜宵」原样发过去它也读得懂。
 * 之所以仍然做这层映射,是为了**保住这个词表本来的形状** —— 哪天线上真按码分支,
 * 三档加餐喂一个 `snack` 是安全的,而喂三个它没见过的码不是。
 *
 * 判据在 `lib/slots.ts`(`isSnackSlot`)—— 别在这儿再写一遍三个字面量。
 */
const SLOT_CODES: Record<string, string> = {
  早餐: 'breakfast',
  午餐: 'lunch',
  晚餐: 'dinner',
  上午加餐: 'snack',
  下午加餐: 'snack',
  夜宵: 'snack',
}

export interface AgentQueryOptions {
  /** 用户这句话的原文。JSON 解析万一失败,节点 2 靠它兜底,所以一定要发 */
  text: string
  /** 显式指定分析路径,不传则由模型判断 */
  mode?: AgentMode
  /**
   * 这次请求要工作流干**哪一件事**。
   *
   * 不传 = 完整那一路(现状):认菜 + 建议 + 联网补营养,一次给全。
   * `'names'` = **只要菜名**:工作流走另一条短路,不查知识库、不联网、
   * 输出只有几十个 token —— 实测比完整那一路早好几秒回来。
   *
   * ⚠️ 工作流那边**不认识 `stage` 时会忽略它**,照常跑完整逻辑。所以这个字段
   * 天生向后兼容:App 先发出去,工作流什么时候改都行 —— 在改之前它只是白跑
   * 一趟(快路径退化成完整那一路,结果照旧正确,只是没有提前量)。
   */
  stage?: 'names'
  /**
   * 第一遍被整条拦掉之后,**App 重问**那一次带上更强的一句。
   *
   * 见 `buildChatQuery` 末尾那段:基线那一句是每次提问都带的,这一项只是在
   * 「模型没听话、还是把整条拦了」时把话再说重一遍。两句话的分工写在那边。
   */
  insist?: boolean
  /**
   * ⚠️ **这里不是图片通道 —— 图片不走 query。**
   *
   * 当初接图之前猜的是「把图片 URL 塞进 JSON 一起发」,接上真实链路之后
   * 证明是错的:Dify 的图片走的是 `chat-messages` 的 **`files` 数组**
   * (`{type:'image', transfer_method:'local_file', upload_file_id}`),
   * 和 query 是两条完全独立的通道。往这个字段里塞 URL,**模型一个字都看不到**,
   * 因为工作流的 LLM 节点只认 `sys.files`,不认 query 里的任何字段。
   *
   * 那为什么还留着?**因为它现在恒为 `[]`** —— 一个空数组不会误导工作流,
   * 而删掉它会让线上的 query 结构变一次(节点 2 若读过它就会从 `[]` 变成
   * `undefined`),收益是零。真正危险的不是这个字段存在,而是**没人说明就以为
   * 它能传图**,所以这里把话说死。图片那条路见 src/lib/dify.ts 的 recognizeStream。
   */
  images?: string[]
  /** 当前时间。显式传入而不是内部取 —— 便于自检里固定时间做断言 */
  now?: Date
}

/**
 * 把档案 + 当天摄入组装成 agent 要的那段 JSON 文本。
 *
 * 返回值直接当 `query` 发出去,不是当 inputs 发 —— 理由见文件头。
 */
export function buildAgentQuery(
  profile: Profile,
  meals: MealEntry[],
  opts: AgentQueryOptions
): string {
  const now = opts.now ?? new Date()
  const today = dayStats(meals, toISODate(now), profile)
  const n = today.nutrition
  const q = profile.quota

  /* ---------- 当天摄入 ---------- */
  // 「今天还差哪几餐」在这里就算好,不让模型去比对日期和时段 ——
  // 它能算,但算错了没人发现;代码算错了自检会红。
  const missingSlots = MAIN_SLOTS.filter((slot) => !today.slots.some((s) => s.slot === slot))

  const todayIntake = {
    date: toISODate(now),
    time: formatTime(now),
    meals: today.slots.map((s) => ({
      slot: s.slot,
      slotCode: SLOT_CODES[s.slot] ?? s.slot,
      // 展开到「食物 + 克数」这一层:模型要算营养,给它菜名没用
      items: s.entries.flatMap((e) => e.items.map((i) => ({ name: i.name, grams: i.grams }))),
    })),
    // 取整和界面上的数字保持一致 —— 上下文里的 1832.6 和界面上的 1833
    // 对不上时,模型复述哪个都显得它在胡说
    total: {
      kcal: Math.round(n.kcal),
      protein: Math.round(n.protein),
      carb: Math.round(n.carb),
      fat: Math.round(n.fat),
      sodium: Math.round(n.sodium),
      sugar: Math.round(n.sugar),
    },
    quota: { ...q },
    missingSlots,
  }

  const query: Record<string, unknown> = {
    profile: {
      basicInfo: {
        // 发出去的是**年龄**(模型读得懂、也和提示词里的说法一致),
        // 出生年月是 App 内部存的形状,不进这一段
        age: ageOn(profile.birth, now),
        gender: profile.gender,
        heightCm: profile.height,
        weightKg: profile.weight,
      },
      healthGoals: profile.goals.map((g) => GOAL_CODES[g] ?? g),
      healthRestrictions: profile.restrictions.map((r) => ({
        item: r.item,
        type: r.type,
        severity: SEVERITY[r.level],
      })),
      /*
        特殊时期 / 慢性病 / 饮食偏好 / 特殊营养 —— 档案页有这四项了,所以发。

        口径是**逐字段定**的,不是一刀切,因为工作流对它们的消费方式不一样。
        2026-09-19 在 Dify 里逐字读过引用它们的那段提示词,节选:

          `specialStage[]（pregnancy/elderly/child/recovery）、healthGoals[]（…）、
           specialNutrition[]、dietaryPreferences[]、healthRestrictions[]（…）`

        读出来两件事:

        1. **它在提示词正文里,是给模型看的字段说明,不是代码节点里的比较。**
           这既是好消息也是坏消息:没有 `== "pregnancy"` 那种会崩的比较,所以形状
           错了不会报错 —— 而「不会报错」正是这里必须把形状对齐的理由,不是可以
           不对齐的理由。没有异常兜底,唯一的护栏就是真去看一眼它要什么。
        2. **那段说明里没有 `chronicConditions`。** 工作流不认识这一项。多发一个
           模型读得懂的键没有坏处,少发则是让模型看不见用户的慢性病 —— 照发中文。

        取值口径见 `STAGE_CODES` 和 `GOAL_CODES`:能对上词表的映射成码,对不上的
        原样发中文。
      */
      specialStage: stageCodes(profile.specialStages),
      chronicConditions: profile.chronicConditions,
      dietaryPreferences: profile.dietaryPreferences,
      /*
        引导最后一步那句「还有要补充的吗」—— **键名是新的,那个词表里没有它**,
        和工作流不认识 `chronicConditions` 是同一处境:多发一个模型读得懂的键
        没有坏处,少发则是让模型看不见用户特意写下的话。

        没有补充时发空串,不省略键 —— 省略会让「这个键在不在」变成第二件要
        判断的事,而它本来只是「有没有内容」。
      */
      notes: profile.notes,
      /*
        `specialNutrition` —— 提示词里声明了它是个 `specialNutrition[]`,但**没写
        里面装什么**。以前这里是「故意不发」,理由是形状猜不出来;现在改发,靠的
        不是猜得更准了,而是**形状本身就排除掉了最坏的那种猜错**:

        数组里装数(「+300kcal」)和装文字(「孕中期要加 300kcal」)都可能,而下面
        填进去的是**带数字的句子** —— 两种读法都拿得到正确数字。原来怕的是发一个
        数过去、而它其实要一段文字,于是模型手上没有数字只能自己编;发句子把这个
        失败模式整个绕过去了。

        填的是 `quotaNotes()` 里每条生效调整的 `basis`,和档案页「这些数字为什么
        是这样」印的是**同一张表**。所以问答里说的和界面上写的不可能互相矛盾 ——
        要是这里另写一份文案,它迟早和配额算法分家,而那正是本仓库一直在盯的事。

        没有生效调整时是空数组,不省略键(和 `healthRestrictions: []` 一致);
        空数组不会让工作流以为「填了点什么」。
      */
      specialNutrition: quotaNotes(profile).map((n) => n.basis),
      /*
        「屏幕上每一个配额数字是**谁定的**」—— 逐项列好,让模型照着抄。
        ------------------------------------------------------------
        和上面 `specialNutrition` 是**两件事**,所以是两个键:

        · `specialNutrition` 是**条件调整的散文**(「《指南》孕中期:每日增加约
          300kcal、蛋白质 +15g」),回答「为什么会有这条建议」。
        · `quotaBasis` 是**逐项的来处**,形如「高血压 → 钠上限 1500mg」,
          回答「屏幕上这个数哪来的」。八项**全都在**,包括没有任何条件调整的
          那些(它们会写成「膳食指南 → 钠上限 2000mg」)。

        八项全发是**有意**的:回答里可能出现任何一个数,而模型手上必须有一条
        能原样抄的依据行。只发「被条件改过的那几项」的话,一个没有慢性病的人
        问「今天盐吃多了吗」时,模型面对 `钠 2000mg` 找不到可引的一行,
        于是要么不写依据、要么自己编一句 —— 而这两种我们都不想要。

        内容由 `quotaBasisLine` 生成,**和对话页本地应答那行小字、以及档案页
        「这些数字为什么是这样」是同一处计算**(见 quota.ts:三件事由同一张表
        驱动)。所以模型说的和你屏幕上看到的不会互相矛盾。

        手改过的那几项会写成「你手动设的 → 钠上限 1200mg」—— 这正是模型该说的:
        屏幕上生效的就是他钉的那个数,不是推导值。
      */
      quotaBasis: quotaBasisLine(
        profile,
        QUOTA_FIELDS.map((f) => f.key)
      ),
    },
    /**
     * 当日摄入。
     *
     * ⚠️ 现在发过去是**没用的** —— 节点 2 只挑它认识的键,这个会被丢掉。
     * 保留在这里是因为用户问「今天盐吃多了吗」时,agent 确实需要这些数字;
     * 接上只需要在工作流里加一行(见 README「让 agent 读到你的健康档案」)。
     * 发一个暂时没人读的字段,比以后再改一次 App 划算。
     */
    todayIntake,
    input: {
      text: opts.text,
      // 恒为 [] —— 图片不从这里走,别往这里塞 URL(见 AgentQueryOptions.images)
      images: opts.images ?? [],
    },
  }

  // 不传 mode 就整个键都不出现 —— 发一个 null 过去是在替模型做决定
  if (opts.mode) query.mode = opts.mode
  // 同理:不传就是「完整那一路」。工作流那边读的是「有没有这个键」
  if (opts.stage) query.stage = opts.stage

  return JSON.stringify(query)
}

/**
 * 把档案 + 当天摄入写成**大白话**,给对话那个 agent(膳享+)。
 *
 * 为什么不发上面那份 JSON、为什么也不是「把 JSON 反解成句子」—— 见文件头
 * 「两份 query」那一段。这里只记结构上的三件事:
 *
 *   ① 第一行那句「这是**我的情况**,不是我这餐吃的东西」是**功能性的**,不是
 *      客套。膳享+ 误报过敏拦截的根因就是分不清档案和当天摄入;把这句话摆在
 *      最前面是实测下来能稳定绕过去的做法(见文件头)。
 *   ② 今天已经记录的三餐 —— 用户问「今天盐吃多了吗」时它需要这些数字。
 *      克数展开到「食物 + 克数」这一层,和 JSON 那份口径一致:模型要算营养,
 *      给它菜名没用。
 *   ③ 最后才是用户那句话本身。
 *
 * 没有的档案项**整行不出现**(而不是写「无」)—— 一行「饮食偏好:无」会让模型
 * 以为用户特意声明过「没有偏好」。一餐都没记时则是**一句话**
 * (「今天还没有记录任何一餐」),不是一个空表。
 *
 * 配额那行用 `formatQuota` 生成,**和档案页上印的是同一处文案** ——
 * 这样对话里说的「钠上限 1500mg」和屏幕上的那个数不可能互相矛盾。
 */
export function buildChatQuery(
  profile: Profile,
  meals: MealEntry[],
  opts: AgentQueryOptions
): string {
  const now = opts.now ?? new Date()
  const today = dayStats(meals, toISODate(now), profile)
  const n = today.nutrition

  const lines: string[] = ['下面是我的健康档案（这是「我的情况」，不是我这餐吃的东西）：']

  const basics = [
    `${ageOn(profile.birth, now)} 岁`,
    profile.gender,
    `身高 ${profile.height}cm`,
    `体重 ${profile.weight}kg`,
  ]
  lines.push(`· 基本信息：${basics.filter(Boolean).join('、')}`)
  if (profile.goals.length) lines.push(`· 饮食目标：${profile.goals.join('、')}`)
  if (profile.restrictions.length)
    lines.push(`· 过敏与忌口：${profile.restrictions.map((r) => `${r.item}（${r.level}）`).join('、')}`)
  if (profile.specialStages.length) lines.push(`· 特殊阶段：${profile.specialStages.join('、')}`)
  if (profile.chronicConditions.length) lines.push(`· 慢性病：${profile.chronicConditions.join('、')}`)
  if (profile.dietaryPreferences.length) lines.push(`· 饮食偏好：${profile.dietaryPreferences.join('、')}`)
  if (profile.notes.trim()) lines.push(`· 我要补充的：${profile.notes.trim()}`)

  lines.push('', `我今天（${toISODate(now)}）已经记录的：`)
  if (today.slots.length === 0) {
    lines.push('· 今天还没有记录任何一餐')
  } else {
    for (const s of today.slots) {
      const items = s.entries.flatMap((e) => e.items.map((i) => `${i.name} ${i.grams}g`))
      // 有餐次但一道菜都没有(手滑建了个空餐)时整行跳过,不印一行光秃秃的「早餐：」
      if (items.length) lines.push(`· ${s.slot}：${items.join('、')}`)
    }
    // 取整和界面上的数字保持一致,理由同 buildAgentQuery 里那段
    lines.push(
      `· 今天合计：热量 ${Math.round(n.kcal)}kcal、蛋白质 ${Math.round(n.protein)}g、` +
        `碳水 ${Math.round(n.carb)}g、脂肪 ${Math.round(n.fat)}g、` +
        `钠 ${Math.round(n.sodium)}mg、添加糖 ${Math.round(n.sugar)}g`
    )
  }
  lines.push(
    `· 我给自己定的一天配额：${QUOTA_FIELDS.map((f) => formatQuota(f.key, profile.quota[f.key])).join('、')}`
  )

  /*
    ⚠️ **这一句是功能性的,不是客套 —— 和上面档案那段的「这是「我的情况」」同一类。**

    膳享+ 的提示词第 1 步写的是「severity = high 的过敏项**命中输入** → 直接返回
    `blocked: true`,**不生成建议**」,而「输入」在它眼里就是**整段 query**——
    档案那几行 + 「我今天已经记录的」那几餐 + 用户的问题,全都在里面。于是:

      · 一个有鸡蛋过敏的人,今天记录里恰好有一道含蛋的菜(演示数据给的就是
        「燕麦粥 + 煮鸡蛋 + 牛奶」这种早餐)——
      · 他问**任何**一句话,回来的都是「检测到高危食材/成分「鸡蛋」,已拦截」,
      · 屏幕上一条建议都没有。

    实测复现过:同样的档案,今天记录里有蛋 → 打两次拦两次;把今天记录清空 →
    打两次全放行。也就是说拦的是「**你今天已经吃过的东西**」,不是「你这次问的
    东西」—— 而「已经吃掉的」不该让用户连问题都问不成。

    所以这里替用户把话说明白。用户 2026-09-23 定的口径是「聊天里干脆不拦」,
    硬拦只留给拍餐盘那一屏(那里确实有一份建议要拦)。

    冲突摆哪儿,2026-09-24 又定了一次:**摆到卡片最上面那条结论条**(`risk`),
    不是 advice 里的一行。用户的原话是「不要硬拦截,就是第一条明显的提醒,
    然后后面的菜该怎么吃就怎么吃」—— 他说的「第一条」是位置,不是编号,
    而 advice 那块在卡片最底下。所以这一句现在指着 `risk`。

    基线这一句**每次提问都带**;`insist` 那次是模型没听话时的第二次,把话说重一遍。
    发图那条路用的是同一个函数,而它**还有一层兜底** —— 模型咬死 `blocked` 时
    `recognizeAgent.runRecognition` 会带着 `insist` 再跑一趟(2026-09-24)。
  */
  lines.push(
    '',
    '（上面「已经记录的」是我**已经吃掉**的东西，不是你这次要评价的对象。' +
      '如果里面有我忌口或过敏的食材，**不要返回 blocked、也不要整条拦下不回答**——' +
      '照常把菜品、做法和建议给全，只把这条冲突写进 `risk`：' +
      /*
        ⚠️ 这里**不能写出那个英文枚举**（`high` / `medium` / `low`）——
        `verify-loop` 有一条断言盯着「整份 query 里不许出现 `high`」，
        它挡的是「忌口那一行改用 severity 枚举发出去」。所以这一句说
        「最高那一档」，让模型自己去对它的 schema。
      */
      '`risk.level` 给最高那一档，`risk.message` 一句话说清是哪样东西不能吃，' +
      '`risk.items` 里把它点名。那块会长在卡片最上面，当第一条提醒；' +
      '**别再往 advice 里也抄一遍**，同一句话说两遍读起来像两份结论。）'
  )
  if (opts.insist) {
    lines.push(
      '（上一次回答因为过敏规则被整条拦下了，我一条建议都没拿到。' +
        '这一次请务必照常回答，不要返回 blocked: true —— 把那条冲突写进 `risk`。）'
    )
  }

  lines.push('', `我的问题：${opts.text}`)

  return lines.join('\n')
}

/**
 * 本地时区的 YYYY-MM-DD。
 *
 * 这里不用 `toISOString().slice(0,10)` —— 那会转到 UTC,在东八区,
 * 晚上 8 点之后记的餐会掉进「昨天」,导致发给 agent 的今日摄入少一餐。
 * 和 `src/lib/date.ts` 里 `todayISO()` 是同一条理由,只是那边取的是
 * 当前时刻,这边要按传入的时间算。
 */
function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
