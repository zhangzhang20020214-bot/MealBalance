import { useState } from 'react'
import { addProfile, deleteProfile, switchProfile, useAppState } from '../store/store'
import { ageOf, type Profile } from '../store/types'
import { Icon } from './Icons'
import { ConfirmSheet } from './ConfirmSheet'
import { PrimaryButton } from './ui'

/**
 * 切换 / 新建 / 删除档案 —— 底部面板。
 *
 * ⚠️ 这一屏**原型里也没有**。设计稿的档案页只有一张「当前档案」深色卡,
 * 而那一页的副标题写着「膳食分析基于当前档案生成」—— 有「当前」就该有
 * 「其他」,否则那个词没有意义。
 *
 * 三条设计上的取舍
 * ------------------------------------------------------------
 * 1. **切换会换掉整套日记**(已确认的决定:每个档案一条独立日记)。
 *    所以每一行都要把记录条数写出来 —— 点一下换掉的是什么,得看得见。
 * 2. **新建不自动切过去。** 从面板里点「新建」紧接着就换掉日记,是把一次
 *    误触的代价放大成一整套日记换人。新建完停在列表里,用户自己决定。
 * 3. **唯一那个档案也能删,但后果要说出来。** 原来这里只在 `total > 1` 时给
 *    删除键,理由是「一个档案都不剩的状态里 `AppState.profile` 没东西可指」。
 *    现在 store 换了个答法:删掉最后一个 = 退回未建档,`onboarded` 翻回 false,
 *    路由表随之换回建档引导(见 store.ts 的 `deleteProfile`)。
 *    于是用户点的是「删除」、拿到的是「清空重来」—— 那两个词差得很远,
 *    所以确认框在只剩一个档案时会换一句正文,把「这台设备上什么都不剩、
 *    回到最开始那一屏」说明白。
 */

interface ProfileSheetProps {
  open: boolean
  onClose: () => void
}

export function ProfileSheet({ open, onClose }: ProfileSheetProps) {
  const state = useAppState()
  /**
   * 待确认删除的那一条。
   *
   * 存**快照**(名字和条数)而不是只存 id:确认框要在这条档案已经不存在之后
   * 仍然说得清它删的是什么。只存 id 的话,那一行会从标题里消失。
   */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; meals: number } | null>(null)

  if (!open) return null

  const current: Profile = state.profile
  const total = state.profiles.length + 1
  const others = state.profiles
  /** 删的要是最后一个,后果就不是「少一份记录」而是「整台设备清空」 */
  const isLast = total === 1

  const confirmDelete = () => {
    if (pendingDelete) deleteProfile(pendingDelete.id)
    setPendingDelete(null)
  }

  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-label="切换档案">
      <button
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
        aria-label="关闭"
      />

      <div className="animate-sheet-up absolute bottom-0 left-0 flex max-h-[92%] w-full flex-col rounded-t-[24px] bg-[#FAFAFC] backdrop-blur-2xl">
        <div className="shrink-0 pt-2">
          <div className="flex h-[11px] items-center justify-center">
            <div className="h-[5px] w-9 rounded-full bg-faint" />
          </div>
          <div className="flex items-center justify-between px-4 pt-1 pb-1">
            <button
              onClick={onClose}
              className="w-[38px] text-left text-[15px] leading-[21.72px] text-muted active:opacity-60"
            >
              取消
            </button>
            <span className="text-[15px] leading-[21.72px] font-medium text-ink">切换档案</span>
            <span className="w-[38px]" aria-hidden="true" />
          </div>
          <p className="px-4 pb-3 text-[12px] leading-[17.38px] text-muted">
            每个档案有自己的日记和每日目标。切换之后，首页、日记、健康分都会跟着换成另一份记录。
          </p>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          <div className="flex flex-col gap-2">
            {/*
              当前档案排在最前,其余按加入顺序。
              `key` 用 id 而不是下标 —— 下标在删除之后会整体前移,React 会拿旧的
              行状态去配新的行,表现是「删掉第二条,第一条的展开态跳到了第三条」。
            */}
            <ProfileRow
              name={current.name}
              profile={current}
              meals={state.meals.length}
              active
              onDelete={() =>
                setPendingDelete({
                  id: state.activeProfileId,
                  name: current.name,
                  meals: state.meals.length,
                })
              }
            />
            {others.map((slot) => (
              <ProfileRow
                key={slot.id}
                name={slot.profile.name}
                profile={slot.profile}
                meals={slot.meals.length}
                active={false}
                onClick={() => {
                  switchProfile(slot.id)
                  onClose()
                }}
                onDelete={() => setPendingDelete({ id: slot.id, name: slot.profile.name, meals: slot.meals.length })}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => addProfile(`档案 ${total + 1}`)}
            className="mt-2 mb-2 flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-line text-[14px] leading-[19px] font-medium text-brand-deep active:opacity-60"
          >
            <Icon name="plus" size={15} strokeWidth={2.4} />
            新建档案
          </button>

          <p className="px-1 pb-3 text-[11px] leading-[15.93px] text-faint">
            新建的档案<strong>不会自动切过去</strong>，也不会带走过往记录。
          </p>
        </div>

        <div className="shrink-0 px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <PrimaryButton icon="check" onClick={onClose}>
            完成
          </PrimaryButton>
        </div>
      </div>

      {/*
        删除确认叠在这层面板之上(`z-50` 对 `z-40`),不是把本面板关掉再弹。
        这里叠是对的:点「取消」回到列表继续挑,是用户预期里的下一步 ——
        而编辑档案那条路反过来(先关编辑面板再问配额),因为那里下方那层
        已经做完事了,再露出来就是一次「闪回去」。
      */}
      <ConfirmSheet
        open={pendingDelete !== null}
        tone="danger"
        title={`删除「${pendingDelete?.name ?? ''}」？`}
        body={
          isLast
            ? '这是最后一个档案。删掉之后这台设备上就什么都不剩了 —— 会回到最开始那一屏，重新填一遍。'
            : `这个档案的 ${pendingDelete?.meals ?? 0} 条记录会一起删掉，不可撤销。`
        }
        confirmLabel="删除"
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}

/** 一行档案 —— 名字 + 体征 + 记录条数,当前那条打勾 */
function ProfileRow({
  name,
  profile,
  meals,
  active,
  onClick,
  onDelete,
}: {
  name: string
  profile: Profile
  meals: number
  active: boolean
  /**
   * 点这一行 = 切过去。**当前档案不传** —— 点一个已经选中的东西该什么都不做,
   * 而给它一个空实现会让它照样是个可聚焦的按钮,读屏用户听到的是
   * 「按钮, 我的档案, 已选中」却按了没反应。
   */
  onClick?: () => void
  /**
   * 删除键 —— **每一行都有**,包括唯一那一行(删它 = 退回未建档,见文件顶上的
   * 第 3 条)。做成必填而不是可选:可选意味着某一行会没有删除键,而那种
   * 分支现在不存在了,留着只会让人以为还有那种情况。
   */
  onDelete: () => void
}) {
  /*
    这里是**切换档案用的摘要行**,不是档案详情:一行挤了性别、年龄、身高、
    体重四段,再塞一个「1998年3月」只会把它挤成两行。年龄是那个进公式的数,
    留它;出生年月在档案页和编辑面板里都能看到。
  */
  const body = profile.gender
    ? `${profile.gender} · ${ageOf(profile)} 岁 · ${profile.height}cm · ${profile.weight}kg`
    : '还没填基本信息'

  const Main = onClick ? 'button' : 'div'

  return (
    <div className={`flex items-center gap-2 rounded-[12px] px-3 py-2.5 ${active ? 'bg-brand-bg' : 'bg-card'}`}>
      <Main
        onClick={onClick}
        /*
          当前档案不只是「打一个勾」—— 那个勾是装饰性的 SVG,读屏用户听不到。
          `aria-current` 才是「就是这一个」的标准说法,而且它让自检里那条
          「当前档案被打上了标记」有一个**语义**可断言,不必去比 class 名。
        */
        aria-current={active ? 'true' : undefined}
        className={`flex min-w-0 flex-1 items-center gap-3 text-left ${onClick ? 'active:opacity-70' : ''}`}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] leading-[21px] font-medium text-ink">{name || '未命名'}</span>
          <span className="truncate text-[12px] leading-[17.38px] text-muted">
            {body} · {meals} 条记录
          </span>
        </div>
        {/*
          当前档案的勾是**图标位**:它占的地方在所有行上都留着,
          否则有勾的那一行文字会被挤窄,几行看起来参差不齐。
        */}
        {active ? (
          <Icon name="check" size={18} className="shrink-0 text-brand-text" strokeWidth={2.6} />
        ) : (
          <span className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        )}
      </Main>

      <button
        type="button"
        onClick={onDelete}
        aria-label={`删除档案 ${name}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center text-[13px] leading-[18px] text-danger active:opacity-60"
      >
        删除
      </button>
    </div>
  )
}
