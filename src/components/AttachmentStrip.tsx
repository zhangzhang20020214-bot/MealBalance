import { Icon } from './Icons'
import { IconTile } from './ui'

/**
 * 攒着还没发出去的那几张 —— 输入栏**上方**单独一行
 * ===========================================================
 * ## 为什么是独立一行,不挤进输入栏那 60pt
 *
 * 输入栏固定 `h-[60px] px-5 gap-2`,每个控件 `h-11 w-11`。402pt 的屏去掉内边距
 * 剩 362pt,已经有 4 个子元素(相机 / 相册 / 输入框 / 发送)。再塞第 5 个只剩
 * ~114pt 给输入框 —— 写不下一句「今天盐吃多了吗」,等于把输入框废掉。
 * (`speech.ts` 的 `slotFor` 里算过同一笔账,那是「麦克风/发送/停止三态共用
 * 一个槽位」的理由。两条说的是同一件事的两面。)
 *
 * ## 为什么每张都要能单独删
 *
 * 用户攒三张的动机就是「这张糊了再补一张」。只给一个「全部清掉」的话,
 * 选错一张的代价是把选对的那两张一起重来 —— 而选错一张恰恰是最常见的情况。
 * 删除角标复用 `close` 图标:**图标集里没有 trash**,而「拿 close 当删除」
 * 是仓库已有的做法(`MealSheet` 里删已选食物、`ChoiceChips` 里删自填词)。
 *
 * ## 它不自己管生命周期
 *
 * 每张的 object URL 由 `composer.ts` 建、由 `composer.unstage` 撤。
 * 这个组件只画,不建也不撤 —— 一旦它自己 `revokeObjectURL` 一张还在列表里的图,
 * 表现是「点了 ✕ 结果另一张变裂图」,而且只在删中间那张时出现。
 *
 * ## 两个地方用它,所以有 `size` 和 `className`
 *
 * 对话页那条(输入栏上方)和首页「拍餐盘」面板里那条是**同一种东西**:
 * 一排缩略图,每张能单独删。合成一个组件而不是写两遍 —— 两遍早晚会分叉
 * (角标位置、圆角、`aria-label`),而分叉出来的不一致没人会为此提一个 issue。
 *
 * 面板里那个大一号(88 而不是 56):那一步的全部意义是**看一眼是不是这张**,
 * 而 56pt 上看不出「拍糊了没有」—— 首页单张那条路原来的 180pt 大图就是为这个
 * 存在的,换成附件条之后这个尺寸是它剩下的余地。数字要调就调这一处。
 *
 * ## 末尾那格「＋」是可选的
 *
 * 只有面板传 `onAdd` —— 它需要「已经选了一张,还想再补一张」这个入口。
 * 对话页那条**不传**:它的输入栏里相机、相册两颗按钮一直露着,再摆一格「＋」
 * 就是同一件事的第二个入口。
 *
 * 那格**不自己管来源**:点了之后回三行来源(拍照 / 相册 / 手动记录)还是直接
 * 开相册,是调用方的判断(面板选了前者,理由见 ActionSheet)。这个组件只画格子。
 */
export function AttachmentStrip({
  photos,
  onRemove,
  onAdd,
  size = 56,
  className = 'px-5 pb-1.5',
}: {
  photos: readonly { url: string }[]
  /** 传的是 `url` 不是下标 —— 删中间那张之后下标就变了,理由见 `composer.unstage` */
  onRemove: (url: string) => void
  /**
   * 末尾那格「＋」被点了。**不传就没有那一格**。
   *
   * ⚠️ 调用方自己判断**还有没有余量**:满了还摆着它,用户点进去选一张、
   * 回来只会看到一句「这次没收 1 张」—— 白走一趟(判据在调用方,因为
   * 「一次几张」这件事归 `composer.ts`,这个组件不知道上限)。
   */
  onAdd?: () => void
  /** 每张的边长(pt)。默认是输入栏上方那一条的尺寸。那一格「＋」跟着它走 */
  size?: number
  /**
   * 整条自己的内边距。默认值属于**输入栏上方那一行**;面板里传 `px-0`
   * 之类的把它抹掉 —— 那边的面板壳已经给过内边距了,再加一层会让这排缩略图
   * 和它上下那两行按钮**左右对不齐**。
   */
  className?: string
}) {
  /*
    一张都没有时**整个不渲染**,而不是渲染一个空行。这一行在输入栏上面,
    空着也会把消息区往上顶 56pt —— 而「没攒任何图」是这一页的常态。
  */
  if (photos.length === 0) return null

  return (
    <div className={`flex shrink-0 items-start gap-2 ${className}`}>
      {photos.map((p) => (
        <div key={p.url} className="relative">
          {/*
            `IconTile` 的 `src` 分支(圆角、`shrink-0` 都和白卡里那个图标位
            一致)。缩略图用 `object-cover` 是那个分支本来就有的选择。
          */}
          <IconTile name="camera" size={size} radius={12} tone="brand" src={p.url} />
          <button
            onClick={() => onRemove(p.url)}
            aria-label="移除这张照片"
            /*
              角标压在缩略图右上角,**往外溢出一点** —— 缩略图本身只有 56pt,
              压在框内会盖住照片内容,而且热区会缩到 20pt 以下。
              `-top-1 -right-1` + 24pt 直径 = 热区跨在图片外沿,手指点得到。
              (尺寸不跟着 `size` 走:24pt 是热区下限,再大就盖住照片了。)
            */
            className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-card text-muted shadow-[0_2px_6px_rgba(10,15,13,0.16)] active:opacity-60"
          >
            <Icon name="close" size={13} strokeWidth={2.8} />
          </button>
        </div>
      ))}

      {/*
        「＋」那格。宽高跟缩略图**一模一样**(同一个 `size`)—— 它不是按钮,
        是这排格子里空着的那一格,尺寸对不上会立刻像是没对齐。
        虚线边框 + `plus` 是仓库已有的「这里可以加一条」写法
        (见 ProfileSheet 的「新建档案」、RestrictionSheet),不另起一种。
        `shrink-0`:一排满了的时候被挤扁的那一格点不准。
      */}
      {onAdd && (
        <button
          onClick={onAdd}
          aria-label="再添加一张"
          style={{ width: size, height: size }}
          className="flex shrink-0 items-center justify-center rounded-[12px] border border-dashed border-line bg-card text-brand-deep active:opacity-60"
        >
          <Icon name="plus" size={22} strokeWidth={2.4} />
        </button>
      )}
    </div>
  )
}
