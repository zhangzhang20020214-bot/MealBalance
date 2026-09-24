import { useEffect, useState } from 'react'

/**
 * 订阅一条媒体查询。
 *
 * 用来区分「真机全屏」与「桌面机身展示」两种呈现。这两套的差别不只是样式 ——
 * 桌面端要用 JS 算出等比缩放值,所以必须能拿到布尔值,光靠 CSS 断点不够。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    // query 变化时先同步一次当前值,避免残留上一次的结果
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
