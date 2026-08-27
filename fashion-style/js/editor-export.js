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
  var ruleId = (window.LAYOUT_ALIAS_BASE && window.LAYOUT_ALIAS_BASE[layoutId]) || layoutId;
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
function buildTempSavePayload(){
  saveCurrentTabIntoData();
  return { version:1, tabs: TABS.map(function(t){ return t.data; }), activeTab: ACTIVE_TAB };
}

/* 依序把每個分頁(TABS)的畫布都匯出，各自放進zip裡一個以「曝光日期N」
   命名的子資料夾——一份Excel匯入出來的所有分頁，整包下載一次就給齊，
   不用一頁一頁分開下載。子資料夾名稱優先用tab.data.exposureLabel
   （例如'曝光日期1'，見js/editor-import.js的splitRowsIntoBlocks()），
   沒有這個資訊的分頁（例如手動建立的空白分頁、或沒有曝光日期區塊概念的
   舊格式工單）就退回用分頁標籤本身當資料夾名稱。
   外層zip檔名維持原本邏輯不變（使用者目前所在分頁的標籤），只有zip「裡面」
   的子資料夾切法改變，使用者角度看起來就是「下載出來的zip打開後，曝光
   日期1、曝光日期2各自一個資料夾」。
   實際切換分頁去逐一渲染畫布是non-trivial的非同步流程（applyTabData→
   buildCanvasArea都是Promise鏈），跑完所有分頁之後要把畫面還原回使用者
   原本在看的那一頁，避免使用者按一次「整包下載」，畫面卻靜靜停在最後一頁。 */
function downloadAll(){
  confirmDownloadWithComplianceCheck(function(){
    var zip = new JSZip();
    var originalActiveTab = ACTIVE_TAB;
    saveCurrentTabIntoData();

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

            var folderName = sanitizeFilename(tab.data.exposureLabel || tab.data.label || ('分頁'+(i+1)));
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
      var payload = buildTempSavePayload();
      zip.file('暫存檔_'+Date.now()+'.json', JSON.stringify(payload));

      zip.generateAsync({type:'blob'}).then(function(blob){
        /* zip檔本身的檔名維持原本邏輯：使用者按下「整包下載」當下所在的
           那一頁的分頁標籤，不受「裡面切了幾個子資料夾」影響。 */
        var tab = TABS[originalActiveTab];
        /* zip檔名優先用baseName(不含'／A版'這種區塊後綴的純工單名稱)——
           使用者反映在B版分頁按「整包下載」，檔名卻跑出「／B版」的後綴，
           很奇怪。整包下載本來就是把所有分頁一次打包，檔名不該跟著「按下
           當下你在哪一頁」而長出不一樣的後綴，用baseName就不會有這個問題。
           舊格式沒有baseName欄位的分頁(沒有共用商品/多區塊工單這種特徵的
           舊資料)才退回用tab.data.label，不會壞掉。 */
        var tabName = tab ? (tab.data.baseName || tab.data.label) : '未命名工單';
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
