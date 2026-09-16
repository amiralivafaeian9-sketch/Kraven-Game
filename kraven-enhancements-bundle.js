/* =========================================================
   KRAVEN GAME V17 — Motion Background + Tactile Click Sound
   No external libraries. Delegated events. Single RAF scheduler.
   ========================================================= */
(function () {
  'use strict';

  var reducedMotion = false;
  try {
    reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {}

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function make(tag, attrs, parent) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      if (key === 'text') el.textContent = attrs[key];
      else el.setAttribute(key, attrs[key]);
    });
    if (parent) parent.appendChild(el);
    return el;
  }

  /* ---------------------------------------------------------
     1) Motion Background
     --------------------------------------------------------- */
  function initMotionBackground() {
    if (reducedMotion || !window.DeviceOrientationEvent) return;

    var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!isTouch) return;

    var layer = document.createElement('div');
    layer.id = 'kraven-motion-layer';
    layer.setAttribute('aria-hidden', 'true');

    var orb = make('div', { class: 'kraven-motion-orb' }, layer);
    make('div', { class: 'kraven-motion-core' }, orb);

    // Insert behind the app without touching existing page markup.
    document.body.insertBefore(layer, document.body.firstChild);

    var control = make('div', { id: 'kraven-motion-control', 'data-state': 'off' }, document.body);
    make('span', { text: '📱 حرکت پس‌زمینه' }, control);
    var action = make('button', { type: 'button', text: 'فعال‌سازی' }, control);

    var targetX = 0;
    var targetY = 0;
    var currentX = 0;
    var currentY = 0;
    var rafId = 0;
    var listening = false;
    var enabled = false;
    var maxX = 42;
    var maxY = 34;

    function paint() {
      rafId = 0;
      currentX += (targetX - currentX) * 0.14;
      currentY += (targetY - currentY) * 0.14;
      orb.style.setProperty('--mx', currentX.toFixed(2) + 'px');
      orb.style.setProperty('--my', currentY.toFixed(2) + 'px');
      orb.style.setProperty('--m-scale', (1 + Math.min(0.045, (Math.abs(currentX) + Math.abs(currentY)) / 2200)).toFixed(4));

      if (Math.abs(targetX - currentX) > 0.08 || Math.abs(targetY - currentY) > 0.08) {
        rafId = window.requestAnimationFrame(paint);
      }
    }

    function schedulePaint() {
      if (!rafId) rafId = window.requestAnimationFrame(paint);
    }

    function onOrientation(e) {
      if (!enabled) return;
      var gamma = Number.isFinite(e.gamma) ? e.gamma : 0; // left/right
      var beta = Number.isFinite(e.beta) ? e.beta : 0;   // front/back
      var x = Math.max(-1, Math.min(1, gamma / 45));
      var y = Math.max(-1, Math.min(1, (beta - 45) / 45));
      targetX = x * maxX;
      targetY = y * maxY;
      schedulePaint();
    }

    function startListening() {
      if (listening) return;
      window.addEventListener('deviceorientation', onOrientation, { passive: true });
      listening = true;
      enabled = true;
      control.dataset.state = 'on';
      action.textContent = 'فعال شد ✓';
      schedulePaint();
    }

    function showControl() {
      // Only show the chip on mobile/touch devices. On browsers that expose
      // permission APIs, the chip is the user's activation gesture.
      control.classList.add('show');
    }

    function enableMotion() {
      if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
        window.DeviceOrientationEvent.requestPermission()
          .then(function (state) {
            if (state === 'granted') startListening();
            else action.textContent = 'اجازه لازم است';
          })
          .catch(function () { action.textContent = 'دوباره امتحان کن'; });
      } else {
        startListening();
      }
    }

    action.addEventListener('click', enableMotion, { passive: true });

    // iOS Safari needs a user gesture; other browsers can start immediately.
    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      showControl();
    } else {
      try { startListening(); } catch (_) { showControl(); }
    }

    window.addEventListener('pagehide', function () {
      if (listening) {
        window.removeEventListener('deviceorientation', onOrientation);
        listening = false;
      }
      if (rafId) { window.cancelAnimationFrame(rafId); rafId = 0; }
    }, { once: true, passive: true });
  }

  /* ---------------------------------------------------------
     2) Tactile Click Sound
     Uses the user's supplied local MP3. One HTMLAudioElement,
     delegated click listener, and an 85ms rate limit.
     --------------------------------------------------------- */
  function initClickSound() {
    var SOUND_URL = './assets/sfx/kraven-click.mp3';
    var audioFallback = new Audio(SOUND_URL);
    audioFallback.preload = 'auto';
    audioFallback.volume = 0.38;
    audioFallback.setAttribute('aria-hidden', 'true');

    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    var ctx = null;
    var buffer = null;
    var loading = null;
    var lastPlayed = -Infinity;
    var minGap = 38; // very small guard; repeated taps remain responsive

    function shouldPlay(target) {
      if (!target || !target.closest) return false;
      var el = target.closest('button, a, [role="button"], summary, select, input[type="button"], input[type="submit"], .game-card, .icon-btn, .page-btn, .sidebar-nav a');
      if (!el) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      if (el.dataset && el.dataset.noClickSound === 'true') return false;
      return el;
    }

    function ensureContext() {
      if (!AudioCtx) return null;
      if (!ctx) {
        try { ctx = new AudioCtx(); } catch (_) { return null; }
      }
      if (ctx.state === 'suspended') {
        try { ctx.resume(); } catch (_) {}
      }
      return ctx;
    }

    // Decode in advance so normal clicks never wait for MP3 decoding.
    function preloadBuffer() {
      if (!AudioCtx || loading || buffer) return;
      loading = fetch(SOUND_URL, { cache: 'force-cache' })
        .then(function (r) { if (!r.ok) throw new Error('sfx fetch failed'); return r.arrayBuffer(); })
        .then(function (data) {
          var c = ensureContext();
          if (!c) return null;
          return c.decodeAudioData(data);
        })
        .then(function (decoded) { if (decoded) buffer = decoded; })
        .catch(function () {})
        .finally(function () { loading = null; });
    }

    function fallbackPlay() {
      try {
        audioFallback.currentTime = 0;
        var promise = audioFallback.play();
        if (promise && typeof promise.catch === 'function') promise.catch(function () {});
      } catch (_) {}
    }

    function playNow() {
      try { if (localStorage.getItem('kraven_v18_state')) { var st = JSON.parse(localStorage.getItem('kraven_v18_state')); if (st && st.audio === false) return; } } catch (_) {}
      var now = performance.now();
      if (now - lastPlayed < minGap) return;
      lastPlayed = now;

      var c = ensureContext();
      if (c && buffer) {
        try {
          var src = c.createBufferSource();
          var gain = c.createGain();
          src.buffer = buffer;
          gain.gain.value = 0.52;
          src.connect(gain);
          gain.connect(c.destination);
          src.start(0); // start immediately on this user gesture
          return;
        } catch (_) {}
      }
      fallbackPlay();
    }

    function handlePointerDown(e) {
      var el = shouldPlay(e.target);
      if (!el) return;
      // pointerdown fires at physical press/touch time — noticeably earlier than click.
      playNow();

      if (!reducedMotion && el.classList && !el.classList.contains('game-card')) {
        el.classList.remove('kraven-sfx-pop');
        el.style.setProperty('--kraven-sfx-scale', '1');
        window.requestAnimationFrame(function () { el.classList.add('kraven-sfx-pop'); });
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, { passive: true, capture: true });

    // Keyboard activation still gets an instant sound.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var active = document.activeElement;
      if (active && shouldPlay(active)) playNow();
    }, { passive: true, capture: true });

    // Start decoding immediately while the browser is idle; no playback occurs here.
    preloadBuffer();
    try { audioFallback.load(); } catch (_) {}
  }

  onReady(function () {
    initClickSound();
    initMotionBackground();
  });
})();
/* =========================================================
   KRAVEN GAME V18 — Professional Platform Experience
   Additive, local-first, performance-safe layer.
   ========================================================= */
(function(){
  'use strict';

  const KEY = 'kraven_v18_state';
  const state = (()=>{
    try { return Object.assign({audio:true, motion:true, recent:[], sessions:0}, JSON.parse(localStorage.getItem(KEY)||'{}')); }
    catch { return {audio:true,motion:true,recent:[],sessions:0}; }
  })();
  const save=()=>{ try{localStorage.setItem(KEY,JSON.stringify(state));}catch{} };
  const $=(s,r=document)=>r.querySelector(s);
  const esc=(s)=>{const d=document.createElement('div');d.textContent=s??'';return d.innerHTML;};
  const isHome=()=>$('#page-home')?.classList.contains('active');

  // 1) Legacy V18 sort helper retained; V19 overrides the first-load default to NEWEST.
  function setOldestDefault(){
    const sel=$('#sort-filter'); if(!sel) return;
    if(!localStorage.getItem('kraven_v18_sort_initialized')){
      sel.value='newest';
      localStorage.setItem('kraven_v18_sort_initialized','1');
      sel.dispatchEvent(new Event('change'));
    }
  }
  const originalClear=window._clearGameFilters;
  window._clearGameFilters=function(){
    if(typeof originalClear==='function') originalClear();
    const sel=$('#sort-filter'); if(sel){sel.value='newest';sel.dispatchEvent(new Event('change'));}
  };

  // 2) Lightweight local recent history + recommendation engine.
  function pushRecent(id){
    if(!id) return;
    state.recent=[id].concat((state.recent||[]).filter(x=>x!==id)).slice(0,12);
    save();
  }
  const originalNav=window._navigateToGame;
  if(typeof originalNav==='function'){
    window._navigateToGame=function(id){ pushRecent(id); state.sessions=(state.sessions||0)+1; save(); return originalNav.apply(this,arguments); };
  }
  function getGamesSafe(){
    try{return typeof getGames==='function'?getGames():Promise.resolve([]);}catch{return Promise.resolve([])}
  }
  function likedIds(){try{return Object.keys(JSON.parse(localStorage.getItem('kraven_likes')||'{}')).filter(k=>JSON.parse(localStorage.getItem('kraven_likes')||'{}')[k]);}catch{return[]}}
  function card(g){
    const img=g.imageData?`<img src="${g.imageData}" loading="lazy" decoding="async" alt="${esc(g.title||'بازی')}" />`:'<div class="v18-cover-placeholder">🎮</div>';
    return `<article class="v18-game-card" data-v18-game="${esc(g.id)}"><div class="v18-cover">${img}</div><div class="v18-g-body"><div class="v18-g-title">${esc(g.title||'بدون عنوان')}</div><div class="v18-g-meta">${esc(g.genre||'Gaming')} • ${esc(String(g.year||'—'))}</div><div class="v18-g-score">★ ${esc(String(g.rating||'0.0'))}</div></div></article>`;
  }
  async function renderProSections(){
    const anchor=$('#games-grid'); if(!anchor || !isHome()) return;
    let wrap=$('#v18-pro-sections');
    if(!wrap){
      wrap=document.createElement('div'); wrap.id='v18-pro-sections';
      wrap.innerHTML=`
        <section class="v18-section" id="v18-continue-section">
          <div class="v18-head"><div><span class="v18-kicker">CONTINUE</span><h2>▶️ ادامه بده</h2><p>آخرین بازی‌هایی که باز کردی، همین‌جا آماده‌اند.</p></div></div><div class="v18-rail" id="v18-continue"></div>
        </section>
        <section class="v18-section">
          <div class="v18-head"><div><span class="v18-kicker">SMART PICKS</span><h2>🎯 پیشنهادهای هوشمند</h2><p>بر پایه‌ی علاقه‌مندی‌ها و بازی‌هایی که اخیراً دیدی.</p></div></div><div class="v18-rail" id="v18-recommendations"></div>
        </section>
        <section class="v18-section">
          <div class="v18-head"><div><span class="v18-kicker">LOCAL ANALYTICS</span><h2>📊 آمار Kraven</h2><p>آمار شخصی این مرورگر؛ بدون سرویس خارجی.</p></div></div><div class="v18-analytics" id="v18-analytics"></div>
        </section>`;
      anchor.insertAdjacentElement('afterend',wrap);
      wrap.addEventListener('click',e=>{const c=e.target.closest('[data-v18-game]');if(c)window._navigateToGame?.(c.dataset.v18Game);});
    }
    const games=await getGamesSafe(); if(!Array.isArray(games)) return;
    const map=new Map(games.map(g=>[String(g.id),g]));
    const recent=(state.recent||[]).map(id=>map.get(String(id))).filter(Boolean).slice(0,6);
    $('#v18-continue').innerHTML=recent.length?recent.map(card).join(''):'<div class="v18-empty">هنوز بازی‌ای برای ادامه دادن نداریم؛ یک بازی را باز کن تا این بخش شروع به کار کند 🎮</div>';
    const liked=likedIds();
    const genres=liked.map(id=>map.get(id)?.genre).filter(Boolean);
    let rec=games.filter(g=>!liked.includes(String(g.id)) && genres.includes(g.genre));
    if(rec.length<6){
      const recentGenres=recent.map(g=>g.genre).filter(Boolean);
      rec=rec.concat(games.filter(g=>!rec.includes(g)&&!liked.includes(String(g.id))&&recentGenres.includes(g.genre)));
    }
    if(rec.length<6){
      rec=rec.concat(games.filter(g=>!rec.includes(g)&&!liked.includes(String(g.id))).sort((a,b)=>Number(b.rating||0)-Number(a.rating||0)));
    }
    rec=rec.slice(0,6);
    $('#v18-recommendations').innerHTML=rec.length?rec.map(card).join(''):'<div class="v18-empty">برای پیشنهاد شخصی، چند بازی را ببین یا لایک کن.</div>';

    const views=(()=>{try{return JSON.parse(localStorage.getItem('kraven_views')||'{}')}catch{return{}}})();
    const viewCount=Object.values(views).reduce((a,b)=>a+Number(b||0),0);
    const likes=liked.length;
    const uniqueSeen=Object.keys(views).length;
    const topId=Object.entries(views).sort((a,b)=>Number(b[1])-Number(a[1]))[0]?.[0];
    const topGame=map.get(String(topId));
    $('#v18-analytics').innerHTML=`
      <div class="v18-stat"><strong>${uniqueSeen}</strong><span>بازی دیده‌شده</span></div>
      <div class="v18-stat"><strong>${viewCount}</strong><span>بازدید ثبت‌شده</span></div>
      <div class="v18-stat"><strong>${likes}</strong><span>علاقه‌مندی</span></div>
      <div class="v18-stat"><strong>${state.sessions||0}</strong><span>ورود به صفحه بازی</span></div>
      <div class="v18-stat v18-wide"><strong>${esc(topGame?.title||'—')}</strong><span>پربازدیدترین بازی این مرورگر</span></div>`;
  }

  // 3) Professional experience controls: audio + motion, stored locally.
  function patchK10Settings(){
    const settingsPanel=document.querySelector('.k10-panel[data-panel="settings"]');
    if(!settingsPanel || settingsPanel.querySelector('#v18-audio-toggle')) return;
    const box=document.createElement('div'); box.className='v18-settings-box';
    box.innerHTML=`<div class="v18-setting-row"><div><b>🔊 صدای تعامل</b><small>صدای کلیک و بازخورد لمسی</small></div><button id="v18-audio-toggle" class="v18-toggle ${state.audio?'on':''}" type="button">${state.audio?'روشن':'خاموش'}</button></div>
      <div class="v18-setting-row"><div><b>📱 Motion Background</b><small>حرکت زنده‌ی پس‌زمینه روی موبایل</small></div><button id="v18-motion-toggle" class="v18-toggle ${state.motion?'on':''}" type="button">${state.motion?'روشن':'خاموش'}</button></div>`;
    settingsPanel.prepend(box);
    $('#v18-audio-toggle').onclick=()=>{state.audio=!state.audio;save();document.documentElement.classList.toggle('v18-audio-off',!state.audio);const b=$('#v18-audio-toggle');b.classList.toggle('on',state.audio);b.textContent=state.audio?'روشن':'خاموش';};
    $('#v18-motion-toggle').onclick=()=>{state.motion=!state.motion;save();document.documentElement.classList.toggle('v18-motion-off',!state.motion);const b=$('#v18-motion-toggle');b.classList.toggle('on',state.motion);b.textContent=state.motion?'روشن':'خاموش';};
  }
  function addProBadge(){
    if($('#v18-pro-launch')) return;
    const bar=document.getElementById('v5-appbar');
    if(!bar) return;
    const b=document.createElement('button'); b.id='v18-pro-launch'; b.className='v5-pill primary'; b.textContent='⚡ Kraven Pro';
    b.onclick=()=>{const btn=document.querySelector('[data-k10-open="discovery"]'); if(btn) btn.click(); else document.getElementById('hamburger-btn')?.click();};
    bar.appendChild(b);
  }

  // 4) Image performance: lazy-load non-critical media and remove eager decode pressure.
  function optimizeImages(){
    document.querySelectorAll('img').forEach(img=>{
      if(!img.hasAttribute('decoding')) img.setAttribute('decoding','async');
      if(!img.closest('#loading-screen,header,.logo,.game-detail-header') && !img.hasAttribute('loading')) img.loading='lazy';
    });
  }

  function boot(){
    setOldestDefault();
    document.documentElement.classList.toggle('v18-audio-off',!state.audio);
    document.documentElement.classList.toggle('v18-motion-off',!state.motion);
    optimizeImages();
    patchK10Settings(); addProBadge();
    if(isHome()) setTimeout(renderProSections,450);
    const refresh=()=>{setOldestDefault();patchK10Settings();addProBadge();optimizeImages();if(isHome())setTimeout(renderProSections,180);};
    window.addEventListener('hashchange',refresh,{passive:true});
    window.addEventListener('kraven:navigate',refresh,{passive:true});
    window.addEventListener('kraven:v17:ready',refresh,{passive:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
/* =========================================================
   KRAVEN GAME V20 — Professional UX Layer
   Theme: Dark/White dual mode, Command Search, Quick Preview,
   Library-style shortcuts, lightweight performance telemetry.
   ========================================================= */
(function(){
  'use strict';
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const THEME_KEY='kraven_v19_mode';
  const state={mode:localStorage.getItem(THEME_KEY)||'dark',previewId:null};
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const safe=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const games=()=>{try{return typeof getGames==='function'?Promise.resolve(getGames()):Promise.resolve([])}catch{return Promise.resolve([])}};

  function applyMode(mode){
    state.mode=mode==='light'?'light':'dark';
    document.documentElement.classList.toggle('kraven-light',state.mode==='light');
    document.body.classList.toggle('kraven-light',state.mode==='light');
    localStorage.setItem(THEME_KEY,state.mode);
    const b=$('#k19-theme-toggle'); if(b){b.querySelector('.ico').textContent=state.mode==='light'?'🌙':'☀️';b.querySelector('.label').textContent=state.mode==='light'?'حالت تیره':'حالت سفید';b.setAttribute('aria-label',state.mode==='light'?'بازگشت به حالت تیره':'فعال‌سازی حالت سفید');}
  }
  function mountTheme(){
    const old=$('#theme-btn'); if(!old) return;
    const b=document.createElement('button');b.id='k19-theme-toggle';b.className='k19-theme-toggle';b.type='button';b.innerHTML='<span class="ico"></span><span class="label"></span>';
    old.replaceWith(b);b.addEventListener('click',()=>applyMode(state.mode==='light'?'dark':'light'));
    applyMode(state.mode);
  }

  async function buildCommand(){
    if($('#k19-command'))return;
    const o=document.createElement('div');o.id='k19-command';o.className='k19-command';
    o.innerHTML='<div class="k19-command-box" role="dialog" aria-modal="true" aria-label="جستجوی Kraven"><div class="k19-command-top"><input id="k19-cmd-input" placeholder="جستجوی بازی، ژانر، سازنده…" autocomplete="off"><span class="k19-command-hint">ESC برای بستن</span></div><div class="k19-results" id="k19-results"></div></div>';
    document.body.appendChild(o);
    const inp=$('#k19-cmd-input');
    const render=async q=>{
      const all=await games(); const s=q.trim().toLowerCase();
      const list=all.filter(g=>!s||[g.title,g.genre,g.developer,g.platform,g.mode].some(x=>String(x||'').toLowerCase().includes(s))).slice(0,18);
      $('#k19-results').innerHTML=list.length?list.map(g=>`<button class="k19-result" data-gid="${safe(g.id)}"><img src="${safe(g.imageData||'')}" loading="lazy" decoding="async"><span><b>${safe(g.title||'بدون عنوان')}</b><span>${safe([g.genre,g.year,g.platform].filter(Boolean).join(' • ')||'Game')}</span></span></button>`).join(''):'<div style="padding:20px;text-align:center;color:var(--text-muted);font:.75rem var(--font)">نتیجه‌ای پیدا نشد.</div>';
    };
    inp.addEventListener('input',()=>render(inp.value));
    o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open');const r=e.target.closest('.k19-result');if(r){o.classList.remove('open');window._v19Preview(r.dataset.gid);}});
    window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();o.classList.add('open');inp.focus();render('')}if(e.key==='Escape')o.classList.remove('open')});
    window._v19OpenSearch=()=>{o.classList.add('open');inp.focus();render(inp.value)};
  }

  function mountQuickPreview(){
    if($('#k19-preview'))return;
    const o=document.createElement('div');o.id='k19-preview';o.className='k19-preview';o.innerHTML='<div class="k19-preview-card"><button class="icon-btn k19-preview-close" id="k19-preview-close">✕</button><div id="k19-preview-body"></div></div>';
    document.body.appendChild(o);$('#k19-preview-close').addEventListener('click',()=>o.classList.remove('open'));o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('open')});
  }
  window._v19Preview=async function(id){
    const all=await games(),g=all.find(x=>String(x.id)===String(id));if(!g)return;
    const o=$('#k19-preview'); if(!o)return; state.previewId=id;
    $('#k19-preview-body').innerHTML=`<div class="k19-preview-media"><img src="${safe(g.imageData||'')}" alt="${safe(g.title)}" loading="eager"><div class="k19-preview-side"><div><div style="font:.66rem var(--font);color:var(--accent);font-weight:900;letter-spacing:.8px">KRAVEN QUICK VIEW</div><h2>${safe(g.title||'بدون عنوان')}</h2><div class="k19-preview-meta">${[g.genre,g.year,g.platform,g.mode].filter(Boolean).map(x=>`<span class="k19-chip">${safe(x)}</span>`).join('')}</div><p style="margin-top:12px;font:.77rem/2 var(--font);color:var(--text-secondary)">${safe(g.shortDesc||'اطلاعات کوتاه بازی در دسترس نیست.')}</p></div><div class="k19-preview-actions"><button class="btn btn-primary" id="k19-open-game">🎮 صفحه بازی</button><button class="btn" id="k19-preview-close2">بستن</button></div></div></div>`;
    $('#k19-open-game').onclick=()=>{o.classList.remove('open');window._navigateToGame?.(id)};$('#k19-preview-close2').onclick=()=>o.classList.remove('open');o.classList.add('open');
  };

  function enhanceCards(){
    $$('.game-card').forEach(card=>{
      if(card.querySelector('.k19-game-actions'))return;
      const html=card.getAttribute('onclick')||'';const m=html.match(/_navigateToGame\(['"]([^'"]+)/);if(!m)return;
      const id=m[1];card.style.position='relative';
      const actions=document.createElement('div');actions.className='k19-game-actions';actions.innerHTML='<button class="k19-card-btn" title="پیش‌نمایش">👁</button><button class="k19-card-btn" title="علاقه‌مندی">♡</button>';
      actions.children[0].onclick=e=>{e.stopPropagation();window._v19Preview(id)};
      actions.children[1].onclick=e=>{e.stopPropagation();try{window.toggleLike?.(id);e.currentTarget.textContent='♥';}catch{e.currentTarget.textContent='♥'}};
      card.appendChild(actions);
    });
  }
  function addQuickBar(){
    if($('#k19-quickbar')||!$('#page-home'))return;
    const anchor=$('.search-bar');if(!anchor)return;
    const bar=document.createElement('div');bar.id='k19-quickbar';bar.className='k19-quickbar';bar.innerHTML='<button class="k19-quick" data-k19="latest">🆕 جدیدترین</button><button class="k19-quick" data-k19="rating">⭐ امتیاز بالا</button><button class="k19-quick" data-k19="likes">🔥 محبوب‌ترین</button><button class="k19-quick" data-k19="favorites">❤️ علاقه‌مندی‌ها</button><button class="k19-quick" data-k19="library">📚 کتابخانه</button><button class="k19-quick" data-k19="search">⌕ جستجوی سریع</button>';
    anchor.after(bar);
    bar.addEventListener('click',e=>{const b=e.target.closest('[data-k19]');if(!b)return;const a=b.dataset.k19;if(a==='search')return window._v19OpenSearch?.();if(a==='favorites')return window._go?.('favorites');if(a==='library')return window._go?.('bookmarks');const sel=$('#sort-filter');if(!sel)return;sel.value=a==='latest'?'newest':a;sel.dispatchEvent(new Event('change'))});
  }
  function addStats(){
    if($('#k19-stats'))return;const anchor=$('#games-count');if(!anchor)return;const box=document.createElement('div');box.id='k19-stats';box.className='k19-hero-grid';box.innerHTML='<div class="k19-stat"><b id="k19-st-games">—</b><span>بازی در آرشیو</span></div><div class="k19-stat"><b id="k19-st-favs">—</b><span>علاقه‌مندی محلی</span></div><div class="k19-stat"><b id="k19-st-views">—</b><span>بازدیدهای محلی</span></div><div class="k19-stat"><b id="k19-st-mode">—</b><span>تم فعال</span></div>';anchor.before(box);
    const refresh=async()=>{const all=await games();let fav=0,views=0;try{fav=Object.values(JSON.parse(localStorage.getItem('kraven_likes')||'{}')).filter(Boolean).length}catch{}try{views=Object.values(JSON.parse(localStorage.getItem('kraven_views')||'{}')).reduce((a,b)=>a+(+b||0),0)}catch{}$('#k19-st-games').textContent=all.length;$('#k19-st-favs').textContent=fav;$('#k19-st-views').textContent=views;$('#k19-st-mode').textContent=state.mode==='light'?'سفید':'تیره'};refresh();
  }
  function perfGuard(){
    if(reduced) return;
    let frames=0,last=performance.now();
    const tick=now=>{if(now-last>=1000){if(frames>90)document.documentElement.dataset.k19perf='busy';frames=0;last=now}frames++;requestAnimationFrame(tick)};requestAnimationFrame(tick);
    const mo=new MutationObserver(()=>{let i=0;$$('img').forEach(img=>{if(i++>80)return;if(!img.loading)img.loading='lazy';if(!img.decoding)img.decoding='async'})});mo.observe(document.body,{childList:true,subtree:true});
  }
  function init(){mountTheme();buildCommand();mountQuickPreview();addQuickBar();addStats();enhanceCards();perfGuard();
    const obs=new MutationObserver(()=>{enhanceCards();addQuickBar()});obs.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('kraven:navigate',()=>setTimeout(enhanceCards,180));
    const gb=$('#global-search-btn');if(gb)gb.addEventListener('dblclick',()=>window._v19OpenSearch?.());
    applyMode(state.mode);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,300),{once:true});else setTimeout(init,300);
})();
/* =========================================================
   KRAVEN GAME V21 — Ultimate Pro Enhancement Layer
   Works with the existing vanilla JS architecture.
   Local-first; no external service required.
   ========================================================= */
(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const K={theme:'kraven_v21_theme',posts:'kraven_v21_posts',events:'kraven_v21_events',seen:'kraven_v21_seen',mood:'kraven_v21_mood'};
const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const safe=v=>String(v??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
function get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch{return d}}
function set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
async function allGames(){try{if(typeof getGames==='function'){const g=await getGames();if(Array.isArray(g))return g}}catch{}try{const r=await fetch('data/games.json');return await r.json()}catch{return[]}}
function currentTheme(){return localStorage.getItem(K.theme)||localStorage.getItem('kraven_v19_mode')||(document.documentElement.classList.contains('kraven-light')?'light':'dark')}
function applyTheme(mode){mode=mode==='light'?'light':'dark';document.documentElement.classList.toggle('kraven-light',mode==='light');document.body.classList.toggle('kraven-light',mode==='light');localStorage.setItem(K.theme,mode);localStorage.setItem('kraven_v19_mode',mode);const b=$('#k21-theme-toggle');if(b){b.querySelector('.k21-theme-icon').textContent=mode==='light'?'🌙':'☀️';b.querySelector('.k21-theme-label').textContent=mode==='light'?'تیره':'روشن';b.setAttribute('aria-label',mode==='light'?'تغییر به تم تیره':'تغییر به تم روشن')}}
function theme(){const old=$('#theme-btn');if(old&&!$('#k21-theme-toggle')){const b=document.createElement('button');b.id='k21-theme-toggle';b.className='icon-btn tooltip k21-theme-toggle';b.type='button';b.title='تغییر تم';b.innerHTML='<span class="k21-theme-icon" aria-hidden="true">☀️</span><span class="k21-theme-label">روشن</span><span class="k21-theme-dot" aria-hidden="true"></span>';old.replaceWith(b);b.addEventListener('click',()=>applyTheme(currentTheme()==='light'?'dark':'light'))}applyTheme(currentTheme())}
function stats(){const likes=get('kraven_likes',{}),views=get('kraven_views',{}),ratings=get('kraven_user_ratings',{});const likeCount=Object.values(likes).filter(Boolean).length;const viewCount=Object.values(views).reduce((a,b)=>a+(Number(b)||0),0);const rated=Object.values(ratings);const avg=rated.length?rated.reduce((a,b)=>a+(Number(b)||0),0)/rated.length:0;return{likeCount,viewCount,avg}}
function rank(xp){const ranks=[['Bronze','🥉',0,99],['Silver','🥈',100,349],['Gold','🥇',350,899],['Platinum','💎',900,1999],['Kraven Elite','👑',2000,Infinity]];return ranks.find(r=>xp>=r[2]&&xp<=r[3])||ranks[0]}
function xpValue(){const s=stats();return Math.min(2500,s.viewCount*3+s.likeCount*18+Math.round(s.avg*24))}
function gameScore(){const s=stats();return Math.max(0,Math.min(100,Math.round(45+Math.min(25,s.likeCount*4)+Math.min(20,s.avg*2.2)+Math.min(10,s.viewCount*.35))))}
function topGenres(games){const views=get('kraven_views',{}),likes=get('kraven_likes',{});const m=new Map();games.forEach(g=>{const w=(Number(views[g.id])||0)*2+(likes[g.id]?3:0);if(!w)return;m.set(g.genre,(m.get(g.genre)||0)+w)});return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]).filter(Boolean)}
function recommended(games,genre){const likes=get('kraven_likes',{}),views=get('kraven_views',{});let pool=games.filter(g=>g.genre===genre);if(!pool.length)pool=games;return pool.map(g=>({g,s:(likes[g.id]?5:0)+(Number(views[g.id])||0)*2+(parseFloat(g.rating)||0)})).sort((a,b)=>b.s-a.s).slice(0,7).map(x=>x.g)}
function card(g){const img=g.imageData||g.mobileImageData||'';return `<article class="k21-reco" data-k21-game="${safe(g.id)}" tabindex="0" role="button" aria-label="مشاهده ${safe(g.title)}"><img src="${safe(img)}" alt="${safe(g.title||'بازی')}" loading="lazy" decoding="async"><div class="k21-reco-body"><div class="k21-reco-title">${safe(g.title||'بدون عنوان')}</div><div class="k21-reco-meta">${safe(g.genre||'بازی')} ${g.year?`• ${safe(g.year)}`:''} ${g.rating?`• ⭐ ${safe(g.rating)}`:''}</div></div></article>`}
function moodGenre(m){return({hero:'اکشن',calm:'شبیه‌سازی',story:'ماجراجویی',challenge:'نقش‌آفرینی',friends:'چندنفره'}[m]||'')}
function commandCenter(games){if($('#k21-command-center'))return;const home=$('#page-home');if(!home)return;const anchor=$('#v16-hero');if(!anchor)return;const section=document.createElement('section');section.id='k21-command-center';section.className='k21-shell';section.innerHTML=`<div class="k21-command-center"><div class="k21-hero-card"><span class="k21-ai-badge">✦ KRAVEN DISCOVERY ENGINE 2.0</span><h2>دنیای بیکران بازی‌ها را فتح کن.</h2><p>Kraven بر اساس امتیازها، علاقه‌مندی‌ها، بازدیدها و حال‌وهوایی که انتخاب می‌کنی، مسیر کشف بازی را شخصی می‌کند.</p><div class="k21-hero-actions"><button class="k21-btn primary" data-k21="discover">🎯 کشف بازی برای من</button><button class="k21-btn" data-k21="surprise">🎲 سورپرایزم کن</button><button class="k21-btn ghost" data-k21="command">⌘ جستجوی سریع</button></div></div><div class="k21-panel k21-pad k21-mood-card"><div class="k21-eyebrow">Mood Discovery</div><h3 class="k21-title">الان چه حسی داری؟</h3><p class="k21-sub">این پیشنهادها rule-based و کاملاً محلی هستند؛ بدون وابستگی به سرویس خارجی.</p><div class="k21-moods"><button class="k21-mood" data-k21-mood="hero">🦸 قهرمانانه</button><button class="k21-mood" data-k21-mood="calm">🌿 آرام</button><button class="k21-mood" data-k21-mood="story">📖 داستانی</button><button class="k21-mood" data-k21-mood="challenge">⚔️ چالش‌برانگیز</button><button class="k21-mood" data-k21-mood="friends">👥 با دوستان</button></div></div></div><div class="k21-panel k21-pad" style="margin-top:16px"><div class="k21-title-row"><div><div class="k21-eyebrow">Personalized Shelf</div><h3 class="k21-title" id="k21-reco-title">پیشنهادهای مخصوص تو</h3><p class="k21-sub">بازی‌هایی که با سلیقه فعلی‌ات بیشترین تطابق را دارند.</p></div><span class="k21-chip" id="k21-reco-chip">LIVE</span></div><div class="k21-reco-row" id="k21-reco-row"></div></div>`;anchor.after(section);renderRecos(games);section.addEventListener('click',e=>{const g=e.target.closest('[data-k21-game]');if(g){window._navigateToGame?.(g.dataset.k21Game);return}const mood=e.target.closest('[data-k21-mood]');if(mood){const games2=window.__K21_GAMES||games;const genre=moodGenre(mood.dataset.k21Mood);set(K.mood,mood.dataset.k21Mood);renderRecos(games2,genre);return}const a=e.target.closest('[data-k21]');if(!a)return;const kind=a.dataset.k21;if(kind==='command')window._v19OpenSearch?.()||$('#global-search-btn')?.click();if(kind==='surprise'&&games.length){const g=games[Math.floor(Math.random()*games.length)];window._navigateToGame?.(g.id)}if(kind==='discover')renderRecos(games,topGenres(games)[0]||'')})}
function renderRecos(games,genre=''){const list=recommended(games,genre||topGenres(games)[0]);const row=$('#k21-reco-row');if(!row)return;$('#k21-reco-title').textContent=genre?`پیشنهادهای ${safe(genre)}`:'پیشنهادهای مخصوص تو';row.innerHTML=list.map(card).join('')||'<div class="k21-sub">هنوز داده کافی نداریم؛ چند بازی را ببین و دوباره برگرد.</div>'}
function gamification(games){if($('#k21-gamification'))return;const home=$('#page-home');if(!home)return;const anchor=$('#home-trending')||$('.featured-section-title',home);const sec=document.createElement('section');sec.id='k21-gamification';sec.className='k21-shell';const xp=xpValue(),r=rank(xp),sc=gameScore(),pct=Math.min(100,Math.round(((xp-r[2])/Math.max(1,(r[3]===Infinity?r[2]+500:r[3])-r[2]))*100));const s=stats();sec.innerHTML=`<div class="k21-grid k21-grid-3"><div class="k21-panel k21-pad"><div class="k21-title-row"><div><div class="k21-eyebrow">Kraven Rank</div><h3 class="k21-title">رتبه تو</h3></div><span class="k21-chip">${r[1]} ${r[0]}</span></div><div class="k21-rank"><div class="k21-rank-badge">${r[1]}</div><div><div class="k21-rank-name">${r[0]}</div><div class="k21-rank-xp">${xp.toLocaleString('fa-IR')} XP • ${s.viewCount.toLocaleString('fa-IR')} بازدید</div></div></div><div class="k21-bar"><i style="width:${pct}%"></i></div><div class="k21-sub">تا رتبه بعدی: ${r[3]===Infinity?'Elite Max':Math.max(0,r[3]-xp).toLocaleString('fa-IR')+' XP'}</div></div><div class="k21-panel k21-pad"><div class="k21-title-row"><div><div class="k21-eyebrow">Kraven Score</div><h3 class="k21-title">امتیاز تعامل</h3></div><span class="k21-chip">${sc}/100</span></div><div class="k21-score"><div class="k21-gauge" style="--score:${sc}%"><div style="text-align:center"><strong>${sc}</strong><span>/ 100</span></div></div><div class="k21-score-bars"><div class="k21-score-line"><span>کشف</span><div class="k21-mini-track"><i style="width:${Math.min(100,20+s.viewCount*4)}%"></i></div><b>${Math.min(100,20+s.viewCount*4)}</b></div><div class="k21-score-line"><span>علاقه</span><div class="k21-mini-track"><i style="width:${Math.min(100,10+s.likeCount*10)}%"></i></div><b>${Math.min(100,10+s.likeCount*10)}</b></div><div class="k21-score-line"><span>امتیاز</span><div class="k21-mini-track"><i style="width:${Math.min(100,s.avg*10)}%"></i></div><b>${Math.round(s.avg*10)}</b></div></div></div></div><div class="k21-panel k21-pad"><div class="k21-title-row"><div><div class="k21-eyebrow">Challenges</div><h3 class="k21-title">ماموریت‌های ویژه</h3></div><span class="k21-chip">هفتگی</span></div><div class="k21-grid" style="gap:10px"><div class="k21-challenge"><div class="k21-challenge-top"><b>🔎 ۳ بازی جدید کشف کن</b><small>+120 XP</small></div><div class="k21-bar"><i style="width:${Math.min(100,Math.round((s.viewCount%4)/3*100))}%"></i></div></div><div class="k21-challenge"><div class="k21-challenge-top"><b>❤️ ۲ بازی را به علاقه‌مندی اضافه کن</b><small>+180 XP</small></div><div class="k21-bar"><i style="width:${Math.min(100,Math.round((s.likeCount%3)/2*100))}%"></i></div></div><div class="k21-challenge"><div class="k21-challenge-top"><b>⭐ یک امتیاز ثبت کن</b><small>+80 XP</small></div><div class="k21-bar"><i style="width:${s.avg?100:0}%"></i></div></div></div></div></div>`;anchor.before(sec)}
function community(){if($('#k21-community'))return;const home=$('#page-home');if(!home)return;const anchor=$('#home-recent')||home.lastElementChild;const sec=document.createElement('section');sec.id='k21-community';sec.className='k21-shell';const posts=get(K.posts,[]);const defaults=[['Kraven','اولین قدم برای پیدا کردن یک بازی خوب، اینه که بدونی این بار دنبال چه تجربه‌ای هستی. 🎮'],['Game Hunter','امروز بخش Hidden Gems را زیر و رو کردم؛ بعضی بازی‌ها واقعاً لایق توجه بیشتری‌اند. 🔥'],['Player One','یک بازی کوتاه و خوش‌ساخت می‌خوای؟ از فیلتر زمان تجربه شروع کن. ⚡']];const feed=posts.length?posts.map(p=>[p.user,p.text]):defaults;sec.innerHTML=`<div class="k21-grid k21-grid-3"><div class="k21-panel k21-pad"><div class="k21-title-row"><div><div class="k21-eyebrow">Kraven Feed</div><h3 class="k21-title">نبض جامعه</h3><p class="k21-sub">پست‌ها و وضعیت‌های محلی انجمن.</p></div><span class="k21-chip">LOCAL</span></div><div class="k21-feed-list">${feed.slice(0,4).map((p,i)=>`<article class="k21-feed"><div class="k21-feed-head"><div class="k21-user"><div class="k21-avatar">${safe((p[0]||'K')[0])}</div><div><b>${safe(p[0])}</b><small>${i+1} دقیقه پیش</small></div></div></div><p>${safe(p[1])}</p><div class="k21-feed-actions"><button>♡ پسندیدن</button><button>💬 پاسخ</button><button>↗ اشتراک</button></div></article>`).join('')}</div></div><div class="k21-panel k21-pad"><div class="k21-title-row"><div><div class="k21-eyebrow">Game DNA</div><h3 class="k21-title">DNA گیمینگ تو</h3><p class="k21-sub">ترکیبی از ژانرهایی که بیشتر با آن‌ها تعامل داشته‌ای.</p></div></div><div class="k21-dna"><div class="k21-dna-orb"></div><div><div id="k21-dna-text" class="k21-sub">در حال تحلیل...</div><div class="k21-dna-tags" id="k21-dna-tags"></div></div></div></div><div class="k21-panel k21-pad"><div class="k21-title-row"><div><div class="k21-eyebrow">Squad Up</div><h3 class="k21-title">برای بازی گروهی آماده‌ای؟</h3><p class="k21-sub">در نسخه local-first، پیشنهادها بر اساس آرشیو و ژانر انتخاب می‌شوند.</p></div><span class="k21-chip">CO-OP</span></div><div class="k21-grid" style="gap:9px"><button class="k21-btn" data-k21-squad="اکشن">⚔️ Squad اکشن</button><button class="k21-btn" data-k21-squad="چندنفره">👥 Squad چندنفره</button><button class="k21-btn" data-k21-squad="ماجراجویی">🗺️ Squad ماجراجویی</button></div></div></div><div class="k21-panel k21-pad" style="margin-top:16px"><div class="k21-title-row"><div><div class="k21-eyebrow">Create</div><h3 class="k21-title">یک پست جدید</h3></div></div><div class="k21-postbox"><textarea id="k21-post-text" placeholder="چه بازی‌ای کشف کردی؟ چه چیزی را پیشنهاد می‌کنی؟"></textarea><div style="display:flex;justify-content:flex-start"><button class="k21-btn primary" id="k21-post-submit">✦ انتشار پست محلی</button></div></div></div>`;anchor.before(sec);drawDNA(gamesSafe());sec.addEventListener('click',e=>{const sq=e.target.closest('[data-k21-squad]');if(sq){const gs=gamesSafe();const rec=gs.filter(g=>g.genre===sq.dataset.k21Squad).slice(0,1)[0];if(rec)window._navigateToGame?.(rec.id);else window._go?.('home');return}});$('#k21-post-submit')?.addEventListener('click',()=>{const ta=$('#k21-post-text');const txt=ta?.value.trim();if(!txt)return;if(txt.length>500)return;const arr=get(K.posts,[]);arr.unshift({user:'کاربر Kraven',text:txt,at:Date.now()});set(K.posts,arr.slice(0,12));ta.value='';showToastSafe('پست محلی منتشر شد','success');document.dispatchEvent(new CustomEvent('kraven:v21-refresh'))})}
let cachedGames=[];function gamesSafe(){return cachedGames}
function drawDNA(games){const genres=topGenres(games),tags=$('#k21-dna-tags'),txt=$('#k21-dna-text');if(!tags||!txt)return;txt.textContent=genres.length?`سلیقه‌ی غالب: ${genres.join('، ')}.`:'با چند تعامل بیشتر، DNA گیمینگت دقیق‌تر می‌شود.';tags.innerHTML=(genres.length?genres:['اکشن','ماجراجویی','استراتژی']).map((g,i)=>`<span class="k21-chip">${i===0?'🔥 ':''}${safe(g)}</span>`).join('')}
function showToastSafe(text,type){try{window.showToast?.(text,type)}catch{}}
function mobileBar(){if($('#k21-mobile-bar'))return;const n=document.createElement('nav');n.id='k21-mobile-bar';n.className='k21-mobile-bar';n.setAttribute('aria-label','پیمایش سریع موبایل');n.innerHTML='<button class="is-active" data-k21-nav="home"><span>⌂</span>خانه</button><button data-k21-nav="discovery"><span>⌕</span>کشف</button><button data-k21-nav="favorites"><span>♡</span>لیست</button><button data-k21-nav="compare"><span>⇄</span>مقایسه</button><button data-k21-nav="menu"><span>☰</span>منو</button>';document.body.appendChild(n);n.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;$$('button',n).forEach(x=>x.classList.remove('is-active'));b.classList.add('is-active');const v=b.dataset.k21Nav;if(v==='home')window._go?.('home');else if(v==='favorites')window._go?.('favorites');else if(v==='compare')window._go?.('compare');else if(v==='discovery')window._v19OpenSearch?.()||$('#global-search-btn')?.click();else if(v==='menu')$('#hamburger-btn')?.click()})}
function commandKeys(){document.addEventListener('keydown',e=>{const tag=String(e.target?.tagName||'').toLowerCase();if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();window._v19OpenSearch?.()||$('#global-search-btn')?.click()}if(e.key==='/'&&!['input','textarea','select'].includes(tag)){e.preventDefault();window._v19OpenSearch?.()||$('#global-search-btn')?.click()}})}
function enhanceHeader(){const h=$('.page-header',document);if(h){const title=h.querySelector('h1');const p=h.querySelector('p');if(title)title.textContent='دنیای بیکران بازی‌ها را فتح کن';if(p)p.textContent='بازی بعدی‌ات را با جستجو، پیشنهاد هوشمند و سلیقه‌ی خودت پیدا کن.'}}
function accessibleCards(){document.addEventListener('keydown',e=>{const g=e.target.closest?.('.game-card');if(g&&(e.key==='Enter'||e.key===' ')){e.preventDefault();g.click()}});new MutationObserver(()=>$$('.game-card img').forEach(img=>{if(!img.alt)img.alt='تصویر بازی'})).observe(document.body,{subtree:true,childList:true})}
function patchDefaultSort(){const s=$('#sort-filter');if(s)s.value='newest';const clear=window._clearGameFilters;if(clear&&!window._k21ClearPatched){window._k21ClearPatched=true;window._clearGameFilters=function(){try{$('#search-input').value='';$('#genre-filter').value='';$('#sort-filter').value='newest'}catch{};return clear()}}}
function seo(){document.title='Kraven Game | کشف بازی، اخبار و تجربه گیمینگ فارسی';const d=$('meta[name="description"]');if(d)d.content='Kraven Game؛ پلتفرم فارسی کشف بازی، اخبار گیم، نقد و بررسی، جستجوی هوشمند، مجموعه شخصی، تقویم عرضه و تجربه گیمینگ حرفه‌ای.';let kw=$('meta[name="keywords"]');if(!kw){kw=document.createElement('meta');kw.name='keywords';document.head.appendChild(kw)}kw.content='بازی, بازی ویدیویی, اخبار گیم, معرفی بازی, نقد بازی, بازی جدید, بازی کامپیوتر, بازی پلی استیشن, بازی ایکس باکس, بازی مستقل';let ld=$('script[type="application/ld+json"][data-k21]');if(!ld){ld=document.createElement('script');ld.type='application/ld+json';ld.dataset.k21='1';document.head.appendChild(ld)}ld.textContent=JSON.stringify({'@context':'https://schema.org','@type':'WebSite',name:'Kraven Game',description:d?.content||'',inLanguage:'fa-IR',potentialAction:{'@type':'SearchAction',target:location.href.split('#')[0]+'#/home?q={search_term_string}', 'query-input':'required name=search_term_string'}})}
async function boot(){theme();seo();enhanceHeader();patchDefaultSort();mobileBar();commandKeys();accessibleCards();cachedGames=await allGames();window.__K21_GAMES=cachedGames;commandCenter(cachedGames);gamification(cachedGames);community();drawDNA(cachedGames);document.addEventListener('kraven:v21-refresh',()=>{cachedGames=window.__K21_GAMES||cachedGames;});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,420),{once:true});else setTimeout(boot,420);
window.KRAVEN_V21={applyTheme,stats,rank,refresh:()=>{drawDNA(cachedGames);renderRecos(cachedGames)}};
})();
/* KRAVEN V22 — typography, typewriter, cinematic scroll reveal */
(function(){
  'use strict';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var raf = 0;
  var scrollY = 0;

  function ready(fn){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',fn,{once:true});
    else fn();
  }

  function typeText(el, text, opts){
    if(!el || el.dataset.v22Typed === '1') return;
    opts = opts || {};
    if(reduced){ el.textContent=text; el.dataset.v22Typed='1'; return; }
    var speed = opts.speed || 42;
    var startDelay = opts.startDelay || 260;
    var wrap = document.createElement('span');
    wrap.className='v22-typewriter-wrap';
    var dyn = document.createElement('span');
    dyn.className='v22-typewriter-dynamic v22-typewriter-ready';
    var caret = document.createElement('span');
    caret.className='v22-caret';
    caret.setAttribute('aria-hidden','true');
    wrap.appendChild(dyn); wrap.appendChild(caret);
    el.textContent=''; el.appendChild(wrap); el.classList.add('v22-typing-target');
    el.dataset.v22Typed='1';
    var i=0;
    window.setTimeout(function tick(){
      dyn.textContent=text.slice(0,i++);
      if(i<=text.length) window.setTimeout(tick,speed);
      else window.setTimeout(function(){caret.style.opacity='.55';},700);
    },startDelay);
  }

  function markRevealCandidates(){
    var selectors = [
      '#page-home > .page-header',
      '#v16-hero', '#v16-hero + .v16-metrics',
      '.featured-section-title', '#featured-slider',
      '.ad-slot', '.search-bar', '.games-grid', '.news-list',
      '.k21-shell', '.k21-panel', '.k21-grid', '.game-detail',
      '.empty-state', '.page-header', '.content-section', '.section',
      '[class*="section-title"]'
    ];
    var seen = new Set();
    selectors.forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(el){
        if(seen.has(el) || el.id==='loading-screen' || el.closest('#main-header')) return;
        seen.add(el);
        if(!el.classList.contains('v22-reveal')) el.classList.add('v22-reveal');
        if(el.matches('.featured-slider,.games-grid,.news-list,.k21-grid')) el.classList.add('v22-card-stagger');
        if(el.matches('.featured-section-title,[class*="section-title"],.page-header h1')) el.classList.add('v22-section-heading');
      });
    });
  }

  function initObserver(){
    markRevealCandidates();
    var items = document.querySelectorAll('.v22-reveal:not([data-v22-observed])');
    if(reduced){items.forEach(function(el){el.classList.add('v22-visible');});return;}
    if(!('IntersectionObserver' in window)) {items.forEach(function(el){el.classList.add('v22-visible');});return;}
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          entry.target.classList.add('v22-visible');
          entry.target.dataset.v22Observed='1';
          io.unobserve(entry.target);
        }
      });
    },{root:null,rootMargin:'0px 0px -8% 0px',threshold:.10});
    items.forEach(function(el){io.observe(el);});
  }

  function initTyping(){
    var pageHome = document.getElementById('page-home');
    if(!pageHome) return;
    var headerTitle = pageHome.querySelector('.page-header h1');
    if(headerTitle && headerTitle.dataset.v22Typed!=='1') typeText(headerTitle,'دنیای بی‌کران بازی‌ها را فتح کن',{speed:34,startDelay:220});
    var heroKicker = pageHome.querySelector('.v16-kicker');
    if(heroKicker && !heroKicker.classList.contains('v22-reveal')) heroKicker.classList.add('v22-reveal');
    var desc = pageHome.querySelector('.page-header p');
    if(desc && desc.dataset.v22Typed!=='1'){
      desc.dataset.v22Typed='1';
      desc.classList.add('v22-type-desc');
      var txt=desc.textContent.trim();
      desc.textContent='';
      var span=document.createElement('span');span.textContent=txt;span.style.display='inline-block';span.style.opacity='0';span.style.transform='translateY(5px)';span.style.transition='opacity .6s var(--v22-ease),transform .7s var(--v22-spring)';
      desc.appendChild(span);
      requestAnimationFrame(function(){setTimeout(function(){span.style.opacity='1';span.style.transform='none';},900)});
    }
  }

  function initScrollAtmosphere(){
    var bg=document.querySelector('.soft-rgb-bg');
    if(!bg || reduced) return;
    bg.classList.add('v22-scroll-atmosphere');
    function update(){
      raf=0;
      var y=Math.min(window.scrollY,1400);
      scrollY=y;
      bg.style.setProperty('--v22-scroll-y',(y*-.035).toFixed(2)+'px');
    }
    function onScroll(){if(!raf) raf=requestAnimationFrame(update);}
    window.addEventListener('scroll',onScroll,{passive:true});
    update();
  }

  function refreshLater(){
    initObserver();
  }

  ready(function(){
    initTyping();
    initObserver();
    initScrollAtmosphere();
    [300,900,1600].forEach(function(ms){setTimeout(refreshLater,ms);});

    /* Re-scan when SPA navigation swaps pages, without a permanent mutation observer. */
    document.addEventListener('click',function(e){
      var target=e.target.closest && e.target.closest('[data-page]');
      if(target) setTimeout(refreshLater,120);
    },{passive:true});

    /* Ensure dynamically-rendered content becomes reveal-ready after common renders. */
    var hooks=['renderGames','renderNews','renderFavorites','renderHomeExtras','renderGameDetail'];
    hooks.forEach(function(name){
      var fn=window[name];
      if(typeof fn!=='function' || fn.__v22Wrapped) return;
      var wrapped=function(){var r=fn.apply(this,arguments); setTimeout(refreshLater,40); return r;};
      wrapped.__v22Wrapped=true; wrapped.__v22Original=fn; window[name]=wrapped;
    });
  });
})();
/* KRAVEN V23 — Cinematic Experience + Premium UX + Performance Layer */
(function(){
  'use strict';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var fine = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
  var lastClickSfx = 0;
  var audioCtx = null;
  var fxBuffer = null;
  var unlockBound = false;
  var commandOpen = false;
  var commandIndex = 0;
  var commandItems = [];

  function ready(fn){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',fn,{once:true}); else fn();
  }
  function cssEscape(s){ try{return CSS.escape(s);}catch(e){return String(s).replace(/[^a-z0-9_-]/gi,'');} }
  function qs(s,r){return (r||document).querySelector(s)}
  function qsa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
  function text(el){return el ? (el.textContent||'').trim() : '';}

  /* ---------- 1. WebAudio click system: instant + layered ---------- */
  async function initAudio(){
    if(audioCtx) return audioCtx;
    try{
      var C=window.AudioContext||window.webkitAudioContext;
      if(!C) return null;
      audioCtx=new C();
      return audioCtx;
    }catch(e){return null;}
  }
  async function loadFxBuffer(){
    if(fxBuffer) return fxBuffer;
    var ctx=await initAudio();
    if(!ctx) return null;
    try{
      var res=await fetch('assets/cursor%20click.mp3',{cache:'force-cache'});
      if(!res.ok) throw new Error('sfx');
      fxBuffer=await ctx.decodeAudioData(await res.arrayBuffer());
    }catch(e){fxBuffer=null;}
    return fxBuffer;
  }
  function playClick(){
    var now=performance.now();
    if(now-lastClickSfx<38) return;
    lastClickSfx=now;
    if(!audioCtx){ initAudio().then(function(){ loadFxBuffer().then(function(){playBuffer(.52);}); }); return; }
    if(audioCtx.state==='suspended') audioCtx.resume().catch(function(){});
    if(fxBuffer){ playBuffer(.52); return; }
    /* instant fallback: tiny synthesized tick while MP3 warms up */
    try{
      var o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.type='square'; o.frequency.setValueAtTime(1450,audioCtx.currentTime); o.frequency.exponentialRampToValueAtTime(700,audioCtx.currentTime+.035);
      g.gain.setValueAtTime(.0001,audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.035,audioCtx.currentTime+.004); g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+.045);
      o.connect(g);g.connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+.05);
      loadFxBuffer();
    }catch(e){}
  }
  function playBuffer(gain){
    if(!audioCtx||!fxBuffer) return;
    try{
      var src=audioCtx.createBufferSource(), g=audioCtx.createGain();
      src.buffer=fxBuffer; g.gain.value=gain; src.connect(g);g.connect(audioCtx.destination);src.start(0);
    }catch(e){}
  }
  function bindAudioUnlock(){
    if(unlockBound) return; unlockBound=true;
    var unlock=function(){ initAudio().then(loadFxBuffer).then(function(){ if(audioCtx&&audioCtx.state==='suspended') return audioCtx.resume(); }).catch(function(){}); document.removeEventListener('pointerdown',unlock,true); document.removeEventListener('touchstart',unlock,true); };
    document.addEventListener('pointerdown',unlock,true); document.addEventListener('touchstart',unlock,true);
  }

  /* ---------- 2. Toast + Achievement ---------- */
  function toast(message, icon){
    var root=qs('#v23-toast-stack'); if(!root){ root=document.createElement('div');root.id='v23-toast-stack';root.className='v23-toast-stack';document.body.appendChild(root); }
    var el=document.createElement('div');el.className='v23-toast';el.innerHTML='<span aria-hidden="true">'+(icon||'✨')+'</span><span>'+message+'</span>';root.appendChild(el);
    setTimeout(function(){el.classList.add('leaving');setTimeout(function(){el.remove();},300);},2300);
  }
  function achievement(title, body, xp){
    var el=document.createElement('div'); el.className='v23-achievement';
    el.innerHTML='<small>🏆 ACHIEVEMENT UNLOCKED</small><strong>'+title+'</strong><div>'+body+'</div><div class="xp">+'+(xp||50)+' XP</div>';
    document.body.appendChild(el); setTimeout(function(){el.remove();},4200);
  }

  /* ---------- 3. Cinematic hero parallax ---------- */
  function initHeroParallax(){
    if(!fine||reduced) return;
    var hero=qs('#v16-hero'); if(!hero) return;
    var bg=qs('.v16-hero-bg',hero), glow=qs('.v16-hero-glow',hero); if(!bg&&!glow) return;
    var raf=0,tx=0,ty=0,x=0,y=0;
    function update(){raf=0;x+=(tx-x)*.10;y+=(ty-y)*.10;if(bg)bg.style.transform='translate3d('+(x*.55).toFixed(2)+'px,'+(y*.45).toFixed(2)+'px,0) scale(1.035)';if(glow)glow.style.transform='translate3d('+(x*.95).toFixed(2)+'px,'+(y*.8).toFixed(2)+'px,0)';if(Math.abs(tx-x)>.1||Math.abs(ty-y)>.1)raf=requestAnimationFrame(update);}
    hero.addEventListener('pointermove',function(e){var r=hero.getBoundingClientRect();tx=((e.clientX-r.left)/r.width-.5)*20;ty=((e.clientY-r.top)/r.height-.5)*14;if(!raf)raf=requestAnimationFrame(update);},{passive:true});
    hero.addEventListener('pointerleave',function(){tx=0;ty=0;if(!raf)raf=requestAnimationFrame(update);},{passive:true});
  }

  /* ---------- 4. Enhanced game cards + hover preview ---------- */
  function decorateCards(){
    qsa('.game-card').forEach(function(card){
      if(card.dataset.v23Decorated==='1') return;
      card.dataset.v23Decorated='1';card.classList.add('v23-enhanced');
      if(!reduced && fine) card.classList.add('v23-magnetic');
      var title=text(qs('.game-card-title,.game-title,h3,h4',card)) || 'جزئیات بازی';
      var rating=text(qs('.rating,.game-rating,.star-rating',card));
      var genre=text(qs('.game-card-genre,.genre',card));
      var p=document.createElement('div');p.className='v23-card-preview';
      p.innerHTML='<div class="v23-card-preview-row"><span class="v23-card-preview-title">'+title.replace(/[<>]/g,'')+'</span><span>'+((rating||'').slice(0,12))+'</span></div><div class="v23-card-preview-row" style="opacity:.72;margin-top:3px;"><span>'+((genre||'بازی').replace(/[<>]/g,''))+'</span><span>KRAVEN</span></div><div class="v23-card-preview-btns"><button type="button" class="v23-mini-btn" data-v23-preview="open">👁️ پیش‌نمایش</button><button type="button" class="v23-mini-btn" data-v23-preview="favorite">❤️ ذخیره</button></div>';
      card.appendChild(p);
    });
  }
  function openGameFromCard(card){
    try{
      if(card.getAttribute('onclick')){ var oc=card.getAttribute('onclick'); var m=oc.match(/_navigateToGame\(['"]([^'"]+)['"]\)/); if(m&&window._navigateToGame){window._navigateToGame(m[1]);return;} }
      var a=qs('a[href*="game"],a[href^="#"]',card);if(a)a.click();
    }catch(e){}
  }
  function cardFavorite(card){
    var b=qs('[data-action*="like"],[onclick*="like"],[title*="علاقه"]',card); if(b){b.click();toast('به علاقه‌مندی‌ها اضافه شد','❤️');return;}
    toast('بازی ذخیره شد (محلی)','🔖');
  }

  /* ---------- 5. Command palette ---------- */
  var actions=[
    {label:'خانه',icon:'🏠',page:'home'},
    {label:'بازی‌ها',icon:'🎮',page:'home'},
    {label:'اخبار',icon:'📰',page:'news'},
    {label:'علاقه‌مندی‌ها',icon:'❤️',page:'favorites'},
    {label:'مقایسه بازی‌ها',icon:'⚖️',page:'compare'},
    {label:'تقویم عرضه',icon:'📅',page:'calendar'},
    {label:'آموزش‌ها',icon:'📚',page:'tutorials'},
    {label:'تغییر تم',icon:'🌓',action:'theme'},
    {label:'بازی تصادفی',icon:'🎲',action:'random'}
  ];
  function ensureCommand(){
    if(qs('#v23-command-overlay')) return;
    var ov=document.createElement('div');ov.id='v23-command-overlay';ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');
    ov.innerHTML='<div class="v23-command"><div class="v23-command-head"><span aria-hidden="true">⌘</span><input id="v23-command-input" type="search" autocomplete="off" placeholder="جستجوی Kraven..." aria-label="جستجوی سریع Kraven"><span class="v23-command-kbd">Esc</span></div><div class="v23-command-list" id="v23-command-list"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('pointerdown',function(e){if(e.target===ov)closeCommand();});
    qs('#v23-command-input',ov).addEventListener('input',renderCommand);
    qs('#v23-command-input',ov).addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();closeCommand();}
      else if(e.key==='ArrowDown'){e.preventDefault();commandIndex=Math.min(commandIndex+1,commandItems.length-1);focusCommand();}
      else if(e.key==='ArrowUp'){e.preventDefault();commandIndex=Math.max(commandIndex-1,0);focusCommand();}
      else if(e.key==='Enter'){e.preventDefault();if(commandItems[commandIndex])runCommand(commandItems[commandIndex]);}
    });
  }
  function renderCommand(){
    var input=qs('#v23-command-input'),list=qs('#v23-command-list');if(!input||!list)return;
    var q=(input.value||'').trim().toLowerCase();
    commandItems=actions.filter(function(a){return !q||(a.label+' '+(a.page||'')).toLowerCase().includes(q);});
    /* live game titles if available */
    var cards=qsa('.game-card').slice(0,40);
    cards.forEach(function(card){var title=text(qs('.game-card-title,.game-title,h3,h4',card));if(title&&(!q||title.toLowerCase().includes(q)))commandItems.push({label:title,icon:'🎮',card:card});});
    commandIndex=0;
    list.innerHTML=commandItems.map(function(a,i){return '<button type="button" class="v23-command-item" data-v23-cmd="'+i+'"><span class="v23-command-icon">'+a.icon+'</span><span>'+a.label+'</span></button>';}).join('');
    qsa('[data-v23-cmd]',list).forEach(function(b){b.addEventListener('click',function(){runCommand(commandItems[Number(b.dataset.v23Cmd)]);});});
  }
  function focusCommand(){var list=qs('#v23-command-list');if(!list)return;var b=qs('[data-v23-cmd="'+commandIndex+'"]',list);if(b)b.focus();}
  function runCommand(a){if(!a)return;closeCommand();if(a.page&&window._showPage)window._showPage(a.page);else if(a.page){var link=qs('[data-page="'+cssEscape(a.page)+'"]');if(link)link.click();}else if(a.action==='theme'){var b=qs('#theme-btn');if(b)b.click();}else if(a.action==='random'){var b=qs('#random-btn');if(b)b.click();}else if(a.card){openGameFromCard(a.card);}}
  function openCommand(){ensureCommand();commandOpen=true;var ov=qs('#v23-command-overlay');ov.classList.add('open');var inp=qs('#v23-command-input');inp.value='';renderCommand();setTimeout(function(){inp.focus();},0);playClick();}
  function closeCommand(){commandOpen=false;var ov=qs('#v23-command-overlay');if(ov)ov.classList.remove('open');}

  /* ---------- 6. Mobile bottom navigation ---------- */
  function initBottomNav(){
    if(qs('#v23-bottom-nav')) return;
    var nav=document.createElement('nav');nav.id='v23-bottom-nav';nav.setAttribute('aria-label','ناوبری سریع');
    [['home','🏠','خانه'],['favorites','❤️','علاقه'],['news','📰','اخبار'],['compare','⚖️','مقایسه'],['calendar','📅','عرضه']].forEach(function(x){var b=document.createElement('button');b.type='button';b.className='v23-bottom-item';b.dataset.page=x[0];b.innerHTML='<span>'+x[1]+'</span><span>'+x[2]+'</span>';b.addEventListener('click',function(){var link=qs('[data-page="'+cssEscape(x[0])+'"]');if(link)link.click();playClick();syncBottomNav();});nav.appendChild(b);});
    document.body.appendChild(nav);syncBottomNav();
  }
  function syncBottomNav(){var active=qs('.sidebar-nav [data-page].active');var page=active&&active.dataset.page;qsa('.v23-bottom-item').forEach(function(b){b.classList.toggle('active',b.dataset.page===page);});}

  /* ---------- 7. Theme reveal, without fighting existing theme engine ---------- */
  function initThemeObserver(){
    var root=document.documentElement;
    var last=root.classList.contains('kraven-light');
    var obs=new MutationObserver(function(){var now=root.classList.contains('kraven-light');if(now===last)return;last=now;var btn=qs('#theme-btn'),r=btn?btn.getBoundingClientRect():{left:innerWidth/2,top:40,width:0,height:0};var x=r.left+r.width/2,y=r.top+r.height/2;var el=document.createElement('div');el.className='v23-theme-transition';el.style.setProperty('--v23-x',x+'px');el.style.setProperty('--v23-y',y+'px');el.style.setProperty('--v23-next-bg',now?'#ffffff':'#0f1119');document.body.appendChild(el);setTimeout(function(){el.remove();},680);});
    obs.observe(root,{attributes:true,attributeFilter:['class']});
  }

  /* ---------- 8. Mouse magnetic effect, lightweight ---------- */
  function initMagnetic(){
    if(!fine||reduced) return;
    document.addEventListener('pointermove',function(e){var el=e.target.closest&&e.target.closest('.v23-magnetic');if(!el)return;var r=el.getBoundingClientRect();var dx=(e.clientX-(r.left+r.width/2))/r.width,dy=(e.clientY-(r.top+r.height/2))/r.height;el.style.transform='translate3d('+(dx*5).toFixed(2)+'px,'+(dy*4).toFixed(2)+'px,0)';},{passive:true});
    document.addEventListener('pointerout',function(e){var el=e.target.closest&&e.target.closest('.v23-magnetic');if(el&&!el.contains(e.relatedTarget))el.style.transform='';},{passive:true});
  }

  /* ---------- 9. Smart skeletons for image-first cards ---------- */
  function initImageQuality(){
    qsa('img').forEach(function(img){
      if(img.dataset.v23Img==='1')return;img.dataset.v23Img='1';img.loading=img.loading||'lazy';img.decoding=img.decoding||'async';
      if(!img.complete) img.classList.add('v23-skeleton');
      img.addEventListener('load',function(){img.classList.remove('v23-skeleton');},{once:true,passive:true});
      img.addEventListener('error',function(){img.classList.remove('v23-skeleton');img.classList.add('v23-img-fallback');},{once:true,passive:true});
    });
  }

  /* ---------- 10. Game DNA widget ---------- */
  function inferDNA(){
    var counts={Action:0,RPG:0,Adventure:0,Strategy:0,Indie:0};var total=0;
    var likedKeys=['likes','likedGames','kraven_likes'];
    try{likedKeys.forEach(function(k){var v=localStorage.getItem(k);if(!v)return;var obj=JSON.parse(v);Object.keys(obj||{}).forEach(function(id){if(!obj[id])return;var card=qsa('.game-card').find(function(c){return (c.getAttribute('onclick')||'').includes(String(id));});if(card){var g=text(qs('.game-card-genre,.genre',card)).toLowerCase();total++;Object.keys(counts).forEach(function(cat){if(g.includes(cat.toLowerCase()))counts[cat]++;});}});});}catch(e){}
    if(total<3){var cards=qsa('.game-card').slice(0,12);cards.forEach(function(c){var g=text(qs('.game-card-genre,.genre',c)).toLowerCase();total++;Object.keys(counts).forEach(function(cat){if(g.includes(cat.toLowerCase()))counts[cat]++;});});}
    var vals=Object.keys(counts).map(function(k){return [k,counts[k]];});var sum=vals.reduce(function(a,x){return a+x[1];},0)||1;return vals.map(function(x){return [x[0],Math.round(x[1]/sum*100)];});
  }
  function initDNA(){
    if(qs('#v23-dna-card'))return;
    var host=qs('#home-recent')||qs('#home-trending');if(!host)return;
    var el=document.createElement('section');el.id='v23-dna-card';el.className='v23-dna v22-reveal';
    el.innerHTML='<div class="v23-section-label">🧬 Game DNA</div><p style="opacity:.72;margin:8px 0 14px">بر اساس بازی‌هایی که در Kraven کشف می‌کنی، DNA گیمینگت شکل می‌گیرد.</p><div class="v23-dna-grid" id="v23-dna-grid"></div>';
    host.parentNode.insertBefore(el,host);var grid=qs('#v23-dna-grid',el);inferDNA().forEach(function(row){var d=document.createElement('div');d.className='v23-dna-row';d.innerHTML='<span>'+row[0]+'</span><span class="v23-dna-bar"><i class="v23-dna-fill" style="width:'+row[1]+'%"></i></span><b>'+row[1]+'%</b>';grid.appendChild(d);});
  }

  /* ---------- 11. Easter egg ---------- */
  function initEgg(){
    var typed='';
    document.addEventListener('keydown',function(e){if(e.key.length!==1)return;typed=(typed+e.key.toLowerCase()).slice(-6);if(typed==='kraven'){typed='';achievement('Kraven Mode','راز Kraven را پیدا کردی 😈',250);document.body.classList.add('kraven-egg');setTimeout(function(){document.body.classList.remove('kraven-egg');},5200);}});
  }

  /* ---------- 12. Global interaction polish + quick actions ---------- */
  function bindInteractions(){
    document.addEventListener('pointerdown',function(e){
      var el=e.target.closest&&e.target.closest('button,a,[role="button"],.game-card,.icon-btn,.v16-primary,.v16-ghost');
      if(el&&!el.closest('#v23-command-overlay')) playClick();
      var p=e.target.closest&&e.target.closest('[data-v23-preview]');if(p){e.preventDefault();e.stopPropagation();var card=p.closest('.game-card');if(p.dataset.v23Preview==='open'){openGameFromCard(card);toast('در حال باز کردن صفحه بازی…','🎮');}else cardFavorite(card);}
    },true);
    document.addEventListener('keydown',function(e){
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommand();}
      else if(e.key==='/'&&!/input|textarea|select/i.test(document.activeElement&&document.activeElement.tagName)){e.preventDefault();openCommand();}
      else if(e.key==='Escape'&&commandOpen){closeCommand();}
    });
    document.addEventListener('click',function(e){var page=e.target.closest&&e.target.closest('[data-page]');if(page)setTimeout(syncBottomNav,100);});
  }

  function refresh(){decorateCards();initImageQuality();initDNA();syncBottomNav();}

  ready(function(){
    bindAudioUnlock();bindInteractions();ensureCommand();initHeroParallax();initBottomNav();initThemeObserver();initMagnetic();initEgg();refresh();
    [250,800,1600,3000].forEach(function(ms){setTimeout(refresh,ms);});
    /* SPA-safe periodic rescans without MutationObserver loops. */
    var clicks=0;document.addEventListener('click',function(){clicks++;if(clicks%7===0)setTimeout(refresh,60);},{passive:true});
    /* Surface a welcome micro-UX only on the first V23 run. */
    try{if(localStorage.getItem('kraven_v23_welcomed')!=='1'){setTimeout(function(){toast('Kraven V23 آماده‌ست — Ctrl + K را امتحان کن!','⚡');localStorage.setItem('kraven_v23_welcomed','1');},1200);}}catch(e){}
  });
})();
(function(){
  'use strict';
  function init(){
    var root=document.getElementById('page-home');
    if(!root) return;
    var reduced=window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var candidates=root.querySelectorAll('section, .section, .home-section, .section-block, .content-section, .game-card, .news-card, .content-card, .featured-card, .panel, #kraven-mini-arcade, #kraven-mini-arcade .kraven-arcade-card, .v23-card-preview, .v22-typewriter-wrap');
    var idx=0;
    for(var i=0;i<candidates.length;i++){
      var el=candidates[i];
      if(!el || el.closest('.kraven-arcade-modal')) continue;
      if(el.classList.contains('v25-reveal')) continue;
      el.classList.add('v25-reveal');
      idx=(idx%6)+1;
      el.setAttribute('data-v25-delay',String(idx));
    }
    if(reduced){for(var j=0;j<candidates.length;j++)candidates[j].classList.add('v25-visible');return;}
    if(!('IntersectionObserver' in window)){
      for(var k=0;k<candidates.length;k++)candidates[k].classList.add('v25-visible');
      return;
    }
    var io=new IntersectionObserver(function(entries){
      for(var z=0;z<entries.length;z++){
        var e=entries[z];
        if(e.isIntersecting){
          e.target.classList.add('v25-visible');
          io.unobserve(e.target);
        }
      }
    },{root:null,rootMargin:'0px 0px -10% 0px',threshold:.08});
    for(var q=0;q<candidates.length;q++)io.observe(candidates[q]);

    /* Add gentle stagger wrappers to dense card grids without cloning or rendering. */
    var grids=root.querySelectorAll('.game-grid, .games-grid, .news-grid, .cards-grid, .kraven-arcade-grid');
    for(var g=0;g<grids.length;g++){
      var children=grids[g].children;
      for(var c=0;c<children.length;c++){
        children[c].classList.add('v25-reveal');
        children[c].setAttribute('data-v25-delay',String((c%6)+1));
      }
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
