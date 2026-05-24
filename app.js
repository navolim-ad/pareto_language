// ============== Constants ==============
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LANG_LABELS = {
  en: 'English',
  es: 'Español',
  ar: 'العربية',
  sr: 'Srpski',
  th: 'ภาษาไทย',
};

// ============== State ==============
const state = {
  words: [],
  themes: [],
  sentences: [],
  settings: null,
  progress: {},
  daily: { date: '', done: 0 },
  session: null,
  voices: new Set(),
};

// ============== Audio (TTS) ==============
const VOICE_LANG = { ar: 'ar-SA', es: 'es-ES', sr: 'sr-RS', hr: 'hr-HR', th: 'th-TH', en: 'en-US' };

// Fallback voices when the primary language isn't installed.
// Serbian falls back to Croatian — mutually intelligible, near-identical phonetics.
const VOICE_FALLBACK = { sr: 'hr' };

// Female voice name hints by language (preferred when available).
const FEMALE_VOICE_HINTS = {
  ar: ['laila', 'maha', 'reema', 'rana', 'amina', 'female'],
  es: ['mónica', 'monica', 'paulina', 'marisol', 'soledad', 'angelica', 'female'],
  sr: ['female'],
  hr: ['lana', 'female'],
  th: ['kanya', 'narisa', 'siri', 'female'],
  en: ['samantha', 'karen', 'tessa', 'fiona', 'moira', 'serena', 'allison', 'ava', 'female'],
};

function refreshVoices() {
  state.voices = new Set();
  if (!('speechSynthesis' in window)) return;
  const list = speechSynthesis.getVoices();
  for (const v of list) {
    state.voices.add(v.lang.toLowerCase().split('-')[0]);
  }
}
function canSpeak(lang) {
  // If speech synthesis exists at all, show the button. iOS Safari's voice
  // list is often incomplete — it may have the voice even if getVoices() omits it.
  return 'speechSynthesis' in window;
}
function resolvedSpeakLang(lang) {
  if (state.voices.has(lang)) return lang;
  const fb = VOICE_FALLBACK[lang];
  if (fb && state.voices.has(fb)) return fb;
  // Last resort: still try the original language — iOS may have a voice we can't see.
  return lang;
}

function pickVoice(lang) {
  if (!('speechSynthesis' in window)) return null;
  const prefix = lang.toLowerCase();
  const matching = speechSynthesis.getVoices().filter(v =>
    v.lang.toLowerCase().split('-')[0] === prefix
  );
  if (matching.length === 0) return null;
  const hints = FEMALE_VOICE_HINTS[lang] || [];
  for (const v of matching) {
    const name = v.name.toLowerCase();
    if (hints.some(h => name.includes(h))) return v;
  }
  return matching[0];
}

function speak(text, lang) {
  const effective = resolvedSpeakLang(lang);
  if (!effective || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = VOICE_LANG[effective] || effective;
  const v = pickVoice(effective);
  if (v) u.voice = v;
  u.rate = 0.85;
  speechSynthesis.speak(u);
}

// ============== Phrase bank (dry / sarcastic encouragement) ==============
const PHRASES = {
  welcome: [
    "Welcome back. The words missed you. Allegedly.",
    "Oh, you again. Let's pretend we remember things.",
    "Returning customer. The forgetting curve says hi.",
    "Five minutes won't kill you. Probably.",
    "Look who's back. Try not to forget this time.",
    "Welcome. The vocab is impressed.",
    "Back for more punishment. Respect.",
    "Statistically remarkable that you came back.",
    "The words are waiting. Politely.",
    "Welcome. Past you would be proud. A bit.",
  ],
  sessionEnd: [
    "Done. Brain marginally upgraded.",
    "Session complete. The dictionary is shaking.",
    "That'll do for today. Or not. You decide.",
    "Modest progress. Glaciers move faster.",
    "You survived. Words on the wall, you on the bed.",
    "Done. The forgetting curve approves.",
    "Tomorrow exists. Use it.",
    "Lesson over. Your future self thanks you. Probably.",
    "A small victory. Add it to the pile.",
    "Class dismissed. The vocabulary takes a bow.",
  ],
  dailyGoal: [
    "🎯 Goal reached. Overachieving is also a sport.",
    "🎯 Daily goal hit. Now go touch grass.",
    "🎯 Done with today's quota. The minimum is also a minimum.",
    "🎯 Goal reached. The bar was where you set it.",
    "🎯 Hit your target. Marginally less ignorant.",
  ],
  matchIntro: [
    "Quick match round",
    "Round of four",
    "Match the pairs",
    "Quick pairing",
    "Same word, two sides",
  ],
  sentenceIntro: [
    "✨ Using what you know",
    "✨ Words, assembled",
    "✨ Look what you can read",
    "✨ A small sentence",
    "✨ Your vocabulary, in public",
  ],
  masteredTiers: {
    zero: [
      "This is where mastered words live. Currently uninhabited.",
      "Empty. The vocab graveyard has a vacancy.",
      "Nothing here yet. Suspicious, but recoverable.",
    ],
    one: [
      "{n} mastered word. A start. Barely.",
      "{n} word in. The dictionary noticed. Briefly.",
    ],
    few: [
      "{n} mastered. Small but real. More would be nice.",
      "{n} words in the bag. Modest haul.",
      "{n} mastered. A polite handful.",
    ],
    ten: [
      "{n} mastered. The dictionary is mildly curious.",
      "{n} words. Past the toy zone. Keep going.",
      "{n} mastered. Respectable beginnings.",
    ],
    twentyfive: [
      "{n} mastered. Solid. More awaits.",
      "{n} words. Coffee-shop survivable.",
      "{n} mastered. Not bad. Don't get smug.",
    ],
    fifty: [
      "{n} mastered. Halfway to actually useful.",
      "{n} words. A real conversation is getting closer.",
      "{n} mastered. The fluency illusion approaches.",
    ],
    hundred: [
      "{n} mastered. Suddenly real.",
      "{n} words. The accent does the rest.",
      "{n} mastered. People might respond unprompted.",
    ],
    twohundred: [
      "{n} mastered. Don't stop now.",
      "{n} words. The dictionary is sweating.",
      "{n} mastered. Annoyingly competent.",
    ],
    all: [
      "All {n} mastered. The vocabulary has been conquered. Add more.",
      "{n} of {n}. Now what.",
      "{n} mastered. Statistically you no longer need this app.",
    ],
  },
};

const MILESTONE_BLURBS = {
  first: '🌱 First word mastered! Glaciers move faster, but it begins.',
  ten: '🎯 10 words. The dictionary is politely unimpressed.',
  twentyfive: '🎉 25 words. Almost enough to order coffee.',
  fifty: '💪 50 words. Halfway to mildly conversational.',
  hundred: '🏆 100 words mastered. Suddenly real.',
  twohundred: '🌟 200 words. The accent is yours to ruin.',
  three_fifty: '👑 350 words. The dictionary surrenders.',
};

function pickPhrase(bank, key) {
  if (!bank || bank.length === 0) return '';
  const k = `phrase:${key}`;
  const lastIdx = parseInt(localStorage.getItem(k) || '-1', 10);
  let idx;
  if (bank.length === 1) idx = 0;
  else {
    do { idx = Math.floor(Math.random() * bank.length); } while (idx === lastIdx);
  }
  localStorage.setItem(k, String(idx));
  return bank[idx];
}

function masteredTierPhrase(count, total) {
  let tier;
  if (count === 0) tier = 'zero';
  else if (count === 1) tier = 'one';
  else if (count < 10) tier = 'few';
  else if (count < 25) tier = 'ten';
  else if (count < 50) tier = 'twentyfive';
  else if (count < 100) tier = 'fifty';
  else if (count < 200) tier = 'hundred';
  else if (count < total) tier = 'twohundred';
  else tier = 'all';
  const bank = PHRASES.masteredTiers[tier];
  const phrase = pickPhrase(bank, `mastered:${tier}`);
  return phrase.replace(/\{n\}/g, count);
}

// ============== Personal mnemonics (P3) ==============
function getMnemonic(wordId) {
  const key = storageKey(`notes:${pairKey()}`);
  let notes = {};
  try { notes = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
  return notes[wordId] || '';
}

function saveMnemonic(wordId, text) {
  const key = storageKey(`notes:${pairKey()}`);
  let notes = {};
  try { notes = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
  const trimmed = (text || '').trim();
  if (trimmed) notes[wordId] = trimmed;
  else delete notes[wordId];
  localStorage.setItem(key, JSON.stringify(notes));
}

function renderMnemonic(wordId) {
  const display = document.getElementById('mnemonic-display');
  const toggle = document.getElementById('mnemonic-toggle');
  const edit = document.getElementById('mnemonic-edit');
  if (!display || !toggle || !edit) return;
  edit.classList.add('hidden');
  const note = getMnemonic(wordId);
  if (note) {
    display.classList.remove('hidden');
    display.textContent = note;
    toggle.textContent = '📝 Edit note';
  } else {
    display.classList.add('hidden');
    toggle.textContent = '📝 Add note';
  }
  toggle.onclick = () => openMnemonicEdit(wordId);
  display.onclick = () => openMnemonicEdit(wordId);
}

function openMnemonicEdit(wordId) {
  const display = document.getElementById('mnemonic-display');
  const edit = document.getElementById('mnemonic-edit');
  const input = document.getElementById('mnemonic-input');
  const toggle = document.getElementById('mnemonic-toggle');
  input.value = getMnemonic(wordId);
  edit.classList.remove('hidden');
  display.classList.add('hidden');
  toggle.textContent = '📝 Note';
  document.getElementById('mnemonic-save').onclick = () => {
    saveMnemonic(wordId, input.value);
    renderMnemonic(wordId);
  };
  document.getElementById('mnemonic-cancel').onclick = () => {
    renderMnemonic(wordId);
  };
  setTimeout(() => input.focus(), 60);
}

function nextMilestoneText(mature, total) {
  const targets = [1, 10, 25, 50, 100, 200, 350];
  for (const t of targets) {
    if (mature < t && t <= total) {
      return `${t - mature} more to ${t}`;
    }
  }
  return '';
}

// ============== Card modes & direction ==============
const CARD_MODES = ['reveal', 'type', 'choice'];

function canTypeInTarget() {
  if (!state.settings) return false;
  const tgt = state.settings.target;
  if (tgt === 'es') return true;
  if (tgt === 'sr' && state.settings.sr_script === 'latin') return true;
  return false;
}

function pickDirection(cardState) {
  if (!state.settings) return 'forward';
  const dir = state.settings.direction || 'both';
  if (dir === 'forward') return 'forward';
  if (dir === 'reverse') return 'reverse';
  // 'both' — weight reverse probability by how well the card is known.
  // New / Learning words shouldn't be tested in recall yet.
  const label = cardLabel(cardState);
  let reverseProb;
  if (label === 'new') reverseProb = 0;
  else if (label === 'learning') reverseProb = 0.10;
  else if (label === 'young') reverseProb = 0.30;
  else reverseProb = 0.50;
  return Math.random() < reverseProb ? 'reverse' : 'forward';
}

function pickCardMode(direction) {
  if (!state.settings || state.settings.mixedMode === false) return 'reveal';
  let modes = ['reveal', 'type', 'choice'];
  // In recall direction with a non-Latin target, typing is unrealistic — drop it.
  if (direction === 'reverse' && !canTypeInTarget()) {
    modes = ['reveal', 'choice'];
  }
  return modes[Math.floor(Math.random() * modes.length)];
}

function normalizeAnswer(str) {
  return str.toLowerCase().trim()
    .replace(/\([^)]*\)/g, ' ')          // remove parenthetical disambiguations like (m) / (plural)
    .replace(/[.,!?;:'"¿¡]/g, '')
    .replace(/^(a |an |the |to )/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      if (a[i - 1] === b[j - 1]) prev[j] = prevDiag;
      else prev[j] = 1 + Math.min(prev[j], prev[j - 1], prevDiag);
      prevDiag = tmp;
    }
  }
  return prev[n];
}

// Map number words (en + es) to digits so users can type "6" or "six".
const NUMBER_EQUIVS = {
  '1': ['one', 'uno'], '2': ['two', 'dos'], '3': ['three', 'tres'],
  '4': ['four', 'cuatro'], '5': ['five', 'cinco'], '6': ['six', 'seis'],
  '7': ['seven', 'siete'], '8': ['eight', 'ocho'], '9': ['nine', 'nueve'],
  '10': ['ten', 'diez'], '11': ['eleven', 'once'], '12': ['twelve', 'doce'],
  '13': ['thirteen', 'trece'], '14': ['fourteen', 'catorce'],
  '15': ['fifteen', 'quince'], '16': ['sixteen', 'dieciséis', 'dieciseis'],
  '17': ['seventeen', 'diecisiete'], '18': ['eighteen', 'dieciocho'],
  '19': ['nineteen', 'diecinueve'], '20': ['twenty', 'veinte'],
  '30': ['thirty', 'treinta'], '40': ['forty', 'cuarenta'],
  '50': ['fifty', 'cincuenta'], '60': ['sixty', 'sesenta'],
  '70': ['seventy', 'setenta'], '80': ['eighty', 'ochenta'],
  '90': ['ninety', 'noventa'], '100': ['hundred', 'cien'],
  '1000': ['thousand', 'mil'],
};
const NUMBER_WORD_TO_DIGIT = {};
for (const [digit, words] of Object.entries(NUMBER_EQUIVS)) {
  for (const w of words) NUMBER_WORD_TO_DIGIT[w] = digit;
}
function toNumberDigit(str) {
  const s = str.toLowerCase().trim();
  if (NUMBER_WORD_TO_DIGIT[s]) return NUMBER_WORD_TO_DIGIT[s];
  if (/^\d+$/.test(s)) return s;
  return null;
}

function checkTypedAnswer(userAnswer, expected) {
  const u = normalizeAnswer(userAnswer);
  const e = normalizeAnswer(expected);
  if (!u) return 'wrong';
  if (u === e) return 'exact';
  // Number-digit equivalence: "6" and "six" both accepted.
  const uDigit = toNumberDigit(u);
  const eDigit = toNumberDigit(e);
  if (uDigit && eDigit && uDigit === eDigit) return 'exact';
  const tolerance = Math.max(1, Math.floor(e.length / 5));
  if (levenshtein(u, e) <= tolerance) return 'close';
  return 'wrong';
}

function pickChoiceOptions(word, direction) {
  // Answer language is opposite of prompt: forward = source on answer, reverse = target on answer.
  const ansLang = direction === 'reverse' ? state.settings.target : state.settings.source;
  const correct = word[ansLang];
  // Candidates must have a translation in the answer language.
  const candidates = state.words.filter(w => w[ansLang] && w.id !== word.id && w[ansLang] !== correct);
  const sameTheme = candidates.filter(w => w.theme === word.theme);
  shuffle(sameTheme);
  const distractors = [];
  for (const w of sameTheme) {
    if (distractors.length >= 3) break;
    if (!distractors.includes(w[ansLang])) distractors.push(w[ansLang]);
  }
  if (distractors.length < 3) {
    shuffle(candidates);
    for (const w of candidates) {
      if (distractors.length >= 3) break;
      if (!distractors.includes(w[ansLang])) distractors.push(w[ansLang]);
    }
  }
  const options = [correct, ...distractors];
  shuffle(options);
  return { options, correct };
}

// ============== Storage ==============
function storageKey(suffix) { return `pareto:${suffix}`; }
function pairKey() { return `${state.settings.source}-${state.settings.target}`; }

function saveSettings() {
  localStorage.setItem(storageKey('settings'), JSON.stringify(state.settings));
}
function loadSettings() {
  const raw = localStorage.getItem(storageKey('settings'));
  return raw ? JSON.parse(raw) : null;
}
function saveProgress() {
  localStorage.setItem(storageKey(`progress:${pairKey()}`), JSON.stringify(state.progress));
}
function loadProgress() {
  const raw = localStorage.getItem(storageKey(`progress:${pairKey()}`));
  state.progress = raw ? JSON.parse(raw) : {};
}
function saveDaily() {
  localStorage.setItem(storageKey(`daily:${pairKey()}`), JSON.stringify(state.daily));
}
function loadDaily() {
  const raw = localStorage.getItem(storageKey(`daily:${pairKey()}`));
  const today = todayStr();
  if (raw) {
    const d = JSON.parse(raw);
    if (d.date === today) { state.daily = d; return; }
  }
  state.daily = { date: today, done: 0, goalCelebrated: false };
  saveDaily();
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ============== SRS ==============
function defaultCardState() {
  return { reps: 0, interval: 0, ease: 2.5, due: 0 };
}

function gradeCard(card, grade) {
  const now = Date.now();
  if (grade === 'again') {
    card.ease = Math.max(1.3, card.ease - 0.2);
    card.interval = 0;
    card.due = now;
    card.reps = Math.max(1, card.reps);
  } else if (grade === 'good') {
    if (card.reps === 0 || card.interval === 0) {
      card.interval = MS_PER_DAY;
    } else {
      card.interval = Math.round(card.interval * card.ease);
    }
    card.due = now + card.interval;
    card.reps += 1;
  } else if (grade === 'easy') {
    if (card.reps === 0 || card.interval === 0) {
      card.interval = 4 * MS_PER_DAY;
    } else {
      card.interval = Math.round(card.interval * card.ease * 1.3);
    }
    card.ease = Math.min(3.5, card.ease + 0.15);
    card.due = now + card.interval;
    card.reps += 1;
  }
  return card;
}

function cardLabel(card) {
  if (!card || card.reps === 0) return 'new';
  if (card.interval < MS_PER_DAY) return 'learning';
  if (card.interval < 21 * MS_PER_DAY) return 'young';
  return 'mature';
}

// ============== Stats ==============
function wordsForTarget() {
  const tgt = state.settings && state.settings.target;
  if (!tgt) return state.words;
  return state.words.filter(w => w[tgt]);
}

function calcStats() {
  const list = wordsForTarget();
  const stats = { new: 0, learning: 0, young: 0, mature: 0, total: list.length };
  for (const w of list) {
    stats[cardLabel(state.progress[w.id])] += 1;
  }
  return stats;
}

// ============== Queue ==============
function buildQueue(themeFilter) {
  const now = Date.now();
  const tgt = state.settings.target;
  const due = [];
  const fresh = [];
  for (const w of state.words) {
    if (!w[tgt]) continue; // skip words without target-language translation
    if (themeFilter && w.theme !== themeFilter) continue;
    const s = state.progress[w.id];
    if (!s || s.reps === 0) {
      fresh.push(w);
    } else if (s.due <= now) {
      due.push(w);
    }
  }
  fresh.sort((a, b) => a.order - b.order);
  shuffle(due);
  // No hard cap on new cards — daily goal is a target, not a limit.
  // Cap to a sane session size so a fresh user isn't hit with everything at once.
  const SESSION_NEW_CAP = 30;
  const newCap = themeFilter ? fresh.length : Math.min(fresh.length, SESSION_NEW_CAP);
  const newSlice = fresh.slice(0, newCap);
  // Shuffle within the batch — keeps Pareto ordering across batches,
  // but no single session feels like the same fixed list.
  shuffle(newSlice);
  return [...due, ...newSlice];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============== UI ==============
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function getDisplayWord(word, lang) {
  if (lang === 'sr') return state.settings.sr_script === 'cyrillic' ? word.sr_cyr : word.sr;
  return word[lang];
}

function humanTheme(t) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatInterval(ms) {
  if (ms <= 0) return '<1m';
  const days = ms / MS_PER_DAY;
  if (days < 1) return '<1d';
  if (days < 30) return Math.round(days) + 'd';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return Math.round(days / 365) + 'y';
}

function renderHome() {
  document.getElementById('home-pair-label').textContent =
    `${LANG_LABELS[state.settings.source]} → ${LANG_LABELS[state.settings.target]}`;

  // Welcome banner pops in once per app launch.
  maybeShowWelcomeBanner();

  const stats = calcStats();
  const statMastered = document.getElementById('stat-mastered');
  statMastered.textContent = stats.mature;
  statMastered.classList.toggle('has-mastered', stats.mature > 0);
  document.getElementById('stat-total').textContent = stats.total;

  const pct = stats.total ? (stats.mature / stats.total) * 100 : 0;
  document.getElementById('stat-bar-fill').style.width = pct + '%';

  document.getElementById('daily-done').textContent = state.daily.done;
  document.getElementById('daily-goal').textContent = state.settings.dailyGoal;
  const dailyPct = Math.min(100, (state.daily.done / state.settings.dailyGoal) * 100);
  document.getElementById('daily-bar-fill').style.width = dailyPct + '%';

  // Next-milestone hint.
  document.getElementById('next-milestone').textContent = nextMilestoneText(stats.mature, stats.total);

  // Study-now button shows the actual lesson length you're committing to.
  const studyBtn = document.getElementById('start-study');
  const queueSize = buildQueue(null).length;
  const LESSON_CARD_TARGET = 15;
  const lessonSize = Math.min(queueSize, LESSON_CARD_TARGET);
  if (lessonSize === 0) {
    studyBtn.textContent = 'Nothing due — but you can try anyway';
  } else {
    studyBtn.textContent = `Study now · ${lessonSize} cards`;
  }

  renderThemeProgress();
  renderWordOfDay();
  renderActivityCalendar();
}

// ============== Theme progress rows ==============
function renderThemeProgress() {
  const container = document.getElementById('theme-progress');
  if (!container) return;
  container.innerHTML = '';
  const tgt = state.settings.target;
  const themeTotals = {};
  const themeMature = {};
  for (const w of state.words) {
    if (!w[tgt]) continue;
    themeTotals[w.theme] = (themeTotals[w.theme] || 0) + 1;
    if (cardLabel(state.progress[w.id]) === 'mature') {
      themeMature[w.theme] = (themeMature[w.theme] || 0) + 1;
    }
  }
  for (const theme of state.themes) {
    const total = themeTotals[theme] || 0;
    if (total === 0) continue;
    const mature = themeMature[theme] || 0;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `theme-row theme-${theme}`;
    row.addEventListener('click', () => startSession(theme));

    const top = document.createElement('div');
    top.className = 'theme-row-top';
    const name = document.createElement('span');
    name.className = 'theme-row-name';
    name.textContent = humanTheme(theme);
    const count = document.createElement('span');
    count.className = 'theme-row-count';
    count.textContent = `${mature} / ${total}`;
    top.appendChild(name);
    top.appendChild(count);

    const bar = document.createElement('div');
    bar.className = 'theme-row-bar';
    const fill = document.createElement('div');
    fill.className = 'theme-row-bar-fill';
    fill.style.width = `${total ? (mature / total) * 100 : 0}%`;
    bar.appendChild(fill);

    row.appendChild(top);
    row.appendChild(bar);
    container.appendChild(row);
  }
}

// ============== Word of the day ==============
function renderWordOfDay() {
  const wodEl = document.getElementById('word-of-day');
  if (!wodEl) return;
  const today = todayStr();
  const key = storageKey(`wod:${pairKey()}`);
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
  const tgt = state.settings.target;
  let pick = null;
  if (stored && stored.date === today) {
    pick = state.words.find(w => w.id === stored.wordId && w[tgt]);
  }
  if (!pick) {
    const candidates = state.words.filter(w => w[tgt] && cardLabel(state.progress[w.id]) !== 'mature');
    if (candidates.length === 0) {
      wodEl.classList.add('hidden');
      return;
    }
    pick = candidates[Math.floor(Math.random() * candidates.length)];
    localStorage.setItem(key, JSON.stringify({ date: today, wordId: pick.id }));
  }
  wodEl.classList.remove('hidden');
  const src = state.settings.source;
  document.getElementById('wod-emoji').textContent = pick.emoji || '';
  const targetEl = document.getElementById('wod-target');
  targetEl.textContent = getDisplayWord(pick, tgt);
  if (tgt === 'ar') targetEl.setAttribute('dir', 'rtl');
  else targetEl.removeAttribute('dir');
  let translit = '';
  if (tgt === 'ar' && pick.ar_translit) translit = pick.ar_translit;
  else if (tgt === 'th' && pick.th_translit) translit = pick.th_translit;
  document.getElementById('wod-translit').textContent = translit;
  document.getElementById('wod-source').textContent = pick[src];

  const wodAudio = document.getElementById('wod-audio-btn');
  if (canSpeak(tgt)) {
    wodAudio.classList.remove('hidden');
    wodAudio.onclick = (e) => { e.stopPropagation(); speak(pick[tgt], tgt); };
  } else {
    wodAudio.classList.add('hidden');
  }
}

// ============== Activity calendar ==============
function recordActivityToday() {
  const today = todayStr();
  const key = storageKey(`activity:${pairKey()}`);
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  if (!arr.includes(today)) {
    arr.push(today);
    arr.sort();
    if (arr.length > 60) arr = arr.slice(-60);
    localStorage.setItem(key, JSON.stringify(arr));
  }
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renderActivityCalendar() {
  const dots = document.getElementById('activity-dots');
  if (!dots) return;
  const key = storageKey(`activity:${pairKey()}`);
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
  const activeSet = new Set(arr);
  const today = new Date();
  const todayKey = todayStr();
  dots.innerHTML = '';
  let activeCount = 0;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const k = dateStr(d);
    const dot = document.createElement('div');
    dot.className = 'activity-dot';
    if (activeSet.has(k)) { dot.classList.add('active'); activeCount++; }
    if (k === todayKey) dot.classList.add('today');
    dot.title = k;
    dots.appendChild(dot);
  }
  document.getElementById('activity-summary').textContent =
    activeCount === 0 ? 'No activity yet' :
    `${activeCount} day${activeCount !== 1 ? 's' : ''} active`;
}

// ============== Milestones ==============
const MILESTONES = [
  { id: 'first', count: 1, message: MILESTONE_BLURBS.first },
  { id: 'ten', count: 10, message: MILESTONE_BLURBS.ten },
  { id: 'twentyfive', count: 25, message: MILESTONE_BLURBS.twentyfive },
  { id: 'fifty', count: 50, message: MILESTONE_BLURBS.fifty },
  { id: 'hundred', count: 100, message: MILESTONE_BLURBS.hundred },
  { id: 'twohundred', count: 200, message: MILESTONE_BLURBS.twohundred },
  { id: 'three_fifty', count: 350, message: MILESTONE_BLURBS.three_fifty },
];

function checkMilestones(prevMature, newMature) {
  if (newMature <= prevMature) {
    checkThemeCompletion();
    return;
  }
  const key = storageKey(`milestones:${pairKey()}`);
  let celebrated = {};
  try { celebrated = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
  for (const m of MILESTONES) {
    if (newMature >= m.count && prevMature < m.count && !celebrated[m.id]) {
      celebrated[m.id] = true;
      localStorage.setItem(key, JSON.stringify(celebrated));
      setTimeout(() => showToast(m.message, 3500), 400);
      return;
    }
  }
  checkThemeCompletion();
}

function checkThemeCompletion() {
  const key = storageKey(`milestones:${pairKey()}`);
  let celebrated = {};
  try { celebrated = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
  const tgt = state.settings.target;
  const themeTotals = {};
  const themeMature = {};
  for (const w of state.words) {
    if (!w[tgt]) continue;
    themeTotals[w.theme] = (themeTotals[w.theme] || 0) + 1;
    if (cardLabel(state.progress[w.id]) === 'mature') {
      themeMature[w.theme] = (themeMature[w.theme] || 0) + 1;
    }
  }
  for (const theme of Object.keys(themeTotals)) {
    const themeKey = `theme:${theme}`;
    if (themeTotals[theme] >= 4 && themeMature[theme] === themeTotals[theme] && !celebrated[themeKey]) {
      celebrated[themeKey] = true;
      localStorage.setItem(key, JSON.stringify(celebrated));
      setTimeout(() => showToast(`✨ ${humanTheme(theme)} complete!`, 3500), 400);
      return;
    }
  }
}

function renderCard(word, showAnswer) {
  const src = state.settings.source;
  const tgt = state.settings.target;
  const direction = (state.session && state.session.cardDirection) || 'forward';
  const promptLang = direction === 'reverse' ? src : tgt;
  const answerLang = direction === 'reverse' ? tgt : src;
  const mode = (state.session && state.session.cardMode) || 'reveal';

  // Prompt
  const promptEl = document.getElementById('card-prompt');
  promptEl.textContent = getDisplayWord(word, promptLang);
  if (promptLang === 'ar') promptEl.setAttribute('dir', 'rtl');
  else promptEl.removeAttribute('dir');

  // Meta (translit / alt script — shown only if prompt is target language with extras)
  const metaEl = document.getElementById('card-meta');
  if (promptLang === 'ar' && word.ar_translit) {
    metaEl.textContent = word.ar_translit;
  } else if (promptLang === 'th' && word.th_translit) {
    metaEl.textContent = word.th_translit;
  } else if (promptLang === 'sr') {
    metaEl.textContent = state.settings.sr_script === 'cyrillic' ? word.sr : word.sr_cyr;
  } else {
    metaEl.textContent = '';
  }

  // Audio button on prompt — show if the prompt language has TTS.
  const audioBtn = document.getElementById('audio-btn');
  if (canSpeak(promptLang)) {
    audioBtn.classList.remove('hidden');
    audioBtn.onclick = (e) => { e.stopPropagation(); speak(word[promptLang], promptLang); };
  } else {
    audioBtn.classList.add('hidden');
  }

  const emojiEl = document.getElementById('card-emoji');
  const answerEl = document.getElementById('card-answer');
  const answerMain = document.getElementById('card-answer-main');
  const answerTranslit = document.getElementById('card-answer-translit');
  const answerAudioBtn = document.getElementById('answer-audio-btn');
  const exampleEl = document.getElementById('card-example');
  const exampleSrcEl = document.getElementById('card-example-src');
  const exampleTgtEl = document.getElementById('card-example-tgt');
  const exampleTransEl = document.getElementById('card-example-translit');
  const skipBtn = document.getElementById('skip-known-btn');
  const skipHint = document.getElementById('skip-hint');

  const revealRow = document.getElementById('reveal-row');
  const typeRow = document.getElementById('type-input-row');
  const dontknowRow = document.getElementById('type-dontknow-row');
  const choiceRow = document.getElementById('choice-row');
  const gradeRow = document.getElementById('grade-row');
  const feedback = document.getElementById('check-feedback');

  const cardState = state.progress[word.id];
  const isNew = !cardState || cardState.reps === 0;

  if (showAnswer) {
    // Hide all input UIs.
    revealRow.classList.add('hidden');
    typeRow.classList.add('hidden');
    dontknowRow.classList.add('hidden');
    choiceRow.classList.add('hidden');
    skipBtn.classList.add('hidden');
    skipHint.classList.add('hidden');
    gradeRow.classList.remove('hidden');

    answerEl.classList.remove('hidden');
    answerMain.textContent = getDisplayWord(word, answerLang);
    if (answerLang === 'ar') answerMain.setAttribute('dir', 'rtl');
    else answerMain.removeAttribute('dir');

    // Translit / alt script on answer (when target is the answer in recall direction)
    let ansTranslitText = '';
    if (answerLang === 'ar' && word.ar_translit) ansTranslitText = word.ar_translit;
    else if (answerLang === 'th' && word.th_translit) ansTranslitText = word.th_translit;
    else if (answerLang === 'sr') ansTranslitText = state.settings.sr_script === 'cyrillic' ? word.sr : word.sr_cyr;
    answerTranslit.textContent = ansTranslitText;

    // Audio on the answer — show if answer language has TTS and isn't already on prompt side.
    if (canSpeak(answerLang) && answerLang !== promptLang) {
      answerAudioBtn.classList.remove('hidden');
      answerAudioBtn.onclick = (e) => { e.stopPropagation(); speak(word[answerLang], answerLang); };
    } else {
      answerAudioBtn.classList.add('hidden');
    }

    emojiEl.textContent = word.emoji || '';
    if (word.emoji) {
      emojiEl.classList.remove('pop');
      void emojiEl.offsetWidth;
      emojiEl.classList.add('pop');
    }

    // Example — always shows source + target.
    if (word.example && word.example[src] && word.example[tgt]) {
      exampleEl.classList.remove('hidden');
      exampleSrcEl.textContent = word.example[src];
      const tgtExample = (tgt === 'sr')
        ? (state.settings.sr_script === 'cyrillic' ? word.example.sr_cyr : word.example.sr)
        : word.example[tgt];
      exampleTgtEl.textContent = tgtExample || '';
      if (tgt === 'ar') exampleTgtEl.setAttribute('dir', 'rtl');
      else exampleTgtEl.removeAttribute('dir');
      let translitText = '';
      if (tgt === 'ar' && word.example.ar_translit) translitText = word.example.ar_translit;
      else if (tgt === 'th' && word.example.th_translit) translitText = word.example.th_translit;
      exampleTransEl.textContent = translitText;

      const exAudioBtn = document.getElementById('example-audio-btn');
      if (canSpeak(tgt) && word.example[tgt]) {
        exAudioBtn.classList.remove('hidden');
        exAudioBtn.onclick = (e) => { e.stopPropagation(); speak(word.example[tgt], tgt); };
      } else {
        exAudioBtn.classList.add('hidden');
      }
    } else {
      exampleEl.classList.add('hidden');
    }

    // Mnemonic note (P3)
    renderMnemonic(word.id);
    return;
  }

  // ----- Prompt phase -----
  answerEl.classList.add('hidden');
  exampleEl.classList.add('hidden');
  gradeRow.classList.add('hidden');
  feedback.classList.add('hidden');

  // Emoji is a hint for new cards in reveal mode only. In type/choice modes the
  // emoji often gives away the answer (especially for numbers and concrete nouns),
  // and in recall direction it's always a giveaway.
  const showPromptEmoji = isNew && word.emoji && direction === 'forward' && mode === 'reveal';
  emojiEl.textContent = showPromptEmoji ? word.emoji : '';

  // Hide all input UIs, then show the one for the current mode.
  revealRow.classList.add('hidden');
  typeRow.classList.add('hidden');
  choiceRow.classList.add('hidden');

  dontknowRow.classList.add('hidden');

  if (mode === 'reveal') {
    revealRow.classList.remove('hidden');
  } else if (mode === 'type') {
    typeRow.classList.remove('hidden');
    dontknowRow.classList.remove('hidden');
    document.getElementById('type-dontknow').disabled = false;
    const input = document.getElementById('type-input');
    input.value = '';
    input.disabled = false;
    document.getElementById('type-submit').disabled = false;
    setTimeout(() => input.focus(), 60);
  } else if (mode === 'choice') {
    choiceRow.classList.remove('hidden');
    const ch = state.session.currentChoices;
    document.querySelectorAll('.choice-option').forEach((btn, i) => {
      btn.textContent = ch.options[i] || '';
      btn.classList.remove('correct', 'wrong');
      btn.disabled = false;
      if (answerLang === 'ar') btn.setAttribute('dir', 'rtl');
      else btn.removeAttribute('dir');
    });
  }

  // Skip-known is always available for new cards.
  if (isNew) {
    skipBtn.classList.remove('hidden');
    skipHint.classList.remove('hidden');
  } else {
    skipBtn.classList.add('hidden');
    skipHint.classList.add('hidden');
  }
}

// ============== Interactive mode submission ==============
function submitTypeAnswer() {
  if (!state.session) return;
  const input = document.getElementById('type-input');
  const value = input.value;
  if (!value.trim()) return;

  const w = state.session.queue[state.session.index];
  const direction = state.session.cardDirection || 'forward';
  const ansLang = direction === 'reverse' ? state.settings.target : state.settings.source;
  const expected = w[ansLang];
  const result = checkTypedAnswer(value, expected);
  const feedback = document.getElementById('check-feedback');
  feedback.classList.remove('hidden', 'correct', 'wrong');
  if (result === 'exact') {
    feedback.classList.add('correct');
    feedback.textContent = `✓ Correct!`;
  } else if (result === 'close') {
    feedback.classList.add('correct');
    feedback.textContent = `✓ Close — "${expected}"`;
  } else {
    feedback.classList.add('wrong');
    feedback.textContent = `✗ Answer: ${expected}`;
  }
  input.disabled = true;
  document.getElementById('type-submit').disabled = true;
  renderCard(w, true);
  // Auto-grade: correct → Recognize, wrong → Again. User can still tap a grade
  // button within the delay to override.
  const autoGrade = (result === 'wrong') ? 'again' : 'good';
  scheduleAutoGrade(autoGrade);
}

function submitChoice(idx) {
  if (!state.session) return;
  const w = state.session.queue[state.session.index];
  const ch = state.session.currentChoices;
  const picked = ch.options[idx];
  const correct = ch.correct;

  document.querySelectorAll('.choice-option').forEach((btn) => {
    const t = btn.textContent;
    if (t === correct) btn.classList.add('correct');
    else if (t === picked && picked !== correct) btn.classList.add('wrong');
    btn.disabled = true;
  });

  const feedback = document.getElementById('check-feedback');
  feedback.classList.remove('hidden', 'correct', 'wrong');
  const isCorrect = (picked === correct);
  if (isCorrect) {
    feedback.classList.add('correct');
    feedback.textContent = `✓ Correct!`;
  } else {
    feedback.classList.add('wrong');
    feedback.textContent = `✗ Answer: ${correct}`;
  }

  // Show full answer screen and auto-grade.
  setTimeout(() => {
    if (state.session && state.session.queue[state.session.index] === w) {
      renderCard(w, true);
      scheduleAutoGrade(isCorrect ? 'good' : 'again');
    }
  }, 600);
}

function typeDontKnow() {
  if (!state.session) return;
  const w = state.session.queue[state.session.index];
  const direction = state.session.cardDirection || 'forward';
  const ansLang = direction === 'reverse' ? state.settings.target : state.settings.source;
  const expected = w[ansLang];
  const feedback = document.getElementById('check-feedback');
  feedback.classList.remove('hidden', 'correct', 'wrong');
  feedback.classList.add('wrong');
  feedback.textContent = `Answer: ${expected}`;
  document.getElementById('type-input').disabled = true;
  document.getElementById('type-submit').disabled = true;
  document.getElementById('type-dontknow').disabled = true;
  renderCard(w, true);
  scheduleAutoGrade('again');
}

function scheduleAutoGrade(grade) {
  if (!state.session) return;
  // Wrong answers get a longer pause so the user can read the correct answer.
  const delay = grade === 'again' ? 2200 : 1500;
  clearTimeout(state.session._autoTimer);
  state.session._autoTimer = setTimeout(() => {
    if (state.session && !state.session._busy) {
      gradeAndAdvance(grade);
    }
  }, delay);
}

function updateGradeHints(word) {
  const s = state.progress[word.id] || defaultCardState();
  document.getElementById('hint-again').textContent = '<1m';
  document.getElementById('hint-good').textContent = formatInterval(simulate(s, 'good').interval);
  document.getElementById('hint-easy').textContent = formatInterval(simulate(s, 'easy').interval);
}

function simulate(s, grade) {
  const copy = { ...s };
  return gradeCard(copy, grade);
}

// ============== Session ==============
function showToast(message, ms = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('visible'), ms);
}

function maybeShowWelcomeBanner() {
  if (state._welcomeShown) return;
  state._welcomeShown = true;
  const el = document.getElementById('welcome-banner');
  if (!el) return;
  el.textContent = pickPhrase(PHRASES.welcome, 'welcome');
  // Tap to dismiss.
  el.onclick = () => {
    el.classList.remove('visible');
    clearTimeout(el._timer);
  };
  // Slight delay so it feels like it greets you when home settles.
  setTimeout(() => {
    el.classList.add('visible');
    el._timer = setTimeout(() => el.classList.remove('visible'), 4500);
  }, 250);
}

function startSession(themeFilter) {
  const queue = buildQueue(themeFilter);
  if (queue.length === 0) {
    showToast("You're caught up. New cards unlock as you finish today's goal.");
    return;
  }
  const freshIds = new Set();
  const dueIds = new Set();
  for (const w of queue) {
    const s = state.progress[w.id];
    if (!s || s.reps === 0) freshIds.add(w.id);
    else dueIds.add(w.id);
  }
  state.session = {
    queue,
    index: 0,
    answered: 0,
    filterTheme: themeFilter || null,
    countedIds: new Set(),
    freshIds,
    dueIds,
    againCounts: {},
    recentlySeen: [],
    nextMatchAt: 5 + Math.floor(Math.random() * 3), // first match at 5, 6, or 7
    nextSentenceAt: 7 + Math.floor(Math.random() * 4), // first sentence at 7..10
    matchRound: null,
    sentenceCameo: null,
    shownSentenceIds: new Set(),
  };
  show('screen-study');
  renderCurrent();
}

function renderCurrent() {
  if (!state.session) { finishSession(); return; }

  // End the lesson at a controlled length so each session has a clean wrap-up.
  const LESSON_CARD_TARGET = 15;
  if (state.session.answered >= LESSON_CARD_TARGET) {
    finishSession();
    return;
  }

  if (state.session.index >= state.session.queue.length) {
    finishSession();
    return;
  }

  // Sentence cameos take priority — they're the rarer interlude.
  if (shouldTriggerSentence()) {
    startSentenceCameo();
    return;
  }
  // Otherwise, check if a matching round is due.
  if (shouldTriggerMatch()) {
    startMatchRound();
    return;
  }

  const w = state.session.queue[state.session.index];
  document.getElementById('study-progress').textContent =
    `${state.session.index + 1} / ${state.session.queue.length}`;

  // Pick direction (forward = target→source; reverse = source→target) and mode.
  // Reverse probability scales with how well the user knows this specific card.
  const cardStateForDir = state.progress[w.id];
  state.session.cardDirection = pickDirection(cardStateForDir);
  state.session.cardMode = pickCardMode(state.session.cardDirection);
  if (state.session.cardMode === 'choice') {
    state.session.currentChoices = pickChoiceOptions(w, state.session.cardDirection);
  }

  renderCard(w, false);

  const cardEl = document.getElementById('card-area');
  cardEl.classList.remove('enter', 'exit-again', 'exit-good', 'exit-easy');
  void cardEl.offsetWidth;
  cardEl.classList.add('enter');
}

// ============== Matching round ==============
function shouldTriggerMatch() {
  if (!state.session) return false;
  if (state.session.matchRound) return false;
  if (state.session.answered < state.session.nextMatchAt) return false;
  // Need at least 4 unique recently-seen cards for a meaningful round.
  const uniq = [...new Set(state.session.recentlySeen)];
  return uniq.length >= 4;
}

function startMatchRound() {
  // Bump next trigger forward (randomized: 5, 6, or 7 cards from now).
  state.session.nextMatchAt = state.session.answered + 5 + Math.floor(Math.random() * 3);

  // Pick the last 4 unique words from recently-seen.
  const seen = state.session.recentlySeen;
  const uniqIds = [];
  for (let i = seen.length - 1; i >= 0 && uniqIds.length < 4; i--) {
    if (!uniqIds.includes(seen[i])) uniqIds.push(seen[i]);
  }
  const words = uniqIds.map(id => state.words.find(w => w.id === id)).filter(Boolean);
  if (words.length < 4) {
    // Not enough — skip and go to next regular card.
    renderCurrent();
    return;
  }
  state.session.matchRound = {
    words,
    matched: new Set(),
    selectedT: null,
    selectedS: null,
  };
  // Rotate the title for variety.
  const titleEl = document.getElementById('match-title');
  if (titleEl) titleEl.textContent = pickPhrase(PHRASES.matchIntro, 'matchIntro');
  // Show subtitle only on the first match round of the session.
  const subEl = document.getElementById('match-sub');
  if (subEl) {
    if (state.session.matchSubShown) subEl.classList.add('hidden');
    else { subEl.classList.remove('hidden'); state.session.matchSubShown = true; }
  }
  show('screen-matching');
  renderMatchRound();
}

function renderMatchRound() {
  const mr = state.session.matchRound;
  const src = state.settings.source;
  const tgt = state.settings.target;

  const targets = [...mr.words];
  const sources = [...mr.words];
  shuffle(targets);
  shuffle(sources);

  const targetsEl = document.getElementById('match-targets');
  const sourcesEl = document.getElementById('match-sources');
  targetsEl.innerHTML = '';
  sourcesEl.innerHTML = '';

  targets.forEach(w => {
    const tile = document.createElement('button');
    tile.className = 'match-tile';
    tile.dataset.wordId = w.id;
    tile.textContent = getDisplayWord(w, tgt);
    if (tgt === 'ar') tile.setAttribute('dir', 'rtl');
    tile.addEventListener('click', () => handleMatchTap('target', tile));
    targetsEl.appendChild(tile);
  });

  sources.forEach(w => {
    const tile = document.createElement('button');
    tile.className = 'match-tile';
    tile.dataset.wordId = w.id;
    tile.textContent = getDisplayWord(w, src);
    tile.addEventListener('click', () => handleMatchTap('source', tile));
    sourcesEl.appendChild(tile);
  });
}

function handleMatchTap(col, tile) {
  if (!state.session || !state.session.matchRound) return;
  const mr = state.session.matchRound;
  if (tile.classList.contains('matched') || tile.classList.contains('wrong')) return;

  // Speak the tapped word in its column's language.
  const wordId = tile.dataset.wordId;
  const word = state.words.find(w => w.id === wordId);
  if (word) {
    const lang = col === 'target' ? state.settings.target : state.settings.source;
    if (canSpeak(lang)) speak(word[lang], lang);
  }

  if (col === 'target') {
    if (mr.selectedT) mr.selectedT.classList.remove('selected');
    if (mr.selectedT === tile) { mr.selectedT = null; return; }
    mr.selectedT = tile;
    tile.classList.add('selected');
  } else {
    if (mr.selectedS) mr.selectedS.classList.remove('selected');
    if (mr.selectedS === tile) { mr.selectedS = null; return; }
    mr.selectedS = tile;
    tile.classList.add('selected');
  }

  if (mr.selectedT && mr.selectedS) {
    const t = mr.selectedT, s = mr.selectedS;
    mr.selectedT = null;
    mr.selectedS = null;
    if (t.dataset.wordId === s.dataset.wordId) {
      mr.matched.add(t.dataset.wordId);
      t.classList.remove('selected');
      s.classList.remove('selected');
      t.classList.add('matched');
      s.classList.add('matched');
      if (mr.matched.size === mr.words.length) {
        setTimeout(finishMatchRound, 600);
      }
    } else {
      t.classList.add('wrong');
      s.classList.add('wrong');
      setTimeout(() => {
        t.classList.remove('selected', 'wrong');
        s.classList.remove('selected', 'wrong');
      }, 500);
    }
  }
}

function finishMatchRound() {
  if (!state.session) return;
  showToast('Nice round!', 1800);
  state.session.matchRound = null;
  show('screen-study');
  renderCurrent();
}

function skipMatchRound() {
  if (!state.session) return;
  state.session.matchRound = null;
  show('screen-study');
  renderCurrent();
}

// ============== Sentence cameos ==============
function getEligibleSentences() {
  if (!state.sentences || state.sentences.length === 0) return [];
  const tgt = state.settings.target;
  const src = state.settings.source;
  return state.sentences.filter(s => {
    if (!s[tgt] || !s[src]) return false; // need translations for current pair
    if (state.session && state.session.shownSentenceIds.has(s.id)) return false;
    return s.uses.every(wid => cardLabel(state.progress[wid]) === 'mature');
  });
}

function shouldTriggerSentence() {
  if (!state.session) return false;
  if (state.session.sentenceCameo) return false;
  if (state.session.answered < state.session.nextSentenceAt) return false;
  return getEligibleSentences().length > 0;
}

function startSentenceCameo() {
  // Reschedule next sentence cameo: 6..10 cards from now.
  state.session.nextSentenceAt = state.session.answered + 6 + Math.floor(Math.random() * 5);
  const candidates = getEligibleSentences();
  if (candidates.length === 0) {
    renderCurrent();
    return;
  }
  const sentence = candidates[Math.floor(Math.random() * candidates.length)];
  state.session.sentenceCameo = sentence;
  state.session.shownSentenceIds.add(sentence.id);
  // Rotate the pill text.
  const pillEl = document.getElementById('sentence-pill');
  if (pillEl) pillEl.textContent = pickPhrase(PHRASES.sentenceIntro, 'sentenceIntro');
  show('screen-sentence');
  renderSentenceCameo();
}

function tryClozeForWord(sentence, wid, srcLang) {
  const word = state.words.find(w => w.id === wid);
  if (!word || !word[srcLang]) return null;
  const sourceWord = word[srcLang];
  const sourceText = sentence[srcLang];
  if (!sourceText) return null;
  const escaped = sourceWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  if (!regex.test(sourceText)) return null;
  return sourceText.replace(regex, '_____');
}

function makeClozeSource(sentence, srcLang) {
  const uses = [...sentence.uses];
  shuffle(uses);
  for (const wid of uses) {
    const cloze = tryClozeForWord(sentence, wid, srcLang);
    if (cloze) return cloze;
  }
  return null;
}

function renderSentenceCameo() {
  const s = state.session.sentenceCameo;
  if (!s) return;
  const tgt = state.settings.target;
  const src = state.settings.source;

  const targetEl = document.getElementById('sentence-target');
  targetEl.textContent = s[tgt] || '';
  if (tgt === 'ar') targetEl.setAttribute('dir', 'rtl');
  else targetEl.removeAttribute('dir');

  let translit = '';
  if (tgt === 'ar' && s.ar_translit) translit = s.ar_translit;
  else if (tgt === 'th' && s.th_translit) translit = s.th_translit;
  document.getElementById('sentence-translit').textContent = translit;

  const sourceWrap = document.getElementById('sentence-source-wrap');
  const sourceEl = document.getElementById('sentence-source');
  const fullSource = s[src] || '';
  const cloze = makeClozeSource(s, src);
  sourceEl.dataset.full = fullSource;
  if (cloze) {
    // Active version: show source with a blank, user tries to fill, then reveals.
    sourceEl.textContent = cloze;
    sourceEl.classList.add('cloze');
    sourceWrap.classList.remove('hidden');
  } else {
    // Fallback: traditional reveal (no clozable word found).
    sourceEl.textContent = '';
    sourceEl.classList.remove('cloze');
    sourceWrap.classList.add('hidden');
  }
  document.getElementById('sentence-reveal-row').classList.remove('hidden');
  document.getElementById('sentence-done-row').classList.add('hidden');

  // Audio button.
  const audioBtn = document.getElementById('sentence-audio-btn');
  if (canSpeak(tgt)) {
    audioBtn.classList.remove('hidden');
    audioBtn.onclick = (e) => { e.stopPropagation(); speak(s[tgt], tgt); };
  } else {
    audioBtn.classList.add('hidden');
  }
}

function revealSentenceTranslation() {
  if (!state.session || !state.session.sentenceCameo) return;
  const sourceWrap = document.getElementById('sentence-source-wrap');
  const sourceEl = document.getElementById('sentence-source');
  sourceEl.textContent = sourceEl.dataset.full || '';
  sourceEl.classList.remove('cloze');
  sourceWrap.classList.remove('hidden');
  document.getElementById('sentence-reveal-row').classList.add('hidden');
  document.getElementById('sentence-done-row').classList.remove('hidden');
}

function finishSentenceCameo() {
  if (!state.session) return;
  state.session.sentenceCameo = null;
  show('screen-study');
  renderCurrent();
}

function reveal() {
  if (!state.session) return;
  const w = state.session.queue[state.session.index];
  renderCard(w, true);
}

function gradeAndAdvance(grade) {
  if (!state.session || state.session._busy) return;
  // If an auto-grade was scheduled (from type/choice modes), cancel it —
  // either we're firing the auto-grade now, or the user beat it with a manual tap.
  clearTimeout(state.session._autoTimer);
  state.session._busy = true;

  const w = state.session.queue[state.session.index];
  let card = state.progress[w.id];
  if (!card) { card = defaultCardState(); state.progress[w.id] = card; }
  const prevMature = calcStats().mature;
  gradeCard(card, grade);
  const newMature = calcStats().mature;

  if (grade !== 'again' && !state.session.countedIds.has(w.id)) {
    state.daily.done += 1;
    state.session.countedIds.add(w.id);
    if (state.daily.done >= state.settings.dailyGoal && !state.daily.goalCelebrated) {
      state.daily.goalCelebrated = true;
      showToast(pickPhrase(PHRASES.dailyGoal, 'dailyGoal'), 3500);
    }
    saveDaily();
    recordActivityToday();
  }
  saveProgress();
  if (newMature > prevMature) checkMilestones(prevMature, newMature);
  else checkThemeCompletion();

  if (grade === 'again') {
    state.session.againCounts[w.id] = (state.session.againCounts[w.id] || 0) + 1;
    // Cap re-appearances per session. After this many fails, bench the card —
    // it'll show again in the user's next session (still due in SRS), but not
    // again in the current loop.
    const MAX_FAILS_PER_SESSION = 2;
    if (state.session.againCounts[w.id] < MAX_FAILS_PER_SESSION) {
      const offset = Math.min(3, state.session.queue.length - state.session.index - 1);
      const requeueAt = state.session.index + 1 + offset;
      state.session.queue.splice(requeueAt, 0, w);
    } else {
      showToast(`Coming back next session.`, 2000);
    }
  } else {
    // Track for matching rounds (only non-again so user has actually "got" the card).
    state.session.recentlySeen.push(w.id);
    if (state.session.recentlySeen.length > 12) state.session.recentlySeen.shift();
  }

  const cardEl = document.getElementById('card-area');
  cardEl.classList.remove('enter', 'exit-again', 'exit-good', 'exit-easy');
  void cardEl.offsetWidth;
  cardEl.classList.add(`exit-${grade}`);

  if (grade === 'easy') {
    const sparkle = document.createElement('div');
    sparkle.className = 'sparkle-burst';
    sparkle.textContent = '✨';
    cardEl.appendChild(sparkle);
    setTimeout(() => sparkle.remove(), 700);
  }

  const delay = grade === 'again' ? 560 : grade === 'easy' ? 600 : 460;
  setTimeout(() => {
    state.session._busy = false;
    state.session.answered += 1;
    state.session.index += 1;
    renderCurrent();
  }, delay);
}

function finishSession() {
  let newLearned = 0, revisited = 0, lastTheme = null;
  let trickyId = null, trickyCount = 0;
  if (state.session) {
    lastTheme = state.session.filterTheme;
    for (const id of state.session.countedIds) {
      if (state.session.freshIds.has(id)) newLearned++;
      else revisited++;
    }
    for (const id of Object.keys(state.session.againCounts || {})) {
      const c = state.session.againCounts[id];
      if (c > trickyCount) { trickyCount = c; trickyId = id; }
    }
  }
  // Cycle the quip — random dry one-liner each time.
  document.getElementById('done-quip').textContent = pickPhrase(PHRASES.sessionEnd, 'sessionEnd');

  // Stats grid.
  const statsEl = document.getElementById('done-stats');
  statsEl.innerHTML = '';
  const cells = [
    { num: newLearned, label: newLearned === 1 ? 'new word' : 'new words' },
    { num: revisited, label: 'reviewed' },
  ];
  for (const c of cells) {
    const cell = document.createElement('div');
    cell.className = 'done-stat';
    cell.innerHTML = `<div class="done-stat-num">${c.num}</div><div class="done-stat-label">${c.label}</div>`;
    statsEl.appendChild(cell);
  }

  // Trickiest card highlight (its own little card).
  const trickyEl = document.getElementById('done-tricky');
  const trickyWordEl = document.getElementById('done-tricky-word');
  const src = state.settings && state.settings.source;
  if (trickyId && src) {
    const w = state.words.find(x => x.id === trickyId);
    if (w) {
      trickyWordEl.textContent = w[src];
      trickyEl.classList.remove('hidden');
    } else {
      trickyEl.classList.add('hidden');
    }
  } else {
    trickyEl.classList.add('hidden');
  }

  state._lastSessionTheme = lastTheme;
  state.session = null;
  show('screen-done');
}

function skipKnown() {
  if (!state.session || state.session._busy) return;
  const w = state.session.queue[state.session.index];
  let card = state.progress[w.id];
  if (!card) { card = defaultCardState(); state.progress[w.id] = card; }
  const prevMature = calcStats().mature;
  card.reps = 5;
  card.ease = 2.5;
  card.interval = 30 * MS_PER_DAY;
  card.due = Date.now() + card.interval;
  saveProgress();
  const newMature = calcStats().mature;
  if (!state.session.countedIds.has(w.id)) {
    state.daily.done += 1;
    state.session.countedIds.add(w.id);
    saveDaily();
    recordActivityToday();
  }
  if (newMature > prevMature) checkMilestones(prevMature, newMature);
  state.session._busy = true;
  const cardEl = document.getElementById('card-area');
  cardEl.classList.remove('enter', 'exit-again', 'exit-good', 'exit-easy');
  void cardEl.offsetWidth;
  cardEl.classList.add('exit-good');
  setTimeout(() => {
    state.session._busy = false;
    state.session.answered += 1;
    state.session.index += 1;
    renderCurrent();
  }, 360);
}

// ============== Mastered words list ==============
function openMasteredList() {
  const stats = calcStats();
  const summary = document.getElementById('mastered-summary');
  const list = document.getElementById('mastered-list');
  list.innerHTML = '';

  // Tiered snarky intro — adjusts to your count, always slightly under-impressed.
  summary.textContent = masteredTierPhrase(stats.mature, stats.total);

  if (stats.mature === 0) {
    show('screen-mastered');
    return;
  }

  const src = state.settings.source;
  const tgt = state.settings.target;
  const mature = wordsForTarget().filter(w => cardLabel(state.progress[w.id]) === 'mature');

  for (const w of mature) {
    const item = document.createElement('div');
    item.className = 'mastered-item';

    const emoji = document.createElement('div');
    emoji.className = 'mi-emoji';
    emoji.textContent = w.emoji || '·';
    item.appendChild(emoji);

    const target = document.createElement('div');
    target.className = 'mi-target';
    target.textContent = getDisplayWord(w, tgt);
    if (tgt === 'ar') target.setAttribute('dir', 'rtl');
    item.appendChild(target);

    const source = document.createElement('div');
    source.className = 'mi-source';
    source.textContent = getDisplayWord(w, src);
    item.appendChild(source);

    list.appendChild(item);
  }
  show('screen-mastered');
}

function buildSessionSummary() {
  if (!state.session) return 'Session complete.';
  let newLearned = 0, revisited = 0;
  for (const id of state.session.countedIds) {
    if (state.session.freshIds.has(id)) newLearned++;
    else revisited++;
  }
  let trickyId = null, trickyCount = 0;
  for (const id of Object.keys(state.session.againCounts)) {
    const c = state.session.againCounts[id];
    if (c > trickyCount) { trickyCount = c; trickyId = id; }
  }
  const src = state.settings.source;
  const parts = [];
  if (revisited > 0 && newLearned > 0) {
    parts.push(`You revisited ${revisited} word${revisited!==1?'s':''} and learned ${newLearned} new one${newLearned!==1?'s':''}.`);
  } else if (newLearned > 0) {
    parts.push(`You learned ${newLearned} new word${newLearned!==1?'s':''} today.`);
  } else if (revisited > 0) {
    parts.push(`You revisited ${revisited} word${revisited!==1?'s':''}.`);
  } else {
    parts.push('Session complete.');
  }
  if (trickyId) {
    const w = state.words.find(x => x.id === trickyId);
    if (w) parts.push(`The trickiest was "${w[src]}". It'll be back soon.`);
  } else if (newLearned + revisited > 0) {
    parts.push('Nice and steady. See you tomorrow.');
  }
  return parts.join(' ');
}

// ============== Setup screen ==============
function initSetup() {
  let pickedSource = null, pickedTarget = null;
  document.querySelectorAll('[data-group="source"] .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-group="source"] .choice').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      pickedSource = btn.dataset.value;
      updateStart();
    });
  });
  document.querySelectorAll('[data-group="target"] .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-group="target"] .choice').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      pickedTarget = btn.dataset.value;
      updateStart();
    });
  });
  function updateStart() {
    document.getElementById('setup-start').disabled =
      !(pickedSource && pickedTarget && pickedSource !== pickedTarget);
  }
  document.getElementById('setup-start').addEventListener('click', () => {
    state.settings = {
      source: pickedSource,
      target: pickedTarget,
      sr_script: 'latin',
      dailyGoal: 20,
      mixedMode: true,
      direction: 'both',
      onboarded: false,
    };
    saveSettings();
    loadProgress();
    loadDaily();
    show('screen-onboarding');
  });
}

// ============== Onboarding ==============
function initOnboarding() {
  document.getElementById('onboarding-done').addEventListener('click', () => {
    state.settings.onboarded = true;
    saveSettings();
    renderHome();
    show('screen-home');
  });
}

// ============== Settings screen ==============
function initSettingsScreen() {
  document.getElementById('open-settings').addEventListener('click', () => {
    renderSettings();
    show('screen-settings');
  });
  document.getElementById('close-settings').addEventListener('click', () => {
    renderHome();
    show('screen-home');
  });
  document.querySelectorAll('[data-group="source-settings"] .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.value;
      if (v === state.settings.target) return;
      state.settings.source = v;
      saveSettings();
      loadProgress();
      loadDaily();
      renderSettings();
    });
  });
  document.querySelectorAll('[data-group="target-settings"] .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.value;
      if (v === state.settings.source) return;
      state.settings.target = v;
      saveSettings();
      loadProgress();
      loadDaily();
      renderSettings();
    });
  });
  document.querySelectorAll('[data-group="script"] .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.sr_script = btn.dataset.value;
      saveSettings();
      renderSettings();
    });
  });
  document.querySelectorAll('[data-group="goal"] .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.dailyGoal = parseInt(btn.dataset.value, 10);
      saveSettings();
      renderSettings();
    });
  });
  document.querySelectorAll('[data-group="mixed"] .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.mixedMode = btn.dataset.value === 'on';
      saveSettings();
      renderSettings();
    });
  });
  document.querySelectorAll('[data-group="direction"] .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.direction = btn.dataset.value;
      saveSettings();
      renderSettings();
    });
  });
  document.getElementById('reset-progress').addEventListener('click', () => {
    if (confirm('Reset all progress for this language pair? This cannot be undone.')) {
      state.progress = {};
      state.daily = { date: todayStr(), done: 0 };
      saveProgress();
      saveDaily();
      renderSettings();
    }
  });
  document.getElementById('show-how').addEventListener('click', () => {
    show('screen-onboarding');
  });
}

function renderSettings() {
  document.querySelectorAll('[data-group="source-settings"] .choice').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.value === state.settings.source);
  });
  document.querySelectorAll('[data-group="target-settings"] .choice').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.value === state.settings.target);
  });
  document.querySelectorAll('[data-group="script"] .choice').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.value === state.settings.sr_script);
  });
  document.querySelectorAll('[data-group="goal"] .choice').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.value, 10) === state.settings.dailyGoal);
  });
  document.querySelectorAll('[data-group="mixed"] .choice').forEach(btn => {
    const isOn = state.settings.mixedMode !== false; // default true
    btn.classList.toggle('selected', (btn.dataset.value === 'on') === isOn);
  });
  const currentDir = state.settings.direction || 'both';
  document.querySelectorAll('[data-group="direction"] .choice').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.value === currentDir);
  });
  document.getElementById('setting-script').style.display =
    state.settings.target === 'sr' ? 'flex' : 'none';
}

// ============== Init ==============
async function init() {
  try {
    const resp = await fetch('data/words.json');
    if (!resp.ok) throw new Error('fetch failed');
    const data = await resp.json();
    state.words = data.words;
    state.themes = data.themes;
  } catch (err) {
    err; // fall through to error UI below
  }
  // Sentences are optional — if it fails, the app still works without cameos.
  try {
    const sResp = await fetch('data/sentences.json');
    if (sResp.ok) {
      const sData = await sResp.json();
      state.sentences = sData.sentences || [];
    }
  } catch (e) { /* sentences are non-essential */ }

  if (!state.words || state.words.length === 0) {
    document.body.innerHTML =
      '<div style="padding:24px;max-width:480px;margin:0 auto;font-family:sans-serif">' +
      '<h2>Could not load word data</h2>' +
      '<p>If you opened this file directly (file://), most browsers block local fetch. ' +
      'Run a small local server instead:</p>' +
      '<pre style="background:#eee;padding:12px;border-radius:6px">python3 -m http.server 8000</pre>' +
      '<p>Then visit <a href="http://localhost:8000">http://localhost:8000</a>.</p></div>';
    return;
  }

  state.settings = loadSettings();
  initOnboarding();
  if (!state.settings) {
    initSetup();
    show('screen-setup');
  } else {
    loadProgress();
    loadDaily();
    if (!state.settings.onboarded) {
      show('screen-onboarding');
    } else {
      renderHome();
      show('screen-home');
    }
  }
  initSettingsScreen();

  document.getElementById('start-study').addEventListener('click', () => startSession(null));
  document.getElementById('reveal-btn').addEventListener('click', reveal);
  document.getElementById('skip-known-btn').addEventListener('click', skipKnown);
  document.getElementById('type-submit').addEventListener('click', submitTypeAnswer);
  document.getElementById('type-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitTypeAnswer();
  });
  document.getElementById('type-dontknow').addEventListener('click', typeDontKnow);
  document.querySelectorAll('.choice-option').forEach(btn => {
    btn.addEventListener('click', () => submitChoice(parseInt(btn.dataset.idx, 10)));
  });
  document.querySelectorAll('.grade-btn').forEach(btn => {
    btn.addEventListener('click', () => gradeAndAdvance(btn.dataset.grade));
  });
  document.getElementById('study-back').addEventListener('click', () => {
    state.session = null;
    renderHome();
    show('screen-home');
  });
  document.getElementById('done-back').addEventListener('click', () => {
    renderHome();
    show('screen-home');
  });
  document.getElementById('done-again').addEventListener('click', () => {
    startSession(state._lastSessionTheme || null);
  });
  document.getElementById('stat-mastered').addEventListener('click', openMasteredList);
  document.getElementById('close-mastered').addEventListener('click', () => {
    renderHome();
    show('screen-home');
  });
  document.getElementById('daily-goal-card').addEventListener('click', () => {
    renderSettings();
    show('screen-settings');
  });
  document.getElementById('match-back').addEventListener('click', () => {
    state.session = null;
    renderHome();
    show('screen-home');
  });
  document.getElementById('match-skip').addEventListener('click', skipMatchRound);
  document.getElementById('sentence-show-btn').addEventListener('click', revealSentenceTranslation);
  document.getElementById('sentence-got-it').addEventListener('click', finishSentenceCameo);
  document.getElementById('sentence-back').addEventListener('click', () => {
    state.session = null;
    renderHome();
    show('screen-home');
  });

  // Initialize TTS voices
  if ('speechSynthesis' in window) {
    refreshVoices();
    speechSynthesis.onvoiceschanged = refreshVoices;
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

init();
