// Navigation optics only. Download, selection and focus behavior stay in the workspace.
export function createLiquidWorkspace() {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let previous, observer, animation;
  reducedMotion.addEventListener('change', () => animation?.cancel());
  return {
    bind() {
      observer?.disconnect();
      animation?.cancel();
      const nav = document.querySelector('.popup-tabs-bar');
      if (!nav) return;
      const lens = document.createElement('span');
      lens.className = 'liquid-nav-lens';
      lens.setAttribute('aria-hidden', 'true');
      nav.prepend(lens);
      nav.dataset.liquidReady = '';
      const position = (animate = false) => {
        const active = nav.querySelector('.popup-tab-btn.active');
        if (!active) return;
        const left = active.offsetLeft, width = active.offsetWidth, tab = active.dataset.tab;
        lens.style.width = `${width}px`;
        lens.style.transform = `translateX(${left}px)`;
        if (animate && previous && previous.tab !== tab && !reducedMotion.matches) {
          animation = lens.animate([
            {transform: `translateX(${previous.left}px)`, width: `${previous.width}px`},
            {transform: `translateX(${left}px)`, width: `${width}px`}
          ], {duration: 420, easing: 'cubic-bezier(.22,.8,.25,1)'});
        }
        previous = {left, width, tab};
      };
      position(true);
      observer = new ResizeObserver(() => position());
      observer.observe(nav);
      nav.addEventListener('pointermove', event => {
        if (reducedMotion.matches || event.pointerType === 'touch') return;
        const rect = nav.getBoundingClientRect();
        nav.style.setProperty('--light-x', `${(event.clientX - rect.left) / rect.width * 100}%`);
      });
      nav.addEventListener('pointerleave', () => nav.style.removeProperty('--light-x'));
    }
  };
}
