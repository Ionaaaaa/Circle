'use strict';
/* DPS Module —— Digital Product Scrolling（128x128）專屬模組。

   原本DPS是直接沿用'ar'模組、共用同一份S.arVariant(活動LOGO/店家LOGO/
   文案三選一)——2026-08使用者確認：DPS要固定/預設用文字版本，不要跟著
   S.arVariant切換；AR版位維持原本三選一邏輯完全不動。所以拆成獨立的
   'dps'模組，不再共用'ar'模組，兩邊之後各自要調整都不會互相影響。

   ── 背景 ──
   原本(共用ar模組時)是純色鋪滿(configs/theme.json的arBg)。使用者確認
   改用實際的背景圖 backgrounds/{版本}/Digital Product Scrolling.png
   （已經是128x128、圓角方塊造型、四個角落本身就是透明的PNG）取代純色，
   「拿掉有顏色的底，只出現圖片，其餘部分透明」——直接把這張圖整張畫上去
   （不用額外裁切/縮放，本來就是128x128跟畫布一樣大），透明的地方就是
   圖片本身的透明，不會另外补色。
   哪個版本還沒有這張圖（目前只有A版有）就退回原本的純色鋪滿當保底，
   不會開天窗；之後陸續補上B~H版的圖，程式完全不用改，檔案放對資料夾
   就會自動生效（跟background-module.js的載入模式一致：cache＋async load＋
   載入完成呼叫window.renderAll()重畫）。

   ── 文字 ──
   讀 state.text['DPS']，對應Excel工單「製作內容文案」表裡的『DPS』這個
   標籤列（見editor-import.js的parseTextGroups()，跟'標題'/'副標'/'日期'
   同一張表、同一種抓法），不是AR文案那欄——這份工單實例：DPS欄位填的是
   「聚餐美食」。排版/自動縮字級的算法沿用跟AR文字版本一樣的視覺風格
   （置中製作範圍比例、字級縮放邏輯），實作各自獨立一份，不共用函式，
   之後兩邊要分別微調都不會互相牽動。 */
window.Modules = window.Modules || {};
window.Modules.dps = (function(){

  var BOX_RATIO = { w: 0.78, h: 0.77 }; // 置中製作範圍占畫布寬高比例，跟AR同一套比例算法
  var TEXT_COLOR_FALLBACK = '#ffffff';
  var BG_COLOR_FALLBACK = '#EE4D2D';
  var BASE_FONT = 48;
  var MIN_FONT = 12;

  var bgCache = {}; // 版本('A'~'H') -> { status:'loading'|'loaded'|'missing', img }

  function loadBg(version){
    var entry = bgCache[version];
    if(entry) return entry;
    entry = { status: 'loading', img: null };
    bgCache[version] = entry;
    var img = new Image();
    img.onload = function(){
      entry.status = 'loaded';
      entry.img = img;
      if(typeof window.renderAll === 'function') window.renderAll();
    };
    img.onerror = function(){ entry.status = 'missing'; }; // 這個版本還沒放圖，畫的時候退回純色
    img.src = encodeURI('backgrounds/'+version+'/Digital Product Scrolling.png');
    return entry;
  }

  function box(w, h){ return { w: w*BOX_RATIO.w, h: h*BOX_RATIO.h }; }
  function bgColorFallback(){ return (window.Theme && window.Theme.arBg) || BG_COLOR_FALLBACK; }
  function textColor(){ return (window.Theme && window.Theme.arText) || TEXT_COLOR_FALLBACK; }

  function fitTextSize(ctx, lines, weight, b){
    var size = BASE_FONT;
    for(var i=0; i<200; i++){
      ctx.font = weight+' '+size+'px "ShopeeNoto","Noto Sans TC",sans-serif';
      var maxLineW = 0;
      lines.forEach(function(line){ maxLineW = Math.max(maxLineW, ctx.measureText(line).width); });
      var lineHeight = size * 1.15;
      var totalH = lineHeight * lines.length;
      if(maxLineW <= b.w && totalH <= b.h) break;
      if(size <= MIN_FONT) break;
      size -= 1;
    }
    return size;
  }

  return {
    draw: function(ctx, layer, state, layoutMeta){
      var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h;
      var version = (typeof normalizeTemplateVersion === 'function')
        ? normalizeTemplateVersion(state.templateVersion)
        : ((state.templateVersion === 'B') ? 'B' : 'A');

      var bg = loadBg(version);
      if(bg.status === 'loaded'){
        ctx.drawImage(bg.img, 0, 0, w, h);
      } else {
        // 圖還在載入中、或這個版本還沒放圖(missing)：先用純色墊著，不開天窗；
        // 真正載入完成時loadBg()裡的img.onload會呼叫renderAll()重畫成圖片。
        ctx.fillStyle = bgColorFallback();
        ctx.fillRect(0, 0, w, h);
      }

      var raw = (state.text && state.text['DPS']) || '';
      var lines = raw.split('\n').filter(function(l){ return l.length; });
      if(!lines.length) return;

      /* 跟AR文字版本同一個「沒手動斷行、3字以上自動平分兩行」規則，
         保持兩個版位視覺風格一致。 */
      if(lines.length === 1 && lines[0].length >= 3){
        var full = lines[0];
        var topLen = Math.floor(full.length/2);
        lines = [full.slice(0,topLen), full.slice(topLen)];
      }

      ctx.save();
      var size = fitTextSize(ctx, lines, 500, box(w, h));
      ctx.font = '500 '+size+'px "ShopeeNoto","Noto Sans TC",sans-serif';
      ctx.fillStyle = textColor();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var lineHeight = size * 1.15;
      var totalH = lineHeight * lines.length;
      var startY = h/2 - totalH/2 + lineHeight/2;
      lines.forEach(function(line, i){
        ctx.fillText(line, w/2, startY + i*lineHeight);
      });
      ctx.restore();
    }
  };
})();
