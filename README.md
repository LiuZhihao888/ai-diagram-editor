# ai-diagram-editor · 画布增量改图可行性研究

> ⚠️ **免责声明（使用前请务必阅读）**
>
> 本项目为**非官方独立研究项目**，与北京大麦地信息技术有限公司 / ProcessOn **无任何关联**，**未获其授权或认可**；「ProcessOn」及相关商标归其权利人所有，本文仅作技术讨论与事实描述使用。
> 使用前请**自行确认符合 ProcessOn 服务条款及所在单位规定**，作者不对任何使用后果负责。
> 本项目依赖**非公开内部页面接口**，平台改版随时可能失效，请**优先使用官方 OpenAPI / MCP** 等受支持的方式。
> `encrypted_session` 等 URL 票据**等同编辑权限**，切勿外传、切勿提交到公开仓库或日志。
>
> 完整版声明见 [`DISCLAIMER.md`](DISCLAIMER.md)。

在 ProcessOn 现有画布上做 **AI 增量改图**的完整研究与实现。

改的是你已经画好的那张图 —— 加一步、改文案、连箭头、删节点。改动红色高亮，
同事通过 ProcessOn 的协同通道实时看到。

> **第一次看这个仓库？先读 [`docs/项目总结.md`](docs/项目总结.md)** —— 结论、证据、踩过的坑都在那。
> **要决定用哪套？看 [`docs/两方案对比.md`](docs/两方案对比.md)** —— DSH 与 WorkBuddy 逐项对比与选型建议。

## 只想用，不想读代码

去 [Releases](../../releases) 下载对应方案的压缩包，解压后跟着包里的 `安装指南.md` 走：

| 下载 | 适合谁 | 装什么 |
|---|---|---|
| **WorkBuddy方案.zip** | 只想画图，不想折腾 | Node.js 20+ |
| **DSH方案.zip** | 已经在用 DeepSeek Harness | DSH + 浏览器扩展（从插件市场装） |

> ⚠️ 请自行核对附件内容与安全后再安装，本项目不提供任何担保。

> 两个包都**不含**浏览器扩展 —— 那个是第三方组件，请从 DSH 插件市场自行安装。

## 目录地图

| 目录 | 是什么 | 入口 |
|---|---|---|
| `bridge/` | **桥接层唯一源码**。`pobridge.js` 一份，构建出所有产物 | `bridge/build.mjs` |
| `dsh/` | **DSH 方案**：技能包，复用你的登录态（扩展需自行安装） | `dsh/skill/dsh-processon-diagram-editor/SKILL.md` |
| `wb/` | **WorkBuddy 方案**：自带 Chromium 的 CLI，不碰你的浏览器 | `wb/README.md` |
| `dist/` | **发给同事的成品包**（构建产物，不入库） | `cd wb && node tools/build-dist.mjs` |
| `packaging/` | 分发包的文案源（README / 安装指南 / 通用工具说明） | — |
| `research/` | 市场与可行性调研，回答「为什么这么选」 | `research/04-processon-writable.md` |
| `docs/` | **项目总结**、**两方案对比**、依赖真相 | [`docs/项目总结.md`](docs/项目总结.md) · [`docs/两方案对比.md`](docs/两方案对比.md) |

## 两条路线，各修各的

| | `dsh/` | `wb/` |
|---|---|---|
| 谁去执行 | AI 通过**浏览器扩展**控制你正开着的标签页 | AI 用 **Playwright 自带的 Chromium** |
| 要装什么 | DSH + 浏览器扩展 + 技能 | 只要 Node + 一个技能 |
| 占用你的浏览器 | 是 | 否 |
| 认证 | 复用你的登录态 | URL 里的 `encrypted_session` |
| 改动看得见吗 | 实时出现在你眼前的标签页 | 协同同步（必要时刷新） |
| 无人值守 / 定时 | 不行 | 可以（headless） |
| 落库校验 | 无（不声称已保存） | 有（另起干净浏览器比对） |
| 状态 | 可用，非官方接口 | 可用，非官方接口 |

两套改的是**同一份文档、同一份数据**，共用同一份桥接层，互不影响。按你用的 AI 工具选一套。

## 桥接层：一份源码，多个产物

改图能力全在 `bridge/pobridge.js` 这 8KB 里。它利用 ProcessOn 页面的 `Model` /
`MessageSource` / `Designer` 做增量写入，关键是用 `MessageSource.executeMessages(msg, true)`
—— 直接调 `Model.addMulti()` 只改数据、画布不重绘。

```bash
node bridge/build.mjs           # 构建全部产物
node bridge/build.mjs --check   # 校验产物是否与源码一致（漂移则退出码 1）
```

| 产物 | 给谁用 |
|---|---|
| `dsh/skill/.../pobridge.min.js` | DSH：注入到标签页 |
| `dsh/skill/.../scripts/bookmarklet.txt` | 书签：人工点一下 |
| `wb/pobridge.js` | WorkBuddy：Playwright 直接注入 |

以前同一个桥接层在仓库里有 5 份产物、3 种内容，没有构建脚本 —— 没人能证明哪份是新的。
现在只有一份源码，所有产物都能重算、能被 `--check` 抓出漂移。

## 测试

```bash
cd dsh/skill/dsh-processon-diagram-editor
node test/selftest.mjs   # 36 项离线断言（页面片段/转义/守卫/自包含/书签版本）
node test/parity.mjs     # 两个产物行为是否一致（压缩后仍等价）

cd wb
node test/selftest.mjs   # 24 项离线断言
node test/smoke.mjs      # 只读集成：真开一次页面读图（需先 set-url）
```

全部离线可跑，不需要浏览器、不碰任何文档。

## 分发

```bash
node wb/tools/build-dist.mjs    # 从源头重新组装 dist/ 并打 zip
```

`dist/` 是**构建产物，不入库**。它由 `dsh/` + `wb/` + `packaging/` 重新组装，
所以任何对源码的修改都必须走这个脚本，别手改 `dist/`。

打包文案源头在 `packaging/`：

| 文件 | 作用 |
|---|---|
| `README.md` | 分发包总说明 |
| `01-DSH方案-安装指南.md` | DSH 方案给同事的步骤 |
| `02-WorkBuddy方案-安装指南.md` | WorkBuddy 方案给同事的步骤 |
| `03-通用工具-说明.md` | 通用工具（书签）说明 |
| `03-书签安装页.html` | 书签安装页 |

WorkBuddy 侧技能 `wb-processon-diagram-editor` 的 `runtime/` 是 `wb/tools/sync-skill.mjs`
同步生成的，改代码请改 `wb/` 再同步，别手改 runtime。

## 已知限制（两套都有）

- **非官方接口**：`Model` / `MessageSource` / `Designer` 无稳定性承诺，ProcessOn 前端发版可能失效。
  失效时应当如实报错，不假装成功。
- **文字颜色改不动**：元素级 `fontColor` 会写进模型，但文字层仍渲染成深灰。
  红标靠边框/填充/连线。
- **改动会实时广播**：走协同通道，动手前最好在群里说一声。
- **别拿没备份的重要图做实验**。
