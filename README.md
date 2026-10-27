# portfolio

A [Quarto](https://quarto.org) website that presents my projects and hosts their static
demos, starting with the browser version of the Snellen screening toy.

The site is fully static: Quarto renders the `.qmd` pages to `_site/`, and each demo's
built files are copied in unchanged from `demos/`. There are no secrets anywhere in the
repo or the site.

## Setup

    brew install --cask quarto   # once; the installer asks for your password
    direnv allow                 # runs `uv sync`, activates .venv, sets QUARTO_PYTHON

The uv project has no dependencies yet. It's there so Python code cells (and anything
they need, added with `uv add`) run in this repo's own venv.

## Work on it

    quarto preview               # live-reloading local server
    quarto render                # full build into _site/

## Layout

| Path | What it is |
|---|---|
| `_quarto.yml` | Site config: navbar, theme, which files render, `demos/**` as resources |
| `styles.scss` | Theme overrides on top of Bootstrap's cosmo (light) and darkly (dark) |
| `index.qmd` | Home page, with the most recent projects |
| `projects.qmd` | Listing of every `projects/*/index.qmd` |
| `about.qmd` | About page |
| `projects/<name>/index.qmd` | One page per project |
| `projects/_template/` | Copy this to start a new project page (not rendered) |
| `images/` | Shared images (profile photo, placeholders) |
| `demos/<name>/` | A project's built static demo, served at `/demos/<name>/` |
| `scripts/sync-demos.sh` | Copies built demos from the project repos into `demos/` |

## Add a project

    cp -r projects/_template projects/<name>

Then fill in the front matter and every `TODO:` in `projects/<name>/index.qmd`, and
replace `thumbnail.svg` with a real screenshot (16:9 works best). The project shows up
on the Projects page automatically.

## Add or update a demo

A demo is any folder of static files with an `index.html`, using relative paths.

    scripts/sync-demos.sh            # copy the demos as last built
    scripts/sync-demos.sh --build    # rebuild them in their own repos first

The script expects the projects in `~/code/lorcanob/` (override with `CODE_DIR`). To
add a new demo, add a `sync_zip` (or copy) line to the script and link to
`/demos/<name>/` from the project page.

The demo files are committed, because CI can't reach the project repos. **Everything in
`demos/` is public**, both in this repo and on the site. For example, the snellen demo
ships a browser-only `snellen` wheel: bytecode with no source or docstrings, which makes
the code harder to read but not secret.

## Publishing

The site is published to GitHub Pages from the `gh-pages` branch.

- **Automatically:** every push to `main` runs `.github/workflows/publish.yml`, which
  renders the site and pushes it to `gh-pages`.
- **By hand:** `quarto publish gh-pages` does the same from your machine. It's needed
  once, to create the `gh-pages` branch before the workflow can use it.

Code cells (none yet) aren't run in CI: render locally so their results are saved in
`_freeze/`, and commit that.

## TODO checklist

Search for `TODO:` to find every placeholder (`grep -rn "TODO:" --include="*.qmd" --include="*.yml" --include="*.scss" .`).

- [ ] Site title, description and footer (`_quarto.yml`)
- [ ] Confirm `site-url` and `repo-url` once the GitHub repo exists
- [ ] Home page intro (`index.qmd`)
- [ ] About page: name, bio, photo, links (`about.qmd`, `images/profile.svg`)
- [ ] Snellen page: summary, what I built, screenshot (`projects/snellen/`)
- [ ] Receipt OCR page: summary, what I built, screenshot (`projects/receipt-ocr/`)
- [ ] Decide which other projects to add
- [ ] Brand colours and fonts (`styles.scss`)
