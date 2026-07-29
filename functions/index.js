'use strict';
const functions = require('firebase-functions/v1');
const admin     = require('firebase-admin');
const { google } = require('googleapis');
admin.initializeApp();
const SPREADSHEET_ID  = '1DvyWFEdmAceaRJ7oHYTA7VyqQLNcyFHLChBw2i08GgA';
const ALLOWED_EMAILS  = ['sergepilaet@gmail.com', 'elsvrijsen8@gmail.com'];
const REGION          = 'europe-west1';
const SKIP_TABS       = ['Route', 'Settings'];
const US_STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming','District of Columbia'];
const CA_PROVINCES = ['British Columbia','Alberta','Saskatchewan','Manitoba','Ontario','Quebec','New Brunswick','Nova Scotia','Prince Edward Island','Newfoundland and Labrador','Yukon','Northwest Territories','Nunavut'];
const ALL_STATES = US_STATES.concat(CA_PROVINCES);
const COL = {NAAM:0,LINK:1,MAPS:2,ADRES:3,ELS:4,SERGE:5,AVG:6,CATEGORY:7,STATUS:8,BUDGET:9,SEASON:10,OPMERKINGEN:11,RESERVATION:12,LAT:13,LNG:14,PINNED:15};
const VALID_CATEGORIES = new Set(['Bizarre','Nature','Restaurant','Museum','Historic','Festival','Aviation','Ghost Town','Entertainment','Naturist Resort','Swingers Club','Hotel','Theme Park','Brewery/Distillery','Scenic Route','Entertainment/sports','Ski Resort']);
function checkAuth(context){if(!context.auth)throw new functions.https.HttpsError('unauthenticated','Login required');if(!ALLOWED_EMAILS.includes(context.auth.token.email))throw new functions.https.HttpsError('permission-denied','Access denied');}
function getSheets(){const sa=require('./service-account-key.json');const auth=new google.auth.JWT(sa.client_email,null,sa.private_key,['https://www.googleapis.com/auth/spreadsheets']);return google.sheets({version:'v4',auth});}
function extractCoordsFromUrl(url){if(!url||url==='N/A')return null;const patterns=[/@(-?\d+\.?\d+),(-?\d+\.?\d+)/,/[?&]q=(-?\d+\.?\d+),(-?\d+\.?\d+)/,/ll=(-?\d+\.?\d+),(-?\d+\.?\d+)/,/\/place\/[^/]+\/@(-?\d+\.?\d+),(-?\d+\.?\d+)/,/!3d(-?\d+\.?\d+)!4d(-?\d+\.?\d+)/];for(const p of patterns){const m=url.match(p);if(m){const lat=parseFloat(m[1]),lng=parseFloat(m[2]);if(lat>=17&&lat<=84&&lng>=-180&&lng<=-50)return{lat,lng};}}return null;}
function parseRow(row,rowIndex){while(row.length<16)row.push('');const naam=(row[COL.NAAM]||'').toString().trim();const category=(row[COL.CATEGORY]||'').toString().trim();if(!naam)return null;if(naam==='Naam')return null;if(naam===naam.toUpperCase()&&naam.length>2&&!/\d/.test(naam))return null;if(!category)return null;let lat=parseFloat(String(row[COL.LAT]||'').replace(',','.'));let lng=parseFloat(String(row[COL.LNG]||'').replace(',','.'));if(isNaN(lat)||isNaN(lng)){const coords=extractCoordsFromUrl((row[COL.MAPS]||'').toString());if(coords){lat=coords.lat;lng=coords.lng;}}return{name:naam,website:(row[COL.LINK]||'').toString(),mapsUrl:(row[COL.MAPS]||'').toString(),address:(row[COL.ADRES]||'').toString(),elsRating:parseFloat(row[COL.ELS])||null,sergeRating:parseFloat(row[COL.SERGE])||null,category,status:(row[COL.STATUS]||'Planning').toString(),budget:parseFloat(row[COL.BUDGET])||0,season:(row[COL.SEASON]||'Year-round').toString(),notes:(row[COL.OPMERKINGEN]||'').toString(),reservation:(row[COL.RESERVATION]||'No').toString(),pinned:(row[COL.PINNED]||'').toString().trim()==='Yes',lat:isNaN(lat)?null:lat,lng:isNaN(lng)?null:lng,rowIndex};}
function parseSheetRows(values){if(!values||values.length<3)return[];const locs=[];for(let i=2;i<values.length;i++){const loc=parseRow(Array.from(values[i]||[]),i+1);if(loc)locs.push(loc);}return locs;}
function fn(handler){return functions.region(REGION).https.onCall(async(data,context)=>{checkAuth(context);try{return await handler(data,context);}catch(e){if(e instanceof functions.https.HttpsError)throw e;console.error(e);throw new functions.https.HttpsError('internal',e.message||'Internal error');}});}
function hexToRgb(hex){hex=(hex||'#1a3a5c').replace('#','');return{red:parseInt(hex.slice(0,2),16)/255,green:parseInt(hex.slice(2,4),16)/255,blue:parseInt(hex.slice(4,6),16)/255};}
exports.getAvailableStates=fn(async()=>{const sheets=getSheets();const res=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:'sheets.properties.title'});const tabNames=res.data.sheets.map(s=>s.properties.title);return ALL_STATES.filter(s=>tabNames.includes(s));});
exports.getOtherCountryTabs=fn(async()=>{const sheets=getSheets();const res=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:'sheets.properties.title'});const tabNames=res.data.sheets.map(s=>s.properties.title);return tabNames.filter(n=>!US_STATES.includes(n)&&!CA_PROVINCES.includes(n)&&!SKIP_TABS.includes(n));});
exports.getStateData=fn(async(stateName)=>{if(!stateName)return{error:'No state provided',locations:[]};const sheets=getSheets();const res=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`'${stateName}'!A:P`});const locs=parseSheetRows(res.data.values||[]);return{state:stateName,totalLocations:locs.length,locations:locs};});
exports.getMultiStateData=fn(async(stateNames)=>{if(!Array.isArray(stateNames)||!stateNames.length)return{locations:[],stateCount:0,totalCount:0};const sheets=getSheets();const ranges=stateNames.map(s=>`'${s}'!A:P`);const res=await sheets.spreadsheets.values.batchGet({spreadsheetId:SPREADSHEET_ID,ranges});const all=[];(res.data.valueRanges||[]).forEach((vr,i)=>{const locs=parseSheetRows(vr.values||[]);locs.forEach(loc=>{loc.state=stateNames[i];all.push(loc);});});return{locations:all,stateCount:stateNames.length,totalCount:all.length};});
exports.getAllPinnedLocations=fn(async()=>{const sheets=getSheets();const meta=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:'sheets.properties.title'});const tabNames=meta.data.sheets.map(s=>s.properties.title);const stateSheets=ALL_STATES.filter(s=>tabNames.includes(s));if(!stateSheets.length)return{success:true,pinned:[],count:0};const ranges=stateSheets.map(s=>`'${s}'!A:P`);const res=await sheets.spreadsheets.values.batchGet({spreadsheetId:SPREADSHEET_ID,ranges});const pinned=[];(res.data.valueRanges||[]).forEach((vr,i)=>{const locs=parseSheetRows(vr.values||[]);locs.forEach(loc=>{if(loc.pinned){loc.state=stateSheets[i];pinned.push(loc);}});});return{success:true,pinned,count:pinned.length};});
exports.getNearbyLocations=fn(async(data)=>{const{lat,lng,radiusKm}=data||{};if(!lat||!lng||!radiusKm)return[];const sheets=getSheets();const meta=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:'sheets.properties.title'});const tabNames=meta.data.sheets.map(s=>s.properties.title).filter(n=>!SKIP_TABS.includes(n));const ranges=tabNames.map(n=>`'${n}'!A:P`);const res=await sheets.spreadsheets.values.batchGet({spreadsheetId:SPREADSHEET_ID,ranges});const R=6371;const results=[];(res.data.valueRanges||[]).forEach((vr,i)=>{const values=vr.values||[];for(let r=2;r<values.length;r++){const row=values[r];while(row.length<16)row.push('');const sLat=parseFloat(String(row[13]||'').replace(',','.'));const sLng=parseFloat(String(row[14]||'').replace(',','.'));if(isNaN(sLat)||isNaN(sLng)||sLat===0)continue;const dLat=(sLat-lat)*Math.PI/180;const dLng=(sLng-lng)*Math.PI/180;const a=Math.sin(dLat/2)**2+Math.cos(lat*Math.PI/180)*Math.cos(sLat*Math.PI/180)*Math.sin(dLng/2)**2;const dist=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));if(dist<=radiusKm)results.push({name:String(row[0]||''),state:tabNames[i],lat:sLat,lng:sLng,category:String(row[7]||''),status:String(row[8]||'Planning'),budget:Number(row[9])||0,notes:String(row[11]||''),rowIndex:r+1,dist:Math.round(dist*10)/10});}});results.sort((a,b)=>a.dist-b.dist);return results.slice(0,100);});
exports.setPinnedState=fn(async(data)=>{const{stateName,rowIndex,pinned}=data||{};if(!stateName||!rowIndex)return{success:false,message:'Missing state or row'};const sheets=getSheets();await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`'${stateName}'!P${rowIndex}`,valueInputOption:'RAW',requestBody:{values:[[pinned?'Yes':'No']]}});return{success:true};});
exports.updateLocationField=fn(async(data)=>{const{state,rowIndex,field,value}=data||{};const colMap={status:'I',category:'H'};const col=colMap[field];if(!col)return{success:false,message:'Unknown field: '+field};if(!rowIndex||rowIndex<3)return{success:false,message:'Invalid row'};const sheets=getSheets();await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`'${state}'!${col}${rowIndex}`,valueInputOption:'RAW',requestBody:{values:[[value]]}});return{success:true};});
exports.addLocationToSheet=fn(async(data)=>{if(!data||!data.state||!data.naam)return{success:false,message:'Missing state or name'};const sheets=getSheets();let newRow;try{const res=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`'${data.state}'!A:A`});newRow=(res.data.values||[]).length+1;}catch(e){await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests:[{addSheet:{properties:{title:data.state}}}]}});await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`'${data.state}'!A1:P2`,valueInputOption:'RAW',requestBody:{values:[[data.state.toUpperCase(),...Array(15).fill('')],['Naam','Link','Maps','Adres','Els','Serge','Avg','Category','Status','Budget','Season','Opmerkingen','Reservation','Latitude (X)','Longitude (Y)','Pinned']]}});newRow=3;}const r=newRow;const avgFormula=`=IF(AND(E${r}<>"";F${r}<>"");REPT("⭐";INT(ROUND((E${r}+F${r})/2;1)))&IF(MOD(ROUND((E${r}+F${r})/2;1);1)>=0,5;"½";"");"")`;const rowData=[data.naam,data.website||'N/A',data.mapsUrl||'',data.adres||'','','',avgFormula,data.category||'Bizarre',data.status||'Planning',parseFloat(data.budget)||0,data.season||'Year-round',data.notes||'',data.reservation||'No',data.lat||'',data.lng||'','No'];await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`'${data.state}'!A${newRow}:P${newRow}`,valueInputOption:'USER_ENTERED',requestBody:{values:[rowData]}});return{success:true,message:`"${data.naam}" added to ${data.state}`,rowIndex:newRow};});
exports.getLocationImage=fn(async(websiteUrl)=>{if(!websiteUrl||websiteUrl==='N/A'||!websiteUrl.trim())return null;try{const fetch=require('node-fetch');const res=await fetch(websiteUrl.trim(),{headers:{'User-Agent':'Mozilla/5.0'},timeout:6000,redirect:'follow'});if(!res.ok)return null;const html=(await res.text()).substring(0,8000);let m=html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);if(!m)m=html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);if(m&&m[1]&&m[1].startsWith('http'))return m[1];m=html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);if(m&&m[1]&&m[1].startsWith('http'))return m[1];return null;}catch(e){return null;}});
exports.resolveLocationFromUrl=fn(async(url)=>{
  const GK=process.env.GPLACES_KEY||'';
  const US={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'};
  if(!url||!url.trim())return{success:false,message:'No URL provided'};
  const raw=url.trim();
  const coords=extractCoordsFromUrl(raw);
  let name='';
  try{const m=raw.match(/\/maps\/place\/([^\/@?]+)/);if(m&&m[1])name=decodeURIComponent(m[1].replace(/\+/g,' ')).trim();}catch(e){}
  let state=null,country=null,address='',category='',lat=coords?coords.lat:null,lng=coords?coords.lng:null;
  function ctryFromComps(c){const ct=(c||[]).find(x=>(x.types||[]).includes('country'));return ct?(ct.long_name||null):null;}
  function stFromComps(c){
    const st=(c||[]).find(x=>(x.types||[]).includes('administrative_area_level_1'));
    if(st)return st.long_name||US[st.short_name]||st.short_name||null;
    const ct=(c||[]).find(x=>(x.types||[]).includes('country'));
    return ct?ct.long_name:null;
  }
  function stFromAddr(a){
    if(!a)return null;
    const m=a.match(/,\s*([A-Z]{2})\s+\d{5}/);if(m&&US[m[1]])return US[m[1]];
    const parts=a.split(',').map(x=>x.trim());
    for(const p of parts){if(US[p])return US[p];for(const k in US){if(US[k]===p)return US[k];}}
    return null;
  }
  let diag='';
  if(name){
    try{const su='https://maps.googleapis.com/maps/api/place/textsearch/json?query='+encodeURIComponent(name)+(coords?('&location='+coords.lat+','+coords.lng+'&radius=20000'):'')+'&key='+GK;
      const sj=await (await fetch(su)).json();
      if(sj&&sj.status&&sj.status!=='OK')diag='Places: '+sj.status+(sj.error_message?(' — '+sj.error_message):'');
      const p=(sj&&sj.results&&sj.results[0])||null;
      if(p){address=p.formatted_address||'';
        if(p.geometry&&p.geometry.location){lat=p.geometry.location.lat;lng=p.geometry.location.lng;}
        const ts=p.types||[];
        if(ts.includes('museum'))category='Museum';
        else if(ts.includes('amusement_park'))category='Theme Park';
        else if(ts.includes('bar')||ts.includes('brewery')||ts.includes('liquor_store'))category='Brewery/Distillery';
        else if(ts.includes('restaurant')||ts.includes('food')||ts.includes('cafe'))category='Restaurant';
        else if(ts.includes('park')||ts.includes('natural_feature')||ts.includes('campground'))category='Nature';
        else if(ts.includes('tourist_attraction'))category='Bizarre';
      }
    }catch(e){}
  }
  if(lat!=null&&lng!=null){
    try{const gu='https://maps.googleapis.com/maps/api/geocode/json?latlng='+lat+','+lng+'&key='+GK;
      const gj=await (await fetch(gu)).json();const r0=(gj&&gj.results&&gj.results[0])||null;
      if(r0){if(!address)address=r0.formatted_address||'';if(!state)state=stFromComps(r0.address_components);if(!country)country=ctryFromComps(r0.address_components);}
    }catch(e){}
  }
  if(!state)state=stFromAddr(address);
  if(!name&&address)name=address.split(',')[0];
  if((lat==null||lng==null)&&name){
    try{const fu='https://maps.googleapis.com/maps/api/geocode/json?address='+encodeURIComponent(name)+'&key='+GK;
      const fj=await (await fetch(fu)).json();
      if(fj&&fj.status&&fj.status!=='OK')diag=(diag?diag+' | ':'')+'Geocode: '+fj.status+(fj.error_message?(' — '+fj.error_message):'');
      const g0=(fj&&fj.results&&fj.results[0])||null;
      if(g0&&g0.geometry&&g0.geometry.location){lat=g0.geometry.location.lat;lng=g0.geometry.location.lng;
        if(!address)address=g0.formatted_address||'';
        if(!state)state=stFromComps(g0.address_components);
        if(!country)country=ctryFromComps(g0.address_components);}
    }catch(e){diag=(diag?diag+' | ':'')+'Geocode error: '+(e.message||e);}
  }
  if(lat==null||lng==null)return{success:false,message:'No coordinates found. '+(diag||'Google returned no result for this link.')};
  if(!country){const m2=(address||'').split(',');if(m2.length)country=(m2[m2.length-1]||'').trim()||null;}
  if(country==='USA')country='United States';
  return{success:true,lat:lat,lng:lng,state:state,stateRaw:state,region:state,country:country,address:address,suggestedName:name,category:category,mapsUrl:'https://www.google.com/maps?q='+lat+','+lng};});
exports.scanAllDuplicates=fn(async()=>{const sheets=getSheets();const meta=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:'sheets.properties.title'});const stateSheets=meta.data.sheets.map(s=>s.properties.title).filter(n=>ALL_STATES.includes(n));if(!stateSheets.length)return{success:true,results:[]};const ranges=stateSheets.map(s=>`'${s}'!A:P`);const res=await sheets.spreadsheets.values.batchGet({spreadsheetId:SPREADSHEET_ID,ranges});const results=[];(res.data.valueRanges||[]).forEach((vr,idx)=>{const stateName=stateSheets[idx];const values=vr.values||[];const rows=[];for(let r=2;r<values.length;r++){const row=values[r];const naam=(row[0]||'').toString().trim();if(!naam||naam==='Naam')continue;if(naam===naam.toUpperCase()&&naam.length>2&&!/\d/.test(naam))continue;const lat=parseFloat(String(row[13]||'').replace(',','.'));const lng=parseFloat(String(row[14]||'').replace(',','.'));rows.push({naam,category:(row[7]||'').toString().trim(),lat:isNaN(lat)?null:lat,lng:isNaN(lng)?null:lng,rowIndex:r+1});}const issues=[];for(let a=0;a<rows.length;a++){for(let b=a+1;b<rows.length;b++){const ra=rows[a],rb=rows[b];const sameName=ra.naam.toLowerCase()===rb.naam.toLowerCase();const sameCoords=ra.lat&&rb.lat&&Math.abs(ra.lat-rb.lat)<0.001&&Math.abs(ra.lng-rb.lng)<0.001;const sameCat=ra.category.toLowerCase()===rb.category.toLowerCase();if(sameName&&sameCat)issues.push({type:'EXACT_DUPLICATE',rowIndexA:ra.rowIndex,rowIndexB:rb.rowIndex,nameA:ra.naam,nameB:rb.naam,catA:ra.category,catB:rb.category});else if(sameName&&!sameCat)issues.push({type:'SAME_NAME_DIFF_CAT',rowIndexA:ra.rowIndex,rowIndexB:rb.rowIndex,nameA:ra.naam,nameB:rb.naam,catA:ra.category,catB:rb.category});else if(sameCoords&&!sameName)issues.push({type:'SAME_COORDS',rowIndexA:ra.rowIndex,rowIndexB:rb.rowIndex,nameA:ra.naam,nameB:rb.naam,catA:ra.category,catB:rb.category});}}if(issues.length)results.push({tab:stateName,issues});});return{success:true,results};});
exports.deleteSheetRows=fn(async(deletions)=>{if(!Array.isArray(deletions)||!deletions.length)return{success:false,message:'No rows provided'};const sheets=getSheets();const meta=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:'sheets.properties'});const sheetIdMap={};meta.data.sheets.forEach(s=>{sheetIdMap[s.properties.title]=s.properties.sheetId;});const byTab={};deletions.forEach(d=>{if(!byTab[d.tab])byTab[d.tab]=[];byTab[d.tab].push(d.rowIndex);});const requests=[];Object.keys(byTab).forEach(tabName=>{const sheetId=sheetIdMap[tabName];if(sheetId===undefined)return;byTab[tabName].sort((a,b)=>b-a).forEach(ri=>{requests.push({deleteDimension:{range:{sheetId,dimension:'ROWS',startIndex:ri-1,endIndex:ri}}});});});if(!requests.length)return{success:false,message:'No valid rows'};await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests}});return{success:true,deleted:deletions.length};});
exports.createCountryTabs = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: './service-account-key.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1DvyWFEdmAceaRJ7oHYTA7VyqQLNcyFHLChBw2i08GgA';
  const country = (data.country || '').trim();
  const color = (data.color || '#1a73e8').replace('#','');
  const regions = (data.regions && data.regions.length) ? data.regions : [country];
  function hexToRgb(h) {
    return { red:parseInt(h.substring(0,2),16)/255, green:parseInt(h.substring(2,4),16)/255, blue:parseInt(h.substring(4,6),16)/255 };
  }
  function darken(rgb,f=0.75) { return {red:rgb.red*f,green:rgb.green*f,blue:rgb.blue*f}; }
  const rgb = hexToRgb(color), darkRgb = darken(rgb), white = {red:1,green:1,blue:1};
  const HEADERS = ['Naam','Link','Maps','Adres','Els','Serge','Avg','Category','Status','Budget','Season','Opmerkingen','Reservation','Lat','Lng','Pinned'];
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties' });
  const existingSheets = meta.data.sheets.map(s => s.properties.title);
  const created = [];
  for (const region of regions) {
    const tabName = region.trim();
    if (!tabName) continue;
    if (existingSheets.includes(tabName)) { created.push(tabName+' (already exists)'); continue; }
    const addResp = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] }
    });
    const sheetId = addResp.data.replies[0].addSheet.properties.sheetId;
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data: [
        { range: `${tabName}!A1`, values: [[tabName.toUpperCase()]] },
        { range: `${tabName}!A2:P2`, values: [HEADERS] }
      ]}
    });
    const avgFormulas = [];
    for (let r = 3; r <= 202; r++) {
      avgFormulas.push([`=IF(AND(E${r}<>"";F${r}<>"");REPT("⭐";INT(ROUND((E${r}+F${r})/2;1)))&IF(MOD(ROUND((E${r}+F${r})/2;1);1)>=0,5;"½";"");"")`]);
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `${tabName}!G3:G202`,
      valueInputOption: 'USER_ENTERED', requestBody: { values: avgFormulas }
    });
    const allSheets = (await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties' }))
      .data.sheets.map(s => s.properties.title);
    const sortable = allSheets.filter(n => n !== tabName);
    sortable.push(tabName);
    sortable.sort((a,b) => { const au=a.toUpperCase(),bu=b.toUpperCase(); return au<bu?-1:au>bu?1:0; });
    const targetIndex = sortable.indexOf(tabName);
    const formatRequests = [
      { updateSheetProperties: { properties: { sheetId, tabColorStyle: { rgbColor: rgb } }, fields: 'tabColorStyle' }},
      { updateSheetProperties: { properties: { sheetId, index: targetIndex }, fields: 'index' }},
      { mergeCells: { range: { sheetId, startRowIndex:0, endRowIndex:1, startColumnIndex:0, endColumnIndex:16 }, mergeType:'MERGE_ALL' }},
      { repeatCell: { range: { sheetId, startRowIndex:0, endRowIndex:1, startColumnIndex:0, endColumnIndex:16 },
          cell: { userEnteredFormat: { backgroundColor:rgb, textFormat:{foregroundColor:white,bold:true,fontSize:14}, horizontalAlignment:'CENTER', verticalAlignment:'MIDDLE' }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)' }},
      { repeatCell: { range: { sheetId, startRowIndex:1, endRowIndex:2, startColumnIndex:0, endColumnIndex:16 },
          cell: { userEnteredFormat: { backgroundColor:darkRgb, textFormat:{foregroundColor:white,bold:true,fontSize:10}, horizontalAlignment:'CENTER' }},
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)' }},
      { setDataValidation: { range: { sheetId, startRowIndex:2, endRowIndex:1000, startColumnIndex:7, endColumnIndex:8 },
          rule: { condition: { type:'ONE_OF_LIST', values:['Bizarre','Nature','Restaurant','Museum','Historic','Festival','Aviation','Ghost Town','Entertainment/sports','Naturist Resort','Swingers Club','Hotel','Theme Park','Brewery/Distillery','Scenic Route'].map(v=>({userEnteredValue:v}))}, showCustomUi:true, strict:false }}},
      { setDataValidation: { range: { sheetId, startRowIndex:2, endRowIndex:1000, startColumnIndex:8, endColumnIndex:9 },
          rule: { condition: { type:'ONE_OF_LIST', values:[{userEnteredValue:'Planning'},{userEnteredValue:"Don't Skip"},{userEnteredValue:'Booked'},{userEnteredValue:'Maybe'}]}, showCustomUi:true, strict:false }}},
      { setDataValidation: { range: { sheetId, startRowIndex:2, endRowIndex:1000, startColumnIndex:10, endColumnIndex:11 },
          rule: { condition: { type:'ONE_OF_LIST', values:['Year-round','Spring','Summer','Fall','Winter','Spring/Summer','Summer/Fall','Fall/Winter'].map(v=>({userEnteredValue:v}))}, showCustomUi:true, strict:false }}},
      { setDataValidation: { range: { sheetId, startRowIndex:2, endRowIndex:1000, startColumnIndex:4, endColumnIndex:5 },
          rule: { condition: { type:'ONE_OF_LIST', values:[0,1,2,3,4,5].map(v=>({userEnteredValue:String(v)}))}, showCustomUi:true, strict:false }}},
      { setDataValidation: { range: { sheetId, startRowIndex:2, endRowIndex:1000, startColumnIndex:5, endColumnIndex:6 },
          rule: { condition: { type:'ONE_OF_LIST', values:[0,1,2,3,4,5].map(v=>({userEnteredValue:String(v)}))}, showCustomUi:true, strict:false }}},
      { setDataValidation: { range: { sheetId, startRowIndex:2, endRowIndex:1000, startColumnIndex:12, endColumnIndex:13 },
          rule: { condition: { type:'ONE_OF_LIST', values:[{userEnteredValue:'Yes'},{userEnteredValue:'No'}]}, showCustomUi:true, strict:false }}},
      ...[['Planning',{red:0.18,green:0.80,blue:0.44}],["Don't Skip",{red:0.91,green:0.30,blue:0.24}],['Booked',{red:0.13,green:0.55,blue:0.13}],['Maybe',{red:0.95,green:0.77,blue:0.06}]]
        .map(([status,bg]) => ({ addConditionalFormatRule: { rule: { ranges:[{sheetId,startRowIndex:2,endRowIndex:1000,startColumnIndex:8,endColumnIndex:9}], booleanRule:{ condition:{type:'TEXT_EQ',values:[{userEnteredValue:status}]}, format:{backgroundColor:bg} }}, index:0 }}))
    ];
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: formatRequests } });
    existingSheets.push(tabName);
    created.push(tabName);
  }
  return { success: true, created };
});


exports.getSpreadsheetId=fn(async()=>SPREADSHEET_ID);

// ═══ SETTINGS MANAGEMENT ═══════════════════════════════
const DEFAULT_SETTINGS = {
  categories: ['Bizarre','Nature','Restaurant','Museum','Historic','Festival','Aviation','Ghost Town','Entertainment/sports','Naturist Resort','Swingers Club','Hotel','Theme Park','Brewery/Distillery','Scenic Route'],
  statusValues: ['Planning',"Don't Skip",'Booked','Maybe'],
  seasonValues: ['Year-round','Spring','Summer','Fall','Winter','Spring/Summer','Summer/Fall','Fall/Winter']
};
exports.getSettings = functions.region('europe-west1').https.onCall(async (data,context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const doc = await admin.firestore().collection('config').doc('appSettings').get();
  if (!doc.exists) { await admin.firestore().collection('config').doc('appSettings').set(DEFAULT_SETTINGS); return DEFAULT_SETTINGS; }
  return doc.data();
});
exports.saveSettings = functions.region('europe-west1').https.onCall(async (data,context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const { type, values } = data;
  if (!type || !Array.isArray(values)) throw new functions.https.HttpsError('invalid-argument','type and values required');
  const COLUMN_MAP = { categories:7, statusValues:8, seasonValues:10 };
  const colIndex = COLUMN_MAP[type];
  if (colIndex===undefined) throw new functions.https.HttpsError('invalid-argument','Unknown type: '+type);
  await admin.firestore().collection('config').doc('appSettings').set({[type]:values},{merge:true});
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({keyFile:'./service-account-key.json',scopes:['https://www.googleapis.com/auth/spreadsheets']});
  const sheets = google.sheets({version:'v4',auth:await auth.getClient()});
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID||'1DvyWFEdmAceaRJ7oHYTA7VyqQLNcyFHLChBw2i08GgA';
  const meta = await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:'sheets.properties'});
  const requests = meta.data.sheets.map(s=>({setDataValidation:{range:{sheetId:s.properties.sheetId,startRowIndex:2,endRowIndex:1000,startColumnIndex:colIndex,endColumnIndex:colIndex+1},rule:{condition:{type:'ONE_OF_LIST',values:values.map(v=>({userEnteredValue:v}))},showCustomUi:true,strict:false}}}));
  await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests}});
  return {success:true};
});
exports.renameSettingValue = functions.region('europe-west1').https.onCall(async (data,context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const { type, oldValue, newValue } = data;
  if (!type||!oldValue||!newValue) throw new functions.https.HttpsError('invalid-argument','type, oldValue and newValue required');
  const COLUMN_MAP = { categories:7, statusValues:8, seasonValues:10 };
  const colIndex = COLUMN_MAP[type];
  if (colIndex===undefined) throw new functions.https.HttpsError('invalid-argument','Unknown type: '+type);
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({keyFile:'./service-account-key.json',scopes:['https://www.googleapis.com/auth/spreadsheets']});
  const sheets = google.sheets({version:'v4',auth:await auth.getClient()});
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID||'1DvyWFEdmAceaRJ7oHYTA7VyqQLNcyFHLChBw2i08GgA';
  const meta = await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:'sheets.properties'});
  const allSheets = meta.data.sheets.map(s=>({id:s.properties.sheetId}));
  await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests:allSheets.map(s=>({findReplace:{find:oldValue,replacement:newValue,matchCase:true,matchEntireCell:true,range:{sheetId:s.id,startRowIndex:2,startColumnIndex:colIndex,endColumnIndex:colIndex+1}}}))}});
  const doc = await admin.firestore().collection('config').doc('appSettings').get();
  const arr = (doc.exists?doc.data()[type]:DEFAULT_SETTINGS[type])||[];
  const idx = arr.indexOf(oldValue); if (idx!==-1) arr[idx]=newValue;
  await admin.firestore().collection('config').doc('appSettings').set({[type]:arr},{merge:true});
  await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests:allSheets.map(s=>({setDataValidation:{range:{sheetId:s.id,startRowIndex:2,endRowIndex:1000,startColumnIndex:colIndex,endColumnIndex:colIndex+1},rule:{condition:{type:'ONE_OF_LIST',values:arr.map(v=>({userEnteredValue:v}))},showCustomUi:true,strict:false}}}))}});
  return {success:true,updatedValues:arr};
});

// ═══ TRIP MANAGEMENT ═══════════════════════════════════
exports.getTrips = functions.region('europe-west1').https.onCall(async (data,context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const snap = await admin.firestore().collection('trips').orderBy('createdAt','asc').get();
  return { trips: snap.docs.map(d=>({id:d.id,name:d.data().name,archived:!!d.data().archived})) };
});
exports.createTrip = functions.region('europe-west1').https.onCall(async (data,context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const name = (data.name||'New Trip').trim();
  if (!name) throw new functions.https.HttpsError('invalid-argument','Name cannot be empty');
  const ref = await admin.firestore().collection('trips').add({name,createdAt:admin.firestore.FieldValue.serverTimestamp()});
  return {success:true,tripId:ref.id,name};
});
exports.renameTrip = functions.region('europe-west1').https.onCall(async (data,context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const {tripId,name} = data;
  if (!tripId||!name||!name.trim()) throw new functions.https.HttpsError('invalid-argument','tripId and name required');
  await admin.firestore().collection('trips').doc(tripId).update({name:name.trim()});
  return {success:true};
});
const GPLACES_KEY=process.env.GPLACES_KEY||'';
exports.fsGoogleRating = functions.region('europe-west1').https.onCall(async (data,context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const d=data||{};
  const q=[d.name,d.address].filter(Boolean).join(', ');
  if(!q) return {success:false,message:'no query'};
  let url='https://maps.googleapis.com/maps/api/place/textsearch/json?query='+encodeURIComponent(q)+'&key='+GPLACES_KEY;
  if(d.lat&&d.lng) url+='&location='+d.lat+','+d.lng+'&radius=20000';
  const res=await fetch(url);
  const j=await res.json();
  const r=(j&&j.results&&j.results[0])||null;
  if(!r||typeof r.rating!=='number') return {success:false,message:'not found'};
  const rating=r.rating, reviews=r.user_ratings_total||0;
  if(d.state&&d.rowIndex){
    try{
      await admin.firestore().collection('locations').doc(String(d.state).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''))
        .collection('items').doc(String(d.rowIndex))
        .update({googleRating:rating,googleReviews:reviews,googleRatingAt:Date.now()});
    }catch(e){}
  }
  return {success:true,rating:rating,reviews:reviews};
});
exports.archiveTrip = functions.region('europe-west1').https.onCall(async (data,context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const {tripId,archived} = data||{};
  if (!tripId) throw new functions.https.HttpsError('invalid-argument','tripId required');
  await admin.firestore().collection('trips').doc(tripId).update({archived:archived===true});
  return {success:true};
});
exports.deleteTrip = functions.region('europe-west1').https.onCall(async (data,context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const {tripId} = data;
  if (!tripId) throw new functions.https.HttpsError('invalid-argument','tripId required');
  const db = admin.firestore();
  const tripRef = db.collection('trips').doc(tripId);
  let segsSnap = await tripRef.collection('segments').get();
  while (!segsSnap.empty) {
    const batch = db.batch();
    segsSnap.docs.forEach(doc=>batch.delete(doc.ref));
    await batch.commit();
    segsSnap = await tripRef.collection('segments').get();
  }
  await tripRef.delete();
  return {success:true};
});

// ═══ STOP DATES (Phase B) ═══════════════════════════════
exports.saveStopDates = functions.region('europe-west1').https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const { segId, stopDates } = data;
  if (!segId) throw new functions.https.HttpsError('invalid-argument','segId required');
  const tripId = data.tripId || 'roadtrip-2027';
  await admin.firestore().collection('trips').doc(tripId).collection('segments').doc(segId)
    .set({ stopDates: stopDates || {} }, { merge: true });
  return { success: true };
});

exports.loadTripStopDates = functions.region('europe-west1').https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const tripId = data.tripId || 'roadtrip-2027';
  const snap = await admin.firestore().collection('trips').doc(tripId).collection('segments').get();
  const result = {};
  snap.docs.forEach(doc => {
    const d = doc.data();
    if (d.stopDates) result[doc.id] = d.stopDates;
  });
  return { stopDates: result };
});

/* ============================================================
   F0 — FIRESTORE MODE (v82) — appended by f0_functions script
   Per-state locations in Firestore: locations/{slug}/items/{id}
   Travellers config: appSettings/travellers  { names:[...] }
   ============================================================ */
const FSDB = admin.firestore();
function t69slug(n){return String(n||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function fsLocOut(doc){const d=doc.data()||{};return{
  name:d.name||'',website:d.website||'N/A',mapsUrl:d.mapsUrl||'',address:d.address||'',
  ratings:d.ratings||{},category:d.category||'',status:d.status||'Planning',
  budget:(typeof d.budget==='number')?d.budget:0,season:d.season||'Year-round',
  notes:d.notes||'',reservation:d.reservation||'No',pinned:!!d.pinned,
  lat:(typeof d.lat==='number')?d.lat:null,lng:(typeof d.lng==='number')?d.lng:null,
  state:d.state||'',googleRating:(typeof d.googleRating==='number')?d.googleRating:null,googleReviews:(typeof d.googleReviews==='number')?d.googleReviews:0,rowIndex:doc.id,id:doc.id};}
async function fsStateNames(){const snap=await FSDB.collection('locations').get();return snap.docs.map(x=>(x.data()||{}).name).filter(Boolean);}

exports.fsGetStates=fn(async()=>{const names=await fsStateNames();const set=new Set(names);return ALL_STATES.filter(s=>set.has(s));});
exports.fsGetRegionTree=fn(async()=>{const snap=await FSDB.collection('locations').get();const out=[];snap.forEach(d=>{const v=d.data()||{};const nm=v.name||d.id;const tp=US_STATES.includes(nm)?'us':(CA_PROVINCES.includes(nm)?'ca':'other');let ctry=v.country||'';if(tp==='us')ctry='United States';else if(tp==='ca')ctry='Canada';else if(!ctry||ctry==='USA'||ctry==='Canada')ctry=nm;out.push({name:nm,country:ctry,type:tp});});out.sort((a,b)=>a.country===b.country?a.name.localeCompare(b.name):a.country.localeCompare(b.country));return{success:true,regions:out};});
exports.fsRenameRegion=fn(async(data)=>{const from=((data&&data.from)||'').trim(),to=((data&&data.to)||'').trim();if(!from||!to)return{success:false,message:'Missing name'};const src=FSDB.collection('locations').doc(t69slug(from));const srcDoc=await src.get();if(!srcDoc.exists)return{success:false,message:'Region not found'};const dstRef=FSDB.collection('locations').doc(t69slug(to));const dstDoc=await dstRef.get();if(dstDoc.exists&&t69slug(to)!==t69slug(from))return{success:false,message:'\"'+to+'\" already exists'};const base=srcDoc.data()||{};if(t69slug(to)===t69slug(from)){await src.update({name:to});return{success:true,moved:0};}await dstRef.set(Object.assign({},base,{name:to}));let moved=0;let snap=await src.collection('items').get();while(!snap.empty){const batch=FSDB.batch();snap.docs.forEach(d=>{batch.set(dstRef.collection('items').doc(d.id),Object.assign({},d.data(),{state:to}));batch.delete(d.ref);moved++;});await batch.commit();snap=await src.collection('items').get();}await src.delete();return{success:true,moved:moved};});
exports.fsSetRegionCountry=fn(async(data)=>{const region=((data&&data.region)||'').trim(),country=((data&&data.country)||'').trim();if(!region||!country)return{success:false,message:'Missing region or country'};await FSDB.collection('locations').doc(t69slug(region)).set({country:country},{merge:true});return{success:true};});
exports.fsGetOtherCountryTabs=fn(async()=>{const names=await fsStateNames();return names.filter(n=>!US_STATES.includes(n)&&!CA_PROVINCES.includes(n)).sort();});
exports.fsGetStateData=fn(async(stateName)=>{if(!stateName)return{error:'No state provided',locations:[]};const ref=FSDB.collection('locations').doc(t69slug(stateName));const doc=await ref.get();if(!doc.exists)return{state:stateName,totalLocations:0,locations:[]};const items=await ref.collection('items').orderBy('name').get();const locs=items.docs.map(fsLocOut);return{state:stateName,totalLocations:locs.length,locations:locs};});
exports.fsGetMultiStateData=fn(async(stateNames)=>{if(!Array.isArray(stateNames)||!stateNames.length)return{locations:[],stateCount:0,totalCount:0};const all=[];for(const s of stateNames){const ref=FSDB.collection('locations').doc(t69slug(s));const items=await ref.collection('items').get();items.docs.forEach(d=>{const o=fsLocOut(d);o.state=s;all.push(o);});}return{locations:all,stateCount:stateNames.length,totalCount:all.length};});
exports.fsGetAllPinnedLocations=fn(async()=>{const states=await FSDB.collection('locations').get();const results=await Promise.all(states.docs.map(d=>d.ref.collection('items').where('pinned','==',true).get()));const pinned=[];results.forEach(snap=>snap.docs.forEach(x=>pinned.push(fsLocOut(x))));return{success:true,pinned,count:pinned.length};});
exports.fsGetNearbyLocations=fn(async(data)=>{const{lat,lng,radiusKm}=data||{};if(!lat||!lng||!radiusKm)return[];const snap=await FSDB.collectionGroup('items').get();const R=6371,out=[];snap.docs.forEach(d=>{const o=fsLocOut(d);if(o.lat===null||o.lng===null)return;const dLat=(o.lat-lat)*Math.PI/180,dLng=(o.lng-lng)*Math.PI/180;const a=Math.sin(dLat/2)**2+Math.cos(lat*Math.PI/180)*Math.cos(o.lat*Math.PI/180)*Math.sin(dLng/2)**2;const dist=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));if(dist<=radiusKm)out.push({name:o.name,state:o.state,lat:o.lat,lng:o.lng,category:o.category,status:o.status,budget:o.budget,notes:o.notes,rowIndex:o.id,dist:Math.round(dist*10)/10});});out.sort((a,b)=>a.dist-b.dist);return out.slice(0,100);});
exports.fsSetPinnedState=fn(async(data)=>{const{stateName,rowIndex,pinned}=data||{};if(!stateName||!rowIndex)return{success:false,message:'Missing state or id'};await FSDB.collection('locations').doc(t69slug(stateName)).collection('items').doc(String(rowIndex)).update({pinned:!!pinned});return{success:true};});
exports.fsUpdateLocationField=fn(async(data)=>{const d=data||{};const state=d.state;const rowIndex=d.rowIndex||d.id;const field=d.field;let value=d.value;if(!state||!rowIndex)return{success:false,message:'Missing state or id'};const OK=['status','category','season','reservation','notes','budget','lat','lng','pinned'];if(OK.indexOf(field)<0)return{success:false,message:'Unknown field: '+field};if(field==='lat'||field==='lng'||field==='budget')value=Number(value);if(field==='pinned')value=(value===true||value==='true');const p={};p[field]=value;await FSDB.collection('locations').doc(t69slug(state)).collection('items').doc(String(rowIndex)).update(p);return{success:true};});
const FS_SAVE_KEYS=new Set(['name','website','mapsUrl','address','category','status','budget','season','notes','reservation','pinned','lat','lng','ratings']);
exports.fsSaveLocation=fn(async(data)=>{const{state,id,patch}=data||{};if(!state||!id||!patch)return{success:false,message:'Missing state, id or patch'};const clean={};Object.keys(patch).forEach(k=>{if(FS_SAVE_KEYS.has(k))clean[k]=patch[k];});if(clean.budget!==undefined)clean.budget=parseFloat(clean.budget)||0;if(clean.lat!==undefined)clean.lat=(clean.lat===null)?null:parseFloat(clean.lat);if(clean.lng!==undefined)clean.lng=(clean.lng===null)?null:parseFloat(clean.lng);if(clean.ratings!==undefined){const r={};Object.keys(clean.ratings||{}).forEach(n=>{const v=parseFloat(clean.ratings[n]);if(!isNaN(v)&&v>0)r[n]=Math.min(5,v);});clean.ratings=r;}if(!Object.keys(clean).length)return{success:false,message:'Nothing to save'};await FSDB.collection('locations').doc(t69slug(state)).collection('items').doc(String(id)).update(clean);return{success:true};});
exports.fsAddLocation=fn(async(data)=>{if(!data||!data.state||!data.naam)return{success:false,message:'Missing state or name'};const stRef=FSDB.collection('locations').doc(t69slug(data.state));const stDoc=await stRef.get();if(!stDoc.exists){const tp=US_STATES.includes(data.state)?'us':(CA_PROVINCES.includes(data.state)?'ca':'other');await stRef.set({name:data.state,country:tp==='us'?'USA':(tp==='ca'?'Canada':data.state),type:tp,createdAt:admin.firestore.FieldValue.serverTimestamp()});}
  const item={name:data.naam,website:data.website||'N/A',mapsUrl:data.mapsUrl||'',address:data.adres||'',ratings:{},category:data.category||'Bizarre',status:data.status||'Planning',budget:parseFloat(data.budget)||0,season:data.season||'Year-round',notes:data.notes||'',reservation:data.reservation||'No',pinned:false,lat:(data.lat===''||data.lat===undefined||data.lat===null)?null:parseFloat(data.lat),lng:(data.lng===''||data.lng===undefined||data.lng===null)?null:parseFloat(data.lng),state:data.state,createdAt:admin.firestore.FieldValue.serverTimestamp()};
  if(isNaN(item.lat))item.lat=null;if(isNaN(item.lng))item.lng=null;
  const ref=await stRef.collection('items').add(item);return{success:true,message:'"'+data.naam+'" added to '+data.state+' (Firestore)',rowIndex:ref.id};});
exports.fsDeleteLocation=fn(async(data)=>{const{state,id}=data||{};if(!state||!id)return{success:false,message:'Missing state or id'};await FSDB.collection('locations').doc(t69slug(state)).collection('items').doc(String(id)).delete();return{success:true};});
exports.fsCreateCountry=fn(async(data)=>{const country=((data&&data.country)||'').trim();if(!country)return{success:false,message:'No country name'};const regions=(data.regions&&data.regions.length)?data.regions:[country];let made=0;for(const r of regions){const ref=FSDB.collection('locations').doc(t69slug(r));const doc=await ref.get();if(doc.exists)continue;const tp=US_STATES.includes(r)?'us':(CA_PROVINCES.includes(r)?'ca':'other');await ref.set({name:r,country:tp==='us'?'USA':(tp==='ca'?'Canada':country),type:tp,createdAt:admin.firestore.FieldValue.serverTimestamp()});made++;}return{success:true,message:made+' region(s) created in Firestore'};});

exports.getTravellers=fn(async()=>{const ref=FSDB.collection('appSettings').doc('travellers');const doc=await ref.get();if(!doc.exists){await ref.set({names:['Els','Serge']});return{names:['Els','Serge']};}const n=(doc.data()||{}).names;return{names:(Array.isArray(n)&&n.length)?n:['Els','Serge']};});
exports.saveTravellers=fn(async(data)=>{let names=(data&&data.names)||[];if(!Array.isArray(names))return{success:false,message:'Invalid names'};names=names.map(n=>String(n||'').trim()).filter(Boolean);names=[...new Set(names)];if(names.length<1||names.length>6)return{success:false,message:'Between 1 and 6 travellers required'};await FSDB.collection('appSettings').doc('travellers').set({names});return{success:true,names};});
exports.renameTraveller=fn(async(data)=>{const from=String((data&&data.from)||'').trim(),to=String((data&&data.to)||'').trim();if(!from||!to||from===to)return{success:false,message:'Invalid rename'};const ref=FSDB.collection('appSettings').doc('travellers');const doc=await ref.get();let names=doc.exists?((doc.data()||{}).names||[]):['Els','Serge'];if(!names.includes(from))return{success:false,message:'"'+from+'" not found'};if(names.includes(to))return{success:false,message:'"'+to+'" already exists'};names=names.map(n=>n===from?to:n);await ref.set({names});
  const snap=await FSDB.collectionGroup('items').get();let batch=FSDB.batch(),ops=0,swept=0;for(const d of snap.docs){const r=(d.data()||{}).ratings;if(r&&r[from]!==undefined){const nr=Object.assign({},r);nr[to]=nr[from];delete nr[from];batch.update(d.ref,{ratings:nr});ops++;swept++;if(ops>=400){await batch.commit();batch=FSDB.batch();ops=0;}}}
  if(ops>0)await batch.commit();return{success:true,names,swept};});

exports.seedMexico=fn(async()=>{const stRef=FSDB.collection('locations').doc('mexico');const existing=await stRef.collection('items').limit(1).get();if(!existing.empty)return{success:false,message:'Mexico already seeded — delete it first if you want a fresh seed'};
  await stRef.set({name:'Mexico',country:'Mexico',type:'other',createdAt:admin.firestore.FieldValue.serverTimestamp()});
  const rows=[
   {name:'Isla de las Muñecas (Island of the Dolls)',website:'N/A',address:'Xochimilco canals, Ciudad de México',ratings:{Els:4,Serge:5},category:'Bizarre',status:'Planning',budget:35,season:'Year-round',notes:'Honderden verminkte poppen in de bomen — creepiest boottocht van Noord-Amerika. Trajinera huren in Embarcadero Cuemanco. 🎎',reservation:'No',pinned:true,lat:19.2911,lng:-99.0958},
   {name:'Museo de las Momias',website:'https://www.momiasdeguanajuato.gob.mx',address:'Explanada del Panteón Municipal, Guanajuato',ratings:{Els:3,Serge:5},category:'Museum',status:'Planning',budget:6,season:'Year-round',notes:'Natuurlijk gemummificeerde lichamen — bizarre Belgische kelder-vibes maar dan écht.',reservation:'No',pinned:false,lat:21.0225,lng:-101.2652},
   {name:'Cenote Ik Kil',website:'N/A',address:'Carretera Mérida-Valladolid km 122, Yucatán',ratings:{Els:5,Serge:4},category:'Nature',status:"Don't Skip",budget:10,season:'Year-round',notes:'Iconische open cenote, 26m diep zwemgat met lianen. Vroeg komen = geen bussen.',reservation:'No',pinned:true,lat:20.6633,lng:-88.5678},
   {name:'Teotihuacán — Pirámide del Sol',website:'N/A',address:'San Juan Teotihuacán, Estado de México',ratings:{Els:5,Serge:5,Guest:4},category:'Historic',status:"Don't Skip",budget:5,season:'Year-round',notes:'Grootste piramidestad van de Amerika\u2019s. Combineren met ballonvaart bij zonsopgang.',reservation:'No',pinned:false,lat:19.6925,lng:-98.8439},
   {name:'Hierve el Agua',website:'N/A',address:'San Lorenzo Albarradas, Oaxaca, Mexico',ratings:{},category:'Nature',status:'Planning',budget:3,season:'Nov-Apr',notes:'Versteende watervallen + infinity-poel op een klif. GEEN coords — geocode-test!',reservation:'No',pinned:false,lat:null,lng:null},
   {name:'Café de Tacuba',website:'https://www.cafedetacuba.com.mx',address:'Tacuba 28, Centro Histórico, Ciudad de México',ratings:{Serge:4},category:'Restaurant',status:'Planning',budget:25,season:'Year-round',notes:'Sinds 1912 — azulejos, enchiladas en mariachi. Betere churros dan de Brusselse wafel? Te testen.',reservation:'No',pinned:false,lat:null,lng:null},
   {name:'Hotel California',website:'https://www.hotelcaliforniabaja.com',address:'Calle Benito Juárez, Todos Santos, Baja California Sur',ratings:{},category:'Hotel',status:'Maybe',budget:140,season:'Year-round',notes:'"Such a lovely place" — niks met de Eagles te maken, maar de margarita\u2019s zijn top. GEEN coords.',reservation:'Yes',pinned:false,lat:null,lng:null},
   {name:'Las Pozas — Edward James Surrealist Garden',website:'https://laspozasxilitla.org.mx',address:'Camino Paseo Las Pozas, Xilitla, San Luis Potosí',ratings:{Els:5},category:'Bizarre',status:"Don't Skip",budget:18,season:'Year-round',notes:'Surrealistische betonnen droomwereld in de jungle, gebouwd door een excentrieke Britse miljonair die bevriend was met Dalí en Magritte — ja, ónze Magritte. Trappen naar nergens, deuren naar de hemel, orchideeën overal. Reken minimum een halve dag, stevige schoenen, en neem de gids: de verhalen zijn de helft van de ervaring. Dit is exact het soort plek waarvoor Travellers 1969 bestaat.',reservation:'Yes',pinned:true,lat:21.3969,lng:-98.995},
   {name:'Chichén Itzá',website:'N/A',address:'Tinum, Yucatán',ratings:{Els:4,Serge:4},category:'Historic',status:'Planning',budget:30,season:'Year-round',notes:'El Castillo + het beroemde slangenschaduw-effect bij equinox.',reservation:'No',pinned:false,lat:20.6843,lng:-88.5678},
   {name:'Lucha Libre @ Arena México',website:'https://www.cmll.com',address:'Dr. Lavista 189, Ciudad de México',ratings:{Els:5},category:'Entertainment/sports',status:'Planning',budget:15,season:'Year-round',notes:'Gemaskerde worstelaars, vliegende lijven, bier in liters. Dinsdag/vrijdag avond.',reservation:'No',pinned:false,lat:19.4192,lng:-99.1524},
   {name:'Xcaret Park',website:'https://www.xcaret.com',address:'Carretera Chetumal-Puerto Juárez km 282, Playa del Carmen',ratings:{Serge:3},category:'Theme Park',status:'Maybe',budget:130,season:'Year-round',notes:'Eco-themapark: ondergrondse rivieren, Maya-show. Duur maar volledig dagvullend.',reservation:'Yes',pinned:false,lat:20.5794,lng:-87.12},
   {name:'Laguna de Bacalar',website:'N/A',address:'Bacalar, Quintana Roo',ratings:{},category:'Nature',status:'Planning',budget:0,season:'Year-round',notes:'Lagune van zeven kleuren blauw. Gratis, stil, en mooier dan de Malediven-brochures.',reservation:'No',pinned:false,lat:18.6769,lng:-88.3953},
   {name:'La Rojeña — Jose Cuervo Distillery',website:'https://mundocuervo.com',address:'Calle José Cuervo 33, Tequila, Jalisco, Mexico',ratings:{},category:'Brewery/Distillery',status:'Planning',budget:40,season:'Year-round',notes:'Oudste distilleerderij van Latijns-Amerika (1795), in het stadje Tequila zelf. GEEN coords — geocode-test.',reservation:'Yes',pinned:false,lat:null,lng:null},
   {name:'Playa Zipolite',website:'N/A',address:'Zipolite, Oaxaca',ratings:{Els:4,Serge:4},category:'Naturist Resort',status:'Planning',budget:0,season:'Nov-Apr',notes:'Enige officiële naaktstrand van Mexico 🏖️😎 — relaxte hippie-vibe, wél straffe stroming: enkel zwemmen waar aangegeven.',reservation:'No',pinned:false,lat:15.6608,lng:-96.5225},
   {name:'Ballonvaart boven Teotihuacán',website:'https://www.volarenglobo.com.mx',address:'San Martín de las Pirámides, Estado de México, Mexico',ratings:{},category:'Aviation',status:'Maybe',budget:110,season:'Year-round',notes:'Zonsopgang boven de piramides vanuit een luchtballon. GEEN coords — geocode-test.',reservation:'Yes',pinned:false,lat:null,lng:null}
  ];
  let batch=FSDB.batch();rows.forEach(r=>{r.state='Mexico';r.createdAt=admin.firestore.FieldValue.serverTimestamp();batch.set(stRef.collection('items').doc(),r);});await batch.commit();
  return{success:true,message:'Mexico seeded with '+rows.length+' locations ('+rows.filter(r=>r.lat===null).length+' without coordinates for the geocode test)'};});

/* ===== F1 (v89): Sheet -> Firestore full import ===== */
exports.listSheetTabs=fn(async()=>{const sheets=getSheets();const res=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:'sheets.properties.title'});const names=res.data.sheets.map(s=>s.properties.title);const states=ALL_STATES.filter(s=>names.includes(s));const other=names.filter(n=>!US_STATES.includes(n)&&!CA_PROVINCES.includes(n)&&!SKIP_TABS.includes(n));return{tabs:states.concat(other)};});
exports.importSheetTab=fn(async(data)=>{const tab=((data&&data.tab)||'').trim();if(!tab)return{success:false,message:'No tab'};
 const sheets=getSheets();
 const res=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`'${tab}'!A:P`});
 const locs=parseSheetRows(res.data.values||[]);
 const stRef=FSDB.collection('locations').doc(t69slug(tab));
 let wiped=0;for(;;){const snap=await stRef.collection('items').limit(400).get();if(snap.empty)break;const b=FSDB.batch();snap.docs.forEach(d=>b.delete(d.ref));await b.commit();wiped+=snap.size;}
 const tp=US_STATES.includes(tab)?'us':(CA_PROVINCES.includes(tab)?'ca':'other');
 await stRef.set({name:tab,country:tp==='us'?'USA':(tp==='ca'?'Canada':tab),type:tp,importedAt:admin.firestore.FieldValue.serverTimestamp()});
 let batch=FSDB.batch(),ops=0,written=0;
 for(const l of locs){const ratings={};if(l.elsRating)ratings['Els']=l.elsRating;if(l.sergeRating)ratings['Serge']=l.sergeRating;
  const item={name:l.name,website:l.website||'N/A',mapsUrl:l.mapsUrl||'',address:l.address||'',ratings,category:l.category,status:l.status||'Planning',budget:l.budget||0,season:l.season||'Year-round',notes:l.notes||'',reservation:l.reservation||'No',pinned:!!l.pinned,lat:(typeof l.lat==='number')?l.lat:null,lng:(typeof l.lng==='number')?l.lng:null,state:tab,createdAt:admin.firestore.FieldValue.serverTimestamp()};
  batch.set(stRef.collection('items').doc(),item);ops++;written++;
  if(ops>=400){await batch.commit();batch=FSDB.batch();ops=0;}}
 if(ops>0)await batch.commit();
 return{success:true,tab,sheetLocations:locs.length,written,wiped};});

/* ===== Wave B (v95): duplicate scan · ensureSheet · settings extras ===== */
exports.fsScanDuplicates=fn(async(data)=>{
 const opt=data||{};const useMaps=opt.maps!==false,useWeb=opt.web!==false,useAddr=opt.addr!==false;
 const scope=String(opt.scope||'all');
 const cfg=await FSDB.collection('config').doc('appSettings').get();
 const ignored=(cfg.exists&&Array.isArray(cfg.data().ignoredDupKeys))?cfg.data().ignoredDupKeys:[];
 const states=await FSDB.collection('locations').get();
 let docs=states.docs;
 if(scope.indexOf('country:')===0){const t=scope.slice(8).toLowerCase();docs=docs.filter(d=>String(d.data().country||'').toLowerCase()===t);}
 else if(scope.indexOf('state:')===0){const n=scope.slice(6).toLowerCase();docs=docs.filter(d=>String(d.data().name||d.id).toLowerCase()===n);}
 const all=[];
 for(const d of docs){const items=await d.ref.collection('items').get();items.docs.forEach(x=>{const v=x.data();all.push({id:x.id,state:(d.data().name)||d.id,name:v.name||'',category:v.category||'',mapsUrl:v.mapsUrl||'',website:v.website||'',address:v.address||''});});}
 const norm=u=>String(u||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/+$/,'');
 const naddr=a=>String(a||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const groups={};
 function add(key,item,raw){if(!key)return;(groups[key]=groups[key]||{items:[],value:raw}).items.push(item);}
 all.forEach(it=>{
  if(useMaps&&it.mapsUrl)add('m:'+norm(it.mapsUrl),it,it.mapsUrl);
  if(useWeb&&it.website&&it.website!=='N/A')add('w:'+norm(it.website),it,it.website);
  if(useAddr&&it.address&&naddr(it.address).length>8)add('a:'+naddr(it.address),it,it.address);
 });
 const seen={},out=[];
 Object.keys(groups).forEach(k=>{const g=groups[k];if(g.items.length<2)return;if(ignored.indexOf(k)>=0)return;
  const sig=g.items.map(x=>x.state+'/'+x.id).sort().join('|');if(seen[sig])return;seen[sig]=1;
  out.push({key:k,type:k[0]==='m'?'Maps link':(k[0]==='w'?'Website':'Address'),value:g.value,items:g.items});});
 return{success:true,groups:out,scanned:all.length,duplicateGroups:out.length};});

exports.ensureSheet=fn(async()=>{
 try{const sheets=getSheets();const res=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID,fields:'properties.title'});
  return{success:true,sheetId:SPREADSHEET_ID,title:res.data.properties.title,created:false};}
 catch(e){return{success:false,message:String(e.message||e)};}});

exports.saveSettingExtra=fn(async(data)=>{const d=data||{};const upd={};
 if(d.categoryColors&&typeof d.categoryColors==='object')upd.categoryColors=d.categoryColors;
 if(Array.isArray(d.hiddenCategories))upd.hiddenCategories=d.hiddenCategories;
 if(d.birthdays&&typeof d.birthdays==='object')upd.birthdays=d.birthdays;
 if(typeof d.addIgnoredDupKey==='string'&&d.addIgnoredDupKey){upd.ignoredDupKeys=admin.firestore.FieldValue.arrayUnion(d.addIgnoredDupKey);}
 if(!Object.keys(upd).length)return{success:false,message:'nothing to save'};
 await FSDB.collection('config').doc('appSettings').set(upd,{merge:true});return{success:true};});

/* ===== Wave D (v98): Sheet round-trip for a single state/country ===== */
exports.exportStateToSheetTab=fn(async(data)=>{
 const tab=((data&&data.state)||'').trim();if(!tab)return{success:false,message:'No state'};
 const sheets=getSheets();
 const stRef=admin.firestore().collection('locations').doc(t69slug(tab));
 const snap=await stRef.collection('items').get();
 const items=snap.docs.map(d=>{const v=d.data();
   var els='',serge='';if(v.ratings){els=(v.ratings.Els!=null?v.ratings.Els:'');serge=(v.ratings.Serge!=null?v.ratings.Serge:'');}
   return [v.name||'',v.website||'N/A',v.mapsUrl||'',v.address||'',els,serge,'',v.category||'',v.status||'Planning',(v.budget!=null?v.budget:0),v.season||'Year-round',v.notes||'',v.reservation||'No',(v.lat!=null?v.lat:''),(v.lng!=null?v.lng:''),v.pinned?'Yes':'No'];});
 let exists=true;
 try{await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`'${tab}'!A1:A1`});}catch(e){exists=false;}
 if(!exists){await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests:[{addSheet:{properties:{title:tab}}}]}});}
 await sheets.spreadsheets.values.clear({spreadsheetId:SPREADSHEET_ID,range:`'${tab}'!A3:P100000`});
 const header=[[tab.toUpperCase(),...Array(15).fill('')],['Naam','Link','Maps','Adres','Els','Serge','Avg','Category','Status','Budget','Season','Opmerkingen','Reservation','Latitude (X)','Longitude (Y)','Pinned']];
 const rows=items.map((row,idx)=>{const r=idx+3;row[6]=`=IF(AND(E${r}<>"";F${r}<>"");REPT("⭐";INT(ROUND((E${r}+F${r})/2;1)))&IF(MOD(ROUND((E${r}+F${r})/2;1);1)>=0,5;"½";"");"")`;return row;});
 await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`'${tab}'!A1:P2`,valueInputOption:'RAW',requestBody:{values:header}});
 if(rows.length)await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`'${tab}'!A3:P${rows.length+2}`,valueInputOption:'USER_ENTERED',requestBody:{values:rows}});
 return{success:true,tab,written:rows.length};});

exports.importStateFromSheetTab=fn(async(data)=>{
 const tab=((data&&data.state)||'').trim();if(!tab)return{success:false,message:'No state'};
 const sheets=getSheets();
 let values;
 try{const res=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`'${tab}'!A:P`});values=res.data.values||[];}
 catch(e){return{success:false,message:'Tab not found: '+tab};}
 const locs=parseSheetRows(values);
 const stRef=admin.firestore().collection('locations').doc(t69slug(tab));
 for(;;){const snap=await stRef.collection('items').limit(400).get();if(snap.empty)break;const b=admin.firestore().batch();snap.docs.forEach(d=>b.delete(d.ref));await b.commit();}
 const tp=US_STATES.includes(tab)?'us':(CA_PROVINCES.includes(tab)?'ca':'other');
 await stRef.set({name:tab,country:tp==='us'?'USA':(tp==='ca'?'Canada':tab),type:tp,importedAt:admin.firestore.FieldValue.serverTimestamp()});
 let batch=admin.firestore().batch(),ops=0,written=0;
 for(const l of locs){const ratings={};if(l.elsRating)ratings['Els']=l.elsRating;if(l.sergeRating)ratings['Serge']=l.sergeRating;
  const item={name:l.name,website:l.website||'N/A',mapsUrl:l.mapsUrl||'',address:l.address||'',ratings,category:l.category,status:l.status||'Planning',budget:l.budget||0,season:l.season||'Year-round',notes:l.notes||'',reservation:l.reservation||'No',pinned:!!l.pinned,lat:(typeof l.lat==='number')?l.lat:null,lng:(typeof l.lng==='number')?l.lng:null,state:tab,createdAt:admin.firestore.FieldValue.serverTimestamp()};
  batch.set(stRef.collection('items').doc(),item);ops++;written++;
  if(ops>=400){await batch.commit();batch=admin.firestore().batch();ops=0;}}
 if(ops>0)await batch.commit();
 return{success:true,tab,written};});
