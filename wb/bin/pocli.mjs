#!/usr/bin/env node
/**
 * pocli —— ProcessOn 画布增量改图 CLI（Playwright 后端）
 *
 * 不依赖 DSH / 浏览器扩展 / 用户已登录的浏览器：
 * 自己起 Chromium，凭 URL 里的 encrypted_session 进编辑态，注入桥接层改图，
 * 默认 Ctrl+S 保存，可选 verify 开干净上下文确认落库。
 *
 * 用法示例：
 *   node bin/pocli.mjs set-url "<编辑页URL>"
 *   node bin/pocli.mjs read --json g.json
 *   node bin/pocli.mjs add --text "报告归档" --from <nodeId> --gap 80 --verify
 *   node bin/pocli.mjs shot --fit --out after.png
 *   node bin/pocli.mjs verify --expect-nodes 53
 *
 * 退出码：0 成功 / 2 用法错 / 3 读图或渲染失败 / 4 落库校验不一致 / 5 登录墙 / 6 页面异常 / 7 环境缺 Chromium
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PwDriver, PoError, findChromium, readServerCopy } from '../lib/pw.mjs';
import { parseArgs, num, flag } from '../lib/args.mjs';
import * as P from '../lib/page.mjs';
import { resolveBridgeFile } from '../lib/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STATE_FILE = process.env.PO_STATE || path.join(ROOT, '.pocli-state.json');

// 两种部署形态（仓库内 / 技能运行时）由 lib/paths.mjs 统一解析
const BRIDGE_FILE = resolveBridgeFile(ROOT);

const RED = { fill: '255,235,235', line: '255,0,0', font: '255,0,0' };
const PLAIN = { fill: '', line: '33,41,48', font: '' };

// ---------------------------------------------------------------- io helpers

/** 同步写 stdout：避免 write 后立刻 exit 导致管道里 JSON 被截断。 */
function out(obj, pretty = true) {
  fs.writeSync(1, JSON.stringify(obj, null, pretty ? 1 : 0) + '\n');
}

/** 输出前打码：会话令牌、票据一律不外泄（Playwright 报错里会带完整 URL）。 */
function redact(v) {
  if (v === null || v === undefined) return v;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s
    .replace(/(encrypted_session=)[^&\s"']+/gi, '$1<redacted>')
    .replace(/\b(token|ticket|access_token|session)=([^&\s"']+)/gi, '$1=<redacted>');
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new CliError(2, `状态文件损坏（${STATE_FILE}）：${e.message.replace(/^.*?:\s*/, '')}。删掉它再跑 set-url 即可。`);
  }
}
function saveState(patch) {
  const next = { ...loadState(), ...patch };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  // state 只存非敏感元数据，票据一律不落盘；POSIX 的 0o600 只是锦上添花，
  // 在 Windows/NTFS 上并不生效，不能当作保护措施。
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 1), { mode: 0o600 });
  return next;
}
function newId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomInt(0, 1000000)}`;
}

/**
 * 用法/业务错误一律抛异常，由 main 统一转成退出码。
 * 不要在 withDriver 里 process.exit —— 那会跳过 finally，把 Chromium 留成孤儿进程。
 */
class CliError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.detail = detail ?? null;
  }
}
const die = (code, msg, detail) => { throw new CliError(code, msg, detail); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveUrl(args) {
  // 票据（encrypted_session）等同编辑权限，只从 --url / PO_URL 读取，
  // 绝不写进、也不从 .pocli-state.json 读取，避免明文落盘与外传。
  const url = args.url || process.env.PO_URL;
  if (!url) die(2, '没有文档 URL：请用 --url 传入，或设置 PO_URL 环境变量（票据不写入状态文件）。');
  if (!/file_id=\d+/.test(url)) die(2, 'URL 里没有 file_id，看起来不是 ProcessOn 编辑页。');
  return url;
}

/** 页面片段用 {error:'...'} 报错——宿主侧必须拦，否则会把失败当成功。 */
function assertNoError(r, what) {
  if (r && typeof r === 'object' && r.error) {
    die(3, `${what}失败：${r.error}`, r);
  }
  return r;
}

// ---------------------------------------------------------------- driver plumbing

async function withDriver(args, fn) {
  if (!findChromium() && !process.env.PO_CHROMIUM) {
    die(7, '找不到 Chromium：先跑 `npx playwright install chromium`，或用 PO_CHROMIUM 指定可执行文件路径。');
  }
  const driver = new PwDriver({
    headless: !flag(args.headed),
    timeout: num(args.timeout) ?? 45000,
    profileDir: process.env.PO_PROFILE || path.join(os.homedir(), '.cache', 'pocli-profile'),
  });
  try {
    const url = resolveUrl(args);
    const st = await driver.open(url);
    await driver.inject(fs.readFileSync(BRIDGE_FILE, 'utf8'));
    return await fn(driver, { url, ready: st });
  } finally {
    await driver.close();
  }
}

/**
 * 写操作执行器。
 * 页面 eval 可能"超时但已生效"，所以：先用探测确认实际状态，再决定要不要重试。
 * 探测本身失败（页面卡死）不能当成"不存在"，否则正是我们要防的重复图元。
 */
async function applyOnce(driver, expr, existingId, { retries = 1 } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return assertNoError(await driver.evalJson(expr, { retries: 0 }), '改图');
    } catch (e) {
      if (e instanceof CliError) throw e; // 页面明确报错（如 NOT_FOUND），不重试
      last = e;
      if (existingId) {
        let there;
        try {
          there = await driver.evalJson(P.existsExpr(existingId), { retries: 1 });
        } catch (probeErr) {
          throw new CliError(6, `写操作结果未知，且复查也失败：${probeErr.message}。请先用 read 确认现状，不要盲目重试。`, probeErr);
        }
        if (there === true) return { recovered: true, id: existingId };
      }
      if (i < retries) await sleep(600);
    }
  }
  throw last;
}

/**
 * 保证整个节点矩形都落在视口内。
 * ProcessOn 的 clamp 是 x <= vb.x + vb.w - w - 40，只看点会在右侧留出 w 的死区。
 */
async function ensurePointVisible(driver, x, y, w, h, { margin = 100 } = {}) {
  const readVb = () => driver.evalJson(P.VIEWBOX).catch(() => null);
  const insideOf = (vb) => !!vb && typeof vb.x === 'number'
    && x > vb.x + margin && x + w < vb.x + vb.w - margin
    && y > vb.y + margin && y + h < vb.y + vb.h - margin;

  const vb0 = await readVb();
  if (insideOf(vb0)) return { fitted: false, fitFailed: false, inside: true, vb: vb0 };

  let fitResult = 'unknown';
  try {
    fitResult = await Promise.race([driver.page.evaluate(P.FIT_CANVAS), sleep(3000).then(() => 'timeout')]);
  } catch { fitResult = 'blocked'; }   // 重绘阻塞页面是常态，不算失败
  await sleep(700);

  const vb1 = await readVb();
  return {
    fitted: true,
    fitFailed: fitResult !== 'ok' && fitResult !== 'blocked' && fitResult !== 'timeout',
    inside: insideOf(vb1),
    vb: vb1,
  };
}

async function maybeSave(driver, args) {
  if (flag(args['no-save'])) return { saved: false, reason: 'no-save' };
  await driver.save();
  return { saved: true };
}

/**
 * 保存之后才校验。校验失败**不能**让整条命令报失败——
 * 改动已经写进去了，用户重跑就会多一个重复图元。所以分开报。
 */
async function maybeVerify(args, expectedNodes) {
  if (!flag(args.verify)) return null;
  try {
    const server = await readServerCopy(resolveUrl(args));
    const ok = expectedNodes === undefined ? undefined : server.nodes === expectedNodes;
    return { ok, server, expectedNodes: expectedNodes ?? null };
  } catch (e) {
    return {
      ok: null,
      error: redact(e.message),
      note: '改动已写入并保存；只是这次没能确认。请用 read 或 verify 复查，不要重跑改图命令。',
    };
  }
}

/** 改动前的图形数，用于给 verify 一个预期值。 */
async function countNow(driver) {
  const c = await driver.evalJson(P.COUNT).catch(() => null);
  return c && !c.error ? c : null;
}

// ---------------------------------------------------------------- commands

const cmds = {
  async status(args) {
    const st = loadState();
    let version = null;
    try {
      version = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'playwright-core', 'package.json'), 'utf8')).version;
    } catch { version = null; }
    out({
      ok: true,
      playwrightCore: version,
      chromium: findChromium() || '（未找到缓存；需 npx playwright install chromium）',
      bridgeFile: fs.existsSync(BRIDGE_FILE) ? BRIDGE_FILE : null,
      docUrl: st.url ? redact(st.url) : null,
      stateFile: STATE_FILE,
    });
    if (flag(args.probe)) {
      const driver = new PwDriver({ headless: !flag(args.headed), timeout: 45000 });
      try {
        const r = await driver.open(resolveUrl(args));
        out({ ok: true, probe: r, timings: driver.timings });
      } finally {
        await driver.close();
      }
    }
  },

  async 'set-url'(args) {
    const url = args._[0] || args.url;
    if (!url || url === true || !/file_id=\d+/.test(url)) die(2, '用法：pocli set-url "<含 file_id 的编辑页 URL>"');
    const fileId = (url.match(/file_id=(\d+)/) || [])[1];
    // 只记非敏感元数据；含 encrypted_session 的完整 URL 绝不写入磁盘。
    saveState({ fileId, updatedAt: new Date().toISOString() });
    out({ ok: true, fileId, note: '票据未落盘；后续命令请用 --url 或 PO_URL 传入完整 URL', saved: STATE_FILE });
  },

  async read(args) {
    return withDriver(args, async (driver) => {
      const g = assertNoError(await driver.evalJson(P.READ_GRAPH), '读图');
      if (!Array.isArray(g.nodes)) die(3, '读图返回结构异常', g);
      if (args.json && args.json !== true) fs.writeFileSync(args.json, JSON.stringify(g, null, 1));
      const pool = await driver.evalJson(P.POOL_BOTTOM).catch(() => null);
      out({
        ok: true,
        elements: g.nodes.length + g.edges.length,
        nodes: g.nodes.length,
        edges: g.edges.length,
        page: { w: g.page.width, h: g.page.height },
        pool: pool && !pool.error ? { bottom: pool.bottom, x: pool.x, w: pool.w } : null,
        lanes: g.nodes.filter((n) => n.isLane).map((n) => n.text),
        json: args.json && args.json !== true ? args.json : null,
        timings: driver.timings,
      });
    });
  },

  async add(args) {
    if (!args.text || args.text === true) die(2, '需要 --text');
    return withDriver(args, async (driver) => {
      const style = flag(args.plain) ? PLAIN : RED;
      const from = args.from && args.from !== true ? args.from : null;
      const w = num(args.w) ?? 200;
      const h = num(args.h) ?? 70;
      let x = num(args.x);
      let y = num(args.y);
      if (args.x !== undefined && x === undefined) die(2, `--x 不是合法数字：${args.x}`);
      if (args.y !== undefined && y === undefined) die(2, `--y 不是合法数字：${args.y}`);

      const missing = (x === undefined) !== (y === undefined);
      if (missing) die(2, '--x 与 --y 必须同时给，或都用 --from 推导（只给一个会得到意料之外的位置）');

      const before = await countNow(driver);

      if (from && x === undefined) {
        const g = assertNoError(await driver.evalJson(P.READ_GRAPH), '读图');
        const node = g.nodes.find((n) => n.id === from);
        if (!node) die(3, `--from 指定的节点不存在：${from}`);
        x = Math.round(node.x + node.w / 2 - w / 2);
        y = Math.round(node.y + node.h + (num(args.gap) ?? 80));
      }
      if (x === undefined) die(2, '需要 --from，或同时给 --x 与 --y');

      const vis = await ensurePointVisible(driver, x, y, w, h);
      const id = newId('ai_node');
      const node = await applyOnce(driver, P.createNodeExpr({
        id, text: args.text, x, y, w, h,
        name: args.name || 'process',
        fill: style.fill, line: style.line, font: style.font,
      }), id);

      let edge = null;
      if (from) {
        const eid = newId('ai_edge');
        edge = await applyOnce(driver, P.createEdgeExpr({ id: eid, from, to: id, text: args['edge-text'] || '' }), eid);
      }

      const saved = await maybeSave(driver, args);
      const verify = await maybeVerify(args, before ? before.nodes + 1 : undefined);
      out({
        ok: true,
        node, edge, at: { x, y }, ...saved,
        fitted: vis.fitted ? (vis.fitFailed ? '整页适应失败，已尽力放置' : '坐标不在视口内，已先整页适应') : null,
        alert: node.clamped
          ? `坐标仍被夹过：requested=${JSON.stringify(node.requested)} actual=${JSON.stringify(node.actual)}。请人工确认位置。`
          : null,
        verify,
      });
    });
  },

  async update(args) {
    if (!args.id || args.id === true) die(2, '需要 --id');
    // 参数校验放在起浏览器之前：打错字不该花 5 秒开一个页面再报错
    const patch = {};
    for (const k of ['x', 'y', 'w', 'h']) {
      if (args[k] === undefined) continue;
      const v = num(args[k]);
      if (v === undefined) die(2, `--${k} 不是合法数字：${args[k]}`);
      patch[k] = v;
    }
    for (const k of ['text', 'fill', 'line', 'font']) {
      if (args[k] !== undefined) patch[k] = String(args[k]);
    }
    if (!Object.keys(patch).length) die(2, '没有要改的字段（--text/--x/--y/--w/--h/--fill/--line/--font）');

    return withDriver(args, async (driver) => {
      const before = await countNow(driver);
      const r = await applyOnce(driver, P.updateNodeExpr(args.id, patch), null);
      const saved = await maybeSave(driver, args);
      const verify = await maybeVerify(args, before ? before.nodes : undefined);
      out({ ok: true, result: r, ...saved, verify });
    });
  },

  async remove(args) {
    if (!args.ids || args.ids === true) die(2, '需要 --ids a,b');
    const ids = String(args.ids).split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) die(2, '--ids 为空；不要对空数组调用删除');
    return withDriver(args, async (driver) => {
      const before = await countNow(driver);
      const r = await applyOnce(driver, P.removeNodesExpr(ids), null);
      if (!r || !Array.isArray(r.stillThere)) {
        const still = [];
        for (const id of ids) {
          if (await driver.evalJson(P.existsExpr(id), { retries: 1 }).catch(() => false) === true) still.push(id);
        }
        r = { ...(r || {}), stillThere: still };
      }
      const saved = await maybeSave(driver, args);
      const verify = await maybeVerify(args, before ? before.nodes - ids.length : undefined);
      const ok = r.stillThere.length === 0;
      out({ ok, result: r, ...saved, verify });
      if (!ok) process.exit(3);
    });
  },

  async edge(args) {
    if (!args.from || args.from === true || !args.to || args.to === true) die(2, '需要 --from 与 --to');
    return withDriver(args, async (driver) => {
      const id = newId('ai_edge');
      const r = await applyOnce(driver, P.createEdgeExpr({ id, from: args.from, to: args.to, text: args.text || '' }), id);
      const saved = await maybeSave(driver, args);
      out({ ok: r.exists === true, result: r, ...saved });
      if (r.exists !== true) process.exit(3);
    });
  },

  async view(args) {
    return withDriver(args, async (driver) => {
      let result = null;
      if (flag(args.fit)) {
        try { result = await Promise.race([driver.page.evaluate(P.FIT_CANVAS), sleep(3000).then(() => 'timeout')]); } catch { result = 'blocked'; }
      } else if (args.focus && args.focus !== true) {
        const ids = String(args.focus).split(',').map((s) => s.trim()).filter(Boolean);
        try { result = await Promise.race([driver.page.evaluate(P.focusExpr(ids)), sleep(3000).then(() => 'timeout')]); } catch { result = 'blocked'; }
      } else die(2, '需要 --fit 或 --focus <ids>');
      await sleep(800);
      const vb = await driver.evalJson(P.VIEWBOX).catch(() => null);
      const fitFailed = typeof result === 'string' && result.startsWith('err:');
      out({ ok: !fitFailed, action: flag(args.fit) ? 'fit' : 'focus', pageResult: result, viewBox: vb });
      if (fitFailed) process.exit(3);
    });
  },

  async shot(args) {
    if (args.out === true) die(2, '--out 需要一个文件路径');
    const file = path.resolve(args.out || `processon-${Date.now()}.png`);
    return withDriver(args, async (driver) => {
      // 每条命令都是新进程新页面，"上次 view 的视口"不会保留 —— 必须在同一次调用里做
      let framed = null;
      if (flag(args.fit)) {
        try { await Promise.race([driver.page.evaluate(P.FIT_CANVAS), sleep(3000)]); } catch { /* 阻塞属正常 */ }
        framed = 'fit';
        await sleep(700);
      } else if (args.focus && args.focus !== true) {
        const ids = String(args.focus).split(',').map((s) => s.trim()).filter(Boolean);
        try { await Promise.race([driver.page.evaluate(P.focusExpr(ids)), sleep(3000)]); } catch { /* 同上 */ }
        framed = 'focus';
        await sleep(700);
      }
      const painted = await driver.waitPainted();
      await driver.screenshot(file, { waitPaint: false });
      const bytes = fs.statSync(file).size;
      const ok = !!painted && bytes > 5000;
      out({ ok, file, bytes, framed, painted: !!painted, viewBox: await driver.evalJson(P.VIEWBOX).catch(() => null) });
      if (!ok) process.exit(3);
    });
  },

  async save(args) {
    return withDriver(args, async (driver) => {
      await driver.save({ settle: num(args.settle) ?? 1500 });
      out({ ok: true, note: 'Ctrl+S 已发送。ProcessOn 无保存提示，确认落库请跑 verify。' });
    });
  },

  async verify(args) {
    const expect = num(args['expect-nodes']);
    let server;
    try {
      server = await readServerCopy(resolveUrl(args));
    } catch (e) {
      out({ ok: false, error: redact(e.message), detail: e.detail ? redact(e.detail) : null });
      process.exit(e instanceof PoError && e.code === 'LOGIN_GATE' ? 5 : 6);
    }
    const ok = expect === undefined ? true : server.nodes === expect;
    out({ ok, server, expectNodes: expect ?? null });
    if (!ok) process.exit(4);
  },

  /** 给"会话内原生 browser_* 工具"后端用的 JS 片段，粘过去即可。 */
  async snippet(args) {
    const kind = args._[0] || 'read';
    const map = {
      read: P.READ_GRAPH,
      count: P.COUNT,
      pool: P.POOL_BOTTOM,
      viewbox: P.VIEWBOX,
      fit: P.FIT_CANVAS,
      ready: P.READY,
    };
    if (kind === 'inject') {
      out({ ok: true, js: P.injectExpr(fs.readFileSync(BRIDGE_FILE, 'utf8')) }, false);
      return;
    }
    if (kind === 'add') {
      out({ ok: true, js: P.createNodeExpr({
        id: args.id || newId('ai_node'),
        text: args.text || '示例节点',
        x: num(args.x) ?? 100, y: num(args.y) ?? 100,
        w: num(args.w) ?? 200, h: num(args.h) ?? 70,
        name: args.name || 'process', fill: RED.fill, line: RED.line, font: RED.font,
      }) }, false);
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(map, kind)) {
      die(2, `未知片段：${kind}（可选 ${Object.keys(map).join('|')}|inject|add）`);
    }
    out({ ok: true, js: map[kind] }, false);
  },
};

// ---------------------------------------------------------------- main

try {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();

  if (!cmd || cmd === '-h' || cmd === '--help') {
    out({
      usage: 'pocli <command> [--flags]',
      commands: Object.keys(cmds),
      examples: [
        'pocli set-url "<编辑页URL>"',
        'pocli status --probe',
        'pocli read --json g.json',
        'pocli add --text "报告归档" --from <id> --gap 80 --verify',
        'pocli shot --fit --out after.png',
        'pocli save && pocli verify --expect-nodes 53',
        'pocli snippet read',
      ],
    });
    process.exit(0);
  }
  if (!Object.prototype.hasOwnProperty.call(cmds, cmd)) die(2, `未知命令：${cmd}`);
  if (!fs.existsSync(BRIDGE_FILE)) die(2, `找不到桥接层源码：${BRIDGE_FILE}（可用 PO_BRIDGE_FILE 指定）`);

  await cmds[cmd](parseArgs(argv));
} catch (e) {
  const code = e instanceof CliError ? e.code
    : e instanceof PoError ? (e.code === 'LOGIN_GATE' ? 5 : e.code === 'NO_CHROMIUM' ? 7 : 6)
      : 1;
  out({
    ok: false,
    code,
    error: redact(e && e.message ? e.message : String(e)),
    detail: e && e.detail ? redact(e.detail) : null,
  });
  process.exit(code);
}
