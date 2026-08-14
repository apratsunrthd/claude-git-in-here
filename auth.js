(function () {
  const TOKEN_KEY = "cgih_gh_token";
  const USER_KEY = "cgih_gh_user";
  const STATE_KEY = "cgih_oauth_state";

  function showGlobalError(message) {
    const el = document.getElementById("global-error");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  function redirectUri() {
    return location.origin + location.pathname;
  }

  function randomState() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getCachedUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    renderAuthArea();
    if (window.Repos) window.Repos.reset();
  }

  function startLogin() {
    const cfg = window.CGIH_CONFIG;
    if (!cfg.GITHUB_CLIENT_ID) {
      alert("GITHUB_CLIENT_ID is not set in config.js yet.");
      return;
    }
    const state = randomState();
    sessionStorage.setItem(STATE_KEY, state);
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", cfg.GITHUB_CLIENT_ID);
    url.searchParams.set("scope", cfg.GITHUB_SCOPE || "repo");
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("state", state);
    location.href = url.toString();
  }

  async function handleRedirectIfPresent() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code) return;

    const expectedState = sessionStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);

    // Strip code/state from the URL regardless of outcome, preserving the hash tab.
    const cleanUrl = redirectUri() + (location.hash || "");
    history.replaceState({}, "", cleanUrl);

    if (!state || state !== expectedState) {
      showGlobalError("Login failed: OAuth state mismatch. Please try logging in again.");
      return;
    }

    const cfg = window.CGIH_CONFIG;
    if (!cfg.WORKER_URL) {
      showGlobalError("Login failed: WORKER_URL is not set in config.js.");
      return;
    }

    try {
      const res = await fetch(`${cfg.WORKER_URL}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, redirect_uri: redirectUri() }),
      });
      if (!res.ok) throw new Error(`Worker returned ${res.status}`);
      const data = await res.json();
      if (!data.access_token) throw new Error("No access_token in response");
      localStorage.setItem(TOKEN_KEY, data.access_token);
      await fetchAndCacheUser();
    } catch (err) {
      console.error("GitHub OAuth token exchange failed:", err);
      showGlobalError("Login failed. Please try again — see console for details.");
    }
  }

  async function fetchAndCacheUser() {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        logout();
        return null;
      }
      if (!res.ok) throw new Error(`GitHub /user returned ${res.status}`);
      const user = await res.json();
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return user;
    } catch (err) {
      console.error("Failed to fetch GitHub user:", err);
      return getCachedUser();
    }
  }

  function renderAuthArea() {
    const area = document.getElementById("auth-area");
    const token = getToken();
    if (!token) {
      area.innerHTML = "";
      const btn = document.createElement("button");
      btn.textContent = "Log in with GitHub";
      btn.addEventListener("click", startLogin);
      area.appendChild(btn);
      return;
    }

    const user = getCachedUser();
    area.innerHTML = "";
    const chip = document.createElement("div");
    chip.className = "user-chip";
    if (user && user.avatar_url) {
      const img = document.createElement("img");
      img.src = user.avatar_url;
      img.alt = "";
      chip.appendChild(img);
    }
    const name = document.createElement("span");
    name.textContent = user ? user.login : "Signed in";
    chip.appendChild(name);
    const logoutBtn = document.createElement("button");
    logoutBtn.className = "logout-link";
    logoutBtn.textContent = "Log out";
    logoutBtn.addEventListener("click", logout);
    chip.appendChild(logoutBtn);
    area.appendChild(chip);

    if (!user) fetchAndCacheUser().then(renderAuthArea);
  }

  window.Auth = {
    getToken,
    logout,
    startLogin,
    handleRedirectIfPresent,
    renderAuthArea,
  };
})();
