## Android smoke: ALIVE=0

### 致命例外（logcat-full）
```
11677:09-07 04:16:21.159  3753  3857 E AndroidRuntime: FATAL EXCEPTION: mqt_v_native
11817:09-07 04:16:21.577   524  2029 I ActivityManager: Process com.gotcha.bodylog.rn (pid 3753) has died: prcp TOP 
```
### JS 例外（ReactNativeJS）
```
2:09-07 04:16:20.800  3753  3855 I ReactNativeJS: Running "main"
```
### crash buffer 先頭 120 行
```
--------- beginning of crash
09-07 04:16:21.159  3753  3857 E AndroidRuntime: FATAL EXCEPTION: mqt_v_native
09-07 04:16:21.159  3753  3857 E AndroidRuntime: Process: com.gotcha.bodylog.rn, PID: 3753
09-07 04:16:21.159  3753  3857 E AndroidRuntime: java.lang.NullPointerException: Parameter specified as non-null is null: method com.facebook.react.modules.appearance.AppearanceModule.setColorScheme, parameter style
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.react.modules.appearance.AppearanceModule.setColorScheme(Unknown Source:2)
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.jni.NativeRunnable.run(Native Method)
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at android.os.Handler.handleCallback(Handler.java:958)
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at android.os.Handler.dispatchMessage(Handler.java:99)
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.react.bridge.queue.MessageQueueThreadHandler.dispatchMessage(MessageQueueThreadHandler.kt:21)
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at android.os.Looper.loopOnce(Looper.java:205)
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at android.os.Looper.loop(Looper.java:294)
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.react.bridge.queue.MessageQueueThreadImpl$Companion.startNewBackgroundThread$lambda$0(MessageQueueThreadImpl.kt:152)
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.react.bridge.queue.MessageQueueThreadImpl$Companion.$r8$lambda$YYXYCFexeoKtAeDpeNYkxZZlpbA(Unknown Source:0)
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.react.bridge.queue.MessageQueueThreadImpl$Companion$$ExternalSyntheticLambda0.run(D8$$SyntheticClass:0)
09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at java.lang.Thread.run(Thread.java:1012)
```
### AndroidRuntime / FATAL の前後（logcat-full から 60 行）
```
11672-09-07 04:16:21.137   524   991 W system_server: Long monitor contention with owner PackageManager (579) at void com.android.server.am.OomAdjuster.updateOomAdjLocked(int)(OomAdjuster.java:570) waiters=1 in boolean com.android.server.am.ActivityManagerService.isUidActive(int, java.lang.String) for 250ms
11673-09-07 04:16:21.142   336   376 I netd    : bandwidthRemoveInterfaceQuota(eth0) <2.42ms>
11674-09-07 04:16:21.143   336   376 I netd    : bandwidthSetInterfaceQuota(eth0, 9223372036854775807) <0.35ms>
11675-09-07 04:16:21.157  3753  3857 W unknown:BridgelessReact: ReactHost{0}.handleHostException(message = "Parameter specified as non-null is null: method com.facebook.react.modules.appearance.AppearanceModule.setColorScheme, parameter style")
11676---------- beginning of crash
11677:09-07 04:16:21.159  3753  3857 E AndroidRuntime: FATAL EXCEPTION: mqt_v_native
11678-09-07 04:16:21.159  3753  3857 E AndroidRuntime: Process: com.gotcha.bodylog.rn, PID: 3753
11679-09-07 04:16:21.159  3753  3857 E AndroidRuntime: java.lang.NullPointerException: Parameter specified as non-null is null: method com.facebook.react.modules.appearance.AppearanceModule.setColorScheme, parameter style
11680-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.react.modules.appearance.AppearanceModule.setColorScheme(Unknown Source:2)
11681-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.jni.NativeRunnable.run(Native Method)
11682-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at android.os.Handler.handleCallback(Handler.java:958)
11683-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at android.os.Handler.dispatchMessage(Handler.java:99)
11684-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.react.bridge.queue.MessageQueueThreadHandler.dispatchMessage(MessageQueueThreadHandler.kt:21)
11685-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at android.os.Looper.loopOnce(Looper.java:205)
11686-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at android.os.Looper.loop(Looper.java:294)
11687-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.react.bridge.queue.MessageQueueThreadImpl$Companion.startNewBackgroundThread$lambda$0(MessageQueueThreadImpl.kt:152)
11688-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.react.bridge.queue.MessageQueueThreadImpl$Companion.$r8$lambda$YYXYCFexeoKtAeDpeNYkxZZlpbA(Unknown Source:0)
11689-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at com.facebook.react.bridge.queue.MessageQueueThreadImpl$Companion$$ExternalSyntheticLambda0.run(D8$$SyntheticClass:0)
11690-09-07 04:16:21.159  3753  3857 E AndroidRuntime: 	at java.lang.Thread.run(Thread.java:1012)
11691-09-07 04:16:21.164   524  3956 I DropBoxManagerService: add tag=data_app_crash isTagEnabled=true flags=0x2
11692-09-07 04:16:21.166   336  3957 I resolv  : GetAddrInfoHandler::run: {100 786532 100 983140 10131 0}
11693-09-07 04:16:21.166  3127  3180 D TrafficStats: tagSocket(108) with statsTag=0x1809, statsUid=-1
11694-09-07 04:16:21.182   524  2310 V ActivityManager: Got obituary of 3869:com.google.android.settings.intelligence
11695-09-07 04:16:21.183   524   619 D ActivityManager: freezing 1845 com.google.android.apps.youtube.music
11696-09-07 04:16:21.199   524  2313 W ActivityManager: Unbind failed: could not find connection for android.os.BinderProxy@6d2229f
11697-09-07 04:16:21.199  1466  3086 I SingleHostAsyncVerifier: Verification result: checking for a statement with source # dmsa@6c48dee7, relation delegate_permission/common.handle_all_urls, and target # dmsa@2cbe911d --> true. [CONTEXT service_id=244 ]
11698-09-07 04:16:21.199  1412  1646 W GmsClient: unable to connect to service: com.google.android.gms.home.service.START on com.google.android.gms
11699-09-07 04:16:21.200   524  2310 D OomAdjuster: Not killing cached processes
11700-09-07 04:16:21.219   524   612 D CompatibilityChangeReporter: Compat change id reported: 218533173; UID 10118; state: ENABLED
11701-09-07 04:16:21.219   524   612 D CompatibilityChangeReporter: Compat change id reported: 262645982; UID 10118; state: ENABLED
11702-09-07 04:16:21.221   524   620 I RoleService: Granting default roles...
11703-09-07 04:16:21.228   524   909 W ActivityTaskManager:   Force finishing activity com.gotcha.bodylog.rn/.MainActivity
11704-09-07 04:16:21.229   841   878 V WindowManagerShell: Transition requested: android.os.BinderProxy@ca5e323 TransitionRequestInfo { type = CLOSE, triggerTask = null, remoteTransition = null, displayChange = null }
11705-09-07 04:16:21.231  3127  3180 D TrafficStats: tagSocket(108) with statsTag=0x1809, statsUid=-1
11706-09-07 04:16:21.232  3127  3180 D TrafficStats: tagSocket(108) with statsTag=0x1809, statsUid=-1
11707-09-07 04:16:21.235  3127  3180 W libc    : Access denied finding property "persist.adb.tls_server.enable"
11708-09-07 04:16:21.236  3127  3180 W libc    : Access denied finding property "service.adb.tls.port"
11709-09-07 04:16:21.232  3127  3127 W binder:3127_4: type=1400 audit(0.0:15): avc:  denied  { read } for  name="u:object_r:system_adbd_prop:s0" dev="tmpfs" ino=292 scontext=u:r:gmscore_app:s0:c512,c768 tcontext=u:object_r:system_adbd_prop:s0 tclass=file permissive=0 app=com.google.android.gms
11710-09-07 04:16:21.407     0     0 I logd    : start watching /data/system/packages.list ...
11711-09-07 04:16:21.413     0     0 I logd    : ReadPackageList, total packages: 200
11712-09-07 04:16:21.249  1708  2092 I SP.AiAi : Scheduling: job start ({m:b:u:l, bg}), 1 started, 0 paused, 2 scheduled, 3 pending: manifests:webref-2-en-us-19071200 @ * {m:b:u:l, bg}, manifests:spelling_correction-22110320 * {W:b:I:l, bg}, kg_collections_table:collections_table_main_21980965fbd997111d89f86c16e9e090 * {W:b:u:l, bg}
11713-09-07 04:16:21.249  1708  2008 W ogle.android.as: Long monitor contention with owner aiai-sp-0 (2092) at void krm.b(krr, kcx, kro, long, java.lang.String)(PG:72) waiters=0 in ofk kri.e(kle, kky, java.io.File) for 3.363s
11714-09-07 04:16:21.260  1708  2008 I SP.AiAi : Scheduling job with delay of 0s for {W:b:I:l, bg}, 1 candidates
11715-09-07 04:16:21.262  1412  3475 I GCoreUlr: WorldUpdater:android.location.PROVIDERS_CHANGED: Ensuring that reporting is stopped because of reasons: (no Google accounts)
11716-09-07 04:16:21.232  3127  3127 W binder:3127_4: type=1400 audit(0.0:16): avc:  denied  { read } for  name="u:object_r:adbd_prop:s0" dev="tmpfs" ino=60 scontext=u:r:gmscore_app:s0:c512,c768 tcontext=u:object_r:adbd_prop:s0 tclass=file permissive=0 app=com.google.android.gms
11717-09-07 04:16:21.263  1412  3475 I GCoreUlr: Unbound from all signal providers.
```
