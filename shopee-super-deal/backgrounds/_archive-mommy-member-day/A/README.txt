A版背景圖放這裡，檔名對應版位id，例如：
  03_c2c_bn.jpg／08_coin_bn.jpg／11_lpbn_app.jpg／12_lpbn_pc.jpg...
（跟configs/layouts/裡的layout id一致，.jpg或.png都可以）

目前這個資料夾故意留空：A版沿用專案原本backgrounds/資料夾下（上一層）
的既有背景圖當作A版預設值，程式會自動照順序找（見modules/background-
module.js）：
  1. backgrounds/A/{id}.jpg or .png（這個資料夾，優先）
  2. backgrounds/{id}.jpg or .png（上一層，共用/舊圖）
  3. 都沒有 → 純色填滿
如果之後A版也要換成專屬的新背景圖，直接把檔案放進這個資料夾即可，
不用動任何程式。
