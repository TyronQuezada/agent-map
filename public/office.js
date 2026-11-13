// Oficina pixel art (estilo 16 bits) del "Equipo de agentes". Todo se dibuja con rectángulos en un canvas de 192×144.
// Estados reales: durmiendo (zzz) o trabajando. Las idas a la impresora y al café son decorativas (al azar),
// salvo que un agente escriba un archivo: entonces a veces va a "imprimirlo".
(function () {
  const W = 192, H = 144, O = '#241a1a'; // O = contorno oscuro de los personajes

  const LOOKS = [
    { hair: '#a9a9b3', hairD: '#76767f', skin: '#f2c28c', skinD: '#d39a66', shirt: '#2d3f74', shirtD: '#1d2a50', pants: '#2a2a38', shoes: '#151515', tie: '#c8323c' }, // jefe: traje y corbata
    { hair: '#5b3a1f', hairD: '#3d2612', skin: '#e9b385', skinD: '#c48c5c', shirt: '#3f9b4f', shirtD: '#2b7038', pants: '#33475e', shoes: '#2b2b2b' },                  // agente 1: polerón verde
    { hair: '#e2a434', hairD: '#b37a1c', skin: '#f6cfa4', skinD: '#d9a676', shirt: '#8e4ec6', shirtD: '#663597', pants: '#2f3640', shoes: '#3b2430', tail: true },    // agente 2: cola de caballo
  ];

  let ctx; // contexto activo mientras se dibuja
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };

  // Partes con contorno: primero la silueta en oscuro (1 px más grande), después los colores.
  function parts(list) {
    for (const p of list) R(p[0] - 1, p[1] - 1, p[2] + 2, p[3] + 2, O);
    for (const p of list) R(p[0], p[1], p[2], p[3], p[4]);
  }

  /** Persona. (x, y) = pies. pose: 'front' | 'back' | 'sitFront' | 'sitBack' | 'sleepBack'. */
  function person(x, y, L, pose, frame = 0, opts = {}) {
    const back = pose === 'back' || pose === 'sitBack' || pose === 'sleepBack';
    const seated = pose.startsWith('sit') || pose === 'sleepBack';
    const dy = seated ? 4 : 0;                       // sentado = cuerpo más abajo
    const head = pose === 'sleepBack' ? 4 : 0;       // durmiendo sobre el escritorio
    const swing = pose === 'front' || pose === 'back' ? (frame ? 1 : -1) : 0;
    const list = [];
    // piernas (no se ven sentado de espaldas: las tapa la silla)
    if (!back || !seated) {
      const walking = pose === 'front' || pose === 'back';
      const l = walking && frame ? -1 : 0, r = walking && !frame ? -1 : 0; // pasos alternados
      if (pose === 'sitFront') list.push([x - 5, y - 8, 10, 3, L.pants], [x - 4, y - 5, 3, 3, L.pants], [x + 1, y - 5, 3, 3, L.pants]);
      else list.push([x - 4, y - 8 + l, 3, 6, L.pants], [x + 1, y - 8 + r, 3, 6, L.pants]);
      list.push([x - 5, y - 2 + l, 4, 2, L.shoes], [x + 1, y - 2 + r, 4, 2, L.shoes]);
    }
    // torso y brazos
    const ty = y - 16 + dy + (opts.breath || 0);
    if (pose === 'sleepBack') list.push([x - 9, ty + 3, 18, 4, L.shirt]);                                   // brazos cruzados sobre la mesa
    else if (opts.stretch) list.push([x - 7, ty - 11, 2, 12, L.shirt], [x + 5, ty - 11, 2, 12, L.shirt]);   // estirándose
    else if (pose === 'sitBack') list.push([x - 7, ty + 1 + (opts.armL || 0), 2, 5, L.shirt], [x + 5, ty + 1 + (opts.armR || 0), 2, 5, L.shirt]); // tecleando
    else list.push([x - 7, ty + 1 + swing, 2, 7, L.shirt], [x + 5, ty + 1 - swing, 2, 7, L.shirt]);         // caminando
    list.push([x - 5, ty, 10, 8, L.shirt]);
    // cabeza
    const hy = ty - 9 + head + (opts.bob || 0);
    list.push([x - 5, hy, 10, 9, back ? L.hair : L.skin]);
    list.push([x - 5, hy - 2, 10, 4, L.hair]); // pelo de arriba
    if (L.tail) list.push(back ? [x - 1, hy + 6, 3, 6, L.hair] : [x + 5, hy + 1, 2, 6, L.hair]);
    parts(list);
    // sombreado y detalles (sin contorno)
    R(x + 3, ty, 2, 8, L.shirtD);
    if (L.tie && !back) { R(x - 1, ty, 2, 6, L.tie); R(x - 2, ty, 4, 1, '#f2f2f2'); }
    if (opts.stretch) { R(x - 7, ty - 13, 2, 2, L.skin); R(x + 5, ty - 13, 2, 2, L.skin); }
    if (back) {
      R(x - 5, hy + 6, 10, 2, L.hairD); R(x + 3, hy, 2, 7, L.hairD);
      if (opts.turn) R(x + (opts.turn > 0 ? 4 : -5), hy + 3, 1, 3, L.skin); // mira hacia un lado (se le ve la oreja)
    } else {
      R(x + 3, hy + 2, 2, 7, L.skinD); R(x - 5, hy + 1, 10, 1, L.hairD); R(x - 5, hy + 2, 1, 3, L.hair); R(x + 4, hy + 2, 1, 3, L.hair);
      if (opts.sleep) { R(x - 3, hy + 5, 2, 1, O); R(x + 1, hy + 5, 2, 1, O); }          // ojos cerrados
      else { R(x - 3, hy + 4, 1, 2, O); R(x + 2, hy + 4, 1, 2, O); R(x - 3, hy + 4, 1, 1, '#fff6'); }
      R(x - 1, hy + 7, 2, 1, L.skinD);                                                   // boca
      if (!seated) { R(x - 7, ty + 7 + swing, 2, 2, L.skin); R(x + 5, ty + 7 - swing, 2, 2, L.skin); } // manos
    }
    if (opts.cup) { R(x + 6, ty + 5, 3, 3, '#f4f4f4'); R(x + 6, ty + 5, 3, 1, '#6b3e1f'); }
  }

  // "Z" de 3×3 que sube y se desvanece sobre quien duerme.
  function zzz(x, y, t) {
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.45 + i / 3) % 1;
      ctx.globalAlpha = Math.sin(p * Math.PI);
      const zx = x + 3 + p * 8 + i, zy = y - p * 14;
      const s = i === 2 ? 2 : 1;
      for (const [ox, c] of [[1, '#1d2a50'], [0, '#ffffff']]) { // sombra azul oscura + Z blanca: se lee sobre cualquier fondo
        R(zx + ox, zy + ox, 3 * s, s, c); R(zx + s + ox, zy + s + ox, s, s, c); R(zx + ox, zy + 2 * s + ox, 3 * s, s, c);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Globito "…" sobre quien está tecleando: así se nota de lejos que trabaja.
  function typingDots(x, y, t) {
    R(x - 6, y - 1, 13, 5, O); R(x - 5, y, 11, 3, '#ffffff');
    const on = Math.floor(t * 5) % 3;
    for (let i = 0; i < 3; i++) R(x - 4 + i * 4, y + 1, 1, 1, i === on ? '#3d64a4' : '#b9c2d6');
  }

  // ---------- escenario ----------
  function room(t) {
    // pared con papel a rayas, moldura y zócalo
    R(0, 0, W, 36, '#d9c8a6');
    for (let x = 0; x < W; x += 8) R(x, 3, 1, 30, '#ccb892');
    R(0, 0, W, 3, '#b39b72'); R(0, 33, W, 4, '#6b4a2f'); R(0, 33, W, 1, '#8b6343');
    // ventana con nubes que se mueven
    R(63, 5, 66, 23, '#8a7f6a'); R(64, 6, 64, 21, '#f2efe6');
    for (let i = 0; i < 17; i++) R(66, 8 + i, 60, 1, i < 6 ? '#79bff0' : i < 12 ? '#94cff4' : '#b5def8');
    for (const [cx, cy, w] of [[0, 11, 14], [40, 16, 10], [80, 9, 12]]) {
      const x = 66 + ((cx + t * 3) % 74) - 7;
      ctx.save(); ctx.beginPath(); ctx.rect(66, 8, 60, 17); ctx.clip();
      R(x, cy, w, 3, '#ffffff'); R(x + 2, cy - 2, w - 5, 2, '#ffffff'); R(x + 1, cy + 3, w - 2, 1, '#dbeefb');
      ctx.restore();
    }
    R(95, 6, 2, 21, '#f2efe6'); R(64, 16, 64, 2, '#f2efe6'); R(62, 27, 68, 2, '#c9c1ad');
    // reloj de pared con la hora real
    R(147, 7, 11, 11, O); R(148, 8, 9, 9, '#f7f3e8');
    const now = new Date(), cx = 152, cy = 12;
    const hand = (ang, len, c) => { for (let i = 1; i <= len; i++) R(cx + Math.round(Math.sin(ang) * i), cy - Math.round(Math.cos(ang) * i), 1, 1, c); };
    hand((now.getHours() % 12 + now.getMinutes() / 60) / 12 * 2 * Math.PI, 2, O);
    hand(now.getMinutes() / 60 * 2 * Math.PI, 3, '#c8323c');
    // cuadro
    R(33, 8, 18, 14, '#6b4a2f'); R(35, 10, 14, 10, '#4f8a5b'); R(35, 16, 14, 4, '#3a6b45'); R(43, 11, 3, 3, '#f5d76e');
    // piso de tablas desfasadas
    for (let y = 37, row = 0; y < H; y += 6, row++) {
      R(0, y, W, 6, row % 2 ? '#a87444' : '#b37d4b');
      R(0, y, W, 1, '#7d5430');
      for (let x = (row % 3) * 11; x < W; x += 33) R(x, y + 1, 1, 5, '#8c5f36');
    }
    // alfombra bajo el escritorio del jefe
    R(64, 62, 64, 24, '#2e4f86'); R(66, 64, 60, 20, '#3d64a4'); R(68, 66, 56, 16, '#2e4f86'); R(70, 68, 52, 12, '#3d64a4');
  }

  // De noche (sin tokens): cielo oscuro con luna y estrellas en la ventana.
  function nightWindow(t) {
    for (let i = 0; i < 17; i++) R(66, 8 + i, 60, 1, i < 8 ? '#0b1430' : '#16224a');
    // luna creciente: disco redondeado y la sombra corrida a la derecha
    R(108, 10, 4, 1, '#f4f0c8'); R(107, 11, 6, 4, '#f4f0c8'); R(108, 15, 4, 1, '#f4f0c8');
    R(110, 10, 3, 1, '#0b1430'); R(110, 11, 4, 4, '#0b1430'); R(110, 15, 3, 1, '#0b1430');
    for (const [sx, sy, k] of [[70, 11, 0], [79, 19, 1], [88, 9, 2], [101, 21, 3], [120, 13, 4], [124, 22, 5]]) {
      if (Math.sin(t * 2 + k) > -0.3) R(sx, sy, 1, 1, '#ffffff');
    }
    R(95, 6, 2, 21, '#c9c1ad'); R(64, 16, 64, 2, '#c9c1ad');
  }

  function desk(x, y, w) { // y = borde de arriba de la cubierta
    R(x - 1, y - 1, w + 2, 16, O);
    R(x, y, w, 8, '#c48a52'); R(x, y, w, 1, '#dba56b'); R(x, y + 8, w, 6, '#8a5a33'); R(x, y + 8, w, 1, '#6e4628');
    R(x + 2, y + 10, w - 4, 1, '#a46c3e');
    R(x + 1, y + 14, 3, 3, '#5a3a20'); R(x + w - 4, y + 14, 3, 3, '#5a3a20');
  }

  function pc(x, y, on, t) { // monitor CRT de 14×12 + teclado
    R(x - 1, y - 1, 16, 14, O);
    R(x, y, 14, 12, '#e3dccb'); R(x + 11, y, 3, 12, '#c2b89f'); R(x, y + 11, 14, 1, '#b3a98f');
    R(x + 2, y + 2, 10, 7, on ? '#123d25' : '#1d2a35');
    if (on) for (let i = 0; i < 3; i++) { // líneas de código que avanzan
      const len = 3 + Math.floor((Math.sin(t * 3 + i * 2.1) + 1) * 3);
      R(x + 3, y + 3 + i * 2, len, 1, i === 1 ? '#f5d76e' : '#7dffb0');
    } else R(x + 3, y + 3, 2, 1, '#2f4252');
    R(x + 5, y + 12, 4, 2, '#b3a98f');
    R(x - 1, y + 14, 16, 3, O); R(x, y + 14, 14, 2, '#d6cfbd'); R(x + 1, y + 14, 12, 1, '#efe9d9');
  }

  function chairBack(x, y) { // respaldo de silla de oficina visto desde atrás
    R(x - 7, y - 7, 14, 6, O); R(x - 6, y - 6, 12, 4, '#3b3f4c'); R(x - 6, y - 6, 12, 1, '#565b6b'); // bajo: deja ver hombros y brazos
    R(x - 1, y - 1, 2, 2, O); R(x - 5, y + 1, 10, 1, O);
  }

  function armchair(x, y, front) { // sillón rojo de cuero
    if (!front) {
      R(x - 12, y - 26, 24, 22, O); R(x - 11, y - 25, 22, 14, '#a8323a'); R(x - 11, y - 25, 22, 2, '#c94a50');
      R(x - 9, y - 11, 18, 6, '#8e2830'); R(x - 9, y - 11, 18, 1, '#c94a50'); R(x - 11, y - 4, 22, 2, '#5a181d');
    } else {
      for (const ax of [x - 13, x + 9]) { R(ax - 1, y - 17, 6, 14, O); R(ax, y - 16, 4, 12, '#b7383f'); R(ax, y - 16, 4, 2, '#d65a60'); }
      R(x - 12, y - 3, 3, 3, '#3b2414'); R(x + 9, y - 3, 3, 3, '#3b2414');
    }
  }

  function coffeeMachine(x, y, t, busy) {
    R(x - 1, y + 19, 26, 13, O); R(x, y + 20, 24, 11, '#8a5a33'); R(x, y + 20, 24, 1, '#c48a52'); // mueble
    R(x + 4, y - 1, 16, 22, O); R(x + 5, y, 14, 20, '#3d3f4c'); R(x + 5, y, 14, 3, '#5a5d70');
    R(x + 8, y + 5, 8, 4, '#1b1c22'); R(x + 15, y + 4, 2, 2, Math.sin(t * 4) > 0 ? '#ff4b4b' : '#7a1f1f');
    R(x + 9, y + 12, 6, 6, '#26272f'); R(x + 10, y + 15, 4, 3, '#f4f4f4');
    if (busy) for (let i = 0; i < 3; i++) { ctx.globalAlpha = 0.6; R(x + 11 + Math.round(Math.sin(t * 5 + i)), y + 10 - ((t * 10 + i * 3) % 8), 1, 2, '#ffffff'); ctx.globalAlpha = 1; }
  }

  function printer(x, y, t, busy) {
    R(x - 1, y + 9, 30, 4, O); R(x, y + 10, 28, 2, '#8a5a33'); R(x + 2, y + 12, 2, 8, '#5a3a20'); R(x + 24, y + 12, 2, 8, '#5a3a20'); // mesa
    R(x + 2, y - 1, 24, 11, O); R(x + 3, y, 22, 9, '#e8e8e8'); R(x + 3, y + 6, 22, 3, '#c9c9c9');
    R(x + 6, y + 2, 16, 2, '#4a4a4a'); R(x + 21, y + 6, 2, 1, busy ? '#4bff7a' : '#2f7a45');
    if (busy) { const p = Math.min(1, (t % 1.8) / 1.2); R(x + 8, y + 9 - Math.round(p * 6), 12, Math.round(p * 6) + 1, '#ffffff'); R(x + 10, y + 10 - Math.round(p * 4), 8, 1, '#9aa'); }
  }

  function plant(x, y, t) {
    const sway = Math.round(Math.sin(t * 1.3));
    for (const [dx, dy, c] of [[-6, -22, '#2f7d3a'], [2, -24, '#3c9a48'], [-2, -28, '#4cb45a'], [-8, -16, '#3c9a48'], [4, -17, '#2f7d3a']]) {
      R(x + dx + sway - 1, y + dy - 1, 8, 9, O);
    }
    for (const [dx, dy, c] of [[-6, -22, '#2f7d3a'], [2, -24, '#3c9a48'], [-2, -28, '#4cb45a'], [-8, -16, '#3c9a48'], [4, -17, '#2f7d3a']]) R(x + dx + sway, y + dy, 6, 7, c);
    R(x - 7, y - 11, 14, 12, O); R(x - 6, y - 10, 12, 10, '#b5562f'); R(x - 6, y - 10, 12, 2, '#d6713f'); R(x + 3, y - 8, 3, 8, '#923f1f');
  }

  // ---------- personajes y su lógica ----------
  const SPOTS = {
    bossSeat: { x: 96, y: 78 }, armchair: { x: 22, y: 136 },
    seat1: { x: 58, y: 122 }, seat2: { x: 134, y: 122 },
    coffee: { x: 16, y: 58 }, printer: { x: 172, y: 68 },
  };
  const SPEED = 34; // px/s

  // ---------- caminos que esquivan muebles ----------
  // Muebles en px del canvas [x, y, ancho, alto]. Los pies de un personaje no pueden entrar en ellos (ni en la pared).
  const BLOCKS = [
    [4, 33, 24, 13],    // mueble y máquina de café
    [158, 43, 28, 12],  // mesa de la impresora
    [75, 45, 42, 18],   // escritorio del jefe
    [39, 89, 38, 18],   // escritorio 1
    [115, 89, 38, 18],  // escritorio 2
    [9, 108, 27, 22],   // respaldo y brazos del sillón
    [173, 98, 18, 32],  // planta
  ];
  const CELL = 4, COLS = W / CELL, ROWS = H / CELL;
  const blocked = (() => {
    const g = new Uint8Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const px = c * CELL + 2, py = r * CELL + 2;
      g[r * COLS + c] = py < 46 || py > H - 4 || BLOCKS.some(([x, y, w, h]) => px > x - 6 && px < x + w + 6 && py > y - 2 && py < y + h + 2) ? 1 : 0;
    }
    return g;
  })();
  /** Camino en esquinas (como en los juegos de 16 bits) que no atraviesa muebles. null si no hay. */
  function findPath(from, to) {
    const cell = p => [Math.max(0, Math.min(COLS - 1, Math.floor(p.x / CELL))), Math.max(0, Math.min(ROWS - 1, Math.floor(p.y / CELL)))];
    const [sc, sr] = cell(from), [gc, gr] = cell(to), start = sr * COLS + sc, goal = gr * COLS + gc;
    const prev = new Int32Array(COLS * ROWS).fill(-1);
    prev[start] = start;
    const queue = [start];
    for (let q = 0; q < queue.length && prev[goal] < 0; q++) {
      const cur = queue[q], c = cur % COLS, r = (cur - c) / COLS;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr, n = nr * COLS + nc;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || prev[n] >= 0) continue;
        if (blocked[n] && n !== goal) continue; // el destino puede estar pegado a un mueble (silla, sillón)
        prev[n] = cur; queue.push(n);
      }
    }
    if (prev[goal] < 0) return null;
    const cells = [];
    for (let n = goal; n !== start; n = prev[n]) cells.push(n);
    cells.reverse();
    const pts = [];
    cells.forEach((n, i) => { // solo las esquinas
      const a = cells[i - 1] ?? start, b = cells[i + 1];
      if (b === undefined || (b - n) !== (n - a)) pts.push({ x: (n % COLS) * CELL + 2, y: Math.floor(n / COLS) * CELL + 2 });
    });
    pts[pts.length - 1] = { x: to.x, y: to.y };
    return pts;
  }

  function makeChar(i) {
    const boss = i === 0;
    const seat = boss ? SPOTS.bossSeat : i === 1 ? SPOTS.seat1 : SPOTS.seat2;
    const home = boss ? SPOTS.armchair : seat;
    return { i, boss, look: LOOKS[i], seat, home, x: home.x, y: home.y, at: 'home', act: 'sit', awake: false,
      path: [], dest: null, wait: 0, cup: 0, facing: 'down', anim: Math.random(), next: 10 + Math.random() * 10, pingPrint: false,
      fidget: 2 + Math.random() * 3, pause: 0, stretch: 0, turn: 1, // gestos mientras trabaja
      aisle: boss ? 70 : 100 };
  }

  function walkTo(c, dest) {
    const to = dest === 'seat' ? c.seat : dest === 'home' ? c.home : SPOTS[dest];
    c.path = findPath(c, to) || [{ x: c.aisle, y: c.y }, { x: c.aisle, y: to.y }, { x: to.x, y: to.y }];
    c.dest = dest; c.act = 'walk';
  }

  function step(c, want, dt) {
    c.anim += dt;
    if (c.cup > 0) c.cup -= dt;
    if (c.act === 'walk') {
      let left = SPEED * dt;
      while (left > 0 && c.path.length) {
        const p = c.path[0], dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
        if (d <= left) { c.x = p.x; c.y = p.y; c.path.shift(); left -= d; continue; }
        c.x += dx / d * left; c.y += dy / d * left;
        c.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy < 0 ? 'up' : 'down';
        left = 0;
      }
      if (!c.path.length) arrive(c, want);
      return;
    }
    if (c.act === 'print' || c.act === 'coffee') {
      c.wait -= dt;
      if (c.wait <= 0) { if (c.act === 'coffee') c.cup = 6; walkTo(c, want ? 'seat' : 'home'); }
      return;
    }
    // sentado
    if (want && !c.awake) { c.awake = true; if (c.at !== 'seat') walkTo(c, 'seat'); return; }
    if (!want && c.awake) {
      if (c.at === 'seat' && c.home !== c.seat) walkTo(c, 'home');
      else { c.awake = false; c.at = 'home'; }
      return;
    }
    if (want && c.at === 'seat') {
      // Gestos: a ratos deja de teclear y mira a un lado, o se estira.
      c.pause -= dt; c.stretch -= dt; c.fidget -= dt;
      if (c.fidget <= 0) {
        c.fidget = 2.5 + Math.random() * 3.5;
        const g = Math.random();
        if (g < 0.35) { c.pause = 0.8 + Math.random() * 0.8; c.turn = Math.random() < 0.5 ? -1 : 1; }
        else if (g < 0.5) c.stretch = 1.1;
      }
      c.next -= dt;
      // Pasan casi todo el tiempo sentados: se levantan cada 15–30 s, y no siempre.
      if (c.pingPrint && !c.boss && c.next < 8) { c.pingPrint = false; c.next = 15 + Math.random() * 15; walkTo(c, 'printer'); return; }
      if (c.next <= 0) {
        c.next = 15 + Math.random() * 15;
        const r = Math.random();
        if (r < 0.2) walkTo(c, 'coffee');
        else if (r < 0.4 && !c.boss) walkTo(c, 'printer');
      }
    }
  }

  function arrive(c, want) {
    if (c.dest === 'printer') { c.act = 'print'; c.wait = 1.8; c.facing = 'up'; return; }
    if (c.dest === 'coffee') { c.act = 'coffee'; c.wait = 2.4; c.facing = 'up'; return; }
    c.act = 'sit';
    c.at = c.dest === 'seat' ? 'seat' : 'home';
    if (c.at === 'home' && !want) c.awake = false;
  }

  function drawChar(c, t) {
    const f = Math.floor(c.anim / 0.14) % 2;
    const breath = Math.sin(t * 2.2 + c.i * 2) > 0.4 ? 1 : 0; // respiración lenta al dormir
    if (c.act === 'walk') person(c.x, c.y, c.look, c.facing === 'up' ? 'back' : 'front', f, { cup: c.cup > 0 });
    else if (c.act === 'print' || c.act === 'coffee') person(c.x, c.y + (Math.floor(c.anim * 3) % 2), c.look, 'back', 0); // se balancea esperando
    else if (c.at === 'home' && c.boss) { person(c.x, c.y - 4, c.look, 'sitFront', 0, { sleep: !c.awake, breath }); if (!c.awake) zzz(c.x + 2, c.y - 30, t + c.i); }
    else if (!c.awake) { person(c.x, c.y, c.look, 'sleepBack', 0, { breath }); zzz(c.x + 2, c.y - 22, t + c.i); }
    else {
      const typing = c.pause <= 0 && c.stretch <= 0, f4 = Math.floor(c.anim / 0.09) % 4;
      person(c.x, c.y, c.look, 'sitBack', 0, {
        cup: c.cup > 0, stretch: c.stretch > 0, turn: c.pause > 0 ? c.turn : 0,
        armL: typing ? [0, -2, 0, -1][f4] : 0, armR: typing ? [-1, 0, -2, 0][f4] : 0, bob: typing && f4 % 2 ? 1 : 0,
      });
      if (typing) typingDots(c.x, c.y - 31, t + c.i);
    }
  }

  /** Arriba de la cabeza (coordenadas del canvas): ahí va el globo de pensamiento. */
  function headTop(c) {
    if (c.at === 'home' && c.boss && c.act === 'sit') return { x: c.x, y: c.y - 29 };
    return { x: c.x, y: c.act === 'sit' ? c.y - 25 : c.y - 29 };
  }

  class Office {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = W; canvas.height = H;
      this.chars = [makeChar(0), makeChar(1), makeChar(2)];
      this.want = [false, false, false];
      this.nightUntil = 0; // sin tokens hasta esta hora (ms): luz apagada y todos durmiendo
      this.t = 0; this.last = 0;
      const loop = now => {
        requestAnimationFrame(loop);
        if (!canvas.isConnected) { this.last = 0; return; } // fuera de la página: no gasta (con la ventana oculta el navegador ya pausa esto)
        const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
        this.last = now; this.t += dt;
        const night = this.night();
        this.chars.forEach((c, i) => step(c, this.want[i] && !night, dt));
        this.draw();
      };
      requestAnimationFrame(loop);
    }
    /** working: [jefe, agente1, agente2] (true = trabajando). */
    setWorking(working) { this.want = working.map(Boolean); }
    /** Un agente escribió un archivo: irá a la impresora en cuanto pueda. */
    ping(i) { const c = this.chars[i]; if (c && c.awake && !c.boss) c.pingPrint = true; }
    /** Sin tokens hasta `untilMs` (0 = hay tokens). */
    setNight(untilMs) { this.nightUntil = untilMs || 0; }
    night() { return this.nightUntil > Date.now(); }
    /** Cartel sobre la oficina con la cuenta regresiva mientras es de noche. */
    nightLabel(wrap) {
      const el = document.createElement('div');
      el.className = 'office-night';
      el.hidden = true;
      wrap.appendChild(el);
      setInterval(() => {
        const on = this.night();
        el.hidden = !on;
        if (on) el.textContent = '🌙 Sin tokens: el equipo descansa. Vuelven en ' + Office.countdown(this.nightUntil - Date.now());
      }, 500);
    }
    draw() {
      ctx = this.canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      const t = this.t, [b, a1, a2] = this.chars, night = this.night();
      room(t);
      if (night) nightWindow(t);
      const busy = d => this.chars.some(c => c.act === d);
      const on = c => c.awake && c.act === 'sit' && c.at === 'seat';
      const items = [
        [46, () => coffeeMachine(4, 14, t, busy('coffee'))],
        [56, () => printer(158, 34, t, busy('print'))],
        [60, () => { desk(76, 46, 40); pc(89, 33, on(b), t); R(104, 48, 6, 4, '#f4f4f4'); R(105, 49, 4, 1, '#9aa'); R(80, 49, 4, 4, '#c8323c'); }],
        [79, () => chairBack(SPOTS.bossSeat.x, SPOTS.bossSeat.y + 1)],
        [104, () => { desk(40, 90, 36); pc(51, 77, on(a1), t); }],
        [104.1, () => { desk(116, 90, 36); pc(127, 77, on(a2), t); }],
        [123, () => chairBack(SPOTS.seat1.x, SPOTS.seat1.y + 1)],
        [123.1, () => chairBack(SPOTS.seat2.x, SPOTS.seat2.y + 1)],
        [128, () => plant(182, 128, t)],
        [SPOTS.armchair.y - 1, () => armchair(SPOTS.armchair.x, SPOTS.armchair.y, false)],
        [SPOTS.armchair.y + 1, () => armchair(SPOTS.armchair.x, SPOTS.armchair.y, true)],
        ...this.chars.map(c => [c.y + (c.act === 'sit' && c.at === 'seat' ? -0.5 : 0), () => drawChar(c, t)]),
      ];
      items.sort((p, q) => p[0] - q[0]).forEach(([, fn]) => fn());
      if (night) { // luz apagada: todo en penumbra azul, menos la luz de la luna que entra por la ventana
        ctx.fillStyle = 'rgba(6, 10, 32, 0.62)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(180, 200, 255, 0.08)';
        ctx.beginPath(); ctx.moveTo(66, 27); ctx.lineTo(126, 27); ctx.lineTo(150, 70); ctx.lineTo(50, 70); ctx.fill();
      }
    }
  }

  /** Índice del personaje bajo el punto (coordenadas del canvas) o -1. */
  Office.prototype.hit = function (x, y) {
    let best = -1, bestY = -1;
    this.chars.forEach((c, i) => {
      const top = headTop(c).y - 2;
      if (x >= c.x - 9 && x <= c.x + 9 && y >= top && y <= c.y + 1 && c.y > bestY) { best = i; bestY = c.y; }
    });
    return best;
  };

  const escHtml = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /**
   * Globos de pensamiento sobre los personajes. info(i) -> { name, text, time, working } | null.
   * always() = true muestra los de todos los que trabajan (ventana aparte o pantalla completa); si no, solo al pasar el mouse.
   * onPick(i): click en un personaje (ver su historial). Con él, el cursor es una mano y el globo del que señalas trae
   * "📜 Ver historial": el globo sigue abierto mientras el mouse esté encima y unos instantes al salir del personaje,
   * para que dé tiempo a llegar al botón.
   */
  Office.prototype.bubbles = function (wrap, info, always = () => false, onPick = null) {
    const cv = this.canvas;
    const GRACE = 700; // ms que el globo espera al salir del personaje
    let hover = -1, lastHover = -1, leftAt = 0, overBubble = -1;
    const els = this.chars.map((_, i) => {
      const d = document.createElement('div');
      d.className = 'thought'; d.hidden = true;
      // Partes fijas: el texto cambia cada segundo (⏱), pero el botón no se recrea (un click a medio camino se perdería).
      d.innerHTML = '<span class="tt"></span><small class="thought-hint"></small>' + (onPick ? '<button type="button" class="thought-btn">📜 Ver historial</button>' : '');
      if (onPick) {
        d.addEventListener('mouseenter', () => { overBubble = i; update(); });
        d.addEventListener('mouseleave', () => { overBubble = -1; leftAt = Date.now(); update(); });
        d.querySelector('.thought-btn').addEventListener('click', () => { overBubble = -1; hover = lastHover = -1; onPick(i); update(); });
      }
      wrap.appendChild(d);
      return d;
    });
    const toCanvas = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    const leave = () => { if (hover >= 0) leftAt = Date.now(); hover = -1; };
    cv.addEventListener('mousemove', e => {
      const h = this.hit(...toCanvas(e));
      if (h >= 0) { hover = lastHover = h; } else leave();
      cv.style.cursor = h >= 0 ? (onPick ? 'pointer' : 'help') : '';
      update();
    });
    cv.addEventListener('mouseleave', () => { leave(); update(); });
    if (onPick) cv.addEventListener('click', e => { const i = this.hit(...toCanvas(e)); if (i >= 0) onPick(i); });
    // A quién se señala: el personaje bajo el mouse, el globo bajo el mouse o, por un momento, el último señalado.
    const pointed = () => hover >= 0 ? hover : overBubble >= 0 ? overBubble : onPick && Date.now() - leftAt < GRACE ? lastHover : -1;
    const update = () => {
      if (!cv.isConnected) return;
      const r = cv.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), s = r.width / W, all = always(), at = pointed();
      this.chars.forEach((c, i) => {
        const inf = info(i), el = els[i];
        const show = !!inf && (at === i || (all && inf.working));
        el.hidden = !show;
        if (!show) return;
        const picking = !!onPick && at === i;
        el.classList.toggle('pickable', picking);
        const html = `💭 <b>${escHtml(inf.name)}</b> ${escHtml(inf.text)}${inf.time ? ` <small>⏱ ${escHtml(inf.time)}</small>` : ''}`;
        if (el._html !== html) { el.querySelector('.tt').innerHTML = html; el._html = html; }
        const hint = picking ? (inf.working ? '● Trabajando en vivo · click para verlo' : 'Click para ver su historial') : '';
        const h = el.querySelector('.thought-hint');
        if (h.textContent !== hint) h.textContent = hint;
        h.hidden = !hint;
        const btn = el.querySelector('.thought-btn');
        if (btn) btn.hidden = !picking;
        const p = headTop(c), half = el.offsetWidth / 2;
        const left = Math.max(half + 2, Math.min(wr.width - half - 2, r.left - wr.left + p.x * s)); // sin salirse por los lados
        el.style.left = left + 'px';
        el.style.top = Math.max(el.offsetHeight + 2, r.top - wr.top + p.y * s - 2) + 'px';
      });
    };
    setInterval(update, 250);
    return update;
  };

  /** "2:05" o "1:02:05" desde una fecha ISO; '' si no hay. */
  Office.elapsed = since => {
    const s = Math.floor((Date.now() - Date.parse(since)) / 1000);
    if (!since || !(s >= 0)) return '';
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };

  /** "1:23:45" o "4:05" para una cuenta regresiva en ms. */
  Office.countdown = ms => {
    const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };

  /** Si se acabaron los tokens (algún límite al 100 %), hasta cuándo hay que esperar (ms). 0 = hay tokens. */
  Office.waitUntil = usage => {
    const now = Date.now();
    const ends = ['five_hour', 'seven_day'].map(k => usage?.[k])
      .filter(w => w && w.used_percentage >= 100 && w.resets_at * 1000 > now).map(w => w.resets_at * 1000);
    return ends.length ? Math.max(...ends) : 0;
  };

  /** Qué está pensando un integrante del equipo, en pocas palabras. */
  Office.thought = (m, members, live, night = false) => {
    if (night) return 'Durmiendo… esperando tokens nuevos';
    if (m.state !== 'working') return m.key === 'boss' ? (live ? 'Esperando tu instrucción' : 'Claude está cerrado') : 'Durmiendo… zzz';
    const last = m.feed.at(-1);
    if (m.key === 'boss') {
      const busy = members.slice(1).filter(a => a.state === 'working').map(a => a.name);
      if (busy.length && (!last || last.th?.startsWith('Encargando'))) return 'Supervisando a ' + busy.join(' y ');
    }
    return last?.th || 'Pensando…';
  };

  /** Datos del globo para el integrante i. */
  Office.info = (data, i, night = false) => {
    const m = data?.members[i];
    if (!m) return null;
    const working = m.state === 'working' && !night;
    return { name: m.name, working, text: Office.thought(m, data.members, data.live, night), time: working ? Office.elapsed(m.since) : '' };
  };

  /** Retrato 16×16 (cabeza y hombros) para las fichas del equipo. */
  Office.portrait = i => {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    ctx = c.getContext('2d');
    person(8, 27, LOOKS[i], 'front', 0);
    return c.toDataURL();
  };

  Office.findPath = findPath; // para pruebas
  Office.SPOTS = SPOTS;
  Office.BLOCKS = BLOCKS;
  window.Office = Office;
})();
