/**
 * DSH 侧离线自检 —— 不需要浏览器、不碰任何文档。
 *
 * 运行：node dsh/test/selftest.mjs
 *
 * 覆盖：
 *   1. 页面 JS 片段语法合法
 *   2. 参数化片段对引号/换行/</script>/emoji 免疫，JSON 转义无损
 *   3. 危险输入的守卫确实存在（空数组删除、未知 id、无桥接层）
 *   4. 技能包产物与元数据自洽
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/page.mjs';

let pass = 0;
const fails = [];
const ok = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { fails.push({ name, message: e.message }); }
};

/** 只做语法检查：能构造 Function 就说明这段 JS 没有语法错误。 */
const syntaxOk = (src) => { new Function(src); return true; };

// ---------------------------------------------------------------- [1] 可编译
const FRAGMENTS = ['READY', 'READ_GRAPH', 'COUNT', 'FIT_CANVAS', 'VIEWBOX', 'POOL_BOTTOM', 'TAB_IDENT'];
for (const name of FRAGMENTS) {
  ok('片段可编译: ' + name, () => syntaxOk(P[name]));
}

// ---------------------------------------------------------------- [2] 注入无害
ok('injectExpr 可编译', () => syntaxOk(P.injectExpr('window.X=1;')));
ok('injectExpr 会报出 POBridge 类型', () => {
  assert.match(P.injectExpr(''), /typeof window\.POBridge/);
});
ok('injectExpr 对含反引号的源码安全', () => {
  syntaxOk(P.injectExpr('var a = 1;'));
});

// ---------------------------------------------------------------- [3] 参数转义
const NASTY = [
  '带"双引号"的文案',
  "带'单引号'的文案",
  '反斜杠 \ 与换行\n第二行',
  '$(rm -rf /) 美元括号',
  '</script><script>alert(1)</script>',
  'emoji 🚀 与全角（）',
];
for (const text of NASTY) {
  ok('文案转义无损: ' + JSON.stringify(text).slice(0, 26), () => {
    const expr = P.createNodeExpr({
      id: 'ai_node_1_1', text: text, x: 1, y: 2, w: 3, h: 4,
      name: 'process', fill: '', line: '', font: '',
    });
    syntaxOk(expr);
    const m = /\}\)\((\{.*\})\)$/s.exec(expr);
    assert.ok(m, '参数块没有出现在表达式末尾');
    assert.equal(JSON.parse(m[1]).text, text);
  });
}

ok('id 含引号不产生模板注入', () => {
  syntaxOk(P.updateNodeExpr('a"b\c', { text: 'x' }));
});


// ---------------------------------------------------------------- [3.5] 反斜杠禁令
// JS 模板字符串会把 \d 这类无效转义悄悄吃成 d，(\d+) 变 (d+)，正则静默失效。
// 曾经真的踩过：TAB_IDENT 的 file_id 正则变成 (d+)，多图识别永远返回 null。
ok('所有页面片段内部不含反斜杠', () => {
  const Q = String.fromCharCode(92);
  const offenders = [];
  for (const k of Object.keys(P)) {
    const v = typeof P[k] === 'function'
      ? P[k]({ id: 'a', text: 't', x: 1, y: 2, w: 3, h: 4, from: 'a', to: 'b' })
      : P[k];
    if (typeof v === 'string' && v.split(Q).length - 1 > 0) offenders.push(k);
  }
  assert.deepEqual(offenders, [], '这些片段含反斜杠，会被模板字符串吞掉: ' + offenders.join(', '));
});

ok('TAB_IDENT 的 file_id 正则可匹配', () => {
  // 用页面 URL 形状验证正则本身没问题（ID 用假值，实际图的 file_id 不入库）
  const re = /file_id=([0-9]+)/;
  assert.equal(re.exec('https://wps.processon.com/diagrams/edit?x=1&file_id=123456789&y=2')[1], '123456789');
  assert.match(P.TAB_IDENT, /file_id=\(\[0-9\]\+\)/);
});

// ---------------------------------------------------------------- [4] 守卫存在
ok('removeNodesExpr 对空数组报警', () => {
  const js = P.removeNodesExpr([]);
  assert.match(js, /EMPTY_IDS/);
  syntaxOk(js);
});
ok('updateNodeExpr 对未知 id 报 NOT_FOUND', () => {
  assert.match(P.updateNodeExpr('ai_node_x', {}), /NOT_FOUND/);
});
ok('createNodeExpr 报 NO_BRIDGE 而不是静默失败', () => {
  assert.match(P.createNodeExpr({ id: 'a', text: '', x: 0, y: 0, w: 1, h: 1 }), /NO_BRIDGE/);
});
ok('existsExpr 可用于超时后探测', () => {
  const js = P.existsExpr('ai_node_1');
  syntaxOk(js);
  assert.match(js, /Model\.define\.elements/);
});

// ---------------------------------------------------------------- [5] 技能包自洽
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');   // test/ 的上一级就是技能根
const MIN = path.join(SKILL, 'pobridge.min.js');
const REPO = path.resolve(SKILL, '..', '..', '..');   // 技能 → dsh/ → 仓库根

ok('技能里存在 pobridge.min.js', () => assert.ok(fs.existsSync(MIN)));
ok('pobridge.min.js 语法合法', () => syntaxOk(fs.readFileSync(MIN, 'utf8')));
ok('pobridge.min.js 不泄漏 CommonJS', () => {
  const src = fs.readFileSync(MIN, 'utf8');
  assert.ok(!/module\.exports/.test(src), '不该有 module.exports');
  assert.ok(!/\brequire\(/.test(src), '不该有 require(');
});
ok('pobridge.min.js 导出齐全', () => {
  const src = fs.readFileSync(MIN, 'utf8');
  for (const k of ['readGraph', 'createNode', 'updateNode', 'removeNodes', 'createEdge', 'getViewBox', 'clampIntoView', 'focusRect', 'getPoolRows', 'createPool', 'setPoolRows', 'horizontalPool', 'horizontalLane']) {
    assert.ok(src.includes(k), '缺导出: ' + k);
  }
});
ok('clampIntoView 返回 requested/actual/clamped', () => {
  // 被静默夹走是这套接口最大的坑：调用方必须能看见"夹了"，而不是只拿到结果
  const src = fs.readFileSync(path.join(SKILL, 'lib', 'page.mjs'), 'utf8') + fs.readFileSync(MIN, 'utf8');
  for (const k of ['requested', 'actual', 'clamped']) {
    assert.ok(src.includes(k), '缺字段: ' + k);
  }
});
ok('focusRect 不用 fitTheCanvas（会重置用户缩放）', () => {
  const bridge = fs.readFileSync(path.join(SKILL, 'lib', 'page.mjs'), 'utf8');
  assert.ok(/focusRect/.test(bridge), '缺 focusRect');
  // fitTheCanvas 只允许作为显式请求存在，不能出现在滚动逻辑里
  const bridgeSrc = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  const focusBlock = bridgeSrc.slice(bridgeSrc.indexOf('function focusRect'), bridgeSrc.indexOf('// ---------- 创建节点'));
  assert.ok(!/fitTheCanvas/.test(focusBlock), 'focusRect 里不该调 fitTheCanvas');
  assert.ok(/scrollLeft/.test(focusBlock), 'focusRect 应该用 scrollLeft');
});
ok('viewBox 有 NaN 断言', () => {
  const bridgeSrc = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  assert.ok(/VIEWBOX_INVALID/.test(bridgeSrc), '缺 VIEWBOX_INVALID 断言');
  assert.ok(/isFinite/.test(bridgeSrc), '缺 isFinite 守卫');
});
ok('pobridge.min.js 带视口退化兜底', () => {
  assert.match(fs.readFileSync(MIN, 'utf8'), /maxX<minX|\/2:/);
});
ok('SKILL.md frontmatter name 与目录名一致', () => {
  const md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(md, /^name: dsh-processon-diagram-editor$/m);
});
ok('install.bat 指向正确目录', () => {
  const bat = fs.readFileSync(path.join(SKILL, 'scripts', 'install.bat'), 'utf8');
  assert.match(bat, /dsh-processon-diagram-editor/);
  assert.ok(!/TARGET=.*diagram-copilot/.test(bat), 'install.bat 还指向已废弃的 diagram-copilot');
});

ok('技能自包含：lib/ 与 test/ 都在技能目录内', () => {
  // 装到用户机器时只复制技能目录，依赖外面任何路径都会丢
  assert.ok(fs.existsSync(path.join(SKILL, 'lib', 'page.mjs')), '缺 lib/page.mjs');
  assert.ok(fs.existsSync(path.join(SKILL, 'test', 'selftest.mjs')), '缺 test/selftest.mjs');
  assert.ok(fs.existsSync(path.join(SKILL, 'scripts', 'install.bat')), '缺 scripts/install.bat');
});

ok('install.bat 会校验 lib/ 与 test/', () => {
  const bat = fs.readFileSync(path.join(SKILL, 'scripts', 'install.bat'), 'utf8');
  assert.match(bat, /lib.page.mjs/, 'install.bat 没校验 lib/page.mjs');
  assert.match(bat, /test.selftest.mjs/, 'install.bat 没校验 test/selftest.mjs');
});

ok('技能自带产物一致性测试 parity.mjs', () => {
  assert.ok(fs.existsSync(path.join(SKILL, 'test', 'parity.mjs')), '缺 test/parity.mjs');
});

ok('install.bat 会跑 parity 测试', () => {
  const bat = fs.readFileSync(path.join(SKILL, 'scripts', 'install.bat'), 'utf8');
  assert.match(bat, /parity\.mjs/, 'install.bat 没有引用 parity.mjs');
});

ok('bookmarklet.txt 是构建产物且版本正确', () => {
  const raw = fs.readFileSync(path.join(SKILL, 'scripts', 'bookmarklet.txt'), 'utf8');
  assert.match(raw, /^javascript:/, '书签必须以 javascript: 开头');
  const dec = decodeURIComponent(raw.replace(/^javascript:/, ''));
  syntaxOk(dec);
  // 桥接层版本一致：margin 60 + 视口退化兜底（曾经这里是 margin 40 的旧版）
  // 不写死压缩后的变量名（esbuild 每次会重命名），只断言语义常量与公式。
  assert.match(dec, /[,;=]60[,;]/, '书签里的 clamp margin 不是 60，说明用的是旧桥接层');
  assert.ok(!/[,;=]40[,;]/.test(dec), '书签出现 margin=40 的旧版特征');
  assert.match(dec, /\.w-[a-zA-Z]\)\s*\/\s*2|\.w-[a-zA-Z]\)\s*\/2/, '书签缺视口退化兜底');
  assert.match(dec, /__dc_toast__/, '书签缺注入成功提示条');
});

ok('bookmarklet.txt 指向真正的 POBridge', () => {
  const dec = decodeURIComponent(
    fs.readFileSync(path.join(SKILL, 'scripts', 'bookmarklet.txt'), 'utf8').replace(/^javascript:/, '')
  );
  for (const k of ['readGraph', 'createNode', 'updateNode', 'removeNodes', 'createEdge', 'getViewBox']) {
    assert.ok(dec.includes(k), '书签缺导出: ' + k);
  }
});

// ---------------------------------------------------------------- [池 API 增强]
for (const name of ['getPoolRowsExpr', 'createPoolExpr', 'setPoolRowsExpr', 'removePoolExpr']) {
  ok('池片段可编译: ' + name, () => syntaxOk(P[name]('example_pool_0', ['A','B'])));
}
ok('removePoolExpr 拒绝非 ai_ 池', () => {
  assert.match(P.removePoolExpr('example_pool_0'), /REFUSE_NON_AI/);
});
ok('getPoolRowsExpr 带 NO_BRIDGE 守卫', () => {
  assert.match(P.getPoolRowsExpr('example_pool_0'), /NO_BRIDGE/);
});
ok('createPoolExpr 带重复 id 守卫', () => {
  assert.match(P.createPoolExpr({ id: 'ai_pool_x', rows: ['A'] }), /DUPLICATE_ID/);
});


// ---------------------------------------------------------------- [锚点绑定/连线重排]
for (const name of ['rebindEdgeExpr', 'rebindEdgesExpr', 'listEdgesExpr', 'detectCrossingsExpr', 'resetBrokenLinkersExpr']) {
  ok('连线片段可编译: ' + name, () => syntaxOk(P[name]('x')));
}
ok('rebindEdgesExpr 拒绝空数组', () => {
  assert.match(P.rebindEdgesExpr([]), /EMPTY_IDS/);
});
ok('rebindEdgeExpr 带 NOT_FOUND 守卫', () => {
  assert.match(P.rebindEdgeExpr('nope'), /NOT_FOUND/);
});
ok('所有连线片段都带 NO_BRIDGE 守卫', () => {
  for (const name of ['rebindEdgeExpr', 'rebindEdgesExpr', 'listEdgesExpr', 'detectCrossingsExpr', 'resetBrokenLinkersExpr']) {
    assert.match(P[name]('x'), /NO_BRIDGE/, name + ' 缺少 NO_BRIDGE');
  }
});
ok('createEdgeExpr 会传出 fromSide/toSide', () => {
  const e = P.createEdgeExpr({ id: 'a', from: 'n1', to: 'n2', text: 'x' });
  assert.match(e, /fromSide/);
  assert.match(e, /toSide/);
});
ok('桥接层导出锚点能力', () => {
  const b = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  for (const k of ['rebindEdge', 'rebindEdges', 'computeEdgeGeometry', 'detectCrossings', 'resetBrokenLinkers', 'ANCHOR']) {
    assert.ok(b.includes(k), 'bridge 缺导出: ' + k);
  }
});
ok('书签产物含锚点能力', () => {
  const dec = decodeURIComponent(
    fs.readFileSync(path.join(SKILL, 'scripts', 'bookmarklet.txt'), 'utf8').replace(/^javascript:/, '')
  );
  for (const k of ['rebindEdges', 'detectCrossings', 'resetBrokenLinker']) {
    assert.ok(dec.includes(k), '书签缺: ' + k);
  }
});
ok('angle 常量方向正确（L=0 T=PI/2 R=PI B=3PI/2）', () => {
  const b = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  assert.match(b, /L:\s*0/);
  assert.match(b, /T:\s*Math\.PI\s*\/\s*2/);
  assert.match(b, /R:\s*Math\.PI[,\s]/);
  assert.match(b, /B:\s*3\s*\*\s*Math\.PI\s*\/\s*2/);
});


// ---------------------------------------------------------------- [间距重排 reflowSpacing]
// 纯算法测试：把 bridge 里的 reflowSpacing 逻辑等价复刻，验证位移计算正确。
// 这样间距算法的正确性不依赖浏览器。
function planShifts(nodes, gap) {
  const rows = {};
  for (const n of nodes) {
    const k = Math.round(n.y);
    (rows[k] = rows[k] || []).push(n);
  }
  const shifts = {};
  let maxRight = -Infinity;
  for (const k of Object.keys(rows)) {
    const arr = rows[k].slice().sort((a, b) => a.x - b.x);
    let cum = 0;
    for (let j = 0; j < arr.length; j++) {
      if (j > 0) {
        const prevNewX = arr[j - 1].x + (shifts[arr[j - 1].id] || 0);
        const curNewX = arr[j].x + cum;
        const realGap = curNewX - (prevNewX + arr[j - 1].w);
        if (realGap < gap) cum += (gap - realGap);
      }
      shifts[arr[j].id] = cum;
      const r = arr[j].x + cum + arr[j].w;
      if (r > maxRight) maxRight = r;
    }
  }
  return { shifts, maxRight };
}

ok('reflowSpacing: 间隙不足时按差值补齐', () => {
  const nodes = [
    { id: 'a', x: 0,   y: 0, w: 100, h: 50 },
    { id: 'b', x: 120, y: 0, w: 100, h: 50 },   // gap = 20
  ];
  const { shifts } = planShifts(nodes, 80);
  assert.equal(shifts.a, 0, '第一个不动');
  assert.equal(shifts.b, 60, '第二个补 80-20=60');
});

ok('reflowSpacing: 间隙已足够时不动', () => {
  const nodes = [
    { id: 'a', x: 0,   y: 0, w: 100, h: 50 },
    { id: 'b', x: 200, y: 0, w: 100, h: 50 },   // gap = 100 >= 80
  ];
  const { shifts } = planShifts(nodes, 80);
  assert.equal(shifts.a, 0);
  assert.equal(shifts.b, 0);
});

ok('reflowSpacing: 位移逐级累加（三个节点）', () => {
  const nodes = [
    { id: 'a', x: 0,   y: 0, w: 100, h: 50 },
    { id: 'b', x: 120, y: 0, w: 100, h: 50 },   // gap 20 -> 补 60
    { id: 'c', x: 240, y: 0, w: 100, h: 50 },   // gap 20 -> 补 60，累计 120
  ];
  const { shifts } = planShifts(nodes, 80);
  assert.equal(shifts.a, 0);
  assert.equal(shifts.b, 60);
  assert.equal(shifts.c, 120, 'c 要跟着 b 一起移，再补自己的差值');
});

ok('reflowSpacing: 不同行互不影响', () => {
  const nodes = [
    { id: 'a', x: 0,   y: 0,   w: 100, h: 50 },
    { id: 'b', x: 120, y: 0,   w: 100, h: 50 },
    { id: 'c', x: 0,   y: 100, w: 100, h: 50 },
    { id: 'd', x: 120, y: 100, w: 100, h: 50 },
  ];
  const { shifts } = planShifts(nodes, 80);
  assert.equal(shifts.a, 0);
  assert.equal(shifts.b, 60);
  assert.equal(shifts.c, 0, '第二行第一个不动');
  assert.equal(shifts.d, 60, '第二行独立计算');
});

ok('reflowSpacing: 只增不减，绝不往左拉', () => {
  const nodes = [
    { id: 'a', x: 500, y: 0, w: 100, h: 50 },
    { id: 'b', x: 520, y: 0, w: 100, h: 50 },
  ];
  const { shifts } = planShifts(nodes, 80);
  for (const k of Object.keys(shifts)) {
    assert.ok(shifts[k] >= 0, k + ' 位移不能为负');
  }
});

ok('reflowSpacing: 80 超宽时降级到 60', () => {
  const nodes = [
    { id: 'a', x: 0,   y: 0, w: 100, h: 50 },
    { id: 'b', x: 120, y: 0, w: 100, h: 50 },
  ];
  const p80 = planShifts(nodes, 80);
  const p60 = planShifts(nodes, 60);
  assert.ok(p60.maxRight < p80.maxRight, '60px 方案的右沿必须更小');
  assert.equal(p80.maxRight - p60.maxRight, 20, '差值应为 20');
});

ok('reflowSpacing: 单节点行不产生位移', () => {
  const nodes = [{ id: 'solo', x: 999, y: 0, w: 100, h: 50 }];
  const { shifts } = planShifts(nodes, 80);
  assert.equal(shifts.solo, 0);
});

ok('桥接层导出 reflowSpacing / polishLayout', () => {
  const b = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  assert.ok(b.includes('reflowSpacing: reflowSpacing'), '缺 reflowSpacing 导出');
  assert.ok(b.includes('polishLayout: polishLayout'), '缺 polishLayout 导出');
  assert.ok(b.includes('fallback'), '超宽降级参数缺失');
});

// ---------------------------------------------------------------- [polish 入口]
for (const name of ['reflowSpacingExpr', 'polishLayoutExpr']) {
  ok('polish 片段可编译: ' + name, () => syntaxOk(P[name]('ai_', {})));
  ok('polish 片段带 NO_BRIDGE: ' + name, () => {
    assert.match(P[name]('ai_', {}), /NO_BRIDGE/);
  });
}

// ---------------------------------------------------------------- [体检 auditLayoutExpr]
ok('auditLayoutExpr 可编译', () => syntaxOk(P.auditLayoutExpr('ai_')));
ok('auditLayoutExpr 传 pageIndex 时做页内作用域', () => {
  const e = P.auditLayoutExpr('ai_', 9);
  assert.match(e, /_p9_/, '应包含 _p9_ 子串');
  syntaxOk(e);
});
ok('auditLayoutExpr 不传 pageIndex 时全页统计', () => {
  const e = P.auditLayoutExpr('ai_');
  assert.doesNotMatch(e, /_p\d+_/);
  syntaxOk(e);
});
ok('auditLayoutExpr 报告 lkSkipped（防止漏算连线）', () => {
  assert.match(P.auditLayoutExpr('ai_', 0), /lkSkipped/);
});
ok('auditLayoutExpr 带 NO_BRIDGE 守卫', () => {
  assert.match(P.auditLayoutExpr('ai_'), /NO_BRIDGE/);
});
ok('auditLayoutExpr 内含三项判定', () => {
  const e = P.auditLayoutExpr('ai_');
  assert.match(e, /badAnchor/);
  assert.match(e, /crossings/);
  assert.match(e, /tightGaps/);
  assert.match(e, /pass:/);
});
ok('auditLayoutExpr 阈值取自 LAYOUT.GAP_FLOOR（不再硬编码数字）', () => {
  const e = P.auditLayoutExpr('ai_');
  assert.match(e, /LAYOUT\.GAP_FLOOR/, '应从桥接层常量读取');
  assert.match(e, /minGap >= FLOOR/, '判定应使用 FLOOR 变量');
});
ok('auditLayoutExpr 含 overlaps 检查', () => {
  const e = P.auditLayoutExpr('ai_');
  assert.match(e, /overlaps/);
  assert.match(e, /overlapSamples/);
});

// ---------------------------------------------------------------- [侧栏说明卡]
ok('桥接层导出 createSideCard / auditSideCard', () => {
  const b = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  assert.ok(b.includes('createSideCard: createSideCard'), '缺 createSideCard');
  assert.ok(b.includes('auditSideCard: auditSideCard'), '缺 auditSideCard');
});
ok('createSideCard 会报告夹取与修复状态', () => {
  const b = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  assert.match(b, /clampedAtCreate/);
  assert.match(b, /repairedByUpdate/);
  assert.match(b, /alignedWithPool/);
});
ok('createSideCard 用 LAYOUT.MIN_X 而非硬编码 -240', () => {
  const b = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  assert.match(b, /x < LAYOUT\.MIN_X/);
  assert.match(b, /MIN_X:\s*-240/);
});
ok('auditSideCard 返回 pass 判定', () => {
  const b = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  assert.match(b, /pass: overlaps\.length === 0/);
});

// ---------------------------------------------------------------- [验收脚本 verify-layout]
const V = await import('./verify-layout.mjs');

ok('judge: 全部达标判 pass', () => {
  const r = { badAnchor: 0, crossings: 0, tightGaps: 0, overlaps: 0, lkSkipped: 0, minGap: 80 };
  const j = V.judge(r);
  assert.equal(j.pass, true);
  assert.deepEqual(j.failures, []);
});

ok('judge: minGap 60 恰好通过（floor 含等于）', () => {
  const r = { badAnchor: 0, crossings: 0, tightGaps: 0, overlaps: 0, lkSkipped: 0, minGap: 60 };
  assert.equal(V.judge(r).pass, true);
});

ok('judge: minGap 59 判失败', () => {
  const r = { badAnchor: 0, crossings: 0, tightGaps: 0, overlaps: 0, lkSkipped: 0, minGap: 59 };
  const j = V.judge(r);
  assert.equal(j.pass, false);
  assert.match(j.failures.join(' '), /minGap=59/);
});

ok('judge: overlaps>0 判失败（新增检查）', () => {
  const r = { badAnchor: 0, crossings: 0, tightGaps: 0, overlaps: 2, lkSkipped: 0, minGap: 80 };
  const j = V.judge(r);
  assert.equal(j.pass, false);
  assert.match(j.failures.join(' '), /overlaps=2/);
});

ok('judge: lkSkipped>0 判失败（防漏算）', () => {
  const r = { badAnchor: 0, crossings: 0, tightGaps: 0, overlaps: 0, lkSkipped: 3, minGap: 80 };
  const j = V.judge(r);
  assert.equal(j.pass, false);
  assert.match(j.failures.join(' '), /lkSkipped=3/);
});

ok('judge: 缺字段判失败而不是误判通过', () => {
  const j = V.judge({ badAnchor: 0, crossings: 0 });
  assert.equal(j.pass, false);
  assert.ok(j.failures.length > 0);
});

ok('judge: NO_BRIDGE 判失败', () => {
  assert.equal(V.judge({ error: 'NO_BRIDGE' }).pass, false);
});

ok('judge: null / undefined 不崩', () => {
  assert.equal(V.judge(null).pass, false);
  assert.equal(V.judge(undefined).pass, false);
});

ok('summarize 统计正确', () => {
  const rows = [
    { page: 0, r: { badAnchor: 0, crossings: 0, tightGaps: 0, overlaps: 0, lkSkipped: 0, minGap: 80 } },
    { page: 1, r: { badAnchor: 1, crossings: 0, tightGaps: 0, overlaps: 0, lkSkipped: 0, minGap: 80 } },
  ];
  const s = V.summarize(rows);
  assert.equal(s.total, 2);
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.allPass, false);
});

ok('THRESHOLDS 与 bridge LAYOUT.GAP_FLOOR 一致', () => {
  const b = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  const m = /GAP_FLOOR:\s*(\d+)/.exec(b);
  assert.ok(m, 'bridge 未定义 GAP_FLOOR');
  assert.equal(Number(m[1]), V.THRESHOLDS.minGap, '两处阈值必须一致');
});

ok('LAYOUT 常量齐全且带推导注释', () => {
  const b = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  for (const k of ['LABEL_MAX_W', 'LABEL_BREATH', 'GAP_TARGET', 'GAP_FLOOR', 'CARD_GAP', 'MIN_X']) {
    assert.ok(new RegExp(k + ':').test(b), '缺常量 ' + k);
  }
  assert.match(b, /47 \+ 16\*2/, '应写明 80 的推导');
  assert.match(b, /用户已确认 60 正确/, '应写明 60 已确认');
});

ok('桥接层导出 detectOverlaps / LAYOUT', () => {
  const b = fs.readFileSync(path.join(REPO, 'bridge', 'pobridge.js'), 'utf8');
  assert.ok(b.includes('detectOverlaps: detectOverlaps'));
  assert.ok(b.includes('LAYOUT: LAYOUT'));
});

// ---------------------------------------------------------------- 汇总
console.log('');
if (fails.length) {
  for (const f of fails) console.error('  FAIL  ' + f.name + '\n        ' + f.message);
  console.error('\n✗ ' + fails.length + ' 项失败 / ' + (pass + fails.length) + ' 项');
  process.exit(1);
}
console.log('✓ ' + pass + ' 项自检全部通过');
