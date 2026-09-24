import { useEffect, useRef } from 'react'
import { Screen } from '../components/ios/Screen'

/**
 * 开场页 —— 打开 App 的第一屏,在**整张路由表之前**。
 *
 * 为什么要它
 * ------------------------------------------------------------
 * 之前点开链接,第一眼是「建立健康档案」这张表 —— 对一个还没搞清
 * 「食衡是什么」的人来说,先被问年龄体重是有点唐突的。这一屏只干一件事:
 * 报出名字、说清它是干嘛的,然后把路让开。
 *
 * 「不要太久」是它的硬约束,落在两处:
 * · **内容只有四行**,不是一屏介绍页;
 * · `AUTO_MS` 之后自动进,不想等的人点一下立刻进(整页可点)。
 *
 * 它不做任何判断
 * ------------------------------------------------------------
 * 这一屏**不碰 store、不写盘、不认人**。进到哪一屏由路由表说了算:
 * 没建档 → `/welcome` 建档引导;建过档 → `/`。开场页只负责让开,
 * 这就是它能放在路由表外面的原因(见 App.tsx 里那段路由守卫的注释)。
 */

/**
 * 自动进入的等待时长。**设成 0 就退化成「必须点一下才进」**。
 * 别调大:这一屏的全部意义是开场,不是内容。
 */
const AUTO_MS = 1000

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  /*
    onDone 走 ref 而不是进 effect 依赖数组:App 订阅了 store,任何一次
    状态变化都会重新渲染并给出一个新的箭头函数 —— 那样计时器会被反复
    重置,开场页就永远不自动走了。
  */
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    if (AUTO_MS <= 0) return
    const t = window.setTimeout(() => done.current(), AUTO_MS)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <Screen tabBar={false} scroll={false} tone="dark">
      {/*
        **整页可点**:这一屏没有按钮 —— 没有按钮就没有「按哪」这个问题,
        点哪都进。键盘用户不靠这一下,靠的是 AUTO_MS 那个计时器:
        它保证这一屏永远会自己走开,人在上面是停不住的。
        (所以 AUTO_MS 别设成 0 —— 那会同时拿掉唯一的出口。)
      */}
      <div
        onClick={onDone}
        className="animate-fade-in flex h-full flex-col items-center justify-center gap-6 px-8"
      >
        <BrandMark />

        <div className="flex flex-col items-center gap-1.5">
          <h1 className="text-[34px] leading-[41px] font-bold tracking-[-0.6px] text-ink">食衡</h1>
          <span className="text-[12px] leading-[16px] font-medium tracking-[2.4px] text-muted">
            MEALBALANCE
          </span>
        </div>

        <p className="text-center text-[15px] leading-[23px] text-brand-body">
          拍一餐，看清今天吃得怎么样
        </p>

        {/* 贴着屏幕底部,不参与上面那组的居中 */}
        <span className="absolute inset-x-0 bottom-[max(24px,var(--safe-bottom))] text-center text-[11px] leading-[16px] text-faint">
          不用登录 · 记录只存在这台设备上
        </span>
      </div>
    </Screen>
  )
}

/** 品牌标 —— 与 `public/favicon.svg` 同源(品牌渐变 + 白色盾牌勾),改色时两处一起改 */
function BrandMark() {
  return (
    <svg width="88" height="88" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="splash-brand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34C759" />
          <stop offset="1" stopColor="#1F9A44" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="22" fill="url(#splash-brand)" />
      <g
        fill="none"
        stroke="#fff"
        strokeWidth="7"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M50 12 L84 25 L84 50 L50 89 L16 50 L16 25 Z" />
        <path d="M33 50 L45 62 L68 36" />
      </g>
    </svg>
  )
}
