import { ChoiceChips, ListRow, SegmentedControl, TextArea, TextField } from './ui'
import { formatBirth } from '../lib/age'
import {
  ageOf,
  CHRONIC_CONDITIONS,
  DIET_PRESET_WORDS,
  GENDERS,
  GOAL_PRESETS,
  SPECIAL_STAGES,
  type Profile,
} from '../store/types'

/**
 * 档案页上的一格 —— 那一行 + 它的就地编辑器。
 *
 * 为什么是「一格一个组件」而不是把十格摊在 ProfileScreen 里
 * ------------------------------------------------------------
 * `aria-controls` 的 id、`aria-expanded` 的取值、触发行和展开块的配对,摊开手写
 * 十遍,一定会有某一格抄成上一格的 key(「慢性病」那一格写成
 * `open={editing === 'goals'}`)—— 而**这种错静态 SSR 一句都断不到**:两格各自
 * 都渲染得出来,只有点下去才知道改错了对象。收进这里之后 id 由 `field` 派生,
 * 只有一处能写。
 *
 * 这也是它单独成一个文件(而不是 ProfileScreen 里的局部组件)的原因:抽出来
 * 才能在验证脚本里**直接渲染某格开着的样子**。`renderToStaticMarkup` 点不动
 * 任何东西,「展开块里装着什么控件」这件事只有这一条路能验。
 *
 * 触发器只有一族:行
 * ------------------------------------------------------------
 * 十格**全部**是 `ListRow` + chevron。四张词表(饮食目标 / 特殊阶段 / 慢性病 /
 * 饮食偏好)在这里长得一模一样:左边一行名字,右边顿号连起来的那串词,点开才是
 * 胶囊和自填口。
 *
 * ⚠️ **这里原来有两族。** 饮食目标和饮食偏好曾经是「整块 Tag 变成按钮」,名字
 * 借用上面那个灰组头 —— 因为设计稿那一页只有「健康目标」一个词表字段,用组头
 * 当名字正好。后来特殊阶段 / 慢性病 / 饮食偏好陆续加进来、全走成了行式,于是
 * **同一页上十一个字段名,九个黑 15px,两个灰 12px**,而且它们还紧挨着。
 * 用户的判词是「为什么还是有的标题是黑体字,有的标题是灰字」。
 *
 * 所以现在只剩一族,而且**胶囊块(连带那个「第一项深底白字」的强调)从档案页
 * 上消失了** —— 它在展开块里,点开才看得见。顺带记一条:原来被强调的是
 * `p.goals[0]`,而数组顺序是用户勾选的先后 —— 也就是被强调的那一项是任意的、
 * 不携带任何信息,丢掉它本来也不算损失。
 *
 * 词表类为什么不做草稿、点一下就写:见 `WordsShape.patch` 上面那段和
 * ProfileScreen 里 `flush` 顶上那段。
 *
 * 体征那三格为什么只出行、没有展开块
 * ------------------------------------------------------------
 * 它们要用滚轮(`BodyPicker`,一个 z-50 的面板)。滚轮塞进行内是不行的:
 * 一个约 200pt 高的东西长在行里,页面会剧烈跳动,而且手指在那一块上下滑
 * 到底是滚年份还是滚页面,没有答案。所以它们点开的是**只有那一格**的面板 ——
 * 这不是「弹出全部」,是「弹出这一格」。
 *
 * ⚠️ 它们也因此**不带 `aria-expanded`**:`aria-expanded` 说的是「我下面这块
 * 东西现在露着没有」,而它们下面是空的,打开的是一层对话框。给它一个永远
 * `false` 的 `aria-expanded`,读屏用户听到的是「收起」却弹出了一个面板。
 */

/* ------------------------------------------------------------
   元数据表
   ------------------------------------------------------------ */

/** 四张词表共有的那几样 —— 行上取顿号连接,抽屉里铺成胶囊,读写是同一套 */
interface WordsShape {
  /** 这一格的词 */
  list: (p: Profile) => string[]
  options: readonly string[]
  other: { placeholder: string; hint?: string }
  /**
   * 写入 patch。
   *
   * 每一格自己带着,而不是在渲染处写 `{ [field]: next } as Partial<Profile>`:
   * 那种写法要一次类型断言,而断言会把「新加了一格却忘了写 patch」一起吞掉 ——
   * 那种漏法的表现是「点得动、胶囊也变了、但档案没变」,整个验证套件里没有
   * 一条能发现它。带着写就没有断言,加一格漏一处就是编译错误。
   */
  patch: (next: string[]) => Partial<Profile>
}

interface TextShape {
  editor: 'text'
  label: string
  value: (p: Profile) => string
  empty: (p: Profile) => boolean
  placeholder: string
  maxLength: number
  /** 传了就是多行 */
  rows?: number
  /** 抽屉底部那句说明 */
  note?: string
}

interface ChoiceShape {
  editor: 'choice'
  label: string
  value: (p: Profile) => string
  empty: (p: Profile) => boolean
  options: { value: string; label: string }[]
}

/** 体征 —— 永远非空,所以没有 `empty` */
interface PickerShape {
  editor: 'picker'
  label: string
  value: (p: Profile) => string
}

/**
 * 十格,一格一个变体 —— **`key` 写在变体里面,不是外面套一层
 * `{ key: FieldKey } & (联合)`。**
 *
 * 差别不是写法偏好,是它决定了调用方能不能**不收窄就用对 key**:
 * `spec.editor === 'picker'` 能把 `spec` 收窄到体征那三个变体,于是
 * `spec.key` 当场就是 `'birth' | 'height' | 'weight'` —— ProfileScreen 可以
 * 直接把它交给 `BodyPicker` 的 `field`。key 要是挂在交集外层,收窄 `spec`
 * 收窄不到它,调用方就得再手写一个 `isPickerField(key): key is ...` 的判据,
 * 而那个判据是**第二份**「哪几格是体征」,和这张表迟早走散。
 *
 * 同一条理由让下面 `FieldKey` / `DraftFieldKey` 全都能推出来,一份手写的
 * 字段名清单都不剩。
 */
type FieldSpec =
  | ({ key: 'name' } & TextShape)
  | ({ key: 'gender' } & ChoiceShape)
  | ({ key: 'birth' } & PickerShape)
  | ({ key: 'height' } & PickerShape)
  | ({ key: 'weight' } & PickerShape)
  /*
    四张词表是**同一个变体**,不是四个 —— 它们唯一的差别在数据里(options /
    list / patch),不在界面上。留一个 `chips` 而不是四份,是为了让「它们长得
    一模一样」这件事由类型保证:想给其中一张换个样子,只能改这个变体,四张一起变。
  */
  | ({ key: 'goals' } & { editor: 'chips'; label: string } & WordsShape)
  | ({ key: 'specialStages' } & { editor: 'chips'; label: string } & WordsShape)
  | ({ key: 'chronicConditions' } & { editor: 'chips'; label: string } & WordsShape)
  | ({ key: 'dietaryPreferences' } & { editor: 'chips'; label: string } & WordsShape)
  | ({ key: 'notes' } & TextShape)

export type FieldKey = FieldSpec['key']

/** 两个自由文本框 —— 只有它们走「收起时写」那套草稿(见 draftPatch) */
export type DraftFieldKey = Extract<FieldSpec, { editor: 'text' }>['key']

/**
 * 十格的元数据。**数组的顺序就是它们在档案页上的顺序** —— 验证脚本按它断言
 * 渲染出来的先后,所以 ProfileScreen 里 JSX 的次序必须和这里一致。
 *
 * 而这个顺序**跟着那四个分类走**:基本信息 / 健康信息 / 饮食信息。下面注释里的
 * 分组就是页面上那几张卡 —— 忌口那一大块不在表里(它不是「一格」,是一列带面板
 * 入口的行),所以它在每张卡里插在哪,由 ProfileScreen 决定。
 *
 * 形状照抄 `store/quota.ts` 的 `QUOTA_FIELDS` / `FIELD_BY_KEY`(同一个仓库里
 * 的同一套写法),不是新发明。
 *
 * 为什么不放进 `store/types.ts`(`BODY_FIELDS` 在那儿):`BODY_FIELDS` 被引导页
 * 和 `PickerSheet` 两处用;这张表只有本文件用,而且它带着 `editor` 和
 * placeholder 文案这两个**纯界面决定**。store 里放界面文案,下一个人就会以为
 * 那是数据的一部分。这条分界要留着,否则这张表迟早被搬过去。
 */
const SPECS: readonly FieldSpec[] = [
  /* --- 基本信息 --- */
  {
    key: 'name',
    editor: 'text',
    label: '称呼',
    value: (p) => p.name || '无',
    empty: (p) => !p.name,
    placeholder: '怎么称呼你',
    maxLength: 12,
  },
  {
    key: 'gender',
    editor: 'choice',
    label: '性别',
    value: (p) => p.gender || '无',
    empty: (p) => !p.gender,
    options: GENDERS.map((g) => ({ value: g as string, label: g as string })),
  },
  {
    key: 'birth',
    editor: 'picker',
    label: '出生日期',
    /*
      出生日期和年龄**并排**写在一行里:年龄是进 BMR 公式的那个数,出生日期是
      它的来处。只写年龄的话,用户看到「28 岁」却找不到改它的地方;只写出生
      日期的话,这一页就看不到那个真正在算的数字了。
    */
    value: (p) => `${formatBirth(p.birth)} · ${ageOf(p)}岁`,
  },
  { key: 'height', editor: 'picker', label: '身高', value: (p) => `${p.height}cm` },
  { key: 'weight', editor: 'picker', label: '体重', value: (p) => `${p.weight}kg` },

  /* --- 健康信息 --- */
  {
    key: 'specialStages',
    editor: 'chips',
    label: '特殊阶段',
    list: (p) => p.specialStages,
    options: SPECIAL_STAGES,
    other: { placeholder: '如「备孕」「甲状腺结节」' },
    patch: (next) => ({ specialStages: next }),
  },
  {
    key: 'chronicConditions',
    editor: 'chips',
    label: '慢性病',
    list: (p) => p.chronicConditions,
    options: CHRONIC_CONDITIONS,
    other: { placeholder: '如「甲状腺结节」' },
    patch: (next) => ({ chronicConditions: next }),
  },

  {
    key: 'notes',
    editor: 'text',
    /*
      「想告诉食衡的其他事」→「其他补充」（用户 2026-09-22 让改的）。

      旧名把**这一格的去向**写进了名字里（「告诉食衡」），而那是 `note` 那行已经在说的事
      （「这段话会原样发给食衡，和档案一起进上下文」）—— 名字只说这一格装什么就够了。
      说一句话变成说两遍，正是这一页一直在删的那种重复。

      ⚠️ 引导页最后一步仍然叫「补充说明」（`WelcomeScreen` 的 `STEPS`），是**同一个字段
      的第二个名字**。他这次只指了档案页，没让动引导页 —— 和「健康目标 / 饮食目标」
      一样是留着等他定的事，不要顺手统一。
    */
    label: '其他补充',
    value: (p) => p.notes || '无',
    empty: (p) => !p.notes,
    placeholder: '在吃什么药、医生交代过什么、几个人一起吃饭……',
    maxLength: 500,
    rows: 4,
    /*
      这两句指路都**只准指本组里的那一行**。

      它们原来都写着「请到「健康限制」里加」—— 那个词在页面上已经不存在了
      (那一组被拆成了健康信息 / 饮食信息),留着就是一块指向不存在的地方的
      牌子。而指路一旦跨组,用户要在两张卡之间来回找,那句话的成本就高过收益。

      所以:这一格在健康信息组的最末尾,它上面就是「过敏与用药」入口 —— 指它。
    */
    note: '这段话会原样发给食衡，和档案一起进上下文。它不算忌口 ——「花生」写在这里不会被逐道菜拦截，要拦菜请在上面「过敏与用药」里加。',
  },

  /* --- 饮食信息 --- */
  {
    key: 'goals',
    editor: 'chips',
    label: '饮食目标',
    list: (p) => p.goals,
    options: GOAL_PRESETS,
    other: { placeholder: '如「备孕」「增肌」' },
    patch: (next) => ({ goals: next }),
  },

  {
    key: 'dietaryPreferences',
    editor: 'chips',
    label: '饮食偏好',
    list: (p) => p.dietaryPreferences,
    options: DIET_PRESET_WORDS,
    /*
      只有这一格带 hint。它挡的是一个**填错框**的误解:「花生」填在偏好里和
      填在「忌口」里行为完全不同 —— 后者会被拿去对菜名做裸词子串匹配(硬拦截),
      偏好只是给模型看的一句话。不说明的话,过敏的人会填进偏好,然后拦截
      **静默地**不生效,而那正是这个 App 存在的理由。

      判据(用户 2026-09-22 傍晚定,见 `Profile.dietaryPreferences` 上面那张表):
      **喜欢吃的 / 不想吃的**。喜欢吃什么进这一格;不想吃的 —— 具体食物也好、
      「素食」这种一整类也好 —— 一律进「忌口」;口味轻重进「饮食目标」。

      ⚠️ 这张判据一天之内换过三次,这一格是**唯一一处三次都改了文案**的地方:
        · 上午查出这一格自己在教用户填错框:预设词摆着「不吃香菜」「忌生冷」,
          placeholder 写着「不吃葱姜蒜」—— 三个都是忌口,却摆在**不拦**的这一格,
          点一下就进去了。hint 那句「要拦菜请用下面『忌口』」和它自己的预设词
          互相打脸。那次换掉了预设词和 placeholder。
        · 下午按「具体食物 / 整体模式」分,「素食」这类整体说法归到这一格。
        · 傍晚按「喜欢吃的 / 不想吃的」分,「素食」搬去忌口 —— 这一格收窄成
          **只收喜欢吃什么**,hint 里那句「不想吃的具体食物」跟着变成
          「不想吃的(包括素食这种一整类)」。

      ⚠️ hint 里的指路牌**必须和它指的那一行逐字相同**。入口行这一天的名字是
      「忌口」→「忌口与不爱吃」→ 又回到「忌口」,每次改名都要回来改这里 ——
      留着旧的,用户照着去页面上找一个不存在的名字。

      ⚠️ 这一格自己的性质只有一个:**不会拦菜**。写这一格永远不弹冲突卡,
      和它装的是什么词无关。所以 hint 只说这一句 + 指路,不替下面那格下断语。

      特殊阶段 / 慢性病不带 hint:勾上它们的后果,这一页下面「这些数字为什么
      是这样」已经逐条写着,再说一遍就是同一件事的第二个说法。
    */
    other: {
      placeholder: '如「爱喝汤」',
      hint: '这一栏只写喜欢吃什么，只作为参考告诉食衡，不会被拿去拦菜。不想吃的（具体食物，或「素食」这类一整类的说法）请写进下面「忌口」。',
    },
    patch: (next) => ({ dietaryPreferences: next }),
  },
]

export const FIELD_KEYS: FieldKey[] = SPECS.map((s) => s.key)

const BY_KEY = new Map<FieldKey, FieldSpec>(SPECS.map((s) => [s.key, s]))

/** 按 key 取元数据。和 `quotaField()` 一样:拿不到就抛,不静默给一个默认值 */
export function fieldSpec(key: FieldKey): FieldSpec {
  const s = BY_KEY.get(key)
  if (!s) throw new Error(`未知的档案字段: ${key}`)
  return s
}

/* ------------------------------------------------------------
   写入规则
   ------------------------------------------------------------ */

/**
 * 自由文本框收起时要写什么 —— **没改就返回 `null`**。
 *
 * 「没改就不写」不是省事,是必须的:抽屉每开合一次都会走一遍这里,不挡的话
 * 每次点开再点回去都是一次 `localStorage.setItem`(见 ProfileScreen 里关于
 * 落盘代价的那段)。
 *
 * 清空**算一次修改**,不拦。引导页那道「称呼和性别要填」是靠一颗会变灰的
 * 保存键实现的,就地编辑没有那颗键 —— 唯一能拦住清空的写法是「静默地不写」,
 * 而用户清空了、看见了清空、再点开又回来了,正是本仓库最反对的那类失败。
 * 空名字在那一行显示「无」,和其余九格空态同一个词。
 *
 * 单独导出成纯函数,是因为「清空算不算一次修改」是一条**规则**,而它静态 SSR
 * 断不到(碰不到 `onChange`)—— 抽成纯函数之后验证脚本可以直接调它。
 */
export function draftPatch(
  field: DraftFieldKey,
  draft: string,
  profile: Profile,
): Partial<Profile> | null {
  const next = draft.trim()
  if (next === profile[field]) return null
  return field === 'name' ? { name: next } : { notes: next }
}

/**
 * 打开某一格时,抽屉里那个框该从什么字开始。
 *
 * 看起来像一行废话(`profile[key]`),但它是**防静默清空**的那一道:
 *
 * 草稿要是从 `''` 起步,用户点开「补充说明」、什么都不动、再点回去,
 * `draftPatch` 拿 `''` 和档案里那段话一比 —— 不相等,于是老老实实写下去一条
 * 空的 notes。用户看到的是「点了一下,我写的东西没了」,而且没有任何报错。
 * 「称呼」同理(而且名字被清掉比备注被清掉更显眼)。
 *
 * 抽成导出的纯函数是因为这条链子在静态 SSR 里断不到:渲染看见的是
 * `draft → <textarea>` 那半截,`档案 → draft` 那半截要 `toggle` 真的跑一遍
 * 才发生,而渲染不跑事件。所以验证脚本直接调它。
 */
export function draftSeed(key: FieldKey, profile: Profile): string {
  const spec = fieldSpec(key)
  return spec.editor === 'text' ? profile[spec.key] : ''
}

/* ------------------------------------------------------------
   组件
   ------------------------------------------------------------ */

interface InlineFieldProps {
  field: FieldKey
  profile: Profile
  /** 这一格开着没有。「谁开着」的状态不在本组件里 —— 见 ProfileScreen 里那段 */
  open: boolean
  /** 点这一行:开着就收起,关着就展开 */
  onToggle: () => void
  /**
   * 自由文本框的草稿。**由 ProfileScreen 持有。**
   *
   * 草稿一旦住在本组件里,「收起时写」就退化成「卸载时写」—— 而卸载不由我们
   * 控制(点标签栏换页时这块编辑区是直接被拿掉的,React 不保证那一刻还派发
   * `onBlur`)。放在上一层,`toggle` 才有机会在拿掉它之前先把草稿写掉。
   */
  draft?: string
  onDraft?: (v: string) => void
  /** 一次编辑 → 交给调用方写档案(并问配额) */
  onPatch: (patch: Partial<Profile>) => void
}

export function InlineField({ field, profile, open, onToggle, draft, onDraft, onPatch }: InlineFieldProps) {
  const spec = fieldSpec(field)
  const blockId = `profile-field-${field}`

  /* 展开块的开合只对「下面真的有东西」的那几族成立 —— 体征点开的是面板 */
  const disclosure = spec.editor !== 'picker'

  /* ---------- 触发器 ---------- */
  /*
    十格共用这一条路。

    ⚠️ 空态一律走 `ListRow` 的 `secondary` 值:**灰 13px,落在右边那一列**。
    这一页上的「无」永远是「某个字段的值」,从来没有当过「某一行的名字」——
    忌口那两组原来是个例外(空着时渲染 `<ListRow label="无" />`,一个黑
    15px 的「无」占着行名的位置),用户看到的是一行叫「无」的东西。那处已经
    改成同样的值位灰字(见 ProfileScreen 里 `restrictionRows` 的空态)。
  */
  const trigger = (
    <ListRow
      label={spec.label}
      value={spec.editor === 'chips' ? spec.list(profile).join('、') || '无' : spec.value(profile)}
      secondary={
        spec.editor === 'chips' ? spec.list(profile).length === 0 : spec.editor !== 'picker' && spec.empty(profile)
      }
      chevron
      onClick={onToggle}
      /* 体征那一行不带:它下面没有可开合的东西,打开的是一层对话框 */
      expanded={disclosure ? open : undefined}
      /*
        `aria-controls` 只在展开块**真的渲染出来**时才写。收着的时候那个 id
        在文档里不存在,指向一个不存在的 id 比不写更糟(读屏会跳到一个空地方)。
        于是页面上有一条能断言的不变量:**有 `aria-controls` ⟺ 那一格开着
        ⟺ 那个 id 真的在产物里**。
      */
      controls={disclosure && open ? blockId : undefined}
    />
  )

  /* ---------- 展开块 ---------- */
  const drawer =
    open && disclosure ? (
      /*
        没有 `px`:每一族控件自带自己的左右内边距(`TextField` / `TextArea` 自带
        `px-4`,`ChoiceChips` 由调用处传 `px-4`),这样每一族都和上面那一行对齐。

        **不靠追加 `px-0` 去抵消子组件自带的 `px-4`** —— Tailwind 的同类工具类
        优先级相同,谁生效只看产物里的先后顺序,靠类名顺序覆盖是在赌打包结果。

        浅底 + 上边框:这一块是「正在编辑」,上面那一行是「只读」。两者的文字
        尺寸几乎一样,不给底色的话,展开之后分不清哪一段是能改的。
      */
      <div id={blockId} className="border-t border-line bg-black/[0.02] py-3.5">
        {spec.editor === 'text' &&
          (spec.rows === undefined ? (
            <TextField
              value={draft ?? ''}
              onChange={(v) => onDraft?.(v)}
              placeholder={spec.placeholder}
              maxLength={spec.maxLength}
              ariaLabel={spec.label}
            />
          ) : (
            <TextArea
              value={draft ?? ''}
              onChange={(v) => onDraft?.(v)}
              placeholder={spec.placeholder}
              maxLength={spec.maxLength}
              rows={spec.rows}
              ariaLabel={spec.label}
            />
          ))}

        {/*
          性别只有一条分段条,**上面不写可见的「性别」二字** —— 再上面那一行
          已经写着。引导页和刚删掉的编辑面板里都手写了一个 `<span>性别</span>`
          包着它,那是因为那两处它上面没有同名的一行;这里不写,是为了不把同一个
          词在同一格里说两遍。读屏名由 `label` 给。
        */}
        {spec.editor === 'choice' && (
          <div className="px-4">
            <SegmentedControl
              size="lg"
              label={spec.label}
              options={spec.options}
              value={profile.gender}
              onChange={(v) => onPatch({ gender: v })}
            />
          </div>
        )}

        {spec.editor === 'chips' && (
          <ChoiceChips
            className="px-4"
            label={spec.label}
            options={spec.options}
            value={spec.list(profile)}
            onChange={(next) => onPatch(spec.patch(next))}
            noneLabel="无"
            other={spec.other}
          />
        )}

        {spec.editor === 'text' && spec.note && (
          <p className="px-4 pt-2 text-[11px] leading-[15.93px] text-faint">{spec.note}</p>
        )}
      </div>
    ) : null

  return (
    <>
      {trigger}
      {drawer}
    </>
  )
}
