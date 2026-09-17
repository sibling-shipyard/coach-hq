// ../engine/lib/current-week.mts
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

// ../engine/lib/currentWeekRollover.mts
function mondayOnOrBefore(dateString) {
  const date = /* @__PURE__ */ new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  return addDays(dateString, 1 - day);
}
function needsRollover(runtime, todayDateStr) {
  const data = runtime.data;
  if (!data) return false;
  if (data.data_status === "live" && runtime.availability.status === "stale") return true;
  if (data.data_status === "placeholder" && todayDateStr > data.week.end_date) return true;
  return false;
}
function buildRolloverPlaceholder(timezone, todayDateStr, now) {
  const startDate = mondayOnOrBefore(todayDateStr);
  const endDate = addDays(startDate, 6);
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: addDays(startDate, i),
    intent: null,
    coach_note: null,
    sessions: []
  }));
  return {
    schema_version: 1,
    data_status: "placeholder",
    timezone,
    week: {
      id: getIsoWeekId(startDate),
      start_date: startDate,
      end_date: endDate,
      focus: null,
      guardrails: []
    },
    coach_read: null,
    days,
    updated_at: now.toISOString(),
    updated_by: "rollover",
    trace_id: "rollover"
  };
}
export {
  buildRolloverPlaceholder,
  needsRollover
};
