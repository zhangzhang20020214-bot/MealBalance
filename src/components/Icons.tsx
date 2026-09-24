/**
 * 图标库 —— 对应 Figma「② 组件库 Components」里的 19 个 24×24 图标。
 *
 * 全部手写 SVG,不引入图标包:
 *   1. 设计稿的图标是 iOS SF Symbols 风格(圆头描边、1.8px 线宽),
 *      现成图标库的线宽和端点对不上,混用会明显不统一;
 *   2. 少一个运行时依赖,首屏更快。
 *
 * 统一约定:viewBox 0 0 24 24,stroke=currentColor,尺寸由 size 控制。
 */

export interface IconProps {
  /** 边长(px),默认 24 —— 与设计稿一致 */
  size?: number
  className?: string
  /** 线宽,默认 1.8;小尺寸场景可调细 */
  strokeWidth?: number
}

type IconDef = (p: Required<Pick<IconProps, 'strokeWidth'>>) => React.ReactNode

/** 描边风格的图标定义表 */
const OUTLINE: Record<string, IconDef> = {
  search: ({ strokeWidth }) => (
    <>
      <circle cx="11" cy="11" r="7" strokeWidth={strokeWidth} />
      <path d="M16.2 16.2 20.5 20.5" strokeWidth={strokeWidth} strokeLinecap="round" />
    </>
  ),

  close: ({ strokeWidth }) => (
    <path d="M6.8 6.8 17.2 17.2M17.2 6.8 6.8 17.2" strokeWidth={strokeWidth} strokeLinecap="round" />
  ),

  plate: ({ strokeWidth }) => (
    <>
      <circle cx="12" cy="12" r="8.5" strokeWidth={strokeWidth} />
      <circle cx="12" cy="12" r="4" strokeWidth={strokeWidth} />
    </>
  ),

  calendar: ({ strokeWidth }) => (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3.2" strokeWidth={strokeWidth} />
      <path d="M8 3.2v3.6M16 3.2v3.6M3.5 10h17" strokeWidth={strokeWidth} strokeLinecap="round" />
    </>
  ),

  breakfast: ({ strokeWidth }) => (
    <>
      <path d="M3.6 11.5h16.8a8.4 8.4 0 0 1-16.8 0Z" strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path
        d="M9.2 8.4c0-1.6 1.1-2.2 1.6-3.4M13.8 8.4c0-1.6 1.1-2.2 1.6-3.4"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </>
  ),

  leaf: ({ strokeWidth }) => (
    <>
      <path
        d="M20.5 3.5c0 9.5-5.8 14.6-12.4 14.6A5.1 5.1 0 0 1 3 13c0-6.6 6.3-9.5 17.5-9.5Z"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path d="M4.6 19.8C7.2 14.2 12 10.2 17.2 8.2" strokeWidth={strokeWidth} strokeLinecap="round" />
    </>
  ),

  rice: ({ strokeWidth }) => (
    <>
      <path d="M3.8 12.2h16.4a8.2 8.2 0 0 1-16.4 0Z" strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path
        d="M7.4 8.8c.8-2.2 2.6-3.4 4.6-3.4s3.8 1.2 4.6 3.4"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </>
  ),

  bulb: ({ strokeWidth }) => (
    <>
      <path
        d="M12 2.8a6.2 6.2 0 0 0-3.6 11.2c.5.4.8 1 .8 1.7v.6h5.6v-.6c0-.7.3-1.3.8-1.7A6.2 6.2 0 0 0 12 2.8Z"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path d="M9.4 19.2h5.2M10.4 21.4h3.2" strokeWidth={strokeWidth} strokeLinecap="round" />
    </>
  ),

  alertCircle: ({ strokeWidth }) => (
    <>
      <circle cx="12" cy="12" r="9" strokeWidth={strokeWidth} />
      <path d="M12 7.2v5.6" strokeWidth={strokeWidth} strokeLinecap="round" />
      <circle cx="12" cy="16.4" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),

  warning: ({ strokeWidth }) => (
    <>
      <path
        d="M12 4 21.2 19.6H2.8L12 4Z"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path d="M12 10v4.2" strokeWidth={strokeWidth} strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),

  check: ({ strokeWidth }) => (
    <path
      d="M4.8 12.6 9.6 17.4 19.2 6.8"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),

  person: ({ strokeWidth }) => (
    <>
      <circle cx="12" cy="8" r="3.7" strokeWidth={strokeWidth} />
      <path
        d="M4.6 20.4c0-4 3.4-6.6 7.4-6.6s7.4 2.6 7.4 6.6"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </>
  ),

  camera: ({ strokeWidth }) => (
    <>
      <path
        d="M4 8.4h2.7l1.5-2.4h7.6l1.5 2.4H20a1.6 1.6 0 0 1 1.6 1.6v7.6A1.6 1.6 0 0 1 20 19.2H4a1.6 1.6 0 0 1-1.6-1.6V10A1.6 1.6 0 0 1 4 8.4Z"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13.6" r="3.3" strokeWidth={strokeWidth} />
    </>
  ),

  album: ({ strokeWidth }) => (
    <>
      <rect x="3" y="4.6" width="18" height="14.8" rx="3.2" strokeWidth={strokeWidth} />
      <circle cx="8.3" cy="9.6" r="1.5" strokeWidth={strokeWidth} />
      <path d="M3.4 16.6 8.9 12l4.3 3.4 3.3-2.9 3.9 3.6" strokeWidth={strokeWidth} strokeLinejoin="round" />
    </>
  ),

  send: ({ strokeWidth }) => (
    <>
      <path d="M20.8 3.2 10.4 13.6" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path
        d="M20.8 3.2 14.4 20.8l-4-7.2-7.2-4L20.8 3.2Z"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </>
  ),

  /**
   * 麦克风 —— 对话页输入栏那个共用的槽位(见 ChatScreen)。
   *
   * 暂停/停止态**没有**第二个图标:同一个图标换成品牌色 + `animate-pulse`
   * 就够了。为「正在听」多画一个方块出来,等于把同一个意思画两遍,
   * 而图标集里的每一个都是手写的。
   */
  mic: ({ strokeWidth }) => (
    <>
      <rect x="9.2" y="2.8" width="5.6" height="10.4" rx="2.8" strokeWidth={strokeWidth} />
      <path
        d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0M12 17.8v3.4M8.8 21.2h6.4"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </>
  ),

  chevronLeft: ({ strokeWidth }) => (
    <path d="M15 4.6 7.6 12 15 19.4" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  ),

  chevronRight: ({ strokeWidth }) => (
    <path d="M9 4.6 16.4 12 9 19.4" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  ),

  plus: ({ strokeWidth }) => (
    <path d="M12 4.6v14.8M4.6 12h14.8" strokeWidth={strokeWidth} strokeLinecap="round" />
  ),

  sliders: ({ strokeWidth }) => (
    <>
      <path d="M4 8.2h8.6M18.4 8.2h1.6M4 15.8h1.6M11.4 15.8h8.6" strokeWidth={strokeWidth} strokeLinecap="round" />
      <circle cx="15.6" cy="8.2" r="2.2" strokeWidth={strokeWidth} />
      <circle cx="8.6" cy="15.8" r="2.2" strokeWidth={strokeWidth} />
    </>
  ),

  water: ({ strokeWidth }) => (
    <path
      d="M12 3.2c3.6 4.2 6.2 7.1 6.2 10.3a6.2 6.2 0 0 1-12.4 0c0-3.2 2.6-6.1 6.2-10.3Z"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  ),

  /*
    这里原来还有一支铅笔(`edit`),给页头那颗「编辑档案」按钮用。那颗按钮连同
    它打开的整张编辑面板都删掉了 —— 档案页现在每一格自己就是入口,不再需要
    一个「编辑」的总开关(理由见 ProfileScreen 上面那段)。

    顺手删掉而不是留着:一个没有调用方的图标,下一个人看见会以为「编辑入口
    应该用它」,然后把它加回页头。
  */

  /** 结果页结论卡:盾牌 + 对勾 */
  shieldCheck: ({ strokeWidth }) => (
    <>
      <path d="M12 2.8 4.8 5.8v6.1c0 4.6 3 7.6 7.2 9.3 4.2-1.7 7.2-4.7 7.2-9.3V5.8L12 2.8Z" strokeWidth={strokeWidth} strokeLinejoin="round" />
      <path d="M8.8 12 11.2 14.4 15.4 9.6" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
}

/** 标签栏选中态 —— 实心版本(iOS 规范:选中填充,未选中描边) */
const SOLID: Record<string, IconDef> = {
  home: ({ strokeWidth }) => (
    <path
      d="M12 2.6 2.4 10.8a1.2 1.2 0 0 0 .8 2.1h1.4v7.1c0 .8.6 1.4 1.4 1.4h4V15h4v6.4h4c.8 0 1.4-.6 1.4-1.4v-7.1h1.4a1.2 1.2 0 0 0 .8-2.1L12 2.6Z"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  ),
  diary: ({ strokeWidth }) => (
    <path
      d="M6.2 2.8h11.2a2.4 2.4 0 0 1 2.4 2.4v14a2.4 2.4 0 0 1-2.4 2.4H6.2A2.4 2.4 0 0 1 3.8 19.2V5.2a2.4 2.4 0 0 1 2.4-2.4Zm2.4 0v18.8"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  ),
  profile: ({ strokeWidth }) => (
    <path
      d="M6.4 2.8h7.2l4.8 4.8v11.6a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 19.2V5.2a2.4 2.4 0 0 1 2.4-2.4Zm7.2 0v4.8h4.8"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  ),
  me: ({ strokeWidth }) => (
    <path
      d="M12 3.2a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4ZM3.8 21.2c0-4.4 3.7-7.2 8.2-7.2s8.2 2.8 8.2 7.2v.6H3.8v-.6Z"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  ),
}

/** 标签栏未选中态 */
const TAB_OUTLINE: Record<string, IconDef> = {
  home: ({ strokeWidth }) => (
    <>
      <path
        d="M3.4 10.4 12 3.2l8.6 7.2v9.2a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6v-9.2Z"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path d="M9.4 21.2v-6.4h5.2v6.4" strokeWidth={strokeWidth} strokeLinejoin="round" />
    </>
  ),
  diary: ({ strokeWidth }) => (
    <>
      <rect x="3.8" y="2.8" width="16.4" height="18.4" rx="2.6" strokeWidth={strokeWidth} />
      <path d="M8.6 2.8v18.4" strokeWidth={strokeWidth} strokeLinecap="round" />
    </>
  ),
  profile: ({ strokeWidth }) => (
    <>
      <path
        d="M6.4 2.8h7.2l4.8 4.8v11.6a2.4 2.4 0 0 1-2.4 2.4H6.4A2.4 2.4 0 0 1 4 19.2V5.2a2.4 2.4 0 0 1 2.4-2.4Z"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <path d="M13.6 2.8v4.8h4.8" strokeWidth={strokeWidth} strokeLinejoin="round" />
    </>
  ),
  me: ({ strokeWidth }) => (
    <>
      <circle cx="12" cy="8.2" r="3.9" strokeWidth={strokeWidth} />
      <path d="M4.6 21.2c0-4.1 3.4-6.7 7.4-6.7s7.4 2.6 7.4 6.7" strokeWidth={strokeWidth} strokeLinecap="round" />
    </>
  ),

  /* ---------- 对话页消息操作那四颗(见 ChatScreen 的会话历史) ---------- */

  /** 复制文本 —— 两层方框,iOS 的 doc.on.doc */
  copy: ({ strokeWidth }) => (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.5" strokeWidth={strokeWidth} />
      {/* 后面那张纸只画**露出来的**两条边和一只角,不画完整矩形 ——
          画全了在 24×24 里会和前面那张糊成一团 */}
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A2.5 2.5 0 0 0 4 5.5v6A2.5 2.5 0 0 0 6.5 14" strokeWidth={strokeWidth} strokeLinecap="round" />
    </>
  ),

  /** 删除 —— 垃圾桶:盖、桶身、两条竖线 */
  trash: ({ strokeWidth }) => (
    <>
      <path d="M4.5 6.5h15" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M6.6 6.5l.8 12.2A1.8 1.8 0 0 0 9.2 20.5h5.6a1.8 1.8 0 0 0 1.8-1.8l.8-12.2" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M10.4 10.2v6.4M13.6 10.2v6.4" strokeWidth={strokeWidth} strokeLinecap="round" />
    </>
  ),

  /** 重试 —— 一段留了缺口的圆 + 箭头,箭头方向是**顺时针** */
  refresh: ({ strokeWidth }) => (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M20.2 3.4v3.9h-3.9" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  /** 撤回并重新编辑 —— 一个左转的箭头(回到上一步,不是「刷新」) */
  undo: ({ strokeWidth }) => (
    <>
      <path d="M4 9.5h9.2a5.8 5.8 0 0 1 0 11.6H8" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M7.8 5.6 4 9.5l3.8 3.9" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  /** 历史记录 —— 表盘 + 指针,抽屉的入口那颗 */
  history: ({ strokeWidth }) => (
    <>
      <circle cx="12" cy="12" r="8.5" strokeWidth={strokeWidth} />
      <path d="M12 7.6V12l3.1 1.9" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  /** 更多 —— 三个点,消息下面那颗「…」的入口(见 `ActionListSheet`) */
  /* 三个实心点,不吃 `strokeWidth` —— 所以形参直接不写(表里唯一一个) */
  more: () => (
    <>
      <circle cx="5.4" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="18.6" cy="12" r="1.35" fill="currentColor" stroke="none" />
    </>
  ),
}

export type IconName = keyof typeof OUTLINE

/** 通用图标(描边风格) */
export function Icon({ name, size = 24, className = '', strokeWidth = 1.8 }: IconProps & { name: IconName | string }) {
  const def = OUTLINE[name]
  if (!def) return null

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      {def({ strokeWidth })}
    </svg>
  )
}

/**
 * 标签栏图标 —— 选中时切换为实心版本。
 * @param active 是否选中
 */
export function TabIcon({
  name,
  active = false,
  size = 26,
  className = '',
}: {
  name: 'home' | 'diary' | 'profile' | 'me'
  active?: boolean
  size?: number
  className?: string
}) {
  const def = active ? SOLID[name] : TAB_OUTLINE[name]
  const sw = active ? 1.4 : 1.8

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      {def({ strokeWidth: sw })}
    </svg>
  )
}
