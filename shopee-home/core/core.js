'use strict';
/*
  core.js —— 調度核心
  ------------------------------------------------------------
  這支檔案「不知道」LPBN長什麼樣、不知道A組合是2人還是3品，
  它只做三件事：
    1. 讀 layout config（configs/layouts/xxx.json）：這個版位多大、疊哪幾層
    2. 讀 combo config（configs/combos/xxx.json）：這次組合要開哪些槽位
    3. 依序呼叫每一層對應的 Module.draw()，把畫布交給它畫

  新增版位 = 加一份 layout config，不用改這支檔案。
  新增專案 = 加一份新的 combo config，不用改這支檔案。
  新增畫圖能力 = 加一個 Module，在這支檔案裡登記模組名稱對應關係即可。
*/
var Core = (function(){

  var _configCache = {}; // 避免同一份json重複fetch

  function fetchJSON(path){
    if(_configCache[path]) return Promise.resolve(_configCache[path]);
    return fetch(path).then(function(r){
      if(!r.ok) throw new Error('讀取設定檔失敗: '+path);
      return r.json();
    }).then(function(json){
      _configCache[path] = json;
      return json;
    });
  }

  /* 載入一個版位需要的全部設定（layout本身 + combo矩陣 + 位置檔） */
  function loadLayout(layoutConfigPath){
    return fetchJSON(layoutConfigPath).then(function(layoutConfig){
      var comboP    = layoutConfig.comboFile     ? fetchJSON(layoutConfig.comboFile)     : Promise.resolve(null);
      var positionsP= layoutConfig.positionsFile ? fetchJSON(layoutConfig.positionsFile) : Promise.resolve(null);
      return Promise.all([comboP, positionsP]).then(function(res){
        return {
          layoutConfig: layoutConfig,
          comboMatrix: res[0],
          positions: res[1]
        };
      });
    });
  }

  /* 深層合併「使用者手動拖曳調整過的位置」蓋在Config的預設位置上面。
     override 結構跟 positions.json 的 logo/slots 部分同形狀，只是可能只填了
     其中幾個欄位。這支函式只有 Core 在用，Module完全不知道override這件事存在——
     Module 拿到的 layoutMeta.positions 看起來就是「最終定案」的位置資料。 */
  function mergePositions(basePositions, override){
    if(!override) return basePositions;
    var merged = JSON.parse(JSON.stringify(basePositions || {}));
    if(override.assets){
      merged.assets = merged.assets || {};
      Object.keys(override.assets).forEach(function(key){
        merged.assets[key] = Object.assign({}, merged.assets[key], override.assets[key]);
      });
    }
    if(override.slots){
      merged.slots = merged.slots || {};
      Object.keys(override.slots).forEach(function(combo){
        merged.slots[combo] = merged.slots[combo] || {};
        Object.keys(override.slots[combo]).forEach(function(slotId){
          merged.slots[combo][slotId] = Object.assign({}, merged.slots[combo][slotId], override.slots[combo][slotId]);
        });
      });
    }
    return merged;
  }

  /* 把一個版位畫到指定的 canvas 上
     bundle   = loadLayout() 回傳的物件
     state    = 目前的使用者輸入資料（S 全域物件）
     layoutId = 這個版位的id，用來查有沒有使用者手動調整過的位置覆蓋資料，
                也給background-module.js拿去找 backgrounds/{layoutId}.jpg */
  function render(canvasEl, bundle, state, layoutId){
    var cfg = bundle.layoutConfig;
    canvasEl.width  = cfg.canvas.w;
    canvasEl.height = cfg.canvas.h;
    var ctx = canvasEl.getContext('2d');
    ctx.clearRect(0,0,canvasEl.width,canvasEl.height);

    var override = layoutId && state.positionOverrides ? state.positionOverrides[layoutId] : null;

    var layoutMeta = {
      canvas: cfg.canvas,
      layoutId: layoutId,
      comboMatrix: bundle.comboMatrix ? bundle.comboMatrix.combos : null,
      positions: mergePositions(bundle.positions, override)
    };

    (cfg.layers||[]).forEach(function(layer){
      var mod = window.Modules && window.Modules[layer.module];
      if(!mod || typeof mod.draw !== 'function'){
        console.warn('[Core] 找不到模組: '+layer.module+'，略過這一層');
        return;
      }
      try{
        mod.draw(ctx, layer, state, layoutMeta);
      }catch(e){
        console.error('[Core] 模組繪製失敗: '+layer.module, e);
      }
    });
  }

  /* 掃描圖片，算出「有色（不透明）部分」佔原圖的比例範圍 {tx,ty,tw,th}（0~1）。
     跟shadow-layout-receiver.js裡面那份完全一樣的演算法（縮到最長邊200px再逐像素
     掃alpha），這裡另外放一份給「作圖區自動貼合」（見下面calcArtZoneFit）用——
     兩邊各自獨立、不共用同一份程式碼是刻意的：shadow-layout-receiver.js是
     1200畫布陰影合成用的內部模組，不對外export，這裡不想為了共用硬拉一個檔案
     間的依賴關係，重複這一小段掃描邏輯比較單純。
     結果會快取在img物件上（img.__tightBoundsCache），同一張圖片物件不會
     重複掃描（renderAll()很頻繁，這個計算不便宜，快取很重要）。 */
  function calcTightBoundsRatio(img){
    if(!img) return null;
    if(img.__tightBoundsCache !== undefined) return img.__tightBoundsCache;
    var result = null;
    try{
      var SCAN = 200;
      var sc = Math.min(1, SCAN / Math.max(img.naturalWidth, img.naturalHeight));
      var sw = Math.max(1, Math.floor(img.naturalWidth * sc));
      var sh = Math.max(1, Math.floor(img.naturalHeight * sc));
      var tmp = document.createElement('canvas');
      tmp.width = sw; tmp.height = sh;
      var tctx = tmp.getContext('2d');
      tctx.clearRect(0,0,sw,sh);
      tctx.drawImage(img, 0, 0, sw, sh);
      var d = tctx.getImageData(0,0,sw,sh).data;
      var x0=sw, y0=sh, x1=0, y1=0, found=false;
      var alphaThresh = 10;
      for (var y=0; y<sh; y++){
        for (var x=0; x<sw; x++){
          if (d[(y*sw+x)*4+3] > alphaThresh){
            if (x<x0) x0=x; if (x>x1) x1=x;
            if (y<y0) y0=y; if (y>y1) y1=y;
            found = true;
          }
        }
      }
      if(found) result = { tx: x0/sw, ty: y0/sh, tw: (x1-x0+1)/sw, th: (y1-y0+1)/sh };
    }catch(e){
      console.warn('[Core] 無法偵測透明留白，作圖區貼合改用整張圖範圍', e);
    }
    img.__tightBoundsCache = result;
    return result;
  }

  /* 「作圖區自動貼合」：給定一個artZone設定({xPct(中心x)/topPct/wPct/hPct/enlarge}，
     全部是相對畫布寬高的比例)跟畫布尺寸，算出這張圖要縮放多少、擺在哪裡，
     才會是「有色部分（實際主體，不含圖片本身的透明留白）填滿作圖區，再放大
     enlarge倍」，水平置中、有色範圍頂部對齊作圖區頂部（頭部/最上緣不被裁切）。
     2026-08：改回頂部對齊（一度改成底部對齊，是因為當時1200畫布只有商品本身，
     沒有固定的舞台背景，不同商品留白比例不同、底部對齊才不會讓墩座忽高忽低。
     現在1200畫布改成把固定的舞台圖(logos/stage-cylinder.png)也一起合成進去，
     整張合成圖的「有效範圍」由舞台這個固定形狀主導，不再需要靠底部對齊來
     穩住墩座位置，所以改回原本比較單純的頂部對齊，下方多出來的部分可以
     超出作圖區也沒關係（本來就會被裁掉或蓋在CTA/遮罩下面）。
     回傳的xPct是「中心點」（要配合align:'center'使用，跟logo-module.js的
     align==='center'邏輯一致），yPct是圖片最終要畫上去的『左上角』y（不是中心）。
     邏輯跟你另一份pet-frenzy專案的 initHostPos()（layouts/02_lpbn.html等）
     幾乎一模一樣，只是那邊是寫在各版位頁面自己的js裡、這邊集中放在core.js
     給所有版位共用。 */
  function calcArtZoneFit(img, zone, canvasW, canvasH){
    var tight = calcTightBoundsRatio(img);
    var tightWpx, tightHpx, tightLeftPx, tightTopPx;
    if(tight){
      tightWpx = tight.tw * img.naturalWidth;
      tightHpx = tight.th * img.naturalHeight;
      tightLeftPx = tight.tx * img.naturalWidth;
      tightTopPx = tight.ty * img.naturalHeight;
    } else {
      tightWpx = img.naturalWidth; tightHpx = img.naturalHeight; tightLeftPx = 0; tightTopPx = 0;
    }
    var zoneCx = zone.xPct * canvasW;
    var zoneTop = zone.topPct * canvasH;
    var zoneW = zone.wPct * canvasW;
    var zoneH = zone.hPct * canvasH;
    var enlarge = zone.enlarge || 1;

    var scale = Math.min(zoneW/tightWpx, zoneH/tightHpx) * enlarge;
    var boxH = img.naturalHeight * scale;
    var boxW = img.naturalWidth * scale;
    var hPct = boxH / canvasH;

    var tightCenterXAtScale = (tightLeftPx + tightWpx/2) * scale;
    var imgLeft = zoneCx - tightCenterXAtScale;
    var xPctCenter = (imgLeft + boxW/2) / canvasW;

    var tightTopAtScale = tightTopPx * scale;
    var imgTop = zoneTop - tightTopAtScale;
    var yPct = imgTop / canvasH;

    return { xPct: xPctCenter, yPct: yPct, hPct: hPct, align: 'center' };
  }

  return { loadLayout: loadLayout, render: render, fetchJSON: fetchJSON, mergePositions: mergePositions,
    calcTightBoundsRatio: calcTightBoundsRatio, calcArtZoneFit: calcArtZoneFit };
})();
