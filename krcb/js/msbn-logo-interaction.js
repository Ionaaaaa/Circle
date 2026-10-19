'use strict';
/* ══════════════════ MSBN 三格LOGO：直接在畫布上互動 ══════════════════
   跟js/editor-main.js的attachHostDragResize()是同一種「直接對canvas綁
   pointer事件」的模式，但規則反過來：
     - host：框跟著圖片比例變(拖角=resize)，圖片本身永遠完整顯示
     - MSBN這三格：框永遠不變（寫死在positions.json），圖片在框裡可以
       滾輪縮放、拖曳移動，超出框的部分被裁掉（見modules/msbn-logo-module.js
       的ctx.clip()）
   所以另外寫一套，不共用attachHostDragResize()。

   狀態存在 S.msbnLogos[layoutId][slotKey] = { img, scale, offX, offY,
   baseScale, bgColor }，見js/editor-state.js。baseScale是這張圖第一次
   上傳時算出來的「剛好蓋滿整個框」的縮放倍率，只當作滾輪縮放的起始參考
   值，不是縮放下限——下限只設一個極低的絕對值(0.02)防止數值壞掉，
   使用者可以自由縮到很小。bgColor是這張圖的底色(邏輯跟logo2一樣：PNG
   固定白色、JPG抓四角+四邊中點取樣)，縮得比框小的時候，露出來的背景會
   是這個顏色，不會是死板的白色。

   多選：_msbnSelected[layoutId]現在是「陣列」，不是單一slotKey——一般
   點擊＝把選取換成「只有這一格」；按住Shift點擊＝把這一格加進/移出目前
   的選取，不影響其他已選取的格子。滾輪縮放時，會對「目前所有被選取的
   格子」同時套用同一個縮放倍率(各自乘上同一個factor，不是設成同一個
   絕對值，所以原本不同大小的LOGO會保持相對比例一起放大/縮小)，方便
   使用者一次調整好幾個LOGO的大小。拖曳(移動位置)維持只影響「這次滑鼠
   按下去那一格」，不會因為多選就整組一起移動——目前只有滾輪縮放支援
   多選同動，拖曳/刪除等其他操作仍然是單格。 */

var _msbnSelected = {};      // layoutId -> [slotKey, ...]，目前選取哪幾格（可能是空陣列）
var _msbnInteraction = null; // 目前拖曳中的狀態
var _msbnFileInput = null;   // 共用一個隱藏的<input type=file>，觸發前先記住目標layoutId+slotKey
var _msbnFileTarget = null;

/* 切分頁(applyTabData)時呼叫——清掉「目前選取中的格子」這個純UI狀態，
   避免切到別的分頁後，選取框卻還記著上一個分頁的layoutId（畫面上不會有
   對應的canvas，純粹是殘留狀態，不清掉不會壞掉，但下次renderAll()查
   getMsbnSlotBox()會查到別的分頁的bundle，保險起見還是清乾淨）。 */
function resetMsbnSelection(){
  _msbnSelected = {};
  _msbnInteraction = null;
  _msbnUndoStack = [];
  _msbnUndoGroupKey = null;
}

function _msbnGetSelected(layoutId){
  return _msbnSelected[layoutId] || [];
}
/* 2026-10修正「點MSBN2之後，MSBN1的選取框沒有消失」：每個MSBN實例是各自
   一張canvas、各自一份選取清單(_msbnSelected[layoutId])，以前選取某一張
   只會改自己那份，其他實例的選取還留著——畫面上同時好幾張都有選取框/
   參考線，方向鍵/Delete也可能作用到舊的那張。現在改成：只要選了任何
   一張的格子，其他實例的選取一律清掉，同一時間只會有一個實例有選取。 */
function _msbnSetSelected(layoutId, arr){
  if(arr && arr.length){
    Object.keys(_msbnSelected).forEach(function(id){ if(id !== layoutId) _msbnSelected[id] = []; });
  }
  _msbnSelected[layoutId] = arr;
}
function _msbnHasAnySelection(){
  return Object.keys(_msbnSelected).some(function(id){ return _msbnSelected[id] && _msbnSelected[id].length; });
}
function _msbnIsSelected(layoutId, slotKey){
  return _msbnGetSelected(layoutId).indexOf(slotKey) !== -1;
}

function _msbnEnsureFileInput(){
  if(_msbnFileInput) return _msbnFileInput;
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', function(e){
    var file = e.target.files && e.target.files[0];
    e.target.value = ''; // 清掉，不然選同一個檔案兩次不會觸發change
    if(!file || !_msbnFileTarget) return;
    var target = _msbnFileTarget;
    _msbnLoadFileIntoSlot(target.layoutId, target.slotKey, file);
  });
  _msbnFileInput = input;
  return input;
}

/* 2026-08(KRCB)新增：副區的icon格子跟其他MSBN格子不一樣——點擊(不管是
   空格子第一次點，還是雙擊已有圖的格子要換圖)不是直接跳系統選檔案，而是
   先跳「ICON圖庫」popup，讓使用者從既有圖庫裡選一個現成的、或上傳一張
   新的(上傳的話會自動套用固定顏色覆蓋，見js/icon-library.js)。其他MSBN
   格子(LOGO、host等)行為不變，一律還是直接跳系統選檔案。 */
function _msbnOpenPickerForSlot(layoutId, slotKey){
  /* 2026-08(KRCB)修正：原本這裡精確比對slotKey==='icon'，但副區三格的
     實際slot key是'icon1'/'icon2'/'icon3'(見configs/layouts/subzone_app.
     json)，永遠對不上'icon'這個精確字串——導致點擊副區的ICON格子從頭到
     尾都直接跳系統選檔案，完全沒有經過ICON圖庫popup，圖庫比對/上傳自動
     套色這些功能等於形同虛設。改成看slotKey開頭是不是'icon'，涵蓋
     icon1/icon2/icon3。 */
  if(layoutId && slotKey && slotKey.indexOf('icon') === 0 && SUBZONE_IDS.indexOf(layoutId) !== -1 && typeof openIconLibraryPopup === 'function'){
    openIconLibraryPopup(layoutId, slotKey);
    return;
  }
  /* 2026-08(KRCB)新增：商品類欄位(host/host1/host2...)改用「編輯商品」
     1200畫布合成工具，不是直接跳系統選檔案——使用者需求：同一個商品格子
     除了單張商品照以外，有時候要多加一張贈品/副商品一起合成疊放(貼地
     陰影同一套)，見js/shadow-system/shadow-popup.js的
     openMsbnHostComposePopup()。合成完的結果套進格子裡，跟「單張圖片
     直接上傳」呈現效果一樣，可以正常拖曳/縮放/選取。只吃MSBN家族/副區
     的商品欄位(isMsbnTabOnlyId)，其他LOGO類欄位(目前沒有，保留通用性)
     還是走原本的系統選檔案。 */
  if(layoutId && slotKey && slotKey.indexOf('host') === 0 && isMsbnTabOnlyId(layoutId) && typeof openMsbnHostComposePopup === 'function'){
    openMsbnHostComposePopup(layoutId, slotKey);
    return;
  }
  _msbnFileTarget = { layoutId: layoutId, slotKey: slotKey };
  _msbnEnsureFileInput().click();
}

function _msbnEnsureState(layoutId){
  S.msbnLogos = S.msbnLogos || {};
  S.msbnLogos[layoutId] = S.msbnLogos[layoutId] || {};
  return S.msbnLogos[layoutId];
}

function _msbnLoadFileIntoSlot(layoutId, slotKey, file){
  var slots = _msbnEnsureState(layoutId);
  _msbnPushUndo();
  loadMsbnLogoFileInto(S.msbnLogos, layoutId, slotKey, file, function(){
    if(slots[slotKey]){
      _msbnSetSelected(layoutId, [slotKey]);
      renderAll();
    }
  });
}

/* 2026-08修正：原本寫死['left','mid','right']是只認公版一那三格，公版二~六
   的slot key都不一樣(logo1、logoLeft/logoRight、image...)，寫死清單會
   完全點不到。改成直接讀這個版型自己的positions.msbnSlots實際定義了哪些
   key，有幾個就檢查幾個，不用管名字叫什麼、有幾格。 */
function _msbnHitSlot(layoutId, p){
  var all = window.bundles || {};
  var bundle = all[layoutId] || all['07_msbn'];
  var positions = bundle && bundle.positions;
  var slotKeys = (positions && positions.msbnSlots) ? Object.keys(positions.msbnSlots) : [];
  for(var i=0;i<slotKeys.length;i++){
    var slotKey = slotKeys[i];
    var b = getMsbnSlotBox(layoutId, slotKey);
    if(!b) continue;
    var box = b.logoBox;
    if(p.x >= box.x && p.x <= box.x+box.w && p.y >= box.y && p.y <= box.y+box.h){
      return slotKey;
    }
  }
  return null;
}

function _msbnToCanvasPos(canvas, e){
  var rect = canvas.getBoundingClientRect();
  var scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
  var p = e.touches ? e.touches[0] : e;
  return { x:(p.clientX-rect.left)*scaleX, y:(p.clientY-rect.top)*scaleY };
}

/* 選取框覆蓋層——跟drawHostOverlay()同一個道理：直接畫在跟畫面顯示同一個
   canvas上，所以下載/匯出前一定要走renderLayoutClean()（只呼叫Core.render，
   不會呼叫這支函式）才不會把選取框也匯出進圖檔。這支函式的呼叫點是
   renderAll()（跟drawHostOverlay並列），不是Core.render內部。
   多選時，每一格被選取的格子都畫一個框，不是只畫一個。 */
function drawMsbnLogoOverlay(canvas, layoutId){
  var selected = _msbnGetSelected(layoutId);
  var ctx = canvas.getContext('2d');

  /* 2026-08(KRCB)修正「下載出來的圖片裡混進了鉛筆提示圖示」——這個提示
     圖示原本畫在modules/msbn-logo-module.js的msbnLogoSlot.draw()裡面，
     那支函式是Core.render()的一部分，不管是「畫面上互動用的即時預覽」
     還是「下載/匯出前renderLayoutClean()的乾淨版本」都會呼叫到同一份
     Core.render()，兩邊沒有區分，提示圖示因此被一起烤進了下載檔案。
     跟綠色選取框(下面selected.forEach那段)本來就是同一個道理——選取框
     沒有烤進下載檔，是因為它畫在這支drawMsbnLogoOverlay()裡，只有
     js/editor-main.js的renderAll()(互動預覽用)才會呼叫它，
     renderLayoutClean()(匯出前的乾淨版本)完全不會呼叫到這裡。把提示
     圖示搬過來畫，就能享有一樣的「只有互動預覽才看得到、匯出檔案裡
     不會有」的效果，不用另外設計「是不是要匯出」的旗標。
     提示圖示不像選取框只顯示「已選取」的格子——不管有沒有被選取都要
     顯示(讓使用者知道這格可以點擊)，所以這裡是另外掃一次這個版位所有
     host/icon開頭的slot，跟下面selected.forEach()分開處理。 */
  var bundle = (window.bundles && window.bundles[layoutId]) || null;
  var msbnSlots = (bundle && bundle.positions && bundle.positions.msbnSlots) || {};
  Object.keys(msbnSlots).forEach(function(slotKey){
    if(slotKey.indexOf('host') !== 0 && slotKey.indexOf('icon') !== 0) return;
    var box = msbnSlots[slotKey].logoBox;
    if(!box) return;
    var hintR = 13;
    var hintCx = box.x + box.w - hintR - 4;
    var hintCy = box.y + box.h - hintR - 4;
    ctx.save();
    ctx.beginPath();
    ctx.arc(hintCx, hintCy, hintR, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(20,20,20,0.68)';
    ctx.fill();
    ctx.font = (hintR*1.15) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('✎', hintCx, hintCy+1);
    ctx.restore();
  });

  if(!selected.length) return;
  selected.forEach(function(slotKey){
    var b = getMsbnSlotBox(layoutId, slotKey);
    if(!b) return;
    var box = b.logoBox;
    ctx.save();
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = Math.max(1.5, canvas.width*0.0025);
    ctx.setLineDash([6,4]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
    // 對齊參考線(2026-10)：畫在選取框之上，貼邊紅線才看得到
    var st = ((S.msbnLogos && S.msbnLogos[layoutId]) || {})[slotKey];
    if(st && st.img && st.img.complete && st.img.naturalWidth) _msbnDrawGuides(canvas, ctx, box, slotKey, st);
  });
}

/* ══════════════════ 對齊參考線與吸附(2026-10，取代固定十字) ══════════════════
   規格同 Mall SKBN「對齊參考線與吸附」，對齊區域＝每一格自己的logoBox：
     - 選取中的格子：畫穿過圖片「有色範圍中心」的一直一橫藍色虛線(只畫在格子
       範圍內)，中心剛好對到格子正中間時該條變紅色實線。
     - 商品格(slotKey開頭是host)：拖曳時只吸格子正中間(兩軸各自判斷)。
     - LOGO格(其他所有格子：logo1~3/logoLeft/logoRight/image)：拖曳時吸格子的
       左/中/右、上/中/下——有色範圍的左邊/中心/右邊對格子的左緣/中線/右緣，
       每軸挑門檻內最近的一組；有色範圍貼齊格子某一邊時，該邊畫紅色實線。
     - 只有拖曳會吸；滾輪縮放、方向鍵微調不吸。
     - 參考線畫在drawMsbnLogoOverlay()裡(只有renderAll()互動預覽會呼叫)，
       跟選取框一樣不會進下載/匯出圖。
   「有色範圍」：透明PNG看不透明的部分；不透明的圖(JPG、白底PNG)看「跟這張
   圖底色(slotState.bgColor)不一樣」的部分，讓白底LOGO對齊的是圖案本身、
   不是整張白底。結果快取在img上(依底色)，不用每次重算。 */
var MSBN_GUIDE_BLUE = '#5ab8ff';
var MSBN_GUIDE_RED = '#ff2d2d';
var MSBN_GUIDE_SNAP_PX = 6;      // 位置吸附門檻(螢幕px，會換算回畫布座標)
var MSBN_GUIDE_ALIGN_EPS = 0.5;  // 判定「剛好對齊」的誤差(畫布px)
var MSBN_GUIDE_SCAN = 300;       // 有色範圍偵測解析度
var MSBN_GUIDE_BG_TOL = 40;      // 跟底色差多少(RGB任一通道)才算「有色」

function _msbnIsProductSlot(slotKey){ return slotKey.indexOf('host') === 0; }

function _msbnHexToRgb(hex){
  var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if(!m) return null;
  var n = parseInt(m[1], 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}

/* 回傳有色範圍佔整張圖的比例 {tx,ty,tw,th}(0~1)，偵測失敗回傳整張圖 */
function _msbnContentRatio(img, bgColor){
  var key = bgColor || '';
  if(img._msbnTight && img._msbnTight.key === key) return img._msbnTight.r;
  var full = { tx:0, ty:0, tw:1, th:1 };
  var r = full;
  try{
    var sc = Math.min(1, MSBN_GUIDE_SCAN / Math.max(img.naturalWidth, img.naturalHeight));
    var sw = Math.max(1, Math.floor(img.naturalWidth*sc)), sh = Math.max(1, Math.floor(img.naturalHeight*sc));
    var c = document.createElement('canvas'); c.width = sw; c.height = sh;
    var x = c.getContext('2d');
    x.drawImage(img, 0, 0, sw, sh);
    var d = x.getImageData(0, 0, sw, sh).data;
    // 四角任一個是透明的＝透明底圖片，只看alpha；全部不透明才拿底色比對
    var transparent = [0, sw-1, (sh-1)*sw, sh*sw-1].some(function(i){ return d[i*4+3] <= 10; });
    var bg = transparent ? null : _msbnHexToRgb(bgColor);
    var x0=sw, y0=sh, x1=-1, y1=-1;
    for(var yy=0; yy<sh; yy++){
      for(var xx=0; xx<sw; xx++){
        var i = (yy*sw+xx)*4;
        if(d[i+3] <= 10) continue;
        if(bg && Math.abs(d[i]-bg[0]) <= MSBN_GUIDE_BG_TOL && Math.abs(d[i+1]-bg[1]) <= MSBN_GUIDE_BG_TOL && Math.abs(d[i+2]-bg[2]) <= MSBN_GUIDE_BG_TOL) continue;
        if(xx<x0) x0=xx; if(xx>x1) x1=xx; if(yy<y0) y0=yy; if(yy>y1) y1=yy;
      }
    }
    if(x1 >= 0) r = { tx:x0/sw, ty:y0/sh, tw:(x1-x0+1)/sw, th:(y1-y0+1)/sh };
  }catch(err){ r = full; }
  img._msbnTight = { key:key, r:r };
  return r;
}

/* 這一格圖片有色範圍目前在畫布上的位置 {x0,y0,x1,y1,cx,cy}，畫法跟
   modules/msbn-logo-module.js一致：圖片中心＝格子中心+offX/offY */
function _msbnContentBounds(box, st){
  var img = st.img;
  var scale = st.scale || 1;
  var iw = img.naturalWidth*scale, ih = img.naturalHeight*scale;
  var left = box.x + box.w/2 + (st.offX||0) - iw/2;
  var top  = box.y + box.h/2 + (st.offY||0) - ih/2;
  var t = _msbnContentRatio(img, st.bgColor);
  var x0 = left + t.tx*iw, y0 = top + t.ty*ih, x1 = x0 + t.tw*iw, y1 = y0 + t.th*ih;
  return { x0:x0, y0:y0, x1:x1, y1:y1, cx:(x0+x1)/2, cy:(y0+y1)/2 };
}

function _msbnBestSnap(points, targets, thr){
  var d = null;
  points.forEach(function(p){
    targets.forEach(function(t){
      var v = t - p;
      if(Math.abs(v) <= thr && (d === null || Math.abs(v) < Math.abs(d))) d = v;
    });
  });
  return d;
}

function _msbnCanvasPerScreenPx(canvas){
  var rect = canvas.getBoundingClientRect();
  return rect.width > 0 ? canvas.width/rect.width : 1;
}

/* 拖曳中呼叫：offX/offY已經是「未吸附的原始位置」，這裡算要補多少再加上去 */
function _msbnApplySnap(canvas, box, slotKey, st){
  var b = _msbnContentBounds(box, st);
  var thr = MSBN_GUIDE_SNAP_PX * _msbnCanvasPerScreenPx(canvas);
  var sx, sy;
  if(_msbnIsProductSlot(slotKey)){
    sx = _msbnBestSnap([b.cx], [box.x + box.w/2], thr);
    sy = _msbnBestSnap([b.cy], [box.y + box.h/2], thr);
  } else {
    sx = _msbnBestSnap([b.x0, b.cx, b.x1], [box.x, box.x + box.w/2, box.x + box.w], thr);
    sy = _msbnBestSnap([b.y0, b.cy, b.y1], [box.y, box.y + box.h/2, box.y + box.h], thr);
  }
  if(sx !== null) st.offX = (st.offX||0) + sx;
  if(sy !== null) st.offY = (st.offY||0) + sy;
}

function _msbnDrawGuides(canvas, ctx, box, slotKey, st){
  var b = _msbnContentBounds(box, st);
  var k = _msbnCanvasPerScreenPx(canvas);
  var H = canvas.height;
  var top = box.y, bottom = Math.min(box.y + box.h, H); // LOGO框可能比畫布多1px，裁到畫布內
  var bcx = box.x + box.w/2, bcy = box.y + box.h/2;
  var onX = Math.abs(b.cx - bcx) < MSBN_GUIDE_ALIGN_EPS;
  var onY = Math.abs(b.cy - bcy) < MSBN_GUIDE_ALIGN_EPS;
  function line(x0, y0, x1, y1, red){
    ctx.save();
    ctx.setLineDash(red ? [] : [6*k, 4*k]);
    ctx.strokeStyle = red ? MSBN_GUIDE_RED : MSBN_GUIDE_BLUE;
    ctx.lineWidth = 1.5*k;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }
  var vx = onX ? bcx : b.cx, hy = onY ? bcy : b.cy;
  line(vx, top, vx, bottom, onX);                 // 垂直基準線(只畫在格子內)
  line(box.x, hy, box.x + box.w, hy, onY);        // 水平基準線
  if(!_msbnIsProductSlot(slotKey)){
    // LOGO有色範圍貼齊格子邊緣：該邊畫紅線(往內0.75個線寬，才不會被裁掉一半)
    var inset = 0.75*k;
    if(Math.abs(b.x0 - box.x) < MSBN_GUIDE_ALIGN_EPS) line(box.x + inset, top, box.x + inset, bottom, true);
    if(Math.abs(b.x1 - (box.x + box.w)) < MSBN_GUIDE_ALIGN_EPS) line(box.x + box.w - inset, top, box.x + box.w - inset, bottom, true);
    if(Math.abs(b.y0 - box.y) < MSBN_GUIDE_ALIGN_EPS) line(box.x, box.y + inset, box.x + box.w, box.y + inset, true);
    if(Math.abs(b.y1 - (box.y + box.h)) < MSBN_GUIDE_ALIGN_EPS) line(box.x, bottom - inset, box.x + box.w, bottom - inset, true);
  }
}

/* ══════════════════ MSBN 復原(Ctrl+Z) ══════════════════
   只管S.msbnLogos這份資料(位置/縮放/刪除/上傳)，不管S.msbnTexts(文字內容
   直接用瀏覽器原生的textarea復原機制就好，見js/msbn-text-interaction.js)。
   快照只複製純數字欄位(scale/offX/offY/baseScale/bgColor)，img保留原本的
   Image物件參照——不用重新從src載入圖片，復原是瞬間的。
   連續動作(同一次拖曳、同一次滾輪手勢、同一次按住方向鍵不放)只算一個
   undo步驟：拖曳是「pointerdown時push一次，pointermove不重複push」自然
   達成；滾輪/方向鍵用_msbnUndoGroupKey+時間戳記判斷「是不是同一組連續
   動作」，600ms內的同一種操作視為同一組，不重複push。 */
var _msbnUndoStack = [];
var MSBN_UNDO_MAX = 50;
var _msbnUndoGroupKey = null;
var _msbnUndoGroupUntil = 0;

function _msbnCloneLogosState(){
  var out = {};
  Object.keys(S.msbnLogos || {}).forEach(function(layoutId){
    var slots = S.msbnLogos[layoutId] || {};
    var slotsOut = {};
    Object.keys(slots).forEach(function(slotKey){
      var st = slots[slotKey];
      if(!st) return;
      slotsOut[slotKey] = { img: st.img, scale: st.scale, offX: st.offX, offY: st.offY, baseScale: st.baseScale, bgColor: st.bgColor };
    });
    out[layoutId] = slotsOut;
  });
  return out;
}

/* groupKey給的話(例如'wheel:07_msbn__2:left')，600ms內重複呼叫同一個
   groupKey不會重複push，達成「同一組連續動作只算一步」；不給groupKey
   (例如拖曳開始、刪除、上傳新圖)則每次呼叫都push一筆。 */
function _msbnPushUndo(groupKey){
  var now = Date.now();
  if(groupKey && groupKey === _msbnUndoGroupKey && now < _msbnUndoGroupUntil){
    _msbnUndoGroupUntil = now + 600;
    return;
  }
  _msbnUndoGroupKey = groupKey || null;
  _msbnUndoGroupUntil = groupKey ? now + 600 : 0;
  _msbnUndoStack.push(_msbnCloneLogosState());
  if(_msbnUndoStack.length > MSBN_UNDO_MAX) _msbnUndoStack.shift();
}

function _msbnUndo(){
  if(!_msbnUndoStack.length) return;
  S.msbnLogos = _msbnUndoStack.pop();
  _msbnUndoGroupKey = null;
  renderAll();
}

document.addEventListener('keydown', function(e){
  var isUndoCombo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
  if(!isUndoCombo) return;
  var active = document.activeElement;
  if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return; // 輸入框裡的Ctrl+Z交給瀏覽器原生文字復原處理
  e.preventDefault();
  _msbnUndo();
});

function attachMsbnLogoInteraction(canvas, layoutId){
  if(!isMsbnTabOnlyId(layoutId)) return;
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', function(e){
    var p = _msbnToCanvasPos(canvas, e);
    var slotKey = _msbnHitSlot(layoutId, p);

    if(!slotKey){
      // 點到這張畫布的空白處：所有實例的選取都清掉(不只這一張)
      if(_msbnHasAnySelection()){ _msbnSelected = {}; renderAll(); }
      return;
    }

    var slots = _msbnEnsureState(layoutId);
    var slotState = slots[slotKey];

    if(!slotState || !slotState.img){
      // 這一格還沒有圖：點擊＝觸發上傳（不管有沒有按Shift，空格子一律是上傳）
      _msbnOpenPickerForSlot(layoutId, slotKey);
      return;
    }

    e.preventDefault();

    if(e.shiftKey){
      /* Shift點擊：切換這一格在選取清單裡的有/無，不影響其他已選取的格子，
         也不開始拖曳（多選通常是為了接下來滾輪一起縮放，不是要移動）。 */
      var current = _msbnGetSelected(layoutId).slice();
      var idx = current.indexOf(slotKey);
      if(idx === -1) current.push(slotKey); else current.splice(idx, 1);
      _msbnSetSelected(layoutId, current);
      renderAll();
      return;
    }

    // 一般點擊：選取換成「只有這一格」，並開始拖曳
    _msbnPushUndo();
    _msbnSetSelected(layoutId, [slotKey]);
    canvas.setPointerCapture(e.pointerId);
    _msbnInteraction = {
      layoutId: layoutId,
      slotKey: slotKey,
      startPointer: p,
      startOffX: slotState.offX || 0,
      startOffY: slotState.offY || 0
    };
    renderAll();
  });

  canvas.addEventListener('pointermove', function(e){
    var it = _msbnInteraction;
    if(!it || it.layoutId !== layoutId) return;
    e.preventDefault();
    var p = _msbnToCanvasPos(canvas, e);
    var slots = _msbnEnsureState(layoutId);
    var slotState = slots[it.slotKey];
    if(!slotState) return;
    slotState.offX = it.startOffX + (p.x - it.startPointer.x);
    slotState.offY = it.startOffY + (p.y - it.startPointer.y);
    /* 2026-10吸附：上面永遠從拖曳起點重算「未吸附位置」，再補吸附位移，
       不拿上一次吸附後的位置累加，才不會黏住甩不開 */
    var gb = getMsbnSlotBox(layoutId, it.slotKey);
    if(gb && slotState.img && slotState.img.naturalWidth) _msbnApplySnap(canvas, gb.logoBox, it.slotKey, slotState);
    renderAll();
  });

  function endDrag(e){
    if(_msbnInteraction && _msbnInteraction.layoutId === layoutId){
      _msbnInteraction = null;
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* 滾輪縮放：對「目前所有被選取的格子」同時套用同一個縮放倍率（各自
     乘上同一個factor，不是設成同一個絕對值），支援一次選好幾格、滾輪
     同時放大縮小。只有真的有圖片的格子會被縮放，沒圖的選取(理論上不會
     發生，因為空格子點擊會直接觸發上傳、不會進入選取清單)會被忽略。
     縮放範圍各自限制在各自baseScale的0.5x~6x，不會因為同時縮放就讓某一
     格超出安全範圍。 */
  canvas.addEventListener('wheel', function(e){
    var selected = _msbnGetSelected(layoutId);
    if(!selected.length) return;
    var slots = _msbnEnsureState(layoutId);
    var anyImg = selected.some(function(k){ return slots[k] && slots[k].img; });
    if(!anyImg) return;
    e.preventDefault();
    _msbnPushUndo('wheel:'+layoutId+':'+selected.join(','));
    /* 縮放幅度調小——原本0.0015讓每次滾一小格的變化感覺太明顯，改成
       0.0004，滾動同樣的距離，尺寸變化幅度大概只有原本的1/4，可以更
       精細地微調大小。這個數字如果還是太快/太慢，直接告訴我要調到多少。 */
    var factor = Math.exp(-e.deltaY * 0.0004);
    selected.forEach(function(slotKey){
      var slotState = slots[slotKey];
      if(!slotState || !slotState.img) return;
      var base = slotState.baseScale || slotState.scale || 1;
      var next = (slotState.scale || base) * factor;
      /* 使用者明確要求拿掉「縮小到一個程度就不能再縮小」的下限——原本
         設base*0.5是怕縮太小看不到，但這個限制反而擋到真的需要縮很小的
         情境。改成只留一個極低的絕對值下限(不是相對base的比例)，純粹
         防止scale變成0或負值讓drawImage壞掉，不會有感覺得到的「卡住」。
         上限維持base*6，避免不小心滾太快放大到誇張的程度。 */
      var minScale = 0.02, maxScale = base * 6;
      slotState.scale = Math.max(minScale, Math.min(maxScale, next));
    });
    renderAll();
  }, { passive:false });

  /* 雙擊已有圖的格子＝重新選圖（不用先清空再上傳），不受目前選取狀態影響 */
  canvas.addEventListener('dblclick', function(e){
    var p = _msbnToCanvasPos(canvas, e);
    var slotKey = _msbnHitSlot(layoutId, p);
    if(!slotKey) return;
    _msbnOpenPickerForSlot(layoutId, slotKey);
  });
}

/* 選取中的格子按Delete/Backspace＝清空這些格子，重新回到「點擊上傳」狀態
   （多選時全部一起清空）。掛在document上（跟畫布本身的pointer事件分開），
   只在「目前有選取中的MSBN格子」時才動作，不會誤刪其他操作(例如輸入框
   打字按Backspace)。 */
document.addEventListener('keydown', function(e){
  if(e.key !== 'Delete' && e.key !== 'Backspace') return;
  var active = document.activeElement;
  if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

  var layoutId = Object.keys(_msbnSelected).find(function(id){ return _msbnSelected[id] && _msbnSelected[id].length; });
  if(!layoutId) return;
  var slots = S.msbnLogos && S.msbnLogos[layoutId];
  if(!slots) return;
  e.preventDefault();
  _msbnPushUndo();
  _msbnGetSelected(layoutId).forEach(function(slotKey){ delete slots[slotKey]; });
  renderAll();
});

/* 選取中的格子按方向鍵＝微調位置（拖曳的鍵盤版本，選取後不用滑鼠也能
   精準對位）。一般按一下＝1px，按住Shift＝10px(比照大部分繪圖軟體的
   慣例：一般鍵盤微調、Shift加速)。多選時所有選取中的格子一起移動同樣
   的距離，跟滾輪縮放對多選的處理方式一致。 */
document.addEventListener('keydown', function(e){
  if(e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  var active = document.activeElement;
  if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

  var layoutId = Object.keys(_msbnSelected).find(function(id){ return _msbnSelected[id] && _msbnSelected[id].length; });
  if(!layoutId) return;
  var slots = S.msbnLogos && S.msbnLogos[layoutId];
  if(!slots) return;
  var selected = _msbnGetSelected(layoutId).filter(function(k){ return slots[k]; });
  if(!selected.length) return;

  e.preventDefault();
  _msbnPushUndo('arrow:'+layoutId+':'+selected.join(','));
  var step = e.shiftKey ? 10 : 1;
  var dx = 0, dy = 0;
  if(e.key === 'ArrowUp') dy = -step;
  else if(e.key === 'ArrowDown') dy = step;
  else if(e.key === 'ArrowLeft') dx = -step;
  else if(e.key === 'ArrowRight') dx = step;

  selected.forEach(function(slotKey){
    slots[slotKey].offX = (slots[slotKey].offX || 0) + dx;
    slots[slotKey].offY = (slots[slotKey].offY || 0) + dy;
  });
  renderAll();
});
