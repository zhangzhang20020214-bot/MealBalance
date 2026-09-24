import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '../components/ios/Screen'
import {
  ChoiceChips,
  ListRow,
  NavBar,
  PrimaryButton,
  SegmentedControl,
  TextArea,
  TextField,
} from '../components/ui'
import { BodyPicker } from '../components/PickerSheet'
import { formatBirth } from '../lib/age'
import { completeOnboarding, resetToSeed, updateProfile, useAppState } from '../store/store'
import {
  ageOf,
  BODY_FIELDS,
  CHRONIC_CONDITIONS,
  DIET_PRESET_WORDS,
  GENDERS,
  GOAL_PRESETS,
  SPECIAL_STAGES,
  type Profile,
} from '../store/types'

/**
 * 建档引导 —— 四步。**不在设计稿里**,是这次新加的一屏。
 *
 * 为什么值得加
 * ------------------------------------------------------------
 * README 第 11 行承诺「打开即用,不需要注册,不需要配置任何东西」,而
 * 「一进来就摆着一份已经填好的档案」和那句话是矛盾的:面试官看到的是
 * 某个别人的健康档案。三步引导 + **每一步都摆着的「先用演示档案看看」**,
 * 两个诉求就都成立了 —— 想动手的人真的走一遍,想先看的人一下都不用点。
 *
 * 几条刻意的取舍
 * ------------------------------------------------------------
 * · **忌口不进引导。** 过敏原那种东西不该在「先随便看看」的动线上被问到,
 *   而且它每一条自带一个二级编辑器。它在档案页里编辑。
 * · **完成建档 = 空日记。** 不是「没数据」:首页在 0 餐时给的是 66 分 +
 *   `provisional` 提示,日记页有对应文案,周趋势直接不画 —— 都已经核过。
 * · 必填缺失时用 `pointer-events-none opacity-40`,**不是 `disabled`**:
 *   仓库里 `QuotaSheet` 就是这么写的,而且 `disabled` 在移动端 Safari 上
 *   会把按钮从「按不动」变成「看起来像坏了」。
 * · **最后一步是「还有要补充的吗」。** 前面四栏(目标/偏好/特殊阶段/慢性病)
 *   都是**选择题**,装不下的那部分就只能丢掉 —— 在吃什么药、医生交代过什么、
 *   家里几个人吃饭,每一条都不足以单开一栏,凑起来却常常比档案里那二十个字段
 *   还有用。这一步把它捞回来。
 */

const STEPS = ['基本资料', '饮食偏好', '身体状况', '补充说明'] as const

export default function WelcomeScreen() {
  const state = useAppState()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)

  /*
    草稿放在本地,每一步「下一步」时才写回 store。

    不每敲一个字就写回:那样 `quotaFor` 会跟着每一次按键重算,而用户正在
    填体重 —— 中途的 3kg、33kg 都是没有意义的档案值,写进去还会经过一次
    夹取(kcal 被夹到 800 下限),回填到界面上就是他打的字被改掉了。
  */
  const [draft, setDraft] = useState<Profile>(() => state.profile)

  /*
    哪一行的滚轮正开着。三行共用一个面板,所以存的是**哪一个字段**而不是
    三个布尔 —— 三个布尔就允许「同时开着两个」这种状态存在,而它没有意义。
  */
  const [picking, setPicking] = useState<(typeof BODY_FIELDS)[number]['key'] | null>(null)

  /*
    最后一步那个「是/否」。`false` = 没有补充 —— 它是**默认值**,因为选择
    「没有」的人不该被迫先点一下再说没有。选了「是」才出现输入框。
  */
  const [more, setMore] = useState(false)

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  /** 引导只写它自己负责的那几个字段 —— 忌口和手工配额不在这一屏的范围内 */
  const patch: Partial<Profile> = {
    name: draft.name.trim(),
    gender: draft.gender,
    birth: draft.birth,
    height: draft.height,
    weight: draft.weight,
    goals: draft.goals,
    dietaryPreferences: draft.dietaryPreferences,
    specialStages: draft.specialStages,
    chronicConditions: draft.chronicConditions,
    notes: draft.notes.trim(),
  }

  const step1Ready = patch.name !== '' && patch.gender !== ''
  const last = step === STEPS.length - 1
  /** 开着滚轮的那一行。undefined = 都没开 */
  const pickingField = BODY_FIELDS.find((f) => f.key === picking)

  const goDemo = () => {
    // 「先用演示档案看看」= 整个换成演示档案,连基本资料一起。所以它不需要把
    // 草稿存下来:用户此刻填的东西本来就是要丢掉的那一份。
    resetToSeed()
    navigate('/', { replace: true })
  }

  /** 建档收尾 —— 「没有了」和「补充完了」两条路都走到这里 */
  const finish = () => {
    updateProfile(patch)
    completeOnboarding()
    navigate('/', { replace: true })
  }

  const next = () => {
    if (last) return finish()
    // 每一步都写回,而不是只在最后写 —— 中途关掉浏览器也不会白填
    updateProfile(patch)
    setStep(step + 1)
  }

  return (
    <Screen tabBar={false} scroll={false}>
      {/*
        自己撑一个 h-full 的纵向 flex,而不是把按钮绝对定位到底部:
        Screen 的内容区本身就是滚动容器,里面放 absolute 会**跟着滚**。
        ChatScreen 的输入栏也是这个结构(它同样传 scroll={false})。
      */}
      <div className="flex h-full flex-col">
        {/* 第 1 步没有「上一步」—— 回退到一个空页面是死路 */}
        <NavBar title="建立健康档案" backLabel={step > 0 ? '上一步' : undefined} onBack={() => setStep(step - 1)} />

        <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pt-2">
          {/* ---------- 步骤指示 ---------- */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-brand' : 'bg-black/[0.08]'}`}
                  aria-hidden="true"
                />
              ))}
            </div>
            <span className="text-[12px] leading-[17.38px] text-muted">
              第 {step + 1} / {STEPS.length} 步 · {STEPS[step]}
            </span>
          </div>

          {step === 0 && (
            <>
              <h1 className="text-[24px] leading-[30px] font-bold tracking-[-0.3px] text-ink">先认识一下你</h1>
              <div className="flex flex-col rounded-[12px] bg-card">
                <TextField
                  label="称呼"
                  value={draft.name}
                  onChange={(v) => set('name', v)}
                  placeholder="怎么称呼你"
                  maxLength={12}
                />
                <div className="flex h-11 items-center justify-between gap-3 px-4">
                  <span className="shrink-0 text-[15px] leading-[22px] text-ink">性别</span>
                  <SegmentedControl
                    size="lg"
                    label="性别"
                    value={draft.gender}
                    onChange={(v) => set('gender', v)}
                    options={GENDERS.map((g) => ({ value: g as string, label: g }))}
                  />
                </div>
                {/*
                  体征三行就是全 App 那套 ListRow(和「称呼」「性别」同一张卡、
                  同一套骨架),点开才出现滚轮 —— 轮子常驻会让这张卡变成一根柱子,
                  见 PickerSheet 顶上那段。值也不再用步进器:那几列有 87/12/81/121 档。
                */}
                {BODY_FIELDS.map((f) => (
                  <ListRow key={f.key} label={f.label} value={f.text(draft)} chevron onClick={() => setPicking(f.key)} />
                ))}
              </div>
              <p className="px-1 text-[11px] leading-[15.93px] text-faint">
                出生日期、身高、体重决定每日热量的推导（Mifflin-St Jeor 公式 × 活动系数），
                填多少就按多少算。<strong>年龄是算出来的</strong>：按 {formatBirth(draft.birth)} 算是{' '}
                {ageOf(draft)} 岁。
              </p>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="text-[24px] leading-[30px] font-bold tracking-[-0.3px] text-ink">在关注什么？</h1>
              <div className="flex flex-col gap-2">
                <span className="text-[12px] leading-[17.38px] text-muted">健康目标 · 可多选，也可以自己写</span>
                <ChoiceChips
                  label="健康目标"
                  options={GOAL_PRESETS}
                  value={draft.goals}
                  onChange={(v) => set('goals', v)}
                  noneLabel="无"
                  other={{ placeholder: '如「备孕」「增肌」' }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[12px] leading-[17.38px] text-muted">饮食偏好 · 可多选，也可以自己写</span>
                <ChoiceChips
                  label="饮食偏好"
                  options={DIET_PRESET_WORDS}
                  value={draft.dietaryPreferences}
                  onChange={(v) => set('dietaryPreferences', v)}
                  noneLabel="无"
                  /*
                    ⚠️ 这里原来写的是「如『不吃葱姜蒜』」—— 和 `InlineField` 那一格
                    是**同一个字段、同一句错话**(「不吃葱姜蒜」是忌口,却摆在一格
                    从不参与拦菜的地方)。`DIET_PRESET_WORDS` 两个屏共用,换表时
                    自动跟着改了,而 placeholder 是各写一份的字面量 —— 所以那一份
                    改了、这一份没改,同一个字段在两步界面上说两种话。
                    判据同 `InlineField`:**它是「想吃」还是「不想吃」?**
                    后来「少辣」「口味清淡」搬去了「饮食目标」、「素食」搬去了
                    「忌口」,这里剩「爱喝汤」—— 和档案页那一格逐字相同。
                  */
                  other={{ placeholder: '如「爱喝汤」' }}
                />
              </div>
              {/*
                ⚠️ 这段话说的是**下面那一格,不是这一格** —— 所以它必须跟着
                「忌口」那一格一起改。原来写「那里填的词会被硬拦截」,2026-09-22
                下午之后**是假的**:饮食段的入口当时改叫「忌口与不爱吃」,里面分两类,
                「不爱吃」那一类不拦。傍晚那一类整个删掉了,「一律会拦」又变成真的
                —— 但**这一版不再把「拦」写给这一格看**:它说的是下面那格的性质,
                而下面那格的名字和性质这一天各变了三次。
                所以只说这一格自己的性质(不会被逐道菜核对)+ 一句指路,
                指路的那个名字必须和档案页入口行**逐字相同**。
                指路指到一个名字变了、性质也变了的地方,比不指还糟。
              */}
              <p className="px-1 text-[11px] leading-[15.93px] text-faint">
                偏好是给食衡看的一句话，不会被拿去逐道菜核对 ——
                「爱吃鱼」这类喜欢吃什么写在这里。
                不想吃的（具体食物，或者「素食」这种一整类）要单独填，
                建档完之后在健康档案页的「忌口」里加。
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-[24px] leading-[30px] font-bold tracking-[-0.3px] text-ink">
                有没有要照顾的地方？
              </h1>
              <div className="flex flex-col gap-2">
                <span className="text-[12px] leading-[17.38px] text-muted">特殊阶段 · 可多选，也可以自己写</span>
                <ChoiceChips
                  label="特殊阶段"
                  options={SPECIAL_STAGES}
                  value={draft.specialStages}
                  onChange={(v) => set('specialStages', v)}
                  noneLabel="无"
                  other={{ placeholder: '如「备孕」「甲状腺结节」' }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[12px] leading-[17.38px] text-muted">慢性病 · 可多选，也可以自己写</span>
                <ChoiceChips
                  label="慢性病"
                  options={CHRONIC_CONDITIONS}
                  value={draft.chronicConditions}
                  onChange={(v) => set('chronicConditions', v)}
                  noneLabel="无"
                  other={{ placeholder: '如「甲状腺结节」' }}
                />
              </div>
              <p className="px-1 text-[11px] leading-[15.93px] text-faint">
                勾上的每一项，档案页都会写清它有没有动你的每日上限 ——
                高血压调钠、糖尿病调碳水、孕期与哺乳期调热量和蛋白质，其余几项不动数字。
                不确定就都不选，之后在健康档案里随时能补。
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-[24px] leading-[30px] font-bold tracking-[-0.3px] text-ink">
                还有要补充的吗？
              </h1>
              <p className="px-1 text-[13px] leading-[19px] text-muted">
                前面几栏都是选择题，装不下的都写在这里 —— 在吃什么药、医生交代过什么、
                几个人一起吃饭、几点下班。食衡会连着这段话一起读。
              </p>

              {more ? (
                <TextArea
                  label="补充说明"
                  value={draft.notes}
                  onChange={(v) => set('notes', v)}
                  placeholder="想到什么写什么，留空也没关系"
                  maxLength={500}
                  rows={5}
                  className="px-0"
                />
              ) : (
                /*
                  两个按钮,而不是一条「是 / 否」分段条。

                  分段条在这里有个具体的坑:它内部用方向键在选项间移动
                  (`SegmentedControl` 的 `move`),而「否」一旦等于「建档完成并
                  跳走」,读屏或键盘用户在那一行按一下方向键就会被弹出这一屏。
                  两个按钮没有这个问题,而且「否」这个动作本身写得下更多字。
                */
                <div className="flex flex-col gap-2">
                  <PrimaryButton icon="check" onClick={finish}>
                    没有了，完成建档
                  </PrimaryButton>
                  <button
                    type="button"
                    onClick={() => setMore(true)}
                    className="h-11 rounded-[14px] bg-black/[0.05] text-[15px] leading-[21px] font-medium text-ink active:opacity-70"
                  >
                    还有要补充的
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ---------- 底部动作区 ---------- */}
        <div className="shrink-0 px-5 pt-3">
          <div className="flex flex-col gap-1">
            {/*
              最后一步**没选「补充」时不显示这颗键** —— 那一屏的「没有了，完成建档」
              已经在内容区里了,再摆一颗「完成建档」就是同屏两颗一模一样的按钮,
              而它们要做的事完全相同。
            */}
            {(!last || more) && (
              <PrimaryButton
                icon={last ? 'check' : 'chevronRight'}
                onClick={next}
                className={step === 0 && !step1Ready ? 'pointer-events-none opacity-40' : ''}
              >
                {step === 0 && !step1Ready ? '称呼和性别要填' : last ? '完成建档' : '下一步'}
              </PrimaryButton>
            )}

            {/*
              「先用演示档案看看」在**每一步**都摆着。
              只在第一步给的话,已经点进来的人得退回第一步才能找到出口 ——
              而这个出口存在的全部意义就是「别让人为了看一眼而填表」。
            */}
            <button
              onClick={goDemo}
              className="flex flex-col items-center gap-0.5 rounded-[14px] py-2 active:opacity-60"
            >
              <span className="text-[15px] leading-[21px] font-medium text-brand-deep">先用演示档案看看</span>
              <span className="text-[11px] leading-[15.93px] text-muted">跳过建档，直接看一份 14 天的演示记录</span>
            </button>
          </div>
        </div>
      </div>

      {/*
        滚轮面板挂在 Screen 里、内容区之外 —— 它要盖住整屏(含底部动作区),
        放进那个滚动容器里会跟着内容滚。同屏只可能开一张,存的是「哪一行」
        (见上面 `picking`)。
      */}
      {pickingField && (
        <BodyPicker
          field={pickingField.key}
          value={draft}
          onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
          onClose={() => setPicking(null)}
        />
      )}
    </Screen>
  )
}

