'use strict';
/* Logo Module —— 通用化：layer.slot 是 'logo1' 或 'logo2'，各自去
   state.assets[slot] 拿圖、layoutMeta.positions.assets[slot] 拿位置。
   同一個Module程式碼服務兩個logo，不用寫兩份。
   pos.align==='center' 時 xPct 代表「中心點」而不是左上角，畫DD Card這種
   文案置中的版位要用這個，不然圖片寬度跟設計稿抓的不一樣時，中心點會偏掉。

   logo1/logo2同時存在時的分隔線規則：兩個logo中間畫一條2px線，線的兩側
   各留15px間距。★2026-09-23調整：顏色從白色改成蝦皮橘#EE4D2D（使用者確認）。
   ★ logo1.align==='center'（目前只有DD Card）時，這個xPct代表的是「整組
   (logo1+分隔線+logo2)攤開來的水平中心」，不是「logo1自己的中心」——
   有logo2時，logo1會往左讓一點，讓logo1+分隔線+logo2這一整條的視覺中心
   對齊xPct，不然logo1自己先置中、logo2再接在右邊，整組看起來會偏右邊
   （DD Card之前回報的問題）。只有logo1單獨存在（沒有logo2）時，才是
   logo1自己置中。
   align不是'center'的版位（3個橫幅版位，logo1固定靠左），不受影響，
   邏輯跟之前一樣：logo1固定在自己的xPct，logo2接在它右邊。

   ★2026-09新增，2026-09再擴大到所有版位（含align==='center'的DD Card）：
   分隔線兩側留白改成看「有色範圍(tight bounds)」而不是整張圖(含素材本身
   內建的透明留白)——很多LOGO素材圖片四周本來就留了一圈透明邊，如果直接
   拿「整張圖的框」去算分隔線位置/logo2起畫點，兩側視覺上的留白會被這圈
   內建透明邊放大、兩邊看起來不一樣寬(尤其logo1/logo2各自留白比例不同時
   更明顯)。改成用Core.calcTightBoundsRatio()量出每張圖真正「看得到顏色」
   的範圍，讓logo1的有色範圍右緣、logo2的有色範圍左緣，各自剛好距離分隔線
   gapBeforePx/gapAfterPx(15px)，兩側留白才會是真的一樣寬——兩顆logo的
   寬度(boxW1/boxW2)可以不一樣，只有「距離分隔線的間距」要一樣。
   align==='center'(DD Card)這邊現在也套用同一套tight bounds邏輯：整組
   置中改成用「兩顆logo各自的有色範圍寬度」加總去算總寬度/置中起點，
   不是整張圖(含透明留白)的寬度，這樣算出來的置中結果才會是「看得到的
   內容」整組置中。 */
window.Modules = window.Modules || {};

var LOGO_DIVIDER = { widthPx: 2, gapBeforePx: 15, gapAfterPx: 15, heightRatio: 0.5, color: '#EE4D2D' };

function _logoImgReady(img){
  return img instanceof HTMLImageElement && img.complete && img.naturalWidth;
}

/* 量出一張圖「有色範圍」在指定畫布框(box={x,y,w,h})裡對應到的left/right
   像素座標——沒有tight bounds資料(理論上不會發生，img已經ready過)就退回
   整個box的邊界，行為等同沒套用這個修正前的舊邏輯。 */
function _tightEdgesInBox(img, box){
  var t = (window.Core && typeof Core.calcTightBoundsRatio === 'function') ? Core.calcTightBoundsRatio(img) : null;
  if(!t) return { left: box.x, right: box.x + box.w };
  return { left: box.x + t.tx*box.w, right: box.x + (t.tx+t.tw)*box.w };
}

/* 量出一張圖「有色範圍」的寬度、跟「有色範圍左緣」相對於box左緣的偏移量
   (單位都是box座標系的px，也就是已經照這張圖畫上去的實際大小換算過)——
   給_logo1EffectiveBox()的置中計算用，跟_tightEdgesInBox()算的是同一件事，
   只是回傳格式比較方便拿來反推「box該畫在哪」。 */
function _tightWidthInBox(img, boxW){
  var t = (window.Core && typeof Core.calcTightBoundsRatio === 'function') ? Core.calcTightBoundsRatio(img) : null;
  if(!t) return { leftOffset: 0, width: boxW };
  return { leftOffset: t.tx*boxW, width: t.tw*boxW };
}

/* logo1「有效」的畫布位置：算好之後logo1、logo2兩邊的draw都呼叫同一支，
   確保兩邊算出來的logo1位置永遠一致（不會各算各的、兩邊兜不起來）。 */
/* 2026-09新增：logo2「取消白底(fillMode)」的「撐滿LOGO範圍高度」是在
   這裡（畫正式畫布時）發生，不是在LOGO2編輯popup裡——popup只負責讓使用者
   自由構圖，不管使用者在popup裡把LOGO2框得多滿/留了多少透明留白，套到
   正式畫布上都要保證「看得到的LOGO本體」撐滿整個LOGO範圍高度。做法是用
   tight bounds量出合成圖裡真正有色的那一小塊來源矩形(sx,sy,sw,sh)，畫的
   時候只裁這一小塊、拉伸畫滿目的地框，等於自動忽略掉popup裡留的任何
   透明留白。只有fillMode資產需要這樣處理——一般(有白底/色塊卡片)的
   logo2，留白是設計的一部分(圓角卡片的邊距)，不能裁掉，維持原本畫全圖
   的行為。沒有tight bounds資料(理論上不會發生)就回傳null，呼叫端退回
   畫全圖的舊行為。 */
function _logo2FillCropRect(state, img){
  if(!(state && state.logo2FillMode)) return null;
  var t = (window.Core && typeof Core.calcTightBoundsRatio === 'function') ? Core.calcTightBoundsRatio(img) : null;
  if(!t || !t.tw || !t.th) return null;
  var sw = t.tw * img.naturalWidth, sh = t.th * img.naturalHeight;
  if(!sw || !sh) return null;
  return { sx: t.tx*img.naturalWidth, sy: t.ty*img.naturalHeight, sw: sw, sh: sh, ratio: sw/sh };
}

function _logo1EffectiveBox(state, positions, w, h){
  var pos1 = positions && positions.assets && positions.assets.logo1;
  var img1 = state.assets && state.assets.logo1;
  if(!pos1 || !_logoImgReady(img1)) return null;

  var boxH1 = pos1.hPct * h;
  var ratio1 = img1.naturalWidth / img1.naturalHeight;
  var boxW1 = boxH1 * ratio1;
  var y1 = pos1.yPct * h;
  var x1;

  if(pos1.align === 'center'){
    var t1 = _tightWidthInBox(img1, boxW1);
    var pos2 = positions.assets.logo2;
    var img2 = state.assets && state.assets.logo2;
    var centerX = pos1.xPct * w;
    if(pos2 && _logoImgReady(img2)){
      var boxH2 = pos2.hPct * h;
      var boxW2 = boxH2 * (img2.naturalWidth / img2.naturalHeight);
      var t2 = _tightWidthInBox(img2, boxW2);
      /* 整組「看得到的內容」總寬度＝logo1有色範圍寬 + 兩側間距 + 分隔線
         + logo2有色範圍寬，用這個去算置中起點，不是整張圖(含透明留白)的
         寬度——這樣兩顆logo各自留白比例不同時，整組視覺上還是會準確置中，
         不會因為某一邊留白比較多而偏移。 */
      var totalVisibleW = t1.width + LOGO_DIVIDER.gapBeforePx + LOGO_DIVIDER.widthPx + LOGO_DIVIDER.gapAfterPx + t2.width;
      var tightLeftTarget = centerX - totalVisibleW/2; // 整組有色範圍最左緣該落在哪
      x1 = tightLeftTarget - t1.leftOffset; // 反推logo1整張圖(含它自己的透明留白)該畫在哪
    } else {
      // 只有logo1：讓logo1自己的有色範圍置中，不是整張圖置中
      x1 = centerX - t1.leftOffset - t1.width/2;
    }
  } else {
    x1 = pos1.xPct * w; // 左上角錨點模式，維持原行為
  }

  return { x:x1, y:y1, w:boxW1, h:boxH1 };
}

window.Modules.logo = {
  draw: function(ctx, layer, state, layoutMeta){
    var pos = layoutMeta.positions && layoutMeta.positions.assets && layoutMeta.positions.assets[layer.slot];
    if(!pos) return;
    var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h;
    var img = state.assets && state.assets[layer.slot];

    if(!_logoImgReady(img)){
      if(layer.optional){
        /* 選填素材（例如logo2品牌LOGO）沒上傳時，不畫虛線佔位框——這種素材本來就
           「有填才顯示」，畫面上留白就是正確狀態，不用提醒使用者「這裡預留了位置」。 */
        return;
      }
      /* 佔位框：還沒上傳圖片時，讓使用者知道這裡預留了LOGO位置 */
      var boxH0 = pos.hPct * h;
      var anchorX0 = pos.xPct * w, anchorY0 = pos.yPct * h;
      var bw = boxH0 * 2.2;
      var bx = (pos.align === 'center') ? anchorX0 - bw/2 : anchorX0;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.setLineDash([4,4]);
      ctx.strokeRect(bx, anchorY0, bw, boxH0);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = Math.floor(boxH0*0.45)+'px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(layer.slot, bx+6, anchorY0+boxH0/2);
      ctx.restore();
      return;
    }

    if(layer.slot === 'logo1'){
      var box1 = _logo1EffectiveBox(state, layoutMeta.positions, w, h);
      if(box1){ ctx.drawImage(img, box1.x, box1.y, box1.w, box1.h); return; }
      // box1算不出來（理論上不會發生，因為img已確認ready），保險退回單純畫法
    }

    if(layer.slot === 'logo2'){
      var b1 = _logo1EffectiveBox(state, layoutMeta.positions, w, h);
      if(b1){
        var boxH2 = pos.hPct * h;
        var crop2 = _logo2FillCropRect(state, img);
        var ratio2 = crop2 ? crop2.ratio : (img.naturalWidth / img.naturalHeight);
        var boxW2 = boxH2 * ratio2;

        /* 分隔線位置/logo2起畫點統一用tight bounds算，不分align是不是
           'center'——見上面_tightEdgesInBox()的說明，兩顆logo各自的有色
           範圍距離分隔線都是gapBeforePx/gapAfterPx(15px)，寬度可以不一樣。 */
        var img1 = state.assets && state.assets.logo1;
        var b1TightRight = _tightEdgesInBox(img1, b1).right;
        var dividerX = b1TightRight + LOGO_DIVIDER.gapBeforePx;

        var lineH = b1.h * LOGO_DIVIDER.heightRatio;
        var lineCenterY = b1.y + b1.h/2;
        ctx.save();
        ctx.strokeStyle = LOGO_DIVIDER.color;
        ctx.lineWidth = LOGO_DIVIDER.widthPx;
        ctx.beginPath();
        ctx.moveTo(dividerX, lineCenterY - lineH/2);
        ctx.lineTo(dividerX, lineCenterY + lineH/2);
        ctx.stroke();
        ctx.restore();

        var y2 = pos.yPct * h; // 垂直位置/高度維持logo2自己的yPct/hPct，只有水平位置改成跟著logo1+分隔線算

        if(crop2){
          /* fillMode：直接裁掉合成圖裡LOGO本體以外的透明留白(crop2.sx/sy/
             sw/sh是來源圖裡的有色範圍)，只把這塊拉伸畫到boxW2×boxH2——
             畫出來的內容本身就是「撐滿」的，不需要再另外算留白偏移。 */
          var x2f = dividerX + LOGO_DIVIDER.gapAfterPx;
          ctx.drawImage(img, crop2.sx, crop2.sy, crop2.sw, crop2.sh, x2f, y2, boxW2, boxH2);
          return;
        }

        /* 非fillMode：logo2「有色範圍」左緣要剛好落在dividerX+gapAfterPx——
           先假設整張圖畫在x2=dividerX+gapAfterPx，量出這個假設下有色範圍
           左緣實際在哪，再用兩者的差去反推真正該畫的x2，讓有色範圍左緣
           精準對齊，不是整張圖(含內建透明留白)的左緣對齊。 */
        var probeBox = { x: dividerX + LOGO_DIVIDER.gapAfterPx, y: y2, w: boxW2, h: boxH2 };
        var tightLeftAtProbe = _tightEdgesInBox(img, probeBox).left;
        var x2 = probeBox.x - (tightLeftAtProbe - probeBox.x);
        ctx.drawImage(img, x2, y2, boxW2, boxH2);
        return;
      }
    }

    // logo1不存在時的logo2、或其他一般情況（包含host）：退回用自己的xPct/align獨立定位
    var cropFallback = (layer.slot === 'logo2') ? _logo2FillCropRect(state, img) : null;
    var boxH = pos.hPct * h;
    var ratio = cropFallback ? cropFallback.ratio : (img.naturalWidth / img.naturalHeight);
    var boxW = boxH * ratio;
    var anchorX = pos.xPct * w, anchorY = pos.yPct * h;
    var x = (pos.align === 'center') ? anchorX - boxW/2 : anchorX;

    /* host這種「有artZone(作圖區)」的素材，貼合時會刻意放大一點(enlarge，
       見core.js的calcArtZoneFit)，讓有色範圍完整填滿/略超出作圖區。放大後
       的圖片本身如果直接畫，尺寸會比作圖區框本身還大，容易在作圖區邊緣正好
       貼齊畫布邊界的版位（例如DD Card、MSBN）視覺上溢出畫布——這裡比照
       原始參考檔(03_c2c_bn.html/05_c2c_dd_card.html/07_msbn.html)的畫法，
       用artZone的範圍clip一次，超出作圖區的部分不畫出來，不管使用者上傳的
       圖片長寬比跟作圖區差多少，永遠不會超出這個框。 */
    var zone = pos.artZone;
    if(zone){
      ctx.save();
      ctx.beginPath();
      ctx.rect(zone.xPct*w - (zone.wPct*w)/2, zone.topPct*h, zone.wPct*w, zone.hPct*h);
      ctx.clip();
      if(cropFallback) ctx.drawImage(img, cropFallback.sx, cropFallback.sy, cropFallback.sw, cropFallback.sh, x, anchorY, boxW, boxH);
      else ctx.drawImage(img, x, anchorY, boxW, boxH);
      ctx.restore();
      return;
    }

    if(cropFallback) ctx.drawImage(img, cropFallback.sx, cropFallback.sy, cropFallback.sw, cropFallback.sh, x, anchorY, boxW, boxH);
    else ctx.drawImage(img, x, anchorY, boxW, boxH);
  }
};
