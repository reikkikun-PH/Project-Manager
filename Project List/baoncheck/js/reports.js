/**
 * BAONCHECK — reports page logic
 * Builds daily / weekly / monthly summaries from the same expense
 * list, plus a small dependency-free bar chart (plain divs).
 */

(function () {
  const user = initShell("reports");
  if (!user) return;

  const allExpenses = Store.getExpenses(user.id);
  let currentRange = "daily";

  function startOfWeek(d) {
    const dt = new Date(d);
    const day = dt.getDay(); // 0 = Sun
    const diff = day === 0 ? -6 : 1 - day; // Monday as start
    dt.setDate(dt.getDate() + diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function isoDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  function filterForRange(range) {
    const today = Store.todayISO();
    if (range === "daily") {
      return allExpenses.filter((e) => e.date === today);
    }
    if (range === "weekly") {
      const start = startOfWeek(new Date());
      return allExpenses.filter((e) => new Date(e.date + "T00:00:00") >= start);
    }
    // monthly
    const monthPrefix = today.slice(0, 7);
    return allExpenses.filter((e) => e.date.startsWith(monthPrefix));
  }

  function renderStats(range) {
    const list = filterForRange(range);
    const total = list.reduce((a, e) => a + e.amount, 0);
    const avg = list.length ? total / list.length : 0;

    const labels = { daily: "Today", weekly: "This week", monthly: "This month" };
    document.getElementById("rangeLabel").textContent = labels[range];
    document.getElementById("rangeTotal").textContent = Store.formatPeso(total);
    document.getElementById("rangeCount").textContent = `${list.length} transaction${list.length === 1 ? "" : "s"}`;
    document.getElementById("rangeAvg").textContent = Store.formatPeso(avg);

    const byCategory = Store.categories()
      .map((c) => ({ name: c, amount: list.filter((e) => e.category === c).reduce((a, e) => a + e.amount, 0) }))
      .sort((a, b) => b.amount - a.amount);

    const top = byCategory[0];
    document.getElementById("rangeTop").textContent = top && top.amount > 0 ? top.name : "—";
    document.getElementById("rangeTopAmt").textContent = top ? Store.formatPeso(top.amount) : Store.formatPeso(0);

    renderCategoryBreakdown(byCategory.filter((c) => c.amount > 0));
  }

  function renderCategoryBreakdown(totals) {
    const el = document.getElementById("categoryBreakdown");
    if (totals.length === 0) {
      el.innerHTML = `<div class="empty-state"><p>No spending in this period.</p></div>`;
      return;
    }
    const max = Math.max(...totals.map((c) => c.amount));
    el.innerHTML = totals
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

  function renderChart(range) {
    const chartEl = document.getElementById("barChart");
    const subEl = document.getElementById("chartSub");

    let buckets = [];

    if (range === "monthly") {
      // last 5 weeks, bucketed
      subEl.textContent = "Last 5 weeks";
      for (let i = 4; i >= 0; i--) {
        const end = new Date();
        end.setDate(end.getDate() - i * 7);
        const start = new Date(end);
        start.setDate(start.getDate() - 6);
        const amount = allExpenses
          .filter((e) => {
            const d = new Date(e.date + "T00:00:00");
            return d >= start && d <= end;
          })
          .reduce((a, e) => a + e.amount, 0);
        buckets.push({ label: `W${5 - i}`, amount });
      }
    } else {
      subEl.textContent = "Last 7 days";
      for (let i = 6; i >= 0; i--) {
        const dateStr = isoDaysAgo(i);
        const amount = allExpenses.filter((e) => e.date === dateStr).reduce((a, e) => a + e.amount, 0);
        const d = new Date(dateStr + "T00:00:00");
        buckets.push({ label: d.toLocaleDateString("en-PH", { weekday: "short" }).slice(0, 2), amount });
      }
    }

    const max = Math.max(...buckets.map((b) => b.amount), 1);

    chartEl.innerHTML = buckets
      .map((b) => {
        const h = Math.max((b.amount / max) * 100, b.amount > 0 ? 6 : 2);
        return `
        <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; height:100%; justify-content:flex-end;">
          <div title="${Store.formatPeso(b.amount)}" style="width:100%; max-width:28px; height:${h}%; background:${b.amount > 0 ? "var(--primary)" : "var(--surface-sunken)"}; border-radius:5px 5px 2px 2px;"></div>
          <div style="font-size:0.72rem; color:var(--text-faint);">${b.label}</div>
        </div>`;
      })
      .join("");
  }

  function setRange(range) {
    currentRange = range;
    document.querySelectorAll("#rangeSwitch button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.range === range);
    });
    renderStats(range);
    renderChart(range);
  }

  document.getElementById("rangeSwitch").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-range]");
    if (btn) setRange(btn.dataset.range);
  });

  setRange(currentRange);
})();
