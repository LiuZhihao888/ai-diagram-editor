(function(){
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
  // 【锚点绑定铁律（75 条原图连线实测反推）】
  //   连线必须绑定「边的中点」，不能从中心点乱连 —— 那就是 ProcessOn 交互里
  //   hover 节点时出现的蓝色小圆点（anchor）。只有绑在边中点，渲染器才会画出
  //   干净的正交直角折线；从中心点连会画成斜线。
  //
  //   angle 不是「出线方向」，而是「该锚点所在边」的编码：
  //     L 左 -> 0          T 上 -> PI/2 (1.57)
  //     R 右 -> PI (3.14)  B 下 -> 3PI/2 (4.71)
  //   实测统计（原图 75 条 linker）：R:3.14 x42 / T:1.57 x24 / B:4.71 x26 / L:0 x32
  //   反向推理（把 R 写成 0）会画出斜线 —— 这是最容易踩的坑。
  //
  //   points 是「拐角表」，不是端点表：points[0] 通常是拐角 {x: to.x, y: from.y}。
  //   改完 points 必须触发 Designer.events.push('resetBrokenLinker')，
  //   否则渲染器不重算折线路径，画布上不更新。
  var ANCHOR = { L: 0, T: Math.PI / 2, R: Math.PI, B: 3 * Math.PI / 2 };

  function anchorPoints(p) {
    return {
      L: { x: p.x, y: p.y + p.h / 2 },
      T: { x: p.x + p.w / 2, y: p.y },
      R: { x: p.x + p.w, y: p.y + p.h / 2 },
      B: { x: p.x + p.w / 2, y: p.y + p.h }
    };
  }

  // 按相对位置自动挑选一对最自然的出入边（优先直达，其次阶梯）
  function pickSides(a, b) {
    var acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    var bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    var dx = bcx - acx, dy = bcy - acy;

    // 同一水平行（y 中心几乎相等）-> 水平直达
    if (Math.abs(dy) <= 1.5) {
      if (bcx >= acx) return { from: 'R', to: 'L' };
      return { from: 'L', to: 'R' };
    }
    // 同一竖直列 -> 垂直直达
    if (Math.abs(dx) <= 1.5) {
      if (bcy >= acy) return { from: 'B', to: 'T' };
      return { from: 'T', to: 'B' };
    }
    // 垂直位移占主导 -> 下/上出，上/下入
    if (Math.abs(dy) >= Math.abs(dx) * 0.55) {
      if (dy > 0) return { from: 'B', to: 'T' };
      return { from: 'T', to: 'B' };
    }
    // 否则水平
    return dx >= 0 ? { from: 'R', to: 'L' } : { from: 'L', to: 'R' };
  }

  // 根据两端锚点生成拐角表
  function buildPoints(fs, ts) {
    var fx = fs.pt.x, fy = fs.pt.y, tx = ts.pt.x, ty = ts.pt.y;
    var hExit = (fs.side === 'L' || fs.side === 'R');
    var hEntry = (ts.side === 'L' || ts.side === 'R');

    if (hExit && hEntry) {
      if (Math.abs(fy - ty) < 1) return [{ x: tx, y: fy }];
      var mx = Math.round((fx + tx) / 2);
      return [{ x: mx, y: fy }, { x: mx, y: ty }];
    }
    if (!hExit && !hEntry) {
      if (Math.abs(fx - tx) < 1) return [{ x: fx, y: ty }];
      var my = Math.round((fy + ty) / 2);
      return [{ x: fx, y: my }, { x: tx, y: my }];
    }
    return hExit ? [{ x: tx, y: fy }] : [{ x: fx, y: ty }];
  }

  function r2(v) { return Math.round(v * 100) / 100; }

  // 计算一条连线的完整几何（纯函数，可单测）
  function computeEdgeGeometry(fromProps, toProps, opts) {
    var o = opts || {};
    var sides = (o.fromSide && o.toSide)
      ? { from: o.fromSide, to: o.toSide }
      : pickSides(fromProps, toProps);
    var ap = anchorPoints(fromProps), bp = anchorPoints(toProps);
    var fs = { side: sides.from, pt: ap[sides.from] };
    var ts = { side: sides.to, pt: bp[sides.to] };
    var pts = buildPoints(fs, ts);
    return {
      from: { x: r2(fs.pt.x), y: r2(fs.pt.y), angle: ANCHOR[fs.side] },
      to: { x: r2(ts.pt.x), y: r2(ts.pt.y), angle: ANCHOR[ts.side] },
      points: pts.map(function (p) { return { x: r2(p.x), y: r2(p.y) }; }),
      fromSide: sides.from,
      toSide: sides.to,
      anchorAngle: { from: ANCHOR[sides.from], to: ANCHOR[sides.to] }
    };
  }

  function resetBrokenLinkers() {
    try {
      if (global.Designer && global.Designer.events && global.Designer.events.push) {
        global.Designer.events.push('resetBrokenLinker');
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function createEdge(opts) {
    ensureRuntime();
    var o = opts || {};
    var from = global.Model.define.elements[o.from];
    var to = global.Model.define.elements[o.to];
    if (!from || !to) throw new Error('连线端点不存在: ' + o.from + ' -> ' + o.to);

    var geo = computeEdgeGeometry(from.props, to.props, o);

    var edge = {
      id: o.id || ('ai_edge_' + Date.now()),
      name: 'linker',
      text: o.text || '',
      points: geo.points,
      dataAttributes: [],
      props: { zindex: 950, x: 0, y: 0 },
      linkerType: 'broken',
      lineStyle: { lineWidth: o.lineWidth || 2, lineColor: o.line || RED.line },
      from: { x: geo.from.x, y: geo.from.y, angle: geo.from.angle, id: o.from },
      to: { x: geo.to.x, y: geo.to.y, angle: geo.to.angle, id: o.to },
      textBlock: o.text ? [{ location: 0.5, text: o.text }] : [],
      group: '',
      locked: false
    };
    global.MessageSource.executeMessages([{ action: 'create', content: [edge] }], true);
    resetBrokenLinkers();
    return { id: edge.id, fromSide: geo.fromSide, toSide: geo.toSide, points: geo.points.length };
  }

  function applyGeo(e, geo) {
    var next = JSON.parse(JSON.stringify(e));
    next.from = { x: geo.from.x, y: geo.from.y, angle: geo.from.angle, id: e.from.id };
    next.to = { x: geo.to.x, y: geo.to.y, angle: geo.to.angle, id: e.to.id };
    next.points = geo.points;
    if (next.text && (!next.textBlock || !next.textBlock.length)) {
      next.textBlock = [{ location: 0.5, text: next.text }];
    }
    return next;
  }

  // 重排单条连线：把端点从「中心点/错角度」纠正到「边中点 + 正确 angle」
  function rebindEdge(id, opts) {
    ensureRuntime();
    var e = global.Model.define.elements[id];
    if (!e) throw new Error('连线不存在: ' + id);
    if (!e.from || !e.to) throw new Error('连线缺少端点: ' + id);
    var f = global.Model.define.elements[e.from.id];
    var t = global.Model.define.elements[e.to.id];
    if (!f || !t) throw new Error('连线端点节点不存在: ' + id);
    var geo = computeEdgeGeometry(f.props, t.props, opts || {});
    global.Model.updateMulti([applyGeo(e, geo)]);
    resetBrokenLinkers();
    return { id: id, fromSide: geo.fromSide, toSide: geo.toSide, points: geo.points.length };
  }

  // 批量重排（一次 updateMulti + 一次 resetBrokenLinker）
  function rebindEdges(ids, opts) {
    ensureRuntime();
    var list = ids || [];
    var upd = [], log = [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      var e = global.Model.define.elements[id];
      if (!e || !e.from || !e.to) continue;
      var f = global.Model.define.elements[e.from.id];
      var t = global.Model.define.elements[e.to.id];
      if (!f || !t) continue;
      var geo = computeEdgeGeometry(f.props, t.props, opts || {});
      upd.push(applyGeo(e, geo));
      log.push({ id: id, fromSide: geo.fromSide, toSide: geo.toSide, points: geo.points.length });
    }
    if (upd.length) global.Model.updateMulti(upd);
    resetBrokenLinkers();
    return { rebound: upd.length, edges: log };
  }

  // 跨越多行的「回滚线」交给外圈通道：从泳道组下方绕行，绝不穿过任何节点。
  // 判据：目标在左侧（回指），且垂直跨度大于一行 —— 这种线走内部必然穿过节点。
  function routeAround(routes, opts) {
    ensureRuntime();
    var o = opts || {};
    var channelY = o.channelY;
    if (typeof channelY !== 'number') throw new Error('routeAround 需要 channelY（外圈通道 y 坐标）');
    var E = global.Model.define.elements;
    var log = [], upd = [];
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      var e = E[r.id];
      if (!e || !e.from || !e.to) continue;
      var f = E[e.from.id], t = E[e.to.id];
      if (!f || !t) continue;
      var next = JSON.parse(JSON.stringify(e));
      var fx = f.props.x + f.props.w / 2, fy = f.props.y + f.props.h;   // 下边中点
      var tx = t.props.x + t.props.w / 2, ty = t.props.y + t.props.h;   // 下边中点
      next.from = { x: r2(fx), y: r2(fy), angle: ANCHOR.B, id: e.from.id };
      next.to = { x: r2(tx), y: r2(ty), angle: ANCHOR.B, id: e.to.id };
      next.points = [{ x: r2(fx), y: r2(channelY) }, { x: r2(tx), y: r2(channelY) }];
      upd.push(next);
      log.push({ id: r.id, channelY: channelY, points: next.points.length });
    }
    if (upd.length) global.Model.updateMulti(upd);
    resetBrokenLinkers();
    return { routed: upd.length, edges: log };
  }

  // 自动挑一条不穿过任何节点的外圈通道，并把指定连线改走它
  function autoRouteAround(ids, opts) {
    ensureRuntime();
    var o = opts || {};
    var E = global.Model.define.elements;
    // 收集泳道与注释，算出泳道组底部与注释顶部之间的空隙
    var lanes = [], noteTop = null, id;
    for (id in E) {
      var el = E[id];
      if (!el || !el.props) continue;
      if (/lane/i.test(el.name || '') && id.indexOf('ai_') === 0) {
        lanes.push({ y: el.props.y, h: el.props.h });
      }
      if (/_note_/.test(id) && noteTop === null) noteTop = el.props.y;
    }
    if (!lanes.length) throw new Error('找不到泳道，无法确定外圈通道');
    lanes.sort(function (a, b) { return a.y - b.y; });
    var laneBottom = lanes[lanes.length - 1].y + lanes[lanes.length - 1].h;
    var channelY;
    if (noteTop !== null && noteTop - laneBottom > 8) {
      channelY = Math.round((laneBottom + noteTop) / 2);
    } else {
      channelY = Math.round(laneBottom + 24);
    }
    var routes = ids.map(function (x) { return { id: x }; });
    var res = routeAround(routes, { channelY: channelY });
    res.laneBottom = laneBottom;
    res.noteTop = noteTop;
    return res;
  }

  // ---------- 间距重排（reflowSpacing）----------
  // 【为什么需要它】相邻节点「边到边」间隙太小时，连线标签（38~47px 宽）会盖住
  // 整条线，视觉上线就「断了/被挤了」。实测：间隙 20px 时标签比线还长。
  // 结论：间隙 >= 80px（47 标签 + 两侧各 16 呼吸）。超宽时降级到 60px。
  //
  // 算法（按行处理，不动纵向）：
  //   1. 节点按 y 分组（同一行）；
  //   2. 行内按 x 排序，从左到右累计位移，保证前一个动完后一个才动；
  //   3. 只增加不减少，绝不把节点往左拉；
  //   4. 不改 y —— 泳道归属完全不变。
  function reflowSpacing(prefix, opts) {
    ensureRuntime();
    var o = opts || {};
    var target = typeof o.target === 'number' ? o.target : 80;
    var fallback = typeof o.fallback === 'number' ? o.fallback : 60;
    var maxRight = typeof o.maxRight === 'number' ? o.maxRight : null;
    var dryRun = !!o.dryRun;
    var E = global.Model.define.elements;

    function collect() {
      var nodes = [], id;
      for (id in E) {
        if (prefix && id.indexOf(prefix) !== 0) continue;
        var el = E[id];
        if (!el || !el.props) continue;
        if (/pool|lane|linker/i.test(el.name || '')) continue;
        if (/_hdr_|_note_/.test(id)) continue;
        nodes.push({ id: id, x: el.props.x, y: el.props.y, w: el.props.w, h: el.props.h });
      }
      return nodes;
    }

    function plan(nodes, gap) {
      var rows = {}, i;
      for (i = 0; i < nodes.length; i++) {
        var key = Math.round(nodes[i].y);
        (rows[key] = rows[key] || []).push(nodes[i]);
      }
      var shifts = {}, maxR = -Infinity;
      for (var k in rows) {
        var arr = rows[k].slice().sort(function (a, b) { return a.x - b.x; });
        var cum = 0;
        for (var j = 0; j < arr.length; j++) {
          if (j > 0) {
            var prevNewX = arr[j - 1].x + (shifts[arr[j - 1].id] || 0);
            var curNewX = arr[j].x + cum;
            var realGap = curNewX - (prevNewX + arr[j - 1].w);
            if (realGap < gap) cum += (gap - realGap);
          }
          shifts[arr[j].id] = cum;
          var r = arr[j].x + cum + arr[j].w;
          if (r > maxR) maxR = r;
        }
      }
      return { shifts: shifts, maxRight: maxR };
    }

    var first = collect();
    if (!first.length) return { moved: 0, gap: target, nodes: 0, reason: 'NO_NODES' };

    var p1 = plan(first, target);
    var usedGap = target;
    var degraded = false;
    if (maxRight !== null && p1.maxRight > maxRight && fallback < target) {
      p1 = plan(first, fallback);
      usedGap = fallback;
      degraded = true;
    }

    var movedIds = [], upd = [];
    for (var id2 in p1.shifts) {
      if (!p1.shifts[id2]) continue;
      movedIds.push(id2);
      if (dryRun) continue;
      var el2 = E[id2];
      var c = JSON.parse(JSON.stringify(el2));
      c.props.x = Math.round(c.props.x + p1.shifts[id2]);
      upd.push(c);
    }
    if (!dryRun && upd.length) global.Model.updateMulti(upd);

    return {
      moved: movedIds.length, gap: usedGap, requested: target,
      degraded: degraded, maxRight: Math.round(p1.maxRight),
      limit: maxRight, nodes: first.length, dryRun: dryRun,
      movedIds: movedIds
    };
  }

  // 间距重排 + 连线重连 + 外圈改道，一条龙（外部只需调这个）
  function polishLayout(prefix, opts) {
    ensureRuntime();
    var o = opts || {};
    var s = reflowSpacing(prefix, o);
    var eids = listEdges(prefix);
    if (eids.length) rebindEdges(eids);
    var cross = detectCrossings(prefix);
    var before = cross.crossings, rerouted = 0;
    if (cross.crossings) {
      var bad = {}, i;
      for (i = 0; i < cross.list.length; i++) bad[cross.list[i].edge] = 1;
      var ids = Object.keys(bad);
      try {
        var rr = autoRouteAround(ids);
        rerouted = rr.routed;
      } catch (err) { /* 没泳道时跳过 */ }
      cross = detectCrossings(prefix);
    }
    return {
      spacing: s, edgesRebound: eids.length,
      crossingsBefore: before, rerouted: rerouted,
      crossingsAfter: cross.crossings
    };
  }

  // ---------- 侧栏说明卡（左侧瘦长矩形）----------
  // 【用途】把「优化说明」这类长文本放在泳道图左侧，与泳道等高、不遮挡任何内容。
  //
  // 【坐标夹取铁律（实测）】
  //   createNode 会被静默夹进视口：x 下限约 -241，y 必须落在当前视口内。
  //   直接 createNode({x:-240, y:6604}) 在未滚动到该区域时会被夹成 y=-660。
  //   正确顺序：① Designer.scrollShapesToView(目标区域) ② 等渲染 ③ 再 createNode。
  //   若仍被夹住，用 updateNode 二次修正 y —— update 不走创建期的夹取逻辑。
  //   返回值里的 clamped 字段必须检查，不能假设放对了。
  function createSideCard(opts) {
    ensureRuntime();
    var o = opts || {};
    var E = global.Model.define.elements;
    var id = o.id || ('ai_card_' + Date.now());
    var poolId = o.poolId;
    var pool = poolId ? E[poolId] : null;
    if (!pool) throw new Error('需要 poolId 指向泳道池，才能等高对齐: ' + poolId);

    var pw = pool.props;
    var cardW = typeof o.w === 'number' ? o.w : 280;
    var gap = typeof o.gap === 'number' ? o.gap : 16;
    // 卡片右沿贴住池左沿留 gap，左沿尽量靠左但不越 -240 下限
    var right = pw.x - gap;
    var x = right - cardW;
    if (x < -240) x = -240;

    // 先把该区域滚进视口，否则 y 会被夹
    try {
      var targets = [];
      for (var k in E) {
        if (k.indexOf(o.scope || 'ai_') === 0 && !/linker/i.test(E[k].name || '')) targets.push(E[k]);
      }
      if (targets.length) global.Designer.scrollShapesToView(targets);
    } catch (e) { /* ignore */ }

    // 先删同 id 旧卡，避免重复
    if (E[id]) {
      global.MessageSource.executeMessages([{ action: 'remove', content: [id] }], true);
    }

    var created = createNode({
      id: id,
      text: o.text || '',
      x: Math.round(x),
      y: Math.round(pw.y),
      w: cardW,
      h: Math.round(pw.h),
      name: 'process',
      fill: o.fill || '255,253,245',
      line: o.line || '214,158,46',
      font: o.font || '74,52,8'
    });

    // 顶部对齐（默认 h:'h' 是垂直居中，长文会显得上方空）
    var el = global.Model.define.elements[id];
    if (el) {
      var nx = JSON.parse(JSON.stringify(el));
      if (nx.textBlock && nx.textBlock[0]) {
        nx.textBlock[0].position = { w: 'w-20', x: 10, h: 'h-20', y: 10 };
      }
      global.Model.updateMulti([nx]);
    }
    // 二次修正：update 不受创建期夹取影响
    var after = global.Model.define.elements[id];
    var fixed = false;
    if (after && (Math.abs(after.props.y - pw.y) > 1 || Math.abs(after.props.x - Math.round(x)) > 1)) {
      var nx2 = JSON.parse(JSON.stringify(after));
      nx2.props.x = Math.round(x);
      nx2.props.y = Math.round(pw.y);
      nx2.props.h = Math.round(pw.h);
      global.Model.updateMulti([nx2]);
      fixed = true;
    }
    var fin = global.Model.define.elements[id];
    return {
      id: id,
      clampedAtCreate: created.clamped,
      repairedByUpdate: fixed,
      x: fin ? Math.round(fin.props.x) : null,
      y: fin ? Math.round(fin.props.y) : null,
      w: fin ? Math.round(fin.props.w) : null,
      h: fin ? Math.round(fin.props.h) : null,
      alignedWithPool: fin ? (Math.abs(fin.props.y - pw.y) < 1 && Math.abs(fin.props.h - pw.h) < 1) : false,
      gapToPool: fin ? Math.round(pw.x - (fin.props.x + fin.props.w)) : null
    };
  }

  // 检查说明卡是否遮住了任何其他图元
  function auditSideCard(cardId) {
    ensureRuntime();
    var E = global.Model.define.elements;
    var card = E[cardId];
    if (!card) return { error: 'NO_CARD', id: cardId };
    var c = card.props, overlaps = [], id;
    for (id in E) {
      if (id === cardId) continue;
      var e = E[id];
      if (!e.props || /linker/i.test(e.name || '')) continue;
      if (e.props.w == null || e.props.h == null) continue;
      var q = e.props;
      var ix = Math.min(c.x + c.w, q.x + q.w) - Math.max(c.x, q.x);
      var iy = Math.min(c.y + c.h, q.y + q.h) - Math.max(c.y, q.y);
      if (ix > 1 && iy > 1) overlaps.push({ id: id, ix: Math.round(ix), iy: Math.round(iy) });
    }
    return { id: cardId, overlaps: overlaps.length, list: overlaps, pass: overlaps.length === 0 };
  }

  // 列出所有连线 id（可按前缀过滤），省得外部自己遍历
  function listEdges(prefix) {
    ensureRuntime();
    var E = global.Model.define.elements, out = [];
    for (var id in E) {
      if (prefix && id.indexOf(prefix) !== 0) continue;
      if (/linker/i.test((E[id] && E[id].name) || '')) out.push(id);
    }
    return out;
  }

  // 检测连线是否穿过非端点节点（交叉 = 视觉硬伤）
  function detectCrossings(prefix) {
    ensureRuntime();
    var E = global.Model.define.elements, boxes = [], id;
    for (id in E) {
      if (prefix && id.indexOf(prefix) !== 0) continue;
      var el = E[id];
      if (!el || !el.props) continue;
      if (/pool|lane|linker/i.test(el.name || '')) continue;
      boxes.push({ id: id, x: el.props.x, y: el.props.y, w: el.props.w, h: el.props.h,
        text: String((el.textBlock && el.textBlock[0] && el.textBlock[0].text) || '').slice(0, 16) });
    }
    function segHitsRect(x1, y1, x2, y2, r) {
      var pad = 2, rx1 = r.x + pad, ry1 = r.y + pad, rx2 = r.x + r.w - pad, ry2 = r.y + r.h - pad;
      if (Math.abs(y1 - y2) < 0.5) {
        if (y1 < ry1 || y1 > ry2) return false;
        var a = Math.min(x1, x2), b = Math.max(x1, x2);
        return b > rx1 && a < rx2;
      }
      if (Math.abs(x1 - x2) < 0.5) {
        if (x1 < rx1 || x1 > rx2) return false;
        var c = Math.min(y1, y2), d = Math.max(y1, y2);
        return d > ry1 && c < ry2;
      }
      return false;
    }
    var viol = [];
    for (id in E) {
      if (prefix && id.indexOf(prefix) !== 0) continue;
      var e = E[id];
      if (!e || !/linker/i.test(e.name || '')) continue;
      if (!e.from || !e.to) continue;
      var pts = [{ x: e.from.x, y: e.from.y }]
        .concat(e.points || [])
        .concat([{ x: e.to.x, y: e.to.y }]);
      for (var i = 1; i < pts.length; i++) {
        for (var b2 = 0; b2 < boxes.length; b2++) {
          var bx = boxes[b2];
          if (bx.id === e.from.id || bx.id === e.to.id) continue;
          if (segHitsRect(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, bx)) {
            viol.push({ edge: id, hitNode: bx.id, hitText: bx.text });
          }
        }
      }
    }
    return { crossings: viol.length, list: viol };
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
    rebindEdge: rebindEdge,
    rebindEdges: rebindEdges,
    computeEdgeGeometry: computeEdgeGeometry,
    listEdges: listEdges,
    resetBrokenLinkers: resetBrokenLinkers,
    detectCrossings: detectCrossings,
    routeAround: routeAround,
    autoRouteAround: autoRouteAround,
    reflowSpacing: reflowSpacing,
    polishLayout: polishLayout,
    createSideCard: createSideCard,
    auditSideCard: auditSideCard,
    ANCHOR: ANCHOR,
    getViewBox: getViewBox,
    clampIntoView: clampIntoView,
    focusRect: focusRect,
    getPoolRows: getPoolRows,
    createPool: createPool,
    setPoolRows: setPoolRows
  };

  return global.POBridge;
})(window);
})();
