/* Applies the saved theme before first paint (loaded in <head>) to avoid a flash. */
  // Apply saved theme before paint to avoid a flash.
  (function () {
    try {
      var t = localStorage.getItem('rcs-theme');
      if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    } catch (e) {}
  })();
