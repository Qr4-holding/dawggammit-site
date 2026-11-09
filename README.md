# DAWG GAMMIT site and shop admin

- **dawggammit.com**: the public shop window (lookbook, collections, product lines). Every Buy now button links to the product's own page on the checkout store.
- **dawggammit.com/admin**: password-protected admin. Paste KoolTeez product or collection links and the server reads the name, price and photos (it sorts plain product shots from photos of people wearing them). Manage collections, product lines and the lookbook (KoolTeez photos or uploads). Changes save as a draft; **Publish** puts them live. **Preview draft** shows the unpublished version.

How it runs: a small Node app (`app/server.js`, page builder `app/render.js`) behind the shared Caddy proxy on the Hostinger VPS, project `dawggammit` (see `docker-compose.yml`). Shop data (`store.json`) and uploads live in the project's `data` volume. The first start seeds the shop from `app/seed.json`.

dawggamit.com (single M) permanently redirects to dawggammit.com.

To change the code: push to `main`, then restart the `dawggammit` project on the VPS.
