'use strict';
/* AR Module —— 固定 100x100 的小方塊，三選一版本（哪個版本生效由
   state.arVariant 決定）：
     'activity' → 活動方形LOGO，直接沿用 state.assets.logo1（不需要另外
                  上傳，跟畫布上其他版位的LOGO1是同一張圖）
     'seller'   → 店家LOGO，直接沿用 state.assets.logo2（同上，跟LOGO2
                  是同一張圖，不需要另外上傳）
     'text'     → 文案（state.text['AR文案']，最多6字，支援手動斷行\n，
                  超過置中框範圍會自動等比例縮小字級）

   ★2026-08：activity/seller原本各自要另外上傳一張專屬素材
   （arActivityLogo/arSellerLogo），但使用者確認後這兩個其實就是
   LOGO1/LOGO2本身（活動方形LOGO=LOGO1、店家LOGO=LOGO2），沒有必要
   讓使用者上傳兩次同樣的東西，改成直接讀取現成的state.assets.logo1/
   logo2，AR這邊完全不用另外管理素材、右側面板的上傳欄位也拿掉了。

   置中的「logo/文字製作範圍」原本固定78x77px(100x100裡置中擺放，四周
   留白)，2026-08改成比例算法(AR_BOX_RATIO)，這樣DPS(128x128，內容規則
   跟AR完全一樣，共用這個模組跟同一份S.arVariant/S.assets.logo1/logo2/
   S.text['AR文案']狀態)可以直接沿用同一支模組，不用另外複製一份。
   logo版本的底色判斷直接複用 js/logo2-editor.js 的 logo2SampleBgColor()——
   PNG固定白色，其他格式(JPG等)吸取四角+四邊中點8個取樣點裡最常見的顏色，
   跟LOGO2「素材底色」是同一套規則，不重寫一份，兩邊底色邏輯改一次就同步。
   文字版本固定背景 #EE4D2D、白字，跟logo版本的底色判斷無關。 */
window.Modules = window.Modules || {};

var AR_BOX_RATIO = { w: 0.78, h: 0.77 };   // 置中的製作範圍，占畫布寬高的比例（原本是100x100畫布下的78x77px，換算成比例後AR(100x100)、DPS(128x128)可以共用同一套算法，不用各自寫一份）
var AR_TEXT_BG_FALLBACK = '#EE4D2D';   // window.Theme還沒載入完成/找不到對應key時的備援值
var AR_TEXT_COLOR_FALLBACK = '#ffffff';
var AR_BASE_FONT = 48;
var AR_MIN_FONT = 12;            // 縮到這個字級就不再縮，避免縮到看不見

/* 2026-08新增DPS(Digital Product Scrolling，128x128)版位——內容規則跟AR
   完全一樣(共用同一個'ar'模組、同一份S.arVariant/S.assets.logo1/logo2/
   S.text['AR文案']狀態，兩個版位顯示的是同一份內容，只是輸出尺寸不同)，
   唯一需要跟著畫布尺寸調整的是這個「置中製作範圍」的實際px大小——原本
   AR_BOX是寫死78x77px(只適用100x100畫布)，這裡改成用AR_BOX_RATIO乘上
   實際畫布寬高，AR(100x100)算出來還是78x77，DPS(128x128)會等比例放大
   成~100x98.6，不用另外為DPS寫一份重複的模組。 */
function _arBox(canvasW, canvasH){
  return { w: canvasW * AR_BOX_RATIO.w, h: canvasH * AR_BOX_RATIO.h };
}

/* 2026-08新增：AR的底色(activity/text兩種variant共用)、跟文字variant的
   字色，改成跟標題/副標/日期一樣走configs/theme.json的A版/B版顏色組
   （見js/theme-loader.js），不再寫死同一組色號——這樣A版/B版可以有
   不同的AR底色/文字色，不用改程式，改theme.json的arBg/arText兩個值
   即可。window.Theme還沒載入完成、或這個key在theme.json裡沒填時，退回
   上面的AR_TEXT_BG_FALLBACK/AR_TEXT_COLOR_FALLBACK，畫面還是能動，只是
   顏色不是主題色，不會整個當掉（跟text-module.js的_resolveTextColor()
   同一套「查不到就退回預設值」邏輯）。 */
function _arBgColor(){
  return (window.Theme && window.Theme.arBg) || AR_TEXT_BG_FALLBACK;
}
function _arTextColor(){
  return (window.Theme && window.Theme.arText) || AR_TEXT_COLOR_FALLBACK;
}

function _arImgReady(img){
  return img instanceof HTMLImageElement && img.complete && img.naturalWidth;
}

/* 把logo的「有色範圍」(不含圖片本身的透明留白)等比例縮放、置中塞進AR_BOX
   （contain模式，不裁切、不變形），回傳畫布上實際要畫整張圖的x/y/w/h。
   extraScale/extraOffXRatio/extraOffYRatio：只有'seller'(店家LOGO/LOGO2)
   會用到，對應S.arExtraScale/arExtraOffX/arExtraOffY——這是使用者在
   「編輯LOGO2」popup的AR預覽裡另外用滾輪/拖曳調整出來的結果（見
   js/logo2-editor.js的updateArPreview()），跟這裡的算法必須完全一致，
   不然編輯時看到的預覽跟實際套用到AR畫布的結果會對不起來。offXRatio/
   offYRatio是相對畫布寬高的比例(0~1)，不是像素值。 */
function _arFitLogoBox(img, canvasW, canvasH, extraScale, extraOffXRatio, extraOffYRatio){
  var tight = (window.Core && Core.calcTightBoundsRatio) ? Core.calcTightBoundsRatio(img) : null;
  var tw, th, tx, ty;
  if(tight){
    tw = tight.tw * img.naturalWidth; th = tight.th * img.naturalHeight;
    tx = tight.tx * img.naturalWidth; ty = tight.ty * img.naturalHeight;
  } else {
    tw = img.naturalWidth; th = img.naturalHeight; tx = 0; ty = 0;
  }
  if(!tw || !th) return { x:0, y:0, w:0, h:0 };
  var box = _arBox(canvasW, canvasH);
  var boxCx = canvasW/2, boxCy = canvasH/2;
  var scale = Math.min(box.w/tw, box.h/th) * (extraScale || 1);
  var dw = img.naturalWidth*scale, dh = img.naturalHeight*scale;
  var tightCx = (tx+tw/2)*scale, tightCy = (ty+th/2)*scale;
  var x = boxCx - tightCx + (extraOffXRatio||0) * canvasW;
  var y = boxCy - tightCy + (extraOffYRatio||0) * canvasH;
  return { x: x, y: y, w: dw, h: dh };
}

/* 文字自動縮小：從AR_BASE_FONT開始，量測每一行寬度＋總行高，只要有任一項
   超過置中製作範圍(box)就等比例縮一級字重來，最多嘗試200次收斂（跟
   coin_bn.html參考檔calcCouponLine()的迭代寫法同一種概念），字級下限給
   AR_MIN_FONT。box參數由呼叫端算好傳進來(_arBox(canvasW,canvasH))，
   這樣AR(100x100)、DPS(128x128)可以共用同一支函式，不用各自寫一份。 */
function _arFitTextSize(ctx, lines, weight, box){
  var size = AR_BASE_FONT;
  for(var i=0;i<200;i++){
    ctx.font = weight+' '+size+'px "ShopeeNoto","Noto Sans TC",sans-serif';
    var maxLineW = 0;
    lines.forEach(function(line){ maxLineW = Math.max(maxLineW, ctx.measureText(line).width); });
    var lineHeight = size * 1.15;
    var totalH = lineHeight * lines.length;
    if(maxLineW <= box.w && totalH <= box.h) break;
    if(size <= AR_MIN_FONT) break;
    size -= 1;
  }
  return size;
}

window.Modules.ar = {
  draw: function(ctx, layer, state, layoutMeta){
    var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h; // AR是100x100，DPS(Digital Product Scrolling)是128x128，兩個版位共用這個模組
    var variant = state.arVariant || 'activity';

    if(variant === 'text'){
      ctx.fillStyle = _arBgColor();
      ctx.fillRect(0,0,w,h);

      var raw = (state.text && state.text['AR文案']) || '';
      // 手動斷行(\n)保留，不強制砍字數——塞不下的情況交給下面的自動縮字級
      // 處理，避免畫面上顯示的內容被程式悄悄截斷、跟工單原文兜不起來。
      var lines = raw.split('\n').filter(function(l){ return l.length; });
      if(!lines.length) return;

      /* 使用者沒有自己手動斷行、字數又到3個字以上，自動平分成2行——
         奇數字數時下面那行字數比上面多一個(上輕下重比較符合視覺習慣)。
         只要使用者自己在文案欄位手動按Enter斷過行，這裡就不會再自動幫他
         斷，一律尊重手動斷行的結果（之後要調整斷行位置，直接去文案欄位
         編輯調整就好）。 */
      if(lines.length === 1 && lines[0].length >= 3){
        var full = lines[0];
        var topLen = Math.floor(full.length/2);
        lines = [full.slice(0,topLen), full.slice(topLen)];
      }

      ctx.save();
      var size = _arFitTextSize(ctx, lines, 500, _arBox(w, h));
      ctx.font = '500 '+size+'px "ShopeeNoto","Noto Sans TC",sans-serif';
      ctx.fillStyle = _arTextColor();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var lineHeight = size * 1.15;
      var totalH = lineHeight * lines.length;
      var startY = h/2 - totalH/2 + lineHeight/2;
      lines.forEach(function(line, i){
        ctx.fillText(line, w/2, startY + i*lineHeight);
      });
      ctx.restore();
      return;
    }

    var img = (variant === 'seller')
      ? (state.assets && state.assets.logo2)
      : (state.assets && state.assets.logo1);

    if(!_arImgReady(img)){
      // 對應的LOGO1/LOGO2還沒有素材：畫一個佔位方塊+文字提示
      ctx.save();
      ctx.fillStyle = '#3a3f4a';
      ctx.fillRect(0,0,w,h);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([3,3]);
      ctx.strokeRect(4,4,w-8,h-8);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(variant==='seller' ? '店家LOGO' : '活動LOGO', w/2, h/2);
      ctx.restore();
      return;
    }

    /* 底色規則兩種版本不一樣：
       - activity(LOGO1)：固定用theme.json的arBg(A版/B版可以不一樣)，不用
         取樣——LOGO1是蝦皮直播brand固定素材，不需要像使用者上傳的LOGO2
         那樣去猜底色，直接用主題色最單純、也不會有取樣猜錯的風險。
       - seller(LOGO2)：維持原本「取樣這張圖本身的底色」邏輯，因為LOGO2是
         使用者上傳的素材，跟畫面上其他地方顯示LOGO2時的底色判斷邏輯一致
         （logo2SampleBgColor()，PNG固定白色/其他格式吸角落顏色）。 */
    var bg = (variant === 'activity') ? _arBgColor()
      : ((typeof logo2SampleBgColor === 'function') ? logo2SampleBgColor(img) : '#ffffff');
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,w,h);

    var box = (variant === 'seller')
      ? _arFitLogoBox(img, w, h, state.arExtraScale, state.arExtraOffX, state.arExtraOffY)
      : _arFitLogoBox(img, w, h);
    if(box.w && box.h) ctx.drawImage(img, box.x, box.y, box.w, box.h);
  }
};
