/**
 * 一张图 → 一份识别结果
 * ===========================================================
 * 这是全 App **唯一**会为「一张餐盘照片」发出视觉模型请求的那一段:
 *
 *     用户选的文件 ─▶ prepareImage（解码 + 压缩 + 缩略图）
 *                         │
 *                         ├─▶ onPrepared(previewUrl)  ← 预览图的所有权在这里移交
 *                         ▼
 *                   runRecognition（Dify 上传 → 带图提问 → SSE）
 *                         │
 *                         ├─ 成功 ─────────▶ { kind: 'ok' }
 *                         ├─ 超时 / 上游挂了 ─▶ { kind: 'degraded' }（本地组一份演示数据）
 *                         ├─ 用户取消 ───────▶ { kind: 'cancelled' }
 *                         └─ 图本身有问题 ───▶ { kind: 'failed' }
 *
 * ## 为什么从 plate.ts 里搬出来
 *
 * 原来「压缩 → 识别」这两步长在 `plate.ts` 的 `run()` 里,而 `plate.ts` 同时
 * 还管着三件**只有首页那条链才需要**的事:job 状态机、generation 令牌、
 * 预览图的 revoke。对话页也要发识别请求,但它一件都不需要 ——
 * 它不跳页、没有 job、还自己管着一批照片。
 *
 * 于是它**不能复用 `startPlateJob`**,三条硬理由(任何一条单独成立就足够):
 *
 *   1. `startPlateJob()` 第一件事是 `setPending(null)`。对话页跑第二张时会
 *      **抹掉第一张的结果**,只能靠「在订阅回调里抢在下一张之前读走」来攒 ——
 *      一个由订阅驱动的隐式状态机。
 *   2. `pending` 是全 App 唯一一份草稿,`/result` 和 `/portion` 整个从它渲染。
 *      对话页往里写,等于开出一条串味路径:对话里识别的结果会出现在
 *      首页那条链的结果页上。`abortProfileWork()` 当初就是为堵这一类串味才有的。
 *   3. 分析页的「停止分析」调 `stopPlateJob()`,会顺手掐掉对话页正在跑的请求。
 *
 * 所以切在**「识别本身」和「谁在用它」之间**:并发模型、取消策略、预览图
 * 归谁管,全都留在调用方 —— 这个文件里一个模块级变量都没有。
 *
 * ## 调用方各是谁
 *
 *   · `src/store/plate.ts` —— 首页「拍餐盘」。传 generation 令牌当 `isCurrent`,
 *     传 `attachPreview: true`(结果里的照片由它负责 revoke),自己订阅 job。
 *   · `src/screens/ChatScreen.tsx` —— 对话页。一次发 N 张就串行调 N 次,
 *     用会话令牌当 `isCurrent`,不挂预览图(它自己的照片是独立的一批),
 *     但要 `onThumb` —— 合成出来的那一餐下次进页面会以「待补记」的形式问一句,
 *     记进日记时配的就是这张小图。
 */

import { AgentError } from '../lib/dify'
import type { AnalyzeStage } from '../lib/analyzeStage'
import { ImageError, prepareImage } from '../lib/image'
import { runRecognition } from '../lib/recognizeAgent'
import { recognizeMeal, type RecognizedMeal } from './recognize'
import type { MealEntry, MealSlot, Profile } from './types'

/**
 * 单次识别的墙钟上限。
 *
 * 55 秒是**两次**量出来的,不是拍的。
 *
 * 第一次量出的是 45:食衡那条工作流连跑五次,12.4 / 14.2 / 16.9 / 19.9 /
 * 26.8 秒 —— 中位数 20,尾巴 27。原来定 30,留给尾巴的余量只剩 3 秒,
 * 所以「总是超时」不是错觉,是阈值卡进了分布里面。
 *
 * 第二次是 2026-09-23,对话页发图那条路在**手机上**还是超了:用户在手机上
 * 发一张配料表,等来的是「等太久了（超过 45 秒）」。台式机走同一条上游、
 * 同一张图实测是 20 / 28 / 33 / 37 秒 —— 手机上多出来的是压缩 + WiFi 上传,
 * 而上游本身波动就有十几秒。
 *
 * **为什么停在 55,而不是想抬多少抬多少**:它必须小于服务端那条链路的预算
 * (`api/recognize.ts` 和 `api/chat-messages.ts` 的 `maxDuration`,Hobby 上限
 * 60),而且要留够余量让前端**先**放弃 —— 平台把函数掐掉只会给一个语焉不详的
 * 网络错误,而这里主动 abort 能给出「等太久了」这句人话,顺手也不会白烧一次
 * 视觉调用。**这两个数是一对,改一个必须回头看另一个**(`verify:reply` 有一节
 * 盯着这条不变量,别绕开它改)。
 *
 * 而超时的代价不是「慢一点」:下面会退回本地模拟,用户拿到的是
 * 一盘**编出来的菜**,界面上只多一行小字。这比多等十几秒糟得多。
 *
 * ⚠️ 它管的是**一次识别**,不是「一个任务」—— 所以对话页连发 3 张时,
 * 这个上限是**逐张**算的,总时长上限是 3 × 55 秒。这是有意的:一个总预算
 * 会让「第 1 张慢」把后两张的时间吃掉,而用户看到的进度是逐张推进的。
 */
export const TIMEOUT_MS = 55_000

/* ------------------------------------------------------------
   结果
   ------------------------------------------------------------ */

/**
 * 一次识别的四种归宿。
 *
 * ⚠️ **`degraded` 和 `failed` 不是同义词**,别合并:
 *   · degraded → 我们**确实拿到了一张能分析的图**,只是后端不可用。
 *     退回本地模拟并明说「这是演示数据」,链路照常走完(记录能存、首页数字会变)。
 *   · failed   → 我们**根本没有可分析的输入**(选了 PDF、浏览器解不开 HEIC、
 *     压到最后一档还超限)。这时候编一份看起来正常的结果比报错误导得多 ——
 *     用户会以为那盘菜被识别出来了。
 */
export type RecognitionOutcome =
  | { kind: 'ok'; meal: RecognizedMeal }
  /**
   * 演示数据。`meal.degradedReason` 和这里的 `reason` 是**同一个字符串** ——
   * 前者给结果页读,后者给 job 状态读(分析页那行小字)。
   */
  | { kind: 'degraded'; meal: RecognizedMeal; reason: string }
  /** 用户主动取消(不是超时)—— 安静退出,不给结果也不报错 */
  | { kind: 'cancelled' }
  /** 图片本身的问题。`message` 是可以直接摆给用户看的一句人话 */
  | { kind: 'failed'; code: 'IMAGE'; message: string }

export interface RecognizeOneOptions {
  file: File
  slot: MealSlot
  profile: Profile
  /** 当天已有的记录 —— 发给 agent 当上下文。**调用方现取,不缓存** */
  meals: MealEntry[]
  /**
   * 在途请求的闸门。
   *
   * ⚠️ 传 **controller 而不是 signal**:这个函数自己要在 `TIMEOUT_MS` 之后
   * 主动掐断,只给一个只读的 signal 它没有这个能力。调用方仍然拿着同一个
   * controller,随时可以提前 abort(「停止分析」/ 离开对话页)。
   */
  controller: AbortController
  /**
   * 每前进一步报一次,由 `runRecognition` 保证单调。
   *
   * 不传就什么都不做。⚠️ 报出去之前**要不要再挡一次「是不是最新那个任务」是
   * 调用方的事** —— 在途的节点事件在 abort 之后**还会继续到达**(abort 掐断的是
   * fetch,不是已经排进微任务队列的回调),调用方不挡的话,一个已经停掉的任务
   * 会被重新点亮,而它永远不会有结果。
   */
  onStage?: (stage: AnalyzeStage) => void
  /**
   * 压缩完成,预览图归调用方所有。
   *
   * **只有这一次移交,而且只在结果还要的时候发生。** 没被移交的 URL
   * (取消、被顶替、压缩就失败)由本函数自己 revoke —— 单一所有者,
   * 不会漏也不会撞。
   */
  onPrepared?: (previewUrl: string) => void
  /**
   * 压缩完成,把 **200px 缩略图**（data URL）交出去。
   *
   * 和 `onPrepared` 是两回事,别合并:
   *
   *   · `previewUrl` 是 **object URL** —— 一个句柄,交出去等于移交 revoke 责任,
   *     所以「没交出去」的必须由本函数自己撤(见下面那段)。
   *   · 缩略图是 **data URL** —— 一个值,复制一份没有任何代价,也没有生命周期。
   *     所以它的判据单纯是「这次要不要」。
   *
   * 对话页要它:那条路合成出来的一餐会以「待补记」的形式留到下次进页面,
   * 而记进日记的那条记录配的就是这张小图(`store/unlogged.ts` 的 `thumb`)。
   * 它**不**跟着 `attachPreview` 走 —— 那个开关说的是「把图和这一份识别结果
   * 绑在一起」,而对话页恰恰不该做这件事(`mergeMeals.ts` 文件头那段)。
   *
   * 只在算出来非空时调用:编码失败时 `thumbDataUrl` 是空串,交出去等于说
   * 「有一张图,内容是空的」。
   */
  onThumb?: (thumbDataUrl: string) => void
  /**
   * 压缩完成,把**上传用的那一份 JPEG** 交出去(2026-09-24)。
   *
   * 交的就是马上要发给模型的那几个字节(`prepared.blob`)—— 不是原图,也不是
   * 缩略图。对话页要它,是因为用户定的新口径:**发图时不算营养,等他真要记进
   * 日记了才调食衡去算**。而食衡的输入是照片,所以这份压缩结果得活到
   * 「下次进对话页点『记入日记』」那一刻 —— 存哪儿见 `store/draftPhotos.ts`。
   *
   * 和 `onThumb` 是两回事,别合并成一个回调:缩略图是**给日记页看的**,
   * 这一份是**要再喂给模型的**。同一次识别里两者都要,但将来只会有一个被需要
   * 时,合并的那份就逼调用方收下一个它用不上的东西。
   *
   * 和 `onPrepared` 也不是一回事:`previewUrl` 是 object URL,**一个句柄**,
   * 交出去等于移交 revoke 责任(所以它参与 `previewOwnership`);这个 blob 是
   * **一个值**,复制一份没有代价,也没有生命周期,谁都不用负责。
   */
  onImage?: (blob: Blob) => void
  /**
   * **预结果** —— LLM 节点一跑完就先交出来的那一份(见 recognizeAgent 的
   * `onProvisional`)。菜名、suitable、reason、advice 是真的,只差库外菜的
   * 每 100g 营养值。
   *
   * 和 `onStage` 一样,「是不是最新那个任务」由**调用方**挡 —— 理由见上面
   * `onStage` 那段:在途事件在 abort 之后还会继续到达。
   */
  onProvisional?: (meal: RecognizedMeal) => void
  /** 走哪个 agent —— 见 `runRecognition` 的 `agent` 那段。不传 = 食衡 */
  agent?: 'chat'
  /** 用户自己打的那句话 —— 只有走膳享+ 时用得上,见 recognizeAgent 的 `text` */
  text?: string
  /**
   * 「这次结果还要不要」。压缩醒来和识别回来时各问一次。
   *
   * 不传 = 永远要。
   */
  isCurrent?: () => boolean
  /**
   * 把预览图挂进结果里(`photoUrl` / `thumbDataUrl`)。
   *
   * ⚠️ **默认 false,而且这是刻意的**:那两个字段带的是「谁负责 revoke」的
   * 隐含承诺(见 `RecognizedMeal.photoUrl` 那段注释),不打算负责的人不该拿到。
   * 对话页拍的是好几张、每张都有自己的 object URL,它就不该拿到这个。
   */
  attachPreview?: boolean
}

/* ------------------------------------------------------------
   主流程
   ------------------------------------------------------------ */

/**
 * 跑一次识别。
 *
 * @throws 从不抛 —— 四种归宿全在返回值里。调用方按 `kind` 分支即可。
 */
export async function recognizeOne(opts: RecognizeOneOptions): Promise<RecognitionOutcome> {
  const current = opts.isCurrent ?? (() => true)
  const { signal } = opts.controller

  /* ---------- ① 压缩 ---------- */
  let prepared: Awaited<ReturnType<typeof prepareImage>>
  try {
    prepared = await prepareImage(opts.file)
  } catch (err) {
    /*
     * 压缩期间被取消/被顶替的,不报图片的毛病 —— 这张图有没有问题已经不重要了,
     * 而且报「图片处理失败」会把用户引向一个根本不存在的错误。
     */
    if (signal.aborted || !current()) return { kind: 'cancelled' }
    /*
     * 图片本身的问题**不退化成「随机餐盘」** —— 理由见上面 `RecognitionOutcome`
     * 那段注释。这里只做「是不是 ImageError」的翻译:已经是人话的原样透传,
     * 不是的(理论上不该有)给一句不撒谎的兜底。
     */
    return {
      kind: 'failed',
      code: 'IMAGE',
      message: err instanceof ImageError ? err.message : '图片处理失败，请换一张试试。',
    }
  }

  // 压缩耗时不短,醒来时可能已经被取消或被新任务顶替了
  if (signal.aborted || !current()) {
    URL.revokeObjectURL(prepared.previewUrl)
    return { kind: 'cancelled' }
  }

  /*
    压缩完成 —— 预览图在这里移交,**只有这一次**。

    判据本身抽成了 `previewOwnership`(理由见那个函数),这里只按它的答案分派:
    是调用方的就交出去,不是的就地撤掉。两件事**必须**互斥且穷尽 ——
    都不做就是泄漏,都做就是交出去又撤掉(用户看到的是一张裂图)。
  */
  if (previewOwnership(opts) === 'caller') {
    opts.onPrepared?.(prepared.previewUrl)
  } else {
    URL.revokeObjectURL(prepared.previewUrl)
  }

  // 缩略图交出去之后没有生命周期要管 —— 判据单纯是「这次要不要」(见上面那段)
  if (prepared.thumbDataUrl) opts.onThumb?.(prepared.thumbDataUrl)

  /*
    上传用的那份 JPEG 也在这里交一次。

    ⚠️ 放在 `previewOwnership` 那段**之后**,不是随手挑的位置:这一段的前提是
    「这次这张图还要」—— 取消掉的、被顶替的图在上面就已经 return 了,走不到
    这儿。挪到前面去的话,一张被取消的照片也会被存进草稿,而它认出来的菜
    **根本不在那张卡上**。
  */
  opts.onImage?.(prepared.blob)

  /* ---------- ② 识别 ---------- */

  /*
    墙钟兜底。
    上游挂住不返回时,请求会一直悬着 —— 分析页就永远转圈,这比报错更糟:
    用户不知道该等还是该退。`TIMEOUT_MS` 之后主动 abort 并降级,链路一定能走完。

    用局部变量记「是不是超时」,而不是复用 `signal.aborted` ——
    用户按「停止分析」和这里超时都会让 signal 变成 aborted,但两者该有不同的
    表现:一个是用户自己取消(安静地退出),一个是要退回演示数据并说明原因。
  */
  let timedOut = false
  /*
    ⚠️ **墙钟逐趟挂,不是一次挂到底。**

    上面 TIMEOUT_MS 那段说它管的是「一次识别」—— 所以下面拦截那条路上的
    第二趟(2026-09-24)拿的是它**自己的**一份预算,而不是从第一趟的剩余时间里抠。
    抠出来的话,第一趟跑得久一点,第二趟就注定跑不完,那条兜底等于形同虚设。
  */
  let timer: ReturnType<typeof setTimeout> | undefined
  const armWatchdog = () => {
    timedOut = false
    timer = setTimeout(() => {
      timedOut = true
      opts.controller.abort()
    }, TIMEOUT_MS)
  }
  armWatchdog()

  try {
    /*
      ⚠️ **这里原来发过第二条「只要菜名」的请求,2026-09-23 撤掉了。**

      撤掉的理由是它拿不到自己想要的东西:那条请求是**另一次独立的识别**,
      和这一条各自认了一遍菜,于是同一盘菜会给出两种说法 —— 实测:

          分量页(快路径)  青椒洋葱炒肉片 / 清炒小白菜
          结果页(完整)    青椒肉丝 / 素炒时蔬

      用户的感受是「菜品怎么不一样」,以及结果页「猛然刷新一下」。

      提前量**不需要**第二次识别就能拿到:`runRecognition` 会在工作流跑到
      LLM 节点时就报一次预结果(见 recognizeAgent 的 onProvisional),而那份
      预结果和终稿**出自同一个 LLM 节点** —— 菜名天然一致,后补的只有营养。
      这才是「先出菜名,再往后推进」的正确做法:一条工作流分两次交付,不是
      两条工作流各认一遍。
    */
    const arg = {
      image: prepared.blob,
      slot: opts.slot,
      profile: opts.profile,
      meals: opts.meals,
      signal,
      ...(opts.attachPreview
        ? { photoUrl: prepared.previewUrl, thumbDataUrl: prepared.thumbDataUrl }
        : {}),
      ...(opts.onStage ? { onStage: opts.onStage } : {}),
      ...(opts.onProvisional ? { onProvisional: opts.onProvisional } : {}),
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.text ? { text: opts.text } : {}),
    }
    let meal = await runRecognition(arg)

    /*
      ⚠️ **模型在对话页咬死 `blocked` → 带着 `insist` 再跑一趟(2026-09-24)。**

      用户的原话:「如果图片里有用户明确不能吃的,不要硬拦截,就是第一条明显的
      提醒,然后后面的菜该怎么吃就怎么吃」。

      后半句是这一支存在的**全部**理由。模型一旦回了 `blocked: true`,按它自己
      的提示词就**不再生成菜品**了 —— 所以界面那边把它降级成提醒,只能救回
      那条提醒,救不回菜。要菜,就只有再问一趟。

      口径和对话页**打字**那条路是同一套(`ChatScreen.answer` 里那段):
      第一趟照常发,只有它被拦了才补第二趟;第二趟失败、或者还是拦,
      **保留第一趟的结果** —— 宁可少一次重试,不可因为重试把已经拿到的那句
      风险信息弄丢。

      ⚠️ 只给 `agent: 'chat'`。拍餐盘那条路的硬拦是对的(`ResultScreen` 那张
      拦截卡有指代对象:那里确实有一份具体的建议要拦下来),别把这一支搬过去。
    */
    if (opts.agent === 'chat' && meal.agentReply?.blocked && !signal.aborted) {
      try {
        armWatchdog()
        const again = await runRecognition({ ...arg, insist: true })
        if (again.agentReply && !again.agentReply.blocked) meal = again
      } catch {
        /*
          第二趟没成(超时 / 上游挂了 / 用户按了停止)就当它没跑过 —— `meal`
          还是第一趟那一份。不往外抛、也不把它记成一次失败:这一趟是**加分项**,
          它失败不该把已经到手的结果降级成一盘编出来的演示数据。
        */
      }
    }

    return { kind: 'ok', meal }
  } catch (err) {
    // 用户自己按的停止 —— 不是故障,别摆一个错误界面给他
    if (signal.aborted && !timedOut) return { kind: 'cancelled' }

    /*
      ⚠️ **对话页那条路不许退回演示数据(2026-09-23)。**

      演示数据是**本地随机组的一餐**,和用户发的那张图毫无关系。在「拍餐盘」
      那条路上它还有明确的标注(「以下菜品为演示数据」);但在对话页里,用户问的是
      「读配料」,屏幕上却凭空多出一盘菜 + 一条针对他档案的拦截提示 —— 看起来
      就是模型在胡说。

      所以膳享+ 那条路失败时**如实说失败**,不拿一份编出来的餐盘糊上去。
    */
    if (opts.agent === 'chat') {
      /*
        ⚠️ `code` 只能是 `'IMAGE'`(这是 `RecognitionOutcome` 的类型决定的,
        它把「失败」当成了图片本身的问题)。这里借它用一下 —— 用户看到的是
        `message`,那条文案说的是实话;`code` 只在下游决定要不要摆「换一张」
        的出路,两条路在这个场景下是同一个出路。
      */
      /*
        ⚠️ **这里原来是一句写死的话**:「这次没读出来，换个角度再拍一张。」
        它把 `err` 整个丢掉 —— 超时、限流、上游节点炸、格式不对,屏幕上长得
        一模一样,而且那句话让用户去**重拍照片**。

        代价是实测过的:2026-09-23 用户报「我发照片过去,说是没读出来」,拿着
        这句反推不出任何东西 —— 只能把整条链路重新量一遍(结论写在
        `chatFailMessage` 上面)。**一句会把人指错方向的报错,比一句含糊的
        报错更贵**,`recognizeAgent` 里那句注释说的是同一件事。
      */
      return { kind: 'failed', code: 'IMAGE', message: chatFailMessage(err, timedOut) }
    }

    const reason = timedOut ? '识别超时，本次为演示数据' : degradeReason(err)

    /*
      刻意**不挂** photoUrl / thumbDataUrl。
      (整段理由原来在 plate.ts 的 run() 里,搬过来一个字没改。)

      这份餐盘是本地随机组的,和那张照片没有任何关系。把照片摆在
      「番茄炒蛋 220 kcal」旁边,即使角上有个「演示数据」的标签,
      视觉上也在暗示这个因果 —— 而缩略图一旦跟着归档写进日记,
      一条编出来的营养记录就永久配上了一张真照片。

      照片在分析页仍然看得到(它挂在调用方的 job / 消息上),只是不进结果、不进日记。
      结果页显示照片的条件本来就是 `engine === 'agent'`,和这里一致。
    */
    return {
      kind: 'degraded',
      meal: { ...recognizeMeal(opts.slot), degradedReason: reason },
      reason,
    }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------
   预览图归谁撤
   ------------------------------------------------------------ */

/**
 * 压缩出来的那个 object URL,散场时**该由谁 revoke**。
 *
 * ## 为什么要单独一个函数
 *
 * 因为这里出过一次真事故,而事故的样子是**什么都没有发生**:没有报错、
 * 界面完全正常,只是每识别一张就有一个几 MB 的 blob 再也不释放,到刷新
 * 页面为止。原文那句「没被移交的 URL 由本函数自己 revoke」当时只覆盖了
 * 「取消 / 被顶替 / 压缩就失败」三种,**漏的正是「压根没传 `onPrepared`」**
 * —— 而对话页一次三张就是这个形状,它是这个漏法唯一的受害者。
 *
 * 一个只在内存里慢慢涨、界面上零症状的 bug,没有断言就只能靠下一个人
 * 读注释时正好想到。抽成**纯函数**之后,三种组合可以逐条断言
 * (见 `scripts/verify-loop.mjs`);另外还有一条**源级**断言盯着调用点真的
 * 调了它(见 `scripts/verify-render.mjs`)—— 因为一个没人调用的纯函数
 * 同样是一句废话。
 *
 * ## 两条出口
 *
 *   · `caller` —— 交出去了,由调用方负责。两种交法:
 *       `onPrepared` 收走那个句柄(首页:挂进 job 的预览),或
 *       `attachPreview` 把它写进结果(`RecognizedMeal.photoUrl`)。
 *   · `self` —— 没人要,本函数就地撤掉。
 *
 * 判据**只看「结果还要不要它」,不看谁在调** —— 所以它不区分首页和对话页,
 * 将来多一个调用方也不用改这里。
 */
export function previewOwnership(opts: {
  /** 只要**传了**就算数 —— 这里不调它,只问它在不在 */
  onPrepared?: unknown
  attachPreview?: boolean
}): 'caller' | 'self' {
  if (opts.onPrepared) return 'caller'
  if (opts.attachPreview) return 'caller'
  return 'self'
}

/* ------------------------------------------------------------
   失败 → 给用户看的那句话
   ------------------------------------------------------------ */

/**
 * 全部走降级而不是错误页:这些情况下**我们确实拿到了一张能分析的图**,
 * 只是后端不可用。退回本地模拟并明说「这是演示数据」既保住了链路完整
 * (记录能存、首页数字会变),又不假装那是模型输出。
 */
function degradeReason(err: unknown): string {
  if (err instanceof AgentError) {
    switch (err.code) {
      case 'AGENT_UNAVAILABLE':
        return '未配置 Dify Key，本次为演示数据'
      case 'RATE_LIMITED':
        return '请求过于频繁，本次为演示数据'
      case 'UPSTREAM_QUOTA':
        return 'agent 额度已用完，本次为演示数据'
      case 'PAYLOAD_TOO_LARGE':
        return '图片太大，本次为演示数据'
      case 'UNSUPPORTED_IMAGE':
        return '图片格式不被支持，本次为演示数据'
      case 'UPLOAD_FAILED':
      case 'UPSTREAM_UNREACHABLE':
      case 'NETWORK':
        return '连不上识别服务，本次为演示数据'
      default:
        return `识别失败（${err.message}），本次为演示数据`
    }
  }
  return '识别失败，本次为演示数据'
}

/**
 * **对话页发图失败时,屏幕上那一句。**
 *
 * 和 `degradeReason` 是兄弟:那个管拍餐盘那条路的降级理由,这个管对话页
 * 发图这条路的失败文案。**两条路不能合并** —— 拍餐盘失败会退回本地模拟
 * (所以每句都缀着「本次为演示数据」),对话页**不退回演示数据**(理由见
 * 上面 `if (opts.agent === 'chat')` 那段注释),它必须如实说这次失败了。
 *
 * 为什么是「透传 `err.message`」而不是照着错误码再写一套话:
 * ------------------------------------------------------------
 * `AgentError.message` 本来就是照着「能直接摆给用户看」写的 —— 服务端那几句
 * (`api/_lib/agent.ts` 里的 `json({code, message})`)和 `recognizeAgent` 里
 * 抛的那几句都是。再在这里照着码重写一遍,等于把同一件事的文案维护两份,
 * 而两份一定会走散(`degradeReason` 那份就是前车之鉴:它现在还缀着
 * 「本次为演示数据」,对话页一个字都不能用)。
 *
 * 所以这里只做两件 `err` 做不到的事:
 *   · **超时** —— `err` 是个 `AbortError`,它的 `message` 是给机器看的,
 *     没有可读的话,得单独给一句。
 *   · **兜底** —— 拿不到人话时,给一句不撒谎的(而不是把「换一张」摆上去)。
 *
 * ⚠️ **别在这里加「换个角度再拍一张」。** 那句话的判据是「这是图片本身的
 * 毛病」,而图片本身的毛病(选了 PDF、压完还超限、格式不支持)在**第 ① 步
 * 压缩**就被拦下了,根本走不到这儿;能走到这儿的全是链路那一侧的事,
 * 让用户重拍照片是把他支去查一个不存在的原因。
 */
export function chatFailMessage(err: unknown, timedOut: boolean): string {
  const head = '这次没读出来'
  if (timedOut) {
    /*
      秒数从 `TIMEOUT_MS` 来,不写死 —— 改上限时这句话跟着走。
      (用户看到的数字和真正掐断它的那个数字必须是同一个。)
    */
    return `${head}：等太久了（超过 ${TIMEOUT_MS / 1000} 秒）。再试一次，或换张小一点的图。`
  }
  const detail = err instanceof Error ? err.message.trim() : ''
  return detail ? `${head}：${detail}` : `${head}：出了个意外，直接重试一次。`
}
