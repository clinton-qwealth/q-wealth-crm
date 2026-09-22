**Status:** Live as edge function `crm-mcp` **v0.2.2 (function version 21)** in Supabase project Q\_CRM. **Thirteen tools: eleven read, two write.** As of 2 September 2026 a connector token can only be issued to a staff member holding a verified second factor; as of 19 September 2026 an account that is not active staff is told **which** of three situations it is in, and the staff directory now holds a person's name in two columns rather than one — this server composes them and answers exactly as it did before. **As of 20 September 2026 every read is territory-scoped and the visibility rule is closed all the way below a household — both without a single line of change here, because the rules live in the database. As of 21 September 2026 the one stale tool description has been corrected and deployed, and the staff name split is finished:** `full_name` **is gone from the database entirely.** Last updated 21 September 2026. Companion pages: *Q Wealth CRM — Security Structure*, *Q Wealth CRM — Administration*, *Q Wealth CRM — Web App*, *Q Wealth CRM — Data Model*, *Q Wealth CRM — Business Rules Register*, *Q Wealth CRM — Production Readiness Checklist*.

> **A rendering correction, 19 September 2026.** Until today this page was stored as **plain text that happened to contain markdown syntax**, so it rendered as literal `**` and `##` rather than as formatting. It has been re-stored as real markdown. **The wording is unchanged** apart from the v0.2.1 additions marked below — only the rendering has been corrected. This is the same fault the *Data Model* page carried until 6 September, and it is worth knowing it can happen: a page written through the API with the wrong content format looks fine in the editor and wrong to every reader.

## What it is

The CRM MCP server is a Supabase edge function that gives Claude a curated set of business tools over the CRM database. It is one of two clients of that database — the other being the web app — and neither holds any permission logic of its own. Both authenticate as the individual staff member and let row-level security decide what that person can see. Claude can never see more than the staff member asking it.

## How staff are authenticated

The server never holds the Supabase service-role key. It creates its database client with the publishable key and forwards the caller's own access token, so `auth.uid()` resolves to that person and every RLS policy applies normally.

```typescript
const db = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${token}` } },
})

```

`is_elevated_context()` returns true for a service-role JWT or a connection with no JWT, and every permission gate short-circuits to true in that state — such a connection could decrypt any TFN, see every client group, and write an audit-log row with a null actor. The service-role key is therefore reserved for migrations and admin tooling.

Requests are gated in four steps: a bearer token must be present; it must be structurally a JWT (a cheap check avoiding a wasted round-trip); it must validate against Supabase Auth; and the authenticated user must have an active row in `staff_users` *and* an access-profile assignment. Every rejection at any step is logged under `event: mcp_auth_rejected`.

`verify_jwt` is deliberately `false`: the server validates bearer tokens itself and must serve the unauthenticated RFC 9728 discovery endpoint. **Confirm this before any redeploy** — deploying with it `true` would break the discovery flow that lets Claude connect at all. **It was confirmed again on the 21 September redeploy**, which is the only reason that deploy is recorded as safe rather than assumed to be.

**The endpoint takes no trailing slash.** `POST /functions/v1/crm-mcp` is correct; `/crm-mcp/` returns 404, because Hono's `basePath('/crm-mcp')` maps the handler to the bare path. A trailing slash in a manual test looks exactly like a broken deployment.

### Three kinds of not-staff, told apart (v0.2.1, 19 Sep 2026)

The fourth gate above has always refused any account without an active row **and** a profile. Since 19 September the database has a third staff status — `pending` — because a person can now register themselves and wait for an administrator to approve them. So the same refusal now covers three genuinely different situations, and the reply says which:

| Situation | Reply (HTTP 403) |
| --- | --- |
| No staff record at all | *"This account is not a Q Wealth staff member — sign in to the CRM and request access"* |
| A record awaiting approval | *"Your request to join Q Wealth CRM is awaiting an administrator's approval"* |
| An inactive record | *"Not an active Q Wealth staff member"* |

**Nothing is granted differently.** All three receive nothing, the gate is unchanged, and the server still refuses any record without an access profile. Only the wording changed — so that somebody setting up the connector learns what to do next rather than only that they may not. The rejection log now records the row's status rather than a bare "found but inactive".

`getStaff()` was widened to return the row's status alongside the staff object, which stays null until a profile exists. That is the whole of the code change. See *Q Wealth CRM — Administration* for the registration flow the first two messages describe.

### A staff name in two parts (v0.2.2, 19 Sep 2026)

Also on 19 September, `staff_users.full_name` was split into two columns, `first_name` and `last_name`. The reason is that a directory has to sort on a surname and address a person by their given name, and neither of those is reliably recoverable from one free-text field — the web app had been guessing at the first name by splitting the string on a space. Clients were never modelled this way: a person has always carried first, middle, last and preferred names, so the schema described a client's name properly and a staff member's as one opaque string.

This server reads that row directly, so it had to change with it. The staff lookup now selects `id, first_name, last_name, email, status, ...` in place of `full_name`, and composes the two parts back into a single display string when it answers.

**Nothing a connector user sees is different, and that is the whole point.** `whoami` still returns `staff: { name, email }`, with one composed name in exactly the shape it has always had. No tool gained a field or lost one, no tool description changed, and no permission moved. The outward contract to Claude is untouched — which is the reason this deploy was safe to make on its own, ahead of the web app.

**It did, however, have to be made in the right order**, because the column it stops reading is one that later goes away. That sequence, and why this function in particular is the one that sets the rule, is set out under *v0.1.5 — and the outage that caused it* below. **That sequence completed on 21 September 2026.**

## Territories reach the connector without touching it (20 Sep 2026)

Clinton, asking for the visibility rule to be closed below a household: **"Ideally i want no visibility from the group down. This includes MCP."**

It already did, and that is the interesting part. **No code in this function changed, no tool was altered, and nothing was redeployed** — and every tool here became territory-scoped on the day the migration landed. The reason is the design decision at the top of this page: the server holds no permission logic, forwards the caller's own token, and lets row-level security answer. A rule added to the database is therefore a rule this server enforces without knowing it exists.

Two changes were made in the database on 20 September, both described in full on *Q Wealth CRM — Security Structure*:

| Change | What it means here |
| --- | --- |
| **User groups (territories).** A household may belong to one; a staff member to many; a per-person toggle confines somebody to theirs | `list_my_groups`, `search_groups` and `get_group` return fewer groups for a limited caller, through `group_summary`, which is `security_invoker` |
| **Visibility closed below the household.** `staff_can_access_party` no longer short-circuits on `view_all_groups`, and the creator escapes on accounts, policies, assets and notes are bounded to the moment of creation | `search_clients`, `get_client_profile`, `get_notes`, `search_notes`, `get_client_accounts` and `get_client_insurance` all narrow with it — because each derives from the party, which now derives from the household |

**One pre-existing hole that was closed on the same day never reached this server at all**, and it is worth recording why: the four sensitive-field functions checked `view_sensitive` and a second factor but never checked access to the client, so anybody holding that permission could decrypt a tax file number for any party by id. **The MCP exposes no reveal tool and never has** — a decision taken on 4 July 2026 — so the connector was structurally outside the defect. That is the argument for the no-reveal rule holding up under a case nobody anticipated when it was made.

### The one description that was wrong, corrected 21 September 2026

**A description is a claim about the database, and this one expired.** `list_my_groups` told Claude from July until 21 September that *"Services/Management/Admin see all groups"*, which stopped being unconditionally true the moment a person could be limited to their territories. It was recorded here on 20 September rather than quietly fixed, because a redeploy for a description alone was judged not worth the risk while the web app was mid-release.

**It is now deployed.** The wording reads: *"All client groups visible to you: the ones you own, the ones in your user groups (territories), the ones shared with you, and — unless your record is limited to your user groups — every group your access profile lets you see. Each row names its* `user_group_name`*, or null for a group in no territory."*

**Exactly one string changed in the whole function**, which was established by diffing the deployed source against the repository before deploying rather than trusting the commit history — the name-split changes had been deployed from a working tree about forty minutes *before* they were committed, so commit dates alone would have suggested two undeployed changes where there was one.

**The server's own version string was deliberately not bumped**, and that is a judgement worth recording rather than hiding: it stays `v0.2.2` while the *function* version goes to 21. By the rule this page sets out under v0.2.0 — *"new tools change the advertised capability set, which clients cache"* — a changed description arguably deserves a patch bump to v0.2.3. It was left alone because no tool was added, removed or reshaped, and the description is re-read from `tools/list` on every session anyway. If a client is ever found caching descriptions across versions, this is the decision to revisit.

---

# Protecting the live token

Reviewed in full on 2 September 2026. **For the current threat model the token is adequately protected. Two gaps matter for a real deployment.**

## What genuinely protects it

**Validation is stateful, not cryptographic.** This is the strongest control here. The server asks Supabase Auth about the token on **every single request** rather than verifying a signature locally. Consequences:

- **Revocation is instant.** Proven against a token with a full hour of validity remaining — it was refused immediately after the session was revoked.
- **Offboarding takes effect at once.** No waiting for a token to expire.
- Setting a staff member's `status` to anything but `active`, or removing their profile assignment, also cuts access on the next request.

The cost is a network round-trip per request. That is the right trade for a system holding client financial data.

> **The web app no longer works this way, and the difference is worth keeping straight.** Since 10 September 2026 the web app verifies its session token locally instead of asking Supabase Auth on every request, so a revoked session remains usable there for at most one access-token lifetime. **This server is unchanged and remains stateful.** The two channels now answer "is this session still real?" differently — see *Token validation* on the *Security Structure* page.

**A token cannot now be issued without a second factor.** As of 2 September 2026 the OAuth consent screen — which is the only path to a token — requires a verified factor and a session that has used it. A stolen password no longer yields a connector token.

**Four independent gates per request**, listed above. Every rejection logged with a distinguishable upstream reason.

**The blast radius is deliberately small.** A stolen token cannot:

|  | Why |
| --- | --- |
| Read a TFN or any encrypted field | No reveal tool exists. `reveal_sensitive_field` is not exposed, and it separately requires `aal2`. **Since 20 September it also requires access to the client** — which this server could not have reached anyway |
| Run arbitrary SQL | No raw-SQL tool |
| Modify or create a client, contact detail or group | No such tools |
| Create an account or a policy | Both are read-only through the MCP by design |
| Delete anything | No delete tool. **An account or policy became deletable in the web app on 19 September; no equivalent tool exists here and none is planned.** Notes are append-only in the database regardless |
| Reach another adviser's clients | RLS scopes every query to that one staff member — **and since 20 September, to their territories as well where the person is limited to them** |
| Administer staff, read the audit trail, or manage a user group | No tools. `manage_staff` is exercised only through the web app's Administration section |

The whole write surface is two tools, both appending notes.

**The service-role key is nowhere near it.** The one credential that would bypass every gate is confined to migrations and admin tooling.

## Gap 1 — MFA is enforced at issuance, not at use

**An OAuth-issued session carries** `aal1` **for its entire life.** Measured 2 September 2026: a token minted 29 seconds after a factor was verified, from a browser session that was already `aal2`, still came out `aal1`. Supabase does not propagate the authorising session's assurance level to the OAuth session.

So the second factor is proven **once**, at the consent screen. A token stolen *after* issuance is not stopped by MFA.

This is a real asymmetry with the web app, where every request re-presents `aal2`. What limits it:

- Stealing a live token is materially harder than stealing a password — which is precisely what MFA exists to defeat.
- The surface above is narrow, and excludes everything sensitive.
- Revocation is instant, so the window closes the moment anyone notices.

**If Supabase ever lets an OAuth session reach** `aal2`**, the requirement should move into RLS** and per-request enforcement comes for free. Until then, requiring `aal2` in RLS would take the connector dark on deploy.

## Gap 2 — no rate limiting, and it cannot be fixed here

**Built, measured, removed.** Twenty-five consecutive failed requests never triggered an in-memory throttle: 28 rejection lines arrived across **26 distinct executions**. Edge functions are stateless and horizontally scaled, so a per-instance counter never accumulates.

The control was also misplaced. Brute-forcing a token is infeasible — JWTs are signed, not guessable — and rejecting inside the function has already paid for the invocation, so it does not prevent cost or resource exhaustion either.

What it *would* have helped with is abuse of a **valid stolen token**, and nothing currently throttles that. Meaningful rate limiting belongs at a Cloudflare or Vercel layer in front of the function.

What was kept: the structural JWT check, which rejects garbage before the round-trip to Supabase Auth.

> **A note added 3 September 2026.** The identity-verification work demonstrated the alternative: a limit enforced inside a **database function**, which no caller and no second edge function can route around. The conclusion above — that rate limiting "cannot be solved inside a stateless function" — was correct about the function and wrong about the problem. This server could adopt the same approach.

## The weakest link is that nobody is watching

Worth naming, because it is not a code problem and will not be fixed by a deployment.

Rejections are logged in a single structured shape and are greppable. But **a stolen token in use produces perfectly ordinary successful requests.** There is no anomaly detection, no alerting, and nobody reads the logs. The signal would be volume or timing — a connector suddenly querying every client group at 3am — and nothing is looking for it.

## What to add, in priority order

1. **Read the rejection logs occasionally**, and decide what "normal" looks like. Free, and it is the prerequisite for everything below.
2. **Rate limiting** — at the edge, or in the database as the identity-verification work showed.
3. **Shorten the OAuth access-token lifetime** if it can be set per client. Halves the window on a stolen token at the cost of more refreshes.
4. **Alerting on volume anomalies** once there is a baseline.

## The one operational habit that matters

**If a token is suspected compromised, revoke the session in Supabase.** Do not attempt anything cleverer. It takes effect on the next request, it is the only control here tested under adversarial conditions, and it works regardless of how much validity the token has left.

---

## Connecting Claude

| Step | Where it happens |
| --- | --- |
| 1. Claude fetches OAuth discovery | Supabase Auth |
| 2. Claude redirects the user to `/oauth/authorize` | Supabase Auth validates client, redirect URI and PKCE |
| 3. User is redirected to the consent screen | **The web app** — Site URL + Authorization Path |
| 4. **Second factor required** | The consent screen refuses an unenrolled account and steps up an `aal1` session, preserving the `authorization_id` |
| 5. User approves | The web app calls `approveAuthorization` |
| 6. Claude exchanges the code for tokens | Supabase Auth `/oauth/token` |
| 7. Claude calls tools with the access token | This function, as that staff member |

**Since 19 September there is a step zero for somebody who does not yet work here.** The consent screen offers the request form directly to a signed-in account with no staff record. **Since 20 September that path is two steps shorter**: following the confirmation email now creates the pending request itself, so the journey is connector → consent → not signed in → login → **Request access** → sign up → confirm the email → **pending** → an administrator approves with a profile → enrol a second factor → connect again. The login screen and the second form that used to sit in the middle are gone — the first was a defect in the confirmation route, not a design. See *Q Wealth CRM — Administration*.

**Three settings broke this in practice, all worth remembering.**

**Site URL.** The consent URL is Site URL + Authorization Path. While Site URL was Supabase's default, staff were redirected to `http://localhost:3000/oauth/consent`. **It is load-bearing a second time since 19 September**: the registration confirmation email's link is built from it too.

**Token endpoint auth method.** The client was registered as `client_secret_basic`, but Claude sends credentials in the request body. The exchange failed with *"client is registered for 'client\_secret\_basic' but 'client\_secret\_post' was used"* — *after* consent had been approved, which makes it look like a consent problem.

**JWT signing algorithm.** The project signs with ES256. On the HS256 default, ID-token generation fails as soon as a client requests the `openid` scope, which Claude does.

## Tool surface

Thirteen tools: eleven read, two write.

| Tool | Type | Purpose |
| --- | --- | --- |
| `whoami` | Read | Calling staff member, their access profile and permissions |
| `search_clients` | Read | Name search across people and organisations |
| `get_client_profile` | Read | Full party profile: roles, relationships, contacts, groups, masked sensitive hints |
| `search_groups` / `get_group` / `list_my_groups` | Read | Household and business-entity groups |
| `get_notes` / `search_notes` | Read | File notes and meeting transcripts, including full-text search |
| `list_unmatched_notes` | Read | Integration notes not yet filed to a client |
| `get_client_accounts` | Read | Investment and superannuation accounts, with valuations, trend, cash and asset allocation |
| `get_client_insurance` | Read | Life, TPD, trauma and income protection cover, with per-cover detail |
| `add_note` | Write | Appends a file note against clients and/or a group, atomically |
| `file_note_to_client` | Write | Files an unmatched integration note and marks it matched, atomically |

Accounts and insurance are **read-only on purpose**. Answering "what does this client hold" is the use case; creating a policy is a deliberate act that belongs in the web app, where the adviser sees the validation and the audit trail records a person rather than an agent. **The same reasoning now covers deletion**, which the web app gained on 19 September and this server did not — **and user groups, which are administered only from the Administration page.**

## Why these tools carry unusually long descriptions

A tool description is the only place Claude learns what a field *means*. The web app has formatters that encode those rules once; this consumer has none. Anything left implicit gets inferred, and an inference about money in financial advice is not a cosmetic error.

**A recorded valuation is not a live balance.** `latest_value` is whatever was last written and `valued_on` is the date it applied — possibly months ago. The description instructs that the as-at date always be stated.

**The trend has a specific basis.** `change_amount` compares against the average of the valuations in the 30 days *before* the latest one. `baseline_points` says how many valuations that came from, and **0 means no trend can be stated at all** — said in those words, so a single-valuation account is not reported as flat.

**A lump sum is not an income stream.** This one changed the database design.

**And, since 16 September, three more facts the feeds introduced.** Available cash is a *current* figure as at the snapshot date and is **already inside** the account value, so the two must never be added. Allocation weights are **fractions of one**, **may be negative** — a short overlay or a pending settlement is real — and are as the provider reported them, so they need not total exactly one. The allocation's own as-at date can be **older** than the snapshot date, because a feed run refreshes cash daily but skips the allocation when its checks fail.

**One column is withheld from this consumer deliberately.** `product_display_name` reads like an account's name and is a fee-schedule identifier: eleven of the first twenty HUB24 accounts share one string, and every *closed* account's contains the word ACTIVE. A model handed it alongside `label` would present it as the account's name, and unlike a screen there is no designer between the value and the reader. The tool therefore selects an explicit column list rather than `*` — which also means a future column does not reach a language model the day it is added, unexplained.

> **A description is a claim about the database, and it expires the same way a comment does.** `list_my_groups` told Claude from July until 21 September that Services, Management and Admin "see all groups". That was exactly true until 20 September, became conditional that day, and was corrected in the deployed function on 21 September — see *The one description that was wrong* above. It was harmless throughout, because nobody is limited yet. The general lesson is the one the *Security Structure* page keeps recording: **the change that makes a statement stale is the only moment anybody knows to look for it** — and the gap between recording it and fixing it was one day only because it was written down.

## The design decision Claude forced

Insurance benefits were originally going to be a single `benefit_amount` column, with the cover type telling you how to read it. That was justified on the grounds that the web app formats by type.

**It was the wrong call, and the question "will Claude understand this?" is what exposed it** — asked before any of it was built. Optimising for the client that has a formatter ignores the client that does not. Claude would have received `{cover_type: "income_protection", benefit_amount: 5000}` and had to infer the unit. Read as a lump sum, $5,000 a month of income protection is understated twelvefold.

The meaning went into the data instead:

- `benefit_basis` — `lump_sum | monthly | annual`, defaulted from the cover type by the RPC, overridable.
- `total_lump_sum_cover` **and** `total_monthly_benefit` **are separate columns.** No combined total, because a combined total has no meaning.
- `benefit_display` is composed by the tool — `"$6,500 per month"` — so a consumer reading nothing else still cannot get it wrong.

The same principle already load-bearing across the system: the rule belongs in the database, because there are two clients.

## How accounts and policies resolve to a group

Neither has a group column. An account belongs to the group(s) its **owners** belong to; a policy to the group(s) of any **related party**. Both tools resolve parties first, sharing that step through one `resolveParties()` helper.

- A **jointly-owned** account or policy is returned for both owners and appears under both groups, without being stored twice.
- For insurance, **any** policy role counts. A person whose life is insured on a policy someone else owns still holds that cover.

`owners` and `lives_insured` are returned separately, and the description warns they are often different people.

**Since 20 September that chain is what carries the territory rule down**, without either tool being aware of it: a party resolves through the households it belongs to, and a household resolves through its user group. One rule at the top narrows every tool beneath it.

**There is no client page to link to.** A person is read and edited in the member panel on their group's page and has no URL of their own — the routes are `/groups`, `/groups/[id]`, `/workflows` and `/workflows/[id]`. A `/clients/{id}` link was handed out until 17 September 2026 and went to a 404. A client now gets a link to their **primary** group's page, and a client in no current group gets no link rather than a broken one.

## Change history

| Version | Date | Summary |
| --- | --- | --- |
| **v0.2.2 (function version 21)** | **21 Sep 2026** | **The** `list_my_groups` **description corrected and deployed** — the one stale claim recorded the previous day. Exactly one string changed, established by diffing the deployed source against the repository rather than trusting commit dates. `verify_jwt` re-confirmed `false`; boot, RFC 9728 discovery, the unauthenticated 401 and the malformed-token 401 all re-tested after the deploy. The server version string was deliberately left at v0.2.2 — see the reasoning above. **The same day, M2 and M3 completed the staff name split, so** `full_name` **no longer exists in the database; this function had already stopped reading it on 19 September and was unaffected** |
| **(no deploy)** | **20 Sep 2026** | **Territories and the closing of visibility below a household reached this server with no code change at all** — the rules are in row-level security and this function forwards the caller's token. Recorded here because "nothing changed" is the claim worth evidencing. One tool description (`list_my_groups`) was left stale in the deployed function and corrected in the repository, awaiting the next deploy |
| **v0.2.2** | **19 Sep 2026** | **Staff lookup moved off** `full_name` **to the** `first_name` **and** `last_name` **columns split apart in the database the same day, and composes them for display. The outward contract is unchanged:** `whoami` **still answers** `staff: { name, email }` **with one name, and no connector user sees any difference. Deployed second in a five-step sequence, while** `full_name` **still existed, so the deploy was reversible on its own** |
| **v0.2.1** | **19 Sep 2026** | **Three kinds of not-staff told apart — no record, awaiting approval, inactive — after the database gained a** `pending` **status and self-registration. Wording only: all three still receive nothing** |
| v0.2.0 (rev) | 17 Sep 2026 | `get_client_accounts` moved from `select('*')` to an explicit column list, withholding the provider's product string from a language model, and its description extended for cash, allocation and the three as-at dates. The client deep link repointed at the primary group's page after `/clients/{id}` was found to 404 |
| **v0.2.0** | 2 Sep 2026 | `get_client_accounts` and `get_client_insurance` added. Minor rather than patch: new tools change the advertised capability set, which clients cache. Three `any` types removed |
| v0.1.5 | 31 Aug 2026 | Profile lookup moved to the nested `staff_access_assignments` path. Deployed to recover a ten-minute outage |
| v0.1.4 | 31 Aug 2026 | Note writes made atomic; staff attachments with a correction window; rate limiting removed after measurement |
| v0.1.2 | 29 Aug 2026 | All auth rejections logged; `file_note_to_client` added |
| **Database fix** | 26 Aug 2026 | `fix_insert_returning_rls_self_lookup` — the change that actually made `add_note` work |
| v0.1.1 | 24 Aug 2026 | Caller identity resolution fixed; note ordering fixed; deep-link base made configurable |
| v0.1.0 | 8 Jul 2026 | Initial deployment — nine read tools plus `add_note` |

## v0.2.0 verification (2 September 2026)

Driven as a real MCP session against the deployed function with a genuine staff token.

| Check | Result |
| --- | --- |
| `initialize` | Reports `q-wealth-crm v0.2.0` |
| `tools/list` | Thirteen tools, both new ones present |
| Unauthenticated `/health` and RFC 9728 discovery | Still served — the OAuth flow is intact |
| `get_client_accounts` | Five accounts with `valued_on` and `baseline_points` per row |
| Single-valuation account | `baseline_points: 0` — correctly signalling no trend |
| Bundled policy | Life + TPD + trauma under one number, `total_lump_sum_cover: 1400000` |
| Income protection | `benefit_basis: monthly`, `benefit_display: "$6,500 per month"`, `total_lump_sum_cover: null` — **not** summed |
| Jointly-owned policy | `owners` and `lives_insured` distinct |

**A type error was caught before deploying, not after.** Deno is not installed locally, so the function was pre-flighted with `tsc` under bundler resolution with Deno-environment errors filtered out. That surfaced a real fault: spreading a `Record<string, unknown>` into an object literal drops the index signature, so the caller could no longer read `policy_id`. Given the ten-minute outage in August, a pre-flight is now part of deploying this function.

## v0.2.1 verification (19 September 2026)

The change is in the auth path, which is the one part of this function that cannot be exercised by a unit test in the repository — there is no Deno test runner here, and the web app's suite does not load this file.

| Claim | How it was checked |
| --- | --- |
| The three statuses exist and behave | Probed on a Supabase branch as each kind of account: a pending row returns `current_staff_id()` null and reads zero rows from every client table; an inactive row the same; an account with no row at all the same. **The database half is proven; the function only reports it** |
| The gate is unchanged | The refusal is still `!staff \|\| staff.status !== 'active'`, and `getStaff()` still returns a null staff object whenever no access profile is attached. Read back from the deployed source |
| Nothing new is granted | The three branches differ only in the `message` string. No branch reaches `buildServer()` |
| The deployment landed | Function version 19, `ACTIVE`, `verify_jwt` still `false`, import map still present |

**What is not verified, and is worth stating plainly:** the three messages have not been read back through a real connector session, because doing so needs a pending account and a declined account with live OAuth tokens. The wording is therefore proven by source and by the database's own behaviour, not end to end. It grants nothing either way, which is why it was judged an acceptable gap rather than a blocker.

## v0.2.2 verification (19 September 2026)

The same constraint as v0.2.1 applies: the staff lookup sits in the auth path, which no unit test in this repository reaches.

| Claim | How it was checked |
| --- | --- |
| The two columns exist in production | Migration `a_staff_member_has_a_first_and_last_name` is applied to the production database, with `full_name` still present and still populated beside them |
| The function reads the new columns | The staff select is `id, first_name, last_name, email, status, ...`, with no remaining reference to `full_name`. Read back from the deployed source |
| The answer to Claude is unchanged | `whoami` composes the two parts into the single `name` field it has always returned. The tool's shape and its description are identical to v0.2.1 |
| The deployment landed | Function version 20, `ACTIVE`, `verify_jwt` still `false`, import map still present |
| The deploy was reversible by itself | `full_name` was present and populated at the moment of the deploy, so v0.2.1 and v0.2.2 would each have worked against the live schema |

## Territory scoping — verification (20 September 2026)

Nothing here was deployed, so what had to be evidenced is the opposite claim: that the rules reached this server anyway, and that they did not break it.

| Claim | How it was checked |
| --- | --- |
| The narrowing happens in the database, not in any client | Every tool reads either a `security_invoker` view or a table with row-level security. A limited persona was probed on a branch **at the database layer** and lost the household, the party, the person row, the contact details, the notes, the account, the policy, the asset and the masked hints — the same set every tool here reads through |
| No tool code references the old vocabulary | The migration's closing block asserts that **no function in the schema still names** `teams`, `team_members` or `team_id`; this function never referenced any of them |
| Nothing changed for anybody today | On production, each of the five active staff counted what they could see across six tables and every count matched the firm-wide total. Nobody is limited and no household is assigned |
| The no-reveal rule held under a case it was not designed for | The sensitive-field defect closed on 20 September was reachable by anyone with `view_sensitive` and a party id. This server exposes no such tool, so it was outside the defect by construction |

**What is not verified:** no connector session has been run as a *limited* staff member, because no such account exists yet. The database-layer probe is the evidence, and the first real limited account is the moment to run the tools themselves.

## Function version 21 — verification (21 September 2026)

A description-only change still redeploys the whole function, so what had to be proven is that nothing else moved and that the function still serves every path the OAuth flow depends on.

| Claim | How it was checked |
| --- | --- |
| Only one string differs from what was already running | The deployed source was fetched and diffed against the repository **before** deploying. Commit history alone would have been misleading: the v0.2.2 changes were deployed from a working tree about forty minutes before they were committed, so two commits touch this file *after* the last deploy while only one of them was undeployed |
| The new wording is live | The deployed source was fetched back after the deploy and carries the corrected description, em dashes intact |
| Nothing was lost in the round-trip | The deployed file was fingerprinted against the repository — 750 lines, 13 `registerTool` calls, 22 `.from()` calls, 3 `.rpc()` calls, and every long description string present |
| The function boots | `GET /crm-mcp/health` returns `200 {"ok":true,"service":"q-wealth-crm-mcp"}` |
| Discovery is still unauthenticated | `GET /crm-mcp/.well-known/oauth-protected-resource` returns 200 with the resource and authorization server. **This is the path** `verify_jwt: true` **would have broken** |
| The auth gate is intact | `POST /crm-mcp` with no token returns 401 with the `WWW-Authenticate: Bearer resource_metadata=...` header |
| The cheap structural check is intact | `POST /crm-mcp` with `Bearer not-a-jwt` returns 401 `{"error":"Malformed bearer token"}` — rejected on shape, before any round-trip to Supabase Auth |
| The deployment settings survived | Function version 21, `ACTIVE`, `verify_jwt` still `false`, import map still present |

**What is not verified:** the tool descriptions have not been read back through an authenticated `tools/list`, because that needs a live connector session. The deployed source is the evidence.

## Token validation — fully exercised (31 Aug 2026)

Seven hostile paths. All rejected with 401, all logged with a distinguishable upstream reason.

| Case | Upstream reason recorded |
| --- | --- |
| No bearer header | `header_present: false` |
| Malformed token | Rejected on shape, before any network call |
| Badly signed token | `token signature is invalid` |
| Wrong audience / wrong issuer | Rejected on signature first — see the caveat |
| Publishable key presented as bearer | `invalid claim: missing sub claim` |
| **Correctly signed, past expiry** | `token has invalid claims: token is expired` |
| Revoked session, token still within its hour | Rejected immediately |

**The expiry case is proven properly.** A genuine access token was held until 71 seconds past expiry and replayed. The signature verified and the rejection was specifically on `exp`.

**A caveat previously overstated.** The tokens used for the expired, wrong-audience and wrong-issuer cases on 29 August were signed with a dummy key, so Supabase rejected them on signature before evaluating claims. Those three proved rejection and logging, not claim validation. Wrong-audience specifically remains unproven in isolation.

## v0.1.5 — and the outage that caused it

**A database migration broke this server for about ten minutes on 31 August 2026.** Splitting `profile_id` out of `staff_users` removed the foreign key the deployed `getStaff()` embed relied on. Every request returned *"Not an active Q Wealth staff member"* until v0.1.5. The failure mode was misleading: the server was reporting truthfully that it could not establish a profile, which reads like a permissions problem rather than a schema one.

The safe sequence for a database holding real client data is three steps, not one migration:

1. Add the new table and backfill — additive, nothing breaks
2. Deploy clients that read the new path
3. Only then drop the old column

**The insurance work of 2 September deliberately followed that shape**: four purely additive migrations, with no alteration to anything the deployed function already read. The tool deployment could therefore have failed without breaking what was already working.

**So did the registration work of 19 September**, and deliberately so: adding a `pending` status and a new table changes nothing the deployed v0.2.0 read, so the function and the migrations were safe to deploy in either order. That property was checked before either was applied rather than assumed.

**And so did the territory work of 20 September**, which is why it needed no deploy here at all: renaming two empty tables, adding two columns and rewriting a policy helper changed nothing this function reads by name.

### The staff name split followed it properly, and finished on 21 September 2026

The split of `full_name` into `first_name` and `last_name` is the first change since August that genuinely needed the sequence, because it ends with a column being dropped that this deployed function once read. It was staged in five steps, and the order is the point:

| # | Step | State |
| --- | --- | --- |
| 1 | **M1** — add the two columns, backfill them from `full_name`, and keep `full_name` populated by a transition trigger. Purely additive | **Applied 19 September 2026** |
| 2 | **Deploy this function** at v0.2.2, reading the two new columns | **Deployed 19 September 2026** |
| 3 | **Deploy the web app**, reading the two new columns | **Deployed 20 September 2026** |
| 4 | **M2** — take `full_name` out of the staff directory view and its nine dependants, which read the two parts instead. The column itself survives | **Applied 21 September 2026** |
| 5 | **M3** — drop the column and the transition trigger. The only one-way step | **Applied 21 September 2026** |

**Step 2 stands alone, and that is the safety argument.** This edge function is deployed separately from the Next.js app — which is exactly the shape of the August outage above, where a migration removed something the deployed function still read and every MCP request failed for ten minutes with a message that pointed at permissions rather than at schema. Here the function was deployed second, by itself, at a moment when `full_name` was still present and still populated. Both the old version and the new one worked against the database as it stood, so the deploy was reversible on its own terms: falling back to v0.2.1 would have changed nothing, rather than causing a second outage.

**Before steps 4 and 5 were applied, the precondition was re-checked rather than assumed.** M2's own header says not to apply it while a deployed client still selects `staff_directory.full_name`. Both clients were checked directly: the deployed edge function's source was fetched and selects `first_name, last_name`; the web app's two directory reads select `id, first_name, last_name, status` **and order by** `last_name`, a query that could not run at all against the pre-split schema — which is stronger evidence that the deployed build is post-split than any commit date.

> *(unsupported content: legacy-content)*
>
> **This is the finding worth carrying forward, and it nearly caused a silent regression.** M2 and M3 were written on 19 September and held for two days, correctly, waiting on the web app deploy. In that window three *other* migrations rewrote `update_staff_patch()` — for `verify_identity`, then `title` and `date_of_birth`, then `limited_to_user_groups` and `user_group_ids`.
>
> M3 carried a **full restatement** of that function, whose only purpose had been to take `full_name` out of the key whitelist. `create or replace` replaces the entire body, so applying M3 as written on 21 September would have **silently reverted all three of those migrations** and taken five keys off the Administration screen. Nothing would have failed loudly: the migration would have succeeded, and the fields would simply have stopped saving.
>
> The section was **deleted rather than refreshed** — by then the live function had not named `full_name` for two days, so it had nothing left to do, and a second copy of a function maintained elsewhere is a trap for whoever edits it next.
>
> **The rule:** before applying any migration written more than a day ago, list every object it `create or replace`s and check whether anything since has touched them. M3's own closing sweep is what would have caught the reverse error — it fails if any function outside the audit whitelist still names `full_name` — and it is the reason the file could be trusted once corrected.

## Correction: add\_note remained broken after v0.1.1

**This page previously recorded** `add_note` **as fixed on 24 August. That was wrong.** A second defect kept it broken until 26 August, found while building the audit trail — not by the original verification, which tested the insert but not the `RETURNING` clause the real code path uses.

`notes_select` delegated entirely to `staff_can_access_note(id)`, a security-definer helper that re-reads `notes`. On `INSERT ... RETURNING`, Postgres applies the SELECT policy to the new row — but the helper cannot see a row inserted by the statement currently executing. Fixed by hoisting each helper's row-local condition into the policy.

**Lesson:** test the code path the application actually executes. An insert and an insert-returning are different operations under row-level security.

The insurance policies added on 2 September were built with this in mind: `created_by_staff_id` is inlined into `policies_select` rather than delegated, so `INSERT ... RETURNING` worked without needing a fix afterwards.

> **The same defect was met a third time on 20 September**, from the other direction: replacing those inlined conditions with helper calls, while closing the visibility gap, broke record creation on a branch for exactly this reason. The inline condition survives — now **bounded** so it covers only the creation window. Three encounters with one behaviour is the argument for it being written on the *Database Conventions* page rather than only here.

## A grant defect introduced and fixed the same day (31 Aug 2026)

`create_note_with_subjects` and `file_unmatched_note` were left executable by `anon`. The migration did `revoke ... from anon`, which is insufficient: Postgres grants `EXECUTE` to `PUBLIC` by default and `anon` inherits it.

Neither was exploitable — both are `SECURITY INVOKER`. All functions were audited; these two were the only ones affected. The correct form is `revoke all on function ... from public, anon`, applied from the outset to `create_insurance_policy` and `staff_can_access_policy`.

> **The mirror-image mistake arrived on 20 September**, and is worth naming beside this one: two helpers were revoked from `authenticated` and never granted back, which broke all four user-group write paths in the web app. Revoking too little and revoking too much are the same class of error, and both are invisible until a real call is made.

## Outstanding

| Item | Detail | Status |
| --- | --- | --- |
| **Nobody reads the rejection logs** | A stolen token in use looks like ordinary traffic. No anomaly detection, no alerting. Free to start, and the prerequisite for everything else | Not started |
| Rate limiting | Cannot be solved inside a stateless function. Needs an edge or CDN layer — **or a database function, which the identity-verification work has since demonstrated** | Approach identified |
| Per-request MFA | OAuth sessions carry `aal1` for life, so the second factor is enforced at issuance only. Move into RLS if Supabase ever changes that | Blocked upstream |
| Shorter access-token lifetime | Would halve the window on a stolen token. Not yet investigated whether it can be set per OAuth client | Not started |
| **A connector session as a limited staff member** | Territory scoping is proven at the database layer, not through the tools themselves, because no limited account exists yet | Partial |
| **The v0.2.1 messages, end to end** | Proven by source and by the database's own behaviour, not through a real connector session with a pending and a declined account | Partial |
| **The corrected description, read through a real session** | Function version 21 is proven by fetching the deployed source, not by an authenticated `tools/list` | Partial |
| Wrong-audience token, in isolation | Rejected in testing, but on signature rather than on `aud` | Minor gap |
| `file_note_to_client` transport test | Verified at the SQL layer, not through the connector, because doing so consumes the only unmatched-note fixture | Partial |
| Search performance | `staff_can_access_note` evaluated per row inside `search_notes`; revisit at real note volume | Monitor |
| Deno not installed locally | Deploys pre-flighted with `tsc` instead. Adequate — it caught a real fault — but a genuine `deno check` would be stronger | Workaround |
| Write tools for accounts and insurance | Deliberately absent. **Delete tools too, since 19 September** | By design |
| Tools for staff administration, the audit trail or user groups | Deliberately absent. `manage_staff` is exercised only through the web app | By design |
| **The** `list_my_groups` **description** | Corrected and deployed at function version 21, with `verify_jwt` re-confirmed and all four unauthenticated paths re-tested | Done — 21 Sep 2026 |
| **The staff name split, steps 4 and 5** | M2 and M3 applied. `full_name` no longer exists in the database; this function stopped reading it on 19 September and was unaffected | Done — 21 Sep 2026 |
| **Territory scoping absorbed with no deploy** | The rules are in row-level security; this function forwards the caller's token and narrowed with them | Done — 20 Sep 2026 |
| **The staff name split absorbed** | v0.2.2, function version 20. Two columns read, one name composed, outward contract unchanged | Done — 19 Sep 2026 |
| **Three refusals told apart** | v0.2.1, function version 19 | Done — 19 Sep 2026 |
| **The product string withheld from a language model** | Explicit column list rather than `select('*')` | Done — 17 Sep 2026 |
| **MFA required to issue a token** | Consent screen requires a verified factor and a stepped-up session | Done — 2 Sep 2026 |
| Expired-token test | Proven with a correctly signed token 71 seconds past expiry | Done |
| End-to-end connector test | Verified with a real staff token | Done |
| Accounts and insurance visible to Claude | v0.2.0, verified as a real MCP session | Done — 2 Sep 2026 |

## Where the source lives

Version-controlled in the `q-wealth-crm` repository at `supabase/functions/crm-mcp/`, alongside a technical `FIXES.md`. Database migrations live in `supabase/migrations/` — **125 files** as at 21 September 2026, **all of them applied to production**. The last two of the name-split sequence were applied on 21 September and renamed to the versions the migration history recorded them under, `20260921105410` and `20260921110515`, so the local filenames and the applied versions agree.
