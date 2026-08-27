/*
  shadow-layout-receiver.js
  給任何 layout 頁面（layouts/*.html）掛載用的共用模組。

  設計原則：這支模組「不」霸佔你的 canvas 或 draw()——它只負責：
    1. 管理商品/主持人的素材狀態（上傳的圖、位置、縮放）
    2. 接收 editor 端 shadow-editor-plugin.js 廣播來的 postMessage
    3. 提供一個 drawItems(ctx) 函式，你在自己的 draw() 裡想畫的時候呼叫它
    4. （選用）提供拖曳/縮放控制點互動，你決定要不要接上

  ── 全新的簡單版位（例如 lifestyle_lpbn.html）用法 ──
    <script src="../js/shadow-plugin.js"></script>
    <script src="../js/shadow-layout-receiver.js"></script>
    <script>
      var canvas = document.getElementById('stage');
      var ctx = canvas.getContext('2d');
      var receiver = ShadowLayoutReceiver.create(canvas);

      function draw(){
        ctx.clearRect(0,0,canvas.width,canvas.height);
        drawMyBackground();       // 你自己的背景畫法
        receiver.drawItems(ctx);  // 畫商品/主持人+陰影
      }

      window.addEventListener('message', function(e){ receiver.handleMessage(e.data, draw); });
      receiver.attachPointerEvents(draw); // 要拖曳/縮放控制點就接這行，不需要就不要呼叫
      draw();
      parent.postMessage({ type:'LC_READY' }, '*');
    </script>

  ── 接到你「現有」的複雜版位（例如 02_lpbn.html，已經有自己的 draw()、文案、LOGO） ──
    只要在你原本 draw() 裡，想讓商品/主持人出現的那一行插入 receiver.drawItems(ctx) 即可，
    例如放在畫完背景之後、畫文案 LOGO 之前（或之後，看你要商品在文字上面還下面）：

      function draw(){
        ctx.clearRect(...);
        drawBackground();
        receiver.drawItems(ctx);   // <-- 加這一行就好，其他都不用動
        drawLogos();
        drawText();
        drawHostBar();
        if (D.showCTA) drawCTA();
        updateOverlay();
      }

    然後在檔案某處（跟你現有的 window.addEventListener('message', ...) 合併，
    或另外加一個監聽器都可以）加：
      var receiver = ShadowLayoutReceiver.create(canvas);
      window.addEventListener('message', function(e){ receiver.handleMessage(e.data, draw); });

    是否要接拖曳/縮放控制點（attachPointerEvents）自行決定；如果這個版位的商品位置
    是由「調一次、套用到全版位」的正規化座標機制決定、不需要使用者在這個版位上
    個別拖曳，就不用呼叫 attachPointerEvents。
*/
window.ShadowLayoutReceiver = (function () {
  'use strict';
  console.log('%c[shadow-layout-receiver.js] 版本確認：2026-07-25-v5（修正換圖w0變形bug＋有色範圍整體置中＋旋轉＋畫布多選點擊＋Ctrl+Z復原）', 'background:#222;color:#0f0;font-weight:bold;padding:2px 6px;');

  /* ★ 旋轉功能（角落四個縮放控制點之外，選取單一項目時頂部會多一個綠色旋轉把手）。
     設計原則「旋轉解耦」：旋轉「只」影響最後畫到 canvas 上的視覺效果（照片+貼地陰影/
     光暈一起轉），完全不影響 itemBounds／拖曳／縮放控制點的判定邏輯──這些全部維持
     軸對齊矩形計算，跟原本沒有旋轉功能時一模一樣。先把商品縮放/擺到你要的大小位置，
     再用旋轉把手轉角度，兩件事互不干擾。實際畫出旋轉效果的地方在 shadow-plugin.js
     （drawGroundShadow/drawPersonGlow 那邊用 ctx.rotate 包起來），這支檔案只負責
     「使用者怎麼用滑鼠把角度轉出來、存到哪裡」。 */
  var ROT_SNAP_DEG = 15; // 拖曳旋轉把手時按住 Shift 的吸附角度

  /* ★ 圓柱舞台（毛孩衝蝦米新增）：固定壓在商品/主持人最下方的裝飾素材，跟 ground shadow
     一樣「不能旋轉、依版型組合(A/B/C/D)自動算水平置中位置、位置/大小由 stage-defaults.js
     控制」，唯一差異是保留一個「整體縮放倍率」手動微調逃生口（setStageScale），
     因為自動位置不一定每次都跟商品貼合，見 drawStage() 說明。
     圖檔路徑：只有 02_lpbn／01_thumbnail／05_opening 這三個版位的 render() 會呼叫
     drawStage()，07_fl／09_tab／IG／MSBN／天空標都不會用到，找不到圖檔也只是
     drawStage() 靜靜跳過，不影響其他版位。 */
  var _stageImgSrc = (location.pathname.indexOf('/layouts/') !== -1) ? '../logos/stage-cylinder.png' : 'logos/stage-cylinder.png';
  var _stageImg = new Image();
  _stageImg.onerror = function(){ console.warn('[stage] 找不到圓柱舞台圖：' + _stageImgSrc); };
  _stageImg.src = _stageImgSrc;

  function normalizeDeg(deg){
    deg = deg % 360;
    if (deg > 180) deg -= 360;
    if (deg <= -180) deg += 360;
    return deg;
  }

  function create(canvas, opts){
    var stageIdOverride = (opts && opts.stageId) || null; // 給1200畫布用：location.pathname抓不到對應的StageDefaults key，靠這個明確指定
    var slots = {};        // slotId -> { x,y,w0,h0,scaleMul,rot,tight:{tx,ty,tw,th}(0~1比例) }
    var slotType = {};     // slotId -> 'person' | 'product'
    var enabledIds = [];   // 陣列順序＝手動疊放順序（前面＝後方，後面＝前方）
    var currentComboLetter = null; // 目前版型（A/B/C/D），來自 LC_SET_ENABLED 訊息的 combo 欄位，用來查 shadow-layout-defaults.js 裡對應版型的設定
    var selectedIds = [];  // 目前選取的素材（可能多個），activeSlotId 是只有選一個時的別名，向下相容
    var activeSlotId = null;
    var interaction = null;

    /* ── 復原（Ctrl+Z）：只記錄「位置/縮放/旋轉」這幾個欄位的微調，不含
       上傳/刪除素材、版型組合切換——範圍刻意縮小，最多存5步。每次開始一個新的
       拖曳/縮放/旋轉動作之前（pointerdown 當下）就存一次快照，Ctrl+Z 復原到
       「這個動作開始之前」的狀態。 */
    var undoStack = [];
    var UNDO_MAX = 5;
    function pushUndoSnapshot(){
      var snap = {};
      Object.keys(slots).forEach(function(id){
        var s = slots[id];
        snap[id] = { x:s.x, y:s.y, scaleMul:s.scaleMul, rot:s.rot||0 };
      });
      undoStack.push({ slots:snap, ts:Date.now() });
      if(undoStack.length > UNDO_MAX) undoStack.shift();
    }
    function peekUndoTs(){
      return undoStack.length ? undoStack[undoStack.length-1].ts : 0;
    }
    function undo(redraw){
      var snap = undoStack.pop();
      if(!snap) return;
      Object.keys(snap.slots).forEach(function(id){
        if(!slots[id]) return; // 這個slot後來被刪掉了（刪除不在復原範圍內），跳過
        var v = snap.slots[id];
        slots[id].x = v.x; slots[id].y = v.y; slots[id].scaleMul = v.scaleMul; slots[id].rot = v.rot;
      });
      if(redraw) redraw();
    }
    var bgImg = null;

    // 統一的選取狀態設定：selectedIds 是主要狀態，activeSlotId 在只選一個時同步更新（向下相容舊用法）
    function setSelection(ids){
      selectedIds = (ids || []).filter(function(id){ return slots[id]; });
      activeSlotId = selectedIds.length === 1 ? selectedIds[0] : null;
    }

    // 多選時的整體外框（所有選取素材 itemBounds 的聯集），拿來畫外框跟算縮放控制點
    function groupBounds(ids){
      var boxes = ids.map(itemBounds).filter(Boolean);
      if (!boxes.length) return null;
      var left = Math.min.apply(null, boxes.map(function(b){ return b.left; }));
      var top = Math.min.apply(null, boxes.map(function(b){ return b.top; }));
      var right = Math.max.apply(null, boxes.map(function(b){ return b.right; }));
      var bottom = Math.max.apply(null, boxes.map(function(b){ return b.bottom; }));
      return { left:left, top:top, right:right, bottom:bottom, w:right-left, h:bottom-top, cx:(left+right)/2, cy:(top+bottom)/2 };
    }

    /* ── 版型整體置中（依「有色範圍」的實際聯集外框校正，不是靠頭部座標間接假設）──
       每個素材原本已經各自用頭部偵測／錨點算出位置，但這只保證「頭」或「錨點」對齊，
       不保證整組合起來、實際可見（不透明）範圍的整體視覺重心真的落在畫布指定位置——
       不同照片人物的身形寬窄、手臂張開幅度都不一樣，單靠頭部座標間接置中會偏一邊。
       這裡改成：等這個版型該有的素材都到齊之後，用跟多選框同一套 groupBounds()
       量出整組「有色範圍」的實際聯集外框，量完再整組（大小/相對位置都不變）
       水平平移到目標位置——只調水平，垂直維持各自 head/anchor 的定位邏輯不動。
       只在「這個版型的素材第一次全部到齊」時套用一次（呼叫端只在 upsertSlot 的
       全新建立分支才呼叫），使用者之後手動調整過，不會再被這裡覆蓋。
       只列出的版型（A/B/C）才套用，其餘（例如D純商品）先不調。 */
    var GROUP_CENTER_TARGET_X_PCT = {
      A: 0.5,   // 雙人：整體置中
      B: 0.45,  // 2人+1品：置中後再往左偏一點（畫布寬5%）
      C: 0.5    // 1人+2品：套用跟A同樣的置中邏輯
    };
    function maybeApplyGroupCenter(){
      var targetPct = GROUP_CENTER_TARGET_X_PCT[currentComboLetter];
      if (targetPct === undefined) return; // 沒列出的版型（目前是D）不套用
      if (!enabledIds.length || !enabledIds.every(function(id){ return !!slots[id]; })) return; // 這個版型的素材還沒到齊，先不校正
      var gb = groupBounds(enabledIds);
      if (!gb) return;
      var dx = canvas.width * targetPct - gb.cx;
      if (Math.abs(dx) < 0.5) return; // 差距小到可忽略，不用調整
      enabledIds.forEach(function(id){ slots[id].x += dx; });
    }

    // 掃描圖片，算出「有色（不透明）部分」佔原圖的比例範圍 {tx,ty,tw,th}（0~1），
    // 之後選取框/點擊判定都用這個範圍，而不是整張圖（含透明留白）的滿版範圍
    function calcTightBoundsRatio(img){
      try{
        var SCAN = 200;
        var sc = Math.min(1, SCAN / Math.max(img.naturalWidth, img.naturalHeight));
        var sw = Math.max(1, Math.floor(img.naturalWidth * sc));
        var sh = Math.max(1, Math.floor(img.naturalHeight * sc));
        var tmp = document.createElement('canvas');
        tmp.width = sw; tmp.height = sh;
        var tctx = tmp.getContext('2d');
        tctx.clearRect(0,0,sw,sh);
        tctx.drawImage(img, 0, 0, sw, sh);
        var d = tctx.getImageData(0,0,sw,sh).data;
        var x0=sw, y0=sh, x1=0, y1=0, found=false;
        var alphaThresh = 10;
        for (var y=0; y<sh; y++){
          for (var x=0; x<sw; x++){
            if (d[(y*sw+x)*4+3] > alphaThresh){
              if (x<x0) x0=x; if (x>x1) x1=x;
              if (y<y0) y0=y; if (y>y1) y1=y;
              found = true;
            }
          }
        }
        if (!found) return null;
        return { tx: x0/sw, ty: y0/sh, tw: (x1-x0+1)/sw, th: (y1-y0+1)/sh };
      } catch(e){
        console.warn('[shadow-layout-receiver] 無法偵測透明留白，選取框改用整張圖範圍', e);
        return null;
      }
    }

    // 掃描圖片，估算「頭部」的中心位置與寬度比例 {xRatio, yRatio, widthRatio}（0~1，相對整張圖）。
    // 做法：固定取最頂端往下 10% 這一小段當頭部範圍（不去猜肩膀在哪），
    // 再抓這段範圍的左右邊界算水平中心跟寬度。只給人物用，商品不需要。
    function calcHeadCenterRatio(img){
      try{
        var SCAN = 200;
        var sc = Math.min(1, SCAN / Math.max(img.naturalWidth, img.naturalHeight));
        var sw = Math.max(1, Math.floor(img.naturalWidth * sc));
        var sh = Math.max(1, Math.floor(img.naturalHeight * sc));
        var tmp = document.createElement('canvas');
        tmp.width = sw; tmp.height = sh;
        var tctx = tmp.getContext('2d');
        tctx.clearRect(0,0,sw,sh);
        tctx.drawImage(img, 0, 0, sw, sh);
        var d = tctx.getImageData(0,0,sw,sh).data;
        var alphaThresh = 10;

        function rowBounds(y){
          var minX=-1, maxX=-1;
          for (var x=0; x<sw; x++){
            if (d[(y*sw+x)*4+3] > alphaThresh){ if (minX<0) minX=x; maxX=x; }
          }
          return minX<0 ? null : { minX: minX, maxX: maxX };
        }

        var top=-1, bottom=-1;
        for (var y1=0; y1<sh; y1++){ if (rowBounds(y1)){ top=y1; break; } }
        if (top<0) return null;
        for (var y2=sh-1; y2>=0; y2--){ if (rowBounds(y2)){ bottom=y2; break; } }

        var totalRows = bottom - top + 1;

        // 頭部範圍：直接固定取「最頂端往下 10%」這一小段（至少 5 行、最多 30 行），
        // 不再去猜「肩膀寬度跳躍點在哪」——長髮、寬鬆衣服等會讓寬度變化是漸進的、
        // 不是突然跳一階，這種照片常常抓不到明顯跳躍點，導致頭部範圍忽大忽小、
        // 兩個人量出來的頭寬落差很大。固定頂端窄band雖然不是最精確的解剖學頭部範圍，
        // 但每張照片的判斷方式完全一致，才能保證「頭一樣大」這個目標穩定成立。
        var bandCount = Math.min(totalRows, Math.max(5, Math.min(30, Math.round(totalRows*0.10))));
        var headTop = top, headBottom = top + bandCount - 1;

        // 頭部範圍內找左右邊界，算水平中心
        var hMinX=sw, hMaxX=0, any=false;
        for (var y4=headTop; y4<=headBottom; y4++){
          var rb2 = rowBounds(y4);
          if (rb2){ if (rb2.minX<hMinX) hMinX=rb2.minX; if (rb2.maxX>hMaxX) hMaxX=rb2.maxX; any=true; }
        }
        if (!any) return null;

        return { xRatio: ((hMinX+hMaxX)/2)/sw, yRatio: ((headTop+headBottom)/2)/sh, widthRatio: (hMaxX-hMinX+1)/sw };
      } catch(e){
        console.warn('[shadow-layout-receiver] 無法偵測頭部位置，改用整張圖錨點定位', e);
        return null;
      }
    }

    function getState(slotId){
      var s = slots[slotId];
      if (!s) return null;
      return { id: slotId, x: s.x, y: s.y, w: s.w0*s.scaleMul, h: s.h0*s.scaleMul, rot: s.rot || 0,
        shadowScaleX: s.shadowScaleX || 1, shadowScaleY: s.shadowScaleY || 1 };
    }
    // 商品圖片下緣透明留白的補償量（跟 shadow-plugin.js 畫圖邏輯共用同一份 trim 資料，
    // 不各自重新計算——避免選取框跟實際畫面位置對不上，詳見「選取框與陰影位移」問題報告）
    function getTrimBottomPad(slotId){
      var s = slots[slotId];
      if (!s) return 0;
      var fullH = s.h0*s.scaleMul;
      var product = window.ShadowPlugin && window.ShadowPlugin._products && window.ShadowPlugin._products[slotId];
      return (product && product.trim) ? product.trim.bottom * fullH : 0;
    }

    // 選取框／點擊判定用的範圍：優先用「有色部分」的緊密邊框，偵測失敗才退回整張圖範圍
    function itemBounds(slotId){
      var s = slots[slotId];
      var fullW = s.w0*s.scaleMul, fullH = s.h0*s.scaleMul;
      var trimBottomPad = getTrimBottomPad(slotId);
      var imgLeft = s.x - fullW/2, imgTop = s.y + trimBottomPad - fullH;
      if (s.tight){
        var w = s.tight.tw * fullW, h = s.tight.th * fullH;
        var left = imgLeft + s.tight.tx * fullW, top = imgTop + s.tight.ty * fullH;
        return { left: left, top: top, right: left+w, bottom: top+h, w: w, h: h };
      }
      return { left: imgLeft, top: imgTop, right: imgLeft+fullW, bottom: imgTop+fullH, w: fullW, h: fullH };
    }

    // 這個版位的整體縮放倍率——只影響畫在畫布上的大小/位置，不影響共用的素材資料本身
    // （見 shadow-scene-scale.js），找不到對應版位就當作 1（不縮放）
    function getSceneScale(){
      var id = null;
      try{ id = location.pathname.split('/').pop().replace(/\.html?$/i, ''); }catch(e){}
      var table = window.ShadowSceneScale || {};
      if(id && table[id] !== undefined) return table[id];
      return table._default !== undefined ? table._default : 1;
    }

    // 圓柱舞台（毛孩衝蝦米）：獨立於 slots/products 系統之外的物件（不吃陰影/光暈特效、
    // 不能旋轉），但可以拖曳移動、拖角縮放——狀態只存 cx/cy（中心點）跟 scaleMul，
    // 第一次畫（或版位/combo改變、還沒手動調過）時用 stage-defaults.js 的 xPct/wPct/bottomPct
    // 算出預設位置；使用者拖過之後 stageState.moved=true，之後就不會再被預設值蓋掉。
    var stageState = { cx: null, cy: null, scaleMul: 1, selected: false, moved: false };

    function getLayoutId(){
      if (stageIdOverride) return stageIdOverride;
      try{ return location.pathname.split('/').pop().replace(/\.html?$/i, ''); }catch(e){ return null; }
    }
    function getStageCfg(){
      var id = getLayoutId();
      return id && window.StageDefaults && window.StageDefaults[id];
    }
    // 舞台目前的畫面範圍（中心點+寬高），找不到設定或圖片還沒載入完成就回傳 null
    function getStageBounds(){
      var cfg = getStageCfg();
      if (!cfg || !_stageImg.complete || !_stageImg.naturalWidth) return null;
      var unitW = canvas.width * cfg.wPct; // scaleMul=1時的基準寬度
      var w = unitW * stageState.scaleMul;
      var h = w * (_stageImg.naturalHeight / _stageImg.naturalWidth);
      if (stageState.cx === null || stageState.cy === null || !stageState.moved){
        var xPct = cfg.xPct !== undefined ? cfg.xPct : 0.5;
        stageState.cx = canvas.width * xPct;
        stageState.cy = canvas.height * cfg.bottomPct - h / 2;
      }
      return { left: stageState.cx - w/2, top: stageState.cy - h/2, right: stageState.cx + w/2, bottom: stageState.cy + h/2, w: w, h: h, unitW: unitW };
    }
    // opts.skipSelection=true：匯出攤平成品時用，不能把選取框/控制點一起烤進最終PNG
    function drawStage(ctx, opts){
      var b = getStageBounds();
      if (!b) return;
      ctx.drawImage(_stageImg, b.left, b.top, b.w, b.h);
      if (stageState.selected && !(opts && opts.skipSelection)) drawStageSelectionBox(ctx, b);
    }
    function drawStageSelectionBox(ctx, b){
      ctx.save();
      ctx.strokeStyle = '#4a90e2';
      ctx.lineWidth = Math.max(1.5, canvas.width*0.0015);
      ctx.setLineDash([]);
      ctx.strokeRect(b.left, b.top, b.w, b.h);
      var hs = Math.max(8, canvas.width*0.012);
      ctx.fillStyle = '#4a90e2';
      [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]].forEach(function(c){
        ctx.beginPath(); ctx.arc(c[0], c[1], hs*0.6, 0, Math.PI*2); ctx.fill();
      });
      ctx.restore();
    }
    // 手動縮放逃生口：目前還沒有拖曳UI，先開放用程式呼叫（例如之後要加縮放滑桿/控制點時直接接這兩支）
    function setStageScale(mul, redraw){ stageState.scaleMul = mul > 0 ? mul : 1; if (redraw) redraw(); }
    function getStageScale(){ return stageState.scaleMul; }
    function isStageSelected(){ return stageState.selected; }
    function deselectStage(){ stageState.selected = false; }

    // 畫商品/主持人＋陰影。不會清畫布、不會畫背景，插入到你自己的 draw() 需要的位置即可。
    // opts.skipSelection = true 時不畫選取框（給匯出用，避免選取框被一起輸出）
    function drawItems(ctx, opts){
      var states = enabledIds.map(getState).filter(Boolean);
      if (states.length){
        var scale = getSceneScale();
        if(scale !== 1){
          // 以畫布正中心為準等比縮放：位置往中心點內縮/外推，大小一起等比縮放
          var cx = canvas.width/2, cy = canvas.height/2;
          states = states.map(function(s){
            return {
              id: s.id,
              x: cx + (s.x - cx) * scale,
              y: cy + (s.y - cy) * scale,
              w: s.w * scale,
              h: s.h * scale,
              rot: s.rot // 旋轉角度不受縮放影響，原樣帶過去
            };
          });
        }
        ShadowPlugin.configureZone(canvas.height*0.1, canvas.height*0.95);
        ShadowPlugin.renderScene(ctx, states);
      }
      if (opts && opts.skipSelection) return;
      var validSelected = selectedIds.filter(function(id){ return slots[id] && enabledIds.indexOf(id) !== -1; });
      if (validSelected.length === 1){
        drawSelectionBox(ctx, validSelected[0]);
      } else if (validSelected.length > 1){
        drawGroupSelectionBox(ctx, validSelected);
      }
    }

    // 旋轉把手離選取框頂邊的距離、把手半徑，統一算式跟 hitTestRotateHandle 共用
    function rotateHandlePos(b){
      var offset = Math.max(24, canvas.width*0.03);
      return { x: (b.left+b.right)/2, y: b.top - offset };
    }

    function drawSelectionBox(ctx, slotId){
      var b = itemBounds(slotId);
      ctx.save();
      ctx.strokeStyle = '#4a90e2';
      ctx.lineWidth = Math.max(1.5, canvas.width*0.0015);
      /* 選取框一律用虛線（原本只有代言人是虛線、商品是實線，統一成虛線比較
         好跟畫布上其他實線內容區分開來）。 */
      ctx.setLineDash([canvas.width*0.01, canvas.width*0.007]);
      ctx.strokeRect(b.left, b.top, b.w, b.h);
      ctx.setLineDash([]);
      var hs = Math.max(8, canvas.width*0.012);
      var corners = [[b.left,b.top],[b.right,b.top],[b.left,b.bottom],[b.right,b.bottom]];
      corners.forEach(function(c){
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#4a90e2';
        ctx.lineWidth = Math.max(1.5, canvas.width*0.0015);
        ctx.beginPath();
        ctx.rect(c[0]-hs/2, c[1]-hs/2, hs, hs);
        ctx.fill(); ctx.stroke();
      });

      // 旋轉把手：頂邊中點往上拉一段距離的綠色圓點 + 連接線
      var rp = rotateHandlePos(b);
      ctx.beginPath();
      ctx.moveTo((b.left+b.right)/2, b.top);
      ctx.lineTo(rp.x, rp.y);
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = Math.max(1.5, canvas.width*0.0015);
      ctx.stroke();
      var hr = Math.max(7, canvas.width*0.009);
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, hr, 0, Math.PI*2);
      ctx.fillStyle = '#22c55e';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5, canvas.width*0.0018);
      ctx.stroke();

      // 旋轉中即時顯示角度（拖曳旋轉把手時 interaction.mode === 'rotate' 才會有值）
      if (interaction && interaction.mode === 'rotate' && interaction.slotId === slotId){
        var deg = Math.round(slots[slotId].rot || 0);
        ctx.font = Math.max(11, canvas.width*0.013) + 'px sans-serif';
        ctx.fillStyle = 'rgba(13,16,24,.92)';
        var label = deg + '°';
        var tw = ctx.measureText(label).width;
        var pad = 6;
        ctx.fillRect(rp.x - tw/2 - pad, rp.y - hr - 26, tw + pad*2, 18);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, rp.x, rp.y - hr - 17);
        ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      }

      ctx.restore();
    }

    // 多選：每個選取項目畫細框標示，外面再加一個橘色聯集外框＋四角縮放控制點（縮放會以這個外框中心為準）
    // 多選狀態不提供整組旋轉（每個項目各自的旋轉中心不同，整組轉在數學上要嘛失真、要嘛複雜到不划算，
    // 需要整組轉的話請先取消多選、逐一調整單一項目的角度）
    function drawGroupSelectionBox(ctx, ids){
      var gb = groupBounds(ids);
      if (!gb) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,152,0,0.6)';
      ctx.lineWidth = Math.max(1, canvas.width*0.001);
      ids.forEach(function(id){
        var b = itemBounds(id);
        ctx.strokeRect(b.left, b.top, b.w, b.h);
      });
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = Math.max(1.5, canvas.width*0.0018);
      ctx.setLineDash([canvas.width*0.012, canvas.width*0.008]);
      ctx.strokeRect(gb.left, gb.top, gb.w, gb.h);
      ctx.setLineDash([]);
      var hs = Math.max(8, canvas.width*0.012);
      var corners = [[gb.left,gb.top],[gb.right,gb.top],[gb.left,gb.bottom],[gb.right,gb.bottom]];
      corners.forEach(function(c){
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#ff9800';
        ctx.lineWidth = Math.max(1.5, canvas.width*0.0018);
        ctx.beginPath();
        ctx.rect(c[0]-hs/2, c[1]-hs/2, hs, hs);
        ctx.fill(); ctx.stroke();
      });
      ctx.restore();
    }

    /* 依素材代號給預設位置／大小（比例，0~1，相對於畫布寬高）。
       實際數字放在 shadow-layout-defaults.js（window.ShadowLayoutDefaults），
       方便之後直接改那個檔案調整，不用動這裡的邏輯；
       沒有載入那個檔案的話，退回下面這組保守預設值，不會壞掉。
       只在「素材第一次被加進來、還沒有任何位置資料」時套用；
       之後只要拖曳/縮放過，就會照使用者自己調整的位置，不會被這裡覆蓋。 */
    var HAS_COMBO_LAYOUT = !!window.ShadowLayoutDefaults; // true：新版「照版型分組」格式；false：退回舊版扁平格式
    var DEFAULT_LAYOUT = window.ShadowLayoutDefaults || {
      host1:    { xPct: 0.7, yPct: 0.95, hPct: 0.75 },
      host2:    { xPct: 0.4, yPct: 0.95, hPct: 0.75 },
      product1: { xPct: 0.2, yPct: 0.8,  hPct: 0.35 },
      product2: { xPct: 0.2, yPct: 0.5,  hPct: 0.32 },
      product3: { xPct: 0.2, yPct: 0.2,  hPct: 0.30 }
    };

    /* 依「目前版型」取出這個代號的預設位置。新版格式（shadow-layout-defaults.js 已改成
       照版型分組）下，每個版型的設定完全獨立，改一個版型不會動到其他版型；
       找不到目前版型（例如訊息順序異常、還沒收到版型資訊）就退回 _fallback。 */
    function getSlotLayout(slotId){
      if (!HAS_COMBO_LAYOUT){
        console.log('[shadow-debug] ' + slotId + ' 走舊版扁平格式（表示 window.ShadowLayoutDefaults 沒載入到新檔案！）');
        return DEFAULT_LAYOUT[slotId];
      }
      var comboBlock = DEFAULT_LAYOUT[currentComboLetter] || DEFAULT_LAYOUT._fallback || {};
      var usedFallback = !DEFAULT_LAYOUT[currentComboLetter];
      console.log('[shadow-debug] slot=' + slotId + ' 目前版型currentComboLetter=' + JSON.stringify(currentComboLetter) +
        (usedFallback ? '（找不到這個版型，退回 _fallback！）' : '') +
        ' 套用座標=' + JSON.stringify(comboBlock[slotId]));
      return comboBlock[slotId];
    }

    // 人物定位，依 layout 設定選其中一種模式（優先順序：headWidthPct > feetAtBottom > 固定 hPct）：
    //
    // 1) headWidthPct（頭大小優先）：頭的寬度、頭的座標(x,y)都直接鎖定，
    //    縮放倍率＝目標頭寬 ÷ 這張照片實際頭寬，不管腳最後在哪裡
    //    （身材長的人腳可能超出畫布下緣、身材短的人腳可能貼不到底，兩者都不處理，直接裁切/留白）。
    //    這個模式下兩位主持人「頭一樣大、一樣高」是保證成立的，不會因為身材比例不同跑掉。
    //
    // 2) feetAtBottom（腳貼底優先）：頭部中心要對齊 headYPct、腳（緊密邊框下緣）要貼在畫布底部，
    //    兩個條件同時滿足只有一組大小符合，代價是頭大小會因每張照片身材比例不同而有落差。
    //
    // 3) 都沒開：退回固定 hPct 決定大小（原本的行為）。
    function resolvePersonPlacement(img, headRatio, tight, layout){
      var h0, w0;
      if (layout.headWidthPct){
        if (!headRatio.widthRatio || headRatio.widthRatio <= 0.001) return null; // 偵測異常，放棄這個模式
        var desiredHeadWidthPx = canvas.width * layout.headWidthPct;
        var actualHeadWidthPx = headRatio.widthRatio * img.naturalWidth;
        var scale = desiredHeadWidthPx / actualHeadWidthPx;
        w0 = img.naturalWidth * scale;
        h0 = img.naturalHeight * scale;
      } else if (layout.feetAtBottom){
        var feetRatio = tight ? (tight.ty + tight.th) : 1; // 沒偵測到緊密邊框就退回整張圖底部
        var bottomMarginPct = layout.bottomMarginPct !== undefined ? layout.bottomMarginPct : 0;
        var feetCanvasY = canvas.height * (1 - bottomMarginPct);
        var headCanvasY = canvas.height * layout.headYPct;
        var denom = feetRatio - headRatio.yRatio; // 頭到腳在原圖中的比例距離
        if (denom <= 0.001) return null; // 偵測異常（頭腳幾乎同一個位置），放棄這個模式
        h0 = (feetCanvasY - headCanvasY) / denom;
        var maxH = canvas.height * (layout.maxHPct !== undefined ? layout.maxHPct : 1.2);
        var minH = canvas.height * (layout.minHPct !== undefined ? layout.minHPct : 0.3);
        h0 = Math.max(minH, Math.min(maxH, h0)); // 安全上下限，避免極端比例的照片算出離譜的大小
        w0 = img.naturalWidth * (h0/img.naturalHeight);
      } else {
        h0 = canvas.height * (layout.hPct !== undefined ? layout.hPct : 0.75);
        w0 = img.naturalWidth * (h0/img.naturalHeight);
      }
      var headCenterXInImg = headRatio.xRatio * w0;
      var headCenterYInImg = headRatio.yRatio * h0;
      var desiredHeadX = canvas.width * layout.headXPct;
      var desiredHeadY = canvas.height * layout.headYPct;
      var imgLeft = desiredHeadX - headCenterXInImg;
      var imgTop = desiredHeadY - headCenterYInImg;
      return { x: imgLeft + w0/2, y: imgTop + h0, w0: w0, h0: h0 };
    }

    function upsertSlot(slotId, type, dataUrl, redraw, ratio, savedTransform){
      var img = new Image();
      img.onload = function(){
        ShadowPlugin.registerProduct(slotId, img, type).then(function(){
          slotType[slotId] = type;
          var tight = calcTightBoundsRatio(img);
          if (!slots[slotId]){
            /* ★重新開啟1200畫布（popup每次重開，receiver.slots都是全新的空物件）
               時，如果呼叫端有帶savedTransform（S.shadowSlots[slotId].transform，
               上次關閉/操作時存下來的x/y/w0/h0/scaleMul/rot），直接套用它，
               不要再走下面「重新用預設版型位置計算」那條路——不然使用者上次
               手動拖曳/縮放/旋轉調整過的結果，重開popup就會被蓋回預設位置，
               等於「調整內容消失」。只有真正第一次加入這個素材（沒有savedTransform）
               才會用layout預設值去算初始位置。 */
            if (savedTransform && typeof savedTransform.x === 'number' && typeof savedTransform.y === 'number'
                && typeof savedTransform.w0 === 'number' && typeof savedTransform.h0 === 'number'){
              slots[slotId] = {
                x: savedTransform.x, y: savedTransform.y,
                w0: savedTransform.w0, h0: savedTransform.h0,
                scaleMul: (typeof savedTransform.scaleMul === 'number') ? savedTransform.scaleMul : 1,
                rot: savedTransform.rot || 0,
                shadowScaleX: (typeof savedTransform.shadowScaleX === 'number') ? savedTransform.shadowScaleX : 1,
                shadowScaleY: (typeof savedTransform.shadowScaleY === 'number') ? savedTransform.shadowScaleY : 1,
                tight: tight
              };
              if (redraw) redraw();
              return;
            }
            var layout = getSlotLayout(slotId);
            var h0, w0, x, y;
            if (layout){
              var placed = null;
              // 人物類：如果設定檔有給「頭部要在畫布哪裡」，就偵測這張照片頭部實際位置，
              // 反推整張圖該放在哪，讓頭部剛好落在指定座標（不同照片身材比例不同也會自動對齊）
              if (type === 'person' && layout.headXPct !== undefined && layout.headYPct !== undefined){
                var headRatio = calcHeadCenterRatio(img);
                console.log('[shadow-layout] ' + slotId + ' 偵測到的頭部比例:', headRatio);
                if (headRatio) placed = resolvePersonPlacement(img, headRatio, tight, layout);
              }
              if (placed){
                x = placed.x; y = placed.y; w0 = placed.w0; h0 = placed.h0;
              } else {
                // 商品、或頭部偵測失敗：退回用整張圖錨點（底部置中）+ 固定 hPct 定位
                var targetH = canvas.height * (layout.hPct !== undefined ? layout.hPct : 0.4);
                /* ★用「有色（不透明）部分」的高度去對齊targetH，不是整張圖（含透明
                   留白）的高度——不同商品照片留白鬆緊不一樣的話，用整張圖高度硬套
                   同一個hPct，商品本體實際看起來的高度還是會不一樣（留白越多、
                   看起來越小）。改成先看tight.th（有色部分佔整張圖高度的比例），
                   反推「整張圖要多高，才能讓有色部分剛好等於targetH」，這樣同樣選
                   「中」，不管素材裁切鬆緊，商品本體看起來的高度都會一致。
                   tight抓不到（例如全透明或讀取失敗）才退回原本「整張圖=targetH」
                   的算法，不會整個掛掉。 */
                h0 = (tight && tight.th > 0) ? (targetH / tight.th) : targetH;
                w0 = img.naturalWidth * (h0/img.naturalHeight);
                x = canvas.width * (layout.xPct !== undefined ? layout.xPct : 0.5);
                y = canvas.height * (layout.yPct !== undefined ? layout.yPct : 0.9);
              }
            } else {
              // 沒有預設值的未知代號：退回原本的自動排列，避免完全沒位置
              var idx = Object.keys(slots).length;
              h0 = canvas.height * (type==='person' ? 0.75 : 0.42);
              w0 = img.naturalWidth * (h0/img.naturalHeight);
              x = canvas.width*0.5 + (idx-2)*canvas.width*0.12;
              y = canvas.height*0.92;
            }
            /* 商品比例（Excel「(商品)比例」欄位，0~1）：100% 或沒填就是 1（維持這裡算出來的最大尺寸），
               填了更小的比例，就從第一次貼合的當下直接縮小；之後使用者拖曳調整過，就照使用者調整的結果。 */
            /* ★跟pet-frenzy原始碼不一樣的地方：原本這裡只接受 0~1（100%以內，只能縮小
               不能放大），但Circle的工單商品比例有「大=120%」這種超過100%的情況，
               所以把上限從1放寬到3（300%），下限維持>0。這是唯一一處刻意偏離原始
               搬過來的邏輯，其他都原封不動。 */
            var initScaleMul = (typeof ratio === 'number' && ratio > 0 && ratio <= 3) ? ratio : 1;
            slots[slotId] = { x: x, y: y, w0: w0, h0: h0, scaleMul: initScaleMul, shadowScaleX: 1, shadowScaleY: 1, tight: tight };
            /* 這個版型的素材是不是第一次全部到齊了？到齊的話做一次整體水平置中校正，
               見上面 maybeApplyGroupCenter() 的說明。 */
            maybeApplyGroupCenter();
          } else {
            /* 換圖時（例如同一個slot被重新指定新素材）一定要用「新圖片本身」的長寬比
               重新算 w0，不能直接沿用舊的 w0！舊寫法只更新 tight、完全不動 w0/h0，
               等於用舊照片的窄長比例框去套新的正方形/不同比例圖片，畫出來會被硬擠成
               細長形——這正是商品換圖後「變形」的原因。固定保留 h0（使用者原本調整過
               的視覺高度不變），用新圖片的實際寬高比重新算 w0，兩者相除永遠等於新圖片
               真正的寬高比，不會拉伸。 */
            slots[slotId].w0 = img.naturalWidth * (slots[slotId].h0 / img.naturalHeight);
            slots[slotId].tight = tight;
          }
          if (redraw) redraw();
        });
      };
      img.src = dataUrl;
    }
    function removeSlot(slotId, redraw){
      delete slots[slotId];
      delete slotType[slotId];
      ShadowPlugin.removeProduct(slotId);
      setSelection(selectedIds.filter(function(id){ return id !== slotId; }));
      if (redraw) redraw();
    }

    // 處理從 editor 端（shadow-editor-plugin.js）廣播來的訊息。
    // redraw：你自己的 draw() 函式，處理完狀態後會呼叫它重繪。
    function handleMessage(msg, redraw){
      if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('LC_') !== 0) return;
      switch (msg.type){
        case 'LC_SET_BG':
          bgImg = new Image();
          bgImg.onload = function(){ ShadowPlugin.setBackground(bgImg); if (redraw) redraw(); };
          bgImg.src = msg.dataUrl;
          break;
        case 'LC_SET_ANGLE':
          ShadowPlugin.setAngle(msg.preset);
          if (redraw) redraw();
          break;
        case 'LC_UPSERT_SLOT':
          upsertSlot(msg.slotId, msg.slotType, msg.dataUrl, redraw, msg.ratio, msg.transform);
          break;
        case 'LC_REMOVE_SLOT':
          removeSlot(msg.slotId, redraw);
          break;
        case 'LC_SET_ENABLED':
          enabledIds = msg.ids || [];
          if (msg.combo !== undefined){
            console.log('[shadow-debug] 收到 LC_SET_ENABLED，版型從 ' + JSON.stringify(currentComboLetter) + ' 更新為 ' + JSON.stringify(msg.combo));
            currentComboLetter = msg.combo;
          } else {
            console.log('[shadow-debug] 收到 LC_SET_ENABLED，但這則訊息沒有帶 combo 欄位（目前仍是 ' + JSON.stringify(currentComboLetter) + '）');
          }
          setSelection(selectedIds.filter(function(id){ return enabledIds.indexOf(id) !== -1; }));
          if (redraw) redraw();
          break;
      }
    }

    // 選用：接上拖曳移動＋四角控制點縮放的滑鼠/觸控互動。
    // 不需要使用者在這個版位個別調整位置的話（例如座標是從別處正規化廣播過來），就不要呼叫這個。
    function attachPointerEvents(redraw){
      function pos(e){
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
        var p = e.touches ? e.touches[0] : e;
        return { x:(p.clientX-rect.left)*scaleX, y:(p.clientY-rect.top)*scaleY };
      }
      function hitTestHandle(slotId, p){
        var b = itemBounds(slotId);
        var hs = Math.max(8, canvas.width*0.012) * 2.2; /* 放寬四角控制點的可點擊範圍，四個角都比照同一個尺寸，方便從任一角拖曳縮放，不會只有右下角好點 */
        var corners = { tl:[b.left,b.top], tr:[b.right,b.top], bl:[b.left,b.bottom], br:[b.right,b.bottom] };
        for (var k in corners){ var c = corners[k]; if (Math.abs(p.x-c[0])<=hs && Math.abs(p.y-c[1])<=hs) return k; }
        return null;
      }
      function hitTestBody(slotId, p){
        var b = itemBounds(slotId);
        return p.x>=b.left && p.x<=b.right && p.y>=b.top && p.y<=b.bottom;
      }
      // 跟 hitTestHandle 一樣，但用在多選的聯集外框上
      function hitTestHandleBox(gb, p){
        var hs = Math.max(8, canvas.width*0.012) * 2.2; /* 放寬四角控制點的可點擊範圍，四個角都比照同一個尺寸，方便從任一角拖曳縮放，不會只有右下角好點 */
        var corners = { tl:[gb.left,gb.top], tr:[gb.right,gb.top], bl:[gb.left,gb.bottom], br:[gb.right,gb.bottom] };
        for (var k in corners){ var c = corners[k]; if (Math.abs(p.x-c[0])<=hs && Math.abs(p.y-c[1])<=hs) return k; }
        return null;
      }
      function pointInBox(gb, p){
        return p.x>=gb.left && p.x<=gb.right && p.y>=gb.top && p.y<=gb.bottom;
      }
      // 頂部旋轉把手命中判定：獨立於四角控制點，半徑比角落 handle 稍大一點方便點擊
      function hitTestRotateHandle(slotId, p){
        var b = itemBounds(slotId);
        var rp = rotateHandlePos(b);
        var hr = Math.max(7, canvas.width*0.009) * 1.8;
        return Math.hypot(p.x-rp.x, p.y-rp.y) <= hr;
      }
      // 舞台（毛孩衝蝦米）：跟上面 hitTestHandle/hitTestBody 邏輯一樣，但用 getStageBounds() 取代 itemBounds()
      function hitTestStageHandle(p){
        var b = getStageBounds();
        if (!b) return null;
        var hs = Math.max(8, canvas.width*0.012) * 2.2; /* 放寬四角控制點的可點擊範圍，四個角都比照同一個尺寸，方便從任一角拖曳縮放，不會只有右下角好點 */
        var corners = { tl:[b.left,b.top], tr:[b.right,b.top], bl:[b.left,b.bottom], br:[b.right,b.bottom] };
        for (var k in corners){ var c = corners[k]; if (Math.abs(p.x-c[0])<=hs && Math.abs(p.y-c[1])<=hs) return k; }
        return null;
      }
      function hitTestStageBody(p){
        var b = getStageBounds();
        if (!b) return false;
        return p.x>=b.left && p.x<=b.right && p.y>=b.top && p.y<=b.bottom;
      }

      canvas.addEventListener('pointerdown', function(e){
        var p = pos(e);

        // 舞台已選取時，優先檢查是不是要拖角縮放（handle 通常比商品小，優先判定避免被商品搶走）
        if (stageState.selected){
          var stageCorner = hitTestStageHandle(p);
          if (stageCorner){
            var sb0 = getStageBounds();
            interaction = { mode:'stage-resize', corner: stageCorner, startPointer: p,
              startStage: { cx: stageState.cx, cy: stageState.cy, scaleMul: stageState.scaleMul, unitW: sb0.unitW } };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
        }

        // 多選狀態下：先檢查是不是要整組縮放／整組拖曳
        if (selectedIds.length > 1){
          var gb = groupBounds(selectedIds);
          if (gb){
            var gcorner = hitTestHandleBox(gb, p);
            if (gcorner){
              pushUndoSnapshot();
              interaction = {
                mode: 'group-resize', corner: gcorner, startPointer: p,
                center: { x: gb.cx, y: gb.cy },
                startRadius: Math.hypot(p.x-gb.cx, p.y-gb.cy) || 1,
                startSlots: selectedIds.map(function(id){ return { id:id, x:slots[id].x, y:slots[id].y, scaleMul:slots[id].scaleMul }; })
              };
              canvas.setPointerCapture(e.pointerId);
              return;
            }
            if (pointInBox(gb, p)){
              pushUndoSnapshot();
              interaction = {
                mode: 'group-move', startPointer: p,
                startSlots: selectedIds.map(function(id){ return { id:id, x:slots[id].x, y:slots[id].y }; })
              };
              canvas.setPointerCapture(e.pointerId);
              return;
            }
          }
        }

        // 單選狀態：旋轉把手／拖角縮放／拖曳移動
        if (activeSlotId && slots[activeSlotId] && enabledIds.indexOf(activeSlotId)!==-1){
          if (hitTestRotateHandle(activeSlotId, p)){
            var b = itemBounds(activeSlotId);
            var center = { x: (b.left+b.right)/2, y: (b.top+b.bottom)/2 }; // 旋轉樞紐＝選取框幾何中心，要跟 shadow-plugin.js 的 pivot 定義一致
            var startAngle = Math.atan2(p.y-center.y, p.x-center.x) * 180/Math.PI;
            pushUndoSnapshot();
            interaction = { mode:'rotate', slotId: activeSlotId, center: center, startAngle: startAngle, baseRot: slots[activeSlotId].rot || 0 };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
          var corner = hitTestHandle(activeSlotId, p);
          if (corner){
            pushUndoSnapshot();
            interaction = { mode:'resize', corner: corner, startPointer: p, startSlot: Object.assign({}, slots[activeSlotId]) };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
          if (hitTestBody(activeSlotId, p)){
            pushUndoSnapshot();
            interaction = { mode:'move', startPointer: p, startSlot: Object.assign({}, slots[activeSlotId]) };
            canvas.setPointerCapture(e.pointerId);
            return;
          }
        }

        // 點到畫布空白處或其他素材：
        // 有按shift/ctrl/cmd＝多選切換（跟左側清單同一套規則，已選取就移除、沒選取就加入）；
        // 沒按＝重新做單選（會清掉多選狀態）。並通知外部（左側清單）同步。
        var candidates = enabledIds.filter(function(id){ return slots[id]; }).slice().reverse(); // enabledIds 陣列後面＝前景，反轉後優先檢查最上層
        var hit = candidates.find(function(id){ return hitTestBody(id, p); });
        var multiKey = e.shiftKey || e.ctrlKey || e.metaKey;

        if (hit && multiKey){
          var idx = selectedIds.indexOf(hit);
          var next = selectedIds.slice();
          if (idx === -1) next.push(hit); else next.splice(idx, 1);
          setSelection(next);
          parent.postMessage({ type:'LC_SELECTION_CHANGED', slotIds: selectedIds.slice() }, '*');
          if (redraw) redraw();
          return; // 這次mousedown只切換選取狀態，不順便開始拖曳，避免手勢衝突
        }

        if (hit){
          stageState.selected = false; // 選到商品/主持人時，舞台自動取消選取
          setSelection([hit]);
          pushUndoSnapshot();
          interaction = { mode:'move', startPointer: p, startSlot: Object.assign({}, slots[hit]) };
          canvas.setPointerCapture(e.pointerId);
          parent.postMessage({ type:'LC_SELECTION_CHANGED', slotIds: [hit] }, '*');
        } else if (hitTestStageBody(p)){
          // 沒點到任何商品/主持人，但點在舞台範圍內：選取舞台，並直接開始拖曳（跟商品同樣手感）
          setSelection([]);
          stageState.selected = true;
          interaction = { mode:'stage-move', startPointer: p, startStage: { cx: stageState.cx, cy: stageState.cy } };
          canvas.setPointerCapture(e.pointerId);
          parent.postMessage({ type:'LC_SELECTION_CHANGED', slotIds: [] }, '*');
        } else {
          setSelection([]);
          stageState.selected = false;
          parent.postMessage({ type:'LC_SELECTION_CHANGED', slotIds: [] }, '*');
        }
        if (redraw) redraw();
      });
      window.addEventListener('pointerup', function(){ interaction = null; });
      // Ctrl+Z／Cmd+Z：復原上一步位置/縮放/旋轉調整（輸入框打字時不要誤觸發）
      document.addEventListener('keydown', function(e){
        var tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')){
          e.preventDefault();
          undo(redraw);
        }
      });
      // 雙擊旋轉把手：角度歸零
      canvas.addEventListener('dblclick', function(e){
        if (!activeSlotId || !slots[activeSlotId]) return;
        var p = pos(e);
        if (hitTestRotateHandle(activeSlotId, p)){
          slots[activeSlotId].rot = 0;
          if (redraw) redraw();
        }
      });
      canvas.addEventListener('pointermove', function(e){
        if (!interaction) return;
        e.preventDefault();
        var p = pos(e);

        if (interaction.mode === 'stage-move'){
          var sdx = p.x - interaction.startPointer.x, sdy = p.y - interaction.startPointer.y;
          stageState.cx = interaction.startStage.cx + sdx;
          stageState.cy = interaction.startStage.cy + sdy;
          stageState.moved = true; // 手動調過之後，getStageBounds() 就不會再用預設位置蓋掉
          if (redraw) redraw();
          return;
        }
        if (interaction.mode === 'stage-resize'){
          var ss = interaction.startStage;
          var w0 = ss.unitW * ss.scaleMul;
          var h0 = w0 * (_stageImg.naturalHeight / _stageImg.naturalWidth);
          var sb0 = { left: ss.cx - w0/2, top: ss.cy - h0/2, right: ss.cx + w0/2, bottom: ss.cy + h0/2 };
          var sAnchor;
          if (interaction.corner === 'br') sAnchor = [sb0.left, sb0.top];
          else if (interaction.corner === 'bl') sAnchor = [sb0.right, sb0.top];
          else if (interaction.corner === 'tr') sAnchor = [sb0.left, sb0.bottom];
          else sAnchor = [sb0.right, sb0.bottom];
          var newSW = Math.abs(p.x - sAnchor[0]);
          var newSScale = Math.max(0.15, Math.min(6, newSW / ss.unitW));
          var newSH = (ss.unitW * newSScale) * (_stageImg.naturalHeight / _stageImg.naturalWidth);
          stageState.scaleMul = newSScale;
          if (interaction.corner === 'br' || interaction.corner === 'tr'){ stageState.cx = sAnchor[0] + newSW/2; }
          else { stageState.cx = sAnchor[0] - newSW/2; }
          if (interaction.corner === 'bl' || interaction.corner === 'br'){ stageState.cy = sAnchor[1] + newSH/2; }
          else { stageState.cy = sAnchor[1] - newSH/2; }
          stageState.moved = true;
          if (redraw) redraw();
          return;
        }

        if (interaction.mode === 'rotate'){
          var active0 = slots[interaction.slotId];
          if (!active0) return;
          var curAngle = Math.atan2(p.y-interaction.center.y, p.x-interaction.center.x) * 180/Math.PI;
          var next = normalizeDeg(interaction.baseRot + (curAngle - interaction.startAngle));
          if (e.shiftKey) next = Math.round(next / ROT_SNAP_DEG) * ROT_SNAP_DEG;
          active0.rot = next;
          if (redraw) redraw();
          return;
        }

        if (interaction.mode === 'group-move'){
          var dx = p.x - interaction.startPointer.x, dy = p.y - interaction.startPointer.y;
          interaction.startSlots.forEach(function(s0){
            var active = slots[s0.id];
            if (active){ active.x = s0.x + dx; active.y = s0.y + dy; }
          });
          if (redraw) redraw();
          return;
        }
        if (interaction.mode === 'group-resize'){
          // 以整組外框中心為準等比例縮放：目前指標離中心的距離 ÷ 一開始離中心的距離＝縮放倍率
          var newRadius = Math.hypot(p.x-interaction.center.x, p.y-interaction.center.y) || 1;
          var factor = Math.max(0.1, Math.min(8, newRadius / interaction.startRadius));
          interaction.startSlots.forEach(function(s0){
            var active = slots[s0.id];
            if (!active) return;
            active.x = interaction.center.x + (s0.x - interaction.center.x) * factor;
            active.y = interaction.center.y + (s0.y - interaction.center.y) * factor;
            active.scaleMul = Math.max(0.05, Math.min(10, s0.scaleMul * factor));
          });
          if (redraw) redraw();
          return;
        }

        if (!activeSlotId) return;
        var active = slots[activeSlotId];
        if (!active) return;
        var dx2 = p.x - interaction.startPointer.x;
        var dy2 = p.y - interaction.startPointer.y;
        var s = interaction.startSlot;
        if (interaction.mode === 'move'){
          active.x = s.x + dx2; active.y = s.y + dy2;
        } else if (interaction.mode === 'resize'){
          var b0 = { left: s.x - (s.w0*s.scaleMul)/2, top: s.y - (s.h0*s.scaleMul), right: s.x + (s.w0*s.scaleMul)/2, bottom: s.y };
          var anchor;
          if (interaction.corner === 'br') anchor = [b0.left, b0.top];
          else if (interaction.corner === 'bl') anchor = [b0.right, b0.top];
          else if (interaction.corner === 'tr') anchor = [b0.left, b0.bottom];
          else anchor = [b0.right, b0.bottom];
          var newW = Math.abs(p.x - anchor[0]);
          var newScale = Math.max(0.15, Math.min(6, newW / s.w0));
          var newH = s.h0 * newScale;
          active.scaleMul = newScale;
          if (interaction.corner === 'br' || interaction.corner === 'tr'){ active.x = anchor[0] + newW/2; }
          else { active.x = anchor[0] - newW/2; }
          if (interaction.corner === 'bl' || interaction.corner === 'br'){ active.y = anchor[1] + newH; }
          else { active.y = anchor[1]; }
        }
        if (redraw) redraw();
      }, { passive:false });
    }

    return {
      drawItems: drawItems,
      drawStage: drawStage,
      setStageScale: setStageScale,
      getStageScale: getStageScale,
      isStageSelected: isStageSelected,
      deselectStage: deselectStage,
      handleMessage: handleMessage,
      attachPointerEvents: attachPointerEvents,
      /* 給左側「圖層清單」用：點清單項目直接指定選取，不受畫布上重疊順序影響（單選） */
      setActiveSlot: function(slotId, redraw){
        setSelection(slotId ? [slotId] : []);
        if (redraw) redraw();
      },
      getActiveSlot: function(){ return activeSlotId; },
      /* 給左側「圖層清單」用：一次指定多個選取項目（shift/ctrl 多選），可以整組拖曳/縮放 */
      setSelectedSlots: function(ids, redraw){
        setSelection(ids || []);
        if (redraw) redraw();
      },
      getSelectedSlots: function(){ return selectedIds.slice(); },
      /* 目前生效中的疊放順序（陣列前面＝後方，後面＝前方），拖曳排序清單可以拿這個當初始值 */
      getEnabledOrder: function(){ return enabledIds.slice(); },
      /* 目前排序好、可直接丟給 ShadowPlugin.renderScene / renderPhotosOnly 的狀態陣列（給匯出分層合成用） */
      getOrderedStates: function(){ return enabledIds.map(getState).filter(Boolean); },
      /* 給外部程式化設定旋轉角度用（例如之後想加「輸入角度數字」的介面） */
      setRotation: function(slotId, deg, redraw){
        if (!slots[slotId]) return;
        slots[slotId].rot = normalizeDeg(deg);
        if (redraw) redraw();
      },
      getRotation: function(slotId){ return slots[slotId] ? (slots[slotId].rot || 0) : 0; },
      /* 陰影獨立 X/Y 縮放（功能B）：只影響 ShadowPlugin 畫陰影時吃的 spw/sph，
         完全不動這個slot的x/y/w0/h0/scaleMul，商品照片本體大小/位置不受影響。
         axis 是 'x' 或 'y'；val 是倍率（1 = 100%，跟商品原始寬高一致）。 */
      setShadowScale: function(slotId, axis, val, redraw){
        if (!slots[slotId] || typeof val !== 'number' || val <= 0) return;
        if (axis === 'x') slots[slotId].shadowScaleX = val;
        else if (axis === 'y') slots[slotId].shadowScaleY = val;
        if (redraw) redraw();
      },
      getShadowScale: function(slotId){
        var s = slots[slotId];
        return { x: s ? (s.shadowScaleX || 1) : 1, y: s ? (s.shadowScaleY || 1) : 1 };
      },
      /* 復原（Ctrl+Z）：見上方 pushUndoSnapshot()/undo() 的註解，只涵蓋位置/縮放/旋轉，最多5步 */
      undo: undo,
      peekUndoTs: peekUndoTs,
      /* 給呼叫端（shadow-popup.js）讀出某個slot目前的原始x/y/w0/h0/scaleMul/rot，
         用來存回S.shadowSlots[slotId].transform，這樣下次重開popup才能還原
         使用者調整過的結果，不會被layout預設值蓋掉。找不到這個slot回傳null。 */
      getSlotRaw: function(slotId){
        var s = slots[slotId];
        if(!s) return null;
        return { x:s.x, y:s.y, w0:s.w0, h0:s.h0, scaleMul:s.scaleMul, rot:s.rot||0,
          shadowScaleX:s.shadowScaleX||1, shadowScaleY:s.shadowScaleY||1 };
      }
    };
  }

  return { create: create };
})();
