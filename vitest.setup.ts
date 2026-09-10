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

// jsdom implements the dialog element but not showModal/close — there is no top
// layer without a layout engine. The stub toggles the `open` attribute and fires
// `close`, which is enough for a component's own logic to be tested.
//
// What it deliberately does NOT reproduce is modality: focus trapping and an
// inert background come from the real top layer, so those are verified in the
// browser rather than here.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}

// jsdom's Range has no geometry: neither getClientRects nor
// getBoundingClientRect exists on it. ProseMirror asks a Range for both when
// it works out where the caret is — which the composer's @ and : menus do the
// moment they open. Empty rectangles are the honest answer from a runtime with
// no layout; the menus render against them, and where they land is a browser
// measurement, not a jsdom one.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = function getClientRects() {
    return [] as unknown as DOMRectList
  }
  Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return new DOMRect(0, 0, 0, 0)
  }
}

// jsdom leaves `window.matchMedia` as an ACCESSOR whose getter returns
// undefined — so `'matchMedia' in window` is `true` while
// `typeof window.matchMedia` is `'undefined'`. An `in` guard skips right past
// it (which it did, twice), and a plain assignment is not guaranteed against a
// property defined that way. Hence `typeof` to detect it and `defineProperty`
// to replace it. `window === globalThis` here, so one definition covers both.
//
// The stub reports **prefers-reduced-motion: reduce**, and that is a deliberate
// claim about this environment rather than a convenience. jsdom has no display
// and no animation clock: `requestAnimationFrame`-driven work does not
// progress, and a Recharts pie with its entry animation enabled renders **zero
// sectors** — measured, not assumed. Declaring "this runtime does not do
// motion" is both true and what makes the final geometry assertable.
//
// The cost is stated where it belongs: the animated path is exercised in a
// browser or not at all, exactly like contrast. A test that cares about the
// preference wiring overrides `matches` in both directions.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
