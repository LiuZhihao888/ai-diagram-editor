/**
 * Playwright 传输层：自带 Chromium，驱动 ProcessOn 编辑页。
 *
 * 设计取舍：
 * - 用 launchPersistentContext + 固定 profile 目录：复用缓存，第二次起明显更快。
 * - 全程 headless 优先（画布是 canvas + DOM，headless 能跑），需要肉眼核对时 --headed。
 * - 一切等待都走"轮询就绪条件 + 超时"，不用固定 sleep。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { READY, injectExpr } from './page.mjs';

// 依赖缺失时给一句人话，而不是一坨 import 堆栈
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: 7,
    error: '缺少依赖 playwright-core：在当前目录执行 `npm install --omit=dev`（只装客户端，不下载浏览器）',
  }) + '\n');
  process.exit(7);
}

export class PoError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'PoError';
    this.code = code;
    this.detail = detail;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在 ms-playwright 缓存里找最新的 chromium 可执行文件。 */
export function findChromium() {
  if (process.env.PO_CHROMIUM && fs.existsSync(process.env.PO_CHROMIUM)) return process.env.PO_CHROMIUM;
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of dirs) {
      for (const rel of [
        ['chrome-win64', 'chrome.exe'],
        ['chrome-win', 'chrome.exe'],
        ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
        ['chrome-linux', 'chrome'],
      ]) {
        const p = path.join(root, d, ...rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null; // 交给 playwright 默认解析（需要事先 install）
}

export class PwDriver {
  constructor(opts = {}) {
    this.headless = opts.headless !== false;
    this.timeout = opts.timeout ?? 45000;
    this.profileDir = opts.profileDir ?? path.join(os.homedir(), '.cache', 'pocli-profile');
    this.slowMo = opts.slowMo ?? 0;
    this.log = opts.log ?? (() => {});
    this.context = null;
    this.page = null;
    this.executablePath = findChromium();
  }

  async open(url) {
    fs.mkdirSync(this.profileDir, { recursive: true });
    const launchOpts = {
      headless: this.headless,
      viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
      slowMo: this.slowMo,
    };
    if (process.env.PO_PROXY) launchOpts.proxy = { server: process.env.PO_PROXY };

    this.context = await chromium.launchPersistentContext(this.profileDir, launchOpts);
    this.context.setDefaultTimeout(this.timeout);
    await this.context.addInitScript(() => {
      // 隐藏自动化痕迹
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // 关掉首次访问的新手引导浮层（div.step / 下一步 / 跳过）。
      // 它既不在 [class*=dialog] 里、也捕不到 dialog 事件，会压住左侧图形库。
      try { localStorage.setItem('po_flow_tutorial', '1'); } catch (e) {}
    });

    const pages = this.context.pages();
    this.page = pages.length ? pages[0] : await this.context.newPage();
    this.page.setDefaultTimeout(this.timeout);

    // 只读场景下任何原生弹窗（含"已在其他窗口打开"）一律取消，避免卡死。
    this.dialogs = [];
    this.page.on('dialog', async (d) => {
      this.dialogs.push({ type: d.type(), message: d.message() });
      await d.dismiss().catch(() => {});
    });
    this.page.on('pageerror', (e) => this.log(`pageerror: ${String(e).slice(0, 160)}`));

    const t0 = Date.now();
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeout });
    const tGoto = Date.now();
    const state = await this.waitReady();
    this.timings = { gotoMs: tGoto - t0, readyMs: Date.now() - tGoto };
    return state;
  }

  /** 轮询直到 Model 有图元；把"登录墙"这类情况变成可读错误。 */
  async waitReady({ timeout = null } = {}) {
    const deadline = Date.now() + (timeout ?? this.timeout);
    let last = null;
    while (Date.now() < deadline) {
      let raw;
      try {
        raw = await this.page.evaluate(READY);
      } catch (e) {
        last = { error: String(e).slice(0, 200) };
        await sleep(400);
        continue;
      }
      let s;
      try { s = JSON.parse(raw); } catch { s = { raw }; }
      if (s.ready) return { ready: true, elements: s.elements, gate: null };
      last = s;
      if (s.gate) {
        throw new PoError('LOGIN_GATE', `页面停在登录/无权限状态（命中「${s.gate}」）。URL 里的 encrypted_session 可能已过期，请在浏览器打开这张图后复制最新 URL。`, s);
      }
      await sleep(400);
    }
    throw new PoError('NOT_READY', 'ProcessOn 画布在超时内没有初始化（Model 为空）。', last);
  }

  async inject(pobridgeSrc) {
    const raw = await this.page.evaluate(injectExpr(pobridgeSrc));
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!r || r.bridge !== 'object') {
      throw new PoError('INJECT_FAILED', '桥接层注入失败：页面里没有 Model/MessageSource，或不是编辑态。', r);
    }
    return r;
  }

  /** 执行返回 JSON 字符串的表达式；非 JSON 原样返回。 */
  async evalJson(expr, { retries = 2 } = {}) {
    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
      try {
        const raw = await this.page.evaluate(expr);
        if (raw === undefined || raw === null) return null;
        if (typeof raw === 'string') {
          try { return JSON.parse(raw); } catch { return raw; }
        }
        return raw;
      } catch (e) {
        lastErr = e;
        if (i < retries) await sleep(500);
      }
    }
    throw new PoError('EVAL_FAILED', `页面执行失败：${String(lastErr).slice(0, 300)}`, lastErr);
  }

  /**
   * 等画布真的画出来。
   * Model 就绪 ≠ 画面已绘制：缩略图/画布可能还是一片空白，此时截图必白屏。
   * 判据用状态栏的「图形数」文案 + shape 节点数，两者都出现才算画完。
   */
  async waitPainted({ timeout = 15000 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const st = await this.page.evaluate(`(function(){
        var txt = (document.body && document.body.innerText || '');
        var m = /图形数[\\s:：]*(\\d+)/.exec(txt);
        return JSON.stringify({
          labeled: m ? Number(m[1]) : null,
          shapes: document.querySelectorAll('[id^="ai_node"],[class*="shape"]').length
        });
      })()`).catch(() => null);
      let s = null;
      try { s = st ? JSON.parse(st) : null; } catch { s = null; }
      if (s && s.labeled > 0) return s;
      await sleep(250);
    }
    return null;
  }

  async screenshot(file, { waitPaint = true } = {}) {
    if (waitPaint) await this.waitPainted();
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    await this.page.screenshot({ path: file });
    return file;
  }

  /** Ctrl+S。ProcessOn 没有保存态 UI，落库要靠 verify 侧确认。 */
  async save({ settle = 1200 } = {}) {
    await this.page.evaluate(() => { try { document.body.focus(); } catch (e) {} });
    await this.page.keyboard.press('Control+s');
    await sleep(settle);
    return true;
  }

  async close() {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
    }
  }
}

/**
 * 用全新上下文（无 profile、无 Cookie）读服务端副本 —— 判断"到底存没存"的唯一可靠手段。
 * 独立 launch，避免复用 profile 带来任何残留。
 */
export async function readServerCopy(url, { executablePath = findChromium(), timeout = 60000 } = {}) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: executablePath || undefined,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    page.setDefaultTimeout(timeout);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const raw = await page.evaluate(READY).catch(() => null);
      let s = null;
      try { s = raw ? JSON.parse(raw) : null; } catch { s = null; }
      if (s && s.ready) {
        const cnt = await page.evaluate(`(function(){
          var e = window.Model.define.elements, n = 0, l = 0;
          for (var k in e) { var x = e[k]; (x.name === 'linker' || x.from || x.to) ? l++ : n++; }
          return JSON.stringify({nodes: n, edges: l});
        })()`);
        await ctx.close();
        return JSON.parse(cnt);
      }
      if (s && s.gate) throw new PoError('LOGIN_GATE', `校验页被登录墙拦住（${s.gate}），无法确认落库。`, s);
      await sleep(500);
    }
    await ctx.close();
    throw new PoError('VERIFY_TIMEOUT', `校验页 ${Math.round(timeout / 1000)}s 内没加载完，无法确认落库。`);
  } finally {
    await browser.close().catch(() => {});
  }
}
