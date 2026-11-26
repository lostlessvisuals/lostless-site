(() => {
  const main = document.querySelector('main');
  if (!main) {
    return;
  }

  const fadeClass = 'lazy-fade';
  const loadedClass = 'is-loaded';
  const boundClass = 'lazy-fade-bound';
  const videoLoadedFlag = 'videoLoaded';
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const preferMp4 = window.matchMedia('(pointer: coarse)').matches;
  const videoStates = new Map();
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

  const whenImageReady = (image, reveal) => {
    if (typeof image.decode === 'function') {
      image.decode().then(reveal, reveal);
    } else if (image.complete) {
      reveal();
    } else {
      image.addEventListener('load', reveal, { once: true });
      image.addEventListener('error', reveal, { once: true });
    }
  };

  const loadVideoPoster = (video) => {
    if (!video.getAttribute('poster') && video.dataset.poster) {
      video.setAttribute('poster', video.dataset.poster);
    }
    if (video.getAttribute('poster')) video.classList.add(loadedClass);
  };

  const loadVideoSources = (video) => {
    if (!video || video.dataset[videoLoadedFlag] === 'true') {
      return;
    }

    loadVideoPoster(video);
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
      if (!source.src) {
        source.src = source.dataset.src;
      }
      video.appendChild(source);
    });

    video.dataset[videoLoadedFlag] = 'true';
    if (sources.length > 0) {
      video.load();
    }
  };

  const handleImage = (img) => {
    if (!img || img.classList.contains(boundClass)) {
      return;
    }

    if (img.dataset.heroReveal === 'true') {
      img.classList.add(boundClass);
      whenImageReady(img, () => revealOnNextPaint(img));
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

  // Read current geometry again at readiness/promise boundaries: observer entries
  // can become stale while a request is pending or masonry columns settle.
  const isVisible = (video) => {
    const rect = video.getBoundingClientRect();
    return video.isConnected && !document.hidden && rect.width > 0 && rect.height > 0 &&
      rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right > 0 && rect.left < window.innerWidth;
  };

  const wantsPlayback = (video, state) => isVisible(video) &&
    state.intent !== 'pause' && !state.blocked && !state.failed &&
    (!state.waitingForReveal || state.intent === 'play') &&
    (!prefersReducedMotion || state.intent === 'play');

  const updatePlaybackAction = (video, state) => {
    if (state.control) {
      const waitingToPlay = state.pending !== null && state.intent !== 'pause';
      const action = state.failed ? 'Retry' : !video.paused || waitingToPlay ? 'Pause' : 'Play';
      state.control.textContent = action;
      state.control.setAttribute('aria-label', `${action} animation`);
      state.control.hidden = false;
      return;
    }
    // Gallery artwork is its own recovery target.
    const needsAction = state.togglePlayback || (video.paused && !state.pending &&
      (state.failed || state.blocked || prefersReducedMotion));
    if (needsAction) {
      video.setAttribute('role', 'button');
      video.setAttribute('tabindex', '0');
      const action = state.failed ? 'Retry' : video.paused ? 'Play' : 'Pause';
      video.setAttribute('aria-label', `${action}: ${state.label}`);
    } else {
      video.removeAttribute('role');
      video.removeAttribute('tabindex');
      video.setAttribute('aria-label', state.label);
    }
  };

  const stopVideo = (video, state) => {
    const wasPending = state.pending !== null;
    state.pending = null;
    state.generation += 1;
    video.autoplay = false;
    if (!video.paused || wasPending) video.pause();
    updatePlaybackAction(video, state);
  };

  const playVideo = (video, state) => {
    if (!wantsPlayback(video, state) || state.pending || !video.paused) return;
    const generation = ++state.generation;
    state.pending = generation;
    updatePlaybackAction(video, state);
    // Gesture recovery calls play synchronously, before any readiness events.
    try {
      Promise.resolve(video.play()).then(() => {
        if (!wantsPlayback(video, state)) video.pause();
        if (state.generation !== generation) return;
        state.pending = null;
        updatePlaybackAction(video, state);
      }).catch((error) => {
        if (state.generation !== generation) return;
        state.pending = null;
        if (error.name === 'NotSupportedError') {
          state.failed = true;
          if (!video.getAttribute('poster')) video.classList.remove(loadedClass);
        }
        // A load/visibility interruption is not an autoplay-policy denial.
        if (error.name === 'NotAllowedError' && isVisible(video)) state.blocked = true;
        updatePlaybackAction(video, state);
      });
    } catch (_) {
      state.pending = null;
      state.blocked = true;
      updatePlaybackAction(video, state);
    }
  };

  const syncVideo = (video) => {
    const state = videoStates.get(video);
    if (!state) return;
    if (!wantsPlayback(video, state)) {
      stopVideo(video, state);
      return;
    }
    // Let Safari use its native muted-autoplay path as well as play(). Keep
    // autoplay disabled offscreen and when reduced motion requests a still card.
    video.autoplay = !prefersReducedMotion;
    loadVideoSources(video);
    // play() must initiate the visible load: browsers honoring preload="none"
    // may never emit loadeddata until playback has actually been requested.
    playVideo(video, state);
  };

  const handleVideo = (video) => {
    if (!video || video.classList.contains(boundClass)) {
      return;
    }

    const sibling = video.nextElementSibling;
    const control = sibling?.hasAttribute('data-video-playback-control') ? sibling : null;
    const togglePlayback = Boolean(control) || video.hasAttribute('data-playback-toggle');
    if (!togglePlayback && !video.closest('.gallery-item')) return;
    const parent = video.parentElement;
    const revealVisual = !prefersReducedMotion && parent?.hasAttribute('data-video-reveal');
    const state = { label: video.getAttribute('aria-label') || 'portfolio video',
      intent: 'auto', blocked: false, failed: false, togglePlayback, control,
      waitingForReveal: revealVisual,
      pending: null, generation: 0, loadingStarted: false, sourceErrorTimer: null,
      failedSources: new Set() };
    videoStates.set(video, state);

    // The native poster and the decoded video share the same surface.
    video.classList.add(fadeClass, boundClass);
    if (video.getAttribute('poster')) video.classList.add(loadedClass);
    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = false;
    video.controls = false;
    video.loop = !prefersReducedMotion;
    video.addEventListener('loadstart', () => {
      if (video.dataset[videoLoadedFlag] !== 'true') return;
      clearTimeout(state.sourceErrorTimer);
      state.loadingStarted = true;
      state.failedSources.clear();
    });
    const ready = () => {
      if (video.readyState >= 2 && !video.error) {
        clearTimeout(state.sourceErrorTimer);
        state.failed = false;
        state.failedSources.clear();
        video.classList.add(loadedClass);
      }
      syncVideo(video);
    };
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
    video.addEventListener('playing', () => {
      // Native autoplay may succeed after an earlier play() denial.
      state.blocked = false;
      if (!wantsPlayback(video, state)) stopVideo(video, state);
      else updatePlaybackAction(video, state);
    });
    video.addEventListener('pause', () => updatePlaybackAction(video, state));
    video.addEventListener('ended', () => {
      state.intent = 'pause';
      stopVideo(video, state);
    });
    const failed = () => {
      if (!state.loadingStarted || video.dataset[videoLoadedFlag] !== 'true') return;
      state.failed = true;
      if (!video.getAttribute('poster')) video.classList.remove(loadedClass);
      stopVideo(video, state);
    };
    video.addEventListener('error', failed);
    const sources = [...video.querySelectorAll('source[data-src]')];
    sources.forEach(source => source.addEventListener('error', () => {
      if (!state.loadingStarted || video.dataset[videoLoadedFlag] !== 'true') return;
      state.failedSources.add(source);
      // Source selection can emit errors for candidates it subsequently replaces.
      // Only treat an exhausted selection as failure (NETWORK_NO_SOURCE = 3).
      if (state.failedSources.size === sources.length) {
        clearTimeout(state.sourceErrorTimer);
        state.sourceErrorTimer = setTimeout(() => {
          if (video.networkState === 3) failed();
        }, 100);
      }
    }));
    const activateVideo = () => {
      if (!isVisible(video)) return;
      if (togglePlayback && (!video.paused || state.pending)) {
        state.intent = 'pause';
        stopVideo(video, state);
        return;
      }
      if (!video.paused || state.pending) return;
      const retry = state.failed;
      state.intent = 'play';
      state.blocked = false;
      state.failed = false;
      state.failedSources.clear();
      clearTimeout(state.sourceErrorTimer);
      loadVideoSources(video);
      if (retry) {
        state.loadingStarted = false;
        video.load();
      }
      syncVideo(video);
    };
    control?.addEventListener('click', activateVideo);
    video.addEventListener('click', activateVideo);
    video.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activateVideo();
    });
    updatePlaybackAction(video, state);
    if (video.readyState >= 2) ready();
    loadObserver.observe(video);
    playbackObserver.observe(video);
    if (revealVisual) {
      const reveal = () => {
        parent.classList.add(loadedClass);
        state.waitingForReveal = false;
        syncVideo(video);
      };
      // Start at the beginning when the still is ready, even on a slow connection.
      if (video.poster) {
        const poster = new Image();
        poster.src = video.poster;
        whenImageReady(poster, reveal);
      } else {
        reveal();
      }
    }
  };

  const loadObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (prefersReducedMotion) loadVideoPoster(entry.target);
        else loadVideoSources(entry.target);
        loadObserver.unobserve(entry.target);
      });
    },
    // Keep the look-ahead tight so a masonry page does not queue a whole row
    // of large videos while the visitor is still reading the header.
    { rootMargin: '100px 0px' }
  );

  const playbackObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => syncVideo(entry.target));
  }, { rootMargin: '0px' });

  document.addEventListener('visibilitychange', () => {
    videoStates.forEach((state, video) => syncVideo(video));
  });

  // Some mobile settings require a real gesture even for muted media. A normal
  // page interaction can unlock visible clips without a separate Play button.
  const recoverBlockedPlayback = (event) => {
    // An explicit Play tap owns its gesture. Retrying on touchend would make
    // the following click look like a request to pause that same video.
    const explicitControl = event.target?.closest?.('[data-video-playback-control], video[data-playback-toggle]');
    if (prefersReducedMotion || explicitControl) return;
    videoStates.forEach((state, video) => {
      if (!state.blocked || state.failed || !isVisible(video)) return;
      state.blocked = false;
      syncVideo(video);
    });
  };
  document.addEventListener('touchend', recoverBlockedPlayback, { passive: true });
  document.addEventListener('click', recoverBlockedPlayback);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') recoverBlockedPlayback(event);
  });

  const registerMedia = (node) => {
    if (!node) {
      return;
    }

    if (node.matches && node.matches('img')) {
      handleImage(node);
    }

    if (node.matches && node.matches('video')) {
      handleVideo(node);
    }

    if (node.querySelectorAll) {
      node.querySelectorAll('img').forEach(handleImage);
      node.querySelectorAll('video').forEach((video) => {
        handleVideo(video);
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
