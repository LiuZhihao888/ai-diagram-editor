# ProcessOn 可写性 —— 实测突破报告

> 2026-11-04 实测。**推翻前一版结论**：ProcessOn 不仅能读，还能写，而且能实时渲染。

## 一、结论

| 能力 | 结果 | 验证方式 |
|---|---|---|
| 读取完整语义图 | ✅ | `Model.define.elements` → 52 节点 + 61 连线 |
| 创建节点并立即渲染 | ✅ | `MessageSource.executeMessages` → `rendered: true`，界面出现红色节点 |
| 修改节点 | ✅ | `action: 'update'` 事务 |
| 删除节点 | ✅ | `action: 'remove'` 事务 |
| 创建连线 | ✅ | linker 结构 + `from/to.id` |
| 红色标记 | ✅ | RGB 逗号串格式，界面实测可见 |

**这意味着：不需要 Excalidraw，可以直接在 ProcessOn 上做 AI 增量改图。**

## 二、四个关键坑（每个都花了实测才定位）

### 坑 1：`Model.addMulti()` 只改数据，不重绘

```js
// ❌ 这样写：模型变了，画布没反应
Model.addMulti([node], true);
```

原因：`addMulti` 只做数据层写入，不调用渲染。

**正确路径**：
```js
// ✅ 走 MessageSource 事务，init=true 触发 Schema.initShapeFunctions
MessageSource.executeMessages([{ action: 'create', content: [node] }], true);
```

`executeMessages` 内部做了两件关键事：
```js
Schema.initShapeFunctions(shape);   // 补齐渲染所需的内部函数
Designer.painter.renderShape(shape); // 真正画到 canvas 上
```

### 坑 2：元素必须在视口内，否则被静默删除

`Designer.painter.renderShape` 第一行：
```js
if (!Utils.isInCanvasView(e)) return $('#'+e.id).remove(), void ...;
```

不在视口内 → **直接 remove 并返回**，不报错、不留痕迹。这是最难发现的坑。

关联关系（实测）：
```
Utils.canvasViewBox.x === document.getElementById('designer_layout').scrollLeft - 1200
```

### 坑 3：颜色是 RGB 逗号串，不是 #hex

```js
// ❌ 无效
fillStyle: { drawType: 'fill', fill: '#ff0000', alpha: 1 }

// ✅ 有效
fillStyle: { drawType: 'fill', fill: '255,0,0', alpha: 1 }
lineStyle: { lineWidth: 2, lineColor: '255,0,0', lineStyle: 'solid' }
fontStyle: { fontColor: '255,0,0' }
```

依据：`Schema.shapeDefaults` 里 `lineColor: "33,41,48"`。

### 坑 4：节点结构字段不全会被跳过

必须带：`children: []`、完整的 `attribute` 对象、`path`、`anchors`、`textBlock`。
缺任何一个，渲染器可能静默跳过。

## 三、可用的最小实现

见 `src/pobridge.js`，提供 `POBridge.readGraph / createNode / updateNode / removeNodes / createEdge`。

实测输出：
```json
{"read":{"nodes":52,"edges":61,"page":[4027,3862]},
 "created":{"id":"ai_node_...","rendered":true},
 "afterCreate":{"nodes":53,"found":true}}
```

## 四、与 Excalidraw 方案对比（修正后）

| 维度 | ProcessOn 运行时注入 | Excalidraw 自建 |
|---|---|---|
| AI 读图 | ✅ 完整 | ✅ 完整 |
| AI 写图 | ✅ 可创建/改/删，实时渲染 | ✅ 完全自由 |
| 多人实时协同 | ✅ 原生（已有） | ⚠️ 需自托管 excalidraw-room |
| 改动可见性 | ✅ 红色标记实测有效 | ✅ 完全可控 |
| 稳定性风险 | ⚠️ 依赖内部 API，发版可能变 | ✅ 公开 API |
| 数据归属 | 留在 ProcessOn | 自己掌控 |
| 部署成本 | 零（浏览器内） | 需服务器 |

## 五、风险声明（必须说）

1. **这是非官方接口**。ProcessOn 没有任何文档承诺 `Model` / `MessageSource` / `Designer` 这些全局对象稳定。
2. **发版即可能失效**。一次前端更新就可能让整套桥接失效。
3. **不存在静默破坏**：实测所有操作都可撤销（`MessageSource.undo`），且未保存改动可通过刷新丢弃。
4. **多人协同下要小心**：AI 写入会通过 `MessageSource.send` 广播给协作者，这既是优点（同事实时看到）也是风险（误操作影响他人）。

## 六、对用户文档的处置

全部测试节点已用 `removeNodes` 清理，文档恢复至 113 图形 / 579 字，与初始状态完全一致。
