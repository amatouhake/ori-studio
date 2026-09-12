# Source coverage and native-state hardening evidence

These small artifacts were regenerated against the built Linux desktop over its
public authenticated loopback MCP endpoint. No private renderer mutation or fault
injection endpoint was added.

- `public-probes.json`: export-loss refusals, Cyan3 targeting, history conflict,
  full FOLD round trips and source-target coverage.
- `hinge-55.obj` / `hinge-55.png`: a 55% target, complete source coverage, measured
  dihedral residual 0.00368°, and substantial physical folding.
- `omitted-mountain.obj`: the intentionally isolated interior mountain is omitted
  during preparation. The mesh is flat and the solver settles; coverage is
  incomplete and attainment is **unknown**, never `settled_at_target`.
- `frame-roundtrip.fold`: second full-file export/import generation, preserving
  file metadata, embedded CP/foreign folded-form frames and the 90° crease.
- `bp-symmetry.json` / `bp-symmetry.osf`: two public MCP clone/export/publication
  generations preserve enabled mirror pairing, diagonal fold and orientation.
  The initial fixture is opened through the desktop's normal OSF file argument.

Reproduce after building with `node scripts/mcp/desktop-demo.mjs`. This runs the
security, native-state, hardening, acceptance and design-engine probes in an
isolated application instance. Controlled non-resolving-job, forced render-race,
large-base and live-native-frame tests use the public renderer service with
injected engines; production tools do not expose fault injection.

The earlier Ginkgo blind dogfood remains independent evidence of that specific
physical result. This pass supersedes the *general coverage claim* of the older
attainment algorithm, not the Ginkgo OBJ measurement.
