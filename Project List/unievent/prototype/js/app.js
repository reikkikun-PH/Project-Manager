// UniEvent - Main Logic (js/app.js)
// - Data lives in localStorage (key: unievent_prototype_v1)
// - No backend needed - all demo data is here
// - To reset: call resetData() or clear localStorage
// Sections: Data -> Auth -> Navigation -> Catalog -> Calendar -> Bookings -> Approvals -> Reports
// ---- Data layer (localStorage) ----
const LS_KEY = 'unievent_prototype_v3';
const defaultVenues = [
  {id:'v1', name:'Computer Lab', cap:60, loc:'IT Building 2F', amenities:['Computers 30','Projector','Aircon','Whiteboard'], color:'#f4f4f5', image:''},
  {id:'v2', name:'Gymnasium', cap:800, loc:'PE Building', amenities:['Sound System','Stage','Seating 800','Scoreboard'], color:'#f4f4f5', image:''},
  {id:'v3', name:'Basketball Court', cap:500, loc:'Sports Complex', amenities:['Scoreboard','Sound System','Seating 500','Stage'], color:'#f4f4f5', image:''},
  {id:'v4', name:'Theatre', cap:350, loc:'Arts Building 3F', amenities:['Stage','Lighting','Sound System','Projector'], color:'#f4f4f5', image:''},
  {id:'v5', name:'Library', cap:120, loc:'Library Building 2F', amenities:['Quiet Zone','Whiteboard','Aircon','Projector'], color:'#f4f4f5', image:''},
  {id:'v6', name:'Medical Laboratory', cap:45, loc:'Science Building 1F', amenities:['Lab Equipment','Aircon','Safety Gear','Projector'], color:'#f4f4f5', image:''},
];
const defaultUsers = [
  {name:'Alex Rivera', email:'organizer@university.edu', role:'organizer', org:'Computer Science Society'},
  {name:'Dr. Maria Santos', email:'approver@university.edu', role:'approver', org:'Facilities Office'},
  {name:'Admin Office', email:'admin@university.edu', role:'admin', org:'System Admin'},
];
const defaultBookings = [
  {id:'b1', title:'Freshmen Orientation', venueId:'v4', venueName:'Theatre', date:'2026-09-28', start:'09:00', end:'12:00', attendees:300, org:'OSA', requester:'organizer@university.edu', resources:['Sound System','Stage'], notes:'Need stage setup', status:'Approved'},
  {id:'b2', title:'CS Society Meeting', venueId:'v5', venueName:'Library', date:'2026-09-29', start:'13:00', end:'15:00', attendees:40, org:'CS Society', requester:'organizer@university.edu', resources:['Projector','Whiteboard'], notes:'', status:'Pending'},
  {id:'b3', title:'Basketball Tryouts', venueId:'v3', venueName:'Basketball Court', date:'2026-09-30', start:'16:00', end:'18:00', attendees:60, org:'Sports Club', requester:'organizer@university.edu', resources:['Sound System','Scoreboard'], notes:'', status:'Pending'},
  {id:'b4', title:'Lab Research Defense', venueId:'v1', venueName:'Computer Lab', date:'2026-09-28', start:'10:00', end:'11:30', attendees:25, org:'IT Dept', requester:'organizer@university.edu', resources:['Projector','Computers 30'], notes:'', status:'Rejected'},
];
const defaultNotifs = [
  {id:'n1', title:'Booking Approved', body:'Freshmen Orientation — Theatre on 2026-09-28 approved.', time:'2h ago', unread:true},
  {id:'n2', title:'New request', body:'CS Society Meeting at Library awaiting approval.', time:'5h ago', unread:true},
  {id:'n3', title:'Reminder', body:'Basketball Court booking tomorrow 16:00 — Sports Club.', time:'1d ago', unread:false},
];

function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return {
    venues: JSON.parse(JSON.stringify(defaultVenues)),
    bookings: JSON.parse(JSON.stringify(defaultBookings)),
    notifs: JSON.parse(JSON.stringify(defaultNotifs)),
    users: JSON.parse(JSON.stringify(defaultUsers)),
    org: {name:'Computer Science Society', adviser:'Prof. Dela Cruz', members:45},
    conflictsPrevented: 3
  };
}
let state = loadState();
// auto-migrate: remove stale cache so theme + venues update without manual reset
try{ ['unievent_prototype_v1','unievent_prototype_v2'].forEach(k=>{ if(k!==LS_KEY && localStorage.getItem(k)) localStorage.removeItem(k); }); }catch(e){}
state.bookings.forEach(b=>{
  if(!b.history) b.history = [{status:b.status, by:'system', at: b.date+' '+b.start, note:'Migrated'}];
  if(!b.createdAt) b.createdAt = b.date;
});
// migrate venues to support cover image
state.venues.forEach(v=>{ if(!('image' in v)) v.image=''; if(!v.color) v.color='linear-gradient(135deg,#4c1d95,#7c3aed)'; });
let pendingVenueImage = '';
function previewVenueImage(val){
  const wrap=document.getElementById('fImagePreview');
  const img=document.getElementById('fImagePreviewImg');
  const ph=document.getElementById('fImagePreviewPh');
  if(!wrap||!img||!ph) return;
  wrap.style.display='block';
  if(val && val.trim()){
    pendingVenueImage=val.trim();
    img.src=val.trim(); img.style.display='block'; ph.style.display='none';
    img.onerror=()=>{ img.style.display='none'; ph.style.display='grid'; ph.textContent='⚠️ Image failed to load — check URL'; };
  } else if(pendingVenueImage){
    img.src=pendingVenueImage; img.style.display='block'; ph.style.display='none';
  } else {
    img.style.display='none'; ph.style.display='grid'; ph.textContent='No image — gradient will be used';
  }
}
function saveState(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }

// ---- Load accounts from JSON (data/accounts.json) ----
async function loadAccounts(){
  const candidates = ['data/accounts.json','accounts.json','./data/accounts.json','./accounts.json'];
  for(const url of candidates){
    try{
      const res = await fetch(url, {cache:'no-store'});
      if(!res.ok) continue;
      const data = await res.json();
      const list = data.accounts || data.users || data;
      if(Array.isArray(list) && list.length){
        // normalize: ensure role, email, name, password, org
        state.users = list.map(u=>({
          name: u.name || u.email.split('@')[0],
          email: String(u.email||'').toLowerCase().trim(),
          role: String(u.role||'organizer').toLowerCase().trim(),
          org: u.org || u.organization || '',
          department: u.department || '',
          password: u.password || '',
          avatar: u.avatar || ''
        }));
        saveState();
        renderUsers();
        // refresh login dropdown hints
        console.log('[UniEvent] Loaded', state.users.length, 'accounts from', url);
        return;
      }
    }catch(e){
      // file:// will fail fetch — keep embedded defaults
    }
  }
  console.log('[UniEvent] Using embedded default accounts (fetch not available via file://)');
}
loadAccounts();

function resetData(){
  if(!getPerms(currentUser?.role).canManageSettings && currentUser) return toast('🔒 Only Admin can reset demo data');
  if(!confirm('Reset demo data to default?')) return;
  localStorage.removeItem(LS_KEY);
  state = loadState();
  state.bookings.forEach(b=>{
    if(!b.history) b.history = [{status:b.status, by:'system', at: b.date+' '+b.start, note:'Migrated'}];
    if(!b.createdAt) b.createdAt = b.date;
  });
  toast('Demo data reset');
  renderAll();
  updateNotifs();
}
function clearAllBookings(){
  if(!getPerms(currentUser?.role).canManageSettings && currentUser) return toast('🔒 Only Admin can clear bookings');
  if(!confirm('Clear ALL bookings?')) return;
  state.bookings = [];
  saveState(); renderAll(); toast('All bookings cleared');
}

// ---- Auth ----
let currentUser = null;
function fillDemo(role){
  const acc = state.users.find(u=>u.role===role) || {email: role+'@university.edu', password: role+'123'};
  document.getElementById('loginRole').value = role;
  document.getElementById('loginEmail').value = acc.email;
  const passEl = document.getElementById('loginPass');
  if(passEl) passEl.value = acc.password || (role+'123');
}
function login(){
  const role = document.getElementById('loginRole').value;
  const email = (document.getElementById('loginEmail').value.trim() || (role+'@university.edu')).toLowerCase();
  const pass = document.getElementById('loginPass').value;
  let found = state.users.find(u=>u.email.toLowerCase()===email);
  // allow login even if email not in JSON, but enforce role from selector
  if(!found) found = {name: email.split('@')[0], email, role, org:'', password:''};
  // password check if account has password set
  if(found.password && found.password !== '' && pass !== found.password){
    // allow empty pass in prototype? enforce if JSON has password
    toast('Wrong password for '+email+' — try '+found.password);
    const passEl=document.getElementById('loginPass');
    if(passEl){ passEl.style.borderColor='var(--danger)'; setTimeout(()=>passEl.style.borderColor='',1500); }
    return;
  }
  found.role = role;
  currentUser = found;
  localStorage.setItem('unievent_session', JSON.stringify(currentUser));
  document.getElementById('loginView').style.display='none';
  document.getElementById('appView').style.display='block';
  document.getElementById('userName').textContent = found.name;
  document.getElementById('userEmail').textContent = found.email;
  document.getElementById('roleBadge').textContent = found.role.charAt(0).toUpperCase()+found.role.slice(1);
  document.getElementById('roleBadge').style.background = '#f4f4f5';
  document.getElementById('roleBadge').style.color = '#52525b';
  // update avatar if available
  const avatarImg = document.querySelector('.user-chip img');
  if(avatarImg && found.avatar) avatarImg.src = found.avatar;
  renderAll();
  applyRoleVisibility();
  // force landing to first allowed view if current nav is not allowed
  const activeNav=document.querySelector('.nav-item.active');
  if(activeNav && !canView(found.role, activeNav.dataset.view)) navigate('dashboard');
  toast('Signed in as '+found.role);
}
function logout(){
  localStorage.removeItem('unievent_session');
  location.reload();
}
function applySessionUI(){
  if(!currentUser) return;
  document.getElementById('loginView').style.display='none';
  document.getElementById('appView').style.display='block';
  document.getElementById('userName').textContent = currentUser.name;
  document.getElementById('userEmail').textContent = currentUser.email;
  document.getElementById('roleBadge').textContent = currentUser.role.charAt(0).toUpperCase()+currentUser.role.slice(1);
  document.getElementById('roleBadge').style.background = '#f4f4f5';
  document.getElementById('roleBadge').style.color = '#52525b';
  const avatarImg2=document.querySelector('.user-chip img');
  if(avatarImg2 && currentUser.avatar) avatarImg2.src=currentUser.avatar;
  applyRoleVisibility();
}
(function tryRestore(){
  const sess = localStorage.getItem('unievent_session');
  if(sess){
    try{ currentUser = JSON.parse(sess); }catch(e){}
    if(currentUser){
      applySessionUI();
    }
  }
})();

// ---- Role-based permissions (ADMIN / ORGANIZER / APPROVER) ----
const ROLE_PERMS = {
  organizer: {
    label:'Organizer',
    views:['dashboard','catalog','booking','mybookings','approvals','notifications'], // approvals read-only, no reports/settings
    canApprove:false, canManageVenues:false, canViewReports:false, canManageSettings:false, canExport:false
  },
  approver: {
    label:'Approver',
    views:['dashboard','catalog','booking','mybookings','approvals','notifications','reports'], // no settings
    canApprove:true, canManageVenues:true, canViewReports:true, canManageSettings:false, canExport:true
  },
  admin: {
    label:'Administrator',
    views:['dashboard','catalog','booking','mybookings','approvals','notifications','reports','settings'],
    canApprove:true, canManageVenues:true, canViewReports:true, canManageSettings:true, canExport:true
  }
};
function getPerms(role){ return ROLE_PERMS[role] || ROLE_PERMS.organizer; }
function canView(role, view){ return getPerms(role).views.includes(view); }
function applyRoleVisibility(){
  if(!currentUser) return;
  const role=currentUser.role;
  const perms=getPerms(role);
  document.querySelectorAll('.nav-item').forEach(el=>{
    const v=el.dataset.view;
    const allowed=perms.views.includes(v);
    el.style.display=allowed? 'flex':'none';
    // add lock hint for read-only approvals (organizer)
    if(v==='approvals' && role==='organizer' && allowed){
      el.title='View only — Organizers cannot approve (Approver/Admin only)';
      el.style.opacity='.9';
    } else {
      el.title='';
      el.style.opacity='';
    }
  });
  // hide section headers if no visible children
  document.querySelectorAll('.sidenav h4').forEach(h=>{
    let next=h.nextElementSibling; let hasVisible=false;
    while(next && next.tagName!=='H4' && !next.classList.contains('sep')){
      if(next.classList.contains('nav-item') && next.style.display!=='none') hasVisible=true;
      next=next.nextElementSibling;
    }
    h.style.display=hasVisible? 'block':'none';
  });
  // dashboard quick card for approvals: hide for organizer read-only? keep visible but mark read-only
  const qcApprovals=document.querySelector('.quick-card[onclick*="approvals"]');
  if(qcApprovals){
    if(role==='organizer'){
      qcApprovals.style.opacity='.85';
      qcApprovals.title='View only';
    } else {
      qcApprovals.style.opacity=''; qcApprovals.title='';
    }
  }
}
function enforceViewAccess(view){
  if(!currentUser) return true;
  if(canView(currentUser.role, view)) return true;
  const perms=getPerms(currentUser.role);
  toast(`🔒 ${perms.label} cannot access ${view} — ${currentUser.role==='organizer'?'Available to Approver/Admin':'Available to Admin only'}`);
  // redirect to dashboard
  setTimeout(()=> navigate('dashboard'), 600);
  return false;
}

// ---- Navigation ----
function navigate(id){
  if(!enforceViewAccess(id)) return;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active', el.dataset.view===id));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const target = document.getElementById('view-'+id);
  if(target) target.classList.add('active');
  window.scrollTo(0,0);
  if(id==='reports') renderReports();
  if(id==='approvals') renderApprovals();
  if(id==='settings') renderCatalog();
}
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.style.display='block';
  setTimeout(()=>t.style.display='none',2200);
}

// ---- Helpers ----
function timeToMin(t){ const [h,m]=t.split(':').map(Number); return h*60+m; }
function overlap(a,b){
  if(a.date!==b.date) return false;
  if(a.venueId!==b.venueId) return false;
  const s1=timeToMin(a.start), e1=timeToMin(a.end), s2=timeToMin(b.start), e2=timeToMin(b.end);
  return s1 < e2 && s2 < e1;
}
function fmtDate(d){ try{ return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}catch(e){return d} }

// ---- Catalog ----
function renderVenuePicker(){
  const wrap = document.getElementById('bkVenueCards');
  if(!wrap) return;
  const selVal = document.getElementById('bkVenue')?.value || '';
  wrap.innerHTML = state.venues.map(v=>`
    <button type="button" class="venue-pick-card ${selVal===v.id?'selected':''}" onclick="selectVenue('${v.id}')" aria-label="Choose ${v.name}" aria-pressed="${selVal===v.id}">
      <div class="vp-name">${v.name}</div>
      <div class="vp-meta">${v.loc} • Up to ${v.cap}</div>
    </button>
  `).join('');
  updateVenueHint(); updateBookingPreview();
}
function selectVenue(id){
  const sel=document.getElementById('bkVenue');
  if(sel) sel.value=id;
  document.querySelectorAll('.venue-pick-card').forEach(el=>{
    const onclick=el.getAttribute('onclick')||'';
    el.classList.toggle('selected', onclick.includes(`'${id}'`));
  });
  updateVenueHint(); updateBookingPreview();
  toast('Venue: '+(state.venues.find(v=>v.id===id)?.name||id));
}
function updateVenueHint(){
  const hint=document.getElementById('bkVenueHint');
  const capHint=document.getElementById('capHint');
  const sel=document.getElementById('bkVenue')?.value;
  const v=state.venues.find(x=>x.id===sel);
  if(!v || !hint) return;
  const att=parseInt(document.getElementById('bkAttendees')?.value,10)||0;
  hint.style.display='block';
  if(att && att>v.cap){
    hint.className='hint-box warn';
    hint.innerHTML=`<b>${v.name}</b> fits ${v.cap}, but you entered ${att}. Try a larger room.`;
  } else {
    hint.className='hint-box';
    hint.innerHTML=`<b>${v.name}</b> — ${v.loc} • Fits ${v.cap} • ${v.amenities.join(' • ')}`;
  }
  if(capHint) capHint.textContent = v? `Fits up to ${v.cap}` : 'Capacity check is automatic';
}
function updateBookingPreview(){
  const el=document.getElementById('previewBody');
  const avail=document.getElementById('availLine');
  const vid=document.getElementById('bkVenue')?.value;
  const v=state.venues.find(x=>x.id===vid);
  const date=document.getElementById('bkDate')?.value;
  const s=document.getElementById('bkStart')?.value;
  const e=document.getElementById('bkEnd')?.value;
  const title=document.getElementById('bkTitle')?.value.trim();
  const att=document.getElementById('bkAttendees')?.value;
  const org=document.getElementById('bkOrg')?.value.trim();
  // availability line (familiar inline feedback)
  if(avail){
    if(!v || !date || !s || !e){
      avail.className='avail-line idle';
      avail.textContent='Select a venue and date to check availability.';
    } else {
      const busy = state.bookings.some(b=> b.status!=='Rejected' && b.venueId===vid && b.date===date && timeToMin(s)<timeToMin(b.end) && timeToMin(b.start)<timeToMin(e));
      const over = att && v && parseInt(att,10) > v.cap;
      if(busy){
        avail.className='avail-line busy';
        avail.textContent='Not available — that time is already booked. Try another slot.';
      } else if(over){
        avail.className='avail-line busy';
        avail.textContent=`Too many for ${v.name} — fits ${v.cap}. Reduce guests or pick a larger room.`;
      } else {
        avail.className='avail-line ok';
        avail.textContent=`Available — ${v.name} on ${fmtDate(date)}, ${s}–${e}.`;
      }
    }
  }
  if(!el) return;
  if(!v && !date && !title){ el.innerHTML='Choose a venue and date to see a summary here.'; return; }
  el.innerHTML=`
    <dl style="margin:0">
      <div class="summary-row"><dt>Venue</dt><dd>${v? v.name : '—'}</dd></div>
      <div class="summary-row"><dt>Date</dt><dd>${date? fmtDate(date) : '—'}</dd></div>
      <div class="summary-row"><dt>Time</dt><dd>${s&&e? `${s} – ${e}`:'—'}</dd></div>
      <div class="summary-row"><dt>Event</dt><dd>${title||'—'}</dd></div>
      ${att? `<div class="summary-row"><dt>Attendees</dt><dd>${att}</dd></div>`:''}
      ${org? `<div class="summary-row"><dt>Org</dt><dd>${org}</dd></div>`:''}
    </dl>`;
}
function renderCatalog(){
  const q = (document.getElementById('catalogSearch').value||'').toLowerCase();
  const cap = parseInt(document.getElementById('catalogCap').value||'0',10);
  const grid = document.getElementById('catalogGrid');
  const sel = document.getElementById('bkVenue');
  sel.innerHTML = state.venues.map(v=>`<option value="${v.id}">${v.name} — ${v.cap} pax • ${v.loc}</option>`).join('');
  // sync picker after populating select
  renderVenuePicker();
  const filtered = state.venues.filter(v=>{
    if(cap && v.cap < cap) return false;
    if(q && !(v.name.toLowerCase().includes(q) || v.loc.toLowerCase().includes(q) || v.amenities.join(' ').toLowerCase().includes(q))) return false;
    return true;
  });
  grid.innerHTML = filtered.map(v=>{
    const safeImg = (v.image||'').replace(/'/g, '%27');
    return `
    <div class="card venue-card">
      <div class="venue-cover">${safeImg ? `<img class="cover-img" src="${safeImg}" alt="${v.name}" loading="lazy" onerror="this.remove()">` : `<div class="cover-fallback">${v.name.charAt(0)}</div>`}<span class="cover-badge">${v.cap} seats • ${v.loc}</span>${safeImg? `<span class="photo-badge">Photo</span>`:''}</div>
      <div class="venue-body">
        <p class="venue-title">${v.name}</p>
        <div class="venue-meta">${v.loc} • ${v.cap} seats</div>
        <div class="amenities">${v.amenities.map(a=>`<span>${a}</span>`).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn primary small" onclick="quickBook('${v.id}')">Book</button>
          <button class="btn small" onclick="alert('Rules: No smoking. Max capacity enforced. Book at least 24h ahead.')">Rules</button>
        </div>
      </div>
    </div>
  `}).join('') || `<div style="grid-column:1/-1;text-align:center;padding:22px;color:var(--muted)">No venues match.</div>`;

  const vList = document.getElementById('venueList');
  if(vList){
    const canManage=getPerms(currentUser?.role).canManageVenues;
    const canAdmin=getPerms(currentUser?.role).canManageSettings;
    vList.innerHTML = state.venues.map(v=>`
      <div style="display:flex;gap:10px;align-items:center;padding:10px;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,.9)">
        <div style="width:48px;height:48px;border-radius:8px;overflow:hidden;background:${v.color};flex:0 0 48px;border:1px solid var(--border)">${v.image? `<img src="${v.image}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">`:''}</div>
        <div style="flex:1"><b style="font-size:13px">${v.name}</b><div style="font-size:11px;color:var(--muted)">${v.cap} pax • ${v.loc}${v.image?' • 📷 custom cover':''}</div></div>
        <div style="display:flex;gap:6px">
          ${canManage? `<button class="btn small" onclick="editVenue('${v.id}')">Edit</button><button class="btn small" onclick="removeVenue('${v.id}')">Remove</button>` : `<span class="badge" title="Admin/Approver only">🔒 View only</span>`}
        </div>
      </div>
    `).join('');
    // toggle add/edit form for non-managers — full admin panel uses canAdmin for venue image? keep canManage for venues
    const addBtn=document.getElementById('venueSubmitBtn');
    const fInputs=['fName','fCap','fLoc','fAmen','fImageUrl','fImageFile'].map(id=>document.getElementById(id));
    if(addBtn) addBtn.style.display=canManage?'inline-flex':'none';
    fInputs.forEach(el=>{ if(el) el.disabled=!canManage; });
    // admin panel badge
    const badge=document.getElementById('adminPanelBadge');
    if(badge){ badge.textContent = canAdmin? 'Admin access' : (getPerms(currentUser?.role).canManageVenues? 'Approver access':'View only'); badge.className='badge '+(canAdmin?'danger':canManage?'success':'primary'); }
    if(!canManage && !document.getElementById('settingsLock')){
      const hint=document.createElement('div'); hint.id='settingsLock'; hint.className='hint-box'; hint.style.marginTop='10px';
      hint.innerHTML='🔒 <b>View only</b> — Only Approver/Admin can manage venues. Organizers can book but not edit. Admin can also manage accounts.';
      const card=document.querySelector('#view-settings .card'); if(card && !document.getElementById('settingsLock')) card.appendChild(hint);
    }
    if(canManage){ const h=document.getElementById('settingsLock'); if(h) h.remove(); }
  }
}
function quickBook(id){
  const sel=document.getElementById('bkVenue');
  if(sel) sel.value=id;
  navigate('booking');
  setTimeout(()=>{ selectVenue(id); }, 50);
  toast('Venue selected — pick date/time');
}
function addVenue(){
  const editId=document.getElementById('venueEditId')?.value||'';
  const name=document.getElementById('fName').value.trim();
  const cap=parseInt(document.getElementById('fCap').value,10);
  const loc=document.getElementById('fLoc').value.trim();
  const amen=document.getElementById('fAmen').value.trim();
  const urlVal=document.getElementById('fImageUrl')?.value.trim()||'';
  const image = urlVal || pendingVenueImage || '';
  if(!name || !cap) return toast('Name and capacity required');
  if(!getPerms(currentUser?.role).canManageVenues) return toast('🔒 Only Approver/Admin can manage venues — Organizers can only book');
  if(editId){
    const v=state.venues.find(x=>x.id===editId);
    if(!v) return toast('Venue not found');
    v.name=name; v.cap=cap; v.loc=loc||'Campus'; v.amenities= amen? amen.split(',').map(s=>s.trim()).filter(Boolean): ['Projector'];
    if(image) v.image=image;
    saveState(); renderCatalog(); toast('Venue updated — catalog image refreshed');
  } else {
    const palette=['linear-gradient(135deg,#1a1d23 0%, #4c1d95 55%, #7c3aed 100%)','linear-gradient(135deg,#065f46 0%, #10b981 55%, #6ee7b7 100%)','linear-gradient(135deg,#7c3aed 0%, #8b5cf6 50%, #10b981 100%)'];
    const v={id:'v'+Date.now(), name, cap, loc: loc||'Campus', amenities: amen? amen.split(',').map(s=>s.trim()).filter(Boolean): ['Projector'], color:palette[state.venues.length%palette.length], image};
    state.venues.push(v); saveState(); renderCatalog(); toast(image?'Venue added with cover image':'Venue added');
  }
  cancelEditVenue();
}
function editVenue(id){
  if(!getPerms(currentUser?.role).canManageVenues) return toast('🔒 Approver/Admin only');
  const v=state.venues.find(x=>x.id===id); if(!v) return;
  document.getElementById('venueEditId').value=v.id;
  document.getElementById('fName').value=v.name;
  document.getElementById('fCap').value=v.cap;
  document.getElementById('fLoc').value=v.loc;
  document.getElementById('fAmen').value=v.amenities.join(', ');
  document.getElementById('fImageUrl').value=v.image||'';
  pendingVenueImage=v.image||'';
  previewVenueImage(v.image||'');
  document.getElementById('venueSubmitBtn').textContent='Save changes';
  document.getElementById('venueCancelBtn').style.display='inline-flex';
  document.getElementById('fName').focus();
  toast('Editing '+v.name);
}
function cancelEditVenue(){
  const ids=['venueEditId','fName','fCap','fLoc','fAmen','fImageUrl'];
  ids.forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const fileEl=document.getElementById('fImageFile'); if(fileEl) fileEl.value='';
  pendingVenueImage='';
  previewVenueImage('');
  const wrap=document.getElementById('fImagePreview'); if(wrap) wrap.style.display='none';
  const btn=document.getElementById('venueSubmitBtn'); if(btn) btn.textContent='Add venue';
  const cbtn=document.getElementById('venueCancelBtn'); if(cbtn) cbtn.style.display='none';
}
function removeVenue(id){
  if(!getPerms(currentUser?.role).canManageVenues) return toast('🔒 Only Approver/Admin can remove venues');
  if(!confirm('Remove this venue? Bookings for it will remain but venue will be gone.')) return;
  state.venues = state.venues.filter(v=>v.id!==id);
  // if editing this venue, cancel
  if(document.getElementById('venueEditId')?.value===id) cancelEditVenue();
  saveState(); renderCatalog(); toast('Venue removed');
}

// ---- Calendar ----
let calCursor = new Date();
function calShift(dir){
  calCursor.setMonth(calCursor.getMonth()+dir);
  renderCalendar();
}
function renderCalendar(){
  const y=calCursor.getFullYear(), m=calCursor.getMonth();
  document.getElementById('calTitle').textContent = calCursor.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const first = new Date(y,m,1).getDay();
  const daysInMonth = new Date(y,m+1,0).getDate();
  const prevDays = new Date(y,m,0).getDate();
  const grid=document.getElementById('calGrid');
  const selected = document.getElementById('bkDate')?.value || '';
  let html='';
  for(let i=first-1;i>=0;i--){
    html+=`<div class="cal-cell muted" style="opacity:.45"><div class="day">${prevDays - i}</div></div>`;
  }
  const todayStr = new Date().toISOString().slice(0,10);
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr===todayStr;
    const isSelected = dateStr===selected;
    const dayBookings = state.bookings.filter(b=>b.date===dateStr);
    const hasApproved = dayBookings.some(b=>b.status==='Approved');
    const hasPending = dayBookings.some(b=>b.status==='Pending');
    html+=`<div class="cal-cell ${isToday?'today':''} ${isSelected?'selected':''} ${dayBookings.length?'has-booking':''} ${hasApproved?'has-approved':''}" onclick="pickDate('${dateStr}')" style="cursor:pointer">
      <div class="day">${d}</div>
      ${dayBookings.length? `<div class="cal-dots">${dayBookings.slice(0,4).map(b=>`<span class="cal-dot ${b.status==='Approved'?'approved':b.status==='Pending'?'pending':'rejected'}"></span>`).join('')}</div><div style="font-size:10.5px;color:var(--muted);margin-top:2px">${dayBookings.length} ${dayBookings.length===1?'booking':'bookings'}</div>` : `<div style="font-size:10.5px;color:#94a3b8;margin-top:6px">Free</div>`}
    </div>`;
  }
  const totalCells = first + daysInMonth;
  const rem = (7 - (totalCells % 7)) % 7;
  for(let i=1;i<=rem;i++) html+=`<div class="cal-cell muted" style="opacity:.45"><div class="day">${i}</div></div>`;
  grid.innerHTML=html;
}
function pickDate(dateStr){
  const el=document.getElementById('bkDate');
  if(el) el.value=dateStr;
  renderCalendar();
  updateBookingPreview();
  toast('Date set to '+fmtDate(dateStr)+' — now choose time');
}

// ---- Booking creation ----
function createBooking(){
  const venueId=document.getElementById('bkVenue').value;
  const venue = state.venues.find(v=>v.id===venueId);
  const date=document.getElementById('bkDate').value;
  const start=document.getElementById('bkStart').value;
  const end=document.getElementById('bkEnd').value;
  const title=document.getElementById('bkTitle').value.trim();
  const org=document.getElementById('bkOrg').value.trim();
  const attendees=parseInt(document.getElementById('bkAttendees').value,10)||0;
  const notes=document.getElementById('bkNotes').value.trim();
  const resources=[...document.querySelectorAll('.bkRes:checked')].map(c=>c.value);
  const msg=document.getElementById('conflictMsg');

  function showMsg(kind, text){
    msg.style.display='block';
    msg.className='msg-card';
    if(kind==='error'){ msg.style.background='#fef2f2'; msg.style.color='#991b1b'; msg.style.borderColor='#fecaca'; }
    if(kind==='warn'){ msg.style.background='#fffbeb'; msg.style.color='#92400e'; msg.style.borderColor='#fde68a'; }
    if(kind==='ok'){ msg.style.background='#ecfdf5'; msg.style.color='#065f46'; msg.style.borderColor='#a7f3d0'; }
    msg.innerHTML=text;
  }
  if(!venue || !date || !start || !end || !title){
    if(!venue){ showWizMsg(1,'error','Please choose a venue.'); }
    else if(!date || !start || !end){ showWizMsg(2,'error','Pick a date, start and end time.'); }
    else if(!title){ showWizMsg(3,'error','Please add an event title.'); document.getElementById('bkTitle')?.focus(); }
    showMsg('error','<b>Almost there.</b> Choose a venue, date, time, and event title.'); return;
  }
  if(timeToMin(end) <= timeToMin(start)){ showWizMsg(2,'error','End time must be after start time.'); showMsg('error','<b>Time mix-up.</b> End time needs to be after start time.'); return; }
  if(attendees > venue.cap){ showWizMsg(2,'error',`Too many for ${venue.name} — fits ${venue.cap}.`); showMsg('warn',`<b>Too many for ${venue.name}.</b> It fits ${venue.cap}, you entered ${attendees}.`); updateVenueHint(); return; }

  const candidate={venueId, date, start, end};
  const conflict = state.bookings.find(b=> b.status!=='Rejected' && overlap(b, candidate));
  if(conflict){
    state.conflictsPrevented = (state.conflictsPrevented||0)+1;
    saveState();
    showWizMsg(2,'error',`${conflict.venueName} is already booked ${conflict.start}–${conflict.end}.`);
    showMsg('error',`<b>That time is taken.</b><br>${conflict.venueName} is booked on ${fmtDate(conflict.date)} ${conflict.start}–${conflict.end} for “${conflict.title}”. Try another time.`);
    renderAll();
    return;
  }
  const booking={
    id:'b'+Date.now(),
    title, venueId, venueName: venue.name, date, start, end, attendees, org: org|| currentUser?.org || '—',
    requester: currentUser? currentUser.email : 'guest@university.edu',
    resources, notes, status:'Pending',
    createdAt: new Date().toISOString(),
    decidedAt: null, decidedBy: null, decisionNote:'',
    history: [{from:'—', to:'Pending', by: currentUser? currentUser.email : 'guest@university.edu', at: new Date().toLocaleString(), note:'Created'}]
  };
  state.bookings.push(booking);
  state.notifs.unshift({id:'n'+Date.now(), title:'New booking submitted', body:`${title} — ${venue.name} on ${date} ${start}–${end} (Pending)`, time:'just now', unread:true});
  saveState();
  showMsg('ok',`<b>Request sent.</b> “${title}” at <b>${venue.name}</b> on ${fmtDate(date)} ${start}–${end} is now <b>pending approval</b>. Track it in <a onclick="navigate('mybookings')" style="text-decoration:underline;cursor:pointer">My Bookings</a>.`);
  // clear title to prevent double-submit, keep rest so user can book again quickly
  document.getElementById('bkTitle').value='';
  ['wizMsg1','wizMsg2','wizMsg3'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
  renderAll(); updateBookingPreview();
  toast('Request sent — pending approval');
}

function renderMyBookings(){
  const filter=document.getElementById('myFilter').value;
  const rows = state.bookings
    .filter(b=> !filter || b.status===filter)
    .filter(b=> !currentUser ? true : currentUser.role==='organizer' ? b.requester===currentUser.email : true)
    .sort((a,b)=> (a.date+b.start).localeCompare(b.date+b.start));
  const tbl=document.getElementById('myTable');
  if(!rows.length){ tbl.innerHTML=`<tr><td style="padding:18px;text-align:center;color:var(--muted)">No bookings.</td></tr>`; return; }
  tbl.innerHTML=`
    <thead><tr><th>Event</th><th>Venue</th><th>Date & Time</th><th>Attendees</th><th>Status</th><th>Action</th></tr></thead>
    <tbody>
    ${rows.map(b=>`<tr>
      <td><b>${b.title}</b><div style="font-size:11px;color:var(--muted)">${b.org} • ${b.resources.join(', ')||'No resources'}</div></td>
      <td>${b.venueName}</td>
      <td>${fmtDate(b.date)}<br><span style="font-size:11px;color:var(--muted)">${b.start}–${b.end}</span></td>
      <td>${b.attendees||'—'}</td>
      <td><span class="badge ${b.status==='Approved'?'success':b.status==='Pending'?'warn':b.status==='Revision'?'primary':'danger'}">${b.status}</span></td>
      <td><button class="btn small" onclick="cancelBooking('${b.id}')">Cancel</button> ${b.status==='Revision' && currentUser?.email===b.requester ? `<button class="btn small primary" onclick="resubmitBooking('${b.id}')">Resubmit</button>`:''}</td>
    </tr>`).join('')}
    </tbody>
  `;
}
function cancelBooking(id){
  if(!confirm('Cancel this booking?')) return;
  state.bookings = state.bookings.filter(b=>b.id!==id);
  saveState(); renderAll(); toast('Booking cancelled');
}

// ---- Approvals ----
function renderApprovals(){
  const tbl=document.getElementById('approvalTable');
  const perms=getPerms(currentUser?.role);
  const canApprove=perms.canApprove;
  const isOrganizer = !canApprove;
  const lock=document.getElementById('approverLock');
  if(lock){
    lock.style.display = isOrganizer? 'inline-flex':'none';
    if(isOrganizer) lock.textContent='🔒 View only — Organizers can view but only Approver/Admin can approve/reject';
  }
  const counts = {Pending:0, Approved:0, Rejected:0, Revision:0};
  state.bookings.forEach(b=> counts[b.status]=(counts[b.status]||0)+1);
  const countEl=document.getElementById('approvalCounts');
  if(countEl) countEl.innerHTML = `<span class="badge warn">Pending ${counts.Pending||0}</span> <span class="badge success">Approved ${counts.Approved||0}</span> <span class="badge danger">Rejected ${counts.Rejected||0}</span> <span class="badge primary">Revision ${counts.Revision||0}</span>`;
  const filterVal = (document.getElementById('approvalFilter')?.value||'').trim();
  const searchVal = (document.getElementById('approvalSearch')?.value||'').toLowerCase();
  let rows=[...state.bookings].sort((a,b)=> {
    const order={Pending:0, Revision:1, Approved:2, Rejected:3};
    return (order[a.status]??9)-(order[b.status]??9) || (a.date+b.start).localeCompare(b.date+b.start);
  });
  if(filterVal) rows = rows.filter(b=> b.status===filterVal);
  if(searchVal) rows = rows.filter(b=> (b.title+b.venueName+b.requester+b.org).toLowerCase().includes(searchVal));
  if(!rows.length){ tbl.innerHTML=`<tr><td style="padding:18px;text-align:center;color:var(--muted)">No matching requests.</td></tr>`; return; }
  tbl.innerHTML=`
    <thead><tr><th>Request</th><th>Venue / Date</th><th>Requester</th><th>Status</th><th style="min-width:260px">Actions</th></tr></thead>
    <tbody>
    ${rows.map(b=>`<tr>
      <td><b>${b.title}</b><div style="font-size:11px;color:var(--muted)">${b.org} • ${b.attendees||0} pax • ${b.resources.join(', ')||'—'}${b.decisionNote?` • <i>${b.decisionNote}</i>`:''}</div><div style="font-size:11px;color:var(--muted)">${b.history? b.history.slice(-1)[0].by+' • '+b.history.slice(-1)[0].at : ''}</div></td>
      <td>${b.venueName}<div style="font-size:11px;color:var(--muted)">${fmtDate(b.date)} ${b.start}–${b.end}</div><div style="font-size:11px">${b.attendees||0} pax</div></td>
      <td style="font-size:12px">${b.requester}<br><span style="font-size:11px;color:var(--muted)">${fmtDate(b.createdAt||b.date)}</span></td>
      <td><span class="badge ${b.status==='Approved'?'success':b.status==='Pending'?'warn':b.status==='Revision'?'primary':'danger'}">${b.status}</span></td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn small" onclick="openBookingModal('${b.id}')">View</button>
          ${b.status==='Pending'||b.status==='Revision' ? `
            <button class="btn small" style="background:#ecfdf5" onclick="setStatus('${b.id}','Approved')" ${!canApprove?'disabled':''} title="${!canApprove?'Requires Approver/Admin':''}">Approve</button>
            <button class="btn small" style="background:#fffbeb" onclick="setStatus('${b.id}','Revision')" ${!canApprove?'disabled':''}>Revision</button>
            <button class="btn small" style="background:#fef2f2" onclick="setStatus('${b.id}','Rejected')" ${!canApprove?'disabled':''}>Reject</button>
          ` : `
            <button class="btn small" style="background:#ecfdf5" onclick="setStatus('${b.id}','Approved')" ${!canApprove?'disabled':''} ${b.status==='Approved'?'disabled style=opacity:.5':''}>Re-approve</button>
            <button class="btn small" onclick="setStatus('${b.id}','Pending')" ${!canApprove?'disabled':''}>Re-open</button>
          `}
          ${b.status==='Revision' && currentUser && currentUser.email===b.requester ? `<button class="btn small primary" onclick="resubmitBooking('${b.id}')">Resubmit</button>` : ``}
        </div>
      </td>
    </tr>`).join('')}
    </tbody>
  `;
}
function setStatus(id, status){
  if(!getPerms(currentUser?.role).canApprove) return toast('🔒 Only Approver/Admin can change status — Organizers view only');
  const b=state.bookings.find(x=>x.id===id);
  if(!b) return;
  if(b.status===status) return toast('Already '+status);
  if(status==='Approved'){
    const conflict = state.bookings.find(other=> other.id!==b.id && other.status==='Approved' && overlap(other, b));
    if(conflict){
      state.conflictsPrevented = (state.conflictsPrevented||0)+1;
      saveState(); renderAll();
      toast('⛔ Cannot approve — conflicts with '+conflict.title+' ('+conflict.date+' '+conflict.start+'–'+conflict.end+')');
      return;
    }
  }
  let note='';
  if(status==='Rejected' || status==='Revision'){
    note = prompt(status==='Rejected' ? 'Reason for rejection (optional):' : 'What needs revision? (optional):', b.decisionNote||'')||'';
    if(note===null) return;
  }
  const prev=b.status;
  b.status=status;
  b.decisionNote = note || '';
  b.decidedAt = new Date().toISOString();
  b.decidedBy = currentUser? currentUser.email : 'system';
  if(!b.history) b.history=[];
  b.history.push({from:prev, to:status, by: b.decidedBy, at: new Date().toLocaleString(), note: note});
  const titles={Approved:'Booking Approved', Rejected:'Booking Rejected', Revision:'Revision Requested', Pending:'Booking Re-opened'};
  state.notifs.unshift({id:'n'+Date.now(), title: titles[status]||`Booking ${status}`, body:`${b.title} — ${b.venueName} on ${b.date} ${b.start}–${b.end} is now ${status}${note?' — '+note:''}.`, time:'just now', unread:true});
  saveState(); renderAll(); toast(`Booking ${status}${note?' — '+note:''}`);
  if(document.getElementById('bookingModal')?.style.display==='flex') openBookingModal(id);
}
function resubmitBooking(id){
  const b=state.bookings.find(x=>x.id===id);
  if(!b) return;
  if(b.requester!==currentUser?.email) return toast('Only requester can resubmit');
  if(b.status!=='Revision') return toast('Only Revision can be resubmitted');
  b.status='Pending';
  b.decisionNote='';
  if(!b.history) b.history=[];
  b.history.push({from:'Revision', to:'Pending', by: currentUser.email, at: new Date().toLocaleString(), note:'Resubmitted'});
  state.notifs.unshift({id:'n'+Date.now(), title:'Booking Resubmitted', body:`${b.title} — ${b.venueName} on ${b.date} resubmitted for approval.`, time:'just now', unread:true});
  saveState(); renderAll(); toast('Resubmitted — pending approval');
  closeBookingModal();
}
function openBookingModal(id){
  const b=state.bookings.find(x=>x.id===id);
  if(!b) return;
  const m=document.getElementById('bookingModal');
  const body=document.getElementById('bookingModalBody');
  if(!m||!body) return;
  const canApprove = getPerms(currentUser?.role).canApprove;
  const isOrganizer = !canApprove;
  body.innerHTML=`
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:start">
      <div><h3 style="margin:0">${b.title}</h3><div style="font-size:13px;color:var(--muted)">${b.org} • ${b.venueName} • ${fmtDate(b.date)} ${b.start}–${b.end}</div></div>
      <span class="badge ${b.status==='Approved'?'success':b.status==='Pending'?'warn':b.status==='Revision'?'primary':'danger'}" style="font-size:13px">${b.status}</span>
    </div>
    <div class="sep"></div>
    <div class="grid grid-2" style="gap:10px;font-size:13px">
      <div><b>Venue</b><br>${b.venueName} (${b.venueId})<br><span style="color:var(--muted)">${state.venues.find(v=>v.id===b.venueId)?.loc||''} • ${b.attendees||0} pax</span></div>
      <div><b>Requester</b><br>${b.requester}<br><span style="color:var(--muted)">Created ${fmtDate(b.createdAt||b.date)}</span></div>
      <div><b>Resources</b><br>${b.resources?.join(', ')||'—'}</div>
      <div><b>Organization</b><br>${b.org}</div>
      <div style="grid-column:1/-1"><b>Notes</b><br><span style="color:var(--muted)">${b.notes||'—'}</span></div>
      ${b.decisionNote? `<div style="grid-column:1/-1"><b>Decision note</b><br>${b.decisionNote} <span style="color:var(--muted)">— ${b.decidedBy||''} ${b.decidedAt? new Date(b.decidedAt).toLocaleString():''}</span></div>`:''}
    </div>
    <div class="sep"></div>
    <div><b style="font-size:13px">History</b><div style="margin-top:6px;display:grid;gap:6px">${(b.history||[]).map(h=>`<div style="font-size:12px;padding:8px;border:1px solid var(--border);border-radius:8px;background:#f8fafc"><b>${h.from||'—'} → ${h.to||h.status}</b> • ${h.by} • ${h.at}${h.note? `<br><span style="color:var(--muted)">${h.note}</span>`:''}</div>`).join('')||'<span style="color:var(--muted)">No history</span>'}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;justify-content:flex-end">
      <button class="btn small" onclick="closeBookingModal()">Close</button>
      ${!isOrganizer && (b.status==='Pending'||b.status==='Revision') ? `
        <button class="btn small" style="background:#ecfdf5" onclick="setStatus('${b.id}','Approved')">Approve</button>
        <button class="btn small" style="background:#fffbeb" onclick="setStatus('${b.id}','Revision')">Request Revision</button>
        <button class="btn small" style="background:#fef2f2" onclick="setStatus('${b.id}','Rejected')">Reject</button>
      `:''}
      ${b.status==='Revision' && currentUser?.email===b.requester ? `<button class="btn small primary" onclick="resubmitBooking('${b.id}')">Resubmit</button>`:''}
    </div>
  `;
  m.style.display='flex';
}
function closeBookingModal(){
  const m=document.getElementById('bookingModal');
  if(m) m.style.display='none';
}
// ---- Notifications ----
function updateNotifs(){
  const dot=document.getElementById('notifDot');
  const unread = state.notifs.filter(n=>n.unread).length;
  dot.style.display = unread? 'grid':'none';
  dot.textContent = unread;
  const list=document.getElementById('notifList');
  if(!list) return;
  list.innerHTML = state.notifs.map(n=>`
    <div class="card card-pad" style="display:flex;gap:12px;align-items:start;border-left:4px solid ${n.unread?'var(--primary)':'var(--border)'}">
      <div style="width:36px;height:36px;border-radius:999px;background:#eff6ff;display:grid;place-items:center">🔔</div>
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:13px">${n.title}</b><span style="font-size:11px;color:var(--muted)">${n.time}</span></div>
        <div style="font-size:13px;color:var(--muted);margin-top:4px">${n.body}</div>
      </div>
      ${n.unread? `<button class="btn small" onclick="markRead('${n.id}')">Mark read</button>`: `<span class="badge">Read</span>`}
    </div>
  `).join('') || `<div style="text-align:center;color:var(--muted);padding:18px">No notifications.</div>`;
}
function markRead(id){
  const n=state.notifs.find(x=>x.id===id);
  if(n) n.unread=false;
  saveState(); updateNotifs();
}

// ---- Reports ----
function renderReports(){
  const total=state.bookings.length;
  const pending=state.bookings.filter(b=>b.status==='Pending').length;
  const approved=state.bookings.filter(b=>b.status==='Approved').length;
  const hourCount={};
  state.bookings.forEach(b=>{ const h=b.start.split(':')[0]; hourCount[h]=(hourCount[h]||0)+1; });
  let peak='—'; let max=0; for(const [h,c] of Object.entries(hourCount)){ if(c>max){max=c; peak=h+':00';}}
  document.getElementById('rPeak').textContent = peak;
  const venueCount={};
  state.bookings.forEach(b=> venueCount[b.venueName]=(venueCount[b.venueName]||0)+1);
  let busiest='—', bcount=0; for(const [k,v] of Object.entries(venueCount)){ if(v>bcount){bcount=v; busiest=k;} }
  document.getElementById('rBusiest').textContent = busiest;
  document.getElementById('rBusiestSub').textContent = bcount? bcount+' bookings':'—';
  document.getElementById('rApproval').textContent = total? Math.round(approved/total*100)+'%' : '—';
  const bars=document.getElementById('reportBars');
  const maxVal = Math.max(1, ...Object.values(venueCount));
  const sorted = Object.entries(venueCount).sort((a,b)=>b[1]-a[1]);
  bars.innerHTML = sorted.length ? sorted.map(([name,c])=>{
    const pct = Math.max(4, Math.round(c/maxVal*100));
    return `<div class="hrow"><span class="hname" title="${name}">${name}</span><div class="htrack"><div class="hfill" style="width:${pct}%"></div></div><span class="hval">${c}</span></div>`;
  }).join('') : `<div class="chart-bars empty">No data yet.</div>`;
  const tbl=document.getElementById('reportTable');
  tbl.innerHTML=`
    <thead><tr><th>Venue</th><th>Capacity</th><th>Bookings</th><th>Utilization*</th></tr></thead>
    <tbody>
    ${state.venues.map(v=>{
      const c=venueCount[v.name]||0;
      const util = Math.min(100, Math.round(c/8*100));
      return `<tr><td>${v.name}</td><td>${v.cap}</td><td>${c}</td><td><div style="background:#e2e8f0;height:8px;border-radius:999px;width:90px;display:inline-block;vertical-align:middle"><div style="width:${util}%;height:100%;background:var(--primary);border-radius:999px"></div></div> <span style="font-size:11px;color:var(--muted)">${util}%</span></td></tr>`;
    }).join('')}
    </tbody>
  `;
  document.getElementById('reportTable').innerHTML = tbl.innerHTML;
}
function exportCSV(){
  if(!getPerms(currentUser?.role).canExport && currentUser) return toast('🔒 Export available to Approver/Admin only — Organizers can view My Bookings');
  const headers=['Title','Venue','Date','Start','End','Attendees','Org','Requester','Status'];
  const rows=state.bookings.map(b=>[b.title,b.venueName,b.date,b.start,b.end,b.attendees,b.org,b.requester,b.status]);
  let csv=[headers, ...rows].map(r=> r.map(v=> `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='unievent_report.csv'; a.click();
  URL.revokeObjectURL(url); toast('CSV downloaded');
}
function exportPDF(){
  if(!getPerms(currentUser?.role).canExport && currentUser) return toast('🔒 Export available to Approver/Admin only');
  const w=window.open('','_blank');
  const html=`<html><head><title>UniEvent Report</title><style>body{font-family:Arial;padding:18px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ccc;padding:6px;font-size:12px} th{background:#f0f4ff}</style></head><body>
    <h2>UniEvent — Utilization Report</h2><p>Generated ${new Date().toLocaleString()} • ${state.bookings.length} bookings</p>
    <table><tr><th>Title</th><th>Venue</th><th>Date</th><th>Time</th><th>Status</th></tr>${state.bookings.map(b=>`<tr><td>${b.title}</td><td>${b.venueName}</td><td>${b.date}</td><td>${b.start}-${b.end}</td><td>${b.status}</td></tr>`).join('')}</table>
    <p style="font-size:11px;color:#64748b">Portable prototype export — data from localStorage.</p>
  </body></html>`;
  w.document.write(html); w.document.close(); w.print();
}

// ---- Dashboard KPIs (minimal) ----
function renderDashboard(){
  const total=state.bookings.length;
  const pending=state.bookings.filter(b=>b.status==='Pending').length;
  const util = state.venues.length? Math.round(state.bookings.filter(b=>b.status==='Approved').length / state.venues.length / 2 *100) : 0;
  const el=(id)=>document.getElementById(id);
  if(el('kpiTotal')) el('kpiTotal').textContent=total;
  if(el('kpiPending')) el('kpiPending').textContent=pending;
  if(el('kpiUtil')) el('kpiUtil').textContent= Math.min(100, util)+'%';
  if(el('kpiConflicts')) el('kpiConflicts').textContent= state.conflictsPrevented||0;
  // greeting + date for minimal hero
  const greet=el('dashGreet'); if(greet) greet.textContent = currentUser? currentUser.name.split(' ')[0] : 'there';
  const dEl=el('dashDate'); if(dEl) dEl.textContent = new Date().toLocaleDateString('en-US',{weekday:'long', month:'long', day:'numeric', year:'numeric'});
  const myCount = currentUser? state.bookings.filter(b=> b.requester===currentUser.email).length : total;
  if(el('qcMyCount')) el('qcMyCount').textContent = myCount + (myCount===1?' request':' requests');
  if(el('qcPending')) el('qcPending').textContent = pending? pending + ' pending' : 'all caught up';
  // role-specific hint banner
  const rh=el('roleHint');
  if(rh){
    const hints={
      organizer:'<span class="rh-badge">ORGANIZER</span> You can <b>book venues</b> and track <b>My Bookings</b>. Approvals & reports are view-only — managed by Approvers/Admins.',
      approver:'<span class="rh-badge">APPROVER</span> You can <b>approve / reject / request revision</b>, view <b>Reports</b> and manage venues. Settings are Admin-only.',
      admin:'<span class="rh-badge">ADMIN</span> Full access — <b>manage venues, users & settings</b>, approve bookings, and export reports.'
    };
    rh.className='role-hint '+(currentUser?.role||'organizer');
    rh.innerHTML=hints[currentUser?.role]||hints.organizer;
    rh.style.display='flex';
  }
  // clickable pending KPI — role-aware
  const pendCard=document.querySelector('.dash-kpi.accent');
  if(pendCard){
    const canApp=getPerms(currentUser?.role).canApprove;
    pendCard.style.cursor=canApp?'pointer':'default';
    pendCard.title=canApp?'Go to Approval Portal':'View only — Approver/Admin can act';
    pendCard.onclick=()=> canApp? navigate('approvals') : toast('🔒 Organizers view approvals read-only');
  }
  const upcoming=[...state.bookings].filter(b=>b.status!=='Rejected').sort((a,b)=> (a.date+b.start).localeCompare(b.date+b.start)).slice(0,5);
  const tbl=el('upcomingTable');
  if(tbl) tbl.innerHTML= upcoming.length? `
    <thead><tr><th>Event</th><th>When</th><th>Status</th></tr></thead>
    <tbody>${upcoming.map(b=>`<tr><td><b style="font-size:13px">${b.title}</b><div style="font-size:11px;color:var(--muted)">${b.venueName}</div></td><td style="font-size:12px">${fmtDate(b.date)}<br>${b.start}–${b.end}</td><td><span class="badge ${b.status==='Approved'?'success':'warn'}">${b.status}</span></td></tr>`).join('')}</tbody>
  `: `<tr><td style="padding:18px;text-align:center;color:var(--muted)">No upcoming bookings.<br><span style="font-size:11px">Tap <b>New booking</b> to create one.</span></td></tr>`;
  const venueCount={}; state.bookings.forEach(b=> venueCount[b.venueName]=(venueCount[b.venueName]||0)+1);
  const maxV=Math.max(1,...Object.values(venueCount),1);
  const bars=el('utilBars');
  if(bars){
    const sorted=Object.entries(venueCount).sort((a,b)=>b[1]-a[1]).slice(0,5);
    bars.innerHTML = sorted.length ? sorted.map(([k,v])=>{
      const pct=Math.max(4, Math.round(v/maxV*100));
      return `<div class="hrow"><span class="hname" title="${k}">${k}</span><div class="htrack"><div class="hfill" style="width:${pct}%"></div></div><span class="hval">${v}</span></div>`;
    }).join('') : `<div class="chart-bars empty">No bookings yet.</div>`;
  }
}

function renderUsers(){
  const tbl=document.getElementById('userTable');
  const countBadge=document.getElementById('userCountBadge');
  if(countBadge) countBadge.textContent= state.users.length+' users';
  const canAdmin=getPerms(currentUser?.role).canManageSettings;
  // Admin gets full management table, others get read-only
  if(canAdmin){
    tbl.innerHTML=`
      <thead><tr><th>User</th><th>Role</th><th style="min-width:180px">Manage</th></tr></thead>
      <tbody>${state.users.map(u=>`<tr>
        <td><b style="font-size:13px">${u.name}</b><div style="font-size:11px;color:var(--muted)">${u.email}${u.org?` • ${u.org}`:''}</div></td>
        <td>
          <select class="select" style="padding:6px 8px;font-size:12px;min-width:120px" onchange="changeUserRole('${u.email}', this.value)" ${u.email===currentUser?.email?'disabled title="Cannot change own role"':''}>
            <option value="organizer" ${u.role==='organizer'?'selected':''}>Organizer</option>
            <option value="approver" ${u.role==='approver'?'selected':''}>Approver</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
          </select>
          <div style="margin-top:4px"><span class="badge ${u.role==='admin'?'danger':u.role==='approver'?'success':'primary'}" style="font-size:10px">${u.role}</span></div>
        </td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn small" onclick="resetUserPassword('${u.email}')">Reset pw</button>
            <button class="btn small" style="background:#fef2f2;border-color:#fecaca;color:#991b1b" onclick="deleteAccount('${u.email}')" ${u.email===currentUser?.email?'disabled style=opacity:.5':''}>Remove</button>
          </div>
        </td>
      </tr>`).join('')}</tbody>
    `;
  } else {
    tbl.innerHTML=`
      <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
      <tbody>${state.users.map(u=>`<tr><td>${u.name}</td><td style="font-size:12px">${u.email}</td><td><span class="badge ${u.role==='admin'?'danger':u.role==='approver'?'success':'primary'}">${u.role}</span></td></tr>`).join('')}</tbody>
    `;
  }
  document.getElementById('orgName').value = state.org.name;
  document.getElementById('orgAdviser').value = state.org.adviser;
  document.getElementById('orgMembers').value = state.org.members;
  // toggle account form for non-admin
  const canAdminForm=getPerms(currentUser?.role).canManageSettings;
  const accInputs=['accName','accEmail','accPass','accRole','accOrg','accDept','accAvatar'].map(id=>document.getElementById(id));
  accInputs.forEach(el=>{ if(el) el.disabled=!canAdminForm; });
  const accBtn=document.querySelector('button[onclick="addAccount()"]');
  if(accBtn) accBtn.style.display=canAdminForm?'inline-flex':'none';
  if(!canAdminForm){
    const accMsgEl=document.getElementById('accMsg');
    if(accMsgEl){ accMsgEl.style.display='block'; accMsgEl.style.background='#f8fafc'; accMsgEl.style.border='1px solid var(--border)'; accMsgEl.style.color='var(--muted)'; accMsgEl.textContent='🔒 View only — only Admin can create accounts or change roles.'; }
  } else {
    const accMsgEl=document.getElementById('accMsg'); if(accMsgEl && accMsgEl.textContent.includes('View only')) accMsgEl.style.display='none';
  }
  // org inputs also admin-only
  ['orgName','orgAdviser','orgMembers'].forEach(id=>{ const el=document.getElementById(id); if(el) el.disabled=!canAdminForm; });
  const saveOrgBtn=document.querySelector('button[onclick="saveOrg()"]'); if(saveOrgBtn) saveOrgBtn.style.display=canAdminForm?'inline-flex':'none';
}
function addAccount(){
  if(!getPerms(currentUser?.role).canManageSettings) return toast('🔒 Only Admin can create accounts');
  const name=document.getElementById('accName').value.trim();
  const email=document.getElementById('accEmail').value.trim().toLowerCase();
  const pass=document.getElementById('accPass').value;
  const role=document.getElementById('accRole').value;
  const org=document.getElementById('accOrg').value.trim();
  const dept=document.getElementById('accDept').value.trim();
  const avatar=document.getElementById('accAvatar').value.trim();
  const msg=document.getElementById('accMsg');
  function showMsg(txt, ok){
    if(!msg) return; msg.style.display='block'; msg.style.background=ok?'#ecfdf5':'#fef2f2'; msg.style.color=ok?'#065f46':'#991b1b'; msg.style.border='1px solid '+(ok?'#a7f3d0':'#fecaca'); msg.textContent=txt;
  }
  if(!name || !email || !pass) return showMsg('Name, email and password are required.', false);
  if(!email.includes('@')) return showMsg('Enter a valid email.', false);
  if(state.users.some(u=>u.email.toLowerCase()===email)) return showMsg('Email already exists.', false);
  state.users.push({name, email, password:pass, role, org:org||'', department:dept||'', avatar:avatar||`https://i.pravatar.cc/100?u=${encodeURIComponent(email)}`});
  saveState(); renderUsers();
  showMsg(`✅ Created ${role} — ${email} / ${pass}`, true);
  ['accName','accEmail','accPass','accOrg','accDept','accAvatar'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  toast('Account created: '+email);
}
function changeUserRole(email, newRole){
  if(!getPerms(currentUser?.role).canManageSettings) return toast('🔒 Admin only');
  if(email===currentUser?.email) return toast('Cannot change your own role');
  const u=state.users.find(x=>x.email===email); if(!u) return;
  const old=u.role; u.role=newRole; saveState(); renderUsers(); toast(`Role: ${old} → ${newRole} for ${email}`);
}
function deleteAccount(email){
  if(!getPerms(currentUser?.role).canManageSettings) return toast('🔒 Admin only');
  if(email===currentUser?.email) return toast('Cannot remove yourself');
  if(!confirm(`Remove account ${email}? This cannot be undone.`)) return;
  state.users=state.users.filter(u=>u.email!==email);
  saveState(); renderUsers(); toast('Removed '+email);
}
function resetUserPassword(email){
  if(!getPerms(currentUser?.role).canManageSettings) return toast('🔒 Admin only');
  const u=state.users.find(x=>x.email===email); if(!u) return;
  const np=prompt(`New password for ${email} (current: ${u.password||'—'}):`, u.password||'');
  if(np===null) return; if(!np.trim()) return toast('Password not changed');
  u.password=np.trim(); saveState(); renderUsers(); toast('Password updated for '+email);
}
function exportAccounts(){
  const data={accounts:state.users, exportedAt:new Date().toISOString(), count:state.users.length};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='unievent_accounts.json'; a.click(); URL.revokeObjectURL(url); toast('Accounts exported');
}
function importAccounts(e){
  const file=e.target.files[0]; if(!file) return;
  const r=new FileReader(); r.onload=()=>{
    try{
      const data=JSON.parse(r.result); const list=data.accounts||data.users||data;
      if(!Array.isArray(list) || !list.length) throw new Error('No accounts found');
      let added=0; list.forEach(u=>{
        if(!u.email) return; const email=String(u.email).toLowerCase().trim();
        if(state.users.some(x=>x.email.toLowerCase()===email)) return;
        state.users.push({name:u.name||email.split('@')[0], email, password:u.password||'import123', role:(u.role||'organizer').toLowerCase(), org:u.org||'', department:u.department||'', avatar:u.avatar||''});
        added++;
      });
      saveState(); renderUsers(); toast(`Imported ${added} accounts`);
    }catch(err){ toast('Import failed: '+err.message); }
    e.target.value='';
  }; r.readAsText(file);
}
function clearAllAccounts(){
  if(!getPerms(currentUser?.role).canManageSettings) return toast('🔒 Admin only');
  if(!confirm('Remove all NON-ADMIN accounts? Admins will be kept.')) return;
  const before=state.users.length;
  state.users=state.users.filter(u=>u.role==='admin');
  saveState(); renderUsers(); toast(`Cleared ${before-state.users.length} accounts — ${state.users.length} admins kept`);
}
function saveOrg(){
  if(!getPerms(currentUser?.role).canManageSettings) return toast('🔒 Only Admin can save organization — Approver/Organizer view only');
  state.org.name=document.getElementById('orgName').value;
  state.org.adviser=document.getElementById('orgAdviser').value;
  state.org.members=parseInt(document.getElementById('orgMembers').value,10)||0;
  saveState(); toast('Organization saved');
}

function renderAll(){
  renderCatalog();
  renderCalendar();
  renderMyBookings();
  renderApprovals();
  updateNotifs();
  renderDashboard();
  renderUsers();
  renderReports();
}

// init defaults for booking form
document.getElementById('bkDate').value = new Date().toISOString().slice(0,10);
document.getElementById('bkDate').min = new Date().toISOString().slice(0,10);
// live summary bindings — calendar-affecting fields refresh calendar, text fields only refresh summary
['bkVenue','bkDate','bkStart','bkEnd','bkAttendees'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('input', ()=>{ updateBookingPreview(); updateVenueHint(); renderCalendar(); });
  if(el) el.addEventListener('change', ()=>{ updateBookingPreview(); updateVenueHint(); renderCalendar(); });
});
['bkTitle','bkOrg','bkNotes'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('input', ()=>{ updateBookingPreview(); });
});
document.querySelectorAll('.bkRes').forEach(cb=> cb.addEventListener('change', ()=>{ updateBookingPreview(); }));
// resource chips toggle visual handled by CSS :has, but also ensure click updates state
document.querySelectorAll('.r-chip').forEach(lbl=>{
  lbl.addEventListener('click', (e)=>{
    // let native checkbox toggle, then update after tick
    setTimeout(updateBookingPreview, 10);
  });
});
// venue cover image — file upload handler
const fImageFileEl=document.getElementById('fImageFile');
if(fImageFileEl){
  fImageFileEl.addEventListener('change', (e)=>{
    const file=e.target.files[0]; if(!file) return;
    if(file.size > 2*1024*1024) return toast('Image too large — max 2MB (use URL for larger)');
    const r=new FileReader();
    r.onload=()=>{
      pendingVenueImage=r.result;
      previewVenueImage(pendingVenueImage);
      document.getElementById('fImagePreview').style.display='block';
      toast('Image loaded — will be saved with venue');
    };
    r.readAsDataURL(file);
  });
}

// ---- Booking form — familiar single page (no wizard gating) ----
let wizStep = 1;
let wizVisited = new Set([1,2,3]);
function updateWizardUI(){ /* single form: everything visible, nothing to gate */ updateBookingPreview(); }
function showWizMsg(step, kind, html){
  const el=document.getElementById('wizMsg'+step);
  if(!el) return;
  if(!html){ el.style.display='none'; return; }
  el.style.display='block';
  el.className='wiz-msg '+(kind==='ok'?'ok':'error');
  el.innerHTML=html;
}
function validateStep(n){
  if(n===1){
    const vid=document.getElementById('bkVenue')?.value;
    if(!vid){ showWizMsg(1,'error','Please choose a venue.'); return false; }
    showWizMsg(1,null,''); return true;
  }
  if(n===2){
    const date=document.getElementById('bkDate')?.value;
    const s=document.getElementById('bkStart')?.value;
    const e=document.getElementById('bkEnd')?.value;
    const att=parseInt(document.getElementById('bkAttendees')?.value,10)||0;
    const vid=document.getElementById('bkVenue')?.value;
    const v=state.venues.find(x=>x.id===vid);
    if(!date || !s || !e){ showWizMsg(2,'error','Pick a date, start and end time.'); return false; }
    if(timeToMin(e) <= timeToMin(s)){ showWizMsg(2,'error','End time must be after start time.'); return false; }
    if(v && att && att>v.cap){ showWizMsg(2,'error',`${v.name} fits ${v.cap} — you entered ${att}.`); return false; }
    const cand={venueId:vid, date, start:s, end:e};
    const conflict=state.bookings.find(b=> b.status!=='Rejected' && overlap(b,cand));
    if(conflict){ showWizMsg(2,'error',`${conflict.venueName} is already booked ${fmtDate(conflict.date)} ${conflict.start}–${conflict.end}. Pick another time.`); return false; }
    showWizMsg(2,null,''); return true;
  }
  if(n===3){
    const title=document.getElementById('bkTitle')?.value.trim();
    if(!title){ showWizMsg(3,'error','Please add an event title.'); return false; }
    showWizMsg(3,null,''); return true;
  }
  return true;
}
// compat stubs (old wizard buttons no longer in UI)
function goWizard(){ return true; }
function wizardNext(){ return true; }
function wizardBack(){ return true; }
function resetWizard(){ resetBookingForm(); }
function resetBookingForm(){
  ['bkTitle','bkOrg','bkNotes','bkAttendees'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const d=document.getElementById('bkDate'); if(d) d.value=new Date().toISOString().slice(0,10);
  const s=document.getElementById('bkStart'); if(s) s.value='09:00';
  const e=document.getElementById('bkEnd'); if(e) e.value='11:00';
  document.querySelectorAll('.bkRes').forEach(c=>c.checked=false);
  document.querySelectorAll('.duration-chip').forEach(c=>c.classList.remove('active'));
  ['wizMsg1','wizMsg2','wizMsg3','conflictMsg'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display='none'; });
  updateBookingPreview(); updateVenueHint();
  toast('Form cleared');
}
function setDuration(hours, btn){
  const sEl=document.getElementById('bkStart');
  const eEl=document.getElementById('bkEnd');
  if(!sEl||!eEl) return;
  const s=sEl.value||'09:00';
  const [h,m]=s.split(':').map(Number);
  const endMin=h*60+m+hours*60;
  const eh=String(Math.floor(endMin/60)%24).padStart(2,'0');
  const em=String(endMin%60).padStart(2,'0');
  eEl.value=`${eh}:${em}`;
  document.querySelectorAll('.duration-chip').forEach(c=>c.classList.remove('active'));
  if(btn) btn.classList.add('active');
  updateBookingPreview();
}
function updateWizardReview(){ /* summary lives in side panel now */ }
// live feedback hooks — no gating, just refresh preview
const _origSelectVenue = selectVenue;
selectVenue = function(id){
  _origSelectVenue(id);
  showWizMsg(1,null,'');
};
const _origPickDate = pickDate;
pickDate = function(dateStr){
  _origPickDate(dateStr);
};

renderAll();
if(currentUser) applyRoleVisibility();
// ensure picker reflects default select
setTimeout(()=>{ const sel=document.getElementById('bkVenue')?.value; if(sel) selectVenue(sel); updateBookingPreview(); updateWizardUI(); if(currentUser) applyRoleVisibility(); }, 80);
if(currentUser) navigate('dashboard');
else updateWizardUI();

