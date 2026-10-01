import { z } from "zod";

// PostgreSQL JSON timestamps include an offset and may retain microseconds.
// Keep the original string so optimistic locking does not lose precision.
export const productVersionSchema = z.iso.datetime({ offset: true });
