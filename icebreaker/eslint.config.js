// ESLint (flat config) from the engine's @aue/lint: the same maintainability limits and package boundaries, and the
// determinism rules for the mode plugins (they run inside the simulation on every peer and the server). The engine
// submodule is checked by its own CI.
import { aueConfig } from '@aue/lint';

export default aueConfig({
  ignores: ['engine/'],
  deterministic: ['packages/mode-*/src/**'],
  exempt: [],
});
