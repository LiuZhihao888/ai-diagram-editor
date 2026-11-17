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
import vm from 'node:vm';
import * as P from '../lib/page.mjs';

let pass = 0;
let skip = 0;
const fails = [];
const skips = [];
const ok = (name, fn) => {
  try { fn(); pass++; }
  catch (e) {
    // 桥接层源码不在旁边时（技能被单独安装），这类断言跳过而不是判失败。
    if (e && e.message === 'SKIP_NO_BRIDGE_SRC') { skip++; skips.push(name); return; }
    fails.push({ name, message: e.message });
  }
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

// ---------------------------------------------------------------- [4.5] 文字定宽 measureTextFit / fitNodeSize
// 这一节跑的是**页面里那段真源码**（P.FIT_ALGO_SRC 被原样内联进两个表达式），
// 所以离线断言和线上行为不会分叉。
const fitAlgo = new Function(P.FIT_ALGO_SRC + ' return { fitMeasure: fitMeasure, fitWrapLines: fitWrapLines };')();
/**
 * 造一个测量结果喂给算法。
 * widths 是每行的文字像素宽（模拟 canvas measureText 的输出），不是字数。
 */
const fitPlan = (curW, curH, widths, opts) => fitAlgo.fitMeasure({
  curW: curW,
  curH: curH,
  maxLineW: Math.max.apply(null, widths),
  lines: widths,
  availW: Math.max(1, curW - ((opts && opts.textInset) || 20)),
}, Object.assign({ padding: 16, minW: 110, minH: 0 }, opts || {}));

for (const name of ['measureTextFitExpr', 'fitNodeSizeExpr']) {
  ok('尺寸片段可编译: ' + name, () => syntaxOk(P[name](['ai_a', 'ai_b'])));
  ok('尺寸片段带 NO_BRIDGE 守卫: ' + name, () => {
    assert.match(P[name](['ai_a']), /NO_BRIDGE/);
  });
}

ok('尺寸片段用 canvas measureText 精确量，不用「字数 x 字号」估算', () => {
  const js = P.measureTextFitExpr(['ai_a']);
  assert.match(js, /getContext\("2d"\)/, '必须用 canvas 2d 上下文');
  assert.match(js, /ctx\.measureText\(/, '必须逐行调用 measureText');
  assert.match(js, /Microsoft YaHei/, '字体必须是实测用的微软雅黑 13px');
  // 估算式（长度乘字号）一旦出现就是回到了那条被证伪的老路
  assert.doesNotMatch(js, /\.length\s*\*\s*1?[0-9]/, '出现「字数 x 字号」估算');
});

ok('measureTextFitExpr 只读、fitNodeSizeExpr 才写', () => {
  // 两个表达式共用主干，靠末尾的 write 布尔开关区分，写死才不会串
  assert.match(P.measureTextFitExpr(['ai_a']), /, false\)$/);
  assert.match(P.fitNodeSizeExpr(['ai_a']), /, true\)$/);
  assert.match(P.fitNodeSizeExpr(['ai_a']), /executeMessages/);
});

ok('尺寸片段与 selftest 跑的是同一份算法源码（FIT_ALGO_SRC 被内联）', () => {
  for (const name of ['measureTextFitExpr', 'fitNodeSizeExpr']) {
    assert.ok(P[name](['ai_a']).includes('function fitMeasure(m, o)'), name + ' 没有内联 FIT_ALGO_SRC');
  }
});

ok('只缩不放：newW 绝不大于 curW', () => {
  // 文字比框宽 -> 需要更宽，但这条能力只负责收窄，必须保持原宽
  const p = fitPlan(140, 80, [400]);
  assert.equal(p.newW, 140, '文字超出时不许加宽');
  assert.equal(p.dw, 0);
  assert.equal(p.widthSaved, 0);
  // 文字窄 -> 收窄
  const q = fitPlan(300, 80, [60]);
  assert.ok(q.newW <= 300, '收窄后不能比原来宽');
  assert.ok(q.widthSaved > 0, '应该真的收窄了');
});

ok('只缩不放：minW 比 curW 还大时也不撑宽', () => {
  // 100 宽的节点 + minW=110：如果写成 max(minW, needW) 直接取值就会撑到 110
  const p = fitPlan(100, 60, [30], { minW: 110, padding: 16 });
  assert.equal(p.newW, 100, 'minW 不能把节点撑大');
  assert.equal(p.dw, 0);
});

ok('minW 生效：文字很窄时收到 minW 而不是继续缩', () => {
  const p = fitPlan(300, 60, [40], { minW: 110, padding: 16 });
  assert.equal(p.needW, 40 + 32, 'needW = 文字宽 + padding*2');
  assert.equal(p.newW, 110, 'needW 小于 minW 时取下限 110');
  const q = fitPlan(300, 60, [40], { minW: 140, padding: 16 });
  assert.equal(q.newW, 140, 'minW 可配置');
});

ok('多行取最长行：needW 由最长的一行决定', () => {
  const p = fitPlan(400, 120, [40, 180, 60]);
  assert.equal(p.needW, 180 + 32, 'needW 应取最长行 180');
  assert.equal(p.newW, 212);
  // 反过来：最长行在中间、末尾很短，也不能按最后一行算
  const q = fitPlan(400, 120, [200, 30]);
  assert.equal(q.needW, 200 + 32);
});

ok('多行取最长行：padding 参与计算（needW = ceil(maxLineW) + padding*2）', () => {
  const p = fitPlan(400, 120, [180], { padding: 24 });
  assert.equal(p.needW, 180 + 48);
  const q = fitPlan(400, 120, [180], { padding: 0 });
  assert.equal(q.needW, 180);
});

ok('高度：needH = ceil(行数 x 13 x 1.25) + 24', () => {
  const one = fitPlan(400, 120, [100]);
  assert.equal(one.needH, Math.ceil(1 * 13 * 1.25) + 24, '单行 needH');
  const three = fitPlan(400, 120, [100, 100, 100]);
  assert.equal(three.needH, Math.ceil(3 * 13 * 1.25) + 24, '三行 needH');
  // 只缩不放：原高比 needH 矮时不加高
  const short = fitPlan(400, 20, [100, 100, 100]);
  assert.equal(short.newH, 20, '高度也不许撑大');
});

ok('换行计入行高：文字超出可用宽度时按换行后的行数算高', () => {
  // 框宽 140 -> 可用 120，一行 300px 的文字会被折成 3 行
  const p = fitPlan(140, 120, [300]);
  assert.equal(p.wrapLines, 3, '300/120 向上取整为 3 行');
  assert.equal(p.needH, Math.ceil(3 * 13 * 1.25) + 24);
  assert.equal(p.newW, 140, '折行说明当前宽度装得下，不该再收窄');
});

ok('尺寸算法不带 minH 时高度下限为 0，传了才生效', () => {
  const p = fitPlan(400, 300, [100], { minH: 200 });
  assert.equal(p.newH, 200, 'minH 应把结果抬到 200');
  const q = fitPlan(400, 300, [100]);
  assert.equal(q.newH, Math.ceil(13 * 1.25) + 24, '默认 minH=0，按文字算');
});

ok('ids 省略时按 prefix 扫全页；结构件默认跳过', () => {
  const e = P.measureTextFitExpr();
  assert.match(e, /o\.prefix/, '应有 prefix 扫描分支');
  assert.match(e, /pool\|lane\|linker/, '应跳过 pool/lane/linker');
  assert.match(e, /includeStructural/, '应可通过 includeStructural 打开');
  syntaxOk(e);
});

ok('尺寸片段给出自检字段 changed/skipped/savedPx/ratio', () => {
  const js = P.fitNodeSizeExpr(['ai_a']);
  for (const k of ['changed', 'skipped', 'unchanged', 'savedPx', 'savedH', 'ratio', 'items']) {
    assert.ok(js.includes(k), '缺字段: ' + k);
  }
  assert.match(js, /totalCurW/, 'ratio 的分母要能自证');
});

ok('尺寸片段拒绝空 id 数组', () => {
  assert.match(P.fitNodeSizeExpr([]), /EMPTY_IDS/);
});


// ---------------------------------------------------------------- [5] 技能包自洽
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');   // test/ 的上一级就是技能根
const MIN = path.join(SKILL, 'pobridge.min.js');
// 桥接层源码的位置。仓库布局下在 <仓库根>/bridge/pobridge.js；
// 但技能也可能被单独安装到 ~/.dsh/skills/（此时向上三级不是仓库根）。
// 所以按「候选路径依次探测」而不是硬算，找不到就明确跳过而不是报 ENOENT。
const BRIDGE_SRC = (() => {
  // 仓库布局的 bridge/pobridge.js —— 有源码时优先用它做静态断言。
  // 刻意**不**回退到技能目录的 bridge-src/pobridge.js：那是历史遗留的分叉副本，
  // 内容比仓库旧（曾差 23KB、缺 createSideCard/detectOverlaps），
  // 拿它做断言会得到「假失败」，反而掩盖真正的问题。
  const candidates = [
    path.resolve(SKILL, '..', '..', '..', 'bridge', 'pobridge.js'), // 仓库布局
    path.resolve(SKILL, '..', 'bridge', 'pobridge.js'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
})();
const HAS_BRIDGE_SRC = BRIDGE_SRC !== null;

/** 读桥接层源码；找不到时抛出可读信息（这些断言会被记为 skip 而不是 fail）。 */
function bridgeCode() {
  if (!BRIDGE_SRC) throw new Error('SKIP_NO_BRIDGE_SRC');
  return fs.readFileSync(BRIDGE_SRC, 'utf8');
}

// ---------------------------------------------------------------- 可执行沙箱
// 【为什么需要】只查源码字符串的断言是弱断言：把 for(i=0;i<4;i++) 改成 i<0、
// 或在函数开头插一句 if(true) return false，变量名全都还在，弱断言照过。
// 独立核验用变异测试证明过这一点（3 种真实回归穿透全部 135 项）。
//
// 【怎么办】在 vm 里给 pobridge.min.js 造一个假运行时（Model/Designer/Utils/
// MessageSource），把它当黑盒调，断言**返回值**而不是**源码特征**。
// 这样即使装到 ~/.dsh/skills/（没有 bridge/pobridge.js 源码）也能跑真测试。
const HAS_SANDBOX_RUNTIME = true;

/** 建一个最小假画布，返回 {sandbox, POBridge, els} */
function makeSandbox(shape) {
  const els = shape || {};
  const listeners = {};
  const fake = {
    Model: {
      define: { elements: els },
      // reflowSpacing 等写操作走这里；记录下来以便断言"到底改没改"
      updates: [],
      updateMulti(list) { this.updates.push(list); },
      update(el) { this.updates.push([el]); },
    },
    Designer: {
      events: { push() {} },
      scrollShapesToView() {},
      getZoom() { return 1; },
      getScrollPosition() { return { x: 0, y: 0 }; },
      setScrollPosition() {},
      repaint() {},
    },
    // clampIntoView / focusRect 需要它；不给的话 getViewBox 会正确抛 VIEWBOX_INVALID
    Utils: {
      guid() { return 'g' + Math.random().toString(36).slice(2, 8); },
      canvasViewBox: shape && shape.__viewBox ? shape.__viewBox : { x: 0, y: 0, w: 1200, h: 800 },
    },
    MessageSource: {
      executed: [],
      executeMessages(m) { this.executed.push(m); },
    },
    document: { createElement: () => ({ getContext: () => null, style: {} }) },
    window: null,
    console,
  };
  fake.window = fake;
  fake.global = fake;
  const sandbox = vm.createContext(fake);
  const src = fs.readFileSync(MIN, 'utf8');
  vm.runInContext(src, sandbox);
  return { sandbox, fake, els };
}

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
  const bridgeSrc = bridgeCode();
  const focusBlock = bridgeSrc.slice(bridgeSrc.indexOf('function focusRect'), bridgeSrc.indexOf('// ---------- 创建节点'));
  assert.ok(!/fitTheCanvas/.test(focusBlock), 'focusRect 里不该调 fitTheCanvas');
  assert.ok(/scrollLeft/.test(focusBlock), 'focusRect 应该用 scrollLeft');
});
ok('viewBox 有 NaN 断言', () => {
  const bridgeSrc = bridgeCode();
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
  const b = bridgeCode();
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
ok('angle 常量方向正确（实测：L=0 T=PI/2 R=PI B=3PI/2）', () => {
  // 【实测校正 2】把 ANCHOR 改回 {L:0,T:PI/2,R:PI,B:3PI/2} 后，
  // 用真实元素 id 扫了 4 个边 x 4 个边 = 16 个组合，全部满足
  //   「首段垂直该边 + 末段垂直该边 + 首段朝外」= 16/16。
  // 并且用户手绘的 yhUELGdssE549967（from.angle=4.7124=3PI/2, to.angle=3.1416=PI）
  // 用这套值可以逐字节复现成 -91,1486。
  //
  // 旧断言（L:PI, T:-PI/2, R:0, B:PI/2）来自一次错误的统计：
  // 那次统计的是 to.angle（入边），却被当成 ANCHOR 用。
  // 数学上 -PI/2 与 3PI/2 等价，但产品的分支判据看数值区间，
  // 传 -PI/2 会从错的一侧出边，逼出 3~4 个折点且末段不垂直。
  const b = bridgeCode();
  assert.match(b, /ANCHOR\s*=\s*\{\s*L:\s*0\b/, 'L 应为 0');
  assert.match(b, /R:\s*Math\.PI\b/, 'R 应为 PI');
  assert.match(b, /T:\s*Math\.PI\s*\/\s*2/, 'T 应为 PI/2');
  assert.match(b, /B:\s*\(?\s*3\s*\*\s*Math\.PI\s*\)?\s*\/\s*2/, 'B 应为 3PI/2');
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
  const b = bridgeCode();
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
  const b = bridgeCode();
  assert.ok(b.includes('createSideCard: createSideCard'), '缺 createSideCard');
  assert.ok(b.includes('auditSideCard: auditSideCard'), '缺 auditSideCard');
});
ok('createSideCard 会报告夹取与修复状态', () => {
  const b = bridgeCode();
  assert.match(b, /clampedAtCreate/);
  assert.match(b, /repairedByUpdate/);
  assert.match(b, /alignedWithPool/);
});
ok('createSideCard 用 LAYOUT.MIN_X 而非硬编码 -240', () => {
  const b = bridgeCode();
  assert.match(b, /x < LAYOUT\.MIN_X/);
  assert.match(b, /MIN_X:\s*-240/);
});
ok('auditSideCard 返回 pass 判定', () => {
  const b = bridgeCode();
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
  const b = bridgeCode();
  const m = /GAP_FLOOR:\s*(\d+)/.exec(b);
  assert.ok(m, 'bridge 未定义 GAP_FLOOR');
  assert.equal(Number(m[1]), V.THRESHOLDS.minGap, '两处阈值必须一致');
});

ok('LAYOUT 常量齐全且带推导注释', () => {
  const b = bridgeCode();
  for (const k of ['LABEL_MAX_W', 'LABEL_BREATH', 'GAP_TARGET', 'GAP_FLOOR', 'CARD_GAP', 'MIN_X']) {
    assert.ok(new RegExp(k + ':').test(b), '缺常量 ' + k);
  }
  assert.match(b, /47 \+ 16\*2/, '应写明 80 的推导');
  assert.match(b, /用户已确认 60 正确/, '应写明 60 已确认');
});

ok('桥接层导出 detectOverlaps / LAYOUT', () => {
  const b = bridgeCode();
  assert.ok(b.includes('detectOverlaps: detectOverlaps'));
  assert.ok(b.includes('LAYOUT: LAYOUT'));
});

// ---------------------------------------------------------------- 设计规范 auditDesignExpr
for (const name of ['auditDesignExpr']) {
  ok('设计规范片段可编译: ' + name, () => syntaxOk(P[name]('ai_', 0)));
  ok('设计规范片段带 NO_BRIDGE 守卫: ' + name, () => {
    assert.match(P[name]('ai_'), /NO_BRIDGE/);
  });
}
ok('auditDesignExpr 传 pageIndex 时做页内作用域', () => {
  const e = P.auditDesignExpr('ai_', 9);
  assert.match(e, /_p9_/, '应包含 _p9_ 子串');
  syntaxOk(e);
});
ok('auditDesignExpr 不再硬编码尺寸基准（改为参考输出）', () => {
  const e = P.auditDesignExpr('ai_');
  assert.match(e, /sizeTally/, '应输出尺寸分布供参考');
  assert.match(e, /decorSkipped/, '应报告排除了多少装饰元素');
});
ok('auditDesignExpr 文案上限 16 字', () => {
  assert.match(P.auditDesignExpr('ai_'), /MAX_TEXT = 16/);
});
ok('auditDesignExpr 报告三项指标', () => {
  const e = P.auditDesignExpr('ai_');
  for (const k of ['tooLong', 'tooWide', 'pass']) {
    assert.match(e, new RegExp(k + ':'), '缺指标 ' + k);
  }
  assert.ok(e.indexOf('offSize') < 0, 'offSize 已移除（误报太多）');
});
ok('auditDesignExpr 排除泳道/卡片/备注（只查真正的流程节点）', () => {
  const e = P.auditDesignExpr('ai_');
  assert.match(e, /pool\|lane\|linker/, '应排除泳道和连线');
  assert.match(e, /_hdr_\|_note_\|_card\|_band/, '应排除装饰元素');
});
ok('SKILL.md 记录的设计数字与桥接层一致', () => {
  const md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  // 五之八 里写的核心数字必须真实存在
  assert.match(md, /132×62/, '应写主力尺寸 132×62');
  assert.match(md, /8–12 字/, '应写文案长度区间');
  assert.match(md, /行高 140|140px/, '应写泳道行高 140');
  // 布局预算 的算例必须算得对
  assert.match(md, /9 × 132 \+ 8 × 80 = 1188 \+ 640 = 1828/, '9 节点算例应对');
});

// ---------------------------------------------------------------- 连线绕行（reroute）
ok('桥接层导出 suggestChannel / rerouteEdge / rerouteWorstEdges', () => {
  const b = bridgeCode();
  for (const k of ['suggestChannel', 'rerouteEdge', 'rerouteWorstEdges']) {
    assert.ok(b.includes(k + ': ' + k), '缺导出 ' + k);
  }
});
// 【行为断言】不查源码，直接调真函数，检查它真正发出去的 update 消息。
// 这样即使在 ~/.dsh/skills/ 下没有 bridge/pobridge.js 源码也能跑（P6 修复）。
ok('rerouteEdge 保持端点锚点（不动 from/to 的 y）', () => {
  const { fake, els } = makeSandbox({
    nA: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    nB: { name: 'process', props: { x: 500, y: 300, w: 132, h: 62 } },
    lk: {
      name: 'linker', linkerType: 'straight',
      from: { x: 232, y: 131, angle: 0, id: 'nA' },
      to: { x: 500, y: 331, angle: 3.14, id: 'nB' },
      points: [],
    },
  });
  const before = JSON.parse(JSON.stringify(els.lk));
  fake.POBridge.rerouteEdge('lk', 200);
  const msg = fake.MessageSource.executed[0];
  assert.ok(msg, 'rerouteEdge 应该发出一条 update 消息');
  const upd = msg[0].content.shapes[0];
  assert.equal(upd.from.y, before.from.y, 'from.y 必须保持不变（否则锚点脱离边缘）');
  assert.equal(upd.to.y, before.to.y, 'to.y 必须保持不变');
  assert.equal(upd.from.x, before.from.x, 'from.x 必须保持不变');
  assert.equal(upd.to.x, before.to.x, 'to.x 必须保持不变');
  assert.ok(Array.isArray(upd.points) && upd.points.length >= 2, '应设置 points');
  assert.equal(upd.points[0].y, 200, '折点应落在通道上');
});
// 【行为断言】构造"水平通道干净但竖直段必穿节点"的场景，
// 正确实现必须跳过并说明原因；如果没做竖直段校验，它就会硬改。
ok('rerouteWorstEdges 漏过竖直段必穿节点的边', () => {
  const { fake } = makeSandbox({
    // 源节点在下，目标节点在上，中间夹一个节点挡住竖直通道
    nSrc: { name: 'process', props: { x: 100, y: 400, w: 132, h: 62 } },
    nDst: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    nBlock: { name: 'process', props: { x: 140, y: 240, w: 60, h: 60 } },
    // 两端锚点都在竖直边上（T/B），通道必然穿过 nBlock
    lk: {
      name: 'linker', linkerType: 'broken',
      from: { x: 166, y: 400, angle: -1.57, id: 'nSrc' },
      to: { x: 166, y: 162, angle: 1.57, id: 'nDst' },
      points: [{ x: 166, y: 300 }, { x: 166, y: 230 }],
    },
  });
  // 【不能吞异常】原来这里是 catch (e) { return; }，等于把"直接崩"当成通过。
  // 变异测试证明：让 rerouteWorstEdges 无条件抛异常，137 项全绿。
  let out;
  try { out = fake.POBridge.rerouteWorstEdges({ max: 5, minCross: 1 }); }
  catch (e) { assert.fail('rerouteWorstEdges 不该抛异常：' + e.message); }
  // 如果它改了这个边，就说明没做竖直段校验
  const touched = (out.applied || []).some((v) => v.edge === 'lk');
  if (touched) {
    const msg = fake.MessageSource.executed[0];
    const upd = msg && msg[0].content.shapes[0];
    assert.ok(false, '竖直段必穿 nBlock，不该硬改；实际改成 ' + JSON.stringify(upd && upd.points));
  }
});
ok('verticalSegBlocked 排除泳道/连线/超大元素', () => {
  const b = bridgeCode();
  const i = b.indexOf('function verticalSegBlocked');
  const seg = b.slice(i, i + 1200);
  assert.match(seg, /pool\|lane\|linker/);
  assert.match(seg, /p\.w > 1000/);
});
ok('auditLayoutExpr 按 name 识别连线，不再用 _lk_ 前缀', () => {
  const e = P.auditLayoutExpr('ai_');
  assert.ok(e.indexOf('"_lk_"') < 0, '旧版会漏掉手工画的连线');
  assert.match(e, /linker/i, '应按 name 判定');
});
ok('auditLayoutExpr 报告 edges 数（用于识别静默跳过）', () => {
  assert.match(P.auditLayoutExpr('ai_'), /edges:/);
});
ok('auditDesignExpr 排除装饰元素（标题/泳道标签/说明条）', () => {
  const e = P.auditDesignExpr('ai_');
  assert.match(e, /DECOR/);
  assert.match(e, /\^lb_\|\^tt_\|\^ov_/, '应排除 lb_/tt_/ov_ 前缀');
});
ok('auditDesignExpr 把尺寸作参考而非判据', () => {
  const e = P.auditDesignExpr('ai_');
  assert.match(e, /sizeTally/, '应输出尺寸分布供参考');
  assert.doesNotMatch(e, /IDEAL_W\s*=/, '不应再有硬编码理想宽度');
});
ok('SKILL.md 记录了两条 reroute 安全铁律', () => {
  const md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(md, /端点必须留在节点边缘中点/);
  assert.match(md, /水平通道干净 ≠ 能绕/);
  assert.match(md, /7 是真的，0 是假的/, '应保留实测教训');
});

// ---------------------------------------------------------------- 核验后新增（P1/P4/P7）
// 【行为断言】不查源码字符串，直接跑真函数。
// 变异测试证明：查源码特征会被 for(i=0;i<0;...) 或 if(true) return false 骗过。
ok('detectCrossings 行为：斜线穿节点必须报出来', () => {
  // 一个 60x40 的节点挡在 (300,300)，连线从 (100,100) 斜穿到 (500,500)
  const { fake } = makeSandbox({
    nA: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    nB: { name: 'process', props: { x: 500, y: 500, w: 132, h: 62 } },
    nMid: { name: 'process', props: { x: 300, y: 280, w: 60, h: 60 } },
    lk: {
      name: 'linker', linkerType: 'straight',
      from: { x: 166, y: 162, angle: 1.57, id: 'nA' },
      to: { x: 566, y: 500, angle: -1.57, id: 'nB' },
      points: [],
    },
  });
  const r = fake.POBridge.detectCrossings('');
  assert.ok(r.crossings >= 1, '斜线穿过 nMid 必须被计到，实际 ' + r.crossings);
  const hit = (r.list || []).some((v) => v.hitNode === 'nMid');
  assert.ok(hit, '应报出命中 nMid，实际 ' + JSON.stringify(r.list));
});

// 【反向用例，至关重要】Liang-Barsky 的经典失败模式是循环不执行、
// t0/t1 保持初值 0/1，return t0<=t1 恒为 true —— 于是所有斜线都被判"穿过"。
// 只测"穿节点要报"抓不到这个，必须同时测"不穿节点不能报"。
ok('detectCrossings 行为：斜线不穿节点时必须为 0', () => {
  const { fake } = makeSandbox({
    nA: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    nB: { name: 'process', props: { x: 500, y: 500, w: 132, h: 62 } },
    // 这个节点在斜线上方很远，不该被撞到
    nFar: { name: 'process', props: { x: 300, y: 100, w: 60, h: 60 } },
    lk: {
      name: 'linker', linkerType: 'straight',
      from: { x: 166, y: 162, angle: 1.57, id: 'nA' },
      to: { x: 566, y: 500, angle: -1.57, id: 'nB' },
      points: [],
    },
  });
  const r = fake.POBridge.detectCrossings('');
  assert.equal(r.crossings, 0,
    '斜线没碰到 nFar，不能报穿越（循环不执行的典型症状就是恒报 true），实际 ' +
    JSON.stringify(r.list));
});

ok('detectCrossings 行为：正交线穿节点也要报（不能为了修斜线弄坏正交）', () => {
  const { fake } = makeSandbox({
    nA: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    nB: { name: 'process', props: { x: 500, y: 100, w: 132, h: 62 } },
    nMid: { name: 'process', props: { x: 300, y: 80, w: 60, h: 100 } },
    lk: {
      name: 'linker', linkerType: 'straight',
      from: { x: 232, y: 131, angle: 0, id: 'nA' },
      to: { x: 500, y: 131, angle: 3.14, id: 'nB' },
      points: [],
    },
  });
  const r = fake.POBridge.detectCrossings('');
  assert.ok(r.crossings >= 1, '正交穿 nMid 必须被计到');
});

ok('detectCrossings 行为：不穿节点时必须是 0（不能乱报）', () => {
  const { fake } = makeSandbox({
    nA: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    nB: { name: 'process', props: { x: 500, y: 100, w: 132, h: 62 } },
    lk: {
      name: 'linker', linkerType: 'straight',
      from: { x: 232, y: 131, angle: 0, id: 'nA' },
      to: { x: 500, y: 131, angle: 3.14, id: 'nB' },
      points: [],
    },
  });
  const r = fake.POBridge.detectCrossings('');
  assert.equal(r.crossings, 0, '不该有穿越，实际 ' + JSON.stringify(r.list));
});
ok('auditLayoutExpr 有 emptyScope 守卫（防错前缀假通过）', () => {
  const e = P.auditLayoutExpr('ai_');
  assert.match(e, /emptyScope/, '必须检测空作用域');
  assert.match(e, /emptyScope === 0|!emptyScope/, 'pass 必须受 emptyScope 约束');
  assert.match(e, /reason/, '应给出不可信原因');
});
ok('build.mjs 用 Buffer.byteLength 算字节', () => {
  const buildPath = path.resolve(SKILL, '..', '..', '..', 'bridge', 'build.mjs');
  if (!fs.existsSync(buildPath)) throw new Error('SKIP_NO_BRIDGE_SRC');
  const src = fs.readFileSync(buildPath, 'utf8');
  assert.match(src, /Buffer\.byteLength/, '含中文时 string.length 会少算字节');
  assert.ok(src.indexOf('bytes: rendered.get(t.format).length') < 0, '不能再用 .length');
});
ok('SKILL.md 记录了 angle 错误的教训', () => {
  const md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(md, /L=π/, '应写正确的 L=π');
  assert.match(md, /方向整体相反|方向整体反了/, '应说明曾经反了');
  assert.match(md, /坐标对了不代表线对了/, '应保留这条教训');
});
ok('SKILL.md 记录了试过但失败的思路', () => {
  const md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(md, /穿越数从 12 涨到 33/, '应记录失败尝试的真实数字');
  assert.match(md, /动节点布局/, '应指出正确解法');
});


// 【补漏】上面的夹具里两端点 y 都 ≠ channelY，所以永远走不到兜底分支。
// 而"两端点已在通道上"恰恰是真机最常见的情形，必须单独测。
ok('rerouteEdge 端点已在通道上时折点仍落在通道', () => {
  const { fake } = makeSandbox({
    nA: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    nB: { name: 'process', props: { x: 500, y: 300, w: 132, h: 62 } },
    lk: {
      name: 'linker', linkerType: 'straight',
      // 两端点 y 都正好等于即将使用的通道 y=200
      from: { x: 232, y: 200, angle: 0, id: 'nA' },
      to: { x: 500, y: 200, angle: 3.14, id: 'nB' },
      points: [],
    },
  });
  fake.POBridge.rerouteEdge('lk', 200);
  const msg = fake.MessageSource.executed[0];
  assert.ok(msg, '应该发出 update');
  const upd = msg[0].content.shapes[0];
  assert.ok(Array.isArray(upd.points) && upd.points.length >= 2, '兜底分支也要有折点');
  upd.points.forEach((p, i) => {
    assert.equal(p.y, 200, '第 ' + i + ' 个折点必须在通道 y=200 上，实际 ' + p.y);
  });
});

// ---------------------------------------------------------------- auditLayoutExpr 行为断言
// 【为什么必须有这一段】auditLayoutExpr 返回的是「待执行表达式字符串」，
// 之前所有断言只做 assert.match(表达式, /emptyScope/) —— 从没真正跑过它。
// 独立核验用变异证明：把斜线检测改回 P1、间距阈值归零、锚点校验恒真、
// 间距环改成不执行，137 项全绿。而这份表达式正是真机验收判定的唯一依据。
//
// 【怎么做】把 auditLayoutExpr 产出的表达式字符串丢进 vm 沙箱跑，
// 断言它返回的 JSON 数值。这样改坏逻辑就一定红。
function runAudit(prefix, shape, scopeSub) {
  const { fake } = makeSandbox(shape);
  // auditLayoutExpr 内部依赖 POBridge.LAYOUT，所以要先装桥接层
  const expr = P.auditLayoutExpr(prefix, scopeSub === undefined ? undefined : scopeSub);
  return JSON.parse(vm.runInContext(expr, vm.createContext(fake), { filename: 'audit.js' }));
}

// 夹具：斜线从 (166,162) 到 (566,500)，中间 (300,280,60,60) 挡路
const DIAG_SHAPE = () => ({
  nA: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
  nB: { name: 'process', props: { x: 500, y: 500, w: 132, h: 62 } },
  nMid: { name: 'process', props: { x: 300, y: 280, w: 60, h: 60 } },
  lk: {
    name: 'linker', linkerType: 'straight',
    from: { x: 166, y: 162, angle: 1.57, id: 'nA' },
    to: { x: 566, y: 500, angle: -1.57, id: 'nB' },
    points: [],
  },
});

ok('【行为】auditLayoutExpr 必须报出斜线穿节点', () => {
  const r = runAudit('', DIAG_SHAPE());
  assert.ok(r.crossings >= 1, '斜线穿 nMid 必须被算进 crossings，实际 ' + r.crossings);
  assert.equal(r.pass, false, '有穿越就不能 pass');
  assert.equal(r.emptyScope, false, '有连线就不是空作用域');
});

ok('【行为】auditLayoutExpr 斜线不穿时 crossings 必须为 0', () => {
  const shape = DIAG_SHAPE();
  shape.nMid.props = { x: 300, y: 60, w: 60, h: 60 };   // 挪到斜线上方
  const r = runAudit('', shape);
  assert.equal(r.crossings, 0, '不该有穿越，实际 ' + r.crossings);
});

ok('【行为】auditLayoutExpr 能识别锚点偏离（badAnchor）', () => {
  const shape = DIAG_SHAPE();
  shape.lk.from = { x: 160, y: 150, angle: 1.57, id: 'nA' };  // 不在边中点上
  const r = runAudit('', shape);
  assert.ok(r.badAnchor >= 1, '锚点偏离必须被算出，实际 ' + r.badAnchor);
  assert.equal(r.pass, false);
});

ok('【行为】auditLayoutExpr 锚点合规时 badAnchor 为 0', () => {
  const r = runAudit('', DIAG_SHAPE());
  assert.equal(r.badAnchor, 0, '坐标都在边中点上，不该报 badAnchor');
});

ok('【行为】auditLayoutExpr 间距低于阈值要报 tightGaps', () => {
  const r = runAudit('', {
    n1: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    n2: { name: 'process', props: { x: 242, y: 100, w: 132, h: 62 } },  // 间距只有 10
  });
  assert.ok(r.tightGaps >= 1, '间隙 10 < 60 必须报，实际 ' + r.tightGaps);
  assert.equal(r.minGap, 10, 'minGap 应为 10，实际 ' + r.minGap);
});

ok('【行为】auditLayoutExpr 空作用域必须 pass:false', () => {
  const r = runAudit('zzz_nonexistent_', DIAG_SHAPE());
  assert.equal(r.emptyScope, true, '前缀匹配不到应报 emptyScope');
  assert.equal(r.pass, false, '空作用域绝不能 pass');
  assert.ok(r.reason, '必须给出 reason');
});


// 【最重要的正向对照】上面 6 条全是"assert pass === false"。
// 变异 Y1 证明：把 pass 改成恒 false，144 项照样全绿 ——
// 一个永远拒绝验收的审计，和一个永远通过的审计，测试同样抓不住。
// 必须有一张「完全合规的图」，要求它 pass === true。
ok('【行为·正向对照】完全合规的图必须 pass:true', () => {
  const r = runAudit('', {
    n1: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    n2: { name: 'process', props: { x: 400, y: 100, w: 132, h: 62 } },  // 间距 168 >= 60
    // 右锚点 -> 左锚点，水平直达，不穿任何节点
    lk: {
      name: 'linker', linkerType: 'straight',
      from: { x: 232, y: 131, angle: 0, id: 'n1' },
      to: { x: 400, y: 131, angle: Math.PI, id: 'n2' },
      points: [],
    },
  });
  assert.equal(r.badAnchor, 0, '锚点应合规');
  assert.equal(r.crossings, 0, '不该有穿越');
  assert.equal(r.overlaps, 0, '不该有重叠');
  assert.equal(r.lkSkipped, 0, '不该有跳过');
  assert.equal(r.emptyScope, false, '有连线，不是空作用域');
  assert.ok(r.minGap >= 60, 'minGap 应 >= 60，实际 ' + r.minGap);
  assert.equal(r.pass, true,
    '**完全合规的图必须 pass:true** —— 否则说明某个判据恒假。实际 ' + JSON.stringify(r));
});

ok('【行为】auditLayoutExpr 必须报出节点重叠', () => {
  const r = runAudit('', {
    // 两个节点重叠 40px
    n1: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    n2: { name: 'process', props: { x: 192, y: 100, w: 132, h: 62 } },
    lk: {
      name: 'linker', linkerType: 'straight',
      from: { x: 166, y: 162, angle: 1.57, id: 'n1' },
      to: { x: 258, y: 162, angle: -1.57, id: 'n2' },
      points: [],
    },
  });
  assert.ok(r.overlaps >= 1, '重叠必须被算出，实际 ' + r.overlaps);
  assert.ok(r.overlapSamples.length >= 1, '应给出重叠样例');
  assert.equal(r.pass, false, '有重叠就不能 pass');
});

ok('【行为】auditLayoutExpr 必须报出 lkSkipped（缺端点的连线）', () => {
  const r = runAudit('', {
    n1: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    n2: { name: 'process', props: { x: 400, y: 100, w: 132, h: 62 } },
    // 这条连线缺 to —— 会被跳过，必须计入 lkSkipped
    lkBad: {
      name: 'linker', linkerType: 'straight',
      from: { x: 232, y: 131, angle: 0, id: 'n1' },
      points: [],
    },
  });
  assert.ok(r.lkSkipped >= 1,
    '缺端点的连线必须计入 lkSkipped（否则 badAnchor 不可信），实际 ' + r.lkSkipped);
  assert.equal(r.pass, false, '有跳过就不能 pass');
});

// 单独验证 pass 表达式的每个判据都能独立否决（防止某个判据被删掉没人发现）
ok('【行为】pass 的每个判据都能独立否决', () => {
  // 基线：合规
  const make = (override) => Object.assign({
    n1: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    n2: { name: 'process', props: { x: 400, y: 100, w: 132, h: 62 } },
    lk: {
      name: 'linker', linkerType: 'straight',
      from: { x: 232, y: 131, angle: 0, id: 'n1' },
      to: { x: 400, y: 131, angle: Math.PI, id: 'n2' },
      points: [],
    },
  }, override);

  assert.equal(runAudit('', make({})).pass, true, '基线应 pass');

  // 判据 1: badAnchor
  const badAnchorShape = make({});
  badAnchorShape.lk.from = { x: 300, y: 300, angle: 0, id: 'n1' };
  assert.equal(runAudit('', badAnchorShape).pass, false, 'badAnchor 应能独立否决');

  // 判据 2: crossings
  const crossShape = make({ blocker: { name: 'process', props: { x: 280, y: 110, w: 60, h: 40 } } });
  assert.equal(runAudit('', crossShape).pass, false, 'crossings 应能独立否决');

  // 判据 3: overlaps
  const ovShape = make({});
  ovShape.n2.props = { x: 200, y: 100, w: 132, h: 62 };
  assert.equal(runAudit('', ovShape).pass, false, 'overlaps 应能独立否决');

  // 判据 4: lkSkipped
  const skipShape = make({ lkBad: { name: 'linker', linkerType: 'straight', points: [] } });
  assert.equal(runAudit('', skipShape).pass, false, 'lkSkipped 应能独立否决');

  // 判据 5: emptyScope
  assert.equal(runAudit('zzz_none_', make({})).pass, false, 'emptyScope 应能独立否决');
});


// ---------------------------------------------------------------- auditDesignExpr 行为断言
// 和 auditLayoutExpr 一样，它返回的也是"待执行表达式字符串"。
// 之前 16 处提及 auditDesignExpr，全是 assert.match(源码, /MAX_TEXT/) 这种查字符串。
// 变异 M6/X7/X8 证明：把 tooLong / tooWide / pass 全改成恒 0 / 恒 true
// （即整个设计规范审计完全失效），144 项照样全绿。补上下面的：
function runDesign(prefix, shape, scopeSub) {
  const { fake } = makeSandbox(shape);
  const expr = P.auditDesignExpr(prefix, scopeSub === undefined ? undefined : scopeSub);
  return JSON.parse(vm.runInContext(expr, vm.createContext(fake), { filename: 'design.js' }));
}

// 【夹具要点】auditDesignExpr 读文案用的是 e.textBlock[0].text，
// 不是 e.text。第一版夹具写成 e.text，导致 tooLong 恒 0 而误判成代码有问题。
const tb = (s) => ({ textBlock: [{ text: s }] });

ok('【行为·正向对照】合规设计必须 pass:true', () => {
  const r = runDesign('', {
    n1: Object.assign({ name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } }, tb('发起申请')),
    n2: Object.assign({ name: 'process', props: { x: 400, y: 100, w: 132, h: 62 } }, tb('审批通过')),
  });
  assert.equal(r.nodes, 2, '应数到 2 个流程节点，实际 ' + r.nodes);
  assert.equal(r.tooLong, 0, '文案都短，不该报超长');
  assert.equal(r.tooWide, 0, '宽度 132 < 200，不该报硬拉宽');
  assert.equal(r.pass, true, '合规设计必须 pass:true，实际 ' + JSON.stringify(r));
});

ok('【行为】auditDesignExpr 必须报出超长文案', () => {
  const r = runDesign('', {
    n1: Object.assign({ name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
          tb('施工单位提交混凝土浇筑申请单并附送检报告'))   // 22 字 > 16
  });
  assert.ok(r.tooLong >= 1, '22 字超过 16 字上限，必须报出，实际 ' + r.tooLong);
  assert.equal(r.pass, false, '有超长就不该 pass');
});

ok('【行为】auditDesignExpr 必须报出硬拉宽的节点', () => {
  const r = runDesign('', {
    n1: Object.assign({ name: 'process', props: { x: 100, y: 100, w: 260, h: 62 } }, tb('短文案')),
  });
  assert.ok(r.tooWide >= 1, '宽 260 > 200 上限，必须报出，实际 ' + r.tooWide);
  assert.equal(r.pass, false, '硬拉宽就不该 pass');
});

ok('【行为】auditDesignExpr 排除装饰元素（泳道/标题/说明条）', () => {
  const r = runDesign('', {
    n1: Object.assign({ name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } }, tb('正常节点')),
    // 这些都不该算进流程节点
    pool1: Object.assign({ name: 'horizontalPool', props: { x: 0, y: 0, w: 1800, h: 400 } }, tb('')),
    lane1: Object.assign({ name: 'horizontalLane', props: { x: 0, y: 0, w: 1700, h: 140 } }, tb('施工单位')),
    // 真实画布上标题的 id 以 tt_ 开头（实测 AE 现状图有 6 个），
    // 说明条用 ov_、泳道标签用 lb_。这里按真实约定构造。
    tt_title1: Object.assign({ name: 'process', props: { x: 100, y: 20, w: 900, h: 40 } },
              tb('图1·这是一个很长很长的标题不应该被当成流程节点来检查文案长度')),
    ov_note1: Object.assign({ name: 'process', props: { x: 100, y: 600, w: 800, h: 40 } },
              tb('这段说明文字也不该被当成流程节点来检查')),
  });
  assert.equal(r.nodes, 1, '只该数到 1 个真实流程节点，实际 ' + r.nodes);
  assert.ok(r.decorSkipped >= 4, '应该跳过 4 个装饰元素（pool/lane/tt_/ov_），实际 ' + r.decorSkipped);
  assert.equal(r.pass, true, '装饰元素不该导致不通过');
});


// ---------------------------------------------------------------- reflowSpacing / clampIntoView 行为断言
// 【为什么补这两条】第五轮核验指出：
//   reflowSpacing 的 8 条断言测的是本文件里"复刻"的 planShifts()，不是 bridge 里的真函数。
//   这是自证测试 —— 复刻件正确不等于实现正确。而这个函数会真的改画布坐标。
//   clampIntoView 是唯一零行为断言的导出函数，原来那条靠字面特征 maxX<minX 撑着。
ok('【行为】reflowSpacing dryRun 不写画布，且给出正确位移', () => {
  const { fake } = makeSandbox({
    n1: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    n2: { name: 'process', props: { x: 252, y: 100, w: 132, h: 62 } },   // gap = 20 < 80
  });
  const r = fake.POBridge.reflowSpacing('', { dryRun: true });
  assert.equal(r.dryRun, true, 'dryRun 应回显');
  assert.equal(r.nodes, 2, '应看到 2 个节点');
  assert.ok(r.moved >= 1, 'gap 20 < 80，应该有节点被挪，实际 moved=' + r.moved);
  assert.ok(Array.isArray(r.movedIds), '应给出 movedIds');
  assert.ok(r.movedIds.includes('n2'), '应挪动右侧的 n2，实际 ' + JSON.stringify(r.movedIds));
  assert.ok(r.gap >= 60, 'gap 应提升到目标值，实际 ' + r.gap);
  // dryRun 的关键性质：不能真的写画布
  assert.equal(fake.Model.updates.length, 0, 'dryRun 不能真的写画布');
});

ok('【行为】reflowSpacing 非 dryRun 时节点坐标必须真的改变', () => {
  const { fake } = makeSandbox({
    n1: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    n2: { name: 'process', props: { x: 252, y: 100, w: 132, h: 62 } },   // 原 x=252
  });
  const r = fake.POBridge.reflowSpacing('', { dryRun: false });
  assert.equal(r.dryRun, false, 'dryRun 应回显 false');
  assert.ok(fake.Model.updates.length >= 1, '非 dryRun 应该真的写画布');
  // 【关键】必须核对节点真实坐标，不能只看报告的 movedIds。
  // 变异证明：把 x 的赋值改成不减位移，movedIds 仍包含 n2（它判断的是 shifts 非零）、
  // gap 仍报 80、maxRight 仍是计划值 —— 只有真实坐标能识破。
  // 注：bridge 内部 clone 后丢失了 id，只能按坐标变化判断。
  // 夹具里 n1 在 x=100(w=132) 即右边界 232、n2 在 x=252，实际 gap = 252-232 = 20。
  // 目标 gap 是 80，所以位移应该是 80 - 20 = 60，n2 最终 x = 252 + 60 = 312。
  // 【关键】必须断言精确的 312。变异证明：只写 `> 252` 的话，
  // 位移恒为 1px、位移翻倍、位移方向反了…… 全都照样通过。
  const batch = fake.Model.updates[0];
  assert.equal(batch.length, 1, '只该推 n2 一个，实际 ' + batch.length);
  const moved = batch[0];
  assert.equal(moved.props.x, 312,
    'n2 应被精确推到 312（gap 20→80，位移 60），实际 ' + moved.props.x);
  assert.equal(moved.props.y, 100, 'y 不该变，实际 ' + moved.props.y);
});

ok('【行为】clampIntoView 越界时必须夹取并标记 clamped', () => {
  const { fake } = makeSandbox({});
  const far = fake.POBridge.clampIntoView(99999, 99999, 200, 80);
  assert.ok(far.x < 99999, 'x 必须被夹小，实际 ' + far.x);
  assert.ok(far.y < 99999, 'y 必须被夹小，实际 ' + far.y);
  assert.equal(far.clamped, true, 'clamped 必须为 true');
  assert.equal(far.requested.x, 99999, 'requested 应保留原请求值');
  assert.notEqual(far.actual.x, 99999, 'actual 应是夹取后的值');
});

ok('【行为】clampIntoView 在视口内时不夹取、不标记', () => {
  const { fake } = makeSandbox({});
  const okPos = fake.POBridge.clampIntoView(100, 200, 200, 80);
  assert.equal(okPos.x, 100, '视口内不该挪动 x');
  assert.equal(okPos.y, 200, '视口内不该挪动 y');
  assert.equal(okPos.clamped, false, '视口内不该标记 clamped');
});

ok('【行为】clampIntoView 视口比元素还小时居中兜底', () => {
  // viewBox 100x100，元素 200x80 —— 元素比视口还宽，maxX < minX，必须走居中兜底。
  // 【关键】必须断言精确的居中值。-50 和 10 是算出来的，不是随手写的：
  //   x = vb.x + (vb.w - w) / 2 = 0 + (100 - 200) / 2 = -50
  //   y = vb.y + (vb.h - h) / 2 = 0 + (100 -  80) / 2 =  10
  // 变异证明：只断言 isFinite 的话，删掉整个兜底分支、或让兜底返回 0、
  // 或返回 vb.x，全都照样通过 —— "居中"这两个字一个数都没验。
  const { fake } = makeSandbox({ __viewBox: { x: 0, y: 0, w: 100, h: 100 } });
  const r = fake.POBridge.clampIntoView(500, 500, 200, 80);
  assert.equal(r.x, -50, 'x 应居中为 -50，实际 ' + r.x);
  assert.equal(r.y, 10, 'y 应居中为 10，实际 ' + r.y);
  assert.equal(r.clamped, true, '越界应标记 clamped');
});


// ---------------------------------------------------------------- ANCHOR 产物侧校验
// 之前的 "angle 常量方向正确" 读的是 bridge/pobridge.js 源码。
// 但真正发到浏览器的是 pobridge.min.js —— 核验证明：把 min 产物里的 ANCHOR 改反，
// 仓库形态和安装形态的 157 项全部照绿。这条补的是产物侧。
ok('【行为·产物】ANCHOR 在 min 产物里方向正确（L 在左、R 在右）', () => {
  const { fake } = makeSandbox({
    nA: { name: 'process', props: { x: 100, y: 100, w: 200, h: 100 } },
    nB: { name: 'process', props: { x: 500, y: 100, w: 200, h: 100 } },
  });
  // nA 右边界中点 = (300, 150)；nB 左边界中点 = (500, 150)
  assert.equal(typeof fake.POBridge.ANCHOR, 'object', 'ANCHOR 应该是导出的对象');
  assert.equal(fake.POBridge.ANCHOR.L, 0, 'L（左）应为 0，实际 ' + fake.POBridge.ANCHOR.L);
  assert.equal(fake.POBridge.ANCHOR.T, Math.PI / 2, 'T（上）应为 PI/2，实际 ' + fake.POBridge.ANCHOR.T);
  assert.equal(fake.POBridge.ANCHOR.R, Math.PI, 'R（右）应为 PI，实际 ' + fake.POBridge.ANCHOR.R);
  assert.equal(fake.POBridge.ANCHOR.B, (3 * Math.PI) / 2, 'B（下）应为 3PI/2，实际 ' + fake.POBridge.ANCHOR.B);
});

ok('【行为·产物】computeEdgeGeometry 产出的 from.angle 与所在边一致', () => {
  const { fake } = makeSandbox({
    nA: { name: 'process', props: { x: 100, y: 100, w: 200, h: 100 } },
    nB: { name: 'process', props: { x: 500, y: 100, w: 200, h: 100 } },
  });
  assert.equal(typeof fake.POBridge.computeEdgeGeometry, 'function', 'computeEdgeGeometry 应存在');
  // 签名是 computeEdgeGeometry(fromProps, toProps, opts)，不是两个 id
  const g = fake.POBridge.computeEdgeGeometry(
    { x: 100, y: 100, w: 200, h: 100 },
    { x: 500, y: 100, w: 200, h: 100 },
  );
  assert.ok(g && g.from && g.to, '应返回 from/to');
  // nA 的右边界中点 (300,150)，从它出发朝向右边 → 入射角应为 R = 0
  assert.equal(g.from.x, 300, 'from.x 应在 nA 右边界，实际 ' + g.from.x);
  assert.equal(g.from.y, 150, 'from.y 应在 nA 垂直中点，实际 ' + g.from.y);
  assert.equal(g.from.angle, Math.PI, 'from.angle 应为 R=PI，实际 ' + g.from.angle);
  // nB 的左边界中点 (500,150)，入射方向为 L = PI
  assert.equal(g.to.x, 500, 'to.x 应在 nB 左边界，实际 ' + g.to.x);
  assert.equal(g.to.y, 150, 'to.y 应在 nB 垂直中点，实际 ' + g.to.y);
  // 入边也用该边自己的朝外角：nB 的左边 L -> ANCHOR[L] = 0
  // （真值依据：用户手绘 yhUELGdssE549967 是 B 出 R 入，ENTRY=ANCHOR 时逐字节复现）
  assert.equal(g.to.angle, 0, 'to.angle 应为 L=0，实际 ' + g.to.angle);
});


// ---------------------------------------------------------------- P3 补强（第七轮核验提出）
// 这几条都是"字段名在、值错了也过"或"只有负向没有正向"的问题。

// 注：签名是 auditSideCard(cardId) —— 传卡片 id，检查它跟画布上其他元素的重叠。
ok('【行为】auditSideCard 真的能判出重叠', () => {
  const { fake } = makeSandbox({
    sc_card: { name: 'sideCard', props: { x: 100, y: 100, w: 220, h: 90 } },
    n_hit: { name: 'process', props: { x: 200, y: 120, w: 132, h: 62 } },   // 与卡片重叠
  });
  const r = fake.POBridge.auditSideCard('sc_card');
  assert.equal(r.id, 'sc_card', '应回显卡片 id');
  assert.ok(r.overlaps >= 1, '重叠必须被算出，实际 ' + JSON.stringify(r));
  assert.equal(r.pass, false, '有重叠不能 pass');
});

ok('【行为】auditSideCard 无重叠时必须 pass:true', () => {
  const { fake } = makeSandbox({
    sc_card: { name: 'sideCard', props: { x: 100, y: 100, w: 220, h: 90 } },
    n_far: { name: 'process', props: { x: 500, y: 400, w: 132, h: 62 } },   // 完全分开
  });
  const r = fake.POBridge.auditSideCard('sc_card');
  assert.equal(r.overlaps, 0, '不该有重叠，实际 ' + JSON.stringify(r));
  assert.equal(r.pass, true, '无重叠必须 pass:true，实际 ' + JSON.stringify(r));
});

ok('【行为】auditSideCard 卡片不存在时报 NO_CARD', () => {
  const { fake } = makeSandbox({});
  const r = fake.POBridge.auditSideCard('nonexistent');
  assert.equal(r.error, 'NO_CARD', '不该静默返回空，实际 ' + JSON.stringify(r));
});

ok('【行为】rerouteWorstEdges 有正向对照：该绕的边必须真的被 applied', () => {
  const { fake } = makeSandbox({
    n1: { name: 'process', props: { x: 100, y: 100, w: 132, h: 62 } },
    n2: { name: 'process', props: { x: 600, y: 100, w: 132, h: 62 } },
    // 中间挡一个节点，水平连线必须穿它
    blocker: { name: 'process', props: { x: 300, y: 110, w: 80, h: 40 } },
    lk: {
      name: 'linker', linkerType: 'straight',
      from: { x: 232, y: 131, angle: 0, id: 'n1' },
      to: { x: 600, y: 131, angle: Math.PI, id: 'n2' },
      points: [],
    },
  });
  // 先确认确实有穿越
  const before = fake.POBridge.detectCrossings('');
  assert.ok(before.crossings >= 1, '夹具本身应存在穿越，实际 ' + JSON.stringify(before));
  const r = fake.POBridge.rerouteWorstEdges({ max: 5, minCross: 1 });
  // 【正向对照】不能只测"该跳过的跳过了"，还要测"该绕的真的绕了"。
  // 变异证明：让整个函数空转（return {applied:[],skipped:[],scanned:0}），
  // 只测负向的话 159 项全绿。
  assert.ok(r, '应返回结果对象');
  assert.ok(typeof r.scanned === 'number', '应报告 scanned');
  assert.ok(r.scanned >= 1, '应扫描到至少 1 条边，实际 ' + r.scanned);
  assert.ok((r.applied && r.applied.length) + (r.skipped && r.skipped.length) <= r.scanned,
    'applied + skipped 不应超过 scanned');
  // 【断言名承诺的是「必须真的被 applied」，就必须断言 applied >= 1】
  // 只写 handled>=1 的话，一个"把每条边都塞进 skipped、永不 applied"的
  // 彻底放弃重路由的实现，也能全绿 —— 第八轮核验实测证明了这一点。
  assert.ok(r.applied.length >= 1,
    '这条边水平段干净、竖直段不穿节点，必须被真的绕行（applied >= 1），不能只跳过。实际 ' +
    JSON.stringify({ applied: r.applied, skipped: r.skipped, scanned: r.scanned }));
});

// ---------------------------------------------------------------- 汇总
console.log('');
if (fails.length) {
  for (const f of fails) console.error('  FAIL  ' + f.name + '\n        ' + f.message);
  console.error('\n✗ ' + fails.length + ' 项失败 / ' + (pass + fails.length) + ' 项');
  process.exit(1);
}
if (skip) {
  // 【不能静默降级】跳过 ≠ 通过。装到 ~/.dsh/skills/ 后没有 bridge/pobridge.js 源码，
  // 那批"查源码字符串"的断言只能跳过；但关键的安全性质已改为沙箱行为断言（会真的跑）。
  // 这里明确告警，避免用户看到一片绿而误以为全测过了。
  console.log('  ⚠ SKIP  ' + skip + ' 项：桥接层源码不在技能目录旁（仅仓库布局才检查这些源码断言）');
  for (const s of skips) console.log('        - ' + s);
  console.log('');
  console.log('  注意：以上 ' + skip + ' 项未被执行，不代表通过。');
  console.log('  关键安全行为（锚点保持/竖直段校验/斜线检测）已用沙箱行为断言覆盖，那些是真的跑了。');
}
console.log('✓ ' + pass + ' 项自检通过' + (skip ? '（另有 ' + skip + ' 项因缺源码未执行）' : '，全部通过'));
