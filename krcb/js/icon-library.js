'use strict';
/* ══════════════════ ICON圖庫（KRCB專案，副區專用） ══════════════════
   兩種來源合併使用：
   1. 【後台預放的固定ICON】——你直接把PNG檔案丟進icons/library/資料夾、
      在data/icon-library.json裡加一筆對應紀錄，就會自動出現在圖庫裡，
      不用改任何程式碼、也不用透過瀏覽器上傳。這批走「檔案系統管理」，
      跟backgrounds/、logos/資料夾是同一個管理方式(想新增/替換，直接動
      檔案；圖庫popup裡看得到，但不能從介面上刪除，要刪除／換掉直接去
      data/icon-library.json拿掉那筆紀錄、順便把檔案從icons/library/
      刪掉即可)。
   2. 【使用者透過介面上傳的ICON】——存在瀏覽器的localStorage裡，這個
      工具本身是純前端靜態網頁，沒有真正的伺服器後台，沒辦法做到「存進
      一個大家共用的資料庫、所有人裝置都看得到」，localStorage的效果是
      「這台瀏覽器/這個裝置上，圖庫會一直記著」，可以從介面上新增/刪除。

   兩種來源在圖庫popup裡合併顯示（後台固定的排前面），套用到畫布上的
   方式完全一樣。

   ⚠️ICON_RECOLOR_HEX是使用者確認的正式色碼(#F38976)。只有【使用者上傳】
   那批圖片會套用這個顏色覆蓋(addIconToLibrary())——【後台預放的固定
   ICON】(icons/library/資料夾)本來就是設計師事先做好、已經是正確顏色的
   圖，不會再被覆蓋，直接原樣使用(見loadAllIconLibraryEntries()的說明)。 */

var ICON_RECOLOR_HEX = '#F38976'; // 2026-08(KRCB)：使用者確認的正式色碼

var ICON_LIBRARY_STORAGE_KEY = 'krcb_icon_library_v1'; // 使用者上傳那批，存在localStorage
var ICON_LIBRARY_MANIFEST_PATH = 'data/icon-library.json'; // 後台固定那批，清單放這裡
var ICON_LIBRARY_FOLDER = 'icons/library/'; // 後台固定那批，實際PNG檔案放這裡

/* ---- 使用者上傳那批：localStorage存取 ---- */

function loadIconLibrary(){
  try {
    var raw = localStorage.getItem(ICON_LIBRARY_STORAGE_KEY);
    if(!raw) return [];
    var list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch(e){
    console.warn('[icon-library] 讀取失敗，視為空清單：', e);
    return [];
  }
}

function saveIconLibrary(list){
  try {
    localStorage.setItem(ICON_LIBRARY_STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch(e){
    console.warn('[icon-library] 存檔失敗(可能是容量爆了)：', e);
    return false;
  }
}

/* ---- 後台固定那批：讀data/icon-library.json清單 ---- */

/* 回傳一個Promise，resolve成[{id,name,file}, ...]。清單本身抓不到(檔案不
   存在、格式壞掉)就當作空清單，不會讓整個圖庫popup打不開。 */
function loadBundledIconManifest(){
  return fetch(ICON_LIBRARY_MANIFEST_PATH).then(function(r){
    if(!r.ok) return [];
    return r.json();
  }).catch(function(e){
    console.warn('[icon-library] 讀取後台圖庫清單失敗：', e);
    return [];
  }).then(function(list){
    return Array.isArray(list) ? list : [];
  });
}

/* 把一張圖(Image物件)套上固定顏色覆蓋——用途是「不管上傳的ICON原本是
   什麼顏色/什麼樣式，畫面上呈現出來都是統一的品牌色剪影」，跟
   js/shadow-system/shadow-plugin.js的buildTinted()是同一個手法：source-in
   合成模式，只保留原圖的alpha(形狀輪廓)，顏色整個換成指定的實色。
   回傳PNG格式的dataURL字串(保留透明背景)。 */
function recolorImageToDataUrl(img, colorHex){
  var c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  var ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colorHex;
  ctx.fillRect(0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/* ---- 合併兩種來源、套用到畫布 ---- */

/* 合併兩種來源，回傳Promise<完整清單>，每筆都是{id,name,dataUrl,bundled}
   ——bundled:true代表是後台固定那批(圖庫popup裡不會顯示刪除鈕)。
   2026-08(KRCB)修正：使用者確認「顏色覆蓋只套用在使用者自己上傳的圖」——
   後台固定那批(icons/library/資料夾)本來就是設計師事先做好、已經是正確
   顏色的圖，不需要、也不應該再被覆蓋成ICON_RECOLOR_HEX，直接原檔案路徑
   當dataUrl用即可，連圖片都不用另外載入處理。只有使用者透過介面上傳的
   那批(addIconToLibrary())才會套用固定顏色覆蓋。 */
function loadAllIconLibraryEntries(){
  return loadBundledIconManifest().then(function(manifest){
    var bundledOk = manifest.map(function(item){
      return { id: 'bundled_' + (item.id || item.file), name: item.name || item.file, dataUrl: ICON_LIBRARY_FOLDER + item.file, bundled: true };
    });
    var uploaded = loadIconLibrary().map(function(item){
      return Object.assign({}, item, { bundled: false });
    });
    return bundledOk.concat(uploaded);
  });
}

/* 新增一個ICON進「使用者上傳」那批——file讀進來、套用固定顏色覆蓋、存進
   localStorage，cb(entry)在完成後被呼叫，entry = {id, name, dataUrl,
   originalDataUrl}。originalDataUrl保留使用者原始上傳的檔案(沒套色)，
   只是留著備查/以後萬一要換顏色重新套用一次，畫面上實際用的一律是
   dataUrl(已套色版本)。 */
function addIconToLibrary(name, file, cb){
  var reader = new FileReader();
  reader.onload = function(ev){
    var img = new Image();
    img.onload = function(){
      var recolored = recolorImageToDataUrl(img, ICON_RECOLOR_HEX);
      var entry = {
        id: 'icon_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        name: (name && name.trim()) || file.name.replace(/\.[^.]+$/, ''),
        dataUrl: recolored,
        originalDataUrl: ev.target.result
      };
      var list = loadIconLibrary();
      list.push(entry);
      saveIconLibrary(list);
      cb(entry);
    };
    img.onerror = function(){ cb(null); };
    img.src = ev.target.result;
  };
  reader.onerror = function(){ cb(null); };
  reader.readAsDataURL(file);
}

function deleteIconFromLibrary(id){
  var list = loadIconLibrary().filter(function(it){ return it.id !== id; });
  saveIconLibrary(list);
  return list;
}

/* ---- 套用到畫布上的MSBN格子(沿用S.msbnLogos同一套資料結構) ---- */

/* 2026-08(KRCB)新增：副區(APP)/副區(PC)內容本來就該完全一樣(同一個
   活動、只是畫布尺寸不同)，使用者選/上傳一個ICON時，兩邊的同一個格子
   (icon1/icon2/icon3)要一起套用，不用兩邊各自點一次——跟畫布互動觸發時
   一定是SUBZONE_IDS其中一個實例正在被使用者操作，這裡直接把同一張圖
   套到「另一個」副區實例的同一個slotKey，圖片來源(dataUrl)一樣，但
   contain-fit的縮放要各自照自己的畫布尺寸重新算一次(APP的icon框跟PC的
   icon框大小不一樣，共用同一個scale會不對)。
   跟其他MSBN格子(host等，非副區)完全不影響——targets只有在layoutId是
   副區時才會涵蓋兩個實例，其餘情況維持原本「只套到這一個」的行為。 */
function _applyIconDataUrlToMsbnSlot(layoutId, slotKey, dataUrl){
  var targets = (typeof SUBZONE_IDS !== 'undefined' && SUBZONE_IDS.indexOf(layoutId) !== -1) ? SUBZONE_IDS.slice() : [layoutId];
  if(typeof _msbnPushUndo === 'function') _msbnPushUndo();
  targets.forEach(function(targetId){
    var img = new Image();
    img.onload = function(){
      var slotBox = (typeof getMsbnSlotBox === 'function') ? getMsbnSlotBox(targetId, slotKey) : null;
      /* 2026-09修正：跟js/editor-main.js的loadMsbnLogoFileInto()同一個
         地雷——這裡targets可能同時包含subzone_app跟subzone_pc兩個實例
         (見上面註解)，如果使用者只切去看過其中一個分頁，另一個分頁的
         bundle可能還沒載入，getMsbnSlotBox()查不到框。原本完全沒有備援，
         直接退回用圖片自己的原始尺寸冒充框，等於把ICON圖庫的原始像素
         尺寸硬塞進小格子，一樣會超出範圍。改成先查靜態備援表
         (MSBN_SLOT_BOX_FALLBACK裡本來就有subzone_app/subzone_pc兩組資料)，
         備援也查不到才用保守預設值+警告，不要再假裝圖片尺寸就是框。 */
      var fallbackBox = (!slotBox && typeof getMsbnSlotBoxFallback === 'function') ? getMsbnSlotBoxFallback(targetId, slotKey) : null;
      var box = (slotBox && slotBox.logoBox) || fallbackBox;
      var baseScale;
      if(box){
        baseScale = Math.min(box.w/img.naturalWidth, box.h/img.naturalHeight);
      } else {
        console.warn('[_applyIconDataUrlToMsbnSlot] 查不到格子(logoBox)大小，改用保守預設值——targetId=', targetId, 'slotKey=', slotKey);
        baseScale = 0.3;
      }
      S.msbnLogos = S.msbnLogos || {};
      S.msbnLogos[targetId] = S.msbnLogos[targetId] || {};
      S.msbnLogos[targetId][slotKey] = { img: img, scale: baseScale, offX: 0, offY: 0, baseScale: baseScale, bgColor: null };
      if(targetId === layoutId && typeof _msbnSetSelected === 'function') _msbnSetSelected(targetId, [slotKey]);
      renderAll();
    };
    img.src = dataUrl;
  });
}

/* ---- 圖庫選擇popup ---- */

function openIconLibraryPopup(layoutId, slotKey){
  var overlay = createOverlay(
    '<div class="popup-panel" style="width:520px;max-height:75vh;display:flex;flex-direction:column;">'+
      '<div class="popup-head"><span>選擇ICON</span><button class="popup-x" onclick="closePopup()">×</button></div>'+
      '<div class="popup-body" style="overflow-y:auto;">'+
        '<div class="hint" style="margin-bottom:10px;">從圖庫選一個現成的ICON，或上傳一張新的——上傳的圖片會自動套用固定顏色覆蓋，之後就會留在圖庫裡，下次可以直接選用。</div>'+
        '<div id="icon-lib-upload-zone" style="border:1.5px dashed var(--border);border-radius:8px;padding:14px;text-align:center;font-size:13px;color:var(--text-dim);cursor:pointer;margin-bottom:14px;">'+
          '＋ 上傳新ICON（PNG，透明底較佳）'+
        '</div>'+
        '<input type="file" id="icon-lib-upload-input" accept="image/*" style="display:none;">'+
        '<div id="icon-lib-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">'+
          '<div style="grid-column:1/-1;text-align:center;color:var(--text-dim);font-size:12.5px;padding:20px 0;">載入中…</div>'+
        '</div>'+
      '</div>'+
    '</div>'
  );

  function renderGrid(){
    loadAllIconLibraryEntries().then(function(list){
      var grid = overlay.querySelector('#icon-lib-grid');
      if(!grid) return; // popup可能已經被關掉了
      if(!list.length){
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-dim);font-size:12.5px;padding:20px 0;">圖庫目前是空的，上傳第一個ICON吧</div>';
        return;
      }
      grid.innerHTML = list.map(function(item){
        return '<div class="icon-lib-card" data-id="'+item.id+'" style="position:relative;border:1.5px solid var(--border);border-radius:8px;padding:8px;cursor:pointer;text-align:center;background:#2a2a2a;">'+
          '<img src="'+item.dataUrl+'" style="width:100%;height:56px;object-fit:contain;display:block;margin-bottom:6px;">'+
          '<div style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(item.name)+'</div>'+
          (item.bundled ? '' : '<button class="icon-lib-del-btn" data-id="'+item.id+'" title="從圖庫刪除" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.5);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;line-height:18px;cursor:pointer;">×</button>')+
        '</div>';
      }).join('');

      Array.prototype.forEach.call(grid.querySelectorAll('.icon-lib-card'), function(card){
        card.addEventListener('click', function(e){
          if(e.target.classList.contains('icon-lib-del-btn')) return;
          var id = card.dataset.id;
          var item = list.filter(function(it){ return it.id === id; })[0];
          if(!item) return;
          closePopup();
          _applyIconDataUrlToMsbnSlot(layoutId, slotKey, item.dataUrl);
        });
      });
      Array.prototype.forEach.call(grid.querySelectorAll('.icon-lib-del-btn'), function(btn){
        btn.addEventListener('click', function(e){
          e.stopPropagation();
          var id = btn.dataset.id;
          if(!confirm('確定要從圖庫刪除這個ICON嗎？(不會影響已經套用在畫布上的圖)')) return;
          deleteIconFromLibrary(id);
          renderGrid();
        });
      });
    });
  }

  var uploadZone = overlay.querySelector('#icon-lib-upload-zone');
  var uploadInput = overlay.querySelector('#icon-lib-upload-input');
  uploadZone.addEventListener('click', function(){ uploadInput.click(); });
  uploadInput.addEventListener('change', function(e){
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if(!file) return;
    var name = prompt('幫這個ICON取個名字（方便之後在圖庫裡辨認）：', file.name.replace(/\.[^.]+$/, ''));
    if(name === null) return; // 使用者按取消
    uploadZone.textContent = '處理中…';
    addIconToLibrary(name, file, function(entry){
      if(!entry){ alert('這個檔案讀取失敗，換一張試試？'); uploadZone.textContent = '＋ 上傳新ICON（PNG，透明底較佳）'; return; }
      closePopup();
      _applyIconDataUrlToMsbnSlot(layoutId, slotKey, entry.dataUrl);
    });
  });

  renderGrid();
}

