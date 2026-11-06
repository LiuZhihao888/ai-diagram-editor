# DSH 方案安装指南

> ⚠️ **非官方项目，与 ProcessOn 官方无关联。** 完整声明见仓库根目录 `DISCLAIMER.md`。

> **适用**：用 DeepSeek Harness 的同事
> **能力**：让 AI 直接读你打开的那张 ProcessOn 图，并在上面增删改，改动红色高亮

---

## 装什么（三样，缺一不可）

| # | 组件 | 作用 | 不装会怎样 |
|---|---|---|---|
| 1 | DSH 本体 | AI 主程序 | 什么都干不了 |
| 2 | **DSH 浏览器扩展** | AI 的手，能碰你的浏览器 | **AI 完全无法操作 ProcessOn** |
| 3 | dsh-processon-diagram-editor 技能 | 告诉 AI 怎么改图 | AI 不知道怎么和 ProcessOn 打交道 |

> ⚠️ 重点强调：**扩展是硬门槛**。技能只是一份 Markdown 说明书，它自己不能执行任何东西。
> 真正让 AI 碰到页面的是扩展提供的 `browser_evaluate` 等能力。

---

## 第 1 步：装浏览器扩展

> 📌 **这个扩展不由本仓库分发。** 它是第三方作品（DSH Browser Control），
> 请从 DSH 的插件市场 / 官方渠道自行安装。本仓库只提供技能包与桥接层。

安装后确认：

1. 打开 Edge（或 Chrome）
2. 地址栏输入 `edge://extensions/`（Chrome 用 `chrome://extensions/`）
3. 列表里能看到「**DSH Browser Control**」
4. 扩展图标出现在浏览器右上角

**验证扩展是否真的通了**：在 DSH 里让它读一下当前标签页标题。
读得到 = 通了；报「bridge 未连接」= 扩展没装好或没授端口。

> 💡 扩展需要 `debugger` 权限（它能读改任意网页，这是它的工作原理）。
> 只从你信任的来源安装。

---

## 第 2 步：装技能

### Windows 一键装

双击 `01-DSH方案/dsh-processon-diagram-editor/scripts/install.bat`

### 手动装

把 `dsh-processon-diagram-editor` 整个文件夹复制到：

- Windows：`C:\Users\<你的用户名>\.dsh\skills\`
- macOS/Linux：`~/.dsh/skills/`

**重启 DSH 生效。**

---

## 第 3 步：验证

在 DSH 里问：

> 「dsh-processon-diagram-editor 技能有哪些方法？」

能答出 `readGraph` / `createNode` / `updateNode` / `removeNodes` / `createEdge` 就对了。

---

## 怎么用

1. 浏览器打开 ProcessOn 图表的**编辑页**（能看到画布，不是预览页）
2. 对 AI 说：「看一下这张图的结构」
3. **确认它读对了**（几节点、几条泳道）再继续
4. 说：「在 XX 泳道里加一个 YY 环节」
5. AI 创建红色节点，你看屏幕确认
6. 满意后**自己按 Ctrl+S 保存**

> 🔴 **红色 = AI 的改动点**，一眼就能看到改了什么。

---

## 多个图同时打开怎么办

AI 会先问你要改哪一张，**别嫌它啰嗦** —— 这是故意的。

原因：
- 从浏览器标签列表看不出哪个页面是流程图（kdocs 的 URL 里没有 ProcessOn 的 file_id）
- 得读页面里 iframe 的 src 才知道，而"读"这一步**不用切换你的标签页**
- 但逐个查会花时间，不如你一句话说得快

所以流程是：你告诉它改哪张 → 它读那一张的标识 → 报 file_id 给你确认。

> 顺带说明：**它干活时不会切走你的标签页。** 读写都在后台做，
> 你的屏幕不会被切来切去。只有你主动说"跳过去给我看"时才会滚动视口。

---

## 常见问题

**Q: AI 说读不到图？**

检查页面 URL：
- 直连：含 `wps.processon.com/diagrams/edit`
- kdocs 内嵌：`kdocs.cn/view/l/xxx` 里有 ProcessOn 的 iframe

如果是 kdocs 内嵌，AI 需要在新标签页单独打开 iframe 地址。

**Q: AI 说改了但看不见？**

可能节点落在视口外了。让它重新用 `getViewBox()` 定位。

**Q: 改了会同步给同事吗？**

**会**。改动走 ProcessOn 的协同通道实时广播。这是优点也是风险，改动前最好在群里说一声。

**Q: 保存了吗？**

**没有**。AI 只改内存，保存必须你自己做。这是故意的安全设计。

**Q: ProcessOn 改版后失效？**

这是非官方接口，有这个风险。届时：
1. 把报错原文发给维护者
2. 或改用 WorkBuddy 的官方 MCP 方案（见 02 目录）

---

## 技术原理（想深究的话）

桥接层 `pobridge.min.js` 利用了 ProcessOn 页面的全局对象：

```js
window.Model          // 文档模型
window.MessageSource  // 操作事务管道
window.Designer       // 渲染器
window.Utils          // 工具函数
```

关键：必须走 `MessageSource.executeMessages(msg, true)`，
它会调用 `Schema.initShapeFunctions()` 和 `Designer.painter.renderShape()` 完成渲染。
直接调 `Model.addMulti()` 只改数据、画布不动。
