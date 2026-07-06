#!/usr/bin/env python3
"""
Generate/update the daily activity digest for docs/day-reports/YYYY-MM-DD.md

Pulls the day's commits straight from git (objective record: who changed what,
where, when) and writes them into an auto-generated section of that day's
report. A manual template below it is left for the team to fill in the
narrative (what worked, what didn't, output, next steps) -- git can't know
that part, only a person can.

Usage:
    python3 scripts/generate_daily_digest.py [--date YYYY-MM-DD] [--tz Asia/Kolkata]

Safe to run multiple times a day -- it only ever replaces the content between
the AUTO:START / AUTO:END markers and leaves everything else in the file
(the team's manual notes) untouched.
"""
import argparse
import json
import os
import subprocess
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None

AUTO_START = "<!-- AUTO:START -->"
AUTO_END = "<!-- AUTO:END -->"

REPO_ROOT = subprocess.run(
    "git rev-parse --show-toplevel", shell=True, capture_output=True, text=True
).stdout.strip() or "."
TEMPLATE_PATH = os.path.join(REPO_ROOT, "docs/day-reports/DAILY_TEMPLATE.md")
OUT_DIR = os.path.join(REPO_ROOT, "docs/day-reports")


def run(cmd, check=False):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise RuntimeError(f"Command failed ({result.returncode}): {cmd}\n{result.stderr}")
    return result.stdout.strip()


def get_day_bounds(date_str, tz_name):
    """Return (start, end) as timezone-aware datetimes for the given date in
    the team's timezone (default IST). Used to filter commits in Python --
    see get_commits_for_day() for why we don't let git itself do this filtering.
    """
    day = datetime.strptime(date_str, "%Y-%m-%d")
    if ZoneInfo:
        tz = ZoneInfo(tz_name)
        start = day.replace(tzinfo=tz)
    else:
        start = day
    end = start + timedelta(days=1)
    return start, end


def get_all_commits():
    """Pull the FULL commit log (on the currently checked-out branch, which
    the workflow pins to `main`) with an unambiguous ISO-8601 date that
    includes the original UTC offset. We deliberately do not ask git itself
    to filter by date here.

    Why: `git log --since=X --until=Y` assumes commit dates increase
    monotonically as it walks back from HEAD, and silently STOPS scanning
    the moment it meets a commit that looks "too old" for the range. Real
    history isn't always monotonic -- a slightly-wrong laptop clock, an
    amended commit, or someone pushing work made offline can all produce a
    commit whose author-date is earlier than its parent's. When that
    happens, git's pruning can silently drop commits from the result with
    no warning. Since the whole point of this tool is to never quietly miss
    someone's work, we pull everything and filter it ourselves in Python,
    which has no such assumption.
    """
    fmt = "%H|%an|%cd|%s"
    # %an = author name (who wrote it -- kept for attribution)
    # %cd = COMMITTER date, not author date. Author date is set once when a
    # commit is first written and does not change on rebase/amend; committer
    # date updates to reflect when the commit actually became part of
    # history. Since "Rebase and merge" is an allowed merge method on this
    # repo, a rebase-merged commit can carry an author date from days before
    # it actually landed on main. Bucketing by author date would silently
    # file such a commit under a day whose report may already be finalized,
    # and nothing ever automatically revisits it -- it would vanish from
    # every daily report. Committer date reflects when it actually landed.
    cmd = f'git log --date=iso-strict --pretty=format:"{fmt}" --no-merges'
    # check=True: if this fails, we want the workflow to go red and be
    # visibly investigated -- not silently report "0 commits" for the day,
    # which could go unnoticed for the whole team.
    out = run(cmd, check=True)
    commits = []
    if out:
        for line in out.split("\n"):
            parts = line.split("|", 3)
            if len(parts) == 4:
                commits.append({"hash": parts[0], "author": parts[1], "date_iso": parts[2], "subject": parts[3]})
    return commits


def filter_commits_for_day(all_commits, day_start, day_end, tz_name):
    tz = ZoneInfo(tz_name) if ZoneInfo else None
    result = []
    for c in all_commits:
        try:
            commit_dt = datetime.fromisoformat(c["date_iso"])
        except ValueError:
            continue
        local_dt = commit_dt.astimezone(tz) if tz else commit_dt
        if day_start <= local_dt < day_end:
            entry = dict(c)
            entry["time"] = local_dt.strftime("%H:%M")
            result.append(entry)
    # chronological order within the day
    result.sort(key=lambda c: c["time"])
    return result


def get_files_for_commit(h):
    result = subprocess.run(
        f"git show --name-only --pretty=format: {h}", shell=True, capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"WARNING: could not list files for commit {h}: {result.stderr.strip()}", flush=True)
        return []
    return [f for f in result.stdout.strip().split("\n") if f.strip()]


def top_folder(path):
    parts = path.split("/")
    return parts[0] if len(parts) > 1 else "(root)"


def build_auto_section(date_str, commits):
    if not commits:
        return "No commits recorded for this date.\n"

    by_folder = {}
    for c in commits:
        files = get_files_for_commit(c["hash"])
        folders = sorted(set(top_folder(f) for f in files)) or ["(root)"]
        for folder in folders:
            by_folder.setdefault(folder, [])
            if c not in by_folder[folder]:
                by_folder[folder].append(c)

    lines = [f"**{len(commits)} commit(s) on {date_str}**", ""]
    for folder in sorted(by_folder):
        lines.append(f"### `{folder}/`")
        for c in sorted(by_folder[folder], key=lambda x: x["time"]):
            lines.append(f"- `{c['time']}` **{c['author']}** \u2014 {c['subject']} (`{c['hash'][:7]}`)")
        lines.append("")

    # Best-effort: merged PRs for the day, via GitHub CLI if available/authenticated.
    pr_out = run(f'gh pr list --state merged --search "merged:{date_str}" --json number,title,author 2>/dev/null')
    if pr_out and pr_out not in ("[]", ""):
        try:
            prs = json.loads(pr_out)
            if prs:
                lines.append("### Pull requests merged")
                for pr in prs:
                    author = pr.get("author", {}).get("login", "unknown")
                    lines.append(f"- #{pr['number']} {pr['title']} \u2014 @{author}")
                lines.append("")
        except (json.JSONDecodeError, KeyError):
            pass

    return "\n".join(lines)


def load_template(date_str):
    if os.path.exists(TEMPLATE_PATH):
        with open(TEMPLATE_PATH, encoding="utf-8") as f:
            template = f.read()
    else:
        template = (
            f"# Day Report \u2014 {{DATE}}\n\n"
            f"## Automated Activity Log\n{AUTO_START}\n{AUTO_END}\n\n"
            f"## Team Notes (fill in manually)\n\n"
            f"## Day Summary\n"
        )
    return template.replace("{DATE}", date_str)


def apply_auto_section(content, auto_section):
    if AUTO_START in content and AUTO_END in content:
        pre = content.split(AUTO_START)[0]
        post = content.split(AUTO_END)[1]
        return f"{pre}{AUTO_START}\n{auto_section}\n{AUTO_END}{post}"
    # Markers missing for some reason -- append rather than silently dropping data.
    return content + f"\n\n{AUTO_START}\n{auto_section}\n{AUTO_END}\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None, help="YYYY-MM-DD, defaults to today")
    ap.add_argument("--tz", default="Asia/Kolkata")
    args = ap.parse_args()

    if args.date:
        date_str = args.date
    elif ZoneInfo:
        date_str = datetime.now(ZoneInfo(args.tz)).strftime("%Y-%m-%d")
    else:
        date_str = datetime.now().strftime("%Y-%m-%d")

    start, end = get_day_bounds(date_str, args.tz)
    all_commits = get_all_commits()
    commits = filter_commits_for_day(all_commits, start, end, args.tz)
    auto_section = build_auto_section(date_str, commits)

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"{date_str}.md")

    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            content = f.read()
    else:
        content = load_template(date_str)

    content = apply_auto_section(content, auto_section)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"Updated {out_path}")
    print(f"  {len(commits)} commit(s) found for {date_str}")


if __name__ == "__main__":
    main()
