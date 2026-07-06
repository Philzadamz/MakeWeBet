/**
 * JSON.stringify cannot serialize BigInt (used for all money values).
 * Serialize as string so clients never hit float precision on kobo amounts.
 * Imported once by every entrypoint before anything else runs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (this: bigint): string {
  return this.toString();
};

export {};
