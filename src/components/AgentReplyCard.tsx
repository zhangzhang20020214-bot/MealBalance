import { AdviceList, RichText } from './AdviceList'
import { Icon } from './Icons'
import { Badge, Card, IconTile } from './ui'
import { nutritionHasContent, splitNumbered, type AgentReply, type RiskLevel } from '../lib/agentReply'

/**
 * Agent 结构化回复的渲染
 * ===========================================================
 * 为什么不塞进聊天气泡:气泡是 300pt 宽的,而这个回复里有「菜品 + 适宜与否 +
 * 理由」三列信息,还有做法步骤和改良说明。挤进气泡只会变成一坨。所以
 * 纯文本回复走气泡,结构化回复走整宽卡片 —— 内容形态决定版式。
 *
 * 色板、圆角、字号全部复用 ui/ 里那套设计系统,和结果页是同一套语言:
 * 危险卡用 danger-*,提醒用 warn-*,正常用 brand-*。
 */

/** 风险等级 → 顶部结论条的配色与图标。unknown 走中性灰,不冒充结论 */
const RISK_TONES: Record<
  RiskLevel,
  { wrap: string; dot: string; title: string; body: string; icon: string; badge: 'danger' | 'warn' | 'brand' | 'neutral' }
> = {
  high: {
    wrap: 'border-danger-line bg-danger-bg',
    dot: 'bg-danger text-white',
    title: 'text-danger-text',
    body: 'text-danger-body',
    icon: 'warning',
    badge: 'danger',
  },
  medium: {
    wrap: 'border-warn-line bg-warn-bg',
    dot: 'bg-warn text-white',
    title: 'text-warn-text',
    body: 'text-warn-body',
    icon: 'alertCircle',
    badge: 'warn',
  },
  low: {
    wrap: 'border-brand-line bg-brand-bg',
    dot: 'bg-brand text-white',
    title: 'text-brand-text',
    body: 'text-brand-body',
    icon: 'shieldCheck',
    badge: 'brand',
  },
  unknown: {
    wrap: 'border-line bg-card',
    dot: 'bg-muted text-white',
    title: 'text-ink',
    body: 'text-ink-body',
    icon: 'bulb',
    badge: 'neutral',
  },
}

const RISK_LABEL: Record<RiskLevel, string> = {
  high: '高风险',
  medium: '需注意',
  low: '风险较低',
  unknown: '提示',
}

/**
 * 卡顶上那张结论条 —— 一块提醒,**两张卡共用**(2026-09-24)。
 *
 * ## 为什么它得是一个组件
 *
 * 用户 2026-09-24 定的摆法就是这一块(原话是「卡顶上那张结论条」)。它从前只长在
 * 这张卡里,而对话页发图那条路**真正画出来的往往是另一张卡**:认出了菜就归
 * `MealResultCard`(见 `ChatTranscript` 那条分支),而那张卡只接菜品和建议,
 * `risk` 一个字都不画 —— 于是「第一条明显的提醒」在屏幕上**根本没有**:
 * 菜照常列,那道菜里有你不能吃的东西这件事,一个字都不提。
 *
 * 换句话说,这不是「提醒写得不够显眼」,是**它长在了另一张卡上**。同一个东西
 * 两处各写一遍早晚会分叉(那一块是这个仓库踩过的坑),所以只有这一个实现。
 *
 * ## 判据
 *
 * `message` 和 `items` 全空 → 返回 `null`。一条没有内容的空条不是提醒,是噪声
 * (低风险且没话说时不为「一切正常」单开一块,那是在占地方)。
 *
 * 配色跟着 `level` 走,见 `RISK_TONES` —— 拦截降级那条路会把它钉在最高那档
 * (见 `agentReply.demoteHardBlock`)。
 */
export function RiskStrip({ risk }: { risk: AgentReply['risk'] }) {
  if (risk.message.length === 0 && risk.items.length === 0) return null
  const t = RISK_TONES[risk.level]

  return (
    <div className={`flex items-start gap-3 rounded-[20px] border p-4 ${t.wrap}`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${t.dot}`}>
        <Icon name={t.icon} size={20} strokeWidth={2.2} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-[13px] leading-[16px] font-bold ${t.title}`}>{RISK_LABEL[risk.level]}</span>
        <span className={`text-[13px] leading-[18.82px] ${t.body}`}>
          <RichText text={risk.message} />
        </span>
        {risk.items.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {risk.items.map((item) => (
              // 颜色跟着 level 走 —— items 不只是过敏原,单菜分析里
              // 会给「高油、高盐」这类条目,那不值得一律标红
              <Badge key={item} tone={t.badge}>
                {item}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function AgentReplyCard({ reply }: { reply: AgentReply }) {
  /* ---------- 拦截分支:过敏等硬拦截,风险信息就是全部内容 ---------- */
  if (reply.blocked) {
    const t = RISK_TONES.high
    return (
      <div className="flex w-full flex-col gap-3">
        <div className={`flex items-start gap-3 rounded-[20px] border p-4 ${t.wrap}`}>
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${t.dot}`}>
            <Icon name={t.icon} size={20} strokeWidth={2.2} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={`text-[15px] leading-[18px] font-bold ${t.title}`}>已为你拦截这条建议</span>
            <span className={`text-[13px] leading-[18.82px] ${t.body}`}>
              <RichText text={reply.risk.message || '检测到与你的健康档案冲突的成分。'} />
            </span>
            {reply.risk.items.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {reply.risk.items.map((item) => (
                  <Badge key={item} tone="danger">
                    {item}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        {reply.disclaimer && <Footnote text={reply.disclaimer} />}
      </div>
    )
  }

  /** 菜品块的整块结论。空数组时 `every` 是 true,但那一块本来就不渲染,读不到 */
  const allSuitable = reply.dishes.every((d) => d.suitable)

  return (
    <div className="flex w-full flex-col gap-3">
      {/* ---------- 风险结论条 ---------- */}
      <RiskStrip risk={reply.risk} />

      {/* ---------- 识别到的食材 ---------- */}
      {/*
        一块「原料清单」,不是一份菜单:胶囊里是「名称 · 分类」,没有营养值、
        也没有适宜与否。**它和菜品块的分工是硬的** —— 把食材混进 dishes 会凭空
        多出几道「推荐」的菜(见 `AgentIngredient` 那段注释)。
      */}
      {reply.ingredients.length > 0 && (
        <Card>
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
            <span className="text-[13px] leading-[15.6px] font-medium text-muted">🥦 识别到的食材</span>
            {/*
              右边写「N 样」而不是膳享那个 mode 徽章:`mode` 是个内部枚举
              (`plate` / `fridge` / …),印到屏幕上就得再维护一张中英对照表,
              而它对用户不解释任何事 —— 这一块是食材还是菜,看内容就知道。
            */}
            <span className="text-[11px] leading-[15.6px] text-faint">{reply.ingredients.length} 样</span>
          </div>
          <div className="flex flex-wrap gap-1.5 px-4 pb-4">
            {reply.ingredients.map((ing, i) => (
              <span
                key={`${ing.name}-${i}`}
                className="inline-flex items-center rounded-[12px] bg-brand-bg px-2.5 py-1 text-[12px] leading-[16px] text-brand-text"
              >
                {/* 有分类才是「名称 · 分类」;没有就只印名字,不留一个孤零零的「 · 」 */}
                {ing.category ? `${ing.name} · ${ing.category}` : ing.name}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* ---------- 菜品 / 条目 ---------- */}
      {reply.dishes.length > 0 && (
        <Card>
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
            {/*
              标题用模型自己起的那句(`title`),没有才退回「推荐」。
              以前这里是按 mode 二选一的写死文案(推荐搭配 / 涉及菜品),两句话
              说的是同一件事 —— 「这些菜怎么样」—— 而哪个对,模型比 mode 清楚。
            */}
            <span className="text-[13px] leading-[15.6px] font-medium text-muted">🍽 {reply.title || '推荐'}</span>
            {/*
              这一颗是**整块**的结论,判据是「每一道都 suitable」。
              ⚠️ 别写成 `some`:那会让一道慎选混在里面时仍然显示「全部适合当前档案」,
              而这句话是要被当成结论读的。
            */}
            <Badge tone={allSuitable ? 'brand' : 'warn'}>
              {allSuitable ? '全部适合当前档案' : '含慎选项'}
            </Badge>
          </div>

          {reply.dishes.map((dish, i) => (
            <div key={`${dish.name}-${i}`}>
              {i > 0 && (
                <div className="pl-[70px]">
                  <div className="h-px bg-line" />
                </div>
              )}
              <div className="flex items-start gap-3 px-4 py-3">
                <IconTile
                  name={dish.suitable ? 'plate' : 'warning'}
                  size={42}
                  radius={12}
                  tone={dish.suitable ? 'brand' : 'danger'}
                  iconSize={20}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[15px] leading-[22px] text-ink">{dish.name}</span>
                    {/*
                      「推荐 / 慎选」,不是「适宜 / 不宜」:后者读起来像一句
                      **医学判断**(这道菜对你的病好不好),而这里能说的只是
                      「模型建议你点/回避」。「慎选」也留了余地 —— 它不禁止。
                    */}
                    <Badge tone={dish.suitable ? 'brand' : 'danger'}>{dish.suitable ? '推荐' : '慎选'}</Badge>
                  </div>

                  {dish.reason && (
                    <span className="text-[13px] leading-[18.82px] text-muted">
                      <RichText text={dish.reason} />
                    </span>
                  )}

                  {/* 做法步骤 —— 只有单菜分析会给 */}
                  {dish.recipe.length > 0 && (
                    <ol className="mt-1 flex flex-col gap-1 border-t border-line pt-2">
                      {dish.recipe.map((step, si) => (
                        <li key={si} className="flex gap-2 text-[12px] leading-[18px] text-muted">
                          {/*
                            序号用带圈数字,和膳享+ 那张卡一样(2026-09-23)。
                            ⚠️ 只换字形,字号和颜色仍走本仓库那套设计系统 ——
                            颜色是这一屏的语言,不是回答格式的一部分。
                          */}
                          <span className="shrink-0 font-medium text-faint">{CIRCLED[si] ?? `${si + 1}.`}</span>
                          <span className="min-w-0 flex-1">
                            <RichText text={step} />
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {/* 健康改良 —— 模型常把多条建议串成一段,拆开更好读 */}
                  {dish.healthModification && (
                    <div className="mt-1.5 flex flex-col gap-1 rounded-[12px] bg-brand-bg px-3 py-2.5">
                      <span className="text-[12px] leading-[14px] font-medium text-brand-text">健康改良</span>
                      {splitNumbered(dish.healthModification).map((line, li) => (
                        <span key={li} className="text-[12px] leading-[18px] text-brand-body">
                          <RichText text={line} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* ---------- 营养标签 ---------- */}
      {/*
        包装上印的那份东西:配料表 + 营养成分表 + 风险项。和上面那块食材清单
        是两回事(一个是「冰箱里有什么」,一个是「这包东西里有什么」),所以
        **两块各自渲染、不合并** —— 合并之后就没法说清哪一行来自哪里。

        判据用 `nutritionHasContent`,和解析层末尾那条空壳守卫用的是同一个函数:
        两处各写一遍三连判,早晚会有一处漏掉 `riskItems`。
      */}
      {nutritionHasContent(reply.nutrition) && (
        <Card>
          <div className="px-4 pt-3.5 pb-2">
            <span className="text-[13px] leading-[15.6px] font-medium text-muted">🏷 营养标签</span>
          </div>

          {reply.nutrition.ingredients.length > 0 && (
            <div className="flex flex-col gap-1 px-4 pb-3">
              <span className="text-[12px] leading-[14px] font-medium text-faint">配料</span>
              <span className="text-[13px] leading-[19px] text-ink-body">
                {reply.nutrition.ingredients.join('、')}
              </span>
            </div>
          )}

          {reply.nutrition.labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-3">
              {/* 键值小格。`label` 和 `value` 是两个有名字的位置 ——
                  解析层把它们从对象转成数组,正是为了不让这里靠键顺序排版 */}
              {reply.nutrition.labels.map((l) => (
                <span
                  key={l.label}
                  className="inline-flex items-baseline gap-1.5 rounded-[12px] bg-brand-bg px-2.5 py-1"
                >
                  <span className="text-[11px] leading-[15px] text-brand-body">{l.label}</span>
                  <span className="tnum text-[12px] leading-[15px] font-medium text-brand-text">{l.value}</span>
                </span>
              ))}
            </div>
          )}

          {reply.nutrition.riskItems.length > 0 && (
            <div className="flex items-start gap-1.5 px-4 pb-4">
              <span className="text-[12px] leading-[18px] text-danger-text">⚠</span>
              <span className="text-[12px] leading-[18px] text-danger-text">
                风险项:{reply.nutrition.riskItems.join('、')}
              </span>
            </div>
          )}
        </Card>
      )}

      {/* ---------- 建议 ---------- */}
      {/*
        这一块和对话里那张餐卡的下半块是**同一个组件**(`AdviceList`)。
        2026-09-23 之前那边各写了一遍,而两处画的正是同一批建议 —— 分头改
        迟早会变成「同一批建议在两张卡上长得不一样」。
      */}
      {reply.advice.length > 0 && (
        <Card>
          <AdviceList lines={reply.advice} />
        </Card>
      )}

      {reply.disclaimer && <Footnote text={reply.disclaimer} />}
    </div>
  )
}

/**
 * 带圈数字 —— 做法的步骤序号(2026-09-23,照膳享+ 那张卡)。
 *
 * 只到十个:`⑩` 之后没有字形了,第 11 步印一个不存在的字符不如老实写「11.」。
 * ⚠️ 这是**序号不是层级**,所以外面仍然是 `<ol>`,别因为换了字形就改结构。
 */
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

/** 免责声明 —— 和结果页同一套脚注样式,前面加一个 ⚠(照膳享+ 那张卡) */
function Footnote({ text }: { text: string }) {
  return <p className="px-2.5 text-[11px] leading-[16px] text-faint">⚠ {text}</p>
}
