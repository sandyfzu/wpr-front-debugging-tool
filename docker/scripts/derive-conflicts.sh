#!/usr/bin/env bash
# Derive the free conflict-plugin install list from the committed Known-Conflicts DB.
#
# The preinstalled conflict set (docker/conflicts.txt) must mirror what the browser tool
# can actually match: on wp-admin pages the scan matches a DB row when the lowercased row
# NAME occurs in the page text, so a row yields a real match only when a free plugin whose
# WordPress.org display name contains the row name exists AND can be installed. This
# script encodes exactly that rule so the list stays derivable whenever the DB re-syncs.
#
# Filter (all three must hold for a DB row to contribute):
#   1. row type == "Plugin" (Theme / 3rd-Party rows never install),
#   2. the row's detection pattern normalizes to a slug
#      (trim, lowercase, whitespace -> '-', trailing '/' dropped, dir/file -> dir half),
#   3. the slug exists on WordPress.org, is not closed, and the plugin's display name
#      contains the row name case-insensitively (same containment the scan applies).
#
# Output: docker/conflicts.txt — one slug per line; the bootstrap installs each slug
# inactive (`wp plugin install <slug>` fetches .latest-stable.zip at install time).
#
# Usage: docker/scripts/derive-conflicts.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
db="$repo_root/lib/known-conflicts/known-conflicts-db.json"
out="$repo_root/docker/conflicts.txt"

python3 - "$db" "$out" <<'PYEOF'
import json, sys, time, urllib.request, urllib.error
import concurrent.futures

db_path, out_path = sys.argv[1], sys.argv[2]

# Candidate rows: name + normalized slug, in DB order (order survives to the list).
rows = []
for row in json.load(open(db_path)):
    if not isinstance(row, dict) or row.get("type") != "Plugin":
        continue
    raw = row.get("detection_pattern")
    if not isinstance(raw, str):
        continue  # rows without a pattern give nothing derivable to install
    normal = raw.strip().strip("/").replace(" ", "-").lower()
    slug = normal.split("/", 1)[0] if "/" in normal else normal
    if not slug or not all(c.isalnum() or c == "-" for c in slug) or not slug.isascii():
        continue  # URLs and prose markers are not installable identifiers
    rows.append((row.get("name", "").strip(), slug))

# One candidate = one exact check against the official plugin directory. WP.org applies
# per-IP rate limiting (429), and misses answer 404 with a JSON error body; both come back
# as HTTPError from urllib, so the body is read and the two cases never share a verdict.
def probe_once(slug: str):
    url = ("https://api.wordpress.org/plugins/info/1.2/?action=plugin_information"
           "&request[slug]=" + slug)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "wpr-front-debugging-tool-conflicts-derive"}), timeout=30) as res:
            status, body = res.status, res.read().decode()
    except urllib.error.HTTPError as err:
        status, body = err.code, err.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        return {"ok": None, "reason": f"probe_error:{err.__class__.__name__}"}
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return {"ok": None, "reason": f"probe_error:HTTP{status}NonJson"}
    # 1.2 returns the plugin object top-level; a bare {"error": ...} means absent or
    # closed — either way wp-cli cannot install it, recorded distinctly.
    if "error" in payload:
        text = str(payload["error"]).lower()
        reason = "closed_on_wporg" if "closed" in text else "slug_absent_on_wporg"
        return {"ok": False, "reason": reason}
    if "name" not in payload:
        return {"ok": False, "reason": "slug_absent_on_wporg"}
    return {"ok": True, "name": str(payload["name"]), "slug": str(payload["slug"])}

def probe(slug: str, attempts: int = 4):
    result = None
    for idx in range(attempts):
        if idx:
            time.sleep(idx * idx * 2)  # quadratic backoff: transient 429s/5xx only
        result = probe_once(slug)
        if result.get("ok") is not None:
            break
    return result

def probe_serial(slugs: list):
    # Fallback sweep for anything the parallel pass still left undecided: pace one
    # request per second, the shape all of WP.org's clients already sustain.
    out = {}
    for slug in slugs:
        out[slug] = probe(slug)
        time.sleep(1)
    return out

unique_slugs = sorted({slug for _, slug in rows})
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    results = list(pool.map(probe, unique_slugs))
probed = dict(zip(unique_slugs, results))

undecided = [slug for slug, result in probed.items() if result.get("ok") is None]
if undecided:
    probed.update(probe_serial(undecided))

chosen, dropped = [], []
for name, slug in rows:
    result = probed[slug]
    if result.get("ok") is not True:
        dropped.append((name, slug, result.get("reason")))
        continue
    # Containment mirrors the scan itself: the page text shows the plugin's display name,
    # a row only ever matches when the row name sits inside it.
    if result["name"].strip().lower().find(name.lower()) == -1:
        dropped.append((name, slug, "display_name_does_not_contain_row_name"))
        continue
    chosen.append({"slug": result["slug"], "row": name, "display": result["name"]})

# One slug can back several DB rows (a Pro row and its free twin): install it once.
unique, seen = [], set()
for entry in chosen:
    if entry["slug"] not in seen:
        seen.add(entry["slug"])
        unique.append(entry)

header = (
    "# Free conflict plugins this site preinstalls, derived from the committed\n"
    "# Known-Conflicts DB (lib/known-conflicts/known-conflicts-db.json) by\n"
    "# docker/scripts/derive-conflicts.sh. Re-run that script after every DB re-sync;\n"
    "# do not hand-edit. One wp.org slug per line, installed inactive at bootstrap.\n"
)
with open(out_path, "w") as out:
    out.write(header)
    for entry in unique:
        out.write(f"{entry['slug']}\n")

print(f"plugin rows in DB    : {len(rows)}")
print(f"rows passing filter  : {len(chosen)} (deduped: {len(unique)})")
print("provenance: " + ", ".join(e["slug"] for e in unique))
if dropped:
    print("dropped rows:")
    for name, slug, reason in dropped:
        print(f"  - {name} -> {slug}: {reason}")
PYEOF
