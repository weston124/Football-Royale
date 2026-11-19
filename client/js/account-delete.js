// "Delete your account" form on the privacy page: logs in over the game's WebSocket,
// then asks the server to delete the account. Nothing else is sent anywhere.
const $ = (id) => document.getElementById(id);

function run(login, password) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    const done = (ok, msg) => { try { ws.close(); } catch { /* closed */ } resolve({ ok, msg }); };
    const timer = setTimeout(() => done(false, 'The server did not answer. Try again.'), 20000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'login', login, password }));
    ws.onerror = () => { clearTimeout(timer); done(false, 'Could not reach the server. Try again.'); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'auth') ws.send(JSON.stringify({ t: 'delete_account', password }));
      else if (m.t === 'auth_error' || m.t === 'delete_error') { clearTimeout(timer); done(false, m.msg || 'That did not work.'); }
      else if (m.t === 'account_deleted') { clearTimeout(timer); done(true, 'Your account was deleted. Bye for now! 👋'); }
    };
  });
}

addEventListener('DOMContentLoaded', () => {
  const form = $('del-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('del-msg');
    if (!$('del-sure').checked) { msg.className = 'msg err'; msg.textContent = 'Tick the box to confirm.'; return; }
    $('del-go').disabled = true; msg.className = 'msg'; msg.textContent = 'Deleting…';
    const r = await run($('del-login').value.trim(), $('del-pass').value);
    $('del-go').disabled = false;
    msg.className = 'msg ' + (r.ok ? 'ok' : 'err');
    msg.textContent = r.msg;
    if (r.ok) {
      form.reset();
      try { localStorage.removeItem('fr_session'); } catch { /* blocked */ }
    }
  });
});
