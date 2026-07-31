#!/usr/bin/env python3
"""Generate gen/badminton_analytics_snapshot.json from activity history.

Reads user_data/activities/match_history.json (canonical, ADR 0013) and
user_data/activities/hist/*.json, computes match analytics, and writes a compact
snapshot for Coach Phelps and the dashboard.

Usage:
    python platform/plugins/badminton/analytics.py
    python engine/plugins/badminton/analytics.py
    python platform/plugins/badminton/generate_analytics_snapshot.py  # thin wrapper
"""

import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_ENGINE = Path(__file__).resolve().parents[3] / "engine"
sys.path.insert(0, str(_ENGINE / "lib"))
sys.path.insert(0, str(_ENGINE))

from repo_layout import activities_dir, gen_dir, hist_dir, repo_root_from_here  # noqa: E402
from core.taxonomy import BADMINTON_CATEGORIES, get_training_category

REPO_DIR = repo_root_from_here(__file__)
ACTIVITIES_DIR = activities_dir(REPO_DIR)
HISTORY_DIR = hist_dir(REPO_DIR)
CANONICAL_MATCH_HISTORY_PATH = ACTIVITIES_DIR / "match_history.json"
LEGACY_MATCH_DATA_PATH = Path(__file__).resolve().parent / "data" / "badminton_match_data.json"
ROOT_MATCH_DATA_PATH = REPO_DIR / "badminton_match_data.json"
OUTPUT_PATH = gen_dir(REPO_DIR) / "badminton_analytics_snapshot.json"


def load_match_history() -> dict[str, dict]:
    """Load match history from canonical match_history.json or legacy fallbacks, keyed by YYYY-MM-DD."""
    history_file = None
    if CANONICAL_MATCH_HISTORY_PATH.exists():
        history_file = CANONICAL_MATCH_HISTORY_PATH
    elif ROOT_MATCH_DATA_PATH.exists():
        history_file = ROOT_MATCH_DATA_PATH
    elif LEGACY_MATCH_DATA_PATH.exists():
        history_file = LEGACY_MATCH_DATA_PATH

    if not history_file:
        return {}

    try:
        raw_data = json.loads(history_file.read_text())
    except (json.JSONDecodeError, OSError):
        return {}

    by_date = {}
    if isinstance(raw_data, dict) and "sessions" in raw_data:
        for s in raw_data["sessions"]:
            date = s.get("date")
            if date:
                by_date[date] = s
    elif isinstance(raw_data, list):
        for s in raw_data:
            date = s.get("date")
            if date:
                by_date[date] = s
    return by_date


def load_badminton_activities() -> list[dict]:
    """Load all badminton activities from history, sorted by date ascending."""
    activities = []
    if not HISTORY_DIR.exists():
        return activities

    for fpath in sorted(HISTORY_DIR.glob("*.json")):
        try:
            data = json.loads(fpath.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        category = get_training_category(data)
        if category not in BADMINTON_CATEGORIES:
            continue

        data["_category"] = category
        data["_date"] = (data.get("start_date_local") or "")[:10]
        activities.append(data)

    return activities


def build_sessions(
    activities: list[dict], match_history_map: dict[str, dict]
) -> list[dict]:
    """Build session records with ranked/all game lists from structured match_history.json.

    Dates without structured games (canonical or legacy matches) are skipped.
    """
    sessions = []
    activities_by_date = {act["_date"]: act for act in activities}
    all_dates = sorted(set(activities_by_date.keys()) | set(match_history_map.keys()))

    for date in all_dates:
        act = activities_by_date.get(date, {})
        category = act.get("_category", "Badminton")
        avg_hr = act.get("average_heartrate")
        act_name = act.get("name", "Badminton Session")

        match_entry = match_history_map.get(date)
        ranked_games = []
        friendly_games = []

        if match_entry and "games" in match_entry:
            for g in match_entry["games"]:
                res = g.get("result")
                won = res == "W" if res is not None else (g.get("scoreFor", 0) > g.get("scoreAgainst", 0))
                game_obj = {
                    "won": won,
                    "our_score": g.get("scoreFor", 0),
                    "their_score": g.get("scoreAgainst", 0),
                    "partner": g.get("partner"),
                    "opponents": g.get("opponents", []),
                    "format": g.get("format", "singles" if not g.get("partner") else "doubles"),
                    "category": g.get("category", "ranked"),
                }
                if game_obj["category"] == "friendly":
                    friendly_games.append(game_obj)
                else:
                    ranked_games.append(game_obj)
        elif match_entry and "matches" in match_entry:
            # Legacy format fallback
            for m in match_entry.get("matches", []):
                score = m.get("score", "0-0")
                parts = score.split("-")
                s1 = int(parts[0]) if len(parts) == 2 else 0
                s2 = int(parts[1]) if len(parts) == 2 else 0
                akash_won = m.get("akashWon") if "akashWon" in m else m.get("akash_won")
                won = m.get("result") == "W" if "result" in m else (akash_won if akash_won is not None else s1 > s2)
                our_score = max(s1, s2) if won else min(s1, s2)
                their_score = min(s1, s2) if won else max(s1, s2)
                partner = m.get("partner")
                if isinstance(partner, list):
                    partner = partner[0] if partner else None
                if partner == "Solo":
                    partner = None
                fmt = m.get("format") or ("singles" if not partner else "doubles")
                cat = m.get("category", "ranked")
                game_obj = {
                    "won": won,
                    "our_score": our_score,
                    "their_score": their_score,
                    "partner": partner,
                    "opponents": m.get("vs", []),
                    "format": fmt,
                    "category": cat,
                }
                if cat == "friendly":
                    friendly_games.append(game_obj)
                else:
                    ranked_games.append(game_obj)
        # No structured match history for this date — skip (ADR 0013:
        # analytics reads match_history.json only; description text is display).

        all_games = ranked_games + friendly_games
        if not all_games:
            continue

        sessions.append({
            "date": date,
            "name": act_name,
            "category": category,
            "avg_hr": avg_hr,
            "ranked_games": ranked_games,
            "friendly_games": friendly_games,
            "all_games": all_games,
        })

    return sorted(sessions, key=lambda s: s["date"])


# ─── Analytics computation ───────────────────────────────────────────────

def compute_win_rate(wins: int, total: int) -> int:
    """Compute win rate as integer percentage."""
    return round(wins / total * 100) if total else 0


def compute_current_form(session_results: list[bool]) -> dict:
    """Compute current form from recent session results (newest first).

    A session is a "win" if win_pct > 50, "loss" otherwise.
    """
    if not session_results:
        return {"type": "unknown", "count": 0, "label": "No data"}

    # Count streak from most recent
    streak_type = session_results[0]
    count = 0
    for r in session_results:
        if r == streak_type:
            count += 1
        else:
            break

    if streak_type:
        return {
            "type": "winning_streak",
            "count": count,
            "label": f"{count} session winning streak",
        }
    else:
        return {
            "type": "losing_streak",
            "count": count,
            "label": f"{count} session losing streak",
        }


def compute_fatigue_curve(games_with_index: list[dict]) -> dict:
    """Compute fatigue buckets from games with their within-session index.

    Buckets: early (1-4), mid (5-8), late (9+).
    """
    buckets = {
        "early": {"wins": 0, "total": 0},
        "mid": {"wins": 0, "total": 0},
        "late": {"wins": 0, "total": 0},
    }

    for g in games_with_index:
        idx = g["game_num"]  # 1-based
        if idx <= 4:
            bucket = "early"
        elif idx <= 8:
            bucket = "mid"
        else:
            bucket = "late"
        buckets[bucket]["total"] += 1
        if g["won"]:
            buckets[bucket]["wins"] += 1

    early_wr = compute_win_rate(buckets["early"]["wins"], buckets["early"]["total"])
    mid_wr = compute_win_rate(buckets["mid"]["wins"], buckets["mid"]["total"])
    late_wr = compute_win_rate(buckets["late"]["wins"], buckets["late"]["total"])

    # Find drop-off game (only if win rate actually drops)
    drop_off = None
    if early_wr > late_wr and mid_wr > late_wr:
        drop_off = 8
    elif early_wr > mid_wr:
        drop_off = 4

    result = {
        "buckets": {
            "early": {
                "games": "1-4",
                "win_rate": early_wr,
                "sample_size": buckets["early"]["total"],
            },
            "mid": {
                "games": "5-8",
                "win_rate": mid_wr,
                "sample_size": buckets["mid"]["total"],
            },
            "late": {
                "games": "9+",
                "win_rate": late_wr,
                "sample_size": buckets["late"]["total"],
            },
        },
    }

    if drop_off:
        result["drop_off_game"] = drop_off

    # Generate insight
    if buckets["early"]["total"] and buckets["late"]["total"]:
        if drop_off:
            result["insight"] = (
                f"Win rate drops from {early_wr}% (games 1-4) to {late_wr}% (games 9+). "
                f"You fade after game {drop_off}."
            )
        elif late_wr > early_wr:
            result["insight"] = (
                f"Win rate rises from {early_wr}% (games 1-4) to {late_wr}% (games 9+). "
                f"You warm up as sessions go on."
            )
        else:
            result["insight"] = (
                f"Win rate is steady: {early_wr}% early, {mid_wr}% mid, {late_wr}% late. "
                f"No significant fatigue pattern."
            )
    elif buckets["early"]["total"]:
        result["insight"] = f"Win rate is {early_wr}% in early games (1-4). Not enough late-game data yet."
    else:
        result["insight"] = "Not enough data for fatigue analysis."

    return result


def compute_score_distribution(games: list[dict]) -> dict:
    """Compute score distribution across 6 buckets based on point differential."""
    buckets = {
        "blowout_win": 0,
        "comfortable_win": 0,
        "close_win": 0,
        "close_loss": 0,
        "comfortable_loss": 0,
        "blowout_loss": 0,
    }

    for g in games:
        diff = g["our_score"] - g["their_score"]
        abs_diff = abs(diff)
        if diff > 0:  # win
            if abs_diff >= 8:
                buckets["blowout_win"] += 1
            elif abs_diff >= 4:
                buckets["comfortable_win"] += 1
            else:
                buckets["close_win"] += 1
        else:  # loss (diff <= 0)
            if abs_diff >= 8:
                buckets["blowout_loss"] += 1
            elif abs_diff >= 4:
                buckets["comfortable_loss"] += 1
            else:
                buckets["close_loss"] += 1

    total = len(games)
    result = {}
    most_common_label = ""
    most_common_count = 0

    label_map = {
        "blowout_win": "Blowout Win (8+ pts)",
        "comfortable_win": "Comfortable Win (4-7 pts)",
        "close_win": "Close Win (1-3 pts)",
        "close_loss": "Close Loss (1-3 pts)",
        "comfortable_loss": "Comfortable Loss (4-7 pts)",
        "blowout_loss": "Blowout Loss (8+ pts)",
    }

    for key in buckets:
        count = buckets[key]
        pct = round(count / total * 100) if total else 0
        result[key] = {"pct": pct, "count": count}
        if count > most_common_count:
            most_common_count = count
            most_common_label = label_map[key]

    # Insight
    most_common_pct = round(most_common_count / total * 100) if total else 0
    if "Loss" in most_common_label:
        result["insight"] = (
            f"Most common result: {most_common_label} — {most_common_pct}%. "
            f"You're competitive but not closing."
        )
    elif "Win" in most_common_label:
        result["insight"] = (
            f"Most common result: {most_common_label} — {most_common_pct}%. "
            f"You're converting well."
        )
    else:
        result["insight"] = "Not enough data for score distribution analysis."

    return result


def compute_partner_stats(
    games: list[dict], recent_games: list[dict]
) -> tuple[list[dict], list[dict]]:
    """Compute top partners and nemesis lists.

    Args:
        games: all games for the section
        recent_games: last 5 sessions' worth of games (for form arrows)

    Returns: (top_partners, nemesis)
    """
    # Aggregate by partner
    partner_stats = defaultdict(lambda: {"wins": 0, "total": 0, "score_diffs": []})
    for g in games:
        p = g.get("partner")
        if p and g.get("format") != "singles":
            partner_stats[p]["total"] += 1
            if g["won"]:
                partner_stats[p]["wins"] += 1
            partner_stats[p]["score_diffs"].append(g["our_score"] - g["their_score"])

    # Aggregate by opponent
    opponent_stats = defaultdict(lambda: {"wins": 0, "total": 0, "score_diffs": []})
    for g in games:
        for opp in g["opponents"]:
            opponent_stats[opp]["total"] += 1
            if g["won"]:
                opponent_stats[opp]["wins"] += 1
            opponent_stats[opp]["score_diffs"].append(
                g["our_score"] - g["their_score"]
            )

    # Recent stats for form arrows
    recent_partner_stats = defaultdict(lambda: {"wins": 0, "total": 0})
    recent_opponent_stats = defaultdict(lambda: {"wins": 0, "total": 0})
    for g in recent_games:
        p = g.get("partner")
        if p and g.get("format") != "singles":
            recent_partner_stats[p]["total"] += 1
            if g["won"]:
                recent_partner_stats[p]["wins"] += 1
        for opp in g["opponents"]:
            recent_opponent_stats[opp]["total"] += 1
            if g["won"]:
                recent_opponent_stats[opp]["wins"] += 1

    def form_arrow(overall_wr: float, recent_wr: float) -> str:
        diff = recent_wr - overall_wr
        if diff > 10:
            return "up"
        elif diff < -10:
            return "down"
        return "stable"

    # Top partners: min 10 games, >50% win rate, composite = games * win_pct/100
    top_partners = []
    for name, stats in partner_stats.items():
        if stats["total"] < 10:
            continue
        win_pct = compute_win_rate(stats["wins"], stats["total"])
        if win_pct <= 50:
            continue
        avg_diff = round(sum(stats["score_diffs"]) / len(stats["score_diffs"]), 1)
        composite = stats["total"] * win_pct / 100

        recent = recent_partner_stats.get(name, {"wins": 0, "total": 0})
        recent_wr = compute_win_rate(recent["wins"], recent["total"]) if recent["total"] else win_pct
        arrow = form_arrow(win_pct, recent_wr)

        top_partners.append({
            "name": name,
            "games": stats["total"],
            "win_pct": win_pct,
            "score_diff": avg_diff,
            "form": arrow,
            "_composite": composite,
        })

    top_partners.sort(key=lambda x: x["_composite"], reverse=True)
    for p in top_partners:
        del p["_composite"]
    top_partners = top_partners[:3]

    # Nemesis: min 10 games, <50% win rate, composite = games * (1 - win_pct/100)
    nemesis = []
    for name, stats in opponent_stats.items():
        if stats["total"] < 10:
            continue
        win_pct = compute_win_rate(stats["wins"], stats["total"])
        if win_pct >= 50:
            continue
        avg_diff = round(sum(stats["score_diffs"]) / len(stats["score_diffs"]), 1)
        composite = stats["total"] * (1 - win_pct / 100)

        recent = recent_opponent_stats.get(name, {"wins": 0, "total": 0})
        recent_wr = compute_win_rate(recent["wins"], recent["total"]) if recent["total"] else win_pct
        arrow = form_arrow(win_pct, recent_wr)

        nemesis.append({
            "name": name,
            "games": stats["total"],
            "win_pct": win_pct,
            "score_diff": avg_diff,
            "form": arrow,
            "_composite": composite,
        })

    nemesis.sort(key=lambda x: x["_composite"], reverse=True)
    for n in nemesis:
        del n["_composite"]
    nemesis = nemesis[:3]

    return top_partners, nemesis


def compute_monthly_trend(sessions: list[dict], game_key: str, n_months: int = 3) -> list[dict]:
    """Compute monthly win rate trend for last N months.

    Args:
        sessions: all sessions (date ascending)
        game_key: "ranked_games" or "all_games"
        n_months: number of months to include
    """
    monthly = defaultdict(lambda: {"wins": 0, "total": 0, "sessions": 0})

    for s in sessions:
        games = s.get(game_key, [])
        if not games:
            continue
        month_label = datetime.strptime(s["date"], "%Y-%m-%d").strftime("%b %Y")
        month_key = s["date"][:7]  # YYYY-MM for sorting
        monthly[month_key]["wins"] += sum(1 for g in games if g["won"])
        monthly[month_key]["total"] += len(games)
        monthly[month_key]["sessions"] += 1
        monthly[month_key]["label"] = month_label

    # Sort by month descending, take last N
    sorted_months = sorted(monthly.keys(), reverse=True)[:n_months]

    return [
        {
            "month": monthly[mk]["label"],
            "win_rate": compute_win_rate(monthly[mk]["wins"], monthly[mk]["total"]),
            "sessions": monthly[mk]["sessions"],
        }
        for mk in sorted_months
    ]


def compute_recent_sessions(
    sessions: list[dict], game_key: str, n: int = 5
) -> list[dict]:
    """Get last N sessions with game data.

    Args:
        sessions: all sessions (date ascending)
        game_key: "ranked_games" or "all_games"
        n: number of recent sessions
    """
    # Filter to sessions that have games for this key
    with_games = [s for s in sessions if s.get(game_key)]
    recent = with_games[-n:][::-1]  # newest first

    result = []
    for s in recent:
        games = s[game_key]
        wins = sum(1 for g in games if g["won"])
        losses = len(games) - wins
        total = len(games)
        result.append({
            "date": s["date"],
            "name": s["name"],
            "wl": f"{wins}W-{losses}L",
            "win_pct": compute_win_rate(wins, total),
            "avg_hr": s["avg_hr"],
        })

    return result


def compute_best_month(sessions: list[dict], game_key: str) -> Optional[dict]:
    """Find the month with highest win rate (min 10 games)."""
    monthly = defaultdict(lambda: {"wins": 0, "total": 0})

    for s in sessions:
        games = s.get(game_key, [])
        if not games:
            continue
        month_key = s["date"][:7]
        month_label = datetime.strptime(s["date"], "%Y-%m-%d").strftime("%b %Y")
        monthly[month_key]["wins"] += sum(1 for g in games if g["won"])
        monthly[month_key]["total"] += len(games)
        monthly[month_key]["label"] = month_label

    best = None
    best_wr = -1
    for mk, stats in monthly.items():
        if stats["total"] < 10:
            continue
        wr = compute_win_rate(stats["wins"], stats["total"])
        if wr > best_wr:
            best_wr = wr
            best = {"label": stats["label"], "win_rate": wr}

    return best


def build_section(
    sessions: list[dict], game_key: str
) -> dict:
    """Build a complete analytics section (ranked or all_games).

    Args:
        sessions: all sessions (date ascending)
        game_key: "ranked_games" or "all_games"
    """
    # Collect all games with session index
    all_games_flat = []
    games_with_index = []
    for s in sessions:
        games = s.get(game_key, [])
        for i, g in enumerate(games, start=1):
            all_games_flat.append(g)
            games_with_index.append({**g, "game_num": i})

    total_games = len(all_games_flat)
    total_wins = sum(1 for g in all_games_flat if g["won"])
    sessions_with_games = [s for s in sessions if s.get(game_key)]
    total_sessions = len(sessions_with_games)

    if total_games == 0:
        return {"overall": {"win_rate": 0, "total_games": 0, "total_sessions": 0}}

    # Overall
    win_rate = compute_win_rate(total_wins, total_games)
    best_month = compute_best_month(sessions, game_key)

    # Current form — based on session-level win/loss (newest first)
    session_results = []
    for s in reversed(sessions_with_games):
        games = s[game_key]
        wins = sum(1 for g in games if g["won"])
        session_results.append(wins > len(games) / 2)

    current_form = compute_current_form(session_results)

    overall = {
        "win_rate": win_rate,
        "total_games": total_games,
        "total_sessions": total_sessions,
        "current_form": current_form,
    }
    if best_month:
        overall["best_month"] = best_month

    # Fatigue curve
    fatigue = compute_fatigue_curve(games_with_index)

    # Score distribution
    score_dist = compute_score_distribution(all_games_flat)

    # Recent games for form arrows (last 5 sessions)
    recent_sessions_data = sessions_with_games[-5:]
    recent_games_flat = []
    for s in recent_sessions_data:
        recent_games_flat.extend(s[game_key])

    # Partners & nemesis
    top_partners, nemesis = compute_partner_stats(all_games_flat, recent_games_flat)

    # Monthly trend
    monthly_trend = compute_monthly_trend(sessions, game_key)

    # Recent sessions
    recent_sessions = compute_recent_sessions(sessions, game_key)

    return {
        "overall": overall,
        "fatigue_curve": fatigue,
        "score_distribution": score_dist,
        "top_partners": top_partners,
        "nemesis": nemesis,
        "monthly_trend": monthly_trend,
        "recent_sessions": recent_sessions,
    }


# ─── Main ────────────────────────────────────────────────────────────────

def main():
    print("[analytics] Loading activities...", file=sys.stderr)
    activities = load_badminton_activities()
    print(f"[analytics] Found {len(activities)} badminton activities", file=sys.stderr)

    match_history = load_match_history()
    print(f"[analytics] Loaded {len(match_history)} match-history sessions", file=sys.stderr)

    sessions = build_sessions(activities, match_history)
    print(f"[analytics] Built {len(sessions)} sessions with game data", file=sys.stderr)

    if not sessions:
        print("[analytics] No sessions with game data found — skipping snapshot", file=sys.stderr)
        return

    # Data range
    dates = [s["date"] for s in sessions]
    total_games = sum(len(s["all_games"]) for s in sessions)

    data_range = {
        "first_session": min(dates),
        "last_session": max(dates),
        "total_sessions": len(sessions),
        "total_games": total_games,
    }

    # Build sections
    ranked_section = build_section(sessions, "ranked_games")
    all_section = build_section(sessions, "all_games")

    snapshot = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "data_range": data_range,
        "ranked": ranked_section,
        "all_games": all_section,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"[analytics] Written to {OUTPUT_PATH}", file=sys.stderr)
    print(f"[analytics] Ranked: {ranked_section['overall']['total_games']} games, "
          f"{ranked_section['overall']['win_rate']}% win rate", file=sys.stderr)
    print(f"[analytics] All: {all_section['overall']['total_games']} games, "
          f"{all_section['overall']['win_rate']}% win rate", file=sys.stderr)


if __name__ == "__main__":
    main()
