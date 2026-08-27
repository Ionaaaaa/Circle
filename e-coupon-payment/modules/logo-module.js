'use strict';
/* Logo Module —— 通用化：layer.slot 是 'logo1' 或 'logo2'，各自去
   state.assets[slot] 拿圖、layoutMeta.positions.assets[slot] 拿位置。
   同一個Module程式碼服務兩個logo，不用寫兩份。
   pos.align==='center' 時 xPct 代表「中心點」而不是左上角，畫DD Card這種
   文案置中的版位要用這個，不然圖片寬度跟設計稿抓的不一樣時，中心點會偏掉。

   logo1/logo2同時存在時的分隔線規則：兩個logo中間畫一條2px白線，線的兩側
   各留15px間距。
   ★ logo1.align==='center'（目前只有DD Card）時，這個xPct代表的是「整組
   (logo1+分隔線+logo2)攤開來的水平中心」，不是「logo1自己的中心」——
   有logo2時，logo1會往左讓一點，讓logo1+分隔線+logo2這一整條的視覺中心
   對齊xPct，不然logo1自己先置中、logo2再接在右邊，整組看起來會偏右邊
   （DD Card之前回報的問題）。只有logo1單獨存在（沒有logo2）時，才是
   logo1自己置中。
   align不是'center'的版位（3個橫幅版位，logo1固定靠左），不受影響，
   邏輯跟之前一樣：logo1固定在自己的xPct，logo2接在它右邊。 */
window.Modules = window.Modules || {};

var LOGO_DIVIDER = { widthPx: 2, gapBeforePx: 15, gapAfterPx: 15, heightRatio: 0.5, color: '#EE4D2D' };

function _logoImgReady(img){
  return img instanceof HTMLImageElement && img.complete && img.naturalWidth;
}

/* logo1「有效」的畫布位置：算好之後logo1、logo2兩邊的draw都呼叫同一支，
   確保兩邊算出來的logo1位置永遠一致（不會各算各的、兩邊兜不起來）。 */
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
    var pos2 = positions.assets.logo2;
    var img2 = state.assets && state.assets.logo2;
    if(pos2 && _logoImgReady(img2)){
      var boxH2 = pos2.hPct * h;
      var boxW2 = boxH2 * (img2.naturalWidth / img2.naturalHeight);
      var totalW = boxW1 + LOGO_DIVIDER.gapBeforePx + LOGO_DIVIDER.widthPx + LOGO_DIVIDER.gapAfterPx + boxW2;
      var centerX = pos1.xPct * w;
      x1 = centerX - totalW/2; // 整組(logo1+分隔線+logo2)置中，不是logo1自己置中
    } else {
      x1 = pos1.xPct * w - boxW1/2; // 只有logo1，自己置中
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
        var ratio2 = img.naturalWidth / img.naturalHeight;
        var boxW2 = boxH2 * ratio2;

        var dividerX = b1.x + b1.w + LOGO_DIVIDER.gapBeforePx;
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

        var x2 = dividerX + LOGO_DIVIDER.gapAfterPx;
        var y2 = pos.yPct * h; // 垂直位置/高度維持logo2自己的yPct/hPct，只有水平位置改成跟著logo1+分隔線算
        ctx.drawImage(img, x2, y2, boxW2, boxH2);
        return;
      }
    }

    // logo1不存在時的logo2、或其他一般情況（包含host）：退回用自己的xPct/align獨立定位
    var boxH = pos.hPct * h;
    var ratio = img.naturalWidth / img.naturalHeight;
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
      ctx.drawImage(img, x, anchorY, boxW, boxH);
      ctx.restore();
      return;
    }

    ctx.drawImage(img, x, anchorY, boxW, boxH);
  }
};
