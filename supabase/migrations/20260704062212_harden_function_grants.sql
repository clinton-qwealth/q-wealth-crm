-- Functions are granted to PUBLIC by default; revoke and re-grant only to intended roles.
-- Signed-in staff may call these (each has internal permission checks); anon may not.
revoke all on function public.is_active_staff() from public, anon;
revoke all on function public.current_staff_has(text) from public, anon;
revoke all on function public.set_sensitive_field(uuid, public.sensitive_field_kind, text) from public, anon;
revoke all on function public.reveal_sensitive_field(uuid, public.sensitive_field_kind) from public, anon;
revoke all on function public.get_masked_hint(uuid, public.sensitive_field_kind) from public, anon;

grant execute on function public.is_active_staff() to authenticated, service_role;
grant execute on function public.current_staff_has(text) to authenticated, service_role;
grant execute on function public.set_sensitive_field(uuid, public.sensitive_field_kind, text) to authenticated, service_role;
grant execute on function public.reveal_sensitive_field(uuid, public.sensitive_field_kind) to authenticated, service_role;
grant execute on function public.get_masked_hint(uuid, public.sensitive_field_kind) to authenticated, service_role;

-- internal-only helpers stay locked down
revoke all on function public.get_sensitive_key() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.refresh_party_display_name() from public, anon, authenticated;
