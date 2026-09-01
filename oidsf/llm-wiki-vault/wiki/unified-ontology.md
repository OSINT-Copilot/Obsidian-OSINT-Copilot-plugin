# Unified OIDSF ontology (hub)

Normative document: [`../../spec/UNIFIED_ONTOLOGY.md`](../../spec/UNIFIED_ONTOLOGY.md) (repo root relative to this vault).

**Summary:** One YAML namespace under `spec/schemata/*.yaml` (141 files). Previous four-way split (`followthemoney/`, `stix2/`, `arkham/`, `oidsf/`) was merged; a read-only snapshot remains at `_archive_pre_unify_schemata/` for diffing. FtM roots (`Thing`, `Interval`, `Interest`) preserved for Aleph interop; STIX under `IntelObject` (extends `Thing`); Arkham prefixes dropped (`AnalyticObject` is the abstract root).

## Layers (OSINT practice)

| Layer | Root | Typical schemata |
|---|---|---|
| **World** | `Thing` | `Person`, `Organization`, `Company`, `Address`, `Event`, `Document`, `SocialPost`, `OnlineAccount`, … |
| **Links** | `Interest` | `Ownership`, `Membership`, `EmploymentPost`, `Authorship`, `Affiliation`, `Citation`, … |
| **Cyber / CTI** | `IntelObject` | `Indicator`, `Malware`, `ThreatActor`, `ObservableArtifact`, `Ipv4Addr`, … |
| **Analysis** | `AnalyticObject` | `Claim`, `Hypothesis`, `ACHMatrix`, `EvidenceChain`, `ProvenanceLink`, … |

**Provenance stays package-level** — `Artifact`/`Statement`/`EvidenceLink` (see [[object-types]]), not a competing "Evidence" entity type; `ClaimEvidence` links claims to references (Arkham-derived, Analysis layer).

## Key renames

`Post`→`EmploymentPost`, `UserAccount`+STIX user-account SCO→`OnlineAccount`, `StixObject`→`IntelObject`, `StixNote`→`AnalysisNote`, `StixIdentity`→`IntelIdentity`, `StixReport`→`IntelligenceReport`, `StixLocation`→`GeoLocation` (vs `Address`, the postal/geo string model), `StixBundle`→`CtiBundle`, `StixArtifactObservable`→`ObservableArtifact`, `StixFileObservable`→`ObservableFile`, `StixProcessObservable`→`ObservableProcess`, `ArkhamClaim`→`Claim`. Full list: `RENAME_SCHEMA` in [`../../tools/unify_schemata_tree.py`](../../tools/unify_schemata_tree.py) (e.g. `ArkhamACHMatrix`→`ACHMatrix`, `ArkhamProject`→`MirrorProject` — vs FtM `Project`).

## OSINT Copilot mapping (informative)

This wiki lives inside the OSINT Copilot Obsidian plugin's repo; this table is a bridge between OIDSF schema names and how the plugin's own entity picker might use them, not part of the normative spec.

| OIDSF schema | Copilot idea |
|---|---|
| `Person`, `Organization`, `Company` | Same as FtM picker |
| `OnlineAccount` | `Username` + `UserAccount`-style rows |
| `SocialPost` | Social content (not `EmploymentPost`) |
| `Claim`, `ACHMatrix`, `EvidenceChain` | Analytic workspace / future picker entries |
| `Artifact` (JSON stream) | Copilot `Evidence` vault items → export as OIDSF `Artifact` + links |
| `IntelObject` subtree | STIX bundle / cyber workspace |

## Rebuilding

1. Restore `spec/schemata/{followthemoney,stix2,arkham,oidsf}/` from `_archive_pre_unify_schemata/`.
2. Run `python tools/unify_schemata_tree.py` (moves sources aside to a fresh timestamped archive).

Don't copy upstream FollowTheMoney wholesale over `spec/schemata/*.yaml` — diff release-to-release selectively and keep a `VENDOR.md` checkpoint (tag + date).

Related: [[schemata-yaml]].
