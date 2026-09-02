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
