import { birthForAge } from '../lib/age'
import { quotaFor, type QuotaInput } from './quota'
import type { Profile } from './types'

/**
 * 两份内置档案。
 *
 * 配额**不再写在这里** —— 八个数字由 quota.ts 的 `quotaFor()` 从体征算出来。
 * 原来这里是一组手写的常量,而档案页底下写着「配额依据《中国居民膳食指南 2022》
 * **结合基础信息自动计算**」:那句话和这组常量之间的矛盾挂了很久。现在
 * 「自动计算」算出来的默认值,恰好就是当年手写的那八个数字(见 quota.ts 文件头),
 * 所以改成推导是**零行为变化** —— 这句承诺从今天起是真的。
 *
 * ⚠️ 钠的口径:设计稿档案页写「钠 5g」,结果页却拿 500mg 当上限,差了 10 倍。
 * 原因是把**食盐**和**钠**混为一谈了:食盐 ≤5g/日 ≈ 钠 2000mg。
 * 这里统一用钠 2000mg/日,与食物库的 mg 口径一致。完整说明见 quota.ts 的 SODIUM。
 */

/**
 * 演示档案的基本资料 —— 没有 quota,它就是 `quotaFor` 的输入。
 *
 * `birth` 不是写死的 1998 年:`birthForAge(28)` 让它**永远是 28 岁**
 * (理由见 lib/age.ts —— 这个 28 是要配那八个数字的,不能随日历漂)。
 */
const DEMO_BASE: QuotaInput = {
  name: '我的档案',
  gender: '女',
  birth: birthForAge(28),
  height: 165,
  weight: 55,
  goals: ['控盐', '均衡饮食', '控糖'],
  // item 是裸词(「花生」),界面上的「花生过敏」由 type 拼出来 ——
  // 工作流拦的是 item 的子串匹配,写成「花生过敏」就永远匹配不上,见 types.ts
  //
  // 第二条(「香菜」)是 2026-09-22 加的,**故意的**:演示档案里必须看得见
  // 饮食那一段有一条**会拦**的忌口 —— 记一餐含香菜的菜就会弹红色冲突卡,
  // 那是这一整条动线唯一能演示出来的方式。它落在**饮食**那张卡上
  // (判据见 types.ts 的 RESTRICTION_SECTIONS)。
  // (它下午曾经是 `dislike`「不爱吃」、等级「低危」,傍晚那个类型整个删掉了
  //  —— 于是它变成一条普通的 `taboo`。等级也跟着回到「低危」:演示档案的
  //  冲突卡上写「低危」比「高危」温和,而它照样会被逐道菜核对。)
  restrictions: [
    { item: '花生', type: 'allergy', level: '高危' },
    { item: '香菜', type: 'taboo', level: '低危' },
  ],
  // 演示档案里放一个「喜欢吃什么」。这一格今天是**唯一一处不参与拦截的饮食
  // 信息**,摆一个「爱吃鱼」正好把这条分界演示出来 —— 偏好里的词永远不会弹卡。
  dietaryPreferences: ['爱吃鱼'],
  // 「没有特殊阶段」是空数组,不是里面装一个「无」—— 见 types.ts 的 SPECIAL_STAGES
  specialStages: [],
  chronicConditions: [],
  notes: '',
  quotaOverrides: {},
}

/**
 * 演示档案 —— 「先用演示档案看看」和「恢复演示数据」装的就是这一份。
 *
 * `quotaFor(DEMO_BASE)` 与当年那八个手写常量逐字段相等,这条有断言盯着。
 */
export const DEFAULT_PROFILE: Profile = { ...DEMO_BASE, quota: quotaFor(DEMO_BASE) }

/** 还没建档时的基本资料 —— 不是零值,理由见 BLANK_PROFILE */
const BLANK_BASE: QuotaInput = {
  name: '',
  gender: '',
  birth: birthForAge(30),
  height: 165,
  weight: 55,
  goals: [],
  restrictions: [],
  dietaryPreferences: [],
  // 「没有特殊阶段」是空数组,不是里面装一个「无」—— 见 types.ts 的 SPECIAL_STAGES
  specialStages: [],
  chronicConditions: [],
  notes: '',
  quotaOverrides: {},
}

/**
 * 空档案 —— 首次打开、还没走完建档引导时的那一份。
 *
 * ⚠️ **它必须有一份正常的配额,不能是零。** derive.ts 的除法没有零守卫,
 * 全零配额会让首页那行摄入比例**无条件**渲染出 `NaN%`(0 餐也显示),
 * advice.ts 的钠与蛋白质建议变成结构性不可达,`entryTint` 永远不出危险色。
 * 一个演示里崩在 NaN 上,比多填两个默认数字糟得多。
 *
 * 所以体征取一组中性默认值(30 岁 / 165cm / 55kg),让配额落在一个正常区间;
 * 引导第 1 步的步进器就从这三个数开始,用户看得到、也改得动。
 *
 * `gender` 刻意留空 —— 它决定 BMR 公式里那 ±166 的常数,不该替用户默认成
 * 某一性别(引导里性别是必填)。`quotaFor` 对认不出的性别走女性公式(更保守),
 * 空串自然落到那一支。
 */
export const BLANK_PROFILE: Profile = { ...BLANK_BASE, quota: quotaFor(BLANK_BASE) }
