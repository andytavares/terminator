'use strict'

function activate(api) {
  api.settings.register({
    label: 'Sample Settings',
    properties: {
      enabled: {
        type: 'boolean',
        label: 'Enable Sample Feature',
        description: 'Toggles the sample feature',
        default: true,
      },
    },
  })

  api.contextMenu.registerItem('workspace', {
    id: 'sample-action',
    label: 'Sample Action',
    onClick: (targetId) => {
      console.log('Sample action triggered for workspace:', targetId)
    },
  })

  api.keyboard.register('CmdOrCtrl+Shift+S', () => {
    console.log('Sample keyboard shortcut triggered')
  })
}

function deactivate() {
  console.log('Sample extension deactivated')
}

module.exports = { activate, deactivate }
