-- A client's communication subscriptions (11 Sep 2026)
--
-- Seven channels the firm sends on, and a record per person of which they are
-- on. Nothing like this existed: no column anywhere in the schema mentioned
-- consent, subscription, marketing or opting in or out, so the answer to "may
-- we send this person the newsletter" was not written down at all.
--
-- ## Two decisions taken with the reader, both of which shape the table
--
-- **Absence means OFF, and a row is a decision.** A channel with no row has
-- never been agreed to and nothing goes out on it. That is the conservative
-- reading of consent and the one that can be defended: every subscription this
-- table asserts was deliberately recorded by somebody, with their name and the
-- moment. The cost is real and is not hidden -- existing clients are on nothing
-- until somebody opts them in, so the first send needs a pass over the book.
--
-- **An unsubscribe is per channel, it says who asked, and it locks.** The
-- difference between "staff turned this off" and "the client asked us to stop"
-- is the whole reason `source` exists. Under the Spam Act a firm has to be able
-- to show that an unsubscribe was honoured, and a plain boolean cannot: six
-- months later nobody can tell whether a channel is off because the client
-- asked or because somebody clicked it. So a row with source = 'client' and
-- opted_in = false is an unsubscribe, and `set_subscription()` refuses to move
-- it -- see the function.
--
-- Per channel rather than one flag on the person, because "stop the promotional
-- mail but keep sending my quarterly review" is a real and reasonable request
-- that a single switch cannot express.
--
-- ## What is NOT here, named rather than left to be discovered
--
-- **There is no path to re-subscribe somebody who has unsubscribed.** That
-- follows from the lock, and it is the intended trade: only the client can undo
-- it, and no client-facing surface exists yet. A client who telephones and asks
-- to come back therefore cannot be put back from the app. Recorded on the Web
-- App page's Outstanding list rather than softened here, because softening it
-- silently is exactly how a lock like this stops meaning anything.
--
-- Nothing sends yet either. This records the answer; the sending is a separate
-- piece of work that will read it.

create type public.subscription_channel as enum (
  'investment_newsletters',
  'events_and_webinars',
  'q_wealth_updates',
  'markets_in_motion',
  'star_quarterly_reviews',
  'promotional_and_marketing',
  'sms_communication'
);

-- Who made the change. Not a free-text column: the whole value of this record
-- is that the two cases can never be confused.
create type public.subscription_source as enum ('staff', 'client');

create table public.party_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  party_id    uuid not null references public.parties(id) on delete cascade,
  channel     public.subscription_channel not null,
  opted_in    boolean not null,
  source      public.subscription_source not null,
  -- Who, when they were staff. Null for a client's own action, which is the
  -- point of the column being nullable rather than a second table.
  staff_id    uuid references public.staff_users(id),
  changed_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  -- One row per person per channel: this is the current answer, not a log. The
  -- audit trail carries the history.
  constraint party_subscriptions_one_per_channel unique (party_id, channel),
  -- A staff change must name the staff member; a client's must not pretend to.
  constraint party_subscriptions_staff_named
    check ((source = 'staff' and staff_id is not null)
        or (source = 'client' and staff_id is null))
);

comment on table public.party_subscriptions is
  'Which communication channels a person is subscribed to. NO ROW MEANS OFF -- a row is a recorded decision, never an assumption. A row with source = ''client'' and opted_in = false is an unsubscribe and is locked; see set_subscription(). Added 11 Sep 2026.';

comment on column public.party_subscriptions.source is
  'Who made this decision. ''client'' means the person themselves asked, which is what makes an opt-out an unsubscribe rather than a setting.';

create index party_subscriptions_party_idx on public.party_subscriptions (party_id);

alter table public.party_subscriptions enable row level security;

-- Scoped exactly as contact_points is: a subscription is a fact about a person,
-- visible to whoever may see that person.
create policy scoped_party_subscriptions on public.party_subscriptions
  for all
  using (public.staff_can_access_party(party_id))
  with check (public.staff_can_access_party(party_id));

-- Supabase's default privileges hand every new table in public to anon,
-- authenticated and service_role with ALL privileges. Checked and revoked here
-- rather than assumed: this is the sixth object to arrive that way.
revoke all on public.party_subscriptions from anon, public, authenticated;
grant select, insert, update on public.party_subscriptions to authenticated;

/**
 * Record a staff decision about one channel.
 *
 * Upserts, because the table holds the current answer rather than a log, and
 * refuses to touch a channel the client has unsubscribed from.
 */
create or replace function public.set_subscription(
  p_party_id uuid,
  p_channel public.subscription_channel,
  p_opted_in boolean
)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  v_staff := public.current_staff_id();
  if v_staff is null then
    raise exception 'Not an active staff member';
  end if;

  -- The lock. An unsubscribe is the client's own instruction, and staff putting
  -- somebody back on a channel they asked to leave is the failure this whole
  -- table exists to make impossible.
  if exists (
    select 1 from public.party_subscriptions s
     where s.party_id = p_party_id
       and s.channel = p_channel
       and s.source = 'client'
       and s.opted_in = false
  ) then
    raise exception 'This person unsubscribed from that channel themselves. Only they can undo it.';
  end if;

  insert into public.party_subscriptions (party_id, channel, opted_in, source, staff_id)
  values (p_party_id, p_channel, p_opted_in, 'staff', v_staff)
  on conflict (party_id, channel) do update
    set opted_in = excluded.opted_in,
        source = 'staff',
        staff_id = excluded.staff_id,
        changed_at = now();
end $function$;

-- ## No row-count guard here, and the difference is worth knowing
--
-- The three functions written earlier the same day all end with
-- `get diagnostics ... if row_count = 0 then raise`, because each is an UPDATE
-- and an UPDATE is filtered SILENTLY: row-level security removes the rows the
-- caller may not change, the statement matches nothing, and that is not an
-- error. One of them reported success while changing nothing until a branch
-- caught it.
--
-- **This function cannot fail that way**, because every path through it is an
-- INSERT. An insert is checked by WITH CHECK, which RAISES rather than
-- filtering -- and `on conflict do update` is checked the same way, verified on
-- the branch both ways: a staff member with no access to the person got
-- "new row violates row-level security policy" on a channel with no row AND on
-- a channel that already had one. The guard was written here first out of habit
-- and removed once it was shown to be unreachable, rather than kept as
-- reassurance. Dead code that looks like a safety check is worse than none: the
-- next person reads it as evidence the case was handled.

comment on function public.set_subscription(uuid, public.subscription_channel, boolean) is
  'Records a staff opt-in or opt-out for one channel. Refuses a channel the client unsubscribed from themselves. Added 11 Sep 2026.';

-- PostgreSQL grants EXECUTE on every new function to PUBLIC as built-in
-- behaviour and every role inherits from PUBLIC, so this revoke is load-bearing
-- rather than boilerplate.
revoke all on function public.set_subscription(uuid, public.subscription_channel, boolean) from public, anon;
grant execute on function public.set_subscription(uuid, public.subscription_channel, boolean) to authenticated;
