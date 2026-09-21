#!/usr/bin/env node
/* Travellers 1969 — dump Firestore to a file in the repo so any chat can read it.
   Run from the repo root:  node tools/dump.js
   Writes: data/locations.tsv  and  data/summary.txt                              */
const admin = require('../functions/node_modules/firebase-admin');
const fs = require('fs');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(require('../functions/service-account-key.json'))
});
const db = admin.firestore();

const clean = v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();

(async () => {
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  const regions = await db.collection('locations').get();
  const rows = [];
  const perRegion = {};
  const perCat = {};

  for (const reg of regions.docs) {
    const meta = reg.data() || {};
    const region = meta.name || reg.id;
    const country = meta.country || '';
    const items = await reg.ref.collection('items').get();
    items.forEach(doc => {
      const d = doc.data() || {};
      if (!d.name) return;
      rows.push([
        clean(d.name), clean(region), clean(country),
        clean(d.category), clean(d.subcategory), clean(d.status),
        clean(d.website === 'N/A' ? '' : d.website),
        clean(d.address),
        d.lat == null ? '' : Number(d.lat).toFixed(5),
        d.lng == null ? '' : Number(d.lng).toFixed(5),
        d.googleRating == null ? '' : d.googleRating,
        clean(d.notes)
      ].join('\t'));
      perRegion[region] = (perRegion[region] || 0) + 1;
      const c = d.category || '(none)';
      perCat[c] = (perCat[c] || 0) + 1;
    });
    process.stdout.write('.');
  }

  if (!rows.length) { console.error('\nNo locations read — nothing written.'); process.exit(1); }
  rows.sort((a, b) => {
    const A = a.split('\t'), B = b.split('\t');
    return (A[1] || '').localeCompare(B[1] || '') || (A[0] || '').localeCompare(B[0] || '');
  });

  const header = 'name\tregion\tcountry\tcategory\tsubcategory\tstatus\twebsite\taddress\tlat\tlng\tgoogleRating\tnotes';
  fs.writeFileSync(path.join(outDir, 'locations.tsv'), header + '\n' + rows.join('\n') + '\n');

  const summary =
    'Travellers 1969 — data snapshot ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + '\n' +
    rows.length + ' locations across ' + Object.keys(perRegion).length + ' regions\n\n' +
    'PER REGION\n' +
    Object.keys(perRegion).sort().map(r => '  ' + r.padEnd(26) + perRegion[r]).join('\n') +
    '\n\nPER CATEGORY\n' +
    Object.keys(perCat).sort((a, b) => perCat[b] - perCat[a]).map(c => '  ' + c.padEnd(26) + perCat[c]).join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'summary.txt'), summary);

  console.log('\n' + rows.length + ' locations -> data/locations.tsv');
  console.log(Object.keys(perRegion).length + ' regions  -> data/summary.txt');
  process.exit(0);
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1); });
