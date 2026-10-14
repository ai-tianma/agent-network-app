// 点系统通知要打开那条对话。
// tauri-plugin-notification 2.4 在桌面端把点击丢掉(desktop.rs 只 show(),不回事件)。
// 窗口焦点推断也不可靠:人正开着别的会话时窗口本来就有焦点,点通知不会再触发 focus。
// 这里自己发通知,点正文(default)就聚焦主窗口并走托盘那条 tray-open-chat。

use tauri::{AppHandle, Runtime};
#[cfg(not(target_os = "macos"))]
use tauri::Emitter;

// 0.2.173(Vincent:每次打开 mac 版都弹「Choose Application — Where is use_default?」):
// macOS 上 notify-rust 发第一条通知前若没 set_application,mac-notification-sys 的
// ensure_application_set() 会跑 AppleScript `get id of application "use_default"`
// → 系统弹「Where is use_default?」选程序框。插件 2.4 自己发通知前会 set_application,
// 但我们这条路(点通知打开对话)不经过插件。所以 setup 里先登记一次,发通知的地方
// 再兜一次(底层是 Once,重复调只回 AlreadySet)。
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn notification_app_id(dev: bool, identifier: &str) -> &str {
    // 和插件 desktop.rs 同一判据:开发态没有打包的 bundle,借 Terminal 的身份。
    if dev {
        "com.apple.Terminal"
    } else {
        identifier
    }
}

pub fn init_notification_app<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    {
        let _ = notify_rust::set_application(notification_app_id(tauri::is_dev(), &app.config().identifier));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// 本 crate 里唯一构造 notify_rust::Notification 的地方(源码测试钉住)。
fn new_notification<R: Runtime>(app: &AppHandle<R>) -> notify_rust::Notification {
    init_notification_app(app);
    notify_rust::Notification::new()
}

pub(crate) fn opens_chat(response: &notify_rust::NotificationResponse) -> bool {
    match response {
        notify_rust::NotificationResponse::Default => true,
        notify_rust::NotificationResponse::Action(key) => key == "default",
        _ => false,
    }
}

/// 闭包推不出「对任意生命周期」的 FnOnce,改成 trait 实现。
#[cfg(not(target_os = "macos"))]
struct ClickReport {
    tx: std::sync::mpsc::Sender<bool>,
}

#[cfg(not(target_os = "macos"))]
impl notify_rust::ResponseHandler for ClickReport {
    fn call(self, response: &notify_rust::NotificationResponse) {
        let _ = self.tx.send(opens_chat(response));
    }
}

#[tauri::command]
pub fn show_chat_notification<R: Runtime>(app: AppHandle<R>, alias: String, title: String, body: String) -> bool {
    let alias = alias.trim().to_string();
    if alias.is_empty() {
        return false;
    }
    std::thread::spawn(move || {
        let mut notification = new_notification(&app);
        notification.summary(&title).body(&body).appname("ANet");
        // Linux: 不登记 default,点正文不会回报。Windows 点正文是 Default,这个按钮也是同一条路。
        notification.action("default", "打开");
        #[cfg(windows)]
        set_windows_app_id(&mut notification);
        let Ok(handle) = notification.show() else {
            return;
        };
        // mac-notification-sys polls deliveredNotifications on the main thread while
        // waiting for a click. That synchronous XPC call can freeze the entire UI.
        #[cfg(target_os = "macos")]
        drop(handle);
        #[cfg(not(target_os = "macos"))]
        {
            // 回调必须对任意生命周期都成立。先把「点中没有」收成 bool,再在外面打开会话。
            let (tx, rx) = std::sync::mpsc::channel();
            let _ = handle.wait_for_response(ClickReport { tx });
            if rx.recv().unwrap_or(false) {
                crate::tray::focus_main(&app);
                let _ = app.emit("tray-open-chat", alias);
            }
        }
    });
    !cfg!(target_os = "macos")
}

#[cfg(windows)]
fn set_windows_app_id(notification: &mut notify_rust::Notification) {
    use std::path::MAIN_SEPARATOR as SEP;
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = exe.parent() else {
        return;
    };
    let curr = dir.display().to_string();
    if curr.ends_with(&format!("{SEP}target{SEP}debug")) || curr.ends_with(&format!("{SEP}target{SEP}release")) {
        return;
    }
    notification.app_id("top.vansin.agentnetwork.desktop");
}

#[cfg(test)]
mod tests {
    use super::{notification_app_id, opens_chat};
    use notify_rust::{CloseReason, NotificationResponse};

    #[test]
    fn mac_notifications_use_the_bundle_identifier_not_use_default() {
        assert_eq!(notification_app_id(false, "top.vansin.agentnetwork.desktop"), "top.vansin.agentnetwork.desktop");
        assert_eq!(notification_app_id(true, "top.vansin.agentnetwork.desktop"), "com.apple.Terminal");
    }

    // 源码层契约:只能证明「构造都走 new_notification、setup 调了 init_notification_app」;
    // 证明不了 macOS 上真的不弹框(那要在 Mac 上跑打包产物)。
    #[test]
    fn every_notify_rust_notification_goes_through_the_set_application_guard() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut constructed = Vec::new();
        for entry in std::fs::read_dir(&dir).expect("read src") {
            let path = entry.expect("entry").path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("read file");
            for (i, line) in text.lines().enumerate() {
                if line.contains("Notification::new()") && !line.trim_start().starts_with("//") && !line.contains("contains(") {
                    constructed.push(format!("{}:{}", path.file_name().unwrap().to_string_lossy(), i + 1));
                }
            }
        }
        let own = include_str!("chat_notify.rs");
        let helper = own.find("fn new_notification").expect("helper exists");
        let guard_line = own[helper..].lines().nth(1).unwrap_or("");
        assert!(guard_line.contains("init_notification_app(app)"), "helper must set the app first: {guard_line}");
        // 期望的那一行 = helper 里真正调用 Notification::new() 的那一行(按内容找,不按偏移算)。
        let expected_line = own
            .lines()
            .position(|l| l.contains("notify_rust::Notification::new()") && !l.trim_start().starts_with("//") && !l.contains("contains("))
            .map(|i| i + 1)
            .expect("helper constructs the notification");
        assert!(own.lines().nth(expected_line - 2).unwrap_or("").contains("init_notification_app(app)"), "set_application must run right before construction");
        assert_eq!(constructed, vec![format!("chat_notify.rs:{expected_line}")], "notify_rust::Notification built outside new_notification");

        let lib = include_str!("lib.rs");
        let setup = lib.find(".setup(|app|").expect("setup block");
        assert!(lib[setup..].contains("chat_notify::init_notification_app(app.handle())"), "setup must register the bundle id");
    }

    #[test]
    fn body_click_opens_the_chat() {
        assert!(opens_chat(&NotificationResponse::Default));
        assert!(opens_chat(&NotificationResponse::Action("default".into())));
        assert!(!opens_chat(&NotificationResponse::Action("other".into())));
        assert!(!opens_chat(&NotificationResponse::Closed(CloseReason::Dismissed)));
    }
}
