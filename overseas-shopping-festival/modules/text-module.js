'use strict';
/* Text Module —— 只認 layer.slot（例如'標題'）要去 state.text 拿字串，
   跟 layoutMeta.positions.text[slot] 拿位置/字級/對齊方式。
   不知道自己在畫哪個版位、不知道現在是什麼組合。

   支援兩種位置資料格式（新舊並存，向下相容）：
   - 新格式（有 topYPct）：topYPct是設計稿文字框「頂部」的Y比例，實際畫的時候
     用當下字體量出來的ascent去算baseline，這是直接照你參考檔（11/12/05這幾個
     html）的算法完全複製過來的，數字才會準。weight是數字(700/500/400)。
   - 舊格式（沒有topYPct，只有yPct）：yPct當作文字垂直置中點，weight是文字
     ('bold'/'normal')。還沒有你提供正式參考檔的版位（目前是HBN）先繼續用這套。

   2026-08新增三個選填欄位（只有topYPct格式支援letterSpacing/pairSlot，
   向下相容，沒設定的版位完全不受影響）：
   - letterSpacing：數字(px)，負值=縮緊字距，比照參考檔(04_ig/10_game_bn)
     用ctx.letterSpacing畫，畫完立刻歸零，不會影響同一個canvas後面畫的其他文字。
   - pairSlot：這個slot「領頭」，跟另一個slot（例如04_ig的「標題」領頭、
     pairSlot指向「日期」）兩段文字當同一組一起水平置中——先各自量出目前
     實際文字寬度，兩段中間留pairGapPx，整組的水平中心對齊pos.xPct，算出
     領頭這段的起始x，領頭畫完接著直接把pairSlot那段也畫掉（用pairSlot
     自己的topYPct/字級/顏色），所以configs/layouts的layers清單不用另外
     幫pairSlot那個slot加一筆text layer，加了會被畫兩次。
   - colorRef：字串，指向 window.Theme（configs/theme.json 載入後存在這裡）
     裡的一個key（例如'title'/'subtitle'/'date'），畫的時候會去查
     window.Theme[colorRef]當顏色。跟pos.color同時存在時，color(寫死的
     hex)優先——colorRef是給「跟著品牌主題走」的欄位用，color是給「這個
     欄位就是要跟主題色不一樣」的特殊情況留的逃生口，兩者不衝突。
     window.Theme還沒載入完成、或colorRef查不到值時，退回'#ffffff'，
     不會整個畫面壞掉。 */
window.Modules = window.Modules || {};

function _resolveTextColor(pos){
  if(pos.color) return pos.color;
  if(pos.colorRef && window.Theme && window.Theme[pos.colorRef]) return window.Theme[pos.colorRef];
  return '#ffffff';
}

window.Modules.text = {
  draw: function(ctx, layer, state, layoutMeta){
    var slot = layer.slot;
    var pos = layoutMeta.positions && layoutMeta.positions.text && layoutMeta.positions.text[slot];
    if(!pos) return;
    var str = (state.text && state.text[slot]) || '';
    if(!str) return; /* 沒填就不畫，不留空字造成的怪異排版 */

    var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h;

    function fontStr(p){ return p.weight + ' ' + p.fontSize + 'px "ShopeeNoto","Noto Sans TC",sans-serif'; }

    ctx.save();
    ctx.textAlign = pos.align || 'left';

    if(pos.topYPct !== undefined){
      /* 新格式：跟參考檔一樣，用ascent算baseline */
      ctx.font = fontStr(pos);
      var ascent = ctx.measureText('測').actualBoundingBoxAscent || pos.fontSize * 0.88;
      var baseline = pos.topYPct * h + ascent;
      ctx.textBaseline = 'alphabetic';
      if(pos.letterSpacing){ try{ ctx.letterSpacing = pos.letterSpacing+'px'; }catch(e){} }

      if(pos.pairSlot){
        var pairPos = layoutMeta.positions.text[pos.pairSlot];
        var pairStr = (state.text && state.text[pos.pairSlot]) || '';
        var mainW = ctx.measureText(str).width;
        var gap = pos.pairGapPx || 0;
        var pairW = 0;
        if(pairPos && pairStr){
          ctx.font = fontStr(pairPos);
          pairW = ctx.measureText(pairStr).width;
          ctx.font = fontStr(pos);
        }
        var totalW = mainW + (pairStr ? gap + pairW : 0);
        var startX = pos.xPct * w - totalW/2;

        ctx.fillStyle = _resolveTextColor(pos);
        ctx.fillText(str, startX, baseline);

        if(pairPos && pairStr){
          ctx.font = fontStr(pairPos);
          var pairAscent = ctx.measureText('測').actualBoundingBoxAscent || pairPos.fontSize * 0.88;
          var pairBaseline = pairPos.topYPct * h + pairAscent;
          if(pairPos.letterSpacing){ try{ ctx.letterSpacing = pairPos.letterSpacing+'px'; }catch(e){} }
          ctx.fillStyle = _resolveTextColor(pairPos);
          ctx.fillText(pairStr, startX + mainW + gap, pairBaseline);
          if(pairPos.letterSpacing){ try{ ctx.letterSpacing = '0px'; }catch(e){} }
        }
      } else {
        var x = pos.xPct !== undefined ? pos.xPct * w : 0;
        ctx.fillStyle = _resolveTextColor(pos);
        ctx.fillText(str, x, baseline);
      }
      if(pos.letterSpacing){ try{ ctx.letterSpacing = '0px'; }catch(e){} }
    } else {
      /* 舊格式：置中基準線 */
      ctx.fillStyle = _resolveTextColor(pos);
      ctx.font = (pos.weight||'normal') + ' ' + (pos.fontSize||24) + 'px "ShopeeNoto","Noto Sans TC",sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(str, pos.xPct * w, pos.yPct * h);
    }
    ctx.restore();
  }
};
