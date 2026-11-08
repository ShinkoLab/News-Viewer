/** Opaque keyset cursor. Preserve Firestore nanoseconds and document ID ties. */
export type BatchCursor = { seconds: number; nanoseconds: number; id: string };
export type BatchBoundary = Date | BatchCursor;

export function cursorFromDate(date: Date, id: string): BatchCursor {
  const milliseconds = date.getTime();
  const seconds = Math.floor(milliseconds / 1000);
  return { seconds, nanoseconds: (milliseconds - seconds * 1000) * 1_000_000, id };
}

export function cursorDate(cursor: BatchCursor): Date {
  return new Date(cursor.seconds * 1000 + Math.floor(cursor.nanoseconds / 1_000_000));
}

export function encodeBatchCursor(cursor: BatchCursor): string {
  return `v1.${Buffer.from(JSON.stringify([cursor.seconds, cursor.nanoseconds, cursor.id])).toString("base64url")}`;
}

export function parseBatchBoundary(value: string): BatchBoundary {
  if (value.startsWith("v1.")) {
    if (value.length > 256 || !/^v1\.[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid before cursor");
    const parsed: unknown = JSON.parse(Buffer.from(value.slice(3), "base64url").toString());
    if (!Array.isArray(parsed) || parsed.length !== 3) throw new Error("invalid before cursor");
    const [seconds, nanoseconds, id] = parsed;
    if (!Number.isSafeInteger(seconds) || seconds < -62135596800 || seconds > 253402300799 ||
        !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1_000_000_000 ||
        typeof id !== "string" || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) {
      throw new Error("invalid before cursor");
    }
    return { seconds, nanoseconds, id };
  }
  // Older clients may still send ISO dates. Keep their strict timestamp cutoff.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw new Error("invalid before cursor");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid before cursor");
  return date;
}
