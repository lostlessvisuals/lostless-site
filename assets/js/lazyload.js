document.addEventListener("DOMContentLoaded", () => {
  const lazyElements = document.querySelectorAll("img[data-src],video[data-src]");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const el = entry.target;
        const parent = el.closest(".gallery-item");

        const onLoad = () => {
          parent?.classList.add("loaded");
          el.removeEventListener("load", onLoad);
          el.removeEventListener("loadeddata", onLoad);
        };

        if (el.tagName === "IMG") {
          el.addEventListener("load", onLoad, { once: true });
          el.src = el.dataset.src;
        } else if (el.tagName === "VIDEO") {
          el.addEventListener("loadeddata", onLoad, { once: true });
          el.src = el.dataset.src;
          el.load();
        }

        observer.unobserve(el);
      });
    },
    { rootMargin: "200px 0px" }
  );

  lazyElements.forEach((el) => observer.observe(el));
});
