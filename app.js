/**
 * Vanilla WoW Talent Calculator — single-file app.
 * Talent data comes from data/data.js (window.TALENT_DATA).
 */

(function () {
  "use strict";

  const CLASSES = [
    "druid",
    "hunter",
    "mage",
    "paladin",
    "priest",
    "rogue",
    "shaman",
    "warlock",
    "warrior",
  ];
  const POINT_CAP = 51;
  const GRID_COLS = 4;
  const GRID_ROWS = 7;
  // Preference order when auto-placing a talent whose JSON column is null.
  const CENTER_COLS = [1, 2, 0, 3];

  const state = {
    className: null,
    ranks: Object.create(null),
    placements: null,
    tooltipTalent: null,
  };

  const uiElements = {
    classPicker: document.getElementById("classPicker"),
    trees: document.getElementById("trees"),
    pointsSpent: document.getElementById("pointsSpent"),
    pointsCap: document.getElementById("pointsCap"),
    requiredLevel: document.getElementById("requiredLevel"),
    resetAllBtn: document.getElementById("resetAllBtn"),
    copyLinkBtn: document.getElementById("copyLinkBtn"),
    tooltip: document.getElementById("tooltip"),
  };

  /* ------------------------------------------------------------------ *
   * Data helpers
   * ------------------------------------------------------------------ */

  function currentData() {
    return state.className ? window.TALENT_DATA[state.className] : null;
  }

  function getTalent(name) {
    const data = currentData();
    if (!data) {
      return null;
    }
    return data.talents.find((t) => t.name === name) || null;
  }

  function talentsInTree(treeName) {
    const data = currentData();
    if (!data) {
      return [];
    }
    return data.talents.filter((t) => t.tree === treeName);
  }

  function pointsInTree(treeName) {
    let sum = 0;
    for (const t of talentsInTree(treeName)) {
      sum += state.ranks[t.name] || 0;
    }
    return sum;
  }

  function totalPoints() {
    let sum = 0;
    for (const name in state.ranks) {
      sum += state.ranks[name];
    }
    return sum;
  }

  /* ------------------------------------------------------------------ *
   * Rules
   * ------------------------------------------------------------------ */

  function unmetSpendReason(t) {
    const rank = state.ranks[t.name] || 0;
    if (rank >= t.maxRanks) {
      return "Already at maximum rank.";
    }
    if (totalPoints() >= POINT_CAP) {
      return `You have spent all ${POINT_CAP} points.`;
    }
    const treePts = pointsInTree(t.tree);
    if (treePts < t.treePointsRequired) {
      return `Requires ${t.treePointsRequired} points in ${t.tree} (currently ${treePts}).`;
    }
    for (const p of t.prereqs || []) {
      const have = state.ranks[p.name] || 0;
      if (have < p.points) {
        return `Requires ${p.points} points in ${p.name} (currently ${have}).`;
      }
    }
    return null;
  }

  function canSpend(t) {
    return unmetSpendReason(t) === null;
  }

  // Returns null if refundable; else the name of the downstream talent that would break.
  function refundBlocker(t) {
    const rank = state.ranks[t.name] || 0;
    if (rank <= 0) {
      return "__none__";
    }

    state.ranks[t.name] = rank - 1;
    const data = currentData();
    let blocker = null;
    for (const other of data.talents) {
      const otherRank = state.ranks[other.name] || 0;
      if (otherRank === 0) {
        continue;
      }
      if (other.treePointsRequired > pointsInTree(other.tree)) {
        blocker = other.name;
        break;
      }
      for (const p of other.prereqs || []) {
        if ((state.ranks[p.name] || 0) < p.points) {
          blocker = other.name;
          break;
        }
      }
      if (blocker) {
        break;
      }
    }
    state.ranks[t.name] = rank;
    return blocker;
  }

  function canRefund(t) {
    return refundBlocker(t) === null;
  }

  /* ------------------------------------------------------------------ *
   * Placement (resolve column: null → an actual grid column)
   * ------------------------------------------------------------------ */

  function buildPlacements(data) {
    const out = {};
    for (const treeName of data.trees) {
      const tierMap = Array.from({ length: GRID_ROWS + 1 }, () => new Set());
      const talents = data.talents.filter((t) => t.tree === treeName);

      const resolved = [];
      const deferred = [];
      for (const t of talents) {
        if (t.column === null || t.column === undefined) {
          deferred.push(t);
        } else {
          tierMap[t.tier].add(t.column);
          resolved.push({
            talent: t,
            row: t.tier,
            col: t.column,
            unverified: false,
          });
        }
      }
      for (const t of deferred) {
        let col = null;
        for (const c of CENTER_COLS) {
          if (!tierMap[t.tier].has(c)) {
            col = c;
            break;
          }
        }
        if (col === null) {
          for (let c = 0; c < GRID_COLS; c++) {
            if (!tierMap[t.tier].has(c)) {
              col = c;
              break;
            }
          }
        }
        if (col === null) {
          col = 1;
        }
        tierMap[t.tier].add(col);
        resolved.push({ talent: t, row: t.tier, col, unverified: true });
      }
      out[treeName] = resolved;
    }
    return out;
  }

  function findPlacement(treeName, talentName) {
    const list = state.placements[treeName] || [];
    return list.find((p) => p.talent.name === talentName) || null;
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */

  function updateActiveClassButton() {
    for (const btn of uiElements.classPicker.querySelectorAll(
      "button[data-class]",
    )) {
      btn.classList.toggle("active", btn.dataset.class === state.className);
    }
  }

  function renderTrees() {
    const data = currentData();
    uiElements.trees.innerHTML = "";
    if (!data) {
      const p = document.createElement("div");
      p.className = "placeholder";
      p.textContent = "Pick a class above to begin.";
      uiElements.trees.appendChild(p);
      return;
    }

    for (const treeName of data.trees) {
      uiElements.trees.appendChild(buildTreeSection(treeName));
    }
    window.requestAnimationFrame(drawAllArrows);
  }

  function buildTreeSection(treeName) {
    const section = document.createElement("section");
    section.className = "tree";
    section.dataset.tree = treeName;

    const header = document.createElement("header");
    header.className = "tree-header";

    const h2 = document.createElement("h2");
    h2.textContent = treeName;
    header.appendChild(h2);

    const pts = document.createElement("span");
    pts.className = "tree-points";
    pts.dataset.treePoints = treeName;
    pts.textContent = pointsInTree(treeName);
    header.appendChild(pts);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "btn reset-tree";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", () => resetTree(treeName));
    header.appendChild(resetBtn);

    section.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "tree-grid";
    grid.dataset.tree = treeName;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.classList.add("arrows");
    svg.setAttribute("preserveAspectRatio", "none");
    grid.appendChild(svg);

    for (const p of state.placements[treeName]) {
      grid.appendChild(buildCell(p));
    }

    section.appendChild(grid);
    return section;
  }

  function buildCell(placement) {
    const t = placement.talent;
    const cell = document.createElement("div");
    cell.className = "talent";
    cell.dataset.name = t.name;
    cell.dataset.tree = t.tree;
    cell.style.gridColumn = String(placement.col + 1);
    cell.style.gridRow = String(placement.row);

    const img = document.createElement("img");
    img.src = t.icon;
    img.alt = t.name;
    img.draggable = false;
    cell.appendChild(img);

    const badge = document.createElement("span");
    badge.className = "rank-badge";
    cell.appendChild(badge);

    if (placement.unverified) {
      const u = document.createElement("span");
      u.className = "unverified-badge";
      u.textContent = "?";
      u.title = "Position not verified against modern Wowhead calc.";
      cell.appendChild(u);
    }

    applyCellState(cell, t);

    cell.addEventListener("click", (ev) => {
      ev.preventDefault();
      trySpend(t);
    });
    cell.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      tryRefund(t);
    });
    cell.addEventListener("mouseenter", (ev) => showTooltip(t, ev));
    cell.addEventListener("mousemove", positionTooltip);
    cell.addEventListener("mouseleave", hideTooltip);

    return cell;
  }

  function applyCellState(cell, t) {
    const rank = state.ranks[t.name] || 0;
    cell.classList.remove("locked", "available", "active", "maxed");
    const badge = cell.querySelector(".rank-badge");
    if (rank >= t.maxRanks) {
      cell.classList.add("maxed");
    } else if (rank > 0) {
      cell.classList.add("active");
    } else if (canSpend(t)) {
      cell.classList.add("available");
    } else {
      cell.classList.add("locked");
    }
    badge.textContent = `${rank}/${t.maxRanks}`;
    badge.hidden = false;
  }

  function refreshCells() {
    const data = currentData();
    if (!data) {
      return;
    }
    const cells = uiElements.trees.querySelectorAll(".talent");
    for (const cell of cells) {
      const t = getTalent(cell.dataset.name);
      if (t) {
        applyCellState(cell, t);
      }
    }
    for (const treeName of data.trees) {
      const span = uiElements.trees.querySelector(
        `[data-tree-points="${cssEscape(treeName)}"]`,
      );
      if (span) {
        span.textContent = pointsInTree(treeName);
      }
    }
    uiElements.pointsSpent.textContent = totalPoints();
    updateRequiredLevel();
    drawAllArrows();
    updateTooltipIfOpen();
    writeHash();
  }

  // Players earn 1 talent point per level from 10 to 60. So N spent points -> level (9 + N).
  function updateRequiredLevel() {
    const n = totalPoints();
    uiElements.requiredLevel.textContent = n === 0 ? "—" : String(9 + n);
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) {
      return CSS.escape(s);
    }
    return s.replace(/([^\w-])/g, "\\$1");
  }

  /* ------------------------------------------------------------------ *
   * Arrows
   * ------------------------------------------------------------------ */

  function drawAllArrows() {
    const data = currentData();
    if (!data) {
      return;
    }
    for (const treeName of data.trees) {
      drawTreeArrows(treeName);
    }
  }

  function drawTreeArrows(treeName) {
    const grid = uiElements.trees.querySelector(
      `.tree-grid[data-tree="${cssEscape(treeName)}"]`,
    );
    if (!grid) {
      return;
    }
    const svg = grid.querySelector("svg.arrows");
    if (!svg) {
      return;
    }

    const rect = grid.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    svg.setAttribute("width", rect.width);
    svg.setAttribute("height", rect.height);
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }

    const talents = talentsInTree(treeName);
    for (const t of talents) {
      for (const p of t.prereqs || []) {
        const from = grid.querySelector(
          `.talent[data-name="${cssEscape(p.name)}"]`,
        );
        const to = grid.querySelector(
          `.talent[data-name="${cssEscape(t.name)}"]`,
        );
        if (!from || !to) {
          continue;
        }
        drawArrow(
          svg,
          rectRelativeTo(from.getBoundingClientRect(), rect),
          rectRelativeTo(to.getBoundingClientRect(), rect),
          (state.ranks[p.name] || 0) >= p.points,
        );
      }
    }
  }

  function rectRelativeTo(r, base) {
    const left = r.left - base.left;
    const top = r.top - base.top;
    return {
      left,
      top,
      right: left + r.width,
      bottom: top + r.height,
      cx: left + r.width / 2,
      cy: top + r.height / 2,
    };
  }

  // Draws an orthogonal (right-angle) arrow from prereq cell to target cell.
  // Emerges from whichever side is closest to target and enters the opposite side.
  function drawArrow(svg, from, to, satisfied) {
    const svgNS = "http://www.w3.org/2000/svg";
    const inset = 6; // gap before target edge so the arrowhead has room
    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    const sameCol = Math.abs(dx) < 2;
    const sameRow = Math.abs(dy) < 2;

    let startX, startY, endX, endY, cornerX, cornerY, arrowDir;

    if (sameCol) {
      startX = from.cx;
      endX = to.cx;
      if (dy >= 0) {
        startY = from.bottom;
        endY = to.top - inset;
        arrowDir = "down";
      } else {
        startY = from.top;
        endY = to.bottom + inset;
        arrowDir = "up";
      }
    } else if (sameRow) {
      startY = from.cy;
      endY = to.cy;
      if (dx > 0) {
        startX = from.right;
        endX = to.left - inset;
        arrowDir = "right";
      } else {
        startX = from.left;
        endX = to.right + inset;
        arrowDir = "left";
      }
    } else {
      // L-shape: leave prereq on its left/right edge, corner at (target column, prereq row),
      // enter target on its top/bottom edge.
      startY = from.cy;
      if (dx > 0) {
        startX = from.right;
      } else {
        startX = from.left;
      }
      cornerX = to.cx;
      cornerY = from.cy;
      endX = to.cx;
      if (dy > 0) {
        endY = to.top - inset;
        arrowDir = "down";
      } else {
        endY = to.bottom + inset;
        arrowDir = "up";
      }
    }

    const g = document.createElementNS(svgNS, "g");
    const color = satisfied ? "#d4b25a" : "#5a4d34";
    g.setAttribute("stroke", color);
    g.setAttribute("fill", color);
    g.setAttribute("stroke-width", "2");

    const line = document.createElementNS(svgNS, "path");
    const d =
      cornerX == null
        ? `M ${startX} ${startY} L ${endX} ${endY}`
        : `M ${startX} ${startY} L ${cornerX} ${cornerY} L ${endX} ${endY}`;
    line.setAttribute("d", d);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke-linejoin", "miter");
    if (!satisfied) {
      line.setAttribute("stroke-dasharray", "4 3");
    }
    g.appendChild(line);

    g.appendChild(makeArrowhead(svgNS, endX, endY, arrowDir));
    svg.appendChild(g);
  }

  function makeArrowhead(svgNS, x, y, dir) {
    const head = document.createElementNS(svgNS, "path");
    const s = 5; // half-width of arrowhead
    const l = 6; // length of arrowhead
    let d;
    switch (dir) {
      case "down":
        d = `M ${x - s} ${y} L ${x + s} ${y} L ${x} ${y + l} Z`;
        break;
      case "up":
        d = `M ${x - s} ${y} L ${x + s} ${y} L ${x} ${y - l} Z`;
        break;
      case "right":
        d = `M ${x} ${y - s} L ${x} ${y + s} L ${x + l} ${y} Z`;
        break;
      case "left":
        d = `M ${x} ${y - s} L ${x} ${y + s} L ${x - l} ${y} Z`;
        break;
    }
    head.setAttribute("d", d);
    head.setAttribute("stroke", "none");
    return head;
  }

  /* ------------------------------------------------------------------ *
   * Tooltip
   * ------------------------------------------------------------------ */

  function showTooltip(t, ev) {
    state.tooltipTalent = t;
    renderTooltip(t);
    uiElements.tooltip.hidden = false;
    positionTooltip(ev);
  }

  function updateTooltipIfOpen() {
    if (state.tooltipTalent) {
      renderTooltip(state.tooltipTalent);
    }
  }

  function classifyCastNote(note) {
    if (/^\d+\s+(Mana|Rage|Energy|Focus)$/i.test(note)) {
      return "resource";
    }
    if (/cooldown\s*$/i.test(note)) {
      return "cooldown";
    }
    if (/yard range\s*$/i.test(note)) {
      return "range";
    }
    if (/^(Instant|Instant cast|Next melee)$/i.test(note)) {
      return "cast";
    }
    if (/second\s+cast\s*$/i.test(note)) {
      return "cast";
    }
    if (/^Requires\b/i.test(note)) {
      return "req";
    }
    return "other";
  }

  function renderCastNotes(notes) {
    const buckets = {
      resource: [],
      cast: [],
      cooldown: [],
      range: [],
      req: [],
      other: [],
    };
    for (const n of notes) {
      buckets[classifyCastNote(n)].push(n);
    }

    const rows = [];
    const splitRow = (left, right) => {
      if (!left.length && !right.length) {
        return;
      }
      rows.push(
        `<div class="tt-line"><span>${escapeHtml(left.join(", "))}</span><span class="r">${escapeHtml(right.join(", "))}</span></div>`,
      );
    };
    splitRow(buckets.resource, buckets.range);
    splitRow(buckets.cast, buckets.cooldown);
    for (const r of buckets.req) {
      rows.push(`<div>${escapeHtml(r)}</div>`);
    }
    for (const o of buckets.other) {
      rows.push(`<div>${escapeHtml(o)}</div>`);
    }

    if (!rows.length) {
      return "";
    }
    return `<div class="tt-cast">${rows.join("")}</div>`;
  }

  function renderTooltip(t) {
    const rank = state.ranks[t.name] || 0;
    const html = [];
    html.push(`<div class="tt-name">${escapeHtml(t.name)}</div>`);

    if (t.cast && t.cast.notes && t.cast.notes.length) {
      html.push(renderCastNotes(t.cast.notes));
    }

    if (rank > 0 && t.ranks[rank - 1]) {
      html.push(`<div class="tt-rank-label">Rank ${rank}</div>`);
      html.push(
        `<div class="tt-desc">${escapeHtml(t.ranks[rank - 1].description)}</div>`,
      );
    }
    if (rank < t.maxRanks && t.ranks[rank]) {
      html.push(`<div class="tt-next-label">Next rank (${rank + 1})</div>`);
      html.push(
        `<div class="tt-desc">${escapeHtml(t.ranks[rank].description)}</div>`,
      );
    }

    const reqs = [];
    if (t.treePointsRequired > 0) {
      const treePts = pointsInTree(t.tree);
      const ok = treePts >= t.treePointsRequired;
      reqs.push(
        `<span class="${ok ? "ok" : "bad"}">Requires ${t.treePointsRequired} pts in ${escapeHtml(t.tree)}</span>`,
      );
    }
    for (const p of t.prereqs || []) {
      const have = state.ranks[p.name] || 0;
      const ok = have >= p.points;
      reqs.push(
        `<span class="${ok ? "ok" : "bad"}">Requires ${p.points} pt${p.points === 1 ? "" : "s"} in ${escapeHtml(p.name)}</span>`,
      );
    }
    if (reqs.length) {
      html.push(`<div class="tt-req">${reqs.join("<br>")}</div>`);
    }

    if (rank > 0) {
      const blocker = refundBlocker(t);
      if (blocker && blocker !== "__none__") {
        html.push(
          `<div class="tt-block">Can't refund: would invalidate ${escapeHtml(blocker)}.</div>`,
        );
      }
    } else if (!canSpend(t)) {
      const reason = unmetSpendReason(t);
      if (reason) {
        html.push(`<div class="tt-block">${escapeHtml(reason)}</div>`);
      }
    }

    uiElements.tooltip.innerHTML = html.join("");
  }

  function positionTooltip(ev) {
    if (uiElements.tooltip.hidden) {
      return;
    }
    const pad = 14;
    const rect = uiElements.tooltip.getBoundingClientRect();
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    if (x + rect.width > window.innerWidth - 4) {
      x = ev.clientX - rect.width - pad;
    }
    if (y + rect.height > window.innerHeight - 4) {
      y = ev.clientY - rect.height - pad;
    }
    uiElements.tooltip.style.left = Math.max(4, x) + "px";
    uiElements.tooltip.style.top = Math.max(4, y) + "px";
  }

  function hideTooltip() {
    uiElements.tooltip.hidden = true;
    state.tooltipTalent = null;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ------------------------------------------------------------------ *
   * Actions
   * ------------------------------------------------------------------ */

  function trySpend(t) {
    if (!canSpend(t)) {
      return;
    }
    state.ranks[t.name] = (state.ranks[t.name] || 0) + 1;
    refreshCells();
  }

  function tryRefund(t) {
    if (!canRefund(t)) {
      return;
    }
    state.ranks[t.name] = (state.ranks[t.name] || 0) - 1;
    if (state.ranks[t.name] <= 0) {
      delete state.ranks[t.name];
    }
    refreshCells();
  }

  function resetTree(treeName) {
    for (const t of talentsInTree(treeName)) {
      delete state.ranks[t.name];
    }
    refreshCells();
  }

  function resetClass() {
    state.ranks = Object.create(null);
    refreshCells();
  }

  function switchClass(className) {
    if (state.className === className) {
      return;
    }
    state.className = className;
    state.ranks = Object.create(null);
    const data = currentData();
    state.placements = data ? buildPlacements(data) : null;
    updateActiveClassButton();
    renderTrees();
    uiElements.pointsSpent.textContent = totalPoints();
    updateRequiredLevel();
    writeHash();
  }

  /* ------------------------------------------------------------------ *
   * URL hash: #<class>:<treeA>-<treeB>-<treeC>
   * One base-10 digit per talent in JSON order, trailing zeros trimmed per tree.
   * ------------------------------------------------------------------ */

  function writeHash() {
    const data = currentData();
    if (!data) {
      if (location.hash) {
        history.replaceState(null, "", location.pathname + location.search);
      }
      return;
    }
    const parts = data.trees.map((treeName) => {
      const digits = talentsInTree(treeName)
        .map((t) => String(state.ranks[t.name] || 0))
        .join("")
        .replace(/0+$/, "");
      return digits;
    });
    const hash = `#${state.className}:${parts.join("-")}`;
    if (location.hash !== hash) {
      history.replaceState(null, "", hash);
    }
  }

  function readHash() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) {
      return false;
    }
    const [cls, spec] = raw.split(":");
    if (!cls || !CLASSES.includes(cls) || !window.TALENT_DATA[cls]) {
      return false;
    }
    state.className = cls;
    state.ranks = Object.create(null);
    state.placements = buildPlacements(window.TALENT_DATA[cls]);

    if (spec) {
      const treeDigits = spec.split("-");
      const data = currentData();
      data.trees.forEach((treeName, i) => {
        const s = treeDigits[i] || "";
        const talents = talentsInTree(treeName);
        for (let j = 0; j < talents.length; j++) {
          const d = parseInt(s.charAt(j), 10);
          if (!isNaN(d) && d > 0) {
            state.ranks[talents[j].name] = Math.min(d, talents[j].maxRanks);
          }
        }
      });
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Init
   * ------------------------------------------------------------------ */

  function init() {
    uiElements.pointsCap.textContent = String(POINT_CAP);

    window.addEventListener("resize", () =>
      window.requestAnimationFrame(drawAllArrows),
    );
    window.addEventListener("hashchange", () => {
      if (readHash()) {
        updateActiveClassButton();
        renderTrees();
        uiElements.pointsSpent.textContent = totalPoints();
        updateRequiredLevel();
      }
    });

    if (readHash()) {
      updateActiveClassButton();
      renderTrees();
      uiElements.pointsSpent.textContent = totalPoints();
      updateRequiredLevel();
    } else {
      updateActiveClassButton();
      renderTrees();
    }
  }

  async function copyLink() {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      uiElements.copyLinkBtn.textContent = "Copied!";
      setTimeout(
        () => (uiElements.copyLinkBtn.textContent = "Copy Link"),
        1200,
      );
    } catch {
      prompt("Copy this URL:", url);
    }
  }

  function resetAll() {
    if (!state.className) {
      return;
    }
    resetClass();
  }

  // Public API used by inline HTML handlers.
  window.TalentCalc = { switchClass, resetAll, copyLink };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
