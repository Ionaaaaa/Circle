'use strict';
/* Background Module —— 先試背景圖片，沒有就退回純色。

   2026-08新增「A版／B版」支援：每個版位可以有兩張不同背景圖，分別放在
   backgrounds/A/{layoutId}.jpg 跟 backgrounds/B/{layoutId}.jpg。載入順序：
     1. backgrounds/{目前版本}/{layoutId}.jpg（該版本專屬圖）
     2. backgrounds/{目前版本}/{layoutId}.png
     3. backgrounds/{layoutId}.jpg（沒有分版本的共用/舊圖，B版美術還沒
        補齊之前，先借用這張墊著，畫面不會開天窗）
     4. backgrounds/{layoutId}.png
     5. 都沒有 → 退回純色+漸層（drawSolidFallback）
   之後B版正式美術到位，只要把檔案放進backgrounds/B/資料夾，不用改任何
   程式，下次切換到B版就會自動改用那張圖。

   圖片是非同步載入的，第一次render時圖還沒到，會先用純色墊著；
   圖片載入完成後呼叫 window.renderAll()（如果存在）觸發重畫一次，
   換成真正的背景圖——這個「先墊著、載入完成後再重畫」的模式，
   跟 shadow-popup.js 載入圖片的方式一致。 */
window.Modules = window.Modules || {};
window.Modules.background = (function(){

  var cache = {}; // cacheKey('版本|layoutId') -> { status:'loading'|'loaded'|'missing', img }

  /* 依序嘗試一份候選路徑清單，全部失敗才算missing。 */
  function tryLoadCandidates(cacheKey, candidates){
    var entry = { status:'loading', img:null };
    cache[cacheKey] = entry;
    var idx = 0;
    var img = new Image();
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

  function tryLoad(version, layoutId){
    var cacheKey = version + '|' + layoutId;
    tryLoadCandidates(cacheKey, [
      'backgrounds/'+version+'/'+layoutId+'.jpg',
      'backgrounds/'+version+'/'+layoutId+'.png',
      'backgrounds/'+layoutId+'.jpg',
      'backgrounds/'+layoutId+'.png'
    ]);
    return cacheKey;
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
      /* 動態複製出來的版位實例(例如HBN週三版'03_c2c_bn__2')本身沒有自己的
         backgrounds/03_c2c_bn__2.jpg——直接查window.LAYOUT_ALIAS_BASE
         retry回真正的原版位id，兩個實例會顯示同一張背景圖(合理，因為本來
         就是同一份版型)，不用另外準備一份重複的背景檔。 */
      var fileId = (window.LAYOUT_ALIAS_BASE && window.LAYOUT_ALIAS_BASE[layoutId]) ||
                   (window.LAYOUT_ASSET_FALLBACK && window.LAYOUT_ASSET_FALLBACK[layoutId]) ||
                   layoutId;
      var version = (state.templateVersion === 'B') ? 'B' : 'A';

      var cacheKey = version + '|' + fileId;
      var entry = fileId ? cache[cacheKey] : null;
      if(fileId && !entry){ tryLoad(version, fileId); entry = cache[cacheKey]; }

      if(entry && entry.status === 'loaded'){
        drawCover(ctx, entry.img, w, h);
      } else {
        drawSolidFallback(ctx, w, h, state);
      }
    }
  };
})();
