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

   置中的「logo/文字製作範圍」固定 78x77px（100x100裡置中擺放，四周留白）。
   logo版本的底色判斷直接複用 js/logo2-editor.js 的 logo2SampleBgColor()——
   PNG固定白色，其他格式(JPG等)吸取四角+四邊中點8個取樣點裡最常見的顏色，
   跟LOGO2「素材底色」是同一套規則，不重寫一份，兩邊底色邏輯改一次就同步。
   文字版本固定背景 #EE4D2D、白字，跟logo版本的底色判斷無關。 */
window.Modules = window.Modules || {};

var AR_BOX = { w: 78, h: 77 };   // 置中的製作範圍
var AR_TEXT_BG = '#EE4D2D';
var AR_TEXT_COLOR = '#ffffff';
var AR_BASE_FONT = 48;
var AR_MIN_FONT = 12;            // 縮到這個字級就不再縮，避免縮到看不見

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
  var boxCx = canvasW/2, boxCy = canvasH/2;
  var scale = Math.min(AR_BOX.w/tw, AR_BOX.h/th) * (extraScale || 1);
  var dw = img.naturalWidth*scale, dh = img.naturalHeight*scale;
  var tightCx = (tx+tw/2)*scale, tightCy = (ty+th/2)*scale;
  var x = boxCx - tightCx + (extraOffXRatio||0) * canvasW;
  var y = boxCy - tightCy + (extraOffYRatio||0) * canvasH;
  return { x: x, y: y, w: dw, h: dh };
}

/* 文字自動縮小：從AR_BASE_FONT開始，量測每一行寬度＋總行高，只要有任一項
   超過AR_BOX就等比例縮一級字重來，最多嘗試200次收斂（跟coin_bn.html參考檔
   calcCouponLine()的迭代寫法同一種概念），字級下限給AR_MIN_FONT。 */
function _arFitTextSize(ctx, lines, weight){
  var size = AR_BASE_FONT;
  for(var i=0;i<200;i++){
    ctx.font = weight+' '+size+'px "ShopeeNoto","Noto Sans TC",sans-serif';
    var maxLineW = 0;
    lines.forEach(function(line){ maxLineW = Math.max(maxLineW, ctx.measureText(line).width); });
    var lineHeight = size * 1.15;
    var totalH = lineHeight * lines.length;
    if(maxLineW <= AR_BOX.w && totalH <= AR_BOX.h) break;
    if(size <= AR_MIN_FONT) break;
    size -= 1;
  }
  return size;
}

window.Modules.ar = {
  draw: function(ctx, layer, state, layoutMeta){
    var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h; // 100x100
    var variant = state.arVariant || 'activity';

    if(variant === 'text'){
      ctx.fillStyle = AR_TEXT_BG;
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
      var size = _arFitTextSize(ctx, lines, 500);
      ctx.font = '500 '+size+'px "ShopeeNoto","Noto Sans TC",sans-serif';
      ctx.fillStyle = AR_TEXT_COLOR;
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
       - activity(LOGO1)：固定用#EE4D2D，不用取樣——LOGO1是蝦皮直播brand
         固定素材，不需要像使用者上傳的LOGO2那樣去猜底色，直接寫死品牌色
         最單純、也不會有取樣猜錯的風險。
       - seller(LOGO2)：維持原本「取樣這張圖本身的底色」邏輯，因為LOGO2是
         使用者上傳的素材，跟畫面上其他地方顯示LOGO2時的底色判斷邏輯一致
         （logo2SampleBgColor()，PNG固定白色/其他格式吸角落顏色）。 */
    var bg = (variant === 'activity') ? '#EE4D2D'
      : ((typeof logo2SampleBgColor === 'function') ? logo2SampleBgColor(img) : '#ffffff');
    ctx.fillStyle = bg;
    ctx.fillRect(0,0,w,h);

    var box = (variant === 'seller')
      ? _arFitLogoBox(img, w, h, state.arExtraScale, state.arExtraOffX, state.arExtraOffY)
      : _arFitLogoBox(img, w, h);
    if(box.w && box.h) ctx.drawImage(img, box.x, box.y, box.w, box.h);
  }
};
