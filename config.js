// Non-secret, public config. Safe to commit — no secrets belong in this file.
window.CGIH_CONFIG = {
  // GitHub OAuth App client ID (public identifier, not the secret).
  // Fill in after creating the OAuth App at https://github.com/settings/developers
  GITHUB_CLIENT_ID: "",

  // OAuth scope. "repo" includes private repos (read+write grant, though this
  // app only ever issues GET requests). Use "public_repo" to restrict to public repos.
  GITHUB_SCOPE: "repo",

  // Cloudflare Worker relay URL, e.g. "https://claude-git-in-here.<subdomain>.workers.dev"
  // Fill in after `wrangler deploy`.
  WORKER_URL: "",

  // Local usage companion script endpoint.
  COMPANION_URL: "http://localhost:4317",
};
