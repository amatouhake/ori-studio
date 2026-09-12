/** Per-edge identities supplied by the caller before topology preparation.
 * Empty entries identify generated hinges; missing provenance is not evidence.
 * IDs survive splitting through extension remapping and union only on actual
 * redundant-vertex merges. No coordinate lookup creates identities.
 */
export const SOURCE_EDGE_PROVENANCE = 'oristudio:edges_source_provenance';
