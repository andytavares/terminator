// The probe's backend. Its one command asks the app to bring the probe's own
// project tab forward, through the event core listens on for exactly that.
exports.activate = function activate(api) {
  api.commands.register(
    { id: 'show-tab', label: 'Show the probe tab', category: 'Probe' },
    function showTab() {
      api.window.broadcast('extension:select-project-tab', { tabId: 'e2e.probe' })
    }
  )
}

exports.deactivate = function deactivate() {}
