import { birthYearRange, clampDay, daysInMonth } from '../lib/age'
import { BODY_FIELDS, BODY_LIMITS, MONTH_LIMITS, type BodyValues } from '../store/types'
import { WHEEL_ITEM_H, Wheel } from './ui'

/**
 * 数字选择 —— 底部升起的一张滚轮面板。出生日期 / 身高 / 体重。
 *
 * 它只有一半,另一半是那一行
 * ------------------------------------------------------------
 * 面板**没有自带的行**:上面那行用 `ListRow`(`ui/index.tsx`),也就是档案页、
 * 「我的」页那些行用的同一个组件 —— `h-11`、`px-4`、标签在左值在右。
 * 体征那三行要和同一张卡里的「称呼」「性别」长得一样,而它们本来就该是
 * 全 App 的同一套行;另写一行只会在两处各漂一点。
 *
 * 为什么轮子不常驻
 * ------------------------------------------------------------
 * 五行的轮子是 180pt,三行排下来就是 540pt —— 那张卡会变成一根柱子,
 * 而它上面还有称呼、性别,下面还有三步的进度。所以常驻的是**值**,
 * 轮子按需弹出来。这也是 iOS 表单的做法:日期、时长这类字段平时就是一行。
 *
 * 改了就生效,没有「取消」
 * ------------------------------------------------------------
 * 滚轮停下来就把值交出去(`onChange` 直接落到草稿上),所以这张面板没有
 * 「取消」可给 —— 写一个「取消」等于骗人:它关掉面板,却不会把值退回去。
 * 出口只有「完成」和点背景,两扇门做的是同一件事。
 */

/** 一列滚轮的规格 */
export interface WheelColumn {
  /** 读屏名 —— 「出生年」和「出生月」必须分得开 */
  label: string
  value: number
  limits: { min: number; max: number; step: number }
  /** 只进 aria-valuetext */
  unit?: string
  /** 每一行画成什么文本。默认就是数字 */
  format?: (v: number) => string
  onChange: (next: number) => void
}

/**
 * 滚轮面板 —— 从底部升起,`z-50`。
 *
 * `z-50` 不是随手写的:它要能盖在「编辑档案」那张面板(`z-40`)上面,
 * 而体征那三行就在那张面板里。
 *
 * 一列还是几列由 `columns` 的长度决定,面板自己不关心 —— 出生日期是
 * 年、月、日三列并排,身高体重是一列。
 */
export function PickerSheet({
  open,
  label,
  columns,
  onClose,
}: {
  open: boolean
  label: string
  columns: WheelColumn[]
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="absolute inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <button
        className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/40"
        onClick={onClose}
        aria-label="关闭"
      />

      <div className="animate-sheet-up absolute bottom-0 left-0 flex w-full flex-col rounded-t-[24px] bg-[#FAFAFC] pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] backdrop-blur-2xl">
        <div className="flex h-[11px] items-center justify-center">
          <div className="h-[5px] w-9 rounded-full bg-faint" />
        </div>

        <div className="flex items-center justify-between px-4 pt-1 pb-2">
          {/* 左边空着也要占位,否则标题会被右边那个「完成」挤歪 */}
          <span className="w-[38px]" aria-hidden="true" />
          <span className="text-[15px] leading-[21.72px] font-medium text-ink">{label}</span>
          <button
            onClick={onClose}
            className="w-[38px] text-right text-[15px] leading-[21.72px] font-medium text-brand-deep active:opacity-60"
          >
            完成
          </button>
        </div>

        <div className="relative flex">
          {/*
            选中框只有**一条**,横跨所有列。每列各画一块的话,出生年月那两个
            轮子中间会断开成两个方块,看起来像两个控件;一条通到底才是 iOS
            日期轮盘的样子(见 Wheel 顶上那段)。
          */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-[10px] bg-black/[0.04]"
            style={{ height: WHEEL_ITEM_H }}
          />
          {columns.map((c) => (
            <Wheel
              key={c.label}
              label={c.label}
              value={c.value}
              limits={c.limits}
              unit={c.unit}
              format={c.format}
              onChange={c.onChange}
              className="flex-1"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * 体征那一行的滚轮面板 —— 把「哪一行」翻译成一组列。
 *
 * 引导和编辑档案两处都用它,于是「出生日期是三个轮子、身高体重是一个」
 * 这件事只写了一遍。
 *
 * 值按 `Partial<BodyValues>` 补丁交回去(而不是「字段 + 值」两个参数):
 * 两处的草稿形状不同(引导直接用 `Profile`,编辑面板用自己那份 `Draft`),
 * 而补丁对两者都是同一句话 —— `{ ...draft, ...patch }`。
 */
export function BodyPicker({
  field,
  value,
  onChange,
  onClose,
}: {
  field: (typeof BODY_FIELDS)[number]['key']
  value: BodyValues
  onChange: (patch: Partial<BodyValues>) => void
  onClose: () => void
}) {
  if (field === 'birth') {
    const { year, month, day } = value.birth
    const years = birthYearRange()
    return (
      <PickerSheet
        open
        label="出生日期"
        onClose={onClose}
        columns={[
          {
            label: '出生年',
            value: year,
            limits: { ...years, step: 1 },
            unit: '年',
            onChange: (v) => onChange({ birth: clampDay({ ...value.birth, year: v }) }),
          },
          {
            label: '出生月',
            value: month,
            limits: MONTH_LIMITS,
            unit: '月',
            /* 画成「3月」:三列都是数字时,光看轮子分不出哪列是年哪列是月 */
            format: (m) => `${m}月`,
            onChange: (v) => onChange({ birth: clampDay({ ...value.birth, month: v }) }),
          },
          {
            label: '出生日',
            /* 「日」那一列的上界随年月变(2 月 28/29 天,小月 30 天) */
            limits: { min: 1, max: daysInMonth(year, month), step: 1 },
            value: day,
            unit: '日',
            onChange: (v) => onChange({ birth: { ...value.birth, day: v } }),
          },
        ]}
      />
    )
  }

  const limits = BODY_LIMITS[field]
  const label = BODY_FIELDS.find((f) => f.key === field)!.label
  return (
    <PickerSheet
      open
      label={label}
      onClose={onClose}
      columns={[
        {
          label,
          value: value[field],
          limits,
          unit: limits.unit,
          onChange: (v) => onChange({ [field]: v } as Partial<BodyValues>),
        },
      ]}
    />
  )
}
