# ShipYard landing page

The public marketing site for ShipYard. A static Vite site with no framework: the page is plain
HTML (so search engines read all of it), and a small script runs the hero's deploy replay, the
theme toggle and the copy button.

It is not part of the `packages/*` workspace, so the platform's own builds and installer ignore it.

```bash
cd landing
bun install
bun run dev       # http://localhost:5173
bun run build     # static files in dist/
```

## Deploy it with ShipYard

Create a project from this repository with:

- **Framework:** Vite
- **Root directory:** `landing`
- **Build command:** `bun run build`

Nginx serves `dist/` directly, with no app process. Push to `main` and it redeploys.

The build also publishes the platform installer at `/install.sh`, read from
`../scripts/install.sh` (see `vite.config.ts`), so
`curl -fsSL https://shipyard.thakur.dev/install.sh | bash` always runs the installer from the
deployed commit.

## Domain

The site lives at https://shipyard.thakur.dev. The canonical link, social preview tags,
structured data, `public/sitemap.xml` and `public/robots.txt` all name that URL, so update
them together if it moves.

`public/og.png` is a 1200x630 capture of the hero. Retake it after changing the hero.
