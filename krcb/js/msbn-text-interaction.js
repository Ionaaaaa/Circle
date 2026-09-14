'use strict';
/* ══════════════════ MSBN 可編輯文字：直接在畫布上打字 ══════════════════
   使用者明確要求：公版二~六這些文字（文案/品牌名稱/折扣文案等）不需要
   連動（不透過S.textGroups那套跨版位同步機制），直接在畫布上點一下該
   文字區塊、跳出一個蓋在那個位置上的輸入框，打完字點旁邊或按Enter就
   存檔，跟修改內容。

   做法：不是真的canvas原生文字編輯（canvas畫出來的文字本身不能編輯），
   是在canvas上面疊一個絕對定位的<textarea>，剛好蓋在那個文字框的螢幕
   座標上，看起來像是「直接點文字就能改」，實際上是蓋一層輸入框上去、
   打完字再拿掉，跟js/msbn-logo-interaction.js的隱藏<input type=file>是
   同一種「用一個真正的HTML表單元素做使用者看不出來的輔助操作」手法。

   狀態存在 S.msbnTexts[layoutId][slot] = "使用者輸入的文字字串"，
   layoutId在這裡指的是MSBN「實例id」（例如'07_msbn_v3__4'），不是版型
   本身，每個實例各自獨立一份，互不影響、也不會跟其他版位的文案同步。 */

var _msbnTextEditing = null; // { layoutId, slot, textarea } 目前正在編輯中的那個，同時只會有一個

/* 2026-08新增：給modules/msbn-logo-module.js的msbnText畫圖模組查詢用——
   正在編輯中的那個文字欄位，canvas底層不要再畫出它自己的文字內容，不然
   textarea疊在上面(textarea本身也會顯示打字中的內容)，兩層文字沒有對得
   剛剛好(canvas的fillText排版邏輯跟textarea原生文字排版本來就不會像素
   級一致)，疊在一起會變成使用者反映的「兩層文案疊在一起」的糊字效果。
   編輯中就讓canvas那個位置整個留白，只看textarea自己顯示的內容就好，
   關掉編輯(commit)之後canvas才恢復畫出最終定案的文字。 */
function isMsbnTextBeingEdited(layoutId, slot){
  return !!(_msbnTextEditing && _msbnTextEditing.layoutId === layoutId && _msbnTextEditing.slot === slot);
}
window.isMsbnTextBeingEdited = isMsbnTextBeingEdited;

function _msbnTextEnsureState(layoutId){
  S.msbnTexts = S.msbnTexts || {};
  S.msbnTexts[layoutId] = S.msbnTexts[layoutId] || {};
  return S.msbnTexts[layoutId];
}

/* 跟js/msbn-logo-interaction.js的_msbnToCanvasPos()同一套換算邏輯：canvas
   內部像素座標跟畫面實際顯示大小通常不是1:1（CSS會縮放），任何「滑鼠點
   在哪」跟「輸入框要蓋在畫面上的哪個位置」都要經過這個縮放換算，兩個
   方向（畫布座標→螢幕座標、螢幕座標→畫布座標）都要用同一個scaleX/scaleY
   才不會對不齊。 */
function _msbnTextToCanvasPos(canvas, e){
  var rect = canvas.getBoundingClientRect();
  var scaleX = canvas.width/rect.width, scaleY = canvas.height/rect.height;
  var p = e.touches ? e.touches[0] : e;
  return { x:(p.clientX-rect.left)*scaleX, y:(p.clientY-rect.top)*scaleY };
}

function _msbnTextHitSlot(layoutId, p){
  var all = window.bundles || {};
  var bundle = all[layoutId] || all['07_msbn'];
  var positions = bundle && bundle.positions;
  var slotKeys = (positions && positions.msbnTexts) ? Object.keys(positions.msbnTexts) : [];
  for(var i=0;i<slotKeys.length;i++){
    var slotKey = slotKeys[i];
    var spec = getMsbnTextBox(layoutId, slotKey);
    if(!spec) continue;
    if(p.x >= spec.x && p.x <= spec.x+spec.w && p.y >= spec.y && p.y <= spec.y+spec.h){
      return slotKey;
    }
  }
  return null;
}

/* 結束編輯：把目前輸入框裡的內容存回S.msbnTexts，拿掉輸入框，重畫一次
   畫布（讓畫布上的文字換成剛打好的內容）。commit=false的話代表使用者按
   Esc取消，不存檔、直接丟棄這次輸入。 */
function _msbnTextCommit(commit){
  var editing = _msbnTextEditing;
  if(!editing) return;
  _msbnTextEditing = null;
  if(commit){
    var texts = _msbnTextEnsureState(editing.layoutId);
    texts[editing.slot] = editing.textarea.value;
    /* 2026-08(KRCB)新增：副區(APP)/副區(PC)內容本來就該完全一樣(同一個
       活動、只是畫布尺寸不同)，改一邊的文字要同步套到另一邊的同一個
       欄位(tag1/promo1/tag2/promo2/tag3/promo3這些key兩邊命名完全一樣，
       直接對應)，不用兩邊各自改一次。跟其他MSBN文字欄位(標題/商品名稱
       等，非副區)完全不影響。 */
    if(typeof SUBZONE_IDS !== 'undefined' && SUBZONE_IDS.indexOf(editing.layoutId) !== -1){
      SUBZONE_IDS.forEach(function(otherId){
        if(otherId === editing.layoutId) return;
        var otherTexts = _msbnTextEnsureState(otherId);
        otherTexts[editing.slot] = editing.textarea.value;
      });
    }
  }
  if(editing.textarea.parentNode) editing.textarea.parentNode.removeChild(editing.textarea);
  renderAll();
  /* 每次打完字存檔都要重新跑一次字數/禁用語檢查，更新右側面板的⚠️徽章——
     見js/msbn-text-compliance.js。 */
  if(typeof updateMsbnIssueBadge === 'function') updateMsbnIssueBadge();
}

/* 開始編輯：在canvas所在的容器上疊一個<textarea>，位置/字級/顏色/對齊
   盡量比照畫布上原本畫的樣子（不用做到100%像素級一致，使用者能看清楚
   自己在改哪一塊、大概看得出字級大小就夠了），預先填入目前的內容(或
   還是空的，讓使用者可以直接打字蓋掉預設佔位文字)。 */
function _msbnTextStartEdit(canvas, layoutId, slot){
  if(_msbnTextEditing) _msbnTextCommit(true); // 一次只能編輯一個，先把上一個存檔關掉

  var spec = getMsbnTextBox(layoutId, slot);
  if(!spec) return;

  var rect = canvas.getBoundingClientRect();
  var scaleX = rect.width/canvas.width, scaleY = rect.height/canvas.height;

  var texts = _msbnTextEnsureState(layoutId);
  var current = texts[slot];
  if(current === undefined || current === null) current = '';

  var textarea = document.createElement('textarea');
  textarea.value = current;
  textarea.placeholder = spec.default || '';
  var wrapper = canvas.parentElement; // canvas-wrap，已經是position:relative的容器（跟host調整位置的覆蓋層同一個掛法）
  if(wrapper && getComputedStyle(wrapper).position === 'static'){
    wrapper.style.position = 'relative';
  }
  textarea.style.position = 'absolute';
  textarea.style.left = (canvas.offsetLeft + spec.x*scaleX) + 'px';
  textarea.style.top = (canvas.offsetTop + spec.y*scaleY) + 'px';
  textarea.style.width = (spec.w*scaleX) + 'px';
  textarea.style.height = (spec.h*scaleY) + 'px';
  textarea.style.boxSizing = 'border-box'; // 確保border/padding不會把實際寬高撐大過spec.w/h(跟canvas畫的框對不起來)
  /* 2026-08(KRCB)新增：spec.multiline的欄位(目前是MSBN圓形徽章文字)要
     比照AR文案，允許使用者直接打字自然換行、也可以自己按Enter手動斷行——
     跟其他MSBN單行欄位(標題/商品名稱等)的「不換行、Enter＝送出存檔」
     行為分開處理，不能共用同一份設定，不然單行欄位會被使用者不小心的
     Enter拆成兩行、multiline欄位卻沒辦法用Enter換行。
     2026-08再修正：使用者反映輸入框跟著圓形徽章實際尺寸(71~103px寬)走，
     打字的時候框太窄，字會擠在一起、體感很卡——這裡不再受畫面上「文字
     範圍」大小限制，改用固定的寬鬆寬度(180px，跟縮放比例scaleX無關，
     單純給輸入體驗用)置中疊在原本的中心點上，不影響canvas實際畫出來的
     結果(畫布渲染永遠是依照spec.x/y置中，跟這個輸入框寬度無關)。同時
     限制最多6個字(固定6字內)，跟使用者的規格一致。 */
  if(spec.multiline){
    var editW = 180;
    var centerX = canvas.offsetLeft + (spec.x + spec.w/2)*scaleX;
    textarea.style.left = (centerX - editW/2) + 'px';
    textarea.style.width = editW + 'px';
    textarea.maxLength = 6;
  }
  textarea.style.whiteSpace = spec.multiline ? 'pre-wrap' : 'pre'; // 單行欄位：不要自動換行（canvas的fillText本來就不會換行，長文字自動換行會跟canvas畫的單行版面對不起來）；multiline欄位：允許自動換行，方便使用者邊打邊看
  textarea.style.fontSize = Math.max(10, spec.fontSizePx*scaleY) + 'px';
  textarea.style.fontWeight = spec.fontWeight || '400';
  textarea.style.color = spec.color || '#000000';
  /* 2026-08(KRCB)訂正：原本想用CSS的-webkit-text-stroke在編輯中的textarea
     預覽跟畫布上一樣的外框效果，但CSS的文字外框畫法(對稱往內外兩側描邊)
     跟canvas的strokeText+fillText(先畫外框、實際文字疊上去蓋掉外框內側
     那一半)視覺效果不一樣——尤其中文筆畫本來就細，外框寬度只要佔筆畫
     一定比例，CSS那種畫法看起來就會變成顏色整個包住文字、糊成一團，
     使用者反映「顏色會包住文字」就是這個問題。改回不在編輯預覽裡模擬
     外框效果，單純顯示填色文字就好——實際畫布渲染(見modules/
     msbn-logo-module.js)本來就有正確的外框效果，只有「打字當下」這個
     短暫過程看不到外框，編輯完成、textarea關掉之後畫布就會正確顯示。 */
  textarea.style.textAlign = spec.align || 'center';
  textarea.style.lineHeight = spec.multiline ? (spec.fontSizePx*1.15*scaleY) + 'px' : (spec.h*scaleY) + 'px'; // multiline用跟畫布上同一個行高(fontSizePx*1.15，見modules/msbn-logo-module.js)，不是用整個框的高度當行高（那樣兩行字會疊在一起看不清楚）
  textarea.style.padding = '0';
  textarea.style.margin = '0';
  /* 2026-08訂正：使用者反映框線不好看，希望直接點擊就能打字、不要有明顯
     的編輯框視覺——改成完全透明的border/background，看起來就像直接在
     畫布上打字一樣。拿掉框線不影響功能，textarea還是真的存在、還是可以
     正常點擊/打字/失焦存檔，只是視覺上不畫出邊界；使用者如果覺得「看不
     出來哪裡可以點」，可以之後再考慮加淡淡的hover效果，這裡先照要求做
     到最單純的樣子。 */
  textarea.style.border = 'none';
  textarea.style.background = 'transparent';
  textarea.style.resize = 'none';
  textarea.style.overflow = 'hidden';
  textarea.style.zIndex = '30';
  textarea.style.fontFamily = '"ShopeeNoto","Noto Sans TC",sans-serif';

  textarea.addEventListener('keydown', function(e){
    /* multiline欄位：Enter(不管有沒有按Shift)都是換行，交給textarea原生
       行為處理，不要preventDefault、也不要當成提交——跟AR文案輸入框
       (在側欄，是普通的textarea，本來就是Enter直接換行)行為一致。只有
       Escape還是取消編輯。
       非multiline欄位：維持原本的行為——Enter(沒按Shift)＝存檔關閉，
       Shift+Enter才是手動換行(雖然這種單行欄位理論上用不到多行，但保留
       這個備用手段不影響現有欄位)。 */
    if(e.key === 'Enter' && !spec.multiline && !e.shiftKey){ e.preventDefault(); _msbnTextCommit(true); }
    else if(e.key === 'Escape'){ e.preventDefault(); _msbnTextCommit(false); }
    e.stopPropagation(); // 不要讓上面msbn-logo-interaction.js的方向鍵/Delete鍵監聽誤觸
  });
  textarea.addEventListener('blur', function(){ _msbnTextCommit(true); });

  wrapper.appendChild(textarea);
  textarea.focus();
  /* 2026-08訂正：原本這裡呼叫select()會把文字整個反白選取(瀏覽器原生的
     藍色選取範圍)，使用者反映這個「選取框」不好看。改成把游標直接移到
     文字最後面，不做任何反白——一樣可以立刻打字(會接在後面)，只是不會
     整段反白。如果使用者想清空重打，自己按Ctrl+A全選或直接刪除即可，
     不用我們主動幫他反白。 */
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  _msbnTextEditing = { layoutId: layoutId, slot: slot, textarea: textarea };
  /* 一開始編輯就要立刻重畫一次，讓canvas那個位置馬上留白(見上面
     isMsbnTextBeingEdited()的說明)，不然canvas還停留在編輯前最後一次
     畫的內容，跟新蓋上去的textarea疊在一起，看起來像兩層文字。 */
  if(typeof renderAll === 'function') renderAll();
}

/* 切分頁時呼叫——正在編輯中的文字框先存檔關掉，避免切到別的分頁後輸入框
   還飄在畫面上、內容卻對不到任何實際存在的canvas。 */
function resetMsbnTextEditing(){
  if(_msbnTextEditing) _msbnTextCommit(true);
}

function attachMsbnTextInteraction(canvas, layoutId){
  if(!isMsbnTabOnlyId(layoutId)) return;

  canvas.addEventListener('click', function(e){
    /* 如果這次點擊命中的是LOGO/圖片框，交給msbn-logo-interaction.js處理，
       這裡不要搶著開文字輸入框——同一個座標理論上不會同時是LOGO框跟文字
       框（版型設計上是分開的），但保險起見還是先判斷一次。 */
    var p = _msbnTextToCanvasPos(canvas, e);
    var textSlot = _msbnTextHitSlot(layoutId, p);
    if(!textSlot) return;
    e.stopPropagation();
    _msbnTextStartEdit(canvas, layoutId, textSlot);
  });
}
