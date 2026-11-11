#!/usr/bin/env node
/**
 * 唯一的桥接层构建入口 —— 从 bridge/pobridge.js 生成所有分发产物。
 *
 *   node bridge/build.mjs           # 构建全部产物
 *   node bridge/build.mjs --check   # 只校验产物是否与源码一致（CI / 交付前）
 *
 * 为什么要有这个脚本：以前同一个桥接层在仓库里有 5 份产物、3 种内容，
 * 没有构建脚本就没人能证明哪份是新的。现在源码只有一份，产物都能重算。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(HERE, 'pobridge.js');
const MANIFEST = path.join(HERE, 'build', 'MANIFEST.json');

/** 产物清单：一个逻辑产物 → 多处落盘位置。 */
const TARGETS = [
  // DSH 技能：控制台粘贴 / 注入用压缩版
  { format: 'min', to: 'dsh/skill/dsh-processon-diagram-editor/pobridge.min.js' },
  // WorkBuddy 运行时：Playwright 直接注入源码，保留可读性
  { format: 'iife', to: 'wb/pobridge.js' },
  // 书签：人工点一下即可注入，带成功提示条
  { format: 'bookmarklet', to: 'dsh/skill/dsh-processon-diagram-editor/scripts/bookmarklet.txt' },
  // 书签安装页：同一份 href 嵌进 HTML，纳入 --check 防止产物漂移
  { format: 'installHtml', to: 'dsh/skill/dsh-processon-diagram-editor/scripts/install-bookmarklet.html' },
];

const check = process.argv.includes('--check');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

if (!fs.existsSync(SRC)) {
  console.error('✗ 缺少桥接层源码：' + SRC);
  process.exit(2);
}
const source = fs.readFileSync(SRC, 'utf8');
const sourceHash = sha(source);

/**
 * 包成独立 IIFE。
 * 源码本身是 (function(global){...})(window)，已经自带作用域，
 * 这里只做语法层包装，确保粘贴到控制台/书签时不会污染全局。
 */
function wrap(src) {
  return '(function(){\n' + src.trim() + '\n})();\n';
}

async function minify(src) {
  const esbuildDir = path.join(HERE, 'node_modules', 'esbuild');
  if (!fs.existsSync(esbuildDir)) {
    // 不联网、不隐式安装：缺依赖就明确报错，让调用方先 npm ci。
    console.error('✗ 缺本地 esbuild：请先在各包目录执行 npm ci / npm install 再构建。');
    console.error('  期望路径：' + esbuildDir);
    process.exit(2);
  }
  // 【必须走 JS API，不能 spawn bin/esbuild】
  // 那个文件是**平台原生可执行文件**（Linux 是 ELF，Windows 是 .exe），
  // 用 process.execPath 去执行它等于让 node 解析二进制，必然失败：
  //   SyntaxError: Invalid or unexpected token  (ELF...)
  // 之前只在 Windows 上构建过所以没暴露 —— Windows 上该路径是 .exe，
  // 而 .exe 走 execFileSync(process.execPath, [bin]) 同样会挂，
  // 只是代码里那行恰好没被执行过。改用官方 transform API 后跨平台都正确。
  const { transform } = await import(pathToFileURL(path.join(esbuildDir, 'lib', 'main.js')).href);
  const result = await transform(src, {
    minify: true,
    format: 'iife',
    target: 'es2020',
    logLevel: 'warning',
    loader: 'js',
  });
  return result.code;
}

const rendered = new Map();
rendered.set('iife', wrap(source));
rendered.set('min', await minify(wrap(source)));

/**
 * 书签形态：压缩后的桥接层 + toast 提示，整体 URI 编码后加 javascript: 前缀。
 *
 * 为什么要有构建：以前这段是手工在浏览器里拼的，没有脚本。
 * 结果 skill 里的 bookmarklet.txt 用 margin=40 的旧桥接层，
 * dist 里那份却是 margin=60 —— 同一个工具两个行为。
 */
{
  const toastPath = path.join(HERE, 'toast.js');
  const toastSrc = fs.existsSync(toastPath) ? fs.readFileSync(toastPath, 'utf8') : '';
  const body = '(function(){' + rendered.get('min').trim() + '\n' + toastSrc + '})();';
  const href = 'javascript:' + encodeURIComponent(body);
  rendered.set('bookmarklet', href);
  // 安装页必须是同一份 href 的确定性产物，手工改会被 --check 抓出来。
  rendered.set('installHtml', [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<title>安装书签</title></head><body>',
    '<p>把这个链接拖到书签栏，之后在编辑页点一下即可注入桥接层。</p>',
    '<p><a id="bm" href="' + href.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">桥接层书签</a></p>',
    '</body></html>',
    ''
  ].join('\n'));
}

if (check) {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { /* 首次 */ }
  const drift = [];
  if (!prev) drift.push('还没有构建清单（没构建过）');
  else if (prev.sourceSha256 !== sourceHash) {
    drift.push(`源码已变更：清单 ${prev.sourceSha256 || '(无)'} / 当前 ${sourceHash}`);
  }
  for (const t of TARGETS) {
    const p = path.join(ROOT, t.to);
    if (!fs.existsSync(p)) { drift.push(`产物缺失：${t.to}`); continue; }
    const want = sha(rendered.get(t.format));
    const got = sha(fs.readFileSync(p, 'utf8'));
    if (want !== got) drift.push(`产物过期：${t.to}（应 ${want} / 实 ${got}）`);
  }
  if (drift.length) {
    console.error('✗ 桥接层产物与源码不一致：');
    for (const d of drift) console.error('  -', d);
    console.error('\n修：node bridge/build.mjs');
    process.exit(1);
  }
  console.log(`✓ 桥接层产物与源码一致（源码 ${sourceHash}，${TARGETS.length} 个落盘位置）`);
  process.exit(0);
}

const files = {};
for (const t of TARGETS) {
  const p = path.join(ROOT, t.to);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rendered.get(t.format));
  files[t.to] = { format: t.format, bytes: rendered.get(t.format).length, sha256: sha(rendered.get(t.format)) };
}

fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify({
  source: 'bridge/pobridge.js',
  sourceSha256: sourceHash,
  sourceBytes: source.length,
  builtAt: new Date().toISOString(),
  exports: ['RED', 'readGraph', 'createNode', 'updateNode', 'removeNodes', 'createEdge', 'getViewBox', 'clampIntoView', 'focusRect'],
  files,
}, null, 2) + '\n');

console.log(`✓ 桥接层已构建（源码 ${sourceHash}）`);
for (const [to, meta] of Object.entries(files)) {
  console.log(`  ${meta.format.padEnd(5)} ${String(meta.bytes).padStart(6)}B  ${meta.sha256}  ${to}`);
}
