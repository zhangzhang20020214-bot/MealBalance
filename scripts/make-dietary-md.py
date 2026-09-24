#!/usr/bin/env python3
"""
《中国居民膳食指南（2022）》docx → Markdown 知识库文档
===========================================================
跑法：
    python scripts/make-dietary-md.py

为什么这个脚本是 .py，而仓库里其余脚本都是 .mjs
------------------------------------------------------------
因为源文件是 .docx，而 .docx 是个 zip。Node 侧读它要么装 mammoth（多一个依赖），
要么自己解 zip —— 两条路都比「用这台机器上已经装好的 python-docx」麻烦。
这是仓库里唯一的 .py，理由只有这一条，不是风格选择。

它和其余脚本的分工也不同：make-catalog / make-icons 是**从代码生成产物**，
接在 verify 链上；这个是从**外部素材转录**，只在素材更新时跑一次，所以不接。

它解决的核心问题
------------------------------------------------------------
WPS 把扫描版 PDF 转成 Word 之后，**一个标题样式都没有**：全文 3886 段只有
`Normal` 和 `Body Text` 两种样式，零个 Heading。对 RAG 来说这是要命的 ——
切块之后「高血压要限盐」和「孕期要补铁」长得一模一样，模型不知道自己在讲
哪个人群、哪一章。

所以这个脚本的主要工作不是搬运，是**把丢失的层级重建出来**：
    #       这份指南（= 一个输出文件，就是 frontmatter 里那个 title）
    ##      章（准则N / 一、二、… / 附录N）
    ###     节（(一)(二)… / 或者准则N，看哪个在上）
    ####    小节（1. 2. 3. …）

**切成 8 份**（= 原书的「一份指南一个单元」）：一般人群 / 孕妇乳母 / 婴幼儿 /
儿童 / 老年人 / 素食 / 平衡膳食模式与编写说明 / 附录。切点只有两处 —— 部分
（第一、第三部分）和第二部分底下的章。第一部分底下的「准则一~八」**不切**，
它们合起来才是《一般人群膳食指南》。

⚠️ 四条必须记住的坑，都写在对应函数的注释里：
  1. **「准则N」的编号会重置。** 一般人群有准则一~八，婴幼儿那章自己又从
     准则一数到准则四，儿童那章也一样。所以「准则一」全文出现好几次，
     **不能只靠它认章** —— 必须先知道自己在哪个部分里（见 heading()）。
  2. **分页目录要丢掉。** 每个部分的扉页会把各章列一遍（`一 、孕妇…` 连着
     五行）。不丢的话会凭空造出五个空文件。见 drop_toc_runs()。
  3. **第三部分的标题被拆成了三行**（`第三部分` / `平衡膳食模式和膳食` /
     `指南编写说明`），第二部分的标题则是单独出现一次完整行。见 join_part_title()。
  4. **同一个 `准则N` 在两部分里的上下关系是反的** —— 第一部分是
     「准则一 → （一）…」，第二部分是「（一）… → 准则一」。写死层级会让
     婴幼儿那份先 `###` 再 `##`。见 render_levels()。

已知的、修不掉的缺陷（跑完会打印清单）
------------------------------------------------------------
1. **有些表格被 WPS 拆成了散落的段落。** 大部分表格转出来是好的（内容对、
   对齐对），但有一部分是「表题 + 一堆散段」，比如表1-1 的
   `85~100100~150150~200` —— 三列数字连成一串，列头丢了，**不可用**。
   脚本认得出它们（find_flattened）并打印出来，但**不猜着重排**：猜错的表现
   是「列对上了但错位一格」，比留着更糟，而且看不出来。附录二那张
   「膳食能量需要量（EER）」是**完整的**，孕妇和乳母的 +300 / +500 kcal
   都在里面 —— 那是本草里唯一给出这些数字的地方，正文里只有食物量。
2. **分栏页面会串行。** 双栏页里左栏末句和右栏首句会被接进同一段。
3. **图里的数据没有**，只剩图题（附录四、五两张生长曲线就是空的）。
4. **零星 OCR 错字**（`ZHANG×L`、`https:/www`、`60 岁~` 之类）。
5. **段落顺序不总是原书的顺序**：扉页会被 OCR 排到正文之前，所以「第一部
   分的开头几段」其实是那几页的摘要版。脚本从 `第一部分 一般人群膳食指南`
   这一行开始取，把前面那份摘要丢掉（和后面正文重复）。
"""

import re
import sys
from pathlib import Path

try:
    import docx
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph
    from docx.table import Table
except ImportError:
    sys.exit('需要 python-docx：pip install python-docx')

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'knowledge-base' / '2022年中国居民膳食指南 (中国营养学会).docx'
OUT_DIR = ROOT / 'knowledge-base' / 'processed'

CJK = r'一-鿿㐀-䶿'

# ============================================================
#  1. 清洗
# ============================================================

def clean(s: str) -> str:
    """
    还原被版面拆开的字，但**不碰英文和数字之间的空格**。

    OCR 出来的中文夹着大量空白（`维生  素C118mg`）—— 那是 WPS 按字符框定位
    留下的，不是排版意图。做法：先把空白卷成一个空格，再删掉**夹在两个汉字
    之间的空格**。

    `1 4 岁` 这种数字被拆开的，上面那条治不了（数字不是汉字），所以补一条：
    空格两侧都是单个数字时也删。限定「单个」是为了不吃掉 `2022 年` 这种
    正常间隔。
    """
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(rf'(?<=[{CJK}]) (?=[{CJK}])', '', s)
    s = re.sub(r'(?<=\d) (?=\d(?!\d))', '', s)
    s = re.sub(r'(?<!\d)(?=\d \d)', '', s)
    # 汉字之间的半角标点 → 全角（和仓库其余文案一致）。
    # 只在两侧都是汉字时换，所以英文参考文献里的逗号不受影响。
    for half, full in ((',', '，'), (';', '；'), (':', '：'), ('?', '？'), ('!', '！')):
        s = re.sub(rf'(?<=[{CJK}]){re.escape(half)}(?=[{CJK}])', full, s)
    s = re.sub(rf'(?<=[{CJK}])\(', '（', s)
    s = re.sub(r'\)(?=[{CJK}])', '）', s)
    return re.sub(r'\s+', ' ', s).strip()


# 页眉页脚、页码、装订线。
JUNK_EXACT = {
    '中国居民膳食指南(2022)', '中国居民膳食指南（2022）', '中国居民', '膳食指南',
    '(2022)', '（2022）', '续表', '附录', '附 录', '目录',
}


def is_junk(s: str) -> bool:
    if not s:
        return True
    if s in JUNK_EXACT:
        return True
    if re.fullmatch(r'[\d\s]+', s):                 # 页码
        return True
    if len(s) < 3 and not re.search(rf'[{CJK}]', s):
        return True
    if re.fullmatch(r'[·．.\-—_\s]+', s):            # 装订线 / 分隔符
        return True
    return False


def looks_garbled(s: str) -> bool:
    """
    乱码行：可识别字符占比过低。

    实例：`(ZZ0Z) 灿 碾 和 讯 田 丹` —— 书脊上的字被横过来扫了。
    """
    if len(s) < 6:
        return False
    ok = len(re.findall(
        rf'[{CJK}]|[A-Za-z0-9]|[\s，。、；：（）()《》“”‘’—\-~%．.·×]', s))
    return ok / len(s) < 0.9


# ============================================================
#  2. 认标题
# ============================================================

# 层级常量。数字越大越深，但 5（准则）单独拎出来 —— 它渲染成 ## 但**不切文件**。
BODY, PART, CHAPTER, SECTION, SUB, ZHUNZE, TABLE = 0, 1, 2, 3, 4, 5, 6

RE_PART = re.compile(r'^第([一二三])部分[\s　]*(.*)$')
RE_APPENDIX = re.compile(r'^附\s*录\s*([一二三四五六])[\s　]*(.*)$')
RE_ZHUNZE = re.compile(r'^准则([一二三四五六七八])[\s　]*(.*)$')
RE_CN_NUM = re.compile(r'^([一二三四五六七八九十])[\s　]*、[\s　]*(.+)$')
RE_PAREN = re.compile(r'^[（(]([一二三四五六七八九十]+)[）)][\s　]*(.+)$')
RE_ARABIC = re.compile(r'^(\d{1,2})[.、][\s　]*(.+)$')

PART2_CHAPTERS = ('孕妇', '乳母', '婴幼儿', '儿童', '老年人', '素食')
PART3_CHAPTERS = ('膳食指南修订指导思想', '平衡膳食模式研究', '平衡膳食模式的应用')


def heading(text: str, in_part: int):
    """→ (level, title) 或 (BODY, None)。"""
    if len(text) > 60:
        return BODY, None

    m = RE_PART.match(text)
    if m and m.group(2):
        return PART, f'第{m.group(1)}部分 {m.group(2)}'

    m = RE_APPENDIX.match(text)
    if m:
        return CHAPTER, f'附录{m.group(1)} {m.group(2)}'.strip()

    # ⚠️ 准则N 必须先于「一、」判 —— 两个正则不冲突，但这里注释是为了提醒：
    # 准则N 的编号在婴幼儿/儿童章里会**重新从一数起**，所以它不可能是切文件的
    # 依据，只能是章内部的二级标题。切文件靠的是 CHAPTER（一、二、…）。
    m = RE_ZHUNZE.match(text)
    if m:
        return ZHUNZE, f'准则{m.group(1)} {m.group(2)}'.strip()

    m = RE_CN_NUM.match(text)
    if m:
        body = m.group(2)
        if in_part == 2 and any(k in body for k in PART2_CHAPTERS):
            return CHAPTER, f'{m.group(1)}、{body}'
        if in_part == 3 and any(k in body for k in PART3_CHAPTERS):
            return CHAPTER, f'{m.group(1)}、{body}'
        return BODY, None

    m = RE_PAREN.match(text)
    if m:
        return SECTION, f'（{m.group(1)}）{m.group(2)}'

    m = RE_ARABIC.match(text)
    if m:
        body = m.group(2)
        # ⚠️ 判据里最要紧的是「编号后面得跟汉字」。不然被 OCR 拆散的表格数字
        # 会长成这样：`12. 57.5 12.57.5 12.57.5` / `7. 0` / `0. 01` ——
        # 完美符合「数字 + 点 + 短正文」，于是每一行都变成一个 #### 标题，
        # 在附录里造出几十个假章节。加汉字这一条它们全部落回正文。
        if not re.match(rf'[{CJK}]', body):
            return BODY, None
        # 「1. 平衡膳食模式」是小节；「1. 谷类按能量一致原则…」是正文里的编号
        # 列表项。靠结尾标点 + 长度区分。
        if re.search(r'[。；;]$', body) or len(body) > 26:
            return BODY, None
        return SUB, f'{m.group(1)}. {body}'

    return BODY, None


# ============================================================
#  3. 表格 → Markdown
# ============================================================

def table_md(t: Table) -> str:
    rows = []
    for r in t.rows:
        cells = [clean(c.text).replace('\n', ' ') for c in r.cells]
        if any(cells):
            rows.append(cells)
    if not rows:
        return ''
    if len(rows) < 2:
        # 单行表当不了 Markdown 表头 —— 输出成一行文字，别硬套表格语法
        return ' '.join(x for x in rows[0] if x)
    w = max(len(r) for r in rows)
    rows = [r + [''] * (w - len(r)) for r in rows]
    out = ['| ' + ' | '.join(rows[0]) + ' |', '|' + '---|' * w]
    out += ['| ' + ' | '.join(r) + ' |' for r in rows[1:]]
    return '\n'.join(out)


# ============================================================
#  4. 读一遍正文
# ============================================================

def read_items():
    """按**文档顺序**把段落和表格交替读出来 —— 不能先读全部段落再读全部表格，
    那样表格会全部堆到文末。"""
    d = docx.Document(str(SRC))
    items = []
    for child in d.element.body.iterchildren():
        if child.tag == qn('w:p'):
            items.append(('p', clean(Paragraph(child, d).text)))
        elif child.tag == qn('w:tbl'):
            items.append(('t', table_md(Table(child, d))))
    return items


RE_TOC_LINE = re.compile(rf'[一二三四五六七八九十][\s　]*、.{{0,30}}')


def drop_toc_runs(items):
    """
    丢掉扉页上的分页目录。

    特征是**连续 ≥3 行**都长得像章标题（`一 、孕妇、乳母膳食指南`）。
    不丢的话，第二部分会凭空多出五个空文件、第三部分多出三个 —— 而且
    看起来完全正常（文件名对、内容空），最难发现的那种。

    真正的正文里不会出现连续三行短标题，所以这个判据是安全的。

    ⚠️ **必须在 strip_junk 之后调用。** 扉页的行之间夹着页眉/页码，先把它们
    去掉，这五行才是「连续」的 —— 否则每一段都不足 3 行，一个都删不掉，
    而且仍然会生成五个空文件（我第一版就是这么错的）。
    """
    out = []
    i = 0
    while i < len(items):
        if items[i][0] == 'p' and RE_TOC_LINE.fullmatch(items[i][1]):
            j = i
            while j < len(items) and items[j][0] == 'p' and RE_TOC_LINE.fullmatch(items[j][1]):
                j += 1
            if j - i >= 3:
                i = j
                continue
        out.append(items[i])
        i += 1
    return out


def strip_junk(items):
    """先把页眉/页码/装订线/乱码清掉，再做后面那些「连续性」判断。"""
    return [(k, v) for k, v in items
            if k == 't' or (not is_junk(v) and not looks_garbled(v))]


def join_part_title(items):
    """
    第三部分的标题被拆成了三行：`第三部分` / `平衡膳食模式和膳食` / `指南编写说明`。

    第二部分的同一条路走不通（那里 `第二部分` 后面跟的是目录），所以判据不能
    只看「下一行短不短」，得看**后面跟的不是章标题**。这里用「接下来两行都
    不像 `一、…`」来区分。

    ⚠️ 拼接后是 `第三部分平衡膳食模式和膳食指南编写说明` —— 中间没有空格，
    因为原书就是把一个标题断成三行，不是三个词。这里不替它加标点。
    """
    out = []
    i = 0
    while i < len(items):
        kind, val = items[i]
        m = RE_PART.match(val) if kind == 'p' else None
        if m and not m.group(2):
            tail = []
            j = i + 1
            while j < len(items) and len(tail) < 2:
                k2, v2 = items[j]
                if k2 != 'p' or is_junk(v2) or heading(v2, 0)[0] != BODY:
                    break
                # 封面那一页把三个部分名排在一起（`第二部分` / `第三部分` /
                # `一般人群膳食指南`）。不挡住的话会把它们拼成一个
                # `第二部分 第三部分一般人群膳食指南`，凭空多出一份空文件。
                if RE_PART.match(v2):
                    break
                if RE_TOC_LINE.fullmatch(v2):
                    break
                tail.append(v2)
                j += 1
            if tail and not RE_TOC_LINE.fullmatch(tail[0]):
                out.append(('p', f'第{m.group(1)}部分' + ''.join(tail)))
                i = j
                continue
        out.append(items[i])
        i += 1
    return out


def entries():
    items = join_part_title(drop_toc_runs(strip_junk(read_items())))
    # 前面是封面/版权/编委会/序 —— 和膳食建议无关。从第一部分开始。
    #
    # ⚠️ 判据必须是 `第一部分`，不能是「含『一般人群』」：封面那页把
    # `第二部分` / `第三部分` / `一般人群膳食指南` 三行排在一起，join_part_title
    # 会把后两行拼成 `第三部分一般人群膳食指南` —— 它同样含「一般人群」，
    # 于是 start 落在这个假标题上，真正的 `第一部分` 被当成它的正文，
    # 结果切出一份只有 frontmatter 的空文件 + 一份装了整本书的文件。
    start = next((i for i, (k, v) in enumerate(items)
                  if k == 'p' and v.startswith('第一部分')), 0)
    out = []
    part = 0
    for kind, val in items[start:]:
        if kind == 't':
            if val:
                out.append((TABLE, None, val))
            continue
        # 扉页目录的另一种排法：一行里塞两个「准则N」
        if re.search(r'准则[一二三四五六七八].{2,}准则[一二三四五六七八]', val):
            continue
        lvl, title = heading(val, part)
        if lvl == PART:
            part = {'一': 1, '二': 2, '三': 3}[title[1]]
        if lvl:
            out.append((lvl, title, None))
        else:
            out.append((BODY, None, val))
    return out


# ============================================================
#  5. 切文件
# ============================================================

def split(ents):
    """
    切点只有两处：`部分`（第一/第三部分）和**第二部分下面的章**。

    第一部分下面的「准则一~八」**不切** —— 它们合起来才是《一般人群膳食指南》
    这一份文件，和原书「一份指南 = 一个单元」的分法一致。
    """
    files, cur, part, in_appendix = [], None, 0, False
    for lvl, title, text in ents:
        if lvl == PART:
            in_appendix = False
            # ⚠️ 从标题里现取，不要靠上面的 part 变量 —— entries() 算的是它自己
            # 那份局部 part，split() 这份**从来没被赋过值**（一直是 0），
            # 于是「第二部分下面的章」这条判据永远不成立、五个章全落进同一个
            # 文件里，而文件看起来完全正常。第一版就是这么错的。
            part = {'一': 1, '二': 2, '三': 3}[title[1]]
            if '一般人群' in title:
                cur = {'title': '一般人群膳食指南', 'body': []}
                files.append(cur)
            elif '平衡膳食模式' in title:
                cur = {'title': '平衡膳食模式和膳食指南编写说明', 'body': []}
                files.append(cur)
            else:                      # 第二部分：等下面第一个章标题开文件
                cur = None
            continue

        if lvl == CHAPTER and title.startswith('附录'):
            if not in_appendix:
                in_appendix = True
                cur = {'title': '附录', 'body': []}
                files.append(cur)
            cur['body'].append((lvl, title, text))
            continue

        if lvl == CHAPTER and part == 2:
            cur = {'title': title, 'body': []}
            files.append(cur)
            continue

        if cur is not None:
            cur['body'].append((lvl, title, text))
    return files


# ============================================================
#  6. 渲染
# ============================================================

RENDER = {CHAPTER: 2, ZHUNZE: 2, SECTION: 3, SUB: 4}


def render_levels(body):
    """
    给一段正文里的标题排层级，**第一章里谁在上面由实际顺序决定**。

    第一部分是「准则一 → （一）什么是食物多样」，第二部分是
    「（一）0~6月龄婴儿母乳喂养指南 → 准则一 母乳是婴儿最理想的食物」——
    **同一个 `准则N` 在两处的上下关系是反的**。写死 `准则=##` 会让婴幼儿
    那份文件以 `###` 开头、紧接着一个 `##`，层级先降后升，Markdown 结构是坏的。

    所以：文件里先出现的那个当 ##，另一个当 ###。附录那份只有章，不受影响。
    """
    top = next((lvl for lvl, t, _ in body if lvl in (ZHUNZE, SECTION, CHAPTER)), None)
    out, parent = [], 1        # 1 = 文件标题那行 H1
    for lvl, title, text in body:
        if lvl in (ZHUNZE, SECTION):
            lvl = 2 if lvl == top else 3
            parent = lvl
        elif lvl == SUB:
            # 小节挂在**它所属的那个标题**下面，不是固定第四级。孕妇乳母那份
            # 只有 （一）→ 1. 两层，写死 #### 会从 ## 直接跳到 ####；
            # 婴幼儿那份是 （一）→ 准则一 → 1.，三层，#### 才对。
            #
            # ⚠️ 基准是「上一个非小节标题」而不是「上一个标题」：用后者的话，
            # `1.` 自己会把基准抬到 3，紧接着的 `2.` 就变成 #### —— 同一层的
            # 兄弟标题深度不一样，而单看每一行都挺正常。
            lvl = min(parent + 1, 4)
        else:
            lvl = RENDER.get(lvl, 2)
            # ⚠️ 只有真的是标题才更新 parent。正文段落和表格走的也是这一支，
            # 无条件赋值的话每读一段散文 parent 就被打回 2，
            # 后面所有小节都变成 ###，而每一行单看都挺正常。
            if title:
                parent = lvl
        out.append((lvl, title, text))
    return out

FRONT = """---
title: 中国居民膳食指南（2022）· {title}
source_doc: 2022年中国居民膳食指南 (中国营养学会).docx
publisher: 中国营养学会
doc_type: 官方膳食指南
version: 2022年版
year: 2022
tags: {tags}
---

> **处理说明**：本文件由 WPS 对扫描版 PDF 的 OCR 结果（.docx）转录而来。
> 原书**没有任何标题样式**，`##`/`###` 层级是脚本按文本重建的，不是原书结构。
> 已过滤：封面、版权页、编委会名单、序、页眉页脚、页码、扉页目录。
> 已知缺陷：部分表格被 OCR 拆成了散段（列头丢失）、双栏页面的句序可能串行、
> 图内数据未保留（仅存图题）。**引用具体数值前请与纸质原书核对。**

"""


def slug(i, title):
    # 去掉「一、」这样的章序号：文件名里 `2022膳食指南-02-孕妇乳母膳食指南.md`
    # 比 `…-02-一孕妇乳母膳食指南.md` 好读，序号本来就在前面。
    t = re.sub(r'^[一二三四五六七八九十]\s*[、.．]\s*', '', title)
    t = re.sub(r'[^\w一-鿿]+', '', t)[:26]
    return f'2022膳食指南-{i:02d}-{t}.md'


RE_TABLE_TITLE = re.compile(r'^表\s?\d')


def dense_run(flat, i):
    """
    `flat[i]` 是一个表题时，往下数还有几行是「又短又数字密集」的碎段。

    窗口扫到下一个表题或一句长正文（>60 字）为止。**不能只取紧接着的 5 行**：
    被拆散的表格前面往往还留着**同一张表的正常版本**（WPS 有时两版都留），
    那个 Markdown 表一挤就把窗口占满，真正碎掉的行落到窗口外面 ——
    于是一处都报不出来，看上去像「没有坏表格」。
    """
    n = 0
    for x in flat[i + 1:i + 40]:
        if RE_TABLE_TITLE.match(x) or len(x) > 60:
            break
        if len(x) < 30 and len(re.findall(r'\d', x)) >= 3:
            n += 1
    return n


def mark_flattened(files):
    """
    在被拆散的表格上加一行警示，**不猜着重排**。

    重排的失败方式是「列对上了但错位一格」—— 看起来完全正常，数字也像模像样，
    比留着散段糟得多。但什么都不做也不行：一串孤零零的 `85~100` 挂在表题下面，
    检索到之后模型很有动力替它编个含义。

    所以只加一句「这里读不了」，把「编一个解释」这个动作堵掉。
    代价是那串数字本身仍然不可用 —— 这是诚实的上限。
    """
    note = ('> ⚠️ 下表在 OCR 后**列头丢失**，只剩窜在一起的数字，**无法解读**。'
            '此处不要给出任何数值建议，需要时请查纸质原书。')

    def walk(body):
        flat = [t for (lvl, _, t) in body if t and lvl != TABLE]
        out, j = [], 0
        for lvl, title, text in body:
            out.append((lvl, title, text))
            if text and lvl != TABLE:
                if RE_TABLE_TITLE.match(text) and dense_run(flat, j) >= 3:
                    out.append((BODY, None, note))
                j += 1
        return out

    for f in files:
        f['body'] = walk(f['body'])


def find_flattened(files):
    """
    找出「表题后面跟着一串碎段」的地方，报告用。

    **这是启发式抽样，不是穷举** —— 只报能认出来的，不报「一共有几处」。
    判据见 dense_run()。
    """
    out = []
    for f in files:
        # 只扫段落：真表格是 Table 对象，混进来会把窗口占满（见 dense_run）
        flat = [t for (lvl, _, t) in f['body'] if t and lvl != TABLE
                and not t.startswith('> ')]
        for i, s in enumerate(flat):
            if not RE_TABLE_TITLE.match(s):
                continue
            n = dense_run(flat, i)
            if n >= 3:
                out.append(f"[{f['title']}] {s[:44]}  →  后随 {n} 段散落的数字")
    return out


def main():
    files = split(entries())

    # 自检：切出来的东西必须像话。空了说明认标题的规则坏了 ——
    # 而「文件都在、内容几乎全空」是最难发现的坏法，所以要显式挡住。
    bad = [f['title'] for f in files if len(f['body']) < 8]
    if bad:
        print('[!] 这些文件切出来几乎是空的，说明标题识别有问题：')
        for b in bad:
            print('    ' + b)

    # 报告先跑：它按「表题 + 后面跟着散段」认，加过警示行之后再跑会被那些行
    # 干扰下标（警示行本身以 `> ` 开头，会被过滤，但顺序上先跑更省事）。
    flat = find_flattened(files)
    mark_flattened(files)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for i, f in enumerate(files, 1):
        lines = [FRONT.format(title=f['title'],
                              tags='[' + ', '.join(['膳食指南', '平衡膳食', f['title']]) + ']'),
                 # 正文里也要有一行 H1。frontmatter 是给人和索引用看的，
                 # 而 RAG 切块时只看得见正文 —— 没有这行，孕妇那一段就会被
                 # 当成一般人群的建议、婴幼儿那一段也是。（层级说明见文件头。）
                 '# ' + f['title'] + '\n']
        for lvl, title, text in render_levels(f['body']):
            if title:
                lines.append('\n' + '#' * RENDER[lvl] + ' ' + title + '\n')
            elif text:
                lines.append(text + '\n')
        md = '\n'.join(lines).rstrip() + '\n'
        name = slug(i, f['title'])
        (OUT_DIR / name).write_text(md, encoding='utf-8')
        written.append((name, len(md), md.count('\n')))

    print('\n=== 生成 %d 份 ===' % len(files))
    for name, chars, n in written:
        print('  %-44s %7d 字 %5d 行' % (name, chars, n))
    print('\n=== 疑似被 OCR 拆散的表格：认出 %d 处 ===' % len(flat))
    for s in flat[:30]:
        print('  ' + s)
    if len(flat) > 30:
        print('  … 另有 %d 处（全量见 private/kb-report.txt）' % (len(flat) - 30))
    print('  （抽样，不是穷举 —— 没被列出的不代表没问题）')

    (ROOT / 'private').mkdir(exist_ok=True)
    (ROOT / 'private' / 'kb-report.txt').write_text(
        '\n'.join(f'{n}\t{c}字\t{l}行' for n, c, l in written)
        + '\n\n=== 疑似被 OCR 拆散的表格 ===\n' + '\n'.join(flat)
        + '\n\n=== 切出来过小的文件 ===\n' + '\n'.join(bad), encoding='utf-8')


if __name__ == '__main__':
    main()
