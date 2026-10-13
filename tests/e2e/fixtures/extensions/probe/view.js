// Counts the reloads the app announces for this extension, so a spec can see one arrive.
let reloads = 0
window.electronAPI.extensionEvents.onExtensionRendererReload(function onReload() {
  reloads += 1
  document.getElementById('reloads').textContent = 'reloads: ' + reloads
})
