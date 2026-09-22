'use server'

import { revalidatePath } from 'next/cache'
import { handoffCitations, type KbPassage } from '@/lib/kb'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Record that a policy question was taken to Claude.
 *
 * Written as the caller through `kb_record_handoff`, so the same append-only
 * policies apply as to anything else a staff member writes, and one RPC keeps
 * the conversation, the question, the marker and the passages in one
 * transaction — the lesson `add_note` taught in August.
 *
 * **The hand-off does not wait for this, and must not.** The button is a real
 * link: the browser follows it natively, and this runs beside it. If the
 * record fails, the person still gets their answer and the screen says the
 * question was not recorded — the alternative is a popup blocker eating the
 * hand-off because the navigation came after an await.
 */
export async function recordHandoff(
  question: string,
  passages: KbPassage[],
): Promise<{ error?: string }> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('kb_record_handoff', {
    p_question: question,
    p_passages: handoffCitations(passages),
  })
  if (error) {
    return { error: error.message.replace(/^[^:]*: /, '') }
  }
  /* The "Your questions" list on this page has just gained a row. */
  revalidatePath('/help')
  return {}
}
