# 开源/可自托管「多人实时协作 + AI 可编程操控」图表技术栈调研

> 调研日期：2026-11-04 ｜ GitHub star / pushed_at 均取自 GitHub REST API `/repos/{owner}/{repo}` 当日快照 ｜ 目标：团队多人同画布实时协同（类 ProcessOn），且 AI 能读/写/增量改；可能有网络限制私有化

## 0. TL;DR

- **同时满足「原生实时协同 + 完整命令式读写 API + 真开源可商用 + 易私有化」的，只有 Excalidraw。**
- **AI 侧体验最好的是 tldraw**（Agent starter kit、@tldraw/ai），但 License 明确禁止无 License Key 的生产使用，且有技术强制（水印/环境探测），私有化必须买商业授权 —— 硬门槛，不是「注意一下」。
- **draw.io 开源版官方明写「不支持实时协同」**；要协同得自己叠 Yjs（社区 y-mxgraph 只有 11 star），且 embed postMessage 官方标注仅在 embed.diagrams.net 支持。
- **D2 / Mermaid 是「文本即图」**：AI 友好度满分（LLM 直接吐文本），但**零多人协同**，协同要退回 Git。
- **Penpot 是设计工具不是流程图工具**，场景不匹配。现成 MCP 桥：**jgraph/drawio-mcp（官方，Apache-2.0）**、**excalidraw/excalidraw-mcp（仓库无 LICENSE 文件）**、Excalidraw+ 官方 REST API+MCP（商业 SaaS，public beta）。


## 1. 结论速览表

| 项目 | 形态 | License | Star | 最后活跃 | 原生实时协同 | AI 可编程读写 | 私有化 |
|---|---|---|---|---|---|---|---|
| Excalidraw | 白板/图（React 组件） | **MIT** | ~135k | 2026-11-03 | ✅ socket.io 自研协议 | ✅ 命令式 API 完备 | ★★★★★ |
| tldraw | 无限画布 SDK | **tldraw license（非 OSI）** | ~51k | 2026-11-03 | ✅ tldraw sync | ✅✅ 最佳 | ★★★（要付费） |
| draw.io | 成品应用 | **Apache-2.0**（图标/模板另有条款） | ~9.2k | 2026-10-30 | ❌ 官方明示不支持 | ✅ postMessage | ★★★★ |
| React Flow | 库（非产品） | **MIT** | ~38.9k | 2026-11-03 | ❌ 自己搭 | ✅ React state | ★★★★★ |
| D2 | CLI/编译器 | **MPL-2.0** | ~25.8k | 2026-10-11 | ❌ | ✅ 文本 + Go 库 | ★★★★★ |
| Mermaid | 渲染库/CLI | **MIT** | ~91k | 2026-11-03 | ❌ | ✅ 文本 | ★★★★★ |
| Penpot | 设计工具 | **MPL-2.0** | ~62k | 2026-11-03 | ✅ WebSocket | ⚠️ 插件/MCP | ★★★★ |
| LogicFlow | 流程图框架 | **Apache-2.0** | ~11.8k | 2026-10-24 | ❌ | ✅ | ★★★★★ |
| X6 (AntV) | 图编辑引擎 | **MIT** | ~6.8k | 2026-10-23 | ❌ | ✅ | ★★★★★ |
| bpmn-js | BPMN 建模器 | **MIT + 水印条款** | ~9.7k | 2026-10-30 | ❌ | ✅ | ★★★★★ |


## 2. 逐个核实

### 2.1 Excalidraw —— 综合最优解

- 仓库：https://github.com/excalidraw/excalidraw ｜ **License: MIT**（`api.github.com/repos/excalidraw/excalidraw/license` 返回「MIT License, Copyright (c) 2020 Excalidraw」）
- Star ~135,116；pushed 2026-11-03；npm `@excalidraw/excalidraw@0.18.1`（license: MIT）
- **场景数据可编程读写（命令式 API，全部经 `excalidrawAPI` ref 暴露）**：
  - 读：`getSceneElements()` / `getSceneElementsIncludingDeleted()` / `getAppState()` / `getFiles()`
  - 写（增量）：`updateScene({ elements, appState, collaborators })`
  - 其它：`addFiles()` / `history.clear()` / `scrollToContent()` / `refresh()`
  - 装载：`initialData = { elements, appState, scrollToContent, libraryItems, files }`（可为 Promise）
  - 序列化/还原：`serializeAsJSON({elements, appState})` / `restore(data)` / `restoreElements()` / `restoreAppState()` / `restoreLibraryItems()`
  - 导出：`exportToBlob()` / `exportToSvg()` / `exportToCanvas()` / `exportToClipboard()`（png / svg / json）
  - 文档：https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api
- **协同协议：自研，非 yjs/automerge**。`excalidraw/excalidraw-room`（MIT，~540 star，**最后 push 2024-07-12，实质停更**）是 socket.io 房间服务器；`src/index.ts` 事件为 `join-room` / `server-broadcast` / `server-volatile-broadcast` / `client-broadcast` / `room-user-change` / `user-follow`，**消息体是客户端加密后的 `(encryptedData, iv)`**，服务器只见密文。
  - 冲突解决：`reconcileElements()`（`packages/excalidraw/data/reconcile.ts`）按 `version` 大者胜、同版本取 `versionNonce` 小者，再 `orderByFractionalIndex()` 排序 —— **LWW + fractional index，不是 CRDT**，同元素高频并发编辑会丢中间态。持久化官方用 Firebase（仅 excalidraw.com 方案），自托管可换。 
- **自托管难度：低**。前端即一个 React 组件（`npm i @excalidraw/excalidraw`），协同服务器 `yarn && yarn start:dev` 或 pm2 起 Node；无数据库强依赖。
- **中文：✅ 内建**。2024-11 起 Excalifont 加入 **小赖字体（Xiaolai）** 作为 CJK fallback，用 cn-font-split + HarfBuzz 做字体分片懒加载，解决竖排基线偏移 / 换行 / CORS 导出缺字。来源：https://plus.excalidraw.com/blog/adding-hand-drawn-font-for-chinese-japanese-korean
- **导出**：PNG / SVG / JSON（`.excalidraw`）/ 剪贴板位图。
- **生态**：
  - `@excalidraw/mermaid-to-excalidraw`（MIT，~912 star，2026-11-03 活跃）：`parseMermaidToExcalidraw(diagramDefinition, config)` → `{ elements, files }`；v3 起用 Pele 解析布局，支持 flowchart / sequence / class / ER / state，其它类型转成图片贴入。
  - `excalidraw/excalidraw-mcp`（~5.6k star，**无 LICENSE 文件**，README 指向 antonpk1/excalidraw-mcp-app），托管版 `https://mcp.excalidraw.com`。
  - Excalidraw+ 商业版 REST API（`https://api.excalidraw.com/api/v1`，Bearer API Key）+ MCP，**public beta，契约未稳定**：https://plus.excalidraw.com/docs/api

### 2.2 tldraw —— AI 最强，但 License 是硬门槛

- 仓库：https://github.com/tldraw/tldraw ｜ GitHub 识别为 **NOASSERTION**（自定义协议，非 OSI 开源）
- Star ~51,226；pushed 2026-11-03；npm `@tldraw/sync@5.6.0`、`@tldraw/ai@3.15.4`（license 字段均为 `SEE LICENSE IN LICENSE.md`）
- **License 具体条款**（`api.github.com/repos/tldraw/tldraw/license` 原文摘录）：允许 Development Environment 使用、修改、打包进自己的项目、提交改动；**禁止**：「Not to use the Software in **Production Environments**」；Production Environment 定义为「任何生产部署，运行在服务器/云平台/Web 应用上，**或软件被用于向最终用户、客户或公众提供功能**」→ 受限网络给同事用的工具也落在里面。
  - **禁止**：「Not to disable, change, or interfere with the Software's **License Key enforcement**」
  - 「**Technical enforcement**：软件内置技术手段校验 License Key、**探测部署环境**、按 license 类型强制使用限制、并**确保水印正确显示**（ensure proper watermark display）；可能采集并回传使用数据用于合规」。
  - 试用：**100 天** free trial（业务单元限一次）；另有 hobby license；生产需商业授权（https://tldraw.dev/pricing）。治理法：Delaware。README 明写「Production use requires a license key」。
  - ⚠️ 水印的具体形态/尺寸/出现条件 **未确认**（`tldraw.dev/docs/watermark` 抓取只返回导航）。
- **数据读写 API**（Editor 实例）：`editor.getCurrentPageShapes()` / `getCurrentPageShapesSorted()` / `createShapeId()` / `createShapes()` / `updateShapes()` / `getSnapshot()` / `loadSnapshot()` / `editor.store`。文档：https://tldraw.dev/docs/editor ｜ https://tldraw.dev/docs/persistence
- **协同协议：tldraw sync（自研）**，基于 record store 的增量 diff 同步 + WebSocket。官方**不提供托管 SaaS**，必须自己部署：
  - 方式一（推荐）：Cloudflare 模板 —— Durable Objects（每 room 一个 WS server，状态自动持久化到 DO 内置 SQLite）+ R2 存大资源；
  - 方式二：把 `@tldraw/sync-core` 集成进自己的 JS 后端（Node/Bun/自建 WS）。文档：https://tldraw.dev/docs/sync
- **AI 生态（最强）**：Agent starter kit —— 把 Agent 拆成「眼睛」`PromptPartUtil`（喂当前视口截图 + 简化 shape 数据 + 视口外 shape 聚类 + 会话历史）和「手」`AgentActionUtil`（每个 action 自带校验/执行/聊天面板呈现），配 `OPENAI_API_KEY` 即可跑；starter kit 本身 **MIT**。https://tldraw.dev/starter-kits/agent
- **自托管难度：中**。SDK 好装，但生产必须处理 license key + 自建 sync 后端（Cloudflare DO/R2 依赖，纯受限网络要改写）。**中文 ⚠️ 未确认**（支持自定义字体/`assetUrls`，官方未宣称内建 CJK）。**导出**：SVG / PNG + JSON snapshot。

### 2.3 draw.io —— 成熟成品，但协同要自己补

- 仓库：https://github.com/jgraph/drawio ｜ **License: Apache-2.0**（`raw.githubusercontent.com/jgraph/drawio/dev/LICENSE` 确认为标准 Apache 2.0 全文）
- Star ~9,163；pushed 2026-10-30。桌面版 `jgraph/drawio-desktop` 是 **GPL-3.0**（~63.8k star），与 Web 版不同。
- **Apache 授权细节（必读）**：
  - 图标集 / stencil 库 / 模板**另有条款**：不得作为软件资产用于、分发到、或并入 **Atlassian 产品及 Atlassian marketplace/插件生态**的产品（含「以这些图标为参考或训练输入生成的 AI 图像」）。**不适用于最终用户的图表产物**（导出的图片/文档）。
  - 部分图标为第三方版权，已核验兼容 Apache 2.0（无 GPL/AGPL 依赖）。
  - 官方声明「we make no copyright claim on diagrams you create」。
  - **不接受 PR**，核心团队闭门开发。商标：draw.io 为 EU 注册商标（#018062448），不得暗示关联/背书。
- **实时协同：❌ 官方明示不支持**。README 原文：「Note that draw.io does not support real-time collaborative editing in this version, currently.」且「This repository is a test version ... A paid production version is available for production deployments.」→ 真要协同，社区方案是 **`mizuka-wu/y-mxgraph`**（MIT，Yjs binding for draw.io/mxGraph，支持 y-websocket / y-webrtc + iframe bridge，**但仅 11 star、2026-09 最后 push，属实验品**）。
- **embed postMessage API（能力清单，已逐条核实）**：`?embed=1&proto=json`，iframe 内编辑器与宿主通过 postMessage 交换 JSON。⚠️ 官方写明「This mode is only supported on `https://embed.diagrams.net`」—— **自托管实例是否被官方支持：未确认**（实践可用，但不在承诺范围）。
  - 事件（编辑器 → 宿主）：`init` / `ready` / `autosave` / `save` / `saveAndExit` / `export` / `merge` / `getDiff` / `dialog` / `prompt` / `template` / `status` / `zoomEvents` / `scrollWheel` / `shortcut`
  - 动作（宿主 → 编辑器）：`load`（含 `xml` / `autosave` / `modified` / `title` / `zoomEvents` 参数）、`merge`、`getDiff`、`export`、`dialog`、`prompt`、`template`、`status`、`configure`
  - **增量改的关键**：`{action:'merge', xml}` 把一段 XML 合并进当前图；`{action:'getDiff'}` 返回 `{event:'getDiff', patch:{...}, checksum:'...'}`（checksum 失配时用 `xml` 全量重同步）。导出格式：`xml`（最快，仅取状态）/ `svg` / `xmlsvg` / `png` / `xmlpng`（可带 `withSvg`）。文档：https://www.drawio.com/doc/faq/embed-mode
- **数据格式**：mxGraph XML（`<mxGraphModel><root><mxCell .../></root></mxGraphModel>`），LLM 直接产出该 XML 已成熟（drawio-mcp 即如此）。`?offline=1` 可关云存储。
- **自托管难度：低**。`docker run -it --rm -p 8080:8080 -p 8443:8443 jgraph/drawio`，访问 `http://localhost:8080/?offline=1`（https://github.com/jgraph/docker-drawio）。注意 export-server 镜像已 EOL。
- **中文：✅** 用系统字体渲染，中文正常；导出 SVG 建议开 `embedSvgFonts` 保证字形。
- **导出**：XML / PNG / SVG / PDF / HTML / VSDX。

### 2.4 React Flow / @xyflow/react —— 是库，不是产品

- 仓库：https://github.com/xyflow/xyflow ｜ **MIT** ｜ ~38,886 star ｜ pushed 2026-11-03 ｜ npm `@xyflow/react@12.12.1`（MIT）
- **没有内建协同**。官方示例 `examples/interaction/collaborative` 直接依赖 **yjs + y-websocket**（页面内可抓到这两个包名）。
- 数据模型：`nodes: Node[]` / `edges: Edge[]` + `onNodesChange` / `applyNodeChanges` / `useNodesState` / `useReactFlow()`。**天然可序列化 → AI 直接读写 nodes/edges 数组即可**，最「程序友好」的一档。
- **yjs + y-websocket 成熟度**：
  - `yjs/yjs` ~23,020 star（GitHub 标 NOASSERTION，实为 MIT），pushed 2026-11-02；
  - `yjs/y-websocket` ~715 star，MIT，pushed 2026-10-28；README 明说自带的是「simple in-memory backend，**不能轻易水平扩展**」，生产建议 `@y/hub` / hocuspocus / y-sweet；
  - `ueberdosis/hocuspocus` ~2,643 star，MIT，pushed 2026-11-03 —— Node 端生产级选择。
- 坑：协同**完全自己写**（光标感知、离线、权限、冲突语义都得自定），工期 2-4 周起步；可控性最高。

### 2.5 D2 / Terrastruct —— 文本即图，无协同

- 仓库：https://github.com/d2lang/d2 （**原 `terrastruct/d2` 已 301 重定向至此**）｜ **MPL-2.0** ｜ ~25,786 star ｜ pushed 2026-10-11
- 形态：CLI 编译器 + Go 库（`d2lib`）+ npm `@d2lang/d2`（WASM）；独立开源项目，由 Hack Club 财政赞助。
- **watch mode**：`d2 --watch in.d2 out.svg`（README 原文），改文件即重渲染 —— 唯一的「实时」。**协同：❌ 没有**，只能退回 Git（文本 diff 友好，反而是优点）。
- 导出：**SVG / PNG / GIF / PDF / PPTX**。
- 字体：默认 Source Sans Pro；**中文需自定义字体**（`d2renderers/d2fonts`），否则缺字 —— 国内落地最常见的坑。
- 对 AI：**极友好**（LLM 直接吐 D2 文本），但「AI 增量改图」= 改文本再全量重排，布局会跳，人正在看的时候体验差。

### 2.6 Mermaid —— 渲染器，不是编辑器

- `mermaid-js/mermaid`：**MIT**，~91,002 star，pushed 2026-11-03。`mermaid-js/mermaid-live-editor`：**MIT**，~6,887 star，pushed **2026-11-04**（当天）。
  - 自托管：`docker run --platform linux/amd64 -p 8000:8080 ghcr.io/mermaid-js/mermaid-live-editor`；或 `docker compose up --build` → `http://localhost:3000`。⚠️ 官方镜像**无法用环境变量覆盖配置**（要改就得自己 build），且默认把 PNG/SVG 渲染外包给 `mermaid.ink` 与 `kroki.io` —— **受限网络部署必须在 build 时把 `MERMAID_RENDERER_URL` / `MERMAID_KROKI_RENDERER_URL` 指到自建实例或置空**，否则图内容出网。**协同 ❌**：「分享」只是把图定义编码进 URL，无房间、无光标、无合并。
- `mermaid-js/mermaid-cli`：**MIT**，~5,149 star，pushed 2026-11-02，批处理渲染（中文需系统装中文字体）。
- 结论：适合做**「AI 生成 → 人确认」的单向管线**，或作为 Excalidraw/draw.io 的**输入格式**（mermaid-to-excalidraw、drawio-mcp 都吃 Mermaid）。

### 2.7 Penpot —— 设计工具，不是流程图白板

- 仓库：https://github.com/penpot/penpot ｜ **MPL-2.0** ｜ ~62,032 star ｜ pushed 2026-11-03 ｜ 后端 **Clojure**
- 协同：✅ 真·实时（WebSocket + 后端变更广播）。架构 = 前端 SPA + Clojure 后端 + **PostgreSQL** + Redis + Exporter；有 Docker/K8s 自托管（https://penpot.app/self-host）。
- **但**：画布是**设计画布**（board / layer / component / design token），**没有流程图语义**（无节点-连线模型、无自动布局、无流程图形状库）。用它做流程图 = 把矩形和线当图形摆，AI 想「增量改这张流程图」没有结构化对象可操作。
- AI 侧：有 MCP server（https://penpot.app/ai/mcp-server）与插件体系，走「设计稿 → 代码」路线，非「图数据 CRUD」。中文 ✅ 可传自定义字体；导出 SVG / PNG / PDF / JSON。
- **判定：场景不匹配，不推荐作为流程图底座。**

### 2.8 其他值得看的

| 项目 | License | Star | 活跃 | 协同 | 读写 API | 备注 |
|---|---|---|---|---|---|---|
| `bpmn-io/diagram-js` | MIT | ~1,929 | 2026-10-30 | ❌ | ✅ 命令栈/建模器 API | bpmn-js 的底座，抽象干净 |
| `bpmn-io/bpmn-js` | **MIT + 水印条款** | ~9,720 | 2026-10-30 | ❌ | `viewer.importXML(xml)` / `modeler.saveXML()` | LICENSE 原文：**「The source code responsible for displaying the bpmn.io project watermark that links back to https://bpmn.io MUST NOT be removed or changed」** —— 去水印违约 |
| `didi/LogicFlow` | **Apache-2.0** | ~11,766 | 2026-10-24 | ❌ | `lf.render(data)` / `lf.addNode()` / `lf.getGraphData()`（render 已在 README 确认；其余来自官方 API 文档，站点为 SPA 未能抓全文 → 名称部分**未逐字核实**） | 滴滴开源，中文文档最全，**业务流程图/审批流**最贴国内需求 |
| `antvis/X6` | MIT | ~6,751 | 2026-10-23 | ❌ | `graph.fromJSON(data)` / `graph.toJSON()` / `graph.addNode()` / `graph.use(plugin)`（fromJSON/use 已在官方 tutorial 抓到） | 蚂蚁，图编辑引擎，扩展性强 |
| `bcakmakoglu/vue-flow` | MIT | ~6,931 | **2026-07-14** | ❌ | v-model + composables | Vue 版 React Flow，**近 4 个月未 push，留意维护节奏** |
| `clientIO/joint` | **MPL-2.0 核心 / JointJS+ 商业** | ~5,397 | 2026-11-03 | ❌ | `graph.fromJSON()` / `toJSON()` | 核心开源够用，高级功能（导图/工具条）在付费版 |
| `NorthwoodsSoftware/GoJS` | **商业**（npm 4.0.5，`SEE LICENSE IN license.html`） | ~8,502 | 2026-10-02 | ❌ | 完备 | 闭源商业，按开发者授权，**排除** |
| `yjs/yjs` | MIT（GitHub 标 NOASSERTION） | ~23,020 | 2026-11-02 | ✅ 底座 | Y.Map / Y.Array / Y.Text | 协同的事实标准 |
| `mizuka-wu/y-mxgraph` | MIT | **11** | 2026-09-26 | ✅（给 draw.io） | Yjs binding + iframe bridge | **实验品，别压生产** |

**BPMN 实时协作的真相**：bpmn-js / diagram-js 本身**没有**协同层，Camunda 生态的协同要么是 Camunda 8 商业产品，要么自己叠 Yjs（社区零散 demo，无成熟库）。「BPMN + 实时协作 + 开源」目前是**空档**。

### 2.9 AI ↔ 图 的桥（现成 MCP / 成熟管线）

| 桥 | 仓库/地址 | License | Star | 活跃 | 能力 |
|---|---|---|---|---|---|
| **draw.io 官方 MCP** | https://github.com/jgraph/drawio-mcp | **Apache-2.0** | ~5,766 | 2026-11-02 | 4 种形态：MCP App Server（`mcp.draw.io` 托管，聊天内联渲染）/ MCP Tool Server（npm，开浏览器编辑）/ 助手插件（生成 `.drawio`/`.png`/`.svg`/`.pdf`）/ 纯提示词。**支持 XML、CSV、Mermaid 输入** |
| **Excalidraw MCP** | https://github.com/excalidraw/excalidraw-mcp | **无 LICENSE 文件（未确认）** | ~5,634 | **2026-03-24（半年未动）** | MCP App Server，流式画 Excalidraw + 镜头控制 + 全屏编辑；托管 `https://mcp.excalidraw.com` |
| **Excalidraw+ REST API + MCP** | https://plus.excalidraw.com/docs/api | 商业 SaaS | — | public beta | `https://api.excalidraw.com/api/v1`，Bearer API Key，可编程操作 scenes/collections/users；官方声明契约未稳定，且是 SaaS 不是自托管 |
| **tldraw Agent starter kit** | https://tldraw.dev/starter-kits/agent | starter kit 为 MIT | — | 活跃 | 最完整的「AI 读写画布」参考实现（眼睛 + 手 + 模式） |
| **mermaid-to-excalidraw** | https://github.com/excalidraw/mermaid-to-excalidraw | MIT | ~912 | 2026-11-03 | LLM 吐 Mermaid → 变成可编辑的 Excalidraw 元素（不是贴图） |
| **Penpot MCP** | https://penpot.app/ai/mcp-server | — | — | — | 设计稿维度，非流程图 |

**成熟度判断**：LLM 直接产出 **drawio XML** 与 **Mermaid** 最稳（格式简单、训练数据多、有官方 MCP）；**Excalidraw JSON** 次之（元素字段多，建议用 `restore()` 归一而非手拼）；**tldraw** 框架最好但没有免费生产许可。


## 3. 技术选型评分表（1-5，越高越好）

| 维度 | Excalidraw | tldraw | draw.io(+y-mxgraph) | React Flow+yjs | D2 | Mermaid | Penpot | LogicFlow | X6 |
|---|---|---|---|---|---|---|---|---|---|
| 多人实时协同 | **5** | **5** | 2 | 3（自建，可控） | 1 | 1 | 4 | 2 | 2 |
| AI 可编程读写 | **5** | **5** | 4 | **5** | 4 | 4 | 2 | 4 | 4 |
| 私有化 | **5** | 3（要买授权） | **5** | **5** | **5** | **5** | 4 | **5** | **5** |
| 中文 | **5**（内建小赖体） | 3（未确认，需自测） | **5** | **5** | 2（需配字体） | 4 | 5 | **5** | **5** |
| 上手成本（高=省事） | **4** | 3 | 3 | 2 | **5** | **5** | 2 | 3 | 2 |
| 长期维护风险（高=风险低） | **4** | 3（License 变更史） | 3（官方不做协同/不收 PR） | 4 | **5** | **5** | 4 | 4 | 4 |
| **合计** | **28** | 22 | 22 | 24 | 22 | 24 | 21 | 22 | 22 |

> tldraw 的「私有化」3 分不是技术难度，而是**法律+技术双重门槛**（License Key 强制、水印、环境探测）。


## 4. 推荐前 2 名

### 🥇 第一名：Excalidraw（+ 自建协同后端）

**理由**
1. **MIT，无商用/水印/环境探测限制** —— 私有化零法律摩擦，这是本项目唯一的不可谈判项。
2. **命令式 API 四家里最完整**：读（`getSceneElements`）、写（`updateScene`）、增量（只传变化的 elements）、导出（`exportToBlob`/`exportToSvg`）全有，AI 可以「看一步、改一步」而不是每次重画整张图。
3. **协同现成**：`excalidraw-room` 起一个 Node 就行，且**消息端到端加密**（服务器只见密文），受限网络合规友好。
4. **中文已内建**：小赖字体 + 分片懒加载，不用自己折腾 CJK。
5. **Mermaid 直通**：LLM 吐 Mermaid → `parseMermaidToExcalidraw` → 变成**可继续编辑的原生元素**（不是一张图），把「AI 生成」和「人继续改」无缝接上。

**坑（必须提前认）**
- **`excalidraw-room` 最后 push 是 2024-07-12，实质停更**。协议简单（socket.io + 广播），要么接受「自己维护一个 300 行服务器」，要么换 yjs 重写协同层（社区有方案，非官方）。
- **协同不是 CRDT**：`reconcileElements` 是 version/versionNonce 的 LWW + fractional index。两人同时拖同一元素，后提交的赢、中间态丢失；同段落并发编辑文字会覆盖。「各改各的节点」没问题，「两人抢同一个框」会感知到。
- **元素字段多且强校验**：手拼 element 极易因缺字段被静默丢弃，**务必走 `restore()` / `restoreElements()` 归一**。
- **`updateScene` 部分字段不触发 store/history**（官方文档明说），撤销栈可能对不上 AI 的改动 —— 需自己做「AI 操作 = 一个 undo 组」。
- Excalidraw+ 的 REST API/MCP 是**商业 SaaS**，自托管用不上；`excalidraw-mcp` 仓库**没有 LICENSE 文件**，商用前要问清。

### 🥈 第二名：tldraw（愿意付授权费时的最优体验）

**理由**
1. **AI 集成四家里做得最深**：Agent starter kit 把「看」（截图 + 结构化 shape + 视口外聚类）和「改」（带校验的 action 系统）都抽象好了，`@tldraw/ai` 直接可用。
2. **协同是产品级的**：record store 级增量 diff + 官方 Cloudflare 模板，就是 tldraw.com 在跑的那套；自托管路径官方明确支持。
3. **数据模型最干净**：shape record 是结构化对象，AI 改「某个框的文案」= 改一条 record 的一个字段，天然增量。

**坑（比第一名重得多）**
- **License 是硬门槛**：自定义协议明确**禁止 Production Environment 无 Key 使用**，而 Production Environment 定义涵盖「向最终用户/客户提供功能」—— **受限网络工具也算**。生产必须买商业授权。
- **技术强制**：内置 License Key 校验、**部署环境探测**、**水印显示**，且**禁止绕过**。「偷偷去水印」= 直接违约。
- **自托管不是开箱**：官方推荐 Cloudflare（Durable Objects + R2），**纯受限网络/信创环境要重写成自己的 WS + 存储**，工作量不小。
- **License 有变更史**（早期 Apache-2.0 → 自定义协议），未来条款仍有变动风险。
- **中文支持未确认**，需自测字体。

### 第三备选：draw.io + 自研 Yjs 层
Apache-2.0 干净、mxGraph XML 对 LLM 极友好、Docker 一条命令、国内认知度最高。代价是**协同要从零搭**（y-mxgraph 仅 11 star，不能压生产），embed 模式在自托管实例上官方未背书。


## 5. 可直接用的代码片段

### 5.1 Excalidraw：AI 读 → 增量改 → 导出

```tsx
// npm i @excalidraw/excalidraw react react-dom
import { useRef, useCallback } from "react";
import { Excalidraw, restoreElements, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
export default function Board({ initial, onRemote }) {
  const api = useRef(null);
  // —— 读：把画布现状喂给 LLM ——
  const readScene = useCallback(() => {
    const elements = api.current.getSceneElements();       // 不含已删除
    const appState  = api.current.getAppState();
    return {
      elements: elements.map(e => ({
        id: e.id, type: e.type, x: e.x, y: e.y,
        width: e.width, height: e.height,
        text: e.text ?? "",            // 文本类元素
        containerId: e.containerId ?? null,
      })),
      viewport: { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom },
    };
  }, []);
  // —— 写：AI 只给「新增/修改的那几个元素」，其余保留 ——
  const applyAiPatch = useCallback((patchElements, { removeIds = [] } = {}) => {
    const cur = api.current.getSceneElements();
    const keep = cur
      .filter(e => !removeIds.includes(e.id))
      .filter(e => !patchElements.some(p => p.id === e.id));   // 同 id 以 patch 为准
    // 关键：手拼的元素必须过 restoreElements 归一，否则会被静默丢弃
    const normalized = restoreElements(
      [...keep, ...patchElements],
      null,                                  // localElements
      { repairBindings: true, normalizeTextHeights: true },
    );
    api.current.updateScene({ elements: normalized });
  }, []);
  // —— 导出：给用户下载 / 回传给 LLM 做视觉判断 ——
  const exportPng = useCallback(async () => {
    const blob = await exportToBlob({
      elements: api.current.getSceneElements(),
      appState: { ...api.current.getAppState(), exportBackground: true },
      files: api.current.getFiles(),
      mimeType: "image/png",
      quality: 1,
    });
    return blob;   // 可直接 URL.createObjectURL 下载
  }, []);
  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <Excalidraw
        excalidrawAPI={(a) => (api.current = a)}
        initialData={initial}                 // { elements, appState, files, scrollToContent: true }
        onChange={(els, state) => onRemote?.(els)}   // 推给协同服务器
        langCode="zh-CN"
      />
    </div>
  );
}
```

**协同侧（对接 excalidraw-room）**：`onChange` 拿到 elements → 与上次快照 diff → 只把变化的元素（带 `version`/`versionNonce`）加密后 `socket.emit("server-broadcast", roomId, encrypted, iv)`；收到 `client-broadcast` 解密后走 `reconcileElements()`（`@excalidraw/excalidraw/data/reconcile`）再 `updateScene`。

### 5.2 Excalidraw：LLM 吐 Mermaid → 变成可编辑元素

```ts
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { restore } from "@excalidraw/excalidraw";
const mmd = `flowchart TD
  A[用户下单] --> B{库存充足?}
  B -->|是| C[创建订单]
  B -->|否| D[通知补货]
  C --> E[支付]`;
const { elements, files } = await parseMermaidToExcalidraw(mmd, {
  themeVariables: { fontSize: "20px" },
  elbow: true,          // 直角折线箭头
  maxEdges: 500,
});
// 必须 restore 才能进画布（补全 version/versionNonce/seed 等字段）
const restored = restore({ elements, appState: null, files }, null, null);
api.updateScene({ elements: restored.elements, appState: { files: restored.files } });
```

### 5.3 tldraw：读写 + 增量改（注意 License）

```tsx
// npm i tldraw            ← 生产环境需 license key，否则违约 + 水印
import { Tldraw, createShapeId, toRichText } from "tldraw";
let editor;
<Tldraw
  persistenceKey="flow-1"                 // 本地持久化；生产接 @tldraw/sync
  onMount={(e) => { editor = e; }}
/>;
// —— 读 ——
const shapes = editor.getCurrentPageShapes();        // Shape[]，结构化对象
const snapshot = editor.getSnapshot();               // 可 JSON 化存档
// —— 增量写：新增一个矩形节点 ——
const id = createShapeId();
editor.createShapes([{
  id,
  type: "geo",
  x: 120, y: 80,
  props: { geo: "rectangle", w: 220, h: 90, richText: toRichText("用户下单") },
}]);
// —— 增量写：只改一个字段 ——
editor.updateShapes([{
  id,
  type: "geo",
  props: { richText: toRichText("用户下单（已校验）") },
}]);
// —— 全量还原 ——
editor.loadSnapshot(snapshot);
```

### 5.4 draw.io：postMessage 读写 + merge 增量

```html
<!-- 自托管: docker run -p 8080:8080 jgraph/drawio  →  http://localhost:8080/?offline=1 -->
<iframe id="dr" style="width:100%;height:100vh;border:0"
  src="http://localhost:8080/?embed=1&proto=json&spin=1&modified=1&noSaveBtn=1&saveAndExit=0&noExitBtn=1"></iframe>
<script>
const iframe = document.getElementById("dr");
let latestXml = "";
window.addEventListener("message", (ev) => {
  if (ev.source !== iframe.contentWindow) return;
  const msg = JSON.parse(ev.data);
  switch (msg.event) {
    case "init":                                  // 编辑器就绪
      iframe.contentWindow.postMessage(JSON.stringify({
        action: "load",
        xml: window.__INITIAL_XML__ || "",
        autosave: 1,                              // 开启变更回传
      }), "*");
      break;
    case "autosave":                              // 每次改动回传全量 XML
      latestXml = msg.xml;
      // 做 diff 后只把变化推给协同层
      break;
    case "merge":                                 // 增量合并结果
      if (msg.error) console.warn("merge failed", msg.error);
      break;
    case "getDiff":                               // 增量补丁（协同用）
      // msg.patch / msg.checksum；checksum 失配时用 msg.xml 全量重同步
      break;
  }
});
// —— AI 增量改图：只发新增节点的 XML 片段，merge 进去 ——
function aiAddNodes(deltaXml) {
  iframe.contentWindow.postMessage(JSON.stringify({
    action: "merge",
    xml: deltaXml,     // 例如 <mxGraphModel><root>…新增的 mxCell…</root></mxGraphModel>
  }), "*");
}
// —— 导出（拿当前状态的 SVG / XML）——
function exportSvg() {
  iframe.contentWindow.postMessage(JSON.stringify({
    action: "export", format: "xmlsvg", spinKey: "exp",
  }), "*");
}
</script>
```

> ⚠️ 官方文档写明 embed 模式仅在 `https://embed.diagrams.net` 支持；自托管实例可用但**不在官方承诺范围**，上线前务必自测。

### 5.5 React Flow + Yjs：自己搭协同的最小骨架

```ts
// npm i @xyflow/react yjs y-websocket
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { useNodesState, useEdgesState } from "@xyflow/react";
const doc = new Y.Doc();
const provider = new WebsocketProvider("ws://localhost:1234", "flow-room-1", doc);
const yNodes = doc.getMap("nodes");   // id -> Node
const yEdges = doc.getMap("edges");   // id -> Edge
// 远端 → 本地
yNodes.observe(() => setNodes(Array.from(yNodes.values())));
// 本地 → 远端（只写变化的那个节点）
function moveNode(id, position) {
  doc.transact(() => {
    const n = yNodes.get(id);
    if (n) yNodes.set(id, { ...n, position });   // 粒度到「节点」，避免整图覆盖
  });
}
```

> 生产别用 `y-websocket` 自带内存后端（README 明说不能水平扩展），换 **hocuspocus**（MIT，~2.6k star，2026-11-03 活跃）。

### 5.6 LogicFlow / X6：国内流程图的读写法

```ts
// LogicFlow (Apache-2.0, 滴滴)
import LogicFlow from "@logicflow/core";
const lf = new LogicFlow({ container: document.querySelector("#app"), grid: true });
lf.render({ nodes: [{ id: "n1", type: "rect", x: 100, y: 100, text: { value: "审批" } }], edges: [] });
lf.addNode({ type: "rect", x: 300, y: 100, text: { value: "归档" } });
const data = lf.getGraphData();          // { nodes, edges } ← AI 直接吃这个 JSON
// X6 (MIT, 蚂蚁)
import { Graph } from "@antv/x6";
const graph = new Graph({ container: document.getElementById("app") });
graph.fromJSON({ nodes: [{ id: "n1", x: 40, y: 40, width: 120, height: 40, label: "审批" }], edges: [] });
graph.addNode({ x: 240, y: 40, width: 120, height: 40, label: "归档" });
const json = graph.toJSON();             // ← AI 直接吃这个 JSON
```

### 5.7 D2：AI 吐文本 → 渲染

```bash
d2 --watch flow.d2 flow.svg          # 改文件即重渲染（没有多人协同）
d2 --theme 200 --layout elk flow.d2 out.png   # 导出支持 svg/png/gif/pdf/pptx
```


## 6. 未确认清单（落地前必须自己验）

| # | 事项 | 状态 |
|---|---|---|
| 1 | draw.io **embed 模式在自托管实例**上是否被官方支持 | 文档只写 embed.diagrams.net，**未确认** |
| 2 | tldraw **水印的具体形态/尺寸/出现条件** | 文档页抓取失败，**未确认**（License 原文只写「确保水印正确显示」） |
| 3 | tldraw **内建中文字体** | 文档未提，**未确认**，需自测 |
| 4 | `excalidraw/excalidraw-mcp` 的**许可证** | 仓库无 LICENSE 文件，**未确认** |
| 5 | LogicFlow `addNode` / `getGraphData` 的精确签名 | 官网 SPA 未抓到全文，**名称待逐字核实**（`lf.render` 已在 README 确认） |
| 6 | Penpot 是否有真正意义上的「白板/流程图」能力 | 未找到官方白板功能页，**未确认** |
| 7 | bpmn-js 生态里是否有**生产级** Yjs 协同库 | 未找到成熟库，**疑似空档** |
| 8 | Excalidraw `convertToExcalidrawElements` 的 skeleton 字段全集 | 文档页存在（Creating Elements programmatically），**未逐字核实**，建议以 `restore()` 兜底 |


## 7. 来源（正文已逐条内嵌，此处为索引）

**License / 元数据**：github.com/excalidraw/excalidraw ｜ api.github.com/repos/excalidraw/excalidraw/license ｜ github.com/tldraw/tldraw ｜ api.github.com/repos/tldraw/tldraw/license ｜ github.com/jgraph/drawio ｜ raw.githubusercontent.com/jgraph/drawio/dev/LICENSE ｜ github.com/jgraph/docker-drawio ｜ github.com/bpmn-io/bpmn-js/blob/develop/LICENSE ｜ jointjs.com/license ｜ tldraw.dev/pricing

**API / 文档**：docs.excalidraw.com/docs/@excalidraw/excalidraw/api/{props/excalidraw-api, props/initialdata, utils/export, utils/restore} ｜ drawio.com/doc/faq/embed-mode ｜ tldraw.dev/docs/{sync, editor, persistence} ｜ tldraw.dev/starter-kits/agent ｜ reactflow.dev/examples/interaction/collaborative ｜ x6.antv.antgroup.com/en/tutorial/basic/graph ｜ d2lang.com

**协同 / 生态**：github.com/{excalidraw/excalidraw-room, yjs/y-websocket, ueberdosis/hocuspocus, mizuka-wu/y-mxgraph, mermaid-js/mermaid-live-editor, excalidraw/mermaid-to-excalidraw} ｜ plus.excalidraw.com/blog/adding-hand-drawn-font-for-chinese-japanese-korean ｜ help.penpot.app/technical-guide/developer/architecture/ ｜ penpot.app/ai/mcp-server

**AI 桥**：github.com/jgraph/drawio-mcp ｜ drawio.com/mcp/ ｜ github.com/excalidraw/excalidraw-mcp ｜ plus.excalidraw.com/docs/api