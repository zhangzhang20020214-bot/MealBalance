/**
 * 食物营养库(演示用)
 * ===========================================================
 * ⚠️ **数据说明 —— 请勿当作权威来源**
 *
 * 下表的数值是按常见认知整理的**近似值**,用来让演示能跑通完整闭环,
 * 并非逐条核对《中国食物成分表》得来。精度不适用于任何真实的营养、
 * 医疗或健康决策。
 *
 * 若要投入实际使用,请替换为权威数据集 —— 数据结构已统一按「每 100g」设计,
 * 换数据源不需要改动任何调用方。
 *
 * 单位:kcal / g / g / g / mg(钠)。熟食按「可食部、常见烹调后」计,
 * 烹调油盐已折算进对应菜品,不是生食材值。
 */

export type FoodCategory = '主食' | '蛋奶豆' | '肉类' | '水产' | '蔬菜' | '水果' | '汤羹' | '饮品' | '其他'

/** 每 100g 可食部的营养值 */
export interface FoodNutrition {
  kcal: number
  protein: number
  carb: number
  fat: number
  /** 毫克 */
  sodium: number
  /**
   * 添加糖(克),**不含**天然糖。
   *
   * 按膳食指南的定义,「添加糖」指加工时额外加入的糖,水果的果糖、
   * 牛奶的乳糖都不计入 —— 所以苹果、香蕉这里是 0,可乐、蛋糕才是大值。
   * 这个区分很重要:否则「控糖」会变成「别吃水果」,那是错的建议。
   */
  sugar: number
}

export interface Food {
  id: string
  name: string
  category: FoodCategory
  per100g: FoodNutrition
  /** 常见一份的克数 —— 录入时作为默认分量,减少输入负担 */
  defaultGrams: number
}

export const FOODS: Food[] = [
  // ---------- 主食 ----------
  { id: 'rice', name: '米饭(熟)', category: '主食', per100g: { kcal: 116, protein: 2.6, carb: 25.9, fat: 0.3, sodium: 2, sugar: 0 }, defaultGrams: 150 },
  { id: 'brown-rice', name: '糙米饭', category: '主食', per100g: { kcal: 112, protein: 2.7, carb: 24, fat: 0.9, sodium: 3, sugar: 0 }, defaultGrams: 150 },
  { id: 'mantou', name: '馒头', category: '主食', per100g: { kcal: 223, protein: 7, carb: 47, fat: 1.1, sodium: 165, sugar: 1 }, defaultGrams: 100 },
  { id: 'noodles', name: '面条(煮)', category: '主食', per100g: { kcal: 110, protein: 3.9, carb: 22.5, fat: 0.4, sodium: 150, sugar: 0 }, defaultGrams: 200 },
  { id: 'whole-wheat-bread', name: '全麦面包', category: '主食', per100g: { kcal: 246, protein: 9, carb: 46, fat: 3.3, sodium: 380, sugar: 5 }, defaultGrams: 60 },
  { id: 'congee', name: '白粥', category: '主食', per100g: { kcal: 46, protein: 1.1, carb: 9.9, fat: 0.2, sodium: 2, sugar: 0 }, defaultGrams: 250 },
  { id: 'oatmeal', name: '燕麦粥', category: '主食', per100g: { kcal: 68, protein: 2.4, carb: 12, fat: 1.4, sodium: 30, sugar: 0 }, defaultGrams: 250 },
  { id: 'xiaolongbao', name: '小笼包', category: '主食', per100g: { kcal: 230, protein: 8, carb: 30, fat: 8, sodium: 420, sugar: 3 }, defaultGrams: 100 },
  { id: 'dumpling', name: '猪肉饺子', category: '主食', per100g: { kcal: 240, protein: 9, carb: 28, fat: 9.5, sodium: 430, sugar: 1 }, defaultGrams: 150 },
  { id: 'corn', name: '玉米(煮)', category: '主食', per100g: { kcal: 112, protein: 4, carb: 22.8, fat: 1.2, sodium: 3, sugar: 0 }, defaultGrams: 150 },
  { id: 'sweet-potato', name: '红薯(蒸)', category: '主食', per100g: { kcal: 90, protein: 1.6, carb: 20.7, fat: 0.2, sodium: 28, sugar: 0 }, defaultGrams: 150 },

  // ---------- 蛋奶豆 ----------
  { id: 'boiled-egg', name: '煮鸡蛋', category: '蛋奶豆', per100g: { kcal: 144, protein: 13.3, carb: 2.8, fat: 8.8, sodium: 131, sugar: 0 }, defaultGrams: 50 },
  { id: 'fried-egg', name: '煎鸡蛋', category: '蛋奶豆', per100g: { kcal: 200, protein: 13.5, carb: 1.5, fat: 15, sodium: 200, sugar: 0 }, defaultGrams: 55 },
  { id: 'milk', name: '牛奶', category: '蛋奶豆', per100g: { kcal: 54, protein: 3, carb: 3.4, fat: 3.2, sodium: 37, sugar: 0 }, defaultGrams: 250 },
  { id: 'soy-milk', name: '无糖豆浆', category: '蛋奶豆', per100g: { kcal: 31, protein: 3, carb: 1.2, fat: 1.6, sodium: 3, sugar: 0 }, defaultGrams: 250 },
  { id: 'tofu-firm', name: '北豆腐', category: '蛋奶豆', per100g: { kcal: 116, protein: 12.2, carb: 3.8, fat: 6.4, sodium: 7, sugar: 0 }, defaultGrams: 100 },
  { id: 'tofu-soft', name: '南豆腐', category: '蛋奶豆', per100g: { kcal: 87, protein: 6.2, carb: 3.9, fat: 4.8, sodium: 7, sugar: 0 }, defaultGrams: 100 },
  { id: 'yogurt', name: '原味酸奶', category: '蛋奶豆', per100g: { kcal: 72, protein: 2.5, carb: 9.3, fat: 2.7, sodium: 39, sugar: 8 }, defaultGrams: 150 },

  // ---------- 肉类 ----------
  { id: 'braised-pork', name: '红烧肉', category: '肉类', per100g: { kcal: 460, protein: 12, carb: 5, fat: 45, sodium: 620, sugar: 8 }, defaultGrams: 100 },
  { id: 'braised-ribs', name: '红烧排骨', category: '肉类', per100g: { kcal: 245, protein: 15, carb: 6, fat: 18, sodium: 480, sugar: 7 }, defaultGrams: 150 },
  { id: 'kungpao-chicken', name: '宫保鸡丁', category: '肉类', per100g: { kcal: 175, protein: 12, carb: 9, fat: 10, sodium: 560, sugar: 5 }, defaultGrams: 150 },
  { id: 'boiled-chicken', name: '白切鸡', category: '肉类', per100g: { kcal: 165, protein: 20, carb: 1, fat: 9, sodium: 300, sugar: 0 }, defaultGrams: 100 },
  { id: 'roast-drumstick', name: '烤鸡腿', category: '肉类', per100g: { kcal: 180, protein: 19, carb: 2, fat: 11, sodium: 380, sugar: 1 }, defaultGrams: 120 },
  { id: 'tomato-egg', name: '番茄炒蛋', category: '肉类', per100g: { kcal: 95, protein: 5.5, carb: 4.5, fat: 6.5, sodium: 380, sugar: 2 }, defaultGrams: 150 },
  { id: 'pepper-pork', name: '青椒肉丝', category: '肉类', per100g: { kcal: 145, protein: 10, carb: 5, fat: 9, sodium: 450, sugar: 2 }, defaultGrams: 130 },
  { id: 'twice-cooked-pork', name: '回锅肉', category: '肉类', per100g: { kcal: 330, protein: 13, carb: 6, fat: 28, sodium: 700, sugar: 4 }, defaultGrams: 120 },
  { id: 'steak', name: '煎牛排', category: '肉类', per100g: { kcal: 250, protein: 26, carb: 1, fat: 16, sodium: 320, sugar: 0 }, defaultGrams: 150 },
  { id: 'braised-beef', name: '卤牛肉', category: '肉类', per100g: { kcal: 180, protein: 28, carb: 3, fat: 6, sodium: 700, sugar: 1 }, defaultGrams: 80 },

  // ---------- 水产 ----------
  { id: 'steamed-fish', name: '清蒸鱼', category: '水产', per100g: { kcal: 105, protein: 18, carb: 1, fat: 3.5, sodium: 380, sugar: 0 }, defaultGrams: 150 },
  { id: 'boiled-shrimp', name: '白灼虾', category: '水产', per100g: { kcal: 93, protein: 18.6, carb: 2.8, fat: 0.8, sodium: 420, sugar: 0 }, defaultGrams: 100 },
  { id: 'salmon', name: '煎三文鱼', category: '水产', per100g: { kcal: 210, protein: 20, carb: 0, fat: 13, sodium: 150, sugar: 0 }, defaultGrams: 120 },
  { id: 'boiled-fish-spicy', name: '水煮鱼', category: '水产', per100g: { kcal: 160, protein: 15, carb: 4, fat: 9, sodium: 680, sugar: 2 }, defaultGrams: 200 },

  // ---------- 蔬菜 ----------
  { id: 'lettuce-stir', name: '清炒油麦菜', category: '蔬菜', per100g: { kcal: 43, protein: 2, carb: 3, fat: 2.8, sodium: 320, sugar: 0 }, defaultGrams: 200 },
  { id: 'spinach-garlic', name: '蒜蓉菠菜', category: '蔬菜', per100g: { kcal: 40, protein: 2.9, carb: 3.6, fat: 1.8, sodium: 300, sugar: 0 }, defaultGrams: 200 },
  { id: 'broccoli', name: '白灼西兰花', category: '蔬菜', per100g: { kcal: 42, protein: 2.8, carb: 6.6, fat: 1.2, sodium: 180, sugar: 0 }, defaultGrams: 150 },
  { id: 'cucumber-salad', name: '凉拌黄瓜', category: '蔬菜', per100g: { kcal: 30, protein: 0.8, carb: 3, fat: 1.5, sodium: 280, sugar: 1 }, defaultGrams: 150 },
  { id: 'green-beans', name: '干煸四季豆', category: '蔬菜', per100g: { kcal: 120, protein: 3, carb: 8, fat: 8, sodium: 400, sugar: 2 }, defaultGrams: 150 },
  { id: 'mapo-tofu', name: '麻婆豆腐', category: '蔬菜', per100g: { kcal: 130, protein: 8.5, carb: 5.5, fat: 9, sodium: 520, sugar: 2 }, defaultGrams: 150 },
  { id: 'stir-veggies', name: '素炒时蔬', category: '蔬菜', per100g: { kcal: 55, protein: 2, carb: 6, fat: 2.5, sodium: 300, sugar: 0 }, defaultGrams: 200 },
  { id: 'tomato-raw', name: '番茄(生)', category: '蔬菜', per100g: { kcal: 20, protein: 0.9, carb: 4, fat: 0.2, sodium: 5, sugar: 0 }, defaultGrams: 150 },

  // ---------- 水果 ----------
  { id: 'apple', name: '苹果', category: '水果', per100g: { kcal: 52, protein: 0.2, carb: 13.5, fat: 0.2, sodium: 1, sugar: 0 }, defaultGrams: 200 },
  { id: 'banana', name: '香蕉', category: '水果', per100g: { kcal: 89, protein: 1.1, carb: 22.8, fat: 0.3, sodium: 1, sugar: 0 }, defaultGrams: 120 },
  { id: 'orange', name: '橙子', category: '水果', per100g: { kcal: 47, protein: 0.8, carb: 11.1, fat: 0.2, sodium: 1, sugar: 0 }, defaultGrams: 180 },
  { id: 'grape', name: '葡萄', category: '水果', per100g: { kcal: 43, protein: 0.5, carb: 10.3, fat: 0.2, sodium: 1, sugar: 0 }, defaultGrams: 150 },
  { id: 'blueberry', name: '蓝莓', category: '水果', per100g: { kcal: 57, protein: 0.7, carb: 14.5, fat: 0.3, sodium: 1, sugar: 0 }, defaultGrams: 100 },
  { id: 'watermelon', name: '西瓜', category: '水果', per100g: { kcal: 26, protein: 0.6, carb: 6.8, fat: 0.1, sodium: 3, sugar: 0 }, defaultGrams: 200 },

  // ---------- 汤羹 ----------
  { id: 'seaweed-egg-soup', name: '紫菜蛋花汤', category: '汤羹', per100g: { kcal: 30, protein: 2.5, carb: 2, fat: 1.5, sodium: 520, sugar: 0 }, defaultGrams: 250 },
  { id: 'tomato-beef-soup', name: '番茄牛腩汤', category: '汤羹', per100g: { kcal: 85, protein: 6, carb: 4, fat: 4.5, sodium: 600, sugar: 1 }, defaultGrams: 250 },
  { id: 'wintermelon-soup', name: '冬瓜排骨汤', category: '汤羹', per100g: { kcal: 60, protein: 4.5, carb: 2, fat: 3.5, sodium: 480, sugar: 0 }, defaultGrams: 250 },

  // ---------- 饮品 ----------
  { id: 'americano', name: '美式咖啡', category: '饮品', per100g: { kcal: 2, protein: 0.1, carb: 0, fat: 0, sodium: 5, sugar: 0 }, defaultGrams: 250 },
  { id: 'latte', name: '拿铁', category: '饮品', per100g: { kcal: 55, protein: 3, carb: 5, fat: 2.5, sodium: 45, sugar: 0 }, defaultGrams: 300 },
  { id: 'cola', name: '含糖可乐', category: '饮品', per100g: { kcal: 43, protein: 0, carb: 10.8, fat: 0, sodium: 5, sugar: 10.8 }, defaultGrams: 330 },
  { id: 'bubble-tea', name: '珍珠奶茶', category: '饮品', per100g: { kcal: 90, protein: 1, carb: 17, fat: 2.2, sodium: 40, sugar: 12 }, defaultGrams: 500 },
  /*
   * 橙汁的糖按**添加糖**记,也就是当成市售果汁饮料。
   * 鲜榨橙汁的糖是果糖,按本文件的定义(见 FoodNutrition.sugar)该记 0 ——
   * 但「橙汁」这个词在场景里更常指瓶装的那种,而且**宁可高估**:控糖建议
   * 多说一句「少喝果汁」,比把一杯含糖果汁报成 0 添加糖要好。
   */
  { id: 'orange-juice', name: '橙汁', category: '饮品', per100g: { kcal: 45, protein: 0.7, carb: 10.4, fat: 0.2, sodium: 1, sugar: 8 }, defaultGrams: 250 },

  // ---------- 其他 ----------
  { id: 'chips', name: '薯片', category: '其他', per100g: { kcal: 545, protein: 6, carb: 50, fat: 35, sodium: 500, sugar: 2 }, defaultGrams: 50 },
  { id: 'peanut', name: '炒花生', category: '其他', per100g: { kcal: 580, protein: 24, carb: 16, fat: 48, sodium: 30, sugar: 0 }, defaultGrams: 30 },
  { id: 'cake', name: '蛋糕', category: '其他', per100g: { kcal: 350, protein: 5, carb: 45, fat: 17, sodium: 200, sugar: 25 }, defaultGrams: 80 },
  { id: 'chocolate', name: '巧克力', category: '其他', per100g: { kcal: 550, protein: 6, carb: 55, fat: 35, sodium: 60, sugar: 45 }, defaultGrams: 30 },
]

/**
 * 按 id 建索引,避免每次渲染都线性查找。
 *
 * ⚠️ **这不是「取一项菜的营养」的入口。** `MealItem` 的营养有**两个**来源:
 * 食物库(这里)和条目自带的 `per100g`(库里没有的菜由 Dify 联网查一个回来)。
 * 直接写 `FOOD_BY_ID.get(item.foodId)?.per100g` 对库外菜一律得到 undefined ——
 * 于是它被**静默**算成 0,而屏幕上那个数字看起来完全正常。
 * 「两个来源谁优先」只有一处定义:`lib/nutrition.ts` 的 `per100gOf`。
 *
 * 这个索引还有三个正当用途,它们都**只查分类或存在性、绝不取营养值**:
 * `advice.ts` 的 `dishIcon()`、`advice.ts` 那条蔬菜判断、以及
 * `store/eatingOrder.ts` 的进食顺序(它按分类排菜,一分营养值都不看)。
 * 最后再加一个正当用途时,把这一行也数一遍。
 */
export const FOOD_BY_ID = new Map(FOODS.map((f) => [f.id, f]))

/** 分类顺序 —— 搜索结果按此排序,主食在前更符合记录习惯 */
export const CATEGORY_ORDER: FoodCategory[] = [
  '主食',
  '蛋奶豆',
  '肉类',
  '水产',
  '蔬菜',
  '水果',
  '汤羹',
  '饮品',
  '其他',
]
