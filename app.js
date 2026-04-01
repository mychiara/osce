// =================================================================
// GLOBAL STATE & CONFIG
// =================================================================
// ============ SUPABASE CONFIG - GANTI DENGAN MILIK ANDA ============
const SUPABASE_URL = "https://mxehzlpacayivvmehhet.supabase.co"; // <-- GANTI URL INI
const SUPABASE_ANON_KEY = "sb_publishable_M2lEt8Slh_iuWcb2U8_mhg_vCJ1NVVB"; // <-- GANTI KEY INI
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// ===================================================================

let initialData = {
  peserta: [],
  penguji: [],
  stations: [],
  scores: [],
  scheduleParams: {},
  feedback: [],
  backupDate: null,
};

let USER_CREDENTIALS = {
  admin: "admin123", // Default admin, will be updated from Supabase
};

let editPesertaModal,
  editPengujiModal,
  stationModal,
  syncModal,
  generateScheduleModal,
  participantDetailModal,
  editCredentialsModal;
let statusUjianChartInstance,
  penilaianPerStationChartInstance,
  stationAnalyticsChartInstance,
  rubricPerformanceChartInstance,
  participantProgressChartInstance,
  globalPerformanceChartInstance,
  rubricDifficultyChartInstance,
  sessionComparisonChartInstance,
  scoreVsGprChartInstance,
  feedbackRatingChartInstance,
  feedbackCompletionChartInstance;
let stationTimer = null;
let liveMonitorInterval = null;
let realtimeChannels = {};
let isProcessingPendingSync = false;
let syncQueueInterval = null;

// =================================================================
// DASHBOARD GLOBAL TIMER STATE
// =================================================================
let dashboardTimerInterval = null;
let dashboardTimerState = "stopped"; // 'stopped', 'running', 'paused'
let dashboardTimerEndTime = null;
let dashboardTimerRemaining = 0;
let dashboardTimerInfoText = "";
let dashboardActiveRotation = null; // Object { dateStr, sesi, rotasi }

// =================================================================
// INITIALIZATION & SESSION MANAGEMENT
// =================================================================
document.addEventListener("DOMContentLoaded", function () {
  editPesertaModal = new bootstrap.Modal(
    document.getElementById("editPesertaModal"),
  );
  editPengujiModal = new bootstrap.Modal(
    document.getElementById("editPengujiModal"),
  );
  stationModal = new bootstrap.Modal(document.getElementById("stationModal"));
  syncModal = new bootstrap.Modal(document.getElementById("syncModal"));
  generateScheduleModal = new bootstrap.Modal(
    document.getElementById("generateScheduleModal"),
  );
  participantDetailModal = new bootstrap.Modal(
    document.getElementById("participantDetailModal"),
  );
  editCredentialsModal = new bootstrap.Modal(
    document.getElementById("editCredentialsModal"),
  );

  document.getElementById("schedule-start-date").valueAsDate = new Date();

  checkSession();
  setupEventListeners();
});

function checkSession() {
  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  if (user && user.role) {
    document.getElementById("login-page").style.display = "none";
    document.getElementById("app-container").style.display = "block";
    initializeData();
    applyRolePermissions(user);
    setupRealtimeSubscriptions();
  } else {
    document.getElementById("login-page").style.display = "flex";
    document.getElementById("app-container").style.display = "none";
  }
}

// =================================================================
// LOGIN & LOGOUT (REVISED AND CORRECTED)
// =================================================================
async function login(event) {
  event.preventDefault();
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const errorDiv = document.getElementById("login-error");
  const submitButton = document.querySelector(
    '#login-form button[type="submit"]',
  );
  errorDiv.classList.add("d-none");

  submitButton.disabled = true;
  submitButton.innerHTML =
    '<span class="spinner-border spinner-border-sm"></span> Loading...';

  // Try to get the latest data from Supabase, including results and credentials.
  // This is crucial for the app to work with up-to-date information.
  try {
    showSyncStatus(
      '<div class="spinner-border text-primary" role="status"></div><h4 class="mt-3">Autentikasi & Sinkronisasi...</h4><p class="text-muted">Mengambil data terbaru</p>',
    );
    await pullDataFromServer();
    syncModal.hide();
  } catch (pullError) {
    console.warn(
      "Failed to pull data from Supabase during login:",
      pullError.message,
    );
    showSyncStatus(
      '<div class="spinner-border text-warning" role="status"></div><h4 class="mt-3">Gagal Sinkronisasi</h4><p class="text-muted">Server tidak merespons. Mencoba login dengan data lokal (offline)...</p>',
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    syncModal.hide();
  }

  let user = null;
  let loginSuccess = false;

  // Check credentials against the unified USER_CREDENTIALS object.
  // This object is populated/updated by pullDataFromServer().
  if (USER_CREDENTIALS[username] && USER_CREDENTIALS[username] === password) {
    loginSuccess = true;

    // Determine user role after successful login
    if (username === "admin") {
      user = { role: "admin" };
    } else {
      // Check if it's an examiner
      const pengujiDetails = getFromStorage("penguji").find(
        (p) => p.idPenguji === username,
      );
      if (pengujiDetails) {
        user = {
          role: "penguji",
          id: pengujiDetails.id,
          idPenguji: pengujiDetails.idPenguji,
          name: pengujiDetails.nama,
          assignedStationId: pengujiDetails.assignedStationId,
        };
      } else {
        // If not an examiner, it must be a participant
        const pesertaDetails = getFromStorage("peserta").find(
          (p) => p.nim === username,
        );
        if (pesertaDetails) {
          user = {
            role: "peserta",
            id: pesertaDetails.id,
            nim: pesertaDetails.nim,
            name: pesertaDetails.nama,
          };
        }
      }
    }
  }

  // Handle login outcome
  if (loginSuccess && user) {
    sessionStorage.setItem("osce_user", JSON.stringify(user));
    logActivity("LOGIN_SUCCESS", `Username: ${username} (Role: ${user.role})`);
    checkSession();
  } else {
    errorDiv.textContent = "Username atau password salah.";
    errorDiv.classList.remove("d-none");
  }

  submitButton.disabled = false;
  submitButton.innerHTML = "Login";
}

function logout() {
  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  logActivity(
    "LOGOUT",
    `User: ${user ? user.name || user.role : "Sesi"} telah logout.`,
  );
  sessionStorage.clear(); // Clear all session state including active page
  window.location.reload();
}

function applyRolePermissions(user) {
  document
    .querySelectorAll(".role-admin, .role-penguji, .role-peserta")
    .forEach((el) => el.classList.add("d-none"));

  // Base visibility and Defaults
  let defaultPage = "page-dashboard";
  if (user.role === "admin") {
    document
      .querySelectorAll(".role-admin")
      .forEach((el) => el.classList.remove("d-none"));
    defaultPage = "page-dashboard";
  } else if (user.role === "penguji") {
    document
      .querySelectorAll(".role-penguji")
      .forEach((el) => el.classList.remove("d-none"));
    defaultPage = "page-penilaian";
  } else if (user.role === "peserta") {
    document
      .querySelectorAll(".role-peserta")
      .forEach((el) => el.classList.remove("d-none"));
    const welcomeMsg = document.getElementById("peserta-welcome-message");
    if (welcomeMsg) welcomeMsg.textContent = `Selamat Datang, ${user.name}!`;
    defaultPage = "page-peserta-dashboard";
  }

  const savedPage = sessionStorage.getItem("osce_active_page");
  showPage(savedPage || defaultPage);

  document
    .querySelectorAll(".role-all")
    .forEach((el) => el.classList.remove("d-none"));
}
/* =================================================================
   REALTIME & SYNC ENGINE
   ================================================================= */
function updateRealtimeBadge(status) {
  const badge = document.getElementById("realtime-status-badge");
  if (!badge) return;

  const pendingSyncs = getFromStorage("osce_pending_sync") || [];
  const pendingCount = pendingSyncs.length;

  if (status === "online") {
    if (pendingCount > 0) {
      badge.innerHTML = `<i class="fas fa-sync fa-spin me-1 small"></i> Terhubung (${pendingCount} tertunda)`;
      badge.className =
        "badge rounded-pill bg-info text-dark ms-2 d-none d-md-inline-block";
    } else {
      badge.innerHTML = '<i class="fas fa-circle me-1 small"></i> Online';
      badge.className =
        "badge rounded-pill bg-success ms-2 d-none d-md-inline-block";
    }
  } else if (status === "connecting") {
    badge.innerHTML =
      '<i class="fas fa-spinner fa-spin me-1 small"></i> Menghubungkan...';
    badge.className =
      "badge rounded-pill bg-warning text-dark ms-2 d-none d-md-inline-block";
  } else {
    const offlineText =
      pendingCount > 0 ? `Offline (${pendingCount} tertunda)` : "Offline";
    badge.innerHTML = `<i class="fas fa-circle me-1 small"></i> ${offlineText}`;
    badge.className =
      "badge rounded-pill bg-secondary ms-2 d-none d-md-inline-block";
  }
}
async function setupRealtimeSubscriptions() {
  const tables = [
    "peserta",
    "penguji",
    "stations",
    "scores",
    "config",
    "feedback",
    "credentials",
  ];
  updateRealtimeBadge("connecting");
  tables.forEach((table) => {
    if (realtimeChannels[table])
      supabaseClient.removeChannel(realtimeChannels[table]);
    realtimeChannels[table] = supabaseClient
      .channel(`public:${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: table },
        (payload) => {
          console.log(`[Realtime] change in ${table}:`, payload.eventType);
          handleIncomingSync(table, payload);
        },
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log(`[Realtime] Subscribed to ${table}`);
          // Jika salah satu tabel inti terhubung, anggap online
          if (table === "peserta" || table === "scores")
            updateRealtimeBadge("online");
        }
        if (status === "CHANNEL_ERROR") {
          console.error(`[Realtime] Connection error for ${table}:`, err);
          updateRealtimeBadge("offline");
        }
        if (status === "TIMED_OUT") {
          console.warn(`[Realtime] Connection timed out for ${table}`);
          updateRealtimeBadge("offline");
        }
      });
  });
}
function handleIncomingSync(table, payload) {
  const { eventType, new: newRecord, old: oldRecord } = payload;
  let localData = getFromStorage(table);
  if (eventType === "INSERT" || eventType === "UPDATE") {
    const index = localData.findIndex((item) => item.id == newRecord.id);
    if (index > -1) {
      localData[index] = newRecord;
    } else {
      localData.push(newRecord);
    }
    if (table === "config" && newRecord.key === "scheduleParams")
      saveToStorage("osce_schedule_params", newRecord.value);
    if (table === "config" && newRecord.key === "certSettings")
      saveToStorage("osce_cert_settings", newRecord.value);
    if (table === "credentials")
      USER_CREDENTIALS[newRecord.username] = newRecord.password;
  } else if (eventType === "DELETE") {
    localData = localData.filter((item) => item.id != oldRecord.id);
  }
  saveToStorage(table, localData);
  const activePage = document.querySelector(".page.active");
  if (activePage) loadPageContent(activePage.id);
}

// Background Sync Helper to push local changes to Supabase in background
async function syncAction(table, payload, action = "upsert") {
  try {
    let supabaseTable = table;
    if (table === "osce_schedule_params") {
      const { error } = await supabaseClient.from("config").upsert({
        key: "scheduleParams",
        value: payload,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return;
    }
    if (table === "osce_cert_settings") {
      const { error } = await supabaseClient.from("config").upsert({
        key: "certSettings",
        value: payload,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return;
    }
    if (table === "osce_collective_passing_grade") {
      const { error } = await supabaseClient.from("config").upsert({
        key: "osce_collective_passing_grade",
        value: payload,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return;
    }
    if (table === "osce_excluded_stations") {
      const { error } = await supabaseClient.from("config").upsert({
        key: "osce_excluded_stations",
        value: payload,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return;
    }
    if (table === "osce_passing_method") {
      const { error } = await supabaseClient.from("config").upsert({
        key: "osce_passing_method",
        value: payload,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return;
    }

    if (action === "delete") {
      const { error } = await supabaseClient
        .from(supabaseTable)
        .delete()
        .eq("id", payload.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseClient
        .from(supabaseTable)
        .upsert(payload);
      if (error) throw error;
    }

    // Check for network status
    if (navigator.onLine) {
      updateRealtimeBadge("online");
    }
  } catch (e) {
    if (!navigator.onLine) {
      updateRealtimeBadge("offline");
    }
    console.warn(
      `[Auto-Sync Engine] Failure tracking ${table}, queuing for retry:`,
      e.message,
    );
    addToPendingSync(table, payload, action);
  }
}

function addToPendingSync(table, payload, action) {
  const queue = getFromStorage("osce_pending_sync") || [];
  // Hindari duplikasi jika payload memiliki ID yang sama di tabel yang sama
  const exists = queue.findIndex(
    (item) =>
      item.table === table &&
      item.payload.id === payload.id &&
      item.action === action,
  );
  if (exists > -1) {
    queue[exists] = { table, payload, action, timestamp: Date.now() };
  } else {
    queue.push({ table, payload, action, timestamp: Date.now() });
  }
  saveToStorage("osce_pending_sync", queue);
  updateRealtimeBadge(navigator.onLine ? "online" : "offline");
}

async function processPendingSync() {
  if (isProcessingPendingSync || !navigator.onLine) return;
  const queue = getFromStorage("osce_pending_sync") || [];
  if (queue.length === 0) return;

  isProcessingPendingSync = true;
  console.log(`[Sync Engine] Memproses ${queue.length} antrian tertunda...`);

  const remaining = [];
  for (const item of queue) {
    try {
      // Re-use syncAction logic carefully
      let success = false;
      if (item.table.startsWith("osce_")) {
        const configKey =
          item.table === "osce_schedule_params"
            ? "scheduleParams"
            : item.table === "osce_cert_settings"
              ? "certSettings"
              : item.table === "osce_collective_passing_grade"
                ? "osce_collective_passing_grade"
                : item.table === "osce_excluded_stations"
                  ? "osce_excluded_stations"
                  : "osce_passing_method";

        const { error } = await supabaseClient.from("config").upsert({
          key: configKey,
          value: item.payload,
          updated_at: new Date().toISOString(),
        });
        if (!error) success = true;
      } else {
        if (item.action === "delete") {
          const { error } = await supabaseClient
            .from(item.table)
            .delete()
            .eq("id", item.payload.id);
          if (!error) success = true;
        } else {
          const { error } = await supabaseClient
            .from(item.table)
            .upsert(item.payload);
          if (!error) success = true;
        }
      }

      if (!success) remaining.push(item);
    } catch (e) {
      console.warn(`[Sync Engine] Retrying ${item.table} failed:`, e.message);
      remaining.push(item);
    }
  }

  saveToStorage("osce_pending_sync", remaining);
  isProcessingPendingSync = false;
  updateRealtimeBadge("online");

  if (remaining.length === 0) {
    console.log("[Sync Engine] Semua antrian berhasil disinkronkan.");
  }
}

// Network state listeners
window.addEventListener("online", () => {
  updateRealtimeBadge("online");
  processPendingSync();
});
window.addEventListener("offline", () => {
  updateRealtimeBadge("offline");
});
// Periodic check every 30 seconds
if (syncQueueInterval) clearInterval(syncQueueInterval);
syncQueueInterval = setInterval(processPendingSync, 30000);

function initializeData() {
  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  if (user) {
    // Initial silent background pull
    pullDataFromServer().catch((e) =>
      console.warn("Awal sinkronisasi gagal, bekerja dalam model offline..."),
    );
  }
  if (!localStorage.getItem("peserta") && typeof initialData !== "undefined") {
    saveToStorage("peserta", initialData.peserta || []);
    saveToStorage("penguji", initialData.penguji || []);
    saveToStorage("stations", initialData.stations || []);
    saveToStorage("scores", initialData.scores || []);
    saveToStorage("osce_schedule_params", initialData.scheduleParams || {});
    saveToStorage("feedback", initialData.feedback || []);
  }
}

function setupEventListeners() {
  document.getElementById("login-form").addEventListener("submit", login);
  document
    .querySelectorAll("a[data-page]")
    .forEach((link) => link.addEventListener("click", handleNavClick));
  document
    .getElementById("form-add-peserta")
    .addEventListener("submit", addPeserta);
  document
    .getElementById("form-add-penguji")
    .addEventListener("submit", addPenguji);
  document.getElementById("select-penguji").addEventListener("change", (e) => {
    const pengujiId = e.target.value;
    const pengujiList = getFromStorage("penguji");
    const found = pengujiList.find((p) => p.id == pengujiId);
    if (found && found.assignedStationId) {
      document.getElementById("select-station").value = found.assignedStationId;
      displayRubricPreview();
    }
    generateRubricForm();
  });
  document
    .getElementById("select-peserta")
    .addEventListener("change", generateRubricForm);
  document.getElementById("select-station").addEventListener("change", () => {
    displayRubricPreview();
    generateRubricForm();
  });
  document
    .getElementById("btn-export-csv")
    .addEventListener("click", exportToCSV);
  document
    .getElementById("search-peserta")
    .addEventListener("input", (e) => updatePesertaDropdown(e.target.value));
  document
    .getElementById("btn-export-collective-csv")
    .addEventListener("click", exportCollectiveResultsToCSV);
  document
    .getElementById("form-cert-settings")
    .addEventListener("submit", saveCertificateSettings);
  document
    .getElementById("cert-signature-file")
    .addEventListener("change", previewCertificateSignature);
  document
    .getElementById("cert-clear-signature")
    .addEventListener("click", clearCertificateSignature);
  document
    .getElementById("cert-background-file")
    .addEventListener("change", previewCertificateBackground);
  document
    .getElementById("cert-clear-background")
    .addEventListener("click", clearCertificateBackground);
  document
    .getElementById("btn-timer-enter")
    .addEventListener("click", startReadingTimer);
  document
    .getElementById("btn-timer-start")
    .addEventListener("click", startDashboardTimer);
  document
    .getElementById("btn-timer-next")
    .addEventListener("click", nextStationTimer);
  document
    .getElementById("btn-timer-pause")
    .addEventListener("click", pauseDashboardTimer);
  document
    .getElementById("btn-timer-stop")
    .addEventListener("click", stopDashboardTimer);
  document
    .getElementById("timer-type-selector")
    .addEventListener("change", updateTimerDurationSuggestion);
}

function handleNavClick(e) {
  e.preventDefault();
  if (stationTimer) clearInterval(stationTimer);
  if (liveMonitorInterval) {
    clearInterval(liveMonitorInterval);
    liveMonitorInterval = null;
  }
  if (dashboardTimerInterval) {
    stopDashboardTimer();
  }
  const pageId = this.dataset.page;
  if (!pageId) return;
  if (!this.classList.contains("dropdown-toggle")) {
    document
      .querySelectorAll(".nav-link, .dropdown-item")
      .forEach((l) => l.classList.remove("active"));
    this.classList.add("active");
    if (this.closest(".nav-item.dropdown")) {
      this.closest(".nav-item.dropdown")
        .querySelector(".nav-link")
        .classList.add("active");
    }
  }
  showPage(pageId);
}

function showPage(pageId) {
  sessionStorage.setItem("osce_active_page", pageId);
  document
    .querySelectorAll(".page")
    .forEach((page) => page.classList.remove("active"));
  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.add("active");
  } else {
    console.error(`Page with id "${pageId}" not found.`);
    document.getElementById("page-dashboard").classList.add("active");
  }
  if (pageId !== "page-dashboard" && dashboardTimerInterval) {
    stopDashboardTimer();
  }
  loadPageContent(pageId);
}

function loadPageContent(pageId) {
  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  switch (pageId) {
    case "page-dashboard":
      updateDashboard();
      updateLiveMonitor();
      liveMonitorInterval = setInterval(updateLiveMonitor, 15000);
      updateTimerDurationSuggestion();
      break;
    case "page-peserta":
      loadPeserta();
      break;
    case "page-penguji":
      loadPenguji();
      break;
    case "page-station":
      loadStations();
      break;
    case "page-penilaian":
      populatePenilaianDropdowns();
      break;
    case "page-hasil":
      loadScores();
      displayStationRankings();
      renderStationAnalyticsChart();
      renderRubricPerformanceChart();
      const avgGpr100Value = renderGlobalPerformanceAnalysis(); // Calculate GPR first.
      loadCollectiveResults(avgGpr100Value); // Pass it to collective results.
      renderRubricDifficultyChart();
      renderSessionComparisonChart();
      renderScoreVsGprChart();
      loadRemedialRecommendations();
      break;
    case "page-log-sistem":
      loadSystemLog();
      break;
    case "page-feedback-summary":
      loadFeedbackSummary();
      break;
    case "page-sertifikat-settings":
      loadCertificateSettingsPage();
      break;
    case "page-sertifikat-print":
      loadCertificatePrintPage();
      break;
    case "page-sertifikat-penguji":
      loadPengujiCertificatePage();
      break;
    // Peserta Pages
    case "page-peserta-dashboard":
      loadPesertaDashboard();
      break;
    case "page-peserta-hasil":
      loadPesertaHasil();
      break;
    case "page-peserta-sertifikat":
      loadPesertaSertifikat();
      break;
  }
}
function showSyncStatus(htmlContent, isClosable = false) {
  document.getElementById("sync-status-content").innerHTML = htmlContent;
  const modalElement = document.getElementById("syncModal");
  const modalInstance = bootstrap.Modal.getOrCreateInstance(modalElement);
  modalElement.setAttribute("data-bs-backdrop", isClosable ? "true" : "static");
  modalElement.setAttribute("data-bs-keyboard", isClosable ? "true" : "false");
  modalInstance.show();
}

// =================================================================
// DATA SYNC & STORAGE
// =================================================================
async function pushToSupabase() {
  if (
    !confirm(
      "ADMIN: Ini akan MENIMPA semua data di Supabase dengan data lokal saat ini. Lanjutkan?",
    )
  )
    return;
  showSyncStatus(
    '<div class="spinner-border text-info" role="status"></div><h4 class="mt-3">Mengirim Semua Data ke Supabase...</h4>',
  );
  try {
    const pesertaData = getFromStorage("peserta");
    const pengujiData = getFromStorage("penguji");
    const stationsData = getFromStorage("stations");
    const scoresData = getFromStorage("scores");
    const feedbackData = getFromStorage("feedback");
    const scheduleParams = getFromStorage("osce_schedule_params");
    const certSettings = getFromStorage(CERT_SETTINGS_KEY);

    // Delete all existing data then insert fresh
    await supabaseClient.from("peserta").delete().neq("id", 0);
    await supabaseClient.from("penguji").delete().neq("id", 0);
    await supabaseClient.from("stations").delete().neq("id", 0);
    await supabaseClient.from("scores").delete().neq("id", 0);
    await supabaseClient.from("feedback").delete().neq("id", 0);

    // Insert peserta
    if (pesertaData.length > 0) {
      const { error } = await supabaseClient.from("peserta").insert(
        pesertaData.map((p) => ({
          id: p.id,
          nim: p.nim,
          nama: p.nama,
          password: p.password,
          sesi: p.sesi,
        })),
      );
      if (error) throw error;
    }
    // Insert penguji
    if (pengujiData.length > 0) {
      const { error } = await supabaseClient.from("penguji").insert(
        pengujiData.map((p) => ({
          id: p.id,
          idPenguji: p.idPenguji,
          nama: p.nama,
          assignedStationId: p.assignedStationId,
        })),
      );
      if (error) throw error;
    }
    // Insert stations
    if (stationsData.length > 0) {
      const { error } = await supabaseClient.from("stations").insert(
        stationsData.map((s) => ({
          id: s.id,
          name: s.name,
          maxTime: s.maxTime || 0,
          passingGrade: s.passingGrade || 75,
          soal: s.soal || "",
          rubric: s.rubric || [],
        })),
      );
      if (error) throw error;
    }
    // Insert scores
    if (scoresData.length > 0) {
      const { error } = await supabaseClient.from("scores").insert(
        scoresData.map((s) => ({
          id: s.id,
          pengujiId: s.pengujiId,
          pesertaId: s.pesertaId,
          stationId: s.stationId,
          scores: s.scores,
          komentar: s.komentar || "",
          globalPerformance: s.globalPerformance,
        })),
      );
      if (error) throw error;
    }
    // Insert feedback
    if (feedbackData.length > 0) {
      const { error } = await supabaseClient.from("feedback").insert(
        feedbackData.map((f) => ({
          id: f.id,
          pesertaId: f.pesertaId,
          submittedAt: f.submittedAt,
          feedbackItems: f.feedbackItems,
        })),
      );
      if (error) throw error;
    }
    // Upsert configs
    await supabaseClient.from("config").upsert([
      {
        key: "scheduleParams",
        value: scheduleParams || {},
        updated_at: new Date().toISOString(),
      },
      {
        key: "certSettings",
        value: certSettings || {},
        updated_at: new Date().toISOString(),
      },
      {
        key: "osce_collective_passing_grade",
        value: getFromStorage("osce_collective_passing_grade") || 75,
        updated_at: new Date().toISOString(),
      },
      {
        key: "osce_excluded_stations",
        value: getFromStorage("osce_excluded_stations") || [],
        updated_at: new Date().toISOString(),
      },
      {
        key: "osce_passing_method",
        value: getFromStorage("osce_passing_method") || "percentage",
        updated_at: new Date().toISOString(),
      },
    ]);

    // Sync credentials: build from peserta + penguji passwords
    await supabaseClient.from("credentials").delete().neq("role", "admin"); // Keep admin
    const credentialsToInsert = [];
    pengujiData.forEach((p) => {
      if (USER_CREDENTIALS[p.idPenguji]) {
        credentialsToInsert.push({
          username: p.idPenguji,
          password: USER_CREDENTIALS[p.idPenguji],
          role: "penguji",
        });
      }
    });
    pesertaData.forEach((p) => {
      credentialsToInsert.push({
        username: p.nim,
        password: p.password || p.nim,
        role: "peserta",
      });
    });
    if (credentialsToInsert.length > 0) {
      await supabaseClient
        .from("credentials")
        .upsert(credentialsToInsert, { onConflict: "username" });
    }

    showSyncStatus(
      `<i class="fas fa-check-circle fa-3x text-success mb-3"></i><h4>Sinkronisasi ke Supabase Berhasil!</h4><p class="text-muted">Semua data telah dikirim.</p><button class="btn btn-primary" data-bs-dismiss="modal">Tutup</button>`,
      true,
    );
    logActivity("SYNC_PUSH_ALL");
  } catch (error) {
    console.error("Push to Supabase error:", error);
    showSyncStatus(
      `<i class="fas fa-times-circle fa-3x text-danger mb-3"></i><h4>Sinkronisasi Gagal!</h4><p class="text-muted">Error:</p><small class="bg-light p-2 d-block text-start">${error.message || error.toString()}</small><button class="btn btn-secondary mt-3" data-bs-dismiss="modal">Tutup</button>`,
      true,
    );
  }
}

// Alias for backward compatibility
function pushToGoogleSheets() {
  pushToSupabase();
}

async function pushPengujiScores() {
  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  if (!user || user.role !== "penguji") return;
  const pengujiId = user.id;
  const allScores = getFromStorage("scores");
  const myScores = allScores.filter((s) => s.pengujiId === pengujiId);
  if (myScores.length === 0)
    return alert("Anda belum memiliki data penilaian untuk dikirim.");
  if (
    !confirm(
      `Anda akan mengirim ${myScores.length} data penilaian ke Supabase. Lanjutkan?`,
    )
  )
    return;
  showSyncStatus(
    '<div class="spinner-border text-info" role="status"></div><h4 class="mt-3">Mengirim Data Nilai Anda...</h4>',
  );
  try {
    const scoresToUpsert = myScores.map((s) => ({
      id: s.id,
      pengujiId: s.pengujiId,
      pesertaId: s.pesertaId,
      stationId: s.stationId,
      scores: s.scores,
      komentar: s.komentar || "",
      globalPerformance: s.globalPerformance,
    }));
    const { error } = await supabaseClient
      .from("scores")
      .upsert(scoresToUpsert, { onConflict: "id" });
    if (error) throw error;
    showSyncStatus(
      `<i class="fas fa-check-circle fa-3x text-success mb-3"></i><h4>Kirim Nilai Berhasil!</h4><p class="text-muted">${myScores.length} nilai berhasil disinkronkan ke Supabase.</p><button class="btn btn-primary" data-bs-dismiss="modal">Tutup</button>`,
      true,
    );
  } catch (error) {
    console.error("Push penguji scores error:", error);
    showSyncStatus(
      `<i class="fas fa-times-circle fa-3x text-danger mb-3"></i><h4>Kirim Nilai Gagal!</h4><p class="text-muted">Error:</p><small class="bg-light p-2 d-block text-start">${error.message || error.toString()}</small><button class="btn btn-secondary mt-3" data-bs-dismiss="modal">Tutup</button>`,
      true,
    );
  }
}

async function pullDataFromServer() {
  try {
    // Fetch all tables in parallel from Supabase
    const [
      pesertaRes,
      pengujiRes,
      stationsRes,
      scoresRes,
      credentialsRes,
      configRes,
      feedbackRes,
    ] = await Promise.all([
      supabaseClient.from("peserta").select("*"),
      supabaseClient.from("penguji").select("*"),
      supabaseClient.from("stations").select("*"),
      supabaseClient.from("scores").select("*"),
      supabaseClient.from("credentials").select("*"),
      supabaseClient.from("config").select("*"),
      supabaseClient.from("feedback").select("*"),
    ]);

    // Check for errors
    if (pesertaRes.error) throw pesertaRes.error;
    if (pengujiRes.error) throw pengujiRes.error;
    if (stationsRes.error) throw stationsRes.error;
    if (scoresRes.error) throw scoresRes.error;
    if (credentialsRes.error) throw credentialsRes.error;
    if (configRes.error) throw configRes.error;
    if (feedbackRes.error) throw feedbackRes.error;

    // Save to localStorage
    saveToStorage("peserta", pesertaRes.data || []);
    saveToStorage("penguji", pengujiRes.data || []);
    saveToStorage("stations", stationsRes.data || []);
    saveToStorage("scores", scoresRes.data || []);
    saveToStorage("feedback", feedbackRes.data || []);

    // Parse config
    const configMap = {};
    (configRes.data || []).forEach((c) => {
      configMap[c.key] = c.value;
    });
    saveToStorage("osce_schedule_params", configMap.scheduleParams || {});
    saveToStorage("osce_cert_settings", configMap.certSettings || {});
    saveToStorage(
      "osce_collective_passing_grade",
      configMap.osce_collective_passing_grade,
    );
    saveToStorage(
      "osce_excluded_stations",
      configMap.osce_excluded_stations || [],
    );
    saveToStorage(
      "osce_passing_method",
      configMap.osce_passing_method || "percentage",
    );

    // Update credentials
    USER_CREDENTIALS = { admin: "admin123" }; // Keep admin as fallback
    (credentialsRes.data || []).forEach((cred) => {
      if (cred.username && cred.password) {
        USER_CREDENTIALS[cred.username] = cred.password;
      }
    });

    return {
      peserta: pesertaRes.data,
      penguji: pengujiRes.data,
      stations: stationsRes.data,
      scores: scoresRes.data,
    };
  } catch (error) {
    console.error("Pull from Supabase error:", error);
    throw new Error(
      "Gagal mengambil data terbaru: " + (error.message || error.toString()),
    );
  }
}

async function pullFromSupabase() {
  if (
    !confirm(
      "Ini akan MENIMPA semua data lokal dengan data dari Supabase, TERMASUK PENGATURAN JADWAL DAN KREDENSIAL. Lanjutkan?",
    )
  )
    return;
  showSyncStatus(
    '<div class="spinner-border text-success" role="status"></div><h4 class="mt-3">Menarik Data dari Supabase...</h4>',
  );
  try {
    await pullDataFromServer();
    showSyncStatus(
      `<i class="fas fa-check-circle fa-3x text-success mb-3"></i><h4>Tarik Data Berhasil!</h4><p class="text-muted">Memuat ulang tampilan...</p>`,
      true,
    );
    logActivity("SYNC_PULL_ALL");
    setTimeout(() => {
      syncModal.hide();
      loadPageContent(document.querySelector(".page.active").id);
    }, 1500);
  } catch (error) {
    showSyncStatus(
      `<i class="fas fa-times-circle fa-3x text-danger mb-3"></i><h4>Tarik Data Gagal!</h4><p class="text-muted">Error:</p><small class="bg-light p-2 d-block text-start">${error.toString()}</small><button class="btn btn-secondary mt-3" data-bs-dismiss="modal">Tutup</button>`,
      true,
    );
  }
}

// Alias for backward compatibility
async function pullFromGoogleSheets() {
  await pullFromSupabase();
}

// =================================================================
// UTILITY & HELPER FUNCTIONS
// =================================================================
const getFromStorage = (key) =>
  JSON.parse(localStorage.getItem(key)) ||
  (key === "osce_schedule_params" || key === "osce_cert_settings" ? {} : []);
const saveToStorage = (key, data) =>
  localStorage.setItem(key, JSON.stringify(data));

const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
};
const formatTime = (date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const timeToDate = (timeStr, baseDate = new Date()) => {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const newDate = new Date(baseDate);
  newDate.setHours(hours, minutes, 0, 0);
  return newDate;
};
function calculateWeightedScore(scoreObject, station) {
  if (!station || !station.rubric || !scoreObject)
    return { achieved: 0, max: 0, percentage: 0 };
  let achievedScore = 0;
  let maxPossibleScore = 0;
  scoreObject.scores.forEach((item) => {
    const rubricItem = station.rubric.find((r) => r.id === item.rubricId);
    if (rubricItem) {
      const weight = rubricItem.bobot || 1;
      achievedScore += item.score * weight;
      maxPossibleScore += rubricItem.maxScore * weight;
    }
  });
  const percentage =
    maxPossibleScore > 0 ? (achievedScore / maxPossibleScore) * 100 : 0;
  return { achieved: achievedScore, max: maxPossibleScore, percentage };
}

/**
 * Mendapatkan daftar nilai unik untuk setiap peserta per stasiun (mengambil yang tertinggi).
 * Digunakan untuk rekapitulasi agar remedial/retake tidak dihitung ganda.
 */
function getBestScoresPerParticipantPerStation() {
  const scores = getFromStorage("scores");
  const stations = getFromStorage("stations");
  const bestScoresMap = {};

  scores.forEach((score) => {
    const key = `${score.pesertaId}_${score.stationId}`;
    const station = stations.find((s) => s.id === score.stationId);
    if (!station) return;

    const { percentage } = calculateWeightedScore(score, station);

    if (!bestScoresMap[key] || percentage > bestScoresMap[key].percentage) {
      bestScoresMap[key] = { score, percentage };
    }
  });

  return Object.values(bestScoresMap).map((item) => item.score);
}

// =================================================================
// CRUD: PESERTA (REVISED FOR PASSWORD)
// =================================================================
async function addPeserta(e) {
  e.preventDefault();
  const nim = document.getElementById("peserta-nim").value.trim();
  const nama = document.getElementById("peserta-nama").value.trim();
  let password = document.getElementById("peserta-password").value.trim();
  if (!nim || !nama) return alert("NIM dan Nama tidak boleh kosong!");
  if (!password) password = nim; // Default password is NIM if left empty
  let peserta = getFromStorage("peserta");
  if (peserta.some((p) => p.nim === nim)) return alert("NIM sudah terdaftar.");
  const newPeserta = { id: Date.now(), nim, nama, password, sesi: null };
  peserta.push(newPeserta);
  saveToStorage("peserta", peserta);
  // Realtime Push to Supabase in Background
  syncAction("peserta", newPeserta);
  syncAction("credentials", {
    username: nim,
    password: password,
    role: "peserta",
  });
  logActivity("CREATE_PESERTA", `NIM: ${nim}, Nama: ${nama} (Otomatis)`);
  document.getElementById("form-add-peserta").reset();
  loadPeserta();
}

async function deleteAllPeserta() {
  if (
    !confirm(
      "Peringatan: Anda akan menghapus SELURUH data peserta dan kredensial login mereka. Tindakan ini tidak dapat diurungkan.",
    )
  )
    return;
  if (!confirm("KONFIRMASI TERAKHIR: Hapus semua data peserta sekarang?"))
    return;

  try {
    // 1. Delete all from Supabase
    const { error: pError } = await supabaseClient
      .from("peserta")
      .delete()
      .not("id", "is", null);
    if (pError) throw pError;

    // 2. Delete credentials for peserta
    const { error: cError } = await supabaseClient
      .from("credentials")
      .delete()
      .eq("role", "peserta");
    if (cError) throw cError;

    // 3. Update Local Storage
    saveToStorage("peserta", []);

    // 4. Update UI
    loadPeserta();
    logActivity(
      "DELETE_ALL_PESERTA",
      "Seluruh data peserta dihapus secara permanen.",
    );
    alert("Seluruh data peserta berhasil dihapus.");
  } catch (e) {
    console.error("Gagal menghapus semua peserta:", e.message);
    alert("Gagal menghapus data: " + e.message);
  }
}
function loadPeserta() {
  const peserta = getFromStorage("peserta");
  document.getElementById("table-peserta-body").innerHTML =
    peserta
      .sort(
        (a, b) =>
          (a.sesi || 999) - (b.sesi || 999) || a.nama.localeCompare(b.nama),
      )
      .map((p) => {
        const sesi =
          p.sesi ||
          '<span class="text-muted fst-italic">Belum Dijadwalkan</span>';
        return `<tr><td>${p.nim}</td><td>${p.nama}</td><td><b>${sesi}</b></td><td class="text-center"><button class="btn btn-sm btn-info me-2" onclick="printExamCard(${p.id})" title="Cetak Kartu Ujian"><i class="fas fa-id-card"></i> Kartu</button><button class="btn btn-sm btn-warning me-2" onclick="openEditPesertaModal(${p.id})" title="Edit"><i class="fas fa-edit"></i></button><button class="btn btn-sm btn-danger" onclick="deleteItem('peserta', ${p.id}, loadPeserta)" title="Hapus"><i class="fas fa-trash-alt"></i></button></td></tr>`;
      })
      .join("") ||
    `<tr><td colspan="4" class="text-center text-muted">Belum ada data peserta.</td></tr>`;
}
function openEditPesertaModal(id) {
  const peserta = getFromStorage("peserta").find((p) => p.id === id);
  if (peserta) {
    document.getElementById("edit-peserta-id").value = peserta.id;
    document.getElementById("edit-peserta-nim").value = peserta.nim;
    document.getElementById("edit-peserta-nama").value = peserta.nama;
    document.getElementById("edit-peserta-password").value = "";
    editPesertaModal.show();
  }
}
async function savePesertaChanges() {
  const id = parseInt(document.getElementById("edit-peserta-id").value);
  const nim = document.getElementById("edit-peserta-nim").value.trim();
  const nama = document.getElementById("edit-peserta-nama").value.trim();
  const newPassword = document
    .getElementById("edit-peserta-password")
    .value.trim();
  if (!nim || !nama) return alert("NIM dan Nama tidak boleh kosong.");
  let pesertaList = getFromStorage("peserta");
  const index = pesertaList.findIndex((p) => p.id === id);
  if (index > -1) {
    if (pesertaList.some((p) => p.nim === nim && p.id !== id)) {
      return alert("NIM sudah digunakan peserta lain.");
    }
    pesertaList[index].nim = nim;
    pesertaList[index].nama = nama;
    if (newPassword) {
      pesertaList[index].password = newPassword;
    }
    saveToStorage("peserta", pesertaList);
    // Realtime Sync
    syncAction("peserta", pesertaList[index]);
    if (newPassword)
      syncAction("credentials", {
        username: nim,
        password: newPassword,
        role: "peserta",
      });
    logActivity(
      "UPDATE_PESERTA",
      `ID: ${id}, NIM: ${nim}, Nama: ${nama} (Otomatis)`,
    );
    loadPeserta();
    editPesertaModal.hide();
  }
}
// All other functions from the previous response follow here...
// (The rest of the script is identical to the one I provided before the "lanjutkan" prompt)

// =================================================================
// DASHBOARD GLOBAL TIMER FUNCTIONS
// =================================================================
// Sound Helper Functions
function speakText(text, repeat = 1) {
  if (!window.speechSynthesis) return;

  const speakOnce = (currentCount) => {
    if (currentCount >= repeat) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "id-ID";
    utterance.rate = 1.0;
    utterance.onend = () => speakOnce(currentCount + 1);
    window.speechSynthesis.speak(utterance);
  };

  window.speechSynthesis.cancel();
  speakOnce(0);
}

function updateDashboardTimerDisplay() {
  const display = document.getElementById("dashboard-timer-display");
  const remainingMs = dashboardTimerEndTime - new Date().getTime();
  const secondsLeft = Math.floor(remainingMs / 1000);

  if (remainingMs <= 0) {
    display.textContent = "00:00";
    display.classList.remove("text-warning");
    display.classList.add("text-danger");
    document.getElementById("dashboard-timer-info").textContent =
      "Pindah Stasiun!";

    // 1. "Waktu habis" (3x suara)
    speakText("WAKTU HABIS.", 3);

    // 2. "Silakan pindah ke stase selanjutnya" (1x suara) - after a short delay
    setTimeout(() => {
      speakText("SILAKAN PINDAH KE STASE SELANJUTNYA.");
    }, 4500);

    stopDashboardTimer();
    return;
  }

  const seconds = Math.floor((remainingMs / 1000) % 60);
  const minutes = Math.floor(remainingMs / (1000 * 60));

  display.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  // Voice alert: waktu sisa 3 menit (2x)
  if (minutes === 3 && seconds === 0) {
    if (!this.lastAnnounced3m || this.lastAnnounced3m !== 3) {
      speakText("WAKTU SISA 3 MENIT.", 2);
      this.lastAnnounced3m = 3;
    }
  }

  // Voice warning for last 10 seconds (countdown simplified for speed)
  if (secondsLeft <= 10 && secondsLeft > 0) {
    if (
      !this.lastAnnouncedSeconds ||
      this.lastAnnouncedSeconds !== secondsLeft
    ) {
      speakText(`${secondsLeft}`);
      this.lastAnnouncedSeconds = secondsLeft;
    }
  }

  if (remainingMs < 60000 && remainingMs > 0) {
    display.classList.add("text-warning");
    display.classList.remove("text-danger");
  } else if (remainingMs > 60000) {
    display.classList.remove("text-warning", "text-danger");
  }
}
function updateTimerDurationSuggestion() {
  const selector = document.querySelector('input[name="timer-type"]:checked');
  if (!selector) return;

  const type = selector.value;
  const durationInput = document.getElementById("timer-duration-input");
  const suggestionText = document.getElementById("timer-duration-suggestion");

  const { stations, rotationDuration } = getScheduleParameters();

  if (type === "rotation") {
    const finalDuration = rotationDuration > 0 ? rotationDuration : 10; // Fallback
    durationInput.value = finalDuration;
    suggestionText.textContent = `Durasi rotasi sesuai jadwal adalah ${finalDuration} menit.`;
  } else if (type === "session") {
    if (stations.length > 0 && rotationDuration > 0) {
      const sessionDuration = rotationDuration * stations.length;
      durationInput.value = sessionDuration;
      suggestionText.textContent = `Total durasi sesi (${stations.length} stasiun x ${rotationDuration} mnt) adalah ${sessionDuration} menit.`;
    } else {
      durationInput.value = 60; // fallback
      suggestionText.textContent =
        "Data stasiun/jadwal tidak ditemukan. Durasi default 60 menit.";
    }
  }
}
function startReadingTimer() {
  if (dashboardTimerState !== "stopped") {
    if (
      !confirm("Hentikan timer yang sedang berjalan untuk mulai waktu membaca?")
    )
      return;
    stopDashboardTimer();
  }

  // 1. Voice alert (3x)
  speakText("SILAKAN MEMBACA SOAL", 3);

  // 2. Start 1-minute countdown
  dashboardTimerEndTime = new Date().getTime() + 1 * 60 * 1000;
  dashboardTimerState = "running";
  document.getElementById("dashboard-timer-info").textContent =
    "Waktu Membaca Soal sedang berjalan (1 menit)...";

  dashboardTimerInterval = setInterval(updateDashboardTimerDisplay, 1000);
  updateDashboardTimerDisplay();

  // Control visibility
  document.getElementById("btn-timer-start").disabled = false; // Allow start exam early
  document.getElementById("btn-timer-next").disabled = true;
  document.getElementById("btn-timer-pause").disabled = false;
  document.getElementById("btn-timer-stop").disabled = false;
  document.getElementById("timer-duration-input").disabled = true;
}

function startDashboardTimer() {
  // If a reading timer or previous timer was running, clear it first
  if (dashboardTimerState !== "stopped") {
    clearInterval(dashboardTimerInterval);
  }

  const durationInput = document.getElementById("timer-duration-input");
  const durationInMinutes = parseInt(durationInput.value);

  if (isNaN(durationInMinutes) || durationInMinutes <= 0) {
    alert("Harap masukkan durasi yang valid (angka positif).");
    return;
  }

  const timerType = document.querySelector(
    'input[name="timer-type"]:checked',
  ).value;
  const timerTypeLabel = timerType === "rotation" ? "Rotasi" : "Sesi";

  dashboardTimerEndTime = new Date().getTime() + durationInMinutes * 60 * 1000;

  document.getElementById("dashboard-timer-info").textContent =
    `Timer ${timerTypeLabel} (${durationInMinutes} menit) sedang berjalan...`;

  // Voice alert for start (2x - SILAKAN MASUK DAN MULAI MENGERJAKAN)
  speakText("SILAKAN MASUK DAN MULAI MENGERJAKAN.", 2);

  dashboardTimerInterval = setInterval(updateDashboardTimerDisplay, 1000);
  dashboardTimerState = "running";

  // SYNC MONITOR: Set initial rotation if not already set
  if (!dashboardActiveRotation) {
    const schedule = calculateFullSchedule();
    const now = new Date();
    const current =
      schedule.find((item) => {
        const start = timeToDate(item.waktuMulai, item.date);
        const end = timeToDate(item.waktuSelesai, item.date);
        return now >= start && now < end;
      }) ||
      schedule.find((item) => timeToDate(item.waktuMulai, item.date) > now) ||
      schedule[0];

    if (current) {
      dashboardActiveRotation = {
        dateStr: current.date.toISOString().slice(0, 10),
        sesi: current.sesi,
        rotasi: current.rotasi,
      };
    }
  }

  updateDashboardTimerDisplay();
  updateLiveMonitor(); // Refresh monitor context

  document.getElementById("btn-timer-start").disabled = true;
  document.getElementById("btn-timer-next").disabled = false;
  document.getElementById("btn-timer-pause").disabled = false;
  document.getElementById("btn-timer-stop").disabled = false;
  durationInput.disabled = true;
  document
    .querySelectorAll("#timer-type-selector .btn-check")
    .forEach((input) => (input.disabled = true));
  document
    .querySelectorAll("#timer-type-selector .btn-outline-primary")
    .forEach((label) => label.classList.add("disabled"));
}

function nextStationTimer() {
  if (dashboardTimerState === "stopped") return;

  // 1. Stop current timer
  clearInterval(dashboardTimerInterval);
  dashboardTimerInterval = null;
  dashboardTimerState = "stopped";
  dashboardTimerEndTime = null;

  // 2. Announce move to next stase
  speakText("SILAKAN PINDAH KE STASE SELANJUTNYA.");

  // 3. ADVANCE MONITOR CONTEXT: Find next rotation in schedule
  const schedule = calculateFullSchedule();
  if (dashboardActiveRotation && schedule.length > 0) {
    const uniqueRotations = [];
    const seen = new Set();
    schedule.forEach((item) => {
      const key = `${item.date.toISOString().slice(0, 10)}|${item.sesi}|${item.rotasi}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRotations.push({
          dateStr: item.date.toISOString().slice(0, 10),
          sesi: item.sesi,
          rotasi: item.rotasi,
          time: timeToDate(item.waktuMulai, item.date),
        });
      }
    });
    uniqueRotations.sort((a, b) => a.time - b.time);

    const currentIndex = uniqueRotations.findIndex(
      (r) =>
        r.dateStr === dashboardActiveRotation.dateStr &&
        r.sesi === dashboardActiveRotation.sesi &&
        r.rotasi === dashboardActiveRotation.rotasi,
    );

    if (currentIndex > -1 && currentIndex < uniqueRotations.length - 1) {
      dashboardActiveRotation = uniqueRotations[currentIndex + 1];
    }
  }

  // 4. RESET UI STATE (No auto-start)
  const display = document.getElementById("dashboard-timer-display");
  display.textContent = "00:00";
  display.classList.remove("text-warning", "text-danger");
  document.getElementById("dashboard-timer-info").textContent =
    "Sesi Selesai - Panitia/Peserta Pindah Stase. Menunggu Mulai Berikutnya...";

  document.getElementById("btn-timer-start").disabled = false;
  document.getElementById("btn-timer-next").disabled = true;
  document.getElementById("btn-timer-pause").disabled = true;
  document.getElementById("btn-timer-stop").disabled = false;
  document.getElementById("timer-duration-input").disabled = false;

  updateLiveMonitor(); // Refresh monitor to new participants
}
function pauseDashboardTimer() {
  const pauseButton = document.getElementById("btn-timer-pause");
  const infoDisplay = document.getElementById("dashboard-timer-info");

  if (dashboardTimerState === "running") {
    clearInterval(dashboardTimerInterval);
    dashboardTimerRemaining = dashboardTimerEndTime - new Date().getTime();
    dashboardTimerState = "paused";
    pauseButton.innerHTML = '<i class="fas fa-play me-2"></i>Lanjutkan';
    pauseButton.classList.replace("btn-warning", "btn-info");
    dashboardTimerInfoText = infoDisplay.textContent;
    infoDisplay.innerHTML += " <b>(Dijeda)</b>";
  } else if (dashboardTimerState === "paused") {
    dashboardTimerEndTime = new Date().getTime() + dashboardTimerRemaining;
    dashboardTimerInterval = setInterval(updateDashboardTimerDisplay, 1000);
    dashboardTimerState = "running";
    pauseButton.innerHTML = '<i class="fas fa-pause me-2"></i>Jeda';
    pauseButton.classList.replace("btn-info", "btn-warning");
    infoDisplay.textContent = dashboardTimerInfoText;
  }
}
function stopDashboardTimer() {
  clearInterval(dashboardTimerInterval);
  dashboardTimerInterval = null;
  dashboardTimerState = "stopped";
  dashboardTimerEndTime = null;
  dashboardTimerRemaining = 0;
  dashboardTimerInfoText = "";
  dashboardActiveRotation = null; // Clear sync

  const display = document.getElementById("dashboard-timer-display");
  display.textContent = "00:00";
  display.classList.remove("text-warning", "text-danger");
  document.getElementById("dashboard-timer-info").textContent = "Menunggu...";

  const startBtn = document.getElementById("btn-timer-start");
  const nextBtn = document.getElementById("btn-timer-next");
  const pauseBtn = document.getElementById("btn-timer-pause");
  const stopBtn = document.getElementById("btn-timer-stop");

  startBtn.disabled = false;
  nextBtn.disabled = true;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;

  pauseBtn.innerHTML = '<i class="fas fa-pause me-2"></i>Jeda';
  if (pauseBtn.classList.contains("btn-info")) {
    pauseBtn.classList.replace("btn-info", "btn-warning");
  }

  document.getElementById("timer-duration-input").disabled = false;
  document
    .querySelectorAll("#timer-type-selector .btn-check")
    .forEach((input) => (input.disabled = false));
  document
    .querySelectorAll("#timer-type-selector .btn-outline-primary")
    .forEach((label) => label.classList.remove("disabled"));
  updateTimerDurationSuggestion();
}

// =================================================================
// MANAJEMEN JADWAL & PRINT
// =================================================================
function openGenerateScheduleModal() {
  const stations = getFromStorage("stations");
  if (stations.length === 0) {
    return alert(
      "Tidak ada data stasiun. Harap buat stasiun terlebih dahulu untuk membuat jadwal.",
    );
  }
  const existingParams = getFromStorage("osce_schedule_params");
  if (existingParams && existingParams.startDate) {
    document.getElementById("schedule-start-date").value =
      existingParams.startDate;
    document.getElementById("schedule-start-time").value =
      existingParams.startTime || "08:00";
    document.getElementById("schedule-end-time").value =
      existingParams.endTime || "17:00";
    document.getElementById("schedule-duration").value =
      existingParams.defaultDuration || 10;
    document.getElementById("schedule-break").value =
      existingParams.breakDuration || 15;
    document.getElementById("schedule-lunch-start").value =
      existingParams.lunchStartTime || "12:00";
    document.getElementById("schedule-lunch-end").value =
      existingParams.lunchEndTime || "13:00";
  }

  generateScheduleModal.show();
}
async function generateExamSchedule() {
  let peserta = getFromStorage("peserta");
  const stations = getFromStorage("stations");
  if (peserta.length === 0)
    return alert("Tidak ada data peserta untuk dijadwalkan.");
  if (stations.length === 0)
    return alert("Tidak ada stasiun. Harap buat stasiun terlebih dahulu.");
  const startDateInput = document.getElementById("schedule-start-date").value;
  if (!startDateInput) return alert("Harap tentukan Tanggal Mulai Ujian.");
  if (
    !confirm(
      "Anda akan membuat jadwal ujian baru? Jadwal akan otomatis terupdate di semua perangkat (Realtime). Lanjutkan?",
    )
  )
    return;
  const scheduleParams = {
    startDate: startDateInput,
    startTime: document.getElementById("schedule-start-time").value,
    endTime: document.getElementById("schedule-end-time").value,
    defaultDuration: parseInt(
      document.getElementById("schedule-duration").value,
    ),
    breakDuration: parseInt(document.getElementById("schedule-break").value),
    lunchStartTime: document.getElementById("schedule-lunch-start").value,
    lunchEndTime: document.getElementById("schedule-lunch-end").value,
  };
  saveToStorage("osce_schedule_params", scheduleParams);
  // Realtime Sync Params
  syncAction("osce_schedule_params", scheduleParams);

  peserta.forEach((p) => {
    p.sesi = null;
  });
  let shuffledPeserta = [...peserta];
  shuffleArray(shuffledPeserta);
  const groupSize = stations.length;
  let sessionNumber = 1;
  for (let i = 0; i < shuffledPeserta.length; i += groupSize) {
    const sessionPeserta = shuffledPeserta.slice(i, i + groupSize);
    sessionPeserta.forEach((p) => {
      const pesertaToUpdate = peserta.find((original) => original.id === p.id);
      if (pesertaToUpdate) pesertaToUpdate.sesi = sessionNumber;
    });
    sessionNumber++;
  }
  saveToStorage("peserta", peserta);

  // Realtime Bulk Update (Background)
  Promise.all(peserta.map((p) => syncAction("peserta", p)));

  logActivity("GENERATE_SCHEDULE", `Jadwal baru dibuat (Otomatis Sync)`);
  alert(
    `Jadwal sesi berhasil dibuat dan sedang disinkronkan ke server secara otomatis.`,
  );
  loadPeserta();
  if (typeof loadFullSchedule === "function") loadFullSchedule();
  generateScheduleModal.hide();
  if (document.getElementById("page-dashboard").classList.contains("active"))
    updateDashboard();
}
async function clearExamSchedule() {
  if (!confirm("Anda yakin ingin menghapus SEMUA jadwal sesi? (Realtime Sync)"))
    return;
  let peserta = getFromStorage("peserta");
  if (peserta.every((p) => !p.sesi))
    return alert("Tidak ada jadwal yang perlu dihapus.");
  peserta.forEach((p) => {
    p.sesi = null;
  });
  saveToStorage("peserta", peserta);
  saveToStorage("osce_schedule_params", {});
  // Realtime Push
  syncAction("osce_schedule_params", {});
  Promise.all(peserta.map((p) => syncAction("peserta", p)));

  logActivity("CLEAR_SCHEDULE", "Jadwal dikosongkan (Otomatis)");
  alert(
    "Semua jadwal sesi peserta dan pengaturan jadwal berhasil dihapus secara otomatis.",
  );
  if (document.getElementById("page-peserta").classList.contains("active"))
    loadPeserta();
}
function getScheduleParameters() {
  const stations = getFromStorage("stations");
  const params = getFromStorage("osce_schedule_params") || {};
  const defaults = {
    startDate: new Date().toISOString().slice(0, 10),
    startTime: "08:00",
    endTime: "17:00",
    defaultDuration: 10,
    breakDuration: 15,
    lunchStartTime: "12:00",
    lunchEndTime: "13:00",
  };
  const finalParams = { ...defaults, ...params };
  const rotationDuration = Math.max(
    finalParams.defaultDuration,
    ...stations.map((s) => s.maxTime || 0),
  );
  return { stations, rotationDuration, ...finalParams };
}
function calculateFullSchedule() {
  const peserta = getFromStorage("peserta");
  const {
    stations,
    startDate,
    startTime,
    endTime,
    breakDuration,
    lunchStartTime,
    lunchEndTime,
    rotationDuration,
  } = getScheduleParameters();
  if (
    stations.length === 0 ||
    peserta.filter((p) => p.sesi).length === 0 ||
    !startDate
  )
    return [];
  const scheduleBySession = peserta.reduce((acc, p) => {
    if (!p.sesi) return acc;
    if (!acc[p.sesi]) acc[p.sesi] = [];
    acc[p.sesi].push(p);
    return acc;
  }, {});
  const fullSchedule = [];
  const baseDate = new Date(startDate + "T00:00:00");
  let currentDayDate = new Date(baseDate);
  let currentTime = timeToDate(startTime, currentDayDate);
  const maxEndTime = timeToDate(endTime);
  const sortedSessionKeys = Object.keys(scheduleBySession).sort(
    (a, b) => parseInt(a) - parseInt(b),
  );
  sortedSessionKeys.forEach((sesiStr, sessionIndex) => {
    const sesi = parseInt(sesiStr);
    const sessionPeserta = scheduleBySession[sesi];
    const lunchBreakStart = timeToDate(lunchStartTime, currentDayDate);
    const lunchBreakEnd = timeToDate(lunchEndTime, currentDayDate);
    const sessionTotalDuration = stations.length * rotationDuration;
    let potentialSessionStartTime = new Date(currentTime);
    if (
      potentialSessionStartTime < lunchBreakEnd &&
      new Date(
        potentialSessionStartTime.getTime() + sessionTotalDuration * 60000,
      ) > lunchBreakStart
    ) {
      potentialSessionStartTime = new Date(lunchBreakEnd);
    }
    const potentialSessionEndTime = new Date(
      potentialSessionStartTime.getTime() + sessionTotalDuration * 60000,
    );
    maxEndTime.setFullYear(
      currentDayDate.getFullYear(),
      currentDayDate.getMonth(),
      currentDayDate.getDate(),
    );
    if (potentialSessionEndTime > maxEndTime) {
      currentDayDate.setDate(currentDayDate.getDate() + 1);
      potentialSessionStartTime = timeToDate(startTime, currentDayDate);
      const newDayLunchStart = timeToDate(lunchStartTime, currentDayDate);
      const newDayLunchEnd = timeToDate(lunchEndTime, currentDayDate);
      if (
        potentialSessionStartTime < newDayLunchEnd &&
        new Date(
          potentialSessionStartTime.getTime() + sessionTotalDuration * 60000,
        ) > newDayLunchStart
      ) {
        potentialSessionStartTime = new Date(newDayLunchEnd);
      }
    }
    currentTime = new Date(potentialSessionStartTime);
    for (let i = 0; i < stations.length; i++) {
      const rotationStartTime = new Date(currentTime);
      const rotationEndTime = new Date(
        rotationStartTime.getTime() + rotationDuration * 60000,
      );
      for (let j = 0; j < stations.length; j++) {
        const pesertaIndex = (i + j) % sessionPeserta.length;
        const p = sessionPeserta[pesertaIndex];
        const s = stations[j];
        if (p && s) {
          fullSchedule.push({
            date: new Date(currentDayDate),
            sesi: sesi,
            rotasi: i + 1,
            waktuMulai: formatTime(rotationStartTime),
            waktuSelesai: formatTime(rotationEndTime),
            station: s,
            peserta: p,
          });
        }
      }
      currentTime = rotationEndTime;
    }
    const isLastSession = sessionIndex === sortedSessionKeys.length - 1;
    if (!isLastSession)
      currentTime.setMinutes(currentTime.getMinutes() + breakDuration);
  });
  return fullSchedule;
}
function printSchedule() {
  const fullSchedule = calculateFullSchedule();
  const {
    stations,
    rotationDuration,
    breakDuration,
    lunchStartTime,
    lunchEndTime,
  } = getScheduleParameters();
  const penguji = getFromStorage("penguji");
  const settings = getFromStorage("osce_cert_settings") || {};
  const institutionName =
    settings.institutionName || "D3 KEPERAWATAN WAIKABUBAK";
  if (fullSchedule.length === 0)
    return alert(
      "Jadwal belum digenerate atau tidak ada data yang valid. Silakan generate jadwal terlebih dahulu.",
    );
  const scheduleByDateAndSession = fullSchedule.reduce((acc, item) => {
    const dateKey = `${item.date.getFullYear()}-${String(item.date.getMonth() + 1).padStart(2, "0")}-${String(item.date.getDate()).padStart(2, "0")}`;
    if (!acc[dateKey]) acc[dateKey] = {};
    if (!acc[dateKey][item.sesi]) acc[dateKey][item.sesi] = [];
    acc[dateKey][item.sesi].push(item);
    return acc;
  }, {});
  let printContent = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Jadwal Rotasi Ujian OSCE</title><style>body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;line-height:1.4;font-size:10pt;}@page{size:A4 landscape;margin:1.5cm;}.header{text-align:center;margin-bottom:1em;}h1{font-size:20px;margin-bottom:0.2em;}h2{font-size:16px;margin-bottom:0.5em;font-weight:normal;}h3{font-size:14px;margin-top:1.5em;background-color:#e9ecef;padding:8px;border-radius:5px;text-align:left;}.day-header{font-size:18px;text-align:center;border-bottom:2px solid #333;padding-bottom:5px;margin:2em 0 1em 0;page-break-before:always;}.day-header:first-of-type{page-break-before:auto;}table{width:100%;border-collapse:collapse;margin-top:1em;}th,td{border:1px solid #ccc;padding:6px;text-align:center;vertical-align:middle;}th{background-color:#f2f2f2;font-weight:bold;}.session-block{margin-bottom:2em;page-break-inside:avoid;}.penguji-info{font-size:0.8em;color:#555;display:block;font-weight:normal;}.peserta-info{font-size:0.9em;}.peserta-info small{color:#666;}</style></head><body><div class="header"><h1>JADWAL ROTASI UJIAN OSCE</h1><h2>${institutionName.toUpperCase()}</h2><p style="font-size:12px;margin-top:0;">Durasi Rotasi:<b>${rotationDuration} menit</b> | Jeda Sesi:<b>${breakDuration} menit</b> | Istirahat Panjang (ISHOMA):<b>${lunchStartTime} - ${lunchEndTime}</b></p></div><hr>`;
  Object.keys(scheduleByDateAndSession)
    .sort()
    .forEach((dateKey) => {
      const date = new Date(dateKey + "T00:00:00");
      const formattedDate = date.toLocaleDateString("id-ID", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      printContent += `<h2 class="day-header">JADWAL UNTUK: ${formattedDate.toUpperCase()}</h2>`;
      const daySchedule = scheduleByDateAndSession[dateKey];
      Object.keys(daySchedule)
        .sort((a, b) => a - b)
        .forEach((sesi) => {
          const sessionSchedule = daySchedule[sesi];
          const rotations = sessionSchedule.reduce((acc, item) => {
            if (!acc[item.rotasi])
              acc[item.rotasi] = {
                waktu: `${item.waktuMulai} - ${item.waktuSelesai}`,
                pesertaPerStation: {},
              };
            acc[item.rotasi].pesertaPerStation[item.station.id] = item.peserta;
            return acc;
          }, {});
          printContent += `<div class="session-block"><h3>SESI ${sesi}</h3><table><thead><tr><th>Waktu</th><th>Rotasi</th>`;
          stations.forEach((station) => {
            const assignedPenguji = penguji.find(
              (p) => p.assignedStationId === station.id,
            );
            printContent += `<th>${station.name}<span class="penguji-info">(${assignedPenguji ? assignedPenguji.nama : "N/A"})</span></th>`;
          });
          printContent += `</tr></thead><tbody>`;
          Object.keys(rotations)
            .sort((a, b) => a - b)
            .forEach((rotasi) => {
              const rotationData = rotations[rotasi];
              printContent += `<tr><td><b>${rotationData.waktu}</b></td><td><b>${rotasi}</b></td>`;
              stations.forEach((station) => {
                const p = rotationData.pesertaPerStation[station.id];
                printContent += `<td><span class="peserta-info">${p ? p.nama : ""}<br><small>(${p ? p.nim : ""})</small></span></td>`;
              });
              printContent += `</tr>`;
            });
          printContent += `</tbody></table></div>`;
        });
    });
  printContent += `</body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}
function exportScheduleToCSV() {
  const fullSchedule = calculateFullSchedule();
  if (fullSchedule.length === 0)
    return alert(
      "Jadwal belum digenerate atau tidak ada data yang valid. Silakan generate jadwal terlebih dahulu.",
    );
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent +=
    "Tanggal,Sesi,Rotasi,Waktu Mulai,Waktu Selesai,ID Stasiun,Nama Stasiun,NIM Peserta,Nama Peserta\n";
  fullSchedule.forEach((item) => {
    const row = [
      item.date.toISOString().slice(0, 10),
      item.sesi,
      item.rotasi,
      item.waktuMulai,
      item.waktuSelesai,
      item.station.id,
      `"${item.station.name}"`,
      item.peserta.nim,
      `"${item.peserta.nama}"`,
    ].join(",");
    csvContent += row + "\n";
  });
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute(
    "download",
    `jadwal_osce_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// =================================================================
// CRUD: PENGUJI & CREDENTIALS
// =================================================================
async function addPenguji(e) {
  e.preventDefault();
  const idPenguji = document.getElementById("penguji-id").value.trim();
  const nama = document.getElementById("penguji-nama").value.trim();
  const assignedStationId = document.getElementById("penguji-station").value;
  if (!idPenguji || !nama || !assignedStationId)
    return alert("ID, Nama Penguji, dan Station tidak boleh kosong.");
  let penguji = getFromStorage("penguji");
  if (penguji.some((p) => p.idPenguji === idPenguji))
    return alert("Penguji dengan ID ini sudah terdaftar.");
  const newPenguji = {
    id: Date.now(),
    idPenguji: idPenguji,
    nama: nama,
    assignedStationId: parseInt(assignedStationId),
  };
  penguji.push(newPenguji);
  saveToStorage("penguji", penguji);
  // Realtime Sync
  syncAction("penguji", newPenguji);
  syncAction("credentials", {
    username: idPenguji,
    password: idPenguji,
    role: "penguji",
  });
  logActivity(
    "CREATE_PENGUJI",
    `ID Penguji: ${idPenguji}, Nama: ${nama} (Otomatis)`,
  );
  document.getElementById("form-add-penguji").reset();
  loadPenguji();
}

async function deleteAllPenguji() {
  if (
    !confirm(
      "Peringatan: Anda akan menghapus SELURUH data penguji dan kredensial login mereka. Tindakan ini tidak dapat diurungkan.",
    )
  )
    return;
  if (!confirm("KONFIRMASI TERAKHIR: Hapus semua data penguji sekarang?"))
    return;

  try {
    // 1. Delete all from Supabase
    const { error: pError } = await supabaseClient
      .from("penguji")
      .delete()
      .not("id", "is", null);
    if (pError) throw pError;

    // 2. Delete credentials for penguji
    const { error: cError } = await supabaseClient
      .from("credentials")
      .delete()
      .eq("role", "penguji");
    if (cError) throw cError;

    // 3. Update Local Storage
    saveToStorage("penguji", []);

    // 4. Update UI
    loadPenguji();
    logActivity(
      "DELETE_ALL_PENGUJI",
      "Seluruh data penguji dihapus secara permanen.",
    );
    alert("Seluruh data penguji berhasil dihapus.");
  } catch (e) {
    console.error("Gagal menghapus semua penguji:", e.message);
    alert("Gagal menghapus data: " + e.message);
  }
}
function loadPenguji() {
  const penguji = getFromStorage("penguji");
  const stations = getFromStorage("stations");
  const tableBody = document.getElementById("table-penguji-body");
  const stationSelect = document.getElementById("penguji-station");
  stationSelect.innerHTML =
    '<option value="" selected disabled>-- Pilih Station --</option>';
  stations.forEach((s) => {
    stationSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
  });
  tableBody.innerHTML =
    penguji
      .map((p) => {
        const assignedStation = stations.find(
          (s) => s.id === p.assignedStationId,
        );
        const stationName = assignedStation
          ? assignedStation.name
          : '<span class="text-danger fw-bold">Tidak Ditemukan</span>';
        return `<tr><td>${p.idPenguji}</td><td>${p.nama}</td><td>${stationName}</td><td class="text-center"><button class="btn btn-sm btn-secondary me-2" onclick="openEditCredentialsModal(${p.id})" title="Ubah Username/Password"><i class="fas fa-key"></i></button><button class="btn btn-sm btn-warning me-2" onclick="openEditPengujiModal(${p.id})" title="Edit Detail"><i class="fas fa-edit"></i></button><button class="btn btn-sm btn-danger" onclick="deleteItem('penguji', ${p.id}, loadPenguji)" title="Hapus"><i class="fas fa-trash-alt"></i></button></td></tr>`;
      })
      .join("") ||
    `<tr><td colspan="4" class="text-center text-muted">Belum ada data penguji.</td></tr>`;
}
function openEditPengujiModal(id) {
  const penguji = getFromStorage("penguji").find((p) => p.id === id);
  const stations = getFromStorage("stations");
  if (penguji) {
    document.getElementById("edit-penguji-id").value = penguji.id;
    document.getElementById("edit-penguji-idPenguji").value = penguji.idPenguji;
    document.getElementById("edit-penguji-nama").value = penguji.nama;
    const stationSelect = document.getElementById("edit-penguji-station");
    stationSelect.innerHTML = '<option value="">-- Tidak Ada --</option>';
    stations.forEach((s) => {
      stationSelect.innerHTML += `<option value="${s.id}">${s.name}</option>`;
    });
    stationSelect.value = penguji.assignedStationId || "";
    editPengujiModal.show();
  }
}
async function savePengujiChanges() {
  const id = parseInt(document.getElementById("edit-penguji-id").value);
  const nama = document.getElementById("edit-penguji-nama").value.trim();
  const assignedStationId = document.getElementById(
    "edit-penguji-station",
  ).value;
  if (!nama) return alert("Nama Lengkap tidak boleh kosong.");
  let pengujiList = getFromStorage("penguji");
  const index = pengujiList.findIndex((p) => p.id === id);
  if (index > -1) {
    pengujiList[index].nama = nama;
    pengujiList[index].assignedStationId = assignedStationId
      ? parseInt(assignedStationId)
      : null;
    saveToStorage("penguji", pengujiList);
    // Realtime Sync
    syncAction("penguji", pengujiList[index]);
    logActivity("UPDATE_PENGUJI", `ID: ${id}, Nama: ${nama} (Otomatis)`);
    loadPenguji();
    editPengujiModal.hide();
  }
}
function openEditCredentialsModal(id) {
  const penguji = getFromStorage("penguji").find((p) => p.id === id);
  if (penguji) {
    document.getElementById("form-edit-credentials").reset();
    document.getElementById("edit-credentials-penguji-id").value = penguji.id;
    document.getElementById("edit-credentials-nama").value = penguji.nama;
    document.getElementById("edit-credentials-old-username").value =
      penguji.idPenguji;
    editCredentialsModal.show();
  }
}
async function saveCredentialsChanges() {
  const pengujiId = parseInt(
    document.getElementById("edit-credentials-penguji-id").value,
  );
  const oldUsername = document.getElementById(
    "edit-credentials-old-username",
  ).value;
  const newUsername = document
    .getElementById("edit-credentials-new-username")
    .value.trim();
  const newPassword = document.getElementById(
    "edit-credentials-new-password",
  ).value;
  const confirmPassword = document.getElementById(
    "edit-credentials-confirm-password",
  ).value;
  const saveButton = document.querySelector(
    "#editCredentialsModal .btn-primary",
  );
  if (!newUsername && !newPassword)
    return alert(
      "Tidak ada perubahan yang dimasukkan. Harap isi Username Baru atau Password Baru.",
    );
  if (newPassword && newPassword !== confirmPassword)
    return alert("Password Baru dan Konfirmasi Password tidak cocok.");
  const finalUsername = newUsername || oldUsername;
  if (finalUsername !== oldUsername) {
    const allPenguji = getFromStorage("penguji");
    if (
      allPenguji.some(
        (p) => p.idPenguji === finalUsername && p.id !== pengujiId,
      )
    )
      return alert(
        "Username baru sudah digunakan oleh penguji lain. Silakan pilih username lain.",
      );
  }
  if (
    !confirm(
      `Anda akan mengubah kredensial untuk ${oldUsername}. Ini akan mengubah data di Supabase. Lanjutkan?`,
    )
  )
    return;
  saveButton.disabled = true;
  saveButton.innerHTML =
    '<span class="spinner-border spinner-border-sm"></span> Menyimpan...';
  try {
    // Update credentials table in Supabase
    const updates = {};
    if (newUsername) updates.username = newUsername;
    if (newPassword) updates.password = newPassword;
    const { error } = await supabaseClient
      .from("credentials")
      .update(updates)
      .eq("username", oldUsername);
    if (error) throw error;

    // Update penguji table if username changed
    if (newUsername && newUsername !== oldUsername) {
      const { error: pengujiError } = await supabaseClient
        .from("penguji")
        .update({ idPenguji: newUsername })
        .eq("id", pengujiId);
      if (pengujiError) throw pengujiError;
    }

    // Update local data
    let pengujiList = getFromStorage("penguji");
    const index = pengujiList.findIndex((p) => p.id === pengujiId);
    if (index > -1) {
      if (newUsername) pengujiList[index].idPenguji = newUsername;
      saveToStorage("penguji", pengujiList);
    }
    const finalUsernameToUpdate = newUsername || oldUsername;
    if (USER_CREDENTIALS[oldUsername]) {
      const oldPasswordValue = USER_CREDENTIALS[oldUsername];
      delete USER_CREDENTIALS[oldUsername];
      USER_CREDENTIALS[finalUsernameToUpdate] = newPassword || oldPasswordValue;
    }
    logActivity(
      "UPDATE_CREDENTIALS",
      `Old Username: ${oldUsername}, New Username: ${finalUsernameToUpdate}`,
    );
    alert("Kredensial penguji telah berhasil diperbarui.");
    editCredentialsModal.hide();
    loadPenguji();
  } catch (error) {
    alert(`Gagal memperbarui kredensial: ${error.message}`);
  } finally {
    saveButton.disabled = false;
    saveButton.innerHTML = "Simpan Perubahan";
  }
}

// =================================================================
// CRUD: STATION & RUBRIC PRINTING
// =================================================================
function openStationModal(id = null) {
  const form = document.getElementById("form-station");
  form.reset();
  document.getElementById("station-id").value = "";
  document.getElementById("rubric-inputs-container").innerHTML = "";
  const modalLabel = document.getElementById("stationModalLabel");
  if (id) {
    const station = getFromStorage("stations").find((s) => s.id === id);
    if (station) {
      modalLabel.innerHTML = '<i class="fas fa-edit"></i> Edit Station';
      document.getElementById("station-id").value = station.id;
      document.getElementById("station-name").value = station.name;
      document.getElementById("station-time").value = station.maxTime || "";
      document.getElementById("station-passing-grade").value =
        station.passingGrade || "";
      document.getElementById("station-soal").value = station.soal || "";
      station.rubric.forEach((r) =>
        addRubricInput(r.criteria, r.maxScore, r.bobot),
      );
    }
  } else {
    modalLabel.innerHTML =
      '<i class="fas fa-plus-circle"></i> Tambah Station Baru';
    addRubricInput();
  }
  stationModal.show();
}
function addRubricInput(criteria = "", maxScore = "", bobot = "1") {
  const container = document.getElementById("rubric-inputs-container");
  const div = document.createElement("div");
  div.className = "input-group mb-2";
  div.innerHTML = `<input type="text" class="form-control form-control-sm" placeholder="Kriteria Penilaian" value="${criteria}" required>
                     <input type="number" class="form-control form-control-sm" placeholder="Skor Max" style="max-width:100px;" value="${maxScore}" required min="1">
                     <input type="number" class="form-control form-control-sm" placeholder="Bobot" style="max-width:100px;" value="${bobot || 1}" required min="1">
                     <button class="btn btn-outline-danger btn-sm" type="button" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
  container.appendChild(div);
}
async function saveStation() {
  const stationId = document.getElementById("station-id").value;
  const stationName = document.getElementById("station-name").value.trim();
  const maxTime = parseInt(document.getElementById("station-time").value) || 0;
  const passingGrade =
    parseInt(document.getElementById("station-passing-grade").value) || 75;
  const stationSoal = document.getElementById("station-soal").value.trim();
  if (!stationName) return alert("Nama station tidak boleh kosong.");
  const rubricInputs = document.querySelectorAll(
    "#rubric-inputs-container .input-group",
  );
  if (rubricInputs.length === 0)
    return alert("Station harus memiliki minimal satu kriteria.");
  const newRubric = [];
  let isValid = true;
  rubricInputs.forEach((inputGroup, index) => {
    const criteria = inputGroup.children[0].value.trim();
    const maxScore = parseInt(inputGroup.children[1].value);
    const bobot = parseInt(inputGroup.children[2].value);
    if (criteria && maxScore > 0 && bobot > 0) {
      newRubric.push({
        id: index + 1,
        criteria: criteria,
        maxScore: maxScore,
        bobot: bobot,
      });
    } else {
      isValid = false;
    }
  });
  if (!isValid)
    return alert(
      "Pastikan semua kriteria terisi dengan benar (Kriteria tidak kosong, Skor Max > 0, Bobot > 0).",
    );
  let stations = getFromStorage("stations");
  const newStationData = {
    name: stationName,
    maxTime,
    passingGrade,
    soal: stationSoal,
    rubric: newRubric,
  };
  const isUpdate = !!stationId;
  let finalStation;
  if (isUpdate) {
    const index = stations.findIndex((s) => s.id == stationId);
    if (index > -1) {
      stations[index] = { ...stations[index], ...newStationData };
      finalStation = stations[index];
    }
  } else {
    finalStation = { id: Date.now(), ...newStationData };
    stations.push(finalStation);
  }
  saveToStorage("stations", stations);
  if (finalStation) syncAction("stations", finalStation);
  logActivity(
    isUpdate ? "UPDATE_STATION" : "CREATE_STATION",
    `Nama: ${stationName} (Otomatis)`,
  );
  loadStations();
  stationModal.hide();
}
function loadStations() {
  const stations = getFromStorage("stations");
  const container = document.getElementById("station-list-container");
  if (stations.length > 0) {
    container.innerHTML = stations
      .map(
        (s) =>
          `<div class="card mb-3"><div class="card-header bg-light d-flex justify-content-between align-items-center flex-wrap gap-2"><span class="fw-bold">${s.name}</span><div class="d-flex align-items-center gap-2">${s.maxTime > 0 ? `<span class="badge bg-primary"><i class="fas fa-clock"></i> ${s.maxTime} menit</span>` : ""} <span class="badge bg-success"><i class="fas fa-check"></i> Lulus: ${s.passingGrade || 75}%</span> <button class="btn btn-sm btn-info" onclick="printRubric(${s.id})"><i class="fas fa-print"></i> Cetak Rubrik</button> <button class="btn btn-sm btn-warning" onclick="openStationModal(${s.id})"><i class="fas fa-edit"></i> Edit</button><button class="btn btn-sm btn-danger" onclick="deleteItem('stations', ${s.id}, loadStations)"><i class="fas fa-trash-alt"></i> Hapus</button></div></div><ul class="list-group list-group-flush">${s.rubric.map((r) => `<li class="list-group-item d-flex justify-content-between"><span>${r.criteria}</span> <div><span class="badge bg-secondary rounded-pill me-2">Maks: ${r.maxScore}</span><span class="badge bg-info rounded-pill">Bobot: ${r.bobot || 1}</span></div></li>`).join("")}</ul></div>`,
      )
      .join("");
  } else {
    container.innerHTML =
      '<div class="text-center p-5"><p class="text-muted">Belum ada station yang ditambahkan.</p></div>';
  }
}
function printRubric(stationId) {
  const station = getFromStorage("stations").find((s) => s.id === stationId);
  if (!station) return;
  const settings = getFromStorage("osce_cert_settings") || {};
  const institutionName =
    settings.institutionName || "PROGRAM STUDI D3 KEPERAWATAN WAIKABUBAK";
  let printContent = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Rubrik Penilaian - ${station.name}</title><style>body{font-family:'Segoe UI',sans-serif;font-size:11pt;margin:2cm;}h1,h2{text-align:center;}h1{font-size:18pt;}h2{font-size:14pt;font-weight:normal;margin-bottom:2em;}.soal-container{border:1px solid #ddd;padding:1em;margin-bottom:2em;background-color:#f9f9f9;white-space:pre-wrap;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background-color:#f2f2f2;}.score-column{text-align:center;width:100px;}.check-column{text-align:center;width:80px;}@media print{body{margin:1.5cm;}}</style></head><body><h1>FORMULIR PENILAIAN UJIAN OSCE</h1><h2>STATION: ${station.name}<br>${institutionName.toUpperCase()}</h2>`;
  if (station.soal)
    printContent += `<h3>Skenario / Soal</h3><div class="soal-container">${station.soal}</div>`;
  printContent += `<h3>Rubrik Penilaian</h3><table><thead><tr><th>No.</th><th>Kriteria Penilaian</th><th class="score-column">Bobot</th><th class="score-column">Skor Maksimal</th><th class="check-column">Skor</th></tr></thead><tbody>`;
  station.rubric.forEach((r, index) => {
    printContent += `<tr><td style="text-align:center;">${index + 1}</td><td>${r.criteria}</td><td class="score-column">${r.bobot || 1}</td><td class="score-column">${r.maxScore}</td><td class="check-column"></td></tr>`;
  });
  printContent += `</tbody></table><div style="margin-top:2em;"><h4>Komentar / Feedback:</h4><div style="border:1px solid #ccc;height:150px;padding:5px;"></div></div><div style="margin-top:3em;display:flex;justify-content:space-between;"><div><p>Nama Peserta: .........................</p><p>NIM: .....................................</p></div><div><p>Nama Penguji: .........................</p><p>Tanda Tangan: .......................</p></div></div></body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

// =================================================================
// DASHBOARD & CHARTS
// =================================================================
function updateDashboard() {
  const peserta = getFromStorage("peserta");
  const penguji = getFromStorage("penguji");
  const stations = getFromStorage("stations");
  const scores = getFromStorage("scores");
  const REQUIRED_STATIONS_FOR_COMPLETION = 9;
  document.getElementById("total-peserta").innerText = peserta.length;
  document.getElementById("total-penguji").innerText = penguji.length;
  document.getElementById("total-station").innerText = stations.length;
  const progressMap = new Map();
  scores.forEach((score) => {
    const participantId = score.pesertaId;
    if (!progressMap.has(participantId))
      progressMap.set(participantId, new Set());
    progressMap.get(participantId).add(score.stationId);
  });
  let selesaiCount = 0,
    sedangCount = 0,
    belumCount = peserta.length;
  peserta.forEach((p) => {
    const completedStationsSet = progressMap.get(p.id);
    const stationCount = completedStationsSet ? completedStationsSet.size : 0;
    if (stationCount >= REQUIRED_STATIONS_FOR_COMPLETION) selesaiCount++;
    else if (stationCount > 0) sedangCount++;
  });
  belumCount = peserta.length - selesaiCount - sedangCount;
  document.getElementById("peserta-selesai").innerText = selesaiCount;
  document.getElementById("peserta-sedang").innerText = sedangCount;
  document.getElementById("peserta-belum").innerText = belumCount;
  updateStatusUjianChart(selesaiCount, sedangCount, belumCount);
  updatePenilaianPerStationChart(stations, scores);
}
function updateLiveMonitor() {
  const container = document.getElementById("live-monitor-stations");
  const fullSchedule = calculateFullSchedule();
  const allScores = getFromStorage("scores");
  const allPenguji = getFromStorage("penguji");

  if (fullSchedule.length === 0) {
    container.innerHTML = `<div class="col-12 text-center text-muted p-5"><i class="fas fa-calendar-times fa-3x mb-3"></i><p>Jadwal ujian belum dibuat. Silakan generate jadwal terlebih dahulu.</p></div>`;
    return;
  }

  let currentRotation = null;
  const now = new Date();

  // 1. SYNC WITH TIMER: If Global Timer is active, use its managed rotation
  if (dashboardActiveRotation) {
    currentRotation = fullSchedule.find(
      (item) =>
        item.date.toISOString().slice(0, 10) ===
          dashboardActiveRotation.dateStr &&
        item.sesi === dashboardActiveRotation.sesi &&
        item.rotasi === dashboardActiveRotation.rotasi,
    );
  }

  // 2. FALLBACK TO WALL CLOCK: If no active rotation from timer, use real time
  if (!currentRotation) {
    currentRotation = fullSchedule.find((item) => {
      const startTime = timeToDate(item.waktuMulai, item.date);
      const endTime = timeToDate(item.waktuSelesai, item.date);
      return now >= startTime && now < endTime;
    });
    if (!currentRotation) {
      currentRotation = fullSchedule.find(
        (item) => timeToDate(item.waktuMulai, item.date) > now,
      );
    }
  }

  if (!currentRotation) {
    container.innerHTML = `<div class="col-12 text-center text-muted p-5"><i class="fas fa-coffee fa-3x mb-3"></i><p>Ujian telah selesai untuk hari ini atau tidak ada jadwal mendatang.</p></div>`;
    return;
  }

  const currentRotationItems = fullSchedule.filter(
    (item) =>
      item.date.toISOString().slice(0, 10) ===
        currentRotation.date.toISOString().slice(0, 10) &&
      item.rotasi === currentRotation.rotasi &&
      item.sesi === currentRotation.sesi,
  );
  container.innerHTML = "";
  currentRotationItems
    .sort((a, b) => a.station.name.localeCompare(b.station.name))
    .forEach((item) => {
      const { station, peserta } = item;
      const penguji = allPenguji.find(
        (p) => p.assignedStationId === station.id,
      );
      const startTime = timeToDate(item.waktuMulai, item.date);
      const endTime = timeToDate(item.waktuSelesai, item.date);
      let status,
        statusClass,
        countdownHtml = "";
      const scoreExists = allScores.some(
        (s) => s.pesertaId === peserta.id && s.stationId === station.id,
      );
      if (scoreExists) {
        status = "Selesai Dinilai";
        statusClass = "bg-success";
      } else if (now >= startTime && now < endTime) {
        status = "Berlangsung";
        statusClass = "bg-primary text-white";
        // Use Master Global Timer for countdown if available
        let countdownText = "";
        if (dashboardTimerState === "running" && dashboardTimerEndTime) {
          const masterRemainingMs = Math.max(
            0,
            dashboardTimerEndTime - now.getTime(),
          );
          const mins = Math.floor(masterRemainingMs / (1000 * 60));
          const secs = Math.floor((masterRemainingMs / 1000) % 60);
          countdownText = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        } else {
          const remainingSeconds = Math.round((endTime - now) / 1000);
          const mins = Math.floor(remainingSeconds / 60);
          const secs = remainingSeconds % 60;
          countdownText = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        }
        countdownHtml = `<div class="countdown text-primary">${countdownText}</div>`;
      } else if (now >= endTime) {
        status = "Waktu Habis";
        statusClass = "bg-danger";
      } else {
        status = `Menunggu (${item.waktuMulai})`;
        statusClass = "bg-secondary";
      }
      const cardHtml = `<div class="col-xl-3 col-lg-4 col-md-6"><div class="card live-monitor-card h-100 shadow-sm"><div class="card-header fw-bold d-flex justify-content-between"><span><i class="fas fa-sitemap me-2"></i>${station.name}</span><span class="badge ${statusClass}">${status}</span></div><div class="card-body">${countdownHtml}<p class="mb-1"><i class="fas fa-user-graduate fa-fw me-2 text-muted"></i><strong>${peserta.nama}</strong></p><p class="text-muted small mb-2"><i class="far fa-id-card fa-fw me-2"></i>${peserta.nim}</p><p class="mb-0"><i class="fas fa-user-tie fa-fw me-2 text-muted"></i>${penguji ? penguji.nama : "<i>Penguji belum ditugaskan</i>"}</p></div></div></div>`;
      container.innerHTML += cardHtml;
    });
}
function updateStatusUjianChart(selesai, sedang, belum) {
  const ctx = document.getElementById("statusUjianChart").getContext("2d");
  if (statusUjianChartInstance) statusUjianChartInstance.destroy();
  statusUjianChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Selesai (>=9 Station)", "Sedang", "Belum"],
      datasets: [
        {
          data: [selesai, sedang, belum],
          backgroundColor: [
            "rgba(25, 135, 84, 0.8)",
            "rgba(255, 193, 7, 0.8)",
            "rgba(220, 53, 69, 0.8)",
          ],
          borderColor: ["#198754", "#ffc107", "#dc3545"],
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
    },
  });
}
function updatePenilaianPerStationChart(stations, scores) {
  const ctx = document
    .getElementById("penilaianPerStationChart")
    .getContext("2d");
  const scoreCounts = scores.reduce((acc, score) => {
    acc[score.stationId] = (acc[score.stationId] || 0) + 1;
    return acc;
  }, {});
  const labels = stations.map((s) => s.name);
  const data = stations.map((s) => scoreCounts[s.id] || 0);
  if (penilaianPerStationChartInstance)
    penilaianPerStationChartInstance.destroy();
  penilaianPerStationChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Jml Penilaian",
          data: data,
          backgroundColor: "rgba(13, 110, 253, 0.6)",
          borderColor: "rgba(13, 110, 253, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } },
      plugins: { legend: { display: false } },
    },
  });
}

// =================================================================
// PENILAIAN (REVISED FOR SMART ASSESSMENT)
// =================================================================
function updatePesertaDropdown(searchTerm = "") {
  const term = searchTerm.toLowerCase();
  const selectPeserta = document.getElementById("select-peserta");
  const allPeserta = getFromStorage("peserta");
  const currentlySelected = selectPeserta.value;
  const sourcePeserta = allPeserta;
  const filteredPeserta = sourcePeserta.filter((p) =>
    term
      ? p.nama.toLowerCase().includes(term) ||
        p.nim.toLowerCase().includes(term)
      : true,
  );
  if (filteredPeserta.length > 0) {
    selectPeserta.innerHTML = '<option value="">-- Pilih Peserta --</option>';
    filteredPeserta
      .sort((a, b) => a.nama.localeCompare(b.nama))
      .forEach((p) => {
        const option = document.createElement("option");
        option.value = p.id;
        const sesiInfo = p.sesi ? ` (Sesi ${p.sesi})` : "";
        option.textContent = `${p.nama} (${p.nim})${sesiInfo}`;
        selectPeserta.appendChild(option);
      });
  } else {
    selectPeserta.innerHTML = `<option value="">Tidak ada peserta yang ditemukan.</option>`;
  }
  if (filteredPeserta.some((p) => p.id == currentlySelected)) {
    selectPeserta.value = currentlySelected;
  }
}
function findCurrentScheduleForPenguji(pengujiId) {
  const penguji = getFromStorage("penguji").find((p) => p.id === pengujiId);
  if (!penguji || !penguji.assignedStationId) return null;
  const fullSchedule = calculateFullSchedule();
  const now = new Date();
  const currentScheduleEntry = fullSchedule.find((item) => {
    const startTime = timeToDate(item.waktuMulai, item.date);
    const endTime = timeToDate(item.waktuSelesai, item.date);
    return (
      item.station.id === penguji.assignedStationId &&
      now >= startTime &&
      now < endTime
    );
  });
  return currentScheduleEntry || null;
}
function populatePenilaianDropdowns() {
  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  const selectPenguji = document.getElementById("select-penguji");
  const selectStation = document.getElementById("select-station");
  const autoParticipantContainer = document.getElementById(
    "auto-participant-info",
  );
  const manualSelectionContainer = document.getElementById(
    "manual-peserta-selection",
  );
  autoParticipantContainer.innerHTML = "";
  autoParticipantContainer.classList.add("d-none");
  const stations = getFromStorage("stations");
  selectStation.innerHTML = `<option value="">-- Pilih Station --</option>`;
  stations.forEach(
    (item) =>
      (selectStation.innerHTML += `<option value="${item.id}">${item.name}</option>`),
  );
  const allPenguji = getFromStorage("penguji");
  selectPenguji.innerHTML = `<option value="">-- Pilih Penguji --</option>`;
  allPenguji.forEach(
    (item) =>
      (selectPenguji.innerHTML += `<option value="${item.id}">${item.nama}</option>`),
  );
  document.getElementById("search-peserta").value = "";
  updatePesertaDropdown();
  if (user.role === "penguji") {
    selectPenguji.value = user.id;
    selectPenguji.disabled = true;
    selectStation.value = user.assignedStationId || "";
    selectStation.disabled = true;
    manualSelectionContainer.classList.add("d-none");
    const currentSchedule = findCurrentScheduleForPenguji(user.id);
    if (currentSchedule && currentSchedule.peserta) {
      const p = currentSchedule.peserta;
      autoParticipantContainer.innerHTML = `<div class="alert alert-success"><h5 class="alert-heading"><i class="fas fa-user-clock me-2"></i>Peserta Sesuai Jadwal</h5><p class="mb-1"><strong>Nama:</strong> ${p.nama}</p><p class="mb-0"><strong>NIM:</strong> ${p.nim}</p><hr><button class="btn btn-sm btn-outline-secondary" onclick="showManualSelection()">Nilai Peserta Lain (Manual)</button></div>`;
      autoParticipantContainer.classList.remove("d-none");
      document.getElementById("select-peserta").value = p.id;
    } else {
      autoParticipantContainer.innerHTML = `<div class="alert alert-warning"><i class="fas fa-info-circle me-2"></i>Saat ini tidak ada peserta yang dijadwalkan di stasiun Anda. Silakan pilih peserta secara manual di bawah ini.</div>`;
      autoParticipantContainer.classList.remove("d-none");
      manualSelectionContainer.classList.remove("d-none");
    }
  } else {
    selectPenguji.disabled = false;
    selectStation.disabled = false;
    manualSelectionContainer.classList.remove("d-none");
  }
  displayRubricPreview();
  generateRubricForm();
}
function showManualSelection() {
  document
    .getElementById("manual-peserta-selection")
    .classList.remove("d-none");
  document.getElementById("auto-participant-info").classList.add("d-none");
}
function displayRubricPreview() {
  const stationId = document.getElementById("select-station").value;
  const soalContainer = document.getElementById("station-soal-display");
  const previewContainer = document.getElementById("rubric-preview-container");
  soalContainer.innerHTML = "";
  previewContainer.innerHTML = "";
  if (!stationId) return;
  const station = getFromStorage("stations").find((s) => s.id == stationId);
  if (!station) return;
  if (station.soal) {
    soalContainer.innerHTML = `<div class="card border-primary mb-3"><div class="card-header bg-primary text-white"><i class="fas fa-file-alt me-2"></i> <strong>Soal / Skenario untuk Station: ${station.name}</strong></div><div class="card-body" style="white-space: pre-wrap; background-color: #f8f9fa; max-height: 250px; overflow-y: auto;">${station.soal}</div></div>`;
  }
  const rubricList = station.rubric
    .map(
      (r, index) =>
        `<li class="list-group-item d-flex justify-content-between align-items-center"><span>${index + 1}. ${r.criteria}</span><div><span class="badge bg-secondary rounded-pill me-2">Skor Maks: ${r.maxScore}</span><span class="badge bg-info rounded-pill">Bobot: ${r.bobot || 1}</span></div></li>`,
    )
    .join("");
  previewContainer.innerHTML = `<div class="accordion" id="rubricPreviewAccordion"><div class="accordion-item"><h2 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapseRubricPreview"><i class="fas fa-tasks me-2"></i> Tampilkan/Sembunyikan Rubrik Penilaian</button></h2><div id="collapseRubricPreview" class="accordion-collapse collapse" data-bs-parent="#rubricPreviewAccordion"><div class="accordion-body p-0"><ul class="list-group list-group-flush">${rubricList}</ul><div class="card-footer text-end"><button class="btn btn-sm btn-outline-primary" onclick="printRubric(${station.id})"><i class="fas fa-print"></i> Cetak Formulir Rubrik</button></div></div></div></div></div>`;
}
function generateRubricForm() {
  const pengujiId = document.getElementById("select-penguji").value;
  const pesertaId = document.getElementById("select-peserta").value;
  const stationId = document.getElementById("select-station").value;
  const formContainer = document.getElementById("form-penilaian-rubrik");
  const timerContainer = document.getElementById("timer-container");
  const scheduleInfoContainer = document.getElementById("schedule-time-info");
  if (stationTimer) clearInterval(stationTimer);
  timerContainer.classList.add("d-none");
  scheduleInfoContainer.classList.add("d-none");
  if (!pengujiId || !pesertaId || !stationId) {
    formContainer.innerHTML =
      '<div class="text-center text-muted p-5"><i class="fas fa-mouse-pointer fa-3x mb-3"></i><p>Pilih Penguji, Peserta, dan Station untuk memulai.</p></div>';
    return;
  }
  const station = getFromStorage("stations").find((s) => s.id == stationId);
  if (!station) return;
  if (station.maxTime && station.maxTime > 0) startTimer(station.maxTime);
  const scheduledTime = getParticipantScheduleInfo(
    parseInt(pesertaId),
    parseInt(stationId),
  );
  if (scheduledTime) {
    const formattedDate = scheduledTime.date.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    scheduleInfoContainer.innerHTML = `<i class="fas fa-calendar-day me-2"></i>Terjadwal pada <b>${formattedDate}</b>, pukul <b>${scheduledTime.startTime} - ${scheduledTime.endTime}</b>.`;
    scheduleInfoContainer.classList.remove("d-none");
  }
  let formHtml = `<form id="form-submit-penilaian">`;
  station.rubric.forEach((r, index) => {
    formHtml += `<div class="rubric-item mb-3"><p class="mb-2"><b>${index + 1}. ${r.criteria}</b> (Maks: ${r.maxScore}, Bobot: ${r.bobot || 1})</p><div class="btn-group" role="group">`;
    for (let i = 0; i <= r.maxScore; i++) {
      formHtml += `<input type="radio" class="btn-check" name="score_${r.id}" id="score_${r.id}_${i}" value="${i}" autocomplete="off" required><label class="btn btn-outline-primary" for="score_${r.id}_${i}">${i}</label>`;
    }
    formHtml += `</div></div>`;
  });
  formHtml += `<hr class="my-4"><div class="card border-info"><div class="card-header bg-info-subtle"><h6 class="mb-0"><i class="fas fa-globe-asia"></i> Global Performance Rating</h6></div><div class="card-body"><p class="card-text"><small>Beri tanda (✓) pada kolom yang disediakan sesuai dengan penilaian Anda secara umum terhadap kemampuan Peserta Ujian.</small></p><div class="btn-group w-100" role="group"><input type="radio" class="btn-check" name="global_performance" id="gp_1" value="1" required><label class="btn btn-outline-danger" for="gp_1">Tidak Lulus (1)</label><input type="radio" class="btn-check" name="global_performance" id="gp_2" value="2" required><label class="btn btn-outline-warning" for="gp_2">Borderline (2)</label><input type="radio" class="btn-check" name="global_performance" id="gp_3" value="3" required><label class="btn btn-outline-success" for="gp_3">Lulus (3)</label><input type="radio" class="btn-check" name="global_performance" id="gp_4" value="4" required><label class="btn btn-outline-primary" for="gp_4">Superior (4)</label></div></div></div>`;
  formHtml += `<div class="mt-4"><label for="komentar" class="form-label fw-bold">Komentar</label><textarea id="komentar" class="form-control" rows="3"></textarea></div><button type="submit" class="btn btn-success mt-4 w-100 fs-5"><i class="fas fa-save"></i> Simpan Penilaian</button></form>`;
  formContainer.innerHTML = formHtml;
  document
    .getElementById("form-submit-penilaian")
    .addEventListener("submit", saveScore);
}
function getParticipantScheduleInfo(pesertaId, stationId) {
  const fullSchedule = calculateFullSchedule();
  const scheduleEntry = fullSchedule.find(
    (item) => item.peserta.id === pesertaId && item.station.id === stationId,
  );
  if (scheduleEntry) {
    return {
      startTime: scheduleEntry.waktuMulai,
      endTime: scheduleEntry.waktuSelesai,
      date: scheduleEntry.date,
    };
  }
  return null;
}
function startTimer(minutes) {
  const timerContainer = document.getElementById("timer-container");
  const timerDisplay = document.getElementById("timer-display");
  const timerProgress = document.getElementById("timer-progress");
  const timerStatus = document.getElementById("timer-status");
  timerContainer.classList.remove("d-none");
  const totalSeconds = minutes * 60;
  let remainingSeconds = totalSeconds;
  stationTimer = setInterval(() => {
    remainingSeconds--;
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    timerDisplay.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    const percentage = (remainingSeconds / totalSeconds) * 100;
    timerProgress.style.width = `${percentage}%`;
    timerProgress.classList.remove("bg-warning", "bg-danger");
    timerDisplay.classList.remove("timer-warning", "timer-danger");
    timerStatus.classList.add("d-none");
    if (remainingSeconds <= 0) {
      clearInterval(stationTimer);
      timerDisplay.textContent = "00:00";
      timerProgress.style.width = "100%";
      timerProgress.classList.add("bg-danger");
      timerDisplay.classList.add("timer-danger");
      timerStatus.textContent = "WAKTU HABIS!";
      timerStatus.classList.remove("d-none");
      timerStatus.classList.add("timer-danger");
    } else if (remainingSeconds <= 60) {
      timerProgress.classList.add("bg-warning");
      timerDisplay.classList.add("timer-warning");
      timerStatus.textContent = "Waktu Hampir Habis";
      timerStatus.classList.remove("d-none");
      timerStatus.classList.add("timer-warning");
    }
  }, 1000);
}
async function saveScore(e) {
  e.preventDefault();
  const form = e.target;
  const saveButton = form.querySelector('button[type="submit"]');
  const originalButtonHTML = saveButton.innerHTML;
  saveButton.disabled = true;
  saveButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Menyimpan...`;
  const pengujiId = document.getElementById("select-penguji").value;
  const pesertaId = document.getElementById("select-peserta").value;
  const stationId = document.getElementById("select-station").value;
  const station = getFromStorage("stations").find((s) => s.id == stationId);
  let scoresData = [];
  station.rubric.forEach((r) => {
    const checkedRadio = form.querySelector(
      `input[name="score_${r.id}"]:checked`,
    );
    if (checkedRadio)
      scoresData.push({ rubricId: r.id, score: parseInt(checkedRadio.value) });
  });
  if (scoresData.length !== station.rubric.length) {
    alert("Harap isi semua kriteria!");
    saveButton.disabled = false;
    saveButton.innerHTML = originalButtonHTML;
    return;
  }
  const globalPerformanceRadio = form.querySelector(
    'input[name="global_performance"]:checked',
  );
  if (!globalPerformanceRadio) {
    alert("Harap pilih Global Performance Rating!");
    saveButton.disabled = false;
    saveButton.innerHTML = originalButtonHTML;
    return;
  }
  let allScores = getFromStorage("scores");
  const existingScoreIndex = allScores.findIndex(
    (s) =>
      s.pesertaId == pesertaId &&
      s.stationId == stationId &&
      s.pengujiId == pengujiId,
  );
  if (existingScoreIndex > -1) {
    if (
      !confirm(
        "Anda sudah pernah menilai peserta ini di station ini. Timpa data?",
      )
    ) {
      saveButton.disabled = false;
      saveButton.innerHTML = originalButtonHTML;
      return;
    }
    allScores.splice(existingScoreIndex, 1);
  }
  const newScore = {
    id: Date.now(),
    pengujiId: parseInt(pengujiId),
    pesertaId: parseInt(pesertaId),
    stationId: parseInt(stationId),
    scores: scoresData,
    komentar: document.getElementById("komentar").value,
    globalPerformance: parseInt(globalPerformanceRadio.value),
  };
  allScores.push(newScore);
  saveToStorage("scores", allScores);
  // Realtime Push Score
  syncAction("scores", newScore);

  logActivity(
    "SUBMIT_SCORE",
    `PesertaID: ${pesertaId}, StationID: ${stationId} (Otomatis)`,
  );
  if (stationTimer) clearInterval(stationTimer);
  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  if (user && user.role === "penguji") {
    saveButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Mengirim ke Supabase...`;
    try {
      const { error } = await supabaseClient.from("scores").upsert(
        {
          id: newScore.id,
          pengujiId: newScore.pengujiId,
          pesertaId: newScore.pesertaId,
          stationId: newScore.stationId,
          scores: newScore.scores,
          komentar: newScore.komentar,
          globalPerformance: newScore.globalPerformance,
        },
        { onConflict: "id" },
      );
      if (error) throw error;
      saveButton.classList.replace("btn-success", "btn-primary");
      saveButton.innerHTML = `<i class="fas fa-check-circle"></i> Terkirim!`;
    } catch (error) {
      console.error("Gagal mengirim skor tunggal:", error);
      saveButton.classList.replace("btn-success", "btn-warning");
      saveButton.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Tersimpan (Menunggu Antrian)`;
      alert(
        "Penilaian berhasil disimpan secara lokal, tetapi GAGAL disinkronkan ke server (Offline). \n\nTenang, data Anda sudah masuk antrian dan akan dikirim otomatis saat koneksi internet pulih. Anda juga dapat memantau status di badge 'Terputus (x tertunda)' di bagian atas.",
      );
    }
  } else {
    saveButton.innerHTML = `<i class="fas fa-check-circle"></i> Disimpan!`;
    alert("Penilaian berhasil disimpan!");
  }
  setTimeout(() => {
    document.getElementById("select-peserta").value = "";
    populatePenilaianDropdowns();
  }, 2500);
}

// =================================================================
// HASIL & LAPORAN
// =================================================================
function loadScores() {
  const allScores = getFromStorage("scores"); // Original for management
  const bestScores = getBestScoresPerParticipantPerStation(); // Deduplicated for summary
  const peserta = getFromStorage("peserta");
  const penguji = getFromStorage("penguji");
  const stations = getFromStorage("stations");
  const tableBody = document.getElementById("table-hasil-body");
  tableBody.innerHTML = "";

  const scoresByPeserta = bestScores.reduce((acc, score) => {
    if (!acc[score.pesertaId]) acc[score.pesertaId] = [];
    acc[score.pesertaId].push(score);
    return acc;
  }, {});

  Object.keys(scoresByPeserta).forEach((pesertaId) => {
    const p = peserta.find((p) => p.id == pesertaId);
    if (!p) return;
    const participantScores = scoresByPeserta[pesertaId];
    // Sort to get latest best for display purpose
    const latestBest = participantScores.sort((a, b) => b.id - a.id)[0];
    const u = penguji.find((u) => u.id === latestBest.pengujiId);
    const s = stations.find((s) => s.id === latestBest.stationId);
    if (!u || !s) return;

    const { achieved, max, percentage } = calculateWeightedScore(latestBest, s);
    const stationCount = participantScores.length;
    const stationDisplayName =
      stationCount > 1
        ? `${s.name} (+${stationCount - 1} stasiun lain)`
        : s.name;

    tableBody.innerHTML += `<tr><td>${p.nim}</td><td>${p.nama}</td><td>${stationDisplayName}</td><td>${u.nama}</td><td><div class="progress" role="progressbar" style="height:22px;font-size:0.8rem;"><div class="progress-bar fw-bold" style="width:${percentage.toFixed(1)}%;" aria-valuenow="${achieved}" aria-valuemin="0" aria-valuemax="${max}">${achieved}/${max} (${percentage.toFixed(1)}%)</div></div></td><td class="text-center"><button class="btn btn-sm btn-info me-2" onclick="showParticipantDetails(${p.id})" title="Lihat Detail Nilai Terbaik"><i class="fas fa-eye"></i></button><button class="btn btn-sm btn-danger" onclick="deleteAllScoresForParticipant(${p.id})" title="Hapus Semua Nilai Peserta Ini"><i class="fas fa-trash-alt"></i></button></td></tr>`;
  });
  if (tableBody.innerHTML === "")
    tableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted p-4">Belum ada data penilaian.</td></tr>`;
}
function deleteAllScoresForParticipant(pesertaId) {
  if (
    !confirm(
      "Anda yakin ingin menghapus SEMUA data nilai untuk peserta ini? Tindakan ini tidak dapat diurungkan.",
    )
  )
    return;
  let scores = getFromStorage("scores");
  scores = scores.filter((s) => s.pesertaId !== parseInt(pesertaId));
  saveToStorage("scores", scores);
  logActivity("DELETE_ALL_SCORES_FOR_PARTICIPANT", `PesertaID: ${pesertaId}`);
  loadScores();
  loadCollectiveResults();
  renderStationAnalyticsChart();
  renderRubricPerformanceChart();
  renderRubricDifficultyChart();
  renderSessionComparisonChart();
  renderScoreVsGprChart();
  loadRemedialRecommendations();
  displayStationRankings();
}
async function applyCollectiveRekap() {
  const gradeInput = document.getElementById("collective-passing-grade");
  const grade = gradeInput.value;

  if (grade === "" || grade < 1 || grade > 100)
    return alert("Batas lulus tidak valid. Masukkan angka antara 1 dan 100.");

  const numericGrade = parseInt(grade);
  const container = document.getElementById("station-checkbox-container");
  const checkedCheckboxes = container.querySelectorAll(
    'input[type="checkbox"]:checked',
  );
  const newExcludedIds = Array.from(checkedCheckboxes).map((cb) =>
    parseInt(cb.value),
  );

  const method = document.getElementById("passing-method-selector").value;

  // 1. Simpan semua ke storage dan sync ke Supabase
  saveToStorage("osce_collective_passing_grade", numericGrade);
  saveToStorage("osce_excluded_stations", newExcludedIds);
  saveToStorage("osce_passing_method", method);
  syncAction("osce_collective_passing_grade", numericGrade);
  syncAction("osce_excluded_stations", newExcludedIds);
  syncAction("osce_passing_method", method);

  // 2. Logging
  logActivity(
    "UPDATE_COLLECTIVE_SETTINGS",
    `Batas: ${numericGrade}%, Dasar: ${method}, Stasiun Pengecualian: ${newExcludedIds.length} stasiun.`,
  );

  // 3. Muat ulang hasil
  alert(`Pengaturan rekapitulasi berhasil disimpan dan diterapkan.`);
  loadCollectiveResults();
}
function loadCollectiveResults(gprDefault = null) {
  let savedPassingGrade = getFromStorage("osce_collective_passing_grade");
  let collectivePassingGrade;

  if (savedPassingGrade !== null && typeof savedPassingGrade !== "undefined") {
    collectivePassingGrade = savedPassingGrade;
  } else {
    const defaultGrade =
      gprDefault !== null && !isNaN(gprDefault) ? Math.round(gprDefault) : 75;
    collectivePassingGrade = defaultGrade;
    saveToStorage("osce_collective_passing_grade", collectivePassingGrade);
  }

  const passingMethod = getFromStorage("osce_passing_method") || "percentage";
  document.getElementById("collective-passing-grade").value =
    collectivePassingGrade;
  document.getElementById("passing-method-selector").value = passingMethod;

  const peserta = getFromStorage("peserta");
  const bestScores = getBestScoresPerParticipantPerStation();
  const stations = getFromStorage("stations");
  const tableBody = document.getElementById("table-collective-hasil-body");
  tableBody.innerHTML = "";
  const excludedStationIds = getFromStorage("osce_excluded_stations") || [];
  const checkboxContainer = document.getElementById(
    "station-checkbox-container",
  );
  const displayContainer = document.getElementById("excluded-stations-display");
  checkboxContainer.innerHTML = "";
  stations
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((s) => {
      const isChecked = excludedStationIds.includes(s.id);
      checkboxContainer.innerHTML += `<div class="form-check"><input class="form-check-input" type="checkbox" value="${s.id}" id="exclude-station-${s.id}" ${isChecked ? "checked" : ""}><label class="form-check-label small" for="exclude-station-${s.id}">${s.name}</label></div>`;
    });
  const excludedStationNames = stations
    .filter((s) => excludedStationIds.includes(s.id))
    .map((s) => s.name);
  displayContainer.textContent =
    excludedStationNames.length > 0
      ? excludedStationNames.join(", ")
      : "Tidak ada";
  let participantAverages = [];
  let passCount = 0;
  let failCount = 0;
  const brmPassingScores =
    passingMethod === "gpr" ? calculateBrmPassingScores() : null;

  peserta.forEach((p) => {
    const allParticipantScores = bestScores.filter((s) => s.pesertaId === p.id);
    const validScores = allParticipantScores.filter(
      (sc) => !excludedStationIds.includes(sc.stationId),
    );
    if (validScores.length === 0) return;
    let totalPercentageSum = 0;
    validScores.forEach((score) => {
      const station = stations.find((s) => s.id === score.stationId);
      if (station) {
        const { percentage } = calculateWeightedScore(score, station);
        totalPercentageSum += percentage;
      }
    });
    const averageScore = totalPercentageSum / validScores.length;
    participantAverages.push(averageScore);

    // DETERMINATION LOGIC
    let isPassed = false;
    let passedStationsCount = 0;
    validScores.forEach((score) => {
      const station = stations.find((s) => s.id === score.stationId);
      const { percentage } = calculateWeightedScore(score, station);
      const stationPassingGrade = brmPassingScores
        ? brmPassingScores[score.stationId] || 75
        : station.passingGrade || 75;
      if (percentage >= stationPassingGrade) {
        passedStationsCount++;
      }
    });

    if (passingMethod === "gpr") {
      // BRM logic: must pass ALL stations if method is GPR
      // (Simplified dashboard logic, matching the reports default)
      isPassed = passedStationsCount === validScores.length;
    } else {
      // Fixed percentage logic
      isPassed = averageScore >= collectivePassingGrade;
    }

    if (isPassed) passCount++;
    else failCount++;
    const statusLulus = isPassed
      ? '<span class="badge bg-success fs-6">Lulus</span>'
      : '<span class="badge bg-danger fs-6">Tidak Lulus</span>';
    tableBody.innerHTML += `<tr><td>${p.nim}</td><td><strong>${p.nama}</strong></td><td class="text-center">${validScores.length}</td><td class="text-center fw-bold">${passedStationsCount} / ${validScores.length}</td><td class="text-center"><div class="progress" role="progressbar" style="height:22px;font-size:0.9rem;"><div class="progress-bar ${isPassed ? "bg-success" : "bg-danger"}" style="width:${averageScore.toFixed(1)}%;" aria-valuenow="${averageScore.toFixed(1)}" aria-valuemin="0" aria-valuemax="100">${averageScore.toFixed(2)}%</div></div></td><td class="text-center">${statusLulus}</td></tr>`;
  });
  if (tableBody.innerHTML === "")
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted p-4">Belum ada data nilai valid untuk ditampilkan.</td></tr>`;
  const cohortAverageScoreEl = document.getElementById("cohort-average-score");
  const cohortPassCountEl = document.getElementById("cohort-pass-count");
  const cohortFailCountEl = document.getElementById("cohort-fail-count");
  if (participantAverages.length > 0) {
    const totalCohortScore = participantAverages.reduce(
      (sum, avg) => sum + avg,
      0,
    );
    const cohortAverage = totalCohortScore / participantAverages.length;
    cohortAverageScoreEl.innerHTML = `${cohortAverage.toFixed(2)}<small>%</small>`;
    cohortPassCountEl.innerText = passCount;
    cohortFailCountEl.innerText = failCount;
  } else {
    cohortAverageScoreEl.innerText = "N/A";
    cohortPassCountEl.innerText = "N/A";
    cohortFailCountEl.innerText = "N/A";
  }
}
function exportCollectiveResultsToCSV() {
  const collectivePassingGrade =
    getFromStorage("osce_collective_passing_grade") || 75;
  const peserta = getFromStorage("peserta");
  const scores = getFromStorage("scores");
  const stations = getFromStorage("stations");
  const excludedStationIds = getFromStorage("osce_excluded_stations") || [];
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent +=
    "NIM,Nama Peserta,Jumlah Station Dikerjakan (Valid),Rata-Rata Nilai (%),Status Kelulusan\n";
  peserta.forEach((p) => {
    const participantScores = scores.filter((s) => s.pesertaId === p.id);
    const validScores = participantScores.filter(
      (s) => !excludedStationIds.includes(s.stationId),
    );
    if (validScores.length > 0) {
      let totalPercentageSum = 0;
      validScores.forEach((score) => {
        const station = stations.find((s) => s.id === score.stationId);
        if (station) {
          const { percentage } = calculateWeightedScore(score, station);
          totalPercentageSum += percentage;
        }
      });
      const averageScore = totalPercentageSum / validScores.length;
      const statusLulus =
        averageScore >= collectivePassingGrade ? "Lulus" : "Tidak Lulus";
      const row = [
        p.nim,
        `"${p.nama}"`,
        validScores.length,
        averageScore.toFixed(2),
        statusLulus,
      ].join(",");
      csvContent += row + "\n";
    }
  });
  if (csvContent.split("\n").length <= 2)
    return alert("Tidak ada data hasil kolektif untuk diekspor.");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute(
    "download",
    `hasil_kolektif_osce_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
function displayStationRankings() {
  const stations = getFromStorage("stations");
  const bestScores = getBestScoresPerParticipantPerStation();
  const peserta = getFromStorage("peserta");
  const container = document.getElementById("station-ranking-container");
  container.innerHTML = "";
  if (bestScores.length === 0) {
    container.innerHTML =
      '<div class="col-12 text-center text-muted p-4"><p>Belum ada data penilaian untuk ditampilkan.</p></div>';
    return;
  }
  stations.forEach((station) => {
    const stationScores = bestScores.filter(
      (sc) => sc.stationId === station.id,
    );
    if (stationScores.length === 0) return;
    const scoresByPeserta = stationScores.map((sc) => {
      const p = peserta.find((p) => p.id === sc.pesertaId);
      const { achieved } = calculateWeightedScore(sc, station);
      return { nama: p ? p.nama : "Peserta Dihapus", totalScore: achieved };
    });
    scoresByPeserta.sort((a, b) => b.totalScore - a.totalScore);
    const maxScoreValue =
      scoresByPeserta.length > 0 ? scoresByPeserta[0].totalScore : 0;
    const topScorers = scoresByPeserta.filter(
      (p) => p.totalScore === maxScoreValue && p.totalScore > 0,
    );
    const topScorersHtml =
      topScorers.length > 0
        ? topScorers
            .map((ts) => `<li class="list-group-item">${ts.nama}</li>`)
            .join("")
        : '<li class="list-group-item text-muted">Belum ada</li>';
    const cardHtml = `<div class="col-md-6 col-lg-4 mb-4"><div class="card h-100"><div class="card-header bg-light"><i class="fas fa-sitemap"></i> ${station.name}</div><div class="card-body text-center"><h6 class="card-subtitle mb-2 text-muted">Nilai Tertinggi (berbobot)</h6><p class="card-text fs-1 fw-bold text-primary">${maxScoreValue}</p><h6 class="card-subtitle mb-2 text-muted">Diraih oleh:</h6></div><ul class="list-group list-group-flush text-center">${topScorersHtml}</ul></div></div>`;
    container.innerHTML += cardHtml;
  });
  if (container.innerHTML === "")
    container.innerHTML =
      '<div class="col-12 text-center text-muted p-4"><p>Belum ada data penilaian untuk ditampilkan.</p></div>';
}

// =================================================================
// BORDERLINE REGRESSION METHOD (BRM) & FEEDBACK
// =================================================================
function linearRegression(data) {
  if (!data || data.length < 2) return null;
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumXX = 0;
  const n = data.length;
  data.forEach(([x, y]) => {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  });
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}
function calculateBrmPassingScores() {
  const stations = getFromStorage("stations");
  const bestScores = getBestScoresPerParticipantPerStation();
  const brmScores = {};
  stations.forEach((station) => {
    const stationScoresData = bestScores
      .filter((s) => s.stationId === station.id && s.globalPerformance)
      .map((s) => {
        const { percentage } = calculateWeightedScore(s, station);
        return [s.globalPerformance, percentage];
      });
    const regression = linearRegression(stationScoresData);
    if (regression) {
      const brmPassingScore = regression.intercept + regression.slope * 2.0;
      brmScores[station.id] = Math.max(0, Math.min(100, brmPassingScore));
    } else {
      brmScores[station.id] = station.passingGrade || 75;
    }
  });
  return brmScores;
}
function generateParticipantFeedback(pesertaId) {
  const participantScores = getFromStorage("scores").filter(
    (s) => s.pesertaId === pesertaId,
  );
  if (participantScores.length === 0)
    return { weakStations: [], recommendations: [] };
  const stations = getFromStorage("stations");
  const brmPassingScores = calculateBrmPassingScores();
  const weakStations = [];
  const recommendationSet = new Set();
  const recommendationMap = {
    "komunikasi|empati|rapport|bercakap":
      "Tingkatkan kemampuan komunikasi interpersonal dan empati terhadap pasien.",
    "prosedur|teknik|aseptik|steril|langkah":
      "Perhatikan kembali langkah-langkah prosedur dan teknik aseptik untuk memastikan keamanan dan efektivitas.",
    "anamnesis|pemeriksaan|diagnosis|fisik":
      "Perdalam kemampuan dalam melakukan anamnesis yang terstruktur dan pemeriksaan fisik yang akurat.",
    "edukasi|konseling|informasi|penjelasan":
      "Fokus pada cara memberikan edukasi dan informasi yang jelas dan mudah dipahami oleh pasien.",
    "manajemen|tatalaksana|terapi|rencana":
      "Tingkatkan kemampuan dalam merencanakan dan mengelola tatalaksana pasien secara komprehensif.",
  };
  const recommendationKeys = Object.keys(recommendationMap);
  participantScores.forEach((score) => {
    const station = stations.find((s) => s.id === score.stationId);
    if (!station) return;
    const { percentage } = calculateWeightedScore(score, station);
    const passingScore =
      brmPassingScores[station.id] || station.passingGrade || 75;
    if (percentage < passingScore) {
      weakStations.push(station.name);
      score.scores.forEach((item) => {
        const rubric = station.rubric.find((r) => r.id === item.rubricId);
        if (rubric && rubric.maxScore > 0) {
          const itemPercentage = (item.score / rubric.maxScore) * 100;
          if (itemPercentage < 60) {
            const criteriaText = rubric.criteria.toLowerCase();
            for (const key of recommendationKeys) {
              if (new RegExp(key).test(criteriaText)) {
                recommendationSet.add(recommendationMap[key]);
                break;
              }
            }
          }
        }
      });
    }
  });
  return { weakStations, recommendations: Array.from(recommendationSet) };
}

// =================================================================
// REVISED ANALYTICS & REPORTING FUNCTIONS
// =================================================================
function renderStationAnalyticsChart() {
  const stations = getFromStorage("stations");
  const scores = getFromStorage("scores");
  const chartCanvas = document.getElementById("station-analytics-chart");
  const fallbackMessage = document.getElementById("station-analytics-fallback");
  if (scores.length === 0 || stations.length === 0) {
    chartCanvas.classList.add("d-none");
    fallbackMessage.classList.remove("d-none");
    if (stationAnalyticsChartInstance) stationAnalyticsChartInstance.destroy();
    return;
  }
  chartCanvas.classList.remove("d-none");
  fallbackMessage.classList.add("d-none");
  const brmPassingScores = calculateBrmPassingScores();
  const analyticsData = stations
    .map((station) => {
      const stationScores = scores.filter((s) => s.stationId === station.id);
      if (stationScores.length === 0)
        return {
          name: station.name,
          avgScore: 0,
          passRate: 0,
          brm: brmPassingScores[station.id] || 0,
        };
      const passingGrade = station.passingGrade || 75;
      let totalPercentage = 0;
      let passedCount = 0;
      stationScores.forEach((score) => {
        const { percentage } = calculateWeightedScore(score, station);
        totalPercentage += percentage;
        if (percentage >= passingGrade) passedCount++;
      });
      return {
        name: station.name,
        avgScore: totalPercentage / stationScores.length,
        passRate: (passedCount / stationScores.length) * 100,
        brm: brmPassingScores[station.id] || 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const ctx = chartCanvas.getContext("2d");
  if (stationAnalyticsChartInstance) stationAnalyticsChartInstance.destroy();
  stationAnalyticsChartInstance = new Chart(ctx, {
    data: {
      labels: analyticsData.map((d) => d.name),
      datasets: [
        {
          type: "bar",
          label: "Rerata Nilai (%)",
          data: analyticsData.map((d) => d.avgScore.toFixed(2)),
          backgroundColor: "rgba(54, 162, 235, 0.7)",
          borderColor: "rgba(54, 162, 235, 1)",
          order: 2,
        },
        {
          type: "line",
          label: "Batas Lulus (BRM)",
          data: analyticsData.map((d) => d.brm.toFixed(2)),
          backgroundColor: "rgba(255, 99, 132, 1)",
          borderColor: "rgba(255, 99, 132, 1)",
          borderWidth: 3,
          pointRadius: 5,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          beginAtZero: true,
          max: 100,
          ticks: { callback: (value) => value + "%" },
          title: { display: true, text: "Persentase" },
        },
      },
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            label: (context) => {
              let label = context.dataset.label || "";
              if (label) label += ": ";
              label += `${context.raw}%`;
              return label;
            },
          },
        },
      },
    },
  });
}
function renderRubricPerformanceChart() {
  const scores = getFromStorage("scores");
  const stations = getFromStorage("stations");
  const chartCanvas = document.getElementById("rubric-performance-chart");
  const fallbackMessage = document.getElementById(
    "rubric-performance-fallback",
  );
  if (scores.length === 0 || stations.length === 0) {
    chartCanvas.classList.add("d-none");
    fallbackMessage.classList.remove("d-none");
    if (rubricPerformanceChartInstance)
      rubricPerformanceChartInstance.destroy();
    return;
  }
  chartCanvas.classList.remove("d-none");
  fallbackMessage.classList.add("d-none");
  const rubricStats = {};
  stations.forEach((s) => {
    s.rubric.forEach((r) => {
      const key = `${s.id}-${r.id}`;
      rubricStats[key] = {
        criteria: r.criteria,
        stationName: s.name,
        passed: 0,
        failed: 0,
        maxScore: r.maxScore,
        passingGrade: s.passingGrade || 75,
      };
    });
  });
  scores.forEach((score) => {
    const station = stations.find((s) => s.id === score.stationId);
    if (!station) return;
    score.scores.forEach((item) => {
      const rubricItem = station.rubric.find((r) => r.id === item.rubricId);
      if (!rubricItem) return;
      const key = `${station.id}-${item.rubricId}`;
      const percentage =
        rubricItem.maxScore > 0 ? (item.score / rubricItem.maxScore) * 100 : 0;
      // Menggunakan threshold 50% untuk item individual (bukan passing grade stasiun),
      // karena passing grade stasiun dirancang untuk skor keseluruhan berbobot.
      if (percentage >= 50) rubricStats[key].passed++;
      else rubricStats[key].failed++;
    });
  });
  const sortedRubrics = Object.values(rubricStats)
    .filter((r) => r.passed > 0 || r.failed > 0)
    .sort(
      (a, b) =>
        b.failed / (b.failed + b.passed) - a.failed / (a.failed + a.passed),
    );
  const labels = sortedRubrics.map(
    (r) =>
      `${r.stationName.substring(0, 10)}..: ${r.criteria.substring(0, 20)}..`,
  );
  const passedData = sortedRubrics.map((r) => r.passed);
  const failedData = sortedRubrics.map((r) => r.failed);
  const ctx = chartCanvas.getContext("2d");
  if (rubricPerformanceChartInstance) rubricPerformanceChartInstance.destroy();
  rubricPerformanceChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Gagal",
          data: failedData,
          backgroundColor: "rgba(220, 53, 69, 0.7)",
        },
        {
          label: "Lolos",
          data: passedData,
          backgroundColor: "rgba(25, 135, 84, 0.7)",
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      scales: {
        x: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } },
        y: { stacked: true },
      },
      plugins: {
        legend: { position: "top" },
        tooltip: {
          callbacks: {
            label: function (context) {
              const label = context.dataset.label || "";
              const value = context.raw;
              const total = context.chart.data.datasets.reduce(
                (sum, ds) => sum + ds.data[context.dataIndex],
                0,
              );
              const percentage =
                total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return `${label}: ${value} (${percentage}%)`;
            },
          },
        },
      },
    },
  });
}
function renderRubricDifficultyChart() {
  const scores = getFromStorage("scores");
  const stations = getFromStorage("stations");
  const chartCanvas = document.getElementById("rubric-difficulty-chart");
  const fallbackMessage = document.getElementById("rubric-difficulty-fallback");
  if (scores.length === 0 || stations.length === 0) {
    chartCanvas.classList.add("d-none");
    fallbackMessage.classList.remove("d-none");
    if (rubricDifficultyChartInstance) rubricDifficultyChartInstance.destroy();
    return;
  }
  chartCanvas.classList.remove("d-none");
  fallbackMessage.classList.add("d-none");
  const rubricStats = {};
  scores.forEach((score) => {
    const station = stations.find((s) => s.id === score.stationId);
    if (!station) return;
    score.scores.forEach((item) => {
      const rubricItem = station.rubric.find((r) => r.id === item.rubricId);
      if (!rubricItem) return;
      const key = `${station.id}-${rubricItem.id}`;
      if (!rubricStats[key])
        rubricStats[key] = {
          criteria: `${station.name}: ${rubricItem.criteria}`,
          totalScore: 0,
          totalMaxScore: 0,
          count: 0,
        };
      rubricStats[key].totalScore += item.score;
      rubricStats[key].totalMaxScore += rubricItem.maxScore;
      rubricStats[key].count++;
    });
  });
  const performanceData = Object.values(rubricStats)
    .map((stat) => ({
      criteria: stat.criteria,
      avgPercentage: (stat.totalScore / stat.totalMaxScore) * 100 || 0,
    }))
    .sort((a, b) => a.avgPercentage - b.avgPercentage)
    .slice(0, 15);
  const ctx = chartCanvas.getContext("2d");
  if (rubricDifficultyChartInstance) rubricDifficultyChartInstance.destroy();
  rubricDifficultyChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: performanceData.map((d) => d.criteria),
      datasets: [
        {
          label: "Rata-rata Skor Kriteria (%)",
          data: performanceData.map((d) => d.avgPercentage.toFixed(2)),
          backgroundColor: "rgba(220, 53, 69, 0.7)",
          borderColor: "rgba(220, 53, 69, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          beginAtZero: true,
          max: 100,
          ticks: { callback: (value) => value + "%" },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (context) => `Rata-rata: ${context.raw}%` },
        },
      },
    },
  });
}
function renderGlobalPerformanceAnalysis() {
  const scores = getFromStorage("scores");
  const chartCanvas = document.getElementById("global-performance-chart");
  const fallbackMessage = document.getElementById(
    "global-performance-fallback",
  );
  const avgDisplay = document.getElementById("avg-global-performance");
  const avgDisplay100 = document.getElementById("avg-global-performance-100");
  const REQUIRED_STATIONS_FOR_ANALYSIS = 9;
  const scoresByPeserta = scores.reduce((acc, score) => {
    if (!acc[score.pesertaId]) acc[score.pesertaId] = [];
    acc[score.pesertaId].push(score);
    return acc;
  }, {});
  const completedPesertaScores = Object.values(scoresByPeserta).filter(
    (pScores) => pScores.length >= REQUIRED_STATIONS_FOR_ANALYSIS,
  );
  if (completedPesertaScores.length === 0) {
    chartCanvas.classList.add("d-none");
    fallbackMessage.classList.remove("d-none");
    if (globalPerformanceChartInstance)
      globalPerformanceChartInstance.destroy();
    avgDisplay.textContent = "N/A";
    avgDisplay100.textContent = "N/A";
    return null;
  }
  chartCanvas.classList.remove("d-none");
  fallbackMessage.classList.add("d-none");
  let totalGlobalPerfSum = 0;
  const performanceCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  completedPesertaScores.forEach((pScores) => {
    const participantGlobalPerfSum = pScores.reduce(
      (sum, score) => sum + (score.globalPerformance || 0),
      0,
    );
    const participantAvgPerf = participantGlobalPerfSum / pScores.length;
    totalGlobalPerfSum += participantAvgPerf;
    if (participantAvgPerf < 1.5) performanceCounts[1]++;
    else if (participantAvgPerf < 2.5) performanceCounts[2]++;
    else if (participantAvgPerf < 3.5) performanceCounts[3]++;
    else performanceCounts[4]++;
  });
  const overallAvg = totalGlobalPerfSum / completedPesertaScores.length;
  avgDisplay.textContent = overallAvg.toFixed(2);
  const overallAvg100 = (overallAvg / 4) * 100;
  avgDisplay100.textContent = overallAvg100.toFixed(2);
  const ctx = chartCanvas.getContext("2d");
  if (globalPerformanceChartInstance) globalPerformanceChartInstance.destroy();
  globalPerformanceChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Tidak Lulus", "Borderline", "Lulus", "Superior"],
      datasets: [
        {
          label: "Jumlah Peserta",
          data: [
            performanceCounts[1],
            performanceCounts[2],
            performanceCounts[3],
            performanceCounts[4],
          ],
          backgroundColor: [
            "rgba(220, 53, 69, 0.7)",
            "rgba(255, 193, 7, 0.7)",
            "rgba(25, 135, 84, 0.7)",
            "rgba(13, 110, 253, 0.7)",
          ],
          borderColor: [
            "rgb(220, 53, 69)",
            "rgb(255, 193, 7)",
            "rgb(25, 135, 84)",
            "rgb(13, 110, 253)",
          ],
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: "Distribusi Global Performance Peserta (Selesai)",
        },
      },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  });
  return overallAvg100;
}
function renderSessionComparisonChart() {
  const chartCanvas = document.getElementById("session-comparison-chart");
  const fallbackMessage = document.getElementById(
    "session-comparison-fallback",
  );
  const peserta = getFromStorage("peserta");
  const scores = getFromStorage("scores");
  const stations = getFromStorage("stations");
  const scheduledPeserta = peserta.filter((p) => p.sesi);
  if (scheduledPeserta.length === 0 || scores.length === 0) {
    chartCanvas.classList.add("d-none");
    fallbackMessage.classList.remove("d-none");
    if (sessionComparisonChartInstance)
      sessionComparisonChartInstance.destroy();
    return;
  }
  chartCanvas.classList.remove("d-none");
  fallbackMessage.classList.add("d-none");
  const sessionData = {};
  scores.forEach((score) => {
    const p = peserta.find((p) => p.id === score.pesertaId);
    const station = stations.find((s) => s.id === score.stationId);
    if (!p || !p.sesi || !station) return;
    if (!sessionData[p.sesi])
      sessionData[p.sesi] = { totalPercent: 0, scoreCount: 0 };
    const { percentage } = calculateWeightedScore(score, station);
    sessionData[p.sesi].totalPercent += percentage;
    sessionData[p.sesi].scoreCount++;
  });
  const sortedSessions = Object.keys(sessionData).sort(
    (a, b) => parseInt(a) - parseInt(b),
  );
  const labels = sortedSessions.map((sesi) => `Sesi ${sesi}`);
  const data = sortedSessions.map((sesi) => {
    const { totalPercent, scoreCount } = sessionData[sesi];
    return scoreCount > 0 ? (totalPercent / scoreCount).toFixed(2) : 0;
  });
  const ctx = chartCanvas.getContext("2d");
  if (sessionComparisonChartInstance) sessionComparisonChartInstance.destroy();
  sessionComparisonChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Rata-rata Nilai Sesi (%)",
          data: data,
          backgroundColor: "rgba(25, 135, 84, 0.7)",
          borderColor: "rgba(25, 135, 84, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (context) => `Rata-rata: ${context.raw}%` },
        },
      },
    },
  });
}
function renderScoreVsGprChart() {
  const scores = getFromStorage("scores");
  const stations = getFromStorage("stations");
  const peserta = getFromStorage("peserta");
  const excludedStationIds = getFromStorage("osce_excluded_stations") || [];
  const chartCanvas = document.getElementById("score-vs-gpr-chart");
  const fallbackMessage = document.getElementById("score-vs-gpr-fallback");
  const REQUIRED_STATIONS_FOR_ANALYSIS = 9;
  const scoresByPeserta = scores.reduce((acc, score) => {
    if (!acc[score.pesertaId]) acc[score.pesertaId] = [];
    acc[score.pesertaId].push(score);
    return acc;
  }, {});
  const scatterData = [];
  for (const pesertaId in scoresByPeserta) {
    const p = peserta.find((p) => p.id == pesertaId);
    if (!p) continue;
    const participantScores = scoresByPeserta[pesertaId];
    const analyzableScores = participantScores.filter(
      (s) => !excludedStationIds.includes(s.stationId) && s.globalPerformance,
    );
    if (analyzableScores.length < REQUIRED_STATIONS_FOR_ANALYSIS) continue;
    let totalGpr = 0;
    analyzableScores.forEach((s) => {
      totalGpr += s.globalPerformance;
    });
    const avgGpr = totalGpr / analyzableScores.length;
    let totalPercentageSum = 0;
    analyzableScores.forEach((score) => {
      const station = stations.find((s) => s.id === score.stationId);
      if (station) {
        const { percentage } = calculateWeightedScore(score, station);
        totalPercentageSum += percentage;
      }
    });
    const avgCollectiveScore = totalPercentageSum / analyzableScores.length;
    if (avgGpr > 0 && avgCollectiveScore > 0)
      scatterData.push({ x: avgGpr, y: avgCollectiveScore, label: p.nama });
  }
  if (scatterData.length < 2) {
    chartCanvas.classList.add("d-none");
    fallbackMessage.classList.remove("d-none");
    if (scoreVsGprChartInstance) scoreVsGprChartInstance.destroy();
    return;
  }
  chartCanvas.classList.remove("d-none");
  fallbackMessage.classList.add("d-none");
  const ctx = chartCanvas.getContext("2d");
  if (scoreVsGprChartInstance) scoreVsGprChartInstance.destroy();
  scoreVsGprChartInstance = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Peserta",
          data: scatterData,
          backgroundColor: "rgba(13, 110, 253, 0.6)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context) {
              const dataPoint = context.raw;
              return [
                `Peserta: ${dataPoint.label}`,
                `Nilai Rata-rata: ${dataPoint.y.toFixed(2)}%`,
                `Rata-rata GPR: ${dataPoint.x.toFixed(2)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          position: "bottom",
          title: { display: true, text: "Rata-Rata Global Performance Rating" },
          min: 1,
          max: 4,
          ticks: { stepSize: 0.5 },
        },
        y: {
          title: { display: true, text: "Rata-Rata Nilai Kolektif (%)" },
          min: 0,
          max: 100,
          ticks: { callback: (value) => value + "%" },
        },
      },
    },
  });
}
function loadRemedialRecommendations() {
  const tableBody = document.getElementById("table-remedial-body");
  const peserta = getFromStorage("peserta");
  const stations = getFromStorage("stations");
  const scores = getFromStorage("scores");
  const brmPassingScores = calculateBrmPassingScores();
  tableBody.innerHTML = "";
  const recommendations = {};
  scores.forEach((score) => {
    const station = stations.find((s) => s.id === score.stationId);
    if (!station) return;
    const { percentage } = calculateWeightedScore(score, station);
    const passingGrade =
      brmPassingScores[station.id] || station.passingGrade || 75;
    if (percentage < passingGrade) {
      if (!recommendations[score.pesertaId]) {
        const p = peserta.find((p) => p.id === score.pesertaId);
        if (p)
          recommendations[score.pesertaId] = {
            nim: p.nim,
            nama: p.nama,
            stations: [],
          };
      }
      if (recommendations[score.pesertaId])
        recommendations[score.pesertaId].stations.push({
          name: station.name,
          score: percentage.toFixed(2),
        });
    }
  });
  if (Object.keys(recommendations).length === 0) {
    tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-success p-4"><i class="fas fa-check-circle me-2"></i>Tidak ada peserta yang memerlukan remedial saat ini.</td></tr>`;
    return;
  }
  Object.values(recommendations)
    .sort((a, b) => a.nama.localeCompare(b.nama))
    .forEach((rec) => {
      const stationListHtml = rec.stations
        .map(
          (s) =>
            `<span class="badge bg-danger me-1 mb-1">${s.name} (${s.score}%)</span>`,
        )
        .join(" ");
      tableBody.innerHTML += `<tr><td>${rec.nim}</td><td><strong>${rec.nama}</strong></td><td>${stationListHtml}</td></tr>`;
    });
}
function getStationAverages() {
  const scores = getFromStorage("scores");
  const stations = getFromStorage("stations");
  const stationAverages = {};
  scores.forEach((score) => {
    const station = stations.find((s) => s.id === score.stationId);
    if (station) {
      if (!stationAverages[station.id])
        stationAverages[station.id] = { totalPercent: 0, count: 0 };
      const { percentage } = calculateWeightedScore(score, station);
      stationAverages[station.id].totalPercent += percentage;
      stationAverages[station.id].count++;
    }
  });
  const finalAverages = {};
  for (const stationId in stationAverages)
    finalAverages[stationId] =
      stationAverages[stationId].totalPercent /
      stationAverages[stationId].count;
  return finalAverages;
}
function showParticipantDetails(
  pesertaId,
  targetElementId = "participantDetailModalBody",
) {
  const p = getFromStorage("peserta").find((item) => item.id === pesertaId);
  if (!p) return;
  const allScores = getFromStorage("scores").filter(
    (s) => s.pesertaId === pesertaId,
  );
  const stations = getFromStorage("stations");
  const penguji = getFromStorage("penguji");
  const modalBody = document.getElementById(targetElementId);
  if (!modalBody) return;

  const modalLabel = document.getElementById("participantDetailModalLabel");
  if (modalLabel) {
    modalLabel.innerHTML = `<i class="fas fa-user-graduate"></i> Detail Hasil Peserta: <strong>${p.nama}</strong>`;
  }
  const globalPerfMap = {
    1: "Tidak Lulus",
    2: "Borderline",
    3: "Lulus",
    4: "Superior",
  };
  const stationAverages = getStationAverages();
  const { weakStations, recommendations } =
    generateParticipantFeedback(pesertaId);
  let feedbackHtml = "";
  if (allScores.length > 0) {
    feedbackHtml = `<div class="col-12 mt-4"><div class="card border-warning"><div class="card-header bg-warning-subtle"><i class="fas fa-lightbulb me-2"></i><strong>Feedback & Rekomendasi</strong></div><div class="card-body">`;
    if (weakStations.length === 0) {
      feedbackHtml +=
        '<p class="text-success"><i class="fas fa-check-circle me-2"></i>Selamat! Performa Anda konsisten dan baik di semua stasiun yang telah dinilai.</p>';
    } else {
      feedbackHtml +=
        '<h6><i class="fas fa-bullseye text-danger me-2"></i>Station yang Perlu Ditingkatkan:</h6><ul class="list-group list-group-flush mb-3">';
      weakStations.forEach((ws) => {
        feedbackHtml += `<li class="list-group-item">${ws}</li>`;
      });
      feedbackHtml += "</ul>";
      if (recommendations.length > 0) {
        feedbackHtml +=
          '<h6><i class="fas fa-tasks text-primary me-2"></i>Rekomendasi Perbaikan:</h6><ul class="list-group list-group-flush">';
        recommendations.forEach((rec) => {
          feedbackHtml += `<li class="list-group-item">${rec}</li>`;
        });
        feedbackHtml += "</ul>";
      }
    }
    feedbackHtml += "</div></div></div>";
  }
  let content = `<div class="row"><div class="col-md-4"><div class="card mb-3"><div class="card-body"><h5 class="card-title">${p.nama}</h5><p class="card-text text-muted">${p.nim}</p><hr><p><strong>Total Station Diikuti:</strong> ${allScores.length} / ${stations.length}</p></div></div></div><div class="col-md-8"><div class="card"><div class="card-header">Grafik Perbandingan Performa (%)</div><div class="card-body"><canvas id="participantProgressChart"></canvas></div></div></div>${feedbackHtml}</div><h4 class="mt-4">Rincian Nilai</h4><div class="table-responsive"><table class="table table-bordered"><thead><tr><th>Station</th><th>Penguji</th><th>Skor (Berbobot)</th><th>Persentase</th><th>Global Perf.</th><th>Status</th><th>Komentar</th></tr></thead><tbody>`;
  const chartLabels = [],
    chartDataParticipant = [],
    chartDataCohort = [];
  const brmPassingScores = calculateBrmPassingScores();
  allScores
    .sort(
      (a, b) =>
        stations.findIndex((s) => s.id === a.stationId) -
        stations.findIndex((s) => s.id === b.stationId),
    )
    .forEach((score) => {
      const s = stations.find((st) => st.id === score.stationId);
      const u = penguji.find((uj) => uj.id === score.pengujiId);
      if (!s || !u) return;
      const { achieved, max, percentage } = calculateWeightedScore(score, s);
      const passingGrade = brmPassingScores[s.id] || s.passingGrade || 75;
      const statusLulus =
        percentage >= passingGrade
          ? '<span class="badge bg-success">Lulus</span>'
          : '<span class="badge bg-danger">Tidak Lulus</span>';
      const globalPerfText = score.globalPerformance
        ? `${globalPerfMap[score.globalPerformance]} (${score.globalPerformance})`
        : "N/A";
      chartLabels.push(s.name);
      chartDataParticipant.push(percentage.toFixed(2));
      chartDataCohort.push((stationAverages[s.id] || 0).toFixed(2));
      content += `<tr><td>${s.name}</td><td>${u.nama}</td><td>${achieved} / ${max}</td><td>${percentage.toFixed(2)}%</td><td>${globalPerfText}</td><td>${statusLulus}</td><td>${score.komentar || "-"}</td></tr>`;
    });
  if (allScores.length === 0)
    content += `<tr><td colspan="7" class="text-center text-muted">Belum ada data nilai untuk peserta ini.</td></tr>`;
  content += `</tbody></table></div>`;
  modalBody.innerHTML = content;
  const printBtn = document.getElementById("print-participant-result-btn");
  if (printBtn) {
    printBtn.onclick = () => printParticipantResult(pesertaId);
  }
  const canvasEl = document.getElementById("participantProgressChart");
  if (canvasEl) {
    const ctx = canvasEl.getContext("2d");
    if (participantProgressChartInstance)
      participantProgressChartInstance.destroy();
    participantProgressChartInstance = new Chart(ctx, {
      type: "radar",
      data: {
        labels: chartLabels,
        datasets: [
          {
            label: "Nilai Peserta",
            data: chartDataParticipant,
            backgroundColor: "rgba(54, 162, 235, 0.2)",
            borderColor: "rgba(54, 162, 235, 1)",
            borderWidth: 2,
          },
          {
            label: "Rata-rata Angkatan",
            data: chartDataCohort,
            backgroundColor: "rgba(255, 99, 132, 0.2)",
            borderColor: "rgba(255, 99, 132, 1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        scales: { r: { beginAtZero: true, max: 100 } },
        plugins: { legend: { position: "top" } },
      },
    });
  }

  // Only show the modal if we are NOT in a custom target element
  if (
    targetElementId === "participantDetailModalBody" &&
    participantDetailModal
  ) {
    participantDetailModal.show();
  }
}
function printParticipantResult(pesertaId) {
  const p = getFromStorage("peserta").find((item) => item.id === pesertaId);
  if (!p) return;
  const allScores = getFromStorage("scores").filter(
    (s) => s.pesertaId === pesertaId,
  );
  const stations = getFromStorage("stations");
  const penguji = getFromStorage("penguji");
  const globalPerfMap = {
    1: "Tidak Lulus",
    2: "Borderline",
    3: "Lulus",
    4: "Superior",
  };
  const settings = getFromStorage("osce_cert_settings") || {};
  const institutionName =
    settings.institutionName || "PROGRAM STUDI D3 KEPERAWATAN WAIKABUBAK";
  const brmPassingScores = calculateBrmPassingScores();
  const { weakStations, recommendations } =
    generateParticipantFeedback(pesertaId);
  let feedbackHtml = "";
  if (allScores.length > 0) {
    feedbackHtml = `<h3>Feedback & Rekomendasi</h3>`;
    if (weakStations.length === 0) {
      feedbackHtml +=
        "<p><strong>Selamat!</strong> Performa Anda konsisten dan baik di semua stasiun yang telah dinilai.</p>";
    } else {
      feedbackHtml +=
        "<p><strong>Station yang Perlu Ditingkatkan:</strong> " +
        weakStations.join(", ") +
        ".</p>";
      if (recommendations.length > 0) {
        feedbackHtml += "<p><strong>Rekomendasi Perbaikan:</strong></p><ul>";
        recommendations.forEach((rec) => {
          feedbackHtml += `<li>${rec}</li>`;
        });
        feedbackHtml += "</ul>";
      }
    }
  }
  let totalPercentageSum = 0;
  let completedStations = 0;
  let detailRows = "";
  allScores.forEach((score) => {
    const s = stations.find((st) => st.id === score.stationId);
    const u = penguji.find((uj) => uj.id === score.pengujiId);
    if (!s || !u) return;
    const { achieved, max, percentage } = calculateWeightedScore(score, s);
    const passingGrade = brmPassingScores[s.id] || s.passingGrade || 75;
    const statusLulus = percentage >= passingGrade ? "Lulus" : "Tidak Lulus";
    const globalPerfText = score.globalPerformance
      ? `${globalPerfMap[score.globalPerformance]} (${score.globalPerformance})`
      : "N/A";
    totalPercentageSum += percentage;
    completedStations++;
    detailRows += `<tr><td>${s.name}</td><td>${achieved} / ${max}</td><td>${percentage.toFixed(2)}%</td><td>${globalPerfText}</td><td>${statusLulus}</td><td>${score.komentar || "-"}</td></tr>`;
  });
  const averageScore =
    completedStations > 0
      ? (totalPercentageSum / completedStations).toFixed(2)
      : 0;
  const printContent = `<!DOCTYPE html><html lang="id"><head><title>Laporan Hasil Ujian - ${p.nama}</title><style>body{font-family:'Times New Roman',Times,serif;font-size:12pt;}.container{width:80%;margin:auto;}h1,h2,h3{text-align:center;}h1{font-size:16pt;margin-bottom:5px;}h2{font-size:14pt;font-weight:normal;margin-top:0;margin-bottom:20px;}h3{text-align:left;font-size:13pt;margin-top:1.5em;border-bottom:1px solid #ccc;padding-bottom:5px;}.info-table{width:100%;margin-bottom:20px;border:none;}.info-table td{padding:5px;border:none;}.results-table{width:100%;border-collapse:collapse;margin-top:1em;}.results-table th,.results-table td{border:1px solid black;padding:8px;text-align:left;}.results-table th{background-color:#f2f2f2;}ul{padding-left:20px;}@page{size:A4;margin:2cm;}</style></head><body><div class="container"><h1>LAPORAN HASIL UJIAN OSCE</h1><h2>${institutionName.toUpperCase()}</h2><hr><table class="info-table"><tr><td style="width:150px;"><strong>Nama Peserta</strong></td><td>: ${p.nama}</td></tr><tr><td><strong>NIM</strong></td><td>: ${p.nim}</td></tr><tr><td><strong>Nilai Rata-rata</strong></td><td>: <strong>${averageScore}%</strong></td></tr><tr><td><strong>Jumlah Station</strong></td><td>: ${completedStations} / ${stations.length}</td></tr></table><h3>Rincian Nilai per Station</h3><table class="results-table"><thead><tr><th>Nama Station</th><th>Skor (Berbobot)</th><th>Persentase</th><th>Global Perf.</th><th>Status</th><th>Komentar</th></tr></thead><tbody>${detailRows || `<tr><td colspan="6" style="text-align:center;">Belum ada data nilai.</td></tr>`}</tbody></table>${feedbackHtml}<div style="margin-top:50px;text-align:right;"><p>${settings.certCity || "Waikabubak"}, ${new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })}</p><br><br><br><p>(........................................)</p><p>Koordinator Ujian</p></div></div></body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

// =================================================================
// CERTIFICATE MANAGEMENT
// =================================================================
const CERT_SETTINGS_KEY = "osce_cert_settings";
function loadCertificateSettingsPage() {
  const settings = getFromStorage(CERT_SETTINGS_KEY) || {};
  document.getElementById("cert-institution-name").value =
    settings.institutionName ||
    "Program Studi D3 Keperawatan Waikabubak, Poltekkes Kemenkes Kupang";
  document.getElementById("cert-format").value =
    settings.certFormat || "UN/KEP-WKB/X/2025";
  document.getElementById("cert-start-number").value =
    settings.startNumber || 1;
  document.getElementById("cert-exam-date").value =
    settings.examDate || "25 - 26 Oktober 2025";
  document.getElementById("cert-venue").value =
    settings.venue || "Kampus Poltekkes Prodi Keperawatan Waikabubak";
  document.getElementById("cert-city").value =
    settings.certCity || "Waikabubak";
  document.getElementById("cert-date").value =
    settings.certDate || new Date().toISOString().slice(0, 10);
  document.getElementById("cert-signature-person").value =
    settings.signaturePerson || "kaprodi";
  document.getElementById("cert-kaprodi-name").value =
    settings.kaprodiName || "";
  document.getElementById("cert-kaprodi-title").value =
    settings.kaprodiTitle || "Ketua Program Studi";
  document.getElementById("cert-kaprodi-nip").value = settings.kaprodiNip || "";
  document.getElementById("cert-koordinator-name").value =
    settings.koordinatorName || "";
  document.getElementById("cert-koordinator-title").value =
    settings.koordinatorTitle || "Koordinator OSCE";
  document.getElementById("cert-koordinator-nip").value =
    settings.koordinatorNip || "";
  const previewImg = document.getElementById("cert-signature-preview");
  const placeholder = document.getElementById("cert-signature-placeholder");
  const clearBtn = document.getElementById("cert-clear-signature");
  if (settings.signatureImage) {
    previewImg.src = settings.signatureImage;
    previewImg.style.display = "block";
    placeholder.style.display = "none";
    clearBtn.classList.remove("d-none");
  } else {
    previewImg.src = "";
    previewImg.style.display = "none";
    placeholder.style.display = "block";
    clearBtn.classList.add("d-none");
  }
  const bgPreviewImg = document.getElementById("cert-background-preview");
  const bgPlaceholder = document.getElementById("cert-background-placeholder");
  const bgClearBtn = document.getElementById("cert-clear-background");
  if (settings.backgroundImage) {
    bgPreviewImg.src = settings.backgroundImage;
    bgPreviewImg.style.display = "block";
    bgPlaceholder.style.display = "none";
    bgClearBtn.classList.remove("d-none");
  } else {
    bgPreviewImg.src = "";
    bgPreviewImg.style.display = "none";
    bgPlaceholder.style.display = "block";
    bgClearBtn.classList.add("d-none");
  }
}
async function saveCertificateSettings(e) {
  e.preventDefault();
  const submitButton = e.target.querySelector('button[type="submit"]');
  const originalButtonHTML = submitButton.innerHTML;

  submitButton.disabled = true;
  submitButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Menyimpan...`;

  const signatureImageSrc = document.getElementById(
    "cert-signature-preview",
  ).src;
  const backgroundImageSrc = document.getElementById(
    "cert-background-preview",
  ).src;

  const settings = {
    institutionName: document.getElementById("cert-institution-name").value,
    certFormat: document.getElementById("cert-format").value,
    startNumber: parseInt(document.getElementById("cert-start-number").value),
    examDate: document.getElementById("cert-exam-date").value,
    venue: document.getElementById("cert-venue").value,
    certCity: document.getElementById("cert-city").value,
    certDate: document.getElementById("cert-date").value,
    signaturePerson: document.getElementById("cert-signature-person").value,
    signatureImage: signatureImageSrc.startsWith("data:image")
      ? signatureImageSrc
      : signatureImageSrc === window.location.href
        ? null
        : signatureImageSrc,
    backgroundImage: backgroundImageSrc.startsWith("data:image")
      ? backgroundImageSrc
      : backgroundImageSrc === window.location.href
        ? null
        : backgroundImageSrc,
    kaprodiName: document.getElementById("cert-kaprodi-name").value,
    kaprodiTitle: document.getElementById("cert-kaprodi-title").value,
    kaprodiNip: document.getElementById("cert-kaprodi-nip").value,
    koordinatorName: document.getElementById("cert-koordinator-name").value,
    koordinatorTitle: document.getElementById("cert-koordinator-title").value,
    koordinatorNip: document.getElementById("cert-koordinator-nip").value,
  };

  saveToStorage(CERT_SETTINGS_KEY, settings);

  try {
    const { error } = await supabaseClient.from("config").upsert(
      {
        key: "certSettings",
        value: settings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) throw error;
    alert("Pengaturan sertifikat berhasil disimpan dan disinkronkan!");
    logActivity("UPDATE_CERT_SETTINGS");
  } catch (error) {
    console.error("Gagal sinkronisasi pengaturan ke Supabase:", error);
    alert(
      "Pengaturan disimpan secara LOKAL, tetapi gagal dikirim ke server. Data akan disinkronkan manual nanti.",
    );
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = originalButtonHTML;
  }
}
function previewCertificateSignature(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const previewImg = document.getElementById("cert-signature-preview");
    const placeholder = document.getElementById("cert-signature-placeholder");
    const clearBtn = document.getElementById("cert-clear-signature");
    previewImg.src = e.target.result;
    previewImg.style.display = "block";
    placeholder.style.display = "none";
    clearBtn.classList.remove("d-none");
  };
  reader.readAsDataURL(file);
}
function clearCertificateSignature() {
  document.getElementById("cert-signature-file").value = "";
  const previewImg = document.getElementById("cert-signature-preview");
  const placeholder = document.getElementById("cert-signature-placeholder");
  const clearBtn = document.getElementById("cert-clear-signature");
  previewImg.src = "";
  previewImg.style.display = "none";
  placeholder.style.display = "block";
  clearBtn.classList.add("d-none");
}
function previewCertificateBackground(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    const previewImg = document.getElementById("cert-background-preview");
    const placeholder = document.getElementById("cert-background-placeholder");
    const clearBtn = document.getElementById("cert-clear-background");
    previewImg.src = e.target.result;
    previewImg.style.display = "block";
    placeholder.style.display = "none";
    clearBtn.classList.remove("d-none");
  };
  reader.readAsDataURL(file);
}
function clearCertificateBackground() {
  document.getElementById("cert-background-file").value = "";
  const previewImg = document.getElementById("cert-background-preview");
  const placeholder = document.getElementById("cert-background-placeholder");
  const clearBtn = document.getElementById("cert-clear-background");
  previewImg.src = "";
  previewImg.style.display = "none";
  placeholder.style.display = "block";
  clearBtn.classList.add("d-none");
}
function loadCertificatePrintPage() {
  const collectivePassingGrade =
    getFromStorage("osce_collective_passing_grade") || 75;
  const peserta = getFromStorage("peserta").sort((a, b) =>
    a.nama.localeCompare(b.nama),
  );
  const scores = getFromStorage("scores");
  const stations = getFromStorage("stations");
  const tableBody = document.getElementById("table-sertifikat-body");
  tableBody.innerHTML = "";
  const excludedStationIds = getFromStorage("osce_excluded_stations") || [];
  if (peserta.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted p-4">Belum ada data peserta.</td></tr>`;
    return;
  }
  peserta.forEach((p) => {
    const participantScores = scores.filter((s) => s.pesertaId === p.id);
    const validScores = participantScores.filter(
      (s) => !excludedStationIds.includes(s.stationId),
    );
    let averageScore = 0;
    let statusLulus = '<span class="badge bg-secondary">Belum Ujian</span>';
    let progressHtml = "N/A";
    if (validScores.length > 0) {
      let totalPercentageSum = 0;
      validScores.forEach((score) => {
        const station = stations.find((s) => s.id === score.stationId);
        if (station) {
          const { percentage } = calculateWeightedScore(score, station);
          totalPercentageSum += percentage;
        }
      });
      averageScore = totalPercentageSum / validScores.length;
      statusLulus =
        averageScore >= collectivePassingGrade
          ? '<span class="badge bg-success fs-6">Lulus</span>'
          : '<span class="badge bg-danger fs-6">Tidak Lulus</span>';
      progressHtml = `<div class="progress" role="progressbar" style="height:22px;font-size:0.9rem;"><div class="progress-bar ${averageScore >= collectivePassingGrade ? "bg-success" : "bg-danger"}" style="width:${averageScore.toFixed(1)}%;" aria-valuenow="${averageScore.toFixed(1)}" aria-valuemin="0" aria-valuemax="100">${averageScore.toFixed(2)}%</div></div>`;
    }
    tableBody.innerHTML += `<tr><td>${p.nim}</td><td><strong>${p.nama}</strong></td><td class="text-center">${progressHtml}</td><td class="text-center">${statusLulus}</td><td class="text-center"><button class="btn btn-sm btn-primary" onclick="printCertificate(${p.id})"><i class="fas fa-print"></i> Cetak Sertifikat</button></td></tr>`;
  });
}
function printCertificate(pesertaId) {
  const settings = getFromStorage(CERT_SETTINGS_KEY);
  if (!settings || !settings.certFormat)
    return alert(
      "Pengaturan sertifikat belum diatur. Silakan atur di menu 'Pengaturan' terlebih dahulu.",
    );
  const allPeserta = getFromStorage("peserta").sort((a, b) =>
    a.nama.localeCompare(b.nama),
  );
  const p = allPeserta.find((item) => item.id === pesertaId);
  if (!p) return;
  const participantIndex = allPeserta.findIndex(
    (item) => item.id === pesertaId,
  );
  const certNumber = (settings.startNumber || 1) + participantIndex;
  const formattedCertNumber =
    String(certNumber).padStart(3, "0") + "/" + settings.certFormat;
  const formattedCertDate = new Date(settings.certDate).toLocaleDateString(
    "id-ID",
    { day: "numeric", month: "long", year: "numeric" },
  );
  let signatoryName, signatoryTitle, signatoryId;
  if (settings.signaturePerson === "koordinator") {
    signatoryName = settings.koordinatorName || "Koordinator OSCE";
    signatoryTitle = settings.koordinatorTitle || "Koordinator OSCE";
    signatoryId = settings.koordinatorNip
      ? `NIP. ${settings.koordinatorNip}`
      : "";
  } else {
    signatoryName = settings.kaprodiName || "Ketua Program Studi";
    signatoryTitle =
      settings.kaprodiTitle ||
      `Ketua ${settings.institutionName || "Program Studi"}`;
    signatoryId = settings.kaprodiNip ? `NIP. ${settings.kaprodiNip}` : "";
  }
  let signatureElement = '<div class="signature-space"></div>';
  if (settings.signatureImage)
    signatureElement = `<div class="signature-image-container"><img src="${settings.signatureImage}" class="signature-image" alt="Tanda Tangan"></div>`;
  const backgroundStyle = settings.backgroundImage
    ? `url('${settings.backgroundImage}')`
    : `url('')`;
  const printContent = `<!DOCTYPE html><html lang="id"><head><title>Sertifikat - ${p.nama}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Tinos:wght@400;700&display=swap" rel="stylesheet"><style>body{font-family:'Tinos',serif;color:#333;margin:0;}@page{size:A4 landscape;margin:0;}.certificate-container{width:297mm;height:210mm;box-sizing:border-box;position:relative;background-image:${backgroundStyle};background-size:cover;background-position:center;background-repeat:no-repeat;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.content-block{position:absolute;top:50%;left:50%;transform:translate(-50%,-60%);width:90%;}h1{font-family:'Merriweather',serif;font-size:42pt;color:#1a335f;margin:0;text-transform:uppercase;}.cert-number{font-size:11pt;margin-top:5px;margin-bottom:15px;letter-spacing:1px;}.given-to{font-size:14pt;margin:0 0 5px 0;}.participant-name{font-family:'Merriweather',serif;font-size:30pt;font-weight:700;color:#b9863c;margin:5px 0 20px 0;}.main-text{font-size:13pt;line-height:1.6;max-width:75%;margin:10px auto;}.footer{position:absolute;bottom:90px;right:140px;width:350px;}.signature-block{text-align:center;width:100%;}.signature-block p{margin:0;line-height:1.5;font-size:12pt;}.signature-block .signatory-title{margin-top:8px;}.signature-space{height:75px;}.signature-image-container{height:75px;display:flex;align-items:center;justify-content:center;margin-bottom:5px;}.signature-image{max-height:100%;max-width:200px;height:auto;}.signature-line{width:80%;margin:2px auto 0 auto;border-bottom:1px solid #333;}.official-id{font-size:11pt;}</style></head><body><div class="certificate-container"><div class="content-block"><h1>Sertifikat</h1><p class="cert-number">Nomor: ${formattedCertNumber}</p><p class="given-to">Diberikan kepada:</p><p class="participant-name">${p.nama.toUpperCase()}</p><p class="main-text">Sebagai <strong>Peserta</strong> dalam kegiatan Objective Structured Clinical Examination (OSCE) yang diselenggarakan oleh <strong>${settings.institutionName || "Program Studi D3 Keperawatan Waikabubak"}</strong> pada tanggal <strong>${settings.examDate}</strong>.</p></div><div class="footer"><div class="signature-block"><p>${settings.certCity}, ${formattedCertDate}</p><p class="signatory-title">${signatoryTitle}</p>${signatureElement}<p><strong>${signatoryName}</strong></p><p class="signature-line"></p><p class="official-id">${signatoryId}</p></div></div></div></body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}
function loadPengujiCertificatePage() {
  const penguji = getFromStorage("penguji");
  const stations = getFromStorage("stations");
  const tableBody = document.getElementById("table-sertifikat-penguji-body");
  tableBody.innerHTML = "";
  if (penguji.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Belum ada data penguji.</td></tr>`;
    return;
  }
  penguji
    .sort((a, b) => a.nama.localeCompare(b.nama))
    .forEach((p) => {
      const assignedStation = stations.find(
        (s) => s.id === p.assignedStationId,
      );
      const stationName = assignedStation
        ? assignedStation.name
        : '<span class="text-muted fst-italic">Tidak Ditugaskan</span>';
      tableBody.innerHTML += `<tr><td>${p.idPenguji}</td><td><strong>${p.nama}</strong></td><td>${stationName}</td><td class="text-center"><button class="btn btn-sm btn-primary" onclick="printPengujiCertificate(${p.id})"><i class="fas fa-print"></i> Cetak Sertifikat</button></td></tr>`;
    });
}
function generatePengujiCertificateHTML(pengujiId, allPengujiSorted) {
  const settings = getFromStorage(CERT_SETTINGS_KEY);
  if (!settings || !settings.certFormat) return null;
  const p = allPengujiSorted.find((item) => item.id === pengujiId);
  if (!p) return null;
  const pengujiIndex = allPengujiSorted.findIndex(
    (item) => item.id === pengujiId,
  );
  const certNumber = (settings.startNumber || 1) + pengujiIndex;
  const formattedCertNumber =
    String(certNumber).padStart(3, "0") + "/PENGUJI/" + settings.certFormat;
  const formattedCertDate = new Date(settings.certDate).toLocaleDateString(
    "id-ID",
    { day: "numeric", month: "long", year: "numeric" },
  );
  let signatoryName, signatoryTitle, signatoryId;
  if (settings.signaturePerson === "koordinator") {
    signatoryName = settings.koordinatorName || "Koordinator OSCE";
    signatoryTitle = settings.koordinatorTitle || "Koordinator OSCE";
    signatoryId = settings.koordinatorNip
      ? `NIP. ${settings.koordinatorNip}`
      : "";
  } else {
    signatoryName = settings.kaprodiName || "Ketua Program Studi";
    signatoryTitle =
      settings.kaprodiTitle ||
      `Ketua ${settings.institutionName || "Program Studi"}`;
    signatoryId = settings.kaprodiNip ? `NIP. ${settings.kaprodiNip}` : "";
  }
  let signatureElement = '<div class="signature-space"></div>';
  if (settings.signatureImage)
    signatureElement = `<div class="signature-image-container"><img src="${settings.signatureImage}" class="signature-image" alt="Tanda Tangan"></div>`;
  const backgroundStyle = settings.backgroundImage
    ? `url('${settings.backgroundImage}')`
    : `url('')`;
  return `<div class="certificate-container" style="background-image: ${backgroundStyle};"><div class="content-block"><h1>Sertifikat</h1><p class="cert-number">Nomor: ${formattedCertNumber}</p><p class="given-to">Diberikan kepada:</p><p class="participant-name">${p.nama.toUpperCase()}</p><p class="main-text">Sebagai <strong>Penguji</strong> dalam kegiatan Objective Structured Clinical Examination (OSCE) yang diselenggarakan oleh <strong>${settings.institutionName || "Program Studi D3 Keperawatan Waikabubak"}</strong> pada tanggal <strong>${settings.examDate}</strong>.</p></div><div class="footer"><div class="signature-block"><p>${settings.certCity}, ${formattedCertDate}</p><p class="signatory-title">${signatoryTitle}</p>${signatureElement}<p><strong>${signatoryName}</strong></p><p class="signature-line"></p><p class="official-id">${signatoryId}</p></div></div></div>`;
}
function printPengujiCertificate(pengujiId) {
  const settings = getFromStorage(CERT_SETTINGS_KEY);
  if (!settings || !settings.certFormat)
    return alert(
      "Pengaturan sertifikat belum diatur. Silakan atur di menu 'Pengaturan' terlebih dahulu.",
    );
  const allPenguji = getFromStorage("penguji").sort((a, b) =>
    a.nama.localeCompare(b.nama),
  );
  const p = allPenguji.find((item) => item.id === pengujiId);
  if (!p) return alert("Data penguji tidak ditemukan.");
  const certBodyHTML = generatePengujiCertificateHTML(pengujiId, allPenguji);
  if (!certBodyHTML) return;
  const printContent = `<!DOCTYPE html><html lang="id"><head><title>Sertifikat Penguji - ${p.nama}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Tinos:wght@400;700&display=swap" rel="stylesheet"><style>body{font-family:'Tinos',serif;color:#333;margin:0;}@page{size:A4 landscape;margin:0;}.certificate-container{width:297mm;height:210mm;box-sizing:border-box;position:relative;background-size:cover;background-position:center;background-repeat:no-repeat;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.content-block{position:absolute;top:50%;left:50%;transform:translate(-50%,-60%);width:90%;}h1{font-family:'Merriweather',serif;font-size:42pt;color:#1a335f;margin:0;text-transform:uppercase;}.cert-number{font-size:11pt;margin-top:5px;margin-bottom:15px;letter-spacing:1px;}.given-to{font-size:14pt;margin:0 0 5px 0;}.participant-name{font-family:'Merriweather',serif;font-size:30pt;font-weight:700;color:#b9863c;margin:5px 0 20px 0;}.main-text{font-size:13pt;line-height:1.6;max-width:75%;margin:10px auto;}.footer{position:absolute;bottom:90px;right:140px;width:350px;}.signature-block{text-align:center;width:100%;}.signature-block p{margin:0;line-height:1.5;font-size:12pt;}.signature-block .signatory-title{margin-top:8px;}.signature-space{height:75px;}.signature-image-container{height:75px;display:flex;align-items:center;justify-content:center;margin-bottom:5px;}.signature-image{max-height:100%;max-width:200px;height:auto;}.signature-line{width:80%;margin:2px auto 0 auto;border-bottom:1px solid #333;}.official-id{font-size:11pt;}</style></head><body>${certBodyHTML}</body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}
function printAllPengujiCertificates() {
  const allPenguji = getFromStorage("penguji").sort((a, b) =>
    a.nama.localeCompare(b.nama),
  );
  if (allPenguji.length === 0)
    return alert("Tidak ada data penguji untuk dicetak.");
  const settings = getFromStorage(CERT_SETTINGS_KEY);
  if (!settings || !settings.certFormat)
    return alert(
      "Pengaturan sertifikat belum diatur. Silakan atur di menu 'Pengaturan' terlebih dahulu.",
    );
  if (
    !confirm(
      `Anda akan mencetak sertifikat untuk ${allPenguji.length} penguji. Lanjutkan?`,
    )
  )
    return;
  let allCertsHTML = "";
  allPenguji.forEach((p) => {
    const certHtml = generatePengujiCertificateHTML(p.id, allPenguji);
    if (certHtml) allCertsHTML += certHtml;
  });
  if (!allCertsHTML)
    return alert("Gagal membuat sertifikat. Periksa pengaturan umum.");
  const printContent = `<!DOCTYPE html><html lang="id"><head><title>Sertifikat Penguji OSCE</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Tinos:wght@400;700&display=swap" rel="stylesheet"><style>body{font-family:'Tinos',serif;color:#333;margin:0;}@page{size:A4 landscape;margin:0;}.certificate-container{width:297mm;height:210mm;box-sizing:border-box;position:relative;background-size:cover;background-position:center;background-repeat:no-repeat;text-align:center;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-after:always;}.certificate-container:last-child{page-break-after:auto;}.content-block{position:absolute;top:50%;left:50%;transform:translate(-50%,-60%);width:90%;}h1{font-family:'Merriweather',serif;font-size:42pt;color:#1a335f;margin:0;text-transform:uppercase;}.cert-number{font-size:11pt;margin-top:5px;margin-bottom:15px;letter-spacing:1px;}.given-to{font-size:14pt;margin:0 0 5px 0;}.participant-name{font-family:'Merriweather',serif;font-size:30pt;font-weight:700;color:#b9863c;margin:5px 0 20px 0;}.main-text{font-size:13pt;line-height:1.6;max-width:75%;margin:10px auto;}.footer{position:absolute;bottom:90px;right:140px;width:350px;}.signature-block{text-align:center;width:100%;}.signature-block p{margin:0;line-height:1.5;font-size:12pt;}.signature-block .signatory-title{margin-top:8px;}.signature-space{height:75px;}.signature-image-container{height:75px;display:flex;align-items:center;justify-content:center;margin-bottom:5px;}.signature-image{max-height:100%;max-width:200px;height:auto;}.signature-line{width:80%;margin:2px auto 0 auto;border-bottom:1px solid #333;}.official-id{font-size:11pt;}</style></head><body>${allCertsHTML}</body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

// =================================================================
// SYSTEM LOGGING
// =================================================================
const LOG_KEY = "osce_system_log";
const MAX_LOG_ENTRIES = 500;
function logActivity(action, details = "", userOverride = null) {
  try {
    let logs = getFromStorage(LOG_KEY) || [];
    const userSession = sessionStorage.getItem("osce_user");
    const user = userOverride
      ? { name: userOverride }
      : userSession
        ? JSON.parse(userSession)
        : null;
    const userName = user ? user.name || user.role : "Sistem";
    const logEntry = {
      timestamp: new Date().toISOString(),
      user: userName,
      action: action,
      details: details,
    };
    logs.unshift(logEntry);
    if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;
    saveToStorage(LOG_KEY, logs);
  } catch (error) {
    console.error("Gagal menulis log:", error);
  }
}
function loadSystemLog() {
  const logContainer = document.getElementById("log-container");
  if (!logContainer) return;
  const logs = getFromStorage(LOG_KEY) || [];
  if (logs.length === 0) {
    logContainer.innerHTML =
      '<a href="#" class="list-group-item list-group-item-action disabled text-center text-muted">Belum ada aktivitas yang tercatat.</a>';
    return;
  }
  const logIconMap = {
    CREATE: { icon: "fa-plus-circle", color: "text-success" },
    UPDATE: { icon: "fa-edit", color: "text-warning" },
    DELETE: { icon: "fa-trash-alt", color: "text-danger" },
    LOGIN: { icon: "fa-sign-in-alt", color: "text-success" },
    LOGOUT: { icon: "fa-sign-out-alt", color: "text-danger" },
    SYNC: { icon: "fa-sync-alt", color: "text-info" },
    BACKUP: { icon: "fa-download", color: "text-dark" },
    RESTORE: { icon: "fa-upload", color: "text-primary" },
    SUBMIT_SCORE: { icon: "fa-save", color: "text-primary" },
    SCHEDULE: { icon: "fa-calendar-alt", color: "text-secondary" },
    CLEAR: { icon: "fa-eraser", color: "text-danger" },
  };
  logContainer.innerHTML = logs
    .map((log) => {
      const actionPrefix = log.action.split("_")[0];
      const iconInfo = logIconMap[actionPrefix] || {
        icon: "fa-info-circle",
        color: "text-muted",
      };
      const formattedDate = new Date(log.timestamp).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return `<div class="list-group-item list-group-item-action"><div class="d-flex w-100 justify-content-between"><h6 class="mb-1 ${iconInfo.color}"><i class="fas ${iconInfo.icon} fa-fw me-2"></i>${log.action.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</h6><small class="text-muted">${formattedDate}</small></div><p class="mb-1 small">${log.details || "Tidak ada detail."}</p><small class="text-muted">Oleh: <strong>${log.user}</strong></small></div>`;
    })
    .join("");
}
function clearSystemLog() {
  if (
    !confirm(
      "Anda yakin ingin menghapus semua catatan log? Tindakan ini tidak dapat diurungkan.",
    )
  )
    return;
  saveToStorage(LOG_KEY, []);
  logActivity("CLEAR_LOG", "Semua log telah dibersihkan.");
  loadSystemLog();
  alert("Log sistem berhasil dibersihkan.");
}

// =================================================================
// BACKUP, RESTORE, IMPORT, EXPORT
// =================================================================
function backupLocalData() {
  const dataToBackup = {
    peserta: getFromStorage("peserta"),
    penguji: getFromStorage("penguji"),
    stations: getFromStorage("stations"),
    scores: getFromStorage("scores"),
    scheduleParams: getFromStorage("osce_schedule_params"),
    feedback: getFromStorage("feedback"),
    systemLog: getFromStorage(LOG_KEY),
    certSettings: getFromStorage(CERT_SETTINGS_KEY),
    backupDate: new Date().toISOString(),
  };
  const jsonString = JSON.stringify(dataToBackup, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `osce_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  logActivity("BACKUP_DATA");
  alert("Backup berhasil diunduh!");
}
function handleRestoreFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (
    !confirm(
      "Ini akan MENIMPA semua data lokal saat ini dengan data dari file backup. Anda yakin?",
    )
  ) {
    event.target.value = null;
    return;
  }
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data.peserta && data.penguji && data.stations && data.scores) {
        saveToStorage("peserta", data.peserta);
        saveToStorage("penguji", data.penguji);
        saveToStorage("stations", data.stations);
        saveToStorage("scores", data.scores);
        saveToStorage("osce_schedule_params", data.scheduleParams || {});
        saveToStorage("feedback", data.feedback || []);
        saveToStorage(CERT_SETTINGS_KEY, data.certSettings || {});
        if (data.systemLog) saveToStorage(LOG_KEY, data.systemLog);
        logActivity("RESTORE_DATA", `Data dipulihkan dari file: ${file.name}`);
        alert("Data berhasil dipulihkan dari file backup!");
        loadPageContent(document.querySelector(".page.active").id);
      } else {
        alert("File backup tidak valid atau formatnya salah.");
      }
    } catch (error) {
      alert("Gagal membaca file backup. Error: " + error.message);
    } finally {
      event.target.value = null;
    }
  };
  reader.readAsText(file);
}
async function importCSV(type, event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    const rows = text.trim().split("\n").slice(1);
    if (rows.length === 0) return alert("File CSV kosong atau tidak ada data.");
    let existingData = getFromStorage(type);
    const keyField = type === "peserta" ? "nim" : "idPenguji";
    let newItems = [];
    let duplicates = 0;
    rows.forEach((row) => {
      const cols = row.split(",").map((s) => s.trim().replace(/"/g, ""));
      if (cols.length < 2 || !cols[0] || !cols[1]) return;
      const idValue = cols[0];
      const nameValue = cols[1];
      if (!existingData.some((item) => item[keyField] == idValue)) {
        const newItem = { id: Date.now() + newItems.length, nama: nameValue };
        newItem[keyField] = idValue;
        if (type === "peserta") {
          newItem.sesi = null;
          newItem.password =
            cols.length >= 3 && cols[2] ? cols[2].trim() : idValue;
        }
        if (type === "penguji" && cols.length >= 3 && cols[2]) {
          const stationName = cols[2].trim();
          const stations = getFromStorage("stations");
          const station = stations.find(
            (s) => s.name.toLowerCase() === stationName.toLowerCase(),
          );
          if (station) newItem.assignedStationId = station.id;
        }
        newItems.push(newItem);
      } else {
        duplicates++;
      }
    });
    if (newItems.length > 0) {
      if (
        confirm(
          `${newItems.length} data baru akan diimpor (Otomatis Sync). ${duplicates} duplikat dilewati. Lanjutkan?`,
        )
      ) {
        saveToStorage(type, [...existingData, ...newItems]);

        // Background Bulk Sync
        Promise.all(newItems.map((item) => syncAction(type, item)));
        if (type === "peserta" || type === "penguji") {
          Promise.all(
            newItems.map((item) =>
              syncAction("credentials", {
                username: item[keyField],
                password: item.password || item[keyField],
                role: type,
              }),
            ),
          );
        }
        logActivity(
          `IMPORT_${type.toUpperCase()}`,
          `${newItems.length} data baru diimpor dari CSV.`,
        );
        alert(`Impor berhasil! ${newItems.length} data baru ditambahkan.`);
        if (type === "peserta") loadPeserta();
        if (type === "penguji") loadPenguji();
      }
    } else {
      alert(
        `Tidak ada data baru untuk diimpor. ${duplicates} data duplikat ditemukan dan dilewati.`,
      );
    }
    event.target.value = null;
  };
  reader.readAsText(file);
}
function triggerFileUpload(inputId) {
  document.getElementById(inputId).click();
}
function downloadParticipantTemplate() {
  const csvContent =
    "data:text/csv;charset=utf-8,NIM,Nama Lengkap,Password (Opsional)\n2021001,Budi Santoso,password123\n2021002,Siti Aminah,";
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "template_peserta_osce.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadPengujiTemplate() {
  const csvContent =
    "data:text/csv;charset=utf-8,ID Penguji (Username),Nama Lengkap,Nama Stasiun (Opsional)\ndosen01,Dr. John Doe,Medikal Bedah\ndosen02,Dr. Jane Smith,Maternitas";
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "template_penguji_osce.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
function exportToCSV() {
  const scores = getFromStorage("scores");
  if (scores.length === 0) return alert("Tidak ada data untuk diekspor.");
  const peserta = getFromStorage("peserta");
  const penguji = getFromStorage("penguji");
  const stations = getFromStorage("stations");
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent +=
    "NIM,Nama Peserta,Station,Nama Penguji,Total Skor (Berbobot),Skor Maksimum (Berbobot),Persentase,Status Kelulusan,Global Performance,Komentar,Rincian Skor (Kriteria:Skor:Bobot)\n";
  scores.forEach((score) => {
    const p = peserta.find((p) => p.id === score.pesertaId);
    const u = penguji.find((u) => u.id === score.pengujiId);
    const s = stations.find((s) => s.id === score.stationId);
    if (!p || !u || !s) return;
    const { achieved, max, percentage } = calculateWeightedScore(score, s);
    const passingGrade = s.passingGrade || 75;
    const statusLulus = percentage >= passingGrade ? "Lulus" : "Tidak Lulus";
    const rincianSkor = score.scores
      .map((item) => {
        const rubricItem = s.rubric.find((r) => r.id === item.rubricId);
        const criteriaText = rubricItem
          ? rubricItem.criteria.replace(/,/g, "")
          : "N/A";
        const bobot = rubricItem ? rubricItem.bobot || 1 : 1;
        return `${criteriaText}:${item.score}:${bobot}`;
      })
      .join("; ");
    const row = [
      p.nim,
      `"${p.nama}"`,
      `"${s.name}"`,
      `"${u.nama}"`,
      achieved,
      max,
      `${percentage.toFixed(2)}%`,
      statusLulus,
      score.globalPerformance || "N/A",
      `"${(score.komentar || "").replace(/"/g, '""')}"`,
      `"${rincianSkor}"`,
    ].join(",");
    csvContent += row + "\n";
  });
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute(
    "download",
    `hasil_ujian_osce_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
// =================================================================
// DATA CLEANUP & DELETION (REVISED FOR FEEDBACK)
// =================================================================
async function deleteItem(key, id, callback) {
  if (!confirm("Yakin ingin menghapus item ini?")) return;
  let data = getFromStorage(key);
  const itemToDelete = data.find((item) => item.id === id);
  if (itemToDelete) {
    const detail = itemToDelete.nama || itemToDelete.nim || `ID ${id}`;
    logActivity(`DELETE_${key.toUpperCase()}`, `Item: ${detail} (Otomatis)`);
  }
  data = data.filter((item) => item.id !== id);
  saveToStorage(key, data);
  // Realtime Delete from Supabase
  syncAction(key, { id: id }, "delete");

  cleanupRelatedData(key, id);
  callback();
  // Refresh results
  if (document.getElementById("page-hasil").classList.contains("active")) {
    const avgGpr100Value = renderGlobalPerformanceAnalysis();
    loadCollectiveResults(avgGpr100Value);
    displayStationRankings();
    renderStationAnalyticsChart();
    renderRubricPerformanceChart();
    renderRubricDifficultyChart();
    renderSessionComparisonChart();
    renderScoreVsGprChart();
    loadRemedialRecommendations();
  }
}
async function cleanupRelatedData(masterKey, masterId) {
  let scores = getFromStorage("scores");
  let feedback = getFromStorage("feedback");
  const relationMap = {
    peserta: "pesertaId",
    penguji: "pengujiId",
    stations: "stationId",
  };

  try {
    if (relationMap[masterKey]) {
      const field = relationMap[masterKey];
      // Sync delete from Supabase first
      await supabaseClient.from("scores").delete().eq(field, masterId);

      // Update local storage
      scores = scores.filter((score) => score[field] !== masterId);
      saveToStorage("scores", scores);
    }

    if (masterKey === "peserta") {
      await supabaseClient.from("feedback").delete().eq("pesertaId", masterId);
      feedback = feedback.filter((f) => f.pesertaId !== masterId);
      saveToStorage("feedback", feedback);
    }

    if (masterKey === "stations") {
      let penguji = getFromStorage("penguji");
      penguji.forEach((p) => {
        if (p.assignedStationId === masterId) p.assignedStationId = null;
      });
      saveToStorage("penguji", penguji);
      // Sync penguji updates (bulk)
      await Promise.all(
        penguji
          .filter((p) => p.assignedStationId === null)
          .map((p) => syncAction("penguji", p)),
      );

      // Feedback items are JSONB in Supabase usually? Or a relation?
      // In my previous refactor, feedback was its own table with participants.
      // If we have station feedback inside, we might need a more complex update.
      // But for now, ensuring participants and scores are clean is the priority.

      feedback.forEach((f) => {
        f.feedbackItems = f.feedbackItems.filter(
          (item) => item.stationId !== masterId,
        );
      });
      let filteredFeedback = feedback.filter((f) => f.feedbackItems.length > 0);
      saveToStorage("feedback", filteredFeedback);

      alert(
        "Jadwal sesi semua peserta mungkin perlu digenerate ulang jika stasiun ini adalah bagian dari rotasi.",
      );
    }
  } catch (e) {
    console.warn("[Cleanup] Gagal sinkronisasi relasi ke server:", e.message);
  }
}

// =================================================================
// PARTICIPANT PAGES (REVISED FOR ACCURATE PASSING STATUS)
// =================================================================
function loadPesertaDashboard() {
  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  if (!user || user.role !== "peserta") return;

  const allScores = getFromStorage("scores").filter(
    (s) => s.pesertaId === user.id,
  );
  const totalStations = getFromStorage("stations").length;
  const completedStations = allScores.length;

  document.getElementById("peserta-progress-station").textContent =
    `${completedStations}/${totalStations}`;

  // **REVISED LOGIC**: Use the saved collective passing grade for consistency
  const collectivePassingGrade =
    getFromStorage("osce_collective_passing_grade") || 75; // Fallback to 75
  const excludedStationIds = getFromStorage("osce_excluded_stations") || [];
  const validScores = allScores.filter(
    (s) => !excludedStationIds.includes(s.stationId),
  );

  const passingMethod = getFromStorage("osce_passing_method") || "percentage";
  const brmPassingScores =
    passingMethod === "gpr" ? calculateBrmPassingScores() : null;

  const avgScoreEl = document.getElementById("peserta-avg-score");
  const statusEl = document.getElementById("peserta-status");

  if (validScores.length > 0) {
    let totalPercentageSum = 0;
    let passedStationsCount = 0;

    validScores.forEach((score) => {
      const station = getFromStorage("stations").find(
        (s) => s.id === score.stationId,
      );
      if (station) {
        const { percentage } = calculateWeightedScore(score, station);
        totalPercentageSum += percentage;

        const stationPassingGrade = brmPassingScores
          ? brmPassingScores[score.stationId] || 75
          : station.passingGrade || 75;
        if (percentage >= stationPassingGrade) {
          passedStationsCount++;
        }
      }
    });

    const averageScore = totalPercentageSum / validScores.length;
    avgScoreEl.innerHTML = `${averageScore.toFixed(2)}<small>%</small>`;

    let isPassed = false;
    if (passingMethod === "gpr") {
      // Must pass ALL valid stations for GPR by default (matching admin dashboard)
      isPassed = passedStationsCount === validScores.length;
    } else {
      isPassed = averageScore >= collectivePassingGrade;
    }

    statusEl.textContent = isPassed ? "Lulus" : "Tidak Lulus";
    statusEl.parentElement.parentElement.parentElement.classList.remove(
      "border-warning",
      "border-success",
      "border-danger",
    );
    statusEl.parentElement.parentElement.parentElement.classList.add(
      isPassed ? "border-success" : "border-danger",
    );
  } else {
    avgScoreEl.textContent = "N/A";
    statusEl.textContent = "Belum Dinilai";
    statusEl.parentElement.parentElement.parentElement.classList.remove(
      "border-success",
      "border-danger",
    );
    statusEl.parentElement.parentElement.parentElement.classList.add(
      "border-warning",
    );
  }

  loadFeedbackFormForParticipant(user.id);
}

function loadPesertaHasil() {
  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  if (!user || user.role !== "peserta") return;

  const container = document.getElementById("peserta-hasil-content");
  const p = getFromStorage("peserta").find((item) => item.id === user.id);
  const allScores = getFromStorage("scores").filter(
    (s) => s.pesertaId === user.id,
  );
  const stations = getFromStorage("stations");

  if (allScores.length === 0) {
    container.innerHTML = `<div class="alert alert-info text-center"><i class="fas fa-clock me-2"></i>Hasil penilaian Anda akan muncul di sini setelah dinilai oleh penguji.</div>`;
    return;
  }

  const resultBody = document.createElement("div");
  resultBody.id = "pesertaHasilBody";
  container.innerHTML = "";
  container.appendChild(resultBody);

  showParticipantDetails(user.id, "pesertaHasilBody");
  if (participantDetailModal) participantDetailModal.hide();

  const modalFooter = resultBody.querySelector(".modal-footer");
  if (modalFooter) modalFooter.remove();

  const modalTitle = document.getElementById("participantDetailModalLabel");
  const displayTitle = document.createElement("h2");
  displayTitle.className = "mb-4";
  displayTitle.textContent = `Hasil & Umpan Balik Ujian Anda`;
  resultBody.prepend(displayTitle);
  // Remove the now-redundant button from the result body since it's a page now.
  const printBtnOnPage = resultBody.querySelector(
    "#print-participant-result-btn",
  );
  if (printBtnOnPage) {
    const newPrintButton = document.createElement("button");
    newPrintButton.className = "btn btn-primary mb-4 shadow-sm";
    newPrintButton.innerHTML =
      '<i class="fas fa-print"></i> Cetak Hasil Lengkap';
    newPrintButton.onclick = () => printParticipantResult(user.id);
    resultBody.insertBefore(newPrintButton, resultBody.querySelector(".row"));
    printBtnOnPage.remove();
  }
}

function loadPesertaSertifikat() {
  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  if (!user || user.role !== "peserta") return;

  const container = document.getElementById("peserta-sertifikat-content");
  const passingMethod = getFromStorage("osce_passing_method") || "percentage";
  const brmPassingScores =
    passingMethod === "gpr" ? calculateBrmPassingScores() : null;
  const allScores = getFromStorage("scores").filter(
    (s) => s.pesertaId === user.id,
  );
  const excludedStationIds = getFromStorage("osce_excluded_stations") || [];
  const validScores = allScores.filter(
    (s) => !excludedStationIds.includes(s.stationId),
  );

  const stations = getFromStorage("stations");
  const nonExcludedStations = stations.filter(
    (s) => !excludedStationIds.includes(s.id),
  );
  const collectivePassingGrade =
    getFromStorage("osce_collective_passing_grade") || 75;

  if (validScores.length < nonExcludedStations.length) {
    container.innerHTML = `<div class="p-5 text-center"><i class="fas fa-clock fa-3x text-info mb-3"></i><h4>Sertifikat Belum Tersedia</h4><p class="text-muted">Sertifikat akan dapat diakses setelah Anda menyelesaikan penilaian di seluruh stasiun wajib (${nonExcludedStations.length} stasiun).</p></div>`;
    return;
  }

  let totalPercentageSum = 0;
  let passedStationsCount = 0;
  validScores.forEach((score) => {
    const station = stations.find((s) => s.id === score.stationId);
    if (station) {
      const { percentage } = calculateWeightedScore(score, station);
      totalPercentageSum += percentage;
      const stationPassingGrade = brmPassingScores
        ? brmPassingScores[score.stationId] || 75
        : station.passingGrade || 75;
      if (percentage >= stationPassingGrade) {
        passedStationsCount++;
      }
    }
  });

  const averageScore = totalPercentageSum / (validScores.length || 1);
  let isPassed = false;

  if (passingMethod === "gpr") {
    // Kelulusan GPR: Wajib lulus seluruh stasiun (sinkron dengan dashboard)
    isPassed = passedStationsCount === validScores.length;
  } else {
    // Kelulusan Persentase: Rata-rata >= Batas Lulus Kolektif
    isPassed = averageScore >= collectivePassingGrade;
  }

  if (isPassed) {
    container.innerHTML = `<div class="p-5 text-center"><i class="fas fa-award fa-3x text-success mb-3"></i><h4>Selamat, Anda Lulus!</h4><p class="text-muted">Anda telah memenuhi kriteria kelulusan akademik. Silakan unduh sertifikat resmi Anda di bawah ini.</p><button class="btn btn-primary btn-lg mt-3 shadow" onclick="printCertificate(${user.id})"><i class="fas fa-download me-2"></i> Unduh Sertifikat Resmi</button></div>`;
  } else {
    container.innerHTML = `<div class="p-5 text-center"><i class="fas fa-exclamation-circle fa-3x text-danger mb-3"></i><h4>Sertifikat Tidak Tersedia</h4><p class="text-muted">Mohon maaf, sertifikat kelulusan hanya tersedia bagi peserta yang dinyatakan <strong>Lulus</strong> sesuai kriteria ujian.</p><div class="alert alert-warning mt-3">Silakan hubungi administrator program studi jika ada pertanyaan terkait hasil ujian Anda.</div></div>`;
  }
}

// =================================================================
// FEEDBACK SYSTEM
// =================================================================
function loadFeedbackFormForParticipant(pesertaId) {
  const container = document.getElementById("peserta-feedback-container");
  const allFeedback = getFromStorage("feedback");
  const hasSubmitted = allFeedback.some((f) => f.pesertaId === pesertaId);

  if (hasSubmitted) {
    container.innerHTML = `<div class="alert alert-success text-center"><i class="fas fa-check-circle me-2"></i>Terima kasih! Anda telah mengirimkan umpan balik.</div>`;
    return;
  }

  const scores = getFromStorage("scores").filter(
    (s) => s.pesertaId === pesertaId,
  );
  const REQUIRED_STATIONS_FOR_COMPLETION = 9;
  if (scores.length < REQUIRED_STATIONS_FOR_COMPLETION) {
    container.innerHTML = `<div class="alert alert-info text-center"><i class="fas fa-info-circle me-2"></i>Formulir umpan balik akan tersedia di sini setelah Anda menyelesaikan ujian.</div>`;
    return;
  }

  const stations = getFromStorage("stations");
  const attendedStationIds = new Set(scores.map((s) => s.stationId));
  let formHtml = `
        <div class="card border-primary">
            <div class="card-header bg-primary text-white"><i class="fas fa-comment-dots me-2"></i><strong>Umpan Balik Pasca Ujian</strong></div>
            <div class="card-body">
                <p>Ujian Anda telah selesai. Mohon berikan umpan balik Anda untuk setiap stasiun yang telah diikuti untuk membantu kami meningkatkan kualitas OSCE di masa mendatang.</p>
                <form id="form-submit-feedback">`;

  attendedStationIds.forEach((stationId) => {
    const station = stations.find((s) => s.id === stationId);
    if (station) {
      formHtml += `
                <div class="mb-4 p-3 border rounded">
                    <h6 class="fw-bold">${station.name}</h6>
                    <label class="form-label">Tingkat Kepuasan:</label>
                    <div class="star-rating mb-2">
                        <input type="radio" id="5-stars-${station.id}" name="rating-${station.id}" value="5" required/><label for="5-stars-${station.id}" class="star">★</label>
                        <input type="radio" id="4-stars-${station.id}" name="rating-${station.id}" value="4" /><label for="4-stars-${station.id}" class="star">★</label>
                        <input type="radio" id="3-stars-${station.id}" name="rating-${station.id}" value="3" /><label for="3-stars-${station.id}" class="star">★</label>
                        <input type="radio" id="2-stars-${station.id}" name="rating-${station.id}" value="2" /><label for="2-stars-${station.id}" class="star">★</label>
                        <input type="radio" id="1-star-${station.id}" name="rating-${station.id}" value="1" /><label for="1-star-${station.id}" class="star">★</label>
                    </div>
                    <label for="comment-${station.id}" class="form-label">Komentar/Saran (Opsional):</label>
                    <textarea id="comment-${station.id}" class="form-control form-control-sm" rows="2" placeholder="Masukkan komentar Anda untuk stasiun ini..."></textarea>
                </div>`;
    }
  });

  formHtml += `<button type="submit" class="btn btn-success w-100"><i class="fas fa-paper-plane me-2"></i>Kirim Umpan Balik</button></form></div></div>`;
  container.innerHTML = formHtml;
  document
    .getElementById("form-submit-feedback")
    .addEventListener("submit", submitFeedback);
}

async function submitFeedback(e) {
  e.preventDefault();
  const form = e.target;
  const submitButton = form.querySelector('button[type="submit"]');
  const originalButtonHTML = submitButton.innerHTML;

  submitButton.disabled = true;
  submitButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Menyimpan...`;

  const user = JSON.parse(sessionStorage.getItem("osce_user"));
  if (!user) {
    submitButton.disabled = false;
    submitButton.innerHTML = originalButtonHTML;
    return;
  }

  const feedbackItems = [];
  const scores = getFromStorage("scores").filter(
    (s) => s.pesertaId === user.id,
  );
  const attendedStationIds = new Set(scores.map((s) => s.stationId));

  let allRatingsFilled = true;
  attendedStationIds.forEach((stationId) => {
    const rating = form.querySelector(
      `input[name="rating-${stationId}"]:checked`,
    );
    const comment = form.querySelector(`#comment-${stationId}`).value.trim();
    if (rating) {
      feedbackItems.push({
        stationId: parseInt(stationId),
        rating: parseInt(rating.value),
        comment: comment,
      });
    } else {
      allRatingsFilled = false;
    }
  });

  if (!allRatingsFilled) {
    alert("Harap berikan rating (bintang) untuk semua stasiun.");
    submitButton.disabled = false;
    submitButton.innerHTML = originalButtonHTML;
    return;
  }

  const allFeedback = getFromStorage("feedback");
  const newFeedback = {
    id: Date.now(),
    pesertaId: user.id,
    submittedAt: new Date().toISOString(),
    feedbackItems: feedbackItems,
  };

  allFeedback.push(newFeedback);
  saveToStorage("feedback", allFeedback);
  logActivity("SUBMIT_FEEDBACK", `Peserta ID: ${user.id}`);

  try {
    submitButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Mengirim ke Supabase...`;
    const { error } = await supabaseClient.from("feedback").upsert(
      {
        id: newFeedback.id,
        pesertaId: newFeedback.pesertaId,
        submittedAt: newFeedback.submittedAt,
        feedbackItems: newFeedback.feedbackItems,
      },
      { onConflict: "id" },
    );

    if (error) throw error;

    submitButton.innerHTML = `<i class="fas fa-check-circle"></i> Terkirim!`;
    alert("Umpan balik berhasil dikirim. Terima kasih atas partisipasi Anda!");
  } catch (error) {
    console.error("Gagal mengirim umpan balik ke server:", error);
    submitButton.classList.replace("btn-success", "btn-warning");
    submitButton.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Gagal Kirim`;
    alert(
      "Umpan balik berhasil disimpan di perangkat ini, tetapi GAGAL dikirim ke server. Data akan disinkronkan oleh admin nanti. Terima kasih!",
    );
  }

  setTimeout(() => {
    loadPesertaDashboard();
  }, 2000);
}

function loadFeedbackSummary() {
  renderFeedbackRatingChart();
  renderFeedbackCompletionChart();
  const container = document.getElementById("feedback-comments-container");
  const allFeedback = getFromStorage("feedback");
  const stations = getFromStorage("stations");

  if (allFeedback.length === 0) {
    container.innerHTML =
      '<p class="text-muted text-center p-3">Belum ada umpan balik yang dikirimkan oleh peserta.</p>';
    return;
  }

  const commentsByStation = {};
  allFeedback.forEach((f) => {
    f.feedbackItems.forEach((item) => {
      if (!commentsByStation[item.stationId]) {
        commentsByStation[item.stationId] = [];
      }
      if (item.comment) {
        commentsByStation[item.stationId].push(item.comment);
      }
    });
  });

  let accordionHtml = '<div class="accordion" id="accordionFeedbackComments">';
  stations.forEach((station) => {
    const comments = commentsByStation[station.id] || [];
    if (comments.length > 0) {
      accordionHtml += `
                <div class="accordion-item">
                    <h2 class="accordion-header">
                        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${station.id}">
                            ${station.name} <span class="badge bg-secondary ms-2">${comments.length} komentar</span>
                        </button>
                    </h2>
                    <div id="collapse-${station.id}" class="accordion-collapse collapse" data-bs-parent="#accordionFeedbackComments">
                        <div class="accordion-body">
                            <ul class="list-group">
                                ${comments.map((c) => `<li class="list-group-item">"${c}"</li>`).join("")}
                            </ul>
                        </div>
                    </div>
                </div>`;
    }
  });
  accordionHtml += "</div>";

  container.innerHTML = accordionHtml;
}

function renderFeedbackRatingChart() {
  const chartCanvas = document.getElementById("feedback-rating-chart");
  const fallback = document.getElementById("feedback-rating-fallback");
  const allFeedback = getFromStorage("feedback");
  const stations = getFromStorage("stations");

  if (allFeedback.length === 0) {
    chartCanvas.style.display = "none";
    fallback.classList.remove("d-none");
    if (feedbackRatingChartInstance) feedbackRatingChartInstance.destroy();
    return;
  }

  chartCanvas.style.display = "block";
  fallback.classList.add("d-none");

  const ratingsByStation = {};
  allFeedback.forEach((f) => {
    f.feedbackItems.forEach((item) => {
      if (!ratingsByStation[item.stationId]) {
        ratingsByStation[item.stationId] = { total: 0, count: 0 };
      }
      ratingsByStation[item.stationId].total += item.rating;
      ratingsByStation[item.stationId].count++;
    });
  });

  const chartData = stations
    .map((station) => {
      const data = ratingsByStation[station.id];
      return {
        name: station.name,
        avgRating: data ? data.total / data.count : 0,
      };
    })
    .filter((d) => d.avgRating > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const ctx = chartCanvas.getContext("2d");
  if (feedbackRatingChartInstance) feedbackRatingChartInstance.destroy();

  feedbackRatingChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: chartData.map((d) => d.name),
      datasets: [
        {
          label: "Rata-rata Rating",
          data: chartData.map((d) => d.avgRating.toFixed(2)),
          backgroundColor: "rgba(255, 193, 7, 0.7)",
          borderColor: "rgba(255, 193, 7, 1)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      scales: { x: { beginAtZero: true, max: 5, ticks: { stepSize: 1 } } },
      plugins: { legend: { display: false } },
    },
  });
}

function renderFeedbackCompletionChart() {
  const chartCanvas = document.getElementById("feedback-completion-chart");
  const fallback = document.getElementById("feedback-completion-fallback");
  const allFeedback = getFromStorage("feedback");
  const allScores = getFromStorage("scores");

  const REQUIRED_STATIONS_FOR_COMPLETION = 9;
  const scoresByPeserta = allScores.reduce((acc, score) => {
    if (!acc[score.pesertaId]) acc[score.pesertaId] = new Set();
    acc[score.pesertaId].add(score.stationId);
    return acc;
  }, {});

  const completedPesertaIds = Object.keys(scoresByPeserta).filter(
    (id) => scoresByPeserta[id].size >= REQUIRED_STATIONS_FOR_COMPLETION,
  );

  if (completedPesertaIds.length === 0) {
    chartCanvas.style.display = "none";
    fallback.classList.remove("d-none");
    if (feedbackCompletionChartInstance)
      feedbackCompletionChartInstance.destroy();
    return;
  }

  chartCanvas.style.display = "block";
  fallback.classList.add("d-none");

  const submittedCount = allFeedback.filter((f) =>
    completedPesertaIds.includes(String(f.pesertaId)),
  ).length;
  const notSubmittedCount = completedPesertaIds.length - submittedCount;

  const ctx = chartCanvas.getContext("2d");
  if (feedbackCompletionChartInstance)
    feedbackCompletionChartInstance.destroy();

  feedbackCompletionChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Sudah Mengisi", "Belum Mengisi"],
      datasets: [
        {
          data: [submittedCount, notSubmittedCount],
          backgroundColor: ["rgba(25, 135, 84, 0.8)", "rgba(220, 53, 69, 0.8)"],
          borderColor: ["#198754", "#dc3545"],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top" } },
    },
  });
}

// =================================================================
// PRINTING FUNCTIONS
// =================================================================
function printElement(elementId, title) {
  const sourceElement = document.getElementById(elementId);
  if (!sourceElement) {
    console.error("Elemen untuk dicetak tidak ditemukan:", elementId);
    return;
  }
  const printContentNode = sourceElement.cloneNode(true);
  const canvas = sourceElement.querySelector("canvas");
  if (canvas && canvas.style.display !== "none") {
    const image = new Image();
    image.src = canvas.toDataURL("image/png");
    image.style.maxWidth = "100%";
    image.style.height = "auto";
    const canvasClone = printContentNode.querySelector("canvas");
    if (canvasClone) canvasClone.parentNode.replaceChild(image, canvasClone);
  }
  if (elementId === "station-ranking-container") {
    Array.from(printContentNode.children).forEach((col) => {
      col.style.width = "100%";
      col.style.marginBottom = "20px";
      col.className = "";
    });
    printContentNode.className = "";
  }
  const printWindow = window.open("", "_blank");
  printWindow.document.write(
    `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>${title}</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet"><style>@page{size:A4;margin:2cm;}body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}.card-header{border-bottom:1px solid #dee2e6!important;}.card{border:1px solid #dee2e6!important;margin-bottom:1.5rem;}h1,.print-title{font-size:20pt;text-align:center;margin-bottom:1rem;}img{max-width:100%;height:auto;}</style></head><body><h1 class="print-title">${title}</h1>${printContentNode.innerHTML}</body></html>`,
  );
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 500);
}
function generateExamCardHTML(p) {
  if (!p || !p.sesi) return "";
  const fullSchedule = calculateFullSchedule();
  const participantSchedule = fullSchedule
    .filter((item) => item.peserta.id === p.id)
    .sort((a, b) => a.date - b.date || a.rotasi - b.rotasi);
  if (participantSchedule.length === 0) return "";
  let scheduleRows = "";
  participantSchedule.forEach((item) => {
    scheduleRows += `<tr><td>${item.date.toLocaleDateString("id-ID")}</td><td style="text-align:center;">${item.rotasi}</td><td style="text-align:center;">${item.waktuMulai} - ${item.waktuSelesai}</td><td>${item.station.name}</td></tr>`;
  });
  const settings = getFromStorage(CERT_SETTINGS_KEY) || {};
  const institutionName =
    settings.institutionName || "D3 KEPERAWATAN WAIKABUBAK";
  return `<div class="card-container"><div class="header"><h1>KARTU UJIAN OSCE</h1><h2>${institutionName.toUpperCase()}</h2></div><table class="info-table"><tr><td>Nama Peserta</td><td>: ${p.nama}</td></tr><tr><td>NIM</td><td>: ${p.nim}</td></tr><tr><td>Sesi Ujian</td><td>: ${p.sesi}</td></tr></table><table class="schedule-table"><thead><tr><th>Tanggal</th><th style="text-align:center;">Rotasi Ke</th><th style="text-align:center;">Waktu</th><th>Nama Station</th></tr></thead><tbody>${scheduleRows}</tbody></table><p style="margin-top:2em;font-size:9pt;text-align:center;"><em>* Harap hadir 15 menit sebelum sesi ujian dimulai. Bawa kartu identitas diri.</em></p></div>`;
}
function printAllExamCards() {
  const allPeserta = getFromStorage("peserta");
  const scheduledPeserta = allPeserta.filter((p) => p.sesi);
  if (scheduledPeserta.length === 0)
    return alert(
      "Tidak ada peserta yang memiliki jadwal ujian. Silakan generate jadwal terlebih dahulu.",
    );
  if (
    !confirm(
      `Anda akan mencetak kartu ujian untuk ${scheduledPeserta.length} peserta. Ini dapat membuka banyak halaman di dialog cetak Anda. Lanjutkan?`,
    )
  )
    return;
  let allCardsHTML = "";
  scheduledPeserta
    .sort((a, b) => a.sesi - b.sesi || a.nama.localeCompare(b.nama))
    .forEach((p) => {
      allCardsHTML += generateExamCardHTML(p);
    });
  if (allCardsHTML === "")
    return alert(
      "Gagal menghasilkan kartu ujian. Periksa kembali data jadwal.",
    );
  const printContent = `<!DOCTYPE html><html lang="id"><head><title>Semua Kartu Ujian OSCE</title><style>@page{size:A4 portrait;margin:1cm;}body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:11pt;margin:0;}.card-container{border:2px solid #000;padding:1.5cm;margin:0 auto;width:100%;max-width:18cm;box-sizing:border-box;page-break-inside:avoid;page-break-after:always;}body > .card-container:last-child{page-break-after:auto;}.header{text-align:center;margin-bottom:1.5em;}h1{font-size:16pt;margin-bottom:0.2em;}h2{font-size:12pt;margin:0;font-weight:normal;}.info-table{width:100%;margin-bottom:1.5em;border-collapse:collapse;}.info-table td{padding:4px 0;vertical-align:top;}.info-table td:first-child{width:120px;font-weight:bold;}.schedule-table{width:100%;border-collapse:collapse;}.schedule-table th,.schedule-table td{border:1px solid #999;padding:8px;text-align:left;}.schedule-table th{background-color:#e9ecef;}</style></head><body>${allCardsHTML}</body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 500);
}
function printExamCard(pesertaId) {
  const p = getFromStorage("peserta").find((item) => item.id === pesertaId);
  if (!p) return alert("Data peserta tidak ditemukan.");
  if (!p.sesi)
    return alert(
      "Peserta ini belum memiliki jadwal sesi. Silakan generate jadwal terlebih dahulu.",
    );
  const cardHTML = generateExamCardHTML(p);
  if (!cardHTML)
    return alert("Tidak ditemukan detail jadwal untuk peserta ini.");
  const printContent = `<!DOCTYPE html><html lang="id"><head><title>Kartu Ujian OSCE - ${p.nama}</title><style>@page{size:A4 portrait;margin:1cm;}body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:11pt;margin:0;}.card-container{border:2px solid #000;padding:1.5cm;margin:0 auto;width:100%;max-width:18cm;box-sizing:border-box;}.header{text-align:center;margin-bottom:1.5em;}h1{font-size:16pt;margin-bottom:0.2em;}h2{font-size:12pt;margin:0;font-weight:normal;}.info-table{width:100%;margin-bottom:1.5em;border-collapse:collapse;}.info-table td{padding:4px 0;vertical-align:top;}.info-table td:first-child{width:120px;font-weight:bold;}.schedule-table{width:100%;border-collapse:collapse;}.schedule-table th,.schedule-table td{border:1px solid #999;padding:8px;text-align:left;}.schedule-table th{background-color:#e9ecef;}</style></head><body>${cardHTML}</body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 500);
}
function printExamReport() {
  const settings = getFromStorage(CERT_SETTINGS_KEY);
  if (!settings.examDate || !settings.venue || !settings.kaprodiName)
    return alert(
      "Data tidak lengkap. Harap isi Tanggal Ujian, Lokasi, dan Nama Ketua Prodi di halaman Pengaturan.",
    );
  const peserta = getFromStorage("peserta");
  const scores = getFromStorage("scores");
  const attendedPesertaIds = new Set(scores.map((s) => s.pesertaId));
  const pesertaTidakHadirList = peserta.filter(
    (p) => !attendedPesertaIds.has(p.id),
  );
  const totalPeserta = peserta.length;
  const pesertaHadir = attendedPesertaIds.size;
  const pesertaTidakHadirCount = pesertaTidakHadirList.length;
  let absentListHtml = "<p>Daftar peserta yang tidak hadir: Tidak ada.</p>";
  if (pesertaTidakHadirList.length > 0) {
    absentListHtml = `<p>Daftar nama peserta yang tidak hadir:</p><ol style="margin-left:2em;">`;
    pesertaTidakHadirList.forEach((p) => {
      absentListHtml += `<li>${p.nama} (${p.nim})</li>`;
    });
    absentListHtml += `</ol>`;
  }
  const formattedDate = new Date(settings.certDate).toLocaleDateString(
    "id-ID",
    { day: "numeric", month: "long", year: "numeric" },
  );
  const institutionName =
    settings.institutionName ||
    "Program Studi D3 Keperawatan Waikabubak, Poltekkes Kemenkes Kupang";
  const kaprodiTitle = settings.kaprodiTitle || "Ketua Program Studi";
  const kaprodiNip = settings.kaprodiNip ? `NIP. ${settings.kaprodiNip}` : "";
  const printContent = `<!DOCTYPE html><html lang="id"><head><title>Berita Acara Pelaksanaan Ujian OSCE</title><style>body{font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:1.5;}.container{width:80%;margin:auto;}.header{text-align:center;}h1{font-size:14pt;margin-bottom:5px;text-transform:uppercase;text-decoration:underline;}p{text-align:justify;margin-top:1.5em;margin-bottom:1.5em;}table.details{margin-left:2em;}table.details td{padding:2px 5px;}.signature-block{margin-top:5em;float:right;text-align:center;}@page{size:A4;margin:2.5cm;}</style></head><body><div class="container"><div class="header"><h1>BERITA ACARA PELAKSANAAN UJIAN OSCE</h1></div><p>Pada hari ini, ${settings.examDate}, telah dilaksanakan Ujian Objective Structured Clinical Examination (OSCE) yang diselenggarakan oleh ${institutionName}.</p><p>Ujian ini dilaksanakan sesuai dengan jadwal yang telah ditentukan dan berlangsung di ${settings.venue}.</p><p>Adapun rincian pelaksanaan ujian adalah sebagai berikut:</p><table class="details"><tr><td>Jumlah peserta yang terdaftar</td><td>:</td><td>${totalPeserta} orang</td></tr><tr><td>Jumlah peserta yang hadir</td><td>:</td><td>${pesertaHadir} orang</td></tr><tr><td>Jumlah peserta yang tidak hadir</td><td>:</td><td>${pesertaTidakHadirCount} orang</td></tr></table>${absentListHtml}<p>Ujian berjalan dengan tertib dan lancar sesuai dengan prosedur dan standar operasional yang telah ditetapkan. Seluruh stasiun OSCE telah digunakan sebagaimana mestinya dan proses penilaian dilakukan oleh para dosen/penguji sesuai dengan rubrik penilaian yang berlaku.</p><p>Demikian berita acara ini dibuat dengan sebenarnya untuk dapat digunakan sebagaimana mestinya.</p><div class="signature-block"><p>${settings.certCity}, ${formattedDate}</p><p>${kaprodiTitle}</p><br><br><br><br><p><strong>${settings.kaprodiName}</strong></p><p>${kaprodiNip}</p></div></div></body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}
function printExaminerAttendance() {
  const settings = getFromStorage(CERT_SETTINGS_KEY);
  if (!settings.koordinatorName)
    return alert(
      "Harap isi Nama Koordinator OSCE di halaman Pengaturan terlebih dahulu.",
    );
  const penguji = getFromStorage("penguji");
  const stations = getFromStorage("stations");
  const scores = getFromStorage("scores");
  if (penguji.length === 0)
    return alert("Tidak ada data penguji untuk dicetak.");
  const stationMap = new Map(stations.map((s) => [s.id, s.name]));
  penguji.sort((a, b) =>
    (stationMap.get(a.assignedStationId) || "zzzz").localeCompare(
      stationMap.get(b.assignedStationId) || "zzzz",
    ),
  );
  let tableRows = "";
  penguji.forEach((p, index) => {
    const gradedCount = new Set(
      scores.filter((s) => s.pengujiId === p.id).map((s) => s.pesertaId),
    ).size;
    tableRows += `<tr><td style="text-align:center;">${index + 1}</td><td>${p.nama}</td><td>${p.idPenguji}</td><td>${stationMap.get(p.assignedStationId) || '<i style="color:gray;">Belum Ditugaskan</i>'}</td><td style="text-align:center;">${gradedCount}</td><td style="width:25%;">${index + 1}. ......................................</td></tr>`;
  });
  const formattedDate = new Date(
    settings.certDate || new Date(),
  ).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const institutionName =
    settings.institutionName || "PRODI D3 KEPERAWATAN WAIKABUBAK";
  const koordinatorTitle = settings.koordinatorTitle || "Koordinator OSCE";
  const koordinatorNip = settings.koordinatorNip
    ? `NIP. ${settings.koordinatorNip}`
    : "";
  const printContent = `<!DOCTYPE html><html lang="id"><head><title>Daftar Hadir Penguji OSCE</title><style>body{font-family:'Times New Roman',Times,serif;font-size:12pt;}.container{width:90%;margin:auto;}.header{text-align:center;}h1{font-size:14pt;margin-bottom:5px;text-transform:uppercase;}h2{font-size:13pt;font-weight:normal;margin-top:0;}table{width:100%;border-collapse:collapse;margin-top:1.5em;}th,td{border:1px solid black;padding:8px;vertical-align:top;}th{text-align:center;background-color:#f2f2f2;}.signature-block{margin-top:3em;float:right;text-align:center;}@page{size:A4;margin:2cm;}</style></head><body><div class="container"><div class="header"><h1>DAFTAR HADIR PENGUJI</h1><h2>UJIAN OBJECTIVE STRUCTURED CLINICAL EXAMINATION (OSCE)<br>${institutionName.toUpperCase()}</h2></div><table><thead><tr><th>NO</th><th>NAMA LENGKAP & GELAR</th><th>NIDN/ID</th><th>STASIUN</th><th>JML. DINILAI</th><th>TANDA TANGAN</th></tr></thead><tbody>${tableRows}</tbody></table><div class="signature-block"><p>${settings.certCity || "Waikabubak"}, ${formattedDate}</p><p>${koordinatorTitle}</p><br><br><br><br><p><strong>${settings.koordinatorName}</strong></p><p>${koordinatorNip}</p></div></div></body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}
function printStudentAttendance() {
  const settings = getFromStorage(CERT_SETTINGS_KEY);
  const peserta = getFromStorage("peserta");
  const scheduledPeserta = peserta.filter((p) => p.sesi);
  if (scheduledPeserta.length === 0)
    return alert(
      "Tidak ada peserta yang memiliki jadwal. Silakan generate jadwal terlebih dahulu.",
    );
  if (!settings.koordinatorName)
    return alert(
      "Harap isi Nama Koordinator OSCE di halaman Pengaturan terlebih dahulu.",
    );
  const pesertaBySession = scheduledPeserta.reduce((acc, p) => {
    const sesi = p.sesi || "Unscheduled";
    if (!acc[sesi]) acc[sesi] = [];
    acc[sesi].push(p);
    return acc;
  }, {});
  const sortedSessionKeys = Object.keys(pesertaBySession).sort(
    (a, b) => parseInt(a) - parseInt(b),
  );
  let allSessionsHtml = "";
  sortedSessionKeys.forEach((sesi) => {
    const sessionPeserta = pesertaBySession[sesi].sort((a, b) =>
      a.nama.localeCompare(b.nama),
    );
    let tableRows = "";
    sessionPeserta.forEach((p, index) => {
      tableRows += `<tr><td style="text-align:center;">${index + 1}</td><td>${p.nim}</td><td>${p.nama}</td><td style="width:35%;"></td></tr>`;
    });
    allSessionsHtml += `<div class="session-block"><h3>SESI ${sesi}</h3><table><thead><tr><th>NO</th><th>NIM</th><th>NAMA LENGKAP</th><th>TANDA TANGAN</th></tr></thead><tbody>${tableRows}</tbody></table></div>`;
  });
  const formattedDate = new Date(
    settings.certDate || new Date(),
  ).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const institutionName =
    settings.institutionName || "PRODI D3 KEPERAWATAN WAIKABUBAK";
  const koordinatorTitle = settings.koordinatorTitle || "Koordinator OSCE";
  const koordinatorNip = settings.koordinatorNip
    ? `NIP. ${settings.koordinatorNip}`
    : "";
  const printContent = `<!DOCTYPE html><html lang="id"><head><title>Daftar Hadir Peserta OSCE</title><style>body{font-family:'Times New Roman',Times,serif;font-size:12pt;}.container{width:90%;margin:auto;}.header{text-align:center;}h1{font-size:14pt;margin-bottom:5px;text-transform:uppercase;}h2{font-size:13pt;font-weight:normal;margin-top:0;}h3{font-size:12pt;margin-top:1em;margin-bottom:0.5em;text-decoration:underline;}.session-block{page-break-inside:avoid;margin-bottom:2em;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid black;padding:8px;vertical-align:top;}th{text-align:center;background-color:#f2f2f2;}.signature-block{margin-top:3em;float:right;text-align:center;}@page{size:A4;margin:2cm;}</style></head><body><div class="container"><div class="header"><h1>DAFTAR HADIR PESERTA</h1><h2>UJIAN OBJECTIVE STRUCTURED CLINICAL EXAMINATION (OSCE)<br>${institutionName.toUpperCase()}</h2></div>${allSessionsHtml}<div class="signature-block"><p>${settings.certCity || "Waikabubak"}, ${formattedDate}</p><p>${koordinatorTitle}</p><br><br><br><br><p><strong>${settings.koordinatorName}</strong></p><p>${koordinatorNip}</p></div></div></body></html>`;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(printContent);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

// Jalankan sinkronisasi awal untuk memproses antrian tertunda jika ada
processPendingSync();
