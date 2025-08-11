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

## Adding videos

Videos in the work grid use lightweight poster images so browsers can display a static thumbnail without fetching the full file. When adding a new video:

1. Place the video in `assets/media` (e.g. `video36.mp4`).
2. Extract a poster frame and save it in `assets/media/posters`:

   ```bash
   ffmpeg -ss 0.1 -i assets/media/video36.mp4 -vframes 1 assets/media/posters/poster36.webp
   ```

3. Reference the poster and set `preload="metadata"` on the `<video>` tag:

   ```html
   <video src="/assets/media/video36.mp4" poster="/assets/media/posters/poster36.webp" preload="metadata" autoplay muted loop playsinline></video>
   ```

This ensures each video shows a thumbnail and defers heavy downloads until playback is requested.

> Note: poster images are not tracked in git; generate them locally before deployment.
