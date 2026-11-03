'use strict';
// Original product renders drawn as SVG. They stand in for photography in the
// sample catalogue so the store looks finished before real photos are uploaded
// through the admin. Every render is 800 x 800 on a transparent background.

const COLORS = {
  'Graphite':     { body: '#3a3f46', edge: '#2a2e33', hi: '#5c636c' },
  'Midnight':     { body: '#1f2a3a', edge: '#151d29', hi: '#3b4b63' },
  'Silver':       { body: '#d9dcdf', edge: '#b9bdc2', hi: '#f4f5f6' },
  'Titanium':     { body: '#a7a39b', edge: '#8a867e', hi: '#cbc7bf' },
  'Sage':         { body: '#9fb3a2', edge: '#829786', hi: '#c4d3c6' },
  'Ice Blue':     { body: '#b7cde0', edge: '#97b1c7', hi: '#dbe8f2' },
  'Coral':        { body: '#e19a86', edge: '#c67e6b', hi: '#f2c1b3' },
  'Sand':         { body: '#d8c8ad', edge: '#bfae92', hi: '#ece2d0' },
  'Black':        { body: '#2b2d31', edge: '#1c1d20', hi: '#4b4e54' },
  'White':        { body: '#eef0f1', edge: '#cfd3d6', hi: '#ffffff' },
  'Cobalt':       { body: '#3756b8', edge: '#29438f', hi: '#6380d8' },
  'Forest':       { body: '#36584a', edge: '#284337', hi: '#577d6c' },
  'Lavender':     { body: '#b9aed6', edge: '#9d91be', hi: '#d9d1ec' },
};

function c(name) { return COLORS[name] || COLORS.Graphite; }

let uid = 0;
function id(p) { uid += 1; return `${p}${uid}`; }

const WALLS = [
  ['#2448c9', '#7fb2ff', '#e9f1ff'],
  ['#1f7a55', '#8fd3b0', '#effaf4'],
  ['#5b3fc4', '#c1a8ff', '#f4efff'],
  ['#c7791a', '#ffd08a', '#fff6e8'],
  ['#0f6f86', '#7fd7e8', '#eafbff'],
];

function shadow(cx, cy, rx, ry, op = 0.22) {
  const g = id('sh');
  return `<defs><radialGradient id="${g}"><stop offset="0" stop-color="#1b2330" stop-opacity="${op}"/><stop offset="1" stop-color="#1b2330" stop-opacity="0"/></radialGradient></defs>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${g})"/>`;
}

function bodyGrad(col, dir = 'h') {
  const g = id('bg');
  const [x2, y2] = dir === 'h' ? [1, 0] : [0, 1];
  return { id: g, def: `<linearGradient id="${g}" x1="0" y1="0" x2="${x2}" y2="${y2}">
    <stop offset="0" stop-color="${col.hi}"/><stop offset=".35" stop-color="${col.body}"/>
    <stop offset=".8" stop-color="${col.body}"/><stop offset="1" stop-color="${col.edge}"/></linearGradient>` };
}

function wallpaper(seed, w = WALLS[seed % WALLS.length]) {
  const g = id('wp');
  const g2 = id('wq');
  return { id: g, id2: g2, def: `<linearGradient id="${g}" x1="0" y1="0" x2=".6" y2="1">
    <stop offset="0" stop-color="${w[2]}"/><stop offset=".55" stop-color="${w[1]}"/><stop offset="1" stop-color="${w[0]}"/></linearGradient>
    <radialGradient id="${g2}" cx=".75" cy=".2" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` };
}

function sheen(x, y, w, h, rx) {
  const g = id('sn');
  return `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#${g})"/>`;
}

function lens(cx, cy, r) {
  const g = id('ln');
  return `<defs><radialGradient id="${g}" cx=".4" cy=".35" r=".7">
    <stop offset="0" stop-color="#4a5d80"/><stop offset=".35" stop-color="#141a24"/><stop offset="1" stop-color="#05070a"/></radialGradient></defs>
    <circle cx="${cx}" cy="${cy}" r="${r + 7}" fill="#1a1d22" opacity=".85"/>
    <circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="#9aa0a8" opacity=".55"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${g})"/>
    <circle cx="${cx - r * .3}" cy="${cy - r * .3}" r="${r * .18}" fill="#fff" opacity=".35"/>`;
}

function lockscreen(x, y, w, h, rx, seed, opts = {}) {
  const wp = wallpaper(seed);
  const t = opts.time || '9:41';
  return `<defs>${wp.def}</defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#${wp.id})"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#${wp.id2})"/>
    ${opts.noText ? '' : `<text x="${x + w / 2}" y="${y + h * .26}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
      font-weight="300" font-size="${w * .26}" fill="#fff" opacity=".92">${t}</text>`}`;
}

// ---------- device drawings ----------

function phoneFront(col, seed, x = 270, y = 110, w = 260, h = 580) {
  const bg = bodyGrad(col);
  return `<defs>${bg.def}</defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * .18}" fill="url(#${bg.id})"/>
    <rect x="${x + 7}" y="${y + 7}" width="${w - 14}" height="${h - 14}" rx="${w * .155}" fill="#0b0d10"/>
    ${lockscreen(x + 15, y + 15, w - 30, h - 30, w * .13, seed)}
    <rect x="${x + w / 2 - 34}" y="${y + 28}" width="68" height="20" rx="10" fill="#07080a"/>
    <rect x="${x + w / 2 - 50}" y="${y + h - 34}" width="100" height="5" rx="2.5" fill="#fff" opacity=".8"/>
    <rect x="${x - 3}" y="${y + 140}" width="4" height="60" rx="2" fill="${col.edge}"/>
    <rect x="${x + w - 1}" y="${y + 120}" width="4" height="90" rx="2" fill="${col.edge}"/>`;
}

function phoneBack(col, x = 270, y = 110, w = 260, h = 580, cams = 3) {
  const bg = bodyGrad(col);
  const m = { x: x + 22, y: y + 22, s: w * .48 };
  const r = m.s * .19;
  const lensPos = cams === 2
    ? [[m.x + m.s * .3, m.y + m.s * .3], [m.x + m.s * .3, m.y + m.s * .72]]
    : [[m.x + m.s * .29, m.y + m.s * .29], [m.x + m.s * .29, m.y + m.s * .72], [m.x + m.s * .72, m.y + m.s * .5]];
  return `<defs>${bg.def}</defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * .18}" fill="${col.edge}"/>
    <rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="${w * .17}" fill="url(#${bg.id})"/>
    ${sheen(x + 4, y + 4, w - 8, h - 8, w * .17)}
    <rect x="${m.x}" y="${m.y}" width="${m.s}" height="${m.s}" rx="${m.s * .26}" fill="${col.edge}" opacity=".9"/>
    <rect x="${m.x + 3}" y="${m.y + 3}" width="${m.s - 6}" height="${m.s - 6}" rx="${m.s * .24}" fill="${col.body}"/>
    ${lensPos.map(([cx, cy]) => lens(cx, cy, r)).join('')}
    <circle cx="${m.x + m.s * .72}" cy="${m.y + m.s * (cams === 2 ? .3 : .2)}" r="7" fill="#f3e6c4" opacity=".9"/>`;
}

function phone(col, seed, view) {
  if (view === 'front') return shadow(400, 705, 170, 16) + phoneFront(col, seed);
  if (view === 'back') return shadow(400, 705, 170, 16) + phoneBack(col);
  return shadow(400, 712, 250, 18)
    + `<g transform="translate(-110 20) rotate(-7 400 400)">${phoneBack(col, 270, 110, 250, 560)}</g>`
    + `<g transform="translate(95 0)">${phoneFront(col, seed, 270, 110, 250, 560)}</g>`;
}

function tablet(col, seed, view) {
  const x = 160, y = 150, w = 480, h = 520;
  const bg = bodyGrad(col);
  if (view === 'back') {
    return shadow(400, 690, 260, 16) + `<defs>${bg.def}</defs>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="36" fill="url(#${bg.id})"/>${sheen(x, y, w, h, 36)}
      ${lens(x + 50, y + 50, 16)}<circle cx="${x + 50}" cy="${y + 96}" r="6" fill="#f3e6c4"/>`;
  }
  return shadow(400, 690, 260, 16) + `<defs>${bg.def}</defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="36" fill="url(#${bg.id})"/>
    <rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" rx="31" fill="#0b0d10"/>
    ${lockscreen(x + 22, y + 22, w - 44, h - 44, 18, seed)}
    <circle cx="400" cy="${y + 13}" r="3.5" fill="#2a3240"/>`;
}

function laptop(col, seed, view) {
  const bg = bodyGrad(col, 'v');
  if (view === 'closed') {
    return shadow(400, 600, 300, 20) + `<defs>${bg.def}</defs>
      <rect x="130" y="230" width="540" height="360" rx="26" fill="${col.edge}"/>
      <rect x="133" y="230" width="534" height="352" rx="24" fill="url(#${bg.id})"/>${sheen(133, 230, 534, 352, 24)}
      <circle cx="400" cy="406" r="22" fill="${col.hi}" opacity=".5"/>`;
  }
  return shadow(400, 600, 330, 18) + `<defs>${bg.def}</defs>
    <rect x="150" y="150" width="500" height="345" rx="20" fill="${col.edge}"/>
    <rect x="156" y="156" width="488" height="333" rx="15" fill="#0b0d10"/>
    ${lockscreen(170, 172, 460, 300, 6, seed, { noText: true })}
    <rect x="200" y="214" width="150" height="14" rx="7" fill="#fff" opacity=".75"/>
    <rect x="200" y="238" width="96" height="10" rx="5" fill="#fff" opacity=".5"/>
    <circle cx="400" cy="163" r="3" fill="#2a3240"/>
    <path d="M95 497 H705 Q712 497 708 506 L700 520 Q696 528 684 528 H116 Q104 528 100 520 L92 506 Q88 497 95 497Z" fill="url(#${bg.id})"/>
    <rect x="350" y="497" width="100" height="9" rx="4" fill="${col.edge}"/>
    <rect x="98" y="520" width="604" height="6" rx="3" fill="${col.edge}" opacity=".6"/>`;
}

function headphones(col, seed, view) {
  const bg = bodyGrad(col);
  const cup = (cx) => `<rect x="${cx - 70}" y="380" width="140" height="210" rx="64" fill="${col.edge}"/>
    <rect x="${cx - 64}" y="384" width="128" height="202" rx="60" fill="url(#${bg.id})"/>
    ${sheen(cx - 64, 384, 128, 202, 60)}
    <rect x="${cx - 40}" y="420" width="80" height="130" rx="40" fill="${col.edge}" opacity=".35"/>`;
  const side = view === 'side';
  return shadow(400, 640, 250, 18) + `<defs>${bg.def}</defs>
    <path d="M220 450 C 210 230, 590 230, 580 450" fill="none" stroke="${col.edge}" stroke-width="34" stroke-linecap="round"/>
    <path d="M220 450 C 210 230, 590 230, 580 450" fill="none" stroke="${col.body}" stroke-width="26" stroke-linecap="round"/>
    <path d="M250 330 C 300 250, 500 250, 550 330" fill="none" stroke="${col.hi}" stroke-width="5" stroke-linecap="round" opacity=".7"/>
    <rect x="205" y="360" width="30" height="80" rx="12" fill="${col.edge}"/><rect x="565" y="360" width="30" height="80" rx="12" fill="${col.edge}"/>
    ${side ? cup(400) : cup(230) + cup(570)}`;
}

function earbuds(col, seed, view) {
  const bg = bodyGrad(col, 'v');
  const bud = (x, flip) => `<g transform="translate(${x} 0) ${flip ? 'scale(-1 1)' : ''}">
    <rect x="-20" y="250" width="40" height="160" rx="20" fill="url(#${bg.id})"/>
    <ellipse cx="-6" cy="250" rx="52" ry="48" fill="url(#${bg.id})"/>
    <ellipse cx="-30" cy="248" rx="22" ry="26" fill="${col.edge}"/>
    <ellipse cx="4" cy="232" rx="20" ry="12" fill="#fff" opacity=".25"/>
    <rect x="-10" y="392" width="20" height="10" rx="5" fill="#c9ccd1"/></g>`;
  if (view === 'buds') return shadow(400, 470, 210, 16) + `<defs>${bg.def}</defs>${bud(320, false)}${bud(480, true)}`;
  return shadow(400, 640, 210, 18) + `<defs>${bg.def}</defs>
    <rect x="230" y="420" width="340" height="210" rx="92" fill="${col.edge}"/>
    <rect x="234" y="420" width="332" height="204" rx="90" fill="url(#${bg.id})"/>
    <line x1="236" y1="478" x2="564" y2="478" stroke="${col.edge}" stroke-width="3"/>
    ${sheen(234, 420, 332, 204, 90)}
    <circle cx="400" cy="540" r="6" fill="#7ad09a"/>
    <g transform="translate(0 40) scale(.8) translate(100 0)">${bud(320, false)}${bud(480, true)}</g>`;
}

function watch(col, seed, view) {
  const bg = bodyGrad(col);
  const wp = wallpaper(seed);
  const strap = col.edge;
  const face = view === 'side'
    ? `<rect x="320" y="290" width="160" height="220" rx="58" fill="url(#${bg.id})"/>${sheen(320, 290, 160, 220, 58)}`
    : `<rect x="286" y="268" width="228" height="264" rx="70" fill="url(#${bg.id})"/>
       <rect x="296" y="278" width="208" height="244" rx="62" fill="#07080a"/>
       <defs>${wp.def}</defs>
       <circle cx="400" cy="400" r="78" fill="none" stroke="url(#${wp.id})" stroke-width="14" stroke-dasharray="330 500" transform="rotate(-90 400 400)" stroke-linecap="round"/>
       <circle cx="400" cy="400" r="54" fill="none" stroke="#7ad09a" stroke-width="12" stroke-dasharray="220 400" transform="rotate(-90 400 400)" stroke-linecap="round"/>
       <text x="400" y="412" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#fff" font-weight="500">10:08</text>`;
  return shadow(400, 720, 120, 14) + `<defs>${bg.def}</defs>
    <rect x="326" y="80" width="148" height="210" rx="30" fill="${strap}"/>
    <rect x="326" y="510" width="148" height="210" rx="30" fill="${strap}"/>
    ${[600, 630, 660].map(yy => `<circle cx="400" cy="${yy}" r="6" fill="#000" opacity=".25"/>`).join('')}
    ${face}
    <rect x="512" y="350" width="16" height="44" rx="7" fill="${col.edge}"/>`;
}

function camera(col, seed, view) {
  const bg = bodyGrad(col, 'v');
  if (view === 'back') {
    return shadow(400, 600, 290, 18) + `<defs>${bg.def}</defs>
      <rect x="140" y="250" width="520" height="330" rx="40" fill="url(#${bg.id})"/>
      <rect x="190" y="300" width="300" height="220" rx="14" fill="#0b0d10"/>
      ${lockscreen(200, 310, 280, 200, 6, seed, { noText: true })}
      <circle cx="580" cy="360" r="26" fill="${col.edge}"/><circle cx="580" cy="450" r="34" fill="${col.edge}"/>
      <circle cx="580" cy="450" r="12" fill="${col.hi}" opacity=".6"/>`;
  }
  return shadow(400, 610, 300, 18) + `<defs>${bg.def}</defs>
    <path d="M140 300 Q140 260 180 260 H310 L340 210 H470 L500 260 H620 Q660 260 660 300 V560 Q660 590 630 590 H170 Q140 590 140 560Z" fill="url(#${bg.id})"/>
    <rect x="140" y="330" width="520" height="190" fill="#1b1d21" opacity=".85"/>
    <rect x="140" y="300" width="120" height="290" rx="30" fill="#1b1d21" opacity=".9"/>
    <circle cx="560" cy="245" r="30" fill="${col.edge}"/><circle cx="560" cy="240" r="24" fill="${col.hi}" opacity=".7"/>
    <circle cx="410" cy="430" r="150" fill="#1f2226"/><circle cx="410" cy="430" r="130" fill="#2b2f35"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => `<rect x="408" y="285" width="4" height="14" fill="#555" transform="rotate(${i * 30} 410 430)"/>`).join('')}
    ${lens(410, 430, 92)}
    <circle cx="200" cy="300" r="10" fill="#c7791a" opacity=".85"/>`;
}

function controller(col, seed) {
  const bg = bodyGrad(col, 'v');
  return `<defs>${bg.def}</defs>
    <path d="M250 300 Q400 270 550 300 Q640 316 668 420 Q700 540 640 580 Q590 610 548 540 Q520 492 470 492 H330 Q280 492 252 540 Q210 610 160 580 Q100 540 132 420 Q160 316 250 300Z" fill="url(#${bg.id})"/>
    ${sheen(160, 290, 480, 200, 60)}
    <circle cx="300" cy="440" r="40" fill="${col.edge}"/><circle cx="300" cy="440" r="28" fill="#2a2d33"/>
    <circle cx="470" cy="440" r="40" fill="${col.edge}"/><circle cx="470" cy="440" r="28" fill="#2a2d33"/>
    <path d="M232 368h16v-16h16v16h16v16h-16v16h-16v-16h-16z" fill="#2a2d33"/>
    <circle cx="555" cy="345" r="13" fill="#2a2d33"/><circle cx="585" cy="372" r="13" fill="#2a2d33"/>
    <circle cx="525" cy="372" r="13" fill="#2a2d33"/><circle cx="555" cy="400" r="13" fill="#2a2d33"/>
    <rect x="370" y="340" width="60" height="34" rx="12" fill="${col.edge}"/>`;
}

function consoleBox(col, seed, view) {
  const bg = bodyGrad(col);
  const box = `<defs>${bg.def}</defs>
    <rect x="300" y="120" width="200" height="540" rx="26" fill="${col.edge}"/>
    <rect x="306" y="120" width="188" height="532" rx="22" fill="url(#${bg.id})"/>
    ${sheen(306, 120, 188, 532, 22)}
    <rect x="320" y="160" width="10" height="460" rx="5" fill="#2448c9" opacity=".55"/>
    <circle cx="400" cy="600" r="7" fill="#fff" opacity=".9"/>
    <rect x="370" y="200" width="60" height="6" rx="3" fill="${col.edge}"/>`;
  if (view === 'pad') return shadow(400, 600, 260, 18) + `<g transform="translate(0 20)">${controller(col, seed)}</g>`;
  return shadow(400, 680, 230, 18) + `<g transform="translate(-100 0)">${box}</g>
    <g transform="translate(250 330) scale(.5)">${controller(c('Black'), seed)}</g>`;
}

function speaker(col, seed, view) {
  const bg = bodyGrad(col);
  const pat = id('gr');
  return shadow(400, 670, 200, 18) + `<defs>${bg.def}
    <pattern id="${pat}" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="3" fill="${col.edge}" opacity=".7"/></pattern></defs>
    <rect x="250" y="150" width="300" height="510" rx="140" fill="url(#${bg.id})"/>
    <rect x="262" y="220" width="276" height="380" rx="20" fill="url(#${pat})"/>
    <ellipse cx="400" cy="185" rx="110" ry="20" fill="${col.hi}" opacity=".6"/>
    ${[-50, 0, 50].map(dx => `<circle cx="${400 + dx}" cy="185" r="8" fill="${col.edge}"/>`).join('')}`;
}

function monitor(col, seed, view, wide = false) {
  const w = wide ? 640 : 560, h = wide ? 360 : 330, x = 400 - w / 2, y = wide ? 250 : 130;
  return shadow(400, 690, wide ? 300 : 200, 16) + `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${col.edge}"/>
    <rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" rx="9" fill="#0b0d10"/>
    ${lockscreen(x + 12, y + 12, w - 24, h - 36, 4, seed, { noText: true })}
    ${wide
      ? `<polygon points="214,${y + h} 232,${y + h} 196,640 178,640" fill="${col.edge}"/><polygon points="568,${y + h} 586,${y + h} 622,640 604,640" fill="${col.edge}"/>
         <rect x="150" y="636" width="110" height="10" rx="5" fill="${col.edge}"/><rect x="540" y="636" width="110" height="10" rx="5" fill="${col.edge}"/>`
      : `<rect x="376" y="${y + h}" width="48" height="150" fill="${col.body}"/>
         <rect x="290" y="${y + h + 150}" width="220" height="22" rx="11" fill="${col.edge}"/>`}`;
}

function keyboard(col) {
  const keys = [];
  const rows = [14, 14, 13, 12, 9];
  rows.forEach((n, r) => {
    const kw = 520 / n;
    for (let i = 0; i < n; i++) {
      keys.push(`<rect x="${140 + i * kw + 3}" y="${300 + r * 46}" width="${kw - 6}" height="40" rx="7" fill="${col.hi}"/>`);
    }
  });
  return shadow(400, 560, 320, 16) + `<rect x="120" y="282" width="560" height="260" rx="24" fill="${col.edge}"/>
    <rect x="124" y="282" width="552" height="254" rx="22" fill="${col.body}"/>${keys.join('')}`;
}

function mouse(col) {
  const bg = bodyGrad(col);
  return shadow(400, 640, 130, 14) + `<defs>${bg.def}</defs>
    <path d="M400 170 C 530 170 540 330 540 440 C 540 570 470 620 400 620 C 330 620 260 570 260 440 C 260 330 270 170 400 170Z" fill="url(#${bg.id})"/>
    ${sheen(260, 170, 280, 450, 140)}
    <line x1="400" y1="172" x2="400" y2="340" stroke="${col.edge}" stroke-width="3"/>
    <rect x="390" y="220" width="20" height="56" rx="10" fill="#2a2d33"/>`;
}

function powerbank(col) {
  const bg = bodyGrad(col);
  return shadow(400, 660, 190, 16) + `<defs>${bg.def}</defs>
    <rect x="260" y="160" width="280" height="480" rx="44" fill="${col.edge}"/>
    <rect x="264" y="160" width="272" height="474" rx="42" fill="url(#${bg.id})"/>${sheen(264, 160, 272, 474, 42)}
    ${[0, 1, 2, 3].map(i => `<circle cx="${358 + i * 28}" cy="560" r="7" fill="${i < 3 ? '#7ad09a' : '#2a2d33'}"/>`).join('')}
    <rect x="370" y="168" width="60" height="10" rx="5" fill="#2a2d33"/>`;
}

function charger(col) {
  const bg = bodyGrad(col);
  return shadow(400, 640, 220, 16) + `<defs>${bg.def}</defs>
    <rect x="300" y="280" width="200" height="200" rx="34" fill="url(#${bg.id})"/>${sheen(300, 280, 200, 200, 34)}
    <rect x="352" y="230" width="14" height="56" rx="4" fill="#c9ccd1"/><rect x="434" y="230" width="14" height="56" rx="4" fill="#c9ccd1"/>
    <rect x="380" y="440" width="40" height="14" rx="7" fill="#2a2d33"/>
    <path d="M400 480 C 400 560, 560 520, 560 620" fill="none" stroke="${col.body}" stroke-width="14" stroke-linecap="round"/>`;
}

function tv(col, seed) { return monitor(col, seed, 'front', true); }

const DRAW = {
  phone, tablet, laptop, headphones, earbuds, watch, camera, console: consoleBox,
  speaker, monitor, tv, keyboard, mouse, powerbank, charger, controller: (col, s) => shadow(400, 610, 260, 18) + controller(col, s),
};

const VIEWS = {
  phone: ['pair', 'front', 'back'],
  tablet: ['front', 'back'],
  laptop: ['open', 'closed'],
  headphones: ['front'],
  earbuds: ['case', 'buds'],
  watch: ['front'],
  camera: ['front', 'back'],
  console: ['set', 'pad'],
  speaker: ['front'],
  monitor: ['front'],
  tv: ['front'],
  keyboard: ['top'],
  mouse: ['top'],
  powerbank: ['front'],
  charger: ['front'],
  controller: ['front'],
};

function render(type, colorName, view, seed = 0) {
  uid = 0;
  const fn = DRAW[type];
  if (!fn) throw new Error(`No render for ${type}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">${fn(c(colorName), seed, view)}</svg>`;
}

module.exports = { render, VIEWS, COLORS };
