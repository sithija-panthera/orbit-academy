// Hero: a live 2D lidar sweep — the exact sensor students code against.
const canvas = document.getElementById('lidar-canvas');
const readout = document.getElementById('lidar-readout');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height, CX = W / 2, CY = H / 2;
const SCALE = 26; // px per meter

// Static obstacle field (matches the sim's crates-and-rocks vibe)
const obstacles = [
  { x: 4.2, y: -2.0, r: 0.9 }, { x: -3.4, y: -3.2, r: 0.7 }, { x: 2.4, y: 3.8, r: 1.1 },
  { x: -4.8, y: 2.2, r: 0.8 }, { x: 0.6, y: -5.2, r: 0.6 }, { x: -1.8, y: 4.9, r: 0.9 },
  { x: 6.0, y: 1.4, r: 0.7 }, { x: -6.2, y: -0.8, r: 1.0 },
];
const MAX_R = 7.5;
let sweep = 0;
const hits = new Array(240).fill(MAX_R);

function rayHit(angle) {
  let best = MAX_R;
  for (const o of obstacles) {
    const dx = o.x, dy = o.y;
    const proj = dx * Math.cos(angle) + dy * Math.sin(angle);
    if (proj <= 0) continue;
    const perp2 = dx * dx + dy * dy - proj * proj;
    if (perp2 > o.r * o.r) continue;
    const d = proj - Math.sqrt(o.r * o.r - perp2);
    if (d > 0 && d < best) best = d;
  }
  return best;
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function draw() {
  ctx.fillStyle = '#0b0e13';
  ctx.fillRect(0, 0, W, H);

  // range rings
  ctx.strokeStyle = '#1b2230';
  for (let r = 2; r <= 6; r += 2) {
    ctx.beginPath();
    ctx.arc(CX, CY, r * SCALE, 0, Math.PI * 2);
    ctx.stroke();
  }

  // sweep + record hits
  const steps = reduced ? hits.length : 3;
  for (let s = 0; s < steps; s++) {
    sweep = (sweep + 1) % hits.length;
    hits[sweep] = rayHit((sweep / hits.length) * Math.PI * 2);
  }

  // hit points (age-faded)
  for (let i = 0; i < hits.length; i++) {
    if (hits[i] >= MAX_R) continue;
    const a = (i / hits.length) * Math.PI * 2;
    const age = ((sweep - i + hits.length) % hits.length) / hits.length;
    ctx.fillStyle = `rgba(255, 106, 43, ${1 - age * 0.85})`;
    ctx.beginPath();
    ctx.arc(CX + Math.cos(a) * hits[i] * SCALE, CY + Math.sin(a) * hits[i] * SCALE, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // sweep beam
  if (!reduced) {
    const a = (sweep / hits.length) * Math.PI * 2;
    const grad = ctx.createLinearGradient(CX, CY, CX + Math.cos(a) * MAX_R * SCALE, CY + Math.sin(a) * MAX_R * SCALE);
    grad.addColorStop(0, 'rgba(74, 222, 128, 0.5)');
    grad.addColorStop(1, 'rgba(74, 222, 128, 0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.lineTo(CX + Math.cos(a) * MAX_R * SCALE, CY + Math.sin(a) * MAX_R * SCALE);
    ctx.stroke();
  }

  // rover marker
  ctx.fillStyle = '#d8dde5';
  ctx.beginPath();
  ctx.moveTo(CX + 8, CY);
  ctx.lineTo(CX - 6, CY - 6);
  ctx.lineTo(CX - 6, CY + 6);
  ctx.closePath();
  ctx.fill();

  const finite = hits.filter((h) => h < MAX_R);
  const min = finite.length ? Math.min(...finite) : NaN;
  readout.textContent = Number.isFinite(min)
    ? `min range ${min.toFixed(2)} m · ${finite.length}/${hits.length} returns`
    : 'min range — m';

  if (!reduced) requestAnimationFrame(draw);
}
draw();
