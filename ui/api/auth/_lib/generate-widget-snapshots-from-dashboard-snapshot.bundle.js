// shared/warm-instrument/tokens.json
var tokens_default = {
  palette: {
    paper: "#fbf8f1",
    desk: "#e8e2d7",
    surfaceMuted: "#f3eee3",
    ink: "#2b2d29",
    inkMuted: "#75746b",
    inkFaint: "#98998f",
    accent: "#7f3728",
    accentDark: "#652b20",
    alarmBg: "#e4e4ec",
    alarmFg: "#4b5578"
  },
  lines: {
    border: "rgba(84, 76, 65, 0.16)",
    borderDashed: "rgba(84, 76, 65, 0.35)",
    headerRule: "#d8d2c6"
  },
  shadows: {
    card: "0 8px 20px rgba(57, 52, 42, 0.08)",
    engine: "0 18px 36px rgba(101, 43, 32, 0.18)"
  },
  radius: {
    cardWebPx: 26,
    cardIosPt: 18
  },
  sports: {
    badminton: { hex: "#1A4731", label: "BDM", mixHex: "#9fc0ad" },
    calisthenics: { hex: "#4F587A", label: "CAL", mixHex: "#aeb2c9" },
    foundation: { hex: "#6D7D4E", label: "FDN", mixHex: "#cdd3a8" },
    cycling: { hex: "#A8702C", label: "RIDE", mixHex: "#e0b06e" },
    run: { hex: "#374151", label: "RUN", mixHex: "#c44020" },
    strength: { hex: "#2D3A5A", label: "STR", mixHex: "#111111" },
    weight_training: { hex: "#3B4A6B", label: "WGT", mixHex: "#3b4a6b" },
    hike: { hex: "#7A5C3A", label: "HIK", mixHex: "#8b6f47" },
    walk: { hex: "#6B7280", label: "WLK", mixHex: "#a8a29e" },
    cricket: { hex: "#4A6741", label: "CRK", mixHex: "#2dd4bf" },
    football: { hex: "#166534", label: "FBL", mixHex: "#e11d48" },
    workout: { hex: "#5B6472", label: "WKT", mixHex: "#6b7280" },
    swim: { hex: "#005F7A", label: "SWM", mixHex: "#0ea5e9" },
    tennis: { hex: "#B5532A", label: "TEN", mixHex: "#B5532A" },
    other: { hex: "#8A8A8A", label: "OTH", mixHex: "#8A8A8A" }
  },
  workouts: {
    foundation: { hex: "#4F587A" },
    calisthenics: { hex: "#7F3728" },
    recovery: { hex: "#315A4A" },
    realign: { hex: "#A8702C" },
    strength: { hex: "#3B4A6B" }
  },
  typography: {
    ui: "Space Grotesk, system-ui, sans-serif",
    figures: "Space Mono, ui-monospace, monospace",
    coachVoice: "Newsreader, Georgia, serif"
  }
};

// ui/client/src/lib/wiTokens.ts
function sportHex(id) {
  return tokens_default.sports[id].hex;
}
function sportMixHex(id) {
  return tokens_default.sports[id].mixHex;
}
function workoutHex(id) {
  return tokens_default.workouts[id].hex;
}

// ui/client/src/lib/activities.ts
var CATEGORY_CONFIG = {
  foundation: { label: "FOUNDATION", shortLabel: "FDN", color: sportHex("foundation"), group: "foundation" },
  strength: { label: "STRENGTH", shortLabel: "STR", color: sportHex("strength"), group: "strength" },
  weight_training: { label: "WEIGHTS", shortLabel: "WGT", color: sportHex("weight_training"), group: "weight_training" },
  calisthenics: { label: "CALISTHENICS", shortLabel: "CAL", color: sportHex("calisthenics"), group: "calisthenics" },
  recovery: { label: "RECOVERY", shortLabel: "REC", color: workoutHex("recovery"), group: "other" },
  realign: { label: "REALIGN", shortLabel: "RLN", color: workoutHex("realign"), group: "other" },
  badminton_ranked: { label: "RANKED", shortLabel: "RNK", color: sportHex("badminton"), group: "badminton" },
  badminton_league: { label: "LEAGUE", shortLabel: "LGE", color: sportHex("badminton"), group: "badminton" },
  badminton_friendly: { label: "FRIENDLY", shortLabel: "FRN", color: sportHex("badminton"), group: "badminton" },
  badminton_casual: { label: "CASUAL", shortLabel: "CAS", color: sportHex("badminton"), group: "badminton" },
  hike: { label: "HIKE", shortLabel: "HIK", color: sportHex("hike"), group: "hike" },
  walk: { label: "WALK", shortLabel: "WLK", color: sportHex("walk"), group: "other" },
  cricket: { label: "CRICKET", shortLabel: "CRK", color: sportHex("cricket"), group: "other" },
  football: { label: "FOOTBALL", shortLabel: "FBL", color: sportHex("football"), group: "other" },
  workout: { label: "WORKOUT", shortLabel: "WKT", color: sportHex("workout"), group: "other" },
  swim: { label: "SWIM", shortLabel: "SWM", color: sportHex("swim"), group: "other" },
  ride: { label: "RIDE", shortLabel: "RDE", color: sportHex("cycling"), group: "ride" },
  run: { label: "RUN", shortLabel: "RUN", color: sportHex("run"), group: "other" },
  other: { label: "OTHER", shortLabel: "OTH", color: sportHex("other"), group: "other" }
};
var GROUP_CONFIG = {
  foundation: { label: "FOUNDATION", color: sportHex("foundation"), categories: ["foundation"] },
  strength: { label: "STRENGTH", color: sportHex("strength"), categories: ["strength"] },
  calisthenics: { label: "CALISTHENICS", color: sportHex("calisthenics"), categories: ["calisthenics"] },
  run: { label: "RUN", color: sportHex("run"), categories: ["run"] },
  hike: { label: "HIKE", color: sportHex("hike"), categories: ["hike"] },
  badminton: { label: "BADMINTON", color: sportHex("badminton"), categories: ["badminton_ranked", "badminton_league", "badminton_friendly", "badminton_casual"] },
  swim: { label: "SWIM", color: sportHex("swim"), categories: ["swim"] },
  weight_training: { label: "WEIGHTS", color: sportHex("weight_training"), categories: ["weight_training"] },
  ride: { label: "RIDES", color: sportHex("cycling"), categories: ["ride"] }
};
function getTrainingCategory(activity) {
  if (activity.category) {
    return activity.category;
  }
  const name = activity.name;
  if (/^Run\s*#/i.test(name)) return "run";
  if (/^Foundation\s*#/i.test(name)) return "foundation";
  if (/^Strength\s+(A|B)/i.test(name)) return "strength";
  if (/^Weight Training\s*#/i.test(name)) return "weight_training";
  if (/^Calisthenics\s*#/i.test(name)) return "calisthenics";
  if (/^Recovery\s*#/i.test(name)) return "recovery";
  if (/^Realign\s*#/i.test(name)) return "realign";
  if (/^Badminton: Ranked\s*#/i.test(name)) return "badminton_ranked";
  if (/^Badminton: League\s*#/i.test(name)) return "badminton_league";
  if (/^Badminton: Friendly\s*#/i.test(name)) return "badminton_friendly";
  if (/^Badminton: Casual\s*#/i.test(name)) return "badminton_casual";
  if (/^Swim\s*#/i.test(name)) return "swim";
  if (/cricket/i.test(name)) return "cricket";
  if (activity.sport_type === "Badminton") return "badminton_casual";
  if (activity.sport_type === "Hike") return "hike";
  if (activity.sport_type === "Walk") return "walk";
  if (activity.sport_type === "Swim") return "swim";
  if (activity.sport_type === "Soccer") return "football";
  if (activity.sport_type === "Workout") return "workout";
  if (activity.sport_type === "Ride" || activity.sport_type === "EBikeRide") return "ride";
  if (activity.sport_type === "Run") return "run";
  if (activity.sport_type === "WeightTraining") {
    if (activity.elapsed_time < 1800) return "foundation";
    return "weight_training";
  }
  return "other";
}
var SPORT_CONFIG = {
  Badminton: { label: "BADMINTON", color: sportHex("badminton"), cssClass: "sport-bar-badminton" },
  WeightTraining: { label: "WEIGHTS", color: sportHex("weight_training"), cssClass: "sport-bar-weights" },
  Ride: { label: "RIDE", color: sportHex("cycling"), cssClass: "sport-bar-ride" },
  Run: { label: "RUN", color: sportHex("run"), cssClass: "sport-bar-run" },
  Workout: { label: "WORKOUT", color: sportHex("workout"), cssClass: "sport-bar-workout" },
  Swim: { label: "SWIM", color: sportHex("swim"), cssClass: "sport-bar-swim" },
  Walk: { label: "WALK", color: sportHex("walk"), cssClass: "sport-bar-walk" },
  Others: { label: "OTHERS", color: sportHex("other"), cssClass: "sport-bar-others" }
};
function parseLocal(dateStr) {
  return new Date(dateStr.replace(/Z$/, ""));
}
function getThisWeekActivities(activities) {
  const now = /* @__PURE__ */ new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  monday.setHours(0, 0, 0, 0);
  return activities.filter((a) => parseLocal(a.start_date_local) >= monday);
}
function parseWinLoss(description) {
  if (!description) return null;
  const summaryMatch = description.match(/(\d+)W[–-](\d+)L/);
  if (!summaryMatch) return null;
  const rankedWins = parseInt(summaryMatch[1]);
  const rankedLosses = parseInt(summaryMatch[2]);
  const lines = description.split("\n");
  let allWins = 0;
  let allLosses = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^W \d+[–-]\d+/.test(trimmed)) allWins++;
    else if (/^L \d+[–-]\d+/.test(trimmed)) allLosses++;
  }
  if (allWins + allLosses === 0) {
    allWins = rankedWins;
    allLosses = rankedLosses;
  }
  return {
    ranked: { wins: rankedWins, losses: rankedLosses },
    all: { wins: allWins, losses: allLosses }
  };
}

// ui/client/src/components/home-warm/liveWeekContract.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
function getMonday(date = /* @__PURE__ */ new Date()) {
  const monday = new Date(date);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
function disciplineFor(category) {
  if (category.startsWith("badminton")) return "badminton";
  if (category === "calisthenics") return "calisthenics";
  if (category === "ride") return "cycling";
  if (category === "foundation") return "foundation";
  if (category === "recovery" || category === "realign") return "recovery";
  if (category === "run") return "run";
  if (category === "strength") return "strength";
  if (category === "weight_training") return "weight_training";
  if (category === "hike") return "hike";
  if (category === "walk") return "walk";
  if (category === "cricket") return "cricket";
  if (category === "football") return "football";
  if (category === "workout") return "workout";
  if (category === "swim") return "swim";
  return "other";
}
function intentFor(categories) {
  if (categories.length === 0) return "open";
  if (categories.every((category) => category === "recovery" || category === "realign")) {
    return "recovery";
  }
  return "train";
}
function recordedDays(activities, monday) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getTime() + index * DAY_MS);
    const dateKey2 = localDateKey(date);
    const matches = activities.filter((activity) => activity.start_date_local.slice(0, 10) === dateKey2).sort(
      (left, right) => parseLocal(left.start_date_local).getTime() - parseLocal(right.start_date_local).getTime()
    );
    const categories = matches.map(getTrainingCategory);
    return {
      date: dateKey2,
      day: date.toLocaleDateString("en-GB", { weekday: "long" }),
      intent: intentFor(categories),
      coach_note: null,
      sessions: matches.map((activity) => {
        const category = getTrainingCategory(activity);
        return {
          id: `activity-${activity.id}`,
          discipline: disciplineFor(category),
          kind: category,
          title: activity.name,
          priority: "support",
          status: "completed",
          planned_duration_min: Math.round(activity.elapsed_time / 60),
          planned_load: null,
          template_id: null,
          session_file: null,
          coach_note: null,
          completion_activity_ids: [String(activity.id)]
        };
      })
    };
  });
}
function buildLiveWeekContract(activities, challenge, now = /* @__PURE__ */ new Date()) {
  const monday = getMonday(now);
  const sunday = new Date(monday.getTime() + 6 * DAY_MS);
  const startDate = localDateKey(monday);
  const endDate = localDateKey(sunday);
  const weekActivities = activities.filter((activity) => {
    const date = parseLocal(activity.start_date_local);
    return date >= monday && date < new Date(monday.getTime() + 7 * DAY_MS);
  });
  const activeDays = new Set(
    weekActivities.map((activity) => activity.start_date_local.slice(0, 10))
  ).size;
  const totalMinutes = weekActivities.reduce(
    (sum, activity) => sum + Math.max(0, activity.elapsed_time) / 60,
    0
  );
  const disciplines = new Set(
    weekActivities.map((activity) => disciplineFor(getTrainingCategory(activity)))
  ).size;
  const latestTimestamp = weekActivities.map((activity) => activity.start_date_local).sort().at(-1) ?? `${startDate}T00:00:00`;
  return {
    schema_version: 1,
    data_status: "live",
    week: {
      id: `${startDate}_${endDate}`,
      start_date: startDate,
      end_date: endDate,
      status: "active",
      focus: "Recorded activity log for the current calendar week.",
      guardrails: []
    },
    coach_read: {
      headline: `${weekActivities.length} session${weekActivities.length === 1 ? "" : "s"} logged.`,
      body: `${activeDays} active day${activeDays === 1 ? "" : "s"} \xB7 ${(totalMinutes / 60).toFixed(1)} hours \xB7 ${disciplines} discipline${disciplines === 1 ? "" : "s"}. Factual log summary; no training prescription is inferred.`,
      valid_from: startDate,
      valid_until: endDate
    },
    days: recordedDays(weekActivities, monday),
    coach_comments: [],
    updated_at: latestTimestamp,
    updated_by: "activity-log-adapter",
    trace_id: "live-week-contract"
  };
}

// ui/client/src/lib/matchParser.ts
var UNICODE_DECORATIONS = /[\u2654-\u265F\u2660-\u2667\u2668-\u2671\u2672-\u267F\u2680-\u269F\u26A0-\u26FF\u2700-\u27BF\u{1F300}-\u{1F9FF}]/gu;
function normalizeName(name) {
  return name.replace(UNICODE_DECORATIONS, "").trim();
}
var WL_SUMMARY_RE = /(\d+)W[–-](\d+)L\s*\((\d+)%?\)/;
var GAME_LINE_RE = /^(W|L)\s+(\d+)[–-](\d+)\s+(?:w\/\s+(.+?)\s+)?vs\s+(.+)$/i;
function parseGameLine(line, gameNumber, isFriendly) {
  const m = line.trim().match(GAME_LINE_RE);
  if (!m) return null;
  const result = m[1].toUpperCase();
  const s1 = parseInt(m[2], 10);
  const s2 = parseInt(m[3], 10);
  const partnerRaw = m[4]?.trim();
  const partner = partnerRaw ? normalizeName(partnerRaw) : null;
  const format = partner ? "doubles" : "singles";
  const opponents = m[5].split(/\s*\+\s*/).map((s) => normalizeName(s.trim())).filter(Boolean);
  const myScore = result === "W" ? Math.max(s1, s2) : Math.min(s1, s2);
  const oppScore = result === "W" ? Math.min(s1, s2) : Math.max(s1, s2);
  const margin = myScore - oppScore;
  return {
    result,
    score: `${s1}-${s2}`,
    myScore,
    oppScore,
    margin,
    partner,
    opponents,
    gameNumber,
    isFriendly,
    format
  };
}
function parseDescription(description) {
  if (!description) return null;
  const lines = description.split("\n").map((l) => l.trim());
  let summaryIdx = -1;
  let summaryWins = 0;
  let summaryLosses = 0;
  let summaryPct = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(WL_SUMMARY_RE);
    if (m) {
      summaryIdx = i;
      summaryWins = parseInt(m[1], 10);
      summaryLosses = parseInt(m[2], 10);
      summaryPct = parseInt(m[3], 10);
      break;
    }
  }
  if (summaryIdx === -1) return null;
  const commentLines = lines.slice(0, summaryIdx).filter((l) => l.length > 0);
  const comment = commentLines.length > 0 ? commentLines.join("\n") : null;
  let gamesStartIdx = -1;
  for (let i = summaryIdx + 1; i < lines.length; i++) {
    if (/^Games:/i.test(lines[i])) {
      gamesStartIdx = i + 1;
      break;
    }
  }
  if (gamesStartIdx === -1) {
    return {
      wins: summaryWins,
      losses: summaryLosses,
      winPct: summaryPct,
      comment,
      games: [],
      friendlies: []
    };
  }
  const games = [];
  const friendlies = [];
  let inFriendlies = false;
  let gameNumber = 1;
  for (let i = gamesStartIdx; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (/^Friendlies:/i.test(line)) {
      inFriendlies = true;
      continue;
    }
    const game = parseGameLine(line, gameNumber, inFriendlies);
    if (game) {
      if (inFriendlies) {
        friendlies.push(game);
      } else {
        games.push(game);
      }
      gameNumber++;
    }
  }
  const allGames = [...games, ...friendlies];
  const actualWins = allGames.filter((g) => g.result === "W").length;
  const actualLosses = allGames.filter((g) => g.result === "L").length;
  const total = actualWins + actualLosses;
  return {
    wins: allGames.length > 0 ? actualWins : summaryWins,
    losses: allGames.length > 0 ? actualLosses : summaryLosses,
    winPct: total > 0 ? Math.round(actualWins / total * 100) : summaryPct,
    comment,
    games,
    friendlies
  };
}
function parseMatch(activity) {
  return parseDescription(activity.description);
}
function getAllGames(match) {
  return [...match.games, ...match.friendlies];
}
function getRankedGames(match) {
  return match.games;
}

// ui/client/src/components/sport-analytics/badmintonLensModel.ts
var ALL_CATEGORIES = /* @__PURE__ */ new Set([
  "badminton_ranked",
  "badminton_league",
  "badminton_friendly",
  "badminton_casual"
]);
var EIGHT_WEEKS_MS = 56 * 24 * 60 * 60 * 1e3;
var FIFTY_TWO_WEEKS_MS = 52 * 7 * 24 * 60 * 60 * 1e3;
var MIN_POSITION_SAMPLES = 5;
var MIN_OPPONENT_GAMES = 3;
var MIN_MONTH_SESSIONS = 3;
function buildSessions(activities) {
  const result = [];
  for (const activity of activities) {
    const category = getTrainingCategory(activity);
    if (!ALL_CATEGORIES.has(category)) continue;
    const parsed = parseMatch(activity);
    if (!parsed || parsed.games.length === 0 && parsed.friendlies.length === 0) continue;
    result.push({
      activity,
      parsed,
      dateKey: activity.start_date_local.slice(0, 10),
      timestamp: parseLocal(activity.start_date_local).getTime()
    });
  }
  result.sort((a, b) => a.timestamp - b.timestamp);
  return result;
}
function gamesForMode(session, mode) {
  return mode === "ranked" ? getRankedGames(session.parsed) : getAllGames(session.parsed);
}
function winPct(wins, losses) {
  const total = wins + losses;
  return total > 0 ? Math.round(wins / total * 100) : 0;
}
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
function buildHeaderStats(activities, sessions) {
  const totalSessions = activities.filter((a) => ALL_CATEGORIES.has(getTrainingCategory(a))).length;
  let rankedGameCount = 0;
  let allGameCount = 0;
  for (const session of sessions) {
    rankedGameCount += getRankedGames(session.parsed).length;
    allGameCount += getAllGames(session.parsed).length;
  }
  return {
    totalSessions,
    sessionsWithMatchData: sessions.length,
    rankedGameCount,
    allGameCount
  };
}
function verdictForWindow(pct, low, high, hasGames) {
  if (!hasGames) return "no games logged in this window";
  if (pct > high) return "above the band \u2014 improving";
  if (pct < low) return "below the band";
  return "in the band";
}
function formatMonthYear(timestamp) {
  return new Date(timestamp).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).toUpperCase().replace(" ", " '");
}
function buildWinRate(sessions, mode, now) {
  const points = sessions.map((session) => {
    const games = gamesForMode(session, mode);
    const wins = games.filter((g) => g.result === "W").length;
    const losses = games.filter((g) => g.result === "L").length;
    const date = parseLocal(session.activity.start_date_local);
    return {
      timestamp: session.timestamp,
      label: date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase(),
      activityId: session.activity.id,
      wins,
      losses,
      rolling: null
    };
  });
  for (let i = 0; i < points.length; i++) {
    const cutoff = points[i].timestamp - 28 * 24 * 60 * 60 * 1e3;
    const window = points.filter((p, j) => j <= i && p.timestamp >= cutoff);
    const totalWins = window.reduce((sum, p) => sum + p.wins, 0);
    const totalGames = window.reduce((sum, p) => sum + p.wins + p.losses, 0);
    points[i].rolling = window.length >= 2 && totalGames > 0 ? Math.round(totalWins / totalGames * 100) : null;
  }
  const rollingValues = points.map((p) => p.rolling).filter((v) => v !== null).sort((a, b) => a - b);
  const hasBand = rollingValues.length >= 4;
  const bandLow = hasBand ? Math.round(percentile(rollingValues, 0.25)) : 0;
  const bandHigh = hasBand ? Math.round(percentile(rollingValues, 0.75)) : 100;
  function windowForRange(start, end) {
    const inWindow = points.filter((p) => (start === null || p.timestamp >= start) && p.timestamp < end);
    const wins = inWindow.reduce((sum, p) => sum + p.wins, 0);
    const losses = inWindow.reduce((sum, p) => sum + p.losses, 0);
    const pct = winPct(wins, losses);
    return {
      winPct: pct,
      wins,
      losses,
      games: wins + losses,
      verdict: hasBand ? verdictForWindow(pct, bandLow, bandHigh, wins + losses > 0) : "not enough history for a band yet",
      trend: inWindow.map((p) => ({
        label: p.label,
        sessionWinPct: winPct(p.wins, p.losses),
        rollingWinPct: p.rolling,
        activityId: p.activityId,
        timestamp: p.timestamp
      }))
    };
  }
  const eightWeek = windowForRange(now - EIGHT_WEEKS_MS, now + 1);
  const yearWindows = [];
  if (points.length > 0) {
    const earliest = points[0].timestamp;
    const pageCount = Math.max(1, Math.ceil((now - earliest) / FIFTY_TWO_WEEKS_MS));
    for (let page = 0; page < pageCount; page++) {
      const end = now - page * FIFTY_TWO_WEEKS_MS;
      const start = end - FIFTY_TWO_WEEKS_MS;
      yearWindows.push({
        rangeLabel: `${formatMonthYear(start)} \u2013 ${formatMonthYear(end)}`,
        window: windowForRange(start, end)
      });
    }
  }
  return {
    available: points.length > 0,
    bandLow,
    bandHigh,
    eightWeek,
    yearWindows
  };
}
function buildSessionShapeRead(points) {
  const withPct = points.filter((point) => point.fiftyTwoWeekWinPct !== null);
  if (withPct.length < 3) return "Shape emerges once more games stack at each position.";
  const third = Math.max(1, Math.ceil(withPct.length / 3));
  const early = withPct.slice(0, third);
  const late = withPct.slice(-third);
  const avgEarly = early.reduce((sum, point) => sum + (point.fiftyTwoWeekWinPct ?? 0), 0) / early.length;
  const avgLate = late.reduce((sum, point) => sum + (point.fiftyTwoWeekWinPct ?? 0), 0) / late.length;
  const delta = Math.round(avgLate - avgEarly);
  if (delta <= -8) return `Win rate fades late \u2014 down ${Math.abs(delta)} pts from early to late games.`;
  if (delta >= 8) return `You finish strong \u2014 up ${delta} pts from early to late games.`;
  return "Win rate holds steady across the session \u2014 no clear fatigue curve.";
}
function buildSessionShape(sessions, mode, now) {
  const byPosition52w = /* @__PURE__ */ new Map();
  const byPosition8w = /* @__PURE__ */ new Map();
  const cutoff52 = now - FIFTY_TWO_WEEKS_MS;
  const cutoff8 = now - EIGHT_WEEKS_MS;
  for (const session of sessions) {
    if (session.timestamp < cutoff52) continue;
    const games = gamesForMode(session, mode);
    games.forEach((game, index) => {
      const position = index + 1;
      if (!byPosition52w.has(position)) byPosition52w.set(position, []);
      byPosition52w.get(position).push(game);
      if (session.timestamp >= cutoff8) {
        if (!byPosition8w.has(position)) byPosition8w.set(position, []);
        byPosition8w.get(position).push(game);
      }
    });
  }
  const positions = Array.from(byPosition52w.keys()).sort((a, b) => a - b);
  const points = positions.map((position) => {
    const windowGames = byPosition52w.get(position) ?? [];
    const recentGames = byPosition8w.get(position) ?? [];
    const windowPct = windowGames.length >= MIN_POSITION_SAMPLES ? winPct(windowGames.filter((g) => g.result === "W").length, windowGames.filter((g) => g.result === "L").length) : null;
    const recentPct = recentGames.length >= 3 ? winPct(recentGames.filter((g) => g.result === "W").length, recentGames.filter((g) => g.result === "L").length) : null;
    return {
      gameNumber: position,
      label: `GAME ${position}`,
      fiftyTwoWeekWinPct: windowPct,
      eightWeekWinPct: recentPct,
      sampleCount: windowGames.length
    };
  }).filter((point) => point.fiftyTwoWeekWinPct !== null || point.eightWeekWinPct !== null);
  return { available: points.length >= 3, points, read: buildSessionShapeRead(points) };
}
function buildBestMonth(sessions, mode) {
  const byMonth = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    const date = parseLocal(session.activity.start_date_local);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const games = gamesForMode(session, mode);
    if (games.length === 0) continue;
    const entry = byMonth.get(key) ?? {
      sessions: 0,
      wins: 0,
      losses: 0,
      label: date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }).toUpperCase().replace(" ", " '")
    };
    entry.sessions += 1;
    entry.wins += games.filter((g) => g.result === "W").length;
    entry.losses += games.filter((g) => g.result === "L").length;
    byMonth.set(key, entry);
  }
  const months = Array.from(byMonth.values());
  const qualifying = months.filter((m) => m.sessions >= MIN_MONTH_SESSIONS);
  if (qualifying.length === 0) return { available: false, label: "", winPct: 0, sessionCount: 0, isHighestVolume: false };
  qualifying.sort((a, b) => {
    const pctDiff = winPct(b.wins, b.losses) - winPct(a.wins, a.losses);
    return pctDiff !== 0 ? pctDiff : b.sessions - a.sessions;
  });
  const best = qualifying[0];
  const maxSessions = Math.max(...months.map((m) => m.sessions));
  return {
    available: true,
    label: best.label,
    winPct: winPct(best.wins, best.losses),
    sessionCount: best.sessions,
    isHighestVolume: best.sessions === maxSessions
  };
}
function buildHeadToHead(sessions, mode, now) {
  const cutoff52 = now - FIFTY_TWO_WEEKS_MS;
  const cutoff8 = now - EIGHT_WEEKS_MS;
  const byOpponent = /* @__PURE__ */ new Map();
  const byOpponentRecent = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    if (session.timestamp < cutoff52) continue;
    const games = gamesForMode(session, mode);
    for (const game of games) {
      for (const opponent of game.opponents) {
        if (!byOpponent.has(opponent)) byOpponent.set(opponent, []);
        byOpponent.get(opponent).push(game);
        if (session.timestamp >= cutoff8) {
          if (!byOpponentRecent.has(opponent)) byOpponentRecent.set(opponent, []);
          byOpponentRecent.get(opponent).push(game);
        }
      }
    }
  }
  const rows = [];
  Array.from(byOpponent.entries()).forEach(([name, games]) => {
    if (games.length < MIN_OPPONENT_GAMES) return;
    const wins = games.filter((g) => g.result === "W").length;
    const losses = games.filter((g) => g.result === "L").length;
    const windowPct = winPct(wins, losses);
    const recent = byOpponentRecent.get(name) ?? [];
    const recentWins = recent.filter((g) => g.result === "W").length;
    const recentLosses = recent.filter((g) => g.result === "L").length;
    let direction = "steady rivalry";
    let tone = "flat";
    if (recent.length >= 2) {
      const recentPct = winPct(recentWins, recentLosses);
      if (recentPct - windowPct >= 15) {
        direction = "closing the gap";
        tone = "up";
      } else if (recentPct - windowPct <= -15) {
        direction = "his pace, not yours";
        tone = "down";
      } else if (recentPct >= 50) {
        direction = "edge holding";
        tone = "up";
      } else {
        direction = "steady rivalry";
        tone = "flat";
      }
    } else {
      direction = "no recent meetings";
      tone = "flat";
    }
    rows.push({
      name,
      fiftyTwoWeekRecord: `${wins}W\u2013${losses}L`,
      fiftyTwoWeekWinPct: windowPct,
      fiftyTwoWeekGames: games.length,
      recentRecord: recent.length > 0 ? `${recentWins}W\u2013${recentLosses}L` : "\u2014",
      recentGames: recent.length,
      direction,
      tone
    });
  });
  rows.sort((a, b) => b.fiftyTwoWeekGames - a.fiftyTwoWeekGames);
  return { available: rows.length > 0, rows };
}
function closeGamesWinPct(games) {
  const close = games.filter((g) => Math.abs(g.margin) <= 3);
  if (close.length === 0) return null;
  return winPct(close.filter((g) => g.result === "W").length, close.filter((g) => g.result === "L").length);
}
function avgMargin(games) {
  if (games.length === 0) return null;
  return Math.round(games.reduce((sum, g) => sum + g.margin, 0) / games.length * 10) / 10;
}
function fadePoint(shape, key) {
  const drop = shape.find((p) => (p[key] ?? 100) < 50);
  return drop ? `GAME ${drop.gameNumber}` : "\u2014";
}
function buildAmIImproving(sessions, mode, now, shape) {
  const cutoff8 = now - EIGHT_WEEKS_MS;
  const cutoff52 = now - FIFTY_TWO_WEEKS_MS;
  const windowGames = sessions.filter((s) => s.timestamp >= cutoff52).flatMap((s) => gamesForMode(s, mode));
  const recentGames = sessions.filter((s) => s.timestamp >= cutoff8).flatMap((s) => gamesForMode(s, mode));
  if (recentGames.length < 6) return { available: false, rows: [] };
  const windowWinPct = winPct(windowGames.filter((g) => g.result === "W").length, windowGames.filter((g) => g.result === "L").length);
  const recentWinPct = winPct(recentGames.filter((g) => g.result === "W").length, recentGames.filter((g) => g.result === "L").length);
  const windowClose = closeGamesWinPct(windowGames);
  const recentClose = closeGamesWinPct(recentGames);
  const windowAvgMargin = avgMargin(windowGames);
  const recentAvgMargin = avgMargin(recentGames);
  const windowFade = fadePoint(shape.points, "fiftyTwoWeekWinPct");
  const recentFade = fadePoint(shape.points, "eightWeekWinPct");
  const rows = [
    {
      label: "WIN RATE",
      fiftyTwoWeek: `${windowWinPct}%`,
      recent: `${recentWinPct}%`,
      improved: recentWinPct === windowWinPct ? null : recentWinPct > windowWinPct
    }
  ];
  if (windowClose !== null && recentClose !== null) {
    rows.push({
      label: "CLOSE GAMES WON",
      fiftyTwoWeek: `${windowClose}%`,
      recent: `${recentClose}%`,
      improved: recentClose === windowClose ? null : recentClose > windowClose
    });
  }
  if (windowAvgMargin !== null && recentAvgMargin !== null) {
    rows.push({
      label: "AVG MARGIN",
      fiftyTwoWeek: windowAvgMargin > 0 ? `+${windowAvgMargin}` : `${windowAvgMargin}`,
      recent: recentAvgMargin > 0 ? `+${recentAvgMargin}` : `${recentAvgMargin}`,
      improved: recentAvgMargin === windowAvgMargin ? null : recentAvgMargin > windowAvgMargin
    });
  }
  if (windowFade !== "\u2014" || recentFade !== "\u2014") {
    const windowNum = windowFade === "\u2014" ? null : Number(windowFade.replace("GAME ", ""));
    const recentNum = recentFade === "\u2014" ? null : Number(recentFade.replace("GAME ", ""));
    rows.push({
      label: "FADE POINT",
      fiftyTwoWeek: windowFade,
      recent: recentFade,
      improved: windowNum === null || recentNum === null || recentNum === windowNum ? null : recentNum > windowNum
    });
  }
  return { available: true, rows };
}
var ZONE_COLORS = ["#adc2b7", "#315a4a", "#a8702c", "#7f3728", "#4a241a"];
function buildEffort(sessions) {
  const totals = [0, 0, 0, 0, 0];
  let anyZones = false;
  for (const session of sessions) {
    const zones = session.activity.hr_zones;
    if (!zones) continue;
    anyZones = true;
    for (let z = 1; z <= 5; z++) {
      totals[z - 1] += Math.max(0, Number(zones[`Zone ${z}`]?.seconds) || 0);
    }
  }
  const totalSeconds = totals.reduce((sum, v) => sum + v, 0);
  if (!anyZones || totalSeconds === 0) return { available: false, zones: [] };
  return {
    available: true,
    zones: totals.map((seconds, index) => ({
      label: `Z${index + 1}`,
      percent: Math.round(seconds / totalSeconds * 100),
      color: ZONE_COLORS[index]
    }))
  };
}
function buildBadmintonLensModel(activities, mode, now = Date.now()) {
  const sessions = buildSessions(activities);
  const shape = buildSessionShape(sessions, mode, now);
  return {
    header: buildHeaderStats(activities, sessions),
    winRate: buildWinRate(sessions, mode, now),
    sessionShape: shape,
    bestMonth: buildBestMonth(sessions, mode),
    headToHead: buildHeadToHead(sessions, mode, now),
    amIImproving: buildAmIImproving(sessions, mode, now, shape),
    effort: buildEffort(sessions)
  };
}

// ui/client/src/components/home-warm/formatUtils.ts
function formatMinutesLabel(value) {
  const minutes = Math.round(value);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}H${String(minutes % 60).padStart(2, "0")}` : `${minutes} MIN`;
}

// ui/client/src/components/home-warm/warmHomeModel.ts
var DAY_MS2 = 24 * 60 * 60 * 1e3;
function getMonday2(date = /* @__PURE__ */ new Date()) {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.getFullYear(), date.getMonth(), diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
function latestActivityTimestamp(activities) {
  let latest = null;
  for (const activity of activities) {
    const when = activity.start_date_local ?? "";
    if (when && (!latest || when > latest)) latest = when;
  }
  return latest;
}
function formatSyncAge(timestamp) {
  if (!timestamp) return "Not synced";
  const ageMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(timestamp).getTime()) / 6e4)
  );
  if (ageMinutes < 1) return "Just synced";
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
var ZONE_LOAD_WEIGHTS = [1, 2, 3, 4, 5];
function getActivityZoneLoad(activity) {
  if (!activity.hr_zones) return null;
  let observedSeconds = 0;
  const weightedSeconds = ZONE_LOAD_WEIGHTS.reduce((total, weight) => {
    const seconds = Math.max(
      0,
      Number(activity.hr_zones?.[`Zone ${weight}`]?.seconds) || 0
    );
    observedSeconds += seconds;
    return total + seconds * weight;
  }, 0);
  return observedSeconds > 0 ? weightedSeconds / 60 : null;
}
function activitiesForWeek(activities, weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return activities.filter((activity) => {
    const activityDate = parseLocal(activity.start_date_local);
    return activityDate >= weekStart && activityDate < weekEnd;
  });
}
function buildEnginePoints(activities) {
  const currentMonday = getMonday2();
  return Array.from({ length: 8 }, (_, index) => {
    const weekStart = new Date(currentMonday);
    weekStart.setDate(weekStart.getDate() - (7 - index) * 7);
    const weekActivities = activitiesForWeek(activities, weekStart);
    const observedLoads = weekActivities.map(getActivityZoneLoad).filter((load2) => load2 !== null);
    const load = observedLoads.reduce((sum, activityLoad) => sum + activityLoad, 0);
    return {
      weekKey: dateKey(weekStart),
      label: weekStart.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      load: Math.round(load),
      isCurrent: index === 7,
      isPartial: observedLoads.length < weekActivities.length
    };
  });
}
function activeComment(contract, topic) {
  const matching = contract.coach_comments.filter((comment) => comment.topic === topic).sort((a, b) => a.priority - b.priority);
  if (contract.data_status === "placeholder") return matching[0] ?? null;
  const today = dateKey(/* @__PURE__ */ new Date());
  return matching.find(
    (comment) => comment.valid_from <= today && comment.valid_until >= today
  ) ?? null;
}
function buildEngine(activities, contract) {
  const points = buildEnginePoints(activities);
  const currentLoad = points.at(-1)?.load ?? 0;
  const validPrevious = points.slice(-5, -1).filter((point) => !point.isPartial).map((point) => point.load).filter((load) => load > 0);
  const rhythm = median(validPrevious);
  const monday = getMonday2();
  const elapsedDays = Math.min(
    7,
    Math.max(1, Math.floor((Date.now() - monday.getTime()) / DAY_MS2) + 1)
  );
  const completionFraction = elapsedDays / 7;
  const projectedLoad = Math.round(
    currentLoad / Math.max(completionFraction, 0.45)
  );
  const ratio = rhythm && rhythm > 0 ? projectedLoad / rhythm : 1;
  const signal = ratio > 1.2 ? "EASE" : ratio < 0.8 ? "BUILD" : "HOLD";
  const comment = activeComment(contract, "weekly_load");
  return {
    points,
    currentLoad,
    projectedLoad,
    corridorLow: rhythm === null ? null : Math.round(rhythm * 0.8),
    corridorTarget: rhythm === null ? null : Math.round(rhythm),
    corridorHigh: rhythm === null ? null : Math.round(rhythm * 1.2),
    signal,
    headline: comment?.headline ?? (signal === "EASE" ? "Absorb the work." : signal === "BUILD" ? "There is room to build." : "Hold the line."),
    body: comment?.body ?? (rhythm === null ? "More completed weeks are needed before Coach can establish a reliable rhythm." : `Projected load is ${Math.round(ratio * 100)}% of the recent rhythm.`),
    completionFraction
  };
}
function formatDistanceKm(metres) {
  const kilometres = metres / 1e3;
  if (kilometres <= 0) return "0 km";
  return `${kilometres >= 10 ? Math.round(kilometres) : kilometres.toFixed(1)} km`;
}
function calisthenicsFocus(activities) {
  const focuses = activities.map((activity) => {
    const match = activity.name.match(/Calisthenics\s*#\d+:\s*(.+)/i);
    return match ? match[1].trim() : null;
  }).filter((value) => Boolean(value));
  return focuses.at(-1) ?? "No session yet";
}
function buildCommitments(activities) {
  const thisWeek = getThisWeekActivities(activities);
  const rides = thisWeek.filter(
    (activity) => getTrainingCategory(activity) === "ride"
  );
  const foundation = thisWeek.filter(
    (activity) => getTrainingCategory(activity) === "foundation"
  );
  const badminton = thisWeek.filter(
    (activity) => getTrainingCategory(activity).startsWith("badminton")
  );
  const calisthenics = thisWeek.filter(
    (activity) => getTrainingCategory(activity) === "calisthenics"
  );
  let rankedWins = 0;
  let rankedLosses = 0;
  let allWins = 0;
  let allLosses = 0;
  for (const activity of badminton) {
    const record = parseWinLoss(activity.description);
    if (!record) continue;
    const category = getTrainingCategory(activity);
    allWins += record.all.wins;
    allLosses += record.all.losses;
    if (category === "badminton_ranked" || category === "badminton_league") {
      rankedWins += record.ranked.wins;
      rankedLosses += record.ranked.losses;
    }
  }
  return [
    {
      id: "cycling",
      label: "Cycling",
      glyph: "cycling",
      value: String(rides.length),
      unit: rides.length === 1 ? "ride" : "rides",
      secondary: formatDistanceKm(
        rides.reduce((sum, activity) => sum + (activity.distance ?? 0), 0)
      ),
      accent: "#9c5d2e"
    },
    {
      id: "foundation",
      label: "Foundation",
      glyph: "foundation",
      value: String(
        new Set(
          foundation.map((activity) => activity.start_date_local.slice(0, 10))
        ).size
      ),
      unit: "active days",
      secondary: foundation.length > 0 ? "rhythm intact" : "start gently",
      accent: "#496d64"
    },
    {
      id: "badminton",
      label: "Badminton",
      glyph: "badminton",
      value: String(badminton.length),
      unit: badminton.length === 1 ? "session" : "sessions",
      secondary: `${allWins}W-${allLosses}L`,
      allRecord: `${allWins}W-${allLosses}L`,
      rankedRecord: `${rankedWins}W-${rankedLosses}L`,
      hasRankedRecord: rankedWins + rankedLosses > 0,
      accent: "#2f7058"
    },
    {
      id: "calisthenics",
      label: "Calisthenics",
      glyph: "calisthenics",
      value: String(calisthenics.length),
      unit: calisthenics.length === 1 ? "session" : "sessions",
      secondary: calisthenicsFocus(calisthenics),
      accent: "#76556f"
    }
  ];
}
function glyphForDiscipline(discipline) {
  if (discipline === "cycling") return "cycling";
  if (discipline === "foundation") return "foundation";
  if (discipline === "badminton") return "badminton";
  if (discipline === "calisthenics") return "calisthenics";
  if (discipline === "recovery") return "recovery";
  if (discipline === "run") return "run";
  if (discipline === "strength") return "strength";
  if (discipline === "weight_training") return "weight_training";
  if (discipline === "hike") return "hike";
  if (discipline === "walk") return "walk";
  if (discipline === "cricket") return "cricket";
  if (discipline === "football") return "football";
  if (discipline === "workout") return "workout";
  if (discipline === "swim") return "swim";
  return "other";
}
function weekdayName(dateStr, explicit) {
  if (explicit) return explicit;
  const weekday = (/* @__PURE__ */ new Date(`${dateStr}T12:00:00`)).toLocaleDateString("en-GB", {
    weekday: "long"
  });
  return weekday || "Day";
}
function buildPlanDays(contract) {
  const today = dateKey(/* @__PURE__ */ new Date());
  return contract.days.map((day) => {
    const dayName = weekdayName(day.date, day.day);
    return {
      date: day.date,
      day: dayName,
      dayShort: dayName.slice(0, 3),
      dateNumber: String(Number(day.date.slice(-2))),
      intent: day.intent,
      isToday: day.date === today,
      sessions: day.sessions.map((session) => ({
        id: session.id,
        title: session.title,
        discipline: session.discipline,
        glyph: glyphForDiscipline(session.discipline),
        duration: session.planned_duration_min === null ? null : `${session.planned_duration_min} min`,
        priority: session.priority,
        status: session.status,
        href: session.template_id ? `/workouts/${session.template_id}` : contract.data_status === "placeholder" ? "/workouts" : void 0
      }))
    };
  });
}
function buildQuest(mainQuest) {
  const monday = getMonday2();
  const sessions = (mainQuest.sessions ?? []).filter(
    (session) => /* @__PURE__ */ new Date(`${session.date}T00:00:00`) >= monday
  );
  const loaded = sessions.filter((session) => session.kind === "loaded").reduce((sum, session) => sum + session.weight, 0);
  const rawSkill = sessions.filter((session) => session.kind === "skill").reduce((sum, session) => sum + session.weight, 0);
  const skill = Math.min(rawSkill, mainQuest.skill_cap ?? 0);
  const completed = loaded + skill;
  const floor = mainQuest.weekly_floor ?? 0;
  return {
    name: mainQuest.name,
    completed,
    floor,
    loaded,
    skill,
    percent: floor > 0 ? Math.min(100, completed / floor * 100) : 0
  };
}
function buildCountTargetQuest(mainQuest, activities, challenge) {
  const sinceRaw = challenge.season?.start_date ?? challenge.challenge?.start_date;
  const since = sinceRaw ?? "0000-01-01";
  const pattern = mainQuest.count_pattern ? new RegExp(mainQuest.count_pattern, "i") : null;
  const completed = pattern ? activities.filter(
    (a) => a.start_date_local.slice(0, 10) >= since && pattern.test(a.name)
  ).length : 0;
  const floor = mainQuest.target ?? 0;
  return {
    name: mainQuest.name,
    completed,
    floor,
    loaded: 0,
    skill: 0,
    percent: floor > 0 ? Math.min(100, completed / floor * 100) : 0
  };
}
function buildWarmHomeModel(activities, challenge, syncStatus, contract) {
  const syncHealthy = syncStatus.status === "success" || syncStatus.status === "none";
  const start = /* @__PURE__ */ new Date(`${contract.week.start_date}T00:00:00`);
  const end = /* @__PURE__ */ new Date(`${contract.week.end_date}T00:00:00`);
  return {
    dateLabel: (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }),
    // part3-rollout dropped week.phase_name/week.block_name from current_week.json (dead
    // references to the phase/current_block concept Part 2 already removed from seasons.json) -
    // fall back straight to challenge.phase, same source SportSpine.tsx/Home.tsx still use.
    phaseName: challenge.phase?.name || challenge.challenge?.name || "Current block",
    blockName: challenge.phase?.current_block.name || "This week",
    syncLabel: formatSyncAge(latestActivityTimestamp(activities) ?? syncStatus.timestamp),
    syncHealthy,
    dataStatus: contract.data_status,
    weekLabel: `${start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}\u2013${end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
    weekFocus: contract.week.focus,
    engine: buildEngine(activities, contract),
    coachRead: contract.coach_read,
    commitments: buildCommitments(activities),
    planDays: buildPlanDays(contract),
    quest: challenge.main_quest.type === "count_target" ? buildCountTargetQuest(challenge.main_quest, activities, challenge) : buildQuest(challenge.main_quest)
  };
}

// ui/client/src/components/home-warm/warmHomeSnapshots.ts
var DAY_MS3 = 24 * 60 * 60 * 1e3;
function localDateKey2(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
function isoWeek(date = /* @__PURE__ */ new Date()) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / DAY_MS3 + 1) / 7);
}
function categoryToSport(category) {
  if (category.startsWith("badminton")) return "badminton";
  if (category === "calisthenics") return "calisthenics";
  if (category === "foundation" || category === "recovery" || category === "realign") {
    return "foundation";
  }
  if (category === "ride") return "cycling";
  if (category === "run") return "run";
  if (category === "strength") return "strength";
  if (category === "weight_training") return "weight_training";
  if (category === "hike") return "hike";
  if (category === "walk") return "walk";
  if (category === "cricket") return "cricket";
  if (category === "football") return "football";
  if (category === "workout") return "workout";
  if (category === "swim") return "swim";
  return "other";
}
function disciplineToSport(discipline) {
  if (discipline === "cycling") return "cycling";
  if (discipline === "badminton") return "badminton";
  if (discipline === "calisthenics") return "calisthenics";
  if (discipline === "foundation") return "foundation";
  if (discipline === "recovery") return "recovery";
  if (discipline === "run") return "run";
  if (discipline === "strength") return "strength";
  if (discipline === "weight_training") return "weight_training";
  if (discipline === "hike") return "hike";
  if (discipline === "walk") return "walk";
  if (discipline === "cricket") return "cricket";
  if (discipline === "football") return "football";
  if (discipline === "workout") return "workout";
  if (discipline === "swim") return "swim";
  return "other";
}
function formatSessionTitle(name) {
  return name.replace(/:\s*/, " \xB7 ");
}
function buildActivityEvidenceSnapshots(activities) {
  return [...activities].sort(
    (left, right) => parseLocal(right.start_date_local).getTime() - parseLocal(left.start_date_local).getTime()
  ).map((activity, index) => {
    const category = getTrainingCategory(activity);
    const date = parseLocal(activity.start_date_local);
    const calories = Number(activity.calories) || 0;
    const distance = Number(activity.distance) || 0;
    const activityLoad = getActivityZoneLoad(activity);
    return {
      id: activity.id !== void 0 && activity.id !== null ? String(activity.id) : `${activity.start_date_local}-${activity.name}-${index}`,
      dateKey: localDateKey2(date),
      dateLabel: date.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short"
      }).toUpperCase(),
      title: formatSessionTitle(activity.name),
      sport: categoryToSport(category),
      ranked: category === "badminton_ranked",
      durationMinutes: Math.max(0, activity.elapsed_time ?? 0) / 60,
      calories: calories > 0 ? Math.round(calories) : null,
      averageHeartRate: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
      maxHeartRate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
      distanceKm: distance > 0 ? distance / 1e3 : null,
      load: activityLoad === null ? null : Math.round(activityLoad),
      source: activity.device_name ?? "Strava activity log"
    };
  });
}
function formatDuration(activity) {
  const duration = formatMinutesLabel(Math.max(0, activity.elapsed_time ?? 0) / 60);
  return activity.average_heartrate ? `${duration} \xB7 ${Math.round(activity.average_heartrate)} BPM` : duration;
}
function buildEngineSnapshot(activities, engine) {
  const thisWeek = getThisWeekActivities(activities);
  const mixDefinition = [
    { id: "badminton", label: "Badminton", shortLabel: "BDM", color: sportMixHex("badminton") },
    { id: "foundation", label: "Foundation", shortLabel: "FDN", color: sportMixHex("foundation") },
    { id: "calisthenics", label: "Calisthenics", shortLabel: "CAL", color: sportMixHex("calisthenics") },
    { id: "cycling", label: "Ride", shortLabel: "RIDE", color: sportMixHex("cycling") },
    { id: "run", label: "Run", shortLabel: "RUN", color: sportHex("run") },
    { id: "strength", label: "Strength", shortLabel: "STR", color: sportHex("strength") },
    { id: "weight_training", label: "Weights", shortLabel: "WGT", color: sportHex("weight_training") },
    { id: "hike", label: "Hike", shortLabel: "HIK", color: sportHex("hike") },
    { id: "walk", label: "Walk", shortLabel: "WLK", color: sportHex("walk") },
    { id: "cricket", label: "Cricket", shortLabel: "CRK", color: sportHex("cricket") },
    { id: "football", label: "Football", shortLabel: "FBL", color: sportHex("football") },
    { id: "workout", label: "Workout", shortLabel: "WKT", color: sportHex("workout") },
    { id: "swim", label: "Swim", shortLabel: "SWM", color: sportHex("swim") }
  ];
  const mix = mixDefinition.map((item) => ({
    ...item,
    hours: thisWeek.filter((activity) => categoryToSport(getTrainingCategory(activity)) === item.id).reduce((sum, activity) => sum + (activity.elapsed_time ?? 0) / 3600, 0)
  }));
  const totalHours = thisWeek.reduce(
    (sum, activity) => sum + (activity.elapsed_time ?? 0) / 3600,
    0
  );
  const bandLow = engine.corridorLow ?? engine.currentLoad * 0.8;
  const bandHigh = engine.corridorHigh ?? engine.currentLoad * 1.2;
  const minimumSignal = Math.min(engine.currentLoad, bandLow);
  const maximumSignal = Math.max(engine.currentLoad, bandHigh, 1);
  const scaleLow = Math.max(0, Math.floor(minimumSignal * 0.7 / 50) * 50);
  const scaleHigh = Math.max(
    scaleLow + 100,
    Math.ceil(maximumSignal * 1.2 / 50) * 50
  );
  const signal = engine.signal === "HOLD" ? "IN BAND" : engine.signal === "EASE" ? "ABOVE BAND" : "BELOW BAND";
  const verdict = engine.signal === "HOLD" ? "Optimal." : engine.signal === "EASE" ? "Ease off." : "Build gently.";
  const compactVerdict = engine.signal === "HOLD" ? "In the band." : engine.signal === "EASE" ? "Above the band." : "Below the band.";
  const openVerdict = engine.signal === "HOLD" ? "Hold here." : engine.signal === "EASE" ? "Absorb." : "Build gently.";
  const observedLoadCount = thisWeek.filter(
    (activity) => getActivityZoneLoad(activity) !== null
  ).length;
  const doseRows = [...thisWeek].sort(
    (left, right) => parseLocal(left.start_date_local).getTime() - parseLocal(right.start_date_local).getTime()
  ).slice(-5).map((activity) => ({
    day: parseLocal(activity.start_date_local).toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase(),
    title: formatSessionTitle(activity.name),
    detail: formatDuration(activity),
    load: getActivityZoneLoad(activity) === null ? null : Math.round(getActivityZoneLoad(activity)),
    sport: categoryToSport(getTrainingCategory(activity))
  }));
  if (doseRows.length < 5) {
    doseRows.push({
      day: "SUN",
      title: "Rest \u2014 part of the texture",
      load: null,
      sport: "other",
      isRest: true
    });
  }
  return {
    weekLabel: `WK ${isoWeek()}`,
    load: engine.currentLoad,
    signal,
    verdict,
    compactVerdict,
    openVerdict,
    bandLow,
    bandHigh,
    scaleLow,
    scaleHigh,
    trend: engine.points.map((point) => ({
      label: point.label,
      value: point.load,
      weekLabel: `WK ${isoWeek(new Date(point.weekKey))}`
    })),
    mix,
    totalHours,
    method: `LOAD = \u03A3(MIN \xD7 ZONE 1\u20135) \xB7 BAND = 8-WK RHYTHM \xB120%${observedLoadCount < thisWeek.length ? ` \xB7 ${observedLoadCount}/${thisWeek.length} LOAD STREAMS` : ""}`,
    doseRows
  };
}
function eligibleDaysSince(startDate, endDate, today) {
  const start = /* @__PURE__ */ new Date(`${startDate}T00:00:00`);
  const end = endDate ? /* @__PURE__ */ new Date(`${endDate}T00:00:00`) : today;
  const effectiveEnd = end.getTime() < today.getTime() ? end : today;
  if (effectiveEnd < start) return 0;
  return Math.floor((effectiveEnd.getTime() - start.getTime()) / DAY_MS3) + 1;
}
function buildQuestSnapshot(challenge, quest) {
  const palette = ["#7c6f9e", "#a8702c"];
  const today = /* @__PURE__ */ new Date();
  const sideQuests = challenge.quests.slice(0, 2).map((item, index) => {
    let value;
    let target;
    if (item.type === "daily_streak") {
      const eligible = eligibleDaysSince(item.start_date, item.end_date, today);
      if (item.polarity === "default_done") {
        const missed = item.missed_dates?.length ?? 0;
        const excused = item.excused_dates?.length ?? 0;
        value = Math.max(0, eligible - missed - excused);
        target = eligible;
      } else {
        value = item.completed_dates?.length ?? 0;
        target = eligible;
      }
    } else {
      const completedDates = item.completed_dates?.length ?? 0;
      value = item.current ?? completedDates;
      target = item.target ?? Math.max(value, 1);
    }
    return {
      id: item.id,
      name: item.name,
      value,
      target,
      color: palette[index] ?? palette[0],
      notes: item.notes
    };
  });
  const mondayIndex = ((/* @__PURE__ */ new Date()).getDay() + 6) % 7;
  return {
    name: quest.name,
    completed: Number(quest.completed.toFixed(1)),
    target: quest.floor,
    loaded: Number(quest.loaded.toFixed(1)),
    daysLeft: Math.max(0, 6 - mondayIndex),
    sideQuests
  };
}
function winPercent(record) {
  const match = record?.match(/(\d+)\D+(\d+)/);
  if (!match) return 0;
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  return wins + losses > 0 ? wins / (wins + losses) * 100 : 0;
}
function activityDayStreak(activities) {
  const dates = Array.from(new Set(activities.map((activity) => activity.dateKey))).sort().reverse();
  if (dates.length === 0) return 0;
  const activeDates = new Set(dates);
  const cursor = /* @__PURE__ */ new Date(`${dates[0]}T12:00:00`);
  let streak = 0;
  while (activeDates.has(localDateKey2(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
function buildCommitmentSnapshots(commitments, dataMode, activityEvidence) {
  const targets = {
    cycling: 1,
    badminton: 2,
    calisthenics: 2,
    foundation: 7
  };
  const order = ["cycling", "badminton", "calisthenics", "foundation"];
  return order.map((id) => {
    const source = commitments.find((item) => item.id === id);
    const sportActivities = activityEvidence.filter((activity) => activity.sport === id);
    const value = Number(source?.value ?? 0);
    const target = dataMode === "live" ? id === "cycling" ? null : targets[id] : targets[id];
    const progress = target === null ? null : id === "badminton" ? winPercent(source?.allRecord) : Math.min(100, value / target * 100);
    const alarm = dataMode !== "live" && target !== null && id === "calisthenics" && value < target;
    const status = dataMode === "live" ? id === "badminton" ? "ALL" : "" : id === "foundation" ? value >= target ? "GRADUATED" : `${target - value}D LEFT` : id === "calisthenics" ? value >= target ? "IN BAND" : "BELOW" : id === "cycling" ? "LOGGED" : "ALL";
    const note = dataMode === "live" ? id === "foundation" ? "" : source?.secondary.toUpperCase() ?? "NO DATA" : id === "foundation" ? `${value}/${target} DAYS` : id === "calisthenics" ? `FLOOR ${target}` : source?.secondary.toUpperCase() ?? "NO DATA";
    return {
      id,
      label: source?.label ?? id,
      glyph: source?.glyph ?? id,
      value,
      target,
      note,
      status,
      progress,
      accent: id === "badminton" ? "#315a4a" : id === "calisthenics" ? "#4f587a" : id === "foundation" ? "#6d7d4e" : "#a8702c",
      alarm,
      allRecord: source?.allRecord,
      rankedRecord: source?.rankedRecord,
      hasRankedRecord: source?.hasRankedRecord,
      latest: sportActivities[0],
      latestRanked: sportActivities.find((activity) => activity.ranked),
      streak: id === "foundation" ? activityDayStreak(sportActivities) : void 0
    };
  });
}
function buildWeeklyPlanSnapshot(model, engine, dataMode, activityEvidence) {
  return {
    label: model.weekLabel,
    isPreview: model.dataStatus === "placeholder",
    title: dataMode === "live" ? "WEEKLY LOG" : void 0,
    statusLabel: dataMode === "live" ? model.weekLabel.toUpperCase() : void 0,
    bandLow: engine.bandLow,
    bandHigh: engine.bandHigh,
    days: model.planDays.map((day) => {
      const session = day.sessions[0];
      const dayActivities = activityEvidence.filter(
        (activity) => activity.dateKey === day.date
      );
      const observedLoads = dayActivities.map((activity) => activity.load).filter((load) => load !== null);
      const hasCompleteLoad = dayActivities.length > 0 && observedLoads.length === dayActivities.length;
      return {
        key: day.date,
        day: day.day,
        dayShort: day.day.slice(0, 1),
        glyph: session?.glyph ?? null,
        sport: session ? disciplineToSport(session.discipline) : "recovery",
        title: session?.title ?? "Rest",
        loadDelta: dataMode === "live" && hasCompleteLoad ? Math.round(observedLoads.reduce((sum, load) => sum + load, 0)) : null,
        isRecorded: dataMode === "live" && dayActivities.length > 0,
        href: session?.href,
        activities: dayActivities
      };
    })
  };
}
function buildCaloriesSnapshot(activities, dataMode) {
  const now = /* @__PURE__ */ new Date();
  const current = activities.filter((activity) => {
    const date = parseLocal(activity.start_date_local);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }).reduce((sum, activity) => sum + (Number(activity.calories) || 0), 0);
  const target = 12e3;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(0, daysInMonth - now.getDate());
  const monthActivities = activities.filter((activity) => {
    const date = parseLocal(activity.start_date_local);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const caloriesByDay = monthActivities.reduce((totals, activity) => {
    const key = activity.start_date_local.slice(0, 10);
    totals.set(key, (totals.get(key) ?? 0) + (Number(activity.calories) || 0));
    return totals;
  }, /* @__PURE__ */ new Map());
  const highestDay = Array.from(caloriesByDay.entries()).sort((left, right) => right[1] - left[1])[0];
  let cumulativeCalories = 0;
  const dailyActual = Array.from({ length: now.getDate() }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), index + 1);
    cumulativeCalories += caloriesByDay.get(localDateKey2(date)) ?? 0;
    return Math.round(cumulativeCalories);
  });
  return {
    monthLabel: now.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
    current: Math.round(current),
    target,
    daysLeft,
    daysInMonth,
    pacePercent: now.getDate() / daysInMonth * 100,
    dailyActual,
    dailyNeeded: daysLeft > 0 ? Math.max(0, target - current) / daysLeft : 0,
    targetIsFixture: dataMode === "reference",
    elapsedDays: now.getDate(),
    activeDays: caloriesByDay.size,
    highestDayLabel: highestDay ? (/* @__PURE__ */ new Date(`${highestDay[0]}T12:00:00`)).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase() : void 0,
    highestDayCalories: highestDay ? Math.round(highestDay[1]) : void 0
  };
}
function dominantActivityState(categories) {
  const states = categories.map(categoryToSport);
  if (states.includes("badminton")) return "badminton";
  if (states.includes("calisthenics")) return "calisthenics";
  if (states.includes("run")) return "run";
  if (states.includes("cycling")) return "cycling";
  if (states.includes("foundation")) return "foundation";
  if (states.includes("strength")) return "strength";
  if (states.includes("weight_training")) return "weight_training";
  if (states.includes("hike")) return "hike";
  if (states.includes("walk")) return "walk";
  if (states.includes("cricket")) return "cricket";
  if (states.includes("football")) return "football";
  if (states.includes("workout")) return "workout";
  if (states.includes("swim")) return "swim";
  return "empty";
}
function calculateConsistency(activeKeys, start, end) {
  let currentBlock = 0;
  let longestBlock = 0;
  let currentGap = 0;
  let worstGap = 0;
  let gapCount = 0;
  let inGap = false;
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const active = activeKeys.has(localDateKey2(cursor));
    if (active) {
      currentBlock += 1;
      longestBlock = Math.max(longestBlock, currentBlock);
      if (inGap) {
        gapCount += 1;
        worstGap = Math.max(worstGap, currentGap);
      }
      currentGap = 0;
      inGap = false;
    } else {
      currentBlock = 0;
      currentGap += 1;
      inGap = true;
    }
  }
  if (inGap && currentGap > 0) {
    gapCount += 1;
    worstGap = Math.max(worstGap, currentGap);
  }
  return { longestBlock, gapCount, worstGap };
}
function buildTrainingActivitySnapshot(activities, activityEvidence) {
  const now = /* @__PURE__ */ new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const summaryStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const byDate = /* @__PURE__ */ new Map();
  activities.forEach((activity) => {
    const date = parseLocal(activity.start_date_local);
    if (date < start || date > now) return;
    const key = localDateKey2(date);
    const categories = byDate.get(key) ?? [];
    categories.push(getTrainingCategory(activity));
    byDate.set(key, categories);
  });
  const months = Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const dates = Array.from({ length: 28 }, (_2, dayIndex) => {
      const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), dayIndex + 1);
      return date.getMonth() === monthDate.getMonth() && date <= now ? localDateKey2(date) : null;
    });
    const cells = dates.map(
      (dateKey2) => dateKey2 ? dominantActivityState(byDate.get(dateKey2) ?? []) : "empty"
    );
    return {
      label: monthDate.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
      cells,
      dates
    };
  });
  const activeKeys = new Set(byDate.keys());
  const summaryActiveKeys = new Set(
    Array.from(activeKeys).filter((key) => /* @__PURE__ */ new Date(`${key}T12:00:00`) >= summaryStart)
  );
  const consistency = calculateConsistency(summaryActiveKeys, summaryStart, now);
  const dayDetails = activityEvidence.reduce(
    (details, activity) => {
      const date = /* @__PURE__ */ new Date(`${activity.dateKey}T12:00:00`);
      if (date < start || date > now) return details;
      const existing = details[activity.dateKey] ?? {
        dateLabel: activity.dateLabel,
        activities: [],
        durationMinutes: 0,
        load: 0
      };
      existing.activities.push(activity);
      existing.durationMinutes += activity.durationMinutes;
      existing.load = existing.load === null || activity.load === null ? null : existing.load + activity.load;
      details[activity.dateKey] = existing;
      return details;
    },
    {}
  );
  return {
    rangeLabel: `${months.at(-4)?.label ?? months[0]?.label ?? ""}\u2013${months.at(-1)?.label ?? ""}`,
    months,
    longestBlock: consistency.longestBlock,
    activeDays: summaryActiveKeys.size,
    planTruePercent: null,
    gapCount: consistency.gapCount,
    worstGap: consistency.worstGap,
    read: "Activity is observed from the log; plan-truth appears when completed-vs-planned history lands.",
    dayDetails
  };
}
function buildVo2Snapshot() {
  return {
    status: "unavailable",
    value: null,
    delta: null,
    trend: [],
    read: "Connect a real Apple Health VO\u2082 series before Coach reads the trend."
  };
}
function buildRecentSessions(activityEvidence) {
  return activityEvidence.slice(0, 3).map((activity) => ({
    id: activity.id,
    dateLabel: activity.dateLabel.replace(/^\w+\s/, ""),
    title: activity.title,
    detail: activity.averageHeartRate === null ? formatMinutesLabel(activity.durationMinutes) : `${formatMinutesLabel(activity.durationMinutes)} \xB7 ${activity.averageHeartRate} BPM`,
    load: activity.load,
    sport: activity.sport,
    evidence: activity
  }));
}
function buildPhaseSnapshot(challenge, dataMode) {
  const blockStart = challenge.phase?.current_block.start_date ?? challenge.challenge?.start_date;
  const blockEnd = challenge.phase?.current_block.end_date ?? challenge.challenge?.end_date;
  const start = blockStart ? /* @__PURE__ */ new Date(`${blockStart}T00:00:00`) : /* @__PURE__ */ new Date();
  const end = blockEnd ? /* @__PURE__ */ new Date(`${blockEnd}T00:00:00`) : /* @__PURE__ */ new Date();
  const totalWeeks = Math.max(1, Math.ceil((end.getTime() - start.getTime() + DAY_MS3) / (7 * DAY_MS3)));
  const currentWeek = Math.min(
    totalWeeks,
    Math.max(1, Math.floor((Date.now() - start.getTime()) / (7 * DAY_MS3)) + 1)
  );
  return {
    weekLabel: `WK ${currentWeek}/${totalWeeks}`,
    title: dataMode === "live" ? "BUILD PHASE \xB7 CHALLENGE DATA" : void 0,
    milestones: (challenge.milestones ?? []).slice(0, 3).map((milestone) => {
      const progress = milestone.progress;
      const progressPercent = progress ? Math.max(
        0,
        Math.min(
          100,
          Math.round(
            (progress.current_value - progress.baseline_value) / (progress.target_value - progress.baseline_value || 1) * 100
          )
        )
      ) : null;
      const projectedDateLabel = progress?.projected_date ? (/* @__PURE__ */ new Date(`${progress.projected_date}T00:00:00`)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase() : void 0;
      return {
        id: milestone.id,
        name: milestone.short_name ?? milestone.name,
        baseline: String(milestone.baseline ?? "\u2014"),
        current: milestone.short_current ?? String(milestone.current ?? milestone.baseline ?? "\u2014"),
        target: milestone.short_target ?? milestone.target,
        note: milestone.note,
        progressPercent,
        projectedDateLabel: dataMode === "live" ? projectedDateLabel : void 0
      };
    }),
    read: dataMode === "live" ? "Phase dates and milestone values are read directly from the generated challenge record." : "Dates assume plan-true weeks \u2014 every missed bar day slides them right."
  };
}
function buildCoachReadSnapshot(model, engine, quest, dataMode) {
  return {
    dateLabel: (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", {
      weekday: "short",
      month: "short",
      day: "numeric"
    }).toUpperCase(),
    body: [model.coachRead?.headline, model.coachRead?.body].filter(Boolean).join(" "),
    eyebrow: dataMode === "live" ? "LOG" : void 0,
    signature: dataMode === "live" ? "\u2014 COACH" : void 0,
    actionLabel: dataMode === "live" ? "Inspect evidence" : void 0,
    isPreview: model.dataStatus === "placeholder",
    evidence: [
      `LOAD ${engine.load} \xB7 BAND ${Math.round(engine.bandLow ?? engine.load)}\u2013${Math.round(engine.bandHigh ?? engine.load)}`,
      `${engine.totalHours.toFixed(1)}H RECORDED THIS WEEK`,
      `QUEST ${quest.completed}/${quest.target} \xB7 ${quest.daysLeft}D LEFT`
    ]
  };
}
function buildWarmHomeSnapshots(activities, challengeData, syncStatus, contract, dataMode = "live") {
  const model = buildWarmHomeModel(activities, challengeData, syncStatus, contract);
  const activityEvidence = buildActivityEvidenceSnapshots(activities);
  const engine = buildEngineSnapshot(activities, model.engine);
  const quest = buildQuestSnapshot(challengeData, model.quest);
  return {
    engine,
    quest,
    coachRead: buildCoachReadSnapshot(model, engine, quest, dataMode),
    commitments: buildCommitmentSnapshots(model.commitments, dataMode, activityEvidence),
    plan: buildWeeklyPlanSnapshot(model, engine, dataMode, activityEvidence),
    calories: buildCaloriesSnapshot(activities, dataMode),
    trainingActivity: buildTrainingActivitySnapshot(activities, activityEvidence),
    vo2: buildVo2Snapshot(),
    sessions: buildRecentSessions(activityEvidence),
    phase: buildPhaseSnapshot(challengeData, dataMode),
    amIImproving: buildBadmintonLensModel(activities, "ranked").amIImproving,
    activityEvidence,
    sync: {
      label: model.syncLabel,
      healthy: model.syncHealthy,
      status: syncStatus.status,
      timestamp: syncStatus.timestamp,
      warnings: syncStatus.warnings ?? []
    }
  };
}
function engineSnapshotS(engine) {
  return {
    weekLabel: engine.weekLabel,
    load: engine.load,
    signal: engine.signal,
    compactVerdict: engine.compactVerdict ?? engine.verdict,
    bandLow: engine.bandLow,
    bandHigh: engine.bandHigh
  };
}
function questSnapshotS(quest) {
  const progressPercent = quest.target > 0 ? Math.min(100, Math.round(quest.completed / quest.target * 100)) : 0;
  return {
    name: quest.name,
    completed: quest.completed,
    target: quest.target,
    progressPercent
  };
}
function buildWidgetSnapshotsFile(activities, challengeData, syncStatus, contract, dataMode = "live") {
  const home = buildWarmHomeSnapshots(
    activities,
    challengeData,
    syncStatus,
    contract,
    dataMode
  );
  return {
    schema_version: 1,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    home,
    sizes: {
      engine: {
        S: engineSnapshotS(home.engine),
        M: home.engine,
        L: home.engine
      },
      quest: {
        S: questSnapshotS(home.quest),
        M: home.quest
      },
      commitments: {
        S: home.commitments.find((item) => item.id === "badminton") ?? home.commitments[0] ?? {
          id: "badminton",
          label: "Badminton",
          glyph: "badminton",
          value: 0,
          target: 2,
          note: "NO DATA",
          status: "ALL",
          progress: 0,
          accent: "#315a4a"
        },
        M: home.commitments
      }
    }
  };
}

// ui/client/src/lib/splitLedgerChallenge.ts
function splitLedgerAsChallenge(ledger) {
  const season = ledger.seasons.seasons.find((item) => item.id === ledger.seasons.current_season_id);
  if (!season || !ledger.quests.main_quest) return null;
  const rowsFor = (questId) => ledger.progress.rows.filter((row) => row.quest_id === questId);
  const questWithProgress = (quest) => {
    const rows = rowsFor(quest.id);
    const latestValue = [...rows].reverse().find((row) => row.value != null)?.value;
    return {
      ...quest,
      status: quest.status === "graduated" ? "completed" : quest.status,
      completed_dates: rows.filter((row) => row.status === "completed").map((row) => row.date),
      missed_dates: rows.filter((row) => row.status === "missed").map((row) => row.date),
      excused_dates: rows.filter((row) => row.status === "excused").map((row) => row.date),
      ...latestValue != null ? { current: Number(latestValue) } : {}
    };
  };
  const mainRows = rowsFor(ledger.quests.main_quest.id);
  return {
    version: 4,
    season: { name: season.name, start_date: season.start_date, end_date: season.end_date },
    weekly_targets: Object.fromEntries(Object.entries(ledger.quests.weekly_targets).map(([key, value]) => [key, value.target])),
    main_quest: { ...ledger.quests.main_quest, completed_dates: mainRows.filter((row) => row.status === "completed").map((row) => row.date) },
    quests: ledger.quests.quests.map(questWithProgress)
  };
}

// ui/api/auth/_lib/generate-widget-snapshots-from-dashboard-snapshot.ts
function localDateKey3(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
function isPlaceholderWeekStale(week) {
  const startDate = week.week?.start_date;
  const endDate = week.week?.end_date;
  if (typeof startDate !== "string" || typeof endDate !== "string") return true;
  const today = localDateKey3(/* @__PURE__ */ new Date());
  return today < startDate || today > endDate;
}
function needsLiveRecomputation(week) {
  if (!week || week.data_status === "unavailable") return true;
  if (week.data_status === "placeholder") {
    return isPlaceholderWeekStale(week);
  }
  return false;
}
function generateWidgetSnapshotsFromDashboardSnapshot(aggregate) {
  const challenge = aggregate.ledger ? splitLedgerAsChallenge(aggregate.ledger) : aggregate.challenge_v2 ?? null;
  if (!challenge) return null;
  const activities = aggregate.activities ?? [];
  const syncStatus = aggregate.sync_status ?? {
    status: "none",
    timestamp: null,
    warnings: []
  };
  const contract = needsLiveRecomputation(aggregate.current_week) ? buildLiveWeekContract(activities, challenge) : aggregate.current_week;
  return buildWidgetSnapshotsFile(activities, challenge, syncStatus, contract, "live");
}
export {
  generateWidgetSnapshotsFromDashboardSnapshot,
  needsLiveRecomputation,
  splitLedgerAsChallenge
};
