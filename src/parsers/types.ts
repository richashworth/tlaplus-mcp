/**
 * Shared type definitions for TLA+ value representations.
 */

/** A TLA+ record: a map from string keys to TLA+ values. */
export interface TlaRecord {
  [key: string]: TlaValue;
}

/** A TLA+ value as parsed by TLC output. */
export type TlaValue = number | boolean | string | TlaValue[] | TlaRecord;

/** A map of variable names to their TLA+ values (e.g. a state). */
export type VarMap = TlaRecord;
