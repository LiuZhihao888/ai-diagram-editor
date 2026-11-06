#!/usr/bin/env node
/**
 * 把 wb/ 的运行时同步进 WorkBuddy 技能目录，让技能自包含（不依赖仓库位置）。
 *
 *   node tools/sync-skill.mjs            # 同步
 *   node tools/sync-skill.mjs --check    # 只校验是否与仓库一致（CI / 交付前用）
 *   node tools/sync-skill.mjs --install  # 同步后顺便在技能里装依赖
 *
 * 目标目录可用 PO_SKILL_DIR 覆盖，默认 WorkBuddy 用户级技能目录。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const SKILL = process.env.PO_SKILL_DIR
  || path.join(os.homedir(), '.workbuddy', 'skills', 'wb-processon-diagram-editor');
const RUNTIME = path.join(SKILL, 'runtime');

const FILES = [
  ['bin/pocli.mjs', 'bin/pocli.mjs'],
  ['lib/pw.mjs', 'lib/pw.mjs'],
  ['lib/page.mjs', 'lib/page.mjs'],
  ['lib/args.mjs', 'lib/args.mjs'],
  ['lib/paths.mjs', 'lib/paths.mjs'],
  ['pobridge.js', 'pobridge.js'],
];

const args = new Set(process.argv.slice(2));
const check = args.has('--check');
const install = args.has('--install');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: PKG, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch { return null; }
}

function runtimePackageJson() {
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  return {
    name: 'pocli-runtime',
    version: pkg.version,
    private: true,
    type: 'module',
    description: 'ProcessOn 画布改图运行时（由仓库 tools/sync-skill.mjs 生成，勿手改）',
    dependencies: pkg.dependencies,
  };
}

const manifestPath = path.join(RUNTIME, 'SYNC.json');
const plan = FILES.map(([from, to]) => {
  const src = path.join(PKG, from);
  if (!fs.existsSync(src)) {
    console.error(`缺少源文件：${src}`);
    process.exit(2);
  }
  return { from, to, src, dst: path.join(RUNTIME, to), hash: sha(fs.readFileSync(src)) };
});

if (check) {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* 首次 */ }
  const drift = [];
  if (!prev) drift.push('技能里还没有运行时（未同步过）');
  else {
    for (const p of plan) {
      const want = prev.files?.[p.to];
      if (!want) { drift.push(`清单缺条目：${p.to}`); continue; }
      if (want !== p.hash) drift.push(`内容不一致：${p.to}（仓库 ${p.hash} / 技能 ${want}）`);
      if (!fs.existsSync(p.dst)) drift.push(`技能里缺文件：${p.to}`);
    }
    const deps = JSON.stringify(prev.package?.dependencies || {});
    const wantDeps = JSON.stringify(runtimePackageJson().dependencies);
    if (deps !== wantDeps) drift.push('依赖声明不一致');
  }
  if (drift.length) {
    console.error('✗ 技能运行时与仓库不一致：');
    for (const d of drift) console.error('  -', d);
    console.error('\n修：node tools/sync-skill.mjs');
    process.exit(1);
  }
  console.log(`✓ 技能运行时与仓库一致（${plan.length} 个文件，commit ${prev.commit || 'unknown'}）`);
  process.exit(0);
}

// ---- 同步 ----
fs.mkdirSync(path.join(RUNTIME, 'bin'), { recursive: true });
fs.mkdirSync(path.join(RUNTIME, 'lib'), { recursive: true });

const files = {};
for (const p of plan) {
  fs.copyFileSync(p.src, p.dst);
  files[p.to] = p.hash;
}
const pkg = runtimePackageJson();
fs.writeFileSync(path.join(RUNTIME, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(manifestPath, JSON.stringify({
  source: PKG,
  commit: gitCommit(),
  syncedAt: new Date().toISOString(),
  files,
  package: pkg,
}, null, 2) + '\n');

console.log(`✓ 已同步 ${plan.length} 个文件 → ${RUNTIME}`);
console.log(`  commit ${gitCommit() || 'unknown'}`);

if (install) {
  console.log('· 安装运行时依赖（一次性，约 10s）…');
  execSync('npm install --omit=dev --no-audit --no-fund', { cwd: RUNTIME, stdio: 'inherit' });
  console.log('✓ 依赖就绪');
} else if (!fs.existsSync(path.join(RUNTIME, 'node_modules', 'playwright-core'))) {
  console.log('\n⚠ 运行时还缺依赖，跑一次：');
  console.log(`  cd "${RUNTIME}" && npm install --omit=dev`);
}
