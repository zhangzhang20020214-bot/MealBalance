import { Icon, type IconName } from './Icons'

/**
 * 「一条消息能做什么」—— 底部升起的一列操作
 * ===========================================================
 * 对话页每条消息下面那颗「…」按下去弹这个：复制 / 撤回并重新编辑 /
 * 删除本条 / 重试。壳照抄 `ConfirmSheet`（r24 + 抓手条 + 底部安全区），
 * 因为它们是同一类东西：**一次只做一个决定**的底部面板。
 *
 * ## 为什么不复用 `ActionSheet`
 *
 * `ActionSheet` 是**拍照来源表**：它内部带 `picked`（选完之后那张图的预览态），
 * 而对话页已经不用它了（`ChatScreen` 的注释里写着它「只剩死代码」）。
 * 把一个带照片预览状态的组件借来当通用操作表，等于让下一个改拍照流程的人
 * 在毫不知情的情况下去动对话页的菜单。
 *
 * ## 为什么是「每一项一个图标 + 一句话」，不是 `ConfirmSheet` 那种两行文案
 *
 * 这里的选择项之间**没有主次**（复制和删除都是「我想对这条做点什么」），
 * 而 `ConfirmSheet` 的形状是「一个标题 + 一句后果 + 一颗主按钮」——
 * 那是给**一个**决定用的。四个决定塞进那个形状里，主按钮就只能有一个。
 *
 * ## 危险项放在**最后**，而且单独一段
 *
 * 删除是这一列里唯一不可逆的。夹在中间会让「点第 3 行」变成一件需要先读
 * 再点的事，而隔离出来之后，手指落点的肌肉记忆不会把它勾上。
 */

export interface ActionItem {
  icon: IconName
  label: string
  /** 说清这一项会做什么 —— 光一个动词（「删除」）不足以选中正确的那个 */
  hint?: string
  tone?: 'default' | 'danger'
  onSelect: () => void
}

export function ActionListSheet({
  open,
  title,
  items,
  onClose,
}: {
  open: boolean
  /** 这一列是在对**什么**操作 —— 一句能对得上屏幕的话 */
  title: string
  items: readonly ActionItem[]
  onClose: () => void
}) {
  if (!open) return null

  /*
    危险项排到最后并多隔一段。`filter` 出来的顺序**是稳定的**，所以这不是
    「看运气排序」—— 但两组的相对顺序仍然由 `items` 传进来的顺序决定，
    调用方把删除放在哪儿，它就出现在哪儿（这是故意的：排序规则写在数据里，
    比写在渲染里更容易被看见）。
  */
  const normal = items.filter((i) => i.tone !== 'danger')
  const danger = items.filter((i) => i.tone === 'danger')

  const renderRow = (item: ActionItem, last: boolean) => (
    <button
      key={item.label}
      onClick={() => {
        onClose()
        /*
          先关面板再执行。反过来的话，删除这一条会把面板下面那条消息抽走，
          而面板还悬在原地 —— 用户看到的是一个正在指向空处的菜单。
        */
        item.onSelect()
      }}
      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-black/[0.04] ${
        last ? '' : 'border-b border-line'
      }`}
    >
      <Icon
        name={item.icon}
        size={19}
        strokeWidth={1.9}
        className={item.tone === 'danger' ? 'shrink-0 text-danger' : 'shrink-0 text-muted'}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`text-[15px] leading-[21px] ${item.tone === 'danger' ? 'text-danger' : 'text-ink'}`}>
          {item.label}
        </span>
        {item.hint && <span className="text-[12px] leading-[17px] text-muted">{item.hint}</span>}
      </span>
    </button>
  )

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

        {/*
          标题用**这一条消息自己的话**开头（调用方拼好传进来）。
          光写「这条消息」的话，用户得自己回忆刚才点的是哪一条 ——
          而菜单一旦升起来就把它盖住了。
        */}
        <div className="truncate px-1 pt-2 pb-3 text-[13px] leading-[19px] text-muted">{title}</div>

        <div className="overflow-hidden rounded-[14px] bg-card">
          {normal.map((item, i) => renderRow(item, i === normal.length - 1))}
        </div>

        {danger.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-[14px] bg-card">
            {danger.map((item, i) => renderRow(item, i === danger.length - 1))}
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-[14px] bg-card text-[16px] leading-[20px] font-medium text-ink active:bg-black/[0.04]"
        >
          取消
        </button>
      </div>
    </div>
  )
}
