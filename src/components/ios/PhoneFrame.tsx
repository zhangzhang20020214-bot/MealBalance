import { useEffect, useState, type ReactNode } from 'react'
import { useMediaQuery } from '../../lib/useMediaQuery'

/** iPhone 17 逻辑分辨率与机身尺寸(含边框) */
export const DEVICE_W = 402
export const DEVICE_H = 874
export const BEZEL = 10
export const BEZEL_W = DEVICE_W + BEZEL * 2
export const BEZEL_H = DEVICE_H + BEZEL * 2

/** 屏幕圆角 55pt;机身圆角要叠上黑边,55 + 10 = 65 */
const SCREEN_RADIUS = 55
const BODY_RADIUS = SCREEN_RADIUS + BEZEL

/**
 * 必须与 Tailwind 的 sm: 断点**完全一致** —— 用 rem 而不是 px。
 * Tailwind v4 的 sm 编译成 `@media (width>=40rem)`,若这里写 640px,
 * 用户改过浏览器默认字号时两者就会错开,导致 JS 判定与 CSS 样式不同步
 * (机身画出来了但没缩放,或反过来)。
 */
const DESKTOP_QUERY = '(min-width: 40rem)'

/**
 * 设备外框 —— 两种呈现,靠 CSS 切换而不是条件渲染。
 *
 *   真机(< 640px)  不画外框,内容铺满整屏。假的状态栏与 Home Indicator 也一并隐藏,
 *                  因为系统自己会画,叠上去就成了两条。安全区改用 env() 让位。
 *   桌面(≥ 640px)  402×874 机身 + 55pt 圆角 + 阴影,窗口放不下时整体等比缩放,
 *                  当作一份设计作品来展示。
 *
 * 为什么用 CSS 切换而不是 `isDesktop ? <A/> : <B/>`:
 * 后者会在跨越断点时把 children 整棵树卸载重建 —— 旋转平板就会丢掉对话记录、
 * 表单内容。CSS 切换只改样式,React 树始终是同一棵。
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (!isDesktop) {
      setScale(1)
      return
    }
    const compute = () => {
      const pad = 40
      const s = Math.min(
        1,
        (window.innerHeight - pad) / BEZEL_H,
        (window.innerWidth - pad) / BEZEL_W
      )
      setScale(Math.max(0.3, s))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [isDesktop])

  // 桌面端才需要机身尺寸与缩放;真机上让内容自然铺满
  const bodyStyle = isDesktop
    ? {
        width: BEZEL_W,
        height: BEZEL_H,
        transform: `scale(${scale})`,
        borderRadius: BODY_RADIUS,
        borderWidth: BEZEL,
      }
    : undefined

  return (
    <div className="flex h-[100dvh] w-full items-center justify-center sm:h-full sm:p-5">
      {/* 占位层:桌面端按缩放后的尺寸占位,flex 居中的是它而不是被缩放的元素 */}
      <div
        className="relative h-full w-full"
        style={isDesktop ? { width: BEZEL_W * scale, height: BEZEL_H * scale } : undefined}
      >
        <div
          className="absolute top-0 left-0 h-full w-full origin-top-left overflow-hidden bg-screen sm:border-[#0b0d0c] sm:shadow-[0_28px_80px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.08)]"
          style={bodyStyle}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
