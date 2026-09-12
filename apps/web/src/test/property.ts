import type { Parameters } from 'fast-check';

// Keep CI repeatable; opt into another seed or replay the seed/path printed by
// fast-check on failure. Import only in property suites, not every test worker.
function integerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be an integer, got ${JSON.stringify(value)}`);
  }
  return Number(value);
}

export const propertyParameters: Parameters<unknown> = {
  seed: integerEnv('FC_SEED', 20260912),
  numRuns: integerEnv('FC_RUNS', 256),
  ...(process.env.FC_PATH === undefined ? {} : { path: process.env.FC_PATH }),
};

if (propertyParameters.numRuns! < 1) throw new Error('FC_RUNS must be positive');
