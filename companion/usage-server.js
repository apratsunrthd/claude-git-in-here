// Local usage companion for "Claude, git in here!"
// Reads Claude Code's local session logs and serves a rolling 5-hour usage
// summary over HTTP so the hosted (static) frontend can read it via
// http://localhost:PORT — browsers exempt localhost from mixed-content
// blocking, so an https:// page can fetch this directly.
//
// Zero external dependencies — Node built-ins only.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 4317;
const WINDOW_HOURS = 5;
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// Example per-million-token USD rates. These are placeholders — edit them to
// match your actual plan/pricing before trusting the dollar estimate. The
// API response always marks this as an estimate; the frontend must display
// it as such.
const PRICING_USD_PER_MTOK = {
  default: { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
};

function priceFor(model) {
  return PRICING_USD_PER_MTOK[model] || PRICING_USD_PER_MTOK.default;
}

function listJsonlFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listJsonlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(full);
    }
  }
  return results;
}

function readUsageEntries() {
  const entries = [];
  for (const file of listJsonlFiles(PROJECTS_DIR)) {
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type !== "assistant") continue;
      const msg = obj.message;
      if (!msg || msg.model === "<synthetic>" || !msg.usage) continue;
      entries.push({
        timestamp: obj.timestamp,
        model: msg.model,
        usage: msg.usage,
      });
    }
  }
  return entries;
}

function summarize(entries) {
  const now = Date.now();
  const windowStartMs = now - WINDOW_HOURS * 60 * 60 * 1000;

  const inWindow = entries.filter((e) => {
    const t = Date.parse(e.timestamp);
    return !Number.isNaN(t) && t >= windowStartMs && t <= now;
  });

  const totals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const byModel = {};
  let estimatedCost = 0;
  let earliest = null;

  for (const e of inWindow) {
    const u = e.usage;
    const input = u.input_tokens || 0;
    const output = u.output_tokens || 0;
    const cacheWrite = u.cache_creation_input_tokens || 0;
    const cacheRead = u.cache_read_input_tokens || 0;

    totals.input_tokens += input;
    totals.output_tokens += output;
    totals.cache_creation_input_tokens += cacheWrite;
    totals.cache_read_input_tokens += cacheRead;

    const price = priceFor(e.model);
    estimatedCost +=
      (input / 1e6) * price.input +
      (output / 1e6) * price.output +
      (cacheWrite / 1e6) * price.cache_write +
      (cacheRead / 1e6) * price.cache_read;

    if (!byModel[e.model]) {
      byModel[e.model] = { message_count: 0, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    }
    byModel[e.model].message_count += 1;
    byModel[e.model].input_tokens += input;
    byModel[e.model].output_tokens += output;
    byModel[e.model].cache_creation_input_tokens += cacheWrite;
    byModel[e.model].cache_read_input_tokens += cacheRead;

    const t = Date.parse(e.timestamp);
    if (earliest === null || t < earliest) earliest = t;
  }

  return {
    generated_at: new Date(now).toISOString(),
    window_hours: WINDOW_HOURS,
    window_start: earliest ? new Date(earliest).toISOString() : null,
    window_end: new Date(now).toISOString(),
    message_count: inWindow.length,
    tokens: {
      ...totals,
      total: totals.input_tokens + totals.output_tokens + totals.cache_creation_input_tokens + totals.cache_read_input_tokens,
    },
    estimated_cost_usd: Number(estimatedCost.toFixed(4)),
    pricing_is_estimate: true,
    by_model: byModel,
  };
}

const server = http.createServer((req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/usage") {
    try {
      const summary = summarize(readUsageEntries());
      res.writeHead(200, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(summary));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Claude usage companion listening on http://localhost:${PORT}/usage`);
  console.log(`Reading session logs from ${PROJECTS_DIR}`);
});
