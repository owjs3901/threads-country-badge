import type { BadgeMode } from './shared/types'

export function toBadgeMode(value: string): BadgeMode {
  if (value === 'country' || value === 'both') {
    return value
  }

  return 'flag'
}

export function toPositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
