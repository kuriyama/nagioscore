# nagios webui

TypeScript source for the nav + search + dashboard SPA that `html/index.html`
loads (see `src/main.ts`). This directory is **not** packaged (it lives
outside `html/`, so the RPM's `html/[^cd]*` glob never sees it).

The build output is committed directly to `../html/js/nagios-app.js` rather
than built during `rpmbuild` -- this avoids adding Node/npm as a
BuildRequires. If you change anything under `src/`, rebuild and commit the
result:

```sh
npm install
npm run build      # writes ../html/js/nagios-app.js
npm run typecheck   # `tsc --noEmit`, also run by CI if configured
```

`update-version` edits `src/dashboard.ts` directly for version/date bumps;
re-run `npm run build` afterwards so the committed bundle picks up the change.

## Known behavioral differences from upstream

Things a user coming from stock nagios-core's CGIs would notice are
different in this SPA. These are deliberate (or at least accepted)
choices, not bugs -- listed here so they don't get "fixed" back toward
upstream by accident, and so the reasoning survives past the commit that
introduced them.

- **Inline "Ack"/"Downtime" quick-action links on every host/service row**
  (`hosts.ts`/`services.ts`, `commands.ts`). Upstream's `status.cgi` list
  only shows read-only status icons per row; acknowledging a problem or
  scheduling downtime is done from `extinfo.cgi`'s per-object command
  dropdown, one host/service at a time. This fork adds the two most
  common actions directly to the list. "Downtime" is always shown
  (you can pre-schedule maintenance on a healthy host too); "Ack" only
  shows for an unhandled problem (down/unreachable/warning/critical/
  unknown and not yet acknowledged).
- **Commands commit directly, no confirmation page.** `commands.ts`
  submits to `cmd.cgi` with `cmd_mod=2` (commit) straight away, since the
  SPA already shows its own confirmation modal first. Upstream's normal
  links omit `cmd_mod`, so `cmd.cgi` always shows an intermediate
  "are you sure" page before committing.
- **Comment/author is always required** when acknowledging or scheduling
  downtime. Upstream's requirement for this depends on `cgi.cfg`
  (`force_authorized_for_*`-style settings aren't currently read); this
  fork always asks, erring safe rather than reading that config
  dynamically.
- **Downtime start/end time parsing assumes `cgi.cfg`'s `date_format` is
  unset** (`commands.ts`'s `formatUsDateTime`), i.e. the server default
  `DATE_FORMAT_US` (`MM-DD-YYYY HH:MM:SS`, see `cgi/cmd.c`'s
  `string_to_time()`). The JSON API doesn't expose the configured
  `date_format`, so a deployment that sets it to EURO/ISO8601/
  STRICT_ISO8601 will have downtime scheduling submit the wrong
  timestamp. `actions.ts`'s confirmation dialog spells out the assumed
  format so a mismatch is at least visible before submitting.
- **Last-check/timestamp columns use a fixed `YYYY-MM-DD HH:MM:SS`
  display format** (`format.ts`'s `formatTimestamp`) regardless of the
  server's `date_format` setting, for the same reason (not exposed via
  the JSON API). This is a display-only version of the same limitation,
  independent of the command-submission one above.
- **Scheduling Queue omits the "forced passive check" edge case.**
  Upstream's `extinfo.cgi?type=7` also lists a `should_be_scheduled ==
  FALSE` entry when it's a passive-only check that was manually
  force-rescheduled once. `schedulingqueue.ts` only shows
  `should_be_scheduled == TRUE` entries.
- **Process Info is read-only.** Upstream's `extinfo.cgi?type=0` also has
  shutdown/restart/enable-disable links for the running process;
  `processinfo.ts` only displays `programstatus` fields, since acting on
  those isn't something the JSON API's response shape is about (it *is*
  possible via `cmd.cgi`, just not implemented here yet).
