// ../engine/lib/current-week.mts
var CURRENT_WEEK_SCHEMA_VERSION = 1;
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var ISO_TIMESTAMP_WITH_ZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/;
var EVIDENCE_REF_PATTERN = /^[a-z][a-z0-9_]*$/;
var TOPIC_PATTERN = /^[a-z][a-z0-9_]*$/;
var QUALIFIED_ACTIVITY_ID_PATTERN = /^[a-z][a-z0-9_-]*:[^\s:]+$/;
var ROOT_KEYS = [
  "schema_version",
  "data_status",
  "timezone",
  "week",
  "coach_read",
  "days",
  "coach_comments",
  "updated_at",
  "updated_by",
  "trace_id"
];
var WEEK_KEYS = [
  "id",
  "start_date",
  "end_date",
  "focus",
  "guardrails"
];
var DAY_KEYS = ["date", "intent", "coach_note", "sessions"];
var SESSION_KEYS = [
  "id",
  "origin",
  "discipline",
  "kind",
  "title",
  "priority",
  "status",
  "planned_duration_min",
  "planned_load",
  "template_id",
  "session_file",
  "coach_note",
  "original_date",
  "completion_activity_ids"
];
var COACH_READ_KEYS = [
  "headline",
  "body",
  "valid_from",
  "valid_until"
];
var COACH_COMMENT_KEYS = [
  "id",
  "topic",
  ...COACH_READ_KEYS,
  "tone",
  "confidence",
  "evidence_refs"
];
var DATA_STATUSES = ["placeholder", "draft", "live"];
var SESSION_ORIGINS = ["planned", "unplanned"];
var SESSION_PRIORITIES = ["anchor", "support", "optional"];
var SESSION_STATUSES = ["planned", "done", "skipped"];
var COACH_TONES = ["positive", "steady", "caution", "recovery"];
var COACH_CONFIDENCES = ["low", "medium", "high"];
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateKeys(value, allowedKeys, path, issues) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(`${path}.${key} is not part of schema v1`);
    }
  }
  for (const key of allowedKeys) {
    if (!(key in value)) {
      issues.push(`${path}.${key} is required`);
    }
  }
}
function isNonEmptyString(value, maxLength = Number.POSITIVE_INFINITY) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}
function validateRequiredString(value, path, issues, maxLength = Number.POSITIVE_INFINITY) {
  if (!isNonEmptyString(value, maxLength)) {
    issues.push(`${path} must be a non-empty string${Number.isFinite(maxLength) ? ` of at most ${maxLength} characters` : ""}`);
    return false;
  }
  return true;
}
function validateNullableString(value, path, issues, maxLength = Number.POSITIVE_INFINITY) {
  if (value === null) return true;
  return validateRequiredString(value, path, issues, maxLength);
}
function isDateString(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validateDate(value, path, issues) {
  if (!isDateString(value)) {
    issues.push(`${path} must be a real YYYY-MM-DD date`);
    return false;
  }
  return true;
}
function addDays(dateString, days) {
  const date = /* @__PURE__ */ new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function getIsoWeekId(dateString) {
  const date = /* @__PURE__ */ new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const daysSinceYearStart = Math.floor((date.getTime() - yearStart.getTime()) / 864e5) + 1;
  const week = Math.ceil(daysSinceYearStart / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
function validateTimeZone(value, path, issues) {
  if (!validateRequiredString(value, path, issues, 64)) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(/* @__PURE__ */ new Date());
    return true;
  } catch {
    issues.push(`${path} must be a valid IANA time-zone identifier`);
    return false;
  }
}
function validateEnum(value, allowed, path, issues) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(`${path} must be one of: ${allowed.join(", ")}`);
    return false;
  }
  return true;
}
function validateStringArray(value, path, issues, options = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return false;
  }
  const { minItems = 0, maxItems = Number.POSITIVE_INFINITY, maxItemLength = Number.POSITIVE_INFINITY, pattern } = options;
  if (value.length < minItems || value.length > maxItems) {
    issues.push(`${path} must contain between ${minItems} and ${Number.isFinite(maxItems) ? maxItems : "any number of"} item(s)`);
  }
  const seen = /* @__PURE__ */ new Set();
  value.forEach((item, index) => {
    if (!isNonEmptyString(item, maxItemLength)) {
      issues.push(`${path}[${index}] must be a non-empty string${Number.isFinite(maxItemLength) ? ` of at most ${maxItemLength} characters` : ""}`);
      return;
    }
    if (pattern && !pattern.test(item)) {
      issues.push(`${path}[${index}] has an invalid format`);
    }
    if (seen.has(item)) {
      issues.push(`${path}[${index}] duplicates ${item}`);
    }
    seen.add(item);
  });
  return value.every((item) => typeof item === "string");
}
function validateCommentaryWindow(value, path, issues) {
  const fromValid = validateDate(value.valid_from, `${path}.valid_from`, issues);
  const untilValid = validateDate(value.valid_until, `${path}.valid_until`, issues);
  const validFrom = fromValid ? value.valid_from : null;
  const validUntil = untilValid ? value.valid_until : null;
  if (validFrom && validUntil && validUntil < validFrom) {
    issues.push(`${path}.valid_until must be on or after valid_from`);
  }
}
function validateCoachRead(value, path, issues) {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  validateKeys(value, COACH_READ_KEYS, path, issues);
  validateRequiredString(value.headline, `${path}.headline`, issues, 72);
  validateRequiredString(value.body, `${path}.body`, issues, 280);
  validateCommentaryWindow(value, path, issues);
}
function validateCoachComment(value, index, issues) {
  const path = `current_week.coach_comments[${index}]`;
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  validateKeys(value, COACH_COMMENT_KEYS, path, issues);
  validateRequiredString(value.id, `${path}.id`, issues, 80);
  if (validateRequiredString(value.topic, `${path}.topic`, issues, 64) && !TOPIC_PATTERN.test(value.topic)) {
    issues.push(`${path}.topic must use lower snake_case`);
  }
  validateRequiredString(value.headline, `${path}.headline`, issues, 48);
  validateRequiredString(value.body, `${path}.body`, issues, 140);
  validateEnum(value.tone, COACH_TONES, `${path}.tone`, issues);
  validateEnum(value.confidence, COACH_CONFIDENCES, `${path}.confidence`, issues);
  validateStringArray(value.evidence_refs, `${path}.evidence_refs`, issues, {
    minItems: 1,
    maxItems: 8,
    maxItemLength: 64,
    pattern: EVIDENCE_REF_PATTERN
  });
  validateCommentaryWindow(value, path, issues);
}
function validateSession(value, dayDate, path, issues, sessionIds) {
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  validateKeys(value, SESSION_KEYS, path, issues);
  if (validateRequiredString(value.id, `${path}.id`, issues, 100)) {
    if (sessionIds.has(value.id)) {
      issues.push(`${path}.id must be unique within the week`);
    }
    sessionIds.add(value.id);
  }
  const originValid = validateEnum(value.origin, SESSION_ORIGINS, `${path}.origin`, issues);
  validateRequiredString(value.discipline, `${path}.discipline`, issues, 48);
  validateRequiredString(value.kind, `${path}.kind`, issues, 48);
  validateRequiredString(value.title, `${path}.title`, issues, 96);
  if (value.priority !== null) {
    validateEnum(value.priority, SESSION_PRIORITIES, `${path}.priority`, issues);
  }
  const statusValid = validateEnum(value.status, SESSION_STATUSES, `${path}.status`, issues);
  if (originValid && value.origin === "planned" && value.priority === null) {
    issues.push(`${path}.priority is required for a planned session`);
  }
  if (originValid && value.origin === "unplanned" && value.priority !== null) {
    issues.push(`${path}.priority must be null for an unplanned session`);
  }
  if (originValid && statusValid && value.origin === "unplanned" && value.status !== "done") {
    issues.push(`${path}.status must be done for an unplanned session`);
  }
  if (value.planned_duration_min !== null && (!Number.isInteger(value.planned_duration_min) || Number(value.planned_duration_min) <= 0)) {
    issues.push(`${path}.planned_duration_min must be a positive integer or null`);
  }
  if (value.planned_load !== null && (typeof value.planned_load !== "number" || !Number.isFinite(value.planned_load) || value.planned_load <= 0)) {
    issues.push(`${path}.planned_load must be a positive load-points number or null`);
  }
  if (originValid && value.origin === "unplanned" && value.planned_load !== null) {
    issues.push(`${path}.planned_load must be null for an unplanned session`);
  }
  validateNullableString(value.template_id, `${path}.template_id`, issues, 100);
  if (validateNullableString(value.session_file, `${path}.session_file`, issues, 160) && typeof value.session_file === "string") {
    if (!/^(user_data\/activities\/workout_plans\/sessions\/|sessions\/)[^/]+\.json$/.test(value.session_file)) {
      issues.push(`${path}.session_file must be a user_data/activities/workout_plans/sessions/*.json path`);
    }
  }
  validateNullableString(value.coach_note, `${path}.coach_note`, issues, 160);
  const originalDateValid = value.original_date === null ? true : validateDate(value.original_date, `${path}.original_date`, issues);
  if (originalDateValid && typeof value.original_date === "string" && dayDate && value.original_date === dayDate) {
    issues.push(`${path}.original_date must differ from the current day date`);
  }
  if (originValid && value.origin === "unplanned" && value.original_date !== null) {
    issues.push(`${path}.original_date must be null for an unplanned session`);
  }
  const completionIdsValid = validateStringArray(
    value.completion_activity_ids,
    `${path}.completion_activity_ids`,
    issues,
    { maxItems: 8, maxItemLength: 160, pattern: QUALIFIED_ACTIVITY_ID_PATTERN }
  );
  if (statusValid && value.status !== "done" && completionIdsValid && Array.isArray(value.completion_activity_ids) && value.completion_activity_ids.length > 0) {
    issues.push(`${path}.completion_activity_ids must be empty unless status is done`);
  }
}
function validateDay(value, index, expectedDate, issues, sessionIds) {
  const path = `current_week.days[${index}]`;
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return;
  }
  validateKeys(value, DAY_KEYS, path, issues);
  const dateValid = validateDate(value.date, `${path}.date`, issues);
  if (dateValid && expectedDate && value.date !== expectedDate) {
    issues.push(`${path}.date must be ${expectedDate}`);
  }
  validateNullableString(value.intent, `${path}.intent`, issues, 48);
  validateNullableString(value.coach_note, `${path}.coach_note`, issues, 160);
  if (!Array.isArray(value.sessions)) {
    issues.push(`${path}.sessions must be an array`);
    return;
  }
  value.sessions.forEach((session, sessionIndex) => {
    validateSession(
      session,
      dateValid ? value.date : null,
      `${path}.sessions[${sessionIndex}]`,
      issues,
      sessionIds
    );
  });
}
function validateWeek(value, issues) {
  const path = "current_week.week";
  if (!isObject(value)) {
    issues.push(`${path} must be an object`);
    return { startDate: null, endDate: null };
  }
  validateKeys(value, WEEK_KEYS, path, issues);
  const idValid = validateRequiredString(value.id, `${path}.id`, issues, 16);
  const startValid = validateDate(value.start_date, `${path}.start_date`, issues);
  const endValid = validateDate(value.end_date, `${path}.end_date`, issues);
  validateNullableString(value.focus, `${path}.focus`, issues, 160);
  validateStringArray(value.guardrails, `${path}.guardrails`, issues, {
    maxItems: 6,
    maxItemLength: 160
  });
  const startDate = startValid ? value.start_date : null;
  const endDate = endValid ? value.end_date : null;
  if (startDate) {
    const start = /* @__PURE__ */ new Date(`${startDate}T00:00:00Z`);
    if (start.getUTCDay() !== 1) {
      issues.push(`${path}.start_date must be a Monday`);
    }
    if (idValid && value.id !== getIsoWeekId(startDate)) {
      issues.push(`${path}.id must match the ISO week containing start_date`);
    }
  }
  if (startDate && endDate && endDate !== addDays(startDate, 6)) {
    issues.push(`${path}.end_date must be exactly six days after start_date`);
  }
  return { startDate, endDate };
}
function formatDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function getAvailability(data, now) {
  if (data.data_status === "placeholder") {
    return { status: "placeholder", available: false, reason: "The weekly plan has not been confirmed yet." };
  }
  if (data.data_status === "draft") {
    return { status: "draft", available: false, reason: "The weekly plan is still being confirmed." };
  }
  const today = formatDateInTimeZone(now, data.timezone);
  if (today < data.week.start_date) {
    return { status: "upcoming", available: false, reason: "The live weekly plan has not started yet." };
  }
  if (today <= data.week.end_date) {
    return { status: "current", available: true, reason: "The live weekly plan is current." };
  }
  if (today === addDays(data.week.end_date, 1)) {
    return { status: "grace", available: true, reason: "The live weekly plan is in its one-day rollover grace period." };
  }
  return { status: "stale", available: false, reason: "The weekly plan is beyond its rollover grace period." };
}
function isCommentaryCurrent(commentary, localDate) {
  return commentary.valid_from <= localDate && localDate <= commentary.valid_until;
}
function parseCurrentWeek(input, now = /* @__PURE__ */ new Date()) {
  const issues = [];
  if (!isObject(input)) {
    return {
      data: null,
      availability: { status: "invalid", available: false, reason: "Weekly data is not a JSON object." },
      coachRead: null,
      coachComments: [],
      issues: ["current_week must be an object"]
    };
  }
  validateKeys(input, ROOT_KEYS, "current_week", issues);
  if (input.schema_version !== CURRENT_WEEK_SCHEMA_VERSION) {
    issues.push(`current_week.schema_version must be ${CURRENT_WEEK_SCHEMA_VERSION}`);
  }
  const dataStatusValid = validateEnum(input.data_status, DATA_STATUSES, "current_week.data_status", issues);
  const timezoneValid = validateTimeZone(input.timezone, "current_week.timezone", issues);
  const { startDate } = validateWeek(input.week, issues);
  if (input.coach_read !== null) {
    validateCoachRead(input.coach_read, "current_week.coach_read", issues);
  }
  if (!Array.isArray(input.days)) {
    issues.push("current_week.days must be an array");
  } else {
    if (input.days.length !== 7) {
      issues.push("current_week.days must contain exactly seven days");
    }
    const sessionIds = /* @__PURE__ */ new Set();
    input.days.forEach((day, index) => {
      validateDay(day, index, startDate ? addDays(startDate, index) : null, issues, sessionIds);
    });
  }
  if (!Array.isArray(input.coach_comments)) {
    issues.push("current_week.coach_comments must be an array");
  } else {
    if (input.coach_comments.length > 3) {
      issues.push("current_week.coach_comments must contain at most three comments");
    }
    const commentIds = /* @__PURE__ */ new Set();
    input.coach_comments.forEach((comment, index) => {
      validateCoachComment(comment, index, issues);
      if (isObject(comment) && typeof comment.id === "string") {
        if (commentIds.has(comment.id)) {
          issues.push(`current_week.coach_comments[${index}].id must be unique`);
        }
        commentIds.add(comment.id);
      }
    });
  }
  if (typeof input.updated_at !== "string" || !ISO_TIMESTAMP_WITH_ZONE_PATTERN.test(input.updated_at) || Number.isNaN(Date.parse(input.updated_at))) {
    issues.push("current_week.updated_at must be an ISO 8601 timestamp with a timezone");
  }
  validateRequiredString(input.updated_by, "current_week.updated_by", issues, 64);
  validateRequiredString(input.trace_id, "current_week.trace_id", issues, 64);
  if (dataStatusValid && input.data_status === "live" && input.coach_read === null) {
    issues.push("current_week.coach_read is required when data_status is live");
  }
  if (dataStatusValid && input.data_status === "placeholder" && (input.coach_read !== null || Array.isArray(input.coach_comments) && input.coach_comments.length > 0)) {
    issues.push("placeholder weekly data must not contain Coach commentary");
  }
  if (issues.length > 0 || !timezoneValid) {
    return {
      data: null,
      availability: { status: "invalid", available: false, reason: "Weekly data failed runtime validation." },
      coachRead: null,
      coachComments: [],
      issues
    };
  }
  const data = input;
  const availability = getAvailability(data, now);
  if (!availability.available) {
    return { data, availability, coachRead: null, coachComments: [], issues: [] };
  }
  const localDate = formatDateInTimeZone(now, data.timezone);
  return {
    data,
    availability,
    coachRead: data.coach_read && isCommentaryCurrent(data.coach_read, localDate) ? data.coach_read : null,
    coachComments: data.coach_comments.filter((comment) => isCommentaryCurrent(comment, localDate)),
    issues: []
  };
}
export {
  CURRENT_WEEK_SCHEMA_VERSION,
  parseCurrentWeek
};
