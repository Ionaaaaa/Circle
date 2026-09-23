'use strict';
/*
  coupon-popup.js
  ------------------------------------------------------------
  券樣模式(S.exposureStyle==='coupon')的1200x1200編輯popup——跟
  js/shadow-system/shadow-popup.js(商品模式的1200畫布)是同一組「後續
  動作」的姊妹功能：開popup→看預覽→按確認→烤進S.assets.host→broadcast
  顯示在03_c2c_bn(HBN)身上，只是券樣模式host是「滿版鋪畫布」(見
  configs/layouts/03_c2c_bn-positions-coupon.json)，不是商品模式那種
  「只佔畫布右側一小塊」。

  跟商品模式的1200畫布最大差異：這裡完全不需要ShadowLayoutReceiver/
  ShadowPlugin那套拖曳/縮放/陰影引擎——券的位置是固定設計(數字直接來自
  使用者提供的PSD匯出資料，見下面COUPON_IMAGE_POS/COUPON_TEXT_POS)，
  不需要使用者每次調整；使用者要調整的只有「兩段文案的實際內容」，這部分
  直接沿用跟標題/副標/SKBN案型同一套右側文字面板輸入(S.textGroups)，
  不需要在這個popup裡另外做輸入介面——popup開起來只是預覽用。

  券圖片本身是固定素材(不用使用者每次上傳，跟ctaDD/mePageIcon同一套
  「放對檔名就自動套用」邏輯)，使用者確認顏色是跟著這張券圖本身，不需要
  A版/B版分開放，直接放logos/coupons/(不是logos/A或logos/B)。

  ★ 已知範圍外的事(先不做，之後有需要再補)：
    - PSD裡還有一個「KV 拷貝5」的超大模糊光暈圖層(遠遠超出1200x1200畫布
      範圍，疑似背景光暈特效)，這裡先沒有實作，只做券圖本身+兩段文字。
    - 券的位置目前是固定的(照PSD座標)，不像商品那樣可以拖曳調整——如果
      之後需要微調，直接改這支檔案裡的COUPON_IMAGE_POS/COUPON_TEXT_POS
      常數即可，或跟我說要不要做成可拖曳。
    - 「第1張(後)」「第2張(前)」是2026-09使用者提供實際工單(超划算-藍_券.xlsx)
      確認的欄位名稱，跟工單「優惠券」表格K/L欄一致，Excel匯入已經接好
      (見js/editor-import.js的LABELS陣列)。

  2026-09第二版新增：
    1. 券圖本身加一層陰影(直接用canvas內建shadow*屬性，沿著PNG的透明
       輪廓算陰影，不用另外做去背/陰影引擎)，讓券卡看起來有浮起來的
       立體感，跟商品模式的陰影是不同套實作(那套是ShadowPlugin算貼地
       陰影，這裡PSD只給了券卡本身、沒有「地面」的概念，用簡單的
       drop-shadow就夠)。
    2. 券樣模式現在也有自己的兩個錢幣(跟商品模式的S.kvCoinSlots完全分開
       存在S.kvCoinSlotsCoupon，見js/editor-state.js的說明)，預設位置/
       大小刻意跟商品模式不一樣(商品模式的錢幣要閃開商品合成圖，這裡要
       閃開券卡本身)，使用者一樣可以在這個1200畫布裡直接拖曳移動/拖角落
       縮放，邏輯整段參考shadow-popup.js的KV_COIN_系列常數與attachKvCoinPointerEvents，
       但完全自己一份狀態、互不影響。
    3. openCouponPopup()改成可以接收onConfirm callback(跟openShadowPopup()
       同一個模式)——匯入工單流程(js/editor-popups.js的processOneBlock())
       現在券樣模式會直接自動開這個popup(不再誤開商品的1200畫布)，使用者
       按「確認並套用到人物圖層」後才會繼續下一個曝光日期區塊(如果有
       好幾組的話)。
*/

/* 券圖片本身的位置——數字取自使用者提供的PSD匯出資料(券.json的"KV券"
   圖層：x:96,y:254,width:974,height:692,centerX:583)，畫布1200x1200。
   素材放logos/coupons/KV_Coupon.png——檔名如果使用者最後定案不一樣，
   改這裡的COUPON_IMAGE_FILENAME常數就好。 */
var COUPON_IMAGE_FILENAME = 'KV_Coupon.png';
var COUPON_IMAGE_POS = {
  topYPct: 254/1200,
  centerXPct: 583/1200,
  hPct: 692/1200
};

/* 兩段價格文字的位置/字級/顏色/旋轉角度——數字取自使用者提供的PSD匯出
   資料("$300"、"$300_2"這兩個文字圖層，textStyleRanges證實是「前綴字
   (例如"$")小、數字大」的排版)。
   key改成工單「優惠券」表格的實際欄位名稱：「第1張(後)」是位置較上面、
   疊在後面的那張券；「第2張(前)」是位置較下面、疊在前面的那張券。
   2026-09第三版調整：
     - 第1張(後)：往上5px(479→474)。
     - 第2張(前)：旋轉幅度收回來一點(上一版-9改成使用者反映「還是太多」，
       改成-6，比原始-4明顯、但沒有-9那麼誇張)，再往上5px(這是累加在
       上一版已經往上5px的基礎上，759→754→749)。
   frameWidthPx/maxEnlarge：給下面_drawCouponText()的自動縮放用——使用者
   說這兩段文字各自有一個「框」，文字變長要自動縮小塞進去、變短可以稍微
   放大一點。這裡的frameWidthPx是「文字框」寬度(1200畫布像素)，
   baseFontPx/bigFontPx則改成「文字剛好等於這個寬度時」的參考字級。
   ★frameWidthPx目前是照現有字級估算「$300」這種3-4字長度大概的寬度抓的
   估計值(沒有PSD實際文字框尺寸可以對照)，如果實際看起來跟你設的框對不
   起來，直接調這個數字就好(數字越大，字可以撐得越大/越晚開始縮小)，
   不用改_drawCouponText()裡的邏輯。maxEnlarge是「變短的時候最多放大到
   多少倍」的上限(1.12=最多放大12%)，避免文字太短時被放大得不成比例。 */
var COUPON_TEXT_POS = {
  '第1張(後)': {
    xPct: 714/1200, yPct: (479-5)/1200,
    rotationDeg: 5,
    weight: '700',
    color: 'rgb(214,1,28)',
    baseFontPx: 124.1038, bigFontPx: 154.2593,
    frameWidthPx: 384, maxEnlarge: 1.12
  },
  '第2張(前)': {
    xPct: 635.5/1200, yPct: (759-5-5)/1200,
    rotationDeg: -6,
    weight: '700',
    color: 'rgb(214,1,28)',
    baseFontPx: 134.541, bigFontPx: 167.2326,
    frameWidthPx: 410, maxEnlarge: 1.12
  }
};

/* 券卡本身的陰影——直接用canvas內建shadow*屬性，會沿著PNG的透明輪廓算，
   不用另外做去背+貼地陰影那套(那套是給「商品站在地上」用的，券卡是平貼
   構圖，一個簡單的浮起陰影就符合PSD給的視覺)。只包在畫券圖那一段
   save()/restore()之間，不會影響到後面畫的價格文字/錢幣。 */
var COUPON_SHADOW = {
  color: 'rgba(0,0,0,0.42)',
  blur: 36,
  offsetX: 0,
  offsetY: 22
};

var _couponCanvas = null, _couponCtx = null;
var _couponImg = null; // 券圖片本身，載入一次就快取著，不用每次重畫都重新fetch
var _couponPopupOnConfirm = null; // 匯入流程串接用，見openCouponPopup()/exportCouponComposite()

function _loadCouponImage(cb){
  if(_couponImg && _couponImg.complete && _couponImg.naturalWidth){ if(cb) cb(_couponImg); return; }
  var img = new Image();
  img.onload = function(){ _couponImg = img; if(cb) cb(img); };
  img.onerror = function(){ console.warn('[coupon-popup] 讀不到券圖片：logos/coupons/'+COUPON_IMAGE_FILENAME); if(cb) cb(null); };
  img.src = 'logos/coupons/' + COUPON_IMAGE_FILENAME;
}

/* ══════════════════ 券樣模式自己的兩個錢幣 ══════════════════
   跟js/shadow-system/shadow-popup.js的KV_COIN_系列常數與attachKvCoinPointerEvents
   是同一套邏輯(拖曳移動/拖角落等比縮放)，但這裡完全自己一份狀態
   (S.kvCoinSlotsCoupon、不是S.kvCoinSlots)，故意不共用那支檔案的函式——
   兩種模式的錢幣位置本來就要各自獨立調整，分開寫互不干擾，改一邊不會
   不小心影響到另一邊。 */
var COUPON_KV_COIN_KEYS = ['coin1', 'coin2'];
/* 預設位置/大小刻意跟商品模式(KV_COIN_DEFAULTS，見shadow-popup.js)不一樣：
   券卡本身(見COUPON_IMAGE_POS)大約佔滿畫布中央偏上(x:96~1070, y:254~946)，
   這裡把兩個錢幣放到券卡閃不到的四個角落。
   2026-09調整：使用者反映兩個錢幣的位置(哪個放左上/哪個放右下)要對調，
   直接把coin1/coin2的座標互換就好，圖片本身(哪張圖叫coin1/coin2)不受
   影響——只是換兩個「位置」誰用哪個。
   2026-09第二次調整：左邊(coin2)往下20px、右邊(coin1)往上20px，兩個都
   往畫布垂直中心(y=600)靠近一點，但維持「左邊still比較高(y較小)、右邊
   還是比較低(y較大)」的相對關係。
   2026-09第三次調整：使用者直接給座標試看看——coin1(右下)y=1040改成740、
   coin2(左上)y=160改成460，兩個都再往中間靠更多(740跟460離畫布中心600
   分別只差140/-140，比上一版靠近很多)，x/h維持不變。 */
var COUPON_KV_COIN_DEFAULTS = {
  coin1: { x: 1060, y: 740, h: 190 }, // 右下，較大
  coin2: { x: 140, y: 460, h: 140 }   // 左上，較小
};
var _couponCoinSelected = {};
var _couponCoinInteraction = null;

function _couponCoinCfg(coinKey){
  S.kvCoinSlotsCoupon = S.kvCoinSlotsCoupon || {};
  if(!S.kvCoinSlotsCoupon[coinKey]){
    var def = COUPON_KV_COIN_DEFAULTS[coinKey];
    S.kvCoinSlotsCoupon[coinKey] = { x: def.x, y: def.y, h: def.h };
  }
  return S.kvCoinSlotsCoupon[coinKey];
}

/* 寬度永遠依圖片本身長寬比重新算，不單獨存寬度——跟shadow-popup.js的
   _kvCoinBox()同一個理由，換素材時不會走鐘變形。 */
function _couponCoinBox(coinKey){
  var img = S.assets && S.assets[coinKey];
  if(!(img instanceof HTMLImageElement) || !img.complete || !img.naturalWidth) return null;
  var cfg = _couponCoinCfg(coinKey);
  var h = cfg.h;
  var w = h * (img.naturalWidth / img.naturalHeight);
  return { x: cfg.x-w/2, y: cfg.y-h/2, w:w, h:h, cx:cfg.x, cy:cfg.y, img:img, coinKey:coinKey };
}

function drawCouponCoins(ctx){
  COUPON_KV_COIN_KEYS.forEach(function(coinKey){
    var box = _couponCoinBox(coinKey);
    if(!box) return;
    ctx.drawImage(box.img, box.x, box.y, box.w, box.h);
  });
}

function drawCouponCoinSelection(ctx){
  COUPON_KV_COIN_KEYS.forEach(function(coinKey){
    if(!_couponCoinSelected[coinKey]) return;
    var box = _couponCoinBox(coinKey);
    if(!box) return;
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    var hs = 16;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#f59e0b';
    [[box.x,box.y],[box.x+box.w,box.y],[box.x,box.y+box.h],[box.x+box.w,box.y+box.h]].forEach(function(c){
      ctx.beginPath();
      ctx.rect(c[0]-hs/2, c[1]-hs/2, hs, hs);
      ctx.fill(); ctx.stroke();
    });
    ctx.restore();
  });
}

/* 一定要在canvas建立之後、每次開popup都重新綁一次——createOverlay()每次
   都會把canvas整個砍掉重蓋一份新的，理由跟shadow-popup.js的
   attachKvCoinPointerEvents()檔頭說明一樣。 */
function attachCouponCoinPointerEvents(canvas, redraw){
  function toCanvasPos(e){
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
    var p = e.touches ? e.touches[0] : e;
    return { x:(p.clientX-rect.left)*scaleX, y:(p.clientY-rect.top)*scaleY };
  }
  function nearestCorner(p, box, hs){
    var corners = { tl:[box.x,box.y], tr:[box.x+box.w,box.y], bl:[box.x,box.y+box.h], br:[box.x+box.w,box.y+box.h] };
    var best=null, bestDist=hs;
    Object.keys(corners).forEach(function(k){
      var d = Math.max(Math.abs(p.x-corners[k][0]), Math.abs(p.y-corners[k][1]));
      if(d<bestDist){ bestDist=d; best=k; }
    });
    return best;
  }
  function hitTest(p){
    var hs = 22;
    for(var i=COUPON_KV_COIN_KEYS.length-1; i>=0; i--){
      var coinKey = COUPON_KV_COIN_KEYS[i];
      var box = _couponCoinBox(coinKey);
      if(!box) continue;
      var corner = nearestCorner(p, box, hs);
      var inside = p.x>=box.x && p.x<=box.x+box.w && p.y>=box.y && p.y<=box.y+box.h;
      if(corner || inside) return { coinKey:coinKey, box:box, corner:corner };
    }
    return null;
  }

  canvas.addEventListener('pointerdown', function(e){
    var p = toCanvasPos(e);
    var hit = hitTest(p);
    if(!hit){
      var had = COUPON_KV_COIN_KEYS.some(function(k){ return _couponCoinSelected[k]; });
      if(had){ COUPON_KV_COIN_KEYS.forEach(function(k){ _couponCoinSelected[k]=false; }); redraw(); }
      return;
    }
    e.preventDefault();
    COUPON_KV_COIN_KEYS.forEach(function(k){ _couponCoinSelected[k] = (k===hit.coinKey); });
    var cfg = _couponCoinCfg(hit.coinKey);
    _couponCoinInteraction = {
      coinKey: hit.coinKey,
      mode: hit.corner ? 'resize' : 'move',
      startPointer: p,
      startCfg: { x:cfg.x, y:cfg.y, h:cfg.h },
      startBox: hit.box
    };
    try{ canvas.setPointerCapture(e.pointerId); }catch(err){}
    redraw();
  });

  canvas.addEventListener('pointermove', function(e){
    var it = _couponCoinInteraction;
    if(!it) return;
    e.preventDefault();
    var p = toCanvasPos(e);
    var cfg = _couponCoinCfg(it.coinKey);
    if(it.mode === 'move'){
      cfg.x = it.startCfg.x + (p.x - it.startPointer.x);
      cfg.y = it.startCfg.y + (p.y - it.startPointer.y);
    } else {
      var startDist = Math.max(1, Math.hypot(it.startPointer.x-it.startBox.cx, it.startPointer.y-it.startBox.cy));
      var curDist = Math.hypot(p.x-it.startBox.cx, p.y-it.startBox.cy);
      cfg.h = Math.max(10, it.startCfg.h * (curDist/startDist));
    }
    redraw();
  });

  ['pointerup','pointercancel'].forEach(function(evt){
    canvas.addEventListener(evt, function(){ _couponCoinInteraction = null; });
  });
}

/* 畫一段「前綴/後綴字小、數字大」的價格文字，並且整段繞著自己的中心點
   旋轉——直接重用modules/pricetag-module.js的drawMixedSizeText()，這裡
   另外包一層旋轉(translate到中心點→rotate→在原點畫→restore)。基準線
   用bigFontPx的ascent/descent置中，跟pricetag-module.js內部
   centerBaseline()同一個算法，這裡沒有直接呼叫那支(它沒有暴露出來)，
   用同樣公式在地重算一次，不影響既有的小標功能。 */
/* 量測「前綴/後綴字小、數字大」這種混合字級文字，在指定字級下實際會多寬。
   ★2026-09新增千分位需求：不直接用modules/pricetag-module.js既有的
   splitPriceText()/drawMixedSizeText()——那兩支是給商品小標共用的，內部
   切字用純\d+比對數字，不認得逗號，如果直接把「1,000」丟進去，會在第一個
   逗號就把數字切斷(只有"1"被當成大字的digits，",000"變成小字的suffix)，
   沒辦法讓整組「1,000」都用大字顯示。為了不去動、不影響商品版本共用的
   那份程式，這裡在coupon-popup.js自己寫一份切字＋千分位邏輯，只影響券樣
   這兩段金額文字。 */
function _couponSplitPrice(str){
  var m = /^(\D*)(\d+)(.*)$/.exec(str || '');
  if(!m) return { prefix: '', digits: str || '', suffix: '' };
  return { prefix: m[1], digits: m[2], suffix: m[3] };
}
/* 千分位逗號——例如"1000"→"1,000"、"12345"→"12,345"，3位數以下不變
   (例如"300"還是"300")。只處理digits這個純數字段落，prefix("$")/
   suffix(如果有的話)不受影響。 */
function _addThousandsSeparators(digitsStr){
  return digitsStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function _couponFormatPrice(str){
  var parts = _couponSplitPrice(str);
  return { prefix: parts.prefix, digits: _addThousandsSeparators(parts.digits), suffix: parts.suffix };
}

function _measureCouponMixedWidth(ctx, str, weight, baseFontPx, bigFontPx){
  if(!str) return 0;
  var parts = _couponFormatPrice(str);
  ctx.save();
  ctx.font = weight+' '+bigFontPx+'px "ShopeeNoto","Noto Sans TC",sans-serif';
  var digitsW = ctx.measureText(parts.digits).width;
  ctx.font = weight+' '+baseFontPx+'px "ShopeeNoto","Noto Sans TC",sans-serif';
  var prefixW = ctx.measureText(parts.prefix).width;
  var suffixW = ctx.measureText(parts.suffix).width;
  ctx.restore();
  return prefixW + digitsW + suffixW;
}

/* 依cfg.frameWidthPx(這段文字的「框」寬度)算縮放倍率——文字量出來比框寬
   就縮小到剛好塞進框裡(沒有下限，框有多窄就縮多小，避免文字溢出框外比
   「稍微小一點」更嚴重)；文字比框窄就放大，但放大倍率夾在cfg.maxEnlarge
   (預設1.12=最多放大12%)以內，避免短文字被放得不成比例的大。沒有設定
   frameWidthPx的呼叫端(理論上不會發生，兩個key都有設)直接回傳1(不縮放)。 */
function _couponTextFitScale(ctx, str, cfg){
  if(!cfg.frameWidthPx) return 1;
  var measuredW = _measureCouponMixedWidth(ctx, str, cfg.weight, cfg.baseFontPx, cfg.bigFontPx);
  if(!measuredW) return 1;
  var scale = cfg.frameWidthPx / measuredW;
  var maxEnlarge = cfg.maxEnlarge || 1.12;
  if(scale > maxEnlarge) scale = maxEnlarge;
  return scale;
}

/* 實際畫「前綴小字＋數字大字(含千分位逗號)＋後綴小字」——自己寫一份，
   不呼叫Modules.pricetag.drawMixedSizeText()，理由跟上面
   _measureCouponMixedWidth()同一個(那支函式內部切字不認得逗號)。centerX
   是整段文字（含前後綴）的水平中心，baselineY是文字基線。 */
function _drawCouponMixedText(ctx, str, centerX, baselineY, weight, color, baseFontPx, bigFontPx){
  var parts = _couponFormatPrice(str);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;

  ctx.font = weight+' '+bigFontPx+'px "ShopeeNoto","Noto Sans TC",sans-serif';
  var digitsW = ctx.measureText(parts.digits).width;
  ctx.font = weight+' '+baseFontPx+'px "ShopeeNoto","Noto Sans TC",sans-serif';
  var prefixW = ctx.measureText(parts.prefix).width;
  var suffixW = ctx.measureText(parts.suffix).width;

  var totalW = prefixW + digitsW + suffixW;
  var x = centerX - totalW/2;

  ctx.font = weight+' '+baseFontPx+'px "ShopeeNoto","Noto Sans TC",sans-serif';
  ctx.fillText(parts.prefix, x, baselineY);
  x += prefixW;
  ctx.font = weight+' '+bigFontPx+'px "ShopeeNoto","Noto Sans TC",sans-serif';
  ctx.fillText(parts.digits, x, baselineY);
  x += digitsW;
  ctx.font = weight+' '+baseFontPx+'px "ShopeeNoto","Noto Sans TC",sans-serif';
  ctx.fillText(parts.suffix, x, baselineY);
  ctx.restore();
}

function _drawCouponText(ctx, str, cfg){
  if(!str) return;
  /* 先照文字實際長度算一次縮放倍率，再用縮放後的字級去量baseline/畫字——
     兩段文字各自獨立算，互不影響(第1張變長不會影響第2張的字級)。 */
  var fitScale = _couponTextFitScale(ctx, str, cfg);
  var baseFontPx = cfg.baseFontPx * fitScale;
  var bigFontPx = cfg.bigFontPx * fitScale;

  var cx = cfg.xPct * 1200, cy = cfg.yPct * 1200;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(cfg.rotationDeg * Math.PI / 180);

  ctx.font = cfg.weight + ' ' + bigFontPx + 'px "ShopeeNoto","Noto Sans TC",sans-serif';
  var m = ctx.measureText('0');
  var ascent = m.actualBoundingBoxAscent || bigFontPx*0.72;
  var descent = m.actualBoundingBoxDescent || bigFontPx*0.2;
  var baselineY = (ascent - descent) / 2;

  _drawCouponMixedText(ctx, str, 0, baselineY, cfg.weight, cfg.color, baseFontPx, bigFontPx);
  ctx.restore();
}

/* 把券圖+兩段文字畫上去的共用邏輯——popup預覽(drawCouponCanvas)、最終
   匯出(exportCouponComposite)都呼叫這支，確保「畫面上看到的」跟「按確認
   之後匯出的」永遠是同一份畫法，不會兩邊各寫一份、慢慢跑掉不一致。 */
function _drawCouponContent(ctx){
  _loadCouponImage(function(img){
    if(img){
      var h = COUPON_IMAGE_POS.hPct * 1200;
      var w = h * (img.naturalWidth / img.naturalHeight);
      var x = COUPON_IMAGE_POS.centerXPct*1200 - w/2;
      var y = COUPON_IMAGE_POS.topYPct * 1200;
      /* 陰影只包住券圖這一筆drawImage——save/restore之間，畫完馬上復原，
         不會連帶讓後面的文字/錢幣也長出陰影。 */
      ctx.save();
      ctx.shadowColor = COUPON_SHADOW.color;
      ctx.shadowBlur = COUPON_SHADOW.blur;
      ctx.shadowOffsetX = COUPON_SHADOW.offsetX;
      ctx.shadowOffsetY = COUPON_SHADOW.offsetY;
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
    }
    var groupText = (window.S && S.textGroups && S.textGroups[groupKeyForLayout('03_c2c_bn')]) || emptyTextGroup();
    _drawCouponText(ctx, groupText['第1張(後)'], COUPON_TEXT_POS['第1張(後)']);
    _drawCouponText(ctx, groupText['第2張(前)'], COUPON_TEXT_POS['第2張(前)']);
    /* 錢幣疊在最上層(跟商品模式exportShadowComposite()最後才畫錢幣同一個
       疊放順序)，用券樣模式自己的一組位置(S.kvCoinSlotsCoupon)。 */
    drawCouponCoins(ctx);
  });
}

function drawCouponCanvas(){
  if(!_couponCtx) return;
  _couponCtx.clearRect(0, 0, 1200, 1200);

  /* 背景僅供對位參考，不會被一起輸出——沿用shadow-popup.js已經定義好的
     _drawShadowBgCover()/_loadShadowBg()/_shadowBgCache，不重複寫一份
     一樣的東西(shadow-popup.js的script標籤排在這支檔案前面，見
     editor.html)。 */
  var version = (window.S && S.templateVersion === 'B') ? 'B' : 'A';
  var bgEntry = _shadowBgCache[version];
  if(!bgEntry){ _loadShadowBg(version); bgEntry = _shadowBgCache[version]; }
  if(bgEntry && bgEntry.status === 'loaded'){
    _drawShadowBgCover(_couponCtx, bgEntry.img, 1200, 1200);
  } else {
    _couponCtx.fillStyle = (window.S && S.bg && S.bg.seedHex) || '#d8d8d8';
    _couponCtx.fillRect(0, 0, 1200, 1200);
  }

  _drawCouponContent(_couponCtx);
  /* 選取框只在popup預覽畫，不會一起匯出——跟shadow-popup.js的
     drawShadowCanvas()/exportShadowComposite()同一個原則(選取狀態純粹是
     編輯時的UI提示)。_drawCouponContent()裡的圖片載入是非同步的，這裡
     用setTimeout(...,0)排到下一輪再畫選取框，確保錢幣box算得出來
     (第一次還沒讀到圖片時_couponCoinBox()會回傳null，選取框直接跳過，
     不影響，之後coin圖片load完成後續拖曳操作觸發的redraw都會正常畫出)。 */
  setTimeout(function(){ if(_couponCtx) drawCouponCoinSelection(_couponCtx); }, 0);
}

function exportCouponComposite(){
  var outCv = document.createElement('canvas');
  outCv.width = 1200; outCv.height = 1200;
  var octx = outCv.getContext('2d');

  _drawCouponContent(octx); // 純券圖+文字，不含背景預覽，跟商品的host是同一種「透明背景合成圖」慣例

  /* ★ 用toDataURL()而不是toBlob()+URL.createObjectURL()：跟
     shadow-popup.js的exportShadowComposite()同一個理由，blob網址只在
     這次瀏覽器分頁還活著的期間有效，暫存.json存的話重新整理會失效，
     toDataURL()產生的data:網址不管存到哪裡都一樣有效。
     _loadCouponImage()裡的img.onload是非同步的，這裡用setTimeout(...,0)
     排到下一輪microtask之後再輸出，確保_drawCouponContent()裡的圖片已經
     畫上去了才轉成dataURL——如果券圖第一次讀取還沒完成就呼叫toDataURL()，
     畫面上會只有文字、沒有券圖。 */
  setTimeout(function(){
    var dataUrl = outCv.toDataURL('image/png');
    var outImg = new Image();
    outImg.onload = function(){
      S.assets = S.assets || {};
      S.assets.host = outImg;
      closePopup();
      renderAll(); // 廣播：套進S.assets.host後重畫一次，03_c2c_bn(HBN)畫布馬上顯示最新的券+錢幣
      var cb = _couponPopupOnConfirm;
      _couponPopupOnConfirm = null;
      if(cb) cb(); // 匯入流程的下一步(下一個曝光日期區塊，如果有的話)，見js/editor-popups.js的processOneBlock()
    };
    outImg.src = dataUrl;
  }, 50);
}

/* onConfirm：匯入工單流程接的callback(跟openShadowPopup(onConfirm)同一個
   模式)——使用者手動點右側「編輯券」按鈕開popup時不用傳，維持原本行為。 */
function openCouponPopup(onConfirm){
  _couponPopupOnConfirm = (typeof onConfirm === 'function') ? onConfirm : null;
  var DISPLAY = 480;
  var groupKey = groupKeyForLayout('03_c2c_bn');
  var overlay = createOverlay(
    '<div class="popup-panel" style="width:'+(DISPLAY+380)+'px;">'+
      '<div class="popup-head"><span>編輯券（券樣模式）</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body" style="display:flex;gap:16px;">'+
        '<div style="width:300px;flex:none;">'+
          '<div class="field">'+
            '<label>第1張(後)（例：$300）</label>'+
            '<input type="text" class="coupon-inline-input" data-field="第1張(後)">'+
            '<label style="margin-top:6px;">第2張(前)（例：$300）</label>'+
            '<input type="text" class="coupon-inline-input" data-field="第2張(前)">'+
          '</div>'+
          '<div class="hint" style="margin-top:6px;">券的位置/角度是固定設計，這裡不能拖曳調整。金額改這裡就會即時更新預覽，跟右側面板「第1張(後)」「第2張(前)」是同一份資料，改這邊那邊也會一起變。</div>'+
          '<div class="field" style="margin-top:10px;">'+
            '<button class="tbtn" id="coupon-coin-reset-btn" style="width:100%;justify-content:center;">重設兩個錢幣的位置/大小</button>'+
            '<div class="hint" style="margin-top:4px;">錢幣一旦被拖曳調整過，就會記住那個位置(跟商品模式的錢幣是分開存的，互不影響)，之後不會再套用新的預設值——想恢復預設，先按這顆再重新微調。</div>'+
          '</div>'+
        '</div>'+
        '<div>'+
          '<div class="pos-editor-stage" style="width:'+DISPLAY+'px;height:'+DISPLAY+'px;">'+
            '<canvas id="coupon-compose-canvas" width="1200" height="1200" style="width:'+DISPLAY+'px;height:'+DISPLAY+'px;"></canvas>'+
          '</div>'+
          '<div class="hint" style="margin-top:8px;">拖曳錢幣移動；拖角落縮放。券卡本身位置固定不能拖。</div>'+
        '</div>'+
      '</div>'+
      '<div class="popup-foot">'+
        '<button class="tbtn primary" id="coupon-export-btn">確認並套用到作圖區</button>'+
      '</div>'+
    '</div>'
  );

  _couponCanvas = overlay.querySelector('#coupon-compose-canvas');
  _couponCtx = _couponCanvas.getContext('2d');
  _couponCoinSelected = {};
  _couponCoinInteraction = null;
  attachCouponCoinPointerEvents(_couponCanvas, drawCouponCanvas);

  /* 券面金額直接在這個popup裡編輯——跟activeText()/bindTextInputs()同一套
     「讀寫都是同一份S.textGroups物件」原則，不需要另外做暫存/確認機制：
     這裡改一個字，S.textGroups[groupKey]就直接更新。
     2026-09移除：右側面板原本也有一份「第1張(後)」「第2張(前)」輸入框，
     這裡以前會同步鏡射過去——但那份輸入框已經拿掉了(改這裡才會真的生效，
     右側面板改了畫布不會跟著變，容易誤導使用者，見editor.html的說明)，
     現在這個popup裡的輸入框是唯一能編輯這兩個值的地方，不用再鏡射。
     ★用class+data-field屬性查找、不要用id/querySelector('#...')——'第1張(後)'
     這種欄位名稱本身帶括號，括號在CSS選擇器語法裡是保留字元(functional
     notation)，拼成'#coupon-inline-第1張(後)'丟進querySelector()會直接
     丟出「不是合法選擇器」的例外，整個匯入流程的後續步驟(LOGO2/商品確認)
     都會被這個例外中斷。data-field的值是屬性內容、不會被當作選擇器語法
     解析，不管欄位名稱裡有什麼符號都不會炸。 */
  overlay.querySelectorAll('.coupon-inline-input').forEach(function(input){
    var fieldKey = input.dataset.field;
    S.textGroups = S.textGroups || {};
    if(!S.textGroups[groupKey]) S.textGroups[groupKey] = emptyTextGroup();
    input.value = S.textGroups[groupKey][fieldKey] || '';
    input.oninput = function(){
      S.textGroups[groupKey][fieldKey] = input.value;
      /* 2026-09新增：08_popup(Popup)版位的「票券1」文案，內容規則是
         直接沿用「第1張(後)」(見js/editor-import.js的parseTextGroups()，
         Excel匯入時就已經這樣衍生)——使用者反映在這裡編輯「第1張(後)」
         之後，POPUP畫布上的「票券1」應該要跟著即時更新，不要編輯完
         還要重新匯入才會同步。這裡直接鏡射過去，並呼叫renderAll()讓
         主畫面上的POPUP畫布(如果剛好也在這個分頁裡)立刻重畫，不用等
         使用者關掉這個彈窗才看到最新結果。 */
      if(fieldKey === '第1張(後)'){
        S.textGroups[groupKey]['票券1'] = input.value;
        if(typeof renderAll === 'function') renderAll();
      }
      drawCouponCanvas();
    };
  });

  overlay.querySelector('#coupon-coin-reset-btn').onclick = function(){
    S.kvCoinSlotsCoupon = {};
    drawCouponCanvas();
  };
  overlay.querySelector('#coupon-export-btn').onclick = exportCouponComposite;
  drawCouponCanvas();
}
