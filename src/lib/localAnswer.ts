/**
 * 本地应答(演示模式的兜底)
 * ===========================================================
 * 没有配 API Key 时,对话页会走到这里。
 *
 * 这里**不是**在假装自己是模型。设计上刻意避开两种做法:
 *   1. 不管问什么都回同一段预置文案 —— 问"我能吃西瓜吗"却答红烧肉补钾,
 *      一眼就能看穿是假的,反而暴露演示是空壳
 *   2. 假装是 AI 生成的 —— 用户有权知道自己在跟什么说话
 *
 * 实际做法:按关键词命中一个**规则**,再用你**真实的当天记录和档案配额**算一段回答。
 * 数字都是真的,只是推理是写死的规则。界面上会挂一条「演示模式」的说明,
 * 把这件事讲清楚。接上 Key 之后这段代码就退化成降级路径。
 */

import { quotaBasisLine, type QuotaKey } from '../store/quota'
import type { DayStats, WeekTrend } from '../store/derive'
import type { Profile } from '../store/types'

const pct = (v: number, limit: number) => Math.round((v / limit) * 100)

/**
 * 「这段话里的数字是照档案里哪一条来的」—— 追加在回答末尾的一行。
 *
 * 形如 `\n\n依据 · 高血压 → 钠上限 1500mg`。**没有引用任何配额数字的主题
 * (饮水)也可能有条目** —— 它引的是饮水目标。真正没有的时候返回空串,
 * 由 `splitBasis` 那边不画那一行。
 *
 * ⚠️ **必须留在最后一段**,而且必须还是这个 `\n\n依据 · ` 开头 ——
 * `ChatTranscript` 的 `splitBasis` 就是照着这段前缀把最后一行摘出来的。
 * 放到中间去,屏幕上会变成正文里的普通一行(12/17.38 的正文色),
 * 而它本该是那行更小更淡的小字。
 *
 * 同一句话里的多项按**「谁定的」归并**,归并本身在 `quota.ts` 的
 * `quotaBasisLine` 里 —— 发给 agent 的那份用的也是它。
 */
function basisLine(profile: Profile, keys: QuotaKey[]): string {
  const line = quotaBasisLine(profile, keys)
  return line ? `\n\n依据 · ${line}` : ''
}

/** 命中哪个主题 */
type Topic = 'sodium' | 'kcal' | 'sugar' | 'protein' | 'dinner' | 'water' | 'general'

const RULES: { topic: Topic; words: string[] }[] = [
  { topic: 'sodium', words: ['盐', '钠', '咸', '高血压', '血压', '重口'] },
  { topic: 'sugar', words: ['糖', '甜', '奶茶', '蛋糕', '血糖', '糖尿病'] },
  { topic: 'protein', words: ['蛋白', '增肌', '肌肉', '鸡蛋', '豆腐', '牛奶'] },
  { topic: 'kcal', words: ['热量', '卡路里', '卡', '胖', '减肥', '减脂', '体重'] },
  { topic: 'dinner', words: ['晚餐', '晚饭', '吃什么', '推荐', '晚餐吃', '下一餐'] },
  { topic: 'water', words: ['水', '喝', '饮水', '汤'] },
]

function classify(query: string): Topic {
  for (const rule of RULES) {
    if (rule.words.some((w) => query.includes(w))) return rule.topic
  }
  return 'general'
}

/**
 * 生成一段本地回答。
 *
 * 注意所有数字都来自 stats / trend / profile,没有一个是写死的 ——
 * 所以同一个人问两次"今天盐吃多了吗",早上和晚上得到的回答是不一样的。
 */
export function answerLocally(query: string, stats: DayStats, trend: WeekTrend, profile: Profile): string {
  const n = stats.nutrition
  const q = profile.quota
  const leftSodium = q.sodium - n.sodium
  const leftKcal = q.kcal - n.kcal
  const leftProtein = q.protein - n.protein

  const noRecord =
    stats.mealCount === 0 ? '今天还没有记录，下面的判断基于 0 摄入。先记一餐，回答会准得多。\n\n' : ''

  switch (classify(query)) {
    case 'sodium':
      return (
        noRecord +
        `今天钠摄入约 ${Math.round(n.sodium)}mg，是上限 ${q.sodium}mg 的 ${pct(n.sodium, q.sodium)}%。` +
        (leftSodium >= 0
          ? `还剩 ${Math.round(leftSodium)}mg 的余量。\n\n`
          : `已经超出 ${Math.round(-leftSodium)}mg。\n\n`) +
        '想降钠，优先改做法而不是改食材：清蒸、白灼、凉拌代替红烧和干煸；' +
        '汤只吃料不喝汤，钠大半在汤底；酱油和蚝油减半，用葱姜蒜和醋补味。\n' +
        '（《中国居民膳食指南 2022》建议成人每日食盐不超过 5g，约合钠 2000mg。）' +
        /*
          上面那段话里出现了**两个**钠的数(上限 q.sodium 和余量),而它们是
          同一项 —— 而且末了那句「指南建议 2000mg」是**泛泛的成人值**,不是
          这个人档案里的那个数。依据行要解释的正是「屏幕上的 2000 和指南的
          2000 为什么可能不是一个数」。
        */
        basisLine(profile, ['sodium'])
      )

    case 'sugar':
      return (
        noRecord +
        `今天添加糖约 ${Math.round(n.sugar)}g，占建议上限 ${q.sugar}g 的 ${pct(n.sugar, q.sugar)}%。\n\n` +
        '添加糖指的是加工时额外加进去的糖 —— 水果里的果糖、牛奶里的乳糖都不算，' +
        '所以控糖不等于戒水果。真正的大头通常是含糖饮料和甜口菜。\n' +
        (n.sugar > q.sugar * 0.6
          ? '今天已经偏高了，接下来选无糖茶饮或白水更稳妥。'
          : '目前还在合理区间。') +
        basisLine(profile, ['sugar'])
      )

    case 'protein':
      return (
        noRecord +
        `今天蛋白质约 ${Math.round(n.protein)}g，目标 ${q.protein}g，已完成 ${pct(n.protein, q.protein)}%。` +
        (leftProtein > 0 ? `还差 ${Math.round(leftProtein)}g。\n\n` : '已经达标。\n\n') +
        '一餐补 15–20g 蛋白质大致相当于：鸡蛋 2 个 + 牛奶 250ml，或北豆腐 150g，或鸡胸肉 100g。' +
        '分散到三餐比集中在晚餐吸收更平稳。' +
        basisLine(profile, ['protein'])
      )

    case 'kcal':
      return (
        noRecord +
        `今天已摄入约 ${Math.round(n.kcal)} kcal，目标 ${q.kcal} kcal，占 ${pct(n.kcal, q.kcal)}%。` +
        (leftKcal >= 0 ? `还剩 ${Math.round(leftKcal)} kcal。\n\n` : `已超出 ${Math.round(-leftKcal)} kcal。\n\n`) +
        '判断一餐热量的粗略口径：一拳头主食约 200 kcal，一掌心肉约 200–300 kcal，' +
        '一勺烹调油约 90 kcal。油的量往往比主食更容易被低估。' +
        basisLine(profile, ['kcal'])
      )

    case 'dinner':
      return (
        noRecord +
        `按今天的记录，晚餐的余量是 ${Math.max(0, Math.round(leftKcal))} kcal、${Math.max(0, Math.round(leftSodium))}mg 钠` +
        (leftProtein > 0 ? `、蛋白质 ${Math.round(leftProtein)}g。\n\n` : '。\n\n') +
        (leftSodium < q.sodium * 0.25
          ? '钠的余量已经很紧，晚餐建议以蒸、煮为主：清蒸鱼或白灼虾 + 一份绿叶菜 + 半碗米饭，不喝汤。'
          : '晚餐可以正常吃：一份优质蛋白（鱼、虾、鸡胸或豆腐）+ 一到两份蔬菜 + 一拳头主食。' +
            '先吃菜再吃主食，餐后血糖会更平稳。') +
        // 这一段把三项余量都念了一遍,所以三项都引 —— 三项的依据按「谁定的」归并
        basisLine(profile, ['kcal', 'sodium', 'protein'])
      )

    case 'water':
      return (
        `今天的饮水目标是 ${q.water}ml。\n\n` +
        '补水本身不直接参与健康分，但排水钠有帮助：钠摄入偏高的那天，' +
        '足量饮水能减轻身体的负担。含糖饮料不算在内 —— 那会同时推高添加糖。' +
        /*
          ⚠️ 这一段是**唯一一处** `noRecord` 不参与的主题 —— 饮水目标和你今天
          记没记饭无关。这条分支原来就没有 `noRecord`,这次加依据行也没动它。
        */
        basisLine(profile, ['water'])
      )

    default:
      return (
        noRecord +
        `今天的概况：${stats.mealCount} 餐，约 ${Math.round(n.kcal)} kcal（目标的 ${pct(n.kcal, q.kcal)}%），` +
        `钠 ${Math.round(n.sodium)}mg（上限的 ${pct(n.sodium, q.sodium)}%），` +
        `蛋白质 ${Math.round(n.protein)}g（目标的 ${pct(n.protein, q.protein)}%）。\n\n` +
        (trend.sodiumDeltaPct !== null
          ? `本周日均钠比上周 ${trend.sodiumDeltaPct <= 0 ? '下降' : '上升'} ${Math.abs(trend.sodiumDeltaPct)}%。\n\n`
          : '') +
        '你可以问我：今天盐吃多了吗 / 晚餐吃什么合适 / 蛋白质够不够 / 热量还剩多少。' +
        '（当前是演示模式，这些回答由本地规则结合你的记录生成，不是模型生成的。）' +
        // 概况那一句把三项都念了一遍,所以三项都引 —— 和 dinner 同一口径
        basisLine(profile, ['kcal', 'sodium', 'protein'])
      )
  }
}
