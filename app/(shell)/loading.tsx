/**
 * The instant loading state for every page under the shell.
 *
 * This file is what makes a tab click paint on the first frame instead of
 * after the server has finished. Two things about it are not obvious:
 *
 * **It covers tab clicks, not drill-ins.** A loading boundary is scoped to its
 * segment's direct child slot and is reset on every child segment (Next's
 * layout-router sets `parentLoadingData: null` on entering a child, and only a
 * segment with its own `loading` re-populates it). So this file shows when the
 * page segment changes — Home to Groups to Workflows — but NOT when a click
 * goes from `/groups` to `/groups/[id]`, which changes a key inside the
 * `groups` segment. Those drill-ins have their own `loading.tsx` beside them,
 * re-exporting this same skeleton: three files, one component.
 *
 * **It also gives prefetch something to fetch.** For a dynamic route, `<Link>`
 * prefetches "the partial route down to the nearest `loading.js` boundary".
 * With no boundary there was nothing to prefetch, so every click was cold.
 *
 * **The status-code trade.** Once a page streams behind this boundary the
 * headers have already gone out, so a signed-in visitor to a missing record now
 * gets a streamed 200 carrying the not-found UI (Next injects `noindex`). An
 * internal authenticated app can live with that; the anonymous 307 the e2e
 * suite asserts is unaffected, because the proxy answers before routing.
 *
 * A hard reload still waits on the shell layout, which reads cookies — that is
 * the documented limit of `loading.js` without Cache Components, and it is not
 * the complaint this fixes.
 */
export { PageSkeleton as default } from '@/components/page-skeleton'
