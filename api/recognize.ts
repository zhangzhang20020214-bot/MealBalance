/**
 * Vercel Serverless Function:POST /api/recognize
 *
 * 和 api/chat-messages.ts 同构的薄适配层,逻辑在 api/_lib/agent.ts。
 * 分文件是因为 Vercel 用**文件路径**做路由 —— 这里一个文件就是一个端点。
 */
import { handleRecognize } from './_lib/agent'

export const POST = (req: Request): Promise<Response> => handleRecognize(req)

/**
 * 这条链路比纯文本多一跳:上传文件 → 视觉推理 → 流式回答,
 * 所以取 Hobby 计划的上限 60 秒。
 *
 * ⚠️ 2026-09-23 起**聊天那边也是 60** —— `/api/chat-messages` 从那天起也收图
 * (对话页发图走的是它),两条端点干的是同一种活,预算不该一个 60 一个 30。
 * 两边都必须大于客户端的墙钟(`src/store/recognizeOne.ts` 的 `TIMEOUT_MS`)，
 * 那条不变量在 `verify:reply` 里有一节盯着。
 */
export const config = { maxDuration: 60 }
