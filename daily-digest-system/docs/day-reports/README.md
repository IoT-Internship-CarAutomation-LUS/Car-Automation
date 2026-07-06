# Daily Reports

Every working day gets one file here: `YYYY-MM-DD.md`. Together these are the day-by-day record of the project — what changed, what worked, what didn't, and what the output was.

## How it works

Each report has two parts:

1. **Automated Activity Log** — generated straight from git. Lists every commit made that day, grouped by folder/track, with who made it and when. This part is never typed by hand and can't be forgotten, skipped, or written inaccurately — it's pulled directly from the repo's history.

2. **Team Notes + Day Summary** — written by hand. Git can tell you *what* changed, but not *what worked*, *what didn't*, or *what the actual output was* (a screenshot, a test result, a demo). That needs a person. Each teammate who did meaningful work that day adds a short block using the template; the team lead adds a short overall summary at the end of the day.

## How the automated part gets generated

A GitHub Action (`.github/workflows/daily-digest.yml`) runs the script `scripts/generate_daily_digest.py`, which:
- Reads that day's git commits, grouped by top-level folder (which maps to each person's track).
- Creates `docs/day-reports/<today>.md` from the template if it doesn't exist yet, or refreshes just the automated section if it does.
- Never touches anything below the automated section — manual notes are always safe.

It runs automatically:
- Every evening (scheduled).
- Whenever a Pull Request is merged into `main`.
- On demand — Actions tab → **Daily Activity Digest** → **Run workflow**. Use this right before an end-of-day check-in so the log is fresh when you sit down to add notes.

## What the team does each day

1. Do your work, commit, push, open your PR as usual (see `CONTRIBUTING.md`).
2. Near end of day, open `docs/day-reports/<today>.md` (it should already exist and have today's commits listed — if not, trigger the workflow manually).
3. Add your block under **Team Notes** — what you did, what worked, what didn't, the output, and what's next. A few lines is enough.
4. The team lead reviews and adds the **Day Summary** at the bottom.

This file is then the permanent record for that day — the same thing a proper "daily report" document would contain, except it's always accurate because half of it is generated from the actual commits, not remembered after the fact.

## One-time setup (team lead)

For the bot to be able to commit the digest back to the repo:
- Repo **Settings → Actions → General → Workflow permissions** → set to **"Read and write permissions"**.

Without this, the workflow will run but fail on the final push step.
