const japanDateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

export function formatJapaneseDateTime(date: Date | string): string {
  return japanDateTimeFormat.format(new Date(date));
}

const japanDateShortFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Tokyo",
});

export function formatJapaneseDateShort(date: Date | string): string {
  return japanDateShortFormat.format(new Date(date));
}
