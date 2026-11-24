# File operation log

Records the file operations Harness agents perform and shows them in the Web GUI.

## Install

Requires a Web or Desktop DSH profile (the Host half needs the `connection` service). Tested with DSH `0.2.2-rc.5`.

- **From this repository:** open Plugins → Add plugin and enter `https://github.com/L5NPC/file-ops-log.git`.
- **From a local folder:** copy this directory to a stable location and enter its absolute path in Add plugin.
- **From a registry:** publish this package under a unique name, then install it by package name.

Installation keeps or links the source directory in the profile, so do not delete or move it afterwards.

## Where it appears

After the bundle is installed and active, the sidebar shows a **File operations** icon. It opens a full page in the main column.

The page lists operations newest first, grouped by day, and offers:

- type filters with counts: create, modify, delete, move, copy, read, other;
- a toggle between newest-first and oldest-first;
- search over paths, commands, tool names, and session ids;
- a manual refresh, plus an automatic refresh every 8 seconds while the page is open;
- each row names the conversation that performed the operation (the Session title); click that name to open the conversation. A subagent session that the list cannot open falls back to its parent conversation, and an unavailable session is shown disabled with the reason.

## What is recorded

The Host half observes the shared tool pipeline (`tools/pre-execute` then `tools/result`) and classifies:

| Tool | Operation |
|---|---|
| `write` | create or modify (from the settled result) |
| `edit` | modify |
| `apply_patch` | create / modify / delete / move, from the patch headers |
| `read`, `read_image` | read |
| `present` | other (deliverable) |
| `office_*` | other (generated file) |
| `bash` | recognized Unix file commands: `rm`, `rmdir`, `unlink`, `shred`, `mv`, `cp`, `rsync`, `ditto`, `ln`, `install`, `mkdir`, `touch`, `mktemp`, `tee`, `truncate`, `dd`, `sed -i`, `perl -i`, `git rm`, `git mv`, `find -delete`, and output redirection |
| `pwsh` | PowerShell/cmd file commands: `Remove-Item` (`del`, `erase`, `rd`, `ri`), `Move-Item` (`move`, `mi`), `Rename-Item` (`ren`, `rni`), `Copy-Item` (`copy`, `cpi`, `xcopy`, `robocopy`), `New-Item` (`md`, `ni`), `Set-Content`, `Add-Content`, `Clear-Content`, `Out-File`, `Tee-Object`, `Invoke-WebRequest -OutFile`, and `>`/`>>` redirection |

Each record stores the operation type, tool, paths, an optional detail (shell command or patch summary, up to 1000 characters), success/failure, start and finish times, duration, and the agent's session id.

A single tool call that performs several operations produces one row per operation, sharing the call's time and detail. Such rows carry a `1/3` marker; if the call failed, their outcome is shown as **Outcome unknown** because the aggregate result cannot say which step failed.

## Limits

- Shell operations are recognized from command text. A file operation hidden inside a script, an alias, or an unusual command form may not be recorded (for example, `bash -c "rm x"` or `node -e "..."`); a command that merely reads files in the shell is not recorded. Output redirection is reported as **modify**, and `find -delete`/`patch` report the operation without inventing target paths.
- Windows: the `pwsh` tool is parsed with PowerShell parameter rules, so `-Path`/`-Destination`/`-FilePath` values are recorded and non-path values such as `-ItemType Directory` or `-Value` are not mistaken for paths. PowerShell-only commands not in the table (for example `Expand-Archive`, `Set-ItemProperty`) are not recorded. `bash` commands on Windows are treated as Unix syntax.
- Only calls that pass through the Harness tool pipeline are recorded. Host-side or external writes are outside the plugin's view.
- The page serves the newest 2000 records kept in memory; the JSONL file keeps more history. When the window is full, the page says so.
- The route is authenticated by the Web carrier and is available to the owning browser session only.

## Data

Records are appended to `$DSH_HOME/plugin-data/file-ops-log/operations.jsonl`
(default `~/.dsh/plugin-data/file-ops-log/operations.jsonl`). The file rotates to
`operations.1.jsonl` at 4 MiB. Removing the directory clears the history.

Disabling the bundle stops recording and removes both the sidebar icon and the page.
