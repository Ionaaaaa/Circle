這個資料夾放兩個固定預設LOGO檔案，檔名要完全對應：

  logo_shopee_live.png   → LOGO1 的預設值（照pet-frenzy的做法，固定用蝦皮直播
                            這個brand logo，這是「大部分工單都一樣、少數才會換」
                            的那個，所以給它一個固定預設檔，編輯器一開啟就自動
                            套用，不用每次工單都手動傳一次）

  logo2-default.png      → LOGO2 的預設值（品牌LOGO，選填）

  ar-activity-logo.png   → AR版位「活動方形LOGO」專屬素材（見modules/ar-module.js
                            的_getArActivityLogoImg()）。2026-08(蝦皮流行穿搭案)：
                            原本AR的活動LOGO是直接沿用LOGO1，使用者反映AR這個
                            100x100小方塊要用的是另一張專屬圖(跟LOGO1不是同一張)，
                            所以獨立出這個檔案，不跟著LOGO1的上傳內容變動。這個
                            檔案目前還沒有放實際圖片，補上去之前AR活動LOGO畫面上
                            會顯示虛線佔位框(不會報錯)。

三個都是「固定內建值」，不是使用者每次工單都要重新上傳的東西：
  - logo_shopee_live.png/logo2-default.png是「預設值」，匯入工單時如果素材
    資料夾裡有比對到對應的檔案（LOGO1會比對logo1、蝦皮直播、shopee_live這幾個
    關鍵字；LOGO2會比對logo2、品牌logo、活動logo），會直接蓋掉預設值；使用者
    在右側控制面板手動上傳，也會蓋掉預設值
  - ar-activity-logo.png是「固定值」，不會被工單匯入或使用者上傳蓋掉，AR的
    活動LOGO版本永遠讀這個檔案（想換掉的話直接換掉這個檔案本身即可）
  - 沒有放這些檔案也完全沒問題，畫面只是顯示LOGO的佔位框，不會報錯
