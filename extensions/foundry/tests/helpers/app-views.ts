// The views App loads with React.lazy, each its own chunk in the build. A spec
// that renders App imports this first, so every view is already loaded when a
// test opens one: the lazy import then settles in a tick, as it does from disk
// in the app, instead of transforming the view's modules inside the test.
import '../../src/components/Orders.js'
import '../../src/components/Ledger.js'
import '../../src/components/SettingsView.js'
import '../../src/components/factory/FactorySite.js'
import '../../src/components/factory/FactoryHall.js'
