#!/usr/bin/env python3
import json
import argparse
import sys
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Migrate old match history to new schema.")
    parser.add_argument('--dry-run', action='store_true', help="Print what it would do without writing")
    return parser.parse_args()


def load_json(filepath):
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        print(f"Error parsing JSON from {filepath}", file=sys.stderr)
        return None


def parse_activity_description(description):
    rank = None
    notes = None
    games_categories = []
    
    if not description:
        return [], rank, notes
        
    lines = [line.strip() for line in description.strip().split('\n')]
    
    if lines and 'W-' not in lines[0] and not lines[0].startswith('Games:') and not lines[0].startswith('Friendlies:'):
        if '|' not in lines[0] and '%' not in lines[0]:
            notes = lines[0]
        
    current_section = None
    for line in lines:
        if 'Rank: #' in line:
            parts = line.split('Rank: #')
            if len(parts) > 1:
                try:
                    rank = int(parts[1].split()[0])
                except ValueError:
                    pass
                    
        if line.startswith('Games:'):
            current_section = 'ranked'
            continue
        elif line.startswith('Friendlies:'):
            current_section = 'friendly'
            continue
            
        if current_section and (line.startswith('W ') or line.startswith('L ')):
            games_categories.append(current_section)
            
    return games_categories, rank, notes


def main():
    args = parse_args()
    
    repo_root = Path(__file__).parent.parent.parent.resolve()
    activities_hist_dir = repo_root / "user_data" / "activities" / "hist"
    new_history_path = repo_root / "user_data" / "activities" / "match_history.json"
    
    candidate_paths = [
        repo_root / "badminton_match_data.json",
        repo_root / "training" / "ebadders_history.json",
        repo_root / "platform" / "plugins" / "badminton" / "data" / "badminton_match_data.json",
        repo_root / "engine" / "plugins" / "badminton" / "data" / "badminton_match_data.json",
        repo_root / "user_data" / "activities" / "badminton_match_data.json"
    ]
    
    old_history = None
    source_path = None
    for path in candidate_paths:
        data = load_json(path)
        if data and isinstance(data, list) and len(data) > 0:
            old_history = data
            source_path = path
            break
            
    if old_history is None:
        if new_history_path.exists():
            print(f"Match history already exists at {new_history_path}. Nothing to migrate.")
            sys.exit(0)
        print("No legacy match history found to migrate.")
        sys.exit(0)

    print(f"Migrating legacy match history from: {source_path}")
        
    new_sessions = []
    total_sessions_migrated = 0
    total_games_migrated = 0
    
    for entry in old_history:
        date = entry.get('date')
        
        activity_file = activities_hist_dir / f"{date}.json"
        activity_data = load_json(activity_file)
        
        description = ""
        if activity_data and 'description' in activity_data:
            description = activity_data['description']
            
        games_categories, rank, notes = parse_activity_description(description)
        
        new_games = []
        old_matches = entry.get('matches', [])
        
        for i, match in enumerate(old_matches):
            category = "ranked"
            if i < len(games_categories):
                category = games_categories[i]
                
            partner = match.get('partner')
            if isinstance(partner, list):
                partner = " & ".join(partner) if partner else None
            if not partner or partner == "Solo":
                partner = None
                
            fmt = match.get('format') or ("singles" if partner is None else "doubles")
            
            akash_won = match.get('akashWon') if 'akashWon' in match else match.get('akash_won')
            result = match.get('result') or ("W" if akash_won else ("L" if akash_won is False else None))
            
            score_str = match.get('score', "")
            score_for = match.get('scoreFor', 0)
            score_against = match.get('scoreAgainst', 0)
            if (score_for == 0 and score_against == 0) and '-' in score_str:
                parts = score_str.split('-')
                if len(parts) == 2:
                    try:
                        score_for = int(parts[0])
                        score_against = int(parts[1])
                    except ValueError:
                        pass
                        
            new_game = {
                "format": fmt,
                "category": category,
                "partner": partner,
                "opponents": match.get('vs', []),
                "scoreFor": score_for,
                "scoreAgainst": score_against,
                "result": result
            }
            new_games.append(new_game)
            total_games_migrated += 1
            
        summary = {
            "wins": entry.get('wins', 0),
            "losses": entry.get('losses', 0),
            "winPct": entry.get('winPct') if entry.get('winPct') is not None else entry.get('win_pct', 0)
        }
        
        new_session = {
            "date": date,
            "activityId": entry.get('activityId') if entry.get('activityId') is not None else entry.get('activity_id'),
            "preMentalState": entry.get('preMentalState') if entry.get('preMentalState') is not None else entry.get('pre_mental_state'),
            "rank": rank,
            "notes": notes,
            "summary": summary,
            "games": new_games
        }
        new_sessions.append(new_session)
        total_sessions_migrated += 1
        
    new_data = {
        "version": 1,
        "sessions": new_sessions
    }
    
    if args.dry_run:
        print(f"DRY RUN: Would write to {new_history_path}")
        print(json.dumps(new_data, indent=2))
    else:
        new_history_path.parent.mkdir(parents=True, exist_ok=True)
        with open(new_history_path, 'w') as f:
            json.dump(new_data, f, indent=2)
            
    print("Migration Summary:")
    print(f"Sessions migrated: {total_sessions_migrated}")
    print(f"Games migrated: {total_games_migrated}")
    if total_sessions_migrated != len(old_history):
        print(f"WARNING: Gap in sessions (Read {len(old_history)}, Migrated {total_sessions_migrated})")

if __name__ == "__main__":
    main()
