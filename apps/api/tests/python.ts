// Existing Python fixture scripts now delegate fresh schema creation to Bun.
process.env.OPERATOROS_TS_BOOTSTRAP_TESTS = "1";
export const python = process.env.OPERATOROS_PYTHON ?? (() => {
  throw new Error("OPERATOROS_PYTHON is missing; run the API test through the canonical tooling task");
})();
