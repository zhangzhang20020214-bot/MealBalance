/**
 * 演示数据横幅 —— 降级路径上必须出现的那句话
 * ===========================================================
 * 没配 Key、连不上 Dify、上游报错时,下面的菜品和营养数字全是**本地随机组**的,
 * 和用户拍的那张照片没有任何关系。不说清楚,就等于把编出来的营养数据当成
 * 识别结果交给用户。
 *
 * 抽成组件而不是在两个屏幕里各写一遍:这句话是**诚实性要求**,不是装饰。
 * 分头维护早晚会在措辞上分叉,而分叉掉的那一份就是一处「把假数据说成真的」
 * 的缺口 —— 而这个仓库其它地方(demo 标签、未匹配显式按 0 计、宁可删掉
 * confidence 也不编一个数)都在防同一件事。
 *
 * 出现的位置:「确认分量」和「分析结果」—— 降级路径**两屏都会经过**,
 * 所以两屏都要挂。
 *
 * 注意这句话的主语是**照片**:「你拍的照片没有被上传,也不会存进日记」。
 * 说的不是那些菜 —— 用户之后是可以把这份演示数据归档进日记的(而且不该
 * 存照片,那正是这里要讲清楚的事)。所以两屏共用这一份文案都成立。
 */
import { Icon } from './Icons'

export function DemoDataBanner({ reason }: { reason: string }) {
  return (
    <div className="flex items-start gap-2 rounded-[14px] border border-warn-line bg-warn-bg px-3.5 py-2.5">
      <Icon name="bulb" size={16} className="mt-px shrink-0 text-warn" strokeWidth={2} />
      <span className="text-[12px] leading-[17.38px] text-warn-body">
        <b className="font-semibold">以下菜品为演示数据，不是识别结果。</b>
        {reason}。你拍的照片没有被上传，也不会存进日记。
      </span>
    </div>
  )
}
