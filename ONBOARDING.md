# Getting Started — Team Onboarding

How to set up your laptop, get the project, do your work, and push it back. Follow this once; after that it's just steps 5–8 each time you work.

If you get stuck on any step, message the team lead — don't stay blocked.

---

## 1. Install Git (one time)

- **Windows:** download from https://git-scm.com/download/win and install (accept the defaults).
- **Mac:** open Terminal and run `git --version` — if it's not installed it will prompt you to install it.

Check it worked:
```
git --version
```

## 2. Tell Git who you are (one time)

Use the **same email as your GitHub account**:
```
git config --global user.name "Your Name"
git config --global user.email "your-github-email@example.com"
```

## 3. Accept the repo invite (one time)

Check your email (or https://github.com/notifications) for the invite to the **IoT-Internship-CarAutomation-LUS** organization and accept it. You need **Write** access — if you can't push later, tell the lead to check your access.

## 4. Get a Personal Access Token — this is your "password" for pushing (one time)

GitHub no longer accepts your account password when you push. Instead you use a token:

1. Go to https://github.com/settings/tokens
2. **Generate new token → Generate new token (classic)**
3. Note: `car-automation`, Expiration: 90 days
4. Tick the **`repo`** checkbox (this covers push/pull)
5. **Generate token** and **copy it now** — you won't see it again. Save it somewhere safe (a note on your laptop is fine).

When you push later and Git asks for a **password**, paste this **token** instead. (Your username is your GitHub username.) Git will remember it after the first time.

## 5. Clone the repo (one time)

Pick a folder (e.g. Desktop), then:
```
git clone https://github.com/IoT-Internship-CarAutomation-LUS/Car-Automation.git
cd Car-Automation
```
Your work goes in **your folder** (see the README table): e.g. `dashboard-control/`, `backend/`, `sensing/`, `hardware/`.

---

## 6. Before you start working — get the latest

Always pull first so you have everyone's newest changes:
```
git checkout main
git pull
```

## 7. Make a branch and do your work

Never work directly on `main`. Make a branch named `yourname/what-you-are-doing`:
```
git checkout -b yourname/short-description
```
Examples: `sathish/estop-button`, `shaahir/cloud-api`, `pavan/tpms-decoder`

Now edit/add your files in your folder.

## 8. Save and push your work

```
git add .
git commit -m "short description of what you did"
git push -u origin yourname/short-description
```
First push will ask for username + password → paste your **token** as the password.

## 9. Open a Pull Request

1. Go to the repo on GitHub — it will show a **"Compare & pull request"** button for your branch. Click it.
2. Write one or two lines on what you did.
3. Create the pull request.
4. The **team lead reviews and merges** it into `main`.

That's it. Next time you work, start again from **step 6**.

---

## Common problems

- **"Authentication failed" when pushing** → you typed your GitHub password instead of your token. Use the token from step 4.
- **"Permission denied" / can't push** → you don't have Write access yet. Tell the lead.
- **"Your branch is behind"** → run `git pull` first, then push.
- **Merge conflict** → don't panic, message the lead; usually it's because two people edited the same file. Working in your own folder avoids most of these.

## Golden rules

- Work in **your own folder**.
- Always `git pull` before you start.
- Branch → commit → push → pull request. Never push straight to `main`.
- **Never commit passwords, tokens, or API keys.** If code needs secrets, use a `.env` file (it's git-ignored) and share values privately.
