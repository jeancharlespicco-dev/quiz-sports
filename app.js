const input = document.getElementById("answer-input");
const titleEl = document.getElementById("quiz-title");
const promptEl = document.getElementById("quiz-prompt");
const progressEl = document.getElementById("progress");
const listEl = document.getElementById("answers-list");

let quiz = null;
let found = new Set();

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

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

  quiz.items.forEach(item => {
    if (found.has(item.answer)) return;

    const allAnswers = [
      item.answer,
      ...(item.aliases || [])
    ];

    const match = allAnswers.some(a => normalize(a) === normalized);

    if (match) {
      found.add(item.answer);
      input.value = "";
      updateUI();
      renderList();
    }
  });
}

async function loadQuiz() {
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(`quizzes/${today}.json`);
  quiz = await res.json();

  titleEl.textContent = quiz.title;
  promptEl.textContent = quiz.prompt;

  updateUI();
  renderList();
}

input.addEventListener("input", e => {
  if (!quiz) return;
  checkAnswer(e.target.value);
});

loadQuiz();
