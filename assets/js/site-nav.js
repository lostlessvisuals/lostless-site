(() => {
  const nav = document.querySelector('nav');
  const toggle = nav?.querySelector('.nav-toggle');
  const menu = nav?.querySelector('.nav-menu');

  if (!nav || !toggle || !menu) {
    return;
  }

  const root = document.documentElement;
  const openClass = 'nav-open';

  root.classList.add('nav-enhanced');

  const setOpen = (isOpen) => {
    root.classList.toggle(openClass, isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.querySelector('.nav-toggle-label').textContent = isOpen ? 'close' : 'menu';
  };

  toggle.addEventListener('click', () => {
    setOpen(!root.classList.contains(openClass));
  });

  menu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setOpen(false));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
    }
  });

  const desktopQuery = window.matchMedia('(min-width: 701px)');
  const closeForDesktop = (event) => {
    if (event.matches) {
      setOpen(false);
    }
  };

  if (desktopQuery.addEventListener) {
    desktopQuery.addEventListener('change', closeForDesktop);
  } else {
    desktopQuery.addListener(closeForDesktop);
  }
})();
