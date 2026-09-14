'use strict';
/*
  pricetag-interaction.js
  ------------------------------------------------------------
  負責「小標」在陰影編輯1200畫布裡的狀態、自動方向判斷、拖曳互動。
  純渲染邏輯(背景形狀+文字怎麼畫)在 modules/pricetag-module.js，這支
  只管「畫在哪、跟著哪個商品、往哪邊指」，兩支職責分開，之後要換小標
  視覺樣式只要動pricetag-module.js，不會動到這支的互動邏輯。

  跟 shadow-popup.js 的整合方式（呼叫端＝shadow-popup.js）：
    1. initShadowPopup() 開popup時呼叫一次 PriceTagSystem.init(redraw)
    2. drawShadowCanvas() 畫完商品/陰影之後，呼叫一次
       PriceTagSystem.drawAll(ctx, _shadowReceiver, 1200)
    3. exportShadowComposite() 最終合成時，也呼叫一次drawAll()把小標畫進
       輸出結果，讓小標「跟著商品一起轉出」
    4. renderSlotBar()裡，每個「已上傳圖片的商品」欄位，呼叫
       PriceTagSystem.renderControls(container, slotId, redraw) 掛一組
       「顯示小標／原價／特價」的小面板
    5. initShadowPopup()裡，在 _shadowReceiver.attachPointerEvents(...)
       之前，先呼叫 PriceTagSystem.attachPointerEvents(canvas, receiver, redraw)
       —— 順序很重要，見該函式內的說明

  狀態存放：S.priceTags[slotId] = { on, offsetXPct, offsetYPct, orientation, originalPrice, salePrice }
    - offsetXPct/offsetYPct：小標「中心點」相對於商品邊框(itemBounds)的偏移，
      單位是商品邊框自己的寬/高比例，不是絕對座標——換到Skinny BN那種完全
      不同大小/比例的畫布時，同一組offset還是能算出視覺上相近的位置，不用
      每個尺寸重新調一次（使用者要再微調也可以，只是預設值繼承過去）。
      例：offsetXPct=1.05 表示小標中心點在「商品右邊界往外5%商品寬度」的
      地方；offsetYPct=0.15 表示在「商品頂部往下15%商品高度」的地方。
    - orientation：使用者拖曳時即時算出來的『目前』方向，同時也是拖曳後
      最後停下來那個方向的記憶值——沒有明確左右側可以判斷時(小標中心點
      跟商品中心點幾乎同一個x)，就沿用這個值，不會忽左忽右亂跳。
*/

var PriceTagSystem = (function(){

  var SLOT_IDS = ['商品1(左)','商品2(中)','商品3(右)'];
  /* 2026-09第二次改版：小標寬度改成依文字內容動態決定(見
     modules/pricetag-module.js的computeSize())，所以「大小固定」這件事
     現在是靠「高度固定」達成，寬度是文字的自然結果，不是另外設定的比例。
     這個值是從舊的TAG_W_RATIO(0.19404，寬度基準)換算過來的：0.19404 *
     (98/217原本的高寬比) ≈ 0.08763，讓一般常見的3位數價格(例如
     $490/32入)換算出來的視覺大小跟改版前差不多，不會因為改成動態寬度
     就突然變超大或超小。要再調整整體大小，改這個數字就好。 */
  var TAG_H_RATIO = 0.09258333333333334; // 2026-09再+10%(原0.08416666666666667)
  var ORIENTATION_DEADZONE_PX = 6; // 小標中心點跟商品中心點的x距離在這個範圍內，視為「正上/正下」，沿用上一次方向

  function ensureSlotState(slotId){
    S.priceTags = S.priceTags || {};
    if(!S.priceTags[slotId]){
      S.priceTags[slotId] = {
        on: false,
        offsetXPct: 1.05,
        offsetYPct: 0.15,
        orientation: 'left',
        originalPrice: '',
        salePrice: ''
      };
    }
    return S.priceTags[slotId];
  }

  function init(redrawWhenImageReady){
    SLOT_IDS.forEach(ensureSlotState);
    /* 2026-09：小標背景改用canvas直接畫(見modules/pricetag-module.js)，
       不再需要載入pricetag/tag-base.png這張圖，原本這裡的
       Modules.pricetag.ensureImageLoaded(redrawWhenImageReady)已經拿掉。
       參數還保留著沒有拿掉呼叫端的傳入方式，只是這裡目前用不到，
       之後如果又需要「有東西要非同步載入完才redraw」的情境，直接在這裡
       呼叫redrawWhenImageReady()即可。 */
  }

  /* 從 receiver.getOrderedStates() 找這個slot目前的商品狀態(x=中心X, y=底部Y,
     w/h=顯示寬高)，換算成邊框{left,top,right,bottom,cx,cy,w,h}。receiver裡
     沒有這個slot(還沒上傳圖/沒開啟)就回傳null。 */
  function getProductBBox(slotId, receiver){
    if(!receiver) return null;
    var states = receiver.getOrderedStates();
    var st = states.filter(function(s){ return s.id === slotId; })[0];
    if(!st) return null;
    return {
      left: st.x - st.w/2, right: st.x + st.w/2,
      top: st.y - st.h, bottom: st.y,
      cx: st.x, cy: st.y - st.h/2,
      w: st.w, h: st.h
    };
  }

  /* 依小標中心點x跟商品中心點x的相對位置決定方向：
     小標在左→尖角朝右(orientation:'left'，跟底圖原始方向一致)
     小標在右→尖角朝左(orientation:'right'，鏡射)
     幾乎同一個x(正上/正下)→sticky，沿用上一次的方向，不會亂跳 */
  function computeOrientation(tagCx, productCx, lastOrientation){
    var dx = tagCx - productCx;
    if(Math.abs(dx) <= ORIENTATION_DEADZONE_PX) return lastOrientation || 'left';
    return dx < 0 ? 'right' : 'left';
  }

  /* 算出這個slot的小標目前該畫在畫布上的哪個位置/多大/哪個方向。
     ctx：拿來量文字寬度用(Modules.pricetag.computeSize()需要)。
     canvasSize＝畫布邊長(陰影編輯畫布固定1200x1200)。
     回傳null代表這個slot目前不該顯示小標(沒開啟、或商品還沒上傳圖)。 */
  function computeTagBox(ctx, slotId, receiver, canvasSize){
    var cfg = ensureSlotState(slotId);
    if(!cfg.on) return null;
    var bbox = getProductBBox(slotId, receiver);
    if(!bbox) return null;

    var tagCx = bbox.left + cfg.offsetXPct * bbox.w;
    var tagCy = bbox.top + cfg.offsetYPct * bbox.h;

    var orientation = computeOrientation(tagCx, bbox.cx, cfg.orientation);
    cfg.orientation = orientation; // 記住這次算出來的方向，給下次deadzone情況沿用

    var h = canvasSize * TAG_H_RATIO;
    var size = Modules.pricetag.computeSize(ctx, h, cfg.originalPrice, cfg.salePrice);
    var w = size.w;

    return {
      x: tagCx - w/2, y: tagCy - h/2, w: w, h: h,
      cx: tagCx, cy: tagCy,
      orientation: orientation,
      originalPrice: cfg.originalPrice,
      salePrice: cfg.salePrice
    };
  }

  /* 畫布尺寸(1200x1200)固定用這個，跟shadow-popup.js的_shadowCanvas一致 */
  var CANVAS_SIZE = 1200;

  function drawAll(ctx, receiver){
    SLOT_IDS.forEach(function(slotId){
      var box = computeTagBox(ctx, slotId, receiver, CANVAS_SIZE);
      if(!box) return;
      Modules.pricetag.draw(ctx, box);
    });
  }

  /* ── 拖曳互動 ──
     只做「移動」，不做縮放/旋轉(規格：大小不用調整)，所以不需要 shadow-
     layout-receiver.js那一整套四角控制點邏輯，自己寫一個簡化版就夠。

     這支要在 _shadowReceiver.attachPointerEvents(...) 之前呼叫、綁在同一個
     canvas上——同一個element上，先註冊的事件監聽器會先執行；命中小標時
     呼叫 e.stopImmediatePropagation()，稍後才註冊的receiver那份pointerdown
     監聽器就不會再收到這個事件，兩套拖曳系統不會互搶；沒命中小標則什麼都
     不做，事件正常往下傳給receiver處理商品的拖曳/縮放/旋轉，不受影響。 */
  var _dragging = null; // { slotId, startPointer:{x,y}, startOffsetXPct, startOffsetYPct, bbox }

  function attachPointerEvents(canvas, receiver, redraw){
    var hitCtx = canvas.getContext('2d'); // 只拿來measureText，不會被拿去畫東西，跟drawShadowCanvas用的是同一個context物件也沒關係

    function pos(e){
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
      var p = e.touches ? e.touches[0] : e;
      return { x:(p.clientX-rect.left)*scaleX, y:(p.clientY-rect.top)*scaleY };
    }

    function hitTest(p){
      // 由前景往後景找(SLOT_IDS本身沒有嚴格的前後關係，小標本來就各自獨立不重疊，
      // 但保險起見一樣反向找，跟receiver慣例一致：後面定義的視覺上通常疊比較上面)
      for(var i=SLOT_IDS.length-1; i>=0; i--){
        var slotId = SLOT_IDS[i];
        var box = computeTagBox(hitCtx, slotId, receiver, CANVAS_SIZE);
        if(!box) continue;
        if(p.x>=box.x && p.x<=box.x+box.w && p.y>=box.y && p.y<=box.y+box.h){
          return { slotId: slotId, box: box };
        }
      }
      return null;
    }

    canvas.addEventListener('pointerdown', function(e){
      var p = pos(e);
      var hit = hitTest(p);
      if(!hit) return; // 沒點到小標，讓事件正常傳給receiver處理商品
      e.stopImmediatePropagation();
      e.preventDefault();
      var cfg = ensureSlotState(hit.slotId);
      var bbox = getProductBBox(hit.slotId, receiver);
      if(!bbox) return;
      _dragging = {
        slotId: hit.slotId,
        startPointer: p,
        startOffsetXPct: cfg.offsetXPct,
        startOffsetYPct: cfg.offsetYPct,
        bbox: bbox
      };
      try{ canvas.setPointerCapture(e.pointerId); }catch(err){}
    });

    canvas.addEventListener('pointermove', function(e){
      if(!_dragging) return;
      e.preventDefault();
      var p = pos(e);
      var dx = p.x - _dragging.startPointer.x, dy = p.y - _dragging.startPointer.y;
      var cfg = ensureSlotState(_dragging.slotId);
      // 拖曳量換算成「相對商品邊框寬高」的offset變化——商品邊框拖曳當下不會突然變大小，
      // 用_dragging.bbox(拖曳開始那一刻量到的)當分母就好，不用每一幀重新查
      cfg.offsetXPct = _dragging.startOffsetXPct + dx / (_dragging.bbox.w || 1);
      cfg.offsetYPct = _dragging.startOffsetYPct + dy / (_dragging.bbox.h || 1);
      if(redraw) redraw();
    });

    window.addEventListener('pointerup', function(){ _dragging = null; });
  }

  /* ── 側欄小面板：顯示小標開關 + 原價/特價輸入框 ──
     掛在renderSlotBar()裡每個商品欄位下面，跟現有的frameRow(拍立得)、
     stageRow同一種輕量DOM組法，不用另外套元件庫。 */
  function renderControls(container, slotId, redraw){
    var cfg = ensureSlotState(slotId);
    var row = document.createElement('div');
    row.className = 'shadow-frame-row';
    row.draggable = false;
    row.style.flexDirection = 'column';
    row.style.alignItems = 'stretch';
    row.style.gap = '4px';

    var toggleLine = document.createElement('label');
    toggleLine.innerHTML = '<input type="checkbox" '+(cfg.on?'checked':'')+'> 小標';
    row.appendChild(toggleLine);

    var inputsWrap = document.createElement('div');
    inputsWrap.style.display = cfg.on ? 'flex' : 'none';
    inputsWrap.style.gap = '4px';
    inputsWrap.style.marginTop = '2px';

    /* 2026-09調整：使用者反映輸入框太寬、擠到旁邊去了——縮短成原本的
       一半左右，改用固定px寬度(不用百分比，百分比在這種巢狀flex結構裡
       換算出來的實際寬度不直覺)，維持原本同一行的排版方式不變。 */
    var origInput = document.createElement('input');
    origInput.type = 'text';
    origInput.placeholder = '原價 例:$490/32入';
    origInput.value = cfg.originalPrice;
    origInput.style.width = '60px';
    origInput.style.boxSizing = 'border-box';
    origInput.style.fontSize = '11px';

    var saleInput = document.createElement('input');
    saleInput.type = 'text';
    saleInput.placeholder = '特價 例:$313/32入';
    saleInput.value = cfg.salePrice;
    saleInput.style.width = '60px';
    saleInput.style.boxSizing = 'border-box';
    saleInput.style.fontSize = '11px';

    inputsWrap.appendChild(origInput);
    inputsWrap.appendChild(saleInput);
    row.appendChild(inputsWrap);

    row.addEventListener('click', function(e){ e.stopPropagation(); });
    /* 2026-09新增：使用者反映在小標的原價/特價輸入框裡打字/選取文字時，
       很容易不小心觸發畫布本身的拖曳(把商品/小標整個拉走)——canvas的
       拖曳是綁在'pointerdown'上(見shadow-popup.js)，這個事件比'click'
       更早發生，只擋'click'不夠。這裡額外擋掉這個row(整組小標控制項，
       含checkbox/兩個輸入框)的pointerdown/mousedown，滑鼠在這個區塊
       按下的當下就直接不讓事件往上傳，不會有機會被canvas那邊的拖曳
       判斷接收到。 */
    row.addEventListener('pointerdown', function(e){ e.stopPropagation(); });
    row.addEventListener('mousedown', function(e){ e.stopPropagation(); });

    toggleLine.querySelector('input').addEventListener('change', function(e){
      cfg.on = e.target.checked;
      inputsWrap.style.display = cfg.on ? 'flex' : 'none';
      if(redraw) redraw();
    });
    origInput.addEventListener('input', function(){ cfg.originalPrice = origInput.value; if(redraw) redraw(); });
    saleInput.addEventListener('input', function(){ cfg.salePrice = saleInput.value; if(redraw) redraw(); });

    container.appendChild(row);
  }

  /* ── 存檔/還原用：跟S.shadowSlots等欄位一樣，交給editor-state.js的
     saveCurrentTabIntoData()/applyTabData()明確存取，這裡只提供工具函式，
     避免那兩支函式要知道PriceTagSystem內部細節。 */
  function serialize(){
    return JSON.parse(JSON.stringify(S.priceTags || {}));
  }
  function restore(data){
    S.priceTags = JSON.parse(JSON.stringify(data || {}));
    SLOT_IDS.forEach(ensureSlotState); // 補齊舊存檔沒有的欄位/新slot
  }

  return {
    SLOT_IDS: SLOT_IDS,
    init: init,
    drawAll: drawAll,
    attachPointerEvents: attachPointerEvents,
    renderControls: renderControls,
    getProductBBox: getProductBBox,
    computeTagBox: computeTagBox,
    serialize: serialize,
    restore: restore
  };
})();

window.PriceTagSystem = PriceTagSystem;
