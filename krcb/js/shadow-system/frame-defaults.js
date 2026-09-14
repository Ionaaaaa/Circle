/*
  frame-defaults.js
  拍立得框的可調參數。要換框圖檔案、或調整縮放上下限，改這裡的數字就好，
  不用去 shadow-frame-plugin.js 裡面找。

  ★ 2026-07-14：拿掉滑桿之後，rotRange／shiftFrac 這兩個參數不再需要
    （旋轉/位移現在是直接拖曳決定，沒有固定範圍限制），已移除。

  FRAME_URL   框圖路徑（透明中空的拍立得框 PNG，中心一定要是透明的，
              shadow-frame-plugin.js 是用「從中心洪水填充」找內窗，
              框中心如果不透明會直接噴錯誤訊息）
  scaleMin/Max 拖角縮放的上下限（1 = 剛好覆蓋滿內窗的 cover 基準大小）
  zIndex      彈窗的堆疊層級，預設拉很高蓋過既有 popup，通常不用改
*/
window.FrameDefaults = {
  /* 路徑比照你專案裡 color-theme-engine.js 引用 logo/CTA 圖的慣例
     （logos/logo_shopee_live.png、logos/cta_btn.png），一樣放在
     logos/ 這一層（跟 logo_shopee_live.png 同一層，不是 logos/logos/ 那個
     已經刪掉的殘留層）。檔名用純英文，避免中文檔名在 zip 跨平台解壓縮
     時可能亂碼/遺失。 */
  FRAME_URL: 'logos/polaroid-frame.png',
  scaleMin: 0.5,
  scaleMax: 3
};
