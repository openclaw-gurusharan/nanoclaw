# Access & Credentials Tracker
**Last Updated:** 2026-04-11
**Purpose:** Blocker log only. Andy writes here when hitting an access issue he cannot resolve autonomously. A background job monitors this file and resolves blockers. Andy does NOT review this file proactively every session.

---

## ✅ Granted / Working

| Access | How | Status |
|---|---|---|
| GitHub (openclaw-gurusharan) | OneCLI andy-bot proxy | ✅ Full read/write/fork via `gh` CLI |
| GitHub (ingpoc) | Public API | ✅ Read-only public repos |
| Web browsing | agent-browser skill | ✅ Active |

---

## 🔴 Blockers — Action Required

| Blocker | Owner | What's Needed | Why |
|---|---|---|---|
| **`workflow` CLI not in PATH** | Gurusharan | Binary mounted but not resolving in container `$PATH` — needs symlinking to `/usr/local/bin/workflow` or PATH updated in container config | Can't use workflow docs/summary commands |
| **ingpoc 2FA** | Gurusharan | Authenticator app OTP at login time | Log into Colosseum to manage AadhaarDeFi hackathon submission |
| **AgentMail API key** | Gurusharan | Sign up at [console.agentmail.to](https://console.agentmail.to) (free, 30 sec) | Andy needs own email inbox for autonomous platform signups |

---

## 📋 Pending — Once Blockers Resolved

| Item | Depends On |
|---|---|
| Colosseum dashboard login | ingpoc 2FA |
| X / Twitter account creation | AgentMail inbox |
| Upwork account management | AgentMail inbox |
| YouTube channel setup | AgentMail inbox |
| workflow CLI usage | workflow PATH fix |

---

## 🔐 Security Notes
- Never store raw tokens/passwords in this file
- GitHub credentials → OneCLI andy-bot proxy only
- If GitHub 401/403 → check andy-bot secret assignment in OneCLI dashboard
