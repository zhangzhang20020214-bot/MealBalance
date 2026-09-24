/**
 * 「待补记那一餐」的照片 —— 存在 IndexedDB 里的那一份
 * ===========================================================
 * ## 为什么现在才需要它(2026-09-24)
 *
 * 用户定的新口径:对话页发图**不算营养**,等他要记进日记时**才调食衡**去算
 * (见计划:发图那张卡上一个数字都不印)。而食衡那条链路的输入是**照片** ——
 * 所以这份照片必须活到「用户下次进对话页点『记入日记』」的那一刻。
 *
 * 在那之前它一直活得好好的:照片是 `blob:` object URL,挂在消息气泡上,
 * 离开对话页时才由 `chatSession.releaseUrls()` 撤掉。**跨会话就没有了** ——
 * 那时候手上只剩补记弹窗里那张 200px 的缩略图,拿它去认菜基本认不出。
 *
 * ## 为什么是 IndexedDB,不是 localStorage
 *
 * 存进来的是**上传用的那份 JPEG**:长边 1024、质量 0.8(压不下去才降档,
 * 见 `lib/image.ts` 的 `ENCODE_LADDER`),上限 3MB,一次最多 3 张
 * (`composer.MAX_PHOTOS_PER_SEND`)。
 *
 * 走 localStorage 的话,它要先 base64 涨三分之一,然后和**整本日记**抢同一个
 * 5MB —— 而这个仓库已经把「图片不进 localStorage」写成了明文规矩:
 * `chatHistory.ts` 专门剥掉 `photoUrl`/`thumbDataUrl` 再落盘,理由就是
 * 「一张几十 KB,攒几十次会话就是几 MB,配额写满会连累整份日记」。
 * 今天没有理由推翻它 —— 所以照片走另一边:IDB 直接存 blob(不膨胀),
 * 配额走磁盘,不碰日记那本账。
 *
 * ## 单槽,和草稿一一对应
 *
 * `store/unlogged.ts` 的草稿本来就是**单槽**(一次识别覆盖上一次,用户说的就是
 * 「上次识别到的**一餐**」),所以这里也不做多份:一个 key,写就是覆盖。
 * 于是这里**不需要** id、不需要索引、更不需要清理策略 ——
 * 「照片和草稿同生共死」这件事由调用方在四条清草稿的路上顺手做掉。
 *
 * 万一漏了一条(比如换档案),留下的也只是**够不到的几个字节**:
 * 读照片的判据之一是「草稿在不在、是不是这个档案的」,而写入点**总是覆盖**。
 *
 * ## 永不抛,永不阻塞
 *
 * 这个模块的每一个函数都**不抛错**,拿不到就交回空值 —— 和 `saveUnlogged`
 * 失败静默是同一条理由:一份草稿丢了只是少问一句,为它弹一条「存储空间不足」
 * 会把一次无关紧要的失败说成一次数据损失。
 *
 * 加一条它自己的:**IDB 挂了不许把界面卡死**。`open` 会一直悬着(另一个标签页
 * 占着旧版本时就是这样),而调用方那时正把它当「正在算…」的前置步骤 ——
 * 无限转圈比报一句错糟得多,所以每次读写都挂一个墙钟兜底。
 */

/** 全 App 一个库。将来有第二处要持久化 blob,共用一个库、各自一个 store */
const DB_NAME = 'mealbalance'
const DB_VERSION = 1
const STORE = 'draft-photos'

/** 单槽 —— 见文件头第 3 段 */
const KEY = 'current'

/**
 * 一次读写的墙钟。到点就当作「没有 / 没存上」,不抛也不等。
 *
 * 5 秒是量级判断,不是量出来的:IDB 的读写是本地操作,毫秒级;会走到这儿的
 * 只有「被别的标签页挡住」这种病态情形,那时候多等也没有意义。
 */
const TIMEOUT_MS = 5_000

interface PhotoRecord {
  blobs: Blob[]
}

/** 这台机器有没有 IDB。Node 自检里没有 `indexedDB`,隐私模式下 open 会直接抛 */
function idb(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB
  } catch {
    return null
  }
}

/** 到点就交回 `fallback`,并且**不再等那一趟** —— 调用方要的是「别卡住」 */
function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), TIMEOUT_MS)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

function openDb(): Promise<IDBDatabase | null> {
  const factory = idb()
  if (!factory) return Promise.resolve(null)

  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = factory.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    // 版本被别的标签页挡着、磁盘不可用、隐私模式 —— 一律当作「没有」
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

/**
 * 开一次库、跑一趟事务、关掉。单槽 + 低频(一次识别 / 一次记录),不值得缓存连接。
 *
 * ⚠️ **读和写的「成功」不是同一个事件,别用一个通用助手糊过去。**
 *
 *   · **读**的答案是 `request.onsuccess` 里的 `req.result` —— 拿到就是拿到了。
 *   · **写**的成功是 `transaction.oncomplete`。在 `req.onsuccess` 上就报「存上了」
 *     是**早报**:请求成功了,事务之后照样可能 abort(配额、磁盘、别的标签页),
 *     而那份数据其实没落下去。对一个「存不上就该说实话」的模块,
 *     这个差别正好落在它唯一要负责的那件事上。
 */
function withDb<T>(work: (db: IDBDatabase) => Promise<T>, fallback: T): Promise<T> {
  return withTimeout(
    (async () => {
      const db = await openDb()
      if (!db) return fallback
      try {
        return await work(db)
      } catch {
        return fallback
      } finally {
        try {
          db.close()
        } catch {
          /* 关不掉也没关系,下次再开一个 */
        }
      }
    })(),
    fallback
  )
}

function readOne<T>(pick: (v: unknown) => T, fallback: T): Promise<T> {
  return withDb(
    (db) =>
      new Promise<T>((resolve) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction(STORE, 'readonly')
        } catch {
          resolve(fallback)
          return
        }
        tx.onerror = () => resolve(fallback)
        tx.onabort = () => resolve(fallback)
        const req = tx.objectStore(STORE).get(KEY)
        req.onsuccess = () => resolve(pick(req.result))
        req.onerror = () => resolve(fallback)
      }),
    fallback
  )
}

function writeOne(req: (store: IDBObjectStore) => IDBRequest): Promise<boolean> {
  return withDb(
    (db) =>
      new Promise<boolean>((resolve) => {
        let tx: IDBTransaction
        try {
          tx = db.transaction(STORE, 'readwrite')
        } catch {
          resolve(false)
          return
        }
        tx.oncomplete = () => resolve(true) // 见上面那段:写的成功在这里
        tx.onerror = () => resolve(false)
        tx.onabort = () => resolve(false)
        req(tx.objectStore(STORE))
      }),
    false
  )
}

/* ------------------------------------------------------------
   三个出口
   ------------------------------------------------------------ */

/**
 * 存这一批照片 —— **覆盖**上一次。
 *
 * 传空数组 = 把上一次的删掉:一次识别里一张都没成,就不该留着上一餐的照片,
 * 否则下次点「记入日记」会拿**别的**照片去算。这个判据放在这里而不是调用方,
 * 是因为「空 = 清掉」和「空 = 什么都不做」的差别只在**读到的人**那里显形。
 *
 * @returns 存上没有。调用方**不需要**处理 false(见文件头最后一段)
 */
export async function putDraftPhotos(blobs: readonly Blob[]): Promise<boolean> {
  if (blobs.length === 0) {
    await dropDraftPhotos()
    return false
  }
  const rec: PhotoRecord = { blobs: [...blobs] }
  return writeOne((store) => store.put(rec, KEY))
}

/**
 * 取出那一批照片。没有 / 读不出来 / 形状不对 → **空数组**(不抛)。
 *
 * ⚠️ 逐个校验是不是 Blob,不是「有没有这个数组」就放行:IDB 里那份是**上一次
 * 跑这个 App 的版本**写的,而结构化克隆反序列化出来的东西不受本文件的类型
 * 约束。一个 `{}` 冒充 Blob 会在 `new File([...])` 那里变成一张 12 字节的
 * 「图像」,然后被发去识别 —— 报错报在很远的地方,而原因在这儿。
 */
export async function getDraftPhotos(): Promise<Blob[]> {
  return readOne((v) => {
    if (typeof v !== 'object' || v === null) return []
    const rec = v as Partial<PhotoRecord>
    if (!Array.isArray(rec.blobs)) return []
    return rec.blobs.filter((b): b is Blob => b instanceof Blob && b.size > 0)
  }, [])
}

/** 丢掉那一批照片。删不掉就删不掉 —— 下次写入照样覆盖,最多多占几个字节 */
export async function dropDraftPhotos(): Promise<void> {
  await writeOne((store) => store.delete(KEY))
}
