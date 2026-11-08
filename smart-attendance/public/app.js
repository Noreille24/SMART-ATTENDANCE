/* Smart Attendance Interface - single-page frontend (vanilla JS, no build step) */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app'), dlg = $('#dlg');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const state = { user: null, clock: null, offset: 0, ready: false, config: null, filter: 'all', closed: new Set() };
  let timers = [], cur = null, ci = null, stream = null;

  /* ---------- helpers ---------- */
  const fmt12 = (s) => { const [h, m] = s.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
  const addMin = (s, n) => { const [h, m] = s.split(':').map(Number); const t = h * 60 + m + n; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const dayLabel = (days) => { const d = [...days].sort(); return d.join() === '1,2,3,4,5' ? 'Mon–Fri' : d.map((x) => DAYS[x]).join(', '); };
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (s) => parseYmd(s).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeOf = (iso) => (iso ? fmt12(iso.slice(11, 16)) : '');
  const serverNow = () => new Date(Date.now() + state.offset);
  const todayStr = () => { const d = serverNow(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtCode = (c) => `${c.slice(0, 3)}-${c.slice(3)}`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const ICON = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v0M14 20h3M20 17v4"/></svg>',
    hist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  };
  const LOGO = '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1d4ed8"/><path d="M8 17l5 5 11-12" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const STATUS = { present: ['✓', 'Present'], late: ['◔', 'Late'], absent: ['✕', 'Absent'], pending: ['…', 'Not yet'] };
  const chip = (s, extra = '', label) => `<span class="chip chip-${s} ${extra}"><span aria-hidden="true">${STATUS[s][0]}</span>${esc(label || STATUS[s][1])}</span>`;
  const errBox = (e) => `<div class="alert error" role="alert"><b>${esc(e.message)}</b>${e.hint ? esc(e.hint) : ''}</div>`;

  async function api(path, opts = {}) {
    let res;
    try {
      res = await fetch('/api' + path, { method: opts.method || 'GET', credentials: 'same-origin',
        headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch {
      const e = new Error('You seem to be offline.'); e.hint = 'Check your connection and try again.'; e.code = 'offline'; throw e;
    }
    let data = null; try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      const e = new Error(data?.error?.message || 'Something went wrong. Please try again.');
      e.code = data?.error?.code; e.hint = data?.error?.hint; e.status = res.status; throw e;
    }
    if (data?.clock) setClock(data.clock);
    return data;
  }
  function setClock(c) {
    state.clock = c;
    const [d, t] = c.iso.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi, s] = t.split(':').map(Number);
    state.offset = new Date(y, m - 1, dd, h, mi, s).getTime() - Date.now();
  }
  const clockText = () => serverNow().toLocaleString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  /* ---------- dialogs & toasts ---------- */
  function openDlg(html, cls = '') { dlg.className = cls; dlg.returnValue = ''; dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); const f = dlg.querySelector('[autofocus]'); if (f) f.focus(); }
  const closeDlg = () => { if (dlg.open) dlg.close(); };
  function confirmDlg({ title, body, ok = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      openDlg(`<form method="dialog"><h2 id="dlg-title">${esc(title)}</h2><p>${esc(body)}</p>
        <div class="btnrow"><button class="btn secondary" value="no" autofocus>Cancel</button><button class="btn ${danger ? 'danger' : ''}" value="yes">${esc(ok)}</button></div></form>`);
      const done = () => { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'yes'); };
      dlg.addEventListener('close', done);
    });
  }
  function toast(msg, { action, ms = 5000 } = {}) {
    const el = document.createElement('div'); el.className = 'toast';
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
    $('#toasts').appendChild(el);
    const kill = () => el.remove();
    if (action) el.querySelector('button').addEventListener('click', () => { kill(); action.fn(); });
    setTimeout(kill, action ? Math.max(ms, 8000) : ms);
  }

  /* ---------- shell & routing ---------- */
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; stopScan(); };
  function shell(active) {
    const u = state.user, isT = u.role === 'teacher';
    const links = isT
      ? [['#/t', 'list', 'Classes', 'classes'], ['#/t/new', 'plus', 'New class', 'new'], ['#/t/reports', 'chart', 'Reports', 'reports']]
      : [['#/home', 'home', 'Home', 'home'], ['#/schedule', 'cal', 'Schedule', 'schedule'], ['#/checkin', 'qr', 'Check in', 'checkin'], ['#/history', 'hist', 'History', 'history']];
    const demo = state.clock?.demo;
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">${LOGO}<span>Smart Attendance</span></div>
        <div class="who"><b>${esc(u.name)}</b><span>${isT ? 'Teacher' : 'Student ' + esc(u.school_id)}</span></div>
        <button class="icon-btn" data-act="textsize" aria-pressed="${document.documentElement.classList.contains('big-text')}" aria-label="Larger text" title="Larger text">A+</button>
        <button class="icon-btn" data-act="logout">Sign out</button>
      </header>
      <div class="clockbar ${demo ? 'demo' : ''}">
        <span>🕒 <b id="clk">${esc(clockText())}</b>${demo ? ' · <b>Demo clock</b> <button class="btn small secondary" data-act="clock-reset">Use real time</button>' : ''}</span>
        <details><summary>Demo clock</summary>
          <form class="clockform" data-form="clock"><label>Pretend it is…<input type="datetime-local" name="dt" required></label><button class="btn small">Set time</button></form>
          <p class="small muted">Testing tool: try Present, Late and Absent without waiting for class. Affects everyone using this server.</p>
        </details>
      </div>
      <main id="view" tabindex="-1" aria-live="polite"><p class="muted">Loading…</p></main>
      <nav class="nav" aria-label="Main">${links.map(([h, ic, label, key]) =>
        `<a href="${h}" ${key === active ? 'aria-current="page"' : ''} class="${key === 'checkin' ? 'primary' : ''}">${key === 'checkin' ? `<span class="pill">${ICON[ic]}<span>${label}</span></span>` : `${ICON[ic]}<span>${label}</span>`}</a>`).join('')}</nav>`;
    const inp = $('input[name=dt]'); if (inp) { const d = serverNow(); d.setSeconds(0); inp.value = `${todayStr()}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
    timers.push(setInterval(() => { const c = $('#clk'); if (c) c.textContent = clockText(); }, 15000));
  }
  const view = (html) => { const v = $('#view'); if (v) v.innerHTML = html; };
  function focusView(title) { document.title = `${title} · Smart Attendance`; const v = $('#view'); if (v) v.focus({ preventScroll: true }); window.scrollTo(0, 0); }

  const ROUTES = [];
  const route = (pattern, role, render) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); ROUTES.push({ re, keys, role, render }); };
  function match(path) {
    for (const r of ROUTES) { const m = r.re.exec(path); if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; }
    return null;
  }
  async function loadMe() { try { const d = await api('/me'); state.user = d.user; } catch { state.user = null; } state.ready = true; }
  async function navigate() {
    clearTimers(); closeDlg();
    if (!state.ready) await loadMe();
    const [path, qs] = (location.hash || '#/').slice(1).split('?'); const query = new URLSearchParams(qs || '');
    const r = match(path || '/');
    if (!state.user) {
      if (!r || r.route.role !== null) { if (r) sessionStorage.setItem('pending', location.hash); location.hash = '#/login'; return; }
    } else if (!r || path === '/login' || path === '/' || (r.route.role && r.route.role !== state.user.role)) {
      location.hash = state.user.role === 'teacher' ? '#/t' : '#/home'; return;
    }
    try { await r.route.render(r.params, query); }
    catch (e) {
      if (e.status === 401) { state.user = null; location.hash = '#/login'; return; }
      if (state.user && !$('#view')) shell('');
      view(`${errBox(e)}<p style="margin-top:1rem"><button class="btn" data-act="retry">Try again</button></p>`);
    }
  }

  /* ---------- login ---------- */
  route('/login', null, () => {
    document.title = 'Sign in · Smart Attendance';
    app.innerHTML = `<div class="login">
      <div class="logo">${LOGO.replace('width="32" height="32"', 'width="64" height="64"')}<h1>Smart Attendance</h1><p class="muted">Sign in to check in to class or manage attendance.</p></div>
      <form class="card form" data-form="login" novalidate>
        <label class="field">Student ID or teacher username<input type="text" name="id" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>
        <label class="field">Password<input type="password" name="password" autocomplete="current-password" required></label>
        <label class="checkrow"><input type="checkbox" data-act="showpw"> Show password</label>
        <div id="loginerr" role="alert"></div>
        <button class="btn big">Sign in</button>
      </form>
      <details class="card"><summary><b>Demo accounts</b></summary>
        <dl class="kv" style="margin-top:.7rem"><dt>Teacher</dt><dd>teacher1 / teacher123</dd><dt>Student</dt><dd>2024-001 / 2024-001</dd></dl>
        <p class="small muted" style="margin-top:.5rem">Students’ first password is their Student ID. Teacher 1 teaches HCI; Rizal is taught by teacher2.</p></details></div>`;
  });

  /* ---------- student: home ---------- */
  route('/home', 'student', async () => {
    shell('home');
    const d = await api('/student/home');
    const first = state.user.name.split(' ')[0];
    const open = d.classes.filter((c) => c.status === 'pending' && (c.window === 'present' || c.window === 'late'));
    const statusLine = (c) => {
      if (c.status === 'present' || c.status === 'late') return `Checked in at ${timeOf(c.checked_at)}`;
      if (c.status === 'absent') return c.checked_at ? 'Marked absent by your teacher' : 'Class ended without a check-in';
      return c.window === 'early' ? `Starts at ${fmt12(c.start)}` : 'You haven’t checked in yet';
    };
    view(`<div class="stack">
      <div><h1>Hi, ${esc(first)}</h1><p class="muted">${esc(clockText())}</p></div>
      ${open.length ? `<a class="btn big" href="#/checkin">${ICON.qr.replace('<svg', '<svg width="26" height="26"')} Check in to ${esc(open[0].subject)} now</a>` : ''}
      <section class="card" aria-labelledby="h-status"><h2 id="h-status">Attendance status today</h2>
        ${d.classes.length ? `<ul class="list">${d.classes.map((c) => `<li><div class="grow"><div class="title">${esc(c.subject)}</div><div class="small muted">${esc(statusLine(c))}</div></div>${chip(c.status)}</li>`).join('')}</ul>`
          : '<p class="muted">No classes today. Enjoy the break!</p>'}</section>
      <section class="card" aria-labelledby="h-sched"><h2 id="h-sched">Today’s classes</h2>
        ${d.classes.length ? `<ul class="list">${d.classes.map((c) => `<li><div class="timeblock">${fmt12(c.start)}<div class="small muted">to ${fmt12(c.end)}</div></div>
          <div class="grow"><div class="title">${esc(c.subject)}</div><div class="small muted">Section ${esc(c.section)} · ${esc(c.teacher)}</div></div>
          ${c.window === 'present' || c.window === 'late' ? '<span class="chip chip-pending live">In progress</span>' : ''}</li>`).join('')}</ul>`
          : '<p class="muted">Nothing scheduled. <a href="#/schedule">See your weekly schedule</a>.</p>'}</section>
      </div>`);
    focusView('Home');
  });

  route('/schedule', 'student', async () => {
    shell('schedule');
    const d = await api('/student/schedule'); const today = serverNow().getDay();
    view(`<div class="stack"><h1>Class schedule</h1>
      ${DAY_ORDER.map((day) => { const cs = d.classes.filter((c) => c.days.includes(day)); if (!cs.length) return '';
        return `<section class="card" aria-labelledby="d${day}"><h2 id="d${day}">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]} ${day === today ? '<span class="chip chip-pending">Today</span>' : ''}</h2>
          <ul class="list">${cs.map((c) => `<li><div class="timeblock">${fmt12(c.start)}<div class="small muted">to ${fmt12(c.end)}</div></div><div class="grow"><div class="title">${esc(c.subject)}</div><div class="small muted">Section ${esc(c.section)} · ${esc(c.teacher)}</div></div></li>`).join('')}</ul></section>`; }).join('')}
      ${d.classes.length ? '' : '<div class="card"><p class="muted">You aren’t registered in any class yet. Ask your teacher to add your Student ID.</p></div>'}</div>`);
    focusView('Schedule');
  });

  route('/history', 'student', async () => {
    shell('history');
    const render = async (classId) => {
      const d = await api('/student/history' + (classId ? `?class_id=${classId}` : '')); const s = d.summary;
      view(`<div class="stack"><div class="pagehead"><h1 class="grow">Attendance history</h1>
        <label class="field" style="min-width:11rem"><span class="sr-only">Class</span><select data-change="hist-class" aria-label="Filter by class"><option value="">All classes</option>${d.classes.map((c) => `<option value="${c.id}" ${String(c.id) === String(classId) ? 'selected' : ''}>${esc(c.subject)}</option>`).join('')}</select></label></div>
        <div class="stats"><div class="stat"><b>${s.present}</b><span>Present</span></div><div class="stat"><b>${s.late}</b><span>Late</span></div><div class="stat"><b>${s.absent}</b><span>Absent</span></div><div class="stat"><b>${s.rate == null ? '–' : s.rate + '%'}</b><span>Attendance rate</span></div></div>
        <section class="card" aria-label="Past classes">${d.items.length ? `<ul class="list">${d.items.map((i) => `<li><div class="timeblock" style="min-width:6.2rem">${esc(fmtDate(i.date))}</div><div class="grow"><div class="title">${esc(i.subject)}</div><div class="small muted">${i.checked_at ? 'Checked in ' + timeOf(i.checked_at) : 'No check-in'}</div></div>${chip(i.status)}</li>`).join('')}</ul>` : '<p class="muted">No past classes yet.</p>'}</section>
        ${s.late + s.absent > 0 && s.rate != null && s.rate < 80 ? '<div class="alert warn"><b>Heads up</b>Your attendance is below 80%. Talk to your teacher if any record looks wrong.</div>' : ''}</div>`);
      focusView('History');
    };
    actions['hist-class'] = (el) => render(el.value);
    await render('');
  });

  /* ---------- student: check-in ---------- */
  const scanOk = () => 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia && window.isSecureContext;
  function extractCode(raw) {
    const m = /checkin\/([A-Za-z0-9-]{6,7})/i.exec(raw); const c = (m ? m[1] : raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return c.length === 6 ? c : null;
  }
  function stopScan() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }
  route('/checkin', 'student', () => checkinPage());
  route('/checkin/:code', 'student', (p) => checkinPage(p.code));
  async function checkinPage(code) {
    shell('checkin');
    ci = { started: Date.now(), method: 'code', mode: 'enter', code: '', err: null, preview: null, result: null };
    if (code) { ci.method = 'qr'; ci.code = code.toUpperCase().replace(/[^A-Z0-9]/g, ''); await ciPreview(); } else renderCi();
  }
  async function ciPreview() {
    ci.err = null;
    try { ci.preview = await api('/checkin/preview', { method: 'POST', body: { code: ci.code } }); ci.mode = 'confirm'; }
    catch (e) { ci.err = e; ci.mode = 'enter'; }
    renderCi();
  }
  function renderCi() {
    const u = state.user;
    if (ci.mode === 'scanning') {
      view(`<div class="stack"><h1>Scan QR code</h1><p class="muted">Point your camera at the QR code on your teacher’s screen.</p>
        <div class="scanner"><video id="vid" playsinline muted></video></div><div class="btnrow"><button class="btn secondary big" data-act="scan-stop">Cancel</button></div></div>`);
      focusView('Scan'); return;
    }
    if (ci.mode === 'confirm') {
      const p = ci.preview, st = p.status;
      view(`<div class="stack"><h1>${p.already ? 'Already checked in' : 'Confirm check-in'}</h1>
        <section class="card"><dl class="kv"><dt>Class</dt><dd>${esc(p.class.subject)}</dd><dt>Section</dt><dd>${esc(p.class.section)}</dd><dt>Time</dt><dd>${fmt12(p.class.start)} – ${fmt12(p.class.end)}</dd>
          <dt>Student</dt><dd>${esc(p.student.name)} (${esc(p.student.school_id)})</dd><dt>${p.already ? 'Recorded as' : 'You’ll be marked'}</dt><dd>${chip(st, 'xl')}</dd></dl></section>
        ${p.already ? `<div class="alert info"><b>You’re all set.</b>You checked in at ${timeOf(p.checked_at)}. Nothing more to do.</div><a class="btn big" href="#/home">Back to home</a>` : `
        ${st === 'late' ? '<div class="alert warn"><b>The on-time window has passed.</b>This check-in will be recorded as Late.</div>' : ''}
        <div id="cierr"></div>
        <button class="btn big" data-act="ci-confirm">Confirm check-in</button>
        <button class="btn secondary big" data-act="ci-back">Not my class</button>`}</div>`);
      focusView('Confirm check-in'); return;
    }
    if (ci.mode === 'done') {
      const r = ci.result;
      view(`<div class="success stack" role="status"><div class="big-icon ${r.status}" aria-hidden="true">${r.status === 'present' ? '✓' : '◔'}</div>
        <h1>You’re marked ${STATUS[r.status][1]}</h1><p class="muted">${esc(r.subject)} · checked in at ${timeOf(r.checked_at)}</p>
        ${r.status === 'late' ? '<p class="small muted">You checked in after the on-time window.</p>' : ''}<a class="btn big" href="#/home">Done</a></div>`);
      focusView('Checked in'); return;
    }
    view(`<div class="stack"><div><h1>Check in</h1><p class="muted">Checking in as <b>${esc(u.name)}</b> (${esc(u.school_id)})</p></div>
      ${ci.err ? errBox(ci.err) : ''}
      ${scanOk() ? `<button class="btn big" data-act="scan-start">${ICON.qr.replace('<svg', '<svg width="26" height="26"')} Scan class QR code</button><div class="divider">or type the class code</div>`
        : '<div class="alert info small">Tip: scan the QR code with your phone’s camera app and it will open here, or type the code below.</div>'}
      <form class="card form" data-form="code" novalidate>
        <label class="field">Class code<input class="codeinput" type="text" name="code" id="codein" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7M-4PX" value="${esc(ci.code ? fmtCode(ci.code) : '')}" aria-describedby="codehint" ${scanOk() ? '' : 'autofocus'}>
          <span class="hint" id="codehint">6 letters or numbers, shown below the QR code on your teacher’s screen. <b id="codecount">${ci.code.length} of 6</b></span></label>
        <button class="btn big" id="codego" ${ci.code.length === 6 ? '' : 'disabled'}>Continue</button></form></div>`);
    focusView('Check in');
  }
  async function startScan() {
    ci.err = null;
    try {
      ci.mode = 'scanning'; renderCi();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = $('#vid'); v.srcObject = stream; await v.play();
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      timers.push(setInterval(async () => {
        try {
          const found = await det.detect(v);
          for (const f of found) { const c = extractCode(f.rawValue); if (c) { stopScan(); ci.method = 'qr'; ci.code = c; ci.mode = 'enter'; await ciPreview(); return; } }
        } catch { /* keep scanning */ }
      }, 300));
    } catch (e) {
      stopScan(); ci.mode = 'enter';
      ci.err = { message: e.name === 'NotAllowedError' ? 'Camera access was blocked.' : 'We couldn’t start the camera.', hint: 'You can type the class code instead.' };
      renderCi();
    }
  }

  /* ---------- teacher: dashboard ---------- */
  const windowText = (c) => ({
    early: `Starts at ${fmt12(c.start)}`, present: `On-time window open until ${fmt12(addMin(c.start, c.grace))}`,
    late: `Late window until ${fmt12(c.end)}`, closed: 'Class ended' }[c.window]);
  route('/t', 'teacher', async () => {
    shell('classes');
    const d = await api('/classes'); const todays = d.classes.filter((c) => c.meets_today), others = d.classes.filter((c) => !c.meets_today);
    const card = (c) => {
      const n = c.counts, tot = n ? Math.max(1, n.total) : 1;
      return `<article class="card" aria-labelledby="c${c.id}"><div class="pagehead"><div class="grow"><h2 id="c${c.id}">${esc(c.subject)}</h2>
        <p class="muted small">${esc(c.days_label)} · ${fmt12(c.start)}–${fmt12(c.end)} · ${plural(c.student_count, 'student')}</p></div>
        ${c.meets_today ? `<span class="chip chip-pending ${c.window === 'present' || c.window === 'late' ? 'live' : ''}">${esc(windowText(c))}</span>` : ''}</div>
        ${n ? `<div class="bar" style="margin:.8rem 0 .5rem" role="img" aria-label="${n.present} present, ${n.late} late, ${n.absent} absent, ${n.pending} not yet"><i class="p" style="width:${n.present / tot * 100}%"></i><i class="l" style="width:${n.late / tot * 100}%"></i><i class="a" style="width:${n.absent / tot * 100}%"></i></div>
          <div class="summary-line small"><b>${n.present}</b> present · <b>${n.late}</b> late · <b>${n.absent}</b> absent · <b>${n.pending}</b> not yet</div>` : ''}
        <p style="margin-top:.9rem"><a class="btn" href="#/t/class/${c.id}">Open class</a></p></article>`;
    };
    view(`<div class="stack"><div class="pagehead"><div class="grow"><h1>Instructor dashboard</h1><p class="muted">${esc(clockText())}</p></div><a class="btn" href="#/t/new">${ICON.plus.replace('<svg', '<svg width="20" height="20"')} New class</a></div>
      ${d.classes.length ? '' : '<div class="card"><h2>Create your first class</h2><p class="muted" style="margin:.4rem 0 1rem">Add a subject and schedule, register your students, then share a QR code.</p><a class="btn" href="#/t/new">Create class</a></div>'}
      ${todays.length ? `<h2>Today</h2>${todays.map(card).join('')}` : ''}${others.length ? `<h2>${todays.length ? 'Other classes' : 'Your classes'}</h2>${others.map(card).join('')}` : ''}</div>`);
    focusView('Dashboard');
  });

  route('/t/new', 'teacher', () => {
    shell('new');
    view(`<div class="stack"><a class="crumb" href="#/t">← Classes</a><h1>New class</h1>
      <form class="card form" data-form="newclass" novalidate>
        <label class="field">Subject<input type="text" name="subject" maxlength="60" placeholder="e.g. Human-Computer Interaction" required></label>
        <fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:600;margin-bottom:.3rem">Class days</legend><div class="days">${DAY_ORDER.map((d) => `<label><input type="checkbox" name="days" value="${d}" ${d >= 1 && d <= 5 ? 'checked' : ''}><span>${DAYS[d]}</span></label>`).join('')}</div></fieldset>
        <div class="grid2 eq"><label class="field">Start time<input type="time" name="start" value="08:00" required></label><label class="field">End time<input type="time" name="end" value="09:00" required></label></div>
        <label class="field">On-time window (minutes)<input type="number" name="grace" value="15" min="0" max="60" inputmode="numeric"><span class="hint" id="rule"></span></label>
        <div id="formerr" role="alert"></div>
        <button class="btn big">Create class</button></form></div>`);
    updateRule(); focusView('New class');
  });
  function updateRule() {
    const f = $('form[data-form=newclass]'); const r = $('#rule'); if (!f || !r) return;
    const s = f.start.value, e = f.end.value, g = Number(f.grace.value) || 0; if (!s || !e) { r.textContent = ''; return; }
    r.innerHTML = `Preview: <b>${fmt12(s)}–${fmt12(addMin(s, g))}</b> Present · <b>${fmt12(addMin(s, g + 1))}–${fmt12(e)}</b> Late · otherwise Absent.`;
  }

  /* ---------- teacher: class page ---------- */
  route('/t/class/:id', 'teacher', async (p, q) => {
    shell('classes');
    if (!state.config) state.config = await api('/config');
    cur = { id: p.id, date: null, fresh: q.get('new') === '1' };
    state.filter = 'all'; state.closed = new Set();
    await loadClass();
    timers.push(setInterval(async () => { if (cur && !dlg.open && cur.date === todayStr() && !document.hidden) { try { await refreshRoster(); } catch { /* ignore */ } } }, 5000));
  });
  async function loadClass() {
    const d = await api(`/classes/${cur.id}` + (cur.date ? `?date=${cur.date}` : '')); cur.data = d; cur.date = d.date;
    const c = d.class, url = `${state.config.base_url}/#/checkin/${c.code}`; cur.url = url;
    view(`<div class="stack"><a class="crumb" href="#/t">← Classes</a>
      <div><h1>${esc(c.subject)}</h1><p class="muted">${esc(c.days_label)} · ${fmt12(c.start)}–${fmt12(c.end)} · Present until ${fmt12(addMin(c.start, c.grace))}, then Late</p></div>
      ${cur.fresh ? '<div class="alert info"><b>Class created.</b>Register your students below, then share the QR code when class starts.</div>' : ''}
      <div class="grid2 qr"><section class="card" aria-labelledby="codeh"><h2 id="codeh">Check-in code</h2>
        <div class="qrbox" id="qrbox">${QR.toSvg(url, { label: `QR code for ${c.subject}` })}</div>
        <p class="codebig" style="margin-top:.7rem" aria-label="Code ${c.code.split('').join(' ')}">${fmtCode(c.code)}</p>
        <p class="small muted" style="text-align:center;margin:.3rem 0 .9rem">Students scan this or type the code.</p>
        <div class="btnrow"><button class="btn small" data-act="fullscreen">Show full screen</button><button class="btn small secondary" data-act="copy-code">Copy code</button><button class="btn small secondary" data-act="copy-link">Copy link</button><button class="btn small danger" data-act="regen">New code</button></div></section>
      <section class="card" aria-labelledby="atth"><div class="pagehead"><div class="grow"><h2 id="atth">Attendance</h2><p class="small muted" id="upd"></p></div>
        <label class="field"><span class="sr-only">Date</span><input type="date" id="datepick" value="${d.date}" max="${todayStr()}" aria-label="Attendance date"></label></div>
        <div id="attbody"></div></section></div>
      <section class="card" aria-labelledby="regh"><details ${d.counts.total === 0 || cur.fresh ? 'open' : ''}><summary id="regh" style="font-weight:700;min-height:44px;cursor:pointer;display:flex;align-items:center">Register or remove students (${d.counts.total})</summary>
        <form class="form" data-form="students" style="margin-top:.8rem" novalidate>
          <label class="field">Students <span class="hint">One per line: ID, Full name, Section — e.g. 2024-011, Maria Cruz, A</span><textarea name="text" spellcheck="false" placeholder="2024-011, Maria Cruz, A&#10;2024-012, Leo Tan, B"></textarea></label>
          <label class="field" style="max-width:14rem">Default section<span class="hint">Used when a line has no section</span><input type="text" name="section" value="A" maxlength="20"></label>
          <div id="studerr" role="alert"></div>
          <div class="btnrow"><button class="btn">Add students</button><button class="btn secondary" type="button" data-act="example">Use example</button></div>
          <p class="small muted">New students sign in with their Student ID as their first password.</p></form>
        <div id="studlist"></div></details></section></div>`);
    renderAtt(); focusView(c.subject);
  }
  function renderAtt() {
    const d = cur.data, n = d.counts, tot = Math.max(1, n.total), isToday = d.date === todayStr();
    const f = state.filter;
    const filt = (s) => f === 'all' || s.status === f;
    const sections = d.sections.map((sec) => ({ ...sec, shown: sec.students.filter(filt) }));
    $('#attbody').innerHTML = `
      <div class="stats" style="margin-top:.6rem"><div class="stat"><b>${n.present}</b><span>Present</span></div><div class="stat"><b>${n.late}</b><span>Late</span></div><div class="stat"><b>${n.absent}</b><span>Absent</span></div><div class="stat"><b>${n.pending}</b><span>Not yet</span></div></div>
      <div class="bar" style="margin:.8rem 0" role="img" aria-label="${n.present} present, ${n.late} late, ${n.absent} absent, ${n.pending} not yet"><i class="p" style="width:${n.present / tot * 100}%"></i><i class="l" style="width:${n.late / tot * 100}%"></i><i class="a" style="width:${n.absent / tot * 100}%"></i></div>
      ${isToday ? '' : `<div class="alert info small"><b>Viewing ${esc(fmtDate(d.date))}.</b>Changes you make here edit past attendance.</div>`}
      <div class="filters" role="group" aria-label="Filter students" style="margin:.8rem 0">${[['all', 'All'], ['pending', 'Not yet'], ['late', 'Late'], ['absent', 'Absent']].map(([k, l]) => `<button type="button" data-act="filter" data-k="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
      ${n.total === 0 ? '<p class="muted">No students yet. Register your students below.</p>' : ''}
      ${sections.map((sec) => { const sn = sec.students.reduce((a, s) => (a[s.status]++, a), { present: 0, late: 0, absent: 0, pending: 0 });
        return `<details class="sec" data-sec="${esc(sec.section)}" ${state.closed.has(sec.section) ? '' : 'open'}><summary>Section ${esc(sec.section)} <span class="small muted">${sn.present} present · ${sn.late} late · ${sn.absent} absent · ${sn.pending} not yet</span></summary>
          ${sec.shown.length ? sec.shown.map((s) => `<button type="button" class="rowbtn" data-act="mark" data-sid="${s.student_id}" data-name="${esc(s.name)}" data-status="${s.status}" aria-label="${esc(s.name)}, ${STATUS[s.status][1]}. Change status">
            <span class="grow"><b>${esc(s.name)}</b><span class="small muted" style="display:block">${esc(s.school_id)}${s.checked_at ? ' · ' + timeOf(s.checked_at) : ''}${s.method === 'teacher' ? ' · edited by you' : ''}</span></span>${chip(s.status)}</button>`).join('') : '<p class="small muted" style="padding:.5rem 0">No students match this filter.</p>'}</details>`; }).join('')}`;
    const u = $('#upd'); if (u) u.textContent = isToday ? `Live · updated ${serverNow().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : '';
    renderStudList();
  }
  function renderStudList() {
    const el = $('#studlist'); if (!el) return;
    const all = cur.data.sections.flatMap((s) => s.students.map((x) => ({ ...x, section: s.section })));
    el.innerHTML = all.length ? `<h3 style="margin:1.2rem 0 .2rem">Registered students</h3><ul class="list">${all.map((s) => `<li><div class="grow"><b>${esc(s.name)}</b><div class="small muted">${esc(s.school_id)} · Section ${esc(s.section)}</div></div><button class="btn small danger" data-act="remove" data-sid="${s.student_id}" data-name="${esc(s.name)}" aria-label="Remove ${esc(s.name)}">Remove</button></li>`).join('')}</ul>` : '';
  }
  async function refreshRoster() {
    const d = await api(`/classes/${cur.id}?date=${cur.date}`); cur.data = d; if ($('#attbody')) renderAtt();
  }

  /* ---------- teacher: reports ---------- */
  const ERR = { bad_code: 'Mistyped code', unknown_code: 'Code not found', not_enrolled: 'Not registered in class', too_early: 'Checked in too early', closed: 'Checked in after class', not_today: 'Wrong day' };
  route('/t/reports', 'teacher', async () => reportPage(null));
  route('/t/reports/:id', 'teacher', async (p) => reportPage(p.id));
  async function reportPage(id) {
    shell('reports');
    const list = await api('/classes');
    if (!list.classes.length) { view('<div class="stack"><h1>Reports</h1><div class="card"><p class="muted">Create a class to see attendance reports.</p></div></div>'); focusView('Reports'); return; }
    if (!id) id = list.classes[0].id;
    const [r, m] = await Promise.all([api(`/classes/${id}/report`), api('/metrics')]);
    const t = r.totals; const sections = [...new Set(r.students.map((s) => s.section))];
    cur = { rep: r, id };
    const body = (sec) => {
      const rows = r.students.filter((s) => !sec || s.section === sec).sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || a.name.localeCompare(b.name));
      return `<div class="tablewrap"><table><caption class="sr-only">Attendance per student, lowest attendance first</caption><thead><tr><th scope="col">Student</th><th scope="col">Sec</th><th class="num" scope="col">P</th><th class="num" scope="col">L</th><th class="num" scope="col">A</th><th scope="col">Rate</th></tr></thead><tbody>
        ${rows.map((s) => `<tr><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.school_id)}</div></td><td>${esc(s.section)}</td><td class="num">${s.present}</td><td class="num">${s.late}</td><td class="num">${s.absent}</td>
          <td>${s.rate == null ? '–' : `<span class="meter" aria-hidden="true"><i style="width:${s.rate}%"></i></span>${s.rate}%${s.rate < 75 ? ' <span class="chip chip-absent">At risk</span>' : ''}`}</td></tr>`).join('')}</tbody></table></div>`;
    };
    view(`<div class="stack"><div class="pagehead"><h1 class="grow">Reports</h1>
      <label class="field" style="min-width:12rem"><span class="sr-only">Class</span><select data-change="report-class" aria-label="Choose class">${list.classes.map((c) => `<option value="${c.id}" ${String(c.id) === String(id) ? 'selected' : ''}>${esc(c.subject)}</option>`).join('')}</select></label></div>
      <div class="stats"><div class="stat"><b>${t.sessions}</b><span>Class sessions</span></div><div class="stat"><b>${t.rate == null ? '–' : t.rate + '%'}</b><span>Attendance rate</span></div><div class="stat"><b>${t.late}</b><span>Late check-ins</span></div><div class="stat"><b>${t.absent}</b><span>Absences</span></div></div>
      <section class="card" aria-labelledby="rs"><div class="pagehead"><h2 id="rs" class="grow">By student</h2>
        ${sections.length > 1 ? `<label class="field"><span class="sr-only">Section</span><select data-change="report-section" aria-label="Filter by section"><option value="">All sections</option>${sections.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>` : ''}
        <a class="btn small secondary" href="/api/classes/${id}/report.csv" download>Download CSV</a><button class="btn small secondary" data-act="print">Print</button></div>
        <div id="repbody">${body('')}</div></section>
      <section class="card" aria-labelledby="rd"><h2 id="rd">By date</h2><div class="tablewrap"><table><thead><tr><th scope="col">Date</th><th class="num" scope="col">Present</th><th class="num" scope="col">Late</th><th class="num" scope="col">Absent</th></tr></thead><tbody>
        ${r.by_date.slice(0, 30).map((d) => `<tr><td>${esc(fmtDate(d.date))}</td><td class="num">${d.present}</td><td class="num">${d.late}</td><td class="num">${d.absent}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No sessions yet.</td></tr>'}</tbody></table></div></section>
      <section class="card" aria-labelledby="um"><h2 id="um">Usability metrics</h2><p class="small muted" style="margin:.3rem 0 .8rem">Collected from real check-ins in this prototype — use them in your HCI evaluation (task completion, time on task, error rate).</p>
        <div class="stats"><div class="stat"><b>${m.success_rate == null ? '–' : m.success_rate + '%'}</b><span>Check-in success rate</span></div><div class="stat"><b>${m.median_seconds == null ? '–' : m.median_seconds + 's'}</b><span>Median time to check in</span></div><div class="stat"><b>${m.errors}</b><span>Student errors</span></div><div class="stat"><b>${m.teacher_corrections}</b><span>Teacher corrections (of ${m.records} records)</span></div></div>
        ${m.errors_by_code.length ? `<ul class="list" style="margin-top:.6rem">${m.errors_by_code.map((e) => `<li><span class="grow">${esc(ERR[e.code] || e.code)}</span><b>${e.n}</b></li>`).join('')}</ul>` : '<p class="small muted" style="margin-top:.6rem">No student errors recorded yet.</p>'}</section></div>`);
    actions['report-section'] = (el) => { $('#repbody').innerHTML = body(el.value); };
    focusView('Reports');
  }

  /* ---------- event delegation ---------- */
  const actions = {
    logout: async () => { try { await api('/logout', { method: 'POST', body: {} }); } catch { /* ignore */ } state.user = null; location.hash = '#/login'; navigate(); },
    textsize: (b) => { const on = document.documentElement.classList.toggle('big-text'); b.setAttribute('aria-pressed', on); try { localStorage.setItem('bigtext', on ? '1' : ''); } catch { /* ignore */ } },
    retry: () => navigate(),
    showpw: (el) => { $('input[name=password]').type = el.checked ? 'text' : 'password'; },
    'clock-reset': async () => { await api('/demo-clock', { method: 'POST', body: { reset: true } }); toast('Using real time again.'); navigate(); },
    'scan-start': () => startScan(),
    'scan-stop': () => { stopScan(); ci.mode = 'enter'; renderCi(); },
    'ci-back': () => { ci.mode = 'enter'; ci.code = ''; ci.method = 'code'; ci.started = Date.now(); renderCi(); },
    'ci-confirm': async (b) => {
      b.disabled = true; b.textContent = 'Checking in…';
      try { ci.result = await api('/checkin', { method: 'POST', body: { code: ci.code, method: ci.method, duration_ms: Date.now() - ci.started } }); ci.mode = 'done'; renderCi(); }
      catch (e) { b.disabled = false; b.textContent = 'Confirm check-in'; $('#cierr').innerHTML = errBox(e); }
    },
    fullscreen: () => { const c = cur.data.class; openDlg(`<form method="dialog" style="display:grid;gap:1rem;justify-items:center;width:100%"><h2 id="dlg-title" style="font-size:2rem">${esc(c.subject)}</h2><div class="qrbox">${QR.toSvg(cur.url)}</div><p class="codebig" style="font-size:3rem">${fmtCode(c.code)}</p><p class="muted">Scan the QR code or type the code in the app</p><button class="btn secondary" autofocus>Close</button></form>`, 'full'); },
    'copy-code': async () => { await copy(fmtCode(cur.data.class.code)); toast('Code copied'); },
    'copy-link': async () => { await copy(cur.url); toast('Link copied'); },
    regen: async () => {
      if (!(await confirmDlg({ title: 'Create a new code?', body: 'The current QR code and class code will stop working right away. Students who already checked in are not affected.', ok: 'Create new code', danger: true }))) return;
      await api(`/classes/${cur.id}/regenerate-code`, { method: 'POST', body: {} }); toast('New code created'); await loadClass();
    },
    filter: (b) => { state.filter = b.dataset.k; renderAtt(); },
    mark: (b) => {
      const { sid, name, status } = b.dataset;
      openDlg(`<h2 id="dlg-title">Mark ${esc(name)}</h2><p class="muted" style="margin-bottom:.9rem">Currently <b>${STATUS[status][1]}</b> · ${esc(fmtDate(cur.data.date))}</p>
        <div class="seg">${['present', 'late', 'absent'].map((s) => `<button type="button" class="btn ${s === status ? '' : 'secondary'}" data-act="mark-set" data-sid="${sid}" data-name="${esc(name)}" data-status="${s}" ${s === status ? 'aria-pressed="true"' : ''}>${STATUS[s][0]} ${STATUS[s][1]}</button>`).join('')}</div>
        <form method="dialog" class="btnrow"><button type="button" class="btn small secondary" data-act="mark-set" data-sid="${sid}" data-name="${esc(name)}" data-status="clear">Clear record</button><button class="btn small secondary" autofocus>Cancel</button></form>`);
    },
    'mark-set': async (b) => {
      closeDlg(); const { sid, name, status } = b.dataset;
      try {
        const r = await api(`/classes/${cur.id}/attendance`, { method: 'PUT', body: { student_id: Number(sid), status, date: cur.date } });
        await refreshRoster();
        toast(status === 'clear' ? `Cleared record for ${name}` : `Marked ${name} ${STATUS[status][1]}`, { action: { label: 'Undo', fn: async () => { try { await api(`/classes/${cur.id}/attendance`, { method: 'PUT', body: { student_id: Number(sid), status: r.previous, date: cur.date } }); await refreshRoster(); toast('Change undone'); } catch (e) { toast(e.message); } } } });
      } catch (e) { toast(e.message); }
    },
    example: () => { const f = $('form[data-form=students]'); f.text.value = '2024-011, Maria Cruz, A\n2024-012, Leo Tan, B\n2024-013, Grace Lim, B'; f.text.focus(); },
    remove: async (b) => {
      if (!(await confirmDlg({ title: `Remove ${b.dataset.name}?`, body: 'They will no longer be able to check in to this class. Past attendance records are kept.', ok: 'Remove', danger: true }))) return;
      await api(`/classes/${cur.id}/students/${b.dataset.sid}`, { method: 'DELETE', body: {} }); toast(`Removed ${b.dataset.name}`); await loadClass();
    },
    print: () => window.print(),
    'hist-class': null, 'report-section': null,
    'report-class': (el) => { location.hash = `#/t/reports/${el.value}`; },
  };
  async function copy(t) { try { await navigator.clipboard.writeText(t); } catch { const i = document.createElement('input'); i.value = t; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); } }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || !actions[b.dataset.act]) return;
    if (b.tagName === 'INPUT' && b.type === 'checkbox') return actions[b.dataset.act](b);
    if (b.tagName === 'A' || b.tagName === 'BUTTON') { const r = actions[b.dataset.act](b, e); if (r && r.catch) r.catch((err) => toast(err.message)); }
  });
  document.addEventListener('change', (e) => {
    const a = e.target.dataset?.act; if (a === 'showpw') return actions.showpw(e.target);
    const c = e.target.dataset?.change; if (c && actions[c]) actions[c](e.target);
    if (e.target.id === 'datepick') { cur.date = e.target.value || todayStr(); loadClass().catch((err) => toast(err.message)); }
    if (e.target.closest('form[data-form=newclass]')) updateRule();
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'codein') {
      const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); ci.code = raw;
      e.target.value = raw.length > 3 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
      $('#codecount').textContent = `${raw.length} of 6`; $('#codego').disabled = raw.length !== 6;
    }
    if (e.target.closest('form[data-form=newclass]')) updateRule();
  });
  document.addEventListener('toggle', (e) => { const s = e.target.dataset?.sec; if (s !== undefined) { if (e.target.open) state.closed.delete(s); else state.closed.add(s); } }, true);
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]'); if (!form) return; e.preventDefault();
    const kind = form.dataset.form, btn = form.querySelector('button:not([type=button])');
    const busy = (on, label) => {
      if (!btn) return;
      btn.disabled = on;
      if (on) { btn.dataset.l = btn.textContent; if (label) btn.textContent = label; }
      else if (btn.dataset.l) btn.textContent = btn.dataset.l;
    };
    try {
      if (kind === 'login') {
        busy(true, 'Signing in…');
        try {
          const r = await api('/login', { method: 'POST', body: { id: form.elements.id.value.trim(), password: form.elements.password.value } });
          state.user = r.user; const next = sessionStorage.getItem('pending'); sessionStorage.removeItem('pending');
          const ok = next && !next.includes('/login') && ((r.user.role === 'student' && !next.startsWith('#/t')) || (r.user.role === 'teacher' && next.startsWith('#/t')));
          location.hash = ok ? next : (r.user.role === 'teacher' ? '#/t' : '#/home');
        } catch (err) { $('#loginerr').innerHTML = errBox(err); form.password.value = ''; form.password.focus(); }
        busy(false);
      } else if (kind === 'code') {
        if (ci.code.length === 6) { ci.method = 'code'; await ciPreview(); }
      } else if (kind === 'clock') {
        await api('/demo-clock', { method: 'POST', body: { datetime: form.dt.value } }); toast('Demo clock set'); navigate();
      } else if (kind === 'newclass') {
        busy(true, 'Creating…');
        try {
          const f = form, days = [...f.querySelectorAll('input[name=days]:checked')].map((i) => Number(i.value));
          const r = await api('/classes', { method: 'POST', body: { subject: f.subject.value, days, start: f.start.value, end: f.end.value, grace: Number(f.grace.value) } });
          location.hash = `#/t/class/${r.id}?new=1`;
        } catch (err) { $('#formerr').innerHTML = errBox(err); busy(false); }
      } else if (kind === 'students') {
        busy(true, 'Adding…');
        try {
          const r = await api(`/classes/${cur.id}/students`, { method: 'POST', body: { text: form.text.value, section: form.section.value } });
          cur.fresh = false; const keep = r.errors; await loadClass();
          const box = $('#studerr'), det = $('#regh').closest('details'); det.open = true;
          box.innerHTML = `<div class="alert ${keep.length ? 'warn' : 'info'}"><b>${r.added} added${r.updated ? `, ${r.updated} updated` : ''}${keep.length ? `, ${keep.length} need attention` : ''}.</b>${keep.map((x) => `<div class="small">Line ${x.line}: ${esc(x.message)}</div>`).join('')}</div>`;
          if (keep.length) $('form[data-form=students]').text.value = keep.map((x) => x.text).join('\n');
          toast(`${plural(r.added + r.updated, 'student')} saved`);
        } catch (err) { $('#studerr').innerHTML = errBox(err); busy(false); }
      }
    } catch (err) { toast(err.message); busy(false); }
  });

  try { if (localStorage.getItem('bigtext')) document.documentElement.classList.add('big-text'); } catch { /* ignore */ }
  window.addEventListener('hashchange', navigate);
  navigate();
})();
