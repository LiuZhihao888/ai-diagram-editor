---
name: dsh-processon-diagram-editor
description: "在用户已打开的 ProcessOn 画布上做 AI 增量改图。读取现有泳道图/流程图结构（节点、连线、泳道、文字），直接在原画布上创建/修改/删除图元，改动红色高亮，多人协同实时可见。支持同时打开多张 ProcessOn 图时精确定位目标图。触发词：改这张流程图、在ProcessOn加一步、补充泳道图环节、AI改图、流程图增删改、把这段流程画进现有图。不用于从零新建整张图（那用 processon-diagram-generator）。"
---

# ProcessOn 画布编辑器（DSH 版）

在用户正在看的 ProcessOn 画布上直接读写，改动实时渲染、红色标记、同事可见。

**这套是给 DeepSeek Harness 用的**。它依赖 DSH 浏览器扩展提供的 `browser_*` 工具；
用 WorkBuddy 的同事请装 `wb-processon-diagram-editor`，那套自带 Chromium，机制不同但改图能力一致。

> 页面侧 JS 片段全部集中在本技能目录的 `lib/page.mjs`。**不要现场手写 JS** —— 用那里的函数，参数走 `JSON.stringify`。
> 离线自检：`node test/selftest.mjs`（36 项，不需要浏览器，本技能自带）。

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

## 五、红色标记

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

## 六、收尾

- 列出改了哪几处（红色框即改动点）
- **提醒未保存**，需要用户自己按 Ctrl+S（DSH 版不自动保存，这是故意的安全设计）
- 不满意用 `removeNodes` 撤回
- 如果用户正和同事协同编辑，提醒改动会实时广播

### 关于「是否真的存进去了」

DSH 版**不提供落库校验**（WorkBuddy 版有 `pocli verify`，因为它能另起干净浏览器）。
这里只能：用户按 Ctrl+S 后，让用户刷新页面或看另一台设备确认。
**不要声称「已保存」** —— 你无法验证。

---

## 七个坑

| 坑 | 现象 | 解法 |
|---|---|---|
| 直接用 `Model.addMulti()` | 数据变了画布不动 | 必须走 `MessageSource.executeMessages(..., true)` |
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
node test/selftest.mjs          # 36 项离线断言（片段/转义/守卫/自包含/书签版本）
node test/parity.mjs            # 两个产物行为是否一致（压缩后仍等价）
```
