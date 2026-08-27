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

/* ══════════════════ 多組「曝光日期」區塊 ══════════════════
   媽咪會員這種工單，一張Excel常常有「曝光日期1」「曝光日期2」...好幾個
   完整區塊，各自有自己的製作素材清單、文案、曝品表——對應到編輯器裡就是
   「各自開一頁」。這裡先掃出所有「曝光日期」列的位置，切成好幾段
   rows區間，每一段各自丟進parseRows()（跟以前單一區塊完全同一套邏輯，
   只是餵進去的rows換成切過的那一小段）。
   完全沒有「曝光日期」字樣的舊格式工單（例如原本蝦皮家居案），視為只有
   一個區塊（整份rows就是一段），行為跟以前一模一樣，不會壞掉。 */
function splitRowsIntoBlocks(rows){
  var starts = [];
  /* 目前遇過兩種區塊標記寫法：
     1) 蝦皮媽咪會員案：'曝光日期1'、'曝光日期2'...
     2) 蝦皮流行穿搭案：'A版'、'B版'...(單一英文字母+'版'，剛好對應下面
        「總製作內容」表格常見的A/B兩個版本案型)
     只精確比對這兩種格式，不要用太寬鬆的規則(例如只比對結尾是'版')，
     避免不小心把其他欄位的文字誤判成區塊標記。 */
  var BLOCK_MARKER = /^(曝光日期\d*|[A-Za-z]版)$/;
  for(var r=0;r<rows.length;r++){
    var cell = rows[r] && rows[r][0];
    if(typeof cell === 'string' && BLOCK_MARKER.test(cell.trim())){
      starts.push({ row:r, label: cell.trim() });
    }
  }
  if(!starts.length){
    return [{ label:null, rows: rows }];
  }
  var blocks = [];
  for(var i=0;i<starts.length;i++){
    var from = starts[i].row;
    var to = (i+1<starts.length) ? starts[i+1].row : rows.length;
    blocks.push({ label: starts[i].label, rows: rows.slice(from, to) });
  }
  return blocks;
}

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

        /* 順便抓工作項目名稱，拿來當分頁標籤的共同前綴 */
        var orderName = null;
        for(var r=0;r<rows.length;r++){
          if(rows[r] && rows[r][0]==='工作項目名稱'){ orderName = rows[r][1]; break; }
        }
        var baseName = orderName || file.name.replace(/\.xlsx?$/i,'');

        var rowBlocks = splitRowsIntoBlocks(rows);
        /* 有些工單（例如蝦皮流行穿搭案）的「曝品」表只會出現一次，寫在
           A版/B版...這些區塊標記之前，代表「所有區塊共用同一組商品」——
           不是每個區塊各自有一份曝品表(蝦皮媽咪會員案那種格式)。這裡先
           用完整的rows(不分區塊)掃一次，抓到「全域曝品表」當備援：
           每個區塊各自解析時，如果那個區塊自己的rows範圍內沒有找到曝品表
           (parsed.exposure是null)，就是這種「共用」情況，補上這份全域的。
           有找到自己專屬曝品表的區塊（媽咪會員案那種）不受影響，優先用
           自己的，這份全域備援只是補漏，不會蓋掉本來就有的。 */
        var globalExposure = parseExposureTable(rows);
        var msbnSlotNames = parseMsbnVersionSheet(wb, rows);

        var blocks = rowBlocks.map(function(rb){
          var parsed = parseRows(rb.rows);
          if(!parsed.exposure && globalExposure){
            parsed.exposure = globalExposure;
            /* 標記這個區塊的商品是「跟其他區塊共用同一份」，不是各自獨立
               廣播——runImport()看到這個標記，只會在第一個區塊真的跳出
               1200畫布讓使用者排商品，後面的區塊直接複製第一個區塊排好
               的結果，不用重複排一次一模一樣的商品。 */
            parsed.sharedExposure = true;
          }
          parsed.orderName = rb.label ? (baseName+'／'+rb.label) : baseName;
          parsed.exposureLabel = rb.label;
          /* baseName不帶區塊標記(例如'A版'/'曝光日期1')的純工作項目名稱——
             給整包下載的zip外層檔名用(見js/editor-export.js的downloadAll())。
             orderName(上面那個，含'／A版')是給分頁標籤/tooltip這些「需要
             分辨是哪個區塊」的地方用，兩個用途不一樣，各自留著各自的欄位，
             不要互相取代。 */
          parsed.baseName = baseName;
          return parsed;
        });

        resolve({ blocks: blocks, msbnSlotNames: msbnSlotNames });
      }catch(e){
        reject(e);
      }
    };
    reader.onerror = function(){ reject(new Error('檔案讀取失敗')); };
    reader.readAsBinaryString(file);
  });
}

/* ══════════════════ MSBN版本列表：品牌／LOGO素材名稱自動比對 ══════════════════
   三格(左/中/右)是三個獨立的素材，各自用各自的名稱去資料夾找檔案、各自
   放進去——就算三格剛好填的是同一個名稱(常見情況)，也是各自比對三次，
   不是比對一次共用同一張圖到三格。
   回傳固定形狀：{ MSBN1:{left,mid,right}, MSBN2:{...}, ... }，某一格
   沒有名稱資料就是空字串，呼叫端看到空字串會跳過那格、不強制比對。

   [新格式]（蝦皮家居-寢具重構後的工單）——獨立一個「MSBN版型列表」分頁，
   表格是：版本編號 | 使用版型 | 內容說明 | 對應檔名 | 備註。目前這張表
   「內容說明」只有一欄，沒有分左中右三欄——如果內容用「/」「、」「,」
   「｜」其中一種分隔符號寫了3段(例如"亞汀寢具/成媽/HOYACASA")，拆成三格
   各自的名稱；沒有分隔符號的話，同一個名稱各自套用到左中右三格(三格
   各自獨立比對，只是比對用的名稱字串相同)。之後如果這張表改成拆成3個
   獨立欄位，這裡改成直接讀3欄會更準。見parseMsbnVersionSheetV2()。

   [舊格式]（原本_美術需求_Circle_單一公版_MSBN.xlsx這種）——資料寫在
   「公版」分頁本身的【Layout】區塊裡：A欄是版本編號、下一列D欄＝左、
   G欄＝中、J欄＝右，三欄各自獨立讀取，不互相取代/備援。見
   parseMsbnVersionLegacy()。 */
function parseMsbnVersionSheetV2(wb){
  var sheetName = wb.SheetNames.find(function(name){
    return /msbn/i.test(name) && /(版型列表|版本列表)/.test(name);
  });
  if(!sheetName) return null;

  var ws = wb.Sheets[sheetName];
  var rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true});

  var headerRow = -1, colVersion = -1, colContent = -1;
  for(var r=0; r<rows.length; r++){
    var row = rows[r] || [];
    var vIdx = row.findIndex(function(c){ return typeof c === 'string' && c.trim() === '版本編號'; });
    if(vIdx >= 0){
      headerRow = r;
      colVersion = vIdx;
      colContent = row.findIndex(function(c){ return typeof c === 'string' && c.trim() === '內容說明'; });
      break;
    }
  }
  if(headerRow < 0 || colVersion < 0 || colContent < 0) return null;

  var map = {};
  for(var i=headerRow+1; i<rows.length; i++){
    var line = rows[i] || [];
    var version = line[colVersion];
    var content = line[colContent];
    if(typeof version !== 'string' || !version.trim()) continue;
    version = version.trim();
    if(!/^MSBN\d+$/i.test(version)) continue;
    if(typeof content !== 'string') continue;
    content = content.trim();
    if(!content || content.indexOf('範例') === 0) continue;

    var parts = content.split(/[\/、,｜|]/).map(function(s){ return s.trim(); }).filter(Boolean);
    var entry = (parts.length === 3)
      ? { left: parts[0], mid: parts[1], right: parts[2] }
      : { left: content, mid: content, right: content };
    map[version.toUpperCase()] = entry;
  }
  return Object.keys(map).length ? map : null;
}

function parseMsbnVersionLegacy(mainRows){
  if(!mainRows) return null;
  var map = {};
  for(var r=0; r<mainRows.length; r++){
    var cellA = mainRows[r] && mainRows[r][0];
    if(typeof cellA !== 'string' || !/^MSBN\d+$/i.test(cellA.trim())) continue;
    var version = cellA.trim().toUpperCase();
    var nameRow = mainRows[r+1] || [];
    var left  = (typeof nameRow[3] === 'string') ? nameRow[3].trim() : ''; // D欄
    var mid   = (typeof nameRow[6] === 'string') ? nameRow[6].trim() : ''; // G欄
    var right = (typeof nameRow[9] === 'string') ? nameRow[9].trim() : ''; // J欄
    if(left || mid || right) map[version] = { left: left, mid: mid, right: right };
  }
  return Object.keys(map).length ? map : null;
}

function parseMsbnVersionSheet(wb, mainRows){
  return parseMsbnVersionSheetV2(wb) || parseMsbnVersionLegacy(mainRows);
}

/* 材料項目清單，順便帶出每個項目自己的「內容」欄位值（'文案1'/'文案2'...），
   這是Excel明講的、最準的依據——比後面用'文案1'/'文案2'標記列去反推誰屬於
   哪一組更可靠，因為這欄就是工單本來就填給每個製作物項目的分組標籤。
   回傳 [{name, group}]，group沒填的話預設'文案1'（大部分工單只有一組，
   不會每列都特別填）。 */
function parseMaterialsWithGroup(rows){
  var matHeaderRow = -1;
  for(var r=0; r<rows.length; r++){
    if(rows[r] && rows[r][0] === '製作素材'){ matHeaderRow = r; break; }
  }
  var items = [];
  if(matHeaderRow >= 0){
    for(var r2 = matHeaderRow+1; r2 < rows.length; r2++){
      var row = rows[r2];
      var cellA = row && row[0];
      if(cellA === undefined || cellA === null || cellA === '') break;
      var groupCell = row[4]; // 內容欄（'文案1'/'文案2'）
      var group = (typeof groupCell === 'string' && groupCell.trim()) ? groupCell.trim() : '文案1';
      items.push({ name: String(cellA).trim(), group: group });
    }
  }
  return items;
}

/* 標題/副標/日期 這幾個標籤在Excel裡是「掃到哪個文案組標記列(精確等於
   '文案1'或'文案2'這種字串、右邊格是空的，純粹當分隔標記用)之後才算歸屬
   哪一組」，跟AR自己的'文案'(無編號)標籤是不同東西、不會互相干擾。
   掃描時預設從'文案1'開始（大部分工單只有一組，整份區塊都沒出現分組
   標記列也完全正常，全部歸在'文案1'）。 */
function parseTextGroups(rows){
  var textGroups = { '文案1': {} };
  var currentGroup = '文案1';
  var LABELS = ['標題','副標','日期','AR文案'];
  var GROUP_MARKER = /^文案\d+$/;

  rows.forEach(function(row){
    if(!row) return;
    row.forEach(function(cell, c){
      if(typeof cell === 'string' && GROUP_MARKER.test(cell.trim())){
        var next = row[c+1];
        /* 右邊格有值的話，那是「標題/副標/日期」表頭列本身寫的'文案1'
           (例如製作素材表頭那列)，不是分組切換標記，不要誤判成切換。
           只有右邊格是空的，才是「接下來的標籤都歸這組」的切換標記。 */
        if(next === undefined || next === null || next === ''){
          currentGroup = cell.trim();
          if(!textGroups[currentGroup]) textGroups[currentGroup] = {};
        }
        return;
      }
      if(LABELS.indexOf(cell) >= 0){
        var val = row[c+1];
        if(val !== undefined && val !== null && val !== ''){
          textGroups[currentGroup][cell] = String(val).trim();
        }
      }
    });
  });
  return textGroups;
}

function parseRows(rows){
  var materialItems = parseMaterialsWithGroup(rows);
  var materials = materialItems.map(function(it){ return it.name; });
  var textGroups = parseTextGroups(rows);
  var logoInfo = null;

  rows.forEach(function(row){
    if(!row) return;
    row.forEach(function(cell, c){
      if(cell === 'LOGO'){
        /* ★只在緊接著的2格內找字串當logo名稱，不要無界掃到整列結尾——
           這一列'LOGO'標籤右邊通常是2格版本勾選(活動LOGO/店家LOGO的
           true/false)，範圍抓大會不小心掃到同一列右邊「曝品」表格本身
           的內容(例如'人物1'這種槽位名稱)，誤判成logo名稱。 */
        for(var k=c+1; k<=c+2 && k<row.length; k++){
          if(typeof row[k] === 'string' && row[k].trim()){ logoInfo = row[k].trim(); break; }
        }
      }
    });
  });

  var exposure = parseExposureTable(rows);
  var logo2Info = parseLogo2Info(rows);
  var arInfo = parseARCell(rows);

  return {
    materials: materials,
    materialItems: materialItems, // [{name, group}]，給layoutTextGroup比對用
    textGroups: textGroups,
    logoInfo: logoInfo,
    exposure: exposure,
    logo2Checked: logo2Info.checked,
    logo2MaterialName: logo2Info.materialName,
    arInfo: arInfo
  };
}

/* 依每個材料項目自己的group標籤(materialItems)，比對出每個版位(layoutId)
   要吃哪一組文案——沿用跟filterLayoutsByMaterials()同一份關鍵字比對表，
   一個材料項目命中多個版位時（例如「LPBN (APP、PC)」同時命中app/pc兩個
   版位），這兩個版位都歸同一組（因為Excel本來就只給這個材料項目寫一組）。 */
function mapMaterialGroupsToLayouts(materialItems, activeIds){
  var result = {};
  (materialItems||[]).forEach(function(item){
    var mUpper = String(item.name||'').toUpperCase();
    LAYOUT_REGISTRY.forEach(function(layout){
      if(activeIds.indexOf(layout.id) === -1) return;
      if(result[layout.id]) return; // 已經有比對到的項目決定過了，不重複覆蓋
      var kws = LAYOUT_MATERIAL_KEYWORDS[layout.id] || [layout.name];
      if(kws.some(function(kw){ return _keywordHit(mUpper, kw); })) result[layout.id] = item.group;
    });
  });
  // 沒被任何材料項目提到、但仍在activeIds裡的版位，預設歸'文案1'
  LAYOUT_REGISTRY.forEach(function(layout){
    if(activeIds.indexOf(layout.id) !== -1 && !result[layout.id]) result[layout.id] = '文案1';
  });
  return result;
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

/* ══════════════════ 版位「實例」清單（支援同一版位在同一頁出現兩次） ══════════════════
   媽咪會員案新增需求：同一頁裡「HBN(週三特殊案型)」需要跟普通HBN各自輸出
   一張獨立的圖(同樣1200x360規格，但文案不同)。原本「一個layoutId=一張畫布」
   的假設不夠用了，這裡改成走「實例(instance)」清單：依「製作素材」欄位出現
   的順序，逐一決定每個材料項目命中哪個版位——第一次命中某個layoutId，
   instanceId就是那個layoutId本身(跟以前行為一模一樣，不影響現有大多數
   只有單一實例的分頁)；同一個layoutId如果被命中第二次(例如這裡的HBN)，
   就額外生成一個新的instanceId(layoutId+'__2'、'__3'...)，重用同一份
   configFile(畫布尺寸/版型排版完全相同，只有文案/背景檔名需要各自查)，
   label用該材料項目原本的名稱(例如'HBN (週三特殊案型)')當作畫布標題跟
   下載檔名的依據，讓使用者一眼分得出哪張是哪個版本。
   回傳 { instances:[{instanceId,layoutId,label,textGroup}], aliasBase:{instanceId->layoutId} }
   ——aliasBase給呼叫端(editor-main.js)拿去動態註冊LAYOUT_REGISTRY用，
   同時也讓background-module.js/mask-module.js/editor-export.js的匯出格式
   規則能透過同一份對照表fallback回真正的layoutId，不用改動這幾個模組
   原本「用layoutId查表」的邏輯。 */
function buildLayoutInstancesFromMaterials(materialItems, activeIds){
  var instances = [];
  var seenLayoutIds = {};
  var aliasBase = {};
  var dupCounters = {};

  (materialItems||[]).forEach(function(item){
    var mUpper = String(item.name||'').toUpperCase();
    LAYOUT_REGISTRY.forEach(function(layout){
      if(activeIds.indexOf(layout.id) === -1) return;
      var kws = LAYOUT_MATERIAL_KEYWORDS[layout.id] || [layout.name];
      if(!kws.some(function(kw){ return _keywordHit(mUpper, kw); })) return;

      if(!seenLayoutIds[layout.id]){
        seenLayoutIds[layout.id] = true;
        instances.push({ instanceId: layout.id, layoutId: layout.id, label: null, textGroup: item.group });
      } else {
        dupCounters[layout.id] = (dupCounters[layout.id] || 1) + 1;
        var instanceId = layout.id + '__' + dupCounters[layout.id];
        aliasBase[instanceId] = layout.id;
        instances.push({ instanceId: instanceId, layoutId: layout.id, label: item.name, textGroup: item.group });
      }
    });
  });

  // 材料清單沒提到、但仍在activeIds裡的版位(理論上少見)，照LAYOUT_REGISTRY原順序補在最後，預設歸'文案1'
  LAYOUT_REGISTRY.forEach(function(layout){
    if(activeIds.indexOf(layout.id) !== -1 && !seenLayoutIds[layout.id]){
      seenLayoutIds[layout.id] = true;
      instances.push({ instanceId: layout.id, layoutId: layout.id, label: null, textGroup: '文案1' });
    }
  });

  return { instances: instances, aliasBase: aliasBase };
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
