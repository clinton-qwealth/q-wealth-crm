# Security

This project follows **OWASP Top 10 (2021)** for classifying risk and targets
**OWASP ASVS 4.0 Level 2** for control depth.

The standard itself — the scope, the mapping of each Top 10 category to the
controls that address it, the record of reviews performed, and an explicit list
of what is *not* claimed — is **_Q Wealth CRM — Secure Development Standard_**
in Confluence, under Technology Documentation. That page is the auditable
artefact; this file is the operative part, kept next to the code that has to
obey it.

## Reporting a vulnerability

Report it to the Responsible Manager directly. **Do not open a public issue or
a pull request that describes it.** If it involves personal information, the
_Breach and Incident Management Policy_ applies and its timeframes start when
the firm becomes aware — which is when you report it, not when it is fixed.

## Before you merge

All five must pass, locally and in CI. There is no partial gate.

```
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
npx playwright test
```

## Rules a change must not break

A reviewer can check these without understanding the feature.

1. **No SQL built by string concatenation.** Values reach Postgres as bound
   parameters — RPC arguments, or `$1` placeholders. This applies to the n8n
   workflows too: interpolating a value into SQL text there is the same defect
   it is here, and it is how the Confluence feed was found to be injectable in
   September 2026.
2. **No `dangerouslySetInnerHTML`, and nothing equivalent.** Content is
   rendered as elements. The count in this repository is zero. Keep it there.
3. **Every new table gets RLS enabled and a policy**, and the migration proves
   it. RLS is the authorisation boundary; an application check is not.
4. **Every new `SECURITY DEFINER` function sets `search_path` explicitly**, and
   states its execute grant rather than inheriting one.
5. **Every new entry point re-checks the session and `aal2` for itself.** A
   route handler does not inherit a page's protections, and `proxy.ts` says in
   its own header that it is not the boundary.
6. **A redirect target that came from a request goes through `safeNext()`**;
   a link target rendered from stored content goes through `safeHref()`.
7. **No secret in the repository**, in `.env.local`, or in any `NEXT_PUBLIC_`
   variable — those are inlined into browser JavaScript by design.
8. **The service-role key is not used anywhere, for anything.** It bypasses
   every RLS policy, so holding it is equivalent to holding every client record.
9. **A new outbound host is a deliberate decision.** Add it to `lib/csp.ts`,
   and never take one from user input.

After a schema change, run the Supabase security and performance advisors and
triage anything new before calling the change done.

## Writing a security test

A test that passes whether or not the control exists is worse than no test,
because it manufactures confidence. Pair every security assertion with the edit
it exists to catch, then **actually apply that edit and watch the test fail**.

Two that failed this bar during the September 2026 review, kept here because
both are easy to repeat:

- A test filled the login form and asserted the value came back, meaning to
  prove the CSP admitted the app's scripts. It passes with every script on the
  page blocked — typing into an `<input>` needs no JavaScript.
- Three mutation runs "passed" against code that no longer existed, because
  Playwright's `reuseExistingServer` had served a stale build. A mutation test
  that touches server behaviour must run with `CI=1` or kill port 3000 first.

> The numbered rules above are mirrored in section 6 of the Confluence page, so
> that an auditor reading the standard sees the same list. Change both.
