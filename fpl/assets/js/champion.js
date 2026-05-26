// ── Fireworks animation for champion overlay ─────────────────────────────────

(function () {
  const canvas = document.getElementById('fireworks-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  const COLORS = [
    '#ff1744', // vivid red
    '#ff9100', // bright orange
    '#ffea00', // electric yellow
    '#76ff03', // lime green
    '#00e676', // vivid green
    '#00e5ff', // cyan
    '#2979ff', // electric blue
    '#d500f9', // vivid magenta
    '#ff4081', // hot pink
    '#ffffff', // pure white
  ];

  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // ── Particle types ─────────────────────────────────────────────────────────

  const GRAVITY = 0.05;
  const FRICTION = 0.985;

  class Rocket {
    constructor() {
      this.x = Math.random() * width;
      this.y = height + 10;
      this.targetY = Math.random() * (height * 0.45) + height * 0.1;
      this.vx = (Math.random() - 0.5) * 0.6;
      this.vy = -(Math.random() * 2.5 + 6);
      this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
      this.trail = [];
      this.dead = false;
    }
    update() {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 8) this.trail.shift();
      this.x += this.vx;
      this.y += this.vy;
      this.vy += GRAVITY * 0.6;
      if (this.y <= this.targetY || this.vy >= 0) {
        this.dead = true;
        spawnBurst(this.x, this.y, this.color);
      }
    }
    draw(ctx) {
      // trail
      for (let i = 0; i < this.trail.length; i++) {
        const t = this.trail[i];
        const alpha = (i + 1) / this.trail.length * 0.6;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(this.color, alpha);
        ctx.fill();
      }
      // head
      ctx.beginPath();
      ctx.arc(this.x, this.y, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = this.color;
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  class Spark {
    constructor(x, y, color, angle, speed) {
      this.x = x;
      this.y = y;
      this.vx = Math.cos(angle) * speed;
      this.vy = Math.sin(angle) * speed;
      this.color = color;
      this.life = 1;
      this.decay = Math.random() * 0.008 + 0.005;
      this.size = Math.random() * 2.2 + 1.6;
    }
    update() {
      this.vx *= FRICTION;
      this.vy *= FRICTION;
      this.vy += GRAVITY;
      this.x += this.vx;
      this.y += this.vy;
      this.life -= this.decay;
    }
    draw(ctx) {
      if (this.life <= 0) return;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(this.color, this.life);
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    get dead() { return this.life <= 0; }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function withAlpha(hex, alpha) {
    // hex like #rrggbb
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  const rockets = [];
  const sparks = [];

  function spawnBurst(x, y, color) {
    const count = Math.floor(Math.random() * 50) + 100;
    // Occasionally use a different palette color for the burst
    const burstColor = Math.random() < 0.4
      ? COLORS[Math.floor(Math.random() * COLORS.length)]
      : color;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.1;
      const speed = Math.random() * 5 + 3.5;
      sparks.push(new Spark(x, y, burstColor, angle, speed));
    }
  }

  // ── Loop ───────────────────────────────────────────────────────────────────

  let lastSpawn = 0;
  const SPAWN_INTERVAL_MIN = 350; // ms
  const SPAWN_INTERVAL_MAX = 800;
  let nextSpawn = SPAWN_INTERVAL_MIN;

  function tick(t) {
    ctx.clearRect(0, 0, width, height);

    if (t - lastSpawn > nextSpawn) {
      rockets.push(new Rocket());
      // Sometimes launch two at once
      if (Math.random() < 0.35) rockets.push(new Rocket());
      lastSpawn = t;
      nextSpawn = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
    }

    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.update();
      r.draw(ctx);
      if (r.dead) rockets.splice(i, 1);
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.update();
      s.draw(ctx);
      if (s.dead) sparks.splice(i, 1);
    }

    requestAnimationFrame(tick);
  }

  // Respect reduced motion: render a single static-feel burst and stop
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    spawnBurst(width * 0.3, height * 0.35, '#fbbf24');
    spawnBurst(width * 0.7, height * 0.45, '#00ff87');
    let frames = 0;
    function shortLoop() {
      ctx.clearRect(0, 0, width, height);
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.update();
        s.draw(ctx);
        if (s.dead) sparks.splice(i, 1);
      }
      if (++frames < 240 && sparks.length) requestAnimationFrame(shortLoop);
    }
    shortLoop();
  } else {
    requestAnimationFrame(tick);
  }
})();
