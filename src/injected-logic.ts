const LOCATION_LABELS = new Set([
  'based in',
  'country',
  'location',
  'nation',
  'region',
  '所在地點',
  '所在地',
  '居住地',
  '国家',
  '國家',
  '위치',
  '거주지',
  '국가',
  '나라',
  '지역',
  'ubicación',
  'país',
  'localisation',
  'pays',
  'standort',
  'land',
])
const HIDDEN_COUNTRY_VALUES = new Set([
  'not shared',
  'not disclosed',
  'not available',
  'hidden',
  'private',
  '미공개',
  '공유되지 않음',
  '숨김',
  '비공개',
  '未分享',
  '未公開',
  '非公開',
  '非表示',
  '隱藏',
  '隐藏',
])
const HIDDEN_COUNTRY_PATTERN =
  /\b(?:not|no)\b[\s\S]{0,16}\b(?:shared|available|disclosed|shown)\b/
const INVALID_COUNTRY_PREFIX_PATTERN =
  /^(?:https?:\/\/|bk\.action\.|bloks\.|\$)/i
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}t/i
const TIME_ONLY_PATTERN = /^\d{1,2}:\d{2}(?::\d{2})?$/
const LONG_ALPHANUMERIC_PATTERN = /^[a-z0-9_]{8,}$/i
const DIGIT_PATTERN = /\d/

export function normalizeUsername(username: string): string {
  return username.replace(/^@/, '').toLowerCase()
}

export function extractUserIdFromProfileHtml(html: string): string | undefined {
  const patterns = [
    /"user_id"\s*:\s*"(\d+)"/,
    /"props"\s*:\s*\{\s*"user_id"\s*:\s*"(\d+)"\s*\}/,
    /\\"user_id\\"\s*:\s*\\"(\d+)\\"/,
    /\\"props\\"\s*:\s*\{\s*\\"user_id\\"\s*:\s*\\"(\d+)\\"\s*\}/,
  ]

  return firstMatch(html, patterns)
}

export function extractHandleFromDisplayName(
  displayName: string,
): string | undefined {
  const handle = /@([a-z0-9._]{1,30})/i.exec(displayName)?.[1]

  if (handle === undefined || !isUsefulUsernameCandidate(handle)) {
    return undefined
  }

  return normalizeUsername(handle)
}

export function isUsefulUsernameCandidate(value: string): boolean {
  const normalized = normalizeUsername(value.trim())

  return (
    /^[a-z0-9._]{1,30}$/.test(normalized) &&
    !normalized.includes(' ') &&
    !/^\d+$/.test(normalized)
  )
}

export function isHiddenCountryValue(value: string): boolean {
  const normalized = value.normalize('NFKC').toLowerCase().trim()

  return (
    HIDDEN_COUNTRY_VALUES.has(normalized) ||
    HIDDEN_COUNTRY_PATTERN.test(normalized)
  )
}

export function isUsefulCountryCandidate(value: string): boolean {
  const normalized = value.normalize('NFKC').trim()
  const lower = normalized.toLowerCase()

  if (
    normalized.length === 0 ||
    normalized.length > 80 ||
    isHiddenCountryValue(normalized)
  ) {
    return false
  }

  if (['text', 'true', 'false', 'null', 'undefined'].includes(lower)) {
    return false
  }

  if (INVALID_COUNTRY_PREFIX_PATTERN.test(normalized)) {
    return false
  }

  if (ISO_DATE_PATTERN.test(normalized) || TIME_ONLY_PATTERN.test(normalized)) {
    return false
  }

  return !(
    LONG_ALPHANUMERIC_PATTERN.test(normalized) && DIGIT_PATTERN.test(normalized)
  )
}

export function decodeEscapedUnicode(value: string): string {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  )
}

export function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string
  } catch {
    return value
  }
}

export function parseMaybeJson(text: string): unknown {
  const clean = stripJsonProtectionPrefix(text).trim()

  return JSON.parse(clean)
}

export function stripJsonProtectionPrefix(text: string): string {
  return text
    .replace(/^\s*for\s*\(;;\)\s*;?/, '')
    .replace(/^\s*while\s*\(1\)\s*;?/, '')
    .replace(/^\s*\)\]\}',?\s*/, '')
}

export function isAboutProfileCountryKey(key: string): boolean {
  const normalized = key.normalize('NFKC').toLowerCase().trim()

  return (
    normalized === 'about_this_profile_country' ||
    /(?:^|[:./])about_this_profile_country$/.test(normalized)
  )
}

export function isLocationLabel(label: string): boolean {
  const normalized = label
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[:：]$/, '')

  return (
    LOCATION_LABELS.has(normalized) ||
    /\b(?:based|located|country|nation|region|location)\b/.test(normalized)
  )
}

export function isLabelTextStyle(style: string): boolean {
  const normalized = style.normalize('NFKC').toLowerCase()

  return ['semibold', 'bold', 'medium', 'label', 'headline', 'title'].some(
    (token) => normalized.includes(token),
  )
}

export function isValueTextStyle(style: string): boolean {
  const normalized = style.normalize('NFKC').toLowerCase()

  return ['normal', 'regular', 'body', 'paragraph', 'value'].some((token) =>
    normalized.includes(token),
  )
}

function firstMatch(
  text: string,
  patterns: readonly RegExp[],
): string | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(text)

    if (match?.[1] !== undefined) {
      return decodeJsonString(match[1])
    }
  }

  return undefined
}
