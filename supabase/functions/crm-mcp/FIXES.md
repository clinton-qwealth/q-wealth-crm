# crm-mcp v0.1.1 — caller identity, note ordering, configurable base URL

Deployed to `Q_CRM` (`znaspvufcxutxuvxubyx`) as edge function version **2**.
`verify_jwt` remains `false` — the function performs its own bearer validation and
must serve the unauthenticated RFC 9728 discovery endpoint.

| # | Change | Severity | Symptom before |
|---|--------|----------|----------------|
| 1 | `getStaff()` now filters on `auth_user_id` | High | `add_note` failed for all but one staff member; `whoami` reported the wrong person |
| 2 | `get_notes` orders and limits in Postgres | Medium | "Newest first" returned an arbitrary slice |
| 3 | `APP_BASE` reads `APP_BASE_URL` | Low | Deep links hardcoded to production |

---

## Fix 1 — `getStaff()` returned an arbitrary staff member

### What was wrong

```ts
// before
const { data } = await db.from('staff_users')
  .select('id, full_name, email, status, access_profiles(...)')
  .limit(1).maybeSingle()        // no filter on the caller
```

The query had no predicate identifying the caller. The governing RLS policy is:

```sql
staff_read_staff_users  SELECT  authenticated  USING (is_active_staff())
```

`is_active_staff()` is true for *any* active staff member and does not scope rows, so
every caller can read all three `staff_users` rows. With `LIMIT 1` and no `ORDER BY`,
Postgres returns whichever row it likes — in this database, `Test Adviser`.

### Why it mattered

RLS still scoped all *data* access correctly, because every policy calls
`current_staff_id()` / `auth.uid()` directly rather than trusting this object. The damage
was confined to what the function did with the wrong `staff` record:

- **`whoami` misreported identity and permissions.** Claude was told it was Test Adviser
  with the Adviser profile regardless of who was actually asking, so it reasoned about
  the wrong permission set.
- **`add_note` was broken for most staff.** It passes `author_staff_id: staff.id`, and
  `notes_insert` enforces:

  ```sql
  WITH CHECK (is_active_staff()
              AND source = 'manual'
              AND author_staff_id = current_staff_id())
  ```

  Since `staff.id` was Test Adviser's while `current_staff_id()` was the real caller's,
  the insert violated the policy and failed.

The append-only audit design is what contained this: RLS refused the misattributed write
rather than silently recording a note under the wrong author's name. The bug was a
denial of service, not a corrupted audit trail.

### The fix

```ts
async function getStaff(db: SupabaseClient, authUserId: string): Promise<Staff | null> {
  const { data, error } = await db.from('staff_users')
    .select('id, full_name, email, status, access_profiles(...)')
    .eq('auth_user_id', authUserId)   // <- resolve the actual caller
    .maybeSingle()
  ...
}
```

Called as `getStaff(db, userData.user.id)`, using the id already returned by
`db.auth.getUser(token)`. `staff_users.auth_user_id` is `UNIQUE`, so `maybeSingle()` is
now exact and `.limit(1)` is no longer needed.

### Proof

Simulated as Test Management (`77a6f171…`), who is *not* the row the old code returned:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"77a6f171-...","role":"authenticated"}';
select (select full_name from staff_users limit 1) as old_code,
       (select full_name from staff_users
         where auth_user_id = (select auth.uid())) as new_code,
       (select id from staff_users limit 1) = current_staff_id() as old_id_ok;
rollback;
```

| old_code | new_code | old_id_ok |
|---|---|---|
| Test Adviser | Test Management | false |

`old_id_ok = false` is precisely why `notes_insert` rejected the write. Attempting both
inserts inside a rolled-back transaction:

| Insert | Result |
|---|---|
| `author_staff_id` = Test Adviser (old behaviour) | **REJECTED** — new row violates row-level security policy for table "notes" |
| `author_staff_id` = Test Management (real caller) | **SUCCEEDED** |

Probe transaction was rolled back; `notes` remains at 2 rows with 0 probe rows.

### Not changed

`staff_read_staff_users` remains unscoped, so any active staff member can still read the
full staff list. That is reasonable for a staff directory and the UI will likely want it.
Worth a deliberate decision rather than an accident — tighten it if the directory should
be permission-gated.

---

## Fix 2 — `get_notes` limited before sorting

### What was wrong

```ts
// before
let q = db.from('note_subjects').select('notes(id, ..., occurred_at, ...)')
q = party_id ? q.eq('party_id', party_id) : q.eq('group_id', group_id!)
const { data } = await q.limit(limit)
const notes = (data ?? []).map(r => r.notes).filter(Boolean)
  .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))   // sorts only what came back
```

`LIMIT` applied to unordered `note_subjects` rows; the sort then ran in JavaScript over
that arbitrary subset. The tool description promises "newest first", so on any client
with more than `limit` notes Claude could silently miss the most recent file note —
a real risk when the notes are advice records.

### The fix

Query `notes` as the base table so Postgres does the ordering and limiting, using an
`!inner` embed to carry the subject restriction:

```ts
let q = db.from('notes')
  .select('id, note_type, title, body, occurred_at, source, match_status, note_subjects!inner(party_id, group_id)')
q = party_id ? q.eq('note_subjects.party_id', party_id)
             : q.eq('note_subjects.group_id', group_id!)
const { data, error } = await q.order('occurred_at', { ascending: false }).limit(limit)
```

A note can carry several subjects, so the join column is stripped and rows de-duplicated
by id before returning. `search_notes` gained the same explicit
`.order('occurred_at', { ascending: false })`, which it was also missing.

RLS is unaffected — `notes_select USING (staff_can_access_note(id))` applies to the base
table either way.

### Proof

Each new query shape was issued against PostgREST with the publishable key before
deploying. All returned `200` with `[]` (correct: `anon` has no policy granting rows), and
a deliberately malformed embed returned `400 PGRST200`, confirming that a syntax error
would have surfaced rather than passing silently.

---

## Fix 3 — `APP_BASE` is now configurable

```ts
// before
const APP_BASE = 'https://crm.qwealth.com.au' // deep-link base (config)

// after
const APP_BASE = (Deno.env.get('APP_BASE_URL') ?? 'https://crm.qwealth.com.au')
  .replace(/\/+$/, '')
```

Trailing slashes are trimmed so `groupLink()` / `clientLink()` can't emit `//groups/…`.
The fallback preserves current behaviour, so deploying this change alone is safe.

### Action required

Set the `APP_BASE_URL` secret per environment (Supabase Dashboard → Edge Functions →
Secrets, or `supabase secrets set`). Until it is set, links point at production.

---

## Post-deploy verification

| Check | Result |
|---|---|
| `GET /health` | `200 {"ok":true,"service":"q-wealth-crm-mcp"}` — module booted clean |
| `GET /.well-known/oauth-protected-resource` | `200`, authorization server = `…/auth/v1` |
| `POST /` no bearer | `401` + `WWW-Authenticate` pointing at resource metadata |
| `POST /` malformed bearer | `401 Invalid or expired token` |
| `POST /` anon key as bearer | `401` — rejected at `getUser`, never reaches the staff gate |

End-to-end confirmation with a real staff JWT still needs a browser sign-in as one of the
test users; the RLS simulation above covers the logic the fix changed.

## Still outstanding

- `add_note` is two non-atomic inserts. On subject-insert failure the note survives and
  stays visible to its author via `staff_can_access_note`, and the author can retry
  filing — it degrades honestly, but a single RPC would remove the window.
- `note_attachments` has only a SELECT policy, so recordings cannot be attached yet.
- `staff_can_access_note` runs per row inside `search_notes`; revisit when notes reach
  real volume.

---

# crm-mcp v0.1.2 — rejection logging and note filing

Deployed as edge function version **3** on 29 August 2026.

| # | Change | Driver |
|---|--------|--------|
| 1 | All auth rejections logged in a structured shape | Readiness checklist item 6 |
| 2 | New `file_note_to_client` tool | The unmatched-notes workflow was half-built |

## 1. Auth rejections are now logged

`unauthorized()` returned a 401 with no log line. Only the "authenticated but not
active staff" path called `console.warn`. Checklist item 6 requires hostile-path tokens
be *rejected and logged* — the rejecting worked, the logging did not, so every missing,
malformed, expired or forged token failed silently.

All rejections now emit one structured line:

```json
{"event":"mcp_auth_rejected","reason":"Invalid or expired token","token_length":208,
 "upstream":"invalid claim: missing sub claim"}
```

Token contents are never logged — only whether a header was present, the token's length,
and the reason Supabase Auth gave. `event: mcp_auth_rejected` is the grep handle.

### Verified

Six hostile paths, all rejected with 401 and all logged:

| Case | Upstream reason recorded |
|---|---|
| No bearer header | `header_present: false` |
| Malformed token | `token is malformed: could not JSON decode header` |
| Expired `exp` | `token signature is invalid` |
| Wrong audience | `token signature is invalid` |
| Wrong issuer | `token signature is invalid` |
| Publishable anon JWT | `invalid claim: missing sub claim` |

**Caveat worth keeping.** The expired, wrong-audience and wrong-issuer tokens were signed
with a dummy key, so Supabase rejected them on signature before evaluating `exp` or `aud`.
Those three prove *rejection and logging*, not expiry or audience validation specifically.
The anon-JWT row is the one that exercises the real path: correctly signed, so it passed
signature verification and failed on claims. A correctly-signed-but-expired token still
needs either the project JWT secret or a genuinely expired session to test.

## 2. `file_note_to_client`

`list_unmatched_notes` showed integration notes awaiting filing, but nothing could file
one — the `notes_update_filing` policy existed and no tool used it. Claude could show a
Services user the queue and then not act on it.

The tool attaches the note to clients and/or a group, then marks it matched.

**Ordering matters and is deliberate.** Subjects are inserted *before* the status flip:

```ts
// While the note is unmatched the caller's access comes from being the meeting
// host or holding file_unmatched_notes; once it is matched, access is derived
// from the subjects. Flipping the status first would drop the caller's own
// access before the subjects existed.
```

Filing is the only permitted change to a note; the append-only trigger still rejects any
edit to content.

### Verified

Simulated as Test Services (holds `file_unmatched_notes`) against an integration note:

| Step | Result |
|---|---|
| Note visible in unmatched queue | 1 row |
| Insert subject while unmatched | SUCCEEDED |
| Flip `match_status` to matched | SUCCEEDED |
| Note still visible after filing | 1 row |
| Edit note body | BLOCKED — only match_status may change |
| Audit trail | `insert` then `update(match_status)` |

An adviser who is neither host nor holder of `file_unmatched_notes` sees only unmatched
notes they hosted themselves — confirmed against a pre-existing note.

Note: integration notes carry a `notes_integration_fields` check constraint requiring
both `source_system` and `external_ref` when `source = 'integration'`.

---

# crm-mcp v0.1.4 — atomic writes, attachments, and a rate-limiting non-result

Deployed as edge function version **6** on 31 August 2026. (v0.1.3, function version 5,
carried an in-memory throttle that was removed after measurement — see below.)

## 1. Note writes are atomic

`add_note` and `file_note_to_client` each ran two statements from the edge function, so a
failure between them left a half-written record: a note filed against nobody, or subjects
attached to a note still sitting in the unmatched queue.

Both are now single Postgres functions — `create_note_with_subjects` and
`file_unmatched_note` — so one statement means one transaction. Both are
**`SECURITY INVOKER` deliberately**: RLS must still evaluate as the calling staff member,
not as the function owner.

`file_unmatched_note` keeps the ordering constraint in the database where it belongs:
subjects are attached before the status flips, because while a note is unmatched the
caller's access comes from being the meeting host or holding `file_unmatched_notes`, and
once matched it derives from the subjects instead.

### Verified

| Check | Result |
|---|---|
| Create note + subject in one call | Succeeded, 1 subject filed |
| Note filed against a non-existent party | Rejected on FK; notes count `3 → 3`, nothing survived |

## 2. Attachments: staff uploads with a correction window

`note_attachments` had no INSERT policy at all, so only the integration webhook (elevated,
RLS-bypassing) could attach anything. Added `uploaded_by_staff_id`, an INSERT policy, and
a DELETE policy scoped to your own upload within 24 hours.

The pre-existing append-only trigger blocked *all* deletes, so it was replaced with
`enforce_attachment_mutability()`: modification in place is never allowed, deletion is
allowed only by the uploader inside the window, and elevated contexts bypass as before.

**The 24-hour window is an implementation choice, not a stated requirement** — notes have
no draft/final state for "before finalising" to reference.

### Verified

| Check | Result |
|---|---|
| Attach as yourself | Succeeded |
| Attach attributed to another staff member | Blocked by RLS |
| Modify attachment in place | 0 rows affected, mime unchanged |
| Remove own, inside window | 1 row deleted |
| Remove own, window closed | 0 rows deleted |
| Remove someone else's | 0 rows deleted |
| Audit trail | `insert, insert, update, delete` |

Two things worth knowing. A removed attachment still leaves a permanent audit record of
having existed and been deleted — "removable" is not "untraceable". And a blocked
modification returns **zero rows rather than an error**, because RLS filters the row out
before the trigger sees it; the app must treat a zero-row result as a refusal.

## 3. Rate limiting: built, measured, removed

An in-memory per-IP throttle was added in v0.1.3 and **did not work**. Twenty-five
consecutive failed requests never triggered it. The logs explain why: 28 rejection lines
across **26 distinct executions**. Edge functions are stateless and horizontally scaled,
so a per-instance counter never accumulates.

It was removed rather than left in place giving false assurance. On reflection the control
was misplaced regardless:

- **Brute-forcing tokens** is infeasible anyway — JWTs are signed, not guessable.
- **Cost and resource exhaustion** isn't solved by rejecting inside the function, because
  the invocation has already been paid for.

What *was* kept is the piece that genuinely helps: a `JWT_SHAPE` structural check that
rejects garbage tokens before the network round-trip to Supabase Auth. `Bearer nonsense`
now returns `Malformed bearer token` without ever calling Auth.

Meaningful rate limiting belongs at an edge/CDN layer in front of the function. Recorded
as an open gap, with the reasoning left in a comment in `index.ts` so it isn't rebuilt
the same way.
