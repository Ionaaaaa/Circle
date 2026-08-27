'use strict';
/* ══════════════════ MSBN 文字監測（字數+禁用語） ══════════════════
   使用者要求：MSBN的文字(msbnTexts)也要套用跟曝光資源那頁一樣的字數/
   禁用語檢查引擎(js/banwords.js的checkBanwords()/computeCharWeight())，
   但MSBN沒有右側固定的輸入框（文字是直接點畫布打字，見
   js/msbn-text-interaction.js），沒辦法比照標題/副標那樣「輸入框旁邊放
   一個counter+警告」。

   採用的UI設計（C+B的整合版，跟使用者確認過）：
   - 平常完全不佔位置、不出現任何東西。
   - 只要「任何一個MSBN文字欄位」超過字數建議或踩到禁用語，右側面板
     「文案」這個標題旁邊就會冒出一個⚠️三角形徽章＋問題數量。
   - 點擊徽章：右側原本的標題/副標/日期輸入框整個換成「問題清單」，
     列出所有版本、所有有問題的文字欄位，樣式跟banword-warning一樣、
     只是變成一筆一筆列出來，可以在這裡一次確認/套用修正完，不用切來
     切去找是哪個版位出問題。
   - 清單裡按「套用」修正完、或使用者直接回畫布上把文字改對之後，
     徽章的問題數量會即時更新；全部修好，徽章自動消失。

   字數上限怎麼來的：不用另外維護一份「MSBN每個欄位上限多少字」的表，
   直接從positions.json裡每個欄位本來就有的default佔位字串裡「找數字」
   （例如"文案建議07字內"→7、"大字文案建議10字以內"→10）——這些
   佔位字串本來就是照PSD設計稿的建議字數寫的，兩邊永遠對得上，不用
   重複維護一份對照表。找不到數字的欄位(理論上不會發生，因為目前六個
   版型的欄位全部都有寫建議字數)就不檢查字數，只檢查禁用語。 */

function _msbnTextLimitFromDefault(defaultStr){
  if(!defaultStr) return null;
  var m = /(\d+)\s*字/.exec(defaultStr);
  return m ? parseInt(m[1], 10) : null;
}

/* 掃過「目前這個分頁」的所有MSBN實例、所有文字欄位，回傳有問題的清單：
   [{ instanceId, instanceLabel, slotKey, text, weight, limit, overLimit,
      banwordHits }]——overLimit/banwordHits.length都是0代表這筆其實沒問題，
   呼叫端只挑「overLimit為true或banwordHits.length>0」的才是真正要顯示的。
   只掃S.instances(目前作用中分頁)，不是全部分頁——跟曝光資源那頁的
   checkTextCompliance()一樣的範圍原則(只檢查看得到的這份工單內容)。 */
function computeMsbnTextIssuesSync(banwordsList){
  var issues = [];
  if(!S.instances) return issues;
  S.instances.forEach(function(inst){
    if(!isMsbnFamilyId(inst.layoutId)) return;
    var bundle = window.bundles && window.bundles[inst.instanceId];
    var msbnTexts = bundle && bundle.positions && bundle.positions.msbnTexts;
    if(!msbnTexts) return;
    var stored = (S.msbnTexts && S.msbnTexts[inst.instanceId]) || {};
    Object.keys(msbnTexts).forEach(function(slotKey){
      var spec = msbnTexts[slotKey];
      var text = stored[slotKey];
      if(!text) return; // 還是預設佔位字(使用者根本沒打字)，不算「使用者填的內容」，不檢查
      var limit = _msbnTextLimitFromDefault(spec.default);
      var weight = computeCharWeight(text);
      var overLimit = (limit !== null) && (weight > limit);
      var banwordHits = checkBanwords(text, banwordsList || []);
      if(overLimit || banwordHits.length){
        issues.push({
          instanceId: inst.instanceId,
          instanceLabel: inst.label || inst.instanceId,
          slotKey: slotKey,
          text: text,
          weight: weight,
          limit: limit,
          overLimit: overLimit,
          banwordHits: banwordHits
        });
      }
    });
  });
  return issues;
}

/* 徽章+清單的更新入口——任何可能影響MSBN文字內容的地方都要呼叫這個
   （commit文字、切換分頁、匯入完成後）。非同步是因為禁用語清單要從
   data/banwords.json讀，跟曝光資源那頁的updateTextCompliance()共用
   同一份loadBanwords()快取，不會重複打好幾次fetch。
   2026-08訂正：改成「有問題就直接打開清單、沒問題就直接關掉」，不用
   使用者自己點一下⚠️徽章才看得到——msbn分頁本來就沒有「標題/副標/日期」
   這組正常編輯畫面可以顯示(一律隱藏，見editor-main.js的
   updateNormalTextFieldsVisibility())，「點徽章展開清單」以前的用途是
   在正常畫面/問題清單這兩個畫面之間切換，現在正常畫面已經不存在了，
   直接常駐顯示清單即可，不需要這層切換動作。 */
function updateMsbnIssueBadge(){
  loadBanwords().then(function(list){
    var issues = computeMsbnTextIssuesSync(list);
    var badge = document.getElementById('msbn-issue-badge');
    var countEl = document.getElementById('msbn-issue-count');
    var panel = document.getElementById('msbn-issues-panel');
    if(!badge || !countEl || !panel) return;
    if(issues.length){
      badge.style.display = '';
      countEl.textContent = issues.length;
      panel.style.display = '';
      renderMsbnIssuesList(issues);
    } else {
      badge.style.display = 'none';
      panel.style.display = 'none';
    }
  });
}

var MSBN_SLOT_LABELS = {
  left:'左', mid:'中', right:'右',
  logo1:'文案', logoLeft:'左側文案', logoRight:'右側文案',
  text1:'文案', text2:'文案', text3:'文案',
  textLeft:'左側文案', textRight:'右側文案',
  textBig:'大字文案', textSmall:'小字文案',
  brandName:'品牌名稱', discount:'折扣文案'
};

function renderMsbnIssuesList(issues){
  var listEl = document.getElementById('msbn-issues-list');
  if(!listEl) return;
  if(!issues.length){
    listEl.innerHTML = '<div class="hint">目前沒有偵測到任何問題。</div>';
    return;
  }
  listEl.innerHTML = issues.map(function(issue, idx){
    var slotLabel = MSBN_SLOT_LABELS[issue.slotKey] || issue.slotKey;
    var counterHtml = (issue.limit !== null)
      ? '<span class="text-counter'+(issue.overLimit?' over':'')+'">'+(Number.isInteger(issue.weight)?issue.weight:issue.weight.toFixed(1))+'/'+issue.limit+'</span>'
      : '';
    var banwordHtml = issue.banwordHits.length
      ? '⚠ 偵測到禁用語：<br>'+issue.banwordHits.map(function(h, hi){
          var msg = esc(h.matchedText) + (h.replace ? '（建議改成「'+esc(h.replace)+'」）' : (h.note ? '（'+esc(h.note)+'）' : ''));
          if(h.suggested !== null && h.suggested !== undefined && h.suggested !== h.matchedText){
            msg += ' <button type="button" class="banword-apply-btn" data-idx="'+idx+'" data-hidx="'+hi+'">套用</button>';
          }
          return msg;
        }).join('<br>')
      : '';
    return '<div class="field" style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px;">'+
      '<label style="display:flex;justify-content:space-between;align-items:center;">'+esc(issue.instanceLabel)+' － '+esc(slotLabel)+' '+counterHtml+'</label>'+
      '<div style="font-size:13px;color:var(--text-dim);margin:4px 0;word-break:break-all;">'+esc(issue.text)+'</div>'+
      (banwordHtml ? '<div class="banword-warning">'+banwordHtml+'</div>' : '') +
    '</div>';
  }).join('');

  var currentIssues = issues;
  Array.prototype.forEach.call(listEl.querySelectorAll('.banword-apply-btn'), function(btn){
    btn.onclick = function(){
      var issue = currentIssues[Number(btn.dataset.idx)];
      var hit = issue.banwordHits[Number(btn.dataset.hidx)];
      applyMsbnBanwordFix(issue.instanceId, issue.slotKey, issue.text, hit);
    };
  });
}

function applyAllMsbnBanwordFixes(){
  loadBanwords().then(function(list){
    var issues = computeMsbnTextIssuesSync(list);
    issues.forEach(function(issue){
      var hits = (issue.banwordHits || []).filter(function(h){
        return h.suggested !== null && h.suggested !== undefined && h.suggested !== h.matchedText;
      });
      if(!hits.length) return;
      var texts = S.msbnTexts && S.msbnTexts[issue.instanceId];
      if(!texts || texts[issue.slotKey] === undefined) return;
      var text = texts[issue.slotKey];
      hits.slice().sort(function(a,b){ return b.index - a.index; }).forEach(function(hit){
        text = text.slice(0, hit.index) + hit.suggested + text.slice(hit.index + hit.matchedText.length);
      });
      texts[issue.slotKey] = text;
    });
    renderAll();
    updateMsbnIssueBadge();
  });
}

/* 清單裡按「套用」——直接改S.msbnTexts裡的內容，重畫畫布，重新整理清單
   跟徽章(修完可能這筆就沒問題了，數量要跟著減少)。跟曝光資源那頁的
   applyBanwordFix()是同一個套路，只是資料存放的位置不一樣(msbnTexts是
   per-instance，不是S.textGroups)。 */
function applyMsbnBanwordFix(instanceId, slotKey, text, hit){
  var newText = text.slice(0, hit.index) + hit.suggested + text.slice(hit.index + hit.matchedText.length);
  S.msbnTexts = S.msbnTexts || {};
  S.msbnTexts[instanceId] = S.msbnTexts[instanceId] || {};
  S.msbnTexts[instanceId][slotKey] = newText;
  renderAll();
  updateMsbnIssueBadge();
}
