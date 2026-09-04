// Theme toggle + nav highlighting + homepage project tabs (Work / Personal).
// The early no-flash theme read lives inline in <head> on every page —
// this file handles the button itself once the DOM is ready.

function currentTheme() {
  var attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function setToggleIcon(btn) {
  if (!btn) return;
  var isDark = currentTheme() === "dark";
  btn.textContent = isDark ? "☀️" : "🌙";
  btn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
}

// Only present on index.html. Reads the URL hash (#work-projects /
// #personal-projects) so the nav links from other pages land on the right
// tab, defaults to Work Projects otherwise.
function initProjectTabs() {
  var tabBtns = document.querySelectorAll(".project-tab-btn");
  if (!tabBtns.length) return null;

  function selectTab(tab) {
    tabBtns.forEach(function (btn) {
      btn.classList.toggle("selected", btn.dataset.projectTab === tab);
    });
    document.querySelectorAll(".project-tab-panel").forEach(function (panel) {
      panel.classList.toggle("hidden", panel.id !== tab);
    });
    document.querySelectorAll("[data-tab-link]").forEach(function (a) {
      a.classList.toggle("active", a.dataset.tabLink === tab);
    });
  }

  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tab = btn.dataset.projectTab;
      history.replaceState(null, "", "#" + tab);
      selectTab(tab);
    });
  });

  var initial = window.location.hash.replace("#", "");
  var validTabs = Array.prototype.map.call(tabBtns, function (b) { return b.dataset.projectTab; });
  selectTab(validTabs.indexOf(initial) !== -1 ? initial : validTabs[0]);
  return selectTab;
}

document.addEventListener("DOMContentLoaded", function () {
  var onTabsPage = !!initProjectTabs();

  // Highlight the current page/tab in the nav. Work/Personal Projects links
  // are handled inside initProjectTabs (only meaningful on index.html);
  // everything else highlights by matching the current filename.
  if (!onTabsPage) {
    var path = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav-links a:not([data-tab-link])").forEach(function (a) {
      var href = a.getAttribute("href");
      if (href === path || (path === "" && href === "index.html")) {
        a.classList.add("active");
      }
    });
  }

  // Dark/light toggle.
  var btn = document.getElementById("themeToggle");
  setToggleIcon(btn);
  if (btn) {
    btn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch (e) {}
      setToggleIcon(btn);
    });
  }
});
