/**
 * A DETERMINISTIC stand-in for network latency, for the round-trip depth tests.
 *
 * ## Why this exists
 *
 * These tests measure a cost rather than a behaviour: how many Supabase round
 * trips a page makes **one after another**. A request from this application
 * costs ~170ms whatever it asks for, so page load is depth × 170ms and depth is
 * the number worth defending.
 *
 * The first three versions of this harness measured it with a clock — every
 * stubbed query slept a fixed 25ms, and depth was `elapsed / 25` rounded. That
 * works only while the assertion has slack. It had slack (`depth <= 5`) until
 * 10 September, when the group page reached two waves and the assertion was
 * tightened to exactly 2 — and **CI went red the next run** with "expected 3 to
 * be 2". Nothing had regressed: two waves is 50ms, so 13ms of scheduling jitter
 * on a loaded runner is enough to round to three. Reproduced locally by
 * shrinking the latency to 5ms, which amplifies the same jitter.
 *
 * A wall clock cannot measure this. A test that fails when the machine is busy
 * is not measuring the code, and the usual patch — a bigger sleep, a looser
 * bound — either makes the suite slower or blinds it to the regression it
 * exists to catch. A looser bound would not even have helped: jitter inflates
 * the reading, so `<= 2` fails exactly where `toBe(2)` does.
 *
 * ## What it does instead
 *
 * Nothing sleeps. A stubbed query returns a promise the harness holds, and the
 * harness releases them **one wave at a time**: everything already issued is
 * resolved together, the code under test runs on to issue whatever it awaits
 * next, and that becomes the next wave. **The number of waves it takes to
 * finish IS the round-trip depth** — exactly, by construction, on any machine
 * and under any load. It is also much faster: the group page's depth test spent
 * ~100ms sleeping and now spends none.
 *
 * `issuedIn` records the wave each table was FIRST read in, which is what
 * catches a loader chained onto another while the total stays the same — a
 * chain two deep hides under a floor that is already two deep. That was found
 * by mutation, and it is only meaningful for a table ONE loader reads.
 */
export type Harness = {
  /** Call this from a stubbed query. The label is the table name. */
  wait: (label: string) => Promise<void>
  /** Tables read, in issue order, including repeats. */
  calls: string[]
  /** Table name → the wave it was first read in, counting from 0. */
  issuedIn: Record<string, number>
  /** Run `start` to completion, releasing one wave at a time. */
  measure: <T>(start: () => Promise<T>) => Promise<Measured<T>>
}

export type Measured<T> = {
  /** What `start` resolved to, or undefined if it rejected. */
  value: T | undefined
  /** What `start` rejected with, or undefined if it resolved. */
  error: unknown
  /** Sequential round trips: the whole point. */
  depth: number
}

/**
 * Hand control back to the event loop so every microtask queued by the wave we
 * just released can run and issue whatever it awaits next.
 *
 * One macrotask turn drains all pending microtasks, which covers `await` chains
 * inside a loader. Three turns is cheap insurance for a loader that awaits
 * something timer-based between queries; the loop below stops as soon as no
 * query is outstanding, so extra turns cost nothing when they are not needed.
 */
const yieldToLoop = async () => {
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }
}

/** Guards against a hang if the code under test awaits something we never see. */
const MAX_WAVES = 50

export function createRoundTripHarness(): Harness {
  const calls: string[] = []
  const issuedIn: Record<string, number> = {}
  let wave = 0
  let pending: Array<() => void> = []

  const wait = (label: string) =>
    new Promise<void>((resolve) => {
      calls.push(label)
      issuedIn[label] = Math.min(issuedIn[label] ?? Number.POSITIVE_INFINITY, wave)
      pending.push(resolve)
    })

  async function measure<T>(start: () => Promise<T>): Promise<Measured<T>> {
    calls.length = 0
    for (const key of Object.keys(issuedIn)) delete issuedIn[key]
    wave = 0
    pending = []

    let settled = false
    let value: T | undefined
    let error: unknown
    const running = start().then(
      (v) => {
        value = v
        settled = true
      },
      (e) => {
        error = e
        settled = true
      },
    )

    let depth = 0
    await yieldToLoop()
    while (!settled && pending.length > 0) {
      const batch = pending
      pending = []
      depth += 1
      /* Anything issued from here on belongs to the NEXT wave, so `issuedIn`
         is stamped with the wave a query was actually issued in. */
      wave = depth
      for (const release of batch) release()
      await yieldToLoop()
      if (depth >= MAX_WAVES) {
        throw new Error(`still issuing queries after ${MAX_WAVES} waves — is a loader looping?`)
      }
    }
    await running

    if (!settled) {
      throw new Error(
        'the code under test never settled and issued no further queries — it is awaiting something this harness does not stub',
      )
    }
    return { value, error, depth }
  }

  return { wait, calls, issuedIn, measure }
}
