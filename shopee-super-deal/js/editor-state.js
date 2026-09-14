'use strict';

/* ── 這個專案有哪些版位 ──
   新增版位 = 在這裡加一筆 + 去 configs/layouts/ 加一份對應的json，
   editor.html 跟 core.js 都不用改。
   編號對照你提供的參考檔：11=LPBN_APP、12=LPBN_PC、05=DD Card、03=C2C BN(HBN)、
   04=IG、10=Game BN。 */
/* ── 這個專案有哪些版位 ──
   蝦皮超划算(站內)的完整版位清單，沿用上一個蝦皮媽咪會員日案子已經做好、
   量過真實像素的版面結構(背景圖之後會換成蝦皮超划算的美術，架構不變)。
   2026-09修正：'01_C2C HBN'(=03_c2c_bn)不拆成兩個版位id——商品/券樣是
   「放進同一個版位框架的內容不一樣」，不是兩個獨立版位，用S.exposureStyle
   這個分頁層級的開關切換就好(見configs/layouts/03_c2c_bn.json的
   positionsFileByStyle、core.js的render())，不用複製整個版位。之前
   分成kv_coupon/kv_product是想錯了，已經retire。
   新增版位 = 在這裡加一筆 + 去 configs/layouts/ 加一份對應的json，
   editor.html 跟 core.js 都不用改。 */
var LAYOUT_REGISTRY = [
  { id:'03_c2c_bn',   name:'HBN (C2C分類頁)',      configFile:'configs/layouts/03_c2c_bn.json' },
  /* 2026-09：Skinny BN APP/PC各自拆成3個「實例」，對應版頭(KV)的商品1(左)/
     2(中)/3(右)——每一品各自輸出一張獨立的合成圖(單品+陰影+小標)，不是
     3品同框。3個實例共用同一份configFile(畫布尺寸/文字/CTA位置完全一樣，
     只有商品內容不同)，跟HBN週三版那種'__2'動態複製實例是同一套id命名
     慣例(見下面ensureDynamicLayoutRegistered()的說明)，只是這裡固定
     一開始就登記好，不用等匯入工單才動態產生。
     真正「這個實例要顯示哪個商品的合成結果」由window.SKBN_INSTANCE_META
     這份對照表決定(見下面)，配合js/shadow-system/skbn-shadow-popup.js
     的單品陰影/小標調整popup、跟S.instanceAssets這個新的「依實例分開存
     素材」欄位(見下面applyTabData()/saveCurrentTabIntoData()的說明)。 */
  { id:'skinny_app',    name:'Skinny BN APP - 商品1(左)', configFile:'configs/layouts/skinny_app.json' },
  { id:'skinny_app__2', name:'Skinny BN APP - 商品2(中)', configFile:'configs/layouts/skinny_app.json' },
  { id:'skinny_app__3', name:'Skinny BN APP - 商品3(右)', configFile:'configs/layouts/skinny_app.json' },
  { id:'skinny_pc',     name:'Skinny BN PC - 商品1(左)',  configFile:'configs/layouts/skinny_pc.json' },
  { id:'skinny_pc__2',  name:'Skinny BN PC - 商品2(中)',  configFile:'configs/layouts/skinny_pc.json' },
  { id:'skinny_pc__3',  name:'Skinny BN PC - 商品3(右)',  configFile:'configs/layouts/skinny_pc.json' },
  { id:'11_lpbn_app', name:'LPBN_APP',            configFile:'configs/layouts/11_lpbn_app.json' },
  { id:'12_lpbn_pc',  name:'LPBN_PC',              configFile:'configs/layouts/12_lpbn_pc.json' },
  { id:'04_ig',       name:'IG',                   configFile:'configs/layouts/04_ig.json' },
  { id:'05_ddcard',   name:'DD Card',              configFile:'configs/layouts/05_ddcard.json' },
  { id:'05_ddcard_nologo', name:'DD Card (無LOGO)', configFile:'configs/layouts/05_ddcard_nologo.json' },
  { id:'07_msbn',     name:'MSBN',                 configFile:'configs/layouts/07_msbn.json' },
  { id:'08_coin_bn',  name:'Coin Page BN',         configFile:'configs/layouts/08_coin_bn.json' },
  { id:'10_game_bn',  name:'Game BN',              configFile:'configs/layouts/10_game_bn.json' },
  { id:'08_popup',    name:'Popup',                configFile:'configs/layouts/08_popup.json' },
  { id:'08_popup_no_logo', name:'Popup(無LOGO)',   configFile:'configs/layouts/08_popup_no_logo.json' },
  { id:'ar',          name:'AR',                   configFile:'configs/layouts/ar.json' },
  /* 2026-09新增：192x192透明背景小圖示，固定套用同一份icon(不用使用者
     上傳)，_new版多兩個選填的固定素材(整張背景圖/NEW徽章)。下載時會
     自動額外輸出64x64縮小版(對應工單上的「10_Loyalty Page icon」)，
     編輯器裡只需要調這個192大版，見js/editor-export.js的
     ME_PAGE_DUAL_EXPORT、js/editor-state.js下面icon相關的auto-load
     說明。 */
  { id:'09_me_page_circle',     name:'Me Page Circle',     configFile:'configs/layouts/09_me_page_circle.json' },
  { id:'09_me_page_circle_new', name:'Me Page Circle_new', configFile:'configs/layouts/09_me_page_circle_new.json' }
];

/* ══════════════════ 外廣(waiguang/站外)基礎尺寸版位 ══════════════════
   2026-09新增：外廣工單(公版-站外)跟站內完全不同的地方是——版位不是
   「固定幾種banner類型」，而是「一堆不同px尺寸」，同一個尺寸(例如
   600x1200)會被好幾個大項(01_LINE LAP_無低消/01_LINE LAP/03_Appier急救/
   03_Appier維穩)各自拿去用、各自需要獨立的文案/背景/host。
   ★這裡刻意不直接把這19個尺寸push進LAYOUT_REGISTRY——LAYOUT_REGISTRY
   在好幾個地方被當作「站內全部版位」的預設值使用(例如
   filterLayoutsByMaterials()比對不到任何材料時會整包回傳、
   newEmptyTabData()的activeLayoutIds預設也是整包)，如果把外廣的19個
   尺寸也混進同一個陣列，會讓站內的空白分頁/比對不到材料的舊格式工單
   平白多冒出19個不相干的空尺寸畫布出來，變成新的bug。
   改成獨立存在WAIGUANG_BASE_LAYOUTS這個「尺寸id→configFile」對照表，
   完全不影響LAYOUT_REGISTRY本身；真正要在畫面上顯示的「{大項}__{尺寸}」
   實例，由ensureWaiguangInstanceRegistered()動態push進LAYOUT_REGISTRY
   (這時候才會真的進到LAYOUT_REGISTRY裡，但id永遠帶著大項前綴，不會是
   單獨的尺寸字串，不會跟上面的疑慮衝突)。見js/editor-import-external.js
   的匯入流程說明。 */
var WAIGUANG_SIZES = [
  '600x1200','640x960','600x500','672x560','1200x627','960x640',
  '2048x1536','640x100','640x200','1536x2048','160x600','300x600',
  '320x480','320x50','336x280','480x320','970x250','1200x628','1080x1080',
  '1200x628_no_kv','600x400','01_LINE_LAP_1080x1080','01_LINE_LAP_1200x628',
  '03_Appier_600x1200','03_Appier_640x960','03_Appier_600x500','03_Appier_672x560',
  '03_Appier_1200x627','03_Appier_960x640','03_Appier_2048x1536',
  '03_Appier_640x100','03_Appier_640x200','03_Appier_1536x2048',
  '03_Appier_300x600','03_Appier_320x480','03_Appier_160x600',
  '03_Appier_320x50','03_Appier_970x250','03_Appier_480x320','03_Appier_336x280',
  '02_Facebook_DPA_1080x1080','04_Facebook_1080x1080'
];
var WAIGUANG_BASE_LAYOUTS = {};
WAIGUANG_SIZES.forEach(function(size){
  WAIGUANG_BASE_LAYOUTS[size] = 'configs/layouts/waiguang/'+size+'.json';
});
/* 尺寸id本身要當instanceId的一部分/檔名，不能帶中文或特殊符號，所以像
   「1200x628(無KV)」這種需要顯示給使用者看的名稱，另外開一個顯示名稱
   對照表——查不到的尺寸就直接顯示尺寸id本身(例如"1080x1080")，不用
   每個尺寸都硬性要求填一個顯示名稱。 */
var WAIGUANG_SIZE_DISPLAY_NAMES = {
  '1200x628_no_kv': '1200x628(無KV)'
};

/* 跟ensureDynamicLayoutRegistered()同一個精神，但基礎資料來源是
   WAIGUANG_BASE_LAYOUTS(尺寸→configFile)，不是LAYOUT_REGISTRY裡的現有
   項目——外廣的「基礎版位」本來就不在LAYOUT_REGISTRY裡(見上面的說明)，
   沒有東西可以retry查，只能自己另外查WAIGUANG_BASE_LAYOUTS。
   instanceId命名慣例：'{大項key}__{尺寸}'(一般大項)或
   '{大項key}__{尺寸}__{編號}'(04_Facebook這種multiInstance大項)。 */
function ensureWaiguangInstanceRegistered(instanceId, size, label){
  if(LAYOUT_REGISTRY.some(function(l){ return l.id === instanceId; })) return; // 已經註冊過了
  var configFile = WAIGUANG_BASE_LAYOUTS[size];
  if(!configFile) return; // 不是認得的尺寸，安全起見不註冊，呼叫端會發現這個id根本沒進LAYOUT_REGISTRY
  LAYOUT_REGISTRY.push({ id: instanceId, name: label || size, configFile: configFile });
}

/* 同一個「純尺寸」(例如'1080x1080')在不同大項底下，實際的版面設計常常
   完全不一樣(01_LINE_LAP的1080x1080跟02_Facebook_DPA的1080x1080根本是
   兩套排版)——如果全部共用同一份WAIGUANG_BASE_LAYOUTS[size]，改任何一個
   大項的內容都會連帶弄壞其他大項。這裡提供一個「大項專屬尺寸」的解析
   規則：先查有沒有'{大項key}_{尺寸}'這個更精確的key，有就優先用，查不到
   才退回原本共用的純尺寸key(這樣還沒特別客製過的大項完全不受影響，行為
   跟以前一樣)。
   WAIGUANG_SECTION_LAYOUT_ALIAS：跟modules/background-module.js的
   WAIGUANG_BG_SECTION_ALIAS是同一個精神(但這裡管的是排版設計，不是
   背景美術)——01_LINE_LAP_無低消跟01_LINE_LAP是「同一套排版設計，只是
   文案/顏色不同」，兩者应該共用同一份大項專屬尺寸設定，不用各自存一份
   一模一樣的檔案。 */
var WAIGUANG_SECTION_LAYOUT_ALIAS = {
  '01_LINE_LAP_無低消': '01_LINE_LAP',
  '03_Appier_維穩': '03_Appier'
};
function resolveWaiguangSizeKey(sectionKey, size){
  var aliasedSection = WAIGUANG_SECTION_LAYOUT_ALIAS[sectionKey] || sectionKey;
  var specificKey = aliasedSection + '_' + size;
  if(WAIGUANG_BASE_LAYOUTS[specificKey]) return specificKey;
  return size;
}

/* window.LAYOUT_ASSET_FALLBACK：給modules/background-module.js、
   modules/mask-module.js、js/editor-export.js這幾個「查不到專屬背景圖/
   規則就retry回哪個id」的地方用。05_ddcard_nologo共用05_ddcard的背景圖
   （兩者只差有沒有LOGO，畫面構圖一樣），沿用上一個蝦皮媽咪會員日案子
   就有的設定。 */
window.LAYOUT_ASSET_FALLBACK = window.LAYOUT_ASSET_FALLBACK || {};
window.LAYOUT_ASSET_FALLBACK['05_ddcard_nologo'] = '05_ddcard';

/* skinny_app__2/__3、skinny_pc__2/__3這幾個實例沒有自己專屬的背景圖/
   匯出規則——直接複用modules/background-module.js、js/editor-export.js
   已經有的「查LAYOUT_ALIAS_BASE retry回真正的原版位id」機制(本來是給
   HBN週三版那種動態複製實例用的)，兩個實例本來就該顯示同一張背景圖、
   套用同一套K數上限/JPEG規則(同一種版位規格，只是商品內容不同)。 */
window.LAYOUT_ALIAS_BASE = window.LAYOUT_ALIAS_BASE || {};
window.LAYOUT_ALIAS_BASE['skinny_app__2'] = 'skinny_app';
window.LAYOUT_ALIAS_BASE['skinny_app__3'] = 'skinny_app';
window.LAYOUT_ALIAS_BASE['skinny_pc__2'] = 'skinny_pc';
window.LAYOUT_ALIAS_BASE['skinny_pc__3'] = 'skinny_pc';

/* SKBN單品陰影/小標合成popup(js/shadow-system/skbn-shadow-popup.js)用的
   對照表，每個SKBN實例id對應：
     hostSlot   合成完成後要寫進S.instanceAssets[instanceId]的哪個key，
                對應configs/layouts/skinny_app.json或skinny_pc.json裡
                logo層layer.slot的名稱('hostSkinnyApp'/'hostSkinnyPc')。
     product    這個實例對應版頭(KV，S.shadowSlots)哪一個商品槽位——popup
                第一次開啟時會拿這個商品已經上傳好的照片當初始素材，
                使用者也可以在popup裡自己換掉，不影響版頭那份原始資料。
     bgLayoutId 背景圖預覽要用哪個「真正的」layoutId查
                (backgrounds/{版本}/{id}.jpg)，跟上面LAYOUT_ALIAS_BASE
                對照關係一致，這裡另外存一份是因為popup是獨立檔案，
                直接查表比較直覺，不用回頭再解一次LAYOUT_ALIAS_BASE。
     canvas     這個popup要用的工作畫布尺寸，直接抄對應layout config的
                canvas.w/h——刻意不借用KV那組1200x1200正方形，因為Skinny
                BN PC是很扁的橫幅(400x110)，硬套正方形畫布會讓使用者在
                popup裡對出來的位置跟最終輸出的比例對不起來。 */
window.SKBN_INSTANCE_META = {
  /* tagHRatio：小標(價格牌)基準高度，相對「這個實例自己的畫布高度」的比例。
     2026-09微調：使用者實際看過輸出結果後回報——APP偏小(0.125，約45px)
     需要調大一點，改成0.145(約52px)；PC偏大(0.36，約40px)需要調小一點，
     改成0.30(約33px)。這兩個數字是照實測結果微調，不是重新計算出來的，
     如果之後還要再調，直接改這裡兩個數字就好，不用動計算邏輯。使用者
     還是可以在畫布上直接拖曳小標角落再自己微調，這裡只是給一個「一開始
     就大概看得清楚」的預設值。 */
  'skinny_app':    { hostSlot:'hostSkinnyApp', product:'商品1(左)', bgLayoutId:'skinny_app', canvas:{w:358,h:360}, tagHRatio:0.145 },
  'skinny_app__2': { hostSlot:'hostSkinnyApp', product:'商品2(中)', bgLayoutId:'skinny_app', canvas:{w:358,h:360}, tagHRatio:0.145 },
  'skinny_app__3': { hostSlot:'hostSkinnyApp', product:'商品3(右)', bgLayoutId:'skinny_app', canvas:{w:358,h:360}, tagHRatio:0.145 },
  'skinny_pc':     { hostSlot:'hostSkinnyPc',  product:'商品1(左)', bgLayoutId:'skinny_pc',  canvas:{w:400,h:110}, tagHRatio:0.30 },
  'skinny_pc__2':  { hostSlot:'hostSkinnyPc',  product:'商品2(中)', bgLayoutId:'skinny_pc',  canvas:{w:400,h:110}, tagHRatio:0.30 },
  'skinny_pc__3':  { hostSlot:'hostSkinnyPc',  product:'商品3(右)', bgLayoutId:'skinny_pc',  canvas:{w:400,h:110}, tagHRatio:0.30 }
};

/* 依「商品」找出所有共用這個商品的SKBN實例id（例如'商品1(左)' →
   ['skinny_app','skinny_pc']）——使用者在任一個實例的popup裡調整陰影
   角度/小標，改完要順便讓「同一個商品的另一個實例」也套用同一份設定、
   重新產生合成圖，不用使用者兩邊各調一次。見
   js/shadow-system/skbn-shadow-popup.js的exportSkbnComposite()。 */
function skbnSiblingInstances(product, excludeInstanceId){
  return Object.keys(window.SKBN_INSTANCE_META).filter(function(id){
    return window.SKBN_INSTANCE_META[id].product === product && id !== excludeInstanceId;
  });
}
window.skbnSiblingInstances = skbnSiblingInstances;

/* 動態新增的「重複實例」版位登記表——同一個版位(例如HBN)在同一頁需要輸出
   兩張獨立圖時（見js/editor-import.js的buildLayoutInstancesFromMaterials()），
   會在這裡動態push一筆新的LAYOUT_REGISTRY項目，id是'原id__2'這種格式，
   configFile直接沿用原本那份(排版/尺寸完全相同，只有文案/背景不同)。
   window.LAYOUT_ALIAS_BASE記住「這個動態id其實是複製自哪個真正的layoutId」，
   讓backgrounds/mask/輸出格式規則(K數上限/JPEG)這幾個「用layoutId查表」的
   地方，查不到動態id時可以retry查回真正的原id，不用另外改這幾個模組。 */
window.LAYOUT_ALIAS_BASE = window.LAYOUT_ALIAS_BASE || {};

function ensureDynamicLayoutRegistered(instanceId, layoutId, label){
  if(instanceId === layoutId) return; // 不是複製實例，LAYOUT_REGISTRY本來就有，不用註冊
  if(LAYOUT_REGISTRY.some(function(l){ return l.id === instanceId; })) return; // 已經註冊過了
  var base = LAYOUT_REGISTRY.find(function(l){ return l.id === layoutId; });
  if(!base) return;
  LAYOUT_REGISTRY.push({ id: instanceId, name: label || base.name, configFile: base.configFile });
  window.LAYOUT_ALIAS_BASE[instanceId] = layoutId;
}

/* ── 全域狀態：目前作用中分頁的資料 ── */
/* 空白的一組文案欄位（標題/副標/日期/AR文案/SKBN案型/第1張(後)/第2張(前)），
   textGroups的每個key都長這樣。
   「第1張(後)」「第2張(前)」是券樣模式(S.exposureStyle==='coupon')
   1200畫布上的兩段價格文字(見js/shadow-system/coupon-popup.js)——欄位
   名稱直接照工單「優惠券」表格的實際寫法(K欄"第1張(後)"/"第2張(前)"，
   對應L欄的金額值)，「第1張(後)」是位置較上面、疊在後面的那張券，
   「第2張(前)」是位置較下面、疊在前面的那張券。 */
function emptyTextGroup(){
  return { '標題':'', '副標':'', '日期':'', 'AR文案':'', 'SKBN案型':'', '第1張(後)':'', '第2張(前)':'' };
}

var S = {
  /* 公版版本：'A'或'B'。兩版差異只在背景圖/標題副標日期顏色/CTA顏色
     （見configs/theme.json、backgrounds/{A,B}/、logos/{A,B}/），版位排版
     完全一樣，所以只需要這一個欄位就能切換，不用另外開一套layout設定。
     預設值來自匯入工單時editor-import.js解析到的版本標記（找不到就維持
     'A'），使用者之後也可以在topbar的A版/B版按鈕上手動再調整，兩者互不
     衝突——手動調整只是覆蓋掉當下這個分頁的值，不影響其他分頁。 */
  templateVersion: 'A',
  /* 這個分頁的LOGO2有沒有真的在用，見newEmptyTabData()裡的同名欄位說明
     跟js/editor-main.js的updateLogo2FieldVisibility()。 */
  logo2Checked: true,
  /* 商品/券樣模式(蝦皮超划算新增)：'product'或'coupon'，決定某些版位(目前
     只有03_c2c_bn，之後可以逐一擴充其他版位)要用哪一組positions——見
     configs/layouts/03_c2c_bn.json的positionsFileByStyle、core.js的
     render()。跟templateVersion同一種概念：一個分頁層級的開關，不是
     每個版位各自獨立設定，因為同一頁通常是同一批商品用同一種呈現方式。 */
  exposureStyle: 'product',
  combo: 'C',
  bg: { seedHex: '#EE4D2D' },
  /* ── 文案分組（媽咪會員案新增） ──
     一個分頁(頁面)裡可能同時有兩組文案：例如大部分版位用「文案1」，
     但像「HBN(週三特殊案型)」這種版位工單另外指定用「文案2」。
     textGroups：groupKey('文案1'/'文案2'/...) -> {標題,副標,日期,AR文案}
     layoutTextGroup：layoutId(實例id) -> 這個版位吃哪一組(沒指定的話預設'文案1')
     activeTextGroup：右側面板「目前顯示/可編輯」的是哪一組——不影響畫布
       渲染(渲染永遠照layoutTextGroup各自對應的組別)，只影響右側輸入框
       現在填的是哪組資料。切換方式：①點畫布上該版位的canvas-meta列
       ②右側「文案」標題下的切換鈕(只有>1組時才出現)，兩者互通。
     LOGO(logo1/logo2)刻意留在S.assets、不放進textGroups——兩組文案之間
     LOGO本來就要保持同步，共用同一份assets就是「自動同步」，不用額外寫
     同步邏輯。 */
  textGroups: { '文案1': emptyTextGroup() },
  layoutTextGroup: {},
  activeTextGroup: '文案1',
  assets: { logo1:null, logo2:null, host:null, ctaDD:null, ctaGo:null, ctaGame:null, ctaSkbn:null },
  /* 依「實例」(instanceId，例如'skinny_app__2')分開存的合成素材：
     { [instanceId]: { [hostSlot]: Image } }。跟上面的assets不一樣——assets
     是整個分頁共用一份(KV的host本來就只有一份，3品同框只需要一張合成圖)，
     但SKBN是「同一個layoutId重複3次實例、每個實例各自要有自己獨立的商品
     合成圖」，如果沿用assets那種攤平的key，3個skinny_app實例會全部搶著
     讀同一個S.assets.hostSkinnyApp，變成畫面上3張圖長得一模一樣。
     見modules/logo-module.js的draw()：查得到instanceAssets[layoutId][slot]
     就優先用它，查不到才退回原本的assets[slot]，所以KV(host)等其他一律
     用assets的版位完全不受影響。 */
  instanceAssets: {},
  /* 2026-09新增：外廣(waiguang)04_Facebook這種「同一大項底下每個實例
     曝品模式各自獨立(商品/優惠券混合)」的分頁專用——一般分頁的
     S.exposureStyle是整頁共用一個開關(core.js的render()直接讀
     state.exposureStyle)，但04_Facebook裡01/02/03/11是商品模式、
     04~10是優惠券模式，混在同一個分頁裡，不能只靠一個分頁層級的欄位
     決定。renderAll()組renderState時，如果這個instanceId在這裡有登記
     值，就覆蓋掉S.exposureStyle，沒有登記的instanceId(絕大多數一般
     分頁)完全不受影響，行為跟以前一樣。結構：{ instanceId: 'product'|
     'coupon' }。 */
  instanceExposureStyle: {},
  /* 2026-09新增：外廣multiInstance(例如04_Facebook)商品模式的每一組，
     各自要記住自己那份「可編輯」的陰影/商品狀態(不是最終合成圖，是
     shadowSlots/shadowCombo/shadowOrder/priceTags這幾樣可以重新打開
     popup繼續調整的原始資料)，才能讓使用者事後點某一組的「編輯商品」
     mini按鈕，重新打開該組自己的1200 popup調整，而不是每次都打開全域
     共用的S.shadowSlots(那樣點哪一組都只會看到「最後處理的那一組」，
     使用者實際回報過這個症狀)。結構：{ instanceId: {shadowSlots,
     shadowCombo, shadowOrder, priceTags} }，見js/editor-import-external.js
     的handleWaiguangProductUnit()/js/editor-main.js的
     openWaiguangProductEditor()。 */
  instanceShadowState: {},
  /* 2026-09第八版：SKBN單品陰影popup整個改成依「商品」共用，不是依
     「實例」——同一個商品(例如商品1(左))會出現在APP、PC兩個實例上，
     popup裡調的商品照片/陰影角度/位置/縮放/旋轉，兩邊使用者只想調一次、
     APP跟PC都直接套用同一次合成結果，不想6個實例各調一次、也不想因為
     兩邊用不同transform而對不起來(見js/shadow-system/
     skbn-shadow-popup.js檔頭的完整說明)。
     S.skbnProductSlots結構：{ [product]: { dataUrl, shadowAngle,
     transform, priceTag:{on,offsetXPct,offsetYPct,orientation,
     originalPrice,salePrice} } }——dataUrl/shadowAngle/transform是popup
     內部(固定1200x1200正方形工作畫布)的商品照片/陰影角度/位置縮放旋轉，
     APP、PC共用同一份、共用同一個popup；priceTag的offsetXPct/offsetYPct
     是相對商品在「主畫布上」邊框的比例(不是popup內部座標)，這樣同一份
     小標「位置/方向」設定套到APP/PC不同大小的商品邊框上，視覺比例才會
     維持一致。
     S.skbnSlots結構：{ [instanceId]: { tagScaleMul, tagPosOverride } }
     ——只剩「小標大小」「PC小標獨立位置」這兩個依實例分開存的東西，其餘
     (商品照片/陰影/小標內容)全部搬到上面的S.skbnProductSlots共用了。
     tagScaleMul：小標大小，APP、PC需要各自獨立微調，因為PC畫布矮很多，
     同樣倍率視覺上不成比例(見window.SKBN_INSTANCE_META裡每個實例各自的
     tagHRatio基準值)。
     tagPosOverride({offsetXPct,offsetYPct}|undefined)：只有PC實例會用到
     ——PC的小標一開始跟著APP共用的位置(priceTag.offsetXPct/Y)走，只要
     使用者親自在PC畫布上拖過一次小標，就會在這裡記一份自己獨立的位置，
     從此這個PC實例不再跟著APP共用資料連動，也不會回頭去改共用資料(見
     js/editor-main.js的_skbnTagEffectiveOffset()/
     attachSkbnTagDragResize())。APP永遠直接讀寫共用的priceTag.offsetXPct/Y，
     沒有自己的override欄位。
     兩邊哪個實例對應哪個商品，查window.SKBN_INSTANCE_META(見下面)。 */
  skbnProductSlots: {},
  skbnSlots: {},
  /* 2026-09新增，2026-09定案：KV(03_c2c_bn，工單上叫'01_C2C HBN')上固定
     的兩個錢幣裝飾圖案——直接烤進1200畫布(js/shadow-system/shadow-popup.js)
     的商品/陰影合成圖(S.assets.host)裡，商品模式(S.exposureStyle==='product')
     的host是靠calcArtZoneFit這類「等比縮放、保留長寬比」的邏輯貼進
     03_c2c_bn畫布，烤在裡面的錢幣會跟著商品一起等比縮放，不會變形。
     ★ 目前只支援商品模式一組位置——券樣模式(S.exposureStyle==='coupon')
     的host其實是完全另一條路(設計師外部做好的成品直接匯入、滿版鋪畫布，
     不是靠1200畫布合成出來的，見configs/layouts/03_c2c_bn.json的
     positionsFileByStyle說明)，跟商品模式的host不是同一種內容，錢幣要
     怎麼放要等券樣(coupon)功能真正動工時一併設計，這裡先不處理，只
     覆蓋商品模式。
     結構：{ coin1:{x,y,w,h}, coin2:{x,y,w,h} }——用1200畫布本身的像素
     座標(不是百分比)，跟商品/陰影系統內部的x/y/w0/h0是同一種座標習慣，
     x/y是中心點。兩個錢幣固定都會出現(不像SKBN小標有開關)，圖案是兩張
     不同的固定素材(coin1/coin2，不用使用者上傳，見js/editor-main.js的
     loadDefaultCoin1()/loadDefaultCoin2())，使用者可以在1200畫布(「編輯
     商品」popup)裡直接拖曳移動/拖角落縮放。 */
  kvCoinSlots: {},
  /* 2026-09新增：券樣模式(S.exposureStyle==='coupon')自己的一組錢幣位置/
     大小，跟商品模式的S.kvCoinSlots完全分開存——兩種模式的KV構圖不一樣
     (商品模式錢幣要閃開商品合成圖，券樣模式錢幣要閃開券卡本身)，共用
     同一份座標會導致「調好商品模式的位置，切到券樣模式看起來就歪掉」。
     結構跟S.kvCoinSlots一樣：{ coin1:{x,y,h}, coin2:{x,y,h} }，見
     js/shadow-system/coupon-popup.js的COUPON_KV_COIN_DEFAULTS。 */
  kvCoinSlotsCoupon: {},
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
  activeLayoutIds: LAYOUT_REGISTRY.map(function(l){ return l.id; }), // 這個分頁要顯示哪些「版位種類」（不分實例，給顯示版位勾選/AR面板判斷用）
  /* 這個分頁實際要畫幾張畫布、依什麼順序——每一項是一個「實例」
     {instanceId, layoutId, label}：大部分版位instanceId===layoutId(跟以前
     行為一樣)；同一個layoutId需要輸出兩張獨立圖時(例如HBN一般版+週三版)，
     第二張的instanceId會是'layoutId__2'這種格式、label是原本Excel材料
     項目的名稱，見js/editor-import.js的buildLayoutInstancesFromMaterials()。
     null代表還沒有工單資料可以排序（例如全新空白分頁），這時activeLayouts()
     會退回用LAYOUT_REGISTRY原本的順序，不會壞掉。 */
  instances: null,
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
    /* 這個分頁對應Excel哪個「曝光日期」區塊(例如'曝光日期1')——只在匯入時
       設定一次，之後不會被使用者操作改動，純粹給整包下載時決定zip內子
       資料夾名稱用(見js/editor-export.js的downloadAll())。全新空白分頁/
       沒有曝光日期區塊概念的舊格式工單，維持null，下載時退回用分頁標籤。 */
    exposureLabel: null,
    /* 2026-09新增：外廣(waiguang)專用——這個分頁對應的Excel工單「工作
       項目名稱」，整包下載的zip外層檔名優先用這個(不是分頁標籤)，見
       js/editor-export.js的downloadAll()。站內分頁/沒有這個資訊時維持
       null，下載時退回原本用分頁標籤的邏輯，行為不變。 */
    waiguangOrderName: null,
    /* 2026-09新增：這個分頁的LOGO2有沒有真的在用——匯入時如果Excel的
       LOGO那格沒有勾選(見js/editor-popups.js的logo2Checked判斷)，這裡
       存成false，右側面板的「編輯LOGO2」按鈕就會直接隱藏(見
       js/editor-main.js的updateLogo2FieldVisibility())，不會讓使用者
       看到一顆點了也沒有實際作用的按鈕。預設true(沒有明確資訊時，維持
       原本「一律顯示」的行為，不影響舊專案/還沒重新匯入過的分頁)。 */
    logo2Checked: true,
    templateVersion: 'A',
    exposureStyle: 'product',
    textGroups: { '文案1': emptyTextGroup() },
    layoutTextGroup: {},
    activeTextGroup: '文案1',
    combo: 'C',
    bg: { seedHex: '#EE4D2D' },
    assets: {}, // key -> dataURL字串
    instanceAssets: {}, // instanceId -> { slot -> dataURL字串 }，見上面S.instanceAssets的說明
    instanceExposureStyle: {}, // instanceId -> 'product'|'coupon'，見上面S.instanceExposureStyle的說明(外廣04_Facebook用)
    instanceShadowState: {}, // instanceId -> {shadowSlots,shadowCombo,shadowOrder,priceTags}，見上面S.instanceShadowState的說明
    skbnProductSlots: {}, // product -> {dataUrl,shadowAngle,transform,priceTag}，見上面S.skbnProductSlots的說明
    skbnSlots: {}, // instanceId -> {tagScaleMul,tagPosOverride}，見上面S.skbnSlots的說明
    kvCoinSlots: {}, // coin1/coin2 -> {x,y,w,h}(1200畫布像素座標)，見上面S.kvCoinSlots的說明
    kvCoinSlotsCoupon: {}, // 券樣模式自己的錢幣位置/大小，見上面S.kvCoinSlotsCoupon的說明
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
    instances: null,
    materialOrder: null,
    positionOverrides: {}
  };
}

/* 把目前畫面上的 S（Image物件）轉成可存檔的資料，寫回 TABS[ACTIVE_TAB].data */
function saveCurrentTabIntoData(){
  var tab = TABS[ACTIVE_TAB];
  if(!tab) return;
  tab.data.textGroups = JSON.parse(JSON.stringify(S.textGroups));
  tab.data.layoutTextGroup = JSON.parse(JSON.stringify(S.layoutTextGroup || {}));
  tab.data.activeTextGroup = S.activeTextGroup || '文案1';
  tab.data.templateVersion = (S.templateVersion === 'B') ? 'B' : 'A';
  tab.data.logo2Checked = (S.logo2Checked !== false);
  tab.data.exposureStyle = (S.exposureStyle === 'coupon') ? 'coupon' : 'product';
  tab.data.combo = S.combo;
  tab.data.bg = JSON.parse(JSON.stringify(S.bg));
  tab.data.arVariant = S.arVariant || 'activity';
  tab.data.activeLayoutIds = S.activeLayoutIds.slice();
  tab.data.instances = S.instances ? JSON.parse(JSON.stringify(S.instances)) : null;
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
  /* 小標(原價/特價/位置/方向)：跟shadowSlots同一套道理，存起來下次重開popup/
     重新匯入暫存檔才能還原使用者調好的結果，不會被預設值蓋掉。 */
  tab.data.priceTags = window.PriceTagSystem ? PriceTagSystem.serialize() : JSON.parse(JSON.stringify(S.priceTags || {}));
  tab.data.siteMode = S.siteMode || null; // '內'/'外'選擇，見js/editor-popups.js的openSiteModePopup
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

  /* instanceAssets：跟上面assets同一套「Image轉dataURL字串」做法，只是多一層
     instanceId分層。skbnSlots本身存的已經是dataURL字串(不是Image物件，跟
     S.shadowSlots的存法一致)，直接JSON深拷貝即可，不用額外轉換。 */
  var instanceAssetsOut = {};
  Object.keys(S.instanceAssets || {}).forEach(function(instId){
    var slotMap = S.instanceAssets[instId] || {};
    var out = {};
    Object.keys(slotMap).forEach(function(slotKey){
      var img = slotMap[slotKey];
      out[slotKey] = (img instanceof HTMLImageElement) ? img.src : null;
    });
    instanceAssetsOut[instId] = out;
  });
  tab.data.instanceAssets = instanceAssetsOut;
  tab.data.instanceExposureStyle = JSON.parse(JSON.stringify(S.instanceExposureStyle || {}));
  tab.data.instanceShadowState = JSON.parse(JSON.stringify(S.instanceShadowState || {}));
  tab.data.skbnSlots = JSON.parse(JSON.stringify(S.skbnSlots || {}));
  tab.data.skbnProductSlots = JSON.parse(JSON.stringify(S.skbnProductSlots || {}));
  tab.data.kvCoinSlots = JSON.parse(JSON.stringify(S.kvCoinSlots || {}));
  tab.data.kvCoinSlotsCoupon = JSON.parse(JSON.stringify(S.kvCoinSlotsCoupon || {}));
}

/* 把 TABS[i].data（可序列化版本）套回全域 S（把dataURL還原成Image物件），完成後呼叫cb() */
function applyTabData(i, cb){
  var tab = TABS[i];
  if(!tab){ if(cb) cb(); return; }
  var d = tab.data;
  /* 相容舊格式暫存檔(d.text是單一組、沒有textGroups)：整組搬進'文案1'，
     這樣以前存的.json暫存檔案重新載入還是讀得回來，不會整個壞掉。 */
  if(d.textGroups){
    S.textGroups = JSON.parse(JSON.stringify(d.textGroups));
  } else if(d.text){
    S.textGroups = { '文案1': JSON.parse(JSON.stringify(d.text)) };
  } else {
    S.textGroups = { '文案1': emptyTextGroup() };
  }
  S.layoutTextGroup = JSON.parse(JSON.stringify(d.layoutTextGroup || {}));
  S.activeTextGroup = d.activeTextGroup && S.textGroups[d.activeTextGroup] ? d.activeTextGroup : Object.keys(S.textGroups)[0];
  S.templateVersion = (d.templateVersion === 'B') ? 'B' : 'A';
  S.logo2Checked = (d.logo2Checked !== false);
  if(typeof setTemplateVersion === 'function') setTemplateVersion(S.templateVersion);
  S.exposureStyle = (d.exposureStyle === 'coupon') ? 'coupon' : 'product';
  S.combo = d.combo;
  S.bg = JSON.parse(JSON.stringify(d.bg));
  S.arVariant = d.arVariant || 'activity';
  S.activeLayoutIds = (d.activeLayoutIds || LAYOUT_REGISTRY.map(function(l){return l.id;})).slice();
  S.instances = d.instances ? JSON.parse(JSON.stringify(d.instances)) : null;
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
  if(window.PriceTagSystem) PriceTagSystem.restore(d.priceTags || {});
  else S.priceTags = JSON.parse(JSON.stringify(d.priceTags || {}));
  S.siteMode = d.siteMode || null;
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

  S.skbnSlots = JSON.parse(JSON.stringify(d.skbnSlots || {}));
  S.skbnProductSlots = JSON.parse(JSON.stringify(d.skbnProductSlots || {}));
  S.kvCoinSlots = JSON.parse(JSON.stringify(d.kvCoinSlots || {}));
  S.kvCoinSlotsCoupon = JSON.parse(JSON.stringify(d.kvCoinSlotsCoupon || {}));

  var keys = Object.keys(d.assets || {});
  /* instanceAssets攤平成[instanceId, slotKey]清單，跟d.assets的key合併算
     同一個pending計數器——兩邊都是「dataURL字串轉回Image物件」的非同步
     載入，全部載完才能呼叫cb()，不然畫面可能在圖片還沒到之前就先渲染，
     SKBN那幾張合成圖第一次切分頁/讀暫存檔時會閃一下空白。 */
  var instPairs = [];
  Object.keys(d.instanceAssets || {}).forEach(function(instId){
    Object.keys(d.instanceAssets[instId] || {}).forEach(function(slotKey){
      instPairs.push([instId, slotKey]);
    });
  });
  var pending = keys.length + instPairs.length;
  S.assets = { logo1:null, logo2:null, host:null, ctaDD:null, ctaGo:null };
  S.instanceAssets = {};
  S.instanceExposureStyle = JSON.parse(JSON.stringify(d.instanceExposureStyle || {}));
  S.instanceShadowState = JSON.parse(JSON.stringify(d.instanceShadowState || {}));
  if(!pending){ if(cb) cb(); return; }

  keys.forEach(function(k){
    var src = d.assets[k];
    if(!src){ pending--; if(pending<=0 && cb) cb(); return; }
    var img = new Image();
    img.onload = function(){ S.assets[k]=img; pending--; if(pending<=0 && cb) cb(); };
    img.onerror = function(){ pending--; if(pending<=0 && cb) cb(); };
    img.src = src;
  });
  instPairs.forEach(function(pair){
    var instId = pair[0], slotKey = pair[1];
    var src = d.instanceAssets[instId][slotKey];
    if(!src){ pending--; if(pending<=0 && cb) cb(); return; }
    var img = new Image();
    img.onload = function(){
      S.instanceAssets[instId] = S.instanceAssets[instId] || {};
      S.instanceAssets[instId][slotKey] = img;
      pending--; if(pending<=0 && cb) cb();
    };
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
