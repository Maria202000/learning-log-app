const IDLE_THRESHOLD_MS = 10000;
const TASK_TYPE = "quantity_more_endurance";
const MAX_QUESTIONS = 1000;
const CHOICE_COUNTS = [2, 4, 6];
const LOG_HEADERS = [
  "received_at",
  "session_id",
  "participant_id",
  "question_index",
  "task_id",
  "block_name",
  "difficulty",
  "event_type",
  "shown_at",
  "event_at",
  "response_time_ms",
  "is_correct",
  "idle_detected",
  "idle_count",
  "idle_total_ms",
  "rest_requested",
  "rest_duration_ms",
  "timer_visible",
  "note",
  "task_type",
  "sequence_phase",
  "target_value",
  "choice_value",
  "choice_count"
];

let sessionId = "";
let participantId = "P001";
let serverLoggingAvailable = null;
let sessionLogs = [];
let sessionBackupKey = "";
let collectorUrl = "";
let cloudCollectionFailed = false;
const pendingCloudPosts = new Set();
let timerVisible = true;
let restSeconds = 10;
let choiceCount = 2;
let choiceCountQueue = [];
let sessionStart = 0;
let sessionRestMs = 0;
let questionStart = 0;
let questionRestMs = 0;
let lastActionAt = 0;
let idleStart = null;
let idleCount = 0;
let idleStoredMs = 0;
let answeredCount = 0;
let correctCount = 0;
let questionIndex = 0;
let currentTask = null;
let isResting = false;
let isLocked = false;
let isFinished = false;
let timer = null;

const startScreen = document.getElementById("startScreen");
const workspace = document.getElementById("workspace");
const doneScreen = document.getElementById("doneScreen");
const participantInput = document.getElementById("participantInput");
const restSecondsInput = document.getElementById("restSecondsInput");
const timerToggle = document.getElementById("timerToggle");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const choices = document.getElementById("choices");
const restBtn = document.getElementById("restBtn");
const endBtn = document.getElementById("endBtn");
const restOverlay = document.getElementById("restOverlay");
const restCount = document.getElementById("restCount");
const answeredText = document.getElementById("answeredText");
const timeText = document.getElementById("timeText");
const timerMetric = document.getElementById("timerMetric");
const doneAnsweredText = document.getElementById("doneAnsweredText");
const doneTimeText = document.getElementById("doneTimeText");
const doneNoteText = document.getElementById("doneNoteText");
const downloadCsvBtn = document.getElementById("downloadCsvBtn");

function formatSeconds(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

function createLocalSessionId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const random = Math.random().toString(16).slice(2, 8);
  return `LOCAL-${timestamp}-${random}`;
}

function csvCell(value) {
  if (value === undefined || value === null) return "";
  return `"${String(value).replaceAll('"', '""')}"`;
}

function logsToCsv(logs) {
  const rows = [
    LOG_HEADERS.join(","),
    ...logs.map((log) => LOG_HEADERS.map((header) => csvCell(log[header])).join(","))
  ];
  return `\uFEFF${rows.join("\n")}\n`;
}

function safeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 40) || "participant";
}

function makeCsvFilename() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `learning-log_${safeFilePart(participantId)}_${timestamp}.csv`;
}

function backupLocalLogs() {
  if (!sessionBackupKey) return;
  try {
    localStorage.setItem(sessionBackupKey, JSON.stringify(sessionLogs));
  } catch (error) {
    console.warn("local backup failed", error);
  }
}

function downloadCsv() {
  if (sessionLogs.length === 0) {
    alert("保存できるログがまだありません。");
    return;
  }

  const blob = new Blob([logsToCsv(sessionLogs)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = makeCsvFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  if (doneNoteText) {
    doneNoteText.textContent =
      "CSVを保存しました。通常は端末の「ダウンロード」に保存されています。研究者に渡してください。";
  }
}

function getCollectorUrl() {
  const value = window.LEARNING_LOG_COLLECTOR_URL || "";
  return String(value).trim();
}

function cloudPayload(type, data) {
  return {
    type,
    sent_at: new Date().toISOString(),
    app_version: "endurance-github-pages-1",
    data
  };
}

async function postToCollector(type, data) {
  if (!collectorUrl) return false;

  try {
    await fetch(collectorUrl, {
      method: "POST",
      mode: "no-cors",
      cache: "no-store",
      headers: {
        "content-type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(cloudPayload(type, data)),
      keepalive: true
    });
    return true;
  } catch (error) {
    console.warn("cloud collection failed; CSV backup remains available", error);
    return false;
  }
}

function queueCloudPost(type, data) {
  const pendingPost = postToCollector(type, data)
    .then((delivered) => {
      if (!delivered) cloudCollectionFailed = true;
      return delivered;
    })
    .catch((error) => {
      cloudCollectionFailed = true;
      console.warn("cloud collection failed; CSV backup remains available", error);
      return false;
    })
    .finally(() => {
      pendingCloudPosts.delete(pendingPost);
    });

  pendingCloudPosts.add(pendingPost);
  return pendingPost;
}

function activeSessionElapsed(now = Date.now()) {
  return Math.max(0, now - sessionStart - sessionRestMs);
}

function activeQuestionElapsed(now = Date.now()) {
  return Math.max(0, now - questionStart - questionRestMs);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(items) {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [list[index], list[swapIndex]] = [list[swapIndex], list[index]];
  }
  return list;
}

function nextChoiceCount() {
  if (choiceCountQueue.length === 0) {
    choiceCountQueue = shuffle(CHOICE_COUNTS);
  }
  return choiceCountQueue.shift();
}

function makeTask() {
  questionIndex += 1;
  choiceCount = nextChoiceCount();
  const counts = shuffle([2, 3, 4, 5, 6, 7, 8, 9]).slice(0, choiceCount);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const targetIndex = counts.indexOf(maxCount);
  const options = counts.map((count, index) => ({
    key: `choice_${index + 1}`,
    label: String(index + 1),
    count
  }));

  return {
    id: `QM${String(questionIndex).padStart(4, "0")}`,
    options,
    counts,
    difference: maxCount - minCount,
    targetKey: options[targetIndex].key,
    targetValue: options[targetIndex].label,
    difficulty: `choice_${choiceCount}_range_${maxCount - minCount}`
  };
}

function dotBoard(count) {
  const board = document.createElement("span");
  board.className = "dot-board";
  const filledIndexes = new Set(shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, count));

  for (let index = 0; index < 9; index += 1) {
    const cell = document.createElement("span");
    cell.className = "dot-cell";
    if (filledIndexes.has(index)) {
      const dot = document.createElement("span");
      dot.className = "dot";
      cell.appendChild(dot);
    }
    board.appendChild(cell);
  }

  return board;
}

function renderChoice(option) {
  const button = document.createElement("button");
  button.className = "choice";
  button.type = "button";
  button.setAttribute("aria-label", `${option.label}番`);
  button.appendChild(dotBoard(option.count));

  const label = document.createElement("span");
  label.className = "choice-label";
  label.innerHTML = `${option.label}<ruby>番<rt>ばん</rt></ruby>`;
  button.appendChild(label);

  button.addEventListener("click", () => answer(option.key));
  return button;
}

function renderTask() {
  currentTask = makeTask();
  questionStart = Date.now();
  questionRestMs = 0;
  lastActionAt = questionStart;
  idleStart = null;
  idleCount = 0;
  idleStoredMs = 0;
  isLocked = false;

  choices.innerHTML = "";
  choices.dataset.count = String(choiceCount);
  currentTask.options.forEach((option) => {
    choices.appendChild(renderChoice(option));
  });
}

async function postJson(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function shouldTryServerApi() {
  const host = window.location.hostname;
  return host === "localhost"
    || host === "127.0.0.1"
    || host.startsWith("192.168.")
    || host.startsWith("10.")
    || host.startsWith("172.16.")
    || host.startsWith("172.17.")
    || host.startsWith("172.18.")
    || host.startsWith("172.19.")
    || host.startsWith("172.2")
    || host.startsWith("172.30.")
    || host.startsWith("172.31.");
}

async function createSession() {
  const payload = {
    participant_id: participantId,
    timer_visible: timerVisible,
    rest_seconds: restSeconds,
    time_limit: "none"
  };

  if (shouldTryServerApi() && serverLoggingAvailable !== false) {
    try {
      const result = await postJson("/api/session", payload);
      serverLoggingAvailable = true;
      return result.session_id;
    } catch (error) {
      console.warn("server session failed, using local CSV mode", error);
      serverLoggingAvailable = false;
    }
  }

  serverLoggingAvailable = false;
  return createLocalSessionId();
}

function resetIdleClock() {
  const now = Date.now();
  if (idleStart !== null) {
    idleStoredMs += Math.max(0, now - idleStart);
    idleStart = null;
  }
  lastActionAt = now;
}

function currentIdleTotal(now = Date.now()) {
  return idleStoredMs + (idleStart !== null ? Math.max(0, now - idleStart) : 0);
}

function buildLog(eventType, choiceKey = "", extra = {}) {
  const now = Date.now();
  const isAnswer = eventType === "answer";
  const isCorrect = isAnswer && choiceKey === currentTask.targetKey;
  const chosenOption = currentTask.options.find((option) => option.key === choiceKey);
  const countSummary = currentTask.options
    .map((option) => `${option.key}=${option.count}`)
    .join("|");
  const noteParts = [
    `counts=${countSummary}`,
    `correct_choice=${currentTask.targetKey}`,
    `correct_count=${currentTask.options.find((option) => option.key === currentTask.targetKey).count}`,
    `difference=${currentTask.difference}`,
    `max_questions=${MAX_QUESTIONS}`,
    `choice_count=${choiceCount}`,
    `session_elapsed_ms=${Math.round(activeSessionElapsed(now))}`,
    `session_rest_ms=${Math.round(sessionRestMs)}`,
    "time_limit=none",
    "active_time_excludes_rest=true",
    "skip_button_removed=true"
  ];

  if (extra.note) noteParts.push(extra.note);
  if (eventType === "end" || eventType === "max_questions") {
    noteParts.push(`total_answered=${answeredCount}`, `total_correct=${correctCount}`);
  }

  return {
    session_id: sessionId,
    participant_id: participantId,
    question_index: questionIndex,
    task_id: currentTask.id,
    block_name: "quantity_endurance",
    difficulty: currentTask.difficulty,
    event_type: eventType,
    shown_at: new Date(questionStart).toISOString(),
    event_at: new Date(now).toISOString(),
    response_time_ms: Math.round(activeQuestionElapsed(now)),
    is_correct: isCorrect,
    idle_detected: idleCount > 0,
    idle_count: idleCount,
    idle_total_ms: Math.round(currentIdleTotal(now)),
    rest_requested: eventType === "rest",
    rest_duration_ms: extra.rest_duration_ms || 0,
    timer_visible: timerVisible,
    note: noteParts.join("; "),
    task_type: TASK_TYPE,
    sequence_phase: "endurance",
    target_value: `${countSummary}|correct=${currentTask.targetKey}`,
    choice_value: chosenOption ? `${choiceKey}=${chosenOption.count}` : choiceKey,
    choice_count: choiceCount
  };
}

async function saveLog(log, options = {}) {
  const localLog = {
    ...log,
    received_at: new Date().toISOString()
  };
  sessionLogs.push(localLog);
  backupLocalLogs();
  if (downloadCsvBtn) {
    downloadCsvBtn.disabled = sessionLogs.length === 0;
  }

  const cloudPost = queueCloudPost("log", localLog);

  if (serverLoggingAvailable === false) {
    return options.waitForCloud ? cloudPost : true;
  }

  try {
    await postJson("/api/logs", log);
  } catch (error) {
    serverLoggingAvailable = false;
    console.warn("server log failed, local CSV mode continues", error);
  }
  return options.waitForCloud ? cloudPost : true;
}

function tick() {
  if (!sessionId || isResting || isFinished) return;

  const now = Date.now();
  const elapsed = activeSessionElapsed(now);
  timeText.textContent = formatSeconds(elapsed);

  if (idleStart === null && now - lastActionAt >= IDLE_THRESHOLD_MS) {
    idleStart = lastActionAt + IDLE_THRESHOLD_MS;
    idleCount += 1;
  }
}

async function answer(choiceKey) {
  if (isResting || isLocked || isFinished) return;

  isLocked = true;
  resetIdleClock();
  const log = buildLog("answer", choiceKey);
  answeredCount += 1;
  if (log.is_correct) correctCount += 1;
  answeredText.textContent = answeredCount;
  await saveLog(log);

  window.setTimeout(() => {
    if (isFinished) return;
    if (answeredCount >= MAX_QUESTIONS) {
      finish("max_questions");
      return;
    }
    renderTask();
  }, 250);
}

async function restTask() {
  if (isResting || isLocked || isFinished) return;

  resetIdleClock();
  await saveLog(buildLog("rest", "", {
    rest_duration_ms: restSeconds * 1000,
    note: "rest_requested"
  }));

  isResting = true;
  restBtn.disabled = true;
  endBtn.disabled = true;
  restOverlay.classList.add("show");
  let remaining = restSeconds;
  restCount.textContent = formatSeconds(remaining * 1000);
  const restTimer = window.setInterval(() => {
    remaining -= 1;
    restCount.textContent = formatSeconds(remaining * 1000);
    if (remaining <= 0) {
      window.clearInterval(restTimer);
      const restMs = restSeconds * 1000;
      sessionRestMs += restMs;
      questionRestMs += restMs;
      isResting = false;
      restBtn.disabled = false;
      endBtn.disabled = false;
      restOverlay.classList.remove("show");
      resetIdleClock();
    }
  }, 1000);
}

async function finish(reason) {
  if (isFinished) return;

  isFinished = true;
  window.clearInterval(timer);
  timer = null;

  let endDelivered = false;
  if (sessionId && currentTask) {
    const eventType = reason === "max_questions" ? "max_questions" : "end";
    endDelivered = await saveLog(
      buildLog(eventType, "", { note: `reason=${reason}` }),
      { waitForCloud: true }
    );
  }
  await Promise.allSettled(Array.from(pendingCloudPosts));

  doneAnsweredText.textContent = answeredCount;
  doneTimeText.textContent = formatSeconds(activeSessionElapsed());
  const automaticCollectionSucceeded =
    Boolean(collectorUrl) && endDelivered && !cloudCollectionFailed;
  if (doneNoteText) {
    doneNoteText.textContent = automaticCollectionSucceeded
      ? "データを送信しました。CSVの保存は必要ありません。"
      : "データを自動送信できませんでした。CSVを保存して、研究者に渡してください。";
  }
  if (downloadCsvBtn) {
    downloadCsvBtn.hidden = automaticCollectionSucceeded;
    downloadCsvBtn.disabled = sessionLogs.length === 0;
  }
  workspace.classList.remove("active");
  doneScreen.classList.add("active");
}

async function start() {
  participantId = participantInput.value.trim() || "P001";
  restSeconds = Number(restSecondsInput.value) || 10;
  timerVisible = timerToggle.checked;
  collectorUrl = getCollectorUrl();

  sessionId = await createSession();
  sessionLogs = [];
  sessionBackupKey = `learning-log-${sessionId}`;
  sessionStart = Date.now();
  sessionRestMs = 0;
  questionIndex = 0;
  choiceCountQueue = [];
  answeredCount = 0;
  correctCount = 0;
  isResting = false;
  isLocked = false;
  isFinished = false;
  cloudCollectionFailed = false;
  pendingCloudPosts.clear();
  answeredText.textContent = "0";
  timeText.textContent = "0秒";
  timerMetric.style.display = timerVisible ? "grid" : "none";
  if (downloadCsvBtn) {
    downloadCsvBtn.hidden = true;
    downloadCsvBtn.disabled = true;
  }

  queueCloudPost("session", {
    created_at: new Date(sessionStart).toISOString(),
    session_id: sessionId,
    participant_id: participantId,
    timer_visible: timerVisible,
    rest_seconds: restSeconds,
    max_questions: MAX_QUESTIONS,
    time_limit: "none",
    task_type: TASK_TYPE,
    user_agent: navigator.userAgent,
  });

  startScreen.style.display = "none";
  doneScreen.classList.remove("active");
  workspace.classList.add("active");
  renderTask();
  timer = window.setInterval(tick, 250);
}

startBtn.addEventListener("click", () => {
  start().catch((error) => {
    console.error(error);
    alert("始められませんでした。サーバが動いているか確認してください。");
  });
});

restBtn.addEventListener("click", restTask);
endBtn.addEventListener("click", () => finish("end_button"));
downloadCsvBtn.addEventListener("click", downloadCsv);
restartBtn.addEventListener("click", () => {
  doneScreen.classList.remove("active");
  startScreen.style.display = "grid";
});
