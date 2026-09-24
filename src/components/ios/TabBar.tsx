import { NavLink } from 'react-router-dom'
import { TabIcon } from '../Icons'

/**
 * iOS 26 浮动玻璃标签栏 —— 370×60 胶囊底板,四周内缩 16pt,背景模糊。
 * 对应 Figma「② 组件库 / 标签栏 Tab Bar (iOS 26)」。
 *
 * 关键:它是 *浮动* 的,内容可在其下滚动,而不是把内容挤上去。
 * 所以本组件用 absolute 定位,由 Screen 布局补齐等高的底部留白。
 */

interface TabDef {
  to: string
  label: string
  icon: 'home' | 'diary' | 'profile' | 'me'
}

const TABS: TabDef[] = [
  { to: '/', label: '首页', icon: 'home' },
  { to: '/diary', label: '日记', icon: 'diary' },
  { to: '/profile', label: '档案', icon: 'profile' },
  { to: '/me', label: '我的', icon: 'me' },
]

export function TabBar() {
  return (
    <nav
      // 14pt 是设计稿里离屏幕下沿的距离。--safe-bottom 见 index.css:
      // 真机上叠一个系统横条的高度,Android / 桌面窄窗口上兜 16px ——
      // 只用 env() 的话那些设备上离边就只剩 14pt,压进手势区了。
      // 桌面展示框上它是 0,仍是设计稿的 14pt。
      className="absolute right-4 bottom-[calc(14px+var(--safe-bottom))] left-4 z-30 h-[60px] rounded-[30px] border border-white/60 bg-white/72 shadow-[0_8px_28px_rgba(10,15,13,0.12)] backdrop-blur-xl"
      aria-label="主导航"
    >
      <ul className="flex h-full items-center px-[9px]">
        {TABS.map((tab) => (
          <li key={tab.to} className="h-[50px] flex-1">
            <NavLink
              to={tab.to}
              end={tab.to === '/'}
              className={({ isActive }) =>
                // 每项 44×44 以上的点击热区,符合 iOS 最小触达规范
                `flex h-full w-full flex-col items-center justify-center gap-[3px] transition-colors duration-150 ${
                  isActive ? 'text-brand-deep' : 'text-muted'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <TabIcon name={tab.icon} active={isActive} size={26} />
                  <span className="text-[10px] leading-[12px] font-medium tracking-[0.1px]">{tab.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
