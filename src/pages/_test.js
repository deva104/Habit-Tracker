
import { auth, db } from '../js/firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, onSnapshot, setDoc, updateDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── State ──────────────────────────────────────────────
let user = null;
let habits = [];          // [{id, name}]
let completions = {};     // { "habitId_YYYY-MM-DD": true }
let startDate = null;     // Date object
let currentView = 'monthly';
let periodOffset = 0;     // how many periods back/forward
let chart = null;
let editingId = null;
let obHabits = [];

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}
window.showToast = showToast;

function isDone(hid, ds) {
  if (completions[`${hid}_${ds}`]) return true;
  const d = new Date(ds + 'T12:00:00');
  const utc = d.toISOString().slice(0, 10);
  return utc !== ds && !!completions[`${hid}_${utc}`];
}

function hideLoader() {
  document.getElementById('loader').classList.add('gone');
}

function safeRenderAll() {
  try {
    renderAll();
  } catch (err) {
    console.error('renderAll failed:', err);
    showToast('Could not display dashboard. Try refreshing.');
  }
}

function applyUserData(d) {
  habits      = d.habits || [];
  completions = d.completions || {};
  startDate   = d.startDate ? new Date(d.startDate) : new Date();
}

// ── Auth ───────────────────────────────────────────────
onAuthStateChanged(auth, (u) => {
  if (!u) { location.replace('login.html'); return; }
  user = u;
  const nm = u.displayName || (u.email ? u.email.split('@')[0] : 'User');
  document.getElementById('sb-av').textContent = nm.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  document.getElementById('sb-nm').textContent = nm;
  document.getElementById('tb-date').textContent = new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

  const ref = doc(db,'users',u.uid);
  onSnapshot(ref, (snap) => {
    try {
      if (!snap.exists()) {
        showOnboarding();
        return;
      }
      applyUserData(snap.data());
      safeRenderAll();
    } finally {
      setTimeout(hideLoader, 400);
    }
  }, (err) => {
    console.error('Firestore error:', err);
    showToast('Could not load habits. Check Firestore rules.');
    hideLoader();
  });
});

// ── Save ───────────────────────────────────────────────
async function save() {
  if (!user) return;
  await updateDoc(doc(db,'users',user.uid), { habits, completions });
}

// ── Dates ──────────────────────────────────────────────
function fmt(d) { // Date → "YYYY-MM-DD" (local calendar, not UTC)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function today() { return fmt(new Date()); }

function addDays(d, n) { const r=new Date(d); r.setDate(r.getDate()+n); return r; }

function getPeriodDays() {
  const now = new Date();
  if (currentView === 'daily') {
    // single day = today + offset days
    const d = addDays(now, periodOffset);
    return [d];
  }
  if (currentView === 'weekly') {
    // week containing today + offset weeks
    const base = addDays(now, periodOffset * 7);
    const dow = base.getDay(); // 0=Sun
    const mon = addDays(base, -((dow+6)%7)); // Monday
    return Array.from({length:7}, (_,i) => addDays(mon,i));
  }
  if (currentView === 'monthly') {
    // month + offset months
    const base = new Date(now.getFullYear(), now.getMonth() + periodOffset, 1);
    const daysInMonth = new Date(base.getFullYear(), base.getMonth()+1, 0).getDate();
    return Array.from({length:daysInMonth}, (_,i) => new Date(base.getFullYear(), base.getMonth(), i+1));
  }
  return []; // yearly handled separately
}

function getPeriodLabel() {
  const now = new Date();
  if (currentView === 'daily') {
    const d = addDays(now, periodOffset);
    if (periodOffset === 0) return 'Today';
    if (periodOffset === -1) return 'Yesterday';
    return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  }
  if (currentView === 'weekly') {
    const days = getPeriodDays();
    const s = days[0].toLocaleDateString('en-IN',{day:'numeric',month:'short'});
    const e = days[6].toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
    if (periodOffset === 0) return `This Week · ${s} – ${e}`;
    return `${s} – ${e}`;
  }
  if (currentView === 'monthly') {
    const base = new Date(now.getFullYear(), now.getMonth() + periodOffset, 1);
    return base.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  }
  if (currentView === 'yearly') {
    return String(now.getFullYear() + periodOffset);
  }
  return '';
}

// ── Render All ─────────────────────────────────────────
function renderAll() {
  updateStats();
  renderChart();
  renderBestWorst();
  renderDayBreakdown();
  if (currentView === 'yearly') {
    renderYearlyHeatmap();
  } else {
    renderTable();
  }
  document.getElementById('period-label').textContent = getPeriodLabel();
}

// ── Stats ──────────────────────────────────────────────
function updateStats() {
  const td = today();
  let todayDone = 0;
  habits.forEach(h => { if (isDone(h.id, td)) todayDone++; });
  const todayPct = habits.length ? Math.round(todayDone/habits.length*100) : 0;
  document.getElementById('s-today').textContent = todayPct+'%';
  document.getElementById('s-today-sub').textContent = `${todayDone} of ${habits.length} done`;

  // Period completion
  const days = currentView === 'yearly' ? [] : getPeriodDays();
  let periodDone=0, periodTotal=days.length*habits.length;
  days.forEach(d => habits.forEach(h => { if (isDone(h.id, fmt(d))) periodDone++; }));
  document.getElementById('s-period').textContent = periodTotal ? Math.round(periodDone/periodTotal*100)+'%' : '0%';

  // Best streak across all habits (longest current streak)
  let bestStreak = 0;
  habits.forEach(h => {
    let streak = 0, d = new Date();
    while(true) {
      if (isDone(h.id, fmt(d))) { streak++; d=addDays(d,-1); } else break;
    }
    if(streak > bestStreak) bestStreak = streak;
  });
  document.getElementById('s-streak').textContent = bestStreak;
  document.getElementById('s-habits').textContent = habits.length;
}

// ── Chart ──────────────────────────────────────────────
function renderChart() {
  let labels=[], data=[];

  if (currentView === 'daily') {
    // last 30 days
    for(let i=29;i>=0;i--) {
      const d = addDays(new Date(),-i);
      labels.push(d.toLocaleDateString('en-IN',{day:'numeric',month:'short'}));
      const done = habits.filter(h => isDone(h.id, fmt(d))).length;
      data.push(habits.length ? Math.round(done/habits.length*100) : 0);
    }
    document.getElementById('chart-title').textContent = 'Last 30 Days Completion';
  } else if (currentView === 'weekly') {
    // Show exactly the 7 days of the currently selected week period
    const days = getPeriodDays();
    days.forEach(d => {
      labels.push(d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));
      const done = habits.filter(h => isDone(h.id, fmt(d))).length;
      data.push(habits.length ? Math.round(done / habits.length * 100) : 0);
    });
    document.getElementById('chart-title').textContent = getPeriodLabel();
  } else if (currentView === 'monthly') {
    // Only the days in the current month period
    const days = getPeriodDays();
    days.forEach(d => {
      labels.push(String(d.getDate()));
      const done = habits.filter(h => isDone(h.id, fmt(d))).length;
      data.push(habits.length ? Math.round(done / habits.length * 100) : 0);
    });
    document.getElementById('chart-title').textContent = getPeriodLabel() + ' — Daily Completion';

  } else if (currentView === 'yearly') {
    // All 12 months of the selected year
    const yr = new Date().getFullYear() + periodOffset;
    for (let m = 0; m < 12; m++) {
      const daysInMonth = new Date(yr, m + 1, 0).getDate();
      let mDone = 0, mTotal = habits.length * daysInMonth;
      for (let d = 1; d <= daysInMonth; d++) {
        const day = new Date(yr, m, d);
        habits.forEach(h => { if (isDone(h.id, fmt(day))) mDone++; });
      }
      labels.push(MONTH_NAMES[m]);
      data.push(mTotal ? Math.round(mDone / mTotal * 100) : 0);
    }
    document.getElementById('chart-title').textContent = `${yr} — Monthly Breakdown`;
  }

  if (chart) { chart.data.labels=labels; chart.data.datasets[0].data=data; chart.update('none'); return; }

  if (typeof Chart === 'undefined') {
    console.warn('Chart.js not loaded');
    return;
  }

  const canvas = document.getElementById('main-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{
      data,
      borderColor: '#22c55e',
      backgroundColor: (ctx) => {
        const g = ctx.chart.ctx.createLinearGradient(0,0,0,170);
        g.addColorStop(0,'rgba(34,197,94,0.18)');
        g.addColorStop(1,'rgba(34,197,94,0)');
        return g;
      },
      borderWidth: 2.5,
      pointBackgroundColor: '#22c55e',
      pointRadius: 4,
      pointHoverRadius: 7,
      tension: 0.4,
      fill: true
    }]},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: c=>' '+c.raw+'%' } } },
      scales:{
        x:{ grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#64748b',font:{size:11}} },
        y:{ min:0,max:100, grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#64748b',font:{size:11},callback:v=>v+'%'} }
      }
    }
  });
}

// ── Best / Worst ───────────────────────────────────────
function renderBestWorst() {
  if (!habits.length) return;
  const now = new Date();
  const counts = habits.map(h => {
    let n=0;
    for(let i=0;i<30;i++) { if(isDone(h.id, fmt(addDays(now,-i)))) n++; }
    return {name:h.name, n};
  }).sort((a,b)=>b.n-a.n);
  const best=counts[0], worst=counts[counts.length-1];
  document.getElementById('best-name').textContent = best.name;
  document.getElementById('best-pct').textContent  = Math.round(best.n/30*100)+'% in last 30 days';
  document.getElementById('worst-name').textContent= worst.name;
  document.getElementById('worst-pct').textContent = Math.round(worst.n/30*100)+'% in last 30 days';
}

// ── Day breakdown ──────────────────────────────────────
function renderDayBreakdown() {
  const days = currentView === 'yearly' ? [] : getPeriodDays();
  let d100=0,d50=0,d0=0;
  days.forEach(d => {
    const done = habits.filter(h => isDone(h.id, fmt(d))).length;
    const pct = habits.length ? done/habits.length : 0;
    if(pct>=1) d100++; else if(pct>=0.5) d50++; else if(pct===0) d0++;
  });
  document.getElementById('d100').textContent=d100;
  document.getElementById('d50').textContent=d50;
  document.getElementById('d0').textContent=d0;
}

// ── Table ──────────────────────────────────────────────
function renderTable() {
  const days = getPeriodDays();
  const todayStr = today();
  const scroll = document.getElementById('tracker-scroll');

  if (!habits.length) {
    scroll.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);">No habits yet. Click <strong style="color:var(--accent)">＋ Add Habit</strong> to start tracking.</div>`;
    return;
  }

  let html = `<table class="htable"><thead><tr>
    <th class="col-habit">Habit</th>`;

  days.forEach(d => {
    const ds = fmt(d);
    const isToday = ds === todayStr;
    const dayName = DAY_NAMES[d.getDay()];
    const dayNum  = d.getDate();
    const monthAbbr = MONTH_NAMES[d.getMonth()];
    html += `<th class="day-head ${isToday?'today-head':''}">${dayName}<br><span style="font-size:10px;font-weight:400;">${dayNum} ${currentView==='monthly'?'':monthAbbr}</span></th>`;
  });

  html += `<th class="col-total">Total</th></tr></thead><tbody>`;

  habits.forEach(h => {
    // Calculate streak
    let streak=0, sd=new Date();
    while(isDone(h.id, fmt(sd))) { streak++; sd=addDays(sd,-1); }

    html += `<tr class="hrow" data-hid="${h.id}">
      <td class="col-habit">
        <div class="habit-name-wrap">
          <span class="habit-name-text">${h.name}</span>
          ${streak>0?`<span class="streak-chip">🔥${streak}</span>`:''}
          <span class="habit-actions">
            <button class="hact" onclick="openEdit('${h.id}')" title="Rename">✏️</button>
            <button class="hact del" onclick="deleteHabit('${h.id}')" title="Delete">🗑️</button>
          </span>
        </div>
      </td>`;

    let total=0;
    days.forEach(d => {
      const ds = fmt(d);
      const isToday = ds === todayStr;
      const isFuture = ds > todayStr;
      const done = isDone(h.id, ds);
      if(done) total++;
      const clickHandler = isFuture ? '' : `onclick="toggle('${h.id}','${ds}',this)"`;
      html += `<td><div class="cbox ${done?'on':''} ${isToday?'today-col':''} ${isFuture?'future':''}" ${clickHandler}>${done?'✓':''}</div></td>`;
    });

    const pct = days.length ? Math.round(total/days.length*100) : 0;
    html += `<td class="col-total"><div class="total-wrap"><div class="total-track"><div class="total-fill" style="width:${pct}%"></div></div><span class="total-num">${total}/${days.length}</span></div></td></tr>`;
  });

  html += `</tbody></table>`;
  scroll.innerHTML = html;
}

// ── Toggle ─────────────────────────────────────────────
window.toggle = function(hid, ds, el) {
  const key = `${hid}_${ds}`;
  const newVal = !isDone(hid, ds);
  completions[key] = newVal;
  el.classList.toggle('on', newVal);
  el.textContent = newVal ? '✓' : '';
  save();
  updateStats();
  renderChart();
  renderBestWorst();
  renderDayBreakdown();
  updateRowTotal(hid);
  if(newVal) checkFullDay(ds);
};

function updateRowTotal(hid) {
  const days = getPeriodDays();
  const row = document.querySelector(`tr[data-hid="${hid}"]`);
  if(!row) return;
  let total = days.filter(d => isDone(hid, fmt(d))).length;
  const pct = days.length ? Math.round(total/days.length*100) : 0;
  const cell = row.querySelector('.col-total');
  if(cell) cell.innerHTML = `<div class="total-wrap"><div class="total-track"><div class="total-fill" style="width:${pct}%"></div></div><span class="total-num">${total}/${days.length}</span></div>`;
}

function checkFullDay(ds) {
  if(!habits.length) return;
  const allDone = habits.every(h => isDone(h.id, ds));
  if(allDone) {
    confetti({particleCount:140,spread:80,origin:{y:0.6}});
    showToast('🎉 Perfect day! Every habit done!');
  }
}

// ── Yearly Heatmap ─────────────────────────────────────
function renderYearlyHeatmap() {
  const yr = new Date().getFullYear() + periodOffset;
  const jan1 = new Date(yr,0,1);
  const dec31 = new Date(yr,11,31);
  const startDow = jan1.getDay(); // 0=Sun

  // Build cells: pad to start on Sunday
  const scroll = document.getElementById('tracker-scroll');

  let html = `<div class="heatmap-wrap">`;

  // Month labels
  html += `<div class="heatmap-months">`;
  let curMonth = -1;
  for(let i=0;i<startDow;i++) html += `<div style="width:16px;flex-shrink:0;"></div>`;
  let dayCount = 0;
  let d = new Date(jan1);
  while(d.getFullYear()===yr) {
    if(d.getMonth()!==curMonth) {
      curMonth=d.getMonth();
      html+=`<div class="hm-month" style="flex:1;min-width:0;">${MONTH_NAMES[curMonth]}</div>`;
    } else {
      html+=`<div style="flex:1;min-width:0;"></div>`;
    }
    d=addDays(d,1); dayCount++;
  }
  html += `</div>`;

  // Grid
  html += `<div class="heatmap-body">`;

  // Day labels
  html += `<div class="hm-days">`;
  ['','Mon','','Wed','','Fri',''].forEach(l=>html+=`<div class="hm-day-label">${l}</div>`);
  html += `</div>`;

  // Cells
  html += `<div class="heatmap-grid">`;

  // Empty cells before Jan 1
  for(let i=0;i<startDow;i++) html+=`<div class="hm-cell" style="background:transparent"></div>`;

  d = new Date(jan1);
  while(d.getFullYear()===yr) {
    const ds = fmt(d);
    const done = habits.filter(h => isDone(h.id, ds)).length;
    const pct  = habits.length ? done/habits.length : 0;
    let cls = '';
    if(pct>0.75) cls='h4'; else if(pct>0.5) cls='h3'; else if(pct>0.25) cls='h2'; else if(pct>0) cls='h1';
    const isFuture = ds > today();
    const label = `${d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})} — ${done}/${habits.length} habits`;
    html += `<div class="hm-cell ${cls} ${isFuture?'style="opacity:0.3"':''}" data-tip="${label}" onmouseenter="showTip(event,this)" onmouseleave="hideTip()"></div>`;
    d=addDays(d,1);
  }

  html += `</div></div>`;

  // Legend
  html += `<div class="hm-legend">Less &nbsp;
    <div class="hm-leg-cell" style="background:rgba(255,255,255,0.05)"></div>
    <div class="hm-leg-cell h1"></div>
    <div class="hm-leg-cell h2"></div>
    <div class="hm-leg-cell h3"></div>
    <div class="hm-leg-cell h4"></div>
    &nbsp; More
  </div></div>`;

  scroll.innerHTML = html;
}

window.showTip = function(e, el) {
  const tip = document.getElementById('hm-tip');
  tip.textContent = el.dataset.tip;
  tip.style.display = 'block';
  tip.style.left = (e.clientX+12)+'px';
  tip.style.top  = (e.clientY-30)+'px';
};
window.hideTip = function() { document.getElementById('hm-tip').style.display='none'; };

// ── View switching ─────────────────────────────────────
window.setView = function(v, btn) {
  currentView = v;
  periodOffset = 0;
  document.querySelectorAll('.vtab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');

  const nav = document.getElementById('period-nav');
  nav.style.display = v === 'daily' ? 'none' : 'flex';

  document.getElementById('tracker-title').textContent =
    v==='daily'?'Today': v==='weekly'?'This Week': v==='monthly'?'This Month':'This Year';

  renderAll();
};

window.shiftPeriod = function(dir) {
  periodOffset += dir;
  renderAll();
};

// ── Habit management ───────────────────────────────────
window.openAdd = function() {
  editingId = null;
  document.getElementById('modal-title').textContent = 'Add New Habit';
  document.getElementById('habit-input').value = '';
  document.getElementById('habit-modal').classList.add('show');
  setTimeout(()=>document.getElementById('habit-input').focus(),80);
};

window.openEdit = function(id) {
  editingId = id;
  const h = habits.find(x=>x.id===id);
  if(!h) return;
  document.getElementById('modal-title').textContent = 'Rename Habit';
  document.getElementById('habit-input').value = h.name;
  document.getElementById('habit-modal').classList.add('show');
  setTimeout(()=>document.getElementById('habit-input').focus(),80);
};

window.closeModal = function() { document.getElementById('habit-modal').classList.remove('show'); };

window.confirmHabit = async function() {
  const name = document.getElementById('habit-input').value.trim();
  if(!name) return;
  if(editingId) {
    habits = habits.map(h=>h.id===editingId?{...h,name}:h);
    showToast('✏️ Habit renamed');
  } else {
    habits.push({id:'h'+Date.now(), name});
    showToast('✅ Habit added');
  }
  closeModal();
  await save();
  renderAll();
};

window.deleteHabit = async function(id) {
  if(!confirm('Delete this habit and all its history?')) return;
  habits = habits.filter(h=>h.id!==id);
  Object.keys(completions).forEach(k=>{ if(k.startsWith(id+'_')) delete completions[k]; });
  await save();
  renderAll();
  showToast('🗑️ Habit deleted');
};

document.getElementById('habit-input').addEventListener('keydown', e=>{ if(e.key==='Enter') window.confirmHabit(); });

// ── Onboarding ─────────────────────────────────────────
const DEFAULT_HABITS = ['Daily Exercise','Drink Water','Read 10 Pages','Sleep Before 11pm','No Junk Food'];

function showOnboarding() {
  document.getElementById('onboard').classList.add('show');
  document.getElementById('ob-date').value = fmt(new Date());
  obHabits = [...DEFAULT_HABITS];
  renderObHabits();
}

function renderObHabits() {
  const el = document.getElementById('ob-habits');
  el.innerHTML = obHabits.map((h,i)=>`
    <div class="onboard-habit-row">
      <span>${h}</span>
      <button onclick="obRemove(${i})">✕</button>
    </div>`).join('');
}

window.obAddHabit = function() {
  const inp = document.getElementById('ob-new');
  const val = inp.value.trim();
  if(!val) return;
  obHabits.push(val); inp.value='';
  renderObHabits();
};

window.obRemove = function(i) { obHabits.splice(i,1); renderObHabits(); };

document.getElementById('ob-new').addEventListener('keydown', e=>{ if(e.key==='Enter') window.obAddHabit(); });

window.obStart = async function() {
  const dateVal = document.getElementById('ob-date').value;
  if(!dateVal) return alert('Please pick a start date.');
  if(!obHabits.length) return alert('Add at least one habit.');
  const newHabits = obHabits.map((name,i)=>({id:'h'+i, name}));
  await setDoc(doc(db,'users',user.uid), {
    habits: newHabits,
    completions: {},
    startDate: dateVal,
    createdAt: serverTimestamp()
  });
  document.getElementById('onboard').classList.remove('show');
};

// ── Export drawer ──────────────────────────────────────
window.openExportDrawer = function() {
  document.getElementById('export-overlay').classList.add('show');
  document.getElementById('export-drawer').classList.add('open');
};

window.closeExportDrawer = function() {
  document.getElementById('export-overlay').classList.remove('show');
  document.getElementById('export-drawer').classList.remove('open');
};

function buildExportRows() {
  const dateSet = new Set();
  Object.keys(completions).forEach((key) => {
    const i = key.lastIndexOf('_');
    if (i > 0) dateSet.add(key.slice(i + 1));
  });
  const dates = [...dateSet].sort();
  const header = ['Date', ...habits.map((h) => h.name)];
  const rows = [header];
  dates.forEach((ds) => {
    rows.push([
      ds,
      ...habits.map((h) => (isDone(h.id, ds) ? 'Yes' : 'No')),
    ]);
  });
  return rows;
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

window.exportCSV = function() {
  if (!habits.length) return showToast('Add habits before exporting');
  const rows = buildExportRows();
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob(csv, `habittrack-${today()}.csv`, 'text/csv;charset=utf-8');
  showToast('📄 CSV downloaded');
};

window.exportExcel = function() {
  if (!habits.length) return showToast('Add habits before exporting');
  const rows = buildExportRows();
  const tsv = rows.map((r) => r.join('\t')).join('\n');
  downloadBlob(tsv, `habittrack-${today()}.xls`, 'application/vnd.ms-excel');
  showToast('📊 Excel file downloaded');
};

window.exportPDF = function() {
  if (!habits.length) return showToast('Add habits before exporting');
  const rows = buildExportRows();
  const w = window.open('', '_blank');
  if (!w) return showToast('Allow popups to export PDF');
  const tableRows = rows.map((r) => `<tr>${r.map((c) => `<td style="padding:6px 10px;border:1px solid #ccc">${c}</td>`).join('')}</tr>`).join('');
  const endScript = '<' + '/script>';
  w.document.write(`<!DOCTYPE html><html><head><title>HabitTrack Export</title></head><body style="font-family:sans-serif;padding:24px"><h1>HabitTrack Export</h1><p>Generated ${today()}</p><table style="border-collapse:collapse;width:100%">${tableRows}</table><script>window.onload=function(){window.print();}${endScript}</body></html>`);
  w.document.close();
  showToast('📑 PDF print dialog opened');
};

window.generateShareLink = async function() {
  if (!user) return;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  let shareId = snap.exists() ? snap.data().shareId : null;
  if (!shareId) {
    shareId = user.uid.slice(0, 8) + Date.now().toString(36);
    await updateDoc(ref, { shareId });
  }
  const base = location.href.replace(/[^/]*$/, '');
  const url = `${base}share.html?id=${shareId}`;
  document.getElementById('share-link-input').value = url;
  document.getElementById('share-link-row').style.display = 'flex';
  showToast('🔗 Share link ready');
};

window.copyShareLink = function() {
  const inp = document.getElementById('share-link-input');
  if (!inp.value) return showToast('Generate a link first');
  navigator.clipboard.writeText(inp.value).then(() => showToast('✓ Link copied'));
};

// ── Logout ─────────────────────────────────────────────
window.doLogout = async function() { await signOut(auth); location.replace('login.html'); };

currentView = 'monthly';
document.getElementById('period-nav').style.display = 'flex';
document.getElementById('tracker-title').textContent = 'This Month';

