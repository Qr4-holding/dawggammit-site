# DAWG GAMMIT shop window

The public DAWG GAMMIT™ site: a single page (`site/index.html`) showing the Western collections, with every Buy now button linking to the product's own page on the checkout store.

- Served by nginx behind the shared Caddy proxy on the Hostinger VPS (project `dawggammit`, see `docker-compose.yml`). Main address dawggammit.com; dawggamit.com redirects to it.
- Product photos load from the store's image server; the hero photos and the ChunkFive logo font are embedded in the page.
- To update: change `site/index.html`, push to `main`, then restart the `dawggammit` project on the VPS.
