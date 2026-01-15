// ====== Config joueurs (tu modifies ici) ======
const PLAYERS = [
  { name: "Jice", color: "#4366BB" }, // bleu
  { name: "Léo", color: "#22C55E" },  // vert
  { name: "Emma", color: "#EEA825" }, // ambre
  { name: "Nico", color: "#73AFB9" }  // teal
];

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

function getTodayId() {
  // Simple MVP: date locale du navigateur
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function storageKey(quizId, playerName) {
  return `dq_progress:${quizId}:${playerName}`;
}

function saveProgress() {
  if (!quiz || !currentPlayer) return;
  const key = storageKey(quiz.id || getTodayId(), currentPlayer);
  const payload = {
    foundAnswers: Array.from(found),
    savedAt: Date.now()
  };
  localStorage.setItem(key, JSON.stringify(payload));
}

function loadProgress() {
  if (!quiz || !currentPlayer) return;
  const key = storageKey(quiz.id || getTodayId(), currentPlayer);
  const raw = localStorage.getItem(key);
  if (!raw) {
    found = new Set();
    return;
  }

  try {
    const data = JSON.parse(raw);
    const valid = new Set();

    // On ne garde que les réponses qui existent dans le quiz
    const answersSet = new Set(quiz.items.map(i => i.answer));
    for (const a of (data.foundAnswers || [])) {
      if (answersSet.has(a)) valid.add(a);
    }
    found = valid;
  } catch {
    found = new Set();
  }
}

function clearProgressFor(quizId, playerName) {
  const key = storageKey(quizId, playerName);
  localStorage.removeItem(key);
}


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
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "player-btn";
  btn.style.setProperty("--player-color", p.color);
  btn.innerHTML = `
    <span>${p.name}</span>
    <span class="badge"><span class="dot"></span> Choisir</span>
  `;
  btn.addEventListener("click", () => selectPlayer(p.name, p.color));
  playerGrid.appendChild(btn);
});

}

function selectPlayer(name, color) {
  currentPlayer = name;
  localStorage.setItem("dq_player", name);
  localStorage.setItem("dq_player_color", color || "");

  // set couleur du joueur pour la pill
  screenGame.style.setProperty("--player-color", color || "");
  playerPill.textContent = `Vous : ${name}`;

  showScreen("game");
    // Charger progression locale pour ce joueur + quiz du jour
  loadProgress();
  updateUI();
  renderList();
  input.focus();
}


function clearPlayer() {
  currentPlayer = null;
  localStorage.removeItem("dq_player");
  showScreen("player");
}

// ====== Quiz rendering ======
function updateUI() {
  progressEl.textContent = `${found.size} / ${quiz.items.length}`;
}

function renderList() {
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
  const normalized = normalize(value);
  if (!normalized) return;

  for (const item of quiz.items) {
    if (found.has(item.answer)) continue;

    const allAnswers = [item.answer, ...(item.aliases || [])];
    const match = allAnswers.some(a => normalize(a) === normalized);

    if (match) {
      found.add(item.answer);
      saveProgress();

      input.value = "";
      updateUI();
      renderList();

      // Fin de partie (solo) : on pourra brancher plus tard
      if (found.size === quiz.items.length) {
        // petit feedback soft
        input.blur();
      }
      break;
    }
  }
}

async function loadQuiz() {
  const today = getTodayId();
  const res = await fetch(`quizzes/${today}.json`);
  if (!res.ok) {
    // Message clair si le quiz du jour n'existe pas
    titleEl.textContent = "Quiz introuvable";
    promptEl.textContent = `Aucun fichier quizzes/${today}.json. Ajoute-le pour jouer aujourd’hui.`;
    progressEl.textContent = "";
    listEl.innerHTML = "";
    input.disabled = true;
    return;
  }

  quiz = await res.json();

  titleEl.textContent = quiz.title;
  promptEl.textContent = quiz.prompt;

found = new Set();
if (currentPlayer) {
  loadProgress();
}
  input.disabled = false;
  input.value = "";

  updateUI();
  renderList();
}

// ====== Events ======
input.addEventListener("input", e => {
  if (!quiz) return;
  if (!currentPlayer) return;
  checkAnswer(e.target.value);
});

changePlayerBtn.addEventListener("click", () => {
  clearPlayer();
});

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

