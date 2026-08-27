'use strict';
/* theme-loader.js —— 讀取 configs/theme.json，存進 window.Theme 給
   modules/text-module.js的colorRef查表用，同時把theme.shadow這個hex
   轉成rgb字串、呼叫ShadowPlugin.setShadowColorRGB()覆蓋掉shadow-plugin.js
   裡寫死的備用預設值。

   這是整個「顏色集中管理」機制的入口：以後複製整包專案做新主題，只要改
   configs/theme.json這一份檔案，不用碰其他任何程式檔或版位設定檔。

   2026-08新增「A版／B版」支援：configs/theme.json現在是
   { "A": {...4個值}, "B": {...4個值} } 這種版本分組格式（不是像以前
   單一版本時代那樣直接4個值放最外層）。載入時整包存進window.ThemeAll，
   window.Theme只指向「目前作用中版本」那組，text-module.js完全不用
   改——它一直都只認window.Theme，不知道也不需要知道有A/B兩組。
   切換版本呼叫setTemplateVersion('A'/'B')，只是換window.Theme指到哪個
   物件+更新陰影色，不會重新fetch檔案，也不會打斷正在畫的畫布。

   載入失敗（例如theme.json不存在、格式錯）不會擋住整個編輯器啟動——
   window.Theme維持undefined，text-module.js的_resolveTextColor()查不到
   colorRef對應的值時會退回'#ffffff'，shadow顏色維持shadow-plugin.js裡
   寫死的備用值，畫面還是能動，只是顏色不是主題色，不會整個當掉。 */
window.Theme = null;
window.ThemeAll = null;

function _hexToRgbStr(hex){
  if(!hex) return null;
  var m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if(!m) return null;
  var n = parseInt(m[1], 16);
  return ((n>>16)&255) + ',' + ((n>>8)&255) + ',' + (n&255);
}

/* 切換公版版本(A/B)：只換window.Theme指向哪個顏色組+同步陰影色，
   呼叫端(js/editor-main.js的版本切換按鈕)自己負責之後呼叫renderAll()
   重畫，這裡不主動重畫（跟載入背景圖/CTA圖的流程各自獨立，避免耦合）。
   找不到對應版本(例如ThemeAll還沒load完就被呼叫、或傳了A/B以外的值)
   時退回'A'，不會整個沒有主題色可用。 */
function setTemplateVersion(v){
  var key = (v === 'B') ? 'B' : 'A';
  if(!window.ThemeAll) return;
  var theme = window.ThemeAll[key] || window.ThemeAll.A;
  window.Theme = theme;
  if(theme && theme.shadow && window.ShadowPlugin){
    var rgb = _hexToRgbStr(theme.shadow);
    if(rgb) window.ShadowPlugin.setShadowColorRGB(rgb);
  }
}

function loadTheme(cb){
  fetch('configs/theme.json')
    .then(function(res){ if(!res.ok) throw new Error('theme.json HTTP ' + res.status); return res.json(); })
    .then(function(themeAll){
      window.ThemeAll = themeAll;
      var initialVersion = (typeof S !== 'undefined' && S && S.templateVersion) ? S.templateVersion : 'A';
      setTemplateVersion(initialVersion);
    })
    .catch(function(e){
      console.warn('[theme-loader] 讀取configs/theme.json失敗，文字顏色/陰影顏色會退回各自的備用預設值：', e);
    })
    .then(function(){ if(cb) cb(); });
}
