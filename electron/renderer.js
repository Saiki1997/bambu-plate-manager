document.addEventListener('DOMContentLoaded', async () => {
  const versionEl = document.getElementById('version');
  if (window.api && window.api.getVersion) {
    versionEl.textContent = await window.api.getVersion();
  }

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      document.getElementById('content').innerHTML = `
        <h2>${page.charAt(0).toUpperCase() + page.slice(1)}</h2>
        <p>Page content for <strong>${page}</strong> goes here.</p>
        <p>This Electron shell packages cleanly with electron-builder.</p>
      `;
    });
  });
});
