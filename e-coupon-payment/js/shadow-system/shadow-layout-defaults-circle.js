/*
  shadow-layout-defaults-circle.js
  直接翻譯自 pet-frenzy 的 shadow-layout-defaults.js，位置數字完全沒改（同一組
  三個商品的擺位：中間一個大的、右下一個、左側一個）。

  ★ 版型代號故意維持 pet 原本的 A/C/D（不remap成Circle習慣的A/B/C），理由見
  shadow-popup.js/openImportModal附近的說明——這967行的receiver檔案自己內部
  也寫死了一份用A/B/C/D當key的置中校正常數，字母要對得起來。

  ★ 2026-08 更新：槽位命名改成跟實際工單一致的「商品1(左)」「商品2(中)」
  「商品3(右)」（原本用商品1/2/3，工單裡其實從頭到尾都是用左中右這幾個字），
  同時把「左中右」三個字實際對應到畫面上的哪個位置也一併修正——以前是照pet
  原始的product1/2/3語意（跟左中右無關）隨便對應，現在改成：
    商品1(左) → 真的擺在畫面左側
    商品2(中) → 真的擺在畫面中間（三個裡最大、最主要那個位置）
    商品3(右) → 真的擺在畫面右側
  三個實際位置數字沒有變，只是把「哪個名字對應哪個位置」這件事修正過來。
*/
(function(){

  var HEAD_WIDTH_PCT      = 0.16;
  var HEAD_DISTANCE_PCT   = 0.26;
  var CENTER_A            = 0.5;
  var HEAD_Y_PCT          = 0.30;
  var HOST1_SCALE         = 1.08;

  /* 2026-08再調整：大中小的比例基準統一——原本左中右三個槽位各自有自己的
     基準hPct(中間0.46、左右0.36)，「大/中/小」只是各自基準上的倍率，
     所以「中間選小」實際尺寸還是可能比「左邊選中」大，大中小之間沒辦法
     直接比較。使用者要求「大中小要能互相比較」，所以改成三個槽位共用
     同一個基準(PRODUCT_BASE_HPCT，沿用原本中間商品的0.46，是三個裡面
     原本最大的那個)，之後不管商品放在哪個槽位，選同樣的大小標籤，最終
     視覺高度都會一樣——代價是：左右槽位原本比較窄，如果選「大」，商品
     寬度可能會超出原本左右槽位的可用空間、跟中間商品重疊，這是使用者
     已經確認接受的取捨，需要再收斂可以調整下面這個常數。 */
  var PRODUCT_BASE_HPCT   = 0.46;

  /* 三個商品的實際位置，跟畫面上的視覺位置一一對應，之後想調整「左邊那格」
     實際要放哪裡，就改 LEFT 這組數字，不用去猜到底是改product1還是product3。
     2026-08 調整：
     1) hPct（商品第一次上傳時的預設高度比例）整體放大約28%——使用者反映
        商品廣播到1200畫布時看起來太小，這三個數字只影響「第一次上傳還沒有
        savedTransform」時的初始大小，使用者自己在1200畫布裡拖角縮放過的
        結果不受影響（見shadow-layout-receiver.js的upsertSlot()）。
     2) xPct整體往左平移0.08——原本CENTER在0.58，明顯偏畫布右側，使用者
        反映「中間商品請在畫布中間」，把CENTER改成剛好0.5(畫布正中央)，
        LEFT/RIGHT跟著整組平移同一個量(-0.08)，維持三者原本的相對間距不變。
     3) 2026-08再調整（三角形構圖）：使用者要求整體改成三角形構圖——中間
        商品偏上（當三角形頂點）、左右兩個商品偏下（當三角形底邊兩端）。
        原本RIGHT比CENTER/LEFT高（0.631667 vs 0.741667），現在整個顛倒
        過來：CENTER改成三個裡面yPct最小(位置最高)，LEFT/RIGHT改成一樣
        高、都比CENTER低。xPct(水平位置)沒有更動，只調yPct(垂直位置)。 */
  var PRODUCT_POS_CENTER = { xPct: 0.5,  yPct: 0.62,  hPct: PRODUCT_BASE_HPCT }; // 三個裡最大、最主要，中間偏上，當三角形頂點
  var PRODUCT_POS_RIGHT  = { xPct: 0.72, yPct: 0.79,  hPct: PRODUCT_BASE_HPCT }; // 右邊偏下，三角形右下角
  var PRODUCT_POS_LEFT   = { xPct: 0.26, yPct: 0.79,  hPct: PRODUCT_BASE_HPCT }; // 左邊偏下，三角形左下角

  /* 券樣專用的「商品1(左)」位置——只給E/F/G(工單D/E/F組合，商品1(左)是
     券樣)用，跟C組合(3品，內部代號D)共用的PRODUCT_POS_LEFT分開，這樣
     調整券的位置不會牽動到一般商品的C組合(3品)。使用者反映D組合的券
     位置要再往右一點，xPct從0.26調到0.31(+0.05，約畫布寬度5%)。
     2026-08再調整：券樣尺寸縮小10%，hPct從PRODUCT_BASE_HPCT(0.46)乘0.9
     得0.414，不跟一般商品共用PRODUCT_BASE_HPCT，只有券樣變小。
     2026-08再調整：再縮小10%，累計0.9*0.9=0.81。 */
  /* 使用者反映寬度太寬，改成直接鎖定高度(1200畫布下hPct=高度px/1200)，
     不再用PRODUCT_BASE_HPCT的比例去推算——三個位置(左/中/右)都共用這個
     常數(見下面PRODUCT_POS_CENTER_TICKET/PRODUCT_POS_RIGHT_TICKET)，配合
     shadow-layout-receiver.js跳過邊緣防溢出縮小(isTicket不套用
     clampInitialSlotScale)，三個位置實際畫出來的高度會完全鎖死一致。
     2026-08再調整：180px→250px（hPct=250/1200=0.208333）。 */
  var PRODUCT_POS_LEFT_TICKET = { xPct: 0.31, yPct: 0.79, hPct: 0.208333 };

  /* 中/右位置的券樣專屬尺寸——使用者確認三個位置(左/中/右)統一用同一個
     固定大小，所以直接沿用PRODUCT_POS_LEFT_TICKET算好的hPct，只換
     xPct/yPct跟一般商品中/右位置一樣（不影響水平/垂直位置，只有尺寸
     跟左邊券樣一致）。 */
  var PRODUCT_POS_CENTER_TICKET = { xPct: PRODUCT_POS_CENTER.xPct, yPct: PRODUCT_POS_CENTER.yPct, hPct: PRODUCT_POS_LEFT_TICKET.hPct };
  var PRODUCT_POS_RIGHT_TICKET = { xPct: PRODUCT_POS_RIGHT.xPct, yPct: PRODUCT_POS_RIGHT.yPct, hPct: PRODUCT_POS_LEFT_TICKET.hPct };

  window.ShadowLayoutDefaults = {

    // 內部代號'A'＝Circle介面顯示「A組合(2人)」
    A: {
      '人物1': { headWidthPct: HEAD_WIDTH_PCT * HOST1_SCALE, headXPct: CENTER_A + HEAD_DISTANCE_PCT/2, headYPct: HEAD_Y_PCT },
      '人物2': { headWidthPct: HEAD_WIDTH_PCT,                headXPct: CENTER_A - HEAD_DISTANCE_PCT/2, headYPct: HEAD_Y_PCT }
    },

    /* 內部代號'C'＝Circle介面顯示「B組合(1人+2品)」。
       工單的組合矩陣裡，B組合用的是 人物1 + 商品2(中) + 商品3(右)
       （不含商品1(左)），照工單實際勾選的槽位給預設位置。 */
    C: {
      '人物1': { headWidthPct: 0.17, headXPct: 0.31, headYPct: HEAD_Y_PCT },
      '商品2(中)': PRODUCT_POS_CENTER,
      '商品3(右)': PRODUCT_POS_RIGHT
    },

    // 內部代號'D'＝Circle介面顯示「C組合(3品)」，三個商品都用，左中右各就各位。
    // 疊放順序預設值見下面window.CIRCLE_COMBO_SLOTS.D的說明（2026-08已調整為
    // 中間商品在最底層）。
    D: {
      '商品1(左)': PRODUCT_POS_LEFT,
      '商品2(中)': PRODUCT_POS_CENTER,
      '商品3(右)': PRODUCT_POS_RIGHT
    },

    /* 內部代號'E'＝Circle介面顯示「D組合(1券+2品)」（電子票券繳費專案新增）。
       槽位佈局跟內部'D'（=「C組合(3品)」）大致相同，但商品1(左)這個槽位
       是券樣，改用PRODUCT_POS_LEFT_TICKET(比一般商品的PRODUCT_POS_LEFT
       再往右一點，使用者反映的調整)，商品2/3維持共用一般商品的位置常數。
       這個槽位最終要走券樣合成（LOGO疊在券框PNG上），而不是放一般商品
       照片——這個資訊不影響位置佈局，另外存在下面的
       window.CIRCLE_COMBO_TICKET_SLOTS，留給券樣合成popup查表用。
       （不能直接沿用內部代號'D'：如果D/E/F都共用同一個value，下拉選單
       選取狀態會分不出使用者選的到底是哪一組，見shadow-popup.js的
       comboSel.value那段，所以每個工單組合都要有自己獨立的內部代號。） */
    E: {
      '商品1(左)': PRODUCT_POS_LEFT_TICKET,
      '商品2(中)': PRODUCT_POS_CENTER,
      '商品3(右)': PRODUCT_POS_RIGHT
    },

    /* 內部代號'F'＝Circle介面顯示「E組合(2券+1品)」，票券化槽位是
       商品1(左)+商品2(中)兩個(見下面CIRCLE_COMBO_TICKET_SLOTS.F)，所以
       這兩個槽位都改用券樣專用尺寸，商品3(右)是真正的商品照片，維持
       一般商品尺寸不受影響。 */
    F: {
      '商品1(左)': PRODUCT_POS_LEFT_TICKET,
      '商品2(中)': PRODUCT_POS_CENTER_TICKET,
      '商品3(右)': PRODUCT_POS_RIGHT
    },

    /* 內部代號'G'＝Circle介面顯示「F組合(3券)」，三個槽位全部票券化
       (CIRCLE_COMBO_TICKET_SLOTS.G)，三個都改用券樣專用尺寸。 */
    G: {
      '商品1(左)': PRODUCT_POS_LEFT_TICKET,
      '商品2(中)': PRODUCT_POS_CENTER_TICKET,
      '商品3(右)': PRODUCT_POS_RIGHT_TICKET
    },

    _fallback: {
      '人物1': { headWidthPct: HEAD_WIDTH_PCT * HOST1_SCALE, headXPct: 0.36 + HEAD_DISTANCE_PCT/2, headYPct: HEAD_Y_PCT },
      '人物2': { headWidthPct: HEAD_WIDTH_PCT, headXPct: 0.36 - HEAD_DISTANCE_PCT/2, headYPct: HEAD_Y_PCT },
      '商品1(左)': PRODUCT_POS_LEFT,
      '商品2(中)': PRODUCT_POS_CENTER,
      '商品3(右)': PRODUCT_POS_RIGHT
    }
  };

  /* D／E／F三個新組合裡，哪些槽位最終要走「券樣合成」（LOGO疊在固定PNG券框上），
     不是放一般商品照片——直接對照工單「製作內容文案」表裡的
     「商品1票券化／商品2票券化／商品3票券化」三欄。這份表只記錄事實，實際
     怎麼合成（要哪張PNG框、LOGO疊放座標）等券樣合成popup那個功能做出來時
     再接（見電子票券繳費_匯入流程.md 第六步／待補清單）。
     目前editor-import.js的parseExposureTable()是直接看「曝品」表裡槽位名稱
     寫的是「商品N(左/中/右)」還是「票券N(左/中/右)」來判斷單一item是否要
     券樣化（比對照這份表更準，因為那是工單當次填寫的第一手資料）；這份表
     單純備查、也給沒有Excel、只用下拉選單手動選組合時當預設值用。 */
  window.CIRCLE_COMBO_TICKET_SLOTS = {
    E: ['商品1(左)'],
    F: ['商品1(左)', '商品2(中)'],
    G: ['商品1(左)', '商品2(中)', '商品3(右)']
  };

  /* Circle介面顯示用的組合清單：value是「內部真正傳給receiver的字母」，
     label是「使用者在下拉選單看到的文字」，跟Excel工單「曝品」欄位選單的
     文字要完全一致（editor-import.js的comboLabelToLetter()靠這個反查字母）。 */
  window.CIRCLE_COMBO_UI = [
    { value:'A', label:'A組合(2人)' },
    { value:'C', label:'B組合(1人+2品)' },
    { value:'D', label:'C組合(3品)' },
    // 以下三組是電子票券繳費工單新增的組合，佈局跟'D'一樣（見上面ShadowLayoutDefaults.E/F/G的說明）
    { value:'E', label:'D組合(1券+2品)' },
    { value:'F', label:'E組合(2券+1品)' },
    { value:'G', label:'F組合(3券)' }
  ];

  /* 每個內部版型代號，實際會用到哪些槽位（給素材清單UI知道要顯示哪幾個上傳欄位）。
     D的陣列順序同時也是「疊放順序」的預設值（見shadow-popup.js的getShadowOrder()，
     陣列前面＝後方、後面＝前方）。2026-08調整：中間商品(商品2(中))改成排最前面＝
     最底層(最後面/被其他商品擋住)，商品1(左)/商品3(右)疊在它前面——原本是中間
     商品在最上層(蓋住左右兩個)，使用者反映想要反過來，中間商品退到最後面當
     背景。使用者在popup裡自己拖曳清單調整過順序之後，就照使用者調整的結果，
     不會再被這裡的預設值蓋掉（見getShadowOrder()裡的sameSet判斷）。 */
  window.CIRCLE_COMBO_SLOTS = {
    A: ['人物1','人物2'],
    C: ['人物1','商品2(中)','商品3(右)'],
    D: ['商品2(中)','商品1(左)','商品3(右)'],
    // E/F/G疊放順序沿用跟D一樣的預設值（中間商品最底層），使用者一樣可以自己拖曳調整
    E: ['商品2(中)','商品1(左)','商品3(右)'],
    F: ['商品2(中)','商品1(左)','商品3(右)'],
    G: ['商品2(中)','商品1(左)','商品3(右)']
  };

})();
