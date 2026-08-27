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

  /* 跟calcArtZoneFit()幾乎一樣（縮放倍率算法完全相同：一樣照這張圖實際
     有色範圍、取寬高比較吃緊的那個方向去算scale），唯一差異是「錨點」——
     calcArtZoneFit()是有色範圍「頂部」對齊zone頂部；這支是有色範圍「底部」
     對齊一個指定的目標底線(bottomTargetPx，例如遮罩最高點的位置)，
     不是zone本身的topPct+hPct。用在LPBN_APP/LPBN_PC這種「下面有底部遮罩，
     希望商品底部剛好貼齊遮罩最高點，不要被遮罩蓋到，但也不要留一大截
     空白」的情境——這樣商品大小還是照實際內容(不同商品組合貼出來的縮放
     倍率仍然會不一樣，這是使用者確認要保留的行為)，只有「貼在哪個高度」
     改成用固定的遮罩線去對齊，不再是頂部對齊。 */
  function calcArtZoneFitBottomAlign(img, zone, canvasW, canvasH, bottomTargetPx){
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
    var zoneW = zone.wPct * canvasW;
    var zoneTopPx = zone.topPct * canvasH;
    var enlarge = zone.enlarge || 1;
    var zoneBottomPx = (typeof bottomTargetPx === 'number') ? bottomTargetPx : (zone.topPct + zone.hPct) * canvasH;

    /* 2026-08修正：zoneH原本永遠用zone.hPct*canvasH算，沒有考慮
       bottomTargetPx可能比「zone原本設計的topPct+hPct」還要淺（例如
       蝦皮家居-寢具這個專案，商品要避開遮罩/CTA，bottomTargetPx故意設得
       比較高，不像蝦皮流行穿搭案那樣讓商品可以超出畫布）——這種情況下，
       商品實際可用的垂直空間是「zoneTopPx到bottomTargetPx」這一段，不是
       zone.hPct那麼高。繼續用zone.hPct去算scale的話，算出來的商品會比
       實際可用空間還高，即使有下面的clampFitTopToCanvas()把頂部拉回
       畫布內，也只是把「太高」的商品硬往下推，底部反而會超出
       bottomTargetPx這條線，等於白設定。
       改成優先用「zoneBottomPx - zoneTopPx」(可用空間的實際高度)算scale，
       沒有給bottomTargetPx時退回原本的zone.hPct*canvasH，行為完全不變
       ——只有「明確指定bottomTargetPx、而且這條線比zone原本的底部還淺」
       的情況才會改變計算結果，這正是蝦皮家居-寢具這幾個版位(HBN/DD Card/
       Coin Page/LPBN_APP/PC)現在的情況。 */
    var zoneH = (typeof bottomTargetPx === 'number')
      ? Math.max(1, zoneBottomPx - zoneTopPx)
      : zone.hPct * canvasH;

    var scale = Math.min(zoneW/tightWpx, zoneH/tightHpx) * enlarge;
    var boxH = img.naturalHeight * scale;
    var boxW = img.naturalWidth * scale;
    var hPct = boxH / canvasH;

    var tightCenterXAtScale = (tightLeftPx + tightWpx/2) * scale;
    var imgLeft = zoneCx - tightCenterXAtScale;
    var xPctCenter = (imgLeft + boxW/2) / canvasW;

    var tightBottomAtScale = (tightTopPx + tightHpx) * scale;
    var imgTop = zoneBottomPx - tightBottomAtScale; // 從底線往回推算「整張圖」(含透明留白)該擺在哪
    var yPct = imgTop / canvasH;

    return { xPct: xPctCenter, yPct: yPct, hPct: hPct, align: 'center' };
  }

  /* 「頂部對齊、底部不能超出畫布」的安全防呆——calcArtZoneFit()算出來的結果
     (再加上呼叫端可能疊加的downOffsetPx等後製位移)，理論上應該要落在畫布
     範圍內，但artZone本身的enlarge(刻意讓商品比作圖區本身再放大一點，蓋滿
     視覺)、加上downOffsetPx(整體再往下推)疊加起來，商品的「有色範圍」(去除
     透明留白，真正看得到的部分)底部有可能超出畫布下緣。

     這裡只調整「大小」，不調整「頂部位置」(fit.yPct完全不動)——維持頂部
     對齊的視覺意圖，單純把太大的部分等比例縮小，讓底部剛好貼齊畫布下緣，
     不會裁切或變形。已經在畫布範圍內的情況(沒超出)完全不受影響，直接
     原樣回傳，不會意外把原本設計好的正常尺寸也跟著縮小。 */
  function clampFitBottomToCanvas(fit, img, canvasH){
    if(!fit || !img) return fit;
    var tight = calcTightBoundsRatio(img);
    var boxH = fit.hPct * canvasH;
    var tightTopAtScale = tight ? tight.ty * boxH : 0;
    var tightHAtScale = tight ? tight.th * boxH : boxH;
    var visibleTopPx = fit.yPct * canvasH + tightTopAtScale;
    var visibleBottomPx = visibleTopPx + tightHAtScale;
    if(visibleBottomPx <= canvasH) return fit; // 沒超出，原樣回傳

    var availableTightH = canvasH - visibleTopPx; // 從目前可見內容頂部到畫布底部，剩下的可用高度
    if(availableTightH <= 0 || tightHAtScale <= 0) return fit; // 理論上不會發生的異常情況，放棄調整比硬算出詭異結果安全

    var shrinkRatio = availableTightH / tightHAtScale; // 一定 < 1
    return { xPct: fit.xPct, yPct: fit.yPct, hPct: fit.hPct * shrinkRatio, align: fit.align };
  }

  /* 「頂部不能超出畫布」的安全防呆——跟clampFitBottomToCanvas()是同一個概念，
     方向相反：clampFitBottomToCanvas調整「大小」讓底部不超出，這裡調整
     「位置」讓頂部不超出（不改大小，直接整個往下推一點點）。會用到這個
     的情境是downOffsetPx帶了很大的負值（例如「往上推遮罩高度」這種需求）
     結果把整個有色範圍推到畫布上緣以外——只在真的算出負值時才調整，
     沒超出的情況(正常情況)原樣回傳，不影響其他版位。 */
  function clampFitTopToCanvas(fit, img, canvasH){
    if(!fit || !img) return fit;
    var tight = calcTightBoundsRatio(img);
    var boxH = fit.hPct * canvasH;
    var tightTopAtScale = tight ? tight.ty * boxH : 0;
    var visibleTopPx = fit.yPct * canvasH + tightTopAtScale;
    if(visibleTopPx >= 0) return fit; // 沒超出，原樣回傳

    return { xPct: fit.xPct, yPct: fit.yPct - visibleTopPx/canvasH, hPct: fit.hPct, align: fit.align };
  }

  /* 「左右不能超出作圖區(artZone)」的安全防呆——2026-08新增，補上跟
     clampFitTopToCanvas()/clampFitBottomToCanvas()同等級的水平方向保護。
     背景：calcArtZoneFit()算出來的scale是「剛好貼合zone」(min(寬,高)兩個
     方向都不超過)，但外面疊上去的zone.enlarge會讓這個基準再放大，加上
     leftOffsetPx這種「貼合完再整體平移」的偏移，都可能讓有色範圍超出
     zone──而logo-module.js畫的時候是直接clip在這個zone的矩形上，超出的
     部分會被硬生生裁掉一小塊，商品看起來就像「被切到」，不是使用者要的
     效果（使用者要的是完整看到商品，不要有任何裁切）。

     2026-08訂正：第一版做法是「只縮小、縮小時保持目前(可能已經偏移過的)
     水平中心點不動」，這個做法有漏洞——如果超出的原因是leftOffsetPx這種
     位置平移（不是單純放太大），縮小後的box雖然寬度變小了，但中心點還是
     停在同一個偏移過的位置，還是可能貼著同一側的zone邊界外面，等於沒修好
     （已用多組不同商品長寬比實測驗證出這個漏洞）。
     改成分兩步驟，跟「把一個box塞進一個容器」的標準做法一致：
       ①「縮」：如果有色範圍寬度比zone寬度還大，等比例縮小到剛好等於
         zone寬度（維持長寬比，不變形）。
       ②「平移」：縮完（或本來就沒超過寬度）之後，如果左邊界還是超出
         zone左邊、或右邊界超出zone右邊，直接把整個box平移，讓它剛好卡在
         zone內側，不再只是「保持中心不變」。
     這樣不管超出的原因是放太大還是位置偏移，兩種情況都能保證修正後一定
     落在zone範圍內。已經在範圍內的情況(shrinkRatio===1且不用平移)完全
     不受影響，原樣回傳。 */
  function clampFitHorizontalToZone(fit, img, zone, canvasW, canvasH){
    if(!fit || !img || !zone) return fit;
    var tight = calcTightBoundsRatio(img);
    var ratio = img.naturalWidth / img.naturalHeight;
    var zoneLeftPx = zone.xPct*canvasW - (zone.wPct*canvasW)/2;
    var zoneRightPx = zone.xPct*canvasW + (zone.wPct*canvasW)/2;
    var zoneWpx = zoneRightPx - zoneLeftPx;
    if(zoneWpx <= 0) return fit; // 理論上不會發生的異常設定，放棄調整比硬算出詭異結果安全

    var boxH = fit.hPct * canvasH;
    var boxW = boxH * ratio;
    var tightLeftAtScale = tight ? tight.tx*boxW : 0;
    var tightWAtScale = tight ? tight.tw*boxW : boxW;

    // ① 縮：有色範圍寬度超過zone寬度時，先等比例縮小到剛好等於zone寬度
    var shrinkRatio = 1;
    if(tightWAtScale > zoneWpx && tightWAtScale > 0) shrinkRatio = zoneWpx / tightWAtScale;

    var newHPct = fit.hPct * shrinkRatio;
    var newBoxH = newHPct * canvasH;
    var newBoxW = newBoxH * ratio;
    var newTightLeftAtScale = tight ? tight.tx*newBoxW : 0;
    var newTightWAtScale = tight ? tight.tw*newBoxW : newBoxW;

    // ② 平移：縮完之後(或本來就沒超寬)，左右邊界哪邊還超出zone就往回推，
    //    不是「保持中心不變」，是直接讓它卡進zone內側。
    var boxLeft = (fit.align === 'center') ? (fit.xPct*canvasW - newBoxW/2) : (fit.xPct*canvasW);
    var visibleLeftPx = boxLeft + newTightLeftAtScale;
    var visibleRightPx = visibleLeftPx + newTightWAtScale;

    var shiftPx = 0;
    if(visibleLeftPx < zoneLeftPx) shiftPx = zoneLeftPx - visibleLeftPx;
    else if(visibleRightPx > zoneRightPx) shiftPx = zoneRightPx - visibleRightPx;

    if(shrinkRatio === 1 && shiftPx === 0) return fit; // 完全沒超出，原樣回傳

    var newBoxLeft = boxLeft + shiftPx;
    var newXPct = (fit.align === 'center') ? (newBoxLeft + newBoxW/2)/canvasW : newBoxLeft/canvasW;
    return { xPct: newXPct, yPct: fit.yPct, hPct: newHPct, align: fit.align };
  }

  return { loadLayout: loadLayout, render: render, fetchJSON: fetchJSON, mergePositions: mergePositions,
    calcTightBoundsRatio: calcTightBoundsRatio, calcArtZoneFit: calcArtZoneFit,
    calcArtZoneFitBottomAlign: calcArtZoneFitBottomAlign,
    clampFitBottomToCanvas: clampFitBottomToCanvas, clampFitTopToCanvas: clampFitTopToCanvas,
    clampFitHorizontalToZone: clampFitHorizontalToZone };
})();
