import pg from "pg";

/** Keep PostgreSQL microseconds: Date serialisation loses optimistic-lock precision. */
export function databaseTimestamp(value: string): string {
  return value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
}

export const preciseTimestampTypes = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === 1184 && format !== "binary") return databaseTimestamp;
    return pg.types.getTypeParser(oid, format);
  },
};
