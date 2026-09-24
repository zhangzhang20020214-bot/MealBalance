/**
 * 会话标识
 * ===========================================================
 * 随机生成,不涉及任何真实用户信息 —— 它只是 Dify 侧用来区分会话和统计的一个
 * 字符串,没有任何可反查到人的内容。
 *
 * 为什么必须**模块级只生成一次**,而不是每次请求现造一个
 * ------------------------------------------------------------
 * Dify 按 `tenant_id + created_by(user)` 过滤文件。拍照那条链路要发两次请求:
 *
 *     ① POST /files/upload     user = SESSION_USER  → 拿到 upload_file_id
 *     ② POST /chat-messages    user = SESSION_USER  → 带上那个 id
 *
 * 两个请求的 user 对不上,Dify 会报 `Invalid upload file id` —— 而且**报错文案
 * 里根本不提 user**,拿着这个错去查图片格式、查白名单,几乎必然查错方向。
 *
 * 放在模块里的第二个理由:对话页的 `conversation_id` 和它是配对的。换成
 * 每次现生成,同一台设备上的两次提问会落到两个不同的 Dify 会话里,多轮上下文
 * 直接断掉 —— 而且是那种「第一次还好好的,第二次就失忆」的难查表现。
 *
 * 模块级变量在这里是**对的**而不是偷懒:它的语义就是「这一次页面会话」,
 * 刷新即换新,和 pending / plate 那些内存态是同一个生命周期。
 */

/** 生成一个一次性的匿名标识。导出出来是为了自检里能造一个固定的 */
export function newSessionUser(): string {
  return `web-${Math.random().toString(36).slice(2, 10)}`
}

/** 本次页面会话的标识 —— 对话与拍照共用同一个 */
export const SESSION_USER = newSessionUser()
