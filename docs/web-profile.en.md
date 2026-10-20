# Shared Web profile (local branch)

`sh bin/dsh-tui-web` runs the official DSH CLI with `--profile web` and
`cordis.web-ui.patch.yml`. It reads the actual Web profile, its installed
packages, its user patch and the home patch on every launch. There is no
copied TUI backend manifest to synchronize.

The overlay adds terminal UI services, replaces Web's argument parser and
uses a private loopback port so the normal Web server on port 3080 keeps
running. It does not open a browser. Web's host plugins, including KB,
Pi compatibility, SSH and LiveVoice, remain the same installed packages.
LiveVoice's microphone/audio controls remain a browser interface.

`dsh-tui.followProfileDefaults: true` makes the shared DSH services own the
default model, effort and preset. Old `~/.dsh-tui/model.json`, `effort.json`,
`agent-preset.json`, permission defaults and TUI effort-default settings do
not override them. Terminal display preferences still apply. TUI-specific
model-facing tool additions, prompt filters and retry defaults are skipped.
Model and preset selections made in the TUI use the shared settings owner.
Explicit selections and existing session history remain session-specific,
as in Web; changing a default does not rewrite old conversation history.

DSH's existing HMR watches Web's profile patch and bundle list. Configuration
edits and bundle additions/removals are applied while the TUI runs. New
sessions read the current defaults. Changes to already loaded core code or
package resolution may require a TUI restart; restarting reads the current
Web installation automatically, without a second update or copy command.
The terminal UI source itself is maintained in this local branch.

This shares configuration and packages, not a running Agent process. Web and
each TUI keep their own live agents while using the same session storage.

Verification:

```sh
npm run compile:src
node scripts/verify-web-profile-follow.mjs
python3 scripts/verify-web-profile-pty.py
```

These fixtures use isolated homes and block external fetches. The first
checks backend composition equality and live configuration/bundle changes;
the second exercises the real terminal UI with conflicting saved preferences
and a subsequent `/new` after a Web edit.
