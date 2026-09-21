## Android smoke: ALIVE=0

### ❌ 落ちた操作:  [起動:プロセス死亡]

### 致命例外（logcat-full）
```
11363:09-21 05:16:51.297  3871  3871 F libc    : Fatal signal 11 (SIGSEGV), code 2 (SEGV_ACCERR), fault addr 0x727d47dcb000 in tid 3871 (tcha.bodylog.rn), pid 3871 (tcha.bodylog.rn)
11532:09-21 05:16:52.041  4200  4200 F DEBUG   : signal 11 (SIGSEGV), code 2 (SEGV_ACCERR), fault addr 0x0000727d47dcb000
11565:09-21 05:16:52.122   519  2403 I ActivityManager: Process com.gotcha.bodylog.rn (pid 3871) has died: fg  TOP 
```
### JS 例外（ReactNativeJS）
```
2:09-21 05:16:50.922  3871  3980 I ReactNativeJS: Running "main"
3:09-21 05:16:51.061  3871  3980 W ReactNativeJS: '[boot:supabase.env]', 'EXPO_PUBLIC_SUPABASE_URL がビルドに埋め込まれていません'
```
### crash buffer 先頭 120 行
```
--------- beginning of crash
09-21 05:16:51.297  3871  3871 F libc    : Fatal signal 11 (SIGSEGV), code 2 (SEGV_ACCERR), fault addr 0x727d47dcb000 in tid 3871 (tcha.bodylog.rn), pid 3871 (tcha.bodylog.rn)
09-21 05:16:52.041  4200  4200 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
09-21 05:16:52.041  4200  4200 F DEBUG   : Build fingerprint: 'google/sdk_gphone64_x86_64/emu64xa:14/UE1A.230829.050/12077443:userdebug/dev-keys'
09-21 05:16:52.041  4200  4200 F DEBUG   : Revision: '0'
09-21 05:16:52.041  4200  4200 F DEBUG   : ABI: 'x86_64'
09-21 05:16:52.041  4200  4200 F DEBUG   : Timestamp: 2026-09-21 05:16:51.425353605+0000
09-21 05:16:52.041  4200  4200 F DEBUG   : Process uptime: 4s
09-21 05:16:52.041  4200  4200 F DEBUG   : Cmdline: com.gotcha.bodylog.rn
09-21 05:16:52.041  4200  4200 F DEBUG   : pid: 3871, tid: 3871, name: tcha.bodylog.rn  >>> com.gotcha.bodylog.rn <<<
09-21 05:16:52.041  4200  4200 F DEBUG   : uid: 10192
09-21 05:16:52.041  4200  4200 F DEBUG   : signal 11 (SIGSEGV), code 2 (SEGV_ACCERR), fault addr 0x0000727d47dcb000
09-21 05:16:52.041  4200  4200 F DEBUG   :     rax 0000000000000001  rbx 0000000000000080  rcx 0000727d47dcaff8  rdx 0000000000000000
09-21 05:16:52.041  4200  4200 F DEBUG   :     r8  0000000000000400  r9  0000727d1df3d140  r10 0000000000002000  r11 0000000000000246
09-21 05:16:52.041  4200  4200 F DEBUG   :     r12 0000727d47dcaff8  r13 0000727d1df3d1a0  r14 0000727885bfe640  r15 00007ffff89062c8
09-21 05:16:52.041  4200  4200 F DEBUG   :     rdi 0000000000000000  rsi 0000727885bfe5f0
09-21 05:16:52.041  4200  4200 F DEBUG   :     rbp 0000727885bfe630  rsp 0000727885bfe5f0  rip 0000727d1df2ed45
09-21 05:16:52.041  4200  4200 F DEBUG   : 13 total frames
09-21 05:16:52.041  4200  4200 F DEBUG   : backtrace:
09-21 05:16:52.041  4200  4200 F DEBUG   :       #00 pc 00000000000cfd45  /apex/com.android.runtime/lib64/bionic/libc.so (android_unsafe_frame_pointer_chase+117) (BuildId: fa337969c798946280caa45e2d71a2e7)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #01 pc 0000000000051a77  /apex/com.android.runtime/lib64/bionic/libc.so (gwp_asan::AllocationMetadata::CallSiteInfo::RecordBacktrace(unsigned long (*)(unsigned long*, unsigned long))+87) (BuildId: fa337969c798946280caa45e2d71a2e7)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #02 pc 000000000005230c  /apex/com.android.runtime/lib64/bionic/libc.so (gwp_asan::GuardedPoolAllocator::deallocate(void*)+380) (BuildId: fa337969c798946280caa45e2d71a2e7)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #03 pc 000000000014a7d2  /data/app/~~OGydMpD7MGwqgWZS2f3gOg==/com.gotcha.bodylog.rn-kaqlBq9wwZ5JmYy5fKPmmw==/base.apk!libhermesvm.so (offset 0x24e8000) (BuildId: 8d927b4d4757e3548fed384ed5666d66ee44c365)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #04 pc 0000000000147be7  /data/app/~~OGydMpD7MGwqgWZS2f3gOg==/com.gotcha.bodylog.rn-kaqlBq9wwZ5JmYy5fKPmmw==/base.apk!libhermesvm.so (offset 0x24e8000) (BuildId: 8d927b4d4757e3548fed384ed5666d66ee44c365)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #05 pc 000000000013389a  /data/app/~~OGydMpD7MGwqgWZS2f3gOg==/com.gotcha.bodylog.rn-kaqlBq9wwZ5JmYy5fKPmmw==/base.apk!libhermesvm.so (offset 0x24e8000) (BuildId: 8d927b4d4757e3548fed384ed5666d66ee44c365)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #06 pc 000000000013414f  /data/app/~~OGydMpD7MGwqgWZS2f3gOg==/com.gotcha.bodylog.rn-kaqlBq9wwZ5JmYy5fKPmmw==/base.apk!libhermesvm.so (offset 0x24e8000) (BuildId: 8d927b4d4757e3548fed384ed5666d66ee44c365)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #07 pc 0000000000120fe8  /data/app/~~OGydMpD7MGwqgWZS2f3gOg==/com.gotcha.bodylog.rn-kaqlBq9wwZ5JmYy5fKPmmw==/base.apk!libhermesvm.so (offset 0x24e8000) (BuildId: 8d927b4d4757e3548fed384ed5666d66ee44c365)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #08 pc 00000000001382b0  /data/app/~~OGydMpD7MGwqgWZS2f3gOg==/com.gotcha.bodylog.rn-kaqlBq9wwZ5JmYy5fKPmmw==/base.apk!libhermesvm.so (offset 0x24e8000) (BuildId: 8d927b4d4757e3548fed384ed5666d66ee44c365)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #09 pc 0000000000120dd0  /data/app/~~OGydMpD7MGwqgWZS2f3gOg==/com.gotcha.bodylog.rn-kaqlBq9wwZ5JmYy5fKPmmw==/base.apk!libhermesvm.so (offset 0x24e8000) (BuildId: 8d927b4d4757e3548fed384ed5666d66ee44c365)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #10 pc 00000000002599b3  /data/app/~~OGydMpD7MGwqgWZS2f3gOg==/com.gotcha.bodylog.rn-kaqlBq9wwZ5JmYy5fKPmmw==/base.apk!libhermesvm.so (offset 0x24e8000) (BuildId: 8d927b4d4757e3548fed384ed5666d66ee44c365)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #11 pc 0000000000191a79  /data/app/~~OGydMpD7MGwqgWZS2f3gOg==/com.gotcha.bodylog.rn-kaqlBq9wwZ5JmYy5fKPmmw==/base.apk!libhermesvm.so (offset 0x24e8000) (BuildId: 8d927b4d4757e3548fed384ed5666d66ee44c365)
09-21 05:16:52.041  4200  4200 F DEBUG   :       #12 pc 00000000000afe8e  /data/app/~~OGydMpD7MGwqgWZS2f3gOg==/com.gotcha.bodylog.rn-kaqlBq9wwZ5JmYy5fKPmmw==/base.apk!libhermesvm.so (offset 0x24e8000) (hoost_make_fcontext+46) (BuildId: 8d927b4d4757e3548fed384ed5666d66ee44c365)
```
### AndroidRuntime / FATAL の前後（logcat-full から 60 行）
```
11358-09-21 05:16:51.271  4154  4154 I gs.intelligence: Using CollectorTypeCC GC.
11359-09-21 05:16:51.271  4154  4154 W gs.intelligence: Unexpected CPU variant for x86: x86_64.
11360-09-21 05:16:51.271  4154  4154 W gs.intelligence: Known variants: atom, sandybridge, silvermont, goldmont, goldmont-plus, tremont, kabylake, default
11361-09-21 05:16:51.278  3895  3895 W kch     : AccountUtils: For b/73513912, load account content://com.google.android.gm.email.provider/account.-437561172?suppress_combined%3Dtrue from MailAppProvider. Is account valid result: 1. [CONTEXT android_log_tag="AccountUtils" ]
11362---------- beginning of crash
11363:09-21 05:16:51.297  3871  3871 F libc    : Fatal signal 11 (SIGSEGV), code 2 (SEGV_ACCERR), fault addr 0x727d47dcb000 in tid 3871 (tcha.bodylog.rn), pid 3871 (tcha.bodylog.rn)
11364-09-21 05:16:51.297  4154  4154 E gs.intelligence: Not starting debugger since process cannot load the jdwp agent.
11365-09-21 05:16:51.303   519   754 D MediaMetricsManagerService: failed to get player_metrics_app_blocklist from DeviceConfig
11366-09-21 05:16:51.304   519   754 V MediaMetricsManagerService: Logging level blocked: Failed to get PLAYER_METRICS_APP_BLOCKLIST.
11367-09-21 05:16:51.309  3895  3895 W kch     : [Gmail] PhenotypeManagerImpl: Account is null, skip calling setAccount.
11368-09-21 05:16:51.310  3895  3895 D CompatibilityChangeReporter: Compat change id reported: 194532703; UID 10143; state: ENABLED
11369-09-21 05:16:51.310  3895  3895 D CompatibilityChangeReporter: Compat change id reported: 253665015; UID 10143; state: DISABLED
11370-09-21 05:16:51.310   519  1440 D CompatibilityChangeReporter: Compat change id reported: 253665015; UID 10143; state: DISABLED
11371-09-21 05:16:51.310   519  1440 D CompatibilityChangeReporter: Compat change id reported: 194532703; UID 10143; state: ENABLED
11372-09-21 05:16:51.344  1681  3060 I AiAiCaptions: maybeDownloadModelAndUpdateComponents(): model set [en_US] is available to download.
11373-09-21 05:16:51.344  1681  2246 I SP.AiAi : Syncing text-classifier-langid (1941001461) with slices: [tc_model_436dc3fd14049b93d75788a8c0cc8eea], metadata: false
11374-09-21 05:16:51.352   519   593 D ConnectivityService: requestNetwork for uid/pid:10139/3985 activeRequest: null callbackRequest: 110 [NetworkRequest [ REQUEST id=111, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VCN_MANAGED Uid: 10139 RequestorUid: 10139 RequestorPkg: com.google.android.youtube UnderlyingNetworks: Null] ]] callback flags: 0 order: 2147483647
11375-09-21 05:16:51.354   519   768 D ConnectivityService: NetReassign [111 : null → 100] [c 1] [a 0] [i 1]
11376-09-21 05:16:51.354   519   761 D WifiNetworkFactory: got request NetworkRequest [ REQUEST id=111, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VCN_MANAGED Uid: 10139 RequestorUid: 10139 RequestorPkg: com.google.android.youtube UnderlyingNetworks: Null] ]
11377-09-21 05:16:51.354   519   761 D UntrustedWifiNetworkFactory: got request NetworkRequest [ REQUEST id=111, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VCN_MANAGED Uid: 10139 RequestorUid: 10139 RequestorPkg: com.google.android.youtube UnderlyingNetworks: Null] ]
11378-09-21 05:16:51.354   519   761 D OemPaidWifiNetworkFactory: got request NetworkRequest [ REQUEST id=111, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VCN_MANAGED Uid: 10139 RequestorUid: 10139 RequestorPkg: com.google.android.youtube UnderlyingNetworks: Null] ]
11379-09-21 05:16:51.354   519   761 D MultiInternetWifiNetworkFactory: got request NetworkRequest [ REQUEST id=111, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VCN_MANAGED Uid: 10139 RequestorUid: 10139 RequestorPkg: com.google.android.youtube UnderlyingNetworks: Null] ]
11380-09-21 05:16:51.369  3985  4065 D CompatibilityChangeReporter: Compat change id reported: 160794467; UID 10139; state: ENABLED
11381-09-21 05:16:51.370  1681  2246 I SP.AiAi : Scheduling job with delay of 0s for {W:b:I:l, bg}, 1 candidates
11382-09-21 05:16:51.386   519   593 D ConnectivityService: requestNetwork for uid/pid:10139/3985 activeRequest: null callbackRequest: 112 [NetworkRequest [ REQUEST id=113, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VCN_MANAGED Uid: 10139 RequestorUid: 10139 RequestorPkg: com.google.android.youtube UnderlyingNetworks: Null] ]] callback flags: 0 order: 2147483647
11383-09-21 05:16:51.387   519   761 D WifiNetworkFactory: got request NetworkRequest [ REQUEST id=113, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VCN_MANAGED Uid: 10139 RequestorUid: 10139 RequestorPkg: com.google.android.youtube UnderlyingNetworks: Null] ]
11384-09-21 05:16:51.387   519   761 D UntrustedWifiNetworkFactory: got request NetworkRequest [ REQUEST id=113, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VCN_MANAGED Uid: 10139 RequestorUid: 10139 RequestorPkg: com.google.android.youtube UnderlyingNetworks: Null] ]
11385-09-21 05:16:51.387   519   761 D OemPaidWifiNetworkFactory: got request NetworkRequest [ REQUEST id=113, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VCN_MANAGED Uid: 10139 RequestorUid: 10139 RequestorPkg: com.google.android.youtube UnderlyingNetworks: Null] ]
11386-09-21 05:16:51.388   519   761 D MultiInternetWifiNetworkFactory: got request NetworkRequest [ REQUEST id=113, [ Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VCN_MANAGED Uid: 10139 RequestorUid: 10139 RequestorPkg: com.google.android.youtube UnderlyingNetworks: Null] ]
11387-09-21 05:16:51.388   519   768 D ConnectivityService: NetReassign [113 : null → 100] [c 0] [a 0] [i 1]
11388-09-21 05:16:51.396  1681  2420 W AiAiAutofill: Failed to set whitelist for augmented autofill service.
11389-09-21 05:16:51.396  1681  2420 W AiAiAutofill: java.lang.SecurityException: caller is not user's Augmented Autofill Service
11390-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at android.view.autofill.AutofillManager.setAugmentedAutofillWhitelist(AutofillManager.java:2676)
11391-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at cjj.c(PG:7)
11392-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at cju.g(PG:8)
11393-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at cju.i(Unknown Source:3)
11394-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at cju.h(PG:2)
11395-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at cjv.a(PG:3)
11396-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at dgq.run(PG:41)
11397-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at dgq.run(PG:69)
11398-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at java.util.concurrent.Executors$RunnableAdapter.call(Executors.java:487)
11399-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at java.util.concurrent.FutureTask.run(FutureTask.java:264)
11400-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at java.util.concurrent.ScheduledThreadPoolExecutor$ScheduledFutureTask.run(ScheduledThreadPoolExecutor.java:307)
11401-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1145)
11402-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:644)
11403-09-21 05:16:51.396  1681  2420 W AiAiAutofill: 	at dgq.run(PG:67)
```
