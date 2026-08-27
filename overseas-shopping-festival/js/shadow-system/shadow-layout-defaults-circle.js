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
  /* 2026-08再調整(蝦皮流行穿搭案)：舞台放大了(js/shadow-system/
     stage-defaults.js的wPct 0.55→0.65，放大約1.1818倍)，使用者要求
     商品要跟著舞台等比例放大、維持商品相對舞台的視覺比例不變，這裡用
     同一個倍率把基準值一起放大(0.34*1.1818≈0.402)。之後如果舞台大小
     再調整，這裡也要跟著用同一個倍率同步調整，不要漏掉。
     2026-08再調整：舞台再放大(wPct 0.65→0.75，倍率0.75/0.65≈1.1538)，
     這裡同步從0.402再放大到0.4638。 */
  var PRODUCT_BASE_HPCT   = 0.4638; // 2026-08再調整：跟著舞台再放大的倍率(1.1538)同步從0.402放大到0.4638，維持商品相對舞台的比例不變。

  /* 三個商品的實際位置，跟畫面上的視覺位置一一對應，之後想調整「左邊那格」
     實際要放哪裡，就改 LEFT 這組數字，不用去猜到底是改product1還是product3。
     2026-08 調整：
     1) hPct（商品第一次上傳時的預設高度比例）整體放大約28%——使用者反映
        商品廣播到1200畫布時看起來太小，這三個數字只影響「第一次上傳還沒有
        savedTransform」時的初始大小，使用者自己在1200畫布裡拖角縮放過的
        結果不受影響（見shadow-layout-receiver.js的upsertSlot()）。
     2) xPct整體往左平移0.08——原本CENTER在0.58，明顯偏畫布右側，使用者
        反映「中間商品請在畫布中間」，把CENTER改成剛好0.5(畫布正中央)，
        LEFT/RIGHT跟著整組平移同一個量(-0.08)，維持三者原本的相對間距不變。 */
  var PRODUCT_POS_CENTER = { xPct: 0.5,  yPct: 0.55, hPct: PRODUCT_BASE_HPCT }; // 三個裡最大、最主要，剛好在畫布正中央。2026-08再調整：上次只往上移30px使用者反映幾乎沒感覺、還是比右邊商品低，這次直接大幅往上調(yPct 0.716667→0.55)，確保明顯比商品3(右，yPct 0.64)高。
  var PRODUCT_POS_RIGHT  = { xPct: 0.78, yPct: 0.64, hPct: PRODUCT_BASE_HPCT }; // 2026-08再調整：再往上一點（原本0.62還是偏低），跟左/中兩個的底部差距拉大一些。2026-08再調整：往右10px(xPct 0.72→0.728333)、往下10px(yPct 0.631667→0.64)，錨點依然是底部置中，不是換算法。2026-08再調整：再往右一點(xPct 0.728333→0.78)，跟人物1(headXPct改成0.20，往左移)拉開更多距離。
  var PRODUCT_POS_LEFT   = { xPct: 0.26, yPct: 0.741667, hPct: PRODUCT_BASE_HPCT };

  window.ShadowLayoutDefaults = {

    // 內部代號'A'＝Circle介面顯示「A組合(2人)」
    A: {
      '人物1': { headWidthPct: HEAD_WIDTH_PCT * HOST1_SCALE, headXPct: CENTER_A + HEAD_DISTANCE_PCT/2, headYPct: HEAD_Y_PCT },
      '人物2': { headWidthPct: HEAD_WIDTH_PCT,                headXPct: CENTER_A - HEAD_DISTANCE_PCT/2, headYPct: HEAD_Y_PCT }
    },

    /* 內部代號'C'＝Circle介面顯示「B組合(1人+2品)」。
       工單的組合矩陣裡，B組合用的是 人物1 + 商品2(中) + 商品3(右)
       （不含商品1(左)），照工單實際勾選的槽位給預設位置。
       2026-08(蝦皮流行穿搭案)：headXPct從0.31往左移到0.20——使用者反映
       人物會跟中間商品(xPct=0.5)重疊，往左多留一點距離。 */
    C: {
      '人物1': { headWidthPct: 0.17, headXPct: 0.20, headYPct: HEAD_Y_PCT },
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

    _fallback: {
      '人物1': { headWidthPct: HEAD_WIDTH_PCT * HOST1_SCALE, headXPct: 0.36 + HEAD_DISTANCE_PCT/2, headYPct: HEAD_Y_PCT },
      '人物2': { headWidthPct: HEAD_WIDTH_PCT, headXPct: 0.36 - HEAD_DISTANCE_PCT/2, headYPct: HEAD_Y_PCT },
      '商品1(左)': PRODUCT_POS_LEFT,
      '商品2(中)': PRODUCT_POS_CENTER,
      '商品3(右)': PRODUCT_POS_RIGHT
    }
  };

  /* Circle介面顯示用的組合清單：value是「內部真正傳給receiver的字母」，
     label是「使用者在下拉選單看到的文字」，跟Excel工單「曝品」欄位選單的
     文字要完全一致（editor-import.js的comboLabelToLetter()靠這個反查字母）。 */
  window.CIRCLE_COMBO_UI = [
    { value:'A', label:'A組合(2人)' },
    { value:'C', label:'B組合(1人+2品)' },
    { value:'D', label:'C組合(3品)' }
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
    /* C(內部代號，Circle介面顯示「B組合(1人+2品)」)：2026-08調整(蝦皮流行
       穿搭案)——人物改成排最後面＝最前景，商品2(中)/商品3(右)排在人物
       前面(較後方圖層)。原本是人物排最前面(最底層)，使用者反映想要人物
       在最前面、商品在人物後面，所以整個反過來。 */
    C: ['商品2(中)','商品3(右)','人物1'],
    D: ['商品2(中)','商品1(左)','商品3(右)']
  };

})();
