// ====== Config joueurs (tu modifies ici) ======
const PLAYERS = [
  { name: "Jice", color: "#4366BB" }, // bleu
  { name: "Léo", color: "#22C55E" },  // vert
  { name: "Emma", color: "#EEA825" }, // ambre
  { name: "Nico", color: "#73AFB9" }  // teal
];

// ====== Supabase (à remplir) ======
const SUPABASE_URL = "https://nkhrrigusnkufpfpotoz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5raHJyaWd1c25rdWZwZnBvdG96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0ODE3NzIsImV4cCI6MjA4NDA1Nzc3Mn0.2ujvv_IQMgvTeVsmwUtHZTie_q-XST1ULfSd4ZGgHRA";

// Anti-crash : si la lib n'est pas chargée, on désactive le multi mais l'app reste jouable
let supabase = null;
try {
  if (
    window.supabase &&
    typeof window.supabase.createClient === "function" &&
    SUPABASE_URL.includes("supabase.co") &&
    SUPABASE_ANON_KEY.length > 20
  ) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.warn("[Supabase] non initialisé (script manquant ou clés invalides) — mode solo.");
  }
} catch (e) {
  console.warn("[Supabase] init a échoué — mode solo.", e);
  supabase = null;
}

// ====== DOM ======
const screenPlayer = document.getElementById("screen-player");
const screenGame = document.getElementById("screen-game");

const playerGrid = document.getElementById("player-grid");
const playerPill = document.getElementById("player-pill");
const changePlayerBtn = document.getElementById("change-player-btn");

const input = document.getElementById("answer-input");
const titleEl = document.getElementById("quiz-title");
const promptEl = document.getElementById("quiz-prompt");
const progressEl = document.getElementById("progress");
const listEl = document.getElementById("answers-list");

const othersEl = document.getElementById("others");

// ====== Multiplayer UI state ======
const othersState = {}; // player_name -> row
let realtimeChannel = null;

// ====== State ======
let quiz = null;
let found = new Set();
let currentPlayer = null;

// ====== Utils ======
function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

// (MVP) date locale du navigateur (sert encore pour trouver le fichier quiz si tu utilises la date)
function getTodayId() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Param URL optionnel ?quiz=mon-id
function getQuizParam() {
  const p = new URLSearchParams(window.location.search);
  return p.get("quiz");
}

function storageKey(quizId, playerName) {
  return `dq_progress:${quizId}:${playerName}`;
}

// IMPORTANT: identifiant indépendant de la date
// On utilise quiz.id (du JSON). Si absent, fallback sur param ?quiz=, sinon date (MVP).
function getQuizId() {
  return quiz?.id || getQuizParam() || getTodayId();
}

// ====== Local progress ======
function saveProgress() {
  if (!quiz || !currentPlayer) return;
  const key = storageKey(getQuizId(), currentPlayer);
  const payload = {
    foundAnswers: Array.from(found),
    savedAt: Date.now()
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

function loadProgress() {
  if (!quiz || !currentPlayer) return;
  const key = storageKey(getQuizId(), currentPlayer);
  const raw = localStorage.getItem(key);

  if (!raw) {
    found = new Set();
    return;
  }

  try {
    const data = JSON.parse(raw);
    const valid = new Set();

    const answersSet = new Set((quiz.items || []).map(i => i.answer));
    for (const a of (data.foundAnswers || [])) {
      if (answersSet.has(a)) valid.add(a);
    }
    found = valid;
  } catch {
    found = new Set();
  }
}

// ====== Screens ======
function showScreen(which) {
  if (which === "player") {
    screenPlayer.classList.remove("hidden");
    screenGame.classList.add("hidden");
  } else {
    screenPlayer.classList.add("hidden");
    screenGame.classList.remove("hidden");
  }
}

// ====== Player selection ======
function renderPlayers() {
  playerGrid.innerHTML = "";

  PLAYERS.forEach(p => {
    const name = typeof p === "string" ? p : p.name;
    const color = typeof p === "string" ? "" : (p.color || "");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-btn";
    if (color) btn.style.setProperty("--player-color", color);

    btn.innerHTML = `
      <span>${name}</span>
      <span class="badge"><span class="dot"></span> Choisir</span>
    `;

    btn.addEventListener("click", () => selectPlayer(name, color));
    playerGrid.appendChild(btn);
  });
}

function selectPlayer(name, color) {
  currentPlayer = name;
  localStorage.setItem("dq_player", name);
  localStorage.setItem("dq_player_color", color || "");

  // Couleur joueur dans la pill
  screenGame.style.setProperty("--player-color", color || "");
  playerPill.textContent = `Vous : ${name}`;

  showScreen("game");

  // Charger progression locale
  loadProgress();
  updateUI();
  renderList();

  // Multiplayer (si dispo)
  ensurePresenceRow();
  subscribePresence();

  input.focus();
}

function clearPlayer() {
  currentPlayer = null;
  localStorage.removeItem("dq_player");

  // stop realtime
  if (supabase && realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  showScreen("player");
}

// ====== Quiz rendering ======
function updateUI() {
  if (!quiz) return;
  progressEl.textContent = `${found.size} / ${quiz.items.length}`;
}

function renderList() {
  if (!quiz) return;
  listEl.innerHTML = "";
  quiz.items.forEach(item => {
    const li = document.createElement("li");
    if (found.has(item.answer)) {
      li.textContent = item.answer;
      li.classList.add("found");
    } else {
      li.textContent = "—";
    }
    listEl.appendChild(li);
  });
}

function checkAnswer(value) {
  if (!quiz) return;

  const normalized = normalize(value);
  if (!normalized) return;

  for (const item of quiz.items) {
    if (found.has(item.answer)) continue;

    const allAnswers = [item.answer, ...(item.aliases || [])];
    const match = allAnswers.some(a => normalize(a) === normalized);

    if (match) {
      found.add(item.answer);

      saveProgress();
      ensurePresenceRow();

      input.value = "";
      updateUI();
      renderList();

      if (found.size === quiz.items.length) {
        input.blur();
      }
      break;
    }
  }
}

// ====== Load quiz ======
async function loadQuiz() {
  // Pour l’instant, on garde le chargement par fichier (MVP)
  // Tu pourras plus tard passer à un index.json ou Supabase.
  const today = getTodayId();

  const res = await fetch(`quizzes/${today}.json`);
  if (!res.ok) {
    titleEl.textContent = "Quiz introuvable";
    promptEl.textContent = `Aucun fichier quizzes/${today}.json. Ajoute-le pour jouer aujourd’hui.`;
    progressEl.textContent = "";
    listEl.innerHTML = "";
    if (othersEl) othersEl.innerHTML = "";
    input.disabled = true;
    return;
  }

  quiz = await res.json();

  titleEl.textContent = quiz.title;
  promptEl.textContent = quiz.prompt;

  // Reset / restore progress
  found = new Set();
  if (currentPlayer) loadProgress();

  input.disabled = false;
  input.value = "";

  updateUI();
  renderList();

  // Multiplayer: (re)subscribe si joueur déjà choisi
  if (currentPlayer) {
    ensurePresenceRow();
    subscribePresence();
  }
}

// ====== Multiplayer (Supabase) ======
async function ensurePresenceRow() {
  if (!supabase) return;
  if (!quiz || !currentPlayer) return;

  const quizId = getQuizId();
  const finished = found.size === quiz.items.length;

  try {
    await supabase
      .from("daily_presence")
      .upsert({
        quiz_id: quizId,
        player_name: currentPlayer,
        found_count: found.size,
        finished_at: finished ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      });
  } catch (e) {
    console.warn("[Supabase] upsert presence failed", e);
  }
}

function subscribePresence() {
  if (!supabase) return;
  if (!quiz) return;

  const quizId = getQuizId();

  // reset affichage
  for (const k of Object.keys(othersState)) delete othersState[k];
  redrawOthers();

  // kill old channel
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);

  realtimeChannel = supabase
    .channel(`presence:${quizId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "daily_presence", filter: `quiz_id=eq.${quizId}` },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        if (row.player_name === currentPlayer) return;
        othersState[row.player_name] = row;
        redrawOthers();
      }
    )
    .subscribe();

  // charge l'état actuel (les joueurs déjà présents)
  supabase
    .from("daily_presence")
    .select("*")
    .eq("quiz_id", quizId)
    .then(({ data, error }) => {
      if (error) {
        console.warn("[Supabase] select presence failed", error);
        return;
      }
      if (!data) return;
      for (const row of data) {
        if (row.player_name === currentPlayer) continue;
        othersState[row.player_name] = row;
      }
      redrawOthers();
    });
}

function redrawOthers() {
  if (!othersEl || !quiz) return;

  const rows = Object.values(othersState)
    .sort((a, b) => (b.found_count ?? 0) - (a.found_count ?? 0));

  othersEl.innerHTML = "";

  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "other-player";
    empty.textContent = "Personne d’autre en ligne pour l’instant.";
    othersEl.appendChild(empty);
    return;
  }

  for (const p of rows) {
    const div = document.createElement("div");
    div.className = "other-player";

    const left = document.createElement("div");
    left.className = "other-left";

    const dot = document.createElement("div");
    dot.className = "other-dot";

    const name = document.createElement("div");
    name.className = "other-name";
    name.textContent = p.player_name;

    left.appendChild(dot);
    left.appendChild(name);

    const right = document.createElement("div");
    right.className = "other-right";

    const score = document.createElement("div");
    score.textContent = `${p.found_count ?? 0}/${quiz.items.length}`;
    right.appendChild(score);

    if (p.finished_at) {
      const fini = document.createElement("div");
      fini.className = "badge-fini";
      fini.textContent = "Fini";
      right.appendChild(fini);
    }

    div.appendChild(left);
    div.appendChild(right);
    othersEl.appendChild(div);
  }
}

// ====== Events ======
if (input) {
  input.addEventListener("input", e => {
    if (!quiz) return;
    if (!currentPlayer) return;
    checkAnswer(e.target.value);
  });
}

if (changePlayerBtn) {
  changePlayerBtn.addEventListener("click", () => {
    clearPlayer();
  });
}

// ====== Boot ======
renderPlayers();
loadQuiz();

const saved = localStorage.getItem("dq_player");
const savedColor = localStorage.getItem("dq_player_color") || "";
const exists = PLAYERS.some(p => p.name === saved);

if (saved && exists) {
  selectPlayer(saved, savedColor);
} else {
  showScreen("player");
}
