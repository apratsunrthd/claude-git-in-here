// Groups Claude Code activity into 5-hour usage blocks (Anthropic's rolling
// rate-limit window for subscription plans).
//
// The window boundary must be derived from ALL turns, not just assistant
// (billable/usage-bearing) ones: a 5-hour window opens on the user's FIRST
// message, which carries no usage object. Deriving boundaries from assistant
// turns alone starts each block at the first assistant reply instead, which
// runs the countdown minutes late relative to the real window.
(function () {
  const SPAN_MS = 5 * 60 * 60 * 1000;

  // activityTimestamps: ms epoch, one per turn (user + assistant), any order.
  // Returns non-overlapping [startMs, endMs] windows, greedily opened: the
  // next timestamp only opens a new window once the previous one has closed.
  function computeBlocks(activityTimestamps) {
    const sorted = [...activityTimestamps].sort((a, b) => a - b);
    const windows = [];
    for (const ts of sorted) {
      if (windows.length && ts < windows[windows.length - 1][1]) continue;
      windows.push([ts, ts + SPAN_MS]);
    }
    return windows;
  }

  function findWindowIndex(windows, ts) {
    for (let i = windows.length - 1; i >= 0; i--) {
      if (ts >= windows[i][0] && ts < windows[i][1]) return i;
    }
    return -1;
  }

  function emptyTotals() {
    return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  }

  function addUsage(totals, usage) {
    totals.input_tokens += usage.input_tokens || 0;
    totals.output_tokens += usage.output_tokens || 0;
    totals.cache_creation_input_tokens += usage.cache_creation_input_tokens || 0;
    totals.cache_read_input_tokens += usage.cache_read_input_tokens || 0;
  }

  // events: [{ timestamp(ms), model, usage }], usage-bearing assistant turns only.
  // windows: from computeBlocks(), built from the FULL activity set (so every
  // event's timestamp is guaranteed to fall inside some window).
  function summarizeBlocks(events, windows) {
    const blocks = windows.map(([start, end]) => ({
      start,
      end,
      messageCount: 0,
      tokens: emptyTotals(),
      byModel: {},
    }));
    for (const e of events) {
      const idx = findWindowIndex(windows, e.timestamp);
      if (idx === -1) continue; // shouldn't happen if windows cover all activity
      const b = blocks[idx];
      b.messageCount += 1;
      addUsage(b.tokens, e.usage);
      b.byModel[e.model] = (b.byModel[e.model] || 0) + 1;
    }
    return blocks;
  }

  // The block whose window is still open ("now" falls before its end).
  // Null if the last known window has already closed and no new activity
  // has opened the next one yet.
  function currentBlock(blocks, now) {
    if (!blocks.length) return null;
    const last = blocks[blocks.length - 1];
    return last.end > now ? last : null;
  }

  // Builds a block-shaped summary for an arbitrary explicit [start, end)
  // window instead of a locally-derived one — used when an external "resets
  // in" reading overrides the local boundary guess.
  function buildBlockForWindow(events, start, end) {
    const inWindow = events.filter((e) => e.timestamp >= start && e.timestamp < end);
    const block = { start, end, messageCount: 0, tokens: emptyTotals(), byModel: {} };
    for (const e of inWindow) {
      block.messageCount += 1;
      addUsage(block.tokens, e.usage);
      block.byModel[e.model] = (block.byModel[e.model] || 0) + 1;
    }
    return block;
  }

  window.UsageBlocks = {
    SPAN_MS,
    computeBlocks,
    summarizeBlocks,
    currentBlock,
    buildBlockForWindow,
  };
})();
