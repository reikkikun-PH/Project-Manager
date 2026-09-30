/**
 * BAONCHECK — profile page logic
 */

(function () {
  let user = initShell("profile");
  if (!user) return;

  document.getElementById("name").value = user.name;
  document.getElementById("school").value = user.school || "";
  document.getElementById("email").value = user.email;

  document.getElementById("profileForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("name").value.trim();
    const school = document.getElementById("school").value.trim();
    const result = Store.updateProfile(user.id, { name, school });
    if (result.ok) {
      user = result.user;
      document.getElementById("sidebarUserName").textContent = user.name;
      document.getElementById("sidebarAvatar").textContent = initials(user.name);
      showToast("Profile updated");
    }
  });

  document.getElementById("passwordForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const current = document.getElementById("currentPassword").value;
    const next = document.getElementById("newPassword").value;

    if (current !== user.password) {
      showToast("Current password is incorrect");
      return;
    }
    Store.updateProfile(user.id, { password: next });
    document.getElementById("passwordForm").reset();
    showToast("Password updated");
  });
})();
