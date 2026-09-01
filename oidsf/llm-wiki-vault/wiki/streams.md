# Streams

## Encoding

- **UTF-8** without BOM for all JSON/JSONL.
- Informal MIME for the manifest: `application/x-oidsf+json` (not registered).

## Manifest (`package.json`)

- Single JSON file at bundle root (or ZIP entry point).
- Required: `oidsf_version` (SemVer, e.g. `1.0.0`), `kind` (constant `"oidsf.investigation_package"`), `id` (URI recommended), `title`, `streams` (map: stream name → relative file path).
- Optional: `compat` (`{min_version, max_version}`); `attachments.stix_bundle` (STIX 2 bundle object, cyber profile); `attachments.notes` (free-form string).

## Streams (graph-provenance profile)

| Stream key | File convention | Record type |
|---|---|---|
| `entities` | `entities.jsonl` | Entity |
| `artifacts` | `artifacts.jsonl` | Artifact |
| `statements` | `statements.jsonl` | Statement |
| `evidence_links` | `evidence_links.jsonl` | EvidenceLink |
| `source_assessments` | `source_assessments.jsonl` | SourceAssessment (optional) |

- One JSON object per line, no wrapper, no pretty-printing inside a line.
- File name (via manifest) determines the expected schema — the validator loads the path from the manifest, not by filename convention alone.
- Line order is not semantically required; ids are authoritative. Recommended: sort by `id` ascending (FtM-style) for deterministic diffs.

## ID conventions

- Prefer opaque ids: `urn:oidsf:...`, `https://...`, or prefixed random ids (`ent_`, `art_`, `stmt_`, `ev_`, `sa_`).
- Reference integrity: every `entity_id`/`artifact_id`/etc. must resolve within the corresponding stream, when that stream is present in the package.

## Validation levels

1. **Schema** — each file validates against its JSON Schema.
2. **Cross-reference** — no dangling ids between streams.
3. **Policy** (optional) — `distribution`/object-level rules; warning-only in the reference validator.

Reference validator: [`../../tools/validator/validate.py`](../../tools/validator/validate.py).

See [[object-types]] for what each record type contains, [[../raw/SOURCES.md]] for `SERIALIZATION.md`.
