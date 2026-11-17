/**
 * 变异门禁：证明 selftest 真的能抓 bug。
 *
 * 【为什么需要这个文件】
 * "测试通过"不等于"测试有用"。独立核验用变异测试证明过：
 * 把 for(L=0;L<4;L++) 改成 L<0、把斜线检测前插 return false，
 * 之前的测试仍全绿 —— 变量名还在，弱断言就抓不住。
 *
 * 【三条铁律（都是被核验打脸后加的）】
 * 1. 必须先做**正向对照**：未变异时 selftest 必须通过。
 *    否则把一个永远失败的 selftest 换进去，也能拿满分。
 * 2. **SKIP 算失败**，不是"跳过"。变异点找不到就说明这道防线已经失效
 *    （典型原因：源码改了，硬编码的特征串失配）。
 * 3. 变异点要**按语义定位**，不能硬编码压缩后的变量名 —— 重新构建就失配。
 *
 * 运行：node test/mutation.mjs
 * 退出码：正向对照失败、或有变异漏检/跳过，都返回 1。
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

// 【为什么不用 fs.cpSync】在含中文/感叹号的路径上，Node 24 的 cpSync 会崩
// （exit -1073740791 / 0xC0000409）。手工递归复制完全没问题。
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function runSelftest(dir) {
  const res = spawnSync(process.execPath, [path.join(dir, 'test', 'selftest.mjs')], {
    encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 4 * 1024 * 1024,
  });
  const out = String(res.stdout || '') + String(res.stderr || '');
  return { status: res.status, out, failed: res.status !== 0 || /FAIL\s/.test(out) };
}

// ---------------------------------------------------------------- 变异定义
// 定位一律用「语义特征」，不用压缩变量名。
// mutate 返回 null 表示没找到变异点（会被判为 SKIP → 失败）。
const MUTATIONS = [
  {
    label: 'page.mjs: 斜线检测退回 return false（还原 P1）',
    file: PAGE,
    mutate(s) {
      const marker = "'    // 斜线：Liang-Barsky";
      if (!s.includes(marker)) return null;
      return s.replace(marker, "'    return false;',\n" + marker);
    },
  },
  {
    label: 'page.mjs: 间距阈值归零',
    file: PAGE,
    mutate(s) {
      const re = /'      if \(gp < FLOOR\) tight\+\+;',/;
      if (!re.test(s)) return null;
      return s.replace(re, "'      if (gp < 0) tight++;',");
    },
  },
  {
    label: 'page.mjs: 锚点校验恒真（badAnchor 恒 0）',
    file: PAGE,
    mutate(s) {
      const marker = "'  function onMid(x, y, p) {',";
      if (!s.includes(marker)) return null;
      return s.replace(marker, "'  function onMid(x, y, p) { return true;',");
    },
  },
  {
    label: 'page.mjs: overlaps 检测恒 0',
    file: PAGE,
    mutate(s) {
      const re = /'        overlaps\+\+;',/;
      if (!re.test(s)) return null;
      return s.replace(re, "'        /* mutated: no-op */',");
    },
  },
  {
    label: 'page.mjs: lkSkipped 恒 0（缺端点的连线不再计入）',
    file: PAGE,
    mutate(s) {
      // 只改"缺 from/to"那一处，保留"节点不存在"那一处，
      // 这样才能精确验证"缺端点"的计数有没有被断言覆盖。
      const target = "'    if (!g || !g.from || !g.to) { skipped++; continue; }',";
      if (!s.includes(target)) return null;
      return s.replace(target, "'    if (!g || !g.from || !g.to) { continue; }',");
    },
  },
  {
    label: 'page.mjs: pass 恒 false（永远拒绝验收）',
    file: PAGE,
    mutate(s) {
      const re = /var pass = \([^)]*\);?/;
      if (!re.test(s)) return null;
      return s.replace(re, 'var pass = false;');
    },
  },
  {
    label: 'page.mjs: auditDesignExpr 的 tooLong 恒 0',
    file: PAGE,
    mutate(s) {
      const re = /tooLong\.push\(\{[^}]*\}\);/;
      if (!re.test(s)) return null;
      return s.replace(re, '/* mutated: tooLong 不再记录 */');
    },
  },
  {
    label: 'bridge: reflowSpacing 不挪节点（位移恒 0）',
    file: MIN,
    mutate(s) {
      const re = /M\.props\.x=Math\.round\(M\.props\.x\+h\.shifts\[y\]\)/;
      if (!re.test(s)) return null;
      return s.replace(re, 'M.props.x=Math.round(M.props.x)');
    },
  },
  {
    // 【为什么要这条】只断言"x 变大"的话，位移恒 1px 也能过。
    // 必须断言精确值 312，才能验出位移量算错。
    label: 'bridge: reflowSpacing 位移量恒 1px',
    file: MIN,
    mutate(s) {
      const re = /M\.props\.x=Math\.round\(M\.props\.x\+h\.shifts\[y\]\)/;
      if (!re.test(s)) return null;
      return s.replace(re, 'M.props.x=Math.round(M.props.x+1)');
    },
  },
  {
    label: 'bridge: reflowSpacing 位移量翻倍',
    file: MIN,
    mutate(s) {
      const re = /M\.props\.x=Math\.round\(M\.props\.x\+h\.shifts\[y\]\)/;
      if (!re.test(s)) return null;
      return s.replace(re, 'M.props.x=Math.round(M.props.x+2*h.shifts[y])');
    },
  },
  {
    // 【为什么要这条】只断言 isFinite 的话，删掉整个兜底分支也能过。
    // 必须断言精确的居中值 -50 / 10。
    label: 'bridge: clampIntoView 删掉居中兜底分支',
    file: MIN,
    mutate(s) {
      const re = /l=i<f\?e\.x\+\(e\.w-a\)\/2:Math\.max\(f,Math\.min\(r,i\)\)/;
      if (!re.test(s)) return null;
      return s.replace(re, 'l=Math.max(f,Math.min(r,i))');
    },
  },
  {
    label: 'bridge: clampIntoView 兜底返回 0（不居中）',
    file: MIN,
    mutate(s) {
      const re = /l=i<f\?e\.x\+\(e\.w-a\)\/2/;
      if (!re.test(s)) return null;
      return s.replace(re, 'l=i<f?0');
    },
  },
  {
    label: 'bridge: clampIntoView 的 clamped 恒 false',
    file: MIN,
    mutate(s) {
      const re = /clamped:Math\.abs\(p-r\)>1\|\|Math\.abs\(c-t\)>1/;
      if (!re.test(s)) return null;
      return s.replace(re, 'clamped:false');
    },
  },
  {
    // 【为什么要这条】之前只断言 bridge/pobridge.js 源码里的 ANCHOR，
    // 但真正发到浏览器的是 pobridge.min.js。核验证明：
    // 改反 min 产物里的 ANCHOR，157 项全部照绿 —— P2 在产物侧零防护。
    label: 'bridge: min 产物 ANCHOR L/R 互换（还原 P2）',
    file: MIN,
    mutate(s) {
      const re = /var Y=\{L:Math\.PI,T:-Math\.PI\/2,R:0,B:Math\.PI\/2\}/;
      if (!re.test(s)) return null;
      return s.replace(re, 'var Y={L:0,T:-Math.PI/2,R:Math.PI,B:Math.PI/2}');
    },
  },
  {
    label: 'bridge: min 产物 ANCHOR T/B 互换',
    file: MIN,
    mutate(s) {
      const re = /var Y=\{L:Math\.PI,T:-Math\.PI\/2,R:0,B:Math\.PI\/2\}/;
      if (!re.test(s)) return null;
      return s.replace(re, 'var Y={L:Math.PI,T:Math.PI/2,R:0,B:-Math.PI/2}');
    },
  },
  {
    // 【为什么要这条】第七轮核验发现：auditSideCard 只被断言"字段名在"，
    // 把 pass 改成恒 true（有重叠也判合格），159 项全绿。
    label: 'bridge: auditSideCard 的 pass 恒 true',
    file: MIN,
    mutate(s) {
      const re = /return\{id:r,overlaps:e\.length,list:e,pass:e\.length===0\}/;
      if (!re.test(s)) return null;
      return s.replace(re, 'return{id:r,overlaps:e.length,list:e,pass:!0}');
    },
  },
  {
    label: 'bridge: auditSideCard 的 overlaps 恒 0',
    file: MIN,
    mutate(s) {
      const re = /s>1&&u>1&&e\.push\(\{id:o,ix:Math\.round\(s\),iy:Math\.round\(u\)\}\)/;
      if (!re.test(s)) return null;
      return s.replace(re, '0');
    },
  },
  {
    // 【为什么要这条】原来只有"该跳过的跳过了"这一侧，没有"该绕的真的绕了"。
    // 让整个函数空转，159 项全绿 —— 一个永远不动的 reroute 也满足负向断言。
    label: 'bridge: rerouteWorstEdges 空转（什么都不做）',
    file: MIN,
    mutate(s) {
      const re = /function Oe\(r\)\{S\(\);var t=r\|\|\{\},a=typeof t\.max=="number"\?t\.max:5/;
      if (!re.test(s)) return null;
      return s.replace(re, 'function Oe(r){return{applied:[],skipped:[],scanned:0}}function _dead(r){var t=r||{},a=typeof t.max=="number"?t.max:5');
    },
  },
  {
    label: 'bridge: 斜线裁剪循环不执行（L<4 → L<0）',
    file: MIN,
    mutate(s) {
      // 语义定位：Liang-Barsky 循环的特征是 'L=0;L<4;L++)if(Math.abs(P[L])<1e-9)'
      // 用这个组合定位，不依赖前面的变量声明顺序（那些压缩后可能重命名）。
      const re = /L=0;L<4;L\+\+\)if\(Math\.abs\(P\[L\]\)<1e-9\)/;
      if (!re.test(s)) return null;
      return s.replace(re, 'L=0;L<0;L++)if(Math.abs(P[L])<1e-9)');
    },
  },
];

// ---------------------------------------------------------------- 正向对照
console.log('变异门禁：先做正向对照（未变异时必须通过）');
const baseTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mutbase-'));
let baselineOk = false;
try {
  copyDir(SKILL, baseTmp);
  const base = runSelftest(baseTmp);
  if (base.failed) {
    console.log('  ✗ 正向对照失败：未变异的 selftest 本身就不过');
    console.log(base.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 5).join('\n'));
    console.log('\n结论：门禁不可信 —— 如果基线都不通过，任何"抓到"都是假的。');
    process.exit(1);
  }
  baselineOk = true;
  console.log('  ✓ 基线通过');
} finally {
  try { fs.rmSync(baseTmp, { recursive: true, force: true }); } catch {}
}

// ---------------------------------------------------------------- 跑变异
console.log('');
console.log('逐个注入变异：');
let caught = 0, missed = 0, skipped = 0;
for (let i = 0; i < MUTATIONS.length; i++) {
  const m = MUTATIONS[i];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mut' + i + '-'));
  try {
    copyDir(SKILL, tmp);
    const target = path.join(tmp, m.file);
    const orig = fs.readFileSync(target, 'utf8');
    const mutated = m.mutate(orig);
    if (mutated === null || mutated === orig) {
      skipped++;
      console.log('  ✗ 失效    ' + m.label + '   <-- 变异点没找到，这道防线已废，必须修');
      continue;
    }
    fs.writeFileSync(target, mutated, 'utf8');
    const r = runSelftest(tmp);
    if (!r.failed) {
      missed++;
      console.log('  ✗ 漏检    ' + m.label + '   <-- 改坏了测试却没红，断言是弱的');
      continue;
    }
    caught++;
    const mm = r.out.match(/FAIL\s+([^\n]+)/);
    console.log('  ✓ 抓到    ' + m.label + (mm ? '  <- ' + mm[1].trim() : ''));
  } catch (e) {
    skipped++;
    console.log('  ✗ 异常    ' + m.label + '  (' + e.message + ')');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

console.log('');
console.log('结果：抓到 ' + caught + ' / 漏检 ' + missed + ' / 失效 ' + skipped + '（共 ' + MUTATIONS.length + '）');

const bad = missed + skipped;
if (!baselineOk || bad) {
  if (missed) console.log('  - ' + missed + ' 个变异没被抓到：对应断言是弱的');
  if (skipped) console.log('  - ' + skipped + ' 个变异点失效：定位逻辑跟不上源码，门禁已部分失明');
  console.log('');
  console.log('✗ 门禁不通过');
  process.exit(1);
}
console.log('');
console.log('✓ 正向对照通过，且所有变异都被抓到');
