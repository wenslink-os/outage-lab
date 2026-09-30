// Catalogue of external dependencies the sample app talks to.
// "network" dependencies are prerequisites for every "remote" dependency.

export const DEPENDENCIES = Object.freeze([
  { id: 'internet', kind: 'network' },
  { id: 'dns', kind: 'network' },
  { id: 'backend', kind: 'remote' },
  { id: 'auth', kind: 'remote' },
  { id: 'payment', kind: 'remote' },
  { id: 'email', kind: 'remote' },
  { id: 'cdn', kind: 'remote' }
]);

export const DEPENDENCY_IDS = Object.freeze(DEPENDENCIES.map((d) => d.id));
export const NETWORK_PREREQUISITES = Object.freeze(
  DEPENDENCIES.filter((d) => d.kind === 'network').map((d) => d.id)
);

export const DEP_STATES = Object.freeze(['up', 'slow', 'down']);
export const MAX_LATENCY_MS = 15000;

export function getDependency(id) {
  const dep = DEPENDENCIES.find((d) => d.id === id);
  if (!dep) throw new Error(`Unknown dependency: ${id}`);
  return dep;
}
