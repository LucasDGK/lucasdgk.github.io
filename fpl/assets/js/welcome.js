// ─────────────────────────────────────────────────────────────────────────
// Helios World Cup welcome page.
// Renders the flag marquee, fades the logo + flags in once loaded, and
// runs the kickoff countdown.
// ─────────────────────────────────────────────────────────────────────────

// Country codes are derived from /assets/flags/*.png and rendered in
// alphabetical order, matching the source app's behaviour.
const COUNTRIES = [
  'ALG', 'ARG', 'AUS', 'AUT', 'BEL', 'BIH', 'BRA', 'CAN', 'CIV', 'COD',
  'COL', 'CPV', 'CRO', 'CUW', 'CZE', 'ECU', 'EGY', 'ENG', 'ESP', 'FRA',
  'GER', 'GHA', 'HAI', 'IRN', 'IRQ', 'JOR', 'JPN', 'KOR', 'KSA', 'MAR',
  'MEX', 'NED', 'NOR', 'NZL', 'PAN', 'PAR', 'POR', 'QAT', 'RSA', 'SCO',
  'SEN', 'SUI', 'SWE', 'TUN', 'TUR', 'URU', 'USA', 'UZB',
];

// Tournament kickoff: Mexico vs South Africa, 2026-06-11 15:00 ET (19:00 UTC).
const KICKOFF_MS = Date.UTC(2026, 5, 11, 19, 0, 0);

// ── Flag marquee ────────────────────────────────────────────────────────
function buildFlagSet(target, onLoad) {
  const frag = document.createDocumentFragment();
  COUNTRIES.forEach(code => {
    const img = document.createElement('img');
    img.src = `../assets/flags/${code}.png`;
    img.alt = code;
    img.loading = 'eager';
    if (onLoad) {
      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onLoad, { once: true });
    }
    frag.appendChild(img);
  });
  target.appendChild(frag);
}

function initFlagMarquee() {
  const track = document.getElementById('flags-track');
  const set1  = document.getElementById('flags-set-1');
  const set2  = document.getElementById('flags-set-2');
  if (!track || !set1 || !set2) return;

  let loaded = 0;
  const onLoad = () => {
    loaded += 1;
    if (loaded >= COUNTRIES.length) track.style.opacity = '1';
  };

  buildFlagSet(set1, onLoad);
  buildFlagSet(set2);                 // duplicate set, no need to count again
}

// ── Logo fade-in ────────────────────────────────────────────────────────
function initLogo() {
  const logo = document.getElementById('wc-logo');
  if (!logo) return;
  const reveal = () => logo.classList.add('is-loaded');
  if (logo.complete) reveal();
  else {
    logo.addEventListener('load', reveal, { once: true });
    logo.addEventListener('error', reveal, { once: true });
  }
}

// ── Countdown ───────────────────────────────────────────────────────────
function pad2(n) {
  return String(Math.max(0, n)).padStart(2, '0');
}

function tick() {
  const diff = KICKOFF_MS - Date.now();
  let days = 0, hours = 0, mins = 0, secs = 0;
  if (diff > 0) {
    days  = Math.floor(diff / 86_400_000);
    hours = Math.floor((diff / 3_600_000) % 24);
    mins  = Math.floor((diff / 60_000) % 60);
    secs  = Math.floor((diff / 1000) % 60);
  }
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = pad2(v);
  };
  set('cd-days', days);
  set('cd-hours', hours);
  set('cd-minutes', mins);
  set('cd-seconds', secs);
}

// ── Boot ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initFlagMarquee();
  initLogo();
  tick();
  setInterval(tick, 1000);
});
