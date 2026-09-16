// Phoenix Local host-only runtime primitives. Kept inside plugin-inventory so
// the host owns lifecycle and filesystem access; renderer code talks through
// the existing host remote instead of importing Node-only modules.
export * from './types.js'
export * from './catalog.js'
export * from './paths.js'
export * from './state.js'
