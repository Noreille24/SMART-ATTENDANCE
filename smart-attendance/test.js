'use strict';
// API tests: node test.js   (starts its own server on a temporary database)
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'att-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
const { server } = require('./server.js');
const assert = require('node:assert/strict');

let fails = 0, passes = 0;
const t = async (name, fn) => { try { await fn(); passes++; console.log('  ok  ', name); } catch (e) { fails++; console.log('  FAIL', name, '\n       ', e.message); } };

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, p, body) => {
      const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
    };
  };
  const teacher = client(), student = client(), student2 = client();
  // pick a Monday so the weekday class meets
  const setClock = (hhmm, date = '2026-11-09') => teacher('POST', '/api/demo-clock', { datetime: `${date}T${hhmm}` });
  console.log('\nSmart Attendance API tests');

  await t('login rejects wrong password with a helpful message', async () => {
    const r = await client()('POST', '/api/login', { id: 'teacher1', password: 'nope' });
    assert.equal(r.status, 401); assert.match(r.body.error.hint, /try again/i);
  });
  await t('teacher and students can log in', async () => {
    assert.equal((await teacher('POST', '/api/login', { id: 'teacher1', password: 'teacher123' })).status, 200);
    assert.equal((await student('POST', '/api/login', { id: '2024-001', password: '2024-001' })).status, 200);
    assert.equal((await student2('POST', '/api/login', { id: '2024-006', password: '2024-006' })).status, 200);
  });
  await t('students cannot use teacher endpoints', async () => assert.equal((await student('GET', '/api/classes')).status, 403));
  await t('unauthenticated requests are rejected', async () => assert.equal((await client()('GET', '/api/student/home')).status, 401));

  await t('before class starts: cannot check in (too_early), nothing recorded', async () => {
    await setClock('14:30');
    const r = await student('POST', '/api/checkin', { code: 'K7M-4PX' });
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'too_early');
  });
  await t('wrong code gives an actionable error', async () => {
    const r = await student('POST', '/api/checkin/preview', { code: 'ZZZZZZ' });
    assert.equal(r.status, 404); assert.equal(r.body.error.code, 'unknown_code');
    assert.equal((await student('POST', '/api/checkin/preview', { code: 'AB' })).body.error.code, 'bad_code');
  });
  await t('start..start+15 min = Present (preview then confirm, code with hyphen/lowercase works)', async () => {
    await setClock('15:15');
    const p = await student('POST', '/api/checkin/preview', { code: 'k7m-4px' });
    assert.equal(p.body.status, 'present'); assert.equal(p.body.class.subject, 'HCI');
    const r = await student('POST', '/api/checkin', { code: 'K7M4PX', method: 'qr', duration_ms: 4200 });
    assert.equal(r.body.status, 'present');
  });
  await t('checking in twice is harmless (idempotent)', async () => {
    const r = await student('POST', '/api/checkin', { code: 'K7M4PX' });
    assert.equal(r.status, 200); assert.equal(r.body.already, true); assert.equal(r.body.status, 'present');
  });
  await t('start+16 min .. end = Late', async () => {
    await setClock('15:16');
    const r = await student2('POST', '/api/checkin', { code: 'K7M4PX', method: 'code', duration_ms: 9000 });
    assert.equal(r.body.status, 'late');
  });
  await t('after class end: cannot check in (closed)', async () => {
    await setClock('16:01');
    await client()('POST', '/api/login', {});
    const s3 = client(); await s3('POST', '/api/login', { id: '2024-003', password: '2024-003' });
    const r = await s3('POST', '/api/checkin', { code: 'K7M4PX' });
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'closed');
  });
  await t('weekend: class does not meet today', async () => {
    await setClock('15:05', '2026-11-08');
    const s4 = client(); await s4('POST', '/api/login', { id: '2024-004', password: '2024-004' });
    assert.equal((await s4('POST', '/api/checkin', { code: 'K7M4PX' })).body.error.code, 'not_today');
  });
  await t('student not enrolled in a class is told so', async () => {
    await setClock('15:05');
    await teacher('POST', '/api/classes/1/students', { text: '' }).catch(() => {});
    const nu = await teacher('POST', '/api/classes', { subject: 'Ethics', days: [1], start: '15:00', end: '16:00', grace: 15 });
    const cls = (await teacher('GET', '/api/classes')).body.classes.find((c) => c.subject === 'Ethics');
    const s5 = client(); await s5('POST', '/api/login', { id: '2024-005', password: '2024-005' });
    assert.equal((await s5('POST', '/api/checkin', { code: cls.code })).body.error.code, 'not_enrolled');
    assert.ok(nu.body.id);
  });

  await t('roster groups by section with correct statuses', async () => {
    await setClock('16:01');
    const r = await teacher('GET', '/api/classes/1');
    assert.equal(r.body.sections.length, 2);
    const all = r.body.sections.flatMap((s) => s.students);
    assert.equal(all.find((s) => s.school_id === '2024-001').status, 'present');
    assert.equal(all.find((s) => s.school_id === '2024-006').status, 'late');
    assert.equal(all.find((s) => s.school_id === '2024-003').status, 'absent'); // class ended, no scan = absent
  });
  await t('teacher can correct a status and undo it', async () => {
    const sid = (await teacher('GET', '/api/classes/1')).body.sections[0].students.find((s) => s.school_id === '2024-003').student_id;
    const a = await teacher('PUT', '/api/classes/1/attendance', { student_id: sid, status: 'present' });
    assert.equal(a.body.previous, 'clear');
    let row = (await teacher('GET', '/api/classes/1')).body.sections[0].students.find((s) => s.student_id === sid);
    assert.equal(row.status, 'present'); assert.equal(row.method, 'teacher');
    await teacher('PUT', '/api/classes/1/attendance', { student_id: sid, status: a.body.previous });
    row = (await teacher('GET', '/api/classes/1')).body.sections[0].students.find((s) => s.student_id === sid);
    assert.equal(row.status, 'absent');
  });
  await t('students cannot be edited into the future', async () => {
    const r = await teacher('PUT', '/api/classes/1/attendance', { student_id: 1, status: 'present', date: '2030-01-01' });
    assert.equal(r.status, 400);
  });
  await t('bulk register: adds valid lines, reports bad ones, new students can log in', async () => {
    const r = await teacher('POST', '/api/classes/1/students', { text: '2024-050, Test Person, C\nbad line\n2024-051, X', section: 'D' });
    assert.equal(r.body.added, 1); assert.equal(r.body.errors.length, 2); // "bad line" and a 1-letter name are rejected
    const s = client(); assert.equal((await s('POST', '/api/login', { id: '2024-050', password: '2024-050' })).status, 200);
  });
  await t('student history & home reflect records', async () => {
    const h = await student('GET', '/api/student/history');
    assert.ok(h.body.summary.total > 5); assert.ok(h.body.items.some((i) => i.status === 'present'));
    const home = await student('GET', '/api/student/home');
    assert.equal(home.body.classes.find((c) => c.subject === 'HCI').status, 'present');
  });
  await t('report totals + CSV', async () => {
    const r = await teacher('GET', '/api/classes/1/report');
    assert.ok(r.body.students.length >= 10); assert.ok(r.body.totals.rate > 0);
    const csv = await teacher('GET', '/api/classes/1/report.csv');
    assert.equal(csv.status, 200); assert.match(csv.body, /Student ID,Name,Section/);
  });
  await t('usability metrics count successes and errors', async () => {
    const m = (await teacher('GET', '/api/metrics')).body;
    assert.ok(m.checkins_ok >= 2); assert.ok(m.errors >= 3); assert.ok(m.success_rate > 0 && m.success_rate < 100);
  });
  await t('regenerating the code invalidates the old one', async () => {
    const r = await teacher('POST', '/api/classes/1/regenerate-code', {});
    assert.notEqual(r.body.code, 'K7M4PX');
    assert.equal((await student('POST', '/api/checkin/preview', { code: 'K7M4PX' })).body.error.code, 'unknown_code');
  });
  await t('class creation validates input', async () => {
    assert.equal((await teacher('POST', '/api/classes', { subject: 'X', days: [1], start: '09:00', end: '08:00', grace: 15 })).status, 400);
    assert.equal((await teacher('POST', '/api/classes', { subject: 'Math', days: [], start: '08:00', end: '09:00', grace: 15 })).status, 400);
  });
  await t('teachers cannot open other teachers’ classes', async () => assert.equal((await teacher('GET', '/api/classes/2')).status, 404));
  await t('static app is served with security headers', async () => {
    const r = await fetch(base + '/'); assert.equal(r.status, 200); assert.ok(r.headers.get('content-security-policy'));
  });

  console.log(`\n${passes} passed, ${fails} failed\n`);
  server.close(); fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
});
