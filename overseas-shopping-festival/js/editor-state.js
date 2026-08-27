'use strict';

/* ── 這個專案有哪些版位 ──
   新增版位 = 在這裡加一筆 + 去 configs/layouts/ 加一份對應的json，
   editor.html 跟 core.js 都不用改。
   編號對照你提供的參考檔：11=LPBN_APP、12=LPBN_PC、05=DD Card、03=C2C BN(HBN)、
   04=IG、10=Game BN。
   MSBN專用：因為版型會一直增加（公版一、公版二...），json設定檔集中放在
   configs/layouts/msbn/ 這個子資料夾，不跟其他版位混在一起，資料夾裡比較
   不會亂。以後新增「公版二」，就是在configs/layouts/msbn/裡加一份新的json
   （例如07_msbn_v2.json + 07_msbn_v2-positions.json），不用動這裡的
   LAYOUT_REGISTRY——MSBN版本要套用哪個版型，是在「MSBN版本管理」裡選，
   見js/editor-main.js的addMsbnVersion()。 */
var LAYOUT_REGISTRY = [
  { id:'11_lpbn_app', name:'LPBN_APP',            configFile:'configs/layouts/11_lpbn_app.json' },
  { id:'12_lpbn_pc',  name:'LPBN_PC',              configFile:'configs/layouts/12_lpbn_pc.json' },
  { id:'03_c2c_bn',   name:'HBN (C2C分類頁)',      configFile:'configs/layouts/03_c2c_bn.json' },
  { id:'04_ig',       name:'IG',                   configFile:'configs/layouts/04_ig.json' },
  { id:'05_ddcard',   name:'DD Card',              configFile:'configs/layouts/05_ddcard.json' },
  { id:'07_msbn',     name:'MSBN1', exportName:'msbn1', configFile:'configs/layouts/msbn/07_msbn.json' },
  { id:'07_msbn_v2',  name:'MSBN公版二', hiddenFromToggle:true, configFile:'configs/layouts/msbn/07_msbn_v2.json' },
  { id:'07_msbn_v3',  name:'MSBN公版三', hiddenFromToggle:true, configFile:'configs/layouts/msbn/07_msbn_v3.json' },
  { id:'07_msbn_v4',  name:'MSBN公版四', hiddenFromToggle:true, configFile:'configs/layouts/msbn/07_msbn_v4.json' },
  { id:'07_msbn_v5',  name:'MSBN公版五', hiddenFromToggle:true, configFile:'configs/layouts/msbn/07_msbn_v5.json' },
  { id:'07_msbn_v6',  name:'MSBN公版六', hiddenFromToggle:true, configFile:'configs/layouts/msbn/07_msbn_v6.json' },
  { id:'08_coin_bn',  name:'Coin Page BN',         configFile:'configs/layouts/08_coin_bn.json' },
  { id:'08_popup',    name:'Popup',                configFile:'configs/layouts/08_popup.json' },
  { id:'10_game_bn',  name:'Game BN',              configFile:'configs/layouts/10_game_bn.json' },
  { id:'ar',          name:'AR',                   configFile:'configs/layouts/ar.json' }
];

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
  /* 2026-08修正「MSBN版型從Excel匯入後沒換過來，一直卡在建分頁當下的
     預設版型」：原本這裡「已經註冊過就直接return」，想法是「同一個
     instanceId只需要註冊一次」。但MSBN這個版位的實例是先在buildMsbnTabData()
     用預設版型('07_msbn')建好殼、之後Excel匯入才會用真正的「版型」欄位
     去修正inst.layoutId——如果只在「第一次註冊」生效，之後layoutId被
     import流程改掉，這裡完全不會跟著更新，LAYOUT_REGISTRY裡那筆alias的
     configFile還是停在最一開始的版型，畫面上看到的背景/排版/LOGO格數
     永遠是預設版型，不是Excel實際指定的版型——這就是使用者回報的「msbn
     都抓到07_msbn.jpg的背景、logo/文案都沒對上」的根本原因。
     改成：已經註冊過，但這次傳進來的layoutId跟上次註冊的不一樣時，直接
     更新那筆既有的entry(configFile/name/exportName全部重算)，不是略過；
     完全沒變的話才真的跳過，避免每次renderAll()都重複做一樣的事。 */
  var existing = LAYOUT_REGISTRY.find(function(l){ return l.id === instanceId; });
  if(existing && window.LAYOUT_ALIAS_BASE[instanceId] === layoutId) return; // 已經註冊過、而且對應的版型沒變，不用重做

  var base = LAYOUT_REGISTRY.find(function(l){ return l.id === layoutId; });
  if(!base) return;
  var entry = existing || { id: instanceId };
  entry.name = label || base.name;
  entry.configFile = base.configFile;
  delete entry.exportName; // 下面MSBN家族判斷式會重新設，這裡先清掉避免殘留舊版型算出來的舊值

  /* 蝦皮家居-寢具新增需求：MSBN這個版位「版型很多種、版本會一直往下加」
     （後台每加一版就是MSBN2、MSBN3...），跟其他版位「同一個layoutId複製
     出第二張只是少數特例(HBN週三版)」的情況不一樣，MSBN複製是常態、
     而且下載檔名有明確規則（msbn1.jpg、msbn2.jpg...依序遞增，不要任何
     其他文字或編號前綴）——這個編號是跨「所有版型」全域遞增的，不是每
     個版型各自從1開始數（因為msbn1~msbn8是同一條長活動頁裡依序排列的
     8段，每段可能各自套用不同版型設計，但檔名還是要連續編號）。這裡
     直接照instanceId本身的編號規則(見msbnVersionNumberFromId())算出
     name/exportName，不用每個呼叫端各自命名，行為才會一致——不管是Excel
     匯入自動產生的實例、還是使用者在工具裡按「＋新增MSBN版本」手動加的
     實例，都會套用同一套命名。2026-08擴充：原本只判斷layoutId==='07_msbn'
     這一種版型，現在MSBN_BASE_IDS涵蓋公版一~六(以後還會增加)，任何一種
     MSBN家族版型都要套用同一套「MSBN+N」命名規則，不是只有公版一。 */
  if(MSBN_BASE_IDS.indexOf(layoutId) !== -1){
    var n = msbnVersionNumberFromId(instanceId);
    entry.name = label || ('MSBN' + n);
    entry.exportName = 'msbn' + n;
  }

  if(!existing) LAYOUT_REGISTRY.push(entry);
  window.LAYOUT_ALIAS_BASE[instanceId] = layoutId;
}

/* MSBN複製實例的id格式固定是'msbn_p1'(第1版)、'msbn_p2'、'msbn_p3'...
   —— 從id反推「這是第幾版」，給檔名/顯示名稱統一使用，只需要維護這一處。
   2026-08修正：原本這個id是直接借用真正的版型id當前綴('07_msbn'、
   '07_msbn__2'...)，第1版的instanceId甚至直接就是'07_msbn'本人——這樣
   設計在「MSBN1固定用公版一」這個假設成立時沒問題，但實際上MSBN每個
   位置要用哪個版型是Excel「版型」欄位決定的、不是固定的（例如實際工單
   MSBN1用的是公版二，不是公版一）。如果instanceId跟某個「真正存在的
   版型id」剛好撞名(例如instanceId==='07_msbn')，ensureDynamicLayoutRegistered()
   會誤判成「這就是那個版型本尊，不用另外註冊alias」，之後改
   inst.layoutId成別的版型完全不會生效，畫面永遠停在最初的版型——這就是
   使用者回報「msbn背景/logo/文案都對不上」的根本原因。
   改成跟任何一個真正的版型id都不會撞名的中性命名('msbn_p'+序號)，
   徹底避免這種巧合。 */
function msbnVersionNumberFromId(instanceId){
  var m = /^msbn_p(\d+)$/.exec(instanceId) || /__(\d+)$/.exec(instanceId);
  return m ? parseInt(m[1], 10) : 1;
}

/* 是否為MSBN家族的版位id（本尊'07_msbn'、公版二~六、或它們動態複製出來
   的任何實例）——下載檔名規則、新增/刪除版本按鈕、拖曳互動掛載都要用同
   一個判斷式，集中寫在這裡避免各處各寫一次、以後改判斷邏輯漏改。
   2026-08擴充：原本只認literal '07_msbn'一種，現在改成查MSBN_BASE_IDS
   陣列，涵蓋所有MSBN家族版型；以後再加新版型只要更新LAYOUT_REGISTRY，
   這裡不用再改。 */
function isMsbnFamilyId(layoutId){
  if(MSBN_BASE_IDS.indexOf(layoutId) !== -1) return true;
  var aliasBase = window.LAYOUT_ALIAS_BASE || {};
  return MSBN_BASE_IDS.indexOf(aliasBase[layoutId]) !== -1;
}

/* ── 全域狀態：目前作用中分頁的資料 ── */
/* 空白的一組文案欄位（標題/副標/日期/AR文案），textGroups的每個key都長這樣 */
function emptyTextGroup(){
  return { '標題':'', '副標':'', '日期':'', 'AR文案':'' };
}

/* MSBN「家族」所有版型的base id——本尊'07_msbn'(公版一)+陸續增加的公版二~
   公版六(configs/layouts/msbn/07_msbn_v2.json ~ 07_msbn_v6.json)。之後
   還會繼續加(公版七、八...)，直接在這裡加id、同時去上面LAYOUT_REGISTRY
   加一筆對應項目就好，isMsbnFamilyId()/ensureDynamicLayoutRegistered()/
   NON_MSBN_LAYOUT_IDS這些共用判斷式都會自動跟著生效，不用另外改。 */
var MSBN_BASE_IDS = LAYOUT_REGISTRY.filter(function(l){ return l.id.indexOf('07_msbn') === 0; }).map(function(l){ return l.id; });

/* 這個專案要求：MSBN固定只出現在專屬的「msbn」那個分頁，一般分頁(第一
   分頁、Excel匯入出來的分頁)一律不顯示MSBN——一般分頁的activeLayoutIds
   預設清單要排除所有MSBN家族的base id，跟msbn那個分頁分開管理(見下面
   buildMsbnTabData()會自己覆寫成只有'07_msbn')。兩處地方(S的初始值、
   newEmptyTabData())都要用這份清單，不要各自重複寫一次filter。 */
var NON_MSBN_LAYOUT_IDS = LAYOUT_REGISTRY.filter(function(l){ return MSBN_BASE_IDS.indexOf(l.id) === -1; }).map(function(l){ return l.id; });

var S = {
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
  assets: { logo1:null, logo2:null, host:null, popupHost:null, popupLogo2:null, ctaDD:null, ctaGo:null, ctaGame:null, ctaMsbnIcon:null, arActivityLogo:null },
  /* MSBN公版一三格LOGO——跟S.assets不同，這裡是「同一個layoutId(可能有
     MSBN1/MSBN2/MSBN3多個實例)底下再分left/mid/right三個獨立格子」，
     結構是 { [layoutId]: { left:{img,scale,offX,offY,baseScale}, mid:{...},
     right:{...} } }。見modules/msbn-logo-module.js(畫圖)、
     js/msbn-logo-interaction.js(拖曳/縮放/選取互動)。公版二~六的LOGO(還有
     公版五的「圖片範圍」，共用同一套slot機制，圖片範圍就是叫做'image'的
     一個slot)也是存在這裡，跟公版一同一套資料結構、同一套互動邏輯，只是
     slot的key名稱不同(公版一是left/mid/right，其他版型看各自positions.json
     的msbnSlots定義)。 */
  msbnLogos: {},
  /* 2026-08新增：公版二~六的可編輯文字（文案/品牌名稱/折扣文案等）——
     使用者明確要求這些文字「不需要連動」，也就是不透過S.textGroups那套
     跨版位同步機制，而是每個MSBN實例各自獨立、直接在畫布上點擊該文字
     區塊打字編輯（見js/msbn-text-interaction.js）。結構跟msbnLogos同一個
     邏輯：{ [instanceId]: { [textKey]: "使用者輸入的文字字串" } }，純字串
     不用像LOGO那樣處理Image物件，存檔/還原比msbnLogos簡單，直接JSON
     深拷貝即可，不用非同步載入。 */
  msbnTexts: {},
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
  /* 2026-08新增：popup版位獨立的LOGO2狀態，跟上面logo2Xxx系列平行，
     見js/logo2-editor.js的_swapInPopupLogo2State()/_swapOutPopupLogo2State()說明。 */
  popupLogo2Raw: null,
  popupLogo2Scale: 1,
  popupLogo2OffX: 0,
  popupLogo2OffY: 0,
  popupLogo2Shape: null,
  popupLogo2BgColor: '#ffffff',
  popupLogo2FillMode: false,
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
  /* KV小元素開關——固定素材(logos/kv-element.png)，跟商品/人物是分開的
     獨立槽位，可以自己拖曳/縮放/旋轉，不屬於任何combo(A/B/C/D)的定義，
     用這個開關決定要不要出現在1200畫布上。見js/shadow-system/
     shadow-popup.js的toggleKvElement()/getShadowOrder()。 */
  kvElementEnabled: true,  // 使用者要求預設開啟
  /* 2026-08新增：popup版位獨立的一組商品合成狀態，跟上面shadowXxx系列是
     平行的兩份資料——popupHost商品用這幾個欄位，跟main商品(host)用的
     shadowSlots等完全分開存、分開還原，見js/shadow-system/shadow-popup.js
     的_swapInPopupShadowState()/_swapOutPopupShadowState()說明。 */
  popupShadowCombo: 'C',
  popupShadowAngle: 'top',
  popupShadowSlots: {},
  popupShadowPolaroid: {},
  popupShadowSlotOriginal: {},
  popupShadowOrder: null,
  popupStageTransform: null,
  popupStageEnabled: false, // 2026-08訂正：使用者要求popup商品確認預設關閉舞台(main的stageEnabled維持預設true不變，只有popup這組改)
  popupKvElementEnabled: true,
  sharedProductGroupId: null, // 這個分頁的商品是否跟其他分頁共用同一組（見newEmptyTabData()的說明）
  activeLayoutIds: NON_MSBN_LAYOUT_IDS.slice(), // 這個分頁要顯示哪些「版位種類」（不分實例，給顯示版位勾選/AR面板判斷用）——一般分頁不含MSBN
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
    /* 這個分頁的商品是不是跟其他分頁「共用同一份」（例如蝦皮流行穿搭案，
       A版/B版共用同一組商品，只有文案不同）——如果是，這裡會是一個共同的
       ID字串，跟其他共用同一組商品的分頁一致。有這個ID的分頁，重新開
       「編輯商品」(1200畫布)調整完之後，會自動把調整結果同步給其他一樣
       這個ID的分頁，不用每個分頁各自調一次（見js/editor-main.js的
       propagateSharedProductToLinkedTabs()）。null＝這個分頁的商品是獨立
       的，不會被同步、也不會去同步別人。 */
    sharedProductGroupId: null,
    baseName: label || null, // 不含區塊後綴的純工單名稱，見js/editor-main.js的buildTabDataFromParsedBlock()說明
    textGroups: { '文案1': emptyTextGroup() },
    layoutTextGroup: {},
    activeTextGroup: '文案1',
    combo: 'C',
    bg: { seedHex: '#EE4D2D' },
    assets: {}, // key -> dataURL字串
    msbnLogos: {}, // { [layoutId]: { left:{src,scale,offX,offY,baseScale}, mid:{...}, right:{...} } }
    msbnTexts: {}, // { [instanceId]: { [textKey]: "文字內容" } }，見上面S的msbnTexts說明
    arVariant: 'activity',
    logo2Raw: null,
    logo2Scale: 1,
    logo2OffX: 0,
    logo2OffY: 0,
    logo2Shape: null,
    logo2BgColor: '#ffffff',
    logo2FillMode: false,
    popupLogo2Raw: null,
    popupLogo2Scale: 1,
    popupLogo2OffX: 0,
    popupLogo2OffY: 0,
    popupLogo2Shape: null,
    popupLogo2BgColor: '#ffffff',
    popupLogo2FillMode: false,
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
    kvElementEnabled: true,
    popupShadowCombo: 'C',
    popupShadowAngle: 'top',
    popupShadowSlots: {},
    popupShadowPolaroid: {},
    popupShadowSlotOriginal: {},
    popupShadowOrder: null,
    popupStageTransform: null,
    popupStageEnabled: false,
    popupKvElementEnabled: true,
    activeLayoutIds: NON_MSBN_LAYOUT_IDS.slice(), // 一般分頁不含MSBN，見NON_MSBN_LAYOUT_IDS的說明
    instances: null,
    materialOrder: null,
    positionOverrides: {}
  };
}

/* ══════════════════ 開機自動幫MSBN開一個獨立分頁 ══════════════════
   使用者明確要求：MSBN不要跟其他版位擠在同一個分頁，開機就自動開好
   第2個分頁、分頁名稱固定叫「msbn」，這個分頁只顯示MSBN(activeLayoutIds
   只有'07_msbn')，並且照公單預設數量一次生好N份實例(MSBN1、MSBN2...)，
   不用使用者自己一個一個按「＋新增MSBN版本」——目前公單是6份，之後公單
   版本數不同的話，改MSBN_DEFAULT_COUNT這個數字就好，其他都不用動。 */
var MSBN_DEFAULT_COUNT = 6;

function buildMsbnTabData(label, count){
  var data = newEmptyTabData(label);
  data._isMsbnTab = true; // 固定標記，讓匯入流程/其他程式碼可以可靠找到「就是這個msbn分頁」，不用靠label字串比對
  data.activeLayoutIds = ['07_msbn'];
  var instances = [];
  var n = count || MSBN_DEFAULT_COUNT;
  for(var i=1; i<=n; i++){
    /* 2026-08修正：instanceId改用中性的'msbn_p'+序號，不直接借用'07_msbn'
       這個真正版型的id當前綴——這裡先全部預設套用公版一(layoutId:'07_msbn')
       只是「還沒讀到Excel資料前」的暫定值，Excel匯入時會依照「版型」欄位
       修正每一個實例真正該用的layoutId(見js/editor-import.js的
       parseMsbnLayoutSection()、js/editor-main.js的applyMsbnAssetsFromImport())。
       詳見msbnVersionNumberFromId()上面的說明，這個修正是為了讓「事後修正
       layoutId」這件事能夠真的生效。 */
    var instanceId = 'msbn_p' + i;
    /* slotNames：{left,mid,right} 三個位置各自對應的素材名稱，三格各自
       獨立、各自去資料夾找各自的檔案——就算三格名稱剛好一樣，也是各自
       比對三次，不是共用同一次比對結果。目前先是null(還沒匯入過工單
       資料)，匯入時由js/editor-main.js的applyMsbnAssetsFromImport()寫入。
       這個名稱只用來(1)拿去跟素材資料夾比對、自動放圖 (2)沒比對到檔案時，
       在畫布的「點擊上傳」提示文字顯示，不是給使用者手動輸入的欄位。 */
    instances.push({ instanceId: instanceId, layoutId: '07_msbn', label: 'MSBN' + i, textGroup: '文案1', slotNames: null });
  }
  data.instances = instances;
  data.materialOrder = instances.map(function(inst){ return inst.instanceId; });
  return data;
}

/* 把目前畫面上的 S（Image物件）轉成可存檔的資料，寫回 TABS[ACTIVE_TAB].data */
function saveCurrentTabIntoData(){
  var tab = TABS[ACTIVE_TAB];
  if(!tab) return;
  tab.data.textGroups = JSON.parse(JSON.stringify(S.textGroups));
  tab.data.layoutTextGroup = JSON.parse(JSON.stringify(S.layoutTextGroup || {}));
  tab.data.activeTextGroup = S.activeTextGroup || '文案1';
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
  tab.data.kvElementEnabled = !!S.kvElementEnabled;
  tab.data.popupShadowCombo = S.popupShadowCombo || 'C';
  tab.data.popupShadowAngle = S.popupShadowAngle || 'top';
  tab.data.popupShadowSlots = JSON.parse(JSON.stringify(S.popupShadowSlots || {}));
  tab.data.popupShadowPolaroid = JSON.parse(JSON.stringify(S.popupShadowPolaroid || {}));
  tab.data.popupShadowSlotOriginal = JSON.parse(JSON.stringify(S.popupShadowSlotOriginal || {}));
  tab.data.popupShadowOrder = S.popupShadowOrder ? S.popupShadowOrder.slice() : null;
  tab.data.popupStageTransform = S.popupStageTransform ? JSON.parse(JSON.stringify(S.popupStageTransform)) : null;
  tab.data.popupStageEnabled = (typeof S.popupStageEnabled === 'boolean') ? S.popupStageEnabled : false;
  tab.data.popupKvElementEnabled = !!S.popupKvElementEnabled;
  tab.data.sharedProductGroupId = S.sharedProductGroupId || null;
  tab.data.logo2Raw = S.logo2Raw || null;
  tab.data.logo2Scale = (typeof S.logo2Scale === 'number') ? S.logo2Scale : 1;
  tab.data.logo2OffX = S.logo2OffX || 0;
  tab.data.logo2OffY = S.logo2OffY || 0;
  tab.data.logo2Shape = S.logo2Shape || null;
  tab.data.logo2BgColor = S.logo2BgColor || '#ffffff';
  tab.data.logo2FillMode = !!S.logo2FillMode;
  tab.data.popupLogo2Raw = S.popupLogo2Raw || null;
  tab.data.popupLogo2Scale = (typeof S.popupLogo2Scale === 'number') ? S.popupLogo2Scale : 1;
  tab.data.popupLogo2OffX = S.popupLogo2OffX || 0;
  tab.data.popupLogo2OffY = S.popupLogo2OffY || 0;
  tab.data.popupLogo2Shape = S.popupLogo2Shape || null;
  tab.data.popupLogo2BgColor = S.popupLogo2BgColor || '#ffffff';
  tab.data.popupLogo2FillMode = !!S.popupLogo2FillMode;
  tab.data.arExtraScale = (typeof S.arExtraScale === 'number') ? S.arExtraScale : 1;
  tab.data.arExtraOffX = S.arExtraOffX || 0;
  tab.data.arExtraOffY = S.arExtraOffY || 0;
  var assetsOut = {};
  Object.keys(S.assets).forEach(function(k){
    var img = S.assets[k];
    assetsOut[k] = (img instanceof HTMLImageElement) ? img.src : null;
  });
  tab.data.assets = assetsOut;

  /* MSBN三格LOGO：兩層迴圈把Image物件換成dataURL字串，才能存進可序列化的
     tab.data（跟S.assets同一套做法，只是多一層layoutId/slotKey）。 */
  var msbnOut = {};
  Object.keys(S.msbnLogos || {}).forEach(function(layoutId){
    var slots = S.msbnLogos[layoutId] || {};
    var slotsOut = {};
    Object.keys(slots).forEach(function(slotKey){
      var st = slots[slotKey];
      if(!st || !(st.img instanceof HTMLImageElement)) return;
      slotsOut[slotKey] = { src: st.img.src, scale: st.scale||1, offX: st.offX||0, offY: st.offY||0, baseScale: st.baseScale||st.scale||1, bgColor: st.bgColor||'#ffffff' };
    });
    if(Object.keys(slotsOut).length) msbnOut[layoutId] = slotsOut;
  });
  tab.data.msbnLogos = msbnOut;

  /* msbnTexts是純字串，不像msbnLogos要處理Image物件轉dataURL，直接深拷貝
     存起來就好。 */
  tab.data.msbnTexts = JSON.parse(JSON.stringify(S.msbnTexts || {}));
}

/* 把 TABS[i].data（可序列化版本）套回全域 S（把dataURL還原成Image物件），完成後呼叫cb() */
function applyTabData(i, cb){
  var tab = TABS[i];
  if(!tab){ if(cb) cb(); return; }
  var d = tab.data;
  if(typeof resetMsbnSelection === 'function') resetMsbnSelection();
  if(typeof resetMsbnTextEditing === 'function') resetMsbnTextEditing();
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
  S.kvElementEnabled = !!d.kvElementEnabled;
  S.popupShadowCombo = d.popupShadowCombo || 'C';
  S.popupShadowAngle = d.popupShadowAngle || 'top';
  S.popupShadowSlots = JSON.parse(JSON.stringify(d.popupShadowSlots || {}));
  S.popupShadowPolaroid = JSON.parse(JSON.stringify(d.popupShadowPolaroid || {}));
  S.popupShadowSlotOriginal = JSON.parse(JSON.stringify(d.popupShadowSlotOriginal || {}));
  S.popupShadowOrder = d.popupShadowOrder ? d.popupShadowOrder.slice() : null;
  S.popupStageTransform = d.popupStageTransform ? JSON.parse(JSON.stringify(d.popupStageTransform)) : null;
  S.popupStageEnabled = (typeof d.popupStageEnabled === 'boolean') ? d.popupStageEnabled : false;
  S.popupKvElementEnabled = !!d.popupKvElementEnabled;
  S.sharedProductGroupId = d.sharedProductGroupId || null;
  S.logo2Raw = d.logo2Raw || null;
  S.logo2Scale = (typeof d.logo2Scale === 'number') ? d.logo2Scale : 1;
  S.logo2OffX = d.logo2OffX || 0;
  S.logo2OffY = d.logo2OffY || 0;
  S.logo2Shape = d.logo2Shape || null;
  S.logo2BgColor = d.logo2BgColor || '#ffffff';
  S.logo2FillMode = !!d.logo2FillMode;
  S.popupLogo2Raw = d.popupLogo2Raw || null;
  S.popupLogo2Scale = (typeof d.popupLogo2Scale === 'number') ? d.popupLogo2Scale : 1;
  S.popupLogo2OffX = d.popupLogo2OffX || 0;
  S.popupLogo2OffY = d.popupLogo2OffY || 0;
  S.popupLogo2Shape = d.popupLogo2Shape || null;
  S.popupLogo2BgColor = d.popupLogo2BgColor || '#ffffff';
  S.popupLogo2FillMode = !!d.popupLogo2FillMode;
  S.arExtraScale = (typeof d.arExtraScale === 'number') ? d.arExtraScale : 1;
  S.arExtraOffX = d.arExtraOffX || 0;
  S.arExtraOffY = d.arExtraOffY || 0;

  var keys = Object.keys(d.assets || {});
  S.assets = { logo1:null, logo2:null, host:null, popupHost:null, popupLogo2:null, ctaDD:null, ctaGo:null, ctaGame:null, ctaMsbnIcon:null, arActivityLogo:null };

  /* msbnTexts是純字串，跟textGroups/layoutTextGroup同一套「直接深拷貝
     還原」，不用像msbnLogos那樣走pending計數器等圖片載入。 */
  S.msbnTexts = JSON.parse(JSON.stringify(d.msbnTexts || {}));

  /* MSBN三格LOGO還原——跟下面S.assets的還原是「同一個pending計數器」，
     兩邊的圖都load完才呼叫cb()，避免cb()先跑、切分頁當下MSBN還是空的。 */
  var msbnSrc = d.msbnLogos || {};
  var msbnJobs = [];
  Object.keys(msbnSrc).forEach(function(layoutId){
    Object.keys(msbnSrc[layoutId] || {}).forEach(function(slotKey){
      var entry = msbnSrc[layoutId][slotKey];
      if(entry && entry.src) msbnJobs.push({ layoutId: layoutId, slotKey: slotKey, entry: entry });
    });
  });
  S.msbnLogos = {};

  var pending = keys.length + msbnJobs.length;
  if(!pending){ if(cb) cb(); return; }

  keys.forEach(function(k){
    var src = d.assets[k];
    if(!src){ pending--; if(pending<=0 && cb) cb(); return; }
    var img = new Image();
    img.onload = function(){ S.assets[k]=img; pending--; if(pending<=0 && cb) cb(); };
    img.onerror = function(){ pending--; if(pending<=0 && cb) cb(); };
    img.src = src;
  });

  msbnJobs.forEach(function(job){
    var img = new Image();
    img.onload = function(){
      S.msbnLogos[job.layoutId] = S.msbnLogos[job.layoutId] || {};
      S.msbnLogos[job.layoutId][job.slotKey] = {
        img: img, scale: job.entry.scale||1, offX: job.entry.offX||0, offY: job.entry.offY||0,
        baseScale: job.entry.baseScale || job.entry.scale || 1, bgColor: job.entry.bgColor || '#ffffff'
      };
      pending--; if(pending<=0 && cb) cb();
    };
    img.onerror = function(){ pending--; if(pending<=0 && cb) cb(); };
    img.src = job.entry.src;
  });
}

/* 把使用者上傳的檔案讀成 HTMLImageElement，存進 S.assets，完成後呼叫 cb() 觸發重繪
   （FileReader是非同步的，用onload回呼，不用固定延遲） */
function loadAssetFile(key, file, cb){
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(ev){
    var img = new Image();
    img.onload = function(){
      /* 2026-08新增：LOGO1也要跟LOGO2一樣的底色規則(PNG固定白色、JPG抓
         四邊取樣色)——見js/logo2-editor.js的logo2SampleBgColor()，這裡
         直接沿用同一支函式，不重寫一次。LOGO2是透過自己的編輯popup把
         底色實際"畫"進合成好的圖片本體，LOGO1沒有對應的編輯popup、是
         直接指派給S.assets.logo1的原圖，所以改用「把算好的底色屬性掛在
         Image物件上，畫的時候(modules/logo-module.js)runtime再檢查」這種
         輕量做法，不用另外幫LOGO1做一套合成流程。只在key==='logo1'時
         算，其他key(host等商品照片、CTA badge)不需要這個底色填充效果。 */
      if(key === 'logo1') img.bgColor = logo2SampleBgColor(img);
      S.assets[key] = img; if(cb) cb();
    };
    img.onerror = function(){ console.error('圖片載入失敗: '+key); };
    img.src = ev.target.result;
  };
  reader.onerror = function(){ console.error('檔案讀取失敗: '+key); };
  reader.readAsDataURL(file);
}
