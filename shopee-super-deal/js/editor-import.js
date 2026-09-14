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
   一個區塊（整份rows就是一段），行為跟以前一模一樣，不會壞掉。

   2026-08修正（媽咪會員日工單發現的問題）：原本只認A欄文字「開頭是
   '曝光日期'」這一種寫法當作區塊分界，但媽咪會員日這份工單的區塊標籤
   直接寫日期區間（例如'7/1-7/15'、'7/16-7/31'），不是'曝光日期'開頭，
   完全比對不到，整份Excel被當成「只有1個區塊」，兩組曝光日期的內容
   （文案、曝品）全部混在一起讀，變成只開1個分頁、也不會跳出第二組的
   商品確認popup。

   改成不管標籤文字寫法是什麼，一律用「製作素材」表頭列的數量+位置來
   判斷有幾個區塊——每個「製作素材」表頭正上方那一列的文字，就是這個
   區塊的標籤（不管它寫的是'曝光日期1'還是'7/1-7/15'都一樣抓得到），
   這個表頭本身在整份範本裡本來就是每個區塊固定會有、且只會出現一次的
   穩定錨點，比比對標籤文字本身的寫法可靠。只有1個（或0個）「製作素材」
   表頭時，維持舊行為：整份rows當一個區塊、不切割，避免破壞舊格式工單
   （沒有清楚日期標籤列、或版面跟這裡假設的不完全一樣）原本能正常運作
   的匯入結果。 */
function splitRowsIntoBlocks(rows){
  var matHeaderRows = [];
  for(var r=0;r<rows.length;r++){
    if(rows[r] && rows[r][0] === '製作素材') matHeaderRows.push(r);
  }

  if(matHeaderRows.length <= 1){
    /* 只有一組（或找不到「製作素材」表頭）：整份rows當一個區塊，label
       盡量從表頭正上方那一列抓（抓不到就維持null，跟以前行為一致）。 */
    var singleLabel = null;
    if(matHeaderRows.length === 1){
      var aboveSingle = rows[matHeaderRows[0]-1];
      if(aboveSingle && typeof aboveSingle[0] === 'string' && aboveSingle[0].trim()){
        singleLabel = aboveSingle[0].trim();
      }
    }
    return [{ label: singleLabel, rows: rows }];
  }

  /* 2個以上「製作素材」表頭：真的有多組區塊，用每個表頭正上方那一列的
     文字當這個區塊的標籤（'曝光日期1'、'7/1-7/15'都適用，不限定文字
     格式）。第一個區塊的切割起點維持從整份rows最上面開始（row 0），
     不從標籤列切，這樣「工作項目名稱」「總製作內容」這些整份Excel共用
     的頂部資訊還是會包含在第一個區塊裡，跟以前只有1個區塊時能讀到的
     範圍一致，不會突然讀不到。 */
  var starts = matHeaderRows.map(function(h, idx){
    var labelRow = h - 1;
    var above = rows[labelRow];
    var label = (above && typeof above[0] === 'string' && above[0].trim()) ? above[0].trim() : null;
    return { row: (idx === 0) ? 0 : labelRow, label: label };
  });

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
        var blocks = rowBlocks.map(function(rb){
          var parsed = parseRows(rb.rows);
          /* 2026-08修正：orderName不再把曝光日期label(rb.label)用'／'接在
             後面——原本這樣接的用意是讓每個分頁的tab.data.label各自不同、
             方便debug時分辨，但這個值同時也被js/editor-export.js的
             downloadAll()拿去當zip外層檔名，導致下載出來的zip檔名變成
             「案名／7_1-7_15.zip」這種，使用者反映外層zip檔名只需要案名本身
             (baseName)，不需要曝光日期。曝光日期資訊完全不會遺失——
             parsed.exposureLabel這個獨立欄位還在，畫面上分頁按鈕顯示的
             文字、zip內部子資料夾命名都是各自讀這個欄位，不受這裡影響。 */
          parsed.orderName = baseName;
          parsed.exposureLabel = rb.label;
          return parsed;
        });

        resolve({ blocks: blocks });
      }catch(e){
        reject(e);
      }
    };
    reader.onerror = function(){ reject(new Error('檔案讀取失敗')); };
    reader.readAsBinaryString(file);
  });
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
      var groupCell = row[4]; // 內容欄（'文案1'/'文案2'）——只有明確符合這個格式才當分組標記，
                               // 其他值(例如'公版'欄A/B版本標記剛好也落在同一個欄位)一律當作
                               // 沒填，退回預設'文案1'，不要被公版A/B誤判成文案分組
                               // （2026-08發現：媽咪會員日這份工單的公版A/B欄位剛好也在
                               // 第5欄(index4)，跟這裡原本假設的「文案分組」欄位撞欄，
                               // LPBN那列公版寫'A'，沒加這個規則的話會被誤判成
                               // group:'A'，變成一個根本不存在的文案組，導致LPBN抓不到
                               // 標題/副標(textGroups裡只有'文案1'這個key，'A'這個key是空的)）。
      var group = (typeof groupCell === 'string' && /^文案\d+$/.test(groupCell.trim())) ? groupCell.trim() : '文案1';
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
  var LABELS = ['標題','副標','日期','AR文案','SKBN案型','第1張(後)','第2張(前)','票券1'];
  /* 有些工單格式會用不同的名稱寫同一個欄位(例如「超划算-藍_券.xlsx」這份
     工單，AR的欄位標籤寫的是「AR內容」，不是「AR文案」)——這裡對照回
     內部統一使用的key，讀到別名一樣會存進canonical那個key，
     ar-module.js/text-module.js完全不用知道有這個別名存在。之後如果
     再遇到類似的欄位名稱落差，直接在這裡加一行對照就好，不用改下面的
     比對邏輯。 */
  var LABEL_ALIASES = { 'AR內容': 'AR文案' };
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
      var canonicalKey = LABEL_ALIASES[cell] || (LABELS.indexOf(cell) >= 0 ? cell : null);
      if(canonicalKey){
        var val = row[c+1];
        if(val !== undefined && val !== null && val !== ''){
          textGroups[currentGroup][canonicalKey] = String(val).trim();
        }
      }
    });
  });

  /* 2026-09新增：08_popup(Popup)版位的「票券1」文案，工單裡沒有獨立的
     標籤——使用者確認這格內容應該直接沿用「第1張(後)」(1200畫布券樣
     popup那組券金額文字之一，例如'$500')，不是另外找一個獨立欄位填。
     這裡在每一組(文案1/文案2...)各自結算完後，補上這個衍生規則：
     有「第1張(後)」就讓「票券1」直接等於它(蓋掉可能誤抓到的其他值)，
     維持POPUP的券樣文字永遠跟1200畫布的券金額一致，不用使用者另外
     在Excel多寫一欄。 */
  Object.keys(textGroups).forEach(function(group){
    if(textGroups[group]['第1張(後)']){
      textGroups[group]['票券1'] = textGroups[group]['第1張(後)'];
    }
  });

  return textGroups;
}

/* ══════════════════ 公版版本（A版／B版）══════════════════
   2026-08新增，2026-08再修正（媽咪會員日工單發現的真實欄位格式）：
   實際工單裡「公版」是「製作素材」表頭那一列的其中一個欄位標題（不是
   A欄的列標籤），每個材料項目自己那一列、同一欄位才是實際填的A/B值——
   例如LPBN那一列在「公版」欄填'A'，其他版位那幾列這一欄通常是空的。
   這裡先動態找出「公版」欄位在第幾欄(不寫死欄位編號，避免欄位順序以後
   調整就讀錯)，再往下掃材料清單各列，抓到第一個有填值的就當這個區塊的
   版本。

   保留舊的兩種比對方式當備援（找不到「公版」欄位標頭時才會用到）：
     1. 某一列A欄是'公版'或'版本'，同一列右邊格子裡直接寫'A'/'B'
     2. 某一列A欄本身就是'A版'或'B版'這種字串
   三種都抓不到就回傳null（呼叫端維持預設'A'，使用者也可以在畫面上
   手動用右側「公版版本」下拉選單再調整，不會卡住）。 */
function parseTemplateVersion(rows){
  /* 方式0（蝦皮超划算工單格式）：找「版型」這個欄位標頭，往下找第一個
     填了'紅'或'藍'的儲存格——這份工單顏色版本是直接寫顏色字（不是A/B），
     紅＝'A'、藍＝'B'，對應規則見backgrounds/README.txt跟configs/theme.json
     的說明。這個欄位在工單裡通常整欄合併(同一頁全部banner共用同一個顏色)，
     只要抓到第一個非空值就好，不用管合併儲存格本身怎麼存(openpyxl/xlsx.js
     讀合併儲存格時，非左上角的cell本來就會是undefined，這裡本來就只認
     「第一個有值的cell」，天生就跟合併儲存格相容，不用特別處理)。 */
  for(var r0=0; r0<rows.length; r0++){
    var row0 = rows[r0];
    if(!row0) continue;
    for(var c0=0; c0<row0.length; c0++){
      if(row0[c0] === '版型'){
        for(var r0b=r0+1; r0b<rows.length; r0b++){
          var v0 = rows[r0b] && rows[r0b][c0];
          if(v0 === undefined || v0 === null || v0 === '') continue;
          var vt0 = String(v0).trim();
          if(vt0 === '紅') return 'A';
          if(vt0 === '藍') return 'B';
          break; // 這欄第一個非空值不是紅/藍(可能是別種工單格式借用同一個標籤字)，不繼續往下找，改走方式1/2/3備援
        }
        break;
      }
    }
  }

  /* 方式1（實際工單真實格式）：「製作素材」表頭列裡找「公版」這個欄位標題，
     往下掃同一欄，材料清單結束(A欄出現空白)就停止。 */
  var matHeaderRow = -1, verColIdx = -1;
  for(var r=0; r<rows.length; r++){
    if(rows[r] && rows[r][0] === '製作素材'){
      matHeaderRow = r;
      for(var c=0; c<rows[r].length; c++){
        if(rows[r][c] === '公版'){ verColIdx = c; break; }
      }
      break;
    }
  }
  if(matHeaderRow >= 0 && verColIdx >= 0){
    for(var r2 = matHeaderRow+1; r2 < rows.length; r2++){
      var row2 = rows[r2];
      var cellA2 = row2 && row2[0];
      if(cellA2 === undefined || cellA2 === null || cellA2 === '') break; // 材料清單結束
      var v = row2[verColIdx];
      if(typeof v === 'string' && v.trim()){
        var vt = v.trim();
        if(/^A/.test(vt)) return 'A';
        if(/^B/.test(vt)) return 'B';
      }
    }
  }

  /* 方式2／3（備援，舊格式假設）：A欄本身是標籤列。 */
  for(var r3=0; r3<rows.length; r3++){
    var row3 = rows[r3];
    if(!row3) continue;
    var cellA3 = row3[0];
    if(typeof cellA3 !== 'string') continue;
    var trimmed3 = cellA3.trim();

    if(trimmed3 === '公版' || trimmed3 === '版本'){
      for(var c3=1; c3<row3.length; c3++){
        var v3 = row3[c3];
        if(typeof v3 !== 'string') continue;
        var vt3 = v3.trim();
        if(/^A/.test(vt3)) return 'A';
        if(/^B/.test(vt3)) return 'B';
      }
    }
    if(/^A版/.test(trimmed3)) return 'A';
    if(/^B版/.test(trimmed3)) return 'B';
  }
  return null;
}

/* ══════════════════ 站內BN 版位清單解析(A欄+K數欄) ══════════════════
   蝦皮超划算的站內工單，A欄從上到下列出這次案子「所有可能」的版位
   （01_C2C HBN、02_LPBN_APP...一路到11_AR），不是每次都全部要做——
   K數那欄(A欄右邊第2格)填'X'代表這次不需要這個版位，填實際的KB限制
   （245KB、<150KB這種）才代表真的要做。
   一個版位名稱可能對應到LAYOUT_REGISTRY裡不只一個layoutId（例如
   '01_C2C HBN'同時對應kv_coupon跟kv_product——工單上是同一個廣告
   版位，券樣/商品只是製作時的兩種執行方式，不是工單上會分開列的兩行）；
   也可能好幾列(07_Skinny BN APP_1/_2/_3)其實對應同一個layoutId
   （skinny_app，只要去掉結尾的_數字，都是同一個版位的3張輸出）。
   目前只登記已經真的建置的版位(kv_coupon/kv_product/skinny_app/
   skinny_pc)，其他還沒做的(02_LPBN_APP、03_DD Banner Card...)先不
   放進對照表——比對不到的列會被忽略，不影響其他已知列的判斷，之後
   真的把某個版位做出來，在下面ROW_TO_LAYOUTS加一行對照就好，不用改
   這支函式的其他部分。
   回傳layoutId陣列(可能是空陣列，代表這次全部都是X/都不需要)；如果
   整份rows完全找不到任何一列對得上ROW_TO_LAYOUTS(例如舊格式工單、
   或欄位排列完全不一樣)，回傳null，呼叫端會知道要退回舊的
   filterLayoutsByMaterials()備援邏輯，不會誤判成「這次全部都不用做」。 */
/* ══════════════════ 站內BN 版位清單解析 ══════════════════
   2026-09先做了一版「K數欄='X'代表這次不需要這個版位」的偵測邏輯，後來
   跟使用者確認：X其實只代表「這個格式沒有明確的K數上限規定」，跟這次
   要不要做完全無關——這份「站內BN」清單本來就是固定的完整版位對照表，
   不是每次工單勾選增減的清單。所以拿掉X排除的判斷，這支函式先保留但
   不再影響「哪些版位要顯示」，一律讓呼叫端(buildTabDataFromParsedBlock)
   退回filterLayoutsByMaterials()的「沒有勾選清單就全部顯示」備援邏輯，
   要減少版位改用畫面上的「追加版位」手動勾選，不要靠Excel自動判斷。 */
function parseActiveLayoutsFromBannerList(rows){
  return null; // 2026-09起固定回傳null，見上面說明；不要再依賴這支函式的偵測結果
}

/* ══════════════════ 曝品樣式(商品/優惠券) ══════════════════
   蝦皮超划算工單裡，每個banner列(01_C2C HBN...)的版型(顏色)欄位右邊
   緊接著一欄「曝品」，值是'商品'或'優惠券'(不是同一列右邊那個「曝品」
   商品清單表頭，那是另一個獨立的表格，見parseExposureTable()的錨點
   判斷說明)——這裡專門找「版型」正右邊那一欄，才不會抓錯。
   回傳'product'或'coupon'，抓不到就回傳null(呼叫端維持預設'product')。 */
function parseExposureStyleFromVersionColumn(rows){
  for(var r=0; r<rows.length; r++){
    var row = rows[r];
    if(!row) continue;
    for(var c=0; c<row.length; c++){
      if(row[c] === '版型' && row[c+1] === '曝品'){
        for(var r2=r+1; r2<rows.length; r2++){
          var v = rows[r2] && rows[r2][c+1];
          if(v === undefined || v === null || v === '') continue;
          var vt = String(v).trim();
          if(vt === '商品') return 'product';
          if(vt === '優惠券' || vt === '券樣') return 'coupon';
          break; // 第一個非空值看不懂，不繼續往下找
        }
        return null;
      }
    }
  }
  return null;
}

/* ══════════════════ DD Card 無LOGO標記(新工單格式) ══════════════════
   2026-09新增：舊格式是從「製作素材」清單的材料名稱裡找「無LOGO」字樣
   (_hasNoLogoMarker)，但蝦皮超划算這份新工單沒有那種清單。改成直接找
   A欄「03_DD Banner Card」那一列，同一列裡任何一格只要出現「無LOGO」
   字樣(全形/半形括號、有沒有空格都認得，沿用跟舊格式一樣的正則)，就
   算這次要用無LOGO版——使用者可以直接在那一列任何一個空白欄位打
   「無LOGO」三個字做標記，不用照特定欄位填。
   回傳true(要用無LOGO版)/false(一般有LOGO版，預設)/null(整份工單完全
   找不到DD Banner Card這一列，例如舊格式工單，呼叫端會保留兩個版位
   都顯示，交由使用者自己用「追加版位」勾選，不強制二選一)。 */
function parseDDCardNoLogoMarker(rows){
  var NO_LOGO_RE = /無\s*LOGO/i;
  for(var r=0; r<rows.length; r++){
    var row = rows[r];
    if(!row) continue;
    var label = row[0];
    if(typeof label !== 'string') continue;
    if(label.trim().toUpperCase().indexOf('DD BANNER CARD') === -1) continue;
    // 找到DD Banner Card這一列，掃這一整列(含合併儲存格延伸出去的欄位)找標記
    var hit = row.some(function(cell){ return typeof cell === 'string' && NO_LOGO_RE.test(cell); });
    return hit;
  }
  return null;
}

/* ══════════════════ 站內BN清單(A欄列出的就是這次要做的版位) ══════════════════
   2026-09新增：蝦皮超划算這份新格式工單，沒有舊格式那種「製作素材」清單
   (parseMaterialsWithGroup()靠找一列A欄剛好等於'製作素材'的標記列，這份
   新格式根本沒有這個標記，找不到東西可以比對，materialItems會是空陣列)。
   materialItems是空的時候，filterLayoutsByMaterials()「有比對到才顯示，
   比對不到就顯示全部」的退路邏輯會直接顯示LAYOUT_REGISTRY全部——這正是
   使用者實際回報「工單根本沒寫game bn，畫面卻自動出現」的根本原因，不是
   關鍵字比對錯誤，是materialItems從頭就是空的，整個退回「全部顯示」。

   這份新格式的「站內BN」清單，A欄列出的項目名稱本身就是「這次要做的
   版位清單」——有寫在A欄就是要做。
   ★ 2026-08(使用者澄清)：C欄(K數)的內容(包含填'X'的那些)只是這個素材
   本身有沒有KB大小限制的說明，跟「這次要不要做」完全無關；使用者匯出
   時的KB上限是另外設定好的(js/editor-export.js的EXPORT_SIZE_LIMIT_KB)，
   不需要也不應該照這份工單的K數欄位去判斷要不要做這個版位——之前的版本
   誤把'X'當成「不用做」的標記，已經移除這個判斷，這裡只看A欄有沒有值。

   回傳[{name,group:'文案1'}]（A欄所有列出的項目，格式故意跟
   parseMaterialsWithGroup()回傳的items一樣，讓filterLayoutsByMaterials()
   /mapMaterialGroupsToLayouts()/buildLayoutInstancesFromMaterials()這些
   既有函式可以直接吃，不用另外改）；找不到「站內BN」這個標記列就回傳
   null，呼叫端(parseRows())會知道要退回舊格式的parseMaterialsWithGroup()
   判斷，兩種工單格式都吃得下。 */
function parseSiteInsideActiveList(rows){
  var startRow = -1;
  for(var r=0; r<rows.length; r++){
    if(rows[r] && rows[r][0] === '站內BN'){ startRow = r; break; }
  }
  if(startRow < 0) return null;

  var headerRow = -1;
  for(var r2 = startRow+1; r2 < Math.min(rows.length, startRow+5); r2++){
    if(rows[r2] && rows[r2][0] === '尺寸'){ headerRow = r2; break; }
  }
  if(headerRow < 0) return null; // 有「站內BN」標記但找不到緊接著的表頭列，格式跟預期不符，安全起見退回舊邏輯

  var items = [];
  for(var r3 = headerRow+1; r3 < rows.length; r3++){
    var row = rows[r3];
    var label = row && row[0];
    if(label === undefined || label === null || String(label).trim() === '') break; // A欄空白＝清單結束
    items.push({ name: String(label).trim(), group: '文案1' }); // A欄有寫就是要做，不看C欄K數
  }
  return items;
}

function parseRows(rows){
  /* 新格式(有「站內BN」K數欄位可以判斷要不要做)優先；沒有的話(舊格式
     工單、或這份根本不是這個版型)退回原本靠「製作素材」清單比對的邏輯，
     兩種工單格式都吃得下，見parseSiteInsideActiveList()的完整說明。 */
  var materialItems = parseSiteInsideActiveList(rows) || parseMaterialsWithGroup(rows);
  var materials = materialItems.map(function(it){ return it.name; });
  var textGroups = parseTextGroups(rows);
  var templateVersion = parseTemplateVersion(rows);
  var exposureStyle = parseExposureStyleFromVersionColumn(rows);
  var ddcardNoLogo = parseDDCardNoLogoMarker(rows);
  var activeLayoutIdsFromBannerList = parseActiveLayoutsFromBannerList(rows);
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
    templateVersion: templateVersion, // 'A'/'B'/null(工單沒指定，維持預設'A'，使用者可在畫面上再調整)
    exposureStyle: exposureStyle, // 'product'/'coupon'/null(工單沒指定，維持預設'product')
    ddcardNoLogo: ddcardNoLogo, // true/false/null，見parseDDCardNoLogoMarker()說明
    logoInfo: logoInfo,
    exposure: exposure,
    activeLayoutIdsFromBannerList: activeLayoutIdsFromBannerList, // 站內BN清單(A欄+K數)算出來的版位清單，null代表這份工單沒有這種清單格式
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
  return { checked: false, materialName: null }; // 整份工單找不到「LOGO」這個標記欄位——沒有勾選機制，代表這次不需要logo2，不要無中生有跳出編輯popup（舊格式工單如果真的有這個欄位，會在上面迴圈裡找到，走欄位裡實際的勾選值，不會受這裡影響）
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

   2026-09新增：蝦皮超划算工單在比例欄位右邊又接了原價／標價兩欄（給小標
   用），格式像這樣（曝品欄右邊分別是+1名稱／+3比例／+4原價／+5標價）：

     商品1(左)  咖啡  中  $156/4入  $85/4入

   comboText欄位這次的工單是空的（蝦皮超划算的商品版固定都是3品，沒有
   人物，工單不需要特別寫組合文字）——comboLetter抓不到時，呼叫端
   （js/editor-popups.js的proceedToShadowFromImport）本來就有退回
   guessComboFromMatchedSlots()的機制，不用在這裡特別處理。

   回傳 { comboLetter, items:[{slot,name,ratio,originalPrice,salePrice}] }
   （items只包含有填名稱的槽位，人物1/人物2沒填就不會出現在items裡；
   originalPrice/salePrice沒填就是空字串，不影響現有只看name/ratio的
   呼叫端，是新增欄位不是取代） */
function parseExposureTable(rows){
  /* ★找錨點不能「抓到第一個就停」——蝦皮超划算工單同一個表頭列(row14)裡
     有兩個'曝品'文字：一個是每個banner自己的曝品類型欄(值是'商品'/'優惠券'
     這種字，跟版型D:E欄合併在一起)，另一個才是真正的商品曝光表頭(下面
     接商品1(左)/商品2(中)/商品3(右)這幾列)。如果抓到前者，下面掃到的
     內容(合併儲存格造成大多是undefined)會被誤判成「這個表是空的」，
     真正的商品資料(在後面那個'曝品'底下)整個漏讀。
     改成：掃過全部'曝品'文字出現的位置，逐一檢查「正下方那一列、同一欄」
     是不是合法的槽位名稱(商品1(左)/商品2(中)/商品3(右)/人物1/人物2)，
     只有真的接著槽位列的那個才當作正確錨點；都對不到才退回舊行為(抓
     第一個)，維持對舊格式工單的相容性。 */
  var KNOWN_SLOTS = ['人物1','人物2','商品1(左)','商品2(中)','商品3(右)'];
  var candidates = [];
  for(var r=0; r<rows.length; r++){
    var row = rows[r];
    if(!row) continue;
    for(var c=0; c<row.length; c++){
      if(row[c] === '曝品') candidates.push({ row:r, col:c });
    }
  }
  if(!candidates.length) return null;

  var best = candidates.find(function(cand){
    var below = rows[cand.row+1];
    var v = below && below[cand.col];
    return typeof v === 'string' && KNOWN_SLOTS.indexOf(v.trim()) !== -1;
  }) || candidates[0]; // 都對不到槽位列，退回第一個(維持舊格式工單原本的行為)

  var kRow = best.row, kCol = best.col;
  var comboText = rows[kRow][kCol+1];
  var comboLetter = comboLabelToLetter(comboText);

  var items = [];
  for(var r2 = kRow+1; r2 < rows.length; r2++){
    var row2 = rows[r2];
    var slot = row2 && row2[kCol];
    if(slot === undefined || slot === null || slot === '') break; // 碰到空白列，這個表結束
    var name = row2[kCol+1];
    var ratioText = row2[kCol+3];
    var originalPriceText = row2[kCol+4];
    var salePriceText = row2[kCol+5];
    if(name !== undefined && name !== null && String(name).trim() !== ''){
      items.push({
        slot: String(slot).trim(),
        name: String(name).trim(),
        ratio: ratioTextToScale(ratioText),
        originalPrice: (originalPriceText!==undefined && originalPriceText!==null) ? String(originalPriceText).trim() : '',
        salePrice: (salePriceText!==undefined && salePriceText!==null) ? String(salePriceText).trim() : ''
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
var RATIO_MEDIUM = 0.9431125; // 中：再-5%
function ratioTextToScale(text){
  var t = String(text||'').trim();
  if(t === '大') return 1.02885; // 再-5%
  if(t === '中') return RATIO_MEDIUM;
  if(t === '小') return 0.6001625; // 再-5%
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
  '03_c2c_bn':   ['HBN', 'KV', 'C2C HBN'],
  'skinny_app': ['SKINNY', 'SKINNY BN APP'],
  'skinny_app__2': ['SKINNY', 'SKINNY BN APP'], // 跟skinny_app共用同一組關鍵字——3個實例本來就該一起命中/一起顯示，見js/editor-state.js的LAYOUT_REGISTRY說明
  'skinny_app__3': ['SKINNY', 'SKINNY BN APP'],
  'skinny_pc':  ['SKINNY', 'SKINNY BN PC'],
  'skinny_pc__2': ['SKINNY', 'SKINNY BN PC'],
  'skinny_pc__3': ['SKINNY', 'SKINNY BN PC'],
  '11_lpbn_app': ['LPBN'],
  '12_lpbn_pc':  ['LPBN'],
  '04_ig':       ['IG', 'INSTAGRAM'],
  '05_ddcard':   ['DD CARD', 'DD'],
  '05_ddcard_nologo': ['DD CARD', 'DD'], // 跟05_ddcard共用同一組關鍵字，實際命中哪一個由_ddcardVariantForMaterial()的「有沒有無LOGO標記」決定，見下面說明
  '07_msbn':     ['MSBN', 'FB貼文', 'FB POST', 'FACEBOOK'],
  /* 2026-09修正：原本這裡寫的是'COIN PAGE'(有空格)，但實際工單A欄的材料
     名稱是'08_Coinpage'(沒有空格、Coin/page黏在一起)——_keywordHit()的
     單字邊界比對要求關鍵字前後都不能緊接著英數字，'COIN'後面直接接
     'PAGE'(沒有邊界)一樣比對不到，'COIN PAGE'裡的空格在黏在一起的
     'COINPAGE'字串裡也找不到，兩個關鍵字都對不上，導致這個版位一直
     沒被判定成「有在工單裡」。直接把錯的關鍵字改成跟實際工單一致的
     'COINPAGE'（不是另外發明新的比對規則），比對邏輯完全不用動。 */
  '08_coin_bn':  ['COIN', 'COIN BN', 'COINPAGE', '金幣', '代幣'],
  '10_game_bn':  ['GAME BN', 'GAME', '遊戲'],
  'ar':          ['AR'],
  /* Me Page Circle／Circle_new：工單上可能用「09_Me Page Circle」或
     「10_Loyalty Page icon」這兩種名稱指同一份設計(只是交付尺寸不同，
     見js/editor-export.js的ME_PAGE_DUAL_EXPORT說明)，這裡兩個版位刻意
     共用同一組關鍵字，實際要對應哪一個版位靠_materialMatchesLayout()
     下面的_new標記判斷(有沒有"_new"/"NEW"字樣)，跟05_ddcard/
     05_ddcard_nologo那組「同一組關鍵字、依標記二選一」是同一種做法。 */
  '09_me_page_circle':     ['ME PAGE CIRCLE', 'LOYALTY PAGE ICON'],
  '09_me_page_circle_new': ['ME PAGE CIRCLE', 'LOYALTY PAGE ICON']
};
/* 這些版位刻意讓「兩種不同名稱的材料項目」共用同一組關鍵字/同一個版位id
   ——例如'09_Me Page Circle'跟'10_Loyalty Page icon'其實是同一份設計、
   只是交付尺寸不同的名稱(見js/editor-export.js的ME_PAGE_DUAL_EXPORT)，
   工單裡兩個名稱通常會被當成兩筆獨立的材料項目分開列出。buildLayoutInstancesFromMaterials()
   下面「同一個版位命中第二次就動態生出一個新副本」的邏輯，遇到這種
   「本來就該共用、不是真的要兩份」的版位要跳過，不然會像SKBN那樣越滾
   越多份(使用者實際回報過的bug，同一個成因)。 */
var NO_DUPLICATE_LAYOUT_IDS = { '09_me_page_circle': true, '09_me_page_circle_new': true };
function _keywordHit(joined, kw){
  var esc = String(kw).toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 純中文關鍵字沒有\b邊界概念(regex \b只認英數字底線)，直接退回substring比對即可
  if(!/[A-Z0-9]/i.test(kw)) return joined.indexOf(kw.toUpperCase()) >= 0;
  return new RegExp('(^|[^A-Z0-9])' + esc + '($|[^A-Z0-9])').test(joined);
}

/* 2026-08新增：DD Card「無LOGO版」判斷——這個材料名稱裡有沒有「無LOGO」
   標記(全形/半形括號、有沒有空格都認得，例如'DD Card (無LOGO)'、
   'DD Card(無LOGO)'、'DD Card 無LOGO')。05_ddcard／05_ddcard_nologo兩個
   版位共用同一組「DD CARD」關鍵字判斷「這個材料項目是不是在講DD Card」，
   再用這支函式判斷究竟要對應哪一個版位——避免同一個材料項目因為兩個
   版位的關鍵字都命中，同時觸發兩個版位(一份材料項目應該只對應一個
   版位)。沒有「無LOGO」標記＝一般有LOGO版(05_ddcard，維持原行為)；
   有標記＝無LOGO版(05_ddcard_nologo)。 */
function _hasNoLogoMarker(mUpper){
  return /無\s*LOGO/.test(mUpper);
}
/* 判斷某個材料項目字串(已轉大寫)實際要對應LAYOUT_REGISTRY裡的哪個
   layoutId——大部分版位維持原本「關鍵字陣列裡任一個命中就算」的簡單
   規則；只有05_ddcard／05_ddcard_nologo這對「同一組關鍵字、但依有沒有
   無LOGO標記二選一」的特殊情況另外處理，避免同一個材料字串同時命中
   兩個版位。之後如果還有其他版位需要類似「同一組關鍵字、依某個標記
   二選一」的邏輯，在這裡加一個判斷分支即可，不用去改三個呼叫端
   (filterLayoutsByMaterials／mapMaterialsToLayoutOrder／
   buildLayoutInstancesFromMaterials)。 */
function _materialMatchesLayout(mUpper, layoutId){
  var kws = LAYOUT_MATERIAL_KEYWORDS[layoutId];
  if(!kws){
    var reg = LAYOUT_REGISTRY.find(function(l){ return l.id === layoutId; });
    kws = reg ? [reg.name] : [layoutId];
  }
  var kwHit = kws.some(function(kw){ return _keywordHit(mUpper, kw); });
  if(!kwHit) return false;

  if(layoutId === '05_ddcard') return !_hasNoLogoMarker(mUpper);
  if(layoutId === '05_ddcard_nologo') return _hasNoLogoMarker(mUpper);
  if(layoutId === '08_popup') return !_hasNoLogoMarker(mUpper);
  if(layoutId === '08_popup_no_logo') return _hasNoLogoMarker(mUpper);
  if(layoutId === '09_me_page_circle') return !_keywordHit(mUpper, 'NEW');
  if(layoutId === '09_me_page_circle_new') return _keywordHit(mUpper, 'NEW');
  return true;
}
function filterLayoutsByMaterials(materials){
  if(!materials || !materials.length) return LAYOUT_REGISTRY.map(function(l){return l.id;});
  /* 逐一比對每個材料項目(不是全部joinー起比對)——DD Card跟DD Card(無LOGO)
     這種「同一組關鍵字、依標記二選一」的版位，如果把整份材料清單joinー起
     再整段丟進_materialMatchesLayout()，兩個版位同時出現在清單裡時，
     joinー起的字串會同時含有'DD CARD'跟'無LOGO'，判斷不出到底是哪一項
     材料帶了標記，容易誤判。逐一比對每個材料項目字串，只要清單裡任一項
     命中某個layoutId就算，才能正確處理「這次工單同時勾了DD Card跟DD
     Card(無LOGO)兩種」的情況。 */
  var upperList = materials.map(function(m){ return String(m||'').toUpperCase(); });
  var matched = LAYOUT_REGISTRY.filter(function(layout){
    return upperList.some(function(mUpper){ return _materialMatchesLayout(mUpper, layout.id); });
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
      if(_materialMatchesLayout(mUpper, layout.id)) order.push(layout.id);
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
      if(!_materialMatchesLayout(mUpper, layout.id)) return;

      if(!seenLayoutIds[layout.id]){
        seenLayoutIds[layout.id] = true;
        instances.push({ instanceId: layout.id, layoutId: layout.id, label: null, textGroup: item.group });
      } else if((window.SKBN_INSTANCE_META && window.SKBN_INSTANCE_META[layout.id]) || NO_DUPLICATE_LAYOUT_IDS[layout.id]){
        /* SKBN(skinny_app/__2/__3、skinny_pc/__2/__3)這6個實例、跟
           09_me_page_circle／09_me_page_circle_new這兩個版位，都是刻意
           讓不同名稱的材料項目共用同一組關鍵字/同一個版位id(見
           LAYOUT_MATERIAL_KEYWORDS、NO_DUPLICATE_LAYOUT_IDS的說明)——
           工單裡通常會用兩種名稱各自列一筆材料(SKBN是APP_1/_2/_3各一列，
           Me Page Circle則是「09_Me Page Circle」跟「10_Loyalty Page
           icon」各一列)，每一筆都會命中同一個(或同一組)版位——如果照
           下面else分支的邏輯「同一個版位命中第二次就動態生出一個新副本」，
           會越滾越多份，變成同一個版位重複開好幾份(使用者實際回報的bug)。
           這幾個版位本來就是全部要用的、不需要再依材料筆數動態複製，
           這裡直接跳過，不做任何事——第一次命中已經在上面if分支註冊過了。 */
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
