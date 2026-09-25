import UIKit
import Capacitor
import Security

/** Keeps the hosted API session in the iOS Keychain. */
@objc(SecureSessionPlugin)
public class SecureSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureSessionPlugin"
    public let jsName = "SecureSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private let keychainQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "app.spatialguard.mobile",
        kSecAttrAccount as String: "api-session"
    ]

    private var apiURL: String {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "SpatialGuardAPIURL") as? String,
           configured.hasPrefix("https://") {
            return configured
        }
        return "https://spatialguard-production.up.railway.app"
    }

    @objc public func read(_ call: CAPPluginCall) {
        var query = keychainQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("Secure session unavailable. Sign in again.")
            return
        }
        let token = (result as? Data).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        call.resolve(["token": token, "apiUrl": apiURL])
    }

    @objc public func write(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), (20...200).contains(token.count),
              let data = token.data(using: .utf8) else {
            call.reject("Invalid mobile session")
            return
        }
        let status = SecItemUpdate(
            keychainQuery as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if status == errSecItemNotFound {
            var item = keychainQuery
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
                call.reject("Could not save secure session")
                return
            }
        } else if status != errSecSuccess {
            call.reject("Could not save secure session")
            return
        }
        call.resolve()
    }

    @objc public func clear(_ call: CAPPluginCall) {
        let status = SecItemDelete(keychainQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            call.reject("Could not clear secure session")
            return
        }
        call.resolve()
    }
}

/** Registers the Keychain bridge before the shared web app starts. */
class SpatialGuardBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SecureSessionPlugin())
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = SpatialGuardBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
