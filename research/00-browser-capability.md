# 浏览器端画布可操控性 —— 实测报告

> 测试时间：2026-11-04 10:00-10:12 (Asia/Shanghai)
> 测试环境：Edge 156 / DSH Browser Control 1.1.0
> 测试对象：用户实际打开的两个标签页

## 一、结论速览

| 目标 | 读取 | 写入 | 导出 | 实时协同 | 结论 |
|---|---|---|---|---|---|
| draw.io (app.diagrams.net) | 完整语义 | 正常渲染 | XML+SVG | 本身无 | 可控，适合做 AI 生成端 |
| kdocs -> ProcessOn 内嵌 | 需绕过跨域 | 会破坏视图 | 有限 | 原生支持 | 有官方 MCP，别绕路 |

---

## 二、draw.io 实测细节

### 2.1 拿到编辑器实例

window.editorUi 是不可见的，但官方插件钩子能拿到：

    window.Draw.loadPlugin(function(ui) {
      window.__dshUi = ui;   // EditorUi 实例
    });

实测：hasLoadPlugin = function -> 回调立即触发 -> instanceKeyOnWindow = __dshUi

### 2.2 读（成功）

    const graph = ui.editor.graph;
    const model = graph.getModel();
    const root  = model.getRoot();
    const page  = model.getChildAt(root, 0);
    for (let i = 0; i < model.getChildCount(page); i++) {
      const c = model.getChildAt(page, i);
      // c.id / c.value（标签文本）/ c.vertex / c.edge / c.geometry
    }

### 2.3 写（成功，且实际渲染）

    graph.getModel().beginUpdate();
    try {
      const base = 'x=0;fillColor=#dae8fc;strokeColor=#6c8ebf;rounded=1;';
      const a = graph.insertVertex(graph.getDefaultParent(), null, '接收订单', 60, 40, 140, 60, base);
      const b = graph.insertVertex(graph.getDefaultParent(), null, '库存校验', 60, 160, 140, 60, base);
      const c = graph.insertVertex(graph.getDefaultParent(), null, '发货', 60, 280, 140, 60, base);
      graph.insertEdge(graph.getDefaultParent(), null, '通过', a, b);
      graph.insertEdge(graph.getDefaultParent(), null, '是', b, c);
    } finally {
      graph.getModel().endUpdate();
    }

实测结果：创建 5 个 cell，画面立即出现 3 个圆角矩形 + 2 条带标签箭头（已截图验证）。

### 2.4 导出（成功，两种格式）

    ui.getFileData()   // mxGraph XML，1752 字符，标准 mxfile > diagram > mxGraphModel
    graph.getSvg()     // SVG DOM，3825 字符

### 2.5 draw.io 的致命短板：本身没有多人实时协同

官方文档明确（drawio.com/docs/manual/collaboration/concurrent-editing）：

> Real-time collaboration is available when you store your diagram files in Microsoft OneDrive or in Google Drive.
> Collaborative editing works with draw.io in: Confluence Cloud, Google Drive, Microsoft OneDrive, Nextcloud (when Autosave is enabled with the official draw.io servers).

也就是说：
- 自托管 jgraph/drawio Docker 镜像（Apache-2.0，9.1k stars）**没有实时协同**
- 协同依赖第三方存储（OneDrive / Google Drive / Nextcloud / Confluence）
- 国内团队用 OneDrive/Google Drive 都不现实

---

## 三、kdocs 实测细节

### 3.1 关键发现：kdocs 的流程图就是 ProcessOn

    <iframe id="dotviewIframe"
      src="https://wps.processon.com/diagrams/edit?encrypted_session=...&file_id=...&group_id=...">
    </iframe>

- 跨域：crossOriginAccessible = false，SecurityError
- 独立打开该 URL（带完整加密 session 参数）后，可直接访问页面全局对象

### 3.2 可用的全局对象

| 对象 | 类型 | 说明 |
|---|---|---|
| PoEditorApi | function | 官方 API 类（85+ 方法） |
| PoEditorClient | instance | 可直接用的单例 |
| Model | object | 数据模型（define.elements） |
| Designer | object | 渲染/交互层 |
| Utils | object | 工具函数 |
| pageInfo | object | 含 definition JSON 全文 |

### 3.3 读（成功）

    const els = Model.define.elements;   // 113 个
    // 节点：textBlock[].text + title + props{x,y,w,h}
    // 连线：name === 'linker'，含 from.id / to.id / text

实测：**52 个节点 + 61 条连线**，语义完整 —— 泳道名、节点文字、判定分支、连线标签都读到了。
（具体泳道与节点内容仅作结构说明，不在此收录。）

### 3.4 ProcessOn 内建 AI 接口（本来就有）

    PoEditorApi.prototype = [
      'getAiCanvasData',   // 画布转成 AI 可读结构（containers / keywords）
      'createAiContent',   // AI 内容写入画布
      'AIGCRun',           // AI 生成流程
      'getDslType',
      'editAiContent',
      'restoreAIInitResult'
    ]

### 3.5 写（危险，不推荐）

Model.addMulti([def], true, undefined, true) 能改内存模型，**但视图不重绘**。

更严重的坑：Model.remove([])（空数组）会**清空整个 define.elements**，画布白屏。
测试中触发过一次，通过 browser_navigate 重新加载从服务端恢复 —— 文档从未被 saveOnline 保存，服务端副本完好，最终确认 113 图形 / 579 字与初始一致。

**教训：直接操作 ProcessOn 内部 API 是高危操作，不应作为产品方案。**

### 3.6 正确的路：官方 MCP

    包名: @qqq3qqq/processon-openapi-mcp
    版本: 3.1.3（2026-09 更新）  许可: MIT
    仓库: github.com/processon/processon-openapi-mcp
    API Key: https://api-v5.processon.com/demotest/admin

| 工具 | 功能 |
|---|---|
| create_diagram | 通过 Mermaid 创建任意类型图表 |
| create_mindmap | 通过 Markdown 创建思维导图 |
| create_blank_diagram | 创建空白图表 |
| import_diagram_file | 导入 drawio/vsdx/xmind/mermaid/md/dsl |
| update_diagram | 通过 fileId 覆盖更新 |
| check_api_usage | 查询 API 用量 |

支持 Mermaid 全类型 + 导入 .drawio / .vsdx / .pos 等。这把「draw.io 可编程」和「ProcessOn 多人实时协同」打通了。

---

## 四、关键洞察

1. **没有一个工具同时做到「AI 深度可控」+「原生多人实时协同」** —— 这是实际的市场缺口。
2. draw.io 有可编程性但没协同；ProcessOn 有协同但不可增量编程（官方 MCP 是整图覆盖）。
3. 面向需要多人协作的团队场景（共绘一张泳道图）恰好命中最难的组合：语义化增量编辑 + 实时协同 + 中国网络环境。
4. ProcessOn MCP 的 update_diagram 是**覆盖式**的，多人同时编辑时 AI 改一次就覆盖别人的改动 —— 这是硬伤。

---

## 五、对方案的影响

见 docs/2026-11-04-ai-flowchart-design.md
