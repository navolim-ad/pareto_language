// ============== Constants ==============
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LANG_LABELS = {
  en: 'English',
  es: 'Español',
  ar: 'العربية',
  sr: 'Srpski',
};

// ============== State ==============
const state = {
  words: [],
  themes: [],
  settings: null,
  progress: {},
  daily: { date: '', done: 0 },
  session: null,
  voices: new Set(),
};

// ============== Audio (TTS) ==============
const VOICE_LANG = { ar: 'ar-SA', es: 'es-ES', sr: 'sr-RS', en: 'en-US' };

// Female voice name hints by language (preferred when available).
const FEMALE_VOICE_HINTS = {
  ar: ['laila', 'maha', 'reema', 'rana', 'amina', 'female'],
  es: ['mónica', 'monica', 'paulina', 'marisol', 'soledad', 'angelica', 'female'],
  sr: ['female'],
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
function canSpeak(lang) { return state.voices.has(lang); }

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
  if (!canSpeak(lang) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = VOICE_LANG[lang] || lang;
  const v = pickVoice(lang);
  if (v) u.voice = v;
  u.rate = 0.85;
  speechSynthesis.speak(u);
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
  state.daily = { date: today, done: 0 };
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
function calcStats() {
  const stats = { new: 0, learning: 0, young: 0, mature: 0, total: state.words.length };
  for (const w of state.words) {
    stats[cardLabel(state.progress[w.id])] += 1;
  }
  return stats;
}

// ============== Queue ==============
function buildQueue(themeFilter) {
  const now = Date.now();
  const due = [];
  const fresh = [];
  for (const w of state.words) {
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
  const remaining = Math.max(0, state.settings.dailyGoal - state.daily.done);
  const newCap = themeFilter ? fresh.length : Math.min(fresh.length, remaining);
  return [...due, ...fresh.slice(0, newCap)];
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

  const stats = calcStats();
  const statMastered = document.getElementById('stat-mastered');
  statMastered.textContent = stats.mature;
  statMastered.classList.toggle('has-mastered', stats.mature > 0);
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-new').textContent = stats.new;
  document.getElementById('stat-learning').textContent = stats.learning;
  document.getElementById('stat-young').textContent = stats.young;
  document.getElementById('stat-mature').textContent = stats.mature;

  const pct = stats.total ? (stats.mature / stats.total) * 100 : 0;
  document.getElementById('stat-bar-fill').style.width = pct + '%';

  document.getElementById('daily-done').textContent = state.daily.done;
  document.getElementById('daily-goal').textContent = state.settings.dailyGoal;
  const dailyPct = Math.min(100, (state.daily.done / state.settings.dailyGoal) * 100);
  document.getElementById('daily-bar-fill').style.width = dailyPct + '%';

  // Theme chips
  const chipRow = document.getElementById('theme-chips');
  chipRow.innerHTML = '';
  const themeCounts = {};
  for (const w of state.words) {
    themeCounts[w.theme] = (themeCounts[w.theme] || 0) + 1;
  }
  for (const theme of state.themes) {
    if (!themeCounts[theme]) continue;
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = humanTheme(theme);
    const count = document.createElement('span');
    count.className = 'chip-count';
    count.textContent = themeCounts[theme];
    btn.appendChild(count);
    btn.addEventListener('click', () => startSession(theme));
    chipRow.appendChild(btn);
  }
}

function renderCard(word, showAnswer) {
  const src = state.settings.source;
  const tgt = state.settings.target;

  const promptEl = document.getElementById('card-prompt');
  promptEl.textContent = getDisplayWord(word, tgt);
  if (tgt === 'ar') promptEl.setAttribute('dir', 'rtl');
  else promptEl.removeAttribute('dir');

  const metaEl = document.getElementById('card-meta');
  if (tgt === 'ar' && word.ar_translit) {
    metaEl.textContent = word.ar_translit;
  } else if (tgt === 'sr') {
    metaEl.textContent = state.settings.sr_script === 'cyrillic' ? word.sr : word.sr_cyr;
  } else {
    metaEl.textContent = '';
  }

  // Audio button
  const audioBtn = document.getElementById('audio-btn');
  if (canSpeak(tgt)) {
    audioBtn.classList.remove('hidden');
    audioBtn.onclick = (e) => {
      e.stopPropagation();
      speak(word[tgt], tgt);
    };
  } else {
    audioBtn.classList.add('hidden');
  }

  const emojiEl = document.getElementById('card-emoji');
  emojiEl.textContent = '';

  const answerEl = document.getElementById('card-answer');
  const answerMain = document.getElementById('card-answer-main');
  const answerTranslit = document.getElementById('card-answer-translit');
  const exampleEl = document.getElementById('card-example');
  const exampleSrcEl = document.getElementById('card-example-src');
  const exampleTgtEl = document.getElementById('card-example-tgt');
  const exampleTransEl = document.getElementById('card-example-translit');
  const skipBtn = document.getElementById('skip-known-btn');

  const cardState = state.progress[word.id];
  const isNew = !cardState || cardState.reps === 0;

  if (showAnswer) {
    answerEl.classList.remove('hidden');
    answerMain.textContent = getDisplayWord(word, src);
    answerMain.removeAttribute('dir');
    answerTranslit.textContent = '';
    emojiEl.textContent = word.emoji || '';
    document.getElementById('reveal-row').classList.add('hidden');
    document.getElementById('grade-row').classList.remove('hidden');
    skipBtn.classList.add('hidden');
    document.getElementById('skip-hint').classList.add('hidden');

    // Example (if present)
    if (word.example && word.example[src] && word.example[tgt]) {
      exampleEl.classList.remove('hidden');
      exampleSrcEl.textContent = word.example[src];
      const tgtExample = (tgt === 'sr')
        ? (state.settings.sr_script === 'cyrillic' ? word.example.sr_cyr : word.example.sr)
        : word.example[tgt];
      exampleTgtEl.textContent = tgtExample || '';
      if (tgt === 'ar') exampleTgtEl.setAttribute('dir', 'rtl');
      else exampleTgtEl.removeAttribute('dir');
      exampleTransEl.textContent = (tgt === 'ar' && word.example.ar_translit) ? word.example.ar_translit : '';

      // Example audio button
      const exAudioBtn = document.getElementById('example-audio-btn');
      if (canSpeak(tgt) && word.example[tgt]) {
        exAudioBtn.classList.remove('hidden');
        exAudioBtn.onclick = (e) => {
          e.stopPropagation();
          speak(word.example[tgt], tgt);
        };
      } else {
        exAudioBtn.classList.add('hidden');
      }
    } else {
      exampleEl.classList.add('hidden');
    }
  } else {
    answerEl.classList.add('hidden');
    exampleEl.classList.add('hidden');
    // Show emoji as a hint on brand-new cards, otherwise hide it.
    emojiEl.textContent = (isNew && word.emoji) ? word.emoji : '';
    document.getElementById('reveal-row').classList.remove('hidden');
    document.getElementById('grade-row').classList.add('hidden');
    const skipHint = document.getElementById('skip-hint');
    if (isNew) {
      skipBtn.classList.remove('hidden');
      skipHint.classList.remove('hidden');
    } else {
      skipBtn.classList.add('hidden');
      skipHint.classList.add('hidden');
    }
  }
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
  };
  show('screen-study');
  renderCurrent();
}

function renderCurrent() {
  if (!state.session || state.session.index >= state.session.queue.length) {
    finishSession();
    return;
  }
  const w = state.session.queue[state.session.index];
  document.getElementById('study-progress').textContent =
    `${state.session.index + 1} / ${state.session.queue.length}`;
  renderCard(w, false);

  const cardEl = document.getElementById('card-area');
  cardEl.classList.remove('enter', 'exit-again', 'exit-good', 'exit-easy');
  void cardEl.offsetWidth;
  cardEl.classList.add('enter');
}

function reveal() {
  if (!state.session) return;
  const w = state.session.queue[state.session.index];
  renderCard(w, true);
}

function gradeAndAdvance(grade) {
  if (!state.session || state.session._busy) return;
  state.session._busy = true;

  const w = state.session.queue[state.session.index];
  let card = state.progress[w.id];
  if (!card) { card = defaultCardState(); state.progress[w.id] = card; }
  gradeCard(card, grade);

  if (grade !== 'again' && !state.session.countedIds.has(w.id)) {
    state.daily.done += 1;
    state.session.countedIds.add(w.id);
    saveDaily();
  }
  saveProgress();

  if (grade === 'again') {
    state.session.againCounts[w.id] = (state.session.againCounts[w.id] || 0) + 1;
    const offset = Math.min(3, state.session.queue.length - state.session.index - 1);
    const requeueAt = state.session.index + 1 + offset;
    state.session.queue.splice(requeueAt, 0, w);
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
  document.getElementById('done-summary').textContent = buildSessionSummary();
  state.session = null;
  show('screen-done');
}

function skipKnown() {
  if (!state.session || state.session._busy) return;
  const w = state.session.queue[state.session.index];
  let card = state.progress[w.id];
  if (!card) { card = defaultCardState(); state.progress[w.id] = card; }
  card.reps = 5;
  card.ease = 2.5;
  card.interval = 30 * MS_PER_DAY;
  card.due = Date.now() + card.interval;
  saveProgress();
  if (!state.session.countedIds.has(w.id)) {
    state.daily.done += 1;
    state.session.countedIds.add(w.id);
    saveDaily();
  }
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

  if (stats.mature === 0) {
    summary.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'mastered-empty';
    empty.textContent = "Words you've learned consistently over weeks will appear here. Keep going!";
    list.appendChild(empty);
    show('screen-mastered');
    return;
  }

  summary.textContent = `${stats.mature} word${stats.mature!==1?'s':''} mastered out of ${stats.total}.`;

  const src = state.settings.source;
  const tgt = state.settings.target;
  const mature = state.words.filter(w => cardLabel(state.progress[w.id]) === 'mature');

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
  document.getElementById('stat-mastered').addEventListener('click', openMasteredList);
  document.getElementById('close-mastered').addEventListener('click', () => {
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
