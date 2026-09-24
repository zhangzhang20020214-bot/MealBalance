import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '../components/ios/Screen'
import { Icon } from '../components/Icons'
import { ActionListSheet, type ActionItem } from '../components/ActionListSheet'
import { AttachmentStrip } from '../components/AttachmentStrip'
import { ChatHistoryDrawer } from '../components/ChatHistoryDrawer'
import { ChatTranscript, type ChatItem } from '../components/ChatTranscript'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { MealSheet } from '../components/MealSheet'
import { useMultiPhotoPicker } from '../components/PhotoPicker'
import { SpeechSheet } from '../components/SpeechSheet'
import { LogNotice } from '../components/LogNotice'
import { UnloggedMealSheet } from '../components/UnloggedMealSheet'
import { NavBar } from '../components/ui'
import { CHAT_GREETING } from '../data/mock'
import { advance, type AnalyzeStage } from '../lib/analyzeStage'
import { dayStats, weekTrend } from '../store/derive'
import {
  cancelLogRun,
  getLogRun,
  noticeFor,
  setLogRun,
  startLogRun,
  useLogRun,
} from '../store/logRun'
import { useAppState } from '../store/store'
import {
  clearUnlogged,
  loadUnlogged,
  okPhotoBlobs,
  saveUnlogged,
  shouldAskUnlogged,
  unloggedFrom,
  type UnloggedMeal,
} from '../store/unlogged'
import { answerLocally } from '../lib/localAnswer'
import { slotFor } from '../lib/speech'
import { useSpeech } from '../lib/useSpeech'
import { formatTime, toISODate, todayISO } from '../lib/date'
import { AgentError, chatStream, probeAgent } from '../lib/dify'
import { demoteHardBlock, parseAgentReply } from '../lib/agentReply'
import { buildChatQuery, SEND_PROFILE_TO_AGENT } from '../lib/agentContext'
import { SESSION_USER } from '../lib/session'
import { cutFrom as cutFromItems, opsFor, questionBefore, removeOne, type ChatOp } from '../lib/chatOps'
import { mergeMeals } from '../lib/mergeMeals'
import { currentSlot } from '../lib/slots'
import {
  discardAll,
  emptyStaged,
  overflowNote,
  stage as stagePhotos,
  takeAll,
  unstage,
} from '../lib/composer'
import { beginRun, endRun, isCurrentRun, registerUrl, releaseUrls } from '../store/chatSession'
import {
  clearSessionsFor,
  loadChatLog,
  removeSession,
  saveChatLog,
  sessionTitle,
  toTurn,
  upsertSession,
  type ChatSession,
} from '../store/chatHistory'
import { dropDraftPhotos, putDraftPhotos } from '../store/draftPhotos'
import { recognizeOne, type RecognitionOutcome } from '../store/recognizeOne'
import type { MealEntry } from '../store/types'

/** 探测超时 —— 连不上就别让用户对着输入框干等 */
const PROBE_TIMEOUT_MS = 4000

/**
 * 进这一页之后隔多久弹「要补记吗」。
 *
 * 不是 0：这一页挂载时还有两件事在抢同一帧 —— 消息区的滚动定位和顶部那条
 * 「演示模式」横幅的出现。弹窗和它们同时落位，看起来像页面自己弹了一个框；
 * 隔 400ms 它才像一句**问话**。
 *
 * 也不能太长：用户可能进来两秒就退出去了，而这一句问话只在**挂载时**读一次。
 */
const ASK_DELAY_MS = 400

/**
 * 对话页 —— 对应 Figma「③ 界面原型 / 06 · 对话 Chat」。
 *
 * 三层降级,任何一层都不会白屏:
 *   1. 配了 Key  → 真实 agent 流式回答(经同源 /api,Key 不进前端)
 *   2. 没配 Key  → 本地规则结合**你的真实记录**生成回答,界面明说这是演示模式
 *   3. 请求失败  → 同上,并提示失败原因
 *
 * 演示模式的回答刻意不是「一段预置文案」:它按关键词命中规则,再用当天实际
 * 摄入和档案配额算出来。问"今天盐吃多了吗"和"热量还剩多少"会得到不同的、
 * 带真实数字的回答 —— 而不是不管问什么都回同一段。
 *
 * ## 发图和发文字,在这一页是同一件事的两条分支
 *
 * 从这一版起,照片**不在这里直接送出去分析**:选完先进附件条,由用户点发送。
 * 理由是你提的那个具体场景 —— 用户想一次发三张,还想附一句话问「这餐咸吗」。
 * 原来那版是 `usePhotoPicker` → `startPlateJob()` → `navigate('/analyzing')`,
 * 选到文件的那一刻就跳走了:**为了记一餐,丢掉整段对话**,而那段对话恰好是
 * 他想问那个问题的地方。
 *
 * 现在两条分支在 `onSend` 合流,而**发出去之后都不跳页**:
 *
 *     点发送 ─┬─ 有附件 ─▶ sendPhotos()  攒的图 → 逐张识别 → 屏上出结果卡
 *             └─ 没附件 ─▶ send(text)    纯文字 → 走原来那条回答路径
 *
 * 这个页面**不再有任何 `navigate`**(除了返回首页那一个)。历史链
 * `/chat → /analyzing → /portion → /result` 只剩首页那一个入口。
 */
export default function ChatScreen() {
  const navigate = useNavigate()
  const state = useAppState()
  const [messages, setMessages] = useState<ChatItem[]>([CHAT_GREETING])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState<string | undefined>()
  /**
   * 历史记录。
   *
   * `sessions` 是**全部档案**的（读出来什么样就是什么样），按档案过滤发生在
   * 渲染抽屉那一层（`sessionsOf`）—— 见 `ChatHistoryDrawer` 文件头那段。
   *
   * ⚠️ 这是**惰性初值**（传函数不是传值）：`loadChatLog()` 要读 localStorage，
   * 而每次重渲染都读一遍会让「刚写进去的那条」在下一次渲染时被旧值盖掉。
   */
  const [sessions, setSessions] = useState<ChatSession[]>(loadChatLog)
  /**
   * 当前这次会话的 id。
   *
   * 惰性初值同理，还要**同一次挂载内稳定** —— 它变了就意味着换了会话，
   * 而落盘那份数据的键就是这个 id（见下面那个 effect）。
   */
  const [sessionId, setSessionId] = useState(() => `c${Date.now()}`)
  const [historyOpen, setHistoryOpen] = useState(false)
  /** 打开操作表的那条消息 */
  const [menuFor, setMenuFor] = useState<ChatItem | null>(null)
  /**
   * 等着确认的破坏性操作。
   *
   * 三件事共用**一个** `ConfirmSheet`，因为它们是同一类东西（不可逆），
   * 而且**不会同屏**：抽屉里点删除时抽屉还开着，确认框盖在它上面。
   * 分三个 boolean 会多出「两个同时为真怎么办」这个没人会去测的状态。
   */
  const [confirm, setConfirm] = useState<
    { kind: 'session'; session: ChatSession } | { kind: 'clear' } | { kind: 'message'; item: ChatItem } | null
  >(null)
  /** null = 还在探测 */
  const [agentAvailable, setAgentAvailable] = useState<boolean | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 「这台浏览器不支持语音输入」说明面板 */
  const [speechInfoOpen, setSpeechInfoOpen] = useState(false)
  /** 上次识别到、还没记进日记的那一餐 —— 弹窗上要显示的那份草稿 */
  const [unlogged, setUnlogged] = useState<UnloggedMeal | null>(null)
  /** 补记弹窗开着没有 */
  const [askOpen, setAskOpen] = useState(false)
  /**
   * 在飞的那一趟「记进日记」——**它不在这个组件里**（`store/logRun.ts`，2026-09-24
   * 下午搬出去的）。这一页只是它的一个视图：那张提示卡和记录面板都由它推出来。
   *
   * ⚠️ 搬出去的理由里有两条，都是用户当天报的：
   *
   *   1. 他点完「记入日记」就去看日记，而**离开这一页会卸载组件** —— 卸载那段
   *      cleanup 当时把在途的那一趟连同落盘一起掐了，他连报三次「还是没记进日记」。
   *   2. 他要「在计算的时候，在日记里显示这一餐正在计算」—— 日记页要看的那件事
   *      原来锁在这个组件的闭包里，**另一个页面够不着**。
   *
   * 搬走之后 `aliveRef` / `logRunRef` / `logGatesRef` 全都不需要了：落盘的判据里
   * 不再有任何「这一页还在不在」的东西（那正是第 1 条的病根）。
   */
  const run = useLogRun()
  /**
   * 用户把那张提示卡关掉了没有。**这是这一页自己的事** —— 关它只是关掉这一页的
   * 通知，日记页那一行不受影响，所以它不该写进 store。
   *
   * 关掉 = 「这句我知道了」：算成了**不许再弹回来报一次成功**（用户定的）。
   * 唯一的例外是「没算出来」—— 那一句不看这个标志（`noticeFor`），因为关掉它
   * 就等于这一趟失败**一句话都没说**，而屏幕看起来和「已经记进去了」一模一样。
   */
  const [noticeClosed, setNoticeClosed] = useState(false)
  /** 那张卡现在该说什么、该不该在（判据全在 `noticeFor`，见它的注释） */
  const logNotice = noticeFor(run, noticeClosed)
  /**
   * 「调整分量再记」算好了 —— 记录面板要预填的那一份。
   *
   * ⚠️ 预填的是**食衡刚算出来的那份**，不是草稿里那份菜名清单：那份没有营养
   * （见 `UnloggedMeal.items`），面板一保存就把一份 0 kcal 写进日记了。
   */
  const adjusting = run?.phase === 'adjust-ready' ? run : null
  const scrollRef = useRef<HTMLDivElement>(null)

  /**
   * 攒着还没发出去的那几张。
   *
   * ⚠️ **可变盒子 + 一个只为触发重渲染的计数器,不是 `useState<StagedPhoto[]>`。**
   *
   * 每张照片一个 object URL,而 object URL 的规矩是「谁建的谁撤」——
   * 那句规矩要成立,前提是**撤销这件事不能被一次渲染偷走**。`composer.ts` 里
   * 每个函数都是「改盒子 + 自己撤自己该撤的」,盒子是那个唯一的事实来源;
   * 换成 state 数组、每次操作整份复制的话,「这一张到底还在不在」就有了两个
   * 说法(盒子里一份、state 里一份),而 `takeAll` 的**转移语义**(发送时
   * 同一批图只能被拿走一次)也没法表达了 —— 复制语义下双击发送会发两遍。
   *
   * 计数器而不是 `useReducer`:盒子本身会变,react 只认「数字变了」。
   * 这个文件里凡是改盒子的地方,下一行一定是 `syncStaged()`。
   */
  const [staged] = useState(emptyStaged)
  const [, setStagedTick] = useState(0)
  const syncStaged = () => setStagedTick((t) => t + 1)

  /**
   * 语音输入。
   *
   * 转写结果**只落进 `input`,不自动发送** —— 中文菜名的识别错误率不低
   * (「清蒸鱼」/「青蒸鱼」),自动发出去等于把这层错误直接送给模型。
   * 落进输入框让用户改一个字再发,是唯一诚实的做法,`send()` 那条路径完全不动。
   */
  const speech = useSpeech({
    // 开始口述那一刻输入框里的原文 —— 转写只负责它后面的部分
    getText: () => input,
    setText: setInput,
  })

  /**
   * 麦克风 / 发送 / 停止**共用输入栏那一个槽位**。
   *
   * 输入栏固定 `h-[60px] px-5 gap-2`,每个控件 `h-11 w-11`。402pt 的屏去掉
   * 内边距剩 362pt,已经有 4 个子元素(相机 / 相册 / 输入框 / 发送)。
   * 再塞第 5 个只剩 ~114pt 给输入框 —— 写不下一句「今天盐吃多了吗」,
   * 等于把输入框废掉。判据顺序为什么不能反,见 `slotFor` 的注释。
   *
   * 这个方案顺带干掉了原来那个「输入为空时永久置灰的发送键」——
   * 一个永远点不动的按钮本来就不可用,占着一格还不如让给麦克风。
   *
   * `attachments` 传**张数**,和 `text` 传原文、由函数自己 `trim()` 同一个口径:
   * 判据要什么就给什么,别在调用点先替它下结论(传 `hasAttachments` 的话,
   * 「两张」和「三张」在 `slotFor` 里就永远区分不出来了)。
   */
  const slot = slotFor({
    listening: speech.listening,
    text: input,
    busy,
    attachments: staged.photos.length,
  })

  /** 不支持就打开说明面板,而不是让点击石沉大海 */
  const onMic = () => {
    if (!speech.supported) {
      setSpeechInfoOpen(true)
      return
    }
    speech.start()
  }

  /**
   * 底部那两个图标**各自直达**,不再共同打开一个操作表。
   *
   * 原来它们 onClick 完全相同 —— 相机图标和相册图标点下去是同一个面板,
   * 图标画的含义和实际行为对不上。现在相机唤起后置摄像头、相册打开相册。
   *
   * ActionSheet 整个删掉了:两个入口都绕开它之后,它只剩一个「手动记录」,
   * 而那个入口首页本来就有(「+ 手动记录」),留着就是够不着的死代码。
   *
   * 选到的文件**只进附件条,不发不跳** —— 后面的决定权在用户手上。
   * 相机那个入口仍然只给一张(`useMultiPhotoPicker` 只给相册那个 input 加
   * `multiple`,理由见 PhotoPicker.tsx 的 `useFilePicker` @param)。
   */
  const picker = useMultiPhotoPicker((files) => {
    const dropped = stagePhotos(staged, files)
    syncStaged()
    /*
      超出的张数**必须说出来**。「选了 5 张、只发出去 3 张」如果静默发生,
      用户没有任何办法发现 —— 那条对话里会少两道菜,卡片上还写着
      「识别到 3 道菜」,一切看起来都很正常(`composer.stage` 的注释)。
    */
    if (dropped > 0) setNotice(overflowNote(dropped))
  })

  // 探测后端 —— 决定要不要在顶部挂「演示模式」的说明
  useEffect(() => {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    probeAgent(ctrl.signal).then((ok) => {
      window.clearTimeout(timer)
      setAgentAvailable(ok)
    })
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [])

  // 新消息进来时滚到底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  /**
   * 上次那顿没记的饭 —— **进来问一句**。
   *
   * 这是整个「不自动归档」设计的落点：上一次在对话里识别的结果没有记进日记，
   * 留到这一次进来问。读一次、问一次，之后由三个出口各自决定草稿的去留
   * （见 `UnloggedMealSheet` 文件头那张表）。
   *
   * ⚠️ **只在挂载时读一次**，依赖写 `[]`。所以「档案对不对」用的是挂载那一刻的
   * `activeProfileId` —— 这是安全的，因为**切档案必须离开这一页**
   * （切换器在档案页），离开就卸载了，下次进来会重新读一次。
   * 写成 `[state.activeProfileId]` 反而会在切档案那一瞬间弹一个框，
   * 而那时用户已经不在这一页了。
   *
   * ⚠️ **有一趟还没了结的时候不问**（2026-09-24 下午加的闸）。那一趟可能正在飞
   * （用户点完「记入日记」就翻去看日记，又折回来），也可能刚失败 —— 两种情况下
   * 屏幕上那张提示卡正在说这件事，再叠一张补记弹窗就是同一屏两句互相打架的话
   * （两张都是 `z-50`）。等他把那张卡处理掉（关掉 = 那一趟收掉），下次进来照样问。
   */
  useEffect(() => {
    if (getLogRun() !== null) return
    const saved = loadUnlogged()
    if (!shouldAskUnlogged(saved, state.activeProfileId)) return
    const timer = window.setTimeout(() => {
      setUnlogged(saved)
      setAskOpen(true)
    }, ASK_DELAY_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上面那段：只求「挂载时问一次」
  }, [])

  /**
   * 每说一句就落一次盘。
   *
   * ## 为什么是 effect 而不是在 `setMessages` 的每一处顺手写一遍
   *
   * 这个文件里有**八处**改 `messages`（发送、发图、回答、结果卡、撤回、删除、
   * 重试、新建对话）。在每一处补一句 `saveChatLog` 是八个都会忘记的机会，
   * 而忘记的表现是「这条在屏幕上好好的，翻历史却不在」——一个看起来像丢数据的
   * bug，实际只是漏了一行。挂在 `messages` 上，**只有一处**。
   *
   * ## 依赖里为什么没有 `sessions`
   *
   * 这段只在 `messages` 变了之后跑，而那时读到的 `sessions` **就是这一次渲染的
   * 那份**（effect 闭包捕获的是同一次渲染的值）—— 抽屉里删掉一条会话之后，
   * 组件重渲染，下一次消息变化读到的已经是删完的数组。把 `sessions` 写进依赖
   * 反而会变成「自己写盘 → 自己重跑」的循环。
   *
   * ⚠️ `messages.length === 0` 那一支不是省事：新建对话时 `messages` 会被
   * 重置成 `[CHAT_GREETING]`，而**空会话不该落盘**（列表上会多一行点进去是
   * 空白的记录，`parseChatLog` 读回来也会把它丢掉）。问候语那一条不算内容。
   */
  useEffect(() => {
    if (messages.length <= 1) return
    const next = upsertSession(sessions, {
      id: sessionId,
      profileId: state.activeProfileId,
      // 最后一次说话的时刻 —— 列表按它倒序（见 `ChatSession.at`）
      at: Date.now(),
      items: messages.map(toTurn),
    })
    setSessions(next)
    saveChatLog(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上面第二段：`sessions` 是这次渲染的那份，写进依赖会自激
  }, [messages])

  /**
   * 三个出口。**它们只做一件事：把这一趟交出去。**
   *
   * 算营养和落盘都不在这一页了（见 `store/logRun.ts`）—— 搬走的正是原来住在这里的
   * `computeForLog` / `runCompute` / `logUnlogged` / `adjustUnlogged`（2026-09-24
   * 下午）。留在这儿只剩两件**只有这一页才能做**的事：收掉补记弹窗、把「关过卡」
   * 拨回去。
   *
   * ⚠️ `setAskOpen(false)` 和 `dismissUnlogged` 里那一句同一个作用，但**不是同一件事**：
   * 这一句是「这一趟已经起飞了，弹窗留着没有意义」，那一句是「不用了」。
   */
  const beginLogRun = (meal: UnloggedMeal, kind: 'log' | 'adjust') => {
    /*
      ⚠️ **起一趟之前先把「关过卡」拨回去。** 新的一趟是**新的一句话**，不是他刚才
      关掉的那一句 —— 不拨的话，第二次点「记入日记」屏幕上什么都不出现：这一趟的
      提示卡被上一次那句「知道了」压着（`noticeFor` 里 `closed` 对 computing/logged
      都有效，见它的注释）。
    */
    setNoticeClosed(false)
    setAskOpen(false)
    startLogRun(meal, kind)
  }

  /**
   * 「不用了 / 点遮罩」—— 两件事是同一件事（用户定的：问过一次的不再问）。
   *
   * ⚠️ 它还要**把在途那一趟掐掉**：用户可能正是在等的时候改的主意，那就连请求
   * 一起 abort，省下一趟白跑的食衡。掐掉之后那一趟**连失败态都不会写**
   * （`cancelLogRun` 只作废、不说话）—— 和用户的「不用了」是同一个意思。
   *
   * ⚠️ 这是**全 App 唯一**一处主动作废一趟。离开这一页**不作废**了：见下面那个
   * cleanup 里那段（那是 2026-09-24 三次「还是没记进日记」的病根）。
   */
  const dismissUnlogged = () => {
    cancelLogRun()
    clearUnlogged()
    void dropDraftPhotos()
    setUnlogged(null)
    setAskOpen(false)
  }

  /**
   * 离开这一页 = 这次会话结束。三件事一起收掉:
   *
   *   1. `endRun()`  —— 正在跑的那一批作废(第 3 张还在路上就别要了),
   *      顺手 abort 掉它手上那个 controller。
   *   2. `releaseUrls()` —— 这一页发出去过的所有照片,object URL 在这里统一撤。
   *      它们从 `takeAll` 那一刻起就挂在消息气泡上,撤销会让气泡里的图变裂,
   *      所以只能等到没人看的时候 —— 就是现在。
   *   3. `discardAll(staged)` —— 攒着**没发出去**的那几张(选了又不想发)。
   *
   * ## ⚠️ 这里的 `endRun()` 是安全的,`AnalyzingScreen` 里同样的写法是不安全的
   *
   * 分析页那次请求是在**上一屏的手势里**发起的(`HomeScreen` 点「开始分析」
   * → 同步 `startPlateJob()` → `navigate`),所以它挂载时请求已经在飞了。
   * StrictMode 的「挂载 → 卸载 → 挂载」会在**几毫秒内**跑一次下面的 cleanup,
   * 把那笔刚发出去的请求掐死 —— 表现是「拍完照分析页一直转圈,什么都不出来」。
   *
   * 这一页不一样:**挂载和发送之间隔着用户操作**。立刻执行的那次 cleanup
   * 面对的是一张空表(没攒没发没跑),`endRun()` 只是把 generation 加一,
   * 没有任何人在等那个令牌。所以这里可以这么写,**照抄到分析页就会坏**。
   *
   * 依赖写 `[]` 而不是 `[staged]`:盒子从挂载到卸载是同一个对象(它是
   * `useState` 的初始值,只会被创建一次),所以这段 cleanup 只会在卸载时跑一次。
   * 写成 `[staged]` 效果完全一样,但会让下一个人以为它会重跑 —— 而它一旦重跑,
   * 就会把**已经发出去、正挂在气泡上**的那些 URL 撤掉(裂图)。
   */
  useEffect(
    () => {
      return () => {
        endRun()
        releaseUrls()
        discardAll(staged)
        /*
          ⚠️ **这一页卸载时不再碰「记进日记」那一趟**（2026-09-24 下午改的）。

          这里原来写着 `abortLogRun()` + `logRunRef.current++`，理由是「用户在等
          的时候退出了这一页，它回来时不许再落盘」。而**去看日记恰恰是点完
          「记入日记」最自然的下一步** —— 于是那一刀砍在了落盘上：屏幕上写着
          「算好了会自动记进日记」，他去看，空空如也，而且一句话都没说。
          他连报三次「到现在还是没有记到日记里啊」。

          现在那一趟整个搬去了 `store/logRun.ts`（连 `aliveRef` 一起删了）：
          **这一页在不在，和那一趟算不算数没有关系**。所以这里只剩这一页自己的
          三件事（消息区那批识别、照片的 object URL、攒着没发的那几张）。

          ⚠️ 别把任何「掐掉那一趟」的调用搬回这个 cleanup —— 它只属于
          `dismissUnlogged`（用户明说「不用了」那一刀）和 `abortProfileWork`
          （切/删档案，见 `logRun.ts` 文件头）。`scripts/verify-render.mjs` 里
          有一组断言盯着这一条。
        */
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上面那段:盒子是常量,只求「卸载时跑一次」
    []
  )

  /** 本地回答需要的数据 —— 和首页、日记页用的是同一套派生逻辑 */
  const grounding = useMemo(() => {
    const today = todayISO()
    return {
      stats: dayStats(state.meals, today, state.profile),
      trend: weekTrend(state.meals, state.profile, 7),
      profile: state.profile,
    }
  }, [state.meals, state.profile])

  /**
   * 走一遍 agent(或本地降级),把答案追加成一条新消息。
   *
   * 从原来的 `send()` 里**整段拆出来**,为的是打字那条路和「重试」那颗键
   * 共用同一段(降级、打字机、`conversationId`、三种 notice 都只有一份)。
   *
   * @param meals 发给 agent 的**当天摄入**。调用方按需自己拼。
   *
   * ⚠️ **发图那条路不走这里**(2026-09-23):随图打的那句话跟着图**一起发一趟**,
   * 模型在同一趟里既认菜也答那句话 —— 见 `sendPhotos` 里那段。
   */
  async function answer(text: string, meals: MealEntry[]) {
    const replyId = `a${Date.now()}`
    setMessages((m) => [...m, { id: replyId, role: 'assistant', content: '' }])

    const appendToReply = (chunk: string) =>
      setMessages((m) => m.map((msg) => (msg.id === replyId ? { ...msg, content: msg.content + chunk } : msg)))

    /**
     * 跑一趟上游,把攒下来的原文和解析结果交回来。
     *
     * 抽成函数是因为现在**最多跑两趟** —— 第二趟见下面「被整条拦下就重问一次」。
     */
    const askOnce = async (insist: boolean) => {
      // 这个 agent 是结构化输出,流里吐的是一整段 JSON 文本。
      // 边收边渲染的话,屏幕上会先闪过一坨带 \" 的原始 JSON —— 所以先攒着,
      // 等流走完再决定渲染成卡片还是纯文本。
      let raw = ''
      // 档案和当天摄入**塞在 query 里**发给 agent,不是当输入变量发 ——
      // 工作流第一步是 json.loads,不看 Dify 的 inputs。见 agentContext.ts 文件头。
      // 每次提问现算,不缓存:用户可能刚记了一餐就过来问。
      //
      // 档案发**大白话**那一份,不是识图用的那份 JSON:
      // 膳享+ 没有 `json.loads` 那一步,把 JSON 发给它会被读成
      // 「用户吃了这些忌口」并误报过敏拦截(实测 `blocked: true`)。
      // 两份 query 的分工和实测证据都写在 agentContext.ts 的文件头。
      const payload = SEND_PROFILE_TO_AGENT
        ? buildChatQuery(state.profile, meals, { text, ...(insist ? { insist: true } : {}) })
        : text
      for await (const chunk of chatStream({ query: payload, user: SESSION_USER, conversationId })) {
        if (chunk.conversation_id) setConversationId(chunk.conversation_id)
        if (chunk.event === 'message' || chunk.event === 'agent_message') {
          if (chunk.answer) raw += chunk.answer
        }
        if (chunk.event === 'error') throw new AgentError('UPSTREAM_ERROR', chunk.message ?? 'Dify 返回错误')
      }
      // 流走完却一个字都没有,视为异常,走降级
      if (!raw.trim()) throw new AgentError('UPSTREAM_ERROR', 'agent 没有返回内容')

      return { raw, reply: parseAgentReply(raw) }
    }

    try {
      let { raw, reply } = await askOnce(false)

      /*
        ⚠️ **被过敏规则整条拦下 → 重问一次。**

        对话页不该硬拦(理由写在 `agentReply.demoteHardBlock` 上):用户在这儿是
        提问,拦掉的不是「一条建议」,是**回答本身** —— 屏幕上只剩一张红卡。

        拦截的触发条件往往还和他问的东西无关:档案里有鸡蛋(高危)+ 今天记录里
        恰好有一道含蛋的菜,他问**任何**一句话都会被拦。所以 `buildChatQuery`
        末尾那句「已经吃掉的东西不该整条拦下」是**每次提问都带**的;这一趟是
        模型没听话时的第二次,把话说得更重。

        跑的仍是**同一段对话**(`conversationId` 不重置):模型上一轮已经看过
        那个被拦的问题,这一轮是在原话上补一句「照常回答」,不是另起一题。

        第二遍还是拦(或这一遍压根没解析出结构)→ **保留第一遍的结果**,
        由下面的 `demoteHardBlock` 降级成一条提醒。宁可少一次重试,
        不可因为重试把已经拿到的那句风险信息弄丢。
      */
      if (SEND_PROFILE_TO_AGENT && reply?.blocked) {
        const again = await askOnce(true)
        if (again.reply && !again.reply.blocked) {
          raw = again.raw
          reply = again.reply
        }
      }

      // 对话页的最终口径:拦下来的东西一律只当提醒(见 demoteHardBlock 的注释)
      const shown = reply ? demoteHardBlock(reply) : null

      setMessages((m) =>
        m.map((msg) =>
          msg.id === replyId
            ? // 解析失败就老老实实把原文交出去 —— 难看总好过看不到
              { ...msg, content: shown ? '' : raw, reply: shown ?? undefined }
            : msg
        )
      )
      setAgentAvailable(true)
    } catch (err) {
      // ---- 降级:本地规则 + 真实记录,打字机效果输出 ----
      const local = answerLocally(text, grounding.stats, grounding.trend, grounding.profile)
      for (const ch of local) {
        // 一次一个字太慢,一次两三个字既像打字又不拖沓
        await new Promise((r) => setTimeout(r, 8))
        appendToReply(ch)
      }

      if (err instanceof AgentError) {
        if (err.code === 'RATE_LIMITED') setNotice('请求过于频繁，已切到本地回答。稍后再试。')
        else if (err.code === 'UPSTREAM_QUOTA') setNotice('agent 额度已用完，已切到本地回答。')
        else if (err.code === 'AGENT_UNAVAILABLE') setAgentAvailable(false)
        else setNotice(`agent 暂时不可用（${err.message}），已切到本地回答。`)
      } else {
        setNotice('连接不上 agent，已切到本地回答。')
      }
    }
  }

  /** 纯文字那条路 —— 行为和这一版之前逐字相同,只是把回答那段交给 `answer()` */
  async function send(text: string) {
    const query = text.trim()
    if (!query || busy) return

    /*
      正在口述时把消息发出去 —— 先收掉麦克风。

      不收的话,这一次会话还活着,下一个 `onresult` 会按
      `前缀 + 整段结果` 把刚清空的输入框**写回去**:用户看着自己发出去的话
      又长回输入框里,而且和刚才那条消息一模一样。这种「看不出哪儿错了」
      正是本仓库一以贯之要消灭的。
    */
    if (speech.listening) speech.stop()

    setInput('')
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: 'user', content: query }])
    setBusy(true)
    setNotice(null)

    try {
      await answer(query, state.meals)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 发图那条路:攒的那几张 → 逐张识别 → **原地**出一张结果卡。
   *
   * ## 为什么逐张串行,不是 `Promise.all`
   *
   * 每张是一次视觉模型调用,并发三发就是三份 45 秒的超时预算同时压在上游。
   * 串行还让「第 2 张,共 3 张」这句话是真的 —— 并发的话三张同时在跑,
   * 那个 1/3、2/3 就只能靠编。
   *
   * 代价说清楚:三张慢的时候要等一分多钟,而界面上只有一行小字在推进。
   */
  async function sendPhotos() {
    if (busy) return

    /*
      ⚠️ **`takeAll` 的转移语义在这里是唯一的安全带。**

      同一 tick 里双击(第二次点的时候 `busy` 还没翻过来),第二次拿到的
      是一张空表、当场退出。复制语义下那会是六次视觉模型调用、两分钟,
      以及对话里两张一模一样的卡。
    */
    const batch = takeAll(staged)
    if (batch.length === 0) return
    syncStaged()

    /* 先收麦克风、再清输入框 —— 理由和 `send()` 里那段逐字相同(见那边) */
    if (speech.listening) speech.stop()
    const question = input.trim()
    setInput('')
    setNotice(null)

    const runId = `r${Date.now()}`
    setMessages((m) => [
      ...m,
      {
        id: `u${Date.now()}`,
        role: 'user',
        // 附件条里那几串 URL **原样**搬过来 —— 用户看到的就是自己刚选的那几张
        content: question,
        photos: batch.map((p) => p.url),
      },
      { id: runId, role: 'assistant', content: '', run: { photos: batch.length } },
    ])
    setBusy(true)

    /*
      这一批的图从此刻起归会话登记表管。

      **登记之后就不能再撤了** —— 上面那条消息里画的就是它们,撤销即裂图。
      它们会在离开这一页时由 `releaseUrls()` 统一回收(见上面那个 cleanup)。
    */
    for (const p of batch) registerUrl(p.url)

    const run = beginRun()
    const mealSlot = currentSlot()

    /** 就地改那条「正在识别」的消息 —— 出结果时它变成结果卡,失败时变成一句话 */
    const patch = (fields: Partial<Pick<ChatItem, 'content' | 'run' | 'meal'>>) =>
      setMessages((m) => m.map((msg) => (msg.id === runId ? { ...msg, ...fields } : msg)))

    /*
      逐张的 200px 缩略图，**按 `batch` 的下标对齐**（某张没算出来就是 undefined）。

      它和消息气泡里那几串 object URL 是两样东西：那几串是用户发的原图，
      到离开这一页就撤；这里的缩略图是后续「待补记」那条记录要配的小图，
      得能活过这次会话（存进 localStorage）。所以 `recognizeOne` 那边用
      `onThumb` 单独交，不跟着 `attachPreview` 走。
    */
    const thumbs: (string | undefined)[] = []

    /*
      逐张**上传用的那份 JPEG**，也按 `batch` 的下标对齐。

      和 `thumbs` 是两样东西（见 `recognizeOne.onImage` 那段）：缩略图是给日记页
      看的那张小图，这个是**要再喂给模型**的那几个字节 —— 用户真要记进日记时，
      食衡拿它重算一遍营养。存哪儿、为什么不是 localStorage，见
      `store/draftPhotos.ts` 文件头。
    */
    const blobs: (Blob | undefined)[] = []

    /*
      这一批**最靠后**走到的那一步 —— 那张「正在识别 3 张…」气泡上跟在后面的
      小字。

      ⚠️ 需要这个变量,是因为三张从 2026-09-24 起是**并发**跑的(下面那段)。
      原来是靠 `activeIndex !== i + 1` 挡迟到的 `onStage`:一次只有一张在跑,
      「不是当前那张就丢掉」就够了。并发之后那个判据失效 —— 三张都是「当前
      那张」,而第 1 张迟到的「正在识别菜品」会在第 3 张已经报到「正在生成回答」
      之后到达,那一行字于是来回跳。改成 `advance` 折成一条单调的线。
    */
    let stage: AnalyzeStage | undefined

    try {
      /*
        ⚠️ **一批一起发,不是一张接一张(2026-09-24 改)。**

        原来是 `for` + `await recognizeOne(...)`,一张一次视觉调用、十几到
        几十秒,三张串行下来一分多钟 —— 而这三张本来就是**同一餐的几个角度**
        (用户的原话:「同一次发的三张图……哪怕这三张图只是同一道食物的不同
        角度照片」)。同一段形状在 `store/plate.ts` 和 `store/logRun.ts` 里
        各有一份,三处一起改了。

        ⚠️ **`outcomes` 的顺序必须 = `batch` 的顺序。** 用 `push` 的话顺序 =
        **完成顺序**,而下面假设 `outcomes[i]` 就是第 i 张的地方有两处:
        `okPhotoBlobs(...)`(`store/unlogged.ts:171`,记进日记时按它取要重算的
        那几张图)和 `firstOkThumb`(`:207`,待补记那条记录配的小图)。
        错位不会崩、也不会报错,是**静默配错图**。`Promise.all` 收的就是 map
        的返回值,天然按下标。
      */
      const outcomes: RecognitionOutcome[] = await Promise.all(
        batch.map(async (photo, i) => {
          // 离开页面 / 又发了一批 —— 这一批的结果不再属于任何人
          if (!isCurrentRun(run.token)) return { kind: 'cancelled' } as const

          return recognizeOne({
            file: photo.file,
            /*
              对话页发图走**膳享+** —— 和这一页打字同一个 agent。
              不传的话走食衡(「认一餐」那条工作流),它只会把配料表、冰箱这类图
              当成一次失败的识别去答,而用户要的是「我问什么就答什么」。
            */
            agent: 'chat',
            /*
              用户打的那句话跟着图一起发出去 —— 不然问什么都等于没问。

              ⚠️ **这是那句话唯一的去处(2026-09-23)。** 模型在这一趟里既认菜、
              也答那句话,答案落在回复的 `advice` 里,由那张卡自己画出来
              (有菜的走 `MealResultCard`,配料表那种整份都是回复卡的走
              `AgentReplyCard`)。此前这一趟之外还会拿它**再单独问一趟** ——
              屏幕上于是两条消息、两张卡、两版答案(各顶一条一模一样的「需注意」),
              用户的原话是「针对图片给一个答案,然后针对文字再给另一版答案?
              我不要这样,一起发的就一起回答」。

              代价说清楚:这一趟 query 里的 `meals` 是**归档之前**的(这盘菜
              还没进日记),所以「今天还能吃多少」这类问题它答不准。
              这盘菜的营养**此刻也还没有**(要记进日记时才调食衡算,见
              `computeForLog`),所以这一趟之后屏上不会补一句结论句 ——
              不拿一句多等几十秒、还会多印一张卡的回答去换它。
            */
            text: input,
            slot: mealSlot,
            profile: state.profile,
            // 现取,不缓存 —— 用户可能在这一批跑的过程中刚记了一餐
            meals: state.meals,
            /*
              ⚠️ **每张一个 controller,不能共用。**

              `recognizeOne` 超时会自己 abort 掉传给它的那个 —— 共用的话,
              第 1 张超时会把第 2、3 张的信号一起打成 aborted,那两张会被读成
              「用户自己取消」,于是**一张结果都不出**。见 `chatSession.ts` 文件头。
            */
            controller: run.newGate(),
            isCurrent: () => isCurrentRun(run.token),
            /*
              ⚠️ **折成单调的,不直接写 `stage: next`。** 三张同时在飞,第 1 张
              迟到的「正在识别菜品」会在第 3 张已经报到「正在生成回答」之后到达
              —— 直接写下去那一行小字会来回跳。`advance` 只往前走,而且
              `moved === stage` 时连 `patch` 都不发,免得白重渲一条消息。

              「是不是最新那批」这一层照旧自己挡:abort 掐断的是 fetch,
              已经排进微任务队列的回调照样会到。
            */
            onStage: (next) => {
              if (!isCurrentRun(run.token)) return
              const moved = advance(stage ?? 'compress', next)
              if (moved === stage) return
              stage = moved
              patch({ run: { photos: batch.length, stage: moved } })
            },
            onThumb: (dataUrl) => {
              thumbs[i] = dataUrl
            },
            /*
              这份留着，给「记入日记」那一趟。⚠️ 它**只在这个下标算成功时**才交
              （`onImage` 在取消/被顶替的路上根本不跑），所以两个数组对齐这件事
              在 `okPhotoBlobs` 里还要再筛一次 —— 别在这儿假设它们一样长。
            */
            onImage: (blob) => {
              blobs[i] = blob
            },
          })
        })
      )
      if (!isCurrentRun(run.token)) return

      const merged = mergeMeals(outcomes)

      /*
        `mergeMeals` 返回 null = **一张都没出菜**。

        对话页能走到这里只可能是「全失败」:「全取消」要求用户离开这一页
        (这一页没有取消按钮),而那时上面的 `isCurrentRun` 已经拦住了。
      */
      if (!merged) {
        const fail = outcomes.find((o) => o.kind === 'failed')
        patch({ run: undefined, content: fail ? fail.message : '这次一张都没能识别，换一张再试试。' })
        return
      }

      // 空着的那条「正在识别」就地变成结果卡 —— 同一行,不新起一条
      patch({ run: undefined, meal: merged })

      /*
        留一份「待补记」草稿 —— **下次进这一页**才会弹那句问话（见 `store/unlogged.ts`）。

        ⚠️ 这里**不弹、也不记**。用户可能只是在问「这餐咸吗」，根本没吃 ——
        决定的时刻被推迟到下次进来，那时他有一整晚可以想。

        判据全在 `unloggedFrom` 里（模型一道菜都没报 / 过敏拦截 / 全失败 → null）,
        这里只负责存。**就地覆盖**上一次是有意的:用户说的就是「上次识别到的
        那一餐」（单数）。

        存进去的 `items` 是**一份菜名清单**（2026-09-24 起）—— 克数和营养到
        「记入日记」那一刻才由食衡给,理由见 `store/unlogged.ts` 文件头第 2 段。
      */
      const draft = unloggedFrom({
        meal: merged,
        outcomes,
        thumbs,
        profileId: state.activeProfileId,
      })
      if (draft) {
        saveUnlogged(draft)
        /*
          照片存到另一边（IndexedDB），和草稿一起。

          ⚠️ 只存**这次真的认出来的**那几张（`okPhotoBlobs`）：降级的、取消的、
          失败的那几张和这份清单无关，喂给食衡等于让它去认一张别的图。少一张
          也不会有任何提示 —— 用户只是看到日记里少了一道菜，所以这一条宁可
          存多（同一次识别的全部成功图），不能按「第一张」想当然。

          失败**静默**，和 `saveUnlogged` 同一条理由（`unlogged.ts` 文件头最后
          一段）：照片存不下只是这次记不成，不该为它弹一条吓人的提示。
        */
        void putDraftPhotos(okPhotoBlobs(outcomes, blobs))
      }

      /*
        ⚠️ 这里原本还追加**一句结论句**（`mealVerdict`：这餐钠多少 mg、今天已经
        到上限的百分之几）。2026-09-24 撤掉了 —— 从那天起**发图不算营养**
        （用户定的口径，见 `MealResultCard` 文件头最后一段），而那句话的每一个字
        都建立在营养上：库外那道菜会让它说出「这餐 0 kcal，占今天配额的 0%」，
        一个长得像结论的错数字。它没有输入了。

        函数本身留在 `lib/chatMeal.ts` 里（那上面标注了「现在应用里没有调用方」）
        —— 它是为「手上有营养时那句话」写的，将来算完了还用得上。
      */

    } finally {
      setBusy(false)
    }
  }

  /**
   * 右槽那颗键按下去做什么。
   *
   * ⚠️ 和 `slotFor` 是**两件事**,别合并:那个决定「显示哪颗键」,
   * 这个决定「按下去做什么」。同一颗「发送」在有附件时发图、没附件时发字,
   * 而这两种情况在 `slotFor` 眼里是同一件事。
   *
   * 输入框的回车也走这里 —— 让回车和按钮指向同一个函数,
   * 否则「键盘上按回车」和「点那颗键」早晚会分叉成两种行为。
   */
  const onSend = () => {
    if (staged.photos.length > 0) void sendPhotos()
    else void send(input)
  }

  /* ------------------------------------------------------------
     历史记录
     ------------------------------------------------------------ */

  /**
   * 开始一次新对话。
   *
   * 三件事一起做，少一件都会留下一个「看起来换了、其实没换」的状态：
   *
   *   1. `messages` 回到只有问候语 —— 界面上真的是新的了。
   *      ⚠️ 那份旧的**不需要在这里手动落盘**：它每说一句就已经写过了
   *      （见上面那个 effect）。这里手动写一遍反而会用一个旧的 `at`
   *      把它盖回去。
   *   2. `conversationId` 清掉 —— 那是 Dify 那边的会话上下文。不清的话，
   *      新对话的第一句仍然带着旧对话的记忆，而屏幕上两边是分开的两条。
   *   3. `sessionId` 换一个新的 —— 否则新说的话会**续写**在旧会话那条记录上。
   *
   * `staged` 不在这里清：附件条上攒着没发的图是「我还没说完」，和「换个话题」
   * 无关。它们挂在盒子上，离开页面时会由 `discardAll` 统一收掉。
   */
  const startFresh = () => {
    setMessages([CHAT_GREETING])
    setConversationId(undefined)
    setSessionId(`c${Date.now()}`)
    setMenuFor(null)
    setHistoryOpen(false)
  }

  /**
   * 翻回一条旧对话。
   *
   * ⚠️ **旧对话里的照片不会回来。** 那几串是 `blob:` 地址，只在建立它的那个
   * document 里有效，所以落盘时就被丢掉了（见 `chatHistory.ts` 文件头）。
   * 翻出来的旧对话里，用户发过图的那几条只剩文字 —— 这不是 bug，是
   * 「刷新之后还能看到当时说了什么」的代价，而它换来的东西（历史能留）
   * 比照片重要。
   */
  const pickSession = (s: ChatSession) => {
    setMessages(s.items.length > 0 ? s.items : [CHAT_GREETING])
    setSessionId(s.id)
    // 同上：换了会话就得换掉上游的上下文
    setConversationId(undefined)
    setHistoryOpen(false)
  }

  /* ------------------------------------------------------------
     每条消息的操作
     ------------------------------------------------------------ */

  /**
   * 「撤回并重新编辑」和「重试」共用的一刀：**从这里往后全切掉**。
   * 规则本身在 `lib/chatOps.ts`（那里能断言），这里只是接上 state。
   */
  const cutFrom = (id: string) => setMessages((m) => cutFromItems(m, id))

  const retry = async (id: string) => {
    const question = questionBefore(messages, id)
    if (!question || busy) return
    cutFrom(id)
    setBusy(true)
    setNotice(null)
    try {
      // 重跑的是**原来那句**，不是输入框里此刻的内容 —— 见 `questionBefore`
      await answer(question, state.meals)
    } finally {
      setBusy(false)
    }
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /*
        `clipboard` 在非安全上下文（http 的局域网地址）里可能不存在或直接抛。
        这时候**要说出来**：「点了复制、粘出来是旧的」是一个查不出来的错，
        而用户手上其实还有一条路（自己选中文字）。
      */
      setNotice('这台设备不让自动复制，长按文字自己选吧。')
    }
  }

  /**
   * 一条消息能做哪几件事。
   *
   * 三样**按条消息的形态**增减，不是四样齐上：
   *   · 「复制本条」只在这条真有文字时给 —— 卡片形态的消息 `content` 是空的
   *     （内容在 `reply` / `meal` 里），复制一个空串等于复制了空气。
   *   · 「撤回并重新编辑」只有**用户**那条有：助手那条没有「原文」可放回输入框。
   *   · 「重试」只有**助手**那条有，而且得找得到它要重跑的那句提问
   *     （翻旧对话时可能找不到了 —— 那一句在更早的会话里）。
   */
  const actionsFor = (item: ChatItem): ActionItem[] => {
    const text = item.content.trim()
    /*
      「有哪些项」由 `opsFor` 决定（那一处能断言），这里只管「每一项点了做什么」。
      `Record<ChatOp, ActionItem>` 是**穷尽性**的：`ChatOp` 里加一个值而不在这里
      补上，typecheck 会红 —— 不会出现一个「算出来了但没有对应按钮」的操。
    */
    const byOp: Record<ChatOp, ActionItem> = {
      copy: { icon: 'copy', label: '复制本条', onSelect: () => void copyText(text) },
      undo: {
        icon: 'undo',
        label: '撤回并重新编辑',
        hint: '这句话和它之后的回答都会没掉',
        onSelect: () => {
          setInput(text)
          cutFrom(item.id)
        },
      },
      retry: {
        icon: 'refresh',
        label: '重新回答',
        hint: '用原来那句再问一次',
        onSelect: () => void retry(item.id),
      },
      delete: {
        icon: 'trash',
        label: '删除本条',
        hint: item.role === 'user' ? '只删这一句' : '只删这条回答',
        tone: 'danger',
        onSelect: () => setConfirm({ kind: 'message', item }),
      },
    }
    return opsFor(item, questionBefore(messages, item.id) !== null).map((op) => byOp[op])
  }

  /** 操作表上那句「在对什么操作」—— 用消息自己的开头，别让用户回忆 */
  const menuTitle = (item: ChatItem): string => {
    const text = item.content.trim()
    if (!text) return item.role === 'user' ? '这一条消息' : '这条回答'
    return text.length > 18 ? `${text.slice(0, 18)}…` : text
  }

  return (
    <Screen tabBar={false} scroll={false} contentClassName="flex flex-col">
      {/*
        右上角原来是一句静态说明「基于「我的档案」」—— 那句话现在挪到空态里
        （那里本来就要解释一次「这个回答是照什么说的」），这颗位置让给历史记录：
        一个**入口**比一句每次都一样的说明值得占地方。
      */}
      <NavBar
        backLabel="首页"
        onBack={() => navigate('/')}
        title="食衡 · 对话"
        right={
          <button
            onClick={() => setHistoryOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-[12px] text-ink active:bg-black/[0.05]"
            aria-label="历史记录"
          >
            <Icon name="history" size={19} />
          </button>
        }
      />

      {/* 演示模式说明 —— 如实告知用户在和什么说话 */}
      {agentAvailable === false && (
        <div className="mx-5 mb-1 flex items-start gap-2 rounded-[12px] border border-warn-line bg-warn-bg px-3 py-2">
          <Icon name="bulb" size={15} className="mt-px shrink-0 text-warn" strokeWidth={2} />
          <span className="text-[12px] leading-[17px] text-warn-body">
            未接入 agent，以下回答由本地规则结合你今天的记录生成，不是模型输出。
          </span>
        </div>
      )}
      {notice && (
        <div className="mx-5 mb-1 flex items-start gap-2 rounded-[12px] bg-black/[0.04] px-3 py-2">
          <Icon name="alertCircle" size={15} className="mt-px shrink-0 text-muted" strokeWidth={2} />
          <span className="text-[12px] leading-[17px] text-muted">{notice}</span>
        </div>
      )}

      {/*
        语音的失败理由 —— 用 warn 色而不是上面那条的中性色。
        它和 `notice` 不一样:notice 说的是「已经降级了,你什么都不用做」,
        这条几乎每一条都在要求用户做点什么(去设置里开权限 / 换个浏览器 /
        凑近一点)。同一种灰底会把这两种话读成同一件事。
      */}
      {speech.error && (
        <div className="mx-5 mb-1 flex items-start gap-2 rounded-[12px] border border-warn-line bg-warn-bg px-3 py-2">
          <Icon name="alertCircle" size={15} className="mt-px shrink-0 text-warn" strokeWidth={2} />
          <span className="text-[12px] leading-[17px] text-warn-body">{speech.error}</span>
        </div>
      )}

      {/* 消息区 —— 独立滚动,不把输入栏顶出屏幕 */}
      <div ref={scrollRef} className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
        <ChatTranscript items={messages} busy={busy} onActions={setMenuFor} />
      </div>

      {/*
        空态的三样:两个**真通**的入口、一句「回答依据什么」、三句快捷提问。

        ⚠️ 入口只有两个,不是膳享那五个(拍冰箱 / 拍餐盘 / 搜菜品 / 看菜单 /
        读配料)。「拍冰箱 / 看菜单 / 读配料」在这条链路上**没有接通**
        (前端只有一处传 mode、工作流那个代码节点不看 mode、解析层当时也不挑
        `ingredients` / `nutrition`)—— 摆上去就是三颗按下去什么都不发生的装饰,
        而这个 App 里不该有那种东西。

        这一屏的两个:
          · **拍餐盘** 走这一页既有的那条路 —— 图进附件条,再由用户点发送
            (文件头「发图和发文字是同一件事的两条分支」)。不跳页。
          · **搜菜品** 就是「手动记录」那个搜食物面板(`MealSheet`),
            首页入口 4 已经在用它。它不是 agent 的一部分。
      */}
      {messages.length <= 1 && (
        <div className="flex shrink-0 flex-col gap-2.5 px-5 pb-2.5">
          <span className="text-[12px] leading-[17px] text-faint">
            回答基于「我的档案」—— 你的忌口、目标和今天记下的餐。
          </span>
          {/*
            ⚠️ **「拍餐盘」那颗也撤了(2026-09-23,用户的原话:「不然这跟首页功能
            有什么区别?」)。**

            说得对。首页本来就是「拍餐盘」那一屏,它在对话页里再摆一颗,是**把
            首页的入口搬到了这里**——用户会问「那我到底该在哪拍」。同一件事有两个
            入口,迟早有人对着其中一个说「这跟那个有什么区别」。

            发图**没有丢**:输入栏那颗相机走的是同一条路(图进附件条,再由用户
            点发送),而且那条路本来就是「聊天里顺手发张图」的语义,不是「进入
            识餐盘流程」。

            所以这一屏的入场判据现在只剩那句说明 —— **对话页只干对话这一件事**。
          */}
        </div>
      )}

      {/*
        ⚠️ **这里原来还有两颗「搜菜品」和一行「快捷提问」胶囊,2026-09-23 撤了。**

        用户的原话是「不要有搜菜品这样的快捷键,只保留类似于豆包聊天的干净界面」。
        理由不只是好看:那些胶囊把**这一页的主语搞混了**——

          · 「搜菜品」根本不是对话,它打开的是首页那个手动记录面板
          · 三颗快捷提问是替用户决定他想问什么,而豆包那种界面里,
            用户是**自己想问题**的

        留下的只有上面那句「回答基于我的档案」—— 它说的是这一页**凭什么**回答,
        不是可以点的东西。发图那条路也没丢:输入栏本来就有附件入口
        (文件头那句「发图和发文字是同一件事的两条分支」)。
      */}

      {/*
        攒着还没发出去的那几张 —— **输入栏上面单独一行**,不挤进那 60pt。
        为什么、以及为什么每张都要能单独删,见 `AttachmentStrip.tsx` 文件头。
      */}
      <AttachmentStrip
        photos={staged.photos}
        onRemove={(url) => {
          unstage(staged, url)
          syncStaged()
        }}
      />

      {/* 输入栏 —— 高 60pt,固定底栏 */}
      <div className="flex h-[60px] shrink-0 items-center gap-2 px-5 py-2">
        <button
          onClick={picker.openCamera}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-card active:opacity-70"
          aria-label="拍餐盘"
        >
          <Icon name="camera" size={19} />
        </button>
        <button
          onClick={picker.openAlbum}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-card active:opacity-70"
          aria-label="从相册选择"
        >
          <Icon name="album" size={19} />
        </button>

        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSend()}
          placeholder="输入你的问题…"
          className="h-11 min-w-0 flex-1 rounded-[12px] border border-line bg-card px-3.5 text-[15px] leading-[21.72px] text-ink outline-none placeholder:text-faint focus:border-brand-line"
        />

        {/*
          第三个槽位 —— 三选一,理由见 `slotFor`。
          「停止」复用 `mic` 图标、只换颜色和脉冲:为「正在听」再画一个图标,
          等于把同一个意思画两遍(图标集里每一个都是手写的)。
          `aria-label` 三态各不相同 —— 读屏用户听到的就是这三个词。
        */}
        {slot === 'stop' ? (
          <button
            onClick={speech.stop}
            className="flex h-11 w-11 shrink-0 animate-pulse items-center justify-center rounded-[12px] bg-brand text-white active:opacity-80"
            aria-label="停止语音输入"
          >
            <Icon name="mic" size={19} />
          </button>
        ) : slot === 'send' ? (
          <button
            onClick={onSend}
            /*
              只禁 `busy`,不再禁空输入 —— 能走到这个分支就说明要么有字、
              要么有附件(`slotFor` 的判据)。而 `busy` 也只禁**发送**,
              不禁麦克风:识别三张要一两分钟,那段时间用户**必须**能打字、
              也**必须**能继续攒附件。
            */
            disabled={busy}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-brand text-white transition-opacity disabled:opacity-40 active:opacity-80"
            aria-label="发送"
          >
            <Icon name="send" size={18} />
          </button>
        ) : (
          <button
            onClick={onMic}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-card active:opacity-70"
            aria-label="语音输入"
          >
            <Icon name="mic" size={19} />
          </button>
        )}
      </div>

      {/* 两个隐藏 input —— 位置同首页,理由见 PhotoPicker.tsx 文件头第 3 条 */}
      {picker.inputs}

      {/*
        不支持语音的说明面板。`open` 由点击驱动 —— 按钮**照常渲染**,
        理由见 SpeechSheet.tsx 文件头:静默藏掉一个入口,用户分不清
        「App 没这功能」和「App 在这台机器上坏了」。
      */}
      <SpeechSheet open={speechInfoOpen} onClose={() => setSpeechInfoOpen(false)} />

      {/*
        「调整分量再记」打开的就是**现成的记录面板**（结果页也是这么用的那一套）。
        预填这份菜、这个餐次、这张缩略图，来源仍是「拍餐盘」——
        用户改的是分量，不是这一餐的来历。

        ⚠️ 预填的是**食衡刚算出来的那份**（`adjusting.items`），不是
        `unlogged.items`（那份菜名清单，一个数字都没有）—— 面板保存时是自己调
        `addMeal` 的，喂错那一份就是往日记里写一条 0 kcal。那一份在哪儿算出来的，
        见 `store/logRun.ts`。

        `open` 也是从那一趟读的：面板开着 = 那一趟算完了、正等在 `adjust-ready`
        上（原来是一个 `adjustOpen` state，现在没有第二个可以撒谎的状态位）。

        `onSaved` 里才清草稿：走到这一步说明用户真的记了（`addMeal` 由面板自己调）。
        面板里点「取消」只走 `onClose`，草稿和照片都留着，下次进这一页还会问。
        两个出口都要把那一趟收掉 —— 它是终态，留着它下次进来会挡住补记弹窗
        （见挂载那个 effect 的闸）。

        `date` / `time` 见 `MealSheet` 那段：这一餐属于**拍照那一刻**，
        和「记入日记」那条出口记的必须是同一个时刻。
      */}
      <MealSheet
        open={adjusting !== null}
        onClose={() => setLogRun(null)}
        initial={adjusting?.items ?? []}
        initialSlot={adjusting?.meal.slot}
        initialThumb={adjusting?.meal.thumb}
        source="拍餐盘"
        {...(adjusting
          ? {
              date: toISODate(new Date(adjusting.meal.at)),
              time: formatTime(new Date(adjusting.meal.at)),
            }
          : {})}
        onSaved={() => {
          clearUnlogged()
          void dropDraftPhotos()
          setUnlogged(null)
          setLogRun(null)
        }}
      />

      {/*
        补记弹窗 —— 排在上面那个面板之后、`z-50`，两者**不会同屏**
        （点「调整分量再记」时弹窗已经关掉了）。见 `UnloggedMealSheet` 文件头。
      */}
      <UnloggedMealSheet
        open={askOpen}
        meal={unlogged}
        onLog={() => unlogged && beginLogRun(unlogged, 'log')}
        onAdjust={() => unlogged && beginLogRun(unlogged, 'adjust')}
        onDismiss={dismissUnlogged}
      />

      {/*
        点完「记」之后那张提示卡 —— 等待和失败都归它说（见 `LogNotice` 文件头）。
        ⚠️ 它和上面那张弹窗**同层（`z-50`）但不会同屏**:点「记」的那一刻
        `beginLogRun` 就把 `askOpen` 收了。

        四个 prop 全由 `noticeFor(run, noticeClosed)` 推出来 —— 那三句话该说哪一句、
        以及「用户关过之后还算不算数」，判据只有那一处（纯函数，`verify:loop` 直接测）。
      */}
      <LogNotice
        open={logNotice !== null}
        kind={logNotice?.kind ?? 'log'}
        done={logNotice?.done ?? false}
        error={logNotice?.error ?? null}
        onClose={() => {
          setNoticeClosed(true)
          /*
            ⚠️ **关掉一个终态（记好了 / 没算出来）就是「这一趟到此为止」**，
            顺手把那一趟收掉 —— 不收的话它会一直挂着，而挂载时那句「要补记吗」
            被它挡在门外（见上面那个 effect 的闸），用户再也等不到那一次问话。
            「正在算」那一趟不在此列：关掉的只是这一页的通知，它继续飞。
          */
          if (run && run.phase !== 'computing') setLogRun(null)
        }}
      />

      {/*
        空态那颗「搜菜品」开的就是**首页那个**面板（同一个组件、同一个用法）——
        不是 agent 的一部分，也不经过对话。
      */}

      {/* 历史记录抽屉 —— `z-40`，比下面那个确认框低一层（见 `confirm` 那段注释） */}
      <ChatHistoryDrawer
        open={historyOpen}
        sessions={sessions}
        profileId={state.activeProfileId}
        onPick={pickSession}
        onNew={startFresh}
        onDelete={(session) => setConfirm({ kind: 'session', session })}
        onClear={() => setConfirm({ kind: 'clear' })}
        onClose={() => setHistoryOpen(false)}
      />

      {/*
        一条消息能做什么 —— 底下那层是它自己的遮罩，所以抽屉和它不会互相抢点击。
      */}
      <ActionListSheet
        open={menuFor !== null}
        title={menuFor ? menuTitle(menuFor) : ''}
        items={menuFor ? actionsFor(menuFor) : []}
        onClose={() => setMenuFor(null)}
      />

      {/*
        三种破坏性操作的确认框，**一个组件、三份文案**（见 `confirm` 那段）。
        `tone="danger"` 在这三处都对：它们都不可逆。
      */}
      <ConfirmSheet
        open={confirm !== null}
        tone="danger"
        title={
          confirm?.kind === 'session'
            ? '删掉这条对话记录？'
            : confirm?.kind === 'clear'
              ? '清空本档案的历史？'
              : '删掉这条消息？'
        }
        body={
          confirm?.kind === 'session'
            ? `「${sessionTitle(confirm.session)}」会从历史里没掉。当前屏幕上的这段不受影响。`
            : confirm?.kind === 'clear'
              ? '这个档案聊过的记录会全部没掉，别的档案的不动。当前屏幕上这段也会被清掉，重新开始。'
              : '只删这一条，前后两条都留着。'
        }
        confirmLabel="删除"
        onConfirm={() => {
          if (confirm?.kind === 'session') {
            const next = removeSession(sessions, confirm.session.id)
            setSessions(next)
            saveChatLog(next)
          } else if (confirm?.kind === 'clear') {
            const next = clearSessionsFor(sessions, state.activeProfileId)
            setSessions(next)
            saveChatLog(next)
            /*
              清完历史**同时开一段新的**：当前屏幕上这段如果留着，它下一句话
              又会把自己写回列表里 —— 用户刚点完「清空」，历史里马上又冒出一条，
              那一幕看起来像没清掉。
            */
            startFresh()
          } else if (confirm) {
            // 规则在 `lib/chatOps.ts`：**只拿掉这一条**，和上面那一刀不是一回事
            setMessages((m) => removeOne(m, confirm.item.id))
          }
        }}
        onClose={() => setConfirm(null)}
      />
    </Screen>
  )
}
