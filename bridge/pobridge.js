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

  // ---------- 布局常量（验收阈值的唯一来源）----------
  // 这些数字不是拍脑袋定的，每个都有推导过程。改之前先读理由。
  var LAYOUT = {
    // 连线标签实测最宽 47px（"材料匹配" 38px / "真实性核验" 47px）。
    // 标签压在线上会让人以为线「断了」，所以线长必须明显大于标签宽。
    LABEL_MAX_W: 47,
    // 标签两侧各留一点呼吸，否则贴着节点边看着憋。
    LABEL_BREATH: 16,

    // 理想间隙 = 47 + 16*2 = 79，取整到 80。
    GAP_TARGET: 80,
    // 降级间隙：泳道池不够宽时的下限。60 是「标签能完整放下且不贴边」的
    // 最低可接受值（47 + 6.5*2），再低标签就会盖住节点边框。
    // 用户已确认 60 正确，不要改成 65 之类的「留缓冲」值。
    GAP_FLOOR: 60,

    // 卡片右侧到泳道池左沿的间距
    CARD_GAP: 16,
    // 画布坐标下限（createNode 会把更小的 x 夹回来）
    MIN_X: -240
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

    // 🔴 不能假设 viewBox.x === scrollLeft。
    // 实测：viewBox 与 scrollLeft 差一个常量偏移，且该偏移随 zoom 变化
    //（zoom=1 时 ΔviewBox = Δscroll；zoom=0.5 时 ΔviewBox = 2×Δscroll）。
    // 所以这里做**探针校准**：挪一小步，量出真实的比例与偏移，再算目标滚动量。
    var probeDx = 120, probeDy = 120;
    var vb0 = { x: vb.x, y: vb.y };
    layout.scrollLeft = before.scrollLeft + probeDx;
    layout.scrollTop = before.scrollTop + probeDy;
    try { global.Utils.canvasViewBoxUpdate(); } catch (e) {}
    var vb1 = global.Utils.canvasViewBox;

    var sx = (vb1.x - vb0.x) / probeDx;   // viewBox 每单位 scroll 移动多少
    var sy = (vb1.y - vb0.y) / probeDy;
    // 比例异常（未更新/NaN）时退回 1:1
    if (!isFinite(sx) || Math.abs(sx) < 1e-6) sx = 1;
    if (!isFinite(sy) || Math.abs(sy) < 1e-6) sy = 1;

    // vb0 对应 before.scroll，换算到目标中心
    var wantX = x + w / 2 - vb.w / 2;
    var wantY = y + h / 2 - vb.h / 2;
    var targetLeft = before.scrollLeft + (wantX - vb0.x) / sx;
    var targetTop = before.scrollTop + (wantY - vb0.y) / sy;

    layout.scrollLeft = targetLeft;
    layout.scrollTop = targetTop;

    try { global.Utils.canvasViewBoxUpdate(); } catch (e) {}

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
  // 【实测校正】ProcessOn 的 angle 表示「朝内的入射方向」，不是朝外法线。
// 真机实测 155 个端点：L=π(58次) / R=0(53次) / B=π/2(22次) / T=-π/2(22次)。
// 旧值（L:0,T:π/2,R:π,B:3π/2）方向整体反了，会让 computeEdgeGeometry 算出斜线。
  // 边 -> 该边"朝外"的方向角（逆时针，0=左 / PI/2=上 / PI=右 / 3PI/2=下）。
  // 这是 ProcessOn 自己的编码：与鼠标拖拽吸附产出的 angle 完全一致。
  // 实测依据（真实元素 id，16 个 side 组合全通过）：
  //   from.angle = ANCHOR[出边]        to.angle = ANCHOR[对边]
  // 反例（旧值 {L:PI,T:-PI/2,R:0,B:PI/2}）：数学上等价但数值不同，
  //   产品的分支判据看数值区间，-PI/2 与 3PI/2 会被当成不同方向，
  //   结果是从错的一侧出边，逼出 3~4 个折点、末段不垂直。
  var ANCHOR = { L: 0, T: Math.PI / 2, R: Math.PI, B: (3 * Math.PI) / 2 };
  // 入边也用该边自己的朝外角（ENTRY === ANCHOR）。
  // 实测（真实元素 id，用户手绘 yhUELGdssE549967 作真值）：
  //   n3 底中 -> n4 右中，B 出 R 入
  //     to.angle = ANCHOR[R] = PI          -> 1 个折点 -91,1486  ★与手绘逐字节一致
  //     to.angle = ANCHOR[L] = 0（对边）   -> 3 个折点
  //   n1 右中 -> n2 左中，R 出 L 入
  //     ENTRY=ANCHOR      -> 2 折点
  //     ENTRY=ANCHOR[对边] -> 4 折点
  // 结论：出入边用同一套 ANCHOR 即可，不需要单独的"对边"映射。
  var ENTRY = { L: 0, T: Math.PI / 2, R: Math.PI, B: (3 * Math.PI) / 2 };

  function anchorPoints(p) {
    return {
      L: { x: p.x, y: p.y + p.h / 2 },
      T: { x: p.x + p.w / 2, y: p.y },
      R: { x: p.x + p.w, y: p.y + p.h / 2 },
      B: { x: p.x + p.w / 2, y: p.y + p.h }
    };
  }

  // 判断某个候选出边是否"正对着"某个障碍节点：
  // 从出边中点沿外法线投射一条射线，若障碍节点与这条射线相交，就认为被挡住。
  // maxDist：射线最远只看到这么远。
  // 不设上界时，射线会一路穿过目标节点打到它后面的节点，造成假"被挡"。
  // 实测踩坑（n4->n5，两节点上下相邻仅 22px）：B 出边穿过 n5 后正对 n6，
  // 被判"被挡"，于是从 B 改成 L，凭空多绕 1 个折点。
  function sideBlockedBy(a, side, obstacle, pad, maxDist) {
    if (!obstacle || !obstacle.w) return false;
    var p = pad == null ? 12 : pad;
    var pt = anchorPoints(a)[side];
    var rect = { x: obstacle.x - p, y: obstacle.y - p, w: obstacle.w + p * 2, h: obstacle.h + p * 2 };
    var dir = {
      L: { x: -1, y: 0 }, R: { x: 1, y: 0 },
      T: { x: 0, y: -1 }, B: { x: 0, y: 1 }
    }[side];
    // 射线：pt + t*dir, t>0，与矩形相交判定（slab 法）
    var tmin = 0, tmax = Infinity;
    if (Math.abs(dir.x) < 1e-9) {
      if (pt.x < rect.x || pt.x > rect.x + rect.w) return false;
    } else {
      var t1 = (rect.x - pt.x) / dir.x, t2 = (rect.x + rect.w - pt.x) / dir.x;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
    }
    if (Math.abs(dir.y) < 1e-9) {
      if (pt.y < rect.y || pt.y > rect.y + rect.h) return false;
    } else {
      var t3 = (rect.y - pt.y) / dir.y, t4 = (rect.y + rect.h - pt.y) / dir.y;
      tmin = Math.max(tmin, Math.min(t3, t4));
      tmax = Math.min(tmax, Math.max(t3, t4));
    }
    if (!(tmax > tmin + 1)) return false;
    // 命中点必须落在"出边到目标之间"的距离内
    if (maxDist != null && isFinite(maxDist) && tmin > maxDist) return false;
    return true;
  }

  // 按相对位置自动挑选一对最自然的出入边（优先直达，其次阶梯）
  //
  // 【被上游挡住时改从底边走】默认的"垂直位移占主导就上下出入"是对的，
  // 但如果选中的那条边正对着一个上游节点（流程来路），从那里出去等于
  // 原路往回走，会逼出多余的折返。这时改从底边（B）出，绕开它。
  // 找出矩形 p 上「正对着 other」的那条边。
  // 入边必须迎向来源，否则末段会从节点背面扎进来（箭头不垂直）。
  // 例：n3 在 n4 的右上 -> n4 的入边应为 R（右边迎向 n3），而不是 T。
  function facingSide(p, other) {
    var cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    var ocx = other.x + other.w / 2, ocy = other.y + other.h / 2;
    var dx = ocx - cx, dy = ocy - cy;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'R' : 'L';
    return dy >= 0 ? 'B' : 'T';
  }

  function pickSides(a, b, ctx) {
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
    // 按几何倾向给出首选，再用"是否被上游挡住"校验并纠正
    var prefer;
    if (Math.abs(dy) >= Math.abs(dx) * 0.55) {
      prefer = dy > 0 ? { from: 'B', to: 'T' } : { from: 'T', to: 'B' };
    } else {
      prefer = dx >= 0 ? { from: 'R', to: 'L' } : { from: 'L', to: 'R' };
    }

    // 校验：出边正对着某个障碍节点时，从那里出去等于原路往回走，
    // 会逼出一条绕远路的折线。此时改走"垂直"那条通畅的边。
    if (ctx && ctx.obstacles && ctx.obstacles.length) {
      // 出边的"合理长度"：从该边中点到目标中心的正交距离 + 一个节点宽的余量。
      // 超过这个距离的障碍不再算挡路（它已经在目标后面了）。
      var blockedBy = function (side) {
        var ap2 = anchorPoints(a)[side];
        var ortho = (side === 'L' || side === 'R')
          ? Math.abs(bcx - ap2.x)
          : Math.abs(bcy - ap2.y);
        // 只看到目标为止：超过正交距离的障碍已经在目标另一侧，不该算挡路。
        // 早先加了"一个节点宽"的余量，结果 n5 后面的 n6 又把 B 出边挡住了。
        var limit = ortho;
        for (var i = 0; i < ctx.obstacles.length; i++) {
          if (sideBlockedBy(a, side, ctx.obstacles[i], ctx.pad, limit)) return true;
        }
        return false;
      };
      if (blockedBy(prefer.from)) {
        // 候选优先级：先试"垂直于首选方向"的那条（水平受阻 -> 改垂直；反之亦然）
        var altList = (prefer.from === 'L' || prefer.from === 'R')
          ? [bcy >= acy ? 'B' : 'T', bcy >= acy ? 'T' : 'B']
          : [dx >= 0 ? 'R' : 'L', dx >= 0 ? 'L' : 'R'];
        // 入边 = b 迎向 a 的那条边（不是出边的对边！）
        var entrySide = facingSide(b, a);
        for (var k = 0; k < altList.length; k++) {
          var s = altList[k];
          if (!blockedBy(s)) return { from: s, to: entrySide };
        }
        // 全被挡：退回几何首选
      }
    }
    // 未受阻：选入边。
    // 规则（两条都用真实画布验证过，互相不冲突）：
    //   a) 垂直位移占主导，且 b 在 a 的正下/正上方附近
    //      -> 用配对边 B->T / T->B，产品走直线拐角
    //      实测 n4->n5 (dx=25.5 dy=92)：配对 2 折点；facingSide 给 L->T 会从左边绕 3 折点
    //   b) 否则用「b 迎向 a」那条边
    //      实测 n3->n4 (dx=-324 dy=92)：配对 B->T 给 4 折点；
    //      facingSide 给 B->R 才是 1 折点，且与用户手绘逐字节一致
    var paired = { L: 'R', R: 'L', T: 'B', B: 'T' }[prefer.from];
    var facing = facingSide(b, a);
    var isPaired = (facing === paired);
    var entry = isPaired ? paired : facingSide(b, a);
    // 垂直主导时，若 b 的水平偏移很小（同一列的上下关系），强制用配对边
    var verticalish = Math.abs(dy) >= Math.abs(dx) * 0.55;
    var nearSameColumn = Math.abs(dx) <= Math.max(a.w, b.w) * 0.5;
    if (verticalish && nearSameColumn) entry = paired;
    return { from: prefer.from, to: entry };
  }

  // 根据两端锚点生成拐角表
  //
  // 【为什么不再自己算】旧版这里手写了一个简化 A*/L 形路由，不看 angle、
  // 不看上下游拓扑，实测产出的折线会绕 4 个弯、末端与所连的边不垂直
  // （箭头因此歪着扎进节点）。ProcessOn 自己的 Utils.getLinkerPoints
  // 就是用户手动拖线时用的那套路由，实测能逐点复现手画结果。
  // 所以：只要有运行时，就交给它算；只有在离线单测（无运行时）时才用兜底。
  function buildPoints(fs, ts, probe) {
    var viaProduct = tryProductRoute(probe);
    if (viaProduct) return viaProduct;

    // —— 以下为无运行时的离线兜底（保持原有 L 形行为，仅供 vm 单测） ——
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

  // 调产品路由；任何异常都降级为 null（走兜底），绝不吞掉成"看似成功"
  function tryProductRoute(probe) {
    if (!probe) return null;
    if (!global.Utils || typeof global.Utils.getLinkerPoints !== 'function') return null;
    try {
      var got = global.Utils.getLinkerPoints(probe, false, true);
      if (!got || !got.length) return null;
      // 产品返回点必须都是有限数，否则视为无效
      for (var i = 0; i < got.length; i++) {
        if (!isFinite(got[i].x) || !isFinite(got[i].y)) return null;
      }
      // 去掉相邻重复点与共线中间点。
      // 实测退化：两个节点同轴正对时，产品会返回两个完全相同的点
      // （如 (5205,6035) 与 (5205,6035)），画出来多一个空折点。
      var clean = [];
      for (var k = 0; k < got.length; k++) {
        var q = got[k];
        var prev = clean[clean.length - 1];
        if (prev && Math.abs(prev.x - q.x) < 0.01 && Math.abs(prev.y - q.y) < 0.01) continue;
        clean.push({ x: q.x, y: q.y });
      }
      return clean.length ? clean : got;
    } catch (e) {
      return null;
    }
  }

  function r2(v) { return Math.round(v * 100) / 100; }

  // 计算一条连线的完整几何（纯函数，可单测）
  // 收集"可能挡住出边"的节点：只取与起点同一个连通区域的邻居节点。
  // 不传 obstacles 时，退化为"用全图节点"，开销可控（图元数通常 < 300）。
  function collectObstacles(fromProps, toProps, excludeIds) {
    if (!global.Model || !global.Model.define || !global.Model.define.elements) return [];
    var els = global.Model.define.elements;
    var out = [];
    var seen = {};
    (excludeIds || []).forEach(function (id) { if (id) seen[id] = 1; });
    Object.keys(els).forEach(function (id) {
      if (seen[id]) return;
      var e = els[id];
      if (!e || !e.props) return;
      if (e.name === 'linker') return;
      if (e.attribute && e.attribute.container) return;
      // 泳道 / 分组 / 容器一律不算障碍。
      // 实测踩坑：图3 的泳道矩形 (-500,1440,504x92) 把 n4 整个包住，
      // 被当成障碍后 n4->n5 的出边被判"被挡"，从 B 改成 L，凭空多绕 1 个折点。
      if (/lane|pool|group|swimlane/i.test(String(id))) return;
      if (e.category && /lane|pool|group/i.test(String(e.category))) return;
      var p = e.props;
      if (typeof p.w !== 'number' || typeof p.h !== 'number') return;
      if (p.w > 1000 || p.h > 1000) return;
      out.push({ x: p.x, y: p.y, w: p.w, h: p.h, id: id });
    });
    return out;
  }

  function computeEdgeGeometry(fromProps, toProps, opts) {
    var o = opts || {};
    var fromId = o.fromId || o.from || null;
    var toId = o.toId || o.to || null;
    var sides;
    if (o.fromSide && o.toSide) {
      sides = { from: o.fromSide, to: o.toSide };
    } else {
      // 障碍用来判断"这条出边是不是正对着上游节点"。
      // 没有它，pickSides 会从靠近上游的那一侧出去，逼出一条绕远路的折线。
      var obstacles = o.obstacles || collectObstacles(fromProps, toProps, [fromId, toId]);
      sides = pickSides(fromProps, toProps, { obstacles: obstacles, pad: o.obstaclePad });
    }
    var ap = anchorPoints(fromProps), bp = anchorPoints(toProps);
    var fs = { side: sides.from, pt: ap[sides.from] };
    var ts = { side: sides.to, pt: bp[sides.to] };

    // 组装一条"探测用"连线，交给产品路由算折点。
    // 注意：angle 必须先定（产品的路由依赖它判断出入方向），
    // 顺序是 pickSides -> angle -> getLinkerPoints，不能反过来。
    // 产品路由必须拿到元素 id：不带 id 时它会退化成"重复折点"，
    // 末段不垂直于边（实测：带 id 得 3 个折点且末段垂直；不带 id 得两个重复点）。
    // 兼容两种调用方式：{fromId,toId}（新）与 {from,to}（createEdge 一直这么传）。
    var probeFromId = o.fromId || o.from || null;
    var probeToId = o.toId || o.to || null;
    var probe = {
      name: 'linker',
      linkerType: 'broken',
      from: { x: r2(fs.pt.x), y: r2(fs.pt.y), angle: ANCHOR[fs.side], id: probeFromId },
      to: { x: r2(ts.pt.x), y: r2(ts.pt.y), angle: ENTRY[ts.side], id: probeToId },
      points: []
    };
    var pts = buildPoints(fs, ts, probe);

    return {
      from: { x: r2(fs.pt.x), y: r2(fs.pt.y), angle: ANCHOR[fs.side] },
      to: { x: r2(ts.pt.x), y: r2(ts.pt.y), angle: ENTRY[ts.side] },
      points: pts.map(function (p) { return { x: r2(p.x), y: r2(p.y) }; }),
      fromSide: sides.from,
      toSide: sides.to,
      anchorAngle: { from: ANCHOR[sides.from], to: ANCHOR[ts.side] },
      routedBy: (global.Utils && typeof global.Utils.getLinkerPoints === 'function') ? 'product' : 'fallback'
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

  // 按折线长度比例算出标签的绝对坐标（与 drawEdge 同一套算法）
  function labelPointOnChain(fromPt, points, toPt, loc) {
    var chain = [fromPt].concat(points || []).concat([toPt]);
    var segs = [], total = 0;
    for (var i = 0; i < chain.length - 1; i++) {
      var dx = chain[i + 1].x - chain[i].x, dy = chain[i + 1].y - chain[i].y;
      var len = Math.abs(dx) + Math.abs(dy);
      segs.push({ x: chain[i].x, y: chain[i].y, dx: dx, dy: dy, len: len });
      total += len;
    }
    if (!segs.length) return { x: fromPt.x, y: fromPt.y };
    var target = total * (loc == null ? 0.5 : loc), acc = 0;
    for (var j = 0; j < segs.length; j++) {
      if (acc + segs[j].len >= target || j === segs.length - 1) {
        var f = segs[j].len ? (target - acc) / segs[j].len : 0;
        return { x: segs[j].x + segs[j].dx * f, y: segs[j].y + segs[j].dy * f };
      }
      acc += segs[j].len;
    }
    return { x: fromPt.x, y: fromPt.y };
  }

  function applyGeo(e, geo) {
    var next = JSON.parse(JSON.stringify(e));
    next.from = { x: geo.from.x, y: geo.from.y, angle: geo.from.angle, id: e.from.id };
    next.to = { x: geo.to.x, y: geo.to.y, angle: geo.to.angle, id: e.to.id };
    next.points = geo.points;
    if (next.text && (!next.textBlock || !next.textBlock.length)) {
      next.textBlock = [{ location: 0.5, text: next.text }];
    }
    // 🔴 连线的文字标签是 textBlock[{location}] + textPos{t,x,y}，
    // 几何变了必须同步 textPos，否则标签会停在旧坐标（实测偏差可达 110px）。
    if (next.text) {
      var loc = (next.textBlock && next.textBlock[0] && typeof next.textBlock[0].location === 'number')
        ? next.textBlock[0].location : 0.5;
      var lp = labelPointOnChain(
        { x: geo.from.x, y: geo.from.y }, geo.points, { x: geo.to.x, y: geo.to.y }, loc);
      next.textPos = { t: (next.textPos && next.textPos.t) || 28,
        x: Math.round(lp.x), y: Math.round(lp.y) };
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

  // ---------- 连线绕行（rerouteEdge）----------
  // 【为什么需要它】长距离回边（如「报废分支」从最右回到最左）如果只取
  // 中点一个折点，连线会横穿中间所有节点。实测 AE 系统现状：f5_bk 跨 1616px
  // 穿过 5 个节点。updateNode 不支持改 points，所以要单独一个方法。
  //
  // 【怎么用】先 suggestChannel(edgeId) 拿到推荐通道 y，人工确认不撞节点后
  // 再 rerouteEdge(edgeId, channelY)。
  // 检查「从端点到通道」的竖直段是否穿节点
  function verticalSegBlocked(edgeId, channelY) {
    var E = global.Model.define.elements, g = E[edgeId];
    if (!g || !g.from || !g.to) return { blocked: false, hits: [] };
    var hits = [], id;
    var segs = [
      { x: g.from.x, y1: g.from.y, y2: channelY },
      { x: g.to.x, y1: g.to.y, y2: channelY }
    ];
    for (id in E) {
      var el = E[id];
      if (!el || !el.props) continue;
      if (/pool|lane|linker/i.test(el.name || '')) continue;
      if (id === g.from.id || id === g.to.id) continue;
      var p = el.props;
      if (p.w > 1000) continue;
      for (var s = 0; s < segs.length; s++) {
        var q = segs[s];
        if (Math.abs(q.y1 - q.y2) < 0.5) continue;
        var ya = Math.min(q.y1, q.y2), yb = Math.max(q.y1, q.y2);
        if (q.x > p.x + 2 && q.x < p.x + p.w - 2 && yb > p.y + 2 && ya < p.y + p.h - 2) {
          hits.push(id);
        }
      }
    }
    return { blocked: hits.length > 0, hits: hits.slice(0, 4) };
  }

  function suggestChannel(edgeId, opts) {
    ensureRuntime();
    var o = opts || {};
    var E = global.Model.define.elements, g = E[edgeId];
    if (!g || !/linker/i.test(g.name || '')) throw new Error('不是连线: ' + edgeId);
    if (!g.from || !g.to) throw new Error('连线缺少端点: ' + edgeId);

    // 收集这条线跨越区间内的所有节点
    var x1 = Math.min(g.from.x, g.to.x), x2 = Math.max(g.from.x, g.to.x);
    var boxes = [], id;
    for (id in E) {
      var el = E[id];
      if (!el || !el.props) continue;
      if (/pool|lane|linker/i.test(el.name || '')) continue;
      if (id === g.from.id || id === g.to.id) continue;
      var p = el.props;
      if (p.w > 1000) continue;
      if (p.x + p.w < x1 || p.x > x2) continue;  // 不在横向区间内
      boxes.push({ id: id, x: p.x, y: p.y, w: p.w, h: p.h });
    }
    if (!boxes.length) return { edge: edgeId, channelY: null, reason: '区间内没有阻挡节点' };

    // 候选通道：从起点行到终点行之间的所有空隙
    var cands = [];
    var fromY = g.from.y, toY = g.to.y;
    // 上方候选：所有阻挡节点的顶边往上 12px
    var tops = {}, bots = {};
    boxes.forEach(function (b) { tops[Math.round(b.y)] = 1; bots[Math.round(b.y + b.h)] = 1; });
    Object.keys(tops).forEach(function (y) { cands.push({ y: +y - 12, kind: 'above' }); });
    Object.keys(bots).forEach(function (y) { cands.push({ y: +y + 12, kind: 'below' }); });
    cands.push({ y: Math.round(fromY), kind: 'fromRow' });
    cands.push({ y: Math.round(toY), kind: 'toRow' });

    // 打分：穿越数最少 + 偏离端点行最少
    var best = null;
    for (var c = 0; c < cands.length; c++) {
      var cy = cands[c].y;
      var hits = 0;
      for (var b2 = 0; b2 < boxes.length; b2++) {
        var bx = boxes[b2];
        if (cy >= bx.y && cy <= bx.y + bx.h) hits++;
      }
      var dist = Math.abs(cy - fromY) + Math.abs(cy - toY);
      var score = hits * 10000 + dist;
      if (!best || score < best.score) best = { channelY: cy, hits: hits, score: score, kind: cands[c].kind };
    }
    return { edge: edgeId, channelY: best.channelY, blockHits: best.hits,
             kind: best.kind, candidates: cands.length, blockers: boxes.length };
  }

  function rerouteEdge(edgeId, channelY) {
    ensureRuntime();
    var E = global.Model.define.elements, e = E[edgeId];
    if (!e || !/linker/i.test(e.name || '')) throw new Error('不是连线: ' + edgeId);
    if (!e.from || !e.to) throw new Error('连线缺少端点: ' + edgeId);
    if (typeof channelY !== 'number') throw new Error('需要 channelY');
    // 【关键】端点必须留在节点边缘中点（锚点），不能挪到通道上。
    // 挪端点会让锚点脱离边缘（实测 badAnchor 从 0 飙到 20），
    // 正确做法：端点不动，只让中间折点走通道，形成"出边→竖直段→通道→竖直段→入边"。
    var upd = JSON.parse(JSON.stringify(e));
    var pts = [];
    // 起点若不在通道上，先竖直走到通道（保持起点 x）
    if (Math.abs(e.from.y - channelY) > 0.5) pts.push({ x: e.from.x, y: channelY });
    // 终点若不在通道上，从通道竖直走到终点
    if (Math.abs(e.to.y - channelY) > 0.5) pts.push({ x: e.to.x, y: channelY });
    if (!pts.length) pts.push({ x: e.from.x, y: channelY }, { x: e.to.x, y: channelY });
    // 折点按从起点到终点的顺序排列
    if (pts.length === 2 && Math.abs(e.from.x - pts[0].x) > 0.5) { /* 保持原序 */ }
    upd.points = pts;
    global.MessageSource.executeMessages(
      [{ action: 'update', content: { shapes: [upd], updates: [upd] } }], true);
    if (global.Designer && global.Designer.events) {
      global.Designer.events.push('resetBrokenLinker');
    }
    return { id: edgeId, rerouted: true, channelY: channelY, points: upd.points };
  }

  // 批量：给所有穿越数超阈值的连线推荐并应用通道
  function rerouteWorstEdges(opts) {
    ensureRuntime();
    var o = opts || {};
    var maxApply = typeof o.max === 'number' ? o.max : 5;
    var minCross = typeof o.minCross === 'number' ? o.minCross : 3;
    var res = detectCrossings('');
    var byEdge = {};
    (res.list || []).forEach(function (v) { byEdge[v.edge] = (byEdge[v.edge] || 0) + 1; });
    var ranked = Object.keys(byEdge).sort(function (a, b) { return byEdge[b] - byEdge[a]; });
    var applied = [], skippedList = [];
    for (var i = 0; i < ranked.length && applied.length < maxApply; i++) {
      var eid = ranked[i];
      if (byEdge[eid] < minCross) break;
      var sg = suggestChannel(eid);
      if (sg.channelY === null || sg.blockHits > 0) { skippedList.push({ edge: eid, reason: sg.blockHits > 0 ? '找不到干净通道' : sg.reason }); continue; }
      // 【关键】水平通道干净还不够：从端点到通道的竖直段也不能穿节点。
      // 实测 f4_b1: from.y=1727 要走到通道 1439，途中穿过 n3/n4/n5。
      var vBad = verticalSegBlocked(eid, sg.channelY);
      if (vBad.blocked) { skippedList.push({ edge: eid, reason: '竖直段穿过 ' + vBad.hits.join(',') }); continue; }
      try {
        rerouteEdge(eid, sg.channelY);
        applied.push({ edge: eid, before: byEdge[eid], channelY: sg.channelY });
      } catch (err) {
        skippedList.push({ edge: eid, reason: String(err.message).slice(0, 60) });
      }
    }
    return { applied: applied, skipped: skippedList, scanned: ranked.length };
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
    var target = typeof o.target === 'number' ? o.target : LAYOUT.GAP_TARGET;
    var fallback = typeof o.fallback === 'number' ? o.fallback : LAYOUT.GAP_FLOOR;
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
    var gap = typeof o.gap === 'number' ? o.gap : LAYOUT.CARD_GAP;
    // 卡片右沿贴住池左沿留 gap，左沿尽量靠左但不越 -240 下限
    var right = pw.x - gap;
    var x = right - cardW;
    if (x < LAYOUT.MIN_X) x = LAYOUT.MIN_X;

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

  // ---------- 重叠检测 ----------
  // 【为什么必须查】reflowSpacing 只改 x 不改 y，把节点往右推时，
  // 有可能把它推到别的行的节点正上方/下方，形成视觉重叠。
  // 没有这项检查时，「间距合格」和「没有压在一起」是两回事 —— 后者可能悄悄坏掉。
  //
  // 判定：两个矩形在 x 和 y 方向都相交超过 1px 才算重叠（1px 容差避免边界误报）。
  // 说明块（_note_/_hdr_）和泳道池按默认排除：它们本来就成片覆盖。
  function detectOverlaps(prefix, opts) {
    ensureRuntime();
    var o = opts || {};
    var includeDeco = !!o.includeDecorations;
    var E = global.Model.define.elements;
    var boxes = [], id;
    for (id in E) {
      if (prefix && id.indexOf(prefix) !== 0) continue;
      var el = E[id];
      if (!el || !el.props) continue;
      if (/linker/i.test(el.name || '')) continue;
      if (!includeDeco) {
        if (/pool|lane/i.test(el.name || '')) continue;
        if (/_hdr_|_note_/.test(id)) continue;
      }
      if (el.props.w == null || el.props.h == null) continue;
      boxes.push({
        id: id,
        x: el.props.x, y: el.props.y, w: el.props.w, h: el.props.h,
        text: String((el.textBlock && el.textBlock[0] && el.textBlock[0].text) || '').slice(0, 14)
      });
    }
    var pairs = [];
    for (var a = 0; a < boxes.length; a++) {
      for (var b = a + 1; b < boxes.length; b++) {
        var p = boxes[a], q = boxes[b];
        var ix = Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x);
        var iy = Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y);
        if (ix > 1 && iy > 1) {
          pairs.push({
            a: p.id, b: q.id,
            aText: p.text, bText: q.text,
            overlapW: Math.round(ix), overlapH: Math.round(iy)
          });
        }
      }
    }
    return { overlaps: pairs.length, boxes: boxes.length, list: pairs };
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
    // 【必须支持斜线】旧版只判断 `|Δy|<0.5` 或 `|Δx|<0.5`，斜线段直接 return false，
    // 导致斜穿节点的连线完全不被发现。实测本画布 11 条斜线里 5 条穿节点，全部漏报。
    function segHitsRect(x1, y1, x2, y2, r) {
      var pad = 2, rx1 = r.x + pad, ry1 = r.y + pad, rx2 = r.x + r.w - pad, ry2 = r.y + r.h - pad;
      // 水平/垂直走快路径（数值更稳）
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
      // 斜线：Liang-Barsky 线段裁剪
      var dx = x2 - x1, dy = y2 - y1;
      var t0 = 0, t1 = 1;
      var p = [-dx, dx, -dy, dy];
      var q = [x1 - rx1, rx2 - x1, y1 - ry1, ry2 - y1];
      for (var i2 = 0; i2 < 4; i2++) {
        if (Math.abs(p[i2]) < 1e-9) {
          if (q[i2] < 0) return false;   // 平行且在界外
        } else {
          var rr = q[i2] / p[i2];
          if (p[i2] < 0) { if (rr > t1) return false; if (rr > t0) t0 = rr; }
          else { if (rr < t0) return false; if (rr < t1) t1 = rr; }
        }
      }
      return t0 <= t1;
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
  // ========================================================================
  // 绘制引擎（draw engine）—— 从零构造流程图，不依赖任何已有图元
  // ------------------------------------------------------------------------
  // 设计依据：docs/api-capability-map.md（API 实测）+ docs/handdrawn-style-spec.md（手绘风格量测）
  //
  // 核心约束（都是实测踩出来的）：
  //   1. 落库走 MessageSource.executeMessages / Model.addMulti，不自己调 sendMessage.send
  //   2. 节点必须带 attribute + anchors + path/getPath/getTextBlock，否则不渲染
  //   3. textBlock 必须带 position，否则文字不显示
  //   4. 泳道归属靠坐标几何，不靠任何字段
  //   5. 连线折点要 fixed:true 才保得住
  //   6. getLinkerPoints 第三参 nFlag=true 会丢弃 fixed 折点
  // ========================================================================

  var STYLE = {
    // 手绘风格默认值（来自 handdrawn-style-spec.md 附录 A）
    fontFamily: '微软雅黑',
    fontSize: 13,
    lineHeight: 1.25,
    fontColor: '50,50,50',
    fillColor: '255,255,255',
    borderColor: '33,41,48',
    borderWidth: 1.5,
    radius: 0,
    linkColor: '50,50,50',
    linkWidth: 1.5,
    gapX: 51,
    gapY: 118,
    laneH: 200,
    lanePadTop: 65,
    poolHeaderW: 84
  };

  // 形状规格表：语义 -> 尺寸与形状名
  // 形状规格：语义 -> { Model.create 用的官方形状名, 默认尺寸 }
  // ⚠️ 关键：必须用 Model.create(name) 取骨架，这样 start 才有 curve（圆头）、
  //         decision 才是真菱形。自己 clone 别的节点会丢掉形状语义（实测踩过）。
  var SHAPES = {
    start:       { name: 'start',             w: 84,  h: 60 },
    end:         { name: 'terminator',        w: 84,  h: 60 },
    terminator:  { name: 'terminator',        w: 84,  h: 60 },
    process:     { name: 'process',           w: 100, h: 70 },
    decision:    { name: 'decision',          w: 90,  h: 70 },
    diamond:     { name: 'diamond',           w: 90,  h: 70 },
    rectangle:   { name: 'rectangle',         w: 96,  h: 54 },
    storedData:  { name: 'storedData',        w: 100, h: 70 },
    predefined:  { name: 'predefinedProcess', w: 100, h: 70 }
  };

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  // 取一个形状的正确骨架。
  // 🔴 必须用 Model.create(name, x, y)：它按官方 schema 生成 path/anchors/getPath，
  //    这样 start 是圆头、decision 是真菱形。
  //    ⚠️ Model.create 只造对象不落库，且会让 maxZIndex 不自增；随后我们覆盖 props 即可。
  function createSkeleton(shapeName) {
    var nm = shapeName || 'process';
    try {
      var o = global.Model.create(nm, 0, 0);
      if (o && o.path && o.path.length) return o;
    } catch (e) { /* 落到兜底 */ }
    // 兜底：画布上找同类元素
    var els = global.Model && global.Model.define && global.Model.define.elements;
    if (els) {
      var ids = Object.keys(els);
      for (var i = 0; i < ids.length; i++) {
        var e = els[ids[i]];
        if (e && e.name === nm && e.props && typeof e.props.w === 'number') return e;
      }
      for (var k = 0; k < ids.length; k++) {
        var e2 = els[ids[k]];
        if (e2 && e2.name !== 'linker' && e2.props && typeof e2.props.w === 'number') return e2;
      }
    }
    return null;
  }

  // 兼容旧名
  function templateFor(shapeName) { return createSkeleton(shapeName); }

  // 最后兜底：画布上没有任何节点、Model.create 也不可用时，合成一个最小可渲染骨架。
  // （parity 的假环境就属于这种情况；真实编辑器里几乎不会走到）
  function synthSkeleton(shapeName) {
    var nm = shapeName || 'process';
    var rect = [{ x: '0', action: 'move', y: '0' },
                { x: 'w', action: 'line', y: '0' },
                { x: 'w', action: 'line', y: 'h' },
                { x: '0', action: 'line', y: 'h' },
                { action: 'close' }];
    return {
      name: nm,
      category: 'flow',
      path: [{ fillStyle: { type: 'none' }, actions: rect }],
      getPath: function () { return this.path; },
      getAnchors: function () { return this.anchors || []; },
      getTextBlock: function () { return this.textBlock || []; },
      anchors: [],
      attribute: { container: false, rotatable: true, visible: true, fixedLink: false,
                   collapsable: false, collapsed: false, linkable: true, markerOffset: 5 },
      props: { zindex: 900, x: 0, y: 0, w: 100, h: 70, angle: 0 }
    };
  }

  // 构造一个节点对象（纯数据，不落库）
  // opts: { id, shape, x, y, w, h, text, fill, border, fontSize }
  function buildNode(opts) {
    var o = opts || {};
    var spec = SHAPES[o.shape] || SHAPES.process;
    var tpl = createSkeleton(spec.name) || createSkeleton('process') || synthSkeleton(spec.name);

    // 不依赖 Utils.copy（沙箱里可能没有），自己做深拷贝
    var c = deepClone(tpl);
    // deepClone 会丢函数字段，手动补回
    if (typeof tpl.getPath === 'function') c.getPath = tpl.getPath;
    if (typeof tpl.getAnchors === 'function') c.getAnchors = tpl.getAnchors;
    if (typeof tpl.getTextBlock === 'function') c.getTextBlock = tpl.getTextBlock;
    c.id = o.id || ('nd_' + Math.random().toString(36).slice(2, 10));
    c.name = spec.name;

    // 关键：attribute / anchors / path / getPath 都是渲染必需
    if (tpl.attribute) c.attribute = deepClone(tpl.attribute);
    // 🔴 渲染开关：buildVisibleShapeIds 的判据是
    //    rectCross(canvasViewBox, shapeBox) || attribute.viewportRenderable === false
    // 缺这个字段且不在视口内 => 永不渲染。必须显式置 false。
    c.attribute = c.attribute || {};
    c.attribute.viewportRenderable = false;
    if (tpl.anchors) c.anchors = deepClone(tpl.anchors);
    if (tpl.path) c.path = deepClone(tpl.path);
    if (typeof tpl.getPath === 'function') c.getPath = tpl.getPath;
    if (typeof tpl.getTextBlock === 'function') c.getTextBlock = tpl.getTextBlock;

    c.props = {
      zindex: o.zindex == null ? 900 : o.zindex,
      x: Math.round(o.x), y: Math.round(o.y),
      w: Math.round(o.w == null ? spec.w : o.w),
      h: Math.round(o.h == null ? spec.h : o.h),
      angle: 0
    };

    // textBlock 必须带 position
    var txt = o.text == null ? '' : String(o.text);
    c.textBlock = txt ? [{
      position: { w: 'w-20', x: 10, h: 'h', y: 0 },
      text: txt
    }] : [];
    c.text = txt;

    // 样式
    c.fillStyle = { type: 'solid', color: o.fill || STYLE.fillColor };
    c.lineStyle = {
      lineWidth: o.borderWidth == null ? STYLE.borderWidth : o.borderWidth,
      lineColor: o.border || STYLE.borderColor,
      lineStyle: 'solid'
    };
    var fs2 = {
      fontFamily: STYLE.fontFamily,
      size: o.fontSize || STYLE.fontSize,
      lineHeight: STYLE.lineHeight,
      color: o.fontColor || STYLE.fontColor,
      textAlign: 'center',
      vAlign: 'middle'
    };
    c.fontStyle = fs2;

    c.dataAttributes = [];
    c.group = '';
    c.locked = false;
    // 清掉模板带来的内部标记（不属于图元数据，会干扰渲染）
    delete c.__clamped;
    delete c.__requested;
    delete c.text;
    return c;
  }

  // 批量落库（一次 executeMessages，原子且进撤销栈）
  function commit(shapes) {
    var list = Array.isArray(shapes) ? shapes : [shapes];
    if (!list.length) return { created: 0 };
    global.MessageSource.executeMessages([{ action: 'create', content: list }], true);
    return { created: list.length, ids: list.map(function (x) { return x.id; }) };
  }

  // 建一个泳道池 + N 条泳道骨架
  // opts: { x, y, lanes:[{title,h?}], width, headerWidth }
  function buildPool(opts) {
    var o = opts || {};
    var lanes = o.lanes || [];
    var headerW = o.headerWidth || STYLE.poolHeaderW;
    var laneH = (typeof o.laneH === 'number' && isFinite(o.laneH) && o.laneH > 0)
      ? o.laneH : STYLE.laneH;
    var width = o.width || 1200;
    var x = o.x, y = o.y;

    var pool = buildNode({
      id: o.id || ('pool_' + Math.random().toString(36).slice(2, 8)),
      shape: 'rectangle', x: x, y: y,
      w: width, h: laneH * lanes.length,
      text: '', fill: o.fill || '255,255,255', borderWidth: 2
    });
    // 池不需要文字块
    pool.textBlock = []; pool.text = '';

    var out = [pool];
    var laneIds = [];
    lanes.forEach(function (ln, i) {
      var ldt = buildNode({
        id: (o.idPrefix || 'lane_') + i,
        shape: 'rectangle',
        x: x + headerW, y: y + i * laneH,
        w: width - headerW, h: laneH,
        text: '', fill: '255,255,255', borderWidth: 1
      });
      ldt.textBlock = []; ldt.text = '';
      out.push(ldt);
      laneIds.push(ldt.id);

      // 泳道标题（池左侧的表头格）
      var hd = buildNode({
        id: (o.idPrefix || 'lane_') + i + '_hdr',
        shape: 'rectangle',
        x: x, y: y + i * laneH,
        w: headerW, h: laneH,
        text: ln.title || '', fill: o.headerFill || '242,246,250', borderWidth: 1,
        fontSize: 12
      });
      out.push(hd);
    });

    commit(out);
    return { poolId: pool.id, laneIds: laneIds, count: out.length,
      rect: { x: x, y: y, w: width, h: laneH * lanes.length },
      laneH: laneH, headerW: headerW };
  }

  // 在一行里顺序摆放节点
  // opts: { laneY, startX, items:[{text,shape}], gapX }
  function buildRow(opts) {
    var o = opts || {};
    var items = o.items || [];
    var gapX = o.gapX == null ? STYLE.gapX : o.gapX;
    var x = o.startX;
    var laneH = o.laneH || STYLE.laneH;
    var out = [];
    var ids = [];

    items.forEach(function (it, i) {
      var spec = SHAPES[it.shape] || SHAPES.process;
      var w = it.w == null ? spec.w : it.w;
      var h = it.h == null ? spec.h : it.h;
      // 垂直居中于泳道
      var y = o.laneY + Math.round((laneH - h) / 2);
      var nd = buildNode({
        id: it.id || ((o.idPrefix || 'nd_') + i),
        shape: it.shape || 'process',
        x: x, y: y, w: w, h: h,
        text: it.text, fontSize: it.fontSize
      });
      out.push(nd);
      ids.push(nd.id);
      x += w + (it.gapAfter == null ? gapX : it.gapAfter);
    });

    commit(out);
    return { ids: ids, endX: x };
  }

  // 从零画一条连线（两端按 id 查找，自动定边、自动路由）
  // opts: { id, from, to, text, fromSide, toSide, lineWidth, line }
  function drawEdge(opts) {
    var o = opts || {};
    var els = global.Model.define.elements;
    var a = els[o.from], b = els[o.to];
    if (!a || !b) throw new Error('drawEdge 端点不存在: ' + o.from + ' -> ' + o.to);

    var geo = computeEdgeGeometry(a.props, b.props, {
      fromId: o.from, toId: o.to,
      fromSide: o.fromSide, toSide: o.toSide
    });

    var tpl = templateFor('linker');
    var edge;
    if (tpl) {
      edge = deepClone(tpl);
      if (typeof tpl.getPath === 'function') edge.getPath = tpl.getPath;
      if (typeof tpl.getTextBlock === 'function') edge.getTextBlock = tpl.getTextBlock;
      edge.id = o.id || ('e_' + Math.random().toString(36).slice(2, 10));
    } else {
      edge = { id: o.id || ('e_' + Math.random().toString(36).slice(2, 10)), name: 'linker' };
    }
    edge.name = 'linker';
    edge.linkerType = 'broken';
    edge.props = { zindex: o.zindex == null ? 950 : o.zindex, x: 0, y: 0 };
    edge.from = { x: geo.from.x, y: geo.from.y, angle: geo.from.angle, id: o.from };
    edge.to   = { x: geo.to.x,   y: geo.to.y,   angle: geo.to.angle,   id: o.to };
    edge.points = (geo.points || []).map(function (p) { return { x: p.x, y: p.y }; });

    // 连线标签结构（手绘实测）：textBlock = [{ location: 沿线比例0~1, text }]
    // 另需 textPos = { t, x, y } —— x/y 是标签的绝对坐标，渲染器据此定位。
    // ⚠️ 用节点那套 {position:{w,h,x,y}} 是错的，会让文字压住节点。
    var txt = o.text == null ? '' : String(o.text);
    var loc = (o.labelLocation == null ? 0.5 : o.labelLocation);
    if (txt) {
      edge.textBlock = [{ location: loc, text: txt }];
      // 标签落在折线总长的 loc 处
      var chain = [{ x: geo.from.x, y: geo.from.y }]
        .concat(edge.points)
        .concat([{ x: geo.to.x, y: geo.to.y }]);
      var segs = [], total = 0;
      for (var si = 0; si < chain.length - 1; si++) {
        var dx = chain[si + 1].x - chain[si].x, dy = chain[si + 1].y - chain[si].y;
        var len = Math.abs(dx) + Math.abs(dy);
        segs.push({ x: chain[si].x, y: chain[si].y, dx: dx, dy: dy, len: len });
        total += len;
      }
      var target = total * loc, acc = 0, lp = { x: chain[0].x, y: chain[0].y };
      for (var sj = 0; sj < segs.length; sj++) {
        if (acc + segs[sj].len >= target || sj === segs.length - 1) {
          var f = segs[sj].len ? (target - acc) / segs[sj].len : 0;
          lp = { x: segs[sj].x + segs[sj].dx * f, y: segs[sj].y + segs[sj].dy * f };
          break;
        }
        acc += segs[sj].len;
      }
      edge.textPos = { t: 28, x: Math.round(lp.x), y: Math.round(lp.y) };
    } else {
      edge.textBlock = [];
    }
    edge.text = txt;
    edge.lineStyle = {
      lineWidth: o.lineWidth == null ? STYLE.linkWidth : o.lineWidth,
      lineColor: o.line || STYLE.linkColor,
      lineStyle: 'solid',
      beginArrowStyle: 'none',
      endArrowStyle: 'solidArrow'
    };
    edge.fontStyle = {
      fontFamily: STYLE.fontFamily, size: STYLE.fontSize,
      color: STYLE.fontColor, textAlign: 'center', vAlign: 'middle'
    };
    edge.dataAttributes = [];
    edge.group = '';
    edge.locked = false;
    edge.attribute = edge.attribute || {};
    edge.attribute.viewportRenderable = false;

    commit([edge]);
    return { id: edge.id, fromSide: geo.fromSide, toSide: geo.toSide,
      bends: (geo.points || []).length, points: edge.points };
  }

  // 整图生成：从一个声明式描述一次性画出来
  // spec: { origin:{x,y}, idPrefix, width, lanes:[{ title, items:[{text,shape}] }],
  //         edges:[[fromIdxToString, toIdxToString, label]] }
  function drawDiagram(spec) {
    var sp = spec || {};
    var origin = sp.origin || { x: 100, y: 200 };
    var prefix = sp.idPrefix || ('dg' + Math.random().toString(36).slice(2, 6) + '_');
    var lanes = sp.lanes || [];
    if (!lanes.length) throw new Error('drawDiagram 需要至少一条泳道');

    // 防重复建池：若同前缀的池已存在，先清掉（否则会叠出第二套泳道）
    var existEls = global.Model.define.elements;
    if (existEls[prefix + 'pool']) {
      var old = Object.keys(existEls).filter(function (id) {
        return id.indexOf(prefix) === 0;
      }).map(function (id) { return existEls[id]; }).filter(Boolean);
      if (old.length) {
        global.MessageSource.executeMessages([{ action: 'remove', content: old }], true);
      }
    }

    // 1) 池 + 泳道
    var poolInfo = buildPool({
      x: origin.x, y: origin.y,
      width: sp.width || 1200,
      lanes: lanes,
      laneH: sp.laneH,              // 可选：覆盖泳道高（默认 200）
      headerWidth: sp.headerWidth,  // 可选：覆盖表头宽（默认 84）
      idPrefix: prefix + 'lane_',
      id: prefix + 'pool'
    });

    // 2) 每行节点
    var allIds = [];
    var rowInfo = [];
    lanes.forEach(function (ln, i) {
      var laneY = origin.y + i * poolInfo.laneH;
      var r = buildRow({
        laneY: laneY,
        startX: origin.x + poolInfo.headerW + 30,
        items: ln.items || [],
        idPrefix: prefix + 'n' + i + '_',
        laneH: poolInfo.laneH
      });
      rowInfo.push(r);
      allIds = allIds.concat(r.ids);
    });

    // 3) 连线（用 "行号.列号" 或直接 id 指定端点）
    var edgeResults = [];
    var idMap = {};
    lanes.forEach(function (ln, i) {
      (ln.items || []).forEach(function (it, k) {
        idMap[i + '.' + k] = rowInfo[i].ids[k];
        if (it.id) idMap[it.id] = rowInfo[i].ids[k];
      });
    });

    (sp.edges || []).forEach(function (e, i) {
      var fromId = idMap[e[0]] || e[0];
      var toId = idMap[e[1]] || e[1];
      try {
        edgeResults.push(drawEdge({
          id: prefix + 'e' + i,
          from: fromId, to: toId,
          text: e[2] || '',
          fromSide: e[3], toSide: e[4]
        }));
      } catch (err) {
        edgeResults.push({ error: String(err.message), from: fromId, to: toId });
      }
    });

    return { prefix: prefix, pool: poolInfo, rows: rowInfo,
      nodes: allIds.length, edges: edgeResults.length, edgeResults: edgeResults };
  }

  // 验收：连线「数据 vs 渲染」一致性
  // 解决一类隐蔽缺陷：数据全对（badAnchor=0）但 DOM 里的连线盒停在旧位置，
  // 截图看到箭头扎进节点内部。纯数据审计查不出这个。
  function auditEdgeRender(prefix) {
    ensureRuntime();
    var els = global.Model.define.elements;
    var ids = Object.keys(els).filter(function (id) {
      return els[id] && els[id].name === 'linker' && (!prefix || id.indexOf(prefix) === 0);
    });
    var bad = [], okCount = 0, noDom = [];
    ids.forEach(function (id) {
      var e = els[id];
      var dom = document.getElementById(id);
      if (!dom) { noDom.push(id); return; }
      var rc = dom.getBoundingClientRect();
      if (!rc || rc.width === 0) { noDom.push(id); return; }

      // 数据侧：两端锚点 + 折点构成的包围盒（页面坐标）
      var xs = [e.from.x, e.to.x].concat((e.points || []).map(function (q) { return q.x; }));
      var ys = [e.from.y, e.to.y].concat((e.points || []).map(function (q) { return q.y; }));
      var dW = Math.max.apply(null, xs) - Math.min.apply(null, xs);
      var dH = Math.max.apply(null, ys) - Math.min.apply(null, ys);

      // DOM 侧尺寸（换算回页面尺度）
      var vb = global.Utils.canvasViewBox;
      var scale = vb && vb.w ? (rc.width / Math.max(dW, 1)) : 1;
      // 用长宽比判断是否严重不符（避免依赖 zoom 绝对值）
      var ratioW = dW > 2 ? rc.width / dW : null;
      var ratioH = dH > 2 ? rc.height / dH : null;
      var suspicious = false;
      if (ratioW != null && ratioH != null && ratioW > 0.5 && ratioH > 0.5) {
        var r = ratioW / ratioH;
        if (r > 2.2 || r < 0.45) suspicious = true;
      }
      if (suspicious) {
        bad.push({ id: id, dataW: Math.round(dW), dataH: Math.round(dH),
          domW: Math.round(rc.width), domH: Math.round(rc.height),
          ratio: ratioW && ratioH ? Math.round((ratioW / ratioH) * 100) / 100 : null });
      } else okCount++;
    });
    return { edges: ids.length, consistent: okCount, suspicious: bad.length,
      noDom: noDom.length, list: bad.slice(0, 10), pass: bad.length === 0 && noDom.length === 0 };
  }

  // 保存并等待落库完成
  // 依 api-capability-map.md E1/E2：Ctrl+S -> UI.save() -> saveOnline()；
  // 判据 = save-tip 图标回到 cloud_sync && !saving && 版本一致
  function saveAndVerify(timeoutMs) {
    var timeout = timeoutMs || 15000;
    return new Promise(function (resolve) {
      var SM = global.sendMessage;
      var startVer = SM ? SM.version : null;
      var started = Date.now();

      function hrefOf() {
        var u = document.querySelector('#save-tip use');
        if (!u) return null;
        return u.getAttribute('xlink:href') || u.getAttribute('href');
      }

      // 优先用官方 API；退化为合成 Ctrl+S
      try {
        if (typeof global.UI !== 'undefined' && global.UI && typeof global.UI.save === 'function') {
          global.UI.save();
        } else {
          var ev = new KeyboardEvent('keydown', { keyCode: 83, ctrlKey: true, bubbles: true });
          document.dispatchEvent(ev);
        }
      } catch (e) { /* 继续轮询 */ }

      function tick() {
        var href = hrefOf();
        var saving = SM ? !!SM.saving : false;
        var errSave = SM ? SM.errorSave : 0;
        var ver = SM ? SM.version : null;
        var localVer = null;
        try {
          var fid = (SM && SM.file_id) || '585463292233';
          localVer = localStorage.getItem('version_local_' + fid);
        } catch (e) {}

        // 判据说明（实测修正）：
        //   sendMessage.version 与 localStorage['version_local_*'] 是**两个不同步的计数器**
        //   （观察到 2380 vs 2378，方向不固定），"相等"永远不成立 → 旧判据必然超时。
        //   真正可靠的信号是：图标回到空闲 + 不在保存中 + 无保存错误。
        var idle = (href === '#icon-cloud_sync');
        var noErr = (errSave === 0 || errSave == null);

        if (idle && !saving && noErr) {
          resolve({ ok: true, href: href, saving: saving, version: ver,
            localVersion: localVer, elapsedMs: Date.now() - started, startVersion: startVer });
          return;
        }
        if (Date.now() - started > timeout) {
          resolve({ ok: false, reason: 'timeout', href: href, saving: saving,
            version: ver, localVersion: localVer, elapsedMs: Date.now() - started });
          return;
        }
        setTimeout(tick, 250);
      }
      setTimeout(tick, 400);
    });
  }

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
    suggestChannel: suggestChannel,
    rerouteEdge: rerouteEdge,
    rerouteWorstEdges: rerouteWorstEdges,
    routeAround: routeAround,
    autoRouteAround: autoRouteAround,
    reflowSpacing: reflowSpacing,
    polishLayout: polishLayout,
    createSideCard: createSideCard,
    auditSideCard: auditSideCard,
    detectOverlaps: detectOverlaps,
    ANCHOR: ANCHOR,
    LAYOUT: LAYOUT,
    getViewBox: getViewBox,
    clampIntoView: clampIntoView,
    focusRect: focusRect,
    getPoolRows: getPoolRows,
    createPool: createPool,
    setPoolRows: setPoolRows,
    // 绘制引擎
    STYLE: STYLE,
    SHAPES: SHAPES,
    buildNode: buildNode,
    buildPool: buildPool,
    buildRow: buildRow,
    drawEdge: drawEdge,
    drawDiagram: drawDiagram,
    commit: commit,
    saveAndVerify: saveAndVerify,
    auditEdgeRender: auditEdgeRender
  };

  return global.POBridge;
})(window);
