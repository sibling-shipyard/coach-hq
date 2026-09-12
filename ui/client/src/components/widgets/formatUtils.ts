export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function formatCompact(value: number) {
  if (value >= 1000) {
    const digits = value >= 10_000 ? 0 : 1;
    return `${(value / 1000).toFixed(digits).replace(/\.0$/, "")}K`;
  }
  return Math.round(value).toLocaleString("en-GB");
}

export function formatMinutesLabel(value: number) {
  const minutes = Math.round(value);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}H${String(minutes % 60).padStart(2, "0")}`
    : `${minutes} MIN`;
}
