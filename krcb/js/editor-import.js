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

/* 2026-08重寫：原本這支函式只抓「左/中/右」三格各自的LOGO名稱字串，
   完全沒有讀「版型」欄位、也假設每個MSBN版本永遠是固定的3格LOGO-only
   排版(D/G/J三個固定欄位)——這是舊工單格式的假設，實際比對過真正的
   工單Excel後發現完全不是這樣：
     - 版型欄位(C欄)明講每個版本要用哪一種版型設計(版型2~版型6)，每種
       版型的排版、格數、有沒有文案都不一樣，不是只有LOGO
     - 左/中/右的實際欄位位置是動態的(掃這一列找'左'/'中'/'右'這幾個字
       在哪一欄，不是寫死D/G/J)，版型2/6只有左右兩格、版型4是左中右三格
     - 每一格底下可能有LOGO、文案、圖片好幾種欄位，兩種排法都有：
       LOGO/文案/圖片這種簡單名詞是「欄位名稱這一列、值在正下方那一列」；
       「大字(10字內)」「小字(10字內)」這種是「欄位名稱跟值在同一列、
       值在名稱右邊一欄」
   回傳形狀改成 { MSBN1:{ layoutId, logos:{slotKey:name}, texts:{slotKey:內容} }, ... }
   ——slotKey直接對應configs/layouts/msbn/07_msbn_v*-positions.json裡
   msbnSlots/msbnTexts實際用的key，applyMsbnAssetsFromImport()拿到之後
   可以直接用，不用再自己猜格式。
   之後如果版型繼續增加(公版七、八...)，只要在TEMPLATE_MAP加一筆對照，
   不用再改這支函式本身的解析邏輯。 */
var MSBN_TEMPLATE_SLOT_MAP = {
  /* 2026-08(KRCB)整組重寫：對照海外購物節那份繼承過來的公版一~六舊
     LOGO-only設計，KRCB三個版型(副區/版型1/版型2)都是全新的icon+文字/
     商品+文字+圓形徽章設計(見configs/layouts/subzone_app.json、
     configs/layouts/msbn/07_msbn.json、07_msbn_v2.json)，slot key全部
     對應這幾份config實際用的msbnSlots/msbnTexts鍵名。
     '副區'比較特別：layoutId是陣列['subzone_app','subzone_pc']，不是
     單一字串——代表這個版型不是套用給「Excel這一列標的那個編號實例」
     (例如MSBN1)，而是套用給固定存在的subzone_app/subzone_pc這兩個
     實例，套用邏輯另外寫在js/editor-main.js的applyMsbnAssetsFromImport()。
     副區的'ICON'欄位type是'icon'(不是'logo')——Excel填的是ICON圖庫裡的
     「名稱」(例如「免運車」)，要拿去比對data/icon-library.json，不是拿去
     跟曝光資源資料夾比對檔名，兩者比對的對象不一樣，用不同type區分，
     解析結果會分別放進logos{}跟icons{}兩個桶子。
     '圓標(5字內)'這種欄位，Excel只會填「一個完整字串」(例如「煥顏修護」)，
     直接原封不動存進畫布上對應的badge欄位——那個欄位是multiline:true
     (見configs/layouts/msbn/07_msbn-positions.json的badge說明)，畫的時候
     (modules/msbn-logo-module.js的msbnText模組)會自動判斷要不要對半拆成
     2行顯示，這裡的import端不用自己先切好，直接用plain的'text'類型存
     整個字串即可。 */
  '副區': {
    layoutId: ['subzone_app', 'subzone_pc'],
    groups: {
      '左': { 'ICON': {key:'icon1', type:'icon'}, '文案第1排': {key:'tag1', type:'text'}, '文案第2排': {key:'promo1', type:'text'} },
      '中': { 'ICON': {key:'icon2', type:'icon'}, '文案第1排': {key:'tag2', type:'text'}, '文案第2排': {key:'promo2', type:'text'} },
      '右': { 'ICON': {key:'icon3', type:'icon'}, '文案第1排': {key:'tag3', type:'text'}, '文案第2排': {key:'promo3', type:'text'} }
    }
  },
  '版型1': {
    /* 單一商品版型(configs/layouts/msbn/07_msbn.json)：host作圖區+2行
       商品名稱(靠左對齊)+1個圓形徽章(multiline文字)。目前只做了2行商品
       名稱(nameLine1/nameLine2)，Excel保留的「文案第3排」欄位先不對應
       任何key(找不到mapping會被靜默忽略，不會報錯)——如果之後確認這個
       版型真的需要用到第3行，要先補上對應的畫布座標，這裡才能對應。 */
    layoutId: '07_msbn',
    groups: {
      '左': { '文案第1排': {key:'nameLine1', type:'text'}, '文案第2排': {key:'nameLine2', type:'text'} },
      '右': { '圖片': {key:'host', type:'logo'}, '圓標': {key:'badge', type:'text'} }
    }
  },
  '版型2': {
    /* 雙商品版型(configs/layouts/msbn/07_msbn_v2.json)：左右各一組host+
       最多3行商品名稱(靠左對齊)+1個圓形徽章(multiline文字)。 */
    layoutId: '07_msbn_v2',
    groups: {
      '左': {
        '文案第1排': {key:'name1Line1', type:'text'},
        '文案第2排': {key:'name1Line2', type:'text'},
        '文案第3排': {key:'name1Line3', type:'text'},
        '圖片': {key:'host1', type:'logo'},
        '圓標': {key:'badge1', type:'text'}
      },
      '右': {
        '文案第1排': {key:'name2Line1', type:'text'},
        '文案第2排': {key:'name2Line2', type:'text'},
        '文案第3排': {key:'name2Line3', type:'text'},
        '圖片': {key:'host2', type:'logo'},
        '圓標': {key:'badge2', type:'text'}
      }
    }
  },
  /* 以下版型3~6是海外購物節繼承過來的舊LOGO-only設計，KRCB目前沒有對應
     的實際版位config、也還沒收到KRCB自己這幾個版型的設計稿——先保留這幾
     筆舊對照表，萬一Excel真的填到版型3~6，不會整個解析失敗，只是這幾個
     版型目前在KRCB專案裡沒有對應的configs/layouts/msbn/07_msbn_v3~v6.json
     實際內容可以顯示（那幾份config目前還是海外購物節沿用的舊設計）。 */
  '版型3': {
    layoutId: '07_msbn_v3',
    groups: {
      '左': { 'LOGO': {key:'logoLeft', type:'logo'}, '文案': {key:'textLeft', type:'text'} },
      '右': { 'LOGO': {key:'logoRight', type:'logo'}, '文案': {key:'textRight', type:'text'} }
    }
  },
  '版型4': {
    layoutId: '07_msbn_v4',
    groups: {
      '左': { 'LOGO': {key:'logo1', type:'logo'}, '文案': {key:'text1', type:'text'} },
      '中': { 'LOGO': {key:'logo2', type:'logo'}, '文案': {key:'text2', type:'text'} },
      '右': { 'LOGO': {key:'logo3', type:'logo'}, '文案': {key:'text3', type:'text'} }
    }
  },
  '版型5': {
    layoutId: '07_msbn_v5',
    groups: {
      '左': { 'LOGO': {key:'logo1', type:'logo'}, '圖片': {key:'image', type:'logo'} },
      '右': { '大字': {key:'textBig', type:'text'}, '小字': {key:'textSmall', type:'text'} }
    }
  },
  '版型6': {
    layoutId: '07_msbn_v6',
    groups: {
      '左': { 'LOGO': {key:'logo1', type:'logo'} },
      '右': { '大字': {key:'brandName', type:'text'}, '小字': {key:'discount', type:'text'} }
    }
  }
};

/* 判斷這個欄位標籤是「inline排法」(名稱跟值同一列，值在名稱右邊一欄)
   還是「vertical排法」(名稱單獨一列，值在正下方那一列、同一欄)。
   2026-08(KRCB)修正：原本只認精確的「(10字內)」字樣(海外購物節版型5/6
   的「大字(10字內)」「小字(10字內)」)，但KRCB新版型的欄位字數上限不是
   固定10字，會是「(5字內)」「(6字內)」「(7字內)」各種數字，而且同樣是
   inline排法的「ICON」根本沒有括號——單純用「有沒有括號」或「字數
   數字」判斷都不夠準，改成直接列舉「這些具體標籤前綴是inline」，沒列到
   的一律當vertical(LOGO、圖片、圓標(...)都是vertical，這是實際Excel
   資料驗證過的排法)。 */
function _msbnLegacyFieldIsInline(label){
  if(label === 'ICON') return true;
  if(label.indexOf('文案第') === 0) return true; // 文案第1排(5字內)、文案第2排(7字內)...
  if(label.indexOf('大字') === 0) return true; // 大字(10字內)，海外購物節舊版型5/6
  if(label.indexOf('小字') === 0) return true; // 小字(10字內)，海外購物節舊版型5/6
  return false; // LOGO、圖片、圓標(...)、文案(舊版純文字無「第X排」) 都是vertical
}

function parseMsbnVersionLegacy(mainRows){
  if(!mainRows) return null;

  var startRow = -1;
  for(var r0=0; r0<mainRows.length; r0++){
    if(mainRows[r0] && mainRows[r0][0] === '【Layout】'){ startRow = r0; break; }
  }
  if(startRow < 0) return null;

  var result = {};
  var r = startRow + 1;
  while(r < mainRows.length){
    var row = mainRows[r];
    var cellA = row && row[0];
    if(typeof cellA !== 'string' || !/^MSBN\d+$/i.test(cellA.trim())){ r++; continue; }

    var version = cellA.trim().toUpperCase();
    var banxingRaw = row[2]; // C欄：版型
    var banxing = (typeof banxingRaw === 'string') ? banxingRaw.trim() : null;
    var tmpl = banxing && MSBN_TEMPLATE_SLOT_MAP[banxing];

    /* 找這一列(版本編號那一列)裡「左/中/右」這幾個字實際在哪一欄——動態
       掃描，不假設固定欄位，版型不同、格數不同，欄位位置也會不一樣。 */
    var anchors = [];
    for(var c=0; c<row.length; c++){
      if(row[c] === '左' || row[c] === '中' || row[c] === '右'){
        anchors.push({ label: row[c], col: c });
      }
    }
    anchors.sort(function(a,b){ return a.col - b.col; });

    /* 決定這個版本的資料涵蓋到第幾列為止：碰到下一個'MSBN\d+'標記列、
       或連續兩列整列都空白，就結束——版型5/6中間可能會夾一列單獨的空白
       (大字/小字兩行分開)，只有連續兩列全空才真的算區塊結束。 */
    var blockEnd = mainRows.length - 1;
    var blankStreak = 0;
    for(var r2=r+1; r2<mainRows.length; r2++){
      var row2 = mainRows[r2];
      var a2 = row2 && row2[0];
      if(typeof a2 === 'string' && /^MSBN\d+$/i.test(a2.trim())){ blockEnd = r2 - 1; break; }
      var isBlank = !row2 || row2.every(function(v){ return v===undefined || v===null || v===''; });
      blankStreak = isBlank ? blankStreak+1 : 0;
      if(blankStreak >= 2){ blockEnd = r2 - 2; break; }
    }

    if(tmpl && anchors.length){
      var logos = {}, texts = {}, icons = {};
      anchors.forEach(function(anchor, idx){
        var fieldMap = tmpl.groups[anchor.label];
        if(!fieldMap) return;
        var colStart = anchor.col;
        var colEnd = (idx+1 < anchors.length) ? anchors[idx+1].col : (colStart + 6); // 最後一格沒有下一個錨點界線，抓寬一點涵蓋旁邊的「圖片」這種次要欄位

        for(var rr=r+1; rr<=blockEnd; rr++){
          var rowX = mainRows[rr];
          if(!rowX) continue;
          for(var cc=colStart; cc<colEnd && cc<rowX.length; cc++){
            var cell = rowX[cc];
            if(typeof cell !== 'string' || !cell.trim()) continue;
            var label = cell.trim();
            /* 先試「去掉括號」的正規化標籤(例如「文案第1排(5字內)」→
               「文案第1排」)，找不到再試原始完整字串(相容海外購物節舊版
               型3~6那種以完整字串當key的寫法，例如'大字(10字內)')。 */
            var normalizedLabel = label.replace(/\([^)]*\)/g, '').trim();
            var mapping = fieldMap[normalizedLabel] || fieldMap[label];
            if(!mapping) continue;

            var value;
            if(_msbnLegacyFieldIsInline(label)){
              value = rowX[cc+1];
            } else {
              var rowBelow = mainRows[rr+1];
              value = rowBelow ? rowBelow[cc] : undefined;
            }
            if(typeof value !== 'string' || !value.trim()) continue;
            value = value.trim();

            if(mapping.type === 'logo'){
              /* 2026-08(KRCB)新增：使用者需求——同一個商品格子(host類欄位)
                 有時候不只一品，可能要主商品+贈品這種多張一起合成。「圖片」
                 欄位如果同一格填了多個名稱，用跟js/editor-import.js其他
                 地方(第174行「文案：」多品名拆解)同一套分隔符號規則
                 (/、,｜|)拆開，回傳陣列，不管只有1個還是多個都統一用陣列
                 格式——呼叫端(js/editor-main.js的applyInfoToInstanceId())
                 看陣列長度決定要走「單張直接套用」還是「多張進商品合成
                 工具的持久化狀態預先填好」那條路。 */
              /* 2026-08(KRCB)再修正：使用者實際的Excel欄位裡，同一格填
                 多個名稱是用「換行」(儲存格內按Alt+Enter分行)分開的，不是
                 用/、,｜|這些符號——原本的分隔規則沒有涵蓋\n/\r，導致
                 整格內容(含換行符號)被當成「一個」名稱，這個名稱當然找不到
                 對應檔案，等於整格視為沒匹配到，這就是「寫了3次同一品，
                 卻沒有變成3品」的根本原因。改成分隔符號也涵蓋換行，同一品
                 寫3次(3行)會正確拆成3個一樣的名稱，各自比對到同一個檔案，
                 變成3品(可能都指向同一張圖，這是合理的——使用者想要同一個
                 商品重複3次)。 */
              logos[mapping.key] = value.split(/[\/、,｜|\n\r]+/).map(function(s){ return s.trim(); }).filter(Boolean);
            } else if(mapping.type === 'icon'){
              icons[mapping.key] = value;
            } else if(mapping.type === 'text-split2'){
              /* 圓標這種欄位，Excel只填一個完整字串，畫布上要拆成2行
                 顯示——從中間切成兩段(字數不平均時前半段少一個字，例如
                 5個字切成2+3)，跟js/editor-import.js其他地方切字的習慣
                 一致(無條件捨去)。 */
              var mid = Math.floor(value.length / 2);
              texts[mapping.key[0]] = value.slice(0, mid);
              texts[mapping.key[1]] = value.slice(mid);
            } else {
              texts[mapping.key] = value;
            }
          }
        }
      });
      result[version] = { layoutId: tmpl.layoutId, logos: logos, texts: texts, icons: icons };
    }
    /* 版型辨識不出來(banxing不在MSBN_TEMPLATE_SLOT_MAP裡，例如之後版型
       補到7、8但這裡還沒加對照表)——不寫入result，這個版本維持
       buildMsbnTabData()原本的預設值(公版一)，不會整個匯入失敗。 */

    r = blockEnd + 1;
  }

  return Object.keys(result).length ? result : null;
}

function parseMsbnVersionSheet(wb, mainRows){
  return parseMsbnVersionSheetV2(wb) || parseMsbnVersionLegacy(mainRows);
}

/* 材料項目清單，順便帶出每個項目自己的「內容」欄位值（'文案1'/'文案2'...），
   這是Excel明講的、最準的依據——比後面用'文案1'/'文案2'標記列去反推誰屬於
   哪一組更可靠，因為這欄就是工單本來就填給每個製作物項目的分組標籤。
   回傳 [{name, group}]，group沒填的話預設'文案1'。
   2026-08(KRCB專案)：使用者確認KRCB只需要一組文案，不用區分POPUP——
   海外購物節那邊為了popup專屬文案而加的「POPUP沒填時預設'文案2'」特例
   在這裡拿掉，POPUP現在跟其他版位(LPBN/HBN/DD Card...)一樣，沒填的話
   一律預設'文案1'，共用同一組文案/商品。 */
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
      var name = String(cellA).trim();
      var groupCell = row[4]; // 內容欄（'文案1'/'文案2'）
      var group = (typeof groupCell === 'string' && groupCell.trim()) ? groupCell.trim() : '文案1'; // 2026-08(KRCB)：只有一組文案，不再對POPUP特別預設'文案2'
      items.push({ name: name, group: group });
    }
  }
  return items;
}

/* 標題/副標/日期 這幾個標籤在Excel裡是「掃到哪個文案組標記列(精確等於
   '文案1'或'文案2'這種字串、右邊格是空的，純粹當分隔標記用)之後才算歸屬
   哪一組」，跟AR自己的'文案'(無編號)標籤是不同東西、不會互相干擾。
   掃描時預設從'文案1'開始（大部分工單只有一組，整份區塊都沒出現分組
   標記列也完全正常，全部歸在'文案1'）。
   2026-08修正「POPUP文案跟main變成同一組」：實際工單範本的popup分組標記
   列寫的是'POPUP文案'，不是'文案2'——原本這裡只認得精確符合/^文案\d+$/
   的字串，完全不認得'POPUP文案'，導致掃到POPUP自己的標題/副標時
   currentGroup還停在'文案1'，直接把main的文案蓋掉（母鍵'文案1'先被HBN的
   「領劵再88折超優惠」/「跨境$0免運」填過一次，後面掃到POPUP區塊時因為
   分組沒切換，同一個'文案1'物件的同一個key又被POPUP的「夏日毛孔清爽對策」
   /「細緻從淨化開始」蓋一次，最終這組資料只剩popup的內容，main的文案
   憑空消失、兩邊看起來變成一樣）。
   這裡新增辨識'POPUP文案'這個舊格式標記、統一對應到'文案2'這個全專案
   慣用的canonical key（跟parseMaterialsWithGroup()/updateEditProduct
   ButtonForActiveGroup()認定popup專屬分組的名稱一致，不會出現'POPUP文案'
   這個key本身跑進textGroups、跟'文案2'變成兩個各自獨立卻都只有半份資料
   的分組）。跟_findPopupGroupMarkerRow()的新舊格式相容判斷用同一個規則，
   之後如果還有第三種寫法，兩處要一起加。 */
function parseTextGroups(rows){
  var textGroups = { '文案1': {} };
  var currentGroup = '文案1';
  var LABELS = ['標題','副標','日期','AR文案'];
  var GROUP_MARKER = /^文案\d+$/;

  rows.forEach(function(row){
    if(!row) return;
    row.forEach(function(cell, c){
      if(typeof cell === 'string'){
        var trimmed = cell.trim();
        var isNumberedMarker = GROUP_MARKER.test(trimmed);
        var isPopupMarker = (trimmed === 'POPUP文案'); // 舊格式工單相容：popup分組標記不是'文案2'，是'POPUP文案'
        if(isNumberedMarker || isPopupMarker){
          var next = row[c+1];
          /* 右邊格有值的話，那是「標題/副標/日期」表頭列本身寫的'文案1'
             (例如製作素材表頭那列)，不是分組切換標記，不要誤判成切換。
             只有右邊格是空的，才是「接下來的標籤都歸這組」的切換標記。 */
          if(next === undefined || next === null || next === ''){
            currentGroup = isPopupMarker ? '文案2' : trimmed;
            if(!textGroups[currentGroup]) textGroups[currentGroup] = {};
          }
          return;
        }
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
  var popupExposure = parsePopupExposureTable(rows);
  var logo2Info = parseLogo2Info(rows);
  var popupLogo2Info = parsePopupLogo2Info(rows);
  var arInfo = parseARCell(rows);

  return {
    materials: materials,
    materialItems: materialItems, // [{name, group}]，給layoutTextGroup比對用
    textGroups: textGroups,
    logoInfo: logoInfo,
    exposure: exposure,
    popupExposure: popupExposure,
    logo2Checked: logo2Info.checked,
    logo2MaterialName: logo2Info.materialName,
    popupLogo2Checked: popupLogo2Info.checked,
    popupLogo2MaterialName: popupLogo2Info.materialName,
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
/* 2026-08修正「AR文案讀到奇怪的內容(例如變成'1')」：原本這裡找『文案』
   兩個字是掃「整份工單所有列」，逐一比對到就覆蓋——問題是『文案』這兩個
   字在整份工單裡出現非常多次(MSBN每個版本的Layout區塊裡都有自己的『文案』
   欄位標籤)，掃到最後一次出現的那個才是最終結果，等於完全不是AR自己
   那格的內容，而是巧合對到工單裡其他地方剛好也叫『文案』的儲存格。
   改成先鎖定『AR內容』這個錨點在哪一列，『文案』只在錨點附近幾列內找
   (這份工單的實際排法是緊接在下一列)，不再對整份工單漫無範圍地搜尋。 */
function parseARCell(rows){
  var anchorRow = -1, variant = null;
  for(var r=0; r<rows.length; r++){
    var row = rows[r];
    if(!row) continue;
    for(var c=0; c<row.length; c++){
      if(row[c] === 'AR內容'){
        var v = row[c+1];
        if(v !== undefined && v !== null && v !== ''){
          variant = _arMatchVariant(v);
          anchorRow = r;
        }
        break;
      }
    }
    if(anchorRow >= 0) break;
  }
  if(!variant) return null;

  var result = { variant: variant };
  if(variant === 'text'){
    var text = null;
    for(var r2=anchorRow; r2<Math.min(rows.length, anchorRow+6) && !text; r2++){
      var row2 = rows[r2];
      if(!row2) continue;
      for(var c2=0; c2<row2.length; c2++){
        if(row2[c2] === '文案'){
          var v2 = row2[c2+1];
          if(v2 !== undefined && v2 !== null && v2 !== ''){ text = String(v2).trim(); }
          break;
        }
      }
    }
    if(text) result.text = text;
  }
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
/* 找到某個「分組切換標記」在第幾列——判斷規則要跟parseTextGroups()的
   GROUP_MARKER完全一致(精確等於'文案\d+'這種字串、右邊格是空的)，不然
   兩邊各自認定的「popup從哪裡開始」對不起來，衍生出更難查的不一致問題。
   找不到回傳-1。 */
function _findGroupMarkerRow(rows, markerTest){
  for(var r=0; r<rows.length; r++){
    var row = rows[r];
    if(!row) continue;
    for(var c=0; c<row.length; c++){
      var cell = row[c];
      if(typeof cell === 'string' && markerTest(cell.trim())){
        var next = row[c+1];
        if(next === undefined || next === null || next === '') return r;
      }
    }
  }
  return -1;
}
function _findPopupGroupMarkerRow(rows){
  var r = _findGroupMarkerRow(rows, function(s){ return /^文案\d+$/.test(s) && s !== '文案1'; });
  if(r >= 0) return r;
  return _findGroupMarkerRow(rows, function(s){ return s === 'POPUP文案'; }); // 相容舊格式
}

/* 2026-08修正「文案2(popup)有勾LOGO2，卻完全沒跳出確認popup」：原本這裡
   掃「整份工單所有列」找第一個'LOGO'/'LOGO2'標籤就直接回傳——問題是main
   跟popup(文案2)工單裡「各自都有一個」LOGO欄位(main的在最前面)，掃到的
   永遠是main那個，popup自己的那格完全不會被讀到。改成限定只在main的
   範圍內找(從頭到popup分組標記列之前)，popup自己的LOGO2資訊改由下面
   新增的parsePopupLogo2Info()專門負責讀取。 */
function _parseLogo2InfoInRange(rows, startRow, endRow, defaultChecked){
  for(var r=startRow; r<endRow; r++){
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
  return { checked: !!defaultChecked, materialName: null };
}
function parseLogo2Info(rows){
  var popupMarkerRow = _findPopupGroupMarkerRow(rows);
  var mainEnd = (popupMarkerRow >= 0) ? popupMarkerRow : rows.length;
  // 找不到的話保守當作有勾選、沒有指定廠商名稱(維持原本行為)，避免我猜錯欄位反而讓原本該跳出來的確認popup消失不見
  return _parseLogo2InfoInRange(rows, 0, mainEnd, true);
}
/* 2026-08新增：popup(文案2)自己的LOGO2資訊，只在popup分組標記列之後找。
   跟main不一樣，找不到的話預設「沒有勾選」(不是保守當作有)——popup本來
   就不一定有自己的LOGO2，沒有這個欄位是正常狀態，不用強迫跳出確認popup。 */
function parsePopupLogo2Info(rows){
  var popupMarkerRow = _findPopupGroupMarkerRow(rows);
  if(popupMarkerRow < 0) return { checked: false, materialName: null };
  return _parseLogo2InfoInRange(rows, popupMarkerRow, rows.length, false);
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
  return _parseExposureTableByAnchor(rows, function(cell){ return cell === '曝品'; });
}

/* 2026-08新增：popup版位需要自己獨立的曝品表——工單裡長這樣，欄位名稱是
   「POPUP 曝品」而不是單純的「曝品」兩個字，不能用exact match找，要用
   「結尾是曝品，但不是完全等於曝品」這個規則，才不會跟主要那份曝品表
   (parseExposureTable找的那份)搞混、也不會兩邊都比對到同一格。
   之後如果還有其他版位也要有自己獨立的曝品表(不只popup)，一樣可以照
   這個規則命名「XX 曝品」，這支函式直接就能找到，不用再改程式碼。 */
function parsePopupExposureTable(rows){
  return _parseExposureTableByAnchor(rows, function(cell){
    return typeof cell === 'string' && cell !== '曝品' && cell.trim().slice(-2) === '曝品';
  });
}

function _parseExposureTableByAnchor(rows, isAnchor){
  var kRow = -1, kCol = -1;
  for(var r=0; r<rows.length && kRow<0; r++){
    var row = rows[r];
    if(!row) continue;
    for(var c=0; c<row.length; c++){
      if(isAnchor(row[c])){ kRow = r; kCol = c; break; }
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
    /* 2026-08修正：主曝品表跟POPUP曝品表之間如果沒有空白列隔開(工單常見排法)，
       上面「碰到空白列才停」這個條件不會觸發，會一路讀進下一個曝品表自己的
       槽位列(人物1/人物2/商品1(左)/商品2(中)/商品3(右)是共用槽位名稱，看起來
       完全就像是同一個表的延續)，把下一個表的商品名稱誤植成這個表的項目。
       這裡額外判斷：只要這一列的槽位欄位本身是「XX曝品」這種表頭字樣
       (不分是不是完全等於'曝品')，就代表已經走到下一個曝品表的開頭，
       立刻停止，不要把它當成槽位名稱繼續解析。 */
    if(typeof slot === 'string' && slot.trim().slice(-2) === '曝品') break;
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
  '05_ddcard_nologo': ['DD CARD', 'DD'], // 跟05_ddcard共用同一組關鍵字，實際命中哪一個由_materialMatchesLayout()的「有沒有無LOGO標記」決定
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
function _hasNoLogoMarker(mUpper){
  return /無\s*LOGO/.test(mUpper);
}
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
  return true;
}
function filterLayoutsByMaterials(materials){
  if(!materials || !materials.length) return LAYOUT_REGISTRY.filter(function(l){return !l.defaultOff;}).map(function(l){return l.id;});
  /* 2026-09新增：逐一比對每個材料項目(不是全部join一起比對)——DD Card/DD
     Card(無LOGO)、Popup/Popup(無LOGO)這種「同一組關鍵字、依標記二選一」的
     版位，如果把整份材料清單join一起再整段比對，兩個版位同時出現在清單裡
     時，join一起的字串會同時含有兩種標記，判斷不出到底是哪一項材料帶了
     標記，容易誤判。逐一比對每個材料項目字串，只要清單裡任一項命中某個
     layoutId就算，才能正確處理「同一張工單同時勾了有LOGO跟無LOGO兩種」的
     情況（沿用e-coupon-payment/mommy-member-day已經在用的同一套做法）。 */
  var upperList = materials.map(function(m){ return String(m||'').toUpperCase(); });
  var matched = LAYOUT_REGISTRY.filter(function(layout){
    return upperList.some(function(mUpper){ return _materialMatchesLayout(mUpper, layout.id); });
  });
  return (matched.length ? matched : LAYOUT_REGISTRY.filter(function(l){return !l.defaultOff;})).map(function(l){ return l.id; });
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
/* preConsumed（選填）：呼叫這次之前，已經被「別次matchAssetFolder()呼叫」
   用掉的File物件清單——這裡的consumed是每次呼叫各自獨立從空陣列開始算
   的，main商品跟popup商品是分開兩次呼叫，如果沒有這個參數，兩邊各自
   比對時完全不知道對方已經選走哪個檔案，工單裡如果main/popup兩邊品名
   相近甚至相同，就會各自獨立比對到同一張圖——明明資料夾裡準備了兩張
   不同的商品照片，main跟popup卻拿到一模一樣的那張。呼叫端(見
   editor-popups.js的goToPopupShadowStepThenDone())在比對popup商品前，
   要把main商品比對到的File物件都傳進來當preConsumed，兩邊才不會搶到
   同一張圖。 */
function matchAssetFolder(files, exposureItems, extraAliases, preConsumed){
  var imageFiles = files.filter(function(f){ return /\.(png|jpe?g|webp)$/i.test(f.name); });
  var matched = {};
  var consumed = (preConsumed && preConsumed.length) ? preConsumed.slice() : [];

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
