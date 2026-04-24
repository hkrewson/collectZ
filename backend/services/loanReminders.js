'use strict';

const pool = require('../db/pool');
const { sendLoanReminderEmail, getSmtpStatus } = require('./email');
const { logActivity, logError } = require('./audit');

function parseBoolean(raw, fallback = false) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function normalizeLoanDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, 10);
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildLoanReminderDeliveryWindowKey(row = {}, phase = null) {
  const normalizedPhase = String(phase || '').trim().toLowerCase() === 'overdue' ? 'overdue' : 'due_soon';
  if (normalizedPhase === 'overdue') {
    return `overdue:${getTodayIsoDate()}`;
  }
  const dueAt = normalizeLoanDateValue(row?.due_at) || 'unknown';
  return `due_soon:${dueAt}`;
}

function buildMediaLoanStatus(row = {}) {
  if (row?.returned_at) return 'returned';
  const dueAt = normalizeLoanDateValue(row?.due_at);
  if (dueAt && dueAt < getTodayIsoDate()) return 'overdue';
  return 'active';
}

function buildLoanReminderPhase(row = {}) {
  if (row?.returned_at) return null;
  const dueAt = normalizeLoanDateValue(row?.due_at);
  if (!dueAt) return null;
  const today = getTodayIsoDate();
  if (dueAt < today) return 'overdue';
  const dueDate = new Date(`${dueAt}T00:00:00Z`);
  const todayDate = new Date(`${today}T00:00:00Z`);
  const daysUntilDue = Math.round((dueDate.getTime() - todayDate.getTime()) / 86400000);
  if (Number.isInteger(daysUntilDue) && daysUntilDue >= 0 && daysUntilDue <= 3) return 'due_soon';
  return null;
}

function getLoanReminderTrackingField(phase) {
  return String(phase || '').trim().toLowerCase() === 'overdue'
    ? 'overdue_reminder_last_sent_at'
    : 'due_soon_reminder_last_sent_at';
}

function wasLoanReminderSentToday(row = {}, phase = null) {
  const trackingField = phase ? getLoanReminderTrackingField(phase) : 'reminder_last_sent_at';
  const raw = row?.[trackingField];
  const sentAt = raw instanceof Date && !Number.isNaN(raw.getTime())
    ? raw.toISOString()
    : String(raw || '').trim();
  if (!sentAt) return false;
  return sentAt.slice(0, 10) === getTodayIsoDate();
}

function hasLoanReminderBeenSentForCurrentPhase(row = {}, phase = null) {
  if (!phase) return false;
  const trackingField = getLoanReminderTrackingField(phase);
  return Boolean(row?.[trackingField]);
}

function isAutomaticReminderEligible(row = {}) {
  if (row?.returned_at) return false;
  if (!String(row?.borrower_email || '').trim()) return false;
  const phase = buildLoanReminderPhase(row);
  if (!phase) return false;
  if (phase === 'due_soon') {
    return !hasLoanReminderBeenSentForCurrentPhase(row, phase);
  }
  return !wasLoanReminderSentToday(row, phase);
}

function formatMediaLoanRow(row = {}) {
  const status = buildMediaLoanStatus(row);
  const reminderPhase = buildLoanReminderPhase(row);
  const reminderSentToday = wasLoanReminderSentToday(row);
  return {
    id: Number(row.id || 0) || null,
    media_id: Number(row.media_id || 0) || null,
    library_id: Number(row.library_id || 0) || null,
    space_id: Number(row.space_id || 0) || null,
    borrower_name: String(row.borrower_name || '').trim() || null,
    borrower_email: String(row.borrower_email || '').trim() || null,
    loaned_at: normalizeLoanDateValue(row.loaned_at),
    due_at: normalizeLoanDateValue(row.due_at),
    returned_at: normalizeLoanDateValue(row.returned_at),
    loan_format: String(row.loan_format || '').trim() || null,
    notes: row.notes || null,
    reminder_last_sent_at: row.reminder_last_sent_at || null,
    due_soon_reminder_last_sent_at: row.due_soon_reminder_last_sent_at || null,
    overdue_reminder_last_sent_at: row.overdue_reminder_last_sent_at || null,
    reminder_status: String(row.reminder_status || '').trim() || 'pending',
    created_by: Number(row.created_by || 0) || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    media: row.media_id ? {
      id: Number(row.media_id || 0) || null,
      title: String(row.media_title || '').trim() || null,
      media_type: String(row.media_type || '').trim() || null,
      poster_path: String(row.poster_path || '').trim() || null,
      year: Number(row.year || 0) || null
    } : null,
    status,
    is_overdue: status === 'overdue',
    reminder_phase: reminderPhase,
    reminder_eligible: Boolean(reminderPhase && row?.borrower_email && !reminderSentToday),
    reminder_sent_today: reminderSentToday
  };
}

function buildLoanReminderUpdateClause(phase) {
  const trackingField = getLoanReminderTrackingField(phase);
  return `${trackingField} = CURRENT_TIMESTAMP`;
}

function buildSystemAuditRequest() {
  return {
    headers: {},
    user: null,
    ip: '127.0.0.1'
  };
}

async function insertLoanReminderEvent(row = {}, {
  phase = null,
  triggerSource = 'manual',
  status = 'sent',
  req = null,
  failureSummary = null
} = {}) {
  const normalizedPhase = String(phase || '').trim().toLowerCase() === 'overdue' ? 'overdue' : 'due_soon';
  const normalizedTriggerSource = String(triggerSource || '').trim().toLowerCase() === 'automatic' ? 'automatic' : 'manual';
  const normalizedStatus = ['sent', 'skipped', 'failed'].includes(String(status || '').trim().toLowerCase())
    ? String(status || '').trim().toLowerCase()
    : 'sent';
  await pool.query(
    `INSERT INTO media_loan_reminders (
       loan_id,
       media_id,
       library_id,
       space_id,
       phase,
       trigger_source,
       status,
       sent_at,
       triggered_by_user_id,
       failure_summary,
       delivery_window_key
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, $9, $10
     )`,
    [
      row?.id || null,
      row?.media_id || null,
      row?.library_id || null,
      row?.space_id || null,
      normalizedPhase,
      normalizedTriggerSource,
      normalizedStatus,
      Number(req?.user?.id || 0) || null,
      failureSummary ? String(failureSummary).slice(0, 500) : null,
      buildLoanReminderDeliveryWindowKey(row, normalizedPhase)
    ]
  );
}

function getAutomaticLoanReminderRuntimeConfig() {
  return {
    enabled: parseBoolean(process.env.AUTO_LOAN_REMINDERS_ENABLED, false),
    intervalMinutes: Math.max(5, Number(process.env.AUTO_LOAN_REMINDER_INTERVAL_MINUTES || 60) || 60),
    batchSize: Math.max(1, Math.min(500, Number(process.env.AUTO_LOAN_REMINDER_BATCH_SIZE || 100) || 100))
  };
}

async function loadAutomaticReminderCandidateRows(limit = 100) {
  const result = await pool.query(
    `SELECT ml.*,
            m.title AS media_title,
            m.media_type,
            m.poster_path,
            m.year
       FROM media_loans ml
       JOIN media m ON m.id = ml.media_id
      WHERE ml.returned_at IS NULL
        AND COALESCE(ml.borrower_email, '') <> ''
        AND ml.due_at <= (CURRENT_DATE + INTERVAL '3 days')
      ORDER BY
        CASE WHEN ml.due_at < CURRENT_DATE THEN 0 ELSE 1 END ASC,
        ml.due_at ASC,
        ml.id ASC
      LIMIT $1`,
    [limit]
  );
  return result.rows || [];
}

async function sendReminderForLoanRow(row, phase, { source = 'manual', req = null } = {}) {
  const normalizedPhase = String(phase || '').trim().toLowerCase() === 'overdue' ? 'overdue' : 'due_soon';
  let reminderResult = null;
  try {
    reminderResult = await sendLoanReminderEmail({
      to: row.borrower_email,
      borrowerName: row.borrower_name || '',
      title: row.media?.title || row.media_title || '',
      dueAt: row.due_at || '',
      phase: normalizedPhase
    });
  } catch (error) {
    await insertLoanReminderEvent(row, {
      phase: normalizedPhase,
      triggerSource: source,
      status: 'failed',
      req,
      failureSummary: error?.message || 'send_failed'
    });
    throw error;
  }
  if (!reminderResult?.sent) {
    await insertLoanReminderEvent(row, {
      phase: normalizedPhase,
      triggerSource: source,
      status: 'failed',
      req,
      failureSummary: reminderResult?.reason || 'send_failed'
    });
    return reminderResult || { attempted: true, sent: false, reason: 'send_failed' };
  }

  const trackingClause = buildLoanReminderUpdateClause(normalizedPhase);
  await pool.query(
    `UPDATE media_loans
        SET reminder_last_sent_at = CURRENT_TIMESTAMP,
            ${trackingClause},
            reminder_status = 'sent',
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [row.id]
  );
  await insertLoanReminderEvent(row, {
    phase: normalizedPhase,
    triggerSource: source,
    status: 'sent',
    req
  });

  const auditReq = req || buildSystemAuditRequest();
  await logActivity(auditReq, source === 'automatic' ? 'media.loan.reminder.auto_send' : 'media.loan.reminder.send', 'media_loan', row.id, {
    mediaId: row.media_id || null,
    borrowerName: row.borrower_name || null,
    borrowerEmail: row.borrower_email || null,
    reminderPhase: normalizedPhase,
    reminderSource: source
  });

  return {
    attempted: true,
    sent: true,
    phase: normalizedPhase,
    reason: null
  };
}

async function runAutomaticLoanReminderSweep(options = {}) {
  const {
    limit,
    reason = 'manual_trigger',
    logSummary = true
  } = options;
  const runtimeConfig = getAutomaticLoanReminderRuntimeConfig();
  const batchSize = Math.max(1, Number(limit || runtimeConfig.batchSize) || runtimeConfig.batchSize);
  const smtpStatus = await getSmtpStatus();
  const summary = {
    enabled: runtimeConfig.enabled,
    reason,
    intervalMinutes: runtimeConfig.intervalMinutes,
    batchSize,
    smtpConfigured: Boolean(smtpStatus?.configured),
    scanned: 0,
    eligible: 0,
    sent: 0,
    dueSoonSent: 0,
    overdueSent: 0,
    skippedAlreadySent: 0,
    skippedNoEmail: 0,
    skippedNotEligible: 0,
    failed: 0
  };

  if (!smtpStatus?.configured) {
    if (logSummary) {
      await logActivity(buildSystemAuditRequest(), 'media.loan.reminder.auto_run', 'media_loan', null, {
        ...summary,
        outcome: 'smtp_not_configured'
      });
    }
    return summary;
  }

  const rows = await loadAutomaticReminderCandidateRows(batchSize);
  summary.scanned = rows.length;

  for (const rawRow of rows) {
    const row = formatMediaLoanRow(rawRow);
    const phase = buildLoanReminderPhase(row);
    if (!row.borrower_email) {
      summary.skippedNoEmail += 1;
      continue;
    }
    if (!phase || !isAutomaticReminderEligible(rawRow)) {
      if (phase && wasLoanReminderSentToday(rawRow, phase)) {
        summary.skippedAlreadySent += 1;
      } else {
        summary.skippedNotEligible += 1;
      }
      continue;
    }

    summary.eligible += 1;
    try {
      const sendResult = await sendReminderForLoanRow(rawRow, phase, { source: 'automatic' });
      if (sendResult?.sent) {
        summary.sent += 1;
        if (phase === 'overdue') summary.overdueSent += 1;
        else summary.dueSoonSent += 1;
      } else {
        summary.failed += 1;
        logError('loan reminder automation send', new Error(sendResult?.reason || 'send_failed'));
      }
    } catch (error) {
      summary.failed += 1;
      logError('loan reminder automation send', error);
      await logActivity(buildSystemAuditRequest(), 'media.loan.reminder.auto_fail', 'media_loan', row.id, {
        mediaId: row.media_id || null,
        borrowerEmail: row.borrower_email || null,
        reminderPhase: phase,
        reason: error?.message || 'send_failed'
      });
    }
  }

  if (logSummary) {
    await logActivity(buildSystemAuditRequest(), 'media.loan.reminder.auto_run', 'media_loan', null, summary);
  }

  return summary;
}

function startAutomaticLoanReminderScheduler() {
  const runtimeConfig = getAutomaticLoanReminderRuntimeConfig();
  if (!runtimeConfig.enabled) return null;

  const runSweep = async () => {
    try {
      await runAutomaticLoanReminderSweep({
        reason: 'scheduled',
        logSummary: true
      });
    } catch (error) {
      logError('loan reminder automation sweep', error);
    }
  };

  const timer = setInterval(runSweep, runtimeConfig.intervalMinutes * 60 * 1000);
  timer.unref();
  void runSweep();
  return timer;
}

module.exports = {
  normalizeLoanDateValue,
  buildMediaLoanStatus,
  buildLoanReminderPhase,
  wasLoanReminderSentToday,
  formatMediaLoanRow,
  getLoanReminderTrackingField,
  getAutomaticLoanReminderRuntimeConfig,
  sendReminderForLoanRow,
  runAutomaticLoanReminderSweep,
  startAutomaticLoanReminderScheduler,
  isAutomaticReminderEligible,
  buildLoanReminderDeliveryWindowKey
};
