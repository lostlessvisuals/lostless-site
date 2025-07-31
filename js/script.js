document.addEventListener("DOMContentLoaded", () => {
  const grid = document.querySelector(".gallery-grid");
  const msnry = new Masonry(grid, {
    itemSelector: ".gallery-item",
    columnWidth: ".gallery-item",
    percentPosition: true,
    gutter: 16
  });

  imagesLoaded(grid).on("progress", () => {
    msnry.layout();
  });
});
