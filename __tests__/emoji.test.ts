import { describe, expect, test } from 'vitest'
import { EMOJI, searchEmoji } from '@/lib/emoji'
import { REACTIONS, isReactionKey, toggleReaction, type PostReaction } from '@/lib/workflow-board'

/**
 * The `:` picker inserts a character, so all that is under test is which
 * characters it offers for what was typed — and that the list itself is sound.
 */
describe('searchEmoji', () => {
  test('a name prefix comes first, then a keyword prefix, then anything containing it', () => {
    const glyphs = searchEmoji('thu').map((e) => e.glyph)
    expect(glyphs[0]).toBe('👍') // thumbs_up
    expect(glyphs[1]).toBe('👎') // thumbs_down
  })

  test('keywords find what a name would not: yes, done, call', () => {
    expect(searchEmoji('yes').map((e) => e.glyph)).toContain('👍')
    expect(searchEmoji('done').map((e) => e.glyph)).toContain('✅')
    expect(searchEmoji('call').map((e) => e.glyph)).toContain('📞')
  })

  test('the leading colon, case and spaces are forgiven', () => {
    expect(searchEmoji(':Thumbs Up')[0].glyph).toBe('👍')
    expect(searchEmoji('+1')[0].glyph).toBe('👍')
  })

  test('nothing typed is nothing offered — the picker does not open on a bare colon', () => {
    expect(searchEmoji('')).toEqual([])
    expect(searchEmoji(':')).toEqual([])
    expect(searchEmoji('   ')).toEqual([])
  })

  test('at most the limit, and no match is an empty list rather than everything', () => {
    expect(searchEmoji('a').length).toBeLessThanOrEqual(8)
    expect(searchEmoji('a', 3).length).toBe(3)
    expect(searchEmoji('zzzzqq')).toEqual([])
  })

  test('every name is unique and every entry has a glyph', () => {
    const names = EMOJI.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
    for (const e of EMOJI) expect(e.glyph.length).toBeGreaterThan(0)
  })
})

/**
 * Reactions are a closed set, and the optimistic toggle must produce what the
 * view will say after the round trip — so the provisional and the real render
 * the same.
 */
describe('reactions', () => {
  const me = { staff_id: 'me', full_name: 'Me' }
  const other = { staff_id: 'o', full_name: 'Other' }

  test('the six keys, and nothing else, are reactions', () => {
    expect(REACTIONS.map((r) => r.key)).toEqual(['thumbs_up', 'tick', 'eyes', 'party', 'heart', 'thanks'])
    for (const r of REACTIONS) expect(isReactionKey(r.key)).toBe(true)
    expect(isReactionKey('poop')).toBe(false)
    expect(isReactionKey('👍')).toBe(false)
    expect(isReactionKey(null)).toBe(false)
  })

  test('adding a kind nobody has given puts it on the end', () => {
    const before: PostReaction[] = [{ reaction: 'thumbs_up', by: [other] }]
    expect(toggleReaction(before, 'heart', me)).toEqual([
      { reaction: 'thumbs_up', by: [other] },
      { reaction: 'heart', by: [me] },
    ])
  })

  test('joining a kind others have given adds me after them; leaving it takes only me off', () => {
    const before: PostReaction[] = [{ reaction: 'thumbs_up', by: [other] }]
    const joined = toggleReaction(before, 'thumbs_up', me)
    expect(joined).toEqual([{ reaction: 'thumbs_up', by: [other, me] }])
    expect(toggleReaction(joined, 'thumbs_up', me)).toEqual(before)
  })

  test('taking away the last of a kind removes the kind', () => {
    expect(toggleReaction([{ reaction: 'eyes', by: [me] }], 'eyes', me)).toEqual([])
  })

  test('does not mutate what it was given', () => {
    const before: PostReaction[] = [{ reaction: 'thumbs_up', by: [other] }]
    const copy = JSON.parse(JSON.stringify(before))
    toggleReaction(before, 'thumbs_up', me)
    expect(before).toEqual(copy)
  })
})
