import { Icon } from './Icons'
import { PrimaryButton } from './ui'

/**
 * 「这台浏览器没有语音输入」说明面板。
 *
 * ⚠️ 为什么是**说明面板**而不是把按钮藏起来
 * ------------------------------------------------------------
 * Firefox 默认不带 `SpeechRecognition`,Opera 从来没有过。最省事的做法是
 * `supported ? <麦克风/> : null` —— 一行,而且永远不会出错。
 *
 * 但那会让用户分不清两件完全不同的事:**「这个 App 没有语音输入」**和
 * **「这个 App 在我这台机器上坏了」**。本仓库一直在消灭的就是这种
 * 「看不出来」:摄像头权限、`SEND_PROFILE_TO_AGENT`、看门狗,同一个道理。
 * 按钮照常渲染,点开说清楚为什么不能按、去哪儿能用 —— 用户至少知道自己
 * 没点错地方。
 *
 * 文案里**点名浏览器**同样是有用的:听众里真有人会照着换一个开。
 * 所以这一屏不写「请使用现代浏览器」这种等于没说的话。
 *
 * 另:这一屏**独立成一个组件**而不是写在 ChatScreen 里的一个 `useState`,
 * 有一个自检上的原因 —— `renderToStaticMarkup` 不跑 effect,`useState` 里
 * 的开关在 harness 里永远关着,那一整段文案**任何断言都够不到**。
 * 做成 `open` 是 prop 的组件,`verify-render.mjs` 就能拿 `open` 直接渲染它,
 * 断言「文案里点了 Chrome 和 Safari 的名」。
 */

interface SpeechSheetProps {
  open: boolean
  onClose: () => void
}

export function SpeechSheet({ open, onClose }: SpeechSheetProps) {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label="语音输入不可用">
      <button
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
        aria-label="关闭"
      />

      <div className="animate-sheet-up absolute bottom-0 left-0 flex w-full flex-col rounded-t-[24px] bg-[#FAFAFC] px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] backdrop-blur-2xl">
        <div className="flex h-[11px] items-center justify-center">
          <div className="h-[5px] w-9 rounded-full bg-faint" />
        </div>

        <div className="flex flex-col gap-2 px-1 pt-3 pb-4">
          <span className="text-[16px] leading-[22px] font-bold text-ink">这台浏览器不支持语音输入</span>
          <span className="text-[13px] leading-[19.5px] text-muted">
            语音输入用的是浏览器自带的语音识别接口。Chrome、Edge 和 Safari 都有，Firefox 默认没有
            —— 换成前三个里的任意一个就能用，用键盘输入也不影响食衡的其他功能。
          </span>

          <div className="mt-1 flex items-start gap-2 rounded-[12px] bg-warn-bg px-3 py-2">
            <Icon name="alertCircle" size={14} className="mt-px shrink-0 text-warn" strokeWidth={2.2} />
            <span className="text-[12px] leading-[17px] text-warn-body">
              即便浏览器支持，页面也必须跑在<strong>加密连接（https）</strong>上，
              否则麦克风根本不会启动 —— 本地开发时的 localhost 是例外。
            </span>
          </div>

          <p className="text-[11px] leading-[15.93px] text-faint">
            权限被拒绝之后，iOS Safari 不允许页面再次申请 —— 要到「设置 → Safari → 麦克风」里改回来。
            被拒时点麦克风不会有反应，只会出现一行提示告诉你这件事。
          </p>
        </div>

        <PrimaryButton icon="check" onClick={onClose}>
          知道了
        </PrimaryButton>
      </div>
    </div>
  )
}
