<!--
  NOT PUBLISHED. This is the finished body of the OPERATIONS space page
  "Integrations" (page id 40042498), held here because Atlassian would not
  accept it.

  History, so nobody repeats it:
    17 Sep 2026 — three write attempts: one 502 and two timeouts. Each was
                  CHECKED afterwards rather than blind-retried, and each had
                  written nothing.
    18 Sep 2026 — the connector is now failing on READS of this page too: a
                  getConfluencePage timed out after 300s and a plain listing of
                  the space timed out as well. So it is the connector, not the
                  size of this body or anything in it.

  TO PUBLISH: confirm the page's current version first (getPagesInConfluenceSpace
  with a title filter returns the version cheaply, where fetching the 58KB body
  does not), then updateConfluencePage with contentFormat "markdown" and
  everything below this comment. Do not blind-retry a write that timed out —
  check whether it landed. A previous session learned that the mirror drifts,
  so re-probe a sample of exact phrases against the live page before assuming
  this body is still the right base.

  This file exists only because it was written and could not be delivered.
  Delete it once the page is published.
-->

**Status:** **Two provider feeds live** — HUB24 since 15 Sep 2026, Netwealth since 17 Sep 2026 — both landing and promoting end to end through the same door. Awaiting the linking of CRM accounts to the remaining provider numbers (19 HUB24, 175 Netwealth), and **awaiting publication of both n8n workflows**, neither of which has yet run on its own schedule. Last updated 17 Sep 2026. Companion pages: _Data Model_ (Layer 11 points here), _Client Groups_ (where the values appear), _Security Structure_ (the role model this extends), _MCP Server_ (the other machine client).

## What this page is

The CRM has external writers. An n8n workflow per platform pulls a daily snapshot of every investment account and writes it into Supabase: HUB24 since 15 September, Netwealth since 17 September, with a third platform to come. This page records how that data gets in, what it may and may not change, how the connection is secured, and the recipe each new platform follows. Decisions are dated; those without a date were made on 15 Sep 2026 with Clinton.

The short version: **each feed connects as a database role that can write exactly one table. A promotion function is the only door from those tables into client data.** No API key of any kind is involved.

**A note on reading order.** The HUB24 sections below are the worked example and carry most of the reasoning; the Netwealth section records only what is different, and *The rules moved into one place* records what the two now share.

## The shape

| Layer | What it is | Who writes it |
| --- | --- | --- |
| **Landing** — `ingest.hub24_accounts`, `ingest.netwealth_accounts` | One row per account per day per provider, every field exactly as received, plus the whole record as JSON | n8n, connected as that feed's own role — `ingest_hub24`, `ingest_netwealth` |
| **Promotion** — `ingest.promote('hub24')`, `ingest.promote('netwealth')` | One door. It reads that source's landing rows not yet dealt with, maps the provider's vocabulary to the CRM's, and applies the shared rules below | Called by n8n as the last step of its run; runs with the database owner's rights |
| **Canonical** — `financial_accounts`, `financial_account_valuations`, `financial_account_allocations` | What every screen and the MCP read | Only the promotion function, for feed data. Staff keep their existing write paths for manual data |

The boundary between landing and canonical is the design. A provider's vocabulary — its status words, its asset-class names, its precision — stops at the landing table. Each platform has its own landing table with its own columns, its own role and its own promotion function, and all of them write the same canonical rows. Nothing that reads the canonical tables needs to know which platform a figure came from, though the figure carries that fact.

**What the providers share is the CRM's rules, not their own shape.** Since 17 September the canonical half of promotion — write the valuation, refresh the cash, seed the label once, accept or refuse an allocation — lives in one set of functions both feeds call. See *The rules moved into one place*.

The `ingest` schema is **not exposed through the API**. PostgREST serves only `public` and `graphql_public`; asking it for anything in `ingest` returns "Invalid schema" (proved by probe on the branch and on production, HTTP 406). Raw provider data is therefore unreachable through either API key by construction, which is a stronger guarantee than revoking grants, and the right one for data no staff member should read unshaped.

## Why a database role and not the API — decision record

Clinton asked whether n8n should use an API connection, and which option was most secure and best practice. Three options were weighed on 15 Sep 2026:

| Option | What a leaked credential could do | Verdict |
| --- | --- | --- |
| n8n's Supabase node with the **secret (service-role) key** | Read and rewrite every client record with row-level security switched off | Forbidden. The project rule since July is that the service-role key appears nowhere, and this would put it in a third-party credential store |
| An **edge function** receiving a signed webhook, holding the secret key server-side | Same blast radius inside the function; a write-only door outside it. Needs its own authentication layer (constant-time comparison, replay protection, rate limiting) | Sound, but it centralises the one credential that bypasses everything, and pays for it with security code we would have to get right ourselves |
| **A dedicated Postgres role per integration**, direct database connection | Corrupt or read HUB24 landing rows. Nothing in `public`, nothing in `auth`, no other feed's table | **Chosen.** Postgres authenticates it with SCRAM over TLS. The role holds only what it is granted, and it is granted one table |

Why the API could not be scoped: PostgREST offers a machine exactly two identities — the publishable key, which is the `anon` role and has held no grants since 3 September, and the secret key, which is `service_role` and bypasses every policy. There is no per-role API key. A database role is the only credential that can write one table and touch nothing else.

Re-evaluated for "n8n will have many more integrations": a single shared role would make every landing table one leak away and lose per-feed attribution; a gateway function would centralise the bypassing credential. One role per integration scales as a recipe — table, role, function, registry row — and the role remains the credential whether n8n holds it or, later, an edge function does.

**Residual risk, stated plainly:** a leaked `ingest_hub24` password lets someone write false HUB24 landing rows until noticed. Every such write is attributable (the landing row, its outcome, `source_system = 'hub24'` on any valuation it produced), and the role is revoked with one statement. The password expires on 15 Mar 2027 (`valid until`), so rotation cannot be forgotten.

## What the role can and cannot do

Proved on a branch on 15 Sep 2026 by switching to the role and trying; confirmed on production with `has_table_privilege` over every table in `public` (all false):

| The role tries to… | Result |
| --- | --- |
| Insert, select, update its own landing table | Allowed |
| Read the source registry, the status map, the unmatched view | Allowed (read only) |
| Call `ingest.promote('hub24')` | Allowed |
| **Delete** landing rows | Permission denied — the record of what the feed said is append-and-correct only |
| Change the registry or the status map | Permission denied |
| Read `financial_accounts`, valuations, persons, anything in `public` | Permission denied, table by table |
| Call `create_financial_account()` or the internal `promote_hub24()` | Permission denied |
| Read `auth.users` | Permission denied for schema |
| Create a table anywhere | Permission denied |
| Connect more than three times at once | Refused (connection limit 3) |
| Run a statement longer than 60 seconds | Cancelled (statement timeout set on the role) |

`is_elevated_context()` returns true for any direct database connection and that does not matter here: a bypass over privileges the role does not hold bypasses nothing.

## Setting up n8n

Written for HUB24 and true for every feed; Netwealth's own differences are under *The Netwealth workflow*. **Each feed gets its own credential** — sharing one would defeat the point of a role per integration.

1. **Connection:** the Postgres node, not the Supabase node. Host is the project's **session pooler** (Supavisor, port 5432) — not the direct host, which is IPv6-only and unreachable from n8n Cloud. SSL required. User `ingest_hub24`, database `postgres`.
2. **Password:** set once, out of band, in the Supabase SQL editor with `alter role ingest_hub24 login password '…'` and pasted straight into n8n's credential store. The role is created `nologin` and stays that way until this is done. The password appears in no file, no migration, no page.
3. **No IP allowlist — decided 15 Sep 2026, reversing the plan.** n8n Cloud does not guarantee static outbound addresses ("Cloud IP addresses change without warning"), so a Supabase Network Restrictions allowlist would silently stop the feed the day the address moved — a control that turns the feed off is worse than none. Security rests instead on what the design already has: SCRAM-SHA-256 over TLS, a role that reaches one table, connection and statement limits, one-statement revocation, and the quarantine of bad data in the landing table. Two hardenings replace the allowlist: **Enforce SSL on incoming connections** is switched on in the Supabase dashboard, and a daily check that `max(fetched_at)` on the landing table is today catches a broken credential within a day. A static-IP proxy was ruled out — it covers HTTP, not the Postgres wire protocol, and adds a component to defend against a threat the scoped role already bounds. If n8n is ever self-hosted behind a fixed address, the allowlist becomes cheap and worth switching on.
4. **TLS in the n8n credential, and what it verifies.** n8n's Postgres credential offers Allow / Disable / Require, and Require verifies the server certificate against the public trust store — which fails against Supabase, whose database certificates are signed by its own private CA ("self-signed certificate in certificate chain"). n8n Cloud has no field for a custom CA, so the credential runs with **Ignore SSL Issues** on: the session is encrypted (proved by connecting with Enforce SSL on, which refuses plaintext at the door) but the certificate is not verified. **Accepted residual:** an on-path attacker between two major clouds presenting a forged certificate could relay the session and read or alter landing rows in flight; the password itself is not recoverable from a SCRAM handshake, and the data plane is the quarantined feed. Through the pooler the username carries the project ref — `ingest_hub24.<project ref>` — and n8n's own connection pool is set to 2 against the role's cap of 3.
5. **Per account, per day: one Execute Query node**, not the node's Upsert operation — that matches on a single column and the table's key is the pair `(account_number, as_at_date)`, and it has nowhere to put the mandatory `payload`. The statement takes the raw HUB24 record as one dollar-quoted `jsonb` literal (`$hub24$ {{ JSON.stringify($json) }} $hub24$::jsonb`) — dollar quoting because n8n's Query Parameters option splits its value on commas, which a JSON record is full of — and does the mapping itself: HUB24's `AccountNumber` → `account_number`, the `AssetAllocations` object's ten keys → the `alloc_*` columns and `asset_allocations_raw`, the whole record → `payload`, `asAtDate` → `as_at_date` with `current_date` as the fallback. `on conflict (account_number, as_at_date) do update` re-sends without duplicating.
6. **Last step: a second Postgres node**, Execute Query, `select ingest.promote('hub24')`, with **Execute Once** switched on in the node's Settings tab — the insert node emits one item per account, and without that toggle the promotion runs once per item instead of once per run. It returns a JSON tally — matched, unmatched, no_value, status_unmapped, invalid, errors, allocations_refreshed, allocations_with_unmapped_class, labels_seeded — which the workflow should log and alert on if `errors`, `invalid` or `allocations_with_unmapped_class` is non-zero.
7. **On the n8n side:** a dedicated project for Supabase integrations, credential sharing off, two-factor enforced, password rotated on a cadence.

## The HUB24 landing table — every field and where it goes

The landing table keeps the shape n8n was already producing, with three additions: `payload` (the whole record), `promoted_at` / `promotion_outcome` / `promotion_note` (what became of each row), and it lives in `ingest` rather than `public`. One row per `(account_number, as_at_date)`; a same-day re-send updates rather than duplicates, and a re-send that **changes** a row puts it back in the queue while one that changes nothing does not.

| HUB24 field | Lands raw | Promoted to | Note |
| --- | --- | --- | --- |
| `account_number`, `as_at_date` | yes | the match key, and `valuations.as_at` | matched against CRM accounts whose provider is HUB24 and whose number is the same |
| `portfolio_value` | yes | `financial_account_valuations.value`, rounded to cents, `source = 'integration'`, `source_system = 'hub24'` | the one figure every screen reads; the thirty-day trend now has a daily series to work from |
| `account_status`, `closed_date` | yes | `financial_accounts.status` and `closed_on`, through the status map | **closing only** — the feed never reopens and never suspends |
| `available_to_trade`, `cash_as_at_timestamp` | yes | `financial_accounts.available_cash`, `snapshot_as_at`, `snapshot_source_system` | a current value refreshed daily, no history (decided 15 Sep 2026) |
| the ten `alloc_*` columns | yes | `financial_account_allocations`, one row per asset class, current state only | HUB24's ten classes map onto the CRM's eight; international cash folds into cash and international listed property into listed_property; direct property has its own class |
| `asset_allocations_raw` | yes | — | the escape hatch for a class the flat columns lack |
| `product_offering_display_name` | yes | `financial_accounts.product_display_name`, refreshed daily and sticky | the fee-schedule identifier. **Not** a name — see _Naming an account_ below |
| `account_name`, `product_offering_type` | yes | together they seed `financial_accounts.label`, **once**, on the first run that matches the account | "Orlando Alvarado — HUB24 Investment". Never rewritten afterwards |
| `account_group_name`, `account_type` | yes | — | shown in the unmatched view so a person can recognise the account; `account_type` is **never** written to the CRM's own, which the adviser owns and which HUB24's product type contradicts on real records |
| `adviser_login_id`, `adviser_name`, `practice_name`, `organisation_name` | yes | — | the routing hint for a later mapping of HUB24 advisers to staff |
| `creation_date`, `inception_date` | yes | — | a candidate for `opened_on` once the feed has earned the trust to set a date the adviser did not enter; not in v1 |
| the whole record | `payload` (JSON) | — | the field that does not exist yet. It earned its keep on day one: the first real run carried two asset classes no column existed for, and both were recovered from here rather than re-requested from HUB24 |

## Promotion rules — what each landing row becomes

Each unpromoted row, oldest first:

| Outcome | When | What was written |
| --- | --- | --- |
| `matched` | a CRM account exists with provider HUB24 and this number, and the value is present | the day's valuation (inserted, or updated if that day already had one) |
| `status_unmapped` | as matched, but the status word has no row in the status map | the valuation still lands; the status is left alone; the word is recorded in the note |
| `no_value` | matched account, `portfolio_value` empty | no valuation; cash and snapshot date still refreshed from this row |
| `unmatched` | no CRM account with this provider and number | nothing. **The row stays in the queue and is tried again every run**, so the day somebody adds the account, every day it has accumulated lands at once — the trend baseline fills immediately rather than starting from the day somebody noticed |
| `invalid_date` / `invalid_value` | a date in the future, or a negative value | nothing — refused with an outcome, not promoted. A malfunctioning or compromised feed leaves a record, not a corruption |
| `error` | the row raised (for example a `closed_date` earlier than the CRM's `opened_on`, tripping the accounts date-order check) | nothing for that row — it is rolled back on its own; the note carries the error; the rest of the run goes through |

Then, for each account touched, the **newest** good landing row refreshes the current-state fields: `available_cash`, `snapshot_as_at`, and the allocation rows — the latter only when the weights are worth having (each between −1 and 1, summing to within one per cent of one); otherwise the previous allocation is kept and the row's note says why. A row with no allocation columns at all leaves the existing allocation in place. **A weight may be negative** — migration 96, the same day: the first real HUB24 record carried `Other = −0.0228` with the classes still totalling exactly one, and the first cut's rule of "each between 0 and 1" would have skipped that account's allocation every day. A negative other is a fact about a portfolio (a short overlay, pending settlements), so it is stored as reported; a class is written when its weight is non-zero. Negative international cash appears on nine of the twenty accounts as well.

**And a class HUB24 sends that nothing here knows about is now recorded by name**, in the landing row's note as `allocation_unmapped:<keys>`, whatever its weight. This is migration 97's tripwire, and it exists because the defect that migration fixed escaped precisely by being small. See _Ten classes, not eight_ below.

**Zero is written.** A zero balance is a fact, and the mix ring already draws no arc for it.

**The feed only ever closes.** A status mapped to `closed` on an account that is `active` sets `status = 'closed'` and `closed_on` (HUB24's closed date, or the snapshot date if none). Nothing else about status is touched; `suspended` and any reopening remain decisions a person makes in the CRM.

## Ten classes, not eight — the defect the first run found

Migration 95 built flat landing columns for the eight asset classes the sample record carried. Production sends ten. `PropertyListedInternational` appeared on three accounts and `PropertyDirect` on one, and neither had a column, so the promotion could not see them.

**Nothing was lost.** Both sat in `asset_allocations_raw` and `payload` from the moment they landed, which is exactly what that escape hatch was built for, and migration 97 backfilled the two new columns from it. No data was re-requested from HUB24.

**The damage it would have done splits two ways, and the second is the one worth preventing:**

| Shortfall | What happens | Accounts |
| --- | --- | --- |
| More than the 1% tolerance | The allocation is **skipped**, with a note. Visibly wrong | 1 account, $228,739 of direct property |
| Less than the tolerance | The allocation is **written**, understating property, and looks perfectly correct | 3 accounts, up to $14,840 |

A silently wrong allocation is worse than a missing one, and three of the four were in that group.

**The canonical set gained one class, not two.** International listed property folds into `listed_property` beside its Australian counterpart, following the precedent already set where international cash folds into `cash`. Direct property became its own class, `direct_property`, because unlisted property is illiquid and appraisal-valued and behaves nothing like a listed trust. Burying it in `other` would hide a real holding from whoever reads the mix to give advice, which is the same argument that put `benefit_basis` on insurance covers in July.

**The tripwire is the durable part.** The promotion now compares the allocation keys HUB24 sent against the ten it knows and records any it does not, by name, in the landing row's note. The sum tolerance still decides whether the allocation is written; what changed is that an unmapped class can no longer pass silently at any weight. Finding these two took a person reading the raw JSON; the next one announces itself.

## Naming an account, and the field that looked right and was not

An account added purely so a feed can attach to it starts life with a placeholder nobody wants to type. From migration 98 the feed names it, once.

**The obvious candidate was wrong, and the first real run proved it twice.** `ProductOfferingDisplayName` looks like a name and is not one:

| Problem | Evidence from the first twenty accounts |
| --- | --- |
| It barely distinguishes anything | Eleven accounts share one string; twenty accounts share five |
| It says ACTIVE on closed accounts | All five closed accounts carry it, for example `HUB24 Invest (CHOICE Dimensional Nil MFF) ACTIVE` on an account HUB24 itself reports Closed |

The word describes the product being open to new business, not the account. On the label of an account the feed has just closed it would be a lie on the screen. So it gets `financial_accounts.product_display_name`, a field of its own where saying ACTIVE is harmless, refreshed daily and **sticky** — a run reporting no product leaves the last one standing.

**The label is built from the fields that identify the account**: HUB24's `account_name` and `product_offering_type`, joined as `Orlando Alvarado — HUB24 Investment`. Inside one household that distinguishes two accounts held by different people in different products, which is the job. The product type is taken from the product fields and **never** from `account_type` — the two disagree on real records, 24035500 being a superfund with a corporate trustee whose product type reads Investment.

**It is seeded exactly once**, while `product_display_name` is still null. Because that column is sticky, the condition is a one-way door: it is true before an account's first feed run and false forever after. An adviser who renames the account keeps that name permanently, which a nightly rewrite would have made impossible.

**The one cost, found by a branch probe rather than in production.** A label typed *before* the account is first matched is replaced by that first run, because nothing can distinguish a chosen name from the placeholder the modal obliged someone to type. The probe created an account called "Reece - family super, DO NOT RENAME" and the first run duly renamed it. So the rule is **name it after linking, not before** — and the previous label is written into the landing row's note as `label_seeded:was=<old label>`, so a name the feed replaced is always recoverable.

## The status map — seeded from the first real run, not guessed

`ingest.hub24_status_map` maps HUB24's words to `active` or `closed`. It shipped **empty** on purpose: until a word has a row, the feed records `status_unmapped` and acts on nothing.

**The first real run settled it.** Twenty accounts, two words, and migration 97 seeded both:

| HUB24 says | The CRM records |
| --- | --- |
| `Open` (15 accounts) | active |
| `Closed` (5 accounts) | closed |

A word HUB24 adds later still lands as `status_unmapped`, still acts on nothing, and is added the same way. The flagged rows keep their valuations, so the map only governs status from the next run onward.

## Netwealth — the second feed, 17 September 2026

Netwealth went in two days after HUB24, by the recipe below, and the recipe held: a landing table of its own, a role of its own, a promotion function of its own, and the same canonical rows at the end. Nothing about HUB24 changed except that both feeds now share one copy of the CRM's rules — see *The rules moved into one place*.

**The two feeds cannot write over each other, and that is structural rather than careful.** Clinton's first question when Netwealth was proposed was whether the records would collide with HUB24's. Four separate things prevent it:

| Layer | Why a collision is impossible |
| --- | --- |
| Landing | Two tables, each keyed on its own `(account_number, as_at_date)`. Neither feed can see the other's |
| Credential | Two roles. `ingest_netwealth` holds no grant on `ingest.hub24_accounts`, and `ingest_hub24` holds none on Netwealth's. Both denials were probed |
| Matching | An account is found by **provider party AND number**. A Netwealth account numbered the same as a HUB24 account is a different CRM account — probed with a deliberate duplicate |
| Canonical | Valuations are keyed `(account_id, as_at)` and each carries its `source_system` |

### What Netwealth sends, and how it differs from HUB24

Netwealth's API is shaped differently, and four of the differences changed the design rather than just the mapping.

| | HUB24 | Netwealth |
| --- | --- | --- |
| Calls per run | one paged list, then two calls per account | one list, then **four** per account: detail, balance, cash, holdings by asset class |
| Account status | a word (`Open`, `Closed`) through a mapping table | **no status word at all** — `isExited`, a boolean, with `dateExited` beside it |
| Valuation date | none sent; the run's date is used | **Netwealth dates its own figure**, in `/balance.valuationDate` |
| Asset classes | ten fixed keys on one object | a list of **words** — "Australian Fixed Interest" — each with a fraction |
| Product string | `ProductOfferingDisplayName` | `productOption`, e.g. "netwealth Wealth Accelerator Plus" |
| Who the account is for | `AccountName` | a trust name, a non-custodial name, or a first and last name |

**No status map, because there is no status word.** `isExited` is unambiguous, so it is read directly: true closes the CRM account on `dateExited`, and false never reopens one. The one-way rule is identical to HUB24's; only the input differs.

**Netwealth dates its own valuation, so the CRM uses that date and not the run's.** This matters more than it sounds. On the first real run the 176 accounts split fifty on the 16th and a hundred and twenty-six on the 17th, so dating them all by the run would have been wrong for a quarter of the book. It also means two runs over a weekend that both report Friday's figure update **one** valuation row rather than inventing three.

> **The timezone trap, avoided by design.** Netwealth sends `2026-09-16T00:00:00+10:00` and the database session runs in UTC, so casting that to a date naively yields the 15th — the day before. The instant is landed raw in a `timestamptz` and the calendar day is taken `at time zone 'Australia/Sydney'` at promotion, once, in one place. The same conversion dates the cash from `cash.effectiveDate`. This is the same class of bug the CRM already documents twice over in `lib/note-date.ts`.

**Asset classes arrive as words, so they are mapped through a table.** `ingest.netwealth_asset_class_map` maps Netwealth's wording onto the CRM's eight classes. A word with no row **voids that account's whole allocation** and is named in the landing row's note as `allocation_unmapped:<word>` — stricter than HUB24's tripwire, which notes the unknown key and still writes what it can. The reason for the difference is the shape of the data: HUB24's unknown key is one of a fixed set of columns, where a Netwealth word could be any share of the portfolio, so writing the rest would silently understate the mix by an unknown amount.

### What the first real run taught, and what was done about it

The sandbox at `api.nwbeta.com.au` returned **176 accounts in 4 minutes 12 seconds**. The map had been seeded with one observed word and seventeen exact-string guesses, each marked `observed = false`, on the promise that the first run would say which were right. It did.

| Netwealth's word | Accounts | In the map? |
| --- | --- | --- |
| Australian Fixed Interest | 52 | yes, and observed |
| Australian Equities | 29 | yes, guessed — now confirmed |
| International Equities | 20 | yes, guessed — now confirmed |
| Property | 17 | yes, guessed — now confirmed |
| **Alternative Investments** | 10 | **no** — the guesses said "Alternatives" and "Alternative" |
| **Multi Sector** | 5 | **no** |
| International Fixed Interest | 4 | yes, guessed — now confirmed |
| Other | 4 | yes, guessed — now confirmed |
| **International Unhedged** | 1 | **no, and deliberately still not** |

Migration `20260917035317` marked the five confirmed guesses as observed and added two: **Alternative Investments** to `other`, which is what the seeded guesses were reaching for, and **Multi Sector** to `other`, because a diversified fund spanning classes has no single home among the CRM's eight and `other` is the honest answer until Netwealth reports its split.

**"International Unhedged" was left unmapped on purpose.** It could be equities or fixed interest, one account carries it, and a wrong row would be written into that account's allocation on every run thereafter. An unmapped word costs that one account its allocation and announces itself by name; a wrongly mapped one is silent and stays wrong. The decision is a person's, and it is open.

Three other facts from the same run, worth knowing before reading a Netwealth account on screen:

- **123 of the 176 accounts report no allocation at all.** Their value and cash still land; the mix is simply absent.
- **Account types are WRAP (116), Super (39), Pension (11) and XWRP (10).** The seeded label suffix reads "Netwealth Xwrp" for those ten, which is ugly and editable in the account drawer.
- **Sandbox values are absurd** — several accounts near two billion dollars. That is test data, not a fault.

### An account may be below zero — decided 17 September

Four of the 176 accounts reported small negative balances: −$1.56, −$69.23, −$69.12 and −$67.56. The promotion refused all four as `invalid_value`, applying a rule written for HUB24 as a sanity check and inherited by Netwealth through the shared shape.

**The rule was wrong for a wrap account**, where an overdrawn cash balance is real if uncommon. Refusing it left the CRM showing the last positive figure as though nothing had happened, stamped the row so it would never be retried, and told nobody.

The pros and cons were weighed with Clinton and the rule relaxed **with a floor**, in migration `20260917041724`:

| Kept | Given up |
| --- | --- |
| A sanity check still exists: below **−$100,000** is refused as a feed fault, because no wrap account owes that on its cash | A negative from a malfunctioning feed within the floor now lands as a valuation |
| The floor lives in **one function**, `ingest.value_is_plausible()`, that both promotions call, so they cannot drift | |

What already coped downstream, checked before deciding rather than after: `financial_account_valuations.value` carries no non-negative constraint; the wealth summary sums every value, so an overdraft correctly reduces Total investments; and the investment mix ring filters to positive values, so a negative account leaves the picture.

**That last one was the only real cost, and the app was changed in the same breath to say so.** A share-of-total chart cannot draw a negative share. The ring now counts such accounts separately from accounts with nothing recorded — the two mean opposite things — and prints *"1 account is below zero and is not drawn"* beneath its legend. Its empty state says *"The only valued account is below zero"* rather than the false *"no value has been recorded"*. See *Client Groups* for the ring itself.

The four refused rows were reset by the migration and promoted on the next run.

### The Netwealth landing table

Same three additions as HUB24's — the whole record in `payload`, the three promotion columns, and a home in `ingest` — over columns shaped to Netwealth's four calls.

| Netwealth field | Lands as | Promoted to |
| --- | --- | --- |
| `accountNumber`, run date | `account_number`, `as_at_date` | the match key |
| `balance.totalValue` | `total_value` | `financial_account_valuations.value`, `source_system = 'netwealth'` |
| `balance.valuationDate` | `valuation_at` (instant, raw) | **the valuation's date**, taken in Sydney |
| `cash.availableCash`, `cash.effectiveDate` | `available_cash`, `cash_effective_at` | `financial_accounts.available_cash` and `snapshot_as_at` |
| `cash.totalCash`, `minimumCash`, `managedAccountCash` | landed | — |
| `detail.isExited`, `detail.dateExited` | `is_exited`, `date_exited_at` | closes the account, never reopens |
| `detail.productOption` | `product_option` | `financial_accounts.product_display_name`, sticky |
| `detail.clientTrustName` / `nonCustodialAccountName` / first and last name | landed separately | together with `accountType` they seed `label` **once** — "Elle & Polly Pocket Family Trust — Netwealth Wrap" |
| `holdings.assetClasses[]` | `asset_classes_raw` | `financial_account_allocations`, through the word map |
| `detail.clientId`, `dateJoined`, `adviserCode`, `externalReferenceNumber` | landed | — routing and reconciliation hints |
| all four responses | `detail_raw`, `cash_raw`, `balance_raw`, and the lot in `payload` | — |

`ingest.netwealth_unmatched` mirrors HUB24's queue and is cleared the same way: **Add account** on the client group with Netwealth Investments Limited as the provider and this exact account number.

### The Netwealth workflow

Workflow **Netwealth - Get Accounts** in n8n, built and corrected through the n8n MCP connector on 17 September. Its shape follows HUB24's: fetch, land, promote.

| Node | What it does |
| --- | --- |
| Daily Schedule | 2am |
| Get Accounts | `GET /public-api/v2/accounts` — one item per account |
| Get Detail, Get Balance, Get Cash, Get Portfolio | four calls per account, batched three at a time |
| Combine Record | one item per account carrying all four responses **whole**, plus the run date |
| Upsert to Supabase | the Execute Query statement, one dollar-quoted `jsonb` literal, mapping into `ingest.netwealth_accounts` |
| Promote | `select ingest.promote('netwealth')`, **Execute Once** on |

Three corrections were made to the first draft, each worth recording because the next provider's flow will be drafted the same way:

- **An "Ensure Table" node ran `create schema` and `create table` on every run.** It failed with "permission denied for database postgres", and that is the design working: the feed role may write one table and create nothing. Schema comes from a migration. The node was deleted.
- **The pipeline was not connected.** Combine Record led nowhere, and the upsert and promote nodes were wired to each other but to nothing upstream, so a "successful" run wrote nothing at all.
- **It used the HUB24 credential.** Even a correct statement would have been refused. A second Postgres credential, **Netwealth Ingest**, connects as `ingest_netwealth.<project ref>` with the same pooler, TLS and connection settings as HUB24's.

The detail and balance calls were added because the accounts list carries only a number, an adviser code and a set of links. Without `/detail` there is no name, no product and no exit flag; without `/balance` the value would have to be summed from holdings, which is a derived figure where Netwealth offers a reported one.

## The rules moved into one place

`promote_hub24()` was about two hundred lines and most of them were not about HUB24: upsert the valuation, close through the map, refresh cash, keep the product string sticky, seed the label exactly once, refuse an allocation outside its tolerance, drop zero weights. Copying that into `promote_netwealth()` would have made two copies of the CRM's business rules, and a later fix to the tolerance would have landed in one of them.

So the canonical tail was lifted out on 17 September:

| Function | What it owns |
| --- | --- |
| `ingest.apply_valuation()` | One valuation per account per day from a feed; a same-day re-run updates the figure. The only writer of integration-sourced valuations |
| `ingest.apply_snapshot()` | Cash, the snapshot date, the sticky product string, the label seeded once, and the allocation — rewritten only when its eight weights are each within \[−1, 1\] and sum to one within a per cent, otherwise left standing and reported as skipped |
| `ingest.close_if_active()` | The one status move a feed may make: active → closed. Suspended is untouched, nothing is ever reopened |
| `ingest.value_is_plausible()` | The sanity floor on a reported value (above) |

**Each provider's function is now only the mapping from its vocabulary to ours.** `promote()` is unchanged as the single door; it gained one `when 'netwealth'` branch.

> **How the rewrite was proved not to change HUB24.** Thirteen landing rows covering every outcome — matched, unmatched, no value, a status word with no map row, a future date, a negative value, an unknown allocation class, a property fold, a two-day account, an account already named — were run through the **old** promotion on a branch, the state captured, the state reset, and the same rows run through the **new** one. Result counts, landing notes, valuations, allocations and account fields were diffed in both directions: **zero differences**. The first pass found one difference, the order of three facts inside a single note, and the code was changed to match the original rather than the test being adjusted to accept it.

## What changed in the CRM's own tables

| Table | Change | Why |
| --- | --- | --- |
| `financial_accounts` | Unique index on `(provider_party_id, account_number)` where a provider is recorded | Nothing stopped two accounts sharing a number; a feed cannot be allowed to pick one. Accounts with no provider (all five existing ones) are unaffected |
| `financial_accounts` | New `available_cash`, `snapshot_as_at`, `snapshot_source_system` | Current-state values from the feed. Only `promote()` writes them |
| `financial_accounts` | New `product_display_name`; `label` seeded once by the feed | The provider's product string, kept away from the name. See _Naming an account_ |
| `financial_account_valuations` | New `source_system`; `source` closed to manual / seed / integration with default `manual`; an integration row must name its system and a manual one must not | The MCP promises `latest_value` "is the most recent recorded valuation"; knowing whether HUB24 or a hand recorded it is what that promise is worth. Same shape the notes table has carried since July |
| `financial_account_allocations` | **New.** `(account_id, asset_class, weight)`, current state only, refreshed by delete-and-insert. Eight classes: australian_shares, international_shares, australian_fixed_interest, international_fixed_interest, listed_property, direct_property, cash, other. `weight` in [−1, 1] since migration 96; `direct_property` added by migration 97 | A table rather than a column per class: a new class is a check-constraint value, not a schema change, and a provider reporting five classes leaves no empty columns. That choice paid for itself within a day — `direct_property` was a one-line constraint change, where a column would have been an ALTER on every reader. Staff can read where they can read the account; **nobody but the promotion writes** |
| `parties` / `organisations` / `party_roles` | HUB24 Limited seeded as an organisation party with an active `product_provider` role, at a fixed id | Nothing today can create an organisation party — only person write paths exist — and the Add account modal's provider list was empty for exactly this reason. It now offers HUB24, which is also how an unmatched account is resolved |

## Audit — the trail, not the noise

| Event | Audited? | Why |
| --- | --- | --- |
| A valuation written by the feed | **No** | One audit row per account per day, forever, carrying the full row as JSON, is volume without information. The landing table is the immutable record of what the feed said, down to the payload, and the valuation itself says `hub24`. Implemented as two triggers (insert-or-update, delete) each with a `when` clause, because one trigger cannot reference both the new and old row |
| A valuation typed by staff | **Yes**, exactly as before | Proved: a manual valuation on the branch produced an audit row with the staff member's id and `source = manual` |
| The daily refresh of cash and snapshot date on the account | **No** | The three columns are excluded from the accounts audit trigger; an update that changes nothing else is treated by `record_audit` as a non-event. Proved: two refresh runs, zero audit rows |
| The feed closing an account | **Yes** | Rare and worth reading. Proved: one row, `changed_fields = {closed_on, status}` |
| Allocation rows | No trigger | Overwritten daily; the landing table is their complete history |

A correction to the plan as written: `audit_log.db_user` records `postgres` on every row, not the API or integration role, because `record_audit` runs as its owner. It always has — every existing audit row reads `postgres`. Attribution of feed writes comes from the landing row and from `source_system`, not from `db_user`.

## The unmatched queue and how to clear it

`ingest.hub24_unmatched` lists each HUB24 account number the CRM has no row for, with the account name, group name, product, adviser and practice HUB24 gave, its latest value and date, and how many days it has been waiting. To resolve one: open the client group, **Add account** with HUB24 as the provider and this exact account number. The next promotion places every accumulated day. Nothing is created by the feed itself: owners are unknown, row-level security derives from owners, and the deferred trigger requires one — the same reason the notes integration lands unmatched rather than inventing a client.

In v1 the view is read in the SQL editor. A web screen and an MCP tool mirroring `list_unmatched_notes` are deferred, below.

## The recipe for the next provider

**Used once, on 17 September, and it held.** The third platform is the same steps in one migration, verified on a branch as the new role and as an ordinary staff member before production:

1. Seed the provider as an organisation party with a `product_provider` role, at a fixed id.
2. `ingest.<provider>_accounts` with **that provider's** columns, `payload jsonb not null`, the three promotion columns, `unique (account_number, as_at_date)` and the change-detection trigger.
3. Whatever mapping table that provider's vocabulary needs — a status map, an asset-class map, or neither. Seed it from the **first real run**, not from the sample record, and mark any guess as a guess so the run can confirm or correct it.
4. `ingest.promote_<provider>()` mapping that provider's words onto the CRM's, then calling the shared `apply_valuation()`, `apply_snapshot()` and `close_if_active()`; a `when '<provider>'` branch in `ingest.promote()`. **Carry an unmapped-class tripwire across** — every provider needs one.
5. Role `ingest_<provider>`, `nologin`, connection limit 3, grants only on its own landing table and the shared read-only registry; a row in `ingest.sources`. Guard the `create role` with an existence check — roles live at the cluster and survive a branch reset.
6. **The RLS policies.** Row-level security is on for every landing table, so the grants in step 5 are hollow without a policy admitting the new role to its own table and to the registry it reads. This was nearly missed on Netwealth and was caught by reading HUB24's migration rather than by a refused insert.
7. A second n8n credential for the new role. Never reuse another feed's.

Nothing in the canonical tables or the web app changes. **What does change is the mapping table**, which no sample record can settle — see how Netwealth's first run corrected seventeen guesses.

## Verification performed

### HUB24 — 15 September 2026, throwaway branch

Seeded through the real RPC as an ordinary staff session: a household, four HUB24-linked accounts (one to stay open, one to be closed, one with a July close date against an August open date, one with no provider recorded) and later a fifth added mid-run. Landed eleven HUB24 rows over four days as the `ingest_hub24` role, including two garbage rows and a same-day correction. Then the branch was reset and the final migration text applied once more, clean, before production.

| Probe | Result |
| --- | --- |
| Role privilege probes (table above) | All denied as listed; `has_table_privilege` false for every `public` table |
| `authenticated` reads `ingest.hub24_accounts` or calls `ingest.promote` | Permission denied for schema |
| REST `/rest/v1/hub24_accounts` with the publishable key | 404; with `Accept-Profile: ingest`, 406 "Invalid schema: ingest — only public, graphql_public are exposed". Same on production |
| Second HUB24 account with an existing number | Unique violation |
| First run | 4 matched, 3 unmatched, 2 invalid, 1 error (date-order check named in the note), closed account `closed`/`closed_on` set, zero balance written |
| Second run on the same data | Nothing written; only the unmatched rows retried |
| Same-day correction of one figure | Row re-queued by the trigger, re-promoted, valuation updated to the new figure, allocation rows written from the corrected weights; an unchanged re-send was not re-queued |
| Weights summing to 1.3 | Allocation skipped with `allocation_skipped:sum=1.3000`; cash still refreshed |
| Unknown status word `Frozen` | `status_unmapped`, valuation written, status untouched |
| Empty value | `no_value`; cash and snapshot date refreshed from that row; previous allocation kept |
| Adding the unmatched account through the RPC, then promoting | Both accumulated days landed; summary view shows two baseline points; the view drops it and keeps the one with no provider |
| Feed closes the newly added account | Status change audited with `changed_fields = {closed_on, status}` |
| Audit rows from integration valuations and from cash refreshes | Zero |
| Staff with access reads allocations and integration valuations | Rows returned; staff without access sees none |
| Staff updates or deletes an allocation | Permission denied |
| Staff writes `source = integration` without a system, `manual` with one, or `bogus` | Each refused by its check constraint |
| Manual valuation by staff | Audited, with the staff id |
| Supabase security advisor, branch and production | Nothing new; the performance advisor's only new note (an unindexed FK on the one-row registry) fixed before production |
| Web app | `tsc`, `eslint`, 920 tests: unchanged and green. No screen changes in v1 |

One probe artefact worth knowing: inside a single SQL-editor transaction, JWT claims set for an earlier staff-session block persisted into a later feed block, so one audit row read `actor_context = api`. A real n8n connection has no JWT and records `elevated`, as the first run in a fresh transaction did.

**Migration 96, later the same day, on a second throwaway branch** (which also replayed migration 95 on a fresh project, proving the guarded role creation both ways): the n8n node's exact statement was run with the real sample record as the `ingest_hub24` role — every field landed, `Other = −0.0228`, `PropertyListedAustralian` absent and null, 19 keys in the payload; promotion wrote six allocation rows totalling exactly 1.000000 with `other = −0.022800`; weights summing to 1.3 still skipped with the note; a direct write of −1.5 refused by the check and −0.5 accepted; the function's grants unchanged. Applied to production and read back.

### Migration 97, verified against the real production records

The third branch replayed all 96 prior migrations from scratch, then took **the actual records from the first run** rather than invented ones, fed through the node's own statement as the `ingest_hub24` role. Six HUB24 accounts were linked in the CRM through the real RPC, one left unlinked, and one synthetic record carried an unknown class at a weight of 0.0003 — the exact size that slipped through before.

| Case | Result |
| --- | --- |
| `24039923`, direct property 0.0542 | **8 classes written**, including `direct_property = 0.054200`, summing to 1.0001. Before migration 97 its allocation was skipped entirely |
| `24034106`, international listed property 0.0085 | `listed_property = 0.009000`, the two listed figures folded together, summing to exactly 1.000000. Before, it was written at 0.9915 understating property |
| `24033810`, negative `Other` | 6 classes, sum exactly 1.000000, unchanged by this migration |
| `24034104`, a single class at 1.0 | `cash = 1.000000`, one row |
| `24033820`, Closed with no value | `no_value`; account set to `closed` with `closed_on = 2020-02-03`; cash refreshed to 0.00; allocation left alone |
| Unknown class `Infrastructure` at 0.0003 | Allocation **written**, and the note reads `allocation_unmapped:Infrastructure`. The tripwire fires at a weight the tolerance accepts |
| Unlinked account | `unmatched`, `promoted_at` still null, present in the unmatched view |
| The backfill, run against rows simulating production exactly | Both columns populated from `asset_allocations_raw`; the change trigger re-queued them, which is a no-op on production where none is promoted |
| Audit | Zero rows for feed valuations; one row for the account close, `changed_fields = {closed_on, status}` |
| Grants, advisors | `promote_hub24` still owner-only; no new advisory beyond the probe's own scaffolding table |

Production after apply: 97 migrations, latest `20260915105912`. The four affected accounts now carry captured sums of 1.0000, 1.0000, 1.0000 and 1.0001, and **zero rows are out of tolerance**. The status map holds `Open` and `Closed`. `tsc`, `eslint` and 920 tests pass unchanged.

### The feed running end to end, and migration 98

The third and fourth workflow runs closed the loop. With the node SQL sending all ten classes and the promotion node in place, twenty accounts landed at 11:49:25 and the promotion placed them 400 milliseconds later: **1 matched, 19 unmatched, 0 errors, 0 notes, 0 rows out of tolerance.** The matched account received its valuation as `integration`/`hub24`, its available cash, and six allocation rows totalling exactly 1.000000 including a negative `other` — and HUB24's Australian and international cash correctly folded into a single `cash` of 0.0968. No audit rows for the feed valuation, which is the intended quiet.

Migration 98 was then verified on a fourth branch with three accounts, deliberately including one named "Reece - family super, DO NOT RENAME" to test the seeding rule against a label somebody meant:

| Case | Result |
| --- | --- |
| Placeholder label, first match | Seeded to `Orlando Alvarado — HUB24 Investment`; note reads `label_seeded:was=placeholder` |
| Closed account, first match | Seeded to `Jerome Christian — HUB24 Pension`. The product type is clean where the display name would have said ACTIVE |
| A label somebody chose, first match | **Replaced**, and the note preserves it: `label_seeded:was=Reece - family super, DO NOT RENAME`. This is the documented cost, and it is why the old label is recorded |
| An adviser renames the account after the first run, then the feed runs again | `labels_seeded: 0` and the rename survives. The one-way door holds |
| Product field | Set on every touched account, sticky thereafter |

Production after apply: 98 migrations, latest `20260915123109`. The one linked account gained its product string and kept its existing label, since its first touch had already happened. `tsc`, `eslint` and 920 tests pass unchanged.

### Netwealth, verified on a branch — 17 September 2026

The branch replayed all 101 prior migrations, then ran two things: the HUB24 replay described above, and Netwealth's own cases. Netwealth rows were landed **through the n8n node's own upsert statement**, verbatim apart from a CTE feeding six payloads instead of one, so the SQL that was proved is the SQL that runs.

| Case | Result |
| --- | --- |
| The real sandbox account `WRAP100369` | Matched. Valued **as at 16 Sep** from Netwealth's own date, not the run's 17th. Label seeded `Elle & Polly Pocket Family Trust — Netwealth Wrap`, product kept aside, cash dated by Netwealth's cash date, one allocation class written |
| An exited account | Closed on `dateExited`, not on the run date |
| An account carrying `Crypto Assets` | Allocation **voided** and the note reads `allocation_unmapped:Crypto Assets` |
| An account with no balance at all | `no_value`; cash and label still applied |
| **A Netwealth account numbered `H1`, the same as a HUB24 account** | Its own valuation on its own CRM account. HUB24's `H1` untouched — checked explicitly |
| An account with no CRM row | `unmatched`, `promoted_at` still null, present in the unmatched view |
| A same-day re-run with a changed value | The trigger re-queued the row; the second promotion **updated the one valuation** rather than adding a second |
| As `ingest_netwealth`: read `hub24_accounts`, `hub24_status_map`, any `public` table, call `promote_netwealth()` directly | Denied, each one |
| As `ingest_netwealth`: call `ingest.promote('netwealth')`, write its own table, read its own class map | Allowed |
| As `ingest_hub24`: read `netwealth_accounts` or the Netwealth class map | Denied. Its own table still readable |
| `ingest.value_is_plausible()` at −1.56, −100,000, −100,000.01, null and zero | Pass, pass, **refuse**, pass, pass |

Production after apply: **104 migrations**, latest `20260917041724`. HUB24's twenty landing rows and their outcomes are byte-for-byte as they were.

### The first production run, and the first account placed

Run 45, 17 Sep 03:45 UTC, as `ingest_netwealth` through the Netwealth Ingest credential: **176 accounts landed in 4 minutes 12 seconds, 172 unmatched, 4 refused, 0 errors, 0 matched** — nothing was matched because no CRM account had Netwealth as its provider yet, which is the expected first state.

Clinton then linked account `0001141545` and re-ran. It landed complete:

| Field | Value |
| --- | --- |
| Label | Leonhard Heidelberger — Netwealth Super, seeded once, previous label kept in the note |
| Valuation | $189,296.57 **as at 16 September** — Netwealth's date |
| Cash | $10,316.96, dated 17 September |
| Product | netwealth Super Accelerator Plus, held apart from the name |
| Allocation | Five classes, including Alternative Investments folded to `other` and Property to `listed_property` |
| Group | Testlee Household |

## Deferred, named

* Mapping `adviser_login_id` to `staff_users`, so an unmatched account routes to its adviser the way an unmatched note routes to its host.
* A web screen for the unmatched queue and an MCP tool mirroring `list_unmatched_notes`.
* `opened_on` from `inception_date`, once the feed is trusted to set a date the adviser did not enter.
* **Mapping Netwealth's "International Unhedged"** to a CRM class. One sandbox account carries it; it could be equities or fixed interest, and until someone decides that account gets no allocation and says so.
* **Publishing both n8n workflows.** Neither has run on its schedule: HUB24 has one day of data from a manual run on 15 September, and Netwealth's 176 rows came from manual runs on the 17th. Publishing is a click in n8n and starts the 2am schedule.
* **Pointing Netwealth at the production endpoint.** The flow runs against the `api.nwbeta.com.au` sandbox with certificate verification off; both change together.
* The third platform, by the recipe above.
* `public.balance_side_of()` (from the assets and liabilities work) is executable by any role because it backs a generated column; it is a pure function of an enum and harmless, noted here so the next grants review does not rediscover it.

## Change history

| Date | Change |
| --- | --- |
| 15 Sep 2026 | Page created. HUB24 landing schema, promotion, role, allocations table, valuations provenance and audit changes designed, verified on a branch and applied to production. Two flaws found and fixed on the branch before production: unmatched rows were being stamped as promoted (now retried every run), and the daily cash refresh was producing an audit row per account per day (now excluded) |
| 15 Sep 2026, later | Network Restrictions dropped from the plan (n8n Cloud has no static egress); Enforce SSL and a daily landing check in its place. Credential set with a March 2027 expiry; n8n connected through the pooler with TLS on and certificate verification off (recorded as an accepted residual). The node became one Execute Query with the HUB24→column mapping in SQL. Migration 96: allocation weights may be negative, after the first real record showed `Other = −0.0228` |
| 15 Sep 2026, first real run | Twenty accounts landed cleanly, every field populated, all twenty payloads complete. Validation found HUB24 sends **ten** asset classes where migration 95 built eight. Migration 97 adds the two landing columns and backfills them from the raw allocations already stored, adds `direct_property` to the canonical set, seeds the status map from the observed vocabulary, and adds the unmapped-class tripwire. All four affected accounts now total exactly one; zero rows out of tolerance |
| 15 Sep 2026, second and third runs | The node SQL was updated to send all ten classes and the promotion node added. The feed now runs end to end: one account matched and placed within 400ms of landing, nineteen queued as unmatched. Migration 98 gives the account a `product_display_name` and lets the feed seed its `label` once, after `ProductOfferingDisplayName` was examined and rejected as a name — eleven accounts share one string and every closed account's contains the word ACTIVE |
| **17 Sep 2026** | **Netwealth, the second feed.** Party, registry row, landing table, asset-class map, role `ingest_netwealth`, unmatched view and `promote_netwealth()` — migration `20260917032521`. The CRM's own rules were lifted out of `promote_hub24()` into `apply_valuation()`, `apply_snapshot()` and `close_if_active()` so both feeds share one copy; proved unchanged for HUB24 by replaying thirteen landing rows through the old and the new functions and diffing every outcome, note, valuation, allocation and account field — zero differences |
| 17 Sep 2026, first real run | 176 sandbox accounts in 4m12s. The asset-class map had been seeded with one observed word and seventeen guesses; the run confirmed five, corrected two (`Alternative Investments` and `Multi Sector` — migration `20260917035317`) and found one still undecided (`International Unhedged`). Four accounts reported small negative balances and were refused |
| 17 Sep 2026, later | **Negative account values accepted, with a floor.** The HUB24-era rule that a negative value is garbage was wrong for a wrap account; migration `20260917041724` puts a single `value_is_plausible()` floor of −$100,000 in front of both feeds and resets the four refused rows. The investment mix ring was changed in the same breath to count and name the accounts it cannot draw. The first Netwealth account was then linked and landed complete |
