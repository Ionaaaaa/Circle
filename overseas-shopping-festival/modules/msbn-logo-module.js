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
   20px圓角，下左/下右0(直角)。跟_msbnRoundRectPathCorners()分開寫一個
   函式保留著(舊呼叫點/其他地方可能還在用)，但msbnLogoSlot.draw()現在
   改呼叫下面通用版的_msbnRoundRectPathCorners()。 */
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

/* 2026-08新增：通用版——哪幾個角要圓角，用corners陣列指定('tl'/'tr'/'br'/
   'bl')，其餘角維持直角。原本_msbnTopRoundRectPath()寫死「只有上面兩角
   圓角」，公版五的「圖片範圍」(左側大圖)實際需求是左邊兩角(左上+左下)
   圓角、右邊維持直角——不是「上面」而是「左邊」，原本那支函式的假設不
   適用，改成這個通用版，沒指定corners時預設['tl','tr']，行為跟原本
   _msbnTopRoundRectPath()完全一樣，不影響公版一/二/三/四/六。 */
function _msbnRoundRectPathCorners(ctx, x, y, w, h, r, corners){
  var rr = Math.max(0, Math.min(r, w/2, h/2));
  var has = function(c){ return corners.indexOf(c) !== -1; };
  ctx.beginPath();
  ctx.moveTo(x + (has('tl')?rr:0), y);
  ctx.lineTo(x+w-(has('tr')?rr:0), y);
  if(has('tr')) ctx.arcTo(x+w, y, x+w, y+rr, rr);
  ctx.lineTo(x+w, y+h-(has('br')?rr:0));
  if(has('br')) ctx.arcTo(x+w, y+h, x+w-rr, y+h, rr);
  ctx.lineTo(x+(has('bl')?rr:0), y+h);
  if(has('bl')) ctx.arcTo(x, y+h, x, y+h-rr, rr);
  ctx.lineTo(x, y+(has('tl')?rr:0));
  if(has('tl')) ctx.arcTo(x, y, x+rr, y, rr);
  ctx.closePath();
}

/* 2026-08新增：圓形裁切——公版五的LOGO框使用者要求是圓形(不是圓角矩形)，
   取box的短邊當直徑、置中畫一個圓，不管box本身是不是正方形都能用。 */
function _msbnCirclePath(ctx, x, y, w, h){
  var cx = x+w/2, cy = y+h/2, r = Math.min(w,h)/2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.closePath();
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
    if(slot.shape === 'circle'){
      _msbnCirclePath(ctx, box.x, box.y, box.w, box.h);
    } else {
      var corners = slot.roundCorners || ['tl','tr','bl','br']; // 沒指定的話4個角都圓角(沿用跟上方兩角一樣的innerRadius數值)，個別版位有自己指定roundCorners的話照舊
      _msbnRoundRectPathCorners(ctx, box.x, box.y, box.w, box.h, innerRadius, corners);
    }
    ctx.clip();
    /* 2026-08修正：bgColor(PNG固定白色／JPG抓四邊取樣色，見
       js/editor-main.js的loadMsbnLogoFileInto())原本算出來就沒被用過——
       使用者可以把LOGO縮小到比框還小，縮小後露出來的框內背景如果什麼都
       不畫，會直接透出msbnBackground畫的底圖，深色底圖搭配縮小的白底
       LOGO會很突兀。這裡先鋪一層底色，再畫圖片，框內縮小後露出來的部分
       就會是這張圖自己的底色，不會透出背景圖。 */
    if(slotState.bgColor){
      ctx.fillStyle = slotState.bgColor;
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
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

/* 2026-08新增：公版二~六的可編輯文字（文案/品牌名稱/折扣文案/系統字等）。
   跟modules/text-module.js（S.text，會連動的那組標題/副標/日期）是兩件
   不相干的東西——這裡讀的是S.msbnTexts[instanceId][slot]，每個MSBN實例
   各自獨立、不跟任何其他版位同步，使用者直接在畫布上點這塊文字區域就能
   打字編輯（互動邏輯見js/msbn-text-interaction.js，這支檔案只負責畫）。
   沒有使用者輸入內容時，畫positions.json裡設定的預設佔位文字(default)，
   等使用者實際點擊輸入內容後才會換成真正的文案——這樣使用者一眼就能
   看出「這裡可以打字、目前還是預設值」，跟其他版位的文字欄位邏輯一致。
   位置規則：x,y,w,h是這個文字方塊的邊界，水平置中/靠左/靠右看align，
   垂直一律置中(vertical middle)，不像text-module.js那樣算ascent/
   baseline——這裡的文字框比較單純，用ctx.textBaseline='middle'配合方塊
   垂直中點就能對齊得夠準，不需要那麼精細的算法。 */
window.Modules.msbnText = {
  draw: function(ctx, layer, state, layoutMeta){
    var slot = layer.slot;
    var positions = layoutMeta.positions || {};
    var spec = positions.msbnTexts && positions.msbnTexts[slot];
    if(!spec) return;

    var layoutId = layoutMeta.layoutId;

    /* 2026-08新增：這個欄位如果正在被使用者點擊編輯中(textarea蓋在上面)，
       canvas這裡完全不畫，讓textarea自己顯示打字內容就好——不然兩層文字
       疊在一起，字型渲染細節本來就對不齊，會變成使用者反映的「兩層文案
       疊在一起」糊字效果。見js/msbn-text-interaction.js的
       isMsbnTextBeingEdited()。 */
    if(typeof window.isMsbnTextBeingEdited === 'function' && window.isMsbnTextBeingEdited(layoutId, slot)) return;

    var stored = state.msbnTexts && state.msbnTexts[layoutId] && state.msbnTexts[layoutId][slot];
    var str = (stored !== undefined && stored !== null && stored !== '') ? stored : (spec.default || '');
    if(!str) return;

    ctx.save();
    ctx.font = (spec.fontWeight || '400') + ' ' + spec.fontSizePx + 'px "ShopeeNoto","Noto Sans TC",sans-serif';
    ctx.fillStyle = spec.color || '#000000';
    var align = spec.align || 'center';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    var drawX = align === 'left' ? spec.x : (align === 'right' ? (spec.x + spec.w) : (spec.x + spec.w/2));
    var drawY = spec.y + spec.h/2;
    ctx.fillText(str, drawX, drawY);
    ctx.restore();
  }
};

/* 給互動層(js/msbn-text-interaction.js)查某個slot的文字框實際像素座標——
   跟getMsbnSlotBox()同一個道理，直接讀同一份bundle.positions，兩邊資料
   來源永遠一致。 */
function getMsbnTextBox(layoutId, slotKey){
  var all = window.bundles || {};
  var bundle = all[layoutId] || all['07_msbn'];
  var positions = bundle && bundle.positions;
  var spec = positions && positions.msbnTexts && positions.msbnTexts[slotKey];
  if(!spec) return null;
  return spec;
}
window.getMsbnTextBox = getMsbnTextBox;
