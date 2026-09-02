import { createHmac } from 'node:crypto'

/**
 * RFC 6238 TOTP, so the end-to-end suite can complete the MFA step-up that now
 * gates every authenticated route.
 *
 * Implemented here rather than pulled from a package: it is fifteen lines, and a
 * dependency that generates authentication codes is a dependency worth not
 * having.
 */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const idx = alphabet.indexOf(char)
    if (idx === -1) throw new Error(`Not base32: ${char}`)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function totp(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeBigInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32Decode(secret)).update(buf).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = digest.readUInt32BE(offset) & 0x7fffffff
  return (binary % 1_000_000).toString().padStart(6, '0')
}

/**
 * A code that will still be valid when it arrives.
 *
 * A code generated in the last second or two of its window can expire between
 * being typed and being checked, which shows up as a flaky test rather than as
 * the timing problem it is. If the window is nearly over, wait for the next one.
 */
export async function freshTotp(secret: string): Promise<string> {
  const secondsIntoWindow = Math.floor(Date.now() / 1000) % 30
  if (secondsIntoWindow > 25) {
    await new Promise((r) => setTimeout(r, (31 - secondsIntoWindow) * 1000))
  }
  return totp(secret)
}
