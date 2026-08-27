'use strict';
/*
  shadow-popup.js
  ------------------------------------------------------------
  這支是「商品/主持人陰影合成」popup的UI跟流程控制，底層運算完全依賴
  三支從pet-frenzy原封不動搬過來的檔案：
    shadow-plugin.js            陰影渲染引擎（貼地陰影/光暈/角度）
    shadow-layout-receiver.js   拖曳/縮放/旋轉/多選/群組縮放/Ctrl+Z復原
    shadow-frame-plugin.js      拍立得框
  這支檔案只負責：組UI、串接使用者操作到上面三支的API、combo切換時
  查 shadow-layout-defaults-circle.js 決定要顯示哪些素材欄位、
  最後「確認並匯出」時攤平成一張PNG存進 S.assets.host。

  已知未搬的功能（範圍內容跟你確認過，先跳過，之後有需要再補）：
    - 商品去背（依賴pet另一支外掛 editor-plugin.js 的 openEraseEditor，
      這支還沒搬進來）
*/

/* 陰影編輯畫布(1200×1200)的底圖：先試 backgrounds/_shadow_compose.jpg，
   找不到再試.png，兩個都沒有就退回原本的純色畫法（S.bg.seedHex或預設
   #d8d8d8）。跟其他版位的底圖放同一個backgrounds/資料夾，不用另外
   開bg/資料夾。只影響這個編輯popup裡看到的底圖（方便使用者對位置/比例），
   不會被exportShadowComposite()匯出的合成圖吃進去——匯出那邊維持透明底，
   合成到主持人圖層時才不會多一層背景色/圖蓋住其他版位內容。 */
var _shadowBg = { status:'idle', img:null };
function loadShadowBgImage(){
  if(_shadowBg.status !== 'idle') return;
  _shadowBg.status = 'loading';
  var img = new Image();
  img.onload = function(){
    _shadowBg.status = 'loaded';
    _shadowBg.img = img;
    drawShadowCanvas();
  };
  img.onerror = function(){
    if(!_shadowBg._triedPng){
      _shadowBg._triedPng = true;
      img.src = 'backgrounds/_shadow_compose.png';
    } else {
      _shadowBg.status = 'missing';
    }
  };
  img.src = 'backgrounds/_shadow_compose.jpg';
}
function drawShadowBgCover(ctx, img, w, h){
  var ir = img.naturalWidth / img.naturalHeight;
  var cr = w / h;
  var sx, sy, sw, sh;
  if(ir > cr){ sh = img.naturalHeight; sw = sh * cr; sx = (img.naturalWidth - sw) / 2; sy = 0; }
  else { sw = img.naturalWidth; sh = sw / cr; sx = 0; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

var _shadowCanvas = null, _shadowCtx = null, _shadowReceiver = null;
var _shadowMessageListenerBound = false;
var _shadowSlotDefs = [
  { id:'人物1', type:'person',  label:'人物1' },
  { id:'人物2', type:'person',  label:'人物2' },
  { id:'商品1(左)', type:'product', label:'商品1(左)' },
  { id:'商品2(中)', type:'product', label:'商品2(中)' },
  { id:'商品3(右)', type:'product', label:'商品3(右)' }
];
var SHADOW_DISPLAY = 560; // popup裡實際顯示的畫布大小(px)，運算永遠用1200x1200，只是縮小顯示

/* 每次開popup都要重新綁定，不能只做一次就好——createOverlay()每次開popup都會
   把整個overlay的DOM（包含裡面的canvas）整個砍掉重蓋一份新的，如果receiver
   還綁著「上一次那個已經被砍掉的canvas」，畫面看起來就會是全黑（新canvas從沒
   被畫過東西，疊在.pos-editor-stage的黑底css上面，看起來就是全黑一片）。
   這是第一次上線後實際回報的bug，重開一次popup就會重現。 */
function initShadowPopup(){
  _shadowCanvas = document.getElementById('shadow-compose-canvas');
  if(!_shadowCanvas || typeof ShadowLayoutReceiver === 'undefined') return;
  _shadowCtx = _shadowCanvas.getContext('2d');
  _shadowReceiver = ShadowLayoutReceiver.create(_shadowCanvas, { stageId:'_shadow_compose', savedStage: (window.S && S.stageTransform) || null });
  _shadowReceiver.attachPointerEvents(drawShadowCanvas);

  /* 這個監聽器不用每次重綁——它是綁在window上，不是綁在canvas上，canvas被砍掉
     重蓋不影響它；只綁一次，不然每開一次popup就多疊一份監聽器，選取變更事件
     會被觸發好幾次（不會壞掉，但沒必要浪費） */
  if(!_shadowMessageListenerBound){
    window.addEventListener('message', function(e){
      if(e.data && e.data.type === 'LC_SELECTION_CHANGED') renderSlotBar();
    });
    _shadowMessageListenerBound = true;
  }
}

function drawShadowCanvas(){
  if(!_shadowCtx) return;
  _shadowCtx.clearRect(0,0,1200,1200);
  if(_shadowBg.status === 'idle') loadShadowBgImage();
  if(_shadowBg.status === 'loaded'){
    drawShadowBgCover(_shadowCtx, _shadowBg.img, 1200, 1200);
  } else {
    _shadowCtx.fillStyle = (window.S && S.bg && S.bg.seedHex) || '#d8d8d8';
    _shadowCtx.fillRect(0,0,1200,1200);
  }
  _shadowReceiver.drawStage(_shadowCtx);
  _shadowReceiver.drawItems(_shadowCtx);
  syncTransformsIntoState();
}

/* ★「重新開啟1200畫布，先前調整的內容消失」的修正：popup每次重開都會建立一個
   全新的 _shadowReceiver（見initShadowPopup()的說明），它內部的slots{}是空的，
   使用者拖曳/縮放/旋轉的結果只活在這個receiver的記憶體裡，popup關掉/重開就
   跟著不見了——S.shadowSlots原本只存{dataUrl,type,ratio}，完全沒有存位置/
   大小/角度，所以就算tab資料本身有存檔/還原，也還原不出使用者調整過的結果。
   這裡在「每一次重畫」（也就是幾乎每一次拖曳/縮放/旋轉的當下）都把receiver
   目前的原始x/y/w0/h0/scaleMul/rot讀出來，寫回S.shadowSlots[slotId].transform，
   這樣：
     1. 跟著S一起存/還原（tab切換、暫存.json、localStorage自動記住）
     2. 下次呼叫applyShadowSlotDataUrl()/setShadowCombo()重新upsertSlot時，
        會把這份transform一併帶給LC_UPSERT_SLOT，receiver收到後直接套用
        （見shadow-layout-receiver.js的upsertSlot savedTransform參數），
        不會被layout預設值蓋掉。
   只同步「目前有在用(enabledIds)、且已經有raw資料」的slot，不影響其他狀態。 */
function syncTransformsIntoState(){
  if(!_shadowReceiver || !window.S || !S.shadowSlots) return;
  var order = _shadowReceiver.getEnabledOrder();
  order.forEach(function(slotId){
    var raw = _shadowReceiver.getSlotRaw(slotId);
    var rec = S.shadowSlots[slotId];
    if(raw && rec) rec.transform = raw;
  });
  /* 舞台跟商品slot同一套道理：每次重畫都把receiver目前的舞台cx/cy/scaleMul讀出來
     存回S.stageTransform，下次重開popup（initShadowPopup()重新create()receiver時）
     才能透過savedStage參數還原，不會被stage-defaults.js的預設值蓋掉。使用者還沒
     動過舞台時getStageRaw()回傳null，這裡就不去動S.stageTransform（維持沒有存檔
     的狀態，之後才會乖乖用預設值，不會存進一個假的「使用者調過」資料）。 */
  if(window.S){
    var stageRaw = _shadowReceiver.getStageRaw();
    if(stageRaw) S.stageTransform = stageRaw;
  }
  /* 2026-08：原本這裡會順便debounce一次自動記住進localStorage，
     現在整個自動記住機制已經拿掉（使用者要求重新整理＝整個刷掉重來），
     這裡不用再呼叫什麼，拖曳調整的結果只活在目前這次瀏覽期間，重新整理
     後就會跟著清空——如果需要保留調整結果，記得用「儲存暫存」下載.json。 */
}

/* ── 素材清單（左側欄）── 支援拖曳調整前後順序（跟pet-frenzy一樣：
   清單最上面＝畫面最前景，拖曳排序會直接影響誰擋住誰） */
function renderSlotBar(){
  var bar = document.getElementById('shadow-slotbar');
  if(!bar) return;
  var combo = S.shadowCombo || 'A';
  var selected = _shadowReceiver.getSelectedSlots();
  var active = _shadowReceiver.getActiveSlot();

  /* S.shadowOrder是「後面＝前景」的實際疊放順序（跟receiver的enabledIds同義），
     清單顯示要反過來（上面＝前景），跟pet-frenzy的displayOrder邏輯一致 */
  var order = getShadowOrder(combo);
  var displayOrder = order.slice().reverse();

  bar.innerHTML = '';
  displayOrder.forEach(function(slotId, displayIdx){
    var def = _shadowSlotDefs.filter(function(d){ return d.id===slotId; })[0];
    if(!def) return;
    var hasImg = !!(S.shadowSlots && S.shadowSlots[slotId]);
    var isActive = active === slotId;
    var isMulti = selected.indexOf(slotId)!==-1 && selected.length>1;

    var box = document.createElement('div');
    box.className = 'shadow-slot' + (hasImg?' filled':'') + (isActive?' active':'') + (isMulti?' multi':'');
    box.draggable = true;
    box.dataset.displayIdx = displayIdx;

    var thumbHtml = hasImg
      ? '<img src="'+S.shadowSlots[slotId].dataUrl+'"><div class="shadow-slot-del">×</div>'
      : '<div class="shadow-slot-plus">＋</div>';
    box.innerHTML =
      '<span class="shadow-slot-drag">⠿</span>'+
      '<div class="shadow-slot-thumb">'+thumbHtml+'</div>'+
      '<div class="shadow-slot-meta">'+def.label+
        '<span class="shadow-slot-tag">'+(def.type==='person'?'主持人・光暈陰影':'商品・貼地陰影')+'</span>'+
      '</div>';

    (function(slotId, def, box){
      box.querySelector('.shadow-slot-thumb').addEventListener('click', function(){
        if(hasImg){ _shadowReceiver.setActiveSlot(slotId, drawShadowCanvas); renderSlotBar(); }
        else triggerSlotUpload(slotId, def.type);
      });
      var delBtn = box.querySelector('.shadow-slot-del');
      if(delBtn) delBtn.addEventListener('click', function(e){ e.stopPropagation(); removeShadowSlot(slotId); });

      /* 拍立得框：只有商品類、且已經有圖，才顯示（人物走頭部定位，套框後形狀會對不上頭部偵測，先不開放） */
      if(def.type==='product' && hasImg){
        var frameRow = document.createElement('div');
        frameRow.className = 'shadow-frame-row';
        frameRow.draggable = false; // 蓋掉繼承自box的draggable，不然checkbox點擊會被誤判成拖曳手勢
        var polaroidOn = !!(S.shadowPolaroid && S.shadowPolaroid[slotId]);
        frameRow.innerHTML =
          '<label><input type="checkbox" '+(polaroidOn?'checked':'')+'> 拍立得</label>'+
          (polaroidOn ? '<a data-act="adjust">調整</a>' : '');
        frameRow.addEventListener('click', function(e){ e.stopPropagation(); });
        frameRow.querySelector('input').addEventListener('change', function(e){
          togglePolaroid(slotId, e.target.checked);
        });
        var adjustLink = frameRow.querySelector('[data-act="adjust"]');
        if(adjustLink) adjustLink.addEventListener('click', function(){ togglePolaroid(slotId, true); });
        box.appendChild(frameRow);
      }

      /* 拖曳調整前後順序：跟pet-frenzy邏輯一致，displayOrder是「上=前景」，
         換回S.shadowOrder（後面=前景）要再反轉一次 */
      box.addEventListener('dragstart', function(){
        _shadowDragFromIdx = displayIdx;
        box.style.opacity = '0.4';
      });
      box.addEventListener('dragend', function(){ box.style.opacity = '1'; });
      box.addEventListener('dragover', function(e){ e.preventDefault(); });
      box.addEventListener('drop', function(e){
        e.preventDefault();
        var toIdx = displayIdx;
        if(_shadowDragFromIdx === null || _shadowDragFromIdx === toIdx) return;
        var moved = displayOrder.splice(_shadowDragFromIdx, 1)[0];
        displayOrder.splice(toIdx, 0, moved);
        S.shadowOrder = displayOrder.slice().reverse();
        _shadowDragFromIdx = null;
        broadcastShadowOrder();
        renderSlotBar();
      });
    })(slotId, def, box);

    bar.appendChild(box);
  });

  updateShadowScalePanel();
}
var _shadowDragFromIdx = null;

/* 陰影獨立X/Y縮放面板：只在「單選、且該slot已經有素材」時顯示，跟功能規格文件
   （陰影功能模組.md 功能B）「點選才出現的滑桿」互動一致。取消選取/多選時收起來，
   不影響已經存在各素材身上的縮放值——收起來再選回來，數值還在原本調整的地方。 */
function updateShadowScalePanel(){
  var panel = document.getElementById('shadow-scale-panel');
  if(!panel || !_shadowReceiver) return;
  var active = _shadowReceiver.getActiveSlot();
  var selected = _shadowReceiver.getSelectedSlots();
  var show = !!(active && selected.length <= 1 && S.shadowSlots && S.shadowSlots[active]);
  panel.style.display = show ? '' : 'none';
  if(!show) return;
  var sc = _shadowReceiver.getShadowScale(active);
  var xInput = document.getElementById('shadow-scale-x');
  var yInput = document.getElementById('shadow-scale-y');
  xInput.value = Math.round(sc.x*100);
  yInput.value = Math.round(sc.y*100);
  document.getElementById('shadow-scale-x-val').textContent = Math.round(sc.x*100)+'%';
  document.getElementById('shadow-scale-y-val').textContent = Math.round(sc.y*100)+'%';
}

/* S.shadowOrder是「這個組合目前的疊放順序」，換組合時如果還沒有對應這個組合
   的順序資料、或裡面的槽位跟這個組合結構對不上了，就重設成該組合的預設順序
   （CIRCLE_COMBO_SLOTS的陣列順序）。使用者拖曳調整過的順序會存在S.shadowOrder
   裡，只要沒換組合就會一直維持，跟tab資料一起存檔/還原。 */
function getShadowOrder(combo){
  var defaultOrder = window.CIRCLE_COMBO_SLOTS[combo] || [];
  var cur = S.shadowOrder;
  var sameSet = cur && cur.length === defaultOrder.length &&
    defaultOrder.every(function(id){ return cur.indexOf(id) !== -1; });
  if(!sameSet){
    S.shadowOrder = defaultOrder.slice();
  }
  return S.shadowOrder;
}

function broadcastShadowOrder(){
  var combo = S.shadowCombo || 'A';
  var order = getShadowOrder(combo);
  _shadowReceiver.handleMessage({ type:'LC_SET_ENABLED', ids:order, combo:combo }, drawShadowCanvas);
}

function triggerSlotUpload(slotId, type){
  var input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = function(){
    var f = input.files[0];
    if(f) loadShadowSlotFile(slotId, type, f);
  };
  input.click();
}

function loadShadowSlotFile(slotId, type, file, ratio){
  var reader = new FileReader();
  reader.onload = function(ev){
    S.shadowPolaroid = S.shadowPolaroid || {};
    S.shadowSlotOriginal = S.shadowSlotOriginal || {};
    delete S.shadowPolaroid[slotId];
    delete S.shadowSlotOriginal[slotId];
    applyShadowSlotDataUrl(slotId, type, ev.target.result, ratio);
  };
  reader.readAsDataURL(file);
}

function applyShadowSlotDataUrl(slotId, type, dataUrl, ratio){
  S.shadowSlots = S.shadowSlots || {};
  var prevRatio = S.shadowSlots[slotId] && S.shadowSlots[slotId].ratio;
  /* 換圖（例如換一張照片到同一個slot）通常還是想保留原本調整過的位置/大小，
     所以舊的transform（如果有）先留著往下傳；真正第一次上傳（沒有舊紀錄）
     才會是undefined，receiver會退回layout預設值。 */
  var prevTransform = S.shadowSlots[slotId] && S.shadowSlots[slotId].transform;
  S.shadowSlots[slotId] = { dataUrl: dataUrl, type: type, ratio: (ratio!==undefined ? ratio : prevRatio), transform: prevTransform };
  _shadowReceiver.handleMessage({ type:'LC_UPSERT_SLOT', slotId:slotId, slotType:type, dataUrl:dataUrl, ratio:S.shadowSlots[slotId].ratio, transform:prevTransform }, drawShadowCanvas);
  _shadowReceiver.setActiveSlot(slotId, drawShadowCanvas);
  renderSlotBar();
}

function removeShadowSlot(slotId){
  if(S.shadowSlots) delete S.shadowSlots[slotId];
  _shadowReceiver.handleMessage({ type:'LC_REMOVE_SLOT', slotId:slotId }, drawShadowCanvas);
  renderSlotBar();
}

/* 拍立得框：勾選時開ShadowFramePlugin的調整popup，完成後把「照片+框攤平的圖」
   當成一般素材重新套進這個slot（之後就能貼地陰影/縮放，跟普通商品圖沒兩樣） */
function togglePolaroid(slotId, on){
  var rec = S.shadowSlots && S.shadowSlots[slotId];
  if(!rec) return;
  if(typeof window.ShadowFramePlugin === 'undefined' || !window.ShadowFramePlugin.open){
    console.warn('[shadow-popup] 找不到 ShadowFramePlugin');
    renderSlotBar();
    return;
  }
  if(on){
    S.shadowSlotOriginal = S.shadowSlotOriginal || {};
    if(!S.shadowSlotOriginal[slotId]) S.shadowSlotOriginal[slotId] = rec.dataUrl;
    window.ShadowFramePlugin.open(S.shadowSlotOriginal[slotId], function(flatDataUrl){
      S.shadowPolaroid = S.shadowPolaroid || {};
      S.shadowPolaroid[slotId] = true;
      applyShadowSlotDataUrl(slotId, rec.type, flatDataUrl);
    });
  } else {
    S.shadowPolaroid = S.shadowPolaroid || {};
    S.shadowPolaroid[slotId] = false;
    var original = S.shadowSlotOriginal && S.shadowSlotOriginal[slotId];
    if(original) applyShadowSlotDataUrl(slotId, rec.type, original);
    else renderSlotBar();
  }
}

/* ── 版型(combo)切換：查CIRCLE_COMBO_SLOTS決定這個版型開哪些欄位，
   移除的slot要跟著從receiver清掉，但保留使用者已經上傳的圖(S.shadowSlots
   不清，只是這個版型用不到、暫時不畫)，這樣切回去還在，不用重傳 ── */
function setShadowCombo(combo){
  S.shadowCombo = combo;
  var order = getShadowOrder(combo); // 這行順便會在換組合時重設成該組合的預設順序
  /* order = 這個組合「結構上」有哪些槽位、疊放順序如何，不是「已經上傳圖片」的才算——
     空的槽位一樣要送進LC_SET_ENABLED，不然之後使用者上傳圖片時，upsertSlot
     雖然有把圖存進去，但因為這個slotId沒被列在enabled清單裡，drawItems()
     根本不會畫它，畫面看起來像「傳了但沒出現」。 */
  order.forEach(function(id){
    var rec = S.shadowSlots && S.shadowSlots[id];
    /* 這裡一定要傳 drawShadowCanvas 當redraw callback，不能傳null省事——
       upsertSlot內部是 new Image()+onload 非同步載入，位置計算(含頭部偵測)
       都在onload裡面才算完，傳null等於「圖真的載入完成的那一刻，沒有任何人
       去重畫」，畫面會一直卡在圖片還沒到之前的樣子（看起來像什麼都沒發生）。
       這裡多次呼叫redraw是安全的，反正只是re-run drawItems，不會累積副作用。 */
    if(rec) _shadowReceiver.handleMessage({ type:'LC_UPSERT_SLOT', slotId:id, slotType:rec.type, dataUrl:rec.dataUrl, ratio:rec.ratio, transform:rec.transform }, drawShadowCanvas);
  });
  _shadowReceiver.handleMessage({ type:'LC_SET_ENABLED', ids:order, combo:combo }, drawShadowCanvas);
  renderSlotBar();
}

function setShadowAngle(preset){
  _shadowReceiver.handleMessage({ type:'LC_SET_ANGLE', preset:preset }, drawShadowCanvas);
}

/* ── 開啟popup ── */
function openShadowPopup(){
  var overlay = createOverlay(
    '<div class="popup-panel" style="width:'+(SHADOW_DISPLAY+280)+'px;">'+
      '<div class="popup-head"><span>調整商品／主持人</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body" style="display:flex;gap:16px;">'+
        '<div style="width:220px;flex:none;">'+
          '<div class="field"><label>組合</label><select id="shadow-combo-sel"></select></div>'+
          '<div class="field"><label>光源角度</label>'+
            '<div style="display:flex;gap:6px;">'+
              '<button class="tbtn angle-btn" data-angle="left">左</button>'+
              '<button class="tbtn angle-btn" data-angle="top">中</button>'+
              '<button class="tbtn angle-btn" data-angle="right">右</button>'+
            '</div>'+
          '</div>'+
          '<div id="shadow-scale-panel" class="field" style="display:none;margin-top:14px;">'+
            '<label>陰影寬度 <span id="shadow-scale-x-val">100%</span></label>'+
            '<input type="range" id="shadow-scale-x" min="30" max="200" value="100" style="width:100%;">'+
            '<label style="margin-top:6px;">陰影長度 <span id="shadow-scale-y-val">100%</span></label>'+
            '<input type="range" id="shadow-scale-y" min="30" max="200" value="100" style="width:100%;">'+
          '</div>'+
          '<div class="section-title" style="margin-top:14px;">素材清單</div>'+
          '<div id="shadow-slotbar"></div>'+
        '</div>'+
        '<div>'+
          '<div class="pos-editor-stage" style="width:'+SHADOW_DISPLAY+'px;height:'+SHADOW_DISPLAY+'px;">'+
            '<canvas id="shadow-compose-canvas" width="1200" height="1200" style="width:'+SHADOW_DISPLAY+'px;height:'+SHADOW_DISPLAY+'px;"></canvas>'+
          '</div>'+
          '<div class="hint" style="margin-top:8px;">拖曳移動；拖角落縮放；選取單一素材時上方有旋轉把手（按住Shift每15°吸附，雙擊歸零）；多選(Shift/Ctrl點選)可整組拖曳/縮放；Ctrl+Z復原。</div>'+
        '</div>'+
      '</div>'+
      '<div class="popup-foot">'+
        '<button class="tbtn primary" id="shadow-export-btn">確認並套用到主持人圖層</button>'+
      '</div>'+
    '</div>'
  );

  initShadowPopup();

  var comboSel = overlay.querySelector('#shadow-combo-sel');
  comboSel.innerHTML = window.CIRCLE_COMBO_UI.map(function(o){
    return '<option value="'+o.value+'">'+o.label+'</option>';
  }).join('');
  comboSel.value = S.shadowCombo || 'A';
  comboSel.onchange = function(){ setShadowCombo(comboSel.value); };

  overlay.querySelectorAll('[data-angle]').forEach(function(btn){
    if(btn.dataset.angle === 'left') btn.classList.add('active'); // ShadowPlugin預設角度是left，跟畫面初始狀態對齊
    btn.onclick = function(){
      setShadowAngle(btn.dataset.angle);
      overlay.querySelectorAll('[data-angle]').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
    };
  });

  /* 陰影獨立X/Y縮放滑桿：只改「目前正在編輯的那個slot」的shadowScaleX/Y，
     不用全域變數存縮放值——每個素材各自獨立記住（見shadow-layout-receiver.js
     的setShadowScale/getShadowScale）。 */
  var scaleXInput = overlay.querySelector('#shadow-scale-x');
  var scaleYInput = overlay.querySelector('#shadow-scale-y');
  scaleXInput.oninput = function(){
    var active = _shadowReceiver.getActiveSlot();
    if(!active) return;
    document.getElementById('shadow-scale-x-val').textContent = scaleXInput.value+'%';
    _shadowReceiver.setShadowScale(active, 'x', Number(scaleXInput.value)/100, drawShadowCanvas);
  };
  scaleYInput.oninput = function(){
    var active = _shadowReceiver.getActiveSlot();
    if(!active) return;
    document.getElementById('shadow-scale-y-val').textContent = scaleYInput.value+'%';
    _shadowReceiver.setShadowScale(active, 'y', Number(scaleYInput.value)/100, drawShadowCanvas);
  };

  overlay.querySelector('#shadow-export-btn').onclick = exportShadowComposite;

  setShadowCombo(S.shadowCombo || 'A');
  drawShadowCanvas();
}

/* ── 匯出：陰影+照片分開畫再合成，避免陰影的multiply混合模式把照片也弄灰
   （原理跟pet-frenzy的editor-shadow-canvas.js完全一樣，直接照搬這段運算） ── */
function exportShadowComposite(){
  if(!_shadowReceiver || typeof ShadowPlugin === 'undefined') return;
  var states = _shadowReceiver.getOrderedStates();
  if(!states.length){ alert('目前沒有任何素材可以匯出'); return; }

  ShadowPlugin.configureZone(1200*0.1, 1200*0.95);

  var shadowCv = document.createElement('canvas');
  shadowCv.width = 1200; shadowCv.height = 1200;
  var sctx = shadowCv.getContext('2d');
  sctx.fillStyle = '#ffffff';
  sctx.fillRect(0,0,1200,1200);
  ShadowPlugin.renderScene(sctx, states, true);

  try{
    var imgData = sctx.getImageData(0,0,1200,1200);
    var d = imgData.data;
    for(var i=0;i<d.length;i+=4){
      var r=d[i], g=d[i+1], b=d[i+2];
      var alpha = 255 - Math.min(r,g,b);
      if(alpha <= 1){ d[i]=0; d[i+1]=0; d[i+2]=0; d[i+3]=0; continue; }
      d[i]   = Math.max(0, Math.min(255, 255 - (255-r)*255/alpha));
      d[i+1] = Math.max(0, Math.min(255, 255 - (255-g)*255/alpha));
      d[i+2] = Math.max(0, Math.min(255, 255 - (255-b)*255/alpha));
      d[i+3] = alpha;
    }
    sctx.putImageData(imgData, 0, 0);
  }catch(e){ console.warn('[shadow-popup] 陰影去白轉透明失敗：', e); }

  var photoCv = document.createElement('canvas');
  photoCv.width = 1200; photoCv.height = 1200;
  var pctx = photoCv.getContext('2d');
  ShadowPlugin.renderPhotosOnly(pctx, states);

  var outCv = document.createElement('canvas');
  outCv.width = 1200; outCv.height = 1200;
  var octx = outCv.getContext('2d');
  _shadowReceiver.drawStage(octx, { skipSelection:true });
  octx.drawImage(shadowCv, 0, 0);
  octx.drawImage(photoCv, 0, 0);

  /* ★ 用toDataURL()（base64字串）取代原本的toBlob()+URL.createObjectURL()：
     blob網址(blob:...)只在「這次瀏覽器分頁還活著」的期間有效，關掉分頁/
     重新整理就會失效——這裡的img.src會被saveCurrentTabIntoData()原封不動
     存進「暫存」的.json檔，如果存的是blob網址，暫存檔案本身雖然存了那個
     網址字串，但下次讀回來(甚至同一個分頁重新整理)時瀏覽器早就不認得那個
     blob網址了，等於「商品圖不見了」。改用toDataURL()產生的data:網址是
     完整內嵌圖片資料的字串，不管存到哪裡、隔多久讀回來都一樣有效。 */
  var dataUrl = outCv.toDataURL('image/png');
  var img = new Image();
  img.onload = function(){
    S.assets = S.assets || {};
    S.assets.host = img;
    closePopup();
    renderAll();
  };
  img.src = dataUrl;
}
