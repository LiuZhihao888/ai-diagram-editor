# ProcessOn 编辑器 JS API 能力测绘

> 测绘对象：`https://wps.processon.com/diagrams/edit`（tabId 1649082488，文档`AE系统现状`，file_id 585463292233）
> 测绘方式：`browser_evaluate`只读探测 + `Function.prototype.toString`源码取证 + 隔离 DOM 渲染试验（渲染后立即删除，不落盘、不入 undo、不发消息）
> 画布基线（测绘前后完全一致）：`elements=39`/`.shape_box=18`/`maxZIndex=952`/`mess=0`

---

## 0. 全局对象清单

全部挂在`window`上，是**对象字面量**（不是 class 实例）。

| 对象 | 类型 | Key 数 | 备注 |
|---|---|---|---|
| `Utils` | object | 220 | 几何/选择/样式/颜色工具 |
| `Model` | object | 47 | 数据层 CRUD + persistence |
| `Designer` | object | 91 | 编辑器操作层 |
| `MessageSource` | object | 19 | 消息/撤销栈/协同发送 |
| `Schema` | object | 31 | 形状模板注册表 |
| `Dock` | object | 20 | 右侧属性面板 |
| `editorGlobal` | object | 9 | 仅`poPagination`等少量内容 |
| `Templates` | **undefined** | — | ❌ 不存在 |
| `Theme` | **undefined** | — | ❌ 不存在 |

**实测证据**

```json
{"Utils":{"type":"object","keys":[...220项...]},
 "Model":{"type":"object","keys":["define","persistence","orderList","orderListGroup",
   "visibleShapeIds","maxZIndex","linkerMap","intersection","groupMap","wallIntersection",
   "create","createByShape","createLinker","add","addMulti","update","updateMulti","remove",
   "updatePage","getCurrentPage","getOldPage","storeOldPage","clearOldPage","onlyUpdatePage",
   "setTheme","setAiContainers","getCurrentTheme","updateWithBeautify","setDefaultStyle",
   "clearDefaultStyle","getShapeById","getPersistenceById","getLinkers","build",
   "buildOrderListGroup","buildVisibleShapeIds","getOrderListGroup","getShapeLinkers",
   "getGroupShapes","changeShape","clearShapeStyle","comments","commentsList"]},
 "MessageSource":{"type":"object","keys":["batchSize","messages","withUndo","withMessage","withDock",
   "undoStack","redoStack","beginBatch","commit","submit","send","receive","undo","redo",
   "executeMessages","doWithoutUndo","doWithoutMessage","doWithoutUpdateDock"]},
 "Templates":{"type":"undefined"},"Theme":{"type":"undefined"}}
```

---

## A. 图元创建

### A1. `Model.create(shapeName, x, y)` ✅ **可用**

**签名**：`Model.create(name: string, x: number, y: number) => Shape`（`.length === 3`）

从`Schema.shapes[name]`深拷贝模板，注入新 id、坐标、zindex、默认样式，**并`Designer.events.push("create", shape)`**。
关键：它**只造对象，不落库**（不写`Model.define.elements`）。

**可运行示例**

```js
const s = Model.create('process', 200, 200);
s.textBlock[0].text = '审批';
// 此时 Model.define.elements[s.id] 仍然 undefined
```

**实测返回值证据**

```json
{"typeof_path":"object","typeof_getPath":"function","typeof_getTextBlock":"function",
 "create_keys":["id","name","title","category","group","groupName","locked","link","children",
   "parent","resizeDir","attribute","dataAttributes","props","shapeStyle","lineStyle",
   "fillStyle","theme","path","fontStyle","textBlock","anchors","getPath","getAnchors","getTextBlock"],
 "created_Id_is_in_define": false,
 "shapeStyle_of_created": {"alpha": 1},
 "props_default": {"x":0,"y":0,"w":100,"h":70,"zindex":0,"angle":0}}
```

> `created_Id_is_in_define: false` —— 直接证据：create 不写库。

---

### A2. `Model.createByShape(shapeTemplate, x, y)` ✅ **可用**

**签名**：`Model.createByShape(template: Shape, x: number, y: number) => Shape`（len 3）

与`create`的差异（源码对比）：
1. 入参是**形状对象**而非 name，内部`Utils.copy(e)`；
2. `Model.maxZIndex`**自增**（`Model.maxZIndex = Model.maxZIndex + 1`），而`create`只读`maxZIndex + 1`不自增；
3. 额外处理`SeparatorBar`的`zindex = 0`；
4. **不触发**`Designer.events.push("create")`。

**实测证据（zindex 不对称）**

```json
{"maxZ_before":952,"after_create_maxZ":952,
 "after_createByShape_maxZ":953,"a_zindex":953,"b_zindex":953}
```

> 连续 create 两次会拿到**相同 zindex**（都 = 952+1），叠放顺序不稳定。

---

### A3. `Model.createLinker(fromShape, toPoint)` ✅ **可用**

**签名**：`Model.createLinker(from: Shape, to: {x,y}) => Linker`（len 2）

`to.id`固定为`null`（即`游离端`）。`lineStyle`取`Designer.defaults.lineWidth`（实测 1.5）。

**实测源码**

```js
function(e,t){var n=Utils.newId(),i=Utils.copy(Schema.linkerDefaults);
 i.from=e; i.to={id:null,x:t.x,y:t.y,angle:null};
 i.props={zindex:Model.maxZIndex+1}; delete i.fontStyle;
 var r={}; r.lineWidth=Designer.defaults.lineWidth; ...
 i.lineStyle=r; i.id=n;
 _designer2.umlSequence.updateLinkerAngle(i,"to"); ... }
```

---

### A4. `Model.add`/`Model.addMulti`vs`MessageSource.executeMessages` ✅ **可用**

**签名**

```js
Model.add(shape, withUndo = true, msgArg, build = true)
// 实测源码：function(e,t,n,i){ this.addMulti([e],t,n,i) }   ← 纯转发

Model.addMulti(shapes[], withUndo = true, msgArg, build = true)
// 落 define.elements + persistence.elements + 拷贝 + this.build()
// + Designer.events.push('created', ...) + MessageSource.send('create', ...)
// + Designer.events.push('aiContainerShapesChange', ...)

MessageSource.executeMessages(messages[], initWithShapeFunctions?)
```

**两者差别（源码实证）**

| 维度 | `Model.addMulti` | `MessageSource.executeMessages` |
|---|---|---|
| beginBatch/commit | 否 | **是** |
| 渲染 | 否 | **是**（`Designer.painter.renderShape`） |
| `Schema.initShapeFunctions` | 否 | 是（当第二参为真） |
| `Model.build()` | 是 | 是（且额外 push`changeLinkers`） |
| 支持 action | 仅`create` | `create / update / remove / updatePage / setTheme / setDefaultStyle / clearDefaultStyle / update_with_beautify / addComment / pluginShape / setAiContainers` |
| 事务/撤销 | 单次 | **一次执行 = 一个撤销单元** |

**结论**：`MessageSource.executeMessages`是**官方正确路径**（原子、可撤销、自动渲染、进协同通道）。
`Model.addMulti`是内部原语，用完必须自己`renderShape`。

**可运行示例（推荐路径）**

```js
const a = Model.create('start',   100, 100);
const b = Model.create('process', 100, 220);
a.textBlock[0].text = '开始';
b.textBlock[0].text = '处理';
MessageSource.executeMessages([{ action: 'create', content: [a, b] }], true);
```

---

### A5. 形状模板枚举 ✅ **可用**

`Object.keys(Schema.shapes).length === 79`，`Schema.categories`是**数组**（4 项，不是字典）。

**4 个 category**：`standard`/`basic`/`flow`/`lane`

**完整 name → category 映射（实测全量）**

| category | shape names |
|---|---|
| `standard`(4) | standardText, standardImage, standardRectangle, pluginImage |
| `basic`(36) | text, note, linker_shape_solid, linker_shape_solid_normal, start, image, round, rectangle, roundRectangle, triangle, rightTriangle, diamond, polygon, hexagon, octagon, pentagon, sector, cloud, sector2, teardrop, comment, apqc, cross, corner, backArrow, rightBackArrow, singleLeftArrow, singleRightArrow, doubleHorizontalArrow, singleUpArrow, singleDownArrow, doubleVerticalArrow, parentheses, braces, basic_container, code |
| `flow`(29) | process, decision, terminator, document, data, predefinedProcess, storedData, internalStorage, sequentialData, directData, horizontalDirectData, manualInput, card, paperTape, display, manualOperation, preparation, parallelMode, loopLimit, onPageReference, maybe, summation, offPageReference, arrange, merge, rightAnnotation, leftAnnotation, rightBraceFlow, leftBraceFlow |
| `lane`(10) | verticalPool, verticalPool1, verticalLane, verticalSeparatorBar, horizontalSeparator, horizontalSeparatorBar, verticalSeparator, horizontalPool, horizontalPool1, horizontalLane |

**`Schema.categories`实测原文**

```json
[{"name":"standard","text":"Standard","dataAttributes":[]},
 {"name":"basic","text":"基础图形","dataAttributes":[{"name":"序号","type":"number",...}]},
 {"name":"flow","text":"Flowchart 流程图","content":{...},"dataAttributes":[12项,含"成本","时间","部门","风险"...]},
 {"name":"lane","text":"泳池/泳道","content":{...}}]
```

**`Schema.flowBasicConfig`**（工具箱基础图形顺序，实测 26 项）：
`text, note, linker_shape_solid, linker_shape_solid_normal, start, image, round, rectangle, roundRectangle, triangle, rightTriangle, diamond, polygon, hexagon, octagon, pentagon, sector, cloud, sector2, teardrop, comment, apqc, standardText, standardImage, standardRectangle, code`

**`Schema.pageDefaults`实测**

```json
{"backgroundColor":"transparent","width":1050,"height":1000,"padding":20,
 "showGrid":true,"gridSize":15,"orientation":"portrait","lineJumps":false,"planeConfig":{}}
```

---

### A6. 最小可渲染节点字段集 ✅ **已实测**

**结论**：一个节点要能被`Designer.painter.renderShape`画出，**必须**有：

| 字段 | 必需 | 缺失报错原文 |
|---|---|---|
| `props`(x/y/w/h) | ✅ 必需 | — |
| `shapeStyle` | ✅ **必需** | `Cannot read properties of undefined (reading 'alpha')` |
| `textBlock`（含`position`） | ✅ **必需** | `Cannot read properties of undefined (reading 'length')` |
| `path`+`getPath` | ✅ **必需** | `t.getPath is not a function` |
| `getTextBlock` | ✅ **必需** | `e.getTextBlock is not a function` |

**可以安全删除**（逐个删除后仍渲染出 29376 个非透明像素，与完整对象一致）：
`attribute`、`anchors`、`fillStyle`、`lineStyle`、`fontStyle`、`dataAttributes`、`resizeDir`、`theme`、`children`、`parent`、`locked`、`link`、`group`、`title`、`groupName`

**实测证据（逐字段剔除）**

```json
{"drop_attribute":     {"ok":true,"px":29376},
 "drop_shapeStyle":    {"ok":false,"err":"Cannot read properties of undefined (reading 'alpha')"},
 "drop_textBlock":     {"ok":false,"err":"Cannot read properties of undefined (reading 'length')"},
 "drop_path":          {"ok":true,"px":29376},
 "drop_anchors":       {"ok":true,"px":29376},
 "drop_fillStyle":     {"ok":true,"px":29376},
 "drop_lineStyle":     {"ok":true,"px":29376},
 "drop_fontStyle":     {"ok":true,"px":29376},
 "drop_dataAttributes":{"ok":true,"px":29376},
 "drop_resizeDir":     {"ok":true,"px":29376},
 "drop_theme":         {"ok":true,"px":29376},
 "drop_children":      {"ok":true,"px":29376},
 "drop_parent":        {"ok":true,"px":29376},
 "drop_locked":        {"ok":true,"px":29376},
 "drop_link":          {"ok":true,"px":29376},
 "drop_group":         {"ok":true,"px":29376},
 "drop_title":         {"ok":true,"px":29376},
 "drop_groupName":     {"ok":true,"px":29376},
 "drop_none":          {"ok":true,"px":29376}}
```

**最小对象（手写）实测通过**

```js
const tpl = Schema.shapes.process;
const s = {
  id: Utils.newId(),
  name: 'process',
  category: 'flow',
  props: { x: 30, y: 30, w: 120, h: 60, zindex: 1, angle: 0 },
  shapeStyle: { alpha: 1 },
  textBlock: [{ position: { x:10, y:0, w:'w-20', h:'h' }, text: 'MIN' }],
  path: tpl.path,
  getPath: tpl.getPath,
  getTextBlock: tpl.getTextBlock,
  getAnchors: tpl.getAnchors
};
Model.define.elements[s.id] = Utils.copy(s);
Designer.painter.renderShape(s);   // → ok, 30256 个非透明像素
```

```json
{"M1_add_getPath": {"ok":false,"err":"e.getTextBlock is not a function"},
 "M2_add_path_getPath_getTextBlock": {"ok":true,"nz":30256}}
```

> **强烈建议**：别手写，用`Model.create(name,x,y)`，它一次把`path/getPath/getAnchors/getTextBlock`四个函数都补齐。

---

## B. 泳道 / 池

### B1. `horizontalPool`/`horizontalLane`结构差异 ✅ **可用**

| 维度 | `horizontalPool` | `horizontalLane` |
|---|---|---|
| `category` | `lane` | `lane` |
| `attribute.container` | **`true`** | **`true`** |
| `attribute.visible` | `false`（模板）/`true`（实例被改） | `true` |
| `props.w/h` | 640 × 200 | 600 × 200 |
| `props.height` | `[40]`（标题栏宽） | `[30]` |
| `children` | `[]`（**放 lane 的 id**） | `[]` |
| `onCreated` | **无** | **有（关键钩子）** |

**实例关系（真画布）**

```json
pool: { id:"ai_pool_f4", name:"horizontalPool", parent:"",
        children:["ai_pool_f4_lane_0","..._1","..._2","..._3","..._4"],
        props:{x:774, y:1348, w:709, h:460, angle:0, height:[140]} }
lane: { id:"ai_pool_f4_lane_4", name:"horizontalLane", parent:"ai_pool_f4",
        children:[], props:{x:914, y:1716, w:569, h:92, zindex:-1, height:[92]} }
```

**池内 lane 排布实测**

```json
[{"id":"..._lane_0","y":1348,"h":92},{"id":"..._lane_1","y":1440,"h":92},
 {"id":"..._lane_2","y":1532,"h":92},{"id":"..._lane_3","y":1624,"h":92},
 {"id":"..._lane_4","y":1716,"h":92}]
```

> 规律：`lane.x = pool.x + pool.height[0]`= 774 + 140 = **914**；`lane.w = pool.w - pool.height[0]`= 709 − 140 = **569**；lane 纵向 **y 依次累加 h**（步长 92）；`pool.height[0]`是标题栏宽度（横向池的左侧竖条）。

---

### B2. 怎么创建泳道（`onCreated`才是归属机制）⚠️ **有条件**

**关键发现**：`Schema.shapes.horizontalLane.onCreated`是**唯一**把 lane 挂进 pool 的正规入口。它做四件事：
1. `getPool(this,"horizontalPool")`找不到池 → **自动`Model.create`一个池并`Model.add`**；
2. 计算`this.props.x/w/y/h`（相对池的几何，**不是相对坐标**）；
3. `e.children.push(this.id)`+`this.parent = e.id`；
4. `Schema.initShapeFunctions(this)`+`Designer.painter.renderShape(this)`。

**实测源码（尾段）**

```js
"...e.children.push(this.id), t||Model.updateMulti(l),
  Designer.painter.renderShape(e), this.parent=e.id"
```

**正确调用方式（源码抄录自`Designer.setLaneNum`内部）**

```js
const pool = Model.getShapeById(selectedPoolId);
const lane = Model.create('horizontalLane', 0, 0);
lane.props.height[0] = 30;      // 标题栏宽
lane.onCreated(pool, false);    // false = 不是最后一条
Model.define.elements[lane.id] = lane;   // ← setLaneNum 自己先塞进去
Model.addMulti([lane]);                  // 再走批量落库
```

> ⚠️ 上面这段是**源码抄录**，我**没有实际执行**（会改画布）。**标注：未验证**。
> ❌ `Model.create('horizontalLane', x, y)`单独用是不行的 —— 不调`onCreated`就没有`parent`、不进`pool.children`、尺寸也是模板默认值。

---

### B3. 节点怎么**归属**到泳道 ⚠️ **几何决定，不是字段决定**

**实测结论：泳道归属完全由坐标包含关系决定，没有任何`把节点加进泳道`的字段。**

**证据 1**：真画布 24 个元素有`container`字段，值**全部是空字符串`""`**：

```json
"containerProp":[
 {"name":"process","id":"lb_ai_pool_f4_1","container":""},
 {"name":"process","id":"f4_n12","container":""},
 {"name":"horizontalPool","id":"ai_pool_f4","container":""}, ...],
"hasContainerProp": 24,
"nodesWithContainerSet": []
```

**证据 2**：`Utils.getPoolByPosition(x,y)`纯按几何命中：

```js
Utils.getPoolByPosition = function(e,t){
  for (var n=Model.orderList.length-1; n>=0; n--) {
    var r = Model.getShapeById(Model.orderList[n].id);
    if (r.name.includes("Pool") && this.pointInRect(e,t,r.props)) return r;
  }
  return null;
}
```

实测：`Utils.getPoolByPosition(proc.x+5, proc.y+5)`→`{"id":"ai_pool_f4","name":"horizontalPool"}`✅

**证据 3**：`Utils.getContainedShapes([pool])`返回 **0**，因为它判的是`o.container == e.id`，而容器字段全是空串：

```json
{"containedCount": 0, "containedByName": {}}
```

> ⚠️`container`字段是**拖拽进容器时才写入**的显式归属；AI 生成的图里没写，所以靠的是**坐标落在泳道矩形内**。

**实操建议**：把节点`props.x/y`放到目标 lane 的矩形里即可（用`lane.props.x/y/w/h`计算）。✅ 这就是真画布`lb_ai_pool_f4_*`的现状（`container:""`却正常显示在泳道里，实测`.shape_box=18`全部渲染正常）。

---

### B4. `Designer.setLaneNum(laneNum)` ⚠️ **有条件（依赖选中）**

**签名**：`setLaneNum(num: number)`（len 1）

**作用**：按当前**选中的池/lane** 增删泳道到指定条数。
- 传`0`→ 删除所有 lane（并且如果池有`attribute.collapseBy`会连池一起删）；
- lane 数 > num →`Model.remove(多余的)`；
- lane 数 < num → 循环`Model.create('horizontalLane'|'verticalLane',0,0)`+`onCreated(pool, isLast)`。

**实测源码（关键片段）**

```js
var g = Model.create("horizontalLane", 0, 0);
g.props.height[0] = l;          // l = 已有 lane 的 height[0]，默认 30
g.onCreated(r, f);              // r = pool, f = 是否最后一条
h.push(g); u.push(g.id);
Model.define.elements[g.id] = g;
...
Model.addMulti(h)
```

> ⚠️ **必须先选中池**（`Utils.getSelected()[0]`），否则`t[0].id`直接抛错。

---

### B5. 其它 Pool 方法 ⚠️ **均依赖选中，未实际调用**

| 方法 | 签名 | 作用 |
|---|---|---|
| `setPoolOrientation(ori)` | `'horizontal' \| 'vertical'` | **就地重写池的形状**：换`path/getPath/textBlock[0].position/resizeDir`，旋转所有 lane/分隔条 |
| `setPoolText(text, mode)` | `(string, 'setSeparator'?)` | 设置池 + 所有 lane 的**文字方向**为 horizontal，并重渲染 |
| `setPoolTitle({type})` | `type: 'none'\|'top'\|'left'` | **返回一个函数**，对池/泳道切换标题栏位置 |
| `setPoolFillStyle(style)` | `{position:'title'?, ...fillStyle}` | 池/泳道填充；`position:'title'`时只改标题条 |
| `setPoolTitleFixed({titleFixed})` | `{titleFixed:boolean}` | 标题是否固定在视口（`attribute.titleFixed`） |

**`setPoolTitle`的特殊签名（实测）**

```js
setPoolTitle = function(e, t) {
  var n = e.type, r = void 0 === n ? 'none' : n;
  return function(shape) { ... }    // ← 返回闭包
}
```

> 即：`Designer.setPoolTitle({type:'top'})(shape)`。**标注：调用未验证**。

---

## C. 连线

### C1. `linkerType`取值 ✅ **实测 3 种**

**取值域 =`broken`/`curve`/`straight`**

**取证 1（DOM 菜单）**

```json
[{"tag":"LI","attr":"ac","val":"broken","text":"连接线直角"},
 {"tag":"LI","attr":"ac","val":"curve", "text":"连接线圆角"},
 {"tag":"DIV","attr":"ac","val":"broken","cls":"po-tool-button-small"},
 {"tag":"DIV","attr":"ac","val":"curve", "cls":"po-tool-button-small"}]
```

**取证 2（画布实例）**：`linkerTypesOnCanvas: ["broken","straight"]`

**三种类型行为差异（同一 linker 强制改 type 实测）**

```json
from:{x:1375,y:1613,angle:4.712,id:"f4_n11"}
to:  {x:1323,y:1727,angle:1.5708,id:"f4_n12"}
rawPoints:[{x:1375,y:1670},{x:1323,y:1670}]

broken   → n=2, [{x:1375,y:1670},{x:1323,y:1670}]        // 直角折线
curve    → n=2, [{x:1375,y:1663.12},{x:1323,y:1676.88}] // 圆角，拐点被贝塞尔削掉
straight → n=0, []                                       // 直线，不经 getLinkerPoints
bogusType→ n=0, []                                       // 未知值静默返回空，不报错
```

> `straight`返回空数组是**正常行为**（渲染层直接画 from→to），不是 bug。

**设置方法**：`Designer.setLinkerType(type)`（len 1），只对**选中的 linker** 生效，并会把`Schema.linkerDefaults.linkerType`改成默认值。

---

### C2. `Utils.getLinkerPoints(linker, tFlag, nFlag)` ✅ **完整签名已解**

**签名**：`Utils.getLinkerPoints(linker, tFlag, nFlag) => Array<{x,y,fixed?}>`（len 3）

**源码（开头判定逻辑，实测）**

```js
function (e, t, n) {
  for (var i = Utils.copyArray(e.points), r = -1, o = -1, a = 0; a < i.length; a++) {
    var M = i[a].fixed;
    if (M && -1 == r) r = a;   // 第一个 fixed 点的下标
    if (M) o = a;              // 最后一个 fixed 点的下标
  }
  // 关键分支：只有 nFlag === true 才丢弃折点
  if (r > -1 && true !== n) return i = this.getLinkerFixedPoints(e, r, o, t, n);
  if (i = [], "broken" == e.linkerType) { ... t = t ? 20 : 0; ... }
}
```

**参数含义（实测确认）**

| 参数 | 含义 | 实测影响 |
|---|---|---|
| `tFlag` | 折线**离形状边缘的距离**（px） | `t = tFlag ? 20 : 0`。两次调用结果完全一致（1578），该布局下不触发 |
| `nFlag` | **是否丢弃`fixed:true`折点、强制自动路由** | `true`→ 忽略折点（2 点自动路由）；`false`/省略 → **尊重折点**（原样返回 4 个 + 补 1 个端点） |

**实测证据（对真画布 4 折点 linker`f4_b1`调用）**

```json
rawPoints: [
 {"x":1323,"y":1440,"fixed":true},
 {"x":1261,"y":1440,"fixed":true},
 {"x":1261,"y":1716,"fixed":true},
 {"x": 999,"y":1716,"fixed":true} ]

getLinkerPoints(L, false, true)   → [{x:1323,y:1578},{x:999,y:1578}]   // 2 点，折点被丢弃
getLinkerPoints(L, false, false)  → 4 个 fixed 点 + [{x:999,y:1716}]    // 5 点，折点保留
getLinkerPoints(L, false)         → 同上 5 点（nFlag 省略 == false）
getLinkerPoints(L, true,  true)   → [{x:1323,y:1578},{x:999,y:1578}]   // 同 nFlag=true

lengths: { raw:4, t:2, f:5, none:5 }
```

> **结论：`nFlag`才是控制折点的开关，`tFlag`只影响 20px 边距。**
> 要`尊重 fixed 折点`→ 传`(linker, false, false)`或`(linker, false)`。

---

### C3. 让连线走指定通道（`fixed:true`折点）✅ **格式已实测**

**正确写法**：`linker.points`是`[{x, y, fixed:true}, ...]`的数组，**每个点都要带`fixed:true`**。

**真画布实例（`f4_b1`，4 个折点全 fixed）**

```json
{"id":"f4_b1","linkerType":"broken",
 "from":{"x":1323,"y":1429,"angle":4.712,"id":"f4_n9"},
 "to":  {"x": 999,"y":1727,"angle":1.5708,"id":"f4_n7"},
 "points":[{"x":1323,"y":1440,"fixed":true},
           {"x":1261,"y":1440,"fixed":true},
           {"x":1261,"y":1716,"fixed":true},
           {"x": 999,"y":1716,"fixed":true}]}
```

**画布折点数分布**：13 条 linker 中`fixedCount = [0,0,0,0,0,4,2,4,0,0,0,0,0]`—— 说明`fixed`是**可选**的，普通线`points`里**没有`fixed`字段**。

**写法**

```js
linker.linkerType = 'broken';
linker.points = [
  { x: 1323, y: 1440, fixed: true },
  { x: 1261, y: 1440, fixed: true },
  { x: 1261, y: 1716, fixed: true },
  { x:  999, y: 1716, fixed: true }
];
```

> ⚠️`fixed`只影响`getLinkerPoints`的**路由计算**；`from`/`to`端点坐标仍由形状锚点决定，折点坐标不参与吸附。

---

### C4. 箭头标记（`lineStyle`）✅ **可用，取值已实测**

**字段**：`lineStyle.beginArrowStyle`/`lineStyle.endArrowStyle`（默认`'none'`/`'solidArrow'`）

**完整取值（实测从箭头菜单`li[ac]`抓取，20 项）**

```json
["none","solidArrow","dashedArrow","normal","solidDiamond","dashedDiamond",
 "solidCircle","dashedCircle","cross","asynch1","asynch2","zero1","one1","one2",
 "zeroOrOne","zeroToMany","oneOrMany","oneToMany","oneToOne","zeroToOne"]
```

**`Schema.linkerDefaults`实测**

```json
{"id":"","name":"linker","text":"","group":"","linkerType":"broken","points":[],"locked":false,
 "dataAttributes":[],"props":{"zindex":0},
 "lineStyle":{"lineWidth":2,"lineColor":"50,50,50","lineStyle":"solid",
              "beginArrowStyle":"none","endArrowStyle":"solidArrow"},
 "fontStyle":{"fontFamily":"微软雅黑","size":13,"color":"50,50,50","bold":false,
              "italic":false,"underline":false,"textAlign":"center"}}
```

**`Designer.defaults`实测**：`{"linkerBeginArrowStyle":null,"linkerEndArrowStyle":null,"lineWidth":1.5}`
→ AI 建的线默认`lineWidth = 1.5`，而模板默认是 2。

---

## D. 布局与坐标

### D1. 泳道内节点坐标：**绝对坐标** ✅ **已实测**

**结论：`props.x/y`永远是**画布绝对坐标**，与池/泳道无关。**

```json
pool: {"x":774,"y":1348,"w":709,"h":460}
lane: {"x":914,"y":1716,"w":569,"h":92}     ← 914 = 774 + 140(pool.height[0])
node: {"x":782,"y":1468,"w":124,"h":36}     ← 782 落在 774..1483 内，是绝对坐标
```

节点的`parent`是`""`（空），**不指向 lane**；只有 lane 的`parent`指向 pool。
`Utils.getShapeBox(shape)`直接返回`props`（含 zindex/angle），没有相对换算。

```json
Utils.getShapeBox(node) → {"zindex":900,"w":124,"x":782,"h":36,"y":1468,"angle":0}
```

---

### D2. 布局方法族 ⚠️ **多数依赖选中**

全部是`Designer.xxx`，第一个参数是模式字符串，**且都只对当前选中的图形生效**。

| 方法 | 签名（实参取值实测自菜单属性） | 作用 | 状态 |
|---|---|---|---|
| `alignShapes(al)` | `al ∈ 'left'\|'center'\|'right'\|'top'\|'middle'\|'bottom'` | 对齐；会`removeAnchors()`；**选中 ≥2 个泳道时只 toast 警告`js.Multiple_pool_lanes`不做** | ⚠️ 需选中 |
| `distributeShapes(dist)` | `dist ∈ 'h'\|'v'` | 水平/垂直平均分布；跳过 group 内元素 | ⚠️ 需选中 |
| `matchSize({w,h})` | `w/h`可为`'auto'`（取选中最大值） | 统一尺寸；gantt 插件形状会删`h` | ⚠️ 需选中 |
| `layerShapes(dir)` | `dir ∈ 'front'\|'forward'\|'back'\|'backward'` | 层级前后移动 | ⚠️ 需选中 |
| `beautify()` | `()` | 一键美化，走`Beautify.getBeautifyDefinition()`→`Model.updateWithBeautify`；**返回`true`/`false`**，无图可美化时 toast`没有图形可美化` | ✅ 可读 |
| `layoutShapes` | — | **❌ 不存在** | ❌ **不可用** |

**实测证据（参数来源）**

```json
"alignVals": ["left","center","right","top","middle","bottom"]
"distVals":  ["h","v","h","v"]
"matchSub":  [{"ac":"w","text":"宽度匹配"},{"ac":"h","text":"高度匹配"},{"ac":"wh","text":"宽高匹配"}]
"layerAcs":  ["front","back","forward","backward"]
```

**可运行示例**

```js
Utils.selectShape([id1, id2, id3]);   // 先选中
Designer.alignShapes('left');
Designer.distributeShapes('v');
Designer.matchSize({ w: 'auto', h: 60 });
```

---

### D3. `Model.updatePage`vs`Designer.updatePlaneConfig` ✅ **已解**

**签名**

```js
Model.updatePage(pageObj, skipMessage, canvasArg)   // len 3
Model.onlyUpdatePage(pageObj)                        // len 1
Designer.updatePlaneConfig()                         // len 0
```

**`Model.updatePage`源码（实测）**

```js
function(e,t,n){
  var i = Model.define.page.backgroundColor,
      r = $.extend(Model.define.page, e),
      o = { page: Utils.copy(Model.persistence.page), update: Utils.copy(r) };
  Model.persistence.page = Utils.copy(r);
  Model.define.theme = Utils.deepMerge(Model.define.theme, {page:{backgroundColor:r.backgroundColor}});
  Model.persistence.theme = Utils.copy(Model.define.theme);
  MessageSource.send('updatePage', o);        // ← 进协同 + 撤销栈
  Designer.initialize.initCanvas(n);          // ← 重建画布
  Designer.updatePlaneConfig();
  _shapeTheme.shapeTheme.changeTextColorByBackground(r.backgroundColor, i);  // ← 按底色自动改字色
}
```

**两者分工（结论）**

| 维度 | `Model.updatePage` | `Designer.updatePlaneConfig` |
|---|---|---|
| 用途 | **改页面尺寸/网格/底色** | **CAD 平面图**（墙长、房间面积）重算 |
| 触发协同 | ✅`MessageSource.send('updatePage')` | ❌ 无 |
| 触发重绘 | ✅`initCanvas` | 只重算墙体 |
| 副作用 | 自动按底色改文字颜色 | 读`Model.define.page.planeConfig` |
| 适用 | 流程图 | 仅`category: plane*` |

**改页面尺寸的正确写法**

```js
Model.updatePage({ width: 1600, height: 1200 });
// 如需不通知协同：Model.updatePage({...}, true)
// 如需完全静默：Model.onlyUpdatePage({...})
```

**实测当前页面对象**

```json
{"padding":20,"orientation":"portrait","backgroundColor":"transparent","gridSize":15,
 "width":3100,"showGrid":true,"richText":true,"version":2215,"height":2600}
```

---

## E. 保存与持久化

### E1. 真正写入存储的路径 ✅ **已测绘**

**改动从内存到云端的完整链路（源码实证）**

```
Model.addMulti / Model.updateMulti
   └─ MessageSource.send(action, content, tempId)
        └─ MessageSource.messages.push({action, content, tempId, pageId})
             └─ MessageSource.submit()
                  ├─ batchSize==0 且 messages 非空 才继续
                  ├─ withUndo → undoStack.push(messages)
                  ├─ sendMessage.send({action:'command', messages, name, pageId})
                  │     ├─ this.version++         ← 版本号自增
                  │     ├─ sending 为真 → 进 tempMess 暂存，return
                  │     └─ 否则真正发 → 服务端 + WebSocket 协同
                  └─ this.messages = []
```

**`MessageSource.submit`源码（实测）**

```js
function(){
  if (0 == this.batchSize && 0 != this.messages.length) {
    if (this.withDock && Dock.update(!0), Designer.events.push('shapeCount'),
        0 == this.withMessage) return void (this.messages = []);
    if (this.withUndo && this.undoStack.push(this.messages), '' != chartId) {
      ... var i = {action:'command', messages:e, name:userName, pageId:...};
      sendMessage.send(i);
    }
    this.messages = [];
  }
}
```

**✅ 结论：官方唯一正确落库路径 = 走`MessageSource.send`（由`Model.addMulti`/`updateMulti`/`remove`自动调用）。不要自己调`sendMessage.send`（会绕过 undoStack 和 batch 计数）。

**其它入口实测**

| 入口 | 实测结果 | 状态 |
|---|---|---|
| `Ctrl+S` | `Designer.hotkey.init`里`keydown.hotkey`：`(ctrlKey\|\|metaKey)&&83==keyCode → preventDefault(); UI.save()` | ✅ |
| `UI.save()` | `sendMessage.saveOnline('click', cb)`，有 30s 节流（`isSaveAll`） | ✅ |
| `sendMessage.saveOnline(reason, cb)` | `reason ∈ 'click'\|'all'\|'serverRestart'\|'netTrigger'\|'initVersion'\|'switchPage'\|'mindToPPT'`；`saving`为真时直接 cb('error')；`saveOnlineTime = 10000ms`等待窗口 | ✅ |
| `Model.persistence` | **只是内存影子副本**，`Model.updateMulti`里同步写；**不落盘** | ⚠️ 非存储 |
| `MessageSource.submit()` | 空调用安全（`messages.length == 0`直接 return），实测`mess`仍为 0、version 不变 | ✅ 幂等 |
| `localStorage['version_local_585463292233']` | 实测 =`"2217"`，与`sendMessage.version`一致 | ✅ 侧信道 |
| `localStorage['dw_store_wait_send_events']` | 实测`"{}"`（无待发事件） | ✅ 侧信道 |
| WebSocket | `configCollaSave.webSocketUrl`→`publicCLB.webSocketUrl`=**`https://pocb.processon.com`**，参数`?chartId=&userId=&clientId=&userName=&avatar=&role=1` | ⚠️ 只读探测 |

**实测保存状态基线（未做任何写入）**

```json
{"version":2217,"versionNow":2217,"saving":false,"sending":false,"isOffLine":false,
 "chartId":"wps","pageKey":"7c9e3af0cdd2434ba632d63266f3d604",
 "prePoSaveStatus":"success","isSaveVersion":true,"errorSave":0,
 "messLen":0,"tempMessLen":0,"saveTipHref":"#icon-cloud_sync",
 "localVersion":"2217"}
```

---

### E2. `#save-tip`图标状态机 ✅ **取值已实测**

**实测符号表（`<symbol id>`全集）**

```json
["icon-cloud_prohibit","icon-cloud_updated","icon-cloud_updating",
 "icon-cloud_sync","icon-cloud_error"]
```

**状态迁移（源码实证）**

| `xlink:href` | 含义 | 写入点（源码证据） |
|---|---|---|
| `#icon-cloud_sync` | **空闲 / 已保存** | `configCollaSave.saveSuccess`：`$("#save-tip use").attr("xlink:href","#icon-cloud_sync")`（在`setTimeout 100ms`后） |
| `#icon-cloud_updating` | **保存中** | `sendMessage.saveOnline`：`$("#save-tip use").attr("xlink:href","#icon-cloud_updating")` |
| `#icon-cloud_updated` | 已更新（符号存在） | 未在源码路径中捕获 → **未验证** |
| `#icon-cloud_error` | 保存失败（符号存在） | 未在源码路径中捕获 → **未验证** |
| `#icon-cloud_prohibit` | 禁止保存（符号存在） | 未在源码路径中捕获 → **未验证** |

**判定`已保存`的正确姿势（推荐，三条件）**

```js
const href = document.querySelector('#save-tip use').getAttribute('xlink:href');
const ver  = sendMessage.version;
const savedVer = localStorage.getItem('version_local_' + configCollaSave.opts.file_id);
const isSaved = (href === '#icon-cloud_sync')
             && (sendMessage.saving === false)
             && (String(ver) === savedVer);
```

**另有两个更硬的信号**

- `sendMessage.prePoSaveStatus === 'success'`（实测当前值）
- `configCollaSave.saveSuccess`里会执行`Model.define.page.version = sendMessage.version`—— 即 **`Model.define.page.version`追平`sendMessage.version`就等于落库成功**。

**实测当前 DOM 原文**

```html
<div id="save-tip" class="save-tip mt3 mind-icons" title="编辑内容自动保存到WPS云空间">
  <svg class="icon" aria-hidden="true"><use xlink:href="#icon-cloud_sync"></use></svg>
</div>
```

---

### E3. 读回服务端已存版本 ⚠️ **有只读通道，但没有`拉最新`API**

**✅ 可用：`pageInfo.definition`（页面加载时注入的服务端快照）**

```json
{"defType":"string","defLen":35190,
 "defKeys":["comments","plugins","elements","postPayment","theme","page","aiContainers","insertPageOpts"],
 "defElCount":39,
 "defPage":{"padding":20,...,"version":2215,"width":3100,"height":2600},
 "pageInfoVersion":2215}
```

```js
const serverDef = JSON.parse(pageInfo.definition);
// serverDef.elements       ← 服务端版本的全部图元
// serverDef.page.version   ← 服务端版本号
```

**⚠️ 重要限制**：`pageInfo.definition`是**页面初始化时**的快照，不会随保存刷新。实测当前`pageInfo.version = 2215`而`sendMessage.version = 2217`—— **本地已领先 2 个版本**，说明它确实是旧快照。

**❌ 不可用：`configCollaSave.loadHistorys`**

```js
loadHistorys = function(e){}    // 实测空函数！
```

**其它只读锚点**

| 变量 | 实测值 | 说明 |
|---|---|---|
| `configCollaSave.getDefId()` | `585463292233` | =`editorGlobal.poPagination.pageId` |
| `configCollaSave.getCanvasId()` | `""` | 当前页无 canvasId |
| `configCollaSave.getCurrDef()` | `{page,elements,comments,plugins,aiContainers,insertPageOpts,postPayment,theme}` | **这正是要发给服务端的 payload** |
| `configCollaSave.ajax` | `(e,n) => poAjax(e,n)` | 底层 XHR 包装 |

> ⚠️ **要验证落库成功，最可靠的做法是：改完后轮询`Model.define.page.version === sendMessage.version && !sendMessage.saving && href === '#icon-cloud_sync'`，然后刷新页面再看`pageInfo.definition`。

---

## F. 样式与主题

### F1. 颜色格式 =`"r,g,b"`字符串 ✅ **已实测**

**画布真实值**

```json
"fillStyle":{"type":"none"}
"lineStyle":{"lineStyle":"solid","lineColor":"236,241,247","lineWidth":0}
"fontStyle":{"fontColor":"31,45,63"}
linker "lineStyle":{"lineStyle":"solid","lineColor":"110,130,155","lineWidth":1.5}
```

> **注意`fillStyle`用`color`，`lineStyle`用`lineColor`，`fontStyle`用`fontColor`—— 三个字段名各不相同！**

---

### F2. `fillStyle`/`lineStyle`/`fontStyle`完整字段 ✅ **已实测**

**`Schema.shapeDefaults`实测原文（权威字段集）**

```json
"shapeStyle": {"alpha": 1},
"lineStyle":  {"lineWidth":2,"lineColor":"33,41,48","lineStyle":"solid"},
"fillStyle":  {"type":"solid","color":"255,255,255"},
"fontStyle":  {"fontFamily":"微软雅黑","size":13,"lineHeight":1.25,"color":"50,50,50",
               "bold":false,"italic":false,"underline":false,
               "textAlign":"center","vAlign":"middle",
               "orientation":"vertical","direction":"tb"}
```

**`lineStyle.lineStyle`取值（实测 DOM）**

```json
["solid","dashed","dot","dashdot","sketch-solid","sketch-dashed",
 "sketch-hachure","sketch-zigzag","sketch-cross-hatch"]
```

**`fillStyle.type`取值（实测 DOM）**

```json
["solid","none","gradient","image"]
// gradient 下还有 "linear"/"radial"
// image 下还有 "fill"/"fit"/"stretch"/"original"/"tile"
```

**`fontStyle`枚举（实测 DOM`ac`全量）**

| 字段 | 取值 |
|---|---|
| `size` | `8,10,12,13,14,15,16,17,18,20,24,30,32,40,64`（px） |
| `textAlign` | `left, center, right` |
| `vAlign` | `top, middle, bottom` |
| `orientation` | `tb`（纵向）/ 缺省（横向） |
| `direction` | `tb, lr, rl` |
| `lineHeight` | `1.25, 2.0, 2.5, 3` |
| `bold/italic/underline` | boolean |

---

### F3. `Utils.RGB2Hex`/`Hex2RGB` ⚠️ **有坑**

**签名**
`Utils.RGB2Hex(str) => hex6`（**不带`#`**）
`Utils.Hex2RGB(hex) => "r,g, b"`（**逗号后带空格！**）

**实测**

```json
Utils.RGB2Hex("rgb(110,130,155)") → "6e829b"       ✅
Utils.RGB2Hex("#6e829b")          → "#6e829b"      （原样返回，没转换）
Utils.RGB2Hex("110,130,155")      → "000NaN"       ❌ 崩坏
Utils.Hex2RGB("#6e829b")          → "110,130, 155" ⚠️ 第三段前有空格
```

> **`RGB2Hex`只认`rgb(...)`或`#...`，不认画布里实际存的`"r,g,b"`格式**！源码`e.split(/\D+/)`对`"110,130,155"`得到 3 段，而它取`t[1],t[2],t[3]`（第 2~4 段）→`undefined`→`NaN`。

---

### F4. `Model.getCurrentTheme`/`setTheme` ⚠️ **可用但主题库是空的**

**签名**

```js
Model.getCurrentTheme()              // len 0
// 源码：function(){ return Model.define.theme || {} }

Model.setTheme(theme, skipMessage, reRender = true)   // len 2 + arguments[2]
```

**实测返回值**

```json
Model.getCurrentTheme() → {"page":{"backgroundColor":"transparent"}}
Model.define.theme      → {"page":{"backgroundColor":"transparent"}}
Object.keys(Schema.themes).length  → 0        ← ❌ 主题目录是空对象
Object.keys(Schema.markers).length → 0        ← ❌ 标记目录也是空的
```

> **❌`Schema.themes`和`Schema.markers`都是`{}`**，没法枚举可用主题列表。只能改`Model.define.theme`里的已知字段（当前只有`page.backgroundColor`）。

**`setTheme`源码要点（实测）**

```js
Model.setTheme = function(e, t, r) {
  r = arguments.length > 2 ? arguments[2] : true;
  Model.define.theme = e;
  Model.define.page.backgroundColor = e?.page?.backgroundColor ?? "255,255,255";
  Model.persistence.page.backgroundColor = Model.define.page.backgroundColor;
  Model.persistence.theme = Utils.copy(e);
  t || MessageSource.send('setTheme', {theme:..., update:...});
  if (r) { for (每个 element) Designer.painter.renderShape(s); Designer.initialize.initCanvas(); }
}
```

**`Designer.setShapeStyle`签名**：`setShapeStyle(styleObj)`（len 1），⚠️ **只对选中形状生效**，最终仍走`Model.updateMulti`。

同族：`Designer.setFillStyle(style, shapes?)`（len 2，可传显式形状数组）、`Designer.setLineStyle(style)`（len 1）、`Designer.setFontStyle(style, shapes?)`（len 2）。

---

## 🔴 坑

以下全部是**实测撞到**的反直觉行为。

### 坑 1：`Model.create`不落库，但**会污染`page.version`**

`created_Id_is_in_define === false`（不写`define.elements`），看起来纯函数。实测确实没写`define.elements`、没进`undoStack`、没产生待发消息（`mess`仍为 0）。**但探测期间`Model.define.page.version`从 2215 变成了 2217**，而`Model.persistence.page.version`仍是 2215。

> ⚠️ **归因说明**：`setLaneNum`源码显示`Model.create`内部会`Designer.events.push("create", r)`，而`listeners.create`实测是空函数`function(e){}`，所以**无法确证是我的`Model.create`调用导致的**。也可能是编辑器自身的协同心跳/自动保存改的。**建议把这条当作「探测期间版本号会漂移」的观测事实，而不是精确归因。**

```json
测绘前 definePageVersion: 2215  →  测绘后: 2217
       persistencePageVersion: 2215  (未变)
       localStorage version_local_585463292233: "2217"
```

> **即使你没改任何图，只要调过`Model.create`，客户端就认为有未保存改动。**

### 坑 2：`Model.create`使`maxZIndex`只读，`createByShape`才自增

```json
{"maxZ_before":952,"after_create_maxZ":952,
 "after_createByShape_maxZ":953,"a_zindex":953,"b_zindex":953}
```

连造两个`create`节点 → **zindex 完全相同（953）**，叠放顺序靠`orderList`排序，不稳定。

### 坑 3：`straight`连线从`getLinkerPoints`返回**空数组**，且拼错类型名**不报错**

```json
"straight":  {"n":0,"pts":[]}
"bogusType": {"n":0,"pts":[]}     ← 写错类型名，静默返回空
```

> 如果用`getLinkerPoints`结果画线，`straight`和**任何错拼**都会得到 0 个点 → 线画不出来，**且没有任何异常**。类型名务必精确。

### 坑 4：`getLinkerPoints`第三参传`true`会**丢掉你精心设置的折点**

```json
raw: 4 个 fixed 折点
getLinkerPoints(L, false, true)  → 2 个自动路由点（折点全丢）
getLinkerPoints(L, false, false) → 4 个折点 + 1 个补点（保留）
```

且`false`版本会**多返回 1 个重复坐标的末点**（`{x:999,y:1716}`出现两次，一次带`fixed`一次不带）。画线时要去重。

### 坑 5：`Utils.getContainedShapes([pool])`在 AI 生成的图上返回 **0**

```json
{"containedCount": 0, "containedByName": {}}
```

原因：它判`o.container == e.id`，而 AI 建的图里`container`全是`""`。
**别用`getContainedShapes`，用`Utils.getPoolByPosition(x,y)`或直接`rectInRect`判几何。**

### 坑 6：`Model.create('horizontalLane')`单独用 → 造出**孤儿泳道**

不调`onCreated`就没有`parent`、不进`pool.children`、尺寸是模板默认 600×200。
泳道的全部归属逻辑都封在`Schema.shapes.horizontalLane.onCreated`里，**没有别的入口**。

### 坑 7：`Model.create`的池默认`attribute.visible = false`

模板`horizontalPool.attribute.visible = false`，但真画布实例是`true`。
直接`create('horizontalPool')`出来是**不可见**的，得手动置`true`。

### 坑 8：`Utils.RGB2Hex`不认画布自己的颜色格式

```json
Utils.RGB2Hex("110,130,155")      → "000NaN"       ❌
Utils.RGB2Hex("rgb(110,130,155)") → "6e829b"       ✅
Utils.Hex2RGB("#6e829b")          → "110,130, 155" ← 有空格
```

`Hex2RGB`的输出**不能直接塞回`lineColor`**（多了空格），要么自己`.replace(/\s/g,'')`。

### 坑 9：样式对象的颜色字段名**各不相同**

`fillStyle.color`/`lineStyle.lineColor`/`fontStyle.color`/`fontStyle.fontColor`

实测`Schema.shapeDefaults.fontStyle`用`color`，但真画布节点里存的是`fontColor`。**两种写法在不同对象上并存**，改样式时两个都写才保险。

### 坑 10：`Designer.layoutShapes`**根本不存在**

```json
"layoutShapes": "NOT A FUNCTION: undefined"
```

自动布局要用`Designer.beautify()`（走 Beautify 引擎），或自己算坐标。

### 坑 11：`Schema.themes`和`Schema.markers`都是**空对象**

```json
Object.keys(Schema.themes).length  → 0
Object.keys(Schema.markers).length → 0
```

没有可枚举的主题/标记目录。当前主题只有`{"page":{"backgroundColor":"transparent"}}`一个字段。

### 坑 12：`Schema.categories`是**数组**不是字典

`Object.keys(Schema.categories)`返回`["0","1","2","3"]`（下标），不是`["standard","basic","flow","lane"]`。要按名字查得自己`.find(c => c.name === 'lane')`。

### 坑 13：`Model.persistence`不是`已保存的版本`

它是**内存影子副本**，`Model.addMulti`里同步写`this.persistence.elements[a.id] = Utils.copy(p)`。
实测`persistence.page.version = 2215`而`define.page.version = 2217`—— **persistence 反而更旧**。别拿它当`落库成功`的判据。

### 坑 14：保存状态图标是**异步 + 100ms 延迟**才回到`cloud_sync`

`configCollaSave.saveSuccess`里：

```js
setTimeout(function(){ ...; $("#save-tip use").attr("xlink:href","#icon-cloud_sync"); ... }, 100)
```

保存成功后立刻读`xlink:href`**可能还是`cloud_updating`**。轮询要留 ≥150ms 余量。

### 坑 15：`configCollaSave.loadHistorys`是**空函数**

```js
loadHistorys = function(e){}
```

想通过它读历史版本 → 永远拿不到东西，也不报错。

### 坑 16：`Model.updatePage`会**自动改文字颜色**

```js
_shapeTheme.shapeTheme.changeTextColorByBackground(r.backgroundColor, i)
```

换深色底 → 所有文字颜色会被批量改成对比色。只想改尺寸时传`backgroundColor`不变的值可避免。

---

## 附：能力状态汇总

| 状态 | 能力 |
|---|---|
| ✅ **可用**（17 项） | Model.create、createByShape、createLinker、add/addMulti、executeMessages、形状模板枚举(79)、最小字段集、泳道结构差异、linkerType 三值、getLinkerPoints 三参、fixed 折点格式、箭头 20 值、绝对坐标、Model.updatePage、save-tip 状态机、样式字段集、UI.save |
| ⚠️ **有条件**（14 项） | setLaneNum、setPoolOrientation、setPoolText、setPoolTitle、setPoolFillStyle、setPoolTitleFixed、alignShapes、distributeShapes、matchSize、layerShapes、beautify、setShapeStyle、getCurrentTheme/setTheme、pageInfo.definition 读回 |
| ❌ **不可用**（6 项） | Templates（不存在）、Theme（不存在）、Designer.layoutShapes（不存在）、Schema.themes（空）、Schema.markers（空）、configCollaSave.loadHistorys（空函数） |

> **只读声明**：本次测绘**未创建/修改/删除任何图元，未保存，未改页面状态**。
> 测绘前后基线核对：`elements 39 → 39`，`.shape_box 18 → 18`，`mess 0 → 0`，`undoStack 无新增`。
> 渲染试验的临时 DOM 与`Model.define.elements`条目均在同一个`browser_evaluate`调用内删除，`Model.maxZIndex`已回滚。

---

## 🔴 施工过程中新发现的 5 个致命坑（2026-11-17 从零画图实战）

这 5 条不在原测绘范围内，是真正动手画图时才暴露的。按踩坑顺序排列。

### 坑 A：缺 `attribute.viewportRenderable` 会导致「数据在、画布空」

**现象**：`MessageSource.executeMessages` 成功，21 个图元全部进了 `Model.define.elements`，
`Model.orderList` 也有，但 `document.getElementById(id)` 全是 `null` —— **一个都不渲染**。

**根因**（源码实证）：

```js
// Model.buildVisibleShapeIds
(Utils.rectCross(canvasViewBox, shapeBox) || r.attribute.viewportRenderable === false)
  && t.push(n)
```

判据是 **"在视口内" 或 "viewportRenderable 显式为 false"**。
新造的图元若**没有** `viewportRenderable` 字段、又不在当前视口内，就永远进不了可见集合。

**修法**：造节点/连线时显式置：

```js
shape.attribute = shape.attribute || {};
shape.attribute.viewportRenderable = false;   // false = 无条件渲染
```

> 注意语义是反的：`false` 表示"不受视口限制"。别被字段名骗了。

### 坑 B：clone 现有节点会丢掉形状语义

**现象**：想要"圆头起点"和"菱形判断"，画出来全是矩形。

**根因**：用 `Utils.copy(画布上某个节点)` 当模板时，拿到的是**那个节点的形状**。
若画布上只有 `process`，所有形状都变矩形。

**正确做法**：用 `Model.create(name, x, y)` 取官方骨架，它按 schema 生成 `path`：

```js
Model.create('start', 0,0)      // path.actions: move,line,curve,line,curve,close  → 圆头
Model.create('decision', 0,0)   // path.actions: move,line,line,line,line,close   → 菱形
Model.create('terminator', 0,0) // 圆头，终止图元
```

**⚠️ `Model.create('end', ...)` 会抛错**：
`Cannot read properties of undefined (reading 'startsWith')`。终点用 `terminator`。

### 坑 C：`Model.create` 只造对象，不落库，且污染 `page.version`

```js
const o = Model.create('process', 100, 100);
Model.define.elements[o.id]   // undefined —— 没进画布
```

它只是返回一个内存对象。要让图元真正存在，仍须走 `MessageSource.executeMessages([{action:'create',...}])`。

副作用：调用 `Model.create` 会让 `page.version` 自增（观察到 2215 → 2217），
但 `persistence` 不变。如果靠 version 判保存状态，要留意这个漂移。

### 坑 D：连线标签不是 `position`，是 `location` + `textPos`

节点的文字用 `textBlock: [{position:{w,x,h,y}, text}]`；
**连线完全不同**，它是：

```js
edge.textBlock = [{ location: 0.5, text: '是' }];   // location = 沿线比例 0~1
edge.textPos  = { t: 28, x: 1234, y: 567 };          // x/y = 标签绝对坐标（线的中点附近）
```

只给 `textBlock` 不给 `textPos`，或用了节点的 `position` 结构，
文字会**压在节点上**或根本不显示。手绘真值中 29 条带文字的连线全部是这个结构。

### 坑 E：`Utils.copy` 不是处处可用

桥接层里如果用 `global.Utils.copy(tpl)` 做深拷贝，在不提供 Utils 的环境下会抛
`TypeError: h.Utils.copy is not a function`（parity 假环境就是）。

**修法**：自己写 `deepClone`（`JSON.parse(JSON.stringify(...))`），
但注意 **JSON 序列化会丢函数字段**（`getPath`/`getAnchors`/`getTextBlock`），
克隆后要手动补回：

```js
const c = deepClone(tpl);
if (typeof tpl.getPath === 'function') c.getPath = tpl.getPath;
if (typeof tpl.getTextBlock === 'function') c.getTextBlock = tpl.getTextBlock;
```

### 坑 F：内容超出画布范围会画不出来

`Model.define.page` 有 `width/height`。把图元画在 `y + h > page.height` 的位置，
即使有 `viewportRenderable:false` 也不会正常显示（滚动也到不了）。

**先扩页面再画**：

```js
Model.updatePage({ width: 3600, height: 3200 });
```

---

## 保存的可靠三条件（补充 E1/E2）

```js
const href = document.querySelector('#save-tip use').getAttribute('xlink:href');
const SM = window.sendMessage;
const savedOk =
      href === '#icon-cloud_sync'     // 图标回到空闲
   && SM.saving === false              // 不在保存中
   && SM.errorSave === 0;              // 无错误
```

**最强的落库证据 = 开新标签页重新加载同一 URL，再读 `Model.define.elements`。**
实测：`dgE_` 21 个图元在全新标签页里立刻可读 → 确认写入服务端，不是内存假象。

> ⚠️ `localStorage['version_local_<fileId>']` 会**落后于** `sendMessage.version`（观察到差 2），
> 它是本地快照，**不能单独作为"没保存成功"的判据**。原测绘把它当三条件之一，
> 实战中会误判。已改为上面三条件。
