// Arm the content script to clear Discord storage once the final Discord tab closes.
chrome.tabs.onRemoved.addListener(async () => {
  const { clearOnTabClose } = await chrome.storage.local.get({
    clearOnTabClose: false,
  });
  if (!clearOnTabClose) return;

  const discordTabs = await chrome.tabs.query({ url: "https://discord.com/*" });
  if (discordTabs.length === 0) {
    await chrome.storage.local.set({ pendingClear: true });
  }
});

function copyEmpty() {
  const field = document.createElement("textarea");
  document.body.appendChild(field);
  field.value = "";
  field.select();
  const done = document.execCommand("copy");
  field.remove();
  return done;
}

// Clear the clipboard when the scheduled auto-clear alarm fires.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "clearClipboard") return;

  if (!copyEmpty()) {
    await navigator.clipboard.writeText("").catch(() => {});
  }
});
