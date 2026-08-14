// Anthropic doesn't publish the actual token/message ceiling for a
// subscription plan's 5-hour window anywhere accessible locally — it's not
// in the session logs. So instead of guessing at a number, we calibrate:
// you tell us the % your own Claude usage indicator ("/usage") shows at a
// given moment, and we back out an implied budget from your own current
// block's cost-equivalent at that same moment. That budget is then reused
// for future windows until you recalibrate.
(function () {
  const CAL_KEY = "cgih_usage_calibration";
  const RESET_OVERRIDE_KEY = "cgih_reset_override";

  // Relative per-million-token weights — NOT real currency. Used only as a
  // consistent internal yardstick so a calibration reading and a later
  // window can be compared on the same scale.
  const COST_WEIGHTS = { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 };

  // Placeholder floor used only before any calibration or observed history
  // exists. Arbitrary — always labelled as a placeholder in the UI.
  const DEFAULT_BUDGET_FLOOR = 5;

  function costEquivalent(tokens) {
    return (
      (tokens.input_tokens / 1e6) * COST_WEIGHTS.input +
      (tokens.output_tokens / 1e6) * COST_WEIGHTS.output +
      (tokens.cache_creation_input_tokens / 1e6) * COST_WEIGHTS.cache_write +
      (tokens.cache_read_input_tokens / 1e6) * COST_WEIGHTS.cache_read
    );
  }

  function loadCalibration() {
    try {
      return JSON.parse(localStorage.getItem(CAL_KEY) || "null");
    } catch {
      return null;
    }
  }

  // pct: the % your Claude usage indicator showed, at the moment the current
  // block's cost-equivalent was `currentCost`.
  function saveCalibration(pct, currentCost) {
    const budget = currentCost / (pct / 100);
    const record = { budget, pct, calibratedAt: Date.now() };
    localStorage.setItem(CAL_KEY, JSON.stringify(record));
    return record;
  }

  function clearCalibration() {
    localStorage.removeItem(CAL_KEY);
  }

  function loadResetOverride() {
    const raw = localStorage.getItem(RESET_OVERRIDE_KEY);
    if (!raw) return null;
    const endTs = Number(raw);
    return Number.isFinite(endTs) && endTs > Date.now() ? endTs : null;
  }

  function saveResetOverride(hours, minutes) {
    const endTs = Date.now() + (hours * 3600 + minutes * 60) * 1000;
    localStorage.setItem(RESET_OVERRIDE_KEY, String(endTs));
    return endTs;
  }

  function clearResetOverride() {
    localStorage.removeItem(RESET_OVERRIDE_KEY);
  }

  // blocks: all known blocks (for observed-peak fallback), each with .tokens.
  function resolveBudget(blocks) {
    const calibration = loadCalibration();
    if (calibration && calibration.budget > 0) {
      return {
        budget: calibration.budget,
        source: "calibrated",
        detail: `Calibrated from a ${calibration.pct}% reading on ${new Date(calibration.calibratedAt).toLocaleDateString()}.`,
      };
    }

    const peak = blocks.reduce((max, b) => Math.max(max, costEquivalent(b.tokens)), 0);
    if (peak > 0) {
      return {
        budget: peak * 1.25,
        source: "observed-peak",
        detail: "Estimated from your heaviest observed 5-hour window so far, plus headroom. Calibrate for accuracy.",
      };
    }

    return {
      budget: DEFAULT_BUDGET_FLOOR,
      source: "default",
      detail: "Placeholder estimate — calibrate against your own Claude usage indicator for an accurate reading.",
    };
  }

  // 0.6 / 0.8 / 0.95 / 1.0 severity bands.
  function severity(ratio) {
    if (ratio >= 0.95) return "critical";
    if (ratio >= 0.8) return "serious";
    if (ratio >= 0.6) return "warning";
    return "good";
  }

  window.UsageCalibration = {
    costEquivalent,
    loadCalibration,
    saveCalibration,
    clearCalibration,
    loadResetOverride,
    saveResetOverride,
    clearResetOverride,
    resolveBudget,
    severity,
  };
})();
