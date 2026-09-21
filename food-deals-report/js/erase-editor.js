'use strict';
/*!
 * erase-editor.js  ——  圖檔去背編輯器（獨立模組，不依賴任何其他檔案）
 * ------------------------------------------------------------------
 * 從 pet-frenzy 的 editor-plugin.js（HBN Product Editor Plugin）抽出來的
 * 「去背」功能，改成可以在任何專案獨立使用：
 *   - 不需要 .editor-item / dataset / bg.png / 跳出.png 這些舊專案的東西
 *   - CSS 跟 HTML 都是自己注入，class 一律加前綴 skbn-ee-，不會跟其他樣式打架
 *   - 沒有影子編輯（影子由各專案自己的影子引擎處理）
 *
 * 功能：橡皮擦（筆刷大小可調）、裁切、自動去背（取四角平均色）、
 *       點選顏色去背（容差可調）、重作、回上一步/下一步(Ctrl+Z / Ctrl+Y)、取消、完成套用。
 *
 * 用法：
 *   <script src="js/erase-editor.js"></script>
 *
 *   SkbnEraseEditor.open(imageSrc, {
 *     title: '商品圖去背',                 // 選填，視窗標題
 *     onApply: function(result){           // 按「完成套用」時呼叫
 *       // result.dataUrl      去背後的 PNG（data URL）
 *       // result.width/height 去背後尺寸
 *       // result.sizeChanged  有裁切、尺寸跟原圖不同時為 true
 *       // result.originalWidth/originalHeight
 *     },
 *     onCancel: function(){},              // 選填，取消/關閉時呼叫
 *     onError: function(msg){}             // 選填，圖片讀不到時呼叫（預設用 alert 顯示）
 *   });
 *
 *   imageSrc 可以是 data URL、blob URL、或同網域的圖檔路徑。
 *   注意：用 file:// 直接開網頁、又載入外部檔案路徑的圖時，瀏覽器會把 canvas 視為
 *   「被污染」而無法讀寫像素；從 http(s):// 開（例如 VS Code Live Server）就沒有這個問題。
 */
(function(){
  if(window.SkbnEraseEditor) return;

  var CSS = [
    '.skbn-ee-modal{position:fixed;inset:0;background:rgba(0,0,0,.66);z-index:100050;display:none;align-items:center;justify-content:center;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI","Noto Sans TC","Microsoft JhengHei",sans-serif;}',
    '.skbn-ee-modal.open{display:flex;}',
    '.skbn-ee-panel{width:min(96vw,1120px);height:min(94vh,860px);background:#111827;color:#e5e7eb;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.45);display:grid;grid-template-rows:auto 1fr auto;overflow:hidden;border:1px solid rgba(255,255,255,.12);}',
    '.skbn-ee-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px;border-bottom:1px solid rgba(255,255,255,.12);background:#0f172a;}',
    '.skbn-ee-title{font-weight:800;font-size:14px;color:#f8fafc;margin-right:6px;}',
    '.skbn-ee-modal button{appearance:none;border:1px solid rgba(255,255,255,.16);background:#1f2937;color:#e5e7eb;padding:8px 11px;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;}',
    '.skbn-ee-modal button.active{border-color:#38bdf8;background:rgba(56,189,248,.18);}',
    '.skbn-ee-modal button.danger{border-color:rgba(251,113,133,.6);color:#fecdd3;}',
    '.skbn-ee-modal button.primary{background:#2563eb;border-color:#2563eb;color:#fff;}',
    '.skbn-ee-toolbar label{display:inline-flex;align-items:center;gap:6px;color:#94a3b8;font-size:13px;}',
    '.skbn-ee-toolbar input[type=range]{width:110px;}',
    '.skbn-ee-group{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;}',
    '.skbn-ee-sep{width:1px;height:28px;background:rgba(255,255,255,.16);margin:0 2px;}',
    '.skbn-ee-history{margin-left:auto;display:inline-flex;align-items:center;gap:6px;padding-left:12px;border-left:1px solid rgba(255,255,255,.18);}',
    '.skbn-ee-history button{background:#fff !important;color:#111827 !important;border-color:#fff !important;}',
    '.skbn-ee-history button:disabled{opacity:.35;}',
    '.skbn-ee-chip{width:18px;height:18px;border-radius:99px;border:1px solid rgba(255,255,255,.3);background:transparent;display:inline-block;}',
    '.skbn-ee-workspace{position:relative;min-height:0;margin:12px;border-radius:16px;border:1px solid #d1d5db;overflow:hidden;display:flex;align-items:center;justify-content:center;background-color:#fff;background-image:linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0;}',
    '.skbn-ee-workspace canvas{position:relative;z-index:2;display:block;max-width:100%;max-height:100%;width:auto;height:auto;touch-action:none;border-radius:6px;}',
    '.skbn-ee-status{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.12);color:#94a3b8;font-size:13px;}',
    '.skbn-ee-status .skbn-ee-link{border:0;background:#fff;color:#111827;padding:6px 10px;border-radius:8px;}',
    '.skbn-ee-crop{position:absolute;border:2px solid #2563eb;background:rgba(37,99,235,.08);display:none;z-index:6;pointer-events:none;}',
    '.skbn-ee-edge{position:absolute;background:rgba(37,99,235,.95);pointer-events:auto;}',
    '.skbn-ee-edge.top,.skbn-ee-edge.bottom{left:-8px;right:-8px;height:12px;cursor:ns-resize;}',
    '.skbn-ee-edge.left,.skbn-ee-edge.right{top:-8px;bottom:-8px;width:12px;cursor:ew-resize;}',
    '.skbn-ee-edge.top{top:-7px}.skbn-ee-edge.bottom{bottom:-7px}.skbn-ee-edge.left{left:-7px}.skbn-ee-edge.right{right:-7px}',
    '.skbn-ee-edge:after{content:"";position:absolute;background:#fff;border-radius:99px;box-shadow:0 1px 4px rgba(0,0,0,.25);}',
    '.skbn-ee-edge.top:after,.skbn-ee-edge.bottom:after{width:42px;height:4px;left:50%;top:50%;transform:translate(-50%,-50%);}',
    '.skbn-ee-edge.left:after,.skbn-ee-edge.right:after{width:4px;height:42px;left:50%;top:50%;transform:translate(-50%,-50%);}',
    '.skbn-ee-brush{position:absolute;border:2px solid rgba(255,255,255,.95);border-radius:99px;pointer-events:none;display:none;transform:translate(-50%,-50%);box-shadow:0 0 0 1px rgba(15,23,42,.8),0 0 14px rgba(56,189,248,.45);background:rgba(56,189,248,.08);z-index:8;}',
    '.skbn-ee-modal button:disabled,.skbn-ee-toolbar input:disabled{opacity:.38;cursor:not-allowed;filter:grayscale(.8);}',
    '.skbn-ee-toolbar label.is-disabled{opacity:.38;cursor:not-allowed;}',
    '.skbn-ee-modal.crop-locked .skbn-ee-panel{box-shadow:0 0 0 3px rgba(249,115,22,.35),0 24px 70px rgba(0,0,0,.45);}',
    '.skbn-ee-modal.crop-locked [data-act="applyCrop"]{border-color:#fb923c !important;background:rgba(249,115,22,.18) !important;color:#fed7aa !important;}',
    '.skbn-ee-crop-help{display:none;color:#fed7aa;background:rgba(249,115,22,.14);border:1px solid rgba(249,115,22,.45);border-radius:999px;padding:5px 9px;font-size:12px;font-weight:700;}',
    '.skbn-ee-modal.crop-locked .skbn-ee-crop-help{display:inline-flex;}'
  ].join('\n');

  var HTML = [
    '<div class="skbn-ee-panel">',
    '  <div class="skbn-ee-toolbar">',
    '    <span class="skbn-ee-title" data-role="title">去背</span>',
    '    <span class="skbn-ee-group">',
    '      <button data-act="eraser">橡皮擦</button>',
    '      <label>大小 <strong data-role="brushVal">32px</strong><input data-role="brush" type="range" min="5" max="90" value="32"></label>',
    '    </span>',
    '    <button data-act="crop">裁切模式</button>',
    '    <button data-act="applyCrop">套用裁切</button>',
    '    <span class="skbn-ee-crop-help">請按「套用裁切」完成裁切後，其他工具才會恢復</span>',
    '    <span class="skbn-ee-sep"></span>',
    '    <button data-act="autoBg">自動去背</button>',
    '    <span class="skbn-ee-group">',
    '      <button data-act="pickBg">點選顏色去背</button>',
    '      <label>選取色 <span data-role="chip" class="skbn-ee-chip"></span></label>',
    '      <label>去背容差 <input data-role="tol" type="range" min="10" max="120" value="48"></label>',
    '    </span>',
    '    <button data-act="reset" class="danger">重作</button>',
    '    <span class="skbn-ee-history">',
    '      <button data-act="undo">回上一步</button>',
    '      <button data-act="redo">下一步</button>',
    '    </span>',
    '  </div>',
    '  <div class="skbn-ee-workspace" data-role="wrap">',
    '    <canvas data-role="canvas"></canvas>',
    '    <div class="skbn-ee-crop" data-role="cropBox">',
    '      <div class="skbn-ee-edge top" data-edge="top"></div>',
    '      <div class="skbn-ee-edge right" data-edge="right"></div>',
    '      <div class="skbn-ee-edge bottom" data-edge="bottom"></div>',
    '      <div class="skbn-ee-edge left" data-edge="left"></div>',
    '    </div>',
    '    <div class="skbn-ee-brush" data-role="brushPreview"></div>',
    '  </div>',
    '  <div class="skbn-ee-status">',
    '    <button data-act="photoroom" class="skbn-ee-link">最強去背工具連結</button>',
    '    <span data-role="status">Ready</span>',
    '    <span>',
    '      <button data-act="cancel" class="danger">取消</button>',
    '      <button data-act="apply" class="primary">完成套用</button>',
    '    </span>',
    '  </div>',
    '</div>'
  ].join('\n');

  var modal = null, api = null;

  function ensureModal(){
    if(modal) return modal;
    var style = document.createElement('style');
    style.id = 'skbn-erase-editor-style';
    style.textContent = CSS;
    document.head.appendChild(style);
    modal = document.createElement('div');
    modal.id = 'skbnEraseEditor';
    modal.className = 'skbn-ee-modal';
    modal.innerHTML = HTML;
    document.body.appendChild(modal);
    return modal;
  }

  function makeEditor(){
    var m = ensureModal();
    function $(sel){ return m.querySelector(sel); }
    var canvas = $('[data-role="canvas"]');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var wrap = $('[data-role="wrap"]');
    var cropBox = $('[data-role="cropBox"]');
    var brushPreview = $('[data-role="brushPreview"]');
    var brush = $('[data-role="brush"]');
    var brushVal = $('[data-role="brushVal"]');
    var tol = $('[data-role="tol"]');
    var chip = $('[data-role="chip"]');
    var status = $('[data-role="status"]');
    var titleEl = $('[data-role="title"]');

    var opts = {}, originalSrc = '', originalW = 0, originalH = 0;
    var mode = 'none', isDrawing = false, cropStart = null, cropEnd = null, activeCropEdge = null;
    var lastPointerPoint = null, pickedBgColor = null;
    var undoStack = [], redoStack = [];
    var minCropSize = 20;

    function setStatus(t){ status.textContent = t; }
    function hasImage(){ return canvas.width > 0 && canvas.height > 0; }

    function safeImageData(x, y, w, h){
      try{ return ctx.getImageData(x, y, w, h); }
      catch(e){
        setStatus('這張圖無法編輯（瀏覽器的跨來源限制）。請改用 http:// 開啟編輯器，或先上傳圖檔再去背。');
        return null;
      }
    }

    function setActive(){
      Array.prototype.forEach.call(m.querySelectorAll('[data-act]'), function(b){ b.classList.remove('active'); });
      var map = { eraser:'eraser', crop:'crop', removeBgPick:'pickBg' };
      var act = map[mode];
      if(act){ var b = m.querySelector('[data-act="' + act + '"]'); if(b) b.classList.add('active'); }
      updateCropFocusState();
    }

    function updateCropFocusState(){
      var locked = mode === 'crop';
      m.classList.toggle('crop-locked', locked);
      Array.prototype.forEach.call(m.querySelectorAll('button[data-act]'), function(btn){
        var act = btn.dataset.act;
        if(locked) btn.disabled = act !== 'applyCrop';
        else btn.disabled = act === 'applyCrop';
      });
      // 取消/完成套用在裁切模式下也鎖住，避免裁切框還沒套用就直接離開
      Array.prototype.forEach.call(m.querySelectorAll('.skbn-ee-toolbar input'), function(input){
        input.disabled = locked;
        var label = input.closest('label');
        if(label) label.classList.toggle('is-disabled', locked);
      });
      updateHistoryButtons();
    }

    function setMode(next){
      mode = mode === next ? 'none' : next;
      if(mode === 'crop' && hasImage()){
        if(!cropStart || !cropEnd) resetCropToImageBounds();
        updateCropBox();
      }else{
        cropBox.style.display = 'none';
        activeCropEdge = null;
      }
      setActive();
      updateBrushPreview(lastPointerPoint);
      if(mode === 'eraser') setStatus('橡皮擦模式：拖曳圖片即可擦除，白色圓圈為目前橡皮擦範圍');
      else if(mode === 'crop') setStatus('裁切模式：拖曳四邊調整範圍，完成後請按橘框「套用裁切」。');
      else if(mode === 'removeBgPick') setStatus('點選顏色去背：請在圖片上點選想去除的背景顏色（容差可調）');
      else setStatus('Ready');
    }

    function updateCanvasCssSize(){
      if(!hasImage()) return;
      var pad = 28;
      var maxW = Math.max(100, wrap.clientWidth - pad);
      var maxH = Math.max(100, wrap.clientHeight - pad);
      var scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
      canvas.style.width = Math.round(canvas.width * scale) + 'px';
      canvas.style.height = Math.round(canvas.height * scale) + 'px';
      updateCropBox();
      updateBrushPreview(lastPointerPoint);
    }
    if(window.ResizeObserver) new ResizeObserver(updateCanvasCssSize).observe(wrap);
    else window.addEventListener('resize', updateCanvasCssSize);

    function updateHistoryButtons(){
      var u = m.querySelector('[data-act="undo"]'), r = m.querySelector('[data-act="redo"]');
      if(mode === 'crop') return; // 裁切模式下由 updateCropFocusState 統一鎖定
      if(u) u.disabled = undoStack.length <= 1;
      if(r) r.disabled = redoStack.length === 0;
    }

    function pushHistory(){
      if(!hasImage()) return;
      undoStack.push(canvas.toDataURL('image/png'));
      if(undoStack.length > 30) undoStack.shift();
      redoStack.length = 0;
      updateHistoryButtons();
    }

    function restoreFrom(url){
      var img = new Image();
      img.onload = function(){
        canvas.width = img.width; canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        updateCanvasCssSize();
        updateHistoryButtons();
      };
      img.src = url;
    }

    function getCanvasPoint(evt){
      var rect = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(canvas.width, (evt.clientX - rect.left) * canvas.width / rect.width)),
        y: Math.max(0, Math.min(canvas.height, (evt.clientY - rect.top) * canvas.height / rect.height))
      };
    }

    function updateBrushPreview(p){
      if(!hasImage() || mode !== 'eraser' || !p){ brushPreview.style.display = 'none'; return; }
      var rect = canvas.getBoundingClientRect();
      var wrect = wrap.getBoundingClientRect();
      var scaleX = rect.width / canvas.width;
      var scaleY = rect.height / canvas.height;
      var size = Number(brush.value);
      var d = Math.max(2, size * ((scaleX + scaleY) / 2));
      brushPreview.style.width = d + 'px';
      brushPreview.style.height = d + 'px';
      brushPreview.style.left = (rect.left - wrect.left + p.x * scaleX) + 'px';
      brushPreview.style.top = (rect.top - wrect.top + p.y * scaleY) + 'px';
      brushPreview.style.display = 'block';
    }
    brush.addEventListener('input', function(){ brushVal.textContent = brush.value + 'px'; updateBrushPreview(lastPointerPoint); });

    function eraseAt(p){
      var size = Number(brush.value);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 滑鼠移動太快時兩點之間會斷開，補一條線
    function eraseLine(a, b){
      var size = Number(brush.value);
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round'; ctx.lineWidth = size;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    }

    function resetCropToImageBounds(){
      cropStart = { x: 0, y: 0 };
      cropEnd = { x: canvas.width, y: canvas.height };
    }

    function updateCropBox(){
      if(!cropStart || !cropEnd || mode !== 'crop') return;
      var rect = canvas.getBoundingClientRect();
      var wrect = wrap.getBoundingClientRect();
      var x1 = Math.min(cropStart.x, cropEnd.x), y1 = Math.min(cropStart.y, cropEnd.y);
      var x2 = Math.max(cropStart.x, cropEnd.x), y2 = Math.max(cropStart.y, cropEnd.y);
      var sx = rect.width / canvas.width, sy = rect.height / canvas.height;
      cropBox.style.left = (rect.left - wrect.left + x1 * sx) + 'px';
      cropBox.style.top = (rect.top - wrect.top + y1 * sy) + 'px';
      cropBox.style.width = Math.max(2, (x2 - x1) * sx) + 'px';
      cropBox.style.height = Math.max(2, (y2 - y1) * sy) + 'px';
      cropBox.style.display = 'block';
    }

    function resizeCropByEdge(edge, p){
      var left = Math.min(cropStart.x, cropEnd.x), right = Math.max(cropStart.x, cropEnd.x);
      var top = Math.min(cropStart.y, cropEnd.y), bottom = Math.max(cropStart.y, cropEnd.y);
      var l = left, r = right, t = top, b = bottom;
      if(edge === 'left') l = Math.min(Math.max(0, p.x), right - minCropSize);
      if(edge === 'right') r = Math.max(Math.min(canvas.width, p.x), left + minCropSize);
      if(edge === 'top') t = Math.min(Math.max(0, p.y), bottom - minCropSize);
      if(edge === 'bottom') b = Math.max(Math.min(canvas.height, p.y), top + minCropSize);
      cropStart = { x: l, y: t }; cropEnd = { x: r, y: b };
    }

    function colorDistance(a, b){
      var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    }
    function setPickedColor(c){
      pickedBgColor = [c[0], c[1], c[2]];
      chip.style.background = 'rgb(' + pickedBgColor[0] + ',' + pickedBgColor[1] + ',' + pickedBgColor[2] + ')';
    }

    function removeBgByColor(bg){
      if(!hasImage()) return false;
      var imageData = safeImageData(0, 0, canvas.width, canvas.height);
      if(!imageData) return false;
      pushHistory();
      var tolerance = Number(tol.value);
      var d = imageData.data;
      for(var i = 0; i < d.length; i += 4){
        var dist = colorDistance([d[i], d[i + 1], d[i + 2]], bg);
        if(dist < tolerance) d[i + 3] = 0;
        else if(dist < tolerance + 22) d[i + 3] = Math.max(0, d[i + 3] * ((dist - tolerance) / 22));
      }
      ctx.putImageData(imageData, 0, 0);
      return true;
    }

    function applyCrop(){
      if(!hasImage() || !cropStart || !cropEnd) return;
      var x = Math.round(Math.min(cropStart.x, cropEnd.x));
      var y = Math.round(Math.min(cropStart.y, cropEnd.y));
      var w = Math.round(Math.abs(cropEnd.x - cropStart.x));
      var h = Math.round(Math.abs(cropEnd.y - cropStart.y));
      if(w < 5 || h < 5) return setStatus('裁切範圍太小');
      var imageData = safeImageData(x, y, w, h);
      if(!imageData) return;
      pushHistory();
      canvas.width = w; canvas.height = h;
      ctx.putImageData(imageData, 0, 0);
      cropStart = cropEnd = null; cropBox.style.display = 'none';
      setMode('none');
      updateCanvasCssSize();
      setStatus('裁切完成');
    }

    function loadInto(src, done){
      var img = new Image();
      img.onload = function(){
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        done && done(true);
      };
      img.onerror = function(){ done && done(false); };
      img.src = src;
    }

    function resetToOriginal(){
      if(!originalSrc) return;
      loadInto(originalSrc, function(ok){
        if(!ok) return;
        undoStack = []; redoStack = [];
        pushHistory();
        cropStart = cropEnd = null;
        pickedBgColor = null;
        chip.style.background = 'transparent';
        mode = 'none'; cropBox.style.display = 'none';
        setActive();
        updateCanvasCssSize();
        updateHistoryButtons();
        setStatus('已還原成原圖');
      });
    }

    function close(cancelled){
      m.classList.remove('open');
      mode = 'none'; cropBox.style.display = 'none';
      var cb = cancelled ? opts.onCancel : null;
      originalSrc = '';
      opts = {};
      if(typeof cb === 'function') cb();
    }

    function doApply(){
      if(!hasImage()) return;
      var url;
      try{ url = canvas.toDataURL('image/png'); }
      catch(e){ setStatus('無法輸出（瀏覽器的跨來源限制）。請改用 http:// 開啟編輯器。'); return; }
      var onApply = opts.onApply;
      var result = {
        dataUrl: url,
        width: canvas.width, height: canvas.height,
        originalWidth: originalW, originalHeight: originalH,
        sizeChanged: canvas.width !== originalW || canvas.height !== originalH
      };
      close(false);
      if(typeof onApply === 'function') onApply(result);
    }

    function doCancel(){
      if(undoStack.length > 1 && !window.confirm('已經有編輯過的內容，確定要放棄嗎？')) return;
      close(true);
    }

    /* ── 指標事件 ─────────────────────────────────────── */
    canvas.addEventListener('pointerdown', function(e){
      if(!hasImage()) return;
      var p = getCanvasPoint(e);
      lastPointerPoint = p;
      if(mode === 'eraser'){
        pushHistory(); isDrawing = true; eraseAt(p);
      }else if(mode === 'removeBgPick'){
        var px = safeImageData(Math.floor(Math.min(p.x, canvas.width - 1)), Math.floor(Math.min(p.y, canvas.height - 1)), 1, 1);
        if(!px) return;
        setPickedColor(px.data);
        if(removeBgByColor(pickedBgColor)) setStatus('點選顏色去背完成（不滿意可調容差後再點，或按「回上一步」）');
      }
    });
    canvas.addEventListener('pointermove', function(e){
      if(!hasImage()) return;
      var p = getCanvasPoint(e);
      var prev = lastPointerPoint;
      lastPointerPoint = p;
      updateBrushPreview(p);
      if(mode === 'eraser' && isDrawing){ if(prev) eraseLine(prev, p); eraseAt(p); }
    });
    window.addEventListener('pointerup', function(){
      if(isDrawing){ isDrawing = false; setStatus('已擦除'); }
      activeCropEdge = null;
    });
    canvas.addEventListener('pointerleave', function(){ lastPointerPoint = null; brushPreview.style.display = 'none'; });

    cropBox.addEventListener('pointerdown', function(e){
      var edge = e.target.dataset.edge;
      if(!edge || mode !== 'crop' || !hasImage()) return;
      e.preventDefault(); e.stopPropagation();
      activeCropEdge = edge;
      cropBox.setPointerCapture(e.pointerId);
    });
    cropBox.addEventListener('pointermove', function(e){
      if(!activeCropEdge || mode !== 'crop' || !hasImage()) return;
      e.preventDefault();
      resizeCropByEdge(activeCropEdge, getCanvasPoint(e));
      updateCropBox();
    });
    cropBox.addEventListener('pointerup', function(e){
      activeCropEdge = null;
      try{ cropBox.releasePointerCapture(e.pointerId); }catch(_){}
    });

    /* ── 按鈕 ─────────────────────────────────────────── */
    m.addEventListener('click', function(e){
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      var act = btn && btn.dataset.act;
      if(!act || (btn && btn.disabled)) return;
      if(act === 'eraser') setMode('eraser');
      else if(act === 'crop') setMode('crop');
      else if(act === 'applyCrop') applyCrop();
      else if(act === 'autoBg'){
        if(!hasImage()) return;
        var imageData = safeImageData(0, 0, canvas.width, canvas.height);
        if(!imageData) return;
        var d = imageData.data;
        var pts = [0, (canvas.width - 1) * 4, ((canvas.height - 1) * canvas.width) * 4, ((canvas.height * canvas.width) - 1) * 4];
        var bg = [0, 0, 0];
        pts.forEach(function(i){ bg[0] += d[i]; bg[1] += d[i + 1]; bg[2] += d[i + 2]; });
        bg = [Math.round(bg[0] / 4), Math.round(bg[1] / 4), Math.round(bg[2] / 4)];
        setPickedColor(bg);
        if(removeBgByColor(bg)) setStatus('自動去背完成（取四個角落的平均色當背景色；不夠乾淨可調容差，或改用「點選顏色去背」）');
      }
      else if(act === 'pickBg') setMode('removeBgPick');
      else if(act === 'undo'){
        if(undoStack.length <= 1) return setStatus('沒有可回復的步驟');
        redoStack.push(undoStack.pop()); restoreFrom(undoStack[undoStack.length - 1]); setStatus('已回上一步');
      }
      else if(act === 'redo'){
        if(!redoStack.length) return setStatus('沒有下一步');
        var next = redoStack.pop(); undoStack.push(next); restoreFrom(next); setStatus('已到下一步');
      }
      else if(act === 'reset') resetToOriginal();
      else if(act === 'photoroom') window.open('https://www.photoroom.com/tools/background-remover', '_blank');
      else if(act === 'cancel') doCancel();
      else if(act === 'apply') doApply();
    });

    // 快捷鍵：視窗開著時吃掉 Ctrl+Z / Ctrl+Y / Esc，不讓底下的編輯器也跟著動
    document.addEventListener('keydown', function(e){
      if(!m.classList.contains('open')) return;
      var key = (e.key || '').toLowerCase();
      if((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey){
        e.preventDefault(); e.stopPropagation();
        if(mode !== 'crop') m.querySelector('[data-act="undo"]').click();
      }else if((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))){
        e.preventDefault(); e.stopPropagation();
        if(mode !== 'crop') m.querySelector('[data-act="redo"]').click();
      }else if(key === 'escape'){
        e.preventDefault(); e.stopPropagation();
        if(mode === 'crop'){ setMode('crop'); } else doCancel();
      }
    }, true);

    function open(src, options){
      opts = options || {};
      titleEl.textContent = opts.title || '去背';
      originalSrc = src;
      m.classList.add('open');
      loadInto(src, function(ok){
        if(!ok){
          m.classList.remove('open');
          var msg = '圖片讀取失敗，無法開啟去背編輯器。';
          if(typeof opts.onError === 'function') opts.onError(msg); else window.alert(msg);
          opts = {};
          return;
        }
        originalW = canvas.width; originalH = canvas.height;
        undoStack = []; redoStack = [];
        pushHistory();
        mode = 'none'; cropStart = cropEnd = null; pickedBgColor = null;
        chip.style.background = 'transparent';
        cropBox.style.display = 'none';
        setActive();
        updateCanvasCssSize();
        updateHistoryButtons();
        setStatus('Ready');
      });
    }

    return { open: open };
  }

  window.SkbnEraseEditor = {
    version: '1.0.0',
    open: function(src, options){
      if(!api) api = makeEditor();
      api.open(src, options);
    }
  };
})();
