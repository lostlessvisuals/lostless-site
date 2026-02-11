(() => {
  const main = document.querySelector('main');
  if (!main) {
    return;
  }

  const fadeClass = 'lazy-fade';
  const loadedClass = 'is-loaded';
  const boundClass = 'lazy-fade-bound';

  const handleImage = (img) => {
    if (!img || img.classList.contains(boundClass)) {
      return;
    }

    img.classList.add(fadeClass, boundClass);

    if (!img.hasAttribute('loading')) {
      img.setAttribute('loading', 'lazy');
    }

    if (img.complete && img.naturalWidth > 0) {
      img.classList.add(loadedClass);
      return;
    }

    img.addEventListener(
      'load',
      () => {
        img.classList.add(loadedClass);
      },
      { once: true }
    );
  };

  const handleVideo = (video, observerInstance) => {
    if (!video || video.classList.contains(boundClass)) {
      return;
    }

    video.classList.add(fadeClass, boundClass);
    video.muted = true;
    video.autoplay = true;

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
        if (!entry.isIntersecting) {
          return;
        }

        const video = entry.target;
        const sources = video.querySelectorAll('source[data-src]');
        sources.forEach((source) => {
          if (!source.src) {
            source.src = source.dataset.src;
          }
        });

        if (sources.length > 0) {
          video.load();
        }

        const playWhenReady = () => {
          const playAttempt = video.play();
          if (playAttempt && typeof playAttempt.catch === 'function') {
            playAttempt.catch(() => {});
          }
        };

        if (video.readyState >= 2) {
          playWhenReady();
        } else {
          video.addEventListener('loadeddata', playWhenReady, { once: true });
        }

        observerInstance.unobserve(video);
      });
    },
    { rootMargin: '300px' }
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
