import Link from 'next/link'
import { Card, PageHeading } from '@/components/ui'

export const metadata = { title: 'Help · Q Wealth CRM' }

/*
 * Reached from the "?" in the top bar, which pointed here before the route
 * existed — so every authenticated page prefetched a 404, and clicking it gave
 * one. A stub is enough to close that; the content below is what a new staff
 * member actually needs on their first day.
 */
export default function HelpPage() {
  return (
    <>
      <PageHeading
        eyebrow="Help"
        title="Help"
        description="How this system is put together, and who to ask when something looks wrong."
      />

      <Card className="col-span-full lg:col-span-6" title="Getting started">
        <dl className="flex flex-col gap-3">
          <div>
            <dt className="text-xs text-neutral-500">Two-factor authentication</dt>
            <dd className="mt-0.5 text-sm text-neutral-700">
              Required for everyone, with no exceptions and no way to skip it. If you have lost
              your authenticator, ask for your factor to be reset — it cannot be recovered from
              this end.
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">What you can see</dt>
            <dd className="mt-0.5 text-sm text-neutral-700">
              Your access profile decides which client groups appear. Seeing fewer groups than a
              colleague is the system working, not a fault. Your current profile is shown on your{' '}
              <Link
                href="/profile"
                className="text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
              >
                profile page
              </Link>
              .
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Hidden identifiers</dt>
            <dd className="mt-0.5 text-sm text-neutral-700">
              Tax file numbers and similar identifiers show as dots with an eye icon beside them.
              Revealing one is recorded against your name, and the value hides itself again after
              thirty seconds.
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="col-span-full lg:col-span-6" title="If something looks wrong">
        <p className="text-sm text-neutral-700">
          Client records are audited on every change, so a mistake can always be traced and
          corrected — please report it rather than working around it.
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-neutral-700">
          <li className="flex gap-2">
            <span aria-hidden className="select-none text-neutral-300">
              &middot;
            </span>
            <span>
              A record you expected to see is missing, or one you did not expect is visible — this
              is an access question, not a data one.
            </span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="select-none text-neutral-300">
              &middot;
            </span>
            <span>A valuation or benefit amount does not match the provider statement.</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="select-none text-neutral-300">
              &middot;
            </span>
            <span>A save appears to succeed but the change is not there afterwards.</span>
          </li>
        </ul>
        <p className="mt-4 text-sm text-neutral-500">
          Written procedures live in Confluence. This page is a stub — tell us what you came here
          looking for and it will be added.
        </p>
      </Card>
    </>
  )
}
