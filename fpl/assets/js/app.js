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

function renderStandings(standings) {
  const tbody = document.getElementById('standings-body');

  if (!standings?.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">No data yet — the first sync will run shortly.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';

  standings.forEach(entry => {
    const diff = entry.last_rank === 0 ? 0 : entry.last_rank - entry.rank;
    const arrowCls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
    const arrowSym = diff > 0 ? '▲' : diff < 0 ? '▼' : '–';

    const chipsHtml = entry.chips_remaining.length
      ? entry.chips_remaining.map(chipBadge).join('')
      : `<span style="color:var(--muted);font-size:0.75rem">None</span>`;

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
      <td class="col-num pts-big">${entry.total_points}</td>
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
  const gwLabels = [...gwSet].sort((a, b) => a - b);

  const datasets = standings.map((entry, i) => {
    const map = Object.fromEntries(
      (entry.cumulative_history ?? []).map(h => [h.gw, h.total])
    );
    return {
      label: entry.team_name,
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

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: gwLabels.map(g => `GW${g}`), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#7c8db0',
            font: { size: 11 },
            boxWidth: 12,
            padding: 14,
          },
        },
        tooltip: {
          backgroundColor: '#1b1b35',
          borderColor: '#252545',
          borderWidth: 1,
          titleColor: '#e2e8f0',
          bodyColor: '#7c8db0',
          callbacks: {
            // Sort tooltip items by value descending
            afterBody: () => '',
          },
        },
      },
      scales: {
        x: {
          grid:  { color: '#252545' },
          ticks: { color: '#7c8db0', font: { size: 11 } },
        },
        y: {
          grid:  { color: '#252545' },
          ticks: { color: '#7c8db0', font: { size: 11 } },
        },
      },
    },
  });
}

// ── Gameweek stats table ──────────────────────────────────────────────────────

function renderGwStats(gwStats, gwFinished, gwNumber) {
  document.getElementById('gw-number').textContent = gwNumber ?? '–';

  const badge = document.getElementById('gw-badge');
  if (gwFinished) {
    badge.textContent = 'FINAL';
    badge.className = 'gw-badge final';
  } else {
    badge.textContent = 'LIVE';
    badge.className = 'gw-badge live';
  }

  const tbody = document.getElementById('gw-body');

  if (!gwStats?.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No data yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  const topPts = gwStats[0].gw_points;

  gwStats.forEach(entry => {
    const isWinner  = gwFinished && entry.gw_points === topPts;
    const trophy    = isWinner ? '🏆 ' : '';
    const chipHtml  = entry.chip_used ? chipBadge(entry.chip_used) : dash();

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="rank-cell"><span>${entry.gw_rank}</span></div>
      </td>
      <td><span class="team-name">${trophy}${esc(entry.team_name)}</span></td>
      <td><span class="manager-name">${esc(entry.player_name)}</span></td>
      <td class="col-num pts-big">${entry.gw_points}</td>
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

  tbody.innerHTML = '';

  transfers.forEach(entry => {
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

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  try {
    const res = await fetch(`data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const updatedEl = document.getElementById('last-updated');
    if (data.meta?.updated_at) {
      updatedEl.textContent = `Last updated: ${fmtDate(data.meta.updated_at)}`;
    }

    renderStandings(data.standings);
    renderChart(data.standings);
    renderGwStats(
      data.current_gw_stats,
      data.meta?.gameweek_finished ?? false,
      data.meta?.current_gameweek,
    );
    renderTransfers(data.transfers);

  } catch (err) {
    console.error('FPL load error:', err);
    document.querySelectorAll('.empty-row').forEach(el => {
      el.textContent = 'Could not load data. Please try again later.';
    });
  }
}

init();
