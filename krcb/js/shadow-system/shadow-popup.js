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
    （商品去背已於2026-09補上：改用獨立模組 js/erase-editor.js 的
      SkbnEraseEditor，不是pet的editor-plugin.js，見openEraseEditor()。）
*/

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
  _shadowReceiver = ShadowLayoutReceiver.create(_shadowCanvas, { stageId:'_shadow_compose', savedStage: S.stageTransform });
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

/* 1200畫布背景圖——跟 modules/background-module.js 同一套「先試圖片、
   沒有就退回純色」的做法：backgrounds/{版本}/_shadow_compose.jpg 存在就
   鋪滿當背景（等比例裁切、跟CSS object-fit:cover一樣），找不到.jpg會再
   試.png，都沒有才退回試沒有版本資料夾的舊路徑，最後才是純色(S.bg.
   seedHex)。圖片非同步載入，第一次畫的時候圖還沒到，會先用純色墊著，
   載入完成後呼叫一次drawShadowCanvas()換成真正的背景圖——popup如果已經
   關掉（_shadowCtx變null）就不會再畫。
   2026-08(KRCB)修正：這張圖原本被當成「跟版位背景圖是不同用途」，寫死
   固定路徑backgrounds/_shadow_compose.jpg，完全沒有走A/B/C版本系統——
   但使用者確認這張圖其實也算「這個版本的素材」，換版本時應該要能跟著換，
   改成先查backgrounds/{版本}/_shadow_compose.jpg，找不到才退回舊的固定
   路徑(相容用)。版本一樣是從getBgVersion()拿，跟其他版位背景圖共用
   同一個全域設定，不用另外選一次。 */
var _shadowBgCache = {}; // cacheKey(版本) -> { status:'loading'|'loaded'|'missing', img }

function _loadShadowBg(){
  var version = (typeof getBgVersion === 'function') ? getBgVersion() : 'A';
  var entry = { status:'loading', img:null };
  _shadowBgCache[version] = entry;
  var img = new Image();
  var candidates = [
    'backgrounds/'+version+'/_shadow_compose.jpg',
    'backgrounds/'+version+'/_shadow_compose.png',
    'backgrounds/_shadow_compose.jpg', // 舊路徑相容(沒有版本資料夾)
    'backgrounds/_shadow_compose.png'
  ];
  var idx = 0;
  function tryNext(){
    if(idx >= candidates.length){ entry.status = 'missing'; drawShadowCanvas(); return; }
    img.src = candidates[idx++];
  }
  img.onload = function(){
    entry.status = 'loaded';
    entry.img = img;
    drawShadowCanvas();
  };
  img.onerror = tryNext;
  tryNext();
}

function _drawShadowBgCover(ctx, img, w, h){
  var ir = img.naturalWidth / img.naturalHeight;
  var cr = w / h;
  var sx, sy, sw, sh;
  if(ir > cr){ sh = img.naturalHeight; sw = sh * cr; sx = (img.naturalWidth - sw) / 2; sy = 0; }
  else { sw = img.naturalWidth; sh = sw / cr; sx = 0; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

function drawShadowCanvas(){
  if(!_shadowCtx) return;
  _shadowCtx.clearRect(0,0,1200,1200);

  var bgVersion = (typeof getBgVersion === 'function') ? getBgVersion() : 'A';
  var bgEntry = _shadowBgCache[bgVersion];
  if(!bgEntry) _loadShadowBg();

  if(bgEntry && bgEntry.status === 'loaded'){
    _drawShadowBgCover(_shadowCtx, bgEntry.img, 1200, 1200);
  } else {
    _shadowCtx.fillStyle = (window.S && S.bg && S.bg.seedHex) || '#d8d8d8';
    _shadowCtx.fillRect(0,0,1200,1200);
  }

  /* 舞台固定在所有商品/主持人的最下方（背景層），商品都疊在舞台前面。
     原本有做「放在舞台上」勾選框讓每個素材自己選要疊在舞台前或後，
     使用者反映目前先不需要這個選項、舞台預設當背景就好，UI checkbox
     先隱藏（見renderSlotBar()的stageRow那段），底層的onStage分組邏輯
     還留著沒刪（getShadowOrderGroups()/S.shadowSlots[id].onStage都在），
     只是這裡不再依它分兩批畫，一律當作全部素材都疊在舞台前面。之後如果
     要重新開放這個功能，把下面兩行換回「先畫groups.behind、畫舞台、
     再畫groups.onStage」的三段式寫法（保留在上面的函式註解歷史裡）就好。 */
  if(S.stageEnabled !== false) _shadowReceiver.drawStage(_shadowCtx);
  _shadowReceiver.drawItems(_shadowCtx, { skipSelection: true }); // 不傳onlyIds＝畫全部素材，一律疊在舞台前面
  _shadowReceiver.drawItems(_shadowCtx, { onlyIds: [] }); // 只用來畫選取框，素材已經在上面畫過了
  syncTransformsIntoState();
}

/* 把目前的疊放順序(getShadowOrder())拆成「舞台後」跟「舞台上」兩組，各自
   保留原本的前後順序。S.shadowSlots[id].onStage沒設定(undefined)就是預設
   的「舞台後」，跟使用者在清單裡看到的checkbox初始未勾選狀態一致。 */
function getShadowOrderGroups(){
  var combo = S.shadowCombo || 'A';
  var order = getShadowOrder(combo);
  var onStage = order.filter(function(id){ return !!(S.shadowSlots && S.shadowSlots[id] && S.shadowSlots[id].onStage); });
  var behind = order.filter(function(id){ return onStage.indexOf(id) === -1; });
  return { behind: behind, onStage: onStage };
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
  var stageRaw = _shadowReceiver.getStageRaw();
  if(stageRaw) S.stageTransform = stageRaw;
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
    /* 2026-08(KRCB)修正：使用者反映商品變成3個之後常常拉不動排序——原本
       用瀏覽器原生的HTML5拖放(draggable屬性+dragstart/dragover/drop事件)，
       這套機制本身就容易受滑鼠移動細節、瀏覽器差異影響，項目一多更容易
       失靈。改成不依賴原生drag-and-drop、完全自己用pointer事件控制的拖曳
       (見下面dragHandle.addEventListener('pointerdown',...))，box本身
       不需要是draggable元素，只有「⠿」把手需要監聽pointerdown當作拖曳
       起點，box其餘部分(縮圖/checkbox等)點擊行為完全不受影響，兩種手勢
       天生不會互搶。 */
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
      /* 點擊範圍是「整個素材框」(box)，不是只有中間那個44x44縮圖——
         使用者反映範圍太小、shift+點選常常點不中。刪除按鈕(×)、拍立得
         checkbox這些box內部的次要控制項，各自的click handler本來就有
         stopPropagation()擋著，不會被這裡的框級點擊誤觸發選取。 */
      box.addEventListener('click', function(e){
        if(!hasImg){ triggerSlotUpload(slotId, def.type); return; }
        /* shift/ctrl/cmd+點素材框＝多選切換，跟畫布上shift+點選同一套規則
           （已選取就移除、沒選取就加入），選好之後一樣可以在1200畫布上
           整組拖曳/縮放（相對位置不變）——見shadow-layout-receiver.js的
           setSelectedSlots()/currentGroupIds()。沒按修飾鍵＝維持原本的
           單選行為。 */
        var multiKey = e.shiftKey || e.ctrlKey || e.metaKey;
        if(multiKey){
          e.preventDefault(); // 保險再擋一次瀏覽器原生的shift文字選取行為，跟CSS的user-select:none雙重防呆
          var current = _shadowReceiver.getSelectedSlots();
          var idx = current.indexOf(slotId);
          var next = current.slice();
          if(idx === -1) next.push(slotId); else next.splice(idx, 1);
          _shadowReceiver.setSelectedSlots(next, drawShadowCanvas);
        } else {
          _shadowReceiver.setActiveSlot(slotId, drawShadowCanvas);
        }
        renderSlotBar();
      });
      var delBtn = box.querySelector('.shadow-slot-del');
      if(delBtn) delBtn.addEventListener('click', function(e){ e.stopPropagation(); removeShadowSlot(slotId); });

      /* 去背（2026-09新增）：跟拍立得各自獨立——不管有沒有勾拍立得、不管是商品還是人物，
         只要這格已經有圖就顯示；位置固定在拍立得的左邊（見openEraseEditor()）。 */
      if(hasImg){
        var eraseBtn = document.createElement('button');
        eraseBtn.type = 'button';
        eraseBtn.className = 'shadow-erase-btn';
        eraseBtn.textContent = '去背';
        eraseBtn.title = '橡皮擦 / 裁切 / 自動去背 / 點選顏色去背';
        eraseBtn.draggable = false; // 蓋掉繼承自box的draggable，避免點擊被誤判成拖曳手勢
        eraseBtn.addEventListener('click', function(e){ e.stopPropagation(); openEraseEditor(slotId); });
        box.appendChild(eraseBtn);
      }

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

      /* 舞台前/後：先隱藏——目前舞台固定當所有素材的背景層(見drawShadowCanvas()/
         exportShadowComposite()的說明)，這個checkbox先不顯示，之後如果要重新
         開放「個別素材可以選要不要疊在舞台前面」，把下面這整段if區塊的內容
         (原本包在stageRow裡)復原、拿掉這個false判斷就好，S.shadowSlots[slotId].onStage
         這個資料欄位本身沒有被刪掉，之前設定過的值還在，只是UI先不給選。 */
      if(false && hasImg){
        var stageRow = document.createElement('div');
        stageRow.className = 'shadow-frame-row';
        stageRow.draggable = false;
        var onStageChecked = !!(S.shadowSlots && S.shadowSlots[slotId] && S.shadowSlots[slotId].onStage);
        stageRow.innerHTML = '<label><input type="checkbox" '+(onStageChecked?'checked':'')+'> 放在舞台上</label>';
        stageRow.addEventListener('click', function(e){ e.stopPropagation(); });
        stageRow.querySelector('input').addEventListener('change', function(e){
          if(S.shadowSlots && S.shadowSlots[slotId]) S.shadowSlots[slotId].onStage = e.target.checked;
          drawShadowCanvas();
        });
        box.appendChild(stageRow);
      }

      /* 2026-08(KRCB)再次修正：使用者反映拖曳「拉過去了但會彈回來」——
         抓到真正原因：上一版用CSS transform(translateY)讓box跟著滑鼠
         移動，但拖曳過程中一旦執行bar.insertBefore()把box搬到DOM的新
         位置，box在「沒有transform時」的原始座標(layout位置)也跟著整個
         換了——這時候transform還是沿用拖曳開始時算出的舊偏移量，等於
         「移動基準點」在拖曳中途偷偷換了，後續的距離計算全部跟著跑掉，
         使用者看到的就是「東西動一動又彈回去」。
         改法：不用transform，直接把box設成position:fixed，left/top
         直接等於滑鼠目前位置(扣掉抓取點的偏移量)——這樣box的視覺位置只
         跟「滑鼠在哪」有關，跟它在DOM裡實際排第幾個完全無關，重新排序
         DOM時不會反過來影響已經算好的視覺位置，兩者徹底脫鉤，不會再有
         「基準點跑掉」這個問題。
         判斷插入點的方式也改了：不再跟前後兩個sibling個別比較(那個算法
         在box本身還留在原本DOM流裡佔位置時很容易連續觸發兩次判斷、
         互相干擾)，改成「先把box整個排除在外，重新算一次剩下每個
         sibling的位置，直接用滑鼠Y座標跟每個sibling的中點比較」，是
         業界常見的清單拖曳排序演算法，不會受目前box自己排第幾個影響。
         另外加了console.log，之後如果拖曳還有異常，麻煩開瀏覽器F12的
         Console分頁，把拖曳過程中印出來的內容複製給我，可以更準確定位
         問題出在哪一步。 */
      var dragHandle = box.querySelector('.shadow-slot-drag');
      dragHandle.addEventListener('pointerdown', function(e){
        e.preventDefault();
        var startIdx = displayIdx;
        var currentIdx = startIdx;
        var rect = box.getBoundingClientRect();
        var grabOffsetX = e.clientX - rect.left;
        var grabOffsetY = e.clientY - rect.top;

        console.log('[圖層拖曳] 開始：slotId=', slotId, ' 起始位置idx=', startIdx, ' 抓取點=', {x:e.clientX, y:e.clientY});

        box.style.position = 'fixed';
        box.style.left = rect.left + 'px';
        box.style.top = rect.top + 'px';
        box.style.width = rect.width + 'px';
        box.style.zIndex = '999';
        box.style.pointerEvents = 'none'; // 拖曳中box自己不要擋住底下判斷siblings位置用的getBoundingClientRect
        box.classList.add('dragging');
        try{ dragHandle.setPointerCapture(e.pointerId); }catch(err){}

        function onMove(e2){
          box.style.left = (e2.clientX - grabOffsetX) + 'px';
          box.style.top = (e2.clientY - grabOffsetY) + 'px';

          /* box已經是position:fixed，不占用bar的正常排版流——這裡的
             bar.children仍然包含box本身(DOM節點還在，只是視覺上飄在
             最上層)，明確排除掉它，剩下的才是真正「還排在清單裡」的
             項目，拿滑鼠Y座標(不是box的座標)去跟每個項目的中點比較，
             決定滑鼠目前對應清單裡的第幾個位置。 */
          var siblings = Array.prototype.slice.call(bar.children).filter(function(el){ return el !== box; });
          var newIdx = 0;
          for(var i=0;i<siblings.length;i++){
            var r = siblings[i].getBoundingClientRect();
            if(e2.clientY > r.top + r.height/2) newIdx = i+1;
          }
          if(newIdx !== currentIdx){
            console.log('[圖層拖曳] 移動中：從idx=', currentIdx, ' 換到idx=', newIdx);
            if(newIdx >= siblings.length) bar.appendChild(box);
            else bar.insertBefore(box, siblings[newIdx]);
            currentIdx = newIdx;
          }
        }
        function onUp(e3){
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          try{ dragHandle.releasePointerCapture(e3.pointerId); }catch(err){}
          box.style.position = '';
          box.style.left = '';
          box.style.top = '';
          box.style.width = '';
          box.style.zIndex = '';
          box.style.pointerEvents = '';
          box.classList.remove('dragging');
          console.log('[圖層拖曳] 放開：startIdx=', startIdx, ' 最終currentIdx=', currentIdx, currentIdx!==startIdx ? '→ 有變動，寫回S.shadowOrder' : '→ 沒有變動，位置不變');
          if(currentIdx !== startIdx){
            _shadowMoveSlot(startIdx, currentIdx, displayOrder);
            console.log('[圖層拖曳] 更新後的S.shadowOrder=', JSON.stringify(S.shadowOrder));
          } else {
            renderSlotBar(); // 沒有真的移動位置，重畫回原狀(清掉拖曳過程中暫時搬動DOM的殘留)
          }
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
    })(slotId, def, box);

    bar.appendChild(box);
  });

  updateShadowScalePanel();
}

/* 拖曳排序的實際搬移邏輯：displayOrder是「上=前景」，
   fromIdx/toIdx都是displayOrder裡的index，搬完換回S.shadowOrder(後面=
   前景)要再反轉一次——跟原本drop事件裡的邏輯完全一樣，只是抽成獨立函式
   讓兩種操作方式共用，不用維護兩份幾乎一樣的程式碼。 */
function _shadowMoveSlot(fromIdx, toIdx, displayOrder){
  var moved = displayOrder.splice(fromIdx, 1)[0];
  displayOrder.splice(toIdx, 0, moved);
  S.shadowOrder = displayOrder.slice().reverse();
  broadcastShadowOrder();
  renderSlotBar();
}

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
  /* 複製一份再回傳，不要動到S.shadowOrder本身——那份資料只追蹤combo定義的
     商品/人物槽位，上面的sameSet比對邏輯需要它維持「跟defaultOrder同一組
     id」，如果直接把kvElement塞進S.shadowOrder，下次比對會發現數量對不上、
     誤判成「combo換了」而重設，等於使用者手動排的順序無緣無故被重置。
     KV小元素固定加在陣列最前面（陣列前面＝後方，見shadow-layout-receiver.js
     的enabledIds註解）——它「固定在最後面(最底層)」這個需求，不跟商品的
     疊放順序混在一起處理。 */
  var order = S.shadowOrder.slice();
  if(S.kvElementEnabled) order.unshift(KV_ELEMENT_SLOT_ID);
  return order;
}

function broadcastShadowOrder(){
  var combo = S.shadowCombo || 'A';
  var order = getShadowOrder(combo);
  _shadowReceiver.handleMessage({ type:'LC_SET_ENABLED', ids:order, combo:combo }, drawShadowCanvas);
}

/* ══════════════════ KV小元素 ══════════════════
   使用者需求：固定同一張素材(不像LOGO依工單換檔案)，跟舞台一樣從固定路徑
   載入；但跟舞台不同的是——它要能像商品一樣自己縮放/旋轉/移動。使用者
   確認過三件事：(1)不需要貼地陰影/光暈效果 (2)不需要出現在「素材清單」
   圖層列表裡、不用單獨拖曳排序 (3)固定疊在所有商品最後面(最底層)。

   做法：直接借用商品/人物同一套slot機制(拖曳/縮放/旋轉全部現成、已經在
   用，不用重新寫一套互動邏輯)，只是：
     - slotType傳'plain'，讓modules/shadow-plugin.js的drawItem()走新增的
       drawPlain()分支——只畫圖片+旋轉，不套用陰影/光暈
     - 不列進_shadowSlotDefs，所以不會出現在renderSlotBar()的清單UI裡
       （清單只顯示_shadowSlotDefs裡有定義的slotId，見renderSlotBar()的
       `if(!def) return;`）
     - 疊放順序固定「加在最前面」——陣列前面＝後方（見
       shadow-layout-receiver.js的enabledIds註解），所以kvElement最後面
       這件事，是透過getShadowOrder()回傳時固定把它擺在陣列第一個位置
       做到的，不需要使用者手動排序、也不受combo切換影響。

   固定素材路徑：logos/kv-element.png（找不到會自動試.jpg）。 */
var KV_ELEMENT_SLOT_ID = 'kvElement';
var KV_ELEMENT_DEFAULT_H = 240; // 預設高度240px（1200畫布）——原本150px使用者反映要再大一點，調到240px
var _kvElementDataUrl = null;   // 快取，同一次網頁使用只需要抓一次檔案

function loadKvElementDataUrl(cb){
  if(_kvElementDataUrl){ cb(_kvElementDataUrl); return; }
  function tryFetch(path, isLast){
    fetch(path).then(function(r){
      if(!r.ok) throw new Error('not found');
      return r.blob();
    }).then(function(blob){
      var reader = new FileReader();
      reader.onload = function(ev){ _kvElementDataUrl = ev.target.result; cb(_kvElementDataUrl); };
      reader.readAsDataURL(blob);
    }).catch(function(){
      if(!isLast) tryFetch('logos/kv-element.jpg', true);
      else { console.warn('[shadow-popup] 找不到 logos/kv-element.png 或 .jpg，KV小元素無法載入'); cb(null); }
    });
  }
  tryFetch('logos/kv-element.png', false);
}

/* 「加入KV小元素」checkbox onchange呼叫這支。
   開：載入固定素材，第一次加入的話用「假裝savedTransform」的方式直接
   指定初始transform(高度150px、置中偏下方，使用者可以之後自己拖曳調整位置)，
   繞過upsertSlot()原本「查layout預設值」那條路——那條路是給combo定義好的
   商品/人物槽位用的，這個slotId不在任何combo定義裡，查不到，會退回一個
   跟這裡需求無關的自動排列。
   關：從receiver移除，S.kvElementEnabled設false，但S.shadowSlots裡的紀錄
   刻意不刪——下次重新勾選，之前調整過的位置/縮放/旋轉還在，不用重新調。 */
function toggleKvElement(on){
  S.kvElementEnabled = !!on;
  if(!on){
    _shadowReceiver.handleMessage({ type:'LC_REMOVE_SLOT', slotId: KV_ELEMENT_SLOT_ID }, drawShadowCanvas);
    broadcastShadowOrder();
    return;
  }
  loadKvElementDataUrl(function(dataUrl){
    if(!dataUrl) return;
    var existing = S.shadowSlots && S.shadowSlots[KV_ELEMENT_SLOT_ID];
    if(existing && existing.transform){
      S.shadowSlots[KV_ELEMENT_SLOT_ID] = { dataUrl: dataUrl, type: 'plain', ratio: existing.ratio, transform: existing.transform };
      _shadowReceiver.handleMessage({ type:'LC_UPSERT_SLOT', slotId: KV_ELEMENT_SLOT_ID, slotType:'plain', dataUrl:dataUrl, ratio:existing.ratio, transform:existing.transform }, drawShadowCanvas);
      broadcastShadowOrder();
      return;
    }
    var img = new Image();
    img.onload = function(){
      var h0 = KV_ELEMENT_DEFAULT_H;
      var w0 = img.naturalWidth * (h0/img.naturalHeight);
      /* 預設位置：畫布(1200x1200)右上角，比上一版再往左、往下收一點——
         使用者反映原本(1050,150)會超出畫布邊緣，改成(880,280)，配合
         240px的預設高度，留更多邊距確保完整落在畫布範圍內。之後使用者
         可以直接拖曳到想要的地方，這個座標不是固定規則，只是一個合理
         的起點。 */
      var transform = { x: 880, y: 280, w0: w0, h0: h0, scaleMul: 1, rot: 0 };
      S.shadowSlots = S.shadowSlots || {};
      S.shadowSlots[KV_ELEMENT_SLOT_ID] = { dataUrl: dataUrl, type: 'plain', ratio: undefined, transform: transform };
      _shadowReceiver.handleMessage({ type:'LC_UPSERT_SLOT', slotId: KV_ELEMENT_SLOT_ID, slotType:'plain', dataUrl:dataUrl, ratio:undefined, transform:transform }, drawShadowCanvas);
      broadcastShadowOrder();
    };
    img.src = dataUrl;
  });
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

/* 去背（2026-09新增）：開SkbnEraseEditor（js/erase-editor.js，獨立模組），完成後把去背結果
   當成一般素材重新套回這個slot——跟「換圖」走同一條路(applyShadowSlotDataUrl)，
   receiver會保留原本的位置/大小/角度，貼地陰影也照常重算。
   跟拍立得各自獨立：直接編輯slot「目前」的圖（拍立得開著時，那張圖就是照片+框攤平後的樣子）。 */
function openEraseEditor(slotId){
  var rec = S.shadowSlots && S.shadowSlots[slotId];
  if(!rec) return;
  if(!window.SkbnEraseEditor){
    console.warn('[shadow-popup] 找不到 SkbnEraseEditor（js/erase-editor.js 沒載入）');
    window.alert('去背模組沒有載入，請確認 editor.html 有引入 js/erase-editor.js');
    return;
  }
  var def = (typeof _shadowSlotDefs !== 'undefined') ? _shadowSlotDefs.filter(function(d){ return d.id===slotId; })[0] : null;
  window.SkbnEraseEditor.open(rec.dataUrl, {
    title: (def && def.label ? def.label + ' ' : '') + '去背',
    onApply: function(result){
      var cur = S.shadowSlots && S.shadowSlots[slotId];
      if(!cur) return; // 編輯期間這格被刪掉了
      /* S.shadowSlotOriginal只是給「取消拍立得」還原用的原圖：拍立得沒開的時候，
         它可能還留著更早之前勾過拍立得的舊原圖，如果不清掉，之後再勾拍立得會拿到
         去背前的舊圖。拍立得開著時不動它（取消拍立得仍然要能還原成套框前的樣子）。 */
      if(!(S.shadowPolaroid && S.shadowPolaroid[slotId]) && S.shadowSlotOriginal) delete S.shadowSlotOriginal[slotId];
      applyShadowSlotDataUrl(slotId, cur.type, result.dataUrl);
    }
  });
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
  /* 2026-08(KRCB)修正「3品匯入後疊在一起，不是左中右並排」：原本這裡先
     送LC_UPSERT_SLOT(針對每個slot把圖片資料送進receiver)、最後才送
     LC_SET_ENABLED(這則訊息才會真的把receiver內部的currentComboLetter
     更新成這次的combo，見js/shadow-system/shadow-layout-receiver.js的
     getSlotLayout()——它是靠currentComboLetter去查ShadowLayoutDefaults
     該用哪組座標)。upsertSlot()幫「第一次出現、還沒有savedTransform」的
     素材決定初始位置，就是在LC_UPSERT_SLOT這個時間點當下執行的——如果
     這時候currentComboLetter還沒被更新成正確的combo(例如還是receiver
     剛建立時的初始值)，查到的座標就可能是錯的那組(或退回_fallback)，
     跟預期的「左中右各自的位置」對不起來，多個商品因此擠在同一個點上、
     看起來像疊在一起。
     修法：先送LC_SET_ENABLED(讓currentComboLetter先確實更新成這次的
     combo)，再送LC_UPSERT_SLOT(這時候查到的座標保證是這次combo的
     正確定義)——只是把兩種訊息的送出順序對調，訊息內容本身完全沒變。 */
  _shadowReceiver.handleMessage({ type:'LC_SET_ENABLED', ids:order, combo:combo }, drawShadowCanvas);
  order.forEach(function(id){
    var rec = S.shadowSlots && S.shadowSlots[id];
    /* 這裡一定要傳 drawShadowCanvas 當redraw callback，不能傳null省事——
       upsertSlot內部是 new Image()+onload 非同步載入，位置計算(含頭部偵測)
       都在onload裡面才算完，傳null等於「圖真的載入完成的那一刻，沒有任何人
       去重畫」，畫面會一直卡在圖片還沒到之前的樣子（看起來像什麼都沒發生）。
       這裡多次呼叫redraw是安全的，反正只是re-run drawItems，不會累積副作用。 */
    if(rec) _shadowReceiver.handleMessage({ type:'LC_UPSERT_SLOT', slotId:id, slotType:rec.type, dataUrl:rec.dataUrl, ratio:rec.ratio, transform:rec.transform }, drawShadowCanvas);
  });
  renderSlotBar();
}

function setShadowAngle(preset){
  S.shadowAngle = preset; // 存進S，才會跟著tab資料一起存檔/還原，重開popup不會跳回預設值
  _shadowReceiver.handleMessage({ type:'LC_SET_ANGLE', preset:preset }, drawShadowCanvas);
}

/* 匯入流程如果一次有多個「曝光日期」區塊(多頁分頁)，確認完這個popup要
   自動接著跳下一個區塊的流程——存這裡，exportShadowComposite()結束時
   (使用者按「確認並套用」)呼叫一次就清空，避免重複觸發。手動點右上角
   ×關掉popup（放棄這次調整）則不會觸發，跟原本「使用者主動關掉=不繼續」
   的直覺一致。 */
var _shadowPopupOnConfirm = null;

/* 2026-08新增：popup版位需要自己獨立的一組商品(popupHost)，不能跟main那組
   共用S.shadowSlots/S.shadowCombo/S.shadowAngle/S.stageEnabled/
   S.kvElementEnabled這幾個全域欄位——不然「確認main商品」跟「確認popup
   商品」兩次會互相蓋掉對方排好的內容。
   做法：這幾個「合成用」的欄位維持全域單一份(S.shadowSlots等)給
   ShadowPlugin/receiver直接讀寫，不用整個subsystem改成參數化(改動範圍
   太大、風險高)；改成「進popup前先把目前這份存到旁邊、換上popup自己那份
   給使用者編輯，離開popup(確認或關閉)時存回popup自己的欄位、再把原本main
   那份還原回來」的swap做法，對ShadowPlugin/receiver來說完全無感、不用
   改那幾支檔案的任何一行。
   targetAssetKey：這次確認完要寫進S.assets的哪個key('host'或'popupHost')，
   預設'host'維持原本行為完全不變。 */
var _shadowPopupTargetAssetKey = 'host';
var _shadowPopupSwappedOut = null; // 進popup前備份的main那份，離開時要還原回去

function _swapInPopupShadowState(){
  _shadowPopupSwappedOut = {
    shadowSlots: S.shadowSlots,
    shadowCombo: S.shadowCombo,
    shadowAngle: S.shadowAngle,
    stageEnabled: S.stageEnabled,
    kvElementEnabled: S.kvElementEnabled,
    shadowPolaroid: S.shadowPolaroid,
    shadowSlotOriginal: S.shadowSlotOriginal,
    shadowOrder: S.shadowOrder,
    stageTransform: S.stageTransform
  };
  S.shadowSlots = JSON.parse(JSON.stringify(S.popupShadowSlots || {}));
  S.shadowCombo = S.popupShadowCombo || 'C';
  S.shadowAngle = S.popupShadowAngle;
  S.stageEnabled = S.popupStageEnabled;
  S.kvElementEnabled = S.popupKvElementEnabled;
  S.shadowPolaroid = JSON.parse(JSON.stringify(S.popupShadowPolaroid || {}));
  S.shadowSlotOriginal = JSON.parse(JSON.stringify(S.popupShadowSlotOriginal || {}));
  S.shadowOrder = S.popupShadowOrder || null;
  S.stageTransform = S.popupStageTransform || null;
}
function _swapOutPopupShadowState(){
  S.popupShadowSlots = S.shadowSlots;
  S.popupShadowCombo = S.shadowCombo;
  S.popupShadowAngle = S.shadowAngle;
  S.popupStageEnabled = S.stageEnabled;
  S.popupKvElementEnabled = S.kvElementEnabled;
  S.popupShadowPolaroid = S.shadowPolaroid;
  S.popupShadowSlotOriginal = S.shadowSlotOriginal;
  S.popupShadowOrder = S.shadowOrder;
  S.popupStageTransform = S.stageTransform;
  if(_shadowPopupSwappedOut){
    S.shadowSlots = _shadowPopupSwappedOut.shadowSlots;
    S.shadowCombo = _shadowPopupSwappedOut.shadowCombo;
    S.shadowAngle = _shadowPopupSwappedOut.shadowAngle;
    S.stageEnabled = _shadowPopupSwappedOut.stageEnabled;
    S.kvElementEnabled = _shadowPopupSwappedOut.kvElementEnabled;
    S.shadowPolaroid = _shadowPopupSwappedOut.shadowPolaroid;
    S.shadowSlotOriginal = _shadowPopupSwappedOut.shadowSlotOriginal;
    S.shadowOrder = _shadowPopupSwappedOut.shadowOrder;
    S.stageTransform = _shadowPopupSwappedOut.stageTransform;
    _shadowPopupSwappedOut = null;
  }
}

/* ── 開啟popup ──
   targetAssetKey（選填，預設'host'）：這次確認完，合成結果要寫進
   S.assets的哪個key。傳'popupHost'時，會自動切換成popup自己獨立那組
   商品狀態(見上面_swapInPopupShadowState())，使用者在popup裡看到/調整的
   是popup自己的素材，不會動到main那組已經排好的內容。 */
/* ══════════════════ MSBN商品區：多張照片合成 ══════════════════
   2026-08(KRCB)新增：使用者需求——同一個商品格子(host/host1/host2)裡，
   有時候不是只有一張商品照，可能要主商品+贈品這種多張一起合成疊放(貼地
   陰影同一套)。原本點擊MSBN的商品格子只能直接上傳「一張」圖檔，沒有
   管道用到main商品那套「1200畫布多素材合成+貼地陰影」工具。
   這裡借用同一套合成引擎(openShadowPopup/exportShadowComposite)，差別
   在於結果不是寫進S.assets['host']（main商品共用的那個），而是直接套進
   這個MSBN實例自己的msbnLogos[instanceId][slotKey]——跟其他MSBN商品圖
   「直接上傳一張」寫進去的資料格式完全一樣，套用完可以正常拖曳/縮放/
   選取，使用者感覺不出這張圖背後是合成出來的還是直接上傳的。
   2026-08再修正兩個問題：
   ①「每次都要重新上傳、只有一次機會」——原本每次開合成popup都從空白
     開始，確認完也不記錄，下次要調整只能整個重來。改成每一格(instanceId
     +slotKey組合)自己的合成狀態存進S.msbnShadowSlots，下次點開同一格會
     自動載入上次的素材/位置/陰影設定繼續調，不用重新上傳。
   ②「按×取消，main商品的素材不見了」——原本只有「確認」(exportShadow
     Composite→cb)才會把main商品狀態還原回去，使用者如果按右上角×直接
     關掉(沒有按確認)，main商品的S.shadowSlots等就會一直停在被清空的
     狀態，之後回main分頁看商品會發現素材不見了。改成×按鈕也綁一個
     "取消"處理，一樣會把main商品狀態還原，只是不套用/不儲存這次的
     合成結果(等於這次編輯內容不算，其他格子的持久化狀態、main商品都
     完全不受影響)。
   做法：
   ①開合成popup之前，先把目前main商品的整組合成狀態(S.shadowSlots等)
     存起來、清空，讓這次MSBN合成從這一格「上次存的狀態」(沒有就從空白)
     開始，不會不小心把main商品的素材混進來，也不會反過來污染main商品。
   ②openShadowPopup()傳alreadySwapped=true，跳過它自動幫「popup」那個
     舊機制做的swap-in(那個機制在KRCB已經沒有實際用途，見configs/
     layouts/08_popup.json的說明——KRCB的popup版位改用跟其他版位共用的
     host，不再有自己獨立的popupHost)——不需要它，我們自己管理狀態。
   ③合成完成(確認)後：先把這次的合成狀態存回這一格自己的
     S.msbnShadowSlots[key]（下次點開才有得載入），再讀S.assets裡暫存的
     合成結果套進目標MSBN格子，最後把①存起來的main商品狀態還原回去。
     取消(×)則跳過「存這一格」跟「套用結果」，只做「把main商品狀態還原
     回去」。 */
var _msbnComposeSavedState = null;
var _msbnComposeTarget = null;
var MSBN_COMPOSE_SCRATCH_KEY = '_msbnComposeScratch';

/* 2026-09新增：算「這張已經合成好的1200x1200 PNG」裡實際有內容(非透明)的
   緊密範圍，用比例(0~1)表示——跟js/shadow-system/shadow-plugin.js的
   detectAlphaTrim()同一套算法，差別是那支是量單一素材原圖，這支是量
   「自動合成完、已經燒錄成一張扁平圖」的最終結果。
   為什麼需要這個：autoComposeMsbnHost()的合成畫布固定是1200x1200，但
   商品+陰影通常只佔中下方一小塊(MSBN_AUTO_SIDE_BY_SIDE_HPCT=0.42，加上
   陰影本身的斜切/擴散範圍)，四周有大量透明留白。如果直接拿整張1200x1200
   的原始尺寸去跟MSBN格子(box)比對縮放比例，等於把留白也算進「商品大小」
   一起換算，算出來的比例不是「商品視覺上實際大小 vs 格子大小」的正確
   對應關係——這正是使用者回報「自動套用陰影後，商品大小會超出格子範圍」
   的根本原因（見下面_onMsbnComposeConfirm()跟img.onload()兩處的說明）。 */
function _composedTightBBoxRatio(img){
  var maxDim = 200; // 只是拿來算比例，縮小取樣不影響精確度、換取效能
  var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  var w = Math.max(1, Math.round(img.naturalWidth * scale));
  var h = Math.max(1, Math.round(img.naturalHeight * scale));
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  var cctx = c.getContext('2d');
  cctx.drawImage(img, 0, 0, w, h);
  try {
    var d = cctx.getImageData(0, 0, w, h).data;
    var minX = w, maxX = -1, minY = h, maxY = -1;
    var alphaThresh = 10;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var a = d[(y * w + x) * 4 + 3];
        if (a > alphaThresh) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null; // 理論上不會整張都透明，保底當作偵測失敗
    /* 2026-09新增：centerXRatio/centerYRatio——這張合成圖裡「實際有內容」
       的緊密範圍，其中心點落在整張圖的哪個比例位置(0~1)。
       為什麼需要這個：msbn-logo-module.js畫圖時，是把整張composedDataUrl
       的「圖片幾何中心」對齊格子中心(box center)去縮放/擺放，不是對齊
       「商品實際內容」的中心——這張合成圖固定1200x1200，商品+陰影通常
       偏在中下方一塊、不會剛好在整張圖正中央，兩個中心點對不上。
       只要商品內容中心偏離整張圖幾何中心，「放大/縮小」這個動作本身就
       會讓商品內容跟著偏移(以圖片幾何中心為支點縮放，離支點越遠位移
       越大)——這正是使用者回報「商品變大後往上移」的根本原因，不是
       size算錯，是縮放支點沒對準商品實際內容。呼叫端可以用這兩個比例
       算出內容中心的絕對座標，进而把offX/offY基準點從「圖片幾何中心」
       校正成「商品內容中心」，縮放時就不會再跟著漂移。 */
    return {
      wRatio: (maxX - minX + 1) / w, hRatio: (maxY - minY + 1) / h,
      centerXRatio: ((minX + maxX) / 2) / w, centerYRatio: ((minY + maxY) / 2) / h
    };
  } catch (e) {
    console.warn('[autoComposeMsbnHost] 無法偵測合成圖片的緊密範圍，改用整張畫布尺寸估算', e);
    return null;
  }
}

function _msbnComposeStateKey(instanceId, slotKey){
  return instanceId + '::' + slotKey;
}

/* ══════════════════ MSBN商品區：自動套用陰影(不用手動開合成工具) ══════════════════
   2026-08(KRCB)新增：使用者需求——匯入商品後，後台直接自動跑一次陰影
   合成，使用者只需要事後放大/縮小；只有排版效果不滿意時，才需要手動
   點進去用合成工具調整。
   做法：借用跟手動開合成工具「完全一樣」的底層引擎(ShadowLayoutReceiver/
   ShadowPlugin/renderShadowAndPhotoCanvases)，差別只在於：全部發生在一個
   不會加進畫面(document.body)的隱藏canvas上，使用者不會看到彈窗跳出來、
   也不用按任何按鈕。
   2026-08再修正3件事(使用者實測回饋)：
   ①「商品優先往右倒陰影」——原本完全沒有設定光源角度，跟著
     modules/shadow-plugin.js的預設值(top，直下、不偏移)。改成明確呼叫
     ShadowPlugin.setAngle('right')，跟手動合成工具點「右」按鈕的效果
     一致(ANGLE_PRESETS.right=35度)。
   ②「不需要三角構圖，商品應該並排放」——原本沿用combo'D'既有的預設位置
     (PRODUCT_POS_LEFT/CENTER/RIGHT)，那組是特意設計給「人工在Circle
     工具裡排版」用的高低錯落三角構圖，不是MSBN這種單純並排需求。改成
     另外自己算一組「同一個高度、水平等分」的位置，透過LC_UPSERT_SLOT的
     savedTransform參數直接指定，不吃combo的預設值(這組自訂位置只影響
     這支自動合成函式，不會動到PRODUCT_POS_LEFT/CENTER/RIGHT共用常數，
     手動合成工具的三角構圖預設值完全不受影響)。
   ③「商品放進去太大、超出去」——真正原因：_onMsbnComposeConfirm()/這裡
     原本「保留使用者已經調整過的顯示設定」那段邏輯，直接原封不動沿用
     舊的絕對scale數字。但這個scale是「跟被縮放的那張圖片本身的原始尺寸
     綁在一起」的相對值——舊圖片可能是一般商品照片(例如800x600)，這次
     自動合成出來的圖片固定是1200x1200的陰影合成畫布，兩張圖片原始尺寸
     完全不同，直接沿用同一個scale數字，套用在新的1200x1200圖片上，
     換算出來的實際顯示大小就會跟預期差很多(通常是變得過大、超出格子)。
     改成：不直接沿用舊的絕對scale，而是先算出「舊的scale相對於舊的
     baseScale，使用者到底放大了幾倍」(relativeZoom = 舊scale / 舊
     baseScale)，再把這個「倍率」套用在這次重新計算出來的新baseScale上
     (新scale = 新baseScale * relativeZoom)——這樣不管兩次的圖片原始
     尺寸差多少，使用者「相對於自動貼合大小，放大了多少倍」這個相對感受
     可以正確延續，不會因為圖片尺寸不同就跑版。 */
var MSBN_AUTO_SIDE_BY_SIDE_HPCT = 0.42; // 並排用的商品高度比例(比原本三角構圖的0.5102略小，3品並排橫向空間比較緊)
var MSBN_AUTO_SIDE_BY_SIDE_YPCT = 0.62; // 並排時全部商品統一的底部錨點高度(同一個值，不會有前面三角構圖那種高低錯落)

function autoComposeMsbnHost(instanceId, slotKey, dataUrls, isActive, tabIndex, knownRealLayoutId){
  /* knownRealLayoutId：2026-09新增——呼叫端(js/editor-main.js的
     applyInfoToInstanceId())Excel匯入當下就已經知道這個instanceId真正
     對應哪個layoutId('07_msbn'等)了，直接傳進來當查MSBN_SLOT_BOX_
     FALLBACK備援表的依據，不要只依賴window.LAYOUT_ALIAS_BASE[instanceId]
     ——那個對應關係要等buildCanvasArea()真的渲染過這個實例一次才會
     註冊，Excel剛匯入完、使用者還沒切去看過MSBN分頁時還沒有這筆資料，
     會導致備援表查不到、box整個查不到，掉進「查不到框」的保守小尺寸
     分支——這正是「自動套用比手動點開確認一次還小」的根本原因。選填，
     沒傳就照舊查window.LAYOUT_ALIAS_BASE。 */
  if(!dataUrls.length) return;
  if(typeof ShadowLayoutReceiver === 'undefined' || typeof ShadowPlugin === 'undefined'){
    console.warn('[autoComposeMsbnHost] 陰影合成引擎腳本沒載入，放棄自動合成');
    return;
  }

  var hiddenCanvas = document.createElement('canvas');
  hiddenCanvas.width = 1200; hiddenCanvas.height = 1200;
  // 故意不appendChild進document——完全在記憶體裡運算，使用者看不到這個畫布

  var receiver = ShadowLayoutReceiver.create(hiddenCanvas, { stageId: '_shadow_compose', savedStage: null });
  /* ⚠️2026-08(KRCB)緊急修正「main商品(HBN等)匯入後圖片變成別的商品、
     還變形」——真正原因：ShadowPlugin是整個頁面共用的「單一份」全域
     物件，內部用一個共用的products{}物件註冊每個素材，key就是slotId
     字串('商品1(左)'/'商品2(中)'/'商品3(右)')。這支函式原本直接沿用
     這幾個跟main商品popup(js/shadow-system/shadow-popup.js的
     _shadowReceiver，使用者手動調整HBN等main商品用的那個)完全一樣的
     slotId字串——雖然這裡另外建了一個「隱藏的」receiver實例，但
     ShadowPlugin.registerProduct(slotId,...)寫進去的是同一份共用的
     products{}，同樣的key會直接覆蓋掉main商品popup剛剛才註冊好的圖片！
     main商品popup的「素材清單」(sidebar list)資料是各自receiver自己的
     slots{}(位置/大小)，這部分沒有共用、還是對的，但畫面上實際畫出來
     的圖片是從共用的ShadowPlugin.products{}讀的，被MSBN的自動合成覆蓋
     之後，main商品popup看到的清單雖然正確，畫出來的卻是MSBN的商品圖片
     ——而且main商品原本的框是照「main商品自己的圖片比例」算的，套用
     MSBN不同比例的圖片進去，看起來就會被拉伸變形。
     修法：這支函式改用專屬、不會跟main商品popup撞名的暫時性slotId
     (前面加'_msbnAutoTmp_'前綴+這次呼叫的instanceId/slotKey本身，保證
     獨一無二，不會跟'商品1(左)'這種main商品popup在用的字串重複)，而且
     用完立刻呼叫ShadowPlugin.removeProduct()清掉，不會留著佔用共用
     registry的位置，之後main商品popup要用同樣的'商品1(左)'等字串完全
     不會受任何影響。 */
  var namespacePrefix = '_msbnAutoTmp_' + instanceId + '_' + slotKey + '_';
  var slotIds = MSBN_MULTI_PRODUCT_SLOT_IDS.slice(0, dataUrls.length).map(function(_, i){ return namespacePrefix + i; });
  var n = slotIds.length;

  receiver.handleMessage({ type:'LC_SET_ENABLED', ids: slotIds, combo: 'D' });

  var pending = n;
  function afterAllUpserted(){
    var allStates = receiver.getOrderedStates();
    if(!allStates.length) return; // 理論上不會發生(dataUrls本來就是已經讀取成功的base64字串)，保險而已

    /* 2026-09修正「MSBN自動合成跟main商品popup互相干擾」：ShadowPlugin的
       angle/zone(opts)是整個頁面共用的單一份全域狀態，下面這兩行setAngle/
       configureZone是直接改這份全域狀態，不是只影響這次隱藏canvas的運算。
       如果main商品popup當下也開著（或稍後不重開popup就直接重繪），它的
       drawShadowCanvas()一樣是讀這份全域opts，於是main商品popup畫出來的
       方向會被這裡偷偷改掉(使用者回報：明明main選的是「中」，卻變成跟著
       MSBN跑成「右」)。
       做法：先用snapshotAngleZone()記住「進來之前」全域狀態是什麼，這裡
       算完(renderShadowAndPhotoCanvases執行完、像素都已經算進canvasesOut
       裡)立刻用restoreAngleZone()還原回去——之後不管誰用ShadowPlugin畫圖，
       看到的都是「這次MSBN自動合成從沒發生過」的原始狀態，兩邊真正各自
       獨立、不互相干擾。 */
    var _msbnAutoAngleZoneSnapshot = ShadowPlugin.snapshotAngleZone();
    ShadowPlugin.setAngle('left'); // 修正：使用者實測回饋angle preset='right'畫出來反而是往左斜，跟預期方向相反，改用'left'讓陰影視覺上往右倒
    ShadowPlugin.configureZone(1200*0.1, 1200*0.95);
    var canvasesOut = renderShadowAndPhotoCanvases(allStates);
    ShadowPlugin.restoreAngleZone(_msbnAutoAngleZoneSnapshot);
    var outCv = document.createElement('canvas');
    outCv.width = 1200; outCv.height = 1200;
    var octx = outCv.getContext('2d');
    octx.drawImage(canvasesOut.shadowCv, 0, 0);
    octx.drawImage(canvasesOut.photoCv, 0, 0);
    var composedDataUrl = outCv.toDataURL('image/png');

    /* 合成結果已經燒錄成一張扁平的dataUrl了，共用registry裡這幾筆暫時
       登記的資料完全用不到了——立刻清掉，不要讓它們繼續佔用
       ShadowPlugin.products{}，避免任何殘留影響到main商品popup(或下一次
       別的MSBN格子自動合成)。 */
    slotIds.forEach(function(id){ ShadowPlugin.removeProduct(id); });

    var key = _msbnComposeStateKey(instanceId, slotKey);
    /* ⚠️一定要在覆蓋S.msbnShadowSlots[key]「之前」先記住它原本存不存在——
       下面img.onload()裡要用「這一格之前有沒有自動合成過」來決定要不要
       延續使用者的縮放倍率，如果在這裡就先把新資料寫進去，之後onload裡
       再檢查一定會看到「有」(因為就是這裡剛寫的)，判斷會整個失效。 */
    var hadPriorAutoCompose = !!(isActive ? (S.msbnShadowSlots && S.msbnShadowSlots[key]) : (TABS[tabIndex].data.msbnShadowSlots && TABS[tabIndex].data.msbnShadowSlots[key]));

    var shadowSlotsSnapshot = {};
    MSBN_MULTI_PRODUCT_SLOT_IDS.slice(0, n).forEach(function(displayId, i){
      shadowSlotsSnapshot[displayId] = { dataUrl: dataUrls[i], type: 'product', ratio: undefined, transform: undefined };
    });
    var stateToSave = {
      shadowCombo: 'D',
      shadowSlots: shadowSlotsSnapshot,
      shadowPolaroid: {}, shadowSlotOriginal: {}, shadowOrder: null,
      stageTransform: null, stageEnabled: true, kvElementEnabled: false
    };
    if(isActive){
      S.msbnShadowSlots = S.msbnShadowSlots || {};
      S.msbnShadowSlots[key] = stateToSave;
    } else {
      var td = TABS[tabIndex].data;
      td.msbnShadowSlots = td.msbnShadowSlots || {};
      td.msbnShadowSlots[key] = stateToSave;
    }

    var img = new Image();
    img.onload = function(){
      var slotBox = (typeof getMsbnSlotBox === 'function') ? getMsbnSlotBox(instanceId, slotKey) : null;
      var fallbackBox = (!slotBox && typeof getMsbnSlotBoxFallback === 'function')
        ? getMsbnSlotBoxFallback(knownRealLayoutId || (window.LAYOUT_ALIAS_BASE && window.LAYOUT_ALIAS_BASE[instanceId]) || instanceId, slotKey)
        : null;
      var box = (slotBox && slotBox.logoBox) || fallbackBox;
      /* 2026-09再修正「商品還是嚴重超出範圍」：真正抓到的原因——上一版
         box查不到(slotBox跟fallbackBox都是null，例如Excel剛匯入完、
         使用者根本還沒切去看過MSBN分頁，window.bundles裡還沒有這個實例
         的positions資料，getMsbnSlotBoxFallback()的靜態表這個instanceId/
         slotKey組合又剛好沒對到)時，原本會退回box={w:img.naturalWidth,
         h:img.naturalHeight}——也就是拿「合成圖整張1200x1200的尺寸」
         當作格子大小去算containScale。這個退路本身邏輯就是錯的：整張
         1200x1200畫布幾乎一定比真正的MSBN格子(通常就一兩百到幾百px)
         大上好幾倍，用它當「格子」去反推「商品要放多大才會貼齊格子」，
         算出來的containScale/baseScale會遠大於1——套進tight bbox縮放
         公式後，商品被放大到單一個字母/標籤的特寫都塞不進格子，也就是
         使用者看到的「嚴重超出、只看到商品標籤局部特寫」。
         真正修法：box找不到的時候，根本不知道格子實際多大，不能假裝
         「1200x1200」就是格子——改成直接跳過這次的contain-fit運算，
         印出明確警告方便之後排查(哪個instanceId/slotKey查不到框)，
         用一個保守的預設倍率(0.3，比大多數格子安全)頂著，不會出現
         誇張的超出，最多只是這一格看起來偏小，使用者事後在畫布上滾輪
         放大即可，不會像現在這樣完全無法辨識商品。 */
      var containScale, baseScale;
      if(box){
        /* 2026-09修正「商品自動套入陰影後大小會超出格子範圍」：真正原因是
           下面baseScale原本直接拿img.naturalWidth/naturalHeight(固定1200x
           1200，整張合成畫布的原始尺寸)去跟格子比對，但商品+陰影通常只佔
           中下方一小塊、四周一大圈是透明留白，等於把留白也當「商品大小」
           一起換算，比例不準。改成先用_composedTightBBoxRatio()量出這張
           合成圖裡「實際有內容(非透明)」的緊密範圍(tightW/tightH)，才是
           商品視覺上真正的大小，拿這個去跟格子(box)比對，算出來的containScale
           才是「剛好貼齊格子邊界、不會超出」的真正上限。 */
        var _tightRatio = _composedTightBBoxRatio(img);
        var tightW = _tightRatio ? img.naturalWidth * _tightRatio.wRatio : img.naturalWidth;
        var tightH = _tightRatio ? img.naturalHeight * _tightRatio.hRatio : img.naturalHeight;
        containScale = Math.min(box.w/tightW, box.h/tightH); // 絕對上限：超過這個倍率商品視覺上一定會超出格子
        /* 2026-09調整：使用者反映「格子有正確抓到，但整體偏小」——這裡
           乘的係數就是「跟containScale(貼齊邊界的100%)相比，故意留多少
           安全邊界」，原本0.8等於故意空20%留白。既然containScale本身就是
           數學上「剛好不超出」的真正上限，把係數提高到0.92(留8%留白)
           還是保證不會超出，只是留白變少、商品視覺上更接近填滿格子。 */
        baseScale = containScale * 0.92;
      } else {
        console.warn('[autoComposeMsbnHost] 查不到格子(logoBox)大小，無法計算正確縮放比例，改用保守預設值——instanceId=', instanceId, 'slotKey=', slotKey);
        containScale = 0.3; baseScale = 0.3;
      }
      /* 修正「預設商品大小還是會超出範圍」：找到原因了——上一版不管

         S.msbnLogos[instanceId][slotKey]裡放的是什麼來源的資料都直接拿
         來算relativeZoom，但那個欄位可能殘留著「這次自動合成功能出現
         之前」的舊資料(例如很早期單張商品直接上傳、或先前測試版本留下的
         資料)，那組scale/baseScale數字是針對完全不同性質的圖片算出來的，
         套在這次全新的自動合成結果上，relativeZoom可能是任何離譜的值，
         導致明明是「第一次」自動合成，商品卻不正常放大。
         改成：只有這一格「已經有」自己的自動合成持久化紀錄
         (S.msbnShadowSlots[key]存在，代表這真的是「重新合成同一格」而
         不是頭一次)，才去算relativeZoom延續使用者的縮放感受；真正頭一次
         合成，一律用baseScale(乘0.8的預設值)，不去看S.msbnLogos裡任何
         舊資料。另外加一個保險：不管怎麼算出來的relativeZoom，都夾在
         0.3~3倍之間，避免任何未預期情況下數值失控。 */
      var existingEntry = (isActive && hadPriorAutoCompose)
        ? (S.msbnLogos && S.msbnLogos[instanceId] && S.msbnLogos[instanceId][slotKey])
        : null;
      var relativeZoom = (existingEntry && existingEntry.baseScale) ? (existingEntry.scale / existingEntry.baseScale) : 1;
      relativeZoom = Math.max(0.3, Math.min(3, relativeZoom)); // 保險夾住，避免異常數值
      /* 2026-09新增：不管relativeZoom延續下來的倍率是多少，最終scale一律
         不能超過containScale——這是這次修正的關鍵：確保「商品自動套入
         陰影後大小絕對不會超出格子範圍」，同時因為baseScale本身已經很
         接近containScale(只差0.8這個安全邊界)，一般情況下商品會盡量放大
         貼近格子邊界，滿足「放大到不超出」的需求，只有在relativeZoom
         想推得更大時才會被這裡攔下來。 */
      var scale = Math.min(baseScale * relativeZoom, containScale);
      /* 2026-09重大修正「商品變大後往上移」：真正原因抓到了——跟scale
         算錯無關，是「縮放支點」沒對準商品實際內容。msbn-logo-module.js
         畫圖時，是把整張composedDataUrl(固定1200x1200)的「圖片幾何中心」
         (local座標600,600)對齊格子中心(box center+offX/offY)去縮放。但
         商品+陰影通常偏在1200x1200畫布的中下方一塊，內容自己的中心點
         根本不在(600,600)——只要這兩個中心點對不上，「放大」這個動作
         本身就會用圖片幾何中心當支點，把離支點有落差的商品內容一起往外
         甩，倍率越大甩得越開，這正是「商品變大、卻往上移」的成因(不是
         這次商品往上偏，是這個系統性的問題)。
         修法：用_composedTightBBoxRatio()量出的centerXRatio/centerYRatio
         算出商品內容中心在1200本地座標系的位置，反推「要讓內容中心剛好
         落在格子正中央」所需要的offX/offY基準值——offX/offY的定義維持
         不變(0代表置中)，只是「置中」的基準從「整張圖幾何中心」校正成
         「商品內容中心」。這樣不管scale算出來是多少，商品內容都會穩穩
         置中在格子裡，不會再因為放大/縮小而跟著漂移。
         這裡刻意每次都重新算基準值、不延續existingEntry.offX/offY——
         這一格的商品/陰影排版本來就是這次全新合成出來的內容，用舊排版
         算出來的手動位移套在新內容上沒有意義；使用者之後還是可以直接在
         畫布上拖曳這個LOGO微調位置(見js/msbn-logo-interaction.js)，那個
         調整不受這裡影響。 */
      var offX = 0, offY = 0;
      if(box && _tightRatio){
        var contentCenterLocalX = img.naturalWidth * _tightRatio.centerXRatio;
        var contentCenterLocalY = img.naturalHeight * _tightRatio.centerYRatio;
        offX = (img.naturalWidth/2 - contentCenterLocalX) * scale;
        offY = (img.naturalHeight/2 - contentCenterLocalY) * scale;
      }
      if(isActive){
        S.msbnLogos = S.msbnLogos || {};
        S.msbnLogos[instanceId] = S.msbnLogos[instanceId] || {};
        S.msbnLogos[instanceId][slotKey] = { img: img, scale: scale, offX: offX, offY: offY, baseScale: baseScale, bgColor: null };
        if(typeof renderAll === 'function') renderAll();
      } else {
        var td2 = TABS[tabIndex].data;
        td2.msbnLogos = td2.msbnLogos || {};
        td2.msbnLogos[instanceId] = td2.msbnLogos[instanceId] || {};
        td2.msbnLogos[instanceId][slotKey] = { src: img.src, scale: scale, offX: offX, offY: offY, baseScale: baseScale, bgColor: null };
      }
    };
    img.src = composedDataUrl;
  }

  /* 修正②：自己算「同一個高度、水平等分」的位置，不吃combo'D'既有的
     三角構圖預設值——用savedTransform直接指定x/y/w0/h0，upsertSlot()
     看到savedTransform存在就會直接套用，不會另外查ShadowLayoutDefaults。
     x/y/w0/h0都是1200x1200畫布下的像素座標，跟其他地方(PRODUCT_POS_*)
     算法一致：h0=canvas.height*hPct，w0=依圖片原始寬高比從h0換算，
     y=底部錨點座標，x=水平中心座標。 */
  var MSBN_AUTO_SIDE_BY_SIDE_GAP_PX = 5; // 使用者要求：並排商品彼此只留5px間距，不要用「畫布等分」硬把商品推得很開
  var MSBN_AUTO_SIDE_BY_SIDE_SAFE_MARGIN_PCT = 0.04; // 整組左右各保留4%畫布寬度當邊界，給陰影斜切/擴散留一點緩衝，避免貼齊到畫布邊緣被裁到

  /* 2026-09修正「多品並排：彼此分太開、商品嚴重超出範圍」：
     舊寫法xPct=(i+0.5)/n，把畫布寬度硬性等分成n份，每個商品的x中心點卡在
     自己那一份的正中間——這個位置完全不看商品「實際算出來的寬度w0」，
     w0窄的商品(常見的直立長條狀商品照)兩兩之間會空出一大段(使用者反映
     「分太開」)；w0寬的商品(橫式商品照)則可能寬到超過自己那一份的範圍，
     整個往左右兩邊的商品重疊過去、甚至超出畫布邊緣(使用者反映「嚴重
     超出範圍」)——兩個問題根源是同一個：位置從頭到尾沒有真的根據商品
     實際尺寸去排版。
     改法：兩階段處理——
     ①先把全部n張圖都讀出「原始寬高比」(這裡跟原本一樣固定h0=42%畫布
       高度，用寬高比換算出每張商品實際的w0)。
     ②每個商品之間只留5px間距，整組水平置中排版；如果整組排起來的總寬度
       (Σw0 + 5px*(n-1))超過畫布可用寬度(扣掉左右安全邊界)，才把整組
       (所有商品的w0連同h0)等比例縮小到剛好塞得進去——縮小時每個商品
       彼此的長寬比、跟彼此的相對大小關係完全不變，只是整組一起變小，
       保證絕對不會超出畫布，同時已經很窄的組合(縮小倍率=1，不用縮)則
       完全維持原本「留5px」的緊湊排法，不會被拉開。 */
  var msbnAutoLoadedImgs = new Array(n);
  var msbnAutoLoadPending = n;
  function afterAllImagesLoaded(){
    var h0 = 1200 * MSBN_AUTO_SIDE_BY_SIDE_HPCT;
    var widths = msbnAutoLoadedImgs.map(function(im){ return im.naturalWidth * (h0 / im.naturalHeight); });
    var totalGap = MSBN_AUTO_SIDE_BY_SIDE_GAP_PX * (n - 1);
    var totalW = widths.reduce(function(a, b){ return a + b; }, 0) + totalGap;
    var maxAllowedW = 1200 * (1 - MSBN_AUTO_SIDE_BY_SIDE_SAFE_MARGIN_PCT * 2);
    var shrink = (totalW > maxAllowedW) ? (maxAllowedW / totalW) : 1;

    var scaledH0 = h0 * shrink;
    var scaledWidths = widths.map(function(w){ return w * shrink; });
    var scaledGap = MSBN_AUTO_SIDE_BY_SIDE_GAP_PX * shrink;
    var scaledTotalW = scaledWidths.reduce(function(a, b){ return a + b; }, 0) + scaledGap * (n - 1);
    var cursorX = (1200 - scaledTotalW) / 2; // 整組水平置中

    slotIds.forEach(function(id, i){
      var w0 = scaledWidths[i];
      var x = cursorX + w0 / 2; // transform.x是商品的水平中心點，跟原本欄位定義一致
      cursorX += w0 + scaledGap;
      var transform = { x: x, y: 1200*MSBN_AUTO_SIDE_BY_SIDE_YPCT, w0: w0, h0: scaledH0, scaleMul: 1, rot: 0 };
      receiver.handleMessage({ type:'LC_UPSERT_SLOT', slotId:id, slotType:'product', dataUrl:dataUrls[i], ratio:undefined, transform:transform }, function(){
        pending--;
        if(pending <= 0) afterAllUpserted();
      });
    });
  }

  slotIds.forEach(function(id, i){
    var img = new Image();
    img.onload = function(){
      msbnAutoLoadedImgs[i] = img;
      msbnAutoLoadPending--;
      if(msbnAutoLoadPending <= 0) afterAllImagesLoaded();
    };
    img.onerror = function(){
      /* 保底：讀取失敗的圖給一個1:1的假尺寸，不讓整組排版卡住——這張圖
         本來後面LC_UPSERT_SLOT/afterAllUpserted那邊也會因為圖片壞掉而
         略過，這裡只是不要因為一張壞圖讓其他n-1張正常的商品也排不出來。 */
      msbnAutoLoadedImgs[i] = { naturalWidth: 1, naturalHeight: 1 };
      msbnAutoLoadPending--;
      if(msbnAutoLoadPending <= 0) afterAllImagesLoaded();
    };
    img.src = dataUrls[i];
  });
}

function openMsbnHostComposePopup(instanceId, slotKey){
  _msbnComposeSavedState = {
    shadowCombo: S.shadowCombo,
    shadowSlots: JSON.parse(JSON.stringify(S.shadowSlots || {})),
    shadowPolaroid: JSON.parse(JSON.stringify(S.shadowPolaroid || {})),
    shadowSlotOriginal: JSON.parse(JSON.stringify(S.shadowSlotOriginal || {})),
    shadowOrder: S.shadowOrder ? S.shadowOrder.slice() : null,
    stageTransform: S.stageTransform ? JSON.parse(JSON.stringify(S.stageTransform)) : null,
    stageEnabled: S.stageEnabled,
    kvElementEnabled: S.kvElementEnabled,
    /* 2026-09新增：把main商品目前的光源角度(S.shadowAngle)也一併存起來、
       開MSBN合成popup時換成MSBN這一格自己的角度——S.shadowAngle是整個
       頁面共用的單一份全域值，main商品popup跟這個MSBN合成popup用的是
       同一份UI初始化程式碼(js/shadow-system/shadow-popup.js「光源角度」
       按鈕那段，見savedAngle讀取S.shadowAngle處)，原本完全沒有隔離：
       開MSBN合成popup時，角度按鈕直接讀到main商品剛剛選的角度，跟
       MSBN自己(autoComposeMsbnHost()設定的'left'/視覺往右倒)完全對不上，
       使用者反映「main選中間，點進MSBN商品編輯卻也變成中間」就是這個
       原因；反過來，如果在MSBN popup裡按了角度按鈕，也會直接覆蓋掉
       main商品的S.shadowAngle，下次開main商品popup會被MSBN的選擇帶偏，
       這正是問題1(MSBN跟main商品互相干擾)在「手動合成popup」這條路徑上
       的翻版，跟shadow-plugin.js的angle/zone問題是同一類bug、但發生在
       不同的程式碼路徑，之前那次修的snapshotAngleZone()沒有涵蓋到這裡。 */
    shadowAngle: S.shadowAngle
  };
  _msbnComposeTarget = { instanceId: instanceId, slotKey: slotKey };

  var key = _msbnComposeStateKey(instanceId, slotKey);
  var existing = S.msbnShadowSlots && S.msbnShadowSlots[key];
  if(existing){
    S.shadowCombo = existing.shadowCombo || 'A';
    S.shadowSlots = JSON.parse(JSON.stringify(existing.shadowSlots || {}));
    S.shadowPolaroid = JSON.parse(JSON.stringify(existing.shadowPolaroid || {}));
    S.shadowSlotOriginal = JSON.parse(JSON.stringify(existing.shadowSlotOriginal || {}));
    S.shadowOrder = existing.shadowOrder ? existing.shadowOrder.slice() : null;
    S.stageTransform = existing.stageTransform ? JSON.parse(JSON.stringify(existing.stageTransform)) : null;
    S.stageEnabled = (typeof existing.stageEnabled === 'boolean') ? existing.stageEnabled : true;
    S.kvElementEnabled = !!existing.kvElementEnabled;
    /* 這一格之前編輯過、有記住自己選的角度就用它；沒記過(舊資料，這次
       修正之前存的)才退回MSBN的預設'right'，不要沿用main商品當下的值。 */
    S.shadowAngle = existing.shadowAngle || 'left';
  } else {
    S.shadowCombo = 'D';
    S.shadowSlots = {};
    S.shadowPolaroid = {};
    S.shadowSlotOriginal = {};
    S.shadowOrder = null;
    S.stageTransform = null;
    S.stageEnabled = true;
    S.kvElementEnabled = false;
    /* 全新的一格，跟main商品的角度無關——給MSBN自己合理的預設值。
       2026-09修正：這裡原本寫'right'，判斷邏輯搞反了——這個系統的角度
       preset名稱是「反過來」的(見autoComposeMsbnHost()裡的註解：
       ShadowPlugin.setAngle('left')才是視覺上「往右倒」的效果，preset
       名稱'right'畫出來反而是視覺上往左倒，跟直覺相反，是先前使用者
       實測回饋確認過的既有行為)。autoComposeMsbnHost()用的是'left'這個
       preset(視覺往右倒)，這裡要跟它保持一致，才不會出現「自動套用是
       往右倒，點進手動編輯卻變成往左倒」的方向不一致，改成'left'。
       使用者之後還是可以自己在popup裡點別的角度按鈕改掉。 */
    S.shadowAngle = 'left';
    /* 2026-08(KRCB)新增：使用者反映「外面已經放大過的商品，點進去編輯
       卻是空的，等於要重新上傳一次」——這一格如果還沒有自己的合成狀態
       (第一次點開)，但S.msbnLogos裡已經有一張圖(不管是匯入自動帶入、
       還是使用者自己手動上傳過)，先把那張圖的原始圖檔(dataURL)帶進來，
       至少不用重新上傳一次。
       ⚠️沒辦法帶進去的是「精確的縮放/位置」——這裡的1200畫布合成工具
       跟外面MSBN格子是兩個完全不同的座標系統(格子是每個版位自己的畫布
       尺寸，合成工具固定是1200x1200的區域+光源角度換算)，沒有簡單的
       換算公式可以把「外面調的縮放/左右位置」精準對應成「合成工具裡的
       縮放/位置」，這裡選擇讓合成工具用它自己預設的置中貼合效果，不是
       完全對應外面看到的框位——但至少不用重新上傳照片本身了。 */
    var existingLogo = S.msbnLogos && S.msbnLogos[instanceId] && S.msbnLogos[instanceId][slotKey];
    if(existingLogo && existingLogo.img && existingLogo.img.src){
      S.shadowSlots['商品2(中)'] = { dataUrl: existingLogo.img.src, type: 'product', ratio: undefined, transform: undefined };
    }
  }

  openShadowPopup(_onMsbnComposeConfirm, MSBN_COMPOSE_SCRATCH_KEY, true);

  /* popup右上角的×原本只是單純closePopup()，沒有機會執行「把main商品
     狀態還原」——改綁成先執行取消專用的還原邏輯、再真的關閉popup。 */
  var popupXBtn = document.querySelector('#popup-overlay .popup-x');
  if(popupXBtn) popupXBtn.onclick = function(){ _onMsbnComposeCancel(); closePopup(); };
}

/* 儲存/還原main狀態共用的小工具，Confirm跟Cancel都要用到，避免兩邊各寫
   一份容易漏改。 */
function _msbnComposeRestoreMainState(){
  var saved = _msbnComposeSavedState;
  _msbnComposeSavedState = null;
  if(!saved) return;
  S.shadowCombo = saved.shadowCombo;
  S.shadowSlots = saved.shadowSlots;
  S.shadowPolaroid = saved.shadowPolaroid;
  S.shadowSlotOriginal = saved.shadowSlotOriginal;
  S.shadowOrder = saved.shadowOrder;
  S.stageTransform = saved.stageTransform;
  S.stageEnabled = saved.stageEnabled;
  S.kvElementEnabled = saved.kvElementEnabled;
  S.shadowAngle = saved.shadowAngle; // 2026-09新增：把main商品的角度還原回去，不被MSBN popup裡選的角度覆蓋
}

function _onMsbnComposeCancel(){
  _msbnComposeTarget = null;
  if(S.assets) delete S.assets[MSBN_COMPOSE_SCRATCH_KEY];
  _msbnComposeRestoreMainState();
  renderAll();
}

function _onMsbnComposeConfirm(){
  var target = _msbnComposeTarget;
  _msbnComposeTarget = null;
  var scratchImg = S.assets && S.assets[MSBN_COMPOSE_SCRATCH_KEY];
  if(S.assets) delete S.assets[MSBN_COMPOSE_SCRATCH_KEY]; // 暫存key用完就清掉，不要留著跟真正的host搞混

  /* 先把「這一格」剛剛編輯完的合成狀態存起來，下次點開同一格才有得載入
     繼續調——一定要在_msbnComposeRestoreMainState()「把main狀態寫回
     S.shadowSlots等」之前存，不然存進去的會是main的資料，不是這一格的。 */
  if(target){
    S.msbnShadowSlots = S.msbnShadowSlots || {};
    S.msbnShadowSlots[_msbnComposeStateKey(target.instanceId, target.slotKey)] = {
      shadowCombo: S.shadowCombo,
      shadowSlots: JSON.parse(JSON.stringify(S.shadowSlots || {})),
      shadowPolaroid: JSON.parse(JSON.stringify(S.shadowPolaroid || {})),
      shadowSlotOriginal: JSON.parse(JSON.stringify(S.shadowSlotOriginal || {})),
      shadowOrder: S.shadowOrder ? S.shadowOrder.slice() : null,
      stageTransform: S.stageTransform ? JSON.parse(JSON.stringify(S.stageTransform)) : null,
      stageEnabled: S.stageEnabled,
      kvElementEnabled: S.kvElementEnabled,
      shadowAngle: S.shadowAngle // 2026-09新增：把使用者在這個popup裡選的角度存進這一格自己的紀錄，下次點開同一格才會照這個角度還原，不是main商品的角度
    };
  }

  /* 不管這次合成有沒有成功套用，main商品的狀態都要還原，不然使用者原本
     main商品(HBN等)已經編輯好的內容會憑空消失。 */
  _msbnComposeRestoreMainState();

  if(!target || !scratchImg){ renderAll(); return; }

  var img = new Image();
  img.onload = function(){
    var slotBox = (typeof getMsbnSlotBox === 'function') ? getMsbnSlotBox(target.instanceId, target.slotKey) : null;
    var fallbackBox = (!slotBox && typeof getMsbnSlotBoxFallback === 'function')
      ? getMsbnSlotBoxFallback((window.LAYOUT_ALIAS_BASE && window.LAYOUT_ALIAS_BASE[target.instanceId]) || target.instanceId, target.slotKey)
      : null;
    var box = (slotBox && slotBox.logoBox) || fallbackBox;
    /* 2026-08(KRCB)新增：使用者要求「加陰影匯出後，自動放大到商品範圍
       大概80%的大小」——原本是精準contain-fit(剛好貼齊框的長或寬其中一邊，
       等於100%)，現在故意再乘0.8，讓合成完的商品比框小一點，四周留白，
       不會整個頂到框邊。
       2026-09修正：跟autoComposeMsbnHost()同一個問題——這裡的
       img.naturalWidth/naturalHeight是整張1200x1200合成畫布的原始尺寸，
       商品+陰影通常只佔中下方一小塊，四周一大圈透明留白，直接拿整張
       尺寸去跟格子比對，contain-fit的比例會不準(通常換算出來過小，但
       如果後面接著用relativeZoom等邏輯放大，反而可能因為基準不準而超出)。
       改用_composedTightBBoxRatio()量出「實際有內容(非透明)」的緊密範圍
       再換算，才是商品視覺上真正的大小 vs 格子大小。
       2026-09再修正：box如果連fallback都查不到(null)，絕對不能像原本
       那樣退回用img.naturalWidth/naturalHeight(合成畫布整張1200x1200的
       尺寸)當作格子大小——那等於拿畫布尺寸冒充格子尺寸，算出來的
       baseScale會遠大於1，商品會被放大到只剩局部特寫塞進格子，畫面上
       完全看不出是同一個商品(這正是「商品嚴重超出範圍」的真正成因)。
       box真的查不到時，改用保守預設值(0.3)頂著，最多只是這一格偏小，
       不會出現誇張到無法辨識的超大特寫。 */
    var containScale, baseScale;
    if(box){
      var _tightRatioManual = _composedTightBBoxRatio(img);
      var tightWManual = _tightRatioManual ? img.naturalWidth * _tightRatioManual.wRatio : img.naturalWidth;
      var tightHManual = _tightRatioManual ? img.naturalHeight * _tightRatioManual.hRatio : img.naturalHeight;
      containScale = Math.min(box.w/tightWManual, box.h/tightHManual);
      baseScale = containScale * 0.92; // 2026-09調整：跟autoComposeMsbnHost()同步，留白從20%降到8%，商品看起來更接近填滿格子
    } else {
      console.warn('[_onMsbnComposeConfirm] 查不到格子(logoBox)大小，無法計算正確縮放比例，改用保守預設值——instanceId=', target.instanceId, 'slotKey=', target.slotKey);
      containScale = 0.3; baseScale = 0.3;
    }
    S.msbnLogos = S.msbnLogos || {};
    S.msbnLogos[target.instanceId] = S.msbnLogos[target.instanceId] || {};
    /* 2026-08(KRCB)修正「放大後再點進去編輯，確認完又變回原本很小的樣子」
       ——原本這裡每次確認都無條件把scale/offX/offY重設成baseScale/0/0，
       等於使用者直接在畫布上手動放大/移動過的結果，只要重新點開合成
       工具再確認一次(哪怕合成工具裡什麼都沒調整)，就會被這裡蓋回去、
       打回原形。這兩件事其實可以分開處理：「合成出來的圖片內容」(這次
       confirm真正改變的東西)跟「這張圖在格子裡顯示多大/擺在哪」(使用者
       在外面畫布上自己拖曳/縮放調整的結果，存在同一個scale/offX/offY
       欄位裡)——後者是使用者自己的顯示偏好，不應該被「重新合成一次」
       這個動作影響到。改成：如果這一格已經有既有的顯示設定(先前上傳/
       合成過、使用者可能已經手動調過)，就沿用它的scale/offX/offY，只
       換掉img(新合成出來的圖片內容)；只有「這一格真的是第一次套用」
       (完全沒有既有紀錄)，才用baseScale/0/0這組預設值。
       2026-09重大修正「不管改幾次公式，商品還是很小」：真正找到的原因——
       上面這段"沿用既有scale"的邏輯，原本是直接寫死
       `var scale = existingEntry ? existingEntry.scale : baseScale;`
       ——只要這一格「以前有過任何資料」(不管是很早期、還沒套用今天這幾次
       修正之前留下的舊scale)，就完全忽略這次重新算出來的baseScale，
       原封不動沿用舊的絕對數字。這代表：只要這一格不是「完全從零開始的
       全新格子」，不管我把baseScale的公式改對幾次、把0.8調到0.92幾次，
       畫面上永遠都是「很久以前那一次」算出來的舊scale，跟這次改進完全
       無關——這正是使用者回報「已經清空重新上傳、還是一樣小」的根本
       原因(只要S.msbnLogos裡還留著這一格的紀錄，"清空重新上傳"這個動作
       本身並不會清掉這筆紀錄，馬上又被這裡的existingEntry.scale蓋回去)。
       改成跟autoComposeMsbnHost()同一套relativeZoom邏輯：不是「有沒有
       舊資料」二選一，而是延續「使用者相對於當時baseScale，自己額外
       放大了幾倍」這個相對倍率，套用在這次全新算出來的baseScale上——
       使用者真的手動再調整過的部分還是會被保留，但每次公式改進後的
       效果都能正確反映出來，不會被舊的絕對數字卡住。 */
    var existingEntry = S.msbnLogos[target.instanceId][target.slotKey];
    var relativeZoom = (existingEntry && existingEntry.baseScale) ? (existingEntry.scale / existingEntry.baseScale) : 1;
    relativeZoom = Math.max(0.3, Math.min(3, relativeZoom));
    var scale = Math.min(baseScale * relativeZoom, containScale);
    /* 2026-09重大修正「商品變大後往上移」：跟autoComposeMsbnHost()同一個
       根本原因——縮放支點是「整張1200x1200合成圖的幾何中心」，不是「商品
       實際內容的中心」，兩者對不上，放大就會讓內容跟著往支點的反方向漂移。
       改成用_composedTightBBoxRatio()量到的內容中心，反推讓內容置中在
       格子裡所需要的offX/offY，不再沿用existingEntry的舊offX/offY(那是
       針對「舊排版/舊scale」校正過的值，套在這次全新合成的內容上沒有
       意義，也是使用者拖曳/縮放前商品一直不在預期位置的原因)。 */
    var offX = 0, offY = 0;
    if(box && _tightRatioManual){
      var contentCenterLocalXManual = img.naturalWidth * _tightRatioManual.centerXRatio;
      var contentCenterLocalYManual = img.naturalHeight * _tightRatioManual.centerYRatio;
      offX = (img.naturalWidth/2 - contentCenterLocalXManual) * scale;
      offY = (img.naturalHeight/2 - contentCenterLocalYManual) * scale;
    }
    if(typeof _msbnPushUndo === 'function') _msbnPushUndo();
    S.msbnLogos[target.instanceId][target.slotKey] = { img: img, scale: scale, offX: offX, offY: offY, baseScale: baseScale, bgColor: null };
    if(typeof _msbnSetSelected === 'function') _msbnSetSelected(target.instanceId, [target.slotKey]);
    renderAll();
  };
  img.src = scratchImg.src;
}

function openShadowPopup(onConfirm, targetAssetKey, alreadySwapped){
  _shadowPopupOnConfirm = (typeof onConfirm === 'function') ? onConfirm : null;
  _shadowPopupTargetAssetKey = targetAssetKey || 'host';
  /* 2026-08修正「編輯Popup商品都看到main商品」：原本的假設「使用者手動點
     按鈕不會傳'popupHost'」是錯的——右側「編輯Popup商品」按鈕跟文案2分頁
     的「編輯商品（Popup）」按鈕，都是手動點擊、直接呼叫
     openShadowPopup(null,'popupHost')，並沒有先換狀態，導致popup彈窗
     顯示的其實是main當下的S.shadowSlots，不是popup自己的那份。
     改成這支函式自己負責換狀態：只要targetAssetKey不是'host'、而且呼叫端
     還沒先換過(alreadySwapped不是true)，就在這裡換。
     proceedToShadowFromImport()那邊因為要先換好底才能把新比對到的檔案塞
     進正確的欄位，所以還是維持自己先換、再傳alreadySwapped=true進來，
     這裡就不會重複換一次、蓋掉剛設定好的內容。 */
  if(!alreadySwapped && _shadowPopupTargetAssetKey !== 'host'){
    _swapInPopupShadowState();
  }
  var overlay = createOverlay(
    '<div class="popup-panel" style="width:'+(SHADOW_DISPLAY+420)+'px;">'+
      '<div class="popup-head"><span>調整商品／主持人</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body" style="display:flex;gap:16px;">'+
        '<div style="width:360px;flex:none;">'+
          '<div class="field"><label>組合</label><select id="shadow-combo-sel"></select></div>'+
          '<div class="field"><label>光源角度</label>'+
            '<div style="display:flex;gap:6px;">'+
              '<button class="tbtn angle-btn" data-angle="left">左</button>'+
              '<button class="tbtn angle-btn" data-angle="top">中</button>'+
              '<button class="tbtn angle-btn" data-angle="right">右</button>'+
            '</div>'+
          '</div>'+
          '<div class="field" style="margin-top:10px;"><label><input type="checkbox" id="shadow-stage-toggle"> 顯示舞台</label></div>'+
          '<div class="field" style="margin-top:6px;"><label><input type="checkbox" id="shadow-kv-element-toggle"> 加入KV小元素</label></div>'+
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

  /* 舞台開關：預設開(S.stageEnabled undefined視為true)，關掉的話drawShadowCanvas()
     跟exportShadowComposite()都會跳過畫舞台，商品彼此之間的疊放順序不受影響。 */
  var stageToggle = overlay.querySelector('#shadow-stage-toggle');
  stageToggle.checked = S.stageEnabled !== false;
  stageToggle.onchange = function(){
    S.stageEnabled = stageToggle.checked;
    drawShadowCanvas();
  };

  /* KV小元素開關：checked狀態直接讀S.kvElementEnabled（預設false，跟舞台
     預設開相反——這個元素是額外加的，不是每次都需要）。 */
  var kvToggle = overlay.querySelector('#shadow-kv-element-toggle');
  kvToggle.checked = !!S.kvElementEnabled;
  kvToggle.onchange = function(){ toggleKvElement(kvToggle.checked); };
  /* 使用者要求KV小元素預設開啟——但「開啟」只是S.kvElementEnabled這個
     布林值，真正載入圖片/建立slot要靠toggleKvElement()執行。checkbox.checked
     用程式直接設定不會觸發onchange事件，所以如果一開始就是開的狀態、又
     還沒有實際載入過(S.shadowSlots裡沒有這筆記錄)，這裡要手動補呼叫一次
     toggleKvElement(true)，不然勾勾雖然是打勾的，畫布上卻什麼都沒有。
     已經有記錄的話（使用者之前手動調整過位置/大小/角度）不用再呼叫，
     下面的setShadowCombo()→getShadowOrder()自然會把它讀回來，重複呼叫
     沒有副作用但沒必要。 */
  if(S.kvElementEnabled && !(S.shadowSlots && S.shadowSlots[KV_ELEMENT_SLOT_ID])){
    toggleKvElement(true);
  }

  /* 光源角度：2026-08修正——原本無條件把'top'標成active、也沒有把ShadowPlugin
     內部角度狀態同步回S.shadowAngle，重開popup畫面看起來永遠是預設角度。
     現在改成用S.shadowAngle(有存檔還原)決定哪個按鈕active，並且明確呼叫
     setShadowAngle()把ShadowPlugin內部狀態同步成這個值，畫面(drawShadowCanvas)
     才會照實際上次選的角度畫，不會跟按鈕UI對不起來。 */
  var savedAngle = S.shadowAngle || 'top';
  overlay.querySelectorAll('[data-angle]').forEach(function(btn){
    if(btn.dataset.angle === savedAngle) btn.classList.add('active');
    btn.onclick = function(){
      setShadowAngle(btn.dataset.angle);
      overlay.querySelectorAll('[data-angle]').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
    };
  });
  _shadowReceiver.handleMessage({ type:'LC_SET_ANGLE', preset:savedAngle }); // 只同步ShadowPlugin狀態，不在這裡redraw，setShadowCombo(...)+drawShadowCanvas()等一下就會畫了

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
   （原理跟pet-frenzy的editor-shadow-canvas.js完全一樣，直接照搬這段運算）。
   2026-08新增「舞台前/後」分組：跟drawShadowCanvas()同一套邏輯，沒勾選
   「放在舞台上」的素材維持在舞台後面(被擋住)，勾選的疊在舞台前面。因為
   ShadowPlugin.renderScene()/renderPhotosOnly()是「整組states一起算」的
   (陰影會參考同組其他素材的位置)，要分前後兩層就必須是兩組各自獨立的
   states分開算、算完各自的shadowCv/photoCv，再依「舞台後→舞台→舞台前」
   的順序疊到最終輸出的outCv上，而不是用同一組states畫一次就好。 */
function renderShadowAndPhotoCanvases(states){
  var shadowCv = document.createElement('canvas');
  shadowCv.width = 1200; shadowCv.height = 1200;
  var sctx = shadowCv.getContext('2d');
  var photoCv = document.createElement('canvas');
  photoCv.width = 1200; photoCv.height = 1200;
  var pctx = photoCv.getContext('2d');
  if(!states.length) return { shadowCv: shadowCv, photoCv: photoCv }; // 空組就回傳兩張空白透明canvas，呼叫端疊上去不會有任何效果

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

  ShadowPlugin.renderPhotosOnly(pctx, states);
  return { shadowCv: shadowCv, photoCv: photoCv };
}

function exportShadowComposite(){
  if(!_shadowReceiver || typeof ShadowPlugin === 'undefined') return;
  var allStates = _shadowReceiver.getOrderedStates();
  if(!allStates.length){ alert('目前沒有任何素材可以匯出'); return; }

  ShadowPlugin.configureZone(1200*0.1, 1200*0.95);

  /* 舞台固定當背景（最下層），所有素材都疊在舞台前面——「放在舞台上」
     checkbox先隱藏，見drawShadowCanvas()同樣的說明，這裡呼應改成
     「全部素材一次畫、不分behind/onStage兩批」，匯出結果才會跟畫布上
     預覽看到的疊放順序一致。 */
  var allCanvases = renderShadowAndPhotoCanvases(allStates);

  var outCv = document.createElement('canvas');
  outCv.width = 1200; outCv.height = 1200;
  var octx = outCv.getContext('2d');
  if(S.stageEnabled !== false) _shadowReceiver.drawStage(octx, { skipSelection:true });
  octx.drawImage(allCanvases.shadowCv, 0, 0);
  octx.drawImage(allCanvases.photoCv, 0, 0);

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
    var targetKey = _shadowPopupTargetAssetKey || 'host';
    S.assets[targetKey] = img;
    closePopup();
    /* popup自己那組商品要存回S.popupShadowSlots等欄位、main那份要還原
       回S.shadowSlots——不管這次confirm的是main還是popup，都呼叫這個
       (targetKey==='host'時，_swapInPopupShadowState()根本沒被呼叫過，
       _shadowPopupSwappedOut是null，這個函式內部的if判斷會直接跳過，
       維持完全不動、原本行為不變)。 */
    if(targetKey !== 'host') _swapOutPopupShadowState();
    renderAll();
    if(targetKey === 'host') propagateSharedProductToLinkedTabs(); // 這個跨分頁同步機制只給main商品用，popupHost是每個分頁各自獨立的，不用同步
    /* 2026-08(KRCB)移除：海外購物節的公版一(host作圖區)沒有自己獨立的
       商品資料來源，所以設計成「main商品確認完，順便廣播一份過去」；但
       KRCB的公版一(07_msbn)已經改成從Excel「【Layout】」區塊的「圖片」
       欄位、比對曝光資源資料夾拿到自己獨立的商品圖(見
       js/editor-import.js的MSBN_TEMPLATE_SLOT_MAP['版型1'])，不應該再
       被main商品廣播覆蓋掉——這正是使用者回報「MSBN版本一的商品區放置
       不是HBN廣播的圖」的根本原因。broadcastHostToMsbn1()這個函式定義
       還留著(給以後萬一要恢復用)，只是這裡不再呼叫它。 */
    var cb = _shadowPopupOnConfirm;
    _shadowPopupOnConfirm = null;
    if(cb) cb();
  };
  img.src = dataUrl;
}
