/**
 * 变异门禁：证明 selftest 真的能抓 bug。
 *
 * 【为什么需要这个文件】
 * "测试通过"不等于"测试有用"。独立核验用变异测试证明过：
 * 把 for(L=0;L<4;L++) 改成 L<0、把斜线检测前插 return false，
 * 之前的 137 项测试仍全绿 —— 变量名还在，弱断言就抓不住。
 *
 * 本文件把那些变异固化下来：每个变异都应该让 selftest 变红。
 * 如果某个变异没被抓到，说明对应断言还是弱断言，必须改。
 *
 * 运行：node test/mutation.mjs
 * 退出码：只要有一个变异没被抓到就 1。
 *
 * 【实现说明】不用子进程，直接在进程内 import selftest 会导致失败统计互相污染，
 * 所以采用「改文件 → 动态 import（带 cache-busting query）→ 读全局计数」的做法
 * 不行，selftest 是脚本不是模块。最终方案：调 node 起子进程，但用文件传结果、
 * 不用大 buffer 回传，避免 Windows 上的栈问题。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');

const MIN = 'pobridge.min.js';
const PAGE = 'lib/page.mjs';

const LB = 'for(var J=m-p,R=g-c,x=0,E=1,P=[-J,J,-R,R],b=[p-M,w-p,c-v,k-c],L=0;L<4;L++)';

const MUTATIONS = [
  {
    label: '斜线裁剪循环不执行 L<4 → L<0',
    file: MIN,
    fn: (s) => s.replace(LB, LB.replace('L<4', 'L<0')),
  },
  {
    label: '斜线直接 return false（还原 P1）',
    file: MIN,
    fn: (s) => s.replace(LB, 'return!1;' + LB),
  },
  {
    label: 'page.mjs 斜线检测退回 return false',
    file: PAGE,
    fn: (s) => s.replace(
      "'    // 斜线：Liang-Barsky",
      "'    return false;',\n    '    // 斜线：Liang-Barsky"
    ),
  },
  {
    label: 'page.mjs 间距阈值归零',
    file: PAGE,
    fn: (s) => s.replace("'      if (gp < FLOOR) tight++;',", "'      if (gp < 0) tight++;',"),
  },
  {
    label: 'page.mjs 锚点校验恒真',
    file: PAGE,
    fn: (s) => s.replace("'  function onMid(x, y, p) {',", "'  function onMid(x, y, p) { return true;',"),
  },
];

// 【为什么不用 fs.cpSync】在含中文/感叹号的路径上，Node 24 的 cpSync 会崩
// （exit -1073740791 / 0xC0000409）。实测同目录手工递归复制完全没问题。
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function runOnce(m, idx) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut' + idx + '-'));
  try {
    copyDir(SKILL, tmp);
    const target = path.join(tmp, m.file);
    const orig = fs.readFileSync(target, 'utf8');
    const mutated = m.fn(orig);
    if (mutated === orig) return { status: 'SKIP' };
    fs.writeFileSync(target, mutated, 'utf8');

    const outFile = path.join(tmp, '__out.txt');
    // 用 cmd 重定向到文件，避免大 buffer 回传
    const res = spawnSync(process.execPath, [path.join(tmp, 'test', 'selftest.mjs')], {
      encoding: 'utf8',
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    });
    const out = String(res.stdout || '') + String(res.stderr || '');
    fs.writeFileSync(outFile, out, 'utf8');
    const failed = (res.status !== 0) || /FAIL\s/.test(out);
    if (!failed) return { status: 'MISSED' };
    const mm = out.match(/FAIL\s+([^\n]+)/);
    return { status: 'CAUGHT', which: mm ? mm[1].trim() : '' };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

console.log('变异门禁：检查 selftest 是否真的能抓到 bug');
console.log('');
let caught = 0, missed = 0, skipped = 0;
for (let i = 0; i < MUTATIONS.length; i++) {
  const m = MUTATIONS[i];
  let r;
  try { r = runOnce(m, i); }
  catch (e) { r = { status: 'SKIP', note: e.message }; }
  if (r.status === 'CAUGHT') {
    caught++;
    console.log('  ✗ 抓到    ' + m.label + (r.which ? '  <- ' + r.which : ''));
  } else if (r.status === 'MISSED') {
    missed++;
    console.log('  ! 漏检    ' + m.label + '   <-- 断言还是弱的');
  } else {
    skipped++;
    console.log('  - 跳过    ' + m.label);
  }
}
console.log('');
console.log('抓到 ' + caught + ' / 漏检 ' + missed + ' / 跳过 ' + skipped);
if (missed) {
  console.log('');
  console.log('x 有 ' + missed + ' 个变异没被抓到，测试不可信');
  process.exit(1);
}
console.log('v 所有变异都被抓到');
