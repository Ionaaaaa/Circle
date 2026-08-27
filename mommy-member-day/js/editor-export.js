'use strict';
/* editor-export.js —— 只管「把畫好的canvas輸出成檔案」，不管畫布內容怎麼來的 */

/* 有K數上限規定的版位（照工單「K數」欄位規則：HBN/DD Card/Coin Page BN
   都是145K內）用JPEG格式輸出＋自動壓縮找到符合大小上限、畫質盡量高的
   quality；其他版位(MSBN、AR)維持原本的PNG無損輸出，沒有檔案大小限制的
   版位沒必要犧牲畫質換取更小檔案。 */
var EXPORT_SIZE_LIMIT_KB = {
  '03_c2c_bn': 145,
  '05_ddcard': 145,
  '08_coin_bn': 145
};

/* 2026-08修正：LPBN_APP/PC原本被歸類在「沒有檔案大小限制→PNG無損」那組，
   但這兩個版位規格其實是要求JPG（跟HBN/DD Card/Coin Page BN一樣），只是
   沒有明確的K數上限規定——所以走JPEG輸出，但不用像有K數上限的版位那樣
   反覆試壓縮找臨界點，固定用高畫質(0.92)出圖即可，不用犧牲畫質換檔案
   大小。之前沒放進EXPORT_SIZE_LIMIT_KB就被預設分類成PNG，是分類邏輯的
   遺漏，不是刻意要給LPBN用PNG。
   2026-08新增：04_ig比照同一套規則，一樣要求JPG、沒有明確K數上限，跟
   LPBN_APP/PC放同一組。10_game_bn使用者明確要求PNG，維持預設(不用加進
   任一個表)，falls through到下面的PNG無損分支。 */
var EXPORT_JPEG_NO_LIMIT = { '11_lpbn_app': true, '12_lpbn_pc': true, '04_ig': true };
var EXPORT_JPEG_FIXED_QUALITY = 0.92;

function canvasToBlob(canvas){
  return new Promise(function(resolve){
    canvas.toBlob(function(blob){ resolve(blob); }, 'image/png');
  });
}

function canvasToBlobJPEG(canvas, quality){
  return new Promise(function(resolve){
    canvas.toBlob(function(blob){ resolve(blob); }, 'image/jpeg', quality);
  });
}

/* 由高畫質往下試，能符合目標檔案大小就停在那一階，不會無條件砍到最低畫質；
   試到quality下限(0.5)還是超過目標大小的話，就用0.5那個結果盡力而為
   （已經是這個系統願意犧牲畫質的底線，不會再往下砍）。 */
function exportCanvasWithSizeLimit(canvas, targetKB){
  var targetBytes = targetKB * 1024;
  var qualities = [0.92, 0.88, 0.84, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5];
  function tryAt(i){
    return canvasToBlobJPEG(canvas, qualities[i]).then(function(blob){
      if(blob.size <= targetBytes || i >= qualities.length-1) return blob;
      return tryAt(i+1);
    });
  }
  return tryAt(0);
}

/* 依版位決定輸出格式：有K數上限的版位→JPEG+自動壓縮；LPBN_APP/PC→固定
   高畫質JPEG（不用試壓縮）；其他→PNG無損。回傳 {blob, ext}，呼叫端用ext
   決定副檔名，不用另外判斷一次格式。 */
function exportLayoutBlob(layoutId, canvas){
  /* 動態複製出來的版位實例(例如HBN週三版'03_c2c_bn__2')沒有自己的規則，
     retry回真正的原版位id查表——兩個實例本來就該套用同一套K數上限/
     JPEG規則(同一種版位規格，只是文案不同)。 */
  var ruleId = (window.LAYOUT_ALIAS_BASE && window.LAYOUT_ALIAS_BASE[layoutId]) ||
               (window.LAYOUT_ASSET_FALLBACK && window.LAYOUT_ASSET_FALLBACK[layoutId]) ||
               layoutId;
  var limitKB = EXPORT_SIZE_LIMIT_KB[ruleId];
  if(limitKB){
    return exportCanvasWithSizeLimit(canvas, limitKB).then(function(blob){
      return { blob: blob, ext: 'jpg' };
    });
  }
  if(EXPORT_JPEG_NO_LIMIT[ruleId]){
    return canvasToBlobJPEG(canvas, EXPORT_JPEG_FIXED_QUALITY).then(function(blob){
      return { blob: blob, ext: 'jpg' };
    });
  }
  return canvasToBlob(canvas).then(function(blob){
    return { blob: blob, ext: 'png' };
  });
}

function triggerDownload(blob, filename){
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
}

/* 檔名安全化：分頁名稱可能含有Windows/Mac檔名系統不允許的符號
   (\/:*?"<>|)，換成底線，避免下載失敗或存檔時被瀏覽器自動改名到看不懂。 */
function sanitizeFilename(name){
  return String(name||'未命名').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名';
}

/* 2026-08新增：zip內部子資料夾專用的命名規則——曝光日期label如果是
   '7/1-7/15'、'7/16-7/31'這種「M/D-M/D」日期區間格式，直接轉成
   '0701-0715'、'0716-0731'(月日都補成2位數、拿掉斜線、中間用一個
   dash連接)，比原本sanitizeFilename()把斜線直接換成底線得到的
   '7_1-7_15'更符合資料夾命名習慣。格式對不上(例如舊格式'曝光日期1'、
   或使用者手動輸入的其他文字)一律退回原本的sanitizeFilename()，
   不會出錯或漏資料夾。 */
function formatExposureFolderName(label){
  if(typeof label === 'string'){
    var m = /^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})$/.exec(label.trim());
    if(m){
      var pad2 = function(s){ return s.length < 2 ? ('0'+s) : s; };
      return pad2(m[1])+pad2(m[2])+'-'+pad2(m[3])+pad2(m[4]);
    }
  }
  return sanitizeFilename(label);
}

/* 依「目前顯示順序」（見editor-main.js的activeLayouts()，已經照工單製作
   素材欄位的順序排好）算出這個版位是第幾個，給下載檔名編號用——編號跟著
   工單順序走，不是跟著LAYOUT_REGISTRY內部的版位id編號。 */
function layoutOrderIndex(layoutId){
  var order = activeLayouts();
  for(var i=0;i<order.length;i++){ if(order[i].id === layoutId) return i+1; }
  return null;
}

/* 下載前的文案合規檢查：字數超過上限、或命中禁用語，都會先跳一個警告
   popup列出問題，使用者可以選「回去修改」（取消這次下載）或「仍要下載」
   （尊重使用者的判斷，特殊情況下維持可以強制下載，不是死板地完全擋死）。
   完全沒問題的話直接呼叫proceedFn()，不會多跳一個「沒問題」的popup打斷。 */
function confirmDownloadWithComplianceCheck(proceedFn){
  checkTextCompliance().then(function(result){
    if(!result.overLimit.length && !result.banned.length){ proceedFn(); return; }

    /* 跟inline版(editor-main.js的updateTextCompliance())同一套邏輯：
       算得出安全替換值(suggested)的命中才顯示「套用」按鈕，並且要記住
       這個按鈕對應的是哪個欄位(key)+哪個hit，點下去才知道要套用哪一個。
       用一個陣列存所有「可套用」的項目，按鈕data-idx對應這個陣列的位置
       （跟lines陣列分開算，因為lines裡还包含沒有套用按鈕的字數超過提醒/
       沒有suggested的禁用語提醒）。 */
    var applyable = [];
    var lines = [];
    result.overLimit.forEach(function(o){
      lines.push('・'+o.key+'字數超過上限（目前'+(Number.isInteger(o.weight)?o.weight:o.weight.toFixed(1))+'／上限'+o.limit+'）');
    });
    result.banned.forEach(function(b){
      b.hits.forEach(function(h){
        var msg = '・'+b.key+'包含禁用語「'+esc(h.matchedText)+'」'+(h.replace ? '，建議改成「'+esc(h.replace)+'」' : (h.note ? '（'+esc(h.note)+'）' : ''));
        if(h.suggested !== null && h.suggested !== undefined && h.suggested !== h.matchedText){
          var idx = applyable.length;
          applyable.push({ key: b.key, hit: h });
          msg += ' <button type="button" class="banword-apply-btn" data-idx="'+idx+'">套用</button>';
        }
        lines.push(msg);
      });
    });

    var overlay = createOverlay(
      '<div class="popup-panel" style="width:420px;">'+
        '<div class="popup-head"><span>文案檢查提醒</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
        '<div class="popup-body">'+
          '<div class="banword-warning" style="display:block;">'+lines.join('<br>')+'</div>'+
          '<div class="hint" style="margin-top:10px;">如果是特殊情況（例如確認過不受這條規則限制），仍然可以選擇繼續下載。</div>'+
        '</div>'+
        '<div class="popup-foot">'+
          '<button class="tbtn primary" id="compliance-cancel-btn">回去修改</button>'+
          '<span style="flex:1"></span>'+
          '<button class="tbtn" id="compliance-proceed-btn">仍要下載</button>'+
        '</div>'+
      '</div>'
    );
    overlay.querySelector('#compliance-cancel-btn').onclick = closePopup;
    overlay.querySelector('#compliance-proceed-btn').onclick = function(){
      closePopup();
      proceedFn();
    };
    /* 套用按鈕：直接呼叫跟inline版同一支applyBanwordFix()換字，換完關掉
       這個popup、重新呼叫confirmDownloadWithComplianceCheck()重新整段
       掃描一次——如果套用完已經沒有問題了會直接放行下載，還有其他問題
       就用最新的檢查結果重開一次popup，不用自己維護「套用後手動更新畫面
       文字/重算其他命中index」這些容易出錯的邏輯。 */
    Array.prototype.forEach.call(overlay.querySelectorAll('.banword-apply-btn'), function(btn){
      var item = applyable[Number(btn.dataset.idx)];
      btn.onclick = function(){
        applyBanwordFix(item.key, item.hit);
        closePopup();
        confirmDownloadWithComplianceCheck(proceedFn);
      };
    });
  });
}

function downloadSingle(layoutId){
  var canvas = canvases[layoutId];
  if(!canvas) return;
  var layout = LAYOUT_REGISTRY.find(function(l){ return l.id===layoutId; });
  var idx = layoutOrderIndex(layoutId);
  var namePart = layout ? layout.name : layoutId;
  var prefix = idx ? (idx+'_') : '';
  confirmDownloadWithComplianceCheck(function(){
    /* 匯出前先重畫一次「乾淨版本」（沒有綠色選取框/控制點）——如果畫布上
       目前正選著商品，drawHostOverlay()畫的選取框是直接畫在這個canvas
       本身的像素上，不重畫一次乾淨版本，選取框會被一起匯出到下載檔案裡。
       匯出完再呼叫renderAll()把畫面（含選取框，如果原本是選取狀態）
       還原回去，使用者不會感覺到畫面有閃一下的變化。 */
    renderLayoutClean(layoutId);
    exportLayoutBlob(layoutId, canvas).then(function(res){
      triggerDownload(res.blob, prefix+sanitizeFilename(namePart)+'.'+res.ext);
      renderAll();
    });
  });
}

/* 把目前的暫存資料（跟「儲存暫存」按鈕存的是同一份格式）包進zip裡的
   一個.json檔——使用者反映整包下載時如果忘記另外按「儲存暫存」，
   拿到的zip裡只有圖沒有可以之後讀回編輯器繼續調整的存檔，這裡直接
   內建一份，不用使用者自己額外記得存一次。 */
/* 2026-08起：downloadAll()已經改成自己在迴圈開始前直接組裝、序列化暫存檔
   內容(見下面downloadAll()裡的tempSaveJson)，不再呼叫這支函式——原因是
   這支函式內部呼叫的saveCurrentTabIntoData()，如果在「逐頁匯出圖片」的
   迴圈跑完之後才呼叫，會把全域S(這時候已經被迴圈裡最後一個分頁的資料
   佔用)錯誤寫回TABS[ACTIVE_TAB].data，覆蓋掉原本使用者所在那一頁的正確
   資料(2026-08發現的bug，症狀是「整包下載後畫面被最後一頁蓋掉、暫存檔
   內容跑掉、AR這類版位設定不見」)。
   這支函式保留著沒刪，是因為要留意：如果之後想在其他地方（例如新增一顆
   「手動存暫存檔」按鈕）重新用到它，只能在「畫面上目前這一頁」的情境下
   呼叫（此時S/ACTIVE_TAB/TABS三者本來就是對得上的，沒有downloadAll()
   那種「借用S逐頁畫布匯出」的特殊情境），不要在任何會迴圈切換多個分頁
   之後才呼叫這支函式，否則會重現同一個bug。 */
function buildTempSavePayload(){
  saveCurrentTabIntoData();
  return { version:1, tabs: TABS.map(function(t){ return t.data; }), activeTab: ACTIVE_TAB };
}

/* 依序把每個分頁(TABS)的畫布都匯出，各自放進zip裡一個以「曝光日期N」
   命名的子資料夾——一份Excel匯入出來的所有分頁，整包下載一次就給齊，
   不用一頁一頁分開下載。子資料夾名稱優先用tab.data.exposureLabel
   （例如'曝光日期1'、或'7/1-7/15'這種日期區間，見js/editor-import.js的
   splitRowsIntoBlocks()），實際命名經過formatExposureFolderName()處理
   （日期區間格式會轉成'0701-0715'這種補零、去斜線的寫法，不是簡單把
   斜線換成底線）；沒有這個資訊的分頁（例如手動建立的空白分頁、或沒有
   曝光日期區塊概念的舊格式工單）就退回用分頁標籤本身當資料夾名稱。
   外層zip檔名維持原本邏輯（使用者目前所在分頁的標籤，也就是這份工單的
   案名本身，不含曝光日期——見js/editor-import.js的importCircleExcel()，
   2026-08起orderName已經不再把曝光日期label接在案名後面了），只有zip
   「裡面」的子資料夾切法改變，使用者角度看起來就是「下載出來的zip打開後，
   0701-0715、0716-0731各自一個資料夾」。
   實際切換分頁去逐一渲染畫布是non-trivial的非同步流程（applyTabData→
   buildCanvasArea都是Promise鏈），跑完所有分頁之後要把畫面還原回使用者
   原本在看的那一頁，避免使用者按一次「整包下載」，畫面卻靜靜停在最後一頁。 */
function downloadAll(){
  confirmDownloadWithComplianceCheck(function(){
    var zip = new JSZip();
    var originalActiveTab = ACTIVE_TAB;
    saveCurrentTabIntoData();

    /* 2026-08修正重大bug：暫存檔內容要在「開始逐頁匯出圖片之前」就先拍好
       快照(這時候S/ACTIVE_TAB/TABS三者都還對得上，剛執行完上面那行
       saveCurrentTabIntoData()，資料是完整、正確的)，不能等下面的
       exportOneTab()迴圈跑完才呼叫buildTempSavePayload()。
       原因：exportOneTab()迴圈裡的applyTabData(i,...)只是暫時借用全域
       S去畫每個分頁的畫布，並不會同步更新ACTIVE_TAB——迴圈跑完後，S會
       停留在「最後一個分頁」的內容，但ACTIVE_TAB還是originalActiveTab。
       這時候如果才呼叫buildTempSavePayload()（裡面會再呼叫一次
       saveCurrentTabIntoData()，這個函式是寫回TABS[ACTIVE_TAB].data），
       就會把「最後一個分頁的內容」錯誤覆蓋寫回TABS[originalActiveTab].data，
       導致原本那一頁的文案/商品/已勾選版位(包含AR這種不是每個分頁都會
       出現的版位)全部被最後一頁的設定蓋掉——這正是使用者回報的「畫面被
       第二頁覆蓋」、「暫存檔跑掉」、「AR版位不見了」的成因。
       改成直接在這裡把JSON字串序列化好存進tempSaveJson，之後不管
       exportOneTab()迴圈怎麼借用S，都不會再影響這個已經序列化成字串的
       快照內容。 */
    var tempSaveJson = JSON.stringify({
      version: 1,
      tabs: TABS.map(function(t){ return t.data; }),
      activeTab: originalActiveTab
    });

    function exportOneTab(i, onAllDone){
      var tab = TABS[i];
      if(!tab){ onAllDone(); return; }

      applyTabData(i, function(){
        buildCanvasArea().then(function(){
          applyDefaultLogos(function(){
            renderAll();
            var order = activeLayouts(); // 已經照工單製作素材欄位順序排好
            /* 同downloadSingle()的理由：每個要匯出的版位都先重畫一次乾淨
               版本，避免目前選取中的商品選取框被一起匯出。 */
            order.forEach(function(layout){ renderLayoutClean(layout.id); });

            var folderName = formatExposureFolderName(tab.data.exposureLabel || tab.data.label || ('分頁'+(i+1)));
            var folder = zip.folder(folderName);

            var jobs = order.map(function(layout, idx){
              var canvas = canvases[layout.id];
              if(!canvas) return Promise.resolve();
              return exportLayoutBlob(layout.id, canvas).then(function(res){
                folder.file((idx+1)+'_'+sanitizeFilename(layout.name)+'.'+res.ext, res.blob);
              });
            });
            Promise.all(jobs).then(function(){ exportOneTab(i+1, onAllDone); });
          });
        });
      });
    }

    exportOneTab(0, function(){
      zip.file('暫存檔_'+Date.now()+'.json', tempSaveJson);

      zip.generateAsync({type:'blob'}).then(function(blob){
        /* zip檔本身的檔名維持原本邏輯：使用者按下「整包下載」當下所在的
           那一頁的分頁標籤，不受「裡面切了幾個子資料夾」影響。 */
        var tab = TABS[originalActiveTab];
        var tabName = tab ? tab.data.label : '未命名工單';
        triggerDownload(blob, sanitizeFilename(tabName)+'.zip');

        /* 匯出所有分頁的過程中，畫面實際上會依序閃過每一頁——匯出完成後
           把畫面切回使用者原本按下「整包下載」時所在的那一頁，不留在
           最後一頁，使用者不會感覺到「頁面被換掉了」。 */
        applyTabData(originalActiveTab, function(){
          refreshRightPanel();
          buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
        });
      });
    });
  });
}
