// Clears a pending token before Discord starts on the next page load.
chrome.storage.local.get({ pendingClear: false }, (data) => {
  if (!data.pendingClear) return;
  chrome.storage.local.set({ pendingClear: false });
  localStorage.removeItem("token");
  localStorage.removeItem("location");
});
