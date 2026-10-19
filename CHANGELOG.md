# Changelog

## 0.2.0

- Claude Code only. Uses the local `claude` CLI for the cheap worker; no API keys anywhere.
- `setup` installs rtk and GitNexus from their official sources, wires them into Claude Code, verifies the result.
- `rtk`, `gitnexus`/`gn`, `index` passthrough commands run the originals unchanged.
- `update` pulls upstream releases via each tool's own update path.
- `delegate enable|disable|read|write`: Spotify-style bulk-read and code-write delegation with fail-open hooks.
- `report` and `dashboard`: spent vs without-tools analysis, per lane, with measured/reported/estimated labels.
- `verify`, `graph-bench`, `uninstall`.

## 0.1.0

- Initial prototype (superseded).
