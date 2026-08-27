'use strict';
/*
  Shadow Module —— 人物/商品槽位
  ------------------------------------------------------------
  這支模組完全不知道「A組合是2人」「C組合是3品」這種事。
  它拿到的只有兩份資料：
    1. layoutMeta.comboMatrix[state.combo].slots
       → 這次的組合，哪些槽位是1（要開）、哪些是0（不開）
    2. layoutMeta.positions.slots[state.combo][槽位id]
       → 開的那些槽位，各自要畫在哪裡、多大
  兩份資料查完，交叉比對，逐一畫出來。組合矩陣本身放在
  configs/combos/*.json，位置數字放在 configs/layouts/*-positions.json，
  這支模組永遠不用因為「換了專案、組合定義不一樣」而修改。
*/
window.Modules = window.Modules || {};
window.Modules.shadow = {
  draw: function(ctx, layer, state, layoutMeta){
    var combo = state.combo;
    if(!combo || !layoutMeta.comboMatrix || !layoutMeta.comboMatrix[combo]) return;

    var slotsEnabled = layoutMeta.comboMatrix[combo].slots || {};
    var slotPositions = (layoutMeta.positions && layoutMeta.positions.slots && layoutMeta.positions.slots[combo]) || {};
    var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h;

    Object.keys(slotsEnabled).forEach(function(slotId){
      if(slotsEnabled[slotId] !== 1) return; /* 這個組合沒開這個槽位，跳過 */
      var pos = slotPositions[slotId];
      if(!pos){
        console.warn('[shadow-module] 組合'+combo+'的'+slotId+'缺少位置設定，略過');
        return;
      }
      var img = state.assets && state.assets[slotId];
      var boxH = pos.hPct * h;
      var anchorX = pos.xPct * w;
      var anchorY = pos.yPct * h;

      if(img instanceof HTMLImageElement && img.complete && img.naturalWidth){
        var ratio = img.naturalWidth / img.naturalHeight;
        var boxW = boxH * ratio;
        /* 錨點＝底部置中 */
        ctx.drawImage(img, anchorX - boxW/2, anchorY - boxH, boxW, boxH);
      } else {
        /* 還沒上傳這個槽位的圖，畫一個佔位框，讓使用者知道「這個組合下這裡該放什麼」 */
        var boxW2 = boxH * 0.75;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.setLineDash([5,5]);
        ctx.strokeRect(anchorX-boxW2/2, anchorY-boxH, boxW2, boxH);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(slotId, anchorX, anchorY-boxH/2);
        ctx.restore();
      }
    });
  }
};
