const APP_VERSION = "observer-github-pages-1";
const EVENT_HEADERS = [
  "received_at",
  "event_id",
  "observer_session_id",
  "participant_id",
  "observer_id",
  "experiment_run",
  "event_at",
  "elapsed_ms",
  "question_index",
  "event_type",
  "event_label",
  "note",
  "target_event_id",
  "app_version",
  "page_url"
];

let observerSessionId = "";
let participantId = "";
let observerId = "";
let experimentRun = 1;
let startedAt = 0;
let timer = null;
let events = [];
let backupKey = "";

const collectorUrl = String(window.LEARNING_LOG_COLLECTOR_URL || "").trim();
const startScreen = document.getElementById("startScreen");
const recordScreen = document.getElementById("recordScreen");
const doneScreen = document.getElementById("doneScreen");
const stateBadge = document.getElementById("stateBadge");
const participantInput = document.getElementById("participantInput");
const observerInput = document.getElementById("observerInput");
const runInput = document.getElementById("runInput");
const participantText = document.getElementById("participantText");
const elapsedText = document.getElementById("elapsedText");
const eventCountText = document.getElementById("eventCountText");
const questionInput = document.getElementById("questionInput");
const noteInput = document.getElementById("noteInput");
const sendStatus = document.getElementById("sendStatus");
const recentList = document.getElementById("recentList");
const undoBtn = document.getElementById("undoBtn");
const doneEventCount = document.getElementById("doneEventCount");
const doneElapsed = document.getElementById("doneElapsed");

function makeId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  const random = Math.random().toString(16).slice(2, 8);
  return `${prefix}-${stamp}-${random}`;
}

function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatClock(iso) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function validEvents() {
  return events.filter((item) => item.event_type !== "void" && item.event_type !== "observer_end" && !item.voided);
}

function backupEvents() {
  if (!backupKey) return;
  try {
    localStorage.setItem(backupKey, JSON.stringify(events));
  } catch (error) {
    console.warn("observer backup failed", error);
  }
}

async function postToCollector(type, data) {
  if (!collectorUrl) throw new Error("自動回収URLが設定されていません");
  await fetch(collectorUrl, {
    method: "POST",
    mode: "no-cors",
    cache: "no-store",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      type,
      sent_at: new Date().toISOString(),
      app_version: APP_VERSION,
      data
    }),
    keepalive: true
  });
}

function setSendStatus(message, isError = false) {
  sendStatus.textContent = message;
  sendStatus.classList.toggle("error", isError);
}

function renderRecent() {
  const recent = events
    .filter((item) => item.event_type !== "void" && item.event_type !== "observer_end")
    .slice(-5)
    .reverse();

  if (recent.length === 0) {
    recentList.innerHTML = '<p class="empty">まだ記録はありません。</p>';
  } else {
    recentList.innerHTML = "";
    recent.forEach((item) => {
      const row = document.createElement("div");
      row.className = `recent-item${item.voided ? " voided" : ""}`;
      const time = document.createElement("time");
      time.textContent = formatClock(item.event_at);
      const description = document.createElement("span");
      const question = item.question_index ? `・${item.question_index}問目` : "";
      description.textContent = `${item.event_label}${question}${item.note ? `・${item.note}` : ""}`;
      row.append(time, description);
      recentList.appendChild(row);
    });
  }

  eventCountText.textContent = String(validEvents().length);
  undoBtn.disabled = validEvents().length === 0;
}

function buildEvent(eventType, eventLabel, options = {}) {
  const now = Date.now();
  const questionValue = questionInput.value.trim();
  return {
    received_at: new Date(now).toISOString(),
    event_id: makeId("OE"),
    observer_session_id: observerSessionId,
    participant_id: participantId,
    observer_id: observerId,
    experiment_run: experimentRun,
    event_at: new Date(now).toISOString(),
    elapsed_ms: Math.max(0, now - startedAt),
    question_index: questionValue ? Number(questionValue) : "",
    event_type: eventType,
    event_label: eventLabel,
    note: options.note !== undefined ? options.note : noteInput.value.trim(),
    target_event_id: options.targetEventId || "",
    app_version: APP_VERSION,
    page_url: location.href,
    voided: false,
    delivery: "pending"
  };
}

function queueEvent(event) {
  events.push(event);
  backupEvents();
  renderRecent();
  setSendStatus(`${event.event_label}：送信中`);

  postToCollector("observer_event", event)
    .then(() => {
      event.delivery = "sent";
      backupEvents();
      setSendStatus(`${event.event_label}：送信処理済み`);
    })
    .catch((error) => {
      event.delivery = "failed";
      backupEvents();
      setSendStatus(`送信できませんでした。予備データは端末に残っています。`, true);
      console.warn("observer event collection failed", error);
    });

  if (navigator.vibrate) navigator.vibrate(35);
}

function recordEvent(eventType, eventLabel) {
  if (!observerSessionId) return;
  const event = buildEvent(eventType, eventLabel);
  queueEvent(event);
  noteInput.value = "";
}

async function startObservation() {
  participantId = participantInput.value.trim();
  observerId = observerInput.value.trim();
  experimentRun = Math.max(1, Number(runInput.value) || 1);

  if (!participantId || !observerId) {
    alert("参加者IDと観察者IDを入力してください。");
    return;
  }

  observerSessionId = makeId("OS");
  startedAt = Date.now();
  events = [];
  backupKey = `observer-log-${observerSessionId}`;
  participantText.textContent = participantId;
  localStorage.setItem("observer-participant-id", participantId);
  localStorage.setItem("observer-id", observerId);
  localStorage.setItem("observer-experiment-run", String(experimentRun));

  startScreen.classList.add("hidden");
  doneScreen.classList.add("hidden");
  recordScreen.classList.remove("hidden");
  stateBadge.textContent = "観察中";
  stateBadge.className = "badge recording";
  setSendStatus(collectorUrl ? "開始情報を送信中" : "自動回収URLが未設定です", !collectorUrl);
  renderRecent();

  timer = window.setInterval(() => {
    elapsedText.textContent = formatElapsed(Date.now() - startedAt);
  }, 250);

  try {
    await postToCollector("observer_session", {
      created_at: new Date(startedAt).toISOString(),
      observer_session_id: observerSessionId,
      participant_id: participantId,
      observer_id: observerId,
      experiment_run: experimentRun,
      app_version: APP_VERSION,
      user_agent: navigator.userAgent,
      page_url: location.href
    });
    setSendStatus("観察開始：送信処理済み");
  } catch (error) {
    setSendStatus("開始情報を送信できませんでした。端末内の記録は続けます。", true);
  }
}

function undoLastEvent() {
  const target = [...events].reverse().find((item) =>
    item.event_type !== "void" && item.event_type !== "observer_end" && !item.voided
  );
  if (!target) return;

  target.voided = true;
  const correction = buildEvent("void", "直前の記録を取り消し", {
    note: target.event_label,
    targetEventId: target.event_id
  });
  queueEvent(correction);
  renderRecent();
}

function finishObservation() {
  if (!observerSessionId) return;
  const endEvent = buildEvent("observer_end", "観察終了");
  queueEvent(endEvent);
  window.clearInterval(timer);
  timer = null;

  doneEventCount.textContent = String(validEvents().length);
  doneElapsed.textContent = formatElapsed(Date.now() - startedAt);
  recordScreen.classList.add("hidden");
  doneScreen.classList.remove("hidden");
  stateBadge.textContent = "終了";
  stateBadge.className = "badge";
}

function csvCell(value) {
  if (value === undefined || value === null) return "";
  return `"${String(value).replaceAll('"', '""')}"`;
}

function downloadCsv() {
  const rows = [
    EVENT_HEADERS.join(","),
    ...events.map((item) => EVENT_HEADERS.map((header) => csvCell(item[header])).join(","))
  ];
  const blob = new Blob([`\uFEFF${rows.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `observer-log_${participantId}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetApp() {
  observerSessionId = "";
  events = [];
  questionInput.value = "";
  noteInput.value = "";
  elapsedText.textContent = "0:00";
  eventCountText.textContent = "0";
  doneScreen.classList.add("hidden");
  startScreen.classList.remove("hidden");
  stateBadge.textContent = "待機中";
  stateBadge.className = "badge";
}

participantInput.value = localStorage.getItem("observer-participant-id") || "P001";
observerInput.value = localStorage.getItem("observer-id") || "O01";
runInput.value = localStorage.getItem("observer-experiment-run") || "1";

document.getElementById("startBtn").addEventListener("click", startObservation);
document.querySelectorAll("[data-event]").forEach((button) => {
  button.addEventListener("click", () => recordEvent(button.dataset.event, button.dataset.label));
});
undoBtn.addEventListener("click", undoLastEvent);
document.getElementById("finishBtn").addEventListener("click", finishObservation);
document.getElementById("downloadBtn").addEventListener("click", downloadCsv);
document.getElementById("restartBtn").addEventListener("click", resetApp);

window.addEventListener("beforeunload", (event) => {
  if (!observerSessionId || doneScreen.classList.contains("hidden") === false) return;
  event.preventDefault();
  event.returnValue = "";
});
