// Theme toggle + nav highlighting.
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

document.addEventListener("DOMContentLoaded", function () {
  // Highlight the current page in the nav.
  var path = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach(function (a) {
    var href = a.getAttribute("href");
    if (href === path || (path === "" && href === "index.html")) {
      a.classList.add("active");
    }
  });

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
