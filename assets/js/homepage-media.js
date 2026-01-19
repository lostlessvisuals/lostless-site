(() => {
  const gallery = document.querySelector('.gallery-grid');
  if (!gallery) {
    return;
  }

  const fadeClass = 'lazy-fade';
  const loadedClass = 'is-loaded';

  const images = gallery.querySelectorAll('img');
  images.forEach((img) => {
    img.classList.add(fadeClass);

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
  });

  const videos = Array.from(gallery.querySelectorAll('video'));
  videos.forEach((video) => {
    video.classList.add(fadeClass);

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
  });

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

        observerInstance.unobserve(video);
      });
    },
    { rootMargin: '300px' }
  );

  videos.forEach((video) => {
    observer.observe(video);
  });
})();
