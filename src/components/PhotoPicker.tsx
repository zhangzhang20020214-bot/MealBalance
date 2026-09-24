/**
 * 照片选择器 —— 唤起相机 / 相册
 * ===========================================================
 * 用隐藏的 `<input type="file">`,不用 `getUserMedia`。
 *
 * ⚠️ **`capture` 各平台行为不一样,别把它当成"一定能开相机"。**
 * 查证过(WebKit Bug 236981 和几处实测报告),实际情况是:
 *
 *   · **Android Chrome** —— `capture="environment"` 真的直接打开相机 App。
 *   · **iOS Safari**    —— **不能强制**。只要 input 收图片,iOS 就会弹它自己的
 *     那张单子(拍照 / 照片图库 / 浏览文件),`capture` 只是"优先用后置"的提示,
 *     既不能强制进相机、也不能把相册那一项去掉。所以 iOS 上这两个按钮会落到
 *     **同一个单子**。
 *   · **桌面浏览器**    —— 完全忽略 `capture`,退化成文件选择器(就是你现在看到的
 *     「上传文件」对话框)。想真开摄像头只能上 `getUserMedia`,那条路要 HTTPS、
 *     要权限申请、还要自己画取景器和快门,见 README「已知限制」。
 *
 * 换句话说:**"拍照"和"从相册选择"这两个入口的差别只在 Android 上成立**,
 * iOS 和桌面上它们行为一致。要三端一致地"真的打开相机",只有 `getUserMedia`。
 *
 * 四个必须守住的细节
 * ------------------------------------------------------------
 * 1. **`.click()` 之前不能 await。** 浏览器的文件选择器必须在用户手势的
 *    同步调用栈里打开;中间插一个 `await`(哪怕只是 `await Promise.resolve()`)
 *    就会失去用户激活状态,Safari 直接静默不弹窗。所以 `openCamera` /
 *    `openAlbum` 是普通同步函数,不是 async。
 *
 * 2. **先拿 File,再清 `value`。** 同一张图连选两次时,`change` 不会触发 ——
 *    浏览器认为值没变。所以要清空 `value` 让下一次能再次触发。但必须**先**
 *    把 File 取出来:清空 `value` 会让 input 放开对文件的引用。
 *    (File 对象本身是独立的 Blob,清空后仍然可用。)
 *
 * 3. **input 必须由调用方渲染在面板外面。** 这是这个 hook 返回 `inputs` 而不是
 *    自己内部渲染的原因 —— 面板(ActionSheet)关闭时整个返回 null,
 *    挂在它里面的 input 会跟着被卸载。iOS 上「选择器还开着、触发它的 input
 *    被移出 DOM」会导致选择器被取消,用户选到一半图没了。
 *
 * 4. **用 `sr-only` 而不是 `hidden`(`display:none`)。** 有报告说 iOS Safari
 *    对 `display:none` 的 file input 会连 `capture` 一起忽略、甚至不认这次点击。
 *    这个说法我没法在这台 Windows 上验证,但它**零成本**就能规避:
 *    `sr-only` 是"视觉上不可见但仍在渲染树里"(1px + 绝对定位 + 裁剪),
 *    对布局没有任何影响,却避开了 `display:none` 这一整类历史坑。
 *    代价为零的风险不值得留着。
 *
 * ⚠️ 调用方**必须把 `inputs` 渲染出来**。忘了渲染不会报错,只是两个按钮
 * 点了没反应 —— 因为 `.click()` 打在一个不存在的元素上,`ref.current` 是 null。
 *
 * 两个 hook,不是一个带开关的
 * ------------------------------------------------------------
 * 选单张的地方(首页那条历史链)和选多张的地方(对话页攒附件)分成两个入口,
 * 而不是 `usePhotoPicker(onPicked, {multiple})`:
 *
 *   · 回调形状不一样 —— 单张那条路拿到的是 `File`,多张那条拿到的是 `File[]`。
 *     合并成一个签名就只能让单张那条路也去处理数组,而它要的是「一张」,
 *     于是每个调用点都要写一遍 `files[0]`,那正是这个文件想收掉的东西。
 *   · 首页那段调用点**一个字都不用改**(`usePhotoPicker` 的签名不变),
 *     所以这次改动的 diff 里,首页那几行只有行为、没有签名 ——
 *     看 diff 的人不必先确认「`onPicked` 现在收什么了」再往下读。
 */

import { useRef, type ReactNode } from 'react'

export type PhotoSource = 'camera' | 'album'

export interface PhotoPicker {
  /** 唤起后置摄像头。**同步**调用,别包在 async 里 */
  openCamera: () => void
  /** 打开相册 / 文件选择器。**同步**调用 */
  openAlbum: () => void
  /** 两个隐藏 input。调用方负责渲染 —— 见文件头第 3 条 */
  inputs: ReactNode
}

/**
 * 两个 hook 的公共部分。
 *
 * 回调统一收 `File[]`(相机那个永远只给一张,也走数组)—— 见上面的
 * 「两个 hook,不是一个带开关的」。
 *
 * @param multiple 相册那个 input 加不加 `multiple`。
 *   ⚠️ **只加在相册那个上,不加在带 `capture` 的那个上**。
 *   带 `capture` 的 input 上 `multiple` 是句空话:Android 上它直接开相机 App,
 *   一次快门就是一张;iOS 上 `capture` 本来就只是「优先后置」的提示。写上它
 *   不会报错,只会让「相机入口也能多选」变成一句读代码时看不出来的谎 ——
 *   而下一个人可能照着它去写一个永远只收到一张的多选界面。
 */
function useFilePicker(
  onPicked: (files: File[], from: PhotoSource) => void,
  multiple: boolean
): PhotoPicker {
  const cameraRef = useRef<HTMLInputElement>(null)
  const albumRef = useRef<HTMLInputElement>(null)

  /**
   * `onPicked` 每次渲染都是新函数,而 input 的 onChange 只在挂载时绑定一次 ——
   * 用 ref 转发,避免把 onChange 换成依赖闭包的形式(那样还得 useCallback,
   * 而任何一次漏掉依赖都会变成「用了旧的 state」这种难查的 bug)。
   */
  const pickedRef = useRef(onPicked)
  pickedRef.current = onPicked

  const handle = (input: HTMLInputElement | null, from: PhotoSource) => {
    const files = input?.files ? Array.from(input.files) : []
    // 先拿到 files 再清 value —— 顺序反了 files 就没了
    if (input) input.value = ''
    if (files.length) pickedRef.current(files, from)
  }

  return {
    openCamera: () => cameraRef.current?.click(),
    openAlbum: () => albumRef.current?.click(),
    inputs: (
      <>
        {/*
         * capture="environment" = 优先用后置摄像头(拍餐盘当然要用后置)。
         * 它只是**提示**,不是命令 —— 只有 Android 会真的直接开相机,
         * iOS 弹自己的单子,桌面忽略。见文件头。
         *
         * `sr-only` 而不是 `hidden`:见文件头第 4 条。
         * `tabIndex={-1}`:别让它进 Tab 序列 —— 触发它的是旁边那个真按钮,
         * 键盘用户从两个入口进去会听到两遍"文件输入"。
         *
         * 这个 input **没有** `multiple` —— 理由见 `useFilePicker` 的 @param。
         */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => handle(e.currentTarget, 'camera')}
        />
        <input
          ref={albumRef}
          type="file"
          accept="image/*"
          multiple={multiple}
          tabIndex={-1}
          className="sr-only"
          onChange={(e) => handle(e.currentTarget, 'album')}
        />
      </>
    ),
  }
}

/** 单张。首页那条历史链用这个 —— 它一次只分析一张 */
export function usePhotoPicker(onPicked: (file: File, from: PhotoSource) => void): PhotoPicker {
  return useFilePicker((files, from) => onPicked(files[0], from), false)
}

/** 多张。对话页攒附件用这个 —— 相册可以一次选几张,相机仍然一张 */
export function useMultiPhotoPicker(
  onPicked: (files: File[], from: PhotoSource) => void
): PhotoPicker {
  return useFilePicker(onPicked, true)
}
