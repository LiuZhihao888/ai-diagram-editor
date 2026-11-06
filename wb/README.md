# pocli —— ProcessOn 画布增量改图（Playwright 后端）

不装扩展、不开浏览器、不依赖任何外部桥接服务：自己起一个 Chromium，凭文档 URL 里的
`encrypted_session` 直接进编辑态，注入 4KB 桥接层后做增量改图，默认 Ctrl+S 保存。

```
wb/
├── bin/pocli.mjs        CLI 入口（13 个子命令）
├── lib/pw.mjs           Playwright 传输层（启动/就绪/注入/截图/保存/服务端校验）
├── lib/page.mjs         页面侧 JS 片段（传输无关，原生工具后端可原样复用）
├── lib/args.mjs         参数解析（无依赖，可测）
├── test/selftest.mjs    离线自检：JS 片段可编译 + 注入安全 + 参数边界（24 项）
├── test/smoke.mjs       集成冒烟：真开页面 → 注入 → 读图 → 截图（只读）
└── .gitignore           忽略 node_modules / 运行时状态 / 测试截图
```

## 快速开始

```bash
cd wb
npm i                                   # 只装 playwright-core，不下载浏览器
node bin/pocli.mjs set-url "<编辑页URL>"   # 形如 https://wps.processon.com/diagrams/edit?...&file_id=xxx
node bin/pocli.mjs status --probe        # 自检 + 实际打开一次
node bin/pocli.mjs read --json g.json    # 读结构（节点/连线/泳道/池底）
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `read [--json f]` | 读图；输出节点数/连线数/泳道名/泳道池底坐标 |
| `add --text T [--from ID --gap 80] [--x --y --w --h] [--plain] [--no-save] [--verify]` | 加节点（默认红色），可自动连线 |
| `update --id ID [--text/--x/--y/--w/--h/--fill/--line/--font]` | 改节点 |
| `remove --ids a,b` | 删节点（空数组会被拒绝） |
| `edge --from A --to B [--text 是]` | 连线 |
| `view --fit` / `--focus a,b` | 整页适应 / 滚到某图元（**只在同一次调用内有效**，跨进程不保留） |
| `shot --out x.png [--fit] [--focus ids]` | 截图。先等画布真的画出来（不会白屏）；需要整页/局部视野就带 `--fit` 或 `--focus` |
| `save` | 按 Ctrl+S |
| `verify --expect-nodes N` | 开干净上下文读服务端副本，确认真的落库 |
| `snippet read\|count\|pool\|viewbox\|fit\|inject\|add` | 输出可直接粘给会话内 `browser_evaluate` 的 JS |

全部命令输出 JSON；失败退出码：`2` 用法错、`3` 读图/渲染失败、`4` 校验不一致、`5` 登录墙、`6` 页面异常。

## 实测数据（Windows 11 / Edge 同机 / 2026-11-04）

| 场景 | 耗时 |
|---|---|
| 冷启动打开页面 → 就绪 | ~6.9 s |
| 热启动（profile 复用）→ 就绪 | 1.9 ~ 2.2 s |
| `read` 全流程（含进程启动） | **5.3 s** |
| `smoke`（开页+注入+读图+截图） | **3.3 s** |
| `add` + Ctrl+S（不含 verify） | ~7 s |
| `add` + Ctrl+S + `verify` | ~12 s |

无登录墙、无扩展依赖。身份来自 URL 里的 `encrypted_session`；本地 profile 只复用浏览器缓存（提速），不放登录态。同一份文档在别处打开着也不冲突（实测 6 次并发进入无弹窗）。

## 三个必须知道的机制

1. **必须走 `MessageSource.executeMessages(msg, true)`**。直接 `Model.addMulti()` 只改数据、画布不重绘。
2. **坐标会被静默夹进 `Utils.canvasViewBox`**。越界不报错、`rendered` 仍是 true，位置全错。
   `pocli add` 会先判断目标点是否在视口内，不在就先 `Designer.fitTheCanvas()` 再放，并在输出里标 `fitted`。
3. **Model 就绪 ≠ 画面已绘制**。此时截图是白屏。`shot` 会等状态栏「图形数」出现才截。

## 已知限制

- 文字颜色改不动：元素级 `fontStyle.fontColor` 会被写入，但 ProcessOn 的文字层仍渲染成深灰。
  红色标记体现在边框/填充/连线上。要红字得人工在右侧面板改。
- 非官方接口：`Model` / `MessageSource` / `Designer` 没有任何稳定性承诺，前端发版即可能失效。
  失效时 `read` 会明确报 `NO_BRIDGE` / `NO_MODEL`，不会假装成功。
- 改动会通过协同通道实时广播给同事；Ctrl+S 保存的是整张图当前状态，不只你改的那处。

## 测试

```bash
node test/selftest.mjs   # 24 项，无需浏览器
node test/smoke.mjs      # 只读集成，约 3 秒
```

## 部署到 WorkBuddy 技能

技能目录（`~/.workbuddy/skills/wb-processon-diagram-editor`）里的 `runtime/` 是**生成物**，
由本仓库同步过去，别手改：

```bash
node tools/sync-skill.mjs            # 仓库 → 技能
node tools/sync-skill.mjs --check    # 校验一致性（不一致退出码 1，可放进 CI）
node tools/sync-skill.mjs --install  # 同步并在技能里装依赖
```

`runtime/SYNC.json` 记录来源 commit 与每个文件的哈希，便于追溯"技能里跑的是哪一版"。

## 清理

浏览器 profile 落在 `~/.cache/pocli-profile`（Windows: `C:\Users\<你>\.cache\pocli-profile`），
文档 URL 落在 `wb/.pocli-state.json`（已 gitignore）。要清干净：

```bash
rm -rf ~/.cache/pocli-profile .pocli-state.json
```
