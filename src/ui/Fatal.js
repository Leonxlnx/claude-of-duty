/**
 * Full-screen stop message. Used for a context that never came up and for one
 * that went away mid-match; in both cases nothing can be rendered any more, so
 * the overlay owns the screen rather than sitting on top of a dead frame.
 */
export function showFatalOverlay(root, title, detail, hint = '') {
  const el = document.createElement('div');
  el.id = 'fatal';
  el.innerHTML = `
    <div class="fatal-title"></div>
    <div class="fatal-detail"></div>
    <div class="fatal-hint"></div>`;
  el.querySelector('.fatal-title').textContent = title;
  el.querySelector('.fatal-detail').textContent = detail;
  el.querySelector('.fatal-hint').textContent = hint;
  root.appendChild(el);
  return el;
}
