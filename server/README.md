# The homepage

The public landing page for watsmytask. One self-contained `index.html` — no build step,
no dependencies, no framework. Open it in a browser or drop it on any static host.

> Not to be confused with `src/server/`, which is the actual application server. Nothing
> in this folder is served by the app; it is marketing, and it ships with neither the npm
> package nor the installers.

## Publishing it

`.github/workflows/pages.yml` deploys this folder to GitHub Pages on every push to `main`
that touches `server/`. It can also be run by hand from the Actions tab.

**One-time setup, by a human with admin on the repo:**
Settings → Pages → Build and deployment → Source: **GitHub Actions**.

This cannot be automated. Creating a Pages site for the first time needs repository-admin
rights, and the `GITHUB_TOKEN` a workflow runs under does not have them — the attempt
fails with *"Resource not accessible by integration"*. Once the switch is flipped, every
deploy after it runs unattended.

Pick **GitHub Actions** as the source, not "Deploy from a branch" — the branch option
ignores this workflow entirely and would serve the repo root instead of `server/`.

The page then lives at `https://charmflex-studio.github.io/Smart-Task-Planner/`.

**The repository has to be public.** On a free plan GitHub Pages will not serve from a
private repository, and the download button points at a release asset that a signed-out
visitor has to be able to fetch. Both fail closed if the repo is private.

## Editing it

Everything lives in the one file: tokens at the top of the `<style>` block, then the
sections in the order they appear on the page, then a short `<script>` at the bottom.

- **Colour** comes from the app's own palette (`src/web/styles.css`), so the page and the
  product read as one thing. Change the accent in both or neither.
- **Both themes are token-level.** The bare `:root` block holds the complete light palette;
  `@media (prefers-color-scheme: dark)` and `:root[data-theme="dark"]` redefine the same
  token names and nothing else. Never declare a colour only inside one of those blocks — a
  viewer on the default "system" setting gets no `data-theme` attribute at all, and a
  colour defined only there never applies.
- **The reveal animation is scoped to `html.js`.** With scripting off, the rules do not
  apply and the content is simply visible. Keep the hide and the reveal at comparable
  specificity: scoping only the hide once left `html.js .rise` outranking
  `.revealed .rise`, and the hero never appeared.
- **The download button points at a stable asset name.**
  `/releases/latest/download/watsmytask-installer.zip` is resolved by GitHub to whatever
  the newest release holds, but only while the asset is named exactly that. If the name in
  `setup/build-release.sh` ever changes, this link breaks silently — it will 404 rather
  than fall back to anything.
- **Every claim on the page is real.** The task file, the diff, the lane names, the
  attention wording ("Overdue by 2 days") and the tool lists are what the app actually
  produces. If behaviour changes, this page is wrong until it is updated too.
