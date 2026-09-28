import type { QueryAdapter } from '@nocobase/db';

/** A problem's owner columns: `ownerId` is the account, `owner` its display text. */
export interface OwnerFields {
  readonly owner: string | null;
  readonly ownerId: string | null;
}

/**
 * Resolves an owner written as a name to the one account with that display name.
 * The name stays text when no account or several accounts carry it, so an
 * environment without accounts keeps working.
 */
export async function linkOwnerName(
  query: QueryAdapter,
  owner: string,
): Promise<OwnerFields> {
  const matches = await query
    .selectFrom('user')
    .select(['id', 'name'])
    .where('name', '=', owner)
    .limit(2)
    .execute();
  if (matches.length !== 1) {
    return { owner, ownerId: null };
  }

  return { owner: String(matches[0].name), ownerId: String(matches[0].id) };
}

/**
 * The owner a problem inherits from its feature point, or null when the point has
 * none. A point's account is kept as it is; a point owned by a name only resolves
 * that name the way a name-only write does, so staff creation, a person's move and
 * factory classification all link an inherited owner exactly as a typed one.
 */
export async function inheritFeaturePointOwner(
  query: QueryAdapter,
  point: { readonly owner?: unknown; readonly ownerId?: unknown },
): Promise<OwnerFields | null> {
  const owner =
    typeof point.owner === 'string' && point.owner ? point.owner : null;
  const ownerId =
    typeof point.ownerId === 'string' && point.ownerId ? point.ownerId : null;
  if (ownerId !== null) {
    return { owner, ownerId };
  }

  return owner === null ? null : linkOwnerName(query, owner);
}
