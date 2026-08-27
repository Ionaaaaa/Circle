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
  var limitKB = EXPORT_SIZE_LIMIT_KB[layoutId];
  if(limitKB){
    return exportCanvasWithSizeLimit(canvas, limitKB).then(function(blob){
      return { blob: blob, ext: 'jpg' };
    });
  }
  if(EXPORT_JPEG_NO_LIMIT[layoutId]){
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

    var lines = [];
    result.overLimit.forEach(function(o){
      lines.push('・'+o.key+'字數超過上限（目前'+(Number.isInteger(o.weight)?o.weight:o.weight.toFixed(1))+'／上限'+o.limit+'）');
    });
    result.banned.forEach(function(b){
      b.hits.forEach(function(h){
        lines.push('・'+b.key+'包含禁用語「'+esc(h.matchedText)+'」'+(h.replace ? '，建議改成「'+esc(h.replace)+'」' : (h.note ? '（'+esc(h.note)+'）' : '')));
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
function buildTempSavePayload(){
  saveCurrentTabIntoData();
  return { version:1, tabs: TABS.map(function(t){ return t.data; }), activeTab: ACTIVE_TAB };
}

function downloadAll(){
  confirmDownloadWithComplianceCheck(function(){
    var zip = new JSZip();
    var order = activeLayouts(); // 已經照工單製作素材欄位順序排好
    /* 同downloadSingle()的理由：整包下載前，每個要匯出的版位都先重畫一次
       乾淨版本，避免目前選取中的商品選取框被一起匯出。 */
    order.forEach(function(layout){ renderLayoutClean(layout.id); });
    var jobs = order.map(function(layout, i){
      var canvas = canvases[layout.id];
      if(!canvas) return Promise.resolve();
      return exportLayoutBlob(layout.id, canvas).then(function(res){
        zip.file((i+1)+'_'+sanitizeFilename(layout.name)+'.'+res.ext, res.blob);
      });
    });
    Promise.all(jobs).then(function(){
      var payload = buildTempSavePayload();
      zip.file('暫存檔_'+Date.now()+'.json', JSON.stringify(payload));
      return zip.generateAsync({type:'blob'});
    }).then(function(blob){
      /* zip檔本身的檔名用目前分頁的名稱（工單標題），不是固定的
         「circle_全部版位」——使用者反映整包下載出來的檔案要看得出來是哪個
         案子，用分頁標籤最直覺，因為那本來就是匯入時取自Excel「工作項目
         名稱」的內容。 */
      var tab = TABS[ACTIVE_TAB];
      var tabName = tab ? tab.data.label : '未命名工單';
      triggerDownload(blob, sanitizeFilename(tabName)+'.zip');
      renderAll(); // 還原畫面（含選取框，如果原本是選取狀態）
    });
  });
}
