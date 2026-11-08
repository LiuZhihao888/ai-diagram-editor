/**
 * 桥接层产物一致性测试 —— 验证两个落盘位置的产物「行为完全一致」。
 *
 * 为什么不能只做文本匹配：同一份源码经 esbuild 压缩后变量名会变，
 * 找 maxX<minX 这种字面量会被压缩成 s<l? 而误判功能丢失。
 * 这里造一个假 ProcessOn 运行时，让两个产物跑同一套语义断言。
 *
 * 运行：node test/parity.mjs
 */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');

/** 造一个假 ProcessOn 运行时，让桥接层能跑起来 */
function makeFakePo() {
  const elements = {};
  const log = [];
  const layoutEl = { scrollLeft: 0, scrollTop: 0 };
  const ctx = {
    document: {
      getElementById: (id) =>
        id === 'designer_layout' ? layoutEl : (elements[id] ? { id } : null),
    },
    Model: { define: { elements, page: { width: 1000, height: 800 } } },
    Designer: {
      painter: { renderShape: () => {} },
      fitTheCanvas: () => log.push('fit'),
      scrollShapesToView: (ids) => log.push('focus:' + ids.join(',')),
    },
    Utils: {
      canvasViewBox: { x: 0, y: 0, w: 1200, h: 900 },
      canvasViewBoxUpdate: () => {},
    },
    MessageSource: {
      executeMessages: (msgs, init) => {
        log.push('exec:' + msgs.map(m => m.action).join(',') + ':init=' + init);
        for (const m of msgs) {
          if (m.action === 'create') for (const s of m.content) elements[s.id] = s;
          if (m.action === 'update') for (const s of (m.content.shapes || [])) elements[s.id] = s;
          if (m.action === 'remove') for (const s of m.content) delete elements[s.id];
        }
      },
    },
  };
  ctx.window = ctx;
  return { ctx, elements, log, layoutEl };
}

async function probe(file, label) {
  const src = fs.readFileSync(file, 'utf8');
  const { ctx, elements, log, layoutEl } = makeFakePo();
  const sb = vm.createContext(ctx);
  vm.runInContext(src, sb);
  const B = ctx.POBridge;
  const out = { label, hasBridge: typeof B === 'object', keys: B ? Object.keys(B).sort() : null };

  // 1) 创建节点
  const c = B.createNode({ id: 'n1', text: '测试', x: 100, y: 100, w: 200, h: 80, name: 'process', fill: '', line: '', font: '' });
  out.created = !!elements['n1'];

  // 2) 读取
  const g = B.readGraph();
  out.readNodes = g.nodes.length;
  out.readEdges = g.edges.length;

  // 3) 更新
  B.updateNode('n1', { text: '改后' });
  out.updatedText = elements['n1'].textBlock[0].text;

  // 4) 连线
  const c2 = B.createNode({ id: 'n2', text: '第二', x: 100, y: 300, w: 200, h: 80, name: 'process', fill: '', line: '', font: '' });
  B.createEdge({ id: 'e1', from: 'n1', to: 'n2', text: '是' });
  out.edgeCreated = !!elements['e1'];

  // 5) 删除
  B.removeNodes(['n1']);
  out.removed = !elements['n1'];

  // 6) 视口夹取：给一个远在视口外的坐标，应被夹回
  const far = B.createNode({ id: 'n3', text: '远程', x: 99999, y: 99999, w: 200, h: 80, name: 'process', fill: '', line: '', font: '' });
  const p = elements['n3'].props;
  out.clampedX = p.x;
  out.clampedY = p.y;
  out.wasClamped = p.x < 99999 && p.y < 99999;

  // 7) 视口比元素还小时应退化为居中
  ctx.Utils.canvasViewBox = { x: 0, y: 0, w: 100, h: 60 };
  const tiny = B.createNode({ id: 'n4', text: '小视口', x: 500, y: 500, w: 200, h: 80, name: 'process', fill: '', line: '', font: '' });
  const p4 = elements['n4'].props;
  out.degenerateCentered = (p4.x === Math.round((100 - 200) / 2) || Math.abs(p4.x - (0 + (100 - 200) / 2)) < 2);

  out.viewBox = !!B.getViewBox().w;

  out.poolKeys = ['getPoolRows','createPool','setPoolRows'].filter(function (k) { return typeof B[k] !== 'function'; });
  var cp = B.createPool({ id: 'poolX', title: '测试池', x: 10, y: 20, w: 1000,
    rows: [{ name: '角色A', height: 100 }, { name: '角色B', height: 150 }, '角色C'],
    headerWidth: 56 });
  out.poolCreated = cp.rowCount === 3;
  out.poolTotalH = cp.totalHeight;            // 100+150+200 = 450
  var gp = B.getPoolRows('poolX');
  out.poolRowCount = gp.rowCount;
  out.poolChildrenLen = gp.childrenLength;
  out.poolLane0 = { name: elements['poolX_lane_0'].name, parent: elements['poolX_lane_0'].parent,
    y: elements['poolX_lane_0'].props.y, h: elements['poolX_lane_0'].props.h,
    text: elements['poolX_lane_0'].textBlock[0].text };
  out.poolLane1Y = elements['poolX_lane_1'].props.y;   // 20+100=120
  out.poolTitle = elements['poolX'].textBlock[0].text;
  out.poolHeaderWidth = elements['poolX'].props.height[0];
  var s5 = B.setPoolRows('poolX', ['A','B','C','D','E'], { headerWidth: 56 });
  out.pool5 = { rowCount: s5.rowCount, added: s5.added, updated: s5.updated, removed: s5.removed };
  out.pool5H = elements['poolX'].props.h;
  var s2 = B.setPoolRows('poolX', [{ name: 'X', height: 80 }, { name: 'Y', height: 120 }], {});
  out.pool2 = { rowCount: s2.rowCount, added: s2.added, removed: s2.removed };
  out.pool2H = elements['poolX'].props.h;
  out.pool2Names = elements['poolX_lane_0'].textBlock[0].text + '/' + elements['poolX_lane_1'].textBlock[0].text;
  // 边界：非法输入应抛错而不是静默改坏画布
  out.guardEmptyRows = false; try { B.createPool({ rows: [] }); } catch (e) { out.guardEmptyRows = true; }
  out.guardBadPool = false; try { B.setPoolRows('n3', ['A']); } catch (e) { out.guardBadPool = true; }

  // 8) clampIntoView 自证：请求坐标 vs 实际坐标
  // 注意：第 7 步把 viewBox 改成了 100x60，这里必须先恢复，否则 100/200 也会被夹
  ctx.Utils.canvasViewBox = { x: 0, y: 0, w: 1200, h: 900 };
  const cIn = B.clampIntoView(100, 200, 200, 80);
  out.clampReportsRequested =
    cIn.requested && cIn.requested.x === 100 && cIn.requested.y === 200;
  out.clampReportsActual = cIn.actual && typeof cIn.actual.x === 'number';
  out.clampFlagFalseWhenFit = cIn.clamped === false;

  const cOut = B.clampIntoView(99999, 99999, 200, 80);
  out.clampFlagTrueWhenForced = cOut.clamped === true;

  // 9) focusRect 只滚动，不调 fitTheCanvas
  ctx.Utils.canvasViewBox = { x: 0, y: 0, w: 1200, h: 900 };
  const logLenBefore = log.length;
  const fr = B.focusRect(5000, 5000, 200, 80);
  out.focusUsesScroll = layoutEl.scrollLeft !== 0 || layoutEl.scrollTop !== 0;
  out.focusNoFit = !log.slice(logLenBefore).some((x) => String(x).startsWith('fit'));
  out.focusReportsActual = !!fr.actual && typeof fr.actual.scrollLeft === 'number';

  // 10) viewBox 坏掉时必须抛错，而不是静默产出 NaN
  const goodVb = ctx.Utils.canvasViewBox;
  ctx.Utils.canvasViewBox = { x: NaN, y: 0, w: 100, h: 100 };
  let threw = false;
  try { B.getViewBox(); } catch (e) { threw = /VIEWBOX_INVALID/.test(String(e.message)); }
  out.viewBoxAssertsNaN = threw;
  ctx.Utils.canvasViewBox = goodVb;

  out.msgLog = log.join(' | ');
  return out;
}

const MIN = path.join(SKILL_ROOT, 'pobridge.min.js');
const IIFE = path.join(REPO_ROOT, 'wb', 'pobridge.js');

if (!fs.existsSync(MIN)) {
  console.error('✗ 技能里没有 pobridge.min.js：' + MIN);
  process.exit(2);
}
if (!fs.existsSync(IIFE)) {
  console.log('SKIP  wb/pobridge.js 不存在（只装了技能，没装 WorkBuddy 方案）');
  process.exit(0);
}

const min = await probe(MIN, 'min');
const iife = await probe(IIFE, 'iife');

console.log('=== min ===');
console.log(JSON.stringify(min, null, 1));
console.log('=== iife ===');
console.log(JSON.stringify(iife, null, 1));

const KEYS = [
  'hasBridge', 'created', 'readNodes', 'readEdges', 'updatedText', 'edgeCreated',
  'removed', 'clampedX', 'clampedY', 'wasClamped', 'degenerateCentered', 'viewBox',
  // 方案 C 新增：夹取自证 + 跳转不打扰 + viewBox 断言
  'clampReportsRequested', 'clampReportsActual', 'clampFlagFalseWhenFit',
  'clampFlagTrueWhenForced', 'focusUsesScroll', 'focusNoFit',
  'focusReportsActual', 'viewBoxAssertsNaN',
  // 泳道池行数控制（与 DSH/WorkBuddy 两份产物同步校验）
  'poolKeys', 'poolCreated', 'poolTotalH', 'poolRowCount', 'poolChildrenLen',
  'poolLane0', 'poolLane1Y', 'poolTitle', 'poolHeaderWidth',
  'pool5', 'pool5H', 'pool2', 'pool2H', 'pool2Names',
  'guardEmptyRows', 'guardBadPool',
];
let drift = [];
for (const k of KEYS) if (JSON.stringify(min[k]) !== JSON.stringify(iife[k])) drift.push(k + ': min=' + min[k] + ' iife=' + iife[k]);
console.log();
console.log(drift.length ? '✗ DRIFT: ' + drift.join(' ; ') : '✓ 两个产物行为完全一致');
process.exit(drift.length ? 1 : 0);
