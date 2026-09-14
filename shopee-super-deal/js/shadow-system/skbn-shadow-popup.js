'use strict';
/*
  skbn-shadow-popup.js
  ------------------------------------------------------------
  Skinny BN(SKBN) 單品陰影合成——跟js/shadow-system/shadow-popup.js
  (KV「調整商品／主持人」那個1200x1200、3品同框的popup)是姊妹功能，底層
  完全共用同一套引擎(ShadowLayoutReceiver拖曳/縮放/旋轉、ShadowPlugin陰影
  算圖)，只是把「多素材、有舞台、有版型組合」的複雜度整個拿掉，改成
  「固定一個商品、沒有舞台」的精簡版：
    1. SKBN每張圖只放版頭(KV)3個商品其中1品，不是3品同框，不需要combo
       選單/素材清單/拖曳排序這些多素材才需要的UI。
    2. SKBN沒有「舞台」這個視覺概念(圓柱底座)，商品是單純貼地陰影。

  ★ 這個popup依「商品」共用，不是依「實例」(2026-09第八版定案)：
  一個商品(例如商品1(左))會同時出現在Skinny BN APP、PC兩個實例上。這個
  popup內部調的位置/旋轉/縮放，跟外面主畫布上實際貼合的位置完全是兩回事
  ——外面一律靠js/editor-main.js的ensureHostAutoFit()，用「商品範圍」
  (artZone)在各自版位設定檔裡真正的座標去獨立計算，不管popup裡把商品
  擺在哪都不影響。既然popup內部的框架跟外面顯示無關，就沒有必要為
  APP(358x360)、PC(400x110)兩種完全不同的比例分別開兩個popup——工作
  畫布固定用一個正方形(SKBN_POPUP_SIZE，見下面)，不管使用者是從APP的
  「商品/小標」按鈕、還是PC的按鈕點進來，開的都是「同一個商品」的同一個
  popup、同一份資料(S.skbnProductSlots[product])，按下「確認並套用」
  時一次把同一張合成圖同時套用給APP、PC兩邊，才是真正的「連動」——不是
  各自合成一次、湊巧套用同一份設定。

  跟KV最大的架構差異：KV是「一整個分頁只有一份S.assets.host」，SKBN是
  「同一個layoutId(skinny_app/skinny_pc)重複3個實例，每個實例要各自獨立
  一張合成圖」——這裡合成完不會寫回S.assets，而是寫進新的
  S.instanceAssets[instanceId][hostSlot]，讓modules/logo-module.js依實例
  分開讀取(見js/editor-state.js裡S.instanceAssets的說明)。雖然popup是
  依商品共用，但輸出結果仍然要分別寫進APP、PC「各自的」instanceAssets
  (兩邊的hostSlot欄位名稱本來就不一樣：hostSkinnyApp/hostSkinnyPc)。

  ShadowPlugin.registerProduct()/products{}是「整個頁面共用一份、只用
  slotId字串當key」的全域registry(見shadow-plugin.js)——不同商品的
  背景自動合成可能同時進行，這裡每個商品用自己專屬的slotId('skbn_'+
  product)，避免互相蓋掉彼此正在使用的圖片；receiver認不得這個自訂代號、
  量不到現成的置中位置數字，改成_skbnUpsertCentered()自己算一次。

  小標整個是主畫布上即時疊加的(不烤進這裡匯出的合成PNG裡)——使用者反映
  想直接在SKBN畫布上拖曳小標位置，不想開這個陰影popup才能調。小標實際的
  即時繪製/拖曳/縮放邏輯在js/editor-main.js(getSkbnTagBox()/
  drawSkbnTagOverlay()/attachSkbnTagDragResize())，這裡只保留「小標開關/
  文字內容」的設定UI，跟一份跟位置無關的獨立示意圖；兩邊讀寫同一份
  S.skbnProductSlots[product].priceTag，互相同步。

  已知範圍外的事(先不做，之後有需要再補)：
    - 最終「下載」的檔名規則(README要求07_Skinny_BN_APP_1.jpg等)——已在
      js/editor-export.js處理，這裡不重複說明。
    - Excel匯入時S.instances怎麼帶出這3個實例——目前的做法是把
      LAYOUT_MATERIAL_KEYWORDS(js/editor-import.js)裡__2/__3設成跟base id
      一樣的關鍵字，讓一次「SKINNY BN APP」材料項目命中就同時生出3個實例；
      商品對應關係固定按LAYOUT_REGISTRY登記順序分配(商品1(左)/2(中)/3(右))，
      見js/editor-state.js的window.SKBN_INSTANCE_META。
*/

var SKBN_DEFAULT_X_PCT = 0.5;
var SKBN_DEFAULT_Y_PCT = 0.62;  // 沿用shadow-layout-defaults-circle.js的PRODUCT_POS_CENTER.yPct
var SKBN_DEFAULT_H_PCT = 0.46;  // 沿用shadow-layout-defaults-circle.js的PRODUCT_BASE_HPCT

/* ★ 2026-09第八版「popup整個改成依商品共用，不是依實例」：使用者確認
  popup內部調的位置/旋轉/縮放，跟外面主畫布上實際貼合的位置(靠
  ensureHostAutoFit()用「商品範圍」artZone重新計算)本來就是兩回事——
  popup內部框架長什麼樣子，不影響外面貼合的結果。既然如此，popup工作
  畫布也不需要依實例分別對齊APP(358x360)或PC(400x110)的比例，直接固定
  用一個正方形畫布就好，APP、PC共用同一個popup、同一份transform——
  點開APP的「商品/小標」或PC的「商品/小標」，看到的是同一個編輯器、
  同一次調整，改完套用時APP、PC會同時更新成同一張合成圖(細節見
  exportSkbnComposite()/ensureSkbnAutoCompose())，不用再各調一次、也不
  會有「換照片時PC沿用APP的舊transform而變形」這種問題(不同實例間本來
  就不會有兩份各自的transform了)。
  S.skbnProductSlots[product].transform：現在也存在這裡(商品共用)，
  取代舊版的S.skbnSlots[instanceId].transform。S.skbnSlots[instanceId]
  現在只剩tagScaleMul/tagPosOverride(小標大小/PC小標獨立位置，這兩個
  才是真的需要依實例分開)。 */
var SKBN_POPUP_SIZE = 1200;

function _skbnSlotIdFor(product){ return 'skbn_' + product; } // 現在依商品，不是依實例，見上面2026-09第八版說明

/* 互動popup專用的模組級狀態——只有popup開著的時候才有意義。
   _skbnProduct是目前popup對應的商品(依商品共用，見上面2026-09第八版
   說明)；_skbnInstanceId/_skbnMeta記錄「使用者是從哪一個實例的按鈕點
   進來的」，只用來給popup標題/縮圖顯示用，不影響實際存讀資料(存讀一律
   用_skbnProduct)。 */
var _skbnCanvas = null, _skbnCtx = null, _skbnReceiver = null;
var _skbnInstanceId = null, _skbnMeta = null, _skbnProduct = null;
var _skbnOverlayEl = null;

/* ── 置中上傳：見檔頭2026-09第二版修正的說明。只有互動popup會呼叫這支
   (openSkbnShadowPopup()初次載入、_skbnApplyDataUrl()換圖時) ──
   ★ 2026-09第七版修正「換商品照片會變形」：原本existingTransform有值時
   直接把它的x/y/w0/h0原封不動套到新照片上——w0/h0是「上一張照片」算出來
   的絕對像素寬高，如果新照片的長寬比跟上一張不一樣(例如原本細長型的
   商品，換成方形的)，硬套舊的w0/h0會把新照片拉伸/壓扁變形。
   現在改成：不管有沒有existingTransform，都先upsert一次量出「這張新
   照片自己」的實際寬高比；有existingTransform的話，位置(x/y)跟高度(h0)
   沿用舊的(維持使用者原本調整過的擺放位置/大小不變)，但寬度(w0)永遠
   依這張新照片自己的寬高比重新算，不會被舊照片的寬高比拖著變形。 */
function _skbnUpsertCentered(receiver, slotId, dataUrl, workW, workH, existingTransform, cb){
  receiver.handleMessage({ type:'LC_UPSERT_SLOT', slotId:slotId, slotType:'product', dataUrl:dataUrl, ratio:1 }, function(){
    var raw = receiver.getSlotRaw(slotId);
    var aspect = (raw && raw.w0 && raw.h0) ? (raw.w0/raw.h0) : 1;
    var fixedTransform;
    if(existingTransform && typeof existingTransform.x === 'number' && typeof existingTransform.h0 === 'number'){
      fixedTransform = {
        x: existingTransform.x, y: existingTransform.y,
        w0: existingTransform.h0 * aspect, h0: existingTransform.h0, // 高度沿用舊的，寬度依新照片自己的比例重算
        scaleMul: (typeof existingTransform.scaleMul === 'number') ? existingTransform.scaleMul : 1,
        rot: existingTransform.rot || 0,
        shadowScaleX: (typeof existingTransform.shadowScaleX === 'number') ? existingTransform.shadowScaleX : 1,
        shadowScaleY: (typeof existingTransform.shadowScaleY === 'number') ? existingTransform.shadowScaleY : 1
      };
    } else {
      var h0 = workH * SKBN_DEFAULT_H_PCT;
      fixedTransform = { x: workW*SKBN_DEFAULT_X_PCT, y: workH*SKBN_DEFAULT_Y_PCT, w0: h0*aspect, h0:h0, scaleMul:1, rot:0, shadowScaleX:1, shadowScaleY:1 };
    }
    receiver.handleMessage({ type:'LC_REMOVE_SLOT', slotId:slotId });
    receiver.handleMessage({ type:'LC_UPSERT_SLOT', slotId:slotId, slotType:'product', dataUrl:dataUrl, ratio:1, transform:fixedTransform }, function(){
      receiver.handleMessage({ type:'LC_SET_ENABLED', ids:[slotId] });
      if(cb) cb();
    });
  });
}

/* ── 小標(原價/特價)：狀態存在S.skbnProductSlots[product].priceTag，依
   「商品」共用(不是依實例)——跟js/editor-main.js的getSkbnTagBox()讀寫
   同一份資料。這裡只保留checkbox開關/文字內容的讀寫(_skbnPtCfg)，實際
   畫成圖形分兩個完全獨立的地方：
     - 真正可拖曳/縮放的即時疊加，畫在主畫布上，見js/editor-main.js的
       getSkbnTagBox()/drawSkbnTagOverlay()。
     - popup裡的示意圖，是跟位置無關的固定尺寸小圖(見
       _skbnRenderPriceTagControls()裡的drawPreview())，純粹讓使用者
       確認文字內容打出來的樣子。
   ★ 2026-09第六版：原本這裡還有一份「小標黏在商品上」的靜態預覽
   (_skbnProductBBox/_skbnComputeTagBox/_skbnDrawPriceTag)，畫在popup的
   1200工作畫布裡、貼著商品旁邊——使用者反映這份預覽不能拖曳、也沒有跟
   主畫布真正連動，貼在商品旁邊反而讓人誤以為看到的位置/大小就是最終
   結果。拿掉了，改成上面「跟位置無關的獨立示意圖」。如果之後要做到
   「popup預覽跟主畫布真正同步、一模一樣的位置/大小」，才需要重新做
   一套讀取getSkbnTagBox()那份邏輯的預覽，不是這裡刪掉的舊版本。
   渲染邏輯(小標形狀/文字怎麼畫)共用modules/pricetag-module.js，不重複
   寫。 */
function _skbnPtCfg(product){
  S.skbnProductSlots = S.skbnProductSlots || {};
  S.skbnProductSlots[product] = S.skbnProductSlots[product] || {};
  var rec = S.skbnProductSlots[product];
  if(!rec.priceTag){
    rec.priceTag = { on:false, offsetXPct:0.9, offsetYPct:0.88, orientation:'left', originalPrice:'', salePrice:'' };
  }
  return rec.priceTag;
}

function _skbnRenderPriceTagControls(container, product, redraw){
  if(!container) return;
  var cfg = _skbnPtCfg(product);
  container.innerHTML =
    '<label><input type="checkbox" id="skbn-pt-toggle" '+(cfg.on?'checked':'')+'> 顯示小標</label>'+
    '<div id="skbn-pt-inputs" style="display:'+(cfg.on?'flex':'none')+';gap:4px;margin-top:4px;">'+
      '<input type="text" id="skbn-pt-orig" placeholder="原價 例:$490/32入" value="'+esc(cfg.originalPrice)+'" style="width:50%;font-size:11px;">'+
      '<input type="text" id="skbn-pt-sale" placeholder="特價 例:$313/32入" value="'+esc(cfg.salePrice)+'" style="width:50%;font-size:11px;">'+
    '</div>'+
    /* 2026-09第六版：拿掉「小標黏在商品上」的預覽——這裡的預覽本來就不能
       拖曳、也沒有跟主畫布連動(見getSkbnTagBox()那套APP/PC連動邏輯)，
       貼在商品旁邊只會讓使用者誤以為看到的位置/大小就是最終結果，反而
       誤導。改成一個跟位置完全無關的獨立小圖，純粹示意「這組原價/特價
       文字打出來大概長怎樣」，真正的位置/大小請在SKBN畫布上直接拖曳/
       拖角落調整。 */
    '<div id="skbn-pt-preview-wrap" style="margin-top:8px;display:'+(cfg.on?'block':'none')+';">'+
      '<canvas id="skbn-pt-preview-canvas" width="220" height="72" style="width:220px;height:72px;background:#3a3a3a;border-radius:6px;display:block;"></canvas>'+
    '</div>'+
    '<div class="hint" style="margin-top:6px;">上面是文字內容示意，跟實際大小/位置無關。小標的位置／大小請直接在SKBN畫布上拖曳／拖角落調整：APP調整位置會連動PC，PC調整過一次之後位置就跟APP各自獨立（大小本來就各自獨立，不會互相連動）。</div>';

  var previewCanvas = container.querySelector('#skbn-pt-preview-canvas');
  function drawPreview(){
    if(!previewCanvas) return;
    var pctx = previewCanvas.getContext('2d');
    pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    if(!cfg.on) return;
    var h = 40; // 固定大小，純示意，不代表實際輸出大小
    var size = Modules.pricetag.computeSize(pctx, h, cfg.originalPrice, cfg.salePrice);
    var box = {
      x: (previewCanvas.width - size.w)/2, y: (previewCanvas.height - h)/2, w: size.w, h: h,
      cx: previewCanvas.width/2, cy: previewCanvas.height/2,
      orientation: 'left', originalPrice: cfg.originalPrice, salePrice: cfg.salePrice
    };
    Modules.pricetag.draw(pctx, box);
  }

  container.querySelector('#skbn-pt-toggle').addEventListener('change', function(e){
    cfg.on = e.target.checked;
    container.querySelector('#skbn-pt-inputs').style.display = cfg.on ? 'flex' : 'none';
    container.querySelector('#skbn-pt-preview-wrap').style.display = cfg.on ? 'block' : 'none';
    drawPreview();
    redraw();
  });
  container.querySelector('#skbn-pt-orig').addEventListener('input', function(e){ cfg.originalPrice = e.target.value; drawPreview(); redraw(); });
  container.querySelector('#skbn-pt-sale').addEventListener('input', function(e){ cfg.salePrice = e.target.value; drawPreview(); redraw(); });

  drawPreview();
}

/* ── 中性素色底(給使用者看陰影方向用，不會烤進最終輸出、也不代表任何
   真正的版位背景) ──
   ★ 2026-09第九版：拿掉「載入APP或PC實際背景圖」的做法——使用者反映
   背景放SKBN APP的實際背景圖，會讓人誤以為這個popup是「APP專用」的；
   從PC的按鈕點進來，看到的又是同一張APP背景裁切成正方形，根本不是PC
   真正的背景，兩種情況都容易誤導使用者去對照背景做判斷。這個popup的
   目的單純是「確認商品陰影」，跟任何一邊的背景無關(見檔頭「popup依商品
   共用、固定1200x1200」的說明)，改成固定的中性素色底，不管商品是哪個
   商品、popup是從APP還是PC點進來，看到的都是同一種底色，只聚焦在商品
   本身。用淺灰中心、稍深邊緣的淡淡放射狀漸層(不是純平面色)，單純是
   為了讓使用者比較看得出陰影往哪個方向延伸、深淺變化，不是要模擬任何
   實際背景。 */
function drawSkbnCanvas(){
  if(!_skbnCtx) return;
  _skbnCtx.clearRect(0, 0, SKBN_POPUP_SIZE, SKBN_POPUP_SIZE);

  var grad = _skbnCtx.createRadialGradient(
    SKBN_POPUP_SIZE/2, SKBN_POPUP_SIZE/2, 0,
    SKBN_POPUP_SIZE/2, SKBN_POPUP_SIZE/2, SKBN_POPUP_SIZE*0.7
  );
  grad.addColorStop(0, '#e8e8e8');
  grad.addColorStop(1, '#c4c4c4');
  _skbnCtx.fillStyle = grad;
  _skbnCtx.fillRect(0, 0, SKBN_POPUP_SIZE, SKBN_POPUP_SIZE);

  _skbnReceiver.drawItems(_skbnCtx, { skipSelection: true });
  _skbnReceiver.drawItems(_skbnCtx, { onlyIds: [] }); // 只用來畫選取框，素材已經在上面畫過了
  _skbnSyncTransformIntoState();
}

/* 每次重畫都把receiver目前的原始x/y/w0/h0/scaleMul/rot讀出來，寫回
   S.skbnProductSlots[product].transform——跟shadow-popup.js的
   syncTransformsIntoState()同一個道理，讓使用者拖曳/縮放/旋轉的結果能
   跟著tab資料一起存檔/還原，重開popup不會被打回預設位置。2026-09第八版：
   transform現在依商品共用存(見檔頭說明)，不是依實例。 */
function _skbnSyncTransformIntoState(){
  if(!_skbnReceiver || !_skbnProduct) return;
  S.skbnProductSlots = S.skbnProductSlots || {};
  S.skbnProductSlots[_skbnProduct] = S.skbnProductSlots[_skbnProduct] || {};
  var raw = _skbnReceiver.getSlotRaw(_skbnSlotIdFor(_skbnProduct));
  if(raw) S.skbnProductSlots[_skbnProduct].transform = raw;
}

/* 換圖/套用商品：跟shadow-popup.js的applyShadowSlotDataUrl()同一個邏輯——
   如果先前已經調整過位置(transform存在)，換圖時繼續沿用(高度不變、寬度
   依新照片自己的比例重算，見_skbnUpsertCentered()的說明，不會變形)。
   dataUrl/transform現在都存在S.skbnProductSlots[product](依商品共用，
   見檔頭2026-09第八版說明)。 */
function _skbnApplyDataUrl(dataUrl){
  var product = _skbnProduct;
  var prec = S.skbnProductSlots[product];
  prec.dataUrl = dataUrl;
  _skbnUpsertCentered(_skbnReceiver, _skbnSlotIdFor(product), dataUrl, SKBN_POPUP_SIZE, SKBN_POPUP_SIZE, prec.transform, drawSkbnCanvas);
  _skbnReceiver.setActiveSlot(_skbnSlotIdFor(product), drawSkbnCanvas);
  _skbnRefreshThumb();
}

function _skbnRefreshThumb(){
  var wrap = _skbnOverlayEl && _skbnOverlayEl.querySelector('#skbn-thumb-wrap');
  if(!wrap) return;
  var rec = S.skbnProductSlots && S.skbnProductSlots[_skbnProduct];
  var src = rec && rec.dataUrl;
  wrap.innerHTML = src
    ? '<img src="'+src+'" style="max-width:100%;max-height:120px;display:block;border:1px solid var(--border);border-radius:6px;">'
    : '<div class="hint" style="margin:0;">尚未有商品圖片，請按下面「更換圖片」上傳，或套用版頭商品照片。</div>';
}

/* ── 合成：陰影+照片分開畫再合成，避免陰影的multiply混合模式把照片也弄灰。
   跟shadow-popup.js的renderShadowAndPhotoCanvases()演算法完全相同，這裡
   另外寫一份純粹是因為尺寸要用參數傳進來的workW/workH(依實際輸出比例
   算出來的工作畫布)，不是KV固定寫死的1200x1200。★ 2026-09第五版：不再
   畫小標(見檔頭說明，小標改成主畫布即時疊加，不烤進這張PNG)。 ── */
function renderSkbnShadowAndPhotoCanvases(states, workW, workH){
  var shadowCv = document.createElement('canvas');
  shadowCv.width = workW; shadowCv.height = workH;
  var sctx = shadowCv.getContext('2d');
  var photoCv = document.createElement('canvas');
  photoCv.width = workW; photoCv.height = workH;
  var pctx = photoCv.getContext('2d');
  if(!states.length) return { shadowCv: shadowCv, photoCv: photoCv };

  sctx.fillStyle = '#ffffff';
  sctx.fillRect(0, 0, workW, workH);
  ShadowPlugin.renderScene(sctx, states, true);

  try{
    var imgData = sctx.getImageData(0, 0, workW, workH);
    var d = imgData.data;
    for(var i=0;i<d.length;i+=4){
      var r=d[i], g=d[i+1], b=d[i+2];
      var alpha = 255 - Math.min(r,g,b);
      if(alpha <= 1){ d[i]=0; d[i+1]=0; d[i+2]=0; d[i+3]=0; continue; }
      d[i]   = Math.max(0, Math.min(255, 255 - (255-r)*255/alpha));
      d[i+1] = Math.max(0, Math.min(255, 255 - (255-g)*255/alpha));
      d[i+2] = Math.max(0, Math.min(255, 255 - (255-b)*255/alpha));
      d[i+3] = alpha;
    }
    sctx.putImageData(imgData, 0, 0);
  }catch(e){ console.warn('[skbn-shadow-popup] 陰影去白轉透明失敗：', e); }

  ShadowPlugin.renderPhotosOnly(pctx, states);
  return { shadowCv: shadowCv, photoCv: photoCv };
}

/* 互動popup按下「確認並套用」時呼叫，把目前receiver狀態(純陰影，不含
   小標，見檔頭2026-09第五版說明)合成成一張PNG dataURL。回傳Promise，
   沒有素材時reject。
   ★ angle一定要當參數傳進來、在這支函式最前面(跟下面configureZone()同一個
   沒有任何await/Promise間隙的同步區塊裡)才呼叫ShadowPlugin.setAngle()——
   ShadowPlugin.setAngle()/configureZone()跟products{}一樣，是整個頁面
   共用的全域狀態(見shadow-plugin.js)，不是跟著某個receiver或某次呼叫
   獨立的。ensureSkbnAutoCompose()一次會對好幾個SKBN實例同時(非同步交錯)
   觸發合成，如果setAngle()在呼叫端很早以前就先設定好、跟真正呼叫
   renderScene()之間隔了「upsertSlot圖片載入」這種非同步步驟，中間就很
   容易被另一個實例的setAngle()插隊蓋掉。現在setAngle()跟configureZone()、
   renderScene()全部擠在同一個同步執行的Promise executor裡，中間JS不會
   被別的程式碼插隊，保證「設定的角度」跟「拿去畫的角度」一定是同一個。 */
function _skbnComposeToDataUrl(receiver, workW, workH, angle){
  return new Promise(function(resolve, reject){
    if(typeof ShadowPlugin === 'undefined'){ reject(new Error('ShadowPlugin未載入')); return; }
    var allStates = receiver.getOrderedStates();
    if(!allStates.length){ reject(new Error('沒有素材可以合成')); return; }

    if(angle) ShadowPlugin.setAngle(angle);
    ShadowPlugin.configureZone(workH*0.1, workH*0.95);
    var rendered = renderSkbnShadowAndPhotoCanvases(allStates, workW, workH);

    var outCv = document.createElement('canvas');
    outCv.width = workW; outCv.height = workH;
    var octx = outCv.getContext('2d');
    octx.drawImage(rendered.shadowCv, 0, 0);
    octx.drawImage(rendered.photoCv, 0, 0);

    /* 用toDataURL()（base64字串）取代toBlob()+URL.createObjectURL()——跟
       shadow-popup.js的exportShadowComposite()同一個理由：blob網址只在
       這次分頁還活著的期間有效，暫存.json存的如果是blob網址，重新整理後
       就讀不回來了。 */
    resolve(outCv.toDataURL('image/png'));
  });
}

/* 把合成好的dataURL轉成Image、寫進S.instanceAssets[instanceId][hostSlot]，
   完成後呼叫cb()。 */
function _skbnApplyComposedImage(instanceId, hostSlot, dataUrl, cb){
  var img = new Image();
  img.onload = function(){
    S.instanceAssets = S.instanceAssets || {};
    S.instanceAssets[instanceId] = S.instanceAssets[instanceId] || {};
    S.instanceAssets[instanceId][hostSlot] = img;
    if(cb) cb();
  };
  img.onerror = function(){ console.warn('[skbn-shadow-popup] 合成結果讀不回Image物件: '+instanceId); if(cb) cb(); };
  img.src = dataUrl;
}

/* 2026-09第八版：popup現在是依商品共用的，一次「確認並套用」直接把同一張
   合成圖套用到「這個商品」名下所有實例(APP+PC)，不是只套用使用者從哪個
   實例點進來的那一個、再清掉別的實例讓它之後自己重跑——這樣APP、PC看到
   的才會是真正同一次合成的結果，不會有時間差或各自算一次的落差。 */
function exportSkbnComposite(){
  if(!_skbnReceiver || !_skbnProduct) return;
  var product = _skbnProduct;
  var angle = (S.skbnProductSlots[product] && S.skbnProductSlots[product].shadowAngle) || 'left';
  _skbnComposeToDataUrl(_skbnReceiver, SKBN_POPUP_SIZE, SKBN_POPUP_SIZE, angle).then(function(dataUrl){
    var targetIds = Object.keys(window.SKBN_INSTANCE_META || {}).filter(function(id){
      return window.SKBN_INSTANCE_META[id].product === product;
    });
    var remaining = targetIds.length;
    if(!remaining){ closePopup(); return; }
    targetIds.forEach(function(instId){
      var m = window.SKBN_INSTANCE_META[instId];
      _skbnApplyComposedImage(instId, m.hostSlot, dataUrl, function(){
        remaining--;
        if(remaining <= 0){
          closePopup();
          if(typeof renderAll === 'function') renderAll();
        }
      });
    });
  }).catch(function(err){
    alert(err.message === '沒有素材可以合成' ? '請先上傳／套用商品圖片，才能套用陰影合成' : ('合成失敗：'+err.message));
  });
}

/* ══════════════════ 商品照片自動就定位+套陰影(不用開popup) ══════════════════
   商品照片一到位，不用開popup，直接自動套上陰影，交給js/editor-main.js
   已經通用化支援SKBN的ensureHostAutoFit()用「商品範圍」(artZone)真正的
   座標去置中/縮放、attachHostDragResize()讓使用者直接在主畫布上拖曳/
   縮放——這兩支不用知道畫布上的圖有沒有陰影，反正都是同一張圖去貼合。
   預設光源角度'left'(光源從左邊照過來，陰影才會往右延伸——跟
   shadow-plugin.js的shear算法核對過)。
   2026-09第八版：改成依「商品」跑(3次)，不是依「實例」跑(6次)——一個
   商品的陰影只合成一次(固定1200x1200工作畫布，見SKBN_POPUP_SIZE)，
   結果同時套用到這個商品名下「還沒有合成結果」的所有實例(可能是
   APP+PC都還沒有，也可能只剩其中一個還沒有——例如使用者已經手動在
   popup裡對其中一個確認過)。dataUrl/shadowAngle/transform全部讀
   S.skbnProductSlots[product](依商品共用)。 */
var _skbnAutoComposeInFlight = {};

function ensureSkbnAutoCompose(){
  if(!window.SKBN_INSTANCE_META || !window.S || typeof ShadowLayoutReceiver === 'undefined') return;

  var products = {};
  Object.keys(window.SKBN_INSTANCE_META).forEach(function(instanceId){
    products[window.SKBN_INSTANCE_META[instanceId].product] = true;
  });

  Object.keys(products).forEach(function(product){
    var instancesForProduct = Object.keys(window.SKBN_INSTANCE_META).filter(function(id){
      return window.SKBN_INSTANCE_META[id].product === product;
    });
    var missing = instancesForProduct.filter(function(id){
      var m = window.SKBN_INSTANCE_META[id];
      return !(S.instanceAssets && S.instanceAssets[id] && S.instanceAssets[id][m.hostSlot]);
    });
    if(!missing.length) return; // 這個商品的APP、PC都已經有合成結果了(不管是自動生成還是使用者確認過的)，不重新蓋掉
    if(_skbnAutoComposeInFlight[product]) return;

    S.skbnProductSlots = S.skbnProductSlots || {};
    if(!S.skbnProductSlots[product]){
      S.skbnProductSlots[product] = { dataUrl:null, shadowAngle:'left', transform:null,
        priceTag:{ on:false, offsetXPct:0.9, offsetYPct:0.88, orientation:'left', originalPrice:'', salePrice:'' } };
    }
    var prec = S.skbnProductSlots[product];

    var srcDataUrl = prec.dataUrl || (S.shadowSlots && S.shadowSlots[product] && S.shadowSlots[product].dataUrl) || null;
    if(!srcDataUrl) return; // 版頭這個商品還沒上傳照片，沒東西可以合成，先跳過，等照片到位下一次renderAll()自然會補上
    if(!prec.dataUrl) prec.dataUrl = srcDataUrl;
    if(!prec.shadowAngle) prec.shadowAngle = 'left';

    _skbnAutoComposeInFlight[product] = true;

    /* 用一個獨立、不掛進DOM、使用者看不到的canvas+receiver跑一次陰影合成，
       過程跟互動popup完全一樣(_skbnUpsertCentered+_skbnComposeToDataUrl)，
       只是沒有UI、不用使用者按確認。這個工作畫布內部怎麼置中不影響最終
       結果貼在主畫布上的位置/大小——那件事交給ensureHostAutoFit()用真正
       的artZone座標重新算一次，這裡只要保證商品(含陰影)在這個工作畫布裡
       沒有被裁切到就好。 */
    var offCanvas = document.createElement('canvas');
    offCanvas.width = SKBN_POPUP_SIZE; offCanvas.height = SKBN_POPUP_SIZE;
    var receiver = ShadowLayoutReceiver.create(offCanvas, { stageId: 'skbn_auto_'+product });

    var slotId = _skbnSlotIdFor(product);
    _skbnUpsertCentered(receiver, slotId, prec.dataUrl, SKBN_POPUP_SIZE, SKBN_POPUP_SIZE, prec.transform, function(){
      prec.transform = receiver.getSlotRaw(slotId) || prec.transform; // 第一次自動置中算出來的結果也存起來，下次(包括打開互動popup時)不用重算

      _skbnComposeToDataUrl(receiver, SKBN_POPUP_SIZE, SKBN_POPUP_SIZE, prec.shadowAngle).then(function(dataUrl){
        var remaining = missing.length;
        missing.forEach(function(id){
          var m = window.SKBN_INSTANCE_META[id];
          _skbnApplyComposedImage(id, m.hostSlot, dataUrl, function(){
            remaining--;
            if(remaining <= 0){
              delete _skbnAutoComposeInFlight[product];
              if(typeof renderAll === 'function') renderAll(); // 觸發ensureHostAutoFit()把這張(含陰影的)圖貼進商品範圍
            }
          });
        });
      }).catch(function(err){
        console.warn('[skbn-shadow-popup] 自動合成失敗：', product, err);
        delete _skbnAutoComposeInFlight[product];
      });
    });
  });
}
window.ensureSkbnAutoCompose = ensureSkbnAutoCompose;

/* ── 開啟互動popup ──
   2026-09第八版：popup依「商品」共用，不是依「實例」——不管使用者是從
   APP的「商品/小標」按鈕、還是PC的「商品/小標」按鈕點進來，只要商品
   相同(例如都是商品1(左))，開出來的就是同一個popup、同一份資料
   (S.skbnProductSlots[product])，改完套用時APP、PC會同時更新。
   instanceId參數只用來知道「使用者這次是從哪裡點進來的」，拿去查
   window.SKBN_INSTANCE_META算出product，以及給縮圖/標題顯示用；除此
   之外popup內部完全不分APP/PC。 */
function openSkbnShadowPopup(instanceId){
  var meta = window.SKBN_INSTANCE_META && window.SKBN_INSTANCE_META[instanceId];
  if(!meta){ console.warn('[skbn-shadow-popup] 找不到SKBN設定: '+instanceId); return; }
  _skbnInstanceId = instanceId;
  _skbnMeta = meta;
  _skbnProduct = meta.product;
  var product = meta.product;

  S.skbnProductSlots = S.skbnProductSlots || {};
  if(!S.skbnProductSlots[product]){
    /* 理論上ensureSkbnAutoCompose()或匯入流程已經先建立過這筆資料，這裡
       只是保險——萬一使用者在版頭商品照片都還沒上傳前就先點進來，一樣
       給一份空白骨架，不會噴錯。 */
    S.skbnProductSlots[product] = {
      dataUrl: (S.shadowSlots && S.shadowSlots[product] && S.shadowSlots[product].dataUrl) || null,
      shadowAngle: 'left',
      transform: null,
      priceTag: { on:false, offsetXPct:0.9, offsetYPct:0.88, orientation:'left', originalPrice:'', salePrice:'' }
    };
  }
  var prec = S.skbnProductSlots[product];
  if(!prec.dataUrl){
    prec.dataUrl = (S.shadowSlots && S.shadowSlots[product] && S.shadowSlots[product].dataUrl) || null;
  }

  /* 顯示尺寸：畫面上看到的CSS大小，工作畫布固定1200x1200正方形(見
     SKBN_POPUP_SIZE)，跟哪個實例點進來的無關。 */
  var DISPLAY_MAX = 480;
  var dispW = DISPLAY_MAX, dispH = DISPLAY_MAX;

  _skbnOverlayEl = createOverlay(
    '<div class="popup-panel" style="width:'+(dispW+380)+'px;">'+
      '<div class="popup-head"><span>SKBN商品陰影調整・'+esc(product)+'（APP／PC共用同一個編輯器）</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body" style="display:flex;gap:16px;">'+
        '<div style="width:300px;flex:none;">'+
          '<div class="field"><label>商品圖片</label>'+
            '<div id="skbn-thumb-wrap"></div>'+
            '<button class="tbtn" id="skbn-upload-btn" style="width:100%;justify-content:center;margin-top:6px;">更換圖片</button>'+
            '<button class="tbtn" id="skbn-reset-btn" style="width:100%;justify-content:center;margin-top:6px;">套用版頭「'+esc(product)+'」照片</button>'+
          '</div>'+
          '<div class="field"><label>光源角度</label>'+
            '<div style="display:flex;gap:6px;">'+
              '<button class="tbtn skbn-angle-btn" data-skbn-angle="left">左</button>'+
              '<button class="tbtn skbn-angle-btn" data-skbn-angle="top">中</button>'+
              '<button class="tbtn skbn-angle-btn" data-skbn-angle="right">右</button>'+
            '</div>'+
          '</div>'+
          '<div class="field" style="margin-top:14px;">'+
            '<label>陰影寬度 <span id="skbn-scale-x-val">100%</span></label>'+
            '<input type="range" id="skbn-scale-x" min="30" max="200" value="100" style="width:100%;">'+
            '<label style="margin-top:6px;">陰影長度 <span id="skbn-scale-y-val">100%</span></label>'+
            '<input type="range" id="skbn-scale-y" min="30" max="200" value="100" style="width:100%;">'+
          '</div>'+
          '<div class="section-title" style="margin-top:14px;">小標</div>'+
          '<div id="skbn-pricetag-controls"></div>'+
        '</div>'+
        '<div>'+
          '<div class="pos-editor-stage" style="width:'+dispW+'px;height:'+dispH+'px;">'+
            '<canvas id="skbn-compose-canvas" width="'+SKBN_POPUP_SIZE+'" height="'+SKBN_POPUP_SIZE+'" style="width:'+dispW+'px;height:'+dispH+'px;"></canvas>'+
          '</div>'+
          '<div class="hint" style="margin-top:8px;">拖曳移動；拖角落縮放；選取時上方有旋轉把手（按住Shift每15°吸附，雙擊歸零）；Ctrl+Z復原。這個畫布只是給商品/陰影/旋轉用的獨立工作區，跟APP、PC最終畫布的比例／位置沒有直接關係，不用對照著調；確認套用後，位置會自動貼進各自的商品範圍。</div>'+
        '</div>'+
      '</div>'+
      '<div class="popup-foot">'+
        '<button class="tbtn primary" id="skbn-export-btn">確認並套用（APP、PC同時更新）</button>'+
      '</div>'+
    '</div>'
  );

  _skbnCanvas = _skbnOverlayEl.querySelector('#skbn-compose-canvas');
  _skbnCtx = _skbnCanvas.getContext('2d');
  _skbnReceiver = ShadowLayoutReceiver.create(_skbnCanvas, { stageId: 'skbn_'+product });
  _skbnReceiver.attachPointerEvents(drawSkbnCanvas);

  /* 光源角度——寫進S.skbnProductSlots[product]，APP/PC共用同一份 */
  var savedAngle = prec.shadowAngle || 'left';
  var angleBtns = _skbnOverlayEl.querySelectorAll('.skbn-angle-btn');
  Array.prototype.forEach.call(angleBtns, function(btn){
    if(btn.dataset.skbnAngle === savedAngle) btn.classList.add('active');
    btn.onclick = function(){
      prec.shadowAngle = btn.dataset.skbnAngle;
      _skbnReceiver.handleMessage({ type:'LC_SET_ANGLE', preset: btn.dataset.skbnAngle }, drawSkbnCanvas);
      Array.prototype.forEach.call(angleBtns, function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
    };
  });
  _skbnReceiver.handleMessage({ type:'LC_SET_ANGLE', preset: savedAngle }); // 只同步ShadowPlugin內部狀態，不在這裡redraw，下面upsert完成後會畫

  /* 陰影獨立X/Y縮放滑桿——跟KV一樣，只改「目前這個唯一素材」的
     shadowScaleX/Y，沒有素材時安全跳過(guard跟shadow-popup.js一致)。 */
  var scaleXInput = _skbnOverlayEl.querySelector('#skbn-scale-x');
  var scaleYInput = _skbnOverlayEl.querySelector('#skbn-scale-y');
  scaleXInput.oninput = function(){
    var active = _skbnReceiver.getActiveSlot();
    if(!active) return;
    _skbnOverlayEl.querySelector('#skbn-scale-x-val').textContent = scaleXInput.value+'%';
    _skbnReceiver.setShadowScale(active, 'x', Number(scaleXInput.value)/100, drawSkbnCanvas);
  };
  scaleYInput.oninput = function(){
    var active = _skbnReceiver.getActiveSlot();
    if(!active) return;
    _skbnOverlayEl.querySelector('#skbn-scale-y-val').textContent = scaleYInput.value+'%';
    _skbnReceiver.setShadowScale(active, 'y', Number(scaleYInput.value)/100, drawSkbnCanvas);
  };

  /* 小標控制面板——on/off + 文字內容，寫進S.skbnProductSlots[product].priceTag */
  _skbnRenderPriceTagControls(_skbnOverlayEl.querySelector('#skbn-pricetag-controls'), product, drawSkbnCanvas);

  /* 更換圖片／套用版頭照片 */
  _skbnOverlayEl.querySelector('#skbn-upload-btn').onclick = function(){
    var input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = function(){
      var f = input.files[0];
      if(!f) return;
      var reader = new FileReader();
      reader.onload = function(ev){ _skbnApplyDataUrl(ev.target.result); };
      reader.readAsDataURL(f);
    };
    input.click();
  };
  _skbnOverlayEl.querySelector('#skbn-reset-btn').onclick = function(){
    var src = S.shadowSlots && S.shadowSlots[product] && S.shadowSlots[product].dataUrl;
    if(!src){ alert('版頭尚未上傳「'+product+'」的商品照片，請先在右側「編輯商品」裡上傳。'); return; }
    _skbnApplyDataUrl(src);
  };

  _skbnOverlayEl.querySelector('#skbn-export-btn').onclick = exportSkbnComposite;

  /* 初次載入：如果已經有圖片(預設帶入的版頭照片、或上次調整過留下來的
     dataUrl)，套進receiver；沒有的話先讓使用者看到空畫布+上傳提示。 */
  if(prec.dataUrl){
    _skbnUpsertCentered(_skbnReceiver, _skbnSlotIdFor(product), prec.dataUrl, SKBN_POPUP_SIZE, SKBN_POPUP_SIZE, prec.transform, drawSkbnCanvas);
    _skbnReceiver.setActiveSlot(_skbnSlotIdFor(product), drawSkbnCanvas);
  }
  _skbnRefreshThumb();
  drawSkbnCanvas();
}
