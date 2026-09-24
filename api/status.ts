/**
 * Vercel Serverless Function:GET /api/status
 *
 * 前端用它判断当前是「真实 agent」还是「演示模式」。
 * 只回一个布尔值,不暴露 Key、不暴露 Key 的前缀。
 */

// ⚠️ `.js` 不能省 —— 省了会让整个函数在加载阶段就崩(线上 500),理由见 api/_lib/agent.ts 文件头
import { handleStatus } from './_lib/agent.js'

export const GET = (): Response => handleStatus()
