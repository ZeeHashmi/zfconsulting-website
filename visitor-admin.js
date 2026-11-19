(() => {
  "use strict";
  const config = window.ZF_SUPABASE_DEMO || {};
  const base = (config.url || "").replace(/\/+$/, "");
  const endpoint = base + "/functions/v1/visitor-audit";
  const status = document.getElementById("admin-status");
  const form = document.getElementById("login-form");
  const panel = document.getElementById("records-panel");
  const body = document.getElementById("records-body");
  let accessToken = null;

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle("error", error);
  }

  async function loadRecords() {
    if (!accessToken) return;
    message("Loading visitor records…");
    try {
      const response = await fetch(endpoint, {
        headers: { apikey: config.publishableKey, Authorization: "Bearer " + accessToken }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load records.");
      body.replaceChildren();
      for (const event of data.events || []) {
        const tr = document.createElement("tr");
        const values = [
          new Date(event.created_at).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }),
          "ZF-" + String(event.visitor_id).slice(0, 8).toUpperCase(),
          event.visited_path, event.browser, event.operating_system, event.device_type,
          event.country_code || "Unknown", event.ip_fingerprint || "Unavailable"
        ];
        for (const value of values) {
          const td = document.createElement("td");
          td.textContent = value;
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
      message((data.events || []).length + " visitor records loaded.");
    } catch (error) {
      message(error.message || "Could not load records.", true);
      if (/session|sign in|authorised/i.test(error.message || "")) {
        accessToken = null;
        panel.hidden = true;
        form.hidden = false;
      }
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!config.publishableKey || !base) {
      message("Supabase configuration is missing.", true);
      return;
    }
    const button = document.getElementById("login-button");
    button.disabled = true;
    message("Signing in…");
    try {
      const response = await fetch(base + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: config.publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("email").value.trim(),
          password: document.getElementById("password").value
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.access_token) throw new Error(result.msg || result.error_description || "Sign-in failed.");
      accessToken = result.access_token;
      form.hidden = true;
      panel.hidden = false;
      await loadRecords();
    } catch (error) {
      message(error.message || "Sign-in failed.", true);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("refresh-button").addEventListener("click", loadRecords);
  document.getElementById("logout-button").addEventListener("click", () => {
    accessToken = null;
    body.replaceChildren();
    panel.hidden = true;
    form.hidden = false;
    document.getElementById("password").value = "";
    message("Signed out.");
  });
})();