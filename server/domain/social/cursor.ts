/**
 * Opaque keyset-pagination cursors: (createdAt, id) of the last row of a page, base64url-encoded.
 * Keyset (not offset) pagination keeps pages stable while new rows arrive. Pure; used by comments and
 * notifications.
 */

export interface KeysetCursor {
  createdAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, "utf8").toString("base64url");
}

/** Returns null for anything malformed (treat as "first page"), never throws. */
export function decodeCursor(raw: string | null | undefined): KeysetCursor | null {
  if (!raw || raw.length > 200) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [iso, id, ...rest] = decoded.split("|");
  if (rest.length > 0 || !iso || !id || !UUID.test(id)) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}
