import { describe, expect, test } from 'vitest'
import {
  addDays,
  blockingNeighbour,
  legalPositions,
  previewSchedule,
  reordered,
  taskDepths,
  templateIssues,
  todayInSydney,
  type TemplateDetail,
  type TemplateTask,
} from '@/lib/templates'

/**
 * The rules behind the template editor, tested with nothing rendered.
 *
 * What a plausible implementation gets wrong, and what each block below is
 * therefore pinned against: a move that silently drops the dependency it broke;
 * a preview that prints a confident waterfall of dates the database will not
 * produce; a date built with `new Date('2026-10-01')`, which is midnight UTC and
 * prints as the previous day in Sydney.
 */
const task = (over: Partial<TemplateTask> & { id: string; ordinal: number }): TemplateTask => ({
  subject: `Task ${over.id}`,
  description: null,
  priority: 'medium',
  role_id: 'r1',
  role_name: 'Adviser',
  due_offset_days: 0,
  depends_on: [],
  ...over,
})

/** A → B → C, plus D which waits for nothing. */
const CHAIN: TemplateTask[] = [
  task({ id: 'a', ordinal: 0, subject: 'Book the meeting' }),
  task({ id: 'b', ordinal: 1, subject: 'Collect the authority', depends_on: ['a'] }),
  task({ id: 'c', ordinal: 2, subject: 'Issue the advice', depends_on: ['b'] }),
  task({ id: 'd', ordinal: 3, subject: 'Send the welcome pack' }),
]

describe('taskDepths', () => {
  test('a chain reads as a staircase and an independent task stays at the top', () => {
    const depth = taskDepths(CHAIN)
    expect([depth.get('a'), depth.get('b'), depth.get('c'), depth.get('d')]).toEqual([0, 1, 2, 0])
  })

  test('a task waiting on two takes the deeper of them', () => {
    const tasks = [
      task({ id: 'a', ordinal: 0 }),
      task({ id: 'b', ordinal: 1, depends_on: ['a'] }),
      task({ id: 'c', ordinal: 2, depends_on: ['a', 'b'] }),
    ]
    expect(taskDepths(tasks).get('c')).toBe(2)
  })

  /** Mutation: resolve depths by recursion without the ordinal sort → a
   *  reference to a task not yet seen is undefined and the depth is wrong. */
  test('order of the input does not matter', () => {
    const shuffled = [CHAIN[2], CHAIN[0], CHAIN[3], CHAIN[1]]
    expect(taskDepths(shuffled).get('c')).toBe(2)
  })
})

describe('legalPositions', () => {
  test('a task cannot rise above what it waits for', () => {
    expect(legalPositions(CHAIN, 'b')).toEqual([1, 1])
  })

  test('a task cannot sink below what waits for it', () => {
    expect(legalPositions(CHAIN, 'a')).toEqual([0, 0])
  })

  test('a task nothing touches may go anywhere', () => {
    expect(legalPositions(CHAIN, 'd')).toEqual([0, 3])
  })

  /** A wedged task has exactly one legal position — where it already is — and
   *  the range must never come back inverted, which would disable both buttons
   *  AND read as "no legal move" to the Move-to menu. */
  test('the range is never empty', () => {
    const [first, last] = legalPositions(CHAIN, 'b')
    expect(last).toBeGreaterThanOrEqual(first)
  })
})

describe('blockingNeighbour', () => {
  test('names the prerequisite standing in the way of moving up', () => {
    expect(blockingNeighbour(CHAIN, 'b', 0)).toEqual({
      subject: 'Book the meeting',
      reason: 'waits-for',
    })
  })

  test('names the dependent standing in the way of moving down', () => {
    expect(blockingNeighbour(CHAIN, 'b', 2)).toEqual({
      subject: 'Issue the advice',
      reason: 'waited-on',
    })
  })

  test('a legal move has nothing in the way', () => {
    expect(blockingNeighbour(CHAIN, 'd', 0)).toBeNull()
  })
})

describe('reordered', () => {
  test('moving a free task to the front rewrites the whole list', () => {
    expect(reordered(CHAIN, 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  /**
   * An illegal target is clamped into the legal range rather than applied.
   * Mutation: splice to the requested index without clamping → 'b' lands above
   * 'a', and the database refuses the whole save at commit with a message about
   * a constraint.
   */
  test('an illegal target is clamped, so the order stays valid', () => {
    expect(reordered(CHAIN, 'b', 0)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('every task appears exactly once, which is what the RPC demands', () => {
    const ids = reordered(CHAIN, 'd', 1)
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('templateIssues', () => {
  const detail = (over: Partial<TemplateDetail>): TemplateDetail => ({
    id: 't1',
    name: 'Onboarding',
    description: null,
    status: 'draft',
    workflow_type: null,
    task_count: 0,
    role_count: 0,
    deployment_count: 0,
    published_at: null,
    roles: [],
    tasks: [],
    ...over,
  })

  test('an empty template cannot be published', () => {
    expect(templateIssues(detail({})).map((i) => i.message)).toEqual(['Add at least one task.'])
  })

  /** A role nobody uses is a question the deployer answers for nothing, and the
   *  database refuses to publish for the same reason. */
  test('a role no task uses is a blocker, not a warning', () => {
    const issues = templateIssues(
      detail({
        tasks: [task({ id: 'a', ordinal: 0 })],
        roles: [
          { id: 'r1', name: 'Adviser', task_count: 1 },
          { id: 'r2', name: 'Paraplanner', task_count: 0 },
        ],
      }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('Paraplanner')
  })

  test('a complete template has nothing to fix', () => {
    expect(
      templateIssues(
        detail({ tasks: [task({ id: 'a', ordinal: 0 })], roles: [{ id: 'r1', name: 'Adviser', task_count: 1 }] }),
      ),
    ).toEqual([])
  })
})

describe('previewSchedule', () => {
  const template = {
    roles: [{ id: 'r1', name: 'Adviser' }],
    tasks: [
      { id: 'a', subject: 'Book the meeting', role_id: 'r1', due_offset_days: 1, depends_on: [] },
      { id: 'b', subject: 'Collect the authority', role_id: 'r1', due_offset_days: 3, depends_on: ['a'] },
      { id: 'c', subject: 'Issue the advice', role_id: 'r1', due_offset_days: 5, depends_on: ['b'] },
    ],
  }

  /**
   * THE WHOLE POINT. A dependent task has no due date until the thing it waits
   * for is done, so the preview shows the absence. Mutation: compute a
   * cumulative waterfall from the start date — the obvious implementation —
   * and every row gets a confident date the database will never write.
   */
  test('only a task that waits for nothing carries a date', () => {
    const rows = previewSchedule(template, '2026-10-01')
    expect(rows.map((r) => r.dueOn)).toEqual(['2026-10-02', null, null])
  })

  test('a waiting task names what it is waiting for instead', () => {
    const rows = previewSchedule(template, '2026-10-01')
    expect(rows[1].after).toBe('Book the meeting')
    expect(rows[2].after).toBe('Collect the authority')
    expect(rows[0].after).toBeNull()
  })

  test('each row carries the person who will own it', () => {
    expect(previewSchedule(template, '2026-10-01').map((r) => r.roleName)).toEqual([
      'Adviser',
      'Adviser',
      'Adviser',
    ])
  })
})

describe('addDays', () => {
  test('adds calendar days', () => {
    expect(addDays('2026-10-01', 1)).toBe('2026-10-02')
    expect(addDays('2026-10-01', 0)).toBe('2026-10-01')
  })

  test('crosses a month, a year and a leap day', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  /**
   * The bug this function exists to avoid: `new Date('2026-10-01')` is midnight
   * UTC, and every local getter in Sydney reports 1 October as 2 October — or,
   * formatted the other way, reports the day before. Built and read from the
   * parts, the string never becomes a moment.
   */
  test('a date never passes through a local Date', () => {
    expect(addDays('2026-01-01', 0)).toBe('2026-01-01')
    expect(addDays('2026-07-01', 0)).toBe('2026-07-01')
  })
})

describe('todayInSydney', () => {
  /** 23:30 UTC is already tomorrow in Sydney; a UTC default would start every
   *  evening's plan a day early. */
  test('is the Sydney day, not the UTC one', () => {
    expect(todayInSydney(new Date('2026-09-22T23:30:00Z'))).toBe('2026-09-23')
    expect(todayInSydney(new Date('2026-09-23T01:00:00Z'))).toBe('2026-09-23')
  })
})
