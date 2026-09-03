// Highlights the current page in the nav.
(function () {
  var path = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach(function (a) {
    var href = a.getAttribute("href");
    if (href === path || (path === "" && href === "index.html")) {
      a.classList.add("active");
    }
  });
})();

// Draws a small decorative sparkline into any <svg class="sparkline" data-points="...">.
// Points are illustrative trend shapes, not exact production metrics.
(function () {
  document.querySelectorAll("svg.sparkline[data-points]").forEach(function (svg) {
    var raw = svg.getAttribute("data-points").split(",").map(Number);
    var w = 260, h = 40, pad = 4;
    var min = Math.min.apply(null, raw), max = Math.max.apply(null, raw);
    var range = max - min || 1;
    var step = (w - pad * 2) / (raw.length - 1);

    var pts = raw.map(function (v, i) {
      var x = pad + i * step;
      var y = h - pad - ((v - min) / range) * (h - pad * 2);
      return [x, y];
    });

    var linePath = "M " + pts.map(function (p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" L ");
    var areaPath = linePath + " L " + pts[pts.length - 1][0].toFixed(1) + " " + h + " L " + pts[0][0].toFixed(1) + " " + h + " Z";

    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("preserveAspectRatio", "none");

    var ns = "http://www.w3.org/2000/svg";
    var area = document.createElementNS(ns, "path");
    area.setAttribute("d", areaPath);
    area.setAttribute("fill", "var(--spark-fill)");
    area.setAttribute("stroke", "none");

    var line = document.createElementNS(ns, "path");
    line.setAttribute("d", linePath);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "var(--spark-line)");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");

    var dot = document.createElementNS(ns, "circle");
    var last = pts[pts.length - 1];
    dot.setAttribute("cx", last[0]);
    dot.setAttribute("cy", last[1]);
    dot.setAttribute("r", "3");
    dot.setAttribute("fill", "var(--spark-line)");

    svg.appendChild(area);
    svg.appendChild(line);
    svg.appendChild(dot);
  });
})();
