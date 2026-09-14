外廣(waiguang)背景圖放法 —— 跟站內(backgrounds/A、backgrounds/B)分開放
================================================================

站內是「同一個版位切紅版/藍版」，背景圖放 backgrounds/A/、backgrounds/B/。

外廣的版型顏色(紅/藍)是跟著「大項」固定的，不是使用者切換的選項，同一個
尺寸(例如600x1200)在不同大項底下也需要完全不同的背景美術，所以規則改成
「先分大項、再分尺寸」，全部收在這個waiguang資料夾底下，不會跟站內的
backgrounds/A、backgrounds/B混在一起：

  backgrounds/waiguang/{大項資料夾}/{尺寸}.jpg（或.png）

例如：
  backgrounds/waiguang/01_LINE_LAP_無低消/600x1200.jpg
  backgrounds/waiguang/01_LINE_LAP/600x1200.jpg
  backgrounds/waiguang/03_Appier_維穩/600x1200.jpg
  backgrounds/waiguang/04_Facebook/1080x1080.jpg

目前6個大項的資料夾都先建好、都是空的，等站外功能真的接上匯入流程、
畫布邏輯知道要去哪裡找圖之後，放上美術檔就會自動套用，不用改程式。
