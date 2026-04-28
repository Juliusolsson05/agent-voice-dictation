// Shared ambient declaration for the preload-injected window.flow.
// Both renderer entry points (Hub + Status) import from here, so we
// don't have to redeclare the global in each.

import type { FlowApi } from '../../preload/index'

declare global {
  interface Window {
    flow: FlowApi
  }
}
export {}
