/* ============================================================================
   BACK IN SMOOTHLY — the how-to diagram
   Drawn, not written. A miniature of the same dashboard, with the guide lines
   swinging in time with the phone. Whatever the player is about to do to the
   real thing, the diagram is already doing. No numbered steps, no paragraph.
   ========================================================================== */
(function (NS) {
  'use strict';

  /* the eight-point burst the poster is cut into */
  function burst(cx, cy, r1, r2, points) {
    const n = points || 8, out = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? r2 : r1;
      out.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
    }
    return out.join(' ');
  }

  let uid = 0;

  /* the camera feed, in miniature */
  function miniScene(x, y, w, h) {
    const id = 'bis' + (++uid);
    const wallTop = y + h * 0.12, floorY = y + h * 0.54;
    const cx = x + w / 2, bot = y + h;
    const pivotY = y + h * 1.02;                 // roughly the car's rear axle
    const r = Math.min(5, w * 0.05);
    const rail = (s) => `M${cx + s * w * 0.20},${bot} C${cx + s * w * 0.195},${bot - h * 0.16} ` +
                        `${cx + s * w * 0.145},${floorY + h * 0.10} ${cx + s * w * 0.10},${floorY + h * 0.02}`;
    return `
    <defs><clipPath id="c${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath></defs>
    <g clip-path="url(#c${id})">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#101112"/>
      <rect x="${x}" y="${wallTop}" width="${w}" height="${floorY - wallTop}" fill="#2f3233"/>
      <rect x="${x}" y="${floorY}" width="${w}" height="${bot - floorY}" fill="#1d1f20"/>
      <path d="M${cx - w * 0.13},${floorY} L${cx + w * 0.13},${floorY} L${cx + w * 0.25},${bot} L${cx - w * 0.25},${bot} Z"
            fill="rgba(255,234,0,0.03)" stroke="rgba(255,234,0,0.26)" stroke-width="${w * 0.008}"/>
      <polygon points="${burst(cx, y + h * 0.30, h * 0.115, h * 0.066)}"
               fill="#FFEA00" stroke="#fff" stroke-width="${w * 0.008}" stroke-linejoin="round"/>
      <g class="rails" style="transform-origin:${cx}px ${pivotY}px">
        <path d="${rail(-1)}" fill="none" stroke="#FFEA00" stroke-width="${w * 0.017}" stroke-linecap="round"/>
        <path d="${rail(1)}"  fill="none" stroke="#FFEA00" stroke-width="${w * 0.017}" stroke-linecap="round"/>
        <path d="M${cx - w * 0.195},${bot - h * 0.11} Q${cx},${bot - h * 0.145} ${cx + w * 0.195},${bot - h * 0.11}"
              fill="none" stroke="#FF2E12" stroke-width="${w * 0.021}" stroke-linecap="round"/>
      </g>
    </g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="rgba(159,141,199,0.3)" stroke-width="1"/>`;
  }

  /* the dashboard, in miniature: gear, display, sensor arcs, brake */
  function miniDash(x, y, w, h) {
    const cx = x + w / 2;
    const fw = w * 0.86, fx = cx - fw / 2, fy = y + h * 0.10, fh = fw * 0.94;
    const arcTop = fy + fh + h * 0.055;
    const arcs = [0, 1, 2].map((i) => {
      const rr = w * (0.11 + i * 0.065);
      return `<path d="M${cx - rr},${arcTop + i * h * 0.032} q${rr},${h * 0.028} ${rr * 2},0"
        fill="none" stroke="${i === 2 ? '#7BE03C' : 'rgba(244,243,239,0.16)'}" stroke-width="${w * 0.028}" stroke-linecap="round"/>`;
    }).join('');
    const by = y + h * 0.83, br = w * 0.125;
    return `
      <text x="${x + w * 0.09}" y="${y + h * 0.062}" font-family="DM Sans, sans-serif"
            font-size="${h * 0.036}" font-weight="700" letter-spacing="${w * 0.02}"
            fill="rgba(244,243,239,0.26)">P <tspan fill="#FFEA00">R</tspan> N D</text>
      ${miniScene(fx, fy, fw, fh)}
      ${arcs}
      <circle cx="${cx}" cy="${by}" r="${br}" fill="rgba(255,46,18,0.14)" stroke="rgba(255,46,18,0.55)" stroke-width="${w * 0.016}"/>
      <g class="press" style="transform-origin:${cx}px ${by}px">
        <circle cx="${cx}" cy="${by}" r="${br}" fill="rgba(255,46,18,0.5)"/>
      </g>`;
  }

  const CHEV = (x, y, dir, cls, s) =>
    `<path class="${cls || ''}" d="M${x + 6 * dir * s},${y - 10 * s} L${x - 4 * dir * s},${y} L${x + 6 * dir * s},${y + 10 * s}"
       fill="none" stroke="#FFEA00" stroke-width="${3.4 * s}" stroke-linecap="round" stroke-linejoin="round"/>`;

  const STYLE = `
    <style>
      .rails { animation: bisRails 3.6s cubic-bezier(.45,0,.55,1) infinite; }
      .phone { animation: bisPhone 3.6s cubic-bezier(.45,0,.55,1) infinite; }
      .chL, .keyL { animation: bisL 3.6s cubic-bezier(.45,0,.55,1) infinite; }
      .chR, .keyR { animation: bisR 3.6s cubic-bezier(.45,0,.55,1) infinite; }
      .press { animation: bisPress 3.6s ease-in-out infinite; opacity: 0; }
      .keyS  { animation: bisKeyS 3.6s ease-in-out infinite; }
      @keyframes bisRails { 0%,100% { transform: rotate(-9deg) } 50% { transform: rotate(9deg) } }
      @keyframes bisPhone { 0%,100% { transform: rotate(-10deg) } 50% { transform: rotate(10deg) } }
      @keyframes bisL { 0%, 30% { opacity: 1 } 55%, 100% { opacity: .2 } }
      @keyframes bisR { 0%, 45% { opacity: .2 } 70%, 95% { opacity: 1 } 100% { opacity: .2 } }
      @keyframes bisPress { 0%, 78%, 100% { opacity: 0 } 86%, 96% { opacity: 1 } }
      @keyframes bisKeyS { 0%, 78%, 100% { fill: rgba(159,141,199,0.14) } 86%, 96% { fill: rgba(255,46,18,0.32) } }
      @media (prefers-reduced-motion: reduce) {
        .rails, .phone, .chL, .chR, .keyL, .keyR, .press, .keyS { animation: none }
        .chL, .chR, .keyL, .keyR { opacity: .75 }
      }
    </style>`;

  /* ---- tilt ------------------------------------------------------------- */
  function tilt() {
    const px = 94, py = 12, pw = 112, ph = 258;
    const cx = px + pw / 2, cy = py + ph / 2;
    return `<svg viewBox="0 0 300 310" role="img" aria-label="Tilting the phone left and right swings the yellow guide lines on the reversing camera, showing where the back of the car will go. The red button below the display brakes.">
      ${STYLE}
      <path d="M78,292 A210,210 0 0 0 222,292" fill="none" stroke="rgba(159,141,199,0.45)"
            stroke-width="1.7" stroke-dasharray="4 7" stroke-linecap="round"/>
      ${CHEV(64, 292, 1, 'chL', 0.95)}
      ${CHEV(236, 292, -1, 'chR', 0.95)}
      <g class="phone" style="transform-origin:${cx}px ${cy}px">
        <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="15"
              fill="#171a1c" stroke="rgba(159,141,199,0.6)" stroke-width="1.6"/>
        <rect x="${cx - 15}" y="${py + 6}" width="30" height="3.2" rx="1.6" fill="#0a0b0b"/>
        ${miniDash(px + 5, py + 13, pw - 10, ph - 20)}
      </g>
    </svg>`;
  }

  /* ---- keyboard --------------------------------------------------------- */
  function keys() {
    const fw = 240, fx = (300 - fw) / 2, fy = 14, fh = fw * 0.82;
    const ky = fy + fh + 44;
    const key = (x, w, label, cls, size) => `
      <g>
        <rect class="${cls === 'keyS' ? 'keyS' : ''}" x="${x}" y="${ky}" width="${w}" height="40" rx="9"
              fill="rgba(159,141,199,0.14)"/>
        <rect x="${x}" y="${ky}" width="${w}" height="40" rx="9" fill="none"
              stroke="rgba(159,141,199,0.45)" stroke-width="1.4"/>
        <text class="${cls === 'keyS' ? '' : cls}" x="${x + w / 2}" y="${ky + 26}" text-anchor="middle"
              font-family="DM Sans, sans-serif" font-size="${size || 18}" font-weight="700"
              letter-spacing="1" fill="#FFEA00">${label}</text>
      </g>`;
    return `<svg viewBox="0 0 300 312" role="img" aria-label="The left and right arrow keys swing the yellow guide lines on the reversing camera, showing where the back of the car will go. The space bar brakes.">
      ${STYLE}
      ${miniScene(fx, fy, fw, fh)}
      ${key(50, 46, '←', 'keyL')}
      ${key(102, 46, '→', 'keyR')}
      ${key(160, 90, 'SPACE', 'keyS', 13)}
    </svg>`;
  }

  /* one line, no lecture */
  const CUE = {
    tilt: 'Tilt to steer · <b>hold</b> to brake',
    keys: '<b>← →</b> steer · <b>space</b> brakes',
  };
  const cue = (kind) => CUE[kind];

  NS.diagram = { tilt, keys, cue, burst };
})(window.PM = window.PM || {});
