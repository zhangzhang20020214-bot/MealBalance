/**
 * 拍照识别 —— 真实链路
 * ===========================================================
 * 把「一张压缩好的图」变成「一份 RecognizedMeal」的完整一步:
 *
 *     压缩好的 JPEG ─▶ buildAgentQuery(mode:'plate') ─▶ /api/recognize
 *                                                          │
 *                                     Dify: 上传 → 带图提问 → SSE
 *                                                          ▼
 *              RecognizedMeal ◀── matchDishes ◀── parseAgentReply
 *
 * 这个模块**只负责把一次请求跑完并抛出失败**,不碰任何全局状态 ——
 * 降级决定、超时、压缩、预览图的生命周期都在 src/store/recognizeOne.ts 里,
 * 取消和重试再上一层(src/store/plate.ts)。
 * 这样它可以脱离 React 单独被测(见 scripts/verify-reply.mjs 的同类做法)。
 *
 * 为什么 query 要走 buildAgentQuery 而不是发一句「这是什么菜」
 * ------------------------------------------------------------
 * 工作流第一步是 `json.loads(sys.query)`,解析出来的 profile 喂给**过敏原拦截**。
 * 发纯文本的话解析失败、profile 置空,于是拍餐盘这条路会**静默失去过敏拦截** ——
 * 一个说自己花生过敏的人拍了一盘宫保鸡丁,拿到的是一份正常的营养分析。
 * 档案、当日摄入、过敏原全都跟着这个 JSON 走,一行新逻辑都不用写。
 */

import { AgentError, chatStream, recognizeStream, recognizeTextStream } from './dify'
import { advance, stageOfNode, type AnalyzeStage } from './analyzeStage'
import { buildAgentQuery, buildChatQuery } from './agentContext'
import { parseAgentReply, type AgentReply } from './agentReply'
import { matchDishes } from './dishMatch'
import { SESSION_USER } from './session'
import type { MealEntry, MealSlot, Profile } from '../store/types'
import type { RecognizedMeal } from '../store/recognize'

/**
 * 发给模型的那句话。
 *
 * 刻意**不在这里教模型输出格式** —— 格式是 Dify 工作流里 LLM 节点的提示词定的,
 * 从客户端再叮嘱一遍只会多一份可能与它对不上的说明。这句话的角色是
 * 「用户说了什么」,`mode: 'plate'` 才是「走哪条分析路径」。
 *
 * 顺带一提:`dishMatch.DishInput` 本来就接受可选的 `grams` 和 `foodId`。
 * 哪天提示词里加上这两个字段,这个文件一行都不用改 —— 有就用,没有就用
 * 食物库的常见分量。
 */
const PLATE_TEXT = '请分析这份餐盘'

/**
 * 模型「认不出」时给的那种名字 —— 它不是菜名,是一句说明。
 *
 * 这不是猜的:scripts/probe-vision.mjs 第 3 步拿一张纯色方图走了一遍真实链路,
 * 模型老老实实回了「未知菜品 (图片无法识别)」。那是**正确**行为 ——
 * 那张图里确实没有菜。但这个名字不能当一道菜往下走:
 *
 *   1. matchDishes 的 normalizeDishName 会把它剥成「未知菜品」,落不进食物库
 *   2. 于是结果页出现一行「未知菜品 · 估算 0g · 0 kcal」
 *   3. 而 items 非空 → 结论卡、营养卡、建议卡全都照常渲染,只是数字全是 0
 *   4. 归档之后,日记里就多了一条叫「未知菜品」的记录
 *
 * 用户看到的是「识别到一道菜:未知菜品」—— 一句被包装成数据的失败说明。
 * 所以这里把它挑出来,换成一句人话交给结果页(见 RecognizedMeal.noDishReason)。
 */
const NOT_A_DISH = /未知|未识别|无法识别|不能识别|无法辨认|不可辨认|辨识不出|看不出|图片不清|图像不清/

export interface RunRecognitionOptions {
  /** 压缩后的 JPEG(见 image.ts) */
  image: Blob
  slot: MealSlot
  profile: Profile
  /** 当天已有的记录 —— 发给 agent 当上下文,和对话页用的是同一套 */
  meals: MealEntry[]
  signal?: AbortSignal
  /** 覆盖会话标识,自检用 */
  user?: string
  /** 透传进结果的预览图与缩略图,由调用方(plate.ts)负责持有 */
  photoUrl?: string
  thumbDataUrl?: string
  /**
   * 真实阶段回调 —— 每认出一个工作流节点就报一次。
   *
   * 不传就什么都不做:对话那条路走 `chatStream`,根本不经过这个函数。
   * 报出去的值保证是**单调前进**的(见 `advance`),调用方直接写进状态即可,
   * 不必自己再挡一次乱序。
   */
  onStage?: (stage: AnalyzeStage) => void
  /**
   * **预结果** —— LLM 节点一跑完就先交出来的那一份。
   *
   * 为什么要有它:工作流在 LLM 之后还挂着「抽取库外菜 → 联网搜索 → 营养折算」,
   * 而那一段实测 3~16 秒。可它补的**只是库外菜的每 100g 营养值** ——
   * 菜名、suitable、reason、advice 在 LLM 节点结束时就已经全了。
   *
   * 所以这一份预结果**除了库外菜的营养之外什么都是真的**:它可以直接交给
   * 用户去确认分量,而真正的等待(联网那一段)藏进了用户自己挑分量的时间里。
   *
   * 不传就什么都不做 —— 和 `onStage` 一样可选。同一趟最多报一次。
   */
  onProvisional?: (meal: RecognizedMeal) => void
  /**
   * **走哪个 agent。** 不传 = 食衡(识一餐,带食物库目录那条);`'chat'` = 膳享+。
   *
   * ⚠️ 为什么要有它:对话页发图**和打字必须归同一个 agent** —— 用户眼里那是
   * 同一个对话框。原来发图走食衡(它是「认一餐」的工作流),于是发一张配料表
   * 过去,它只会当成一次失败的识别去答;用户看到的「乱答」「没读出来」都是这么来的。
   *
   * 膳享+ 的 LLM 节点本来就开着 Vision,而它的提示词第 0 步会先判断用户问的是
   * 哪一类 —— 发配料表回配料表分析、发冰箱回冰箱建议,那是它自己的活。
   *
   * ⚠️ 两条路的 **query 格式不一样**,不能只换端点:食衡那条要 JSON(它第一步是
   * `json.loads`),膳享+ 那条要大白话(没有 json 解析那一步,发 JSON 过去会被读成
   * 「用户吃了这些忌口」并误报过敏拦截 —— 实测 `blocked: true`)。
   */
  agent?: 'chat'
  /**
   * **用户自己打的那句话。** 只有走膳享+ 那条路时用得上。
   *
   * ⚠️ 不传就退回一句「看看这张图」—— 那是**权宜**,不是设计:用户打「读配料」
   * 却只发出去「看看这张图」,模型当然答不到点上,看起来就像乱答。
   */
  text?: string
  /**
   * **第二趟**用:把「照常回答,不要返回 `blocked: true`」那句话说重一遍。
   *
   * 只有对话那条路认它 —— 食衡那条 query 是一份 JSON,这句话没有容身之处。
   * 谁在什么时候传它,理由写在 `recognizeOne` 里调用 `runRecognition` 的那一处。
   */
  insist?: boolean
}

/**
 * 跑一次识别。
 *
 * @throws {AgentError} 上游不可用 / 限流 / 图片被拒 / 某个工作流节点失败 / 模型没给出可用的菜品清单
 */
/**
 * agent 报的每道菜 → `matchDishes` 的输入。
 *
 * 抽出来是因为它现在有**两个**调用点:终稿那条路,以及 LLM 节点刚跑完时报出去的
 * 预结果。两处各写一遍的代价不是难看,是迟早走散 —— 一处带了 `per100g`、
 * 另一处没带,表现是「结果页有联网营养,而预结果里同一道菜按 0 计」。
 */
function dishInputs(dishes: AgentReply['dishes']) {
  return dishes.map((d) => ({
    name: d.name,
    ...(d.foodId ? { foodId: d.foodId } : {}),
    ...(d.grams !== undefined ? { grams: d.grams } : {}),
    ...(d.per100g && d.source ? { per100g: d.per100g, source: d.source } : {}),
    /*
      ⚠️ **慎选 + 理由必须带过去(2026-09-24)。** 从前就是在这里丢的 —— 这个
      函数是个纯搬运工,漏两个字段不报错,而它两头的单元测试各自都是绿的
      (`agentReply` 断自己解析对了、`dishMatch` 断自己匹配对了),中间这一段
      谁都没盯着。表现是:模型明说了「含花生」,卡片上那道菜和别的菜一模一样
      —— 正是用户第二次纠的那个「显眼的高危提醒没了」。

      `suitable !== false` 的一律不带:那会把解析层那个「缺失按 true 处理」的
      默认值固化成一次**明确的判断**,而下游是拿 `=== false` 当标红判据的。

      条件展开而不是 `suitable: undefined`,理由同上面 foodId 那两行:
      「模型到底提没提这件事」在下游要能一眼看出来。
    */
    ...(d.suitable === false ? { suitable: false } : {}),
    ...(d.suitable === false && d.reason ? { reason: d.reason } : {}),
  }))
}

/**
 * 预结果 —— LLM 节点一跑完就能交出去的那一份。
 *
 * 和工作流最终那一份的差别**只有一处**:库外菜还没拿到联网查回来的每 100g
 * 营养值(于是它们落在 `unmatched` 哨兵上,而不是终稿里的 `web:`)。
 * 菜名、suitable、reason、advice 全都是这一个节点吐出来的,所以全都齐。
 *
 * ⚠️ **这里一律不抛错。** 它是「顺手先给一份」,不是权威判断:解析不出来、
 * 认不出菜、模型只回了半截 JSON,都只意味着「这一趟没有预结果」,让调用方
 * 继续等终稿就行。判断「这次到底成没成」是 `runRecognition` 的职责,
 * 只有那条路会抛。
 *
 * **导出是给对话页那条打字路用的**（2026-09-24，见 `store/unlogged.ts` 文件头）：
 * 打字问出来的回答里也有菜名，那些菜同样该能被补记进日记。导出的理由和
 * `dishInputs` 那段注释是同一条 ——「reply → 一份 `RecognizedMeal`」这件事
 * **只有这一处实现**，那边再抄一遍迟早走散（抄的那份会漏掉 `unmatched`、
 * 或者不滤 `NOT_A_DISH`，表现是草稿里躺着「未知菜品」）。
 *
 * 调用方不用自己兜两件事，都由它的契约保证：一律不抛错；`blocked` 那份返回
 * `items: []`（空清单会被 `worthAsking` 判成「不值得问」，于是不弹补记窗）。
 */
export function provisionalFromReply(reply: AgentReply | null, slot: MealSlot): RecognizedMeal | null {
  if (!reply) return null
  // 过敏拦截:dishes 是空的,而风险信息本身就是全部内容
  if (reply.blocked) return { slot, items: [], engine: 'agent', agentReply: reply }

  const named = reply.dishes.filter((d) => !NOT_A_DISH.test(d.name))
  if (named.length === 0) return null

  const matched = matchDishes(dishInputs(named))
  return {
    slot,
    items: matched.items,
    engine: 'agent',
    unmatched: matched.unmatched,
    agentReply: reply,
  }
}

export async function runRecognition(opts: RunRecognitionOptions): Promise<RecognizedMeal> {
  const viaChat = opts.agent === 'chat'
  const query = viaChat
    ? buildChatQuery(opts.profile, opts.meals, {
        text: opts.text?.trim() || '看看这张图',
        // 第二趟(见 `recognizeOne` 里那段)把「照常回答、别返回 blocked」说重一遍
        ...(opts.insist ? { insist: true } : {}),
      })
    : buildAgentQuery(opts.profile, opts.meals, { text: PLATE_TEXT, mode: 'plate' })

  let raw = ''
  /**
   * 已经报出去的那个阶段。回调的单调性靠它 —— 上游的 `node_started`
   * 不保证按拓扑序到达(分支、重试、传输层错序都会打乱),没有这个游标
   * 就会出现「进度条退回去」。
   */
  let stage: AnalyzeStage | undefined
  /**
   * 第一个失败的节点名。Dify 把节点失败报成 `node_finished` + `status: 'failed'`。
   *
   * 这条事件原来被整个循环丢掉了,而丢掉它的代价不小:某个节点炸了 →
   * 一个 message 都没有 → 下面抛出「模型没有返回任何内容」→ 界面上写着
   * 「识别失败(模型没有返回任何内容),本次为演示数据」。
   * **那句话和真实原因毫无关系** —— 模型可能压根没被调用到。
   *
   * 只记第一个:后面的失败多半是被它带塌的连锁反应,报第一个才指得准。
   */
  let failedNode: string | null = null

  /** 预结果交出去了没有 —— 同一趟最多报一次 */
  let provisionalSent = false
  /** 回调取一次,免得在循环里反复读 opts */
  const notifyProvisional = opts.onProvisional

  for await (const chunk of viaChat
    ? chatStream({
        query,
        image: opts.image,
        user: opts.user ?? SESSION_USER,
        signal: opts.signal,
      })
    : recognizeStream({
        image: opts.image,
        query,
        user: opts.user ?? SESSION_USER,
        signal: opts.signal,
      })) {
    if (chunk.event === 'message' || chunk.event === 'agent_message') {
      if (chunk.answer) raw += chunk.answer
    }
    /*
     * 节点开始了 —— 这里是**唯一**能拿到真实进度的地方。
     *
     * Dify 把每个节点的开始/结束都推过来(`api/_lib/agent.ts` 原样透传,
     * 那段「必须不解析、不缓冲」的注释是对的),但这个循环一直只认
     * message / error,其余的静默丢掉。于是界面上那十来秒只有一个不动的
     * 转圈,用户分不出「在动」和「死了」。
     *
     * ⚠️ 不能改走 `parseAgentReply` —— 那是个纯函数,只吃一段**完整**的
     * 字符串,而且餐盘和对话两条路共用它。进度是流中途的事,塞不进它的返回值。
     */
    if (chunk.event === 'node_started') {
      const next = stageOfNode(chunk.data?.title ?? '')
      // 认不出的节点直接放过,既不前进也不回退 —— 理由见 analyzeStage.ts
      if (next && opts.onStage) {
        const moved = advance(stage, next)
        /*
         * 只在**真的前进**时上报。
         *
         * 同一个阶段底下可能串着好几个节点(联网那段就是
         * `Bocha Web Search` → `搜索转文本` → `营养折算`),它们不代表屏幕上
         * 那句话变了。每次事件都报一遍只会让订阅方白白重渲染三次,
         * 而回调的语义是「阶段变成了 X」,不是「某个节点动了」。
         */
        if (moved !== stage) {
          stage = moved
          opts.onStage(stage)
        }
      }
    }
    /*
     * LLM 节点跑完了 —— 这是整条链路里**最早能拿到菜名**的时刻。
     *
     * 后面还挂着「抽取库外菜 → 联网搜索 → 营养折算」,实测 3~16 秒,而它们
     * 补的只是库外菜的每 100g 营养值。所以这一份先交出去:用户拿着菜名去
     * 确认分量,那几秒就藏在用户自己的操作里,而不是藏在转圈里。
     *
     * 认不出来就什么都不做,让调用方继续等终稿 —— 预结果是加速,不是兜底。
     */
    if (
      notifyProvisional &&
      !provisionalSent &&
      chunk.event === 'node_finished' &&
      chunk.data?.title === 'LLM' &&
      chunk.data.status === 'succeeded'
    ) {
      const text = chunk.data.outputs?.text
      if (typeof text === 'string' && text.trim()) {
        const early = provisionalFromReply(parseAgentReply(text), opts.slot)
        if (early) {
          provisionalSent = true
          notifyProvisional(early)
        }
      }
    }
    /*
     * 节点失败。
     *
     * ⚠️ **不当场抛。** 当场抛掉的话,后面那些事件就全丢下了,而我们需要的
     * 恰恰是「这一趟到底攒没攒到一段可用的回答」这个判断 —— 有的节点失败是
     * 无害的(工作流自己有兜底分支,比如 `合并营养` 对空输入是容忍的),
     * 那时候正确行为是照常出结果,不是报错。
     *
     * 细节进 console 给开发者,人话进给用户的报错 —— 上游的 `error` 常常是
     * 一段英文异常或堆栈,摆到「分析结果」页上对用户毫无用处。
     */
    if (chunk.event === 'node_finished' && chunk.data?.status === 'failed') {
      // 名字理论上一定有;真没有也给个不撒谎的兜底,别把这条失败整个吞掉
      if (failedNode === null) failedNode = chunk.data.title || '未命名节点'
      console.warn(
        `[recognize] 节点「${failedNode}」执行失败:`,
        chunk.data.error ?? '(上游没给错误信息)'
      )
    }
    if (chunk.event === 'error') {
      throw new AgentError('UPSTREAM_ERROR', chunk.message ?? 'Dify 返回错误')
    }
  }

  /*
   * 流走完一个字都没有:上游 200 了但没内容。当成失败处理,让调用方去降级 ——
   * 静默返回一个空餐盘会让用户看到「识别到 0 道菜」,比明说失败更让人困惑。
   *
   * ⚠️ 有节点失败过的话,**必须报那个节点**,不能报「模型没有返回任何内容」。
   * 后者是一句会把人引向错误方向的话:它暗示模型答了但答得不对,而实际上
   * 很可能是某个节点在模型之前就炸了,模型根本没被调用。按前者去查 Dify 的
   * 节点日志,五分钟;按后者去查提示词和 Vision 开关,能查一下午。
   */
  if (!raw.trim()) {
    throw new AgentError(
      'UPSTREAM_ERROR',
      failedNode ? `节点「${failedNode}」执行失败` : '模型没有返回任何内容'
    )
  }

  const reply = parseAgentReply(raw)

  // ---- 过敏拦截分支 ----
  // 这条分支里 dishes 是空的,而风险信息本身就是全部内容。所以 items 空着交给
  // 结果页渲染拦截卡,不算是解析失败(parseAgentReply 的注释里写了同一件事)
  if (reply?.blocked) {
    return {
      slot: opts.slot,
      items: [],
      engine: 'agent',
      agentReply: reply,
      ...(opts.photoUrl ? { photoUrl: opts.photoUrl } : {}),
    }
  }

  if (!reply || reply.dishes.length === 0) {
    /*
      ⚠️ **`dishes` 空、但回复里有实质内容时,不再当成失败(2026-09-23)。**

      实测过三次同一件事:用户拍的是**配料表 / 包装**,模型把标签读得一字不差
      (配料清单、能量 / 蛋白质 / 钠,还有针对他档案的建议),却把结果填进
      `nutrition` 而 `dishes` 空着。App 只认 `dishes`,于是**把一份完整的分析
      扔了**,还报「这次没认出菜品」—— 用户读成「图太糊」「图没传上去」。

      求模型改口径那条路已经试过:提示词里明写「plate 模式不要填 nutrition、
      要填 dishes」,它照样不听。**别再求它,改成接住它给的东西。**

      判据是「有没有实质内容」:配料、建议,两样里有一样就算。那样这一趟照旧
      出结果 —— 只是结果长成「这是一张标签的分析」,而不是一道菜。
    */
    if (reply && (reply.ingredients.length > 0 || reply.advice.length > 0)) {
      /*
        ⚠️ **这一行必须留着。** 上一版这里直接 return、什么都没打,结果用户说
        「还是没读出来」时我手上**一条证据都没有** —— 日志里只有改之前那两次。
        一个只在成功路径上不发声的分支,等于把眼睛蒙上再调。
      */
      console.warn('[recognize] 没有菜品、但有配料或建议 —— 按标签分析渲染:', raw.slice(0, 500))
      return {
        slot: opts.slot,
        items: [],
        engine: 'agent',
        unmatched: [],
        /*
          ⚠️ 这句是**给用户看的**,它要说清「不是没认出来,是这不是一盘菜」——
          否则结果页那句「模型的回答是『…』」会把这张标签说成一次失败。
        */
        noDishReason: '图里是配料表或包装，不是一盘菜；下面是它读到的内容',
        agentReply: reply,
        ...(opts.photoUrl ? { photoUrl: opts.photoUrl } : {}),
        ...(opts.thumbDataUrl ? { thumbDataUrl: opts.thumbDataUrl } : {}),
      }
    }

    /*
     * 这里是最容易误判的一步。「回来了、但一道菜都没有」有好几种成因,
     * 而**它们的表象一模一样**:
     *
     *   · 图是**配料表 / 营养成分表 / 包装** —— 模型把标签读得一字不差,
     *     却把结果填进 `nutrition` 而**没把那个商品列进 `dishes`**(实测最常见,
     *     2026-09-23 一天里撞到五次)
     *   · 模型漂到了 `ingredient` 那个模式(那一支本来就没有 `dishes`)
     *   · 图太糊、或画面里确实没有能吃的东西
     *   · **LLM 节点的 Vision 没开** —— 图片能上传、请求也 200,模型只是看不见图
     *
     * ⚠️ **原来的文案一口咬定是最后那一种**(「请确认 Dify 的 LLM 节点已打开
     * Vision 开关」)。代价实测过:用户被这句支去翻 Dify 的开关,而开关一直是开的,
     * 真正的原因是第一种。**一句会把人指错方向的报错,比一句含糊的报错更贵。**
     *
     * 所以现在这句只说**能确定的事**:没认出菜品、可以怎么办。原因照旧进
     * console(上面那行 `console.warn` 打的是模型的原始回答,那才是给开发者的)。
     */
    console.warn('[recognize] 模型没有返回菜品清单,原始回答:', raw.slice(0, 500))
    throw new AgentError(
      'UPSTREAM_ERROR',
      reply
        ? '这次没认出菜品。如果拍的是配料表或包装，对着菜本身再拍一张；如果拍的就是菜，换个角度试试。'
        : /*
            ⚠️ 这句会**原样上屏**(对话页那条路:`chatFailMessage` 透传
            `err.message`;拍餐盘那条路:缀进「识别失败（…），本次为演示数据」)。
            原来写的是「模型返回的不是结构化结果,请确认工作流输出格式」——
            那是**叫用户去干他干不了的事**(工作流输出格式只有编排页能改),
            而他真正能做的只有「重试一次」。所以改成只说他能做的。
          */
          '模型答的不是能识别的格式'
    )
  }

  /*
   * ---- 模型其实没认出东西 ----
   *
   * 走到了模型、图也看见了,只是它回的是「图片无法识别」这类说明而不是菜名 ——
   * 于是这里一道真菜都没有。
   *
   * **不能抛错**:抛出去会让 plate.ts 降级成本地随机组菜,而结果页会说
   * 「以下菜品为演示数据,不是识别结果」—— 可模型明明看过那张图了,
   * 随机组出来的那几道菜和照片毫无关系,比直接说「没认出来」更误导。
   * 所以如实返回一个空餐盘 + 模型的回答,由结果页给出重拍/手动两条路。
   */
  const named = reply.dishes.filter((d) => !NOT_A_DISH.test(d.name))
  if (named.length === 0) {
    return {
      slot: opts.slot,
      items: [],
      engine: 'agent',
      unmatched: [],
      // 用模型的原话,而不是我替它总结的一句 —— 用户/开发者都该看到它到底说了什么
      noDishReason: reply.dishes.map((d) => d.name).join('、') || '模型没有给出菜名',
      agentReply: reply,
      ...(opts.photoUrl ? { photoUrl: opts.photoUrl } : {}),
      ...(opts.thumbDataUrl ? { thumbDataUrl: opts.thumbDataUrl } : {}),
    }
  }

  // ---- 菜名 → 食物库 ----
  // 提示词里给了 foodId / grams / per100g 就带上,**没给就不带** —— 有就用、
  // 没有就退回按名字匹配和食物库的常见分量(见 dishMatch.DishInput)。
  //
  // ⚠️ 这里原来是 `({ name: d.name })`,也就是把解析出来的 foodId / grams
  // 重新丢掉一次。加上面几个字段的时候**必须一起改这里**,否则提示词里
  // 加目录 / 联网补营养都不生效,而且什么都不报 —— 表现是「改了,没反应」。
  // scripts/verify-reply.mjs 的「客户端识别链路」有一节专门测这条。
  //
  // 三层的链路是 解析(agentReply) → **转交(这里)** → 匹配(dishMatch)。
  // 中间这一层最容易漏:它不做任何判断、只是搬运,所以漏了不会报错;
  // 而它的两头的单元测试**都会照常通过**(各自测各自的那一段)。
  // 所以 verify-reply.mjs 那条断言是端到端的,穿满三层。
  const matched = matchDishes(dishInputs(named))

  return {
    slot: opts.slot,
    items: matched.items,
    engine: 'agent',
    // 空数组也带上 —— 结果页按「有没有内容」判断,不用再区分 undefined 和 []
    unmatched: matched.unmatched,
    agentReply: reply,
    ...(opts.photoUrl ? { photoUrl: opts.photoUrl } : {}),
    ...(opts.thumbDataUrl ? { thumbDataUrl: opts.thumbDataUrl } : {}),
  }
}

/**
 * 快路径 —— **只要菜名**。
 *
 * 和完整那一路**并行**发出去(见 `recognizeOne`),它回来得早得多:工作流在
 * `stage: 'names'` 那条分支上不查知识库、不联网,输出也只有几十个 token。
 * 用户拿着这份菜名去确认分量,完整那一路(建议 + 联网补营养)还在后面跑。
 *
 * ⚠️ **这一路失败一律返回 null,永不抛。** 它是加速,不是兜底 —— 完整那一路
 * 才是权威。把它的失败报出去,等于让一个「可有可无的提前量」把整次识别判死。
 * 同理,它认不出菜(拿不到菜名)也只是 null:那说明这次没有提前量。
 */
export async function recognizeNames(opts: {
  image: Blob
  slot: MealSlot
  profile: Profile
  meals: MealEntry[]
  signal?: AbortSignal
  /** 覆盖会话标识,自检用 —— 和完整那一路用同一个,别在这里现造一个 */
  user?: string
}): Promise<RecognizedMeal | null> {
  const query = buildAgentQuery(opts.profile, opts.meals, {
    text: PLATE_TEXT,
    mode: 'plate',
    stage: 'names',
  })

  let raw = ''
  try {
    for await (const chunk of recognizeStream({
      image: opts.image,
      query,
      user: opts.user ?? SESSION_USER,
      signal: opts.signal,
    })) {
      if (chunk.event === 'message' || chunk.event === 'agent_message') {
        if (chunk.answer) raw += chunk.answer
      }
      if (chunk.event === 'error') return null
    }
  } catch {
    // 网络层挂了、被 abort 了、上游报错 —— 都只是「这次没有提前量」
    return null
  }

  if (!raw.trim()) return null
  return provisionalFromReply(parseAgentReply(raw), opts.slot)
}

/**
 * 文字那一趟 —— **只给菜名、不给图**,要的是一份带营养的 `RecognizedMeal`。
 *
 * ## 它为什么存在（2026-09-24）
 *
 * 打字问出来的回答里也有菜名，那些菜同样该能补记进日记（用户当天定的口径）。
 * 但「记入日记」那一刻要算营养 —— 而**算营养这件事是食衡的活**，不是本地的：
 * 食衡工作流里挂着「抽取库外菜 → 博查联网搜 → 营养折算」那条链，库外菜的
 * 每 100g 值是它查回来的。原来这一支是拿食物库的常见分量在本地凑一份，
 * 那不是食衡算的，是一份**长得像结果的东西**。
 *
 * 「库里有没有」这个判据**不在这里** —— 和拍照那条路同一道闸:
 * `logRun.computeForLog` 算完再过一遍 `countableItems`。
 *
 * ## 为什么走 `/api/recognize` 而不是 `/api/chat-messages`
 *
 * 膳享+（`chatStream`）那条工作流里**没有查营养的节点**，库外菜会一路落到 0。
 * 食衡那条有 —— 而它那个联网分支的判据是「**有没有库里没有的菜**」，
 * 不是「有没有图」（见 `dify/食衡MealBalance.yml` 里那个 python 节点
 * `has_missing`）。所以没有图它照样会去查。
 *
 * ⚠️ **一律不抛错，认不出就返回 null。** 调用方（`computeForLog`）把它当成
 * 「这一趟没算出营养」，然后照旧不落盘 —— 与拍照那一路失败时的归宿一致。
 * 这里抛出去只会把一次正常回答推进降级分支。
 */
export async function recognizeByNames(opts: {
  /** 回答里报出来的菜名 —— 原样带过去，不在这里挑「库里的」 */
  names: string[]
  slot: MealSlot
  profile: Profile
  meals: MealEntry[]
  signal?: AbortSignal
  /** 覆盖会话标识，自检用 —— 和别的那几条路用同一个 */
  user?: string
}): Promise<RecognizedMeal | null> {
  /*
    ⚠️ 菜名要放进 `text`，**不能**只放进 mode。
    ⚠️ `mode` 仍然是 `plate`：这几道菜是**一餐的菜**（要逐道列进 `result.dishes`），
    而 plate 正是那个「一道都不许漏」的口径。工作流那边一条图都没收到，
    所以这句话必须自己说清「菜名就是下面这些」。
  */
  const query = buildAgentQuery(opts.profile, opts.meals, {
    text: `这一餐的菜是：${opts.names.join('、')}。（没有图片，菜名就是上面这些，请逐道照常分析）`,
    mode: 'plate',
  })

  let raw = ''
  try {
    for await (const chunk of recognizeTextStream({
      query,
      user: opts.user ?? SESSION_USER,
      signal: opts.signal,
    })) {
      if (chunk.event === 'message' || chunk.event === 'agent_message') {
        if (chunk.answer) raw += chunk.answer
      }
      if (chunk.event === 'error') return null
    }
  } catch {
    // 网络层挂了、被 abort 了、上游报错 —— 都只是「这一趟没算出营养」
    return null
  }

  if (!raw.trim()) return null
  /*
    ⚠️ 复用 `provisionalFromReply`，**不要**在这里再写一遍「解析 → 匹配」。
    它是「reply → 一份 `RecognizedMeal`」的唯一实现（见它自己的 JSDoc）:
    抄一遍的那份迟早会漏掉 `per100g`（表现是「联网查回来的营养没进日记」）
    或者不滤 `NOT_A_DISH`（草稿里躺着「未知菜品」）。
  */
  return provisionalFromReply(parseAgentReply(raw), opts.slot)
}
