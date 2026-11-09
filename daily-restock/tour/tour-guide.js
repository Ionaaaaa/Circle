/*!
 * tour-guide.js — 網頁工具的新手導覽（v1.0.0）
 * ------------------------------------------------------------
 * 把畫面上的功能一步一步打亮，旁邊出現說明框；可以加「假游標」示範操作。
 * 第一次開啟自動跑，之後按「使用教學」按鈕重看。
 *
 * 不依賴任何套件，一支檔案就能用。用法、設定、範例見 tour-guide.md。
 *
 *   <script src="tour-guide.js"></script>
 *   <script>
 *     var tour = TourGuide.create({
 *       storageKey: 'myapp_tour_v1',
 *       launchButton: { container: '.topbar' },
 *       steps: [
 *         { intro: true, title: '歡迎 👋', body: '帶你 1 分鐘上手。' },
 *         { target: '#save-btn', title: '儲存', body: '隨時存檔。' }
 *       ]
 *     });
 *   </script>
 *
 * 從 Mall SKBN 編輯器的新手導覽（js/tour.js）抽出來的通用版。
 */
(function(global){
  'use strict';

  var VERSION = '1.0.0';

  /* ══════════════════ 小工具（也開放給步驟設定用：TourGuide.helpers） ══════════════════ */
  function $(sel, root){ return (root || document).querySelector(sel); }
  function visible(el){
    if(!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function wait(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  /* 每 60ms 檢查一次 fn()，有值就回傳；超過 timeout 回傳 null（不會丟錯） */
  function waitFor(fn, timeout){
    var t0 = Date.now();
    return new Promise(function(resolve){
      (function poll(){
        var v = null; try{ v = fn(); }catch(e){}
        if(v || Date.now() - t0 > (timeout || 4000)) return resolve(v || null);
        setTimeout(poll, 60);
      })();
    });
  }
  /* 找文字完全一樣、而且看得到的元素：byText('.btn', '匯出') */
  function byText(sel, text){
    var list = document.querySelectorAll(sel);
    for(var i = 0; i < list.length; i++){
      if(list[i].textContent.trim() === text && visible(list[i])) return list[i];
    }
    return null;
  }
  function toEl(x){ return typeof x === 'string' ? $(x) : x; }
  function center(el){
    el = toEl(el);
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2, r: r };
  }
  /* 對元素送 pointer 事件（示範拖曳、畫布操作用）。
     假的 pointer 不能 setPointerCapture（瀏覽器會丟錯），所以先換成什麼都不做。 */
  function firePointer(el, type, x, y){
    el = toEl(el); if(!el) return;
    if(!el.__tgStub){ el.setPointerCapture = function(){}; el.releasePointerCapture = function(){}; el.__tgStub = true; }
    var opt = { clientX:x, clientY:y, pointerId:7, pointerType:'mouse', isPrimary:true,
      bubbles:true, cancelable:true, button:0, buttons:(type === 'pointerup' ? 0 : 1) };
    el.dispatchEvent(new PointerEvent(type, opt));
    var mouse = { pointerdown:'mousedown', pointermove:'mousemove', pointerup:'mouseup' }[type];
    if(mouse) el.dispatchEvent(new MouseEvent(mouse, opt));
  }
  function extend(a, b){ for(var k in b) if(Object.prototype.hasOwnProperty.call(b, k)) a[k] = b[k]; return a; }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }
  function reducedMotion(){ try{ return matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; } }

  /* ══════════════════ 樣式（只注入一次；顏色都用 CSS 變數，可以從外面改） ══════════════════ */
  var CSS = [
    '.tg-root{position:fixed;inset:0;z-index:var(--tg-z,100000);pointer-events:none;font-family:inherit;',
      '--tg-accent:#EE4D2D;--tg-card-bg:#232326;--tg-card-fg:#f0f0f0;--tg-card-body:#d4d4d8;--tg-card-dim:#9a9aa2;',
      '--tg-border:#3a3a3f;--tg-backdrop:rgba(0,0,0,.62);}',
    '.tg-root.tg-light{--tg-card-bg:#ffffff;--tg-card-fg:#1f1f23;--tg-card-body:#3f3f46;--tg-card-dim:#71717a;--tg-border:#e4e4e7;--tg-backdrop:rgba(15,15,20,.5);}',
    '.tg-block{position:fixed;inset:0;pointer-events:auto;background:transparent;}',
    '.tg-root.tg-pass .tg-block{pointer-events:none;}',
    '.tg-spot{position:fixed;border-radius:10px;box-shadow:0 0 0 9999px var(--tg-backdrop);border:2px solid var(--tg-accent);',
      'transition:left .25s,top .25s,width .25s,height .25s,opacity .2s;pointer-events:none;}',
    '.tg-spot.tg-none{width:0!important;height:0!important;left:50%!important;top:50%!important;border-width:0;}',
    '.tg-card{position:fixed;left:0;top:0;width:340px;max-width:calc(100vw - 24px);background:var(--tg-card-bg);color:var(--tg-card-fg);',
      'border:1px solid var(--tg-border);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:16px 18px 14px;',
      'pointer-events:auto;transition:left .25s,top .25s;box-sizing:border-box;text-align:left;}',
    '.tg-card .tg-step{font-size:11px;color:var(--tg-accent);font-weight:700;letter-spacing:.04em;margin-bottom:6px;}',
    '.tg-card .tg-title{font-size:16px;font-weight:700;margin:0 0 8px;line-height:1.4;}',
    '.tg-card .tg-body{font-size:13px;line-height:1.75;color:var(--tg-card-body);}',
    '.tg-card .tg-body b{color:var(--tg-card-fg);}',
    '.tg-card .tg-bar{height:3px;background:var(--tg-border);border-radius:2px;margin:14px 0 12px;overflow:hidden;}',
    '.tg-card .tg-bar i{display:block;height:100%;background:var(--tg-accent);transition:width .25s;}',
    '.tg-card .tg-foot{display:flex;align-items:center;gap:8px;}',
    '.tg-card .tg-skip{background:none;border:0;color:var(--tg-card-dim);font:inherit;font-size:12px;cursor:pointer;padding:6px 0;margin-right:auto;}',
    '.tg-card .tg-skip:hover{color:var(--tg-card-fg);}',
    '.tg-card .tg-btn{border-radius:6px;padding:7px 14px;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--tg-border);background:transparent;color:var(--tg-card-fg);}',
    '.tg-card .tg-btn:hover{border-color:var(--tg-accent);}',
    '.tg-card .tg-btn.tg-primary{background:var(--tg-accent);border-color:var(--tg-accent);color:#fff;}',
    '.tg-card .tg-btn[disabled]{opacity:.35;cursor:default;}',
    '.tg-card :focus-visible{outline:2px solid var(--tg-accent);outline-offset:2px;}',
    /* 開場那一步（intro:true）：置中、大一點，不顯示步數/上一步 */
    '.tg-card.tg-intro{width:420px;text-align:center;padding:26px 28px 20px;}',
    '.tg-card.tg-intro .tg-step,.tg-card.tg-intro .tg-bar,.tg-card.tg-intro .tg-skip,.tg-card.tg-intro .tg-prev{display:none;}',
    '.tg-card .tg-art{display:none;}',
    '.tg-card.tg-intro .tg-art{display:block;margin:0 auto 16px;max-width:100%;}',
    '.tg-card.tg-intro .tg-art:empty{display:none;}',
    '.tg-card.tg-intro .tg-art svg,.tg-card.tg-intro .tg-art img{max-width:100%;height:auto;display:block;margin:0 auto;}',
    '.tg-card.tg-intro .tg-title{font-size:20px;margin-bottom:10px;}',
    '.tg-card.tg-intro .tg-body{font-size:13.5px;}',
    '.tg-card .tg-later{display:none;}',
    '.tg-card.tg-intro .tg-later{display:inline-block;}',
    '.tg-card.tg-intro .tg-foot{justify-content:center;margin-top:20px;gap:10px;}',
    '.tg-card.tg-intro .tg-next{padding:9px 22px;font-size:13px;}',
    '.tg-card.tg-intro .tg-later{padding:9px 16px;font-size:13px;}',
    '.tg-card .tg-meta{display:none;}',
    '.tg-card.tg-intro .tg-meta{display:block;margin-top:12px;font-size:11.5px;color:var(--tg-card-dim);}',
    /* 假游標＋拖曳時跟著游標的小標籤 */
    '.tg-cursor{position:fixed;left:0;top:0;width:26px;height:30px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:3;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4));}',
    '.tg-cursor svg{position:absolute;left:-3px;top:-2px;}',
    '.tg-cursor .tg-ripple{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:2px solid #fff;opacity:0;}',
    '.tg-cursor .tg-ripple.go{animation:tgRipple .45s ease-out;}',
    '@keyframes tgRipple{from{transform:scale(.3);opacity:.9;}to{transform:scale(1.4);opacity:0;}}',
    '.tg-chip{position:fixed;left:0;top:0;opacity:0;transition:opacity .15s;pointer-events:none;z-index:2;display:flex;align-items:center;gap:6px;',
      'background:#fff;color:#222;font-size:12px;padding:6px 10px;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.35);white-space:nowrap;}',
    '.tg-loading{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:var(--tg-card-bg);color:var(--tg-card-fg);',
      'border:1px solid var(--tg-border);border-radius:12px;padding:18px 24px;font-size:13px;pointer-events:auto;}',
    '@media (prefers-reduced-motion: reduce){.tg-spot,.tg-card,.tg-card .tg-bar i{transition:none;}}'
  ].join('');

  function injectCss(){
    if(document.getElementById('tg-style')) return;
    var st = document.createElement('style');
    st.id = 'tg-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  var DEFAULT_LABELS = {
    next: '下一步',
    prev: '上一步',
    done: '完成',
    skip: '跳過導覽',
    start: '開始導覽',
    later: '先不用',
    stepOf: '{n} / {total}',
    meta: '共 {total} 步・之後可以按「{launch}」重看',
    launch: '使用教學',
    loading: '準備導覽中…'
  };

  var ICON_HELP = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M6.2 6.2a1.9 1.9 0 113 1.5c-.7.4-1.2.8-1.2 1.6M8 11.6v.1"/></svg>';

  var ABORT = { tourAbort: true };
  var activeTour = null;   // 同一時間只會有一個導覽在跑

  /* ══════════════════ 建立一個導覽 ══════════════════ */
  function create(userOpts){
    var opts = extend({
      steps: [],
      storageKey: null,          // 記錄「看過了」的 localStorage key；null = 不記錄、不自動跑
      autoStart: true,           // 沒看過就自動開始
      startDelay: 300,           // 自動開始前等多久（ms），讓頁面先畫好
      forceParam: 'tour',        // 網址有 ?tour 就強制再跑一次；設 null 關掉
      launchButton: null,        // { container, text, className, html, prepend } 或 false
      theme: 'dark',             // 'dark' | 'light'
      accent: null,              // 主色，例如 '#1a73e8'
      zIndex: 100000,
      introArt: '',              // 開場步驟的插圖（HTML/SVG 字串）
      labels: {},
      keyboard: true,            // → / Enter 下一步、← 上一步、Esc 結束；導覽中攔下其他按鍵
      animPause: 1400,           // 示範動畫跑完一輪後，隔多久再重播（ms）
      waitTimeout: 4000,         // 等目標元素出現最多多久（ms）
      respectReducedMotion: true,// 系統開了「減少動態效果」就不播假游標示範
      onStart: null,             // 開始前呼叫，可以回傳 Promise（例如載入範例資料）
      onEnd: null,               // 結束後呼叫 onEnd(reason)：'done'|'skip'|'later'|'escape'|'api'
      onStep: null               // 每換一步呼叫 onStep(index, step)
    }, userOpts || {});
    var L = extend(extend({}, DEFAULT_LABELS), opts.labels || {});
    var STEPS = opts.steps;

    var root, spot, card, block, cursorEl, chipEl;
    var idx = 0, active = false, busy = false, raf = 0, curTargets = null, animToken = 0;

    function fmt(s, extra){
      return String(s).replace(/\{(\w+)\}/g, function(_, k){
        var map = extend({ total: STEPS.length, launch: L.launch }, extra || {});
        return map[k] != null ? map[k] : '';
      });
    }

    /* ── 畫面元件 ── */
    function build(){
      if(root) return;
      injectCss();
      root = document.createElement('div');
      root.className = 'tg-root' + (opts.theme === 'light' ? ' tg-light' : '');
      root.style.display = 'none';
      root.style.setProperty('--tg-z', opts.zIndex);
      if(opts.accent) root.style.setProperty('--tg-accent', opts.accent);
      root.innerHTML =
        '<div class="tg-block"></div><div class="tg-spot tg-none"></div>' +
        '<div class="tg-card" role="dialog" aria-modal="true" aria-labelledby="tg-title">' +
          '<div class="tg-art">' + (opts.introArt || '') + '</div>' +
          '<div class="tg-step"></div><h2 class="tg-title" id="tg-title"></h2><div class="tg-body" aria-live="polite"></div>' +
          '<div class="tg-bar"><i></i></div>' +
          '<div class="tg-foot">' +
            '<button class="tg-skip" type="button">' + esc(L.skip) + '</button>' +
            '<button class="tg-btn tg-later" type="button">' + esc(L.later) + '</button>' +
            '<button class="tg-btn tg-prev" type="button">' + esc(L.prev) + '</button>' +
            '<button class="tg-btn tg-primary tg-next" type="button">' + esc(L.next) + '</button>' +
          '</div>' +
          '<div class="tg-meta">' + esc(fmt(L.meta)) + '</div>' +
        '</div>';
      document.body.appendChild(root);
      block = root.querySelector('.tg-block');
      spot = root.querySelector('.tg-spot');
      card = root.querySelector('.tg-card');
      card.querySelector('.tg-skip').onclick = function(){ end('skip'); };
      card.querySelector('.tg-later').onclick = function(){ end('later'); };
      card.querySelector('.tg-prev').onclick = function(){ go(idx - 1); };
      card.querySelector('.tg-next').onclick = function(){ if(idx >= STEPS.length - 1) end('done'); else go(idx + 1); };
    }

    /* ── 找目標元素：選擇器 / 元素 / 元素陣列 / 回傳以上任一種的函式 ── */
    function resolveTargets(step){
      var t = step.target;
      if(!t) return null;
      var v = (typeof t === 'function') ? t() : t;
      var arr = Array.isArray(v) ? v : [v];
      arr = arr.map(toEl).filter(function(el){ return el && visible(el); });
      return arr.length ? arr : null;
    }
    function unionRect(els){
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      els.forEach(function(el){
        var r = el.getBoundingClientRect();
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
      });
      return { left:x0, top:y0, right:x1, bottom:y1, width:x1-x0, height:y1-y0 };
    }

    /* ── 每一幀重新排：打亮框貼著目標、說明框挑放得下的那一邊 ── */
    function layout(){
      if(!active) return;
      var step = STEPS[idx], vw = window.innerWidth, vh = window.innerHeight, M = 12;
      // 頁面重畫、目標被換掉時重新抓一次
      if(curTargets && (step.anim || curTargets.some(function(el){ return !el.isConnected; }))){
        var re = resolveTargets(step); if(re) curTargets = re;
      }
      var cw = card.offsetWidth, ch = card.offsetHeight, x, y;
      block.style.background = curTargets ? 'transparent' : 'var(--tg-backdrop)';
      if(!curTargets){
        spot.classList.add('tg-none');
        x = (vw - cw)/2; y = (vh - ch)/2;
      } else {
        var pad = (step.pad != null) ? step.pad : 6;
        var r = unionRect(curTargets);
        var sx = Math.max(4, r.left - pad), sy = Math.max(4, r.top - pad);
        var sw = Math.min(vw - 4, r.right + pad) - sx, sh = Math.min(vh - 4, r.bottom + pad) - sy;
        spot.classList.remove('tg-none');
        spot.style.left = sx + 'px'; spot.style.top = sy + 'px';
        spot.style.width = sw + 'px'; spot.style.height = sh + 'px';
        var gap = 14;
        var room = { right: vw - (sx+sw) - gap - M, left: sx - gap - M, bottom: vh - (sy+sh) - gap - M, top: sy - gap - M };
        var order = [step.place || 'right', 'right', 'left', 'bottom', 'top'];
        var place = null;
        for(var i = 0; i < order.length; i++){
          var p = order[i];
          if((p === 'right' || p === 'left') && room[p] >= cw){ place = p; break; }
          if((p === 'top' || p === 'bottom') && room[p] >= ch){ place = p; break; }
        }
        if(place === 'right'){ x = sx + sw + gap; y = sy + sh/2 - ch/2; }
        else if(place === 'left'){ x = sx - gap - cw; y = sy + sh/2 - ch/2; }
        else if(place === 'bottom'){ x = sx + sw/2 - cw/2; y = sy + sh + gap; }
        else if(place === 'top'){ x = sx + sw/2 - cw/2; y = sy - gap - ch; }
        else { x = vw - cw - M; y = vh - ch - M; }   // 哪邊都放不下：右下角
      }
      card.style.left = Math.max(M, Math.min(vw - cw - M, x)) + 'px';
      card.style.top = Math.max(M, Math.min(vh - ch - M, y)) + 'px';
    }
    // 換步驟的過程中不排版，避免框框先往別的地方跑一下
    function loop(){ if(!busy) layout(); raf = requestAnimationFrame(loop); }

    /* ── 示範動畫：假游標 ── */
    function makeCursor(){
      if(cursorEl) return;
      cursorEl = document.createElement('div');
      cursorEl.className = 'tg-cursor';
      cursorEl.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30" aria-hidden="true"><path d="M3 2v22l6-6 4.5 9.5 4-2L13 16h9z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="tg-ripple"></span>';
      root.appendChild(cursorEl);
      chipEl = document.createElement('div');
      chipEl.className = 'tg-chip';
      root.appendChild(chipEl);
    }
    function hideCursor(){
      if(cursorEl) cursorEl.style.opacity = '0';
      if(chipEl) chipEl.style.opacity = '0';
    }

    /* 動畫裡拿到的 a。每個方法都會檢查「這一步還在不在」，換步驟/結束就自動中止。 */
    function Anim(token){
      var self = this, x = window.innerWidth * 0.6, y = window.innerHeight * 0.7, chipOn = false;
      function alive(){ if(token !== animToken || !active) throw ABORT; }
      function place(){
        cursorEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        if(chipOn) chipEl.style.transform = 'translate(' + (x + 16) + 'px,' + (y + 20) + 'px)';
      }
      self.alive = alive;
      self.wait = function(ms){
        return new Promise(function(res, rej){ setTimeout(function(){ try{ alive(); res(); }catch(e){ rej(e); } }, ms); });
      };
      self.show = function(px, py){
        alive();
        if(typeof px !== 'number'){ var c = center(px); px = c.x; py = c.y; }
        x = px; y = py; place(); cursorEl.style.opacity = '1';
        return Promise.resolve();
      };
      self.hide = function(){ hideCursor(); chipOn = false; return Promise.resolve(); };
      /* 平滑移動到 (tx,ty) 或某個元素中心；onStep(x,y) 每一幀呼叫一次 */
      self.move = function(tx, ty, ms, onStep){
        alive();
        if(typeof tx !== 'number'){ var c = center(tx); onStep = ms; ms = ty; tx = c.x; ty = c.y; }
        cursorEl.style.opacity = '1';   // 沒先 show() 也看得到游標
        var sx = x, sy = y, t0 = performance.now(), dur = ms || 600;
        return new Promise(function(res, rej){
          (function frame(now){
            try{ alive(); }catch(e){ return rej(e); }
            var k = Math.min(1, (now - t0) / dur);
            var e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2;
            x = sx + (tx - sx) * e; y = sy + (ty - sy) * e; place();
            if(onStep) onStep(x, y);
            if(k < 1) requestAnimationFrame(frame); else res();
          })(t0);
        });
      };
      self.ripple = function(){
        var r = cursorEl.querySelector('.tg-ripple');
        r.classList.remove('go'); void r.offsetWidth; r.classList.add('go');
      };
      /* 移到元素上、按一下。real:true 會真的觸發 click；預設只有按下去的效果 */
      self.click = function(el, o){
        o = o || {};
        el = toEl(el); if(!el) return self.wait(300);
        return self.move(el, o.ms || 600).then(function(){
          self.ripple();
          el.style.transition = 'transform .12s'; el.style.transform = 'scale(.94)';
          return self.wait(140);
        }).then(function(){
          el.style.transform = '';
          if(o.real) el.click();
          return self.wait(o.after != null ? o.after : 300);
        });
      };
      /* 在輸入框一個字一個字打字（會觸發 input 事件，頁面上的即時預覽會跟著變） */
      self.type = function(input, text, o){
        o = o || {};
        input = toEl(input); if(!input) return self.wait(300);
        var speed = o.speed || 90;
        var setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
        function set(v){
          if(setter && setter.set) setter.set.call(input, v); else input.value = v;
          input.dispatchEvent(new Event('input', { bubbles:true }));
        }
        var p = (o.moveFirst === false) ? Promise.resolve() : self.click(input, { after: 150 });
        return p.then(function(){
          if(o.clear !== false) set('');
          var i = 0;
          return new Promise(function(res, rej){
            (function next(){
              try{ alive(); }catch(e){ return rej(e); }
              if(i >= text.length){ input.dispatchEvent(new Event('change', { bubbles:true })); return res(); }
              set(input.value + text.charAt(i++));
              setTimeout(next, speed);
            })();
          });
        });
      };
      /* 拖曳：從 from 拖到 to（元素或 {x,y}）。
         pointer:true 會對 from 送 pointerdown/move/up，讓頁面真的跟著動；
         chip:'文字/HTML' 會在游標旁邊顯示一個「拿著的東西」 */
      self.drag = function(from, to, o){
        o = o || {};
        var fromEl = (from && from.x == null) ? toEl(from) : null;
        var p0 = fromEl ? center(fromEl) : from, p1 = (to && to.x == null) ? center(to) : to;
        var evTarget = o.target ? toEl(o.target) : fromEl;
        return self.move(p0.x, p0.y, o.approachMs || 600).then(function(){
          if(o.chip) self.chip(o.chip);
          if(o.pointer && evTarget) firePointer(evTarget, 'pointerdown', p0.x, p0.y);
          return self.wait(150);
        }).then(function(){
          return self.move(p1.x, p1.y, o.ms || 900, function(cx, cy){
            if(o.pointer && evTarget) firePointer(evTarget, 'pointermove', cx, cy);
            if(o.onMove) o.onMove(cx, cy);
          });
        }).then(function(){
          if(o.pointer && evTarget) firePointer(evTarget, 'pointerup', p1.x, p1.y);
          if(o.chip) self.dropChip();
          self.ripple();
          return self.wait(o.after != null ? o.after : 300);
        });
      };
      self.chip = function(html){ chipEl.innerHTML = html; chipOn = true; chipEl.style.opacity = '1'; place(); };
      self.dropChip = function(){ chipOn = false; chipEl.style.opacity = '0'; };
      self.pos = function(){ return { x:x, y:y }; };
    }

    function startAnim(){
      var token = ++animToken;
      var step = STEPS[idx];
      if(!step || !step.anim || (opts.respectReducedMotion !== false && reducedMotion())){ hideCursor(); return; }
      makeCursor();
      var a = new Anim(token);
      (function loopAnim(){
        Promise.resolve().then(function(){ return step.anim(a, api); })
          .then(function(){ if(step.animOnce) throw ABORT; return a.wait(step.animPause != null ? step.animPause : opts.animPause); })
          .then(loopAnim)
          .catch(function(e){
            if(e !== ABORT) console.warn('[TourGuide 動畫]', e);
            if(token === animToken) hideCursor();
          });
      })();
    }
    function stopAnim(){ animToken++; hideCursor(); }

    /* ── 換步驟 ── */
    function go(n){
      if(!active || busy || n < 0 || n >= STEPS.length) return;
      busy = true;
      stopAnim();
      var prev = STEPS[idx];
      var changing = idx !== n;
      Promise.resolve(changing && prev && prev.after ? prev.after(api) : null).then(function(){
        idx = n;
        var step = STEPS[idx];
        return Promise.resolve(step.before ? step.before(api) : null);
      }).then(function(){
        var step = STEPS[idx];
        return step.target ? waitFor(function(){ return resolveTargets(step); }, step.waitTimeout || opts.waitTimeout) : null;
      }).then(function(targets){
        curTargets = targets;
        var step = STEPS[idx];
        if(step.target && !targets) console.warn('[TourGuide] 第 ' + (idx + 1) + ' 步找不到目標元素，改成置中顯示：', step.target);
        if(targets && targets[0] && step.scroll !== false){
          targets[targets.length - 1].scrollIntoView({ block:'nearest' });
          targets[0].scrollIntoView({ block:'nearest' });
          var r = unionRect(targets);
          if(r.top < 60 || r.bottom > window.innerHeight - 20) targets[0].scrollIntoView({ block:'center' });
        }
        card.querySelector('.tg-step').textContent = fmt(L.stepOf, { n: idx + 1 });
        card.querySelector('.tg-title').textContent = step.title || '';
        card.querySelector('.tg-body').innerHTML = step.body || '';
        card.querySelector('.tg-bar i').style.width = ((idx + 1) / STEPS.length * 100) + '%';
        card.querySelector('.tg-prev').disabled = (idx === 0);
        card.classList.toggle('tg-intro', !!step.intro);
        root.classList.toggle('tg-pass', !!step.interactive);
        card.querySelector('.tg-next').textContent = step.intro ? L.start : ((idx === STEPS.length - 1) ? L.done : L.next);
        layout();
        busy = false;
        try{ card.querySelector('.tg-next').focus({ preventScroll:true }); }catch(e){}
        if(opts.onStep) try{ opts.onStep(idx, step); }catch(e){ console.warn(e); }
        startAnim();
      }).catch(function(e){ console.warn('[TourGuide]', e); busy = false; });
    }

    function onKey(e){
      if(!active) return;
      // 導覽中鍵盤一律攔下來，不讓頁面的快捷鍵去動到資料
      e.stopPropagation(); e.stopImmediatePropagation();
      if(e.key === 'ArrowRight' || e.key === 'Enter'){ e.preventDefault(); card.querySelector('.tg-next').click(); }
      else if(e.key === 'ArrowLeft'){ e.preventDefault(); go(idx - 1); }
      else if(e.key === 'Escape'){ e.preventDefault(); end('escape'); }
      else if(e.key === 'Tab'){
        // 焦點只在說明框裡面繞
        var f = Array.prototype.filter.call(card.querySelectorAll('button'), function(b){ return !b.disabled && b.offsetParent; });
        if(!f.length) return;
        e.preventDefault();
        var i = f.indexOf(document.activeElement);
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    }

    /* ── 開始 / 結束 ── */
    function start(at){
      if(active || !STEPS.length) return Promise.resolve();
      if(activeTour && activeTour !== api) activeTour.end('api');
      build();
      var loading = null;
      var pre = opts.onStart ? opts.onStart(api) : null;
      if(pre && typeof pre.then === 'function'){
        loading = document.createElement('div');
        loading.className = 'tg-loading';
        loading.textContent = L.loading;
        root.style.display = '';
        card.style.visibility = 'hidden';
        root.appendChild(loading);
      }
      return Promise.resolve(pre).then(function(){
        if(loading){ loading.remove(); card.style.visibility = ''; }
        root.style.display = '';
        active = true; activeTour = api; idx = 0; curTargets = null;
        if(opts.keyboard) document.addEventListener('keydown', onKey, true);
        cancelAnimationFrame(raf); loop();
        go(typeof at === 'number' ? at : 0);
      }).catch(function(e){
        console.warn('[TourGuide] onStart 失敗，導覽取消：', e);
        if(loading) loading.remove();
        root.style.display = 'none';
      });
    }

    function end(reason){
      if(!active) return;
      stopAnim();
      var step = STEPS[idx];
      try{ if(step && step.after) step.after(api); }catch(e){ console.warn(e); }
      active = false; activeTour = null;
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      if(root) root.style.display = 'none';
      if(opts.storageKey) lsSet(opts.storageKey, '1');
      if(opts.onEnd) try{ opts.onEnd(reason || 'api', api); }catch(e){ console.warn(e); }
    }

    function hasSeen(){ return !!(opts.storageKey && lsGet(opts.storageKey) === '1'); }

    function addLaunchButton(){
      var lb = opts.launchButton;
      if(!lb) return null;
      var bar = toEl(lb.container);
      if(!bar) { console.warn('[TourGuide] 找不到放「使用教學」按鈕的位置：', lb.container); return null; }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = lb.className || '';
      btn.setAttribute('data-tour-launch', '');
      btn.innerHTML = lb.html || (ICON_HELP + '<span>' + esc(lb.text || L.launch) + '</span>');
      btn.addEventListener('click', function(){ start(); });
      if(lb.prepend === false) bar.appendChild(btn); else bar.insertBefore(btn, bar.firstChild);
      return btn;
    }

    var api = {
      version: VERSION,
      start: start,
      end: function(reason){ end(reason || 'api'); },
      go: go,
      next: function(){ go(idx + 1); },
      prev: function(){ go(idx - 1); },
      isActive: function(){ return active; },
      index: function(){ return idx; },
      steps: STEPS,
      hasSeen: hasSeen,
      resetSeen: function(){ if(opts.storageKey) lsDel(opts.storageKey); },
      refresh: function(){ layout(); },
      launchButton: null
    };

    function init(){
      api.launchButton = addLaunchButton();
      var forced = opts.forceParam && new RegExp('[?&]' + opts.forceParam + '(=|&|$)').test(location.search);
      if(forced || (opts.autoStart && opts.storageKey && !hasSeen())){
        setTimeout(function(){ start(); }, opts.startDelay);
      }
    }
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    return api;
  }

  global.TourGuide = {
    version: VERSION,
    create: create,
    helpers: { $: $, wait: wait, waitFor: waitFor, byText: byText, visible: visible, center: center, firePointer: firePointer }
  };
})(window);
