(function () {
  const TABS = ["repos", "usage"];

  function activateTab(name) {
    if (!TABS.includes(name)) name = "repos";
    for (const t of TABS) {
      document.getElementById(`tab-btn-${t}`).classList.toggle("active", t === name);
      document.getElementById(`tab-${t}`).hidden = t !== name;
    }
    if (name === "repos" && window.Repos) window.Repos.onShow();
    if (name === "usage" && window.Usage) window.Usage.onShow();
  }

  function tabFromHash() {
    return (location.hash || "#repos").slice(1);
  }

  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    location.hash = btn.dataset.tab;
  });

  window.addEventListener("hashchange", () => activateTab(tabFromHash()));

  document.addEventListener("DOMContentLoaded", async () => {
    if (window.Auth) {
      await window.Auth.handleRedirectIfPresent();
      window.Auth.renderAuthArea();
    }
    activateTab(tabFromHash());
  });
})();
