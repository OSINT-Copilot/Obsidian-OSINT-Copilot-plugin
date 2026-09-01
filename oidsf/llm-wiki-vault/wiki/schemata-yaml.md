# YAML schemata (FtM-style, unified)

OIDSF entity types live under `spec/schemata/` as **one YAML file per schema** in a **single flat namespace** (`*.yaml`, no subfolders) — **141 files**.

- **FollowTheMoney**-derived types are merged here (no separate `followthemoney/` folder).
- **STIX 2.1**–aligned types extend **`IntelObject`** → **`Thing`** (not a detached `stix2/` island) — ~42 files carry `stix_type`/`stix_family`.
- **Arkham**-inspired concepts extend **`AnalyticObject`** and use global names (**`Claim`**, **`ACHMatrix`**, **`CredibilityAssessment`**, **`EvidenceChain`**, …) without an `Arkham*` prefix — ~25 files.
- **Links** (relationship) types extend **`Interest`** directly — `Affiliation`, `Ownership`, `Membership`, `EmploymentPost`, `Directorship`, `Authorship`, `Citation`, … (14 direct subtypes).
- Remainder (~74) is FtM-style "World" entities extending `Thing` — `Person`, `Company`, `Organization`, `Address`, `Event`, `Document`, `SocialPost`, `OnlineAccount`, etc.
- 7 abstract roots: `Thing`, `Interest`, `Interval`, `IntelObject`, `AnalyticObject`, `Analyzable`, `Value`.
- Property `type` vocabulary follows FtM conventions (`name`, `text`, `url`, `entity`, `country`, `identifier`, …).

**Notable renames:** FtM **`Post`** → **`EmploymentPost`**; FtM **`UserAccount`** + STIX user-account SCO → **`OnlineAccount`**. Full table: [[unified-ontology]].

Regenerate the unified tree from the four legacy source trees (if present, under `_archive_pre_unify_schemata/`) with `tools/unify_schemata_tree.py`. Refresh FtM from upstream per `spec/schemata/VENDOR.md` (diff against `_archive_pre_unify_schemata/followthemoney/`, keep a version checkpoint).

The old `tools/generate_stix_arkham_schemata.py` entry point is **deprecated** (exits 1 with a pointer to `unify_schemata_tree.py`).

See [[unified-ontology]] for the normative merge table, layers, and OSINT notes.

See [[../raw/SOURCES.md]] for paths.
