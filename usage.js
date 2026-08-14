(function () {
  const content = document.getElementById("usage-content");

  function fmt(n) {
    return Number(n).toLocaleString();
  }

  function unsupportedView() {
    content.innerHTML = "";
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = `<p>This browser doesn't support the File System Access API, which the Usage tab needs to read your local Claude Code logs. Use Chrome or Edge.</p>`;
    content.appendChild(div);
  }

  function connectView() {
    content.innerHTML = "";
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = `<p>Connect your local Claude Code logs to see usage. You'll pick your <code>~/.claude/projects</code> folder once; the browser remembers it after that.</p>`;
    const btn = document.createElement("button");
    btn.textContent = "Connect usage logs";
    btn.addEventListener("click", async () => {
      try {
        await window.UsageSource.connect();
        await loadUsage();
      } catch (err) {
        // User cancelled the picker, or permission denied — stay on this view.
        console.error("Failed to connect usage logs:", err);
      }
    });
    div.appendChild(document.createElement("br"));
    div.appendChild(btn);
    content.appendChild(div);
  }

  function summarize(events, activity) {
    const now = Date.now();
    const windows = window.UsageBlocks.computeBlocks(activity);
    const blocks = window.UsageBlocks.summarizeBlocks(events, windows);
    const block = window.UsageBlocks.currentBlock(blocks, now);

    if (!block) {
      return { active: false, window_end: now };
    }

    const byModel = {};
    for (const [model, count] of Object.entries(block.byModel)) {
      byModel[model] = { message_count: count };
    }

    return {
      active: true,
      window_start: block.start,
      window_end: block.end,
      message_count: block.messageCount,
      tokens: { ...block.tokens, total: block.tokens.input_tokens + block.tokens.output_tokens + block.tokens.cache_creation_input_tokens + block.tokens.cache_read_input_tokens },
      by_model: byModel,
    };
  }

  function render(data) {
    content.innerHTML = "";

    if (!data.active) {
      const p = document.createElement("p");
      p.className = "status-line";
      p.textContent = "No active 5-hour window — no Claude Code activity in the last 5 hours.";
      content.appendChild(p);
      const refreshBtn = document.createElement("button");
      refreshBtn.textContent = "Refresh";
      refreshBtn.addEventListener("click", loadUsage);
      content.appendChild(refreshBtn);
      return;
    }

    const stats = document.createElement("div");
    stats.className = "usage-stats";
    const tiles = [
      ["Messages (this window)", fmt(data.message_count)],
      ["Input tokens", fmt(data.tokens.input_tokens)],
      ["Output tokens", fmt(data.tokens.output_tokens)],
      ["Cache read tokens", fmt(data.tokens.cache_read_input_tokens)],
      ["Cache write tokens", fmt(data.tokens.cache_creation_input_tokens)],
      ["Total tokens", fmt(data.tokens.total)],
    ];
    for (const [label, value] of tiles) {
      const tile = document.createElement("div");
      tile.className = "stat-tile";
      tile.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div>`;
      stats.appendChild(tile);
    }
    content.appendChild(stats);

    const p = document.createElement("p");
    p.className = "status-line";
    p.textContent = `Window opened ${new Date(data.window_start).toLocaleTimeString()} — resets at ${new Date(data.window_end).toLocaleTimeString()}`;
    content.appendChild(p);

    const models = Object.keys(data.by_model || {});
    if (models.length) {
      const heading = document.createElement("p");
      heading.className = "status-line";
      heading.textContent = "By model:";
      content.appendChild(heading);
      for (const model of models) {
        const line = document.createElement("p");
        line.className = "status-line";
        line.textContent = `${model}: ${fmt(data.by_model[model].message_count)} messages`;
        content.appendChild(line);
      }
    }

    const btnRow = document.createElement("div");
    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.addEventListener("click", loadUsage);
    btnRow.appendChild(refreshBtn);
    content.appendChild(btnRow);
  }

  async function loadUsage() {
    if (!window.UsageSource.isSupported()) {
      unsupportedView();
      return;
    }
    content.innerHTML = '<p class="status-line">Loading…</p>';
    const handle = await window.UsageSource.getConnectedHandle(false);
    if (!handle) {
      connectView();
      return;
    }
    try {
      const { events, activity } = await window.UsageSource.readUsageEntries(handle);
      render(summarize(events, activity));
    } catch (err) {
      console.error("Failed to read usage logs:", err);
      connectView();
    }
  }

  window.Usage = { onShow: loadUsage };
})();
