# 市场快照（2026-11-04 实测/核实）

## 一、价格与能力矩阵

### 国际

| 产品 | 多人实时协同 | AI 能力 | 价格 | 可私有化 |
|---|---|---|---|---|
| draw.io | 仅通过 OneDrive / Google Drive / Nextcloud / Confluence | Generate（文本生成图）+ Mermaid 导入 | 免费；Confluence 应用另付 | 自托管 Docker，但**无协同** |
| Excalidraw | 免费版即「Unlimited collaborators」 | Generate 文本转图；Free 10 次/天，Plus 100 次/天或自带 Key | Free $0；Plus $6/人/月 | 开源 MIT，可自托管 + excalidraw-room |
| Mermaid Chart | 有（team project） | AI 生成 Mermaid | Basic 免费（3 图）；Plus $10/人/月；Premium $20/人/月 | 编辑器开源，协作端不可 |
| Eraser | 有 | DiagramGPT、AI 文档、Maps、Diagramming API | Free；Business $45/人/月（年付）；Business Plus $42 起 10 席 | Enterprise 可谈 |
| tldraw | tldraw sync（可自托管） | @tldraw/ai 模块 | SDK 商业授权，100 天试用，按价值定价 | 可自托管 |
| Miro / Figma / Lucid | 强 | Miro AI / Figma AI / Lucid AI | 需查具体档 | 否 |

### 国内

| 产品 | 多人实时协同 | AI 能力 | 价格 | 可私有化 |
|---|---|---|---|---|
| ProcessOn | **原生强项**（kdocs 内嵌的就是它） | AI 生成思维导图 / 流程图；Mermaid 绘图 | 免费版 ¥0；个人版 **¥159/年**；团队版 **¥259/年/人**；企业版需联系 | 企业版支持私有云/公有云部署 |
| Boardmix 博思白板 | **原生强项** | AI 智能体、AI 生成流程图/思维导图/PPT/文档 | 个人：白板会员 ¥199/年、白板AI会员 ¥288/年、终身 ¥599；团队版会员 **¥240/人/年**、团队版AI会员 **¥340/人/年**（2人起购） | 支持私有化部署 |
| WorkBuddy（CodeBuddy 系） | 不是画图工具，是 AI Agent | 通过 MCP 连 ProcessOn | 个人：标准版 99 元/月（连续包月 70）、高级版 199、旗舰版 999；企业旗舰版 **198 元/人/月** 或 2376 元/人/年；专有云版 316 元/人/月（100 席起） | 专有云企业版 |

## 二、关键判断

### 1. 用户说「WorkBuddy 价格挺贵」——实测并不贵

CodeBuddy/WorkBuddy 国内个人版：
- 标准版 99 元/月，**连续包月 70 元/月**，连续包年 672 元/年
- 积分与 CodeBuddy 共享（同一账号）

贵的是**企业版**：198 元/人/月。个人标准版 ¥70/月 ≈ ¥840/年，跟 ProcessOn 团队版 ¥259/人/年 不在一个量级，但 WorkBuddy 卖的是 AI 编程/办公 Agent，不是画图工具 —— 拿它专为画图不划算。

### 2. ProcessOn 官方有 MCP，但能力有限

`@qqq3qqq/processon-openapi-mcp` v3.1.3（MIT，2026-09 更新）

工具：create_diagram（Mermaid 建图）/ create_mindmap / create_blank_diagram / import_diagram_file（导入 drawio/vsdx/xmind）/ update_diagram（按 fileId **覆盖式**更新）/ check_api_usage

**硬伤：update_diagram 是整图覆盖，多人同时编辑时 AI 一改就盖掉别人的改动。**

### 3. 「AI 深度参与 + 多人实时协同」的实际缺口

- ProcessOn：协同满分，AI 只能「生成一张新图」，不能「读懂并增量修改正在编辑的这张」
- Boardmix：协同满分，AI 同样偏「一键生成」
- Excalidraw：开源 + 免费版无限协作 + imperative API 可编程（updateScene / getSceneElements），是唯一「AI 能真正读写 + 人也在同一张画布上画」的组合
- draw.io：可编程性最强（mxGraph XML 全量读写），但自托管无协同

### 4. 一个被忽视的选项：Excalidraw + Mermaid

Excalidraw 有 `@excalidraw/mermaid-to-excalidraw`，能把 Mermaid 转成**可编辑的原生图形**（不是图片）。
配合 Excalidraw 的 imperative API，可以做到：
- AI 输出 Mermaid → 转成 Excalidraw 元素 → 增量追加到当前画布
- 人继续在同一个画布上拖动、改字、加框
- 通过 excalidraw-room 自托管实现实时协同

这条路的成本远低于自研，且完全可控。
