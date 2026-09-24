/**
 * 攒着还没发出去的照片 —— 对话页输入栏上方那条附件。
 * ===========================================================
 * 抽成纯逻辑模块的理由和 `mergeMeals.ts` / `speech.ts` 一样,而且是同一个:
 * **`renderToStaticMarkup` 不跑 effect、也点不动任何东西**。攒附件 → 删一张 →
 * 一次发出去这一串全在 `useState` 里,SSR 一步都够不到 —— 放在组件里就等于
 * 没有断言,而这里最要命的两个错误(少收了几张不说、同一批发两遍)恰恰都是
 * 「不崩、只是不对」的那一类。
 *
 * ⚠️ **对象 URL 的创建和撤销都在这个文件里**,别处一处都不许有。
 * 这类泄漏是这套代码里唯一查不出来的东西:少写一个 `revokeObjectURL` 不会报错、
 * 不会变慢到能被注意到,只是每拍一张就多占住一个几 MB 的 blob。
 * 收在同一个文件里,至少「谁建的、谁撤的」是能一眼读完的。
 */

/**
 * 一次最多发几张。
 *
 * 每张 = **一次视觉模型调用**(见 `src/store/recognizeOne.ts`),3 张串行
 * 慢的时候一分多钟 —— 这是你选「一次传 3 张 = 合成一餐」时接受的代价。
 * 放开到 10 张不是「更多」,是另一个量级:用户会对着一个不知道还要多久的界面,
 * 而每一次请求都多一个失败的机会。
 *
 * ⚠️ 名字里的「发」是**两个入口共用的**:对话页是「发出去」,首页是
 * 「送去分析」。上限是同一个数,因为代价是同一件事(几次视觉调用)。
 */
export const MAX_PHOTOS_PER_SEND = 3

/**
 * 多出来的那几张,**说给人听的那句话**。
 *
 * 两个入口共用一句,不各写一遍:这说的是同一件事(这个 App 一次最多分析
 * 几张),而两处各写一遍的下场是改了一处、另一处还写着旧数字。
 *
 * 静默丢的坏法见 `stage` —— 用户会以为那 5 张都发出去了。
 */
export function overflowNote(dropped: number): string {
  return `一次最多 ${MAX_PHOTOS_PER_SEND} 张，这次没收 ${dropped} 张。`
}

export interface StagedPhoto {
  /**
   * `URL.createObjectURL(file)`。
   * 既当附件条里那张缩略图,也是发出去之后消息气泡里那张图 —— **同一个串**,
   * 所以它在「发出去」之后**不能**被撤销(见 `takeAll`)。
   */
  url: string
  file: File
}

/** 攒着的那一批。是个**可变**的盒子,理由见下面每个函数 */
export interface Staged {
  photos: StagedPhoto[]
}

export function emptyStaged(): Staged {
  return { photos: [] }
}

/**
 * 收下这一批文件,**收不下的明说**。
 *
 * 超出的部分**不静默 `slice`**:`stage` 把没收的张数报回去,调用方必须说出来
 * (「一次最多发 3 张,这次没收 2 张」)。静默丢的坏法是:用户明明选了 5 张、
 * 以为都发出去了,而他没有任何办法发现少了两张 —— 那条对话里会少两道菜,
 * 卡片上还写着「识别到 3 道菜」,一切看起来都很正常。
 *
 * @returns 这次**没收进来**的张数;0 表示全收下了
 */
export function stage(staged: Staged, files: readonly File[]): number {
  const room = MAX_PHOTOS_PER_SEND - staged.photos.length
  const take = Math.max(0, Math.min(room, files.length))
  for (const file of files.slice(0, take)) {
    staged.photos.push({ url: URL.createObjectURL(file), file })
  }
  return files.length - take
}

/**
 * 删掉一张 —— 连同它那个对象 URL。
 *
 * 按 `url` 找而不是按下标:删掉第 1 张之后,原来第 2 张的下标就变了,
 * 按下标删会删错人(而界面上只是「点 ✕ 结果没了另一张」,看不出哪儿错了)。
 */
export function unstage(staged: Staged, url: string): void {
  const i = staged.photos.findIndex((p) => p.url === url)
  if (i === -1) return
  URL.revokeObjectURL(staged.photos[i].url)
  staged.photos.splice(i, 1)
}

/**
 * 全部拿走 —— **转移,不是复制**:返回之后 `staged.photos` 就是空的了。
 *
 * 转移这个动作的用处很具体:`sendPhotos` 只能把同一批图发出去一次。
 * 复制语义下,一次双击(第二次点的时候 `busy` 还没翻过来)会把同一批图
 * 发两遍 —— 代价是六次视觉模型调用、两分钟,以及对话里两张一模一样的卡。
 * 转移语义下第二次拿到的是一张空表,`sendPhotos` 直接在开头就退出了。
 *
 * ⚠️ 这里**不** revoke。这些 URL 马上就要拿去渲染用户发出去的那条消息,
 * 撤销了就是一张裂图。它们的生命周期到这次会话结束为止 ——
 * 见 `src/store/chatSession.ts` 里那张登记表。
 */
export function takeAll(staged: Staged): StagedPhoto[] {
  // 先接住旧数组,再给盒子换一个新的 —— 不这么写的话 `out` 和盒子
  // 指向同一个数组,后面任何一次 push 都会从「已经拿走的那批」里冒出来
  const out = staged.photos
  staged.photos = []
  return out
}

/**
 * 放弃这一批 —— **连同它们的对象 URL**。离开对话页时用。
 *
 * 和 `takeAll` 是一对,区别只有一件事:**这批照片发出去了没有**。
 *
 *   · 发出去了 → `takeAll`,URL 不许撤(消息气泡里画的就是它),交给
 *     `chatSession` 那张登记表,到离开页面时一并回收。
 *   · 没发出去 → 就是这个函数。用户选了三张又直接切走,不撤的话那几个 blob
 *     要等到刷新页面才释放 —— 而「选完又不想发了」是最常见的一种操作。
 *
 * 遍历撤销而不是只清空数组:`unstage` 一条一条撤也是这个写法,两处都在这
 * 一个文件里,谁建的谁撤。
 */
export function discardAll(staged: Staged): void {
  for (const p of staged.photos) URL.revokeObjectURL(p.url)
  staged.photos = []
}
