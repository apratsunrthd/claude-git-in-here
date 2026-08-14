(function () {
  const content = document.getElementById("usage-content");
  const WINDOW_MS = 5 * 60 * 60 * 1000;

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

  function summarize(entries) {
    const now = Date.now();
    const windowStartMs = now - WINDOW_MS;
    const inWindow = entries.filter((e) => e.timestamp >= windowStartMs && e.timestamp <= now);

    const totals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const byModel = {};
    let earliest = null;

    for (const e of inWindow) {
      const u = e.usage;
      totals.input_tokens += u.input_tokens || 0;
      totals.output_tokens += u.output_tokens || 0;
      totals.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
      totals.cache_read_input_tokens += u.cache_read_input_tokens || 0;

      if (!byModel[e.model]) byModel[e.model] = { message_count: 0 };
      byModel[e.model].message_count += 1;

      if (earliest === null || e.timestamp < earliest) earliest = e.timestamp;
    }

    return {
      window_start: earliest,
      window_end: now,
      message_count: inWindow.length,
      tokens: { ...totals, total: totals.input_tokens + totals.output_tokens + totals.cache_creation_input_tokens + totals.cache_read_input_tokens },
      by_model: byModel,
    };
  }

  function render(data) {
    content.innerHTML = "";

    const stats = document.createElement("div");
    stats.className = "usage-stats";
    const tiles = [
      ["Messages (last 5h)", fmt(data.message_count)],
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

    if (data.window_start) {
      const p = document.createElement("p");
      p.className = "status-line";
      p.textContent = `Window: ${new Date(data.window_start).toLocaleTimeString()} – ${new Date(data.window_end).toLocaleTimeString()}`;
      content.appendChild(p);
    }

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
      const { events } = await window.UsageSource.readUsageEntries(handle);
      render(summarize(events));
    } catch (err) {
      console.error("Failed to read usage logs:", err);
      connectView();
    }
  }

  window.Usage = { onShow: loadUsage };
})();
