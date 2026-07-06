# 交接：message-cards-ink 的「保留墨恢复」与「资源生命周期」问题

> 给接手的 agent：这是一份待解决问题的上下文。当前代码处于「26 测试全过」的稳定态，
> 下面列出的问题**尚未修复**（我已撤回未验证的尝试）。请你先理解问题、再动手，并先写测试。
> 用户明确要求：**先写测试用例，再改代码，用代码（不是截图）验证。**

## 一、背景：这个 demo 在做什么

文件：
- `evidence/message-cards-ink.html` — demo 本体
- `evidence/message-cards-ink.test.html` — 测试套件（26 断言，全过）
- `evidence/ink-material-engine.js` — WebGL2 流体墨引擎（从 inkframe-demo 复制，未改）

**架构（按需渲染，为了省内存）：**
- chat 消息卡片很多张，不可能每张一个 WebGL context（Apple Silicon 上每个 WebGL2
  context ~150MB 驱动驻留，5 卡就 ~1G）。
- 所以：默认所有卡片是**静态纸纹图**（启动时引擎跑一帧 idle 干纸，抓成 dataURL，所有卡共用）。
  常态 **0 个 WebGL context**。
- 用户点某卡片「渲染」→ 临时为该卡建 1 个 context 跑流体 sim，可画墨（拖=墨笔，右键=水刷）。
- **全局单例**：同一时刻最多 1 个活 surface（卡片间互斥、卡片与桌面互斥）。
- 点「收起」关闭：保留模式抓 canvas 最后一帧当新背景图（墨留着）；丢弃模式回初始公共纸纹图。
- 桌面也能激活画墨，但桌面**永远是它自己的 CSS 颜色**（radial-gradient），不被 prerender 图覆盖。

**已验证通过（26 断言）：** 0-context 初始态、单例互斥、卡片/桌面 tint 不串色、
卡片保留/丢弃、桌面可画、桌面背景不被改（T12）、桌面收起保留有效（T13）、丢弃清空（T14）。

## 二、待修复的问题（用户本轮反馈）

### 问题 A：再次渲染后，之前保留的墨会丢失  ← 已复现确认

**复现脚本（已在浏览器跑过，结果属实）：**
```js
// 1) 激活卡片 A、画墨、收起(保留) → 背景图变成带墨的 dataURL（成功保留）
// 2) 再次点 A「渲染」→ 新建了一个【空白】surface
// 3) 第二次收起(保留) → 抓到的是空纸，把之前的墨覆盖丢了
```
实测：第一次保留成功（`backgroundOf(A) !== initialPaperImage()`），
但第二次收起后背景图变了（`bgAfterSecondKeep !== bgAfterKeep`）—— 之前的墨没了。

**根因：** `activateCard()` 每次都 `InkMaterial.create()` 新建一个空白 surface，
没有把上次保留的墨痕恢复进去。保留的 dataURL 只挂在 DOM 背景上当图片显示，
再次激活时这块图被 canvas 盖住，新 surface 又是空的，墨就断了。

**修复方向（我已验证可行，但没合入）：**
再次激活时，若该卡有保留图（且≠初始公共纸纹），把它作为 source 烤进新 surface：
```js
// 在 activateCard() 创建 surface 之后：
const keptUrl = state.perCardBg.get(paper);
if (keptUrl && keptUrl !== state.paperDataURL) {
  const img = new Image();
  img.onload = () => {
    if (!state.active || state.active.surface !== surf) return; // 已切走就别烤
    surf.loadImage(img);
    surf.bakeSource({ density: 0.9, wet: 0 });
  };
  img.src = keptUrl;
}
```
**为什么这样能只恢复墨、不把纸纹也当墨烤进去：** `bakeSource()` 的 mark score 是
`darkness + chroma*0.75`，再用 `smoothstep(0.12, 0.2, mark)` 过滤（见引擎 1267 行）。
纸纹底色 lum≈0.97 → darkness≈0.03 → mark≈0.03 < 0.12 → 被过滤，dens≈0，不烤。
只有真正的深色墨迹（darkness 大）才会被烤进 ink/fixed 场。所以把"纸纹+墨"的合成快照
bake 进去，纸纹自动滤掉，墨恢复。

**待确认的产品决策：** 恢复后是「接着画」（可继续编辑旧墨）还是「旧墨冻结不可改」？
我倾向「接着画」（符合「保留」的语义），但用户没明确。引擎默认 bake 后是可继续画的。

### 问题 B：保存的图片放在哪、释放时销毁吗？  ← 代码审查发现，无释放逻辑

**现状（代码事实）：**
- 图片就是 **dataURL 字符串**，挂在两处：
  1. DOM：`paper.style.backgroundImage = url("data:image/png;base64,...")`
  2. JS Map：`state.perCardBg.get(paper)` — paper 元素 → 当前 dataURL
- **没有任何释放逻辑。** dataURL 是 JS 字符串，靠 GC 回收。
- 每次保留会生成一个新的 ~1-8MB 的 dataURL 字符串。

**潜在累积问题：**
- 同一张卡反复「渲染→画墨→保留」，`state.perCardBg.set(paper, 新url)` 同 key 覆盖，
  旧 dataURL 失去引用 → GC 可回收。这部分**理论上不泄漏**，但需测试验证（见下方 T17）。
- 但 DOM 的 `paper.style.backgroundImage` 每次被新 url 覆盖，旧的也失去引用 → GC 可回收。
- **真正要补的：** 丢弃（drop）时，应把 Map 里的条目设回初始公共纸纹图（`state.paperDataURL`），
  而不是保留私有 dataURL。当前 `deactivateCurrent` 的 card drop 分支已做 `perCardBg.set(paper, paperDataURL)`，
  但要确认这能让私有 url 失去所有引用。

**建议测试（我已写好断言草稿，未合入）：**
- T16：丢弃后 `backgroundOf(card) === initialPaperImage()`（不残留私有图）
- T17：同卡反复「渲染→保留」3 次，`perCardBg.size` 不增长（同 key 覆盖，不泄漏）

### 问题 C：重新打开（刷新/重开浏览器）后，之前画的墨保留吗？  ← 当前完全不保留

**现状（代码事实）：**
- **不保留。** dataURL 只在内存（JS Map + DOM style），页面一刷新全没。
- 没有任何 localStorage / IndexedDB / sessionStorage 持久化。

**这是产品决策（用户没明确，需要确认）：**
- 选项 1：要持久化 → 画完的墨存 localStorage（图小）或 IndexedDB（图大），刷新后恢复。
- 选项 2：不要持久化 → 墨只在当前会话内存，刷新就丢（当前行为）。
- 选项 3：只在 demo 验证可行性；将来接到 smallkhoj 时由后端存（不是前端 localStorage）。

dataURL 体积：每个 ~1-8MB（PNG）。localStorage 上限 ~5-10MB，存不了几张；
IndexedDB 可以存大 blob，但要异步序列化。这影响选型。

## 三、关键代码位置（行号基于当前文件）

`message-cards-ink.html`：
- `preRender()` 351-376：预生成静态纸纹图（一次性，用完即毁 context）
- `activateCard()` 402-420：**问题 A 的修复点**（再次激活要恢复墨）
- `deactivateCurrent(keep)` 443-477：收起逻辑（card keep/drop 在 445-460，desk 在 461-476）
- `state` 对象 330-336：`perCardBg` Map 是图片存储（问题 B 的核心）
- `makeTestAPI()` 586-606：测试 API（问题 C 持久化要在这里加 load/save 方法）

`ink-material-engine.js`（不要改这个共享文件）：
- `loadImage(img)` 1181：把图作为 source 载入
- `bakeSource()` 1231：把 source 烤进 ink/fixed 场，**mark score 自动滤纸纹**（1267 行）
- `pen()`/`brush()` 969/994：画墨/水，会设 `_lastInputAt` 唤醒 sim
- `_isLive()` 1668：idle+无输入时 sim 睡眠，省 CPU

## 四、验证要求（用户强调）

- **不要用截图验证。** 用 twd 在浏览器里跑 `message-cards-ink.test.html`，看 PASS/FAIL。
- twd 用法：`./twd goto URL --tab <id>`、`./twd eval --tab <id> "return ..."`、
  `./twd cdp Page.bringToFront --tab <id>`（后台 tab rAF 会暂停，必须 bringToFront）。
- 测试套件在 `message-cards-ink.test.html`，断言框架极简（assert + 计数）。
- 新增断言（A/B/C）应加到测试文件，跑通后再说做完了。
- 测像素用：`gl.readPixels` 读引擎 ink/wet 场（ground truth）或 canvas 渲染输出。
- 本地跑：在 `evidence/` 目录 `python3 -m http.server 8771`，开 `?v=N` 防 Quark 缓存。

## 五、待用户确认的产品决策（接手 agent 请先问清楚）

1. 问题 A 恢复后：**接着画（可编辑旧墨）** 还是 **旧墨冻结**？（技术默认：接着画）
2. 问题 C：**刷新/重开后要不要保留墨**？要的话存哪（localStorage / IndexedDB / 后端）？

这两个不确认就动手，很可能做完又不符合预期（前几轮的教训）。
