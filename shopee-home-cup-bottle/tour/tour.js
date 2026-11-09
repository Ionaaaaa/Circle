'use strict';
/*
  tour/tour.js：新手導覽（沒有 LOGO 示範的版本）
  ------------------------------------------------------------
  引擎是 tour/tour-guide.js，這支只放步驟、文案和範例流程，不改工具原本的程式。
  範例工單和素材在 tour/tour-sample-data.js，開始導覽才載入。

  文案和步驟都在下面的 STEPS，改完把版本號改掉即可。
  想讓大家再看一次：把 TOUR_KEY 的 v1 改成 v2。
  測試：網址加 ?tour 會強制再跑一次。

  規則：
  - 有動畫的步驟，動畫演完才出現「上一步／下一步」。
  - 動畫裡的確認鍵只有按下去的效果，畫面停在原視窗；
    真的確認放在「下一步」，等待時按鈕顯示「處理中…」。
  - do 開頭的函式都可以重複呼叫。
*/
(function(){

  /* 每個專案不同的只有這一段和 tour-sample-data.js */
  var TOUR_KEY = 'circle_cup_bottle_tour_v1';
  var AR_DEMO_TEXT = '餐廚\n好物';   // 第 11 步：AR 文案按 Enter 斷行後的結果

  var SAMPLE_SRC = 'tour/tour-sample-data.js';
  var H = TourGuide.helpers;

  var CANVAS = '#shadow-compose-canvas';
  var POPUP = '#popup-overlay .popup-panel';
  var LEFT = '商品1(左)', MID = '商品2(中)', RIGHT = '商品3(右)';
  var MAIN_LAYOUT = '11_lpbn_app';
  var EXTRA_LAYOUT = '05_fb_post';
  var EXTRA_BLOCK = '#canvas-block-' + EXTRA_LAYOUT;

  /* 範例商品擺放位置（1200 畫布座標：x=商品中心，y=商品底部），開視窗前直接寫入 */
  var SAMPLE_POSE = {};
  SAMPLE_POSE[LEFT] = { x: 400, y: 930, w0: 640, h0: 640, scaleMul: 1 };
  SAMPLE_POSE[MID] = { x: 620, y: 840, w0: 540, h0: 540, scaleMul: 1 };
  SAMPLE_POSE[RIGHT] = { x: 850, y: 925, w0: 520, h0: 520, scaleMul: 1 };
  /* 疊放順序：後面＝前景。中間商品一開始在最後面，第 4 步示範拖到最前面 */
  var START_ORDER = [RIGHT, LEFT, MID];
  var END_ORDER = [MID, RIGHT, LEFT];
  /* FB 版位的商品大小。工具預設會貼滿作圖區，右邊影子會被畫布切掉，範例改小一點 */
  var EXTRA_HOST = { xPct: 0.72, yPct: -0.14, hPct: 1.25, align: 'center' };
  var POINTER_MS = 140;  // 示範拖曳時多久送一次 pointer，太密重畫不及會卡

  /* 工具會非同步開下一個視窗，導覽中途跳出時要等它開完才能收乾淨 */
  var pending = null;
  var saved = null;
  var backgroundDone = false, importPhase = 0, addPhase = 0;
  var hostSnapshot = null;

  function track(p){ pending = p; return p; }

  /* 按「下一步」後要等工具處理時先給回饋，讓畫面先畫出來再開始算 */
  function busyThen(work){
    return function(){
      var next = document.querySelector('.tg-next');
      if(next){ next.textContent = '處理中…'; next.disabled = true; }
      return new Promise(function(resolve){
        requestAnimationFrame(function(){ requestAnimationFrame(resolve); });
      }).then(work);
    };
  }

  /* 畫面捲動時先收起打亮框和說明框，捲到定位才在新位置出現 */
  var spotHidden = false;
  function hideSpot(){
    var spot = document.querySelector('.tg-spot');
    spotHidden = true;
    spot.style.transition = 'none';
    spot.style.opacity = '0';
    document.querySelector('.tg-block').style.background = 'var(--tg-backdrop)';
  }
  function hideCard(){
    var card = document.querySelector('.tg-card');
    card.style.transition = 'none';
    card.style.opacity = '0';
  }
  function showSpot(){
    if(!spotHidden) return;
    spotHidden = false;
    var spot = document.querySelector('.tg-spot'), card = document.querySelector('.tg-card');
    void spot.offsetWidth;               // 先讓新位置生效，淡入時才不會滑過去
    spot.style.transition = 'opacity .2s';
    card.style.transition = 'opacity .2s';
    spot.style.opacity = '';
    card.style.opacity = '';
    setTimeout(function(){ spot.style.transition = ''; card.style.transition = ''; }, 250);
  }
  /* 等畫布區捲動停下來 */
  function waitScrollEnd(){
    var area = H.$('#canvas-area'), last = -1, stable = 0, t0 = Date.now();
    return new Promise(function(resolve){
      (function check(){
        stable = area.scrollTop === last ? stable + 1 : 0;
        last = area.scrollTop;
        if(stable >= 4 || Date.now() - t0 > 1500) return resolve();
        setTimeout(check, 40);
      })();
    });
  }

  /* 匯入步驟分三段出現：打亮範圍和文案一起換 */
  var IMPORT_TARGETS = ['#zone-excel', '#zone-folder', '#confirm-import-btn'];
  var IMPORT_TEXT = [
    '拖入工單，系統會自動帶入版位、文案。',
    '拖入素材資料夾，並依工單檔名自動匹配 LOGO 與商品圖。',
    '確認無誤後，進入商品詳細設定。'
  ];
  function showImportPhase(n){
    importPhase = n;
    document.querySelector('.tg-body').textContent = IMPORT_TEXT[n];
  }

  /* ══════════════════ 範例資料 ══════════════════ */
  var samplePromise = null;
  function loadSample(){
    if(samplePromise) return samplePromise;
    samplePromise = new Promise(function(resolve, reject){
      if(window.TOUR_SAMPLE) return resolve(window.TOUR_SAMPLE);
      var s = document.createElement('script');
      s.src = SAMPLE_SRC;
      s.onload = function(){ resolve(window.TOUR_SAMPLE); };
      s.onerror = function(){ samplePromise = null; reject(new Error('範例資料載入失敗')); };
      document.head.appendChild(s);
    }).then(function(sample){
      function toFile(f){
        var bin = atob(f.b64), u = new Uint8Array(bin.length);
        for(var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return new File([u], f.name, { type: f.type || '' });
      }
      return {
        excelName: sample.excelName,
        folderLabel: sample.folderLabel,
        excel: toFile({ b64: sample.excel, name: sample.excelName, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        files: sample.files.map(toFile),
        blankBackground: toFile(sample.blankBackground)
      };
    });
    return samplePromise;
  }
  function openImport(){
    if(!H.$('#zone-excel')) openImportModal();
    return H.waitFor(function(){ return H.$('#zone-excel'); }).then(loadSample);
  }
  function setExcel(){
    return loadSample().then(function(d){
      var zone = H.$('#zone-excel');
      if(!zone) return;
      _importState.excelFile = d.excel;
      H.$('#zone-excel-title').textContent = '已選擇：' + d.excelName;
      zone.classList.add('dropzone-success');
      updateImportConfirmState();
    });
  }
  function setFolder(){
    return loadSample().then(function(d){
      var zone = H.$('#zone-folder');
      if(!zone) return;
      _importState.folderFiles = d.files;
      H.$('#zone-folder-title').textContent = '已讀取 ' + d.files.length + ' 張素材圖片';
      zone.classList.add('dropzone-success');
    });
  }
  function doImport(){
    var btn = H.$('#confirm-import-btn');
    if(!btn) return Promise.resolve();
    return setExcel().then(setFolder).then(function(){
      seedSampleOnNextOpen();
      btn.click();
      return track(H.waitFor(function(){ return H.$(CANVAS); }, 15000));
    }).then(function(){ return H.wait(300); });
  }

  /* 下一次開商品視窗時先寫入範例位置和順序，只生效一次 */
  function seedSampleOnNextOpen(){
    var open = window.openShadowPopup;
    window.openShadowPopup = function(){
      window.openShadowPopup = open;
      Object.keys(SAMPLE_POSE).forEach(function(id){
        if(S.shadowSlots[id]) S.shadowSlots[id].transform = SAMPLE_POSE[id];
      });
      S.shadowOrder = START_ORDER.slice();
      open();
    };
  }

  /* ══════════════════ 商品視窗 ══════════════════ */
  function selectSlot(id){
    _shadowReceiver.setActiveSlot(id, drawShadowCanvas);
    renderSlotBar();
    updateShadowOffsetPanel();
  }
  function slotPoint(id){
    var r = H.$(CANVAS).getBoundingClientRect(), k = r.width / 1200;
    var s = _shadowReceiver.getSlotRaw(id), h = s.h0 * s.scaleMul;
    return { x: r.left + s.x * k, y: r.top + (s.y - h * 0.4) * k };
  }
  /* 商品右下角的螢幕座標（有色範圍） */
  function slotCorner(id){
    return new Promise(function(resolve){
      var img = new Image();
      img.onload = function(){
        var r = H.$(CANVAS).getBoundingClientRect(), k = r.width / 1200;
        var s = _shadowReceiver.getSlotRaw(id), fullW = s.w0 * s.scaleMul;
        var tight = Core.calcTightBoundsRatio(img) || { tx: 0, tw: 1 };
        var right = s.x - fullW / 2 + (tight.tx + tight.tw) * fullW;
        resolve({ x: r.left + right * k, y: r.top + s.y * k });
      };
      img.src = S.shadowSlots[id].dataUrl;
    });
  }
  /* 假游標真的拖動，再拖回原位 */
  function dragAndBack(a, el, from, to){
    var last = 0;
    function onMove(x, y){
      var now = performance.now();
      if(now - last < POINTER_MS) return;
      last = now;
      H.firePointer(el, 'pointermove', x, y);
    }
    return a.move(from.x, from.y, 600).then(function(){
      H.firePointer(el, 'pointerdown', from.x, from.y);
      return a.wait(150);
    }).then(function(){
      return a.move(to.x, to.y, 800, onMove);
    }).then(function(){
      H.firePointer(el, 'pointermove', to.x, to.y);
      return a.wait(350);
    }).then(function(){
      return a.move(from.x, from.y, 700, onMove);
    }).then(function(){
      H.firePointer(el, 'pointermove', from.x, from.y);
      H.firePointer(el, 'pointerup', from.x, from.y);
    });
  }
  function doMoveMidToBack(){
    if(!H.$('#shadow-slotbar') || S.shadowOrder[0] === MID) return;
    S.shadowOrder = END_ORDER.slice();
    broadcastShadowOrder();
    renderSlotBar();
  }
  function doRightLight(){
    if(H.$(CANVAS) && _shadowReceiver.getLightAngle(LEFT) !== 'right'){
      _shadowReceiver.setLightAngle(LEFT, 'right', drawShadowCanvas);
    }
  }
  function doApply(){
    var btn = H.$('#shadow-export-btn');
    if(!btn) return Promise.resolve();
    btn.click();
    return track(H.waitFor(function(){ return !H.$('#popup-overlay') && S.assets.host; }, 15000));
  }

  /* ══════════════════ 主畫面 ══════════════════ */
  function panelButton(text){
    return Array.prototype.filter.call(document.querySelectorAll('.right-panel .tbtn'), function(b){
      return b.textContent.indexOf(text) !== -1;
    })[0];
  }
  function field(id){ return H.$(id).closest('.field'); }
  function extraCheckbox(){ return H.$('[data-layout-id="' + EXTRA_LAYOUT + '"]'); }
  function hostPoint(){
    var cv = H.$('#cv-' + MAIN_LAYOUT), box = getHostBox(MAIN_LAYOUT), r = cv.getBoundingClientRect();
    var k = r.width / cv.width, b = box.colorBox;
    return { x: r.left + (b.left + b.w / 2) * k, y: r.top + (b.top + b.h / 2) * k };
  }
  /* 示範前記下位置，示範後還原，避免拖來拖去累積誤差 */
  function rememberHost(){ hostSnapshot = JSON.stringify(S.positionOverrides[MAIN_LAYOUT] || null); }
  function restoreHost(){
    if(hostSnapshot === null) return;
    var o = JSON.parse(hostSnapshot);
    if(o) S.positionOverrides[MAIN_LAYOUT] = o; else delete S.positionOverrides[MAIN_LAYOUT];
    hostSnapshot = null;
    renderAll();
  }
  /* 追加版位：確認後等版位出現，這時 FB 還是空白底 */
  function doAddExtraLayout(){
    if(H.$(EXTRA_BLOCK) && !H.$('#layout-toggle-confirm-btn')) return Promise.resolve();
    if(!H.$('#layout-toggle-confirm-btn')) openLayoutTogglePopup();
    var cb = extraCheckbox();
    if(cb && !cb.checked) cb.click();
    S.positionOverrides = S.positionOverrides || {};
    if(!S.positionOverrides[EXTRA_LAYOUT]) S.positionOverrides[EXTRA_LAYOUT] = { assets: { host: Object.assign({}, EXTRA_HOST) } };
    H.$('#layout-toggle-confirm-btn').click();
    return track(H.waitFor(function(){ return H.$(EXTRA_BLOCK + ' canvas'); }, 8000)).then(function(){
      return H.wait(200);
    });
  }
  /* 範例資料裡的 FB 空白背景，走工具真正的上傳流程（尺寸要和版位相同） */
  /* 示範「上傳空白背景」：導覽進行中，追加的版位先不畫 backgrounds/ 裡的預設背景圖，
     只畫底色，上傳後才看得到背景。導覽結束就恢復，不影響平常使用。 */
  var hideExtraBg = false;
  (function(){
    var bgMod = window.Modules && window.Modules.background;
    if(!bgMod || bgMod._tourWrapped) return;
    var orig = bgMod.draw;
    bgMod.draw = function(ctx, layer, state, meta){
      if(hideExtraBg && meta && meta.layoutId === EXTRA_LAYOUT && !(state.customBg && state.customBg[EXTRA_LAYOUT])){
        return orig.call(this, ctx, layer, state, Object.assign({}, meta, { layoutId: null }));
      }
      return orig.apply(this, arguments);
    };
    bgMod._tourWrapped = true;
  })();

  function doUploadBackground(){
    return loadSample().then(function(d){
      handleCustomBgFile(EXTRA_LAYOUT, d.blankBackground);
      return H.waitFor(function(){ return S.customBg && S.customBg[EXTRA_LAYOUT] && H.$(EXTRA_BLOCK + ' canvas'); }, 5000);
    }).then(function(){
      return H.wait(300);
    }).then(function(){
      backgroundDone = true;             // 打亮範圍換成整張版位，看完整效果
      scrollToCanvas(EXTRA_LAYOUT);
    });
  }

  /* ══════════════════ 步驟（要改文字或增減步驟改這裡） ══════════════════ */
  var STEPS = [
    { intro: true,
      title: '歡迎使用編輯器製作',
      body: '跟著範例工單走一遍，只需 2 分鐘。' },

    { target: function(){ return H.$(IMPORT_TARGETS[importPhase]); }, place: 'right',
      title: '匯入工單與素材',
      body: IMPORT_TEXT.join(''),
      before: function(){ importPhase = 0; return openImport(); },
      anim: function(a){
        return loadSample().then(function(d){
          showImportPhase(0);
          return a.wait(900)
            .then(function(){ return a.drag({ x: innerWidth - 110, y: 150 }, '#zone-excel', { chip: '📄 ' + d.excelName, ms: 1000 }); })
            .then(setExcel)
            .then(function(){ return a.wait(1300); })
            .then(function(){ showImportPhase(1); return a.wait(1100); })
            .then(function(){ return a.drag({ x: innerWidth - 110, y: 300 }, '#zone-folder', { chip: '📁 ' + d.folderLabel, ms: 1000 }); })
            .then(setFolder)
            .then(function(){ return a.wait(1300); })
            .then(function(){ showImportPhase(2); return a.wait(1100); })
            .then(function(){ return a.click('#confirm-import-btn', { after: 400 }); });
        });
      } },

    { target: POPUP, place: 'bottom', pad: 0, waitTimeout: 15000,
      title: '商品合成版位',
      body: '這是智慧型合成畫布，把商品擺放好，就會連動更新所有版位。',
      before: busyThen(doImport) },

    { target: '#shadow-slotbar', place: 'right',
      title: '素材清單管理',
      body: '拖曳抓手即可調整順序。',
      anim: function(a){
        var rows = document.querySelectorAll('#shadow-slotbar .shadow-slot');
        var handle = rows[0].querySelector('.shadow-slot-drag');
        var end = H.center(rows[rows.length - 1]);
        return a.drag(handle, { x: H.center(handle).x, y: end.y + 16 }, { chip: '商品2(中)', ms: 1100, after: 200 })
          .then(function(){ doMoveMidToBack(); return a.wait(1000); });
      } },

    { target: CANVAS, place: 'left',
      title: '調整擺放位置',
      body: '拖曳可移動位置，拖曳角落可放大縮小。',
      before: function(){ doMoveMidToBack(); selectSlot(LEFT); return H.wait(200); },
      anim: function(a){
        var c = slotPoint(LEFT);
        return dragAndBack(a, CANVAS, c, { x: c.x + 50, y: c.y - 24 })
          .then(function(){ return a.wait(300); })
          .then(function(){ return slotCorner(LEFT); })
          .then(function(p){ return dragAndBack(a, CANVAS, p, { x: p.x + 44, y: p.y + 34 }); });
      } },

    { target: ['#shadow-offset-panel', CANVAS], place: 'right',
      title: '設定陰影方向',
      body: '提供左、中、右三種陰影光源方向，並支援單獨調整特定商品的陰影。',
      before: function(){ selectSlot(LEFT); return H.wait(300); },
      anim: function(a){
        return a.wait(800)
          .then(function(){ return a.click('[data-slot-angle=right]', { real: true, after: 1400 }); });
      } },

    { target: '#shadow-export-btn', place: 'top',
      title: '套用到版位',
      body: '調整完成後，請點擊「確認」才會套用到版位。',
      before: function(){ doRightLight(); return H.wait(100); },
      anim: function(a){
        return a.wait(1000)
          .then(function(){ return a.click('#shadow-export-btn', { after: 400 }); });
      } },

    { target: '#asset-list-body', place: 'right',
      title: '素材列表',
      body: '工單中的所有製作物會在此統一列出。',
      before: busyThen(doApply) },

    { target: function(){ return [field('#input-標題'), panelButton('編輯商品')]; }, place: 'left',
      title: '編輯列表',
      body: '在此輸入文案，或進行 LOGO 與商品的細節修改。' },

    { target: function(){ return [field('#input-標題'), field('#input-日期')]; }, place: 'left',
      title: '文案檢核',
      body: '字數超限會顯示紅字，出現禁用語會自動提示。',
      anim: function(a){
        return a.type('#input-日期', '7/1-9/30', { speed: 110 })
          .then(function(){ return a.wait(900); })
          .then(function(){
            var btn = H.$('#banwarn-日期 .banword-apply-btn');
            return btn ? a.click(btn, { real: true, after: 1000 }) : a.wait(300);
          });
      },
      /* 動畫被跳過時也把日期格式修好，後面步驟看到的是修正後的文案 */
      after: function(){ var btn = H.$('#banwarn-日期 .banword-apply-btn'); if(btn) btn.click(); } },

    { target: '#ar-panel-section', place: 'left',
      title: 'AR 內容換行',
      body: '編輯 AR 文案時，按下 Enter 鍵即可斷行。',
      before: function(){ scrollToCanvas('ar'); return H.wait(500); },
      anim: function(a){
        var input = H.$('#input-AR文案');
        return a.wait(900)
          .then(function(){ return a.click(input, { after: 900 }); })
          .then(function(){
            input.value = AR_DEMO_TEXT;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return a.wait(1000);
          });
      } },

    { target: '#canvas-block-' + MAIN_LAYOUT, place: 'bottom',
      title: '畫布微調功能',
      body: '在畫面上直接拖曳商品即可調整大小與位置。',
      before: function(){
        if(H.$('#layout-toggle-confirm-btn')) closePopup();
        addPhase = 0;
        scrollToCanvas(MAIN_LAYOUT);
        rememberHost();
        return H.wait(500);
      },
      after: restoreHost,
      anim: function(a){
        var c = hostPoint();
        return dragAndBack(a, '#cv-' + MAIN_LAYOUT, c, { x: c.x - 40, y: c.y + 16 }).then(restoreHost);
      } },

    { target: function(){ return addPhase === 1 ? H.$(POPUP) : H.$('#btn-add-layout'); },
      place: 'right',
      title: '追加新版位',
      body: '若需新增工單未列出的版位，直接勾選即可出現。',
      before: function(){ addPhase = 0; return H.wait(100); },
      anim: function(a){
        return a.wait(600)
          .then(function(){ return a.click('#btn-add-layout', { real: true, after: 300 }); })
          .then(function(){ return H.waitFor(extraCheckbox); })
          .then(function(){ addPhase = 1; return a.wait(600); })
          .then(function(){
            var cb = extraCheckbox();
            return a.click(cb, { real: !cb.checked, after: 500 });
          })
          .then(function(){ return a.click('#layout-toggle-confirm-btn', { after: 400 }); });
      } },

    { target: function(){ return backgroundDone ? H.$(EXTRA_BLOCK) : H.$(EXTRA_BLOCK + ' .canvas-meta'); },
      place: 'left', scroll: false, waitTimeout: 8000,
      title: '上傳空白背景',
      body: '若畫面缺少背景，再上傳一張空白背景圖即可。',
      before: busyThen(function(){
        hideSpot();
        return doAddExtraLayout().then(function(){
          hideCard();
          scrollToCanvas(EXTRA_LAYOUT);
          return H.wait(80);
        }).then(waitScrollEnd);
      }),
      anim: function(a){
        if(backgroundDone) return a.wait(300);
        var btn = H.byText(EXTRA_BLOCK + ' .mini-dl-btn', '上傳背景圖');
        return a.wait(1800)
          .then(function(){ return a.click(btn, { after: 500 }); })
          .then(doUploadBackground)
          .then(function(){ return a.wait(1000); });
      } },

    { target: '#btn-download-all', place: 'bottom',
      title: '一鍵整包下載',
      body: '點擊「下載 ZIP」，打包取得所有版位圖片與暫存檔。' },

    { target: '[data-tour-launch]', place: 'bottom',
      title: '導覽結束',
      body: '導覽完成！未來隨時點擊此圖示即可重看教學。' }
  ];

  /* 這些步驟已經真的匯入或確認過，不能退回上一步 */
  var NO_BACK = [1, 2, 7];

  /* ══════════════════ 動畫演完才出現按鈕 ══════════════════ */
  var controlsHidden = false;
  function setControls(show){
    controlsHidden = !show;
    ['.tg-next', '.tg-prev'].forEach(function(sel){
      var b = document.querySelector(sel);
      if(b) b.style.visibility = show ? '' : 'hidden';
    });
    if(show){
      var next = document.querySelector('.tg-next');
      if(next) try{ next.focus({ preventScroll: true }); }catch(e){}
    }
  }
  function motionOff(){
    try{ return matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; }
  }
  STEPS.forEach(function(step){
    if(!step.anim) return;
    var play = step.anim;
    step.animOnce = true;
    step.anim = function(a, t){
      return Promise.resolve().then(function(){ return play(a, t); }).then(function(){
        setControls(true);
        return a.hide();
      }, function(e){
        if(!e || !e.tourAbort) setControls(true);   // 換步驟中止的不用管，其他錯誤不能把按鈕藏著
        throw e;
      });
    };
  });

  /* ══════════════════ 開始與結束 ══════════════════ */
  function restore(){
    hideExtraBg = false;
    closePopup();
    TABS = saved.tabs;
    ACTIVE_TAB = saved.active;
    saved = null;
    renderTabBar();
    applyTabData(ACTIVE_TAB, function(){
      refreshRightPanel();
      buildCanvasArea().then(function(){
        applyDefaultLogos(renderAll);
        if(TABS.length === 1 && isEmptyDefaultTabData(TABS[0].data)) openImportModal();
      });
    });
  }

  var tour = TourGuide.create({
    storageKey: TOUR_KEY,
    autoStart: false,            // 要等匯入視窗開好才開始，見下面
    forceParam: null,
    launchButton: { container: '.topbar-right', className: 'tbtn' },
    theme: 'dark',
    accent: '#EE4D2D',
    zIndex: 100000,
    animPause: 99999,
    steps: STEPS,
    onStart: function(){
      saveCurrentTabIntoData();
      saved = { tabs: TABS.slice(), active: ACTIVE_TAB };
      pending = null;
      backgroundDone = false;
      hideExtraBg = true;
      importPhase = 0;
      addPhase = 0;
      hostSnapshot = null;
      spotHidden = false;
    },
    onStep: function(i, step){
      if(NO_BACK.indexOf(i) !== -1) document.querySelector('.tg-prev').disabled = true;
      document.querySelector('.tg-next').disabled = false;
      setControls(!(step.anim && !motionOff()));
      showSpot();
    },
    onEnd: function(){
      setControls(true);
      showSpot();
      Promise.resolve(pending).then(restore);
    }
  });
  window.circleTour = tour;

  /* 鍵盤也要遵守「動畫沒演完不能換步」和「不能退回」，要比導覽的按鍵處理更早攔下 */
  window.addEventListener('keydown', function(e){
    if(!tour.isActive()) return;
    var forward = e.key === 'ArrowRight' || e.key === 'Enter', back = e.key === 'ArrowLeft';
    if((controlsHidden && (forward || back)) || (back && NO_BACK.indexOf(tour.index()) !== -1)){
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

  /* 工具等字型載完才開匯入視窗，導覽要排在它後面 */
  var forced = /[?&]tour(=|&|$)/.test(location.search);
  if(forced || !tour.hasSeen()){
    H.waitFor(function(){ return H.$('#zone-excel'); }, 60000).then(function(found){
      if(found) tour.start();
    });
  }

})();
