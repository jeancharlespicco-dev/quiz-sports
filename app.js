(() => {
  "use strict";

  // ====== Config joueurs (tu modifies ici) ======
  const PLAYERS = [
    { name: "JCP", color: "#4366BB" }, // bleu
    { name: "TSP", color: "#22C55E" },  // vert
    { name: "XL", color: "#EEA825" }, // ambre
    { name: "MC", color: "#73AFB9" }  // teal
  ];
const PLAYER_COLOR = new Map(PLAYERS.map(p => [p.name, p.color]));

  // ====== Supabase (à remplir) ======
  const SUPABASE_URL = "https://nkhrrigusnkufpfpotoz.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5raHJyaWd1c25rdWZwZnBvdG96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0ODE3NzIsImV4cCI6MjA4NDA1Nzc3Mn0.2ujvv_IQMgvTeVsmwUtHZTie_q-XST1ULfSd4ZGgHRA";

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

  // ====== Supabase client (anti-crash) ======
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

  function getTodayId() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function getQuizParam() {
    const p = new URLSearchParams(window.location.search);
    return p.get("quiz");
  }

  function storageKey(quizId, playerName) {
    return `dq_progress:${quizId}:${playerName}`;
  }

  // IMPORTANT: identifiant indépendant de la date
  function getQuizId() {
    return quiz?.id || getQuizParam() || getTodayId();
  }

  // ====== Local progress ======
  function saveProgress() {
    if (!quiz || !currentPlayer) return;
    const key = storageKey(getQuizId(), currentPlayer);
    const payload = { foundAnswers: Array.from(found), savedAt: Date.now() };
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
      screenPlayer?.classList.remove("hidden");
      screenGame?.classList.add("hidden");
    } else {
      screenPlayer?.classList.add("hidden");
      screenGame?.classList.remove("hidden");
    }
  }

  // ====== Player selection ======
  function renderPlayers() {
    if (!playerGrid) return;
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

    screenGame?.style.setProperty("--player-color", color || "");
    if (playerPill) playerPill.textContent = `Vous : ${name}`;

    showScreen("game");

    loadProgress();
    updateUI();
    renderList();

    ensurePresenceRow();
    subscribePresence();

    input?.focus();
  }

  function clearPlayer() {
    currentPlayer = null;
    localStorage.removeItem("dq_player");

    if (supabase && realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    showScreen("player");
  }

  // ====== Quiz rendering ======
  function updateUI() {
    if (!quiz || !progressEl) return;
    progressEl.textContent = `${found.size} / ${quiz.items.length}`;
  }

  function renderList() {
    if (!quiz || !listEl) return;
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

        if (input) input.value = "";
        updateUI();
        renderList();

        if (found.size === quiz.items.length) input?.blur();
        break;
      }
    }
  }

  // ====== Load quiz ======
  async function loadQuiz() {
    const today = getTodayId();
    const res = await fetch(`quizzes/${today}.json`);

    if (!res.ok) {
      if (titleEl) titleEl.textContent = "Quiz introuvable";
      if (promptEl) promptEl.textContent = `Aucun fichier quizzes/${today}.json. Ajoute-le pour jouer aujourd’hui.`;
      if (progressEl) progressEl.textContent = "";
      if (listEl) listEl.innerHTML = "";
      if (othersEl) othersEl.innerHTML = "";
      if (input) input.disabled = true;
      return;
    }

    quiz = await res.json();

    if (titleEl) titleEl.textContent = quiz.title;
    if (promptEl) promptEl.textContent = quiz.prompt;

    found = new Set();
    if (currentPlayer) loadProgress();

    if (input) {
      input.disabled = false;
      input.value = "";
    }

    updateUI();
    renderList();

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

    for (const k of Object.keys(othersState)) delete othersState[k];
    redrawOthers();

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
    .filter(p => (p.found_count ?? 0) > 0) // ✅ seulement ceux qui ont trouvé au moins 1
    .sort((a, b) => (b.found_count ?? 0) - (a.found_count ?? 0));

  othersEl.innerHTML = "";

  // ✅ si personne n'a encore trouvé : on n'affiche rien (comme demandé)
  if (rows.length === 0) return;

  for (const p of rows) {
    const card = document.createElement("div");
    card.className = "other-card";

    const c = PLAYER_COLOR.get(p.player_name);
    if (c) card.style.setProperty("--player-color", c);

    const top = document.createElement("div");
    top.className = "other-top";

    const dot = document.createElement("div");
    dot.className = "other-dot";

    const name = document.createElement("div");
    name.className = "other-name";
    name.textContent = p.player_name;

    top.appendChild(dot);
    top.appendChild(name);

    const score = document.createElement("div");
    score.className = "other-score";
    score.textContent = `${p.found_count ?? 0}/${quiz.items.length}`;

    card.appendChild(top);
    card.appendChild(score);

    if (p.finished_at) {
      const fini = document.createElement("div");
      fini.className = "other-fini";
      fini.textContent = "Fini";
      card.appendChild(fini);
    }

    othersEl.appendChild(card);
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
    changePlayerBtn.addEventListener("click", () => clearPlayer());
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
})();
