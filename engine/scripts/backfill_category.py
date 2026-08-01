#!/usr/bin/env python3
import argparse
import glob
import json
import sys
from datetime import datetime
from pathlib import Path

_here = Path(__file__).resolve().parent
sys.path.insert(0, str(_here.parent / "lib"))
sys.path.insert(0, str(_here.parent / "core"))
from repo_layout import categories_path, hist_dir, repo_root_from_here
from category_resolver import load_config, resolve_from_activity


def main():
    parser = argparse.ArgumentParser(description="Backfill category on existing activities.")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing")
    parser.add_argument("--force", action="store_true", help="Re-derive category even if already present")
    parser.add_argument("--config", help="Path to categories.json config file")
    args = parser.parse_args()

    root = repo_root_from_here(__file__)
    h_dir = hist_dir(root)
    
    config_path = Path(args.config) if args.config else categories_path(root)
    if not config_path.is_file():
        print(f"Error: Categories config not found at {config_path}", file=sys.stderr)
        sys.exit(1)
        
    config = load_config(str(config_path))
    
    changed_count = 0
    skipped_count = 0

    for fp in sorted(glob.glob(str(h_dir / "*.json"))):
        try:
            with open(fp, "r") as f:
                data = json.load(f)
            
            if "category" in data and not args.force:
                skipped_count += 1
                continue
            
            cat = resolve_from_activity(data, config)
            
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
