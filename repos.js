(function () {
  const listEl = document.getElementById("repos-list");
  const signedOutEl = document.getElementById("repos-signed-out");
  const statusEl = document.getElementById("repos-status");
  const template = document.getElementById("repo-card-template");
  const toolbarEl = document.getElementById("repos-toolbar");
  const searchEl = document.getElementById("repos-search");
  const sortEl = document.getElementById("repos-sort");
  const emptyFilteredEl = document.getElementById("repos-empty-filtered");

  let loaded = false;
  let allRepos = [];
  const cardsByFullName = new Map();

  // GitHub's own linguist colors for common languages; unlisted languages
  // fall back to a neutral dot rather than a guessed/generated color.
  const LANGUAGE_COLORS = {
    JavaScript: "#f1e05a",
    TypeScript: "#3178c6",
    Python: "#3572A5",
    Go: "#00ADD8",
    Rust: "#dea584",
    Java: "#b07219",
    C: "#555555",
    "C++": "#f34b7d",
    "C#": "#178600",
    Ruby: "#701516",
    PHP: "#4F5D95",
    Swift: "#F05138",
    Kotlin: "#A97BFF",
    HTML: "#e34c26",
    CSS: "#563d7c",
    Shell: "#89e051",
    "Objective-C": "#438eff",
    Dart: "#00B4AB",
    Scala: "#c22d40",
    Elixir: "#6e4a7e",
    Haskell: "#5e5086",
    Vue: "#41b883",
    "Jupyter Notebook": "#DA5B0B",
  };

  const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  function relativeTime(dateStr) {
    const diffSec = Math.round((new Date(dateStr) - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) return relativeTimeFormatter.format(diffSec, "second");
    const diffMin = Math.round(diffSec / 60);
    if (Math.abs(diffMin) < 60) return relativeTimeFormatter.format(diffMin, "minute");
    const diffHr = Math.round(diffMin / 60);
    if (Math.abs(diffHr) < 24) return relativeTimeFormatter.format(diffHr, "hour");
    const diffDay = Math.round(diffHr / 24);
    if (Math.abs(diffDay) < 30) return relativeTimeFormatter.format(diffDay, "day");
    const diffMonth = Math.round(diffDay / 30);
    if (Math.abs(diffMonth) < 12) return relativeTimeFormatter.format(diffMonth, "month");
    return relativeTimeFormatter.format(Math.round(diffMonth / 12), "year");
  }

  const SORTERS = {
    updated: (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
    stars: (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0),
    name: (a, b) => a.full_name.localeCompare(b.full_name),
  };

  function matchesQuery(repo, query) {
    if (!query) return true;
    return (
      repo.full_name.toLowerCase().includes(query) ||
      (repo.description || "").toLowerCase().includes(query)
    );
  }

  function applyFilters() {
    const query = searchEl.value.trim().toLowerCase();
    const sortFn = SORTERS[sortEl.value] || SORTERS.updated;
    const filtered = allRepos.filter((r) => matchesQuery(r, query)).sort(sortFn);

    for (const repo of filtered) {
      const card = cardsByFullName.get(repo.full_name);
      if (card) {
        card.hidden = false;
        listEl.appendChild(card); // moves existing node — doesn't recreate it or re-trigger its summary fetch
      }
    }
    for (const repo of allRepos) {
      if (!filtered.includes(repo)) {
        const card = cardsByFullName.get(repo.full_name);
        if (card) card.hidden = true;
      }
    }

    emptyFilteredEl.hidden = filtered.length > 0 || allRepos.length === 0;
  }

  searchEl.addEventListener("input", applyFilters);
  sortEl.addEventListener("change", applyFilters);

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
    cardsByFullName.clear();
    allRepos = [];
    toolbarEl.hidden = true;
    emptyFilteredEl.hidden = true;
    searchEl.value = "";
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
      allRepos = repos;
      for (const repo of repos) {
        renderCard(repo, token);
      }
      toolbarEl.hidden = false;
      applyFilters();
    } catch (err) {
      setStatus(err.message || "Failed to load repositories.", true);
      loaded = false;
    }
  }

  function renderCard(repo, token) {
    const node = template.content.cloneNode(true);
    const article = node.querySelector(".repo-card");
    const nameLink = article.querySelector(".repo-name");
    nameLink.textContent = repo.full_name;
    nameLink.href = repo.html_url;

    article.querySelector(".repo-visibility").textContent = repo.private ? "private" : "public";
    article.querySelector(".badge-fork").hidden = !repo.fork;
    article.querySelector(".badge-archived").hidden = !repo.archived;

    const topicsEl = article.querySelector(".repo-topics");
    if (Array.isArray(repo.topics) && repo.topics.length > 0) {
      topicsEl.hidden = false;
      for (const topic of repo.topics.slice(0, 6)) {
        const li = document.createElement("li");
        li.textContent = topic;
        topicsEl.appendChild(li);
      }
    }

    const langDot = article.querySelector(".lang-dot");
    if (repo.language) {
      langDot.hidden = false;
      langDot.style.background = LANGUAGE_COLORS[repo.language] || "var(--text-dim)";
    }
    article.querySelector(".lang-name").textContent = repo.language || "—";

    article.querySelector(".repo-stars").textContent = repo.stargazers_count ?? "—";

    const updatedEl = article.querySelector(".repo-updated");
    if (repo.updated_at) {
      updatedEl.textContent = relativeTime(repo.updated_at);
      updatedEl.title = new Date(repo.updated_at).toLocaleString();
    } else {
      updatedEl.textContent = "—";
    }

    const vscodeLink = article.querySelector(".vscode-link");
    vscodeLink.href = `vscode://vscode.git/clone?url=${encodeURIComponent(repo.clone_url)}`;

    const githubLink = article.querySelector(".github-link");
    githubLink.href = repo.html_url;

    const summaryEl = article.querySelector(".repo-summary");
    cardsByFullName.set(repo.full_name, article);
    listEl.appendChild(article); // initial placement; applyFilters() reorders

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
