# WorkBuddy 方案安装指南

> ⚠️ **非官方项目，与 ProcessOn 官方无关联。** 完整声明见仓库根目录 `DISCLAIMER.md`。

> **适用**：用 WorkBuddy（腾讯 AI 工作台）的同事
> **能力**：让 AI 直接读你打开的那张 ProcessOn 图，在上面增删改，改动红色高亮，改完自动保存

---

## 先说清楚原理

**不需要浏览器扩展，也不需要官方 MCP。**

这一版用的是 Playwright：AI 自己起一个 Chromium，凭 ProcessOn 编辑页 URL 里带的
`encrypted_session` 直接进编辑态（不用你的登录态、不占用你的浏览器），然后往页面注入
一个 4KB 的桥接层脚本。桥接层做的事和 DSH 方案完全一样——只是**谁去执行**不同：

| | DSH 方案 | WorkBuddy 方案（本包） |
|---|---|---|
| 执行者 | AI 通过**浏览器扩展**控制你正开着的标签页 | AI 用 **Playwright 自带的 Chromium** |
| 你的浏览器 | 必须开着、必须装扩展 | 完全不碰 |
| 登录态 | 复用你的 | 不需要（靠 URL 票据） |
| 改动出现在哪 | 直接出现在你眼前的标签页 | 同一份 ProcessOn 文档，协同同步可见 |
| 无人值守 / 定时 | 不行 | 可以（headless） |
| 要装的东西 | DSH + 扩展 + 技能 | Node + 一个技能 |

两套方案改的是**同一张图、同一份数据**，互不影响；你可以只装一套。

---

## 装什么

| # | 组件 | 说明 |
|---|---|---|
| 1 | **Node.js 20+** | 运行 CLI。装完 `node -v` 能出版本号即可 |
| 2 | **Chromium** | 复用 Playwright 缓存里的；没有就 `npx playwright install chromium` |
| 3 | `wb-processon-diagram-editor` 技能 | 给 AI 看的说明书（可选但推荐） |

---

## 第 1 步：装依赖

```bash
cd 02-WorkBuddy方案
npm install --omit=dev
```

只装 `playwright-core`（约 14MB），**不会**下载浏览器——本机已有 Playwright 缓存时直接复用。

## 第 2 步：装技能（可选）

把 `wb-processon-diagram-editor` 整个文件夹复制到：

- Windows：`C:\Users\<你的用户名>\.workbuddy\skills\`
- macOS/Linux：`~/.workbuddy/skills/`

技能里的 `runtime/` 是自带的可执行运行时，`SKILL.md` 告诉 AI 怎么用。

> 💡 技能目录里的运行时是**生成物**，要升级请从源码仓库重新同步，别手改。

## 第 3 步：验证

```bash
node bin/pocli.mjs status
```

看到 `ok:true` 且 `chromium` 有路径，就装好了。

---

## 怎么用

给 AI 一句话就行：

> 「改一下这张 ProcessOn 流程图，在最后加一个归档环节，红标一下」

AI 会按 `SKILL.md` 里的流程走：读结构 → 定位目标 → 加节点（红色）→ Ctrl+S → 校验落库。

手动跑也行：

```bash
node bin/pocli.mjs set-url "<编辑页URL>"        # 存一次，之后不用再传
node bin/pocli.mjs read --json g.json           # 读节点/连线/泳道
node bin/pocli.mjs add --text "报告归档" --from <节点id> --gap 80 --verify
node bin/pocli.mjs shot --fit --out after.png  # 截图核对
```

### 命令表

| 命令 | 作用 |
|---|---|
| `status [--probe]` | 自检；`--probe` 真开一次页面 |
| `set-url "<URL>"` | 记录目标文档（URL 必须含 `file_id`） |
| `read [--json f]` | 读结构：节点数、连线数、泳道名、泳道池底边 |
| `add --text T [--from ID --gap 80] [--x --y --w --h]` | 加节点，默认红色，可自动连线 |
| `update --id ID [--text/--x/--y/--w/--h/--fill/--line/--font]` | 改节点 |
| `remove --ids a,b` | 删节点（空数组会被拒绝） |
| `edge --from A --to B [--text 是]` | 连线 |
| `shot [--fit] [--focus ids] --out f.png` | 截图（会等画布真的画完） |
| `save` | 按 Ctrl+S |
| `verify [--expect-nodes N]` | 另起干净浏览器读服务端副本，确认真的存进去了 |
| `snippet read\|add\|inject` | 输出可直接喂给 AI 原生浏览器工具的 JS |

退出码：`0` 成功 / `2` 用法错 / `3` 读图或渲染失败 / `4` 校验不一致 / `5` 登录墙（票据过期）/ `6` 页面异常 / `7` 缺 Chromium。

---

## 常见问题

**Q：AI 说改了但我看不见？**
改动写的是**同一份 ProcessOn 文档**。你的标签页如果一直开着，协同通道通常会同步过来；
没同步就刷新一下。要看细节：`node bin/pocli.mjs shot --fit --out a.png`。

**Q：报「登录墙 / 票据过期」？**
URL 里的 `encrypted_session` 会过期。在浏览器里重新打开那张图，复制新的编辑页地址，
再 `set-url` 一次。

**Q：会不会把我的图改坏？**
所有写入都走同一套事务机制，出错会显式报错而不是假装成功。删除类操作前 AI 会先跟你确认 id。
改动是**实时**同步给协作者的——动手前在群里说一声。

**Q：能撤销吗？**
能。ProcessOn 里 Ctrl+Z 撤销；或用 `remove --ids <id>` 删掉刚加的节点。

**Q：为什么不用官方 MCP？**
官方 MCP 是**整张覆盖**更新，多人同时编辑时会覆盖同事的改动，而且不能做「在泳道里加一步」
这种精确增量。我们这套是增量写入 + 落库校验，适合细改。

**Q：需要我登录吗？**
不需要。身份来自 URL 里的票据；但也意味着**谁拿到这条 URL 就能编辑这张图**，别外传。
