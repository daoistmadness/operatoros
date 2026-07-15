(() => {
  const failure = window.__OPERATOROS_FAILURE__;
  if (!failure) return;
  const state = document.getElementById("state");
  const summary = document.getElementById("summary");
  if (state && typeof failure.state === "string") state.textContent = failure.state;
  if (summary && typeof failure.message === "string") summary.textContent = failure.message;
})();
