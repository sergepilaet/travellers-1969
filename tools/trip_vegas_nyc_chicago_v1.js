#!/usr/bin/env node
/* Travellers 1969 — builds the private trip "Vegas–NYC–Chicago Oct 2026".
   Run from the repo root in Cloud Shell:  node tools/trip_vegas_nyc_chicago_v1.js
   - Adds the hotels and the shows/events as locations (Nevada, New York, Illinois),
     re-using a location when one with the same name already exists in that region.
   - Creates the trip with 3 segments (one per city). The hotel is the stop with the
     full stay dates; every show/event is a side trip from that hotel, with its own date + time.
   - Calendar sync is OFF for every stop (the events are already in Google Calendar).
   - The trip is NOT published. It stops if a trip with this name already exists.          */
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('../functions/service-account-key.json')) });
const db = admin.firestore();
const TS = admin.firestore.FieldValue.serverTimestamp;

const TRIP_NAME = 'Vegas–NYC–Chicago Oct 2026';
const COLORS = ['#0B8FAC', '#E8590C', '#7C3AED'];
const slug = n => String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const rid = p => p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);

// kind: '' = the stay (hotel), 'trip' = side trip from the hotel
// dates DD/MM/YYYY, times HH:MM local time
const SEGMENTS = [
  { label: 'Las Vegas', region: 'Nevada', stops: [
    { kind: '', name: 'Four Seasons Hotel Las Vegas', cat: 'Hotel', addr: '3960 S Las Vegas Blvd, Las Vegas, NV 89119', lat: 36.0915, lng: -115.1745,
      a: '27/10/2026', at: '13:00', d: '30/10/2026', dt: '07:30', notes: 'Our stay in Las Vegas, 3 nights. Arrive on Southwest WN 114 from Boise, leave on Delta DL 333 to New York JFK.' },
    { kind: 'trip', name: 'Nathan Burton Comedy Magic (option)', cat: 'Entertainment', addr: 'Showcase Mall, 3771 S Las Vegas Blvd #160, Las Vegas, NV', lat: 36.1046, lng: -115.1712,
      a: '27/10/2026', at: '16:00', d: '27/10/2026', dt: '17:10', notes: 'OPTION, not booked. Family-friendly comedy magic show, 70 minutes. Alternative: Mac King at Excalibur, 15:00.' },
    { kind: 'trip', name: 'Now You See Me Live', cat: 'Entertainment', addr: 'MGM Grand Theater, 3799 S Las Vegas Blvd, Las Vegas, NV 89109', lat: 36.1024, lng: -115.1695,
      a: '27/10/2026', at: '19:00', d: '27/10/2026', dt: '20:30', notes: 'PLANNED, tickets still to book.' },
    { kind: 'trip', name: 'The Wizard of Oz at Sphere', cat: 'Entertainment', addr: 'Sphere, 255 Sands Ave, Las Vegas, NV 89169', lat: 36.1209, lng: -115.1622,
      a: '28/10/2026', at: '14:00', d: '28/10/2026', dt: '15:30', notes: 'PLANNED, tickets still to book. First visit to Sphere.' },
    { kind: 'trip', name: 'Piano Man: Elton John & Billy Joel tribute', cat: 'Entertainment', addr: 'V Theater, Miracle Mile Shops at Planet Hollywood, 3663 S Las Vegas Blvd, Las Vegas, NV', lat: 36.1100, lng: -115.1716,
      a: '28/10/2026', at: '18:30', d: '28/10/2026', dt: '19:45', notes: 'PLANNED, tickets still to book. About 75 minutes.' },
    { kind: 'trip', name: 'King of Diamonds: Neil Diamond tribute', cat: 'Entertainment', addr: 'Athena Showlounge, Alexis Park Resort, 375 E Harmon Ave, Las Vegas, NV 89169', lat: 36.1083, lng: -115.1573,
      a: '28/10/2026', at: '21:00', d: '28/10/2026', dt: '22:15', notes: 'PLANNED, tickets still to book. Els may join if the supplier dinner ends in time.' },
    { kind: 'trip', name: 'Bryan Adams – Bare Bones Acoustic Solo Show', cat: 'Entertainment', addr: 'Encore Theater, Wynn Las Vegas, 3131 S Las Vegas Blvd, Las Vegas, NV 89109', lat: 36.1289, lng: -115.1650,
      a: '29/10/2026', at: '20:00', d: '29/10/2026', dt: '21:00', notes: 'Tickets booked.' },
  ]},
  { label: 'New York', region: 'New York', stops: [
    { kind: '', name: 'Hyatt Centric Times Square New York', cat: 'Hotel', addr: '135 W 45th St, New York, NY 10036', lat: 40.7570, lng: -73.9845,
      a: '30/10/2026', at: '19:00', d: '01/11/2026', dt: '15:00', notes: 'Our stay in New York, 2 nights. Arrive from Las Vegas at JFK, leave from LaGuardia to Chicago O\'Hare.' },
    { kind: 'trip', name: 'The Book of Mormon (option)', cat: 'Entertainment', addr: "Eugene O'Neill Theatre, 230 W 49th St, New York, NY 10019", lat: 40.7612, lng: -73.9858,
      a: '31/10/2026', at: '14:00', d: '31/10/2026', dt: '16:30', notes: 'OPTION, not booked. Saturday matinee, a few minutes walk from the hotel. Ask the group first.' },
    { kind: 'trip', name: 'NYC Village Halloween Parade', cat: 'Festival', addr: '6th Ave near W 15th St, New York, NY 10011', lat: 40.7381, lng: -73.9971,
      a: '31/10/2026', at: '19:00', d: '31/10/2026', dt: '21:30', notes: 'PLANNED, free. Watch with friends near the north end of the route (6th Ave from King St to W 15th St). Meeting spot still to agree.' },
    { kind: 'trip', name: 'The Slipper Room Halloween Midnight Show (option)', cat: 'Entertainment', addr: '167 Orchard St (entrance on Stanton), New York, NY 10002', lat: 40.7213, lng: -73.9884,
      a: '31/10/2026', at: '22:45', d: '31/10/2026', dt: '23:59', notes: 'OPTION, not booked. Doors 22:45, shows 23:00 and 00:15, dance party after. 21+, about $25.' },
  ]},
  { label: 'Chicago', region: 'Illinois', stops: [
    { kind: '', name: 'Renaissance Schaumburg Convention Center Hotel', cat: 'Hotel', addr: '1551 Thoreau Dr N, Schaumburg, IL 60173', lat: 42.0469, lng: -88.0425,
      a: '01/11/2026', at: '19:00', d: '02/11/2026', dt: '17:00', notes: 'Our stay near Chicago, 1 night. Close to O\'Hare. Leave on United UA 5290 to Boise.' },
    { kind: 'trip', name: 'Andretti Indoor Karting & Games Schaumburg', cat: 'Entertainment/sports', addr: '1441 Thoreau Dr, Schaumburg, IL', lat: 42.0455, lng: -88.0410,
      a: '02/11/2026', at: '', d: '02/11/2026', dt: '', notes: 'Indoor go-karting and games, on the same street as the hotel.' },
  ]},
];

async function findOrAddLocation(region, s) {
  const regRef = db.collection('locations').doc(slug(region));
  const reg = await regRef.get();
  if (!reg.exists) throw new Error('Region "' + region + '" not found in the app — nothing was changed after this point.');
  const same = await regRef.collection('items').where('name', '==', s.name).limit(1).get();
  if (!same.empty) return { id: same.docs[0].id, reused: true };
  const ref = await regRef.collection('items').add({
    name: s.name, website: 'N/A', mapsUrl: '', address: s.addr, ratings: {}, category: s.cat, subcategory: '',
    status: 'Planning', budget: 0, season: 'Fall', notes: s.notes, reservation: 'No', pinned: false,
    lat: s.lat, lng: s.lng, state: region, createdAt: TS() });
  return { id: ref.id, reused: false };
}

(async () => {
  const dup = await db.collection('trips').where('name', '==', TRIP_NAME).get();
  if (!dup.empty) { console.log('A trip called "' + TRIP_NAME + '" already exists — nothing changed.'); process.exit(0); }

  // check the regions first, so nothing half-done is left behind
  for (const sg of SEGMENTS) {
    const r = await db.collection('locations').doc(slug(sg.region)).get();
    if (!r.exists) { console.log('Region "' + sg.region + '" not found in the app — nothing changed.'); process.exit(1); }
  }

  const trip = await db.collection('trips').add({ name: TRIP_NAME, createdAt: TS() });
  console.log('Trip created: ' + TRIP_NAME);
  let added = 0, reused = 0;

  for (let i = 0; i < SEGMENTS.length; i++) {
    const sg = SEGMENTS[i];
    const segId = rid('seg');
    const segRef = trip.collection('segments').doc(segId);
    const stopDates = {};
    for (let j = 0; j < sg.stops.length; j++) {
      const s = sg.stops[j];
      const loc = await findOrAddLocation(sg.region, s);
      loc.reused ? reused++ : added++;
      const stopId = rid('stop');
      await segRef.collection('stops').doc(stopId).set({
        order: j + 1, name: s.name, state: sg.region, lat: s.lat, lng: s.lng, category: s.cat, status: 'Planning',
        plannedDate: '', visitedDate: '', hidePublic: false, showPublic: false, postsJson: '', sideKind: s.kind,
        sourceSheet: sg.region, sourceRow: loc.id });
      stopDates[stopId] = { arrivalDate: s.a, arrivalTime: s.at, departureDate: s.d, departureTime: s.dt, syncCalendar: false };
      await new Promise(r => setTimeout(r, 5)); // unique ids
    }
    await segRef.set({ name: '', customLabel: sg.label, order: i + 1, color: COLORS[i], stopDates });
    console.log('  ' + (i + 1) + '. ' + sg.label + ' — ' + sg.stops.length + ' stops');
  }
  console.log('Done. Locations added: ' + added + ', already there: ' + reused + '. Trip is private (not published).');
  process.exit(0);
})().catch(e => { console.error('Stopped: ' + (e.message || e)); process.exit(1); });
