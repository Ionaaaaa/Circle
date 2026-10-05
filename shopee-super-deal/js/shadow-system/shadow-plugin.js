/*
  ShadowPlugin v4
  - 商品(product)：貼地陰影（原本的斜切/擠壓效果），參數固定好，不對外開放調整，只留光源角度可切換
  - 代言人(person)：光暈陰影（不倒地、後方縮小微變形+模糊），允許超出畫布下緣

  ★ 新增：state.rot（旋轉角度，單位度，選填，預設0）
    做法「旋轉解耦」：旋轉只發生在「畫出來的視覺」，不影響任何拖曳/縮放判定──
    shadow-layout-receiver.js 那邊的 itemBounds/控制點/拖曳數學完全不用因為加了
    旋轉而改寫，一律照原本的軸對齊矩形算，只有真正呼叫 ctx.drawImage 之前才用
    ctx.rotate() 把「陰影+照片」這個整體繞著自己的中心點轉過去。
    影響範圍：drawGroundShadow / drawPersonGlow / renderPhotosOnly，
    以及 renderScene 裡拿去算「誰擋住誰」的遮罩繪製（不轉的話，旋轉過的商品，
    遮罩範圍會對不上實際畫出來的形狀，後面商品的陰影/光暈可能該被擋住的地方沒被擋住）。
*/
window.ShadowPlugin = (function () {
  'use strict';

  // ---- 固定死的預設值（不對外開放調整）----
  // 2026-09 用skbn-shadow-test.html模擬器實測調過的新數字（soft/fade/occlude/squash
  // 這組），另外新增了尾端模糊(tailBlur系列，跟shopee-3c-appliance-report那邊同一套
  // 做法)、「中」角度的柔霧主陰影(topMainShadowAlpha)、以及接地陰影改成「碰地線上下
  // 各展開一段+左右橫向模糊」，都是你在模擬器上調出來的。
  /* 2026-09你抓到一個更根本的問題：soft/tailBlur/contactUpPx/contactDownPx/
     contactBlurX這五個原本都是寫死的「絕對px」，跟商品實際畫多大完全沒關係。
     你在測試工具上用細長商品調出一組數字，套在寬扁商品上「往後」那段陰影
     幾乎完全消失(或反過來糊成一片)——因為這幾個px值不會隨商品尺寸縮放，
     細長商品通常比較高(ph大)，同一個px值相對商品本身就顯得小/淡；寬扁商品
     矮(ph小)，同一個px值相對就顯得誇張/過量。
     改法：這五個都改成「佔商品尺寸的百分比」，畫的時候即時乘回商品當下的
     pw/ph，同一組百分比不管商品多大多扁多瘦都會維持相同的視覺比例：
       softPct/tailBlurPct/contactUpPct/contactDownPct：吃ph(商品高度)，
       跟shear*ph、squash*ph這些原本就用ph當基準的項目一致；
       contactBlurXPct：吃pw(商品寬度)，因為這是「左右橫向」模糊的幅度，
       比照寬度縮放比較合理。
     下面這組百分比數字，是拿你給的「細長商品」校正值(soft4/tailBlur17/
     contactUp4/contactDown2/contactBlurX3)，用ph≈260/pw≈150反推回來的。
     ⚠ 2026-09你一度提出「同一版位塞不同形狀商品」的refH/refW修正（百分比
     改吃版位目標尺寸而不是商品自己的pw/ph），試過之後你反饋「越來越糟糕」，
     已經整個退回：現在跟以前一樣，百分比單純吃商品自己當下的pw/ph，不管
     版位/refH/refW這件事——先求單一商品尺寸下視覺正確，形狀差異的問題
     之後再說。 */
  var FIXED = {
    softPct: 1.5,     // 原soft:4，估算基準ph≈260
    fade: 82,
    occlude: 0,
    squash: 0.41,
    // 尾端模糊：根部維持清楚邊緣，越往尾端越換成模糊版本，避免商品輪廓頂端留下一條銳利硬邊
    tailMid: 0.34,
    tailMidAlpha: 0.68,
    tailBlurPct: 6.5, // 原tailBlur:17，估算基準ph≈260
    tailBlurStart: 0.27,
    tailBlurSpan: 0.36,
    // 接地陰影：從商品實際碰到地面那條線，往上(疊在商品自己底部)、往下(貼合輪廓的細線)
    // 各展開一段，兩段拼成一條再套左右橫向模糊，做法跟舊版CONTACT_GROW_PX/0.55完全不同
    contactUpPct: 1.5,    // 原contactUpPx:4，估算基準ph≈260
    contactDownPct: 0.8,  // 原contactDownPx:2，估算基準ph≈260
    contactAlpha: 0.7,
    contactBlurXPct: 2    // 原contactBlurX:3，估算基準pw≈150
  };
  var ANGLE_PRESETS = { left: -35, top: 0, right: 35 };

  var opts = { angle: ANGLE_PRESETS.top, presetName: 'top', topY: null, bottomY: null };
  var products = {}; // id -> { img, silhouette, tinted, trim, type }
  var shadowRGB = '90,90,90'; // #5a5a5a，備用預設值——正式值改由configs/theme.json的shadow欄位載入後，app init時呼叫setShadowColorRGB()覆蓋過去，這裡的值只在theme.json載入失敗時當退路，兩邊要記得對得起來
  var rawBgRGB = null; // 未乘0.8的原始背景取樣色，供拍立得框底色使用；還沒 setBackground 過就是 null
  var fixedColor = false;

  function setAngle(preset) {
    if (typeof preset === 'number') { opts.angle = preset; opts.presetName = null; return; }
    if (ANGLE_PRESETS[preset] != null) { opts.angle = ANGLE_PRESETS[preset]; opts.presetName = preset; }
  }
  function configureZone(topY, bottomY) { opts.topY = topY; opts.bottomY = bottomY; }

  /* 2026-09新增：angle/zone(opts)是整個頁面共用的「單一份」全域狀態——
     任何呼叫端(main商品popup、MSBN自動合成…)呼叫setAngle()/configureZone()
     都是直接覆蓋同一份opts，沒有任何隔離。單一份全域狀態本身沒問題，
     問題出在「借用完沒還」：例如MSBN自動合成（js/shadow-system/
     shadow-popup.js的autoComposeMsbnHost()）在自己的隱藏canvas上算完
     之後，如果沒有把angle/zone還原成呼叫前的值，這份「借用後忘記還」
     的全域狀態會一路留到下次任何人（例如main商品popup）重繪的時候，
     造成兩邊互相干擾（main商品popup明明選的是「中」，卻因為MSBN在背景
     偷偷跑了一次自動合成，變成MSBN用的「右」）。
     這兩個函式讓「借用全域狀態做一次性隔離運算」的呼叫端能夠：
     snapshotAngleZone()——運算前先記住目前的angle/zone
     restoreAngleZone(snap)——運算完立刻還原，讓全域狀態看起來完全沒被動過
     只要「借→算→還」這三步在同一段同步程式碼內做完(中間不要有await/
     setTimeout等真正讓出主執行緒的動作)，其他呼叫端就完全不會看到這份
     暫時借用的中間狀態，等於做到了「分開設定、不互相干擾」，同時不用
     把ShadowPlugin整套改寫成「每個呼叫端各自一份獨立狀態」的大架構。 */
  function snapshotAngleZone() {
    return { angle: opts.angle, presetName: opts.presetName, topY: opts.topY, bottomY: opts.bottomY };
  }
  function restoreAngleZone(snap) {
    if (!snap) return;
    opts.angle = snap.angle; opts.presetName = snap.presetName;
    opts.topY = snap.topY; opts.bottomY = snap.bottomY;
  }

  /* 2026-10 效能：這裡原本會把「所有」註冊過的商品輪廓全部重新上色一次。
     SKBN每一格的陰影色都跟著自己的底色算，product-module.js每次重畫任何一格
     之前都會呼叫這支——整份工單匯入後有21格商品，等於畫一格就要把21張輪廓
     （每張都是原圖大小）重新上色，整個主畫面重畫一次要上色四百多張，拖曳、
     選色、拉陰影滑桿時會卡主要就是卡在這裡。
     改成只記下顏色，真的要畫某一格的陰影時才幫「那一格」上色(tintProduct
     會自己判斷顏色有沒有變，沒變就沿用上次的結果，見drawGroundShadow開頭)。 */
  function setShadowColorRGB(rgbStr) {
    shadowRGB = rgbStr; fixedColor = true;
  }
  function getShadowColorRGB() { return shadowRGB; }
  function unlockShadowColor() { fixedColor = false; }

  function setBackground(bgImg) {
    if (fixedColor) return;
    if (!bgImg || !bgImg.naturalWidth) return;
    try {
      var c = document.createElement('canvas');
      c.width = 40; c.height = 40;
      var cctx = c.getContext('2d');
      var sampleH = Math.max(1, Math.floor(bgImg.naturalHeight * 0.35));
      cctx.drawImage(bgImg, 0, bgImg.naturalHeight - sampleH, bgImg.naturalWidth, sampleH, 0, 0, 40, 40);
      var d = cctx.getImageData(0, 0, 40, 40).data;
      var r = 0, g = 0, b = 0, n = 0;
      for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      r = r / n; g = g / n; b = b / n;
      /* 原始平均色（沒乘0.8）另外留一份給拍立得框底色用（getRawBackgroundRGB）——
         shadowRGB 是刻意調暗過的貼地陰影顏色，直接拿來當拍立得的紙底色會髒髒暗暗的，不對。 */
      rawBgRGB = Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b);
      shadowRGB = Math.round(r * 0.8) + ',' + Math.round(g * 0.8) + ',' + Math.round(b * 0.8);
    } catch (e) {
      console.warn('ShadowPlugin.setBackground: 無法取樣背景顏色，改用預設色', e);
    }
    Object.keys(products).forEach(function (id) { tintProduct(id); });
  }
  function getRawBackgroundRGB() { return rawBgRGB; }

  function buildSilhouette(img) {
    var c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }
  function tintProduct(id) { tintWhole(products[id]); }
  /* 把整張(跟原圖一樣大的)輪廓上色。2026-10之後平常已經不走這裡——畫陰影改用
     tintedAtSize()縮小後再上色，只有要畫的尺寸比輪廓還大時才會用到整張的。 */
  function tintWhole(p) {
    if (!p || !p.silhouette) return;
    if (p.tinted && p.tintedRGB === shadowRGB) return; // 顏色沒變，沿用上次上好色的輪廓
    var tinted = document.createElement('canvas');
    tinted.width = p.silhouette.width; tinted.height = p.silhouette.height;
    var tctx = tinted.getContext('2d');
    tctx.drawImage(p.silhouette, 0, 0);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = 'rgb(' + shadowRGB + ')';
    tctx.fillRect(0, 0, tinted.width, tinted.height);
    p.tinted = tinted;
    p.tintedRGB = shadowRGB;
  }

  /* 2026-10 效能：畫陰影時是把商品輪廓上好陰影色之後縮小蓋印很多次——主陰影
     28次、接地陰影3次。原本每次都拿「跟原圖一樣大」的上色輪廓(p.tinted)去縮，
     而且每換一次顏色就要把整張大圖重新上色。改成：
       1. 先把黑色輪廓(p.silhouette)縮到「這次要畫的大小」存起來(p.silScaled)。
          這張跟顏色無關，商品大小沒變就一直沿用，只有縮放商品時才重做。
       2. 上色改在這張小圖上做(p.tintedScaled)，換底色時只要重新上色這張小的。
     「先縮小再上色」跟原本「先上色再縮小」畫出來是一樣的——上色只是把不透明
     的地方換成同一個顏色，透明度不變。
     要畫的尺寸比輪廓本身還大時(放大沒有意義)，退回用原本整張上色的p.tinted。 */
  function tintedAtSize(p, w, h) {
    var tw = Math.max(1, Math.ceil(w)), th = Math.max(1, Math.ceil(h));
    if (tw >= p.silhouette.width || th >= p.silhouette.height) {
      tintWhole(p);
      return p.tinted;
    }
    var sc = p.silScaled;
    if (!(sc && sc.width === tw && sc.height === th)) {
      sc = document.createElement('canvas');
      sc.width = tw; sc.height = th;
      var sctx = sc.getContext('2d');
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(p.silhouette, 0, 0, tw, th);
      p.silScaled = sc;
      p.tintedScaled = null;
    }
    var t = p.tintedScaled;
    if (t && t.width === tw && t.height === th && p.tintedScaledRGB === shadowRGB) return t;
    t = document.createElement('canvas');
    t.width = tw; t.height = th;
    var tctx = t.getContext('2d');
    tctx.drawImage(sc, 0, 0);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = 'rgb(' + shadowRGB + ')';
    tctx.fillRect(0, 0, tw, th);
    p.tintedScaled = t;
    p.tintedScaledRGB = shadowRGB;
    return t;
  }

  function detectAlphaTrim(img) {
    var c = document.createElement('canvas');
    var maxDim = 300;
    var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    c.width = w; c.height = h;
    var cctx = c.getContext('2d');
    cctx.drawImage(img, 0, 0, w, h);
    var top = 0, bottom = 0, left = 0, right = 0;
    try {
      var d = cctx.getImageData(0, 0, w, h).data;
      var minY = h, maxY = -1, minX = w, maxX = -1;
      var alphaThresh = 10;
      /* 2026-07-28 跟 Iona 確認新增：左右也一併偵測（不再像原本只找 y 就 break），
         算法比照 shadow-layout-receiver.js 的 calcTightBoundsRatio()，只是這裡回傳的是
         上下左右各自的留白比例，不是單一個緊密框物件——drawGroundShadow() 只需要
         left/right 拿來算水平置中修正，不需要完整的 tight bounds。 */
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var a = d[(y * w + x) * 4 + 3];
          if (a > alphaThresh) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      if (maxY >= 0) {
        top = minY / h; bottom = (h - 1 - maxY) / h;
        left = minX / w; right = (w - 1 - maxX) / w;
      }
    } catch (e) {
      console.warn('ShadowPlugin: 無法偵測透明留白，影子支點改用圖片原始邊界', e);
    }
    return { top: top, bottom: bottom, left: left, right: right };
  }

  // type: 'product'（貼地陰影，預設） 或 'person'（光暈陰影，可超出畫布下緣）
  function registerProduct(id, imgEl, type) {
    return new Promise(function (resolve) {
      function build() {
        var silhouette = buildSilhouette(imgEl);
        var trim = detectAlphaTrim(imgEl);
        products[id] = { img: imgEl, silhouette: silhouette, tinted: null, trim: trim, type: type || 'product' };
        // 2026-10：註冊時不再先把整張輪廓上色(每張都跟原圖一樣大，21格就是21張)，
        // 等真的要畫陰影時再由tintedAtSize()依要畫的大小上色。
        resolve(products[id]);
      }
      if (imgEl.complete && imgEl.naturalWidth) build();
      else imgEl.onload = build;
    });
  }

  function removeProduct(id) { delete products[id]; }
  function getType(id) { return products[id] ? products[id].type : null; }

  function stampLayer(targetCtx, tinted, ox, oy, pw, ph, shear, squash, spread, totalAlpha, samples) {
    if (!tinted) return;
    targetCtx.save();
    targetCtx.globalCompositeOperation = 'multiply';
    targetCtx.globalAlpha = totalAlpha / samples;
    for (var i = 0; i < samples; i++) {
      var ang = (i / samples) * Math.PI * 2 * 2.4;
      var rad = spread * Math.sqrt((i + 0.5) / samples);
      var dx = Math.cos(ang) * rad;
      var dy = Math.sin(ang) * rad * 0.4;
      targetCtx.save();
      targetCtx.translate(ox + dx, oy + dy);
      targetCtx.transform(1, 0, shear, squash, 0, 0);
      targetCtx.drawImage(tinted, -pw / 2, -ph, pw, ph);
      targetCtx.restore();
    }
    targetCtx.restore();
  }

  /* 接地陰影「左右橫向模糊」專用：canvas的filter:blur()本身是上下左右等比例
     模糊，沒辦法只挑一個方向。做法是先把來源畫面垂直拉高很多倍貼到暫存canvas，
     這時候同一個blur(px)套上去，因為畫面被拉高了，等比例模糊在「拉高後的垂直
     方向」上造成的視覺模糊幅度會被稀釋到幾乎看不出來，但水平方向沒被拉伸、
     模糊幅度不變——等於變相做出「只有水平方向在暈」的效果，再把畫面壓回原本
     高度貼回去。跟主陰影柔化(soft/tailBlur那組)完全獨立，只影響接地陰影本身。 */
  function blurHorizontalOnly(srcCanvas, radiusPx) {
    if (radiusPx <= 0) return srcCanvas;
    var STRETCH = 14;
    var w = srcCanvas.width, h = srcCanvas.height;
    var tall = document.createElement('canvas');
    tall.width = w; tall.height = h * STRETCH;
    var tctx = tall.getContext('2d');
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(srcCanvas, 0, 0, w, h, 0, 0, w, h * STRETCH);

    var blurred = document.createElement('canvas');
    blurred.width = w; blurred.height = h * STRETCH;
    var bctx = blurred.getContext('2d');
    bctx.filter = 'blur(' + radiusPx + 'px)';
    bctx.drawImage(tall, 0, 0);
    bctx.filter = 'none';

    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(blurred, 0, 0, w, h * STRETCH, 0, 0, w, h);
    return out;
  }

  /* 旋轉輔助：繞 (cx,cy) 把 ctx 轉 rotDeg 度，執行 fn()，再還原。
     rotDeg 為 0 或 undefined 時直接呼叫 fn()，不做多餘的 save/restore。 */
  function withRotation(ctx, cx, cy, rotDeg, fn) {
    if (!rotDeg) { fn(); return; }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotDeg * Math.PI / 180);
    ctx.translate(-cx, -cy);
    fn();
    ctx.restore();
  }

  // ---- 商品：貼地陰影（原本效果，參數已固定） ----
  function drawGroundShadow(ctx, id, state, occluderMask, skipPhoto) {
    var p = products[id];
    if (!p || !p.silhouette) return;

    var pw = state.w, ph = state.h;
    var cx = state.x;
    var squash = FIXED.squash;
    var trimBottomPad = p.trim ? p.trim.bottom * ph : 0;
    var py = state.y + trimBottomPad; // 貼照片本體用：1:1 沒有形變，留白要整段補回去才會對齊
    /* 影子錨點跟貼照片的錨點不能共用同一個 py──
       貼地陰影會整張被 squash（0.32）壓扁，PNG 下緣的透明留白也會被同比例壓扁，
       所以影子錨點只需要補回「壓扁後」的留白量（trimBottomPad*squash），
       如果比照貼照片那樣補回整段沒壓縮的 trimBottomPad，留白越多錨點就會被推得越低，
       壓扁後影子的可視範圍反而懸空浮在商品下方（PNG 留白比例小的圖幾乎看不出來，比例大的就會明顯脫開）。 */
    /* 海外購物節保留：陰影獨立位置位移（畫布寬/高的比例），整組陰影一起平移、商品本體不動。 */
    var shadowOffX = (state.shadowOffsetX || 0) * ctx.canvas.width;
    var shadowOffY = (state.shadowOffsetY || 0) * ctx.canvas.height;
    var shadowGroundY = state.y + trimBottomPad * squash + shadowOffY;

    /* 2026-07-28 跟 Iona 確認新增：水平置中修正——只影響「影子」的水平支點，
       商品照片本身的位置（py、cx - pw/2 那段）完全不動。如果商品PNG左右留白不對稱
       （例如商品整個偏在圖片左邊、右邊留白比較多），影子的傾斜支點原本是抓整張
       原圖的中心，會跟商品視覺上的真正中心對不齊，讓斜切看起來像整個偏移，不只是
       刻意的斜切角度而已。這裡用 trim.left/trim.right 算出偏移量，只套用在
       shadowCx（下面畫影子用），pivotX／cx（商品照片、旋轉樞紐）維持原樣。 */
    var trimCenterOffsetX = p.trim ? (p.trim.left - p.trim.right) * pw / 2 : 0;
    var shadowCx = cx + trimCenterOffsetX + shadowOffX;

    /* 2026-07-28 跟 Iona 確認新增：陰影不跟著商品旋轉。
       原本 withRotation() 包住整段（補強陰影＋主陰影＋照片），旋轉商品時陰影會
       跟著轉。現在改成：陰影（補強陰影、主斜切陰影）直接畫在未旋轉的 ctx 上，
       只有商品照片本身包在 withRotation() 裡面旋轉。旋轉樞紐 pivotX/pivotY 只
       給照片旋轉用，不影響陰影的錨點計算（shadowCx/shadowGroundY 維持原樣）。 */
    var pivotX = cx, pivotY = state.y - ph / 2;
    var rot = state.rot || 0;

    /* 陰影獨立 X/Y 縮放（跟商品照片本體大小/位置完全脫鉤）：
       spw/sph 只給下面「主斜切陰影」那一段使用，商品照片本體（withRotation()裡
       drawImage(p.img,...)那行）跟緊接在下面的「接地補強陰影」永遠吃原始 pw/ph，
       不受這兩個倍率影響——接地補強陰影是模擬商品實際接地的那一小條，不管左右
       主陰影怎麼調，接地的地方視覺上都該維持一致。 */
    var shadowScaleX = state.shadowScaleX || 1;
    var shadowScaleY = state.shadowScaleY || 1;
    var spw = pw * shadowScaleX;
    var sph = ph * shadowScaleY;

    /* 2026-07-28 跟 Iona 確認新增／調整：接地補強陰影，改成固定 3px（原本試過
       用比例、5px、都覺得太厚，最後定案固定 3px）。
       做法：把商品去背輪廓整張稍微「往下拉長」3px，上緣固定不動、只有下緣往外
       延伸，這樣多出來的部分才會從商品照片底下露出來，形成補強陰影；商品照片
       畫在最上層蓋掉其餘部分，不影響原本外觀。
       2026-07-28 再跟 Iona 確認：商品一旦旋轉，這層補強陰影就不畫——它是貼著
       商品「未旋轉」的原始輪廓算的，旋轉之後商品實際角度變了，這層陰影不會
       跟著轉，位置會兜不起來，乾脆直接跳過，只保留原本的主斜切陰影。 */
    /* 2026-09 跟你確認整個改版：接地陰影從「固定2px、只往下、alpha寫死0.55」
       改成可調的「往上/往下各展開一段」，用skbn-shadow-test.html模擬器調出來
       的contactUpPx/contactDownPx/contactAlpha/contactBlurX這組數字。
       ⚠ py不是商品視覺上碰到地面的那條線——py是連同PNG底部透明留白一起算的
       完整方框底邊，真正碰地的輪廓邊緣在py往上trimBottomPad那麼多px的地方
       (也就是groundY，等於state.y本身)。一開始拿py當基準算「往上」的話，
       PNG留白比例大的商品，「往上」那段會整個落在透明留白裡完全看不到——
       這裡改用groundY，商品本體的輪廓形狀才會準確對到接地線上。
       ⚠ 這段畫在商品旋轉之前的ctx上、且SKBN這裡實際呼叫時skipPhoto永遠是
       true（商品照片本身由product-module.js自己另外畫，見那邊的
       _applyShadowColorFromBg），也就是這段畫完之後，product-module.js
       才會把商品照片畫上去蓋在最上層——所以陰影天生就在商品「後面」，
       「往上」那段只有商品邊緣半透明的羽化像素會透出一點點接地暗邊，
       實心部分不會被蓋到，不會有陰影跑到商品前面的問題。
       跟原本一樣：商品一旦旋轉就整段跳過（跟輪廓沒對齊，位置會兜不起來）。 */
    /* 2026-09再跟你確認：接地陰影不能跟著「陰影左右位移/陰影上下位移」那兩個
       滑桿一起移動——那兩個滑桿(shadowOffsetX/Y)是給主斜切陰影/中角度柔霧用的
       藝術性調整，接地陰影代表「商品實際碰到地面」的位置，商品本身沒有跟著
       滑桿移動，接地陰影當然也不該離開商品腳下，不然會變成「商品飄在半空、
       陰影卻黏在旁邊」的錯誤視覺。product-module.js那邊呼叫renderScene時，
       state.x/state.y已經是「商品原始位置 + 滑桿位移」疊加後的值(shx/shy)，
       這個plugin內部沒辦法反推位移量，所以請product-module.js額外多帶一組
       groundAnchorX/groundAnchorY(商品原始、沒有加位移的位置)進來，接地陰影
       這段專門吃這組值；沒有帶的話(例如代言人光暈那邊、或舊版呼叫端)就退回
       用cx/groundY，跟以前行為一樣，不會壞掉。 */
    var upPx = FIXED.contactUpPct / 100 * ph;
    var downPx = FIXED.contactDownPct / 100 * ph;
    if (!rot && (upPx > 0 || downPx > 0) && FIXED.contactAlpha > 0) {
      var trueCx = (state.groundAnchorX != null) ? state.groundAnchorX : cx;
      var trueGroundY = (state.groundAnchorY != null) ? state.groundAnchorY : (py - trimBottomPad);
      var bw = Math.ceil(pw) + 2, bh = Math.ceil(upPx + downPx) + 2;
      var imgYInTemp = trimBottomPad - ph + upPx; // p.tinted畫在temp canvas裡的y位置，讓輪廓真正的接地邊緣對齊temp的第upPx列
      /* 2026-10 效能：接地陰影這一小條分兩層快取。
         1. 形狀(contactMask)：剪裁+挖空+橫向模糊做出來的那一條，只跟商品大小
            有關，跟顏色、位置都無關。直接用黑色輪廓(p.silhouette，跟原圖一樣大，
            縮圖方式跟改版前完全相同)去做，商品大小沒變就一直沿用。
         2. 上色(contactCache)：把形狀整條換成陰影色。這一段全程只有單一顏色，
            「先做形狀再上色」跟原本「先上色再做形狀」結果一樣；換底色時只要
            重做這一步(一次填色)，不用重新剪裁+模糊。
         拖曳移動、拉陰影滑桿時兩層都沿用，只是貼到新位置。 */
      var maskKey = pw + '|' + ph;
      var contactMask = (p.contactMask && p.contactMask.key === maskKey) ? p.contactMask.canvas : null;
      if (!contactMask) {
        var contactSil = p.silhouette;

        // 往上那一半：商品自己的輪廓，剪裁只留最下面upPx那一條
        var aboveCanvas = document.createElement('canvas');
        aboveCanvas.width = bw; aboveCanvas.height = bh;
        var actx = aboveCanvas.getContext('2d');
        if (upPx > 0) {
          actx.save();
          actx.beginPath();
          actx.rect(0, 0, bw, upPx);
          actx.clip();
          actx.drawImage(contactSil, 0, imgYInTemp, pw, ph);
          actx.restore();
        }

        // 往下那一半：原本「位移+挖空」技巧，貼合輪廓、不是死板矩形
        var belowCanvas = document.createElement('canvas');
        belowCanvas.width = bw; belowCanvas.height = bh;
        var bctx2 = belowCanvas.getContext('2d');
        if (downPx > 0) {
          bctx2.globalCompositeOperation = 'source-over';
          bctx2.drawImage(contactSil, 0, imgYInTemp + downPx, pw, ph);
          bctx2.globalCompositeOperation = 'destination-out';
          bctx2.drawImage(contactSil, 0, imgYInTemp, pw, ph);
          bctx2.globalCompositeOperation = 'source-over';
        }

        var combinedContact = document.createElement('canvas');
        combinedContact.width = bw; combinedContact.height = bh;
        var comCtx = combinedContact.getContext('2d');
        comCtx.drawImage(aboveCanvas, 0, 0);
        comCtx.drawImage(belowCanvas, 0, 0);

        contactMask = blurHorizontalOnly(combinedContact, FIXED.contactBlurXPct / 100 * pw);
        p.contactMask = { key: maskKey, canvas: contactMask };
        p.contactCache = null;
      }
      var contactKey = maskKey + '|' + shadowRGB;
      var combinedBlurred = (p.contactCache && p.contactCache.key === contactKey) ? p.contactCache.canvas : null;
      if (!combinedBlurred) {
        combinedBlurred = document.createElement('canvas');
        combinedBlurred.width = contactMask.width; combinedBlurred.height = contactMask.height;
        var cbctx = combinedBlurred.getContext('2d');
        cbctx.drawImage(contactMask, 0, 0);
        cbctx.globalCompositeOperation = 'source-in';
        cbctx.fillStyle = 'rgb(' + shadowRGB + ')';
        cbctx.fillRect(0, 0, combinedBlurred.width, combinedBlurred.height);
        p.contactCache = { key: contactKey, canvas: combinedBlurred };
      }
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = FIXED.contactAlpha;
      ctx.drawImage(combinedBlurred, trueCx - pw / 2, trueGroundY - upPx);
      ctx.restore();
    }

    /* 2026-10：商品旋轉後，底部接地陰影也要保留。上面那段(!rot)是用「未旋轉」的
       輪廓算一條固定的底邊，旋轉後底邊位置會對不上，所以原本直接跳過——結果轉了商品
       底部的影子就整個消失。這裡改用「旋轉後的輪廓」重算：
       ①把輪廓照照片的旋轉角度/樞紐畫進一張只框住商品的暫存畫布
       ②往上那段＝輪廓減去「往上平移upPx的輪廓」(只剩朝下那一圈邊)
         往下那段＝「往下平移downPx的輪廓」減去輪廓(貼著輪廓下緣的細線)
       ③兩段合併、橫向模糊、上色，用multiply貼回去，跟沒旋轉時同樣的濃度/寬度。
       位置一樣吃groundAnchorX/Y(商品原始位置，不跟陰影位移滑桿走)。 */
    if (rot && (upPx > 0 || downPx > 0) && FIXED.contactAlpha > 0) {
      var cxT = (state.groundAnchorX != null) ? state.groundAnchorX : cx;
      var gYT = (state.groundAnchorY != null) ? state.groundAnchorY : (py - trimBottomPad);
      var pyT = gYT + trimBottomPad;
      var pivXT = cxT, pivYT = gYT - ph / 2;
      var rr = rot * Math.PI / 180, rcos = Math.cos(rr), rsin = Math.sin(rr);
      var cornersX = [cxT - pw / 2, cxT + pw / 2, cxT + pw / 2, cxT - pw / 2];
      var cornersY = [pyT - ph, pyT - ph, pyT, pyT];
      var mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (var ci = 0; ci < 4; ci++) {
        var dx0 = cornersX[ci] - pivXT, dy0 = cornersY[ci] - pivYT;
        var rx0 = pivXT + dx0 * rcos - dy0 * rsin, ry0 = pivYT + dx0 * rsin + dy0 * rcos;
        if (rx0 < mnx) mnx = rx0; if (rx0 > mxx) mxx = rx0;
        if (ry0 < mny) mny = ry0; if (ry0 > mxy) mxy = ry0;
      }
      var blurRx = FIXED.contactBlurXPct / 100 * pw;
      var mrg = Math.ceil(Math.max(upPx, downPx) + blurRx * 3) + 3;
      var rox = Math.floor(mnx) - mrg, roy = Math.floor(mny) - mrg;
      var rW = Math.ceil(mxx - mnx) + mrg * 2, rH = Math.ceil(mxy - mny) + mrg * 2;

      var rotSil = document.createElement('canvas');
      rotSil.width = rW; rotSil.height = rH;
      var rsctx = rotSil.getContext('2d');
      rsctx.save();
      rsctx.translate(-rox, -roy);
      withRotation(rsctx, pivXT, pivYT, rot, function () {
        rsctx.drawImage(p.silhouette, cxT - pw / 2, pyT - ph, pw, ph);
      });
      rsctx.restore();

      var rimUp = document.createElement('canvas');
      rimUp.width = rW; rimUp.height = rH;
      var rucx = rimUp.getContext('2d');
      if (upPx > 0) {
        rucx.drawImage(rotSil, 0, 0);
        rucx.globalCompositeOperation = 'destination-out';
        rucx.drawImage(rotSil, 0, -upPx);
        rucx.globalCompositeOperation = 'source-over';
      }
      var rimDown = document.createElement('canvas');
      rimDown.width = rW; rimDown.height = rH;
      var rdcx = rimDown.getContext('2d');
      if (downPx > 0) {
        rdcx.drawImage(rotSil, 0, downPx);
        rdcx.globalCompositeOperation = 'destination-out';
        rdcx.drawImage(rotSil, 0, 0);
        rdcx.globalCompositeOperation = 'source-over';
      }
      var rimAll = document.createElement('canvas');
      rimAll.width = rW; rimAll.height = rH;
      var racx = rimAll.getContext('2d');
      racx.drawImage(rimUp, 0, 0);
      racx.drawImage(rimDown, 0, 0);

      // blurHorizontalOnly會把畫布垂直拉高14倍再模糊，太高(>16000px)瀏覽器會放棄畫圖，這種極端情況就不模糊
      var rimBlur = (rH * 14 <= 16000) ? blurHorizontalOnly(rimAll, blurRx) : rimAll;
      var rtc = rimBlur.getContext('2d');
      rtc.globalCompositeOperation = 'source-in';
      rtc.fillStyle = 'rgb(' + shadowRGB + ')';
      rtc.fillRect(0, 0, rimBlur.width, rimBlur.height);
      rtc.globalCompositeOperation = 'source-over';

      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = FIXED.contactAlpha;
      ctx.drawImage(rimBlur, rox, roy);
      ctx.restore();
    }

    var angle = opts.angle * Math.PI / 180;
    var soft = FIXED.softPct / 100 * ph;
    var fadeMul = FIXED.fade / 100;
    var occludeStrength = FIXED.occlude / 100;
    var shear = Math.tan(angle * 0.55);
    var maxSpread = soft * 1.8;

    /* 2026-08 光源角度選「中」（光源正上方、angle=0、完全沒有斜切）時，只要
       接地補強陰影那一小條就好，不要再疊主斜切陰影——主斜切陰影在angle=0時
       視覺上就是一坨直直往下的模糊陰影，跟接地陰影疊在一起反而顯得厚重/多餘，
       所以選「中」整段跳過主陰影，只留最單純的接地陰影。
       2026-09一度加過一個「topMainShadowAlpha」柔霧主陰影(拿商品輪廓放大/
       壓扁/模糊墊在商品下方)，你試過之後反饋「越來越糟糕」，已經整個拿掉、
       退回原本「中角度只留接地陰影」的做法，不再有這個參數。 */
    var isTop = (opts.presetName === 'top');
    if (!isTop) {
      var halfW = spw / 2 + Math.abs(shear) * sph + maxSpread * 2 + 20;
      var tempW = Math.ceil(halfW * 2);
      var tempH = Math.ceil(sph * squash * 2 + maxSpread * 2 + 40);
      var anchorX = halfW;
      var anchorY = Math.ceil(tempH * 0.5);

      /* 2026-10 效能：主陰影這張圖(蓋印28次+尾端模糊+淡出)長什麼樣子，只跟
         商品大小、光源角度、陰影顏色有關，跟畫在哪個位置無關。拖曳移動商品、
         拉「陰影左右/上下位移」滑桿都只是換位置——這幾樣沒變就直接沿用上次
         算好的那張，貼到新位置就好；只有縮放商品、換角度、換底色才需要重算。
         有開遮擋(occlude，目前是0沒在用)時形狀會跟位置有關，那種情況不快取。 */
      var mainKey = spw + '|' + sph + '|' + opts.angle + '|' + shadowRGB;
      var canCacheMain = !(occludeStrength > 0 && occluderMask);
      var tmp = (canCacheMain && p.mainShadowCache && p.mainShadowCache.key === mainKey) ? p.mainShadowCache.canvas : null;
      if (!tmp) {
      tmp = document.createElement('canvas');
      tmp.width = tempW; tmp.height = tempH;
      var tctx = tmp.getContext('2d');

      var stampTint = tintedAtSize(p, spw, sph); // 2026-10：先縮到要畫的大小再蓋印，見tintedAtSize
      stampLayer(tctx, stampTint, anchorX, anchorY, spw, sph, shear, squash, soft * 1.8, 0.28, 12);
      stampLayer(tctx, stampTint, anchorX, anchorY, spw, sph, shear, squash, soft * 0.8, 0.4, 10);
      stampLayer(tctx, stampTint, anchorX, anchorY, spw, sph, shear, squash, soft * 0.25, 0.35, 6);

      if (occludeStrength > 0 && occluderMask) {
        tctx.save();
        tctx.globalCompositeOperation = 'destination-out';
        tctx.globalAlpha = occludeStrength;
        tctx.drawImage(occluderMask, -(shadowCx - anchorX), -(shadowGroundY - anchorY));
        tctx.restore();
      }

      /* ⚠ 2026-09你抓到的bug：尾端淡出的漸層原本用(anchorX+tipX, anchorY+tipY)
         這條斜線當漸層軸——tipX是shear*sph算出來的，跟商品「寬度」完全無關，
         但漸層的方向卻同時有X跟Y分量，導致同一列(row)裡，離錨點X越遠的像素
         (也就是商品越寬、離中心越遠的部分)，投影到這條斜線上的t值也跟著跑，
         寬商品左右兩側還沒開始往後延伸，投影就已經算到接近1(全透明)，等於
         寬商品的陰影還沒真的「畫出多遠」，光是自己的寬度就先把自己淡出去了
         ——這就是為什麼細長商品的尾巴還看得到、寬扁商品的陰影卻整個消失。
         修法：漸層改成純垂直方向(只留tipY，拿掉tipX)。因為stampLayer裡的
         transform(1,0,shear,squash,0,0)讓canvas的Y座標本來就只吃squash*y，
         跟X完全無關(shear只影響X)──也就是說「同一個canvasY」對應的本來就是
         商品輪廓上「同一個高度」，不管那一列多寬。改成純垂直漸層後，淡出程度
         只跟「這個點原本在商品輪廓上多高」有關，同一列不管多寬都用同一個透明度，
         寬扁商品跟細長商品的尾巴淡出速度才會一致。 */
      var tipY = -squash * sph * fadeMul - soft * 0.6;

      /* 2026-09新增：尾端漸進模糊。根部維持原本較清楚的邊緣(接地感)，越往
         尾端越換成模糊版本，尾巴才不會在商品輪廓頂端留下一條銳利硬邊。
         tailBlur=0時整段不執行，畫面跟原本完全一樣。做法照抄
         shopee-3c-appliance-report專案shadow-plugin.js同一套。 */
      var tailBlurPx = FIXED.tailBlurPct / 100 * ph;
      if (tailBlurPx > 0) {
        var bs = Math.max(0, Math.min(0.9, FIXED.tailBlurStart));
        var be = Math.min(1, bs + Math.max(0.05, FIXED.tailBlurSpan));
        var blurred = document.createElement('canvas');
        blurred.width = tempW; blurred.height = tempH;
        var bctx = blurred.getContext('2d');
        bctx.filter = 'blur(' + tailBlurPx + 'px)';
        bctx.drawImage(tmp, 0, 0);
        bctx.filter = 'none';
        var gb = bctx.createLinearGradient(anchorX, anchorY, anchorX, anchorY + tipY);
        gb.addColorStop(0, 'rgba(255,255,255,0)');
        gb.addColorStop(bs, 'rgba(255,255,255,0)');
        gb.addColorStop(be, 'rgba(255,255,255,1)');
        gb.addColorStop(1, 'rgba(255,255,255,1)');
        bctx.globalCompositeOperation = 'destination-in';
        bctx.fillStyle = gb; bctx.fillRect(0, 0, tempW, tempH);
        var gs = tctx.createLinearGradient(anchorX, anchorY, anchorX, anchorY + tipY);
        gs.addColorStop(0, 'rgba(255,255,255,1)');
        gs.addColorStop(bs, 'rgba(255,255,255,1)');
        gs.addColorStop(be, 'rgba(255,255,255,0)');
        gs.addColorStop(1, 'rgba(255,255,255,0)');
        tctx.globalCompositeOperation = 'destination-in';
        tctx.fillStyle = gs; tctx.fillRect(0, 0, tempW, tempH);
        tctx.globalCompositeOperation = 'lighter';
        tctx.drawImage(blurred, 0, 0);
        /* 模糊版會往接地線下方暈開，下面統一的5px硬裁切會在那邊留一條直線邊，
           所以這裡先把接地線下緣做一小段羽化，硬裁切就看不出來了。 */
        tctx.globalCompositeOperation = 'destination-in';
        var gf = tctx.createLinearGradient(0, anchorY - 2, 0, anchorY + 5);
        gf.addColorStop(0, 'rgba(255,255,255,1)');
        gf.addColorStop(1, 'rgba(255,255,255,0)');
        tctx.fillStyle = gf; tctx.fillRect(0, 0, tempW, tempH);
        tctx.globalCompositeOperation = 'source-over';
      }

      tctx.globalCompositeOperation = 'destination-in';
      var grad = tctx.createLinearGradient(anchorX, anchorY, anchorX, anchorY + tipY);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(FIXED.tailMid, 'rgba(255,255,255,' + FIXED.tailMidAlpha + ')');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      tctx.fillStyle = grad;
      tctx.fillRect(0, 0, tempW, tempH);
      tctx.globalCompositeOperation = 'source-over';
      if (canCacheMain) p.mainShadowCache = { key: mainKey, canvas: tmp };
      }

      /* 柔化用的「霧化取樣」（stampLayer 裡的 spread 抖動）本來就會讓陰影邊緣稍微
         超出接地線一點點，商品底部以下超過約5px的部分裁掉，避免陰影明顯滲到商品
         下緣之外。裁切範圍用畫布寬度*3當左右保險值（涵蓋斜切後可能跑到很旁邊的
         情況），不影響左右延伸，只切掉下緣。 */
      ctx.save();
      ctx.beginPath();
      var clipMarginBelow = 5;
      var clipSpanX = ctx.canvas.width * 3;
      ctx.rect(shadowCx - clipSpanX, shadowGroundY - clipSpanX, clipSpanX * 2, clipSpanX + clipMarginBelow);
      ctx.clip();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(tmp, shadowCx - anchorX, shadowGroundY - anchorY);
      ctx.restore();
    }

    if (!skipPhoto && p.img.complete && p.img.naturalWidth) {
      withRotation(ctx, pivotX, pivotY, rot, function () {
        ctx.drawImage(p.img, cx - pw / 2, py - ph, pw, ph);
      });
    }
  }

  // ---- 代言人：光暈陰影（不倒地、後方縮小+微變形+模糊，可超出畫布下緣；跟隨主光源方向；碰到商品變透明） ----
  function drawPersonGlow(ctx, id, state, occluderMask, skipPhoto) {
    var p = products[id];
    if (!p || !p.silhouette) return;

    var pw = state.w, ph = state.h;
    var cx = state.x;
    var trimBottomPad = p.trim ? p.trim.bottom * ph : 0;
    var py = state.y + trimBottomPad;

    var pivotX = cx, pivotY = state.y - ph / 2;
    var rot = state.rot || 0;

    withRotation(ctx, pivotX, pivotY, rot, function () {
      var angle = opts.angle * Math.PI / 180;
      var shear = Math.tan(angle * 0.55);

      var glowScale = 0.93;
      var offsetX = -shear * ph * 0.08;  // 離人物更近一點
      var offsetY = ph * 0.018 + Math.abs(shear) * ph * 0.008;
      var deformX = 0.97, deformY = 1.03;
      var blurPx = Math.max(6, Math.round(pw * 0.035)); // 更模糊
      var alpha = 0.24; // 更淡

      var gw = pw * glowScale * deformX;
      var gh = ph * glowScale * deformY;
      var gx = cx + offsetX;
      var gy = py + offsetY;
      var sox = (state.shadowOffsetX || 0) * ctx.canvas.width;
      var soy = (state.shadowOffsetY || 0) * ctx.canvas.height;
      if (rot) {
        var rr = -rot * Math.PI / 180, rc = Math.cos(rr), rs = Math.sin(rr);
        var rx = sox * rc - soy * rs;
        soy = sox * rs + soy * rc; sox = rx;
      }
      gx += sox; gy += soy;

      var tmp = document.createElement('canvas');
      tmp.width = ctx.canvas.width; tmp.height = ctx.canvas.height;
      var tctx = tmp.getContext('2d');
      tctx.filter = 'blur(' + blurPx + 'px)';
      tctx.globalAlpha = alpha;
      tctx.drawImage(p.silhouette, gx - gw / 2, gy - gh, gw, gh);
      tctx.filter = 'none';

      if (occluderMask) {
        tctx.globalAlpha = 1;
        tctx.globalCompositeOperation = 'destination-out';
        tctx.drawImage(occluderMask, 0, 0);
        tctx.globalCompositeOperation = 'source-over';
      }

      ctx.drawImage(tmp, 0, 0);

      if (!skipPhoto && p.img.complete && p.img.naturalWidth) {
        ctx.drawImage(p.img, cx - pw / 2, py - ph, pw, ph);
      }
    });
  }

  function drawItem(ctx, id, state, occluderMask, skipPhoto) {
    var type = getType(id);
    if (type === 'person') drawPersonGlow(ctx, id, state, occluderMask, skipPhoto);
    else drawGroundShadow(ctx, id, state, occluderMask, skipPhoto);
  }


  function renderScene(ctx, items, skipPhoto) {
    // 給「代言人光暈」用的完整遮罩：所有商品 + 所有代言人本身的輪廓都算進去，
    // 這樣不管是碰到商品、還是兩個代言人互相重疊，重疊處的光暈都會消失
    // （旋轉過的 item 也要把輪廓畫在正確的旋轉後位置，遮罩才會準）
    var personGlowMask = document.createElement('canvas');
    personGlowMask.width = ctx.canvas.width;
    personGlowMask.height = ctx.canvas.height;
    var pgctx = personGlowMask.getContext('2d');
    items.forEach(function (state) {
      var p = products[state.id];
      if (p && p.silhouette) {
        var pad = p.trim ? p.trim.bottom * state.h : 0;
        var py = state.y + pad;
        var pivotY = state.y - state.h / 2;
        withRotation(pgctx, state.x, pivotY, state.rot || 0, function () {
          pgctx.drawImage(p.silhouette, state.x - state.w / 2, py - state.h, state.w, state.h);
        });
      }
    });

    // 給「商品貼地陰影」用的遮罩：沿用原本邏輯，只有已經畫過的商品才會擋住後面商品的陰影
    var runningMask = document.createElement('canvas');
    runningMask.width = ctx.canvas.width;
    runningMask.height = ctx.canvas.height;
    var rmctx = runningMask.getContext('2d');

    // 疊放順序：直接尊重呼叫端給的陣列順序（陣列前面＝後方，後面＝前方），
    // 方便外部提供「手動拖曳排序的圖層清單」；不再自動依 Y 座標排序，
    // 避免身形較高/較長的人物因為錨點 Y 值大就一律被排到最前面。
    var order = items;
    order.forEach(function (state) {
      var p = products[state.id];
      var isPerson = p && p.type === 'person';
      drawItem(ctx, state.id, state, isPerson ? personGlowMask : runningMask, skipPhoto);
      if (p && p.silhouette && !isPerson) {
        var pad = p.trim ? p.trim.bottom * state.h : 0;
        var py = state.y + pad;
        var pivotY = state.y - state.h / 2;
        withRotation(rmctx, state.x, pivotY, state.rot || 0, function () {
          rmctx.drawImage(p.silhouette, state.x - state.w / 2, py - state.h, state.w, state.h);
        });
      }
    });
  }

  // 只畫商品/主持人照片本體，完全不含陰影效果（給匯出時分層合成用，
  // 避免用「去背景色算透明度」的方式處理陰影時，連帶把照片裡的淺色/白色內容也誤判成透明）
  function renderPhotosOnly(ctx, items) {
    items.forEach(function (state) {
      var p = products[state.id];
      if (!p || !p.img || !p.img.complete || !p.img.naturalWidth) return;
      var pw = state.w, ph = state.h;
      var cx = state.x;
      var trimBottomPad = p.trim ? p.trim.bottom * ph : 0;
      var py = state.y + trimBottomPad;
      var pivotY = state.y - ph / 2;
      withRotation(ctx, cx, pivotY, state.rot || 0, function () {
        ctx.drawImage(p.img, cx - pw / 2, py - ph, pw, ph);
      });
    });
  }

  return {
    ANGLE_PRESETS: ANGLE_PRESETS,
    setAngle: setAngle,
    configureZone: configureZone,
    snapshotAngleZone: snapshotAngleZone,
    restoreAngleZone: restoreAngleZone,
    setBackground: setBackground,
    getRawBackgroundRGB: getRawBackgroundRGB,
    setShadowColorRGB: setShadowColorRGB,
    getShadowColorRGB: getShadowColorRGB,
    unlockShadowColor: unlockShadowColor,
    registerProduct: registerProduct,
    removeProduct: removeProduct,
    getType: getType,
    renderScene: renderScene,
    setParams: function (o) { for (var k in o) if (k in FIXED) FIXED[k] = +o[k]; },
    getParams: function () { var r = {}; for (var k in FIXED) r[k] = FIXED[k]; return r; },
    renderPhotosOnly: renderPhotosOnly,
    _products: products
  };
})();
