'use strict';
/* Travellers 1969 — private access for Claude (v5, 23 Nov 2026)
   One HTTPS function, protected by a long secret key (functions/.env → CLAUDE_KEY=…, never in GitHub).
   Read: only trips, locations, the public follower pages, stop codes, hotel notes and its own log
   (not the followers' email addresses, not the settings/keys in config).
   Write: only inside trips (trip / segment / stop documents and stop dates). Never deletes a document.
   v2: a place in the places list can be moved to the bin (collection locationsTrash) and put back again
   — the full place is kept there, nothing is lost.
   v4: one person's score can be removed from places of one region (op clearScore, only that score, other scores stay, old scores written to claudeLog) and put back (op setScores).
   v5: op setEpisodes writes the list of long YouTube episodes of ONE trip into the public document public/episodes (the follower site shows them). Only that document, only https YouTube links.
   Before the first change (and then at most every 30 minutes) a backup of the whole trip is saved in
   trips/<trip>/backups — the planner shows it under ⋯ More → Backups. Every change is written to claudeLog. */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');

const READ_OK = /^(trips|locations|locationsTrash|public|socialCodes|hotelNotes|claudeLog)(\/|$)/;
const WRITE_OK = /^trips\/[^/]+(\/segments\/[^/]+(\/stops\/[^/]+)?)?$/;
const DMY = /^(\d{2}\/\d{2}\/\d{4})?$/, HM = /^(\d{1,2}:\d{2})?$/;

function keyOk(k) {
  const want = process.env.CLAUDE_KEY || '';
  if (want.length < 24 || typeof k !== 'string' || !k) return false;
  const a = crypto.createHash('sha256').update(k).digest(), b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}
function cleanPath(p) {
  p = String(p || '').replace(/^\/+|\/+$/g, '');
  if (!p || /\.\.|\/\/|[\u0000-\u001f]/.test(p)) throw new Error('bad path');
  return p;
}
function plain(v) {
  if (v === null || v === undefined) return v === undefined ? null : v;
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') {
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (typeof v.path === 'string' && typeof v.id === 'string' && typeof v.get === 'function') return v.path;
    const o = {}; Object.keys(v).forEach(k => { o[k] = plain(v[k]); }); return o;
  }
  return v;
}
/* rd(ref) reads a document or a collection — now, or as it was at an earlier moment */
async function dumpTrip(db, trip, rd) {
  const tref = db.collection('trips').doc(trip), t = await rd(tref);
  if (!t.exists) throw new Error('trip not found: ' + trip);
  const segs = (await rd(tref.collection('segments'))).docs.map(d => ({ id: d.id, ref: d.ref, d: d.data() || {} }))
    .sort((a, b) => (a.d.order || 0) - (b.d.order || 0));
  const out = { trip: Object.assign({ id: t.id }, plain(t.data())), segments: [] };
  for (const s of segs) {
    const stops = (await rd(s.ref.collection('stops'))).docs.map(d => Object.assign({ id: d.id }, plain(d.data())))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    out.segments.push(Object.assign({ id: s.id }, plain(s.d), { stops }));
  }
  return out;
}
async function atTime(db, at, fn) {
  if (!at) return fn(ref => ref.get());
  const ms = Date.parse(at); if (isNaN(ms)) throw new Error('bad time: ' + at);
  return db.runTransaction(tx => fn(ref => tx.get(ref)), { readOnly: true, readTime: admin.firestore.Timestamp.fromMillis(ms) });
}
async function backup(db, trip, reason) {
  const d = await dumpTrip(db, trip, r => r.get());
  const at = new Date().toISOString(), id = at.replace(/[^0-9]/g, '').slice(0, 14);
  const mk = slim => d.segments.map(s => ({ id: s.id, name: s.name || '', customLabel: s.customLabel || '', order: s.order || 0, color: s.color || '',
    stopDates: s.stopDates || {}, stops: s.stops.map(x => { if (!slim) return x; const y = Object.assign({}, x); delete y.autoPostsJson; delete y.postsJson; return y; }) }));
  let segs = mk(false), json = JSON.stringify({ trip, at, reason, segments: segs });
  if (json.length > 900000) { segs = mk(true); json = JSON.stringify({ trip, at, reason: reason + ' (without post links: too big)', segments: segs }); }
  if (json.length > 1000000) throw new Error('trip too big for one backup document');
  const n = segs.reduce((a, s) => a + s.stops.length, 0);
  await db.doc('trips/' + trip + '/backups/' + id).set({ json, reason, at, stops: n });
  return { id, stops: n, at };
}
async function autoBackup(db, trip) {
  const last = await db.collection('trips/' + trip + '/backups').orderBy('at', 'desc').limit(1).get();
  if (!last.empty) { const b = last.docs[0].data() || {}; if (Date.now() - Date.parse(b.at || 0) < 30 * 60000) return { id: last.docs[0].id, reused: true }; }
  return backup(db, trip, 'auto: before a change by Claude');
}
async function log(db, entry) {
  try { await db.collection('claudeLog').add(Object.assign({ at: new Date().toISOString() }, entry)); } catch (e) { console.error('claudeLog', e); }
}

async function handle(db, b) {
  const op = String(b.op || '');
  switch (op) {
    case 'ping': return { ok: true, time: new Date().toISOString(), v: 5 };
    case 'trips': {
      const docs = (await db.collection('trips').get()).docs;
      return { trips: docs.map(d => { const x = d.data() || {}; return { id: d.id, name: x.name || '', code: x.code || '', archived: !!x.archived, publicOn: !!x.publicOn, publicSlug: x.publicSlug || '' }; }) };
    }
    case 'dump': {
      const trip = cleanPath(b.trip);
      return atTime(db, b.at, rd => dumpTrip(db, trip, rd));
    }
    case 'get': {
      const p = cleanPath(b.path); if (!READ_OK.test(p)) throw new Error('not readable');
      if (p.split('/').length % 2) throw new Error('that is a collection — use op list');
      return atTime(db, b.at, async rd => { const d = await rd(db.doc(p)); return { path: p, exists: d.exists, data: d.exists ? plain(d.data()) : null }; });
    }
    case 'list': {
      const p = cleanPath(b.path); if (!READ_OK.test(p)) throw new Error('not readable');
      if (!(p.split('/').length % 2)) throw new Error('that is a document — use op get');
      const lim = Math.min(Math.max(parseInt(b.limit, 10) || 300, 1), 1000);
      return atTime(db, b.at, async rd => { const q = await rd(db.collection(p).limit(lim)); return { path: p, docs: q.docs.map(d => ({ id: d.id, data: b.idsOnly ? undefined : plain(d.data()) })) }; });
    }
    case 'backup': {
      const trip = cleanPath(b.trip); const r = await backup(db, trip, String(b.reason || 'by Claude').slice(0, 200));
      await log(db, { op, trip, backup: r.id }); return { ok: true, backup: r };
    }
    case 'patch': {
      const p = cleanPath(b.path);
      if (!WRITE_OK.test(p)) throw new Error('writing is only allowed in trips: a trip, segment or stop document');
      const f = b.fields; if (!f || typeof f !== 'object' || Array.isArray(f) || !Object.keys(f).length) throw new Error('fields missing');
      if ('stopDates' in f) throw new Error('dates go through op setDates');
      Object.keys(f).forEach(k => { const v = f[k]; if (v !== null && typeof v === 'object') throw new Error('field ' + k + ': only text, numbers, true/false or null'); });
      const ref = db.doc(p), cur = await ref.get();
      if (!cur.exists && !b.create) throw new Error('document does not exist: ' + p + ' (send create:true to make a new one)');
      const trip = p.split('/')[1], bk = await autoBackup(db, trip), before = {}, old = cur.data() || {};
      Object.keys(f).forEach(k => { before[k] = plain(old[k]); });
      await ref.set(f, { merge: true });
      await log(db, { op, path: p, before: JSON.stringify(before).slice(0, 4000), after: JSON.stringify(f).slice(0, 4000), backup: bk.id });
      return { ok: true, path: p, before, backup: bk.id };
    }
    case 'setDates': {
      const trip = cleanPath(b.trip), seg = cleanPath(b.seg), dates = b.dates || {}, clear = Array.isArray(b.clear) ? b.clear.map(String) : [];
      if (/\//.test(trip) || /\//.test(seg)) throw new Error('bad trip or segment id');
      if (!Object.keys(dates).length && !clear.length) throw new Error('nothing to change');
      const ref = db.doc('trips/' + trip + '/segments/' + seg), cur = await ref.get();
      if (!cur.exists) throw new Error('segment not found');
      const ids = {}; (await ref.collection('stops').get()).docs.forEach(d => { ids[d.id] = 1; });
      const clean = {};
      Object.keys(dates).forEach(id => {
        if (!ids[id]) throw new Error('stop ' + id + ' is not in segment ' + seg);
        const d = dates[id]; if (!d || typeof d !== 'object') throw new Error('dates of ' + id + ' missing');
        const o = {};
        ['arrivalDate', 'departureDate'].forEach(k => { if (k in d) { if (!DMY.test(String(d[k]))) throw new Error(k + ' must be DD/MM/YYYY'); o[k] = String(d[k]); } });
        ['arrivalTime', 'departureTime'].forEach(k => { if (k in d) { if (!HM.test(String(d[k]))) throw new Error(k + ' must be HH:MM'); o[k] = String(d[k]); } });
        if ('syncCalendar' in d) o.syncCalendar = !!d.syncCalendar;
        if (!Object.keys(o).length) throw new Error('no date fields for ' + id);
        clean[id] = o;
      });
      clear.forEach(id => { if (!ids[id]) throw new Error('stop ' + id + ' is not in segment ' + seg); });
      const bk = await autoBackup(db, trip), was = (cur.data() || {}).stopDates || {}, before = {};
      Object.keys(clean).concat(clear).forEach(id => { before[id] = plain(was[id]) || null; });
      if (Object.keys(clean).length) await ref.set({ stopDates: clean }, { merge: true });
      for (const id of clear) await ref.update(new admin.firestore.FieldPath('stopDates', id), admin.firestore.FieldValue.delete());
      await log(db, { op, trip, seg, before: JSON.stringify(before).slice(0, 4000), after: JSON.stringify(clean).slice(0, 4000), cleared: clear.join(' '), backup: bk.id });
      return { ok: true, before, backup: bk.id };
    }
    case 'trashLocs': {   /* move places to the bin: the whole place is copied to locationsTrash first */
      const items = Array.isArray(b.items) ? b.items : []; if (!items.length || items.length > 100) throw new Error('1 to 100 items');
      const reason = String(b.reason || '').slice(0, 200), done = [], missing = [];
      for (const it of items) {
        const r = String(it.region || ''), id = String(it.id || '');
        if (!r || !id || /[\/.]/.test(r) || /\//.test(id)) throw new Error('bad item');
        const ref = db.doc('locations/' + r + '/items/' + id), cur = await ref.get();
        if (!cur.exists) { missing.push(r + '/' + id); continue; }
        const tref = db.doc('locationsTrash/' + r + '__' + id);
        await tref.set({ region: r, id, at: new Date().toISOString(), reason, name: (cur.data() || {}).name || '', data: cur.data() });
        const chk = await tref.get(); if (!chk.exists) throw new Error('bin copy failed for ' + r + '/' + id);
        await ref.delete(); done.push(r + '/' + id);
      }
      await log(db, { op, reason, moved: done.join(' ').slice(0, 6000), n: done.length });
      return { ok: true, moved: done.length, missing };
    }
    case 'restoreLocs': {   /* put places from the bin back where they were */
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : []; if (!ids.length || ids.length > 100) throw new Error('1 to 100 ids');
      const done = [];
      for (const k of ids) {
        if (/\//.test(k)) throw new Error('bad id');
        const tref = db.doc('locationsTrash/' + k), cur = await tref.get(); if (!cur.exists) continue;
        const t = cur.data() || {};
        await db.doc('locations/' + t.region + '/items/' + t.id).set(t.data || {});
        await tref.delete(); done.push(k);
      }
      await log(db, { op, restored: done.join(' ').slice(0, 6000), n: done.length });
      return { ok: true, restored: done.length };
    }
    case 'clearScore': {   /* remove ONE person's score from the places of one region; the other scores stay; old scores go to claudeLog */
      const r = String(b.region || ''), who = String(b.who || ''); if (!r || /[\/.]/.test(r) || !who || /[.\/]/.test(who)) throw new Error('region and who needed');
      const reason = String(b.reason || '').slice(0, 200), dry = !!b.dry, snap = await db.collection('locations/' + r + '/items').get();
      const hit = [];
      snap.docs.forEach(d => { const x = d.data() || {}; if (x.ratings && typeof x.ratings === 'object' && x.ratings[who] != null) hit.push({ id: d.id, name: x.name || '', score: x.ratings[who] }); });
      if (dry) return { ok: true, dry: true, region: r, who, total: snap.size, withScore: hit.length, sample: hit.slice(0, 5) };
      for (let i = 0; i < hit.length; i += 400) {
        const batch = db.batch(); hit.slice(i, i + 400).forEach(h => batch.update(db.doc('locations/' + r + '/items/' + h.id), { ['ratings.' + who]: admin.firestore.FieldValue.delete() }));
        await batch.commit();
      }
      for (let i = 0; i < hit.length; i += 40) await log(db, { op, region: r, who, reason, old: JSON.stringify(hit.slice(i, i + 40)).slice(0, 8000), n: hit.length });
      if (!hit.length) await log(db, { op, region: r, who, reason, n: 0 });
      return { ok: true, region: r, who, total: snap.size, cleared: hit.length };
    }
    case 'setScores': {   /* put scores back (from the claudeLog 'old' lists) */
      const r = String(b.region || ''), who = String(b.who || ''), sc = Array.isArray(b.scores) ? b.scores : [];
      if (!r || /[\/.]/.test(r) || !who || /[.\/]/.test(who) || !sc.length || sc.length > 400) throw new Error('region, who and 1-400 scores needed');
      const batch = db.batch(); sc.forEach(h => { const v = Number(h.score); if (!h.id || /\//.test(String(h.id)) || !(v >= 0.5 && v <= 5)) throw new Error('bad score item'); batch.update(db.doc('locations/' + r + '/items/' + h.id), { ['ratings.' + who]: v }); });
      await batch.commit(); await log(db, { op, region: r, who, n: sc.length });
      return { ok: true, restored: sc.length };
    }
    case 'setEpisodes': {   /* {slug, episodes:[{t,u,a?,b?,n?}]} — replaces the list of that one trip; other trips stay; old list goes to claudeLog */
      const slug = String(b.slug || '');
      if (!/^[a-z0-9-]{1,40}$/.test(slug)) throw new Error('slug: lowercase letters, digits and - only (the public trip name, e.g. yellowstone)');
      if (!Array.isArray(b.episodes) || b.episodes.length > 80) throw new Error('episodes: a list of at most 80');
      const YT = /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|live\/|playlist\?list=)|youtu\.be\/)[A-Za-z0-9_&=?%.-]{3,120}$/;
      const eps = b.episodes.map((e, i) => {
        const t = String(e.t || '').trim().slice(0, 90), u = String(e.u || '').trim();
        if (!t) throw new Error('episode ' + (i + 1) + ': title missing');
        if (!YT.test(u)) throw new Error('episode ' + (i + 1) + ': link must be an https YouTube link');
        const o = { t, u }, iso = /^\d{4}-\d{2}-\d{2}$/;
        ['a', 'b'].forEach(k => { if (e[k]) { if (!iso.test(String(e[k]))) throw new Error('episode ' + (i + 1) + ': ' + k + ' must be YYYY-MM-DD'); o[k] = String(e[k]); } });
        if (e.n) o.n = String(e.n).trim().slice(0, 160);
        return o;
      });
      const ref = db.doc('public/episodes'), cur = await ref.get();
      let all = {}; try { all = cur.exists ? JSON.parse((cur.data() || {}).json || '{}') : {}; } catch (e) { all = {}; }
      const before = all[slug] || [];
      if (eps.length) all[slug] = eps; else delete all[slug];
      await ref.set({ json: JSON.stringify(all), updated: new Date().toISOString() });
      await log(db, { op, slug, before: JSON.stringify(before).slice(0, 4000), after: JSON.stringify(eps).slice(0, 4000) });
      return { ok: true, slug, episodes: eps.length };
    }
    case 'log': {
      const lim = Math.min(Math.max(parseInt(b.limit, 10) || 30, 1), 200);
      const q = await db.collection('claudeLog').orderBy('at', 'desc').limit(lim).get();
      return { log: q.docs.map(d => plain(d.data())) };
    }
    default: throw new Error('unknown op: ' + op + ' (ping, trips, dump, get, list, backup, patch, setDates, trashLocs, restoreLocs, clearScore, setScores, setEpisodes, log)');
  }
}

exports._handle = handle;
exports.claudeAccess = functions.region('europe-west1').runWith({ timeoutSeconds: 120, memory: '512MB' }).https.onRequest(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const key = req.get('x-claude-key') || body.key;   /* never in the address: addresses end up in logs */
  if (!keyOk(key)) { await new Promise(r => setTimeout(r, 800)); res.status(403).json({ error: 'no access' }); return; }
  try {
    const b = Object.assign({}, body); delete b.key;
    res.status(200).json(await handle(admin.firestore(), b));
  } catch (e) { res.status(400).json({ error: String((e && e.message) || e) }); }
});
