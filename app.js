// ============== Constants ==============
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Bump together with the service worker cache version on each release.
// When WHATSNEW_TEXT is non-null, users who haven't seen this version get a
// one-time banner on the home screen.
const APP_VERSION = 51;
const WHATSNEW_TEXT = 'New: conversations and missions! Tap the 💬 card to see what you can already say.';
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
  dialogues: [],
  missions: [],
  settings: null,
  progress: {},
  daily: { date: '', done: 0 },
  session: null,
  voices: new Set(),
  // Last ~40 word IDs shown across recent sessions, used to deprioritize
  // recently-seen cards when building the next lesson queue so the same
  // handful doesn't cycle back too quickly between sessions.
  recentSeen: [],
};

// How many word IDs to remember across sessions for spacing.
const RECENT_SEEN_LIMIT = 40;

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

function speak(text, lang, options) {
  const effective = resolvedSpeakLang(lang);
  if (!effective || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = VOICE_LANG[effective] || effective;
  const v = pickVoice(effective);
  if (v) u.voice = v;
  u.rate = (options && options.rate) || 0.85;
  speechSynthesis.speak(u);
}

// Attach tap-to-play / long-press-to-play-slow behavior to an audio button.
// Replaces the typical onclick handler.
function attachAudioHandler(btn, text, lang) {
  if (!btn) return;
  let pressTimer = null;
  let firedSlow = false;
  const cleanup = () => { clearTimeout(pressTimer); pressTimer = null; };
  btn.onpointerdown = (e) => {
    e.stopPropagation();
    firedSlow = false;
    cleanup();
    pressTimer = setTimeout(() => {
      firedSlow = true;
      speak(text, lang, { rate: 0.45 });
    }, 480);
  };
  btn.onpointerup = (e) => {
    e.stopPropagation();
    cleanup();
    if (!firedSlow) speak(text, lang);
  };
  btn.onpointerleave = cleanup;
  btn.onpointercancel = cleanup;
  btn.onclick = (e) => { e.stopPropagation(); }; // suppress duplicate click
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

// Standalone modal — used when we want to ask for a mnemonic on a word that
// isn't currently the visible card (e.g. after the user has moved on from a
// repeatedly-failed word). Resolves when the modal closes either way.
function openMnemonicModal(word) {
  const modal = document.getElementById('mnemonic-modal');
  if (!modal) return;
  const wordEl = document.getElementById('mnemonic-modal-word');
  const input = document.getElementById('mnemonic-modal-input');
  const tgt = state.settings.target;
  const src = state.settings.source;
  // Show both the target form and the translation so the user remembers
  // exactly which word they're hooking.
  wordEl.textContent = `${getDisplayWord(word, tgt)}  ·  ${word[src]}`;
  if (tgt === 'ar') wordEl.setAttribute('dir', 'rtl');
  else wordEl.removeAttribute('dir');
  input.value = getMnemonic(word.id);
  modal.classList.remove('hidden');
  setTimeout(() => input.focus(), 80);

  const close = () => {
    modal.classList.add('hidden');
    document.getElementById('mnemonic-modal-save').onclick = null;
    document.getElementById('mnemonic-modal-skip').onclick = null;
  };
  document.getElementById('mnemonic-modal-save').onclick = () => {
    saveMnemonic(word.id, input.value);
    close();
    showToast('Saved. That hook is yours forever.', 2200);
  };
  document.getElementById('mnemonic-modal-skip').onclick = close;
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

// ============== Yesterday-vs-today mastered diff (Q2) ==============
function recordMasteredSnapshot(currentMastered) {
  const today = todayStr();
  const key = storageKey(`mastered-snap:${pairKey()}`);
  let snaps = {};
  try { snaps = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
  snaps[today] = currentMastered;
  // Keep last 30 days — gives the progress sparkline a real curve to draw.
  const dates = Object.keys(snaps).sort();
  if (dates.length > 30) {
    const trimmed = {};
    for (const d of dates.slice(-30)) trimmed[d] = snaps[d];
    snaps = trimmed;
  }
  localStorage.setItem(key, JSON.stringify(snaps));
  return snaps;
}

function getYesterdayDiffText(currentMastered) {
  const snaps = recordMasteredSnapshot(currentMastered);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = dateStr(yesterday);
  if (!(yKey in snaps)) return { text: '', positive: false };
  const yCount = snaps[yKey];
  const diff = currentMastered - yCount;
  if (diff > 0) return { text: `+${diff} mastered since yesterday`, positive: true };
  if (diff === 0) return { text: 'Same as yesterday — keep at it', positive: false };
  return { text: '', positive: false }; // negative shouldn't happen
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
  // 'both' direction only makes sense with mixed mode on.
  if (state.settings.mixedMode === false) return 'forward';
  // Weight reverse probability by how well the card is known.
  const label = cardLabel(cardState);
  let reverseProb;
  if (label === 'new') reverseProb = 0;
  else if (label === 'learning') reverseProb = 0.10;
  else if (label === 'young') reverseProb = 0.30;
  else reverseProb = 0.50;
  return Math.random() < reverseProb ? 'reverse' : 'forward';
}

function pickCardMode(direction, cardState) {
  if (direction === 'reverse') {
    // Recall direction needs active production — reveal mode is just peeking.
    if (canTypeInTarget()) {
      const modes = ['type', 'choice'];
      return modes[Math.floor(Math.random() * modes.length)];
    }
    return 'choice';
  }
  // Forward direction (target → source).
  if (!state.settings || state.settings.mixedMode === false) return 'reveal';
  const modes = ['reveal', 'type', 'choice'];
  // Listening mode is forward-only, needs audio, AND should only appear once
  // the user has seen the word at least once — otherwise it's an audio
  // ambush of a word they've never encountered.
  const seenBefore = cardState && cardState.reps > 0;
  if (seenBefore && canSpeak(state.settings.target)) modes.push('listen');
  return modes[Math.floor(Math.random() * modes.length)];
}

// Words/phrases that should be accepted as equivalent. First entry in each group
// is the "canonical" form; other variants get rewritten to it before comparison.
const EQUIVALENT_GROUPS = [
  // Synonyms
  ['thank you', 'thanks'],
  ['ok', 'okay'],
  ['yes', 'yeah', 'yep'],
  ['mom', 'mother', 'mum', 'mama'],
  ['dad', 'father', 'papa'],
  // Common spelling variants (US / UK)
  ['gray', 'grey'],
  ['color', 'colour'],
  ['favor', 'favour'],
  ['neighbor', 'neighbour'],
  // Contractions
  ['cannot', "can't", 'can not'],
  ['do not', "don't"],
  ['does not', "doesn't"],
  ['did not', "didn't"],
  ['is not', "isn't"],
  ['are not', "aren't"],
  ['was not', "wasn't"],
  ['were not', "weren't"],
  ['will not', "won't"],
  ['would not', "wouldn't"],
  ['should not', "shouldn't"],
  ['have not', "haven't"],
  ['has not', "hasn't"],
  ['had not', "hadn't"],
  ['you are', "you're"],
  ['i am', "i'm"],
  ['it is', "it's"],
  ['that is', "that's"],
  ['there is', "there's"],
  ['he is', "he's"],
  ['she is', "she's"],
  ['we are', "we're"],
  ['they are', "they're"],
  ['who is', "who's"],
  ['what is', "what's"],
  ['where is', "where's"],
  ['how is', "how's"],
  ['let us', "let's"],
  ['i will', "i'll"],
  ['you will', "you'll"],
  ['he will', "he'll"],
  ['she will', "she'll"],
  ['we will', "we'll"],
  ['they will', "they'll"],
  ['i have', "i've"],
  ['you have', "you've"],
  ['we have', "we've"],
  ['they have', "they've"],
  ['i would', "i'd"],
  ['you would', "you'd"],
];

function canonicalizeText(text) {
  let result = text;
  for (const group of EQUIVALENT_GROUPS) {
    const canonical = group[0];
    for (let i = 1; i < group.length; i++) {
      const variant = group[i];
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
      result = result.replace(regex, canonical);
    }
  }
  return result;
}

function normalizeAnswer(str) {
  // Canonicalize equivalents BEFORE stripping punctuation so contractions
  // like "you're" can be rewritten to "you are" while the apostrophe is intact.
  let result = canonicalizeText(str.toLowerCase().trim());
  return result
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
  const distractorPairs = []; // {text, wordId}
  const taken = new Set([correct]);
  for (const w of sameTheme) {
    if (distractorPairs.length >= 3) break;
    if (!taken.has(w[ansLang])) {
      distractorPairs.push({ text: w[ansLang], wordId: w.id });
      taken.add(w[ansLang]);
    }
  }
  if (distractorPairs.length < 3) {
    shuffle(candidates);
    for (const w of candidates) {
      if (distractorPairs.length >= 3) break;
      if (!taken.has(w[ansLang])) {
        distractorPairs.push({ text: w[ansLang], wordId: w.id });
        taken.add(w[ansLang]);
      }
    }
  }
  // Map every option text → word id (correct option maps to the prompt word itself).
  const all = [{ text: correct, wordId: word.id }, ...distractorPairs];
  shuffle(all);
  const options = all.map(p => p.text);
  const optionWordIds = all.map(p => p.wordId);
  return { options, optionWordIds, correct };
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
  loadRecentSeen();
}
function saveRecentSeen() {
  localStorage.setItem(storageKey(`recent:${pairKey()}`), JSON.stringify(state.recentSeen));
}
function loadRecentSeen() {
  const raw = localStorage.getItem(storageKey(`recent:${pairKey()}`));
  state.recentSeen = raw ? JSON.parse(raw) : [];
}
function noteSeen(wordId) {
  // Drop any earlier occurrence, push to the end, trim to limit.
  const idx = state.recentSeen.indexOf(wordId);
  if (idx !== -1) state.recentSeen.splice(idx, 1);
  state.recentSeen.push(wordId);
  while (state.recentSeen.length > RECENT_SEEN_LIMIT) state.recentSeen.shift();
  saveRecentSeen();
}

// ============== Confusion pairs ==============
// Tracks {correctId, wrongId} mix-ups. After 2+ repeats of the same pair,
// the next session surfaces a one-time side-by-side compare card.
function confusionKey(idA, idB) {
  // Order-insensitive: which word was correct vs. wrong doesn't matter for
  // deciding they're confusable — we want to know they're a tricky pair.
  return idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
}
function loadConfusions() {
  const raw = localStorage.getItem(storageKey(`confusions:${pairKey()}`));
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
function saveConfusions(data) {
  localStorage.setItem(storageKey(`confusions:${pairKey()}`), JSON.stringify(data));
}
function recordConfusion(correctId, wrongId) {
  if (!correctId || !wrongId || correctId === wrongId) return;
  const data = loadConfusions();
  const k = confusionKey(correctId, wrongId);
  if (!data[k]) data[k] = { count: 0, surfaced: false };
  data[k].count += 1;
  saveConfusions(data);
}
function pickConfusionPair() {
  // Return a {idA, idB} pair whose count is >= 2 and which we haven't already
  // surfaced. Picks the highest-count one first.
  const data = loadConfusions();
  let best = null;
  for (const k of Object.keys(data)) {
    const entry = data[k];
    if (entry.surfaced) continue;
    if (entry.count < 2) continue;
    if (!best || entry.count > best.count) {
      const [idA, idB] = k.split('::');
      best = { idA, idB, count: entry.count, key: k };
    }
  }
  if (!best) return null;
  // Only surface if both words still exist in our dataset (and have target translations).
  const tgt = state.settings.target;
  const wA = state.words.find(w => w.id === best.idA);
  const wB = state.words.find(w => w.id === best.idB);
  if (!wA || !wB || !wA[tgt] || !wB[tgt]) return null;
  return { wA, wB, key: best.key };
}
function markConfusionSurfaced(key) {
  const data = loadConfusions();
  if (data[key]) {
    data[key].surfaced = true;
    saveConfusions(data);
  }
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
    // Defer by 25 minutes so a failed card doesn't keep popping up across
    // back-to-back lessons — gives the brain a real break before retry.
    card.due = now + 25 * 60 * 1000;
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
function buildQueue(themeFilter, options) {
  const reviewOnly = !!(options && options.reviewOnly);
  const now = Date.now();
  const tgt = state.settings.target;
  const due = [];
  const fresh = [];
  for (const w of state.words) {
    if (!w[tgt]) continue; // skip words without target-language translation
    if (themeFilter && w.theme !== themeFilter) continue;
    const s = state.progress[w.id];
    if (!s || s.reps === 0) {
      if (!reviewOnly) fresh.push(w);
    } else if (s.due <= now) {
      due.push(w);
    }
  }
  fresh.sort((a, b) => a.order - b.order);
  shuffle(due);
  // Pull from a wide frequency pool so the order isn't strictly deterministic
  // and you don't see the same handful cycle. Wider pool = bigger gap between
  // re-encounters of any given word across consecutive sessions.
  const FRESH_POOL = 150;
  const SESSION_NEW_CAP = 30;

  // Deprioritize words that appeared in recent sessions: anything in
  // state.recentSeen is shoved to the back of the candidate list so we
  // first burn through cards the user hasn't seen lately.
  const recent = new Set(state.recentSeen || []);
  const splitByRecent = (arr) => {
    const unseen = [];
    const seenRecently = [];
    for (const w of arr) {
      if (recent.has(w.id)) seenRecently.push(w);
      else unseen.push(w);
    }
    return [unseen, seenRecently];
  };

  const [freshUnseen, freshRecent] = splitByRecent(fresh);
  shuffle(freshUnseen);
  shuffle(freshRecent);
  const freshOrdered = themeFilter
    ? [...freshUnseen, ...freshRecent]
    : [...freshUnseen, ...freshRecent].slice(0, FRESH_POOL);
  const newCap = themeFilter ? fresh.length : Math.min(freshOrdered.length, SESSION_NEW_CAP);
  // For non-theme runs we already pulled an unseen-first slice; take the head.
  const newSlice = freshOrdered.slice(0, newCap);

  const [dueUnseen, dueRecent] = splitByRecent(due);
  shuffle(dueUnseen);
  shuffle(dueRecent);
  const dueOrdered = [...dueUnseen, ...dueRecent];

  // Shuffle the combined queue so due and new aren't separated into blocks,
  // but the unseen-first ordering above already gave us good spacing.
  const combined = [...dueOrdered, ...newSlice];
  shuffle(combined);
  return combined;
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

  // Yesterday-vs-today diff.
  const yEl = document.getElementById('yesterday-diff');
  const diffInfo = getYesterdayDiffText(stats.mature);
  yEl.textContent = diffInfo.text;
  yEl.classList.toggle('positive', !!diffInfo.positive);

  // Study-now button shows the actual lesson length you're committing to.
  const studyBtn = document.getElementById('start-study');
  const queueSize = buildQueue(null).length;
  const lessonTarget = (state.settings && state.settings.lessonLength) || 15;
  const lessonSize = Math.min(queueSize, lessonTarget);
  if (lessonSize === 0) {
    studyBtn.textContent = 'Nothing due — but you can try anyway';
  } else {
    studyBtn.textContent = `Study now · ${lessonSize} cards`;
  }

  // Review-due button: only show when there are actually due cards to review.
  const reviewBtn = document.getElementById('start-review');
  if (reviewBtn) {
    const dueCount = buildQueue(null, { reviewOnly: true }).length;
    if (dueCount > 0) {
      reviewBtn.textContent = `Review due · ${dueCount}`;
      reviewBtn.classList.remove('hidden');
    } else {
      reviewBtn.classList.add('hidden');
    }
  }

  // "You can already say" card.
  renderSayCard();

  // One-time what's-new banner after updates.
  maybeShowWhatsNew();

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
      state._wordOfDay = null;
      return;
    }
    pick = candidates[Math.floor(Math.random() * candidates.length)];
    localStorage.setItem(key, JSON.stringify({ date: today, wordId: pick.id }));
  }
  state._wordOfDay = pick;
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
    attachAudioHandler(wodAudio, pick[tgt], tgt);
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

  // CRITICAL: clear any stale per-card UI from the previous card before we
  // start setting things up. The check-feedback ("✗ Answer: X") and the
  // correct/wrong classes on choice buttons used to leak onto the next card.
  const feedbackEl = document.getElementById('check-feedback');
  if (feedbackEl) {
    feedbackEl.textContent = '';
    feedbackEl.classList.add('hidden');
    feedbackEl.classList.remove('correct', 'wrong');
  }
  document.querySelectorAll('.choice-option').forEach(btn => {
    btn.classList.remove('correct', 'wrong');
    btn.disabled = false;
  });
  // Also auto-dismiss any non-actionable toast lingering from the previous
  // card so it doesn't sit on top of the new card's buttons. Actionable
  // toasts (with onclick) stay — those are user-initiated prompts.
  const toastEl = document.getElementById('toast');
  if (toastEl && !toastEl.onclick) {
    toastEl.classList.remove('visible', 'actionable');
  }

  // Note indicator — shows a small 📝 if user has written a mnemonic for this word.
  const noteIndicator = document.getElementById('card-note-indicator');
  if (noteIndicator) {
    if (getMnemonic(word.id)) noteIndicator.classList.remove('hidden');
    else noteIndicator.classList.add('hidden');
  }

  // Prompt
  const promptEl = document.getElementById('card-prompt');
  promptEl.textContent = getDisplayWord(word, promptLang);
  if (promptLang === 'ar') promptEl.setAttribute('dir', 'rtl');
  else promptEl.removeAttribute('dir');

  // Meta (translit / alt script — shown only if prompt is target language with extras).
  // Honors the "Show transliteration" setting for ar/th.
  const metaEl = document.getElementById('card-meta');
  const translitOn = state.settings && state.settings.showTranslit !== false;
  if (promptLang === 'ar' && word.ar_translit && translitOn) {
    metaEl.textContent = word.ar_translit;
  } else if (promptLang === 'th' && word.th_translit && translitOn) {
    metaEl.textContent = word.th_translit;
  } else if (promptLang === 'sr') {
    metaEl.textContent = state.settings.sr_script === 'cyrillic' ? word.sr : word.sr_cyr;
  } else {
    metaEl.textContent = '';
  }

  // Audio button on prompt — show if the prompt language has TTS.
  // Tap to play, long-press for slow playback.
  const audioBtn = document.getElementById('audio-btn');
  const audioHint = document.getElementById('audio-hint');
  if (canSpeak(promptLang)) {
    audioBtn.classList.remove('hidden');
    if (audioHint) audioHint.classList.remove('hidden');
    attachAudioHandler(audioBtn, word[promptLang], promptLang);
  } else {
    audioBtn.classList.add('hidden');
    if (audioHint) audioHint.classList.add('hidden');
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

  const previewRow = document.getElementById('preview-row');
  // Tighter spacing/styling for the preview card so it fits on small screens.
  const cardEl = document.getElementById('card-area');
  if (cardEl) cardEl.classList.toggle('preview-mode', mode === 'preview');

  if (showAnswer) {
    // Hide all input UIs.
    revealRow.classList.add('hidden');
    typeRow.classList.add('hidden');
    dontknowRow.classList.add('hidden');
    choiceRow.classList.add('hidden');
    skipBtn.classList.add('hidden');
    skipHint.classList.add('hidden');
    // In preview mode the user gets a single "Got it, next" button — no
    // grading, no fast-track. Brand-new words shouldn't ask for confidence
    // judgments at all.
    if (mode === 'preview') {
      gradeRow.classList.add('hidden');
      if (previewRow) previewRow.classList.remove('hidden');
      skipBtn.classList.add('hidden');
      skipHint.classList.add('hidden');
    } else {
      gradeRow.classList.remove('hidden');
      if (previewRow) previewRow.classList.add('hidden');
    }
    const lp = document.getElementById('listen-prompt');
    if (lp) lp.classList.add('hidden');
    // Restore visibility of prompt area in case listen mode hid them.
    promptEl.style.display = '';
    metaEl.style.display = '';
    if (audioBtn) audioBtn.style.display = '';
    const _ah = document.getElementById('audio-hint');
    if (_ah) _ah.style.display = '';

    answerEl.classList.remove('hidden');
    answerMain.textContent = getDisplayWord(word, answerLang);
    if (answerLang === 'ar') answerMain.setAttribute('dir', 'rtl');
    else answerMain.removeAttribute('dir');

    // Translit / alt script on answer (when target is the answer in recall direction).
    // Honors the showTranslit setting.
    let ansTranslitText = '';
    if (answerLang === 'ar' && word.ar_translit && translitOn) ansTranslitText = word.ar_translit;
    else if (answerLang === 'th' && word.th_translit && translitOn) ansTranslitText = word.th_translit;
    else if (answerLang === 'sr') ansTranslitText = state.settings.sr_script === 'cyrillic' ? word.sr : word.sr_cyr;
    answerTranslit.textContent = ansTranslitText;

    // Audio on the answer — show if answer language has TTS and isn't already on prompt side.
    if (canSpeak(answerLang) && answerLang !== promptLang) {
      answerAudioBtn.classList.remove('hidden');
      attachAudioHandler(answerAudioBtn, word[answerLang], answerLang);
    } else {
      answerAudioBtn.classList.add('hidden');
    }

    emojiEl.textContent = word.emoji || '';
    if (word.emoji) {
      emojiEl.classList.remove('pop');
      void emojiEl.offsetWidth;
      emojiEl.classList.add('pop');
    }

    // Example — always shows source + target. SKIPPED in preview mode to keep
    // the first-look card short enough to fit on any phone.
    if (mode !== 'preview' && word.example && word.example[src] && word.example[tgt]) {
      exampleEl.classList.remove('hidden');
      exampleSrcEl.textContent = word.example[src];
      const tgtExample = (tgt === 'sr')
        ? (state.settings.sr_script === 'cyrillic' ? word.example.sr_cyr : word.example.sr)
        : word.example[tgt];
      exampleTgtEl.textContent = tgtExample || '';
      if (tgt === 'ar') exampleTgtEl.setAttribute('dir', 'rtl');
      else exampleTgtEl.removeAttribute('dir');
      let translitText = '';
      if (translitOn) {
        if (tgt === 'ar' && word.example.ar_translit) translitText = word.example.ar_translit;
        else if (tgt === 'th' && word.example.th_translit) translitText = word.example.th_translit;
      }
      exampleTransEl.textContent = translitText;

      const exAudioBtn = document.getElementById('example-audio-btn');
      if (canSpeak(tgt) && word.example[tgt]) {
        exAudioBtn.classList.remove('hidden');
        attachAudioHandler(exAudioBtn, word.example[tgt], tgt);
      } else {
        exAudioBtn.classList.add('hidden');
      }
    } else {
      exampleEl.classList.add('hidden');
    }

    // Mnemonic note (skipped in preview — keeps the first-look card focused).
    if (mode !== 'preview') {
      renderMnemonic(word.id);
    }
    return;
  }

  // ----- Prompt phase -----
  answerEl.classList.add('hidden');
  exampleEl.classList.add('hidden');
  gradeRow.classList.add('hidden');
  if (previewRow) previewRow.classList.add('hidden');
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
  const listenPrompt = document.getElementById('listen-prompt');
  if (listenPrompt) listenPrompt.classList.add('hidden');

  dontknowRow.classList.add('hidden');

  // Show or hide the visual prompt depending on whether listen mode hides it.
  const promptVisible = mode !== 'listen';
  promptEl.style.display = promptVisible ? '' : 'none';
  metaEl.style.display = promptVisible ? '' : 'none';
  if (audioBtn) audioBtn.style.display = promptVisible ? '' : 'none';
  const _audioHint2 = document.getElementById('audio-hint');
  if (_audioHint2) _audioHint2.style.display = promptVisible ? '' : 'none';

  if (mode === 'reveal') {
    revealRow.classList.remove('hidden');
  } else if (mode === 'listen') {
    listenPrompt.classList.remove('hidden');
    choiceRow.classList.remove('hidden');
    const ch = state.session.currentChoices;
    document.querySelectorAll('.choice-option').forEach((btn, i) => {
      btn.textContent = ch.options[i] || '';
      btn.classList.remove('correct', 'wrong');
      btn.disabled = false;
      btn.removeAttribute('dir'); // listen mode answer is always source (no RTL)
    });
    const playBtn = document.getElementById('listen-play-btn');
    attachAudioHandler(playBtn, word[tgt], tgt);
    // Auto-play after a beat — but only for words the user has seen before.
    // First-time encounters get the play button only (no audio ambush);
    // they have to tap to hear it.
    if (cardState && cardState.reps > 0) {
      setTimeout(() => speak(word[tgt], tgt), 250);
    }
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
    // Log the confusion pair so we can surface a side-by-side compare later.
    const wrongWordId = ch.optionWordIds && ch.optionWordIds[idx];
    if (wrongWordId && wrongWordId !== w.id) {
      recordConfusion(w.id, wrongWordId);
    }
  }

  // Show full answer screen and auto-grade.
  setTimeout(() => {
    if (state.session && state.session.queue[state.session.index] === w) {
      renderCard(w, true);
      scheduleAutoGrade(isCorrect ? 'good' : 'again');
    }
  }, 600);
}

// Brief reminder of the failed word's translation — no anchor, no extra noise.
// Just so the answer lingers a moment after the card has moved on.
function buildHintForFail(word) {
  if (!state.settings) return null;
  const src = state.settings.source;
  const tgt = state.settings.target;
  if (!word[tgt] || !word[src]) return null;
  return `${word[tgt]} = ${word[src]}`;
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
  // Generous windows so users have time to override the auto-grade by tapping
  // a different button before it fires.
  const delay = grade === 'again' ? 3500 : 2500;
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
function showToast(message, ms = 3200, onTap) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
  el.classList.toggle('actionable', !!onTap);
  clearTimeout(el._timer);
  // Reset previous handler regardless.
  el.onclick = null;
  if (onTap) {
    el.onclick = () => {
      el.classList.remove('visible', 'actionable');
      el.onclick = null;
      clearTimeout(el._timer);
      onTap();
    };
  }
  el._timer = setTimeout(() => {
    el.classList.remove('visible', 'actionable');
    el.onclick = null;
  }, ms);
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

function startSession(themeFilter, wordsOverride, options) {
  const opts = options || {};
  let queue;
  if (wordsOverride && wordsOverride.length > 0) {
    queue = [...wordsOverride];
  } else {
    queue = buildQueue(themeFilter, { reviewOnly: !!opts.reviewOnly });

    // Daily warm-up: first lesson of the day gets up to 2 mastered cards
    // prepended for momentum and confidence. Skip warm-up in review-only mode
    // since the whole point of that mode is "no new noise".
    if (!opts.reviewOnly && state.daily && state.daily.done === 0 && !state.daily.warmupGiven) {
      const tgt = state.settings.target;
      const inQueue = new Set(queue.map(w => w.id));
      const mature = state.words.filter(w =>
        w[tgt] &&
        cardLabel(state.progress[w.id]) === 'mature' &&
        !inQueue.has(w.id)
      );
      shuffle(mature);
      const warmup = mature.slice(0, 2);
      if (warmup.length > 0) {
        queue = [...warmup, ...queue];
        state.daily.warmupGiven = true;
        saveDaily();
      }
    }
  }
  if (queue.length === 0) {
    if (opts.reviewOnly) {
      showToast("Nothing due to review right now. Try Study now instead.");
    } else {
      showToast("You're caught up. New cards unlock as you finish today's goal.");
    }
    return;
  }
  const freshIds = new Set();
  const dueIds = new Set();
  for (const w of queue) {
    const s = state.progress[w.id];
    if (!s || s.reps === 0) freshIds.add(w.id);
    else dueIds.add(w.id);
  }
  const baseTarget = (state.settings && state.settings.lessonLength) || 15;
  const lessonTarget = opts.lessonSize || baseTarget;
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
    previewedIds: new Set(),
    nextMatchAt: 5 + Math.floor(Math.random() * 3), // first match at 5, 6, or 7
    nextSentenceAt: 7 + Math.floor(Math.random() * 4), // first sentence at 7..10
    matchRound: null,
    sentenceCameo: null,
    clusterPending: null,
    confusionPending: null,
    dialoguePlayed: false,
    shownSentenceIds: new Set(),
    lessonTarget,
    lessonSize: Math.min(queue.length, lessonTarget),
    // Snapshot for the lesson-end "you unlocked N new things" callout.
    _sayableBefore: countSayables(),
  };
  // Single-word "study this" sessions (e.g. from word-of-day) skip matching and
  // sentence rounds — they're meant to be quick focused practice.
  if (wordsOverride) {
    state.session.nextMatchAt = 1e9;
    state.session.nextSentenceAt = 1e9;
    state.session.lessonTarget = wordsOverride.length;
    state.session.lessonSize = wordsOverride.length;
  }

  // Plan a cluster intro: once a day, if there are 3+ unseen new cards in the
  // queue from the same theme, group them as a "word family" intro. Skips
  // theme-filtered lessons (already same theme) and short/override sessions.
  if (!themeFilter && !wordsOverride && !opts.reviewOnly &&
      !state.daily.clusterShown && state.session.lessonSize >= 10) {
    const cluster = planClusterIntro(queue);
    if (cluster) {
      state.session.clusterPending = cluster;
    }
  }

  // Plan a confusion compare: if there's an unsurfaced pair the user has
  // mixed up 2+ times, show the side-by-side card once at the start of the
  // session. Skipped in tiny sessions to keep them snappy.
  if (!wordsOverride && state.session.lessonSize >= 8) {
    const conf = pickConfusionPair();
    if (conf) state.session.confusionPending = conf;
  }

  show('screen-study');
  renderCurrent();
}

// Look for a "word family" — 3 unseen new cards in the queue sharing a theme.
// Returns the 3 words (or null if no such cluster exists).
function planClusterIntro(queue) {
  const byTheme = {};
  for (const w of queue) {
    const s = state.progress[w.id];
    if (s && s.reps > 0) continue; // only group genuinely new words
    if (!w.theme) continue;
    (byTheme[w.theme] = byTheme[w.theme] || []).push(w);
  }
  // Prefer themes with the most new cards (so we surface meaty clusters first).
  const candidates = Object.keys(byTheme)
    .filter(t => byTheme[t].length >= 3)
    .sort((a, b) => byTheme[b].length - byTheme[a].length);
  if (candidates.length === 0) return null;
  const theme = candidates[0];
  return { theme, words: byTheme[theme].slice(0, 3) };
}

function renderCurrent() {
  if (!state.session) { finishSession(); return; }

  // Show or hide the "undo last grade" button.
  // Visible for 5 seconds after a grade, on the very next card only.
  refreshUndoButton();

  // End the lesson at the size we promised on the Study now button.
  // (Uses lessonSize, not lessonTarget — they differ when the queue was smaller
  // than the user's setting, and we never want to exceed what's displayed.)
  if (state.session.answered >= state.session.lessonSize) {
    finishSession();
    return;
  }

  if (state.session.index >= state.session.queue.length) {
    finishSession();
    return;
  }

  // Cluster intro: shown once at the start of a session, before any cards.
  if (state.session.clusterPending && state.session.answered === 0) {
    startClusterIntro();
    return;
  }
  // Confusion compare: also at the start, after cluster (if any).
  if (state.session.confusionPending && state.session.answered === 0) {
    startConfusionCompare();
    return;
  }
  // Dialogue cameo: once per session, a short conversation made entirely of
  // words the user knows. Shares the sentence-cameo schedule slot.
  if (shouldTriggerDialogueCameo()) {
    startDialogueCameo();
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

  // Pick direction (forward = target→source; reverse = source→target) and mode.
  // A word gets the calm no-quiz preview only on its genuine first sight this
  // session (never seen before AND not yet previewed in this session). After
  // the preview it's re-queued as a real quiz, so the lesson stays varied
  // even when every word is brand new (e.g. a fresh language pair).
  const cardStateForDir = state.progress[w.id];
  const neverSeen = !cardStateForDir || cardStateForDir.reps === 0;
  const isFirstEncounter = neverSeen && !state.session.previewedIds.has(w.id);
  if (isFirstEncounter) {
    state.session.cardDirection = 'forward';
    state.session.cardMode = 'preview';
  } else {
    state.session.cardDirection = pickDirection(cardStateForDir);
    state.session.cardMode = pickCardMode(state.session.cardDirection, cardStateForDir);
  }

  // Progress pill — counts every screen (preview or quiz) toward the lesson
  // tally so "15 cards" stays honest. Preview screens add a small tag so the
  // user knows it's a no-pressure first look.
  const progressEl = document.getElementById('study-progress');
  const cardIndex = Math.min(state.session.answered + 1, state.session.lessonSize);
  if (state.session.cardMode === 'preview') {
    progressEl.textContent = `✨ New · ${cardIndex} / ${state.session.lessonSize}`;
  } else {
    progressEl.textContent = `${cardIndex} / ${state.session.lessonSize}`;
  }

  // Remember this word for cross-session spacing (so next lesson tries to
  // pick fresh-er candidates first). Done once per card appearance.
  noteSeen(w.id);
  // 'listen' mode reuses choice options (4 source-lang buttons), so generate them.
  if (state.session.cardMode === 'choice' || state.session.cardMode === 'listen') {
    state.session.currentChoices = pickChoiceOptions(w, state.session.cardDirection);
  }

  // Preview mode shows the answer immediately; other modes hide it until reveal.
  renderCard(w, state.session.cardMode === 'preview');

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
  // Split into [before, after] around the first match, keeping the case-true word.
  const parts = sourceText.split(regex);
  return {
    before: parts[0],
    after: parts.slice(1).join(sourceWord), // rejoin in case word appears multiple times
    expected: sourceWord,
    full: sourceText,
  };
}

// Check if a sentence can be reordered: needs at least 3 space-separated
// tokens (no good for Thai data without spaces) and not too many (frustrating).
function canReorderSentence(sentence, tgtLang) {
  const text = sentence[tgtLang];
  if (!text) return null;
  const trimmed = text.replace(/[.,!?؟،]+$/u, '').trim();
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 3) return null;
  if (tokens.length > 6) return null;
  return tokens;
}

function makeClozeSource(sentence, srcLang) {
  // Only consider content words (nouns, verbs, adjectives, etc.). Pronouns,
  // possessives, prepositions, and very short words are too predictable in
  // cloze form — sentence structure gives them away.
  const SKIP_THEMES = new Set(['pronouns', 'possessives', 'prepositions']);
  const candidates = [];
  for (const wid of sentence.uses) {
    const word = state.words.find(w => w.id === wid);
    if (!word) continue;
    const src = word[srcLang];
    if (!src) continue;
    if (SKIP_THEMES.has(word.theme)) continue;
    if (src.length < 4) continue;
    candidates.push(wid);
  }
  shuffle(candidates);
  for (const wid of candidates) {
    const cloze = tryClozeForWord(sentence, wid, srcLang);
    if (cloze) return cloze;
  }
  // No good cloze available — the cameo will play as plain reveal instead.
  return null;
}

function renderSentenceCameo() {
  const s = state.session.sentenceCameo;
  if (!s) return;
  const tgt = state.settings.target;
  const src = state.settings.source;

  // Decide interaction: reorder if we can split target into tokens; else cloze; else plain reveal.
  const reorderTokens = canReorderSentence(s, tgt);
  // Probabilistic mix: prefer reorder ~50% of the time when available.
  if (reorderTokens && Math.random() < 0.55) {
    state.session._cameoMode = 'reorder';
    renderSentenceReorder(s, reorderTokens);
    return;
  }
  state.session._cameoMode = 'cloze';

  // Show cloze-mode elements; hide reorder elements.
  document.getElementById('sentence-target').classList.remove('hidden');
  document.getElementById('sentence-translit').classList.remove('hidden');
  document.getElementById('sentence-glossary').classList.remove('hidden');
  document.getElementById('reorder-source-prompt').classList.add('hidden');
  document.getElementById('reorder-build').classList.add('hidden');
  document.getElementById('reorder-pool').classList.add('hidden');
  document.getElementById('reorder-submit-row').classList.add('hidden');

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
  sourceEl.dataset.expected = '';

  if (cloze) {
    // Render the source with an actual text input where the blank should be.
    sourceEl.classList.add('cloze');
    sourceEl.innerHTML = '';
    sourceEl.appendChild(document.createTextNode(cloze.before));
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'sentence-cloze-input';
    input.className = 'sentence-input';
    input.autocomplete = 'off';
    input.autocorrect = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Fill in the missing word');
    // Size the field to roughly match the expected word length (plus padding).
    input.style.width = `${Math.max(4, cloze.expected.length + 2)}ch`;
    input.style.minWidth = '4ch';
    input.style.maxWidth = '14ch';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') revealSentenceTranslation();
    });
    sourceEl.appendChild(input);
    sourceEl.appendChild(document.createTextNode(cloze.after));
    sourceEl.dataset.expected = cloze.expected;
    sourceWrap.classList.remove('hidden');
    setTimeout(() => input.focus(), 80);
  } else {
    // Fallback: traditional reveal (no clozable word found).
    sourceEl.textContent = '';
    sourceEl.classList.remove('cloze');
    sourceWrap.classList.add('hidden');
  }
  document.getElementById('sentence-reveal-row').classList.remove('hidden');
  document.getElementById('sentence-done-row').classList.add('hidden');
  // Reset feedback label.
  const fbEl = document.getElementById('sentence-feedback');
  if (fbEl) { fbEl.textContent = ''; fbEl.className = 'sentence-feedback'; }

  // Audio button.
  const audioBtn = document.getElementById('sentence-audio-btn');
  if (canSpeak(tgt)) {
    audioBtn.classList.remove('hidden');
    attachAudioHandler(audioBtn, s[tgt], tgt);
  } else {
    audioBtn.classList.add('hidden');
  }

  // Glossary chips — tap any to see its translation in a toast.
  const glossary = document.getElementById('sentence-glossary');
  glossary.innerHTML = '';
  for (const wid of s.uses) {
    const word = state.words.find(w => w.id === wid);
    if (!word || !word[tgt] || !word[src]) continue;
    const chip = document.createElement('button');
    chip.className = 'glossary-chip';
    chip.textContent = getDisplayWord(word, tgt);
    if (tgt === 'ar') chip.setAttribute('dir', 'rtl');
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      showToast(`${word[tgt]}  →  ${word[src]}`, 2200);
    });
    glossary.appendChild(chip);
  }
}

function renderSentenceReorder(s, tokens) {
  const tgt = state.settings.target;
  const src = state.settings.source;

  // Hide cloze-mode elements.
  document.getElementById('sentence-target').classList.add('hidden');
  document.getElementById('sentence-translit').classList.add('hidden');
  document.getElementById('sentence-source-wrap').classList.add('hidden');
  document.getElementById('sentence-glossary').classList.add('hidden');
  document.getElementById('sentence-reveal-row').classList.add('hidden');
  document.getElementById('sentence-done-row').classList.add('hidden');

  // Show reorder elements.
  const sourcePrompt = document.getElementById('reorder-source-prompt');
  const buildArea = document.getElementById('reorder-build');
  const poolArea = document.getElementById('reorder-pool');
  sourcePrompt.classList.remove('hidden');
  buildArea.classList.remove('hidden');
  poolArea.classList.remove('hidden');
  document.getElementById('reorder-submit-row').classList.remove('hidden');

  sourcePrompt.textContent = s[src] || '';

  // RTL build flow for Arabic so words read right-to-left.
  if (tgt === 'ar') buildArea.setAttribute('dir', 'rtl');
  else buildArea.removeAttribute('dir');

  // Initialize state: pool is shuffled indices, build is empty.
  const indices = tokens.map((_, i) => i);
  const shuffled = [...indices];
  shuffle(shuffled);
  state.session._reorderState = {
    tokens,
    pool: shuffled,
    build: [],
  };
  renderReorderChips();

  // Audio button for the sentence.
  const audioBtn = document.getElementById('sentence-audio-btn');
  if (canSpeak(tgt)) {
    audioBtn.classList.remove('hidden');
    attachAudioHandler(audioBtn, s[tgt], tgt);
  } else {
    audioBtn.classList.add('hidden');
  }

  // Reset submit button.
  const submitBtn = document.getElementById('reorder-submit-btn');
  submitBtn.disabled = false;
  submitBtn.textContent = 'Check';
  submitBtn.onclick = submitReorder;
}

function renderReorderChips() {
  const r = state.session._reorderState;
  if (!r) return;
  const tgt = state.settings.target;
  const buildArea = document.getElementById('reorder-build');
  const poolArea = document.getElementById('reorder-pool');

  buildArea.innerHTML = '';
  poolArea.innerHTML = '';

  if (r.build.length === 0) {
    const ph = document.createElement('span');
    ph.className = 'reorder-placeholder';
    ph.textContent = 'Tap words below to build the sentence';
    buildArea.appendChild(ph);
  } else {
    for (const idx of r.build) {
      const chip = makeReorderChip(idx, 'build');
      buildArea.appendChild(chip);
    }
  }
  for (const idx of r.pool) {
    const chip = makeReorderChip(idx, 'pool');
    poolArea.appendChild(chip);
  }
}

function makeReorderChip(tokenIdx, area) {
  const r = state.session._reorderState;
  const tgt = state.settings.target;
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'reorder-chip' + (area === 'build' ? ' placed' : '');
  chip.textContent = r.tokens[tokenIdx];
  chip.dataset.idx = String(tokenIdx);
  if (tgt === 'ar') chip.setAttribute('dir', 'rtl');
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (area === 'pool') moveChipToBuild(tokenIdx);
    else moveChipToPool(tokenIdx);
  });
  return chip;
}

function moveChipToBuild(tokenIdx) {
  const r = state.session._reorderState;
  const i = r.pool.indexOf(tokenIdx);
  if (i < 0) return;
  r.pool.splice(i, 1);
  r.build.push(tokenIdx);
  renderReorderChips();
}

function moveChipToPool(tokenIdx) {
  const r = state.session._reorderState;
  const i = r.build.indexOf(tokenIdx);
  if (i < 0) return;
  r.build.splice(i, 1);
  r.pool.push(tokenIdx);
  renderReorderChips();
}

function submitReorder() {
  const r = state.session._reorderState;
  if (!r) return;
  if (r.build.length === 0) return;
  const correct = r.build.every((idx, i) => idx === i);
  const submitBtn = document.getElementById('reorder-submit-btn');

  // Highlight chips in build area
  const buildArea = document.getElementById('reorder-build');
  buildArea.querySelectorAll('.reorder-chip').forEach((chip, i) => {
    chip.disabled = true;
    if (parseInt(chip.dataset.idx, 10) === i) chip.classList.add('correct');
    else chip.classList.add('wrong');
  });

  if (correct) {
    showToast('✓ Correct! Nice assembly.', 2500);
  } else {
    // Show the correct order as toast
    showToast(`Correct order: ${r.tokens.join(' ')}`, 3500);
  }

  // Switch submit button to "Continue" → triggers finishSentenceCameo
  submitBtn.textContent = 'Continue';
  submitBtn.disabled = false;
  submitBtn.onclick = () => finishSentenceCameo();
}

function revealSentenceTranslation() {
  if (!state.session || !state.session.sentenceCameo) return;
  const sourceWrap = document.getElementById('sentence-source-wrap');
  const sourceEl = document.getElementById('sentence-source');
  const expected = sourceEl.dataset.expected || '';
  const input = document.getElementById('sentence-cloze-input');
  const fbEl = document.getElementById('sentence-feedback');

  // If we have a cloze with input, evaluate before revealing.
  if (input && expected) {
    const userAns = input.value;
    if (userAns.trim()) {
      const result = checkTypedAnswer(userAns, expected);
      if (fbEl) {
        if (result === 'exact') {
          fbEl.textContent = '✓ Correct!';
          fbEl.className = 'sentence-feedback correct';
        } else if (result === 'close') {
          fbEl.textContent = `✓ Close — "${expected}"`;
          fbEl.className = 'sentence-feedback correct';
        } else {
          fbEl.textContent = `✗ It was "${expected}"`;
          fbEl.className = 'sentence-feedback wrong';
        }
      }
    } else if (fbEl) {
      fbEl.textContent = `The missing word was "${expected}"`;
      fbEl.className = 'sentence-feedback muted';
    }
  }

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

// Preview "Got it" — the user has just met a brand-new word. We DON'T grade
// it (a first look isn't a recall test). Instead we mark it previewed and
// re-queue it a few cards ahead so it comes back as a real quiz this session.
// That keeps lessons varied even when every word is new.
function previewGotIt() {
  if (!state.session || state.session._busy) return;
  // A preview isn't gradeable, so clear any pending undo from a prior card.
  state.session._lastGrade = null;
  const w = state.session.queue[state.session.index];
  state.session.previewedIds.add(w.id);
  // Re-insert 2–4 cards ahead for an immediate first test.
  const offset = 2 + Math.floor(Math.random() * 3);
  const insertAt = Math.min(state.session.index + offset, state.session.queue.length);
  state.session.queue.splice(insertAt, 0, w);

  // Advance without grading (a first look isn't a recall test), but DO count
  // the screen toward the lesson tally so lessons stay the promised length.
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

// ============== Cluster intro (word family) ==============
function startClusterIntro() {
  const cluster = state.session.clusterPending;
  if (!cluster) return;
  const tgt = state.settings.target;
  const src = state.settings.source;
  document.getElementById('cluster-title').textContent = humanTheme(cluster.theme);
  const list = document.getElementById('cluster-list');
  list.innerHTML = '';
  for (const w of cluster.words) {
    const row = document.createElement('div');
    row.className = 'cluster-row';

    const emoji = document.createElement('div');
    emoji.className = 'cluster-emoji';
    emoji.textContent = w.emoji || '·';
    row.appendChild(emoji);

    const text = document.createElement('div');
    text.className = 'cluster-text';
    const tgtEl = document.createElement('div');
    tgtEl.className = 'cluster-target';
    tgtEl.textContent = getDisplayWord(w, tgt);
    if (tgt === 'ar') tgtEl.setAttribute('dir', 'rtl');
    text.appendChild(tgtEl);
    const translitOn = state.settings && state.settings.showTranslit !== false;
    let translitText = '';
    if (translitOn) {
      if (tgt === 'ar' && w.ar_translit) translitText = w.ar_translit;
      else if (tgt === 'th' && w.th_translit) translitText = w.th_translit;
    }
    if (translitText) {
      const trEl = document.createElement('div');
      trEl.className = 'cluster-translit';
      trEl.textContent = translitText;
      text.appendChild(trEl);
    }
    const srcEl = document.createElement('div');
    srcEl.className = 'cluster-source';
    srcEl.textContent = w[src];
    text.appendChild(srcEl);
    row.appendChild(text);

    if (canSpeak(tgt)) {
      const audioBtn = document.createElement('button');
      audioBtn.className = 'cluster-audio-btn';
      audioBtn.setAttribute('aria-label', 'Hear pronunciation');
      audioBtn.textContent = '🔊';
      attachAudioHandler(audioBtn, w[tgt], tgt);
      row.appendChild(audioBtn);
    }

    list.appendChild(row);
  }
  show('screen-cluster');
}

// ============== Confusion compare ==============
function startConfusionCompare() {
  const conf = state.session.confusionPending;
  if (!conf) return;
  const { wA, wB } = conf;
  const tgt = state.settings.target;
  const src = state.settings.source;
  const translitOn = state.settings && state.settings.showTranslit !== false;

  const fill = (suffix, w) => {
    document.getElementById(`confusion-emoji-${suffix}`).textContent = w.emoji || '·';
    const tgtEl = document.getElementById(`confusion-target-${suffix}`);
    tgtEl.textContent = getDisplayWord(w, tgt);
    if (tgt === 'ar') tgtEl.setAttribute('dir', 'rtl');
    else tgtEl.removeAttribute('dir');
    let translit = '';
    if (translitOn) {
      if (tgt === 'ar' && w.ar_translit) translit = w.ar_translit;
      else if (tgt === 'th' && w.th_translit) translit = w.th_translit;
    }
    document.getElementById(`confusion-translit-${suffix}`).textContent = translit;
    document.getElementById(`confusion-source-${suffix}`).textContent = w[src];
    const audioBtn = document.getElementById(`confusion-audio-${suffix}`);
    if (canSpeak(tgt)) {
      audioBtn.classList.remove('hidden');
      attachAudioHandler(audioBtn, w[tgt], tgt);
    } else {
      audioBtn.classList.add('hidden');
    }
  };
  fill('a', wA);
  fill('b', wB);
  show('screen-confusion');
}

function finishConfusionCompare() {
  if (!state.session || !state.session.confusionPending) return;
  markConfusionSurfaced(state.session.confusionPending.key);
  state.session.confusionPending = null;
  show('screen-study');
  renderCurrent();
}

function finishClusterIntro() {
  if (!state.session || !state.session.clusterPending) return;
  const cluster = state.session.clusterPending;
  // Silently bump these 3 cards out of "new" state so they no longer trigger
  // the individual preview screens when they come up in the lesson. They'll
  // appear as normal cards (reveal/type/choice) with the cluster fresh in mind.
  for (const w of cluster.words) {
    let card = state.progress[w.id];
    if (!card) { card = defaultCardState(); state.progress[w.id] = card; }
    if (card.reps === 0) {
      card.reps = 1;
      card.interval = MS_PER_DAY;
      card.due = Date.now() + card.interval;
      // freshIds tracking: the card was new in the queue, so countedIds will
      // still see it as "new learned" when the user actually grades it.
    }
  }
  saveProgress();
  state.session.clusterPending = null;
  state.daily.clusterShown = true;
  saveDaily();
  show('screen-study');
  renderCurrent();
}

// ============== Undo last grade ==============
// Shows the undo button if there's a recent grade to reverse, hides otherwise.
// Auto-hides after 5 seconds — meant for accidental taps, not real reconsideration.
function refreshUndoButton() {
  const btn = document.getElementById('undo-grade');
  if (!btn) return;
  clearTimeout(state.session && state.session._undoHideTimer);
  const last = state.session && state.session._lastGrade;
  if (!last) {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  state.session._undoHideTimer = setTimeout(() => {
    // After 5s the snapshot expires — no more silent undo.
    if (state.session) state.session._lastGrade = null;
    btn.classList.add('hidden');
  }, 5000);
}

function undoLastGrade() {
  if (!state.session || !state.session._lastGrade) return;
  if (state.session._busy) return;
  const snap = state.session._lastGrade;
  state.session._lastGrade = null;

  // Restore the per-card SRS state.
  if (snap.cardBefore) {
    state.progress[snap.wordId] = snap.cardBefore;
  } else {
    delete state.progress[snap.wordId];
  }
  // Roll back daily counter (only if the grade was counted in the first place).
  if (snap.wasCounted && !snap.recountedAfterUndo) {
    state.daily.done = snap.dailyDoneBefore;
    state.session.countedIds.delete(snap.wordId);
    saveDaily();
  }
  // Roll back session bookkeeping.
  state.session.againCounts[snap.wordId] = snap.againCountBefore;
  if (snap.againCountBefore === 0) delete state.session.againCounts[snap.wordId];
  // Recently-seen had the word appended in advance() — pop if the last entry
  // matches (it almost always will since this is the card we just left).
  const rs = state.session.recentlySeen;
  if (rs.length && rs[rs.length - 1] === snap.wordId) rs.pop();
  // Cross-session recently-seen.
  state.recentSeen = snap.recentSeenBefore;
  saveRecentSeen();

  // Wind back position counters and re-show the same card.
  state.session.index = snap.index;
  state.session.answered = Math.max(0, state.session.answered - 1);
  saveProgress();

  // Hide undo button immediately.
  const btn = document.getElementById('undo-grade');
  if (btn) btn.classList.add('hidden');

  renderCurrent();
}

function gradeAndAdvance(grade) {
  if (!state.session || state.session._busy) return;
  // If an auto-grade was scheduled (from type/choice modes), cancel it —
  // either we're firing the auto-grade now, or the user beat it with a manual tap.
  clearTimeout(state.session._autoTimer);
  state.session._busy = true;

  const w = state.session.queue[state.session.index];
  const hadCardBefore = !!state.progress[w.id];
  let card = state.progress[w.id];
  if (!card) { card = defaultCardState(); state.progress[w.id] = card; }
  // Snapshot for undo — store everything we're about to mutate so we can
  // reverse it cleanly if the user mis-tapped.
  state.session._lastGrade = {
    wordId: w.id,
    grade,
    index: state.session.index,
    cardBefore: hadCardBefore ? { ...card } : null,
    dailyDoneBefore: state.daily.done,
    wasCounted: state.session.countedIds.has(w.id),
    againCountBefore: state.session.againCounts[w.id] || 0,
    recentSeenBefore: [...state.recentSeen],
  };
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

  // Track within-session streaks and struggle runs for ambient encouragement.
  if (grade === 'again') {
    state.session._streak = 0;
    state.session._consecutiveAgain = (state.session._consecutiveAgain || 0) + 1;
    if (state.session._consecutiveAgain === 3) {
      showToast('Tough sequence. Take a breath.', 2500);
    }
  } else {
    state.session._consecutiveAgain = 0;
    state.session._streak = (state.session._streak || 0) + 1;
    if (state.session._streak === 5 && !state.session._streakCelebrated) {
      state.session._streakCelebrated = true;
      showToast('On a roll. 🔥', 2200);
    }
  }

  if (grade === 'again') {
    state.session.againCounts[w.id] = (state.session.againCounts[w.id] || 0) + 1;
    // Lifetime "again" counter, persisted with the card. Used to surface
    // the mnemonic prompt after repeated fails.
    card.lifetimeAgains = (card.lifetimeAgains || 0) + 1;
    saveProgress();
    // If the user has now failed this word 3+ times across all sessions and
    // hasn't written a memory hook yet, prompt them. Done once per word
    // (mnemonicPromptShown flag) so we don't nag.
    const ALREADY_PROMPTED = !!card.mnemonicPromptShown;
    const HAS_MNEMONIC = !!getMnemonic(w.id);
    if (card.lifetimeAgains >= 3 && !ALREADY_PROMPTED && !HAS_MNEMONIC) {
      card.mnemonicPromptShown = true;
      saveProgress();
      // Use the actionable toast so the user can opt in without interruption.
      const labelTgt = getDisplayWord(w, state.settings.target);
      showToast(
        `"${labelTgt}" keeps slipping. Tap to add a memory hook.`,
        5500,
        () => openMnemonicModal(w)
      );
    }
    // Note: previously we surfaced a "X = Y" hint toast on every fail.
    // Removed — it overlapped the next card's buttons and added noise
    // without much value. The answer is already shown on the auto-graded
    // card before transitioning away.
    // No within-session re-queue. The card's SRS due (25 min from now)
    // brings it back in a later lesson, with fresh perspective.
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
  let sayableBefore = null;
  if (state.session) {
    lastTheme = state.session.filterTheme;
    sayableBefore = state.session._sayableBefore;
    for (const id of state.session.countedIds) {
      if (state.session.freshIds.has(id)) newLearned++;
      else revisited++;
    }
    for (const id of Object.keys(state.session.againCounts || {})) {
      const c = state.session.againCounts[id];
      if (c > trickyCount) { trickyCount = c; trickyId = id; }
    }
  }

  state._lastSessionTheme = lastTheme;
  state.session = null;

  // Unlock callout: did this session make new sentences/dialogues/missions sayable?
  const unlockedEl = document.getElementById('lesson-modal-unlocked');
  if (unlockedEl) {
    const sayableAfter = countSayables();
    const gained = (typeof sayableBefore === 'number') ? sayableAfter - sayableBefore : 0;
    if (gained > 0) {
      document.getElementById('lesson-modal-unlocked-text').textContent =
        gained === 1
          ? 'You unlocked 1 new thing you can say'
          : `You unlocked ${gained} new things you can say`;
      unlockedEl.classList.remove('hidden');
    } else {
      unlockedEl.classList.add('hidden');
    }
  }

  // "Try a mission" button: surface an unlocked, not-yet-completed mission at
  // the natural what-now moment.
  const missionBtn = document.getElementById('lesson-modal-mission');
  if (missionBtn) {
    const completions = getMissionCompletions();
    const fresh = unlockedMissions().filter(m => !completions[m.id]);
    if (fresh.length > 0) {
      const m = fresh[0];
      const src2 = state.settings.source;
      missionBtn.textContent = `🎯 Try a mission: ${m.title[src2] || m.title.en}`;
      missionBtn.classList.remove('hidden');
      state._pendingMission = m;
    } else {
      missionBtn.classList.add('hidden');
      state._pendingMission = null;
    }
  }

  // Populate the modal popup (overlay — appears on top of whatever screen is current).
  const DONE_EMOJIS = ['🎉', '🌱', '🏁', '✨', '🍵', '🎯', '🏆', '☕', '🌅', '💪', '🪴', '📚'];
  const emojiEl = document.getElementById('lesson-modal-emoji');
  emojiEl.textContent = DONE_EMOJIS[Math.floor(Math.random() * DONE_EMOJIS.length)];
  emojiEl.style.animation = 'none';
  void emojiEl.offsetWidth;
  emojiEl.style.animation = '';

  document.getElementById('lesson-modal-quip').textContent = pickPhrase(PHRASES.sessionEnd, 'sessionEnd');

  // Stats grid in modal.
  const statsEl = document.getElementById('lesson-modal-stats');
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

  // Trickiest card highlight.
  const trickyEl = document.getElementById('lesson-modal-tricky');
  const trickyWordEl = document.getElementById('lesson-modal-tricky-word');
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

  // Adjust button availability based on whether more cards exist.
  const futureQueue = buildQueue(lastTheme || null);
  const futureGeneral = buildQueue(null);
  const hasMore = futureQueue.length > 0 || futureGeneral.length > 0;
  const titleEl = document.getElementById('lesson-modal-title');
  const againBtn = document.getElementById('lesson-modal-again');
  const cheekyBtn = document.getElementById('lesson-modal-cheeky');
  if (hasMore) {
    titleEl.textContent = 'Lesson complete';
    againBtn.classList.remove('hidden');
    cheekyBtn.classList.remove('hidden');
  } else {
    titleEl.textContent = 'Done for today';
    document.getElementById('lesson-modal-quip').textContent = 'No more cards due. The vocabulary needs a break too.';
    againBtn.classList.add('hidden');
    cheekyBtn.classList.add('hidden');
  }

  // Show the modal overlay. This appears on top of whichever screen is current.
  document.getElementById('lesson-modal').classList.remove('hidden');
}

function closeLessonModal() {
  document.getElementById('lesson-modal').classList.add('hidden');
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

// ============== "You can say" — capability tracking ==============
function isLearnedWord(wid) {
  const s = state.progress[wid];
  return !!s && s.reps > 0;
}

// Sentences fully made of learned words (more generous than the cameo's
// mature-only gate — this list is about motivation, not testing).
function sayableSentences() {
  if (!state.sentences || !state.settings) return [];
  const tgt = state.settings.target;
  const src = state.settings.source;
  return state.sentences.filter(s =>
    s[tgt] && s[src] && s.uses.every(isLearnedWord)
  );
}

function unlockedDialogues() {
  if (!state.dialogues || !state.settings) return [];
  const tgt = state.settings.target;
  const src = state.settings.source;
  return state.dialogues.filter(d =>
    d.lines.every(l => l[tgt] && l[src]) &&
    d.uses.every(isLearnedWord)
  );
}

function unlockedMissions() {
  if (!state.missions || !state.settings) return [];
  const tgt = state.settings.target;
  return state.missions.filter(m =>
    m.steps.every(st => st.text[tgt]) &&
    m.uses.every(isLearnedWord)
  );
}

function countSayables() {
  return sayableSentences().length + unlockedDialogues().length + unlockedMissions().length;
}

// Dialogue/sentence line text honoring the Serbian script setting.
function lineDisplayText(obj, lang) {
  if (lang === 'sr' && state.settings.sr_script === 'cyrillic' && obj.sr_cyr) return obj.sr_cyr;
  return obj[lang];
}
function lineTranslit(obj, lang) {
  if (lang === 'ar') return obj.ar_translit || '';
  if (lang === 'th') return obj.th_translit || '';
  return '';
}

function getMissionCompletions() {
  try {
    return JSON.parse(localStorage.getItem(storageKey(`missions-done:${pairKey()}`)) || '{}');
  } catch (e) { return {}; }
}
function markMissionComplete(missionId) {
  const done = getMissionCompletions();
  done[missionId] = (done[missionId] || 0) + 1;
  localStorage.setItem(storageKey(`missions-done:${pairKey()}`), JSON.stringify(done));
}

// One-time "what's new" banner after an app update.
function maybeShowWhatsNew() {
  const banner = document.getElementById('whatsnew-banner');
  if (!banner) return;
  if (!WHATSNEW_TEXT) { banner.classList.add('hidden'); return; }
  const seen = parseInt(localStorage.getItem(storageKey('seenVersion')) || '0', 10);
  if (seen >= APP_VERSION) { banner.classList.add('hidden'); return; }
  document.getElementById('whatsnew-text').textContent = WHATSNEW_TEXT;
  banner.classList.remove('hidden');
}
function dismissWhatsNew() {
  localStorage.setItem(storageKey('seenVersion'), String(APP_VERSION));
  const banner = document.getElementById('whatsnew-banner');
  if (banner) banner.classList.add('hidden');
}

// Fewest words still missing for ANY locked sentence/dialogue/mission —
// powers the "your first sentence unlocks in N more words" teaser.
function nearestUnlockDistance() {
  const tgt = state.settings.target;
  const src = state.settings.source;
  let best = null;
  const consider = (uses, available) => {
    if (!available) return;
    const missing = uses.filter(u => !isLearnedWord(u)).length;
    if (missing > 0 && (best === null || missing < best)) best = missing;
  };
  for (const s of state.sentences) consider(s.uses, s[tgt] && s[src]);
  for (const d of state.dialogues) consider(d.uses, d.lines.every(l => l[tgt] && l[src]));
  for (const m of state.missions) consider(m.uses, m.steps.every(st => st.text[tgt]));
  return best;
}

function renderSayCard() {
  const card = document.getElementById('say-card');
  if (!card) return;
  const s = sayableSentences().length;
  const d = unlockedDialogues().length;
  const m = unlockedMissions().length;
  if (s + d + m === 0) {
    // Locked state: keep the card visible so the payoff is in view from
    // lesson one — that's the motivation engine, don't hide it.
    const dist = nearestUnlockDistance();
    if (dist === null) {
      card.classList.add('hidden'); // no data for this pair at all
      return;
    }
    document.getElementById('say-card-sub').textContent =
      `Your first sentence unlocks in ${dist} more word${dist === 1 ? '' : 's'}`;
    card.classList.add('locked');
    card.classList.remove('hidden');
    return;
  }
  card.classList.remove('locked');
  const parts = [];
  if (s) parts.push(`${s} sentence${s === 1 ? '' : 's'}`);
  if (d) parts.push(`${d} conversation${d === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} mission${m === 1 ? '' : 's'}`);
  document.getElementById('say-card-sub').textContent = parts.join(' · ');
  card.classList.remove('hidden');
}

// Build one row for the say screen. opts: {emoji, title, sub, trailing, locked, missing, onClick}
function makeSayItem(opts) {
  const item = document.createElement('button');
  item.className = 'say-item' + (opts.locked ? ' locked' : '');
  if (opts.locked) item.disabled = true;
  if (opts.emoji) {
    const emoji = document.createElement('span');
    emoji.className = 'si-emoji';
    emoji.textContent = opts.emoji;
    item.appendChild(emoji);
  }
  const text = document.createElement('div');
  text.className = 'si-text';
  const title = document.createElement('div');
  title.className = 'si-target';
  title.textContent = opts.title;
  text.appendChild(title);
  if (opts.sub) {
    const sub = document.createElement('div');
    sub.className = 'si-source';
    sub.textContent = opts.sub;
    text.appendChild(sub);
  }
  item.appendChild(text);
  if (opts.locked) {
    const lock = document.createElement('span');
    lock.className = 'si-lock';
    lock.textContent = `🔒 ${opts.missing} more word${opts.missing === 1 ? '' : 's'}`;
    item.appendChild(lock);
  } else if (opts.trailing) {
    const tr = document.createElement('span');
    tr.className = opts.trailing.cls;
    tr.textContent = opts.trailing.text;
    item.appendChild(tr);
  }
  if (opts.onClick && !opts.locked) item.addEventListener('click', opts.onClick);
  return item;
}

function missingWordCount(uses) {
  return uses.filter(u => !isLearnedWord(u)).length;
}

function openSayScreen() {
  const tgt = state.settings.target;
  const src = state.settings.source;

  // Missions — unlocked first, then up to 3 nearest locked ones as teasers.
  const missions = unlockedMissions();
  const mSection = document.getElementById('say-missions-section');
  const mList = document.getElementById('say-missions-list');
  mList.innerHTML = '';
  const completions = getMissionCompletions();
  for (const m of missions) {
    mList.appendChild(makeSayItem({
      emoji: m.emoji,
      title: m.title[src] || m.title.en,
      sub: m.intro[src] || m.intro.en,
      trailing: completions[m.id] ? { cls: 'si-done', text: '✓' } : null,
      onClick: () => openMission(m),
    }));
  }
  const lockedMissions = state.missions
    .filter(m => m.steps.every(st => st.text[tgt]) && !missions.includes(m))
    .map(m => ({ m, missing: missingWordCount(m.uses) }))
    .sort((a, b) => a.missing - b.missing)
    .slice(0, 3);
  for (const { m, missing } of lockedMissions) {
    mList.appendChild(makeSayItem({
      emoji: m.emoji,
      title: m.title[src] || m.title.en,
      locked: true,
      missing,
    }));
  }
  mSection.classList.toggle('hidden', missions.length + lockedMissions.length === 0);

  // Dialogues — same pattern.
  const dialogues = unlockedDialogues();
  const dSection = document.getElementById('say-dialogues-section');
  const dList = document.getElementById('say-dialogues-list');
  dList.innerHTML = '';
  for (const d of dialogues) {
    dList.appendChild(makeSayItem({
      emoji: d.emoji,
      title: d.title[src] || d.title.en,
      sub: `${d.lines.length} lines`,
      trailing: { cls: 'si-play', text: '▶' },
      onClick: () => openDialogue(d, 'say'),
    }));
  }
  const lockedDialogues = state.dialogues
    .filter(d => d.lines.every(l => l[tgt] && l[src]) && !dialogues.includes(d))
    .map(d => ({ d, missing: missingWordCount(d.uses) }))
    .sort((a, b) => a.missing - b.missing)
    .slice(0, 3);
  for (const { d, missing } of lockedDialogues) {
    dList.appendChild(makeSayItem({
      emoji: d.emoji,
      title: d.title[src] || d.title.en,
      locked: true,
      missing,
    }));
  }
  dSection.classList.toggle('hidden', dialogues.length + lockedDialogues.length === 0);

  // Sentences
  const sentences = sayableSentences();
  const sSection = document.getElementById('say-sentences-section');
  const sList = document.getElementById('say-sentences-list');
  sList.innerHTML = '';
  if (sentences.length > 0) {
    for (const s of sentences) {
      const item = document.createElement('button');
      item.className = 'say-item';
      const text = document.createElement('div');
      text.className = 'si-text';
      const targetEl = document.createElement('div');
      targetEl.className = 'si-target';
      targetEl.textContent = lineDisplayText(s, tgt);
      if (tgt === 'ar') targetEl.setAttribute('dir', 'rtl');
      text.appendChild(targetEl);
      const translitOn = state.settings.showTranslit !== false;
      const tr = translitOn ? lineTranslit(s, tgt) : '';
      if (tr) {
        const trEl = document.createElement('div');
        trEl.className = 'si-translit';
        trEl.textContent = tr;
        text.appendChild(trEl);
      }
      const srcEl = document.createElement('div');
      srcEl.className = 'si-source';
      srcEl.textContent = s[src];
      text.appendChild(srcEl);
      item.appendChild(text);
      if (canSpeak(tgt)) {
        const play = document.createElement('span');
        play.className = 'si-play';
        play.textContent = '🔊';
        item.appendChild(play);
        item.addEventListener('click', () => speak(s[tgt], tgt));
      }
      sList.appendChild(item);
    }
    sSection.classList.remove('hidden');
  } else {
    sSection.classList.add('hidden');
  }

  // Note for sentences (locked dialogues/missions already show as teasers above).
  const lockedNote = document.getElementById('say-locked-note');
  const lockedSentences = state.sentences.filter(s => s[tgt] && s[src]).length - sentences.length;
  if (lockedSentences > 0) {
    lockedNote.textContent = `${lockedSentences} more sentence${lockedSentences === 1 ? '' : 's'} unlock as you learn new words.`;
    lockedNote.classList.remove('hidden');
  } else {
    lockedNote.classList.add('hidden');
  }
  document.getElementById('say-empty').classList.toggle(
    'hidden',
    sentences.length + dialogues.length + missions.length +
      lockedDialogues.length + lockedMissions.length > 0
  );

  show('screen-say');
}

// ============== Dialogue player ==============
function openDialogue(d, origin) {
  state._dialogue = { d, lineIdx: 0, origin: origin || 'say' };
  const src = state.settings.source;
  document.getElementById('dialogue-title').textContent =
    `${d.emoji} ${d.title[src] || d.title.en}`;
  document.getElementById('dialogue-lines').innerHTML = '';
  const nextBtn = document.getElementById('dialogue-next');
  nextBtn.textContent = 'Next line';
  show('screen-dialogue');
  revealDialogueLine();
}

function revealDialogueLine() {
  const dlg = state._dialogue;
  if (!dlg) return;
  const tgt = state.settings.target;
  const src = state.settings.source;
  const line = dlg.d.lines[dlg.lineIdx];
  const container = document.getElementById('dialogue-lines');

  const bubble = document.createElement('div');
  bubble.className = `dialogue-bubble ${line.speaker === 'A' ? 'a' : 'b'}`;

  const target = document.createElement('div');
  target.className = 'db-target';
  target.textContent = lineDisplayText(line, tgt);
  if (tgt === 'ar') target.setAttribute('dir', 'rtl');
  bubble.appendChild(target);

  const translitOn = state.settings.showTranslit !== false;
  const tr = translitOn ? lineTranslit(line, tgt) : '';
  if (tr) {
    const trEl = document.createElement('div');
    trEl.className = 'db-translit';
    trEl.textContent = tr;
    bubble.appendChild(trEl);
  }

  const source = document.createElement('div');
  source.className = 'db-source hidden';
  source.textContent = line[src];
  bubble.appendChild(source);

  // Tap to toggle translation; replay audio on tap too.
  bubble.addEventListener('click', () => {
    source.classList.toggle('hidden');
    if (canSpeak(tgt)) speak(line[tgt], tgt);
  });

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;

  // Auto audio — every word here is one the user already knows.
  if (canSpeak(tgt)) setTimeout(() => speak(line[tgt], tgt), 250);

  dlg.lineIdx += 1;
  const nextBtn = document.getElementById('dialogue-next');
  nextBtn.textContent = dlg.lineIdx >= dlg.d.lines.length ? 'Done' : 'Next line';
}

function dialogueNext() {
  const dlg = state._dialogue;
  if (!dlg) return;
  if (dlg.lineIdx < dlg.d.lines.length) {
    revealDialogueLine();
  } else {
    closeDialogue();
  }
}

function closeDialogue() {
  const dlg = state._dialogue;
  state._dialogue = null;
  if (dlg && dlg.origin === 'session' && state.session) {
    show('screen-study');
    renderCurrent();
  } else if (dlg && dlg.origin === 'say') {
    openSayScreen();
  } else {
    renderHome();
    show('screen-home');
  }
}

// Lesson cameo: occasionally play an unlocked dialogue instead of a sentence.
function shouldTriggerDialogueCameo() {
  if (!state.session) return false;
  if (state.session.dialoguePlayed) return false;
  if (state.session.sentenceCameo) return false;
  if (state.session.answered < state.session.nextSentenceAt) return false;
  if (unlockedDialogues().length === 0) return false;
  return Math.random() < 0.4;
}

function startDialogueCameo() {
  state.session.nextSentenceAt = state.session.answered + 6 + Math.floor(Math.random() * 5);
  state.session.dialoguePlayed = true;
  const candidates = unlockedDialogues();
  const d = candidates[Math.floor(Math.random() * candidates.length)];
  openDialogue(d, 'session');
}

// ============== Mission player ==============
function missionTokensFor(step, tgt) {
  if (!step.tokens) return null;
  if (tgt === 'sr' && state.settings.sr_script === 'cyrillic' && step.tokens.sr_cyr) {
    return step.tokens.sr_cyr;
  }
  const tokens = step.tokens[tgt];
  return (tokens && tokens.length >= 3) ? tokens : null;
}

function openMission(m) {
  state._mission = { m, stepIdx: 0 };
  const src = state.settings.source;
  document.getElementById('mission-emoji').textContent = m.emoji;
  document.getElementById('mission-title').textContent = m.title[src] || m.title.en;
  document.getElementById('mission-intro-text').textContent = m.intro[src] || m.intro.en;
  document.getElementById('mission-intro').classList.remove('hidden');
  document.getElementById('mission-step').classList.add('hidden');
  document.getElementById('mission-recap').classList.add('hidden');
  show('screen-mission');
}

function startMissionSteps() {
  document.getElementById('mission-intro').classList.add('hidden');
  document.getElementById('mission-step').classList.remove('hidden');
  renderMissionStep();
}

function renderMissionStep() {
  const ms = state._mission;
  if (!ms) return;
  const tgt = state.settings.target;
  const src = state.settings.source;
  const step = ms.m.steps[ms.stepIdx];

  document.getElementById('mission-progress').textContent =
    `Step ${ms.stepIdx + 1} of ${ms.m.steps.length}`;
  document.getElementById('mission-prompt').textContent =
    step.prompt[src] || step.prompt.en;

  const feedback = document.getElementById('mission-feedback');
  feedback.textContent = '';
  feedback.className = 'mission-feedback';

  const buildArea = document.getElementById('mission-build');
  const poolArea = document.getElementById('mission-pool');
  const repeatArea = document.getElementById('mission-repeat');
  const submitBtn = document.getElementById('mission-submit');
  const audioBtn = document.getElementById('mission-audio-btn');

  const fullText = lineDisplayText(step.text, tgt);
  const tokens = missionTokensFor(step, tgt);

  if (canSpeak(tgt)) {
    audioBtn.classList.remove('hidden');
    attachAudioHandler(audioBtn, step.text[tgt], tgt);
  } else {
    audioBtn.classList.add('hidden');
  }

  if (tokens) {
    // Build mode: assemble the sentence from shuffled chips.
    ms.mode = 'build';
    ms.tokens = tokens;
    ms.build = [];
    ms.pool = tokens.map((_, i) => i);
    shuffle(ms.pool);
    repeatArea.classList.add('hidden');
    buildArea.classList.remove('hidden');
    poolArea.classList.remove('hidden');
    if (tgt === 'ar') buildArea.setAttribute('dir', 'rtl');
    else buildArea.removeAttribute('dir');
    renderMissionChips();
    submitBtn.textContent = 'Check';
    submitBtn.onclick = submitMissionStep;
  } else {
    // Repeat mode: short line — show it, hear it, say it out loud.
    ms.mode = 'repeat';
    buildArea.classList.add('hidden');
    poolArea.classList.add('hidden');
    repeatArea.classList.remove('hidden');
    const textEl = document.getElementById('mission-repeat-text');
    textEl.textContent = fullText;
    if (tgt === 'ar') textEl.setAttribute('dir', 'rtl');
    else textEl.removeAttribute('dir');
    const translitOn = state.settings.showTranslit !== false;
    document.getElementById('mission-repeat-translit').textContent =
      translitOn ? lineTranslit(step.text, tgt) : '';
    if (canSpeak(tgt)) setTimeout(() => speak(step.text[tgt], tgt), 300);
    submitBtn.textContent = 'Said it ✓';
    submitBtn.onclick = missionStepDone;
  }
}

function renderMissionChips() {
  const ms = state._mission;
  if (!ms) return;
  const tgt = state.settings.target;
  const buildArea = document.getElementById('mission-build');
  const poolArea = document.getElementById('mission-pool');
  buildArea.innerHTML = '';
  poolArea.innerHTML = '';

  if (ms.build.length === 0) {
    const ph = document.createElement('span');
    ph.className = 'reorder-placeholder';
    ph.textContent = 'Tap words below to build the sentence';
    buildArea.appendChild(ph);
  } else {
    for (const idx of ms.build) {
      buildArea.appendChild(makeMissionChip(idx, 'build'));
    }
  }
  for (const idx of ms.pool) {
    poolArea.appendChild(makeMissionChip(idx, 'pool'));
  }
}

function makeMissionChip(tokenIdx, area) {
  const ms = state._mission;
  const tgt = state.settings.target;
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'reorder-chip' + (area === 'build' ? ' placed' : '');
  chip.textContent = ms.tokens[tokenIdx];
  chip.dataset.idx = String(tokenIdx);
  if (tgt === 'ar') chip.setAttribute('dir', 'rtl');
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    const list = area === 'pool' ? ms.pool : ms.build;
    const other = area === 'pool' ? ms.build : ms.pool;
    const i = list.indexOf(tokenIdx);
    if (i < 0) return;
    list.splice(i, 1);
    other.push(tokenIdx);
    renderMissionChips();
  });
  return chip;
}

function submitMissionStep() {
  const ms = state._mission;
  if (!ms || ms.build.length === 0) return;
  const tgt = state.settings.target;
  const step = ms.m.steps[ms.stepIdx];
  const correct = ms.build.length === ms.tokens.length &&
    ms.build.every((idx, i) => idx === i);

  document.getElementById('mission-build').querySelectorAll('.reorder-chip').forEach((chip, i) => {
    chip.disabled = true;
    if (parseInt(chip.dataset.idx, 10) === i) chip.classList.add('correct');
    else chip.classList.add('wrong');
  });

  const feedback = document.getElementById('mission-feedback');
  if (correct) {
    feedback.textContent = '✓ You just said it!';
    feedback.className = 'mission-feedback correct';
    if (canSpeak(tgt)) setTimeout(() => speak(step.text[tgt], tgt), 300);
  } else {
    feedback.textContent = `It goes: ${ms.tokens.join(' ')}`;
    feedback.className = 'mission-feedback wrong';
  }

  const submitBtn = document.getElementById('mission-submit');
  submitBtn.textContent = 'Continue';
  submitBtn.onclick = missionStepDone;
}

function missionStepDone() {
  const ms = state._mission;
  if (!ms) return;
  if (ms.stepIdx + 1 < ms.m.steps.length) {
    ms.stepIdx += 1;
    renderMissionStep();
  } else {
    renderMissionRecap();
  }
}

function renderMissionRecap() {
  const ms = state._mission;
  if (!ms) return;
  const tgt = state.settings.target;
  markMissionComplete(ms.m.id);

  document.getElementById('mission-step').classList.add('hidden');
  const recapList = document.getElementById('mission-recap-list');
  recapList.innerHTML = '';
  const translitOn = state.settings.showTranslit !== false;
  for (const step of ms.m.steps) {
    const item = document.createElement('button');
    item.className = 'say-item';
    const text = document.createElement('div');
    text.className = 'si-text';
    const targetEl = document.createElement('div');
    targetEl.className = 'si-target';
    targetEl.textContent = lineDisplayText(step.text, tgt);
    if (tgt === 'ar') targetEl.setAttribute('dir', 'rtl');
    text.appendChild(targetEl);
    const tr = translitOn ? lineTranslit(step.text, tgt) : '';
    if (tr) {
      const trEl = document.createElement('div');
      trEl.className = 'si-translit';
      trEl.textContent = tr;
      text.appendChild(trEl);
    }
    item.appendChild(text);
    if (canSpeak(tgt)) {
      const play = document.createElement('span');
      play.className = 'si-play';
      play.textContent = '🔊';
      item.appendChild(play);
      item.addEventListener('click', () => speak(step.text[tgt], tgt));
    }
    recapList.appendChild(item);
  }
  document.getElementById('mission-recap').classList.remove('hidden');
}

function closeMission() {
  state._mission = null;
  openSayScreen();
}

// ============== Pareto coverage estimate ==============
// Zipf approximation: the word at frequency rank r carries weight ~1/r of
// everyday speech. Coverage = share of total weight (top ~5000 words ≈ "all
// of daily conversation") carried by the words you've learned.
function computeCoverage() {
  const H5000 = 9.094; // harmonic number approximation: ln(5000) + 0.5772
  let sum = 0;
  const tgt = state.settings.target;
  for (const w of state.words) {
    if (!w[tgt]) continue;
    if (isLearnedWord(w.id)) sum += 1 / w.order;
  }
  return Math.min(0.99, sum / H5000);
}

function renderCoverage() {
  const pct = Math.round(computeCoverage() * 100);
  document.getElementById('coverage-number').textContent = `~${pct}%`;
  document.getElementById('coverage-bar-fill').style.width = `${pct}%`;
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

// ============== Progress / stats peek screen ==============
function openProgressScreen() {
  renderCoverage();
  renderProgressSparkline();
  renderTopPracticed();
  renderTopStruggled();
  show('screen-progress');
}

function renderProgressSparkline() {
  const svg = document.getElementById('progress-sparkline');
  const emptyMsg = document.getElementById('progress-sparkline-empty');
  const startLabel = document.getElementById('sparkline-start');
  const endLabel = document.getElementById('sparkline-end');
  if (!svg) return;
  svg.innerHTML = '';

  const key = storageKey(`mastered-snap:${pairKey()}`);
  let snaps = {};
  try { snaps = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
  // Make sure today is in there.
  const today = todayStr();
  if (!(today in snaps)) snaps[today] = calcStats().mature;
  const dates = Object.keys(snaps).sort();

  if (dates.length < 2) {
    emptyMsg.classList.remove('hidden');
    startLabel.textContent = '';
    endLabel.textContent = '';
    return;
  }
  emptyMsg.classList.add('hidden');

  const W = 300, H = 80, PAD = 6;
  const values = dates.map(d => snaps[d]);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);

  // Map data points to SVG coords.
  const xStep = (W - PAD * 2) / Math.max(1, dates.length - 1);
  const points = values.map((v, i) => {
    const x = PAD + i * xStep;
    const norm = (v - min) / range;
    const y = H - PAD - norm * (H - PAD * 2);
    return [x, y];
  });

  // Filled area under the curve (subtle gradient feel via fill-opacity).
  const areaPath =
    `M ${PAD} ${H - PAD} ` +
    points.map(p => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') +
    ` L ${(W - PAD).toFixed(1)} ${H - PAD} Z`;
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute('d', areaPath);
  area.setAttribute('fill', '#a8c994');
  area.setAttribute('fill-opacity', '0.25');
  svg.appendChild(area);

  // Line on top.
  const linePath = 'M ' + points.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', linePath);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#527c3e');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);

  // Last-point dot.
  const last = points[points.length - 1];
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', last[0]);
  dot.setAttribute('cy', last[1]);
  dot.setAttribute('r', '3.5');
  dot.setAttribute('fill', '#527c3e');
  svg.appendChild(dot);

  // Axis labels — show the earliest and latest dates with their counts.
  startLabel.textContent = `${formatShortDate(dates[0])} · ${values[0]}`;
  endLabel.textContent = `${formatShortDate(dates[dates.length - 1])} · ${values[values.length - 1]}`;
}

function formatShortDate(yyyymmdd) {
  // yyyy-mm-dd → "May 14"
  const parts = yyyymmdd.split('-');
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderTopPracticed() {
  // Top 5 by reps — what the user has worked on most.
  const list = document.getElementById('top-practiced-list');
  list.innerHTML = '';
  const tgt = state.settings.target;
  const src = state.settings.source;
  const rows = state.words
    .filter(w => w[tgt] && state.progress[w.id] && state.progress[w.id].reps > 0)
    .map(w => ({ w, reps: state.progress[w.id].reps }))
    .sort((a, b) => b.reps - a.reps)
    .slice(0, 5);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'progress-list-empty';
    empty.textContent = 'Nothing practiced yet — finish a few lessons first.';
    list.appendChild(empty);
    return;
  }
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'progress-list-row';
    const left = document.createElement('div');
    const word = document.createElement('span');
    word.className = 'pl-word';
    word.textContent = getDisplayWord(r.w, tgt);
    if (tgt === 'ar') word.setAttribute('dir', 'rtl');
    left.appendChild(word);
    const trans = document.createElement('span');
    trans.className = 'pl-trans';
    trans.textContent = r.w[src];
    left.appendChild(trans);
    row.appendChild(left);
    const count = document.createElement('span');
    count.className = 'pl-count';
    count.textContent = `${r.reps}×`;
    row.appendChild(count);
    list.appendChild(row);
  }
}

function renderTopStruggled() {
  // Top 5 by lifetimeAgains — the words that have tripped the user up most.
  const list = document.getElementById('top-struggled-list');
  list.innerHTML = '';
  const tgt = state.settings.target;
  const src = state.settings.source;
  const rows = state.words
    .filter(w => w[tgt] && state.progress[w.id] && (state.progress[w.id].lifetimeAgains || 0) > 0)
    .map(w => ({ w, agains: state.progress[w.id].lifetimeAgains || 0 }))
    .sort((a, b) => b.agains - a.agains)
    .slice(0, 5);
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'progress-list-empty';
    empty.textContent = 'No tricky words yet. Brag carefully.';
    list.appendChild(empty);
    return;
  }
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'progress-list-row';
    const left = document.createElement('div');
    const word = document.createElement('span');
    word.className = 'pl-word';
    word.textContent = getDisplayWord(r.w, tgt);
    if (tgt === 'ar') word.setAttribute('dir', 'rtl');
    left.appendChild(word);
    const trans = document.createElement('span');
    trans.className = 'pl-trans';
    trans.textContent = r.w[src];
    left.appendChild(trans);
    row.appendChild(left);
    const count = document.createElement('span');
    count.className = 'pl-count';
    count.textContent = `${r.agains} miss${r.agains === 1 ? '' : 'es'}`;
    row.appendChild(count);
    list.appendChild(row);
  }
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
      lessonLength: 15,
      mixedMode: true,
      direction: 'both',
      showTranslit: true,
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
  document.querySelectorAll('[data-group="lesson"] .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.lessonLength = parseInt(btn.dataset.value, 10);
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
  document.querySelectorAll('[data-group="translit"] .choice').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.showTranslit = btn.dataset.value === 'on';
      saveSettings();
      renderSettings();
    });
  });
  document.getElementById('reset-progress').addEventListener('click', () => {
    if (confirm('Reset all progress for this language pair? This cannot be undone.')) {
      state.progress = {};
      state.daily = { date: todayStr(), done: 0 };
      state.recentSeen = [];
      saveProgress();
      saveDaily();
      saveRecentSeen();
      // Wipe per-pair confusion history too.
      localStorage.removeItem(storageKey(`confusions:${pairKey()}`));
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
  const currentLesson = state.settings.lessonLength || 15;
  document.querySelectorAll('[data-group="lesson"] .choice').forEach(btn => {
    btn.classList.toggle('selected', parseInt(btn.dataset.value, 10) === currentLesson);
  });
  document.querySelectorAll('[data-group="mixed"] .choice').forEach(btn => {
    const isOn = state.settings.mixedMode !== false; // default true
    btn.classList.toggle('selected', (btn.dataset.value === 'on') === isOn);
  });
  const currentDir = state.settings.direction || 'both';
  document.querySelectorAll('[data-group="direction"] .choice').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.value === currentDir);
  });
  const translitOn = state.settings.showTranslit !== false;
  document.querySelectorAll('[data-group="translit"] .choice').forEach(btn => {
    btn.classList.toggle('selected', (btn.dataset.value === 'on') === translitOn);
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
  // Dialogues and missions are also optional extras.
  try {
    const dResp = await fetch('data/dialogues.json');
    if (dResp.ok) {
      const dData = await dResp.json();
      state.dialogues = dData.dialogues || [];
    }
  } catch (e) { /* non-essential */ }
  try {
    const mResp = await fetch('data/missions.json');
    if (mResp.ok) {
      const mData = await mResp.json();
      state.missions = mData.missions || [];
    }
  } catch (e) { /* non-essential */ }

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
  document.getElementById('start-stretch').addEventListener('click', () => startSession(null, null, { lessonSize: 5 }));
  document.getElementById('start-review').addEventListener('click', () => startSession(null, null, { reviewOnly: true }));
  document.getElementById('undo-grade').addEventListener('click', undoLastGrade);
  document.getElementById('preview-next').addEventListener('click', previewGotIt);
  document.getElementById('cluster-continue').addEventListener('click', finishClusterIntro);
  document.getElementById('cluster-back').addEventListener('click', () => {
    state.session = null;
    renderHome();
    show('screen-home');
  });
  document.getElementById('confusion-continue').addEventListener('click', finishConfusionCompare);
  document.getElementById('confusion-back').addEventListener('click', () => {
    state.session = null;
    renderHome();
    show('screen-home');
  });
  // "You can say" + dialogue + mission screens.
  document.getElementById('say-card').addEventListener('click', openSayScreen);
  document.getElementById('close-say').addEventListener('click', () => {
    renderHome();
    show('screen-home');
  });
  document.getElementById('dialogue-next').addEventListener('click', dialogueNext);
  document.getElementById('dialogue-back').addEventListener('click', closeDialogue);
  document.getElementById('mission-start').addEventListener('click', startMissionSteps);
  document.getElementById('mission-done').addEventListener('click', closeMission);
  document.getElementById('mission-back').addEventListener('click', closeMission);
  // What's-new banner: tap → mark seen + open the say screen; ✕ just dismisses.
  document.getElementById('whatsnew-banner').addEventListener('click', () => {
    dismissWhatsNew();
    openSayScreen();
  });
  document.getElementById('whatsnew-close').addEventListener('click', (e) => {
    e.stopPropagation();
    dismissWhatsNew();
  });
  // Lesson-end "Try a mission" button.
  document.getElementById('lesson-modal-mission').addEventListener('click', () => {
    closeLessonModal();
    if (state._pendingMission) openMission(state._pendingMission);
  });
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
    const hadProgress = state.session && state.session.answered > 0;
    state.session = null;
    renderHome();
    show('screen-home');
    if (hadProgress) showToast('Lesson paused — progress saved.', 2500);
  });
  document.getElementById('done-back').addEventListener('click', () => {
    clearTimeout(state._doneAutoTimer);
    renderHome();
    show('screen-home');
  });
  document.getElementById('done-again').addEventListener('click', () => {
    clearTimeout(state._doneAutoTimer);
    const theme = state._lastSessionTheme || null;
    if (buildQueue(theme).length === 0) {
      if (theme && buildQueue(null).length > 0) {
        startSession(null);
      } else {
        showToast("You're caught up. See you later.", 2500);
        renderHome();
        show('screen-home');
      }
      return;
    }
    startSession(theme);
  });

  // Lesson-end modal popup handlers — force an explicit choice at the end of a lesson.
  document.getElementById('lesson-modal-done').addEventListener('click', () => {
    closeLessonModal();
    renderHome();
    show('screen-home');
  });
  document.getElementById('lesson-modal-again').addEventListener('click', () => {
    closeLessonModal();
    const theme = state._lastSessionTheme || null;
    if (buildQueue(theme).length === 0) {
      if (theme && buildQueue(null).length > 0) startSession(null);
      else {
        showToast("You're caught up. See you later.", 2500);
        renderHome();
        show('screen-home');
      }
      return;
    }
    startSession(theme);
  });
  document.getElementById('lesson-modal-cheeky').addEventListener('click', () => {
    closeLessonModal();
    startSession(null, null, { lessonSize: 5 });
  });
  document.getElementById('stat-mastered').addEventListener('click', (e) => {
    // The stat number drills into the mastered-words list.
    // Stop propagation so the surrounding stat-card click (progress screen) doesn't also fire.
    e.stopPropagation();
    openMasteredList();
  });
  document.getElementById('close-mastered').addEventListener('click', () => {
    renderHome();
    show('screen-home');
  });
  // Tap anywhere else on the stat-card → progress screen.
  document.getElementById('stat-card').addEventListener('click', openProgressScreen);
  document.getElementById('close-progress').addEventListener('click', () => {
    renderHome();
    show('screen-home');
  });
  document.getElementById('daily-goal-card').addEventListener('click', () => {
    renderSettings();
    show('screen-settings');
  });
  document.getElementById('word-of-day').addEventListener('click', () => {
    if (state._wordOfDay) startSession(null, [state._wordOfDay]);
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

  // Swipe gestures: right = Know it, left = Not sure.
  // Attached to document.body so swipes anywhere register, regardless of which
  // element the touch lands on. Active only during the answer/grade phase.
  let swipeStartX = null, swipeStartY = null;
  document.body.addEventListener('pointerdown', (e) => {
    if (document.getElementById('screen-study').classList.contains('hidden')) return;
    if (document.getElementById('grade-row').classList.contains('hidden')) return;
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
  });
  document.body.addEventListener('pointerup', (e) => {
    if (swipeStartX === null) return;
    const dx = e.clientX - swipeStartX;
    const dy = e.clientY - swipeStartY;
    swipeStartX = null;
    swipeStartY = null;
    if (document.getElementById('grade-row').classList.contains('hidden')) return;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx > 0) gradeAndAdvance('easy');
    else gradeAndAdvance('again');
  });
  document.body.addEventListener('pointercancel', () => {
    swipeStartX = null;
    swipeStartY = null;
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
