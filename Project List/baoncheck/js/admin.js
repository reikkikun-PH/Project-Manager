/**
 * BAONCHECK — admin page logic
 */

(function () {
  const user = initShell("admin");
  if (!user) return;

  if (user.role !== "admin") {
    document.getElementById("notAdmin").classList.remove("hidden");
    document.getElementById("adminContent").classList.add("hidden");
    return;
  }

  const tableBody = document.getElementById("userTableBody");

  function render() {
    const users = Store.getAllUsers();
    document.getElementById("statTotalUsers").textContent = users.length;
    document.getElementById("statStudents").textContent = users.filter((u) => u.role === "student").length;
    document.getElementById("statAdmins").textContent = users.filter((u) => u.role === "admin").length;
    document.getElementById("userCount").textContent = `${users.length} account${users.length === 1 ? "" : "s"}`;

    tableBody.innerHTML = users
      .map(
        (u) => `
      <tr>
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.school || "—")}</td>
        <td>
          <select data-role="${u.id}" ${u.id === user.id ? "disabled" : ""} style="padding:5px 8px; border:1px solid var(--border-strong); border-radius:6px;">
            <option value="student" ${u.role === "student" ? "selected" : ""}>Student</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
        </td>
        <td>${Store.formatDate(u.createdAt)}</td>
        <td>
          <div class="row-actions">
            <button class="btn-icon" data-delete="${u.id}" ${u.id === user.id ? "disabled" : ""} aria-label="Delete">🗑</button>
          </div>
        </td>
      </tr>`
      )
      .join("");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  tableBody.addEventListener("change", (e) => {
    const id = e.target.getAttribute("data-role");
    if (id) {
      Store.setUserRole(id, e.target.value);
      showToast("Role updated");
      render();
    }
  });

  tableBody.addEventListener("click", (e) => {
    const id = e.target.getAttribute("data-delete");
    if (id) {
      if (confirm("Remove this user and all of their expenses?")) {
        Store.deleteUser(id);
        showToast("User removed");
        render();
      }
    }
  });

  render();
})();
