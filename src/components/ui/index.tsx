import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { Icon } from '../Icons'

/**
 * UI 基础组件库 —— 尺寸、圆角、阴影全部取自 Figma 原始节点属性,
 * 不是目测值。每个组件的注释里标了对应的设计稿数值。
 */

/* ============================================================
   阴影 —— 取自设计稿 effects
   ============================================================ */

/** 白卡阴影:r24 / y8 / rgba(10,15,13,0.06) */
export const SHADOW_CARD = 'shadow-[0_8px_24px_rgba(10,15,13,0.06)]'
/** 深卡阴影:r28 / y12,更深以在浅底上浮起来 */
export const SHADOW_DARK = 'shadow-[0_12px_28px_rgba(10,15,13,0.22)]'
/** 主按钮阴影:r24 / y10,带绿色调 */
export const SHADOW_BTN = 'shadow-[0_10px_24px_rgba(52,199,89,0.32)]'

/* ============================================================
   卡片
   ============================================================ */

/** 白卡:r20,无描边 */
export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`block w-full rounded-[20px] bg-card text-left ${SHADOW_CARD} ${className}`}
    >
      {children}
    </Tag>
  )
}

/** 深色卡(健康分卡 / 摄入概览 / 档案卡 / 账户卡):r24,p16,gap12 */
export function DarkCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`w-full rounded-[24px] bg-ink p-4 text-white ${SHADOW_DARK} ${className}`}>{children}</div>
}

/* ============================================================
   标题
   ============================================================ */

/**
 * 区块标题 —— 13px/18 w500 ls0.3,**灰色**(#8E8E93),如「今日餐次」「餐次记录」。
 *
 * **它自己不带水平内边距。** 三个调用点都在 `px-5` 的页面容器里,自己再带一个
 * `px-5` 的话左边缘就是 40px,而它下面那张卡在 20px —— 标题会比它管着的卡片多缩进
 * 一截,读起来就不像在管下面那张卡。设计稿里两者是齐的(`figma-summary.txt:511-512`
 * 「今日餐次」与「今日餐次卡」同在 x=140;`:682-683` 档案页那对同在 x=1104)。
 * 所以内边距归**页面容器**管,这里只管字形。
 *
 * 它渲染的是 `<h2>`(`GroupHeader` 是 `<div>`)—— 档案页上那四个分类标签因此构成
 * 真正的标题大纲(一个 h1 + 四个 h2),而不只是四行长得像标题的字。
 */
export function SectionTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`text-[13px] leading-[18px] font-medium tracking-[0.3px] text-muted ${className}`}>
      {children}
    </h2>
  )
}

/**
 * 分组小标题 —— 12px/14 w500 ls0.2,如「账户与个人信息」「关于」。
 *
 * 它**坐在卡片里**,当那张卡的第一行 —— 所以它比 `SectionTitle` 小一号(12px vs 13px)
 * 也更靠里(`px-4`,和 `ListRow` 对齐)。判据是「这个标题在卡片里还是卡片外」,
 * 不是字号偏好。
 *
 * ⚠️ 档案页现在一个都不用 —— 那一页改成了一类一张卡、标签在卡片外(`SectionTitle`)。
 * 现在只有「我的」那一页在用(四处)。改这个组件之前先想一下那边。
 */
export function GroupHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1 text-[12px] leading-[14px] font-medium tracking-[0.2px] text-muted">{children}</div>
  )
}

/** 页面大标题 —— 28px/34 w700 ls-0.4 */
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.4px] text-ink">{children}</h1>
}

/** 页面副标题 —— 13px/18 w400 */
export function PageSubtitle({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-[18px] text-muted">{children}</p>
}

/* ============================================================
   列表
   ============================================================ */

/** 行内分割线 —— 左内缩 16pt,右到边(符合 iOS 规范) */
export function Divider({ inset = true }: { inset?: boolean }) {
  return (
    <div className="px-4">
      <div className={`h-px bg-line ${inset ? 'ml-0' : ''}`} />
    </div>
  )
}

/**
 * 列表行 —— 高 44pt,左右内边距 16pt。
 * @param secondary 右侧值用小号灰字(如「我的档案」带箭头),而非主值样式
 * @param expanded 披露行的开合态。**传了才写 `aria-expanded`,并把箭头转 90°**
 * @param controls 展开块的 id。传了才写 `aria-controls`
 * @param label 左列那个名字。**唯一的可选场景是「这一行没有名字」** ——
 *   档案页那两个忌口分组空着时的那一行(`<ListRow value="无" secondary />`),
 *   它代表的是「这个列表里一条都没有」,不是一个叫「无」的字段。
 *   ⚠️ 省掉 `label` 时产物与「传一个空串」逐字节相同(左列那个 `<span>` 照样
 *   渲染,只是内容为空),所以上面那条「不传新 prop 时产物必须逐字节不变」的
 *   约束不受影响。
 */
export function ListRow({
  label,
  value,
  secondary = false,
  chevron = false,
  right,
  onClick,
  danger = false,
  expanded,
  controls,
}: {
  label?: ReactNode
  value?: ReactNode
  secondary?: boolean
  chevron?: boolean
  right?: ReactNode
  onClick?: () => void
  danger?: boolean
  expanded?: boolean
  controls?: string
}) {
  const Row = onClick ? 'button' : 'div'
  /*
    ⚠️ **`expanded` / `controls` 不传时,这一行的产物必须逐字节不变。**

    `scripts/verify-render.mjs` 里有四处正则拿 `ListRow` 的现有产物当锚点
    (出生日期那一行的逐字符匹配、`bodyRowValue`、以及两处从面板 HTML 里抠
    值的断言)。多出一个空属性、或者箭头 className 里多一个空格,都会让那几条
    莫名其妙地红 —— 而它们红的原因和这次改动八竿子打不着。

    所以两个属性都**按需拼**而不是写成 `aria-expanded={expanded}`:后者在
    `undefined` 时 React 会整个省掉属性,但箭头那个 className 会多出半个空格。
  */
  const disclosure = expanded !== undefined
  return (
    <Row
      onClick={onClick}
      aria-expanded={disclosure ? expanded : undefined}
      aria-controls={controls}
      className={`flex h-11 w-full items-center justify-between gap-4 px-4 text-left ${
        onClick ? 'transition-colors active:bg-black/[0.03]' : ''
      }`}
    >
      <span className={`shrink-0 text-[15px] leading-[22px] ${danger ? 'text-danger' : 'text-ink'}`}>{label}</span>

      <span className="flex min-w-0 items-center gap-1.5">
        {right ?? (
          <span
            className={
              secondary
                ? 'truncate text-[13px] leading-[18px] text-muted'
                : `truncate text-[15px] leading-[22px] font-medium ${danger ? 'text-danger' : 'text-ink'}`
            }
          >
            {value}
          </span>
        )}
        {chevron && (
          <Icon
            name="chevronRight"
            size={16}
            className={`shrink-0 text-faint ${disclosure ? `transition-transform ${expanded ? 'rotate-90' : ''}` : ''}`}
            strokeWidth={2.2}
          />
        )}
      </span>
    </Row>
  )
}

/* ============================================================
   徽章 / 标签
   ============================================================ */

type BadgeTone = 'brand' | 'neutral' | 'danger' | 'warn' | 'dark'

const BADGE_TONES: Record<BadgeTone, string> = {
  brand: 'bg-brand-bg text-brand-text',
  neutral: 'bg-black/[0.05] text-muted',
  danger: 'bg-danger-bg text-danger-text',
  warn: 'bg-warn-bg text-warn-text',
  dark: 'bg-ink text-white',
}

/** 徽章 —— 高 24pt,r12,左右内边距 10pt,11px/13 w500 */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center rounded-[12px] px-2.5 text-[11px] leading-[13px] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * 圆形序号徽章 —— 18×18,品牌底色,里面是**裸数字**。
 *
 * 两个调用点:对话页那张卡的「建议 1、2、3」,和结果页「进食顺序」那张卡的第几步。
 * 提出来是因为这段类名本来就有第二份拷贝,而这个仓库为同一件事立过规矩
 * (`ResultScreen.tsx:157`):**同一件事有两个实现,早晚会在配色上分叉。**
 *
 * ⚠️ 它带着 `tnum`,但内容是裸数字 —— `verify-render` 的 `GRAM_READOUT`
 * (`/tnum[^>]*>\s*(\d+)\s*g\s*</`)只认「数字紧跟一个 g」,`1` 不命中。
 * **别在这里加单位**:那个正则是整页扫描的,多出来的克数读数会让结果页
 * 几条否定断言以「不把它当成一道菜渲染」的名义红,而原因看着和这张卡无关。
 */
export function NumberBadge({ children }: { children: ReactNode }) {
  return (
    <span className="tnum mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-brand-bg text-[11px] leading-none font-medium text-brand-text">
      {children}
    </span>
  )
}

/** 目标标签 —— 高 32pt,胶囊,13px/15.6 w500 */
export function Tag({ children, active = true }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={`inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] leading-[15.6px] font-medium ${
        active ? 'bg-ink text-white' : 'bg-black/[0.05] text-muted'
      }`}
    >
      {children}
    </span>
  )
}

/* ============================================================
   进度条 / 环形分数
   ============================================================ */

/**
 * 营养进度条 —— 高 8pt,r4。
 * @param pct 0–100 以上均可;超过 100 视为超标,自动转红
 */
export function ProgressBar({ pct, over = false }: { pct: number; over?: boolean }) {
  const width = Math.max(0, Math.min(100, pct))
  return (
    <div className="h-2 w-full overflow-hidden rounded-[4px] bg-brand-bg">
      <div
        className={`h-full rounded-[4px] transition-[width] duration-500 ease-out ${over ? 'bg-danger' : 'bg-brand'}`}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

/**
 * 健康分圆环 —— 84×84,描边 8pt。
 * 设计稿:轨道 #FFFFFF(低透明度),进度 #34C759。
 */
export function ScoreRing({ score, max = 100, size = 84 }: { score: number; max?: number; size?: number }) {
  const stroke = 8
  const r = (size - stroke) / 2 - 2.5
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, score / max))

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
      {/* 轨道 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.18"
        strokeWidth={stroke}
      />
      {/* 进度 —— 从 12 点方向顺时针 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#34C759"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

/* ============================================================
   控件
   ============================================================ */

/**
 * 分段控件 —— 底 150×32 r10,p3,gap2,深色底;选中项白底 r8
 *
 * `size` 是后加的,因为同一个控件要服务两类完全不同的场景:
 *
 *   · `'sm'`(默认,维持原样 32pt 轨道 / 26pt 按钮)—— 日/周/月、餐次这类
 *     **非必经**的筛选器,旁边还有别的东西可以点,26pt 够用。
 *   · `'lg'`(44pt 轨道 / 38pt 按钮,整宽)—— 「确认分量」那种**必经**的
 *     逐菜选择。26pt、三个相邻目标只隔 2px 是在制造误触;仓库自己的标准
 *     写在 MealSheet 里:「每一项都远超 44pt 热区」。
 *
 * 无障碍:这是一组「N 选一」,所以用 `radiogroup` + `radio` + `aria-checked`,
 * 并**按 ARIA 的模式补上方向键** —— 只给 role 不给方向键是错的:读屏用户会按
 * 「单选组」的预期用箭头操作,而 tab 序列里只留得下选中项那一站(roving
 * tabindex)。`label` 是这一组的名字,读屏时念成「米饭 分量」。
 *
 * (改之前这个控件一点 ARIA 都没有 —— 选中状态只靠背景色传达,读屏软件在每行
 * 听到三个没有选中态、也没有行上下文的按钮。)
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  label,
  columns,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'lg'
  /** 这一组的无障碍名字 —— 一屏里有好几组时必须给,否则读屏用户分不清在哪一行 */
  label?: string
  /**
   * 铺成几列,不传就是原来那一行。
   *
   * 加它是因为**餐次从四个变成了六个**:三个字一档之后,「上午加餐」四个字在
   * `sm` 的 `min-w-[46px]` 里放不下,六个一行无论如何都挤不开(窄屏一行约 337px,
   * 六个按钮至少要 300px 且每个只有 56px)。铺成两行三列之后每个都写得下全名。
   *
   * 高度**不固定**:两行比一行高,写死 `h-8` 会把按钮压扁。按钮的
   * `min-w-[46px]` 也换成了 `min-w-0` + `w-full` —— 由格子的宽度说了算。
   */
  columns?: number
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  /**
   * 方向键走一步。
   *
   * ⚠️ `step` 不是恒为 1:ARIA 对 radiogroup 的要求是**方向键跟着视觉布局走** ——
   * 铺成两行之后,「下」应该落到正下方那一格,也就是跳过一整行(`columns`),
   * 而不是往右挪一格。不传 `columns` 时它退化成 1,和原来完全一样。
   *
   * 越界**不夹紧、而是绕回去**(`+ n) % n`):这一组是个环,第一个的左边是最后一个。
   * 布局和索引不一致时(比如最后一格下面是空的)绕回去比停住更可预期 ——
   * 停住的表现是「按了没反应」,那是这个仓库最怕的一类。
   */
  const move = (dir: 1 | -1, step = 1) => {
    const i = options.findIndex((o) => o.value === value)
    if (i < 0) return
    const next = (i + dir * step + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        const row = columns ?? 1
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          move(-1)
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          move(1, row)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1, row)
        }
      }}
      className={`gap-0.5 rounded-[10px] bg-ink p-[3px] ${
        columns ? 'grid h-auto' : `flex items-center ${size === 'lg' ? 'h-11 w-full' : 'h-8'}`
      }`}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={active}
            // roving tabindex:整组只占一个 tab 站,组内用方向键走
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={`flex items-center justify-center rounded-[8px] text-[13px] transition-colors ${
              columns
                ? 'h-[30px] w-full min-w-0 px-1'
                : size === 'lg'
                  ? 'h-[38px] flex-1'
                  : 'h-[26px] min-w-[46px] px-3'
            } ${
              active ? 'bg-card font-medium text-ink shadow-[0_1px_4px_rgba(10,15,13,0.18)]' : 'text-white/70'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** 主按钮 —— 362×54 r14,品牌绿,17px w700,可带图标 */
export function PrimaryButton({
  children,
  onClick,
  icon,
  className = '',
  tone = 'brand',
}: {
  children: ReactNode
  onClick?: () => void
  icon?: string
  className?: string
  /**
   * danger 用于删除一类的破坏性操作。
   * 做成 prop 而不是让调用方传 `className="bg-danger"` 覆盖 ——
   * Tailwind 的同类工具类优先级相同,谁生效只看产物里的先后顺序,
   * 靠类名顺序覆盖是在赌打包结果。
   */
  tone?: 'brand' | 'danger'
}) {
  const tones = { brand: 'bg-brand', danger: 'bg-danger' }
  return (
    <button
      onClick={onClick}
      className={`flex h-[54px] w-full items-center justify-center gap-2 rounded-[14px] text-[17px] leading-[20.4px] font-bold text-white transition-transform active:scale-[0.985] ${tones[tone]} ${SHADOW_BTN} ${className}`}
    >
      {icon && <Icon name={icon} size={19} strokeWidth={2.4} />}
      {children}
    </button>
  )
}

/**
 * 图标底座 —— 44×44。
 * tone 取值对应设计稿里实际用到的几种填充:
 *   白卡内 #EAF6EE / 餐次按类型着色 #FFF3DC · #FDECEC / 深色卡上白色半透明
 */
export function IconTile({
  name,
  size = 44,
  radius = 14,
  tone = 'brand',
  iconSize = 22,
  src,
}: {
  name: string
  size?: number
  radius?: 12 | 14
  tone?: 'light' | 'plain' | 'brand' | 'meal' | 'danger' | 'warn'
  iconSize?: number
  /**
   * 有图就显示图,没有就显示图标 —— 日记里拍餐盘那条记录用照片替掉图标。
   *
   * 复用这个组件而不是另外写一个 div:它的语义本来就是「一个方形图形位」,
   * 图标只是其中一种填充方式。调用方拿到的尺寸、圆角、`shrink-0` 都一致,
   * 所以日记页的分割线缩进(`pl-[68pt]`)不用为一个可选的照片调整。
   */
  src?: string
}) {
  // 全部写成完整字面量,保证 Tailwind 构建期能扫描到
  const tones = {
    light: 'bg-card text-ink',
    plain: 'bg-white/20 text-white',
    brand: 'bg-brand-bg text-brand-deep',
    meal: 'bg-meal-bg text-meal-text',
    danger: 'bg-danger-bg text-danger-text',
    warn: 'bg-warn-bg text-warn-text',
  }
  return (
    <div
      // overflow-hidden 只在有图时才有意义(裁掉溢出圆角的部分),
      // 但常驻也不会影响图标 —— 图标本来就画在框内
      className={`flex shrink-0 items-center justify-center overflow-hidden ${tones[tone]}`}
      // 圆角走内联样式:radius 是运行时变量,Tailwind 的动态类名拼接
      // 在构建期扫描不到,会静默失效
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {src ? (
        // object-cover 而不是 contain:照片和图标位是同一个方框,
        // 留白会让整列看起来没对齐
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon name={name} size={iconSize} />
      )}
    </div>
  )
}

/**
 * 头像 —— 48×48 圆形。
 * 设计稿里深色卡上的头像是**品牌绿底白图标**(不是灰底),这里保持一致。
 */
export function Avatar({ size = 48, tone = 'brand' }: { size?: number; tone?: 'brand' | 'neutral' }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full ${
        tone === 'brand' ? 'bg-brand text-white' : 'bg-black/[0.05] text-muted'
      }`}
      style={{ width: size, height: size }}
    >
      <Icon name="person" size={24} />
    </div>
  )
}

/**
 * 导航栏 —— 44pt 高。返回键为品牌绿(iOS 26 规范),标题居中。
 */
export function NavBar({
  backLabel,
  onBack,
  title,
  right,
}: {
  backLabel?: string
  onBack?: () => void
  title?: string
  right?: ReactNode
}) {
  return (
    <div className="relative flex h-11 w-full items-center px-5">
      {backLabel && (
        <button onClick={onBack} className="flex h-11 items-center gap-1 pr-2 text-brand-text active:opacity-60">
          <Icon name="chevronLeft" size={18} strokeWidth={2.4} />
          <span className="text-[17px] leading-[22px] font-medium">{backLabel}</span>
        </button>
      )}

      <span
        className={`text-[17px] leading-[22px] font-medium text-ink ${
          backLabel ? 'absolute left-1/2 -translate-x-1/2' : ''
        }`}
      >
        {title}
      </span>

      {right && <div className="ml-auto flex items-center text-[11px] leading-[14px] font-medium tracking-[0.2px] text-faint">{right}</div>}
    </div>
  )
}

/** 脚注 —— 11px/15.93,**最浅一级灰**(#C7C7CC),用于免责声明与数据来源说明 */
export function Footnote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`px-4 text-[11px] leading-[15.93px] text-faint ${className}`}>{children}</p>
}

/* ============================================================
   输入控件
   ============================================================ */

/**
 * 步进器 —— 面板里那组「− 值 +」。
 *
 * 抽出来的理由不是省两行:`QuotaSheet` 和 `MealSheet` 已经各抄了一份一模一样的
 * 按钮(同一个 h-8 w-8 圆形、同一个 bg-black/[0.05]、同一套 disabled 时的
 * opacity-30),而档案编辑和建档引导要用第三、第四次。**第三份拷贝就该抽。**
 *
 * 两档尺寸不是随手加的,是两个现有调用点的实测差异:
 *   · `md` —— QuotaSheet 那行(值 76pt 宽、14px)
 *   · `sm` —— MealSheet 每条已选食物的分量(值 46pt 宽、13px,且带「g」)
 * 值本身用 `display` 传,因为两边一个要单独的灰色单位、一个要连在一起的「150g」。
 */
export function Stepper({
  value,
  step,
  min,
  max,
  onChange,
  ariaLabel,
  display,
  size = 'md',
  className = '',
}: {
  value: number
  step: number
  min: number
  max: number
  onChange: (next: number) => void
  /** 读屏名 —— 拼出「减少热量」。不给就是一个光秃秃的「−」 */
  ariaLabel: string
  /** 值的显示文本。默认就是数字本身 */
  display?: ReactNode
  size?: 'md' | 'sm'
  className?: string
}) {
  const cell = { md: 'w-[76px] text-[14px]', sm: 'w-[46px] text-[13px]' }[size]
  const btn =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[17px] leading-none text-ink active:opacity-60'
  const atMin = value <= min
  const atMax = value >= max

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={atMin}
        className={`${btn} ${atMin ? 'opacity-30' : ''}`}
        aria-label={`减少${ariaLabel}`}
      >
        −
      </button>
      <span className={`tnum text-center font-medium text-ink ${cell}`}>{display ?? value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={atMax}
        className={`${btn} ${atMax ? 'opacity-30' : ''}`}
        aria-label={`增加${ariaLabel}`}
      >
        +
      </button>
    </div>
  )
}

/* ============================================================
   滚轮 —— 出生年月 / 身高 / 体重
   ============================================================ */

/**
 * 一行的高度(px)。行高和容器高必须同源,错开了中间那行就不在正中。
 * `PickerSheet` 画选中框时也要用它,所以是导出的。
 */
export const WHEEL_ITEM_H = 36
/** 看得见几行。**要奇数**,选中的那行才落在正中间 */
export const WHEEL_ROWS = 5

/**
 * 滚轮选择器 —— 上下滑着选,像调闹钟那样。
 *
 * 为什么不是 `Stepper`
 * ------------------------------------------------------------
 * 那几列的档数是 87(出生年)/ 12(月)/ 81(身高)/ 121(体重),从默认值挪到
 * 目标值最坏要按四五十下,而手机上没有「按住连发」这回事 —— 每一下都是一次
 * 精确点击。
 *
 * 为什么不是 `<input type="range">`
 * ------------------------------------------------------------
 * 拉杆在一指宽的行程里要分出 121 档(体重),一档 2.7px,手指压着根本站不住;
 * 而滚轮是**把行程换成了长度** —— 121 档铺开是 121 行,想选 55kg 就滚到 55,
 * 精度不受控件宽度限制。
 *
 * 它是怎么转起来的
 * ------------------------------------------------------------
 * 滚动 + `snap-mandatory` 就够浏览器自己吸附,不需要 `transform` 那套手写惯性。
 * 中间那块选中框是**固定不动的底**,行从它下面滚过去 —— 所以整个控件
 * **没有一帧滚动状态**:不重渲染、不跟着算透明度,那是这段代码敢这么短的
 * 唯一原因(上下两端的淡出也是一条静止的 CSS mask,见 index.css)。
 *
 * 值只在**滚停之后**才交出去(120ms 内没有新的滚动事件):拖动过程中一路
 * onChange 的话,父组件会拿着半路上的档位做一堆没有意义的中间态。
 *
 * 三个入口都通:触摸(原生惯性)、滚轮、方向键。鼠标拖拽是**自己加的** ——
 * 桌面预览里没有它,这个控件在电脑上就是个死的方块。
 */
export function Wheel({
  label,
  value,
  limits,
  unit = '',
  format,
  onChange,
  className = '',
}: {
  /** 读屏名。值在外面那行里,轮子本身只有数字 */
  label: string
  value: number
  limits: { min: number; max: number; step: number }
  /**
   * 单位,**只进 `aria-valuetext`**(读屏会念「165cm」),不画在轮子上 ——
   * 屏幕上那行已经写着「165cm」了,轮子里再写一遍是重复
   */
  unit?: string
  /**
   * 每一行画成什么文本。默认就是数字。
   *
   * 只有「月」那一列用得上(画成「3月」),因为并排的两列都是数字时,
   * 光看轮子分不出哪列是年哪列是月。单位仍然只在 `unit` 里 —— 它管读屏,
   * 这个管眼睛。
   */
  format?: (v: number) => string
  onChange: (next: number) => void
  className?: string
}) {
  const { min, max, step } = limits
  const count = Math.round((max - min) / step) + 1
  const index = Math.round((value - min) / step)
  const scroller = useRef<HTMLDivElement>(null)
  /** 滚停后才提交值的那个定时器 */
  const settle = useRef<number | undefined>(undefined)
  /** 鼠标拖拽的起点。非 null = 正在拖 */
  const drag = useRef<{ y: number; top: number } | null>(null)

  /*
    把轮子滚到当前值。

    阈值取**半行**而不是 0:吸附动画还在路上时 scrollTop 也是偏的,拿 0 当阈值
    会在半路把它一把拽到位,看起来就是「滑到一半卡一下」。偏过半行才说明这是
    一次**外部**改的值,不是自己刚滚出来的。
  */
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const want = index * WHEEL_ITEM_H
    if (Math.abs(el.scrollTop - want) > WHEEL_ITEM_H / 2) el.scrollTop = want
  }, [index])

  /** 把当前停住的那一行交出去 */
  const commit = () => {
    const el = scroller.current
    if (!el) return
    const i = Math.max(0, Math.min(count - 1, Math.round(el.scrollTop / WHEEL_ITEM_H)))
    const next = min + i * step
    if (next !== value) onChange(next)
  }

  useEffect(() => () => window.clearTimeout(settle.current), [])

  const onScroll = () => {
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(commit, 120)
  }

  /*
    鼠标拖拽。**只认鼠标**:触摸走的是原生滚动(带着 iOS 的惯性,自己写的
    那套永远没它跟手),这里再插一手会和它打架。
  */
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    const el = scroller.current
    if (!el) return
    drag.current = { y: e.clientY, top: el.scrollTop }
    /*
      拖动期间**关掉吸附**:mandatory 会在每次 scrollTop 赋值后把容器拽回最近的
      吸附点,和手指较劲,表现是拖不动、或者一顿一顿地跳。松手再打开,
      浏览器自然会吸附到离得最近的那一行 —— 而那一行正是 `commit` 算出来的。
    */
    el.style.scrollSnapType = 'none'
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = scroller.current
    if (!drag.current || !el) return
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y)
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const el = scroller.current
    if (!drag.current || !el) return
    drag.current = null
    el.style.scrollSnapType = ''
    el.releasePointerCapture(e.pointerId)
    commit() // 松手当场结算,不等那 120ms
  }

  /*
    键盘 —— 滚轮天生只认触摸和鼠标。方向键一档、PageUp/Down 五档,
    和原生 `<input type=range>` 的手感对齐。
  */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? 5 : e.key === 'PageUp' ? -5 : 0
    if (!delta) return
    e.preventDefault()
    onChange(Math.max(min, Math.min(max, value + delta * step)))
  }

  const pad = WHEEL_ITEM_H * ((WHEEL_ROWS - 1) / 2)

  return (
    /*
      选中框**不在**这里 —— 它由 `PickerSheet` 画一条横跨所有列的。
      出生年月是两个轮子并排,各自画一块的话中间会断开成两个方块,
      看起来像两个控件;一条通到底才是 iOS 日期轮盘的样子。
    */
    <div className={`relative min-w-0 ${className}`}>
      <div
        ref={scroller}
        /*
          `role="slider"` 是**诚实**的选择:这个控件对读屏和键盘来说就是一个
          「在一段区间里选一个数」的东西,和 UIPickerView 在 iOS 上暴露的
          adjustable 特质是同一件事。报列表反而会让读屏念出 121 个选项。
        */
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value}${unit}`}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        /* select-none-ios:鼠标拖拽时别把数字当文字选中(选中了会拖出一片蓝) */
        className="wheel-mask no-scrollbar select-none-ios relative snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        style={{ height: WHEEL_ITEM_H * WHEEL_ROWS }}
      >
        {/* 上下各留出 (可见行数−1)/2 行,第一行和最后一行才滚得到正中 */}
        <div style={{ paddingBlock: pad }}>
          {Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              className="tnum flex snap-center items-center justify-center text-[17px] leading-none font-medium text-ink"
              style={{ height: WHEEL_ITEM_H }}
            >
              {format ? format(min + i * step) : min + i * step}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 多选胶囊 —— **预设 + 自由填写**,档案里那四栏(饮食目标 / 饮食偏好 /
 * 特殊时期 / 慢性病)共用这一个。
 *
 * 仓库里原本**没有**可点的 chip:`Tag`(`:168`)是个不可交互的 `<span>`,
 * 对话页那排快捷问题是内联写死的一次性按钮。而建档引导第 2、3 步要选的
 * 「健康目标」「慢性病」正是多选。
 *
 * 无障碍用 `role="checkbox"` + `aria-checked` —— 这是多选,不是单选组。
 * 只靠背景色表达选中态的话,读屏用户听到的是一串没有状态的按钮。
 *
 * ⚠️ 2026-09-20 起 `value` 里**可以出现预设之外的词**。这不是放宽,是那四栏
 * 的本来面目:预设只是「点一下省得打字」,装不下「甲状腺结节」「备孕」这类
 * 真实存在但没法穷举的取值。于是这个组件扛下三件事:
 *
 *   · 自己写的词**排在预设后面**,并且带 ✕ —— 位置和那个 ✕ 一起说明
 *     「这不是预设里的,是你写的」。之前 `TagsInput` 把选中的词单独摆一行,
 *     于是「预设」和「自填」看起来像两种东西,而它们最后是进同一个数组的。
 *   · 上限 `max` 算的是**总数**,不是自填词的数量。
 *   · 自填词的**去重**按原样比 —— 不做同义词合并。「素食」和「吃素」会被当成
 *     两条存下来,这是对的:合并规则写在这里就等于这个组件开始猜语义了。
 *
 * 以前这里还有 `SingleChips`(特殊时期单选用)和 `TagsInput`(饮食偏好用)。
 * 两个都删了 —— 特殊时期改成了多选,饮食偏好换成这个组件之后它就没人用了,
 * 而留一个没人用的导出,下一个人会以为它俩是有区别的。
 */
export function ChoiceChips({
  options,
  value,
  onChange,
  max,
  label,
  className = '',
  noneLabel,
  other,
}: {
  options: readonly string[]
  value: readonly string[]
  onChange: (next: string[]) => void
  /** 最多选几个(含自己写的)。不传就是不限 */
  max?: number
  /** 这一组的名字,读屏时念成「健康目标」 */
  label?: string
  className?: string
  /**
   * 在选项前面加一个「无」—— 它代表**空**,不是一个新的选项值:点了就
   * `onChange([])`,自己永远不进档案。
   *
   * 为什么不干脆把它塞进 `options`:那几张词表是**预设**,每一项背后都牵着
   * 配额算法或工作流词表里的一条(`verify-loop` 有断言盯着「每个预设目标
   * 都有英文枚举码」)。多一个「无」就要在那些地方各补一条映射,而空数组
   * 本来就已经是「无」了 —— 缺的只是一个能说出口的按钮。
   */
  noneLabel?: string
  /**
   * 传了就能自己填写 —— 胶囊下面多一个输入行,也就是「其他栏」。
   *
   * 不传就没有输入行:忌口那类**必须**从给定集合里选的地方不能有这个口子
   * (它们的取值要拿去和工作流的词表对齐),留着这个开关是为了让「哪几栏
   * 能自己写」在调用处一眼看得出来。
   */
  other?: {
    placeholder: string
    /** 输入行底下那句说明。用它讲清「自己写的词会发生什么」 */
    hint?: string
  }
}) {
  const [draft, setDraft] = useState('')

  /** 值里那些不在预设中的 —— 用户自己写的 */
  const extras = value.filter((v) => !options.includes(v))

  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt))
      return
    }
    // 到上限就**静默不改** —— 变灰已经说明了原因,再弹一句是噪音
    if (max !== undefined && value.length >= max) return
    onChange([...value, opt])
  }

  /** 加一个自己写的词。空串、重复、到上限都静默不改,理由同上 */
  const add = () => {
    const word = draft.trim()
    if (!word || value.includes(word)) return
    if (max !== undefined && value.length >= max) return
    onChange([...value, word])
    setDraft('')
  }

  const chipClass = (on: boolean, blocked = false) =>
    `inline-flex h-9 items-center rounded-full px-3.5 text-[13px] leading-[15.6px] font-medium transition-colors ${
      on ? 'bg-ink text-white' : 'bg-black/[0.05] text-muted'
    } ${blocked ? 'opacity-40' : 'active:opacity-70'}`

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {noneLabel && (
          <button
            type="button"
            role="checkbox"
            aria-checked={value.length === 0}
            onClick={() => onChange([])}
            className={chipClass(value.length === 0)}
          >
            {noneLabel}
          </button>
        )}
        {options.map((opt) => {
          const on = value.includes(opt)
          const blocked = !on && max !== undefined && value.length >= max
          return (
            <button
              key={opt}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(opt)}
              className={chipClass(on, blocked)}
            >
              {opt}
            </button>
          )
        })}
        {/* 自己写的词排在预设后面,而且带 ✕ —— 预设那颗再点一下就没了,不需要 ✕ */}
        {extras.map((word) => (
          <span key={word} className="inline-flex h-9 items-center gap-1 rounded-full bg-ink pr-2 pl-3.5 text-[13px] leading-[15.6px] font-medium text-white">
            {word}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== word))}
              className="flex h-6 w-6 items-center justify-center text-white/70 active:opacity-60"
              aria-label={`移除 ${word}`}
            >
              <Icon name="close" size={14} strokeWidth={2.4} />
            </button>
          </span>
        ))}
      </div>

      {other && (
        <>
          <div className="flex h-11 items-center gap-2.5 rounded-[12px] border border-line bg-card px-3.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // 只 preventDefault,别的什么都不做 —— 外面可能是 <form>
                  e.preventDefault()
                  add()
                }
              }}
              placeholder={other.placeholder}
              aria-label={`${label ?? ''}其他`}
              className="min-w-0 flex-1 bg-transparent text-[15px] leading-[21.72px] text-ink outline-none placeholder:text-faint"
            />
            <button
              type="button"
              onClick={add}
              className={`shrink-0 text-[14px] leading-[20px] font-medium text-brand-deep active:opacity-60 ${
                draft.trim() ? '' : 'pointer-events-none opacity-40'
              }`}
            >
              添加
            </button>
          </div>
          {other.hint && <p className="text-[11px] leading-[15.93px] text-faint">{other.hint}</p>}
        </>
      )}
    </div>
  )
}

/**
 * 单行文本输入 —— 左标签、右值,行高 44pt,和 `ListRow` 同一套尺寸。
 *
 * 用 `<label>` 包住整行:热区从那个输入框扩展到整行,而且不用给每个输入框
 * 编一个 id。之前仓库里三处 `<input>` 全是手写的,搜索框那处
 * (`MealSheet.tsx:168`)是本组件的样板。
 *
 * @param label 左边的可见标签。**可以不传** —— 见下
 * @param ariaLabel 不传 `label` 时,给读屏用的那一份名字
 */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  inputMode = 'text',
  maxLength,
  className = '',
  ariaLabel,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: 'text' | 'numeric' | 'decimal'
  maxLength?: number
  className?: string
  ariaLabel?: string
}) {
  /*
    `label` 可以不传,是给档案页那种**就地展开**的输入框用的:那一格的字段名
    已经写在上面那一行了,抽屉里再写一遍就是同义反复。

    可见标签没了,读屏名必须补上 —— 所以配一个 `ariaLabel` 而不是让调用方
    传 `label=""`:后者会留下一个没有名字的空 `<span>`,而它照样占着
    `justify-between` 的一格,把输入框往右推。

    也没有做成「`label` 和 `ariaLabel` 二选一」的联合类型:那样能让「两个都不给」
    写不出来,但调用点只有两处,读起来像一份声明;而这里真正要防的错
    (可见标签和读屏名对不上)一个类型也拦不住。
  */
  return (
    <label className={`flex h-11 w-full items-center justify-between gap-3 px-4 ${className}`}>
      {label !== undefined && <span className="shrink-0 text-[15px] leading-[22px] text-ink">{label}</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-label={ariaLabel}
        className="min-w-0 flex-1 bg-transparent text-right text-[15px] leading-[22px] text-ink outline-none placeholder:text-faint"
      />
    </label>
  )
}

/**
 * 多行文本 —— 引导最后一步那句「还有要补充的吗」用它。
 *
 * 为什么不是 `TextField` 再加一个 `multiline` 开关:两者的**行高和标签位置**
 * 就不一样(`TextField` 是「左标签 + 右值」的一行 44pt,这里是「上面一行小标题
 * + 下面一整块」)。塞进一个组件里,读的人要同时想两种布局。
 *
 * 高度用 `rows` 给一个下限而不是写死:补充说明通常一两句,写死 120pt 会在
 * 空着的时候占掉半屏,而那是这一屏最不该浪费的地方。
 *
 * @param label 上面那行可见小标题。**可以不传** —— 理由同 `TextField`
 * @param ariaLabel 不传 `label` 时,给读屏用的那一份名字
 */
export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 4,
  className = '',
  ariaLabel,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
  /** 至少几行高。默认 4 行 ≈ 一块能写两三句的地方 */
  rows?: number
  className?: string
  ariaLabel?: string
}) {
  return (
    <label className={`flex flex-col gap-2 px-4 ${className}`}>
      {label !== undefined && <span className="text-[12px] leading-[17.38px] text-muted">{label}</span>}
      <textarea
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        className="w-full resize-none rounded-[12px] border border-line bg-card px-3.5 py-3 text-[15px] leading-[21.72px] text-ink outline-none placeholder:text-faint"
      />
    </label>
  )
}

/**
 * 「它还在动」的三点动画。
 *
 * 原来是 `ChatTranscript.tsx` 里的一个私有函数（等模型回话那个气泡），日记页那一行
 * 「正在算这一餐」也要用它 —— 两处各写一份的话，同一种等待在两页上会长得不一样
 * （错开的时间、跳的高度），而那正是「同一页同一层级只许有一种写法」那条规矩
 * 管的事，只不过这次是跨页。
 *
 * ⚠️ 它是**纯装饰**：读屏读不到它，所以摆它的那一行必须自己把话说完
 * （「正在算这一餐的营养…」），别把「正在发生什么」全押在这三个点上。
 */
export function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint"
          style={{ animationDelay: `${i * 140}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  )
}
