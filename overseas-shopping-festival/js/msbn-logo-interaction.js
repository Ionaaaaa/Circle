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
function _msbnSetSelected(layoutId, arr){
  _msbnSelected[layoutId] = arr;
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

/* 每個slot的鉛筆提示圖示——畫在框的右下角，半徑跟畫布寬度成比例，跟
   _msbnHitPencilIcon()共用同一個公式算出來的圓心/半徑，兩邊改動時記得
   一起改，不然「畫出來的位置」跟「點得到的範圍」會對不起來。 */
function _msbnPencilIconGeom(box, canvas){
  var r = Math.max(11, canvas.width*0.028);
  return { cx: box.x + box.w - r - 4, cy: box.y + box.h - r - 4, r: r };
}

/* 2026-09新增：使用者反映「要改圖只能雙擊，一開始根本不知道可以雙擊」，
   改成比照KRCB已經在用的做法——每一格LOGO/圖片slot右下角常駐畫一個小
   鉛筆圖示，提示「這裡可以點來換圖」，不用先摸索到雙擊這個隱藏手勢。
   這個提示圖示直接畫在跟畫面顯示同一個canvas上（見attachMsbnLogoInteraction
   裡pointerdown命中判斷的_msbnHitPencilIcon()，共用同一組座標），所以
   下載/匯出前一定要走renderLayoutClean()（只呼叫Core.render，不會呼叫
   這支函式）才不會把提示圖示也匯出進圖檔——這支函式的呼叫點是
   renderAll()（互動預覽用），跟Core.render內部完全分開，做法跟下面選取
   框(綠色虛線)本來就沒有被匯出是同一個道理，不用另外設計「是不是要
   匯出」的旗標。
   只有「已經有圖」的格子才畫提示圖示——還沒有圖的格子點一下就是直接
   觸發上傳，整格本身就是很明顯的上傳入口(見背景模組畫的虛線框+文字)，
   不需要再疊一個鉛筆圖示。 */
function drawMsbnLogoOverlay(canvas, layoutId){
  var ctx = canvas.getContext('2d');
  var slots = (S.msbnLogos && S.msbnLogos[layoutId]) || {};
  var bundle = (window.bundles && window.bundles[layoutId]) || null;
  var msbnSlots = (bundle && bundle.positions && bundle.positions.msbnSlots) || {};
  Object.keys(msbnSlots).forEach(function(slotKey){
    if(!slots[slotKey] || !slots[slotKey].img) return; // 還沒有圖的格子不畫提示圖示
    var b = getMsbnSlotBox(layoutId, slotKey);
    if(!b) return;
    var box = b.logoBox;
    var g = _msbnPencilIconGeom(box, canvas);
    ctx.save();
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.r, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(20,20,20,0.68)';
    ctx.fill();
    ctx.font = (g.r*1.15) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('✎', g.cx, g.cy+1);
    ctx.restore();
  });

  /* 選取框覆蓋層——跟上面鉛筆圖示同一個道理：直接畫在跟畫面顯示同一個
     canvas上，所以下載/匯出前一定要走renderLayoutClean()（只呼叫
     Core.render，不會呼叫這支函式）才不會把選取框也匯出進圖檔。
     多選時，每一格被選取的格子都畫一個框，不是只畫一個。 */
  var selected = _msbnGetSelected(layoutId);
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
  });
}

/* 命中判斷：滑鼠/觸控點下去的位置，是不是剛好落在某個已經有圖的slot的
   鉛筆提示圖示範圍內——跟_msbnHitSlot()判斷「整個框」分開判斷，鉛筆圖示
   只是框裡的一小塊圓形區域，要先判斷才不會被整個框的判斷邏輯蓋過去。
   回傳命中的slotKey，沒命中回傳null。 */
function _msbnHitPencilIcon(canvas, layoutId, p){
  var slots = (S.msbnLogos && S.msbnLogos[layoutId]) || {};
  var all = window.bundles || {};
  var bundle = all[layoutId] || all['07_msbn'];
  var positions = bundle && bundle.positions;
  var slotKeys = (positions && positions.msbnSlots) ? Object.keys(positions.msbnSlots) : [];
  for(var i=0;i<slotKeys.length;i++){
    var slotKey = slotKeys[i];
    if(!slots[slotKey] || !slots[slotKey].img) continue; // 沒圖的格子沒有鉛筆圖示可點
    var b = getMsbnSlotBox(layoutId, slotKey);
    if(!b) continue;
    var g = _msbnPencilIconGeom(b.logoBox, canvas);
    var dx = p.x - g.cx, dy = p.y - g.cy;
    if(dx*dx + dy*dy <= g.r*g.r) return slotKey;
  }
  return null;
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
  if(!isMsbnFamilyId(layoutId)) return;
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', function(e){
    var p = _msbnToCanvasPos(canvas, e);

    /* 2026-09新增：先判斷有沒有點中鉛筆提示圖示——命中就直接開檔案選取
       視窗換圖，不進入下面「選取＋開始拖曳」的一般流程，也不用等使用者
       雙擊才能重新選圖。跟_msbnHitSlot()分開判斷，鉛筆圖示只是框裡右下角
       一小塊圓形區域，一定要先判斷，不然會被下面「整個框都算選取/拖曳」
       的邏輯蓋過去，永遠點不到。 */
    var pencilSlotKey = _msbnHitPencilIcon(canvas, layoutId, p);
    if(pencilSlotKey){
      e.preventDefault();
      e.stopPropagation();
      _msbnFileTarget = { layoutId: layoutId, slotKey: pencilSlotKey };
      _msbnEnsureFileInput().click();
      return;
    }

    var slotKey = _msbnHitSlot(layoutId, p);

    if(!slotKey){
      if(_msbnGetSelected(layoutId).length){ _msbnSetSelected(layoutId, []); renderAll(); }
      return;
    }

    var slots = _msbnEnsureState(layoutId);
    var slotState = slots[slotKey];

    if(!slotState || !slotState.img){
      // 這一格還沒有圖：點擊＝觸發上傳（不管有沒有按Shift，空格子一律是上傳）
      _msbnFileTarget = { layoutId: layoutId, slotKey: slotKey };
      _msbnEnsureFileInput().click();
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
    if(it && it.layoutId === layoutId){
      e.preventDefault();
      var pDrag = _msbnToCanvasPos(canvas, e);
      var slots = _msbnEnsureState(layoutId);
      var slotState = slots[it.slotKey];
      if(!slotState) return;
      slotState.offX = it.startOffX + (pDrag.x - it.startPointer.x);
      slotState.offY = it.startOffY + (pDrag.y - it.startPointer.y);
      renderAll();
      return;
    }
    /* 2026-09新增：滑鼠移到鉛筆提示圖示上方時換成手指游標，提示「這裡
       可以點來換圖」——單純視覺提示，不影響任何實際互動邏輯，沒有拖曳
       中(_msbnInteraction為null)才需要判斷，拖曳中滑鼠通常已經離開圖示
       範圍，不用每個pointermove都白算一次。 */
    var pHover = _msbnToCanvasPos(canvas, e);
    canvas.style.cursor = _msbnHitPencilIcon(canvas, layoutId, pHover) ? 'pointer' : '';
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
    _msbnFileTarget = { layoutId: layoutId, slotKey: slotKey };
    _msbnEnsureFileInput().click();
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
