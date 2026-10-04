/* The back office, in one file.
 *
 * Every call goes to /.netlify/functions/admin and carries nothing but a
 * cookie the server set. The key is typed once and never stored here: no
 * localStorage, no variable held past the request, so a shared machine does
 * not keep the door open after the tab is closed.
 */
'use strict';

var $ = function (id) { return document.getElementById(id); };

function say(el, text, kind) {
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('is-bad', kind === 'bad');
  el.classList.toggle('is-ok', kind === 'ok');
}

function chf(rappen) {
  return 'CHF ' + (rappen / 100).toFixed(2);
}

function call(body) {
  return fetch('/.netlify/functions/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (b) {
      return { status: r.status, body: b };
    });
  });
}

/* A button that says what it is doing and cannot be pressed twice. */
function busy(btn, label, work) {
  var was = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  return work().then(function (r) { return r; }, function (e) { throw e; })
    ['finally'](function () { btn.disabled = false; btn.textContent = was; });
}

var el = function (tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------- the door */

var gate = $('gate');
var office = $('office');
var signOut = $('signOut');
var modeTag = $('mode');

function show(isAdmin) {
  gate.hidden = isAdmin;
  office.hidden = !isAdmin;
  signOut.hidden = !isAdmin;
  if (isAdmin) loadSummary();
}

$('gateForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var field = $('token');
  var token = field.value;
  busy(e.target.querySelector('button'), 'Opening…', function () {
    return call({ action: 'login', token: token }).then(function (r) {
      /* Out of the field either way: a key left in a form is a key on the
         screen of whoever walks past next. */
      field.value = '';
      if (r.body && r.body.admin) { say($('gateMsg'), ''); show(true); paintMode(); return; }
      say($('gateMsg'), (r.body && r.body.error) || 'That did not work.', 'bad');
    })['catch'](function () {
      say($('gateMsg'), 'Could not reach the server.', 'bad');
    });
  });
});

signOut.addEventListener('click', function () {
  call({ action: 'logout' })['catch'](function () {})
    .then(function () { show(false); });
});

/* ------------------------------------------------------------- summary */

function loadSummary() {
  call({ action: 'summary' }).then(function (r) {
    if (r.status !== 200) return;
    var c = r.body.cards, a = r.body.accounts;
    $('tCards').textContent = c.count + (c.voided ? ' (' + c.voided + ' void)' : '');
    $('tIssued').textContent = chf(c.issued);
    $('tSpent').textContent = chf(c.spent);
    $('tOwed').textContent = chf(c.outstanding);
    $('tAcc').textContent = a.count + (a.withOrders ? ' · ' + a.withOrders + ' with orders' : '');
    paintStock(r.body.stock);
  })['catch'](function () { /* the tiles keep their dashes */ });
}

/* ---------------------------------------------------------------- stock */

function stockFields() {
  return Array.prototype.slice.call(document.querySelectorAll('#stockForm input[data-sku]'));
}

/* Empty is not zero. An empty field is no limit, which is what the server
   reports as null; zero is sold out and is a decision. */
function paintStock(levels) {
  if (!levels || typeof levels !== 'object') return;
  stockFields().forEach(function (f) {
    var n = levels[f.dataset.sku];
    f.value = typeof n === 'number' ? String(n) : '';
  });
}

$('stockForm').addEventListener('submit', function (e) {
  e.preventDefault();
  /* Read every field BEFORE the first request. Repainting from one answer
     while the next field is still waiting to be read would overwrite what
     was typed into it with what the server has not been told yet — which is
     exactly how the second size silently kept its old number. */
  var wanted = stockFields().map(function (f) {
    return { sku: f.dataset.sku, raw: f.value.trim() };
  });

  busy(e.target.querySelector('button'), 'Saving…', function () {
    /* One request per size, one after the other: each size is its own
       record, and a refusal on the second must not hide that the first went
       through. The fields are repainted once, at the end, from whatever the
       server last reported. */
    var problems = [];
    var levels = null;
    return wanted.reduce(function (chain, w) {
      return chain.then(function () {
        return call({ action: 'stock-set', sku: w.sku, qty: w.raw === '' ? null : w.raw })
          .then(function (r) {
            if (r.status !== 200) {
              problems.push(w.sku + ': ' + ((r.body && r.body.error) || 'did not save'));
              return;
            }
            levels = r.body.levels || levels;
          });
      });
    }, Promise.resolve()).then(function () {
      paintStock(levels);
      say($('stockMsg'),
        problems.length ? problems.join(' · ') : 'Saved. The shop page picks it up within a minute.',
        problems.length ? 'bad' : 'ok');
    })['catch'](function () { say($('stockMsg'), 'Could not reach the server.', 'bad'); });
  });
});

/* ---------------------------------------------------------- gift cards */

function renderCard(card, host) {
  host.innerHTML = '';
  var rec = el('div', 'rec');
  var dl = el('dl');
  var rows = [
    ['Code', card.code],
    ['Balance', chf(card.balance)],
    ['Issued', chf(card.issued)],
    ['Spent', chf(card.spent)],
    ['Held', card.held ? chf(card.held) + ' (a checkout in flight)' : '—'],
    ['Bought', (card.createdAt || '').slice(0, 10) + (card.buyer ? ' by ' + card.buyer : '')],
    ['Mode', card.livemode ? 'live' : 'test']
  ];
  rows.forEach(function (r) { dl.append(el('dt', null, r[0]), el('dd', null, r[1])); });
  rec.append(dl);

  if (card.voided) {
    var tag = el('p');
    tag.append(el('span', 'tag is-void', 'Voided'));
    if (card.voidReason) tag.append(document.createTextNode(' ' + card.voidReason));
    rec.append(tag);
  }

  if (card.spends && card.spends.length) {
    var list = el('div', 'list');
    var t = el('table');
    var head = el('tr');
    ['Spent on', 'Amount', 'When'].forEach(function (h) { head.append(el('th', null, h)); });
    t.append(head);
    card.spends.forEach(function (s) {
      var tr = el('tr');
      tr.append(el('td', null, String(s.session).slice(-10)));
      tr.append(el('td', 'num', chf(s.amount)));
      tr.append(el('td', null, new Date(s.at).toISOString().slice(0, 16).replace('T', ' ')));
      t.append(tr);
    });
    list.append(t);
    rec.append(list);
  }

  var actions = el('div', 'actions');
  var toggle = el('button', 'btn ' + (card.voided ? 'btn--quiet' : 'btn--bad'),
    card.voided ? 'Allow it again' : 'Void this card');
  toggle.type = 'button';
  toggle.addEventListener('click', function () {
    var reason = card.voided ? null : (prompt('Why is this card being voided?') || 'no reason given');
    busy(toggle, 'Working…', function () {
      return call({ action: 'gift-void', code: card.code, voided: !card.voided, reason: reason })
        .then(function (r) {
          if (r.status !== 200) { say($('cardMsg'), r.body.error || 'That did not work.', 'bad'); return; }
          renderCard(r.body.card, host);
          say($('cardMsg'), r.body.card.voided ? 'Card voided.' : 'Card allowed again.', 'ok');
          loadSummary();
        });
    });
  });
  actions.append(toggle);
  rec.append(actions);
  host.append(rec);
}

$('findCard').addEventListener('submit', function (e) {
  e.preventDefault();
  var code = $('findCode').value.trim();
  $('cardOut').innerHTML = '';
  busy(e.target.querySelector('button'), 'Looking…', function () {
    return call({ action: 'gift-find', code: code }).then(function (r) {
      if (r.status !== 200) { say($('cardMsg'), r.body.error || 'Not found.', 'bad'); return; }
      say($('cardMsg'), '');
      renderCard(r.body.card, $('cardOut'));
    })['catch'](function () { say($('cardMsg'), 'Could not reach the server.', 'bad'); });
  });
});

$('issueCard').addEventListener('submit', function (e) {
  e.preventDefault();
  var francs = parseFloat($('issueAmount').value);
  if (!isFinite(francs) || francs <= 0) { say($('issueMsg'), 'An amount, please.', 'bad'); return; }
  var note = $('issueNote').value.trim();
  busy(e.target.querySelector('button'), 'Issuing…', function () {
    return call({ action: 'gift-issue', amount: Math.round(francs * 100), note: note })
      .then(function (r) {
        if (r.status !== 200) { say($('issueMsg'), r.body.error || 'That did not work.', 'bad'); return; }
        say($('issueMsg'), 'Issued ' + r.body.card.code + ' for ' + chf(r.body.card.issued) +
          ' — write it down now, it is not shown again.', 'ok');
        $('issueAmount').value = '';
        $('issueNote').value = '';
        loadSummary();
      })['catch'](function () { say($('issueMsg'), 'Could not reach the server.', 'bad'); });
  });
});

$('loadCards').addEventListener('click', function () {
  var host = $('cardsOut');
  busy($('loadCards'), 'Loading…', function () {
    return call({ action: 'gift-list' }).then(function (r) {
      host.innerHTML = '';
      if (r.status !== 200) { host.append(el('p', 'msg is-bad', r.body.error || 'That did not work.')); return; }
      if (!r.body.cards.length) { host.append(el('p', 'hint', 'No cards yet.')); return; }
      var list = el('div', 'list');
      var t = el('table');
      var head = el('tr');
      ['Code', 'Balance', 'Issued', 'Bought', ''].forEach(function (h) { head.append(el('th', null, h)); });
      t.append(head);
      r.body.cards.forEach(function (c) {
        var tr = el('tr');
        tr.append(el('td', null, c.code));
        tr.append(el('td', 'num', chf(c.balance)));
        tr.append(el('td', 'num', chf(c.issued)));
        tr.append(el('td', null, (c.createdAt || '').slice(0, 10)));
        var last = el('td');
        if (c.voided) last.append(el('span', 'tag is-void', 'void'));
        tr.append(last);
        t.append(tr);
      });
      list.append(t);
      host.append(list);
    });
  });
});

/* ------------------------------------------------------------ accounts */

function renderAccount(a, host) {
  host.innerHTML = '';
  var rec = el('div', 'rec');
  var dl = el('dl');
  [
    ['Name', a.name],
    ['Email', a.email],
    ['Joined', (a.createdAt || '').slice(0, 10)],
    ['Orders', String(a.orders.length)],
    ['Locked', a.lockedUntil > Date.now() ? 'yes, until ' + new Date(a.lockedUntil).toISOString().slice(11, 16) : 'no']
  ].forEach(function (r) { dl.append(el('dt', null, r[0]), el('dd', null, r[1])); });
  rec.append(dl);

  if (a.orders.length) {
    var list = el('div', 'list');
    var t = el('table');
    var head = el('tr');
    ['Order', 'Date', 'Total'].forEach(function (h) { head.append(el('th', null, h)); });
    t.append(head);
    a.orders.forEach(function (o) {
      var tr = el('tr');
      tr.append(el('td', null, String(o.session).slice(-8).toUpperCase()));
      tr.append(el('td', null, o.date || ''));
      tr.append(el('td', 'num', (o.currency || 'CHF') + ' ' + o.total));
      t.append(tr);
    });
    list.append(t);
    rec.append(list);
  }

  var actions = el('div', 'actions');

  var out = el('button', 'btn btn--quiet', 'Sign out everywhere');
  out.type = 'button';
  out.addEventListener('click', function () {
    busy(out, 'Working…', function () {
      return call({ action: 'account-signout', email: a.email }).then(function (r) {
        say($('accMsg'), r.status === 200 ? r.body.ended + ' session(s) ended.' : (r.body.error || 'Failed.'),
          r.status === 200 ? 'ok' : 'bad');
      });
    });
  });
  actions.append(out);

  /* Two presses, like the customer-facing one. A list of accounts and a
     single mis-click is a bad combination. */
  var armed = false;
  var del = el('button', 'btn btn--bad', 'Delete account');
  del.type = 'button';
  del.addEventListener('click', function () {
    if (!armed) {
      armed = true;
      del.textContent = 'Press again to delete';
      say($('accMsg'), 'This removes the sign-in and the history. The orders stay at Stripe.', 'bad');
      setTimeout(function () {
        if (!armed) return;
        armed = false;
        del.textContent = 'Delete account';
        say($('accMsg'), '');
      }, 8000);
      return;
    }
    armed = false;
    busy(del, 'Deleting…', function () {
      return call({ action: 'account-delete', email: a.email }).then(function (r) {
        if (r.status !== 200) { say($('accMsg'), r.body.error || 'Failed.', 'bad'); return; }
        host.innerHTML = '';
        say($('accMsg'), 'Account deleted.', 'ok');
        loadSummary();
      });
    });
  });
  actions.append(del);

  rec.append(actions);
  host.append(rec);
}

$('findAcc').addEventListener('submit', function (e) {
  e.preventDefault();
  var email = $('findEmail').value.trim();
  $('accOut').innerHTML = '';
  busy(e.target.querySelector('button'), 'Looking…', function () {
    return call({ action: 'account-find', email: email }).then(function (r) {
      if (r.status !== 200) { say($('accMsg'), r.body.error || 'Not found.', 'bad'); return; }
      say($('accMsg'), '');
      renderAccount(r.body.account, $('accOut'));
    })['catch'](function () { say($('accMsg'), 'Could not reach the server.', 'bad'); });
  });
});

/* -------------------------------------------------------------- backup */

$('exportBtn').addEventListener('click', function () {
  busy($('exportBtn'), 'Preparing…', function () {
    return call({ action: 'export' }).then(function (r) {
      if (r.status !== 200) { say($('exportMsg'), r.body.error || 'That did not work.', 'bad'); return; }
      var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      var blob = new Blob([JSON.stringify(r.body, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'zuno-backup-' + stamp + '.json';
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      say($('exportMsg'), r.body.giftCards.length + ' card(s) and ' + r.body.accounts.length +
        ' account(s). Keep it somewhere other than Netlify.', 'ok');
    })['catch'](function () { say($('exportMsg'), 'Could not reach the server.', 'bad'); });
  });
});

/* ---------------------------------------------------------------- boot */

/* Which Stripe mode the shop is in, so nobody voids a live card thinking it
   is a test one. Derived from the cards themselves: the server does not hand
   out keys, and it does not need to. */
function paintMode() {
  call({ action: 'gift-list' }).then(function (r) {
    if (r.status !== 200) return;
    var live = r.body.cards.some(function (c) { return c.livemode; });
    modeTag.textContent = live ? 'live data' : 'test data';
    modeTag.classList.toggle('is-live', live);
    modeTag.hidden = false;
  })['catch'](function () {});
}

call({ action: 'me' }).then(function (r) {
  var ok = !!(r.body && r.body.admin);
  show(ok);
  if (ok) paintMode();
})['catch'](function () { show(false); });
