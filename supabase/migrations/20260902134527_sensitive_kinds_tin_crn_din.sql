-- Three more encrypted identifier kinds (2 Sep 2026)
--
-- Alone in its own migration: a new enum value cannot be used in the same
-- transaction that adds it, and every migration here runs in one.
--
-- These join the TFN in party_sensitive_data rather than becoming plain columns
-- on persons. The store is generic over sensitive_field_kind, so all three
-- immediately inherit pgcrypto encryption, the view_sensitive permission check,
-- the verified-second-factor requirement, the masked hint for everyday screens,
-- and a row in sensitive_access_log for every write and every reveal.
--
--   tin            a foreign Tax Identification Number. The same class of thing
--                  as a TFN, so treated the same way.
--   centrelink_crn a government identifier and a direct identity-theft risk.
--   director_id    ASIC's Director Identification Number, which must not be
--                  disclosed without the holder's consent.
--
-- Deliberately NOT added: the CHESS Holder Identification Number and the
-- sponsor's Participant ID. A PID identifies the broker rather than the client
-- and is not personal information at all; a HIN appears on every holding
-- statement and is needed for routine settlement admin, so gating it behind a
-- second factor would obstruct operations daily for little gain. Both are plain
-- columns on persons.
alter type public.sensitive_field_kind add value if not exists 'tin';
alter type public.sensitive_field_kind add value if not exists 'centrelink_crn';
alter type public.sensitive_field_kind add value if not exists 'director_id';
