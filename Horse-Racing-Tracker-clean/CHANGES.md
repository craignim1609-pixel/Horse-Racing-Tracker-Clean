# Cleanup notes

## Removed (all verified unused)
- Backend: `routers/export.py` and `utils/excel.py` (never registered; would have crashed), duplicate `/picks/*`
  update/cancel/delete endpoints, `/stats/month`, `/stats/player`, `/stats/acca`, `/stats/dashboard`,
  `/api/raceday/recent`, the orphaned `/current-picks` page + template, 3 unused schemas, unused imports.
- `requirements.txt`: dropped `pandas` and `openpyxl` (nothing used them) - much faster deploys.
- JS: 22 dead functions, debug console.logs, duplicate export/init blocks (1,711 -> ~1,030 lines).
- CSS: 59 rules that matched nothing (33.9 KB -> 27.9 KB). Pages are pixel-identical.

## Bugs fixed
- Acca page made every API call twice; Stats page fetched history 4x.
- Each export click downloaded TWO files. Now one.
- Completed accumulators on Stats showed no pick tiles (wrong field names).
- Stats defaulted to April; now defaults to the current month/year.
- JS pointed at the live Railway URL, so a local test run would talk to production. Now same-origin.
- CSS was linked twice; homepage loaded the whole JS file for nothing; "Groupe" typo.

## Renamed
- `app_v10001.js` -> `app_v10002.js` so browsers don't use a stale cached copy.

## Added: Race Predictor (step 1)
- New page `/predictor` (menu: Predictor): pick date -> course -> race, enter runners, form, jockey, trainer
  and Sky Bet odds. Shows each horse's chance (bookmaker margin removed), jockey / trainer win records,
  and flags a jockey + trainer combo as "Formidable" (20+ runs together, 25%+ strike rate).
- Data is typed in for now. It is stored in three new tables (`predictor_races`, `predictor_runners`,
  `connection_stats`), created automatically on startup - existing tables are untouched. A data feed can
  fill the same tables later without changing the screens.
- Menu now wraps on phones so the sixth link fits.

