import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * `signUpForAccess` and `requestStaffAccess` — the two actions on the way in.
 *
 * Thin, and the thinness is the point: neither holds a secret, neither decides
 * anything the database does not decide again. What is worth pinning is that
 * sign-up forwards the name as metadata (so the request form can be
 * prefilled), that it says the same thing whether or not the address exists,
 * that the request goes to the one RPC and its sentence comes back verbatim,
 * and that `next` is constrained to this site.
 */
const log: { call: string; args: unknown[] }[] = []
let signUpError: string | null = null
let rpcError: string | null = null

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signUp: async (args: unknown) => {
        log.push({ call: 'signUp', args: [args] })
        return { data: {}, error: signUpError ? { message: signUpError } : null }
      },
    },
    rpc: async (name: string, args: unknown) => {
      log.push({ call: `rpc:${name}`, args: [args] })
      return { data: 's9', error: rpcError ? { message: rpcError } : null }
    },
  }),
}))

const { requestStaffAccess, signUpForAccess } = await import('@/app/request-access/actions')

const form = (entries: Record<string, string>) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  log.length = 0
  signUpError = null
  rpcError = null
})

describe('signUpForAccess', () => {
  test('creates the account with the name as metadata, email lowercased', async () => {
    const r = await signUpForAccess(
      null,
      form({ first_name: ' Nina ', last_name: ' New ', email: 'Nina@QWealth.com.au', password: 'a-long-enough-password' }),
    )
    expect(r && 'ok' in r).toBe(true)
    expect(log).toEqual([
      {
        call: 'signUp',
        args: [
          {
            email: 'nina@qwealth.com.au',
            password: 'a-long-enough-password',
            options: { data: { first_name: 'Nina', last_name: 'New' } },
          },
        ],
      },
    ])
    expect(r && 'message' in r ? r.message : '').toContain('nina@qwealth.com.au')
  })

  test('a short password never reaches Auth', async () => {
    const r = await signUpForAccess(null, form({ first_name: 'N', last_name: 'N', email: 'n@qwealth.com.au', password: 'short' }))
    expect(r).toEqual({ error: 'Use a password of at least 12 characters.' })
    expect(log).toEqual([])
  })

  test('a missing field never reaches Auth — either half of the name counts', async () => {
    const missing: Record<string, string>[] = [{}, { first_name: 'N' }, { last_name: 'N' }]
    for (const fields of missing) {
      const r = await signUpForAccess(null, form({ ...fields, email: 'n@qwealth.com.au', password: 'a-long-enough-password' }))
      expect(r && 'error' in r).toBe(true)
    }
    expect(log).toEqual([])
  })

  test('Auth’s own refusal comes back as it was said', async () => {
    signUpError = 'Signups not allowed for this instance'
    const r = await signUpForAccess(null, form({ first_name: 'N', last_name: 'N', email: 'n@qwealth.com.au', password: 'a-long-enough-password' }))
    expect(r).toEqual({ error: 'Signups not allowed for this instance' })
  })
})

describe('requestStaffAccess', () => {
  test('asks the database, then returns to the request page', async () => {
    await expect(requestStaffAccess(null, form({ first_name: ' Nina ', last_name: ' New ' }))).rejects.toThrow('redirect:/request-access')
    expect(log).toEqual([{ call: 'rpc:request_staff_access', args: [{ p_first_name: 'Nina', p_last_name: 'New' }] }])
  })

  test('goes back where the person came from when that is on this site, and nowhere else', async () => {
    await expect(requestStaffAccess(null, form({ first_name: 'N', last_name: 'N', next: '/oauth/consent?authorization_id=a' }))).rejects.toThrow(
      'redirect:/oauth/consent?authorization_id=a',
    )
    await expect(requestStaffAccess(null, form({ first_name: 'N', last_name: 'N', next: 'https://evil.example/' }))).rejects.toThrow('redirect:/request-access')
    await expect(requestStaffAccess(null, form({ first_name: 'N', last_name: 'N', next: '//evil.example' }))).rejects.toThrow('redirect:/request-access')
  })

  test('the database’s sentence is the answer', async () => {
    rpcError = 'Access requests are limited to Q Wealth staff email addresses'
    const r = await requestStaffAccess(null, form({ first_name: 'N', last_name: 'N' }))
    expect(r).toEqual({ error: 'Access requests are limited to Q Wealth staff email addresses' })
  })

  test('a blank name never reaches the database — either half counts', async () => {
    for (const fields of [{ first_name: '   ', last_name: 'New' }, { first_name: 'Nina', last_name: '  ' }]) {
      expect(await requestStaffAccess(null, form(fields))).toEqual({ error: 'Enter your first and last name.' })
    }
    expect(log).toEqual([])
  })
})
