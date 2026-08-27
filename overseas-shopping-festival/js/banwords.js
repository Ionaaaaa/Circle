'use strict';
/* banwords.js —— 文案字數限制 + 禁用語檢查
   ------------------------------------------------------------
   字數規則（跟你確認過）：英數/符號算0.5個字，中文字算1個字。
   標題(主標)上限8字、副標上限7字，超過在輸入框旁邊亮燈提示（不會擋輸入，
   但會在下載時擋下來、跳警告popup，使用者確認後仍然可以強制下載）。

   禁用語規則：資料來源是你給的 banwords.xlsx「禁用語」分頁，直接匯出成
   data/banwords.json（word=禁用字、replace=建議改成什麼、exclude=就算
   包含禁用字也不算違規的例外詞、note=備註說明），這裡在瀏覽器端讀這份
   json做比對，不用另外裝Python環境。

   比對邏輯：
   1. word裡如果有*號，當作萬用字元（例如"蝦幣*元"比對"蝦幣...元"這種
      中間夾任何內容的情況）；有\d、\s這類regex跳脫符號的，直接當regex
      使用；其餘當純文字子字串比對。
   2. exclude例外詞：文字裡如果同時出現例外詞，且禁用字剛好是例外詞的
      一部分（例如禁用字"一"、例外詞"一鍵"，文字是"一鍵好禮"），那次
      命中就不算違規。
   3. 這是113列規則整理出來的通用引擎，不保證100%涵蓋所有極端案例
      （例如"~"符號前後要留空白這種更細的排版規則），但涵蓋了絕大多數
      常見禁用字/建議改字。有漏掉的案例歡迎回報，把規則加進
      data/banwords.json就能立刻生效，不用改這支程式。 */

var BANWORDS_DATA = null;
var BANWORDS_LOADING = null;

function loadBanwords(){
  if(BANWORDS_DATA) return Promise.resolve(BANWORDS_DATA);
  if(BANWORDS_LOADING) return BANWORDS_LOADING;
  BANWORDS_LOADING = fetch('data/banwords.json', { cache: 'no-store' }).then(function(r){
    if(!r.ok) throw new Error('讀取禁用語清單失敗');
    return r.json();
  }).then(function(list){
    BANWORDS_DATA = list.map(function(entry){
      return { entry: entry, regex: _buildBanwordRegex(entry.word) };
    });
    return BANWORDS_DATA;
  }).catch(function(e){
    console.warn('[banwords] 禁用語清單載入失敗，這次先不擋禁用語檢查：', e);
    BANWORDS_DATA = [];
    return BANWORDS_DATA;
  });
  return BANWORDS_LOADING;
}

function _escapeRegExp(s){
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* word轉成可以拿來findAll的regex：
   - 含有\d \s \w 這類regex跳脫符號的，當作使用者自己寫好的regex直接用
   - 含有*的，*轉成「中間任意內容」的.*?，其餘部分逐段escape
   - 其餘：整段當純文字，escape特殊字元後直接比對（含.?!"這類符號本身也適用） */
function _buildBanwordRegex(word){
  try{
    if(/\\[dswDSW]/.test(word)){
      return new RegExp(word, 'g');
    }
    if(word.indexOf('*') !== -1){
      var pattern = word.split('*').map(_escapeRegExp).join('.*?');
      return new RegExp(pattern, 'g');
    }
    return new RegExp(_escapeRegExp(word), 'g');
  }catch(e){
    return null;
  }
}

/* excludeIfContains跟exclude不一樣：exclude是「命中的位置剛好落在例外詞
   範圍內」才算例外（同一個字詞的部分重疊），excludeIfContains是「整段
   文字裡只要出現這些內容的任何一個，這條規則在這段文字裡就整個不算」——
   用在「這個規則的適用前提，得看整段文字的其他地方」的情況，例如：
     - 日期欄位如果整段其實是在寫時間(08:00)，不是日期，就不該被「日期
       個位數不補0」這條規則抓到，但「時間」這個線索(冒號)通常跟被命中
       的那個數字不會重疊，沒辦法用exclude(重疊判斯)排除，只能整段文字
       一起看。
     - 金額千分位提醒：整行只要出現"蝦幣""件""個""買""送""iPhone"、
       已經有逗號、或者根本是日期(有"/")，就不算是要提醒補千分位的金額，
       這些線索通常也不會剛好疊在數字本身的位置上。
   patterns裡的字串一樣支援跟主要word同一套「含\d\s\w就當regex」判斷
   （見_buildBanwordRegex），純文字例外詞（例如"蝦幣"）直接當子字串比對。 */
function _textContainsAny(text, patterns){
  return (patterns||[]).some(function(p){
    var re = _buildBanwordRegex(p);
    if(!re) return false;
    re.lastIndex = 0;
    return re.test(text);
  });
}

/* 算出這個命中結果「實際要套用的替換文字」，給UI做一鍵套用用：
   - entry.replace有值：單純換字，直接用這個值（例如"神券"→"優惠券"）。
   - entry.replace沒值、但有entry.fix：這幾條規則(日期補0/日期-沒空格/
     金額千分位)沒辦法用固定的替換字（要換成什麼跟命中到的實際文字內容
     有關），所以用fix標記告訴這裡要怎麼從matchedText算出正確答案。
   - 兩者都沒有：回傳null，UI只顯示提醒文字，不出現「套用」按鈕（沒有
     明確、安全的自動修正方式，讓使用者自己判斷比較保險）。 */
function _computeSuggested(entry, matchedText){
  if(entry.replace !== undefined && entry.replace !== null) return entry.replace;
  switch(entry.fix){
    case 'stripLeadingZero': return matchedText.replace(/^0(\d)/, '$1');
    case 'spaceDash': return matchedText.replace('-', ' - ');
    case 'thousands': return matchedText.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    case 'prependDollar': return '$' + matchedText;
    default: return null;
  }
}

/* 找出text裡所有「命中禁用語、且不在例外詞範圍內」的結果。
   回傳陣列：[{word, replace, note, matchedText, index, suggested}, ...]
   suggested是算好的「實際要換成什麼」，null代表沒有安全的自動修正方式。 */
function checkBanwords(text, banwordsList){
  if(!text || !banwordsList || !banwordsList.length) return [];
  var results = [];
  banwordsList.forEach(function(item){
    var re = item.regex;
    if(!re) return;
    if(item.entry.excludeIfContains && item.entry.excludeIfContains.length &&
       _textContainsAny(text, item.entry.excludeIfContains)) return; // 整段文字符合排除前提，這條規則跳過
    re.lastIndex = 0;
    var m;
    while((m = re.exec(text)) !== null){
      var start = m.index, end = start + m[0].length;
      if(m[0].length === 0){ re.lastIndex++; continue; } // 避免零寬比對死迴圈

      var excluded = (item.entry.exclude||[]).some(function(exWord){
        var exIdx = text.indexOf(exWord);
        while(exIdx !== -1){
          var exEnd = exIdx + exWord.length;
          if(start >= exIdx && end <= exEnd) return true;
          exIdx = text.indexOf(exWord, exIdx+1);
        }
        return false;
      });

      if(!excluded){
        results.push({
          word: item.entry.word, replace: item.entry.replace,
          note: item.entry.note, matchedText: m[0], index: start,
          suggested: _computeSuggested(item.entry, m[0])
        });
      }
    }
  });
  return results;
}

/* 字數計算：中文字(以及其他非ASCII字元)算1個字，英數/符號(ASCII)算0.5個字 */
function computeCharWeight(text){
  var total = 0;
  for(var i=0;i<(text||'').length;i++){
    total += (text.charCodeAt(i) > 127) ? 1 : 0.5;
  }
  return total;
}

var TEXT_LIMITS = { '標題': 8, '副標': 7 };
