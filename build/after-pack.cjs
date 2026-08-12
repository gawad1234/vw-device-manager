// electron-builder afterPack hook.
//
// We ship UNSIGNED (no paid Apple Developer cert), which means
// CSC_IDENTITY_AUTO_DISCOVERY=false and electron-builder SKIPS code signing.
// But an Apple-Silicon .app with no valid bundle signature launches as
// "damaged and cannot be opened". The fix is a free **ad-hoc** signature
// (`codesign --sign -`): it doesn't make Gatekeeper trust the app, but it
// produces a valid seal so the app opens via right-click -> Open instead of
// being flagged as damaged. We do it here, after packing and before the
// dmg/zip are built, so those wrap the signed app.
//
// (Windows/Linux: nothing to do — they don't gate launch on a code signature.)
const { execSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename // "Device Manager"
  const appPath = `${context.appOutDir}/${appName}.app`
  const appId = context.packager.appInfo.id // com.gawad.vwdevicemanager

  console.log(`  • afterPack: ad-hoc signing ${appName}.app`)
  execSync(
    `codesign --force --deep --sign - --identifier "${appId}" "${appPath}"`,
    { stdio: 'inherit' }
  )
  // Fail the build loudly if the seal isn't valid, rather than shipping "damaged".
  execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: 'inherit' })
}
