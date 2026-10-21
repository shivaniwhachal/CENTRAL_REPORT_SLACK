/**
 * Paste these pieces over the matching parts of the OND Apps Script, then
 * run setupDailyTrigger once from the editor.
 *
 * Metabase sends the CSV at minute 59 UTC. This schedules the next import
 * for minute 59 UTC, and each run schedules the one after it.
 * Apps Script may start that run a few minutes after :59. The job still
 * imports the newest mail already in Gmail, and it will not replace the
 * sheet with an older mail.
 */

var OND_SCRIPT_VERSION = '2026-10-21-metabase-import-only-v3-hourly-59-utc';
var OND_IMPORT_UTC_MINUTE = 59;

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

/**
 * In runOndEmailJob_, replace the finally block with this one
 * so the hourly clock keeps going after each import.
 *
 *   } finally {
 *     try {
 *       if (opts.markProcessed) ondInstallNextHourlyTrigger_();
 *     } catch (scheduleErr) {
 *       Logger.log('Could not schedule the next hourly import: ' + scheduleErr.message);
 *     }
 *     lock.releaseLock();
 *   }
 */

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

/**
 * In ondFindLatestOndMessage_, change the skip line to:
 *   if (skipProcessed && ondIsMessageProcessed_(cand.getId(), cand.getDate())) continue;
 *
 * Where the import succeeds, change the mark line to:
 *   if (opts.markProcessed) ondMarkEmailProcessed_(thread, messageId, message.getDate());
 */
