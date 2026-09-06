-- Recording that post goes to the residential address (6 Sep 2026)
--
-- A postal address is not a new kind of thing here: contact_points has held
-- 'address_postal' in its kind enum since the schema was created, and stores
-- the five address columns already. So no table changes.
--
-- What was missing is a way to record the DECISION that post goes to the
-- residential address, which is a property of the person rather than of any
-- contact point — there is no row to hang it on precisely because there is no
-- separate postal address.
--
-- WHY A FLAG RATHER THAN A COPY. The obvious implementation of a
-- "same as residential" tick is to copy the five residential values into a
-- postal row on save. That address then goes stale the moment somebody moves
-- house, silently, and the first anyone knows is a statement posted to the
-- old address. With a flag the postal address FOLLOWS the residential one for
-- as long as the tick is set, because it is resolved when read rather than
-- frozen when written.
--
-- WHY NOT JUST "no postal row means same". Absence cannot tell "we confirmed
-- post goes to the home address" from "nobody has asked yet". For a firm that
-- has to evidence what it was told, those are different facts. The flag makes
-- three states legible:
--
--   true                      -> deliberately the same as residential
--   false + a postal row      -> a distinct postal address
--   false + no postal row     -> not recorded
--
-- Default true: it matches how every existing record already behaves — there
-- are no postal rows at all today — and it is the safe assumption, since post
-- reaching the home address is the norm.
alter table public.persons
  add column if not exists postal_same_as_residential boolean not null default true;

comment on column public.persons.postal_same_as_residential is
  'True when post goes to the residential address. While true no address_postal contact point is kept, so the postal address follows the residential one instead of going stale as a copy would. False plus no postal row means not recorded.';
