import SwiftUI
import WebKit
import UniformTypeIdentifiers

// ── Bundle file server ─────────────────────────────────────────────────────
class TascaSchemeHandler: NSObject, WKURLSchemeHandler {

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL)); return
        }

        var path = url.path
        if path == "/" || path.isEmpty { path = "/index.html" }

        let filePath = Bundle.main.bundlePath + "/Web" + path

        guard let data = FileManager.default.contents(atPath: filePath) else {
            print("[TascaScheme] 404:", filePath)
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }

        let mime = Self.mimeType(for: url.pathExtension)
        let response = URLResponse(
            url: url,
            mimeType: mime,
            expectedContentLength: data.count,
            textEncodingName: "utf-8"
        )
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html":        return "text/html"
        case "js", "mjs":   return "text/javascript"
        case "css":         return "text/css"
        case "json":        return "application/json"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg":         return "image/svg+xml"
        case "woff":        return "font/woff"
        case "woff2":       return "font/woff2"
        case "ttf":         return "font/ttf"
        case "otf":         return "font/otf"
        default:            return "application/octet-stream"
        }
    }
}

// ── Main view ──────────────────────────────────────────────────────────────
struct TascaWebView: UIViewRepresentable {

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let coordinator = context.coordinator

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(TascaSchemeHandler(), forURLScheme: "tasca")

        let controller = WKUserContentController()

        let bridgePath = Bundle.main.bundlePath + "/Web/bridge.js"
        if let source = try? String(contentsOf: URL(fileURLWithPath: bridgePath)) {
            controller.addUserScript(
                WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }

        controller.add(coordinator, name: "ready")
        controller.add(coordinator, name: "autoSave")
        controller.add(coordinator, name: "link")
        controller.add(coordinator, name: "loadNow")
        controller.add(coordinator, name: "log")

        config.userContentController = controller
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .clear

        coordinator.webView = webView

        webView.load(URLRequest(url: URL(string: "tasca://localhost/index.html")!))

        NotificationCenter.default.addObserver(
            coordinator,
            selector: #selector(Coordinator.appWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    // ── Coordinator ────────────────────────────────────────────────────────
    class Coordinator: NSObject, WKScriptMessageHandler, UIDocumentPickerDelegate {
        weak var webView: WKWebView?
        let sync = iCloudSync()

        @objc func appWillEnterForeground() {
            loadFromCloud()
        }

        func loadFromCloud() {
            Task {
                guard let json = await sync.read(), !json.isEmpty else { return }
                await MainActor.run {
                    webView?.callAsyncJavaScript(
                        "return window.tascaLoad(json)",
                        arguments: ["json": json],
                        in: nil,
                        in: .page,
                        completionHandler: nil
                    )
                }
            }
        }

        // Save current DB contents to the linked file immediately
        func saveToCloud() {
            webView?.callAsyncJavaScript("""
                if (window.__tascaSerialize) {
                    const data = await window.__tascaSerialize();
                    window.webkit.messageHandlers.autoSave.postMessage(JSON.stringify(data));
                }
            """, arguments: [:], in: nil, in: .page, completionHandler: nil)
        }

        // ── Document picker ────────────────────────────────────────────────

        @MainActor
        func showFilePicker() {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.json])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                  let root = scene.windows.first?.rootViewController else { return }
            root.present(picker, animated: true)
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            sync.link(to: url)
            // Load whatever is in the picked file, then save current DB into it
            Task {
                let existing = await sync.read()
                if let json = existing, !json.isEmpty {
                    await MainActor.run {
                        webView?.callAsyncJavaScript(
                            "return window.tascaLoad(json)",
                            arguments: ["json": json],
                            in: nil,
                            in: .page,
                            completionHandler: nil
                        )
                    }
                }
                await MainActor.run { saveToCloud() }

                await MainActor.run {
                    webView?.callAsyncJavaScript(
                        "window.webkit.messageHandlers.log.postMessage('Linked to \(url.lastPathComponent)')",
                        arguments: [:], in: nil, in: .page, completionHandler: nil
                    )
                }
            }
        }

        // ── Message handlers ───────────────────────────────────────────────

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            switch message.name {
            case "ready":
                loadFromCloud()
            case "autoSave":
                guard let json = message.body as? String else { return }
                sync.write(json)
            case "link":
                Task { await MainActor.run { self.showFilePicker() } }
            case "loadNow":
                loadFromCloud()
            case "log":
                print("[TascaJS]", message.body)
            default:
                break
            }
        }
    }
}
