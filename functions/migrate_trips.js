const admin = require('firebase-admin');
const path  = require('path');
admin.initializeApp({ credential: admin.credential.cert(
  require(path.join(process.env.HOME,'travellers-1969/functions/service-account-key.json'))
)});
const db = admin.firestore();
async function main() {
  console.log('=== Trip Migration ===');
  const tripRef = db.collection('trips').doc('roadtrip-2027');
  const tripDoc = await tripRef.get();
  if (tripDoc.exists) {
    console.log('Trip document already exists:', JSON.stringify(tripDoc.data()));
  } else {
    await tripRef.set({ name: 'USA 2027', createdAt: new Date() });
    console.log('Created trips/roadtrip-2027 with name "USA 2027"');
  }
  const segs = await tripRef.collection('segments').get();
  console.log('Segments found at trips/roadtrip-2027/segments:', segs.size);
  segs.docs.forEach(d => {
    const data = d.data();
    console.log(' -', d.id, '|', data.name, '|', (data.stops||[]).length, 'stops');
  });
  if (segs.size === 0) console.log('No segments here — check Firebase Console for actual data path.');
  else console.log('Migration complete — segments already at correct path.');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
