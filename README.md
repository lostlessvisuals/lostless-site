# lostless.live Website

This repository contains the static files for **lostless.live**, a website showcasing generative visuals for live performances, music videos, and installations.

## Running the site locally

The site is completely static. You can preview it locally by serving the files with a simple HTTP server. If you have Python installed, run the following command from the project root:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Purpose of the `CNAME` file

The `CNAME` file tells GitHub Pages to use a custom domain for the site. In this case, the file contains:

```
lostless.live
```

When the site is deployed with GitHub Pages, GitHub reads this file and configures the deployment so that `lostless.live` resolves to the contents of this repository.

## Analytics

This site uses [Plausible](https://plausible.io/) for privacy-friendly analytics. The service offers a free trial and then requires a paid plan. All events are tracked for the `lostless.live` domain.
