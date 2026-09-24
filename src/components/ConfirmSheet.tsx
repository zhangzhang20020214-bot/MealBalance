import { PrimaryButton } from './ui'

/**
 * 二次确认 —— 底部面板。
 *
 * 为什么不用 window.confirm:它在移动端浏览器里是系统弹窗,样式和 App 完全脱节,
 * 而且在 iOS 的独立窗口模式下会被当成页面级弹窗,出现位置很怪。
 * 破坏性操作只有一次机会,确认框得让人看得清、也点得准。
 *
 * 沿用其他面板的规格:顶部圆角 24、#FAFAFC 底、抓手条、底部安全区。
 */

interface ConfirmSheetProps {
  open: boolean
  title: string
  /** 说清后果 —— "确定吗" 这种问法等于没问 */
  body: string
  confirmLabel: string
  /**
   * 第二个按钮的话。
   *
   * 默认「取消」对**破坏性操作**是对的(删除、清空),因为点它等于「什么都别做」。
   * 但有一类询问不是这个意思 —— 比如「条件调整想让钠变成 1500,你钉的是 1200,
   * 采用吗?」,那里的第二个按钮实际含义是「**保留我的**」。写成「取消」会被
   * 读成「撤销我刚才那次编辑」,而那次编辑已经存下来了。
   */
  cancelLabel?: string
  /** 删除类操作用 danger,会显示成红底 */
  tone?: 'brand' | 'danger'
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = '取消',
  tone = 'brand',
  onConfirm,
  onClose,
}: ConfirmSheetProps) {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
        aria-label="关闭"
      />

      <div className="animate-sheet-up absolute bottom-0 left-0 flex w-full flex-col rounded-t-[24px] bg-[#FAFAFC] px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] backdrop-blur-2xl">
        <div className="flex h-[11px] items-center justify-center">
          <div className="h-[5px] w-9 rounded-full bg-faint" />
        </div>

        <div className="flex flex-col gap-1 px-1 pt-2 pb-4">
          <span className="text-[16px] leading-[22px] font-bold text-ink">{title}</span>
          <span className="text-[13px] leading-[19.5px] text-muted">{body}</span>
        </div>

        <div className="flex flex-col gap-2">
          <PrimaryButton
            icon="check"
            tone={tone}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </PrimaryButton>

          <button
            onClick={onClose}
            className="flex h-12 w-full items-center justify-center rounded-[14px] bg-card text-[16px] leading-[20px] font-medium text-ink active:bg-black/[0.04]"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
