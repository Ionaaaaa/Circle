'use strict';
/* Background Module —— 先試背景圖片，沒有就退回純色。
   跟 logos/logo_shopee_live.png 那套「有預設檔用預設檔、沒有就不出錯」是同一個模式：
   backgrounds/{layoutId}.jpg 存在 → 畫這張圖（等比例裁切鋪滿整個畫布，
   跟CSS的object-fit:cover behavior一樣）；
   沒有這張圖（或layoutId是null，例如popup裡的draft預覽） → 退回目前既有的
   純色+漸層畫法，完全不會報錯、也不會讓畫面空白。

   2026-09新增：state.customBg[layoutId]（使用者在畫布旁邊「上傳背景圖」
   按鈕手動選的本機圖片，見js/editor-main.js的handleCustomBgFile()、
   js/editor-state.js的S.customBg說明）優先權最高——有的話直接畫這張，
   backgrounds/{layoutId}.jpg反而不會去抓。這是刻意的：使用者手動上傳
   通常就是為了「後台這個版位還沒有背景圖，先頂一張上去用」，理應蓋過
   （不存在的）後台版本；就算後台之後真的補上了背景圖，使用者這個分頁
   還留著手動上傳的圖，也應該繼續顯示使用者自己選的那張，不會突然跳掉。

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
    /* 2026-09調整：優先用configs/theme.json的bgFallback（這個專案自己實際
       背景圖取樣算出來的代表色，見theme.json的_bgFallback說明）——以前這裡
       只認state.bg.seedHex（寫死的蝦皮橘#EE4D2D，15個Circle專案全部共用
       同一個值），不管是哪個專案，圖還沒載入/找不到時墊底都是同一種橘色，
       跟這個專案實際的背景色調不搭。window.Theme還沒載入完成/沒設定
       bgFallback時，退回舊的seedHex/#EE4D2D，行為不會壞掉。 */
    var hex = (window.Theme && window.Theme.bgFallback) || (state.bg && state.bg.seedHex) || '#EE4D2D';
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

      var customImg = layoutId && state.customBg && state.customBg[layoutId];
      if(customImg instanceof HTMLImageElement && customImg.complete && customImg.naturalWidth){
        drawCover(ctx, customImg, w, h);
        return;
      }

      /* 動態複製出來的版位實例(例如HBN週三版'03_c2c_bn__2')本身沒有自己的
         backgrounds/03_c2c_bn__2.jpg——直接查window.LAYOUT_ALIAS_BASE
         retry回真正的原版位id，兩個實例會顯示同一張背景圖(合理，因為本來
         就是同一份版型)，不用另外準備一份重複的背景檔。 */
      var fileId = (window.LAYOUT_ALIAS_BASE && window.LAYOUT_ALIAS_BASE[layoutId]) || layoutId;

      var entry = fileId ? cache[fileId] : null;
      if(fileId && !entry){ tryLoad(fileId); entry = cache[fileId]; }

      if(entry && entry.status === 'loaded'){
        drawCover(ctx, entry.img, w, h);
      } else {
        drawSolidFallback(ctx, w, h, state);
      }
    }
  };
})();
