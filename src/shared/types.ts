export type BadgeMode = 'flag' | 'country' | 'both'

export interface Settings {
  badgeMode: BadgeMode
  showUnknown: boolean
  debugMode: boolean
  debugShowOverlay: boolean
  useTemplateReplay: boolean
  useFallbackConstruction: boolean
  cacheSuccessDays: number
  cacheMissHours: number
}

export interface CountryCacheEntry {
  username: string
  parserVersion?: number
  userId?: string
  country?: string
  flag?: string
  fetchedAt: number
  expiresAt: number
  status: 'hit' | 'miss' | 'error'
  error?: string
}

export interface ResolveCountryRequest {
  type: 'THREADS_COUNTRY_BADGE_RESOLVE'
  requestId: string
  username: string
}

export interface ResolveCountryResponse {
  type: 'THREADS_COUNTRY_BADGE_RESULT'
  requestId: string
  username: string
  userId?: string
  country?: string
  error?: string
}

export interface UserIdHarvestMessage {
  type: 'THREADS_COUNTRY_BADGE_USER_ID'
  username: string
  userId: string
}
