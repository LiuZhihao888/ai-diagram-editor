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
  for (const k of ['readGraph', 'createNode', 'updateNode', 'removeNodes', 'createEdge', 'getViewBox', 'clampIntoView', 'focusRect']) {
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
  assert.match(dec, /a=60/, '书签里的 clamp margin 不是 60，说明用的是旧桥接层');
  assert.match(dec, /e\.w-[a-z]\)\/2/, '书签缺视口退化兜底');
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

// ---------------------------------------------------------------- 汇总
console.log('');
if (fails.length) {
  for (const f of fails) console.error('  FAIL  ' + f.name + '\n        ' + f.message);
  console.error('\n✗ ' + fails.length + ' 项失败 / ' + (pass + fails.length) + ' 项');
  process.exit(1);
}
console.log('✓ ' + pass + ' 项自检全部通过');
