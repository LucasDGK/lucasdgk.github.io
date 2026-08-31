// ── Constants ────────────────────────────────────────────────────────────────

const CHIP_META = {
  wildcard: { label: 'WC', cls: 'wc' },
  freehit:  { label: 'FH', cls: 'fh' },
  bboost:   { label: 'BB', cls: 'bb' },
  '3xc':    { label: 'TC', cls: 'tc' },
};

// Auto-scroll can be turned off for debugging with ?autoscroll=off (also 0 / false).
const AUTOSCROLL_ENABLED = !['off', '0', 'false']
  .includes((new URLSearchParams(location.search).get('autoscroll') ?? '').toLowerCase());

const PALETTE = [
  '#00ff87', '#a78bfa', '#f87171', '#60a5fa', '#fbbf24',
  '#34d399', '#f472b6', '#38bdf8', '#fb923c', '#c084fc',
  '#4ade80', '#e879f9', '#22d3ee', '#fde68a', '#a3e635',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return `Last updated a few seconds ago`;
  if (diffSec < 3600) return `Last updated ${Math.floor(diffSec / 60)} mins ago`;
  if (diffSec < 86400) return `Last updated ${Math.floor(diffSec / 3600)} hrs ago`;
  return `Last updated ${Math.floor(diffSec / 86400)} days ago`;
}

function chipBadge(name) {
  const m = CHIP_META[name];
  if (!m) return '';
  return `<span class="chip ${m.cls}">${m.label}</span>`;
}

// Managers are shown by first name only, to keep the tables narrow.
function firstName(name) {
  return String(name ?? '').trim().split(/\s+/)[0] ?? '';
}

function dash() {
  return `<span style="color:var(--muted)">–</span>`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Standings table ───────────────────────────────────────────────────────────

let FPL_DATA = null;

function fmtDelta(n) {
  if (n == null) return `<span class="delta same">–</span>`;
  if (n === 0) return `<span class="delta same">±0</span>`;
  const cls = n > 0 ? 'up' : 'down';
  const sign = n > 0 ? '+' : '';
  return `<span class="delta ${cls}">${sign}${n}</span>`;
}

function fmtLeaderDelta(diff) {
  if (diff == null) return `<span class="delta same">–</span>`;
  if (diff === 0) return `<span class="delta same">—</span>`;
  // diff > 0 means leader is ahead by `diff`
  return `<span class="delta down">−${diff}</span>`;
}

function renderStandings(standings) {
  const tbody = document.getElementById('standings-body');

  if (!standings?.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No data yet — the first sync will run shortly.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';

  // compute leader total points
  const leaderTotal = standings.length ? Math.max(...standings.map(s => s.total_points || 0)) : null;

  standings.forEach(entry => {
    const diff = entry.last_rank === 0 ? 0 : entry.last_rank - entry.rank;
    const arrowCls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
    const arrowSym = diff > 0 ? '▲' : diff < 0 ? '▼' : '–';

    const chipsHtml = entry.chips_remaining.length
      ? entry.chips_remaining.map(chipBadge).join('')
      : `<span class="chip-none">None</span>`;

    const leaderDiffTotal = leaderTotal != null ? Math.max(0, leaderTotal - (entry.total_points || 0)) : null;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="rank-cell">
          <span class="arrow ${arrowCls}">${arrowSym}</span>
          <span>${entry.rank}</span>
        </div>
      </td>
      <td><span class="team-name">${esc(firstName(entry.player_name))}</span></td>
      <td class="col-num pts-muted">${entry.event_total}</td>
      <td class="col-num pts-big">${entry.total_points}${fmtLeaderDelta(leaderDiffTotal)}</td>
      <td><div class="chips-wrap">${chipsHtml}</div></td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Points-over-time chart ────────────────────────────────────────────────────

let chart = null;
let pulseFrame = null;

function renderChart(standings) {
  if (!standings?.length) return;
  if (typeof Chart === 'undefined') return;   // CDN not loaded

  const gwFinished = Boolean(FPL_DATA?.meta?.gameweek_finished);
  const currentGw = FPL_DATA?.meta?.current_gameweek ?? null;

  // Collect all GW numbers that appear in any team's history
  const gwSet = new Set();
  standings.forEach(e => e.cumulative_history?.forEach(h => gwSet.add(h.gw)));
  // The live GW may be missing from every history until the API creates the row.
  if (currentGw != null) gwSet.add(currentGw);
  const gwLabels = [...gwSet].sort((a, b) => a - b).slice(-5);

  const lastIdx = gwLabels.length - 1;

  const datasets = standings.map((entry, i) => {
    const map = Object.fromEntries(
      (entry.cumulative_history ?? []).map(h => [h.gw, h.total])
    );
    // `cumulative_history` comes from the entry-history endpoint, which reports 0
    // points for a gameweek that has not been scored yet, while the standings
    // total updates live. Trust the standings for the current GW so the chart
    // always agrees with the league table.
    if (currentGw != null && entry.total_points != null) {
      map[currentGw] = entry.total_points;
    }
    return {
      label: firstName(entry.player_name || entry.team_name),
      data: gwLabels.map(gw => map[gw] ?? null),
      borderColor: PALETTE[i % PALETTE.length],
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.3,
      spanGaps: true,
      segment: {
        borderDash: ctx => (!gwFinished && ctx.p1DataIndex === lastIdx) ? [6, 4] : [],
      },
    };
  });

  const ctx = document.getElementById('points-chart').getContext('2d');
  // Tear down the previous chart *and* its pending pulse frame — otherwise the old
  // instance keeps redrawing stale data over the new chart on the shared canvas.
  if (pulseFrame !== null) {
    cancelAnimationFrame(pulseFrame);
    pulseFrame = null;
  }
  if (chart) chart.destroy();

  // Pulsing dot plugin for live GW
  const pulsePlugin = {
    id: 'pulseDot',
    afterDraw(instance) {
      if (gwFinished) return;
      const now = Date.now();
      const phase = (now % 1500) / 1500; // 0→1 over 1.5s
      const scale = 1 + phase * 2;
      const alpha = 1 - phase;

      instance.data.datasets.forEach((ds, di) => {
        const meta = instance.getDatasetMeta(di);
        const last = meta.data[meta.data.length - 1];
        if (!last) return;

        const cx = last.x;
        const cy = last.y;
        const color = ds.borderColor;

        instance.ctx.save();
        instance.ctx.beginPath();
        instance.ctx.arc(cx, cy, 3 * scale, 0, Math.PI * 2);
        instance.ctx.strokeStyle = color;
        instance.ctx.globalAlpha = alpha;
        instance.ctx.lineWidth = 2;
        instance.ctx.stroke();
        instance.ctx.restore();
      });

      // Keep the pulse animating, but only for the chart that is still live.
      // A replaced instance must not redraw its stale data onto the shared canvas.
      pulseFrame = requestAnimationFrame(() => {
        pulseFrame = null;
        if (instance === chart) instance.draw();
      });
    },
  };

  const chartFont = { family: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", weight: 600 };

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: gwLabels.map(g => `GW${g}`), datasets },
    plugins: [pulsePlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      devicePixelRatio: window.devicePixelRatio || 2,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: '#1b1b35',
          borderColor: '#252545',
          borderWidth: 1,
          titleColor: '#e2e8f0',
          bodyColor: '#7c8db0',
          titleFont: { ...chartFont, size: 14 },
          bodyFont: { ...chartFont, size: 13, weight: 400 },
          callbacks: {
            afterBody: () => '',
          },
        },
      },
      scales: {
        x: {
          grid:  { color: '#252545' },
          ticks: { color: '#7c8db0', font: { ...chartFont, size: 13, letterSpacing: 0.07 } },
        },
        y: {
          grid:  { color: '#252545' },
          ticks: { color: '#7c8db0', font: { ...chartFont, size: 13, letterSpacing: 0.07 } },
        },
      },
    },
  });
}

// ── Gameweek stats table ──────────────────────────────────────────────────────

function renderGwStats(gwStats, gwFinished, gwNumber) {
  const gwEls = document.querySelectorAll('.gw-number');
  gwEls.forEach(el => { el.textContent = gwNumber ?? '–'; });

  // Before GW1 there is no live or final gameweek to report on.
  const preseason = Boolean(FPL_DATA?.meta?.preseason);

  const badgeText = preseason ? 'PRE-SEASON' : gwFinished ? 'FINAL' : 'LIVE';
  const badgeCls  = preseason ? 'gw-badge' : gwFinished ? 'gw-badge final' : 'gw-badge live';

  const badge = document.getElementById('gw-badge');
  badge.textContent = badgeText;
  badge.className = badgeCls;

  // Also set a standings header badge to mirror pre-season/live/final state
  const standingsBadge = document.getElementById('standings-badge');
  if (standingsBadge) {
    standingsBadge.textContent = badgeText;
    standingsBadge.className = badgeCls;
  }

  const tbody = document.getElementById('gw-body');

  if (preseason) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">Season hasn’t started — points appear after the GW1 deadline.</td></tr>`;
    return;
  }

  if (!gwStats?.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No data yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  // compute GW leader points
  const leaderGw = gwStats.length ? Math.max(...gwStats.map(s => s.gw_points || 0)) : null;

  gwStats.forEach(entry => {
    const isWinner  = gwFinished && entry.gw_points === leaderGw;
    const trophy    = isWinner
      ? `<img class="gw-trophy" src="assets/trophy_2027_gw.png" alt="Gameweek winner">`
      : '';
    const chipHtml  = entry.chip_used ? chipBadge(entry.chip_used) : dash();

    const leaderDiffGw = leaderGw != null ? Math.max(0, leaderGw - (entry.gw_points || 0)) : null;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="rank-cell"><span>${entry.gw_rank}</span></div>
      </td>
      <td>
        <div class="manager-cell">
          <span class="gw-trophy-slot">${trophy}</span>
          <span class="team-name">${esc(firstName(entry.player_name))}</span>
        </div>
      </td>
      <td class="col-num pts-big">${entry.gw_points}${fmtLeaderDelta(leaderDiffGw)}</td>
      <td class="col-chip">${chipHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Transfers auto-scroll ─────────────────────────────────────────────────────
// The transfers card is the only one that can outgrow its box, so when it does we
// walk it down slowly, hold at the bottom, walk back up and rest at the top.

const SCROLL_SPEED_PX_S = 25;
const PAUSE_AT_TOP_MS = 60_000;
const PAUSE_AT_BOTTOM_MS = 5_000;

let scrollRaf = null;
let scrollTimer = null;

function stopAutoScroll() {
  if (scrollRaf !== null) cancelAnimationFrame(scrollRaf);
  if (scrollTimer !== null) clearTimeout(scrollTimer);
  scrollRaf = null;
  scrollTimer = null;
}

function startAutoScroll(el) {
  stopAutoScroll();
  if (!AUTOSCROLL_ENABLED || !el) return;

  const overflow = () => el.scrollHeight - el.clientHeight;

  // Animate in `dir` (+1 down, -1 up) at a constant px/s until the end is reached.
  function glide(dir, onArrive) {
    let last = performance.now();
    const step = now => {
      const max = overflow();
      // A refresh may have shortened the table mid-glide.
      if (max <= 0) { stopAutoScroll(); return; }

      el.scrollTop += dir * SCROLL_SPEED_PX_S * ((now - last) / 1000);
      last = now;

      if (dir > 0 ? el.scrollTop >= max - 0.5 : el.scrollTop <= 0.5) {
        el.scrollTop = dir > 0 ? max : 0;
        scrollRaf = null;
        onArrive();
        return;
      }
      scrollRaf = requestAnimationFrame(step);
    };
    scrollRaf = requestAnimationFrame(step);
  }

  function restAtTop() {
    scrollTimer = setTimeout(() => glide(1, restAtBottom), PAUSE_AT_TOP_MS);
  }

  function restAtBottom() {
    scrollTimer = setTimeout(() => glide(-1, restAtTop), PAUSE_AT_BOTTOM_MS);
  }

  // Wait a frame so the freshly built rows have been laid out before measuring.
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    if (overflow() <= 0) return;
    el.scrollTop = 0;
    restAtTop();
  });
}

// ── Transfers table ───────────────────────────────────────────────────────────

function renderTransfers(transfers) {
  const tbody = document.getElementById('transfers-body');
  stopAutoScroll();

  if (FPL_DATA?.meta?.preseason) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">Season hasn’t started — no transfers yet.</td></tr>`;
    return;
  }

  if (!transfers?.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No data yet.</td></tr>`;
    return;
  }

  const active = transfers.filter(e => e.transfers_in?.length || e.transfers_out?.length);

  if (!active.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-row">No transfers this gameweek.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';

  active.forEach(entry => {
    const inHtml = entry.transfers_in?.length
      ? entry.transfers_in.map(p => `<div class="player-in">↑ ${esc(p)}</div>`).join('')
      : `<span class="no-move">No transfer</span>`;

    const outHtml = entry.transfers_out?.length
      ? entry.transfers_out.map(p => `<div class="player-out">↓ ${esc(p)}</div>`).join('')
      : `<span class="no-move">–</span>`;

    const hitHtml = entry.transfer_cost > 0
      ? `<span class="hit">-${entry.transfer_cost}</span>`
      : dash();

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="team-name">${esc(firstName(entry.player_name))}</span></td>
      <td><div class="player-list">${inHtml}</div></td>
      <td><div class="player-list">${outHtml}</div></td>
      <td class="col-hit">${hitHtml}</td>
    `;
    tbody.appendChild(tr);
  });

  startAutoScroll(document.querySelector('#transfers-section .table-wrap'));
}

// ── Deadline countdown ────────────────────────────────────────────────────────

let deadlineInterval = null;

function renderDeadline(meta) {
  const el = document.getElementById('deadline-info');
  if (!el) return;

  const dl = meta?.next_deadline;
  const gw = meta?.next_gw;

  if (!dl) {
    el.textContent = '';
    return;
  }

  const deadline = new Date(dl);
  const dateStr = deadline.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  }).toUpperCase();

  function update() {
    const now = Date.now();
    const diff = deadline.getTime() - now;

    if (diff <= 0) {
      el.innerHTML = `NEXT DEADLINE · ${dateStr} · <span class="deadline-countdown urgent">LOCKED</span>`;
      if (deadlineInterval) clearInterval(deadlineInterval);
      return;
    }

    const days = Math.floor(diff / 86400000);
    const hrs  = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);

    let parts = [];
    if (days > 0) parts.push(`${days}D`);
    if (hrs > 0) parts.push(`${hrs}H`);
    parts.push(`${mins}M`);

    const urgent = diff < 86400000 ? ' urgent' : '';
    el.innerHTML = `NEXT DEADLINE · ${dateStr} · <span class="deadline-countdown${urgent}">${parts.join(' ')}</span>`;
  }

  update();
  if (deadlineInterval) clearInterval(deadlineInterval);
  deadlineInterval = setInterval(update, 60000);
}

// ── Bootstrap + Auto-refresh ─────────────────────────────────────────────────

async function fetchAndRender() {
  try {
    const res = await fetch(`data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    FPL_DATA = data;

    const updatedEl = document.getElementById('last-updated');
    if (data.meta?.updated_at) {
      updatedEl.textContent = timeAgo(data.meta.updated_at);
    }

    renderStandings(data.standings);
    renderChart(data.standings);
    renderDeadline(data.meta);
    renderGwStats(
      data.current_gw_stats,
      data.meta?.gameweek_finished ?? false,
      data.meta?.current_gameweek,
    );
    renderTransfers(data.transfers);

    // Refresh every 5 minutes
    setTimeout(fetchAndRender, 5 * 60 * 1000);

  } catch (err) {
    console.error('FPL load error:', err);
    document.querySelectorAll('.empty-row').forEach(el => {
      el.textContent = 'Could not load data. Please try again later.';
    });

    // On error, retry after a short backoff
    setTimeout(fetchAndRender, 2 * 60 * 1000);
  }
}

// Start the loop
fetchAndRender();
