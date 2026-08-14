const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const README_CHAR_LIMIT = 6000;

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

async function handleOAuthToken(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400, env);
  }
  const { code, redirect_uri } = body;
  if (!code || !redirect_uri) {
    return json({ error: "missing_code_or_redirect_uri" }, 400, env);
  }

  const ghRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "claude-git-in-here-relay",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri,
    }),
  });

  const data = await ghRes.json();
  if (data.error) {
    return json({ error: data.error, error_description: data.error_description }, 400, env);
  }
  if (!data.access_token) {
    return json({ error: "no_access_token_returned" }, 502, env);
  }
  return json({ access_token: data.access_token }, 200, env);
}

async function fetchReadme(fullName, token) {
  const res = await fetch(`https://api.github.com/repos/${fullName}/readme`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw+json",
      "User-Agent": "claude-git-in-here-relay",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub readme fetch failed: ${res.status}`);
  return await res.text();
}

async function summarizeWithClaude(env, fullName, description, readme) {
  const readmeExcerpt = (readme || "").slice(0, README_CHAR_LIMIT);
  const prompt = [
    `Repository: ${fullName}`,
    description ? `Description: ${description}` : null,
    readmeExcerpt ? `README (may be truncated):\n${readmeExcerpt}` : null,
    "\nWrite a single concise paragraph (2-3 sentences) summarizing what this repository is and does, for a developer skimming their own repo list. No preamble, no markdown, just the paragraph.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return textBlock ? textBlock.text.trim() : null;
}

async function handleSummarize(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400, env);
  }
  const { full_name, description } = body;
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!full_name || !token) {
    return json({ error: "missing_full_name_or_token" }, 400, env);
  }

  let readme = null;
  try {
    readme = await fetchReadme(full_name, token);
  } catch (err) {
    // Non-fatal: fall back to description-only summarization.
    readme = null;
  }

  if (!readme && !description) {
    return json({ summary: null, reason: "no_content" }, 200, env);
  }

  try {
    const summary = await summarizeWithClaude(env, full_name, description, readme);
    return json({ summary }, 200, env);
  } catch (err) {
    return json({ error: "summarize_failed", message: String(err) }, 502, env);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/oauth/token") {
      return handleOAuthToken(request, env);
    }
    if (request.method === "POST" && url.pathname === "/summarize") {
      return handleSummarize(request, env);
    }
    return json({ error: "not_found" }, 404, env);
  },
};
