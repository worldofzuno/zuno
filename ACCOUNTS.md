# Accounts — what works, and what does not yet

Customers can register, sign in, sign out, set a new password when they have
forgotten the old one, and see the orders they placed while signed in.

## Forgotten password

On the account page, under the sign-in form. The customer types their
address and gets a link.

| | |
| --- | --- |
| how long | one hour |
| how often | once — it is spent as it is used |
| what is stored | only the hash of the token, as with a session |
| side effect | setting the password ends every session the account had |

Four decisions worth knowing, because each is a door left shut:

- **The answer never says whether the address has an account.** Known,
  unknown and malformed all get the same sentence after the same delay.
  Anything else turns the form into a way to ask who shops here.
- **The token is removed before the new password is written.** If the write
  then fails the customer asks for a new link, which is an annoyance; the
  other order would leave a spent link alive after a crash, which is a way
  in.
- **Every session ends.** The honest reason to reset a password is that
  someone else may know the old one — and they may be holding a cookie too.
- **The link arrives by mail and nowhere else.** It is never in a response
  body, so a proxy, a log or a screenshot of the page does not carry it.

Spending a link signs the customer straight in: they have just proved they
hold the mailbox, and a login form asking for the password they chose ten
seconds ago helps nobody.

## Still blocked until a verified address exists

### Claiming earlier orders

Order history shows what was bought **while signed in**. An order placed as a
guest with the same address does not appear.

That is not an oversight. Matching orders by email would mean anyone who
registers with your address can read your orders — and nothing verifies an
address, because verification needs mail. Once mail works, a verified address
can safely claim its guest orders.

## What is in place

| | |
|---|---|
| Password storage | scrypt, N=2^14, r=8, per-account salt, 64-byte derivation |
| Password rules | at least 10 characters, at most 200, and not your own address. No composition rules — they push people towards `Passw0rd!` and no further |
| Sessions | a 32-byte random token in an HttpOnly, Secure, SameSite=Lax cookie, 30 days |
| What is stored | only the SHA-256 of the token, so reading the store does not let anyone sign in |
| Lockout | 8 wrong guesses locks the account for 15 minutes |
| Rate limit | 10 attempts a minute per IP, per function instance |
| CSRF | SameSite=Lax plus a JSON-only endpoint; no cross-site form can reach it |
| Enumeration | a wrong password and an unknown address give byte-identical answers, and registration never says an address is taken — it mails the real owner instead |

Addresses are not in the clear in the store: a key is `account/<sha256 of the
address>`, so a listing is not a customer list.

## Two things worth knowing

**The rate limit counts per function instance**, not globally — the same
caveat as the voucher code endpoint. It blunts one client hammering one warm
instance and is not a defence against a distributed attempt. The lockout,
which lives in the account record, is global and is the real protection.

**scrypt costs about 16 MB and a tenth of a second per attempt.** That is
deliberate — it is what makes a stolen store expensive to crack — but it also
means sign-in is not instant, and a function that is cold will be slower
still.

## If you need to remove an account

Use the back office at `/admin/`: look the address up, then *Delete account*.
It also signs every device out and shows the account's orders first, in case
you want to check before removing it. See [BACKOFFICE.md](BACKOFFICE.md).

## Changing a password, and leaving

Both are on the account page under **Settings**, and both need the current
password as well as the session. A cookie someone else picked up is then not
enough to lock the owner out or to erase the account.

- **Changing a password** ends every other session. Without that the change
  protects nothing: whoever held the old session keeps it. The device making
  the change stays signed in, and the lockout counter is cleared.
- **Deleting** takes two presses, eight seconds apart at most, and removes
  the account record, the id index and every session. The address is free to
  register again afterwards.

Deleting does **not** delete the orders. Those live at Stripe and Swiss
accounting law requires keeping them for ten years; the Privacy Policy says
so and the deletion mail repeats it. What goes is the sign-in and the history
shown on the site.

## Not built, and not planned unless you ask

- Changing the email address on an account
- Saved addresses. A signed-in customer's email is prefilled at checkout, and
  the Circle section now claims exactly that and nothing more — it used to
  promise "faster checkout", which was not true.
