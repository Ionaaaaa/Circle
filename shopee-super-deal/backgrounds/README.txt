蝦皮超划算 —— 背景圖檔案架構
------------------------------------------------------------
沿用 modules/background-module.js 現成的查找邏輯，完全不用改程式碼，
把正式美術圖依下面的檔名放進對應資料夾就會自動生效。

資料夾 = 顏色版本：
  A/  ＝ 紅版
  B/  ＝ 藍版

每個資料夾裡要放這幾張（.jpg 找不到會自動試 .png；兩個都沒有會退回
純色+漸層，不會破圖，可以先只做完一部分慢慢補）：

  kv_coupon.jpg      KV主視覺・券樣版背景
  kv_product.jpg     KV主視覺・商品版背景（3品同框那張）
  skinny_app.jpg     Skinny BN APP・商品版背景（1品獨立輸出，3張共用同一張背景）
  skinny_pc.jpg      Skinny BN PC・商品版背景（同上，PC尺寸另外一張）
  _shadow_compose.jpg 陰影編輯popup裡1200畫布的背景——這張通常可以直接
                       複製kv_product.jpg頂著用（同一張構圖），讓使用者在
                       調整商品/陰影/小標的當下，就已經接近KV最終畫面的
                       背景效果，不用等匯出才看得到

券樣版（kv_coupon）不需要 skinny 對應版本——前面規格確認過 Skinny BN
只有商品版，不拆券樣。

顏色/樣式的分類邏輯：
  顏色(紅/藍) × 樣式/版位(KV券樣／KV商品／Skinny APP／Skinny PC)
  → 2 × 4 = 8 張背景圖，見下表：

    A(紅)/kv_coupon.jpg     A(紅)/kv_product.jpg
    A(紅)/skinny_app.jpg    A(紅)/skinny_pc.jpg
    B(藍)/kv_coupon.jpg     B(藍)/kv_product.jpg
    B(藍)/skinny_app.jpg    B(藍)/skinny_pc.jpg

  （+ 各色一張 _shadow_compose，共10個檔案位置，但後者可以直接複製
    kv_product那張，不算獨立的美術工作量）

上一個「蝦皮媽咪會員日」案子的舊背景圖搬到
backgrounds/_archive-mommy-member-day/ 保留備份，不會被目前的程式讀取到
（現在的layoutId命名跟舊案子完全不同，不會誤讀到舊圖）。

配套的LAYOUT_REGISTRY（js/editor-state.js）目前還是舊案子的版位清單
(11_lpbn_app/12_lpbn_pc/03_c2c_bn...)，還沒有改成這裡列的kv_coupon/
kv_product/skinny_app/skinny_pc——這是下一步要做的事，registry改完
這幾個layoutId才會真的在編輯器裡出現分頁可以編輯，光是資料夾架構本身
不會讓畫面自動長出新分頁。
