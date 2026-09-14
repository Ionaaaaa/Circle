'use strict';
/*
  editor-import-external.js —— 外廣(waiguang/站外)Excel工單匯入
  ------------------------------------------------------------
  跟js/editor-import.js(站內)最大的不同：站內版位是「固定幾種banner
  類型」，外廣版位是「一堆不同px尺寸」，同一份工單裡由上到下排了好幾個
  「大項」區塊(例如'01_LINE LAP_無低消'、'02_Facebook DPA'...)，每個大項
  底下才是實際的尺寸列表+文案/曝品資料。

  這支檔案盡量重用js/editor-import.js既有、已經驗證過的label-based
  掃描函式(parseTextGroups/parseTemplateVersion/
  parseExposureStyleFromVersionColumn/parseLogo2Info/parseExposureTable)
  ——外廣工單裡「標籤在左、值在右」「LOGO/版型/曝品」這幾個欄位的寫法
  跟站內是同一套慣例，不用重寫一份，只有「怎麼切出一個個大項區塊」跟
  「大項底下有沒有再切成好幾組獨立素材(04_Facebook那種)」是外廣特有的，
  这支檔案只負責這兩件事+把結果組成addExternalTabsFromImport()看得懂的
  格式。

  ══════ 大項(section)怎麼切 ══════
  掃描A欄：只要某一列A欄是非空字串(不等於'尺寸'本身)，且往下3列內有一列
  A欄剛好是'尺寸'，就認定這一列是一個大項的起始列。下一個大項起始列(或
  工單結尾)之前，都屬於這個大項的範圍。

  ══════ 大項底下要不要再切成好幾組獨立素材 ══════
  掃描這個大項範圍內每一欄，找有沒有某一欄出現≥2個「01、02、03...」這種
  二位數字串、而且數字嚴格遞增——有找到就代表這個大項其實是04_Facebook
  那種「同一尺寸重複好幾次、每次都是完全獨立一組文案+曝品模式」的多實例
  大項，依這些編號列的位置切成好幾個小單元，每個小單元各自視為一組獨立
  資料(各自解析文案/曝品/尺寸)。沒找到編號欄，整個大項當一組。

  ══════ 每個大項(或小單元)解析出什麼 ══════
  { sizes, templateVersion, exposureStyle, logoInfo, text, exposure }
  sizes：這組要輸出的尺寸清單(一般大項會有好幾個；多實例小單元通常只有1個)
  exposureStyle：'product'/'coupon'/null(找不到，例如02_Facebook DPA)
  text：{標題,副標,日期,第1張(後),第2張(前)}(直接借用parseTextGroups()
        回傳的'文案1'那組，欄位比站內少很多，用不到的欄位保持空字串沒差)
  exposure：{comboLetter,items}，商品模式才有意義，直接借用
        parseExposureTable()(欄位offset慣例跟站內完全一樣，見下面驗證)
*/

/* 大項/小單元標籤 → 資料夾/instanceId用的key，跟backgrounds/waiguang/
   底下的資料夾命名一致：空白/括號都換成底線，尾端底線去掉。
   例："03_Appier(急救)" → "03_Appier_急救"；"01_LINE LAP_無低消" →
   "01_LINE_LAP_無低消"。 */
/* 有些大項從Excel標籤直接算出來的key，使用者想要換成別的簡稱(跟工單
   標籤本身的文字沒有關係，純粹是這裡想要的命名)——目前只有Appier(急救)
   這一個，改成'03_Appier'。維穩共用急救的背景/排版設定，指到的目標
   也要跟著改(見modules/background-module.js的WAIGUANG_BG_SECTION_ALIAS
   跟js/editor-state.js的WAIGUANG_SECTION_LAYOUT_ALIAS，兩邊都要同步)。 */
var WAIGUANG_SECTION_KEY_OVERRIDE = {
  '03_Appier_急救': '03_Appier'
};
function waiguangSectionKey(label){
  var key = String(label||'').trim().replace(/[\s()（）]+/g, '_').replace(/_+$/, '');
  return WAIGUANG_SECTION_KEY_OVERRIDE[key] || key;
}

/* 掃A欄找「大項」起始列：A欄非空字串、不等於'尺寸'本身，且往下3列內
   有一列A欄剛好是'尺寸'(表頭列)。回傳[{label,rowStart,rowEnd}]，
   rowEnd是exclusive(下一個大項的rowStart，或rows.length)。 */
function findWaiguangSectionRanges(rows){
  var starts = [];
  for(var r=0; r<rows.length; r++){
    var row = rows[r];
    if(!row) continue;
    var cellA = row[0];
    if(typeof cellA !== 'string' || !cellA.trim() || cellA.trim() === '尺寸') continue;
    /* ★只看「緊接著的下一列」是不是'尺寸'——實際工單的大項標題列跟表頭列
       永遠緊鄰(中間沒有空白列)，如果放寬到往下2~3列都算，會誤把「這個
       大項清單裡最後一個尺寸的後面幾列剛好撞到下一個大項的表頭列」也
       算成一個新的大項起始點(實際測試過真的工單有這個問題：'1200x628'
       這個純尺寸值列會被誤判成自己是一個大項)。 */
    if(rows[r+1] && rows[r+1][0] === '尺寸') starts.push({ label: cellA.trim(), rowStart: r });
  }
  var ranges = [];
  for(var i=0;i<starts.length;i++){
    var rowEnd = (i+1<starts.length) ? starts[i+1].rowStart : rows.length;
    ranges.push({ label: starts[i].label, rowStart: starts[i].rowStart, rowEnd: rowEnd });
  }
  return ranges;
}

/* 這個範圍裡col0有哪些看起來像尺寸(例如'600x1200')的值，依出現順序、
   去重複回傳。 */
/* 這個範圍裡col0有哪些看起來像尺寸(例如'600x1200')的值，依出現順序、
   去重複回傳。
   2026-09新增：工單A欄可能會用類似'1200x628(無KV)'這種帶「無KV」標註的
   寫法，代表跟一般的'1200x628'是完全不同的兩個素材(一個要放商品/券卡
   圖、一個不放)——這裡正規化成內部用的'1200x628_no_kv'這個key(對應
   configs/layouts/waiguang/1200x628_no_kv.json)，跟純數字的'1200x628'
   分開處理，不會被誤判成同一個尺寸而互相蓋掉。標註寫法故意抓寬鬆一點
   (括號/底線/空格、有沒有括號都可以)，減少工單實際填法跟預期不一樣
   時漏抓的機會。 */
function normalizeWaiguangSizeToken(raw){
  if(/^\d+x\d+$/.test(raw)) return raw;
  var m = raw.match(/^(\d+x\d+)[\s_\-(（]*無\s*KV[)）]?$/i);
  if(m) return m[1] + '_no_kv';
  return null;
}

function findSizesInRange(rows, rowStart, rowEnd){
  var sizes = [];
  for(var r=rowStart; r<rowEnd; r++){
    var row = rows[r];
    var v = row && row[0];
    if(typeof v !== 'string') continue;
    var normalized = normalizeWaiguangSizeToken(v.trim());
    if(normalized && sizes.indexOf(normalized) === -1) sizes.push(normalized);
  }
  return sizes;
}

/* 找「編號欄」：這個範圍裡有沒有某一欄，出現≥2個二位數字串('01','02'...)
   且嚴格遞增。回傳欄位索引，找不到回傳-1。 */
function findNumberedMarkerColumn(rows, rowStart, rowEnd){
  var maxCols = 0;
  for(var r=rowStart; r<rowEnd; r++){
    if(rows[r]) maxCols = Math.max(maxCols, rows[r].length);
  }
  for(var c=0; c<maxCols; c++){
    var seen = [];
    for(var r2=rowStart; r2<rowEnd; r2++){
      var v = rows[r2] && rows[r2][c];
      if(typeof v === 'string' && /^\d{2}$/.test(v.trim())) seen.push(parseInt(v.trim(),10));
      else if(typeof v === 'number' && Number.isInteger(v) && v>=1 && v<=99) seen.push(v);
    }
    if(seen.length < 2) continue;
    var increasing = true;
    for(var i=1;i<seen.length;i++){ if(seen[i] <= seen[i-1]){ increasing = false; break; } }
    if(increasing) return c;
  }
  return -1;
}

/* 依編號欄的位置，把這個大項範圍切成好幾個小單元(跟js/editor-import.js
   的splitRowsIntoBlocks()同一個精神，只是這裡是依「某一欄的編號列」切，
   不是依A欄的'製作素材'表頭切)。回傳[{marker,rowStart,rowEnd}]。 */
function splitByNumberedMarker(rows, rowStart, rowEnd, markerCol){
  var markers = [];
  for(var r=rowStart; r<rowEnd; r++){
    var v = rows[r] && rows[r][markerCol];
    var vt = (typeof v === 'string') ? v.trim() : (typeof v === 'number' ? String(v) : null);
    if(vt && /^\d{1,2}$/.test(vt)) markers.push({ marker: vt, row: r });
  }
  var units = [];
  for(var i=0;i<markers.length;i++){
    var uStart = markers[i].row;
    var uEnd = (i+1<markers.length) ? markers[i+1].row : rowEnd;
    units.push({ marker: markers[i].marker, rowStart: uStart, rowEnd: uEnd });
  }
  return units;
}

/* 外廣工單的商品曝品表有一個站內沒有的寫法：沒用到的槽位(例如
   04_Facebook裡只用商品2(中)這一格的那幾組)，商品名稱欄位不是留空，
   而是填「(選填)」這個字面字串——parseExposureTable()(站內共用)本身的
   guard只判斷「是不是空字串」，不認得「(選填)」這個特殊值，會把它當成
   一個真正的商品名稱收進items裡，畫面上會出現一個叫「(選填)」的假商品、
   重複商品比對的簽章也會被這個假資料污染。這裡在外廣自己的parser裡
   額外濾掉，不去動parseExposureTable()本身(站內的工單沒有這個「(選填)」
   慣例，不需要也不應該幫它加這條規則)。 */
function filterOptionalSlots(exposure){
  if(!exposure) return exposure;
  exposure.items = (exposure.items || []).filter(function(it){
    return it.name && it.name.trim() !== '(選填)';
  });
  return exposure;
}

/* 從表頭型態判斷這個範圍是商品模式還是優惠券模式——直接找『曝品』(下一列
   同欄是商品1(左)/2(中)/3(右)其中之一)或『優惠券』(下一列同欄是
   第1張(後)或第2張(前))這兩種錨點組合，不看值有沒有填(dummy工單全部
   欄位都是空的，只能靠表頭型態判斷，不能靠「有沒有抓到值」判斷)。 */
function detectUnitExposureStyle(rows, rowStart, rowEnd){
  var KNOWN_SLOTS = ['商品1(左)','商品2(中)','商品3(右)'];
  for(var r=rowStart; r<rowEnd; r++){
    var row = rows[r];
    if(!row) continue;
    for(var c=0;c<row.length;c++){
      if(row[c] === '曝品'){
        var below = rows[r+1];
        if(below && KNOWN_SLOTS.indexOf(below[c]) !== -1) return 'product';
      }
      if(row[c] === '優惠券'){
        var below2 = rows[r+1];
        if(below2 && (below2[c] === '第1張(後)' || below2[c] === '第2張(前)')) return 'coupon';
      }
    }
  }
  return null;
}

/* 把一個大項(或小單元)的row範圍解析成一組完整資料。rows要整份原始
   rows陣列(不是切過的子陣列)，rowStart/rowEnd界定範圍——沿用
   js/editor-import.js的函式都是吃「整份rows+自己再往下掃到範圍結束」
   的寫法(例如遇到A欄空白就停)，這裡改成統一「先切出rowSlice」再丟給
   那些函式，比較不會不小心掃出範圍外的資料，尤其這裡好幾個大項緊接在
   一起，範圍算錯很容易把下一個大項的內容也讀進來。 */
function parseWaiguangUnit(rows, rowStart, rowEnd){
  var slice = rows.slice(rowStart, rowEnd);
  var sizes = findSizesInRange(rows, rowStart, rowEnd);
  var templateVersion = parseTemplateVersion(slice);
  var exposureStyle = parseExposureStyleFromVersionColumn(slice) || detectUnitExposureStyle(rows, rowStart, rowEnd);
  var logoInfo = parseLogo2Info(slice);
  var textGroups = parseTextGroups(slice);
  var text = textGroups['文案1'] || emptyTextGroup();
  var exposure = (exposureStyle === 'product') ? filterOptionalSlots(parseExposureTable(slice)) : null;
  return {
    sizes: sizes,
    templateVersion: templateVersion, // 'A'/'B'/null
    exposureStyle: exposureStyle,     // 'product'/'coupon'/null
    logoChecked: logoInfo.checked,
    logoMaterialName: logoInfo.materialName,
    text: text,
    exposure: exposure // {comboLetter,items} 或 null
  };
}

/* 整份外廣工單 → [{ key, label, multiInstance, units:[...] }]
   一般大項(LINE LAP/Appier/Facebook DPA)：multiInstance=false，
   units只有一個元素(整個大項當一組)。
   有編號欄的大項(04_Facebook)：multiInstance=true，units是依編號切出來
   的每一組，每組各自的text/exposureStyle/exposure完全獨立。 */
function parseWaiguangWorkbook(rows){
  var ranges = findWaiguangSectionRanges(rows);
  return ranges.map(function(range){
    var key = waiguangSectionKey(range.label);
    var markerCol = findNumberedMarkerColumn(rows, range.rowStart, range.rowEnd);
    if(markerCol === -1){
      return {
        key: key, label: range.label, multiInstance: false,
        units: [ parseWaiguangUnit(rows, range.rowStart, range.rowEnd) ]
      };
    }
    var subUnits = splitByNumberedMarker(rows, range.rowStart, range.rowEnd, markerCol);
    var units = subUnits.map(function(u){
      var parsed = parseWaiguangUnit(rows, u.rowStart, u.rowEnd);
      parsed.marker = u.marker;
      return parsed;
    });
    /* ★實測發現：這種多實例大項裡，只有第一組(01)的A欄真的填了尺寸值
       ('1080x1080')，後面幾組(02、03...)A欄整個是空的(工單製作習慣，
       同一個大項本來就固定同一個尺寸，後面懶得每組都重填一次)——這裡
       退回用「這個大項裡第一個抓到尺寸的組別」當作全部組別共用的尺寸，
       不用強迫使用者每一組都填一次A欄，之後如果真的遇到11組尺寸不一樣
       的工單，這個假設要拿掉(改成每組各自要求填自己的尺寸，不要互相
       借用)。 */
    var fallbackSizes = null;
    for(var ui=0; ui<units.length; ui++){
      if(units[ui].sizes.length){ fallbackSizes = units[ui].sizes; break; }
    }
    if(fallbackSizes){
      units.forEach(function(u){ if(!u.sizes.length) u.sizes = fallbackSizes; });
    }
    return { key: key, label: range.label, multiInstance: true, units: units };
  });
}

/* ══════════════════ 依解析結果，建立分頁 + 跑1200 popup確認鏈 ══════════════════
   跟js/editor-popups.js的processOneBlock()同一個精神(依序confirm、
   confirm完呼叫done()才處理下一個)，但這裡「一個大項=一個分頁」，
   分頁裡的每個尺寸(或04_Facebook那種multiInstance分頁裡的每一組)才是
   各自要開的1200 popup。

   ★刻意不修改js/shadow-system/shadow-popup.js／coupon-popup.js的內部
   實作——這兩支已經是站內驗證過穩定在用的邏輯，這裡改用「呼叫前後包一層
   存取轉換」的做法：
     - 商品模式：呼叫openShadowPopup(onConfirm)前，先把S.shadowSlots/
       shadowCombo/shadowOrder換成這個實例自己要用的內容(全新的用空的、
       重複的用之前存的snapshot)；確認完(onConfirm觸發時)S.assets.host
       已經是這次合成結果，複製一份進S.instanceAssets[instanceId].host、
       同時存一份snapshot給之後可能的「重複」比對用，再把S.assets.host
       清空避免污染下一個實例。
     - 優惠券模式：coupon-popup.js內部寫死用groupKeyForLayout('03_c2c_bn')
       決定要讀寫哪一組文案——這裡不用改那支檔案，改成呼叫
       openCouponPopup()之前，先把S.layoutTextGroup['03_c2c_bn']臨時
       指向「這個實例自己的文案組key」(instanceId本身)，這樣
       groupKeyForLayout('03_c2c_bn')查到的就是這個實例的資料，
       coupon-popup.js完全不用知道多了「外廣multiInstance」這件事。
       確認完一樣把S.assets.host複製進S.instanceAssets、清空共用欄位。 */

/* 2026-09第三版：使用者反映——就算選擇沿用，1200畫布還是要打開讓他看
   一次，因為公版背景顏色(紅版/藍版)可能跟前面那組不一樣，陰影顏色是
   跟著目前這個分頁的公版顏色算的，只有真的把1200畫布打開重新渲染一次，
   陰影色才會套用到「這一組」正確的顏色——不能像上一版那樣選了沿用就
   完全跳過popup直接複製舊圖，那樣陰影顏色會維持舊那組公版的顏色，可能
   跟這組的背景不搭。
   所以snapshot存的不再是「已經合成好的最終圖片」，改回存「可編輯狀態」
   (shadowSlots/shadowCombo/shadowOrder/priceTags)——選擇沿用時，把這些
   狀態複製進S.shadowSlots等等，然後照樣打開openShadowPopup()，讓使用者
   看到畫面(陰影顏色會自動套用這一組的公版顏色)，按確認才算完成，跟
   「不沿用、從空白開始」唯一的差別只在於「一開始要不要預先填好」，
   兩條路最後都一定會經過1200畫布這一步。 */
var _waiguangSignatureResults = {}; // signature -> { shadowSlots, shadowCombo, shadowOrder, priceTags, label }
function resetWaiguangDuplicateTracking(){
  _waiguangSignatureResults = {};
}

/* 依user確認過的規則算「這組商品」的比對簽章：商品名稱+原價+標價全部
   一樣、而且組合(combo/用了哪些槽位)也要一樣，才算同一組——任何一項不同
   都不算重複，要重新製作。items全部是空的(工單還沒填實際商品)時回傳
   null，代表「還沒有實際內容可以比較，不要誤判成重複」。
   ★這裡的「組合不同」不是靠Excel的comboLetter欄位比對(那欄實際上幾乎
   不會被填)，而是直接靠items本身的內容/槽位差異天然反映出來——例如
   只用商品2(中)這一格 vs 三品同框，items陣列的長度/內容本來就不一樣，
   簽章自然就不同，不需要另外處理。 */
function computeWaiguangProductSignature(exposure){
  if(!exposure || !exposure.items || !exposure.items.length) return null;
  var hasContent = exposure.items.some(function(it){ return it.name; });
  if(!hasContent) return null;
  var parts = exposure.items.slice()
    .sort(function(a,b){ return a.slot < b.slot ? -1 : (a.slot > b.slot ? 1 : 0); })
    .map(function(it){ return it.slot+'|'+(it.name||'')+'|'+(it.originalPrice||'')+'|'+(it.salePrice||''); });
  return (exposure.comboLetter||'') + '::' + parts.join('||');
}

/* 這個大項要顯示的instanceId清單(同時負責動態註冊進LAYOUT_REGISTRY)。 */
function waiguangInstanceIdsForSection(section){
  if(!section.multiInstance){
    var unit = section.units[0];
    return unit.sizes.map(function(size){
      var instanceId = section.key + '__' + size;
      /* 尺寸id本身可能是給程式用的內部代號(例如'1200x628_no_kv')，顯示
         給使用者看(左側素材清單/右側作用中項目標題)的名稱改查
         WAIGUANG_SIZE_DISPLAY_NAMES，查不到才直接顯示尺寸id本身。 */
      var label = WAIGUANG_SIZE_DISPLAY_NAMES[size] || size;
      /* ★2026-09新增：instanceId/label都維持用原始尺寸字串(例如純數字的
         '1080x1080')，只有實際要去查哪一份configFile這件事改用
         resolveWaiguangSizeKey()——有些大項(目前是LINE LAP)在同一個
         尺寸下有自己專屬的排版設計，跟其他大項共用同一個純尺寸key會
         互相蓋掉，見js/editor-state.js的WAIGUANG_SECTION_LAYOUT_ALIAS
         說明。查不到大項專屬版本，會直接退回原始尺寸(行為跟以前一樣，
         不影響還沒特別客製過的其他大項)。 */
      var baseKey = resolveWaiguangSizeKey(section.key, size);
      ensureWaiguangInstanceRegistered(instanceId, baseKey, label);
      return instanceId;
    });
  }
  /* 2026-09新增：右側面板的「作用中項目」標題行要顯示簡短好認的名稱，
     例如"03 Facebook"(編號+大項簡稱)，不是原始的instanceId那種內部
     格式——把大項label開頭的"數字_"去掉(例如"04_Facebook"→"Facebook")，
     跟編號組合起來。見js/editor-main.js的updateActiveItemPanel()。 */
  var shortSectionName = section.label.replace(/^\d+_/, '');
  return section.units.map(function(unit){
    var size = unit.sizes[0];
    var instanceId = section.key + '__' + size + '__' + unit.marker;
    var label = (unit.marker || '') + ' ' + shortSectionName;
    /* ★2026-09修正：multiInstance(例如04_Facebook)這條路徑之前漏了
       resolveWaiguangSizeKey()這一步，只有非multiInstance的大項才有套用
       到「大項專屬版面」的解析——導致04_Facebook這種大項就算幫它另外
       建立了'04_Facebook_1080x1080'這種專屬設定，也不會被用到(還是會
       退回共用的'1080x1080'placeholder)。跟上面非multiInstance那段
       同一套邏輯，查不到大項專屬版本一樣會直接退回原始尺寸，不影響
       任何還沒特別客製過的大項。 */
    var baseKey = resolveWaiguangSizeKey(section.key, size);
    ensureWaiguangInstanceRegistered(instanceId, baseKey, label);
    return instanceId;
  });
}

function addExternalTabFromSection(section, folderFiles, orderName, onReady){
  var instanceIds = waiguangInstanceIdsForSection(section);
  var data = newEmptyTabData(section.label);
  data.siteMode = 'external';
  data.activeLayoutIds = instanceIds;
  data.exposureLabel = section.label;
  /* 2026-09新增：整包下載的zip檔名要用Excel工單的「工作項目名稱」，不是
     分頁標籤本身(分頁標籤是大項名稱，例如'01_LINE LAP'，工單案名才是
     使用者真正想要的檔名)——存進每個分頁自己的資料裡，見
     js/editor-export.js的downloadAll()改成優先讀這個欄位。 */
  data.waiguangOrderName = orderName || null;

  if(!section.multiInstance){
    var unit = section.units[0];
    data.templateVersion = (unit.templateVersion === 'B') ? 'B' : 'A';
    data.exposureStyle = (unit.exposureStyle === 'coupon') ? 'coupon' : 'product';
    data.textGroups = { '文案1': Object.assign(emptyTextGroup(), unit.text) };
    data.layoutTextGroup = {};
    instanceIds.forEach(function(id){ data.layoutTextGroup[id] = '文案1'; });
  } else {
    /* multiInstance(04_Facebook)：每組各自獨立一份文案組(key直接用
       instanceId本身)+各自獨立的exposureStyle，靠S.instanceExposureStyle
       覆蓋掉分頁層級的exposureStyle(見js/editor-main.js的renderAll())。 */
    data.textGroups = {};
    data.layoutTextGroup = {};
    data.instanceExposureStyle = {};
    section.units.forEach(function(unit, i){
      var instanceId = instanceIds[i];
      data.textGroups[instanceId] = Object.assign(emptyTextGroup(), unit.text);
      data.layoutTextGroup[instanceId] = instanceId;
      data.instanceExposureStyle[instanceId] = (unit.exposureStyle === 'coupon') ? 'coupon' : 'product';
    });
    data.activeTextGroup = instanceIds[0];
  }

  saveCurrentTabIntoData();
  var canReplaceDefault = TABS.length === 1 && isEmptyDefaultTabData(TABS[0].data);
  if(canReplaceDefault){ TABS[0] = { data: data }; ACTIVE_TAB = 0; }
  else { TABS.push({ data: data }); ACTIVE_TAB = TABS.length-1; }
  renderTabBar();

  /* LOGO1/LOGO2素材比對——跟js/editor-popups.js的runImport()同一套
     matchAssetFolder()，只是這裡固定用「大項第一組」的LOGO資訊當這個
     分頁的LOGO來源(04_Facebook這種multiInstance大項，實測工單裡LOGO
     只會出現在整個大項層級，不是每個編號子項各自填一次)。找不到folder
     或沒比對到就完全跳過，不影響後面的1200 popup確認鏈。 */
  var logoUnit = section.units[0];
  var extraAliases = logoUnit.logoMaterialName ? { logo2: [logoUnit.logoMaterialName] } : null;
  var matchedLogo = (folderFiles && folderFiles.length) ? matchAssetFolder(folderFiles, null, extraAliases) : {};

  applyTabData(ACTIVE_TAB, function(){
    refreshRightPanel();
    buildCanvasArea().then(function(){
      applyDefaultLogos(function(){
        if(matchedLogo.logo1) loadAssetFile('logo1', matchedLogo.logo1, renderAll);
        var logo2Checked = !!logoUnit.logoChecked;
        function proceedToConfirmChain(){
          renderAll();
          runExternalConfirmChain(section, instanceIds, folderFiles, onReady);
        }
        if(logo2Checked && matchedLogo.logo2){
          logo2AutoApplyFromFile(matchedLogo.logo2, function(err){
            if(err) console.warn('[editor-import-external] logo2自動套用失敗：', err);
            renderAll();
            openLogo2Editor(proceedToConfirmChain);
          });
        } else if(logo2Checked){
          openLogo2Editor(proceedToConfirmChain);
        } else {
          proceedToConfirmChain();
        }
      });
    });
  });
}

/* 依曝品表的原價/標價，自動打開＋填好小標——跟matched shadowSlots同一個
   道理，之前沒有接這段，使用者在1200 popup裡看到的小標checkbox是關的、
   原價/特價輸入框是空的，要自己手動一格一格打。這裡直接用Excel讀到的
   originalPrice/salePrice(見js/editor-import.js的parseExposureTable())
   預先寫進S.priceTags，任一個有值就自動打開小標(on:true)，使用者開
   popup時就已經看得到，需要調整位置再自己拖曳就好，不用重新輸入文字。
   ★這個gap其實站內(js/editor-popups.js的proceedToShadowFromImport())
   目前也一樣沒接，一併修正在那邊，兩邊都會有這個自動套用行為。 */
function applyExposurePriceTagsForExternal(exposureItems){
  (exposureItems||[]).forEach(function(item){
    S.priceTags = S.priceTags || {};
    var hasPrice = !!((item.originalPrice && item.originalPrice.trim()) || (item.salePrice && item.salePrice.trim()));
    var prev = S.priceTags[item.slot] || {};
    S.priceTags[item.slot] = {
      on: hasPrice,
      offsetXPct: (prev.offsetXPct !== undefined) ? prev.offsetXPct : 1.05,
      offsetYPct: (prev.offsetYPct !== undefined) ? prev.offsetYPct : 0.15,
      orientation: prev.orientation || 'left',
      originalPrice: item.originalPrice || '',
      salePrice: item.salePrice || ''
    };
  });
}

/* 依matchAssetFolder()比對到的檔案，讀成dataURL塞進S.shadowSlots——
   跟js/editor-popups.js的proceedToShadowFromImport()同一套讀檔邏輯，
   這裡另外抽一份是因為外廣的呼叫時機不一樣(要嵌在runExternalConfirmChain
   的鏈式流程裡，讀完才能開popup)，不方便直接共用那支函式(它自己內部
   已經綁定了openShadowPopup(onConfirm)，沒有留「讀完但先不開popup」的
   中間點)。 */
function applyMatchedShadowSlotsForExternal(matched, exposureItems, cb){
  var shadowKeys = (exposureItems||[]).map(function(it){ return it.slot; }).filter(function(k){ return matched[k]; });
  if(!shadowKeys.length){ cb(); return; }
  var pending = shadowKeys.length;
  shadowKeys.forEach(function(slotId){
    var ratio = matched[slotId].__importRatio;
    var reader = new FileReader();
    reader.onload = function(ev){
      S.shadowSlots = S.shadowSlots || {};
      S.shadowSlots[slotId] = { dataUrl: ev.target.result, type: 'product', ratio: ratio };
      pending--;
      if(pending<=0) cb();
    };
    reader.onerror = function(){ pending--; if(pending<=0) cb(); };
    reader.readAsDataURL(matched[slotId]);
  });
}

/* 商品模式的1200 popup統一入口——不管是「一整個大項共用一次」(非
   multiInstance)還是「大項底下某一小組」(multiInstance)，都走這裡：
   比對過重複簽章，重複的話跳出「是否要沿用」的明確二選一，選「是」會
   把前一組調整好的狀態(商品照片/位置/組合/小標)預先複製進來，選「否」
   則從空白開始——但不管選哪一個，最後都一定會打開1200畫布讓使用者看
   一次才算完成，不會整個跳過popup(陰影顏色要靠實際打開畫布重新渲染，
   才會套用到「這一組」正確的公版背景顏色，直接複製舊圖顏色可能不對)。
     unit         這組的解析結果(拿exposure/comboLetter/exposure.items用)
     label        這組的說明文字，用在確認對話框跟之後被別組比對時顯示
     folderFiles  素材資料夾(可能是undefined/空陣列，代表使用者沒有上傳)
     applyHost(img) 呼叫端決定「這張合成圖要放到哪裡」——非multiInstance
                    寫S.assets.host(整個分頁廣播共用)，multiInstance寫
                    S.instanceAssets[instanceId].host(這組自己獨立一份)
     instanceId   給multiInstance用——這組自己的id，確認完會把可編輯狀態
                  (shadowSlots/shadowCombo/shadowOrder/priceTags)存進
                  S.instanceShadowState[instanceId]，讓使用者事後可以點
                  這一組專屬的「編輯商品」mini按鈕重新打開調整(見
                  js/editor-main.js的openWaiguangProductEditor())。非
                  multiInstance(整頁廣播)傳null，不需要記這份(那種情況
                  右側的「調整商品/主持人」按鈕本來就是開全域共用的
                  S.shadowSlots，沒有「哪一組」的問題)。
     onDone()     這組處理完了，接著處理下一組 */
/* 2026-09新增：每一組商品(不管是「沿用」還是「從空白開始」)在真正打開
   1200畫布之前，都要先讀取素材(matchAssetFolder()/FileReader讀圖)，這段
   是非同步的，讀取期間畫面上完全沒有任何popup(前一組的popup已經關掉、
   下一組的還沒開起來)，使用者反映「看不出來還在讀取」、以為卡住了。
   這裡在每組開始處理時，先蓋一層跟「匯入中」同樣風格的loading遮罩(擋掉
   背景互動)，等真正的1200 popup打開時，createOverlay()本身就會自動關掉
   目前這層loading遮罩(它會先closePopup()再開新內容)，銜接起來不會有
   任何空窗期，也不用額外呼叫關閉。 */
function showWaiguangLoadingOverlay(){
  createOverlay(
    '<div class="popup-panel" style="width:280px;">'+
      '<div class="popup-body" style="text-align:center;padding:28px 16px;">'+
        '<div class="hint" style="margin:0;">讀取素材中，請稍候…</div>'+
      '</div>'+
    '</div>'
  );
}

function handleWaiguangProductUnit(unit, label, folderFiles, applyHost, instanceId, onDone){
  var sig = computeWaiguangProductSignature(unit.exposure);
  var match = sig ? _waiguangSignatureResults[sig] : null;
  showWaiguangLoadingOverlay();

  function afterConfirm(){
    /* ★2026-09修正：這裡以前無條件把S.assets.host清成null，對
       multiInstance(04_Facebook)是對的(避免污染下一組)，但對非
       multiInstance的整頁廣播來說是bug——applyHost()對這種情況就是
       直接寫`S.assets.host = img`，兩者是同一個欄位，寫完馬上被這裡
       清空，等於這個分頁最後真正存進tab資料的host永遠是null，商品完全
       不會出現在畫布上(要使用者手動重新打開「調整商品/主持人」popup
       再確認一次才會補回來，這正是使用者實際回報的症狀)。清空
       S.assets.host這件事本來就只有「同一分頁裡還要接著處理下一組
       multiInstance實例」才需要，改成由multiInstance那個呼叫端自己
       決定要不要清，這裡不再自作主張清空。 */
    applyHost(S.assets.host);
    var stateSnapshot = {
      shadowSlots: JSON.parse(JSON.stringify(S.shadowSlots || {})),
      shadowCombo: S.shadowCombo,
      shadowOrder: S.shadowOrder ? S.shadowOrder.slice() : null,
      priceTags: JSON.parse(JSON.stringify(S.priceTags || {})),
      /* 2026-09新增：錢幣位置(S.kvCoinSlots)也要一起記住——使用者反映
         調整商品擺放時常常連帶把錢幣也一起挪動位置，如果「沿用」只還原
         商品/陰影，錢幣卻沒有跟著還原，等於使用者上次調整的錢幣位置
         白費工，這次連錢幣一起存進同一份快照。 */
      kvCoinSlots: JSON.parse(JSON.stringify(S.kvCoinSlots || {}))
    };
    if(sig){
      _waiguangSignatureResults[sig] = Object.assign({ label: label }, stateSnapshot);
    }
    if(instanceId){
      S.instanceShadowState = S.instanceShadowState || {};
      S.instanceShadowState[instanceId] = stateSnapshot;
    }
    onDone();
  }

  function openFresh(){
    S.shadowSlots = {};
    S.kvCoinSlots = {}; // 新的一組，錢幣位置從預設值重新開始，不沿用上一組殘留的位置
    /* 外廣的曝品一律是「3品同框」(不像站內KV有人物+商品混搭的情況)，
       工單本身通常不會特別填「組合」欄位(comboLetter會是null)——這裡
       預設用內部代號'D'(=下拉選單顯示的「C組合(3品)」)，讓popup一開
       就是正確的3品版面，不用使用者自己手動切。★這裡故意用字母'D'
       不是'C'——內部代號跟下拉選單文字對不起來，'C'其實是「B組合
       (1人+2品)」，'D'才是「C組合(3品)」，見js/shadow-system/
       shadow-layout-defaults-circle.js的CIRCLE_COMBO_UI/
       CIRCLE_COMBO_SLOTS說明，千萬別搞混。 */
    S.shadowCombo = (unit.exposure && unit.exposure.comboLetter) || 'D';
    S.shadowOrder = null;
    applyExposurePriceTagsForExternal(unit.exposure && unit.exposure.items);
    var matched = (folderFiles && folderFiles.length) ? matchAssetFolder(folderFiles, unit.exposure && unit.exposure.items, null) : {};
    applyMatchedShadowSlotsForExternal(matched, unit.exposure && unit.exposure.items, function(){
      openShadowPopup(afterConfirm);
    });
  }

  if(match){
    var reuse = confirm(
      '「'+label+'」的商品名稱／原價／標價／組合，跟「'+match.label+'」完全相同。\n\n'+
      '要沿用「'+match.label+'」已經調整好的排版嗎？(還是會開啟1200畫布讓你確認一次——'+
      '如果背景公版顏色不一樣，陰影顏色需要重新打開畫布才會套用到正確的顏色)\n\n'+
      '按「確定」＝套用「'+match.label+'」的排版，開啟畫面確認。\n'+
      '按「取消」＝我要從空白開始重新調整這一組。'
    );
    if(reuse){
      S.shadowSlots = JSON.parse(JSON.stringify(match.shadowSlots || {}));
      S.shadowCombo = match.shadowCombo || 'D';
      S.shadowOrder = match.shadowOrder ? match.shadowOrder.slice() : null;
      S.priceTags = JSON.parse(JSON.stringify(match.priceTags || {}));
      S.kvCoinSlots = JSON.parse(JSON.stringify(match.kvCoinSlots || {}));
      openShadowPopup(afterConfirm);
      return;
    }
  }

  openFresh();
}

/* 這個分頁底下，依序把每個尺寸(或每一組multiInstance實例)的1200 popup
   跑過一輪；全部跑完才呼叫onReady()(呼叫端會接著處理下一個大項/分頁)。 */
function runExternalConfirmChain(section, instanceIds, folderFiles, onReady){
  if(!section.multiInstance){
    var unit = section.units[0];
    if(unit.exposureStyle === 'coupon'){
      showWaiguangLoadingOverlay();
      openCouponPopup(function(){ onReady(); });
    } else if(unit.exposureStyle === 'product'){
      handleWaiguangProductUnit(unit, section.label, folderFiles, function(img){
        S.assets.host = img;
      }, null, onReady);
    } else {
      onReady(); // 例如02_Facebook DPA，純文字沒有host可以確認
    }
    return;
  }

  var idx = 0;
  (function nextUnit(){
    if(idx >= section.units.length){ onReady(); return; }
    var unit = section.units[idx];
    var instanceId = instanceIds[idx];
    idx++;
    updateWaiguangProgressBadge(section.label+' 第'+(unit.marker||idx)+'組（第'+idx+'／'+section.units.length+'組）');

    if(unit.exposureStyle === 'coupon'){
      showWaiguangLoadingOverlay();
      S.layoutTextGroup['03_c2c_bn'] = instanceId; // 借道：讓coupon-popup.js讀寫這個實例自己的文案組
      openCouponPopup(function(){
        S.instanceAssets[instanceId] = S.instanceAssets[instanceId] || {};
        S.instanceAssets[instanceId].host = S.assets.host;
        S.assets.host = null;
        nextUnit();
      });
      return;
    }

    if(unit.exposureStyle === 'product'){
      var label = section.label + ' 第' + (unit.marker || idx) + '組';
      handleWaiguangProductUnit(unit, label, folderFiles, function(img){
        S.instanceAssets[instanceId] = S.instanceAssets[instanceId] || {};
        S.instanceAssets[instanceId].host = img;
        S.assets.host = null; // 清掉共用欄位，避免污染下一組multiInstance實例
      }, instanceId, nextUnit);
      return;
    }

    nextUnit(); // 這組沒有明確的曝品模式，跳過不開popup
  })();
}

/* ══════════════════ 事後重新編輯某一組商品 ══════════════════
   使用者匯入完成後，畫布上每個外廣multiInstance商品模式實例都有一顆
   「編輯商品」mini按鈕(見js/editor-main.js的buildCanvasArea())，點下去
   呼叫這裡——跟匯入時走的是同一個openShadowPopup()，但這次是「使用者
   自己主動重新打開特定一組」，讀寫的是S.instanceShadowState[instanceId]
   這份「這組自己專屬」的可編輯狀態，不會動到全域共用的S.shadowSlots
   殘留的其他組資料，也不會影響到其他組。 */
function openWaiguangProductEditor(instanceId){
  var snap = (S.instanceShadowState && S.instanceShadowState[instanceId]) || null;
  S.shadowSlots = snap ? JSON.parse(JSON.stringify(snap.shadowSlots || {})) : {};
  S.shadowCombo = (snap && snap.shadowCombo) || 'D';
  S.shadowOrder = (snap && snap.shadowOrder) ? snap.shadowOrder.slice() : null;
  S.priceTags = snap ? JSON.parse(JSON.stringify(snap.priceTags || {})) : {};
  S.kvCoinSlots = snap ? JSON.parse(JSON.stringify(snap.kvCoinSlots || {})) : {};
  openShadowPopup(function(){
    S.instanceAssets[instanceId] = S.instanceAssets[instanceId] || {};
    S.instanceAssets[instanceId].host = S.assets.host;
    S.instanceShadowState = S.instanceShadowState || {};
    S.instanceShadowState[instanceId] = {
      shadowSlots: JSON.parse(JSON.stringify(S.shadowSlots || {})),
      shadowCombo: S.shadowCombo,
      shadowOrder: S.shadowOrder ? S.shadowOrder.slice() : null,
      priceTags: JSON.parse(JSON.stringify(S.priceTags || {})),
      kvCoinSlots: JSON.parse(JSON.stringify(S.kvCoinSlots || {}))
    };
    S.assets.host = null;
    renderAll();
  });
}

/* ══════════════════ 匯入入口：一份外廣Excel → 依序建立好幾個分頁 ══════════════════ */
/* ══════════════════ 匯入過程進度提示 ══════════════════
   使用者反映：一組一組確認商品時，完全不知道現在確認的是哪個製作物、
   還剩幾個——加一個固定在畫面上方的小提示條，跟著匯入流程走到哪就更新
   到哪，全部確認完自動消失。是獨立疊在畫面最上層的浮動元素(不是塞進
   1200 popup自己的DOM)，這樣完全不用改openShadowPopup()/
   openCouponPopup()共用的彈窗程式碼，站內流程也不會被影響到(這個badge
   只有外廣匯入流程會呼叫，站內的匯入/popup操作完全不會觸發它)。 */
function updateWaiguangProgressBadge(text){
  var el = document.getElementById('waiguang-progress-badge');
  if(!el){
    el = document.createElement('div');
    el.id = 'waiguang-progress-badge';
    el.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);'+
      'background:#1c1c1c;color:#fff;padding:8px 18px;border-radius:20px;'+
      'font-size:13px;z-index:99999;box-shadow:0 2px 12px rgba(0,0,0,0.5);'+
      'border:1px solid #EE4D2D;white-space:nowrap;';
    document.body.appendChild(el);
  }
  el.textContent = text;
}
function removeWaiguangProgressBadge(){
  var el = document.getElementById('waiguang-progress-badge');
  if(el) el.remove();
}

function runExternalImport(excelFile, folderFiles){
  resetWaiguangDuplicateTracking(); // 每次重新匯入都是全新的一份重複比對紀錄，不殘留上一次的結果
  importWaiguangExcel(excelFile).then(function(result){
    var sections = result.sections;
    var idx = 0;
    (function nextSection(){
      if(idx >= sections.length){ removeWaiguangProgressBadge(); return; }
      var section = sections[idx++];
      updateWaiguangProgressBadge('正在確認：'+section.label+'（大項 第'+idx+'／'+sections.length+'個）');
      addExternalTabFromSection(section, folderFiles, result.orderName, nextSection);
    })();
  }).catch(function(err){
    removeWaiguangProgressBadge();
    alert('外廣Excel匯入失敗：'+err.message);
    console.error(err);
  });
}
/* ══════════════════ 匯入Excel檔案(拿到File物件開始，讀成rows) ══════════════════
   跟js/editor-import.js的importCircleExcel()同一套讀法(FileReader+
   XLSX.read)，只是這裡固定找工作表名稱包含'站外'的分頁(找不到就用第一個
   分頁，跟站內找'公版'欄位的邏輯是同一種「盡量對到、對不到給預設值」
   精神)。 */
function importWaiguangExcel(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(ev){
      try{
        var wb = XLSX.read(ev.target.result, {type:'binary', cellDates:false});
        var sheetName = wb.SheetNames.find(function(name){ return name.indexOf('站外') !== -1; }) || wb.SheetNames[0];
        var ws = wb.Sheets[sheetName];
        var rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true});

        var orderName = null;
        for(var r=0;r<rows.length;r++){
          if(rows[r] && rows[r][0]==='工作項目名稱'){ orderName = rows[r][1]; break; }
        }

        var sections = parseWaiguangWorkbook(rows);
        resolve({ orderName: orderName || file.name.replace(/\.xlsx?$/i,''), sections: sections });
      }catch(e){
        reject(e);
      }
    };
    reader.onerror = function(){ reject(new Error('檔案讀取失敗')); };
    reader.readAsBinaryString(file);
  });
}
