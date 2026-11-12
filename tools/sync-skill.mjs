#!/usr/bin/env node
/**
 * 把仓库里的技能同步到「已安装」位置。
 *
 *   node tools/sync-skill.mjs                 # 同步到默认目标
 *   node tools/sync-skill.mjs --dry           # 只报告，不落盘
 *   node tools/sync-skill.mjs --target <dir>  # 自定义目标
 *
 * 为什么需要它：这套技能同时存在于两处 —— 仓库（唯一真相）和
 * ~/.dsh/skills/dsh-processon-diagram-editor（实际被加载）。
 * 历史上两边各自改过，源码分叉（技能目录曾自带 bridge-src/pobridge.js，
 * 与仓库版本差 23KB，缺 createSideCard / detectOverlaps / 验收清单）。
 *
 * 规矩：仓库是来源，技能目录是产物。不要反过来改。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'dsh', 'skill', 'dsh-processon-diagram-editor');

/** 要同步的文件/目录（相对路径）。bridge-src 不在其中：源码只在仓库。 */
const ITEMS = [
  'SKILL.md',
  'lib',
  'test',
  'scripts',
  'pobridge.min.js',
  'data',
];

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const ti = argv.indexOf('--target');
const TARGET = ti >= 0 && argv[ti + 1]
  ? path.resolve(argv[ti + 1])
  : path.join(os.homedir(), '.dsh', 'skills', 'dsh-processon-diagram-editor');

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.name === 'node_modules' || e.name === '.git') continue;
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p));
  }
  return out;
}

/** 比较 src 与 dst 的每个文件，返回 {same, added, changed, onlyInDst}。 */
function diff() {
  const srcFiles = new Set();
  for (const item of ITEMS) {
    const p = path.join(SRC, item);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) {
      for (const f of walk(p)) srcFiles.add(path.join(item, f).split(path.sep).join('/'));
    } else {
      srcFiles.add(item);
    }
  }

  // dst 侧：只比较我们管的范围，避免把 bridge-src 等历史文件算进来
  const dstFiles = new Set();
  for (const item of ITEMS) {
    const p = path.join(TARGET, item);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isDirectory()) {
      for (const f of walk(p)) dstFiles.add(path.join(item, f).split(path.sep).join('/'));
    } else {
      dstFiles.add(item);
    }
  }

  const same = [], changed = [], added = [], onlyInDst = [];
  for (const rel of srcFiles) {
    const a = path.join(SRC, rel);
    const b = path.join(TARGET, rel);
    if (!fs.existsSync(b)) { added.push(rel); continue; }
    const ba = fs.readFileSync(a), bb = fs.readFileSync(b);
    if (ba.equals(bb)) same.push(rel); else changed.push(rel);
  }
  for (const rel of dstFiles) if (!srcFiles.has(rel)) onlyInDst.push(rel);

  return { same, changed, added, onlyInDst, srcFiles };
}

/**
 * 版本号：0.2.0 -> 0.2.<内容哈希前 8 位十进制>
 * 目的是让「内容变了」在 _meta.json 上一眼可见 —— 之前两边 _meta 都是
 * 0.2.0，内容却差 4 天，光看版本号根本发现不了。
 */
function contentVersion(files) {
  const h = crypto.createHash('sha256');
  for (const rel of [...files].sort()) {
    h.update(rel);
    h.update(fs.readFileSync(path.join(SRC, rel)));
  }
  const n = parseInt(h.digest('hex').slice(0, 6), 16) % 1000000;
  return '0.2.' + String(n).padStart(6, '0');
}

const d = diff();
console.log('源:  ' + SRC);
console.log('目标: ' + TARGET);
console.log('');
console.log('  未变    ' + d.same.length + ' 个');
console.log('  会更新  ' + d.changed.length + ' 个');
console.log('  会新增  ' + d.added.length + ' 个');
if (d.onlyInDst.length) {
  console.log('  目标独有（不动） ' + d.onlyInDst.length + ' 个: ' + d.onlyInDst.join(', '));
}
if (d.changed.length) console.log('\n变更文件:\n  ' + d.changed.join('\n  '));
if (d.added.length) console.log('\n新增文件:\n  ' + d.added.join('\n  '));

if (DRY) {
  console.log('\n--dry：没有写入任何文件。');
  process.exit(0);
}

if (!fs.existsSync(TARGET)) {
  console.error('\n目标不存在: ' + TARGET);
  console.error('先安装技能，或用 --target 指定位置。');
  process.exit(1);
}

// 备份
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = TARGET.replace(/[\\/]$/, '') + '.backup-' + stamp;
fs.cpSync(TARGET, backup, { recursive: true });
console.log('\n已备份 -> ' + backup);

// 复制。注意：单文件不能用 cpSync 到已存在的同名文件（Windows 上会 ESRCH），
// 所以文件走 readFileSync+writeFileSync，只有目录才用 cpSync。
let written = 0;
for (const item of ITEMS) {
  const src = path.join(SRC, item);
  if (!fs.existsSync(src)) continue;
  const dst = path.join(TARGET, item);
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const rel of walk(src)) {
      const from = path.join(src, rel);
      const to = path.join(dst, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, fs.readFileSync(from));
      written++;
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, fs.readFileSync(src));
    written++;
  }
}
console.log('已写入 ' + written + ' 个文件');

// 版本号
const metaPath = path.join(TARGET, '_meta.json');
let meta = {};
if (fs.existsSync(metaPath)) {
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { meta = {}; }
}
const oldVer = meta.version;
meta.version = contentVersion(d.srcFiles);
meta.syncedAt = Date.now();
meta.contentHash = meta.version.split('.').pop();
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
console.log('版本号 ' + oldVer + ' -> ' + meta.version);

// 同步后自检
console.log('\n--- 同步后核对 ---');
const after = diff();
console.log('  未变 ' + after.same.length + ' / 变更 ' + after.changed.length + ' / 新增 ' + after.added.length);
if (after.changed.length === 0 && after.added.length === 0) {
  console.log('  ✓ 源与目标内容一致');
} else {
  console.error('  ✗ 仍不一致: ' + [...after.changed, ...after.added].join(', '));
  process.exit(1);
}
