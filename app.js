/* ============================================================================
   MAILVAULT PORTAL — CORE APPLICATION ENGINE (DIRECT APPS SCRIPT EDITION)
   Powered directly by Google Apps Script API + Persistent Local Store
   ============================================================================ */

"use strict";

// URL API Google Apps Script dari kode HTML asli kamu
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbwTUmxiywYQQloLLRCJ6wl15itbe064gFzNoQIJnWrlnD573QI2FbaWq0PcmH2XMCxz2g/exec";

const STORAGE_KEYS = {
  SESSION: "mv_session_v2",
  PROFILES: "mv_profiles_v2",
  MARKET: "mv_market_listings_v2",
  TRANSFERS: "mv_ownership_transfers_v2",
  CHATS: "mv_chat_messages_v2",
  READY_DAYS: "mv_ready_days_pref_v2"
};

/* ============================================================================
   APPLICATION STATE
   ============================================================================ */
const state = {
  authMode: "login", // "login" | "register"
  currentUser: null,
  currentPage: "home",
  rawAliases: [],
  allEmails: [],
  selectedAlias: "ALL",
  activeEmailId: null,
  readyDaysPref: 30,
  activeChatPeer: null,
  marketListings: [],
  transfers: [],
  chatMessages: [],
  profiles: {}
};

/* ============================================================================
   UTILITY HELPERS (CROSS-PLATFORM: iOS, ANDROID, WINDOWS, MACOS)
   ============================================================================ */
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEmail(addr) {
  return String(addr || "").trim().toLowerCase();
}

function normalizeUsername(name) {
  return String(name || "").trim().toLowerCase();
}

/**
 * Sensor alamat email untuk etalase Buy / Sell:
 * Contoh: "andikapu.trawijay.akarm.mtoon@gmail.com" -> "andikapu************"
 */
function censorEmail(email) {
  const clean = String(email || "").trim();
  if (!clean) return "********";
  const prefix = clean.slice(0, 8);
  return prefix + "************";
}

function formatRupiah(num) {
  const n = Number(num) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}

function formatDateID(dateInput) {
  if (!dateInput) return "-";
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateShortID(dateInput) {
  if (!dateInput) return "-";
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

function addDays(dateInput, days) {
  const base = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + Number(days));
  return base;
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(-8px)";
    el.style.transition = "all 0.25s ease";
    setTimeout(() => el.remove(), 260);
  }, 3400);
}

/**
 * Salin teks ke clipboard yang aman di iOS Safari, Android Chrome, dan Desktop
 */
async function copyTextSafe(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    // Lanjut ke fallback textarea
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (_) {
    return false;
  }
}

/* ============================================================================
   PERSISTENT STORAGE ENGINE (DIRECT APPS SCRIPT EDITION)
   ============================================================================ */
function loadLocalStore() {
  try {
    state.profiles = JSON.parse(localStorage.getItem(STORAGE_KEYS.PROFILES) || "{}");
    state.marketListings = JSON.parse(localStorage.getItem(STORAGE_KEYS.MARKET) || "[]");
    state.transfers = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSFERS) || "[]");
    state.chatMessages = JSON.parse(localStorage.getItem(STORAGE_KEYS.CHATS) || "[]");
    const savedDays = Number(localStorage.getItem(STORAGE_KEYS.READY_DAYS));
    if (savedDays >= 15 && savedDays <= 60) {
      state.readyDaysPref = savedDays;
    }
  } catch (err) {
    console.warn("Gagal membaca penyimpanan lokal:", err);
  }
}

function saveLocalStore() {
  try {
    localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(state.profiles));
    localStorage.setItem(STORAGE_KEYS.MARKET, JSON.stringify(state.marketListings));
    localStorage.setItem(STORAGE_KEYS.TRANSFERS, JSON.stringify(state.transfers));
    localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(state.chatMessages));
    localStorage.setItem(STORAGE_KEYS.READY_DAYS, String(state.readyDaysPref));
  } catch (err) {
    console.warn("Gagal menyimpan ke penyimpanan lokal:", err);
  }
}

/* ============================================================================
   GOOGLE APPS SCRIPT API CLIENT
   ============================================================================ */
async function callGasApi(payload) {
  const response = await fetch(GAS_API_URL, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error("Respons server tidak valid.");
  }
}

/* ============================================================================
   OWNERSHIP & READINESS COMPUTATION
   ============================================================================ */
/**
 * Mengembalikan daftar email yang dimiliki user saat ini:
 * - Email hasil generate dari server Apps Script
 * - Ditambah email yang dibeli user di halaman Buy/Sell
 * - Dikurangi email yang sudah terjual ke pengguna lain
 */
function getOwnedEmails() {
  if (!state.currentUser) return [];
  const me = normalizeUsername(state.currentUser);
  const ownedSet = new Set(state.rawAliases.map(normalizeEmail).filter(Boolean));

  // Urutkan transfer dari yang terlama ke terbaru
  const sortedTransfers = [...state.transfers].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (const tr of sortedTransfers) {
    const emailNorm = normalizeEmail(tr.email);
    const sellerNorm = normalizeUsername(tr.seller);
    const buyerNorm = normalizeUsername(tr.buyer);
    if (sellerNorm === me) {
      ownedSet.delete(emailNorm);
    }
    if (buyerNorm === me) {
      ownedSet.add(emailNorm);
    }
  }

  // Kembalikan format asli jika ada di rawAliases atau transfer
  const result = [];
  for (const norm of ownedSet) {
    const rawMatch = state.rawAliases.find((a) => normalizeEmail(a) === norm);
    if (rawMatch) {
      result.push(rawMatch);
      continue;
    }
    const trMatch = [...sortedTransfers].reverse().find((t) => normalizeEmail(t.email) === norm);
    result.push(trMatch ? trMatch.email : norm);
  }
  return result;
}

/**
 * Menghitung statistik pesan masuk, tanggal terakhir menerima pesan,
 * dan tanggal siap pakai (+30 hari jika pesan pertama, +15..60 hari jika >1 pesan).
 */
function getEmailMetadata(emailAddr) {
  const target = normalizeEmail(emailAddr);
  const msgs = state.allEmails
    .filter((m) => normalizeEmail(m.to) === target)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (msgs.length === 0) {
    return {
      email: emailAddr,
      messageCount: 0,
      lastMessageDate: null,
      readyDate: null,
      addedDays: 0,
      status: "unreceived" // "ready" | "waiting" | "unreceived"
    };
  }

  const lastDate = new Date(msgs[0].date);
  const isFirstMessage = msgs.length === 1;
  const addedDays = isFirstMessage ? 30 : state.readyDaysPref;
  const readyDate = addDays(lastDate, addedDays);
  const now = new Date();
  const isReady = readyDate && now.getTime() >= readyDate.getTime();

  return {
    email: emailAddr,
    messageCount: msgs.length,
    lastMessageDate: lastDate,
    readyDate,
    addedDays,
    status: isReady ? "ready" : "waiting"
  };
}

/* ============================================================================
   1. AUTHENTICATION FLOW (LOGIN & REGISTER)
   ============================================================================ */
function setupAuth() {
  const tabLogin = document.getElementById("tab-login");
  const tabRegister = document.getElementById("tab-register");
  const indicator = document.getElementById("auth-tab-indicator");
  const authForm = document.getElementById("auth-form");
  const authBtn = document.getElementById("auth-btn");
  const authAlert = document.getElementById("auth-alert");
  const togglePassBtn = document.getElementById("toggle-auth-pass");
  const passInput = document.getElementById("password");

  function setAuthMode(mode) {
    state.authMode = mode;
    authAlert.style.display = "none";
    if (mode === "login") {
      tabLogin.classList.add("active");
      tabRegister.classList.remove("active");
      tabLogin.setAttribute("aria-selected", "true");
      tabRegister.setAttribute("aria-selected", "false");
      indicator.classList.remove("register");
      authBtn.querySelector(".btn-label").textContent = "Masuk";
    } else {
      tabRegister.classList.add("active");
      tabLogin.classList.remove("active");
      tabRegister.setAttribute("aria-selected", "true");
      tabLogin.setAttribute("aria-selected", "false");
      indicator.classList.add("register");
      authBtn.querySelector(".btn-label").textContent = "Daftar Akun";
    }
  }

  tabLogin.addEventListener("click", () => setAuthMode("login"));
  tabRegister.addEventListener("click", () => setAuthMode("register"));

  togglePassBtn.addEventListener("click", () => {
    passInput.type = passInput.type === "password" ? "text" : "password";
  });

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = passInput.value.trim();

    if (!username || !password) {
      authAlert.textContent = "Username dan password wajib diisi.";
      authAlert.className = "alert error";
      authAlert.style.display = "block";
      return;
    }

    authBtn.disabled = true;
    authBtn.classList.add("loading");
    authAlert.style.display = "none";

    try {
      const data = await callGasApi({
        action: state.authMode,
        username,
        password
      });

      if (data.status === "success") {
        if (state.authMode === "register") {
          // Simpan profil awal
          const uKey = normalizeUsername(username);
          state.profiles[uKey] = {
            username,
            displayName: username,
            email: "",
            password
          };
          saveLocalStore();

          authAlert.textContent = data.message || "Akun berhasil didaftarkan! Silakan masuk.";
          authAlert.className = "alert success";
          authAlert.style.display = "block";
          setAuthMode("login");
        } else {
          const resolvedUser = data.username || username;
          const uKey = normalizeUsername(resolvedUser);
          if (!state.profiles[uKey]) {
            state.profiles[uKey] = {
              username: resolvedUser,
              displayName: resolvedUser,
              email: "",
              password
            };
          } else {
            state.profiles[uKey].password = password;
          }
          saveLocalStore();
          enterDashboard(resolvedUser);
        }
      } else {
        authAlert.textContent = data.message || "Gagal memproses permintaan.";
        authAlert.className = "alert error";
        authAlert.style.display = "block";
      }
    } catch (err) {
      // Cek apakah user pernah diubah passwordnya secara lokal
      const uKey = normalizeUsername(username);
      const localProf = state.profiles[uKey];
      if (state.authMode === "login" && localProf && localProf.password === password) {
        enterDashboard(localProf.username || username);
        showToast("Masuk menggunakan sesi terverifikasi.");
      } else {
        authAlert.textContent = "Gagal terhubung ke server Apps Script. Periksa koneksi internet kamu.";
        authAlert.className = "alert error";
        authAlert.style.display = "block";
      }
    } finally {
      authBtn.disabled = false;
      authBtn.classList.remove("loading");
    }
  });
}

function enterDashboard(username) {
  state.currentUser = username;
  try {
    sessionStorage.setItem(STORAGE_KEYS.SESSION, username);
    localStorage.setItem(STORAGE_KEYS.SESSION, username);
  } catch (_) {}

  document.getElementById("auth-view").classList.add("hidden");
  document.getElementById("dashboard-view").classList.remove("hidden");
  document.getElementById("user-display").textContent = "@" + username;

  syncAccountUI();
  loadDashboardData();
  renderMarket();
  renderChatSidebar();
}

function handleLogout() {
  state.currentUser = null;
  state.rawAliases = [];
  state.allEmails = [];
  state.selectedAlias = "ALL";
  state.activeEmailId = null;
  state.activeChatPeer = null;

  try {
    sessionStorage.removeItem(STORAGE_KEYS.SESSION);
    localStorage.removeItem(STORAGE_KEYS.SESSION);
  } catch (_) {}

  document.getElementById("dashboard-view").classList.add("hidden");
  document.getElementById("auth-view").classList.remove("hidden");
  document.getElementById("password").value = "";
  showToast("Berhasil keluar dari akun.");
}

/* ============================================================================
   NAVIGATION & SPOTLIGHT INTERACTIONS
   ============================================================================ */
function switchPage(pageName) {
  state.currentPage = pageName;

  document.querySelectorAll(".page-view").forEach((sec) => {
    if (sec.id === "page-" + pageName) {
      sec.classList.remove("hidden");
      sec.classList.add("active");
    } else {
      sec.classList.add("hidden");
      sec.classList.remove("active");
    }
  });

  document.querySelectorAll(".nav-pill, .m-nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageName);
  });

  if (pageName === "my-email") renderMyEmailPage();
  if (pageName === "market") renderMarket();
  if (pageName === "chat") {
    renderChatSidebar();
    updateUnreadChatBadge();
  }
  if (pageName === "account") syncAccountUI();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupNavigation() {
  document.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => switchPage(btn.dataset.page));
  });

  document.querySelectorAll("[data-jump]").forEach((btn) => {
    btn.addEventListener("click", () => switchPage(btn.dataset.jump));
  });

  // Modal close buttons
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.closeModal;
      const modal = document.getElementById(targetId);
      if (modal) modal.classList.add("hidden");
    });
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.classList.add("hidden");
    });
  });

  // Pointer spotlight tracking on cards (Desktop)
  document.addEventListener("pointermove", (e) => {
    const card = e.target.closest(".spotlight-card");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    card.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
  });
}

/* ============================================================================
   2. HOME PAGE: GENERATE EMAIL, INBOX & LINK-IN-NEW-TAB SANITIZER
   ============================================================================ */
async function handleGenerateEmail(triggerBtn) {
  if (!state.currentUser) return;
  const btn = triggerBtn || document.getElementById("gen-btn");
  btn.disabled = true;
  btn.classList.add("loading");

  try {
    const data = await callGasApi({
      action: "generateEmail",
      username: state.currentUser
    });

    if (data.status === "success" && data.email) {
      const copied = await copyTextSafe(data.email);
      const latestBox = document.getElementById("latest-generated-box");
      const latestCode = document.getElementById("latest-generated-email");
      latestCode.textContent = data.email;
      latestBox.classList.remove("hidden");

      showToast(
        copied
          ? `Email baru dibuat & disalin: ${data.email}`
          : `Email baru dibuat: ${data.email}`
      );
      await loadDashboardData();
    } else {
      showToast(data.message || "Gagal generate email baru.", "error");
    }
  } catch (err) {
    showToast("Gagal menghubungi server Apps Script saat generate email.", "error");
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
  }
}

async function loadDashboardData() {
  if (!state.currentUser) return;
  const refreshBtn = document.getElementById("refresh-btn");
  const syncText = document.getElementById("sync-status-text");
  refreshBtn.disabled = true;
  syncText.textContent = "Menyinkronkan...";

  try {
    const data = await callGasApi({
      action: "getDashboardData",
      username: state.currentUser
    });

    if (data.status === "success") {
      state.rawAliases = Array.isArray(data.aliases) ? data.aliases : [];
      state.allEmails = Array.isArray(data.emails) ? data.emails : [];
      syncText.textContent = "API Aktif";

      renderAliases();
      renderEmailList();
      updateHomeStats();
      if (state.currentPage === "my-email") renderMyEmailPage();
    } else {
      syncText.textContent = "Perlu Refresh";
    }
  } catch (err) {
    syncText.textContent = "Mode Offline";
    showToast("Gagal memuat data kotak masuk dari server.", "error");
  } finally {
    refreshBtn.disabled = false;
  }
}

function updateHomeStats() {
  const owned = getOwnedEmails();
  const ownedNormSet = new Set(owned.map(normalizeEmail));
  const relevantInbox = state.allEmails.filter((m) => ownedNormSet.has(normalizeEmail(m.to)));
  const readyCount = owned.filter((addr) => getEmailMetadata(addr).status === "ready").length;

  document.getElementById("stat-total-emails").textContent = String(owned.length);
  document.getElementById("stat-total-inbox").textContent = String(relevantInbox.length);
  document.getElementById("stat-ready-emails").textContent = String(readyCount);
  document.getElementById("nav-email-count").textContent = String(owned.length);
}

function renderAliases() {
  const container = document.getElementById("alias-list");
  const filterLabel = document.getElementById("filter-label");
  const owned = getOwnedEmails();

  if (owned.length === 0) {
    container.innerHTML = `<span class="muted-hint">Belum ada email aktif. Klik "+ Generate Email Baru" di atas.</span>`;
    return;
  }

  let html = `
    <div class="alias-pill ${state.selectedAlias === "ALL" ? "selected" : ""}" data-alias="ALL">
      <span>Semua (${owned.length})</span>
    </div>
  `;

  owned.forEach((alias) => {
    const isSel = normalizeEmail(state.selectedAlias) === normalizeEmail(alias);
    html += `
      <div class="alias-pill ${isSel ? "selected" : ""}" data-alias="${escapeHtml(alias)}">
        <span>${escapeHtml(alias)}</span>
        <span class="copy-tag" data-copy-alias="${escapeHtml(alias)}">Salin</span>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll(".alias-pill").forEach((pill) => {
    pill.addEventListener("click", (e) => {
      const copyTarget = e.target.closest("[data-copy-alias]");
      if (copyTarget) {
        e.stopPropagation();
        const emailToCopy = copyTarget.dataset.copyAlias;
        copyTextSafe(emailToCopy).then((ok) => {
          showToast(ok ? `Disalin: ${emailToCopy}` : "Gagal menyalin email.");
        });
        return;
      }

      state.selectedAlias = pill.dataset.alias;
      filterLabel.textContent =
        state.selectedAlias === "ALL"
          ? "Menampilkan: Semua Email Milikmu"
          : `Filter Tujuan: ${state.selectedAlias}`;
      renderAliases();
      renderEmailList();
    });
  });
}

function renderEmailList() {
  const listEl = document.getElementById("email-list");
  const countEl = document.getElementById("email-count");
  const ownedNormSet = new Set(getOwnedEmails().map(normalizeEmail));

  let filtered = state.allEmails.filter((m) => ownedNormSet.has(normalizeEmail(m.to)));
  if (state.selectedAlias !== "ALL") {
    filtered = filtered.filter(
      (m) => normalizeEmail(m.to) === normalizeEmail(state.selectedAlias)
    );
  }

  countEl.textContent = `${filtered.length} pesan`;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="reader-empty" style="padding:36px 18px;"><p>Belum ada pesan masuk untuk filter ini.</p></div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map((email) => {
      const isActive = String(state.activeEmailId) === String(email.id);
      return `
        <div class="email-item ${isActive ? "active" : ""}" data-email-id="${escapeHtml(email.id)}">
          <div class="email-to-badge">Ke: ${escapeHtml(email.to)}</div>
          <div class="email-subject">${escapeHtml(email.subject || "(Tanpa Subjek)")}</div>
          <div class="email-snippet">${escapeHtml(email.from)} &bull; ${escapeHtml(email.snippet || "")}</div>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".email-item").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.emailId;
      const found = filtered.find((m) => String(m.id) === String(id));
      if (found) openEmailReader(found);
    });
  });
}

/**
 * Mengubah seluruh link (<a href> maupun teks URL polos https://...) di isi email
 * agar selalu terbuka di tab / jendela browser baru pada iOS, Android, maupun PC.
 */
function prepareEmailHtmlForNewTabs(rawHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml || "<p>(Pesan kosong)</p>", "text/html");

  // 1. Paksa semua tag <a> memakai target="_blank" dan rel="noopener noreferrer"
  doc.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    if (/^(https?:|mailto:|tel:)/i.test(href.trim())) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  });

  // 2. Linkify URL teks polos di dalam text node yang belum dibungkus <a>
  const urlRegex = /(https?:\/\/[^\s<>"')]+)/gi;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement && node.parentElement.closest("a, script, style")) continue;
    if (urlRegex.test(node.nodeValue)) {
      textNodes.push(node);
    }
    urlRegex.lastIndex = 0;
  }

  textNodes.forEach((tNode) => {
    const frag = doc.createDocumentFragment();
    const parts = tNode.nodeValue.split(urlRegex);
    parts.forEach((part) => {
      if (/^https?:\/\//i.test(part)) {
        const a = doc.createElement("a");
        a.href = part;
        a.textContent = part;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.style.color = "#0284c7";
        a.style.textDecoration = "underline";
        a.style.wordBreak = "break-all";
        frag.appendChild(a);
      } else if (part) {
        frag.appendChild(doc.createTextNode(part));
      }
    });
    tNode.parentNode.replaceChild(frag, tNode);
  });

  // 3. Sisipkan <base target="_blank"> & listener pengaman klik link
  const baseTag = doc.createElement("base");
  baseTag.setAttribute("target", "_blank");
  doc.head.prepend(baseTag);

  const styleTag = doc.createElement("style");
  styleTag.textContent = `
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #0f172a;
      line-height: 1.6;
      padding: 18px;
      margin: 0;
      word-wrap: break-word;
    }
    img { max-width: 100%; height: auto; }
    a { color: #0284c7; }
  `;
  doc.head.appendChild(styleTag);

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

function openEmailReader(email) {
  state.activeEmailId = email.id;
  renderEmailList();

  document.getElementById("reader-empty").classList.add("hidden");
  document.getElementById("reader-content").classList.remove("hidden");
  document.getElementById("detail-subject").textContent = email.subject || "(Tanpa Subjek)";
  document.getElementById("detail-from").textContent = email.from || "-";
  document.getElementById("detail-to").textContent = email.to || "-";
  document.getElementById("detail-date").textContent = formatDateID(email.date);

  const iframe = document.getElementById("html-frame");
  const safeDoc = prepareEmailHtmlForNewTabs(email.htmlBody);
  iframe.srcdoc = safeDoc;

  // Tambahan pengaman klik di dalam iframe agar URL selalu buka halaman baru
  iframe.onload = () => {
    try {
      const iDoc = iframe.contentDocument || iframe.contentWindow.document;
      iDoc.addEventListener("click", (ev) => {
        const link = ev.target.closest("a[href]");
        if (link && /^https?:\/\//i.test(link.href)) {
          ev.preventDefault();
          window.open(link.href, "_blank", "noopener,noreferrer");
        }
      });
    } catch (_) {}
  };

  if (window.innerWidth < 900) {
    document.getElementById("reader-pane").classList.add("mobile-open");
  }
}

/* ============================================================================
   3. MY EMAIL PAGE (FORMAT SESUAI SPESIFIKASI + TANGGAL SIAP PAKAI)
   ============================================================================ */
function renderMyEmailPage() {
  const grid = document.getElementById("my-email-grid");
  const searchQuery = normalizeEmail(document.getElementById("my-email-search").value);
  const statusFilter = document.getElementById("my-email-filter").value;

  const owned = getOwnedEmails();
  const items = owned
    .map((addr) => getEmailMetadata(addr))
    .filter((meta) => {
      if (searchQuery && !normalizeEmail(meta.email).includes(searchQuery)) return false;
      if (statusFilter !== "all" && meta.status !== statusFilter) return false;
      return true;
    });

  if (items.length === 0) {
    grid.innerHTML = `
      <div class="my-email-card spotlight-card" style="grid-column: 1 / -1; text-align:center; padding: 36px 20px;">
        <p class="muted-hint">Tidak ada email yang sesuai dengan filter saat ini. Klik "+ Generate Email" untuk membuat alamat baru.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = items
    .map((meta) => {
      let badgeText = "Belum Ada Pesan";
      if (meta.status === "ready") badgeText = "Siap Pakai";
      if (meta.status === "waiting") badgeText = `Masa Tunggu (+${meta.addedDays} Hari)`;

      const lastMsgStr = meta.lastMessageDate
        ? formatDateID(meta.lastMessageDate)
        : "Belum menerima pesan";

      const readyDateStr = meta.readyDate
        ? `${formatDateShortID(meta.readyDate)} (+${meta.addedDays} hari)`
        : "Menunggu pesan pertama masuk";

      return `
        <article class="my-email-card spotlight-card">
          <div class="my-email-top">
            <span class="status-pill ${meta.status}">${badgeText}</span>
            <span class="muted-hint">${meta.messageCount} pesan masuk</span>
          </div>

          <div class="my-email-spec-box">
            <div class="spec-line">
              <span class="label">Email :</span>
              <strong class="val mono-email">${escapeHtml(meta.email)}</strong>
            </div>
            <div class="spec-line">
              <span class="label">Tanggal terakhir menerima pesan :</span>
              <strong class="val">${escapeHtml(lastMsgStr)}</strong>
            </div>
            <div class="spec-line">
              <span class="label">Tanggal siap pakai :</span>
              <strong class="val emerald-text">${escapeHtml(readyDateStr)}</strong>
            </div>
          </div>

          <div class="my-email-actions">
            <button type="button" class="btn btn-sm btn-primary" data-copy-my="${escapeHtml(meta.email)}">Salin Email</button>
            <button type="button" class="btn btn-sm btn-ghost" data-check-inbox="${escapeHtml(meta.email)}">Cek Inbox</button>
            <button type="button" class="btn btn-sm btn-emerald" data-sell-my="${escapeHtml(meta.email)}">Jual di Toko</button>
          </div>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll("[data-copy-my]").forEach((btn) => {
    btn.addEventListener("click", () => {
      copyTextSafe(btn.dataset.copyMy).then((ok) => {
        showToast(ok ? `Disalin: ${btn.dataset.copyMy}` : "Gagal menyalin email.");
      });
    });
  });

  grid.querySelectorAll("[data-check-inbox]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedAlias = btn.dataset.checkInbox;
      switchPage("home");
      renderAliases();
      renderEmailList();
    });
  });

  grid.querySelectorAll("[data-sell-my]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openSellModal(btn.dataset.sellMy);
    });
  });
}

/* ============================================================================
   4. BUY / SELL MARKETPLACE (TOKO EMAIL + SENSOR + TRANSFER KEPEMILIKAN + TAWAR)
   ============================================================================ */
function openSellModal(preselectEmail) {
  const modal = document.getElementById("sell-modal");
  const select = document.getElementById("sell-email-select");
  const owned = getOwnedEmails();

  // Filter email yang belum sedang dijual aktif
  const activeListedSet = new Set(
    state.marketListings
      .filter((item) => item.status === "available")
      .map((item) => normalizeEmail(item.email))
  );

  const sellable = owned.filter((addr) => !activeListedSet.has(normalizeEmail(addr)));

  if (sellable.length === 0) {
    showToast("Semua email milikmu sudah terdaftar di toko atau belum ada email.", "error");
    return;
  }

  select.innerHTML = sellable
    .map(
      (addr) =>
        `<option value="${escapeHtml(addr)}" ${
          normalizeEmail(addr) === normalizeEmail(preselectEmail) ? "selected" : ""
        }>${escapeHtml(addr)}</option>`
    )
    .join("");

  document.getElementById("sell-price").value = "";
  document.getElementById("sell-desc").value = "";
  modal.classList.remove("hidden");
}

function renderMarket() {
  const grid = document.getElementById("market-grid");
  const minPrice = Number(document.getElementById("filter-price-min").value) || 0;
  const maxPriceRaw = document.getElementById("filter-price-max").value;
  const maxPrice = maxPriceRaw !== "" ? Number(maxPriceRaw) : Infinity;
  const sortMode = document.getElementById("filter-sort").value;
  const keyword = normalizeUsername(document.getElementById("filter-market-search").value);
  const onlyAvailable = document.getElementById("filter-only-available").checked;

  let list = [...state.marketListings].filter((item) => {
    if (onlyAvailable && item.status !== "available") return false;
    const price = Number(item.price) || 0;
    if (price < minPrice || price > maxPrice) return false;
    if (keyword) {
      const hay = `${item.description} ${item.seller} ${censorEmail(item.email)}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  if (sortMode === "lowest") {
    list.sort((a, b) => Number(a.price) - Number(b.price));
  } else if (sortMode === "highest") {
    list.sort((a, b) => Number(b.price) - Number(a.price));
  } else {
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="market-card spotlight-card" style="grid-column: 1 / -1; text-align:center; padding:36px 20px;">
        <p class="muted-hint">Belum ada listing email yang cocok dengan filter harga/pencarian. Klik "+ Jual Email Saya" untuk mulai berjualan.</p>
      </div>
    `;
    return;
  }

  const me = normalizeUsername(state.currentUser);

  grid.innerHTML = list
    .map((item) => {
      const isMine = normalizeUsername(item.seller) === me;
      const isSold = item.status === "sold";
      const displayEmail = isMine || (isSold && normalizeUsername(item.buyer) === me)
        ? item.email
        : censorEmail(item.email);

      const commentCount = Array.isArray(item.comments) ? item.comments.length : 0;

      let actionButtons = "";
      if (isSold) {
        actionButtons = `
          <button type="button" class="btn btn-ghost btn-sm" disabled style="grid-column: 1 / -1;">
            Terjual ke @${escapeHtml(item.buyer || "pembeli")}
          </button>
        `;
      } else if (isMine) {
        actionButtons = `
          <button type="button" class="btn btn-ghost btn-sm" data-open-offer="${escapeHtml(item.id)}">
            Komentar (${commentCount})
          </button>
          <button type="button" class="btn btn-danger btn-sm" data-cancel-listing="${escapeHtml(item.id)}">
            Tarik Jualan
          </button>
        `;
      } else {
        actionButtons = `
          <button type="button" class="btn btn-emerald btn-sm" data-buy-listing="${escapeHtml(item.id)}">
            Beli Sekarang
          </button>
          <button type="button" class="btn btn-primary btn-sm" data-open-offer="${escapeHtml(item.id)}">
            Tawar (${commentCount})
          </button>
        `;
      }

      return `
        <article class="market-card spotlight-card ${isSold ? "sold" : ""}">
          <div>
            <div class="market-card-head">
              <div>
                <div class="censored-email">${escapeHtml(displayEmail)}</div>
                <div class="muted-hint">Penjual: <strong>@${escapeHtml(item.seller)}</strong></div>
              </div>
              <div class="price-tag">${formatRupiah(item.price)}</div>
            </div>

            <div class="market-meta-list" style="margin-top:12px;">
              <div><strong>Tanggal terakhir menerima pesan:</strong> ${escapeHtml(item.lastMessageDate || "Belum ada pesan")}</div>
              <div><strong>Diposting:</strong> ${escapeHtml(formatDateShortID(item.createdAt))}</div>
            </div>

            <div class="market-desc-box" style="margin-top:10px;">
              ${escapeHtml(item.description)}
            </div>
          </div>

          <div class="market-card-actions">
            ${actionButtons}
          </div>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll("[data-buy-listing]").forEach((btn) => {
    btn.addEventListener("click", () => handleBuyListing(btn.dataset.buyListing));
  });

  grid.querySelectorAll("[data-open-offer]").forEach((btn) => {
    btn.addEventListener("click", () => openOfferModal(btn.dataset.openOffer));
  });

  grid.querySelectorAll("[data-cancel-listing]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.marketListings = state.marketListings.filter((l) => l.id !== btn.dataset.cancelListing);
      saveLocalStore();
      renderMarket();
      showToast("Postingan penjualan dibatalkan.");
    });
  });
}

function handleBuyListing(listingId) {
  const listing = state.marketListings.find((l) => l.id === listingId);
  if (!listing || listing.status !== "available") {
    showToast("Email ini sudah tidak tersedia.", "error");
    return;
  }

  const buyer = state.currentUser;
  if (normalizeUsername(listing.seller) === normalizeUsername(buyer)) {
    showToast("Kamu tidak bisa membeli email milikmu sendiri.", "error");
    return;
  }

  listing.status = "sold";
  listing.buyer = buyer;
  listing.soldAt = new Date().toISOString();

  // Catat pemindahan kepemilikan: otomatis masuk My Email pembeli & hilang dari My Email penjual
  state.transfers.push({
    id: "tr_" + Date.now(),
    email: listing.email,
    seller: listing.seller,
    buyer: buyer,
    price: listing.price,
    timestamp: new Date().toISOString()
  });

  // Kirim notifikasi otomatis ke Chat penjual & pembeli
  pushChatMessage(
    buyer,
    listing.seller,
    `Halo @${listing.seller}, saya telah membeli email ${censorEmail(listing.email)} seharga ${formatRupiah(listing.price)}.`,
    "Transaksi Berhasil"
  );

  saveLocalStore();
  renderMarket();
  renderAliases();
  renderEmailList();
  updateHomeStats();
  showToast(`Berhasil membeli! Email ${listing.email} kini otomatis masuk ke My Email kamu.`);
}

function openOfferModal(listingId) {
  const listing = state.marketListings.find((l) => l.id === listingId);
  if (!listing) return;

  document.getElementById("offer-listing-id").value = listing.id;
  document.getElementById("offer-listing-subtitle").textContent =
    `${censorEmail(listing.email)} • Harga: ${formatRupiah(listing.price)} • Penjual: @${listing.seller}`;
  document.getElementById("offer-price").value = "";
  document.getElementById("offer-message").value = "";

  const commentsList = document.getElementById("offer-comments-list");
  const comments = Array.isArray(listing.comments) ? listing.comments : [];

  if (comments.length === 0) {
    commentsList.innerHTML = `<div class="muted-hint">Belum ada komentar atau tawaran pada postingan ini.</div>`;
  } else {
    commentsList.innerHTML = comments
      .map(
        (c) => `
        <div class="offer-comment-item">
          <div>
            <strong>@${escapeHtml(c.author)}</strong>
            ${c.offerPrice ? `<span class="offer-price-pill">Tawar ${formatRupiah(c.offerPrice)}</span>` : ""}
            <span class="muted-hint" style="float:right; font-size:0.72rem;">${escapeHtml(formatDateShortID(c.createdAt))}</span>
          </div>
          <div style="margin-top:4px;">${escapeHtml(c.message)}</div>
        </div>
      `
      )
      .join("");
  }

  document.getElementById("offer-modal").classList.remove("hidden");
}

/* ============================================================================
   5. CHAT SYSTEM (TERINTEGRASI DENGAN PENAWARAN TOKO & PESAN LANGSUNG)
   ============================================================================ */
function pushChatMessage(sender, recipient, text, tag = "") {
  state.chatMessages.push({
    id: "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    from: sender,
    to: recipient,
    text,
    tag,
    timestamp: new Date().toISOString(),
    readBy: [normalizeUsername(sender)]
  });
  saveLocalStore();
  updateUnreadChatBadge();
}

function updateUnreadChatBadge() {
  const badge = document.getElementById("nav-chat-count");
  if (!badge || !state.currentUser) return;
  const me = normalizeUsername(state.currentUser);
  const unread = state.chatMessages.filter(
    (m) =>
      normalizeUsername(m.to) === me &&
      !(Array.isArray(m.readBy) && m.readBy.includes(me))
  ).length;

  if (unread > 0) {
    badge.textContent = String(unread);
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function getChatThreads() {
  if (!state.currentUser) return [];
  const me = normalizeUsername(state.currentUser);
  const peerMap = new Map();

  for (const msg of state.chatMessages) {
    const fromNorm = normalizeUsername(msg.from);
    const toNorm = normalizeUsername(msg.to);
    if (fromNorm !== me && toNorm !== me) continue;

    const peerNorm = fromNorm === me ? toNorm : fromNorm;
    const peerLabel = fromNorm === me ? msg.to : msg.from;
    const existing = peerMap.get(peerNorm);

    if (!existing || new Date(msg.timestamp).getTime() >= new Date(existing.lastTimestamp).getTime()) {
      peerMap.set(peerNorm, {
        peerNorm,
        peerName: peerLabel,
        lastMessage: msg.text,
        lastTimestamp: msg.timestamp
      });
    }
  }

  return Array.from(peerMap.values()).sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
}

function renderChatSidebar() {
  const listEl = document.getElementById("chat-thread-list");
  const query = normalizeUsername(document.getElementById("chat-contact-search").value);
  const threads = getChatThreads().filter((t) =>
    !query || t.peerNorm.includes(query)
  );

  if (threads.length === 0) {
    listEl.innerHTML = `<div class="reader-empty" style="padding:28px 14px;"><p>Belum ada percakapan. Gunakan tombol "+ Mulai Chat Baru" atau tawar produk di halaman Buy/Sell.</p></div>`;
    return;
  }

  listEl.innerHTML = threads
    .map((t) => {
      const isActive = normalizeUsername(state.activeChatPeer) === t.peerNorm;
      const initial = (t.peerName || "U").charAt(0);
      return `
        <div class="chat-thread-item ${isActive ? "active" : ""}" data-peer="${escapeHtml(t.peerName)}">
          <div class="avatar-circle">${escapeHtml(initial)}</div>
          <div class="thread-meta">
            <div class="thread-top">
              <span class="thread-name">@${escapeHtml(t.peerName)}</span>
              <span class="thread-time">${escapeHtml(formatDateShortID(t.lastTimestamp))}</span>
            </div>
            <div class="thread-preview">${escapeHtml(t.lastMessage)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll(".chat-thread-item").forEach((item) => {
    item.addEventListener("click", () => openChatThread(item.dataset.peer));
  });
}

function openChatThread(peerUsername) {
  state.activeChatPeer = peerUsername;
  const me = normalizeUsername(state.currentUser);
  const peerNorm = normalizeUsername(peerUsername);

  // Tandai pesan sudah dibaca
  state.chatMessages.forEach((m) => {
    if (normalizeUsername(m.from) === peerNorm && normalizeUsername(m.to) === me) {
      if (!Array.isArray(m.readBy)) m.readBy = [];
      if (!m.readBy.includes(me)) m.readBy.push(me);
    }
  });
  saveLocalStore();
  updateUnreadChatBadge();
  renderChatSidebar();

  document.getElementById("chat-empty").classList.add("hidden");
  document.getElementById("chat-active-box").classList.remove("hidden");
  document.getElementById("chat-peer-name").textContent = "@" + peerUsername;
  document.getElementById("chat-peer-avatar").textContent = peerUsername.charAt(0);

  const msgsContainer = document.getElementById("chat-messages");
  const threadMsgs = state.chatMessages
    .filter((m) => {
      const f = normalizeUsername(m.from);
      const t = normalizeUsername(m.to);
      return (f === me && t === peerNorm) || (f === peerNorm && t === me);
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  msgsContainer.innerHTML = threadMsgs
    .map((m) => {
      const isOutgoing = normalizeUsername(m.from) === me;
      return `
        <div class="msg-bubble ${isOutgoing ? "outgoing" : "incoming"}">
          ${m.tag ? `<span class="msg-tag">${escapeHtml(m.tag)}</span>` : ""}
          <div>${escapeHtml(m.text)}</div>
          <span class="msg-time">${escapeHtml(formatDateID(m.timestamp))}</span>
        </div>
      `;
    })
    .join("");

  msgsContainer.scrollTop = msgsContainer.scrollHeight;

  if (window.innerWidth < 860) {
    document.getElementById("chat-room").classList.add("mobile-open");
  }
}

/* ============================================================================
   6. ACCOUNT PAGE (NAMA, EMAIL, PASSWORD BISA DIUBAH, SALURAN ADMIN, LOGOUT)
   ============================================================================ */
function syncAccountUI() {
  if (!state.currentUser) return;
  const uKey = normalizeUsername(state.currentUser);
  const prof = state.profiles[uKey] || {
    username: state.currentUser,
    displayName: state.currentUser,
    email: "",
    password: ""
  };

  document.getElementById("account-avatar").textContent = (prof.displayName || state.currentUser).charAt(0);
  document.getElementById("account-display-name").textContent = prof.displayName || state.currentUser;
  document.getElementById("account-display-username").textContent = "@" + state.currentUser;

  document.getElementById("acc-name").value = prof.displayName || state.currentUser;
  document.getElementById("acc-email").value = prof.email || "";
  document.getElementById("acc-password").value = prof.password || "";
}

/* ============================================================================
   EVENT LISTENERS INITIALIZATION
   ============================================================================ */
function bindAllEvents() {
  // Home actions
  document.getElementById("gen-btn").addEventListener("click", (e) => handleGenerateEmail(e.currentTarget));
  document.getElementById("my-email-gen-btn").addEventListener("click", (e) => handleGenerateEmail(e.currentTarget));
  document.getElementById("refresh-btn").addEventListener("click", () => loadDashboardData());

  document.getElementById("copy-latest-btn").addEventListener("click", () => {
    const val = document.getElementById("latest-generated-email").textContent;
    copyTextSafe(val).then((ok) => {
      showToast(ok ? `Disalin: ${val}` : "Gagal menyalin.");
    });
  });

  document.getElementById("close-mobile-reader").addEventListener("click", () => {
    document.getElementById("reader-pane").classList.remove("mobile-open");
  });

  // My Email readiness slider & presets (15 - 60 days)
  const slider = document.getElementById("ready-days-slider");
  const sliderLabel = document.getElementById("ready-days-label");
  slider.value = String(state.readyDaysPref);
  sliderLabel.textContent = `${state.readyDaysPref} Hari`;

  function updateReadyDays(days) {
    state.readyDaysPref = Math.min(60, Math.max(15, Number(days) || 30));
    slider.value = String(state.readyDaysPref);
    sliderLabel.textContent = `${state.readyDaysPref} Hari`;
    document.querySelectorAll(".preset-btn").forEach((b) => {
      b.classList.toggle("active", Number(b.dataset.days) === state.readyDaysPref);
    });
    saveLocalStore();
    renderMyEmailPage();
  }

  slider.addEventListener("input", () => updateReadyDays(slider.value));
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => updateReadyDays(btn.dataset.days));
  });

  document.getElementById("my-email-search").addEventListener("input", renderMyEmailPage);
  document.getElementById("my-email-filter").addEventListener("change", renderMyEmailPage);

  // Market actions
  document.getElementById("open-sell-modal-btn").addEventListener("click", () => openSellModal(""));

  document.getElementById("sell-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const emailAddr = document.getElementById("sell-email-select").value;
    const price = Number(document.getElementById("sell-price").value);
    const description = document.getElementById("sell-desc").value.trim();

    if (!emailAddr || price <= 0 || !description) {
      showToast("Lengkapi pilihan email, harga, dan deskripsi.", "error");
      return;
    }

    const meta = getEmailMetadata(emailAddr);
    const lastMsgFormatted = meta.lastMessageDate
      ? formatDateID(meta.lastMessageDate)
      : "Belum pernah menerima pesan";

    state.marketListings.unshift({
      id: "lst_" + Date.now(),
      email: emailAddr,
      seller: state.currentUser,
      buyer: null,
      price,
      description,
      lastMessageDate: lastMsgFormatted,
      status: "available",
      createdAt: new Date().toISOString(),
      comments: []
    });

    saveLocalStore();
    document.getElementById("sell-modal").classList.add("hidden");
    renderMarket();
    showToast("Email berhasil diposting ke Toko Buy/Sell!");
  });

  // Offer / Comment form
  document.getElementById("offer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const listingId = document.getElementById("offer-listing-id").value;
    const offerPriceVal = document.getElementById("offer-price").value;
    const offerPrice = offerPriceVal ? Number(offerPriceVal) : null;
    const message = document.getElementById("offer-message").value.trim();

    const listing = state.marketListings.find((l) => l.id === listingId);
    if (!listing || !message) return;

    if (!Array.isArray(listing.comments)) listing.comments = [];
    listing.comments.push({
      id: "cmt_" + Date.now(),
      author: state.currentUser,
      offerPrice,
      message,
      createdAt: new Date().toISOString()
    });

    // Kirim otomatis ke Chat penjual jika bukan postingan sendiri
    if (normalizeUsername(listing.seller) !== normalizeUsername(state.currentUser)) {
      const offerTag = offerPrice
        ? `Tawaran ${formatRupiah(offerPrice)} (${censorEmail(listing.email)})`
        : `Tanya Produk (${censorEmail(listing.email)})`;
      pushChatMessage(state.currentUser, listing.seller, message, offerTag);
    }

    saveLocalStore();
    openOfferModal(listingId);
    renderMarket();
    showToast("Komentar diposting & pesan otomatis terkirim ke penjual!");
  });

  // Market filters
  ["filter-price-min", "filter-price-max", "filter-market-search"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderMarket);
  });
  ["filter-sort", "filter-only-available"].forEach((id) => {
    document.getElementById(id).addEventListener("change", renderMarket);
  });

  document.getElementById("reset-market-filter").addEventListener("click", () => {
    document.getElementById("filter-price-min").value = "";
    document.getElementById("filter-price-max").value = "";
    document.getElementById("filter-sort").value = "newest";
    document.getElementById("filter-market-search").value = "";
    document.getElementById("filter-only-available").checked = true;
    renderMarket();
  });

  // Chat actions
  document.getElementById("chat-contact-search").addEventListener("input", renderChatSidebar);

  document.getElementById("close-mobile-chat").addEventListener("click", () => {
    document.getElementById("chat-room").classList.remove("mobile-open");
  });

  document.getElementById("chat-composer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text || !state.activeChatPeer) return;

    pushChatMessage(state.currentUser, state.activeChatPeer, text);
    input.value = "";
    openChatThread(state.activeChatPeer);
  });

  document.getElementById("open-new-chat-btn").addEventListener("click", () => {
    document.getElementById("new-chat-recipient").value = "";
    document.getElementById("new-chat-message").value = "";
    document.getElementById("new-chat-modal").classList.remove("hidden");
  });

  document.getElementById("new-chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const recipient = document.getElementById("new-chat-recipient").value.trim().replace(/^@/, "");
    const message = document.getElementById("new-chat-message").value.trim();
    if (!recipient || !message) return;

    if (normalizeUsername(recipient) === normalizeUsername(state.currentUser)) {
      showToast("Tidak bisa mengirim pesan ke akun sendiri.", "error");
      return;
    }

    pushChatMessage(state.currentUser, recipient, message);
    document.getElementById("new-chat-modal").classList.add("hidden");
    openChatThread(recipient);
    showToast(`Pesan terkirim ke @${recipient}`);
  });

  // Account actions
  document.getElementById("toggle-acc-pass").addEventListener("click", () => {
    const p = document.getElementById("acc-password");
    p.type = p.type === "password" ? "text" : "password";
  });

  document.getElementById("account-update-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!state.currentUser) return;
    const displayName = document.getElementById("acc-name").value.trim();
    const email = document.getElementById("acc-email").value.trim();
    const password = document.getElementById("acc-password").value.trim();

    if (!displayName || password.length < 4) {
      showToast("Nama wajib diisi dan password minimal 4 karakter.", "error");
      return;
    }

    const uKey = normalizeUsername(state.currentUser);
    state.profiles[uKey] = {
      username: state.currentUser,
      displayName,
      email,
      password
    };
    saveLocalStore();
    syncAccountUI();
    showToast("Perubahan profil & password berhasil disimpan!");
  });

  document.getElementById("logout-btn").addEventListener("click", handleLogout);
}

/* ============================================================================
   BOOT APPLICATION
   ============================================================================ */
document.addEventListener("DOMContentLoaded", () => {
  loadLocalStore();
  setupAuth();
  setupNavigation();
  bindAllEvents();

  // Pulihkan sesi login jika tersedia
  let savedUser = null;
  try {
    savedUser = sessionStorage.getItem(STORAGE_KEYS.SESSION) || localStorage.getItem(STORAGE_KEYS.SESSION);
  } catch (_) {}

  if (savedUser) {
    enterDashboard(savedUser);
  }
});
