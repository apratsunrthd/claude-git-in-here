(function () {
  const content = document.getElementById("usage-content");

  function fmt(n) {
    return Number(n).toLocaleString();
  }

  function notRunningView() {
    content.innerHTML = "";
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = `
      <p>Local usage companion isn't running (couldn't reach ${window.CGIH_CONFIG.COMPANION_URL}).</p>
      <p>Start it from the project directory:</p>
      <code class="companion-cmd">node companion/usage-server.js</code>
      <p><button id="usage-retry-btn">Try again</button></p>
    `;
    content.appendChild(div);
    document.getElementById("usage-retry-btn").addEventListener("click", loadUsage);
  }

  function render(data) {
    content.innerHTML = "";

    const banner = document.createElement("div");
    banner.className = "usage-banner";
    banner.textContent =
      "Estimate only: the 5-hour window is a rolling window from now, not necessarily aligned to Anthropic's actual reset boundary, and the dollar figure uses placeholder rates in companion/usage-server.js — edit them to match your plan.";
    content.appendChild(banner);

    const stats = document.createElement("div");
    stats.className = "usage-stats";
    const tiles = [
      ["Messages (last 5h)", fmt(data.message_count)],
      ["Input tokens", fmt(data.tokens.input_tokens)],
      ["Output tokens", fmt(data.tokens.output_tokens)],
      ["Cache read tokens", fmt(data.tokens.cache_read_input_tokens)],
      ["Cache write tokens", fmt(data.tokens.cache_creation_input_tokens)],
      ["Total tokens", fmt(data.tokens.total)],
      ["Estimated cost", `$${data.estimated_cost_usd.toFixed(2)}`],
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
        const m = data.by_model[model];
        const line = document.createElement("p");
        line.className = "status-line";
        line.textContent = `${model}: ${fmt(m.message_count)} messages, ${fmt(
          m.input_tokens + m.output_tokens + m.cache_creation_input_tokens + m.cache_read_input_tokens
        )} tokens`;
        content.appendChild(line);
      }
    }

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.addEventListener("click", loadUsage);
    content.appendChild(refreshBtn);
  }

  async function loadUsage() {
    content.innerHTML = '<p class="status-line">Loading…</p>';
    try {
      const res = await fetch(window.CGIH_CONFIG.COMPANION_URL + "/usage", {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) throw new Error(`Companion returned ${res.status}`);
      const data = await res.json();
      render(data);
    } catch (err) {
      notRunningView();
    }
  }

  window.Usage = { onShow: loadUsage };
})();
