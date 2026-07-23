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

const SESSION_HEADERS = [
  "created_at",
  "session_id",
  "participant_id",
  "timer_visible",
  "rest_seconds",
  "time_limit",
  "max_questions",
  "task_type",
  "user_agent",
  "page_url"
];

const OBSERVER_SESSION_HEADERS = [
  "created_at",
  "observer_session_id",
  "participant_id",
  "observer_id",
  "experiment_run",
  "app_version",
  "user_agent",
  "page_url"
];

const OBSERVER_EVENT_HEADERS = [
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

function doGet() {
  return ContentService
    .createTextOutput("learning log collector is running")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const type = payload.type || "";
    const data = payload.data || {};

    if (type === "session") {
      appendRecord_("sessions", SESSION_HEADERS, data);
    } else if (type === "log") {
      appendRecord_("logs", LOG_HEADERS, data);
    } else if (type === "observer_session") {
      if (!data.created_at) data.created_at = new Date().toISOString();
      appendRecord_("observer_sessions", OBSERVER_SESSION_HEADERS, data);
    } else if (type === "observer_event") {
      data.received_at = new Date().toISOString();
      appendRecord_("observer_events", OBSERVER_EVENT_HEADERS, data);
    } else {
      appendRecord_("errors", ["received_at", "message", "raw"], {
        received_at: new Date().toISOString(),
        message: "unknown payload type",
        raw: JSON.stringify(payload)
      });
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    appendRecord_("errors", ["received_at", "message", "raw"], {
      received_at: new Date().toISOString(),
      message: String(error && error.message ? error.message : error),
      raw: (e && e.postData && e.postData.contents) || ""
    });

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function appendRecord_(sheetName, headers, record) {
  const sheet = getOrCreateSheet_(sheetName, headers);
  sheet.appendRow(headers.map((header) => valueForCell_(record[header])));
}

function getOrCreateSheet_(sheetName, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeader = firstRow.join("") !== "";

  if (!hasHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function valueForCell_(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}
