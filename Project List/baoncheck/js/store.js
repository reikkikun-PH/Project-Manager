/**
 * BAONCHECK — data layer
 * -----------------------------------------------------------------
 * Everything in this file is a stand-in for real backend calls.
 * Every function returns plain data (or a Promise-free value) the
 * same shape a future PHP/MySQL endpoint would return, so pages
 * never touch localStorage directly — only through Store.*.
 * When the backend is ready, swap the bodies of these functions
 * for fetch() calls; nothing in the page scripts should need to
 * change.
 * -----------------------------------------------------------------
 */

const Store = (function () {
  const KEYS = {
    users: "baoncheck_users",
    session: "baoncheck_session",
    expenses: "baoncheck_expenses",
    budgets: "baoncheck_budgets",
  };

  const CATEGORIES = [
    "Food",
    "Transportation",
    "School",
    "Mobile Load/Internet",
    "Shopping",
    "Personal",
    "Others",
  ];

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  /* ---------------------------------------------------------
     Seed data — so the UI never opens empty on first run
     --------------------------------------------------------- */
  function seed() {
    if (!localStorage.getItem(KEYS.users)) {
      const users = [
        {
          id: uid("u"),
          name: "Dick Martin Sangrador",
          email: "student.baoncheck@gmail.com",
          password: "password123",
          role: "student",
          school: "N/A University",
          createdAt: todayISO(),
        },
        {
          id: uid("u"),
          name: "System Admin",
          email: "admin.baoncheck@gmail.com",
          password: "admin123",
          role: "admin",
          school: "—",
          createdAt: todayISO(),
        },
      ];
      write(KEYS.users, users);
    }

    if (!localStorage.getItem(KEYS.expenses)) {
      const u = read(KEYS.users, [])[0];
      const now = new Date();
      const d = (offset) => {
        const dt = new Date(now);
        dt.setDate(dt.getDate() - offset);
        return dt.toISOString().slice(0, 10);
      };
      const sample = [
        { category: "Food", amount: 85, date: d(0), note: "Rice meal + iced tea" },
        { category: "Transportation", amount: 30, date: d(0), note: "Jeepney fare" },
        { category: "Mobile Load/Internet", amount: 50, date: d(1), note: "Mobile load" },
        { category: "Food", amount: 120, date: d(1), note: "Canteen lunch" },
        { category: "School", amount: 65, date: d(2), note: "Photocopies + ballpen" },
        { category: "Shopping", amount: 250, date: d(3), note: "New notebook set" },
        { category: "Food", amount: 95, date: d(4), note: "Merienda" },
        { category: "Personal", amount: 40, date: d(5), note: "Toiletries" },
        { category: "Transportation", amount: 30, date: d(6), note: "Jeepney fare" },
        { category: "Others", amount: 20, date: d(6), note: "Photocopy of ID" },
      ].map((e) => ({ id: uid("e"), userId: u.id, ...e }));
      write(KEYS.expenses, sample);
    }

    if (!localStorage.getItem(KEYS.budgets)) {
      const u = read(KEYS.users, [])[0];
      write(KEYS.budgets, { [u.id]: 2500 });
    }
  }

  /* ---------------------------------------------------------
     Auth
     --------------------------------------------------------- */
  function login(email, password) {
    const users = read(KEYS.users, []);
    const user = users.find(
      (u) => u.email.toLowerCase() === String(email).toLowerCase() && u.password === password
    );
    if (!user) return { ok: false, message: "Incorrect email or password." };
    write(KEYS.session, { userId: user.id });
    return { ok: true, user };
  }

  function register({ name, email, password, school }) {
    const users = read(KEYS.users, []);
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return { ok: false, message: "An account with that email already exists." };
    }
    const user = {
      id: uid("u"),
      name,
      email,
      password,
      role: "student",
      school: school || "—",
      createdAt: todayISO(),
    };
    users.push(user);
    write(KEYS.users, users);
    write(KEYS.session, { userId: user.id });
    return { ok: true, user };
  }

  function logout() {
    localStorage.removeItem(KEYS.session);
  }

  function currentUser() {
    const session = read(KEYS.session, null);
    if (!session) return null;
    const users = read(KEYS.users, []);
    return users.find((u) => u.id === session.userId) || null;
  }

  function requireAuth(redirectTo = "index.html") {
    const user = currentUser();
    if (!user) {
      window.location.href = redirectTo;
      return null;
    }
    return user;
  }

  function updateProfile(userId, patch) {
    const users = read(KEYS.users, []);
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) return { ok: false };
    users[idx] = { ...users[idx], ...patch };
    write(KEYS.users, users);
    return { ok: true, user: users[idx] };
  }

  /* ---------------------------------------------------------
     Expenses
     --------------------------------------------------------- */
  function getExpenses(userId) {
    return read(KEYS.expenses, []).filter((e) => e.userId === userId);
  }

  function addExpense(userId, { category, amount, date, note }) {
    const expenses = read(KEYS.expenses, []);
    const record = {
      id: uid("e"),
      userId,
      category,
      amount: Number(amount),
      date: date || todayISO(),
      note: note || "",
    };
    expenses.unshift(record);
    write(KEYS.expenses, expenses);
    return record;
  }

  function updateExpense(id, patch) {
    const expenses = read(KEYS.expenses, []);
    const idx = expenses.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    expenses[idx] = { ...expenses[idx], ...patch, amount: Number(patch.amount ?? expenses[idx].amount) };
    write(KEYS.expenses, expenses);
    return expenses[idx];
  }

  function deleteExpense(id) {
    const expenses = read(KEYS.expenses, []);
    write(KEYS.expenses, expenses.filter((e) => e.id !== id));
  }

  /* ---------------------------------------------------------
     Budget
     --------------------------------------------------------- */
  function getBudget(userId) {
    const budgets = read(KEYS.budgets, {});
    return budgets[userId] ?? 0;
  }

  function setBudget(userId, amount) {
    const budgets = read(KEYS.budgets, {});
    budgets[userId] = Number(amount);
    write(KEYS.budgets, budgets);
  }

  /* ---------------------------------------------------------
     Admin
     --------------------------------------------------------- */
  function getAllUsers() {
    return read(KEYS.users, []);
  }

  function deleteUser(userId) {
    write(KEYS.users, read(KEYS.users, []).filter((u) => u.id !== userId));
    write(
      KEYS.expenses,
      read(KEYS.expenses, []).filter((e) => e.userId !== userId)
    );
  }

  function setUserRole(userId, role) {
    return updateProfile(userId, { role });
  }

  /* ---------------------------------------------------------
     Helpers
     --------------------------------------------------------- */
  function categories() {
    return CATEGORIES.slice();
  }

  function categorySlug(name) {
    return String(name).toLowerCase().split("/")[0].trim();
  }

  function formatPeso(n) {
    const num = Number(n) || 0;
    return "₱" + num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(iso) {
    const dt = new Date(iso + "T00:00:00");
    return dt.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  }

  seed();

  return {
    KEYS,
    login,
    register,
    logout,
    currentUser,
    requireAuth,
    updateProfile,
    getExpenses,
    addExpense,
    updateExpense,
    deleteExpense,
    getBudget,
    setBudget,
    getAllUsers,
    deleteUser,
    setUserRole,
    categories,
    categorySlug,
    formatPeso,
    formatDate,
    todayISO,
  };
})();
