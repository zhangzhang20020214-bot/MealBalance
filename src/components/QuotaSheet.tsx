import { useEffect, useState } from 'react'
import { QUOTA_FIELDS, quotaFor, type QuotaKey } from '../store/quota'
import { updateProfile } from '../store/store'
import type { Profile, Quota } from '../store/types'
import { Icon } from './Icons'
import { PrimaryButton, Stepper } from './ui'

/**
 * 手动调整每日目标 —— 底部面板。档案页「营养目标」那张卡里那一行打开的。
 *
 * ⚠️ 这一屏**原型里也没有**。设计稿的档案页把配额画成一组静态网格,
 * 但那个网格是「从基础信息算出来的」,不是用户可以改的。
 *
 * 做这个面板的理由有两条:
 * 1. 配额是这个 App 所有判断的标尺。标尺不可调,档案页就只是一张展示图。
 * 2. 它是演示闭环最直观的一次操作 —— 把钠从 2000mg 调到 1200mg,
 *    同一批餐次记录会立刻从「合格」翻成「超标」,首页健康分跟着掉。
 *    数字确实是算出来的,不是画上去的。
 *
 * ⚠️ **这个面板写的是 `quotaOverrides`,不是 `quota`。**
 *
 * 配额由 `quotaFor(档案)` 算出来(见 store/quota.ts),手工调整是在那个结果上
 * 盖一层覆盖。所以「用户改过哪几项」是一件**存得下来、说得清、也撤得回**的事:
 *   · 改回等于推导值 ⇒ **删掉**那条覆盖(交还给自动计算),而不是钉一个恰好
 *     相等的数 —— 后者在档案改了之后会变成一个说不清来历的常量
 *   · 「高血压要改成 1500,但你自己钉了 1200」这种冲突,靠这张覆盖表才问得出来
 *     (见 quota.quotaAdvice)
 * 之前这里直接写 `updateProfile({ quota })`,那样一来 `quota` 就有了两个来源,
 * 谁也说不清某一个数到底是算出来的还是人定的。
 */

interface QuotaSheetProps {
  open: boolean
  onClose: () => void
  profile: Profile
}

/** 可调的那几项。碳水/脂肪/纤维/饮水保持只读,避免把面板塞成一张体检表 */
const FIELDS = QUOTA_FIELDS.filter((f) => f.adjustable)

export function QuotaSheet({ open, onClose, profile }: QuotaSheetProps) {
  // 面板内先存一份草稿,点保存才写回 —— 中途误触不会立刻改变全 App 的判断
  const [draft, setDraft] = useState(() => pick(profile))

  useEffect(() => {
    if (open) setDraft(pick(profile))
  }, [open, profile])

  if (!open) return null

  /** 本次会话里「自动计算会给出多少」—— 用来判断某一项是不是被盖住了 */
  const auto = quotaFor(profile)
  const overrides = profile.quotaOverrides

  const dirty = FIELDS.some((f) => draft[f.key] !== profile.quota[f.key])

  const save = () => {
    const next: Partial<Quota> = { ...overrides }
    for (const f of FIELDS) {
      // 等于推导值就是「撤回这条覆盖」。上面那段注释解释了这个等号为什么重要
      if (draft[f.key] === auto[f.key]) delete next[f.key]
      else next[f.key] = draft[f.key]
    }
    updateProfile({ quotaOverrides: next })
    onClose()
  }

  /*
    `aria-label` 取的是**面板自己那个可见标题**(「每日目标」),不是打开它的
    那一行的名字。原来写的是「调整每日目标」—— 那是档案页上那一行的旧名字,
    而那一行已经改叫「手动调整」了:留着它,读屏用户听到的是一个页面上不存在
    的名字。无障碍名字和可见标题对齐,是这一行现在唯一站得住的取法。
  */
  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-label="每日目标">
      <button
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
        aria-label="关闭"
      />

      <div className="animate-sheet-up absolute bottom-0 left-0 flex w-full flex-col rounded-t-[24px] bg-[#FAFAFC] backdrop-blur-2xl">
        <div className="pt-2">
          <div className="flex h-[11px] items-center justify-center">
            <div className="h-[5px] w-9 rounded-full bg-faint" />
          </div>

          <div className="flex items-center justify-between px-4 pt-1 pb-1">
            <button onClick={onClose} className="w-[38px] text-left text-[15px] leading-[21.72px] text-muted active:opacity-60">
              取消
            </button>
            <span className="text-[15px] leading-[21.72px] font-medium text-ink">每日目标</span>
            {/* 占位,让标题真正居中 */}
            <span className="w-[38px]" aria-hidden="true" />
          </div>

          <p className="px-4 pb-3 text-[12px] leading-[17.38px] text-muted">
            目标变了，健康分的判定标准会立刻跟着变。这几项改的是「自动算出来的值」，
            改回自动值就等于恢复自动。
          </p>
        </div>

        <div className="flex flex-col gap-1.5 px-4">
          {FIELDS.map((f) => {
            const value = draft[f.key]
            const pinned = overrides[f.key] !== undefined
            return (
              <div key={f.key} className="flex flex-col gap-1.5 rounded-[12px] bg-card px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] leading-[20px] text-ink">{f.label}</span>
                    {f.key === 'sodium' && (
                      <span className="tnum text-[12px] leading-[16px] text-muted">
                        约合食盐 {(value / 1000 / 0.393).toFixed(1)}g
                      </span>
                    )}
                  </div>

                  <Stepper
                    size="md"
                    value={value}
                    step={f.step}
                    min={f.min}
                    max={f.max}
                    ariaLabel={f.label}
                    onChange={(next) => setDraft((d) => ({ ...d, [f.key]: next }))}
                    display={
                      <>
                        {value}
                        <span className="ml-0.5 text-[11px] font-normal text-muted">{f.unit}</span>
                      </>
                    }
                  />
                </div>

                {/*
                  「恢复自动」只在这一项真的被手工盖住时出现。
                  没有它的话,想撤回一次手改必须**心算**出自动值然后一步一步点回去 ——
                  而那个数字在面板里根本不显示。
                */}
                {pinned && (
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, [f.key]: auto[f.key] }))}
                    className="self-start text-[12px] leading-[17.38px] text-brand-deep active:opacity-60"
                  >
                    已手动设置 · 恢复自动值 {auto[f.key]}
                    {f.unit}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-start gap-2 px-4 pt-3 text-[12px] leading-[17.38px] text-faint">
          <Icon name="bulb" size={16} className="mt-px shrink-0" strokeWidth={2} />
          <span>数值按《中国居民膳食指南 2022》的建议区间预设，仅作演示，不构成医学建议。</span>
        </div>

        <div className="px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <PrimaryButton
            icon="check"
            onClick={save}
            className={dirty ? '' : 'pointer-events-none opacity-40'}
          >
            {dirty ? '保存目标' : '未做修改'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

/**
 * 草稿的初始值 —— 直接拷贝**合并后**的 `profile.quota`(推导 + 手改)。
 *
 * 读合并值而不是读推导值,是「重开面板不会看到过时数字」的原因:
 * 少读这一层的话,用户手改成 1200、关掉再打开会看到 2000,像没保存上。
 *
 * 八项全拷而不是只拷可调的四个:类型因此是完整的 `Quota`,
 * `draft[f.key]` 不必处处判 undefined。面板只渲染其中四项。
 */
function pick(profile: Profile): Record<QuotaKey, number> {
  return { ...profile.quota }
}
