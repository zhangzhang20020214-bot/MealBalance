import { NumberBadge } from './ui'

/**
 * 「💡 进食建议」那几行 —— 编号 + 文字
 * ===========================================================
 * 抽出来是因为**两张卡画的是同一份东西**:模型在一次回复里给出的那几条建议,
 * 既出现在 `AgentReplyCard`(白底 Card 包着),也出现在对话里那张餐卡
 * (`MealResultCard`,同一个 Card 里的下半块)。
 *
 * 两处的标题文案和每一行的样式**必须逐字相同** —— 同一批建议在两张卡上长得
 * 不一样,读起来就是两份结论。抽成组件挡的就是这个,理由和 `DishRow` 一样。
 *
 * ⚠️ 标题是**固定**的,不使用 `reply.title`:那句描述的是菜品,已经归菜品块了,
 * 同一句话在两个块头上各印一遍会让人以为有两份结论。
 *
 * ⚠️ 标题文案和块标题前那个图标照的是膳享+ 那张卡(2026-09-23)。膳享+ 那边
 * 「💡 进食建议」和「🎯 关键建议」是**二选一**,判据是「有没有带等级的建议」
 * —— 等级要模型给(`advice[].level`),而现在线上 agent 给的 advice 是纯文字,
 * 所以这里只能一直是「💡 进食建议」。等提示词给了等级,再补那半条判据。
 *
 * ⚠️ 序号只是计数、没有先后,所以外面是 `<div>`;结果页「进食顺序」那张卡的
 * 序号是**真正的次序**,那边用 `<ol>` —— 两边各自都是对的,别看着不一样就来「统一」。
 */
export function AdviceList({ lines }: { lines: readonly string[] }) {
  return (
    <>
      <div className="px-4 pt-3.5 pb-2">
        <span className="text-[13px] leading-[15.6px] font-medium text-muted">💡 进食建议</span>
      </div>
      <div className="flex flex-col gap-2.5 px-4 pb-4">
        {lines.map((line, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <NumberBadge>{i + 1}</NumberBadge>
            <span className="min-w-0 flex-1 text-[13px] leading-[19px] text-ink-body">
              <RichText text={line} />
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

/**
 * 模型偶尔会在正文里塞 Markdown 的 **加粗** 标记。
 * 原样渲染会露出星号,这里拆成真正的粗体。
 * 只处理加粗 —— 完整 Markdown 解析器在这里属于杀鸡用牛刀。
 *
 * 它和 `AdviceList` 住同一个文件,是因为**用它的两块内容离得很近**:
 * 这一块建议(两处卡片各画一遍),以及 `AgentReplyCard` 里那几句理由
 * (风险结论、菜品理由、做法、健康改良)。换句话说,凡是从模型嘴里出来的
 * 自由文本,渲染前都要过这里 —— 分开放只会变成有的地方处理、有的地方不处理。
 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}
