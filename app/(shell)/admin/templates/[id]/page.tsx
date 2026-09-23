import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { TemplateEditor } from '@/components/template-editor'
import { PageHeading } from '@/components/ui'
import { getTemplate, isAdmin } from '@/lib/admin'
import { getCurrentStaff } from '@/lib/staff'

export const metadata = { title: 'Workflow template · Q Wealth CRM' }

/**
 * One workflow template, open for editing.
 *
 * The gate runs BEFORE any query, as /admin's does, so a visitor who may not be
 * here spends no round trip and gets a not-found — a route you may not use is
 * indistinguishable from one that does not exist.
 *
 * ONE read. `getTemplate` pulls the roles, the tasks and the dependency edges
 * as embeds from a single row, so this page is depth 1 like every other. It is
 * a route rather than a drawer on /admin for two reasons: a fifteen-task editor
 * does not fit a drawer, and a drawer would put this read on the admin page's
 * wave, which every administrator pays for whether or not they open it.
 */
export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/login')
  if (!isAdmin(staff)) notFound()

  const { id } = await params
  const template = await getTemplate(id)
  if (!template) notFound()

  return (
    <>
      <PageHeading
        eyebrow="Workflow template"
        title={template.name}
        description={template.description ?? undefined}
        actions={
          <Link href="/admin" className="text-xs text-neutral-500 hover:text-neutral-800">
            ← All templates
          </Link>
        }
      />
      <TemplateEditor template={template} />
    </>
  )
}
