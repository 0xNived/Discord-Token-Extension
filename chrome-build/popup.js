const $ = (id) => document.getElementById(id);

const tokenInput = $("token");
const clearOnCloseBox = $("clearOnClose");
const autoClearClipBox = $("autoClearClip");
const openDiscordBox = $("openDiscord");
const statusEl = $("status");
const copyBtn = $("copy");
const currentTokenEl = $("currentToken");

/** Updates the status line below the active panel. */
function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type;
}

function cleanToken(raw) {
  let token = raw.trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1);
  }
  return token.trim();
}

function isValidToken(token) {
  return token.length > 50 && /^[A-Za-z0-9._-]+$/.test(token);
}

/** Toggles visual masking and swaps the visibility icon. */
function showToken(field, openId, closedId, visible) {
  field.classList.toggle("masked-token", !visible);
  $(openId).hidden = !visible;
  $(closedId).hidden = visible;
}

function wireEye(buttonId, openId, closedId, field) {
  $(buttonId).addEventListener("click", () => {
    showToken(field, openId, closedId, field.classList.contains("masked-token"));
  });
}

function setCopyState(enabled) {
  copyBtn.disabled = !enabled;
  if (!enabled) {
    currentTokenEl.value = "";
    showToken(currentTokenEl, "eye-current-open", "eye-current-slash", false);
  }
}

/** Resolves after a tab finishes loading, or after the timeout. */
function waitForLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setTimeout(finish, timeoutMs);
  });
}

async function getDiscordTab(createIfMissing = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id && tab.url && tab.url.startsWith("https://discord.com/")) {
    return { tab };
  }

  if (createIfMissing) {
    setStatus("Opening Discord…");
    const created = await chrome.tabs.create({
      url: "https://discord.com/channels/@me",
      active: false,
    });
    await waitForLoad(created.id);
    return { tab: await chrome.tabs.get(created.id) };
  }

  if (!tab || !tab.id) return { error: "No active tab found." };
  return { error: "Open a discord.com tab first." };
}

/** Reads and normalizes the token stored by Discord in a tab. */
async function readToken(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => localStorage.getItem("token"),
  });
  const raw = result && "result" in result ? result.result : null;
  if (!raw) return null;
  let token = raw;
  try {
    token = JSON.parse(raw);
  } catch {
    token = raw.replace(/^"|"$/g, "");
  }
  return token ? String(token).trim() : null;
}

async function loadTabToken(showError = false) {
  const { tab, error } = await getDiscordTab();
  if (error) {
    setCopyState(false);
    if (showError) setStatus(error, "err");
    return null;
  }

  try {
    const token = await readToken(tab.id);
    if (!token) {
      setCopyState(false);
      if (showError) setStatus("No token in local storage.", "err");
      return null;
    }
    setCopyState(true);
    currentTokenEl.value = token;
    return token;
  } catch (e) {
    setCopyState(false);
    if (showError) setStatus("Read failed: " + e.message, "err");
    return null;
  }
}

/** Applies the pasted token to the selected Discord tab. */
async function login() {
  const token = cleanToken(tokenInput.value);
  if (!token) {
    setStatus("Token is empty.", "err");
    return;
  }
  if (!isValidToken(token)) {
    setStatus("That doesn't look like a valid token.", "err");
    return;
  }

  const { tab, error } = await getDiscordTab(openDiscordBox.checked);
  if (error) {
    setStatus(error, "err");
    return;
  }

  try {
    await chrome.storage.local.set({ pendingClear: false });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (t) => {
        localStorage.setItem("token", JSON.stringify(t));
        window.location.replace("https://discord.com/channels/@me");
      },
      args: [token],
    });
    await chrome.tabs.update(tab.id, { active: true });
    setCopyState(true);
    currentTokenEl.value = token;
    setStatus("Token applied. Redirecting to DMs…", "ok");
    window.close();
  } catch (e) {
    setStatus("Injection failed: " + e.message, "err");
  }
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const isLogin = btn.dataset.tab === "login";
    $("login-tab").hidden = !isLogin;
    $("extract-tab").hidden = isLogin;
    setStatus("");
    if (!isLogin) loadTabToken(true);
  });
});

wireEye("eye", "eye-open", "eye-slash", tokenInput);
wireEye("eye-current", "eye-current-open", "eye-current-slash", currentTokenEl);

$("paste").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    tokenInput.value = text.trim();
    setStatus("Pasted from clipboard.", "ok");
  } catch {
    setStatus("Clipboard access denied — paste manually (Ctrl+V).", "err");
  }
});

$("login").addEventListener("click", login);
tokenInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});

copyBtn.addEventListener("click", async () => {
  const token = currentTokenEl.value;
  if (!token) return;
  try {
    await navigator.clipboard.writeText(token);
    setStatus("Token copied.", "ok");
    if (autoClearClipBox.checked) {
      chrome.alarms.create("clearClipboard", { delayInMinutes: 0.5 });
    }
  } catch {
    setStatus("Copy failed — select and copy manually.", "err");
  }
});

$("dismiss").addEventListener("click", () => {
  $("notice").hidden = true;
  chrome.storage.local.set({ noticeDismissed: true });
});

clearOnCloseBox.addEventListener("change", () => {
  chrome.storage.local.set({
    clearOnTabClose: clearOnCloseBox.checked,
    pendingClear: false,
  });
});

autoClearClipBox.addEventListener("change", () => {
  chrome.storage.local.set({ autoClearClip: autoClearClipBox.checked });
  if (!autoClearClipBox.checked) chrome.alarms.clear("clearClipboard");
});

openDiscordBox.addEventListener("change", () => {
  chrome.storage.local.set({ openDiscord: openDiscordBox.checked });
});

chrome.storage.local.get(
  {
    clearOnTabClose: false,
    autoClearClip: false,
    openDiscord: false,
    noticeDismissed: false,
  },
  (data) => {
    clearOnCloseBox.checked = data.clearOnTabClose;
    autoClearClipBox.checked = data.autoClearClip;
    openDiscordBox.checked = data.openDiscord;
    if (data.noticeDismissed) $("notice").hidden = true;
    chrome.storage.local.remove(["savedToken", "remember"]);
  }
);

setCopyState(false);
