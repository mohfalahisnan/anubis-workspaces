# Knowledge Base engine state lives under Anubis dataDir

When the desktop app spawns the `anubis-engine` binary, it sets `ANUBIS_DB_PATH=<dataDir>/engine/anubis.db` so the engine's sqlite + FTS + vector state is written under `<dataDir>/engine/workdirs/<sha256(workspacePath)[..16]>/` — co-located with `config.json` and the rest of Anubis-owned state — rather than the engine's own default `%APPDATA%\com.anubis-os.app\workdirs\…`.

We chose this over the default because the engine binary is a separately-installed tool whose own appdata is invisible to Anubis: leaving state there means uninstalling Anubis orphans the index, and Project deletion can't deterministically clean up. With `ANUBIS_DB_PATH` set, each Project's state is at a predictable path (the `WorkdirId` is `sha256(canonical workspacePath)[..16]`) so deleting a Project becomes `rm -rf <dataDir>/engine/workdirs/<id>/`, and a clean uninstall takes everything with it.

The trade-off: a user who also drives the engine binary directly from their own scripts will see two state silos — Anubis's and the engine's default. We accept that; the alternative was orphaned state on every uninstall.
