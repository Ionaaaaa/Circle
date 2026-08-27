'use strict';
/*
  editor-import.js —— Excel 工單匯入
  ------------------------------------------------------------
  讀取邏輯用「文字標籤比對」而不是「固定第幾列」，這樣同一份樣板不管
  中間新增/減少幾列製作物，都不會讀錯位置。

  目前做到：
    1. 掃描A欄「製作素材」清單下方，抓出這次工單勾選了哪些製作物
       → 用來決定這個分頁要顯示哪幾個版位
    2. 掃描「標題」「副標」「日期」標籤，把右邊那格的值讀進文字內容
    3. LOGO 讀取先做基本版
    4. 【新增】掃描「曝品」表格：組合(A/B/C)是哪個、每個槽位(人物1/人物2/
       商品1(左)/商品2(中)/商品3(右))實際指定的商品名稱、跟商品比例(大/中/小)
       —— 這是真正決定「哪個檔案要放進哪個槽位」的依據，不是靠檔名亂猜

  已知限制（之後再討論規則）：
    - AR內容／文案 欄位排列比較特殊，先跳過避免亂讀
*/

function importCircleExcel(file){
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(ev){
      try{
        var wb = XLSX.read(ev.target.result, {type:'binary', cellDates:false});
        var sheetName = wb.SheetNames.find(function(name){
          var ws = wb.Sheets[name];
          var rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true});
          return rows.some(function(row){ return row[0] === '公版'; });
        }) || wb.SheetNames[0];

        var ws = wb.Sheets[sheetName];
        var rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true});

        /* 順便抓工作項目名稱，拿來當分頁標籤 */
        var orderName = null;
        for(var r=0;r<rows.length;r++){
          if(rows[r] && rows[r][0]==='工作項目名稱'){ orderName = rows[r][1]; break; }
        }

        var parsed = parseRows(rows);
        parsed.orderName = orderName || file.name.replace(/\.xlsx?$/i,'');
        resolve(parsed);
      }catch(e){
        reject(e);
      }
    };
    reader.onerror = function(){ reject(new Error('檔案讀取失敗')); };
    reader.readAsBinaryString(file);
  });
}

function parseRows(rows){
  var materials = [];
  var textValues = {};
  var logoInfo = null;

  var matHeaderRow = -1;
  for(var r=0; r<rows.length; r++){
    if(rows[r] && rows[r][0] === '製作素材'){ matHeaderRow = r; break; }
  }
  if(matHeaderRow >= 0){
    for(var r2 = matHeaderRow+1; r2 < rows.length; r2++){
      var cellA = rows[r2] && rows[r2][0];
      if(cellA === undefined || cellA === null || cellA === '') break;
      materials.push(String(cellA).trim());
    }
  }

  var LABELS = ['標題','副標','日期','AR文案'];
  rows.forEach(function(row){
    if(!row) return;
    row.forEach(function(cell, c){
      if(LABELS.indexOf(cell) >= 0){
        var val = row[c+1];
        if(val !== undefined && val !== null && val !== ''){
          textValues[cell] = String(val).trim();
        }
      }
      if(cell === 'LOGO'){
        for(var k=c+1; k<row.length; k++){
          if(typeof row[k] === 'string' && row[k].trim()){ logoInfo = row[k].trim(); break; }
        }
      }
    });
  });

  var exposure = parseExposureTable(rows);
  var logo2Info = parseLogo2Info(rows);
  var arInfo = parseARCell(rows);

  return { materials: materials, text: textValues, logoInfo: logoInfo, exposure: exposure, logo2Checked: logo2Info.checked, logo2MaterialName: logo2Info.materialName, arInfo: arInfo };
}

/* ══════════════════ AR版位（100x100，三選一版本）══════════════════
   實際拿到工單檔案確認過真正的格式：
     G21='AR內容'、H21=版本文字(例如'文案'/'活動LOGO'/'店家LOGO')
     G22='文案'、  H22=版本是'文案'時，實際要顯示的文字內容
   格式上跟標題/副標/日期是同一套「標籤在左、值在右邊那一格」的寫法，所以
   沿用同一個LABELS掃描機制就好，不用另外寫死固定的列/欄座標（之前猜
   HI21/HI22是憑文字描述亂猜的固定座標，猜錯了；這次是照實際檔案改的，
   用標籤比對，工單裡這兩個儲存格不管挪到第幾列都抓得到）。 */
function _arMatchVariant(text){
  var t = String(text||'').trim();
  if(!t) return null;
  if(t.indexOf('文案')>=0 || t.toUpperCase().indexOf('TEXT')>=0) return 'text';
  if(t.indexOf('店家')>=0 || t.indexOf('賣家')>=0 || t.toUpperCase().indexOf('SELLER')>=0) return 'seller';
  if(t.indexOf('活動')>=0 || t.toUpperCase().indexOf('ACTIVITY')>=0) return 'activity';
  return null;
}

/* 找到'AR內容'這個標籤，讀它右邊那格當版本；再找'文案'這個標籤（精確比對，
   不是'文案1'那種帶編號的欄位），讀它右邊那格當實際文字內容。兩個標籤
   各自獨立找，找不到就回傳null對應欄位，呼叫端會維持原本設定不動。 */
function parseARCell(rows){
  var variant = null, text = null;
  rows.forEach(function(row){
    if(!row) return;
    row.forEach(function(cell, c){
      if(cell === 'AR內容'){
        var v = row[c+1];
        if(v !== undefined && v !== null && v !== '') variant = _arMatchVariant(v);
      }
      if(cell === '文案'){
        var v2 = row[c+1];
        if(v2 !== undefined && v2 !== null && v2 !== '') text = String(v2).trim();
      }
    });
  });
  if(!variant) return null;
  var result = { variant: variant };
  if(variant === 'text' && text) result.text = text;
  return result;
}

/* ══════════════════ LOGO2 打勾判斷 ══════════════════
   ★這是我猜的欄位規則，還沒跟你確認過實際工單的儲存格長怎樣，先寫一個
   「找不到就當作有勾選（維持原來一定跳確認popup的行為，不會漏東西）」的
   保守版本——找「LOGO2」這個文字當錨點，看右邊那格：填了『V/✓/是/有/TRUE』
   這類看起來像「有勾選」的文字就算勾選，填『（空白）/0/false/否/無/unchecked』
   這類看起來像「沒勾選」的才算沒勾選；完全找不到「LOGO2」這個錨點文字，
   保守處理成「有勾選」（也就是行為不變，還是會跳確認popup），避免我猜錯
   欄位反而讓原本該跳出來的確認popup消失不見。
   如果實際工單不是這樣存（例如是用Excel內嵌的checkbox表單控制項，那個
   SheetXLSX/js讀不到，要用別的方式判斷；或是欄位/文字寫法不一樣），
   麻煩告訴我實際長怎樣，我再改這支函式就好，不用動其他地方。 */
/* 找「LOGO」這個標籤（實際工單長這樣：G欄='LOGO'、右邊一格=有沒有勾選
   （TRUE/FALSE）、再右邊一格=這次logo2要用哪個廠商/品牌的素材（例如
   "善存"）——這欄名稱正是拿去資料夾比對檔名用的，跟曝品表「商品1(左)」
   給實際商品名稱是同一個概念）。
   ★之前這裡找的是「LOGO2」三個字，但實際工單用的標籤是「LOGO」兩個字，
   一直找不到，才會退回預設值、也從來沒讀到廠商名稱——這是「工單有打勾
   +填名稱，LOGO2還是沒出現」的根本原因：不是沒偵測到勾選（勾選判斷的
   預設值本來就是true，這部分歪打正著沒出錯），而是根本沒有把"善存"這個
   名稱傳去資料夾比對，資料夾比對只能用「logo2/品牌logo/活動logo」這種
   通用猜測，猜不到含有"善存"的檔名。
   回傳 { checked, materialName }。 */
function parseLogo2Info(rows){
  for(var r=0; r<rows.length; r++){
    var row = rows[r];
    if(!row) continue;
    for(var c=0; c<row.length; c++){
      var cell = String(row[c]===undefined||row[c]===null?'':row[c]).trim();
      if(cell === 'LOGO' || cell === 'LOGO2'){
        var checkedVal = row[c+1];
        var checked = true;
        if(checkedVal !== undefined && checkedVal !== null && String(checkedVal).trim() !== ''){
          checked = !/^(0|false|no|否|無|unchecked|n)$/i.test(String(checkedVal).trim());
        }
        var nameVal = row[c+2];
        var materialName = (nameVal !== undefined && nameVal !== null && String(nameVal).trim() !== '')
          ? String(nameVal).trim() : null;
        return { checked: checked, materialName: materialName };
      }
    }
  }
  return { checked: true, materialName: null }; // 找不到這個標籤，保守當作有勾選、沒有指定廠商名稱
}

/* ══════════════════ 曝品表解析 ══════════════════
   工單裡長這樣（欄位相對位置固定，但實際在第幾欄/第幾列不用管，找到「曝品」
   這個字當錨點，其他都用相對位移去抓）：

     曝品      C組合(3品)        ← comboCol=找到「曝品」的那一欄，同一列右邊一格是目前選的組合文字
     人物1
     人物2
     商品1(左)  米大師-Photoroom        中     ← 名稱在曝品欄右邊1格，比例在右邊3格(中間隔了一個空欄)
     商品2(中)  【NEW CHOICE】堅果桶-Photoroom  中
     商品3(右)  微粉化一水肌酸-Photoroom        中

   回傳 { comboLetter, items:[{slot,name,ratio}] }（items只包含有填名稱的槽位，
   人物1/人物2沒填就不會出現在items裡） */
function parseExposureTable(rows){
  var kRow = -1, kCol = -1;
  for(var r=0; r<rows.length && kRow<0; r++){
    var row = rows[r];
    if(!row) continue;
    for(var c=0; c<row.length; c++){
      if(row[c] === '曝品'){ kRow = r; kCol = c; break; }
    }
  }
  if(kRow < 0) return null;

  var comboText = rows[kRow][kCol+1];
  var comboLetter = comboLabelToLetter(comboText);

  var items = [];
  for(var r2 = kRow+1; r2 < rows.length; r2++){
    var row2 = rows[r2];
    var slot = row2 && row2[kCol];
    if(slot === undefined || slot === null || slot === '') break; // 碰到空白列，這個表結束
    var name = row2[kCol+1];
    var ratioText = row2[kCol+3];
    if(name !== undefined && name !== null && String(name).trim() !== ''){
      items.push({
        slot: String(slot).trim(),
        name: String(name).trim(),
        ratio: ratioTextToScale(ratioText)
      });
    }
  }
  return { comboLetter: comboLetter, items: items };
}

/* 「A組合(2人)」「B組合(1人+2品)」「C組合(3品)」這種顯示文字 → 內部真正的字母代號
   （對照表就是 shadow-layout-defaults-circle.js 裡的 CIRCLE_COMBO_UI，同一份資料，
   不用在這裡重複維護一次規則） */
function comboLabelToLetter(text){
  if(!text || typeof window.CIRCLE_COMBO_UI === 'undefined') return null;
  var t = String(text).trim();
  var hit = window.CIRCLE_COMBO_UI.find(function(o){ return o.label === t; });
  return hit ? hit.value : null;
}

/* 商品比例文字轉成初始縮放倍率，給 LC_UPSERT_SLOT 的 ratio 參數用。
   對照表：大=120%、中=110%、小=70%。
   2026-08調整：中從100%調到110%——使用者反映「中」看起來可以再大一點，
   但不要蓋過「大」，所以取一個介於中間、還是明顯比大(120%)小的數字。
   同時：Excel「商品比例」欄位空白/看不懂時，直接回傳跟「中」一樣的值，
   不再回傳undefined——讓「沒特別寫」＝「中」是這支函式自己就講清楚的規則，
   不是靠upsertSlot()那邊「ratio不是數字就用1」的預設值巧合對上（之前
   中=100%的時候两边刚好都是1，這次中改成110%之後如果不修，沒填的商品會
   變成100%、跟「中」的110%對不起來，所以要在這裡一起改）。 */
var RATIO_MEDIUM = 1.1;
function ratioTextToScale(text){
  var t = String(text||'').trim();
  if(t === '大') return 1.2;
  if(t === '中') return RATIO_MEDIUM;
  if(t === '小') return 0.7;
  var num = parseFloat(t);
  if(!isNaN(num) && num>0) return num > 1 ? num/100 : num; // 容錯：填百分比數字(120)或小數(1.2)都認得
  return RATIO_MEDIUM; // 沒填/看不懂：預設當「中」處理
}

/* 用工單抓到的製作物名稱，對照 LAYOUT_REGISTRY，決定這個分頁要顯示哪些版位。
   用「關鍵字包含」比對而不是完全比對：工單常常寫「LPBN (APP、PC)」一項合併涵蓋
   APP版跟PC版兩個版位，所以每個版位配一個關鍵字，材料字串裡有出現關鍵字就算命中，
   一個材料項目命中多個版位是正常的（LPBN那項會同時點亮 11_lpbn_app 跟 12_lpbn_pc）。
   每個版位可以配「一組」關鍵字（陣列）：只要工單材料字串命中其中任何一個就算——
   MSBN是這次新加的版位，還不確定實際工單裡的「製作素材」欄位會寫成MSBN、
   還是FB貼文/FB Post這類別名，先多放幾個常見寫法保險，之後如果實際工單用的
   字眼不一樣，把它加進這個陣列就好，不用改filterLayoutsByMaterials()。
   ★ 用單字邊界(\b)比對而不是純substring：'AR'這種2個字母的短關鍵字，如果只用
   indexOf，材料字串裡只要出現任何含有連續AR字母的英文字（例如「DD Card」的
   CARD、或「Banner」都可能不小心命中'AR'/'BAN'這類短關鍵字），會誤判成
   「這個版位也有在工單裡」，實際上只是字母恰好連在一起。用\b邊界比對，只有
   關鍵字前後不是英數字時才算真的命中，同樣2個字/4個字的關鍵字("AR"/"HBN")
   都適用，不影響原本長一點的關鍵字("DD CARD"/"MSBN")的比對結果。 */
var LAYOUT_MATERIAL_KEYWORDS = {
  '11_lpbn_app': ['LPBN'],
  '12_lpbn_pc':  ['LPBN'],
  '03_c2c_bn':   ['HBN'],
  '04_ig':       ['IG', 'INSTAGRAM'],
  '05_ddcard':   ['DD CARD', 'DD'],
  '07_msbn':     ['MSBN', 'FB貼文', 'FB POST', 'FACEBOOK'],
  '08_coin_bn':  ['COIN', 'COIN BN', 'COIN PAGE', '金幣', '代幣'],
  '10_game_bn':  ['GAME BN', 'GAME', '遊戲'],
  'ar':          ['AR']
};
function _keywordHit(joined, kw){
  var esc = String(kw).toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 純中文關鍵字沒有\b邊界概念(regex \b只認英數字底線)，直接退回substring比對即可
  if(!/[A-Z0-9]/i.test(kw)) return joined.indexOf(kw.toUpperCase()) >= 0;
  return new RegExp('(^|[^A-Z0-9])' + esc + '($|[^A-Z0-9])').test(joined);
}
function filterLayoutsByMaterials(materials){
  if(!materials || !materials.length) return LAYOUT_REGISTRY.map(function(l){return l.id;});
  var joined = materials.join(' ').toUpperCase();
  var matched = LAYOUT_REGISTRY.filter(function(layout){
    var kws = LAYOUT_MATERIAL_KEYWORDS[layout.id] || [layout.name];
    return kws.some(function(kw){ return _keywordHit(joined, kw); });
  });
  return (matched.length ? matched : LAYOUT_REGISTRY).map(function(l){ return l.id; });
}

/* 依「製作素材」欄位裡實際列出的順序，決定版位要用什麼順序顯示/編號下載——
   不是用LAYOUT_REGISTRY自己內部寫死的順序（那個順序純粹是程式歷史上
   新增版位的先後，跟工單怎麼排列無關）。逐一比對每個材料項目命中哪些
   版位，依「材料項目出現的順序」把命中的版位id依序放進結果陣列（一個
   材料項目命中多個版位是正常的，例如「LPBN (APP、PC)」會同時命中
   11_lpbn_app跟12_lpbn_pc兩個，這兩個之間的先後就照LAYOUT_REGISTRY
   本身的順序決定，因為工單那一項本身沒有再細分先後）。
   材料清單裡沒提到、但仍然是活動中版位的（例如使用者手動額外勾選的），
   照LAYOUT_REGISTRY原本順序補在最後，不會憑空消失。 */
function mapMaterialsToLayoutOrder(materials, activeIds){
  var order = [];
  (materials||[]).forEach(function(m){
    var mUpper = String(m||'').toUpperCase();
    LAYOUT_REGISTRY.forEach(function(layout){
      if(order.indexOf(layout.id) !== -1) return; // 已經排過了
      if(activeIds.indexOf(layout.id) === -1) return; // 這次沒有要顯示這個版位
      var kws = LAYOUT_MATERIAL_KEYWORDS[layout.id] || [layout.name];
      if(kws.some(function(kw){ return _keywordHit(mUpper, kw); })) order.push(layout.id);
    });
  });
  // 材料清單沒提到、但仍在activeIds裡的版位，照LAYOUT_REGISTRY原順序補在最後
  LAYOUT_REGISTRY.forEach(function(layout){
    if(activeIds.indexOf(layout.id) !== -1 && order.indexOf(layout.id) === -1) order.push(layout.id);
  });
  return order;
}

/* ══════════════════ 素材資料夾比對 ══════════════════
   兩層比對策略，Excel有給「曝品表」的話優先用它（比較準，因為工單本來就
   明講了「商品1(左)」對到哪個實際商品名稱），沒有的話才退回用固定別名清單
   猜檔名（給只有資料夾、沒有Excel或Excel沒填曝品表的情況當備援）。 */

var SLOT_ALIASES = {
  logo1:      ['logo1','蝦皮直播','shopee_live','shopeelive','shopee-live','主辦logo','工單logo','店家logo'],
  logo2:      ['logo2','品牌logo','活動logo'],
  '人物1':    ['人物1','host1','主持人1','主持人'],
  '人物2':    ['人物2','host2','主持人2','來賓','guest'],
  '商品1(左)': ['商品1(左)','商品1','product1','p1'],
  '商品2(中)': ['商品2(中)','商品2','product2','p2'],
  '商品3(右)': ['商品3(右)','商品3','product3','p3']
};

/* 雙向模糊比對：檔名包含關鍵字、或關鍵字包含檔名，任一成立就算配對成功 */
function fuzzyMatch(base, keyword){
  base = base.toLowerCase().trim();
  keyword = keyword.toLowerCase().trim();
  if(!base || !keyword) return false;
  return base.indexOf(keyword) !== -1 || (keyword.length>=2 && base.length>=2 && keyword.indexOf(base)!==-1);
}

function matchFileByAliases(files, aliases){
  if(!files || !files.length) return null;
  for(var i=0;i<files.length;i++){
    var base = files[i].name.replace(/\.[^.]+$/,'');
    for(var j=0;j<aliases.length;j++){
      if(aliases[j] && fuzzyMatch(base, aliases[j])) return files[i];
    }
  }
  return null;
}

/* 資料夾裡一整批圖片檔案，逐一slot比對，回傳 {slotId: File}。
   exposureItems（來自Excel曝品表，可能是null）優先：每個item.name直接去資料夾裡
   模糊比對檔名（例如「米大師-Photoroom」對到「米大師-Photoroom.png」），
   比對到的slot就不再套用SLOT_ALIASES的通用猜測，避免被覆蓋掉。 */
function matchAssetFolder(files, exposureItems, extraAliases){
  var imageFiles = files.filter(function(f){ return /\.(png|jpe?g|webp)$/i.test(f.name); });
  var matched = {};
  var consumed = [];

  if(exposureItems && exposureItems.length){
    exposureItems.forEach(function(item){
      var remaining = imageFiles.filter(function(f){ return consumed.indexOf(f) === -1; });
      var f = matchFileByAliases(remaining, [item.name]);
      if(f){
        matched[item.slot] = f;
        consumed.push(f);
        /* 比例(大/中/小)也是Excel曝品表給的，直接掛在File物件上一起帶走，
           這樣呼叫端(editor-popups.js的proceedToShadowFromImport)不用另外
           再傳一份exposureItems進去對照，一個File物件就帶齊所有資訊 */
        if(item.ratio !== undefined) f.__importRatio = item.ratio;
      }
    });
  }

  /* extraAliases：工單裡明確指定「這次要用哪個廠商/品牌」的素材名稱
     （例如LOGO2那格填的"善存"，見parseLogo2Info()），比對優先權比
     exposureItems低、但比通用SLOT_ALIASES高——這是工單明確講的「這次
     真的要哪個檔案」，比「logo2/品牌logo」這種死板通用猜測準確很多，
     資料夾裡如果有檔名包含"善存"的圖片，這裡就能正確配到logo2。 */
  if(extraAliases){
    Object.keys(extraAliases).forEach(function(slotId){
      if(matched[slotId]) return;
      var names = extraAliases[slotId];
      if(!names || !names.length) return;
      var remaining = imageFiles.filter(function(f){ return consumed.indexOf(f) === -1; });
      var f = matchFileByAliases(remaining, names);
      if(f){ matched[slotId] = f; consumed.push(f); }
    });
  }

  Object.keys(SLOT_ALIASES).forEach(function(slotId){
    if(matched[slotId]) return; // Excel曝品表/extraAliases已經比對到了，不要被通用別名猜測蓋掉
    var remaining = imageFiles.filter(function(f){ return consumed.indexOf(f) === -1; });
    var f = matchFileByAliases(remaining, SLOT_ALIASES[slotId]);
    if(f){ matched[slotId] = f; consumed.push(f); }
  });

  return matched;
}
