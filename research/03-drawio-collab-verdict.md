# 冲突裁决：draw.io 到底有没有实时协同？

> 两位调研员的结论相反，本文件用一手证据定论。

## 结论

**分三层，必须分开说：**

| 形态 | 实时协同 | 依据 |
|---|---|---|
| app.diagrams.net 在线版 | **有**（但要存 Google Drive / OneDrive / Nextcloud） | 点「共享」弹出：`You'll need to save to Google Drive before you can collaborate.`；运行时存在 `RT_WEBSOCKET_URL = wss://app.diagrams.net/rt` 与 `P2PCollab` 模块 |
| jgraph/drawio 开源仓库（自托管） | **没有** | README 原文：`Note that draw.io does not support real-time collaborative editing in this version, currently.` |
| 商业生产版 | 有 | README 原文：`This repository is a test version of draw.io, for evaluating draw.io. A paid production version is available for production deployments.` |

## 一手证据

### 证据 A：运行时 websocket 端点（实测于用户浏览器）

    window.REALTIME_URL    = "https://app.diagrams.net/cache"
    window.RT_WEBSOCKET_URL = "wss://app.diagrams.net/rt"
    typeof window.P2PCollab === "function"   // true

`P2PCollab` 源码片段显示它用 `sessionId` / `clientId` / `protocol: DrawioFileSync.PROTOCOL` / `cursor` / `view` 事件做协作同步。

### 证据 B：点「共享」按钮的实际响应（实测）

    共享 → "You'll need to save \"未命名绘图\" to Google Drive before you can collaborate."
    [取消] [Save to Google Drive]

说明：在线版协同**存在**，但绑定第三方存储。

### 证据 C：README 原文（https://github.com/jgraph/drawio）

> Note that draw.io does not support real-time collaborative editing in this version, currently.

> This repository is a test version of draw.io, for evaluating draw.io and trying it out. A paid production version is available for production deployments.

## 两位调研员谁错了？

- **市场调研员**说「draw.io 原生支持实时协同」—— **对在线版正确，对开源自托管版错误**。他引用的是 drawio.com 官方文档页（讲的是云端协同），没有看 GitHub README 的 Scope 段。
- **OSS 调研员**说「draw.io 官方明写不支持实时协同」—— **对开源仓库正确，但他也提到了 Apache-2.0 可自托管，容易让人误以为可以免费获得协同**。

## 对方案的净影响

对你们团队（中国、可能有网络限制）：

- **在线版协同要求 Google Drive / OneDrive** → 国内不可行
- **自托管开源版无协同** → 受限网络不可行
- **想要「受限网络 + 协同 + draw.io」只能买商业生产版** → 需询价

因此：**draw.io 在你们的约束下，仍然不满足「受限网络多人实时协同」。** 我上一轮的判断（draw.io 无协同）在你们的使用场景下依然成立，只是理由需要更精确。

而市场调研员提到的另一个关键点**是对的**：draw.io 的 AI 配置项 `gptUrl` 可指向自建/受限网络 LLM —— 这是它在「AI 侧」的实际优势（详情见 01-market.md §2.1）。

## 修正后的技术选型结论

| 需求 | draw.io 在线 | draw.io 自托管 | Excalidraw 自托管 |
|---|---|---|---|
| 多人实时协同 | ✅ 需 GDrive/OneDrive | ❌ | ✅ excalidraw-room |
| AI 读+增量改 | ✅ 可接受限网络 LLM | ✅ 可接受限网络 LLM | ✅ imperative API |
| 国内可用 | ⚠️ 需 Google 服务 | ✅ | ✅ |
| 受限网络部署 | ❌ | ✅ 但无协同 | ✅ |
| 授权成本 | ¥0 | ¥0 | ¥0（MIT） |

**Excalidraw 自托管仍然是唯一在「国内 + 受限网络 + 协同 + AI 可控」四项全绿的方案。**
