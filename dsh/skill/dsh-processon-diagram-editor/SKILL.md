---
name: dsh-processon-diagram-editor
description: "在用户已打开的 ProcessOn 画布上做 AI 增量改图。读取现有泳道图/流程图结构（节点、连线、泳道、文字），直接在原画布上创建/修改/删除图元，改动红色高亮，多人协同实时可见。支持同时打开多张 ProcessOn 图时精确定位目标图。触发词：改这张流程图、在ProcessOn加一步、补充泳道图环节、AI改图、流程图增删改、把这段流程画进现有图。不用于从零新建整张图（那用 processon-diagram-generator）。"
---

# ProcessOn 画布编辑器（DSH 版）

在用户正在看的 ProcessOn 画布上直接读写，改动实时渲染、红色标记、同事可见。

**这套是给 DeepSeek Harness 用的**。它依赖 DSH 浏览器扩展提供的 `browser_*` 工具；
用 WorkBuddy 的同事请装 `wb-processon-diagram-editor`，那套自带 Chromium，机制不同但改图能力一致。

### 🆕 从零画图（不只是改图）

本技能现在也能**从空白处一笔一笔画出整张图**，而不是只改现有内容。

```js
POBridge.drawDiagram({
  origin: { x: 1900, y: 300 },   // 左上角起点
  idPrefix: 'dg_',                // 所有图元 id 前缀（便于回滚）
  width: 950,                     // 池宽
  lanes: [
    { title: '施工单位', items: [
        { text: '发起申请', shape: 'start' },
        { text: '编制方案', shape: 'process' },
        { text: '内部审批', shape: 'process' } ]},
    { title: '监理单位', items: [
        { text: '形式审查', shape: 'process' },
        { text: '是否通过', shape: 'decision' } ]},
    { title: '建设单位', items: [
        { text: '批准实施', shape: 'process' },
        { text: '归档', shape: 'end' } ]}
  ],
  edges: [
    ['0.0','0.1'], ['0.1','0.2'], ['0.2','1.0'],
    ['1.0','1.1'], ['1.1','2.0','是'], ['1.1','0.2','否'], ['2.0','2.1']
  ]
});
// edges 的端点写 "行号.列号"，第三位是可选的连线文字
```

#### 形状语义表（`shape` 取值）

| shape | 官方形状名 | 尺寸 | 视觉 | 用在哪 |
|---|---|---|---|---|
| `start` | `start` | 84×60 | 圆头（含 curve） | 流程起点 |
| `end` | `terminator` | 84×60 | 圆头 | 流程终点 |
| `process` | `process` | 100×70 | 矩形 | 普通步骤 |
| `decision` | `decision` | 90×70 | **菱形** | 判断/分支 |
| `storedData` | `storedData` | 100×70 | 曲面 | 数据/表单 |
| `predefined` | `predefinedProcess` | 100×70 | 双竖线框 | 子流程 |

> ⚠️ **不要用 `end` 作为官方形状名** —— 它会让 `Model.create` 抛
> `Cannot read properties of undefined (reading 'startsWith')`。终点要用 `terminator`。
> 本技能的 `shape:'end'` 已内部映射到 `terminator`。

#### 底层原语（想自己拼时用）

| 方法 | 作用 |
|---|---|
| `buildNode({shape,x,y,w,h,text})` | 造单个节点（纯数据，含正确 path/anchors） |
| `buildPool({x,y,width,lanes})` | 造池 + N 条泳道 + 表头 |
| `buildRow({laneY,startX,items})` | 在一行里顺序摆节点（自动垂直居中） |
| `drawEdge({from,to,text,fromSide,toSide})` | 画一条连线（自动定边 + 折点） |
| `commit([...])` | 批量落库（一次 executeMessages） |
| `drawDiagram(spec)` | 上面全串起来，一次画出整图 |

#### 画得像人：手绘风格参数

从一张 125 图元的真实手绘图里量出来的（`docs/handdrawn-style-spec.md` 有全量数据）。
**核心是 5 个数字，不是审美玄学。**

| 参数 | 手绘实测值 | 为什么 |
|---|---|---|
| 同排水平净空 | **48–50px**（中位 51） | 手绘的"呼吸感"本质就是这个常量 |
| 同列垂直净空 | **48px**（gapY = 节点高 + 48） | 与水平同一个常量，不是两套规则 |
| 泳道内垂直居中 | 上 65 / 下 65（200px 高泳道） | 严格居中，不是顶部对齐 |
| 判断节点尺寸 | **90×70，14/14 完全一致** | 形状即语义，尺寸也要统一 |
| 墨色数量 | **2 色**：边框 `33,41,48` + 文字 `50,50,50` | 手绘 123/125 图元零样式覆盖 |

```js
POBridge.STYLE  // 已内置上面全部默认值
// { gapX:51, gapY:118, laneH:200, lanePadTop:65, poolHeaderW:84,
//   fillColor:'255,255,255', borderColor:'33,41,48', borderWidth:1.5,
//   fontColor:'50,50,50', fontSize:13, fontFamily:'微软雅黑', linkWidth:1.5 }
```

**手绘相对 AI 生成的优势，实测三条**（这是复刻重点）：

1. **图形语义 100% 不混用** —— 15 个判断全是真菱形；AI 生成的图里判断被画成矩形，读者必须读文字才知道要分叉。
2. **间距覆盖率** —— 手绘 57% 的相邻节点对落在 38–62px 目标带，AI 只有 29%，其余是 172–1900px 随机跳空。
3. **配色克制** —— 手绘 2 色，AI 10 色且其中 4 种粉色肉眼不可辨。

> ⚠️ **不要抄手绘的缺点**：它的 `process` 宽度有 6 种、高度有 14 种取值，x 坐标不对齐 15px 网格，
> 还有 3 处节点重叠（−98~−139px）。那是手拖噪声，不是风格。复刻要抄的是
> **语义不混用 + 单一墨色 + 50px 净空 + 垂直居中 + 列对齐**。

#### 画得像人：拟人化参数（humanize）

机械等距看起来"标准"但不像人画的。人画的图有轻微不均匀、按文字量定宽、按语义分层。
这些都做成了**可复现的参数**（同 seed 得同一张图，不是随机漂移）。

```js
POBridge.setHumanize({ enabled: true, seed: 20261118, gapJitter: 0.18 });
POBridge.setHumanize({ enabled: false });          // 回到严格等距
POBridge.setHumanize({ seed: 12345 });            // 换一种"随意"
POBridge.setHumanize({ gapJitter: 0.30 });        // 更随意
POBridge.setHumanize({ widthMax: 200 });          // 允许更宽节点
POBridge.setHumanize();                           // 不传参 = 读当前值
```

**默认参数**（`STYLE.humanize`）：

| 参数 | 默认 | 作用 |
|---|---|---|
| `gapJitter` | 0.18 | 间距抖动 ±18%，实测产出 `57,54,45,60,50,47,56,53` 八个不同值 |
| `widthPerChar` | 13.2 | 每字宽度（微软雅黑 13px 实测） |
| `widthPad` | 34 | 定宽左右留白 |
| `widthMin` / `widthMax` | 84 / 168 | 宽度上下限（超长文字换行而非无限加宽） |
| `semanticScale` | 见下 | 语义尺寸层级 |

```js
semanticScale: { start: 0.92, end: 0.92, terminator: 0.92,  // 端点略小
                 decision: 1.06,                            // 判断略大（菱形要空间）
                 process: 1.0, rectangle: 0.94 }
```

**为什么这样才像人**：
- 人会按文字多少给框子不同宽度（实测「初审」100 → 「金额是否超过一百万元」164）
- 人不会精确等距，但也不会乱来（±18% 恰好是"手拖"的误差范围）
- 人让判断节点大一点，因为它要放分叉文字

> ⚠️ 但**不要**学手绘真正的缺点：`docs/handdrawn-style-spec.md` 记录那张图
> 的 `process` 有 6 种宽度、14 种高度取值，还有 3 处节点重叠 —— 那是手滑噪声，
> 不是风格。拟人化要的是"看起来自然"，不是"复现错误"。

#### 从零画图的 6 个实战陷阱（盲测实测，全部踩过）

**① `drawDiagram` 自己建池，不要再预先 `createPool`**
两者都建池 → 叠出两套泳道和表头。要么全用 `drawDiagram`，
要么全用底层原语（`buildPool`/`buildNode`/`drawEdge`），别混。
（现在 `drawDiagram` 会先清掉同前缀的旧图元，但仍建议别混用。）

**② `edges` 支持第 4/5 位指定出入口边**
```js
edges: [
  ['1.1','2.0','是','B','T'],   // from 走下边，to 走上边
  ['1.1','0.2','否','R','R']
]
```
不指定时自动选边，跨泳道场景容易给出蛇形绕行（实测出现 3 折点向上绕）。
**跨泳道的线一定要手动指定边。**

**③ 尺寸参数要显式传**
`drawDiagram({ laneH: 240, headerWidth: 110, ... })` ——
默认 `laneH=200`、`headerWidth=84`。泳道高不够会导致表头文字被裁。

**④ `focusRect` 已修（探针校准）**
旧版直接把滚动量当 viewBox 用，`zoom≠1` 时算错。
现在它先挪 120px 探一下比例再算，**任何 zoom 下都准**。
但注意它依赖 `Utils.canvasViewBoxUpdate()`，若页面禁用了该函数会退回 1:1。

**⑤ 改节点几何后必须重建连线**
`rebindEdges` 能修好 `from/to/points`（数据层），但**渲染层可能滞后** ——
DOM 里连线的盒还在旧位置，截图看到箭头扎进节点内部，而数据审计全绿。
- 现已修：`applyGeo` 会同步 `textPos`，标签不再停在旧坐标。
- 但**渲染滞后仍可能存在**。改完几何后跑一次 `auditEdgeRender(prefix)`，
  它比对"数据包围盒 vs DOM 包围盒"的宽高比，能抓出这类隐蔽缺陷。
- 最粗暴也最可靠：**删掉连线用 `drawEdge` 重建**。

**⑥ 验收清单现在有 7 项**

在原来 6 项（正交/无零长段/无穿节点/锚点居中/角度正确/无重叠）之外加：

| 7 | `auditEdgeRender(prefix).pass === true` | 抓"数据对、画面错" |

#### 从零画图：第二批实战陷阱（第二轮盲测）

**⑦ `saveAndVerify` 的旧判据永远超时（已修）**
旧版要求 `localStorage['version_local_*'] === sendMessage.version`，
但这两个是**不同步的计数器**（实测 2380 vs 2378，方向不固定），"相等"从不成立。
现在改为：**图标回到 `#icon-cloud_sync` && `saving===false` && `errorSave===0`**。
验证落库最可靠的办法仍是**开新标签页重载同一 URL 再读 `Model.define.elements`**。

**⑧ `createPool` 传 `title:''` 会留一条空白竖带**
池左侧 `headerWidth` 宽的表头区没有文字 → 视觉上是一条空带。
而且**事后补标题会失败**：用 `executeMessages` 走 `update` 改池的 `textBlock`
会抛 `Cannot read properties of undefined (reading 'length')`。
**结论：建池时就把 title 给对，别想着事后补。**
（若确实需要无标题池，把 `headerWidth` 调小到 40–56 减少空带。）

**⑨ 跨泳道流程不要用 `drawDiagram`**
`buildRow` 让每条泳道都从同一个 `startX` 起排，做不出"楼梯式"跨泳道推进。
所以「陷阱①」的正确解读是：
- **各泳道独立并列**的图 → `drawDiagram` 一把梭
- **跨泳道纵向跳转**的图 → 必须走底层三件套 `createPool` + `buildNode` + `drawEdge`

**⑩ `e.text` 不是连线的文字字段**
文字在 `e.textBlock[0].text`（配合 `e.textPos` 定位）。
审计脚本若读 `e.text` 会得到全空，然后报 `pass:true` —— **假绿**。
`drawEdge` 现在两个字段都会写，但已有连线（尤其手绘的）只保证 `textBlock`。

#### 自动保存

```js
await POBridge.saveAndVerify(15000);
// -> { ok: true, href: '#icon-cloud_sync', version: 2290, elapsedMs: 1200 }
```

判定"已落库"的三条件（实测）：`#save-tip` 图标回到 `#icon-cloud_sync`
&& `sendMessage.saving === false` && `localStorage['version_local_<fileId>']` 与
`sendMessage.version` 一致。优先调 `UI.save()`，它内部走 `sendMessage.saveOnline('click')`。

### 已实测能力

- 读取现有泳道图 / 流程图结构（节点、连线、泳道、文字）
- 创建 / 修改 / 删除节点与连线，改动红色高亮
- 泳道池行数控制：`getPoolRows` / `createPool` / `setPoolRows` / `removePoolExpr`（见第五节）
- 节点宽度自适应：`measureTextFitExpr` / `fitNodeSizeExpr` —— canvas `measureText` 精确量文字后定宽，只缩不放（见五之三）
- 多标签场景精确定位目标图、视口跳转不打扰用户

> 页面侧 JS 片段全部集中在本技能目录的 `lib/page.mjs`。**不要现场手写 JS** —— 用那里的函数，参数走 `JSON.stringify`。
> 离线自检：`node test/selftest.mjs`（163 项）+ `node test/parity.mjs` + `node test/verify-pool.mjs`（33 项）—— 都不需要浏览器、不碰画布，本技能自带。

---

---

## 零、动手之前：先问清楚，别硬画

**改图比画图更容易出错。** 画一张新图错了大不了重画；在别人正在用的图上改错了，是事故。

### 什么时候必须先问

命中任意一条，**先停下来问用户，不要猜**：

| 信号 | 典型说法 | 为什么危险 |
|---|---|---|
| **位置不明** | 「加个审批环节」 | 在谁之后？谁之后都说得通，猜错整条线要重画 |
| **分支去向不明** | 「加个判断」 | 不通过回哪？回到上一步 / 退回发起人 / 结束，三种画法完全不同 |
| **对象不明** | 「改一下这个」 | 改哪个节点？同名节点可能有好几个 |
| **范围不明** | 「优化一下流程」 | 改 1 个节点还是重排整页？工作量差 100 倍 |
| **删除风险** | 「把这段去掉」 | 被删节点上挂着的连线怎么办？断开会产生悬空线 |
| **多人协同** | 用户提到同事也在看 | 改动实时广播，最好先打招呼 |

### 怎么问 —— 一次问完，不要挤牙膏

**反例**（用户会被问烦）：
> 这个审批放在哪？→ 那驳回之后呢？→ 驳回要通知谁？

**正例**（一次给全，带默认值）：
> 加「审批」环节，我需要确认 3 件事：
> 1. **位置**：放在「提交申请」之后（推荐）还是「归档」之前？
> 2. **驳回去向**：退回发起人（推荐）/ 回到上一步 / 直接结束？
> 3. **留痕**：要不要加照片或签字留痕？
>
> 不回复的话我按推荐值画，画完你再看。

### 三个默认值原则

用户说「你看着办」或不想回答时，按这三条兜底，**并在交付时说清楚用了默认值**：

1. **位置** —— 放在流程最接近的合理位置，且**不打断已有主干**
2. **分支** —— 驳回一律**退回发起人**，形成闭环，不要悬空
3. **留痕** —— 关键节点默认**加留痕**（照片/签字），这是业务图的常态

### 信息够了再动手 —— 自查三问

- [ ] 我知道**改哪个节点**（有 id 或能唯一定位）
- [ ] 我知道**新内容放在哪**（前后邻居是谁）
- [ ] 我知道**分支怎么走**（不通过回哪）

**三问有一问答不上，就先问。**

---

## 一、先确认目标图 —— 多标签场景必读

用户可能同时开着好几张 ProcessOn 图。**动手前必须先锁定唯一目标，绝不能猜。**

### 步骤 1：列出所有候选

用 `browser_tabs({action:'list'})` 拿标签页，按 URL 过滤两类：

| 类型 | URL 特征 | 怎么拿 file_id |
|---|---|---|
| 直连 | `wps.processon.com/diagrams/edit?...&file_id=数字` | URL 里直接有 |
| kdocs | `www.kdocs.cn/view/l/XXXX` 或 `/l/XXXX` | 藏在 `#dotviewIframe.src` 里 |

对每个候选执行 `TAB_IDENT` 片段（见 `lib/page.mjs`）拿到 `{title, fileId, kdocsDoc}`。

### 步骤 2：向用户确认

把候选列表报给用户，让他选：

> 你现在开着 2 张图：
> 1. 「某人流程图」— file_id 123456789
> 2. 「某业务架构」— kdocs 文档 AbCdEfGhIjKl
>
> 要改哪一张？

**不要自行假设「当前激活的就是目标」** —— 用户可能想让你改背景那张。

### 步骤 3：校验

确定目标后读一次图，把**节点数、连线数、泳道名**报给用户核对。数量对不上就是选错了。

### 三个实测坑

**坑 1：后台标签页能不能干活 —— 分读写，别一刀切**

先说结论：**读写都不需要激活标签页。** 后台标签页照样能读结构、建节点、改坐标、删图元，
实测建节点 36–76 ms、协同回传 ≤ 800 ms。`canvasViewBoxUpdate()` 只读
`.width()/.height()/.scrollLeft/.scrollTop()`，是纯强制布局同步读，与会话是否绘制无关。

**唯一会超时的是"等待渲染结果"**。后台页面的 `requestAnimationFrame` 不跑
（实测 3 秒 0 帧，`document.hasFocus()` 为 false），所以任何**依赖 rAF 完成**的等待都会超时。
但 ProcessOn 的 `renderShape` 是同步的 —— 写操作本身不等帧。

**怎么区分「休眠超时」和「代码太慢超时」** —— 依次跑三段：

1. `1+1` —— 连这个都超时 = 标签页真的休眠了（罕见），换下一个标签页
2. `typeof window.POBridge` —— 这个超时 = 桥接层丢了，重新注入
3. `Object.keys(Model.define.elements).length` —— 前两个过、这个超时 = 图太大，分段读

**什么时候才需要激活**（都是显式理由，不是默认动作）：

- 要**截图**给用户看 —— 后台截图不稳（实测 8 次有 4 次超时，最长 27835 ms）。别做成同步流程。
- 用户问"改动在哪"而你**必须让他立刻看见** —— 优先用"改动清单 + 坐标 + 泳道"描述，
  问一句再跳。跳转用 `focusRect()`，**不要** `fitTheCanvas()`。
- 写操作反复失败且怀疑是多标签协同回显冲突 —— 这时在用户所在标签页做更稳。

**跳转别用 `fitTheCanvas()`** —— 它会把用户的滚动位置拉走（实测 1730 → 967）、
重置用户手动调好的缩放、还要阻塞重绘（实测超时 114ms）。这是真正的打扰。
用 `focusRect(x, y, w, h)`：只改 `scrollLeft/scrollTop` + `Utils.canvasViewBoxUpdate()`，
实测滚动位置前后一致、不动缩放、不超时。

**坑 2：标签列表里没有 ProcessOn 的 file_id**
kdocs 的 URL 只有文档 ID，真正的 `file_id` 在 `#dotviewIframe.src` 里。
所以光看图列表**无法**区分哪张 kdocs 里是 ProcessOn 图 —— 得逐个读 iframe 的 src。

**读 iframe 不用激活标签页**（这和坑 1 是一回事）：`#dotviewIframe.src` 是父页面 DOM 上的
属性，`browser_evaluate` 在后台标签页直接读就行。只有当你需要读 iframe **内部**的
`Model` 时，才要按下面「kdocs 内嵌图的处理」新开标签页 —— 那是跨域限制，不是激活限制。

**坑 3：`pageInfo.pageKey` 不稳定**
同一文档两次加载，pageKey 会变（实测 `8b776e91…` → `c0196e68…`）。
**不能用作身份标识**，唯一可靠的是 `file_id`。

### kdocs 内嵌图的处理

`#dotviewIframe` 跨域，父页面里碰不到。做法：
1. 读父页面 iframe 的 `src`
2. `browser_tabs({action:'open', url: src})` 新开标签页
3. 在新标签页注入桥接层、执行操作
4. 完成后告诉用户：改动在 ProcessOn 侧，kdocs 刷新即可见

---

## 二、注入桥接层

读取技能目录下的 `pobridge.min.js`，用 `injectExpr()` 包好后 `browser_evaluate`。

成功标志：返回 `{bridge: 'object'}`。重复注入安全（幂等）。

**注入失败怎么办**：返回 `{bridge:'undefined'}` 说明页面不是编辑态，或 `Model/MessageSource` 不存在。
如实告诉用户并给出排查方向，**不要假装成功**。

---

## 三、读取结构

```js
// 用 lib/page.mjs 的 READ_GRAPH
var g = POBridge.readGraph();
// g.nodes: [{id, name, title, text, x, y, w, h, zindex, parent, isLane}]
// g.edges: [{id, from, to, text, points}]
// g.page:  {width, height}
```

泳道图必须讲清这几点再动手：
- 有几条泳道，各是什么角色
- 每条泳道里有哪些环节
- 哪些是判定节点、分支怎么走

> **泳道池有几行、怎么控制行数**：见「五、泳道池行数控制」。`readGraph()` 会把 pool / lane
> 平铺进 `nodes`，要看「池 children ↔ lane parent」的父子关系请用 `POBridge.getPoolRows(poolId)`（只读）。

---

## 四、执行改动

坐标规律：
- `horizontalPool` 是泳道池，`pool.bottom` 是整张图的下边界 —— 「加到图下面」用它
- 泳道 `horizontalLane` 从上往下堆叠
- 图元尺寸普遍很小（85–200px），别用网页设计的直觉猜

```js
// 创建：坐标可省略（自动 clamp 进视口），默认红色
var r = POBridge.createNode({
  text: '合规性预审',
  x: 1600, y: 200,        // 可省
  w: 260, h: 100,
  name: 'process'          // process | decision | terminator | ...
});

POBridge.updateNode(id, { text: '新文案' });
POBridge.removeNodes([id1, id2]);
POBridge.createEdge({ from: idA, to: idB, text: '是' });
```

### 🔴 防重复图元 —— 这条最重要

`browser_evaluate` 有 **100ms 超时**，但操作可能**已经生效**。盲目重试会多出一个重复图元。

规矩：
1. **id 由你生成并显式传入**（`ai_node_<时间戳>_<随机>`），不要交给页面生成
2. eval 报超时后，**先执行 `existsExpr(id)` 探测**，确认不存在才重试
3. 探测本身也失败时**不要重试** —— 那是页面卡死，不是「没建上」

**真机实测数据**（53 节点 / 62 连线的泳道图，Windows + Edge）：

| 操作 | 表面结果 | 实际结果 | 探测结果 |
|---|---|---|---|
| `createNode` | eval timeout after 100ms | **已创建**，图元数 115→116 | `exists: true` |
| `updateNode` | eval timeout | **已生效**，文案已变 | 新文案已在 textBlock |
| `removeNodes` | 正常返回 | 已删除 | `stillThere: []` |

结论：**写操作超时是常态，不是异常**。三处里两处超时但都已生效。
把「超时」当成「失败」去重试，必然产生重复图元。

配套的正确流程：

```
try { await browser_evaluate(createExpr); }
catch (timeout) {
  if (await browser_evaluate(existsExpr(id))) {  // 探测
    // 已经建上了，继续下一步，别重试
  } else {
    // 确实没建上，这时才可以重试一次
  }
}
```

### 🔴 坐标会被静默夹取

ProcessOn 会把越界坐标悄悄夹进 `Utils.canvasViewBox`：**不报错、`rendered` 仍是 true、位置全错**。

`createNodeExpr` 的返回值现在带三个字段，用它自证：

```js
{ clamped: true, requested: {x: 5000, y: 5000}, actual: {x: 3910, y: 2575} }
```

`clamped: true` 就说明被夹过 —— **必须告诉用户"我要放 (5000,5000)，实际落在 (3910,2575)"**，
并人工确认位置，不要含糊说"放好了"。

### 让用户看见改动 —— 用 focusRect，不要 fitTheCanvas

```js
// lib/page.mjs 的 focusRectExpr(x, y, w, h)
POBridge.focusRect(x, y, w, h)
// → { requested: {...}, actual: {...}, before: {...}, viewBox: {...} }
```

只改 `scrollLeft/scrollTop`，不动缩放、不重绘、不超时。
`FIT_CANVAS` 只在用户**明确说"整页适应/缩放全部"**时才用。

**默认不要主动跳转。** 先给"改动清单 + 坐标 + 泳道"，
用户说"跳过去看看"再 `focusRect`。

---

## 五、泳道池行数控制（一等公民能力）

> **一句话规则：一个泳道池 = 一个 `horizontalPool` 元素；池里几行 = `children` 数组里挂了几个 `horizontalLane` 子元素。严禁用多个独立 `horizontalPool` 拼接出多行。**
>
> 之前用「多个独立 horizontalPool 组件」拼多行泳道是**错的**。那种结构下每个元素各自是池、
> 彼此没有父子关系，ProcessOn 不会把它们当成同一个泳道池；用户明确要求修正。

### 真实机制（线上示例图只读实测）

| 问题 | 实地结论 |
|---|---|
| 行数由什么决定？ | **`pool.children` 数组长度**。原图池 `example_pool_0` 的 `children` 有 20 个 lane id ⇒ 20 行 |
| 有没有 `rows` / `laneCount` / `lanes` / `rowCount` 专门字段？ | **没有**。全元素扫描一遍，这一类字段一个都不存在 |
| `props.height` 是什么？ | **左侧表头列宽**，不是行数、也不是行高。数组长度恒为 1，实测值 `[56]`（个别 AI 节点用 `[30]`）。`height[0]` 被 `path`（`{x:'height[0]',action:'line'}`）与 `textBlock[0].position.w='height[0]'` 引用。铁证：池 `props.x=87`，lane `props.x=143 = 87+56` |
| 行高由什么决定？ | 每个 `horizontalLane` 自己的 `props.h`。原图每行 200，池 `props.h=4000=20×200` |
| 表头文字怎么按行分布？ | **每一行 lane 自带 `textBlock[0].text`**（如「角色A（审批）」「角色B（复核）」），`position={w:'height[0]',x:0,h:'h-20',y:10}`；池自身的 `textBlock` 是**池标题**（如「示例业务流程池」） |
| lane 怎么挂到池上？ | `lane.parent = pool.id`；`pool.children = [laneId0, laneId1, ...]`；`lane.y` 自上而下按各行高堆叠（142, 342, 542, …） |

**一个真实元素的关键字段摘录**（原图池，只读采样）：

```json
{
  "id": "example_pool_0",
  "name": "horizontalPool",
  "category": "lane",
  "props": { "zindex": 1, "w": 2683, "x": 87, "y": 142, "h": 4000, "angle": 0, "height": [56] },
  "children": ["example_lane_0", "example_lane_1", "...共 20 个 lane id..."],
  "textBlock": [{ "position": { "w": "height[0]", "x": 0, "h": "h-20", "y": 10 },
                  "text": "示例业务流程池" }],
  "attribute": { "container": true, "rotatable": false, "visible": true, "linkable": false, "markerOffset": 5 }
}
```

**其中一行 lane**：

```json
{
  "id": "example_lane_0",
  "name": "horizontalLane",
  "parent": "example_pool_0",
  "props": { "zindex": -1, "w": 2627, "x": 143, "y": 142, "h": 200, "angle": 0, "height": [56] },
  "textBlock": [{ "position": { "w": "height[0]", "x": 0, "h": "h-20", "y": 10 }, "text": "角色A（审批）" }],
  "attribute": { "container": true, "rotatable": false, "visible": true, "linkable": false, "markerOffset": 5 }
}
```

> 注意 `x=143 = 池 x 87 + 表头宽 56`；`y=142` 与池相同（第一行），下一行 `y=342 = 142+200`。
> `props.height=[56]` 在池和每一行 lane 里都出现，且**永远是长度 1 的数组** —— 它只描述表头列宽。

### 新增 API（`POBridge` 一等公民）

| API | 签名 | 作用 | 写画布？ |
|---|---|---|---|
| `getPoolRows` | `getPoolRows(poolId) → {poolId,name,title,x,y,w,h,headerWidth,childrenLength,rowCount,rows:[...]} \| null` | 只读：按 y 升序列出池内各行（id/name/text/x/y/w/h/height/parent/isLane）。池不存在返回 `null`，目标不是池抛错 | **否**（验证首选） |
| `createPool` | `createPool(opts) → {id,laneIds,rowCount,x,y,w,h,totalHeight,headerWidth,clamped,rendered}` | 创建「1 个池 + N 行 lane」，单事务 `MessageSource.executeMessages`。默认红色、默认不夹取坐标 | 是 |
| `setPoolRows` | `setPoolRows(poolId, rows, opts?) → {poolId,rowCount,laneIds,added,updated,removed,kept,totalHeight,headerWidth}` | 把已有池改成 N 行：复用旧 lane（update）、删除多余（remove）、补齐新 lane（create），同步 `pool.children` / 池高 / 各行 y 与表头文字 | 是 |

`createPool(opts)` 参数：

```js
{
  id: 'ai_pool_<时间戳>',        // 强烈建议显式传入，便于超时探测 existsExpr / 回滚
  title: '优化后流程 · 泳道池',   // 池标题（写进 pool.textBlock[0].text）
  rows: [                        // 必填，长度 1..50
    { name: '需求方', height: 170 },
    { name: '审批方', height: 170 },
    { name: '执行方', height: 170 },
    { name: '复核方', height: 170 },
    { name: '数据平台/Agent 预警', height: 204 }
  ],                             // 也可简写成 ['角色A','角色B',...]，行高取 rowHeight
  x: 60, y: 4350, w: 4914,      // 池坐标/宽度；默认 100,100,2000
  rowHeight: 200,                // rows 用字符串简写时的默认行高
  headerWidth: 56,               // 左侧表头列宽 = props.height[0]，默认 56
  clamp: false,                  // 默认 false：不夹取，便于追加到原图下方；true 才夹进视口
  viewportRenderable: false,     // AI 元素默认 false，避免离屏被裁剪
  style: {                       // 默认红色，RGB 逗号串（禁 #hex）
    fill: '255,235,235', fillLane: '255,247,247', line: '255,0,0',
    font: '255,0,0', lineWidth: 2, fontSize: 13, bold: false
  }
}
```

`setPoolRows(poolId, rows, opts)` 参数：`rows` 同上（必填，1..50）；
`opts = {headerWidth, rowHeight, keepIds:true, style, title, viewportRenderable}`。
`keepIds:true`（默认）会复用前 `min(旧行数,新行数)` 个 lane 的 id，避免连线端点失效；
传 `false` 则全部重建 lane id。非 lane 的旧 `children` 原样保留，不会误删池里的普通图元。

**边界（越界直接抛错，绝不静默写坏画布）**：

- 行数 `1..50`；`rows` 为空 / 非数组 / >50 一律抛错。
- 行高 `20..10000`；`NaN` / `Infinity` / 负数 / 0 一律抛错。
- `setPoolRows` 的 `poolId` 不存在、或目标 `name` 不是 `horizontalPool` 一律抛错。
- 池高 `props.h` 恒等于 `Σ rows[i].height`；`lane.y` 自上而下按行高累加；`lane.props.height=[headerWidth]`。
- `getPoolRows` 是纯读，不触发 `executeMessages`。

### 可直接复制的代码示例

先用 `lib/page.mjs` 的片段拼表达式，再交给 `browser_evaluate`（参数一律 `JSON.stringify`，不要现场手写 JS）。

**① 只读验证现有池的行数（推荐第一步，零风险）**

```js
// 片段：getPoolRowsExpr(poolId)
// 例：把原图池 id 换进去，立刻看到 childrenLength / rowCount / 每行表头文字
var expr = getPoolRowsExpr('example_pool_0');
// browser_evaluate(expr) →
// {"poolId":"example_pool_0","name":"horizontalPool","title":"示例业务流程池",
//  "x":87,"y":142,"w":2683,"h":4000,"headerWidth":[56],
//  "childrenLength":20,"rowCount":20,
//  "rows":[{"id":"example_lane_0","name":"horizontalLane","text":"角色A（审批）",
//           "x":143,"y":142,"w":2627,"h":200,"height":[56],"parent":"example_pool_0","isLane":true}, ...]}
```

**② 原地创建一个 5 行泳道池（一个 pool，内部 5 行）**

```js
var poolOpts = {
  id: 'ai_pool_' + Date.now(),
  title: '优化后流程 · 泳道池',
  x: 60, y: 4350, w: 4914,
  headerWidth: 56,
  rows: [
    { name: '需求方', height: 170 },
    { name: '审批方', height: 170 },
    { name: '执行方', height: 170 },
    { name: '复核方', height: 170 },
    { name: '数据平台/Agent 预警', height: 204 }
  ],
  style: { fillLane: '255,247,247', line: '255,0,0', font: '255,0,0' }
};
var r = POBridge.createPool(poolOpts);
// r.rowCount === 5；r.totalHeight === 884；r.laneIds.length === 5
// 落盘结构：1 个 horizontalPool（children=[5 个 lane id]）+ 5 个 horizontalLane（parent=池 id）
// 严禁用 createNode({name:'horizontalPool'}) 连调 5 次来「拼」5 行 —— 那是 5 个池，不是 5 行。
```

**③ 把已有池改成 3 行 / 再改成 7 行（行数可控）**

```js
// 3 行：复用旧 lane id，多余的行被删除，池高自动重算
var a = POBridge.setPoolRows('ai_pool_<时间戳>', [
  { name: '需求方', height: 180 },
  { name: '审批/复核', height: 180 },
  { name: '数据平台', height: 200 }
]);
// a = {rowCount:3, added:0, updated:3, removed:2, kept:3, totalHeight:560, headerWidth:56}

// 7 行：前 3 行复用 + 新建 4 行
var b = POBridge.setPoolRows('ai_pool_<时间戳>',
  ['需求方','审批/复核','数据平台','复核单位','执行单位','物资','质检'],
  { rowHeight: 170, headerWidth: 56 });
// b.rowCount === 7；池 props.h === 7*170 = 1190
```

**④ 用片段走 browser_evaluate（DSH 侧标准姿势）**

```js
// 注入桥接层后（见第二节），用 lib/page.mjs：
//   import { injectExpr, getPoolRowsExpr, createPoolExpr, setPoolRowsExpr } from './lib/page.mjs'
// 1) 读
await browser_evaluate(getPoolRowsExpr('example_pool_0'));
// 2) 建（id 显式传入；写操作超时后先 existsExpr(id) 探测再决定是否重试 —— 见第四节防重复图元）
await browser_evaluate(createPoolExpr(poolOpts));
// 3) 改行数
await browser_evaluate(setPoolRowsExpr('ai_pool_<时间戳>', ['A','B','C'], { headerWidth: 56 }));
```

### 写后如何自查（只读，不写）

```js
var g = POBridge.getPoolRows('ai_pool_<时间戳>');
// 断言：g.rowCount === 期望行数
//       g.childrenLength === g.rowCount
//       g.rows.every(function(r){ return r.isLane && r.parent === g.poolId; })
//       g.h === g.rows.reduce(function(s,r){ return s + r.h; }, 0)
//       g.headerWidth[0] === 56（表头宽，不是行数）
// 再配合 readGraph() 看 nodes：应该只有 1 个 horizontalPool + N 个 horizontalLane，
// 而不是 N 个互不相关的 horizontalPool。
```

### 验证方法

**A. 离线（零风险，不需要浏览器 / 不碰任何画布）** —— 改完技能代码后必跑：

```bash
cd dsh/skill/dsh-processon-diagram-editor
node test/verify-pool.mjs      # 33 项：片段语法/转义 + 假运行时源码↔产物 parity + 真实字段不变量 + 边界守卫
node test/selftest.mjs         # 163 项：片段/转义/守卫/自包含/书签版本/池片段/侧栏卡/文字定宽/验收判定
node test/parity.mjs           # 源码与压缩产物行为一致（含泳道池断言）
node ../../../bridge/build.mjs --check   # 产物未漂移（在 bridge/ 下运行亦可）
```

**B. 在线只读（推荐，绝对不写用户画布）** —— 用本地桥 `POST 127.0.0.1:9777/api/command`
（`Authorization: Bearer dsh-local`），命令 `eval`、参数 `{tabId, expression}`。
只用 `getPoolRowsExpr(poolId)` / 只读 `Model.define.elements` 采样，**不注入写操作**：

```js
// 读原图池，确认 rowCount === children.length === 20，且每行 lane.parent === poolId
var expr = getPoolRowsExpr('example_pool_0');
// 再对照一个真实 horizontalLane 的 props.height / props.x 验证表头宽机制
```

> 本次能力的机制结论就是用 B 在真实 10 页画布上**只读**核对出来的，全程未写画布。

**C. 在线写入（只有确有必要才做）** —— 硬约束：**只能用一次性、可删除的测试页，且自行清理**；
绝不在用户正在编辑的 10 页画布上试写。

```js
// 1) 在测试页（或新建空白图）注入桥接层
// 2) createPoolExpr({id:'ai_pool_test_<时间戳>', rows:[...3 行...]})
// 3) getPoolRowsExpr('ai_pool_test_...') 核对 rowCount/childrenLength/池高/lane.parent
// 4) setPoolRowsExpr(..., 5 行) → 再 setPoolRowsExpr(..., 2 行) 核对增删
// 5) 清理：removePoolExpr('ai_pool_test_<时间戳>')  —— 只接受 ai_ 前缀，拒绝删原图池
// 6) 用 COUNT 片段确认元素数回到基线；未保存（不按 Ctrl+S）
```

`removePoolExpr` 内置守卫：`poolId` 不以 `ai_` 开头直接返回 `REFUSE_NON_AI`，
不会误删原图池（如 `example_pool_0`）。写操作 eval 超时按第四节规矩先 `existsExpr` 探测，别盲目重试。

### 维护（改这块代码的人看）

- 唯一源码：仓库 `bridge/pobridge.js`（单一源码 + 可复现构建，CI 有漂移检测）。
- `pobridge.min.js` / `scripts/bookmarklet.txt` / `scripts/install-bookmarklet.html` 是构建产物，**别手改**；
  改完源码在仓库根目录跑 `node bridge/build.mjs`，再跑 `node bridge/build.mjs --check`。
- 页面侧片段在 `lib/page.mjs`：`getPoolRowsExpr` / `createPoolExpr` / `setPoolRowsExpr` / `removePoolExpr`。
- 文档与实测字段以线上示例图只读采样为准。

---

## 五之二、连线：必须绑锚点，不能从中心点连

这是**最容易画丑的地方**，也是踩坑最深的。先看结论，再看为什么。

### 结论：连线 = 边中点之间连，angle 是「边」的编码

ProcessOn 里 hover 节点时出现的**蓝色小圆点**是 anchor（锚点），在四条边的中点上。
连线必须绑在锚点上；从节点中心点连，渲染出来就是**斜线**，非常丑。

**angle = 该边「朝外」的方向角**（逆时针，0=左 / 90°=上 / 180°=右 / 270°=下）。

| 边 | angle | 数值 |
|---|---|---|
| 左 L | `0` | 0 |
| 上 T | `Math.PI / 2` | 1.5708 |
| 右 R | `Math.PI` | 3.1416 |
| 下 B | `3 * Math.PI / 2` | 4.7124 |

**出边和入边用同一套值**：`from.angle = ANCHOR[出边]`、`to.angle = ANCHOR[入边]`。

> 🔴 **这张表错过两次，第二次是我自己"用统计推翻实测"造成的。**
>
> - **第一版**：`L=0 / R=π` —— 方向整体反了，产生斜线。
> - **第二版**：`L=π / R=0 / T=-π/2 / B=π/2` —— 号称"统计 155 个端点"得出。
>   这次统计的**对象错了**：数的是 `to.angle`（入边），却当成 `ANCHOR` 用。
> - **第三版（当前）**：`L=0 / T=π/2 / R=π / B=3π/2`。
>
> **怎么验证的**：造两个真实元素 id，扫 4 边 × 4 边 = 16 个组合，
> 全部满足「首段垂直出边 + 末段垂直入边 + 首段朝外」= **16/16**。
> 再用用户手绘的连线做真值：`from.angle=4.7124 (3π/2)`、`to.angle=3.1416 (π)`，
> 交给 `Utils.getLinkerPoints` 得到 `-91,1486`，**与手绘逐字节一致**。

#### 🔴 `-π/2` 和 `3π/2` 不是一回事

数学上等价，但产品的分支判据**看数值区间**，把它们当成两个不同方向。

实测同一个 B→R 场景：

| `from.angle` | `to.angle` | 折点数 | 结果 |
|---|---|---|---|
| `3π/2` | `π` | **1** | `-91,1486` ← 与用户手绘一致 |
| `-π/2` | `π` | 3 | `-231,1429 \| -231,1486` |
| `3π/2` | `0` | 3 | `-91,1440 \| -390,1440 \| -390,1486` |

**所以角度一律用「正数、从 0 数到 3π/2」的形式写，不要写 `-π/2`。**

#### 🔴 `Utils.getLinkerPoints` 必须传真实元素 id

`linker.from.id` / `linker.to.id` 必须是**画布上真实存在的元素 id**。

用假的（如 `__TA`）不会报错，但会**静默退化**：不管传什么 angle，
都返回同一对重复点，看上去"路由失效"。排查时极易误判成"算法没有这个能力"。

> 我在这上面浪费了很久：一度以为是产品路由算法本身的限制，
> 结论是"只能自己算 L 形"。实际是 id 传空导致的降级。

### 坐标必须落在边中点

```js
// 左边缘中点
{ x: p.x,            y: p.y + p.h / 2, angle: 0 }
// 上边缘中点
{ x: p.x + p.w / 2,  y: p.y,           angle: Math.PI / 2 }
// 右边缘中点
{ x: p.x + p.w,      y: p.y + p.h / 2, angle: Math.PI }
// 下边缘中点
{ x: p.x + p.w / 2,  y: p.y + p.h,     angle: 3 * Math.PI / 2 }
```

### points 是「拐角表」，不是端点表

```
端点 from / to  ->  由 anchor 决定
points          ->  中间的 90 度拐角
```

- 两端**同高**（水平直达）：`points = [{x: to.x, y: from.y}]` -> 1 个拐角
- 两端**同列**（垂直直达）：`points = [{x: from.x, y: to.y}]` -> 1 个拐角
- 需要**阶梯**绕行：2 个拐角，例如
  `[{x: 中间x, y: from.y}, {x: 中间x, y: to.y}]`

### 🔴 broken 连线的 points 与渲染路径是两回事（独立盲测发现）

2026-11-17 一次干净上下文盲测（对图4）发现：**对 `linkerType:"broken"`，
存储的 `points` 不等于渲染出来的路径**。

```js
// f4_b1 实例：存储 4 个固定折点
stored points : 1323,1440 | 1261,1440 | 1261,1716 | 999,1716    (fixed:true)
getLinkerPoints(e, false, false) -> 走上面这条间隙路径      ✓ 真实渲染
getLinkerPoints(e, false, true)  -> 1323,1578 | 999,1578      ✗ 直线穿 6 个节点
```

**第二个参数 `tFlag` 决定要不要尊重固定折点。** 传错就得到完全不同的路径，
我第一次独立复核就因为传了 `true` 而误报「穿节点=12」，实际是 0。

由此推出三条血泪规则：

1. **量穿节点必须用渲染器的真实口径**：
   `getLinkerPoints(element, false, false)`（或干脆传 `false,false`），
   不要拿存储的 `points` 自己拼线段 —— 那验的不是用户看到的东西。
   盲测中 `auditLayoutExpr` 报 7，真实渲染是 14，**系统性漏报一倍**。

2. **真正管用的绕行折点必须带 `fixed:true`。**
   `rerouteEdge` / `routeAround` / `autoRouteAround` 写的是不带 `fixed` 的 points，
   在这套数据结构上等于白写 —— 渲染器会重算覆盖掉。
   想让线走你指定的通道，只能写 `fixed:true` 折点（当前没有公开 API，需手工构造）。

3. **`badAnchor` 至今只校验坐标、不校验 angle**（五之十坑2 说"已修"是不准的）。
   盲测中图4 有 13/13 条连线锚点角度全错，`badAnchor` 仍报 0。
   必须自己核对 `from.angle === ANCHOR[出边]`、`to.angle === ANCHOR[入边]`。

> **一条更狠的盲测结论**：`rebindEdges` 一键重绑会把 13 条角度全修对，
> 但穿节点从 14 **涨到 18** —— 它只管锚点正确，不管全局布局。
> 别把它当"标准修复入口"直接对整个图调用，改完必须复量穿节点。

> **另一个反直觉点**：`reflowSpacing(target:60)` 挪完节点后，
> 原本 0 穿越的连线会反弹到 2（新撞上节点）。盲测里"先调间距后调连线"的推荐顺序
> 会破坏已修好的线；要么最后再复量一次，要么放弃消除 `tightGaps`。

### 连线验收：五条硬指标（缺一不可）

画完线**不要用眼睛判断"看起来还行"**。逐条量：

| 指标 | 怎么算 | 合格线 |
|---|---|---|
| 首段垂直于出边 | 出边水平 → `\|Δy\|<1`；垂直 → `\|Δx\|<1` | 必须 |
| 末段垂直于入边 | 同上 | 必须 |
| 首段朝外 | 与出边外法线点积 `>0` | 必须 |
| 末段朝内 | 与入边外法线点积 `<0` | 必须 |
| 无零长度段 | 相邻点不同时相等 | 必须 |

外加一条软指标：**折点数尽量 ≤1**（四个斜向场景都能做到 1 个）。

```js
// 量法：把 from/points/to 拼成点列，逐段取差
var pts = [{x:e.from.x,y:e.from.y}].concat(e.points).concat([{x:e.to.x,y:e.to.y}]);
var segs = [];
for (var i=0;i<pts.length-1;i++) segs.push([pts[i+1].x-pts[i].x, pts[i+1].y-pts[i].y]);
// 然后核对上表五项
```

### 用真实画布做 8 方位回归

改完路由算法，造 8 组节点（正右/正下/右下/右上/左下/左上/近右下/近左上），
逐条算几何并核对上表。当前实测：**8/8 全过，6 个斜向场景全部 1 折点**。

```
方位    出→入   折点  各段
正右    R→L    1    (95,0) (95,0)
正下    B→T    1    (0,115) (0,115)
右下    B→L    1    (0,265) (245,0)
右上    T→L    1    (0,-265) (245,0)
左下    B→R    1    (0,265) (-245,0)
左上    T→R    1    (0,-265) (-245,0)
近右下  B→L    1    (0,115) (345,0)
近左上  T→R    1    (0,-115) (-345,0)
```

### 改完必须触发重算，否则画布不更新

```js
Model.updateMulti([edge]);
Designer.events.push('resetBrokenLinker');   // <- 少了这句，线还是旧的
```

### 直接用一等公民 API，别手搓坐标

```js
// 建连线（自动选边 + 自动算拐角）
var e = POBridge.createEdge({
  id: 'ai_edge_1', from: 'ai_node_a', to: 'ai_node_b', text: '流转'
});
// -> { id, fromSide:'R', toSide:'L', points:1 }

// 把已有连线纠正到正确锚点（修复历史数据）
POBridge.rebindEdge('ai_edge_1');
POBridge.rebindEdges(POBridge.listEdges('ai_'));   // 批量，快得多

// 强制指定某对边
POBridge.createEdge({ from:'a', to:'b', fromSide:'B', toSide:'T' });
```

### 回滚线 / 跨行线：走外圈通道

目标在左侧且垂直跨度大（典型是「否/退回」回指起点）时，走内部**必然穿过节点**。
这类线一律走泳道组**下方**的外圈通道：

```js
// 自动算通道 y（泳道底部与注释块之间的空隙）并改道
POBridge.autoRouteAround(['ai_edge_back']);

// 或手动指定通道
POBridge.routeAround([{id:'ai_edge_back'}], { channelY: 5186 });
```

### 画完必须自查：有没有穿过节点

```js
var r = POBridge.detectCrossings('ai_');
// { crossings: 0, list: [] }   <- 必须是 0
```

非 0 就把这些线丢给 `autoRouteAround`，再测一次。

### 怎么判断线到底画对没有（别用边界框猜！）

**错误方法**：看连线 DOM 的 `width/height`。那是「折线 + 标签」的**合并包围盒**，
一条标准折线也会有 `112x98` 这种尺寸，看着像斜线其实是直角。

**正确方法**：读 canvas 像素剖面。

```js
var cv = document.getElementById(edgeId).querySelector('canvas');
var img = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
// 扫每一行：如果某行有连续长条填充 => 存在水平段（折线特征）
// 扫每一列：如果某列有连续长条填充 => 存在垂直段
```

看到「垂直段 + 水平段 + 垂直段」就是标准直角折线。

---

## 五之三、节点间距：决定连线标签会不会被吞掉

### 症状：连线看起来「断了」「被挤了」

真正的因果链是：

```
节点间距太小 -> 连线太短 -> 连线标签（38~47px 宽）盖住整条线 -> 看起来线没了
```

实测一组数据（第 0 页）：

| 连线 | 线长 | 标签宽 | 结果 |
|---|---|---|---|
| 材料匹配 | 20px | 38px | 标签比线长，线被完全吞掉 |
| 真实性核验 | 20px | 47px | 标签是线长 2.4 倍 |
| 取样留痕 | 300px | 38px | 正常，线清晰 |

### 结论：相邻节点「边到边」的间隙 >= 80px

标签最宽约 47px，两侧各留 16px 呼吸，所以：

```
最小间隙 = 47 + 16 x 2 ≈ 80px
```

**注意是「边到边」的间隙，不是节点中心距。** 中心距 = 节点宽 + 间隙。

### 标签位置改不动 —— 别浪费时间

我试过全部这些字段，ProcessOn **全部忽略**，标签位置由内部算法锁定：

`location` / `position` / `offsetX` / `offsetY` / `dx` / `dy` /
`labelPosition` / `align` / `vAlign` / `labelOffset`

所以「把标签移到线上方」这条路**走不通**，只能靠拉大间距解决。
（`location` 字段能写进去、模型也保留，但渲染位置不变 —— 写进去不等于生效。）

### 一条龙：polishLayout（首选入口）

上面两节的逻辑已经固化成 API。**给外部/子代理用这个，不要手搓坐标**：

```js
// 间距 + 连线 + 交叉，一次做完
POBridge.polishLayout('ai_', { target: 80, fallback: 60, maxRight: 2624 })
// -> {
//      spacing: { moved, gap, degraded, maxRight, limit, ... },
//      edgesRebound: 16,
//      crossingsBefore: 2, rerouted: 1,
//      crossingsAfter: 0
//    }
```

`maxRight` 传泳道池的右沿（`pool.x + pool.w`）。算法先试 80px，
撑完超出 `maxRight` 就**自动降级到 60px**。也可以传 `dryRun: true` 先预览。

**验收三件套（必须全是 0）**：

```js
POBridge.detectCrossings('ai_').crossings   // 0  不能穿过节点
// 锚点必须落在边中点（见下一节的自查代码）
// 最小间隙 >= 60
```

### 间距算法细节（改代码的人看）

```
1. 节点按 y 分组（同一行）
2. 行内按 x 排序，从左到右累计位移 —— 前一个动完，后一个才动
3. 只增加不减少，绝不往左拉（避免压到上一行的连线）
4. 完全不改 y —— 泳道归属不变
```

离线纯算法测试在 `test/selftest.mjs`，间距算法专项 7 项复刻 + 2 项行为，覆盖：补齐差值、已够不动、
逐级累加、跨行独立、只增不减、降级、单节点行。
（「文字定宽」算法另有 18 项，见下一节。）

### 节点宽度：创建时按 measureText 定宽，别拍脑袋给 175–195px

这一节有两个**方向相反**的结论，混起来用就会得出假结论。先把目的分清：

| 场景 | 目的 | 怎么量 | 允许的动作 |
|---|---|---|---|
| **创建期**（还没画上去） | 定「该给多宽」 | canvas `measureText` 精确量文字 | 按需要**定宽** |
| **渲染后**（已经画上去了） | 判断「有没有溢出」 | 真实 DOM 的 `scrollHeight vs clientHeight` | **不要改宽度** |

**渲染后不会溢出**：实测 17 个节点真实 DOM，**0 溢出** —— 文字会自动换行、高度自适应。
所以「看起来字要挤出来了」不是加宽的理由。

**但创建期必须自己算宽度。** 实测事故：一次落图 248 个图元、总宽 2540px，
用 canvas `measureText` 精确复测后发现 **90 个节点的矩形比文字实际需要的宽度多出 70–90px**，
纯收窄就能省下 2133px 横向空间。根因就是创建时凭感觉给了 175–195px 的宽矩形 —— 画出来一片空白。

反面教训（保留）：按「字数 x 字号」**估算**宽度是错的，会得出「15/36 溢出」的假结论。
**要精确，就用 canvas `measureText`；要判断渲染后溢出，就读真实 DOM。估算这条路两头都不通。**

### 默认值规范表（创建时就按这个给）

用 `measureTextFitExpr` 量出文字宽度后再定尺寸，不要凭感觉：

| 图元形态 | 推荐宽度 W | 下限 |
|---|---|---|
| 单行节点 | `measureText(该行) + 32` | 110 |
| 多行节点 | `measureText(最长那一行) + 32` | 110 |
| 泳道表头列宽 | `measureText(最长泳道名) + 32` | 140 |
| 说明卡（侧栏） | 固定 280（见「五之五」） | — |

> `+ 32` = 左右各 16px padding。高度按 `行数 x 13 x 1.25 + 24` 算
> （13px 字号、行高 125% 来自真实 DOM，24 是上下留白）。

### 两个一等公民 API

`lib/page.mjs` 里的函数，交给 `browser_evaluate` 执行（**不要现场手写 JS**）：

| 函数 | 作用 | 写画布？ |
|---|---|---|
| `measureTextFitExpr(ids, opts?)` | 只读：量出每个节点的 `{id, curW, needW, curH, needH, newW, newH, ...}` | **否** |
| `fitNodeSizeExpr(ids, opts?)` | 批量收紧到文字宽度，**只缩不放** | 是 |

`opts` 默认值：`{padding:16, minW:110, minH:0, font:'13px "Microsoft YaHei", 微软雅黑, Arial'}`。
`ids` 传 `null`/`undefined` 时按 `opts.prefix`（默认 `'ai_'`）扫全页；
`pool`/`lane`/`linker` 结构件默认跳过（`includeStructural:true` 可打开）。

```js
import { measureTextFitExpr, fitNodeSizeExpr } from './lib/page.mjs';

// ① 落图前定宽：先量，再按 newW 去 createNode
const m = JSON.parse(await browser_evaluate(measureTextFitExpr(['draft_node_a', 'draft_node_b'])));
// -> {mode:'measure', checked:2, changed:2, skipped:0, savedPx:170, ratio:0.29,
//     items:[{id:'draft_node_a', curW:195, needW:112, newW:112, curH:60, needH:41, ...}]}
// 按 items[i].newW 创建，别用 175~195 这种拍脑袋值

// ② 已经画歪了：批量收紧（只缩不放，不会压到邻接图元/连线）
const f = JSON.parse(await browser_evaluate(fitNodeSizeExpr(null, { prefix: 'ai_', minW: 110 })));
// -> {mode:'fit', checked:90, changed:90, savedPx:2133, executed:90, items:[...]}
```

**为什么「只缩不放」是硬规矩**：`newW = min(curW, max(minW, needW))` —— `min` 套在**最外层**。
即便 `minW=110` 而节点只有 100 宽，也**绝不会**被撑到 110。加宽会压到邻接图元和连线，
这条能力只负责收窄。**需要加宽请显式调 `updateNode`，不要指望这个 API 顺手帮你撑大。**

**改尺寸必须走 `MessageSource.executeMessages`**（`fitNodeSizeExpr` 内部已经是
`[{action:"update", content:{shapes:[c], updates:[c]}}], true`）——只改 `Model` 画布不重绘，
这是本技能的老结论（见「八个坑」第一行）。

### 落图后自检：savedPx 见真章

```js
const r = JSON.parse(await browser_evaluate(measureTextFitExpr(null, { prefix: 'ai_' })));
// r.savedPx = 若是「按文字定宽」应该省下的像素总量
// r.ratio   = savedPx / totalCurW
```

**判定：`ratio > 0.15` 说明创建时尺寸给大了** —— 横向空间有 15% 以上是纯空白，
应重排而不是收工。实测那次 248 图元的落图 `ratio` 是 `2133/2540 ≈ 0.84`，属于必须返工的级别。

> 注意：`measureTextFitExpr` 是**只读**的，跑它不会动画布，可以放心在验收阶段全量跑一遍。

---

## 五之四、切页与验收：两个会让结论失真的坑

这两条是并行跑 10 页时踩出来的，**不避开就会得出假失败或假通过**。

### 坑 1：切页后必须等加载稳定，不能立刻采样

ProcessOn 的页面是**懒加载**的。刚点完页标签，`Model.define.elements` 会从上一页的
残留逐步换成目标页 —— 中间有几百毫秒的**混合态**。

实测事故 ：p6 在元素数还是 313 时采样得到 `tightGaps=0`（假通过），
等加载完变成 370 个元素，复验发现真实 `tightGaps=4 / minGap=20`。

**正确做法：连读两次元素数，一致了才动手/才验收。**

```js
async function waitStable() {
  let prev = -1;
  for (let i = 0; i < 10; i++) {
    const n = Object.keys(Model.define.elements).length;
    if (n === prev) return n;          // 连续两次一致 = 稳定
    prev = n;
    await sleep(700);
  }
  throw new Error('页面加载未稳定');
}
```

切页本身也要 `mousedown + mouseup + click` 三连（真实点击），然后等约 2600ms 起步。

### 坑 2：验收必须做「页内作用域」，不能用全局 /^ai_/

`Model.define.elements` 只装当前页 —— 听起来全局过滤就够。但配合坑 1 的混合态，
全局统计会**把上一页的元素算进这一页**。

实测事故 ：p9 在过渡态报 `crossings=6`，稳定后实际是 **0**。
另一次相反：p6 混合态报通过，实际没过。

**正确做法：按 `_pN_` 子串做页内作用域。**

```js
// 错：跨页混合
if (!/^ai_/.test(id)) continue;

// 对：锁定第 N 页
if (id.indexOf('ai_') !== 0) continue;
if (id.indexOf('_p9_') < 0) continue;
```

技能里已经封装好，直接用：

```js
// 第二个参数是页索引，不传则全页统计（单页独占时才安全）
auditLayoutExpr('ai_', 9)
// -> { nodes, edges, lkSkipped, badAnchor, crossings, tightGaps, minGap, pass }
```

`lkSkipped` 是防漏算的：连线两端节点不在本页作用域时会被跳过，
**如果 lkSkipped > 0，说明 badAnchor=0 可能是漏算出来的假象**，要查。

### 并发抢同一标签页会互相破坏

多个 agent 同时操作同一个 ProcessOn 标签页时，切页动作会互相打断对方。
实测：两个 agent 都用 tab 794 时，页面选中项在无操作下自己从 6→5→3→2 跳变。

**规则：一个标签页只给一个 agent。** 多 agent 并行时各占一个标签页。

---

## 五之五、侧栏说明卡：在泳道图左侧放瘦长矩形

把长文本（优化说明、变更理由等）放在泳道图**左侧**，与泳道**等高**、**不遮挡任何内容**。

### 坐标下限是 -240，且 y 会被视口夹走

这是最容易踩的坑。`createNode` 会**静默夹取**坐标：

| 情况 | 结果 |
|---|---|
| `x: -400` | 被夹成 `-240` |
| 未滚动到目标 y 就创建 | `y: 6604` 被夹成 `y: -660` |

实测：p7 直接创建得到 `y=-660`（完全错位），p9 得到 `y=5501`（差了 967px）。

**正确顺序**：

```
① Designer.scrollShapesToView(目标区域的所有图元)   // 必须传对象，不能传 id
② 等约 2 秒让渲染落定
③ createNode(...)                                    // 此时 y 才不会被夹
④ 若返回值 clamped=true，用 updateNode 二次修正 y      // update 不走创建期夹取
```

**必须检查返回值**，不能假设放对了：

```js
var r = POBridge.createSideCard({
  id: 'ai_card_p0',
  poolId: 'ai_v2_tobev3_p0_pool_0',   // 用来等高对齐，必填
  text: '...',
  scope: 'ai_'                         // 滚动定位用的前缀
});
// -> { id, clampedAtCreate, repairedByUpdate, x, y, w, h,
//      alignedWithPool: true, gapToPool: 16 }
```

内部已经做了：右沿贴池左沿留 16px、左沿不越 -240、等高对齐、创建后二次修正 y、
文本顶部对齐（`h-20/y:10`，避免长文垂直居中显得上方大片空白）。

### 画完自查有没有遮住东西

```js
POBridge.auditSideCard('ai_card_p0')
// -> { overlaps: 0, pass: true }
```

`pass` 必须为 `true`。非 0 就说明卡片压到别的图元了，要么往左挪，要么缩窄。

### 尺寸经验值

| 项 | 值 | 说明 |
|---|---|---|
| 卡片宽 | 280px | 再宽就顶到 -240 下限 |
| 间距 | 16px | 卡片右沿到池左沿 |
| 高度 | = 池高（700/840） | 用户要的「等高」 |
| 文本容量 | 约 430 字 | 280×840 实测 0 溢出；13px 字体约 17 字/行 |

### 排版结构（430 字塞得下且清晰）

```
▍标题

【本页主线】
A → B → C → D

【为什么这样画】
...

【与原图区别】
原图：...
本图：...

【核心价值】
一句话
```

每段之间空一行，段落标题用 `【】` —— canvas 里没有 Markdown 渲染，
但换行和方括号是有效的视觉分隔。

---

## 五之六、验收清单 —— 画完必须逐项过

**这是数据层验收标准。** `auditLayoutExpr` 的六项全过才算合格；
任何一项不过就是没过，不要用「看起来还行」代替。

> 🔴 **但它只查数据，不查渲染。** 第 7 项 `auditEdgeRender(prefix).pass`
> 专门抓「数据对、画面错」（连线 DOM 盒滞后于数据）。完整验收 = 六项 + 这一项。

```js
auditLayoutExpr('ai_', 9)   // 第二个参数是页索引，必须有
```

| # | 字段 | 要求 | 不过意味着什么 |
|---|---|---|---|
| 1 | `badAnchor` | **= 0** | 有连线没绑在边中点，会渲染成斜线 |
| 2 | `crossings` | **= 0** | 有连线穿过别的节点，挡阅读 |
| 3 | `tightGaps` | **= 0** | 有横向间隙小于下限，标签会压住线 |
| 4 | `minGap` | **>= 60** | 最小间隙太小，视觉上「挤」 |
| 5 | `overlaps` | **= 0** | 两个节点压在一起了（`reflowSpacing` 只改 x，可能撞上邻行） |
| 6 | `lkSkipped` | **= 0** | 有连线因作用域不匹配被跳过，此时 `badAnchor=0` **不可信** |

返回值里还有 `pass` 字段，是这六项的合成判定。**看 `pass` 就够，但出问题时要看具体字段定位。**

> ⚠️ 这个 `pass` 只覆盖数据层。渲染层另见 `auditEdgeRender`。

> 上面六项管的是「排布对不对」。**尺寸给得对不对是另一件事**，用
> `measureTextFitExpr` 单独量（只读、不写画布）：`ratio > 0.15` 说明节点普遍偏宽，
> 详见「五之三 · 落图后自检」。六项全过 ≠ 尺寸合理 —— 一堆宽矩形也能六项全过。

### 阈值的由来（别凭感觉改）

这些数字集中在 `bridge/pobridge.js` 的 `LAYOUT` 常量里，改之前先读这段注释：

| 常量 | 值 | 推导 |
|---|---|---|
| `LABEL_MAX_W` | 47 | 连线标签实测最宽（「真实性核验」47px，「材料匹配」38px） |
| `LABEL_BREATH` | 16 | 标签两侧呼吸空间 |
| `GAP_TARGET` | 80 | = 47 + 16×2，取整 |
| `GAP_FLOOR` | 60 | 池宽不够时的降级下限；标签能完整放下且不贴边的最低值。**用户已确认 60 正确**，不要改成 65 之类的「留缓冲」值 |
| `CARD_GAP` | 16 | 说明卡右沿到池左沿 |
| `MIN_X` | -240 | 画布坐标下限，更小的 x 会被夹回 |

**为什么 60 不能随便调大**：p6 的池宽 2320 只能撑到 60。调到 65 会让 p6 永久不合格，
而那不是画错了、是泳道本身不够宽 —— 属于结构问题，不该让验收标准背这个锅。

### 用脚本验收（推荐）

```js
import { judge, formatRow, summarize } from './test/verify-layout.mjs';

// 每页：切页 → 等加载稳定 → 采样 → 判定
const rows = [];
for (const p of [0,1,2,3,4,5,6,7,8,9]) {
  await gotoPageAndWaitStable(p);
  const r = JSON.parse(await evaluate(auditLayoutExpr('ai_', p)));
  rows.push({ page: p, r });
  console.log(formatRow(p, r));
}
const s = summarize(rows);
console.log(s.passed + '/' + s.total + ' 通过');
```

`judge()` 的判定逻辑与 `auditLayoutExpr` **同源**（阈值都从 `LAYOUT` 取），
不会出现「脚本说过了但实际没过」的分歧。离线单测覆盖在 `test/selftest.mjs`。

### 采样前必须等页面稳定

**这条不遵守，验收结论就是假的。** 详见「五之四」的两个坑：切页是懒加载的，
立刻采样会读到上一页与这一页的混合态。

```js
// 页面指纹：当前 DOM 里只剩目标页的 ai_ 元素，才算切页完成
(function(){var E=Model.define.elements,seen={};
  for(var id in E){ if(id.indexOf('ai_')!==0) continue;
    var m=id.match(/_p(\d+)_/); if(m) seen[m[1]]=1; }
  return JSON.stringify(Object.keys(seen));})()
// 期望返回 ["9"] 这种单一元素数组
```

---

## 五之七、本地技能与仓库的同步

这套技能同时存在于两个地方，**必须分清谁是谁**：

| 位置 | 角色 |
|---|---|
| 仓库 `dsh/skill/dsh-processon-diagram-editor/` | **唯一真相**，GitHub 上看到的就是它 |
| `~/.dsh/skills/dsh-processon-diagram-editor/` | **产物**，实际被 DSH 加载的那份 |

**不要直接在 `~/.dsh/skills/` 里改东西** —— 改了不回流仓库，下次同步就被覆盖。
要改就先改仓库，再同步。

### 怎么同步

```bash
cd <仓库根>
node tools/sync-skill.mjs --dry    # 先看会改哪些，不落盘
node tools/sync-skill.mjs          # 执行（自动备份 + 更新版本号 + 同步后自检）
```

脚本会：比对差异 → 备份到 `<目标>.backup-<时间戳>` → 复制 → 写 `_meta.json` → 复验一致性。

### 版本号是「内容指纹」，不是手写编号

`_meta.json` 的 `version` 形如 `0.2.510473`，第三段是**内容哈希**派生的数字。

**为什么要这样**：历史上两边 `_meta.json` 都写着 `0.2.0`，但内容差了 4 天
（SKILL.md 24KB vs 40KB，测试 36 项 vs 163 项）。光看版本号根本发现不了不同。
现在内容一变、版本号就变，`diff` 一眼可见。

同步时会写入三个字段：

```json
{
  "version": "0.2.510473",   // 0.2.<内容哈希>
  "syncedAt": 1794454358619, // 同步时间戳（毫秒）
  "contentHash": "510473"
}
```

同一个内容同步两次，版本号不变；内容一变，版本号立刻不同。

### 两种布局下的测试差异（正常现象）

测试需要读 `bridge/pobridge.js`（源码）来做 parity 断言。这个文件**只存在于仓库布局**。
技能被单独安装到 `~/.dsh/skills/` 时没有源码，相关断言会**跳过而不是失败**：

| 布局 | selftest | verify-pool |
|---|---|---|
| 仓库（`dsh/skill/...`） | **163 项全过** | **33 项全过** |
| 独立安装（`~/.dsh/skills/...`） | **148 过 + 15 跳过** | 32 过 + 1 跳过 |

跳过的那 15 项都是「源码里有没有某个常量/导出」这类断言 —— 独立安装时无从校验，跳过是对的。
**看到 skip 不是坏了，但也不等于通过。**

> 注意：测试**刻意不读** `bridge-src/pobridge.js`。那是历史遗留的分叉副本
> （比仓库旧 23KB、缺 `createSideCard`/`detectOverlaps`），拿它做断言只会得到假失败。
> 现在已经从安装目录删除，只在备份里留档。

---

---

## 五之八、视觉设计规范 —— 让图好看的具体数字

> **本节所有数字都是在真机上量出来的，不是拍脑袋。** 量法见本节末尾「数据来源」。

### 1. 节点尺寸：132×62 是主力，别乱改

在 10 页混凝土泳道图上实测 16 个 AI 节点：

| 尺寸 | 数量 | 用途 |
|---|---|---|
| **132×62** | **13**（81%） | **常规流程节点**，默认就用这个 |
| 116×50 | 2 | 起止节点（椭圆） |
| 140×78 | 1 | 文字特别多的判断节点 |

**规则**：
- 默认 `w:132, h:62`
- **不要为了塞长文案而加宽节点** —— 文字会自动换行、节点高度会自适应（实测 0/17 溢出）
- 文字实在太多（>16 字）时，**拆成两个节点**，而不是把节点拉宽

### 2. 节点文案：8–12 字，中位数 11

实测 16 个节点的文案长度：**最短 8 字，最长 12 字，中位数 11 字**。

| 字数 | 判断 |
|---|---|
| ≤ 12 字 | ✅ 理想 |
| 13–16 字 | ⚠️ 可以，但节点会变高 |
| > 16 字 | ❌ **拆节点**，或把细节移到备注/侧栏卡片 |

**写法要求**：
- **动词开头**：写「提交申请」不写「申请提交」；写「校验完整性」不写「完整性校验」
- **一个节点一个动作**：不要「提交并校验并通知」
- **不要写标点**：节点里不出现句号、逗号

### 3. 分支摆放：是/否 左右别乱放

决策节点（菱形 `decision`）的两条出边有固定朝向约定：

| 分支 | 方向 | 锚点与 angle | 理由 |
|---|---|---|---|
| **主干/通过** | 向右 | R，`angle: Math.PI`（3.14） | 顺着阅读方向，主干不断 |
| **否/异常/驳回** | 向下 | B，`angle: 3 * Math.PI / 2`（4.71） | 一眼看出是旁路，不干扰主干 |
| 例外：回到上游 | 向上 | T，`angle: Math.PI / 2`（1.57） | 表示回退 |

> ⚠️ 这张表的 angle 值**错过两次**：
> 先写成 R=3.14 / B=4.71 / T=1.57（方向整体反了）；
> 后又改成 R=0 / B=π/2 / T=-π/2 / L=π（把 `to.angle` 误当 ANCHOR，且 T 用了 `-π/2`）。
> 2026-11-17 用真实元素 id 扫 4×4 边组合 + 用户手绘真值双重验证，
> **当前唯一正确值以「五之二」的表为准：L=0 / T=π/2 / R=π / B=3π/2**。
> 改任何 angle 之前先回五之二核对，不要相信这里的旧注释。

**反例**：把「否」也画成向右 → 主干两侧都有箭头，读者分不清哪个是主流程。

> 锚点约定详见「五之二、连线：必须绑锚点」。这里说的是**设计取舍**，那里说的是**技术实现**。

### 4. 视觉层级：主干粗、旁路轻

| 层级 | 特征 | 具体做法 |
|---|---|---|
| **主干** | 一直向右、不拐弯 | 正常样式，不加色 |
| **异常/驳回** | 有回退、有折返 | 连线可加虚线或浅色 |
| **辅助/说明** | 侧栏卡片、备注 | 浅底、小字 |
| **AI 改动点** | 本次修改的部分 | 红框红字（见「六、红色标记」） |

**关键**：**改动标记只标改动，不要整页都红**。整页红 = 什么都没有强调。

### 5. 泳道：行高 140，别压缩

实测 p9 泳道池：

| 参数 | 实测值 |
|---|---|
| 池宽 | 2568 |
| 池高 | 840 |
| **单行泳道高** | **140** |
| 行数 | 6（840 ÷ 140） |

**规则**：
- 单行 **140px** 是能放下 132×62 节点 + 上下留白的最小值
- 行数 = 池高 ÷ 140，`getPoolRows` 算的就是这个
- **不要为了省高度把行高压到 100** —— 节点会贴边，视觉上很挤

### 6. 间距：80 是目标，60 是底线

实测同排 12 个间隙：`[80,80,80,80,80,172,172,172,324,628,636,2156]`

| 值 | 含义 |
|---|---|
| **80** | 理想值，出现最多的值 |
| 172/324/628/2156 | 跨段留白，正常 |
| **< 60** | ❌ 标签会被吞掉，必须 `reflowSpacing` |

底层常量在 `POBridge.LAYOUT`：

```js
POBridge.LAYOUT.GAP_TARGET   // 80 理想
POBridge.LAYOUT.GAP_FLOOR    // 60 底线（标签 47px + 两侧 6.5px）
POBridge.LAYOUT.LABEL_MAX_W  // 47 实测最宽标签
```

### 7. 配色：三色足够

**不要给每个节点配不同颜色。** 配色传达的是**语义**，不是装饰。

| 语义 | 颜色（RGB 逗号串） | 用途 |
|---|---|---|
| **改动标记** | fill `255,235,235` / line `255,0,0` / font `255,0,0` | AI 本次修改 |
| **正式态** | line `33,41,48`（深灰），无填充 | 确认后转正 |
| **辅助/说明** | 浅灰底，无强调 | 侧栏卡片 |

> ⚠️ 颜色必须写 **RGB 逗号串**，写 `#ff0000` 不生效（见「八个坑」）。

### 数据来源（可复现）

以上数字来自 p9「9混凝土原材料管理」真机采集：

```js
// 节点尺寸分布
const g = POBridge.readGraph('ai_v2_tobev3_p9_');
const ai = g.nodes.filter(n => n.id.startsWith('ai_v2_tobev3_p9_') && !n.isLane && n.w < 1000);
// → 16 个节点：132x62 占 13 个

// 同排间隙
// → [80,80,80,80,80,172,172,172,324,628,636,2156]，min = 80

// 文案长度
// → [8,8,8,8,10,10,11,11,11,11,11,11,12,12,12,12]，median = 11
```

**换一张图时，这些数可能不同。** 但 132×62 / 140 / 80 / 60 是有普适性的起点 —— 先按这套画，再按实际量到的值微调。

---

## 五之九、布局预算：先算再画，别画到一半发现放不下

**最常见的返工原因**：画到第 8 个节点发现右边没地方了，只能整体往左挪 —— 已经画好的连线全要重绑。

### 画之前先算三个数

```
① 这一行有几个节点？          N
② 每个节点多宽？              默认 132
③ 节点间距多少？              默认 80
─────────────────────────────────────
所需宽度 = N × 132 + (N-1) × 80
```

**举例**（实测 p9 的最长行有 9 个节点）：

```
9 × 132 + 8 × 80 = 1188 + 640 = 1828
池宽 2568 - 左右内边距 112 = 2456
1828 ≤ 2456  ✅ 放得下
```

### 速查表（132 宽 + 80 间距）

| 节点数 | 所需宽度 | 能否放进 2568 宽的池 |
|---|---|---|
| 3 | 556 | ✅ |
| 5 | 980 | ✅ |
| 7 | 1404 | ✅ |
| **9** | **1828** | ✅（p9 实际配置） |
| 11 | 2252 | ✅ 勉强 |
| **12** | **2464** | ⚠️ **超出内边距，会碰到池边** |
| 15 | 3100 | ❌ 必须拆行 |

**超过 11 个节点就必须拆成两行**，不要硬挤。

### 降级策略：放不下的时候按顺序试

```
1. 间距 80 → 60        省下 (N-1) × 20
   例：12 个节点省 220px

2. 仍然放不下？拆行
   把流程按语义断开（如"申请阶段 / 审批阶段"）分两行

3. 还不能拆？减字号 / 缩节点
   ⚠️ 最后手段，视觉质量会明显下降
```

> 代码里 `reflowSpacing(prefix, {target, fallback})` 已经实现了 1 和 2 的自动降级，`LAYOUT.GAP_TARGET=80` → `LAYOUT.GAP_FLOOR=60`。

### 纵向预算

| 项 | 值 |
|---|---|
| 单行泳道高 | 140 |
| 行间是否有间隙 | 无（相邻） |
| **N 行池高** | **N × 140** |
| 池高上限（实测） | 840 = 6 行 |

**超过 6 行**：要么加高池（`setPoolRows` 会重算），要么拆页。

### 起笔坐标：别从 0 开始

```
x 起点 = 池 left + 112   （实测 p9：池 x=56，首节点 x=168）
y 起点 = 池 top + 行索引 × 140 + 39   （垂直居中：(140-62)/2 = 39）
```

**不要从 x=0 起笔画** —— `createNode` 会把 x < -240 的值夹回来，导致所有节点堆在一起（见「八个坑」）。

### 动手前的 30 秒自查

- [ ] 这行最多几个节点？→ 对照速查表
- [ ] 总共几行？× 140 = 池高
- [ ] 池宽够吗？不够就先想好降级方案
- [ ] 起笔坐标算好了吗？（不是 0）

**四个都过了再调 `createNode`。**

---

## 五之十、连线穿节点 —— 比「线穿线」严重得多

**现象**：连线从节点内部穿过去，视觉上流程被切断。

### 为什么会发生

长距离回边（如「报废分支」从最右节点回到最左节点）如果只取 1 个折点，
连线必然横穿中间所有节点。实测 AE 系统现状：`f5_bk` 跨 1616px，**穿过 5 个节点**。

### 三个新 API

```js
// 1) 查推荐通道：返回 channelY（穿越数最少的水平线）
POBridge.suggestChannel('f5_bk')
// → { edge:'f5_bk', channelY:2005, blockHits:0, kind:'above', blockers:85 }

// 2) 应用单条（端点保持锚点位置，只让折点走通道）
POBridge.rerouteEdge('f5_bk', 2005)

// 3) 批量：自动处理穿越数超阈值的连线
POBridge.rerouteWorstEdges({ max: 10, minCross: 2 })
// → { applied:[...], skipped:[{edge, reason}], scanned:20 }
```

### 🔴 两条安全铁律（都是踩过坑才写下的）

**铁律 1：端点必须留在节点边缘中点。**

`rerouteEdge` **不能动 `from`/`to` 的坐标**，只改 `points`。
实测：把端点 y 强制改成通道 y 后，`badAnchor` 从 **0 飙到 20**，锚点全部脱离边缘。

```js
// ❌ 错：端点跟着通道走
upd.from.y = channelY; upd.to.y = channelY;

// ✅ 对：端点不动，折点走通道
upd.points = [{ x: e.from.x, y: channelY }, { x: e.to.x, y: channelY }];
```

**铁律 2：水平通道干净 ≠ 能绕。**

从端点到通道的**竖直段**也可能穿节点。实测 `f4_b1`：
from.y=1727 要走到通道 1439，途中穿过 n3/n4/n5 三个节点。

`rerouteWorstEdges` 已内置 `verticalSegBlocked` 校验，穿节点的会**跳过并说明原因**：

```js
// → skipped: [{ edge:'f4_b1', reason:'竖直段穿过 f4_n3,f4_n4,f4_n5' }]
```

**看到 skip 不要硬来** —— 这说明该处必须动节点布局，不是调连线能解决的。

### 实测效果

在 AE 系统现状（80 条连线）上：

| 阶段 | 穿越数 | badAnchor |
|---|---|---|
| 初始 | **76** | 0 |
| 第一轮绕行 | 70 → 46 | 0 |
| 第二轮 | 14 | 0 |
| 第三轮 | **0** ⚠️ | **20** ❌ |
| 修正端点后重做 | **7** | **0** ✅ |

⚠️ 第三轮那个 0 是**假的** —— 靠牺牲锚点换来的。修正后诚实地停在 7，
剩下 4 条因为竖直段必穿节点而主动跳过。**7 是真的，0 是假的。**


### 🔴 三个"下一轮还会踩"的坑（独立核验发现）

这三个是黑盒核验时查出来的，不是自己发现的。记在这防止复发。

#### 坑 1：斜线段完全不被检测（已修）

旧版 `segHitsRect` / `hitSeg` 只在 `|Δy|<0.5` 或 `|Δx|<0.5` 时判定，**斜线直接 return false**。

后果：AE 现状图 11 条斜边里 5 条穿节点，全部漏报。审计报 7，像素真值 ≥10。

修法：加 Liang-Barsky 线段裁剪，斜线也走完整判定。
修完 auditLayoutExpr 和 detectCrossings **都从 7 变成 12**。

#### 坑 2：angle 语义错了两次，且无任何检查覆盖（已修）

`badAnchor` **只校验坐标、从不校验 angle**，所以这类错误对审计完全隐形。

| 版本 | 值 | 怎么错的 |
|---|---|---|
| 初版 | `L=0 / R=π` | 方向整体反了 |
| 二版 | `L=π / R=0 / T=-π/2 / B=π/2` | **统计错了对象**：数 `to.angle` 却当成 `ANCHOR` |
| 现版 | `L=0 / T=π/2 / R=π / B=3π/2` | 16 个 side 组合实测 + 手绘真值验证 |

修法：ANCHOR 常量按实测校正；文档表和代码示例同步改正；
selftest 加产物侧断言（查 `pobridge.min.js` 而非只查源码）。

> **教训**：坐标对了不代表线对了。angle 决定"从哪个方向出线"，
> 它错了画出来就是斜的，而坐标系校验看不出这个。
>
> **更狠的教训**：拿统计数据推翻实测结论时要先确认**统计的是什么**。
> 我数了 155 个 `to.angle`，就以为得到了 `ANCHOR`，方向恰好相反，
> 而且因为"有数据支撑"显得特别可信。**数字多不等于对。**

#### 坑 3：pass 不校验 edges>0（已修）

旧 `pass` 只看各项计数为 0，**不看有没有真的检查到东西**。
前缀写错（`auditLayoutExpr('zzz_')`）会返回 `pass:true`。

修法：加 `emptyScope = (edgeCount === 0)` 守卫，输出增加 `emptyScope` 和 `reason`：

```js
// 现在错误前缀会明确拒绝：
{ edges: 0, emptyScope: true, pass: false,
  reason: "前缀/页号没有匹配到任何连线，结论不可信" }
```

> **这正是它自己复盘过的那个坑换了入口。** 同类问题要从"结论是否可信"这一层根治，
> 而不是只在文档里提醒"先看 edges 数"。

#### 坑 4：出边障碍检测的两个假阳性（已修）

障碍检测本来只做一件事：**出边正对着上游节点时改走另一条边**。
但它误判了两次，每次都凭空多出 1 个折点。

**(a) 泳道被当成障碍**

图3 的泳道矩形 `(-500,1440,504×92)` 把节点整个包住。出边射线从节点边中点出发，
落点仍在泳道内部 → 判定"被挡" → 出边从 `B` 改成 `L`，绕过整个泳道。

```js
// ❌ 旧：泳道、分组、容器全进障碍表
out.push({ x:p.x, y:p.y, w:p.w, h:p.h, id:id });

// ✅ 新：这些一律不算障碍
if (/lane|pool|group|swimlane/i.test(String(id))) return;
if (e.category && /lane|pool|group/i.test(String(e.category))) return;
```

**(b) 射线没有长度上界**

`sideBlockedBy` 的射线原本无限长。`n4→n5` 只有 22px 间距，
B 出边穿过 **n5 本身**后打到后面的 n6，于是被判"被挡"。

```js
// ✅ 射线只看到"目标的正交距离"为止，更远的障碍已在目标另一侧
var ortho = (side === 'L' || side === 'R')
  ? Math.abs(bcx - ap.x) : Math.abs(bcy - ap.y);
sideBlockedBy(a, side, obstacle, pad, ortho);
```

> **别加余量**。我先写成 `ortho + max(w,h)`，结果 n5 后面的 n6 又进来了。
> 上界就只能取正交距离本身。

修完 `n4→n5`、`n5→n6` 都从 3 折点降到 2 折点。

#### 坑 5：`computeEdgeGeometry` 的 id 字段名对不上（已修）

`createEdge` 传的是 `{from, to}`，而 `computeEdgeGeometry` 读的是 `o.fromId / o.toId`
—— 两个字段名不同，导致 id 恒为 `null`。

后果见 §五之二：`getLinkerPoints` 拿不到真实 id 就退化成"返回两个重复点"，
于是**产品路由能力看起来像是不存在**。

```js
// ✅ 两种写法都接受
var fromId = o.fromId || o.from || null;
var toId   = o.toId   || o.to   || null;
```

> 这类 bug 的可怕之处：**不报错、不崩溃**，只是静默降级成兜底路径。
> 排查时所有中间值看起来都合理，只有最终图形看着"不对劲"。

#### 坑 6：同轴正对时产品返回重复点（已修）

两个节点水平或垂直正对时，`getLinkerPoints` 会返回两个**完全相同**的点
（如 `(5205,6035)` 与 `(5205,6035)`），画出来多一个空折点。

修法：在 `tryProductRoute` 出口处做相邻重复点去重。

```js
var clean = [];
for (var k = 0; k < got.length; k++) {
  var prev = clean[clean.length - 1];
  if (prev && Math.abs(prev.x-got[k].x) < 0.01 && Math.abs(prev.y-got[k].y) < 0.01) continue;
  clean.push({ x: got[k].x, y: got[k].y });
}
return clean.length ? clean : got;
```

#### 一个试过但失败的思路（别再试）

那 5 条斜边看着像"路径没拐直角"，直觉是补折点就行。试了：
按锚点法线方向各伸出 24px，中间插正交拐点。

**结果穿越数从 12 涨到 33** —— 新路径撞上了更多节点。

原因：这 5 条边的两端锚点分别在不同行和列，**几何上就不存在既正交又不穿节点的窄通道**。
正确解法是**动节点布局**，不是调连线参数。已回滚。

**判断标准**：如果一个端点在上边（T）、另一个在左边（L），且两者横纵坐标都差很远，
那就别指望调 points 能解决——先看 `suggestChannel` 的 `blockHits`，
再决定是不是该求人改布局。

### 关于 `auditLayoutExpr` 的一个坑（已修）

旧版用 `id.indexOf('_lk_')` 判断是否是连线 —— 只认 AI 自己创建的连线。
**手工画的图（连线 id 叫 `f4_b1`）会被全部静默跳过**，审计报 `edges:0, crossings:0` 假通过。

已改为按 `e.name` 判定：

```js
// ❌ 旧：漏掉所有手工连线
if (id.indexOf('_lk_') < 0) continue;
// ✅ 新：认所有真实连线
if (!/linker/i.test((E[id].name||''))) continue;
```

**教训**：审计报 0 时，先确认 `edges` 数对不对，再相信 `crossings`。

---

## 五之十一、测试体系：两个命令，缺一不可

```bash
node test/selftest.mjs    # 功能对不对
node test/mutation.mjs    # 测试本身还有没有用
```

**为什么需要第二个**：`selftest.mjs` 里有很多断言是查源码字符串的
（`assert.match(表达式, /emptyScope/)`）。这类断言对「变量名还在但逻辑改了」天然免疫。

实测把斜线检测前插 `return false`、把间距阈值归零、把锚点校验改成恒真——
原来的测试全绿。

`mutation.mjs` 的做法：把 bug 故意塞回去，看 `selftest` 会不会红。
**没红就说明那条断言是假的。**

### 三条铁律（都是被核验打脸后加的）

1. **必须先做正向对照** —— 未变异时 selftest 必须通过。
   否则把一个永远失败的 selftest 换进去，也能拿满分。
2. **SKIP 算失败** —— 变异点定位不到，说明这道防线已经失效
   （典型原因：源码改了，硬编码的特征串失配）。
3. **按语义定位** —— 不硬编码压缩后的变量名，重新构建就不失配。

当前 **20/20 全抓到、0 失效、0 漏检**，正向对照通过。

> 🔴 **第 N 次失效的教训（2026-11-17）**：改 ANCHOR 后重跑，
> 20 条里 **9 条同时失效**。原因全是变异点的正则硬编码了压缩前的字面量
> （如 `M.props.x` 实际压缩成 `S.props.x`、`e.length` 变成 `t.length`、
> `var ANCHOR={L:Math.PI,...}` 整套值都换了）。
>
> **铁律第 3 条"按语义定位"要更进一步**：不只是"别硬编码变量名"，
> 而是**别硬编码任何会被正常重构改动的东西**——包括常量的值本身。
> 定位锚点常量的正确写法是匹配它的**结构形状**，然后按需替换。

### 验收判定的六个判据

`auditLayoutExpr` 的 `pass` 依赖六项（渲染层第 7 项在 `auditEdgeRender`），**每一项都要能独立否决**：

| 判据 | 含义 | 行为断言 |
|---|---|---|
| `badAnchor` | 端点是否在边中点上 | ✅ |
| `crossings` | 连线是否穿节点 | ✅（含反向用例） |
| `tightGaps` / `minGap` | 间距是否过紧 | ✅ |
| `overlaps` | 节点是否重叠 | ✅ |
| `lkSkipped` | 是否有连线因缺端点被跳过 | ✅ |
| `emptyScope` | 前缀是否根本没匹配到东西 | ✅ |

**外加一条正向对照**：一张完全合规的图必须返回 `pass: true`。
没有这条，"永远拒绝验收"的审计也能通过所有测试。

> 🔴 **这条是踩坑换来的。** 曾经 6 条断言全是 `assert.equal(r.pass, false)`，
> 变异证明把 `pass` 改成恒 `false` 也能全绿。
> 一个永远拒绝验收的审计，和一个永远通过的审计，一样没用。


### 已补的行为断言（第五轮核验要求）

`reflowSpacing` 和 `clampIntoView` 之前是自证或零覆盖，现已补上：

| 函数 | 断言要点 |
|---|---|
| `reflowSpacing` | dryRun 不写画布 / 非 dryRun 时**节点真实 x 必须变大** |
| `clampIntoView` | 越界必须夹取并标记 `clamped` / 视口内不动 / 视口过小时居中兜底 |

> 🔴 **踩过的坑**：`reflowSpacing` 的 `movedIds` 和 `maxRight` 都是**改坐标之前算出来的计划值**。
> 变异证明：把 x 的赋值改成不减位移后，`movedIds` 仍含 n2、`gap` 仍报 80、`maxRight` 仍是 444 ——
> **只有核对 `updateMulti` 里节点真实的 `props.x` 才能识破。**


### 🔴 零行为覆盖的导出（诚实清单）

`POBridge` 有 **30** 个导出。第八轮核验实测：**selftest 真的调了 9 个**，其余只有字符串或漂移探针。

| 状态 | 数量 | 函数 |
|---|---|---|
| ✅ selftest 真调（vm 沙箱执行） | **9** | `ANCHOR` `LAYOUT` `auditSideCard` `clampIntoView` `computeEdgeGeometry` `detectCrossings` `reflowSpacing` `rerouteEdge` `rerouteWorstEdges` |
| ⚠️ 只有 `parity.mjs` 漂移探针 | 10 | `createNode` `readGraph` `updateNode` `createEdge` `removeNodes` `createPool` `setPoolRows` `getPoolRows` `focusRect` `getViewBox` |
| ❌ 零行为覆盖 | 11 | `RED` `autoRouteAround` `createSideCard` `detectOverlaps` `listEdges` `polishLayout` `rebindEdge` `rebindEdges` `resetBrokenLinkers` `routeAround` `suggestChannel` |

合计 **9 + 10 + 11 = 30**，账对得上。

> 🔴 **这张表被核验抓住过两次同类错误**：先是 `computeEdgeGeometry` 同时躺在 ✅ 和 ❌ 两栏，
> 修完又轮到 `auditSideCard`；而且合计数 `8+10+12=30` 与 `9+10+11=30` **碰巧都是 30**，
> 只看合计发现不了，必须逐项比对名字。
> **教训：文档账没有自动校验，必须像查代码一样逐项核对，不能只看总数。**

**必须说清楚**：`parity.mjs` 是「两个产物是否一致」的**漂移检测器**，不是正确性检测器。
两个产物同步变坏时它完全无感。**不能当正确性覆盖来宣传。**

**为什么这些可以先不补**：`suggestChannel`/`routeAround`/`polishLayout` 是「推荐/批量优化」型
辅助 API，真机未触发，且本文档明确要求人工复核其建议。但`suggestChannel` 改坏了不会有人知道，
这一点必须承认。

### 关于 `auditDesignExpr` 的夹具

它读文案用的是 `e.textBlock[0].text`，**不是 `e.text`**。
第一版夹具写成 `e.text`，导致 `tooLong` 恒 0，一度误判成代码有问题。

## 六、红色标记

```js
fillStyle: { drawType: 'fill', fill: '255,235,235', alpha: 1 }   // 浅红填充
lineStyle: { lineWidth: 2, lineColor: '255,0,0', lineStyle: 'solid' }
fontStyle: { fontColor: '255,0,0' }
```

颜色必须是 **RGB 逗号串**，写 `#ff0000` **不生效**。

确认满意后转正式配色：
```js
POBridge.updateNode(id, { fill: '', line: '33,41,48', font: '' });
```

---

## 七、收尾

- 列出改了哪几处（红色框即改动点）
- **提醒未保存**，需要用户自己按 Ctrl+S（DSH 版不自动保存，这是故意的安全设计）
- 不满意用 `removeNodes` 撤回
- 如果用户正和同事协同编辑，提醒改动会实时广播

### 关于「是否真的存进去了」

DSH 版**不提供落库校验**（WorkBuddy 版有 `pocli verify`，因为它能另起干净浏览器）。
这里只能：用户按 Ctrl+S 后，让用户刷新页面或看另一台设备确认。
**不要声称「已保存」** —— 你无法验证。

---

## 八个坑

| 坑 | 现象 | 解法 |
|---|---|---|
| 直接用 `Model.addMulti()` | 数据变了画布不动 | 必须走 `MessageSource.executeMessages(..., true)` |
| 用多个独立 `horizontalPool` 拼多行 | 得到 N 个互不相干的池，不是 N 行泳道池 | 用 `createPool` / `setPoolRows`，行数由 `pool.children` 决定 |
| 坐标在视口外 | **静默删除，不报错** | 用 `createNode` 省略坐标；检查返回的 `clamped` |
| 颜色写 `#ff0000` | 不生效 | 必须 RGB 逗号串 `'255,0,0'` |
| 字段不全 | 渲染器跳过 | 必须带 `children: []` 和完整 `attribute` |
| 滚动后坐标错位 | 新节点偏移 | `viewBox.x === layout.scrollLeft - 1200` |
| **eval 超时后盲目重试** | 多出一个重复图元 | 先 `existsExpr(id)` 探测，确认不存在才重试 |
| **片段里写 `\\d`** | 被模板字符串吞成 `d`，正则静默失效 | 用 `[0-9]` 代替；`selftest` 有断言守着 |

---

## 安全边界

1. **绝不自动保存** —— 改动留在内存，用户自己决定
2. **批量删除前二次确认** —— 传错 id 会删掉真图元；空数组会被桥接层拒绝
3. **多人协同时提醒** —— 改动会实时广播给同事
4. **只改用户点名的部分** —— 不碰没提到的图元
5. **多图时必须确认** —— 见第一节
6. **报告里不要外泄 URL 票据** —— `encrypted_session` 等同于编辑权限，转述时打码

---

## 失效处理

ProcessOn 闭源，内部 API 可能随发版变化。若注入后 `readGraph()` 报错或返回空：

1. 检查页面是否在编辑态（非预览/只读）
2. 检查 `window.Model`、`window.MessageSource` 是否存在
3. 把报错原文告诉用户，**不要假装成功**
4. 建议用户改用 WorkBuddy 方案（`wb-processon-diagram-editor`），那边接口面更宽

### 从零新建整张图怎么办

本技能**只做增量改图**。要从自然语言生成一整张新图，用 `processon-diagram-generator`
（ProcessOn 官方能力，由技能市场提供，不在 `~/.dsh/skills` 扫描根下）。

---

## 维护（改代码的人看）

桥接层源码**只有一份**，在仓库根目录的 `bridge/pobridge.js`。
技能目录里的 `pobridge.min.js` / `scripts/bookmarklet.txt` / `scripts/install-bookmarklet.html`
都是**构建产物**，别手改。

**为什么要用同步脚本**：这套技能同时存在于两个地方 —— 仓库（来源）和
`~/.dsh/skills/dsh-processon-diagram-editor`（实际加载的）。历史上两边各自改过，
源码出现分叉（技能目录曾自带一份 `bridge-src/pobridge.js`，与仓库版本差 23KB）。
现在规定：**仓库是唯一真相，技能目录是产物**。

```bash
# 在仓库根目录
node bridge/build.mjs              # 重建产物（需 esbuild，见 bridge/package.json）
node bridge/build.mjs --check      # 校验产物与源码一致（不一致退出码 1）

# 同步到已安装技能（会自动备份、保留 bridge-src、校验测试数）
node tools/sync-skill.mjs          # 默认目标 ~/.dsh/skills/dsh-processon-diagram-editor
node tools/sync-skill.mjs --dry    # 只看会改哪些文件，不落盘
node tools/sync-skill.mjs --target <path>   # 自定义目标

node test/selftest.mjs             # 163 项离线断言
node test/verify-pool.mjs          # 33 项泳道池行数能力
node test/parity.mjs               # 两个产物行为一致
```
