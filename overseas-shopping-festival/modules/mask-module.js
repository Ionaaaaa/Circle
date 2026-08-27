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
   _default這組。 */
var MASK_CONFIG = {
  _default:     { height: 91, leftDrop: 89, dip: 60, dipX: 0.83, color: '#f7bac9' },
  '11_lpbn_app':{ height: 91, leftDrop: 89, dip: 60, dipX: 0.83, color: '#f7bac9' },
  '12_lpbn_pc': { height: 65, leftDrop: 63, dip: 40, dipX: 0.83, color: '#f7bac9' },
  /* IG／DD Card：形狀跟LPBN不一樣——leftDrop:0(左右兩側同高，不是LPBN那種
     左低右高的斜面)、dipX:0.5(最凹的位置在正中間，不是偏右0.83)，單純
     「中間往下凹、左右對稱」的形狀。height/dip數字是依使用者提供的CSS
     (背景色矩形寬高)換算：IG畫布900x1600，CSS給的遮罩區塊是900*202
     (寬度剛好等於整個畫布寬，height/canvasH≈0.126)；DD Card畫布531x792，
     CSS給的遮罩區塊534*127(寬度跟畫布寬度531很接近，只是設計稿量測誤差，
     height/canvasH≈0.16)。dip(額外下凹幅度)沒有在CSS裡(CSS只是純矩形，
     沒有描述弧形細節)，比照LPBN「dip≈height*0.64」的既有比例抓出來，
     維持整體遮罩家族視覺一致。 */
  '04_ig':      { height: 202, leftDrop: 0, dip: 129, dipX: 0.5, color: '#f7bac9' },
  '05_ddcard':  { height: 127, leftDrop: 0, dip: 81, dipX: 0.5, color: '#f7bac9' }
};

window.Modules.mask = {
  draw: function(ctx, layer, state, layoutMeta){
    var w = layoutMeta.canvas.w, h = layoutMeta.canvas.h;
    var cfg = layer.maskConfig || MASK_CONFIG[layoutMeta.layoutId] || MASK_CONFIG[(window.LAYOUT_ALIAS_BASE && window.LAYOUT_ALIAS_BASE[layoutMeta.layoutId])] || MASK_CONFIG._default;

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

    ctx.fillStyle = cfg.color;
    ctx.fill();
    ctx.restore();
  }
};
