/**
 * 离线自检 —— 不需要浏览器、不碰文档。验证"生成出来的 JS 是否合法"以及参数边界。
 * 运行：node test/selftest.mjs
 */

import assert from 'node:assert/strict';
import * as P from '../lib/page.mjs';
import { parseArgs, num, flag } from '../lib/args.mjs';

let n = 0;
const ok = (name, fn) => {
  try { fn(); n++; console.log(`  PASS  ${name}`); }
  catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
};

/** 只做语法检查：能构造出 Function 就说明这段 JS 没有语法错误。 */
const syntaxOk = (src) => { new Function(src); return true; };

console.log('\n[1] 页面 JS 片段可编译');
ok('READY', () => syntaxOk(P.READY));
ok('READ_GRAPH', () => syntaxOk(P.READ_GRAPH));
ok('COUNT', () => syntaxOk(P.COUNT));
ok('FIT_CANVAS', () => syntaxOk(P.FIT_CANVAS));
ok('VIEWBOX', () => syntaxOk(P.VIEWBOX));
ok('POOL_BOTTOM', () => syntaxOk(P.POOL_BOTTOM));

console.log('\n[2] 参数化片段对恶意/特殊字符免疫');
const nasty = [
  '带"双引号"的文案',
  "带'单引号'的文案",
  '反斜杠 \\ 和换行\n第二行',
  '$(rm -rf /) `${x}`',
  '</script><script>alert(1)</script>',
  'emoji 🚀 与全角（）',
];
for (const text of nasty) {
  ok(`text=${JSON.stringify(text).slice(0, 28)}`, () => {
    const expr = P.createNodeExpr({ id: 'ai_node_1_1', text, x: 1, y: 2, w: 3, h: 4, name: 'process', fill: '', line: '', font: '' });
    syntaxOk(expr);
    // 反解出来的参数必须与原文一致（证明 JSON 转义无损）
    const m = /\}\)\((\{.*\})\)$/s.exec(expr);
    assert.ok(m, '参数块没有出现在表达式末尾');
    const parsed = JSON.parse(m[1]);
    assert.equal(parsed.text, text);
  });
}

console.log('\n[3] id 与边界条件');
ok('removeNodesExpr 空数组带守卫', () => {
  const js = P.removeNodesExpr([]);
  assert.match(js, /EMPTY_IDS/);
  syntaxOk(js);
});
ok('update 空 patch 也能构造', () => syntaxOk(P.updateNodeExpr('ai_node_x', {})));
ok('existsExpr 引号安全', () => {
  const js = P.existsExpr('a"b\\c');
  syntaxOk(js);
  assert.ok(js.includes('a\\"b\\\\c'));
});
ok('embed 的 id 不产生模板注入', () => {
  syntaxOk(P.createNodeExpr({ id: '${alert(1)}', text: 'x', x: 0, y: 0, w: 10, h: 10 }));
});

console.log('\n[4] 参数解析');
ok('--key value', () => {
  const a = parseArgs(['add', '--text', '报告归档', '--x', '100']);
  assert.deepEqual(a._, ['add']);
  assert.equal(a.text, '报告归档');
  assert.equal(a.x, '100');
});
ok('--key=value', () => {
  const a = parseArgs(['--text=a b', '--y=20']);
  assert.equal(a.text, 'a b');
  assert.equal(a.y, '20');
});
ok('--flag 无值', () => {
  const a = parseArgs(['--verify', '--headed']);
  assert.equal(a.verify, true);
  assert.equal(a.headed, true);
});
ok('--flag 后跟另一个 flag 不吞参数', () => {
  const a = parseArgs(['--verify', '--expect-nodes', '53']);
  assert.equal(a.verify, true);
  assert.equal(a['expect-nodes'], '53');
});
ok('负数与浮点', () => {
  const a = parseArgs(['--x', '-12.5']);
  assert.equal(a.x, '-12.5');
  assert.equal(num(a.x), -12.5);
});
ok('num 拒绝 true/垃圾', () => {
  assert.equal(num(true), undefined);
  assert.equal(num('abc'), undefined);
  assert.equal(num(''), undefined);
  assert.equal(num('0'), 0);
});
ok('flag 识别 false 写法', () => {
  assert.equal(flag(undefined), false);
  assert.equal(flag(true), true);
  assert.equal(flag('false'), false);
  assert.equal(flag('0'), false);
  assert.equal(flag('yes'), true);
});
ok('-- 之后全部当位置参数', () => {
  const a = parseArgs(['--x', '1', '--', '--text', 'literal']);
  assert.equal(a.x, '1');
  assert.deepEqual(a._, ['--text', 'literal']);
});

console.log(`\n${process.exitCode ? '有失败项' : '全部通过'}（${n} 项）\n`);
