import type { Permission } from './types.js'

/** Ordered least- to most-privileged. Index is the escalation rank. */
export const PERMISSION_RANK: readonly Permission[] = [
  'fs:read',
  'net:fetch',
  'env:read',
  'fs:write',
  'proc:spawn',
  'secrets:read',
] as const

export function rank(permission: Permission): number {
  const index = PERMISSION_RANK.indexOf(permission)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

/**
 * The product runs sandboxed by default. A tool may only use permissions the caller
 * granted; anything beyond that is refused before the handler runs, not caught after.
 *
 * The check is set membership, deliberately NOT a comparison of escalation ranks. Ranking
 * is a display order: granting `proc:spawn` says nothing about `fs:write`, and a rank
 * ceiling silently admits every permission below the highest one granted — so a caller
 * holding only `fs:read`, `net:fetch` and `proc:spawn` would also get `env:read` and
 * `fs:write`, and an empty grant would get `fs:read`. Only `PERMISSION_RANK` knows which
 * strings exist; membership decides what is allowed.
 */
export function isSatisfied(required: readonly Permission[], granted: readonly Permission[]): boolean {
  const held = new Set<Permission>(granted)
  return required.every((permission) => held.has(permission))
}

export function describePermissions(permissions: readonly Permission[]): string {
  return permissions.length === 0 ? 'none' : [...permissions].sort((a, b) => rank(a) - rank(b)).join(', ')
}
