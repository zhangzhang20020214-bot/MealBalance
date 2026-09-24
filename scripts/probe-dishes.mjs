/**
 * 菜名匹配探针(开发用,不进产物)
 * ===========================================================
 * 把一批**真实会出现的菜名**喂进 `matchDishes`,看它们各自落在了哪一层、
 * 有没有落空、落空的又是些什么。跑法:npm run probe:dishes
 *
 * 为什么需要它
 * ------------------------------------------------------------
 * 「未收录」这件事在界面上是**看不见的** —— 用户看到的是一条警告框和几行
 * 按 0 计,看不到「原来土豆炖牛肉会落空」。要扩充食物库或别名表,得先知道
 * 缺的是哪些,**不能靠回忆自己昨天吃了什么**。
 *
 * 它同时盯另一类更隐蔽的问题:`via: 'contains'` 那一层是**双向子串**匹配,
 * 只要库里有一个 2 字的条目是菜名的子串就会命中 —— 而错配比落空更糟,
 * 落空会被显式标成「按 0 计」,错配不会(见 dishMatch.ts 里 COMBO_SEP 那段)。
 * 所以脚本把这层单独列出来,让人逐个 eye-ball。
 *
 * 这份清单**不是测试**,是排查工具 —— 它的输出需要人看。要防回归的是
 * `verify-loop.mjs` 里那张 golden 表,别把它们混为一谈。
 */

import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { matchDishes, normalizeDishName } = await server.ssrLoadModule('/src/lib/dishMatch.ts')
const { FOOD_BY_ID } = await server.ssrLoadModule('/src/data/foods.ts')
await server.close()

/* ------------------------------------------------------------
   待探的菜名
   ------------------------------------------------------------
   来源是「一个视觉模型看着中餐餐盘会说什么」:家常菜、外卖菜名、食堂菜、
   以及模型爱加的分量前缀(「一碗」「一份」)。刻意混进了一批**复合菜名**
   (土豆炖牛肉、豆腐菌菇汤),它们是最容易落空的一类。
   ------------------------------------------------------------ */
const DISHES = [
  // 主食
  '米饭', '白米饭', '一碗米饭', '200g米饭', '糙米饭', '杂粮饭', '馒头', '花卷',
  '全麦面包', '吐司', '面条', '牛肉面', '兰州拉面', '小笼包', '猪肉饺子', '水饺',
  '玉米', '红薯', '白粥', '小米粥', '燕麦粥', '蛋炒饭', '炒饭', '炒面',
  // 蛋奶豆
  '煮鸡蛋', '水煮蛋', '煎蛋', '荷包蛋', '牛奶', '豆浆', '无糖豆浆', '酸奶', '北豆腐', '嫩豆腐',
  // 肉类
  '红烧肉', '红烧排骨', '糖醋排骨', '宫保鸡丁', '香煎鸡胸肉', '白切鸡', '烤鸡腿',
  '番茄炒蛋', '西红柿炒鸡蛋', '青椒肉丝', '回锅肉', '煎牛排', '卤牛肉',
  '土豆炖牛肉', '糖醋里脊', '京酱肉丝', '梅菜扣肉', '水煮牛肉', '黑椒牛柳',
  // 水产
  '清蒸鱼', '清蒸鲈鱼', '白灼虾', '蒜蓉粉丝蒸虾', '香煎三文鱼', '水煮鱼', '酸菜鱼',
  // 蔬菜
  '清炒油麦菜', '蒜蓉菠菜', '白灼西兰花', '清炒西兰花', '凉拌黄瓜', '干煸四季豆',
  '麻婆豆腐', '清炒时蔬', '番茄', '圣女果', '干锅花菜', '上汤娃娃菜', '蚝油生菜', '拍黄瓜',
  // 水果
  '苹果', '香蕉', '橙子', '葡萄', '蓝莓', '西瓜',
  // 汤羹
  '紫菜蛋花汤', '番茄牛腩汤', '冬瓜排骨汤', '豆腐菌菇汤', '玉米排骨汤', '罗宋汤', '番茄鸡蛋汤',
  // 饮品
  '美式咖啡', '拿铁', '可乐', '珍珠奶茶', '橙汁', '矿泉水',
  // 其他
  '薯片', '炒花生米', '蛋糕', '黑巧克力', '煎饼果子',
]

const rows = DISHES.map((name) => {
  const { detail } = matchDishes([{ name }])
  return { name, ...detail[0] }
})

const byVia = (via) => rows.filter((r) => r.via === via)
const unmatched = rows.filter((r) => r.via === 'none')

console.log(`\n=== 探了 ${rows.length} 个菜名 ===\n`)

console.log('  各层命中:')
for (const via of ['exact', 'alias', 'core', 'contains', 'none']) {
  const n = byVia(via).length
  const bar = '█'.repeat(n)
  console.log(`    ${via.padEnd(9)} ${String(n).padStart(3)}  ${bar}`)
}

console.log('\n  ■ 落空(库里确实没有)—— 要扩充的是这些:')
for (const r of unmatched) console.log(`      ${r.name}`)
if (!unmatched.length) console.log('      (无)')

/**
 * contains 层单独列。
 *
 * 它是唯一会**跨过菜名本身**去命中的一层,也是唯一会产出**静默错配**的一层 ——
 * 实测踩过两次:「番茄鸡蛋汤」命中「番茄(生)」、「玉米排骨汤」命中「玉米(煮)」,
 * 一道汤被算成一份生蔬菜。落空会在界面上标出来,错配不会。
 *
 * 可疑程度按「菜名比库里的名字多出几个字」排 —— 多出来的字越多,越可能命中的是
 * 一个**成分**而不是这道菜本身。多 1 个字通常是修饰(糙**米**饭、卤**牛**肉),
 * 多 3 个字往往是另外半道菜。
 */
console.log('\n  ■ 用 contains 兜住的 —— 逐个看是不是同一个东西:')
for (const r of byVia('contains')) {
  const food = FOOD_BY_ID.get(r.foodId)
  const extra = r.name.length - normalizeDishName(food?.name ?? '').length
  console.log(
    `      ${r.name}  →  ${food?.name}  (${food?.id})  多出 ${extra} 个字` +
      (extra >= 3 ? '  ← 可疑,可能命中的是一个成分' : ''),
  )
}
if (!byVia('contains').length) console.log('      (无)')

console.log('\n  ■ 全部结果:')
for (const r of rows) {
  if (r.via === 'none') {
    console.log(`      ${r.name.padEnd(14)} ✗ 未收录`)
    continue
  }
  const food = FOOD_BY_ID.get(r.foodId)
  const renamed = food?.name === r.name ? '' : `  (库里叫「${food?.name}」)`
  console.log(`      ${r.name.padEnd(14)} ${r.via.padEnd(9)} → ${r.grams}g  ${food?.id}${renamed}`)
}

console.log(`\n  落空 ${unmatched.length}/${rows.length} = ${Math.round((unmatched.length / rows.length) * 100)}%`)
