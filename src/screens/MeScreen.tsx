import { useMemo, useState, useSyncExternalStore } from 'react'
import { Screen } from '../components/ios/Screen'
import { Icon } from '../components/Icons'
import { ConfirmSheet } from '../components/ConfirmSheet'
import {
  Avatar,
  Card,
  DarkCard,
  Divider,
  Footnote,
  GroupHeader,
  ListRow,
  PageTitle,
} from '../components/ui'
import { ACCOUNT } from '../data/mock'
import { clearAllMeals, resetToSeed, useAppState } from '../store/store'
import { dismissSaveNotice, getSaveNotice, subscribeSaveNotice } from '../store/persist'

/**
 * 我的 —— 对应 Figma「③ 界面原型 / 04 · 我的 Me」。
 *
 * ⚠️ 本页涉及个人信息的字段(手机号 / 邮箱)全部来自 mock.ts 的占位常量,
 * 设计稿里的真实姓名与手机号**没有**被复制过来。
 * 详见 src/data/mock.ts 顶部的隐私说明。
 *
 * 设计稿这一页全是不可点的行(通知提醒 / 单位制式 / 隐私政策)。那些功能
 * 这个演示版没有实现,照着画一排点不动的箭头反而更容易被当成 bug。
 * 所以保留下真正做了的三项,并补上「数据」一节 —— 面试官看完可以一键复原。
 */
export default function MeScreen() {
  const state = useAppState()
  const [toast, setToast] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'clear' | 'reset' | null>(null)

  /**
   * 写盘失败/降级的提示。
   *
   * 放在这一页而不是做成全局浮层,是因为这里的两个按钮(清空、恢复演示数据)
   * 正好是唯一的自救手段 —— 提示里说「到「我的」里清理旧记录」,
   * 那句话指向的地方就该看得见这句话。
   *
   * 之前 saveState 是静默 catch 一切的:配额写满时用户刚记的一餐**看起来**
   * 存好了,刷新就没了,全程没有任何提示。
   */
  const saveNotice = useSyncExternalStore(subscribeSaveNotice, getSaveNotice, getSaveNotice)

  /**
   * 这一页的统计口径是**全部档案**,不是当前档案。
   *
   * 多档案之前这里只数 `state.meals`,而那正好是全部 —— 现在不是了。
   * 一行写着「全部记录 42 条」却只数了当前那一份,比不写数字更糟:
   * 用户切到另一个档案发现对不上,只会以为记录丢了。
   */
  const stats = useMemo(() => {
    const all = [...state.meals, ...state.profiles.flatMap((p) => p.meals)]
    const days = new Set(all.map((m) => m.date))
    const first = all.reduce<string | null>((min, m) => (min === null || m.date < min ? m.date : min), null)
    return { meals: all.length, days: days.size, since: first, profiles: state.profiles.length + 1 }
  }, [state.meals, state.profiles])

  /** 短暂的反馈条 —— 这两个操作会清掉全屏数据,没有反馈会让人怀疑没生效 */
  const flash = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }

  const handleClear = () => {
    clearAllMeals()
    flash(`已清空「${state.profile.name}」的记录`)
  }

  const handleReset = () => {
    resetToSeed()
    flash('当前档案已恢复成演示数据')
  }

  return (
    <Screen>
      <div className="flex flex-col gap-3.5 px-5 pt-1">
        <header className="flex h-[54px] items-center">
          <PageTitle>我的</PageTitle>
        </header>

        {/* ---------- 存储提示 ---------- */}
        {saveNotice && (
          <div
            className={`flex items-start gap-2 rounded-[14px] border px-3.5 py-2.5 ${
              saveNotice.ok ? 'border-warn-line bg-warn-bg' : 'border-danger-line bg-danger-bg'
            }`}
          >
            <Icon
              name="alertCircle"
              size={16}
              className={`mt-px shrink-0 ${saveNotice.ok ? 'text-warn' : 'text-danger'}`}
              strokeWidth={2}
            />
            <span
              className={`flex-1 text-[12px] leading-[17.38px] ${
                saveNotice.ok ? 'text-warn-body' : 'text-danger-body'
              }`}
            >
              {saveNotice.message}
            </span>
            <button
              onClick={dismissSaveNotice}
              className="shrink-0 text-[12px] leading-[17.38px] text-muted active:opacity-60"
            >
              知道了
            </button>
          </div>
        )}

        {/* ---------- 账户卡(深色)---------- */}
        <DarkCard className="flex items-center gap-3.5">
          <Avatar />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[17px] leading-[20.4px] font-bold text-white">{ACCOUNT.nickname}</span>
            <span className="truncate text-[12px] leading-[17.38px] text-white">
              已绑定手机号 {ACCOUNT.phone}
            </span>
          </div>
          <span className="inline-flex h-6 shrink-0 items-center rounded-[12px] bg-white/12 px-2.5 text-[11px] leading-[13.2px] font-medium text-brand">
            {ACCOUNT.plan}
          </span>
          <Icon name="chevronRight" size={16} className="shrink-0 text-white" strokeWidth={2.2} />
        </DarkCard>

        {/* ---------- 账户与个人信息 ---------- */}
        <Card>
          <GroupHeader>账户与个人信息</GroupHeader>
          <ListRow label="昵称" value={ACCOUNT.nickname} />
          <Divider />
          {/* 邮箱走 secondary 样式:小号灰字 */}
          <ListRow label="邮箱" value={ACCOUNT.email} secondary />
          <Divider />
          <ListRow label="当前档案" value={`${state.profile.name}（共 ${stats.profiles} 个）`} secondary />
        </Card>

        {/* ---------- 数据(真实可用的操作)---------- */}
        <Card>
          <GroupHeader>数据 · 全部档案</GroupHeader>
          <ListRow label="餐次记录" value={`${stats.meals} 条`} />
          <Divider />
          <ListRow label="记录天数" value={`${stats.days} 天`} />
          {stats.since && (
            <>
              <Divider />
              <ListRow label="最早一条" value={stats.since} secondary />
            </>
          )}
          {/*
            下面两个按钮**只作用于当前档案**(已确认的决定)。
            所以文案必须点名是哪一个 —— 原来写的是「清空所有记录」,
            多档案之后那句话要么变成谎话,要么变成一个大家不敢按的按钮。
          */}
          <GroupHeader>只作用于「{state.profile.name}」</GroupHeader>
          <ListRow
            label="恢复为演示数据"
            right={<span className="text-[13px] leading-[15.6px] text-muted">基本资料一起换</span>}
            chevron
            onClick={() => setConfirming('reset')}
          />
          <Divider />
          <ListRow
            label="清空当前档案的记录"
            right={<span className="text-[13px] leading-[15.6px] font-medium text-danger">不可撤销</span>}
            chevron
            onClick={() => setConfirming('clear')}
          />
          <Footnote className="pt-3 pb-1">
            记录保存在这台设备的浏览器里(localStorage)，不会上传到任何服务器。
            换设备或清理浏览器数据后记录会消失。
          </Footnote>
        </Card>

        {/* ---------- 关于 ---------- */}
        <Card className="pb-3">
          <GroupHeader>关于</GroupHeader>
          <ListRow label="版本号" value="v1.0.0" />
          <Divider />
          <ListRow label="食物数据" value="演示用近似值" />
          <Footnote className="pt-3 pb-1">
            食衡不是医疗器械，不做诊断、不开处方。饮食建议仅供参考，不替代专业医生诊疗。
            食物成分表为演示用近似值，未经逐条核对，不适用于真实的营养决策。
          </Footnote>
        </Card>
      </div>

      {/* 两个会清掉全屏数据的操作,都得先问一句 —— 而且都要点名是哪个档案 */}
      <ConfirmSheet
        open={confirming === 'clear'}
        tone="danger"
        title={`清空「${state.profile.name}」的记录？`}
        body={`当前档案的 ${state.meals.length} 条记录会被删除，首页与日记归零。其他档案的记录不受影响。`}
        confirmLabel="清空"
        onConfirm={handleClear}
        onClose={() => setConfirming(null)}
      />
      <ConfirmSheet
        open={confirming === 'reset'}
        title={`把「${state.profile.name}」换成演示档案？`}
        body="当前档案会连同基本资料一起恢复成一份 14 天的演示数据 —— 自己填的目标、特殊时期、慢性病和忌口都会跟着没。其他档案不受影响。"
        confirmLabel="恢复"
        onConfirm={handleReset}
        onClose={() => setConfirming(null)}
      />

      {/* 操作反馈 */}
      {toast && (
        <div className="pointer-events-none absolute bottom-[calc(110px+env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2">
          <div className="animate-fade-in rounded-full bg-ink/92 px-4 py-2 text-[13px] leading-[18px] text-white shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </Screen>
  )
}
