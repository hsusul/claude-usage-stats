# usage-stats

A Claude Code mod that opens a side panel with your Claude Code activity: a 26-week heatmap, current and longest streaks, sessions, messages, favorite model, prompts by hour of day, and total tokens split into cache read, cache write, output and input.

It works in the Claude desktop app's Code tab and in the terminal. The terminal shows a 30-day sparkline in place of the heatmap.

## How it works

`scripts/compute.py` reads your local session transcripts in `~/.claude/projects` and prints a JSON summary. It keeps a per-file cache in `~/.cache/claude-stats-mod/`, so the first scan takes a while on a large history and later refreshes take well under a second. Nothing leaves your machine.

The panel opens when a session starts and refreshes every 10 minutes. Press **Refresh** to update it now, or run `/usage-stats` to reopen it.

Requires `python3` (the macOS system Python works).

## Install

At the prompt of a terminal session:

```
/plugin install usage-stats --marketplace hsusul/claude-usage-stats
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```bash
claude plugin install usage-stats --marketplace hsusul/claude-usage-stats
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `hsusul/claude-usage-stats`, then Add plugin.
