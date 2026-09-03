# Personal Portfolio Site

A static portfolio site (plain HTML/CSS/JS — no build step) showcasing case
studies of applied AI / data engineering projects.

## Structure

```
index.html                 Landing page — intro + project grid
about.html                 About/Skills page
contact.html                Contact page
projects/*.html             Individual case study pages
css/style.css                Shared styles
js/main.js                   Nav highlighting + sparkline rendering
```

## Local preview

No build tools required. From the project root:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173` in a browser.

## Deploying to GitHub Pages

1. **Create a GitHub repo.**
   - For a project site: create any repo (e.g. `portfolio`) on github.com.
   - For a user site (serves at `https://<username>.github.io`): create a
     repo named exactly `<username>.github.io`.

2. **Push this folder to it:**

   ```bash
   cd /Users/loganbarger/Desktop/personal_website
   git remote add origin https://github.com/<username>/<repo>.git
   git branch -M main
   git push -u origin main
   ```

3. **Enable Pages:**
   - Go to the repo on GitHub → **Settings → Pages**.
   - Under "Build and deployment", set **Source** to `Deploy from a branch`.
   - Set **Branch** to `main` and folder to `/ (root)`.
   - Save. GitHub will publish the site at:
     - `https://<username>.github.io/` (user site repo), or
     - `https://<username>.github.io/<repo>/` (project repo)

4. Wait ~1 minute, then visit the published URL. Every subsequent `git push`
   to `main` redeploys automatically.

## Content notes

Case study content is adapted from personal project notes, with employer
name, client/vendor names, internal tool/codenames, and exact confidential
figures (dollar amounts, row counts, dashboard counts) generalized or
removed. See the sanitization summary shared during the initial build for
what was changed — review against any applicable separation/confidentiality
agreement before publishing further edits.
