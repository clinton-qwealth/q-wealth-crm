-- Who may verify a client's identity (3 Sep 2026)
--
-- Decided by Clinton Hatcher, 3 September 2026: Adviser and Services.
--
-- Adviser because they are the ones on the telephone to the client. Services
-- because they handle the same calls. Management deliberately NOT included —
-- it is the profile that also lacks view_sensitive, and the pattern there is
-- oversight without direct client handling.
--
-- Admin is not included either, which is worth a second look at go-live: it
-- holds every other permission, and nobody holds Admin today, so nothing is
-- broken by leaving it out for now.
update public.access_profiles
   set verify_identity = true
 where name in ('Adviser', 'Services');
