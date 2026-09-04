export const python = process.env.OPERATOROS_PYTHON ?? (() => {
  throw new Error("OPERATOROS_PYTHON is missing; run the API test through the canonical tooling task");
})();
