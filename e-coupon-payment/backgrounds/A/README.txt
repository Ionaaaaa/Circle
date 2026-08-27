A版背景圖放這裡，檔名對應版位id，例如：
  03_c2c_bn.jpg／08_coin_bn.jpg／11_lpbn_app.jpg／12_lpbn_pc.jpg...
（跟configs/layouts/裡的layout id完全一致、區分大小寫，.jpg或.png都可以）

程式會自動照順序找（見modules/background-module.js）：
  1. backgrounds/A/{id}.jpg or .png（這個資料夾，優先）
  2. backgrounds/{id}.jpg or .png（上一層，共用/舊圖，沒有版本專屬圖時墊著用）
  3. 都沒有 → 純色填滿

另外「商品/主持人陰影合成」彈窗的1200×1200背景圖也支援A/B版本化，
檔名固定是 _shadow_compose.jpg（或.png），一樣放這個資料夾（見
js/shadow-system/shadow-popup.js），跟其他版位背景圖用同一套規則。
