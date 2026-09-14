# OSINT Copilot

An Obsidian-based OSINT copilot for investigators to organize, analyze, and visualize data and relationships.

![OSINT Copilot Interface](screenshots/Copilot%20Left%20pallete%20bigger.png)

OSINT Copilot is an Obsidian plugin for OSINT investigators, researchers, journalists, threat researchers, and analysts. It combines AI-assisted investigation workflows with a local-first investigation workspace, allowing you to organize entities, evidence, events, and relationships directly in your Obsidian vault.

Investigation data is stored as Markdown and YAML in your vault, making it transparent, portable, and accessible outside the plugin. Built-in graph, timeline, and map views help you explore connections, identify patterns, and understand investigations from different perspectives.

This is a source-available project built to provide an extensible foundation for OSINT investigations. The goal is not to prescribe a single investigative workflow, but to give investigators a flexible environment that can be adapted to different methodologies, data sources, AI tools, and research needs.

---

## AI-assisted investigations

OSINT Copilot provides AI-assisted workflows for working with investigative data, including:

- **Unified chat agent** for interacting with your investigation and vault
- **Entity extraction** to identify and structure investigative entities
- **Vault Q&A** for searching and reasoning over your existing research
- **Graph ingestion** for turning investigative information into structured relationships
- **HTTP enrichers** for connecting investigations with external data sources
- **Custom workflows** that can be adapted to different investigative methodologies

AI workflows can be powered through **Claude Code** and **Codex CLI** as first-class local CLI integrations. **Hermes** and other custom CLI runtimes can also be used for unified chat.

---

## Investigate, connect, visualize

OSINT Copilot is built around the idea that investigations are more than collections of notes. People, organizations, locations, events, evidence, and other entities are connected, and those relationships often provide the most valuable insights.

The plugin helps you:

- Organize investigative information into structured entities and notes
- Connect people, organizations, locations, events, and other entities through relationships
- Analyze structured information across your Obsidian vault
- Visualize connections through interactive graphs
- Explore timelines to understand events and developments over time
- Map locations associated with entities and events
- Enrich investigative data through configurable external sources
- Assist investigations with AI while keeping the underlying data in your vault

---

## Installation

**Recommended: [BRAT](https://github.com/TfTHacker/obsidian42-brat)** (Beta Reviewers Auto-update Tool)

1. **Settings → Community plugins** → turn off Restricted mode.
2. Install and enable **BRAT** from Community plugins.
3. **Settings → BRAT → Add Beta plugin**, paste:
   ```
   https://github.com/OSINT-Copilot/Obsidian-OSINT-Copilot-plugin
   ```
4. **Settings → Community plugins** → enable **OSINT Copilot**.

For manual installation, a pre-configured template vault, and full setup steps, see the [User Guide](USER_GUIDE.md).

---

## Documentation

| Document | Contents |
|----------|----------|
| [USER_GUIDE.md](USER_GUIDE.md) | Installation options, configuration, entity/relationship management, AI features, visualization tools, troubleshooting |
| [docs/ENRICHERS_SETUP.md](docs/ENRICHERS_SETUP.md) | HTTP enricher specs, auth types, examples |
| [docs/CUSTOM_TYPES_SETUP.md](docs/CUSTOM_TYPES_SETUP.md) | Vault YAML custom entity/relationship types |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | Version-to-version changes |

---

## License

**OSINT Copilot Team - Source Available License.** See [LICENSE](LICENSE) for full terms.

## Credits

Built with inspiration from **obsidian-copilot-plugin**, **obsidian-smart-connections**, **OpenSanctions/FollowTheMoney**, and **Nominatim/OpenStreetMap**.

## Support

For issues, feature requests, or questions, use [GitHub Issues](https://github.com/OSINT-Copilot/Obsidian-OSINT-Copilot-plugin/issues).
