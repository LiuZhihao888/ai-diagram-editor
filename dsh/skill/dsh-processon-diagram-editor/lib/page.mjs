/**
 * DSH 侧的页面 JS 片段（传输无关）。
 *
 * 这些字符串交给会话内的 browser_evaluate 执行。集中在这里的好处：
 *   1. 可以离线做语法检查（见 ../test/selftest.mjs）
 *   2. 参数一律 JSON.stringify 转义，文案里带引号/换行/</script> 都安全
 *   3. AI 不用每次现场重编 JS —— SKILL.md 引用这里，行为可复现
 *
 * 硬规矩：**片段内部不允许出现反斜杠**。
 *   JS 模板字符串会把 \d 这类无效转义悄悄吃成 d，正则就从 (\d+) 变成 (d+)，
 *   静默失效、不报错。所以这里一律用 [0-9]、[/]、[ ] 这类写法。
 *   selftest 里有专门的断言守着这条。
 *
 * 与 WorkBuddy 侧 wb/lib/page.mjs 的区别：那边走 Playwright page.evaluate，
 * 这边走 browser_evaluate。**页面侧逻辑完全一致**（同一份 bridge/pobridge.js）。
 */

/** 把桥接层源码包成一次性执行的表达式，返回注入结果。 */
export function injectExpr(src) {
  return '(function(){' + src + '\n;return {bridge: typeof window.POBridge, keys: window.POBridge ? Object.keys(window.POBridge) : null};})()';
}

/** 页面是否就绪（Model 有图元）。顺便把"登录墙/只读"这类文案带出来。 */
export const READY = [
  '(function(){',
  '  var m = window.Model;',
  '  var n = (m && m.define && m.define.elements) ? Object.keys(m.define.elements).length : -1;',
  "  var txt = ((document.body && document.body.innerText) || '').replace(/[ ][ ]+/g, ' ').slice(0, 400);",
  '  var gate = /扫码登录|请登录|登录后|无权限|没有权限|仅可查看|只读模式/.exec(txt);',
  '  var fid = /file_id=([0-9]+)/.exec(location.href);',
  '  return JSON.stringify({',
  '    ready: n > 0,',
  '    elements: n,',
  '    hasBridge: typeof window.POBridge,',
  '    title: document.title,',
  '    gate: gate ? gate[0] : null,',
  '    fileId: fid ? fid[1] : null,',
  '    bodySample: n > 0 ? null : txt',
  '  });',
  '})()',
].join('\n');

/** 读完整语义图。 */
export const READ_GRAPH = [
  '(function(){',
  "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
  '  var g = POBridge.readGraph();',
  '  return JSON.stringify({page: g.page, nodes: g.nodes, edges: g.edges});',
  '})()',
].join('\n');

/** 图元计数（比 readGraph 轻，用于改动前后对比）。 */
export const COUNT = [
  '(function(){',
  '  var e = window.Model && Model.define && Model.define.elements;',
  "  if (!e) return JSON.stringify({error:'NO_MODEL'});",
  '  var n = 0, l = 0;',
  "  for (var k in e) { var x = e[k]; (x.name === 'linker' || x.from || x.to) ? l++ : n++; }",
  '  return JSON.stringify({nodes: n, edges: l});',
  '})()',
].join('\n');

/** 建节点。返回请求坐标与实际坐标，并标记是否被视口夹过（ProcessOn 会静默夹取）。 */
export function createNodeExpr(o) {
  return [
    '(function(o){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var c = POBridge.createNode({',
    '    id: o.id, text: o.text, x: o.x, y: o.y, w: o.w, h: o.h, name: o.name,',
    '    fill: o.fill, line: o.line, font: o.font',
    '  });',
    '  var el = window.Model.define.elements[c.id];',
    "  if (!el) return JSON.stringify({error:'NOT_CREATED', id: c.id, hint:'渲染器没接受这个图元（坐标或字段被拒）'});",
    '  var p = (el && el.props) || {};',
    '  var clamped = (o.x != null && Math.abs(p.x - o.x) > 1) || (o.y != null && Math.abs(p.y - o.y) > 1);',
    '  return JSON.stringify({',
    '    id: c.id, rendered: c.rendered,',
    '    requested: {x: o.x, y: o.y, w: o.w, h: o.h},',
    '    actual: {x: p.x, y: p.y, w: p.w, h: p.h},',
    '    clamped: clamped',
    '  });',
    '})(' + JSON.stringify(o) + ')',
  ].join('\n');
}

/**
 * 尺寸决策的**纯算法**（页面内外共用同一份源码）。
 *
 *   measureTextFitExpr / fitNodeSizeExpr 生成的页面片段把它整段内联进去；
 *   test/selftest.mjs 用 new Function(FIT_ALGO_SRC) 离线跑**同一份源码**。
 *   一份源码、两个执行环境 —— 不会出现「测试算的和线上算的不一样」。
 *
 * 硬规矩：**只缩不放**。
 *   newW = min(curW, max(minW, needW))
 *   注意是 min(...) 套在**外面**：minW 只在 curW 比它更宽时才起作用，
 *   所以即便 minW=110 而节点只有 100 宽，也绝不会被「撑」到 110。
 *   理由：加宽会压到邻接图元/连线；这条能力只负责收窄。
 */
export const FIT_ALGO_SRC = [
  '  function fitWrapLines(ws, availW) {',
  '    var n = 0;',
  '    for (var i = 0; i < ws.length; i++) {',
  '      var w = ws[i] > 0 ? ws[i] : 0;',
  '      n += Math.max(1, Math.ceil(w / availW));',
  '    }',
  '    return n;',
  '  }',
  '  function fitMeasure(m, o) {',
  '    var pad = (o.padding == null) ? 16 : o.padding;',
  '    var minW = (o.minW == null) ? 110 : o.minW;',
  '    var minH = (o.minH == null) ? 0 : o.minH;',
  '    var lineH = (o.fontSize || 13) * (o.lineRate || 1.25);',
  '    var availW = (m.availW > 0) ? m.availW : Math.max(1, m.curW - 20);',
  '    var wrapLines = fitWrapLines(m.lines, availW);',
  '    var needW = Math.ceil(m.maxLineW) + pad * 2;',
  '    var needH = Math.ceil(wrapLines * lineH) + 24;',
  '    var newW = Math.round(Math.min(m.curW, Math.max(minW, needW)));',
  '    var newH = Math.round(Math.min(m.curH, Math.max(minH, needH)));',
  '    return {',
  '      needW: needW, needH: needH, newW: newW, newH: newH,',
  '      wrapLines: wrapLines, availW: availW, lineH: lineH,',
  '      dw: Math.round(newW - m.curW), dh: Math.round(newH - m.curH),',
  '      widthSaved: Math.max(0, Math.round(m.curW - newW)),',
  '      changed: newW !== Math.round(m.curW) || newH !== Math.round(m.curH)',
  '    };',
  '  }',
].join('\n');

/** 量文字用的字体：与实测 DOM 一致（13px / 微软雅黑 / 行高 125%）。 */
export const SIZE_FONT = "13px 'Microsoft YaHei', 微软雅黑, Arial";

/** 定宽的默认参数。padding=16 意味着 W = 文字宽 + 32；minW=110 是经验下限。 */
const SIZE_OPTS = {
  font: SIZE_FONT,
  fontSize: 13,      // 与 createPool 的默认 fontSize 一致
  lineRate: 1.25,    // 真实 DOM 的 line-height:125%
  padding: 16,       // 左右各 16 -> needW = ceil(maxLineW) + 32
  minW: 110,         // 再窄文字就贴边了
  minH: 0,           // 高度默认不设下限（只缩不放，不会撑大）
  textInset: 20,     // 渲染器 textBlock 是 w-20 / x:10，可用文字宽 = w - 20
  prefix: 'ai_',     // ids 省略时按这个前缀扫全页
  includeStructural: false, // 默认跳过 pool / lane / linker（结构件不参与定宽）
};

function sizeOpts(opts) {
  const o = Object.assign({}, SIZE_OPTS, opts || {});
  // 只收数字，防止调用方传字符串把算法带偏
  for (const k of ['fontSize', 'lineRate', 'padding', 'minW', 'minH', 'textInset']) {
    if (typeof o[k] !== 'number' || !isFinite(o[k])) o[k] = SIZE_OPTS[k];
  }
  if (typeof o.font !== 'string' || !o.font) o.font = SIZE_FONT;
  if (typeof o.prefix !== 'string') o.prefix = SIZE_OPTS.prefix;
  return o;
}

/** 页面侧共用主干：扫描 -> canvas 量文字 -> fitMeasure -> 可选写回。 */
function sizeExpr(ids, opts, write) {
  const o = sizeOpts(opts);
  const idsJson = JSON.stringify(ids === undefined ? null : ids);
  return [
    '(function(ids, o, write){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var E = window.Model && window.Model.define && window.Model.define.elements;',
    "  if (!E) return JSON.stringify({error:'NO_MODEL'});",
    '  var NL = String.fromCharCode(10);',
    '  var list;',
    '  if (Array.isArray(ids)) list = ids.slice();',
    '  else if (ids && ids.id) list = [ids.id];',
    '  else { list = []; for (var q in E) { if (!o.prefix || q.indexOf(o.prefix) === 0) list.push(q); } }',
    "  if (!list.length) return JSON.stringify({error:'EMPTY_IDS'});",
    '  var cv = document.createElement("canvas");',
    '  var ctx = cv.getContext("2d");',
    "  if (!ctx) return JSON.stringify({error:'NO_CANVAS'});",
    '  ctx.font = o.font;',
    FIT_ALGO_SRC,
    '  var items = [], msgs = [], skipped = 0, changed = 0, unchanged = 0;',
    '  var savedPx = 0, savedH = 0, totalCurW = 0, totalNeedW = 0;',
    '  for (var i = 0; i < list.length; i++) {',
    '    var id = list[i], el = E[id];',
    '    if (!el || !el.props) { skipped++; continue; }',
    '    if (!o.includeStructural && /pool|lane|linker/i.test(el.name || "")) { skipped++; continue; }',
    '    var p = el.props, curW = Math.round(p.w), curH = Math.round(p.h);',
    '    if (!(curW > 0) || !(curH > 0)) { skipped++; continue; }',
    '    var tb = el.textBlock || [], raw = [];',
    '    for (var j = 0; j < tb.length; j++) raw.push(String((tb[j] && tb[j].text) || ""));',
    '    var text = raw.join(NL);',
    '    var lines = text.length ? text.split(NL) : [""];',
    '    var ws = [], maxLineW = 0;',
    '    for (var k = 0; k < lines.length; k++) {',
    '      var lw = ctx.measureText(lines[k]).width;',
    '      ws.push(Math.round(lw * 100) / 100);',
    '      if (lw > maxLineW) maxLineW = lw;',
    '    }',
    '    var plan = fitMeasure({ curW: curW, curH: curH, maxLineW: maxLineW, lines: ws,',
    '      availW: Math.max(1, curW - o.textInset) }, o);',
    '    totalCurW += curW;',
    '    totalNeedW += plan.needW;',
    '    var rec = { id: id, text: text.slice(0, 24),',
    '      curW: curW, curH: curH, needW: plan.needW, needH: plan.needH,',
    '      newW: plan.newW, newH: plan.newH,',
    '      maxLineW: Math.round(maxLineW), lines: ws.length, wrapLines: plan.wrapLines,',
    '      savedW: plan.widthSaved, savedH: plan.dh < 0 ? -plan.dh : 0 };',
    '    if (plan.changed) {',
    '      changed++;',
    '      savedPx += plan.widthSaved;',
    '      savedH += rec.savedH;',
    '      if (write) {',
    '        var copy = JSON.parse(JSON.stringify(el));',
    '        copy.props.w = plan.newW;',
    '        copy.props.h = plan.newH;',
    '        msgs.push({action:"update", content:{shapes:[copy], updates:[copy]}});',
    '      }',
    '    } else { unchanged++; }',
    '    items.push(rec);',
    '  }',
    '  var writeError = null;',
    '  if (write && msgs.length) {',
    '    try { window.MessageSource.executeMessages(msgs, true); }',
    '    catch (e) { writeError = String((e && e.message) || e); }',
    '  }',
    '  if (write && !writeError) {',
    '    for (var t = 0; t < items.length; t++) {',
    '      var cur = E[items[t].id];',
    '      if (!cur || !cur.props) continue;',
    '      items[t].actualW = Math.round(cur.props.w);',
    '      items[t].actualH = Math.round(cur.props.h);',
    '      items[t].applied = items[t].actualW === items[t].newW && items[t].actualH === items[t].newH;',
    '    }',
    '  }',
    '  return JSON.stringify({',
    '    mode: write ? "fit" : "measure",',
    '    checked: items.length, changed: changed, unchanged: unchanged, skipped: skipped,',
    '    savedPx: savedPx, savedH: savedH,',
    '    totalCurW: totalCurW, totalNeedW: totalNeedW,',
    '    ratio: totalCurW > 0 ? Math.round(savedPx / totalCurW * 1000) / 1000 : 0,',
    '    executed: msgs.length, writeError: writeError,',
    '    opts: {font: o.font, padding: o.padding, minW: o.minW, minH: o.minH, textInset: o.textInset},',
    '    items: items',
    '  });',
    '})(' + idsJson + ', ' + JSON.stringify(o) + ', ' + (write ? 'true' : 'false') + ')',
  ].join('\n');
}

/**
 * ① 只读：按 canvas measureText 精确量出每个节点「文字需要多宽」。
 *
 * 返回 {mode:'measure', checked, changed, unchanged, skipped, savedPx, savedH,
 *       totalCurW, totalNeedW, ratio, items:[{id,text,curW,curH,needW,needH,
 *       newW,newH,maxLineW,lines,wrapLines,savedW,savedH}]}
 *
 * 用法：
 *   measureTextFitExpr(['ai_node_1','ai_node_2'])   // 指定节点
 *   measureTextFitExpr()                             // 扫全页 ai_ 前缀
 *   measureTextFitExpr(null, {prefix:'ai_', minW:110})
 *
 * ⚠️ 这里是**测量定宽**，不是判断溢出：判断溢出要读渲染后真实 DOM 的
 * scrollHeight vs clientHeight（见 SKILL.md）。两者目的不同，别混。
 */
export function measureTextFitExpr(ids, opts) {
  return sizeExpr(ids, opts, false);
}

/**
 * ② 写：批量收紧到文字宽度（只缩不放）。
 *
 * 走 MessageSource.executeMessages([{action:"update", content:{shapes:[c],
 * updates:[c]}}], true) —— 只改 Model 画布不会重绘，这是本技能的老结论。
 *
 * 返回 {mode:'fit', changed, skipped, unchanged, savedPx, executed, items:[...]}
 * changed=0 表示「都在合理宽度内」，不是失败。
 */
export function fitNodeSizeExpr(ids, opts) {
  return sizeExpr(ids, opts, true);
}

/** 连线。 */
export function createEdgeExpr(o) {
  return [
    '(function(o){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var e = POBridge.createEdge({id: o.id, from: o.from, to: o.to, text: o.text,',
    '    fromSide: o.fromSide, toSide: o.toSide});',
    '  return JSON.stringify({id: e.id, exists: !!window.Model.define.elements[e.id],',
    '    fromSide: e.fromSide, toSide: e.toSide, points: e.points});',
    '})(' + JSON.stringify(o) + ')',
  ].join('\n');
}

/** 改节点。 */
export function updateNodeExpr(id, patch) {
  return [
    '(function(id, patch){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!window.Model.define.elements[id]) return JSON.stringify({error:'NOT_FOUND', id: id});",
    '  var r = POBridge.updateNode(id, patch);',
    '  var el = window.Model.define.elements[id];',
    '  var p = (el && el.props) || {};',
    "  var t = (el && el.textBlock && el.textBlock[0] && el.textBlock[0].text) || '';",
    '  return JSON.stringify({id: r.id, updated: r.updated, actual: {x: p.x, y: p.y, w: p.w, h: p.h}, text: t});',
    '})(' + JSON.stringify(id) + ', ' + JSON.stringify(patch) + ')',
  ].join('\n');
}

/** 删除节点。空数组直接拒绝 —— 某些版本传空数组会清空整张画布。 */
export function removeNodesExpr(ids) {
  return [
    '(function(ids){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!Array.isArray(ids) || !ids.length) return JSON.stringify({error:'EMPTY_IDS'});",
    '  var r = POBridge.removeNodes(ids);',
    '  var left = ids.filter(function(i){ return !!window.Model.define.elements[i]; });',
    '  return JSON.stringify({removed: r.removed, stillThere: left});',
    '})(' + JSON.stringify(ids) + ')',
  ].join('\n');
}

/** 某 id 是否还在。用于 eval 超时后决定能否重试 —— 防重复图元的关键。 */
export function existsExpr(id) {
  return [
    '(function(id){',
    '  var e = window.Model && Model.define && Model.define.elements;',
    '  return !!(e && e[id]);',
    '})(' + JSON.stringify(id) + ')',
  ].join('\n');
}

/**
 * 整页适应。
 * ⚠️ 这是**显式请求**才用的，不要自动调用：
 *   - 会把用户的滚动位置拉走（实测 1730 → 967）
 *   - 会重置用户手动调好的缩放
 *   - 重绘阻塞，实测超时 114ms
 * 想"让用户看见某处"请用 FOCUS_RECT。
 */
export const FIT_CANVAS = [
  '(function(){',
  "  try { Designer.fitTheCanvas(); return 'ok'; } catch(e) { return 'err:' + String(e); }",
  '})()',
].join('\n');

/**
 * 把视口滚到某个矩形。只改 scrollLeft/scrollTop + 同步 viewBox 缓存，
 * 不动缩放、不重绘、不超时 —— 这是"不打扰用户"的跳转方式。
 * 返回 requested/actual/before，调用方能判断是否真滚到位。
 */
export function focusRectExpr(x, y, w, h) {
  return [
    '(function(x, y, w, h){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  try {',
    '    var r = POBridge.focusRect(x, y, w, h);',
    '    return JSON.stringify(r);',
    '  } catch (e) {',
    "    return JSON.stringify({error: String(e && e.message || e)});",
    '  }',
    ')(' + [x, y, w, h].map(v => JSON.stringify(v)).join(', ') + ')',
  ].join('\n');
}

/** 滚到指定图元。 */
export function focusExpr(ids) {
  return [
    '(function(ids){',
    "  try { Designer.scrollShapesToView(ids); return 'ok'; } catch(e) { return 'err:' + String(e); }",
    '})(' + JSON.stringify(ids) + ')',
  ].join('\n');
}

/** 只读：读一个泳道池的行数/每行字段（不写画布，验证机制首选）。 */
export function getPoolRowsExpr(poolId) {
  return [
    '(function(id){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  try {",
    "    var r = POBridge.getPoolRows(id);",
    "    if (!r) return JSON.stringify({error:'POOL_NOT_FOUND', id: id});",
    "    return JSON.stringify(r);",
    "  } catch(e) { return JSON.stringify({error:'GET_FAILED', message:String(e && e.message || e)}); }",
    '})(' + JSON.stringify(poolId) + ')',
  ].join('\n');
}

/** 创建「一个池 + N 行」的泳道池（写操作；id 由调用方生成以便超时探测/回滚）。 */
export function createPoolExpr(o) {
  return [
    '(function(o){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (window.Model.define.elements[o.id]) return JSON.stringify({error:'DUPLICATE_ID', id: o.id});",
    "  try {",
    "    var r = POBridge.createPool(o);",
    "    return JSON.stringify(r);",
    "  } catch(e) { return JSON.stringify({error:'CREATE_FAILED', message:String(e && e.message || e)}); }",
    '})(' + JSON.stringify(o) + ')',
  ].join('\n');
}

/** 把已有泳道池改成 N 行（写操作；rows 长度 1..50）。 */
export function setPoolRowsExpr(poolId, rows, opts) {
  return [
    '(function(id, rows, opts){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!window.Model.define.elements[id]) return JSON.stringify({error:'POOL_NOT_FOUND', id: id});",
    "  try {",
    "    var r = POBridge.setPoolRows(id, rows, opts || {});",
    "    return JSON.stringify(r);",
    "  } catch(e) { return JSON.stringify({error:'SET_FAILED', message:String(e && e.message || e)}); }",
    '})(' + JSON.stringify(poolId) + ', ' + JSON.stringify(rows) + ', ' + JSON.stringify(opts || {}) + ')',
  ].join('\n');
}

/** 删除一个池及其全部 lane（写操作；仅删 ai_ 前缀的测试池，用于清理）。 */
export function removePoolExpr(poolId) {
  return [
    '(function(id){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!/^ai_/.test(id)) return JSON.stringify({error:'REFUSE_NON_AI', id: id});",
    "  var D = window.Model.define.elements, p = D[id];",
    "  if (!p) return JSON.stringify({error:'POOL_NOT_FOUND', id: id});",
    "  var ids = [id].concat((p.children || []).filter(function(c){ return !!D[c]; }));",
    "  var r = POBridge.removeNodes(ids);",
    "  var left = ids.filter(function(i){ return !!D[i]; });",
    "  return JSON.stringify({removed: r.removed, left: left});",
    '})(' + JSON.stringify(poolId) + ')',
  ].join('\n');
}

/** 视口范围，用来解释"坐标为什么被夹"。 */
export const VIEWBOX = [
  '(function(){',
  '  var vb = (window.Utils && Utils.canvasViewBox) || null;',
  '  return JSON.stringify(vb);',
  '})()',
].join('\n');

/** 泳道池边界（"图的下面"到底在哪）。 */
export const POOL_BOTTOM = [
  '(function(){',
  '  var e = window.Model.define.elements, id = null;',
  "  for (var k in e) { if (/horizontalPool/i.test(e[k].name || '')) { id = k; break; } }",
  "  if (!id) return JSON.stringify({error:'NO_POOL'});",
  '  var p = e[id].props;',
  '  return JSON.stringify({id: id, x: p.x, y: p.y, w: p.w, h: p.h, bottom: p.y + p.h});',
  '})()',
].join('\n');

/** 候选标签页标识（多图场景第一步：先认清有哪些图）。 */
export const TAB_IDENT = [
  '(function(){',
  // 只回传非敏感标识：绝不把 location.href / iframe.src 这类带
  // encrypted_session 票据的完整 URL 送进 AI 会话或日志。
  '  var out = {title: document.title, fileId: null, kdocsDoc: null};',
  '  var m = /file_id=([0-9]+)/.exec(location.href);',
  '  if (m) out.fileId = m[1];',
  '  var k = /kdocs[.]cn[/]l[/]([A-Za-z0-9]+)/.exec(location.href);',
  '  if (k) out.kdocsDoc = k[1];',
  "  var f = document.querySelector('#dotviewIframe');",
  '  if (f && f.src) {',
  '    var m2 = /file_id=([0-9]+)/.exec(f.src);',
  '    if (m2) out.fileId = m2[1];',
  '  }',
  '  return JSON.stringify(out);',
  '})()',
].join('\n');

/** 重排单条连线：端点纠正到边中点 + 正确 angle（锚点绑定）。 */
export function rebindEdgeExpr(id) {
  return [
    '(function(id){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!window.Model.define.elements[id]) return JSON.stringify({error:'NOT_FOUND', id: id});",
    '  var r = POBridge.rebindEdge(id);',
    '  return JSON.stringify(r);',
    '})(' + JSON.stringify(id) + ')',
  ].join('\n');
}

/** 批量重排一组连线（一次 updateMulti + 一次 resetBrokenLinker）。 */
export function rebindEdgesExpr(ids) {
  return [
    '(function(ids){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    "  if (!ids || !ids.length) return JSON.stringify({error:'EMPTY_IDS'});",
    '  var r = POBridge.rebindEdges(ids);',
    '  return JSON.stringify(r);',
    '})(' + JSON.stringify(ids) + ')',
  ].join('\n');
}

/** 列出连线 id（可按前缀过滤）。 */
export function listEdgesExpr(prefix) {
  return [
    '(function(prefix){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var ids = POBridge.listEdges(prefix);',
    '  return JSON.stringify({count: ids.length, ids: ids});',
    '})(' + JSON.stringify(prefix || '') + ')',
  ].join('\n');
}

/** 检测连线是否穿过非端点节点（交叉 = 视觉硬伤）。 */
export function detectCrossingsExpr(prefix) {
  return [
    '(function(prefix){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var r = POBridge.detectCrossings(prefix);',
    '  return JSON.stringify(r);',
    '})(' + JSON.stringify(prefix || '') + ')',
  ].join('\n');
}

/** 让渲染器重算折线路径（改完 endpoints/points 后必须调用）。 */
export function resetBrokenLinkersExpr() {
  return [
    '(function(){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var ok = POBridge.resetBrokenLinkers();',
    '  return JSON.stringify({reset: ok});',
    '})()',
  ].join('\n');
}

/** 间距重排：按行把「边到边」间隙撑到 target（默认 80，超宽降级 60）。 */
export function reflowSpacingExpr(prefix, opts) {
  return [
    '(function(prefix, o){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  return JSON.stringify(POBridge.reflowSpacing(prefix, o));',
    '})(' + JSON.stringify(prefix || '') + ', ' + JSON.stringify(opts || {}) + ')',
  ].join('\n');
}

/** 一条龙：间距重排 + 连线重连 + 交叉改道（子代理首选入口）。 */
export function polishLayoutExpr(prefix, opts) {
  return [
    '(function(prefix, o){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  return JSON.stringify(POBridge.polishLayout(prefix, o));',
    '})(' + JSON.stringify(prefix || '') + ', ' + JSON.stringify(opts || {}) + ')',
  ].join('\n');
}

/** 页面体检 —— 验收标准的**唯一实现**。
 *
 *  六项检查，全部通过才算合格（见 SKILL.md「验收清单」）：
 *    1. badAnchor   锚点必须在边中点      期望 0
 *    2. crossings   连线不穿过非端点节点  期望 0
 *    3. tightGaps   没有过紧的横向间隙    期望 0
 *    4. minGap      最小间隙              期望 >= 60
 *    5. overlaps    节点之间不重叠        期望 0
 *    6. lkSkipped   没有因作用域漏算的连线 期望 0（>0 时 badAnchor 不可信）
 *
 *  【为什么必须传 pageIndex】ProcessOn 的 Model.define.elements 只装「当前页」，
 *  但切页是懒加载的：刚点完标签页时，元素会从上一页的残留逐步换成目标页。
 *  这个过渡窗口里做全局 /^ai_/ 统计会**混入上一页的元素**，得出假失败或假通过。
 *  实测踩过：p9 在过渡态报 crossings=6，稳定后实际是 0。
 */
export function auditLayoutExpr(prefix, pageIndex) {
  var scope = (typeof pageIndex === 'number')
    ? JSON.stringify('_p' + pageIndex + '_')
    : 'null';
  return [
    '(function(prefix, scopeSub){',
    "  if (typeof window.POBridge !== 'object') return JSON.stringify({error:'NO_BRIDGE'});",
    '  var FLOOR = (window.POBridge.LAYOUT && window.POBridge.LAYOUT.GAP_FLOOR) || 60;',
    '  var E = window.Model.define.elements, nodes = {}, badAnchor = 0, cross = 0, tight = 0, minGap = 9999;',
    '  var id, i;',
    '  function inScope(x) {',
    '    if (prefix && x.indexOf(prefix) !== 0) return false;',
    '    if (scopeSub && x.indexOf(scopeSub) < 0) return false;',
    '    return true;',
    '  }',
    '  for (id in E) {',
    '    if (!inScope(id)) continue;',
    '    var e = E[id];',
    '    if (!e || !e.props) continue;',
    '    if (/pool|lane|linker/i.test(e.name || "")) continue;',
    '    if (/_hdr_|_note_/.test(id)) continue;',
    '    nodes[id] = e.props;',
    '  }',
    '  function onMid(x, y, p) {',
    '    var eps = 2;',
    '    return (Math.abs(x - p.x) < eps && Math.abs(y - (p.y + p.h / 2)) < eps) ||',
    '           (Math.abs(x - (p.x + p.w)) < eps && Math.abs(y - (p.y + p.h / 2)) < eps) ||',
    '           (Math.abs(y - p.y) < eps && Math.abs(x - (p.x + p.w / 2)) < eps) ||',
    '           (Math.abs(y - (p.y + p.h)) < eps && Math.abs(x - (p.x + p.w / 2)) < eps);',
    '  }',
    '  var boxes = [];',
    '  for (var n in nodes) boxes.push({ id: n, x: nodes[n].x, y: nodes[n].y, w: nodes[n].w, h: nodes[n].h });',
    '  function hitSeg(x1, y1, x2, y2, r) {',
    '    var pad = 2, rx1 = r.x + pad, ry1 = r.y + pad, rx2 = r.x + r.w - pad, ry2 = r.y + r.h - pad;',
    '    if (Math.abs(y1 - y2) < 0.5) {',
    '      if (y1 < ry1 || y1 > ry2) return false;',
    '      var a = Math.min(x1, x2), b = Math.max(x1, x2); return b > rx1 && a < rx2;',
    '    }',
    '    if (Math.abs(x1 - x2) < 0.5) {',
    '      if (x1 < rx1 || x1 > rx2) return false;',
    '      var c = Math.min(y1, y2), d = Math.max(y1, y2); return d > ry1 && c < ry2;',
    '    }',
    '    return false;',
    '  }',
    '  var edgeCount = 0, skipped = 0;',
    '  for (id in E) {',
    '    if (!inScope(id)) continue;',
    '    if (id.indexOf("_lk_") < 0) continue;',
    '    var g = E[id];',
    '    if (!g || !g.from || !g.to) { skipped++; continue; }',
    '    if (!nodes[g.from.id] || !nodes[g.to.id]) { skipped++; continue; }',
    '    edgeCount++;',
    '    if (!onMid(g.from.x, g.from.y, nodes[g.from.id]) || !onMid(g.to.x, g.to.y, nodes[g.to.id])) badAnchor++;',
    '    var pts = [{ x: g.from.x, y: g.from.y }].concat(g.points || []).concat([{ x: g.to.x, y: g.to.y }]);',
    '    for (i = 1; i < pts.length; i++) {',
    '      for (var b2 = 0; b2 < boxes.length; b2++) {',
    '        if (boxes[b2].id === g.from.id || boxes[b2].id === g.to.id) continue;',
    '        if (hitSeg(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, boxes[b2])) cross++;',
    '      }',
    '    }',
    '  }',
    '  // 重叠：两矩形在 x/y 双向都相交超过 1px',
    '  var overlaps = 0, overlapSamples = [];',
    '  var bl = [];',
    '  for (var nb in nodes) bl.push({ id: nb, x: nodes[nb].x, y: nodes[nb].y, w: nodes[nb].w, h: nodes[nb].h });',
    '  for (var p1 = 0; p1 < bl.length; p1++) {',
    '    for (var p2 = p1 + 1; p2 < bl.length; p2++) {',
    '      var A = bl[p1], B = bl[p2];',
    '      var ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);',
    '      var oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);',
    '      if (ox > 1 && oy > 1) {',
    '        overlaps++;',
    '        if (overlapSamples.length < 5) overlapSamples.push({ a: A.id, b: B.id, w: Math.round(ox), h: Math.round(oy) });',
    '      }',
    '    }',
    '  }',
    '  var rows = {};',
    '  for (var n2 in nodes) { var k = Math.round(nodes[n2].y); (rows[k] = rows[k] || []).push({ x: nodes[n2].x, w: nodes[n2].w }); }',
    '  for (var k2 in rows) {',
    '    var arr = rows[k2].sort(function (a, b) { return a.x - b.x; });',
    '    for (var i2 = 1; i2 < arr.length; i2++) {',
    '      var gp = arr[i2].x - (arr[i2 - 1].x + arr[i2 - 1].w);',
    '      if (gp < minGap) minGap = gp;',
    '      if (gp < FLOOR) tight++;',
    '    }',
    '  }',
    '  var pass = (badAnchor === 0 && cross === 0 && tight === 0 && minGap >= FLOOR && overlaps === 0 && skipped === 0);',
    '  return JSON.stringify({ nodes: Object.keys(nodes).length, edges: edgeCount, lkSkipped: skipped,',
    '    badAnchor: badAnchor, crossings: cross, tightGaps: tight, minGap: minGap,',
    '    overlaps: overlaps, overlapSamples: overlapSamples, gapFloor: FLOOR, pass: pass });',
    '})(' + JSON.stringify(prefix || '') + ', ' + scope + ')',
  ].join('\n');
}
