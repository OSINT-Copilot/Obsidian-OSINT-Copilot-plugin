# Object types (v1)

`MODEL.md` normatively defines exactly these 6 types (graph-provenance profile) — no more, no less.

| Type | Role |
|------|------|
| InvestigationPackage | Manifest: metadata, policy, stream paths, optional `attachments.stix_bundle`/`external_refs` |
| Entity | `schema` + multi-valued string `properties`; field definitions in [[../raw/SOURCES.md\|YAML schemata]] (`spec/schemata/`), FtM-style |
| Artifact | Capture record: id, url, hashes, retrieval/mime metadata, sensitivity/distribution |
| Statement | Provenance-backed assertion: subject → value, confidence, extraction metadata |
| EvidenceLink | `artifact`/`statement` → `entity`, with supports/refutes/related + strength |
| SourceAssessment | Structured, pillar-based trust evaluation of an artifact or entity |

## InvestigationPackage

- **Identity**: `id` (URI/URN), `title`, `summary`, `created`, `modified`.
- **Scope** (optional): `topics[]`, `time_range` {`start`,`end`}, `jurisdiction`.
- **Contributors**: `contributors[]` — each `{name, role, organization_id}`.
- **Policy**: `data_policy` — `license`, `attribution`, `intended_use`, `distribution` (`public`|`partner`|`internal`|`restricted`).
- **Streams**: `streams` — logical name → relative JSONL path, see [[streams]].
- **Attachments** (optional): `stix_bundle` (STIX 2 JSON, cyber profile); `external_refs` (opaque pointers).

## Entity

- `id`, `schema` (from the YAML registry, e.g. `Person`, `Organization`, `Affiliation`), `properties` (object: key → array of strings, multi-valued).
- Property values referencing other entities use the same string-id pattern as FollowTheMoney (YAML `type: entity`, optional `range:`).
- **Interstitial link entities** (MODEL.md's own examples: `Affiliation`, `Membership`) remain **entities** with their own `schema` — their YAML `extends` `Interest`/`Interval` rather than being a separate edge table.

## Artifact

- **Identity**: `id`, optional `url`, `retrieved_at`, `title`, `mime_type`.
- **Integrity**: `hashes` — map of algorithm → hex string (e.g. `sha256`).
- **Capture**: `capture_method` — `http_get`, `archive_org`, `manual_upload`, `api`, `warc`, `other`.
- **Storage**: `storage_hint` — opaque URI/path token for implementers.
- **Labels**: `sensitivity` (`public`|`internal`|`restricted`|`sensitive`), `distribution` (`public`|`partner`|`internal`|`restricted`) — aligned with package policy.

## Statement

- `id`; **`subject`** is one of:
  - `entity_property`: `{entity_id, property}`
  - `entity_edge` (optional in 1.0): `{link_entity_id}` — for asserting facts about interstitial link entities
- **`value`**: string (atomic assertion at OIDSF 1.0).
- **`artifact_ids[]`**: supporting artifacts.
- **`asserted_by`**: contributor id or free-text agent id.
- **`confidence`**: `0.0`–`1.0` — analytic confidence in the assertion, **not** source truth.
- **`extracted_at`**, **`extraction_method`** (`manual`|`ocr`|`llm`|`import`|`api`|`other`).
- Statements are **not** automatically "true" — they record what the investigation asserts, and why.

## EvidenceLink

- `id`; **`from_ref`**: `artifact_id` or `statement_id`; **`to_ref`**: `entity_id` (or future `claim_id`).
- **`relationship`**: `supports` | `refutes` | `related`.
- **`strength`**: `strong` | `moderate` | `weak`.
- **`notes`** (optional).
- The JSON Schema models `from_ref`/`to_ref` as structured `{kind, id}` objects (`kind`: `artifact`|`statement` for `from_ref`, `entity` for `to_ref`) — slightly more precise than `MODEL.md`'s flatter prose; both describe the same thing.

## SourceAssessment

- `id`, **`subject_ref`** (`artifact_id` or `entity_id`), `assessed_at`, `assessor` (contributor id).
- **`pillars`** (optional): `data_information_sources`, `argumentation`, `communication_style`, `community` — each holds **`parameters`**: map of code → `{score: number|null, rationale: string}`.
- **`overall_trust`** (optional): `reliable` | `neutral` | `unreliable` | `unknown`.
- The Amsterdam Matrix's parameter codes are **not mandated** — `parameters` keys may align with that framework, but partial/custom sets are valid.

## Interoperability hooks (cross-cutting, not a 7th type)

- **FtM**: entity/statement mapping notes in `MODEL.md`'s interop section.
- **STIX (cyber profile)**: `attachments.stix_bundle` (JSON-object-only, validated); `ExternalRef` pattern `{system:"stix", id:"indicator--..."}`; extension convention `x_stix_refs` under an `extensions` namespace.
- **DISARM**: technique ids as strings, either in `extensions` or as an `Entity.properties` value (schema `InfluenceTechniqueRef`, property `disarmTechniqueIds: ["T001", ...]`).
- **Intelligence cycle** (informative, non-normative in 1.0): optional `intel_phase` property — `planning`|`collection`|`processing`|`analysis`|`dissemination`.
