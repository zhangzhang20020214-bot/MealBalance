/**
 * 确认分量 —— 出分析结果前的必经一步
 * ===========================================================
 * 对应流程:`拍照 → 分析中 → **确认分量** → 分析结果`。
 *
 * ## 为什么要加这一屏
 *
 * 结果页原来每道菜写「**估算** 150g」,而那个 150 是 `data/foods.ts` 里的
 * `defaultGrams` 常量 —— 既不是从照片里推出来的,也不是模型给的。界面用
 * 「估算」把一个常量说成了推断结果,这正是这个仓库一直在消灭的那类东西。
 *
 * 「从一张照片估出重量」做不到。所以这里把问题交还给唯一知道答案的人,
 * 而且**只问一个他答得出来的问题**:大份、正常、还是小份 —— 不是「多少克」。
 * 见 `src/lib/portion.ts`。
 *
 * ## 快速路径
 *
 * 用户的选择是「必经,但默认全部常规」,所以进来之后直接按主按钮就能走 ——
 * 一次点击,不用做任何判断。真实路径上点「常规」等于**不改任何数字**
 * (`portionGrams(item.grams, 'normal') === item.grams`)。
 *
 * ## 这一屏不做什么
 *
 * · **不归档。** 归档仍然在结果页;所以这里也**不调 `releasePlatePreview()`**
 *   —— 那张预览图的生命周期归 plate.ts 管,这一屏只是看一眼。
 * · **不增删菜品。** 那是结果页「调整分量或增删菜品」的事。这一屏只回答一个问题。
 * · **不给自己发请求。** 识别早在点拍照那一刻就发起了(见 AnalyzingScreen 的说明)。
 */
import { useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen } from '../components/ios/Screen'
import { DemoDataBanner } from '../components/DemoDataBanner'
import { Card, IconTile, NavBar, PrimaryButton, SegmentedControl } from '../components/ui'
import { MealSheet } from '../components/MealSheet'
import { WEB_BASE_GRAMS, countableItems, isUnmatchedId, isWebId } from '../lib/dishMatch'
import { nutritionOfItem } from '../lib/nutrition'
import {
  DEFAULT_PORTION,
  PORTIONS,
  baseGramsFor,
  portionGrams,
  portionItems,
  type PortionValue,
} from '../lib/portion'
import { dishIcon } from '../store/advice'
import { getPending, setPending, subscribePending } from '../store/recognize'
import { getPlateJob, subscribePlateJob } from '../store/plate'

export default function PortionScreen() {
  const navigate = useNavigate()
  const pending = useSyncExternalStore(subscribePending, getPending, getPending)

  /**
   * foodId → 用户选的档。**只记用户真正点过的那些**,没点过的走 `choiceFor`
   * 的默认值 —— 默认值只有一处定义,显示和提交用的是同一个,
   * 所以屏幕上写的克数就是最终会写进去的那个数。
   */
  const [draft, setDraft] = useState<Record<string, PortionValue>>({})

  const items = pending?.items ?? []
  /*
    改菜品 —— AI 认错的时候用得着,所以这一屏必须能给用户一条改的路。

    它打开的是同一个 `MealSheet`,但走的是 `onDraft`:保存**不落库**,
    只把改好的清单还回来写进 pending。用默认那条路的话,用户还没看过分析,
    这一餐就已经被 `addMeal` 记进日记了。
  */
  const [fixing, setFixing] = useState(false)
  const countable = countableItems(items)
  const unmatched = items.filter((i) => isUnmatchedId(i.foodId))
  /*
    预稿还是终稿 —— 只影响下面那两处的措辞与计数,别拿它去藏东西。

    ⚠️ **这一屏最容易被误读的地方就在这儿。** 预稿期间库外菜的营养还在联网查,
    它们此刻**确实是** `unmatched`(没有 per100g),不能假装没这回事;但「还在查」
    和「查完了也没有」是两件事。主列表只列库里有营养的菜,用户在下面看到一个
    「不在食物库里」的警告 —— 读起来就是**这几道菜没认出来**,而实际上它们认出来了。
  */
  const plateJob = useSyncExternalStore(subscribePlateJob, getPlateJob, getPlateJob)
  const provisional = plateJob.provisional === true
  /**
   * 这一餐里有没有**联网查到营养**的菜 —— 只决定页脚那句补充说明出不出来。
   *
   * 判据是 `isWebId`,不是「`source` 有没有值」:两个字段同生共死(dishMatch 的
   * web 分支),用哪个都能得到同一个答案,但这一屏要问的问题是「这道菜是不是
   * 库外菜」,那正是 `isWebId` 的定义。
   */
  const hasWeb = countable.some((i) => isWebId(i.foodId))

  const choiceFor = (foodId: string): PortionValue => draft[foodId] ?? DEFAULT_PORTION

  /* ---------- 没有可确认的东西:刷新 / 直接打开 / 从历史回来 ---------- */
  /*
   * 不白屏,也不在 render 里 navigate(那是渲染期副作用)。
   * `pending` 是模块内存里的草稿,刷新必然丢;`startPlateJob` 也会先把 pending
   * 清成 null 再开新任务,所以「从历史前进回来」同样会落到这里。
   */
  if (!pending || countable.length === 0) {
    return (
      <Screen tabBar={false}>
        <NavBar backLabel="返回首页" onBack={() => navigate('/')} right="确认分量" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <IconTile name="sliders" size={64} radius={14} tone="brand" iconSize={28} />
          <p className="text-[16px] leading-[22px] font-medium text-ink">没有待确认的餐</p>
          <p className="text-[13px] leading-[19px] text-muted">
            回到首页点「拍餐盘」，识别出菜品后会先在这里确认份量。
          </p>
          {pending ? (
            // 有结果、只是没有可称的菜(一律没查到营养)—— 给条出路,别把人堵在这
            <button
              onClick={() => navigate('/result', { replace: true })}
              className="mt-1 text-[15px] leading-[21px] font-medium text-brand-deep active:opacity-60"
            >
              看分析结果
            </button>
          ) : (
            <button
              onClick={() => navigate('/')}
              className="mt-1 text-[15px] leading-[21px] font-medium text-brand-deep active:opacity-60"
            >
              回首页拍一餐
            </button>
          )}
        </div>
      </Screen>
    )
  }

  /**
   * 提交。
   *
   * 两份克数都在这里定下来,顺序很重要 —— 结果页整个从 `pending` 渲染
   * (`nutritionOfItems(items)` + `deriveAdvice(items, profile)`),
   * 所以必须**先把克数写进那个对象,再跳转**。
   *
   * 传进去的 map 是**完整的**(每道可称的菜都有条目),不是只填点过的那些:
   * 演示路径的克数是 ±15% 的抖动噪声,基准是库里的默认值,不填的话
   * 「默认确认」会让结果页显示 140g,而这一屏刚刚写的是「约 150g」。
   * 未收录的菜不在这个 map 里,`portionItems` 会原样返回它们。
   */
  const confirm = () => {
    const full: Record<string, PortionValue> = {}
    for (const item of countable) full[item.foodId] = choiceFor(item.foodId)
    setPending({
      ...pending,
      items: portionItems(pending.items, full, pending.engine),
      portionConfirmed: true,
    })
    // replace:整条链路只占一个历史条目,见 AnalyzingScreen 里那段说明
    navigate('/result', { replace: true })
  }

  return (
    <Screen tabBar={false}>
      <NavBar backLabel="返回首页" onBack={() => navigate('/')} right="确认分量" />

      <div className="flex flex-col gap-3 px-5 pt-3">
        {/*
          降级路径**也会**经过这一屏(用户的选择),而它下面那些菜是随机组的 ——
          所以横幅和缩略图的门都照结果页来:横幅要挂,用户拍的那张照片不显示。
          plate.ts 在降级时刻意没把 photoUrl 放进结果,理由正是
          「把真照片摆在编出来的菜旁边,等于暗示这个因果关系」
        */}
        {pending.degradedReason && <DemoDataBanner reason={pending.degradedReason} />}

        <Card>
          <div className="flex items-center gap-3 px-4 py-3.5">
            {pending.engine === 'agent' && pending.photoUrl && (
              <IconTile name="camera" size={40} radius={12} tone="brand" src={pending.photoUrl} />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] leading-[18px] font-bold text-ink">
                {/* 预稿期间所有菜都已经认出来了,只是有几道营养还没查回来 —— 这时候按「库里有的」计数等于少报 */}
                识别到 {provisional ? items.length : countable.length} 道菜
              </span>
              <span className="text-[13px] leading-[18.82px] text-muted">
                照片看不出多少克，按实际情况选个份量就行。
              </span>
            </div>
          </div>
        </Card>

        <Card>
          {countable.map((item, i) => {
            const value = choiceFor(item.foodId)
            // 屏幕上显示的就是提交时会写进去的那个数 —— 两处算同一个函数
            const grams = portionGrams(baseGramsFor(item, pending.engine), value)
            // 克数传的是**这一档会写进去的那个**,不是条目上那个 —— 见
            // `nutritionOfItem` 的 `grams` 参数说明。以前这里写的是
            // `food ? … : 0`,库外菜显示 0 kcal,而提交后它是有热量的。
            const kcal = Math.round(nutritionOfItem(item, grams).kcal)
            return (
              <div key={item.foodId}>
                {i > 0 && (
                  <div className="pl-[70px]">
                    <div className="h-px bg-line" />
                  </div>
                )}
                <div className="flex flex-col gap-2.5 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <IconTile name={dishIcon(item.foodId)} size={42} radius={12} tone="brand" iconSize={20} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] leading-[22px] text-ink">{item.name}</span>
                      <span className="tnum text-[13px] leading-[18px] text-muted">
                        约 {grams}g · {kcal} kcal
                      </span>
                    </div>
                  </div>

                  {/*
                    控件**自己占一行**。MealSheet 那种「图标 + 名字 + 步进器」的
                    单行布局在这里放不下:那行固定宽度加起来就约 200pt,而这一屏
                    去掉 px-5 只有 362pt,这个控件光本身最少也要 148pt。
                    塞进同一行会溢出将近一倍。

                    size="lg" 是必需的,不是偏好:这是**必经**的逐菜选择,
                    默认那档三个相邻目标只有 26pt、间隔 2px,就是误触发生器
                    (仓库自己的标准见 MealSheet 的「每一项都远超 44pt 热区」)。
                  */}
                  <SegmentedControl
                    size="lg"
                    label={`${item.name}分量`}
                    options={PORTIONS}
                    value={value}
                    onChange={(v) => setDraft((d) => ({ ...d, [item.foodId]: v }))}
                  />
                </div>
              </div>
            )
          })}

          {/*
            未收录的菜列出来但**不可点**。不列的话,用户拍了三道菜只看见两行,
            会以为 App 漏了一道 —— 这也是结果页那条未匹配提示的提前告知

            ⚠️ 两套措辞,别合并:预稿那套说的是「认出来了,营养还在查」,
            终稿那套说的是「查过了,库里没有」。**后者被提前用出去,就是在说一件
            还没发生的事** —— 而这正是这一屏最容易让人误以为「识别不出来」的地方。
          */}
          {unmatched.length > 0 && (
            <div className="mx-4 mt-1 mb-3 rounded-[12px] bg-warn-bg px-3 py-2">
              <span className="text-[12px] leading-[17.38px] text-warn-body">
                {provisional ? (
                  <>
                    这几项已经认出来了，营养正在联网查：{unmatched.map((u) => u.name).join('、')}
                    。查回来之前它们按 0 计，稍后会自动变成真值。
                  </>
                ) : (
                  <>
                    这 {unmatched.length} 项不在食物库里，暂时按 0 计：
                    {unmatched.map((u) => u.name).join('、')}。稍后可以在结果页
                    「调整分量或增删菜品」里换成库里的相近菜品。
                  </>
                )}
              </span>
            </div>
          )}
        </Card>

        {/*
          入口放在主按钮上面:这一屏的主语是「这一餐是什么」,改菜品属于这一屏;
          「确认」是它的结束动作,顺序上该在最后。
        */}
        <button
          onClick={() => setFixing(true)}
          className="mb-2 flex h-12 w-full items-center justify-center gap-1.5 rounded-[12px] border border-line text-[14px] leading-[20px] font-medium text-brand-deep active:opacity-60"
        >
          菜认错了？改一下
        </button>

        <PrimaryButton icon="check" onClick={confirm}>
          看分析结果
        </PrimaryButton>

        {/*
          页脚说明。后半句**只在真有联网估算的菜时**才出现 —— 这一屏平时就
          两道三道菜,多解释一个屏幕上不存在的东西只会让人去找它在哪。

          「联网查到营养的菜」这个说法是挑选过的:下面那条黄色说明条已经用了
          「不在食物库里」指哨兵项,同一个说法不能在这里指另一种菜。
          这两类菜在这一屏同时存在,而且含义正好相反。

          150 是 `WEB_BASE_GRAMS` **插值**进来的,不是又写了一遍字面量 ——
          同一个数字有两个出处,迟早会对不上(规矩见 store/types.ts 里
          RESTRICTION_TYPES 那段)。
        */}
        <p className="px-2.5 text-[12px] leading-[17.38px] text-faint">
          照片没办法称重，所以这一餐的份量由你来定。「常规」用的是食物库里的常见分量
          {hasWeb && <>；联网查到营养的菜按一份约 {WEB_BASE_GRAMS}g 起算</>}。
        </p>

        <div className="h-6" />
      </div>
      {/* 改菜品 —— 草稿模式,保存只写回 pending,不碰日记 */}
      <MealSheet
        open={fixing}
        onClose={() => setFixing(false)}
        initial={pending.items}
        initialSlot={pending.slot}
        source="拍餐盘"
        onDraft={(nextItems, nextSlot) => {
          setPending({ ...pending, items: nextItems, slot: nextSlot })
        }}
      />
    </Screen>
  )
}
