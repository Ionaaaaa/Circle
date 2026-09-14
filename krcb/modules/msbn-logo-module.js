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
var _msbnBgCache = {}; // cacheKey(fileId+':'+version) -> {status, img}

/* 2026-08(KRCB)：跟modules/background-module.js同一套版本(A/B/C...)資料夾
   規則——backgrounds/msbn/{版本}/{fileId}.jpg，每個版本各自一個資料夾
   (backgrounds/msbn/A/、backgrounds/msbn/B/...)。找不到版本化路徑時，
   會退回試「沒有版本資料夾」的舊路徑backgrounds/msbn/{fileId}.jpg。 */
function _msbnTryLoadBg(fileId, version, cacheKey){
  var entry = { status:'loading', img:null };
  _msbnBgCache[cacheKey] = entry;
  var img = new Image();
  var candidates = [
    'backgrounds/msbn/'+version+'/'+fileId+'.jpg',
    'backgrounds/msbn/'+version+'/'+fileId+'.png',
    'backgrounds/msbn/'+fileId+'.jpg',
    'backgrounds/msbn/'+fileId+'.png'
  ];
  var idx = 0;
  function tryNext(){
    if(idx >= candidates.length){ entry.status = 'missing'; return; }
    img.src = candidates[idx++];
  }
  img.onload = function(){
    entry.status = 'loaded';
    entry.img = img;
    if(typeof window.renderAll === 'function') window.renderAll();
  };
  img.onerror = tryNext;
  tryNext();
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
    var version = (typeof getBgVersion === 'function') ? getBgVersion() : 'A';
    var cacheKey = fileId + ':' + version;

    var entry = _msbnBgCache[cacheKey];
    if(!entry){ _msbnTryLoadBg(fileId, version, cacheKey); entry = _msbnBgCache[cacheKey]; }

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
  return { card: slot.card, logoBox: slot.logoBox, noBgFill: !!slot.noBgFill };
}
window.getMsbnSlotBox = getMsbnSlotBox;

/* 2026-08(KRCB)新增：Excel匯入商品/ICON圖片時，msbn分頁通常還沒被使用者
   實際切換過去看過，window.bundles裡還沒有對應版型的positions資料(要等
   buildCanvasArea()真的畫過那個分頁一次才會非同步載入進來)——這種情況下
   getMsbnSlotBox()查不到框，如果沒有備援，呼叫端只能退回用「圖片自己的
   原始尺寸」當框(等於完全不縮放)，商品/ICON匯入進來就會是原始像素大小，
   遠遠超出畫布上該有的作圖範圍——這是使用者回報「商品放進去太大」的
   根本原因。
   這裡準備一份跟各版位-positions.json數字一模一樣的靜態備援表，
   js/editor-main.js的loadMsbnLogoFileInto()查不到即時的bundle資料時，
   改查這份表，保證即使msbn分頁還沒被載入過，contain-fit縮放也一定正確。
   數字必須手動跟對應的-positions.json保持一致——之後如果調整了正式
   positions.json裡的logoBox座標，這裡也要跟著更新，兩邊沒有自動同步
   機制。 */
var MSBN_SLOT_BOX_FALLBACK = {
  '07_msbn': {
    host: { x: 591, y: 44, w: 483, h: 282 }
  },
  '07_msbn_v2': {
    host1: { x: 338, y: 39, w: 213, h: 296 },
    host2: { x: 896, y: 39, w: 216, h: 296 }
  },
  'subzone_app': {
    icon1: { x: 34,  y: 39, w: 341, h: 87 },
    icon2: { x: 430, y: 39, w: 341, h: 87 },
    icon3: { x: 825, y: 39, w: 341, h: 87 }
  },
  'subzone_pc': {
    icon1: { x: 34,  y: 32, w: 341, h: 58 },
    icon2: { x: 430, y: 32, w: 341, h: 58 },
    icon3: { x: 825, y: 32, w: 341, h: 58 }
  }
};
function getMsbnSlotBoxFallback(realLayoutId, slotKey){
  var table = MSBN_SLOT_BOX_FALLBACK[realLayoutId];
  return table && table[slotKey];
}
window.getMsbnSlotBoxFallback = getMsbnSlotBoxFallback;

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

    /* 2026-08(KRCB)新增：商品類欄位(host/host1/host2...)點擊後其實是跳
       「編輯商品」1200畫布合成工具(見js/shadow-system/shadow-popup.js的
       openMsbnHostComposePopup())，不是單純上傳一張圖——使用者反映需要
       一個小圖標提示「點這裡可以開陰影編輯器」，不然不容易發現。畫一個
       小圓形徽章＋鉛筆圖示在框的右下角(2026-08再調整：原本畫在右上角，
       使用者反映改到右下角)，不管這格目前是空的還是已經有圖都會顯示
       (空的時候也要讓使用者知道點下去是進合成工具，不是單純選檔案)。
       2026-08再調整：副區的ICON欄位(icon1/icon2/icon3)也要有同樣的提示——
       雖然點下去跳的是ICON圖庫popup(見js/icon-library.js)，不是這套
       1200畫布合成工具，但同樣是「點擊會跳出選擇視窗」，使用者一樣需要
       知道可以點擊，只是提示圖示所在的判斷式要涵蓋host跟icon兩種開頭。
       2026-09修正「鉛筆icon被匯出到成品圖檔裡」：這顆icon純粹是編輯器
       操作提示，不是版面設計內容，但因為是這支模組自己畫在canvas上(不是
       renderAll()疊加的獨立覆蓋層)，js/editor-main.js的renderLayoutClean()
       原本「匯出前重畫一次乾淨版本」只清得掉選取框/控制點那種疊加層，
       清不掉這種畫在模組本體裡的東西——改成用renderLayoutClean()額外
       設定的state.isExport旗標判斷，匯出流程呼叫時這顆icon直接不畫，
       畫面上編輯時則照常顯示，行為不受影響。 */
    if(!state.isExport && (slotKey.indexOf('host') === 0 || slotKey.indexOf('icon') === 0)){
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
    }

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
       就會是這張圖自己的底色，不會透出背景圖。
       2026-08再修正：這個底色填充是給「LOGO卡片」設計的(卡片本身視覺上
       是一塊實體的白/淺色底，LOGO縮小後露出卡片底色很合理)——公版一新版
       的host欄位不是LOGO卡片，是使用者上傳「商品透明底」照片的作圖區，
       跟HBN/DD Card的host行為要一致：商品直接合成在背景圖上面，鏤空/
       透明的部分要讓底下的背景圖透出來，不能鋪一層不透明色塊，那樣會
       把商品照片的透明去背功能整個蓋掉、看起來像個色塊卡片。slot.noBgFill
       ＝true的話跳過這段填色，直接讓背景透出來，行為才會跟host一致。 */
    if(slotState.bgColor && !slot.noBgFill){
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

    /* 2026-08(KRCB)新增：外框(描邊)——目前給MSBN圓形徽章文字用(3px、
       #737fcb)，讓白字在色底上更清楚。用canvas的strokeText先畫一層外框、
       再疊上fillText畫實際文字顏色，是最常見的「文字加外框」做法。
       lineJoin用'round'避免尖角處外框變成銳利的尖刺。只有spec裡有設定
       strokeColor的欄位才會描邊，其他欄位(標題/商品名稱等)沒有設定，
       完全不受影響、行為維持原樣。 */
    var hasStroke = !!spec.strokeColor;
    if(hasStroke){
      ctx.strokeStyle = spec.strokeColor;
      ctx.lineWidth = spec.strokeWidth || 3;
      ctx.lineJoin = 'round';
    }

    if(spec.multiline){
      /* 2026-08(KRCB)新增：跟modules/ar-module.js的AR文案同一套算法——
         使用者手動用Enter/Shift+Enter換行過的話，尊重手動換行結果；沒
         手動換行、內容又有3個字以上，自動對半拆成2行(下面那行字數比上面
         多一個，上輕下重比較符合視覺習慣)。這是給MSBN圓形徽章這種「一個
         欄位、畫面上分兩排顯示」的文字用的，跟其他MSBN單行欄位(標題/
         商品名稱等)分開處理，那些欄位維持原本的單行fillText，不受影響。 */
      var lines = String(str).split('\n').filter(function(l){ return l.length; });
      if(!lines.length){ ctx.restore(); return; }
      if(lines.length === 1 && lines[0].length >= 3){
        var full = lines[0];
        var topLen = Math.floor(full.length/2);
        lines = [full.slice(0,topLen), full.slice(topLen)];
      }
      var lineHeight = spec.fontSizePx * 1.15;
      var totalH = lineHeight * lines.length;
      var startY = spec.y + spec.h/2 - totalH/2 + lineHeight/2;
      lines.forEach(function(line, i){
        if(hasStroke) ctx.strokeText(line, drawX, startY + i*lineHeight);
        ctx.fillText(line, drawX, startY + i*lineHeight);
      });
    } else {
      var drawY = spec.y + spec.h/2;
      if(hasStroke) ctx.strokeText(str, drawX, drawY);
      ctx.fillText(str, drawX, drawY);
    }
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
