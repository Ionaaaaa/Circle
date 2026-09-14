背景圖依「版本」分資料夾放，每個版本一個資料夾，資料夾裡的檔名對應版位
編號，全部平放同一層(不用再分子資料夾)：

  A/
    11_lpbn_app.jpg
    12_lpbn_pc.jpg
    03_c2c_bn.jpg
    04_ig.jpg
    05_ddcard.jpg
    08_coin_bn.jpg
    10_game_bn.png
    08_popup.png
    AR.jpg
  B/
    （之後整批要換一批新素材時，複製一份A/改名B/、換掉裡面的圖即可）

版本是「整個專案共用一個」，不是每個版位各自獨立——目前顯示哪個版本，
是js/editor-state.js的PROJECT_BG_VERSION這個全域設定決定的，HBN/DD/
LPBN...全部版位永遠是同一個版本，不會有「這個版位切到B版但那個版位還是
A版」的情況。

.jpg找不到會自動試.png；某個版本資料夾裡缺某個版位的圖，會退回試沒有
版本資料夾的舊路徑backgrounds/{檔名}.jpg（相容用，正常使用不會用到）；
都沒有的版位會自動退回目前的純色+漸層畫法，不會報錯、也不會顯示破圖。
圖片會用「等比例裁切鋪滿整個畫布」的方式顯示（不會被拉伸變形，多出來的
部分會被裁掉），跟CSS的object-fit:cover效果一樣。

MSBN家族(公版一~八)＋副區的背景圖放在backgrounds/msbn/{版本}/底下，
規則相同，見backgrounds/msbn/README.txt。

_shadow_compose.jpg是另一個獨立用途(1200x1200商品/主持人陰影編輯畫布的
固定背景)，不屬於這套版本系統，維持原本平放在backgrounds/最上層，不用
搬進版本資料夾。
