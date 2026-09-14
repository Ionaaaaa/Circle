'use strict';
/*
  Pricetag Module —— 商品旁的「小標」（原價劃線／特價醒目）
  ------------------------------------------------------------
  2026-09第二次改版：
    1) 寬度改成「依文字內容動態決定」——不再是固定217:98比例。高度才是
       固定的尺寸依據(NATIVE_H=98)，寬度＝圓孔那一側固定寬度(LEFT_ZONE_W)
       ＋文字區寬度(取原價/標價兩行中較寬的那個＋TEXT_PADDING*2)＋右側
       固定寬度(RIGHT_ZONE_W)。文字越長，票券自動越寬，兩側文字留白
       (TEXT_PADDING)固定20px(native)。
    2) 形狀參數(SHAPE)全部集中成一個物件，故意設計成可以被外部(例如
       pricetag-shape-simulator.html)直接讀取/覆蓋，不用改這支檔案本身
       就能微調形狀——調好之後把最終的SHAPE數值交給我，我再把這份預設
       值更新掉即可。

  規格來源：使用者提供的 蝦皮超划算.json（PSD匯出）+ 券.png(實際像素量測)：
    - 原價：字級較小（例：$490/32入）
    - 優惠價：字級較大＋Bold（例：$313/32入）
    - 兩行文字都是「符號／單位小、數字大」的混合字級排法：抓文字裡的
      連續數字段落用大字級，其餘（$、/32入這類）用小字級，不管位數多少
      都能套用同一份規格。
    - 底色/原價文字色/標價文字色：讀window.Theme.tagBg／tagOriginalColor／
      tagSaleColor（見js/theme-loader.js），找不到才退回FALLBACK_COLORS。

  方向（左／右）：
    orientation==='left'＝圓孔在左（跟你提供的券.png一致，不做鏡射）；
    'right'＝鏡射版本(圓孔在右)。形狀鏡射用ctx.scale(-1,1)；文字/範圍框
    的鏡射另外算鏡射後座標(見toCanvasX)，兩者疊在一起還是對得整齊。
*/
window.Modules = window.Modules || {};

window.Modules.pricetag = (function(){
  var NATIVE_H = 98; // 高度固定，寬度動態(見computeNativeSize)

  var FALLBACK_COLORS = { tagBg:'#ff4f11', tagOriginalColor:'#ffffff', tagSaleColor:'#fff000' };
  function themeColor(key){
    return (window.Theme && window.Theme[key]) || FALLBACK_COLORS[key];
  }

  /* 字級/字重設定（顏色從theme讀，不寫死在這裡）。y/h還是固定在98高度的
     框架下量的，不受寬度動態影響（高度本來就沒有要跟著文字變）。 */
  var LAYERS = {
    original: {
      y:15, h:28,
      font: { baseFontPx:21, bigFontPx:29.7, weight:400, colorKey:'tagOriginalColor' }
    },
    sale: {
      y:45, h:39,
      font: { baseFontPx:28, bigFontPx:39.7, weight:700, colorKey:'tagSaleColor' }
    }
  };

  /* 形狀參數——全部是「98高度」這個基準下量的native px，跟寬度無關
     (寬度本來就是動態算出來的，形狀參數只描述「長什麼樣子」，不描述
     「多寬」)。想調形狀的話，這整包物件都可以被
     pricetag-shape-simulator.html直接讀取/覆蓋、即時預覽。
       - LEFT_ZONE_W：圓孔那一側(含斜切)固定佔用的寬度，不隨文字變化
       - RIGHT_ZONE_W：另一側(平行邊)固定佔用的寬度
       - chamferX/chamferY：圓孔側兩個角斜切的水平/垂直距離
       - straightCornerR：平行邊那一側的圓角半徑
       - holeR/holeOffsetX：圓孔半徑/圓孔中心離左邊緣的距離
       - marginT/marginB：形狀本體跟畫布上下邊緣的留白 */
  var SHAPE = {
    marginT: 7, marginB: 4,
    textPadding: 14, // 文字區左右留白(native px)——2026-09使用者反映22太多，收窄一點
    LEFT_ZONE_W: 27,
    RIGHT_ZONE_W: 8, // 後方(平行邊)固定寬度——2026-09使用者反映跟文字距離要再短一點，14→8
    chamferX: 23,
    chamferY: 16,
    straightCornerR: 2,
    holeR: 6,
    holeOffsetX: 24
  };

  /* 依文字內容算出這個小標「應該多寬」(native px，98高度基準下)。
     取原價/標價兩行「文字內容寬度」較寬的那個，加上左右各TEXT_PADDING，
     再加上兩側固定區塊(LEFT_ZONE_W/RIGHT_ZONE_W)。
     ctx只拿來measureText，不會真的畫東西，呼叫端隨便傳一個2d context
     進來就好(要有字型可以量才準，字型還沒載入完會用瀏覽器預設字型量，
     字型載入後如果尺寸有差，下一次呼叫會自動用新的量測結果，不用特別
     處理"字型還沒載完"這件事)。 */
  function measureLineWidth(ctx, text, weight, baseFontPx, bigFontPx){
    if(!text) return 0;
    var parts = splitPriceText(text);
    ctx.font = fontStr(weight, bigFontPx);
    var digitsW = ctx.measureText(parts.digits).width;
    ctx.font = fontStr(weight, baseFontPx);
    var prefixW = ctx.measureText(parts.prefix).width;
    var suffixW = ctx.measureText(parts.suffix).width;
    return prefixW + digitsW + suffixW;
  }

  function computeNativeSize(ctx, originalPrice, salePrice){
    var oW = measureLineWidth(ctx, originalPrice, LAYERS.original.font.weight, LAYERS.original.font.baseFontPx, LAYERS.original.font.bigFontPx);
    var sW = measureLineWidth(ctx, salePrice, LAYERS.sale.font.weight, LAYERS.sale.font.baseFontPx, LAYERS.sale.font.bigFontPx);
    var textContentW = Math.max(oW, sW);
    var textZoneW = textContentW + SHAPE.textPadding*2;
    var nativeW = SHAPE.LEFT_ZONE_W + textZoneW + SHAPE.RIGHT_ZONE_W;
    return { nativeW: nativeW, nativeH: NATIVE_H, textZoneW: textZoneW };
  }

  /* 給呼叫端（js/shadow-system/pricetag-interaction.js）用：已知想要的
     顯示高度(hPx，畫布px)，回傳這個小標實際該畫多寬(wPx)。高度固定不變、
     寬度依內容動態算，這支就是「動態寬度」機制的對外入口。 */
  function computeSize(ctx, hPx, originalPrice, salePrice){
    var native = computeNativeSize(ctx, originalPrice, salePrice);
    var scale = hPx / native.nativeH;
    return { w: native.nativeW * scale, h: hPx };
  }

  /* 畫本體形狀（圓孔側斜切＋另一側平行邊）＋挖一個真正透明的圓孔（會透出
     票券後面的商品/背景，不是實色填滿）。
     永遠用「圓孔在左」這個canonical方向畫在local(0,0)~(w,h)這個框裡，
     orientation==='right'時外層呼叫端自己做ctx.scale(-1,1)鏡射。 */
  function drawShapeCanonical(ctx, w, h, fillColor){
    var s = h / NATIVE_H; // 用高度算scale(寬度是動態的，不能拿來算比例)
    var left = 0, top = SHAPE.marginT*s;
    var right = w, bottom = h - SHAPE.marginB*s;
    var chamferX = SHAPE.chamferX*s, chamferY = SHAPE.chamferY*s;
    var cornerR = SHAPE.straightCornerR*s;
    var cy = (top+bottom)/2;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left+chamferX, top);
    ctx.lineTo(right-cornerR, top);
    ctx.arcTo(right, top, right, top+cornerR, cornerR);
    ctx.lineTo(right, bottom-cornerR);
    ctx.arcTo(right, bottom, right-cornerR, bottom, cornerR);
    ctx.lineTo(left+chamferX, bottom);
    ctx.lineTo(left, bottom-chamferY);
    ctx.lineTo(left, top+chamferY);
    ctx.lineTo(left+chamferX, top);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(left+SHAPE.holeOffsetX*s, cy, SHAPE.holeR*s, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  function splitPriceText(str){
    var m = /^(\D*)(\d+)(.*)$/.exec(str || '');
    if(!m) return { prefix:'', digits: str || '', suffix:'' };
    return { prefix:m[1], digits:m[2], suffix:m[3] };
  }

  function fontStr(weight, px){
    return weight+' '+px+'px "ShopeeNoto","Noto Sans TC",sans-serif';
  }

  function centerBaseline(ctx, weight, bigFontPx, frameCenterY){
    ctx.save();
    ctx.font = fontStr(weight, bigFontPx);
    var m = ctx.measureText('0');
    var ascent = m.actualBoundingBoxAscent || bigFontPx*0.72;
    var descent = m.actualBoundingBoxDescent || bigFontPx*0.2;
    ctx.restore();
    return frameCenterY + (ascent - descent)/2;
  }

  function drawMixedSizeText(ctx, text, centerX, baselineY, weight, color, baseFontPx, bigFontPx){
    var parts = splitPriceText(text);
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;

    ctx.font = fontStr(weight, bigFontPx);
    var digitsW = ctx.measureText(parts.digits).width;
    ctx.font = fontStr(weight, baseFontPx);
    var prefixW = ctx.measureText(parts.prefix).width;
    var suffixW = ctx.measureText(parts.suffix).width;

    var totalW = prefixW + digitsW + suffixW;
    var x = centerX - totalW/2;

    ctx.font = fontStr(weight, baseFontPx);
    ctx.fillText(parts.prefix, x, baselineY);
    x += prefixW;
    ctx.font = fontStr(weight, bigFontPx);
    ctx.fillText(parts.digits, x, baselineY);
    x += digitsW;
    ctx.font = fontStr(weight, baseFontPx);
    ctx.fillText(parts.suffix, x, baselineY);
    ctx.restore();
  }

  /*
    draw(ctx, opts)
    opts:
      x, y      —— 小標「左上角」畫在目標canvas上的位置(px)
      h         —— 小標的顯示高度(px)，寬度會依文字內容自動算，見computeSize()
      w         —— 選填；沒給的話這裡會自己呼叫computeSize()算一次。呼叫端
                    如果已經呼叫過computeSize()算好w，直接傳進來可以省一次
                    重複的measureText。
      orientation —— 'left'（預設，圓孔在左）或 'right'（鏡射，圓孔在右）
      originalPrice —— 原價字串，例如 "$490/32入"，留空不畫這一行
      salePrice     —— 特價字串，例如 "$313/32入"
  */
  function draw(ctx, opts){
    if(!opts) return;
    var orientation = opts.orientation === 'right' ? 'right' : 'left';
    var h = opts.h;
    var native = computeNativeSize(ctx, opts.originalPrice, opts.salePrice);
    var w = (typeof opts.w === 'number') ? opts.w : (native.nativeW * (h/native.nativeH));
    var scale = h / native.nativeH;
    var nativeW = native.nativeW;

    ctx.save(); // 包住整個draw()裡的畫布狀態變更(fillStyle/font等)，結尾的ctx.restore()會還原回呼叫端進來之前的狀態

    // 先在一張獨立的離屏畫布上畫「外殼+挖孔」，這張畫布本身是透明背景，
    // 挖孔挖的是「這張畫布自己的透明底」，不會影響/擦到主畫布任何東西。
    var off = (typeof document !== 'undefined' && document.createElement)
      ? document.createElement('canvas')
      : null;
    if(off){
      off.width = Math.max(1, Math.ceil(w));
      off.height = Math.max(1, Math.ceil(h));
      var offCtx = off.getContext('2d');
      drawShapeCanonical(offCtx, off.width, off.height, themeColor('tagBg'));
    }

    ctx.save();
    if(orientation === 'right'){
      ctx.translate(opts.x + w, opts.y);
      ctx.scale(-1, 1);
      if(off) ctx.drawImage(off, 0, 0, w, h); else drawShapeCanonical(ctx, w, h, themeColor('tagBg'));
    } else {
      ctx.translate(opts.x, opts.y);
      if(off) ctx.drawImage(off, 0, 0, w, h); else drawShapeCanonical(ctx, w, h, themeColor('tagBg'));
    }
    ctx.restore();

    function toCanvasY(localY){ return opts.y + localY * scale; }

    /* 文字區的local x：canonical(圓孔在左)時緊接在圓孔區(LEFT_ZONE_W)右邊；
       鏡射(圓孔在右)時，整個版面左右對調，原本「圓孔區(LEFT_ZONE_W)」現在
       換到畫面右側，原本「另一側固定區(RIGHT_ZONE_W)」換到畫面左側——所以
       文字區改成緊接在RIGHT_ZONE_W右邊，不是用mirrorX鏡射一個點的座標
       （鏡射一個「有寬度的區塊」不能只鏡射它的起點，起點鏡射完會變成
       右邊界，不是左邊界，用來當文字置中的基準點會整個算錯，文字就跑到
       票券外面去了——這裡直接依方向決定文字區在哪，不透過mirrorX）。 */
    var textZoneLocalX = (orientation === 'right') ? SHAPE.RIGHT_ZONE_W : SHAPE.LEFT_ZONE_W;
    var textZoneCenterX = opts.x + (textZoneLocalX + native.textZoneW/2) * scale;

    if(opts.originalPrice){
      var oFont = LAYERS.original.font;
      var oFrameCenterY = toCanvasY(LAYERS.original.y) + (LAYERS.original.h*scale)/2;
      var oBaselineY = centerBaseline(ctx, oFont.weight, oFont.bigFontPx*scale, oFrameCenterY);
      drawMixedSizeText(ctx, opts.originalPrice, textZoneCenterX, oBaselineY,
        oFont.weight, themeColor(oFont.colorKey), oFont.baseFontPx*scale, oFont.bigFontPx*scale);
    }

    if(opts.salePrice){
      var sFont = LAYERS.sale.font;
      var sFrameCenterY = toCanvasY(LAYERS.sale.y) + (LAYERS.sale.h*scale)/2;
      var sBaselineY = centerBaseline(ctx, sFont.weight, sFont.bigFontPx*scale, sFrameCenterY);
      drawMixedSizeText(ctx, opts.salePrice, textZoneCenterX, sBaselineY,
        sFont.weight, themeColor(sFont.colorKey), sFont.baseFontPx*scale, sFont.bigFontPx*scale);
    }

    ctx.restore();
  }

  return {
    NATIVE_H: NATIVE_H,
    SHAPE: SHAPE, // 故意整包暴露出去，給模擬器直接讀寫調整用
    computeSize: computeSize,
    draw: draw,
    /* 2026-09新增：給js/shadow-system/coupon-popup.js重用——券樣上的價格
       文字也是同一種「前綴/後綴字小、數字大」的排版方式(PSD匯出資料
       textStyleRanges證實)，不用另外重寫一份splitPriceText的regex。 */
    drawMixedSizeText: drawMixedSizeText,
    splitPriceText: splitPriceText
  };
})();
