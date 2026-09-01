import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only auto-cleans when Vitest runs with `globals: true`. This
// project imports its test helpers explicitly instead, so unmounting between
// tests has to be wired up here. Without it, `screen` queries search every
// container rendered so far and a second render makes matches ambiguous.
afterEach(cleanup)

// jsdom implements no layout engine, so it ships no ResizeObserver. Components
// that re-measure on resize (the tabs indicator) construct one on mount and
// would throw. A stub that never fires is the honest substitute: jsdom reports
// every element as 0x0 and nothing ever resizes, so there is no callback to
// deliver. Tests that care about measurement have to assert the unmeasured
// state, which is the real first-paint case anyway.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
