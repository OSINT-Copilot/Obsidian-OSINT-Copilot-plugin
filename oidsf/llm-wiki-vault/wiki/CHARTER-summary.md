# Charter summary

OIDSF **1.0.0** (graph-provenance profile) targets **public-interest OSINT** interchange: entity graphs, artifact-backed provenance, optional trust assessments, optional STIX/DISARM hooks.

## Goals

1. **Interoperability** — predictable structure + validation across tools.
2. **Streaming** — JSON Lines streams for large graphs, not only monolithic JSON.
3. **Provenance-first** — normative `Statement` objects bind graph facts to artifacts + contributors.
4. **Safety/ethics** — `sensitivity`, `distribution`, `redaction` labels at package + object level.
5. **Extensibility** — namespaced extension properties without breaking core.

## Non-goals (v1)

1. **Not** a legal chain-of-custody / forensic standard for court admission.
2. **Not** a STIX/TAXII replacement for cyber-threat feeds (may embed/reference STIX).
3. **Not** a full BPM/workflow engine (lightweight `intel_phase` tags only).
4. **Not** mandating the full Amsterdam Matrix 23 parameters — assessments may be partial.

## Threat model

| Risk | Mitigation |
|------|------------|
| Misinformation/misinterpretation | Separate observed (artifact/statement) from analytic confidence; optional hypotheses/claims profile |
| Privacy/harm | `sensitivity`, `distribution`, PII minimization guidance, redaction labels |
| Tampering | Content hashes on `Artifact`; optional signatures (future) |
| Ambiguous sharing | Package-level `data_policy`: license, attribution, intended use |

## Profiles

| Profile | Status | Adds |
|---------|--------|------|
| **graph-provenance** | v1 default | `InvestigationPackage`, `Entity`, `Artifact`, `Statement`, `EvidenceLink`; optional `SourceAssessment` |
| **epistemic** | future | `Claim`, `Hypothesis`, `ACHMatrix` (later minor version) |
| **influence** | optional | DISARM/TTP refs via `ExternalRef` (no taxonomy copy) |
| **cyber** | optional | STIX objects via `stix_bundle` or external STIX IDs |

## Versioning

- SemVer (`MAJOR.MINOR.PATCH`) on `oidsf_version`. Major = breaking schema/required-field changes; Minor = additive types/fields/profiles; Patch = clarifications/non-breaking fixes.
- Every stream record + the package document must carry `oidsf_version` (or package `compat.min_version`/`max_version`).

## Governance (informative)

Normative = JSON Schemas (`spec/json-schema/`) + `CHARTER.md`. `MODEL.md`/`SERIALIZATION.md`/examples are informative. `tools/validator/` is a reference implementation, not the sole spec definition.

## Relationship to other work

- **FollowTheMoney**: patterns reused for entity/property shape; not the default schema set wholesale.
- **STIX 2.x**: optional bundle attachment; the package/entity shell stays primary, not a STIX passthrough.
- **DISARM**: reference stable technique IDs (`disarmTechniqueIds`); don't embed the framework's own text.

See [[../raw/SOURCES.md]] for canonical `CHARTER.md` path.
