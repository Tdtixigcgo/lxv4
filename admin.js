// ============================================================
//  ADMIN.JS v4 — Professional Admin Dashboard
//  Quyền hạn đầy đủ: Xóa phòng, clone, QR, xuất báo cáo,
//  batch actions, master tools, auto-fill, lời chúc đặc biệt
// ============================================================
'use strict';

const MASTER_PASS = 'admin_lixi_master_2025';
const SESSION_KEY = 'lixi_admin_v4';
const pathParts   = location.pathname.split('/').filter(Boolean);
const URL_ROOM_ID = pathParts[1] || '';

let sb = null, currentRoom = null, gameData = [], players = [], roomConfig = {};
let notifCount = 0, notifs = [], isMasterAdmin = false;
let selectedEnvelopes = new Set();

const $ = id => document.getElementById(id);

/* ─── INIT ─── */
function initSB() {
  if (sb) return;
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

function getSession()   { try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');}catch{return null;} }
function saveSession(d) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(d)); }
function clearSession() { sessionStorage.removeItem(SESSION_KEY); }
function escHtml(s)     { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

document.addEventListener('DOMContentLoaded', async () => {
  initSB();
  // Mobile menu
  const mt = $('menu-toggle');
  if (mt) { mt.style.display='flex'; mt.onclick=()=>$('sidebar').classList.toggle('open'); }

  const sess = getSession();
  if (sess) {
    if (sess.master) { isMasterAdmin=true; await bootDashboard(null); }
    else if (sess.roomId) { await bootDashboard(sess.roomId); }
    else showLogin();
  } else showLogin();
});

/* ─── LOGIN ─── */
function showLogin() { $('login-screen').classList.remove('hidden'); }

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const user  = $('login-user').value.trim();
  const pass  = $('login-pass').value;
  const errEl = $('login-error');
  errEl.textContent = '';

  if (user === 'admin' && pass === MASTER_PASS) {
    saveSession({ master:true });
    isMasterAdmin = true;
    $('login-screen').classList.add('hidden');
    await bootDashboard(null);
    return;
  }

  if (URL_ROOM_ID) {
    try {
      const { data: room } = await sb.from('rooms').select('id,title,emoji,host_name,pass_hash').eq('id', URL_ROOM_ID).single();
      if (room) {
        const hash = btoa(unescape(encodeURIComponent(pass + ':lixi_salt_2025')));
        if (hash === room.pass_hash) {
          saveSession({ roomId: room.id });
          $('login-screen').classList.add('hidden');
          await bootDashboard(room.id);
          return;
        }
      }
    } catch(_) {}
  }

  if (user.length >= 6) {
    try {
      const hash = btoa(unescape(encodeURIComponent(pass + ':lixi_salt_2025')));
      const { data: room } = await sb.from('rooms').select('id').eq('id', user).eq('pass_hash', hash).single();
      if (room) {
        saveSession({ roomId: room.id });
        $('login-screen').classList.add('hidden');
        await bootDashboard(room.id);
        return;
      }
    } catch(_) {}
  }

  errEl.textContent = '⚠ Sai thông tin đăng nhập!';
  $('login-pass').value = '';
  errEl.style.animation='none'; void errEl.offsetWidth; errEl.style.animation='';
});

/* ─── DASHBOARD BOOT ─── */
async function bootDashboard(roomId) {
  $('admin-app').classList.add('visible');
  setupNavigation();
  setupControls();
  renderNotifs();

  if (isMasterAdmin) {
    $('sb-username').textContent = 'Master Admin';
    $('sb-role').textContent = 'Full Access';
    $('sb-room-title').textContent = 'Lì Xì Platform';
    const mn = $('master-nav'); if(mn) mn.style.display='block';
    await loadAllRooms();
    await loadSystemStats();
  }

  const targetRoom = roomId || URL_ROOM_ID;
  if (targetRoom) await loadRoom(targetRoom);
  else if (isMasterAdmin) showTab('rooms');
}

/* ─── LOAD ROOM ─── */
async function loadRoom(roomId) {
  const { data: room, error } = await sb.from('rooms').select('*').eq('id', roomId).single();
  if (error || !room) { showToast('❌ Không tìm thấy phòng', 'error'); return; }

  currentRoom = room;
  roomConfig  = room.config || {};

  $('sb-room-emoji').textContent  = room.emoji || '🧧';
  $('sb-room-title').textContent  = room.title || 'Phòng Lì Xì';
  $('sb-username').textContent    = room.host_name || 'Admin';
  $('sb-role').textContent        = 'Room Admin';
  const rid = $('sb-room-id');
  if (rid) { rid.textContent = 'ID: ' + roomId; rid.style.display='block'; }
  showEl('room-nav-section'); showEl('room-settings-nav');

  const base = location.origin;
  setTxt('share-room-link',  `${base}/room/${roomId}`);
  setTxt('share-admin-link', `${base}/admin/${roomId}`);
  setVal('link-room',  `${base}/room/${roomId}`);
  setVal('link-admin', `${base}/admin/${roomId}`);
  const lo = $('link-room-open'); if(lo) lo.href=`${base}/room/${roomId}`;

  const gsBar = $('game-status-bar');
  if (gsBar) gsBar.style.display = 'flex';
  const tgBtn = $('toggle-game-btn');
  if (tgBtn) tgBtn.style.display = 'inline-flex';
  updateGameStatus(room.is_open);

  // Load QR code
  renderQR(`${base}/room/${roomId}`);

  [gameData, players] = await Promise.all([loadEnvelopes(roomId), loadPlayers(roomId)]);
  renderAll();
  fillSettingsForm();
  setupRealtime(roomId);
}

/* ─── DATA LOADING ─── */
async function loadEnvelopes(roomId) {
  const { data } = await sb.from('envelopes').select('*').eq('room_id', roomId).order('position');
  return (data||[]).map(r => ({
    id:r.position+1, displayValue:r.display_value, realValue:r.real_value,
    isSpecial:r.is_special, opened:r.opened, openedAt:r.opened_at,
    openedBy:r.opened_by||'', _dbId:r.id, position:r.position
  }));
}

async function loadPlayers(roomId) {
  const { data } = await sb.from('events').select('*').eq('room_id', roomId).order('created_at',{ascending:false});
  return data || [];
}

async function loadAllRooms() {
  const { data } = await sb.from('rooms')
    .select('id,title,host_name,emoji,is_open,envelope_count,opened_count,created_at')
    .order('created_at', { ascending:false }).limit(100);
  renderRoomsPicker(data || []);
}

async function loadSystemStats() {
  const { count: roomCount } = await sb.from('rooms').select('id',{head:true,count:'exact'});
  const { count: envCount  } = await sb.from('envelopes').select('id',{head:true,count:'exact'});
  const { count: eventCount} = await sb.from('events').select('id',{head:true,count:'exact'});
  const sc = $('system-stats');
  if (sc) sc.innerHTML = `
    <div class="metric-card gold"><span class="metric-icon">🏠</span><div class="metric-label">Tổng phòng</div><div class="metric-value">${roomCount||0}</div></div>
    <div class="metric-card blue"><span class="metric-icon">🧧</span><div class="metric-label">Tổng phong bì</div><div class="metric-value">${envCount||0}</div></div>
    <div class="metric-card green"><span class="metric-icon">📋</span><div class="metric-label">Tổng lượt bốc</div><div class="metric-value">${eventCount||0}</div></div>`;
}

/* ─── REALTIME ─── */
function setupRealtime(roomId) {
  sb.channel('admin-rt-'+roomId)
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'envelopes',filter:`room_id=eq.${roomId}`}, async () => {
      gameData = await loadEnvelopes(roomId);
      players  = await loadPlayers(roomId);
      renderAll();
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'events',filter:`room_id=eq.${roomId}`}, p => {
      const ev = p.new;
      notifCount++;
      updateNotifBadge();
      const msg = ev.is_special
        ? `🔥 <strong>${escHtml(ev.player_name||'Ai đó')}</strong> bốc ô ĐẶC BIỆT! Thực: ${ev.real_value}k 🎊`
        : `🧧 <strong>${escHtml(ev.player_name||'Ai đó')}</strong> bốc được ${ev.display_value}k`;
      notifs.unshift({msg, time:new Date(), isSpecial:ev.is_special});
      renderNotifs();
      players.unshift(ev);
      renderPlayers();
      renderTimeline(false);
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'rooms',filter:`id=eq.${roomId}`}, p => {
      if (currentRoom) { currentRoom.is_open = p.new.is_open; updateGameStatus(p.new.is_open); }
    })
    .subscribe();
}

/* ─── RENDER ALL ─── */
function renderAll() {
  renderMetrics();
  renderEnvTable($('env-filter')?.value, $('env-search')?.value);
  renderEnvBulkEditor();
  renderSpecial();
  renderPlayers();
  renderCharts();
  renderTimeline(true);
  renderTopPlayers();
  renderTimelineMini();
}

/* ─── METRICS ─── */
function renderMetrics() {
  if (!gameData.length) return;
  const total  = gameData.length;
  const opened = gameData.filter(e=>e.opened).length;
  const specs  = gameData.filter(e=>e.isSpecial);
  const sOpen  = specs.filter(e=>e.opened).length;
  const dTot   = gameData.filter(e=>e.opened).reduce((s,e)=>s+e.displayValue,0);
  const rTot   = gameData.filter(e=>e.opened).reduce((s,e)=>s+e.realValue,0);
  const pct    = total>0 ? Math.round(opened/total*100) : 0;

  setTxt('m-total',          total);
  setTxt('m-opened',         opened);
  setTxt('m-pending',        total-opened);
  setTxt('m-special-opened', `${sOpen}/${specs.length}`);
  setTxt('m-display-total',  dTot+'k');
  setTxt('m-real-total',     rTot+'k');
  setTxt('m-players',        players.length);
  setTxt('m-pct',            pct+'%');
  setTxt('m-pct-badge',      pct+'%');
  setTxt('ring-pct',         pct+'%');

  const rf = $('ring-fill');
  if (rf) rf.style.strokeDashoffset = 226-(226*pct/100);
}

function setTxt(id,v) { const e=$(id); if(e) e.textContent=v; }
function showEl(id)   { const e=$(id); if(e) e.style.display='block'; }
function setVal(id,v) { const e=$(id); if(e) e.value=v; }
function setChk(id,v) { const e=$(id); if(e) e.checked=v; }

function updateGameStatus(open) {
  setTxt('game-open-label', open ? '🟢 Game đang MỞ' : '🔴 Game đang ĐÓNG');
  const dot = $('gs-dot'); if(dot) dot.className='gs-dot '+(open?'open':'closed');
  const tgBtn = $('toggle-game-btn');
  if (tgBtn) {
    tgBtn.textContent = open ? '🔴 Đóng game' : '🟢 Mở game';
    tgBtn.className = `action-btn ${open?'action-btn-red':'action-btn-green'}`;
  }
}

/* ─── ENV TABLE ─── */
function renderEnvTable(filter='all', search='') {
  const tbody = $('env-tbody');
  if (!tbody) return;
  let data = [...gameData];
  if (filter==='opened')  data = data.filter(e=>e.opened);
  if (filter==='pending') data = data.filter(e=>!e.opened);
  if (filter==='special') data = data.filter(e=>e.isSpecial);
  if (search) {
    const s = search.toLowerCase();
    data = data.filter(e=>String(e.id).includes(s)||String(e.displayValue).includes(s)||String(e.realValue).includes(s)||(e.openedBy||'').toLowerCase().includes(s));
  }
  tbody.innerHTML = data.map(env=>`
    <tr>
      <td><input type="checkbox" class="env-chk" data-id="${env._dbId}" ${selectedEnvelopes.has(env._dbId)?'checked':''} style="accent-color:var(--gold-500)" onchange="toggleEnvSelect(${env._dbId},this.checked)"/></td>
      <td class="mono">#${String(env.id).padStart(2,'0')}</td>
      <td><span class="badge ${env.isSpecial?'badge-special':'badge-normal'}">${env.isSpecial?'🔥 Đặc biệt':'📦 Thường'}</span></td>
      <td class="mono">${env.displayValue}k</td>
      <td class="mono" style="color:${env.isSpecial?'var(--gold-300)':'inherit'}">${env.realValue}k${env.isSpecial?' ⭐':''}</td>
      <td><span class="badge ${env.opened?'badge-opened':'badge-pending'}">${env.opened?'✓ Đã mở':'○ Chờ'}</span></td>
      <td style="font-size:.82rem;color:var(--text-secondary)">${escHtml(env.openedBy)||'—'}</td>
      <td style="font-size:.75rem;color:var(--text-muted);font-family:'DM Mono',monospace">${env.openedAt?new Date(env.openedAt).toLocaleTimeString('vi-VN'):'—'}</td>
      <td class="action-cell">
        <button class="icon-btn" onclick="adminQuickEdit(${env.id-1})" title="Sửa">✏️</button>
        <button class="icon-btn" onclick="adminToggle(${env.id-1})" title="${env.opened?'Reset':'Đánh dấu mở'}">${env.opened?'↺':'✓'}</button>
        <button class="icon-btn" onclick="adminForceOpen(${env.id-1})" title="Admin mở thay" style="${env.opened?'opacity:.3;pointer-events:none':''}">🔓</button>
      </td>
    </tr>`).join('')
  || '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:28px">Không có dữ liệu</td></tr>';

  // select-all checkbox
  const sa = $('select-all-env');
  if (sa) sa.onchange = e => {
    tbody.querySelectorAll('.env-chk').forEach(chk=>{
      chk.checked = e.target.checked;
      const id = parseInt(chk.dataset.id);
      e.target.checked ? selectedEnvelopes.add(id) : selectedEnvelopes.delete(id);
    });
  };
}

function toggleEnvSelect(id, checked) {
  checked ? selectedEnvelopes.add(id) : selectedEnvelopes.delete(id);
}

/* ─── ADMIN FORCE OPEN ─── */
window.adminForceOpen = async function(idx) {
  const env = gameData[idx];
  if (!env || env.opened) return;
  const name = prompt('Mở ô này cho ai? Nhập tên:');
  if (!name) return;
  const now = new Date().toISOString();
  env.opened=true; env.openedAt=now; env.openedBy=name;
  await sb.from('envelopes').update({opened:true,opened_at:now,opened_by:name}).eq('id',env._dbId);
  await sb.from('events').insert({room_id:currentRoom.id,envelope_id:env._dbId,display_value:env.displayValue,real_value:env.realValue,is_special:env.isSpecial,player_name:name,created_at:now});
  await sb.from('rooms').update({opened_count:gameData.filter(e=>e.opened).length}).eq('id',currentRoom.id);
  players = await loadPlayers(currentRoom.id);
  renderAll();
  showToast(`✓ Admin đã mở ô #${env.id} cho ${name}`, 'success');
};

/* ─── BATCH RESET ─── */
async function batchResetSelected() {
  if (!selectedEnvelopes.size) { showToast('Chưa chọn ô nào', 'warn'); return; }
  showConfirm(`Reset ${selectedEnvelopes.size} ô đã chọn?`, 'Các ô này sẽ về trạng thái chưa mở.', async () => {
    for (const dbId of selectedEnvelopes) {
      await sb.from('envelopes').update({opened:false,opened_at:null,opened_by:null}).eq('id',dbId);
      const env = gameData.find(e=>e._dbId===dbId);
      if (env) { env.opened=false; env.openedAt=null; env.openedBy=''; }
    }
    selectedEnvelopes.clear();
    renderAll();
    showToast('✓ Đã reset các ô đã chọn', 'success');
  });
}

/* ─── BULK EDITOR ─── */
function renderEnvBulkEditor() {
  const grid = $('env-bulk-grid');
  if (!grid || !gameData.length) return;
  grid.innerHTML = gameData.map((env,idx)=>`
    <div class="ebc ${env.isSpecial?'special':''}" id="ebc-${idx}">
      <div class="ebc-id">
        Ô #${String(env.id).padStart(2,'0')}
        ${env.opened?`<span style="color:var(--green);font-size:.62rem">✓ ${escHtml(env.openedBy||'?')}</span>`:''}
      </div>
      <div class="ebc-fields">
        <div class="ebc-field"><label>Hiển thị (k)</label><input class="ebc-input" type="number" id="ebc-d-${idx}" value="${env.displayValue}" min="1" max="100000"/></div>
        <div class="ebc-field"><label>Thực tế (k)</label><input class="ebc-input" type="number" id="ebc-r-${idx}" value="${env.realValue}" min="1" max="100000"/></div>
      </div>
      <label class="ebc-check"><input type="checkbox" id="ebc-sp-${idx}" ${env.isSpecial?'checked':''}/> 🔥 Đặc biệt</label>
      <button class="ebc-save-btn" onclick="saveOneEnv(${idx})">💾 Lưu ô này</button>
    </div>`).join('');
}

window.saveOneEnv = async function(idx) {
  const env = gameData[idx]; if (!env) return;
  const d=parseInt($(`ebc-d-${idx}`)?.value); if(d>0) env.displayValue=d;
  const r=parseInt($(`ebc-r-${idx}`)?.value); if(r>0) env.realValue=r;
  env.isSpecial=!!$(`ebc-sp-${idx}`)?.checked;
  await sb.from('envelopes').update({display_value:env.displayValue,real_value:env.realValue,is_special:env.isSpecial}).eq('id',env._dbId);
  renderSpecial(); renderEnvTable($('env-filter')?.value,$('env-search')?.value);
  showToast(`✓ Ô #${String(env.id).padStart(2,'0')} đã lưu`, 'success');
  const card=$(`ebc-${idx}`);
  if(card){card.style.outline='2px solid var(--green)';setTimeout(()=>card.style.outline='',1400);}
};

window.adminQuickEdit = function(idx) {
  const env = gameData[idx]; if (!env) return;
  showModal({
    title:`✏️ Sửa ô #${String(env.id).padStart(2,'0')}`,
    body:`
      <div class="form-group"><label class="form-label">Mệnh giá hiển thị (k)</label><input type="number" id="qe-d" value="${env.displayValue}" min="1" class="modal-input"/></div>
      <div class="form-group"><label class="form-label">Mệnh giá thực (k)</label><input type="number" id="qe-r" value="${env.realValue}" min="1" class="modal-input"/></div>
      <div class="form-group"><label class="form-label">Loại</label>
        <select id="qe-sp" class="modal-input">
          <option value="0" ${!env.isSpecial?'selected':''}>📦 Thường</option>
          <option value="1" ${env.isSpecial?'selected':''}>🔥 Đặc biệt</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Trạng thái</label>
        <select id="qe-op" class="modal-input">
          <option value="0" ${!env.opened?'selected':''}>○ Chưa mở</option>
          <option value="1" ${env.opened?'selected':''}>✓ Đã mở</option>
        </select>
      </div>
      ${env.opened?`<div class="form-group"><label class="form-label">Người bốc</label><input type="text" id="qe-by" value="${escHtml(env.openedBy)}" class="modal-input"/></div>`:''}`,
    confirmText:'💾 Lưu',
    async onConfirm() {
      const d=parseInt($('qe-d').value); if(d>0) env.displayValue=d;
      const r=parseInt($('qe-r').value); if(r>0) env.realValue=r;
      env.isSpecial=$('qe-sp').value==='1';
      const nowOpen=$('qe-op').value==='1';
      if(nowOpen!==env.opened){env.opened=nowOpen;env.openedAt=nowOpen?new Date().toISOString():null;if(!nowOpen)env.openedBy='';}
      if($('qe-by')) env.openedBy=$('qe-by').value;
      await sb.from('envelopes').update({display_value:env.displayValue,real_value:env.realValue,is_special:env.isSpecial,opened:env.opened,opened_at:env.openedAt,opened_by:env.openedBy}).eq('id',env._dbId);
      renderAll();
      showToast(`✓ Đã cập nhật ô #${String(env.id).padStart(2,'0')}`, 'success');
    }
  });
};

window.adminToggle = async function(idx) {
  const env = gameData[idx]; if (!env) return;
  env.opened=!env.opened; env.openedAt=env.opened?new Date().toISOString():null;
  if(!env.opened) env.openedBy='';
  await sb.from('envelopes').update({opened:env.opened,opened_at:env.openedAt,opened_by:env.openedBy}).eq('id',env._dbId);
  renderAll();
  showToast(`${env.opened?'✓ Đã mở':'↺ Đặt lại'} ô #${String(env.id).padStart(2,'0')}`, 'success');
};

/* ─── SAVE ALL ENVELOPES ─── */
async function saveAllEnvelopes() {
  if (!gameData.length) return;
  const btn=$('save-all-envs-btn');
  if(btn){btn.disabled=true;btn.textContent='⏳ Đang lưu...';}
  for(let idx=0;idx<gameData.length;idx++){
    const env=gameData[idx];
    const d=parseInt($(`ebc-d-${idx}`)?.value); if(d>0) env.displayValue=d;
    const r=parseInt($(`ebc-r-${idx}`)?.value); if(r>0) env.realValue=r;
    env.isSpecial=!!$(`ebc-sp-${idx}`)?.checked;
    await sb.from('envelopes').update({display_value:env.displayValue,real_value:env.realValue,is_special:env.isSpecial}).eq('id',env._dbId);
  }
  if(btn){btn.disabled=false;btn.textContent='💾 Lưu tất cả';}
  renderSpecial(); renderEnvTable();
  showToast('✓ Đã lưu tất cả phong bì', 'success');
}

/* ─── SHUFFLE ENVELOPES ─── */
async function shuffleEnvelopes() {
  if (!currentRoom) return;
  showConfirm('Trộn ngẫu nhiên?', 'Mệnh giá sẽ được xáo trộn ngẫu nhiên giữa các ô chưa mở.', async () => {
    const unopened = gameData.filter(e=>!e.opened);
    const vals = shuffle(unopened.map(e=>({dv:e.displayValue,rv:e.realValue,sp:e.isSpecial})));
    for(let i=0;i<unopened.length;i++){
      unopened[i].displayValue=vals[i].dv;
      unopened[i].realValue=vals[i].rv;
      unopened[i].isSpecial=vals[i].sp;
      await sb.from('envelopes').update({display_value:vals[i].dv,real_value:vals[i].rv,is_special:vals[i].sp}).eq('id',unopened[i]._dbId);
    }
    renderAll();
    showToast('🔀 Đã trộn ngẫu nhiên', 'success');
  });
}

/* ─── AUTO FILL ─── */
async function autoFillEnvelopes() {
  showModal({
    title:'✨ Tự động điền mệnh giá',
    body:`
      <p style="color:var(--text-secondary);font-size:.84rem;margin-bottom:14px">Điền nhanh tất cả ô chưa mở với mệnh giá</p>
      <div class="form-group"><label class="form-label">Mệnh giá hiển thị (k)</label><input type="number" id="af-d" value="10" min="1" class="modal-input"/></div>
      <div class="form-group"><label class="form-label">Mệnh giá thực (k)</label><input type="number" id="af-r" value="10" min="1" class="modal-input"/></div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px"><input type="checkbox" id="af-only-unopened" checked style="accent-color:var(--gold-500)"/> <span style="font-size:.84rem;color:var(--text-secondary)">Chỉ điền ô chưa mở</span></label>`,
    confirmText:'✨ Điền',
    async onConfirm() {
      const d=parseInt($('af-d').value)||10;
      const r=parseInt($('af-r').value)||10;
      const onlyUn=$('af-only-unopened')?.checked ?? true;
      const targets = onlyUn ? gameData.filter(e=>!e.opened) : gameData;
      for(const env of targets){
        env.displayValue=d; env.realValue=r;
        await sb.from('envelopes').update({display_value:d,real_value:r}).eq('id',env._dbId);
      }
      renderAll();
      showToast(`✓ Đã điền ${targets.length} ô`, 'success');
    }
  });
}

/* ─── SPECIAL LIST ─── */
function renderSpecial() {
  const el=$('special-list'); if(!el) return;
  const specs=gameData.filter(e=>e.isSpecial);
  if(!specs.length){el.innerHTML='<p style="color:var(--text-muted);font-size:.84rem;padding:14px">Không có ô đặc biệt</p>';return;}
  el.innerHTML=specs.map(e=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.035)">
      <div style="display:flex;align-items:center;gap:12px">
        <span class="badge badge-special">🔥 Ô #${String(e.id).padStart(2,'0')}</span>
        <span style="font-size:.82rem;color:var(--text-secondary)">Hiển: <strong style="color:var(--text-primary)">${e.displayValue}k</strong> · Thực: <strong style="color:var(--gold-300)">${e.realValue}k</strong></span>
      </div>
      <span class="badge ${e.opened?'badge-opened':'badge-pending'}">${e.opened?`✓ ${escHtml(e.openedBy)}`:'Chưa mở'}</span>
    </div>`).join('');
}

/* ─── PLAYERS ─── */
function renderPlayers() {
  const el=$('players-list'); if(!el) return;
  const search=($('player-search')?.value||'').toLowerCase();
  const data = search ? players.filter(p=>(p.player_name||'').toLowerCase().includes(search)) : players;
  if(!data.length){el.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:28px;font-size:.84rem">Chưa có người chơi</p>';return;}
  el.innerHTML=data.map((p,i)=>`
    <div class="player-row">
      <div class="player-avatar">${((p.player_name||'?')[0]).toUpperCase()}</div>
      <div class="player-name">${escHtml(p.player_name||'Ẩn danh')}</div>
      <span class="badge ${p.is_special?'badge-special':'badge-opened'}" style="margin-right:8px">${p.is_special?'🔥 '+p.real_value+'k':''}</span>
      <div class="player-val">${p.display_value||0}k</div>
      <div class="player-time" style="margin-left:8px">${p.created_at?new Date(p.created_at).toLocaleTimeString('vi-VN'):''}</div>
    </div>`).join('');
}

/* ─── TOP PLAYERS ─── */
function renderTopPlayers() {
  const el=$('top-players-container'); if(!el) return;
  if(!players.length){el.innerHTML='<p style="color:var(--text-muted);font-size:.82rem;text-align:center;padding:20px">Chưa có dữ liệu</p>';return;}
  const tally={};
  players.forEach(p=>{const n=p.player_name||'Ẩn danh';if(!tally[n])tally[n]=0;tally[n]+=p.real_value||p.display_value||0;});
  const sorted=Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,8);
  el.innerHTML=sorted.map(([name,val],i)=>`
    <div class="player-row">
      <span style="font-family:'DM Mono',monospace;font-size:.72rem;color:var(--text-muted);width:18px">${i+1}</span>
      <div class="player-avatar">${name[0].toUpperCase()}</div>
      <div class="player-name">${escHtml(name)}</div>
      <div class="player-val">${val}k</div>
    </div>`).join('');
}

/* ─── CHARTS ─── */
function renderCharts() {
  renderDistChart(); renderHourlyChart();
}

function renderDistChart() {
  const el=$('chart-dist'); if(!el) return;
  const opened=gameData.filter(e=>e.opened);
  if(!opened.length){el.innerHTML='<p style="color:var(--text-muted);font-size:.82rem;padding:14px">Chưa có dữ liệu</p>';return;}
  const tally={};
  opened.forEach(e=>{const k=e.displayValue+'k';tally[k]=(tally[k]||0)+1;});
  const max=Math.max(...Object.values(tally));
  el.innerHTML=Object.entries(tally).sort((a,b)=>parseInt(b[0])-parseInt(a[0])).map(([v,c])=>`
    <div class="bar-row">
      <div class="bar-label">${v}</div>
      <div class="bar-track"><div class="bar-fill" style="background:linear-gradient(90deg,var(--gold-500),var(--gold-300))" data-w="${c/max*100}"></div></div>
      <div class="bar-val">${c}</div>
    </div>`).join('');
  setTimeout(()=>el.querySelectorAll('.bar-fill').forEach(f=>f.style.width=(f.dataset.w||0)+'%'),200);
}

function renderHourlyChart() {
  const el=$('chart-hourly'); if(!el) return;
  if(!players.length){el.innerHTML='<p style="color:var(--text-muted);font-size:.82rem;padding:14px">Chưa có dữ liệu</p>';return;}
  const hourly={};
  players.forEach(p=>{if(p.created_at){const h=new Date(p.created_at).getHours();hourly[h]=(hourly[h]||0)+1;}});
  if(!Object.keys(hourly).length){el.innerHTML='<p style="color:var(--text-muted);font-size:.82rem;padding:14px">Chưa có dữ liệu</p>';return;}
  const max=Math.max(...Object.values(hourly));
  el.innerHTML=Object.entries(hourly).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).map(([h,c])=>`
    <div class="bar-row">
      <div class="bar-label">${String(h).padStart(2,'0')}:00</div>
      <div class="bar-track"><div class="bar-fill" style="background:linear-gradient(90deg,#1d4ed8,var(--blue))" data-w="${c/max*100}"></div></div>
      <div class="bar-val">${c}</div>
    </div>`).join('');
  setTimeout(()=>el.querySelectorAll('.bar-fill').forEach(f=>f.style.width=(f.dataset.w||0)+'%'),200);
}

/* ─── TIMELINE ─── */
function renderTimeline(full=true) {
  const c=full?$('timeline-container'):null;
  if(!c) return;
  if(!players.length){c.innerHTML='<p style="color:var(--text-muted);font-size:.84rem;text-align:center;padding:20px">Chưa có sự kiện nào</p>';return;}
  c.innerHTML=players.slice(0,50).map(p=>`
    <div class="timeline-item ${p.is_special?'tl-special':''}">
      <div class="tl-dot ${p.is_special?'special':'normal'}"></div>
      <div class="tl-content">
        <div class="tl-main"><strong>${escHtml(p.player_name||'Ẩn danh')}</strong> bốc được <span class="tl-val">${p.display_value||'?'}k</span>${p.is_special?`&nbsp;<span class="badge badge-special" style="font-size:.62rem">🔥 Thực: ${p.real_value}k</span>`:''}</div>
        <div class="tl-time">${p.created_at?new Date(p.created_at).toLocaleString('vi-VN'):''}</div>
      </div>
    </div>`).join('');
}

function renderTimelineMini() {
  const c=$('timeline-container-mini'); if(!c) return;
  if(!players.length){c.innerHTML='<p style="color:var(--text-muted);font-size:.82rem;text-align:center;padding:20px">Chưa có sự kiện</p>';return;}
  c.innerHTML=players.slice(0,10).map(p=>`
    <div class="timeline-item ${p.is_special?'tl-special':''}">
      <div class="tl-dot ${p.is_special?'special':'normal'}"></div>
      <div class="tl-content">
        <div class="tl-main"><strong>${escHtml(p.player_name||'?')}</strong> → <span class="tl-val">${p.display_value}k</span></div>
        <div class="tl-time">${p.created_at?new Date(p.created_at).toLocaleTimeString('vi-VN'):''}</div>
      </div>
    </div>`).join('');
}

/* ─── NOTIFICATIONS ─── */
function updateNotifBadge() {
  const b=$('notif-badge'); if(b){b.textContent=notifCount;b.style.display=notifCount>0?'flex':'none';}
}
function renderNotifs() {
  const el=$('notif-list'); if(!el) return;
  if(!notifs.length){el.innerHTML='<p style="color:var(--text-muted);font-size:.84rem;padding:18px;text-align:center">Chưa có thông báo realtime</p>';return;}
  el.innerHTML=notifs.map(n=>`
    <div class="notif-item" style="${n.isSpecial?'background:rgba(139,0,24,.05);border-radius:8px;padding:10px 12px;margin-bottom:4px;border:1px solid rgba(139,0,24,.1);':''}">
      <span style="font-size:.84rem;color:var(--text-secondary)">${n.msg}</span>
      <span class="notif-time">${n.time.toLocaleTimeString('vi-VN')}</span>
    </div>`).join('');
}
window.clearNotifs = function() { notifs=[]; notifCount=0; updateNotifBadge(); renderNotifs(); showToast('✓ Đã xóa thông báo','info'); };

/* ─── ROOMS PICKER ─── */
function renderRoomsPicker(rooms) {
  const g=$('rooms-picker-grid'); if(!g) return;
  const search=($('room-search')?.value||'').toLowerCase();
  const filtered=search?rooms.filter(r=>(r.title||'').toLowerCase().includes(search)||(r.host_name||'').toLowerCase().includes(search)):rooms;
  if(!filtered.length){g.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px">Không tìm thấy phòng nào</div>';return;}
  g.innerHTML=filtered.map(r=>`
    <div class="rp-card ${currentRoom?.id===r.id?'active-room':''}" onclick="switchRoom('${r.id}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:1.6rem">${r.emoji||'🧧'}</span>
        <span class="badge ${r.is_open?'badge-open':'badge-closed'}">${r.is_open?'MỞ':'ĐÓNG'}</span>
      </div>
      <div style="font-weight:700;font-size:.92rem;margin-bottom:3px;color:var(--text-primary)">${escHtml(r.title||'Phòng lì xì')}</div>
      <div style="font-size:.74rem;color:rgba(245,200,66,.45);margin-bottom:8px">👤 ${escHtml(r.host_name||'—')}</div>
      <div style="font-size:.7rem;color:var(--text-muted)">🧧 ${r.envelope_count||0} ô &nbsp;·&nbsp; ✅ ${r.opened_count||0} đã mở</div>
      <div style="font-size:.65rem;color:var(--text-muted);margin-top:6px;font-family:'DM Mono',monospace">ID: ${r.id} · ${new Date(r.created_at).toLocaleDateString('vi-VN')}</div>
    </div>`).join('');
}

window.switchRoom = async function(roomId) {
  saveSession(isMasterAdmin ? { master:true, lastRoom:roomId } : { roomId });
  await loadRoom(roomId);
  showTab('dashboard');
  document.querySelectorAll('[data-tab]').forEach(l=>l.classList.remove('active'));
  document.querySelector('[data-tab="dashboard"]')?.classList.add('active');
  $('top-bar-title').textContent='Dashboard';
};

/* ─── SETTINGS ─── */
function fillSettingsForm() {
  if (!currentRoom) return;
  setVal('cfg-title',        currentRoom.title||'');
  setVal('cfg-subtitle',     currentRoom.subtitle||'');
  setVal('cfg-host-name',    currentRoom.host_name||'');
  setVal('cfg-emoji',        currentRoom.emoji||'🧧');
  setVal('cfg-footer',       roomConfig.footerText||'✦ Chúc mừng năm mới ✦');
  setVal('cfg-section-label',roomConfig.sectionLabel||'✦ Chọn một phong bì may mắn ✦');
  setVal('cfg-closed-title', roomConfig.gameClosedTitle||'Game đã đóng');
  setVal('cfg-closed-msg',   roomConfig.gameClosedMsg||'Phòng hiện không mở.');
  setChk('cfg-game-open',    currentRoom.is_open!==false);
  setChk('cfg-show-players', roomConfig.showPlayerCount!==false);
  setChk('cfg-show-value',   roomConfig.showValue!==false);
  setChk('cfg-one-per-person', roomConfig.onePerPerson!==false);
  setVal('cfg-confetti',     roomConfig.confettiCount||80);
  setVal('cfg-total-envs',   roomConfig.totalEnvelopes||gameData.length||20);
  setVal('cfg-num-specials', (roomConfig.specialValues||[50,100]).length);
  buildDistGrid();
  buildSpecialValInputs(roomConfig.specialValues||[50,100]);
  const msgs=roomConfig.messages||{};
  setVal('msg-low',  (msgs.low||['Năm mới vạn sự như ý! 🌸']).join('\n'));
  setVal('msg-mid',  (msgs.mid||['Phú quý vinh hoa! 🎋']).join('\n'));
  setVal('msg-high', (msgs.high||['Đại cát đại lợi! 💰']).join('\n'));
  setVal('msg-special', (msgs.special||['🎊 Ô đặc biệt! Chúc mừng!']).join('\n'));
  $('cfg-num-specials')?.addEventListener('change', () => {
    const n=parseInt($('cfg-num-specials').value)||2;
    buildSpecialValInputs(Array.from({length:n},(_,i)=>(roomConfig.specialValues||[])[i]||(i+1)*50));
  });
}

function buildDistGrid() {
  const dg=$('dist-grid'); if(!dg) return;
  const dist=roomConfig.distribution||{1:2,2:2,3:2,5:3,10:4,15:2,20:5};
  dg.innerHTML=[1,2,3,5,10,15,20,50,100].map(v=>`
    <div class="dist-item">
      <label>${v}k</label>
      <input type="number" id="dist-${v}" min="0" max="50" value="${dist[v]||0}"/>
    </div>`).join('');
}

function buildSpecialValInputs(vals) {
  const c=$('special-val-inputs'); if(!c) return;
  const n=Array.isArray(vals)?vals.length:2;
  c.innerHTML=Array.from({length:Math.min(n,10)},(_,i)=>`
    <div class="form-group">
      <label class="form-label">Giải đặc biệt ${i+1} (k)</label>
      <input class="form-input" id="sv-${i}" type="number" value="${vals[i]||(i+1)*50}" min="1"/>
    </div>`).join('');
}

async function saveConfig(updates) {
  if (!currentRoom) return false;
  const newCfg={...roomConfig,...updates};
  const {error}=await sb.from('rooms').update({config:newCfg}).eq('id',currentRoom.id);
  if(error){showToast('❌ Lỗi lưu: '+error.message,'error');return false;}
  roomConfig=newCfg;
  return true;
}

async function saveTextSettings() {
  const title  = $('cfg-title')?.value||currentRoom.title;
  const emoji  = $('cfg-emoji')?.value||currentRoom.emoji;
  const hn     = $('cfg-host-name')?.value;
  await sb.from('rooms').update({title,subtitle:$('cfg-subtitle')?.value||'',host_name:hn,emoji}).eq('id',currentRoom.id);
  currentRoom.title=$('cfg-title')?.value||currentRoom.title;
  currentRoom.subtitle=$('cfg-subtitle')?.value||'';
  currentRoom.host_name=hn;
  currentRoom.emoji=emoji;
  $('sb-room-title').textContent=currentRoom.title;
  $('sb-room-emoji').textContent=emoji;
  const ok=await saveConfig({footerText:$('cfg-footer')?.value||'',sectionLabel:$('cfg-section-label')?.value||'',gameClosedTitle:$('cfg-closed-title')?.value||'',gameClosedMsg:$('cfg-closed-msg')?.value||''});
  if(ok) showToast('✓ Đã lưu nội dung','success');
}

async function saveGameSettings() {
  const open=$('cfg-game-open')?.checked??true;
  await sb.from('rooms').update({is_open:open}).eq('id',currentRoom.id);
  currentRoom.is_open=open; updateGameStatus(open);
  const ok=await saveConfig({showPlayerCount:$('cfg-show-players')?.checked??true,showValue:$('cfg-show-value')?.checked??true,onePerPerson:$('cfg-one-per-person')?.checked??true,confettiCount:parseInt($('cfg-confetti')?.value)||80});
  if(ok) showToast('✓ Đã lưu cài đặt game','success');
}

async function saveDistSettings() {
  const dist={};
  [1,2,3,5,10,15,20,50,100].forEach(v=>{const n=parseInt($(`dist-${v}`)?.value)||0;if(n>0)dist[v]=n;});
  const total=parseInt($('cfg-total-envs')?.value)||20;
  const nSpec=parseInt($('cfg-num-specials')?.value)||0;
  const svArr=Array.from({length:nSpec},(_,i)=>parseInt($(`sv-${i}`)?.value)||(i+1)*50);
  const ok=await saveConfig({distribution:dist,totalEnvelopes:total,specialValues:svArr});
  if(ok) showToast('✓ Đã lưu cấu hình mệnh giá. Tạo game mới để áp dụng.','success');
}

async function saveMsgSettings() {
  const messages={
    low:($('msg-low')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
    mid:($('msg-mid')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
    high:($('msg-high')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
    special:($('msg-special')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean),
  };
  const ok=await saveConfig({messages});
  if(ok) showToast('✓ Đã lưu lời chúc','success');
}

async function saveAccountSettings() {
  const newPass=$('cfg-new-pass')?.value;
  const cfmPass=$('cfg-confirm-pass')?.value;
  if(!newPass){showToast('Nhập mật khẩu mới','error');return;}
  if(newPass!==cfmPass){showToast('Mật khẩu không khớp!','error');return;}
  const newHash=btoa(unescape(encodeURIComponent(newPass+':lixi_salt_2025')));
  const {error}=await sb.from('rooms').update({pass_hash:newHash}).eq('id',currentRoom.id);
  if(error){showToast('❌ '+error.message,'error');return;}
  showToast('✓ Đã đổi mật khẩu','success');
  $('cfg-new-pass').value=''; $('cfg-confirm-pass').value='';
}

function saveCustomSlug() { showToast('Tính năng slug tùy chỉnh sắp ra mắt!','info'); }

/* ─── GAME ACTIONS ─── */
async function toggleGameOpen() {
  if (!currentRoom) return;
  const newOpen=!currentRoom.is_open;
  await sb.from('rooms').update({is_open:newOpen}).eq('id',currentRoom.id);
  currentRoom.is_open=newOpen; updateGameStatus(newOpen);
  showToast(newOpen?'🟢 Game đã MỞ':'🔴 Game đã ĐÓNG', newOpen?'success':'info');
}

async function resetGame() {
  if (!currentRoom) return;
  const btn=$('reset-game-btn'); if(btn){btn.disabled=true;btn.textContent='⏳...';}
  for(const e of gameData){
    await sb.from('envelopes').update({opened:false,opened_at:null,opened_by:null}).eq('id',e._dbId);
    e.opened=false; e.openedAt=null; e.openedBy='';
  }
  await sb.from('events').delete().eq('room_id',currentRoom.id);
  await sb.from('rooms').update({opened_count:0}).eq('id',currentRoom.id);
  players=[]; renderAll();
  if(btn){btn.disabled=false;btn.textContent='↺ Reset game';}
  showToast('✓ Đã reset game','success');
}

async function createNewGame() {
  if (!currentRoom) return;
  const btn=$('new-game-btn'); if(btn){btn.disabled=true;btn.textContent='⏳...';}
  const dist  = roomConfig.distribution||{1:2,2:2,3:2,5:3,10:4,15:2,20:5};
  const sv    = roomConfig.specialValues||[50,100];
  const total = roomConfig.totalEnvelopes||20;

  let pool=[];
  Object.entries(dist).forEach(([v,c])=>{for(let i=0;i<c;i++) pool.push(parseInt(v));});
  while(pool.length < total-sv.length) pool.push(10);
  pool=shuffle(pool).slice(0, total-sv.length);

  const svShuffled=shuffle([...sv]);
  const allPos=shuffle(Array.from({length:total},(_,i)=>i));
  const spPos=new Set(allPos.slice(0,sv.length));

  await sb.from('envelopes').delete().eq('room_id',currentRoom.id);
  await sb.from('events').delete().eq('room_id',currentRoom.id);

  const rows=[];
  let ni=0,si=0;
  for(let i=0;i<total;i++){
    if(spPos.has(i)){
      const displayVals=Object.keys(dist).map(Number).filter(v=>v<=20);
      const display=displayVals[Math.floor(Math.random()*displayVals.length)]||10;
      rows.push({room_id:currentRoom.id,position:i,display_value:display,real_value:svShuffled[si%svShuffled.length],is_special:true,opened:false,opened_at:null,opened_by:null});
      si++;
    } else {
      rows.push({room_id:currentRoom.id,position:i,display_value:pool[ni%pool.length]||10,real_value:pool[ni%pool.length]||10,is_special:false,opened:false,opened_at:null,opened_by:null});
      ni++;
    }
  }
  const {data,error}=await sb.from('envelopes').insert(rows).select();
  if(error){showToast('❌ '+error.message,'error');if(btn){btn.disabled=false;btn.textContent='🎲 Tạo game mới';}return;}
  await sb.from('rooms').update({opened_count:0,envelope_count:total}).eq('id',currentRoom.id);
  gameData=data.map(r=>({id:r.position+1,displayValue:r.display_value,realValue:r.real_value,isSpecial:r.is_special,opened:false,openedAt:null,openedBy:'',_dbId:r.id,position:r.position}));
  players=[];
  renderAll();
  if(btn){btn.disabled=false;btn.textContent='🎲 Tạo game mới';}
  showToast('🎉 Đã tạo game mới!','success');
}

/* ─── CLONE ROOM ─── */
async function cloneRoom() {
  if (!currentRoom) { showToast('Chưa chọn phòng', 'warn'); return; }
  showModal({
    title:'📑 Nhân bản phòng',
    body:`<div class="form-group"><label class="form-label">Tên phòng mới</label><input type="text" id="clone-title" value="Copy — ${escHtml(currentRoom.title)}" class="modal-input"/></div>`,
    confirmText:'📑 Nhân bản',
    async onConfirm() {
      const newId = Math.random().toString(36).substring(2,10).toUpperCase();
      const newTitle = $('clone-title')?.value || 'Phòng mới';
      const {error} = await sb.from('rooms').insert({
        id:newId, title:newTitle, host_name:currentRoom.host_name,
        subtitle:currentRoom.subtitle, emoji:currentRoom.emoji,
        pass_hash:currentRoom.pass_hash, is_open:false,
        envelope_count:currentRoom.envelope_count, opened_count:0,
        config:roomConfig
      });
      if(error){showToast('❌ '+error.message,'error');return;}
      showToast(`✓ Đã nhân bản phòng! ID: ${newId}`, 'success');
      if(isMasterAdmin) loadAllRooms();
    }
  });
}

/* ─── DELETE ROOM ─── */
async function deleteRoom() {
  if(!currentRoom){showToast('Chưa chọn phòng','warn');return;}
  showConfirm(`XÓA PHÒNG "${currentRoom.title}"?`, '⚠️ Hành động này KHÔNG THỂ hoàn tác. Toàn bộ dữ liệu phòng, phong bì và lịch sử sẽ bị xóa vĩnh viễn.', async()=>{
    await sb.from('rooms').delete().eq('id',currentRoom.id);
    showToast('✓ Đã xóa phòng','success');
    setTimeout(()=>location.href='/',1500);
  });
}

/* ─── EXPORT CSV ─── */
function exportCSV() {
  if (!currentRoom) { showToast('Chưa chọn phòng','error'); return; }
  const rows=[
    ['ID','Loại','Hiển thị','Thực','Trạng thái','Người bốc','Thời gian mở'],
    ...gameData.map(e=>[
      '#'+String(e.id).padStart(2,'0'),
      e.isSpecial?'Đặc biệt':'Thường',
      e.displayValue+'k',e.realValue+'k',
      e.opened?'Đã mở':'Chưa mở',
      e.openedBy||'—',
      e.openedAt?new Date(e.openedAt).toLocaleString('vi-VN'):'—'
    ])
  ];
  downloadCSV(rows, `phong-bi-${currentRoom.id}`);
  showToast('📥 Đã xuất CSV phong bì','success');
}

function exportPlayers() {
  if (!currentRoom) return;
  const rows=[
    ['STT','Tên','Mệnh giá hiển thị','Thực tế','Đặc biệt','Thời gian'],
    ...players.map((p,i)=>[i+1,p.player_name||'Ẩn danh',p.display_value+'k',p.real_value+'k',p.is_special?'Có':'Không',p.created_at?new Date(p.created_at).toLocaleString('vi-VN'):'—'])
  ];
  downloadCSV(rows, `nguoi-choi-${currentRoom.id}`);
  showToast('📥 Đã xuất CSV người chơi','success');
}

function downloadCSV(rows, name) {
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`lixi-${name}-${new Date().toLocaleDateString('vi-VN').replace(/\//g,'-')}.csv`;
  a.click();
}

/* ─── SHARE ─── */
function copyLink(id) {
  const el=$(id); if(!el) return;
  navigator.clipboard.writeText(el.textContent||el.value);
  showToast('✓ Đã copy link','success');
}
window.copyLink = copyLink;

function copyInput(id) {
  const el=$(id); if(!el) return;
  navigator.clipboard.writeText(el.value);
  showToast('✓ Đã copy','success');
}
window.copyInput = copyInput;

async function shareRoom() {
  if (!currentRoom) return;
  const url = `${location.origin}/room/${currentRoom.id}`;
  if (navigator.share) { navigator.share({title:currentRoom.title,url}); }
  else { navigator.clipboard.writeText(url); showToast('✓ Link đã copy!','success'); }
}

/* ─── QR CODE ─── */
function renderQR(url) {
  const c=$('qr-container'); if(!c) return;
  // Simple QR using a free API
  c.innerHTML=`<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=1a0002&margin=1" alt="QR Code" style="border-radius:8px;display:block;width:200px;height:200px" onerror="this.parentElement.innerHTML='<div style=\\'color:#666;font-size:.8rem;text-align:center;padding:20px\\'>QR không tải được</div>'"/>`;
}

/* ─── MASTER: CLOSE/OPEN ALL ROOMS ─── */
async function closeAllRooms() {
  showConfirm('Đóng TẤT CẢ phòng?','Tất cả người chơi sẽ không thể bốc thêm.',async()=>{
    await sb.from('rooms').update({is_open:false}).neq('id','__');
    showToast('🔴 Đã đóng tất cả phòng','success');
    loadAllRooms();
  });
}

async function openAllRooms() {
  showConfirm('Mở TẤT CẢ phòng?','Tất cả phòng sẽ được mở lại.',async()=>{
    await sb.from('rooms').update({is_open:true}).neq('id','__');
    showToast('🟢 Đã mở tất cả phòng','success');
    loadAllRooms();
  });
}

/* ─── NAVIGATION ─── */
function setupNavigation() {
  document.querySelectorAll('[data-tab]').forEach(link=>{
    link.addEventListener('click',()=>{
      document.querySelectorAll('[data-tab]').forEach(l=>l.classList.remove('active'));
      link.classList.add('active');
      const tab=link.dataset.tab;
      showTab(tab);
      $('top-bar-title').textContent=link.querySelector('.nav-label')?.textContent||tab;
      if(tab==='notifications'){notifCount=0;updateNotifBadge();renderNotifs();}
      if(tab==='rooms'&&isMasterAdmin) loadAllRooms();
      if(tab==='edit-envelopes') renderEnvBulkEditor();
      if(tab==='analytics') renderCharts();
      // close mobile sidebar
      $('sidebar').classList.remove('open');
    });
  });
}

function showTab(tab) {
  document.querySelectorAll('.tab-section').forEach(s=>s.classList.remove('active'));
  $('tab-'+tab)?.classList.add('active');
}

/* ─── CONTROLS ─── */
function setupControls() {
  $('env-search')?.addEventListener('input',()=>renderEnvTable($('env-filter')?.value,$('env-search').value));
  $('env-filter')?.addEventListener('change',()=>renderEnvTable($('env-filter').value,$('env-search')?.value));
  $('player-search')?.addEventListener('input',()=>renderPlayers());
  $('room-search')?.addEventListener('input',()=>{if(isMasterAdmin)loadAllRooms();});
  $('logout-btn')?.addEventListener('click',()=>{clearSession();location.href='/';});
  $('refresh-btn')?.addEventListener('click',async()=>{
    if(currentRoom){[gameData,players]=await Promise.all([loadEnvelopes(currentRoom.id),loadPlayers(currentRoom.id)]);renderAll();}
    if(isMasterAdmin) loadAllRooms();
    showToast('↺ Đã làm mới','info');
  });
  $('export-btn')?.addEventListener('click', exportCSV);
  $('export-btn2')?.addEventListener('click', exportPlayers);
  $('export-players-btn')?.addEventListener('click', exportPlayers);
  $('export-envelopes-btn')?.addEventListener('click', exportCSV);
  $('new-game-btn')?.addEventListener('click',()=>showConfirm('Tạo game mới?','Xóa toàn bộ dữ liệu hiện tại và tạo phân phối mới.',createNewGame));
  $('reset-game-btn')?.addEventListener('click',()=>showConfirm('Reset trạng thái?','Tất cả ô về chưa mở, xóa lịch sử.',resetGame));
  $('toggle-game-btn')?.addEventListener('click', toggleGameOpen);
  $('save-all-envs-btn')?.addEventListener('click', saveAllEnvelopes);
  $('shuffle-envs-btn')?.addEventListener('click', shuffleEnvelopes);
  $('auto-fill-btn')?.addEventListener('click', autoFillEnvelopes);
  $('save-text-btn')?.addEventListener('click', saveTextSettings);
  $('save-game-btn')?.addEventListener('click', saveGameSettings);
  $('save-dist-btn')?.addEventListener('click', saveDistSettings);
  $('save-msg-btn')?.addEventListener('click', saveMsgSettings);
  $('save-account-btn')?.addEventListener('click', saveAccountSettings);
  $('share-room-btn')?.addEventListener('click', shareRoom);
  $('clone-room-btn')?.addEventListener('click', cloneRoom);
  $('delete-room-btn')?.addEventListener('click',()=>showConfirm('XÓA PHÒNG?','Không thể hoàn tác!',deleteRoom));
  $('delete-all-events-btn')?.addEventListener('click',()=>showConfirm('Xóa lịch sử?','Xóa toàn bộ lịch sử bốc.',async()=>{if(!currentRoom)return;await sb.from('events').delete().eq('room_id',currentRoom.id);players=[];renderAll();showToast('✓ Đã xóa lịch sử','success');}));
  $('clear-history-btn')?.addEventListener('click',()=>showConfirm('Xóa lịch sử?','',async()=>{if(!currentRoom)return;await sb.from('events').delete().eq('room_id',currentRoom.id);players=[];renderAll();showToast('✓','success');}));
  $('batch-reset-btn')?.addEventListener('click', batchResetSelected);
  $('close-all-rooms-btn')?.addEventListener('click', closeAllRooms);
  $('open-all-rooms-btn')?.addEventListener('click', openAllRooms);
  $('export-all-btn')?.addEventListener('click',()=>showToast('Tính năng đang phát triển','info'));
  $('load-more-rooms-btn')?.addEventListener('click',()=>loadAllRooms());
}

/* ─── MODAL ─── */
function showModal({title,body,confirmText='✓ Xác nhận',onConfirm}) {
  $('generic-modal')?.remove();
  const m=document.createElement('div');
  m.id='generic-modal'; m.className='admin-modal-overlay';
  m.innerHTML=`<div class="admin-modal-card"><div class="admin-modal-header"><span class="admin-modal-title">${title}</span><button class="admin-modal-close" id="mc-x">✕</button></div><div class="admin-modal-body">${body}</div><div class="admin-modal-footer"><button class="action-btn action-btn-gold" id="mc-ok">${confirmText}</button><button class="action-btn" id="mc-cancel">Huỷ</button></div></div>`;
  document.body.appendChild(m);
  $('mc-x').onclick=$('mc-cancel').onclick=()=>m.remove();
  $('mc-ok').onclick=()=>{m.remove();onConfirm();};
  m.addEventListener('click',e=>{if(e.target===m)m.remove();});
}

function showConfirm(title,msg,onConfirm) {
  showModal({title,body:`<p style="color:var(--text-secondary);line-height:1.65;font-size:.88rem">${msg}</p>`,confirmText:'✓ Xác nhận',onConfirm});
}

/* ─── TOAST ─── */
const toastEl=$('toast');
let toastTimer;
function showToast(msg,type='info') {
  if(!toastEl) return;
  toastEl.innerHTML=msg;
  toastEl.className=`toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toastEl.classList.remove('show'),3500);
}

/* ─── UTILS ─── */
function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}
