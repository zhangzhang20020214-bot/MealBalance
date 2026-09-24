import { useEffect, useState } from 'react'

/**
 * iOS 状态栏 —— 59pt 高,含灵动岛。
 * 对应 Figma「② 组件库 / 状态栏 Status Bar」(内容=深色 / 内容=浅色 两版)。
 *
 * 时间走真实时钟而不是写死 19:47 —— 状态栏是"活的"这件事本身
 * 就是设备拟真的关键,写死的时间会让整个界面显得像静态截图。
 */

/** 信号强度:4 根递增高度的圆角柱 */
function Signal({ className }: { className?: string }) {
  return (
    <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor" className={className} aria-hidden="true">
      <rect x="0" y="7" width="3" height="5" rx="1" />
      <rect x="4.5" y="4.5" width="3" height="7.5" rx="1" />
      <rect x="9" y="2" width="3" height="10" rx="1" />
      <rect x="13.5" y="0" width="3" height="12" rx="1" />
    </svg>
  )
}

/** 无线局域网:三段弧 + 圆点 */
function Wifi({ className }: { className?: string }) {
  return (
    <svg width="15" height="12" viewBox="0 0 15 12" fill="none" stroke="currentColor" className={className} aria-hidden="true">
      <path d="M1 4.2a10 10 0 0 1 13 0" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M3.4 6.9a6.4 6.4 0 0 1 8.2 0" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5.9 9.5a2.8 2.8 0 0 1 3.2 0" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/** 电池:外框 + 正极触点 + 电量填充 */
function Battery({ className }: { className?: string }) {
  return (
    <svg width="25" height="12" viewBox="0 0 25 12" fill="none" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="21" height="11" rx="3.2" stroke="currentColor" strokeOpacity="0.38" />
      <rect x="2.2" y="2.2" width="15" height="7.6" rx="1.9" fill="currentColor" />
      <path d="M23.2 4.2v3.6a2 2 0 0 0 0-3.6Z" fill="currentColor" fillOpacity="0.38" />
    </svg>
  )
}

export function StatusBar({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // 对齐到下一分钟再开始走,避免整分钟刻度漂移
    const msToNextMinute = 60_000 - (Date.now() % 60_000)
    let interval: ReturnType<typeof setInterval> | undefined
    const timeout = setTimeout(() => {
      setNow(new Date())
      interval = setInterval(() => setNow(new Date()), 60_000)
    }, msToNextMinute)

    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [])

  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`

  return (
    <div
      // 真机上隐藏 —— 系统会画真的状态栏,再叠一个假灵动岛就重了
      className={`relative hidden h-[59px] shrink-0 select-none-ios sm:block ${
        tone === 'dark' ? 'text-ink' : 'text-white'
      }`}
      aria-hidden="true"
    >
      {/* 时间 —— 左内边距 24pt */}
      <span className="tnum absolute top-[21.5px] left-6 text-[17px] leading-[22px] font-bold">{time}</span>

      {/* 状态图标组 —— 右侧,距右边 24pt */}
      <div className="absolute top-[26.5px] right-6 flex items-center gap-[7px]">
        <Signal />
        <Wifi />
        <Battery />
      </div>

      {/* 灵动岛 —— 126×37,水平居中,距顶 11pt */}
      <div className="absolute top-[11px] left-1/2 h-[37px] w-[126px] -translate-x-1/2 rounded-full bg-black" />
    </div>
  )
}
