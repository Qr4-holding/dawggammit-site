# DAWG GAMMIT site and shop admin

- **dawggammit.com**: the public shop window (lookbook, collections, product lines). Every Buy now button links to the product's own page on the checkout store.
- **dawggammit.com/admin**: password-protected admin. Paste KoolTeez product or collection links and the server reads the name, price and photos (it sorts plain product shots from photos of people wearing them). Manage collections, product lines and the lookbook (KoolTeez photos or uploads). Changes save as a draft; **Publish** puts them live. **Preview draft** shows the unpublished version.

- **dawggammit.com/admin/videos**: the video studio. Pick products from the shop (or paste KoolTeez links) and it makes 9:16 promo videos of 15 s or less: voiceover (Andray, per product, via ElevenLabs; or the generic Wanted Cowboy / Female cuts), Robert's music, the product big on parchment, an opening and closing thumbnail. Each video lands in a review queue with TikTok, Instagram, Facebook, YouTube Shorts and Pinterest captions, hashtags and buy links. **Approve** uploads it to Postiz and schedules it on every connected channel at the next free posting time. Settings holds the Postiz API key, channel choice, Pinterest board, posting times and the library (music, voice cuts, backgrounds: private, uploaded as a zip, never in this repo).

How it runs: a small Node app (`app/server.js`, page builder `app/render.js`) behind the shared Caddy proxy on the Hostinger VPS, project `dawggammit` (see `docker-compose.yml`). Shop data (`store.json`) and uploads live in the project's `data` volume. The `studio` service (`studio/worker.py`, engine `studio/engine/dgq.py`) renders the videos with HyperFrames; the admin side is `app/studio.js` and `app/videos.html`. Videos live in `data/videos/`, the private library in `data/studio-library/`. The first start seeds the shop from `app/seed.json`.

dawggamit.com (single M) permanently redirects to dawggammit.com.

To change the code: push to `main`, then restart the `dawggammit` project on the VPS.
