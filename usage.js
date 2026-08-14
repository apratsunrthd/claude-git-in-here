(function () {
  const content = document.getElementById("usage-content");

  function fmt(n) {
    return Number(n).toLocaleString();
  }

  const SEVERITY_LABEL = {
    good: "On track",
    warning: "Approaching your limit",
    serious: "Close to your limit",
    critical: "At or over your limit",
  };

  // Fixed hue order, matching the app's validated categorical palette.
  const COMPOSITION_SEGMENTS = [
    { key: "input_tokens", label: "Input", color: "#3987e5" },
    { key: "output_tokens", label: "Output", color: "#d95926" },
    { key: "cache_read_input_tokens", label: "Cache read", color: "#199e70" },
    { key: "cache_creation_input_tokens", label: "Cache write", color: "#c98500" },
  ];

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

    const overrideEnd = window.UsageCalibration.loadResetOverride();
    let block, boundarySource;
    if (overrideEnd) {
      block = window.UsageBlocks.buildBlockForWindow(events, overrideEnd - window.UsageBlocks.SPAN_MS, overrideEnd);
      boundarySource = "override";
    } else {
      block = window.UsageBlocks.currentBlock(blocks, now);
      boundarySource = "derived";
    }

    if (!block) {
      return { active: false, window_end: now };
    }

    const byModel = {};
    for (const [model, count] of Object.entries(block.byModel)) {
      byModel[model] = { message_count: count };
    }

    const budget = window.UsageCalibration.resolveBudget(blocks);
    const cost = window.UsageCalibration.costEquivalent(block.tokens);
    const ratio = budget.budget > 0 ? cost / budget.budget : 0;

    return {
      active: true,
      boundarySource,
      window_start: block.start,
      window_end: block.end,
      message_count: block.messageCount,
      tokens: { ...block.tokens, total: block.tokens.input_tokens + block.tokens.output_tokens + block.tokens.cache_creation_input_tokens + block.tokens.cache_read_input_tokens },
      by_model: byModel,
      cost,
      budget,
      ratio,
      severity: window.UsageCalibration.severity(ratio),
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

    const pct = Math.round(data.ratio * 100);
    const fillWidth = Math.max(0, Math.min(1, data.ratio)) * 100;

    const quotaCard = document.createElement("div");
    quotaCard.className = "quota-card";
    quotaCard.innerHTML = `
      <div class="quota-headline">
        <span class="quota-pct">${pct}%</span>
        <span class="quota-label" data-severity="${data.severity}">${SEVERITY_LABEL[data.severity]}</span>
      </div>
      <div class="quota-track">
        <div class="quota-fill" data-severity="${data.severity}" style="width:${fillWidth}%"></div>
      </div>
      <p class="quota-detail">${data.budget.detail}</p>
    `;
    content.appendChild(quotaCard);

    const composition = document.createElement("div");
    composition.className = "composition-bar";
    const total = data.tokens.total || 1;
    for (const seg of COMPOSITION_SEGMENTS) {
      const value = data.tokens[seg.key] || 0;
      if (value <= 0) continue;
      const el = document.createElement("div");
      el.className = "segment";
      el.style.width = `${(value / total) * 100}%`;
      el.style.background = seg.color;
      el.title = `${seg.label}: ${fmt(value)} tokens`;
      composition.appendChild(el);
    }
    content.appendChild(composition);

    const legend = document.createElement("ul");
    legend.className = "composition-legend";
    for (const seg of COMPOSITION_SEGMENTS) {
      const value = data.tokens[seg.key] || 0;
      const li = document.createElement("li");
      li.innerHTML = `<span class="swatch" style="background:${seg.color}"></span>${seg.label}: ${fmt(value)}`;
      legend.appendChild(li);
    }
    content.appendChild(legend);

    const calForm = document.createElement("form");
    calForm.className = "calibrate-form";
    calForm.innerHTML = `
      <label>What % does your Claude usage indicator (<code>/usage</code>) show right now?
        <input type="number" min="0" max="500" step="1" name="pct" required />
      </label>
      <button type="submit">Calibrate</button>
    `;
    calForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const pct = Number(new FormData(calForm).get("pct"));
      if (pct > 0) {
        window.UsageCalibration.saveCalibration(pct, data.cost);
        loadUsage();
      }
    });
    content.appendChild(calForm);

    const stats = document.createElement("div");
    stats.className = "usage-stats";
    const tiles = [
      ["Messages (this window)", fmt(data.message_count)],
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
    const boundaryNote = data.boundarySource === "override" ? " (from your reset-time override)" : "";
    p.textContent = `Window opened ${new Date(data.window_start).toLocaleTimeString()} — resets at ${new Date(data.window_end).toLocaleTimeString()}${boundaryNote}`;
    content.appendChild(p);

    const resetForm = document.createElement("form");
    resetForm.className = "calibrate-form";
    resetForm.innerHTML = `
      <label>From Settings → Usage on claude.ai, enter the countdown it shows ("Resets in X hr Y min"):
        <input type="number" min="0" max="5" step="1" name="hours" placeholder="h" style="width:3.5em" />
        <input type="number" min="0" max="59" step="1" name="minutes" placeholder="m" style="width:3.5em" />
      </label>
      <button type="submit">Set override</button>
      <button type="button" class="clear-override-btn">Clear override</button>
    `;
    resetForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(resetForm);
      const hours = Number(fd.get("hours") || 0);
      const minutes = Number(fd.get("minutes") || 0);
      if (hours || minutes) {
        window.UsageCalibration.saveResetOverride(hours, minutes);
        loadUsage();
      }
    });
    resetForm.querySelector(".clear-override-btn").addEventListener("click", () => {
      window.UsageCalibration.clearResetOverride();
      loadUsage();
    });
    content.appendChild(resetForm);

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
