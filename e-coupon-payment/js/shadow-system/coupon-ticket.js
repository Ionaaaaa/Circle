/*!
 * coupon-ticket.js
 * ────────────────────────────────────────────────────────────
 * 電子票券繳費專案 —— 券樣合成引擎（流程說明文件第6a步：「券樣合成popup」）
 *
 * 負責把「空白券框模板」+「LOGO」+「文字」合成成一張券樣圖，給票券化的商品
 * 槽位使用（見 shadow-layout-defaults-circle.js 的 CIRCLE_COMBO_TICKET_SLOTS
 * 說明）。合成完的圖是普通一張 dataURL，之後跟一般商品照片走同一套管線
 * （丟進 S.shadowSlots，進 1200x1200 主畫布）。
 *
 * ── 核心功能：左側色塊動態換色（保留原本光影） ──────────────────────
 * 模板 coupon-template.png 本身是蝦皮橘（核心色 #EF3F26），但左色塊＋
 * 右側底部那條描邊，實際上色的部分应该跟著LOGO品牌色變化（例如LOGO是白底
 * 深紅字，換色後左色塊+底部描邊+右側文字全部變成同一個深紅色），但保留
 * 模板原本的漸層/光影細節，不是整塊填死一個純色（那樣會很扁平、沒質感）。
 *
 * 換色演算法（不是標準的 canvas globalCompositeOperation 'hue'/'color'——
 * 那兩種標準blend mode套用在「橘色(較亮)換成深紅色(較暗)」這種目標亮度差
 * 很大的情況，效果會跑掉，見開發過程中 hue/color 兩種blend mode的實測比較）：
 *
 *   1. 每個要換色的像素，量出它在原圖裡的「相對亮度」──跟模板核心橘色
 *      (#EF3F26) 的亮度相比，這個像素是比較亮還是比較暗、亮暗多少倍
 *      （這個比例就是原本的光影/漸層資訊）
 *   2. 目標色的亮度 × 這個比例 = 這個像素換色後「應該有的亮度」
 *   3. 用HSL的SetLum()把目標色调整到這個亮度，色相/飽和度维持目標色本身的
 *      （SetLum/ClipColor 是 W3C Compositing спec 定義blend mode時用的同一套
 *      公式，數學上等於Photoshop「顏色」混合模式的核心邏輯，只是我們額外把
 *      目標亮度按比例縮放，不是直接套用背景本身的亮度）
 *
 *   這樣換色後的每個像素，色相/飽和度都是新目標色的，但明暗變化的「形狀」
 *   （哪裡亮、哪裡暗、暗多少）完全保留原本模板的光影分佈。
 *
 * ── 換色範圍(mask) ──────────────────────────────────────────
 * 用「飽和度」判斷哪些像素屬於「有上色」的部分（左色塊 + 右側底部那條描邊），
 * 飽和度接近0（白色本體）就不換色，飽和度越高換色強度越高——這樣不用手動
 * 標記色塊形狀，模板本身多一條描邊之類的設計元素也會自動一起納入換色範圍，
 * 不用每次改模板都要重新畫mask（mask是開發時預先算好存成
 * assets/ticket/coupon-block-mask.png，不是每次即時算，即時算一次802×312
 * 圖大約要跑25萬次HSV轉換，效能考量預先存檔案比較好，除非以後要換模板圖，
 * 换圖時要重新產生一份mask，見這份檔案最後的「重新產生mask」說明）。
 *
 * ── LOGO底色融合 ──────────────────────────────────────────
 * LOGO範圍那個框不是畫一個固定白底方塊上去，而是先看LOGO圖檔本身四個角落
 * 是不是有實色底（不透明），有的話直接抓那個顏色來填滿這個框的背景，讓
 * LOGO自己的底色跟框的背景融為一體、看不出框的邊界；LOGO是透明背景（四角
 * 都偵測不到不透明底色）的話，就退回填白色（使用者已確認的行為）。
 * ────────────────────────────────────────────────────────────
 */
(function (global) {
  'use strict';

  var ASSET_BASE = 'assets/ticket/';
  var TEMPLATE_URL = ASSET_BASE + 'coupon-template.png';
  var MASK_URL = ASSET_BASE + 'coupon-block-mask.png';

  /* 模板原生尺寸（優惠券.png / coupon-template.png 實際像素），所有座標常數
     都是在這個尺寸下量出來的；輸出圖也是這個尺寸，不額外放大縮小。 */
  var TEMPLATE_W = 802;
  var TEMPLATE_H = 312;

  /* 模板核心橘色（模板色塊裡最純、沒有陰影/高光影響的那個顏色），拿來當
     「相對亮度」換算的基準點——見上面檔頭說明的換色演算法第1步。 */
  var CORE_ORANGE = { r: 239, g: 63, b: 38 };

  /* LOGO範圍／文字範圍實測座標（見跟使用者確認過程：模板本身不是方形，
     使用者提供的CSS數值是PS方形工作區座標、跟實際裁切後的802×312圖對不
     起來，這裡改成直接從實際圖檔量出來的座標，格式是 {x0,y0,x1,y1}）。 */
  var LOGO_BOX = { x0: 52, y0: 83, x1: 212, y1: 240 };
  var TEXT_BOX = { x0: 249, y0: 75, x1: 779, y1: 235 }; // 2026-08微調：整體往左1px（使用者反映文字偏右一點點）

  /* LOGO底色方塊旋轉角度（度）——上一版用-8度，使用者反映轉錯邊了，
     改成正值。canvas的ctx.rotate()正值＝順時針，這裡正值視覺上是方塊
     頂部往左、底部往右傾（像信封蓋往左掀一點的感覺），如果方向還是不對，
     這是唯一要調整的常數。 */
  var LOGO_BOX_ROTATION_DEG = 4;

  /* 文字弧形彎曲程度：0=完全水平不彎，數字是「文字兩端相對中間的垂直提高量」
     佔字級高度的比例——使用者實測後反映中間下沉太多，從0.10調小到0.05。 */
  var TEXT_ARC_DEPTH_RATIO = 0.05;

  /* 文字整體旋轉：使用者測試後反映不要刻意抬高尾端，改回0(不旋轉)，只保留
     中間下沉的弧形效果。常數留著沒刪，之後如果又想要這個效果，改這個數字
     就好，不用重寫程式。 */
  var TEXT_BLOCK_ROTATION_DEG = -2;

  var DEFAULT_TEXT = '電子票券';
  /* 2026-08修正：原本用系統字體堆疊，使用者反映應該要用專案自己的蝦皮字型
     （fonts/ShopeeNotoSans(content)-Bold.ttf，editor.html已經有@font-face
     宣告成family:'ShopeeNoto', weight:700），改成優先用這個、系統字體當
     fallback（萬一@font-face還沒宣告好、或字型檔載入失敗時還能顯示東西，
     不會整個空白）。字重固定用700（對應Bold那個字重，唯一有這個字重的檔案，
     沒有到900這麼粗）。 */
  var FONT_FAMILY_STACK = '"ShopeeNoto", "Microsoft JhengHei", "PingFang TC", "Heiti TC", "Noto Sans CJK TC", sans-serif';
  var FONT_WEIGHT = '700';

  /* 確保「ShopeeNoto」這個@font-face字型真的載入完成才畫字——不像一般文字
     排版，瀏覽器字型還沒到位時可以先顯示fallback字體、之後字型到了自動
     reflow；canvas畫字是「畫的當下用什麼字型就是什麼字型」，字型還沒載入完
     就呼叫fillText()，會直接用fallback字體畫下去，之後字型才載入完成也不會
     重畫、畫面會卡住顯示錯誤字體。document.fonts.load()回傳的promise確保
     載入完成後才繼續。 */
  function ensureFontLoaded(){
    if(!(document.fonts && document.fonts.load)) return Promise.resolve();
    return document.fonts.load(FONT_WEIGHT + ' 100px "ShopeeNoto"').then(function(){
      return document.fonts.ready;
    }).catch(function(){
      // 字型載入失敗（例如editor.html沒有宣告@font-face、或字型檔案不存在），
      // 靜默忽略，畫字時會自動fallback到堆疊裡的下一個字體，不擋流程
    });
  }

  var _templateImg = null;
  var _maskImg = null;
  var _assetsPromise = null;

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('圖片載入失敗: ' + url)); };
      img.src = url;
    });
  }

  function ensureAssetsLoaded() {
    if (_assetsPromise) return _assetsPromise;
    _assetsPromise = Promise.all([loadImage(TEMPLATE_URL), loadImage(MASK_URL), ensureFontLoaded()])
      .then(function (results) {
        _templateImg = results[0];
        _maskImg = results[1];
      });
    return _assetsPromise;
  }

  /* ── HSL SetLum／ClipColor（W3C Compositing規格公式，值域0~1） ──────
     跟本檔頭說明的換色演算法第3步對應：把一個顏色調整到指定亮度，
     色相/飽和度盡量維持，超出0~1範圍時用ClipColor拉回合法範圍。 */
  function lum(r, g, b) { return 0.3 * r + 0.59 * g + 0.11 * b; }

  function clipColor(r, g, b) {
    var l = lum(r, g, b);
    var n = Math.min(r, g, b);
    var x = Math.max(r, g, b);
    if (n < 0) {
      var dn = (l - n) || 1e-6;
      r = l + (r - l) * l / dn;
      g = l + (g - l) * l / dn;
      b = l + (b - l) * l / dn;
    }
    if (x > 1) {
      var dx = (x - l) || 1e-6;
      r = l + (r - l) * (1 - l) / dx;
      g = l + (g - l) * (1 - l) / dx;
      b = l + (b - l) * (1 - l) / dx;
    }
    return [r, g, b];
  }

  function setLum(r, g, b, targetLum) {
    var d = targetLum - lum(r, g, b);
    return clipColor(r + d, g + d, b + d);
  }

  var CORE_LUM = lum(CORE_ORANGE.r / 255, CORE_ORANGE.g / 255, CORE_ORANGE.b / 255);

  /* 換色主邏輯：templateData/maskData是同尺寸的ImageData，target是{r,g,b}(0~255)。
     回傳一份新的ImageData（不修改傳入的templateData）。 */
  function recolorTemplate(templateData, maskData, target) {
    var w = templateData.width, h = templateData.height;
    var out = new ImageData(w, h);
    var src = templateData.data, mk = maskData.data, dst = out.data;

    var targetR = target.r / 255, targetG = target.g / 255, targetB = target.b / 255;
    var targetLum = lum(targetR, targetG, targetB);

    for (var i = 0; i < src.length; i += 4) {
      var r = src[i] / 255, g = src[i + 1] / 255, b = src[i + 2] / 255, a = src[i + 3];
      var m = mk[i] / 255; // mask存成灰階PNG，RGB三個channel值相同，取R即可

      if (m <= 0.003) {
        // 遮罩沒蓋到的地方，原圖直接照搬，不做任何運算（效能+避免無謂的浮點誤差）
        dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = a;
        continue;
      }

      var backdropLum = lum(r, g, b);
      var ratio = backdropLum / CORE_LUM;
      var newLum = Math.max(0, Math.min(1, targetLum * ratio));
      var recolored = setLum(targetR, targetG, targetB, newLum);

      // 用mask強度做線性混合（mask<1的邊緣像素，原圖跟換色結果之間平滑過渡，
      // 對應模板邊緣的抗鋸齒羽化，不會出現生硬的鋸齒交界）
      var rr = r * (1 - m) + recolored[0] * m;
      var gg = g * (1 - m) + recolored[1] * m;
      var bb = b * (1 - m) + recolored[2] * m;

      dst[i] = Math.round(Math.max(0, Math.min(1, rr)) * 255);
      dst[i + 1] = Math.round(Math.max(0, Math.min(1, gg)) * 255);
      dst[i + 2] = Math.round(Math.max(0, Math.min(1, bb)) * 255);
      dst[i + 3] = a;
    }
    return out;
  }

  /* 抓LOGO圖檔四個角落的顏色，判斷LOGO本身是不是「有實色底」——四個角落
     都要不透明(alpha接近255)才採信，只要有一角是透明的就當作「這張LOGO
     沒有固定底色」，回傳null讓呼叫端fallback白色（使用者已確認的行為）。
     每個角落取6x6小區塊算平均，不要只採樣單一像素（避免邊緣抗鋸齒雜訊、
     或LOGO角落剛好疊到一根線條之類的極端值）。 */
  function extractLogoBgColor(logoImg) {
    var w = logoImg.naturalWidth || logoImg.width;
    var h = logoImg.naturalHeight || logoImg.height;
    var cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    var ctx = cvs.getContext('2d');
    ctx.drawImage(logoImg, 0, 0, w, h);

    var patch = Math.max(2, Math.min(6, Math.floor(Math.min(w, h) * 0.05)));
    var corners = [
      [0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch]
    ];

    var samples = [];
    corners.forEach(function (c) {
      var data;
      try { data = ctx.getImageData(c[0], c[1], patch, patch).data; }
      catch (e) { return; } // canvas被跨網域圖片污染等情況，安全跳過、當作偵測不到
      var sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (var i = 0; i < data.length; i += 4) {
        sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; sa += data[i + 3]; n++;
      }
      samples.push({ r: sr / n, g: sg / n, b: sb / n, a: sa / n });
    });

    var opaque = samples.filter(function (s) { return s.a > 250; });
    if (!opaque.length) return null; // 四角至少要有偵測到不透明的，一個都沒有就當作透明背景

    var r = 0, g = 0, b = 0;
    opaque.forEach(function (s) { r += s.r; g += s.g; b += s.b; });
    return { r: Math.round(r / opaque.length), g: Math.round(g / opaque.length), b: Math.round(b / opaque.length) };
  }

  /* 文字自動縮放置中：從貼齊文字框高度的字級開始，量測寬高，超出框範圍
     （留6%邊界）就縮小字級重量，直到符合為止或字級小到10px以下放棄。
     弧形（中間文字比兩側略低）先畫在一塊獨立的暫存畫布上，畫完之後把
     這一整塊「當成一張圖」旋轉貼到正式畫布——這樣「弧形」跟「整體旋轉」
     是兩個獨立、乾淨疊加的效果，不會互相干擾，也才是真正的剛體旋轉
     （不是逐字疊加位移去模擬旋轉，那樣數學上不等價，效果會怪怪的）。 */
  function drawAutoFitText(ctx, text, box, color) {
    var boxW = box.x1 - box.x0, boxH = box.y1 - box.y0;
    var fontSize = boxH;
    var fillStyle = 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')';
    var metrics;
    for (; fontSize >= 10; fontSize -= 2) {
      ctx.font = FONT_WEIGHT + ' ' + fontSize + 'px ' + FONT_FAMILY_STACK;
      metrics = ctx.measureText(text);
      var textH = (metrics.actualBoundingBoxAscent || fontSize * 0.8) + (metrics.actualBoundingBoxDescent || fontSize * 0.2);
      if (metrics.width <= boxW * 0.94 && textH <= boxH * 0.94) break;
    }

    var chars = text.split('');
    if (!chars.length) return;

    // 暫存畫布留一點邊界(pad)，避免旋轉之後文字邊緣被裁掉
    var pad = Math.ceil(boxH * 0.5);
    var offW = Math.ceil(boxW + pad * 2), offH = Math.ceil(boxH + pad * 2);
    var off = document.createElement('canvas');
    off.width = offW; off.height = offH;
    var octx = off.getContext('2d');
    octx.font = FONT_WEIGHT + ' ' + fontSize + 'px ' + FONT_FAMILY_STACK;
    octx.fillStyle = fillStyle;
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';

    var widths = chars.map(function (ch) { return octx.measureText(ch).width; });
    var totalW = widths.reduce(function (a, b) { return a + b; }, 0);
    var centerX = offW / 2, centerY = offH / 2;
    var peakDepth = fontSize * TEXT_ARC_DEPTH_RATIO;

    var x = centerX - totalW / 2;
    chars.forEach(function (ch, i) {
      var w = widths[i];
      var charCx = x + w / 2;
      var t = totalW > 0 ? (charCx - centerX) / (totalW / 2) : 0; // -1~1，中間=0
      t = Math.max(-1, Math.min(1, t));
      var dy = peakDepth * (1 - t * t); // 中間(t=0)下沉最多，兩端(t=±1)下沉為0
      octx.fillText(ch, charCx, centerY + dy);
      x += w;
    });

    // 整塊(含弧形)當一張圖，繞著文字框中心旋轉貼回正式畫布
    ctx.save();
    ctx.translate(box.x0 + boxW / 2, box.y0 + boxH / 2);
    ctx.rotate(TEXT_BLOCK_ROTATION_DEG * Math.PI / 180);
    ctx.drawImage(off, -offW / 2, -offH / 2);
    ctx.restore();
  }

  /* LOGO底色方塊旋轉——只轉背景方塊本身，見上面LOGO_BOX_ROTATION_DEG的說明。
     ★2026-08改成圓形——不是圓角矩形。半徑取box寬高中比較小的那邊/2，圓心
     維持在box正中央，這樣box本身尺寸不用重新量測調整，只是視覺形狀從
     方形變圓。 */
  function drawLogoBg(ctx, box, color, angleDeg, radius) {
    var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    var w = box.x1 - box.x0, h = box.y1 - box.y0;
    var r = Math.min(w, h) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleDeg * Math.PI / 180);
    ctx.fillStyle = 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* 把LOGO畫進LOGO_BOX這個圓形範圍。
     2026-08新增：
       - angleDeg：跟底色方塊(drawLogoBg)套用同一個角度，讓LOGO圖案本身也
         一起旋轉（原本LOGO刻意不轉、只轉底色方塊，使用者反映希望LOGO也
         一起轉，改成兩者一致）。
       - offsetX/offsetY：使用者在popup裡拖曳LOGO調整位置，單位是模板原生
         像素(802x312那個尺度)，套用在「旋轉後的本地座標系」——也就是先轉
         再位移，這樣拖曳的方向感跟畫面上看到的LOGO本身方向一致，不會因為
         底色方塊轉了幾度而讓「往右拖」看起來實際往斜的方向跑。
     ★2026-08再調整：範圍改成圓形之後——
       1. 預設貼合方式從「contain(等比縮小到完全塞進框內，四周留白)」改成
          「cover(等比放大到完全填滿框，超出的部分裁掉)」，一放進來就是
          自動撐滿的樣子，不用使用者自己先手動放大一次。
       2. 不管使用者用滾輪把LOGO縮多大、拖到多偏，都用ctx.clip()裁在這個
          圓形範圍內——超出圓形的部分直接不會畫出來，不用額外寫「檢查有沒有
          超出、擋住使用者操作」的邊界判斷邏輯，clip()自動處理。使用者可以
          把LOGO縮小到比圓形範圍還小(這時候圓形中間會露出底色)，這是刻意
          允許的行為（只要求「不能超出」，沒有要求「不能露出底色」）。
       - scaleMul：使用者滾輪縮放的倍率，乘在「cover自動撐滿」算出來的
         基準尺寸上，預設1(=剛好完全填滿圓形範圍)。 */
  function drawLogoFitted(ctx, logoImg, box, padding, angleDeg, offsetX, offsetY, scaleMul) {
    var boxW = box.x1 - box.x0 - padding * 2;
    var boxH = box.y1 - box.y0 - padding * 2;
    var r = Math.min(box.x1 - box.x0, box.y1 - box.y0) / 2;
    var lw = logoImg.naturalWidth || logoImg.width;
    var lh = logoImg.naturalHeight || logoImg.height;
    var fitScale = Math.max(boxW / lw, boxH / lh) * (scaleMul || 1); // cover：取較大那邊當基準，確保完全填滿
    var nw = lw * fitScale, nh = lh * fitScale;
    var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((angleDeg || 0) * Math.PI / 180);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip(); // 之後畫的LOGO，超出這個圓的部分一律裁掉，不用另外算邊界
    ctx.drawImage(logoImg, -nw / 2 + (offsetX || 0), -nh / 2 + (offsetY || 0), nw, nh);
    ctx.restore();
  }

  function roundRect(ctx, x0, y0, x1, y1, r) {
    var w = x1 - x0, h = y1 - y0;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x1, y0, x1, y1, r);
    ctx.arcTo(x1, y1, x0, y1, r);
    ctx.arcTo(x0, y1, x0, y0, r);
    ctx.arcTo(x0, y0, x1, y0, r);
    ctx.closePath();
  }

  /**
   * 合成一張券樣圖。
   * @param {Object} opts
   *   opts.targetColor {r,g,b} - 換色目標色（通常是從LOGO抓出來的品牌色，
   *     見 suggestColorFromLogo()；使用者可以在popup用色票手動覆蓋）
   *   opts.logoImg {HTMLImageElement} - 已載入好的LOGO圖片元素
   *   opts.logoOffsetX/opts.logoOffsetY - 使用者拖曳調整的LOGO位置偏移
   *     （模板原生像素、旋轉後本地座標系，預設0）
   *   opts.logoScale - 使用者滾輪縮放倍率（預設1＝自動置中鋪滿框）
   *   opts.text {string} - 預設'電子票券'，使用者可在popup自訂
   * @returns {Promise<string>} 合成完的PNG dataURL（802×312）
   */
  /* ★2026-08修正：券樣要有的「傾斜感」，不要用即時transform在1200畫布裡轉
     （那樣陰影演算法還是照著「未旋轉的形狀」去算光影，轉出來的陰影不夠
     真實——使用者拿實際案例比較過，見對話紀錄的旋轉.png／沒有旋轉.png
     兩張參考圖），改成直接把這個角度「烤進」券樣圖檔本身的像素——輸出的
     PNG畫布要跟著放大，避免旋轉後四個角被裁掉，多出來的地方維持透明。
     這樣券樣進到1200畫布時，圖片本身就已經是斜的，用originalrot:0放入
     即可，陰影演算法會對著這個「本來就傾斜」的真實輪廓去算光影/斜切，
     結果自然正確，不用另外在shadow-plugin.js加特殊處理。
     ★2026-08再調整：改成可以依槽位(商品1(左)/商品2(中)/商品3(右))個別
     設定角度——不同位置的券在畫面裡視覺上需要的傾斜方向/幅度不一定一樣。
     composeTicket()呼叫時可以帶opts.rotateDeg指定這次要用的角度，沒帶的
     話退回這裡的TICKET_PRE_ROTATE_DEG當預設值；呼叫端(coupon-ticket-popup.js)
     依照卡片的slotId查TICKET_ROTATE_BY_SLOT決定要傳什麼值。 */
  var TICKET_PRE_ROTATE_DEG = 2;

  function rotateCanvasWithPadding(srcCanvas, angleDeg){
    var rad = angleDeg * Math.PI / 180;
    var w = srcCanvas.width, h = srcCanvas.height;
    var newW = Math.ceil(Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad)));
    var newH = Math.ceil(Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)));
    var out = document.createElement('canvas');
    out.width = newW; out.height = newH;
    var octx = out.getContext('2d');
    octx.translate(newW / 2, newH / 2);
    octx.rotate(rad);
    octx.drawImage(srcCanvas, -w / 2, -h / 2, w, h);
    return out;
  }

  function composeTicket(opts) {
    return ensureAssetsLoaded().then(function () {
      var tmplCanvas = document.createElement('canvas');
      tmplCanvas.width = TEMPLATE_W; tmplCanvas.height = TEMPLATE_H;
      var tctx = tmplCanvas.getContext('2d');
      tctx.drawImage(_templateImg, 0, 0, TEMPLATE_W, TEMPLATE_H);
      var templateData = tctx.getImageData(0, 0, TEMPLATE_W, TEMPLATE_H);

      var maskCanvas = document.createElement('canvas');
      maskCanvas.width = TEMPLATE_W; maskCanvas.height = TEMPLATE_H;
      var mctx = maskCanvas.getContext('2d');
      mctx.drawImage(_maskImg, 0, 0, TEMPLATE_W, TEMPLATE_H);
      var maskData = mctx.getImageData(0, 0, TEMPLATE_W, TEMPLATE_H);

      var recolored = recolorTemplate(templateData, maskData, opts.targetColor);

      var outCanvas = document.createElement('canvas');
      outCanvas.width = TEMPLATE_W; outCanvas.height = TEMPLATE_H;
      var octx = outCanvas.getContext('2d');
      octx.putImageData(recolored, 0, 0);

      if (opts.logoImg) {
        var bg = extractLogoBgColor(opts.logoImg) || { r: 255, g: 255, b: 255 };
        drawLogoBg(octx, LOGO_BOX, bg, LOGO_BOX_ROTATION_DEG, 18);
        drawLogoFitted(octx, opts.logoImg, LOGO_BOX, 14, LOGO_BOX_ROTATION_DEG, opts.logoOffsetX, opts.logoOffsetY, opts.logoScale);
      }

      var text = (opts.text && String(opts.text).trim()) || DEFAULT_TEXT;
      drawAutoFitText(octx, text, TEXT_BOX, opts.targetColor);

      var rotateDeg = (typeof opts.rotateDeg === 'number') ? opts.rotateDeg : TICKET_PRE_ROTATE_DEG;
      var finalCanvas = rotateDeg ? rotateCanvasWithPadding(outCanvas, rotateDeg) : outCanvas;
      return finalCanvas.toDataURL('image/png');
    });
  }

  /* 從LOGO圖片建議一個換色用的品牌色──LOGO本身通常「底色」+「圖案/文字色」
     兩種顏色，換色要用的是圖案/文字那個比較深/比較搶眼的顏色（例如白底深
     紅字的LOGO，要抓深紅色，不是抓白色底），所以邏輯是：把LOGO裡「非底色」
     的不透明像素挑出來，取其中出現頻率最高的顏色當建議色；抓不到底色（透明
     背景LOGO）的情況，就把所有不透明像素都當作候選，一樣取出現頻率最高的。
     這只是「建議」，使用者在popup還可以用色票自己調整（見使用者確認的
     選項B：自動建議＋可手動覆蓋）。 */
  /* 判斷一個顏色是不是「接近灰階、沒有實際色相」——飽和度很低、且非常亮
     或非常暗(例如純白、純黑、接近純白的淺灰)。用來過濾掉「黑底白字」這種
     logo抓出來的候選色其實是白色文字（不是品牌色），見suggestColorFromLogo()
     下面的說明。 */
  function isNearGrayscale(c) {
    var max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    var sat = max - min;
    return sat < 25 && (max > 235 || max < 40);
  }

  function suggestColorFromLogo(logoImg) {
    var w = logoImg.naturalWidth || logoImg.width;
    var h = logoImg.naturalHeight || logoImg.height;
    var cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    var ctx = cvs.getContext('2d');
    ctx.drawImage(logoImg, 0, 0, w, h);
    var data;
    try { data = ctx.getImageData(0, 0, w, h).data; }
    catch (e) { return { r: 238, g: 77, b: 45 }; } // 讀不到像素資料(跨網域等)，回傳蝦皮橘當保底預設值

    var bg = extractLogoBgColor(logoImg);
    var buckets = {}; // 用量化過的顏色當key累計次數，避免anti-aliasing造成幾乎同色卻被當成不同顏色

    for (var i = 0; i < data.length; i += 4) {
      var a = data[i + 3];
      if (a < 200) continue; // 半透明邊緣像素跳過，避免anti-aliasing雜訊污染統計
      var r = data[i], g = data[i + 1], b = data[i + 2];
      if (bg && Math.abs(r - bg.r) < 18 && Math.abs(g - bg.g) < 18 && Math.abs(b - bg.b) < 18) continue; // 底色跳過，我們要的是圖案色不是底色
      // 量化到每16一階，同色系但些微不同(anti-alias造成)會被歸到同一桶
      var key = (r >> 4) + '_' + (g >> 4) + '_' + (b >> 4);
      if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, n: 0 };
      buckets[key].r += r; buckets[key].g += g; buckets[key].b += b; buckets[key].n++;
    }

    var best = null;
    Object.keys(buckets).forEach(function (k) {
      if (!best || buckets[k].n > best.n) best = buckets[k];
    });

    var candidate = best ? { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n) } : null;

    /* 使用者反映：黑底白字這種LOGO（例如JPG格式，四角是黑色底、中間是
       白色文字），排除底色(黑)之後剩下的「圖案色」其實是白色文字，直接
       拿白色當建議色，套到券樣上色塊+文字都會變白色、跟券本身的白色
       背景融在一起看不見。
       判斷邏輯：如果算出來的候選色(candidate)本身「沒有實際色相」（太亮
       或太暗、飽和度又低，等於灰階/近乎純白or純黑），代表這不是有意義的
       品牌色，改用「底色」當建議色——很多這種黑底白字/深色底淺色字的
       招牌類logo，底色本身才是真正的品牌識別色（例如這裡的黑色），比
       貿然跳回蝦皮橘更貼近使用者實際上傳的這張LOGO。
       只有連底色都抓不到(bg是null，例如透明背景logo)，才真的退回蝦皮橘
       保底值。 */
    if (!candidate || isNearGrayscale(candidate)) {
      if (bg) return bg;
      return { r: 238, g: 77, b: 45 };
    }
    return candidate;
  }

  global.CouponTicket = {
    TEMPLATE_W: TEMPLATE_W,
    TEMPLATE_H: TEMPLATE_H,
    DEFAULT_TEXT: DEFAULT_TEXT,
    LOGO_BOX: LOGO_BOX,
    TEXT_BOX: TEXT_BOX,
    ensureAssetsLoaded: ensureAssetsLoaded,
    composeTicket: composeTicket,
    suggestColorFromLogo: suggestColorFromLogo,
    extractLogoBgColor: extractLogoBgColor // 外露給popup用，例如即時預覽時不用重算兩次
  };

  /* ══════════════════ 重新產生mask的方法（換模板圖時用，備查） ══════════
     mask是用飽和度(HSV的S) 判斷「這個像素算不算色塊/描邊的一部分」，公式：

       sat = (max(r,g,b) - min(r,g,b)) / max(r,g,b)
       mask = clamp((sat - 0.03) / (0.35 - 0.03), 0, 1) * alpha

     飽和度接近0（灰階/白色）＝不換色，飽和度越高換色強度越高，兩個門檻值
     (0.03 / 0.35) 是拿coupon-template.png實測調出來的，如果換一張新模板圖、
     顏色配置差很多，這兩個門檻可能要重新調。目前專案沒有內建「重新產生
     mask」的建置腳本，這步驟是開發時用Python離線算好、存成
     assets/ticket/coupon-block-mask.png，之後要換模板圖的話用同樣的公式
     重新產生一份（或請Claude重新跑一次）。 */

})(window);
