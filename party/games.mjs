// Party mini-games (phase 8), run by the party server so nobody can fake a time or a score: a typing race (the server
// starts the clock and stamps the finish) and trivia rounds (the server holds the answers until each question closes).
// Canned content only; no model involved.
export const SENTENCES = [
  'The quick brown fox jumps over the lazy dog while the build runs.',
  'Kain muna bago code, sabi ni Aling Nena sa karinderya.',
  'Every test passed on the first try, said nobody ever.',
  'Tiro checked the board, assigned the task and went for coffee.',
  'Small commits, clear messages and a green pipeline make a happy team.',
  'Ang bagal ng internet pero ang bilis ng deadline.',
  'Read the error message twice before you search for it once.',
  'Pixel fixed the button, Forge fixed the server, and Probe found three more bugs.',
  'Ship it on Friday only if you want to work on Saturday.',
  'Salamat po sa pasensya habang nagre-reset ang quota.',
];
export const TRIVIA = {
  general: [
    { q: 'How many continents are there?', a: ['Five', 'Six', 'Seven', 'Eight'], c: 2 },
    { q: 'What is the largest planet in our solar system?', a: ['Saturn', 'Jupiter', 'Neptune', 'Earth'], c: 1 },
    { q: 'How many minutes are in a day?', a: ['1,140', '1,440', '1,240', '1,400'], c: 1 },
    { q: 'Which gas do plants take in for photosynthesis?', a: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], c: 2 },
    { q: 'What is the hardest natural substance?', a: ['Gold', 'Iron', 'Quartz', 'Diamond'], c: 3 },
    { q: 'How many sides does a hexagon have?', a: ['Five', 'Six', 'Seven', 'Eight'], c: 1 },
    { q: 'Which ocean is the largest?', a: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], c: 2 },
    { q: 'What is the boiling point of water at sea level in Celsius?', a: ['90', '100', '110', '120'], c: 1 },
  ],
  tech: [
    { q: 'What does HTTP stand for?', a: ['HyperText Transfer Protocol', 'High Transfer Text Process', 'Host Tool Transfer Path', 'Hyper Terminal Text Protocol'], c: 0 },
    { q: 'Which git command records staged changes?', a: ['git push', 'git commit', 'git add', 'git log'], c: 1 },
    { q: 'What does CSS stand for?', a: ['Computer Style Sheets', 'Cascading Style Sheets', 'Creative Style System', 'Coded Site Styles'], c: 1 },
    { q: 'Which HTTP status code means "Not Found"?', a: ['200', '301', '404', '500'], c: 2 },
    { q: 'What is 2 to the power of 10?', a: ['512', '1000', '1024', '2048'], c: 2 },
    { q: 'Which of these is a JavaScript runtime?', a: ['Django', 'Node.js', 'Rails', 'Laravel'], c: 1 },
    { q: 'What does SQL stand for?', a: ['Structured Query Language', 'Simple Question Logic', 'Server Queue List', 'Sequential Query Loop'], c: 0 },
    { q: 'Which port does HTTPS use by default?', a: ['80', '22', '443', '8080'], c: 2 },
  ],
  pinoy: [
    { q: 'What is the national flower of the Philippines?', a: ['Rose', 'Sampaguita', 'Orchid', 'Gumamela'], c: 1 },
    { q: 'How many main island groups does the Philippines have?', a: ['Two', 'Three', 'Four', 'Seven'], c: 1 },
    { q: 'Which dish is braised in vinegar, soy sauce and garlic?', a: ['Sinigang', 'Adobo', 'Kare-kare', 'Tinola'], c: 1 },
    { q: 'What is the capital of the Philippines?', a: ['Cebu City', 'Davao City', 'Manila', 'Quezon City'], c: 2 },
    { q: 'What is a "karinderya"?', a: ['A market', 'A small eatery', 'A bakery', 'A jeepney stop'], c: 1 },
    { q: 'Which sour soup often uses tamarind?', a: ['Sinigang', 'Bulalo', 'Nilaga', 'Batchoy'], c: 0 },
    { q: 'What is the Philippine national hero commonly known as?', a: ['Andres Bonifacio', 'Jose Rizal', 'Emilio Aguinaldo', 'Lapu-Lapu'], c: 1 },
    { q: 'What is "halo-halo"?', a: ['A rice cake', 'A cold mixed dessert', 'A noodle soup', 'A fried snack'], c: 1 },
  ],
};

export function createGames({ broadcast, now = () => Date.now(), rand = Math.random, countdownMs = 3000, raceMs = 60_000, questionMs = 15_000, revealMs = 3000, questions = 5 } = {}) {
  let race = null, quiz = null, seq = 0;
  const timers = new Set();
  const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); t.unref?.(); timers.add(t); };
  const pick = list => list[Math.floor(rand() * list.length) % list.length];
  const busy = () => (race && !race.over) || (quiz && !quiz.over);
  const raceResults = () => [...race.done.values()].sort((a, b) => a.ms - b.ms);

  function endRace() { if (!race || race.over) return; race.over = true; broadcast({ t: 'race-end', id: race.id, results: raceResults() }); }
  function nextQuestion() {
    if (!quiz || quiz.over) return;
    if (quiz.n >= quiz.list.length) { quiz.over = true; broadcast({ t: 'quiz-end', id: quiz.id, scores: scores() }); return; }
    const item = quiz.list[quiz.n];
    quiz.open = true; quiz.answers = new Map(); quiz.ends = now() + questionMs;
    broadcast({ t: 'quiz-q', id: quiz.id, n: quiz.n + 1, of: quiz.list.length, q: item.q, a: item.a, ends: quiz.ends, at: now() });
    const n = quiz.n;
    later(questionMs, () => reveal(n));
  }
  function reveal(n) {
    if (!quiz || quiz.over || quiz.n !== n || !quiz.open) return;
    quiz.open = false;
    const item = quiz.list[n];
    for (const [id, ans] of quiz.answers) if (ans.choice === item.c) { const s = quiz.score.get(id); s.points += 100 + Math.round(100 * Math.max(0, ans.left) / questionMs); }
    broadcast({ t: 'quiz-reveal', id: quiz.id, n: n + 1, correct: item.c, scores: scores() });
    quiz.n++; later(revealMs, nextQuestion);
  }
  const scores = () => [...quiz.score.values()].sort((a, b) => b.points - a.points);

  return {
    startRace(m) {
      if (busy()) return { ok: false, error: 'a game is already running' };
      const text = pick(SENTENCES), startsAt = now() + countdownMs;
      race = { id: 'r' + (++seq), text, startsAt, ends: startsAt + raceMs, done: new Map(), over: false };
      broadcast({ t: 'race', id: race.id, text, startsAt, ends: race.ends, by: m.name, at: now() });
      later(countdownMs + raceMs, endRace);
      return { ok: true };
    },
    // The finish time is the server's clock, not the client's; the typed text must match exactly.
    finishRace(m, id, typed) {
      if (!race || race.over || race.id !== id) return { ok: false, error: 'no race' };
      const t = now();
      if (t < race.startsAt) return { ok: false, error: 'wait for go' };
      if (race.done.has(m.id)) return { ok: false, error: 'already finished' };
      if (typeof typed !== 'string' || typed !== race.text) return { ok: false, error: 'not quite: check the text' };
      if (t - race.startsAt < race.text.length * 30) return { ok: false, error: 'too fast to be typed' }; // about 400 wpm: pasted or scripted
      const ms = t - race.startsAt, wpm = Math.round(race.text.length / 5 / Math.max(ms, 1000) * 60_000);
      race.done.set(m.id, { id: m.id, name: m.name, ms, wpm });
      broadcast({ t: 'race-result', id: race.id, results: raceResults() });
      return { ok: true, ms, wpm };
    },
    startQuiz(m, pack, members) {
      if (busy()) return { ok: false, error: 'a game is already running' };
      const bank = TRIVIA[pack]; if (!bank) return { ok: false, error: 'unknown pack' };
      const list = bank.map(x => [rand(), x]).sort((a, b) => a[0] - b[0]).slice(0, questions).map(x => x[1]);
      quiz = { id: 'q' + (++seq), pack, list, n: 0, open: false, answers: new Map(), score: new Map(), over: false, ends: 0 };
      for (const p of members) quiz.score.set(p.id, { id: p.id, name: p.name, points: 0 });
      broadcast({ t: 'quiz', id: quiz.id, pack, by: m.name, questions: list.length });
      later(countdownMs, nextQuestion);
      return { ok: true };
    },
    // One answer per member per question, only while it is open; points shrink with the time taken.
    answer(m, id, n, choice) {
      if (!quiz || quiz.over || quiz.id !== id || !quiz.open || n !== quiz.n + 1) return { ok: false, error: 'question closed' };
      if (!Number.isInteger(choice) || choice < 0 || choice > 3) return { ok: false, error: 'bad choice' };
      if (quiz.answers.has(m.id)) return { ok: false, error: 'already answered' };
      if (!quiz.score.has(m.id)) quiz.score.set(m.id, { id: m.id, name: m.name, points: 0 }); // joined mid-quiz
      quiz.answers.set(m.id, { choice, left: quiz.ends - now() });
      return { ok: true };
    },
    // What a member joining late needs to catch up.
    state() {
      return { at: now(), race: race && !race.over ? { id: race.id, text: race.text, startsAt: race.startsAt, ends: race.ends, results: raceResults() } : null,
        quiz: quiz && !quiz.over && quiz.open ? { id: quiz.id, n: quiz.n + 1, of: quiz.list.length, q: quiz.list[quiz.n].q, a: quiz.list[quiz.n].a, ends: quiz.ends, scores: scores() } : null };
    },
    stop() { for (const t of timers) clearTimeout(t); timers.clear(); },
  };
}
