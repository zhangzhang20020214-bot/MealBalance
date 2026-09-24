/**
 * Vercel Serverless Function:GET /api/status
 *
 * 前端用它判断当前是「真实 agent」还是「演示模式」。
 * 只回一个布尔值,不暴露 Key、不暴露 Key 的前缀。
 */

import { handleStatus } from './_lib/agent'

export const GET = (): Response => handleStatus()
