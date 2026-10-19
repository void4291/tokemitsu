# Notice and credits

tokemitsu is an independent, unofficial wrapper. It is **not affiliated with or endorsed by** any project or
author named below. All names are trademarks of their owners and are used only to identify the software.

## What this package contains and does not contain

- The code in this repository is original and is released under the MIT License (see `LICENSE`).
- It does **not** copy, bundle, vendor, modify or redistribute any code from rtk or GitNexus. Both are installed
  on the user's machine from their own official channels, by their own installers, and are updated by their own
  maintainers (`tokemitsu update` simply calls their update path).
- It declares **no npm dependency** on either project.

## Upstream projects (used, not included)

| Project | Role here | Source | License |
| --- | --- | --- | --- |
| **rtk** (Rust Token Killer) | Compresses shell-command output before it reaches the model. Installed via brew / its install script / cargo. | <https://github.com/rtk-ai/rtk> | Apache-2.0 |
| **GitNexus** | Local code knowledge graph exposed over MCP. Installed via `npm install -g gitnexus`. | <https://github.com/abhigyanpatwari/GitNexus> | PolyForm Noncommercial 1.0.0 |

**GitNexus licensing matters to you.** PolyForm Noncommercial permits noncommercial use only. Using GitNexus for
commercial work (including at a company) requires a separate license from its authors. tokemitsu asks you to
acknowledge this before installing it, but the obligation is yours. This package's MIT license does not grant any
rights to GitNexus or rtk. Check each project's current license before relying on this summary.

## Ideas and attribution

- The **cheap-model delegation** lane (blocking large whole-file reads and shell reads, answering from a cheaper
  model, delegating boilerplate generation) follows the pattern described by Dimitri Mazmanov in Spotify
  Engineering's post on cutting coding-agent cost. Only the idea is used; the prompts, hooks and code here are
  our own. Please read the original post.
- The **three-lane framing** (shrink tool output / precompute structure / delegate bulk work) comes from
  Wajahat Rahman's article "AI Token Economics: Your Agent on a Budget"
  (<https://medium.com/@wajahat.rahman/ai-token-economics-your-agent-on-a-budget-b6f37b74ee48>).
- "Claude" and "Claude Code" are trademarks of Anthropic. This tool reads Claude Code's local session logs and
  calls the user's own `claude` CLI; it is not an Anthropic product.

If you are an author of any project above and want wording changed or credit added, please open an issue.
