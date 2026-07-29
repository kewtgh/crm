export const SUPPORTED_TIMEZONES = [
  "Asia/Taipei",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Europe/London",
  "America/New_York",
] as const;

export type SupportedTimezone = typeof SUPPORTED_TIMEZONES[number];

export const DEFAULT_TIMEZONE: SupportedTimezone = "Asia/Taipei";

export function isSupportedTimezone(value: unknown): value is SupportedTimezone {
  return typeof value === "string" && SUPPORTED_TIMEZONES.includes(value as SupportedTimezone);
}

export function normalizeTimezone(value: unknown): SupportedTimezone {
  return isSupportedTimezone(value) ? value : DEFAULT_TIMEZONE;
}

export class InvalidLocalTimeError extends Error {
  readonly code = "INVALID_LOCAL_TIME";

  constructor(value: string, timezone: string) {
    super(`The local time ${value} does not exist in ${timezone}`);
    this.name = "InvalidLocalTimeError";
  }
}

export function dateTimePartsFor(value: Date, timezone: SupportedTimezone | "UTC") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

export function localDateTimeKey(value: Date, timezone: SupportedTimezone) {
  const parts = dateTimePartsFor(value, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function zonedLocalDateTimeToUtc(value: string, timezone: SupportedTimezone) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new InvalidLocalTimeError(value, timezone);
  }
  const desired = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(desired) || new Date(desired).toISOString().slice(0, 16) !== value) {
    throw new InvalidLocalTimeError(value, timezone);
  }
  let guess = desired;
  for (let index = 0; index < 4; index += 1) {
    const represented = Date.parse(`${localDateTimeKey(new Date(guess), timezone)}:00Z`);
    guess += desired - represented;
  }
  const result = new Date(guess);
  if (localDateTimeKey(result, timezone) !== value) {
    throw new InvalidLocalTimeError(value, timezone);
  }
  return result;
}

function normalizedMonth(year: number, zeroBasedMonth: number) {
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year, zeroBasedMonth, 1);
  return value;
}

export function calendarMonthRange(
  year: number,
  zeroBasedMonth: number,
  monthCount: number,
  timezone: SupportedTimezone,
) {
  if (
    !Number.isInteger(year)
    || !Number.isInteger(zeroBasedMonth)
    || !Number.isInteger(monthCount)
    || year < 1
    || year > 9998
    || monthCount < 1
    || monthCount > 24
  ) {
    throw new RangeError("Invalid calendar month range");
  }
  const start = normalizedMonth(year, zeroBasedMonth);
  const end = normalizedMonth(year, zeroBasedMonth + monthCount);
  const localMidnight = (value: Date) =>
    `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01T00:00`;
  return {
    from: zonedLocalDateTimeToUtc(localMidnight(start), timezone).toISOString(),
    to: zonedLocalDateTimeToUtc(localMidnight(end), timezone).toISOString(),
  };
}
