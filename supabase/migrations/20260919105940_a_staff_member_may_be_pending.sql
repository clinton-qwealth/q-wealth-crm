-- A staff member may be pending (19 Sep 2026)
--
-- The third status, for a person who has signed in and asked to join and has
-- not yet been approved. Alone in its own migration because a new enum value
-- cannot be used in the transaction that adds it — the 7 September workflow
-- status migration learned that the hard way — and the function that writes
-- 'pending' is in the file that follows.
--
-- What a pending row CAN do is the point: nothing. `current_staff_id()`,
-- `is_active_staff()` and `current_staff_has()` all require status = 'active'
-- and, for permissions, an assignment; a pending row has neither. So the value
-- widens no access anywhere. It exists so an administrator can see the request
-- and decide it.

alter type public.staff_status add value if not exists 'pending' before 'active';
