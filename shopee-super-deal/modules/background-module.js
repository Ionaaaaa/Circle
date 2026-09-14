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

   2026-09新增：SKBN(skinny_app/skinny_pc)券樣模式(S.exposureStyle===
   'coupon')專屬背景——這兩個版位商品模式的背景圖裡直接烤了錢幣裝飾，
   券樣模式不需要，載入順序在上面清單最前面多插入兩個候選：
     0a. backgrounds/{目前版本}/{layoutId}_coupon.jpg
     0b. backgrounds/{目前版本}/{layoutId}_coupon.png
   找不到才照上面原本1~5的順序retry(暫時借用商品模式那張，等美術到位再換)。
   只有這兩個特定layoutId、且真的是券樣模式才會多試，其他版位/商品模式
   完全不受影響。

   2026-09再新增：外廣(waiguang/站外)專屬的背景載入規則——外廣的版型
   顏色(紅/藍)是「跟著大項固定」的，不是A/B切換的選項，而且同一個尺寸
   (例如600x1200)會被好幾個大項各自使用、需要各自獨立的背景美術，跟
   站內「同版位切紅/藍」的概念完全不同，套用站內那套A/B資料夾規則會誤判
   (6個大項共用同一個尺寸的背景，看起來會一模一樣，是錯的)。
   外廣的layoutId命名慣例是'{大項key}__{尺寸}'或'{大項key}__{尺寸}__
   {編號}'(見js/editor-state.js的ensureWaiguangInstanceRegistered())——
   這裡偵測layoutId裡有沒有一段符合「數字x數字」(例如'600x1200')的區段，
   有的話就判定是外廣的畫布，資料夾規則改成：
     backgrounds/waiguang/{尺寸前面那一段(大項key)}/{尺寸}.jpg（或.png）
   不套用A/B版本、不套用LAYOUT_ALIAS_BASE/LAYOUT_ASSET_FALLBACK retry
   （外廣每個大項需要各自獨立的美術，不應該互相retry借用）。04_Facebook
   這種帶編號的實例('大項__尺寸__編號')，編號那段直接忽略，一樣共用
   backgrounds/waiguang/大項/尺寸.jpg——如果之後發現11組真的需要各自不同
   背景，再回來改這裡的路徑規則即可，不用動其他程式。
   判斷不到「數字x數字」區段的layoutId，一律照原本站內那套A/B規則處理，
   站內完全不受影響。

   圖片是非同步載入的，第一次render時圖還沒到，會先用純色墊著；
   圖片載入完成後呼叫 window.renderAll()（如果存在）觸發重畫一次，
   換成真正的背景圖——這個「先墊著、載入完成後再重畫」的模式，
   跟 shadow-popup.js 載入圖片的方式一致。 */
window.Modules = window.Modules || {};
window.Modules.background = (function(){

  var cache = {}; // cacheKey -> { status:'loading'|'loaded'|'missing', img }

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

  /* 2026-09新增：外廣有些大項使用者確認「背景圖可以共用，紅/藍(有沒有
     低消)只靠文案內容區分，不需要各自獨立的背景美術」——跟檔頭說明「每個
     大項需要各自獨立背景」的預設假設不同，這裡另外開一個對照表，列在
     這裡的大項會直接借用對應的那個資料夾，不會各自找。目前只有LINE LAP
     這一組(01_LINE_LAP_無低消 共用 01_LINE_LAP的背景)，之後如果還有其他
     大項也要共用，直接在這裡加一行對應即可，不用改下面的判斷邏輯。 */
  var WAIGUANG_BG_SECTION_ALIAS = {
    '01_LINE_LAP_無低消': '01_LINE_LAP',
    '03_Appier_維穩': '03_Appier'
  };

  /* layoutId => {section, size} 或 null(不是外廣格式)——切開'__'之後，
     找第一段符合/^\d+x\d+$/(純數字x數字)的區段當「尺寸」，它前面所有
     區段(用'__'接回去，理論上大項key本身不會再帶雙底線，但保險起見還是
     支援)當「大項」。編號(04_Facebook的情況)如果有，會被排除在size
     判斷之外，直接忽略(見檔頭說明，目前設計成同一大項同一尺寸共用一張
     背景，不分編號)。找到的大項如果在WAIGUANG_BG_SECTION_ALIAS裡有登記，
     直接換成對應的那個大項資料夾名稱。 */
  function parseWaiguangLayoutId(layoutId){
    var parts = String(layoutId).split('__');
    if(parts.length < 2) return null;
    var sizeIdx = -1;
    /* ★2026-09修正：以前只認純數字x數字(例如'1200x628')，'1200x628_no_kv'
       這種帶後綴的尺寸代號完全比對不到，導致這個id被誤判成「不是外廣
       格式」，走錯路徑去找背景圖(套用站內A/B版本那套規則)，使用者反映
       「無KV找不到背景圖」就是這個原因。改成允許尺寸後面接底線+任意
       文字(_\w+)，'1200x628'跟'1200x628_no_kv'都認得。 */
    for(var i=0;i<parts.length;i++){
      if(/^\d+x\d+(_\w+)?$/.test(parts[i])){ sizeIdx = i; break; }
    }
    if(sizeIdx <= 0) return null; // 找不到尺寸區段、或尺寸在最前面(沒有大項可言)，不是外廣格式
    var section = parts.slice(0, sizeIdx).join('__');
    section = WAIGUANG_BG_SECTION_ALIAS[section] || section;
    return { section: section, size: parts[sizeIdx] };
  }

  return {
    draw: function(ctx, layer, state, layoutMeta){
      var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h;
      var layoutId = layoutMeta.layoutId;

      var wg = layoutId ? parseWaiguangLayoutId(layoutId) : null;
      if(wg){
        /* 2026-09新增：外廣某些大項(目前是LINE LAP)後來確認也需要跟站內
           同一套A/B版本切換邏輯(跟「無低消/一般版共用背景」是完全獨立的
           另一個維度)——載入順序照站內的做法：先試「這個版本專屬」的
           資料夾，找不到才退回沒分版本的舊路徑(還沒有A/B資料夾的其他
           大項，完全不受影響，直接命中fallback，行為跟以前一樣)。
           cacheKey要帶上version，不然切換A/B版本時會沿用另一個版本的
           快取結果，畫面不會更新。 */
        var wgVersion = (state.templateVersion === 'B') ? 'B' : 'A';
        var wgCacheKey = 'waiguang|' + wgVersion + '|' + layoutId;
        var wgEntry = cache[wgCacheKey];
        if(!wgEntry){
          var wgVersioned = 'backgrounds/waiguang/'+wg.section+'/'+wgVersion+'/'+wg.size;
          var wgPlain = 'backgrounds/waiguang/'+wg.section+'/'+wg.size;
          tryLoadCandidates(wgCacheKey, [
            wgVersioned+'.jpg', wgVersioned+'.png',
            wgPlain+'.jpg', wgPlain+'.png'
          ]);
          wgEntry = cache[wgCacheKey];
        }
        if(wgEntry && wgEntry.status === 'loaded'){
          drawCover(ctx, wgEntry.img, w, h);
        } else {
          drawSolidFallback(ctx, w, h, state);
        }
        return;
      }

      /* 動態複製出來的版位實例(例如HBN週三版'03_c2c_bn__2')本身沒有自己的
         backgrounds/03_c2c_bn__2.jpg——直接查window.LAYOUT_ALIAS_BASE
         retry回真正的原版位id，兩個實例會顯示同一張背景圖(合理，因為本來
         就是同一份版型)，不用另外準備一份重複的背景檔。 */
      var fileId = (window.LAYOUT_ALIAS_BASE && window.LAYOUT_ALIAS_BASE[layoutId]) ||
                   (window.LAYOUT_ASSET_FALLBACK && window.LAYOUT_ASSET_FALLBACK[layoutId]) ||
                   layoutId;
      var version = (state.templateVersion === 'B') ? 'B' : 'A';

      /* 2026-09擴大適用範圍：券樣模式專屬背景——原本只給SKBN(skinny_app/
         skinny_pc)用(那兩個版位商品模式背景圖的錢幣裝飾是烤進圖檔本身
         的，券樣模式需要換一張沒有錢幣的)，現在改成任何版位都適用——
         例如08_popup這種「A版票券模式要換一張已經印好票券圖案的背景、
         不用另外廣播商品」的情境，也是同一套「檔名多加_coupon後綴」的
         找圖規則，不用重寫一份。
         做法：券樣模式下，優先多試一組「檔名多加_coupon後綴」的候選路徑
         (backgrounds/{版本}/{fileId}_coupon.jpg/png)，找不到才退回原本
         商品模式共用的那張(不會開天窗，只是還沒放新美術之前暫時繼續看到
         舊圖，等美術檔案到位、放進對應檔名，畫面會自動換成新的，不用改
         任何程式)。cacheKey額外加上'|coupon'區分，跟商品模式的cache分開
         存，不會互相蓋掉。只有真的是券樣模式時才會多試這組候選，商品
         模式的背景載入完全不受影響，沿用原本的候選清單跟cacheKey格式。
         ★這個機制天生就會讓「沒有準備_coupon背景檔的版本」自動退回一般
         背景——例如08_popup只有A版準備了'08_popup_coupon.jpg'，B版沒有
         這個檔案，B版券樣模式會直接退回一般的'08_popup.jpg'，不用另外
         寫「只有A版才套用」這種特殊判斷，檔案有沒有準備就決定了行為。 */
      var isCouponBg = (state.exposureStyle === 'coupon');
      var cacheKey = version + '|' + fileId + (isCouponBg ? '|coupon' : '');
      var entry = fileId ? cache[cacheKey] : null;
      if(fileId && !entry){
        var candidates = isCouponBg ? [
          'backgrounds/'+version+'/'+fileId+'_coupon.jpg',
          'backgrounds/'+version+'/'+fileId+'_coupon.png',
          'backgrounds/'+version+'/'+fileId+'.jpg',
          'backgrounds/'+version+'/'+fileId+'.png',
          'backgrounds/'+fileId+'.jpg',
          'backgrounds/'+fileId+'.png'
        ] : [
          'backgrounds/'+version+'/'+fileId+'.jpg',
          'backgrounds/'+version+'/'+fileId+'.png',
          'backgrounds/'+fileId+'.jpg',
          'backgrounds/'+fileId+'.png'
        ];
        tryLoadCandidates(cacheKey, candidates);
        entry = cache[cacheKey];
      }

      if(entry && entry.status === 'loaded'){
        drawCover(ctx, entry.img, w, h);
      } else {
        drawSolidFallback(ctx, w, h, state);
      }
    }
  };
})();
