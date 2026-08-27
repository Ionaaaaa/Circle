'use strict';
/* Background Module —— 先試背景圖片，沒有就退回純色。
   跟 logos/logo_shopee_live.png 那套「有預設檔用預設檔、沒有就不出錯」是同一個模式：
   backgrounds/{layoutId}.jpg 存在 → 畫這張圖（等比例裁切鋪滿整個畫布，
   跟CSS的object-fit:cover behavior一樣）；
   沒有這張圖（或layoutId是null，例如popup裡的draft預覽） → 退回目前既有的
   純色+漸層畫法，完全不會報錯、也不會讓畫面空白。

   圖片是非同步載入的，第一次render時圖還沒到，會先用純色墊著；
   圖片載入完成後呼叫 window.renderAll()（如果存在）觸發重畫一次，
   換成真正的背景圖——這個「先墊著、載入完成後再重畫」的模式，
   跟 shadow-popup.js 載入圖片的方式一致。 */
window.Modules = window.Modules || {};
window.Modules.background = (function(){

  var cache = {}; // layoutId -> { status:'loading'|'loaded'|'missing', img }

  function tryLoad(layoutId){
    var entry = { status:'loading', img:null };
    cache[layoutId] = entry;
    var img = new Image();
    img.onload = function(){
      entry.status = 'loaded';
      entry.img = img;
      if(typeof window.renderAll === 'function') window.renderAll();
    };
    img.onerror = function(){
      /* .jpg 找不到，再試一次 .png，兩個都沒有才算真的missing */
      if(!entry._triedPng){
        entry._triedPng = true;
        img.src = 'backgrounds/'+layoutId+'.png';
      } else {
        entry.status = 'missing';
      }
    };
    img.src = 'backgrounds/'+layoutId+'.jpg';
  }

  /* 等比例裁切鋪滿整個畫布（object-fit:cover），不會變形、不會露出空白邊 */
  function drawCover(ctx, img, w, h){
    var ir = img.naturalWidth / img.naturalHeight;
    var cr = w / h;
    var sx, sy, sw, sh;
    if(ir > cr){ // 圖片比較寬，裁左右
      sh = img.naturalHeight; sw = sh * cr;
      sx = (img.naturalWidth - sw) / 2; sy = 0;
    } else { // 圖片比較高，裁上下
      sw = img.naturalWidth; sh = sw / cr;
      sx = 0; sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  }

  function drawSolidFallback(ctx, w, h, state){
    var hex = (state.bg && state.bg.seedHex) || '#EE4D2D';
    ctx.fillStyle = hex;
    ctx.fillRect(0,0,w,h);
    var grad = ctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0,'rgba(255,255,255,0.06)');
    grad.addColorStop(1,'rgba(0,0,0,0.10)');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,w,h);
  }

  return {
    draw: function(ctx, layer, state, layoutMeta){
      var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h;
      var layoutId = layoutMeta.layoutId;

      var entry = layoutId ? cache[layoutId] : null;
      if(layoutId && !entry){ tryLoad(layoutId); entry = cache[layoutId]; }

      if(entry && entry.status === 'loaded'){
        drawCover(ctx, entry.img, w, h);
      } else {
        drawSolidFallback(ctx, w, h, state);
      }
    }
  };
})();
