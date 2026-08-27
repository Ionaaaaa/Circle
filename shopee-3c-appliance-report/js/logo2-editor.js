'use strict';
/*
  logo2-editor.js
  ------------------------------------------------------------
  LOGO2（品牌LOGO，選填）編輯——比照你pet-frenzy專案的editor-logo2-canvas.js：
  獨立popup、獨立畫布，上傳後可以滾輪放大縮小、拖曳移動位置，自動判斷素材是
  「方形」還是「長型」、自動決定底色（PNG固定白色；JPG吸取原圖四個角落+四邊
  中點共8個取樣點裡最常見的顏色），固定圓角，按「確認」把畫面合成成一張PNG，
  套進 S.assets.logo2（後續在各版位畫布上直接畫這張現成的圖，跟畫logo1一樣，
  不用再判斷形狀/裁切/算底色——這些全部在這個面板裡「烤」進同一張圖了）。

  重新編輯：面板重開時要能接續上次的縮放/位移，所以除了合成好的最終PNG
  （存在S.assets.logo2），另外存一份「原始素材（未合成的原圖）＋當時的縮放
  位移」（S.logo2Raw / S.logo2Scale / S.logo2OffX / S.logo2OffY / S.logo2Shape /
  S.logo2BgColor，定義在editor-state.js），重開面板時用這份還原，不用每次
  重新上傳重新調。這幾個欄位都會跟著分頁資料一起存檔/還原（存檔的部分寫在
  editor-state.js的saveCurrentTabIntoData()/applyTabData()）。
*/

var LOGO2_RADIUS_RATIO = 0.06; // 圓角半徑 = min(工作畫布寬,高) × 這個比例
var LOGO2_WORK_DIM = {
  wide:   { w: 640, h: 300 },
  square: { w: 420, h: 460 }
};

var _logo2Canvas = null, _logo2Ctx = null;
var _logo2Img = null;        // 目前的原圖 Image 物件（未合成）
var _logo2Interaction = null;

/* 形狀判斷：跟pet-frenzy的logo2DetectShape()一樣，用「有色範圍(tight bounds)」
   的寬高比例判斷，不是整張圖(含透明留白)的寬高比例——不然上傳一張本身留了很多
   透明邊的長型圖，比例可能會被透明留白拉成看起來像方形，誤判形狀。 */
function logo2DetectShape(tightW, tightH){
  var ratio = tightW / tightH;
  return (ratio >= 0.8 && ratio <= 1.25) ? 'square' : 'wide';
}

/* 底色判斷——明確依副檔名/格式判斷，不是靠透明度間接猜：
   - PNG：固定回傳白色。PNG通常是去背圖，即使背景沒去乾淨、殘留了不透明的顏色，
     大多也是想要「無底色」的效果，統一給白色最安全，不用去猜那個殘留色。
   - 非PNG（JPG等本身沒有透明通道、一定有背景的格式）：真的去抓原圖四個角落＋
     四邊中點共8個取樣點，用出現次數最多的顏色當作素材本身的底色。 */
function logo2SampleBgColor(img){
  if(img && typeof img.src === 'string' && /^data:image\/png/i.test(img.src)) return '#ffffff';
  try{
    var w = img.naturalWidth, h = img.naturalHeight;
    if(!w || !h) return '#ffffff';
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    var pts = [
      [1, 1], [w-2, 1], [1, h-2], [w-2, h-2],
      [Math.floor(w/2), 1], [Math.floor(w/2), h-2],
      [1, Math.floor(h/2)], [w-2, Math.floor(h/2)]
    ];
    var counts = {};
    pts.forEach(function(pt){
      var x = Math.max(0, Math.min(w-1, pt[0]));
      var y = Math.max(0, Math.min(h-1, pt[1]));
      var d = cx.getImageData(x, y, 1, 1).data;
      if(d[3] < 200) return; // 太透明就不算候選（理論上JPG不會有透明，這裡是保險）
      var key = d[0]+','+d[1]+','+d[2];
      counts[key] = (counts[key]||0) + 1;
    });
    var best = null, bestCount = 0;
    Object.keys(counts).forEach(function(k){ if(counts[k] > bestCount){ bestCount = counts[k]; best = k; } });
    if(!best) return '#ffffff';
    var parts = best.split(',').map(Number);
    function hex2(v){ return v.toString(16).padStart(2, '0'); }
    return '#'+hex2(parts[0])+hex2(parts[1])+hex2(parts[2]);
  }catch(e){
    return '#ffffff';
  }
}

function logo2WorkDim(){
  return LOGO2_WORK_DIM[S.logo2Shape === 'square' ? 'square' : 'wide'];
}

function roundRectPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

/* 用「有色範圍(tight bounds)」算一個初始縮放，讓素材剛好放進工作畫布、
   四周留一點內距（不是滿版貼死邊緣），拖曳/縮放過的話這裡就不會再蓋掉
   （只在logo2LoadFromDataUrl()第一次載入這張新圖時呼叫一次）。
   logo2FillMode（滿版填滿，見_composeLogo2Onto()）算法不一樣：沒有底色/
   邊框留白，用「整張原圖」（不是只看有色範圍）去算cover-fit，讓圖片
   完全覆蓋整個工作畫布（可能會裁掉超出範圍的部分），跟一般網頁
   background-size:cover是同樣概念。 */
function logo2InitFit(){
  var dim = logo2WorkDim();

  if(S.logo2FillMode){
    S.logo2Scale = Math.max(dim.w/_logo2Img.naturalWidth, dim.h/_logo2Img.naturalHeight);
    S.logo2OffX = 0; S.logo2OffY = 0;
    return;
  }

  var tight = Core.calcTightBoundsRatio(_logo2Img);
  var tw, th;
  if(tight){ tw = tight.tw*_logo2Img.naturalWidth; th = tight.th*_logo2Img.naturalHeight; }
  else { tw = _logo2Img.naturalWidth; th = _logo2Img.naturalHeight; }
  var pad = 0.82; // 有色範圍只填滿82%，其餘留白，不要滿版貼死圓角邊緣
  S.logo2Scale = Math.min(dim.w*pad/tw, dim.h*pad/th);
  S.logo2OffX = 0; S.logo2OffY = 0;
}

/* 畫「LOGO2目前應該長怎樣」到指定的canvas上，跟原本drawLogo2Canvas()做的事
   完全一樣，只是抽成獨立函式、canvas當參數傳進來，讓「畫在popup的顯示
   canvas上（給使用者看/互動用）」跟「畫在一個全新的、跟popup完全無關的
   canvas上（真正拿去合成輸出用）」可以共用同一份畫圖邏輯，不會兩邊各寫
   一份、容易兜不起來。
   includeBorder：只有popup顯示用的那份需要淡淡的邊框線，真正輸出的
   合成結果不需要。
   logo2FillMode（滿版填滿）：不加底色、不裁圓角，素材直接cover-fit
   塞滿整個工作畫布——「什麼都不加，直接把素材塞滿logo範圍」。 */
function _composeLogo2Onto(canvas, ctx, includeBorder){
  var dim = logo2WorkDim();
  canvas.width = dim.w; canvas.height = dim.h;
  ctx.clearRect(0, 0, dim.w, dim.h);

  if(S.logo2FillMode){
    if(_logo2Img){
      var iw = _logo2Img.naturalWidth * S.logo2Scale;
      var ih = _logo2Img.naturalHeight * S.logo2Scale;
      var cx = dim.w/2 + S.logo2OffX, cy = dim.h/2 + S.logo2OffY;
      ctx.drawImage(_logo2Img, cx-iw/2, cy-ih/2, iw, ih);
    }
    if(includeBorder){
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, dim.w-1, dim.h-1);
      ctx.restore();
    }
    return;
  }

  var r = Math.min(dim.w, dim.h) * LOGO2_RADIUS_RATIO;
  ctx.save();
  roundRectPath(ctx, 0, 0, dim.w, dim.h, r);
  ctx.clip();
  ctx.fillStyle = S.logo2BgColor || '#ffffff';
  ctx.fillRect(0, 0, dim.w, dim.h);
  if(_logo2Img){
    var iw2 = _logo2Img.naturalWidth * S.logo2Scale;
    var ih2 = _logo2Img.naturalHeight * S.logo2Scale;
    var cx2 = dim.w/2 + S.logo2OffX, cy2 = dim.h/2 + S.logo2OffY;
    ctx.drawImage(_logo2Img, cx2-iw2/2, cy2-ih2/2, iw2, ih2);
  }
  ctx.restore();

  if(includeBorder){
    ctx.save();
    roundRectPath(ctx, 0, 0, dim.w, dim.h, r);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

function drawLogo2Canvas(){
  if(!_logo2Ctx) return;
  _composeLogo2Onto(_logo2Canvas, _logo2Ctx, true);
  _logo2Canvas.style.width = _logo2Canvas.width+'px';
  _logo2Canvas.style.height = _logo2Canvas.height+'px';
  updateArPreview();
}

/* AR預覽（只在AR版位目前選的是「店家LOGO」＝S.arVariant==='seller'時顯示）——
   使用者在這裡調整logo2的縮放/位移/形狀/底色時，AR畫布上的店家LOGO要跟著
   同步更新，讓使用者確認前就能看到最終在AR小方塊裡會長怎樣，不用先按確認
   套用、跳去AR畫布看、不滿意再回來調。

   跟正式的modules/ar-module.js用同一套「置中塞進78x77(相對100x100畫布)
   置中框」邏輯，但這裡吃的是「目前正在編輯、還沒按確認的草稿」，不是已經
   存進S.assets.logo2的定案版本——直接呼叫_composeLogo2Onto()把目前畫面
   合成到一個暫存canvas上，這個暫存canvas本身就是「等一下按確認會變成的
   S.assets.logo2」，兩者用同一份合成邏輯，保證預覽準不準跟真的套用出來
   的結果一致。

   ★ S.arExtraScale/OffX/OffY：logo2本身的縮放位移是給logo2卡片（方形/
   橫式）用的，跟AR的78x77小方框比例常常對不上（例如logo2是很扁的橫式，
   AR框比較接近正方形），所以另外開一組「只影響AR預覽」的縮放/位移，可以
   直接在這塊預覽上滾輪縮放/拖曳調整，不會互相干擾logo2卡片本身的調整結果。

   框線（78x77的安全框）改成細虛線輔助線，不是原本可能會被誤會的實心
   遮色片——使用者反映遮色片會擋住畫面看不清楚，虛線只是標示範圍，
   底下的圖完全看得清楚。 */
function updateArPreview(){
  var wrap = document.getElementById('logo2-ar-preview-wrap');
  var cv = document.getElementById('logo2-ar-preview-canvas');
  if(!wrap || !cv) return;

  if(S.arVariant !== 'seller' || !_logo2Img){
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';

  var tmp = document.createElement('canvas');
  var tctx = tmp.getContext('2d');
  _composeLogo2Onto(tmp, tctx, false);

  var W = cv.width, H = cv.height; // 100x100，跟modules/ar-module.js的AR canvas同尺寸
  var ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = S.logo2FillMode ? '#ffffff' : (S.logo2BgColor || '#ffffff');
  ctx.fillRect(0, 0, W, H);

  // AR_BOX = 78x77（相對100x100畫布），跟ar-module.js的AR_BOX同一組比例
  var boxW = W * (78/100), boxH = H * (77/100);
  var baseScale = Math.min(boxW/tmp.width, boxH/tmp.height);
  var scale = baseScale * (S.arExtraScale || 1);
  var dw = tmp.width*scale, dh = tmp.height*scale;
  var dx = W/2 - dw/2 + (S.arExtraOffX||0)*W;
  var dy = H/2 - dh/2 + (S.arExtraOffY||0)*H;
  ctx.drawImage(tmp, dx, dy, dw, dh);

  // 78x77安全框：細虛線輔助線，不擋畫面
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3,2]);
  ctx.strokeRect(W/2-boxW/2, H/2-boxH/2, boxW, boxH);
  ctx.restore();
}

var _arPreviewInteraction = null;
function _bindArPreviewInteractions(){
  var cv = document.getElementById('logo2-ar-preview-canvas');
  if(!cv || cv._arBound) return;
  cv._arBound = true;

  cv.addEventListener('wheel', function(e){
    if(S.arVariant !== 'seller' || !_logo2Img) return;
    e.preventDefault();
    var delta = -e.deltaY * 0.0005;
    S.arExtraScale = Math.max(0.2, Math.min(6, (S.arExtraScale||1) + delta));
    updateArPreview();
  }, { passive:false });

  cv.addEventListener('pointerdown', function(e){
    if(S.arVariant !== 'seller' || !_logo2Img) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    _arPreviewInteraction = { startX:e.clientX, startY:e.clientY, startOffX:S.arExtraOffX||0, startOffY:S.arExtraOffY||0 };
  });
  cv.addEventListener('pointermove', function(e){
    if(!_arPreviewInteraction) return;
    e.preventDefault();
    var rect = cv.getBoundingClientRect();
    S.arExtraOffX = _arPreviewInteraction.startOffX + (e.clientX - _arPreviewInteraction.startX)/rect.width;
    S.arExtraOffY = _arPreviewInteraction.startOffY + (e.clientY - _arPreviewInteraction.startY)/rect.height;
    updateArPreview();
  });
  ['pointerup','pointercancel'].forEach(function(evt){
    cv.addEventListener(evt, function(){ _arPreviewInteraction = null; });
  });
}

function resetArExtra(){
  S.arExtraScale = 1;
  S.arExtraOffX = 0;
  S.arExtraOffY = 0;
  updateArPreview();
}

/* 把目前的LOGO2狀態（S.logo2Scale/OffX/OffY/Shape/BgColor + _logo2Img）
   合成成一張PNG，套進S.assets.logo2。

   ★ 2026-08找到真正的根因了（感謝你提供的完整錯誤訊息）：這支函式原本
   直接用「popup顯示畫面」那個canvas（_logo2Canvas）去合成——但「重新
   選擇」按鈕（在確認LOGO popup裡）、還有匯入工單時資料夾自動比對到
   logo2檔案的流程（logo2AutoApplyFromFile()），都是在**沒有打開LOGO2
   編輯popup**的情況下呼叫這支函式，這時候_logo2Canvas根本還是null
   （只有openLogo2Editor()打開popup時才會賦值），所以才會出現
   「Cannot read properties of null (reading 'toBlob')」。

   跟canvas隱私保護/瀏覽器限制完全沒關係，就是單純「假設popup一定有開」
   但實際上不一定」的邏輯bug。

   修法：改成每次呼叫都自己建立一個全新的、獨立於popup的canvas來合成
   （呼叫上面共用的_composeLogo2Onto()），不管popup有沒有開都能正常
   運作，兩條路徑（有開popup手動調整、或匯入時直接自動套用）用的是
   同一份合成邏輯，結果保證一致。 */
function logo2Composite(cb){
  if(!_logo2Img){
    if(cb) cb(new Error('LOGO2合成失敗（目前沒有素材圖片）'));
    return;
  }

  var canvas, ctx;
  try{
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    _composeLogo2Onto(canvas, ctx, false);
  }catch(e){
    console.error('[logo2Composite] 畫圖階段失敗：', e);
    if(cb) cb(new Error('LOGO2合成失敗（畫圖階段：'+(e && (e.name+' '+e.message))+'）'));
    return;
  }

  function finishWithDataUrl(dataUrl){
    var img = new Image();
    img.onload = function(){
      S.assets = S.assets || {};
      S.assets.logo2 = img;
      if(cb) cb();
    };
    img.onerror = function(){
      console.error('[logo2Composite] 讀回合成圖片階段失敗，dataUrl長度：', dataUrl && dataUrl.length);
      if(cb) cb(new Error('LOGO2合成失敗（讀回圖片階段，dataUrl長度'+(dataUrl?dataUrl.length:0)+'）'));
    };
    img.src = dataUrl;
  }

  try{
    finishWithDataUrl(canvas.toDataURL('image/png'));
  }catch(e){
    console.warn('[logo2Composite] toDataURL失敗，改試toBlob()：', e);
    try{
      canvas.toBlob(function(blob){
        if(!blob){
          console.error('[logo2Composite] toBlob()也回傳null');
          if(cb) cb(new Error('LOGO2合成失敗（toDataURL跟toBlob都失敗，很可能是瀏覽器的隱私/防追蹤保護限制了canvas讀取）'));
          return;
        }
        var reader = new FileReader();
        reader.onload = function(ev){ finishWithDataUrl(ev.target.result); };
        reader.onerror = function(){
          if(cb) cb(new Error('LOGO2合成失敗（toBlob成功但讀取blob失敗）'));
        };
        reader.readAsDataURL(blob);
      }, 'image/png');
    }catch(e2){
      console.error('[logo2Composite] toBlob()也丟出例外：', e2);
      if(cb) cb(new Error('LOGO2合成失敗（匯出階段：'+(e2 && (e2.name+' '+e2.message))+'）'));
    }
  }
}

/* 載入一張新的原圖（使用者上傳/或匯入流程比對到的檔案），自動判斷形狀/底色，
   算好初始貼合位置，寫進S.logo2Raw等狀態，完成後呼叫cb() */
function logo2LoadFromDataUrl(dataUrl, cb){
  var img = new Image();
  img.onload = function(){
    _logo2Img = img;
    S.logo2Raw = dataUrl;
    var tight = Core.calcTightBoundsRatio(img);
    var tw = tight ? tight.tw*img.naturalWidth : img.naturalWidth;
    var th = tight ? tight.th*img.naturalHeight : img.naturalHeight;
    S.logo2Shape = logo2DetectShape(tw, th);
    S.logo2BgColor = logo2SampleBgColor(img);
    logo2InitFit();
    if(cb) cb();
  };
  img.onerror = function(){ if(cb) cb(new Error('LOGO2圖片載入失敗，檔案可能損壞或格式不支援')); };
  img.src = dataUrl;
}

/* 給匯入流程用（editor-popups.js）：資料夾比對到logo2檔案時呼叫，自動載入＋
   自動判斷形狀/底色＋自動合成直接套用，不用強迫使用者一定要打開編輯popup
   才看得到結果——之後使用者還是可以按右側「編輯LOGO2」微調滾輪縮放/拖曳位置。 */
function logo2AutoApplyFromFile(file, cb){
  var reader = new FileReader();
  reader.onload = function(ev){
    logo2LoadFromDataUrl(ev.target.result, function(err){
      if(err){ if(cb) cb(err); return; }
      logo2Composite(cb);
    });
  };
  reader.onerror = function(){ if(cb) cb(new Error('LOGO2檔案讀取失敗')); };
  reader.readAsDataURL(file);
}

/* ── 疊在最上層的小popup，不用editor-popups.js的createOverlay()/closePopup()
   ──因為那組是「同時只能開一個」（開新的會把舊的整個砍掉），如果從「確認LOGO」
   popup裡點「編輯LOGO2」用同一組，會把底下的「確認LOGO」popup一起關掉，使用者
   編輯完LOGO2後就回不去確認流程的下一步了。這裡用自己獨立的一個overlay
   （不同id），疊在原本popup「上面」而不是取代它，關閉時也只關自己這一層。 */
function closeLogo2Overlay(){
  var el = document.getElementById('logo2-editor-overlay');
  if(el) el.remove();
}
function createLogo2Overlay(innerHTML){
  closeLogo2Overlay();
  var overlay = document.createElement('div');
  overlay.id = 'logo2-editor-overlay';
  overlay.className = 'popup-overlay';
  overlay.innerHTML = innerHTML;
  document.body.appendChild(overlay);
  return overlay;
}

/* ── popup UI ──
   onDone(選填)：popup關閉後呼叫（不管是按「確認」、「移除LOGO2」、右上角×，
   或點背景關閉都算），給呼叫端（例如editor-popups.js的LOGO確認popup）用來
   重新整理自己畫面上的縮圖，不用自己額外去監聽這個popup什麼時候關閉。 */
function openLogo2Editor(onDone){
  var hasExisting = !!(S.assets && S.assets.logo2);
  var CANVAS_MAX_W = 640; // 橫式工作畫布的寬度，方形(420)比較窄，用寬的那個當面板寬度基準
  var PANEL_W = CANVAS_MAX_W + 220 + 16 + 40; // 左欄220 + 欄距16 + 右欄留白
  var overlay = createLogo2Overlay(
    '<div class="popup-panel" style="width:'+PANEL_W+'px;">'+
      '<div class="popup-head"><span>編輯LOGO2</span><button class="popup-x" id="logo2-close-x">×</button></div>'+
      '<div class="popup-body" style="display:flex;gap:16px;">'+
        '<div style="width:220px;flex:none;">'+
          '<div id="logo2-dropzone" class="dropzone" style="margin-bottom:12px;">'+
            '<div class="dropzone-icon">'+ICON_IMAGE+'</div>'+
            '<div id="logo2-dropzone-title">拖曳圖片到這裡，或點擊選擇檔案</div>'+
            '<div class="hint" style="margin-top:4px;">選填。PNG會用白色底；JPG會自動吸取圖片四邊底色。</div>'+
          '</div>'+
          '<input type="file" id="logo2-file-input" accept="image/*" style="display:none">'+
          '<div class="field" id="logo2-shape-field" style="display:none;">'+
            '<label>形狀（自動判斷，也可以手動改）</label>'+
            '<div style="display:flex;gap:6px;">'+
              '<button class="tbtn angle-btn" data-shape="square">方形</button>'+
              '<button class="tbtn angle-btn" data-shape="wide">橫式</button>'+
              '<button class="tbtn angle-btn" id="logo2-fillmode-btn">取消白底</button>'+
            '</div>'+
            '<div class="hint" style="margin-top:6px;">「取消白底」不加底色/色塊，素材直接覆蓋整個LOGO範圍。</div>'+
          '</div>'+
          '<div id="logo2-ar-preview-wrap" style="display:none;margin-top:14px;">'+
            '<label style="display:block;font-size:12px;color:var(--text-dim);margin-bottom:6px;">AR預覽（店家LOGO）</label>'+
            '<div style="background:#000;border-radius:8px;padding:10px;display:flex;justify-content:center;">'+
              '<canvas id="logo2-ar-preview-canvas" width="100" height="100" style="width:100px;height:100px;border-radius:6px;cursor:move;"></canvas>'+
            '</div>'+
            '<div class="hint" style="margin-top:6px;">滾輪縮放、拖曳調整位置（虛線是AR安全框範圍）。</div>'+
            '<button class="tbtn" id="logo2-ar-reset-btn" style="width:100%;margin-top:6px;justify-content:center;">重設AR位置</button>'+
          '</div>'+
        '</div>'+
        '<div>'+
          '<div style="display:flex;justify-content:center;">'+
            '<canvas id="logo2-compose-canvas" style="border-radius:8px;cursor:move;"></canvas>'+
          '</div>'+
          '<div class="hint" id="logo2-hint" style="margin-top:8px;display:none;text-align:center;">滾輪放大縮小；拖曳移動位置。</div>'+
        '</div>'+
      '</div>'+
      '<div class="popup-foot">'+
        (hasExisting ? '<button class="tbtn" id="logo2-remove-btn">移除LOGO2</button>' : '')+
        '<span style="flex:1"></span>'+
        '<button class="tbtn primary" id="logo2-confirm-btn">確認</button>'+
      '</div>'+
    '</div>'
  );

  function finish(){
    closeLogo2Overlay();
    renderAll();
    if(onDone) onDone();
  }
  overlay.querySelector('#logo2-close-x').onclick = finish;
  /* 2026-08：同editor-popups.js的createOverlay()，點背景深色區域不再關閉
     popup，只能透過×或明確按鈕關閉。 */

  _logo2Canvas = overlay.querySelector('#logo2-compose-canvas');
  _logo2Ctx = _logo2Canvas.getContext('2d');
  var dropzone = overlay.querySelector('#logo2-dropzone');
  var fileInput = overlay.querySelector('#logo2-file-input');
  var hint = overlay.querySelector('#logo2-hint');
  var shapeField = overlay.querySelector('#logo2-shape-field');

  /* 形狀手動切換：上傳時logo2DetectShape()會自動判斷一次方形/橫式，
     這裡讓使用者可以手動蓋掉自動判斷的結果——按下去之後用
     logo2InitFit()重新算一次「這個形狀的工作畫布」該有的縮放/置中，
     不會維持舊形狀算出來的縮放比例（不然換了工作畫布尺寸，舊的
     縮放值可能會讓圖片明顯過大/過小或位置跑掉）。 */
  function syncShapeButtons(){
    overlay.querySelectorAll('[data-shape]').forEach(function(btn){
      btn.classList.toggle('active', btn.dataset.shape === S.logo2Shape);
    });
    var fillBtn = overlay.querySelector('#logo2-fillmode-btn');
    if(fillBtn) fillBtn.classList.toggle('active', !!S.logo2FillMode);
  }
  overlay.querySelectorAll('[data-shape]').forEach(function(btn){
    btn.onclick = function(){
      if(!_logo2Img) return;
      S.logo2Shape = btn.dataset.shape;
      logo2InitFit();
      syncShapeButtons();
      drawLogo2Canvas();
    };
  });
  var fillModeBtn = overlay.querySelector('#logo2-fillmode-btn');
  fillModeBtn.onclick = function(){
    if(!_logo2Img) return;
    S.logo2FillMode = !S.logo2FillMode;
    logo2InitFit();
    syncShapeButtons();
    drawLogo2Canvas();
  };

  _bindArPreviewInteractions();
  var arResetBtn = overlay.querySelector('#logo2-ar-reset-btn');
  if(arResetBtn) arResetBtn.onclick = resetArExtra;

  function showLoadedUI(){
    dropzone.querySelector('#logo2-dropzone-title').textContent = '已上傳，點擊可重新選擇圖片';
    hint.style.display = '';
    shapeField.style.display = '';
    syncShapeButtons();
    drawLogo2Canvas();
  }

  function onFileChosen(file){
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      logo2LoadFromDataUrl(ev.target.result, function(err){
        if(err){ alert(err.message); return; }
        showLoadedUI();
      });
    };
    reader.readAsDataURL(file);
  }

  dropzone.onclick = function(){ fileInput.click(); };
  fileInput.onchange = function(){ onFileChosen(fileInput.files[0]); fileInput.value = ''; };
  bindDropzone(dropzone, onFileChosen);

  /* 重開popup時，如果之前已經上傳/調整過（S.logo2Raw存在），直接還原上次的圖跟調整結果 */
  if(S.logo2Raw){
    var img = new Image();
    img.onload = function(){ _logo2Img = img; showLoadedUI(); };
    img.src = S.logo2Raw;
  } else {
    drawLogo2Canvas(); // 目前沒有圖，先畫一個空的圓角底當預覽
  }

  _logo2Canvas.addEventListener('wheel', function(e){
    if(!_logo2Img) return;
    e.preventDefault();
    var delta = -e.deltaY * 0.0005;
    S.logo2Scale = Math.max(0.05, Math.min(8, S.logo2Scale + delta));
    drawLogo2Canvas();
  }, { passive:false });

  _logo2Canvas.addEventListener('pointerdown', function(e){
    if(!_logo2Img) return;
    e.preventDefault();
    _logo2Canvas.setPointerCapture(e.pointerId);
    _logo2Interaction = { startX:e.clientX, startY:e.clientY, startOffX:S.logo2OffX, startOffY:S.logo2OffY };
  });
  _logo2Canvas.addEventListener('pointermove', function(e){
    if(!_logo2Interaction) return;
    e.preventDefault();
    S.logo2OffX = _logo2Interaction.startOffX + (e.clientX - _logo2Interaction.startX);
    S.logo2OffY = _logo2Interaction.startOffY + (e.clientY - _logo2Interaction.startY);
    drawLogo2Canvas();
  });
  ['pointerup','pointercancel'].forEach(function(evt){
    _logo2Canvas.addEventListener(evt, function(){ _logo2Interaction = null; });
  });

  var removeBtn = overlay.querySelector('#logo2-remove-btn');
  if(removeBtn){
    removeBtn.onclick = function(){
      S.assets = S.assets || {};
      S.assets.logo2 = null;
      S.logo2Raw = null; S.logo2Shape = null; S.logo2Scale = 1; S.logo2OffX = 0; S.logo2OffY = 0;
      finish();
    };
  }

  overlay.querySelector('#logo2-confirm-btn').onclick = function(){
    if(!_logo2Img){
      // 沒有上傳任何圖片：直接關閉，等於「這次工單不需要logo2」，維持原本(可能是null)的狀態
      finish();
      return;
    }
    logo2Composite(function(err){
      if(err){ alert(err.message); return; }
      finish();
    });
  };
}
