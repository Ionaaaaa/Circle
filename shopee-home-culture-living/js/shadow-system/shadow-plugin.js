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
  var FIXED = {
    soft: 16,
    fade: 120,
    occlude: 80,
    squash: 0.32
  };
  var ANGLE_PRESETS = { left: -35, top: 0, right: 35 };

  var opts = { angle: ANGLE_PRESETS.left, presetName: 'left', topY: null, bottomY: null };
  var products = {}; // id -> { img, silhouette, tinted, trim, type }
  var shadowRGB = '202,136,32'; // #ca8820，備用預設值——正式值改由configs/theme.json的shadow欄位載入後，app init時呼叫setShadowColorRGB()覆蓋過去，這裡的值只在theme.json載入失敗時當退路，兩邊要記得對得起來
  var rawBgRGB = null; // 未乘0.8的原始背景取樣色，供拍立得框底色使用；還沒 setBackground 過就是 null
  var fixedColor = true; // 鎖定成上面指定的顏色，不會被setBackground()依背景取樣色蓋掉

  function setAngle(preset) {
    if (typeof preset === 'number') { opts.angle = preset; opts.presetName = null; return; }
    if (ANGLE_PRESETS[preset] != null) { opts.angle = ANGLE_PRESETS[preset]; opts.presetName = preset; }
  }
  function configureZone(topY, bottomY) { opts.topY = topY; opts.bottomY = bottomY; }

  function setShadowColorRGB(rgbStr) {
    shadowRGB = rgbStr; fixedColor = true;
    Object.keys(products).forEach(function (id) { tintProduct(id); });
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
  function tintProduct(id) {
    var p = products[id];
    if (!p || !p.silhouette) return;
    var tinted = document.createElement('canvas');
    tinted.width = p.silhouette.width; tinted.height = p.silhouette.height;
    var tctx = tinted.getContext('2d');
    tctx.drawImage(p.silhouette, 0, 0);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = 'rgb(' + shadowRGB + ')';
    tctx.fillRect(0, 0, tinted.width, tinted.height);
    p.tinted = tinted;
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
        tintProduct(id);
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
    if (!p || !p.tinted) return;

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
    var shadowGroundY = state.y + trimBottomPad * squash;

    /* 2026-07-28 跟 Iona 確認新增：水平置中修正——只影響「影子」的水平支點，
       商品照片本身的位置（py、cx - pw/2 那段）完全不動。如果商品PNG左右留白不對稱
       （例如商品整個偏在圖片左邊、右邊留白比較多），影子的傾斜支點原本是抓整張
       原圖的中心，會跟商品視覺上的真正中心對不齊，讓斜切看起來像整個偏移，不只是
       刻意的斜切角度而已。這裡用 trim.left/trim.right 算出偏移量，只套用在
       shadowCx（下面畫影子用），pivotX／cx（商品照片、旋轉樞紐）維持原樣。 */
    var trimCenterOffsetX = p.trim ? (p.trim.left - p.trim.right) * pw / 2 : 0;
    var shadowCx = cx + trimCenterOffsetX;

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
    if (!rot) {
      var CONTACT_GROW_PX = 3;
      var contactH = ph + CONTACT_GROW_PX;
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.4; // 2026-08再調整：使用者反映陰影太深，整體調淡一點（原本0.55）
      ctx.drawImage(p.tinted, cx - pw / 2, py - ph, pw, contactH);
      ctx.restore();
    }

    var angle = opts.angle * Math.PI / 180;
    var soft = FIXED.soft;
    var fadeMul = FIXED.fade / 100;
    var occludeStrength = FIXED.occlude / 100;
    var shear = Math.tan(angle * 0.55);
    var maxSpread = soft * 1.8;

    /* 2026-08 跟使用者確認：光源角度選「中」（原本按鈕文字是「上」，代表
       光源正上方、angle=0、完全沒有斜切）時，只要接地補強陰影那一小條就好，
       不要再疊主斜切陰影——主斜切陰影在angle=0時視覺上就是一坨直直往下的
       模糊陰影，跟接地補強陰影疊在一起反而顯得厚重/多餘，選「中」乾脆整段
       跳過，只留最單純的接地陰影。 */
    if (opts.presetName !== 'top') {
      var halfW = spw / 2 + Math.abs(shear) * sph + maxSpread * 2 + 20;
      var tempW = Math.ceil(halfW * 2);
      var tempH = Math.ceil(sph * squash * 2 + maxSpread * 2 + 40);
      var anchorX = halfW;
      var anchorY = Math.ceil(tempH * 0.5);

      var tmp = document.createElement('canvas');
      tmp.width = tempW; tmp.height = tempH;
      var tctx = tmp.getContext('2d');

      /* 2026-08再調整：使用者反映陰影太深，三層疊加的不透明度都調淡一點
         （0.28/0.4/0.35 → 0.2/0.28/0.25），相對比例跟原本差不多，只是
         整體變淺，柔化/漸層/形狀邏輯都沒動。 */
      stampLayer(tctx, p.tinted, anchorX, anchorY, spw, sph, shear, squash, soft * 1.8, 0.2, 12);
      stampLayer(tctx, p.tinted, anchorX, anchorY, spw, sph, shear, squash, soft * 0.8, 0.28, 10);
      stampLayer(tctx, p.tinted, anchorX, anchorY, spw, sph, shear, squash, soft * 0.25, 0.25, 6);

      if (occludeStrength > 0 && occluderMask) {
        tctx.save();
        tctx.globalCompositeOperation = 'destination-out';
        tctx.globalAlpha = occludeStrength;
        tctx.drawImage(occluderMask, -(shadowCx - anchorX), -(shadowGroundY - anchorY));
        tctx.restore();
      }

      var tipX = -shear * sph * fadeMul;
      var tipY = -squash * sph * fadeMul - soft * 0.6;
      tctx.globalCompositeOperation = 'destination-in';
      var grad = tctx.createLinearGradient(anchorX, anchorY, anchorX + tipX, anchorY + tipY);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      tctx.fillStyle = grad;
      tctx.fillRect(0, 0, tempW, tempH);
      tctx.globalCompositeOperation = 'source-over';

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
    setBackground: setBackground,
    getRawBackgroundRGB: getRawBackgroundRGB,
    setShadowColorRGB: setShadowColorRGB,
    getShadowColorRGB: getShadowColorRGB,
    unlockShadowColor: unlockShadowColor,
    registerProduct: registerProduct,
    removeProduct: removeProduct,
    getType: getType,
    renderScene: renderScene,
    renderPhotosOnly: renderPhotosOnly,
    _products: products
  };
})();
