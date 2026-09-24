/* =========================================================
   Jurnal Barber — logica aplicației
   Un singur fișier, fără biblioteci externe.
   Date salvate în IndexedDB (cu rezervă pe localStorage).
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     1. Utilitare
     --------------------------------------------------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const MONTHS = ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'];
  const MONTHS_SHORT = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];
  const WEEKDAYS = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];

  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const timeStr = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const parseDate = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseDate(s).getTime());
  const isTime = (s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 1250.5 -> "1.250,5"   |   80 -> "80"
  function fmt(n) {
    n = round2(n);
    const neg = n < 0;
    n = Math.abs(n);
    const parts = n.toFixed(2).split('.');
    const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + int + (parts[1] === '00' ? '' : ',' + parts[1]);
  }
  const money = (n) => fmt(n) + ' lei';

  // acceptă "80", "80.5", "80,5"
  function parseNum(v) {
    if (v === null || v === undefined) return NaN;
    const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    if (s === '') return NaN;
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  const countLabel = (n) => (n === 1 ? '1 tuns' : n + ' tunsuri');

  function longDate(s, withYear) {
    const d = parseDate(s);
    return WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + (withYear ? ' ' + d.getFullYear() : '');
  }

  /* ---------------------------------------------------------
     2. Stocare (IndexedDB + rezervă localStorage)
     --------------------------------------------------------- */
  const DB_NAME = 'jurnal-barber';
  const DB_VERSION = 1;

  const idbStore = {
    name: 'IndexedDB',
    db: null,
    open() {
      return new Promise((resolve, reject) => {
        if (!('indexedDB' in window) || !window.indexedDB) { reject(new Error('IndexedDB indisponibil')); return; }
        let req;
        try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('services')) db.createObjectStore('services', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('cuts')) db.createObjectStore('cuts', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
        };
        req.onsuccess = () => { this.db = req.result; resolve(); };
        req.onerror = () => reject(req.error || new Error('Nu pot deschide baza de date'));
        req.onblocked = () => reject(new Error('Baza de date este blocată'));
      });
    },
    tx(stores, fn) {
      return new Promise((resolve, reject) => {
        const t = this.db.transaction(stores, 'readwrite');
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Tranzacție anulată'));
        fn(t);
      });
    },
    getAll(name) {
      return new Promise((resolve, reject) => {
        const r = this.db.transaction(name, 'readonly').objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
    },
    async load() {
      const [services, cuts, settings] = await Promise.all([this.getAll('services'), this.getAll('cuts'), this.getAll('settings')]);
      return { services, cuts, settings };
    },
    put(name, obj) { return this.tx([name], (t) => { t.objectStore(name).put(obj); }); },
    del(name, id) { return this.tx([name], (t) => { t.objectStore(name).delete(id); }); },
    replaceAll(data) {
      return this.tx(['services', 'cuts', 'settings'], (t) => {
        ['services', 'cuts', 'settings'].forEach((n) => t.objectStore(n).clear());
        data.services.forEach((x) => t.objectStore('services').put(x));
        data.cuts.forEach((x) => t.objectStore('cuts').put(x));
        data.settings.forEach((x) => t.objectStore('settings').put(x));
      });
    }
  };

  const lsStore = {
    name: 'localStorage',
    KEY: 'jb-data-v1',
    async open() { localStorage.setItem('jb-probe', '1'); localStorage.removeItem('jb-probe'); },
    read() { try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; } catch (e) { return {}; } },
    write(d) { localStorage.setItem(this.KEY, JSON.stringify(d)); },
    async load() {
      const d = this.read();
      return {
        services: d.services || [],
        cuts: d.cuts || [],
        settings: Object.keys(d.settings || {}).map((k) => ({ key: k, value: d.settings[k] }))
      };
    },
    async put(name, obj) {
      const d = this.read();
      if (name === 'settings') {
        d.settings = d.settings || {};
        d.settings[obj.key] = obj.value;
      } else {
        d[name] = d[name] || [];
        const i = d[name].findIndex((x) => x.id === obj.id);
        if (i >= 0) d[name][i] = obj; else d[name].push(obj);
      }
      this.write(d);
    },
    async del(name, id) {
      const d = this.read();
      d[name] = (d[name] || []).filter((x) => x.id !== id);
      this.write(d);
    },
    async replaceAll(data) {
      const settings = {};
      data.settings.forEach((s) => { settings[s.key] = s.value; });
      this.write({ services: data.services, cuts: data.cuts, settings });
    }
  };

  let store = idbStore;

  /* ---------------------------------------------------------
     3. Stare
     --------------------------------------------------------- */
  const DEFAULT_SETTINGS = {
    threshold: 200,   // pragul (lei)
    keepBelow: 100,   // cât păstrez la tuns <= prag
    pctAbove: 50,     // % la mine peste prag
    tipsPct: 100,     // % din tips care rămâne la mine
    theme: 'system',
    seeded: false,
    lastExport: null
  };

  const DEFAULT_SERVICES = [
    { name: 'Fade', price: 80 },
    { name: 'Tuns clasic', price: 70 },
    { name: 'Tuns + barbă', price: 100 }
  ];

  const state = {
    services: [],
    cuts: [],
    settings: Object.assign({}, DEFAULT_SETTINGS)
  };

  const ui = {
    screen: 'home',
    calY: new Date().getFullYear(),
    calM: new Date().getMonth(),
    dayDate: null,      // ziua deschisă în fereastra "Zi"
    cutForm: null,      // starea formularului de tuns
    svcForm: null       // starea formularului de serviciu
  };

  /* ---------------------------------------------------------
     4. Calculul cu șeful (regula vine din setări)
     --------------------------------------------------------- */
  // Regula se aplică pe SUMA tunsurilor dintr-o zi (tips-ul nu intră în sumă).
  function calcDay(list, rules) {
    const r = rules || state.settings;
    let sum = 0, tips = 0;
    list.forEach((c) => { sum += c.price; tips += c.tips; });

    const me = sum <= r.threshold ? Math.min(sum, r.keepBelow) : sum * r.pctAbove / 100;
    const boss = sum - me;

    const tipsMine = tips * r.tipsPct / 100;
    return { me: round2(me + tipsMine), boss: round2(boss + tips - tipsMine) };
  }

  // Însumează o listă de tunsuri (întotdeauna zile întregi). Împărțirea se calculează zi cu zi.
  function summarize(list) {
    const s = { count: 0, cutsTotal: 0, tips: 0, total: 0, me: 0, boss: 0 };
    const days = {};
    list.forEach((c) => {
      s.count += 1;
      s.cutsTotal += c.price;
      s.tips += c.tips;
      (days[c.date] = days[c.date] || []).push(c);
    });
    Object.keys(days).forEach((k) => {
      const d = calcDay(days[k]);
      s.me += d.me;
      s.boss += d.boss;
    });
    s.cutsTotal = round2(s.cutsTotal);
    s.tips = round2(s.tips);
    s.me = round2(s.me);
    s.boss = round2(s.boss);
    s.total = round2(s.cutsTotal + s.tips);
    return s;
  }

  const cutSort = (a, b) =>
    a.date === b.date
      ? (a.time === b.time ? (a.createdAt || 0) - (b.createdAt || 0) : (a.time < b.time ? -1 : 1))
      : (a.date < b.date ? -1 : 1);

  function cutsOfDay(ds) {
    return state.cuts.filter((c) => c.date === ds).sort(cutSort);
  }

  function groupByDate() {
    const map = {};
    state.cuts.forEach((c) => { (map[c.date] = map[c.date] || []).push(c); });
    Object.keys(map).forEach((k) => map[k].sort(cutSort));
    return map;
  }

  function weekRange(now) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const offset = (d.getDay() + 6) % 7; // luni = 0
    const start = new Date(d); start.setDate(d.getDate() - offset);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { start, end };
  }

  /* ---------------------------------------------------------
     5. Ferestre, dialoguri, toast
     --------------------------------------------------------- */
  function updateLock() {
    document.body.classList.toggle('no-scroll', !!document.querySelector('.overlay:not([hidden])'));
  }
  function show(sel) { $(sel).hidden = false; updateLock(); }
  function hide(sel) { $(sel).hidden = true; updateLock(); }

  let toastTimer = null;
  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (type === 'error' ? ' error' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, type === 'error' ? 4000 : 2200);
  }

  let confirmResolve = null;
  function confirmDialog(opts) {
    return new Promise((resolve) => {
      if (confirmResolve) confirmResolve(false);
      confirmResolve = resolve;
      $('#confirmTitle').textContent = opts.title;
      $('#confirmText').textContent = opts.text;
      const ok = $('#confirmOk');
      ok.textContent = opts.okLabel || 'OK';
      ok.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
      show('#confirmDialog');
    });
  }
  function closeConfirm(value) {
    hide('#confirmDialog');
    const r = confirmResolve;
    confirmResolve = null;
    if (r) r(value);
  }

  function showError(sel, msg) {
    const el = $(sel);
    if (msg) { el.textContent = msg; el.hidden = false; } else { el.hidden = true; }
  }

  async function safely(fn) {
    try { return await fn(); }
    catch (e) {
      console.error(e);
      toast('Nu am putut salva. Încearcă din nou.', 'error');
      return undefined;
    }
  }

  /* ---------------------------------------------------------
     6. Desenare ecrane
     --------------------------------------------------------- */
  const metric = (label, value, cls) =>
    '<div class="metric ' + (cls || '') + '"><div class="m-label">' + label + '</div><div class="m-value">' + value + '</div></div>';

  function cutRow(c) {
    const tipTxt = c.tips > 0 ? ' + ' + money(c.tips) + ' tips' : '';
    return '<button class="cut-row" data-action="edit-cut" data-id="' + esc(c.id) + '">' +
      '<div><div class="cut-name">' + esc(c.name) + '<span class="cut-time">' + esc(c.time) + '</span></div>' +
      '<div class="cut-sub">' + money(c.price) + tipTxt + '</div></div>' +
      '<div class="cut-right"><div class="cut-me">' + money(c.price + c.tips) + '</div></div></button>';
  }

  function renderHome() {
    const today = dateStr(new Date());
    const list = cutsOfDay(today);
    const s = summarize(list);

    $('#homeDate').textContent = longDate(today, true);

    $('#homeSummary').innerHTML =
      '<div class="hero-top"><div><div class="hero-label">Total azi</div>' +
      '<div class="hero-total">' + fmt(s.total) + '<small>lei</small></div></div>' +
      '<div class="hero-count">' + countLabel(s.count) + '</div></div>' +
      '<div class="hero-grid">' +
      metric('Tu', money(s.me), 'me') +
      metric('Șef', money(s.boss)) +
      metric('Tunsuri', money(s.cutsTotal)) +
      metric('Tips', money(s.tips)) +
      '</div>';

    let quick = '';
    if (state.services.length === 0) {
      quick += '<div class="quick-empty">Nu ai niciun serviciu salvat. Adaugă-le în Profil, sau folosește „Alt preț”.</div>';
    }
    state.services.forEach((sv) => {
      quick += '<button class="quick" data-action="quick" data-id="' + esc(sv.id) + '">' +
        '<span class="q-name">' + esc(sv.name) + '</span>' +
        '<span class="q-price">' + money(sv.price) + '</span></button>';
    });
    quick += '<button class="quick alt" data-action="quick-custom">Alt preț</button>';
    $('#quickGrid').innerHTML = quick;

    $('#homeList').innerHTML = list.length
      ? '<div class="list">' + list.slice().reverse().map(cutRow).join('') + '</div>'
      : '<div class="empty">Niciun tuns azi. Apasă pe un serviciu de mai sus ca să adaugi primul.</div>';
  }

  function renderCalendar() {
    const y = ui.calY, m = ui.calM;
    $('#calTitle').textContent = MONTHS[m] + ' ' + y;

    const byDate = groupByDate();
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const todayS = dateStr(new Date());

    let html = '';
    for (let i = 0; i < lead; i++) html += '<div class="cal-cell blank"></div>';
    let monthCuts = [];
    for (let d = 1; d <= days; d++) {
      const ds = y + '-' + pad(m + 1) + '-' + pad(d);
      const list = byDate[ds];
      const cls = 'cal-cell' + (list ? ' has' : '') + (ds === todayS ? ' today' : '');
      let amt = '';
      if (list) {
        monthCuts = monthCuts.concat(list);
        const total = summarize(list).total;
        const t = fmt(total);
        amt = '<span class="amt">' + (t.length <= 4 ? t + ' lei' : t) + '</span>';
      }
      html += '<button class="' + cls + '" data-action="open-day" data-date="' + ds + '" aria-label="' + d + ' ' + MONTHS[m] + '">' +
        '<span class="d">' + d + '</span>' + amt + '</button>';
    }
    $('#calGrid').innerHTML = html;

    const ms = summarize(monthCuts);
    $('#calFoot').innerHTML = ms.count
      ? '<b>' + money(ms.total) + '</b> în ' + MONTHS[m] + ', din ' + countLabel(ms.count)
      : 'Niciun tuns în ' + MONTHS[m] + '.';
  }

  function statCard(title, range, list) {
    const s = summarize(list);
    return '<div class="stat-card"><div class="stat-head"><h3>' + title + '</h3><span>' + range + '</span></div>' +
      '<div class="stat-grid">' +
      metric('Tunsuri', money(s.cutsTotal)) +
      metric('Tips', money(s.tips)) +
      metric('Total', money(s.total)) +
      metric('Tu', money(s.me), 'me') +
      metric('Șef', money(s.boss)) +
      metric('Număr tunsuri', String(s.count)) +
      '</div></div>';
  }

  function renderHistory() {
    const now = new Date();
    const wr = weekRange(now);
    const ws = dateStr(wr.start), we = dateStr(wr.end);
    const weekList = state.cuts.filter((c) => c.date >= ws && c.date <= we);
    const monthPrefix = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    const monthList = state.cuts.filter((c) => c.date.slice(0, 7) === monthPrefix);

    const weekRangeTxt = wr.start.getDate() + ' ' + MONTHS_SHORT[wr.start.getMonth()] + ' – ' + wr.end.getDate() + ' ' + MONTHS_SHORT[wr.end.getMonth()];
    $('#statsBox').innerHTML =
      statCard('Săptămâna aceasta', weekRangeTxt, weekList) +
      statCard('Luna aceasta', MONTHS[now.getMonth()] + ' ' + now.getFullYear(), monthList);

    const byDate = groupByDate();
    const dates = Object.keys(byDate).sort().reverse();
    if (!dates.length) {
      $('#historyList').innerHTML = '<div class="empty">Încă nu ai înregistrat niciun tuns.</div>';
      return;
    }
    $('#historyList').innerHTML = dates.map((ds) => {
      const s = summarize(byDate[ds]);
      const d = parseDate(ds);
      const label = d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '');
      return '<button class="day-card" data-action="open-day" data-date="' + ds + '">' +
        '<div class="day-head"><span class="day-date">' + label + '</span><span class="day-count">' + countLabel(s.count) + '</span></div>' +
        '<div class="day-nums">' +
        '<span><span class="k">Total:</span><b>' + money(s.total) + '</b></span>' +
        '<span><span class="k">Tu:</span><b>' + money(s.me) + '</b></span>' +
        '<span><span class="k">Șef:</span><b>' + money(s.boss) + '</b></span>' +
        '</div></button>';
    }).join('');
  }

  const ICON_EDIT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 7.5l3 3"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/></svg>';

  function ruleHelpText() {
    const r = state.settings;
    return 'Tunsurile dintr-o zi se adună. Dacă suma zilei este până la ' + fmt(r.threshold) + ' lei: tu păstrezi ' + fmt(r.keepBelow) +
      ' lei (sau tot, dacă suma e mai mică), restul merge la șef. Peste ' + fmt(r.threshold) + ' lei: ' + fmt(r.pctAbove) + '% tu, ' +
      fmt(100 - r.pctAbove) + '% șef. Din tips rămâne ' + fmt(r.tipsPct) + '% la tine. Regula se aplică tuturor zilelor, inclusiv celor vechi.';
  }

  function renderProfile() {
    $('#serviceList').innerHTML = state.services.map((sv) =>
      '<div class="svc-row"><div class="svc-info"><div class="svc-name">' + esc(sv.name) + '</div>' +
      '<div class="svc-price">' + money(sv.price) + '</div></div>' +
      '<button class="icon-btn" data-action="edit-service" data-id="' + esc(sv.id) + '" aria-label="Editează ' + esc(sv.name) + '">' + ICON_EDIT + '</button>' +
      '<button class="icon-btn danger" data-action="delete-service" data-id="' + esc(sv.id) + '" aria-label="Șterge ' + esc(sv.name) + '">' + ICON_TRASH + '</button></div>'
    ).join('');

    const r = state.settings;
    $$('[data-rule]').forEach((inp) => { inp.value = fmt(r[inp.dataset.rule]); });
    $('#ruleHelp').textContent = ruleHelpText();

    $$('#themeSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.val === r.theme)));

    let backup = 'Descarcă un fișier cu toate datele tale. Păstrează-l în Fișiere / iCloud, ca să poți restaura datele dacă schimbi telefonul.';
    if (r.lastExport) {
      const d = new Date(r.lastExport);
      if (!isNaN(d.getTime())) backup = 'Ultimul backup: ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', ' + timeStr(d) + '. ' + backup;
    }
    $('#backupHelp').textContent = backup;
    $('#storageInfo').textContent = 'Datele sunt salvate doar pe acest telefon (' + store.name + ').';
  }

  function renderDay() {
    if (!ui.dayDate) return;
    const list = cutsOfDay(ui.dayDate);
    const s = summarize(list);
    $('#daySheetTitle').textContent = longDate(ui.dayDate, true);
    $('#dayBody').innerHTML =
      '<div class="stat-card"><div class="stat-grid">' +
      metric('Tunsuri', money(s.cutsTotal)) +
      metric('Tips', money(s.tips)) +
      metric('Total', money(s.total)) +
      metric('Tu', money(s.me), 'me') +
      metric('Șef', money(s.boss)) +
      metric('Număr tunsuri', String(s.count)) +
      '</div></div>' +
      (list.length
        ? '<div class="list">' + list.map(cutRow).join('') + '</div>'
        : '<div class="empty">Niciun tuns în această zi.</div>');
  }

  function renderAll() {
    renderHome();
    renderCalendar();
    renderHistory();
    renderProfile();
    if (!$('#daySheet').hidden) renderDay();
  }

  /* ---------------------------------------------------------
     7. Navigare
     --------------------------------------------------------- */
  function showScreen(name) {
    ui.screen = name;
    $$('.screen').forEach((s) => { s.hidden = s.dataset.screen !== name; });
    $$('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------
     8. Fereastra TUNS (adăugare / editare)
     --------------------------------------------------------- */
  function openCutSheet(opts) {
    opts = opts || {};
    const now = new Date();
    const cut = opts.cut || null;
    const sv = opts.service || null;

    ui.cutForm = { id: cut ? cut.id : null, original: cut };

    $('#cutSheetTitle').textContent = cut ? 'Editează tunsul' : 'Tuns nou';
    $('#cutName').value = cut ? cut.name : (sv ? sv.name : '');
    $('#cutPrice').value = cut ? fmt(cut.price) : (sv ? fmt(sv.price) : '');
    $('#cutTips').value = cut && cut.tips ? fmt(cut.tips) : '';
    $('#cutDate').value = cut ? cut.date : (opts.date || dateStr(now));
    $('#cutTime').value = cut ? cut.time : timeStr(now);
    $('#cutDeleteBtn').hidden = !cut;
    showError('#cutError', '');

    $('#cutServiceChips').innerHTML = state.services.map((s) =>
      '<button class="chip" data-action="pick-service" data-id="' + esc(s.id) + '">' + esc(s.name) + '</button>'
    ).join('');

    updateCutChips();
    updateCutPreview();
    $('#cutSheet .sheet').scrollTop = 0;
    show('#cutSheet');

    if (opts.custom) $('#cutPrice').focus();
  }

  function closeCutSheet() {
    hide('#cutSheet');
    ui.cutForm = null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function updateCutChips() {
    const name = $('#cutName').value.trim().toLowerCase();
    $$('#cutServiceChips .chip').forEach((chip) => {
      const sv = state.services.find((s) => s.id === chip.dataset.id);
      chip.classList.toggle('on', !!sv && sv.name.toLowerCase() === name);
    });
    const tips = parseNum($('#cutTips').value);
    $$('#cutTipChips .chip').forEach((chip) => {
      const v = Number(chip.dataset.val);
      const cur = isNaN(tips) ? 0 : tips;
      chip.classList.toggle('on', cur === v && (v > 0 || $('#cutTips').value.trim() !== ''));
    });
  }

  function updateCutPreview() {
    let price = parseNum($('#cutPrice').value);
    let tips = parseNum($('#cutTips').value);
    if (isNaN(price)) price = 0;
    if (isNaN(tips)) tips = 0;
    const date = $('#cutDate').value;
    const editId = ui.cutForm && ui.cutForm.id;

    let html = '<span>Total client: <b>' + money(price + tips) + '</b></span>';
    if (isDate(date)) {
      const others = state.cuts.filter((c) => c.date === date && c.id !== editId);
      const day = calcDay(others.concat([{ price: price, tips: tips }]));
      html += '<span>Ziua: Tu <b>' + money(day.me) + '</b>, Șef <b>' + money(day.boss) + '</b></span>';
    }
    $('#cutPreview').innerHTML = html;
  }

  async function saveCut() {
    const name = $('#cutName').value.trim() || 'Tuns';
    const price = parseNum($('#cutPrice').value);
    let tips = parseNum($('#cutTips').value);
    const date = $('#cutDate').value;
    const time = $('#cutTime').value || '00:00';

    if (isNaN(price) || price < 0) { showError('#cutError', 'Introdu un preț valid (de exemplu 80).'); return; }
    if ($('#cutTips').value.trim() !== '' && (isNaN(tips) || tips < 0)) { showError('#cutError', 'Tips-ul trebuie să fie un număr, de exemplu 20.'); return; }
    if (isNaN(tips)) tips = 0;
    if (!isDate(date)) { showError('#cutError', 'Alege o dată validă.'); return; }
    showError('#cutError', '');

    const existing = ui.cutForm && ui.cutForm.original;
    const cut = {
      id: existing ? existing.id : uid(),
      name: name,
      price: round2(price),
      tips: round2(tips),
      date: date,
      time: isTime(time) ? time : '00:00',
      createdAt: existing ? existing.createdAt : Date.now()
    };

    const ok = await safely(async () => {
      await store.put('cuts', cut);
      const i = state.cuts.findIndex((c) => c.id === cut.id);
      if (i >= 0) state.cuts[i] = cut; else state.cuts.push(cut);
      return true;
    });
    if (!ok) return;

    const wasEdit = !!existing;
    closeCutSheet();
    renderAll();
    toast(wasEdit ? 'Tunsul a fost actualizat' : 'Tunsul a fost salvat');
  }

  async function deleteCut() {
    const c = ui.cutForm && ui.cutForm.original;
    if (!c) return;
    const yes = await confirmDialog({
      title: 'Ștergi tunsul?',
      text: c.name + ' — ' + money(c.price + c.tips) + ', ' + parseDate(c.date).getDate() + ' ' + MONTHS[parseDate(c.date).getMonth()] + '. Acțiunea nu poate fi anulată.',
      okLabel: 'Șterge',
      danger: true
    });
    if (!yes) return;
    const ok = await safely(async () => {
      await store.del('cuts', c.id);
      state.cuts = state.cuts.filter((x) => x.id !== c.id);
      return true;
    });
    if (!ok) return;
    closeCutSheet();
    renderAll();
    toast('Tunsul a fost șters');
  }

  /* ---------------------------------------------------------
     9. Fereastra SERVICIU (adăugare / editare)
     --------------------------------------------------------- */
  function openServiceSheet(sv) {
    ui.svcForm = { id: sv ? sv.id : null };
    $('#svcSheetTitle').textContent = sv ? 'Editează serviciul' : 'Serviciu nou';
    $('#svcName').value = sv ? sv.name : '';
    $('#svcPrice').value = sv ? fmt(sv.price) : '';
    showError('#svcError', '');
    show('#serviceSheet');
    if (!sv) $('#svcName').focus();
  }

  function closeServiceSheet() {
    hide('#serviceSheet');
    ui.svcForm = null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  async function saveService() {
    const name = $('#svcName').value.trim();
    const price = parseNum($('#svcPrice').value);
    if (!name) { showError('#svcError', 'Scrie numele serviciului.'); return; }
    if (isNaN(price) || price < 0) { showError('#svcError', 'Introdu un preț valid (de exemplu 80).'); return; }

    const id = ui.svcForm && ui.svcForm.id;
    const sv = { id: id || uid(), name: name, price: round2(price) };
    if (id) {
      const old = state.services.find((s) => s.id === id);
      sv.createdAt = old && old.createdAt ? old.createdAt : Date.now();
    } else {
      sv.createdAt = Date.now();
    }

    const ok = await safely(async () => {
      await store.put('services', sv);
      const i = state.services.findIndex((s) => s.id === sv.id);
      if (i >= 0) state.services[i] = sv; else state.services.push(sv);
      return true;
    });
    if (!ok) return;

    closeServiceSheet();
    renderAll();
    toast(id ? 'Serviciul a fost actualizat' : 'Serviciul a fost adăugat');
  }

  async function deleteService(id) {
    const sv = state.services.find((s) => s.id === id);
    if (!sv) return;
    const yes = await confirmDialog({
      title: 'Ștergi serviciul?',
      text: '„' + sv.name + '” dispare din listă. Tunsurile deja înregistrate rămân neschimbate.',
      okLabel: 'Șterge',
      danger: true
    });
    if (!yes) return;
    const ok = await safely(async () => {
      await store.del('services', id);
      state.services = state.services.filter((s) => s.id !== id);
      return true;
    });
    if (!ok) return;
    renderAll();
    toast('Serviciul a fost șters');
  }

  /* ---------------------------------------------------------
     10. Setări: regula, tema
     --------------------------------------------------------- */
  const RULE_LIMITS = {
    threshold: { min: 0, max: 1000000 },
    keepBelow: { min: 0, max: 1000000 },
    pctAbove: { min: 0, max: 100 },
    tipsPct: { min: 0, max: 100 }
  };

  async function saveSetting(key, value) {
    await store.put('settings', { key: key, value: value });
    state.settings[key] = value;
  }

  async function onRuleChange(input) {
    const key = input.dataset.rule;
    const lim = RULE_LIMITS[key];
    const v = parseNum(input.value);
    if (isNaN(v) || v < lim.min || v > lim.max) {
      input.value = fmt(state.settings[key]);
      toast(lim.max === 100 ? 'Introdu un procent între 0 și 100.' : 'Introdu un număr valid.', 'error');
      return;
    }
    const ok = await safely(async () => { await saveSetting(key, round2(v)); return true; });
    input.value = fmt(state.settings[key]);
    if (ok) {
      renderAll(); // sumele Tu/Șef se recalculează peste tot
      toast('Regula a fost salvată');
    }
  }

  function effectiveDark() {
    const t = state.settings.theme;
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function applyTheme() {
    const t = state.settings.theme;
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('jb-theme', t); } catch (e) { /* ignorat */ }
    const meta = $('#themeColor');
    if (meta) meta.setAttribute('content', effectiveDark() ? '#0a0f1d' : '#edeff2');
  }

  async function setTheme(val) {
    const ok = await safely(async () => { await saveSetting('theme', val); return true; });
    if (!ok) return;
    applyTheme();
    renderProfile();
  }

  /* ---------------------------------------------------------
     11. Backup: export / import
     --------------------------------------------------------- */
  function buildBackup() {
    return {
      app: 'jurnal-barber',
      version: 1,
      exportedAt: new Date().toISOString(),
      services: state.services,
      cuts: state.cuts,
      settings: state.settings
    };
  }

  async function exportData() {
    const json = JSON.stringify(buildBackup(), null, 2);
    const fname = 'jurnal-barber-' + dateStr(new Date()) + '.json';
    let done = false;

    try {
      const file = new File([json], fname, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Backup Jurnal Barber' });
        done = true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // a închis fereastra de partajare
    }

    if (!done) {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    }

    await safely(async () => { await saveSetting('lastExport', new Date().toISOString()); });
    renderProfile();
    toast('Backup exportat');
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Nu am putut citi fișierul'));
      r.readAsText(file);
    });
  }

  function validateBackup(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cuts)) {
      throw new Error('nu este un backup Jurnal Barber');
    }

    const settings = Object.assign({}, DEFAULT_SETTINGS);
    const rs = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    ['threshold', 'keepBelow', 'pctAbove', 'tipsPct'].forEach((k) => {
      const lim = RULE_LIMITS[k];
      if (typeof rs[k] === 'number' && isFinite(rs[k]) && rs[k] >= lim.min && rs[k] <= lim.max) settings[k] = rs[k];
    });
    if (['light', 'dark', 'system'].indexOf(rs.theme) >= 0) settings.theme = rs.theme;
    settings.seeded = true;
    settings.lastExport = typeof rs.lastExport === 'string' ? rs.lastExport : null;

    const services = (Array.isArray(raw.services) ? raw.services : []).map((s, i) => {
      const price = Number(s && s.price);
      if (!s || typeof s.name !== 'string' || !s.name.trim() || !isFinite(price) || price < 0) {
        throw new Error('serviciul #' + (i + 1) + ' este invalid');
      }
      return { id: typeof s.id === 'string' && s.id ? s.id : uid(), name: s.name.trim(), price: round2(price), createdAt: Number(s.createdAt) || Date.now() + i };
    });

    const seen = {};
    const cuts = raw.cuts.map((c, i) => {
      const price = Number(c && c.price);
      const tips = c && c.tips !== undefined && c.tips !== null ? Number(c.tips) : 0;
      if (!c || !isFinite(price) || price < 0 || !isFinite(tips) || tips < 0 || !isDate(c.date)) {
        throw new Error('tunsul #' + (i + 1) + ' este invalid');
      }
      let id = typeof c.id === 'string' && c.id ? c.id : uid();
      if (seen[id]) id = uid();
      seen[id] = true;
      return {
        id: id,
        name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'Tuns',
        price: round2(price),
        tips: round2(tips),
        date: c.date,
        time: isTime(c.time) ? c.time : '00:00',
        createdAt: Number(c.createdAt) || Date.now() + i
      };
    });

    return { services: services, cuts: cuts, settings: settings };
  }

  async function onImportFile(file) {
    let data;
    try {
      const text = await readFileText(file);
      data = validateBackup(JSON.parse(text));
    } catch (e) {
      toast('Fișier invalid: ' + (e && e.message ? e.message : 'nu pot citi datele'), 'error');
      return;
    }

    const yes = await confirmDialog({
      title: 'Imporți datele?',
      text: 'Datele de acum (' + countLabel(state.cuts.length) + ', ' + state.services.length + ' servicii) vor fi ÎNLOCUITE cu cele din fișier (' +
        countLabel(data.cuts.length) + ', ' + data.services.length + ' servicii). Sfat: exportă întâi datele curente.',
      okLabel: 'Importă',
      danger: true
    });
    if (!yes) return;

    const ok = await safely(async () => {
      await store.replaceAll({
        services: data.services,
        cuts: data.cuts,
        settings: Object.keys(data.settings).map((k) => ({ key: k, value: data.settings[k] }))
      });
      state.services = data.services;
      state.cuts = data.cuts;
      state.settings = data.settings;
      return true;
    });
    if (!ok) return;

    applyTheme();
    renderAll();
    toast('Datele au fost importate');
  }

  /* ---------------------------------------------------------
     12. Evenimente
     --------------------------------------------------------- */
  function onAction(el) {
    const a = el.dataset.action;
    const id = el.dataset.id;

    switch (a) {
      // Acasă
      case 'quick': {
        const sv = state.services.find((s) => s.id === id);
        if (sv) openCutSheet({ service: sv });
        break;
      }
      case 'quick-custom': openCutSheet({ custom: true }); break;

      // Tuns
      case 'edit-cut': {
        const c = state.cuts.find((x) => x.id === id);
        if (c) openCutSheet({ cut: c });
        break;
      }
      case 'pick-service': {
        const sv = state.services.find((s) => s.id === id);
        if (sv) {
          $('#cutName').value = sv.name;
          $('#cutPrice').value = fmt(sv.price);
          updateCutChips();
          updateCutPreview();
        }
        break;
      }
      case 'tip':
        $('#cutTips').value = el.dataset.val === '0' ? '' : el.dataset.val;
        updateCutChips();
        updateCutPreview();
        break;
      case 'save-cut': saveCut(); break;
      case 'close-cut': closeCutSheet(); break;
      case 'delete-cut': deleteCut(); break;

      // Calendar / zile
      case 'cal-prev':
        ui.calM -= 1;
        if (ui.calM < 0) { ui.calM = 11; ui.calY -= 1; }
        renderCalendar();
        break;
      case 'cal-next':
        ui.calM += 1;
        if (ui.calM > 11) { ui.calM = 0; ui.calY += 1; }
        renderCalendar();
        break;
      case 'open-day':
        ui.dayDate = el.dataset.date;
        renderDay();
        $('#daySheet .sheet').scrollTop = 0;
        show('#daySheet');
        break;
      case 'close-day':
        hide('#daySheet');
        ui.dayDate = null;
        break;
      case 'add-cut-day':
        openCutSheet({ date: ui.dayDate || dateStr(new Date()) });
        break;

      // Servicii
      case 'add-service': openServiceSheet(null); break;
      case 'edit-service': {
        const sv = state.services.find((s) => s.id === id);
        if (sv) openServiceSheet(sv);
        break;
      }
      case 'delete-service': deleteService(id); break;
      case 'save-service': saveService(); break;
      case 'close-service': closeServiceSheet(); break;

      // Setări
      case 'theme': setTheme(el.dataset.val); break;
      case 'export': exportData(); break;
      case 'import': $('#importFile').click(); break;

      // Confirmare
      case 'confirm-ok': closeConfirm(true); break;
      case 'confirm-cancel': closeConfirm(false); break;
    }
  }

  function bindEvents() {
    document.addEventListener('click', (e) => {
      // apăsare pe fundalul întunecat = închide fereastra
      if (e.target.classList && e.target.classList.contains('overlay')) {
        const id = e.target.id;
        if (id === 'confirmDialog') closeConfirm(false);
        else if (id === 'cutSheet') closeCutSheet();
        else if (id === 'serviceSheet') closeServiceSheet();
        else if (id === 'daySheet') { hide('#daySheet'); ui.dayDate = null; }
        return;
      }
      const tab = e.target.closest('.tab');
      if (tab) { showScreen(tab.dataset.tab); return; }
      const el = e.target.closest('[data-action]');
      if (el) onAction(el);
    });

    // Formular tuns
    ['#cutPrice', '#cutTips'].forEach((s) => $(s).addEventListener('input', () => { updateCutChips(); updateCutPreview(); }));
    $('#cutName').addEventListener('input', updateCutChips);
    $('#cutDate').addEventListener('change', updateCutPreview);
    ['#cutName', '#cutPrice', '#cutTips'].forEach((s) => $(s).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveCut(); }
    }));
    ['#svcName', '#svcPrice'].forEach((s) => $(s).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveService(); }
    }));

    // Regula de împărțire
    $$('[data-rule]').forEach((inp) => {
      inp.addEventListener('change', () => onRuleChange(inp));
      inp.addEventListener('focus', () => { try { inp.select(); } catch (e) { /* ignorat */ } });
    });

    // Import
    $('#importFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) onImportFile(f);
    });

    // Reîmprospătează când revii în aplicație (ex: a trecut miezul nopții)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderAll();
    });

    // Tema „Sistem” se schimbă live
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (state.settings.theme === 'system') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  /* ---------------------------------------------------------
     13. Pornire
     --------------------------------------------------------- */
  async function init() {
    try {
      await idbStore.open();
      store = idbStore;
    } catch (e) {
      console.warn('IndexedDB indisponibil, folosesc localStorage', e);
      try { await lsStore.open(); store = lsStore; }
      catch (e2) { toast('Salvarea datelor nu este disponibilă în acest mod de navigare.', 'error'); }
    }

    try {
      const data = await store.load();
      state.services = (data.services || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      state.cuts = data.cuts || [];
      const loaded = {};
      (data.settings || []).forEach((s) => { loaded[s.key] = s.value; });
      state.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

      // Prima pornire: serviciile tale implicite
      if (!state.settings.seeded) {
        const base = Date.now();
        for (let i = 0; i < DEFAULT_SERVICES.length; i++) {
          const sv = { id: uid(), name: DEFAULT_SERVICES[i].name, price: DEFAULT_SERVICES[i].price, createdAt: base + i };
          await store.put('services', sv);
          state.services.push(sv);
        }
        await saveSetting('seeded', true);
      }
    } catch (e) {
      console.error(e);
      toast('Nu am putut citi datele salvate.', 'error');
    }

    applyTheme();
    bindEvents();
    showScreen('home');
    renderAll();

    // Cere browserului să nu șteargă datele (nu e garantat, dar ajută)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignorat */ }

    // Service worker (funcționare offline)
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW:', e));
    }
  }

  // Pentru teste automate (nu afectează aplicația)
  window.__jb = { calcDay: calcDay, state: state, fmt: fmt, summarize: summarize };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
