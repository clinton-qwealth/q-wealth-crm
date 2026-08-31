/**
 * Read a required public environment variable, failing with a message that says
 * what is missing and where to set it.
 *
 * Without this, an unset variable surfaces as Supabase's "Your project's URL and
 * Key are required to create a Supabase client!" on every route — a 500 with no
 * indication that the cause is deployment configuration. That cost real time on
 * the first production deploy.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so setting them in the hosting
 * platform is not enough on its own: the app must be rebuilt afterwards.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. ` +
        `Set it in .env.local for local development, or in your hosting platform's ` +
        `environment variables for a deployment — then rebuild, because ` +
        `NEXT_PUBLIC_* values are inlined at build time.`
    )
  }
  return value
}

export const SUPABASE_URL = () =>
  required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL)

export const SUPABASE_PUBLISHABLE_KEY = () =>
  required(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
