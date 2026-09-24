import { useEffect, useRef, useState } from 'react'
import { Screen } from '../components/ios/Screen'
import { Icon } from '../components/Icons'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { InlineField, draftPatch, draftSeed, fieldSpec, type FieldKey } from '../components/InlineField'
import { BodyPicker } from '../components/PickerSheet'
import { ProfileSheet } from '../components/ProfileSheet'
import { QuotaSheet } from '../components/QuotaSheet'
import { RestrictionSheet } from '../components/RestrictionSheet'
import {
  Avatar,
  Card,
  DarkCard,
  Divider,
  Footnote,
  ListRow,
  PageSubtitle,
  PageTitle,
  SectionTitle,
} from '../components/ui'
import { QUOTA_FIELDS, blockedAdvice, quotaNotes, type QuotaChange } from '../store/quota'
import { editProfile, updateProfile, useAppState } from '../store/store'
import {
  hardBlocks,
  restrictionLabel,
  restrictionSection,
  restrictionSectionShape,
  type Profile,
  type RestrictionSection,
} from '../store/types'

/**
 * 健康档案 —— 对应 Figma「③ 界面原型 / 03 · 健康档案 Profile」。
 *
 * 页面上的每一条都来自 store 里的 profile,不是常量:
 * 「营养目标」卡里的「手动调整」改一个数字,会即时反映到这里,也会即时改变首页
 * 健康分的判定。
 *
 * 这一页**整页可改,而且是就地改** —— 点哪一格就只改哪一格,改完原地收起。
 *
 * ⚠️ 相对设计稿加了几样东西,都是有理由的:
 *
 * 1. **三个新字段的展示**(特殊阶段 / 慢性病 / 饮食偏好)。设计稿没有它们,
 *    而它们会改配额、也会进发给 agent 的那段 JSON。
 * 2. **每一格自己就是入口。** 设计稿这一页整页只读,一份填错名字就改不掉的
 *    档案在演示里说不通。上一版给这一页加过一颗页头「编辑」按钮,点开是一张
 *    **装着全部十格**的面板 —— 那是错的改法:改一个错字要先打开一张要滚动的
 *    面板、再在里面找到那一格,而且那张面板还带一颗「保存档案」的灰键
 *    (引导页那道「称呼和性别要填」的闸,被原样搬到了一个用户已经填过的地方)。
 *    现在参照忌口那张管理面板的做法:**点开哪一格就只改哪一格**。
 * 3. **「每日配额的来处」。** 勾上高血压之后钠会从 2000 变成 1500,
 *    而那些数字在这页上一直是「验算出来的、没有出处」的样子 ——
 *    这正是本仓库一直在消灭的那种东西。
 * 4. **四个分类,一类一张卡。** 这一页原来是一张大卡 + 三个灰 12px 的组头
 *    (基础信息 / 健康限制 / 每日营养配额)。用户的原话是「你要分类就分基本
 *    信息、健康信息、饮食信息、营养目标就好啦,而且分类的标题要能让用户
 *    知道你这个是分类标签而不是内容」。
 * 5. **十格只有一种写法。** 它们原本是两种:「健康目标」「饮食偏好」借用灰
 *    12px 的组头当名字,其余九格是黑 15px 的行名 —— 因为设计稿那一页只有
 *    「健康目标」一个词表字段,用组头当名字正好,后来加进来的字段全走成了
 *    行式,两种写法就并排站在了同一页上。用户的原话是「为什么还是有的标题
 *    是黑体字,有的标题是灰字」。现在十格都是行:左边黑 15px 的名字,右边
 *    顿号连起来的那串词。
 */
export default function ProfileScreen() {
  const state = useAppState()
  const [quotaOpen, setQuotaOpen] = useState(false)
  /**
   * 现在开着的是哪一段忌口。`null` = 两张卡的面板都关着。
   *
   * 从 `boolean` 改成 `RestrictionSection | null`:两个入口打开的是**同一个
   * 面板的两段**,`boolean` 装不下「打开的到底是哪一段」。
   */
  const [restrictionOpen, setRestrictionOpen] = useState<RestrictionSection | null>(null)
  const [profilesOpen, setProfilesOpen] = useState(false)
  /**
   * 待确认的「要不要采用条件调整的建议值」。
   *
   * 两个来源共用这一份状态:就地编辑某一格之后自动弹的(editProfile 的返回值),
   * 和点「未采用」那行重新问的(blockedAdvice)。两条路的**面板长一样、
   * 采用的动作也一模一样** —— 差别只在什么时候想起来问。
   */
  const [advice, setAdvice] = useState<QuotaChange[] | null>(null)
  /**
   * 现在开着的是哪一格。`null` = 十格都收着。
   *
   * 用 `FieldKey | null` 而不是数组或 Set,**是为了让「同时只有一格开着」这件
   * 事写不出来** —— 类型里装不下第二个值。用数组的话就得在每次展开前记得清空,
   * 而「忘了清空」没有任何一条断言能发现:界面上只是两格都开着,看起来有点怪。
   *
   * 体征那三格也用这一个状态:它们点开的是滚轮面板,但「现在在编辑哪一格」
   * 仍然是同一个问题。分成两份状态就会出现「滚轮开着、另一格也开着」。
   */
  const [editing, setEditing] = useState<FieldKey | null>(null)
  /** 当前这一格的文字草稿。只有「称呼」和「补充说明」会用到它,见 flush */
  const [draft, setDraft] = useState('')

  const p = state.profile
  const q = p.quota
  const notes = quotaNotes(p)
  const others = state.profiles.length

  // 4×2 规整网格。单位并进标签里,和设计稿的排法一致
  const quotaCells = [
    { label: '热量 kcal', value: String(q.kcal) },
    { label: '碳水 g', value: String(q.carb) },
    { label: '蛋白质 g', value: String(q.protein) },
    { label: '钠 mg', value: String(q.sodium) },
    { label: '脂肪 g', value: String(q.fat) },
    { label: '添加糖 g', value: String(q.sugar) },
    { label: '膳食纤维 g', value: String(q.fiber) },
    { label: '饮水 ml', value: String(q.water) },
  ]

  /**
   * 「手动调整」那一行右边那串 —— **从 `QUOTA_FIELDS` 派生,不再手写一遍**。
   *
   * 手写的那份和面板里真正能调的项迟早会走散,而走散的表现是:那一行说能调
   * 碳水,点进去发现碳水的加减键是灰的。这个仓库里已经有一份「哪些能调」的
   * 事实(`QUOTA_FIELDS` 的 `adjustable`),没有理由再说第二遍。
   */
  const adjustableLabels = QUOTA_FIELDS.filter((f) => f.adjustable)
    .map((f) => f.label)
    .join(' / ')

  /*
    两个忌口分段 —— 名字和面板标题是**同一份**,都从 `RESTRICTION_SECTIONS` 取:
    档案页上那一行的名字和点进去那张面板的标题必须是一个说法,两处各写一个
    迟早会出现「点的是『过敏与用药』,打开的面板叫『健康限制』」。

    分类标签(「健康信息」「饮食信息」)也取自同一张表的 `category` ——
    剩下两个分类(基本信息 / 营养目标)和忌口无关,是这一页自己的排版,所以
    那两个字面写在这儿。
  */
  const health = restrictionSectionShape('health')
  const diet = restrictionSectionShape('diet')

  /**
   * 就地改一格 → 存下来,并拿到**要不要问**。
   *
   * 「先存再问」那套顺序住在 `store.editProfile` 里,不在这里。理由:它是十格
   * 共用的那一次写,写在组件里就会出现第二个版本;而且 `before` 必须取 store
   * 里那一刻的档案,取调用方闭包里的 `p` 会让同一件事被问第二遍
   * (见 store.ts 那段注释)。
   */
  const write = (patch: Partial<Profile>) => {
    const changes = editProfile(patch)
    if (changes.length > 0) setAdvice(changes)
  }

  /**
   * 把当前这一格的文字草稿写下去。没开格子、这一格不是文本框、或者没改过,
   * 都什么都不做(draftPatch 返回 null)。
   *
   * ⚠️ 读的是 `editing` / `draft` 这两个**状态**,不是参数 —— 它回答的是
   * 「我刚才在改哪一格」,那是状态,不是这一次点击。
   */
  const flush = () => {
    if (editing === null) return
    const spec = fieldSpec(editing)
    /* 词表和性别是点一下就写的,它们没有「输到一半」的状态 */
    if (spec.editor !== 'text') return
    const patch = draftPatch(spec.key, draft, p)
    if (patch) write(patch)
  }

  /*
    卸载兜底。

    **主规则是「这一格收起时写」**(见 toggle)。这里挡的是主规则覆盖不到的那
    一条路:点标签栏换页是 react-router 导航,**不经过 toggle** —— ProfileScreen
    直接被拿掉,刚打的半句话会静默消失。

    为什么用 ref 而不是直接闭包:这个 effect 只在挂载时建一次,闭包里的
    `editing` / `draft` 永远是第一次渲染的那份。ref 每次渲染后更新,卸载时读到
    的才是最后一份。

    为什么这里丢掉返回值里的建议也不可惜:会走 flush 的只有「称呼」和
    「补充说明」两个字段,而 quotaFor 只读性别 / 出生日期 / 身高 / 体重 /
    特殊阶段 / 慢性病 / quotaOverrides —— **这两格谁也动不了配额**,
    editProfile 的返回值必然是空数组。
  */
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })
  useEffect(() => () => flushRef.current(), [])

  /**
   * 点某一格:开着就收起,关着就展开。
   *
   * ⚠️ **先收上一格,再开这一格。** 反过来写(`setEditing(key)` 再 `flush()`)
   * 的话,flush 读到的 `editing` 已经是新那一格了 —— 上一格打的字会被当成
   * 「新这一格的草稿」交出去。而它**写得进去**:`draftPatch` 比的是新字段在
   * 档案里的旧值,对不上就老老实实写一条。表现是「点开慢性病,名字没了」。
   */
  const toggle = (key: FieldKey) => {
    flush()

    if (editing === key) {
      setEditing(null)
      return
    }

    /* 草稿在打开这一刻就从档案里摆好 —— 从空串起步会在点开又点回去时写掉一整格 */
    setDraft(draftSeed(key, p))
    setEditing(key)
  }

  /** 采用建议值 —— **删掉**那几条覆盖,而不是钉一个恰好相等的数 */
  const adoptAdvice = () => {
    if (!advice) return
    const next = { ...p.quotaOverrides }
    for (const c of advice) delete next[c.key]
    updateProfile({ quotaOverrides: next })
    setAdvice(null)
  }

  const adviceText = (advice ?? [])
    .map((c) => `${c.label} ${c.suggested}${c.unit}（现在是 ${c.pinned}${c.unit}）`)
    .join('、')

  /* 现在开着的那一格是不是体征 —— 是的话轮到下面那张滚轮面板出场 */
  const editingSpec = editing === null ? null : fieldSpec(editing)

  /**
   * 铺一格。
   *
   * 十处的接线(谁开着 / 点谁 / 草稿给谁)只写在这儿一遍。**次序仍然是显式的** ——
   * 下面 JSX 里逐格点名,不 for 循环 `FIELD_KEYS`:这一页十格之间夹着分割线和
   * 分类的边界,摊进循环就要给每一格再配一张「前面该放什么」的表,而那张表比
   * 十行 JSX 更难读。
   */
  const cell = (key: FieldKey) => (
    <InlineField
      field={key}
      profile={p}
      open={editing === key}
      onToggle={() => toggle(key)}
      draft={draft}
      onDraft={setDraft}
      onPatch={write}
    />
  )

  /**
   * 一段忌口:列表 + 紧跟着它的入口行 —— 两个分类各调一次。
   *
   * ⚠️ 过滤**只准调 `restrictionSection`**,这一页里不许再写一遍类型清单。
   * 写第二份 = 某个类型可能两边都不认,而那一行会**在两张卡里都消失** ——
   * 用户再也看不到、也永远改不了,可它照样随档案发给工作流、照样拦菜。
   *
   * 等级照旧显示(原来「少吃」那一类不显示 —— 严重程度对它不起作用,按默认值
   * 会渲染出一个红色的「高危」,一个假警报比不显示更糟。那个类型 2026-09-22
   * 删掉了,所以这里不再有条件)。
   *
   * ⚠️ **这一段空着时,那个「无」写在入口行的值位上,不另起一行。**
   *
   * 单独一行空态改过三次,每次都错在同一个地方 —— 那一行**没有名字**:
   *   · 最早 `label="未填写" value="—"`:同一件事说了两遍。
   *   · 然后 `label="无"`:少了一遍,但那个「无」占的是**行名的位置**,于是
   *     这一行看起来叫「无」,和上面九格空着时的样子是两回事。用户的原话是
   *     「忌口那里也和其他一样,没有就写无」。
   *   · 然后空的 `label` + `value="无"`:位置和颜色都对上了,但**那一行左边
   *     什么都没有** —— 渲染出来是「慢性病 无 / 无 / 过敏与用药 增删改」,
   *     中间孤零零一个「无」,读起来像一个长坏了的空栏。用户的原话是
   *     「慢性病下面有个空栏,只写了无」。
   *
   * 现在「无」落在**入口行自己的值位**上:`过敏与用药  无  ›`。
   * 于是每一行都有名字,而空态和入口仍然是同一行 —— 少一行,不是多一行。
   */
  const restrictionBlock = (section: RestrictionSection) => {
    const rows = p.restrictions.filter((r) => restrictionSection(r) === section)

    return (
      <>
        {rows.map((r) => (
          <div key={r.item}>
            <Divider />
            <ListRow
              label={restrictionLabel(r)}
              /*
                ⚠️ `hardBlocks(r.type)` 这个闸**今天恒真**(三种类型都会拦),
                留着和面板里收起行、展开态那一栏是同一个理由:**同一个闸,三处**。
                它保的是下一次出现一个不拦的类型时,「折耳根不爱吃　低危」那种
                自相矛盾的话不会漏到这一行上。

                `restrictionLevel()` 保的是「存下来的也不会有等级」,两条合起来
                才成立。显示和值都跟着走,所以这里不写死任何类型名。
              */
              right={
                hardBlocks(r.type) && (
                  <span
                    className={`text-[13px] leading-[15.6px] font-medium ${
                      r.level === '高危' ? 'text-danger' : r.level === '中危' ? 'text-warn' : 'text-muted'
                    }`}
                  >
                    {r.level}
                  </span>
                )
              }
            />
          </div>
        ))}
        <Divider />
        <ListRow
          label={restrictionSectionShape(section).entry}
          /*
            空着时值位是「无」,有内容时是「增删改」。同一个位置上的两种取值 ——
            不是两个说法:「无」说的是**这一段现在是什么**,「增删改」说的是
            **点它能做什么**,而这一行本来就只能同时说一件。
          */
          value={rows.length === 0 ? '无' : '增删改'}
          secondary
          chevron
          onClick={() => setRestrictionOpen(section)}
        />
      </>
    )
  }

  return (
    <Screen>
      <div className="flex flex-col gap-3.5 px-5 pt-1">
        {/* ---------- 页头 ---------- */}
        <header className="flex h-[54px] items-center justify-between">
          <div>
            <PageTitle>健康档案</PageTitle>
            <PageSubtitle>膳食分析基于当前档案生成</PageSubtitle>
          </div>
          {/*
            页头只剩「调整」一颗。

            这里原来并排着「编辑」和「调整」,「编辑」打开一张装着全部十格的
            面板。它俩并排是因为**两颗必须长得一模一样**才读得出「同一层的两个
            目的地」—— 所以当时抽了个 HeaderAction 出来,度量只写一处。
            现在只剩一颗,那条约束消失了,组件也就跟着折叠回这里。

            「调整」的位置没有变:仍旧是最后那一颗,仍旧贴着右边。
          */}
          <button
            onClick={() => setQuotaOpen(true)}
            className="flex h-11 shrink-0 items-center gap-1 pr-1 pl-2 text-brand-deep active:opacity-60"
          >
            <Icon name="sliders" size={15} strokeWidth={2.4} />
            <span className="text-[13px] leading-[15.6px] font-medium">调整</span>
          </button>
        </header>

        {/* ---------- 当前档案卡(深色)—— 点开切换 ---------- */}
        <DarkCard>
          <button
            onClick={() => setProfilesOpen(true)}
            className="flex w-full items-center gap-3.5 text-left active:opacity-80"
            aria-label="切换档案"
          >
            <Avatar />
            <div className="flex min-w-0 flex-1 flex-col">
              {/*
                这一行原来下面还有一行的**摘要**:`{性别} · {年龄}岁 · {cm} · {kg}`。
                它和「基本信息」那张卡是同一批数据,而且年龄在那儿还写着第二次
                (「出生日期」那一行的右边就是「1998年3月20日 · 28岁」)。

                删掉之后 `ageOf` 在这一页失去了唯一调用点 —— 年龄只在一个地方
                出现,那一处是它真正在算的那个数(见 InlineField 的 birth)。
              */}
              <span className="truncate text-[16px] leading-[19.2px] font-bold text-white">{p.name}</span>
            </div>
            {/* 「当前」徽章为绿字 */}
            <span className="inline-flex h-6 shrink-0 items-center rounded-[12px] bg-white/12 px-2.5 text-[11px] leading-[13.2px] font-medium text-brand">
              当前
            </span>
            {/* 箭头是「这里能点」的唯一提示 —— 这张卡原来就长得像个展示件 */}
            <Icon name="chevronRight" size={16} className="shrink-0 text-white/70" strokeWidth={2.2} />
          </button>
          <p className="pt-2 pl-[62px] text-[11px] leading-[15.93px] text-white/60">
            {others > 0 ? `还有 ${others} 个档案 · 点这里切换` : '点这里可以新建、切换档案'}
          </p>
        </DarkCard>

        {/*
          四个分类 —— 一类一张卡,标签在卡片外的页面底色上。

          这一页原来是一张大卡 + 三个灰 12px 的组头(`GroupHeader`)。那个形状是
          给「卡片里的第一个孩子」用的:12px、缩进 16px,和行名只差一个字号 ——
          坐在卡里读起来像**某一个字段的小标签**,不像一个分类。用户的原话是
          「分类的标题要能让用户知道你这个是分类标签而不是内容」。

          所以改成本 App 别处已经在用的做法(首页「今日餐次」、日记页就是):
          13px 灰的 `SectionTitle`,在卡片外,和它管的那张卡左对齐。

          ⚠️ **组内 8px、组间 14px**(`gap-1.5` vs 容器那个 `gap-3.5`)。
          两个都取 14px 的话,标签到上面那张卡和下面那张卡的距离相等 ——
          又读回「不属于任何一张卡」。这层 `<section>` 就是「让标签读起来是
          标签」那件事本身,不是排版偏好。

          ⚠️ **下面十格的次序必须和 `InlineField` 里 SPECS 的次序一致。**
          `FIELD_KEYS` 就是那张表的次序,验证脚本按它断言这一页渲染出来的
          先后 —— 所以四张卡的切法跟着那张表的分组走,「把某一格挪个位置」
          不只是一次排版改动。

          ⚠️ 每张卡自己补一点上内边距(`pt-1`)。三个组头各自贡献了 `pt-3 pb-1`,
          删掉之后第一行会贴到卡边 —— 但只补一点点:补大了标签就和卡脱开了。
        */}
        <section className="flex flex-col gap-1.5">
          <SectionTitle>基本信息</SectionTitle>
          <Card className="pt-1 pb-2">
            {cell('name')}
            <Divider />
            {cell('gender')}
            <Divider />
            {cell('birth')}
            <Divider />
            {cell('height')}
            <Divider />
            {cell('weight')}
          </Card>
        </section>

        <section className="flex flex-col gap-1.5">
          <SectionTitle>{health.category}</SectionTitle>
          <Card className="pt-1 pb-2">
            {cell('specialStages')}
            <Divider />
            {cell('chronicConditions')}
            <Divider />
            {/*
              忌口紧跟着「会改配额的条件」那两格,入口跟在列表后面 ——
              它是**这一段内容的动作**,离列表远了用户就得回头找。
              空着时入口行的值位写「无」,见 `restrictionBlock`。

              「其他补充」在这一段的最末尾:它的例子是「在吃什么药、
              医生交代过什么」,和上面那两格是同一类东西(医学的)。
            */}
            {restrictionBlock(health.key)}
            <Divider />
            {/*
              补充说明 —— 引导最后一步那段自由文本。
              它**必须有地方显示**:一个只写得进、读不出来的字段比没有这个字段
              更糟(这个仓库里 `seeded` 就是前车之鉴 —— 只被写、从没被读过)。

              这一格原来顶着一个 GroupHeader「补充说明」,而那个头恰好和行名
              是同一个字段的两个说法 —— 正是这一页一直在删的那种重复。删掉之后
              这一页上这个字段只剩一个名字(今天叫「其他补充」,改名前叫
              「想告诉食衡的其他事」),抽屉里的 TextArea 也因此
              **不写可见标签**(只给 ariaLabel),否则名字又变回两个。
            */}
            {cell('notes')}
          </Card>
        </section>

        <section className="flex flex-col gap-1.5">
          <SectionTitle>{diet.category}</SectionTitle>
          <Card className="pt-1 pb-2">
            {/*
              两栏都是**列表**,而列表里既可能装预设也可能装用户自己写的词 ——
              所以行里不做任何分类渲染:自己写的词就混在同一串里,因为它本来
              就和预设是同一件事。
            */}
            {cell('goals')}
            <Divider />
            {cell('dietaryPreferences')}
            {restrictionBlock(diet.key)}
          </Card>
        </section>

        <section className="flex flex-col gap-1.5">
          <SectionTitle>营养目标</SectionTitle>
          <Card className="pt-1 pb-2">
            {/* 4×2 规整网格 —— 设计改动说明里把原来的负外边距改成了网格 */}
            <div className="grid grid-cols-4 gap-2.5 px-4 pt-1 pb-3">
              {quotaCells.map((c) => (
                <div
                  key={c.label}
                  className="flex h-[49px] flex-col items-center justify-center rounded-[12px] bg-brand-bg px-2"
                >
                  <span className="tnum text-[14px] leading-[16.8px] font-bold text-brand-text">{c.value}</span>
                  <span className="text-center text-[11px] leading-[15.93px] text-muted">{c.label}</span>
                </div>
              ))}
            </div>

            {/*
              配额的来处。没有这一段的话,勾上高血压看到钠变成 1500 只会让人
              以为数字坏了 —— 而「每个数字都有出处」是这个 App 的主张。

              每一项的文字都是 quotaNotes 里**算出来**的(拿掉这条再算一遍、
              和全算一遍对比),所以它不可能和实际算法不一致。
            */}
            {notes.length > 0 && (
              <div className="flex flex-col gap-2 px-4 pt-1 pb-3">
                <span className="text-[12px] leading-[17.38px] font-medium text-muted">这些数字为什么是这样</span>
                {notes.map((n) => (
                  <NoteRow key={n.source} note={n} onReask={() => setAdvice(blockedAdvice(p))} />
                ))}
              </div>
            )}

            {/*
              这一行原来叫「调整每日目标」,而它上面那个头叫「每日营养配额」——
              同一件事的两个说法。头改成「营养目标」之后,这一行就只剩它自己
              这个动作的名字:**手动调整**。
            */}
            <ListRow
              label="手动调整"
              value={adjustableLabels}
              secondary
              chevron
              onClick={() => setQuotaOpen(true)}
            />
          </Card>
        </section>

        <Footnote className="pt-1">
          配额依据《中国居民膳食指南 2022》结合基础信息自动计算，可手动调整。
          修改后，健康分与各项提示会按新目标重新判定。
        </Footnote>
      </div>

      <QuotaSheet open={quotaOpen} onClose={() => setQuotaOpen(false)} profile={p} />

      {/*
        两个入口 → **两个面板实例**,不是一个实例换 `section`。

        「一个实例 + `section={open ? s : 'health'}`」在关着的时候会把 `section`
        撑成一个假值(关着的那一瞬间它到底算哪一段?没有答案),而且两个入口
        打开的是同一个组件的不同段 —— 各自持有自己的草稿和展开下标更省心。
      */}
      <RestrictionSheet
        open={restrictionOpen === health.key}
        onClose={() => setRestrictionOpen(null)}
        section={health.key}
        profile={p}
      />
      <RestrictionSheet
        open={restrictionOpen === diet.key}
        onClose={() => setRestrictionOpen(null)}
        section={diet.key}
        profile={p}
      />

      {/*
        体征那一格的滚轮面板。

        ⚠️ **它挂在这一层,不挂进那一行的展开块里。** 它是 `absolute inset-0`,
        挂进卡片会去认最近的定位祖先 —— 于是它会只盖住那张卡而不是整屏。

        ⚠️ **它排在 ConfirmSheet 之前,顺序不能换。** 两个都是 `z-50`,谁在上面
        由 DOM 顺序决定。原来它嵌在「编辑档案」那张 `z-40` 的面板里,有一层层叠
        上下文挡着才没撞上;提到这一层之后那道保护没了。演示动线「改到钠被钉住
        + 再去滚身高」会同时出现这两层,顺序错了就是滚轮面板被询问框盖住。
      */}
      {editingSpec?.editor === 'picker' && (
        <BodyPicker field={editingSpec.key} value={p} onChange={write} onClose={() => setEditing(null)} />
      )}

      <ProfileSheet open={profilesOpen} onClose={() => setProfilesOpen(false)} />

      {/*
        条件调整 vs 手改的询问框。

        「保留我的」是第二个按钮的话 —— 不是「取消」。这次编辑**已经存下来了**,
        写成「取消」会被读成「撤销我刚才改的东西」。见 ConfirmSheet.cancelLabel。
      */}
      <ConfirmSheet
        open={advice !== null && advice.length > 0}
        title="要不要采用建议值？"
        body={`你的档案有新的条件调整：${adviceText}。采用后这几项交回自动计算，保留则继续用你设的值（可随时在档案页再改）。`}
        confirmLabel="采用建议值"
        cancelLabel="保留我的"
        onConfirm={adoptAdvice}
        onClose={() => setAdvice(null)}
      />
    </Screen>
  )
}

/**
 * 一条「来处」。
 *
 * 两种形态共用一行:
 *   · 正常 —— 说清哪条条件改了什么,下面一行是依据
 *   · 被手改挡住 —— 写明「未采用」,整行变成按钮,点开重新问一次
 *
 * 第二种没有入口的话,用户当初点了「保留我的」就**再也没有机会改主意** ——
 * 那行字会变成一句只能干看着的说明。
 */
function NoteRow({
  note,
  onReask,
}: {
  note: { source: string; effect: string; basis: string; blockedByOverride: boolean }
  onReask: () => void
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] leading-[19px] text-ink">
          {note.source}
          <span className="text-muted"> → </span>
          {note.effect || '不改每日配额'}
        </span>
        {note.blockedByOverride && (
          <span className="shrink-0 text-[12px] leading-[17.38px] font-medium text-warn">
            你手动设过 · 未采用
          </span>
        )}
      </div>
      <p className="pt-0.5 text-[11px] leading-[15.93px] text-faint">{note.basis}</p>
    </>
  )

  if (!note.blockedByOverride) {
    return <div className="rounded-[10px] bg-brand-bg px-3 py-2">{body}</div>
  }

  return (
    <button
      type="button"
      onClick={onReask}
      className="rounded-[10px] bg-warn-bg px-3 py-2 text-left active:opacity-70"
    >
      {body}
      <span className="pt-1 text-[11px] leading-[15.93px] font-medium text-warn-body">点这里重新考虑 →</span>
    </button>
  )
}
