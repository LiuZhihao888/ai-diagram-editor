#!/usr/bin/env node
/**
 * 泳道池行数能力 —— 离线验证（不需要浏览器、不碰任何 ProcessOn 画布）。
 *   node test/verify-pool.mjs
 *
 * 三层一起验：
 *   1. lib/page.mjs 新增片段：语法合法 + 无反斜杠（承接既有硬规矩）+ 参数 JSON 转义无损
 *   2. bridge/pobridge.js 与 pobridge.min.js 在假 ProcessOn 运行时里行为一致
 *   3. 真实字段不变量：行数 = pool.children.length、lane.parent=池、props.height=[表头宽]、池 h=Σ行高
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/page.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
let pass = 0; const fails = [];
const ok = (name, fn) => { try { fn(); pass++; } catch (e) { fails.push({ name, message: e.message }); } };
const syntaxOk = (src) => { new Function(src); return true; };

// ---------- [1] 片段 ----------
const FRAGS = {
  READY: () => P.READY, READ_GRAPH: () => P.READ_GRAPH, COUNT: () => P.COUNT,
  FIT_CANVAS: () => P.FIT_CANVAS, VIEWBOX: () => P.VIEWBOX,
  POOL_BOTTOM: () => P.POOL_BOTTOM, TAB_IDENT: () => P.TAB_IDENT,
  injectExpr: () => P.injectExpr('var a=1;'),
  createNodeExpr: () => P.createNodeExpr({ id:'a', text:'t', x:1, y:2, w:3, h:4 }),
  createEdgeExpr: () => P.createEdgeExpr({ id:'e', from:'a', to:'b' }),
  updateNodeExpr: () => P.updateNodeExpr('a', { text:'x' }),
  removeNodesExpr: () => P.removeNodesExpr(['a']),
  existsExpr: () => P.existsExpr('a'),
  focusExpr: () => P.focusExpr(['a']),
  getPoolRowsExpr: () => P.getPoolRowsExpr('pool1'),
  createPoolExpr: () => P.createPoolExpr({ id:'ai_pool_1', title:'T',
    rows:[{name:'A',height:100},{name:'B',height:150}], x:10, y:20, w:1000, headerWidth:56 }),
  setPoolRowsExpr: () => P.setPoolRowsExpr('pool1', ['A','B','C'], { headerWidth:56 }),
  removePoolExpr: () => P.removePoolExpr('ai_pool_1'),
};
for (const [k, fn] of Object.entries(FRAGS)) {
  ok('片段可编译: ' + k, () => syntaxOk(fn()));
}
ok('新片段不含反斜杠', () => {
  const Q = String.fromCharCode(92);
  const bad = Object.keys(FRAGS).filter(k => { const v = FRAGS[k](); return typeof v === 'string' && v.split(Q).length - 1 > 0; });
  assert.deepEqual(bad, [], '含反斜杠的片段: ' + bad.join(', '));
});
ok('createPoolExpr 参数 JSON 转义无损', () => {
  const rows = [{ name:'带"引号"和\反斜杠', height:100 }, { name:'换行\n第二行', height:150 }];
  const expr = P.createPoolExpr({ id:'ai_pool_x', title:'T', rows, headerWidth:56 });
  syntaxOk(expr);
  const m = /\}\)\((.+)\)$/s.exec(expr);
  assert.ok(m, '参数块不在表达式末尾');
  assert.deepEqual(JSON.parse(m[1]).rows, rows);
});
ok('createPoolExpr 带重复 id 守卫', () => assert.match(P.createPoolExpr({ id:'x', rows:['A'] }), /DUPLICATE_ID/));
ok('setPoolRowsExpr 带 NOT_FOUND 守卫', () => assert.match(P.setPoolRowsExpr('x', ['A']), /POOL_NOT_FOUND/));
ok('removePoolExpr 拒绝删除非 ai_ 池', () => assert.match(P.removePoolExpr('example_pool_0'), /REFUSE_NON_AI/));

// ---------- [2] 假运行时：源码 vs 压缩产物 ----------
function makeFakePo() {
  const elements = {}, log = [];
  const ctx = {
    document: { getElementById: id => elements[id] ? { id } : null },
    Model: { define: { elements, page: { width: 1000, height: 800 } } },
    Designer: { painter: { renderShape: () => {} }, fitTheCanvas: () => {}, scrollShapesToView: () => {} },
    Utils: { canvasViewBox: { x:0, y:0, w:3000, h:9000 } },
    MessageSource: { executeMessages: (msgs, init) => {
      log.push('exec:' + msgs.map(m => m.action).join(',') + ':init=' + init);
      for (const m of msgs) {
        if (m.action === 'create') for (const s of m.content) elements[s.id] = s;
        if (m.action === 'update') for (const s of (m.content.shapes || [])) elements[s.id] = s;
        if (m.action === 'remove') for (const s of m.content) delete elements[s.id];
      }
    } },
  };
  ctx.window = ctx;
  return { ctx, elements, log };
}
function probe(file) {
  const { ctx, elements } = makeFakePo();
  vm.runInContext(fs.readFileSync(file, 'utf8'), vm.createContext(ctx));
  const B = ctx.POBridge;
  const out = { keys: Object.keys(B).sort().join(',') };
  // 创建 3 行
  const cp = B.createPool({ id:'poolX', title:'测试池', x:10, y:20, w:1000,
    rows:[{name:'角色A',height:100},{name:'角色B',height:150},'角色C'], headerWidth:56 });
  out.create = cp;
  const gp = B.getPoolRows('poolX');
  out.rowCount = gp.rowCount;
  out.childrenLen = gp.childrenLength;
  out.poolH = elements['poolX'].props.h;
  out.headerWidth = elements['poolX'].props.height[0];
  out.laneParent = elements['poolX_lane_0'].parent;
  out.laneName = elements['poolX_lane_0'].name;
  out.lane0Y = elements['poolX_lane_0'].props.y;
  out.lane1Y = elements['poolX_lane_1'].props.y;
  out.lane2Y = elements['poolX_lane_2'].props.y;
  out.texts = ['poolX_lane_0','poolX_lane_1','poolX_lane_2'].map(id => elements[id].textBlock[0].text).join('|');
  // 改成 5 行
  const s5 = B.setPoolRows('poolX', ['A','B','C','D','E'], {});
  out.set5 = { rowCount:s5.rowCount, added:s5.added, updated:s5.updated, removed:s5.removed };
  out.set5Children = elements['poolX'].children.length;
  out.set5H = elements['poolX'].props.h;
  // 缩回 2 行 + 自定义行高
  const s2 = B.setPoolRows('poolX', [{name:'X',height:80},{name:'Y',height:120}], {});
  out.set2 = { rowCount:s2.rowCount, added:s2.added, removed:s2.removed };
  out.set2H = elements['poolX'].props.h;
  out.set2Texts = elements['poolX_lane_0'].textBlock[0].text + '/' + elements['poolX_lane_1'].textBlock[0].text;
  // 边界守卫
  out.guardEmpty = false; try { B.createPool({ rows:[] }); } catch (e) { out.guardEmpty = true; }
  out.guard51 = false; try { B.createPool({ rows:new Array(51).fill('A') }); } catch (e) { out.guard51 = true; }
  out.guardBadH = false; try { B.createPool({ rows:[{name:'A',height:1}] }); } catch (e) { out.guardBadH = true; }
  out.guardWrongPool = false; try { B.setPoolRows('poolX_lane_0', ['A']); } catch (e) { out.guardWrongPool = true; }
  out.notFound = B.getPoolRows('nope');
  return out;
}
// 源码只在仓库布局里有；技能被单独安装到 ~/.dsh/skills/ 时找不到，
// 此时跳过需要源码的 parity 断言（不判失败），只验证压缩产物自身。
const REPO_ROOT = path.resolve(SKILL, '..', '..', '..');
const SRC = [
  path.join(REPO_ROOT, 'bridge', 'pobridge.js'),
  path.resolve(SKILL, '..', 'bridge', 'pobridge.js'),
].find((p) => fs.existsSync(p)) || null;
const MIN = path.join(SKILL, 'pobridge.min.js');

ok('技能里存在 pobridge.min.js', () => { assert.ok(fs.existsSync(MIN)); });
if (!SRC) {
  console.log('  SKIP  源码 parity（未找到 bridge/pobridge.js，技能可能是独立安装）');
}
// a = 源码（可能没有），b = 压缩产物（必须有）
const b = probe(MIN);
if (SRC) {
const a = probe(SRC);
if (SRC) ok('源码与压缩产物行为完全一致', () => {
  // 用「稳定序列化」比较：JSON.stringify 的键顺序可能因压缩而不同，先按键名排序再比。
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      const o = {}; for (const k of Object.keys(v).sort()) o[k] = stable(v[k]); return o;
    }
    return v;
  };
  for (const k of Object.keys(a)) assert.deepEqual(stable(a[k]), stable(b[k]),
    '漂移字段: ' + k + ' src=' + JSON.stringify(a[k]) + ' min=' + JSON.stringify(b[k]));
});
} // end if (SRC)
const a = b;   // 没有源码时，后续断言以产物自身为基准
ok('导出含 getPoolRows/createPool/setPoolRows', () => {
  for (const k of ['getPoolRows','createPool','setPoolRows']) assert.ok(a.keys.includes(k), '缺 ' + k);
});
ok('createPool 行数 = rows.length = children.length', () => {
  assert.equal(a.create.rowCount, 3);
  assert.equal(a.childrenLen, 3);
  assert.equal(a.rowCount, 3);
});
ok('池高 = 各行高之和；行 y 自上而下堆叠', () => {
  assert.equal(a.create.totalHeight, 450);
  assert.equal(a.poolH, 450);
  assert.equal(a.lane0Y, 20);
  assert.equal(a.lane1Y, 120);   // 20 + 100
  assert.equal(a.lane2Y, 270);   // 120 + 150
});
ok('lane 是 horizontalLane 且 parent = 池 id', () => {
  assert.equal(a.laneName, 'horizontalLane');
  assert.equal(a.laneParent, 'poolX');
});
ok('表头列宽是 props.height[0]，不是行数/行高', () => {
  assert.equal(a.headerWidth, 56);
  assert.equal(a.texts, '角色A|角色B|角色C');
});
ok('setPoolRows 增行复用旧 lane、只新建差额', () => {
  assert.deepEqual(a.set5, { rowCount:5, added:2, updated:3, removed:0 });
  assert.equal(a.set5Children, 5);
  assert.equal(a.set5H, 1000);   // 5 x 200
});
ok('setPoolRows 缩行删除多余 lane 并同步池高', () => {
  assert.deepEqual(a.set2, { rowCount:2, added:0, removed:3 });
  assert.equal(a.set2H, 200);    // 80 + 120
  assert.equal(a.set2Texts, 'X/Y');
});
ok('边界守卫：空 rows / >50 行 / 非法行高 / 目标非池 / 不存在池', () => {
  assert.ok(a.guardEmpty && a.guard51 && a.guardBadH && a.guardWrongPool);
  assert.equal(a.notFound, null);
});
console.log('');
if (fails.length) {
  for (const f of fails) console.error('  FAIL  ' + f.name + '\n        ' + f.message);
  console.error('\n✗ ' + fails.length + ' 项失败 / ' + (pass + fails.length) + ' 项');
  process.exit(1);
}
console.log('✓ ' + pass + ' 项泳道池行数离线验证全部通过');