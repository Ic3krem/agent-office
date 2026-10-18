// Kiro: the office manager's desktop body. An original orange cube-crab drawn as one SVG; moods add props.
// Moods: idle, cool, work, build, think, alert, party, sleep.
(function () {
  const O = '#4a1f08', BODY = '#ff6a13', TOP = '#ff9147', SIDE = '#d8520a', CLAW = '#ff7a26';
  const leg = (x1, y1, x2, y2, x3, y3, d) =>
    `<path class="leg" style="animation-delay:${d}s" d="M${x1} ${y1} Q${x2} ${y2} ${x3} ${y3}" fill="none" stroke="${O}" stroke-width="7" stroke-linecap="round"/>
     <path class="leg" style="animation-delay:${d}s" d="M${x1} ${y1} Q${x2} ${y2} ${x3} ${y3}" fill="none" stroke="${CLAW}" stroke-width="4" stroke-linecap="round"/>`;
  const claw = (cx, cy, flip, raised) => {
    const s = flip ? -1 : 1, ay = raised ? cy - 26 : cy;
    return `<g class="${raised ? 'claw-up' : 'claw'}">
      <path d="M${cx - s * 14} ${cy - 4} Q${cx - s * 6} ${ay + 8} ${cx} ${ay}" fill="none" stroke="${O}" stroke-width="8" stroke-linecap="round"/>
      <path d="M${cx - s * 14} ${cy - 4} Q${cx - s * 6} ${ay + 8} ${cx} ${ay}" fill="none" stroke="${CLAW}" stroke-width="5" stroke-linecap="round"/>
      <path d="M${cx} ${ay} q${s * 4} -14 ${s * 14} -10 q-${s * 2} 6 -${s * 7} 7 q${s * 9} 2 ${s * 9} 9 q-${s * 10} 6 -${s * 16} -6 z" fill="${CLAW}" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/>
    </g>`;
  };
  const eyes = mood => mood === 'sleep'
    ? `<path d="M48 64 q5 4 10 0 M70 64 q5 4 10 0" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round"/>`
    : mood === 'cool'
      ? `<g><rect x="40" y="56" width="22" height="13" fill="#111"/><rect x="66" y="56" width="22" height="13" fill="#111"/><rect x="38" y="55" width="52" height="4" fill="#111"/>
         <rect x="43" y="59" width="4" height="3" fill="#fff"/><rect x="47" y="62" width="3" height="3" fill="#fff"/><rect x="69" y="59" width="4" height="3" fill="#fff"/><rect x="73" y="62" width="3" height="3" fill="#fff"/></g>`
      : mood === 'alert' || mood === 'build'
        ? `<g class="eyes"><path d="M46 57 l10 4 M82 57 l-10 4" stroke="${O}" stroke-width="3" stroke-linecap="round"/><ellipse cx="52" cy="66" rx="4" ry="5" fill="${O}"/><ellipse cx="76" cy="66" rx="4" ry="5" fill="${O}"/><circle cx="53.5" cy="64" r="1.4" fill="#fff"/><circle cx="77.5" cy="64" r="1.4" fill="#fff"/></g>`
        : `<g class="eyes"><ellipse cx="52" cy="65" rx="4.5" ry="5.5" fill="${O}"/><ellipse cx="76" cy="65" rx="4.5" ry="5.5" fill="${O}"/><circle cx="53.6" cy="63" r="1.6" fill="#fff"/><circle cx="77.6" cy="63" r="1.6" fill="#fff"/></g>`;
  const mouth = mood => ({
    party: `<path d="M56 75 q8 11 16 0 z" fill="${O}"/><path d="M60 80 q4 3 8 0" fill="#ff8f8f"/>`,
    alert: `<ellipse cx="64" cy="78" rx="4" ry="3.5" fill="${O}"/>`,
    sleep: `<path d="M60 77 q4 2 8 0" fill="none" stroke="${O}" stroke-width="2.5" stroke-linecap="round"/>`,
    work: `<path d="M58 77 h12" stroke="${O}" stroke-width="2.6" stroke-linecap="round"/>`,
    build: `<path d="M58 77 h12" stroke="${O}" stroke-width="2.6" stroke-linecap="round"/>`,
  })[mood] || `<path d="M57 75 q7 7 14 0" fill="none" stroke="${O}" stroke-width="2.8" stroke-linecap="round"/>`;
  const props = {
    work: `<g class="glow"><path d="M30 46 q34 -40 68 0" fill="none" stroke="#2b2b33" stroke-width="5"/><rect x="24" y="52" width="9" height="16" rx="3" fill="#2b2b33"/><rect x="95" y="52" width="9" height="16" rx="3" fill="#2b2b33"/><path d="M29 66 q2 14 18 14" fill="none" stroke="#2b2b33" stroke-width="2.5"/><circle cx="48" cy="80" r="2.5" fill="#2b2b33"/></g>
      <g class="keys"><path d="M14 112 L114 112 L124 124 L4 124 Z" fill="#0f2416" stroke="#3dff8f" stroke-width="2"/><path d="M14 116 h96 M10 120 h104" stroke="#3dff8f" stroke-width="1" stroke-dasharray="5 3" opacity=".8"/></g>
      <g class="bits" fill="#3dff8f" font-family="monospace" font-size="9"><text x="2" y="30">10</text><text x="112" y="20">01</text><text x="118" y="44">1</text></g>`,
    build: `<path d="M34 30 q30 -30 60 0 l4 6 h-68 z" fill="#ffc81a" stroke="${O}" stroke-width="2.5" stroke-linejoin="round"/><rect x="58" y="10" width="12" height="20" rx="3" fill="#ffd84d" stroke="${O}" stroke-width="2"/>
      <g class="tool"><rect x="114" y="34" width="5" height="40" rx="2" fill="#7a8a99" stroke="${O}" stroke-width="1.5"/><path d="M110 30 a8 8 0 1 1 13 0 l-3 4 h-7 z" fill="#9fb0bf" stroke="${O}" stroke-width="1.5"/></g>`,
    think: `<g class="orb"><circle cx="64" cy="104" r="15" fill="#1d6b35" stroke="#3dff8f" stroke-width="2"/><circle cx="64" cy="104" r="22" fill="#3dff8f" opacity=".18"/><text x="64" y="102" text-anchor="middle" fill="#9dffc4" font-family="monospace" font-size="6">0101</text><text x="64" y="110" text-anchor="middle" fill="#9dffc4" font-family="monospace" font-size="6">1 0 1</text></g>`,
    alert: `<g class="flag"><rect x="112" y="4" width="3.5" height="74" rx="1.5" fill="#3a2a1a"/><path class="cloth" d="M115 6 h28 q-4 9 0 18 h-28 z" fill="#1b1b22" stroke="${O}" stroke-width="1.5"/><text x="129" y="18" text-anchor="middle" fill="#ffb547" font-family="sans-serif" font-weight="700" font-size="9">!</text></g>`,
    party: `<g class="confetti">${['#ff4d6d', '#ffd23f', '#3dd6ff', '#8c6cff', '#3dff8f', '#ff9147'].map((c, i) => `<rect x="${12 + i * 21}" y="${8 + (i % 3) * 7}" width="6" height="3" fill="${c}" style="animation-delay:${i * 0.12}s"/>`).join('')}<path d="M20 30 l3 -7 l3 7 l-7 -4 h8 z" fill="#ffd23f"/><path d="M106 26 l3 -7 l3 7 l-7 -4 h8 z" fill="#8c6cff"/></g>`,
    sleep: `<g class="zzz" fill="#8fa3ff" font-family="sans-serif" font-weight="700"><text x="100" y="26" font-size="14">z</text><text x="112" y="14" font-size="10">z</text></g>
      <path d="M34 30 q30 -24 60 0 z" fill="#5a6bd6" stroke="${O}" stroke-width="2"/><circle cx="96" cy="26" r="6" fill="#fff" stroke="${O}" stroke-width="2"/>`,
    cool: '', idle: '',
  };
  window.kiroSVG = function (mood = 'idle', size = 140) {
    const raised = mood === 'party';
    return `<svg class="kiro mood-${mood}" width="${size}" height="${size}" viewBox="-6 -6 152 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kiro, ${mood}">
      <ellipse cx="64" cy="124" rx="50" ry="7" fill="#000" opacity=".22"/>
      <g class="legs">
        ${leg(38, 96, 24, 104, 16, 122, 0)}${leg(48, 98, 38, 110, 34, 126, .15)}${leg(58, 99, 54, 112, 54, 128, .3)}
        ${leg(72, 99, 76, 112, 76, 128, .3)}${leg(82, 98, 92, 110, 96, 126, .15)}${leg(92, 96, 106, 104, 114, 122, 0)}
      </g>
      <g class="body">
        <path d="M28 40 L46 22 L112 22 L96 40 Z" fill="${TOP}" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
        <path d="M96 40 L112 22 L112 82 L96 100 Z" fill="${SIDE}" stroke="${O}" stroke-width="3" stroke-linejoin="round"/>
        <rect x="28" y="40" width="68" height="60" rx="5" fill="${BODY}" stroke="${O}" stroke-width="3"/>
        <path d="M32 44 h20" stroke="#ffb27a" stroke-width="3" stroke-linecap="round" opacity=".8"/>
        <ellipse cx="42" cy="78" rx="6" ry="3.5" fill="#ff8fa3" opacity=".75"/><ellipse cx="86" cy="78" rx="6" ry="3.5" fill="#ff8fa3" opacity=".75"/>
        ${eyes(mood)}${mouth(mood)}
      </g>
      ${claw(14, 84, false, raised)}${claw(112, 86, true, raised || mood === 'alert')}
      ${props[mood] || ''}
    </svg>`;
  };
})();
