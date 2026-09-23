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

/* ══════════════════ Ctrl+Z 復原「調整位置」 ══════════════════
   ★2026-09-23新增，使用者需求：「寢具的msbn需要有ctrl+z返回上一步的功能，
   只要調整位置返回就好」——只復原offX/offY（拖曳/方向鍵微調的位置），
   不處理滾輪縮放(scale)或換圖，範圍照使用者的話「只要調整位置返回就好」。

   每個layoutId自己一份歷史堆疊(_msbnPosHistory[layoutId])，堆疊裡每一筆是
   「一批」變動之前的快照(entries: [{slotKey, offX, offY}, ...])——之所以是
   一批而不是單一格，是因為方向鍵微調可以同時對「目前所有選取中的格子」
   一起移動(多選)，Ctrl+Z一次要能把這一整批一起復原，不能只復原其中一格。
   拖曳(單格)push時entries陣列就只有一個元素，邏輯共用同一套。
   push的時機是「動作開始前」的狀態：拖曳是pointerdown那一刻(還沒開始移動)
   push一次；方向鍵是每次按鍵套用dx/dy之前push一次——這樣「一次拖曳手勢」
   或「一次按鍵」都對應「一步可復原的動作」，符合Ctrl+Z的直覺，不會出現
   「按一下Ctrl+Z卻只退回一點點」的狀況。
   最多保留30步，_lastMsbnPosLayoutId記著「最後一次調整位置的是哪個
   layoutId」，Ctrl+Z只復原它（頁面上可能同時有msbn1、msbn2多份MSBN版本，
   每份各自的歷史互不影響，Ctrl+Z只動使用者剛剛實際在調整的那一份）。 */
var _msbnPosHistory = {};        // layoutId -> [ [{slotKey,offX,offY}, ...], ... ]，陣列尾端是最新一筆
var _lastMsbnPosLayoutId = null;

function pushMsbnPosHistory(layoutId, entries){
  if(!entries || !entries.length) return;
  _msbnPosHistory[layoutId] = _msbnPosHistory[layoutId] || [];
  var stack = _msbnPosHistory[layoutId];
  stack.push(entries.map(function(e){ return { slotKey: e.slotKey, offX: e.offX, offY: e.offY }; }));
  if(stack.length > 30) stack.shift(); // 上限30步，避免無限長
  _lastMsbnPosLayoutId = layoutId;
}

function undoLastMsbnPos(){
  var layoutId = _lastMsbnPosLayoutId;
  if(!layoutId) return;
  var stack = _msbnPosHistory[layoutId];
  if(!stack || !stack.length) return;
  var batch = stack.pop();
  var slots = S.msbnLogos && S.msbnLogos[layoutId];
  if(!slots) return;
  batch.forEach(function(e){
    if(slots[e.slotKey]){ slots[e.slotKey].offX = e.offX; slots[e.slotKey].offY = e.offY; }
  });
  renderAll();
}

/* 切分頁(applyTabData)時呼叫——清掉「目前選取中的格子」這個純UI狀態，
   避免切到別的分頁後，選取框卻還記著上一個分頁的layoutId（畫面上不會有
   對應的canvas，純粹是殘留狀態，不清掉不會壞掉，但下次renderAll()查
   getMsbnSlotBox()會查到別的分頁的bundle，保險起見還是清乾淨）。 */
function resetMsbnSelection(){
  _msbnSelected = {};
  _msbnInteraction = null;
}

function _msbnGetSelected(layoutId){
  return _msbnSelected[layoutId] || [];
}
function _msbnSetSelected(layoutId, arr){
  _msbnSelected[layoutId] = arr;
}
/* 「沒按Shift＝一次只會有一個被選」要跨整個頁面成立，不是只在同一張畫布
   內成立：MSBN版本管理可以有多張畫布(msbn1、msbn2...)，選取狀態是各張畫布
   各記一份(_msbnSelected[layoutId])，如果不清掉其他畫布的，使用者在msbn1
   選了一格、再去點msbn2的一格，兩張畫布上就會同時各有一個綠框，看起來像
   「上一個沒有被取消」。所以每次在某張畫布上按下滑鼠，都先把「其他畫布」
   的選取清空（Shift也一樣：多選只發生在同一張畫布內，跨畫布不累加，
   不然方向鍵/Delete到底要動哪一張會有歧義）。回傳有沒有真的清掉東西。 */
function _msbnClearOtherCanvases(layoutId){
  var changed = false;
  Object.keys(_msbnSelected).forEach(function(id){
    if(id !== layoutId && _msbnSelected[id] && _msbnSelected[id].length){
      _msbnSelected[id] = [];
      changed = true;
    }
  });
  return changed;
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
  loadMsbnLogoFileInto(S.msbnLogos, layoutId, slotKey, file, function(){
    if(slots[slotKey]){
      _msbnSetSelected(layoutId, [slotKey]);
      renderAll();
    }
  });
}

function _msbnHitSlot(layoutId, p){
  var order = ['left', 'mid', 'right'];
  for(var i=0;i<order.length;i++){
    var slotKey = order[i];
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
  if(!selected.length) return;
  var ctx = canvas.getContext('2d');
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

/* LOGO置中參考線——每一格「已經有上傳LOGO」的格子，在LOGO框正中央各畫一條
   垂直線＋一條水平線（十字），讓使用者拿LOGO本身去對照有沒有置中。
   LOGO預設就是以logoBox的中心為基準(見modules/msbn-logo-module.js的
   cx/cy)，所以參考線的交叉點＝LOGO置中時的圖片中心。
   重點：這是疊在畫布上面的DOM元素(.msbn-guides，樣式見editor.html)，不是
   用ctx畫進canvas。下載/匯出讀的是canvas像素，DOM疊層根本不在裡面，所以
   不需要像drawMsbnLogoOverlay()那樣靠renderLayoutClean()重畫乾淨版本，
   也不怕匯出到一半renderAll()又被觸發(例如背景圖載入完成)把線畫進去。
   位置用百分比(相對canvas的1200x150)，畫面縮放時自動跟著對齊。
   pointer-events:none，不會擋到拖曳/滾輪/點擊。 */
function updateMsbnGuides(canvas, layoutId){
  if(!isMsbnFamilyId(layoutId)) return;
  var wrap = canvas.parentElement;
  if(!wrap) return;
  var layer = wrap.querySelector('.msbn-guides');
  if(!layer){
    layer = document.createElement('div');
    layer.className = 'msbn-guides';
    layer.setAttribute('aria-hidden', 'true');
    wrap.appendChild(layer);
  }
  var W = canvas.width, H = canvas.height;
  var slots = (S.msbnLogos && S.msbnLogos[layoutId]) || {};
  var html = '';
  ['left', 'mid', 'right'].forEach(function(slotKey){
    var st = slots[slotKey];
    if(!st || !st.img) return;                 // 沒放LOGO的格子不畫，保持乾淨
    var b = getMsbnSlotBox(layoutId, slotKey);
    if(!b) return;
    var box = b.logoBox;
    var cx = box.x + box.w/2, cy = box.y + box.h/2;
    var bottom = Math.min(box.y + box.h, H);   // LOGO框比畫布多1px，裁到畫布內
    var pct = function(v, total){ return (v/total*100).toFixed(4) + '%'; };
    html += '<i class="v" style="left:'+pct(cx, W)+';top:'+pct(box.y, H)+';height:'+pct(bottom-box.y, H)+'"></i>';
    html += '<i class="h" style="top:'+pct(cy, H)+';left:'+pct(box.x, W)+';width:'+pct(box.w, W)+'"></i>';
  });
  if(layer.innerHTML !== html) layer.innerHTML = html;
}

function attachMsbnLogoInteraction(canvas, layoutId){
  if(!isMsbnFamilyId(layoutId)) return;
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', function(e){
    var p = _msbnToCanvasPos(canvas, e);
    var slotKey = _msbnHitSlot(layoutId, p);

    var clearedOthers = _msbnClearOtherCanvases(layoutId);

    if(!slotKey){
      if(_msbnGetSelected(layoutId).length){ _msbnSetSelected(layoutId, []); renderAll(); }
      else if(clearedOthers){ renderAll(); }
      return;
    }

    var slots = _msbnEnsureState(layoutId);
    var slotState = slots[slotKey];

    if(!slotState || !slotState.img){
      // 這一格還沒有圖：點擊＝觸發上傳（不管有沒有按Shift，空格子一律是上傳）。
      // 沒按Shift時，「目前選取」也一併清掉——空格子本身選不起來，但點它就代表
      // 要換成別的目標了，不能還留著上一格的綠框(就算使用者取消選檔也一樣)。
      if(!e.shiftKey && _msbnGetSelected(layoutId).length){
        _msbnSetSelected(layoutId, []);
        renderAll();
      } else if(clearedOthers){
        renderAll();
      }
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
    _msbnSetSelected(layoutId, [slotKey]);
    canvas.setPointerCapture(e.pointerId);
    /* Ctrl+Z復原：拖曳「開始」的當下（還沒真的移動）先把目前位置存進歷史，
       跟下面方向鍵微調共用同一套pushMsbnPosHistory()。 */
    pushMsbnPosHistory(layoutId, [{ slotKey: slotKey, offX: slotState.offX || 0, offY: slotState.offY || 0 }]);
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
  var step = e.shiftKey ? 10 : 1;
  var dx = 0, dy = 0;
  if(e.key === 'ArrowUp') dy = -step;
  else if(e.key === 'ArrowDown') dy = step;
  else if(e.key === 'ArrowLeft') dx = -step;
  else if(e.key === 'ArrowRight') dx = step;

  /* Ctrl+Z復原：套用這次dx/dy「之前」，把目前所有選取中格子的位置存成
     一批，推進歷史堆疊——多選時這一批會包含好幾格，Ctrl+Z一次把它們
     一起復原，不會出現「多選移動只復原了其中一格」的不一致狀況。 */
  pushMsbnPosHistory(layoutId, selected.map(function(slotKey){
    return { slotKey: slotKey, offX: slots[slotKey].offX || 0, offY: slots[slotKey].offY || 0 };
  }));

  selected.forEach(function(slotKey){
    slots[slotKey].offX = (slots[slotKey].offX || 0) + dx;
    slots[slotKey].offY = (slots[slotKey].offY || 0) + dy;
  });
  renderAll();
});

/* Ctrl+Z（或Mac的Cmd+Z）＝復原上一步「調整位置」（拖曳或方向鍵微調），
   不處理縮放/換圖——使用者明確要求「只要調整位置返回就好」，範圍刻意
   縮小，不做成整個編輯器的通用復原。焦點在輸入框/textarea/可編輯內容時
   放行，不搶走瀏覽器原生的文字復原（例如使用者正在文案輸入框想復原
   打字內容）。 */
document.addEventListener('keydown', function(e){
  var key = (e.key || '').toLowerCase();
  if(!(e.ctrlKey || e.metaKey) || key !== 'z' || e.shiftKey) return;
  var active = document.activeElement;
  if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
  e.preventDefault();
  undoLastMsbnPos();
});
