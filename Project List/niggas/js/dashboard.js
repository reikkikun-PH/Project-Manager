/**
 * BAONCHECK — dashboard logic
 */

(function () {
  const user = initShell("dashboard");
  if (!user) return;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  document.getElementById("greeting").textContent = `${greeting}, ${user.name.split(" ")[0]}`;

  const expenses = Store.getExpenses(user.id);
  const today = Store.todayISO();
  const monthPrefix = today.slice(0, 7); // YYYY-MM

  const todays = expenses.filter((e) => e.date === today);
  const monthly = expenses.filter((e) => e.date.startsWith(monthPrefix));

  const sum = (list) => list.reduce((acc, e) => acc + e.amount, 0);

  document.getElementById("statToday").textContent = Store.formatPeso(sum(todays));
  document.getElementById("statTodayCount").textContent = `${todays.length} transaction${todays.length === 1 ? "" : "s"}`;

  document.getElementById("statMonth").textContent = Store.formatPeso(sum(monthly));
  document.getElementById("statMonthCount").textContent = `${monthly.length} transaction${monthly.length === 1 ? "" : "s"}`;

  const budget = Store.getBudget(user.id);
  const spentThisMonth = sum(monthly);
  const remaining = budget - spentThisMonth;
  const budgetCard = document.getElementById("statBudgetCard");
  const budgetValueEl = document.getElementById("statBudget");
  const budgetSubEl = document.getElementById("statBudgetSub");

  if (!budget) {
    budgetValueEl.textContent = "—";
    budgetSubEl.textContent = "No budget set yet";
  } else if (remaining >= 0) {
    budgetValueEl.textContent = Store.formatPeso(remaining);
    budgetSubEl.textContent = `of ${Store.formatPeso(budget)} set`;
  } else {
    budgetValueEl.textContent = Store.formatPeso(Math.abs(remaining));
    budgetSubEl.textContent = `over the ${Store.formatPeso(budget)} budget`;
    budgetCard.classList.add("warn");
  }

  // Recent expenses (5 latest)
  const recentList = document.getElementById("recentList");
  const recent = expenses.slice(0, 5);
  if (recent.length === 0) {
    recentList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🧾</div>
        <p>No expenses recorded yet.</p>
        <a href="expenses.html" class="btn btn-primary btn-sm">Add your first expense</a>
      </div>`;
  } else {
    recentList.innerHTML = recent
      .map(
        (e) => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border);">
        <div style="min-width:0;">
          <span class="pill ${Store.categorySlug(e.category)}">${e.category}</span>
          <div style="font-size:0.8rem; color:var(--text-faint); margin-top:4px;">${e.note ? escapeHtml(e.note) + " · " : ""}${Store.formatDate(e.date)}</div>
        </div>
        <div class="amount">${Store.formatPeso(e.amount)}</div>
      </div>`
      )
      .join("");
    // remove border on last row
    recentList.lastElementChild.style.borderBottom = "none";
  }

  // Category breakdown (this month)
  const breakdownEl = document.getElementById("categoryBreakdown");
  const categories = Store.categories();
  const totals = categories.map((c) => ({
    name: c,
    amount: monthly.filter((e) => e.category === c).reduce((a, e) => a + e.amount, 0),
  })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);

  if (totals.length === 0) {
    breakdownEl.innerHTML = `<div class="empty-state"><p>Nothing to show yet this month.</p></div>`;
  } else {
    const max = Math.max(...totals.map((c) => c.amount));
    breakdownEl.innerHTML = totals
      .map(
        (c) => `
      <div class="cat-row">
        <div class="cat-name">${c.name}</div>
        <div class="cat-track"><div class="cat-fill" style="width:${(c.amount / max) * 100}%"></div></div>
        <div class="cat-amt">${Store.formatPeso(c.amount)}</div>
      </div>`
      )
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
