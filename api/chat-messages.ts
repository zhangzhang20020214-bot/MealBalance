/**
 * Vercel Serverless Function:POST /api/chat-messages
 *
 * 只是一个薄适配层 —— 真正的逻辑在 api/_lib/agent.ts,
 * dev server 的中间件也用同一份,保证本地和线上行为一致。
 */

// ⚠️ `.js` 不能省 —— 省了会让整个函数在加载阶段就崩(线上 500),理由见 api/_lib/agent.ts 文件头
import { handleChat } from './_lib/agent.js'

/**
 * Vercel 的 Node 运行时支持 Web 标准签名:导出 GET/POST 等函数,
 * 收 Request、返回 Response。用它可以和 dev 中间件共用实现。
 */
export const POST = (req: Request): Promise<Response> => handleChat(req)

/**
 * 流式回复会持续几十秒,默认超时不够。
 *
 * ⚠️ **这条端点开始收图之后,「agent 正常几秒内就会答完」就不成立了**
 * (2026-09-23)。带图那一趟是「上传文件 → 视觉推理 → 流式回答」,和拍餐盘
 * 那条(`/api/recognize`,一直是 60)一样重,实测 20–37 秒。原来那个 30 是
 * 照着纯打字定的,于是**线上发图必挂**:函数被平台掐掉,前端拿到的是一句
 * 语焉不详的网络错误(本地 dev 没有这道限制,所以只有线上会犯)。
 *
 * 现在两条端点取同一个值(Hobby 上限 60),并且**必须大于客户端的墙钟**
 * (`src/store/recognizeOne.ts` 的 `TIMEOUT_MS`,现在是 55)—— 客户端先放弃,
 * 给出来的才是「等太久了」这句人话。**这两个数是一对**,改一个回头看另一个。
 */
export const config = { maxDuration: 60 }
