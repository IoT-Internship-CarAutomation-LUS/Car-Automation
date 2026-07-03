# How We Work

Short ground rules so the repo stays clean and the lead can see what's happening. Nothing heavy — just enough to keep six people from stepping on each other.

## 1. Work in your own folder

Each track has a folder (see the README table). Do your work there. Don't edit another person's folder without telling them.

## 2. Use branches, not direct pushes to `main`

- Never commit straight to `main`.
- Make a branch for what you're working on: `git checkout -b your-name/what-youre-doing`
  - e.g. `sathish/estop-button`, `shaahir/cloud-api`, `pavan/tpms-decoder`
- Push your branch and open a **Pull Request** into `main`.

## 3. Pull requests

- Open a PR when your change is ready for review.
- Write one or two lines saying what it does.
- The **team lead reviews and merges**. This is how we keep quality up and everyone sees what's changing.
- Keep PRs small where you can — easier to review, faster to merge.

## 4. Commit messages

Keep them short and clear:
- `dashboard-control: add emergency-stop latch`
- `firmware: fix CAN crystal to 8MHz`
- `docs: update parts list phase 1`

## 5. Don't commit junk

The `.gitignore` already skips the usual stuff (node_modules, build files, secrets). **Never commit passwords, API keys, or cloud credentials** — if the backend needs keys, use a `.env` file (which is git-ignored) and share the values privately.

## 6. The message schema is the contract

Anything that sends or receives data must match [`docs/MESSAGE_SCHEMA.md`](docs/MESSAGE_SCHEMA.md). If you need a new field, raise it with the lead and it gets added to the schema **first**, then everyone builds to it. Don't invent your own format.

## 7. Keep the status board honest

When your track's status changes (e.g. from research to working), tell the lead so the README status board stays accurate. That board is what leadership looks at.

---

Questions or blocked on something? Message the lead — don't sit blocked quietly.
