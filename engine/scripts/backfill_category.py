#!/usr/bin/env python3
import argparse
import glob
import json
import sys
from datetime import datetime
from pathlib import Path

_here = Path(__file__).resolve().parent
sys.path.insert(0, str(_here.parent / "lib"))
from repo_layout import hist_dir, repo_root_from_here

def derive_category(activity: dict) -> str:
    sport = activity.get("sport_type", activity.get("type", ""))
    start = activity.get("start_date_local", "")
    if start:
        dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    else:
        dt = datetime.now()
    dow = dt.weekday()
    dur_sec = activity.get("elapsed_time", 0)

    if sport == "WeightTraining":
        return "foundation" if dur_sec < 1500 else "calisthenics"
    elif sport == "Yoga":
        return "realign" if dow == 6 else "recovery"
    elif sport == "Badminton":
        return "badminton"
    elif sport == "Run":
        return "run"
    elif sport == "Ride":
        return "ride"
    elif sport == "Swim":
        return "swim"
    
    return sport.lower()

def main():
    parser = argparse.ArgumentParser(description="Backfill category on existing activities.")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing")
    args = parser.parse_args()

    root = repo_root_from_here(__file__)
    h_dir = hist_dir(root)
    
    changed_count = 0
    skipped_count = 0

    for fp in sorted(glob.glob(str(h_dir / "*.json"))):
        try:
            with open(fp, "r") as f:
                data = json.load(f)
            
            if "category" in data:
                skipped_count += 1
                continue
            
            cat = derive_category(data)
            
            if args.dry_run:
                print(f"[Dry Run] Would set category='{cat}' in {Path(fp).name}")
            else:
                data["category"] = cat
                with open(fp, "w") as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                print(f"Updated {Path(fp).name} with category='{cat}'")
                
            changed_count += 1
            
        except Exception as e:
            print(f"Error processing {fp}: {e}", file=sys.stderr)
            
    print(f"\nDone. Changed: {changed_count}, Skipped (already had category): {skipped_count}")

if __name__ == "__main__":
    main()
