#!/usr/bin/env node
/* Travellers 1969 — check (and if needed restore) the stop dates of the trip "Vegas–NYC–Chicago Oct 2026".
   Run from the repo root in Cloud Shell:
     node tools/trip_dates_v1.js            -> only CHECKS, changes nothing
     node tools/trip_dates_v1.js --restore  -> fills in dates ONLY for stops that have none (never overwrites, never deletes)
   Before --restore it writes a backup of the current dates to ~/trip_dates_backup_<time>.json
   Dates come from Google Calendar (read on 2 Nov 2026), local time of each city.                         */
const admin = require('../functions/node_modules/firebase-admin');
const fs = require('fs'), os = require('os'), path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require('../functions/service-account-key.json')) });
const db = admin.firestore();
const RESTORE = process.argv.includes('--restore');
const TRIP_MATCH = /vegas/i;

/* [name keywords (all must match, lower case), arrivalDate, arrivalTime, departureDate, departureTime] — from Google Calendar */
const CAL = [
  [['four seasons'],            '27/10/2026','17:00','30/10/2026','07:30'],
  [['blue man'],                '27/10/2026','20:00','27/10/2026','21:00'],
  [['arte museum'],             '27/10/2026','15:30','27/10/2026','16:45'],
  [['now you see me'],          '27/10/2026','19:00','27/10/2026','20:30'],
  [['nathan burton'],           '27/10/2026','16:00','27/10/2026','17:10'],
  [['piano man'],               '28/10/2026','18:30','28/10/2026','19:45'],
  [['king of diamonds'],        '28/10/2026','20:45','28/10/2026','22:45'],
  [['sphere'],                  '29/10/2026','11:00','29/10/2026','12:30'],
  [['wizard of oz'],            '29/10/2026','11:00','29/10/2026','12:30'],
  [['bryan adams'],             '29/10/2026','20:00','29/10/2026','21:00'],
  [['club vegas'],              '29/10/2026','22:45','30/10/2026','00:15'],
  [['hyatt'],                   '30/10/2026','19:00','01/11/2026','15:00'],
  [['book of mormon'],          '31/10/2026','14:00','31/10/2026','16:30'],
  [['halloween parade'],        '31/10/2026','19:00','31/10/2026','21:30'],
  [['slipper room'],            '31/10/2026','22:45','01/11/2026','01:00'],
  [['renaissance'],             '01/11/2026','21:30','02/11/2026','17:00'],
  [['andretti'],                '01/11/2026','21:00','01/11/2026','22:30'],
];
const norm = s => String(s || '').toLowerCase();
function calFor(stop, segIdx, stopIdx, nSegs, nStops) {
  const n = norm(stop.name);
  if (/^home\b/.test(n)) {               // Home at the start of the first segment / the end of the last one
    if (segIdx === 0 && stopIdx === 0) return ['27/10/2026', '10:30', '27/10/2026', '11:20'];
    if (segIdx === nSegs - 1 && stopIdx === nStops - 1) return ['02/11/2026', '22:51', '02/11/2026', '22:51'];
    return null;
  }
  const hit = CAL.find(c => c[0].every(k => n.includes(k)));
  return hit ? hit.slice(1) : null;
}

(async () => {
  const trips = (await db.collection('trips').get()).docs.filter(d => TRIP_MATCH.test((d.data() || {}).name || ''));
  if (!trips.length) { console.log('No trip with "Vegas" in its name found — nothing changed.'); process.exit(1); }
  if (trips.length > 1) console.log('Note: ' + trips.length + ' trips match "Vegas": ' + trips.map(t => t.data().name + ' (' + t.id + ')').join(', ') + '. Using every one.');
  const backup = {}, BK = path.join(os.homedir(), 'trip_dates_backup_' + Date.now() + '.json');
  for (const trip of trips) {
    console.log('\n=== ' + trip.data().name + '  (' + trip.id + ')');
    const segs = (await trip.ref.collection('segments').get()).docs.sort((a, b) => (a.data().order || 0) - (b.data().order || 0));
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si], sd = seg.data() || {}, dates = sd.stopDates || {};
      backup[trip.id + '/' + seg.id] = dates; if (RESTORE) fs.writeFileSync(BK, JSON.stringify(backup, null, 1));
      const stops = (await seg.ref.collection('stops').get()).docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => (a.order || 0) - (b.order || 0));
      console.log('\n  Segment ' + (si + 1) + ' ' + (sd.customLabel || sd.name || '') + '  (' + seg.id + ') — ' + stops.length + ' stops, ' + Object.keys(dates).length + ' saved date entries');
      const used = {}, fill = {};
      stops.forEach((st, k) => {
        const d = dates[st.id];
        if (d && d.arrivalDate) { used[st.id] = 1; console.log('    ✔ ' + st.name + ' — ' + d.arrivalDate + ' ' + (d.arrivalTime || '') + ' → ' + (d.departureDate || '') + ' ' + (d.departureTime || '')); return; }
        const c = calFor(st, si, k, segs.length, stops.length);
        if (c) { fill[st.id] = { arrivalDate: c[0], arrivalTime: c[1], departureDate: c[2], departureTime: c[3], syncCalendar: false };
          console.log('    ✖ ' + st.name + ' — NO DATE' + '   (calendar: ' + c[0] + ' ' + c[1] + ' → ' + c[2] + ' ' + c[3] + ')'); }
        else console.log('    ✖ ' + st.name + ' — NO DATE   (not found in the calendar list)');
      });
      const orphans = Object.keys(dates).filter(k => !used[k] && !stops.some(s => s.id === k));
      if (orphans.length) console.log('    ⚠ ' + orphans.length + ' saved date(s) belong to stop ids that no longer exist in this segment: ' + orphans.map(k => k + '=' + (dates[k].arrivalDate || '?')).join(', '));
      if (RESTORE && Object.keys(fill).length) {
        const upd = {}; Object.keys(fill).forEach(k => { upd['stopDates.' + k] = fill[k]; });
        await seg.ref.update(upd);
        console.log('    → restored ' + Object.keys(fill).length + ' date(s)');
      }
    }
  }
  if (RESTORE) console.log('\nBackup of the dates as they were before: ' + BK);
  else console.log('\nOnly checked — nothing changed. Run again with --restore to fill in the missing dates.');
  process.exit(0);
})().catch(e => { console.error('Stopped: ' + (e.message || e)); process.exit(1); });
