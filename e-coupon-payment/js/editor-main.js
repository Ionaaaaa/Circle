'use strict';

var bundles = {};   // layoutId -> Core.loadLayout() 回傳的物件（快取，跨分頁共用不用重複讀取）
var canvases = {};  // layoutId -> canvas DOM（每次重建畫布區時會換掉）

/* ══════════════════ 文案分組輔助函式 ══════════════════
   見js/editor-state.js的S.textGroups/S.layoutTextGroup說明。 */

/* 這個版位實際套用哪一組文案（沒特別指定就預設'文案1'） */
function groupKeyForLayout(layoutId){
  return (S.layoutTextGroup && S.layoutTextGroup[layoutId]) || '文案1';
}

/* 右側面板目前顯示/可編輯的那一組文案物件——沒有就現生一組空的，
   不會讓面板打字打到undefined上。 */
function activeText(){
  if(!S.textGroups) S.textGroups = {};
  if(!S.textGroups[S.activeTextGroup]) S.textGroups[S.activeTextGroup] = emptyTextGroup();
  return S.textGroups[S.activeTextGroup];
}

/* 這個分頁目前總共有幾組文案(通常1組，媽咪會員這種案子可能2組)，
   依組別分別列出各自套用哪些版位，給切換UI跟畫布標示用。
   回傳 [{key:'文案1', layoutIds:['11_lpbn_app',...]}, ...]，
   順序照S.textGroups物件本身的key順序（建立時的順序，即Excel或使用者手動加組的順序）。 */
function listTextGroupsInUse(){
  var keys = Object.keys(S.textGroups || {});
  return keys.map(function(key){
    var layoutIds = activeLayouts().filter(function(l){ return groupKeyForLayout(l.id) === key; }).map(function(l){ return l.id; });
    return { key: key, layoutIds: layoutIds };
  });
}

/* 切到某一組文案：只是換S.activeTextGroup+刷新右側輸入框顯示值，
   不影響畫布渲染（畫布永遠各自照layoutTextGroup畫，不受這裡影響）。 */
function switchActiveTextGroup(key){
  if(!S.textGroups[key]) return;
  S.activeTextGroup = key;
  syncTextPanelFromActiveGroup();
  buildTextGroupSwitcher(); // 重畫切換鈕的active樣式
  highlightCanvasBlocksForActiveGroup();
}

/* 右側「文案」標題下的切換鈕：只有一個分頁內有2組(以上)文案時才顯示，
   只有1組時完全隱藏、不佔位置，不會讓沒有這個需求的分頁畫面多長東西出來。 */
function buildTextGroupSwitcher(){
  var el = document.getElementById('text-group-switcher');
  if(!el) return;
  var groups = listTextGroupsInUse();
  if(groups.length <= 1){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.style.gap = '6px';
  el.style.flexWrap = 'wrap';
  el.innerHTML = groups.map(function(g){
    var names = g.layoutIds.map(function(id){
      var l = LAYOUT_REGISTRY.find(function(x){ return x.id===id; });
      return l ? l.name : id;
    }).join('、') || '（尚無版位套用）';
    var active = (g.key === S.activeTextGroup);
    return '<button type="button" class="tbtn'+(active?' primary':'')+'" style="font-size:11px;padding:5px 10px;" '+
      'title="套用版位：'+esc(names)+'" onclick="switchActiveTextGroup(\''+g.key+'\')">'+esc(g.key)+'</button>';
  }).join('');
}

/* 把畫布上每個版位的canvas-meta列標示成目前是哪一組文案在用、
   並且讓目前active那組對應的版位有明顯的外框提示（使用者點了切換鈕，
   或點了畫布本身之後，要能一眼看出「現在編輯的是哪幾個版位」）。 */
function highlightCanvasBlocksForActiveGroup(){
  activeLayouts().forEach(function(layout){
    var block = document.getElementById('canvas-block-'+layout.id);
    if(!block) return;
    var isActive = groupKeyForLayout(layout.id) === S.activeTextGroup;
    block.classList.toggle('canvas-block-active-group', isActive);
  });
}

/* ══════════════════ 畫布區 + 素材清單 ══════════════════ */

/* 這個分頁實際要畫哪幾張畫布、依什麼順序——直接照S.instances（見
   js/editor-state.js的說明）逐一轉成LAYOUT_REGISTRY慣用的{id,name,configFile}
   形狀，buildCanvasArea()/downloadSingle()等既有邏輯完全不用改，因為
   拿到的還是同樣形狀的物件，只是這次id可能是動態註冊出來的複製實例id。
   S.instances是null的話（還沒有工單資料的全新分頁），退回用
   S.activeLayoutIds篩LAYOUT_REGISTRY原本順序，行為跟以前一樣。 */
function activeLayouts(){
  if(S.instances && S.instances.length){
    return S.instances.map(function(inst){
      ensureDynamicLayoutRegistered(inst.instanceId, inst.layoutId, inst.label);
      return LAYOUT_REGISTRY.find(function(l){ return l.id === inst.instanceId; });
    }).filter(Boolean);
  }
  return LAYOUT_REGISTRY.filter(function(l){ return S.activeLayoutIds.indexOf(l.id) >= 0; });
}

function buildCanvasArea(){
  var area = document.getElementById('canvas-area');
  area.innerHTML = '';
  canvases = {};
  _hostSelected = {};

  var loaders = activeLayouts().map(function(layout){
    var block = document.createElement('div');
    block.className = 'canvas-block';
    block.id = 'canvas-block-'+layout.id;
    var groupKey = groupKeyForLayout(layout.id);
    block.innerHTML =
      '<div class="canvas-meta" data-layout-id="'+layout.id+'" style="cursor:pointer;" title="點這裡：右側文案面板切換成這個版位對應的那組文案">'+
        '<span class="canvas-name">'+layout.name+'</span>'+
        '<span class="canvas-group-tag" style="font-size:10px;color:var(--text-dim);border:1px solid var(--border);border-radius:8px;padding:1px 6px;margin-left:6px;">'+esc(groupKey)+'</span>'+
        '<span style="flex:1"></span>'+
        '<button class="mini-dl-btn" onclick="event.stopPropagation();openPositionEditor(\''+layout.id+'\')">'+ICON_GEAR+' 調整位置</button>'+
        '<button class="mini-dl-btn" onclick="event.stopPropagation();reopenProductShadowPopup()" title="重新打開商品/主持人1200畫布，可以調整位置、或編輯券樣內容">'+ICON_GEAR+' 商品/主持人</button>'+
        '<button class="mini-dl-btn" onclick="event.stopPropagation();downloadSingle(\''+layout.id+'\')">'+ICON_DOWNLOAD+' 下載</button>'+
      '</div>'+
      '<div class="canvas-wrap"><canvas id="cv-'+layout.id+'"></canvas></div>';
    area.appendChild(block);
    block.querySelector('.canvas-meta').addEventListener('click', function(){
      switchActiveTextGroup(groupKeyForLayout(layout.id));
    });
    canvases[layout.id] = block.querySelector('#cv-'+layout.id);
    attachHostDragResize(canvases[layout.id], layout.id);

    if(bundles[layout.id]) return Promise.resolve();
    return Core.loadLayout(layout.configFile).then(function(bundle){
      bundles[layout.id] = bundle;
    });
  });

  return Promise.all(loaders).then(function(){
    renderAll();
    buildAssetList();
    buildLayoutToggleList();
    buildTextGroupSwitcher();
    highlightCanvasBlocksForActiveGroup();
  });
}

function renderAll(){
  ensureHostAutoFit();
  activeLayouts().forEach(function(layout){
    var bundle = bundles[layout.id];
    var canvas = canvases[layout.id];
    if(bundle && canvas){
      /* 這個版位吃哪一組文案，就臨時做一份「借用該組text」的state物件給
         Core.render用——不直接改S.text（S根本沒有text這個欄位了，見
         editor-state.js），也不會互相干擾：淺拷貝一份S，只覆寫text這個key，
         其他(assets/combo/positionOverrides等)全部还是同一份參照，
         跟真正的S完全同步，不用擔心拷貝出來的資料舊掉。 */
      var groupText = (S.textGroups && S.textGroups[groupKeyForLayout(layout.id)]) || emptyTextGroup();
      var renderState = Object.assign({}, S, { text: groupText });
      Core.render(canvas, bundle, renderState, layout.id);
      drawHostOverlay(canvas, layout.id);
    }
  });
}

/* ══════════════════ 直接在主畫布上拖曳/縮放商品(host) ══════════════════
   參考你另一份pet-frenzy專案的做法——每個版位的畫布本身就能直接拖曳/縮放
   合成好的商品圖，不用像現在Circle這樣一定要另外開「調整位置」popup才能調。
   這裡補上等價的功能：直接對canvas元素綁pointer事件，命中商品(host)方框
   內部就是移動、命中右下角控制點就是縮放（跟「調整位置」popup同一套手感：
   拖右下角只調高度，寬度依圖片比例自動跟著變，不會變形），調整結果直接寫進
   S.positionOverrides［跟popup、跟作圖區自動貼合是同一份資料，三個入口
   互通、不會互相打架）。
   只做商品(host)這一個素材，logo1/logo2目前還是要走「調整位置」popup——
   商品是使用者最常需要微調大小的素材，這裡優先做；logo之後有需要再加。 */
var _hostSelected = {};    // layoutId -> boolean，目前是否顯示選取框/控制點
var _hostInteraction = null; // 目前拖曳中的互動狀態（同時只會拖一個版位）

function getHostBox(layoutId){
  var bundle = bundles[layoutId];
  var img = S.assets && S.assets.host;
  if(!bundle || !(img instanceof HTMLImageElement) || !img.complete || !img.naturalWidth) return null;
  var override = S.positionOverrides && S.positionOverrides[layoutId];
  var merged = Core.mergePositions(bundle.positions, override);
  var pos = merged.assets && merged.assets.host;
  if(!pos) return null;
  var w = bundle.layoutConfig.canvas.w, h = bundle.layoutConfig.canvas.h;
  var boxH = pos.hPct * h;
  var ratio = img.naturalWidth / img.naturalHeight;
  var boxW = boxH * ratio;
  var anchorX = pos.xPct * w, anchorY = pos.yPct * h;
  var left = (pos.align === 'center') ? anchorX - boxW/2 : anchorX;
  var top = anchorY;
  /* 選取框/點擊判定要用「有色範圍」，不是整張圖（含透明留白）的滿版範圍——
     跟shadow-layout-receiver.js裡1200畫布的做法一致（同一個道理：使用者
     點擊/看到的選取框，感覺上應該貼著實際看得到的商品輪廓，不是貼著圖檔
     本身可能留白的邊界）。實際拖曳/縮放調整的還是底層的xPct/yPct/hPct
     （控制整張圖怎麼畫），colorBox只是「這次要拿哪個矩形當選取框跟碰撞
     判定」，兩者用同一個縮放比例，所以拖曳的手感（滑鼠移多少、框跟著移多少）
     是一致的，不會不同步。 */
  var tight = Core.calcTightBoundsRatio(img);
  var colorBox = tight
    ? { left: left + tight.tx*boxW, top: top + tight.ty*boxH, w: tight.tw*boxW, h: tight.th*boxH }
    : { left:left, top:top, w:boxW, h:boxH };
  return { left:left, top:top, w:boxW, h:boxH, pos:pos, canvasW:w, canvasH:h, colorBox:colorBox };
}

function drawHostOverlay(canvas, layoutId){
  if(!_hostSelected[layoutId]) return;
  var box = getHostBox(layoutId);
  if(!box) return;
  var cb = box.colorBox;
  var ctx = canvas.getContext('2d');
  ctx.save();
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = Math.max(1.5, canvas.width*0.0025);
  ctx.strokeRect(cb.left, cb.top, cb.w, cb.h);
  var hs = Math.max(10, canvas.width*0.02);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#22c55e';
  /* 四個角都要有控制點，跟1200畫布(shadow-layout-receiver.js)同一套手感——
     原本只有右下角一個，只能單向放大縮小，使用者反映不方便。 */
  [
    [cb.left,        cb.top],
    [cb.left+cb.w,   cb.top],
    [cb.left,        cb.top+cb.h],
    [cb.left+cb.w,   cb.top+cb.h]
  ].forEach(function(c){
    ctx.beginPath();
    ctx.rect(c[0]-hs/2, c[1]-hs/2, hs, hs);
    ctx.fill(); ctx.stroke();
  });
  ctx.restore();
}

/* 只重畫版位本身的內容，不畫綠色選取框/控制點——drawHostOverlay()是直接畫在
   跟畫面顯示同一個canvas上的（不是獨立疊一層），所以「目前有沒有選取商品」
   會直接影響這個canvas實際的像素內容。下載/匯出前一定要呼叫這個函式重畫
   一次乾淨版本，不然選取框會被一起轉出到下載的圖檔裡——使用者反映的
   「下載的圖片如果畫布中有選取商品，選取框會被一起轉出」就是這個原因。 */
function renderLayoutClean(layoutId){
  var bundle = bundles[layoutId];
  var canvas = canvases[layoutId];
  if(bundle && canvas){
    var groupText = (S.textGroups && S.textGroups[groupKeyForLayout(layoutId)]) || emptyTextGroup();
    var renderState = Object.assign({}, S, { text: groupText });
    Core.render(canvas, bundle, renderState, layoutId);
  }
}

function commitHostPos(layoutId, pos){
  S.positionOverrides = S.positionOverrides || {};
  S.positionOverrides[layoutId] = S.positionOverrides[layoutId] || {};
  S.positionOverrides[layoutId].assets = S.positionOverrides[layoutId].assets || {};
  var img = S.assets && S.assets.host;
  S.positionOverrides[layoutId].assets.host = {
    xPct: pos.xPct, yPct: pos.yPct, hPct: pos.hPct, align: pos.align,
    /* 蓋章目前這張host圖片的src——跟ensureHostAutoFit()/openPositionEditor
       writeBack()同一套判斷：這張圖在這個版位已經調整過了，換一張新圖之前
       都不會被自動貼合蓋掉。 */
    _srcTag: img ? img.src : undefined
  };
  renderAll();
}

function attachHostDragResize(canvas, layoutId){
  function toCanvasPos(e){
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
    var p = e.touches ? e.touches[0] : e;
    return { x:(p.clientX-rect.left)*scaleX, y:(p.clientY-rect.top)*scaleY };
  }
  /* 找離指定點最近的一個角控制點（四選一），太遠就回傳null。
     跟1200畫布(shadow-layout-receiver.js)的四角判定邏輯一致，只是這裡的
     控制點畫在colorBox(有色範圍)角落，不是整張圖(含透明留白)的角落。 */
  function nearestCorner(p, cb, hs){
    var corners = {
      tl: [cb.left,      cb.top],
      tr: [cb.left+cb.w, cb.top],
      bl: [cb.left,      cb.top+cb.h],
      br: [cb.left+cb.w, cb.top+cb.h]
    };
    var best = null, bestDist = hs;
    Object.keys(corners).forEach(function(k){
      var d = Math.max(Math.abs(p.x-corners[k][0]), Math.abs(p.y-corners[k][1]));
      if(d < bestDist){ bestDist = d; best = k; }
    });
    return best;
  }
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', function(e){
    var box = getHostBox(layoutId);
    if(!box){
      if(_hostSelected[layoutId]){ _hostSelected[layoutId] = false; renderAll(); }
      return;
    }
    var p = toCanvasPos(e);
    var cb = box.colorBox;
    var hs = Math.max(10, canvas.width*0.02);
    var corner = nearestCorner(p, cb, hs);
    var insideBox = p.x>=cb.left && p.x<=cb.left+cb.w && p.y>=cb.top && p.y<=cb.top+cb.h;
    if(!corner && !insideBox){
      if(_hostSelected[layoutId]){ _hostSelected[layoutId] = false; renderAll(); }
      return;
    }
    e.preventDefault();
    _hostSelected[layoutId] = true;
    canvas.setPointerCapture(e.pointerId);
    _hostInteraction = {
      layoutId: layoutId,
      mode: corner ? 'resize' : 'move',
      corner: corner,
      startPointer: p,
      startPos: Object.assign({}, box.pos),
      startColorBox: { left:cb.left, top:cb.top, w:cb.w, h:cb.h },
      tight: Core.calcTightBoundsRatio(S.assets.host) || { tx:0, ty:0, tw:1, th:1 },
      ratio: box.w / box.h, // 整張圖(含透明留白)的寬高比，resize時用這個把高度換算回寬度，維持不變形
      canvasW: box.canvasW,
      canvasH: box.canvasH
    };
    renderAll();
  });
  canvas.addEventListener('pointermove', function(e){
    var it = _hostInteraction;
    if(!it || it.layoutId !== layoutId) return;
    e.preventDefault();
    var p = toCanvasPos(e);
    var newPos = Object.assign({}, it.startPos);
    if(it.mode === 'move'){
      newPos.xPct = it.startPos.xPct + (p.x - it.startPointer.x) / it.canvasW;
      newPos.yPct = it.startPos.yPct + (p.y - it.startPointer.y) / it.canvasH;
    } else {
      /* 四角resize：被拖的角移動，對角(anchor)維持在原本的像素位置不動——
         跟1200畫布同一套邏輯。只用垂直距離算新高度(維持「拖曳手感=上下
         移動決定大小」的原本習慣)，寬度用圖片原始寬高比自動換算，不會
         變形。tight是有色範圍佔整張圖的比例，anchor角只是colorBox的某個
         角，要先換算回「整張圖(含透明留白)」的box角落，再回推xPct/yPct。 */
      var cb0 = it.startColorBox, tight = it.tight, ratio = it.ratio;
      var corner = it.corner;
      var anchorIsTop = (corner === 'bl' || corner === 'br'); // 拖的是下方角 → anchor在上方
      var anchorIsLeft = (corner === 'tr' || corner === 'br'); // 拖的是右邊角 → anchor在左邊
      var anchorX = anchorIsLeft ? cb0.left : cb0.left + cb0.w;
      var anchorY = anchorIsTop ? cb0.top : cb0.top + cb0.h;

      var newH;
      if(anchorIsTop){ newH = (p.y - anchorY) / tight.th; }
      else { newH = (anchorY - p.y) / tight.th; }
      newH = Math.max(4, newH);
      var newW = newH * ratio;

      var newBoxLeft = anchorIsLeft ? (anchorX - tight.tx*newW) : (anchorX - (tight.tx+tight.tw)*newW);
      var newBoxTop  = anchorIsTop  ? (anchorY - tight.ty*newH) : (anchorY - (tight.ty+tight.th)*newH);

      newPos.hPct = newH / it.canvasH;
      newPos.yPct = newBoxTop / it.canvasH;
      newPos.xPct = (it.startPos.align === 'center') ? (newBoxLeft + newW/2) / it.canvasW : newBoxLeft / it.canvasW;
    }
    commitHostPos(layoutId, newPos);
  });
  ['pointerup','pointercancel'].forEach(function(evt){
    canvas.addEventListener(evt, function(){
      if(_hostInteraction && _hostInteraction.layoutId === layoutId) _hostInteraction = null;
    });
  });
}

/* ══════════════════ 商品(host)自動貼合「作圖區」══════════════════
   有artZone設定的版位，第一次收到商品圖時，用「有色範圍(去掉圖片本身的
   透明留白)填滿作圖區、水平置中、頂部對齊、再放大」自動算一次初始位置/
   大小，寫進S.positionOverrides[layoutId].assets.host。

   ★ 2026-08 修正「重新廣播商品會蓋掉手動調整過的位置」：原本判斷「要不要
   重新自動貼合」的方式是比對_srcTag跟目前S.assets.host.src是不是同一張圖，
   想法是「同一張圖=使用者調過了、不要蓋掉；換了新圖=真的要重新貼合」。
   但S.assets.host其實是1200畫布「確認並套用」時透過URL.createObjectURL()
   產生的blob URL，每按一次確認、即使畫面內容幾乎沒變，也一定會產生一個
   全新的blob URL字串——所以只要重新廣播一次，_srcTag永遠對不上，等於
   每次重新廣播都會被判定成「換了新圖」，重新自動貼合一次，蓋掉使用者在
   個別版位手動調整過的大小/位置。

   改成：只要這個版位的host已經有過override（不管是自動貼合出來的、還是
   使用者手動調整過的），就不再重新自動貼合，只有「這個版位這個分頁裡
   從來沒有過host位置資料」才會自動貼合——也就是「只有第一次廣播會自動
   貼合，之後不管重新廣播幾次，都維持目前(可能是使用者調整過)的位置」，
   符合「除了第一次廣播，後面更新都用調整後的位置」的需求。

   ★ 2026-08再修正「作圖區被壓縮太多、商品被CTA/遮罩擋住卡不下去」：
   之前為了不讓商品蓋到CTA/底部遮罩，做法是直接把positions.json裡
   artZone本身縮小（bottom往上收）。但這樣等於把「使用者以後想手動調整
   的可用範圍」也一起縮小了——使用者反映：作圖範圍(拿來給logo-module.js
   做clip、以及以後想手動拖曳/放大時參考的邊界)應該維持完整、到畫布最底，
   商品放進去之後想不想蓋到CTA/遮罩，應該讓使用者自己手動決定，程式不該
   幫他鎖死。真正該縮小的，只有「第一次自動貼合時預設算出來的大小/位置」，
   避免商品一進來就預設卡到CTA/遮罩，之後這個位置使用者仍然可以自己往下
   調整覆蓋過去。

   做法：baseHost.artZone維持「完整版」不動（bottom/right都是真正的畫布
   邊界，clip也用這個範圍，不會提早裁切）；如果baseHost.initialReserve
   有值（{bottom, right}，單位px），只在「第一次自動貼合」這一次的計算
   時，另外算一個「縮小版」的暫時zone丟給calcArtZoneFit()，不會回寫、
   不會影響到baseHost.artZone本身。 */
function ensureHostAutoFit(){
  /* 電子票券繳費專案新增：這個版本有沒有舞台(configs/theme.json的hasStage，
     目前只有A/C是true)，商品廣播出來的放法不一樣——
       - 有舞台(A/C)：商品要比沒舞台的版本再放大一點(zone.enlargeWithStage，
         沒填就退回跟zone.enlarge一樣，不強制要求每個版位都要另外設定)，
         上方貼頂、下方允許超出畫布（本來就會被裁掉或蓋在CTA/遮罩下面，
         舞台站著的視覺效果需要這樣）。
       - 沒舞台(其餘版本)：維持原本的行為，上方貼頂、下方不能超出畫布
         （見下面clampFitBottomToCanvas()，因為沒舞台的話「有色範圍」全部
         都是商品本身，超出去等於商品被硬裁切，不像有舞台時裁掉的是舞台
         底座、商品主體不受影響）。
     每個版位的host artZone設定要不要提供enlargeWithStage是選填的——沒有
     A/C專屬放大倍率的版位，就跟沒舞台版本套用一樣的enlarge，不會出錯，
     只是沒有放大效果而已。 */
  var hasStageVersion = !!(window.Theme && window.Theme.hasStage);

  activeLayouts().forEach(function(layout){
    var bundle = bundles[layout.id];
    if(!bundle || !bundle.positions) return;
    var baseHost = bundle.positions.assets && bundle.positions.assets.host;
    var zone = baseHost && baseHost.artZone;
    if(!zone) return; // 這個版位沒設定作圖區，不受影響，維持原來的行為

    var img = S.assets && S.assets.host;
    if(!(img instanceof HTMLImageElement) || !img.complete || !img.naturalWidth) return;

    S.positionOverrides = S.positionOverrides || {};
    S.positionOverrides[layout.id] = S.positionOverrides[layout.id] || {};
    var ov = S.positionOverrides[layout.id];
    ov.assets = ov.assets || {};
    if(ov.assets.host) return; // 這個版位已經貼合過(或使用者調整過)一次了，不管圖片有沒有換都不再自動蓋掉

    var canvasW = bundle.layoutConfig.canvas.w, canvasH = bundle.layoutConfig.canvas.h;
    var effectiveEnlarge = (hasStageVersion && typeof zone.enlargeWithStage === 'number') ? zone.enlargeWithStage : zone.enlarge;
    var zone2 = (effectiveEnlarge !== zone.enlarge) ? Object.assign({}, zone, { enlarge: effectiveEnlarge }) : zone;
    var fitZone = zone2;
    var reserve = baseHost.initialReserve;
    if(reserve){
      var zLeft = zone2.xPct - zone2.wPct/2;
      var zRight = zone2.xPct + zone2.wPct/2;
      var zBottom = zone2.topPct + zone2.hPct;
      var newRight = zRight - (reserve.right||0)/canvasW;
      var newBottom = zBottom - (reserve.bottom||0)/canvasH;
      fitZone = {
        xPct: (zLeft+newRight)/2,
        topPct: zone2.topPct,
        wPct: newRight - zLeft,
        hPct: newBottom - zone2.topPct,
        enlarge: zone2.enlarge
      };
    }

    /* bottomAlignPx（選填，單位px，畫布座標，例如550高的畫布填459）：
       縮放倍率算法完全跟calcArtZoneFit()一樣(照這張圖實際有色範圍，
       取寬高比較吃緊的方向算scale，不同商品組合貼出來的比例仍然會不同)，
       只有「貼在哪個高度」不一樣——不是有色範圍頂部對齊zone頂部，而是
       有色範圍底部對齊這個指定的px數字(例如遮罩最高點的位置)，用在
       LPBN_APP/LPBN_PC這種下面有底部遮罩的版位，見configs/layouts/
       11_lpbn_app-positions.json的host.bottomAlignPx說明。
       ★2026-08修正：有舞台的版本(A/C)使用者確認不用避開遮罩高度，但這裡
       原本不管有沒有舞台都一律套用bottomAlignPx，導致A/C版還是被鎖在
       遮罩上緣、沒有真的允許超出——改成只有沒舞台的版本才用這個對齊法，
       有舞台的版本一律退回單純的頂部對齊(calcArtZoneFit)，不再管遮罩
       高度，讓底部真的可以超出畫布（跟下面clampFitBottomToCanvas也跳過
       是同一個方向的修正）。 */
    var fit = (baseHost.bottomAlignPx && !hasStageVersion)
      ? Core.calcArtZoneFitBottomAlign(img, fitZone, canvasW, canvasH, baseHost.bottomAlignPx)
      : Core.calcArtZoneFit(img, fitZone, canvasW, canvasH);
    /* baseHost.downOffsetPx（選填，單位px，正值＝往下）／baseHost.leftOffsetPx
       （選填，單位px，正值＝往左）：貼合完之後，再整體平移這麼多px，跟
       zone.enlarge是三件獨立的事，互不影響。這次刻意取名「downOffsetPx」
       （不是之前的bottomOffsetPx）——正值就是直接往下，跟講的方向一致，
       不用像之前bottomOffsetPx那樣「正值反而是往上」，容易搞混。 */
    if(baseHost.downOffsetPx){
      fit.yPct += baseHost.downOffsetPx / canvasH;
    }
    /* leftOffsetPx（單純視覺留白用，見各版位positions.json的說明，不是為了
       閃避CTA/遮罩）——有舞台的版本(A/C)使用者確認不需要這個留白，商品
       整體改成自然置中，所以跳過不套用；沒舞台的版本維持原本行為不變。 */
    if(baseHost.leftOffsetPx && !hasStageVersion){
      fit.xPct -= baseHost.leftOffsetPx / canvasW;
    }
    /* 頂部對齊、底部不超出畫布——見core/core.js的clampFitBottomToCanvas()
       說明。放在downOffsetPx/leftOffsetPx都套用完之後才做這個檢查，因為
       downOffsetPx本身也可能是造成超出畫布的原因之一，要用「最終」的
       位置去判斷才準。downOffsetPx如果是很大的負值（例如「整體往上推遮罩
       高度」這種需求），也可能反過來讓頂部超出畫布上緣，所以頂部/底部
       兩個方向都要各自檢查一次，見clampFitTopToCanvas()說明。
       ★有舞台的版本(A/C)刻意跳過底部這個檢查——允許商品底部(其實是舞台
       底座那截)超出畫布，這是這次要的效果；頂部的檢查維持兩種版本都做，
       避免商品/舞台整個往上飄出畫布外緣，看起來更明顯不對勁。 */
    fit = Core.clampFitTopToCanvas(fit, img, canvasH);
    if(!hasStageVersion){
      fit = Core.clampFitBottomToCanvas(fit, img, canvasH);
    }
    ov.assets.host = fit;
  });
}

/* ══════════════════ AUTOSAVE_KEY ══════════════════
   2026-08：使用者明確要求「重新整理＝整個刷掉重來」，不要接續上次的內容，
   所以拿掉了原本「每次renderAll()都debounce寫進localStorage、重新整理時
   自動讀回來」那套自動記住機制（scheduleAutosave()/loadAutosave()都移除了）。
   這個常數還留著，只是給「重設」按鈕跟開啟頁面時清一次localStorage用，
   確保舊版留下來的自動記住資料不會殘留、不小心被讀到。
   想保留工作內容的話，用上面的「儲存暫存」下載一份.json，之後用
   「載入暫存」讀回來，這個手動存讀檔的功能完全不受影響，一樣正常運作。 */
var AUTOSAVE_KEY = 'circle_editor_autosave_v1';

/* 左側「顯示版位」勾選清單：不完全依賴Excel「製作素材」欄位自動判斷
   （filterLayoutsByMaterials()），讓使用者自己也能手動開關某個版位——
   例如新加的版位在某些舊工單格式裡沒被自動偵測到、或想暫時關掉某個
   版位不輸出，都可以直接在這裡勾/取消勾，不用重新匯入工單。 */
function buildLayoutToggleList(){
  var body = document.getElementById('layout-toggle-body');
  if(!body) return;
  /* 排除動態註冊出來的「複製實例」版位(例如HBN週三版'03_c2c_bn__2')——
     這份清單只給使用者手動開關「版位種類」用，複製實例本身不是獨立種類，
     不應該在這裡多長出一個看起來莫名其妙的額外選項。 */
  var aliasBase = window.LAYOUT_ALIAS_BASE || {};
  body.innerHTML = LAYOUT_REGISTRY.filter(function(l){ return !aliasBase[l.id]; }).map(function(l){
    var checked = S.activeLayoutIds.indexOf(l.id) >= 0;
    return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim);cursor:pointer;">'+
      '<input type="checkbox" data-layout-id="'+l.id+'" '+(checked?'checked':'')+'> '+esc(l.name)+
    '</label>';
  }).join('');
  Array.prototype.forEach.call(body.querySelectorAll('input[type=checkbox]'), function(cb){
    cb.onchange = function(){
      var id = cb.dataset.layoutId;
      var idx = S.activeLayoutIds.indexOf(id);
      if(cb.checked){ if(idx<0) S.activeLayoutIds.push(id); }
      else if(idx>=0){ S.activeLayoutIds.splice(idx,1); }
      buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
    };
  });
}

function buildAssetList(){
  var body = document.getElementById('asset-list-body');
  var list = activeLayouts();
  if(!list.length){
    body.innerHTML = '<div class="empty-hint">這個分頁沒有對應到任何版位</div>';
    return;
  }
  body.innerHTML = list.map(function(l){
    return '<div class="asset-item" onclick="scrollToCanvas(\''+l.id+'\')">'+
      '<span class="asset-name">'+l.name+'</span>'+
      '<button class="asset-dl" onclick="event.stopPropagation();downloadSingle(\''+l.id+'\')">'+ICON_DOWNLOAD+'</button>'+
    '</div>';
  }).join('');
}

function scrollToCanvas(id){
  var block = document.getElementById('canvas-block-'+id);
  if(block) block.scrollIntoView({behavior:'smooth', block:'start'});
}

/* ══════════════════ 右側控制面板 ══════════════════ */

/* 有banword警告UI(div#banwarn-KEY)的欄位——跟TEXT_LIMITS（字數上限）是
   兩件事：字數上限只有標題/副標有，但禁用語檢查（例如日期格式相關的規則）
   日期欄位也需要，不能因為日期沒有字數上限就整個跳過禁用語檢查。 */
var BANWORD_CHECK_FIELDS = ['標題','副標','日期'];

/* 文案格式規範（規範表要求）：
   1. 日期欄位不能有補0的數字——例如「01/02」要自動變成「1/2」，「09」變成「9」，
      本來就沒補0的數字、或非數字的字元（斜線、波浪號、"至"...）都不受影響。
   2. 任何欄位裡「$」後面接的整數，自動補上千分位逗號——例如「$1111」變成
      「$1,111」，「$1111.5」變成「$1,111.5」（小數點後面的數字不受影響），
      已經有逗號的維持原樣不會重複處理。
   這裡故意選在「離開欄位(blur)」的時候才格式化，不是每打一個字就重寫一次——
   如果打字當下就立刻拿掉開頭的0，使用者會沒辦法打出「07」這種數字（打第一個
   0就被清空，永遠打不出兩位數），所以等使用者打完、游標離開欄位才處理一次。 */
function normalizeTextValue(key, text){
  if(!text) return text;
  var out = text;
  if(key === '日期'){
    out = out.replace(/(^|[^\d])0+(\d)/g, '$1$2');
  }
  out = out.replace(/\$(\d+)(\.\d+)?/g, function(m, intPart, decPart){
    return '$' + Number(intPart).toLocaleString('en-US') + (decPart || '');
  });
  return out;
}

/* oninput/onblur只在這裡綁一次（讀寫都透過activeText()指向「目前作用中那組」），
   切換文案組(switchActiveTextGroup)時不用重新綁一次事件，只需要呼叫
   syncTextPanelFromActiveGroup()把輸入框顯示值換成新的那組即可。 */
function bindTextInputs(){
  ['標題','副標','日期','AR文案','DPS'].forEach(function(key){
    var el = document.getElementById('input-'+key);
    if(!el) return;
    el.value = activeText()[key] || '';
    el.oninput = function(){
      activeText()[key] = el.value;
      renderAll();
      if(BANWORD_CHECK_FIELDS.indexOf(key) !== -1) updateTextCompliance(key);
    };
    el.onblur = function(){
      var normalized = normalizeTextValue(key, el.value);
      if(normalized !== el.value){
        el.value = normalized;
        activeText()[key] = normalized;
        renderAll();
        if(BANWORD_CHECK_FIELDS.indexOf(key) !== -1) updateTextCompliance(key);
      }
    };
    if(BANWORD_CHECK_FIELDS.indexOf(key) !== -1) updateTextCompliance(key);
  });
}

/* 切換文案組(點畫布或點切換鈕)之後，把右側四個輸入框的「顯示值」換成
   新的active那組資料——不重新綁事件(bindTextInputs已經綁過一次、讀寫都是
   透過activeText()動態指向，本來就會自動對到新的組)，只需要重新塞值進去
   + 重新跑一次字數計燈/禁用語檢查(這兩個是純UI顯示，跟著顯示的那組走)。 */
function syncTextPanelFromActiveGroup(){
  ['標題','副標','日期','AR文案','DPS'].forEach(function(key){
    var el = document.getElementById('input-'+key);
    if(!el) return;
    el.value = activeText()[key] || '';
    if(BANWORD_CHECK_FIELDS.indexOf(key) !== -1) updateTextCompliance(key);
  });
}

/* 文案字數計燈 + 禁用語提示：字數計燈只套用在有設字數上限的欄位(標題/副標，
   見js/banwords.js的TEXT_LIMITS)；禁用語檢查套用在BANWORD_CHECK_FIELDS
   裡的所有欄位（標題/副標/日期），兩者是獨立判斷，日期沒有字數上限一樣
   要跑禁用語檢查。字數超過只是「亮燈提示」，不會擋輸入、也不會擋畫面上
   的即時預覽，真正會擋的時機在下載前（見editor-export.js的
   checkTextComplianceBeforeDownload()）。 */
function updateTextCompliance(key){
  var counterEl = document.getElementById('counter-'+key);
  var warnEl = document.getElementById('banwarn-'+key);
  var text = activeText()[key] || '';
  var limit = TEXT_LIMITS[key];

  if(counterEl && limit !== undefined){
    var weight = computeCharWeight(text);
    var display = (Number.isInteger(weight) ? weight : weight.toFixed(1));
    counterEl.textContent = display+'/'+limit;
    counterEl.classList.toggle('over', weight > limit);
  }

  if(warnEl){
    loadBanwords().then(function(list){
      var hits = checkBanwords(text, list);
      if(!hits.length){ warnEl.style.display = 'none'; warnEl.innerHTML = ''; return; }
      warnEl.style.display = '';
      warnEl.innerHTML = '⚠ 偵測到禁用語：<br>'+hits.map(function(h, i){
        var msg = esc(h.matchedText) + (h.replace ? '（建議改成「'+esc(h.replace)+'」）' : (h.note ? '（'+esc(h.note)+'）' : ''));
        /* 只有算得出明確、安全的替換文字(suggested)時才顯示「套用」按鈕——
           沒有suggested代表這個命中沒辦法自動判斷正確答案，讓使用者自己
           手動改比較保險，不硬套一個可能是錯的值。 */
        if(h.suggested !== null && h.suggested !== undefined && h.suggested !== h.matchedText){
          msg += ' <button type="button" class="banword-apply-btn" data-idx="'+i+'">套用</button>';
        }
        return msg;
      }).join('<br>');
      Array.prototype.forEach.call(warnEl.querySelectorAll('.banword-apply-btn'), function(btn){
        var hit = hits[Number(btn.dataset.idx)];
        btn.onclick = function(){ applyBanwordFix(key, hit); };
      });
    });
  }
}

/* 「套用」按鈕：直接把命中的那段文字換成算好的建議值，不用使用者自己重打。
   只換這一個命中位置（用當下算好的index/matchedText長度去切字串），換完
   立刻重新整段跑一次renderAll()+updateTextCompliance()——不在原本的hits
   陣列上就地修改其他命中的index（換了字之後，後面的文字位置可能全部
   位移，舊的index會失準），而是讓下一輪重新掃描整段文字、拿到全新且
   正確的命中結果，比較保險，也不用自己維護一套「位移補償」的邏輯。 */
function applyBanwordFix(key, hit){
  var text = activeText()[key] || '';
  var newText = text.slice(0, hit.index) + hit.suggested + text.slice(hit.index + hit.matchedText.length);
  activeText()[key] = newText;
  var el = document.getElementById('input-'+key);
  if(el) el.value = newText;
  renderAll();
  updateTextCompliance(key);
}

/* 給下載流程用：檢查目前所有有字數上限的文案欄位，回傳
   {overLimit:[{key,weight,limit}], banned:[{key,hits}]}，兩個陣列都是
   空的代表完全沒問題，呼叫端可以直接放行不用跳警告。
   ★overLimit(字數超過)只看TEXT_LIMITS(標題/副標)；banned(禁用語)看
   BANWORD_CHECK_FIELDS(標題/副標/日期)，兩份清單不一樣，日期字數沒有
   上限但禁用語一樣要檔下載前檢查一次。 */
/* 下載前檢查：這個分頁裡「所有」文案組都要檢查，不是只看右側面板目前
   顯示的那一組——不然沒被點開過、放著沒切換過去看的那組文案(例如文案2)
   超過字數/踩到禁用語，會完全沒被擋到就直接輸出。key前面加上組名前綴
   (例如'文案2 標題')方便使用者知道是哪一組哪個欄位出問題。 */
function checkTextCompliance(){
  return loadBanwords().then(function(list){
    var overLimit = [], banned = [];
    Object.keys(S.textGroups || {}).forEach(function(groupKey){
      var groupText = S.textGroups[groupKey] || {};
      var groupLabel = (Object.keys(S.textGroups).length > 1) ? (groupKey+' ') : '';
      Object.keys(TEXT_LIMITS).forEach(function(key){
        var text = groupText[key] || '';
        var weight = computeCharWeight(text);
        var limit = TEXT_LIMITS[key];
        if(weight > limit) overLimit.push({ key: groupLabel+key, weight:weight, limit:limit });
      });
      BANWORD_CHECK_FIELDS.forEach(function(key){
        var text = groupText[key] || '';
        var hits = checkBanwords(text, list);
        if(hits.length) banned.push({ key: groupLabel+key, hits:hits });
      });
    });
    return { overLimit: overLimit, banned: banned };
  });
}

/* LOGO1/LOGO2已經不再用右側面板的檔案上傳input（LOGO1固定套用預設值+匯入時
   資料夾比對覆蓋；LOGO2改成用js/logo2-editor.js的編輯popup），這裡不用再綁
   任何input了。原本的bindAssetUploads()（綁upload-logo1/upload-logo2這兩個
   input的onchange）已經移除，避免對著HTML裡已經不存在的元素呼叫.onchange
   噴錯誤。 */

/* logo1在pet-frenzy裡其實才是「固定不太會變」的那個（蝦皮直播brand），
   放在logos/資料夾當固定預設檔，跟現在Circle專案的邏輯是同一套：
   logos/logo_shopee_live.png 存在就自動載入當logo1預設值；
   使用者匯入工單時資料夾裡有比對到logo1、或手動上傳，一樣會覆蓋掉這個預設值。
   （logo2才是這個平台每次不一定一樣的，選填，見loadDefaultLogo2()）
   ★ 2026-08恢復：先前(2026-08)應要求關閉過自動帶入，這次使用者確認
   logos/logo_shopee_live.png一直都在、要恢復正常行為，改回原本會自動
   載入這個檔案當logo1預設值的版本（跟beauty-health參考專案同一份實作）。
   ★ 2026-08再調整：改成跟CTA badge同一套「每個版本各自一份、找不到就
   借用logos/資料夾(上一層)共用圖」的機制——使用者反映有些版本需要白色
   版的LOGO1（例如深色背景的版本），不能全部版本共用同一張圖。檔案放
   logos/{版本}/logo_shopee_live.png，沒放的版本自動借用上一層的共用圖
   當墊檔，不會開天窗。 */
function loadDefaultLogo1(cb){
  var version = normalizeTemplateVersion(S.templateVersion);
  _loadVersionedDefaultImage(version, 'logo_shopee_live.png', function(img){
    if(img && !S.assets.logo1) S.assets.logo1 = img;
    if(cb) cb();
  });
}

/* 版本切換時logo1要強制重新載入（不像loadDefaultLogo1()那樣只在
   S.assets.logo1還沒有值時才套用）——跟reloadVersionedCTA()同一種
   「使用者切版本，這種完全由程式自動決定的固定素材要跟著換」的邏輯。
   使用者自己上傳的logo2、Excel比對到的logo1檔案都不會受影響（那些是
   使用者/工單資料，不能被這裡強制覆蓋）。 */
function reloadVersionedLogo1(cb){
  var version = normalizeTemplateVersion(S.templateVersion);
  _loadVersionedDefaultImage(version, 'logo_shopee_live.png', function(img){
    if(img) S.assets.logo1 = img;
    if(cb) cb();
  });
}

/* logo2是「品牌LOGO，選填」。原本這裡會試著載入 logos/logo2-default.png
   當預設值，但這個專案裡從來沒有放過這個檔案（一直都是404），每次切換
   分頁/建立分頁都會白跑一次網路請求，而且如果剛好跟使用者手動上傳logo2
   的時間點重疊，開發階段測試時比較容易看起來像是「LOGO2出了什麼問題」，
   容易誤導排查方向。logo2本來就是選填、每次工單不一定一樣，不像logo1有
   固定的品牌素材，所以直接拿掉這個預設載入——沒有預設值時本來就會維持
   null，跟載入401/404失敗的結果完全一樣，行為不變，只是不再送出這個
   注定失敗的請求。 */
function loadDefaultLogo2(cb){ if(cb) cb(); }

/* CTA固定素材：兩種badge分別對應不同版位，不能共用同一個assets key——
   logos/DD.png（放心買 安心退）固定套用在DD Card(05_ddcard)、HBN(03_c2c_bn)；
   logos/CTA.png（逛逛去）固定套用在MSBN(07_msbn)。跟logo1同一套邏輯：
   只是「有預設檔就套用、找不到對應layer就靜靜不畫」，某個分頁的
   activeLayoutIds如果同時含有這兩種版位，兩個asset key會同時載入，互不影響。 */
/* 2026-08新增「A版／B版」支援：CTA badge的顏色是兩版差異之一，所以每個
   CTA檔名都改成先試「該版本專屬檔」（logos/A/DD.png、logos/B/DD.png），
   找不到才退回「共用檔」logos/DD.png（B版正式badge美術還沒補齊之前，先
   借用共用檔墊著，不會開天窗；之後把B版badge放進logos/B/資料夾，程式
   不用改，切到B版就會自動改用）。這幾個函式維持「有預設檔就套用、找不到
   對應layer就靜靜不畫」的邏輯，只是多了一層版本fallback。 */
function _loadVersionedDefaultImage(version, filename, cb){
  var img = new Image();
  var triedVersioned = false;
  img.onload = function(){ cb(img); };
  img.onerror = function(){
    if(!triedVersioned){ triedVersioned = true; img.src = 'logos/'+filename; }
    else { cb(null); }
  };
  img.src = 'logos/'+version+'/'+filename;
}

function loadDefaultCTA_DD(cb){
  var version = normalizeTemplateVersion(S.templateVersion);
  _loadVersionedDefaultImage(version, 'DD.png', function(img){ if(img && !S.assets.ctaDD) S.assets.ctaDD = img; if(cb) cb(); });
}
function loadDefaultCTA_Go(cb){
  var version = normalizeTemplateVersion(S.templateVersion);
  _loadVersionedDefaultImage(version, 'CTA.png', function(img){ if(img && !S.assets.ctaGo) S.assets.ctaGo = img; if(cb) cb(); });
}
/* Game BN專屬CTA圓形按鈕，跟ctaDD/ctaGo同一套「有預設檔就套用、找不到
   對應layer就靜靜不畫」邏輯。參考檔原本依bau/flash主題切換兩張不同圖，
   這個專案還沒有主題切換的狀態欄位，先固定套用一張，之後要做主題切換
   再擴充。 */
function loadDefaultCTA_Game(cb){
  var version = normalizeTemplateVersion(S.templateVersion);
  _loadVersionedDefaultImage(version, 'GameCTA.png', function(img){ if(img && !S.assets.ctaGame) S.assets.ctaGame = img; if(cb) cb(); });
}

/* 固定預設素材一起套用（沒有對應檔案就靜靜跳過），每次分頁切換/建立/載入完
   都要重新跑一次——因為S.assets在applyTabData()裡會被整個換掉，這個分頁自己
   沒有logo1/logo2/ctaDD/ctaGo/ctaGame的話，才會補上預設值 */
function applyDefaultLogos(cb){
  loadDefaultLogo1(function(){ loadDefaultLogo2(function(){ loadDefaultCTA_DD(function(){ loadDefaultCTA_Go(function(){ loadDefaultCTA_Game(cb); }); }); }); });
}

/* 版本(A/B)切換時，CTA badge是唯一需要「強制換圖」的自動預設素材——logo1
   是品牌LOGO跟版本無關不用換，logo2是使用者自己上傳的不能動；ctaDD/
   ctaGo/ctaGame三個一律是程式自動套的固定素材、從來不開放使用者上傳
   （見isEmptyDefaultTabData()的排除清單），所以這裡可以直接覆蓋，不用
   擔心蓋掉使用者的東西。跟applyDefaultLogos()的差異只在於：這裡不檢查
   `!S.assets.xxx`，一律強制重新載入目前版本對應的檔案。 */
function reloadVersionedCTA(cb){
  var version = normalizeTemplateVersion(S.templateVersion);
  _loadVersionedDefaultImage(version, 'DD.png', function(img){
    S.assets.ctaDD = img;
    _loadVersionedDefaultImage(version, 'CTA.png', function(img2){
      S.assets.ctaGo = img2;
      _loadVersionedDefaultImage(version, 'GameCTA.png', function(img3){
        S.assets.ctaGame = img3;
        if(cb) cb();
      });
    });
  });
}

/* 右側面板最上方的「公版版本」下拉選單——跟bindArControls()同一套精神：
   只是換S.templateVersion+同步configs/theme.json的對應顏色組+強制換CTA
   badge，然後重畫；不影響文案/曝品/logo2這些跟版本無關的內容。每次切換
   分頁(applyTabData)都要重新呼叫一次，同步下拉選單目前顯示的值跟這個
   分頁實際存的版本一致。 */
function bindVersionToggle(){
  var sel = document.getElementById('template-version-sel');
  if(!sel) return;

  sel.value = normalizeTemplateVersion(S.templateVersion);

  sel.onchange = function(){
    var v = normalizeTemplateVersion(sel.value);
    if(S.templateVersion === v) return;
    S.templateVersion = v;
    if(typeof setTemplateVersion === 'function') setTemplateVersion(v);
    reloadVersionedLogo1(function(){
      reloadVersionedCTA(renderAll);
    });
    /* 商品陰影合成彈窗(js/shadow-system/shadow-popup.js)如果剛好開著，
       它的1200×1200背景圖也是版本化的(見該檔drawShadowCanvas())，這裡
       主動呼叫一次讓它立刻換圖，不用等使用者手動關掉再重開才生效；彈窗
       沒開的話drawShadowCanvas()內部會直接return，呼叫這裡不會出錯。 */
    if(typeof drawShadowCanvas === 'function') drawShadowCanvas();
  };
}

/* AR版位素材／文案自動套用：跟logo1同一套精神——資料夾比對到、或Excel帶了
   AR文案文字，就直接套用，不需要再跳一個確認popup（AR只是一個100x100的
   小方塊，不需要像人物/商品那樣調整位置/縮放）。
   優先順序：Excel「AR版本」儲存格(HI21/HI22，見editor-import.js的
   parseARCell())如果有明確指定版本，最優先、直接照它指定的版本+文字套用；
   沒有明確指定的話才退回舊邏輯：有AR文案文字→文字版本；資料夾比對到
   賣家LOGO→賣家版本；比對到活動LOGO→活動版本；都沒有就維持原本的
   S.arVariant不動（例如上一個分頁手動選好的）。 */
/* AR版位素材／文案自動套用：AR的activity/seller版本直接沿用LOGO1/LOGO2
   本身（見modules/ar-module.js），不需要另外比對/上傳專屬素材，這裡只
   需要處理Excel「AR內容」欄位指定的版本+文案（見editor-import.js的
   parseARCell()）。 */
function applyArFromImport(matched, parsedText, arInfo){
  /* AR只有一個版位(一個分頁只會有一個'ar' canvas)，寫進它對應的那組文案就好
     （通常就是'文案1'，除非之後有需要把AR也拆進特定組）。 */
  var arGroup = S.textGroups[groupKeyForLayout('ar')] || activeText();
  if(arInfo && arInfo.variant){
    S.arVariant = arInfo.variant;
    if(arInfo.variant === 'text' && arInfo.text){
      arGroup['AR文案'] = arInfo.text;
    }
  } else {
    var arText = parsedText && parsedText['AR文案'];
    if(arText){
      arGroup['AR文案'] = arText;
      S.arVariant = 'text';
    }
  }
  refreshRightPanel();
  renderAll();
}

function refreshRightPanel(){
  bindTextInputs();
  bindArControls();
  updateDpsPanelVisibility();
  bindVersionToggle();
}

/* AR版位（100x100，三選一版本）的右側控制面板：
   - 切換版本：只是換S.arVariant，不影響已經上傳的LOGO/文案，切回去還在
   - 上傳活動LOGO／賣家LOGO：讀成Image塞進對應的S.assets key
   - 文案：跟其他文字欄位一樣透過bindTextInputs()的通用邏輯處理（見那邊
     forEach陣列已經加了'AR文案'），這裡不用重複綁 */
/* AR版位（100x100，三選一版本）的右側控制面板：
   - 切換版本：只是換S.arVariant，不影響已經上傳的LOGO/文案，切回去還在
   - 活動LOGO/店家LOGO：直接沿用LOGO1/LOGO2本身，不需要另外上傳
     （見modules/ar-module.js），這裡只需要切換版本、不用管上傳
   - 文案：跟其他文字欄位一樣透過bindTextInputs()的通用邏輯處理（見那邊
     forEach陣列已經加了'AR文案'），這裡不用重複綁 */

/* 這份工單有沒有勾AR（S.activeLayoutIds裡有沒有'ar'）——沒有的話，右側整個
   「AR（100×100）」區塊（版本選單/文案輸入框）都不需要顯示，使用者反映
   用不到AR的工單，這個區塊留著只是佔位置、容易讓人誤會還要填。1200畫布
   本身（buildCanvasArea()用activeLayouts()決定要蓋哪些canvas-block）已經
   會自動不畫AR，這裡只是讓右側控制面板也跟著一致，兩處都用同一份
   S.activeLayoutIds判斷，不用另外維護一個開關。 */
function updateArPanelVisibility(){
  var el = document.getElementById('ar-panel-section');
  if(!el) return;
  var hasAr = S.activeLayoutIds && S.activeLayoutIds.indexOf('ar') >= 0;
  el.style.display = hasAr ? '' : 'none';
}

/* DPS(128x128)右側控制面板顯示/隱藏——跟AR同一套判斷方式(這份工單有沒有
   勾這個版位)，但DPS現在是獨立模組(見modules/dps-module.js)，固定只有
   文字欄位、沒有版本選單，不需要另外綁下拉選單的change事件。 */
function updateDpsPanelVisibility(){
  var el = document.getElementById('dps-panel-section');
  if(!el) return;
  var hasDps = S.activeLayoutIds && S.activeLayoutIds.indexOf('dps') >= 0;
  el.style.display = hasDps ? '' : 'none';
}

function bindArControls(){
  updateArPanelVisibility();
  var sel = document.getElementById('ar-variant-sel');
  if(!sel) return; // editor.html還沒建置完成時的保險
  sel.value = S.arVariant || 'activity';

  function syncVisibility(){
    var v = sel.value;
    document.getElementById('ar-activity-field').style.display = (v==='activity') ? '' : 'none';
    document.getElementById('ar-seller-field').style.display = (v==='seller') ? '' : 'none';
    document.getElementById('ar-text-field').style.display = (v==='text') ? '' : 'none';
  }
  syncVisibility();

  sel.onchange = function(){
    S.arVariant = sel.value;
    syncVisibility();
    renderAll();
  };
}

/* ══════════════════ 分頁（TABS）══════════════════ */

function renderTabBar(){
  var nav = document.getElementById('tab-bar');
  /* 還沒真正匯入過任何工單（只有內部占位用的空白分頁）時，不畫出那顆
     看起來像分頁、其實完全沒內容的按鈕——使用者反映「一開始還沒上傳就
     看到一個多餘分頁」，這裡改成只顯示提示文字+「+」，等真的匯入完成
     （addTabFromImport把這個空白分頁換掉）才會顯示正常的分頁按鈕。 */
  var onlyTrivial = TABS.length === 1 && isEmptyDefaultTabData(TABS[0].data);
  if(onlyTrivial){
    nav.innerHTML = '<span class="hint" style="padding:0 10px;">尚未匯入工單</span>'+
      '<button class="tab-add" onclick="openImportModal()" title="匯入工單建立新分頁">+</button>';
    return;
  }
  nav.innerHTML = TABS.map(function(tab, i){
    /* 頁籤上顯示的文字：優先用exposureLabel（例如'曝光日期1'）這種簡短版，
       不要整串「工作項目名稱／曝光日期1」都塞進頁籤，頁籤空間小、多分頁
       並排時容易擠爆。完整名稱(tab.data.label)還是保留著，給整包下載的
       zip檔名用（見js/editor-export.js的downloadAll()），只是不顯示在
       頁籤上而已。沒有exposureLabel的分頁（手動建立的空白分頁、或沒有
       曝光日期區塊概念的舊格式工單）維持顯示完整標籤，不受影響。 */
    var tabText = tab.data.exposureLabel || tab.data.label;
    return '<button class="tab-btn'+(i===ACTIVE_TAB?' active':'')+'" onclick="switchTab('+i+')" title="'+esc(tab.data.label)+'">'+
      esc(tabText)+
      (TABS.length>1 ? '<span class="tab-close" onclick="event.stopPropagation();closeTab('+i+')">×</span>' : '')+
    '</button>';
  }).join('') + '<button class="tab-add" onclick="openImportModal()" title="匯入工單建立新分頁">+</button>';
}

function esc(s){ return String(s||'').replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }

function switchTab(i){
  if(i === ACTIVE_TAB) return;
  saveCurrentTabIntoData();
  ACTIVE_TAB = i;
  renderTabBar();
  applyTabData(i, function(){
    refreshRightPanel();
    buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
  });
}

function closeTab(i){
  if(TABS.length<=1) return;
  /* 2026-08新增：刪除分頁前先跳出確認對話框——分頁一旦刪掉，裡面的文案/
     商品/LOGO都會直接消失、沒有復原機制(不像關掉調整位置popup那種可以
     取消)，容易手滑點到叉叉就整頁不見，所以在真的splice()之前擋一下。
     訊息裡帶分頁的完整名稱(tab.data.label，跟zip下載檔名用的同一個
     欄位)，讓使用者確認的當下看得出來是要刪哪一頁，不是只看到一個
     空泛的「確定刪除嗎」。使用者按取消(confirm回傳false)就直接return，
     完全不動TABS、不用做任何復原處理。 */
  var tabLabel = (TABS[i] && TABS[i].data && (TABS[i].data.exposureLabel || TABS[i].data.label)) || ('分頁'+(i+1));
  if(!window.confirm('確定要刪除「'+tabLabel+'」這個分頁嗎？裡面的文案/商品/LOGO都會一併刪除，無法復原。')) return;

  TABS.splice(i,1);
  if(ACTIVE_TAB >= TABS.length) ACTIVE_TAB = TABS.length-1;
  renderTabBar();
  applyTabData(ACTIVE_TAB, function(){
    refreshRightPanel();
    buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
  });
}

/* 判斷一個分頁資料是不是「完全空白、使用者還沒動過」的預設分頁——開啟編輯器時
   一開始就會有一個「未命名工單1」佔位分頁，同時又會自動跳出匯入工單popup
   （見DOMContentLoaded），使用者匯入的話，這個判斷用來決定「取代」這個空白佔位
   分頁，而不是在它旁邊「多新增」一個分頁，不然每次開啟編輯器匯入一次工單，
   就會看到2個分頁（1個沒用到的空白預設分頁+1個剛匯入的），造成使用者誤以為
   「工單匯入自己複製出兩個分頁」的錯覺——實際上不是Excel有兩個頁籤(sheet)的
   問題，是編輯器初始化流程自己先塞了一個佔位分頁進去。 */
function isEmptyDefaultTabData(d){
  if(!d) return false;
  var groups = d.textGroups ? Object.keys(d.textGroups) : (d.text ? ['__legacy__'] : []);
  var textEmpty = groups.every(function(gk){
    var g = d.textGroups ? d.textGroups[gk] : d.text;
    return ['標題','副標','日期','AR文案','DPS'].every(function(k){ return !g || !g[k]; });
  });
  /* logo1／cta都有固定預設值（logo1是蝦皮直播brand、cta是DD.png固定badge），
     每個空白分頁一打開就會自動帶入（見loadDefaultLogo1()／loadDefaultCTA()），
     光是這兩個key有值不能代表「使用者真的做過事」，排除掉不列入這裡的判斷——
     這是上次修「匯入變2個分頁」時漏掉的地方：addTabFromImport()一開頭會呼叫
     saveCurrentTabIntoData()，把當下已經載入了logo1/cta預設值的S存回
     TABS[0].data，這裡如果沒排除，assetsEmpty永遠會被logo1/cta判定成false，
     canReplaceDefault永遠是false，於是還是會「新增」一個分頁而不是「取代」
     空白分頁，兩個分頁的問題會用不同原因重現。 */
  var assetsEmpty = !d.assets || Object.keys(d.assets).every(function(k){ return k === 'logo1' || k === 'ctaDD' || k === 'ctaGo' || k === 'ctaGame' || !d.assets[k]; });
  var shadowEmpty = !d.shadowSlots || Object.keys(d.shadowSlots).length === 0;
  var overridesEmpty = !d.positionOverrides || Object.keys(d.positionOverrides).length === 0;
  return textEmpty && assetsEmpty && shadowEmpty && overridesEmpty;
}

/* 把parseRows()解析出來的一個區塊(parsed)轉成一份完整的tab.data——
   textGroups依原樣正規化文字(補千分位逗號、日期補0之類)搬進去，
   layoutTextGroup依materialItems的分組標籤比對版位。 */
function buildTabDataFromParsedBlock(parsed){
  var data = newEmptyTabData(parsed.orderName);
  data.exposureLabel = parsed.exposureLabel || null;
  data.templateVersion = normalizeTemplateVersion(parsed.templateVersion); // 工單有明確指定才會是A~H其中一個，沒指定一律預設'A'，使用者仍可在畫面上用下拉選單再調整
  data.activeLayoutIds = filterLayoutsByMaterials(parsed.materials);
  var built = buildLayoutInstancesFromMaterials(parsed.materialItems, data.activeLayoutIds);
  data.instances = built.instances;
  data.materialOrder = data.instances.map(function(inst){ return inst.instanceId; }); // 純粹相容欄位，實際排序看instances
  data.layoutTextGroup = {};
  data.instances.forEach(function(inst){ data.layoutTextGroup[inst.instanceId] = inst.textGroup || '文案1'; });

  data.textGroups = {};
  Object.keys(parsed.textGroups || {}).forEach(function(groupKey){
    var src = parsed.textGroups[groupKey] || {};
    var out = emptyTextGroup();
    ['標題','副標','日期','AR文案','DPS'].forEach(function(k){ if(src[k]) out[k] = normalizeTextValue(k, src[k]); });
    data.textGroups[groupKey] = out;
  });
  if(!Object.keys(data.textGroups).length) data.textGroups = { '文案1': emptyTextGroup() };
  data.activeTextGroup = Object.keys(data.textGroups)[0];
  return data;
}

/* 一個區塊(parsed，來自editor-import.js的parseRows())建立/取代一頁分頁——
   一次Excel匯入如果有多個「曝光日期」區塊，呼叫端(js/editor-popups.js的
   runImport())會依序對每個區塊各呼叫一次這支函式，一個一個把分頁開出來
   （不是一次全開完，因為每個分頁後面接著要跳LOGO2/商品陰影確認popup，
   這些popup要使用者一個一個確認，不能同時對好幾個分頁操作）。 */
function addTabFromImport(parsed){
  var data = buildTabDataFromParsedBlock(parsed);
  saveCurrentTabIntoData();

  var canReplaceDefault = TABS.length === 1 && isEmptyDefaultTabData(TABS[0].data);
  if(canReplaceDefault){
    TABS[0] = { data: data };
    ACTIVE_TAB = 0;
  } else {
    TABS.push({ data: data });
    ACTIVE_TAB = TABS.length-1;
  }
  renderTabBar();
  applyTabData(ACTIVE_TAB, function(){
    refreshRightPanel();
    buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
  });
}

/* ══════════════════ Topbar 按鈕 ══════════════════ */

/* 把資料夾比對popup確認後的 {slotId: File} 實際載入成圖片、寫進 S.assets */
function applyMatchedAssets(matched){
  var keys = Object.keys(matched);
  var pending = keys.length;
  if(!pending) return;
  keys.forEach(function(slotId){
    loadAssetFile(slotId, matched[slotId], function(){
      pending--;
      if(pending<=0) renderAll();
    });
  });
}

function bindSaveTemp(){
  document.getElementById('btn-save-temp').onclick = function(){
    saveCurrentTabIntoData();
    var payload = { version:1, tabs: TABS.map(function(t){ return t.data; }), activeTab: ACTIVE_TAB };
    var blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    triggerDownload(blob, 'circle_暫存_'+Date.now()+'.json');
  };
}

function bindLoadTemp(){
  var input = document.getElementById('load-temp');
  document.getElementById('btn-load-temp').onclick = function(){ input.click(); };
  input.onchange = function(){
    var file = input.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try{
        var payload = JSON.parse(ev.target.result);
        TABS = payload.tabs.map(function(d){ return { data:d }; });
        ACTIVE_TAB = payload.activeTab || 0;
        renderTabBar();
        applyTabData(ACTIVE_TAB, function(){
          refreshRightPanel();
          buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
        });
      }catch(e){
        alert('暫存檔讀取失敗：'+e.message);
      }
    };
    reader.readAsText(file);
    input.value = '';
  };
}

function bindDownloadAll(){
  document.getElementById('btn-download-all').onclick = downloadAll;
}

/* 側欄「＋ 追加版位」按鈕：開啟手動勾選版位的popup（見editor-popups.js的
   openLayoutTogglePopup()）。 */
function bindAddLayoutButton(){
  var btn = document.getElementById('btn-add-layout');
  if(!btn) return;
  btn.onclick = openLayoutTogglePopup;
}

/* ══════════════════ 初始化 ══════════════════ */

/* 「重設」按鈕：現在跟直接重新整理效果一樣（見下面DOMContentLoaded，
   重新整理本身就會清空重來），保留這顆按鈕只是給使用者一個不用重新整理
   也能達到同樣效果的明確動作，內部就是清一次localStorage殘留資料+重新整理。 */
function bindResetAll(){
  var btn = document.getElementById('btn-reset-all');
  if(!btn) return;
  btn.onclick = function(){
    if(!confirm('確定要清空目前所有分頁，重新開始嗎？這個動作無法復原。')) return;
    try{ localStorage.removeItem(AUTOSAVE_KEY); }catch(e){}
    location.reload();
  };
}

window.addEventListener('DOMContentLoaded', function(){
  /* ★ 使用者明確要求：重新整理＝整個刷掉重來，不要接續上次的內容。
     原本這裡會先讀localStorage自動記住的內容、有的話就還原（方便瀏覽器
     不小心關掉/當機時不會整份工單都不見）；現在改成完全不讀，每次重新整理
     一律當作全新使用者：一個空白分頁 + 自動跳出匯入工單popup，之前分頁裡
     的內容一律清除。想保留工作內容的話，還是可以用「儲存暫存」下載一份
     .json，之後用「載入暫存」讀回來，這個手動存讀檔的功能不受影響。 */
  try{ localStorage.removeItem(AUTOSAVE_KEY); }catch(e){}
  TABS = [{ data: newEmptyTabData('未命名工單1') }];
  ACTIVE_TAB = 0;

  bindSaveTemp();
  bindLoadTemp();
  bindDownloadAll();
  bindResetAll();
  bindAddLayoutButton();

  /* 等自訂字型真的載入完成再畫第一次，不然canvas文字會先用系統字體畫一次、
     字型載好後也不會自動重畫，畫面會卡在錯的字體上（canvas文字不像DOM文字
     會自動follow字型載入完成事件）。跟你參考檔(11/12/05這幾個html)結尾那段
     document.fonts.load()的作法一樣。 */
  Promise.all([
    document.fonts.load('700 16px ShopeeNoto'),
    document.fonts.load('500 16px ShopeeNoto'),
    document.fonts.load('400 16px ShopeeNoto')
  ]).catch(function(e){ console.warn('[fonts] 字型載入失敗，會用預設字體代替：', e); })
  .then(function(){
    loadTheme(function(){
      applyTabData(ACTIVE_TAB, function(){
        refreshRightPanel();
        renderTabBar();
        buildCanvasArea();
        applyDefaultLogos(renderAll);
        openImportModal(); // 一律自動跳出，不用再判斷是不是「第一次使用」
      });
    });
  });
});
