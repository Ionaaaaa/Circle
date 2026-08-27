MSBN 專用的背景圖放這裡，跟其他版位分開（不跟 backgrounds/ 那層混在一起）。

檔名規則：對應「版型」的 layoutId，不是對應每一個版本編號（MSBN1、MSBN2...
是同一個版型的不同內容，共用同一張背景圖）：

  07_msbn.jpg     ← 公版一（目前唯一的版型）
  07_msbn_v2.jpg  ← 之後如果做公版二，對應 configs/layouts/msbn/07_msbn_v2.json

.jpg 找不到會自動試 .png；兩個都沒有的話，會自動退回
configs/layouts/msbn/07_msbn-positions.json 裡 bgColor 那個純色
（目前是 #D9D8D1），不會報錯、也不會顯示破圖——現在資料夾是空的，
就是吃這個純色退回，這是正常狀態，不是漏放檔案。

圖片會用「等比例裁切鋪滿整個畫布」(1200x150) 的方式顯示，不會被拉伸變形，
跟 CSS 的 object-fit:cover 效果一樣。

放這張圖不會影響三個 LOGO 卡片的畫法——卡片本身(白底+咖啡色圓角框)跟
LOGO 都是另外用 canvas 畫的，不受這張背景圖影響，兩者疊在一起顯示。
