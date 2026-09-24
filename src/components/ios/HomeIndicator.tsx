/**
 * 底部 Home Indicator —— 34pt 安全区 + 134×5 指示条。
 * 对应 Figma「② 组件库 / Home Indicator」。
 */
export function HomeIndicator({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <div className="relative h-[34px] shrink-0 select-none-ios" aria-hidden="true">
      <div
        className={`absolute top-[21px] left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full ${
          tone === 'dark' ? 'bg-ink' : 'bg-white'
        }`}
      />
    </div>
  )
}
