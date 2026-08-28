(() => {
  const main = document.querySelector('main');
  if (!main) {
    return;
  }

  const fadeClass = 'lazy-fade';
  const loadedClass = 'is-loaded';
  const boundClass = 'lazy-fade-bound';
  const videoLoadedFlag = 'videoLoaded';
  const posterLoadedFlag = 'posterLoaded';
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const preferMp4 = window.matchMedia('(pointer: coarse)').matches;
  const revealOnNextPaint = (node) => {
    if (!node || node.classList.contains(loadedClass)) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        node.classList.add(loadedClass);
      });
    });
  };

  const revealAfterDecode = (img) => {
    if (!img) {
      return;
    }

    const finishReveal = () => revealOnNextPaint(img);

    if (typeof img.decode === 'function') {
      img.decode().catch(() => {}).finally(finishReveal);
      return;
    }

    finishReveal();
  };

  const loadVideoSources = (video) => {
    if (!video || video.dataset[videoLoadedFlag] === 'true') {
      return;
    }

    const sources = [...video.querySelectorAll('source[data-src]')];
    // H.264 MP4 is the dependable choice on mobile Safari and older phones.
    // Keep WebM first on computers because it is substantially lighter there.
    if (preferMp4) {
      sources.sort((a, b) => {
        const aIsMp4 = a.type === 'video/mp4' ? 0 : 1;
        const bIsMp4 = b.type === 'video/mp4' ? 0 : 1;
        return aIsMp4 - bIsMp4;
      });
    }
    sources.forEach((source) => {
      video.appendChild(source);
      if (!source.src) {
        source.src = source.dataset.src;
      }
    });

    if (sources.length > 0) {
      video.load();
    }

    video.dataset[videoLoadedFlag] = 'true';
  };

  const loadVideoPoster = (video) => {
    if (!video || video.dataset[posterLoadedFlag] === 'true') {
      return;
    }

    if (video.dataset.poster) {
      video.poster = video.dataset.poster;
    }

    video.dataset[posterLoadedFlag] = 'true';
  };

  const playVideo = (video) => {
    if (!video) {
      return;
    }

    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.catch === 'function') {
      playAttempt.catch(() => {});
    }
  };

  const handleImage = (img) => {
    if (!img || img.classList.contains(boundClass)) {
      return;
    }

    if (img.dataset.heroReveal === 'true') {
      img.classList.add(boundClass);

      if (img.complete && img.naturalWidth > 0) {
        revealAfterDecode(img);
        return;
      }

      img.addEventListener(
        'load',
        () => {
          revealAfterDecode(img);
        },
        { once: true }
      );
      return;
    }

    img.classList.add(fadeClass, boundClass);

    if (!img.hasAttribute('loading')) {
      img.setAttribute('loading', 'lazy');
    }

    if (img.complete && img.naturalWidth > 0) {
      revealOnNextPaint(img);
      return;
    }

    img.addEventListener(
      'load',
      () => {
        revealOnNextPaint(img);
      },
      { once: true }
    );
  };

  const handleVideo = (video, observerInstance) => {
    if (!video || video.classList.contains(boundClass)) {
      return;
    }

    // Keep the poster visible immediately; only the playable sources load lazily.
    video.classList.add(boundClass);
    video.muted = true;
    video.autoplay = !prefersReducedMotion;
    video.controls = prefersReducedMotion;
    video.loop = !prefersReducedMotion;

    if (video.readyState >= 2) {
      video.classList.add(loadedClass);
    } else {
      video.addEventListener(
        'loadeddata',
        () => {
          video.classList.add(loadedClass);
        },
        { once: true }
      );
    }

    if (observerInstance) {
      observerInstance.observe(video);
    }
  };

  const observer = new IntersectionObserver(
    (entries, observerInstance) => {
      entries.forEach((entry) => {
        const video = entry.target;

        if (!entry.isIntersecting) {
          if (!video.paused) {
            video.pause();
          }
          return;
        }

        loadVideoPoster(video);
        loadVideoSources(video);

        if (prefersReducedMotion) {
          return;
        }

        if (video.readyState >= 2) {
          playVideo(video);
        } else {
          video.addEventListener('loadeddata', () => playVideo(video), { once: true });
        }
      });
    },
    // Keep the look-ahead tight so a masonry page does not queue a whole row
    // of large videos while the visitor is still reading the header.
    { rootMargin: '100px 0px' }
  );

  const registerMedia = (node) => {
    if (!node) {
      return;
    }

    if (node.matches && node.matches('img')) {
      handleImage(node);
    }

    if (node.matches && node.matches('video')) {
      handleVideo(node, observer);
    }

    if (node.querySelectorAll) {
      node.querySelectorAll('img').forEach(handleImage);
      node.querySelectorAll('video').forEach((video) => {
        handleVideo(video, observer);
      });
    }
  };

  registerMedia(main);

  const mutationObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        registerMedia(node);
      });
    });
  });

  mutationObserver.observe(main, { childList: true, subtree: true });
})();
