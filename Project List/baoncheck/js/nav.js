/**
 * BAONCHECK — shared app-shell behavior
 * Runs on every authenticated page (dashboard, expenses, budget,
 * reports, profile, admin). Fills in the sidebar user card, marks
 * the active nav link, and wires the mobile menu + logout button.
 */

function initShell(activePage) {
  const user = Store.requireAuth("index.html");
  if (!user) return null;

  // Active nav link
  document.querySelectorAll(".nav-link").forEach((link) => {
    if (link.dataset.page === activePage) link.classList.add("active");
  });

  // Sidebar user card
  const nameEl = document.getElementById("sidebarUserName");
  const roleEl = document.getElementById("sidebarUserRole");
  const avatarEl = document.getElementById("sidebarAvatar");
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = user.role === "admin" ? "Administrator" : "Student";
  if (avatarEl) avatarEl.textContent = initials(user.name);

  // Admin-only link visibility
  document.querySelectorAll("[data-admin-only]").forEach((el) => {
    el.classList.toggle("hidden", user.role !== "admin");
  });

  // Logout
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      Store.logout();
      window.location.href = "index.html";
    });
  }

  // Mobile menu
  const toggle = document.getElementById("menuToggle");
  const sidebar = document.getElementById("sidebar");
  if (toggle && sidebar) {
    toggle.addEventListener("click", () => sidebar.classList.toggle("open"));
    document.addEventListener("click", (e) => {
      if (
        sidebar.classList.contains("open") &&
        !sidebar.contains(e.target) &&
        !toggle.contains(e.target)
      ) {
        sidebar.classList.remove("open");
      }
    });
  }

  return user;
}

function initials(name) {
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove("show"), 2400);
}
