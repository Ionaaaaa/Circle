'use strict';
/* mask-module.js —— 主持人身體太短、貼不到版位最底部時，用來補在最底部
   的裝飾色塊。概念跟參考專案的 js/mask-defaults.js + drawMaskLayer() 一樣
   （左右貼齊畫布邊緣、頂部邊緣中間凹一個弧形），但這裡簡化很多：
     - 純色（#113366），不做橢圓放射狀漸層/glow
     - 沒有fade淡化功能
     - 沒有S.maskOn開關——LPBN_APP/PC這兩個版位永遠顯示，不用切換
   畫的時機（見layer設定）在host(商品/主持人)之後、文字之前，蓋在
   商品/主持人上面，不會蓋到文字。

   凹陷形狀：用二次貝茲曲線，跟參考檔同一種算法——中間的控制點比左右
   兩側邊緣的高度再往下(dip)這麼多px，實際視覺凹陷深度大約是dip的一半。

   陰影：直接用canvas原生的shadowBlur/shadowOffsetY，畫這個形狀的時候
   自動沿著形狀輪廓（包含凹下去的弧形）產生一圈柔和模糊的陰影，不用另外
   算路徑——陰影只會出現在形狀外面(往上那一小段)，形狀本身還是純色鋪滿，
   不會被自己的陰影影響。 */
window.Modules = window.Modules || {};

/* 每個版位的參數：
     height    右側／預設邊緣的高度（從畫布底部往上量）
     leftDrop  左側邊緣比右側再往下多少px，做出「左低右高」的斜面——
               不填或0時左右一樣高（原本的對稱凹陷）；填了之後左側實際
               高度＝height - leftDrop（例如height:91、leftDrop:89，
               左側就只剩2px高，幾乎貼平）
     dip       在「左低右高」的斜面基礎上，額外再讓某個位置往下凹一點的
               幅度（視覺凹陷深度大約是這個數字的一半）；設0就是單純一條
               平滑的左低右高斜面、沒有額外凹陷
     dipX      「最凹的點」要落在畫布水平方向的哪個位置，0～1之間的比例
               （0＝最左邊、0.5＝正中間、1＝最右邊）。不填預設0.5(正中間)。
               這個數字對應到貝茲曲線控制點的x座標，不是最凹點本身100%
               精確的x位置（貝茲曲線的實際極值點會因為左右兩端高度不同而
               有些微偏移），但拿來调「大概想要凹在哪一段」很好用、直覺。

   ── 依版位分開設定 ──
   LPBN_PC(12_lpbn_pc)的畫布本來就比LPBN_APP(11_lpbn_app)矮(400 vs 550)，
   使用者反映PC版遮罩太高會擋到太多內容，所以PC版的height/leftDrop都
   照比例縮小一點，dipX(最凹的位置)維持跟APP一樣的比例。找不到對應
   layoutId的版位（例如以後新增其他版位也套用這個mask模組）會退回用
   _default這組。
   ★2026-08新增：遮罩顏色改成優先看configs/theme.json目前作用中版本
   (A~H)的mask這個key（例如E版填'#ffd074'）——同一個版本(不管LPBN_APP還是
   LPBN_PC)遮罩顏色要一致，所以放在theme.json而不是這裡的MASK_CONFIG(這裡
   是照layoutId分、不是照版本分)。theme.json那個版本沒填mask的話，才會
   退回用下面這裡各自layoutId寫死的color（例如目前A~D、F~H都還沒填，
   會維持這裡的'#f7dfb8'）。
   ★2026-08修正：05_ddcard(DD Card)的遮罩數字原本是我猜測換算的，使用者
   提供另一個專案(fashion-style)裡實際做過的版本，形狀規則其實跟LPBN不
   一樣——leftDrop:0(左右兩側同高，不是LPBN那種左低右高的斜面)、
   dipX:0.5(最凹的位置在正中間，不是偏右0.83)，是單純「中間往下凹、
   左右對稱」的形狀，照實際案例的數字改過來。 */
var MASK_CONFIG = {
  _default:     { height: 91, leftDrop: 89, dip: 60, dipX: 0.83, color: '#f7dfb8' },
  '11_lpbn_app':{ height: 91, leftDrop: 89, dip: 60, dipX: 0.83, color: '#f7dfb8' },
  '12_lpbn_pc': { height: 65, leftDrop: 63, dip: 40, dipX: 0.83, color: '#f7dfb8' },
  '05_ddcard':  { height: 127, leftDrop: 0, dip: 81, dipX: 0.5, color: '#f7dfb8' }
};

window.Modules.mask = {
  draw: function(ctx, layer, state, layoutMeta){
    var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h;
    var cfg = layer.maskConfig || MASK_CONFIG[layoutMeta.layoutId] ||
      MASK_CONFIG[(window.LAYOUT_ALIAS_BASE && window.LAYOUT_ALIAS_BASE[layoutMeta.layoutId])] ||
      MASK_CONFIG[(window.LAYOUT_ASSET_FALLBACK && window.LAYOUT_ASSET_FALLBACK[layoutMeta.layoutId])] ||
      MASK_CONFIG._default;

    var shapeLeft = 0, shapeRight = w;
    var top = h - cfg.height;              // 右側（高的那一邊）頂部y座標
    var leftTop = top + (cfg.leftDrop||0);  // 左側頂部y座標，往下(cfg.leftDrop)px
    var dip = cfg.dip || 0;
    var dipXFrac = (cfg.dipX !== undefined) ? cfg.dipX : 0.5;
    var dipCx = shapeLeft + (shapeRight - shapeLeft) * dipXFrac;
    // 控制點y：沿著左右兩端高度的連線，在dipXFrac那個水平位置對應的高度，再加上dip往下凹
    var lerpY = leftTop + (top - leftTop) * dipXFrac;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(shapeLeft, leftTop);
    ctx.quadraticCurveTo(dipCx, lerpY + dip, shapeRight, top);
    ctx.lineTo(shapeRight, h);
    ctx.lineTo(shapeLeft, h);
    ctx.closePath();

    /* 柔和模糊陰影：沿著上面這個形狀（含左低右高的斜面/凹陷弧形）的外緣
       自動產生，往上模糊過渡，像照片邊緣自然接到色塊，不是一條死板的
       硬邊線。2026-08調整：再模糊一點、再淡一點（blur 5→10、
       透明度0.4→0.22）——原本的設定使用者反映太明顯，尤其是左側很矮
       (leftDrop)那一段，重的陰影看起來像多了一條線，調柔和/調淡之後
       在矮的地方也會自然跟著變得幾乎看不出來，不用另外特別處理左側。 */
    ctx.shadowColor = 'rgba(7,10,43,0.35)'; // #070a2b，不透明度0.22調深到0.35
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 1;

    /* 遮罩顏色決定順序：
       1. theme.json這個版本明確填的mask（例如E版'#ffd074'，刻意要跟
          該版本自己的arBg不一樣時才需要填這個）
       2. 沒填mask的話，跟著這個版本的arBg走——arBg是每個版本本來就有的
          「柔和底色」欄位(AR/DPS也共用這個)，用它當遮罩預設色，才能讓
          B~H版遮罩自動貼合各自的版本配色，不會維持只適合A版的寫死顏色
          （這是2026-08才發現的既有缺口：mask-module.js原本不分版本，
          全部都用MASK_CONFIG裡寫死的'#f7dfb8'，那其實是A版的顏色）
       3. 上面兩個都沒有(theme.json還沒載入完成等異常情況)，才退回這裡
          MASK_CONFIG各layoutId寫死的color當最後保底。 */
    ctx.fillStyle = (window.Theme && window.Theme.mask) || (window.Theme && window.Theme.arBg) || cfg.color;
    ctx.fill();
    ctx.restore();
  }
};
