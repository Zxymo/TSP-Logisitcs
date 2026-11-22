# TSP Logistics

Delivery management frontend with one Vercel serverless API backed by TiDB.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the TiDB connection values.
3. Run `npm run dev` and open the local URL printed by Vercel.

Do not put TiDB credentials in browser JavaScript or commit `.env.local`.

## Vercel deployment

Deploy this folder as the Vercel project root, then add the TiDB variables under
**Project Settings → Environment Variables** and redeploy:

| Variable | Description |
| --- | --- |
| `DB_HOST` | TiDB cluster hostname |
| `DB_PORT` | TiDB port; defaults to `4000` |
| `DB_USERNAME` | Database user |
| `DB_PASSWORD` | Database password |
| `DB_DATABASE` | Database containing the app's tables and view |
| `TIDB_CA_CERT` | Optional PEM CA certificate, if required by the cluster |
| `CORS_ORIGIN` | Comma-separated website origins allowed to call the API |

The API also accepts the older `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`,
`TIDB_PASSWORD`, and `TIDB_DATABASE` names. `DB_*` values take precedence
when both naming styles are configured.

The API uses TLS with certificate verification. Keep the TiDB cluster network
access configured to allow connections from your deployment.

## Connecting a separately hosted website

If the website and API use different Vercel projects/domains:

1. In `index.html`, set the `api-base-url` meta tag to the API project's origin,
   for example `https://your-api-project.vercel.app` (no trailing slash or
   `/api`).
2. In the API Vercel project, set `CORS_ORIGIN` to the website's exact origin,
   for example `https://your-site.vercel.app`. For multiple approved website
   origins, separate them with commas.
3. Redeploy both projects. The website will call
   `https://your-api-project.vercel.app/api?action=dashboard` and submit
   deliveries to the same API.

If the website and API share a Vercel project/domain, leave `api-base-url`
empty; same-origin requests will use `/api` automatically. Never put database
credentials in the website or the meta tag.

## API

- `GET /api?action=dashboard` checks TiDB and returns active rates and the
  latest 100 delivery records.
- `GET /api?action=health`, `GET /api?action=options`, and
  `GET /api?action=deliveries` provide individual actions through the same
  endpoint.
- `POST /api?action=deliveries` validates an active rate and inserts a record
  into `delivery_records`; `price_php` is taken from `rate_vat_inc`.
- `DELETE /api?action=deliveries&id=<id>` archives a record using
  `archived_at`; the record remains in TiDB.
- `GET /api?action=export` downloads all records, including archived ones, as
  an Excel `.xlsx` file with `DATE`, `DR NO.`, `CUSTOMER'S NAME`,
  `DESTINATION`, and `HAULING RATE` columns.

The database must already contain the `delivery_records` table and the
`vw_active_hauling_rates` view shown in the supplied schema. Post length is
stored in feet. The selected location and truck length determine the truck
rate: 40/45 ft uses `REG_40_45`, 50 ft uses `EXT_50`, and 55/60 ft uses
`EXT_55_60`. Destinations are displayed as `City, Province`. The API looks up
and saves the VAT-inclusive rate from TiDB.

## Delivery log operations

Before deploying the archive feature, run
[`database/add_delivery_archived_at.sql`](./database/add_delivery_archived_at.sql)
once against the `tsp_hauling_db` database. Archiving hides a delivery from
the active list but keeps it in the database and in XLSX exports.

The archive action is available to any caller who can reach the API. CORS
limits browser origins but is not authentication; use this only for a trusted
internal app. If the API is deployed from a separate repository, include both
`mysql2` and `exceljs` in that repository's root `package.json`.
