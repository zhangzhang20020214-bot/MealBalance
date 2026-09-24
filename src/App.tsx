import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import HomeScreen from './screens/HomeScreen'
import SplashScreen from './screens/SplashScreen'
import DiaryScreen from './screens/DiaryScreen'
import ProfileScreen from './screens/ProfileScreen'
import MeScreen from './screens/MeScreen'
import ResultScreen from './screens/ResultScreen'
import PortionScreen from './screens/PortionScreen'
import ChatScreen from './screens/ChatScreen'
import AnalyzingScreen from './screens/AnalyzingScreen'
import WelcomeScreen from './screens/WelcomeScreen'
import { useAppState } from './store/store'

/**
 * 路由表 —— 对应 Figma「③ 界面原型」的七个界面,外加「确认分量」和「建档引导」。
 *
 * 带底部标签栏的四个是「标签页」:首页 / 膳食日记 / 健康档案 / 我的。
 * 结果页、对话页、分析中、确认分量、建档引导是从首页推入的全屏页,
 * 不显示标签栏(各自在 <Screen> 上传 tabBar={false})。
 *
 * ⚠️ `/analyzing → /portion → /result` 这三跳**每一跳都 replace 掉自己**,
 * 所以拍一次照只在历史里留下「首页 + 终点」两个条目,从结果页按浏览器返回
 * 是回首页、不是回上一屏的动画页。加新页面时别把这条链打断 ——
 * 原因写在 AnalyzingScreen 的跳转 effect 里。
 */
export default function App() {
  const { onboarded, activeProfileId } = useAppState()
  const [splashDone, setSplashDone] = useState(false)

  /*
    开场页是**路由表外面的一道门**,不是一条路由。

    做成 `/splash` 那条路会有两个副作用:历史里多一个条目(在开场页按返回
    会回到开场页),而且老用户每次打开都得先被重定向一次、再重定向回来。
    做成门就没有这些问题 —— 门开之后路由表原样生效,深链接 `/chat` 进来
    的人看完开场仍然落在 `/chat`,历史里也只有他自己那一条。

    它每**次**挂载都出现(刷新也算),因为它不写盘、也不认人:
    「这次打开看没看过开场」这件事没有任何地方记得住,这正是它简单的代价
    和理由 —— 见 SplashScreen 顶上那段。
  */
  if (!splashDone) return <SplashScreen onDone={() => setSplashDone(true)} />

  /*
    没走完建档就**整张路由表换掉**,而不是在渲染期偷偷 navigate 走。

    区别在深链接和浏览器返回上:换表的话,没建档的人访问 `/profile` 会落到
    `*` → 跳 `/welcome`,而建档完之后 `/welcome` 自己就只剩 `*` → 跳 `/`,
    两边都是「路由说了算」的。渲染期跳转则会留下一段被渲染了一帧的、
    状态不完整的页面,而且返回键会把人推回一个已经不该存在的地址。

    建档引导自己不写盘(commit 只在动作里),所以这里读到的 `onboarded`
    和 localStorage 里有没有东西是两件事 —— 新用户第一次打开,
    盘上是干净的,`onboarded` 是 false。
  */
  return (
    <BrowserRouter>
      <Routes>
        {!onboarded ? (
          <>
            <Route path="/welcome" element={<WelcomeScreen />} />
            <Route path="*" element={<Navigate to="/welcome" replace />} />
          </>
        ) : (
          <>
            {/* ---- 四个标签页 ---- */}
            <Route path="/" element={<HomeScreen />} />
            <Route path="/diary" element={<DiaryScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/me" element={<MeScreen />} />

            {/* ---- 全屏推入页 ---- */}
            <Route path="/analyzing" element={<AnalyzingScreen />} />
            {/*
              「确认分量」夹在分析中和结果之间,不是 Figma 里的界面 —— 设计稿假设
              照片能估出克数(结果页写着「估算 150g」),而这件事做不到。
              README 里记了这笔偏离
            */}
            <Route path="/portion" element={<PortionScreen />} />
            <Route path="/result" element={<ResultScreen />} />
            {/*
              key 是给切换档案用的:对话页的 `conversationId` 是组件内 state,
              换档案时如果这个组件没被卸载,新档案会接着用旧档案那条 Dify 会话 ——
              上下文里还留着上一个档案的健康信息。

              今天换档案必须离开 `/chat`(切换器在档案页),路由变化已经把组件
              卸载了,所以这个 key 现在**什么都不会改变**。加它的理由是那件事
              靠的是巧合:哪天把档案切换器挪进对话页,这一行是唯一挡住
              「档案 A 的问题由带着档案 B 上下文的会话回答」的东西。
            */}
            <Route path="/chat" element={<ChatScreen key={activeProfileId} />} />

            {/* 未知路径兜底回首页 */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  )
}
