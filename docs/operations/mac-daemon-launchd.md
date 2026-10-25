# Mac daemon under launchd

Without supervision the Mac daemon runs in a terminal and stays down after a
crash, logout or reboot. launchd supervision keeps it running.

```sh
cd ~/Developer/leilei-os-main
pnpm runtime:native-live-mac-daemon:launchd install   # once
pnpm runtime:native-live-mac-daemon:launchd status
```

- **Starts** at login (`RunAtLoad`) and **restarts** after any nonzero exit
  (`KeepAlive.SuccessfulExit = false`). A clean stop is not restarted.
- **Crash backoff:** a crash within 120 s of starting counts as a quick
  failure; the next start waits 10 s, 20 s, 40 s … up to 5 min. A run longer
  than 120 s resets the count. `restart`, `start` and `fresh` clear it.
- **Configuration** comes from `.env` in the canonical checkout, not from the
  shell profile. `install` checks this with an empty environment and refuses
  if, for example, the relay token is only exported in `~/.zshrc`. The Node 22
  and `PATH` in use at install time are pinned into the agent.
- **Updating:** `pnpm runtime:native-live-mac-daemon:fresh` keeps its Git
  guards and then restarts the launchd job. `fresh-current` on a feature
  branch of the canonical checkout restarts it on that branch; from any other
  checkout it refuses until you run `... :launchd stop`.
- **Logs** (`~/.leileios/logs/`): `native-live-daemon.log` (daemon output,
  rotated at 10 MB), `native-live-daemon-supervisor.log` (start, exit status,
  run time, backoff), `native-live-daemon-launchd.log` (wrapper failures).

| Command | Effect |
| --- | --- |
| `install` | Check, stop any terminal daemon, write `~/Library/LaunchAgents/com.leileios.native-live-mac-daemon.plist`, load |
| `stop` | Unload until the next login or `start` |
| `start` | Load again |
| `restart` | `launchctl kickstart -k` |
| `status` | launchd state, PID, last exit code and recent supervisor records |
| `uninstall` | Unload and remove the agent; use `fresh` from a terminal again |
