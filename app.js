(() => {
  "use strict";

  // ====== Config joueurs (tu modifies ici) ======
  const PLAYERS = [
    { name: "HB", color: "#22C55E" }, 
    { name: "JCP", color: "#4366BB" }, 
    { name: "LBL", color: "#EEA825" }, 
    { name: "MC", color: "#B68489" },  
    { name: "AM", color: "#0F172A" },  
    { name: "NG", color: "#15803D" },  
    { name: "TSP", color: "#73AFB9" },  
    { name: "XL", color: "#DB9411" },  
  ];
  
const PLAYER_COLOR = new Map(PLAYERS.map(p => [p.name, p.color]));
const ALLOWED_PLAYERS = new Set(PLAYERS.map(p => p.name));


  // ====== Supabase (à remplir) ======
  const SUPABASE_URL = "https://fsuyhrzllhfeomvdbfcp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzdXlocnpsbGhmZW9tdmRiZmNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MTcwOTUsImV4cCI6MjA5OTA5MzA5NX0.TmPZff6fCdhG1hWJA3Fc0kLTsi7wRwxj_lkp9SkiIOg";

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
const screenHome    = document.getElementById("screen-home");
const screenProfile = document.getElementById("screen-profile");
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
  const lastLadderCount = {}; // player_name -> last found_count
  let realtimeChannel = null;

const lastFoundCount = {}; // player_name -> number


  // ====== State ======
    let quiz = null;
  let found = new Set();
  let currentPlayer = null;


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
  if (screenHome)    screenHome.classList.add("hidden");
  if (screenPlayer)  screenPlayer.classList.add("hidden");
  if (screenGame)    screenGame.classList.add("hidden");
  if (screenStats)   screenStats.classList.add("hidden");
  if (screenProfile) screenProfile.classList.add("hidden");

  if (which === "home")    screenHome?.classList.remove("hidden");
  if (which === "player")  screenPlayer?.classList.remove("hidden");
  if (which === "game")    screenGame?.classList.remove("hidden");
  if (which === "stats")   screenStats?.classList.remove("hidden");
  if (which === "profile") screenProfile?.classList.remove("hidden");
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
    if (!supabase) throw new Error("Supabase non initialisé");

    const { data, error } = await supabase
      .from("quizzes")
      .select("id, slug, title, prompt, items")
      .eq("status", "current")
      .maybeSingle();

    if (error) throw new Error("Erreur Supabase : " + error.message);
    if (!data) throw new Error("Aucun quiz avec status='current' trouvé");

    if (!data.items || !Array.isArray(data.items)) {
      throw new Error("Quiz invalide (clé items manquante)");
    }

    quiz = { ...data, id: data.slug };

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
    promptEl.textContent = "Impossible de charger le quiz depuis la base de données.";
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
    .select("player_name, finished_at")
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
  const finalPoints = rankPoints;


  return {
    quiz_id: quizId,
    player_name: r.player_name,
    finished_at: r.finished_at,
    rank,
    rank_points: rankPoints,
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

  if (!currentPlayer) {
    host.innerHTML = "";
    return;
  }

  // Masque la grille des autres joueurs (redondante avec le ladder)
  if (othersEl) othersEl.style.display = "none";

  const total = quiz.items.length;
  const rows = getActiveRowsForLadder();

  // tri
  rows.sort((a, b) => (b.found_count ?? 0) - (a.found_count ?? 0));

  const leader = rows[0]?.player_name || null;

  // 1) Squelette: créé une seule fois
  if (!host.dataset.ready) {
    host.innerHTML = `
      <div class="ladder-head">
        <div class="ladder-title">Classement live</div>
      </div>

      <div class="ladder-track" role="img" aria-label="Progression des joueurs">
        <div class="ladder-track-fill"></div>
        <div class="ladder-tick is-0">0</div>
        <div class="ladder-tick is-max"></div>
        <div class="ladder-markers"></div>
      </div>
    `;
    host.dataset.ready = "1";
  }

  if (!host.dataset.revealed) {
  host.classList.remove("ladder-enter");
  void host.offsetWidth; // rejoue l'anim proprement
  host.classList.add("ladder-enter");
  host.dataset.revealed = "1";
}


  const fill = host.querySelector(".ladder-track-fill");
  const tickMax = host.querySelector(".ladder-tick.is-max");
  const wrap = host.querySelector(".ladder-markers");
  if (!wrap) return;

  if (tickMax) tickMax.textContent = String(total);

  // Fill = position du meilleur (très subtil)
  const maxFound = rows.length ? Math.max(...rows.map(r => (r.found_count ?? 0))) : 0;
  if (maxFound === 0 && (found?.size ?? 0) === 0) {
  host.innerHTML = "";
  host.dataset.ready = "";
  host.dataset.revealed = "";
  return;
}
  const fillPct = total ? (maxFound / total) * 100 : 0;
  if (fill) fill.style.width = `${fillPct}%`;

  // 2) Index des markers existants (pour réutiliser le DOM)
  const existing = new Map(
    Array.from(wrap.children).map(el => [el.dataset.player, el])
  );

  // 3) Crée / met à jour les markers
for (const r of rows) {
  const name = r.player_name;
  const count = Math.max(0, Math.min(total, r.found_count ?? 0));

  // progression (pour bump + rail pulse)
  const prev = lastLadderCount[name] ?? count;
  const progressed = count > prev;
  lastLadderCount[name] = count;

  const rawPct = total > 0 ? (count / total) * 100 : 0;
  const pct = Math.max(4, Math.min(96, rawPct));

  const color = PLAYER_COLOR.get(name) || "#4366BB";
  const rgb = hexToRgbTriplet(color) || "67, 102, 187";

  // rail pulse seulement pour moi
  if (progressed && r.__isMe) {
    const track = host.querySelector(".ladder-track");
    if (track) {
      track.style.setProperty("--me-rgb", rgb);
      track.classList.remove("is-me-pulse");
      void track.offsetWidth;
      track.classList.add("is-me-pulse");
      setTimeout(() => track.classList.remove("is-me-pulse"), 260);
    }
  }

  let el = existing.get(name);

  if (!el) {
    el = document.createElement("div");
    el.className = "ladder-marker";
    el.dataset.player = name;
    el.innerHTML = `
      <span class="marker-dot"></span>
      <span class="marker-label"></span>
    `;
    wrap.appendChild(el);
  }

  el.classList.toggle("is-leader", name === leader);
  el.classList.toggle("is-me", !!r.__isMe);

  el.style.setProperty("--player-color", color);
  el.style.setProperty("--player-rgb", rgb);
  el.style.left = `${pct}%`;

  const labelEl = el.querySelector(".marker-label");
  if (labelEl) labelEl.textContent = name;

  el.title = `${name} · ${count}/${total}${name === leader ? " (Leader)" : ""}`;

  // bump sur progression (si tu veux)
  if (progressed) {
    el.classList.remove("is-bumped");
    void el.offsetWidth;
    el.classList.add("is-bumped");
    setTimeout(() => el.classList.remove("is-bumped"), 260);
  }

  existing.delete(name);
}


  // 4) Supprime ceux qui ne sont plus affichés
  for (const el of existing.values()) el.remove();
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
  });
}


  // ====== Home screen ======
  function renderHome() {
    const titleEl2  = document.getElementById("home-quiz-title");
    const promptEl2 = document.getElementById("home-quiz-prompt");
    const metaEl    = document.getElementById("home-quiz-meta");
    const hintEl    = document.getElementById("home-player-hint");
    const playLabel = document.getElementById("home-play-label");
    const changeBtn = document.getElementById("home-change-btn");

    // Infos du quiz (quiz est déjà chargé par loadQuiz)
    if (quiz) {
      if (titleEl2)  titleEl2.textContent  = quiz.title  || "Quiz en cours";
      if (promptEl2) promptEl2.textContent = quiz.prompt || "";
      const count = Array.isArray(quiz.items) ? quiz.items.length : 0;
      if (metaEl) metaEl.textContent = `${count} réponse${count > 1 ? "s" : ""} à trouver`;
    } else {
      if (titleEl2)  titleEl2.textContent  = "Aucun quiz en cours";
      if (promptEl2) promptEl2.textContent = "";
      if (metaEl)    metaEl.textContent    = "";
    }

    // Personnalise selon si le joueur est déjà connu
    const saved  = localStorage.getItem("dq_player");
    const exists = PLAYERS.some(p => p.name === saved);
    if (saved && exists) {
      if (playLabel) playLabel.textContent = `Jouer en tant que ${saved}`;
      if (hintEl)    hintEl.textContent    = `Connecté en tant que ${saved}`;
      if (changeBtn) changeBtn.style.display = "inline-flex";
    } else {
      if (playLabel) playLabel.textContent = "Jouer";
      if (hintEl)    hintEl.textContent    = "Tu seras invité à choisir ton nom";
      if (changeBtn) changeBtn.style.display = "none";
    }
  }

  async function initHome() {
    // loadQuiz() est lancé en parallèle au boot — on attend qu'il soit fini
    // puis on affiche les infos
    renderHome();
  }

  // Bouton Jouer
  const homePlayBtn = document.getElementById("home-play-btn");
  if (homePlayBtn) {
    homePlayBtn.addEventListener("click", () => {
      const saved = localStorage.getItem("dq_player");
      const savedColor = localStorage.getItem("dq_player_color") || "";
      const exists = PLAYERS.some(p => p.name === saved);
      if (saved && exists) {
        selectPlayer(saved, savedColor);
      } else {
        showScreen("player");
      }
    });
  }

  // Bouton Classement depuis la Home
  const homeStatsBtn = document.getElementById("home-stats-btn");
  if (homeStatsBtn) {
    homeStatsBtn.addEventListener("click", async () => {
      // Charger le quiz si pas encore chargé (pour les stats)
      if (!quiz && supabase) await loadQuiz();
      showScreen("stats");
      await updateQuizResultsFromPresence();
      await fetchAndRenderQuizRanking();
      await fetchAndRenderGlobalRanking();
    });
  }

  // Bouton "Changer de joueur" ramène à la Home
  // (on surcharge le clearPlayer existant)
  const _origClearPlayer = clearPlayer;

  // ====== Profil ======
  let profilePlayer = null; // joueur affiché dans le profil

  async function showProfile(playerName) {
    profilePlayer = playerName || currentPlayer || PLAYERS[0]?.name;
    showScreen("profile");
    renderProfileSelector();
    await loadProfileData(profilePlayer);
  }

  function renderProfileSelector() {
    const el = document.getElementById("profile-player-selector");
    if (!el) return;
    el.innerHTML = "";
    PLAYERS.forEach(p => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "profile-player-btn" + (p.name === profilePlayer ? " is-active" : "");
      btn.style.setProperty("--player-color", p.color || "#4366BB");
      btn.innerHTML = `<span class="dot"></span><span>${p.name}</span>`;
      btn.addEventListener("click", async () => {
        profilePlayer = p.name;
        renderProfileSelector();
        await loadProfileData(p.name);
      });
      el.appendChild(btn);
    });
  }

  async function loadProfileData(playerName) {
    // Reset
    ["prof-points", "prof-played", "prof-wins", "prof-best"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = "…";
    });
    const histEl = document.getElementById("profile-history");
    if (histEl) histEl.innerHTML = '<div class="profile-history-empty">Chargement…</div>';

    if (!supabase) return;

    // Stats globales depuis v_player_stats
    const { data: stats } = await supabase
      .from("v_player_stats")
      .select("total_points, wins, quizzes_finished")
      .eq("player_name", playerName)
      .maybeSingle();

    const pointsEl = document.getElementById("prof-points");
    const playedEl = document.getElementById("prof-played");
    const winsEl   = document.getElementById("prof-wins");

    if (stats) {
      if (pointsEl) pointsEl.textContent = stats.total_points ?? 0;
      if (playedEl) playedEl.textContent = stats.quizzes_finished ?? 0;
      if (winsEl)   winsEl.textContent   = stats.wins ?? 0;
    } else {
      if (pointsEl) pointsEl.textContent = "0";
      if (playedEl) playedEl.textContent = "0";
      if (winsEl)   winsEl.textContent   = "0";
    }

    // Meilleur rang depuis quiz_results
    const { data: results } = await supabase
      .from("quiz_results")
      .select("quiz_id, rank, points, finished_at")
      .eq("player_name", playerName)
      .order("finished_at", { ascending: false })
      .limit(10);

    const bestEl = document.getElementById("prof-best");
    if (results && results.length > 0) {
      const bestRank = Math.min(...results.map(r => r.rank));
      if (bestEl) bestEl.textContent = `#${bestRank}`;
    } else {
      if (bestEl) bestEl.textContent = "—";
    }

    // Historique récent
    if (histEl) {
      if (!results || results.length === 0) {
        histEl.innerHTML = '<div class="profile-history-empty">Aucun quiz terminé pour l\'instant.</div>';
        return;
      }

      // Récupérer les titres des quiz correspondants
      const quizIds = [...new Set(results.map(r => r.quiz_id))];
      const { data: quizzesData } = await supabase
        .from("quizzes")
        .select("slug, title")
        .in("slug", quizIds);

      const titleMap = {};
      (quizzesData || []).forEach(q => { titleMap[q.slug] = q.title; });

      histEl.innerHTML = "";
      results.forEach(r => {
        const row = document.createElement("div");
        row.className = "profile-history-row";
        const date = r.finished_at
          ? new Date(r.finished_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
          : "—";
        const title = titleMap[r.quiz_id] || r.quiz_id;
        row.innerHTML = `
          <div class="profile-history-info">
            <div class="profile-history-title">${title}</div>
            <div class="profile-history-date">${date}</div>
          </div>
          <div class="profile-history-right">
            <span class="profile-rank">#${r.rank}</span>
            <span class="profile-pts">+${r.points} pts</span>
          </div>
        `;
        histEl.appendChild(row);
      });
    }
  }

  // Bouton Profil sur la Home
  const homeProfileBtn = document.getElementById("home-profile-btn");
  if (homeProfileBtn) {
    homeProfileBtn.addEventListener("click", () => showProfile(currentPlayer));
  }

  // Retour depuis le profil
  const backFromProfileBtn = document.getElementById("back-from-profile-btn");
  if (backFromProfileBtn) {
    backFromProfileBtn.addEventListener("click", () => showScreen("home"));
  }

  // Bouton "Changer de joueur" sur la Home
  const homeChangeBtn = document.getElementById("home-change-btn");
  if (homeChangeBtn) {
    homeChangeBtn.addEventListener("click", () => {
      localStorage.removeItem("dq_player");
      localStorage.removeItem("dq_player_color");
      showScreen("player");
    });
  }

  // ====== Boot ======
  runSplashIntro();
  renderPlayers();
  showScreen("home");

  // Charge le quiz puis met à jour la Home
  loadQuiz().then(() => renderHome());
})();
