/**
 * BAONCHECK — expenses page logic
 */

(function () {
  const user = initShell("expenses");
  if (!user) return;

  const tableBody = document.getElementById("expenseTableBody");
  const emptyState = document.getElementById("emptyState");
  const resultCount = document.getElementById("resultCount");
  const searchInput = document.getElementById("searchInput");
  const categoryFilter = document.getElementById("categoryFilter");
  const dateFilter = document.getElementById("dateFilter");

  const modal = document.getElementById("expenseModal");
  const form = document.getElementById("expenseForm");
  const modalTitle = document.getElementById("modalTitle");
  const categorySelect = document.getElementById("category");

  // Populate category dropdowns
  Store.categories().forEach((c) => {
    categoryFilter.insertAdjacentHTML("beforeend", `<option value="${c}">${c}</option>`);
    categorySelect.insertAdjacentHTML("beforeend", `<option value="${c}">${c}</option>`);
  });

  function render() {
    let list = Store.getExpenses(user.id);

    const q = searchInput.value.trim().toLowerCase();
    if (q) list = list.filter((e) => (e.note || "").toLowerCase().includes(q));

    const cat = categoryFilter.value;
    if (cat) list = list.filter((e) => e.category === cat);

    const range = dateFilter.value;
    if (range !== "all") {
      const now = new Date();
      list = list.filter((e) => {
        const d = new Date(e.date + "T00:00:00");
        if (range === "today") return e.date === Store.todayISO();
        if (range === "week") {
          const diffDays = (now - d) / 86400000;
          return diffDays >= 0 && diffDays < 7;
        }
        if (range === "month") return e.date.startsWith(Store.todayISO().slice(0, 7));
        return true;
      });
    }

    list = list.slice().sort((a, b) => (a.date < b.date ? 1 : -1));

    resultCount.textContent = `${list.length} record${list.length === 1 ? "" : "s"}`;

    if (list.length === 0) {
      tableBody.innerHTML = "";
      emptyState.classList.remove("hidden");
      return;
    }
    emptyState.classList.add("hidden");

    tableBody.innerHTML = list
      .map(
        (e) => `
      <tr>
        <td>${Store.formatDate(e.date)}</td>
        <td><span class="pill ${Store.categorySlug(e.category)}">${e.category}</span></td>
        <td>${escapeHtml(e.note) || '<span style="color:var(--text-faint)">—</span>'}</td>
        <td style="text-align:right;" class="amount">${Store.formatPeso(e.amount)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" data-edit="${e.id}" aria-label="Edit">✎</button>
            <button class="btn-icon" data-delete="${e.id}" aria-label="Delete">🗑</button>
          </div>
        </td>
      </tr>`
      )
      .join("");
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Filters
  [searchInput, categoryFilter, dateFilter].forEach((el) =>
    el.addEventListener("input", render)
  );

  // Modal open/close
  function openModal(edit) {
    form.reset();
    document.getElementById("expenseId").value = "";
    document.getElementById("date").value = Store.todayISO();

    if (edit) {
      modalTitle.textContent = "Edit expense";
      document.getElementById("expenseId").value = edit.id;
      document.getElementById("amount").value = edit.amount;
      document.getElementById("date").value = edit.date;
      document.getElementById("category").value = edit.category;
      document.getElementById("note").value = edit.note || "";
    } else {
      modalTitle.textContent = "Add expense";
    }
    modal.classList.remove("hidden");
    document.getElementById("amount").focus();
  }

  function closeModal() {
    modal.classList.add("hidden");
  }

  document.getElementById("openAddModal").addEventListener("click", () => openModal(null));
  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("cancelModal").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // Table row actions (edit / delete)
  tableBody.addEventListener("click", (e) => {
    const editId = e.target.getAttribute("data-edit");
    const deleteId = e.target.getAttribute("data-delete");
    if (editId) {
      const record = Store.getExpenses(user.id).find((x) => x.id === editId);
      if (record) openModal(record);
    }
    if (deleteId) {
      if (confirm("Delete this expense? This cannot be undone.")) {
        Store.deleteExpense(deleteId);
        showToast("Expense deleted");
        render();
      }
    }
  });

  // Save (add or update)
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("expenseId").value;
    const payload = {
      category: document.getElementById("category").value,
      amount: document.getElementById("amount").value,
      date: document.getElementById("date").value,
      note: document.getElementById("note").value.trim(),
    };

    if (id) {
      Store.updateExpense(id, payload);
      showToast("Expense updated");
    } else {
      Store.addExpense(user.id, payload);
      showToast("Expense added");
    }
    closeModal();
    render();
  });

  render();
})();
