#!/usr/bin/env python3
"""Export the live network from Supabase into public/demo-data.json.

The static demo hydrates from this snapshot; re-run after any scrape to
refresh it. Only permanent local avatar paths (/avatars/*.webp) survive the
export — signed LinkedIn CDN URLs expire in ~3 weeks, so they are blanked
and the UI falls back to tier-colored initials.

Reads SUPABASE_URL / SUPABASE_ANON_KEY from the environment, falling back to
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in ../.env.local.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

COLUMNS = [
    "id", "degree", "source_connection_id", "name", "headline", "company",
    "role", "profile_url", "profile_image_url", "tier", "power_score",
    "seniority_score", "company_prestige_score", "influence_signals",
    "connected_date", "scanned_company", "outreach_status", "unlock_status",
    "unlocked_from_bridge_id", "unlocked_from_name", "is_catalyst",
    "catalyst_score", "circle_power", "circle_s_count", "circle_a_count",
    "circle_elite_pct",
]

DEMO_USER = {
    "id": "a1b2c3d4-0000-0000-0000-000000000001",
    "name": "You",
    "headline": "Your network",
}


def load_env():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if url and key:
        return url, key
    env_file = ROOT / ".env.local"
    if env_file.exists():
        env = {}
        for line in env_file.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
        url = url or env.get("NEXT_PUBLIC_SUPABASE_URL")
        key = key or env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        sys.exit("Missing SUPABASE_URL / SUPABASE_ANON_KEY (env or .env.local)")
    return url, key


def fetch_degree(url, key, degree):
    rows, offset, page = [], 0, 1000
    while True:
        q = (f"{url}/rest/v1/linkedin_connections?degree=eq.{degree}"
             f"&select={','.join(COLUMNS)}&order=power_score.desc.nullslast"
             f"&limit={page}&offset={offset}")
        req = urllib.request.Request(q, headers={
            "apikey": key, "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req) as res:
            batch = json.load(res)
        rows.extend(batch)
        if len(batch) < page:
            return rows
        offset += page


def main():
    url, key = load_env()
    out = {"user": DEMO_USER, "degree1": [], "degree2": []}
    kept = blanked = 0
    for degree in (1, 2):
        rows = fetch_degree(url, key, degree)
        for r in rows:
            img = r.get("profile_image_url") or ""
            if img.startswith("/avatars/"):
                kept += 1
            else:
                if img:
                    blanked += 1
                r["profile_image_url"] = ""
        out[f"degree{degree}"] = rows
        print(f"degree{degree}: {len(rows)} rows")
    out["counts"] = {"degree1": len(out["degree1"]), "degree2": len(out["degree2"])}
    dest = ROOT / "public" / "demo-data.json"
    dest.write_text(json.dumps(out))
    print(f"avatars kept: {kept} · expired CDN urls blanked: {blanked}")
    print(f"wrote {dest} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
