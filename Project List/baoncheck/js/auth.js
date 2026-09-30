/**
 * BAONCHECK — auth page logic
 * Handles both index.html (login) and register.html forms.
 * If the user is already logged in, sends them straight to the
 * dashboard instead of showing the form again.
 */

(function () {
  const existing = Store.currentUser();
  if (existing) {
    window.location.href = "dashboard.html";
    return;
  }

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const result = Store.login(email, password);
      const errorBox = document.getElementById("loginError");

      if (!result.ok) {
        errorBox.textContent = result.message;
        errorBox.classList.remove("hidden");
        return;
      }
      window.location.href = "dashboard.html";
    });
  }

  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const errorBox = document.getElementById("registerError");
      const name = document.getElementById("name").value.trim();
      const school = document.getElementById("school").value.trim();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const confirmPassword = document.getElementById("confirmPassword").value;

      const gmailPattern = /^[a-zA-Z0-9._%+-]+@gmail\.com$/i;
      if (!gmailPattern.test(email)) {
        errorBox.textContent = "Please use a Gmail address (must end in @gmail.com).";
        errorBox.classList.remove("hidden");
        return;
      }

      if (password !== confirmPassword) {
        errorBox.textContent = "Passwords do not match.";
        errorBox.classList.remove("hidden");
        return;
      }

      const result = Store.register({ name, email, password, school });
      if (!result.ok) {
        errorBox.textContent = result.message;
        errorBox.classList.remove("hidden");
        return;
      }
      window.location.href = "dashboard.html";
    });
  }
})();
