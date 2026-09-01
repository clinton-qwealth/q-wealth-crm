create type public.party_type as enum ('person', 'organisation');
create type public.record_status as enum ('active', 'archived');
create type public.tfn_status as enum ('provided', 'exempt', 'not_provided');
create type public.org_entity_type as enum ('family_trust', 'unit_trust', 'company', 'smsf', 'partnership', 'other');
create type public.party_role_type as enum ('client', 'prospect', 'former_client', 'dependant', 'referral_partner', 'product_provider', 'staff');
create type public.role_status as enum ('active', 'inactive');
create type public.relationship_type as enum (
  'spouse_of', 'de_facto_of', 'parent_of', 'child_of', 'sibling_of',
  'trustee_of', 'director_of', 'shareholder_of', 'member_of', 'beneficiary_of',
  'accountant_for', 'lawyer_for', 'mortgage_broker_for', 'refers_to', 'other'
);
create type public.group_type as enum ('household', 'business_entity');
create type public.group_status as enum ('prospect', 'active', 'former');
create type public.member_role as enum (
  'primary', 'spouse_partner', 'dependant', 'other_person', 'entity',
  'director', 'shareholder', 'key_person'
);
create type public.contact_kind as enum (
  'email', 'phone_mobile', 'phone_other',
  'address_residential', 'address_postal', 'address_business'
);
create type public.sensitive_field_kind as enum ('tfn', 'passport', 'drivers_licence', 'medicare', 'bank_account');
create type public.sensitive_action as enum ('write', 'reveal');
create type public.staff_status as enum ('active', 'inactive');
