import Foundation
import Capacitor
import Photos
import PhotosUI
import UIKit

/**
 * BodyLog 専用の軽量フォトライブラリブリッジ。
 * - getRecents: 直近のカメラロール画像のサムネイルを返す（アプリ内に写真グリッドを出すため）
 * - getPhoto:   選んだ1枚をフルサイズ（最大辺指定）で返す（iCloud写真もダウンロード）
 * - pickPhoto:  OSのPHPicker（写真グリッド）を直接開く。権限不要・プロンプトなし
 * Camera プラグインに依存しないため、「Take Photo / Photo Library」の選択シートは一切出ない。
 */
@objc(PhotosPlugin)
public class PhotosPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotosPlugin"
    public let jsName = "Photos"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRecents", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentLimitedPicker", returnType: CAPPluginReturnPromise)
    ]

    private var pickerDelegate: PhotosPickerDelegate?

    private func statusString(_ s: PHAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "granted"
        case .limited: return "limited"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "denied"
        }
    }

    @objc func authStatus(_ call: CAPPluginCall) {
        call.resolve(["status": statusString(PHPhotoLibrary.authorizationStatus(for: .readWrite))])
    }

    @objc func requestAccess(_ call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { s in
            DispatchQueue.main.async {
                call.resolve(["status": self.statusString(s)])
            }
        }
    }

    // 直近のカメラロール画像のサムネイル（端末内のみ・高速）
    @objc func getRecents(_ call: CAPPluginCall) {
        let count = call.getInt("count") ?? 24
        let size = CGFloat(call.getInt("size") ?? 160)
        let st = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard st == .authorized || st == .limited else {
            call.resolve(["photos": [], "status": statusString(st)])
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let opts = PHFetchOptions()
            opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            opts.fetchLimit = count
            let assets = PHAsset.fetchAssets(with: .image, options: opts)
            let mgr = PHImageManager.default()
            let reqOpts = PHImageRequestOptions()
            reqOpts.isSynchronous = true          // 同期＝1アセット1回だけ結果が返る
            reqOpts.resizeMode = .fast
            reqOpts.isNetworkAccessAllowed = false // サムネイルは端末内のみ（iCloud待ちで固まらせない）
            var out: [[String: String]] = []
            assets.enumerateObjects { asset, _, _ in
                autoreleasepool {
                    mgr.requestImage(for: asset, targetSize: CGSize(width: size, height: size),
                                     contentMode: .aspectFill, options: reqOpts) { img, _ in
                        if let img = img, let data = img.jpegData(compressionQuality: 0.6) {
                            out.append(["id": asset.localIdentifier, "thumb": data.base64EncodedString()])
                        }
                    }
                }
            }
            DispatchQueue.main.async {
                call.resolve(["photos": out, "status": self.statusString(st)])
            }
        }
    }

    // 選んだ1枚をフルサイズで取得（最大辺 maxSize・iCloud写真もダウンロード）
    @objc func getPhoto(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("id が指定されていません"); return }
        let maxSize = CGFloat(call.getInt("maxSize") ?? 1280)
        let res = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil)
        guard let asset = res.firstObject else { call.reject("写真が見つかりませんでした"); return }
        let reqOpts = PHImageRequestOptions()
        reqOpts.deliveryMode = .highQualityFormat // 高品質1回のみ返る（低品質→高品質の2回コールバックを防ぐ）
        reqOpts.resizeMode = .exact
        reqOpts.isNetworkAccessAllowed = true
        PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: maxSize, height: maxSize),
                                              contentMode: .aspectFit, options: reqOpts) { img, _ in
            guard let img = img, let data = img.jpegData(compressionQuality: 0.72) else {
                call.reject("写真データを取得できませんでした")
                return
            }
            call.resolve(["base64": data.base64EncodedString(), "mime": "image/jpeg"])
        }
    }

    // アプリの設定画面（写真アクセスの変更ができる場所）を開く
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("設定URLを生成できませんでした")
                return
            }
            UIApplication.shared.open(url, options: [:]) { ok in
                call.resolve(["opened": ok])
            }
        }
    }

    // 限定アクセス時: 「選択した写真」を追加・変更するOSシートを開く（閉じたらresolve）
    @objc func presentLimitedPicker(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("画面を取得できませんでした")
                return
            }
            PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: vc) { _ in
                call.resolve()
            }
        }
    }

    // OSの写真グリッド（PHPicker）を直接開く。権限不要・「Take Photo」等の選択肢は出ない
    @objc func pickPhoto(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var config = PHPickerConfiguration(photoLibrary: .shared())
            config.filter = .images
            config.selectionLimit = 1
            let picker = PHPickerViewController(configuration: config)
            let delegate = PhotosPickerDelegate(call: call) { [weak self] in self?.pickerDelegate = nil }
            self.pickerDelegate = delegate // delegateはweak保持のため自前で生存させる
            picker.delegate = delegate
            guard let vc = self.bridge?.viewController else {
                call.reject("画面を取得できませんでした")
                return
            }
            vc.present(picker, animated: true)
        }
    }
}

class PhotosPickerDelegate: NSObject, PHPickerViewControllerDelegate {
    private let call: CAPPluginCall
    private let onDone: () -> Void
    init(call: CAPPluginCall, onDone: @escaping () -> Void) {
        self.call = call
        self.onDone = onDone
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        defer { onDone() }
        guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
            call.resolve(["cancelled": true])
            return
        }
        provider.loadObject(ofClass: UIImage.self) { [call] obj, err in
            guard let img = obj as? UIImage else {
                call.reject(err?.localizedDescription ?? "写真の読み込みに失敗しました")
                return
            }
            // 最大辺1280pxへ縮小してJPEG化（アップロード用に十分な解像度）
            let maxDim: CGFloat = 1280
            let scale = min(1, maxDim / max(img.size.width, img.size.height))
            let newSize = CGSize(width: img.size.width * scale, height: img.size.height * scale)
            let fmt = UIGraphicsImageRendererFormat()
            fmt.scale = 1
            let resized = UIGraphicsImageRenderer(size: newSize, format: fmt).image { _ in
                img.draw(in: CGRect(origin: .zero, size: newSize))
            }
            guard let data = resized.jpegData(compressionQuality: 0.72) else {
                call.reject("JPEG変換に失敗しました")
                return
            }
            call.resolve(["base64": data.base64EncodedString(), "mime": "image/jpeg"])
        }
    }
}
