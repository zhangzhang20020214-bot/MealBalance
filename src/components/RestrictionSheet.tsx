import { useEffect, useState, type ReactNode } from 'react'
import { updateProfile } from '../store/store'
import {
  RESTRICTION_LEVELS,
  defaultRestriction,
  findRestrictionDupe,
  hardBlocks,
  mergeRestrictions,
  restrictionLevel,
  restrictionLabel,
  restrictionSection,
  restrictionSectionShape,
  restrictionSuffixSuggestion,
  restrictionTypeOptions,
  tabooPresetChips,
  tabooPresetRestriction,
  type Profile,
  type Restriction,
  type RestrictionLevel,
  type RestrictionSection,
  type RestrictionType,
} from '../store/types'
import { Icon } from './Icons'
import { PrimaryButton, SegmentedControl, TextField } from './ui'

/**
 * 忌口与过敏 —— 底部面板。**同一个面板,两段。**
 *
 * ⚠️ 这一屏**原型里也没有**。设计稿的「健康限制」是一段只读列表,而它是整个
 * App 里**唯一一处会让 agent 拒绝回答**的输入:一条「花生过敏」会让工作流的
 * 过敏原拦截节点吃掉一道含花生的菜。一份写不动、改不了的拦截规则,在演示里
 * 说不通 —— 而且原型里那条「花生过敏」是硬编码在演示档案里的。
 *
 * 为什么分两段,而不是一个列表
 * ------------------------------------------------------------
 * 档案页上它们是两个入口(「过敏与用药」/「忌口」),用户的原话是
 * 「忌口属于饮食,过敏属于健康」。
 *
 * ⚠️ 分段的判据**只在 `RESTRICTION_SECTIONS` 里有一份,这里一个字都不许再写**。
 * 漏掉一个类型等于:那一行在两张卡里都不出现 —— 用户再也看不到、也永远改不了,
 * 可它照样随档案发给工作流、照样拦菜。这个仓库里最坏的一类失败(不报错、看不
 * 出来),所以宁可全部从那张表派生。
 *
 * **⚠️ 这个面板里的每一类都会拦菜(2026-09-22 傍晚起)。**
 * 判据一天之内换了三次,三代并排放在这里 —— 前两代都不删,因为它们各自
 * 解释了一处今天看起来「多余」的代码:
 *
 *   第一代(上午):会不会拦菜  →  拦得住的写这个面板,拦不住的写「饮食偏好」
 *   第二代(下午):具体食物 / 整体模式
 *     具体食物 · 不想要  →  这个面板(能拦的选「忌口」,只是不爱吃的选「不爱吃」)
 *     具体食物 · 喜欢    →  「饮食偏好」    整体怎么吃 →  「饮食偏好」(素食、清真)
 *   第三代(傍晚,现行):喜欢吃的 / 不想吃的 —— 用户的原话是
 *     「不吃折耳根归忌口,偏好只记喜欢吃的」
 *     不想吃的(具体食物,或「素食」这种一整类) →  这个面板
 *     喜欢吃什么                                →  「饮食偏好」
 *     口味轻重 / 健康目标                        →  「饮食目标」
 *
 * 于是饮食段里**只剩 `taboo` 一个类型**、它参与拦截,「一律会被拦」这句话
 * 今天**是真的**。下午那版在这儿写的是「有的是会拦、有的不拦」—— 那句话作废。
 * 判据仍然只在 `hardBlocks()` 里有一份,不在这儿重写。
 *
 * 每一段都只有一件事要说:**存裸词**。工作流判命中的写法是
 * `if item in haystack`,所以存的是「花生」而不是「花生过敏」。
 *
 * ⚠️ 选择器**只给本段的那些类型**,而且**只剩一个类型时整个不给选择器**。
 * 这个闸**今天真的在用**(饮食段只有一个类型)—— 它上一轮是空转的,
 * 现在反过来:一个只有一个按钮的分段控件是一个没有选择的选择器。
 * 给全套的坏处照旧:用户改一下类型,那一行当场跳到另一张卡里去,他会以为
 * 自己弄丢了它。
 *
 * ⚠️ `section` 是必填、**不给默认值** —— 有默认值调用方就会忘,而忘了的表现是
 * 两个入口打开同一个东西。
 */

interface RestrictionSheetProps {
  open: boolean
  onClose: () => void
  /** 这一段是谁 —— 决定标题、选择器给什么、保存时只动哪些行 */
  section: RestrictionSection
  profile: Profile
}

/** 草稿里每一条的行内编辑器 —— `open` 的那个展开,其余收起来 */
interface DraftRow extends Restriction {
  /** 这一条是这次新加的(还没存过),用来决定「删除」的措辞 */
  isNew?: boolean
}

/**
 * 只把**本段**的条目装进草稿。
 *
 * ⚠️ 这个过滤就是保存那一步必须走 `mergeRestrictions` 的原因:草稿不再等于
 * 整份 `restrictions`,直接写回去会把另一段的行一起删掉(见 `save`)。
 */
function toDraft(p: Profile, section: RestrictionSection): DraftRow[] {
  return p.restrictions.filter((r) => restrictionSection(r) === section).map((r) => ({ ...r }))
}

export function RestrictionSheet({ open, onClose, section, profile }: RestrictionSheetProps) {
  const [draft, setDraft] = useState<DraftRow[]>(() => toDraft(profile, section))
  /** 展开着的那一条的下标。null = 全部收起 */
  const [editing, setEditing] = useState<number | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(toDraft(profile, section))
      // 打开时不展开任何一条:先让用户看见「现在有什么」,
      // 一进来就是编辑态会让人以为必须改点什么才能关
      setEditing(null)
    }
    /*
      ⚠️ `section` 必须在依赖里。少了它,从「过敏与用药」换到「忌口」
      (两个面板实例轮流打开)时 `editing` 不会归零 —— 用户会带着上一段的
      展开下标进来,而那个下标在新的一段里指向**另一条**忌口,于是它莫名其妙
      自己展开着。
    */
  }, [open, section, profile])

  if (!open) return null

  const shape = restrictionSectionShape(section)

  /*
    ⚠️ 这里那句特判(`if (next.type === 'preference') next.level = '低危'`)在
    `preference` 删掉时就跟着删了,中间 `dislike` 来过一次又走了 —— 它**不需要
    回来**,因为「等级」这件事整个搬进了 `restrictionLevel()`:

      改类型时:草稿里的 `level` 不动(用户看不见它,改它没有意义)
      保存时:  `save()` 统一过一遍 `restrictionLevel()` 收口

    这样判据只有一份,而且**保存是必经之路** —— 特判写在 `setRow` 里的话,
    有两条路绕得过去:新加一行直接保存(从没切过类型)、以及用户把类型切过去
    又切回来。两条都会存下一个等级不对的行。

    ⚠️ 以后再往 `RestrictionType` 里加类型,先问一遍:新类型有没有严重程度?
    没有的话把 `hardBlocks` 那张表更新掉就够了,三处显示和保存会自动跟着走 ——
    但**别只把等级那一栏藏起来**:等级是**会随档案发给食衡**的
    (`agentContext` 把它写成 `severity`),默认值是「高危」,于是模型会读到
    一句**假的警报**,而界面上一个字都看不出来。
    (加 `dislike` 那次正是这么做的,半天之后它整个被删掉了 —— 这段留着,
     因为它说的是**下一次加类型时**该怎么走,与 `dislike` 在不在无关。)
  */
  const setRow = (i: number, patch: Partial<Restriction>) =>
    setDraft((d) =>
      d.map((r, j) => (j === i ? { ...r, ...patch } : r))
    )

  const removeRow = (i: number) => {
    setDraft((d) => d.filter((_, j) => j !== i))
    setEditing(null)
  }

  const addRow = () => {
    // 默认类型按段取 —— 写死 'allergy' 的话,饮食段新加的行会带着一个不在
    // 选项里的类型进来(选择器上没有任何一个按钮是选中的,方向键也失效),
    // 存下去之后还会当场跳回另一张卡
    setDraft((d) => [...d, { ...defaultRestriction(section), isNew: true }])
    setEditing(draft.length)
  }

  /*
    预设胶囊:点一下加一条,**不展开**。

    和「添加一条」的区别是这条路的**意图已经很明确了** —— 用户点的是「素食」这颗
    按钮,不是「我要改点什么」。加完那一行就在列表里,想改点它一下就是了。
    (展开的话还会把上面那条挤下去,用户点第二颗胶囊时得先找它在哪。)

    `taken` 的那几颗在界面上是 disabled 的,所以这里不会撞上查重。
  */
  const addPreset = (word: string) => {
    setDraft((d) => [...d, { ...tabooPresetRestriction(word), isNew: true }])
  }

  /*
    保存前的两道闸。

    这两条都不是洁癖,是两个**静默失效**:
      · 空的 `item` 会发成一个空字符串,`"" in haystack` 恒为 True ——
        也就是**每一道菜都被拦下来**,而用户以为自己只是没填完。
      · 同一个词两条,若 type 不同(「花生」过敏 + 「花生」忌口),拦截侧看到
        的是两条同 item 的记录,取哪一条看它怎么遍历 —— 大概率取到松的那条。
    所以宁可挡在保存上,也不让一份自相矛盾的规则存进去。
  */
  const blank = draft.some((r) => r.item.trim().length === 0)

  /*
    查重的判据在 `findRestrictionDupe` 里(store 的纯函数),这里只负责把两样
    东西递进去 —— 判据留在这儿的话,它只在某一行展开时才渲染,而展开是**组件
    内部状态**,静态 SSR 够不着,一条断言都看不见它(和 `restrictionSuffixSuggestion`
    同一个理由)。
  */
  const dupe = findRestrictionDupe(profile.restrictions, draft, section)

  /* 那排预设胶囊各自的「加过了没有」。给错段时是空数组(判据在 store 里) */
  const presetChips = tabooPresetChips(section, draft)

  const save = () => {
    /*
      ⚠️ `level` 走 `restrictionLevel()` 收口,**不是**直接把草稿里那个值存下来。

      ⚠️ **这一句今天是一句恒等变换**(三种类型都拦,等级原样保留),留着是
      因为上面 `restrictionLevel` 那条理由今天仍然成立、而且它**昨天刚用上过**:
      下午存在「不爱吃」那一类时,它的 `level` 默认值是「高危」,用户新建一条
      一个字不改直接保存就存下「高危」—— 界面上看不出来(那一栏本来就藏着),
      但 `agentContext` 把它写成 `severity: "high"` 随档案发给食衡,模型读到的
      是一句**假的警报**。

      `restrictionLevel()` 把「不拦的类型没有严重这一说」定成一条判据,
      这里只是它的必经之路。判据在 `store/types.ts`,不在这个组件里 ——
      所以下一次真出现一个不拦的类型时,这一行不用改就跟着走。
    */
    const cleaned = draft.map(({ item, type, level }) => ({
      item: item.trim(),
      type,
      level: restrictionLevel({ item, type, level }),
    }))
    /*
      ⚠️ **按位合并,不是整条覆盖。** 草稿只装本段的条目,而 `updateProfile`
      换的是整个 `restrictions` 数组 —— 写成 `restrictions: cleaned` 的话,在
      「过敏与用药」里点保存会把「忌口」那几条**一起删掉**,落盘、不报错、
      连灰都不灰一下。

      也不许改成「本段接在末尾」:不属于本段的行要留在**原来的位置**。顺序上游
      看得见 —— `agentContext.ts` 是按数组序发 `healthRestrictions` 的。
    */
    updateProfile({ restrictions: mergeRestrictions(profile.restrictions, cleaned, section) })
    onClose()
  }

  return (
    <div className="absolute inset-0 z-40" role="dialog" aria-modal="true" aria-label={shape.entry}>
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
            <span className="text-[15px] leading-[21.72px] font-medium text-ink">{shape.entry}</span>
            <span className="w-[38px]" aria-hidden="true" />
          </div>
          {/*
            这段话是这一屏存在的理由。不说的话,用户会把「花生过敏」四个字一起
            填进来 —— 而工作流做的是 `"花生过敏" in "我吃了花生"`,是 False。
            过敏原拦截在最该触发的时候不触发,且不报错。

            两段的措辞在**同一个地方分岔**,分岔点只有一处:这一段自己的后果。
            饮食段那句原来是「『少辣』这类不拦的话写在上面『饮食偏好』里」——
            **删掉了**,两处都不对:判据换过之后「少辣」该在「饮食目标」里
            (它是口味轻重,不是具体食物)。**不做跨格指路**:「饮食目标」和
            「饮食偏好」各自那排胶囊就是自己的说明书,在这一屏再指一次,
            指错了反而更糟。

            下午那版在这句后面还挂过一句「不爱吃只记下来告诉食衡,不拦」——
            删掉:没有「不爱吃」这个类型了,这一段里每一类都拦。
          */}
          <p className="px-4 pb-3 text-[12px] leading-[17.38px] text-muted">
            {section === 'health' ? (
              <>
                这里填<strong>食物本身</strong>（「花生」而不是「花生过敏」）—— 食衡会拿这个词逐道菜核对，
                命中就拦下来。过敏和用药禁忌都在这条线上。
              </>
            ) : (
              <>
                这里填<strong>食物本身</strong>（「香菜」而不是「不吃香菜」）—— 忌口会被逐道菜核对，
                命中就拦下来。素食、清真这类一整类的说法也填这儿。
              </>
            )}
          </p>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {/*
            空态就是一句「无」,和档案页那一组的空态是同一个词、同一个颜色。

            这里原来是一张卡片:一个感叹号图标 + 「还没有填任何忌口」。**这个
            感叹号是错的** —— 一条忌口都没有是一份完全正常的档案,不是出了什么
            要提醒的事;把它画成警告,等于替用户判定「你应该填点什么」。而且
            「还没有」三个字在暗示一个他可能根本不打算完成的状态。

            形状跟着行来(和下面每一条忌口同一张圆角卡),所以它读起来是
            「这个列表现在是空的」,而不是一条提示。
          */}
          {draft.length === 0 && (
            <div className="flex h-12 items-center rounded-[12px] bg-card px-4">
              <span className="text-[13px] leading-[18px] text-muted">无</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {/*
              这里用下标当 key 是可以的,而 `ProfileSheet` 那边的列表就不能 ——
              区别在于「谁持有状态」:这一屏只有**谁展开着**一个状态,而且它在
              父组件里(`editing`)、删除时会被清掉;每一行的内容全部由 draft
              重新算出来,没有藏在 DOM 里的东西。档案列表那边的行是带 id 的
              实体,用下标就会在删除之后把状态配到错的行上。
            */}
            {draft.map((r, i) => (
              <Row
                key={i}
                row={r}
                section={section}
                open={editing === i}
                label={r.item.trim() ? restrictionLabel(r) : '未填写食物'}
                onToggle={() => setEditing(editing === i ? null : i)}
                onChange={(patch) => setRow(i, patch)}
                onRemove={() => removeRow(i)}
              />
            ))}
          </div>

          {/*
            ⚠️ 预设胶囊在「添加一条」**上方**:它们是一键版的「添加一条」,
            排在它下面的话读起来像是列表的补充说明。

            哪些词、哪些已经加过,全部从 `tabooPresetChips` 来 —— 判据不在这个
            组件里(它够不着断言,见上面 `setRow` 那段)。给错段时那个函数返回空数组,
            所以健康段这一块整个不渲染,不需要在这里写 `section === 'diet'`。

            置灰那几颗用 `disabled` + `opacity-40`,和保存键置灰同一个观感。
          */}
          {presetChips.length > 0 && (
            <div className="mt-2 mb-1 flex flex-wrap gap-1.5">
              {presetChips.map(({ word, taken }) => (
                <button
                  key={word}
                  type="button"
                  disabled={taken}
                  onClick={() => addPreset(word)}
                  className={`flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] leading-[18px] font-medium ${
                    taken
                      ? 'border-line text-faint opacity-40'
                      : 'border-brand-line text-brand-deep active:opacity-60'
                  }`}
                >
                  {!taken && <Icon name="plus" size={12} strokeWidth={2.6} />}
                  {word}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={addRow}
            className="mt-2 mb-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-line text-[14px] leading-[19px] font-medium text-brand-deep active:opacity-60"
          >
            <Icon name="plus" size={15} strokeWidth={2.4} />
            添加一条
          </button>
        </div>

        {/*
          两道闸的提示。措辞不一样,因为要用户做的事不一样 ——
          「没填完」和「填重了」是两种不同的手误;而「填重了」还分两种:
          自己这一段里重了(删一条就行),和撞上了另一段(得先想清楚它到底算
          哪一类)。后者的名字不能省 —— 那一行在**另一张卡**里,用户在眼前
          这一屏上是看不见它的。
        */}
        {(blank || dupe) && (
          <p className="shrink-0 px-4 pb-1 text-[12px] leading-[17.38px] text-danger">
            {dupe
              ? dupe.entry
                ? `「${dupe.word}」在「${dupe.entry}」里已经有一条 —— 同一个词只能算一类`
                : `「${dupe.word}」填了两条，只留一条就够`
              : '每条都要填上具体的食物'}
          </p>
        )}

        <div className="shrink-0 px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <PrimaryButton
            icon="check"
            onClick={save}
            className={!blank && !dupe ? '' : 'pointer-events-none opacity-40'}
          >
            {/*
              「不填××」那句取的是**这一段**的名字(`shape.entry`),不是任何一个
              写死的词 —— 健康段是「不填过敏与用药」。拿一个下位词当整段的名字
              (比如给健康段写「不填忌口」)在那一屏上就是错的。
            */}
            {draft.length === 0 ? `不填${shape.entry}` : '保存'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

/**
 * 一条忌口 —— 收起时是一行,点开变成一个行内编辑器。
 *
 * 编辑**行内展开**而不是再叠一层面板:第二层面板盖在第一层上,关掉之后
 * 下面那层还开着,用户看到的是「闪回去」;而且两层都有抓手条和取消键,
 * 关哪一个都不明显。
 */
function Row({
  row,
  section,
  open,
  label,
  onToggle,
  onChange,
  onRemove,
}: {
  row: DraftRow
  section: RestrictionSection
  open: boolean
  label: string
  onToggle: () => void
  onChange: (patch: Partial<Restriction>) => void
  onRemove: () => void
}) {
  const item = row.item.trim()
  /*
    用户在框里连「过敏」两个字一起打了。这是**最常犯**的一种填法,而且后果
    是静默的(拦截不生效),所以不能只在上面写一句说明就完事 ——
    要在他正打字的时候指出来,并给一个一键改掉的动作。
    改写是显式的:点了才变,面板不会偷偷动用户填的字。

    判据是 store 里的纯函数,不是这里的一段 `endsWith`:那个提示卡只在某一行
    展开时才渲染,而展开是**组件内部状态**,静态 SSR 够不着 —— 放在这里就
    永远没有断言看得见它(那个「查了过滤后的表 → 后缀变空串 → 提示卡静默
    消失」的 bug 就是这么来的)。
  */
  const tail = restrictionSuffixSuggestion(item, row.type)

  return (
    <div className="overflow-hidden rounded-[12px] bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-12 w-full items-center gap-2 px-4 text-left active:bg-black/[0.03]"
      >
        <span className={`min-w-0 flex-1 truncate text-[15px] leading-[22px] ${item ? 'text-ink' : 'text-faint'}`}>
          {label}
        </span>
        {/* 收起时也显示等级 —— 和展开态那一栏是同一个值,收起时藏掉的话
            用户得逐条点开才能比较哪条更严重。

            ⚠️ `hardBlocks(row.type)` 这个闸**今天恒真**(三种类型全在硬拦截表里),
            留着是因为它上午死过一次、下午又活过来、傍晚再死 —— 一天三次。
            删掉它的代价在半天之内被验证过两回,留着的代价是零。

            它保的是下一次:真出现一个**不拦**的类型时,「折耳根不爱吃　低危」是一句
            自相矛盾的话(「低危」听起来像「有一点风险」,而真相是「零」),收起行、
            展开态那一栏、档案页那一行会**同时**按这个闸收口 —— 三处一个判据。 */}
        {item && hardBlocks(row.type) && <LevelText level={row.level} />}
        {/* 图标集里只有左右两个箭头,展开态用旋转 —— 为这一个地方加一个
            chevronUp 出来,等于把「同一个箭头」画两遍 */}
        <Icon
          name="chevronRight"
          size={16}
          className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`}
          strokeWidth={2.2}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-3 pt-3 pb-3.5">
          <div className="rounded-[10px] bg-white">
            <TextField
              label="食物"
              value={row.item}
              onChange={(v) => onChange({ item: v })}
              placeholder="如「花生」「牛奶」"
              maxLength={10}
            />
          </div>

          {tail && (
            <button
              type="button"
              onClick={() => onChange({ item: tail })}
              className="flex items-start gap-1.5 rounded-[10px] bg-warn-bg px-3 py-2 text-left active:opacity-70"
            >
              <Icon name="alertCircle" size={14} className="mt-px shrink-0 text-warn" strokeWidth={2.2} />
              <span className="text-[12px] leading-[17px] text-warn-body">
                存成「{item}」会拦不住 —— 匹配的是菜名里的词。改成「{tail}」？
              </span>
            </button>
          )}

          {/*
            ⚠️ **只有一个类型时不给选择器。** 判据取
            `restrictionTypeOptions(section).length`,**不写 `section === 'diet'`**。

            **这个闸今天真的在用**:饮食段删掉「不爱吃」之后只剩 `taboo` 一个类型,
            没有它这儿就会渲染出一个只有一个按钮的分段控件(点不动、还占一行)。
            上一轮饮食段有两个类型时它空转 —— 反过来了。

            label 那半句同理:健康段那句是手写的(「过敏」和「用药禁忌」在这儿要短说),
            饮食段取**派生**的 —— 免得下一次往饮食段加类型时,这里还挂着一个
            已经删掉的旧词。
          */}
          {restrictionTypeOptions(section).length > 1 && (
            <Field
              label={
                section === 'health'
                  ? '算过敏还是用药'
                  : `算${restrictionTypeOptions(section).map((o) => o.label).join('还是')}`
              }
            >
              {/*
                ⚠️ 只给本段的那些。给全套的话,改一下类型那一行就当场跳到另一张卡
                里去;而**只给本段之后,选中的那个值必须真的在选项里** ——
                `SegmentedControl` 的 `options.findIndex` 拿不到就返回 -1,方向键
                直接失效,而且没有任何一个按钮拿到 `tabIndex={0}`,整组 Tab 都进
                不去、也看不出选中了什么。所以新行的默认值也必须按段取
                (见 `defaultRestriction`)。
              */}
              <SegmentedControl
                size="lg"
                label="限制类型"
                value={row.type}
                onChange={(v: RestrictionType) => onChange({ type: v })}
                options={restrictionTypeOptions(section)}
              />
            </Field>
          )}

          {/*
            ⚠️ **这个闸今天恒真** —— 三种类型都会拦,等级对每一条都有意义,
            所以这一栏今天**每一条都渲染**。和收起行那个 `LevelText`、以及档案页
            那一行是**同一个闸**,三处都走 `hardBlocks`。

            留着它是为了下一次:出现一个不拦的类型时,「高危/中危/低危」对它一点
            意义都没有,留着只会让人以为它也会拦菜(而且默认值是「高危」)。
            ⚠️ 真到那一天光藏起来**不够** —— 藏起来之后 `draft.level` 还是默认的
            「高危」,保存会把一个不存在的等级发给食衡。收口在 `save()` 里的
            `restrictionLevel()`,这一栏只管显示。
          */}
          {hardBlocks(row.type) && (
            <Field label="严重程度">
              <SegmentedControl
                size="lg"
                label="严重程度"
                value={row.level}
                onChange={(v: RestrictionLevel) => onChange({ level: v })}
                options={RESTRICTION_LEVELS.map((l) => ({ value: l, label: l }))}
              />
            </Field>
          )}

          <button
            type="button"
            onClick={onRemove}
            className="self-start text-[13px] leading-[18px] font-medium text-danger active:opacity-60"
          >
            {row.isNew ? '不要这条' : '删除这条限制'}
          </button>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] leading-[17.38px] text-muted">{label}</span>
      {children}
    </div>
  )
}

/** 严重程度那三个字的颜色 —— 和三处现有的写法一致(高危红、中危橙、低危灰) */
function LevelText({ level }: { level: RestrictionLevel }) {
  const tone = level === '高危' ? 'text-danger' : level === '中危' ? 'text-warn' : 'text-muted'
  return <span className={`shrink-0 text-[13px] leading-[15.6px] font-medium ${tone}`}>{level}</span>
}
