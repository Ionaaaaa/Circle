'use strict';

var bundles = {};   // layoutId -> Core.loadLayout() 回傳的物件（快取，跨分頁共用不用重複讀取）
var canvases = {};  // layoutId -> canvas DOM（每次重建畫布區時會換掉）

/* ══════════════════ 文案分組輔助函式 ══════════════════
   見js/editor-state.js的S.textGroups/S.layoutTextGroup說明。 */

/* 這個版位實際套用哪一組文案（沒特別指定就預設'文案1'） */
function groupKeyForLayout(layoutId){
  return (S.layoutTextGroup && S.layoutTextGroup[layoutId]) || '文案1';
}

/* 右側面板目前顯示/可編輯的那一組文案物件——沒有就現生一組空的，
   不會讓面板打字打到undefined上。 */
function activeText(){
  if(!S.textGroups) S.textGroups = {};
  if(!S.textGroups[S.activeTextGroup]) S.textGroups[S.activeTextGroup] = emptyTextGroup();
  return S.textGroups[S.activeTextGroup];
}

/* 這個分頁目前總共有幾組文案(通常1組，媽咪會員這種案子可能2組)，
   依組別分別列出各自套用哪些版位，給切換UI跟畫布標示用。
   回傳 [{key:'文案1', layoutIds:['11_lpbn_app',...]}, ...]，
   順序照S.textGroups物件本身的key順序（建立時的順序，即Excel或使用者手動加組的順序）。 */
function listTextGroupsInUse(){
  var keys = Object.keys(S.textGroups || {});
  return keys.map(function(key){
    var layoutIds = activeLayouts().filter(function(l){ return groupKeyForLayout(l.id) === key; }).map(function(l){ return l.id; });
    return { key: key, layoutIds: layoutIds };
  });
}

/* 切到某一組文案：只是換S.activeTextGroup+刷新右側輸入框顯示值，
   不影響畫布渲染（畫布永遠各自照layoutTextGroup畫，不受這裡影響）。
   2026-09調整：這支現在給「明確操作」用(點畫布標題列、點左側清單、
   點商品本體)，滑動捲動改走followActiveGroupFromScroll()，兩者共用的
   部分(切文案/閃爍動畫/左側清單高亮/商品編輯按鈕目標)抽成
   _applyActiveGroupSideEffects()，這支不再管白邊——白邊改成呼叫端自己
   決定要不要另外呼叫setExplicitCanvasSelection()。 */
function switchActiveTextGroup(key){
  if(!S.textGroups[key]) return;
  S.activeTextGroup = key;
  _applyActiveGroupSideEffects();
}

/* 捲動追蹤用：換組但不影響白邊(白邊只認明確點選，見
   attachCanvasAreaScrollTracking()裡滑動時會另外清掉白邊)。 */
function followActiveGroupFromScroll(key){
  if(!S.textGroups[key] || key === S.activeTextGroup) return;
  S.activeTextGroup = key;
  _applyActiveGroupSideEffects();
}

function _applyActiveGroupSideEffects(){
  syncTextPanelFromActiveGroup();
  buildAssetList();
  flashTextPanel();
  updateProductEditButtonTarget();
  updateProductSectionVisibility();
  updateCouponEditButtonVisibility();
  updateTicket1FieldVisibility();
  updateActiveItemPanel();
}

/* 2026-09新增：文案+商品合併面板(#active-item-panel)的顯示/隱藏+換牌
   動畫——只有「這個分頁本來就有兩組以上文案」時才套用「沒有明確點選
   (白邊)就整塊隱藏」的規則；只有一組文案的一般分頁，維持原本一開始就
   顯示，不需要使用者多點一次才看得到欄位。
   _lastActiveItemPanelKey記住上一次播放過換牌動畫時是哪一組，同一組
   重複呼叫(例如捲動觸發但面板本來就是隱藏的)不會誤觸發動畫。 */
var _lastActiveItemPanelKey = null;
function updateActiveItemPanel(){
  var panel = document.getElementById('active-item-panel');
  var label = document.getElementById('active-item-label');
  if(!panel) return;
  var multiGroup = listTextGroupsInUse().length > 1;
  var show = !multiGroup || (_explicitSelectedLayoutId !== null);

  panel.style.display = show ? '' : 'none';
  if(!show){ _lastActiveItemPanelKey = null; return; }

  if(label){
    if(multiGroup && _explicitSelectedLayoutId){
      var l = LAYOUT_REGISTRY.find(function(x){ return x.id === _explicitSelectedLayoutId; });
      label.textContent = l ? l.name : _explicitSelectedLayoutId;
      label.style.display = '';
      panel.classList.add('active-item-panel-has-label');
    } else {
      label.style.display = 'none';
      panel.classList.remove('active-item-panel-has-label');
    }
  }

  if(S.activeTextGroup !== _lastActiveItemPanelKey){
    _lastActiveItemPanelKey = S.activeTextGroup;
    panel.classList.remove('active-item-panel-swap');
    void panel.offsetWidth; // 強制reflow，讓同一個class可以重複觸發動畫
    panel.classList.add('active-item-panel-swap');
  }
}

/* 2026-09新增：LOGO2編輯入口在外廣(S.siteMode==='external')完全用不到——
   外廣工單目前沒有真正接LOGO2的自動比對/編輯流程，留著這顆按鈕使用者
   點了也不會有任何作用，容易誤導。站內分頁不受影響，維持原樣顯示。 */
function updateLogo2FieldVisibility(){
  var wrap = document.getElementById('logo2-field-wrap');
  if(!wrap) return;
  /* 2026-09修正：判斷條件從「Excel有沒有勾選LOGO2」改成「S.assets.logo2
     有沒有真的載入一張圖片」——使用者反映勾選了但實際沒有比對到檔案時
     (或這次匯入的資料夾裡根本沒有對應的LOGO2素材)，按鈕還是會顯示，
     點了也沒有任何圖可以編輯。改成直接看有沒有實際的圖片物件，這樣
     「有沒有勾選」這件事就不重要了，只要畫面上真的有LOGO2可以編輯，
     按鈕才會出現。 */
  var hide = (S.siteMode === 'external') || !(S.assets && S.assets.logo2);
  wrap.style.display = hide ? 'none' : '';
}

/* 右側面板的文案(標題/副標/日期/優惠券金額)輸入框，切換分組的當下集體
   閃一下背景色，提示使用者「這裡的內容剛剛換過了」——先移除再重新加上
   同一個class，強制觸發一次reflow，這樣連續點好幾個不同項目時，每次
   都會重新播放一次動畫，不會因為class本來就存在而被瀏覽器忽略。 */
function flashTextPanel(){
  ['標題','副標','日期','第1張(後)','第2張(前)'].forEach(function(key){
    var el = document.getElementById('input-'+key);
    if(!el) return;
    el.classList.remove('field-flash');
    void el.offsetWidth;
    el.classList.add('field-flash');
  });
}

/* 右側「商品」區塊那顆固定的「編輯商品」按鈕(editor.html裡id=
   edit-product-btn)——以前一律呼叫全域的openShadowPopup()，對外廣
   multiInstance(例如04_Facebook)來說永遠只會編輯到「S.shadowSlots目前
   殘留的內容」，等於誰最後處理過就編輯誰，使用者反映過這個問題。這裡
   依「目前作用中的那組」(S.activeTextGroup)動態決定按鈕要開哪一個：
   如果那組有登記在S.instanceExposureStyle裡且是'product'，開這組專屬的
   openWaiguangProductEditor()；否則維持原本行為，開全域共用的
   openShadowPopup()(一般站內分頁、或外廣非multiInstance整頁廣播的情況，
   跟以前完全一樣)。每次切換active group(不管是點選還是捲動追蹤)都要
   重新呼叫一次，確保按鈕目標永遠對得上畫面上目前顯示的那組文案。 */
function updateProductEditButtonTarget(){
  var btn = document.getElementById('edit-product-btn');
  if(!btn) return;
  var key = S.activeTextGroup;
  if(S.instanceExposureStyle && S.instanceExposureStyle[key] === 'product'){
    btn.onclick = function(){ openWaiguangProductEditor(key); };
  } else {
    btn.onclick = function(){ openShadowPopup(); };
  }
}

/* 右側「文案」標題下的切換鈕：只有一個分頁內有2組(以上)文案時才顯示，
   只有1組時完全隱藏、不佔位置，不會讓沒有這個需求的分頁畫面多長東西出來。 */
function buildTextGroupSwitcher(){
  var el = document.getElementById('text-group-switcher');
  if(!el) return;
  var groups = listTextGroupsInUse();
  if(groups.length <= 1){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  el.style.gap = '6px';
  el.style.flexWrap = 'wrap';
  el.innerHTML = groups.map(function(g){
    var names = g.layoutIds.map(function(id){
      var l = LAYOUT_REGISTRY.find(function(x){ return x.id===id; });
      return l ? l.name : id;
    }).join('、') || '（尚無版位套用）';
    var active = (g.key === S.activeTextGroup);
    return '<button type="button" class="tbtn'+(active?' primary':'')+'" style="font-size:11px;padding:5px 10px;" '+
      'title="套用版位：'+esc(names)+'" onclick="switchActiveTextGroup(\''+g.key+'\')">'+esc(g.key)+'</button>';
  }).join('');
}

/* 把畫布上每個版位的canvas-meta列標示成目前是哪一組文案在用、
   並且讓目前active那組對應的版位有明顯的外框提示（使用者點了切換鈕，
   或點了畫布本身之後，要能一眼看出「現在編輯的是哪幾個版位」）。 */
/* 2026-09重新設計：白邊(canvas-block-active-group)以前是直接跟著
   S.activeTextGroup切換(不管是點畫布、點左側清單、還是滑動捲動，通通
   會讓白邊跟著跑)——使用者反映滑動捲動時不應該出現白邊，白邊只代表
   「明確點選/正在編輯」的狀態，跟「文案面板現在顯示哪一組內容」要分成
   兩件事：
     - S.activeTextGroup：右側文案面板/左側清單高亮/商品編輯按鈕目標，
       這個「滑動捲動」也會跟著換(見followActiveGroupFromScroll())。
     - _explicitSelectedLayoutId：白邊只認這個——只有「明確點選」才會
       設定(點畫布標題列、點左側清單項目、直接點畫布上的商品/host本體
       準備拖曳)，單純捲動畫布不會設定它，捲動時反而會清掉(見
       attachCanvasAreaScrollTracking())。 */
var _explicitSelectedLayoutId = null;

function setExplicitCanvasSelection(layoutId){
  _explicitSelectedLayoutId = layoutId;
  applyCanvasBorderHighlight();
  updateActiveItemPanel();
}
function clearExplicitCanvasSelection(){
  if(_explicitSelectedLayoutId === null) return;
  _explicitSelectedLayoutId = null;
  applyCanvasBorderHighlight();
  updateActiveItemPanel();
}
function applyCanvasBorderHighlight(){
  activeLayouts().forEach(function(layout){
    var block = document.getElementById('canvas-block-'+layout.id);
    if(!block) return;
    block.classList.toggle('canvas-block-active-group', layout.id === _explicitSelectedLayoutId);
  });
}

/* 舊名保留給還沒改到的呼叫點用——現在改成只負責白邊，邏輯搬進
   applyCanvasBorderHighlight()，這支變成單純轉呼叫，行為維持一致。 */
function highlightCanvasBlocksForActiveGroup(){
  applyCanvasBorderHighlight();
}

/* ══════════════════ 捲動追蹤：滑動中間畫布區，右側文案跟著換 ══════════════════
   使用者反映：只有明確點選(點畫布標題列/左側清單/商品本體)才會換組，
   單純上下滑動看下一個版位時，右側文案/左側清單高亮都還停在舊的那組，
   要滑到看得到的東西跟文案內容對不起來。這裡用一個簡單的「捲動結束後
   140ms才判定」的debounce(捲動中不會一直觸發，效能上比較輕量)，捲動
   停下來後，找目前在#canvas-area可視範圍垂直中心點最近的那個canvas-block，
   換成followActiveGroupFromScroll()(只換文案內容，不出現白邊)。
   一開始滑動就先清掉白邊(clearExplicitCanvasSelection())，滑動過程中不
   應該看到編輯框，只有停下來、真的點選了才會重新出現。 */
var _scrollTrackTimer = null;
/* _suppressScrollTracking：點左側清單/畫布標題列後，會呼叫scrollToCanvas()
   把畫面捲動過去，這個「程式自己觸發的捲動」也會被下面的scroll事件監聽
   聽到——如果不特別處理，會被誤判成「使用者自己在滑動」，緊接著呼叫
   clearExplicitCanvasSelection()把剛設定好的白邊清掉，變成使用者反映的
   「點了清單，白邊完全沒出現」。用這個旗標暫時忽略捲動事件，等
   scrollIntoView()的平滑捲動動畫大概跑完才恢復正常監聽。 */
var _suppressScrollTracking = false;
var _suppressScrollTrackingTimer = null;

/* _focusedLayoutId：左側清單「亮燈」要跟的是這個，不是S.activeTextGroup——
   同一組文案(groupKeyForLayout)常常同時對應好幾個版位(例如站內大部分
   分頁全部共用「文案1」)，如果用「這個版位是不是屬於目前這組」來判斷
   要不要亮燈，會變成整份清單全部一起亮，使用者反映過這個問題。改成
   獨立追蹤「目前捲動/點選聚焦在哪一個版位」，永遠只有一個。 */
var _focusedLayoutId = null;

function attachCanvasAreaScrollTracking(){
  var area = document.getElementById('canvas-area');
  if(!area || area._scrollTrackBound) return;
  area._scrollTrackBound = true;
  area.addEventListener('scroll', function(){
    if(_suppressScrollTracking) return; // 忽略scrollToCanvas()自己觸發的捲動
    clearExplicitCanvasSelection();
    if(_scrollTrackTimer) clearTimeout(_scrollTrackTimer);
    _scrollTrackTimer = setTimeout(updateActiveGroupFromScrollPosition, 140);
  });
}

function updateActiveGroupFromScrollPosition(){
  var area = document.getElementById('canvas-area');
  if(!area) return;
  var areaRect = area.getBoundingClientRect();
  var centerY = areaRect.top + areaRect.height/2;
  var best = null, bestDist = Infinity;
  activeLayouts().forEach(function(layout){
    var block = document.getElementById('canvas-block-'+layout.id);
    if(!block) return;
    var r = block.getBoundingClientRect();
    var dist = Math.abs((r.top + r.height/2) - centerY);
    if(dist < bestDist){ bestDist = dist; best = layout.id; }
  });
  if(!best) return;
  _focusedLayoutId = best;
  buildAssetList(); // 只更新左側清單的亮燈，不影響白邊/文案內容
  followActiveGroupFromScroll(groupKeyForLayout(best));
}

/* ══════════════════ 畫布區 + 素材清單 ══════════════════ */

/* 這個分頁實際要畫哪幾張畫布、依什麼順序——直接照S.instances（見
   js/editor-state.js的說明）逐一轉成LAYOUT_REGISTRY慣用的{id,name,configFile}
   形狀，buildCanvasArea()/downloadSingle()等既有邏輯完全不用改，因為
   拿到的還是同樣形狀的物件，只是這次id可能是動態註冊出來的複製實例id。
   S.instances是null的話（還沒有工單資料的全新分頁），退回用
   S.activeLayoutIds篩LAYOUT_REGISTRY原本順序，行為跟以前一樣。 */
function activeLayouts(){
  if(S.instances && S.instances.length){
    return S.instances.map(function(inst){
      ensureDynamicLayoutRegistered(inst.instanceId, inst.layoutId, inst.label);
      return LAYOUT_REGISTRY.find(function(l){ return l.id === inst.instanceId; });
    }).filter(Boolean);
  }
  return LAYOUT_REGISTRY.filter(function(l){ return S.activeLayoutIds.indexOf(l.id) >= 0; });
}

function buildCanvasArea(){
  var area = document.getElementById('canvas-area');
  area.innerHTML = '';
  canvases = {};
  _hostSelected = {};
  _skbnTagSelected = {};
  _explicitSelectedLayoutId = null; // 換分頁/重建畫布區，先前的「明確點選」狀態不該延續到新的畫布清單
  _focusedLayoutId = null; // 同上，左側清單的亮燈也重置

  var loaders = activeLayouts().map(function(layout){
    var block = document.createElement('div');
    block.className = 'canvas-block';
    block.id = 'canvas-block-'+layout.id;
    var groupKey = groupKeyForLayout(layout.id);
    /* SKBN(skinny_app/__2/__3、skinny_pc/__2/__3)才會出現「商品/小標」這顆
       mini按鈕——window.SKBN_INSTANCE_META查得到才代表這個實例是SKBN單品
       合成用的，其他版位(KV、LPBN...)一律不會多長出這顆按鈕，行為不變。
       開啟的是js/shadow-system/skbn-shadow-popup.js的openSkbnShadowPopup()，
       跟KV「編輯商品」按鈕(右側面板openShadowPopup())是完全獨立的兩套流程。
       ★2026-09新增：券樣模式(S.exposureStyle==='coupon')下這顆按鈕不出現——
       券樣模式的SKBN直接廣播跟其他版位一樣的券卡合成圖(見modules/
       logo-module.js的說明)，沒有「單品陰影/小標」這件事可以編輯，留著
       這顆按鈕點下去也不會有任何效果，容易誤導使用者。 */
    var skbnMeta = (S.exposureStyle !== 'coupon') && window.SKBN_INSTANCE_META && window.SKBN_INSTANCE_META[layout.id];
    var skbnBtnHtml = skbnMeta
      ? '<button class="mini-dl-btn" onclick="event.stopPropagation();openSkbnShadowPopup(\''+layout.id+'\')">'+ICON_GEAR+' 商品/小標</button>'
      : '';
    /* 2026-09新增：外廣multiInstance(例如04_Facebook)商品模式的每一組，
       也需要各自獨立的「編輯商品」入口——這個實例有登記在
       S.instanceExposureStyle裡且是'product'，才代表它是這種需要各自
       獨立編輯的實例(其餘一般版位、或外廣非multiInstance的整頁廣播，
       右側面板本來就有「調整商品/人物」按鈕可以用，不需要再多長一顆)。
       呼叫js/editor-import-external.js的openWaiguangProductEditor()，
       讀寫的是這個實例自己的S.instanceShadowState，不會跟其他組互相
       干擾(使用者反映過的「點進去都是最後一品」就是這裡要修的問題)。 */
    var isWaiguangProductInstance = S.instanceExposureStyle && S.instanceExposureStyle[layout.id] === 'product';
    var waiguangEditBtnHtml = isWaiguangProductInstance
      ? '<button class="mini-dl-btn" onclick="event.stopPropagation();openWaiguangProductEditor(\''+layout.id+'\')">'+ICON_GEAR+' 編輯商品</button>'
      : '';
    block.innerHTML =
      '<div class="canvas-meta" data-layout-id="'+layout.id+'" style="cursor:pointer;" title="點這裡：右側文案面板切換成這個版位對應的那組文案">'+
        '<span class="canvas-name">'+layout.name+'</span>'+
        '<span class="canvas-group-tag" style="font-size:10px;color:var(--text-dim);border:1px solid var(--border);border-radius:8px;padding:1px 6px;margin-left:6px;">'+esc(groupKey)+'</span>'+
        '<span style="flex:1"></span>'+
        skbnBtnHtml+
        waiguangEditBtnHtml+
        '<button class="mini-dl-btn" onclick="event.stopPropagation();openPositionEditor(\''+layout.id+'\')">'+ICON_GEAR+' 調整位置</button>'+
        '<button class="mini-dl-btn" onclick="event.stopPropagation();downloadSingle(\''+layout.id+'\')">'+ICON_DOWNLOAD+' 下載</button>'+
      '</div>'+
      '<div class="canvas-wrap"><canvas id="cv-'+layout.id+'"></canvas></div>';
    area.appendChild(block);
    block.querySelector('.canvas-meta').addEventListener('click', function(){
      _focusedLayoutId = layout.id;
      switchActiveTextGroup(groupKeyForLayout(layout.id));
      setExplicitCanvasSelection(layout.id); // 明確點選這個版位的標題列，出現白邊
    });
    canvases[layout.id] = block.querySelector('#cv-'+layout.id);
    attachSkbnTagDragResize(canvases[layout.id], layout.id); // 要綁在attachHostDragResize()之前，見該函式的說明
    attachHostDragResize(canvases[layout.id], layout.id);

    if(bundles[layout.id]) return Promise.resolve();
    return Core.loadLayout(layout.configFile).then(function(bundle){
      bundles[layout.id] = bundle;
    });
  });

  return Promise.all(loaders).then(function(){
    renderAll();
    buildAssetList();
    buildLayoutToggleList();
    highlightCanvasBlocksForActiveGroup();
    updateProductEditButtonTarget();
    attachCanvasAreaScrollTracking();
  });
}

function renderAll(){
  ensureHostAutoFit();
  if(typeof ensureSkbnAutoCompose === 'function') ensureSkbnAutoCompose();
  /* 2026-09新增：如果coupon popup(券樣1200畫布)當下正開著，這裡也順便
     重畫一次——匯入工單時openCouponPopup()幾乎是緊接著addTabFromImport()
     同步呼叫，跑在applyDefaultLogos(renderAll)的非同步載入(S.assets.
     coin1/coin2預設錢幣圖片)完成「之前」，導致popup第一次打開時圖片
     還沒到，畫面上金幣整個不見，直到使用者關掉重開才看得到(那時候圖片
     早就載完了)。applyDefaultLogos()完成後本來就會呼叫一次renderAll()
     （見buildCanvasArea()），這裡順便也把coupon popup重畫一次，圖片
     load完的當下就會立刻補上，不用使用者手動關掉重開。drawCouponCanvas()
     函式本身有「popup沒開著就直接return」的guard，不會有副作用。 */
  if(typeof drawCouponCanvas === 'function') drawCouponCanvas();
  activeLayouts().forEach(function(layout){
    var bundle = bundles[layout.id];
    var canvas = canvases[layout.id];
    if(bundle && canvas){
      /* 這個版位吃哪一組文案，就臨時做一份「借用該組text」的state物件給
         Core.render用——不直接改S.text（S根本沒有text這個欄位了，見
         editor-state.js），也不會互相干擾：淺拷貝一份S，只覆寫text這個key，
         其他(assets/combo/positionOverrides等)全部还是同一份參照，
         跟真正的S完全同步，不用擔心拷貝出來的資料舊掉。 */
      var groupText = (S.textGroups && S.textGroups[groupKeyForLayout(layout.id)]) || emptyTextGroup();
      /* 2026-09新增：外廣04_Facebook這種混合曝品模式的分頁，個別實例
         (layout.id)可能在S.instanceExposureStyle裡登記了自己的模式
         ('product'/'coupon')，蓋掉整頁共用的S.exposureStyle——一般分頁
         沒有登記任何instanceId，這裡查不到值就維持undefined，
         Object.assign不會覆寫掉原本的exposureStyle，行為完全不變。 */
      var instExposureStyle = S.instanceExposureStyle && S.instanceExposureStyle[layout.id];
      var renderState = Object.assign({}, S, { text: groupText },
        instExposureStyle ? { exposureStyle: instExposureStyle } : null);
      Core.render(canvas, bundle, renderState, layout.id);
      drawHostOverlay(canvas, layout.id);
      drawSkbnTagOverlay(canvas, layout.id);
      drawSkbnTagSelectionOverlay(canvas, layout.id);
    }
  });
}

/* ══════════════════ 直接在主畫布上拖曳/縮放商品(host) ══════════════════
   參考你另一份pet-frenzy專案的做法——每個版位的畫布本身就能直接拖曳/縮放
   合成好的商品圖，不用像現在Circle這樣一定要另外開「調整位置」popup才能調。
   這裡補上等價的功能：直接對canvas元素綁pointer事件，命中商品(host)方框
   內部就是移動、命中右下角控制點就是縮放（跟「調整位置」popup同一套手感：
   拖右下角只調高度，寬度依圖片比例自動跟著變，不會變形），調整結果直接寫進
   S.positionOverrides［跟popup、跟作圖區自動貼合是同一份資料，三個入口
   互通、不會互相打架）。
   只做商品(host)這一個素材，logo1/logo2目前還是要走「調整位置」popup——
   商品是使用者最常需要微調大小的素材，這裡優先做；logo之後有需要再加。 */
var _hostSelected = {};    // layoutId -> boolean，目前是否顯示選取框/控制點
var _hostInteraction = null; // 目前拖曳中的互動狀態（同時只會拖一個版位）

function getHostBox(layoutId){
  var bundle = bundles[layoutId];
  var resolved = _resolveHostSlot(layoutId);
  var slotKey = resolved.slotKey, img = resolved.img;
  if(!bundle || !(img instanceof HTMLImageElement) || !img.complete || !img.naturalWidth) return null;
  var override = S.positionOverrides && S.positionOverrides[layoutId];
  var merged = Core.mergePositions(_hostBasePositions(bundle), override);
  var pos = merged.assets && merged.assets[slotKey];
  if(!pos) return null;
  var w = bundle.layoutConfig.canvas.w, h = bundle.layoutConfig.canvas.h;
  var boxH = pos.hPct * h;
  var ratio = img.naturalWidth / img.naturalHeight;
  var boxW = boxH * ratio;
  var anchorX = pos.xPct * w, anchorY = pos.yPct * h;
  var left = (pos.align === 'center') ? anchorX - boxW/2 : anchorX;
  var top = anchorY;
  /* 選取框/點擊判定要用「有色範圍」，不是整張圖（含透明留白）的滿版範圍——
     跟shadow-layout-receiver.js裡1200畫布的做法一致（同一個道理：使用者
     點擊/看到的選取框，感覺上應該貼著實際看得到的商品輪廓，不是貼著圖檔
     本身可能留白的邊界）。實際拖曳/縮放調整的還是底層的xPct/yPct/hPct
     （控制整張圖怎麼畫），colorBox只是「這次要拿哪個矩形當選取框跟碰撞
     判定」，兩者用同一個縮放比例，所以拖曳的手感（滑鼠移多少、框跟著移多少）
     是一致的，不會不同步。 */
  var tight = Core.calcTightBoundsRatio(img);
  var colorBox = tight
    ? { left: left + tight.tx*boxW, top: top + tight.ty*boxH, w: tight.tw*boxW, h: tight.th*boxH }
    : { left:left, top:top, w:boxW, h:boxH };
  return { left:left, top:top, w:boxW, h:boxH, pos:pos, canvasW:w, canvasH:h, colorBox:colorBox, slotKey:slotKey, img:img };
}

function drawHostOverlay(canvas, layoutId){
  if(!_hostSelected[layoutId]) return;
  var box = getHostBox(layoutId);
  if(!box) return;
  var cb = box.colorBox;
  var ctx = canvas.getContext('2d');
  ctx.save();
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = Math.max(1.5, canvas.width*0.0025);
  ctx.strokeRect(cb.left, cb.top, cb.w, cb.h);
  var hs = Math.max(10, canvas.width*0.02);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#22c55e';
  /* 四個角都要有控制點，跟1200畫布(shadow-layout-receiver.js)同一套手感——
     原本只有右下角一個，只能單向放大縮小，使用者反映不方便。 */
  [
    [cb.left,        cb.top],
    [cb.left+cb.w,   cb.top],
    [cb.left,        cb.top+cb.h],
    [cb.left+cb.w,   cb.top+cb.h]
  ].forEach(function(c){
    ctx.beginPath();
    ctx.rect(c[0]-hs/2, c[1]-hs/2, hs, hs);
    ctx.fill(); ctx.stroke();
  });
  ctx.restore();
}

/* 只重畫版位本身的內容，不畫綠色選取框/控制點——drawHostOverlay()是直接畫在
   跟畫面顯示同一個canvas上的（不是獨立疊一層），所以「目前有沒有選取商品」
   會直接影響這個canvas實際的像素內容。下載/匯出前一定要呼叫這個函式重畫
   一次乾淨版本，不然選取框會被一起轉出到下載的圖檔裡——使用者反映的
   「下載的圖片如果畫布中有選取商品，選取框會被一起轉出」就是這個原因。 */
function renderLayoutClean(layoutId){
  var bundle = bundles[layoutId];
  var canvas = canvases[layoutId];
  if(bundle && canvas){
    var groupText = (S.textGroups && S.textGroups[groupKeyForLayout(layoutId)]) || emptyTextGroup();
    var instExposureStyle = S.instanceExposureStyle && S.instanceExposureStyle[layoutId];
    var renderState = Object.assign({}, S, { text: groupText },
      instExposureStyle ? { exposureStyle: instExposureStyle } : null);
    Core.render(canvas, bundle, renderState, layoutId);
    /* 小標是即時疊加畫的(見drawSkbnTagOverlay())，不在Core.render()
       的cfg.layers清單裡——「乾淨版本」只代表不要選取框/控制點，這個
       疊加內容本身是實際內容，下載/匯出一定要一起畫進去，不能漏掉。
       錢幣現在烤進host合成圖裡(見shadow-popup.js)，Core.render()畫host
       的時候就已經包含錢幣了，不用在這裡另外處理。 */
    drawSkbnTagOverlay(canvas, layoutId);
  }
}

/* 2026-09新增：把「這個layoutId的host素材是哪個slotKey、目前的圖片是
   哪一張」這件事抽成一個共用的解析函式——KV(host)跟SKBN(hostSkinnyApp/
   hostSkinnyPc，依實例分開存在S.instanceAssets)雖然資料放的地方不一樣，
   但getHostBox()/commitHostPos()/ensureHostAutoFit()三支「畫選取框/
   拖曳縮放/自動貼合作圖區」的邏輯完全可以共用，只要一開始查清楚slotKey
   跟img是哪個就好，不用整套邏輯各寫一份。window.SKBN_INSTANCE_META查得到
   就是SKBN實例，查不到(包含HBN/LPBN等其他所有版位)一律當作KV的host。 */
function _resolveHostSlot(layoutId){
  var skbnMeta = window.SKBN_INSTANCE_META && window.SKBN_INSTANCE_META[layoutId];
  if(skbnMeta){
    /* 2026-09新增：券樣模式下SKBN直接讀跟其他版位共用的S.assets.host
       (見modules/logo-module.js同一個理由的說明)，這裡的畫布拖曳/縮放/
       選取框(getHostBox()/attachHostDragResize())也要跟著抓對圖片，
       不然選取框永遠抓到null，拖曳功能整個失效——slotKey維持不變
       (positions.json裡的欄位名稱還是'hostSkinnyApp'/'hostSkinnyPc'，
       只是圖片來源换了)。 */
    if(window.S && S.exposureStyle === 'coupon'){
      return { slotKey: skbnMeta.hostSlot, img: (S.assets && S.assets.host) || null };
    }
    var img = S.instanceAssets && S.instanceAssets[layoutId] && S.instanceAssets[layoutId][skbnMeta.hostSlot];
    return { slotKey: skbnMeta.hostSlot, img: (img instanceof HTMLImageElement) ? img : null };
  }
  /* 2026-09新增：外廣multiInstance(例如04_Facebook底下每一組)的host也是
     各自獨立存在S.instanceAssets[instanceId].host，不是共用S.assets.host——
     這裡沒有SKBN_INSTANCE_META可以查(這些layoutId不是SKBN)，直接看
     S.instanceAssets有沒有這個layoutId自己的host，有就優先用。查不到才
     照舊退回S.assets.host(一般分頁廣播共用host的情況，例如KV、外廣非
     multiInstance的大項)。少了這段，外廣multiInstance匯入完之後，畫布
     上完全點不到選取框(getHostBox()/attachHostDragResize()永遠查到
     null)，要使用者重新打開一次商品編輯popup再確認一次，選取框才會
     出現——這正是使用者實際回報的症狀。 */
  var instHost = S.instanceAssets && S.instanceAssets[layoutId] && S.instanceAssets[layoutId].host;
  if(instHost instanceof HTMLImageElement){
    return { slotKey: 'host', img: instHost };
  }
  return { slotKey: 'host', img: (S.assets && S.assets.host) || null };
}

/* 2026-09新增：這個版位「目前樣式」該用哪一份positions當基準——跟
   core.js的render()裡basePositions判斷完全同一套邏輯(有
   bundle.positionsByStyle[S.exposureStyle]就用它，查無資料才退回
   bundle.positions)，抽出來給ensureHostAutoFit()/getHostBox()共用。
   ★這是2026-09修正的bug：這兩支函式以前都寫死直接讀bundle.positions
   (=layoutConfig.positionsFile，也就是商品模式那份預設檔)，沒有考慮
   03_c2c_bn這種「依商品/券樣模式分開位置設定」的版位——商品模式的
   artZone(小塊、靠右)被誤用在券樣模式身上，導致券樣模式的KV合成圖
   一廣播出去就被硬塞進商品模式那個小小的作圖區框裡，整個被縮小/裁切。
   商品模式本身完全不受影響：positionsFileByStyle.product本來就跟
   positionsFile指向同一份檔案，這裡改讀法只是「换一條路徑读到同一份
   資料」，數值一模一樣；只有券樣模式(或之後其他有分模式的版位)會改讀到
   正確、各自獨立的那一份。 */
function _hostBasePositions(bundle){
  var styleEntry = (bundle.positionsByStyle && S.exposureStyle) ? bundle.positionsByStyle[S.exposureStyle] : null;
  /* ★2026-09再修正：core.js後來新增了「依A/B版本細分」的positionsByStyle
     格式({__versioned:true, A:..., B:...})，這支函式當時沒有同步更新，
     對這種格式的版位(例如08_popup)會直接把整個{__versioned,A,B}包裝
     物件當成positions資料在用，裡面根本沒有.assets這個key，導致算出來
     的zone是undefined、ensureHostAutoFit()整個跳過不執行，商品自然
     沒辦法拖曳/正確定位。跟core.js的render()同一套判斷邏輯，維持兩邊
     同步，之後core.js那邊如果再改，這裡也要記得一起改。 */
  if(styleEntry && styleEntry.__versioned){
    var ver = (S.templateVersion === 'B') ? 'B' : 'A';
    return styleEntry[ver] || styleEntry['A'] || bundle.positions;
  }
  return styleEntry || bundle.positions;
}

function commitHostPos(layoutId, pos, slotKey, img){
  S.positionOverrides = S.positionOverrides || {};
  S.positionOverrides[layoutId] = S.positionOverrides[layoutId] || {};
  S.positionOverrides[layoutId].assets = S.positionOverrides[layoutId].assets || {};
  S.positionOverrides[layoutId].assets[slotKey] = {
    xPct: pos.xPct, yPct: pos.yPct, hPct: pos.hPct, align: pos.align,
    /* 蓋章目前這張圖片的src——跟ensureHostAutoFit()/openPositionEditor
       writeBack()同一套判斷：這張圖在這個版位已經調整過了，換一張新圖之前
       都不會被自動貼合蓋掉。 */
    _srcTag: img ? img.src : undefined
  };
  renderAll();
}

function attachHostDragResize(canvas, layoutId){
  function toCanvasPos(e){
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
    var p = e.touches ? e.touches[0] : e;
    return { x:(p.clientX-rect.left)*scaleX, y:(p.clientY-rect.top)*scaleY };
  }
  /* 找離指定點最近的一個角控制點（四選一），太遠就回傳null。
     跟1200畫布(shadow-layout-receiver.js)的四角判定邏輯一致，只是這裡的
     控制點畫在colorBox(有色範圍)角落，不是整張圖(含透明留白)的角落。 */
  function nearestCorner(p, cb, hs){
    var corners = {
      tl: [cb.left,      cb.top],
      tr: [cb.left+cb.w, cb.top],
      bl: [cb.left,      cb.top+cb.h],
      br: [cb.left+cb.w, cb.top+cb.h]
    };
    var best = null, bestDist = hs;
    Object.keys(corners).forEach(function(k){
      var d = Math.max(Math.abs(p.x-corners[k][0]), Math.abs(p.y-corners[k][1]));
      if(d < bestDist){ bestDist = d; best = k; }
    });
    return best;
  }
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', function(e){
    var box = getHostBox(layoutId);
    if(!box){
      if(_hostSelected[layoutId]){ _hostSelected[layoutId] = false; renderAll(); }
      return;
    }
    var p = toCanvasPos(e);
    var cb = box.colorBox;
    var hs = Math.max(10, canvas.width*0.02);
    var corner = nearestCorner(p, cb, hs);
    var insideBox = p.x>=cb.left && p.x<=cb.left+cb.w && p.y>=cb.top && p.y<=cb.top+cb.h;
    if(!corner && !insideBox){
      if(_hostSelected[layoutId]){ _hostSelected[layoutId] = false; renderAll(); }
      return;
    }
    e.preventDefault();
    _hostSelected[layoutId] = true;
    /* 2026-09新增：直接點選畫布上的商品/host本體，也算「明確點選」——
       跟著切換右側文案面板/左側清單高亮到這個版位，並且出現白邊，滿足
       使用者「點選了該製作物的商品...就會出現白邊」的需求。 */
    _focusedLayoutId = layoutId;
    switchActiveTextGroup(groupKeyForLayout(layoutId));
    setExplicitCanvasSelection(layoutId);
    canvas.setPointerCapture(e.pointerId);
    _hostInteraction = {
      layoutId: layoutId,
      slotKey: box.slotKey,
      img: box.img,
      mode: corner ? 'resize' : 'move',
      corner: corner,
      startPointer: p,
      startPos: Object.assign({}, box.pos),
      startColorBox: { left:cb.left, top:cb.top, w:cb.w, h:cb.h },
      tight: Core.calcTightBoundsRatio(box.img) || { tx:0, ty:0, tw:1, th:1 },
      ratio: box.w / box.h, // 整張圖(含透明留白)的寬高比，resize時用這個把高度換算回寬度，維持不變形
      canvasW: box.canvasW,
      canvasH: box.canvasH
    };
    renderAll();
  });
  canvas.addEventListener('pointermove', function(e){
    var it = _hostInteraction;
    if(!it || it.layoutId !== layoutId) return;
    e.preventDefault();
    var p = toCanvasPos(e);
    var newPos = Object.assign({}, it.startPos);
    if(it.mode === 'move'){
      newPos.xPct = it.startPos.xPct + (p.x - it.startPointer.x) / it.canvasW;
      newPos.yPct = it.startPos.yPct + (p.y - it.startPointer.y) / it.canvasH;
    } else {
      /* 四角resize：被拖的角移動，對角(anchor)維持在原本的像素位置不動——
         跟1200畫布同一套邏輯。只用垂直距離算新高度(維持「拖曳手感=上下
         移動決定大小」的原本習慣)，寬度用圖片原始寬高比自動換算，不會
         變形。tight是有色範圍佔整張圖的比例，anchor角只是colorBox的某個
         角，要先換算回「整張圖(含透明留白)」的box角落，再回推xPct/yPct。 */
      var cb0 = it.startColorBox, tight = it.tight, ratio = it.ratio;
      var corner = it.corner;
      var anchorIsTop = (corner === 'bl' || corner === 'br'); // 拖的是下方角 → anchor在上方
      var anchorIsLeft = (corner === 'tr' || corner === 'br'); // 拖的是右邊角 → anchor在左邊
      var anchorX = anchorIsLeft ? cb0.left : cb0.left + cb0.w;
      var anchorY = anchorIsTop ? cb0.top : cb0.top + cb0.h;

      var newH;
      if(anchorIsTop){ newH = (p.y - anchorY) / tight.th; }
      else { newH = (anchorY - p.y) / tight.th; }
      newH = Math.max(4, newH);
      var newW = newH * ratio;

      var newBoxLeft = anchorIsLeft ? (anchorX - tight.tx*newW) : (anchorX - (tight.tx+tight.tw)*newW);
      var newBoxTop  = anchorIsTop  ? (anchorY - tight.ty*newH) : (anchorY - (tight.ty+tight.th)*newH);

      newPos.hPct = newH / it.canvasH;
      newPos.yPct = newBoxTop / it.canvasH;
      newPos.xPct = (it.startPos.align === 'center') ? (newBoxLeft + newW/2) / it.canvasW : newBoxLeft / it.canvasW;
    }
    commitHostPos(layoutId, newPos, it.slotKey, it.img);
  });
  ['pointerup','pointercancel'].forEach(function(evt){
    canvas.addEventListener(evt, function(){
      if(_hostInteraction && _hostInteraction.layoutId === layoutId) _hostInteraction = null;
    });
  });
}

/* ══════════════════ SKBN小標(價格牌)直接在主畫布上拖曳/縮放 ══════════════════
   2026-09新增：使用者反映想直接在SKBN畫布上調整小標位置/大小，不想開
   「商品/小標」陰影popup才能調——小標不像商品(host)那樣烤進一張合成PNG，
   而是每次renderAll()都即時算好位置、直接畫在SKBN畫布最上層(跟
   drawHostOverlay()的「選取框疊加」是同一種「render完之後再疊一層」的
   做法，但這裡疊的是真正的小標內容，不是選取框)。
   小標的設定資料存在S.skbnProductSlots[product].priceTag，依「商品」
   共用(APP/PC用同一份)——跟js/shadow-system/skbn-shadow-popup.js的
   popup控制面板讀寫同一份資料，兩邊即時同步。 */
var _skbnTagSelected = {};      // layoutId -> boolean
var _skbnTagInteraction = null; // 目前拖曳中的小標互動狀態

/* 2026-09新增：APP／PC小標位置的「連動」規則——
     - APP永遠使用商品共用的S.skbnProductSlots[product].priceTag(offsetXPct/
       offsetYPct)，拖曳APP的小標就是直接改這份共用資料，天然會連動所有
       「還沒自己獨立調整過」的PC實例(因為PC預設也是讀同一份共用資料)。
     - PC只要自己被拖曳調整過一次，就會在S.skbnSlots[pcInstanceId].tagPosOverride
       記一份自己的{offsetXPct,offsetYPct}，從此以後這個PC實例一律使用
       自己的獨立位置，不再跟著APP共用資料走、也不會回頭去改共用資料
       (不影響APP或其他PC實例)。
     這樣「第一次調整粗略一樣(共用預設)，但PC之後可以自己細調、不用擔心
     被APP動到」的行為，只要PC還沒被拖過就是連動，拖過一次就自動解除連動，
     不用使用者自己按什麼「解除連動」的開關。 */
function _skbnTagEffectiveOffset(layoutId, meta, cfg){
  if(meta.hostSlot === 'hostSkinnyPc'){
    var ov = S.skbnSlots && S.skbnSlots[layoutId] && S.skbnSlots[layoutId].tagPosOverride;
    if(ov && typeof ov.offsetXPct === 'number') return ov;
  }
  return cfg; // APP、或還沒獨立調整過的PC，都用商品共用的cfg
}

/* 算出這個SKBN實例目前小標要畫在畫布的哪裡——offsetXPct/offsetYPct是
   相對「商品有色範圍(colorBox)」的比例，跟popup裡_skbnComputeTagBox()
   同一套數學，只是這裡的bbox來源是getHostBox()算出來的主畫布colorBox，
   不是popup內部receiver的商品座標。找不到商品(host)還沒放進來、或小標
   關閉，回傳null。 */
function getSkbnTagBox(layoutId){
  var meta = window.SKBN_INSTANCE_META && window.SKBN_INSTANCE_META[layoutId];
  if(!meta) return null; // 不是SKBN實例，其他版位一律不受影響
  var cfg = S.skbnProductSlots && S.skbnProductSlots[meta.product] && S.skbnProductSlots[meta.product].priceTag;
  if(!cfg || !cfg.on) return null;
  var hostBox = getHostBox(layoutId);
  if(!hostBox) return null; // 商品都還沒放進來，小標沒有依附的對象
  var bbox = hostBox.colorBox;
  var canvas = canvases[layoutId];
  if(!canvas) return null;
  var ctx = canvas.getContext('2d');

  var pos = _skbnTagEffectiveOffset(layoutId, meta, cfg);
  var tagCx = bbox.left + pos.offsetXPct * bbox.w;
  var tagCy = bbox.top + pos.offsetYPct * bbox.h;
  var dx = tagCx - (bbox.left + bbox.w/2);
  var orientation = (Math.abs(dx) <= 6) ? (cfg.orientation || 'left') : (dx < 0 ? 'right' : 'left');
  cfg.orientation = orientation; // 記住這次算出來的方向，維持左右切換時的滯後區間(跟popup那套一致)

  /* 2026-09新增：大小改成依「實例」存(S.skbnSlots[instanceId].tagScaleMul)，
     不是依商品(cfg.scaleMul)——位置/方向APP、PC本來就該共用(同一份cfg)，
     但大小需要各自獨立：PC畫布高度只有110px，即使已經用了比較大的
     meta.tagHRatio基準值，使用者手動微調時如果跟APP共用同一個倍率，PC
     那邊等比例縮放出來的視覺大小還是會跟APP對不起來(矮的畫布放大同樣的
     倍率，字看起來還是相對偏小或偏大)，需要能各自調整。 */
  S.skbnSlots = S.skbnSlots || {};
  var instRec = S.skbnSlots[layoutId] || {};
  var tagScaleMul = (typeof instRec.tagScaleMul === 'number') ? instRec.tagScaleMul : 1;

  var baseH = canvas.height * (meta.tagHRatio || 0.15);
  var h = baseH * tagScaleMul;
  var size = Modules.pricetag.computeSize(ctx, h, cfg.originalPrice, cfg.salePrice);
  var w = size.w;

  return {
    x: tagCx - w/2, y: tagCy - h/2, w:w, h:h,
    cx: tagCx, cy: tagCy,
    orientation: orientation,
    originalPrice: cfg.originalPrice, salePrice: cfg.salePrice,
    product: meta.product, bbox: bbox
  };
}

function drawSkbnTagOverlay(canvas, layoutId){
  var box = getSkbnTagBox(layoutId);
  if(!box) return;
  Modules.pricetag.draw(canvas.getContext('2d'), box);
}

function drawSkbnTagSelectionOverlay(canvas, layoutId){
  if(!_skbnTagSelected[layoutId]) return;
  var box = getSkbnTagBox(layoutId);
  if(!box) return;
  var ctx = canvas.getContext('2d');
  ctx.save();
  /* 用藍色(跟商品選取框的綠色#22c55e區分)，避免使用者搞混現在選到的是
     商品還是小標。 */
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = Math.max(1.5, canvas.width*0.0025);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  var hs = Math.max(8, canvas.width*0.018);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#3b82f6';
  [[box.x,box.y],[box.x+box.w,box.y],[box.x,box.y+box.h],[box.x+box.w,box.y+box.h]].forEach(function(c){
    ctx.beginPath();
    ctx.rect(c[0]-hs/2, c[1]-hs/2, hs, hs);
    ctx.fill(); ctx.stroke();
  });
  ctx.restore();
}

/* 小標的拖曳/縮放監聽器要在attachHostDragResize()「之前」綁在同一個
   canvas上——同一個element先註冊的監聽器先執行，這樣點到小標時可以
   優先判定成「拖小標」，不會被後面商品(host)的判定搶走(小標通常貼在
   商品邊緣附近，兩個判定範圍可能有一點點重疊)。縮放不用像商品那樣分
   4個角各自算anchor，小標本來就是「以中心點等比放大/縮小」，用滑鼠到
   中心的距離比例即可，4個角效果一致，程式也比較單純。 */
function attachSkbnTagDragResize(canvas, layoutId){
  var meta = window.SKBN_INSTANCE_META && window.SKBN_INSTANCE_META[layoutId];
  if(!meta) return; // 不是SKBN實例，不綁這組，其他版位完全不受影響

  function toCanvasPos(e){
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
    var p = e.touches ? e.touches[0] : e;
    return { x:(p.clientX-rect.left)*scaleX, y:(p.clientY-rect.top)*scaleY };
  }
  function nearestCorner(p, box, hs){
    var corners = { tl:[box.x,box.y], tr:[box.x+box.w,box.y], bl:[box.x,box.y+box.h], br:[box.x+box.w,box.y+box.h] };
    var best=null, bestDist=hs;
    Object.keys(corners).forEach(function(k){
      var d = Math.max(Math.abs(p.x-corners[k][0]), Math.abs(p.y-corners[k][1]));
      if(d<bestDist){ bestDist=d; best=k; }
    });
    return best;
  }

  canvas.addEventListener('pointerdown', function(e){
    var box = getSkbnTagBox(layoutId);
    if(!box){
      if(_skbnTagSelected[layoutId]){ _skbnTagSelected[layoutId] = false; renderAll(); }
      return;
    }
    var p = toCanvasPos(e);
    var hs = Math.max(8, canvas.width*0.018);
    var corner = nearestCorner(p, box, hs);
    var insideBox = p.x>=box.x && p.x<=box.x+box.w && p.y>=box.y && p.y<=box.y+box.h;
    if(!corner && !insideBox){
      if(_skbnTagSelected[layoutId]){ _skbnTagSelected[layoutId] = false; renderAll(); }
      return;
    }
    e.preventDefault();
    e.stopPropagation(); // 命中小標就不要再讓商品(host)的pointerdown也處理這次點擊
    _skbnTagSelected[layoutId] = true;
    canvas.setPointerCapture(e.pointerId);
    S.skbnProductSlots = S.skbnProductSlots || {};
    var cfg = S.skbnProductSlots[meta.product] && S.skbnProductSlots[meta.product].priceTag;
    if(!cfg) return;
    S.skbnSlots = S.skbnSlots || {};
    S.skbnSlots[layoutId] = S.skbnSlots[layoutId] || {};
    var startPos = _skbnTagEffectiveOffset(layoutId, meta, cfg); // PC如果已經獨立調整過，要從自己的位置開始拖，不是從共用cfg開始
    _skbnTagInteraction = {
      layoutId: layoutId,
      product: meta.product,
      isPc: meta.hostSlot === 'hostSkinnyPc',
      mode: corner ? 'resize' : 'move',
      startPointer: p,
      startOffsetXPct: startPos.offsetXPct,
      startOffsetYPct: startPos.offsetYPct,
      startTagScaleMul: (typeof S.skbnSlots[layoutId].tagScaleMul === 'number') ? S.skbnSlots[layoutId].tagScaleMul : 1, // 大小(依實例)的起始值
      startBBox: box.bbox,
      startBox: box
    };
    renderAll();
  });

  canvas.addEventListener('pointermove', function(e){
    var it = _skbnTagInteraction;
    if(!it || it.layoutId !== layoutId) return;
    e.preventDefault();
    var p = toCanvasPos(e);
    var cfg = S.skbnProductSlots[it.product] && S.skbnProductSlots[it.product].priceTag;
    if(!cfg) return;
    if(it.mode === 'move'){
      var dx = p.x - it.startPointer.x, dy = p.y - it.startPointer.y;
      var newOffsetXPct = it.startOffsetXPct + dx/(it.startBBox.w||1);
      var newOffsetYPct = it.startOffsetYPct + dy/(it.startBBox.h||1);
      if(it.isPc){
        /* PC：寫進自己的tagPosOverride，從此這個PC實例的位置就獨立出來，
           不再跟著APP共用的cfg走，也不會回頭去改cfg(不影響APP或其他PC)。
           見上面_skbnTagEffectiveOffset()的說明。 */
        S.skbnSlots[it.layoutId].tagPosOverride = { offsetXPct: newOffsetXPct, offsetYPct: newOffsetYPct };
      } else {
        /* APP：直接改商品共用的cfg，天然連動所有「還沒自己獨立調整過」
           的PC實例。 */
        cfg.offsetXPct = newOffsetXPct;
        cfg.offsetYPct = newOffsetYPct;
      }
    } else {
      /* 大小依實例存，只影響目前這個畫布(APP或PC)自己，不會連動另一邊。 */
      S.skbnSlots = S.skbnSlots || {};
      S.skbnSlots[it.layoutId] = S.skbnSlots[it.layoutId] || {};
      var startDist = Math.max(1, Math.hypot(it.startPointer.x-it.startBox.cx, it.startPointer.y-it.startBox.cy));
      var curDist = Math.hypot(p.x-it.startBox.cx, p.y-it.startBox.cy);
      S.skbnSlots[it.layoutId].tagScaleMul = Math.max(0.2, Math.min(5, it.startTagScaleMul * (curDist/startDist)));
    }
    renderAll();
  });

  ['pointerup','pointercancel'].forEach(function(evt){
    canvas.addEventListener(evt, function(){
      if(_skbnTagInteraction && _skbnTagInteraction.layoutId === layoutId) _skbnTagInteraction = null;
    });
  });
}





/* ══════════════════ 商品(host)自動貼合「作圖區」══════════════════
   有artZone設定的版位，第一次收到商品圖時，用「有色範圍(去掉圖片本身的
   透明留白)填滿作圖區、水平置中、頂部對齊、再放大」自動算一次初始位置/
   大小，寫進S.positionOverrides[layoutId].assets.host。

   ★ 2026-08 修正「重新廣播商品會蓋掉手動調整過的位置」：原本判斷「要不要
   重新自動貼合」的方式是比對_srcTag跟目前S.assets.host.src是不是同一張圖，
   想法是「同一張圖=使用者調過了、不要蓋掉；換了新圖=真的要重新貼合」。
   但S.assets.host其實是1200畫布「確認並套用」時透過URL.createObjectURL()
   產生的blob URL，每按一次確認、即使畫面內容幾乎沒變，也一定會產生一個
   全新的blob URL字串——所以只要重新廣播一次，_srcTag永遠對不上，等於
   每次重新廣播都會被判定成「換了新圖」，重新自動貼合一次，蓋掉使用者在
   個別版位手動調整過的大小/位置。

   改成：只要這個版位的host已經有過override（不管是自動貼合出來的、還是
   使用者手動調整過的），就不再重新自動貼合，只有「這個版位這個分頁裡
   從來沒有過host位置資料」才會自動貼合——也就是「只有第一次廣播會自動
   貼合，之後不管重新廣播幾次，都維持目前(可能是使用者調整過)的位置」，
   符合「除了第一次廣播，後面更新都用調整後的位置」的需求。

   ★ 2026-08再修正「作圖區被壓縮太多、商品被CTA/遮罩擋住卡不下去」：
   之前為了不讓商品蓋到CTA/底部遮罩，做法是直接把positions.json裡
   artZone本身縮小（bottom往上收）。但這樣等於把「使用者以後想手動調整
   的可用範圍」也一起縮小了——使用者反映：作圖範圍(拿來給logo-module.js
   做clip、以及以後想手動拖曳/放大時參考的邊界)應該維持完整、到畫布最底，
   商品放進去之後想不想蓋到CTA/遮罩，應該讓使用者自己手動決定，程式不該
   幫他鎖死。真正該縮小的，只有「第一次自動貼合時預設算出來的大小/位置」，
   避免商品一進來就預設卡到CTA/遮罩，之後這個位置使用者仍然可以自己往下
   調整覆蓋過去。

   做法：baseHost.artZone維持「完整版」不動（bottom/right都是真正的畫布
   邊界，clip也用這個範圍，不會提早裁切）；如果baseHost.initialReserve
   有值（{bottom, right}，單位px），只在「第一次自動貼合」這一次的計算
   時，另外算一個「縮小版」的暫時zone丟給calcArtZoneFit()，不會回寫、
   不會影響到baseHost.artZone本身。 */
function ensureHostAutoFit(){
  activeLayouts().forEach(function(layout){
    var bundle = bundles[layout.id];
    if(!bundle || !bundle.positions) return;
    var resolved = _resolveHostSlot(layout.id);
    var slotKey = resolved.slotKey, img = resolved.img;
    var baseHost = _hostBasePositions(bundle).assets && _hostBasePositions(bundle).assets[slotKey];
    var zone = baseHost && baseHost.artZone;
    if(!zone) return; // 這個版位沒設定作圖區，不受影響，維持原來的行為

    if(!(img instanceof HTMLImageElement) || !img.complete || !img.naturalWidth) return;

    S.positionOverrides = S.positionOverrides || {};
    S.positionOverrides[layout.id] = S.positionOverrides[layout.id] || {};
    var ov = S.positionOverrides[layout.id];
    ov.assets = ov.assets || {};

    var isSkbn = !!(window.SKBN_INSTANCE_META && window.SKBN_INSTANCE_META[layout.id]);
    if(isSkbn){
      /* SKBN合成圖是用toDataURL()產生的內容決定性字串——同一次合成結果
         (使用者沒有重新調整、只是重新整理畫面)src會完全一樣，可以放心拿來
         判斷「圖片內容是不是真的換了」；真的換了(使用者在popup裡重新調整、
         按下確認)才需要重新fit，這樣popup調出來的構圖每次都能準確反映到
         主畫布，不會停在舊的版面。 */
      if(ov.assets[slotKey] && ov.assets[slotKey]._srcTag === img.src) return;
    } else {
      /* KV等其他版位維持原本行為：只要曾經fit過(或使用者手動調過)一次，
         不管圖片有沒有換都不再自動蓋掉——host是blob URL，每次「確認並
         套用」字串一定不同，沒辦法用_srcTag可靠判斷「是不是真的換了新圖」
         (見下面原本函式頭的完整說明)。 */
      if(ov.assets[slotKey]) return;
    }

    var canvasW = bundle.layoutConfig.canvas.w, canvasH = bundle.layoutConfig.canvas.h;
    var fitZone = zone;
    var reserve = baseHost.initialReserve;
    if(reserve){
      var zLeft = zone.xPct - zone.wPct/2;
      var zRight = zone.xPct + zone.wPct/2;
      var zBottom = zone.topPct + zone.hPct;
      var newRight = zRight - (reserve.right||0)/canvasW;
      var newBottom = zBottom - (reserve.bottom||0)/canvasH;
      fitZone = {
        xPct: (zLeft+newRight)/2,
        topPct: zone.topPct,
        wPct: newRight - zLeft,
        hPct: newBottom - zone.topPct,
        enlarge: zone.enlarge
      };
    }

    var fit = baseHost.bottomAlignPx
      /* bottomAlignPx（選填，單位px，畫布座標，例如550高的畫布填459）：
         縮放倍率算法完全跟calcArtZoneFit()一樣(照這張圖實際有色範圍，
         取寬高比較吃緊的方向算scale，不同商品組合貼出來的比例仍然會不同)，
         只有「貼在哪個高度」不一樣——不是有色範圍頂部對齊zone頂部，而是
         有色範圍底部對齊這個指定的px數字(例如遮罩最高點的位置)，用在
         LPBN_APP/LPBN_PC這種下面有底部遮罩的版位，見configs/layouts/
         11_lpbn_app-positions.json的host.bottomAlignPx說明。 */
      ? Core.calcArtZoneFitBottomAlign(img, fitZone, canvasW, canvasH, baseHost.bottomAlignPx)
      : baseHost.centerVertical
        /* centerVertical(選填，布林值)：有色範圍在作圖區裡垂直置中，不是
           頂部對齊——給SKBN(Skinny BN APP/PC)用，見configs/layouts/
           skinny_app-positions.json、skinny_pc-positions.json的
           host.centerVertical說明。 */
        ? Core.calcArtZoneFitCenter(img, fitZone, canvasW, canvasH)
        : Core.calcArtZoneFit(img, fitZone, canvasW, canvasH);
    /* baseHost.downOffsetPx（選填，單位px，正值＝往下）／baseHost.leftOffsetPx
       （選填，單位px，正值＝往左）：貼合完之後，再整體平移這麼多px，跟
       zone.enlarge是三件獨立的事，互不影響。這次刻意取名「downOffsetPx」
       （不是之前的bottomOffsetPx）——正值就是直接往下，跟講的方向一致，
       不用像之前bottomOffsetPx那樣「正值反而是往上」，容易搞混。 */
    if(baseHost.downOffsetPx){
      fit.yPct += baseHost.downOffsetPx / canvasH;
    }
    if(baseHost.leftOffsetPx){
      fit.xPct -= baseHost.leftOffsetPx / canvasW;
    }
    /* 頂部對齊、底部不超出畫布——見core/core.js的clampFitBottomToCanvas()
       說明。放在downOffsetPx/leftOffsetPx都套用完之後才做這個檢查，因為
       downOffsetPx本身也可能是造成超出畫布的原因之一，要用「最終」的
       位置去判斷才準。downOffsetPx如果是很大的負值（例如「整體往上推遮罩
       高度」這種需求），也可能反過來讓頂部超出畫布上緣，所以頂部/底部
       兩個方向都要各自檢查一次，見clampFitTopToCanvas()說明。 */
    fit = Core.clampFitTopToCanvas(fit, img, canvasH);
    fit = Core.clampFitBottomToCanvas(fit, img, canvasH);
    ov.assets[slotKey] = Object.assign({}, fit, { _srcTag: img.src });
  });
}

/* ══════════════════ AUTOSAVE_KEY ══════════════════
   2026-08：使用者明確要求「重新整理＝整個刷掉重來」，不要接續上次的內容，
   所以拿掉了原本「每次renderAll()都debounce寫進localStorage、重新整理時
   自動讀回來」那套自動記住機制（scheduleAutosave()/loadAutosave()都移除了）。
   這個常數還留著，只是給「重設」按鈕跟開啟頁面時清一次localStorage用，
   確保舊版留下來的自動記住資料不會殘留、不小心被讀到。
   想保留工作內容的話，用上面的「儲存暫存」下載一份.json，之後用
   「載入暫存」讀回來，這個手動存讀檔的功能完全不受影響，一樣正常運作。 */
var AUTOSAVE_KEY = 'circle_editor_autosave_v1';

/* 左側「顯示版位」勾選清單：不完全依賴Excel「製作素材」欄位自動判斷
   （filterLayoutsByMaterials()），讓使用者自己也能手動開關某個版位——
   例如新加的版位在某些舊工單格式裡沒被自動偵測到、或想暫時關掉某個
   版位不輸出，都可以直接在這裡勾/取消勾，不用重新匯入工單。 */
function buildLayoutToggleList(){
  var body = document.getElementById('layout-toggle-body');
  if(!body) return;
  /* 排除動態註冊出來的「複製實例」版位(例如HBN週三版'03_c2c_bn__2')——
     這份清單只給使用者手動開關「版位種類」用，複製實例本身不是獨立種類，
     不應該在這裡多長出一個看起來莫名其妙的額外選項。 */
  var aliasBase = window.LAYOUT_ALIAS_BASE || {};
  body.innerHTML = LAYOUT_REGISTRY.filter(function(l){ return !aliasBase[l.id]; }).map(function(l){
    var checked = S.activeLayoutIds.indexOf(l.id) >= 0;
    return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-dim);cursor:pointer;">'+
      '<input type="checkbox" data-layout-id="'+l.id+'" '+(checked?'checked':'')+'> '+esc(l.name)+
    '</label>';
  }).join('');
  Array.prototype.forEach.call(body.querySelectorAll('input[type=checkbox]'), function(cb){
    cb.onchange = function(){
      var id = cb.dataset.layoutId;
      var idx = S.activeLayoutIds.indexOf(id);
      if(cb.checked){ if(idx<0) S.activeLayoutIds.push(id); }
      else if(idx>=0){ S.activeLayoutIds.splice(idx,1); }
      buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
    };
  });
}

function buildAssetList(){
  var body = document.getElementById('asset-list-body');
  var list = activeLayouts();
  if(!list.length){
    body.innerHTML = '<div class="empty-hint">這個分頁沒有對應到任何版位</div>';
    return;
  }
  /* 2026-09調整：左側素材清單同時身兼「文案/商品切換器」，「亮燈」要
     跟著_focusedLayoutId(目前捲動/點選聚焦在哪一個版位)走，不是比對
     「這個版位是不是屬於目前這組文案(S.activeTextGroup)」——很多分頁
     全部版位共用同一組文案，用「同一組」當判斷條件會讓整份清單一起亮，
     使用者反映過這個問題。_focusedLayoutId永遠只會有一個版位，亮燈
     自然只會有一項。 */
  body.innerHTML = list.map(function(l){
    var isActive = (l.id === _focusedLayoutId);
    return '<div class="asset-item'+(isActive?' asset-item-active':'')+'" id="asset-item-'+esc(l.id)+'" onclick="selectMaterialListItem(\''+l.id+'\')">'+
      '<span class="asset-name">'+l.name+'</span>'+
      '<button class="asset-dl" onclick="event.stopPropagation();downloadSingle(\''+l.id+'\')">'+ICON_DOWNLOAD+'</button>'+
    '</div>';
  }).join('');
}

/* 左側素材清單點下去：切換文案分組(連帶切到這組對應的商品編輯目標，
   如果這個版位有專屬的「編輯商品」mini按鈕的話)+捲動到對應畫布。 */
function selectMaterialListItem(layoutId){
  _focusedLayoutId = layoutId;
  switchActiveTextGroup(groupKeyForLayout(layoutId));
  setExplicitCanvasSelection(layoutId); // 明確點選左側清單項目，出現白邊
  scrollToCanvas(layoutId);
}

function scrollToCanvas(id){
  var block = document.getElementById('canvas-block-'+id);
  if(!block) return;
  /* 捲動過去這件事本身會觸發#canvas-area的scroll事件，要跟「使用者自己
     手動滑動」區分開——不然這個程式化捲動會被誤判成使用者在滑，緊接著
     把剛剛setExplicitCanvasSelection()設好的白邊清掉。700ms是抓一個比
     smooth捲動動畫本身還長一點的緩衝，捲完之後才恢復正常監聽捲動事件。 */
  _suppressScrollTracking = true;
  if(_suppressScrollTrackingTimer) clearTimeout(_suppressScrollTrackingTimer);
  _suppressScrollTrackingTimer = setTimeout(function(){ _suppressScrollTracking = false; }, 700);
  block.scrollIntoView({behavior:'smooth', block:'start'});
}

/* ══════════════════ 右側控制面板 ══════════════════ */

/* 有banword警告UI(div#banwarn-KEY)的欄位——跟TEXT_LIMITS（字數上限）是
   兩件事：字數上限只有標題/副標有，但禁用語檢查（例如日期格式相關的規則）
   日期欄位也需要，不能因為日期沒有字數上限就整個跳過禁用語檢查。 */
/* 右側面板/存讀檔會用到的完整文字欄位清單——4個地方(bindTextInputs()、
   syncTextPanelFromActiveGroup()、isEmptyDefaultTabData()、
   buildTabDataFromParsedBlock())原本各自寫死同一組陣列，2026-09新增
   'SKBN案型'時很容易漏改其中一處，改成共用同一份常數。 */
var TEXT_FIELD_KEYS = ['標題','副標','日期','AR文案','SKBN案型','第1張(後)','第2張(前)','票券1'];

var BANWORD_CHECK_FIELDS = ['標題','副標','日期','票券1'];

/* 文案格式規範（規範表要求）：
   1. 日期欄位不能有補0的數字——例如「01/02」要自動變成「1/2」，「09」變成「9」，
      本來就沒補0的數字、或非數字的字元（斜線、波浪號、"至"...）都不受影響。
   2. 任何欄位裡「$」後面接的整數，自動補上千分位逗號——例如「$1111」變成
      「$1,111」，「$1111.5」變成「$1,111.5」（小數點後面的數字不受影響），
      已經有逗號的維持原樣不會重複處理。
   這裡故意選在「離開欄位(blur)」的時候才格式化，不是每打一個字就重寫一次——
   如果打字當下就立刻拿掉開頭的0，使用者會沒辦法打出「07」這種數字（打第一個
   0就被清空，永遠打不出兩位數），所以等使用者打完、游標離開欄位才處理一次。 */
function normalizeTextValue(key, text){
  if(!text) return text;
  var out = text;
  if(key === '日期'){
    out = out.replace(/(^|[^\d])0+(\d)/g, '$1$2');
  }
  out = out.replace(/\$(\d+)(\.\d+)?/g, function(m, intPart, decPart){
    return '$' + Number(intPart).toLocaleString('en-US') + (decPart || '');
  });
  return out;
}

/* oninput/onblur只在這裡綁一次（讀寫都透過activeText()指向「目前作用中那組」），
   切換文案組(switchActiveTextGroup)時不用重新綁一次事件，只需要呼叫
   syncTextPanelFromActiveGroup()把輸入框顯示值換成新的那組即可。 */
/* 2026-09新增：副標/日期改成textarea後(見editor.html)，不要出現瀏覽器
   原生那個可以拖曳調整大小的三角形箭頭(使用者反映很礙眼)，改成內容變多
   時自動撐高——每次值變動都重新量一次scrollHeight，把高度設成剛好貼合
   內容，不會有多餘空白也不會被截斷。只對textarea元素有效(input沒有
   scrollHeight這個概念，呼叫這支函式沒有副作用，直接return)。 */
function autoGrowTextarea(el){
  if(!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function bindTextInputs(){
  TEXT_FIELD_KEYS.forEach(function(key){
    var el = document.getElementById('input-'+key);
    if(!el) return;
    el.value = activeText()[key] || '';
    autoGrowTextarea(el);
    el.oninput = function(){
      activeText()[key] = el.value;
      autoGrowTextarea(el);
      renderAll();
      if(BANWORD_CHECK_FIELDS.indexOf(key) !== -1) updateTextCompliance(key);
    };
    el.onblur = function(){
      var normalized = normalizeTextValue(key, el.value);
      if(normalized !== el.value){
        el.value = normalized;
        activeText()[key] = normalized;
        autoGrowTextarea(el);
        renderAll();
        if(BANWORD_CHECK_FIELDS.indexOf(key) !== -1) updateTextCompliance(key);
      }
    };
    if(BANWORD_CHECK_FIELDS.indexOf(key) !== -1) updateTextCompliance(key);
  });
}

/* 切換文案組(點畫布或點切換鈕)之後，把右側四個輸入框的「顯示值」換成
   新的active那組資料——不重新綁事件(bindTextInputs已經綁過一次、讀寫都是
   透過activeText()動態指向，本來就會自動對到新的組)，只需要重新塞值進去
   + 重新跑一次字數計燈/禁用語檢查(這兩個是純UI顯示，跟著顯示的那組走)。 */
function syncTextPanelFromActiveGroup(){
  TEXT_FIELD_KEYS.forEach(function(key){
    var el = document.getElementById('input-'+key);
    if(!el) return;
    el.value = activeText()[key] || '';
    autoGrowTextarea(el);
    if(BANWORD_CHECK_FIELDS.indexOf(key) !== -1) updateTextCompliance(key);
  });
}

/* 文案字數計燈 + 禁用語提示：字數計燈只套用在有設字數上限的欄位(標題/副標，
   見js/banwords.js的TEXT_LIMITS)；禁用語檢查套用在BANWORD_CHECK_FIELDS
   裡的所有欄位（標題/副標/日期），兩者是獨立判斷，日期沒有字數上限一樣
   要跑禁用語檢查。字數超過只是「亮燈提示」，不會擋輸入、也不會擋畫面上
   的即時預覽，真正會擋的時機在下載前（見editor-export.js的
   checkTextComplianceBeforeDownload()）。 */
function updateTextCompliance(key){
  var counterEl = document.getElementById('counter-'+key);
  var warnEl = document.getElementById('banwarn-'+key);
  var text = activeText()[key] || '';
  var limit = TEXT_LIMITS[key];

  if(counterEl && limit !== undefined){
    var weight = computeCharWeight(text);
    var display = (Number.isInteger(weight) ? weight : weight.toFixed(1));
    counterEl.textContent = display+'/'+limit;
    counterEl.classList.toggle('over', weight > limit);
  }

  if(warnEl){
    loadBanwords().then(function(list){
      var hits = checkBanwords(text, list);
      if(!hits.length){ warnEl.style.display = 'none'; warnEl.innerHTML = ''; return; }
      warnEl.style.display = '';
      warnEl.innerHTML = '⚠ 偵測到禁用語：<br>'+hits.map(function(h, i){
        var msg = esc(h.matchedText) + (h.replace ? '（建議改成「'+esc(h.replace)+'」）' : (h.note ? '（'+esc(h.note)+'）' : ''));
        /* 只有算得出明確、安全的替換文字(suggested)時才顯示「套用」按鈕——
           沒有suggested代表這個命中沒辦法自動判斷正確答案，讓使用者自己
           手動改比較保險，不硬套一個可能是錯的值。 */
        if(h.suggested !== null && h.suggested !== undefined && h.suggested !== h.matchedText){
          msg += ' <button type="button" class="banword-apply-btn" data-idx="'+i+'">套用</button>';
        }
        return msg;
      }).join('<br>');
      Array.prototype.forEach.call(warnEl.querySelectorAll('.banword-apply-btn'), function(btn){
        var hit = hits[Number(btn.dataset.idx)];
        btn.onclick = function(){ applyBanwordFix(key, hit); };
      });
    });
  }
}

/* 「套用」按鈕：直接把命中的那段文字換成算好的建議值，不用使用者自己重打。
   只換這一個命中位置（用當下算好的index/matchedText長度去切字串），換完
   立刻重新整段跑一次renderAll()+updateTextCompliance()——不在原本的hits
   陣列上就地修改其他命中的index（換了字之後，後面的文字位置可能全部
   位移，舊的index會失準），而是讓下一輪重新掃描整段文字、拿到全新且
   正確的命中結果，比較保險，也不用自己維護一套「位移補償」的邏輯。 */
function applyBanwordFix(key, hit){
  var text = activeText()[key] || '';
  var newText = text.slice(0, hit.index) + hit.suggested + text.slice(hit.index + hit.matchedText.length);
  activeText()[key] = newText;
  var el = document.getElementById('input-'+key);
  if(el) el.value = newText;
  renderAll();
  updateTextCompliance(key);
}

/* 給下載流程用：檢查目前所有有字數上限的文案欄位，回傳
   {overLimit:[{key,weight,limit}], banned:[{key,hits}]}，兩個陣列都是
   空的代表完全沒問題，呼叫端可以直接放行不用跳警告。
   ★overLimit(字數超過)只看TEXT_LIMITS(標題/副標)；banned(禁用語)看
   BANWORD_CHECK_FIELDS(標題/副標/日期)，兩份清單不一樣，日期字數沒有
   上限但禁用語一樣要檔下載前檢查一次。 */
/* 下載前檢查：這個分頁裡「所有」文案組都要檢查，不是只看右側面板目前
   顯示的那一組——不然沒被點開過、放著沒切換過去看的那組文案(例如文案2)
   超過字數/踩到禁用語，會完全沒被擋到就直接輸出。key前面加上組名前綴
   (例如'文案2 標題')方便使用者知道是哪一組哪個欄位出問題。 */
function checkTextCompliance(){
  return loadBanwords().then(function(list){
    var overLimit = [], banned = [];
    Object.keys(S.textGroups || {}).forEach(function(groupKey){
      var groupText = S.textGroups[groupKey] || {};
      var groupLabel = (Object.keys(S.textGroups).length > 1) ? (groupKey+' ') : '';
      Object.keys(TEXT_LIMITS).forEach(function(key){
        var text = groupText[key] || '';
        var weight = computeCharWeight(text);
        var limit = TEXT_LIMITS[key];
        if(weight > limit) overLimit.push({ key: groupLabel+key, weight:weight, limit:limit });
      });
      BANWORD_CHECK_FIELDS.forEach(function(key){
        var text = groupText[key] || '';
        var hits = checkBanwords(text, list);
        if(hits.length) banned.push({ key: groupLabel+key, hits:hits });
      });
    });
    return { overLimit: overLimit, banned: banned };
  });
}

/* LOGO1/LOGO2已經不再用右側面板的檔案上傳input（LOGO1固定套用預設值+匯入時
   資料夾比對覆蓋；LOGO2改成用js/logo2-editor.js的編輯popup），這裡不用再綁
   任何input了。原本的bindAssetUploads()（綁upload-logo1/upload-logo2這兩個
   input的onchange）已經移除，避免對著HTML裡已經不存在的元素呼叫.onchange
   噴錯誤。 */

/* logo1在pet-frenzy裡其實才是「固定不太會變」的那個（蝦皮直播brand），
   放在logos/資料夾當固定預設檔，跟現在Circle專案的邏輯是同一套：
   logos/logo_shopee_live.png 存在就自動載入當logo1預設值；
   使用者匯入工單時資料夾裡有比對到logo1、或手動上傳，一樣會覆蓋掉這個預設值。
   （logo2才是這個平台每次不一定一樣的，選填，見loadDefaultLogo2()） */
/* logo1預設帶入功能：2026-08應要求先關閉——原本這裡會自動載入
   logos/logo_shopee_live.png當logo1預設值，現在先不自動帶入，畫布上
   logo1的版位/位置完全沒變，使用者自己上傳的話一樣會正常顯示，只是
   不會有「使用者還沒上傳前，先看到蝦皮直播預設圖」這件事。
   跟loadDefaultLogo2()同一套「不自動帶入」的做法，之後要恢復自動帶入，
   把下面這行cb()改回原本讀取logos/logo_shopee_live.png的版本即可（見
   本檔案git歷史，或直接參考loadDefaultLogo1原本的實作模式：new Image()+
   img.onload時 if(!S.assets.logo1) S.assets.logo1=img）。 */
/* 2026-09新增：外廣(waiguang)每個尺寸都需要放同一顆固定的LOGO1(不像
   站內每次工單各自上傳)——只在S.siteMode==='external'時生效，站內完全
   不受影響(原本的no-op行為維持不變)。素材固定放logos/waiguang/logo1.png，
   讀不到就維持原樣(不畫，跟其他optional素材同一種失敗行為，不會讓
   畫面壞掉)。 */
/* 2026-09新增：外廣某幾個特別窄/特別小的尺寸(例如640x100這種細長橫幅、
   320x50這種超窄banner)，LOGO要用「方形」單一圖示，不是logo1+分隔線+
   logo2那種長條組合——不管在哪個大項底下，只要尺寸(instanceId '__'後面
   那一段)屬於這份清單，都會改套方形版logo1(logos/waiguang/
   logo1_square.png)，用S.instanceAssets[instanceId].logo1這個「這個
   實例自己的」欄位存，不影響其他尺寸繼續共用的S.assets.logo1(見
   modules/logo-module.js的draw()：查得到instanceAssets才優先用，查不到
   才退回共用的assets，兩者互不干擾)。之後如果還有其他尺寸也要用方形
   logo，直接把尺寸字串加進這個陣列即可，不用改下面的邏輯。 */
var WAIGUANG_SQUARE_LOGO_SIZES = ['640x100', '160x600', '320x50', '970x250'];

/* 2026-09新增：有些大項的LOGO要用「方形」版本(跟一般橫式的logo1.png不
   一樣)——目前是02_Facebook_DPA。★這裡原本以為DPA需要另外一支「直式」
   素材(logo1_vertical.png)，使用者後來確認其實就是共用WAIGUANG_SQUARE_
   LOGO_SIZES那些窄版尺寸在用的同一支logo1_square.png，不用另外準備
   檔案，這裡改成指向同一個檔案路徑。跟WAIGUANG_SQUARE_LOGO_SIZES查
   「尺寸」不同，這裡是查instanceId的「大項key」那一段(instanceId格式是
   '{大項key}__{尺寸}'，取'__'前面那一段)，因為DPA不管哪個尺寸，都固定
   套用方形版，不是跟著尺寸判斷。 */
var WAIGUANG_SQUARE_LOGO_SECTIONS = ['02_Facebook_DPA'];

function loadDefaultLogo1(cb){
  if(S.siteMode !== 'external'){ if(cb) cb(); return; }

  var pending = 0, scanDone = false;
  function checkDone(){ if(scanDone && pending<=0 && cb) cb(); }

  if(!S.assets.logo1){
    pending++;
    var img = new Image();
    img.onload = function(){ S.assets.logo1 = img; pending--; checkDone(); };
    img.onerror = function(){ pending--; checkDone(); };
    img.src = 'logos/waiguang/logo1.png';
  }

  (S.activeLayoutIds || []).forEach(function(instanceId){
    var parts = String(instanceId).split('__');
    var size = parts[parts.length-1];
    var section = parts.slice(0, parts.length-1).join('__');
    var variantSrc = null;
    if(WAIGUANG_SQUARE_LOGO_SECTIONS.indexOf(section) !== -1 || WAIGUANG_SQUARE_LOGO_SIZES.indexOf(size) !== -1){
      variantSrc = 'logos/waiguang/logo1_square.png';
    }
    if(!variantSrc) return;
    S.instanceAssets[instanceId] = S.instanceAssets[instanceId] || {};
    if(S.instanceAssets[instanceId].logo1) return;
    pending++;
    var img2 = new Image();
    img2.onload = function(){ S.instanceAssets[instanceId].logo1 = img2; pending--; checkDone(); };
    img2.onerror = function(){ pending--; checkDone(); };
    img2.src = variantSrc;
  });

  scanDone = true;
  checkDone();
}

/* logo2是「品牌LOGO，選填」。原本這裡會試著載入 logos/logo2-default.png
   當預設值，但這個專案裡從來沒有放過這個檔案（一直都是404），每次切換
   分頁/建立分頁都會白跑一次網路請求，而且如果剛好跟使用者手動上傳logo2
   的時間點重疊，開發階段測試時比較容易看起來像是「LOGO2出了什麼問題」，
   容易誤導排查方向。logo2本來就是選填、每次工單不一定一樣，不像logo1有
   固定的品牌素材，所以直接拿掉這個預設載入——沒有預設值時本來就會維持
   null，跟載入401/404失敗的結果完全一樣，行為不變，只是不再送出這個
   注定失敗的請求。 */
function loadDefaultLogo2(cb){ if(cb) cb(); }

/* CTA固定素材：兩種badge分別對應不同版位，不能共用同一個assets key——
   logos/DD.png（放心買 安心退）固定套用在DD Card(05_ddcard)、HBN(03_c2c_bn)；
   logos/CTA.png（逛逛去）固定套用在MSBN(07_msbn)。跟logo1同一套邏輯：
   只是「有預設檔就套用、找不到對應layer就靜靜不畫」，某個分頁的
   activeLayoutIds如果同時含有這兩種版位，兩個asset key會同時載入，互不影響。 */
/* 2026-08新增「A版／B版」支援：CTA badge的顏色是兩版差異之一，所以每個
   CTA檔名都改成先試「該版本專屬檔」（logos/A/DD.png、logos/B/DD.png），
   找不到才退回「共用檔」logos/DD.png（B版正式badge美術還沒補齊之前，先
   借用共用檔墊著，不會開天窗；之後把B版badge放進logos/B/資料夾，程式
   不用改，切到B版就會自動改用）。這幾個函式維持「有預設檔就套用、找不到
   對應layer就靜靜不畫」的邏輯，只是多了一層版本fallback。 */
function _loadVersionedDefaultImage(version, filename, cb){
  var img = new Image();
  var triedVersioned = false;
  img.onload = function(){ cb(img); };
  img.onerror = function(){
    if(!triedVersioned){ triedVersioned = true; img.src = 'logos/'+filename; }
    else { cb(null); }
  };
  img.src = 'logos/'+version+'/'+filename;
}

function loadDefaultCTA_DD(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'DD.png', function(img){ if(img && !S.assets.ctaDD) S.assets.ctaDD = img; if(cb) cb(); });
}
function loadDefaultCTA_Go(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'CTA.png', function(img){ if(img && !S.assets.ctaGo) S.assets.ctaGo = img; if(cb) cb(); });
}
/* Game BN專屬CTA圓形按鈕，跟ctaDD/ctaGo同一套「有預設檔就套用、找不到
   對應layer就靜靜不畫」邏輯。參考檔原本依bau/flash主題切換兩張不同圖，
   這個專案還沒有主題切換的狀態欄位，先固定套用一張，之後要做主題切換
   再擴充。 */
function loadDefaultCTA_Game(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'GameCTA.png', function(img){ if(img && !S.assets.ctaGame) S.assets.ctaGame = img; if(cb) cb(); });
}

/* Skinny BN專屬圓形CTA icon，跟ctaDD/ctaGo/ctaGame同一套「有預設檔就套用、
   找不到對應layer就靜靜不畫」邏輯。素材檔名SkbnCta.png，跟其他自動套用的
   CTA同一套命名風格(DD.png/CTA.png/GameCTA.png)——PSD匯出原本建議的檔名
   是'skbn_cta.png'，這裡改成跟專案裡其他CTA一致的命名，使用者放檔案時
   請用SkbnCta.png這個檔名，不是PSD原本建議的那個。APP版跟PC版共用同一份
   素材(見configs/layouts/skinny_app-positions.json／skinny_pc-positions.json
   裡ctaSkbn的說明)，不用分開準備兩份。 */
function loadDefaultCTA_Skbn(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'SkbnCta.png', function(img){ if(img && !S.assets.ctaSkbn) S.assets.ctaSkbn = img; if(cb) cb(); });
}

/* KV(03_c2c_bn)上固定的兩個錢幣裝飾圖案，跟ctaDD/mePageIcon同一套「有
   預設檔就套用、找不到就靜靜不畫」邏輯——兩個是不同的圖案(coin1≠coin2)，
   使用者確認不管A版/B版都用同一張，不用準備兩份，素材請放logos/Coin1.png
   /logos/Coin2.png(不放進A/B子資料夾也沒關係，_loadVersionedDefaultImage
   本來就會在版本專屬檔案找不到時自動退回這個共用路徑)。 */
function loadDefaultCoin1(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'Coin1.png', function(img){ if(img && !S.assets.coin1) S.assets.coin1 = img; if(cb) cb(); });
}
function loadDefaultCoin2(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'Coin2.png', function(img){ if(img && !S.assets.coin2) S.assets.coin2 = img; if(cb) cb(); });
}

/* Me Page Circle／Me Page Circle_new用的固定icon，跟ctaDD/ctaGo/ctaGame/
   ctaSkbn同一套「有預設檔就套用、找不到對應layer就靜靜不畫」邏輯。兩個
   版位共用同一份icon素材(mePageIcon)，位置/大小各自在自己的positions檔
   獨立設定，不用準備兩份圖檔。素材請放logos/A(或B)/MePageIcon.png。 */
function loadDefaultMePageIcon(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'MePageIcon.png', function(img){ if(img && !S.assets.mePageIcon) S.assets.mePageIcon = img; if(cb) cb(); });
}
/* Me Page Circle(非new版)專屬、選填的整張背景圖——跟mePageCircleNewBg
   是同一套機制，有放檔案(logos/A或B/MePageCircleBg.png)才會套用，沒放
   就維持透明，不會有純色退路。 */
function loadDefaultMePageCircleBg(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'MePageCircleBg.png', function(img){ if(img && !S.assets.mePageCircleBg) S.assets.mePageCircleBg = img; if(cb) cb(); });
}
/* Me Page Circle_new專屬、選填的整張背景圖——有放檔案(logos/A或B/
   MePageCircleNewBg.png)才會套用，沒放就維持透明，不會有純色退路。 */
function loadDefaultMePageCircleNewBg(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'MePageCircleNewBg.png', function(img){ if(img && !S.assets.mePageCircleNewBg) S.assets.mePageCircleNewBg = img; if(cb) cb(); });
}
/* Me Page Circle_new專屬、選填的「NEW」紅色徽章——有放檔案(logos/A或B/
   MePageNewBadge.png)才會套用，沒放就靜靜跳過。 */
function loadDefaultMePageNewBadge(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'MePageNewBadge.png', function(img){ if(img && !S.assets.mePageNewBadge) S.assets.mePageNewBadge = img; if(cb) cb(); });
}

/* 固定預設素材一起套用（沒有對應檔案就靜靜跳過），每次分頁切換/建立/載入完
   都要重新跑一次——因為S.assets在applyTabData()裡會被整個換掉，這個分頁自己
   沒有logo1/logo2/ctaDD/ctaGo/ctaGame的話，才會補上預設值 */
function applyDefaultLogos(cb){
  loadDefaultLogo1(function(){ loadDefaultLogo2(function(){ loadDefaultCTA_DD(function(){ loadDefaultCTA_Go(function(){ loadDefaultCTA_Game(function(){ loadDefaultCTA_Skbn(function(){ loadDefaultCoin1(function(){ loadDefaultCoin2(function(){ loadDefaultMePageIcon(function(){ loadDefaultMePageCircleBg(function(){ loadDefaultMePageCircleNewBg(function(){ loadDefaultMePageNewBadge(cb); }); }); }); }); }); }); }); }); }); }); });
}

/* 版本(A/B)切換時，CTA badge是唯一需要「強制換圖」的自動預設素材——logo1
   是品牌LOGO跟版本無關不用換，logo2是使用者自己上傳的不能動；ctaDD/
   ctaGo/ctaGame三個一律是程式自動套的固定素材、從來不開放使用者上傳
   （見isEmptyDefaultTabData()的排除清單），所以這裡可以直接覆蓋，不用
   擔心蓋掉使用者的東西。跟applyDefaultLogos()的差異只在於：這裡不檢查
   `!S.assets.xxx`，一律強制重新載入目前版本對應的檔案。 */
function reloadVersionedCTA(cb){
  var version = (S.templateVersion === 'B') ? 'B' : 'A';
  _loadVersionedDefaultImage(version, 'DD.png', function(img){
    S.assets.ctaDD = img;
    _loadVersionedDefaultImage(version, 'CTA.png', function(img2){
      S.assets.ctaGo = img2;
      _loadVersionedDefaultImage(version, 'GameCTA.png', function(img3){
        S.assets.ctaGame = img3;
        _loadVersionedDefaultImage(version, 'SkbnCta.png', function(img4){
          S.assets.ctaSkbn = img4;
          _loadVersionedDefaultImage(version, 'Coin1.png', function(imgc1){
            S.assets.coin1 = imgc1;
            _loadVersionedDefaultImage(version, 'Coin2.png', function(imgc2){
              S.assets.coin2 = imgc2;
              _loadVersionedDefaultImage(version, 'MePageIcon.png', function(img5){
                S.assets.mePageIcon = img5;
                _loadVersionedDefaultImage(version, 'MePageCircleBg.png', function(img5b){
                  S.assets.mePageCircleBg = img5b;
                  _loadVersionedDefaultImage(version, 'MePageCircleNewBg.png', function(img6){
                    S.assets.mePageCircleNewBg = img6;
                    _loadVersionedDefaultImage(version, 'MePageNewBadge.png', function(img7){
                      S.assets.mePageNewBadge = img7;
                      if(cb) cb();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

/* 右側面板最上方的「公版版本」下拉選單——跟bindArControls()同一套精神：
   只是換S.templateVersion+同步configs/theme.json的對應顏色組+強制換CTA
   badge，然後重畫；不影響文案/曝品/logo2這些跟版本無關的內容。每次切換
   分頁(applyTabData)都要重新呼叫一次，同步下拉選單目前顯示的值跟這個
   分頁實際存的版本一致。 */
function bindVersionToggle(){
  var sel = document.getElementById('template-version-sel');
  if(!sel) return;

  sel.value = (S.templateVersion === 'B') ? 'B' : 'A';

  sel.onchange = function(){
    var v = (sel.value === 'B') ? 'B' : 'A';
    if(S.templateVersion === v) return;
    S.templateVersion = v;
    if(typeof setTemplateVersion === 'function') setTemplateVersion(v);
    reloadVersionedCTA(renderAll);
    /* 商品陰影合成彈窗(js/shadow-system/shadow-popup.js)如果剛好開著，
       它的1200×1200背景圖也是版本化的(見該檔drawShadowCanvas())，這裡
       主動呼叫一次讓它立刻換圖，不用等使用者手動關掉再重開才生效；彈窗
       沒開的話drawShadowCanvas()內部會直接return，呼叫這裡不會出錯。 */
    if(typeof drawShadowCanvas === 'function') drawShadowCanvas();
  };
}

/* AR版位素材／文案自動套用：跟logo1同一套精神——資料夾比對到、或Excel帶了
   AR文案文字，就直接套用，不需要再跳一個確認popup（AR只是一個100x100的
   小方塊，不需要像人物/商品那樣調整位置/縮放）。
   優先順序：Excel「AR版本」儲存格(HI21/HI22，見editor-import.js的
   parseARCell())如果有明確指定版本，最優先、直接照它指定的版本+文字套用；
   沒有明確指定的話才退回舊邏輯：有AR文案文字→文字版本；資料夾比對到
   賣家LOGO→賣家版本；比對到活動LOGO→活動版本；都沒有就維持原本的
   S.arVariant不動（例如上一個分頁手動選好的）。 */
/* AR版位素材／文案自動套用：AR的activity/seller版本直接沿用LOGO1/LOGO2
   本身（見modules/ar-module.js），不需要另外比對/上傳專屬素材，這裡只
   需要處理Excel「AR內容」欄位指定的版本+文案（見editor-import.js的
   parseARCell()）。 */
function applyArFromImport(matched, parsedText, arInfo){
  /* AR只有一個版位(一個分頁只會有一個'ar' canvas)，寫進它對應的那組文案就好
     （通常就是'文案1'，除非之後有需要把AR也拆進特定組）。 */
  var arGroup = S.textGroups[groupKeyForLayout('ar')] || activeText();
  if(arInfo && arInfo.variant){
    S.arVariant = arInfo.variant;
    if(arInfo.variant === 'text' && arInfo.text){
      arGroup['AR文案'] = arInfo.text;
    }
  } else {
    var arText = parsedText && parsedText['AR文案'];
    if(arText){
      arGroup['AR文案'] = arText;
      S.arVariant = 'text';
    }
  }
  refreshRightPanel();
  renderAll();
}

/* 曝品樣式(商品/券樣)下拉選單——跟bindVersionToggle()同一套精神：只換
   S.exposureStyle，重畫一次；不影響文案/LOGO2/商品這些跟樣式無關的內容。
   每次切換分頁(applyTabData)都要重新呼叫一次，同步下拉選單目前顯示的值
   跟這個分頁實際存的樣式一致。 */
function bindExposureStyleToggle(){
  var sel = document.getElementById('exposure-style-sel');
  if(!sel) return;

  sel.value = (S.exposureStyle === 'coupon') ? 'coupon' : 'product';

  sel.onchange = function(){
    var v = (sel.value === 'coupon') ? 'coupon' : 'product';
    if(S.exposureStyle === v) return;
    S.exposureStyle = v;
    updateCouponEditButtonVisibility();
    updateProductSectionVisibility();
    updateTicket1FieldVisibility();
    renderAll();
  };
}

function refreshRightPanel(){
  bindTextInputs();
  bindArControls();
  bindVersionToggle();
  bindExposureStyleToggle();
  updateSkbnTextFieldVisibility();
  updateCouponEditButtonVisibility();
  updateProductSectionVisibility();
  updateTicket1FieldVisibility();
  updateProductEditButtonTarget();
  updateLogo2FieldVisibility();
  updateActiveItemPanel();
}

/* 「SKBN案型」輸入框只在這個分頁有Skinny BN APP/PC版位時才顯示——跟
   updateArPanelVisibility()同一種判斷方式，只是改查window.SKBN_INSTANCE_META
   (js/editor-state.js)裡登記的6個實例id，只要S.activeLayoutIds裡有任何
   一個命中就顯示。輸入框本身的讀寫已經透過bindTextInputs()的TEXT_FIELD_KEYS
   通用邏輯處理，這裡只負責要不要顯示這個欄位。 */
function updateSkbnTextFieldVisibility(){
  var el = document.getElementById('skbn-text-field');
  if(!el) return;
  var metaIds = window.SKBN_INSTANCE_META ? Object.keys(window.SKBN_INSTANCE_META) : [];
  var hasSkbn = !!(S.activeLayoutIds && metaIds.some(function(id){ return S.activeLayoutIds.indexOf(id) >= 0; }));
  el.style.display = hasSkbn ? '' : 'none';
}

/* 08_popup(Popup)版位A版券樣模式專屬——只有這個分頁有勾08_popup、且
   目前是券樣模式(exposureStyle==='coupon')才顯示這個文案欄位，跟SKBN
   案型同一種「用不到就不要佔位置」的做法。B版通常不會用到券樣模式(沒有
   對應的_coupon背景檔，見modules/background-module.js)，但這裡的判斷
   純粹看exposureStyle，不特別排除B版——如果B版哪天也真的需要券樣模式，
   這個欄位一樣會正確顯示，不用改程式。 */
function updateTicket1FieldVisibility(){
  var el = document.getElementById('ticket1-text-field');
  if(!el) return;
  var hasPopup = !!(S.activeLayoutIds && S.activeLayoutIds.indexOf('08_popup') >= 0);
  el.style.display = (hasPopup && S.exposureStyle === 'coupon') ? '' : 'none';
}

/* 2026-09移除：券1金額/券2金額的右側面板輸入框——這兩個值現在只能在
   「編輯券」1200畫布popup裡編輯(見js/shadow-system/coupon-popup.js的
   openCouponPopup())，右側面板改的話不會有任何畫面變化(HBN畫布顯示的是
   popup按「確認並套用」時烤出來的靜態合成圖，不是即時讀S.textGroups
   畫出來的)，留著這個輸入框只會讓使用者誤以為改這裡就會生效，所以直接
   拿掉，不再另外維護一份「看起來能編輯、其實不會生效」的欄位。原本的
   updateCouponTextFieldVisibility()函式(連同它顯示/隱藏的div#coupon-
   text-field)也一併從editor.html移除，見那邊的說明。 */

/* 「編輯券」按鈕(開js/shadow-system/coupon-popup.js的1200畫布)同樣只有
   曝品樣式='coupon'才顯示，跟上面的文案欄位同一個判斷條件、同時切換。 */
/* 2026-09新增：「目前這個作用中項目」實際的曝品模式是什麼——外廣
   multiInstance(例如04_Facebook)每個實例各自獨立(見
   S.instanceExposureStyle)，一般分頁(含外廣非multiInstance)才是整頁
   共用S.exposureStyle。這支函式統一查詢入口，商品/券兩個編輯區塊的
   顯示判斷都改用這支，不要再各自只查S.exposureStyle(那樣對
   multiInstance分頁一律查到假的tab層級預設值，導致券樣的實例永遠不會
   顯示「編輯券」區塊，這正是使用者實際回報的症狀)。 */
function _effectiveExposureStyleForActiveGroup(){
  var key = S.activeTextGroup;
  return (S.instanceExposureStyle && S.instanceExposureStyle[key]) || S.exposureStyle;
}

function updateCouponEditButtonVisibility(){
  var show = (_effectiveExposureStyleForActiveGroup() === 'coupon');
  var title = document.getElementById('coupon-section-title');
  var field = document.getElementById('coupon-edit-section');
  if(title) title.style.display = show ? '' : 'none';
  if(field) field.style.display = show ? '' : 'none';
}

/* 商品編輯區塊(含「編輯商品」按鈕)的顯示/隱藏——跟上面的券樣區塊是
   互斥的一體兩面：目前作用中的項目是商品模式才顯示，是券樣模式就隱藏，
   不會兩個同時出現(使用者反映過同時看到兩個按鈕會搞不清楚要點哪個)。 */
function updateProductSectionVisibility(){
  var show = (_effectiveExposureStyleForActiveGroup() === 'product');
  var wrap = document.getElementById('product-edit-wrap');
  if(wrap) wrap.style.display = show ? '' : 'none';
}

/* AR版位（100x100，三選一版本）的右側控制面板：
   - 切換版本：只是換S.arVariant，不影響已經上傳的LOGO/文案，切回去還在
   - 上傳活動LOGO／賣家LOGO：讀成Image塞進對應的S.assets key
   - 文案：跟其他文字欄位一樣透過bindTextInputs()的通用邏輯處理（見那邊
     forEach陣列已經加了'AR文案'），這裡不用重複綁 */
/* AR版位（100x100，三選一版本）的右側控制面板：
   - 切換版本：只是換S.arVariant，不影響已經上傳的LOGO/文案，切回去還在
   - 活動LOGO/店家LOGO：直接沿用LOGO1/LOGO2本身，不需要另外上傳
     （見modules/ar-module.js），這裡只需要切換版本、不用管上傳
   - 文案：跟其他文字欄位一樣透過bindTextInputs()的通用邏輯處理（見那邊
     forEach陣列已經加了'AR文案'），這裡不用重複綁 */

/* 這份工單有沒有勾AR（S.activeLayoutIds裡有沒有'ar'）——沒有的話，右側整個
   「AR（100×100）」區塊（版本選單/文案輸入框）都不需要顯示，使用者反映
   用不到AR的工單，這個區塊留著只是佔位置、容易讓人誤會還要填。1200畫布
   本身（buildCanvasArea()用activeLayouts()決定要蓋哪些canvas-block）已經
   會自動不畫AR，這裡只是讓右側控制面板也跟著一致，兩處都用同一份
   S.activeLayoutIds判斷，不用另外維護一個開關。 */
function updateArPanelVisibility(){
  var el = document.getElementById('ar-panel-section');
  if(!el) return;
  var hasAr = S.activeLayoutIds && S.activeLayoutIds.indexOf('ar') >= 0;
  el.style.display = hasAr ? '' : 'none';
}

function bindArControls(){
  updateArPanelVisibility();
  var sel = document.getElementById('ar-variant-sel');
  if(!sel) return; // editor.html還沒建置完成時的保險
  sel.value = S.arVariant || 'activity';

  function syncVisibility(){
    var v = sel.value;
    document.getElementById('ar-activity-field').style.display = (v==='activity') ? '' : 'none';
    document.getElementById('ar-seller-field').style.display = (v==='seller') ? '' : 'none';
    document.getElementById('ar-text-field').style.display = (v==='text') ? '' : 'none';
  }
  syncVisibility();

  sel.onchange = function(){
    S.arVariant = sel.value;
    syncVisibility();
    renderAll();
  };
}

/* ══════════════════ 分頁（TABS）══════════════════ */

function renderTabBar(){
  var nav = document.getElementById('tab-bar');
  /* 還沒真正匯入過任何工單（只有內部占位用的空白分頁）時，不畫出那顆
     看起來像分頁、其實完全沒內容的按鈕——使用者反映「一開始還沒上傳就
     看到一個多餘分頁」，這裡改成只顯示提示文字+「+」，等真的匯入完成
     （addTabFromImport把這個空白分頁換掉）才會顯示正常的分頁按鈕。 */
  var onlyTrivial = TABS.length === 1 && isEmptyDefaultTabData(TABS[0].data);
  if(onlyTrivial){
    nav.innerHTML = '<span class="hint" style="padding:0 10px;">尚未匯入工單</span>'+
      '<button class="tab-add" onclick="openImportModal()" title="匯入工單建立新分頁">+</button>';
    return;
  }
  nav.innerHTML = TABS.map(function(tab, i){
    /* 頁籤上顯示的文字：優先用exposureLabel（例如'曝光日期1'）這種簡短版，
       不要整串「工作項目名稱／曝光日期1」都塞進頁籤，頁籤空間小、多分頁
       並排時容易擠爆。完整名稱(tab.data.label)還是保留著，給整包下載的
       zip檔名用（見js/editor-export.js的downloadAll()），只是不顯示在
       頁籤上而已。沒有exposureLabel的分頁（手動建立的空白分頁、或沒有
       曝光日期區塊概念的舊格式工單）維持顯示完整標籤，不受影響。 */
    var tabText = tab.data.exposureLabel || tab.data.label;
    return '<button class="tab-btn'+(i===ACTIVE_TAB?' active':'')+'" onclick="switchTab('+i+')" title="'+esc(tab.data.label)+'">'+
      esc(tabText)+
      (TABS.length>1 ? '<span class="tab-close" onclick="event.stopPropagation();closeTab('+i+')">×</span>' : '')+
    '</button>';
  }).join('') + '<button class="tab-add" onclick="openImportModal()" title="匯入工單建立新分頁">+</button>';
}

function esc(s){ return String(s||'').replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }

function switchTab(i){
  if(i === ACTIVE_TAB) return;
  saveCurrentTabIntoData();
  ACTIVE_TAB = i;
  renderTabBar();
  applyTabData(i, function(){
    refreshRightPanel();
    buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
  });
}

function closeTab(i){
  if(TABS.length<=1) return;
  /* 2026-08新增：刪除分頁前先跳出確認對話框——分頁一旦刪掉，裡面的文案/
     商品/LOGO都會直接消失、沒有復原機制(不像關掉調整位置popup那種可以
     取消)，容易手滑點到叉叉就整頁不見，所以在真的splice()之前擋一下。
     訊息裡帶分頁的完整名稱(tab.data.label，跟zip下載檔名用的同一個
     欄位)，讓使用者確認的當下看得出來是要刪哪一頁，不是只看到一個
     空泛的「確定刪除嗎」。使用者按取消(confirm回傳false)就直接return，
     完全不動TABS、不用做任何復原處理。 */
  var tabLabel = (TABS[i] && TABS[i].data && (TABS[i].data.exposureLabel || TABS[i].data.label)) || ('分頁'+(i+1));
  if(!window.confirm('確定要刪除「'+tabLabel+'」這個分頁嗎？裡面的文案/商品/LOGO都會一併刪除，無法復原。')) return;

  TABS.splice(i,1);
  if(ACTIVE_TAB >= TABS.length) ACTIVE_TAB = TABS.length-1;
  renderTabBar();
  applyTabData(ACTIVE_TAB, function(){
    refreshRightPanel();
    buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
  });
}

/* 判斷一個分頁資料是不是「完全空白、使用者還沒動過」的預設分頁——開啟編輯器時
   一開始就會有一個「未命名工單1」佔位分頁，同時又會自動跳出匯入工單popup
   （見DOMContentLoaded），使用者匯入的話，這個判斷用來決定「取代」這個空白佔位
   分頁，而不是在它旁邊「多新增」一個分頁，不然每次開啟編輯器匯入一次工單，
   就會看到2個分頁（1個沒用到的空白預設分頁+1個剛匯入的），造成使用者誤以為
   「工單匯入自己複製出兩個分頁」的錯覺——實際上不是Excel有兩個頁籤(sheet)的
   問題，是編輯器初始化流程自己先塞了一個佔位分頁進去。 */
function isEmptyDefaultTabData(d){
  if(!d) return false;
  var groups = d.textGroups ? Object.keys(d.textGroups) : (d.text ? ['__legacy__'] : []);
  var textEmpty = groups.every(function(gk){
    var g = d.textGroups ? d.textGroups[gk] : d.text;
    return TEXT_FIELD_KEYS.every(function(k){ return !g || !g[k]; });
  });
  /* logo1／cta都有固定預設值（logo1是蝦皮直播brand、cta是DD.png固定badge），
     每個空白分頁一打開就會自動帶入（見loadDefaultLogo1()／loadDefaultCTA()），
     光是這兩個key有值不能代表「使用者真的做過事」，排除掉不列入這裡的判斷——
     這是上次修「匯入變2個分頁」時漏掉的地方：addTabFromImport()一開頭會呼叫
     saveCurrentTabIntoData()，把當下已經載入了logo1/cta預設值的S存回
     TABS[0].data，這裡如果沒排除，assetsEmpty永遠會被logo1/cta判定成false，
     canReplaceDefault永遠是false，於是還是會「新增」一個分頁而不是「取代」
     空白分頁，兩個分頁的問題會用不同原因重現。 */
  var assetsEmpty = !d.assets || Object.keys(d.assets).every(function(k){ return k === 'logo1' || k === 'ctaDD' || k === 'ctaGo' || k === 'ctaGame' || k === 'ctaSkbn' || k === 'coin1' || k === 'coin2' || k === 'mePageIcon' || k === 'mePageCircleBg' || k === 'mePageCircleNewBg' || k === 'mePageNewBadge' || !d.assets[k]; });
  var shadowEmpty = !d.shadowSlots || Object.keys(d.shadowSlots).length === 0;
  var overridesEmpty = !d.positionOverrides || Object.keys(d.positionOverrides).length === 0;
  return textEmpty && assetsEmpty && shadowEmpty && overridesEmpty;
}

/* 把parseRows()解析出來的一個區塊(parsed)轉成一份完整的tab.data——
   textGroups依原樣正規化文字(補千分位逗號、日期補0之類)搬進去，
   layoutTextGroup依materialItems的分組標籤比對版位。 */
function buildTabDataFromParsedBlock(parsed){
  var data = newEmptyTabData(parsed.orderName);
  data.exposureLabel = parsed.exposureLabel || null;
  data.templateVersion = (parsed.templateVersion === 'B') ? 'B' : 'A'; // 工單有明確指定才會是'B'，沒指定一律預設'A'，使用者仍可在畫面上用topbar按鈕再調整
  data.exposureStyle = (parsed.exposureStyle === 'coupon') ? 'coupon' : 'product'; // 同上，工單有指定才會是'coupon'
  /* 版位清單優先用「站內BN」那份A欄+K數判斷出來的結果(parsed.
     activeLayoutIdsFromBannerList)——這是蝦皮超划算工單真正在用的格式，
     比舊的「製作素材」清單準。只有在這份工單完全沒有這種清單格式時
     (activeLayoutIdsFromBannerList===null，例如舊格式工單)，才退回
     filterLayoutsByMaterials()備援。 */
  data.activeLayoutIds = parsed.activeLayoutIdsFromBannerList !== null
    ? parsed.activeLayoutIdsFromBannerList.filter(function(id){ return LAYOUT_REGISTRY.some(function(l){ return l.id === id; }); })
    : filterLayoutsByMaterials(parsed.materials);

  /* 2026-09新增：券樣模式下SKBN只需要輸出2張(skinny_app、skinny_pc各1張，
     都是廣播同一張券卡)，不需要__2/__3這兩個重複實例——商品模式才需要
     3品各自獨立輸出，券樣模式沒有「3品」這個概念，工單A欄不管列幾行
     「Skinny BN APP/PC」，關鍵字比對邏輯本來就會把skinny_app__2/__3也
     一起命中(3個實例共用同一組關鍵字，見editor-import.js的
     LAYOUT_MATERIAL_KEYWORDS說明)，這裡直接在券樣模式下把這兩個多餘的
     實例過濾掉，維持商品模式的行為完全不變。 */
  if(data.exposureStyle === 'coupon'){
    data.activeLayoutIds = data.activeLayoutIds.filter(function(id){
      return id !== 'skinny_app__2' && id !== 'skinny_app__3' && id !== 'skinny_pc__2' && id !== 'skinny_pc__3';
    });
  }

  /* DD Card有LOGO/無LOGO二選一——parsed.ddcardNoLogo是true/false時(找到
     DD Banner Card那一列)，只保留對應的那個版位，避免兩個同時出現在
     分頁列表造成困惑；找不到那一列(null)就兩個都留著，讓使用者自己用
     「追加版位」勾選。 */
  if(parsed.ddcardNoLogo === true){
    data.activeLayoutIds = data.activeLayoutIds.filter(function(id){ return id !== '05_ddcard'; });
  } else if(parsed.ddcardNoLogo === false){
    data.activeLayoutIds = data.activeLayoutIds.filter(function(id){ return id !== '05_ddcard_nologo'; });
  }
  var built = buildLayoutInstancesFromMaterials(parsed.materialItems, data.activeLayoutIds);
  data.instances = built.instances;
  data.materialOrder = data.instances.map(function(inst){ return inst.instanceId; }); // 純粹相容欄位，實際排序看instances
  data.layoutTextGroup = {};
  data.instances.forEach(function(inst){ data.layoutTextGroup[inst.instanceId] = inst.textGroup || '文案1'; });

  data.textGroups = {};
  Object.keys(parsed.textGroups || {}).forEach(function(groupKey){
    var src = parsed.textGroups[groupKey] || {};
    var out = emptyTextGroup();
    TEXT_FIELD_KEYS.forEach(function(k){
      if(!src[k]) return;
      /* ★第1張(後)/第2張(前)故意不呼叫normalizeTextValue()——那支函式會
         直接把逗號烤進儲存值本身(例如"$1500"變成"$1,500")，但券樣
         popup(js/shadow-system/coupon-popup.js)的千分位是「畫的時候」
         才動態加，內部切字邏輯認的是純數字(\d+)，如果儲存值本身已經先
         被塞了逗號，會在第一個逗號就把數字切斷、只有前面幾位數字會被
         當成大字，後面帶著逗號的部分反而被當成小字的suffix，畫面會變得
         亂七八糟。這兩個欄位維持原始值(不補千分位)存進去，畫布上的千分位
         完全交給coupon-popup.js自己處理，兩套機制不要互相打架。 */
      out[k] = (k === '第1張(後)' || k === '第2張(前)') ? src[k] : normalizeTextValue(k, src[k]);
    });
    data.textGroups[groupKey] = out;
  });
  if(!Object.keys(data.textGroups).length) data.textGroups = { '文案1': emptyTextGroup() };
  data.activeTextGroup = Object.keys(data.textGroups)[0];

  /* 2026-09新增：曝品表(parsed.exposure.items)裡的原價/標價/比例，不管
     這次匯入有沒有附商品照片資料夾、有沒有比對到檔案，都先帶進
     data.priceTags／data.shadowSlots——使用者之後就算是「先只匯入Excel、
     晚點才手動上傳照片」，小標文字跟商品比例(大/中/小)也已經是對的，
     不用等到照片比對成功那一刻才補進去。
     （真的有比對到照片檔案時，js/editor-popups.js的proceedToShadowFromImport
     還是會再走一次自己的ratio套用流程，兩邊沒有衝突：shadowSlots這裡只
     先寫ratio，沒有dataUrl；等真正比對到/使用者上傳照片時，
     applyShadowSlotDataUrl()裡的prevRatio邏輯會自動接手這個值，不會被
     覆蓋掉，見該函式的說明。） */
  data.priceTags = {};
  data.shadowSlots = {};
  var exposureItems = (parsed.exposure && parsed.exposure.items) || [];
  exposureItems.forEach(function(item){
    if(item.slot.indexOf('商品') !== 0) return; // 只有商品槽位需要小標，人物不需要
    if(typeof item.ratio === 'number') data.shadowSlots[item.slot] = { ratio: item.ratio };
    if(item.originalPrice || item.salePrice){
      data.priceTags[item.slot] = {
        on: true,
        offsetXPct: 1.05,
        offsetYPct: 0.15,
        orientation: 'left',
        originalPrice: item.originalPrice || '',
        salePrice: item.salePrice || ''
      };
    }
  });

  /* 2026-09新增：SKBN(skinny_app/__2/__3、skinny_pc/__2/__3)單品popup的
     小標，跟上面KV那份是完全獨立的兩份資料(見js/shadow-system/
     skbn-shadow-popup.js檔頭說明)，所以曝品表的原價/標價要「再帶一次」
     進data.skbnProductSlots，不會因為上面已經寫進data.priceTags就自動
     同步過來。
     2026-09第八版：依「商品」(不是依實例)建這份資料——同一個商品的
     APP版跟PC版共用同一個陰影popup、同一份設定(商品照片/陰影角度/位置
     /縮放/旋轉/小標)，使用者只要調一次(3個商品)，不用6個實例各調一次。
     只有「小標大小」「PC小標獨立位置」這兩個依實例分開存，見
     data.skbnSlots。 */
  data.skbnProductSlots = {};
  ['商品1(左)','商品2(中)','商品3(右)'].forEach(function(product){
    var item = exposureItems.filter(function(it){ return it.slot === product; })[0];
    data.skbnProductSlots[product] = {
      dataUrl: null,
      shadowAngle: 'left',
      transform: null, // popup內部(固定1200x1200正方形工作畫布)的商品位置/縮放/旋轉，APP/PC共用同一份
      /* offsetXPct/offsetYPct：小標預設定位在商品右下角(相對商品有色範圍
         的比例，0.9/0.88大約落在右下角附近，實際上使用者都可以在畫布上
         直接拖曳微調)。scaleMul(大小)不放在這裡——大小要依「實例」分開
         存(APP/PC各自獨立)，見data.skbnSlots跟js/editor-main.js的
         getSkbnTagBox()。 */
      priceTag: {
        on: !!(item && (item.originalPrice || item.salePrice)),
        offsetXPct: 0.9,
        offsetYPct: 0.88,
        orientation: 'left',
        originalPrice: (item && item.originalPrice) || '',
        salePrice: (item && item.salePrice) || ''
      }
    };
  });
  data.skbnSlots = {};
  Object.keys(window.SKBN_INSTANCE_META || {}).forEach(function(instanceId){
    data.skbnSlots[instanceId] = { tagScaleMul: 1 }; // tagPosOverride留空，PC小標被使用者拖過才會出現
  });

  return data;
}

/* 一個區塊(parsed，來自editor-import.js的parseRows())建立/取代一頁分頁——
   一次Excel匯入如果有多個「曝光日期」區塊，呼叫端(js/editor-popups.js的
   runImport())會依序對每個區塊各呼叫一次這支函式，一個一個把分頁開出來
   （不是一次全開完，因為每個分頁後面接著要跳LOGO2/商品陰影確認popup，
   這些popup要使用者一個一個確認，不能同時對好幾個分頁操作）。 */
function addTabFromImport(parsed){
  var data = buildTabDataFromParsedBlock(parsed);
  saveCurrentTabIntoData();

  var canReplaceDefault = TABS.length === 1 && isEmptyDefaultTabData(TABS[0].data);
  if(canReplaceDefault){
    TABS[0] = { data: data };
    ACTIVE_TAB = 0;
  } else {
    TABS.push({ data: data });
    ACTIVE_TAB = TABS.length-1;
  }
  renderTabBar();
  applyTabData(ACTIVE_TAB, function(){
    refreshRightPanel();
    buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
  });
}

/* ══════════════════ Topbar 按鈕 ══════════════════ */

/* 把資料夾比對popup確認後的 {slotId: File} 實際載入成圖片、寫進 S.assets */
function applyMatchedAssets(matched){
  var keys = Object.keys(matched);
  var pending = keys.length;
  if(!pending) return;
  keys.forEach(function(slotId){
    loadAssetFile(slotId, matched[slotId], function(){
      pending--;
      if(pending<=0) renderAll();
    });
  });
}

function bindSaveTemp(){
  document.getElementById('btn-save-temp').onclick = function(){
    saveCurrentTabIntoData();
    var payload = { version:1, tabs: TABS.map(function(t){ return t.data; }), activeTab: ACTIVE_TAB };
    var blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    triggerDownload(blob, 'circle_暫存_'+Date.now()+'.json');
  };
}

function bindLoadTemp(){
  var input = document.getElementById('load-temp');
  document.getElementById('btn-load-temp').onclick = function(){ input.click(); };
  input.onchange = function(){
    var file = input.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try{
        var payload = JSON.parse(ev.target.result);
        TABS = payload.tabs.map(function(d){ return { data:d }; });
        ACTIVE_TAB = payload.activeTab || 0;
        renderTabBar();
        applyTabData(ACTIVE_TAB, function(){
          refreshRightPanel();
          buildCanvasArea().then(function(){ applyDefaultLogos(renderAll); });
        });
      }catch(e){
        alert('暫存檔讀取失敗：'+e.message);
      }
    };
    reader.readAsText(file);
    input.value = '';
  };
}

function bindDownloadAll(){
  document.getElementById('btn-download-all').onclick = downloadAll;
}

/* 側欄「＋ 追加版位」按鈕：開啟手動勾選版位的popup（見editor-popups.js的
   openLayoutTogglePopup()）。 */
function bindAddLayoutButton(){
  var btn = document.getElementById('btn-add-layout');
  if(!btn) return;
  btn.onclick = openLayoutTogglePopup;
}

/* ══════════════════ 初始化 ══════════════════ */

/* 「重設」按鈕：現在跟直接重新整理效果一樣（見下面DOMContentLoaded，
   重新整理本身就會清空重來），保留這顆按鈕只是給使用者一個不用重新整理
   也能達到同樣效果的明確動作，內部就是清一次localStorage殘留資料+重新整理。 */
function bindResetAll(){
  var btn = document.getElementById('btn-reset-all');
  if(!btn) return;
  btn.onclick = function(){
    if(!confirm('確定要清空目前所有分頁，重新開始嗎？這個動作無法復原。')) return;
    try{ localStorage.removeItem(AUTOSAVE_KEY); }catch(e){}
    location.reload();
  };
}

window.addEventListener('DOMContentLoaded', function(){
  /* ★ 使用者明確要求：重新整理＝整個刷掉重來，不要接續上次的內容。
     原本這裡會先讀localStorage自動記住的內容、有的話就還原（方便瀏覽器
     不小心關掉/當機時不會整份工單都不見）；現在改成完全不讀，每次重新整理
     一律當作全新使用者：一個空白分頁 + 自動跳出匯入工單popup，之前分頁裡
     的內容一律清除。想保留工作內容的話，還是可以用「儲存暫存」下載一份
     .json，之後用「載入暫存」讀回來，這個手動存讀檔的功能不受影響。 */
  try{ localStorage.removeItem(AUTOSAVE_KEY); }catch(e){}
  TABS = [{ data: newEmptyTabData('未命名工單1') }];
  ACTIVE_TAB = 0;

  bindSaveTemp();
  bindLoadTemp();
  bindDownloadAll();
  bindResetAll();
  bindAddLayoutButton();

  /* 等自訂字型真的載入完成再畫第一次，不然canvas文字會先用系統字體畫一次、
     字型載好後也不會自動重畫，畫面會卡在錯的字體上（canvas文字不像DOM文字
     會自動follow字型載入完成事件）。跟你參考檔(11/12/05這幾個html)結尾那段
     document.fonts.load()的作法一樣。 */
  Promise.all([
    document.fonts.load('700 16px ShopeeNoto'),
    document.fonts.load('500 16px ShopeeNoto'),
    document.fonts.load('400 16px ShopeeNoto')
  ]).catch(function(e){ console.warn('[fonts] 字型載入失敗，會用預設字體代替：', e); })
  .then(function(){
    loadTheme(function(){
      applyTabData(ACTIVE_TAB, function(){
        refreshRightPanel();
        renderTabBar();
        buildCanvasArea();
        applyDefaultLogos(renderAll);
        openImportModal(); // 站內/站外現在是這個popup裡的頁籤，見js/editor-popups.js
      });
    });
  });
});
