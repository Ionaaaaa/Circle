/*!
 * shadow-frame-plugin.js
 * ────────────────────────────────────────────────────────────
 * 拍立得框合成引擎（SMT直播間 / 1200x1200 陰影合成畫布 專用）
 *
 * 移植自阿謙 bn 專案的 polaroid-plugin.js，核心遮罩演算法（從中心洪水填充找
 * 內窗）完全沿用他的做法──比起量測框圖 padding 比例準很多，任何形狀的中空
 * 框都能正確辨識，不用管框是不是有旋轉、圓角、不規則邊緣。
 *
 * ★ 2026-07-14 v2：拿掉「水平／垂直／縮放／照片旋轉」四條滑桿，
 *   改成直接在預覽畫布上操作──拖曳照片本體移動、拖角縮放、拖頂部把手旋轉，
 *   跟 shadow-layout-receiver.js 那個 1200x1200 主畫布的操作邏輯完全一致
 *   （同一套視覺語言：藍色角落控制點縮放、綠色頂部把手旋轉、Shift 吸附15°、
 *   雙擊把手歸零角度）。縮放一律是「同一個倍率同時套在寬高」，不會有些微
 *   跑掉、拉出長寬比不一致的情況。
 *
 * 跟阿謙原版的差異（因為套用情境不同而簡化）：
 *   1. 拿掉 origSrc 壓縮／recipe 重編機制──SMT 這邊素材本來就是透過
 *      shadow-editor-plugin.js 的 slot 機制管理，上傳原圖已經另外存著，
 *      不需要這支外掛自己再存一份「回頭可編輯」的壓縮原圖。
 *      代價：拍立得框內的位置/縮放/旋轉調整目前無法「重新打開上次的調整」，
 *      每次點「調整拍立得」都是從置中、cover縮放、rot=0 重新開始。
 *   2. 對外介面簡化成一個 callback，不回傳 recipe 物件──
 *      壓平成一張圖之後就是普通的 slot 圖片，跟商品去背圖走完全相同的管線
 *      （可貼地陰影、可在1200畫布縮放/旋轉），跟阿謙的設計理念一致：
 *      拍立得只是「商品圖前處理器」，不是獨立的渲染模式。
 *
 * 使用方式：
 *   <script src="js/shadow-frame-plugin.js"></script>
 *   （建議放在 shadow-editor-plugin.js 之前，checkbox 點下去才呼叫得到）
 *
 *   window.ShadowFramePlugin.open(photoDataUrl, function(flatDataUrl){
 *     // flatDataUrl：框+照片已經壓平成一張 PNG，四角透明，直接當成
 *     // 這個 slot 的新圖片使用即可（例如丟進 ShadowEditor.setSlotFromUrl）
 *   });
 *
 * 框圖路徑：預設讀 logos/polaroid-frame.png，可在載入本檔「之前」設定
 *   window.FrameDefaults = { FRAME_URL: '你的路徑' };
 *   （見 frame-defaults.js）來覆寫。
 * ────────────────────────────────────────────────────────────
 */
(function (global) {
  'use strict';

  var cfg = (global.FrameDefaults) || {};
  var DEFAULT_FRAME_URL = cfg.FRAME_URL || 'logos/polaroid-frame.png';
  var SCALE_MIN  = cfg.scaleMin  != null ? cfg.scaleMin  : 0.5;
  var SCALE_MAX  = cfg.scaleMax  != null ? cfg.scaleMax  : 3;
  var Z_INDEX    = cfg.zIndex    != null ? cfg.zIndex    : 2147483000; /* 刻意拉很高，蓋過既有 popup（她的 logo 選單用到 2147483647 這個量級） */
  var ROT_SNAP_DEG = 15; /* 跟主畫布 shadow-layout-receiver.js 的旋轉吸附角度一致 */

  var _frameImg = null;
  var _maskCanvas = null;
  var _win = null; /* {cx,cy,bboxW,bboxH,W,H} 內窗幾何（洪水填充算出來的） */
  var _framePromise = null;

  var _st = null; /* { photo, offX, offY, scale, rot }──offX/offY是相對內窗中心的像素位移 */
  var _onComplete = null;
  var _els = null;
  var _interaction = null;

  /* ── 框圖載入 + 內窗遮罩（洪水填充，完全沿用阿謙的做法）── */
  function ensureFrame() {
    if (_framePromise) return _framePromise;
    _framePromise = new Promise(function (resolve, reject) {
      var url = (global.ShadowFramePlugin && global.ShadowFramePlugin.FRAME_URL) || DEFAULT_FRAME_URL;
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try { buildMask(img); _frameImg = img; resolve(); }
        catch (err) { _framePromise = null; reject(err); }
      };
      img.onerror = function () {
        _framePromise = null;
        reject(new Error('拍立得框載入失敗，請確認檔案存在：' + url));
      };
      img.src = url;
    });
    return _framePromise;
  }

  function buildMask(img) {
    var W = img.naturalWidth, H = img.naturalHeight;
    var tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    var tctx = tmp.getContext('2d');
    tctx.drawImage(img, 0, 0);
    var data = tctx.getImageData(0, 0, W, H).data;
    var TRANS = 40;

    var startIdx = (H >> 1) * W + (W >> 1);
    if (data[startIdx * 4 + 3] >= TRANS) {
      throw new Error('框中心非透明，無法建立內窗遮罩（請使用中空拍立得框）');
    }

    var seen = new Uint8Array(W * H);
    var stack = [startIdx];
    var minX = W, minY = H, maxX = 0, maxY = 0;
    while (stack.length) {
      var idx = stack.pop();
      if (seen[idx]) continue;
      if (data[idx * 4 + 3] >= TRANS) continue;
      seen[idx] = 1;
      var x = idx % W, y = (idx / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0)     stack.push(idx - 1);
      if (x < W - 1) stack.push(idx + 1);
      if (y > 0)     stack.push(idx - W);
      if (y < H - 1) stack.push(idx + W);
    }

    var mc = document.createElement('canvas');
    mc.width = W; mc.height = H;
    var mctx = mc.getContext('2d');
    var mimg = mctx.createImageData(W, H);
    var md = mimg.data;
    for (var i = 0; i < seen.length; i++) {
      if (seen[i]) { var p = i * 4; md[p] = 255; md[p + 1] = 255; md[p + 2] = 255; md[p + 3] = 255; }
    }
    mctx.putImageData(mimg, 0, 0);

    _maskCanvas = mc;
    _win = {
      cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
      bboxW: maxX - minX, bboxH: maxY - minY, W: W, H: H
    };
  }

  /* 目前照片實際尺寸（cover基準 × 使用者縮放），純函式，畫圖跟互動判定共用同一份計算 */
  function photoDims() {
    var pw = _st.photo.naturalWidth, ph = _st.photo.naturalHeight;
    var base = Math.max(_win.bboxW / pw, _win.bboxH / ph); /* cover 基準倍率：同一個倍率套在寬高，不會拉伸變形 */
    return { dw: pw * base * _st.scale, dh: ph * base * _st.scale };
  }
  /* 照片目前的（未旋轉）軸對齊外框──跟主畫布 shadow-layout-receiver.js 的「旋轉解耦」
     原則一致：拖曳/縮放判定永遠用這個未旋轉的框，旋轉只在畫出來的時候套用視覺轉動。
     這裡回傳的是「有色範圍」的框（用 _st.tight 比例往內縮），不是整張圖含透明留白的
     滿版範圍——跟1200畫布同一套邏輯，選取框/控制點只框住實際看得到的內容。 */
  function photoBounds() {
    var d = photoDims();
    var cx = _win.cx + _st.offX, cy = _win.cy + _st.offY;
    var imgLeft = cx - d.dw / 2, imgTop = cy - d.dh / 2;
    var t = _st.tight || { tx: 0, ty: 0, tw: 1, th: 1 };
    var w = t.tw * d.dw, h = t.th * d.dh;
    var left = imgLeft + t.tx * d.dw, top = imgTop + t.ty * d.dh;
    return { left: left, top: top, right: left + w, bottom: top + h, cx: left + w / 2, cy: top + h / 2, dw: w, dh: h };
  }

  /* ── 合成渲染（預覽與最終壓平共用，不含編輯用的控制點疊加層）── */
  function render(ctx) {
    var W = _win.W, H = _win.H;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(_maskCanvas, 0, 0); /* 先鋪窗形狀的遮罩（這時是全白的洞形狀） */

    /* 內容底色：素材本身如果有透明（例如放進來的是去背商品PNG，不是滿版情境照），
       透明的地方要透出這層底色，而不是變成挖空看到後面的東西。
       優先取「目前場景背景色」（跟貼地陰影同一套取樣，見 ShadowPlugin.setBackground），
       這樣拍立得的紙底色會跟整體畫面色調一致；還沒設定過場景背景（或這個版位
       沒有接 ShadowPlugin）就退回白色。 */
    var fillRGB = (global.ShadowPlugin && global.ShadowPlugin.getRawBackgroundRGB && global.ShadowPlugin.getRawBackgroundRGB()) || '255,255,255';
    ctx.save();
    ctx.globalCompositeOperation = 'source-in'; /* 只鋪在剛剛畫的洞形狀範圍內 */
    ctx.fillStyle = 'rgb(' + fillRGB + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    if (_st && _st.photo) {
      var d = photoDims();
      ctx.save();
      ctx.translate(_win.cx + _st.offX, _win.cy + _st.offY);
      ctx.rotate(_st.rot * Math.PI / 180);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(_st.photo, -d.dw / 2, -d.dh / 2, d.dw, d.dh);
      ctx.restore();
    }

    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(_maskCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(_frameImg, 0, 0); /* 白邊蓋最上層 */
  }

  /* ── 編輯用的控制點疊加層（只在預覽畫布上畫，壓平輸出時不會用到這個函式）── */
  function rotateHandlePos(b) {
    var offset = Math.max(20, _win.W * 0.05);
    return { x: (b.left + b.right) / 2, y: b.top - offset };
  }
  function drawHandles(ctx) {
    var b = photoBounds();
    ctx.save();
    ctx.strokeStyle = '#4a90e2';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.left, b.top, b.dw, b.dh);
    var hs = Math.max(9, _win.W * 0.02);
    [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]].forEach(function (c) {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#4a90e2'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(c[0] - hs / 2, c[1] - hs / 2, hs, hs); ctx.fill(); ctx.stroke();
    });
    var rp = rotateHandlePos(b);
    ctx.beginPath();
    ctx.moveTo((b.left + b.right) / 2, b.top);
    ctx.lineTo(rp.x, rp.y);
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.stroke();
    var hr = Math.max(8, _win.W * 0.016);
    ctx.beginPath(); ctx.arc(rp.x, rp.y, hr, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

    if (_interaction && _interaction.mode === 'rotate') {
      var deg = Math.round(_st.rot);
      ctx.font = '13px sans-serif';
      var label = deg + '°';
      var tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(13,16,24,.9)';
      ctx.fillRect(rp.x - tw / 2 - 6, rp.y - hr - 24, tw + 12, 18);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, rp.x, rp.y - hr - 15);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }
  function redrawPreview() {
    if (!_els) return;
    var ctx = _els.canvas.getContext('2d');
    render(ctx);
    drawHandles(ctx);
  }

  function flatten() {
    var c = document.createElement('canvas');
    c.width = _win.W; c.height = _win.H;
    render(c.getContext('2d')); /* 不含控制點疊加層，壓平輸出永遠是乾淨的 */
    return c.toDataURL('image/png');
  }

  function loadImg(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = function () { rej(new Error('照片載入失敗')); };
      i.src = src;
    });
  }

  /* 掃描圖片，算出「有色（不透明）部分」佔原圖的比例範圍 {tx,ty,tw,th}（0~1）——
     跟主畫布 shadow-layout-receiver.js 的 calcTightBoundsRatio() 同一套演算法，
     這樣拍立得彈窗裡點選/拖曳照片的判定範圍，才會跟1200畫布一致：只選取
     有色的部分，不會連商品去背圖四周的透明留白都算進可點選範圍。 */
  function calcTightBoundsRatio(img) {
    try {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return { tx: 0, ty: 0, tw: 1, th: 1 };
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var cx = c.getContext('2d');
      cx.drawImage(img, 0, 0);
      var data = cx.getImageData(0, 0, w, h).data;
      var minX = w, minY = h, maxX = 0, maxY = 0, found = false;
      var step = Math.max(1, Math.floor(Math.max(w, h) / 300)); // 大圖跳著取樣，避免太慢
      for (var y = 0; y < h; y += step) {
        for (var x = 0; x < w; x += step) {
          var a = data[(y * w + x) * 4 + 3];
          if (a > 10) {
            found = true;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      if (!found) return { tx: 0, ty: 0, tw: 1, th: 1 };
      return { tx: minX / w, ty: minY / h, tw: (maxX - minX + step) / w, th: (maxY - minY + step) / h };
    } catch (e) {
      return { tx: 0, ty: 0, tw: 1, th: 1 };
    }
  }

  /* ── 彈窗 UI：預覽畫布 + 直接操作，不再用滑桿 ── */
  function injectStyle() {
    if (document.getElementById('sfp-style')) return;
    var s = document.createElement('style');
    s.id = 'sfp-style';
    s.textContent = [
      '#sfp-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:' + Z_INDEX + ';align-items:center;justify-content:center;backdrop-filter:blur(4px)}',
      '#sfp-modal.show{display:flex}',
      '.sfp-box{background:#1e1e1e;border:1px solid #333;border-radius:14px;width:min(480px,92vw);max-height:92vh;overflow:auto;padding:18px 20px;color:#e0e0e0;font-size:13px}',
      '.sfp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}',
      '.sfp-head h3{margin:0;font-size:15px}',
      '.sfp-close{background:none;border:none;color:#999;font-size:22px;cursor:pointer;line-height:1}',
      '.sfp-hint{font-size:11px;color:#888;margin-bottom:10px}',
      '.sfp-preview{background:conic-gradient(#2a2a2a 25%,#242424 0 50%,#2a2a2a 0 75%,#242424 0) 0/24px 24px;border-radius:10px;display:flex;align-items:center;justify-content:center;padding:10px;touch-action:none}',
      '.sfp-preview canvas{max-width:100%;max-height:380px;height:auto;display:block;cursor:grab}',
      '.sfp-toolrow{display:flex;align-items:center;margin-top:10px}',
      '.sfp-reset{background:none;border:none;color:#ee4d2d;font-size:12px;cursor:pointer;margin-left:auto}',
      '.sfp-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
      '.sfp-foot button{padding:8px 16px;border-radius:8px;border:1px solid #444;background:#2a2a2a;color:#ddd;cursor:pointer;font-size:13px}',
      '.sfp-foot .primary{background:#ee4d2d;border-color:#ee4d2d;color:#fff;font-weight:700}'
    ].join('');
    document.head.appendChild(s);
  }

  function buildModal() {
    if (document.getElementById('sfp-modal')) return;
    injectStyle();
    var el = document.createElement('div');
    el.id = 'sfp-modal';
    el.innerHTML = [
      '<div class="sfp-box">',
      '  <div class="sfp-head"><h3>拍立得構圖調整</h3><button class="sfp-close" id="sfp-x">×</button></div>',
      '  <div class="sfp-hint">拖曳照片調整位置・拖角縮放・拖上方綠點旋轉（按住 Shift 可 15° 吸附）</div>',
      '  <div class="sfp-preview"><canvas id="sfp-canvas"></canvas></div>',
      '  <div class="sfp-toolrow"><button class="sfp-reset" id="sfp-reset">重設</button></div>',
      '  <div class="sfp-foot">',
      '    <button id="sfp-cancel">取消</button>',
      '    <button class="primary" id="sfp-ok">套用</button>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(el);
    bindEvents(el);
  }

  function pos(e) {
    var rect = _els.canvas.getBoundingClientRect();
    var scaleX = _els.canvas.width / rect.width, scaleY = _els.canvas.height / rect.height;
    var p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - rect.left) * scaleX, y: (p.clientY - rect.top) * scaleY };
  }
  function hitTestRotate(p) {
    var b = photoBounds();
    var rp = rotateHandlePos(b);
    var hr = Math.max(8, _win.W * 0.016) * 1.8;
    return Math.hypot(p.x - rp.x, p.y - rp.y) <= hr;
  }
  function hitTestCorner(p) {
    var b = photoBounds();
    var hs = Math.max(9, _win.W * 0.02) * 1.6;
    var corners = { tl: [b.left, b.top], tr: [b.right, b.top], bl: [b.left, b.bottom], br: [b.right, b.bottom] };
    for (var k in corners) { var c = corners[k]; if (Math.abs(p.x - c[0]) <= hs && Math.abs(p.y - c[1]) <= hs) return k; }
    return null;
  }
  function hitTestBody(p) {
    var b = photoBounds();
    return p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
  }

  function bindEvents(el) {
    _els = { modal: el, canvas: el.querySelector('#sfp-canvas'), ok: el.querySelector('#sfp-ok') };
    el.querySelector('#sfp-x').addEventListener('click', close);
    el.querySelector('#sfp-cancel').addEventListener('click', close);
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    el.querySelector('#sfp-reset').addEventListener('click', function () {
      _st.offX = 0; _st.offY = 0; _st.scale = 1; _st.rot = 0;
      redrawPreview();
    });
    _els.ok.addEventListener('click', function () {
      if (!_st || !_st.photo) return;
      var flatSrc = flatten();
      var cb = _onComplete;
      close();
      if (typeof cb === 'function') cb(flatSrc);
    });

    var canvas = _els.canvas;
    canvas.addEventListener('pointerdown', function (e) {
      var p = pos(e);
      if (hitTestRotate(p)) {
        var b = photoBounds();
        var center = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
        var startAngle = Math.atan2(p.y - center.y, p.x - center.x) * 180 / Math.PI;
        _interaction = { mode: 'rotate', center: center, startAngle: startAngle, baseRot: _st.rot };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      var corner = hitTestCorner(p);
      if (corner) {
        _interaction = { mode: 'resize', corner: corner, start: { offX: _st.offX, offY: _st.offY, scale: _st.scale } };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (hitTestBody(p)) {
        _interaction = { mode: 'move', startPointer: p, start: { offX: _st.offX, offY: _st.offY } };
        canvas.style.cursor = 'grabbing';
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('dblclick', function (e) {
      if (hitTestRotate(pos(e))) { _st.rot = 0; redrawPreview(); }
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!_interaction) return;
      e.preventDefault();
      var p = pos(e);
      if (_interaction.mode === 'move') {
        _st.offX = _interaction.start.offX + (p.x - _interaction.startPointer.x);
        _st.offY = _interaction.start.offY + (p.y - _interaction.startPointer.y);
      } else if (_interaction.mode === 'resize') {
        /* 旋轉解耦：一律用未旋轉的軸對齊框算縮放，手感固定，跟 rot 無關。
           以縮放開始那一刻的對角角點當錨點，錨點固定不動，中心點(offX/offY)
           跟著縮放結果反推回去，這樣拖哪個角、那個角就會固定住，
           不會整張圖從中心對稱縮放讓人抓不到「原點」在哪。 */
        var s0 = _interaction.start;
        var pw = _st.photo.naturalWidth, ph = _st.photo.naturalHeight;
        var base = Math.max(_win.bboxW / pw, _win.bboxH / ph);
        var baseCx = _win.cx + s0.offX, baseCy = _win.cy + s0.offY;
        var startDw = pw * base * s0.scale, startDh = ph * base * s0.scale;
        var b0 = { left: baseCx - startDw / 2, top: baseCy - startDh / 2, right: baseCx + startDw / 2, bottom: baseCy + startDh / 2 };
        var anchor;
        if (_interaction.corner === 'br') anchor = [b0.left, b0.top];
        else if (_interaction.corner === 'bl') anchor = [b0.right, b0.top];
        else if (_interaction.corner === 'tr') anchor = [b0.left, b0.bottom];
        else anchor = [b0.right, b0.bottom];
        var newW = Math.abs(p.x - anchor[0]);
        var newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, newW / (pw * base)));
        var newDw = pw * base * newScale, newDh = ph * base * newScale;
        var newCx = (_interaction.corner === 'br' || _interaction.corner === 'tr') ? anchor[0] + newDw / 2 : anchor[0] - newDw / 2;
        var newCy = (_interaction.corner === 'bl' || _interaction.corner === 'br') ? anchor[1] + newDh / 2 : anchor[1] - newDh / 2;
        _st.scale = newScale;
        _st.offX = newCx - _win.cx;
        _st.offY = newCy - _win.cy;
      } else if (_interaction.mode === 'rotate') {
        var curAngle = Math.atan2(p.y - _interaction.center.y, p.x - _interaction.center.x) * 180 / Math.PI;
        var next = _interaction.baseRot + (curAngle - _interaction.startAngle);
        next = ((next % 360) + 540) % 360 - 180;
        if (e.shiftKey) next = Math.round(next / ROT_SNAP_DEG) * ROT_SNAP_DEG;
        _st.rot = next;
      }
      redrawPreview();
    });
    window.addEventListener('pointerup', function () {
      _interaction = null;
      canvas.style.cursor = 'grab';
    });
  }

  function close() {
    if (_els) _els.modal.classList.remove('show');
    _interaction = null;
    _onComplete = null;
  }

  /* ── 對外入口：open(photoDataUrl, onComplete) ──
     photoDataUrl：要放進框裡的原圖（通常是這個 slot 目前的 dataURL）
     onComplete(flatDataUrl)：使用者按「套用」後呼叫，flatDataUrl 是壓平好的 PNG */
  function open(photoDataUrl, onComplete) {
    buildModal();
    _onComplete = onComplete;
    _st = { photo: null, offX: 0, offY: 0, scale: 1, rot: 0 };

    ensureFrame().then(function () {
      return loadImg(photoDataUrl);
    }).then(function (img) {
      _st.photo = img;
      _st.tight = calcTightBoundsRatio(img);
      if (_els.canvas.width !== _win.W) { _els.canvas.width = _win.W; _els.canvas.height = _win.H; }
      _els.modal.classList.add('show');
      redrawPreview();
    }).catch(function (err) {
      alert(err.message || '拍立得框載入失敗');
    });
  }

  global.ShadowFramePlugin = global.ShadowFramePlugin || {};
  global.ShadowFramePlugin.FRAME_URL = global.ShadowFramePlugin.FRAME_URL || DEFAULT_FRAME_URL;
  global.ShadowFramePlugin.open = open;

})(window);
