(() => {
  "use strict";

  // ====== Config joueurs (tu modifies ici) ======
  const PLAYERS = [
    { name: "HB", color: "#22C55E" }, 
    { name: "JCP", color: "#4366BB" }, 
    { name: "LBL", color: "#EEA825" }, 
    { name: "MC", color: "#B68489" },  
    { name: "MM", color: "#0F172A" },  
    { name: "NG", color: "#15803D" },  
    { name: "TSP", color: "#73AFB9" },  
    { name: "XL", color: "#DB9411" },  
  ];
const PLAYER_COLOR = new Map(PLAYERS.map(p => [p.name, p.color]));
const ALLOWED_PLAYERS = new Set(PLAYERS.map(p => p.name));


  // ====== Supabase (à remplir) ======
  const SUPABASE_URL = "https://nkhrrigusnkufpfpotoz.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5raHJyaWd1c25rdWZwZnBvdG96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0ODE3NzIsImV4cCI6MjA4NDA1Nzc3Mn0.2ujvv_IQMgvTeVsmwUtHZTie_q-XST1ULfSd4ZGgHRA";

  // ====== DOM ======
  const screenPlayer = document.getElementById("screen-player");
  const screenGame = document.getElementById("screen-game");

  const playerGrid = document.getElementById("player-grid");
  const playerPill = document.getElementById("player-pill");
  const changePlayerBtn = document.getElementById("change-player-btn");
  const resetBtn = document.getElementById("reset-btn");
  const winnerBanner = document.getElementById("winner-banner");



  const input = document.getElementById("answer-input");
  const titleEl = document.getElementById("quiz-title");
  const promptEl = document.getElementById("quiz-prompt");
  const progressEl = document.getElementById("progress");
  const listEl = document.getElementById("answers-list");

  const othersEl = document.getElementById("others");

  const screenStats = document.getElementById("screen-stats");
const statsBtn = document.getElementById("stats-btn");
const backToGameBtn = document.getElementById("back-to-game-btn");

const quizRankingEl = document.getElementById("quiz-ranking");
const globalRankingEl = document.getElementById("global-ranking");


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

const lastFoundCount = {}; // player_name -> number


  // ====== State ======
  let hintsCostTotal = 0;
  let pendingHint = null; // { answer, expiresAt }
  let quiz = null;
  let found = new Set();
  let currentPlayer = null;
  let hintsUsedByAnswer = {}; // { "Paris SG": 1, ... }
let hintsUsedTotal = 0;


let winner = null; // { player_name, finished_at }

function showWinnerBanner(playerName) {
  if (!winnerBanner) return;

  const color = PLAYER_COLOR.get(playerName) || "rgba(238,168,37,0.9)";
  winnerBanner.style.setProperty("--winner-color", color);

  winnerBanner.innerHTML = `
    <span class="dot"></span>
    <span>🏆 <strong>${playerName}</strong> a gagné ce quiz !</span>
  `;
  winnerBanner.classList.remove("hidden");
}

function hideWinnerBanner() {
  if (!winnerBanner) return;
  winnerBanner.classList.add("hidden");
  winnerBanner.innerHTML = "";
}

async function fetchWinner() {
  if (!supabase || !quiz) return;

  const quizId = getQuizId();

  const { data, error } = await supabase
    .from("daily_presence")
    .select("player_name, finished_at")
    .eq("quiz_id", quizId)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: true })
    .limit(1);

  if (error) {
    console.warn("[Winner] fetch failed", error);
    return;
  }

  const row = data?.[0];
  if (!row) {
    winner = null;
    hideWinnerBanner();
    return;
  }

  winner = row;
  showWinnerBanner(row.player_name);
}

function hideMyFinishCard(){
  const el = document.getElementById("my-finish-card");
  if (!el) return;
  el.classList.add("hidden");
  el.innerHTML = "";
}

function showMyFinishCard(rank, points){
  const el = document.getElementById("my-finish-card");
  if (!el) return;

  el.innerHTML = `
    <div class="left">
      <div class="title">🎉 Terminé !</div>
      <div class="sub">Tu es arrivé #${rank}</div>
    </div>
    <div class="right">+${points} pts</div>
  `;
  el.classList.remove("hidden");
}

async function fetchMyResultAndShow(){
  if (!supabase || !quiz || !currentPlayer) return;

  const quizId = getQuizId();

  const { data, error } = await supabase
    .from("quiz_results")
    .select("rank, points")
    .eq("quiz_id", quizId)
    .eq("player_name", currentPlayer)
    .maybeSingle();

  if (error) {
    console.warn("[FinishCard] fetch my result failed", error);
    return;
  }

  if (!data) return;
  showMyFinishCard(data.rank, data.points);
}



  // ====== Utils ======
  function normalize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]/g, "")
      .trim();
  }

function hexToRgbTriplet(hex) {
  const h = (hex || "").replace("#", "").trim();
  if (h.length !== 6) return null;

  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);

  if ([r, g, b].some(n => Number.isNaN(n))) return null;

  return `${r}, ${g}, ${b}`; // ex: "67, 102, 187"
}

function hintPenaltyForNthHint(n) {
  // n = 1,2,3… (indice débloqué n°n sur une question)
  return n; // 1->1pt, 2->2pts, 3->3pts (progressif)
}


function ensureToast() {
  let el = document.getElementById("toast");
  if (el) return el;

  el = document.createElement("div");
  el.id = "toast";
  el.className = "toast";
  document.body.appendChild(el);
  return el;
}

let toastTimer = null;
function showToast(msg) {
  const el = ensureToast();
  el.textContent = msg;
  el.classList.add("is-show");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-show"), 1600);
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
    const payload = {
  foundAnswers: Array.from(found),
  hintsUsedByAnswer: hintsUsedByAnswer || {},
  hintsUsedTotal: hintsUsedTotal || 0,
  hintsCostTotal: hintsCostTotal || 0,
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
      hintsUsedByAnswer = (data.hintsUsedByAnswer && typeof data.hintsUsedByAnswer === "object")
  ? data.hintsUsedByAnswer
  : {};

hintsUsedTotal = Number.isFinite(data.hintsUsedTotal) ? data.hintsUsedTotal : 0;
hintsCostTotal = Number.isFinite(data.hintsCostTotal) ? data.hintsCostTotal : 0;

    } catch {
      found = new Set();
    }
  }

  // ====== Screens ======
function showScreen(which) {
  if (screenPlayer) screenPlayer.classList.add("hidden");
  if (screenGame) screenGame.classList.add("hidden");
  if (screenStats) screenStats.classList.add("hidden");

  if (which === "player") screenPlayer?.classList.remove("hidden");
  if (which === "game") screenGame?.classList.remove("hidden");
  if (which === "stats") screenStats?.classList.remove("hidden");
}

function runSplashIntro() {
  const splash = document.getElementById("splash");
  if (!splash) return;

  // Respecte "reduced motion"
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const total = reduce ? 100 : 1100; // durée totale avant fade out

  window.setTimeout(() => {
    splash.classList.add("is-hiding");

    // une fois l'anim finie, on le retire
    window.setTimeout(() => {
      splash.classList.add("is-hidden");
    }, 360);
  }, total);
}

function pointsForRank(rank) {
  // 1->10, 2->7, 3->5, 4->3, 5->2, 6+->1
  const table = [10, 7, 5, 3, 2];
  if (rank <= 0) return 0;
  if (rank <= table.length) return table[rank - 1];
  return 1;
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
        <span class="dot"></span>
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
    if (playerPill) playerPill.textContent = `${name}`;

    showScreen("game");

    loadProgress();
    updateUI();
    renderList();
    renderLiveLadder();

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
  const myScoreEl = document.getElementById("my-score");
  if (!quiz || !quiz.items) {
    if (progressEl) progressEl.textContent = "";
    if (myScoreEl) myScoreEl.textContent = "— / —";
    renderLiveLadder();
    return;
  }

  const text = `${found.size} / ${quiz.items.length}`;
  if (progressEl) progressEl.textContent = text;
  if (myScoreEl) myScoreEl.textContent = text;
  renderLiveLadder();
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
  li.classList.add("is-missing");

  const used = hintsUsedByAnswer[item.answer] || 0;
  if (used > 0) {
    li.classList.add("is-hinted");      // style léger
    li.dataset.hintsUsed = String(used); // pour badge CSS si tu veux
  }

  // clickable seulement s'il y a des hints
if (item.hints && item.hints.length > 0) {
  li.classList.add("is-hintable");
  li.title = "Cliquer pour débloquer un indice (coût: -1 puis -2 puis -3…)";
}

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

      // ===== Micro feedback (toi) =====
      // 1) pulse sur ton score
      const myScoreEl = document.getElementById("my-score");
      if (myScoreEl) {
        myScoreEl.classList.remove("is-pop");
        void myScoreEl.offsetWidth;
        myScoreEl.classList.add("is-pop");
        setTimeout(() => myScoreEl.classList.remove("is-pop"), 260);
      }

      // 2) flash sur la case trouvée
      const idx = quiz.items.findIndex(it => it.answer === item.answer);
      if (idx >= 0 && listEl && listEl.children && listEl.children[idx]) {
        const li = listEl.children[idx];
        li.classList.remove("is-flash");
        void li.offsetWidth;
        li.classList.add("is-flash");
        setTimeout(() => li.classList.remove("is-flash"), 460);
      }

      // ===== Fin du quiz =====
      if (found.size === quiz.items.length) {
        input?.blur();

        updateQuizResultsFromPresence()
          .then(fetchMyResultAndShow)
          .catch(() => {});
      }

      break; // ✅ important : on sort dès qu'on a match
    }
  }
}


  // ====== Load quiz ======
async function loadQuiz() {
  try {
    const res = await fetch("quizzes/current.json", { cache: "no-store" });

    if (!res.ok) {
      throw new Error("current.json introuvable");
    }

    const data = await res.json();

    // Garde-fou structure
    if (!data.items || !Array.isArray(data.items)) {
      throw new Error("current.json invalide (clé items manquante)");
    }

    quiz = data;

    // UI
    titleEl.textContent = quiz.title || "Quiz";
    promptEl.textContent = quiz.prompt || "";
winner = null;
hideWinnerBanner();
hideMyFinishCard();
fetchWinner();

    found = new Set();
    if (currentPlayer) loadProgress();

    if (input) {
      input.disabled = false;
      input.value = "";
    }

    updateUI();
    renderList();
    renderLiveLadder();

    if (currentPlayer) {
      ensurePresenceRow();
      subscribePresence();
    }

  } catch (e) {
    console.error("[Quiz] Load failed:", e);

    titleEl.textContent = "Quiz introuvable";
    promptEl.textContent = "Impossible de charger quizzes/current.json.";
    if (input) input.disabled = true;
  }
}





async function resetQuizForEveryone() {
  if (!quiz) return;
  const quizId = getQuizId();

  const ok = confirm("Remettre ce quiz à zéro pour tout le monde ?\n\nLes progressions seront effacées.");
  if (!ok) return;

  // 1) Supabase: reset presence
  if (supabase) {
    try {
      await supabase.rpc("reset_quiz_all", { qid: quizId });
    } catch (e) {
      console.warn("[Reset] Supabase RPC failed", e);
      alert("Reset impossible (Supabase). Regarde la console.");
      return;
    }
  }

  // 2) Local: efface la progression pour tous les joueurs connus (sur cet ordinateur)
  for (const p of PLAYERS) {
    localStorage.removeItem(storageKey(quizId, p.name));
  }

  // 3) Reset état local
  found = new Set();

  for (const k of Object.keys(othersState)) delete othersState[k];

  winner = null;
  hideWinnerBanner();
  hideMyFinishCard();

hintsUsedByAnswer = {};
hintsUsedTotal = 0;

  // 4) UI
  updateUI();
  renderList();
  redrawOthers();

  // 5) Recrée ta présence à 0 (sinon tu "disparais" côté base)
  ensurePresenceRow();

  alert("Reset effectué ✔️");
}



async function resetQuiz() {
  if (!quiz) return;
  const quizId = getQuizId();

  // 1. Supabase : reset presence
  if (supabase) {
    try {
      await supabase.rpc("reset_quiz_presence", { qid: quizId });
    } catch (e) {
      console.warn("[Reset] Supabase failed", e);
    }
  }

  // 2. LocalStorage : reset progress pour TOUS les joueurs connus
  PLAYERS.forEach(p => {
    const key = storageKey(quizId, p.name);
    localStorage.removeItem(key);
  });

  // 3. Reset état local
  found = new Set();
  for (const k of Object.keys(othersState)) delete othersState[k];

  // 4. UI
  updateUI();
  renderList();
  redrawOthers();

  // 5. Recrée la présence du joueur courant
  ensurePresenceRow();

  alert("Quiz remis à zéro ✔️");
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
          hints_used: hintsUsedTotal,
          hints_cost: hintsCostTotal,
          updated_at: new Date().toISOString()
        });
    } catch (e) {
      console.warn("[Supabase] upsert presence failed", e);
    }
  }

  async function updateQuizResultsFromPresence() {
  if (!supabase || !quiz) return;
  const quizId = getQuizId();

  const { data, error } = await supabase
    .from("daily_presence")
    .select("player_name, finished_at, hints_used, hints_cost")
    .eq("quiz_id", quizId)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: true });

  if (error) {
    console.warn("[Results] fetch presence finished failed", error);
    return;
  }

  const finished = data || [];
  if (finished.length === 0) return;

  // upsert rank/points
  const rows = finished.map((r, idx) => {
  const rank = idx + 1;
  const rankPoints = pointsForRank(rank);
  const hints = r.hints_cost ?? (r.hints_used ?? 0);
  const finalPoints = Math.max(0, rankPoints - hints);


  return {
    quiz_id: quizId,
    player_name: r.player_name,
    finished_at: r.finished_at,
    rank,
    rank_points: rankPoints,
    hints_used: hints,
    points: finalPoints
  };
});


  const { error: upsertErr } = await supabase
    .from("quiz_results")
    .upsert(rows, { onConflict: "quiz_id,player_name" });

  if (upsertErr) {
    console.warn("[Results] upsert quiz_results failed", upsertErr);
  }
}

function renderRanking(el, rows, mode) {
  if (!el) return;
  el.innerHTML = "";

  if (!rows || rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = mode === "quiz"
      ? "Personne n’a fini pour l’instant."
      : "Pas encore de stats.";
    el.appendChild(empty);
    return;
  }

  for (const r of rows) {
    const card = document.createElement("div");
    card.className = "rank-card";

    const left = document.createElement("div");
    left.className = "rank-left";

    const dot = document.createElement("div");
    dot.className = "rank-dot";
    const c = PLAYER_COLOR.get(r.player_name);
    if (c) card.style.setProperty("--player-color", c);

    const name = document.createElement("div");
    name.className = "rank-name";
    name.textContent = r.player_name;

    left.appendChild(dot);
    left.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "rank-meta";

    if (mode === "quiz") {
      meta.textContent = `#${r.rank} · ${r.points} pts`;
    } else {
      meta.textContent = `${r.total_points} pts · ${r.wins} win`;
    }

    card.appendChild(left);
    card.appendChild(meta);
    el.appendChild(card);
  }
}

async function fetchAndRenderQuizRanking() {
  if (!supabase || !quiz) return;
  const quizId = getQuizId();

  const { data, error } = await supabase
    .from("quiz_results")
    .select("player_name, rank, points")
    .eq("quiz_id", quizId)
    .order("rank", { ascending: true });

  if (error) {
    console.warn("[Stats] fetch quiz ranking failed", error);
    return;
  }

  renderRanking(quizRankingEl, data || [], "quiz");
}

async function fetchAndRenderGlobalRanking() {
  if (!supabase) return;

  const { data, error } = await supabase
    .from("v_player_stats")
    .select("player_name, total_points, wins, quizzes_finished")
    .order("total_points", { ascending: false });

  if (error) {
    console.warn("[Stats] fetch global ranking failed", error);
    return;
  }

  renderRanking(globalRankingEl, data || [], "global");
}


 function subscribePresence() {
  if (!supabase) return;
  if (!quiz) return;
  
  const quizId = getQuizId();

  // reset UI state
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

        // ===== Winner live =====
        if (row.finished_at) {
          if (!winner) {
            winner = { player_name: row.player_name, finished_at: row.finished_at };
            showWinnerBanner(row.player_name);
          } else if (row.finished_at < winner.finished_at) {
            winner = { player_name: row.player_name, finished_at: row.finished_at };
            showWinnerBanner(row.player_name);
          } 
          updateQuizResultsFromPresence().then(() => {
    fetchAndRenderQuizRanking();
    fetchAndRenderGlobalRanking();
  })

        }

        // ===== Others grid =====
if (row.player_name === currentPlayer) return;

// détecte progression
const prev = lastFoundCount[row.player_name] ?? 0;
const next = row.found_count ?? 0;
const progressed = next > prev;

lastFoundCount[row.player_name] = next;
othersState[row.player_name] = row;

redrawOthers(progressed ? row.player_name : null);

      }
    )
    .subscribe();

  // charge l'état actuel (joueurs déjà présents)
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
        lastFoundCount[row.player_name] = row.found_count ?? 0;
      }
      redrawOthers();

      // winner initial (au cas où quelqu’un a déjà fini)
      fetchWinner();
      updateQuizResultsFromPresence();
    });
}

function redrawOthers(highlightName = null) {
  if (!othersEl || !quiz) return;

  const rows = Object.values(othersState)
    .filter(p => ALLOWED_PLAYERS.has(p.player_name))   // ✅ ignore "Emma" si elle n'existe plus // 
    .filter(p => (p.found_count ?? 0) > 0) // ✅ seulement ceux qui ont trouvé au moins 1
    .sort((a, b) => (b.found_count ?? 0) - (a.found_count ?? 0));

  othersEl.innerHTML = "";

  // ✅ si personne n'a encore trouvé : on n'affiche rien (comme demandé)
  if (rows.length === 0) return;

for (const p of rows) {
  const card = document.createElement("div");
  card.className = "other-card";

  // ✅ couleur du joueur (toujours)
  const c = PLAYER_COLOR.get(p.player_name);
  if (c) {
    card.style.setProperty("--player-color", c);
    const rgb = hexToRgbTriplet(c);
    if (rgb) card.style.setProperty("--player-rgb", rgb);
  }

  // ✅ pulse si c’est lui qui vient de progresser
  if (highlightName && p.player_name === highlightName) {
    card.classList.add("is-updated");
    setTimeout(() => card.classList.remove("is-updated"), 700);
  }

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
renderLiveLadder();

}

function getActiveRowsForLadder() {
  if (!quiz) return [];

  const total = quiz.items.length;

  // Moi : toujours affiché (même à 0) -> anti-shame pour les autres, mais toi tu te vois
  const me = currentPlayer ? [{
    player_name: currentPlayer,
    found_count: found.size,
    finished_at: (found.size === total) ? new Date().toISOString() : null,
    __isMe: true
  }] : [];

  // Autres : uniquement ceux "actifs" (>=1 trouvé) -> anti-shame
  const others = Object.values(othersState)
    .filter(p => ALLOWED_PLAYERS.has(p.player_name))
    .filter(p => (p.found_count ?? 0) > 0);

  // dédoublonne au cas où
  const map = new Map();
  for (const r of [...others, ...me]) map.set(r.player_name, r);
  return Array.from(map.values());
}

function renderLiveLadder() {
  const host = document.getElementById("live-ladder");
  if (!host || !quiz) return;
  // Masque la grille des autres joueurs (redondante avec le ladder)



  const total = quiz.items.length;
  const rows = getActiveRowsForLadder();
  const isInit = !host.hasChildNodes();

  // si personne n'a commencé ET toi non plus (cas rare), tu peux choisir de masquer
  // Ici: on affiche quand même si toi tu es là, pour donner une "scène" stable.
  if (!currentPlayer) {

  host.innerHTML = `
  <div class="ladder-head">
    <div class="ladder-title">Classement live</div>
  </div>

  <div class="ladder-track" role="img" aria-label="Progression des joueurs">
    <div class="ladder-track-fill"></div>
    <div class="ladder-tick is-0">0</div>
    <div class="ladder-tick is-max">${total}</div>
    <div class="ladder-markers"></div>
  </div>
`;

    return;
  }

  if (othersEl) othersEl.style.display = "none";

  // tri par progression (desc), puis finished_at si tu veux
  rows.sort((a, b) => {
    const da = (a.found_count ?? 0);
    const db = (b.found_count ?? 0);
    if (db !== da) return db - da;
    // à égalité: moi d'abord (petit confort)
    if (a.__isMe && !b.__isMe) return -1;
    if (!a.__isMe && b.__isMe) return 1;
    return 0;
  });

  const leader = rows[0]?.player_name || null;

  // Track + markers
  const markersHtml = rows.map(r => {
    const name = r.player_name;
    const count = Math.max(0, Math.min(total, r.found_count ?? 0));
    const rawPct = total > 0 ? (count / total) * 100 : 0;
const pct = Math.max(4, Math.min(96, rawPct));


    const color = PLAYER_COLOR.get(name) || "#4366BB";
    const rgb = hexToRgbTriplet(color) || "67, 102, 187";

const classes = [
  "ladder-marker",
  isInit ? "is-init" : "",
  (name === leader ? "is-leader" : ""),
  (r.__isMe ? "is-me" : "")
].filter(Boolean).join(" ");


    // initiales = ton format actuel (HB, JCP…)
    const label = name;

    return `
      <div
        class="${classes}"
        style="--player-color:${color}; --player-rgb:${rgb}; left:${pct}%"
        title="${name} · ${count}/${total}${name === leader ? " (Leader)" : ""}"
      >
        <span class="marker-dot"></span>
        <span class="marker-label">${label}</span>
      </div>
    `;
  }).join("");

  host.innerHTML = `
    <div class="ladder-head">
      <div class="ladder-title">Classement live</div>
    </div>

    <div class="ladder-track" role="img" aria-label="Progression des joueurs">
      <div class="ladder-track-fill" style="width:${total ? (Math.max(...rows.map(r => (r.found_count ?? 0))) / total) * 100 : 0}%"></div>
      <div class="ladder-tick is-0">0</div>
      <div class="ladder-tick is-max">${total}</div>
      ${markersHtml}
    </div>
  `;
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

  if (resetBtn) {
  resetBtn.addEventListener("click", resetQuizForEveryone);
}

if (statsBtn) {
  statsBtn.addEventListener("click", async () => {
    showScreen("stats");
    await updateQuizResultsFromPresence();
    await fetchAndRenderQuizRanking();
    await fetchAndRenderGlobalRanking();
  });
}

if (backToGameBtn) {
  backToGameBtn.addEventListener("click", () => showScreen("game"));
}

if (listEl) {
  listEl.addEventListener("click", (e) => {
    if (!quiz || !quiz.items) return;

    const li = e.target.closest("li");
    if (!li) return;

    const idx = Array.prototype.indexOf.call(listEl.children, li);
    if (idx < 0) return;

    const item = quiz.items[idx];
    if (!item) return;

    // si déjà trouvé : on peut (optionnel) afficher les indices déjà débloqués
    const alreadyFound = found.has(item.answer);

    const hints = item.hints || [];
    if (hints.length === 0) return;

const used = hintsUsedByAnswer[item.answer] || 0;

// Débloque un nouvel indice
if (!alreadyFound && used < hints.length) {
  const newUsed = used + 1;
  hintsUsedByAnswer[item.answer] = newUsed;

  // coût progressif : 1er indice = -1, 2e = -2, etc.
  const penalty = newUsed;
  hintsUsedTotal += 1;
  hintsCostTotal += penalty;

  saveProgress();
  ensurePresenceRow();

  showToast(`💡 (-${penalty} pt) ${hints[newUsed - 1]}`);
  renderList();
  return;
}


    // Sinon : revoir à volonté (gratuit) -> on montre le dernier débloqué
    const toShowIndex = Math.max(0, Math.min(used, hints.length) - 1);
    if (used > 0) {
      showToast(`💡 Indice : ${hints[toShowIndex]}`);
    } else {
      // Aucun indice débloqué mais item déjà trouvé (ou autre cas)
      showToast("💡 Aucun indice débloqué pour cet item.");
    }
  });
}


  // ====== Boot ======
  runSplashIntro();

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
