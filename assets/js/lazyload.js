document.addEventListener("DOMContentLoaded", () => {
  const lazyElements = document.querySelectorAll(
    "img[data-src],video[data-src]",
  );
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          el.src = el.dataset.src;
          if (el.tagName === "VIDEO") {
            el.load();
          }
          observer.unobserve(el);
        }
      });
    },
    { rootMargin: "200px 0px" },
  );
  lazyElements.forEach((el) => observer.observe(el));
});
