# AI + 团队实时协作：流程图/白板工具全景调研

> 调研日期：2026-11-04 ｜ 口径：面向需要多人协作的团队场景（可能有受限网络或私有化部署要求），当前在同一画布上多人实时协作绘图，评估「AI 深度参与 + 多人实时协同同一画布」的替代/升级方案。
> 汇率口径：USD→CNY 按 1:7.1 折算，仅用于横向对比，标注「折」。所有价格以官网当期页面为准，促销价与刊例价分开写。

---

## 0. 一句话结论

**市面上真正把「多人实时协同同一张画布」和「AI 能读懂这张画布并对话式改图」同时做成的，只有 5 家：ProcessOn、Boardmix、Miro、Eraser、draw.io（自配模型）**。其余绝大多数产品是「贴了个 AI 生成按钮」——AI 只负责一次性吐出一张图，之后改图还得回到手工拖拽。对「数据不出受限网络 + 多人同一张图」的硬约束，**ProcessOn 私有化/信创版是当前唯一不需要翻墙、不需要数据出境的完整解**；draw.io 自建 + 接自有大模型是零授权成本的备选。

---

## 1. 判定口径

价格/能力取自**官网当期页面**（2026-11-04 抓取），二手来源单独标注。**AI 深度**分三档（本报告核心维度）：**L3 对话式改图**＝AI 持有当前画布的图元结构（DSL），能执行「把审核失败分支补一个重新提交步骤」这类局部修改，输出仍可编辑；**L2 生成后可续改**＝出的是可编辑图元，但改图主要靠手工；**L1 一次性生成**＝出图即结束，改图等于重画。**多人实时协同**只算「同一张图上多光标同时编辑」，不算各自画完合并、也不算评论/@。

---

## 2. 国际阵营

### 2.1 draw.io / diagrams.net —— 唯一「免费 + 可完全自建 + AI 可接自有模型」的

- 官网：https://www.drawio.com/ ｜在线版 https://app.diagrams.net/
- **多人实时协同：✅ 原生支持**，实时协同默认开启，可在 Extras > Settings 关闭（[官方文档](https://www.drawio.com/docs/manual/collaboration/concurrent-editing)）。
- **AI 能力：L2→L3（取决于你配的模型）**。官方内置 Generate 对话框，本质是聊天窗口：可 attach 当前文件/页面/选区，AI 返回修改后的图（[官方文档](https://www.drawio.com/docs/reference/diagram-generation/configure-ai-options/)）。关键配置项：
  - `gptApiKey` / `geminiApiKey` / `claudeApiKey` / `gptUrl`：**可以指向自建/受限网络 LLM**，这是受限网络场景的决定性优势。
  - `aiActions` 设为空数组即可**彻底关闭 AI**（合规场景）。
  - 注意：Confluence Cloud / Jira Cloud 的 Forge 版因 CSP 限制，**不支持自定义 AI 后端**。
- **生态 AI 插件/MCP：✅ 有官方 MCP Server**（[jgraph/drawio-mcp](https://github.com/jgraph/drawio-mcp)，5.8k star），提供 4 种接入方式：MCP App Server（托管在 mcp.draw.io，无需安装）、MCP Tool Server（npm 包）、助手插件（Claude Code / Codex CLI / Copilot / Cursor）、纯提示词方案。支持 XML / CSV / Mermaid 三种输入。
- **价格：¥0**。桌面版免费，Web 版免费；付费项只有 Confluence/Jira 应用（未在本报告范围）。
- **国内可用性：✅ 直连可用**（实测 app.diagrams.net 正常打开）。无账号体系也能用。
- **私有化部署：✅ 完全支持**（开源 + Docker 自建），数据与模型都可不出受限网络。

### 2.2 Eraser.io —— 国际阵营里 AI 最「深」的一家

- 官网：https://www.eraser.io/ ｜DiagramGPT 免费版 https://www.eraser.io/diagramgpt
- **多人实时协同：✅** 定价页 Collaboration 区块明列 "Real-time collaboration: Included"（全档位）。
- **AI 能力：L3**。产品线：AI diagrams（画布上 AI 生成）、Eraserbot（从代码库自动生成并**持续更新**架构图）、Diagram-as-code、Diagramming API、**MCP client + MCP server 双向**、AI documents（技术文档与图联动）。DiagramGPT 提供 30+ 专用生成器（Flowchart / BPMN / C4 / ERD / 时序 / 网络…）。
- **价格（[官网](https://www.eraser.io/pricing)，按年付）**：
  | 档位 | 价格 | AI 额度 | 关键限制 |
  |---|---|---|---|
  | Free | $0 | 3 credits | 3 个文件、7 天历史 |
  | Business | **$45/人/月**（月付 $60） | 100 credits/月 | 无限文件、私有文件、Git 集成 |
  | Business Plus | $42/人/月，**最少 10 席** | 250 credits/月 | SAML SSO、租户级数据源 |
  | Enterprise | 定制 | 无限 | **custom hosting**、SCIM、SIEM |
  - 折算：Business ≈ **¥320/人/月**。这是全场最贵的之一。
- **国内可用性：⚠️ 需国际网络**（未实测，按同类 SaaS 推断）；支付需国际信用卡。
- **私有化部署：⚠️ 仅 Enterprise 档的 "custom hosting"**，非标准私有化产品，需谈。

### 2.3 Mermaid Chart（mermaidchart.com → mermaid.ai）

- 官网：https://mermaid.ai/ （原 mermaidchart.com 已 301 到 mermaid.ai）
- **多人实时协同：✅ 但**「co-editing」是 **Premium 档才有的能力**（[账号/套餐文档](https://mermaid.ai/docs/workspace-and-admin/manage-your-account)）。Plus 档只有无限图表、无协同编辑。
- **AI 能力：L2**。Mermaid AI 从自然语言生成图 → 进 Editor 改 → 可切到 **Whiteboard**（拖拽式画布）继续定制（[Whiteboard 文档](https://mermaid.ai/docs/guides/whiteboard)）。AI credits：Plus 300/年、Premium 2,000/年。生态极强：Claude MCP App、MCP Server、Cursor/Windsurf/JetBrains/VS Code 插件、Confluence/Jira/Google Docs/Word/PPT 插件。
- **价格（官网定价页，年付）**：Basic 免费（3 张图、15 AI credits）；**Plus $10/人/月**；**Premium $20/人/月**；Enterprise 定制（SSO、IP 管理）。
  - 折算：Plus ≈ ¥71、Premium ≈ ¥142。
- **国内可用性：❌ 实测打不开**。本次调研中 `mermaid.ai` 在浏览器中返回 `ERR_CONNECTION_CLOSED`（同批 `plus.excalidraw.com` 亦同）。需代理。
- **私有化部署：❌ 无**（Enterprise 也只到 SSO/合同级）。

### 2.4 Whimsical AI

- 官网：https://whimsical.com/ ｜定价 https://whimsical.com/pricing
- **多人实时协同：✅** 全档位 "Real-time collaboration: Included"，含 Free。
- **AI 能力：L1~L2**。三个 AI 入口：AI Flowcharts（一句提示词出流程图）、AI Mind Maps、AI Wireframes。免费档每成员 10 AI credits，可单独加购。**AI 是"起点加速器"而非"画布编辑器"**——生成后靠手工调整。
- **价格（年付，[官网](https://whimsical.com/pricing)）**：Free $0；**Pro $10/月/editor**；**Business $20/月/editor**（SSO/SCIM/私有团队/无限历史）。折算 Pro ≈ ¥71、Business ≈ ¥142。Viewer 永久免费不限量。
- **国内可用性：⚠️ 需国际网络**（未实测）。
- **私有化部署：❌ 无**。

### 2.5 Miro AI

- 官网：https://miro.com/ ｜定价 https://miro.com/pricing/
- **多人实时协同：✅ 行业标杆**（无限画布、访客免登录编辑、多人光标）。
- **AI 能力：L2，但生态最开放**。Explore AI：生成图表/表格/摘要、去背景；**AI workflows & agents**（Business 档）可在画布上搭可复用的 AI 流程；**MCP Server**（Starter 500 次/日、Business 2,000 次/日），可让 Claude/Cursor/Copilot 读写画布，也能把 Mermaid 图渲染到画布。
- **价格（年付，[官网](https://miro.com/pricing/)）**：Free $0（3 块可编辑白板）；**Starter $8/人/月**（25 AI credits/人/月）；**Business $20/人/月**（50 AI credits/人/月）；Enterprise 定制（30 人起，可选 EU/US/AU/JP 数据驻留）。
  - 折算：Starter ≈ ¥57、Business ≈ ¥142。
- **国内可用性：⚠️ 需国际网络**；且 Miro 的数据驻留选项**不含中国大陆**。
- **私有化部署：❌ 无**（只有区域数据驻留）。

### 2.6 Figma FigJam AI

- 官网：https://www.figma.com/figjam/ ｜定价 https://www.figma.com/pricing/
- **多人实时协同：✅**（FigJam 白板 + Figma Design 同源协同）。
- **AI 能力：L1~L2**。FigJam AI 可生成模板、图表、整理便签（[帮助中心](https://help.figma.com/hc/en-us/articles/））；Figma 侧有 Figma agent 生成设计方向与图表。**2026 年起 AI 改为 credits 制**：Starter 150 credits/天（上限 500/月）；Professional Full seat +3,000 credits/月。
- **价格（[官网](https://www.figma.com/pricing/)，年付/月付）**：
  | 席位 | Professional | Organization | Enterprise |
  |---|---|---|---|
  | Full seat | $16/月（月付 $20） | $55/月 | $90/月 |
  | Dev seat | $12/月 | — | — |
  | **Collab seat（含 FigJam）** | **$3/月** | — | — |
  - 折算：Full ≈ ¥114；**Collab seat ≈ ¥21**（只用 FigJam 的话这是国际阵营里最便宜的正规协同白板）。
- **国内可用性：⚠️ 需国际网络**；国内团队普遍反馈访问不稳。
- **私有化部署：❌ 无**。

### 2.7 Lucidchart + Lucid AI

- 官网：https://lucid.app/pricing/lucidchart
- **多人实时协同：✅**（Team 档起有 "Call others to me"、版本管理；Enterprise 有 Universal canvas 含 Lucidspark 白板）。
- **AI 能力：L2**。Lucid AI 覆盖图表生成、数据联动（data linking 全档位）、Process Capture、Process Accelerator（Enterprise）。定位偏「企业架构/流程资产」而非「对话改图」。
- **价格**：Free $0（3 个文档、每文档 75 图形）；**Individual $9/月**；**Team $10/人/月**；Enterprise 定制。⚠️ 官网按访问地返回 **JPY** 计价（Individual JP¥1,300、Team JP¥1,500/人/月），USD 数字来自第三方比价站（[costbench](https://costbench.com/software/diagramming/lucidchart/)），**属二手来源，未在官网直接确认**。
- **国内可用性：⚠️ 需国际网络**。
- **私有化部署：❌ 无**。

### 2.8–2.13 其余国际产品（速览，逐项细节见第 5 节总表）

- **Napkin.ai**（[napkin.ai](https://www.napkin.ai/pricing/)）：**无协同画布**，逻辑是「贴文字→生成视觉→导出」。AI 为 L1（credits 按选中字数计）。Free 500 credits/周；Plus $9/人/月；Pro $22/人/月。**国内需代理**（[用户反馈](https://www.xiaohongshu.com/discovery/item/690df079000000000301266d)），无私有化。
- **Creately AI**（[creately.com/plans](https://www.creately.com/plans/)）：协同 ✅（Free 档即有）。AI 为 L2：文本→标准图元、Organize 按语义整理便签、Expand 生成反方观点、Transform 形态互转、从 PDF/Word 抽流程。Pro **$5/editor/月**（≈¥36，国际最便宜付费档）；Business $89/组织/月；Enterprise 定制。官网有 [On-Prem 入口](https://www.creately.com/enterprise/)，交付方式**未确认**。
- **Visual Paradigm AI**（[appstudio 定价](https://appstudio.visual-paradigm.com/pricing/)）：协同 ✅（VP Online；Desktop 为文件级，弱）。AI 偏工程建模（需求→ERD、架构/语法检查、库表即时开通）。VP Online Combo **$15/人/月**、Desktop Pro **$35/人/月**。⚠️ **AI 功能自 2026 起需有效软件维护期**（[release note](https://updates.visual-paradigm.com/pt/releases/ai-features-software-maintenance-requirement-2026-2/)），买断≠能用 AI。桌面版可离线。
- **tldraw**（[tldraw.dev/pricing](https://tldraw.dev/pricing)）：**不是终端产品，是无限画布 SDK**，multiplayer sync 内置，商业授权按价值定价 + 100 天试用。**自研受限网络画图工具的最省事底座**，但 AI 与服务端要自己做。
- **Excalidraw / Excalidraw+**：开源免费手绘风；商用托管版 **$6/人/月（年付）/ $7（月付）**（[定价页](https://plus.excalidraw.com/pricing)，⚠️ 该域名本次实测 `ERR_CONNECTION_CLOSED`，数字来自官方页摘要与[第三方比价](https://costbench.com/software/diagramming/excalidraw/)）。协同 ✅（端到端加密房间）；AI 为 L2：Text-to-Diagram（含 Mermaid）、Autoshape 手绘转规整、MCP、REST API（[AI 页](https://plus.excalidraw.com/ai)）。可开源自建。
- **Terrastruct D2**（[d2lang.com](https://d2lang.com/)）：**diagram-as-code，无同画布协同**（靠 Git）。D2 开源 ¥0；商业版第三方报 $20/人/月（[costbench](https://costbench.com/software/diagramming/terrastruct/)），⚠️ 官网未直接确认。可完全自建。
- **Google Gemini in Docs 画图**：2026-07 起可在文档正文旁创建/编辑示意图与信息图，文字改动后同步更新（[Workspace Updates](https://workspaceupdates.googleblog.com/2026/07/generate-edit-visuals-gemini-docs.html)）。**判定：文档内嵌视觉，不是流程图协同画布**，无图元级多人实时编辑、无节点级对话改图，**不构成替代**。国内不可用。

---

## 3. 国内阵营

### 3.1 ProcessOn —— 国内唯一「实时协同 + AI 改图 + 私有化」三件套齐全的

- 官网：https://www.processon.com/ ｜AI https://www.processon.com/ai ｜企业 https://www.processon.com/enterprise
- **多人实时协同：✅ 原生**。官网首屏即写「支持多人实时在线协作」；团队版支持团队空间、多层级权限、团队水印、二级回收站、离职交接。
- **AI 能力：L3（国内最强的一档）**。依据[腾讯云官方号文章（2026-10-26）](https://cloud.tencent.com/developer/article/2769204)与官网 AI 页：
  - 覆盖图形：流程图、业务流程图、泳道图、BPMN、时序图、UML、ER、系统/软件/云架构、网络拓扑、电路图、思维导图、组织结构图、鱼骨图、时间轴、树形图、韦恩图、平面图、路线图、信息图、金字塔图、**草图重绘**。
  - **输入支持文档（PDF/Word/PPT）、图片、网页、长文本** → 提取结构 → 出图。
  - **关键：AI 输出的是 DSL（图元结构化数据）而非图片，生成的是可继续编辑的 ProcessOn 文件**，并实时同步到账号，保持原有协作方式。
  - **支持读取账号内已有文件做局部修改**（「把审核失败分支补一个重新提交步骤」这类指令），也支持批量整理文件夹、查历史版本。
- **价格（[升级页](https://www.processon.com/upgrade)，2026-11 抓取）**：

  | 档位 | 价格 | AI 点数 | 协作 |
  |---|---|---|---|
  | 免费版 | ¥0 | 500/月 | 3 人协作、9 个文件 |
  | 个人版 | **¥219/年**（活动价 ¥95） | 2,000/月 | 协作人数不限 |
  | 终身版 | **¥1,590**（活动价 ¥799） | 2,000/月 | 协作人数不限 |
  | 团队免费版 | ¥0 | 500/月 | 文件协作人数不限、流程图图形数 60 |
  | **团队版** | **¥259/人/年** | 2,000 × 付费席位/月 | 不限、30 画布/文件、团队空间 |
  | 私有部署/信创版 | 询价，**100 人起** | — | SSO、企业数据自主掌控、国产软硬件支持 |
  | API | 询价 | — | 云端 + 私有化、在线编辑/预览/实时协同、AI 办公场景接入 |

  - 折算团队版 ≈ **¥21.6/人/月**——比 Eraser 便宜 15 倍，比 Miro Business 便宜 6.5 倍。
  - AI 点数规则：套餐点数每月发放、月底过期、不累计；加量包独立核算。
- **国内可用性：✅ 直连**。
- **私有化部署：✅ 明确提供**（私有部署/信创版，100 人起；企业版支持麒麟、统信、方德 + 国产 CPU 的离线客户端，通过国家等保资质）。这是全场**唯一一条为「党政军/国央企受限网络」设计的路径**。

### 3.2 金山文档 / WPS 流程图 —— 你们踩过的坑：它就是 ProcessOn

- 官网：https://www.kdocs.cn/
- **实测确认（本次调研在浏览器中打开金山文档内的流程图文件）**：kdocs 里的流程图编辑器实际加载的是
  `https://wps.processon.com/diagrams/edit?encrypted_session=...&group_id=...&product=kdocs_web`
  ——即 **WPS/金山文档的流程图 = 内嵌的 wps.processon.com，引擎与 ProcessOn 同源**。ProcessOn 官网也把「与 WPS 携手前行」写进了 CEO 背书。
- **含义**：如果你们已经在金山文档里画图，**你们用的就是 ProcessOn 的引擎，只是套了金山的外壳**；单独买 ProcessOn 团队版在 AI 能力上会更完整（kdocs 内嵌版未必暴露 AI 全部能力，**未确认**）。
- **价格**：金山文档/WPS 会员档位本次**未取得官方页面数据**，标注**未确认**。请勿以二手价为准。
- **私有化部署：✅ WPS 有信创/私有化体系**（未在本报告范围内核实具体档位）。

### 3.3 亿图图示 / 万兴图示 EdrawMax —— 桌面强、协同弱

- 官网：https://www.edrawmax.cn/ （原 edrawsoft.cn，现品牌为「万兴图示」）｜购买 https://buy.edrawmax.cn/
- **多人实时协同：⚠️ 部分**。官网写「云端协同」「团队文档」「文件云同步」；脑图产品明确写「多人同时编辑」。**流程图/图示的「同一画布多光标实时协同」未在官网明确表述，判定为弱于 ProcessOn，未确认**。
- **AI 能力：L1~L2**。官网 AI 四项：**一键生图、文字续写、一键美化、OCR 文字提取**。生成后仍是手工拖拽调整，**没有「读当前画布做局部改图」的产品化能力**。
- **价格**：在线版订阅 **¥178/12 个月、¥298/24 个月**（[官方帮助中心](https://www.edrawmax.cn/support/MaxOnline)）；商城券前价 **¥280/年**（买 1 年送 6 个月，自动续费按 **¥198/年** 扣款，[buy.edrawmax.cn](https://buy.edrawmax.cn/)）。折算 ≈ **¥23/人/月**。
- **国内可用性：✅ 直连**。
- **私有化部署：✅ 明确支持**——官网首页列「数据加密存储、**支持受限网络环境**、**私有化部署**、企业鉴权管理」，并获信创优秀产品、适配国产芯片与操作系统。

### 3.4 Boardmix 博思白板 —— 国内「白板 + AI 生成 + 私有化」最完整的

- 官网：https://boardmix.cn/ ｜定价 https://boardmix.cn/price ｜私有化 https://boardmix.cn/privatedeploy
- **多人实时协同：✅ 原生**（无限画布、多光标、评论、投票、计时器、视频会议）。
- **AI 能力：L2**。博思 AI 智能体：AI 生成思维导图 / **流程图** / 表格 / 文档 / PPT / 演示报告、AI 润色翻译续写、文档总结问答、图片提取文本、语音转文字、AI 绘图。**生成的是可编辑画布对象**，但对话式「改现有图」的能力弱于 ProcessOn。
- **价格（[官网](https://boardmix.cn/price)，2026-11 双 11 特惠）**：

  | 档位 | 价格 | AI 点数 |
  |---|---|---|
  | 免费用户 | ¥0 | 500 点 |
  | 白板会员 | ¥199/年（原 ¥256） | 500 点 |
  | 白板 AI 会员 | ¥288/年（原 ¥376） | 10,000 点/月 |
  | 终身会员 | ¥599（原 ¥999） | 10,000 点 |
  | 免费团队 | ¥0/人/年 | 500 点、200MB |
  | **团队版会员** | **¥240/人/年**（原 ¥380），2 人起，续加 ¥100/人/年 | 500 点 |
  | **团队版 AI 会员** | **¥340/人/年**（原 ¥580），2 人起，续加 ¥300/人/年 | **10,000 点/人/月** |
  | 企业版 | 询价 | 定制 |

  - 折算团队 AI 会员 ≈ **¥28.3/人/月**。
- **国内可用性：✅ 直连**。
- **私有化部署：✅ 有独立方案页**（支持受限网络、自建云、公有云；信创全栈适配）。

### 3.5 即时设计（js.design）

- 官网：https://js.design/ ｜定价 https://js.design/pricing
- **多人实时协同：✅**（无限协作者、实时评论、团队共享设计库）。
- **AI 能力：⚠️ 未确认**。定价页与官网首页**没有把 AI 画图/流程图作为卖点**；产品定位是 UI 设计工具，流程图不是核心场景。**不建议作为流程图主力**。
- **价格（[官网](https://js.design/pricing)，实测抓取）**：**基础版永久免费**（文件/图层/协作者/团队数量全部无限，团队成员 200）；**企业版「限时体验」**（成员/团队管理、优先功能）；**私有部署版「获取方案与报价」**。官网明示「目前已开放的功能、服务均为永久免费」。
- **国内可用性：✅ 直连**。
- **私有化部署：✅ 有独立私有部署版**（企业本地部署、内部系统集成）。

### 3.6 飞书白板

- 官网：https://www.feishu.cn/ ｜画板 https://www.feishu.cn/product/board ｜定价 https://www.feishu.cn/price-list
- **多人实时协同：✅ 优秀**（飞书画板嵌在文档里，多人同画布编辑）。
- **AI 能力：L1~L2（画布层 AI 弱）**。飞书的 AI 主要落在**文档/会议/多维表格**层（智能纪要、豆包工作伙伴、多维表格 AI）。**画板内的 AI 生成流程图，官方产品页未作为原生能力列出**；实践中主流做法是 **飞书 CLI + 画图 Skill，让 Agent 生成可编辑画板**（[腾讯云社区案例](https://cloud.tencent.com/developer/article/)、社区 Skill 提供 35 套配色与画板渲染规则）。**判定：AI 需要外挂，不是产品内建。**
- **价格（[官网](https://www.feishu.cn/price-list)，年付）**：免费版 ¥0（100 用户）；**商业标准版 ¥50/人/月**；**商业专业版 ¥80/人/月**；**商业旗舰版 ¥120/人/月**；企业旗舰版定制。AI 另计：**AI 会员 ¥69/月**、**AI 会员 Plus ¥138/月**；AI 企业版 **¥9.9 万/年**（200 万点额度）、基础版 ¥9,900/年（18 万点）。
- **国内可用性：✅ 直连**。
- **私有化部署：⚠️ 未确认**（企业旗舰版为定制，是否含私有化需与销售确认；飞书主推 SaaS）。

### 3.7 钉钉白板

- 官网：https://www.dingtalk.com/
- **多人实时协同：✅**（互动白板，会议场景为主）。
- **AI 能力：L1**。钉钉 12 条产品线接入大模型，可生成 PPT、思维导图；**白板内的对话式流程图编辑未确认**。
- **价格**：标准版免费；**专业版约 ¥9,800/年**（多来源一致，但**官方商城页未直接确认**，属二手）；专属版/专有版定制。
- **国内可用性：✅ 直连**。
- **私有化部署：✅ 有专有版**（大型企业定制）。

### 3.8 腾讯文档白板

- 官网：https://docs.qq.com/ ｜会员 https://docs.qq.com/vip/
- **多人实时协同：✅**（文档/表格/幻灯片/收集表/**流程图**/白板全套实时协作）。
- **AI 能力：L1~L2**。AI 文档助手（17 项权益）、AI 文件生成、AI 助理全品类一键生成；**流程图/白板内的 AI 生成属于 AI 积分消耗项，但「读画布改图」未确认**。
- **价格（[会员页](https://docs.qq.com/vip/)，实测）**：基础方案 **¥0**（1GB、AI 积分限时任务领取）；**超级会员 ¥13.2/月（¥158/年）**（380GB、**AI 积分 500/月**）；**超级会员 Plus ¥24.8/月（¥298/年）**（500GB、**AI 积分 1,200/月**）。联合会员（SVIP+视频 VIP 等）¥168。
- **国内可用性：✅ 直连**。
- **私有化部署：⚠️ 未确认**（腾讯文档以 SaaS 为主，企业版私有化需谈）。

### 3.9 WorkBuddy（workbuddy.cn）—— 它不是画图工具，是「AI Agent 工作台 + 技能市场」

- 官网：https://www.workbuddy.cn/ ｜定价 https://www.workbuddy.cn/pricing/ ｜文档 https://www.workbuddy.cn/docs/workbuddy/Overview
- **官方定位（文档原文）**：「腾讯出品的**全场景 AI 工作台**……用自然语言描述需求，由 WorkBuddy **自主规划和执行任务**，并交付文档、表格、PPT 等成果」。核心能力是自然语言交互、自主规划执行、本地文件操作、多任务并行。**它本身没有白板/流程图编辑器。**
- **「连 ProcessOn」到底是怎么连的（关键澄清）**：
  - 通过 **ProcessOn 官方 Skill「ProcessOn AI」**，在 WorkBuddy 的**技能市场搜索安装 → 完成 ProcessOn 账号授权（OAuth）**，即可在对话里让 AI 在你的 ProcessOn 账号下**新建、编辑、查询、导出**图表文件（[腾讯云官方文章](https://cloud.tencent.com/developer/article/2769204)，2026-10-26）。
  - 也支持经 **SkillHub** 安装：`请根据 https://skillhub.cn/install/skillhub.md，安装 @user_697d94c5/processon-ai-generator-diagram`。
  - **AI 产出的是 DSL → ProcessOn 生成可编辑文件 → 实时同步回你的 ProcessOn 账号**，团队协作仍在 ProcessOn 里进行。
- **所以「WorkBuddy 贵」贵在哪**：贵在 **Agent 编排 + 积分 + 全模型调度 + 连接器生态**，不贵在画布。画布与协作能力实际由 ProcessOn 提供（而 ProcessOn 团队版只要 ¥259/人/年）。
- **价格（[官网定价页](https://www.workbuddy.cn/pricing/)，实测抓取）**：

  | 档位 | 月付（连续包月折扣） | 原价 | 积分 | 单项目协作人数 |
  |---|---|---|---|---|
  | 体验版 | ¥0 | ¥0 | 500 | 3 人（限免 5） |
  | 标准版 | **¥70/月**（7 折） | ¥99/月 | 2,000 + 赠 2,000 | 5 人 |
  | 高级版 | **¥140/月** | ¥199/月 | 4,000 + 赠 5,000 | 8 人 |
  | 旗舰版 | — | ¥999/月 | 20,000 + 赠 30,000 | 10 人 |
  | **Buddy One VIP** | **¥700/月**（推广价，年 ¥6,720） | ¥1,399/月 | 50,000 跨应用共享 | 10 人 |

  - ⚠️ **注意「每项目 N 人协作」是项目协作席位，不是「同一张流程图上的多光标实时协同」**——两者不是一回事。
  - Buddy One VIP 含腾讯会议专业版 + 腾讯文档超级会员 Plus + ima + 腾讯网盘共享额度。
- **国内可用性：✅ 直连**（腾讯云）。
- **私有化部署：⚠️ 未确认**（个人版无；企业版需咨询 workbuddy@tencent.com）。

### 3.10 语雀 / 幕布

- 语雀官网：https://www.yuque.com/ ｜定价 https://www.yuque.com/about/price
- **多人实时协同：✅**（文档/画板协同，协作人数 5/50/500 按档位）。
- **画图能力**：语雀「画板」把**思维导图、流程图、UML 融合在同一张画布**上（[语雀官网](https://www.yuque.com/)）；文档内可插入独立流程图卡片。**AI 能力：L1~L2**——AI 助手（100 次/天 或 无限次），但**画板内的 AI 生成/改图未作为核心能力宣传，未确认**。
- **价格（[官网](https://www.yuque.com/about/price)）**：普通用户 ¥0；**专业会员 ¥99/人/年**；**超级会员 ¥299/人/年**。折算 ≈ ¥8.25/人/月（最便宜）。
- **国内可用性：✅ 直连**。
- **私有化部署：⚠️ 未确认**（语雀有企业空间，私有化需谈）。
- **幕布**：大纲笔记为主，画图能力仅思维导图导出，**不满足「同一张流程图多人实时协同」**，不推荐。

---

## 4. AI 画图专门工具（text-to-diagram）

| 工具/路径 | 形态 | 多人实时协同 | AI 深度 | 适用判断 |
|---|---|---|---|---|
| **Claude / ChatGPT + Mermaid** | 对话产出 Mermaid 代码 → 粘进 Mermaid Live / ProcessOn / draw.io 渲染 | ❌（渲染端才有） | L2（生成靠对话，改图靠重写代码） | **零成本、最灵活**，适合技术团队；非技术人员门槛高 |
| **draw.io MCP**（[jgraph/drawio-mcp](https://github.com/jgraph/drawio-mcp)） | Claude/ChatGPT/Cursor 直连 draw.io，图直接落到编辑器 | ✅（落到 draw.io 后即可协同） | L3（可 attach 现有图做 update） | **受限网络/零预算场景的最优组合** |
| **Eraser DiagramGPT** | 30+ 专用生成器，网页直接用 | ❌（免费版无协同） | L2 | 单张图快速成型 |
| **Napkin** | 文本→视觉 | ❌ | L1 | 汇报配图，不是流程图协作 |
| **Excalidraw + MCP / REST** | 手绘风 + AI 生成 | ✅ | L2 | 想要「轻松感」的白板 |
| **D2 / PlantUML / Mermaid 语法派** | 代码即图，进 Git | ❌ | L1 | 架构图版本化，适合工程团队 |

**判断**：这类工具解决「从 0 到 1 出图」，**不解决「三个人在同一张图上边讨论边改，AI 也在同一张图上改」**——后者才是你们要的。

---

## 5. 对比总表

> 价格列统一为「**元/人/月**」，年付口径，USD 按 7.1 折算；「企业询价」类写「询价」。

| 工具 | 多人实时协同 | AI 深度 | 价格(元/人/月) | 可私有化 | 推荐度 |
|---|---|---|---|---|---|
| **ProcessOn**（国内） | ✅ 原生，多光标 | **L3 对话改图 + DSL 可编辑 + 读已有文件** | **¥21.6**（团队版 259/年） | ✅ 私有部署/信创版，100 人起 | ⭐⭐⭐⭐⭐ |
| **draw.io**（国际） | ✅ 原生 | L2→L3（**可接受限网络自有 LLM**） | **¥0** | ✅ 完全自建 | ⭐⭐⭐⭐⭐ |
| **Boardmix**（国内） | ✅ 原生 | L2（生成可编辑，改图偏手工） | ¥28.3（团队 AI 会员 340/年） | ✅ 有方案页 | ⭐⭐⭐⭐ |
| **亿图图示/万兴图示**（国内） | ⚠️ 弱（协同表述模糊） | L1~L2（一键生图/美化） | ¥23（280/年） | ✅ 支持受限网络 | ⭐⭐⭐ |
| **WorkBuddy + ProcessOn Skill** | ⚠️ 协作仍在 ProcessOn | **L3（Agent 编排层最强）** | ¥70~¥700（席位，非画布） | ⚠️ 未确认 | ⭐⭐⭐（贵在 Agent，不在画布） |
| **Miro**（国际） | ✅ 标杆 | L2 + MCP/Agents 生态 | ¥57（Starter）/ ¥142（Business） | ❌（仅区域数据驻留） | ⭐⭐⭐（数据出境风险） |
| **Eraser.io**（国际） | ✅ | **L3**（Eraserbot/API/MCP） | **¥320**（$45） | ⚠️ 仅 Enterprise custom hosting | ⭐⭐⭐（太贵） |
| **Mermaid Chart**（国际） | ✅ 仅 Premium 档 | L2（AI 生成 + Whiteboard） | ¥71（Plus）/ ¥142（Premium） | ❌ | ⭐⭐⭐（国内打不开） |
| **Whimsical**（国际） | ✅ 全档 | L1~L2（AI 起点加速器） | ¥71 / ¥142 | ❌ | ⭐⭐ |
| **Figma FigJam**（国际） | ✅ | L1~L2（模板/图表生成） | **¥21**（Collab seat $3）/ ¥114（Full） | ❌ | ⭐⭐（协同好，AI 浅） |
| **Lucidchart**（国际） | ✅ Team 档起 | L2（企业架构向） | ¥71（$10，二手来源） | ❌ | ⭐⭐ |
| **Creately AI**（国际） | ✅ Free 即有 | L2（生成+Organize+Transform） | ¥36（$5） | ⚠️ On-Prem 入口存在，未确认 | ⭐⭐ |
| **Napkin.ai**（国际） | ❌ | L1（文本→视觉） | ¥64（$9）/ ¥156（$22） | ❌ | ⭐（不满足协同） |
| **Visual Paradigm**（国际） | ✅ 云端 | L2（需求→ERD，**AI 需维护期**） | ¥107（$15）/ ¥249（$35） | ✅ 桌面可离线 | ⭐⭐ |
| **Excalidraw+**（国际） | ✅ | L2（TTD/Autoshape/MCP） | ¥43（$6） | ✅ 开源自建 | ⭐⭐⭐ |
| **tldraw**（SDK） | ✅（内置 multiplayer） | 需自研 | 商业授权，价值定价 | ✅ host anywhere | ⭐⭐⭐（自研底座） |
| **Terrastruct D2**（国际） | ❌ | L1（代码即图） | ¥0 / ~¥142（未确认） | ✅ | ⭐⭐ |
| **飞书白板**（国内） | ✅ 优秀 | L1~L2（画布 AI 弱，需 CLI+Skill） | ¥50（标准版，另 AI ¥69~138） | ⚠️ 未确认 | ⭐⭐⭐ |
| **腾讯文档白板**（国内） | ✅ | L1~L2 | ¥13.2 / ¥24.8（个人会员） | ⚠️ 未确认 | ⭐⭐ |
| **语雀**（国内） | ✅ | L1~L2（画板 AI 未确认） | ¥8.25（99/年） | ⚠️ 未确认 | ⭐⭐ |
| **即时设计**（国内） | ✅ | ⚠️ 未确认（非流程图产品） | ¥0（基础版永久免费） | ✅ 私有部署版 | ⭐⭐ |
| **钉钉白板**（国内） | ✅ | L1 | ~¥9,800/年/企业（未确认） | ✅ 专有版 | ⭐⭐ |
| **Google Gemini in Docs** | ❌（文档内嵌图） | L1~L2 | — | ❌ | ⭐（不适用） |

---

## 6. 关键洞察：谁真正做到了「多人实时协同 + AI 深度参与」

### 6.1 判定的分水岭只有一条：**AI 能不能「读懂当前这张图」**

「AI 深度」不是看它生成得多漂亮，而是看**它是否持有这张图的图元结构（DSL/JSON），并且能在不重画的前提下做局部修改**。按这条线划：

**真正做到的（AI 与画布共享同一份图元数据）：**
1. **ProcessOn** — 唯一明确把「自然语言 → DSL → 可编辑文件 → 同步回账号 → 支持对已有文件做局部修改」全链路讲清楚的国内产品。
2. **draw.io** — 官方 Generate 对话框支持 **attach 当前文件/页面/选区**，模型返回修改后的图；且可指向自有 LLM 端点。**能力上限极高，但需要自己配模型，产品化体验不如 ProcessOn。**
3. **Eraser** — Eraserbot 从代码库生成并**持续更新**图，Diagramming API + MCP 双向，AI 与画布数据打通。**贵。**
4. **Boardmix** — AI 生成的是可编辑画布对象，但「对已有图的对话式修改」弱一档。
5. **Miro** — 严格说 Miro 的 AI 更偏「画布上的工作流编排 + MCP 外部读写」，而非「对话改这张流程图」，但在协同成熟度上无可争议第一。

**只贴了「AI 生成按钮」的（AI 出图 → 人手工改，AI 不再参与）：**
- **Whimsical AI**（AI Flowcharts 是起点加速器）、**Creately AI**、**亿图/万兴 AI**（一键生图/一键美化）、**Napkin**（纯文本→视觉，连协同画布都没有）、**飞书/钉钉/腾讯文档白板**（AI 在文档层，不在画布层）、**Google Gemini in Docs**（文档内嵌图，无图元协同）。

### 6.2 一个被普遍误读的点：WorkBuddy 不是「画图工具」

WorkBuddy 是 **Agent 工作台 + 技能市场**，它「连 ProcessOn」的方式是装一个 **ProcessOn 官方 Skill**、授权账号，让 Agent 在你的 ProcessOn 账号里建/改/查文件。**画布、实时协同、版本、权限全部仍由 ProcessOn 提供。**

所以你们感受到的「WorkBuddy 贵」，买的是 **Agent 编排能力 + 跨应用积分 + 全模型调度**（¥70~¥700/月/席位），而不是「更好的画图体验」。**如果目标只是「AI 深度参与 + 多人同一张图」，直接上 ProcessOn 团队版（¥259/人/年 ≈ ¥21.6/人/月）+ 其内置 AI，比 WorkBuddy 便宜一个数量级，且不丢协同能力。** WorkBuddy 的价值在别处：把「画图」这一步嵌进「写方案/出报告/做 PPT」的自动化流水线里。

### 6.3 国内 vs 国际的实际差距不在能力，在「可达性 + 合规」

- 能力上，Eraser/Miro/draw.io 的 AI 深度不输 ProcessOn。
- 但 **Eraser（¥320）、Miro（¥142）、Mermaid（¥142）、Lucid（¥71）全部需要国际网络**；本次实测 `mermaid.ai` 与 `plus.excalidraw.com` 均返回 `ERR_CONNECTION_CLOSED`。
- 更关键的是**私有化**：国际阵营里只有 **draw.io（开源自建）、tldraw（SDK）、Excalidraw（开源）、Visual Paradigm（桌面离线）** 能真正做到数据不出受限网络；Miro/Figma/Lucid/Mermaid/Whimsical/Napkin **一律不能**。Eraser 的 "custom hosting" 只在 Enterprise 档且需谈判。
- 国内能私有化的：**ProcessOn（100 人起，含信创）、Boardmix、亿图、即时设计、钉钉专有版**。

### 6.4 「同一张图多人实时协同」这件事，国内产品其实不弱

ProcessOn、Boardmix、飞书画板、腾讯文档、语雀都能做到多光标同画布编辑，体验与 Miro 的差距主要在**大规模画布性能与访客机制**，不在基础协同。**真正的短板一直是 AI 深度**——而这恰好是 ProcessOn 2026 年补得最狠的一块。

---

## 7. 给这个团队的建议路径

| 优先级 | 方案 | 理由 | 成本 |
|---|---|---|---|
| **首选** | **ProcessOn 团队版 + 内置 AI**（先在现有账号上升级试用 15 天） | 已熟悉的编辑器、零迁移成本、AI 是 L3、价格 ¥259/人/年 | ≈ ¥21.6/人/月 |
| **受限网络硬约束时** | **ProcessOn 私有部署/信创版**（100 人起） | 唯一同时满足「实时协同 + AI + 数据不出受限网络 + 信创适配」的国内产品 | 询价 |
| **零预算备选** | **draw.io 自建 + 接内部 LLM**（`gptUrl` 指向受限网络模型） | 完全免费、可彻底断外网、AI 能力取决于内部模型质量 | ¥0（人力成本） |
| **第二备选** | **Boardmix 团队 AI 会员 / 私有化** | AI 生成体验好、私有化有方案页，可作为 ProcessOn 的对比标 | ¥28.3/人/月 |
| **不建议** | 为「AI 画图」去买 WorkBuddy 旗舰版 | 画布能力并未增强，付的是 Agent 编排费 | ¥700/月/席位 |
| **不建议** | Eraser / Miro / Mermaid 作为主力 | 价格高 3~15 倍，且需翻墙、不能私有化 | ¥142~¥320/人/月 |

**建议的验证动作（一周内可做完）**：
1. 用 ProcessOn 团队版 15 天试用，让 3 个人同时打开同一张示例流程图，测试「AI 读取现有图 → 局部改一个分支」是否真的可用。
2. 同时用 draw.io + 你们内部可用的 LLM，跑同一个改图任务，对比 AI 质量与配置成本。
3. 向 ProcessOn 销售（010-86393609）索取私有化/信创版报价与部署清单，确认是否支持纯受限网络无外网环境。

---

## 8. 未确认清单（不编造，明确标注）

| 项 | 状态 | 说明 |
|---|---|---|
| 金山文档/WPS 会员具体价格档位 | **未确认** | 未取得官方定价页数据；但已实测其流程图编辑器为 `wps.processon.com` |
| 亿图「同一画布多光标实时协同」 | **未确认** | 官网仅写「云端协同/多人同时编辑（脑图）」，未明确流程图同画布协同 |
| Lucidchart USD 价（$9 / $10） | **二手来源** | 官网按访问地返回 JPY，USD 来自 costbench，未在官网直接确认 |
| Terrastruct 商业版 $20/人/月 | **二手来源** | 官网未直接给出价格页数字 |
| Excalidraw+ $6/$7 | **半确认** | 官网域名本次 `ERR_CONNECTION_CLOSED`，数字来自官方页摘要与第三方比价 |
| 钉钉专业版 ¥9,800/年 | **二手来源** | 多来源一致但官方商城页未直接确认 |
| 飞书/腾讯文档/语雀/WorkBuddy 私有化 | **未确认** | 均以 SaaS 为主，是否支持私有化需与销售确认 |
| 即时设计 AI 画图能力 | **未确认** | 定价页与首页未把 AI 画图作为卖点，产品定位为 UI 设计 |
| 语雀画板 AI 生成/改图 | **未确认** | AI 助手存在，但画板内 AI 未作为核心能力宣传 |
| Creately On-Prem 交付方式 | **未确认** | 官网有企业 On-Prem 入口，具体方案需谈 |
| ProcessOn 私有部署/信创版价格 | **未确认** | 官网仅标「100 人起」，需询价 010-86393609 |
| Boardmix / 亿图 私有化报价 | **未确认** | 均有方案页，价格需询价 |

---

## 9. 来源清单

**国际**：draw.io [AI 配置](https://www.drawio.com/docs/reference/diagram-generation/configure-ai-options/) ｜ [实时协同](https://www.drawio.com/docs/manual/collaboration/concurrent-editing) ｜ [MCP](https://github.com/jgraph/drawio-mcp)；Eraser [定价](https://www.eraser.io/pricing) ｜ [DiagramGPT](https://www.eraser.io/diagramgpt)；Mermaid [定价](https://mermaid.ai/pricing) ｜ [套餐](https://mermaid.ai/docs/workspace-and-admin/manage-your-account) ｜ [Whiteboard](https://mermaid.ai/docs/guides/whiteboard)；[Whimsical](https://whimsical.com/pricing)；[Miro](https://miro.com/pricing/)；Figma [定价](https://www.figma.com/pricing/) ｜ [FigJam AI](https://www.figma.com/figjam/ai)；[Lucidchart](https://lucid.app/pricing/lucidchart)（USD 二手： [costbench](https://costbench.com/software/diagramming/lucidchart/)）；[Napkin](https://www.napkin.ai/pricing/)；[Creately](https://www.creately.com/plans/)；Visual Paradigm [AI 定价](https://appstudio.visual-paradigm.com/pricing/) ｜ [AI 需维护期](https://updates.visual-paradigm.com/pt/releases/ai-features-software-maintenance-requirement-2026-2/)；[tldraw](https://tldraw.dev/pricing) ｜ [Excalidraw+](https://plus.excalidraw.com/pricing) ｜ [Excalidraw AI](https://plus.excalidraw.com/ai)；[D2](https://d2lang.com/)；[Google Workspace 更新](https://workspaceupdates.googleblog.com/2026/07/generate-edit-visuals-gemini-docs.html)

**国内**：ProcessOn [定价](https://www.processon.com/upgrade) ｜ [AI](https://www.processon.com/ai) ｜ [企业版](https://www.processon.com/enterprise) ｜ [团队版收费 FAQ](https://www.processon.com/support/question) ｜ [AI Skill 详解（腾讯云官方号 2026-10-26）](https://cloud.tencent.com/developer/article/2769204)；[Boardmix 定价](https://boardmix.cn/price) ｜ [私有化](https://boardmix.cn/privatedeploy)；万兴图示/亿图 [官网](https://www.edrawmax.cn/) ｜ [在线版价格](https://www.edrawmax.cn/support/MaxOnline) ｜ [商城](https://buy.edrawmax.cn/)；[即时设计](https://js.design/pricing)；飞书 [定价](https://www.feishu.cn/price-list) ｜ [画板](https://www.feishu.cn/product/board)；[腾讯文档会员](https://docs.qq.com/vip/)；[语雀](https://www.yuque.com/about/price)；WorkBuddy [定价](https://www.workbuddy.cn/pricing/) ｜ [产品文档](https://www.workbuddy.cn/docs/workbuddy/Overview)；[钉钉](https://www.dingtalk.com/)（价格二手）