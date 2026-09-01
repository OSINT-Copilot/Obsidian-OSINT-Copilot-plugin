# The Obsidian plugin is frozen at v2.5.6

OSINT Copilot is now a **standalone desktop application**. The Obsidian plugin is no
longer developed and receives no fixes.

## Why

The plugin was always a desktop program wearing an Obsidian costume — it shelled out
to local CLIs through `child_process`, and its `"isDesktopOnly": false` manifest was
never true. Standalone removes the Obsidian dependency, and along the way fixes
things the plugin could not: Cytoscape and Leaflet are bundled rather than fetched
from a CDN (the graph and map used to be dead on an air-gapped machine), enricher
credentials no longer live in the same process that renders model output, and outbound
requests are checked against private address space.

## Your vault is unchanged

The on-disk layout under `OSINTCopilot/` is byte-identical. Point the app at the same
folder you used as your Obsidian vault and everything is there. Settings are imported
automatically from `.obsidian/plugins/osint-copilot/data.json` on first run; that file
is left in place, so the plugin keeps working if you still have it installed.

You can keep using Obsidian on the same folder for note editing if you prefer — the
app does not lock the vault or change the format.

## Last plugin release

Tag `plugin-final-2.5.6`. `main.js`, `manifest.json` and `styles.css` at that tag are
the final BRAT-installable build.
