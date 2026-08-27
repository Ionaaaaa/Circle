'use strict';
/*
  editor-popups.js
  ------------------------------------------------------------
  匯入流程：
    1. openImportModal()      —— Excel工單 + 素材資料夾雙上傳，確認匯入後
                                  LOGO1/LOGO2背景直接套用（LOGO2有勾選就
                                  跳出logo2-editor.js的完整編輯視窗確認/
                                  調整），接著跳商品/陰影確認popup
    2. openProductConfirmPopup() —— 資料夾裡比對到的人物/商品素材，開
                                  1200x1200陰影合成畫布確認/調整
    3. openPositionEditor(id) —— 針對單一版位微調 LOGO/CTA跟人物商品槽位位置
*/

/* 拖曳方框在popup裡的預覽寬高比，只是視覺猜測值（實際畫布渲染永遠用圖片真實比例，
   這裡猜不準也不影響輸出結果，只是拖曳時的方框看起來合不合理）。
   host是1200x1200合成圖裡的人物/商品組合，通常偏窄長（人形），不是logo1/logo2那種
   橫幅形狀，特別抓出來給合理一點的猜測比例。 */
function boxAspectGuess(kind, key){
  if(key === 'host') return 0.7;
  return kind==='asset' ? 2.2 : 0.75;
}

function closePopup(){
  var el = document.getElementById('popup-overlay');
  if(el) el.remove();
}

function createOverlay(innerHTML){
  closePopup();
  var overlay = document.createElement('div');
  overlay.id = 'popup-overlay';
  overlay.className = 'popup-overlay';
  overlay.innerHTML = innerHTML;
  /* 2026-08：使用者反映「不小心點到popup外面的深色區域，popup就關掉了」，
     改成點背景完全不會關閉popup——popup只能透過右上角×或明確的按鈕
     （確認/取消/移除等）關閉，避免誤觸就整個關掉、資料流程被打斷。 */
  document.body.appendChild(overlay);
  return overlay;
}

/* ══════════════════ 1. 匯入工單彈窗（Excel + 資料夾 雙上傳） ══════════════════ */

var _importState = { excelFile:null, folderFiles:[] };

function openImportModal(){
  _importState = { excelFile:null, folderFiles:[] };

  var overlay = createOverlay(
    '<div class="popup-panel" style="width:440px;">'+
      '<div class="popup-head"><span>匯入工單</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body">'+

        '<div id="zone-excel" class="dropzone">'+
          '<div class="dropzone-icon">'+ICON_FILE+'</div>'+
          '<div id="zone-excel-title">拖曳 Excel 工單到這裡</div>'+
          '<div class="hint" style="margin-top:4px;">或點擊選擇檔案</div>'+
        '</div>'+

        '<div id="zone-folder" class="dropzone" style="margin-top:14px;">'+
          '<div class="dropzone-icon">'+ICON_FOLDER+'</div>'+
          '<div id="zone-folder-title">上傳素材資料夾（LOGO1／LOGO2＋人物／商品，可選）</div>'+
          '<div class="hint" style="margin-top:4px;">依檔名自動比對到對應槽位，點擊選擇資料夾</div>'+
        '</div>'+

      '</div>'+
      '<div class="popup-foot">'+
        '<button class="tbtn primary" id="confirm-import-btn">確認匯入</button>'+
      '</div>'+
    '</div>'
  );

  var zoneExcel = overlay.querySelector('#zone-excel');
  var zoneFolder = overlay.querySelector('#zone-folder');
  var excelInput = document.getElementById('excel-import');
  var folderInput = document.getElementById('folder-import');

  zoneExcel.onclick = function(){ excelInput.click(); };
  zoneFolder.onclick = function(){ folderInput.click(); };

  bindDropzone(zoneExcel, function(file){
    _importState.excelFile = file;
    zoneExcel.querySelector('#zone-excel-title').textContent = '已選擇：'+file.name;
    zoneExcel.classList.add('dropzone-success');
  });

  excelInput.onchange = function(){
    var f = excelInput.files[0];
    if(f){
      _importState.excelFile = f;
      zoneExcel.querySelector('#zone-excel-title').textContent = '已選擇：'+f.name;
      zoneExcel.classList.add('dropzone-success');
    }
    excelInput.value = '';
  };

  folderInput.onchange = function(){
    var files = Array.prototype.slice.call(folderInput.files);
    if(files.length){
      _importState.folderFiles = files;
      var imgCount = files.filter(function(f){ return /\.(png|jpe?g|webp)$/i.test(f.name); }).length;
      zoneFolder.querySelector('#zone-folder-title').textContent = '已讀取 '+imgCount+' 張素材圖片';
      zoneFolder.classList.add('dropzone-success');
    }
    folderInput.value = '';
  };

  /* 拖曳資料夾上傳：見bindFolderDropzone()跟readEntryFilesRecursive()的說明，
     跟上面點擊選資料夾（webkitdirectory）走的是完全不同的瀏覽器API，
     兩條路徑最後都會匯到同一個_importState.folderFiles，後續處理邏輯共用。 */
  bindFolderDropzone(zoneFolder, zoneFolder.querySelector('#zone-folder-title'), function(files){
    _importState.folderFiles = files;
    zoneFolder.classList.add('dropzone-success');
  });

  overlay.querySelector('#confirm-import-btn').onclick = function(){
    var btn = this;
    if(btn.disabled) return; // 防止手殘連點/雙擊觸發兩次runImport()，造成重複分頁
    btn.disabled = true;
    /* ★ 不要在這裡直接closePopup()——runImport()裡面的Excel解析是非同步的
       （FileReader/XLSX.read都要花時間），如果現在就把popup關掉，
       從「匯入中」到「下一個popup(LOGO確認/1200畫布)真的開起來」這段
       空窗期，畫面上會完全沒有任何遮罩，任何人都可以正常點擊背景的其他
       東西——很可能就是這樣才會在匯入過程中不小心觸發到別的操作
       （例如背景被連續觸發呼叫applyDefaultLogos()，進而搞亂LOGO2的
       合成狀態）。改成先換成一個「匯入中」的loading畫面撐著，一路撐到
       下一個真正的popup開起來為止——createOverlay()本身就會在建立新
       popup前先closePopup()清掉舊的，這裡完全不用自己手動關，銜接
       起來不會有任何空窗期。 */
    createOverlay(
      '<div class="popup-panel" style="width:320px;">'+
        '<div class="popup-body" style="text-align:center;padding:32px 16px;">'+
          '<div class="hint" style="margin:0;">匯入中，請稍候…</div>'+
        '</div>'+
      '</div>'
    );
    runImport(_importState.excelFile, _importState.folderFiles);
  };
}

function bindDropzone(zone, onFile){
  ['dragenter','dragover'].forEach(function(evt){
    zone.addEventListener(evt, function(e){ e.preventDefault(); e.stopPropagation(); zone.classList.add('dropzone-active'); });
  });
  ['dragleave','drop'].forEach(function(evt){
    zone.addEventListener(evt, function(e){ e.preventDefault(); e.stopPropagation(); zone.classList.remove('dropzone-active'); });
  });
  zone.addEventListener('drop', function(e){
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    if(file) onFile(file);
  });
}

/* ══════════════════ 拖曳上傳素材資料夾 ══════════════════
   點擊選資料夾（<input webkitdirectory>）跟拖曳資料夾走的是兩套完全不同的
   瀏覽器API：前者瀏覽器自動幫你走訪整個資料夾、攤平成完整檔案清單；後者要
   自己用 DataTransferItem.webkitGetAsEntry() 拿到 FileSystemEntry，再自己
   寫遞迴一層層爬。這裡就是那段自己爬的邏輯（含巢狀子資料夾、多個item）。

   讀到的 File 物件本身 webkitRelativePath 會是空字串（這是瀏覽器自動走訪
   資料夾時才會順便填的欄位，拖曳這條路徑瀏覽器不參與走訪，不會填），但這個
   專案的比對邏輯（matchFileByAliases／matchAssetFolder）本來就只比對檔名
   本身，不依賴路徑，所以這裡不需要額外掛路徑欄位也能正確運作。 */

/* 讀單一 entry（檔案或資料夾）底下所有檔案，遞迴收集進 out 陣列。
   done() 是「這個 entry 這條分支處理完了」的callback，用計數器等所有分支
   都done()完才算整個資料夾讀完（見 readDroppedItems）。
   單一檔案或子資料夾讀取失敗時記錄警告並直接done()跳過，不讓整批卡住
   （file()/readEntries()是原生非同步callback，外層try/catch攔不到，
   只能在各自的錯誤callback裡處理）。 */
function readEntryFilesRecursive(entry, out, done){
  if(!entry){ done(); return; }
  if(entry.isFile){
    entry.file(function(file){
      out.push(file);
      done();
    }, function(err){
      console.warn('[拖曳上傳] 讀取檔案失敗，已跳過：'+entry.fullPath, err);
      done();
    });
    return;
  }
  if(entry.isDirectory){
    var reader = entry.createReader();
    var allEntries = [];
    function readBatch(){
      /* readEntries()一次最多回傳約100筆，要用「回傳0筆才算真的讀完」
         的方式重複呼叫，不能只呼叫一次就當作資料夾內容已經讀完整份。 */
      reader.readEntries(function(batch){
        if(!batch.length){
          if(!allEntries.length){ done(); return; }
          var pending = allEntries.length;
          allEntries.forEach(function(childEntry){
            readEntryFilesRecursive(childEntry, out, function(){
              pending--;
              if(pending<=0) done();
            });
          });
          return;
        }
        allEntries = allEntries.concat(batch);
        readBatch();
      }, function(err){
        console.warn('[拖曳上傳] 讀取子資料夾失敗，已跳過：'+entry.fullPath, err);
        done();
      });
    }
    readBatch();
    return;
  }
  done(); // 既不是檔案也不是資料夾（理論上不會發生），直接跳過
}

/* 處理整個 DataTransferItemList：逐一檢查每個項目是否支援entry API
  （不是只看items[0]，避免非檔案項目排在最前面時誤判整批不支援），
   支援的用遞迴走訪、不支援的（例如舊瀏覽器，或拖進來的不是檔案系統項目）
   直接退回它本身的File物件（如果有的話）。全部處理完才呼叫 onDone(files)。 */
function readDroppedItems(items, onDone){
  var files = [];
  var list = Array.prototype.slice.call(items || []);
  if(!list.length){ onDone(files); return; }

  var pending = list.length;
  function oneDone(){
    pending--;
    if(pending<=0) onDone(files);
  }

  list.forEach(function(item){
    if(item.kind !== 'file'){ oneDone(); return; }
    var entry = (typeof item.webkitGetAsEntry === 'function') ? item.webkitGetAsEntry() : null;
    if(entry){
      readEntryFilesRecursive(entry, files, oneDone);
    } else {
      var f = item.getAsFile && item.getAsFile();
      if(f) files.push(f);
      oneDone();
    }
  });
}

/* 資料夾dropzone專用的拖放綁定：跟bindDropzone()不一樣的地方是它要收集
   「一整批」檔案（可能來自巢狀資料夾），不是只取第一個檔案。 */
function bindFolderDropzone(zone, titleEl, onFiles){
  ['dragenter','dragover'].forEach(function(evt){
    zone.addEventListener(evt, function(e){ e.preventDefault(); e.stopPropagation(); zone.classList.add('dropzone-active'); });
  });
  zone.addEventListener('dragleave', function(e){ e.preventDefault(); e.stopPropagation(); zone.classList.remove('dropzone-active'); });
  zone.addEventListener('drop', function(e){
    e.preventDefault(); e.stopPropagation();
    zone.classList.remove('dropzone-active');

    var dt = e.dataTransfer;
    if(!dt) return;

    /* 沒有items（極少數環境）或items不支援webkitGetAsEntry：退回舊版
       單層files清單（沒有子資料夾遞迴，但至少不會整個失敗沒反應）。 */
    if(!dt.items || !dt.items.length){
      var flatFiles = dt.files ? Array.prototype.slice.call(dt.files) : [];
      if(!flatFiles.length){
        alert('沒有偵測到拖曳的檔案，請改用點擊選擇資料夾。');
        return;
      }
      onFiles(flatFiles);
      return;
    }

    titleEl.textContent = '讀取中…';
    readDroppedItems(dt.items, function(files){
      var imageFiles = files.filter(function(f){ return /\.(png|jpe?g|webp)$/i.test(f.name); });
      if(!files.length){
        alert('這個資料夾裡沒有讀到任何檔案，瀏覽器可能不支援拖曳資料夾，請改用點擊選擇資料夾。');
        titleEl.textContent = '上傳素材資料夾（LOGO1／LOGO2＋人物／商品，可選）';
        return;
      }
      onFiles(files);
      titleEl.textContent = '已讀取 '+imageFiles.length+' 張素材圖片';
    });
  });
}

/* Excel（可選）+ 資料夾（可選）都處理完，才建立分頁；有比對到素材才接著跳確認popup */
function runImport(excelFile, folderFiles){
  /* 這個chain是固定順序、一定會跑：匯入 → LOGO確認popup → 商品/主持人1200畫布popup，
     不管資料夾裡有沒有比對到檔案都一樣要走完整個流程——比對不到就是空的popup、
     空的1200畫布，讓使用者自己在裡面上傳，而不是悄悄跳過整個確認步驟。
     （之前這裡用 if(matched裡有東西) 當作要不要開popup的條件，資料夾檔名沒對到
     任何別名清單的話，使用者會完全看不到任何popup，也不知道發生了什麼事——
     這是先前回報「匯入後沒跳出1200畫布」的根本原因。）

     資料夾比對現在要等Excel解析完才能做（要用Excel「曝品表」裡實際指定的
     商品名稱去比對檔名，比固定別名猜測準很多），所以matchAssetFolder()
     搬進afterParsed()裡面、excel解析完成之後才呼叫，不是一開始就做。 */

  /* ★ 修正「匯入完出現2個一模一樣分頁」：如果addTabFromImport()成功建立分頁
     之後，afterParsed()裡面接下來的流程（例如openLogo2Editor／
     proceedToShadowFromImport）丟出例外，這個例外會讓.then(afterParsed)
     整條Promise變成rejected，於是外層.catch()會接住並且再呼叫一次
     afterParsed(null)——等於同一次匯入動作，addTabFromImport()被呼叫了
     兩次，第一次用真正解析出來的資料建立分頁，第二次用同一份資料（因為
     matched/exposure等變數是closure共用的，不是null）又建立一個內容一樣的
     分頁，畫面上就會看到兩個分頁名稱一模一樣。用tabCreated這個旗標記住
     「這次呼叫是不是已經成功建立過分頁了」，.catch()只有在真的還沒建立過
     分頁時才補呼叫afterParsed(null)，避免同一次匯入重複建立分頁。 */
  var tabCreated = false;

  /* ══════════════════ 共用商品快照 ══════════════════
     有些工單（例如蝦皮流行穿搭案）的曝品表只寫一次、給好幾個區塊共用
     (見js/editor-import.js的parsed.sharedExposure標記)——這種情況下，
     商品/主持人只需要使用者在1200畫布排一次，後面標記為共用的區塊直接
     複製這裡存的快照，不用重複跳出1200畫布問一次一模一樣的商品。
     LOGO/文案這些「本來就允許每個區塊各自不同」的東西完全不受影響，
     只有商品這塊會被複製。 */
  var sharedProductSnapshot = null;

  /* 給這批匯入裡所有標記sharedExposure的區塊，用同一個ID串起來——之後
     使用者在任一個分頁重新「編輯商品」調整完，js/editor-main.js的
     propagateSharedProductToLinkedTabs()會找出所有一樣這個ID的分頁，
     自動同步過去，不用每個分頁各調一次。只是個遞增計數字串，不需要真的
     全域唯一（同一次runImport()的closure用完就丟，不會跟其他次匯入的
     ID撞在一起造成串連錯誤——因為比對的時候本來就是精確字串比對，不同
     次匯入各自的ID字串本來就長得不一樣）。 */
  var sharedGroupId = null;

  function captureSharedSnapshotIfNeeded(parsed){
    if(!(parsed && parsed.sharedExposure) || sharedProductSnapshot) return;
    sharedProductSnapshot = {
      host: S.assets && S.assets.host, // Image物件，故意用參照共用，不用clone(圖片資料本來就不可變)
      shadowCombo: S.shadowCombo,
      shadowAngle: S.shadowAngle,
      shadowSlots: JSON.parse(JSON.stringify(S.shadowSlots || {})),
      shadowPolaroid: JSON.parse(JSON.stringify(S.shadowPolaroid || {})),
      shadowSlotOriginal: JSON.parse(JSON.stringify(S.shadowSlotOriginal || {})),
      shadowOrder: S.shadowOrder ? S.shadowOrder.slice() : null,
      stageTransform: S.stageTransform ? JSON.parse(JSON.stringify(S.stageTransform)) : null,
      stageEnabled: S.stageEnabled
    };
  }

  /* 把共用快照套到「目前這個分頁」（呼叫端要自己先確保S已經是新分頁的
     狀態，也就是addTabFromImport()已經跑完之後）。回傳true代表真的套用
     成功（有快照可以用），false代表還沒有快照(理論上不會發生在
     sharedExposure的區塊上，因為一定是第一個區塊先跑過一輪真正的
     1200畫布流程，才會產生快照)，呼叫端這時候會退回正常流程，不會卡住。 */
  function applySharedSnapshotToCurrentTab(){
    if(!sharedProductSnapshot) return false;
    S.assets = S.assets || {};
    S.assets.host = sharedProductSnapshot.host;
    S.shadowCombo = sharedProductSnapshot.shadowCombo;
    S.shadowAngle = sharedProductSnapshot.shadowAngle;
    S.shadowSlots = JSON.parse(JSON.stringify(sharedProductSnapshot.shadowSlots));
    S.shadowPolaroid = JSON.parse(JSON.stringify(sharedProductSnapshot.shadowPolaroid));
    S.shadowSlotOriginal = JSON.parse(JSON.stringify(sharedProductSnapshot.shadowSlotOriginal));
    S.shadowOrder = sharedProductSnapshot.shadowOrder ? sharedProductSnapshot.shadowOrder.slice() : null;
    S.stageTransform = sharedProductSnapshot.stageTransform ? JSON.parse(JSON.stringify(sharedProductSnapshot.stageTransform)) : null;
    S.stageEnabled = sharedProductSnapshot.stageEnabled;
    return true;
  }

  /* 一個區塊(parsed)走一輪「建分頁→LOGO→LOGO2→商品陰影」確認流程，
     跟以前單一區塊的流程完全一樣；差別只在流程最後不是直接結束，而是
     呼叫done()——如果Excel有下一個「曝光日期」區塊，done()會接著處理
     下一個區塊，一路把每個區塊各自的分頁跟確認popup都跑過一輪，使用者
     一個一個確認，不會兩個區塊的popup疊在一起搶畫面。 */
  function processOneBlock(parsed, done){
    var exposure = parsed && parsed.exposure;
    /* logo2MaterialName：工單「LOGO」那格填的廠商/品牌名稱（例如"善存"），
       當作logo2的額外比對關鍵字傳進matchAssetFolder()——見editor-import.js
       的parseLogo2Info()跟matchAssetFolder()的extraAliases參數說明。 */
    var extraAliases = (parsed && parsed.logo2MaterialName) ? { logo2: [parsed.logo2MaterialName] } : null;
    var matched = (folderFiles && folderFiles.length)
      ? matchAssetFolder(folderFiles, exposure && exposure.items, extraAliases)
      : {};
    addTabFromImport(parsed || { orderName:'未命名工單', textGroups:{'文案1':{}}, materials:[], materialItems:[] });
    tabCreated = true;

    /* 標記這個分頁的商品是不是跟其他分頁共用——共用的話，這批匯入裡第一次
       遇到就生一個新的groupId，後面遇到的沿用同一個，讓
       propagateSharedProductToLinkedTabs()之後找得到彼此。 */
    if(parsed && parsed.sharedExposure){
      if(!sharedGroupId) sharedGroupId = 'shared-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      S.sharedProductGroupId = sharedGroupId;
      if(TABS[ACTIVE_TAB]) TABS[ACTIVE_TAB].data.sharedProductGroupId = sharedGroupId; // 直接也寫進tab.data，不用等下一次saveCurrentTabIntoData()才補上
    }

    /* AR文案要用哪一組文案的值：AR只有一個版位，這裡先簡化直接用這個區塊
       第一組文案的值（多組文案的情況本來就很少見AR也被特別指定分組）。 */
    var firstGroupKey = parsed && parsed.textGroups ? Object.keys(parsed.textGroups)[0] : null;
    var arText = parsed && parsed.textGroups && firstGroupKey ? parsed.textGroups[firstGroupKey] : null;
    applyArFromImport(matched, arText, parsed && parsed.arInfo);

    /* ★使用者確認過：不需要「確認LOGO」這個列表式popup了（LOGO1/LOGO2各一列、
       按鈕才能調整/編輯的那個）——直接背景套用LOGO1，LOGO2如果有勾選
       （工單「LOGO」那格，見parseLogo2Info()）就自動套用+跳出「編輯LOGO2」
       那個可以滾輪縮放/拖曳調整的完整編輯視窗，關掉後直接接續商品/陰影
       確認流程，不用先經過一個列表popup再點進去編輯。 */
    if(matched.logo1) loadAssetFile('logo1', matched.logo1, renderAll);

    var logo2Checked = !(parsed && parsed.logo2Checked === false);

    function goToShadowStep(){
      renderAll();
      /* 這個區塊的商品是「跟其他區塊共用」的（見parsed.sharedExposure）、
         而且已經有前面某個區塊排好的快照可以直接複製——跳過1200畫布，
         不用讓使用者對著同一組商品重複排列一次。 */
      if(parsed && parsed.sharedExposure && applySharedSnapshotToCurrentTab()){
        renderAll();
        done();
        return;
      }
      proceedToShadowFromImport(matched, exposure, function(){
        captureSharedSnapshotIfNeeded(parsed);
        done();
      });
    }

    if(!logo2Checked){
      goToShadowStep();
      return;
    }

    if(matched.logo2){
      logo2AutoApplyFromFile(matched.logo2, function(err){
        if(err) console.warn('[editor-popups] logo2自動套用失敗：', err);
        renderAll();
        openLogo2Editor(goToShadowStep);
      });
    } else {
      // 有勾選但資料夾沒比對到檔案：一樣跳出編輯視窗，讓使用者可以手動上傳
      openLogo2Editor(goToShadowStep);
    }
  }

  /* parsedResult是importCircleExcel()回傳的{blocks:[...]}——一份Excel可能
     有好幾個「曝光日期」區塊，依序一個一個處理(見processOneBlock的done
     callback鏈)；完全沒有Excel(excelFile未提供)或解析失敗時，退回只處理
     一個空白區塊，行為跟以前「Excel可選」一致。 */
  function afterParsed(parsedResult){
    var blocks = (parsedResult && parsedResult.blocks && parsedResult.blocks.length)
      ? parsedResult.blocks
      : [null];
    var idx = 0;
    (function next(){
      if(idx >= blocks.length) return;
      var block = blocks[idx++];
      processOneBlock(block, next);
    })();
  }

  if(excelFile){
    importCircleExcel(excelFile).then(afterParsed).catch(function(err){
      if(tabCreated){
        /* 至少有一個分頁已經建立成功了，是後面的流程（LOGO/商品確認popup那段）
           出錯，不是Excel解析本身失敗——只提示錯誤，不要再呼叫一次afterParsed(null)
           重新建立一個內容一樣的分頁。 */
        console.error('[匯入] 分頁已建立，但後續流程發生錯誤：', err);
        alert('工單已匯入，但後續流程發生錯誤，請檢查LOGO／商品設定：'+err.message);
        return;
      }
      alert('Excel匯入失敗：'+err.message);
      console.error(err);
      afterParsed(null);
    });
  } else {
    afterParsed(null);
  }
}

/* ══════════════════ 1b. LOGO確認 → 商品確認（可拖曳調整＋廣播） ══════════════════ */

/* 資料夾裡比對到的人物/商品檔案，不再用「靜態預覽+廣播位置」這套（那套只適合
   logo1/logo2這種『整版位一張圖』的素材）。人物/商品是要先在1200x1200合成畫布裡
   排好相對位置、陰影、前後順序，所以這裡改成：直接把比對到的檔案讀成dataURL塞進
   S.shadowSlots，決定組合(combo)，然後打開真正的陰影合成popup讓使用者確認/調整
   ——popup本身就是「確認畫面」，不需要另外做一層預覽。
   這一步固定會開，即使資料夾完全沒比對到人物/商品檔案也一樣（開一個空的
   1200畫布讓使用者自己上傳），不會悄悄跳過。

   組合怎麼決定，優先順序：
     1. Excel「曝品」表格自己講明的組合（exposure.comboLetter）——這是最準的，
        工單本來就寫了要用哪個組合，不用用猜的
     2. 猜不到才退回 guessComboFromMatchedSlots()，依照資料夾實際比對到哪些
        槽位反推一個最合理的組合 */
function proceedToShadowFromImport(matched, exposure, onConfirm){
  var shadowKeys = ['人物1','人物2','商品1(左)','商品2(中)','商品3(右)'];
  var matchedShadowKeys = shadowKeys.filter(function(k){ return matched[k]; });

  var comboFromExcel = exposure && exposure.comboLetter;

  if(!matchedShadowKeys.length){
    if(comboFromExcel) S.shadowCombo = comboFromExcel;
    openShadowPopup(onConfirm); // 沒比對到任何檔案，還是要開popup，只是裡面是空的
    return;
  }

  var pending = matchedShadowKeys.length;
  matchedShadowKeys.forEach(function(slotId){
    var type = (slotId.indexOf('人物')===0) ? 'person' : 'product';
    var ratio = matched[slotId].__importRatio; // Excel曝品表給的比例(大/中/小換算成的倍率)
    var reader = new FileReader();
    reader.onload = function(ev){
      S.shadowSlots = S.shadowSlots || {};
      S.shadowSlots[slotId] = { dataUrl: ev.target.result, type: type, ratio: ratio };
      pending--;
      if(pending<=0){
        S.shadowCombo = comboFromExcel || guessComboFromMatchedSlots(matchedShadowKeys);
        openShadowPopup(onConfirm);
      }
    };
    reader.readAsDataURL(matched[slotId]);
  });
}

/* 依比對到哪些槽位，猜一個最合理的組合，使用者進popup後還是可以自己改。
   只在Excel沒有講明組合時才會用到這個（見上面proceedToShadowFromImport）。 */
function guessComboFromMatchedSlots(keys){
  var hasP1 = keys.indexOf('人物1')>=0, hasP2 = keys.indexOf('人物2')>=0;
  var productCount = keys.filter(function(k){ return k.indexOf('商品')===0; }).length;
  if(hasP1 && hasP2) return 'A';
  if(hasP1 && productCount>0) return 'C'; // Circle介面顯示「B組合(1人+2品)」
  return 'D'; // 純商品，Circle介面顯示「C組合(3品)」
}

/* ══════════════════ 2. 單一版位的位置調整popup ══════════════════ */

function openPositionEditor(layoutId){
  var layout = LAYOUT_REGISTRY.find(function(l){ return l.id===layoutId; });
  var bundle = bundles[layoutId];
  if(!layout || !bundle){ return; }

  var cfg = bundle.layoutConfig;
  var DISPLAY_W = Math.min(720, cfg.canvas.w);
  var scale = DISPLAY_W / cfg.canvas.w;
  var DISPLAY_H = cfg.canvas.h * scale;

  var overlay = createOverlay(
    '<div class="popup-panel" style="width:'+(DISPLAY_W+40)+'px;">'+
      '<div class="popup-head"><span>調整位置 － '+layout.name+'</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body">'+
        '<div class="pos-editor-stage" style="width:'+DISPLAY_W+'px;height:'+DISPLAY_H+'px;">'+
          '<canvas id="pos-bg-canvas" width="'+cfg.canvas.w+'" height="'+cfg.canvas.h+'" style="width:'+DISPLAY_W+'px;height:'+DISPLAY_H+'px;"></canvas>'+
          '<div id="pos-boxes"></div>'+
        '</div>'+
        '<div class="hint" style="margin-top:10px;">拖曳方塊移動位置；拖右下角小方點調整大小。這裡只影響這一個版位；要一次調整所有版位，改用匯入時的LOGO/商品確認popup。</div>'+
      '</div>'+
      '<div class="popup-foot">'+
        '<button class="tbtn" id="pos-reset-btn">還原這個版位的預設位置</button>'+
        '<button class="tbtn primary" id="pos-save-btn">套用</button>'+
      '</div>'+
    '</div>'
  );

  var bgCanvas = overlay.querySelector('#pos-bg-canvas');
  var boxesRoot = overlay.querySelector('#pos-boxes');

  var existing = (S.positionOverrides && S.positionOverrides[layoutId]) || {};
  var draftOverride = JSON.parse(JSON.stringify(existing));
  draftOverride.assets = draftOverride.assets || {};
  draftOverride.slots = draftOverride.slots || {};
  draftOverride.slots[S.combo] = draftOverride.slots[S.combo] || {};

  function currentPositions(){
    return Core.mergePositions(bundle.positions, draftOverride);
  }

  function redrawBg(){
    /* 這裡的layoutId故意傳null（見上面的說明：positions已經在
       currentPositions()自己併過draftOverride了，Core.render內部如果
       又拿真正的layoutId去查一次S.positionOverrides會重複套用）。
       但文字要正確顯示的話，還是要手動塞這個版位實際對應的那組文案，
       不然S(全域狀態)已經沒有.text這個欄位了，背景預覽會整個看不到文字。 */
    var groupText = (S.textGroups && S.textGroups[groupKeyForLayout(layoutId)]) || emptyTextGroup();
    Core.render(bgCanvas, {
      layoutConfig: cfg,
      comboMatrix: bundle.comboMatrix,
      positions: currentPositions()
    }, Object.assign({}, S, { text: groupText }), null);
  }

  function buildBoxes(){
    boxesRoot.innerHTML = '';
    var positions = currentPositions();
    var items = [];

    Object.keys(positions.assets || {}).forEach(function(key){
      items.push({ key:key, kind:'asset', pos:positions.assets[key] });
    });
    var comboSlots = (bundle.comboMatrix.combos[S.combo]||{}).slots || {};
    Object.keys(comboSlots).forEach(function(slotId){
      if(comboSlots[slotId]===1 && positions.slots && positions.slots[S.combo] && positions.slots[S.combo][slotId]){
        items.push({ key:slotId, kind:'slot', pos:positions.slots[S.combo][slotId] });
      }
    });

    items.forEach(function(item){ boxesRoot.appendChild(makeBox(item)); });
  }

  function makeBox(item){
    var pos = item.pos;
    var boxH = pos.hPct * DISPLAY_H;
    var boxW = boxH * boxAspectGuess(item.kind, item.key);
    var left, top;
    if(item.kind==='asset'){
      left = pos.xPct*DISPLAY_W - (pos.align==='center' ? boxW/2 : 0);
      top = pos.yPct*DISPLAY_H;
    } else {
      left = pos.xPct*DISPLAY_W - boxW/2; top = pos.yPct*DISPLAY_H - boxH;
    }

    var box = document.createElement('div');
    box.className = 'pos-box';
    box.style.left = left+'px'; box.style.top = top+'px';
    box.style.width = boxW+'px'; box.style.height = boxH+'px';
    box.innerHTML = '<span class="pos-box-label">'+item.key+'</span><span class="pos-box-handle"></span>';

    box.addEventListener('mousedown', function(e){
      if(e.target.classList.contains('pos-box-handle')) return;
      e.preventDefault();
      var startX=e.clientX, startY=e.clientY;
      var startXPct=pos.xPct, startYPct=pos.yPct;
      function onMove(e2){
        pos.xPct = startXPct + (e2.clientX-startX)/DISPLAY_W;
        pos.yPct = startYPct + (e2.clientY-startY)/DISPLAY_H;
        writeBack(item);
        redrawBg(); buildBoxes();
      }
      function onUp(){ document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    box.querySelector('.pos-box-handle').addEventListener('mousedown', function(e){
      e.preventDefault(); e.stopPropagation();
      var startY=e.clientY;
      var startHPct=pos.hPct;
      function onMove(e2){
        var newH = startHPct + (e2.clientY-startY)/DISPLAY_H;
        pos.hPct = Math.max(0.03, newH);
        writeBack(item);
        redrawBg(); buildBoxes();
      }
      function onUp(){ document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    return box;
  }

  function writeBack(item){
    if(item.kind==='asset'){
      draftOverride.assets[item.key] = { xPct:item.pos.xPct, yPct:item.pos.yPct, hPct:item.pos.hPct, align:item.pos.align };
      /* host有artZone自動貼合機制（見editor-main.js的ensureHostAutoFit()），
         判斷「這張圖在這個版位是不是已經貼合/調整過」靠比對_srcTag跟目前
         S.assets.host.src——這裡手動拖曳調整完也要蓋上跟自動貼合時同一個
         時機點的src，不然套用之後下一次renderAll()會發現_srcTag不見了，
         誤判成「換了新圖」又把使用者剛調好的結果蓋回自動貼合的位置。 */
      if(item.key === 'host' && S.assets && S.assets.host){
        draftOverride.assets[item.key]._srcTag = S.assets.host.src;
      }
    } else {
      draftOverride.slots[S.combo][item.key] = { xPct:item.pos.xPct, yPct:item.pos.yPct, hPct:item.pos.hPct };
    }
  }

  overlay.querySelector('#pos-save-btn').onclick = function(){
    S.positionOverrides = S.positionOverrides || {};
    S.positionOverrides[layoutId] = draftOverride;
    /* 如果這個分頁的商品是跟其他分頁共用的（例如A版/B版共用同一組商品），
       把「這個版位」(layoutId，例如'11_lpbn_app')的位置調整結果也同步給
       其他分頁的同一個版位——使用者反映希望「我把LPBN_APP放大、往下，
       另一個分頁的LPBN_APP也要一起變」，這裡就是做這件事，不是1200畫布
       商品排列的同步(那個是另一個機制，見js/shadow-system/shadow-popup.js
       的exportShadowComposite())。 */
    propagateLayoutPositionToLinkedTabs(layoutId, draftOverride);
    closePopup();
    renderAll();
  };
  overlay.querySelector('#pos-reset-btn').onclick = function(){
    draftOverride = { assets:{}, slots:{} };
    draftOverride.slots[S.combo] = {};
    redrawBg(); buildBoxes();
  };

  redrawBg();
  buildBoxes();
}

/* ══════════════════ 追加版位（手動開關） ══════════════════
   Excel「製作素材」欄位自動判斷這次工單要顯示哪些版位（filterLayoutsByMaterials()），
   但工單匯入後，如果臨時想追加一個後台其實有、但這次Excel沒列到的版位，
   （或想暫時關掉某個已顯示的版位），不用重新匯入整份Excel，這裡開一個
   小popup讓使用者直接勾選要顯示哪些版位。

   跟原本buildLayoutToggleList()那份「每勾一下就立刻套用」的做法不同，
   這裡先在popup裡收集使用者這次想要的最終勾選狀態，按「確認」才一次性
   套用進S.activeLayoutIds、重建畫布——避免使用者勾一勾、還沒勾完就已經
   在旁邊重建畫布，感覺畫面一直跳動。

   ★勾選新增的版位會不會自動帶入目前已經填好的商品/文案？會——
   S.text（標題/副標/日期）、S.assets.host（商品/主持人合成圖）、
   S.assets.logo1/logo2 這些都是「跨版位共用」的全域狀態，不是每個版位
   各自存一份，所以新加進來的版位一開啟，renderAll()裡的ensureHostAutoFit()
   會直接把目前的商品圖依這個版位自己的作圖區(artZone)自動貼合進去，
   標題/副標/日期文字也是直接套用目前S.text的值，不用重新輸入一次。
   （唯一不會自動带的是「這個版位專屬的位置微調」——每個版位的
   positionOverrides是各自獨立的，新版位第一次一定是用自動貼合的位置，
   使用者原本在其他版位手動調整過的位置不會被套用過來，但這是合理的，
   因為不同版位畫布大小/比例不一樣，位置本來就沒辦法直接套用。） */
/* 使用者手動勾/取消勾版位種類後，把S.instances(實際要畫的畫布清單)同步
   調整成符合新的newActiveIds：原本就有的實例(不管是不是HBN那種複製實例)
   只要它的layoutId還在newActiveIds裡就保留；layoutId被取消勾選的實例
   (含複製實例)整組移除；新勾選、原本完全沒有實例的layoutId，補一個
   預設的base實例(instanceId===layoutId)進去，文案組預設跟目前面板顯示的
   那組一樣（比空白的'文案1'更貼近使用者當下情境）。 */
function reconcileInstancesWithActiveIds(newActiveIds){
  var current = S.instances || [];
  var kept = current.filter(function(inst){ return newActiveIds.indexOf(inst.layoutId) !== -1; });
  var keptLayoutIds = {};
  kept.forEach(function(inst){ keptLayoutIds[inst.layoutId] = true; });
  newActiveIds.forEach(function(id){
    if(!keptLayoutIds[id]){
      kept.push({ instanceId:id, layoutId:id, label:null, textGroup: S.activeTextGroup || '文案1' });
      S.layoutTextGroup = S.layoutTextGroup || {};
      S.layoutTextGroup[id] = S.activeTextGroup || '文案1';
    }
  });
  S.instances = kept;
  S.activeLayoutIds = newActiveIds.slice();
}

function openLayoutTogglePopup(){
  var draftIds = (S.activeLayoutIds || []).slice(); // 先複製一份草稿，確認前不動真正的S.activeLayoutIds
  var aliasBase = window.LAYOUT_ALIAS_BASE || {};

  var overlay = createOverlay(
    '<div class="popup-panel" style="width:320px;">'+
      '<div class="popup-head"><span>追加版位</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body">'+
        '<div class="hint" style="margin-bottom:10px;">勾選這次工單要顯示/輸出的版位，確認後才會套用（原本已經填好的商品/文案會自動帶到新加入的版位，不用重新輸入）。</div>'+
        '<div id="layout-toggle-popup-body" style="display:flex;flex-direction:column;gap:8px;"></div>'+
      '</div>'+
      '<div class="popup-foot">'+
        '<button class="tbtn primary" id="layout-toggle-confirm-btn">確認</button>'+
      '</div>'+
    '</div>'
  );

  var body = overlay.querySelector('#layout-toggle-popup-body');
  /* 排除動態複製實例(例如'03_c2c_bn__2')——這份清單只給選「版位種類」用，
     複製實例本身不是獨立種類，不應該在這裡多長出一個選項。 */
  body.innerHTML = LAYOUT_REGISTRY.filter(function(l){ return !aliasBase[l.id]; }).map(function(l){
    var checked = draftIds.indexOf(l.id) >= 0;
    return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);cursor:pointer;">'+
      '<input type="checkbox" data-layout-id="'+l.id+'" '+(checked?'checked':'')+'> '+esc(l.name)+
    '</label>';
  }).join('');

  Array.prototype.forEach.call(body.querySelectorAll('input[type=checkbox]'), function(cb){
    cb.onchange = function(){
      var id = cb.dataset.layoutId;
      var idx = draftIds.indexOf(id);
      if(cb.checked){ if(idx<0) draftIds.push(id); }
      else if(idx>=0){ draftIds.splice(idx,1); }
    };
  });

  overlay.querySelector('#layout-toggle-confirm-btn').onclick = function(){
    reconcileInstancesWithActiveIds(draftIds);
    closePopup();
    buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
  };
}
