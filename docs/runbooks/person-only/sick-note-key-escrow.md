# Escrow the sick-note media key in the manager's password manager

**Why this is yours:** One 0600 file, `<dataDir>/keys/sick-note-media.json`, decrypts every doctor's-note attachment. Backups never copy it by design (`scripts/backup.mjs:95-103`, only a fingerprint at `:128-136`; enforced by `tests/js/test-backup.mjs:135-144`), the Keychain mirror is this-Mac-only (`LariatNative/Sources/LariatApp/UI/Support/SickNoteKeychain.swift:38`), and rotation is unsupported — lose the key, lose every document forever (`docs/PROTECTED_CONTRACTS.md:392`). The only off-machine copy is a manual one into a password manager (`docs/OPERATIONS.md:106`; spec `docs/superpowers/specs/2026-07-10-lariat-sick-note-lifecycle-design.md:243-245`). Only you hold that vault.
**Unblocks:** Recovery of sick-note documents onto a new Mac (the Keychain mirror does not follow the data — `docs/OPERATIONS.md:106`); a safe first attach in Lariat.app (attach loads this exact key — `LariatNative/Sources/LariatApp/UI/Support/SickNoteAttach.swift:64`); a restore drill that can prove the right key is present via `manifest.json` `sick_note_key_fingerprint` (`scripts/backup.mjs:152`).
**Where:** venue Mac (this laptop is the venue Mac — `docs/runbooks/person-only/go-live-serving-topology-and-data-root.md:5`) + your password manager.  **Time:** 5 min. No process to stop: the web hub never reads the key (grep 2026-09-02: nothing under `lib/` or `app/` references it; only `scripts/backup.mjs:130`).
**Status:** open — per `docs/OPERATIONS.md:106` ("one-time manual copy … into a password manager"); no escrow record exists anywhere (grep 2026-09-02 of `docs/`, `.agent-sessions/handoff.md`, `docs/PROJECT_STATUS.md`, `docs/OPERATIONS_HANDOFF.md`). Live 2026-09-02: key file present, `-rw-------`, 167 B, `key_id 3401ac56020e1f44a71bfe48a2a13a9a`, created 2026-08-31T07:47:36Z; Keychain mirror present in `login.keychain-db` (same account id, 07:53:07Z); `sick_note_documents` = 0 rows — nothing is encrypted under it yet, so this is the cheap moment.

## Before you start
- [ ] Data dir is the App Support one — check: `grep -n '^LARIAT_DATA_DIR=' .env.local` → `13:LARIAT_DATA_DIR=/Users/seanburdges/Library/Application Support/Lariat/data` (`lib/dataDir.ts:32-36`; Lariat.app honors the same var first, `LariatNative/Sources/LariatModel/StationCatalog.swift:144-146`)
- [ ] Key file exists with the right mode — check: `KEY="$HOME/Library/Application Support/Lariat/data/keys/sick-note-media.json"; stat -f '%Sp %z %Sm' "$KEY"` → `-rw------- 167 Aug 31 …` (`LariatNative/Sources/LariatDB/SickNoteKeyStore.swift:12-15,50`)
- [ ] It parses; you have its fingerprint — check (prints id + fingerprint, never the key; same math as `scripts/backup.mjs:130-136`):
  ```bash
  fp(){ node -e 'const c=require("crypto"),j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(j.key_id,c.createHash("sha256").update(Buffer.from(j.key,"base64")).digest("hex").slice(0,16))'; }
  fp < "$KEY"
  ```
  → `3401ac56020e1f44a71bfe48a2a13a9a 4ea44c6e36e55764` (measured 2026-09-02). Anything else, or an error: stop — the file is not the live key (`LariatNative/Sources/LariatModel/Crypto/SickNoteMediaKey.swift:31-35` would refuse it too).
- [ ] Keychain mirror present — check: `security find-generic-password -s com.lariat.sick-note-media-key | grep '"acct"'` → `"acct"<blob>="3401ac56020e1f44a71bfe48a2a13a9a"` (`SickNoteKeychain.swift:12,33`). **Never add `-w` or `-g`** — those print the key.
- [ ] Password manager unlocked on this Mac or your phone — no command; no doc names which one (grep 2026-09-02: none), use the vault that holds the venue's other secrets
- [ ] No screen share, recording, or clipboard-history app running; nobody behind you — the key is on the clipboard for about a minute

## Steps
1. **Open one terminal at the repo root and keep it for every step.** `cd ~/lariat_dev/Lariat` then paste the `KEY=` line and the `fp(){ … }` line from the checks above; `fp < "$KEY"` → expect: `3401ac56020e1f44a71bfe48a2a13a9a 4ea44c6e36e55764`. If not: redo the checks; do not continue.
2. **Create the vault item.** (password manager) New item → Secure Note, or Document/File if it supports attachments. Title: `Lariat sick-note media key — Seans-MacBook-Pro-3 (venue Mac)`. In the notes field type (all non-secret): `key_id 3401ac56020e1f44a71bfe48a2a13a9a · fingerprint 4ea44c6e36e55764 · created 2026-08-31 · path ~/Library/Application Support/Lariat/data/keys/sick-note-media.json · restore: put the file back at that path, chmod 600, BEFORE first Lariat.app launch on a new Mac (docs/OPERATIONS.md:106)`. → expect: item saved, secret still empty.
3. **Put the key file on the clipboard — never in chat, mail, Notes, or a screenshot.** `pbcopy < "$KEY"` → expect no output. If the manager takes file attachments, attach the file instead: in its file picker press ⌘⇧G and paste `~/Library/Application Support/Lariat/data/keys/sick-note-media.json` (the `keys` folder is 0700, `SickNoteKeyStore.swift:40`, so Finder only reaches it through that dialog), then go to step 5.
4. **Paste into the item's secret/password field and save.** (password manager) One line of JSON with four fields — `created_at`, `key`, `key_id`, `v` (`SickNoteMediaKey.swift:5`) — into the *hidden* field, not the notes. Save. → expect: the item shows a hidden secret.
5. **Prove the vault copy is byte-usable.** (password manager → terminal) Use the item's copy button on the secret, then `pbpaste | fp` → expect: exactly `3401ac56020e1f44a71bfe48a2a13a9a 4ea44c6e36e55764`. Attached as a file instead: download it to `$TMPDIR`, run `fp < "$TMPDIR/sick-note-media.json"`, then `rm "$TMPDIR/sick-note-media.json"`. If it differs or errors: the paste was truncated or re-quoted (smart quotes, or the trailing `=` padding of `key` dropped) — delete the secret, redo steps 3–4.
6. **Clear the clipboard.** `pbcopy < /dev/null; pbpaste | wc -c` → expect `0`. If a clipboard-history app was running after all, delete the entry there too.
7. **Confirm the key reached neither git nor a backup.** `git status --short | grep -i 'keys\|sick-note-media'; find backups -name 'sick-note-media.json' 2>/dev/null; echo clean` → expect only `clean` (2026-09-02: clean). Backups exclude `keys/` by construction (`scripts/backup.mjs:95-103`); `data/keys/` is **not** gitignored (`git check-ignore` exit 1, 2026-09-02), so the git line is a real check. If anything prints above `clean`: stop — see "If something goes wrong".
8. **Write the evidence block** (below) into this runbook — no key material, ever.

## Pass / fail
No plan defines a criterion beyond "copy `keys/sick-note-media.json` to a password manager once" (`docs/superpowers/specs/2026-07-10-lariat-sick-note-lifecycle-design.md:244`; `docs/OPERATIONS.md:106`). The fingerprint match is the same test a restore uses (`scripts/backup.mjs:130-136,152`).
**PASS** = all of: (a) a vault item holds the whole four-field JSON (or the file itself); (b) step 5 round-trip printed the identical `key_id` + fingerprint; (c) clipboard reads `0` bytes; (d) step 7 printed only `clean`.
**FAIL** = fingerprint mismatch or parse error on round trip, or the key ever landed in chat / mail / Notes / a screenshot / `git status` / a backup — treat that as leaked (below).

## Record the result
- Evidence: no template exists (`docs/superpowers/templates/` holds only `service-day-shutoff-log.md`). Append to the bottom of this runbook:
  ```
  ## Evidence YYYY-MM-DD
  - Vault: <manager name>, item "<title>" — secure note | file attachment
  - key_id 3401ac56020e1f44a71bfe48a2a13a9a · fingerprint 4ea44c6e36e55764 · round-trip match: yes/no
  - Clipboard cleared: yes · git + backups clean: yes
  ```
  Never paste the JSON, the `key` value, or the vault password.
- Then update: this runbook's **Status** line → `done YYYY-MM-DD`; `docs/runbooks/person-only/README.md` — add after line 14: `| [sick-note-key-escrow](sick-note-key-escrow.md) | Escrow the sick-note media key in the password manager | DONE YYYY-MM-DD |`; `docs/PROJECT_STATUS.md` — no row tracks this (grep 2026-09-02: none) — add under "Where the project is" (header `:27`, table `:29`): `| Sick-note PHI key escrow (P0-6, off-machine copy) | native | shipped | this runbook, evidence YYYY-MM-DD; key never in backups — tests/js/test-backup.mjs:135-144 | HIGH |` and refresh the as-of line `:10` (rule `:132-134`); `docs/OPERATIONS_HANDOFF.md` — no item exists — append `## 7. Sick-note media key escrow — DONE YYYY-MM-DD` after line 78 with vault item name, `key_id`, fingerprint (no key), and bump "Last updated" at `:3`; `docs/OPERATIONS.md:106` — after "second escrow point" add `(done YYYY-MM-DD — runbook sick-note-key-escrow)`.

## Close out
```bash
scripts/worktree.sh new sean chore/sick-note-key-escrow
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main.
Commit only this runbook, `README.md`, `docs/PROJECT_STATUS.md`, `docs/OPERATIONS_HANDOFF.md`, `docs/OPERATIONS.md` — the main checkout is shared and dirty (`CLAUDE.md`, `package.json`, `scripts/verify.sh`, … belong to another session); never `git add -A`. `docs/runbooks/person-only/` was still untracked on 2026-09-02 (today's go-live session owns `README.md` and the three `go-live-*` files) — if the README row conflicts on rebase, keep theirs and re-add yours. `/ship` calls `bash scripts/verify.sh` (`.claude/skills/ship/SKILL.md:6`); if the worktree lacks it, `npm run verify` (`package.json:39`).

## If something goes wrong
- **Round-trip mismatch:** the vault copy is wrong, nothing on disk changed. Delete the item's secret, redo steps 3–5.
- **Key leaked (pasted into chat / mail / Notes / screenshot, or found in git or a backup):** no rotation exists (`docs/PROTECTED_CONTRACTS.md:392`). While `sick_note_documents` is still 0 rows (`sqlite3 -readonly "$HOME/Library/Application Support/Lariat/data/lariat.db" "SELECT COUNT(*) FROM sick_note_documents"`) you can re-key: quit Lariat.app (`pgrep -lx Lariat` empty), `mv "$KEY" "$KEY.leaked-YYYYMMDD"`, `security delete-generic-password -s com.lariat.sick-note-media-key` (approve the Keychain prompt if one appears — otherwise the next launch heals the *old* key back from the mirror, `SickNoteKeychain.swift:48-53`), then `open LariatNative/build/Lariat.app` once → launch generates and mirrors a fresh key (`LariatNative/Sources/LariatApp/UI/Shell/LariatApp.swift:31-33,47`; `SickNoteKeyStore.swift:17-27`). Redo this runbook from the checks, then `rm "$KEY.leaked-YYYYMMDD"`. **Never re-key once a document exists** — every existing file would be unreadable (`docs/PROTECTED_CONTRACTS.md:391`).
- **Key file missing or corrupt on this Mac later:** launch Lariat.app — it heals the file from the Keychain mirror (`SickNoteKeychain.swift:48-53`, `LariatApp.swift:31`). If the mirror is gone too: put the vault copy back at `$KEY`, `chmod 600 "$KEY"`, then launch (`docs/OPERATIONS.md:106`).
- **New Mac / restore from backup:** the backup's `manifest.json` `sick_note_key_fingerprint` (`scripts/backup.mjs:152`) must equal the vault item's fingerprint. Place the key file under `<dataDir>/keys/` **before** the first Lariat.app launch there — otherwise launch makes a new key (`LariatApp.swift:33`) and every restored document fails to open.
- **`git status` ever lists `data/keys/…`:** do not add or commit. A key under `<repo>/data/` means Lariat.app was launched from inside the repo (marker walk, `StationCatalog.swift:147-155`) — see `go-live-serving-topology-and-data-root.md` step 5. Move it aside; it is a stray key, not the live one.
- **Who to tell:** nobody — owner-only. Record the outcome in this runbook's Status line.
