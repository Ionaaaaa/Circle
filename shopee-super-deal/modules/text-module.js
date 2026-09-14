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
     不會整個畫面壞掉。
   - bgBox：{xPct,topPct,wPct,hPct,color,opacity}，文字後面的半透明底色
     範圍(例如外廣LINE LAP那種深色遮罩襯托文字可讀性的設計)，畫在文字
     之前，純粹是個矩形色塊，跟pos.topYPct/xPct等文字定位互不影響。
     選填，沒有這個key的版位完全不受影響。
   - multiLine：{line1:{...}, line2:{...}}，把同一個文案欄位拆成兩行畫，
     兩行可以各自不同topYPct/fontSize/xPct/align/weight/colorRef(沒寫的
     項目沿用外層pos自己的值)。使用者手動用"\n"斷行就照著斷，沒有手動
     斷行時依字數自動平分兩行(跟ar-module.js同一套自動斷行邏輯)。選填，
     沒有這個key的版位完全不受影響、直接照原本單行畫法。
   - mixedSize：{ratio:0.8}，文字裡的非數字前後綴(例如"$500"的"$")用
     比數字小一點的字級畫，比例預設0.8(可調)，數字本身維持pos.fontSize
     不變。重用modules/pricetag-module.js的drawMixedSizeText()，選填，
     目前只支援align:'center'的欄位，沒有這個key的版位完全不受影響。 */
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

    /* 2026-09新增：bgBox——文字後面的半透明底色範圍(例如外廣LINE LAP這種
       深色遮罩襯托文字可讀性的設計)，選填欄位，沒有這個key的版位完全
       不受影響(向下相容)。畫在文字之前，所以文字一定疊在上面。 */
    if(pos.bgBox){
      ctx.save();
      ctx.globalAlpha = (pos.bgBox.opacity !== undefined) ? pos.bgBox.opacity : 1;
      ctx.fillStyle = pos.bgBox.color || '#000000';
      ctx.fillRect(pos.bgBox.xPct*w, pos.bgBox.topPct*h, pos.bgBox.wPct*w, pos.bgBox.hPct*h);
      ctx.restore();
    }

    function fontStr(p){ return p.weight + ' ' + p.fontSize + 'px "ShopeeNoto","Noto Sans TC",sans-serif'; }

    ctx.save();

    /* 2026-09新增：multiLine——同一個文案欄位要拆成兩行畫，兩行可以各自
       不同字級/位置(例如外廣Appier的160x600，副標因為畫布太窄，同一句
       文案需要拆兩行，而且第二行字級要比第一行大)。選填欄位，沒有這個
       key的版位完全不受影響、直接往下走原本單行的畫法。
       使用者在文案裡自己打"\n"就照著斷行；沒有手動斷行、且字數夠長
       (>=3字)時，自動平分成兩行——奇數字數時下面那行多一個字，上輕下重
       比較符合視覺習慣，跟modules/ar-module.js的自動斷行是同一套邏輯，
       不重寫一份規則。
       pos.multiLine.line1/line2各自可以覆蓋topYPct/fontSize/xPct/align/
       weight/colorRef/color任何一項，沒寫的欄位沿用外層pos自己的值——
       這樣兩行通常只有字級/位置不同、其他設定一樣時，不用整組重複寫。 */
    if(pos.multiLine){
      var mlLines = str.split('\n').filter(function(s){ return s.length; });
      if(mlLines.length === 1 && mlLines[0].length >= 3){
        var mlFull = mlLines[0];
        var mlTopLen = Math.floor(mlFull.length/2);
        mlLines = [mlFull.slice(0,mlTopLen), mlFull.slice(mlTopLen)];
      }
      var mlCfgs = [pos.multiLine.line1, pos.multiLine.line2].slice(0, mlLines.length);
      mlCfgs.forEach(function(lineCfg, i){
        if(!lineCfg || !mlLines[i]) return;
        var merged = Object.assign({}, pos, lineCfg); // 這一行自己的設定蓋掉外層預設值
        ctx.font = fontStr(merged);
        var ascentL = ctx.measureText('測').actualBoundingBoxAscent || merged.fontSize * 0.88;
        var baselineL = merged.topYPct * h + ascentL;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = merged.align || 'left';
        var xL = merged.xPct !== undefined ? merged.xPct * w : 0;
        ctx.fillStyle = _resolveTextColor(merged);
        ctx.fillText(mlLines[i], xL, baselineL);
      });
      ctx.restore();
      return;
    }

    ctx.textAlign = pos.align || 'left';

    /* 2026-09新增：右側面板的副標/日期輸入框改成textarea(見editor.html)，
       支援手動Enter換行給multiLine版位用——但沒有設定multiLine的一般
       版位，如果使用者不小心按到Enter，字串裡混進"\n"直接丟給
       ctx.fillText()畫，字型渲染不會自動處理換行，可能出現奇怪的空白/
       缺字。這裡當作安全網：非multiLine的一般畫法，先把"\n"去掉接成
       一行再畫，不會因為誤按Enter而讓畫面跑掉。 */
    if(str.indexOf('\n') !== -1) str = str.replace(/\n+/g, '');

    /* 2026-09新增：mixedSize——文字裡的「非數字前後綴」(例如"$"、"%")用
       比數字小一點的字級畫，數字本身維持原本pos.fontSize——重用
       modules/pricetag-module.js已經寫好的drawMixedSizeText()(原本是
       給商品原價/標價小標用的)，不重寫一份規則。選填欄位，沒有這個key
       的版位完全不受影響，直接照原本邏輯畫單一字級。
       ★目前只支援align:'center'(用centerX對稱畫)，這是08_popup「票券1」
       這種置中文案的實際用法；如果之後有靠左對齊的欄位也要這個效果，
       需要另外調整centerX的算法，先不在這裡處理。 */
    if(pos.mixedSize && window.Modules && window.Modules.pricetag){
      var mixRatio = pos.mixedSize.ratio || 0.8;
      var bigFontPx = pos.fontSize;
      var baseFontPx = pos.fontSize * mixRatio;
      ctx.font = fontStr(Object.assign({}, pos, { fontSize: bigFontPx }));
      var mixAscent = ctx.measureText('測').actualBoundingBoxAscent || bigFontPx * 0.88;
      var mixBaseline = pos.topYPct * h + mixAscent;
      var mixCenterX = pos.xPct * w;
      /* ★drawMixedSizeText()內部是「靠左對齊+自己算好每一段x座標」的畫法
         (centerX只是用來推算「整段文字」該從哪個x開始畫，不是每一段各自
         置中)——外層前面已經把ctx.textAlign設成pos.align(這裡通常是
         'center')，如果不改回'left'，裡面每一段fillText都會各自用「置中」
         的方式疊在同一個點上，變成文字互相重疊(使用者截圖看到的「$」跟
         「5」黏在一起就是這個原因)。呼叫前先強制改回'left'，畫完不用另外
         復原，因為整個function最後就ctx.restore()結束了。 */
      ctx.textAlign = 'left';
      window.Modules.pricetag.drawMixedSizeText(
        ctx, str, mixCenterX, mixBaseline,
        pos.weight, _resolveTextColor(pos), baseFontPx, bigFontPx
      );
      ctx.restore();
      return;
    }

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
