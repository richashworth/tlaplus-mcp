/**
 * Shared Zod schemas for tool parameter validation.
 */

import { z } from "zod";
import { isAbsolute } from "node:path";

/** Validates that a string is an absolute file path. */
export const absolutePath = z.string().refine((p) => isAbsolute(p), "Path must be absolute");
