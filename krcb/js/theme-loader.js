'use strict';
/* theme-loader.js —— 讀取 configs/theme.json，存進 window.Theme 給
   modules/text-module.js的colorRef查表用，同時把theme.shadow這個hex
   轉成rgb字串、呼叫ShadowPlugin.setShadowColorRGB()覆蓋掉shadow-plugin.js
   裡寫死的備用預設值。

   這是整個「顏色集中管理」機制的入口：以後複製整包專案做新主題，只要改
   configs/theme.json這一份檔案，不用碰其他任何程式檔或版位設定檔。

   載入失敗（例如theme.json不存在、格式錯）不會擋住整個編輯器啟動——
   window.Theme維持undefined，text-module.js的_resolveTextColor()查不到
   colorRef對應的值時會退回'#ffffff'，shadow顏色維持shadow-plugin.js裡
   寫死的備用值，畫面還是能動，只是顏色不是主題色，不會整個當掉。 */
window.Theme = null;

function _hexToRgbStr(hex){
  if(!hex) return null;
  var m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if(!m) return null;
  var n = parseInt(m[1], 16);
  return ((n>>16)&255) + ',' + ((n>>8)&255) + ',' + (n&255);
}

function loadTheme(cb){
  fetch('configs/theme.json')
    .then(function(res){ if(!res.ok) throw new Error('theme.json HTTP ' + res.status); return res.json(); })
    .then(function(theme){
      window.Theme = theme;
      if(theme.shadow && window.ShadowPlugin){
        var rgb = _hexToRgbStr(theme.shadow);
        if(rgb) window.ShadowPlugin.setShadowColorRGB(rgb);
      }
    })
    .catch(function(e){
      console.warn('[theme-loader] 讀取configs/theme.json失敗，文字顏色/陰影顏色會退回各自的備用預設值：', e);
    })
    .then(function(){ if(cb) cb(); });
}
