'use strict';
/* MSBN模組 —— 蝦皮家居-寢具「公版一」：1200x150畫布，三張品牌LOGO並排卡片。

   跟其他版位的logo模組(modules/logo-module.js)不一樣：那邊是「框跟著圖片
   比例算」，這裡是「框永遠固定(卡片位置/大小寫死在positions.json)，使用者
   上傳的LOGO在框裡可以自己滾輪縮放、拖曳移動，超出框的部分裁掉」——框不會
   變，圖片在框裡動。互動邏輯（滾輪/拖曳/選取框/點空框上傳）寫在
   js/msbn-logo-interaction.js，這支檔案只負責「照目前的縮放/位移狀態，把
   畫面畫出來」，跟core.js其他模組一樣單純。

   msbnBackground另外拆一個模組（不共用modules/background-module.js）：
   MSBN公版一的背景是固定的淺灰卡其色(#D9D8D1)，跟其他版位共用的
   state.bg.seedHex(活動主色，例如蝦皮橘)是兩件事，共用會被套錯顏色。 */
window.Modules = window.Modules || {};

/* 跟modules/background-module.js完全同一套「先試圖片、沒有就退回純色」的
   模式，只是圖片路徑改放backgrounds/msbn/這個子資料夾（跟configs/layouts/
   msbn/一樣，MSBN自己的東西集中放一起，不跟其他版位的backgrounds/xxx.jpg
   混在同一層）。
   放置規則：這個版型(layoutId，例如07_msbn=公版一)的背景圖放在
     backgrounds/msbn/07_msbn.jpg（找不到會自動試.png）
   同一個版型底下的MSBN1、MSBN2...是同一份設計、只是內容不同，共用同一張
   背景圖，不用每個版本各存一張；只有「新增一個真的不一樣版型」(例如公版二，
   configs/layouts/msbn/07_msbn_v2.json)時，才需要另外放一張
   backgrounds/msbn/07_msbn_v2.jpg。
   目前沒有放任何檔案進backgrounds/msbn/，所以會自動退回positions.json的
   bgColor純色（#D9D8D1）——這是刻意的預設行為，不是漏放檔案，之後有實際
   設計的背景圖再放進去就會自動生效，不用改任何程式碼。 */
var _msbnBgCache = {}; // layoutId(真正的版型id，動態複製實例會查回本尊) -> {status, img}

function _msbnTryLoadBg(fileId){
  var entry = { status:'loading', img:null };
  _msbnBgCache[fileId] = entry;
  var img = new Image();
  img.onload = function(){
    entry.status = 'loaded';
    entry.img = img;
    if(typeof window.renderAll === 'function') window.renderAll();
  };
  img.onerror = function(){
    if(!entry._triedPng){
      entry._triedPng = true;
      img.src = 'backgrounds/msbn/'+fileId+'.png';
    } else {
      entry.status = 'missing';
    }
  };
  img.src = 'backgrounds/msbn/'+fileId+'.jpg';
}

function _msbnDrawBgCover(ctx, img, w, h){
  var ir = img.naturalWidth / img.naturalHeight;
  var cr = w / h;
  var sx, sy, sw, sh;
  if(ir > cr){ sh = img.naturalHeight; sw = sh * cr; sx = (img.naturalWidth - sw) / 2; sy = 0; }
  else { sw = img.naturalWidth; sh = sw / cr; sx = 0; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
}

window.Modules.msbnBackground = {
  draw: function(ctx, layer, state, layoutMeta){
    var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h;
    var layoutId = layoutMeta.layoutId;
    var fileId = (window.LAYOUT_ALIAS_BASE && window.LAYOUT_ALIAS_BASE[layoutId]) || layoutId || '07_msbn';

    var entry = _msbnBgCache[fileId];
    if(!entry){ _msbnTryLoadBg(fileId); entry = _msbnBgCache[fileId]; }

    if(entry && entry.status === 'loaded'){
      _msbnDrawBgCover(ctx, entry.img, w, h);
      return;
    }
    var color = (layoutMeta.positions && layoutMeta.positions.bgColor) || '#D9D8D1';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }
};

function _msbnRoundRectPath(ctx, x, y, w, h, r){
  var rr = Math.max(0, Math.min(r, w/2, h/2));
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y,   x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x,   y+h, rr);
  ctx.arcTo(x,   y+h, x,   y,   rr);
  ctx.arcTo(x,   y,   x+w, y,   rr);
  ctx.closePath();
}

/* 只有上方兩個角是圓角、下方兩個角是直角——對應實際卡片設計：上左/上右
   20px圓角，下左/下右0(直角)。跟_msbnRoundRectPath()分開寫一個函式，
   不是共用一個「四角各自可傳不同半徑」的通用版，是因為目前只有這一種
   形狀需要，不需要為了還沒發生的需求先做成通用參數。 */
function _msbnTopRoundRectPath(ctx, x, y, w, h, r){
  var rr = Math.max(0, Math.min(r, w/2, h/2));
  ctx.beginPath();
  ctx.moveTo(x, y+h);           // 左下角(直角)
  ctx.lineTo(x, y+rr);          // 沿左邊往上
  ctx.arcTo(x, y, x+rr, y, rr); // 左上角(圓角)
  ctx.lineTo(x+w-rr, y);        // 沿上邊往右
  ctx.arcTo(x+w, y, x+w, y+rr, rr); // 右上角(圓角)
  ctx.lineTo(x+w, y+h);         // 沿右邊往下到右下角(直角)
  ctx.closePath();              // 沿下邊直線回到左下角
}

/* 給互動層(js/msbn-logo-interaction.js)查某個slot的卡片/LOGO框實際像素座標
   ——直接讀同一份bundle.positions，跟這裡畫圖用的是同一份資料來源，兩邊
   永遠對得起來，不會各自維護一份、改一邊忘記改另一邊。
   fallback：同一個版型(公版一)底下MSBN1、MSBN2...實例共用一模一樣的
   positions資料，如果這個實例自己的bundle還沒被buildCanvasArea()載入過
   （例如使用者還沒切去msbn那個分頁，工單匯入當下就要比對素材尺寸），
   退回用本尊'07_msbn'的bundle算，數字保證一樣，不會算錯。 */
function getMsbnSlotBox(layoutId, slotKey){
  var all = window.bundles || {};
  var bundle = all[layoutId] || all['07_msbn'];
  var positions = bundle && bundle.positions;
  var slot = positions && positions.msbnSlots && positions.msbnSlots[slotKey];
  if(!slot) return null;
  return { card: slot.card, logoBox: slot.logoBox };
}
window.getMsbnSlotBox = getMsbnSlotBox;

window.Modules.msbnLogoSlot = {
  draw: function(ctx, layer, state, layoutMeta){
    var slotKey = layer.slot;
    var positions = layoutMeta.positions || {};
    var slot = positions.msbnSlots && positions.msbnSlots[slotKey];
    if(!slot) return;

    var style = positions.cardStyle || {};
    var innerRadius = (style.innerRadius != null) ? style.innerRadius : 14;
    var box = slot.logoBox;

    var layoutId = layoutMeta.layoutId;
    var slotState = state.msbnLogos && state.msbnLogos[layoutId] && state.msbnLogos[layoutId][slotKey];
    var img = slotState && slotState.img;
    var imgReady = img instanceof HTMLImageElement && img.complete && img.naturalWidth;

    /* 2026-08確認：使用者現在用的是真正的背景圖(backgrounds/msbn/07_msbn.jpg，
       由msbnBackground模組畫)，卡片本身的視覺(白底/咖啡色框)已經畫在那張圖
       裡了——這裡不再另外畫卡片外框、不畫底色填充、沒圖片時也不畫任何
       佔位提示文字或外框線。這個模組現在只做一件事：有上傳圖片的話，
       裁切到LOGO框範圍內把圖畫上去；完全沒有圖片就什麼都不畫，讓底下
       的背景圖直接透出來。裁切範圍(clip)還是保留，純粹是為了「使用者
       縮放/拖曳LOGO時，超出框的部分要被裁掉」這個功能性需求，不是為了
       畫出視覺上的框線。 */
    if(!imgReady) return;

    ctx.save();
    _msbnTopRoundRectPath(ctx, box.x, box.y, box.w, box.h, innerRadius);
    ctx.clip();
    var scale = slotState.scale || 1;
    var offX = slotState.offX || 0;
    var offY = slotState.offY || 0;
    var iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
    var cx = box.x + box.w/2 + offX;
    var cy = box.y + box.h/2 + offY;
    ctx.drawImage(img, cx-iw/2, cy-ih/2, iw, ih);
    ctx.restore();
  }
};
