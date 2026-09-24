import type { ReactNode } from 'react'
import { StatusBar } from './StatusBar'
import { HomeIndicator } from './HomeIndicator'
import { TabBar } from './TabBar'
import { PhoneFrame } from './PhoneFrame'

/**
 * 页面骨架 —— iPhone 17(402×874pt)的三段式结构:
 *
 *   ┌─────────────────────────┐
 *   │ 状态栏 59pt(桌面才画)    │
 *   ├─────────────────────────┤
 *   │ 内容区(滚动,可被标签栏  │
 *   │ 覆盖)                    │
 *   ├─────────────────────────┤
 *   │ 悬浮标签栏 + Home 34pt   │
 *   └─────────────────────────┘
 *
 * 内容区高度用 flex 撑开而不是写死 815pt —— 真机屏幕比例各不相同,
 * 写死高度在别的机型上要么留白要么被裁。标签栏是浮动的,内容应当能滚到它下面
 * (设计改动说明里明确要求的 iOS 26 行为),所以按标签栏高度补出底部留白。
 *
 * 安全区统一用 env(safe-area-inset-*):真机上让开刘海和底部横条,
 * 桌面上这两个值恒为 0,所以无需额外分支。
 */
interface ScreenProps {
  children: ReactNode
  /** 是否显示底部标签栏(结果页/对话页/分析中不显示) */
  tabBar?: boolean
  /** 内容区是否可滚动。对话页自己管理滚动,传 false */
  scroll?: boolean
  /** 自定义内容区类名 */
  contentClassName?: string
  /** 状态栏与 Home Indicator 的明暗 */
  tone?: 'dark' | 'light'
  /** 页面底色 —— 分析中页是深色的,其余为浅绿 */
  background?: string
}

export function Screen({
  children,
  tabBar = true,
  scroll = true,
  contentClassName = '',
  tone = 'dark',
  background = 'bg-screen',
}: ScreenProps) {
  return (
    <PhoneFrame>
      {/* 真机:让出系统状态栏;桌面:由假的 StatusBar 占位,env 为 0 互不影响 */}
      <div
        className={`relative flex h-full w-full flex-col overflow-hidden pt-[env(safe-area-inset-top)] ${background}`}
      >
        <StatusBar tone={tone} />

        <main
          className={`no-scrollbar min-h-0 flex-1 ${
            scroll ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden'
          } ${
            /*
             * 有标签栏(83 = 标签栏顶边 14+60,再留 9pt 呼吸):内容要能滚到
             * 玻璃底下 —— 浮动标签栏的 iOS 26 行为,所以补白而不是把内容挤上去。
             *
             * 没有标签栏(对话页/结果页):输入栏和底部按钮是**贴底**的,
             * 不补白就等于压在 Home 横条上 —— 手机上下巴够不着,还容易误触。
             */
            tabBar
              ? 'pb-[calc(83px+var(--safe-bottom))]'
              : 'pb-[max(16px,var(--safe-bottom))]'
          } ${contentClassName}`}
        >
          {children}
        </main>

        {tabBar && <TabBar />}
        <div className="absolute bottom-0 left-0 z-30 hidden w-full sm:block">
          <HomeIndicator tone={tone} />
        </div>
      </div>
    </PhoneFrame>
  )
}
