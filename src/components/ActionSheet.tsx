import { AttachmentStrip } from './AttachmentStrip'
import { Icon } from './Icons'
import { PrimaryButton } from './ui'

/**
 * 底部操作表 —— 对应 Figma「③ 界面原型 / 08 · 浮层 Action Sheet」。
 *
 * 设计规格:402×286,顶部圆角 24pt,背景 #FAFAFC + 模糊 30,
 * 40% 黑色遮罩,底部 44pt 安全区内边距(不压住 Home Indicator)。
 *
 * 三个状态,一个壳
 * ------------------------------------------------------------
 * 这个面板有三个状态,靠 `picked` 分:
 *
 *   · **没选图** —— 三行来源(拍照 / 从相册选择 / 手动记录)+ 取消。
 *   · **选好了** —— 一排缩略图(**末尾多一格「＋」**)+ 〔开始分析〕。
 *   · **再加一张** —— 点「＋」之后回到三行来源,但**已经选好的那几张还画在
 *     上面**,新选的接在后面。
 *
 * 锚点、遮罩、面板壳、抓手、底部安全区**三份共用**。这不只是省几行:
 * 三份壳早晚会分叉(圆角、`pb-11`、模糊值),而分叉出来的那种不一致
 * 是「看起来只是有点怪」的坏法,没人会为此提一个 issue。
 *
 * ⚠️ 为什么一次选完图**不直接开始分析**(这个组件存在的全部理由):
 * 选到文件的那一刻就发请求、就跳页的话,用户没有机会看一眼「这是不是我要的
 * 那张」—— 而拍糊了、拍成上一顿的照片是这件事最常见的失败。而且跳走之后
 * 首页那条链一路 `replace` 到结果页,浏览器的返回键回不到这里。
 */

export interface ActionSheetProps {
  open: boolean
  onClose: () => void
  /**
   * 「拍照」和「从相册选择」是**两个不同的动作** —— 它们曾经共用同一个回调,
   * 于是一个唤起后置摄像头、一个打开相册这件事在界面上看不出来。
   *
   * 这两个回调必须是**同步**的:`<input type="file">` 的 `.click()` 只能在
   * 用户手势的同步调用栈里生效(见 PhotoPicker.tsx 文件头第 1 条)。
   * 调用方从 `usePhotoPicker()` 拿到的 `openCamera` / `openAlbum` 直接传进来即可。
   */
  onCamera: () => void
  onAlbum: () => void
  /** 「手动记录」—— 打开食物搜索面板 */
  onManual: () => void
  /**
   * 已经选好、等着确认的那几张。**有图就进预览态**(空数组 = 没选,按没选算)。
   *
   * 只收 `url` 不收 `File`:`ActionSheet` 不发起任何任务,它只负责让用户
   * 看一眼 —— 拿到 `File` 就会有人忍不住在这里 `startPlateJob()`。
   *
   * ⚠️ 它和下面两个回调是一组:没有 `picked` 时 `onAnalyze` / `onRepick`
   * 根本没有被渲染出来的按钮可挂,传了也不会被调用。
   */
  picked?: {
    photos: readonly { url: string }[]
    /** 删掉一张。传的是 `url` 不是下标 —— 理由见 `composer.unstage` */
    onRemove: (url: string) => void
    /**
     * 末尾那格「＋」被点了 —— **回三行来源,但已选的那几张留着**。
     * 不传就没有那一格(还有余量时调用方才传,见 `AttachmentStrip` 的 `onAdd`)。
     *
     * ⚠️ 它和「重选」**不是同一件事**,这个面板里也没有「重选」:
     * 那个是「这几张一张都不要了」,而这一格是「再补一张」。两个都给的话,
     * 它们去的是同一个地方(三行来源)、区别只在清不清空 —— 两颗按钮长得一样、
     * 点下去的结果差很远,是这一屏最容易点错的一处。所以只留「＋」;
     * 「一张都不要了」用每张右上角那颗 ✕。
     */
    onAdd?: () => void
    /**
     * 现在停在「再加一张」那一屏。
     *
     * 由调用方给,不由面板自己 `useState`:这一屏的出口(选到图之后回预览、
     * 取消回预览)全都在调用方那侧,面板自己记一个就会和它有两个真相。
     * 而且组件里的 `useState` 在 SSR 下永远是同一个值,那一屏的文案
     * 任何断言都够不到(和 `UnloggedMealSheet` 受控是同一条理由)。
     */
    adding?: boolean
    /**
     * 副标题下面那行小字。今天装的是「一次最多 3 张,这次没收 2 张」。
     *
     * 由调用方给字符串而不是这里现算:这句话说的是**调用方那一步**的事
     * (首页是「送去分析」、对话页是「发出去」),面板不该知道它。
     */
    note?: string
  } | null
  /** 预览态的主按钮 —— 「开始分析」。发起任务和跳页都由调用方做 */
  onAnalyze?: () => void
}

export function ActionSheet({
  open,
  onClose,
  onCamera,
  onAlbum,
  onManual,
  picked,
  onAnalyze,
}: ActionSheetProps) {
  if (!open) return null

  // 每项 56pt 高,远超 44pt 最小热区
  const ITEM = 'flex h-14 w-full items-center gap-3.5 rounded-[14px] bg-card px-4 text-[17px] leading-[24.62px] text-ink active:bg-black/[0.04]'

  /*
    「选好了」这件事**只看有没有图**。`picked` 是个对象,判它本身为真不够 ——
    删到一张不剩时它还是那个对象,而那时候该退回三行来源,不是摆一条空白的
    附件条加一颗「开始分析」(点了之后 `startPlateJob([])` 什么都发不出去)。
  */
  const chosen = picked && picked.photos.length > 0 ? picked : null

  /*
    「再加一张」那一屏。**它是有图的第三种状态,不是第三种 `picked`** ——
    所以判据挂在 `chosen` 上:删到一张不剩时这一屏自动退回普通来源列表
    (那时候已经没有什么可「再加」的了,标题该是「拍摄餐盘」)。
  */
  const adding = chosen?.adding ? chosen : null

  /*
    三行来源 + 取消。**预览态和「再加一张」两屏共用** —— 「＋」的全部意义就是
    回这里再选一次,两处各写一遍的话早晚会是两套(某个入口少一行、或者
    `onManual` 只接到其中一个)。
  */
  const sourceBody = (
    <>
      <button className={ITEM} onClick={onCamera}>
        <Icon name="camera" size={22} />
        拍照
      </button>

      <button className={ITEM} onClick={onAlbum}>
        <Icon name="album" size={22} />
        从相册选择
      </button>

      {/* 识别之外的退路 —— 外卖、家常菜识别不准时,手动记录更可靠 */}
      <button className={ITEM} onClick={onManual}>
        <Icon name="search" size={22} />
        手动记录
      </button>

      {/* 取消 —— 独立分组,文字居中 */}
      <button
        onClick={onClose}
        className="flex h-14 w-full items-center justify-center rounded-[14px] bg-card text-[17px] leading-[20.4px] font-medium text-muted active:bg-black/[0.04]"
      >
        取消
      </button>
    </>
  )

  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-label="拍摄餐盘">
      {/* 40% 遮罩 */}
      <button
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
        aria-label="关闭"
      />

      {/* 面板 —— 底部 pb-11 即 44pt 安全区 */}
      <div className="animate-sheet-up absolute bottom-0 left-0 flex w-full flex-col gap-2 rounded-t-[24px] bg-[#FAFAFC] pt-2 pr-2.5 pb-11 pl-2.5 backdrop-blur-2xl">
        {/* 抓手 */}
        <div className="flex h-[11px] items-center justify-center">
          <div className="h-[5px] w-9 rounded-full bg-faint" />
        </div>

        {chosen && !adding ? (
          <>
            {/*
              一张和几张**说不一样的话**:「这张可以吗?」在选了 3 张时读起来
              像只认了第一张 —— 而用户此刻最想确认的恰恰是「3 张都进来了没有」。
            */}
            <div className="flex flex-col items-center gap-0.5 py-0.5">
              <p className="text-center text-[13px] leading-[18.82px] text-muted">
                {chosen.photos.length > 1 ? `选好了 ${chosen.photos.length} 张，可以吗？` : '这张可以吗？'}
              </p>
              {chosen.note && (
                <p className="text-center text-[12px] leading-[17.38px] text-muted">{chosen.note}</p>
              )}
            </div>

            {/*
              一排缩略图,和对话页发图前那条**同一个组件** —— 同一套交互
              (点 ✕ 删一张),尺寸在那边是 56、这里是 88,理由见
              AttachmentStrip 文件头最后一段。

              面板壳已经有 `px-2.5` 了,所以这里传 `px-0`,让这排缩略图和
              上下两行按钮左右对齐;`pb-0` 是因为壳自己有 `gap-2`。

              `onAdd` 是这一格跟对话页那条唯一的差别:首页要能「选了一张、
              再补一张」,而这一点在「选完直接开始分析」那条路上没地方放。
            */}
            <AttachmentStrip
              photos={chosen.photos}
              onRemove={chosen.onRemove}
              size={88}
              className="px-0 pb-0"
              {...(chosen.onAdd ? { onAdd: chosen.onAdd } : {})}
            />

            {/*
              只剩一颗按钮了,所以它占满整行 —— 原来〔重选〕在左、〔开始分析〕
              在右是为了让「这个决定不可逆,所以出口得一样够得着」;
              现在退出口是每张上那颗 ✕ 加末尾那格「＋」,都在缩略图那一排里,
              比原来那颗〔重选〕离手指更近。
            */}
            <PrimaryButton onClick={onAnalyze}>开始分析</PrimaryButton>
          </>
        ) : (
          <>
            {/*
              这一屏有两副面孔:**头一回选**(「拍摄餐盘,开始量化分析」)和
              **再加一张**(「再加一张」)。标题必须说清楚是哪一种 ——
              两屏的三行来源长得一模一样,而「点相册会不会把我刚才选的顶掉」
              正是用户此刻唯一想知道的事。
            */}
            <p className="py-0.5 text-center text-[13px] leading-[18.82px] text-muted">
              {adding ? '再加一张' : '拍摄餐盘，开始量化分析'}
            </p>

            {/*
              ⚠️ **已经选好的那几张还画在这里**,而且**没有「＋」那格**
              (我们要去的就是那一屏)。不画它们的话,用户在这屏上做的每个决定
              都是盲的:不知道点下去是「多一张」还是「换一张」。
              这里不传 `onAdd` —— 已经在加的路上了。
            */}
            {adding && (
              <AttachmentStrip
                photos={adding.photos}
                onRemove={adding.onRemove}
                size={88}
                className="px-0 pb-0"
              />
            )}

            {sourceBody}
          </>
        )}
      </div>
    </div>
  )
}
