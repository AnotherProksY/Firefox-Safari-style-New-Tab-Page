"use strict";

const ROOT_ID = "menu________"; // Firefox "Bookmarks Menu"
const FOLDER_PREVIEW_SIZE = 9;
const LETTER_COLORS = [
  "#8e8e93", "#ff6b5e", "#ff9f0a", "#d4a017", "#30b158",
  "#14a6a0", "#0a84ff", "#5e5ce6", "#bf5af2", "#ff375f",
];

const $ = (id) => document.getElementById(id);
const favoritesEl = $("favorites");
const emptyEl = $("empty");
const dialog = $("folder-dialog");
const dialogGrid = $("folder-grid");
const dialogEmpty = $("folder-empty");
const crumbsEl = $("folder-crumbs");
const backBtn = $("folder-back");

let nodesById = new Map();
let folderStack = []; // ids of folders open in the dialog, outermost first

// ---------- helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function isFolder(node) {
  return node.type === "folder" || (!node.url && node.type !== "separator");
}

function visibleChildren(node) {
  return (node.children || []).filter((c) => c.type !== "separator");
}

function webHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
}

function hash(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.codePointAt(0)) | 0;
  return Math.abs(h);
}

function letterFor(node) {
  const source = (node.title || webHost(node.url) || node.url || "?").trim();
  const ch = [...source.replace(/^www\./i, "")][0] || "?";
  return ch.toUpperCase();
}

function colorFor(node) {
  return LETTER_COLORS[hash(webHost(node.url) || node.title || "") % LETTER_COLORS.length];
}

function displayTitle(node) {
  return node.title || webHost(node.url) || node.url || "";
}

// Fills `box` with the site's favicon, falling back to a colored letter.
function fillIcon(box, node, iconClass, letterClass) {
  const showLetter = () => {
    box.replaceChildren(letterFor(node));
    box.classList.remove(iconClass);
    box.classList.add(letterClass);
    box.style.background = colorFor(node);
  };

  const host = webHost(node.url);
  if (!host) return showLetter();

  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.onerror = showLetter;
  img.onload = () => { if (img.naturalWidth < 16) showLetter(); };
  img.src = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
  box.classList.add(iconClass);
  box.replaceChildren(img);
}

// ---------- tiles ----------

function bookmarkItem(node) {
  const a = el("a", "item");
  a.href = node.url;
  a.title = `${displayTitle(node)}\n${node.url}`;
  const tile = el("div", "tile");
  fillIcon(tile, node, "tile--icon", "tile--letter");
  a.append(tile, el("span", "item__label", displayTitle(node)));
  return a;
}

function folderItem(node, onOpen) {
  const btn = el("button", "item");
  btn.type = "button";
  btn.title = node.title;
  const tile = el("div", "tile tile--folder");
  for (const child of visibleChildren(node).slice(0, FOLDER_PREVIEW_SIZE)) {
    const mini = el("div", "mini");
    if (isFolder(child)) mini.classList.add("mini--folder");
    else fillIcon(mini, child, "mini--icon", "mini--letter");
    tile.append(mini);
  }
  btn.append(tile, el("span", "item__label", node.title || "Без названия"));
  btn.addEventListener("click", () => onOpen(node.id));
  return btn;
}

function renderGrid(container, folder, onOpenFolder) {
  const items = visibleChildren(folder).map((child) =>
    isFolder(child) ? folderItem(child, onOpenFolder) : bookmarkItem(child)
  );
  container.replaceChildren(...items);
  return items.length;
}

// ---------- folder dialog ----------

function openFolder(id) {
  folderStack = [id];
  renderDialog();
  if (!dialog.open) dialog.showModal();
}

function pushFolder(id) {
  folderStack.push(id);
  renderDialog();
  dialog.scrollTop = 0;
}

function goToDepth(depth) {
  folderStack = folderStack.slice(0, depth + 1);
  renderDialog();
}

function renderDialog() {
  const current = nodesById.get(folderStack.at(-1));
  if (!current) return dialog.close();

  const count = renderGrid(dialogGrid, current, pushFolder);
  dialogEmpty.hidden = count > 0;
  backBtn.hidden = folderStack.length < 2;

  const crumbs = [];
  folderStack.forEach((id, i) => {
    const node = nodesById.get(id);
    if (i > 0) crumbs.push(el("span", "crumb-sep", "›"));
    const last = i === folderStack.length - 1;
    const crumb = el("button", last ? "crumb crumb--current" : "crumb", node.title || "Без названия");
    crumb.type = "button";
    if (!last) crumb.addEventListener("click", () => goToDepth(i));
    crumbs.push(crumb);
  });
  crumbsEl.replaceChildren(...crumbs);
}

backBtn.addEventListener("click", () => goToDepth(folderStack.length - 2));
$("folder-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => { folderStack = []; });
dialog.addEventListener("click", (e) => {
  // Click on the backdrop lands on the <dialog> itself, outside its box.
  const r = dialog.getBoundingClientRect();
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  if (e.target === dialog && !inside) dialog.close();
});

// ---------- bookmarks ----------

function index(node) {
  nodesById.set(node.id, node);
  for (const child of node.children || []) index(child);
}

async function load() {
  const [root] = await browser.bookmarks.getSubTree(ROOT_ID);
  nodesById = new Map();
  index(root);

  const count = renderGrid(favoritesEl, root, openFolder);
  emptyEl.hidden = count > 0;

  if (dialog.open) {
    folderStack = folderStack.filter((id) => nodesById.has(id));
    if (folderStack.length) renderDialog();
    else dialog.close();
  }
}

let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, 100);
}

for (const event of ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered"]) {
  browser.bookmarks[event]?.addListener(scheduleReload);
}

// ---------- theme ----------

// Theme colors come as CSS strings or [r, g, b(, a)] arrays.
function cssColor(value) {
  if (Array.isArray(value)) return `rgb(${value.slice(0, 3).join(" ")})`;
  return typeof value === "string" ? value : null;
}

// Relative luminance of any CSS color, via the browser's own parser.
function luminance(color) {
  const probe = el("span");
  probe.style.color = color;
  document.body.append(probe);
  const [r, g, b] = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
  probe.remove();
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Match the page to the browser chrome. The default system theme reports no
// colors, so then the CSS fallbacks (Firefox's own toolbar colors) apply.
async function applyTheme(theme) {
  theme ??= await browser.theme.getCurrent();
  const colors = theme?.colors || {};
  const bg = cssColor(colors.toolbar) || cssColor(colors.frame);
  const text = cssColor(colors.toolbar_text) || cssColor(colors.tab_background_text);
  const root = document.documentElement.style;

  for (const prop of ["--bg", "--text", "--overlay", "color-scheme"]) root.removeProperty(prop);
  if (!bg) return;

  const dark = luminance(bg) < 0.5;
  root.setProperty("--bg", bg);
  root.setProperty("--text", text || (dark ? "#fbfbfe" : "#15141a"));
  root.setProperty("--overlay", dark ? "255 255 255" : "0 0 0");
  root.setProperty("color-scheme", dark ? "dark" : "light");
}

browser.theme?.onUpdated.addListener(({ theme }) => applyTheme(theme));

// ---------- search ----------

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const HOST_RE = /^(localhost|[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*\.[\p{L}]{2,}|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]\S*)?$/u;

function asUrl(text) {
  if (/\s/.test(text)) return null;
  if (SCHEME_RE.test(text)) return text;
  if (HOST_RE.test(text)) return `https://${text}`;
  return null;
}

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const query = $("search-input").value.trim();
  if (!query) return;
  const url = asUrl(query);
  if (url) location.assign(url);
  else browser.search.search({ query, disposition: "CURRENT_TAB" });
});

$("search-input").focus();
applyTheme().catch(() => {});
load();
