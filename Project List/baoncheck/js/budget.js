/**
 * BAONCHECK — budget page logic
 */

(function () {
  const user = initShell("budget");
  if (!user) return;

  const now = new Date();
  document.getElementById("budgetRangeLabel").textContent = now.toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
  });

  function monthlyExpenses() {
    const monthPrefix = Store.todayISO().slice(0, 7);
    return Store.getExpenses(user.id).filter((e) => e.date.startsWith(monthPrefix));
  }

  function renderOverview() {
    const budget = Store.getBudget(user.id);
    const spent = monthlyExpenses().reduce((a, e) => a + e.amount, 0);

    document.getElementById("budgetInput").value = budget || "";

    const emptyState = document.getElementById("budgetOverviewEmpty");
    const overview = document.getElementById("budgetOverview");

    if (!budget) {
      emptyState.classList.remove("hidden");
      overview.classList.add("hidden");
      return;
    }
    emptyState.classList.add("hidden");
    overview.classList.remove("hidden");

    const pct = Math.min((spent / budget) * 100, 100);
    const remaining = budget - spent;

    document.getElementById("spentAmount").textContent = Store.formatPeso(spent);
    document.getElementById("budgetAmount").textContent = Store.formatPeso(budget);
    document.getElementById("budgetPercent").textContent = `${Math.round((spent / budget) * 100)}% used`;
    document.getElementById("budgetRemaining").textContent =
      remaining >= 0 ? `${Store.formatPeso(remaining)} left` : `${Store.formatPeso(Math.abs(remaining))} over budget`;

    const fill = document.getElementById("budgetFill");
    fill.style.width = pct + "%";
    fill.classList.remove("over", "near");
    if (spent > budget) fill.classList.add("over");
    else if (spent / budget >= 0.8) fill.classList.add("near");
  }

  function renderCategories() {
    const expenses = monthlyExpenses();
    const breakdownEl = document.getElementById("categoryBreakdown");
    const categories = Store.categories();
    const totals = categories
      .map((c) => ({ name: c, amount: expenses.filter((e) => e.category === c).reduce((a, e) => a + e.amount, 0) }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    if (totals.length === 0) {
      breakdownEl.innerHTML = `<div class="empty-state"><p>No spending recorded this month yet.</p></div>`;
      return;
    }
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

  document.getElementById("budgetForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = document.getElementById("budgetInput").value;
    Store.setBudget(user.id, value);
    showToast("Budget saved");
    renderOverview();
  });

  renderOverview();
  renderCategories();
})();
