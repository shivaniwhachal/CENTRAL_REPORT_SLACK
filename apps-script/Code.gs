/**
 * OND Plan — Metabase email → Raw_live_METABASE tab (hourly refresh)
 *
 * Paste this whole file into Extensions → Apps Script on the **OND plan Vini CS Team**
 * Google Sheet. Replace the existing script. Save. Then run setupDailyTrigger once.
 *
 * Metabase sends the CSV at minute 59 UTC. This script imports that newest email
 * at minute 59 UTC every hour, then schedules the next hour.
 * WoW Summary uses sheet formulas on Raw_live_METABASE (no Slack or PNG export in this script).
 *
 * Each import also writes OND_Import_Log (created automatically): when the email was
 * processed, plus added rows, removed rows, changed cells, and column changes.
 *
 * Entry points:
 *   processLatestOndEmail()     Import latest unprocessed Metabase email → Raw_live_METABASE
 *   runOndDailyPipeline()       Same as processLatestOndEmail (hourly / manual)
 *   testWithLatestEmail()       Manual test (ignores processed label, does not move the clock)
 *   setupDailyTrigger()         Schedule the next import at minute 59 UTC (then every hour)
 *   removeAllTriggers()         Remove all time-based triggers
 *   verifyOndCodeVersion()      After paste — logs version + required import helpers
 *   diagnoseLatestOndEmail()    Gmail search + parse stats (no sheet write)
 *   diagnoseOndRawMetabaseColumns()  Log Raw tab headers / helper mode
 *   diagnoseOndRawImport()       Combined import health check (email + raw tab)
 *   diagnoseOndImportLog()       Read OND_Import_Log only (no import)
 *   installOndScriptProperties() Seed EMAIL_FROM / EMAIL_SUBJECT script properties
 *
 * Removed (handle Slack separately): WoW PNG export, Slack upload/DM/Central, ALERT_LIVE,
 * delayed post after import, _WoW_Slack_Img / temp Drive PNG export.
 *
 * Advanced Google service (only if Metabase sends .xlsx): Drive API (v2) as "Drive".
 *
 * Metabase question: https://metabase.spyne.ai/question/13213-ond-plan
 * CSV (~19 cols): test accounts filtered in SQL (is_test_account = 0 on enterprise + team).
 */

var OND_SCRIPT_VERSION = '2026-10-21-metabase-import-only-v3-hourly-59-utc';
var OND_GMAIL_THREAD_SCAN = 25;
var OND_GMAIL_NEWER_THAN = '90d';
var OND_PRODUCT_LINE_FILTER = 'conversationalAi';
var OND_TIMEZONE = 'Asia/Kolkata';
/** IST reporting day ends at this hour (shift close). live_date 10 Oct 02:30 → report day 9 Oct. */
var OND_REPORT_CUTOFF_HOUR = 3;
var OND_EMAIL_FROM_DEFAULT = 'metabase@spyne.ai';
var OND_EMAIL_SUBJECT_DEFAULT = 'OND PLAN';
var OND_PROCESSED_LABEL = 'OND-Plan-Processed';
/** Metabase alert is hourly at minute 59 UTC. The import runs at that minute. */
var OND_IMPORT_UTC_MINUTE = 59;
var OND_SPREADSHEET_ID = '1rNW65NGvWoNXxHI0pKM2kjgW8rZ6ZsoPqIlpa3CDMDc';

var METABASE_LIVE_SHEET = 'Raw_live_METABASE';
var METABASE_LIVE_HEADER_ROW = 1;
var METABASE_LIVE_DATA_START = 2;
/** false = never add wow_bucket / helper columns. WoW uses sheet formulas (e.g. Catg). */
var OND_METABASE_WRITE_HELPERS = false;
/**
 * true = write only into OND_RAW_CORE_HEADERS (A–T); never add columns or overwrite Catg formulas.
 */
var OND_RAW_PRESERVE_CORE_LAYOUT = true;

/** Fixed Raw_live_METABASE layout — A through T only (20 columns). Metabase fills A–S; Catg (T) is sheet-only. */
var OND_RAW_CORE_HEADERS = [
  'product_detail_id', 'enterprise_id', 'enterprise_name', 'team_id', 'team_name',
  'product_line_name', 'product_name', 'stage', 'sub_stage', 'contracted_arr', 'live_arr',
  'contracted_date', 'onboarding_date', 'ob_live_date', 'live_date', 'churn_date',
  'projected_live_date', 'projected_onboarding_date', 'updated_at', 'Catg',
];
/** 0-based index of last column Metabase may write (updated_at = S). Catg at index 19 is never imported. */
var OND_RAW_LAST_METABASE_CORE_INDEX = 18;

/** Created on the first import. Newest run is inserted at the top. */
var OND_IMPORT_LOG_SHEET = 'OND_Import_Log';
var OND_IMPORT_LOG_MAX_DETAIL = 2000;
var OND_IMPORT_LOG_MAX_ROWS = 8000;
var OND_LOG_HEADERS = [
  'logged_at_ist', 'email_at_ist', 'message_id', 'subject', 'attachment',
  'event', 'product_detail_id', 'enterprise_name', 'team_name',
  'column', 'old_value', 'new_value', 'detail',
];

// =============================================================================
// Entry points
// =============================================================================

function processLatestOndEmail() {
  runOndDailyPipeline_();
}

/** Hourly entry: Metabase email → Raw_live_METABASE only. */
function runOndDailyPipeline() {
  runOndDailyPipeline_();
}

function runOndDailyPipeline_() {
  runOndEmailJob_({ markProcessed: true, skipProcessed: true });
}

function testWithLatestEmail() {
  runOndEmailJob_({ markProcessed: false, skipProcessed: false });
}

/** Run from Apps Script editor — logs email + parse stats without writing the sheet. */
function diagnoseLatestOndEmail() {
  Logger.log('Script version: ' + OND_SCRIPT_VERSION);
  var queries = ondGmailSearchQueries_();
  for (var q = 0; q < queries.length; q++) {
    Logger.log('Gmail query [' + (q + 1) + ']: ' + queries[q]);
    var threads = GmailApp.search(queries[q], 0, OND_GMAIL_THREAD_SCAN);
    Logger.log('  threads: ' + threads.length);
    var candidates = ondCollectAttachmentMessages_(threads);
    Logger.log('  messages with CSV/xlsx: ' + candidates.length);
    candidates.sort(function (a, b) { return b.getDate().getTime() - a.getDate().getTime(); });
    for (var i = 0; i < Math.min(5, candidates.length); i++) {
      var c = candidates[i];
      Logger.log('  #' + (i + 1) + ': ' + c.getDate() + ' | ' + c.getSubject() +
        ' | id=' + c.getId() + ' | att=' + ondPrimaryDataAttachmentName_(c) +
        ' | processed=' + ondIsMessageProcessed_(c.getId(), c.getDate()));
    }
  }

  var msg = ondFindLatestOndMessage_(false);
  if (!msg) {
    Logger.log('CHOSEN: none (no message with data attachment matched queries above)');
    return;
  }
  Logger.log('CHOSEN (newest, ignore processed): ' + msg.getDate() + ' | ' + msg.getSubject() +
    ' | id=' + msg.getId() + ' | att=' + ondPrimaryDataAttachmentName_(msg));
  var data = ondParseEmailSheetDataFromMessage_(msg);
  Logger.log('Parsed attachment: ' + (data.attachmentName || '(unknown)'));
  Logger.log('Headers: ' + data.headers.length + ' | Rows: ' + data.rows.length);
  if (data.headers.length) Logger.log('First headers: ' + data.headers.slice(0, 5).join(', '));
  var filtered = ondFilterLiveRows_(data.headers, data.rows);
  Logger.log('After filter (' + OND_PRODUCT_LINE_FILTER + '): ' + filtered.length + ' rows');
}

/** Email + Raw tab snapshot — no Slack. */
function diagnoseOndRawImport() {
  diagnoseLatestOndEmail();
  Logger.log('--- Raw tab ---');
  diagnoseOndRawMetabaseColumns();
  Logger.log('--- Import log ---');
  diagnoseOndImportLog();
}

function setupDailyTrigger() {
  ondDeleteLegacySlackTriggers_();
  ondDeleteTriggers_('runOndDailyPipeline');
  ondInstallNextHourlyTrigger_();
}

/** Next minute-59 UTC. If this hour's :59 is already here, use the next hour. */
function ondNextUtcMinuteDate_(minute) {
  var now = new Date();
  var next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    minute,
    0,
    0
  ));
  if (next.getTime() <= now.getTime() + 2 * 60 * 1000) {
    next = new Date(next.getTime() + 60 * 60 * 1000);
  }
  return next;
}

function ondInstallNextHourlyTrigger_() {
  ondDeleteTriggers_('processLatestOndEmail');
  var when = ondNextUtcMinuteDate_(OND_IMPORT_UTC_MINUTE);
  ScriptApp.newTrigger('processLatestOndEmail')
    .timeBased()
    .at(when)
    .create();
  Logger.log('Next Raw_live_METABASE import: ' +
    Utilities.formatDate(when, 'Etc/UTC', 'yyyy-MM-dd HH:mm') + ' UTC.');
}

function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('All triggers removed.');
}

/**
 * Use when Project Settings → Script properties UI loses values.
 * Run once from the editor — seeds email filters only (no Slack properties).
 */
function installOndScriptProperties() {
  var props = PropertiesService.getScriptProperties();
  var patch = {
    EMAIL_FROM: OND_EMAIL_FROM_DEFAULT,
    EMAIL_SUBJECT: OND_EMAIL_SUBJECT_DEFAULT,
  };
  Object.keys(patch).forEach(function (key) {
    props.setProperty(key, patch[key]);
  });
  Logger.log('installOndScriptProperties: wrote ' + Object.keys(patch).join(', '));
  Logger.log('OND_LIVE_SNAPSHOT is auto-created on import; no manual paste needed.');
  Logger.log(OND_IMPORT_LOG_SHEET + ' is created on the next import.');
  listOndScriptPropertyKeys_();
}

function listOndScriptPropertyKeys_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var keys = Object.keys(all).sort();
  Logger.log('Script property keys (' + keys.length + '): ' + keys.join(', '));
  keys.forEach(function (k) {
    if (k === 'OND_LIVE_SNAPSHOT') {
      Logger.log('  ' + k + ' = (json snapshot, auto-maintained)');
    } else {
      var v = String(all[k] || '');
      if (v.length > 80) v = v.slice(0, 77) + '…';
      Logger.log('  ' + k + ' = ' + v);
    }
  });
}

// =============================================================================
// Main job
// =============================================================================

function runOndEmailJob_(opts) {
  opts = opts || {};
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('Another OND run is in progress; skipping.');
    if (opts.markProcessed) {
      try {
        ondInstallNextHourlyTrigger_();
      } catch (scheduleErr) {
        Logger.log('Could not schedule the next hourly import: ' + scheduleErr.message);
      }
    }
    return;
  }

  var runMeta = ondLogMeta_({ testRun: !opts.markProcessed });
  try {
    Logger.log('OND script version: ' + OND_SCRIPT_VERSION);
    var message = ondFindLatestOndMessage_(opts.skipProcessed !== false);
    if (!message) {
      var none = 'OND Plan: no unprocessed Metabase email found (from ' + ondEmailFrom_() +
        ', subject "' + ondEmailSubject_() + '").';
      ondLogStatus_(none);
      ondWriteStatusLog_(SpreadsheetApp.getActiveSpreadsheet(), runMeta, 'SUMMARY',
        'OND ' + OND_SCRIPT_VERSION + ' | ' + none + ' ' + METABASE_LIVE_SHEET + ' was left unchanged.');
      return;
    }

    var messageId = message.getId();
    var thread = message.getThread();
    runMeta = ondLogMeta_({
      message: message,
      attachment: ondPrimaryDataAttachmentName_(message),
      testRun: !opts.markProcessed,
    });
    Logger.log('Using Metabase message: ' + message.getDate() + ' | id=' + messageId +
      ' | subject=' + message.getSubject() + ' | att=' + runMeta.attachment);

    var sheetData = ondParseEmailSheetDataFromMessage_(message);
    runMeta.attachment = sheetData.attachmentName || runMeta.attachment;
    if (!sheetData.headers.length || !sheetData.rows.length) {
      var parseErr = 'OND Plan: could not parse email attachment. Need .csv (or .xlsx with Drive API) with product_detail_id column.';
      ondLogStatus_(parseErr);
      ondWriteStatusLog_(SpreadsheetApp.getActiveSpreadsheet(), runMeta, 'ERROR', parseErr);
      return;
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var filtered = ondFilterLiveRows_(sheetData.headers, sheetData.rows);
    Logger.log('Rows after filter: ' + filtered.length + ' (from ' + sheetData.rows.length +
      ' parsed; excludes non-conversationalAi and deleted if column present)');
    var liveStats = ondReplaceMetabaseLiveSheet_(ss, sheetData.headers, filtered, {
      meta: runMeta,
      parsedCount: sheetData.rows.length,
      filteredCount: filtered.length,
    });
    SpreadsheetApp.flush();

    var summary = 'OND Raw_live_METABASE updated (Metabase email) | Rows: ' + liveStats.rowsWritten +
      ' | New LIVE: ' + liveStats.newLiveCount + ' | New OB: ' + liveStats.newObCount +
      (OND_METABASE_WRITE_HELPERS
        ? (' | Filter `' + liveStats.newLiveCol + '` / `' + liveStats.newObCol + '` on Raw_live_METABASE.')
        : ' | WoW uses Raw tab Catg (col AU) — sheet formulas only.') +
      ' | ' + OND_IMPORT_LOG_SHEET + ': ' + (liveStats.changeSummary || 'see log tab');

    ondLogStatus_(summary);

    if (opts.markProcessed) ondMarkEmailProcessed_(thread, messageId, message.getDate());
    return { liveStats: liveStats };
  } catch (e) {
    var err = 'OND Plan failed: ' + e.message;
    Logger.log(err);
    if (e && e.stack) Logger.log(e.stack);
    ondLogStatus_(err);
    ondWriteStatusLog_(SpreadsheetApp.getActiveSpreadsheet(), runMeta, 'ERROR', err);
    throw e;
  } finally {
    try {
      if (opts.markProcessed) ondInstallNextHourlyTrigger_();
    } catch (scheduleErr) {
      Logger.log('Could not schedule the next hourly import: ' + scheduleErr.message);
    }
    lock.releaseLock();
  }
}

function ondLogStatus_(text) {
  Logger.log(String(text).replace(/\n/g, ' | '));
}

// =============================================================================
// Gmail
// =============================================================================

function ondEmailFrom_() {
  return PropertiesService.getScriptProperties().getProperty('EMAIL_FROM') || OND_EMAIL_FROM_DEFAULT;
}

function ondEmailSubject_() {
  return PropertiesService.getScriptProperties().getProperty('EMAIL_SUBJECT') || OND_EMAIL_SUBJECT_DEFAULT;
}

function ondGmailSearchQueries_() {
  var from = ondEmailFrom_();
  var subj = ondEmailSubject_();
  var newer = OND_GMAIL_NEWER_THAN ? ' newer_than:' + OND_GMAIL_NEWER_THAN : '';
  return [
    'from:' + from + ' subject:"' + subj + '" has:attachment' + newer,
    'from:' + from + ' subject:OND has:attachment' + newer,
  ];
}

/** All messages in these threads that carry a CSV/xlsx attachment (every message, every thread). */
function ondCollectAttachmentMessages_(threads) {
  var candidates = [];
  for (var t = 0; t < threads.length; t++) {
    var msgs = ondThreadMessagesNewestFirst_(threads[t]);
    for (var m = 0; m < msgs.length; m++) {
      if (ondMessageHasDataAttachment_(msgs[m])) candidates.push(msgs[m]);
    }
  }
  return candidates;
}

function ondThreadMessagesNewestFirst_(thread) {
  var msgs = thread.getMessages().slice();
  msgs.sort(function (a, b) { return b.getDate().getTime() - a.getDate().getTime(); });
  return msgs;
}

/**
 * Metabase alerts often land in one Gmail thread. Always pick the newest message
 * with a CSV/xlsx attachment — never thread.getMessages()[0] (oldest).
 * A mail older than the last imported mail is skipped, so an old file cannot
 * overwrite the sheet.
 */
function ondFindLatestOndMessage_(skipProcessed) {
  var queries = ondGmailSearchQueries_();
  for (var q = 0; q < queries.length; q++) {
    var threads = GmailApp.search(queries[q], 0, OND_GMAIL_THREAD_SCAN);
    var candidates = ondCollectAttachmentMessages_(threads);
    candidates.sort(function (a, b) { return b.getDate().getTime() - a.getDate().getTime(); });
    for (var i = 0; i < candidates.length; i++) {
      var cand = candidates[i];
      if (skipProcessed && ondIsMessageProcessed_(cand.getId(), cand.getDate())) continue;
      return cand;
    }
  }
  return null;
}

function ondPrimaryDataAttachmentName_(message) {
  var atts = message.getAttachments();
  for (var a = 0; a < atts.length; a++) {
    var att = atts[a];
    var name = att.getName().toLowerCase();
    var type = String(att.getContentType() || '').toLowerCase();
    if (name.indexOf('.csv') >= 0 || type.indexOf('csv') >= 0) return att.getName();
    if (name.indexOf('.xlsx') >= 0 || name.indexOf('.xls') >= 0 ||
        type.indexOf('spreadsheet') >= 0 || type.indexOf('excel') >= 0) return att.getName();
  }
  return '';
}

function ondMessageHasDataAttachment_(message) {
  var atts = message.getAttachments();
  for (var a = 0; a < atts.length; a++) {
    var name = atts[a].getName().toLowerCase();
    var type = String(atts[a].getContentType() || '').toLowerCase();
    if (name.indexOf('.csv') >= 0 || type.indexOf('csv') >= 0) return true;
    if (name.indexOf('.xlsx') >= 0 || name.indexOf('.xls') >= 0 ||
        type.indexOf('spreadsheet') >= 0 || type.indexOf('excel') >= 0) return true;
  }
  return false;
}

function ondParseEmailSheetDataFromMessage_(message) {
  var atts = message.getAttachments();
  var best = { headers: [], rows: [], attachmentName: '' };
  for (var a = 0; a < atts.length; a++) {
    var att = atts[a];
    Logger.log('Attachment: ' + att.getName() + ' (' + att.getContentType() + ')');
    var data = ondAttachmentToSheetData_(att);
    if (!data.headers.length || !data.rows.length) continue;
    if (data.rows.length > best.rows.length) {
      best = { headers: data.headers, rows: data.rows, attachmentName: att.getName() };
    }
  }
  return best;
}

/** @deprecated use ondParseEmailSheetDataFromMessage_ — kept for compatibility */
function ondAttachmentToSheetData_(att) {
  var name = att.getName().toLowerCase();
  var type = String(att.getContentType() || '').toLowerCase();
  if (name.indexOf('.csv') >= 0 || type.indexOf('csv') >= 0) {
    return ondCsvToSheetData_(att);
  }
  if (name.indexOf('.xlsx') >= 0 || name.indexOf('.xls') >= 0 ||
      type.indexOf('spreadsheet') >= 0 || type.indexOf('excel') >= 0) {
    return ondXlsxToSheetData_(att);
  }
  return { headers: [], rows: [] };
}

function ondCsvToSheetData_(blob) {
  var text = blob.getDataAsString('UTF-8').replace(/^\uFEFF/, '');
  var lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  var headers = ondSplitCsvLine_(lines[0]).map(function (h) {
    return String(h || '').trim();
  });
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    var cells = ondSplitCsvLine_(lines[i]);
    while (cells.length < headers.length) cells.push('');
    rows.push(cells.slice(0, headers.length));
  }
  return { headers: headers, rows: rows };
}

function ondXlsxToSheetData_(blob) {
  var tempName = 'ond-metabase-' + Date.now();
  var file = Drive.Files.insert(
    { title: tempName, mimeType: MimeType.GOOGLE_SHEETS },
    blob,
    { convert: true }
  );
  try {
    var values = SpreadsheetApp.openById(file.id).getSheets()[0].getDataRange().getValues();
    if (values.length < 2) return { headers: [], rows: [] };
    var headers = values[0].map(function (h) { return String(h || '').trim(); });
    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r].map(function (c) { return c === null || c === undefined ? '' : c; });
      while (row.length < headers.length) row.push('');
      rows.push(row.slice(0, headers.length));
    }
    return { headers: headers, rows: rows };
  } finally {
    Drive.Files.remove(file.id);
  }
}

function ondFilterLiveRows_(headers, rows) {
  var pidIdx = -1;
  var delIdx = -1;
  var plIdx = -1;
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').toLowerCase();
    if (h === 'product_detail_id') pidIdx = i;
    if (h === '_peerdb_is_deleted') delIdx = i;
    if (h === 'product_line_name') plIdx = i;
  }
  var out = [];
  for (var r = 0; r < rows.length; r++) {
    var cells = rows[r];
    if (!cells || cells === null || cells === undefined) continue;
    if (pidIdx >= 0 && !String(cells[pidIdx] || '').trim()) continue;
    if (plIdx >= 0 && String(cells[plIdx] || '').trim() !== OND_PRODUCT_LINE_FILTER) continue;
    if (delIdx >= 0) {
      var d = String(cells[delIdx] || '').trim().toLowerCase();
      if (d === '1' || d === 'true') continue;
    }
    out.push(cells);
  }
  return out;
}

function ondSplitCsvLine_(line) {
  var out = [];
  var cur = '';
  var q = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (c === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function ondMarkEmailProcessed_(thread, messageId, messageDate) {
  var label = GmailApp.getUserLabelByName(OND_PROCESSED_LABEL) || GmailApp.createLabel(OND_PROCESSED_LABEL);
  thread.addLabel(label);
  ondRememberProcessedId_(messageId, messageDate);
}

function ondIsMessageProcessed_(messageId, messageDate) {
  var props = PropertiesService.getScriptProperties();
  if (messageId && props.getProperty('PROCESSED_LATEST_ID') === messageId) return true;
  var latest = Number(props.getProperty('PROCESSED_LATEST_MS') || '0');
  if (latest && messageDate && messageDate.getTime() < latest) return true;
  var raw = props.getProperty('PROCESSED_MESSAGE_IDS');
  if (!raw || !messageId) return false;
  try { return JSON.parse(raw).indexOf(messageId) >= 0; } catch (e) { return false; }
}

function ondRememberProcessedId_(messageId, messageDate) {
  var props = PropertiesService.getScriptProperties();
  var ms = messageDate && messageDate.getTime ? messageDate.getTime() : 0;
  var prev = Number(props.getProperty('PROCESSED_LATEST_MS') || '0');
  if (ms && ms >= prev) {
    props.setProperty('PROCESSED_LATEST_MS', String(ms));
    if (messageId) props.setProperty('PROCESSED_LATEST_ID', messageId);
  }
  var ids = [];
  try { ids = JSON.parse(props.getProperty('PROCESSED_MESSAGE_IDS') || '[]'); } catch (e) { ids = []; }
  if (messageId && ids.indexOf(messageId) < 0) ids.unshift(messageId);
  props.setProperty('PROCESSED_MESSAGE_IDS', JSON.stringify(ids.slice(0, 200)));
}

function ondDeleteTriggers_(handler) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
  });
}

/** Remove handlers left over from WoW/Slack builds (import-only script has no Slack entry points). */
function ondDeleteLegacySlackTriggers_() {
  [
    'postOndWowReportToSlack',
    'postOndWowReportToSlackAfterImport_',
    'runOndDailyPipeline',
  ].forEach(function (name) {
    ondDeleteTriggers_(name);
  });
}

// =============================================================================
// CSV → Raw_live_METABASE
// =============================================================================

var OND_HELPER_HEADERS = [
  'wow_bucket', 'wow_recv_bucket', 'wow_live_date', 'wow_recv_date',
  'new_live_flag', 'new_ob_flag',
];
var OND_HELPER_START_COL = 20;

function ondRange_(ws, startRow, startCol, numRows, numCols) {
  if (numRows < 1 || numCols < 1) throw new Error('ondRange_: invalid size ' + numRows + 'x' + numCols);
  return ws.getRange(startRow, startCol, numRows, numCols);
}

/**
 * Write a 2D array to a sheet. Skips null/undefined rows (sparse arrays from CSV)
 * and sizes the range from the compacted row count — not data.length.
 */
function ondSetTableValues_(ws, startRow, startCol, data, fixedCols) {
  if (!data || !data.length) return 0;
  var normalized = [];
  var numCols = fixedCols || 0;
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (row === null || row === undefined) continue;
    var cells = Array.isArray(row) ? row.slice() : [row];
    if (!numCols) numCols = cells.length;
    while (cells.length < numCols) cells.push('');
    normalized.push(cells.slice(0, numCols));
  }
  if (!normalized.length || !numCols) return 0;

  var CHUNK = 4000;
  for (var offset = 0; offset < normalized.length; offset += CHUNK) {
    var chunk = normalized.slice(offset, offset + CHUNK);
    var numRows = chunk.length;
    var range = ondRange_(ws, startRow + offset, startCol, numRows, numCols);
    if (range.getNumRows() !== numRows || range.getNumColumns() !== numCols) {
      throw new Error('Range mismatch: data ' + numRows + 'x' + numCols +
        ' but range ' + range.getNumRows() + 'x' + range.getNumColumns());
    }
    range.setValues(chunk);
  }
  return normalized.length;
}

function ondNormalizeHeaderName_(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
}

/** CSV header → alternate names when mapping into OND_RAW_CORE_HEADERS */
function ondHeaderAliasTargets_(normName) {
  var aliases = {
    sub_stage: ['substage'],
    substage: ['sub_stage'],
    product_enterprise_id: ['enterprise_id'],
    enterprise_id: ['product_enterprise_id'],
    enterprise_team_id: ['team_id'],
    team_id: ['enterprise_team_id'],
    product_line_name: ['product_line_detail'],
    product_line_detail: ['product_line_name'],
  };
  var list = [normName];
  var extra = aliases[normName];
  if (extra) list = list.concat(extra);
  return list;
}

function ondHeaderMismatchesFromRow_(row) {
  var mism = [];
  for (var i = 0; i < OND_RAW_CORE_HEADERS.length; i++) {
    var got = row && i < row.length ? row[i] : '';
    if (ondNormalizeHeaderName_(got) !== ondNormalizeHeaderName_(OND_RAW_CORE_HEADERS[i])) {
      mism.push(ondColNumToLetter_(i + 1) + ': sheet="' + got + '" expected="' + OND_RAW_CORE_HEADERS[i] + '"');
    }
  }
  return mism;
}

function ondCollectCoreHeaderMismatches_(ws) {
  var expected = OND_RAW_CORE_HEADERS.length;
  var row = ws.getRange(METABASE_LIVE_HEADER_ROW, 1, METABASE_LIVE_HEADER_ROW, expected).getValues()[0];
  return ondHeaderMismatchesFromRow_(row);
}

function ondValidateCoreRow1_(ws) {
  var mism = ondCollectCoreHeaderMismatches_(ws);
  if (mism.length) {
    Logger.log('WARNING: row 1 differs from OND_RAW_CORE_HEADERS (' + mism.length + ' cols) — import still uses fixed A–T layout. First: ' + mism[0]);
  } else {
    Logger.log('Row 1 matches OND_RAW_CORE_HEADERS (' + OND_RAW_CORE_HEADERS.length + ' columns A–T).');
  }
  return mism;
}

function ondEnsureCoreRow1Headers_(ws) {
  if (ondSheetHeaderLastCol_(ondReadCoreSheetHeaders_(ws)) > 0) return;
  ondSetTableValues_(ws, METABASE_LIVE_HEADER_ROW, 1, [OND_RAW_CORE_HEADERS.slice()], OND_RAW_CORE_HEADERS.length);
  Logger.log('Row 1 was empty — wrote OND_RAW_CORE_HEADERS once (A–T).');
}

function ondSheetHeaderLastCol_(headers) {
  var last = 0;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim()) last = i + 1;
  }
  return last;
}

function ondReadCoreSheetHeaders_(ws) {
  var lastCol = Math.max(ws.getLastColumn(), 1);
  return ws.getRange(METABASE_LIVE_HEADER_ROW, 1, METABASE_LIVE_HEADER_ROW, lastCol).getValues()[0];
}

/** Map each CSV column index → core column index (0-based), or -1. Never maps into Catg. */
function ondBuildCsvToCoreColumnMap_(csvHeaders) {
  var coreNorm = OND_RAW_CORE_HEADERS.map(ondNormalizeHeaderName_);
  var csvToCore = [];
  var mapped = {};
  var skippedCsv = 0;
  for (var c = 0; c < csvHeaders.length; c++) {
    var norm = ondNormalizeHeaderName_(csvHeaders[c]);
    if (norm === 'catg') {
      csvToCore.push(-1);
      skippedCsv++;
      continue;
    }
    var targets = ondHeaderAliasTargets_(norm);
    var coreIdx = -1;
    for (var t = 0; t < targets.length && coreIdx < 0; t++) {
      var hit = coreNorm.indexOf(targets[t]);
      if (hit >= 0 && hit <= OND_RAW_LAST_METABASE_CORE_INDEX) coreIdx = hit;
    }
    csvToCore.push(coreIdx);
    if (coreIdx < 0) skippedCsv++;
    else mapped[coreIdx] = true;
  }
  var mappedCoreCols = Object.keys(mapped).map(function (k) { return parseInt(k, 10); }).sort(function (a, b) {
    return a - b;
  });
  return { csvToCore: csvToCore, mappedCoreCols: mappedCoreCols, skippedCsv: skippedCsv };
}

function ondReplaceMetabaseLiveSheet_(ss, headers, rows, jobMeta) {
  jobMeta = jobMeta || {};
  var ws = ss.getSheetByName(METABASE_LIVE_SHEET);
  if (!ws) {
    throw new Error('Tab "' + METABASE_LIVE_SHEET + '" not found — use your existing core sheet; script does not create or add columns.');
  }

  var prevSnap = ondLoadLiveSnapshot_();
  var written = 0;
  var numCols = headers.length;
  var headerMismatches = [];
  var oldGrid = [];
  var newGrid = [];
  var compareCols = [];
  var sheetColCount = Math.max(ws.getLastColumn(), 0);
  var numRowsToClear = 0;

  if (OND_RAW_PRESERVE_CORE_LAYOUT) {
    ondEnsureCoreRow1Headers_(ws);
    headerMismatches = ondValidateCoreRow1_(ws);
    var metabaseWidth = OND_RAW_LAST_METABASE_CORE_INDEX + 1;
    compareCols = OND_RAW_CORE_HEADERS.slice(0, metabaseWidth);
    oldGrid = ondReadCoreDataGrid_(ws);
    var mapInfo = ondBuildCsvToCoreColumnMap_(headers);
    if (!mapInfo.mappedCoreCols.length) {
      throw new Error('No CSV columns matched OND_RAW_CORE_HEADERS (A–S) — check Metabase export headers.');
    }
    var oldLastRow = ws.getLastRow();
    numRowsToClear = Math.max(
      oldLastRow,
      rows.length ? METABASE_LIVE_DATA_START + rows.length - 1 : METABASE_LIVE_HEADER_ROW
    );
    if (numRowsToClear >= METABASE_LIVE_DATA_START) {
      ondRange_(ws, METABASE_LIVE_DATA_START, 1, numRowsToClear - METABASE_LIVE_DATA_START + 1, metabaseWidth)
        .clearContent();
    }
    if (rows.length) {
      var grid = [];
      for (var r = 0; r < rows.length; r++) {
        var line = new Array(metabaseWidth);
        for (var w = 0; w < metabaseWidth; w++) line[w] = '';
        var csvRow = rows[r];
        for (var c = 0; c < headers.length; c++) {
          var coreIdx = mapInfo.csvToCore[c];
          if (coreIdx < 0) continue;
          line[coreIdx] = csvRow[c];
        }
        grid.push(line);
      }
      newGrid = grid;
      written = ondSetTableValues_(ws, METABASE_LIVE_DATA_START, 1, grid, metabaseWidth);
    }
    numCols = mapInfo.mappedCoreCols.length;
    Logger.log('Raw_live_METABASE: fixed core A–T. Wrote ' + written + ' rows into ' + numCols +
      ' Metabase fields (A–S only). Skipped ' + mapInfo.skippedCsv +
      ' CSV columns. Column T (Catg) never cleared or imported.');
  } else {
    compareCols = headers.slice();
    oldGrid = ondReadSheetGridForHeaders_(ws, compareCols);
    newGrid = rows || [];
    numCols = headers.length;
    var dataRowCount = rows.length;
    numRowsToClear = Math.max(
      ws.getLastRow(),
      dataRowCount ? METABASE_LIVE_DATA_START + dataRowCount - 1 : METABASE_LIVE_HEADER_ROW
    );
    if (numRowsToClear > 0 && numCols > 0) {
      ondRange_(ws, 1, 1, numRowsToClear, numCols).clearContent();
    }
    ondSetTableValues_(ws, METABASE_LIVE_HEADER_ROW, 1, [headers], numCols);
    if (rows.length) {
      written = ondSetTableValues_(ws, METABASE_LIVE_DATA_START, 1, rows, numCols);
    }
    Logger.log('Raw_live_METABASE: empty sheet bootstrap — wrote headers + ' + written + ' rows (' + numCols + ' cols).');
  }

  Logger.log('Raw_live_METABASE write complete (' +
    (OND_METABASE_WRITE_HELPERS ? 'with helpers' : 'no helper columns added') + ')');

  var flags = ondCountLiveObChanges_(headers, rows, prevSnap);
  if (OND_METABASE_WRITE_HELPERS) {
    var helperStart = Math.max(numCols + 1, OND_HELPER_START_COL);
    var helperEndCol = helperStart + OND_HELPER_HEADERS.length - 1;
    if (numRowsToClear > 0 && helperEndCol > numCols) {
      ondRange_(ws, 1, numCols + 1, numRowsToClear, helperEndCol - numCols).clearContent();
    }
    ondRange_(ws, METABASE_LIVE_HEADER_ROW, helperStart, 1, OND_HELPER_HEADERS.length)
      .setValues([OND_HELPER_HEADERS.slice()]);
    ondEnsureHelperFormulas_(ws, helperStart, headers);
    ondWriteChangeFlags_(ws, headers, rows, helperStart, prevSnap);
  }

  var changeSummary = 'change log failed';
  try {
    var logResult = ondRecordImportChangeLog_(ss, {
      meta: jobMeta.meta || ondLogMeta_({}),
      oldGrid: oldGrid,
      newGrid: newGrid,
      colNames: compareCols,
      csvHeaders: headers,
      headerMismatches: headerMismatches,
      sheetColCount: sheetColCount,
      parsedCount: jobMeta.parsedCount,
      filteredCount: jobMeta.filteredCount,
      rowsWritten: written || rows.length,
    });
    changeSummary = logResult.short;
  } catch (logErr) {
    Logger.log('Raw tab updated, but ' + OND_IMPORT_LOG_SHEET + ' failed: ' + logErr.message);
  }
  ondSaveLiveSnapshot_(headers, rows);

  var helperStartCol = Math.max(numCols + 1, OND_HELPER_START_COL);
  return {
    rowsWritten: written || rows.length,
    columnsWritten: numCols,
    newLiveCount: flags.newLiveCount,
    newObCount: flags.newObCount,
    newLiveCol: ondColNumToLetter_(helperStartCol + 4) + ' new_live_flag',
    newObCol: ondColNumToLetter_(helperStartCol + 5) + ' new_ob_flag',
    helperStartCol: helperStartCol,
    changeSummary: changeSummary,
  };
}

function ondCountLiveObChanges_(headers, rows, prevSnap) {
  var pidI = ondColIndex_(headers, 'product_detail_id');
  var liveI = ondColIndex_(headers, 'live_date');
  var obI = ondColIndex_(headers, 'onboarding_date');
  var stageI = ondColIndex_(headers, 'stage');
  var newLiveCount = 0;
  var newObCount = 0;
  if (pidI < 0) return { newLiveCount: 0, newObCount: 0 };
  rows.forEach(function (cells) {
    var pid = String(cells[pidI] || '').trim();
    if (!pid) return;
    var prev = prevSnap[pid] || { live: '', ob: '', stage: '' };
    var live = String(cells[liveI] || '');
    var ob = String(cells[obI] || '');
    var stage = String(cells[stageI] || '');
    if (stage === 'Live' && live && (!prev.live || prev.stage !== 'Live')) newLiveCount++;
    if (ob && !prev.ob) newObCount++;
  });
  return { newLiveCount: newLiveCount, newObCount: newObCount };
}

function ondFormatHelperColumnGuide_(numDataCols) {
  var helperStart = Math.max(numDataCols + 1, OND_HELPER_START_COL);
  var parts = [];
  for (var i = 0; i < OND_HELPER_HEADERS.length; i++) {
    parts.push(ondColNumToLetter_(helperStart + i) + ' `' + OND_HELPER_HEADERS[i] + '`');
  }
  return parts.join(' · ');
}

/** Run in Apps Script — logs helper + “new” column letters on Raw_live_METABASE row 1. */
function diagnoseOndRawMetabaseColumns() {
  Logger.log('Script version: ' + OND_SCRIPT_VERSION);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(METABASE_LIVE_SHEET);
  if (!ws) {
    Logger.log('Tab "' + METABASE_LIVE_SHEET + '" not found.');
    return;
  }
  var lastCol = ws.getLastColumn();
  var headers = ws.getRange(1, 1, 1, lastCol).getValues()[0];
  var dataCols = 0;
  for (var c = 0; c < headers.length; c++) {
    if (String(headers[c] || '').trim()) dataCols = c + 1;
  }
  Logger.log('OND_RAW_CORE_HEADERS (' + OND_RAW_CORE_HEADERS.length + ' cols A–T): ' + OND_RAW_CORE_HEADERS.join(', '));
  Logger.log('Sheet row 1 width: ' + dataCols);
  Logger.log('Data rows: ' + Math.max(0, ws.getLastRow() - METABASE_LIVE_DATA_START + 1));
  ondValidateCoreRow1_(ws);
  Logger.log('OND_METABASE_WRITE_HELPERS: ' + OND_METABASE_WRITE_HELPERS);
  if (OND_METABASE_WRITE_HELPERS) {
    Logger.log('Helper block: ' + ondFormatHelperColumnGuide_(dataCols));
  } else {
    Logger.log('WoW bucket source: Raw tab column Catg (typically AU) — sheet formulas only.');
    Logger.log('New LIVE/OB counts: from OND_LIVE_SNAPSHOT during import (see Executions log).');
  }
  if (ss.getId() !== OND_SPREADSHEET_ID) {
    Logger.log('NOTE: active spreadsheet id=' + ss.getId() + ' (reference OND_SPREADSHEET_ID=' + OND_SPREADSHEET_ID + ')');
  }
}

/** Read-only peek at the change log. */
function diagnoseOndImportLog() {
  Logger.log('Script version: ' + OND_SCRIPT_VERSION);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ws = ss.getSheetByName(OND_IMPORT_LOG_SHEET);
  if (!ws) {
    Logger.log('"' + OND_IMPORT_LOG_SHEET + '" is not in this spreadsheet yet. It is created the next time an import runs.');
    return;
  }
  var n = Math.max(0, ws.getLastRow() - 1);
  Logger.log(OND_IMPORT_LOG_SHEET + ' data rows: ' + n);
  if (ws.getLastRow() >= 2) {
    var newest = ws.getRange(2, 1, 1, OND_LOG_HEADERS.length).getValues()[0];
    Logger.log('Newest log row: ' + newest.join(' | '));
  }
}

/** ARRAYFORMULA helpers for WoW — row 2 only; column letters from CSV headers (Q13213-safe). */
function ondReportingDayArray_(colRange) {
  var h = OND_REPORT_CUTOFF_HOUR;
  return 'IF(' + colRange + '="","",INT(' + colRange + '-TIME(' + h + ',0,0)))';
}

function ondEnsureHelperFormulas_(ws, helperStart, headers) {
  var LIVE = METABASE_LIVE_SHEET;
  var af = helperStart;
  var pid = ondHeaderColLetter_(headers, ['product_detail_id']);
  var pln = ondHeaderColLetter_(headers, ['product_line_name']);
  var stg = ondHeaderColLetter_(headers, ['stage']);
  var sub = ondHeaderColLetter_(headers, ['sub_stage', 'substage']);
  var cd = ondHeaderColLetter_(headers, ['contracted_date']);
  var ob = ondHeaderColLetter_(headers, ['onboarding_date']);
  var ld = ondHeaderColLetter_(headers, ['live_date']);
  var R = LIVE + '!';
  var ldR = R + ld + '2:' + ld;
  var cdR = R + cd + '2:' + cd;
  var obR = R + ob + '2:' + ob;
  var liveReportDay = ondReportingDayArray_(ldR);
  var contractReportDay = ondReportingDayArray_(cdR);
  var obReportDay = ondReportingDayArray_(obR);
  var formulas = [
    '=ARRAYFORMULA(IF(' + R + pid + '2:' + pid + '="","",IF(' + R + pln + '2:' + pln + '<>"' +
      OND_PRODUCT_LINE_FILTER + '","",' +
      'IF(' + R + stg + '2:' + stg + '="Live",' +
      'IF((' + R + cd + '2:' + cd + '<>"")*(' + R + ld + '2:' + ld + '<>"")*' +
      '(TEXT(' + R + cd + '2:' + cd + ',"YYYY-MM")=TEXT(' + R + ld + '2:' + ld + ',"YYYY-MM")),"M0 sale-> Live",' +
      'IF(' + R + ob + '2:' + ob + '<>""","In OB","PWS - Sales")),' +
      'IF(' + R + stg + '2:' + stg + '="Onboarding","In OB",' +
      'IF(' + R + stg + '2:' + stg + '="Contracted",' +
      'IF(REGEXMATCH(TO_TEXT(' + R + sub + '2:' + sub + '"),"(?i)CS|Client Stuck"),"PWS - CS","PWS - Sales"),"")))))',
    '=ARRAYFORMULA(IF(' + R + pid + '2:' + pid + '="","",IF(' + R + pln + '2:' + pln + '<>"' +
      OND_PRODUCT_LINE_FILTER + '","",' +
      'IF((' + R + stg + '2:' + stg + '="Contracted")*(' + R + cd + '2:' + cd + '<>"")*(' + R + ld + '2:' + ld + '<>"")*' +
      '(TEXT(' + R + cd + '2:' + cd + ',"YYYY-MM")=TEXT(' + R + ld + '2:' + ld + ',"YYYY-MM"))),"M0 sale-> Live",' +
      'IF(' + R + stg + '2:' + stg + '="Contracted",' +
      'IF(REGEXMATCH(TO_TEXT(' + R + sub + '2:' + sub + '"),"(?i)CS|Client Stuck"),"PWS - CS","PWS - Sales"),' +
      'IF((' + R + stg + '2:' + stg + '="Onboarding")*(' + R + sub + '2:' + sub + '="In OB"),"PWS - Sales","")))))',
    '=ARRAYFORMULA(IF(' + R + pid + '2:' + pid + '="","",IF(' + R + pln + '2:' + pln + '<>"' +
      OND_PRODUCT_LINE_FILTER + '","",' +
      'IF(' + R + stg + '2:' + stg + '="Live",' + liveReportDay + ',"")))',
    '=ARRAYFORMULA(IF(' + R + pid + '2:' + pid + '="","",IF(' + R + pln + '2:' + pln + '<>"' +
      OND_PRODUCT_LINE_FILTER + '","",' +
      'IF(' + R + stg + '2:' + stg + '="Contracted",' + contractReportDay + ',' +
      'IF((' + R + stg + '2:' + stg + '="Onboarding")*(' + R + sub + '2:' + sub + '="In OB"),' +
      obReportDay + ',""))))',
  ];
  for (var i = 0; i < formulas.length; i++) {
    ws.getRange(2, af + i).setFormula(formulas[i]);
  }
}

function ondColNumToLetter_(col) {
  var s = '';
  var n = col;
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function ondHeaderColLetter_(headers, names) {
  var list = Array.isArray(names) ? names : [names];
  for (var i = 0; i < list.length; i++) {
    var idx = ondColIndex_(headers, list[i]);
    if (idx >= 0) return ondColNumToLetter_(idx + 1);
  }
  throw new Error('OND: missing CSV column (need one of): ' + list.join(', '));
}

function ondColIndex_(headers, name) {
  var target = name.toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').toLowerCase() === target) return i;
  }
  return -1;
}

function ondLoadLiveSnapshot_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('OND_LIVE_SNAPSHOT') || '{}');
  } catch (e) {
    return {};
  }
}

function ondSaveLiveSnapshot_(headers, rows) {
  var pidI = ondColIndex_(headers, 'product_detail_id');
  var liveI = ondColIndex_(headers, 'live_date');
  var obI = ondColIndex_(headers, 'onboarding_date');
  var stageI = ondColIndex_(headers, 'stage');
  if (pidI < 0) return;
  var snap = {};
  rows.forEach(function (cells) {
    var pid = String(cells[pidI] || '').trim();
    if (!pid) return;
    snap[pid] = {
      live: String(cells[liveI] || ''),
      ob: String(cells[obI] || ''),
      stage: String(cells[stageI] || ''),
    };
  });
  PropertiesService.getScriptProperties().setProperty('OND_LIVE_SNAPSHOT', JSON.stringify(snap));
}

function ondWriteChangeFlags_(ws, headers, rows, helperStart, prevSnap) {
  var pidI = ondColIndex_(headers, 'product_detail_id');
  var liveI = ondColIndex_(headers, 'live_date');
  var obI = ondColIndex_(headers, 'onboarding_date');
  var stageI = ondColIndex_(headers, 'stage');
  var newLiveCol = helperStart + 4;
  var newObCol = helperStart + 5;
  var newLive = [];
  var newOb = [];
  var newLiveCount = 0;
  var newObCount = 0;

  rows.forEach(function (cells) {
    var pid = String(cells[pidI] || '').trim();
    var prev = prevSnap[pid] || { live: '', ob: '', stage: '' };
    var live = String(cells[liveI] || '');
    var ob = String(cells[obI] || '');
    var stage = String(cells[stageI] || '');
    var liveFlag = '';
    var obFlag = '';

    if (stage === 'Live' && live && (!prev.live || prev.stage !== 'Live')) {
      liveFlag = 'NEW LIVE';
      newLiveCount++;
    }
    if (ob && !prev.ob) {
      obFlag = 'NEW OB';
      newObCount++;
    }
    newLive.push([liveFlag]);
    newOb.push([obFlag]);
  });

  if (rows.length) {
    ondSetTableValues_(ws, METABASE_LIVE_DATA_START, newLiveCol, newLive);
    ondSetTableValues_(ws, METABASE_LIVE_DATA_START, newObCol, newOb);
  }

  if (newLiveCount > 0) {
    Logger.log('New live flags: ' + newLiveCount + ' (see new_live_flag col on Raw_live_METABASE)');
  }
  return { newLiveCount: newLiveCount, newObCount: newObCount };
}

// =============================================================================
// Import change log → OND_Import_Log
// =============================================================================

function ondLogMeta_(opts) {
  opts = opts || {};
  var emailAt = '';
  if (opts.message && opts.message.getDate) {
    emailAt = ondFormatDate_(opts.message.getDate());
  } else if (opts.emailAt) {
    emailAt = opts.emailAt;
  }
  return {
    loggedAt: ondFormatDate_(new Date()),
    emailAt: emailAt,
    messageId: opts.message && opts.message.getId ? opts.message.getId() : (opts.messageId || ''),
    subject: opts.message && opts.message.getSubject ? opts.message.getSubject() : (opts.subject || ''),
    attachment: opts.attachment || '',
    testRun: !!opts.testRun,
  };
}

function ondFormatDate_(date) {
  if (!date || Object.prototype.toString.call(date) !== '[object Date]' || isNaN(date.getTime())) return '';
  if (typeof Utilities === 'undefined' || !Utilities.formatDate) {
    throw new Error('Utilities.formatDate is required');
  }
  return Utilities.formatDate(date, OND_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function ondTwo_(n) {
  var s = String(n);
  return s.length < 2 ? '0' + s : s;
}

function ondIsNumericText_(s) {
  return /^-?\d+(\.\d+)?$/.test(s);
}

function ondDisplayCell_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return ondFormatDate_(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!isFinite(value)) return '';
    if (Math.abs(value) >= 1e15) return String(value);
    if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
    return String(Math.round(value * 1000000) / 1000000);
  }
  return String(value).replace(/^\uFEFF/, '').trim();
}

/** Compare sheet values and CSV text without flagging format-only differences. */
function ondNormalizeForCompare_(displayed) {
  if (displayed === null || displayed === undefined) return '';
  var s = String(displayed).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/^(true|false)$/i.test(s)) return s.toLowerCase();
  if (s.indexOf(',') >= 0) {
    var noComma = s.replace(/,/g, '');
    if (ondIsNumericText_(noComma)) s = noComma;
  }
  if (ondIsNumericText_(s)) {
    var n = Number(s);
    if (!isFinite(n)) return s;
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return String(Math.round(n * 1000000) / 1000000);
  }
  var iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (iso) {
    var datePart = iso[1];
    var hasTime = !!iso[2];
    var hh = iso[2] || '00';
    var mm = iso[3] || '00';
    var ss = iso[4] || '00';
    var zone = iso[5] || '';
    if (zone) {
      var parsed = new Date(datePart + 'T' + hh + ':' + mm + ':' + ss + zone);
      if (!isNaN(parsed.getTime())) {
        return ondFormatDate_(parsed).replace(/ 00:00:00$/, '');
      }
    }
    if (!hasTime || (hh === '00' && mm === '00' && ss === '00')) return datePart;
    return datePart + ' ' + hh + ':' + mm + ':' + ss;
  }
  var slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    var a = Number(slash[1]);
    var b = Number(slash[2]);
    var yyyy = slash[3];
    if (a > 12 && b >= 1 && b <= 12) return yyyy + '-' + ondTwo_(b) + '-' + ondTwo_(a);
    if (b > 12 && a >= 1 && a <= 12) return yyyy + '-' + ondTwo_(a) + '-' + ondTwo_(b);
  }
  return s;
}

function ondValuesEqual_(a, b) {
  var da = ondDisplayCell_(a);
  var db = ondDisplayCell_(b);
  if (da === db) return true;
  return ondNormalizeForCompare_(da) === ondNormalizeForCompare_(db);
}

function ondPidKey_(value) {
  return ondNormalizeForCompare_(ondDisplayCell_(value));
}

function ondClip_(value, max) {
  var s = value === null || value === undefined ? '' : String(value);
  max = max || 300;
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function ondLogRow_(meta, event, fields) {
  meta = meta || {};
  fields = fields || {};
  return [
    meta.loggedAt || '',
    meta.emailAt || '',
    meta.messageId || '',
    ondClip_(meta.subject, 300),
    ondClip_(meta.attachment, 300),
    event || '',
    ondClip_(fields.pid, 200),
    ondClip_(fields.enterprise, 200),
    ondClip_(fields.team, 200),
    ondClip_(fields.column, 200),
    ondClip_(fields.oldValue, 300),
    ondClip_(fields.newValue, 300),
    ondClip_(fields.detail, event === 'SUMMARY' ? 1800 : 1000),
  ];
}

function ondColByName_(names, name) {
  var target = String(name || '').toLowerCase();
  for (var i = 0; i < names.length; i++) {
    if (String(names[i] || '').toLowerCase() === target) return i;
  }
  return -1;
}

function ondCellAt_(row, idx) {
  if (!row || idx < 0 || idx >= row.length) return '';
  return row[idx];
}

function ondObjectKeyCount_(obj) {
  var n = 0;
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) n++;
  }
  return n;
}

function ondRowSnapshot_(row, colNames) {
  var skip = { product_detail_id: true, enterprise_name: true, team_name: true };
  var parts = [];
  for (var c = 0; c < colNames.length; c++) {
    var name = colNames[c];
    if (skip[ondNormalizeHeaderName_(name)]) continue;
    var shown = ondDisplayCell_(row ? row[c] : '');
    if (!shown) continue;
    parts.push(name + '=' + shown);
  }
  return parts.join(' | ');
}

function ondIndexGridByPid_(grid, colNames) {
  var pidI = ondColByName_(colNames, 'product_detail_id');
  var map = {};
  var order = [];
  var dupes = 0;
  var blank = 0;
  if (pidI < 0) return { map: map, order: order, dupes: 0, blank: grid.length, pidI: -1 };
  for (var r = 0; r < grid.length; r++) {
    var row = grid[r] || [];
    var pid = ondPidKey_(row[pidI]);
    if (!pid) {
      blank++;
      continue;
    }
    if (map[pid]) dupes++;
    else order.push(pid);
    map[pid] = row;
  }
  return { map: map, order: order, dupes: dupes, blank: blank, pidI: pidI };
}

function ondColumnFillCounts_(grid, width) {
  var counts = [];
  var c;
  for (c = 0; c < width; c++) counts.push(0);
  for (var r = 0; r < grid.length; r++) {
    var row = grid[r] || [];
    for (c = 0; c < width; c++) {
      if (ondDisplayCell_(row[c]) !== '') counts[c]++;
    }
  }
  return counts;
}

function ondDiffCoreGrids_(oldGrid, newGrid, colNames) {
  oldGrid = oldGrid || [];
  newGrid = newGrid || [];
  colNames = colNames || [];
  var oldIx = ondIndexGridByPid_(oldGrid, colNames);
  var newIx = ondIndexGridByPid_(newGrid, colNames);
  var empty = {
    added: 0,
    removed: 0,
    cells: 0,
    productsChanged: 0,
    duplicateNew: newIx.dupes,
    duplicateOld: oldIx.dupes,
    blankNew: newIx.blank,
    blankOld: oldIx.blank,
    rowsBefore: oldGrid.length,
    rowsAfter: newGrid.length,
    uniqueBefore: oldIx.order.length,
    uniqueAfter: newIx.order.length,
    fillNotes: [],
    events: [],
  };
  if (oldIx.pidI < 0) {
    empty.events.push({
      event: 'ERROR',
      pid: '',
      enterprise: '',
      team: '',
      column: 'product_detail_id',
      oldValue: '',
      newValue: '',
      detail: 'product_detail_id is missing from the comparison columns, so row-level changes were not listed.',
    });
    return empty;
  }

  var events = [];
  var added = 0;
  var removed = 0;
  var cells = 0;
  var changedProducts = {};
  var entI = ondColByName_(colNames, 'enterprise_name');
  var teamI = ondColByName_(colNames, 'team_name');
  var i;
  var pid;

  for (i = 0; i < newIx.order.length; i++) {
    pid = newIx.order[i];
    if (oldIx.map[pid]) continue;
    added++;
    var nrow = newIx.map[pid];
    events.push({
      event: 'ROW_ADDED',
      pid: pid,
      enterprise: ondDisplayCell_(ondCellAt_(nrow, entI)),
      team: ondDisplayCell_(ondCellAt_(nrow, teamI)),
      column: '',
      oldValue: '',
      newValue: '',
      detail: ondRowSnapshot_(nrow, colNames),
    });
  }

  for (i = 0; i < oldIx.order.length; i++) {
    pid = oldIx.order[i];
    if (newIx.map[pid]) continue;
    removed++;
    var orow = oldIx.map[pid];
    events.push({
      event: 'ROW_REMOVED',
      pid: pid,
      enterprise: ondDisplayCell_(ondCellAt_(orow, entI)),
      team: ondDisplayCell_(ondCellAt_(orow, teamI)),
      column: '',
      oldValue: '',
      newValue: '',
      detail: ondRowSnapshot_(orow, colNames),
    });
  }

  for (i = 0; i < newIx.order.length; i++) {
    pid = newIx.order[i];
    if (!oldIx.map[pid]) continue;
    var before = oldIx.map[pid];
    var after = newIx.map[pid];
    for (var c = 0; c < colNames.length; c++) {
      if (c === newIx.pidI) continue;
      if (ondValuesEqual_(before[c], after[c])) continue;
      cells++;
      changedProducts[pid] = true;
      events.push({
        event: 'VALUE_CHANGED',
        pid: pid,
        enterprise: ondDisplayCell_(ondCellAt_(after, entI)) || ondDisplayCell_(ondCellAt_(before, entI)),
        team: ondDisplayCell_(ondCellAt_(after, teamI)) || ondDisplayCell_(ondCellAt_(before, teamI)),
        column: colNames[c],
        oldValue: ondDisplayCell_(before[c]),
        newValue: ondDisplayCell_(after[c]),
        detail: '',
      });
    }
  }

  var oldFill = ondColumnFillCounts_(oldGrid, colNames.length);
  var newFill = ondColumnFillCounts_(newGrid, colNames.length);
  var fillNotes = [];
  var fillEvents = [];
  for (var f = 0; f < colNames.length; f++) {
    if (f === newIx.pidI) continue;
    if (oldFill[f] === 0 && newFill[f] > 0) {
      var gained = colNames[f] + ' was empty and now has ' + newFill[f] + ' value(s)';
      fillNotes.push(gained);
      fillEvents.push({
        event: 'COLUMN',
        pid: '',
        enterprise: '',
        team: '',
        column: colNames[f],
        oldValue: '0 filled',
        newValue: String(newFill[f]) + ' filled',
        detail: gained,
      });
    } else if (oldFill[f] > 0 && newFill[f] === 0) {
      var cleared = colNames[f] + ' had ' + oldFill[f] + ' value(s) and is now empty';
      fillNotes.push(cleared);
      fillEvents.push({
        event: 'COLUMN',
        pid: '',
        enterprise: '',
        team: '',
        column: colNames[f],
        oldValue: String(oldFill[f]) + ' filled',
        newValue: '0 filled',
        detail: cleared,
      });
    }
  }

  return {
    added: added,
    removed: removed,
    cells: cells,
    productsChanged: ondObjectKeyCount_(changedProducts),
    duplicateNew: newIx.dupes,
    duplicateOld: oldIx.dupes,
    blankNew: newIx.blank,
    blankOld: oldIx.blank,
    rowsBefore: oldGrid.length,
    rowsAfter: newGrid.length,
    uniqueBefore: oldIx.order.length,
    uniqueAfter: newIx.order.length,
    fillNotes: fillNotes,
    events: fillEvents.concat(events),
  };
}

function ondChangeCountsByColumn_(events) {
  var counts = {};
  var order = [];
  for (var i = 0; i < events.length; i++) {
    if (!events[i] || events[i].event !== 'VALUE_CHANGED' || !events[i].column) continue;
    if (!counts[events[i].column]) {
      counts[events[i].column] = 0;
      order.push(events[i].column);
    }
    counts[events[i].column]++;
  }
  order.sort(function (a, b) { return counts[b] - counts[a]; });
  var parts = [];
  for (var j = 0; j < order.length; j++) parts.push(order[j] + ' ' + counts[order[j]]);
  return parts.join(', ');
}

function ondCsvColumnEvents_(previousHeaders, currentHeaders) {
  var prevList = previousHeaders || [];
  var currList = currentHeaders || [];
  var hasPrev = prevList.length > 0;
  var prevNorm = {};
  var prevRawByNorm = {};
  var p;
  for (p = 0; p < prevList.length; p++) {
    var pn = ondNormalizeHeaderName_(prevList[p]);
    if (!pn) continue;
    prevNorm[pn] = true;
    if (!prevRawByNorm[pn]) prevRawByNorm[pn] = String(prevList[p]).trim();
  }
  var currNorm = {};
  var events = [];
  var notImported = [];
  var newlySeen = [];
  var missing = [];
  var core = {};
  for (var i = 0; i <= OND_RAW_LAST_METABASE_CORE_INDEX && i < OND_RAW_CORE_HEADERS.length; i++) {
    core[ondNormalizeHeaderName_(OND_RAW_CORE_HEADERS[i])] = true;
  }

  for (var c = 0; c < currList.length; c++) {
    var raw = String(currList[c] || '').trim();
    var norm = ondNormalizeHeaderName_(raw);
    if (!norm) continue;
    currNorm[norm] = raw;
    if (norm === 'catg') continue;
    var targets = ondHeaderAliasTargets_(norm);
    var imported = false;
    for (var t = 0; t < targets.length; t++) {
      if (core[targets[t]]) imported = true;
    }
    if (!imported) notImported.push(raw);
    if (hasPrev && !prevNorm[norm]) {
      newlySeen.push(raw);
      events.push({
        event: 'COLUMN',
        pid: '',
        enterprise: '',
        team: '',
        column: raw,
        oldValue: '',
        newValue: raw,
        detail: imported
          ? 'New email field "' + raw + '". It maps onto an existing Raw_live_METABASE column.'
          : 'New email field "' + raw + '". Columns A–S are the only fields this import writes, so the raw tab gained no new column.',
      });
    }
  }

  if (hasPrev) {
    for (var key in prevNorm) {
      if (!Object.prototype.hasOwnProperty.call(prevNorm, key)) continue;
      if (key === 'catg') continue;
      if (currNorm[key]) continue;
      var prevRaw = prevRawByNorm[key] || key;
      missing.push(prevRaw);
      events.push({
        event: 'COLUMN',
        pid: '',
        enterprise: '',
        team: '',
        column: prevRaw,
        oldValue: prevRaw,
        newValue: '',
        detail: 'Email field "' + prevRaw + '" was in the previous import and is absent from this file.',
      });
    }
  }

  return {
    events: events,
    notImported: notImported,
    newlySeen: newlySeen,
    missing: missing,
  };
}

function ondSheetColumnCountNote_(previousCount, currentCount) {
  previousCount = Number(previousCount || 0);
  currentCount = Number(currentCount || 0);
  if (!previousCount || !currentCount || previousCount === currentCount) return '';
  return 'Raw tab width changed since the previous import: ' +
    ondColNumToLetter_(previousCount) + ' (' + previousCount + ') → ' +
    ondColNumToLetter_(currentCount) + ' (' + currentCount +
    '). This import writes A–S and leaves every other column alone.';
}

function ondShortChangeSummary_(diff, extra) {
  extra = extra || {};
  if (extra.baseline) return 'baseline, ' + diff.rowsAfter + ' rows loaded';
  if (!diff.added && !diff.removed && !diff.cells) return 'no row or cell changes';
  return 'added ' + diff.added + ', removed ' + diff.removed + ', ' + diff.cells + ' cells';
}

function ondBuildRunSummary_(diff, colInfo, extra, truncated, kept, total) {
  colInfo = colInfo || {};
  extra = extra || {};
  var parts = [];
  parts.push('Processed ' + OND_SCRIPT_VERSION);
  if (extra.testRun) parts.push('Manual test (processed label left unchanged)');
  if (extra.parsedCount != null) {
    var filteredText = extra.filteredCount != null ? extra.filteredCount : '?';
    parts.push('Attachment rows ' + extra.parsedCount + ', ' + filteredText + ' left after the conversationalAi filter');
  }
  parts.push('Raw rows ' + diff.rowsBefore + ' → ' + diff.rowsAfter);
  parts.push('Unique ids ' + diff.uniqueBefore + ' → ' + diff.uniqueAfter);
  parts.push('Added ' + diff.added);
  parts.push('Removed ' + diff.removed);
  parts.push('Cell changes ' + diff.cells + ' across ' + diff.productsChanged + ' products');
  var byCol = ondChangeCountsByColumn_(diff.events || []);
  if (byCol) parts.push('By column: ' + byCol);
  if (extra.rowsWritten != null && extra.rowsWritten !== diff.rowsAfter) {
    parts.push('Writer reported ' + extra.rowsWritten + ' rows');
  }
  if (extra.baseline) {
    parts.push('A–S was empty before this import, so this run is the baseline. Added-row lines start on the next import');
  }
  if (diff.duplicateNew) {
    parts.push(diff.duplicateNew + ' extra email rows reused a product_detail_id already seen in this file; comparison keeps the last copy');
  }
  if (diff.duplicateOld) {
    parts.push(diff.duplicateOld + ' extra existing rows reused a product_detail_id; comparison keeps the last copy');
  }
  if (diff.blankNew) {
    parts.push(diff.blankNew + ' email rows had a blank product_detail_id and were left out of the row diff');
  }
  if (extra.firstHeaderSnapshot && colInfo.notImported && colInfo.notImported.length) {
    parts.push('Email fields outside A–S (left off the raw tab): ' + colInfo.notImported.join(', '));
  }
  if (colInfo.newlySeen && colInfo.newlySeen.length) {
    parts.push('New email fields vs previous import: ' + colInfo.newlySeen.join(', '));
  }
  if (colInfo.missing && colInfo.missing.length) {
    parts.push('Email fields missing vs previous import: ' + colInfo.missing.join(', '));
  }
  if (diff.fillNotes && diff.fillNotes.length) parts.push(diff.fillNotes.join('; '));
  if (extra.headerMismatches && extra.headerMismatches.length) {
    parts.push('Row 1 header mismatches: ' + extra.headerMismatches.length + '. First: ' + extra.headerMismatches[0]);
  }
  if (extra.sheetColNote) parts.push(extra.sheetColNote);
  var columnShapeChanged = (colInfo.newlySeen && colInfo.newlySeen.length) ||
    (colInfo.missing && colInfo.missing.length) || extra.sheetColNote;
  if (!extra.baseline && diff.added === 0 && diff.removed === 0 && diff.cells === 0 && !columnShapeChanged) {
    parts.push('Raw data matches the previous import');
  }
  if (truncated) parts.push('Showing ' + kept + ' of ' + total + ' detail lines');
  parts.push('Catg (column T) stays on the sheet formula and is left out of this log');
  return parts.join(' | ');
}

function ondBuildImportLogRows_(meta, diff, colInfo, extra) {
  extra = extra || {};
  colInfo = colInfo || { events: [] };
  diff = diff || { events: [] };
  var columnEvents = colInfo.events ? colInfo.events.slice() : [];
  var changeEvents = diff.events ? diff.events.slice() : [];
  if (extra.baseline) {
    changeEvents = changeEvents.filter(function (e) { return e.event !== 'ROW_ADDED'; });
  }
  var detailEvents = columnEvents.concat(changeEvents);
  var total = detailEvents.length;
  var truncated = total > OND_IMPORT_LOG_MAX_DETAIL;
  var keptEvents = truncated ? detailEvents.slice(0, OND_IMPORT_LOG_MAX_DETAIL) : detailEvents;
  var summaryText = ondBuildRunSummary_(diff, colInfo, extra, truncated, keptEvents.length, total);
  var rows = [ondLogRow_(meta, 'SUMMARY', { detail: summaryText })];
  for (var i = 0; i < keptEvents.length; i++) {
    var ev = keptEvents[i];
    rows.push(ondLogRow_(meta, ev.event || 'VALUE_CHANGED', ev));
  }
  return { rows: rows, truncated: truncated, summaryText: summaryText };
}







function ondReadCoreDataGrid_(ws) {
  var width = OND_RAW_LAST_METABASE_CORE_INDEX + 1;
  var last = ws.getLastRow();
  if (last < METABASE_LIVE_DATA_START) return [];
  var numRows = last - METABASE_LIVE_DATA_START + 1;
  var values = ondRange_(ws, METABASE_LIVE_DATA_START, 1, numRows, width).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    if (!ondRowHasValue_(values[r])) continue;
    out.push(values[r]);
  }
  return out;
}

function ondRowHasValue_(row) {
  if (!row) return false;
  for (var c = 0; c < row.length; c++) {
    if (row[c] !== '' && row[c] !== null && row[c] !== undefined) return true;
  }
  return false;
}

function ondReadSheetGridForHeaders_(ws, colNames) {
  var width = colNames.length;
  if (!width) return [];
  var normToPos = {};
  for (var i = 0; i < colNames.length; i++) normToPos[ondNormalizeHeaderName_(colNames[i])] = i;
  var lastCol = Math.max(ws.getLastColumn(), 1);
  var sheetHeaders = ws.getRange(1, 1, 1, lastCol).getValues()[0];
  var sheetToOut = [];
  for (var c = 0; c < sheetHeaders.length; c++) {
    var n = ondNormalizeHeaderName_(sheetHeaders[c]);
    sheetToOut.push(normToPos[n] === undefined ? -1 : normToPos[n]);
  }
  var lastRow = ws.getLastRow();
  if (lastRow < METABASE_LIVE_DATA_START) return [];
  var values = ws.getRange(METABASE_LIVE_DATA_START, 1, lastRow - METABASE_LIVE_DATA_START + 1, lastCol).getValues();
  var grid = [];
  for (var r = 0; r < values.length; r++) {
    var line = new Array(width);
    for (var w = 0; w < width; w++) line[w] = '';
    var any = false;
    for (var c2 = 0; c2 < values[r].length; c2++) {
      var dest = sheetToOut[c2];
      if (dest === undefined || dest < 0) continue;
      line[dest] = values[r][c2];
      if (values[r][c2] !== '' && values[r][c2] !== null && values[r][c2] !== undefined) any = true;
    }
    if (any) grid.push(line);
  }
  return grid;
}

function ondLoadLastCsvHeaders_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('OND_LAST_CSV_HEADERS') || '[]';
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function ondLoadLastSheetColCount_() {
  try {
    return Number(PropertiesService.getScriptProperties().getProperty('OND_LAST_SHEET_COL_COUNT') || '0') || 0;
  } catch (e) {
    return 0;
  }
}

function ondRememberImportShape_(csvHeaders, sheetColCount) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('OND_LAST_CSV_HEADERS', JSON.stringify(csvHeaders || []));
  if (sheetColCount) props.setProperty('OND_LAST_SHEET_COL_COUNT', String(sheetColCount));
}

function ondRecordImportChangeLog_(ss, info) {
  info = info || {};
  var meta = info.meta || ondLogMeta_({});
  var colNames = info.colNames || [];
  var diff = ondDiffCoreGrids_(info.oldGrid || [], info.newGrid || [], colNames);
  var prevHeaders = ondLoadLastCsvHeaders_();
  var prevWidth = ondLoadLastSheetColCount_();
  var colInfo = ondCsvColumnEvents_(prevHeaders, info.csvHeaders || []);
  var sheetColNote = ondSheetColumnCountNote_(prevWidth, info.sheetColCount);
  if (sheetColNote) {
    colInfo.events.unshift({
      event: 'COLUMN',
      pid: '',
      enterprise: '',
      team: '',
      column: ondColNumToLetter_(Number(info.sheetColCount) || 1),
      oldValue: String(prevWidth),
      newValue: String(info.sheetColCount || ''),
      detail: sheetColNote,
    });
  }
  var extra = {
    testRun: !!meta.testRun,
    parsedCount: info.parsedCount,
    filteredCount: info.filteredCount,
    headerMismatches: info.headerMismatches || [],
    sheetColNote: sheetColNote,
    baseline: !(info.oldGrid && info.oldGrid.length),
    rowsWritten: info.rowsWritten,
    firstHeaderSnapshot: !prevHeaders.length,
  };
  var built = ondBuildImportLogRows_(meta, diff, colInfo, extra);
  ondWriteImportLogSheet_(ss, built.rows);
  try {
    ondRememberImportShape_(info.csvHeaders || [], info.sheetColCount);
  } catch (shapeErr) {
    Logger.log(OND_IMPORT_LOG_SHEET + ' was written, but saving the header memory failed: ' + shapeErr.message);
  }
  Logger.log(OND_IMPORT_LOG_SHEET + ': ' + built.summaryText);
  return {
    short: ondShortChangeSummary_(diff, extra),
    summaryText: built.summaryText,
    diff: diff,
  };
}

function ondWriteStatusLog_(ss, meta, event, detail) {
  try {
    if (!ss) return;
    ondWriteImportLogSheet_(ss, [ondLogRow_(meta, event, { detail: detail })]);
  } catch (e) {
    Logger.log('Could not write ' + OND_IMPORT_LOG_SHEET + ': ' + e.message);
  }
}

function ondLogEventColor_(event) {
  if (event === 'SUMMARY') return '#d6e6f5';
  if (event === 'ROW_ADDED') return '#d9ead3';
  if (event === 'ROW_REMOVED') return '#f4cccc';
  if (event === 'VALUE_CHANGED') return '#fff2cc';
  if (event === 'COLUMN') return '#e6d6f2';
  if (event === 'ERROR') return '#f4cccc';
  return '#ffffff';
}

function ondEnsureImportLogSheet_(ss) {
  var ws = ss.getSheetByName(OND_IMPORT_LOG_SHEET);
  if (!ws) ws = ss.insertSheet(OND_IMPORT_LOG_SHEET);
  ondFormatImportLogSheet_(ws);
  return ws;
}

function ondFormatImportLogSheet_(ws) {
  var cols = OND_LOG_HEADERS.length;
  var a1 = String(ws.getRange(1, 1).getValue() || '');
  if (a1 && a1 !== OND_LOG_HEADERS[0]) {
    throw new Error('Sheet "' + OND_IMPORT_LOG_SHEET + '" already has different headers in row 1. Rename that tab and run the import again.');
  }
  if (a1 !== OND_LOG_HEADERS[0]) {
    ws.getRange(1, 1, 1, cols).setValues([OND_LOG_HEADERS.slice()]);
  }
  ws.setFrozenRows(1);
  ws.setTabColor('#1f4e79');
  var header = ws.getRange(1, 1, 1, cols);
  header.setFontWeight('bold');
  header.setBackground('#1f4e79');
  header.setFontColor('#ffffff');
  header.setNumberFormat('@');
  ws.getRange(1, 1).setNote(
    'Newest import is at the top. SUMMARY describes the whole run. ROW_ADDED, ROW_REMOVED, VALUE_CHANGED, and COLUMN list what changed. Catg (column T) is a sheet formula and is not logged.'
  );
  var widths = [168, 168, 200, 220, 200, 150, 170, 180, 160, 180, 200, 200, 460];
  for (var i = 0; i < widths.length; i++) ws.setColumnWidth(i + 1, widths[i]);
}

function ondPaintLogRows_(ws, startRow, rows) {
  if (!rows.length) return;
  var cols = rows[0].length;
  var backgrounds = [];
  var weights = [];
  for (var i = 0; i < rows.length; i++) {
    var event = rows[i][5];
    var color = ondLogEventColor_(event);
    var weight = (event === 'SUMMARY' || event === 'ERROR') ? 'bold' : 'normal';
    var bg = [];
    var fw = [];
    for (var c = 0; c < cols; c++) {
      bg.push(color);
      fw.push(weight);
    }
    backgrounds.push(bg);
    weights.push(fw);
  }
  var range = ws.getRange(startRow, 1, rows.length, cols);
  range.setBackgrounds(backgrounds);
  range.setFontWeights(weights);
  range.setFontColor('#202124');
  range.setVerticalAlignment('top');
  ws.getRange(startRow, cols, rows.length, 1).setWrap(true);
}

function ondTrimImportLog_(ws) {
  var last = ws.getLastRow();
  var keep = OND_IMPORT_LOG_MAX_ROWS;
  if (last > keep + 1) {
    ws.deleteRows(keep + 2, last - (keep + 1));
  }
}

function ondWriteImportLogSheet_(ss, rows) {
  if (!rows || !rows.length) return;
  var ws = ondEnsureImportLogSheet_(ss);
  var cols = OND_LOG_HEADERS.length;
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i] || rows[i].length !== cols) {
      throw new Error('Log row ' + i + ' width ' + (rows[i] ? rows[i].length : 0) + ' != ' + cols);
    }
  }
  ws.insertRowsAfter(1, rows.length);
  var range = ondRange_(ws, 2, 1, rows.length, cols);
  range.setNumberFormat('@');
  ondSetTableValues_(ws, 2, 1, rows, cols);
  ondPaintLogRows_(ws, 2, rows);
  ondTrimImportLog_(ws);
  if (!ws.getFilter()) {
    ws.getRange(1, 1, Math.max(ws.getLastRow(), 2), cols).createFilter();
  }
}

// =============================================================================
// Utilities
// =============================================================================

/** Run after pasting — confirms import-only build (throws if truncated paste). */
function verifyOndCodeVersion() {
  var need = [
    'runOndDailyPipeline',
    'ondReplaceMetabaseLiveSheet_',
    'ondFindLatestOndMessage_',
    'setupDailyTrigger',
    'diagnoseOndRawImport',
    'ondRecordImportChangeLog_',
    'ondBuildImportLogRows_',
    'ondInstallNextHourlyTrigger_',
    'ondNextUtcMinuteDate_',
  ];
  var missing = [];
  for (var i = 0; i < need.length; i++) {
    try {
      if (eval('typeof ' + need[i]) !== 'function') missing.push(need[i]);
    } catch (e) {
      missing.push(need[i]);
    }
  }
  if (missing.length) {
    throw new Error('WRONG PASTE — missing: ' + missing.join(', '));
  }
  if (String(OND_SCRIPT_VERSION).indexOf('metabase-import-only-v3') < 0) {
    throw new Error('WRONG PASTE — expected OND_SCRIPT_VERSION metabase-import-only-v3 (got ' + OND_SCRIPT_VERSION + ')');
  }
  if (METABASE_LIVE_SHEET !== 'Raw_live_METABASE') {
    throw new Error('WRONG PASTE — METABASE_LIVE_SHEET must be Raw_live_METABASE');
  }
  if (!OND_RAW_PRESERVE_CORE_LAYOUT || OND_RAW_CORE_HEADERS.length !== 20) {
    throw new Error('WRONG PASTE — OND_RAW_CORE_HEADERS must be 20 columns A–T');
  }
  if (OND_METABASE_WRITE_HELPERS) {
    throw new Error('WRONG PASTE — OND_METABASE_WRITE_HELPERS must be false (no extra columns)');
  }
  if (OND_IMPORT_LOG_SHEET !== 'OND_Import_Log') {
    throw new Error('WRONG PASTE — OND_IMPORT_LOG_SHEET must be OND_Import_Log');
  }
  if (OND_LOG_HEADERS.length < 13 || OND_LOG_HEADERS[5] !== 'event') {
    throw new Error('WRONG PASTE — OND_LOG_HEADERS is incomplete');
  }
  if (typeof OND_IMPORT_UTC_MINUTE === 'undefined' || OND_IMPORT_UTC_MINUTE !== 59) {
    throw new Error('WRONG PASTE — OND_IMPORT_UTC_MINUTE must be 59');
  }
  Logger.log('=== OND CODE VERSION: ' + OND_SCRIPT_VERSION + ' ===');
  Logger.log('Core columns A–T: ' + OND_RAW_CORE_HEADERS.join(' | '));
  Logger.log('Mode: Metabase → cols A–S only; Catg (T) never touched');
  Logger.log('Change log tab: ' + OND_IMPORT_LOG_SHEET);
  Logger.log('Clock: minute ' + OND_IMPORT_UTC_MINUTE + ' UTC, then the next hour');
  Logger.log('OK');
}
