/**
 * The loading state for the drill-in from the board to a workflow's page.
 *
 * A board card's name links to `/workflows/[id]`, which changes a key INSIDE
 * the `workflows` segment — beyond the reach of the shell-level boundary, which
 * is scoped to its own direct child slot. This file is what makes that click
 * paint immediately. See `app/(shell)/loading.tsx` for the mechanism and the
 * status-code trade.
 */
export { PageSkeleton as default } from '@/components/page-skeleton'
