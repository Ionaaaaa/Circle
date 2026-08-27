'use strict';

/* ── 這個專案有哪些版位 ──
   新增版位 = 在這裡加一筆 + 去 configs/layouts/ 加一份對應的json，
   editor.html 跟 core.js 都不用改。
   編號對照你提供的參考檔：11=LPBN_APP、12=LPBN_PC、05=DD Card、03=C2C BN(HBN)、
   04=IG、10=Game BN。 */
var LAYOUT_REGISTRY = [
  { id:'11_lpbn_app', name:'LPBN_APP',            configFile:'configs/layouts/11_lpbn_app.json' },
  { id:'12_lpbn_pc',  name:'LPBN_PC',              configFile:'configs/layouts/12_lpbn_pc.json' },
  { id:'03_c2c_bn',   name:'HBN (C2C分類頁)',      configFile:'configs/layouts/03_c2c_bn.json' },
  { id:'04_ig',       name:'IG',                   configFile:'configs/layouts/04_ig.json' },
  { id:'05_ddcard',   name:'DD Card',              configFile:'configs/layouts/05_ddcard.json' },
  { id:'07_msbn',     name:'MSBN',                 configFile:'configs/layouts/07_msbn.json' },
  { id:'08_coin_bn',  name:'Coin Page BN',         configFile:'configs/layouts/08_coin_bn.json' },
  { id:'10_game_bn',  name:'Game BN',              configFile:'configs/layouts/10_game_bn.json' },
  { id:'ar',          name:'AR',                   configFile:'configs/layouts/ar.json' }
];

/* ── 全域狀態：目前作用中分頁的資料 ── */
var S = {
  combo: 'C',
  bg: { seedHex: '#EE4D2D' },
  text: { '標題':'', '副標':'', '日期':'', 'AR文案':'' },
  assets: { logo1:null, logo2:null, host:null, ctaDD:null, ctaGo:null, ctaGame:null },
  /* AR版位（100x100小方塊）三選一版本：'activity'=活動方形LOGO、
     'seller'=賣家LOGO、'text'=文案（S.text['AR文案']）。見modules/ar-module.js。 */
  arVariant: 'activity',
  /* LOGO2編輯面板（js/logo2-editor.js）的內部狀態，跟pet-frenzy的
     editor-logo2-canvas.js同一套概念：logo2Raw存「使用者上傳的原圖」
     （不是合成後的死圖，合成後的圖沒辦法反推回原本怎麼縮放/擺放），
     重開面板時用raw+scale/offset還原上次調整的結果，不用每次重新上傳。
     assets.logo2存的才是「合成好、直接可以畫上版位」的最終PNG。 */
  logo2Raw: null,          // 原圖dataURL字串（未合成）
  logo2Scale: 1,
  logo2OffX: 0,
  logo2OffY: 0,
  logo2Shape: null,        // 'square' | 'wide'，面板自動判斷存這裡
  logo2BgColor: '#ffffff',
  logo2FillMode: false,    // true=「滿版填滿」模式：不加底色/色塊，素材直接cover-fit塞滿整個logo範圍
  /* AR「店家LOGO」預覽專用的額外縮放/位移——logo2的縮放位移是給logo2本身
     (方形/橫式卡片)用的，跟AR的78x77小方框比例常常對不上（例如logo2是
     橫式，AR框比較接近正方形），需要一組獨立的微調，不會互相影響。
     見js/logo2-editor.js的updateArPreview()。 */
  arExtraScale: 1,
  arExtraOffX: 0,
  arExtraOffY: 0,
  /* 商品/主持人陰影合成popup的內部狀態（跟assets分開放，這些是「合成前」的原始素材，
     host只是合成完的最終結果） */
  shadowCombo: 'A',
  shadowAngle: 'top',       // 光源角度('left'/'top'/'right')，2026-08修正：原本沒存進S/tab資料，
                            // 重新編輯時ShadowPlugin內部狀態是全域變數、沒有跟著存檔還原，選過的
                            // 角度重開popup會跳回預設的'top'（雖然已經套用/攤平的圖片本身不受影響，
                            // 但如果重開popup後又調整了別的東西再重新套用，會不小心把角度也改回預設）
  shadowSlots: {},          // slotId('人物1'等) -> { dataUrl, type }
  shadowPolaroid: {},       // slotId -> true/false，是否已套拍立得框
  shadowSlotOriginal: {},   // slotId -> 套框前的原圖dataUrl（取消勾選拍立得時還原用）
  shadowOrder: null,        // 目前組合的疊放順序(陣列，後面=前景)，使用者拖曳排序過的結果
  stageTransform: null,     // 舞台(logos/stage-cylinder.png)使用者調過的{cx,cy,scaleMul}，null=還沒調過、用預設值
  stageEnabled: true,       // 舞台開關，false=完全不顯示/不合成舞台圖（有些商品不需要舞台情境）
  activeLayoutIds: LAYOUT_REGISTRY.map(function(l){ return l.id; }), // 這個分頁要顯示哪些版位
  /* 這個分頁的版位「顯示順序」——照Excel「製作素材」欄位列出的順序決定
     （見editor-import.js的mapMaterialsToLayoutOrder()），不是固定用
     LAYOUT_REGISTRY自己內部的順序。null代表還沒有工單資料可以排序
     （例如全新空白分頁），這時activeLayouts()會退回用LAYOUT_REGISTRY
     原本的順序，不會壞掉。 */
  materialOrder: null,
  /* 使用者在「位置調整popup」或「匯入確認popup」裡拖曳/縮放過的結果，key是layoutId。
     結構：{ [layoutId]: { assets:{ logo1:{xPct,yPct,hPct}, logo2:{...} }, slots:{ [combo]: { [slotId]:{xPct,yPct,hPct} } } } }
     沒有調整過的版位/素材不會出現在這裡，Core會自動fallback用Config的預設位置。 */
  positionOverrides: {}
};

/* ── 分頁（TABS）：像 Photoshop 分頁，一個分頁＝一次匯入的工單 ──
   TABS[i].data 存的是「可序列化」版本（圖片存dataURL字串，不是Image物件），
   這樣暫存/載入才能直接存成一份JSON檔。 */
var TABS = [];
var ACTIVE_TAB = 0;

function newEmptyTabData(label){
  return {
    label: label || '未命名工單',
    text: { '標題':'', '副標':'', '日期':'', 'AR文案':'' },
    combo: 'C',
    bg: { seedHex: '#EE4D2D' },
    assets: {}, // key -> dataURL字串
    arVariant: 'activity',
    logo2Raw: null,
    logo2Scale: 1,
    logo2OffX: 0,
    logo2OffY: 0,
    logo2Shape: null,
    logo2BgColor: '#ffffff',
    logo2FillMode: false,
    arExtraScale: 1,
    arExtraOffX: 0,
    arExtraOffY: 0,
    shadowCombo: 'A',
    shadowAngle: 'top',
    shadowSlots: {},
    shadowPolaroid: {},
    shadowSlotOriginal: {},
    shadowOrder: null,
    stageTransform: null,
    stageEnabled: true,
    activeLayoutIds: LAYOUT_REGISTRY.map(function(l){ return l.id; }),
    materialOrder: null,
    positionOverrides: {}
  };
}

/* 把目前畫面上的 S（Image物件）轉成可存檔的資料，寫回 TABS[ACTIVE_TAB].data */
function saveCurrentTabIntoData(){
  var tab = TABS[ACTIVE_TAB];
  if(!tab) return;
  tab.data.text = JSON.parse(JSON.stringify(S.text));
  tab.data.combo = S.combo;
  tab.data.bg = JSON.parse(JSON.stringify(S.bg));
  tab.data.arVariant = S.arVariant || 'activity';
  tab.data.activeLayoutIds = S.activeLayoutIds.slice();
  tab.data.materialOrder = S.materialOrder ? S.materialOrder.slice() : null;
  tab.data.positionOverrides = JSON.parse(JSON.stringify(S.positionOverrides || {}));
  tab.data.shadowCombo = S.shadowCombo || 'A';
  tab.data.shadowAngle = S.shadowAngle || 'top';
  tab.data.shadowSlots = JSON.parse(JSON.stringify(S.shadowSlots || {}));
  tab.data.shadowPolaroid = JSON.parse(JSON.stringify(S.shadowPolaroid || {}));
  tab.data.shadowSlotOriginal = JSON.parse(JSON.stringify(S.shadowSlotOriginal || {}));
  tab.data.shadowOrder = S.shadowOrder ? S.shadowOrder.slice() : null;
  tab.data.stageTransform = S.stageTransform ? JSON.parse(JSON.stringify(S.stageTransform)) : null;
  tab.data.stageEnabled = (typeof S.stageEnabled === 'boolean') ? S.stageEnabled : true;
  tab.data.logo2Raw = S.logo2Raw || null;
  tab.data.logo2Scale = (typeof S.logo2Scale === 'number') ? S.logo2Scale : 1;
  tab.data.logo2OffX = S.logo2OffX || 0;
  tab.data.logo2OffY = S.logo2OffY || 0;
  tab.data.logo2Shape = S.logo2Shape || null;
  tab.data.logo2BgColor = S.logo2BgColor || '#ffffff';
  tab.data.logo2FillMode = !!S.logo2FillMode;
  tab.data.arExtraScale = (typeof S.arExtraScale === 'number') ? S.arExtraScale : 1;
  tab.data.arExtraOffX = S.arExtraOffX || 0;
  tab.data.arExtraOffY = S.arExtraOffY || 0;
  var assetsOut = {};
  Object.keys(S.assets).forEach(function(k){
    var img = S.assets[k];
    assetsOut[k] = (img instanceof HTMLImageElement) ? img.src : null;
  });
  tab.data.assets = assetsOut;
}

/* 把 TABS[i].data（可序列化版本）套回全域 S（把dataURL還原成Image物件），完成後呼叫cb() */
function applyTabData(i, cb){
  var tab = TABS[i];
  if(!tab){ if(cb) cb(); return; }
  var d = tab.data;
  S.text = JSON.parse(JSON.stringify(d.text));
  S.combo = d.combo;
  S.bg = JSON.parse(JSON.stringify(d.bg));
  S.arVariant = d.arVariant || 'activity';
  S.activeLayoutIds = (d.activeLayoutIds || LAYOUT_REGISTRY.map(function(l){return l.id;})).slice();
  S.materialOrder = d.materialOrder ? d.materialOrder.slice() : null;
  S.positionOverrides = JSON.parse(JSON.stringify(d.positionOverrides || {}));
  S.shadowCombo = d.shadowCombo || 'A';
  S.shadowAngle = d.shadowAngle || 'top';
  S.shadowSlots = JSON.parse(JSON.stringify(d.shadowSlots || {}));
  S.shadowPolaroid = JSON.parse(JSON.stringify(d.shadowPolaroid || {}));
  S.shadowSlotOriginal = JSON.parse(JSON.stringify(d.shadowSlotOriginal || {}));
  S.shadowOrder = d.shadowOrder ? d.shadowOrder.slice() : null;
  S.stageTransform = d.stageTransform ? JSON.parse(JSON.stringify(d.stageTransform)) : null;
  S.stageEnabled = (typeof d.stageEnabled === 'boolean') ? d.stageEnabled : true;
  S.logo2Raw = d.logo2Raw || null;
  S.logo2Scale = (typeof d.logo2Scale === 'number') ? d.logo2Scale : 1;
  S.logo2OffX = d.logo2OffX || 0;
  S.logo2OffY = d.logo2OffY || 0;
  S.logo2Shape = d.logo2Shape || null;
  S.logo2BgColor = d.logo2BgColor || '#ffffff';
  S.logo2FillMode = !!d.logo2FillMode;
  S.arExtraScale = (typeof d.arExtraScale === 'number') ? d.arExtraScale : 1;
  S.arExtraOffX = d.arExtraOffX || 0;
  S.arExtraOffY = d.arExtraOffY || 0;

  var keys = Object.keys(d.assets || {});
  var pending = keys.length;
  S.assets = { logo1:null, logo2:null, host:null, ctaDD:null, ctaGo:null };
  if(!pending){ if(cb) cb(); return; }

  keys.forEach(function(k){
    var src = d.assets[k];
    if(!src){ pending--; if(pending<=0 && cb) cb(); return; }
    var img = new Image();
    img.onload = function(){ S.assets[k]=img; pending--; if(pending<=0 && cb) cb(); };
    img.onerror = function(){ pending--; if(pending<=0 && cb) cb(); };
    img.src = src;
  });
}

/* 把使用者上傳的檔案讀成 HTMLImageElement，存進 S.assets，完成後呼叫 cb() 觸發重繪
   （FileReader是非同步的，用onload回呼，不用固定延遲） */
function loadAssetFile(key, file, cb){
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(ev){
    var img = new Image();
    img.onload = function(){ S.assets[key] = img; if(cb) cb(); };
    img.onerror = function(){ console.error('圖片載入失敗: '+key); };
    img.src = ev.target.result;
  };
  reader.onerror = function(){ console.error('檔案讀取失敗: '+key); };
  reader.readAsDataURL(file);
}
