'use strict';
/*
  coupon-ticket-popup.js
  ------------------------------------------------------------
  券樣合成popup（電子票券繳費_匯入流程.md 第6a步）。

  2026-08 改版：
    1. 版面比照陰影編輯popup（shadow-popup.js）——畫布在右邊（大張、即時預覽），
       控制項（LOGO上傳/顏色/文字）在左邊；多個票券槽位時，左邊上方多一排
       槽位切換頁籤，一次只編輯一個槽位、右邊畫布跟著切換顯示對應內容。
    2. 新增「回去編輯」入口：openCouponTicketEditForSlot(slotId)，給
       shadow-popup.js的「票券編輯」按鈕呼叫——從1200畫布那個槽位已經存好的
       ticketMeta（LOGO/顏色/文字）還原，改完直接更新那個槽位的圖片內容，
       位置/縮放/旋轉維持原本調整過的結果不變（見applyShadowSlotDataUrl()）。

  兩種進入情境共用同一套內部實作(_openInternal)：
    - openCouponTicketPopup(ticketSlotIds, matched, onDone)
      ：匯入流程用，可能同時有多個票券化槽位，確認後把合成結果寫回
        matched[slotId]（File物件，跟matchAssetFolder()比對到的檔案同型態，
        呼叫端proceedToShadowFromImport()不用另外分支處理）。
    - openCouponTicketEditForSlot(slotId)
      ：從已經開著的1200畫布popup裡，針對單一槽位重新編輯，改完直接呼叫
        applyShadowSlotDataUrl()更新畫面，不經過matched。
*/

function couponDataUrlToFile(dataUrl, filename){
  var parts = dataUrl.split(',');
  var mimeMatch = parts[0].match(/data:(.*?);base64/);
  var mime = mimeMatch ? mimeMatch[1] : 'image/png';
  var bin = atob(parts[1]);
  var arr = new Uint8Array(bin.length);
  for(var i=0; i<bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

function couponReadFileAsImage(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(ev){
      var img = new Image();
      img.onload = function(){ resolve(img); };
      img.onerror = function(){ reject(new Error('圖片載入失敗')); };
      img.src = ev.target.result;
    };
    reader.onerror = function(){ reject(new Error('檔案讀取失敗')); };
    reader.readAsDataURL(file);
  });
}

function couponLoadImageFromDataUrl(dataUrl){
  return new Promise(function(resolve, reject){
    var img = new Image();
    img.onload = function(){ resolve(img); };
    img.onerror = function(){ reject(new Error('圖片載入失敗')); };
    img.src = dataUrl;
  });
}

function couponRgbToHex(rgb){
  function h(v){ return v.toString(16).padStart(2,'0'); }
  return '#'+h(rgb.r)+h(rgb.g)+h(rgb.b);
}
function couponHexToRgb(hex){
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if(!m) return { r:238, g:77, b:45 };
  return { r:parseInt(m[1],16), g:parseInt(m[2],16), b:parseInt(m[3],16) };
}

var COUPON_DISPLAY_W = 560; // 跟shadow-popup.js的SHADOW_DISPLAY同一個寬度基準，視覺上兩個popup大小一致

/* 券樣烤進圖檔本身的傾斜角度，依槽位個別設定——不同位置(左/中/右)的券在
   1200畫布裡視覺上需要的傾斜方向/幅度不一定一樣。目前中/右先維持跟左邊
   一樣(2度)當預設值，之後要分別調整，改這裡對應的數字即可，跟
   coupon-ticket.js的LOGO_BOX_ROTATION_DEG/TEXT_BLOCK_ROTATION_DEG一樣的
   正值=順時鐘、負值=逆時鐘規則。找不到對應槽位(例如以後多商品組合的
   其他槽位)會退回coupon-ticket.js自己的TICKET_PRE_ROTATE_DEG預設值
   （見_openCouponTicketInternal()裡取值那段的|| undefined寫法）。 */
var TICKET_ROTATE_BY_SLOT = {
  '商品1(左)': 5,
  '商品2(中)': 5,
  '商品3(右)': -3
};

/* cardsSpec: [{slotId, logoFile?, logoDataUrl?, color?, text?}]
   onConfirm(results)：results = [{slotId, dataUrl, logoDataUrl, color, text}]，
   呼叫端自己決定要把結果寫進matched還是S.shadowSlots。 */
function _openCouponTicketInternal(cardsSpec, onConfirm){
  var TW = window.CouponTicket ? window.CouponTicket.TEMPLATE_W : 802;
  var TH = window.CouponTicket ? window.CouponTicket.TEMPLATE_H : 312;
  var displayH = Math.round(COUPON_DISPLAY_W * TH / TW);

  var cards = cardsSpec.map(function(spec){
    return {
      slotId: spec.slotId,
      logoImg: null,
      logoDataUrl: spec.logoDataUrl || null,
      pendingLogoFile: spec.logoFile || null, // 還沒讀成Image之前先記著，初始化時統一處理
      color: spec.color || { r:238, g:77, b:45 },
      text: spec.text || (window.CouponTicket ? window.CouponTicket.DEFAULT_TEXT : '電子票券'),
      // LOGO拖曳位置/滾輪縮放——重新編輯(openCouponTicketEditForSlot)時從ticketMeta帶進來，
      // 全新匯入沒有的話預設0/0/1(置中、剛好鋪滿框)
      logoOffsetX: (typeof spec.logoOffsetX === 'number') ? spec.logoOffsetX : 0,
      logoOffsetY: (typeof spec.logoOffsetY === 'number') ? spec.logoOffsetY : 0,
      logoScale: (typeof spec.logoScale === 'number') ? spec.logoScale : 1
    };
  });

  var activeIdx = 0;
  var multi = cards.length > 1;

  var tabsHtml = multi ? (
    '<div class="coupon-tabs" style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">' +
      cards.map(function(c, idx){
        return '<button type="button" class="tbtn coupon-tab-btn" data-idx="'+idx+'">'+c.slotId+'</button>';
      }).join('') +
    '</div>'
  ) : '';

  var overlay = createOverlay(
    '<div class="popup-panel" style="width:'+(COUPON_DISPLAY_W+420)+'px;">'+
      '<div class="popup-head"><span>確認券樣</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body" style="display:flex;gap:16px;">'+
        '<div style="width:360px;flex:none;">'+
          tabsHtml+
          '<div class="field"><label id="coupon-active-label">LOGO</label>'+
            '<div id="coupon-logo-box" class="shadow-slot" style="width:64px;height:64px;padding:0;border:none;cursor:pointer;">'+
              '<div class="shadow-slot-thumb" style="width:100%;height:100%;" id="coupon-logo-thumb-wrap">'+
                '<div class="shadow-slot-plus" id="coupon-logo-plus">＋</div>'+
              '</div>'+
            '</div>'+
            '<input type="file" accept="image/*" id="coupon-logo-input" style="display:none;">'+
          '</div>'+
          '<div class="field"><label>顏色</label>'+
            '<input type="color" id="coupon-color-input" class="coupon-color-input">'+
          '</div>'+
          '<div class="field"><label>文字</label>'+
            '<input type="text" id="coupon-text-input" style="width:100%;">'+
          '</div>'+
          '<div class="hint">這個槽位這次工單標記要做成「券樣」（LOGO疊在券框上）。改好後右邊會即時預覽，多個槽位可以用上面頁籤切換分別調整。右邊畫面上可以直接拖曳LOGO調整位置、滾輪縮放大小。</div>'+
        '</div>'+
        '<div>'+
          '<div class="pos-editor-stage" id="coupon-preview-stage" style="width:'+COUPON_DISPLAY_W+'px;height:'+displayH+'px;">'+
            '<canvas id="coupon-preview-canvas" width="'+TW+'" height="'+TH+'" style="width:'+COUPON_DISPLAY_W+'px;height:'+displayH+'px;"></canvas>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="popup-foot">'+
        '<button class="tbtn primary" id="coupon-confirm-btn">確認並套用</button>'+
      '</div>'+
    '</div>'
  );

  var logoInput = overlay.querySelector('#coupon-logo-input');
  var logoBox = overlay.querySelector('#coupon-logo-box');
  var logoThumbWrap = overlay.querySelector('#coupon-logo-thumb-wrap');
  var colorInput = overlay.querySelector('#coupon-color-input');
  var textInput = overlay.querySelector('#coupon-text-input');
  var activeLabel = overlay.querySelector('#coupon-active-label');
  var canvas = overlay.querySelector('#coupon-preview-canvas');
  var previewStage = overlay.querySelector('#coupon-preview-stage');
  var confirmBtn = overlay.querySelector('#coupon-confirm-btn');

  function renderPreview(){
    var c = cards[activeIdx];
    if(!window.CouponTicket) return;
    window.CouponTicket.composeTicket({
      targetColor: c.color,
      logoImg: c.logoImg,
      text: c.text,
      logoOffsetX: c.logoOffsetX,
      logoOffsetY: c.logoOffsetY,
      logoScale: c.logoScale,
      rotateDeg: TICKET_ROTATE_BY_SLOT[c.slotId]
    }).then(function(dataUrl){
      couponLoadImageFromDataUrl(dataUrl).then(function(img){
        /* 券樣現在會預先烤進傾斜角度(見coupon-ticket.js的
           TICKET_ROTATE_BY_SLOT/rotateDeg)，輸出圖片的實際尺寸會比模板
           原生尺寸大一點、寬高比也會跟著角度改變(角度越大，外接矩形越接近
           正方形)——這裡除了讓畫布的實際運算解析度跟著圖片真實尺寸走，
           CSS「顯示」尺寸(canvas.style.width/height)也要跟著這張圖真正的
           寬高比重新算，不能維持popup剛建立時、用舊模板802:312算好的固定
           displayH——不然運算解析度雖然沒有變形，但顯示出來的畫面還是會
           被硬塞進錯的寬高比框框裡壓扁/拉伸（使用者反映角度轉比較大時
           很明顯，例如商品2(中)那組5度轉出來的圖比較接近正方形，硬塞進
           原本細長的顯示框就會被壓扁）。 */
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        var dispH = Math.round(COUPON_DISPLAY_W * img.naturalHeight / img.naturalWidth);
        canvas.style.width = COUPON_DISPLAY_W + 'px';
        canvas.style.height = dispH + 'px';
        /* 外層容器(.pos-editor-stage)本身也是固定高度+overflow:hidden，
           只改畫布尺寸不夠——角度大的槽位（外接矩形比較高）畫布會比容器
           高，容器會把超出的部分直接裁掉（不是壓扁，但一樣看不到完整的
           券），這裡連容器高度也一起跟著這張圖真正的顯示高度調整。 */
        if(previewStage) previewStage.style.height = dispH + 'px';
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      });
    }).catch(function(err){
      console.error('[coupon-ticket-popup] 預覽合成失敗：', err);
    });
  }

  /* LOGO拖曳移動＋滾輪縮放：直接在預覽畫布上操作，跟陰影編輯1200畫布同一種
     互動語言（拖曳=移動、滾輪=縮放）。畫布顯示尺寸(COUPON_DISPLAY_W)跟畫布
     實際運算解析度(TW=802)不一樣，滑鼠移動量要換算成模板原生像素才能正確
     對應。offsetX/offsetY套用在「旋轉後的本地座標系」（見coupon-ticket.js
     的drawLogoFitted），所以直接用滑鼠位移量即可，不用額外反旋轉換算——
     LOGO_BOX_ROTATION_DEG目前角度很小(4度)，這樣拖曳的手感已經很自然。 */
  var _dragState = null;
  canvas.style.cursor = 'grab';
  canvas.addEventListener('mousedown', function(e){
    var c = cards[activeIdx];
    if(!c.logoImg) return;
    _dragState = { startX: e.clientX, startY: e.clientY, offX: c.logoOffsetX, offY: c.logoOffsetY };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('mousemove', function(e){
    if(!_dragState) return;
    var c = cards[activeIdx];
    var rect = canvas.getBoundingClientRect();
    var scaleFactor = TW / rect.width;
    c.logoOffsetX = _dragState.offX + (e.clientX - _dragState.startX) * scaleFactor;
    c.logoOffsetY = _dragState.offY + (e.clientY - _dragState.startY) * scaleFactor;
    renderPreview();
  });
  window.addEventListener('mouseup', function(){
    if(_dragState){ _dragState = null; canvas.style.cursor = 'grab'; }
  });
  canvas.addEventListener('wheel', function(e){
    var c = cards[activeIdx];
    if(!c.logoImg) return;
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.08 : 1/1.08;
    c.logoScale = Math.max(0.3, Math.min(4, c.logoScale * factor));
    renderPreview();
  }, { passive: false });

  /* LOGO欄位比照陰影編輯popup「素材清單」縮圖的互動方式（使用者反映原本的
     原生<input type=file>「選擇檔案／未選擇任何檔案」文字，跟已經帶入的
     縮圖同時出現很多餘、容易誤會成沒吃到素材）：
     空的時候顯示＋(點了觸發上傳)，有圖時顯示縮圖+右上角×(點了清掉這張LOGO
     退回空的樣子)，不再顯示原生file input的文字部分。 */
  function renderLogoBox(){
    var c = cards[activeIdx];
    if(c.logoImg){
      logoThumbWrap.innerHTML = '<img src="'+c.logoImg.src+'" style="object-fit:contain;background:#fff;"><div class="shadow-slot-del" id="coupon-logo-del">×</div>';
      logoThumbWrap.parentElement.classList.add('filled');
      var delBtn = logoThumbWrap.querySelector('#coupon-logo-del');
      delBtn.addEventListener('click', function(e){
        e.stopPropagation();
        loadLogoForCard(activeIdx, null);
      });
    } else {
      logoThumbWrap.innerHTML = '<div class="shadow-slot-plus">＋</div>';
      logoThumbWrap.parentElement.classList.remove('filled');
    }
  }

  function refreshControlsForActive(){
    var c = cards[activeIdx];
    activeLabel.textContent = multi ? ('LOGO（'+c.slotId+'）') : 'LOGO';
    colorInput.value = couponRgbToHex(c.color);
    textInput.value = c.text;
    renderLogoBox();
    if(multi){
      overlay.querySelectorAll('.coupon-tab-btn').forEach(function(btn, idx){
        btn.classList.toggle('primary', idx === activeIdx);
      });
    }
    renderPreview();
  }

  function loadLogoForCard(idx, file){
    var c = cards[idx];
    if(!file){
      c.logoImg = null; c.logoDataUrl = null;
      c.logoOffsetX = 0; c.logoOffsetY = 0; c.logoScale = 1;
      if(idx === activeIdx) refreshControlsForActive();
      return;
    }
    couponReadFileAsImage(file).then(function(img){
      c.logoImg = img;
      c.logoDataUrl = img.src;
      c.logoOffsetX = 0; c.logoOffsetY = 0; c.logoScale = 1; // 換一張新LOGO，位置/縮放重新歸零，不要沿用上一張圖調整過的結果
      if(window.CouponTicket){
        c.color = window.CouponTicket.suggestColorFromLogo(img);
      }
      if(idx === activeIdx) refreshControlsForActive();
    }).catch(function(err){
      console.error('[coupon-ticket-popup] LOGO載入失敗：', err);
    });
  }

  logoBox.addEventListener('click', function(){ logoInput.click(); });

  // 初始化每張卡片：優先用先前存好的logoDataUrl(重新編輯的情況)，否則用曝品表比對到的檔案
  cards.forEach(function(c, idx){
    if(c.logoDataUrl){
      couponLoadImageFromDataUrl(c.logoDataUrl).then(function(img){
        c.logoImg = img;
        if(idx === activeIdx) refreshControlsForActive();
      });
    } else if(c.pendingLogoFile){
      loadLogoForCard(idx, c.pendingLogoFile);
    }
  });

  if(multi){
    overlay.querySelectorAll('.coupon-tab-btn').forEach(function(btn){
      btn.addEventListener('click', function(){

        activeIdx = Number(btn.getAttribute('data-idx'));
        refreshControlsForActive();
      });
    });
  }

  logoInput.onchange = function(){
    var file = logoInput.files && logoInput.files[0];
    if(file) loadLogoForCard(activeIdx, file);
  };
  colorInput.oninput = function(){
    cards[activeIdx].color = couponHexToRgb(colorInput.value);
    renderPreview();
  };
  textInput.oninput = function(){
    cards[activeIdx].text = textInput.value;
    renderPreview();
  };

  refreshControlsForActive();

  confirmBtn.onclick = function(){
    if(!window.CouponTicket){ closePopup(); return; }
    confirmBtn.disabled = true;
    confirmBtn.textContent = '合成中…';
    Promise.all(cards.map(function(c){
      return window.CouponTicket.composeTicket({
        targetColor: c.color,
        logoImg: c.logoImg,
        text: c.text,
        logoOffsetX: c.logoOffsetX,
        logoOffsetY: c.logoOffsetY,
        logoScale: c.logoScale,
        rotateDeg: TICKET_ROTATE_BY_SLOT[c.slotId]
      }).then(function(dataUrl){
        return {
          slotId: c.slotId, dataUrl: dataUrl, logoDataUrl: c.logoDataUrl, color: c.color, text: c.text,
          logoOffsetX: c.logoOffsetX, logoOffsetY: c.logoOffsetY, logoScale: c.logoScale
        };
      });
    })).then(function(results){
      closePopup();
      onConfirm(results);
    }).catch(function(err){
      console.error('[coupon-ticket-popup] 合成失敗：', err);
      alert('券樣合成失敗：'+err.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = '確認並套用';
    });
  };
}

/* ── 匯入流程用：可能同時有多個票券化槽位 ── */
function openCouponTicketPopup(ticketSlotIds, matched, onDone){
  var cardsSpec = ticketSlotIds.map(function(slotId){
    return { slotId: slotId, logoFile: matched[slotId] || null };
  });
  _openCouponTicketInternal(cardsSpec, function(results){
    results.forEach(function(r){
      var file = couponDataUrlToFile(r.dataUrl, r.slotId+'-券樣.png');
      /* 把這次用的LOGO/顏色/文字一併掛在File物件上（跟__importRatio同一招），
         proceedToShadowFromImport()讀出來存進S.shadowSlots[slotId].ticketMeta，
         之後使用者用「票券編輯」重新打開時才有東西可以還原，不用從零開始。
         ★ 這裡也一定要補上__importIsTicket=true——原本matched[slotId]上
         (比對到的"摩斯LOGO.png"那個檔案)已經有editor-import.js標記好的
         __importIsTicket，但這裡整個換成一個全新的File物件(合成好的券樣圖)，
         舊檔案上的標記不會自動帶過來，漏掉這行會導致S.shadowSlots[slotId].isTicket
         最後變成false——連鎖造成「票券編輯」按鈕不出現、圖層排序「券樣優先」
         規則不生效、素材縮圖裁切異常，三個問題都是同一個根因。 */
      file.__ticketMeta = { logoDataUrl: r.logoDataUrl, color: r.color, text: r.text, logoOffsetX: r.logoOffsetX, logoOffsetY: r.logoOffsetY, logoScale: r.logoScale };
      file.__importIsTicket = true;
      matched[r.slotId] = file;
    });
    if(onDone) onDone();
  });
}

/* ── 從已開啟的1200畫布popup裡，針對單一槽位重新編輯 ── */
function openCouponTicketEditForSlot(slotId){
  var rec = window.S && S.shadowSlots && S.shadowSlots[slotId];
  var meta = rec && rec.ticketMeta;
  var cardsSpec = [{
    slotId: slotId,
    logoDataUrl: meta && meta.logoDataUrl,
    color: meta && meta.color,
    text: meta && meta.text,
    logoOffsetX: meta && meta.logoOffsetX,
    logoOffsetY: meta && meta.logoOffsetY,
    logoScale: meta && meta.logoScale
  }];
  _openCouponTicketInternal(cardsSpec, function(results){
    var r = results[0];
    var prevRatio = rec && rec.ratio;
    applyShadowSlotDataUrl(slotId, 'product', r.dataUrl, prevRatio, true);
    S.shadowSlots[slotId].ticketMeta = { logoDataUrl: r.logoDataUrl, color: r.color, text: r.text, logoOffsetX: r.logoOffsetX, logoOffsetY: r.logoOffsetY, logoScale: r.logoScale };
    /* ★重要：createOverlay()全域只有一個popup插槽，開券樣popup時會把當時
       開著的1200畫布popup整個從DOM移除(不是疊在上面)，所以這裡不能只呼叫
       renderSlotBar()——那個畫面已經不存在了。要重新呼叫openShadowPopup()
       把1200畫布popup整個重建一次，畫面才會「確認券樣→回到1200畫布」，
       不是「確認券樣→直接跳回LPBN等主畫布」。重建時會照著目前的
       S.shadowSlots/S.shadowCombo/S.shadowOrder重新畫，剛改好的券樣圖片
       自然就在裡面，使用者確認位置沒問題後再按一次「確認並套用」才會真的
       烤進S.assets.host（跟原本的行為一致，只是不會少一步）。 */
    openShadowPopup(function(){ renderAll(); });
  });
}
