export async function withCleanup<T>(run: () => Promise<T>, cleanup: () => Promise<void>): Promise<T> {
  let value!: T;
  let primaryError: unknown;
  let failed = false;
  try { value = await run(); }
  catch (error) { primaryError = error; failed = true; }

  try { await cleanup(); }
  catch (cleanupError) {
    if (failed) throw new AggregateError([primaryError, cleanupError], "The test and its cleanup both failed.");
    throw cleanupError;
  }
  if (failed) throw primaryError;
  return value;
}
