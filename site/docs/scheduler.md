# Scheduler

The scheduler station, the job and the inbox feed file.

(Agent Office v2.0.0, 2026-11-17)

Agent Office 1.2.8 has a Scheduler station in the office: a garage and a mail bench with a mailbox, east of the playroom. Clicking either opens one read-only panel. The panel shows what the scheduler job last wrote. Neither the panel nor the job has any mail access built in.

## Pieces

| Piece | File | What it does |
|---|---|---|
| Status file | `~/.claude/agent-office/scheduler.json` | Written by the job. Keys: `lastCheck`, `itemsFound`, `lastUpdateToTiro`, `nextCheck`, `note`, `items[{title, kind, at}]`. |
| Reader | `scheduler.mjs` (`readScheduler`) | Reads and sanitises the status file for the panel. Missing or unreadable file means "no data yet". Marks it stale after 6 hours. Shows at most 20 items. |
| API | `POST /api/scheduler` (key required) | Returns what `readScheduler` found. Read-only. |
| Job | `scheduler-job.mjs` | Reads the feed file, classifies subjects, writes the status file and a note for Tiro. |
| Feed | `~/.claude/agent-office/inbox-feed.json` | Input to the job. You must provide a reader that produces it (see below). |

## What the job does

Run `node scheduler-job.mjs`. One run does one check:

1. Outside business hours (Monday to Friday, 07:00 to 19:00 local) it does nothing and reports the next check time. `--force` overrides this.
2. It reads the feed file. It ignores the feed if it is missing, unreadable, has no valid `generatedAt`, is older than 2 hours, or names a different mailbox from the configured one. The status file then says why.
3. Unread messages only. Each subject is cleaned (secrets redacted, cut to 140 characters) and classified as `task`, `need` or `info`. Automated noise such as daily or weekly reports and newsletters is dropped. Outlook categories in the feed count as a hint.
4. It writes `scheduler.json` (`itemsFound` counts tasks plus needs).
5. It updates Tiro's status, not Tiro's memory: subjects stay in `scheduler.json`, marked `untrusted: true`, and are never written into Tiro's memory folder or `MEMORY.md`. Tiro reads them only through the `scheduler_inbox` tool, which wraps them in an `UNTRUSTED_EMAIL_SUBJECTS` fence and says they are data, not instructions. `lastUpdateToTiro` records when the status was last written. Mails already announced are not repeated; a small dedupe file, `scheduler-seen.json`, sits next to the status file.

It sends nothing to anyone, and it never replies to, moves, flags or deletes mail. It opens no network connection, calls no Graph or IMAP service and holds no credentials. A test checks that the job source contains no network or mail-write code.

`nextCheck` is 30 minutes after the check, moved to the next business-hours slot if needed. The job does not loop. To check every 30 minutes you run it from a scheduler (for example a Windows scheduled task). Registering one is your decision; the app does not do it.

### Options

`--dry-run` prints what it would write and changes nothing. Other options: `--force`, `--feed <file>`, `--home <dir>` (state folder) and `--now <ISO time>` (for testing).

### Which mailbox

The job reports on exactly one mailbox, which you name. It is never hardcoded. Set the `AGENT_OFFICE_MAILBOX` environment variable, or `schedulerMailbox` in `~/.claude/agent-office/kiro.json`. If neither is set, the job refuses to report and says so. The feed's `mailbox` field must match it.

## The feed file

Agent Office does not read mail. Something else, that you have approved and that has read-only access, must write `inbox-feed.json`:

```json
{
  "mailbox": "you@example.com",
  "generatedAt": "2026-11-03T09:00:00Z",
  "messages": [
    { "subject": "Printer is not working", "received": "2026-11-03T08:41:00Z", "isRead": false, "categories": ["Need"] }
  ]
}
```

Only `subject`, `received`, `isRead` and `categories` are used. Do not include bodies or addresses. Until such a reader exists, the station honestly shows "No mail feed file yet".

## Try it

```
node scheduler-job.mjs --dry-run --force --home <empty temp folder>
```

With no feed this prints a status with 0 items and the "No mail feed file yet" note, and writes nothing.

