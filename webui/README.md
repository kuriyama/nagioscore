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
