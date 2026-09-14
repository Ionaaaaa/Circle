MSBN家族(公版一~八)＋副區(subzone_app/subzone_pc)的背景圖放這裡，跟其他
版位分開（不跟backgrounds/那層混在一起）。

2026-08(KRCB)：改成依「版本」分資料夾，規則跟backgrounds/README.txt一樣：

  A/
    07_msbn.jpg       ← 公版一
    07_msbn_v2.jpg    ← 公版二
    07_msbn_v3.jpg    ← 公版三
    07_msbn_v4.jpg    ← 公版四
    07_msbn_v5.jpg    ← 公版五
    07_msbn_v6.jpg    ← 公版六
    07_msbn_v7.jpg    ← 公版七
    07_msbn_v8.jpg    ← 公版八
    subzone_app.jpg   ← 副區(APP)
    subzone_pc.jpg    ← 副區(PC)
  B/
    （之後整批要換一批新素材時，複製一份A/改名B/、換掉裡面的圖即可）

版本是整個專案共用一個(見backgrounds/README.txt的說明)，不是MSBN自己
獨立選——MSBN切到哪個版本，永遠跟main分頁的HBN/DD/LPBN...一致。

.jpg找不到會自動試.png；某個版本資料夾裡缺某個版位的圖，會退回試沒有
版本資料夾的舊路徑backgrounds/msbn/{檔名}.jpg（相容用）；都沒有的話，
會自動退回對應positions.json裡bgColor那個純色(目前是#D9D8D1)，不會報錯、
也不會顯示破圖——目前公版一/公版二的圖檔還沒放，就是吃這個純色退回，
是正常狀態，不是漏放檔案。

圖片會用「等比例裁切鋪滿整個畫布」的方式顯示，不會被拉伸變形，跟CSS的
object-fit:cover效果一樣。放這張圖不會影響ICON/商品/文字欄位的畫法——
那些都是另外用canvas畫的，不受這張背景圖影響，兩者疊在一起顯示。
