(function () {
  const listEl = document.getElementById("repos-list");
  const signedOutEl = document.getElementById("repos-signed-out");
  const statusEl = document.getElementById("repos-status");
  const template = document.getElementById("repo-card-template");

  let loaded = false;

  function setStatus(text, isError) {
    if (!text) {
      statusEl.hidden = true;
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.classList.toggle("error", !!isError);
  }

  function reset() {
    loaded = false;
    listEl.innerHTML = "";
    setStatus("");
  }

  async function onShow() {
    const token = window.Auth.getToken();
    signedOutEl.hidden = !!token;
    if (!token || loaded) return;
    loaded = true;
    await loadRepos(token);
  }

  async function fetchAllRepos(token) {
    let url = "https://api.github.com/user/repos?per_page=100&sort=updated";
    const repos = [];
    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        window.Auth.logout();
        throw new Error("Session expired. Please log in again.");
      }

      if (res.status === 403 && res.headers.get("X-RateLimit-Remaining") === "0") {
        const resetAt = new Date(Number(res.headers.get("X-RateLimit-Reset")) * 1000);
        throw new Error(`GitHub API rate limit hit. Resets at ${resetAt.toLocaleTimeString()}.`);
      }

      if (!res.ok) {
        throw new Error(`GitHub API returned ${res.status}`);
      }

      repos.push(...(await res.json()));

      const link = res.headers.get("Link") || "";
      const next = link.split(",").find((p) => p.includes('rel="next"'));
      url = next ? next.split(";")[0].trim().slice(1, -1) : null;
    }
    return repos;
  }

  async function loadRepos(token) {
    setStatus("Loading repos…");
    listEl.innerHTML = "";
    try {
      const repos = await fetchAllRepos(token);
      setStatus("");
      if (repos.length === 0) {
        setStatus("No repositories found.");
        return;
      }
      for (const repo of repos) {
        renderCard(repo, token);
      }
    } catch (err) {
      setStatus(err.message || "Failed to load repositories.", true);
      loaded = false;
    }
  }

  function renderCard(repo, token) {
    const node = template.content.cloneNode(true);
    const nameLink = node.querySelector(".repo-name");
    nameLink.textContent = repo.full_name;
    nameLink.href = repo.html_url;

    node.querySelector(".repo-visibility").textContent = repo.private ? "private" : "public";
    node.querySelector(".repo-language").textContent = repo.language || "—";
    node.querySelector(".repo-stars").textContent = repo.stargazers_count ?? "—";
    node.querySelector(".repo-updated").textContent = repo.updated_at
      ? new Date(repo.updated_at).toLocaleDateString()
      : "—";

    const vscodeLink = node.querySelector(".vscode-link");
    vscodeLink.href = `vscode://vscode.git/clone?url=${encodeURIComponent(repo.clone_url)}`;

    const githubLink = node.querySelector(".github-link");
    githubLink.href = repo.html_url;

    const summaryEl = node.querySelector(".repo-summary");
    listEl.appendChild(node);

    requestSummary(repo, token, summaryEl);
  }

  const CACHE_PREFIX = "cgih_summary_";

  function cacheKey(repo) {
    return `${CACHE_PREFIX}${repo.full_name}_${repo.updated_at}`;
  }

  function clearRetryButton(summaryEl) {
    const next = summaryEl.nextElementSibling;
    if (next && next.classList.contains("retry-btn")) next.remove();
  }

  async function requestSummary(repo, token, summaryEl) {
    clearRetryButton(summaryEl);
    const key = cacheKey(repo);
    const cached = localStorage.getItem(key);
    if (cached) {
      summaryEl.textContent = cached;
      return;
    }

    const cfg = window.CGIH_CONFIG;
    if (!cfg.WORKER_URL) {
      summaryEl.textContent = "Summary unavailable (WORKER_URL not configured).";
      summaryEl.classList.add("error");
      return;
    }

    try {
      const res = await fetch(`${cfg.WORKER_URL}/summarize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ full_name: repo.full_name, description: repo.description }),
      });
      if (!res.ok) throw new Error(`Worker returned ${res.status}`);
      const data = await res.json();
      if (data.summary) {
        localStorage.setItem(key, data.summary);
        summaryEl.textContent = data.summary;
      } else {
        summaryEl.textContent = "No README or description available for this repository.";
      }
    } catch (err) {
      summaryEl.textContent = "Summary unavailable.";
      summaryEl.classList.add("error");
      const retryBtn = document.createElement("button");
      retryBtn.className = "retry-btn";
      retryBtn.textContent = "Retry";
      retryBtn.addEventListener("click", () => {
        summaryEl.classList.remove("error");
        summaryEl.textContent = "Generating summary…";
        requestSummary(repo, token, summaryEl);
      });
      summaryEl.after(retryBtn);
    }
  }

  window.Repos = { onShow, reset };
})();
