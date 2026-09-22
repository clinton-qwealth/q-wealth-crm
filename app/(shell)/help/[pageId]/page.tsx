import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Markdown } from '@/components/markdown'
import { Card, PageHeading } from '@/components/ui'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/*
 * The reader: one policy or procedure, from the copy in kb_documents.
 *
 * Inside the CRM rather than a link out to Confluence, for three reasons a
 * search result cares about: it works when Confluence is down, it sits behind
 * the same sign-in and second-factor gate as everything else here, and it is
 * the only way a result can land on the heading it matched — the chunker's
 * `anchor` is the id the Markdown component gives the heading.
 *
 * The version and sync time are on the page so a stale copy is visible rather
 * than silent. A retired page (absent from the last sync) still opens, marked
 * as such, because a recorded answer may cite it.
 */
export default async function KnowledgeBasePage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params
  const supabase = await createSupabaseServerClient({ writable: false })
  const { data } = await supabase
    .from('kb_documents')
    .select('confluence_page_id, title, section, url, version, body_md, excluded, retired_at, retired_reason, synced_at')
    .eq('confluence_page_id', pageId)
    .maybeSingle()
  if (!data) notFound()

  const doc = data as {
    confluence_page_id: string
    title: string
    section: string
    url: string
    version: number
    body_md: string
    excluded: boolean
    retired_at: string | null
    retired_reason: string | null
    synced_at: string
  }
  const synced = new Date(doc.synced_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <>
      <PageHeading
        eyebrow={doc.section}
        title={doc.title}
        description={`Version ${doc.version} · synced ${synced}`}
        actions={
          <div className="flex items-center gap-3 text-xs">
            <Link href="/help" className="text-neutral-500 hover:text-neutral-800">
              ← All policies
            </Link>
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand"
            >
              Open in Confluence
            </a>
          </div>
        }
      />

      {doc.retired_at ? (
        <div
          data-slot="kb-retired"
          className="col-span-full rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          This page was retired on {new Date(doc.retired_at).toLocaleDateString('en-AU', { dateStyle: 'medium' })}
          {doc.retired_reason ? ` — ${doc.retired_reason.toLowerCase()}` : ''}. It is kept because an answer may have cited it;
          it is no longer searched.
        </div>
      ) : null}

      <Card className="col-span-full lg:col-span-8" padding="roomy">
        <Markdown source={doc.body_md} />
      </Card>
    </>
  )
}
