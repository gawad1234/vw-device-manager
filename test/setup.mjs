// Lets tests load main-process files: resolves the extensionless imports the
// bundler normally handles, and stands in for Electron, which only exists in the app.
import { registerHooks } from 'node:module'

const stub = new URL('./electron-stub.mjs', import.meta.url).href

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'electron' || specifier === '@electron-toolkit/utils') {
      return { url: stub, shortCircuit: true }
    }
    if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
      return next(specifier + '.ts', context)
    }
    return next(specifier, context)
  }
})
