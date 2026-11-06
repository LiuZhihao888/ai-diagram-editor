# Verdict: NOT a trap — but you are solving the wrong problem, and there is a real trap next door

I tested this empirically rather than reasoning from memory: (a) against the **live ProcessOn editor already open in your Edge**, and (b) against **two controlled raw-CDP Chrome 156 instances** I launched and drove with raw `WebSocket` → `Runtime.evaluate` / `Page.captureScreenshot` / `Emulation.*`. Numbers below are measured, not recalled.

**Bottom line:** hidden-tab *layout* is fine. `scrollLeft`, `getBoundingClientRect()`, `offsetWidth` are all real and correct, so `Utils.canvasViewBox` culls correctly. The trap is elsewhere: **rAF is dead, timers are throttled to 1/s, and `Page.captureScreenshot` on a hidden tab intermittently hangs for 8–28 seconds.**

---

## 1. Will `scrollLeft` / `getBoundingClientRect()` return real values? YES — definitively

Layout in Blink is computed **on demand**, synchronously, whenever JS reads a geometry property. Painting is separate. A tab never having painted does not mean it never laid out.

Controlled test, tab created with `Target.createTarget{background:true}` and **never activated**:

```
visibility: "hidden"
innerWidth: 1037   innerHeight: 799
set scrollLeft=137, scrollTop=42  →  read back: 137 / 42
getBoundingClientRect(): {width: 300, height: 120}
offsetWidth: 300
```

And against your **actual ProcessOn document** (visibilityState `"hidden"`, never focused):

```
designer_layout.scrollLeft : 1730        (real, non-zero)
designer_layout.scrollTop  : 1800
designer_layout.clientWidth/Height : 993 / 639
designer_layout.scrollWidth/Height : 3772 / 3699
jQuery('#designer_layout').width()  : 1007   ← .width() resolves via getComputedStyle → forces flush
Utils.canvasViewBox : {x:2304.35, y:2608.70, w:6117.39, h:4578.26}
Utils.canvasViewBoxUpdate() recomputed → byte-identical to cached value
```

Why this specifically works for ProcessOn — I decompiled the actual minified functions from the live page:

```js
Utils.canvasViewBoxUpdate = function(){
  var e = Designer.config.canvasViewBoxExpandValue,   // = 200
      t = $("#designer_layout"),
      n = t.width(), i = t.height(),                  // jQuery .width() → forced layout
      r = t.scrollLeft(), o = t.scrollTop(),
      a = {x: r - parseInt($("#canvas_container").css("paddingLeft")) - e,
           y: o - parseInt($("#canvas_container").css("paddingTop"))  - e,
           w: n + 2*e, h: i + 2*e};
  return this.canvasViewBox = Utils.restoreScale(a), this.canvasViewBox;
};

Utils.isInCanvasView = function(e){
  if (!Designer.config.isCanvasView || false === e?.attribute?.viewportRenderable) return true;
  var n = Utils.canvasViewBox, i = Utils.getShapeBox(e);
  return Utils.rectCross(n, i);
};
```

Every input is resolved by forced synchronous layout. There is no dependency on paint. **The culling geometry is correct in a hidden tab.**

One real gotcha in that same function: `$("#canvas_container").css("paddingLeft")` returns `"1000px"` (measured). If you ever render while `#canvas_container` is `display:none`, jQuery `.css()` returns `undefined`/`auto`, `parseInt` yields `NaN`, the whole viewBox becomes `NaN`, and `rectCross` silently returns false for everything → **zero shapes rendered, no error thrown**. Guard against NaN, not against hidden tabs.

## 2. Does `visibilityState === 'hidden'` affect anything? Not layout — but it kills four subsystems

Measured in a hidden tab over 3 seconds:

| Subsystem | Visible | Hidden |
|---|---|---|
| `getBoundingClientRect`/`offsetWidth`/`scrollLeft` | ✅ | ✅ correct |
| `getComputedStyle` | ✅ | ✅ |
| `MutationObserver` | ✅ | ✅ fires |
| **`requestAnimationFrame`** | ✅ | ❌ **0 ticks in 3s** |
| **`setInterval`/`setTimeout`** | ✅ | ⚠️ **3 ticks in 3s** (1/s cap) |
| **`IntersectionObserver`** | ✅ | ❌ **0 fires** |
| **`ResizeObserver`** | ✅ | ❌ **0 fires** |
| Canvas 2D draw + `getImageData`/`toDataURL` | ✅ | ✅ (verified pixel `[255,0,0,255]`) |
| `document.fonts.ready` | ✅ | ✅ **resolves**, `fonts.status="loaded"` |

Chrome's own documentation confirms the mechanism ([Background Tabs in Chrome](https://developer.chrome.com/blog/background_tabs)): "Chrome will not call `requestAnimationFrame()` when the page is running in the background. This behavior has been in place since 2011." And: "each individual timer can run at most once per second" (since Chrome 11), plus budget-based throttling introduced in Chrome 57 — after 10 s in background a tab gets a CPU-time budget regenerated at 0.01 s/s, so long tasks can be throttled up to 100× their duration. Exemptions: tabs playing real audio, and WebSocket/WebRTC connections (still 1/s for the timers).

`ResizeObserver`/`IntersectionObserver` being dead is worth emphasizing: both are delivered at **rendering opportunities** in the HTML spec's "update the rendering" step, which never runs for a hidden tab. `MutationObserver` is a microtask and is unaffected — which is why it still fires.

**This is the actual trap for a diagram editor.** Anything that debounces a redraw behind `requestAnimationFrame` or a `ResizeObserver` will simply never run. `renderShape()` itself is safe — I looked at its source and it is fully synchronous (no `requestAnimationFrame`, `setTimeout`, `Promise`, or `async`):

```js
function(e){
  if("linker"!=e.name){
    if(!Utils.isInCanvasView(e)) return $("#"+e.id).remove(), void $("#shape_contour_"+e.id).remove();
    Utils.formattedShape(e);
    var t=$("#"+e.id);
    if(0==t.length){ var n=$("#designer_canvas");
      t=$("<div id='"+e.id+"' class='shape_box'><canvas class='shape_canvas'></canvas></div>").appendTo(n) }
    e.attribute&&e.attribute.collapseBy?t.hide():t.show();
    ...
```

So **driving `Designer.painter.renderShape()` directly over CDP `Runtime.evaluate` is safe** — it runs to completion synchronously, culls correctly, and mutates the DOM. But if ProcessOn's *own* scheduler wraps a later repaint in rAF, that follow-up will silently never happen.

## 3. Forcing layout in a hidden tab — you do not need to

Layout is already computed lazily on demand. There is nothing to "force." All of these work in a hidden tab: `offsetWidth`, `getComputedStyle`, `getClientRects()`, `getBoundingClientRect()`, `scrollLeft` read **and write** (write-back verified stable).

The only failure mode is **no layout box exists** — `display:none` anywhere up the ancestor chain. Measured:

```
display:none parent →  rect {w:0,h:0}, offsetWidth 0, getClientRects() 0
                       scrollWidth/Height 0x0, scrollLeft=137 reads back 0   ← silently clamped
```

Note `getComputedStyle(el).display` still returns `"block"` for the *child* — the computed style of the element itself does not reveal the ancestor's `display:none`. Workaround that does work: keep the element rendered but move it out of view — `position:absolute; left:-99999px`. Verified: rect `300x100`, `offsetWidth 300`, `getClientRects() 1`, `scrollLeft` write-back 137. Never use `display:none` on a container you need to measure.

## 4. `Emulation.setVisibleSize` / `setDeviceMetricsOverride` — yes, they work, but they do not fix what you think

Both apply to hidden tabs and change the layout viewport. Measured on a never-activated background tab:

```
baseline                         innerWidth = 1037, visibility = hidden
Emulation.setVisibleSize(800,600) → innerWidth = 800,  visibility = hidden
Emulation.setDeviceMetricsOverride(1024,768) → innerWidth = 1024, visibility = hidden
setVisibleSize(1234,567)          → innerWidth = 1234
```

Protocol text (authoritative, from `browser_protocol.json`):
- `Emulation.setVisibleSize`: "Resizes the frame/viewport of the page. Note that this does not affect the frame's container (e.g. browser window). Can be used to produce screenshots of the specified size. Not supported on Android."
- `Emulation.setDeviceMetricsOverride`: "Overrides the values of device screen dimensions (window.screen.width, window.screen.height, window.innerWidth, window.innerHeight, and 'device-width'/'device-height'-related CSS media query results)."

Critically: **they give you a viewport, but they do not make the page visible.** `visibilityState` stays `"hidden"` and rAF stays dead. If your goal is "make layout correct," you don't need them — layout was already correct. If your goal is "make animations/lazy-render run," they don't help.

**The command that actually helps is `Emulation.setFocusEmulationEnabled`**, which is undocumented in most tutorials. Measured, same hidden tab, over 3 seconds each:

```
A. hidden baseline                     → rAF 0 ticks,  timers 3,  visibility "hidden"
B. Emulation.setFocusEmulationEnabled(true) → rAF 362 ticks, timers 60, visibility "visible", hasFocus true
C. setFocusEmulationEnabled(false)     → rAF 0 ticks,  timers 3,  visibility "hidden"
```

Protocol text: "Enables or disables simulating a focused and active page." It flips `document.visibilityState` to `"visible"` and `document.hasFocus()` to `true` **without activating the tab or stealing window focus**. This is the single highest-leverage command in this whole area for a background-tab driver.

Also relevant: `Page.setWebLifecycleState` — "Tries to update the web lifecycle state of the page... according to https://github.com/WICG/web-lifecycle/" (states include `frozen`/`active`), useful if you need to prevent Chrome from freezing a long-lived background tab.

## 5. `Page.captureScreenshot` on a background tab — THIS is the real trap

It frequently works, and when it works it captures **fresh** paint (I mutated `document.body.style.background` to green and to magenta, and the very next screenshot showed the new color — no stale frame). But it is **not reliable**. Measured on a never-activated hidden tab, 8 consecutive `Page.captureScreenshot` calls with an 8 s timeout:

```
ok(98ms) TIMEOUT(8s) ok(124ms) TIMEOUT(8s) ok(304ms) TIMEOUT(8s) ok(89ms) TIMEOUT(8s)
```

A strict alternation — roughly 50% hang. With `Emulation.setFocusEmulationEnabled(true)` it did **not** improve (still alternating). Adding a DOM invalidation before each shot made it worse: **5/5 timeouts**. `captureBeyondViewport:true` (full-page) timed out. `fromSurface:false` succeeded.

The same hazard shows up through the browser-extension path used for these very tests — 6/6 succeeded but latency was 116 ms, 895 ms, **27 835 ms**, 16 120 ms, 13 422 ms, 269 ms. No failures, but a 27-second screenshot will blow past almost any timeout you set.

This matches what Puppeteer's maintainer says in [puppeteer#12712](https://github.com/puppeteer/puppeteer/issues/12712): "Inactive tabs in the browser might not get rendered producing no rendered frames to capture a screenshot with... In CDP, you need to do it on your own by calling await `page.bringToFront()`. In general, regular Chrome can only take a PDF or a screenshot [of] the active tab. If you need the parallel execution, you should be using the chrome headless shell. The root cause for this behavior is in the browser's throttling behavior and I am not sure there is a good solution there." A related issue, [#12598](https://github.com/puppeteer/puppeteer/issues/12598), notes `document.fonts.ready` does not resolve in background tabs because rendering is paused — though in my Chrome 156 test it *did* resolve, so that one appears to have been fixed.

`Emulation.setDefaultBackgroundColorOverride` only sets the base background used when compositing/capturing (e.g. to make a transparent page white instead of black in the PNG). It has no bearing on the frame-availability problem.

**Mitigation that actually works:** keep a `Page.startScreencast` session open. A screencast forces the renderer to keep producing frames, which sidesteps the "no new frame" hang. Otherwise, `page.bringToFront()` / `Target.activateTarget` immediately before the shot, and treat screenshots as best-effort-with-retry, never as a reliable synchronous primitive.

## 6. Is "headless-like background rendering in a real browser" reliable? Split verdict

- **Reading and mutating the DOM/model: reliable.** No caveats for the geometry you care about.
- **Screenshotting a hidden tab: unreliable.** 50% hang rate, up to 28 s latency. This is the thing people give up on.
- **Anything driven by rAF / observers / short timers: unreliable** without `setFocusEmulationEnabled`.

The ecosystem's habit of launching a separate headless browser (Playwright/Puppeteer with `headless: 'shell'`) exists specifically because **headless shell has no occlusion/throttling model** — it always composites. Puppeteer's own maintainer recommends the headless shell precisely because "regular Chrome can only take a screenshot [of] the active tab." But headless is a *different* solution to a *different* problem: it cannot attach to your logged-in ProcessOn session.

---

## Your verdict, restated for the ProcessOn job

**Driving a background tab for ProcessOn's layout-dependent rendering is reliable. Do it.** The premise in the question — that layout will be zero because the tab never painted — is **false**. `scrollLeft` is 1730 on your real hidden ProcessOn tab right now, and `Utils.canvasViewBox` computes correctly from it. `renderShape()` is synchronous and safe to call via `Runtime.evaluate`.

**But three things will bite you, in this order:**

1. **Screenshots** — budget for retries and multi-second latency, or open a screencast. Do not build a synchronous "mutate → screenshot → assert" loop.
2. **rAF/observer-driven repaints** — call `Emulation.setFocusEmulationEnabled{enabled:true}` on the target **once at attach time**. It is free, it does not steal window focus, and it converts "hidden tab" into "visible tab" for everything except actual compositing.
3. **`display:none` ancestors** — the only way to get true 0 geometry. If ProcessOn ever hides the canvas panel (e.g. preview mode, collapsed pane), `parseInt(undefined)` → `NaN` → viewBox NaN → **everything silently culled with no error**. Assert `!isNaN(cvb.w) && cvb.w > 0` before trusting a render.

And the meta-lesson: because culling is *destructive* to the DOM (culled shapes get `.remove()`d, not hidden), the DOM is **not** a faithful representation of `window.Model`. Read the model, never infer it from rendered nodes. On the live doc: `Model.orderList.length === 113` but only `61` `.shape_box` nodes existed at one point and `5` at another — a 113-element diagram would look like a 5-element one to any DOM scraper. That is the trap that actually matters here, and it is orthogonal to hidden tabs.

Sources: [Chrome: Background Tabs](https://developer.chrome.com/blog/background_tabs) · [CDP `browser_protocol.json`](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json) (command descriptions quoted verbatim) · [puppeteer#12712](https://github.com/puppeteer/puppeteer/issues/12712) · [puppeteer#12598](https://github.com/puppeteer/puppeteer/issues/12598) · [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API). All numeric claims above are from my own measurements on Edge/Chrome 156, Windows, DPR 2.