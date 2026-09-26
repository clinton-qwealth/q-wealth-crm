'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { BuildingIcon, ChevronDownIcon, SearchIcon } from '@/components/icons'
import { SHEET, TOOLBAR_CONTROL } from '@/components/ui'
import { providerLogoUrl } from '@/lib/provider-logo'
import type { ProviderRegisterRow } from '@/lib/groups'


type ProviderSortId = 'name_asc' | 'name_desc' | 'newest'
type ProviderTypeId = 'all' | 'platform' | 'insurer'

/** What each derived kind is called on the row and in the filter. */
const KIND_LABEL: Record<'account' | 'policy', string> = {
  account: 'Platform',
  policy: 'Insurer',
}
const TYPE_OF_KIND: Record<'account' | 'policy', Exclude<ProviderTypeId, 'all'>> = {
  account: 'platform',
  policy: 'insurer',
}

/**
 * The provider register: the same toolbar as the client registers — asked for
 * 26 Sep — over the firm's providers, and the rows are LINKS now, because
 * `/groups/providers/[partyId]` finally exists. The search's "goes nowhere
 * useful" era is over.
 *
 * No status filter, deliberately: the loader serves active roles only, so a
 * status control would offer one answer. The day ended providers are listed
 * too, the filter arrives with them.
 */
export function ProviderRegister({
  providers,
  action,
  empty,
}: {
  providers: ProviderRegisterRow[]
  action?: ReactNode
  empty: { title: string; body: string; action?: ReactNode }
}) {
  const [q, setQ] = useState('')
  const [type, setType] = useState<ProviderTypeId>('all')
  const [sort, setSort] = useState<ProviderSortId>('name_asc')

  /* Offered only when present in the rows — the statusesOf rule: a filter
     whose every answer is empty is a control that lies about the data. */
  const typesPresent = (['platform', 'insurer'] as const).filter((t) =>
    providers.some((p) => p.kinds.some((k) => TYPE_OF_KIND[k] === t)),
  )

  const needle = q.trim().toLowerCase()
  const visible = [...providers]
    .filter((p) => !needle || p.name.toLowerCase().includes(needle))
    .filter((p) => type === 'all' || p.kinds.some((k) => TYPE_OF_KIND[k] === type))
    .sort((a, b) =>
      sort === 'name_asc'
        ? a.name.localeCompare(b.name)
        : sort === 'name_desc'
          ? b.name.localeCompare(a.name)
          : /* newest: most recent start first; a provider with no date sorts
               last — unknown is older than any known start, not newer. */
            (b.since ?? '').localeCompare(a.since ?? '') || a.name.localeCompare(b.name),
    )

  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-6 py-10">
        <p className="text-center text-sm font-medium text-neutral-700">{empty.title}</p>
        <p className="mt-1 max-w-sm text-center text-xs leading-relaxed text-neutral-500">{empty.body}</p>
        {empty.action ? <div className="mt-4">{empty.action}</div> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative w-52">
          <span className="sr-only">Search providers</span>
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className={`${TOOLBAR_CONTROL} w-full pl-7`}
          />
        </label>

        {/* The TYPE is the derived kind — what the firm holds with them — so
            the filter can never disagree with the rows' own second lines,
            which read from the same derivation. */}
        <label className="flex items-center gap-1.5">
          <span className="sr-only">Filter by type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ProviderTypeId)}
            className={TOOLBAR_CONTROL}
          >
            <option value="all">Type</option>
            {typesPresent.map((t) => (
              <option key={t} value={t}>
                {t === 'platform' ? 'Platform' : 'Insurer'}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="sr-only">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as ProviderSortId)}
            className={TOOLBAR_CONTROL}
          >
            <option value="name_asc">Name A–Z</option>
            <option value="name_desc">Name Z–A</option>
            <option value="newest">Newest</option>
          </select>
        </label>

        {action ? <span className="ml-auto">{action}</span> : null}
      </div>

      {visible.length > 0 ? (
        <>
          <div className={SHEET}>
            <ul className="divide-y divide-neutral-200/80">
              {visible.map((p) => (
                <li key={p.party_id}>
                  <Link
                    href={`/groups/providers/${p.party_id}`}
                    className="flex items-center gap-3 px-3.5 py-3 outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30"
                  >
                    {p.logo_path ? (
                      /* Plain img: the route 302s to a signed URL, which
                         next/image cannot optimise through. */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={providerLogoUrl(p.party_id, p.logo_path)}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-neutral-200"
                      />
                    ) : (
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200"
                        aria-hidden="true"
                      >
                        <BuildingIcon className="h-[18px] w-[18px]" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-neutral-900">{p.name}</span>
                      {/* The KINDS lead the line — the same derivation the page's
                          Provides field reads, so filter, row and record agree. */}
                      <span className="mt-0.5 block truncate text-xs text-neutral-500">
                        {[
                          p.kinds.map((k) => KIND_LABEL[k]).join(' · ') || 'Provider',
                          p.since ? `since ${p.since.slice(0, 4)}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <ChevronDownIcon className="h-4 w-4 shrink-0 -rotate-90 text-neutral-300" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 px-6 py-8">
          <p className="text-center text-sm text-neutral-600">
            Nothing matches{needle ? ` “${q.trim()}”` : ' these filters'}.
          </p>
          <button
            type="button"
            onClick={() => {
              setQ('')
              setType('all')
            }}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-white"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  )
}
