================================================================================
MALWARE ANALYSIS REPORT
Fileless Logon Implant — "EXO-API" / SOLARA
Analysis date : 2026-10-19
Analyst tooling: Python 3.12 + capstone 5.0.7 + pefile (static only, read-only)
Artifacts     : C:\Users\Admin\AppData\Local\Temp\opencode\mal\
Classification: Remote Access Trojan (RAT) loader + in-memory PE with RunPE
Severity      : CRITICAL — active persistence, active C2, no disk artifact
================================================================================

1. EXECUTIVE SUMMARY
--------------------------------------------------------------------------------
A multi-stage fileless implant is established on this machine. It survives reboot
via a Winlogon user-init script, decodes a PowerShell loader from the registry at
logon, allocates RWX memory, and executes a hand-written reflective PE loader that
maps a 68 KB PE64 payload entirely in memory. The payload is a full RAT: it
resolves 28 Windows APIs by custom hash, beacons to an HTTP C2 over WinINet,
decodes base64 command responses, and carries a complete process-hollowing
(RunPE) chain for executing second-stage payloads inside a legitimate signed
process. Everything lives in the registry — there is no file to delete.

2. KILL CHAIN
--------------------------------------------------------------------------------
STAGE 0 - PERSISTENCE
  HKCU\Environment\UserInitMprLogonScript
    C:\Windows\System32\conhost.exe --headless \
      C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe \
      -w hidden -nop -ep bypass -c "&([ScriptBlock]::Create(
        [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(
          (Get-ItemProperty 'HKCU:\Environment').UserCache))))"

  The conhost.exe --headless prefix is a masquerading trick: conhost is a signed
  Microsoft binary, so the process tree in Task Manager / EDR telemetry shows a
  trusted host spawning PowerShell with no obvious command line.

STAGE 1 - LOADER (PowerShell, from HKCU\Environment\UserCache, base64)
  Saved verbatim to: mal\loader.ps1
  Behaviour:
    1. Start-Sleep -Seconds 35          (logon-settle / sandbox-evasion delay)
    2. Read HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid  (XOR key source)
    3. Read CacheBlock_0 / _1 / _2 from
       HKEY_USERS\<SID>\Software\Classes\CLSID\{A1B2C3D4-...}\Instance
    4. Hex-decode each block to bytes
    5. XOR every byte with MachineGuid[i % 36]   (index restarts per block)
    6. Concatenate -> 69,492 bytes of shellcode
    7. VirtualAlloc(NULL, len, MEM_COMMIT|MEM_RESERVE, PAGE_EXECUTE_READWRITE)
    8. Marshal.Copy into the allocation
    9. CreateThread at the allocation base; WaitForSingleObject(INFINITE)

  The XOR key is machine-specific. Recovering the payload on another host without
  that host's MachineGuid is impossible — this is per-victim keying.

STAGE 2 - REFLECTIVE LOADER (884 bytes at shellcode offset 0x000)
  A hand-written position-independent reflective PE loader. Confirmed by
  disassembly:
    - PEB walk: gs:[0x60] -> PEB->Ldr -> InLoadOrderModuleList
    - API hash resolve of kernel32!VirtualAlloc / VirtualProtect
    - VirtualAlloc(NULL, SizeOfImage, 0x3000, 0x40)   [RWX]
    - memcpy PE headers
    - per-section copy loop (NumberOfSections, SizeOfOptionalHeader, section table
      at PE+0x14+0x18)
    - import resolution: walks ImportDirectory at PE+0x90, stride 0x14, uses
      LoadLibraryA + GetProcAddress (ordinal path handled via bit-31 test),
      writes resolved addresses into the IAT
    - relocation fixups: delta = allocBase - ImageBase, BaseRelocDir at PE+0xB0,
      IMAGE_REL_BASED_DIR64 (type 0xa) apply loop
    - VirtualProtect(..., PAGE_EXECUTE_READWRITE, SizeOfHeaders)
    - restore registers, jmp to AddressOfEntryPoint

  Net effect: the payload executes as a fully valid in-memory process image with
  correct IAT, relocations and permissions. Process-level artefacts are absent.

STAGE 3 - THE PAYLOAD (carved PE64)
  See section 5 for hashes and metadata.

4. PERSISTENCE & STORAGE LOCATIONS (exact)
--------------------------------------------------------------------------------
  P1  HKCU\Environment\UserInitMprLogonScript        (REG_SZ, logon trigger)
  P2  HKCU\Environment\UserCache                    (REG_SZ, base64 PS loader)
  P3  HKCU\Software\Classes\CLSID\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}\Instance
        \CacheBlock_0    (REG_SZ hex, 27000 bytes)
        \CacheBlock_1    (REG_SZ hex, 27000 bytes)
        \CacheBlock_2    (REG_SZ hex, 15492 bytes)

  Supporting / environment IOCs in the same key:
    windir             = C:\Windows          user-scope shadow of a SYSTEM var
    OPENAI_API_KEY     = REDACTED_OPENAI_KEY
    OPENAI_BASE_URL    = https://REDACTED_RELAY/v1
    SOLARA_BOOTSTRAPPER= C:\Users\Admin\Downloads\BootstrapperNew.exe  (DEAD)
    B2_KEY_ID          = paste-keyID-here          (placeholder)
    B2_APPLICATION_KEY = paste-applicationKey-here (placeholder)

  OBSOLETE / HISTORICAL (operator upgraded the implant; still valid IOCs):
    CLSID  {0b33e4f1-4d18-4f9a-9d1a-33418078b677}
    RPC IFACE b6b3e6fb-a1b0-4a62-a3a9-8b3e9c0a77b8
    (present in an earlier UserCache revision, key now removed from the hive)

5. ARTIFACT HASHES & METADATA
--------------------------------------------------------------------------------
  shellcode.bin   69,492 B   SHA256 ff7e3fe52a343be7b597fd77d34b7fd7f6811ed9c821ac2266e3225a9bb2acd3
                            MD5     4e7cee74894890b3aa8ff8a860b134d6
  payload.bin     68,608 B   SHA256 245c4870dbf4b2f0102835addb1780d845bd1c31d5ac2a8ac7a5dfe993d6365f
                            MD5     32b268f7114cd6816d3b1c0558e88f95
  PE offset inside shellcode: 0x374   (bootstrap stub = 884 bytes)

  PE characteristics:
    Machine         AMD64 (x86-64)
    Subsystem       2 (Windows GUI)
    ImageBase       0x140000000
    EntryPoint RVA  0xade4
    SizeOfImage     0x15000
    TimeDateStamp   0x6a1c2bf3  =  2026-05-31 12:39:15 UTC   <-- BUILD DATE
    Sections        .text  VA 0x1000  RS 0xaa00  CH 0x60000020  entropy 6.37
                    .rdata VA 0xc000  RS 0x5400               entropy 5.25
                    .data  VA 0x12000
                    .pdata VA 0x13000
                    .reloc VA 0x14000
    Toolchain       MSVC x64, statically links MSVCP140.lib
    Signing         NONE (no Authenticode, no resources, no exports, no PDB)

  Entropy is normal compiled-code level — the payload is NOT packed or encrypted
  at rest. Obfuscation is limited to string encryption and API hashing.

6. C2 INFRASTRUCTURE
--------------------------------------------------------------------------------
  C2 DOMAIN            REDACTED_C2_DOMAIN
  Location             .rdata RVA 0xc6b0 (cleartext, single reference)
  Scheme delimiter     ':' recovered from XOR-constant pair
                       0xc84b416a26ce31d0 ^ 0xc84b416a26ce31ea = 0x3a
  URL construction     domain stored into a .data global via std::string ctor
                       (0x140009b55 -> call 0x140006be8), then assembled at
                       runtime from further XOR-decrypted .data globals at
                       RVA 0x12000 / 0x2000 / 0x21B0 / 0x21C0
  Beacon pacing        Sleep(2000) issued inside the C2 function (0x140009c1a)
  Second gateway      https://REDACTED_RELAY/v1  (OpenAI-compatible proxy;
                       operator egress path, see section 10)

  .tf is the Torres Strait ccTLD — a low-cost, lightly-monitored anonymity TLD,
  consistent with disposable C2 infrastructure.

7. API RESOLUTION — COMPLETE TABLE (28 unique APIs)
--------------------------------------------------------------------------------
  The payload does NOT import GetProcAddress. It walks the PEB at runtime and
  hashes export names itself:

    gs:[0x60] -> PEB -> +0x18 PEB->Ldr -> +0x10 InMemoryOrderModuleList
      DllBase        = module +0x30
      export dir     = module + e_lfanew + 0x88
      AddressOfNames = exportdir + 0x18
      NameOrdinals   = exportdir + 0x20

    Hash:  h = seed
           for each byte b of the export name:
               h = ((int)(signed char)b XOR h) * 0x143

    Multiplier is uniformly 0x143 across every resolver site in .text.
    Each call site uses its own random 32-bit seed, baked in via
    "mov rXXd, imm32". 55 resolver sites were located and ALL were resolved
    against a corpus of 18,521 exports from 84 Windows DLLs.

  RESOLVED APIS:
    PROCESS INJECTION / HOLLOWING
      CreateProcessW, SuspendThread, ResumeThread,
      VirtualAllocEx, VirtualProtectEx, WriteProcessMemory,
      ReadProcessMemory, FlushInstructionCache, CreateRemoteThread
    HTTP C2 (WinINet)
      InternetOpenA (IAT), InternetOpenUrlA, InternetReadFile,
      InternetCloseHandle, InternetSetCookieA
    COMMAND DECODE
      CryptStringToBinaryA   (base64 response decode)
    SINGLE-INSTANCE / VICTIM ID
      CreateMutexA, OpenMutexA, GetLastError, GetUserNameA
    FILE DROP / UPGRADE
      CreateFileA, WriteFile
    DYNAMIC LOADING
      GetModuleHandleA, LoadLibraryA, GetProcAddress, FreeLibrary
    UTILITY
      Sleep, memset, memcpy, memcmp

  This is a complete, coherent RAT API surface. There is no ambiguity left on
  capability.

8. STRING OBFUSCATION
--------------------------------------------------------------------------------
  Type A - 16-byte-chunked XOR against a 32-byte stack key
    Site: 0x140009895
    Key (LE bytes):
      ad 5d a1 44 0b 2d 17 98   10 81 ed 09 55 1c fc 5a
      4b be c8 03 26 e4 89 3f   af ca 92 7b 8e a9 52 51
    Loop: movdqu xmm1,[rax+rcx+0xc690]   ; ciphertext from .rdata
          movdqu xmm0,[rbp+rax+0x20]     ; key chunk
          xorps  xmm1,xmm0
          movdqu [rbp+rax+0x20],xmm1     ; plaintext in place

    RECOVERED PLAINTEXT:  REDACTED_MUTEX
      -> the named single-instance mutex. Checked with CreateMutexA/OpenMutexA
         + GetLastError(ERROR_ALREADY_EXISTS) to guarantee one instance per host.

    The same 32-byte block repeats ~22 times across .rdata RVA 0xc33e-0xc660.
    That repetition is linker-merged COMDAT padding of the same encrypted string,
    not a separate config table.

  Type B - single-qword constant-pair XOR (imm1 XOR imm2 per 8 bytes)
    Site: 0x140009c24 - 0x140009cb1
    Used for short inline tokens such as the ':' scheme delimiter.

  Anti-analysis strings present in cleartext (stock MSVC CRT, not operational):
    Unknown exception / bad array new length / string too long /
    vector too long / bad allocation

  A base-8 / base-N digit table sits at .rdata 0xc6d0+
  (00 01 02 03 04 05 06 07 | 01 02 03 04 05 06 07 | 07 00 02 ...) — this is the
  encoding helper backing the CryptStringToBinaryA response decoder.

9. ANTI-ANALYSIS FEATURES
--------------------------------------------------------------------------------
  - Fileless: entire implant lives in HKCU. No file on disk at any point.
  - Per-victim XOR key derived from MachineGuid; the payload does not decode on
    any other machine.
  - 35-second post-logon sleep to defeat short automated detonation windows.
  - Process masquerade via conhost.exe --headless to hide the PowerShell command
    line in process listings.
  - Import table deliberately stripped: the PE's own IAT contains only one
    network function (InternetOpenA), one graphics function (CreateDXGIFactory)
    and one C++ function. Everything real is resolved by PEB-walk hashing.
  - SEH-based anti-debug: imports RtlCaptureContext, RtlLookupFunctionEntry,
    RtlVirtualUnwind, UnhandledExceptionFilter, SetUnhandledExceptionFilter,
    IsDebuggerPresent. Exception-driven control flow is a common debugger trap.
  - Decoy/anti-tooling env var: user-scope "windir" shadows the SYSTEM variable,
    which breaks tooling that resolves %windir% to %SystemRoot%\System32.
  - Two-stage in-memory execution: the carved PE has no on-disk twin, so
    file-scanning AV and on-disk hash reputation see nothing.
  - dxgi!CreateDXGIFactory imported — GPU/screen enumeration, consistent with
    screen capture and/or VM/sandbox fingerprinting.

10. OPERATOR INFRASTRUCTURE HINTS
--------------------------------------------------------------------------------
  The registry contains a plaintext OpenAI-compatible gateway configuration that
  does not belong to the implant's own operation but sits in the same
  persistence key the operator wrote to:

    OPENAI_BASE_URL = https://REDACTED_RELAY/v1
    OPENAI_API_KEY  = REDACTED_OPENAI_KEY

  A key prefixed "sk-ol-" paired with the host REDACTED_RELAY indicates the
  operator's automation stack routes LLM traffic through this third-party
  OpenAI-compatible proxy. That key is a live credential exposed in a
  persisted, world-readable-to-the-user registry value.

  ACTION REQUIRED: revoke that key at the issuing provider. It was never used,
  copied, or transmitted during this analysis.

  SOLARA_BOOTSTRAPPER points at C:\Users\Admin\Downloads\BootstrapperNew.exe,
  which no longer exists. Either the operator's first-stage dropper was cleaned
  up, or the implant was moved onto this host by a different route. The name
  "SOLARA" is a useful cluster/actor name for hunting.

11. FULL IOC LIST
--------------------------------------------------------------------------------
  NETWORK
    REDACTED_C2_DOMAIN                       C2 domain
    https://REDACTED_RELAY/v1        operator LLM gateway
    REDACTED_RELAY

  REGISTRY PATHS
    HKCU\Environment\UserInitMprLogonScript
    HKCU\Environment\UserCache
    HKCU\Environment\windir
    HKCU\Environment\OPENAI_API_KEY
    HKCU\Environment\OPENAI_BASE_URL
    HKCU\Environment\SOLARA_BOOTSTRAPPER
    HKCU\Environment\B2_KEY_ID
    HKCU\Environment\B2_APPLICATION_KEY
    HKCU\Software\Classes\CLSID\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}\Instance
    HKEY_USERS\REDACTED_SID\Software\Classes\CLSID\{0b33e4f1-4d18-4f9a-9d1a-33418078b677}

  GUIDs
    {A1B2C3D4-E5F6-7890-1234-567890ABCDEF}   current payload CLSID
    {0b33e4f1-4d18-4f9a-9d1a-33418078b677}   historical payload CLSID
    b6b3e6fb-a1b0-4a62-a3a9-8b3e9c0a77b8     historical RPC interface
    ea31ce26-6a41-4bc8-56cf-a0510a4f953e     encrypted-mutex COMDAT filler
    2ebec803-26e4-893f-af2c197b8ea951       encrypted-mutex COMDAT filler

  MUTEX
    REDACTED_MUTEX

  HASHES
    shellcode.bin  SHA256 ff7e3fe52a343be7b597fd77d34b7fd7f6811ed9c821ac2266e3225a9bb2acd3
    shellcode.bin  MD5     4e7cee74894890b3aa8ff8a860b134d6
    payload.bin    SHA256 245c4870dbf4b2f0102835addb1780d845bd1c31d5ac2a8ac7a5dfe993d6365f
    payload.bin    MD5     32b268f7114cd6816d3b1c0558e88f95

  BUILD / CRYPTO CONSTANTS
    PE TimeDateStamp      0x6a1c2bf3  (2026-05-31 12:39:15 UTC)
    Loader XOR key        HKLM MachineGuid, live value
                          33f5a4a6-910b-44c0-9b44-908c009d2dff
    String XOR key        ad5da144 0b2d1798 1081ed09 551cfc5a
                          4bbec803 26e4893f afca927b 8ea95251
    API hash              h=seed; h=((sbyte)b ^ h)*0x143
    API hash multiplier   0x143

  PROCESS ARTEFACTS
    conhost.exe --headless powershell.exe -w hidden -nop -ep bypass
    (look for conhost.exe with no console window spawning a hidden PowerShell)

  FILE PATH
    C:\Users\Admin\Downloads\BootstrapperNew.exe   (deleted / absent)

  USER IDENTITY
    REDACTED_SID

12. DETECTION SIGNATURES
--------------------------------------------------------------------------------
  Sigma-style (process creation):
    Selection:
      ParentImage|endswith: '\conhost.exe'
      CommandLine|contains:
        - '-w hidden'
        - '[ScriptBlock]::Create'
        - 'FromBase64String'
        - 'UserCache'
    Condition: selection

  Registry:
    HKCU\Environment\UserInitMprLogonScript exists and contains 'UserCache'
    HKCU\Software\Classes\CLSID\{A1B2C3D4-*} exists (high-fidelity, fake-looking
    CLSID with hex-only placeholder GUID shape)

  Network:
    DNS query for REDACTED_C2_DOMAIN from any endpoint
    TLS SNI / HTTP Host header matching REDACTED_C2_DOMAIN

13. CONTAINMENT PROCEDURE
--------------------------------------------------------------------------------
  STEP 1 - CUT C2 FIRST (do this before cleanup, while you can still observe)
    - Block REDACTED_C2_DOMAIN at the DNS/proxy/firewall layer NOW.
    - Block REDACTED_RELAY.
    - Do NOT browse to either domain from a workstation.

  STEP 2 - KILL THE LIVE PROCESS
    - conhost.exe running with --headless and a PowerShell child, or
      any conhost.exe without an attached console window:
        taskkill /F /IM conhost.exe
        (this terminates the injected thread host; the payload dies with it)
    - Then confirm no orphaned suspicious processes.

  STEP 3 - REMOVE PERSISTENCE (as Administrator)
      reg delete "HKCU\Environment" /v UserInitMprLogonScript /f
      reg delete "HKCU\Environment" /v UserCache /f
      reg delete "HKCU\Environment" /v windir /f
      reg delete "HKCU\Environment" /v SOLARA_BOOTSTRAPPER /f
      reg delete "HKCU\Environment" /v B2_KEY_ID /f
      reg delete "HKCU\Environment" /v B2_APPLICATION_KEY /f
      reg delete "HKCU\Software\Classes\CLSID\{A1B2C3D4-E5F6-7890-1234-567890ABCDEF}" /f
      reg delete "HKCU\Software\Classes\CLSID\{0b33e4f1-4d18-4f9a-9d1a-33418078b677}" /f

    NOTE: deleting UserInitMprLogonScript while a payload thread is alive does
    not stop the running implant. Kill the process FIRST (step 2).

  STEP 4 - DO NOT restore %windir% in HKCU by hand unless you know why it was
    shadowed; once the malware entry is deleted the SYSTEM value applies again
    automatically.

  STEP 5 - ROTATE CREDENTIALS
    - Revoke the exposed OPENAI_API_KEY at its issuer immediately.
    - Change every password used on this machine. Assume keylogging-equivalent
      access: the implant had CreateProcessW + arbitrary injection and lived
      here long enough to be upgraded at least once.

  STEP 6 - ASSUME FULL COMPROMISE
    This implant could execute arbitrary code inside any process it injected.
    Recommended: rebuild the machine from a known-good image.

  STEP 7 - HUNT
    - Search all machines for the registry paths in section 11.
    - Pivot on REDACTED_C2_DOMAIN and REDACTED_RELAY in DNS/proxy logs.
    - Hunt the cluster names SOLARA, BootstrapperNew, and the GUIDs above.
    - Check whether REDACTED_C2_DOMAIN resolves and to which IPs (from an isolated
      analysis host, never from this machine).

14. SCOPE OF THIS ANALYSIS
--------------------------------------------------------------------------------
  All analysis was STATIC and READ-ONLY.
    - The PowerShell loader was NEVER executed.
    - The shellcode was NEVER allocated, mapped, or run.
    - The registry was NEVER modified.
    - No network connection was made to any C2 or gateway domain.
    - No credential was used or transmitted.

  Confidence:
    HIGH      - persistence chain, loader source, payload bytes, hashes,
                reflective-loader algorithm, mutex, API table, C2 domain.
    MEDIUM    - C2 URL path/port/User-Agent. The domain is confirmed in
                cleartext at RVA 0xc6b0 with a single static xref; the scheme
                delimiter ':' is confirmed. The remaining URL components are
                built at runtime from XOR-encrypted .data globals at RVA
                0x12000 / 0x2000 / 0x21B0 / 0x21C0 and were not recovered.
    MEDIUM    - Second-stage payloads delivered by the RunPE chain. No drop
                directory, file path, or injected target process name survived
                in cleartext.

================================================================================
END OF REPORT
================================================================================
