// ── Constants ────────────────────────────────────────────────────────────────

const CHIP_META = {
  wildcard: { label: 'WC', cls: 'wc' },
  freehit:  { label: 'FH', cls: 'fh' },
  bboost:   { label: 'BB', cls: 'bb' },
  '3xc':    { label: 'TC', cls: 'tc' },
};

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
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No data yet — the first sync will run shortly.</td></tr>`;
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
      : `<span style="color:var(--muted);font-size:0.75rem">None</span>`;

    const leaderDiffTotal = leaderTotal != null ? Math.max(0, leaderTotal - (entry.total_points || 0)) : null;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="rank-cell">
          <span class="arrow ${arrowCls}">${arrowSym}</span>
          <span>${entry.rank}</span>
        </div>
      </td>
      <td><span class="team-name">${esc(entry.team_name)}</span></td>
      <td><span class="manager-name">${esc(entry.player_name)}</span></td>
      <td class="col-num pts-muted">${entry.event_total}</td>
      <td class="col-num pts-big">${entry.total_points}${fmtLeaderDelta(leaderDiffTotal)}</td>
      <td><div class="chips-wrap">${chipsHtml}</div></td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Points-over-time chart ────────────────────────────────────────────────────

let chart = null;

function renderChart(standings) {
  if (!standings?.length) return;
  if (typeof Chart === 'undefined') return;   // CDN not loaded

  // Collect all GW numbers that appear in any team's history
  const gwSet = new Set();
  standings.forEach(e => e.cumulative_history?.forEach(h => gwSet.add(h.gw)));
  const gwLabels = [...gwSet].sort((a, b) => a - b).slice(-5);

  const datasets = standings.filter(e => e.team_name !== 'GJ06_City_FC').map((entry, i) => {
    const map = Object.fromEntries(
      (entry.cumulative_history ?? []).map(h => [h.gw, h.total])
    );
    return {
      label: (entry.player_name || entry.team_name).split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase(),
      data: gwLabels.map(gw => map[gw] ?? null),
      borderColor: PALETTE[i % PALETTE.length],
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.3,
      spanGaps: true,
    };
  });

  const ctx = document.getElementById('points-chart').getContext('2d');
  if (chart) chart.destroy();

  const chartFont = { family: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", weight: 600 };

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: gwLabels.map(g => `GW${g}`), datasets },
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

  const badge = document.getElementById('gw-badge');
  if (gwFinished) {
    badge.textContent = 'FINAL';
    badge.className = 'gw-badge final';
  } else {
    badge.textContent = 'LIVE';
    badge.className = 'gw-badge live';
  }

  // Also set a standings header badge to mirror live/final state
  const standingsBadge = document.getElementById('standings-badge');
  if (standingsBadge) {
    if (gwFinished) {
      standingsBadge.textContent = 'FINAL';
      standingsBadge.className = 'gw-badge final';
    } else {
      standingsBadge.textContent = 'LIVE';
      standingsBadge.className = 'gw-badge live';
    }
  }

  const tbody = document.getElementById('gw-body');

  if (!gwStats?.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No data yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  // compute GW leader points
  const leaderGw = gwStats.length ? Math.max(...gwStats.map(s => s.gw_points || 0)) : null;

  gwStats.forEach(entry => {
    const isWinner  = gwFinished && entry.gw_points === leaderGw;
    const trophy    = isWinner ? '🏆 ' : '';
    const chipHtml  = entry.chip_used ? chipBadge(entry.chip_used) : dash();

    const leaderDiffGw = leaderGw != null ? Math.max(0, leaderGw - (entry.gw_points || 0)) : null;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="rank-cell"><span>${entry.gw_rank}</span></div>
      </td>
      <td><span class="team-name">${trophy}${esc(entry.team_name)}</span></td>
      <td><span class="manager-name">${esc(entry.player_name)}</span></td>
      <td class="col-num pts-big">${entry.gw_points}${fmtLeaderDelta(leaderDiffGw)}</td>
      <td class="col-chip">${chipHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Transfers table ───────────────────────────────────────────────────────────

function renderTransfers(transfers) {
  const tbody = document.getElementById('transfers-body');

  if (!transfers?.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No data yet.</td></tr>`;
    return;
  }

  const active = transfers.filter(e => e.transfers_in?.length || e.transfers_out?.length);

  if (!active.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No transfers this gameweek.</td></tr>`;
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
      <td><span class="team-name">${esc(entry.team_name)}</span></td>
      <td><span class="manager-name">${esc(entry.player_name)}</span></td>
      <td><div class="player-list">${inHtml}</div></td>
      <td><div class="player-list">${outHtml}</div></td>
      <td class="col-hit">${hitHtml}</td>
    `;
    tbody.appendChild(tr);
  });
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

    // Decide next refresh interval:
    // - If the current gameweek is not finished (live), poll frequently (5 minutes)
    // - Otherwise poll hourly to avoid unnecessary traffic
    const gwFinished = Boolean(data.meta?.gameweek_finished);
    const nextMs = gwFinished ? 60 * 60 * 1000 : 5 * 60 * 1000;

    // Schedule the next fetch
    setTimeout(fetchAndRender, nextMs);

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
