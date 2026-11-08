/**
 * ProcessOn 运行时桥接层 —— 在浏览器控制台/扩展注入环境中执行
 *
 * 已实测通过的能力：
 *   readGraph()            读取完整语义图（节点 + 连线 + 泳道）
 *   createNode(opts)       创建节点（红色标记），立即渲染
 *   updateNode(id, patch)  修改节点属性/样式
 *   removeNodes([ids])     删除节点
 *   createEdge(opts)       创建连线
 *   getPoolRows(poolId)    只读：读池行数 / 每行字段
 *   createPool(opts)       创建「一个池 + N 行」的泳道池
 *   setPoolRows(id,rows)   把已有泳道池改成 N 行
 *
 * 关键机制（都是踩坑换来的）：
 *   1. 必须走 MessageSource.executeMessages(action, init=true)
 *      —— 它内部会调 Schema.initShapeFunctions() + Designer.painter.renderShape()
 *      —— 直接用 Model.addMulti() 只会改数据，画布不重绘
 *   2. 坐标必须落在 Utils.canvasViewBox 内
 *      —— renderShape 第一行就是 isInCanvasView()，不在视口内直接 remove() 并 return
 *      —— viewBox.x === layout.scrollLeft - 1200
 *   3. 颜色格式是 RGB 逗号串，不是 #hex
 *      fillStyle:    { drawType:'fill', fill:'255,0,0', alpha:1 }
 *      lineStyle:    { lineWidth:2, lineColor:'255,0,0', lineStyle:'solid' }
 *      fontStyle:    { fontColor:'255,0,0' }
 *   4. 节点要带 children:[] 和 attribute 完整对象，否则渲染器可能跳过
 */
(function (global) {
  'use strict';

  // ---------- 颜色常量 ----------
  var RED = {
    fill: '255,235,235',
    line: '255,0,0',
    font: '255,0,0'
  };

  function ensureRuntime() {
    var missing = [];
    if (!global.Model) missing.push('Model');
    if (!global.Designer) missing.push('Designer');
    if (!global.Utils) missing.push('Utils');
    if (!global.MessageSource) missing.push('MessageSource');
    if (missing.length) {
      throw new Error('ProcessOn 运行时未就绪，缺少: ' + missing.join(', ') +
        '。请确认当前页面是 wps.processon.com/diagrams/edit');
    }
  }

  // ---------- 读取 ----------
  function readGraph() {
    ensureRuntime();
    var els = global.Model.define.elements || {};
    var nodes = [], edges = [];

    Object.keys(els).forEach(function (id) {
      var e = els[id];
      if (!e) return;
      var isEdge = (e.name === 'linker') || !!e.from || !!e.to;
      var text = '';
      if (e.textBlock) {
        for (var i = 0; i < e.textBlock.length; i++) {
          if (e.textBlock[i] && e.textBlock[i].text) {
            text += (text ? ' ' : '') + e.textBlock[i].text;
          }
        }
      }
      if (isEdge) {
        edges.push({
          id: id,
          from: (e.from && e.from.id) || '',
          to: (e.to && e.to.id) || '',
          text: e.text || text || '',
          points: e.points || []
        });
      } else {
        var p = e.props || {};
        nodes.push({
          id: id,
          name: e.name || '',
          title: e.title || '',
          text: text,
          x: p.x || 0, y: p.y || 0, w: p.w || 0, h: p.h || 0,
          zindex: p.zindex || 0,
          parent: e.parent || '',
          isLane: /Lane|Pool/i.test(e.name || '')
        });
      }
    });

    return {
      page: global.Model.define.page,
      nodes: nodes,
      edges: edges
    };
  }

  // ---------- 视口工具 ----------
  // canvasViewBox 可能是半初始化状态（NaN），必须在源头断言，
  // 否则夹取结果会是 NaN，节点静默消失，排查起来极难。
  function getViewBox() {
    ensureRuntime();
    var vb = global.Utils.canvasViewBox;
    if (!vb || typeof vb.w !== 'number' || typeof vb.h !== 'number' ||
        !isFinite(vb.x) || !isFinite(vb.y) || !isFinite(vb.w) || !isFinite(vb.h)) {
      throw new Error('VIEWBOX_INVALID: canvasViewBox 不可用 —— ' + JSON.stringify(vb));
    }
    return vb;
  }

  // 把视口滚动到能看见 rect 的位置。只改 scrollLeft/scrollTop，不调 fitTheCanvas —— 
  // fitTheCanvas 会重置用户的缩放并阻塞重绘，是真正的"打扰"。
  function focusRect(x, y, w, h) {
    ensureRuntime();
    if (![x, y, w, h].every(function (v) { return typeof v === 'number' && isFinite(v); })) {
      throw new Error('FOCUS_RECT_INVALID: 需要 4 个有限数，收到 ' + JSON.stringify([x, y, w, h]));
    }
    var layout = document.getElementById('designer_layout');
    if (!layout) throw new Error('FOCUS_NO_LAYOUT: 找不到 #designer_layout');

    var vb = global.Utils.canvasViewBox;
    var before = { scrollLeft: layout.scrollLeft, scrollTop: layout.scrollTop };

    // 让目标矩形居中；ProcessOn 的 viewBox 已含 expand margin，直接用即可
    var targetLeft = x + w / 2 - vb.w / 2;
    var targetTop = y + h / 2 - vb.h / 2;

    layout.scrollLeft = targetLeft;
    layout.scrollTop = targetTop;

    // 同步缓存，避免后续读坐标用旧 viewBox
    try { global.Utils.canvasViewBoxUpdate(); } catch (e) { /* 只读刷新失败不影响滚动 */ }

    var after = { scrollLeft: layout.scrollLeft, scrollTop: layout.scrollTop };
    return {
      requested: { scrollLeft: targetLeft, scrollTop: targetTop },
      actual: after,
      before: before,
      viewBox: global.Utils.canvasViewBox
    };
  }

  // 把任意坐标夹取到当前视口内，保证能被渲染。
  // 返回值带 requested/actual/clamped —— 调用方必须能看见"被夹了"，而不是只拿到结果坐标。
  function clampIntoView(x, y, w, h) {
    var vb = getViewBox();
    var margin = 60;
    var minX = vb.x + margin, maxX = vb.x + vb.w - w - margin;
    var minY = vb.y + margin, maxY = vb.y + vb.h - h - margin;
    var nx = (maxX < minX) ? (vb.x + (vb.w - w) / 2) : Math.max(minX, Math.min(x, maxX));
    var ny = (maxY < minY) ? (vb.y + (vb.h - h) / 2) : Math.max(minY, Math.min(y, maxY));
    var ax = Math.round(nx), ay = Math.round(ny);
    return {
      x: ax,
      y: ay,
      requested: { x: x, y: y },
      actual: { x: ax, y: ay },
      clamped: (Math.abs(ax - x) > 1) || (Math.abs(ay - y) > 1)
    };
  }

  // ---------- 创建节点 ----------
  function buildNode(opts) {
    var o = opts || {};
    var w = o.w || 220;
    var h = o.h || 90;

    var pos = clampIntoView(o.x || 0, o.y || 0, w, h);
    var __reqX = o.x, __reqY = o.y;

    var fill = o.fill || RED.fill;
    var line = o.line || RED.line;
    var font = o.font || RED.font;

    var __node = {
      id: o.id || ('ai_node_' + Date.now() + '_' + Math.floor(Math.random() * 1e6)),
      name: o.name || 'process',
      title: o.title || '流程',
      parent: '',
      container: '',
      link: '',
      children: [],
      shapeStyle: { alpha: 1 },
      fillStyle: fill ? { drawType: 'fill', fill: fill, alpha: 1 } : {},
      lineStyle: { lineWidth: o.lineWidth || 2, lineColor: line, lineStyle: 'solid' },
      fontStyle: font ? { fontColor: font } : {},
      textBlock: [{
        position: { w: 'w-20', x: 10, h: 'h', y: 0 },
        text: o.text || ''
      }],
      anchors: [
        { x: 'w/2', y: '0' }, { x: 'w/2', y: 'h' },
        { x: '0', y: 'h/2' }, { x: 'w', y: 'h/2' }
      ],
      dataAttributes: [],
      props: {
        zindex: o.zindex || 900,
        x: pos.x, y: pos.y,
        w: w, h: h,
        angle: 0
      },
      path: [{
        fillStyle: { type: 'none' },
        actions: [
          { x: '0', action: 'move', y: '0' },
          { x: 'w', action: 'line', y: '0' },
          { x: 'w', action: 'line', y: 'h' },
          { x: '0', action: 'line', y: 'h' },
          { x: '0', action: 'line', y: '0' }
        ]
      }],
      attribute: {
        container: false, rotatable: true, visible: true,
        fixedLink: false, collapsable: false, collapsed: false,
        linkable: true, markerOffset: 5
      },
      resizeDir: '',
      group: '',
      locked: false,
      category: 'default',
      theme: {}
    };
    // 记录"我要放哪"和"实际放哪"，让调用方能判断是否被夹
    if (pos.clamped) {
      __node.__clamped = true;
      __node.__requested = { x: __reqX != null ? __reqX : pos.x, y: __reqY != null ? __reqY : pos.y };
    }
    return __node;
  }

  function createNode(opts) {
    ensureRuntime();
    var node = buildNode(opts);
    global.MessageSource.executeMessages([{ action: 'create', content: [node] }], true);
    return {
      id: node.id,
      rendered: !!document.getElementById(node.id),
      props: node.props,
      // 被静默夹走时调用方必须知道 —— 否则会以为放对了
      clamped: node.__clamped === true,
      requested: node.__requested || null,
      actual: { x: node.props.x, y: node.props.y }
    };
  }

  // ---------- 更新节点 ----------
  function updateNode(id, patch) {
    ensureRuntime();
    var src = global.Model.define.elements[id];
    if (!src) throw new Error('节点不存在: ' + id);
    var next = JSON.parse(JSON.stringify(src));
    var p = patch || {};
    ['x', 'y', 'w', 'h', 'zindex'].forEach(function (k) {
      if (p[k] !== undefined) next.props[k] = p[k];
    });
    if (p.text !== undefined && next.textBlock && next.textBlock[0]) {
      next.textBlock[0].text = p.text;
    }
    if (p.fill !== undefined) {
      next.fillStyle = p.fill ? { drawType: 'fill', fill: p.fill, alpha: 1 } : {};
    }
    if (p.line !== undefined) {
      next.lineStyle = Object.assign({}, next.lineStyle, { lineColor: p.line });
    }
    if (p.font !== undefined) {
      next.fontStyle = Object.assign({}, next.fontStyle, { fontColor: p.font });
    }
    global.MessageSource.executeMessages(
      [{ action: 'update', content: { shapes: [next], updates: [next] } }],
      true
    );
    return { id: id, updated: true };
  }

  // ---------- 删除 ----------
  function removeNodes(ids) {
    ensureRuntime();
    var list = (ids || []).map(function (id) { return global.Model.define.elements[id]; })
                         .filter(Boolean);
    if (!list.length) return { removed: 0 };
    global.MessageSource.executeMessages([{ action: 'remove', content: list }], true);
    return { removed: list.length };
  }

  // ---------- 连线 ----------
  function createEdge(opts) {
    ensureRuntime();
    var o = opts || {};
    var from = global.Model.define.elements[o.from];
    var to = global.Model.define.elements[o.to];
    if (!from || !to) throw new Error('连线端点不存在: ' + o.from + ' -> ' + o.to);

    var fx = from.props.x + from.props.w / 2, fy = from.props.y + from.props.h / 2;
    var tx = to.props.x + to.props.w / 2, ty = to.props.y + to.props.h / 2;

    var edge = {
      id: o.id || ('ai_edge_' + Date.now()),
      name: 'linker',
      text: o.text || '',
      points: [{ x: fx, y: fy }, { x: tx, y: ty }],
      dataAttributes: [],
      props: { zindex: 950, x: 0, y: 0 },
      linkerType: 'broken',
      lineStyle: { lineWidth: o.lineWidth || 2, lineColor: o.line || RED.line },
      from: { x: fx, y: fy, angle: 0, id: o.from },
      to: { x: tx, y: ty, angle: 0, id: o.to },
      textBlock: o.text
        ? [{ position: { w: 'w', x: 0, h: 'h', y: 0 }, text: o.text }]
        : [],
      group: '',
      locked: false
    };
    global.MessageSource.executeMessages([{ action: 'create', content: [edge] }], true);
    return { id: edge.id };
  }

  // ---------- 泳道池 / 行数控制 ----------
  // 【线上示例图只读实测结论（泳道池机制）】
  //   * 一个泳道池 = 1 个 horizontalPool 元素；池内多行 = 多个 horizontalLane 子元素。
  //     行数 = pool.children 数组长度；每个 lane 的 parent = pool.id，
  //     attribute.container = true，category = 'lane'。
  //     示例池 example_pool_0 的 children 有 20 个 lane id（就是 20 行），
  //     池 props.h = 4000 = 20 x 200（每行 lane.props.h）。
  //   * 全元素扫描无 rows / laneCount / lanes / rowCount 之类专门字段 —— 行数只由 children 决定。
  //   * props.height=[56] 不是行数也不是行高：它是左侧表头列宽，height[0] 被 path
  //     ({x:'height[0]',action:'line'}) 与 textBlock.position.w='height[0]' 引用。
  //     铁证：池 props.x=87，lane props.x=143 = 87+56。数组长度恒为 1，与行数无关。
  //   * 表头文字按行分布：每一行 lane 自带 textBlock[0].text（如「角色A（审批）」），
  //     position = {w:'height[0]',x:0,h:'h-20',y:10}；池自身 textBlock 是池标题。
  //   * lane.y 自上而下按各行高堆叠（142,342,542,...，步长 200）。
  // 严禁用多个独立 horizontalPool 拼出多行 —— 那不是泳道池，是多个池。
  function lanePath() {
    return [
      { fillStyle: { type: 'none' }, actions: [
        { x: '0', action: 'move', y: '0' },
        { x: 'w', action: 'line', y: '0' },
        { x: 'w', action: 'line', y: 'h' },
        { x: '0', action: 'line', y: 'h' },
        { action: 'close' }
      ] },
      { actions: [
        { x: 0, action: 'move', y: 0 },
        { x: 'height[0]', action: 'line', y: 0 },
        { x: 'height[0]', action: 'line', y: 'h' },
        { x: 0, action: 'line', y: 'h' },
        { action: 'close' }
      ] }
    ];
  }

  function laneTextBlock(text) {
    return [{ position: { w: 'height[0]', x: 0, h: 'h-20', y: 10 }, text: text || '' }];
  }

  function laneAttribute(extra) {
    var a = {
      container: true, rotatable: false, visible: true,
      fixedLink: false, collapsable: false, collapsed: false,
      linkable: false, markerOffset: 5
    };
    if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
    return a;
  }

  /** 造一个原生 horizontalLane 子元素（不落盘，供 createPool / setPoolRows 复用）。 */
  function buildLane(o) {
    var p = o.props || {};
    return {
      id: o.id,
      name: 'horizontalLane',
      title: '泳道',
      parent: o.parent || '',
      container: '',
      link: '',
      children: [],
      shapeStyle: { alpha: 1 },
      fillStyle: o.fillStyle || {},
      lineStyle: o.lineStyle || {},
      fontStyle: o.fontStyle || {},
      textBlock: laneTextBlock(o.text),
      anchors: [],
      dataAttributes: [],
      props: {
        zindex: p.zindex != null ? p.zindex : -1,
        w: p.w, h: p.h, x: p.x, y: p.y, angle: 0,
        height: p.height || [56]
      },
      path: lanePath(),
      attribute: laneAttribute(o.attributeExtra),
      resizeDir: '',
      group: '',
      locked: false,
      category: o.category || 'lane',
      theme: {}
    };
  }

  function isLaneId(id) {
    var e = global.Model.define.elements[id];
    return !!(e && /horizontalLane/i.test(e.name || ''));
  }

  function normalizeRows(rows, defaultHeight, fnName) {
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error(fnName + ': rows 必须是非空数组（长度 1..50）');
    }
    if (rows.length > 50) throw new Error(fnName + ': 行数上限 50，收到 ' + rows.length);
    var MIN_ROW_H = 20, MAX_ROW_H = 10000;
    return rows.map(function (r, i) {
      var name = typeof r === 'string' ? r : (r && r.name) || '';
      var h = (typeof r === 'object' && r != null) ? r.height : defaultHeight;
      if (h == null) h = 200;
      if (!isFinite(h) || h < MIN_ROW_H || h > MAX_ROW_H) {
        throw new Error(fnName + ': 第 ' + (i + 1) + ' 行行高非法（需 ' +
          MIN_ROW_H + '..' + MAX_ROW_H + '），收到 ' + h);
      }
      return { name: name, height: h };
    });
  }

  /**
   * 只读：列出一个池的行（按 y 升序）。不存在的池返回 null，非池抛错。
   * 返回 {poolId, name, title, x,y,w,h, headerWidth,
   *       childrenLength(原始 children 长度), rowCount(=live lane 数), rows:[...]}。
   * 关键：rowCount === pool.children.length（原生池里 children 全是 lane）。
   */
  function getPoolRows(poolId) {
    ensureRuntime();
    var els = global.Model.define.elements;
    var pool = els[poolId];
    if (!pool) return null;
    if (!/horizontalPool/i.test(pool.name || '')) {
      throw new Error('getPoolRows: 不是泳道池: ' + poolId + ' (name=' + pool.name + ')');
    }
    var children = pool.children || [];
    var rows = children.map(function (id) {
      var e = els[id];
      if (!e) return { id: id, missing: true };
      var p = e.props || {}, t = (e.textBlock || [])[0];
      return {
        id: id, name: e.name || '', text: t ? t.text : '',
        x: p.x, y: p.y, w: p.w, h: p.h,
        height: p.height, parent: e.parent || '',
        isLane: /horizontalLane/i.test(e.name || '')
      };
    }).filter(function (r) { return !r.missing; })
      .sort(function (a, b) { return (a.y || 0) - (b.y || 0); });
    var p = pool.props || {};
    var t = (pool.textBlock || [])[0];
    return {
      poolId: poolId, name: pool.name, title: t ? t.text : '',
      x: p.x, y: p.y, w: p.w, h: p.h, headerWidth: p.height,
      childrenLength: children.length, rowCount: rows.length, rows: rows
    };
  }

  /**
   * 一等公民：创建「一个池 + N 行」的泳道池（1 个 horizontalPool + N 个 horizontalLane，单事务）。
   *   opts.rows        : [{name,height}] 或 ['角色A','角色B']，长度 1..50（必填）
   *   opts.title       : 池标题 -> pool.textBlock[0].text
   *   opts.x,y,w       : 池坐标/宽度（默认 100,100,2000）；不夹取，便于追加到原图下方
   *   opts.rowHeight   : rows 用字符串简写时的默认行高，默认 200
   *   opts.headerWidth : 左侧表头列宽 = props.height[0]，默认 56
   *   opts.id          : 池 id（默认 ai_pool_<时间戳>），lane id = <池id>_lane_<i>
   *   opts.style       : {fill,fillLane,line,font,lineWidth,fontSize,bold}
   *   opts.viewportRenderable : 默认 false（AI 元素，避免离屏被裁剪）；设 true 用原生行为
   *   opts.clamp       : 默认 false；设 true 才调 clampIntoView（会改变 x/y，返回值带 clamped）
   * 返回 {id, laneIds, rowCount, x,y,w,h, totalHeight, headerWidth, rendered, clamped}。
   */
  function createPool(opts) {
    ensureRuntime();
    var o = opts || {};
    var norm = normalizeRows(o.rows, o.rowHeight, 'createPool');
    var headerWidth = (o.headerWidth != null && isFinite(o.headerWidth) && o.headerWidth > 0)
      ? o.headerWidth : 56;
    var st = o.style || {};
    var fill = st.fill != null ? st.fill : RED.fill;
    var fillLane = st.fillLane != null ? st.fillLane : fill;
    var line = st.line != null ? st.line : RED.line;
    var font = st.font != null ? st.font : RED.font;
    var lineWidth = st.lineWidth != null ? st.lineWidth : 2;
    var fontSize = st.fontSize != null ? st.fontSize : 13;
    var bold = st.bold === true;
    var vr = o.viewportRenderable === true ? true : false;
    var w = o.w || 2000;
    var x = o.x != null ? o.x : 100;
    var y = o.y != null ? o.y : 100;
    var totalH = norm.reduce(function (a, r) { return a + r.height; }, 0);
    var clamped = false;
    if (o.clamp === true) {
      var pos = clampIntoView(x, y, w, totalH);
      x = pos.x; y = pos.y; clamped = pos.clamped;
    }
    var tag = o.id || ('ai_pool_' + Date.now());
    var laneIds = norm.map(function (r, i) { return tag + '_lane_' + i; });
    var laneW = Math.max(1, w - headerWidth);
    var laneX = x + headerWidth;
    var poolLine = { lineWidth: lineWidth, lineColor: line, lineStyle: 'solid' };
    var poolFill = fill ? { drawType: 'fill', fill: fill, alpha: 1 } : {};
    var laneFill = fillLane ? { drawType: 'fill', fill: fillLane, alpha: 1 } : {};
    var fontStyle = { fontColor: font, fontSize: fontSize, bold: bold,
      textAlign: 'center', vAlign: 'middle' };
    var attrExtra = vr ? {} : { viewportRenderable: false };

    var pool = {
      id: tag,
      name: 'horizontalPool',
      title: '泳池(水平)',
      parent: '',
      container: '',
      link: '',
      children: laneIds.slice(),
      shapeStyle: { alpha: 1 },
      fillStyle: poolFill,
      lineStyle: poolLine,
      fontStyle: fontStyle,
      textBlock: laneTextBlock(o.title || ''),
      anchors: [],
      dataAttributes: [],
      props: { zindex: 1, w: w, h: totalH, x: x, y: y, angle: 0, height: [headerWidth] },
      path: lanePath(),
      attribute: laneAttribute(attrExtra),
      resizeDir: ['t', 'r', 'b'],
      group: '',
      locked: false,
      category: 'lane',
      theme: {}
    };

    var laneEls = [];
    var cursor = y;
    for (var i = 0; i < norm.length; i++) {
      laneEls.push(buildLane({
        id: laneIds[i], parent: tag, text: norm[i].name,
        fillStyle: laneFill, lineStyle: poolLine, fontStyle: fontStyle,
        category: 'lane', attributeExtra: attrExtra,
        props: {
          zindex: -1, x: laneX, y: cursor, w: laneW, h: norm[i].height,
          height: [headerWidth]
        }
      }));
      cursor += norm[i].height;
    }

    global.MessageSource.executeMessages(
      [{ action: 'create', content: [pool].concat(laneEls) }], true
    );
    return {
      id: tag, laneIds: laneIds, rowCount: laneIds.length,
      x: x, y: y, w: w, h: totalH, totalHeight: totalH,
      headerWidth: headerWidth, clamped: clamped,
      rendered: !!document.getElementById(tag)
    };
  }

  /**
   * 一等公民：把已存在的泳道池改成 N 行（增删 lane 子元素 + 重排坐标 + 同步池高）。
   *   poolId : 已存在的 horizontalPool 的 id
   *   rows   : [{name,height}] 或 ['角色A',...]，长度 1..50（必填）
   *   opts   : {headerWidth, rowHeight, keepIds(默认 true), style, viewportRenderable}
   * 行数只由 pool.children 决定：复用前 min(旧行数,新行数) 个 lane（update），
   * 多出来的旧 lane 删除（remove），不足的新 lane 新建（create），单事务提交。
   * 非 lane 的旧 children 原样保留，避免误删挂在池里的普通图元。
   * 返回 {poolId,rowCount,laneIds,added,updated,removed,kept,totalHeight,headerWidth}。
   */
  function setPoolRows(poolId, rows, opts) {
    ensureRuntime();
    var o = opts || {};
    var els = global.Model.define.elements;
    var pool = els[poolId];
    if (!pool) throw new Error('setPoolRows: 泳道池不存在: ' + poolId);
    if (!/horizontalPool/i.test(pool.name || '')) {
      throw new Error('setPoolRows: 目标不是 horizontalPool: ' + poolId + ' (name=' + pool.name + ')');
    }
    var norm = normalizeRows(rows, o.rowHeight, 'setPoolRows');
    var keepIds = o.keepIds !== false;
    var poolProps = pool.props || {};
    var headerWidth = (o.headerWidth != null && isFinite(o.headerWidth) && o.headerWidth > 0)
      ? o.headerWidth
      : (Array.isArray(poolProps.height) && isFinite(poolProps.height[0]) && poolProps.height[0] > 0)
        ? poolProps.height[0] : 56;
    var st = o.style || {};
    var fillLane = st.fillLane != null ? st.fillLane : (st.fill != null ? st.fill : RED.fill);
    var line = st.line != null ? st.line : RED.line;
    var font = st.font != null ? st.font : RED.font;
    var lineWidth = st.lineWidth != null ? st.lineWidth : 2;
    var fontSize = st.fontSize != null ? st.fontSize : 13;
    var laneFill = fillLane ? { drawType: 'fill', fill: fillLane, alpha: 1 } : {};
    var laneLine = { lineWidth: lineWidth, lineColor: line, lineStyle: 'solid' };
    var fontStyle = { fontColor: font, fontSize: fontSize, bold: st.bold === true,
      textAlign: 'center', vAlign: 'middle' };

    var oldChildren = (pool.children || []).slice();
    var oldLaneIds = oldChildren.filter(isLaneId);
    var otherChildren = oldChildren.filter(function (id) { return !isLaneId(id); });
    var poolX = poolProps.x || 0, poolY = poolProps.y || 0, poolW = poolProps.w || 2000;
    var laneX = poolX + headerWidth, laneW = Math.max(1, poolW - headerWidth);
    var totalH = norm.reduce(function (a, r) { return a + r.height; }, 0);

    var nextPool = JSON.parse(JSON.stringify(pool));
    nextPool.children = [];
    nextPool.props.h = totalH;
    if (!Array.isArray(nextPool.props.height) || !nextPool.props.height.length) {
      nextPool.props.height = [headerWidth];
    } else {
      nextPool.props.height[0] = headerWidth;
    }
    nextPool.name = 'horizontalPool';
    nextPool.category = 'lane';
    nextPool.path = lanePath();
    nextPool.attribute = laneAttribute({ viewportRenderable: nextPool.attribute && nextPool.attribute.viewportRenderable });
    if (o.title != null && nextPool.textBlock && nextPool.textBlock[0]) {
      nextPool.textBlock[0].text = o.title;
    }

    var laneIds = [], newLanes = [], reusedLanes = [];
    var kept = 0, added = 0, cursor = poolY;
    for (var i = 0; i < norm.length; i++) {
      var reuse = keepIds && i < oldLaneIds.length ? els[oldLaneIds[i]] : null;
      var id = reuse ? oldLaneIds[i] : (poolId + '_lane_' + Date.now() + '_' + i);
      var lane;
      if (reuse) {
        kept++;
        lane = JSON.parse(JSON.stringify(reuse));
        lane.parent = poolId;
        lane.name = 'horizontalLane';
        lane.children = [];
        lane.textBlock = laneTextBlock(norm[i].name);
        lane.path = lanePath();
        lane.attribute = laneAttribute({ viewportRenderable: lane.attribute && lane.attribute.viewportRenderable });
        lane.category = 'lane';
        if (!lane.props) lane.props = {};
        lane.props.x = laneX; lane.props.y = cursor;
        lane.props.w = laneW; lane.props.h = norm[i].height;
        lane.props.height = [headerWidth];
        if (o.style) { lane.fillStyle = laneFill; lane.lineStyle = laneLine; lane.fontStyle = fontStyle; }
        reusedLanes.push(lane);
      } else {
        added++;
        lane = buildLane({
          id: id, parent: poolId, text: norm[i].name,
          fillStyle: laneFill, lineStyle: laneLine, fontStyle: fontStyle,
          category: 'lane',
          attributeExtra: { viewportRenderable: false },
          props: { zindex: -1, x: laneX, y: cursor, w: laneW, h: norm[i].height,
            height: [headerWidth] }
        });
        newLanes.push(lane);
      }
      laneIds.push(id);
      nextPool.children.push(id);
      cursor += norm[i].height;
    }
    nextPool.children = nextPool.children.concat(otherChildren);

    var removeIds = oldLaneIds.filter(function (id) { return laneIds.indexOf(id) < 0; });
    var messages = [];
    if (removeIds.length) {
      var removedEls = removeIds.map(function (id) { return els[id]; }).filter(Boolean);
      if (removedEls.length) messages.push({ action: 'remove', content: removedEls });
    }
    var updateEls = [nextPool].concat(reusedLanes);
    messages.push({ action: 'update', content: { shapes: updateEls, updates: updateEls } });
    if (newLanes.length) messages.push({ action: 'create', content: newLanes });
    global.MessageSource.executeMessages(messages, true);

    return {
      poolId: poolId, rowCount: laneIds.length, laneIds: laneIds,
      added: added, updated: reusedLanes.length, removed: removeIds.length, kept: kept,
      totalHeight: totalH, headerWidth: headerWidth
    };
  }

  // ---------- 导出 ----------
  global.POBridge = {
    RED: RED,
    readGraph: readGraph,
    createNode: createNode,
    updateNode: updateNode,
    removeNodes: removeNodes,
    createEdge: createEdge,
    getViewBox: getViewBox,
    clampIntoView: clampIntoView,
    focusRect: focusRect,
    getPoolRows: getPoolRows,
    createPool: createPool,
    setPoolRows: setPoolRows
  };

  return global.POBridge;
})(window);
