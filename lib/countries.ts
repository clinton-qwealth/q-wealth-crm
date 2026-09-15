/**
 * ISO 3166-1 country codes and names, for citizenship and tax residency.
 *
 * Codes are stored, names are displayed: a country can be renamed without
 * rewriting stored data, and a code is unambiguous where "Korea" is not.
 *
 * Not exhaustive by design — this is the set an Australian advice firm actually
 * encounters, ordered with Australia and New Zealand first because that is the
 * overwhelming majority of entries. Adding a country is one line.
 */
export const COUNTRIES: { code: string; name: string }[] = [
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'AR', name: 'Argentina' },
  { code: 'AT', name: 'Austria' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'CL', name: 'Chile' },
  { code: 'CN', name: 'China' },
  { code: 'HR', name: 'Croatia' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EG', name: 'Egypt' },
  { code: 'FJ', name: 'Fiji' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'GR', name: 'Greece' },
  { code: 'HK', name: 'Hong Kong SAR' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'KR', name: 'Korea, Republic of' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MT', name: 'Malta' },
  { code: 'MU', name: 'Mauritius' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'NO', name: 'Norway' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PG', name: 'Papua New Guinea' },
  { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Romania' },
  { code: 'SG', name: 'Singapore' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'ES', name: 'Spain' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'VN', name: 'Viet Nam' },
  { code: 'ZW', name: 'Zimbabwe' },
]

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c.name]))

/** Falls back to whatever is stored, so an unrecognised code still shows. */
export function countryName(code?: string | null) {
  if (!code) return null
  return BY_CODE.get(code) ?? code
}

export const EMPLOYMENT_STATUS: { value: string; label: string }[] = [
  { value: 'employed', label: 'Employed' },
  { value: 'self_employed', label: 'Self-employed' },
  { value: 'unemployed', label: 'Unemployed' },
  { value: 'retired', label: 'Retired' },
  { value: 'home_duties', label: 'Home duties' },
  { value: 'student', label: 'Student' },
  { value: 'not_disclosed', label: 'Not disclosed' },
]

/*
 * Value and label are the same string here, unlike the coded lists above. The
 * column is free text and already holds 'Female' and 'Male', so matching those
 * exactly means no migration and no risk of a stored value failing to match an
 * option — and the read-only view can render the column directly.
 */
export const GENDER: { value: string; label: string }[] = [
  { value: 'Female', label: 'Female' },
  { value: 'Male', label: 'Male' },
  { value: 'Non-binary', label: 'Non-binary' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
]

/*
 * Marital status, 15 September 2026. A CODED list like employment status
 * rather than display strings like gender above, because this one is backed by
 * a Postgres enum — `public.marital_status` — so the stored value is a key and
 * the label belongs here, in one place, beside the list that produces it.
 *
 * The column was free text until that day and production proved exactly why
 * that is not good enough: it held `married` twice and `Married` once, which is
 * two vocabularies for one fact and the thing an enum exists to prevent. The
 * migration lower-cased before casting.
 *
 * Six values, the set an Australian fact-find carries. **Nothing for
 * "declined"**, deliberately, where employment status has `not_disclosed`: the
 * column is nullable and blank already means "not recorded". Adding a seventh
 * value later is a one-line migration — but it cannot be used in the same
 * transaction that adds it, which is why the list was settled before the enum
 * was written rather than after.
 */
export const MARITAL_STATUS: { value: string; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'de_facto', label: 'De facto' },
  { value: 'separated', label: 'Separated' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
]

const EMPLOYMENT_LABEL = new Map(EMPLOYMENT_STATUS.map((e) => [e.value, e.label]))
const MARITAL_LABEL = new Map(MARITAL_STATUS.map((m) => [m.value, m.label]))

export function employmentLabel(value?: string | null) {
  if (!value) return null
  return EMPLOYMENT_LABEL.get(value) ?? value
}

/**
 * The words for a stored marital status.
 *
 * Falls back to the stored value rather than to nothing, the same rule
 * `employmentLabel` follows: a value this list has not been taught about is
 * still a fact about a client, and showing `de_facto` is a great deal better
 * than showing an empty field where something is recorded.
 */
export function maritalLabel(value?: string | null) {
  if (!value) return null
  return MARITAL_LABEL.get(value) ?? value
}
