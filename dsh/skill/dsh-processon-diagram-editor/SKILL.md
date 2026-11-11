---
name: dsh-processon-diagram-editor
description: "在用户已打开的 ProcessOn 画布上做 AI 增量改图。读取现有泳道图/流程图结构（节点、连线、泳道、文字），直接在原画布上创建/修改/删除图元，改动红色高亮，多人协同实时可见。支持同时打开多张 ProcessOn 图时精确定位目标图。触发词：改这张流程图、在ProcessOn加一步、补充泳道图环节、AI改图、流程图增删改、把这段流程画进现有图。不用于从零新建整张图（那用 processon-diagram-generator）。"
---

# ProcessOn 画布编辑器（DSH 版）

在用户正在看的 ProcessOn 画布上直接读写，改动实时渲染、红色标记、同事可见。

**这套是给 DeepSeek Harness 用的**。它依赖 DSH 浏览器扩展提供的 `browser_*` 工具；
用 WorkBuddy 的同事请装 `wb-processon-diagram-editor`，那套自带 Chromium，机制不同但改图能力一致。

### 已实测能力

- 读取现有泳道图 / 流程图结构（节点、连线、泳道、文字）
- 创建 / 修改 / 删除节点与连线，改动红色高亮
- 泳道池行数控制：`getPoolRows` / `createPool` / `setPoolRows` / `removePoolExpr`（见第五节）
- 多标签场景精确定位目标图、视口跳转不打扰用户

> 页面侧 JS 片段全部集中在本技能目录的 `lib/page.mjs`。**不要现场手写 JS** —— 用那里的函数，参数走 `JSON.stringify`。
> 离线自检：`node test/selftest.mjs`（46 项）+ `node test/parity.mjs` + `node test/verify-pool.mjs`（33 项）—— 都不需要浏览器、不碰画布，本技能自带。

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
node test/selftest.mjs         # 46 项：原有自检 + 新增池片段/导出/书签断言
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

**angle 不是「出线方向」，而是「锚点所在边」的编码**（这条我一开始搞反了）：

| 边 | angle | 数值 |
|---|---|---|
| 左 L | `0` | 0 |
| 上 T | `Math.PI / 2` | 1.57 |
| 右 R | `Math.PI` | 3.14 |
| 下 B | `3 * Math.PI / 2` | 4.71 |

> 铁证：线上原图 **75 条 linker** 反向统计，规律 100% 一致 ——
> `R:3.14` x42 / `T:1.57` x24 / `B:4.71` x26 / `L:0` x32。
> **把右写成 0 会画成斜线**，这是唯一但致命的坑。

### 坐标必须落在边中点

```js
// 右边缘中点（不是中心点！）
{ x: p.x + p.w,      y: p.y + p.h / 2, angle: Math.PI }
// 上边缘中点
{ x: p.x + p.w / 2,  y: p.y,           angle: Math.PI / 2 }
// 下边缘中点
{ x: p.x + p.w / 2,  y: p.y + p.h,     angle: 3 * Math.PI / 2 }
// 左边缘中点
{ x: p.x,            y: p.y + p.h / 2, angle: 0 }
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

### 文字会不会挤出框？不会，别改节点宽度

**实测**：17 个节点真实 DOM 渲染，**0 溢出**。文字会自动换行且高度自适应。

反面教训：按「字数 x 字号」估算宽度来判断溢出是**错的**，会得出「15/36 溢出」的假结论，
然后去加宽节点 —— 白改。**要测就读真实 DOM 的 `scrollHeight vs clientHeight`。**

---

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

桥接层源码只有一份：仓库 `bridge/pobridge.js`。
技能里的 `pobridge.min.js` 是**构建产物**，别手改。

```bash
node bridge/build.mjs           # 重新构建所有产物
node bridge/build.mjs --check   # 校验产物是否与源码一致（不一致退出码 1）
node test/selftest.mjs          # 46 项离线断言（片段/转义/守卫/自包含/书签版本/池片段）
node test/parity.mjs            # 两个产物行为是否一致（压缩后仍等价）
node test/verify-pool.mjs       # 33 项：泳道池行数能力离线验证
```
