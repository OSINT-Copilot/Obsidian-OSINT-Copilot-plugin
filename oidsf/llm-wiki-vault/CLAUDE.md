# OIDSF maintainer notes (LLM wiki)

## Ingest

- Canonical spec: [`../spec/CHARTER.md`](../spec/CHARTER.md), [`../spec/MODEL.md`](../spec/MODEL.md), [`../spec/SERIALIZATION.md`](../spec/SERIALIZATION.md).
- Machine validation: JSON Schemas in [`../spec/json-schema/`](../spec/json-schema/), reference CLI [`../tools/validator/validate.py`](../tools/validator/validate.py).

## Query

- Start at [`wiki/index.md`](wiki/index.md).
- Examples: [`../examples/`](../examples/).

## Lint / consistency

- Entity schemata: flat `spec/schemata/*.yaml` (unified ontology); run [`../tools/unify_schemata_tree.py`](../tools/unify_schemata_tree.py) only when rebuilding from the four legacy trees.
- After changing schemas, run the validator against both example packages.
- Bump `oidsf_version` in charter and schemas when making breaking changes.

## Last updated

- 2026-09-01: Refreshed all 5 wiki pages against the current spec (`CHARTER.md`, `MODEL.md`, `SERIALIZATION.md`, `UNIFIED_ONTOLOGY.md`, `spec/schemata/`) — filled in gaps (full charter goals/non-goals/threat-model/profiles, complete per-type field lists on `object-types.md`, layers/renames/mapping tables on `unified-ontology.md`, manifest/ID/validation detail on `streams.md`) and confirmed the 141-file schema count. No content contradictions found versus the prior wiki text, only incompleteness relative to the normative docs.
- 2026-04-18: Unified schemata tree (`UNIFIED_ONTOLOGY.md`); validator loads `spec/schemata/*.yaml` only.
- 2026-04-18: Initial OIDSF 1.0.0 graph-provenance profile.
