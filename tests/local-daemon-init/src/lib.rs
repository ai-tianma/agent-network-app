#![allow(dead_code)]
use std::{fs, path::{Path, PathBuf}};

fn app_root() -> Result<PathBuf, String> {
    std::env::var_os("ANET_TEST_ROOT").map(PathBuf::from).ok_or_else(|| "fixture root missing".into())
}
fn ensure_private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}
fn write_private_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    // The installer uses the desktop's existing private-file writer in production.
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).and_then(|_| fs::rename(tmp, path)).map_err(|e| e.to_string())
}
#[path = "../../../src-tauri/src/local_daemon.rs"]
mod local_daemon;

#[cfg(test)]
mod regression {
    use super::*;
    use std::{io::{Read, Write}, net::TcpListener, os::unix::fs::PermissionsExt,
        process::{Command, Stdio}, sync::{Arc, atomic::{AtomicBool, Ordering}}, thread, time::Duration};

    struct Fixture {
        root: tempfile::TempDir,
        session: local_daemon::LocalHubSession,
        server_done: Arc<AtomicBool>,
        server: Option<thread::JoinHandle<()>>,
        saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
    }
    impl Fixture {
        fn new(hub_version: &str) -> Self {
            let root = tempfile::tempdir().unwrap();
            let bin = root.path().join("tools");
            fs::create_dir_all(&bin).unwrap();
            executable(&bin.join("shell"), "#!/bin/sh\nwhile [ \"$#\" -gt 1 ]; do shift; done\nexec /bin/sh -c \"$1\"\n");
            executable(&bin.join("node"), "#!/bin/sh\necho v22.23.0\n");
            executable(&bin.join("npm"), include_str!("npm.py"));
            fs::write(root.path().join("anet.py"), include_str!("anet.py")).unwrap();
            let saved = ["ANET_TEST_ROOT", "SHELL", "PATH"].into_iter().map(|k| (k, std::env::var_os(k))).collect();
            std::env::set_var("ANET_TEST_ROOT", root.path());
            std::env::set_var("SHELL", bin.join("shell"));
            std::env::set_var("PATH", format!("{}:/usr/bin:/bin", bin.display()));
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let endpoint = format!("http://{}", listener.local_addr().unwrap());
            let server_done = Arc::new(AtomicBool::new(false));
            let done = server_done.clone();
            let root_path = root.path().to_path_buf();
            let version = hub_version.to_owned();
            let server = thread::spawn(move || {
                while !done.load(Ordering::SeqCst) {
                    let Ok((mut stream, _)) = listener.accept() else { thread::sleep(Duration::from_millis(10)); continue; };
                    stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                    let mut buffer = [0; 4096];
                    let n = stream.read(&mut buffer).unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..n]);
                    let body = if request.starts_with("GET /health ") {
                        serde_json::json!({"version": version})
                    } else {
                        let profile = root_path.join("local-daemon/.anet/nodes/local-daemon/config.json");
                        let cfg: serde_json::Value = fs::read(profile).ok().and_then(|v| serde_json::from_slice(&v).ok()).unwrap_or_default();
                        let started = root_path.join("local-daemon/.anet/nodes/local-daemon/.pid").is_file();
                        serde_json::json!({"daemons": if started { vec![serde_json::json!({"daemon_node_id": cfg["node_id"], "online": true, "can_create_nodes": true})] } else { vec![] }})
                    }.to_string();
                    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    let _ = stream.write_all(response.as_bytes());
                }
            });
            Self { root, session: local_daemon::LocalHubSession { endpoint, token: "fixture-token".into(), network_id: Some("fixture-network".into()) }, server_done, server: Some(server), saved }
        }
        fn profile(&self) -> PathBuf { self.root.path().join("local-daemon/.anet/nodes/local-daemon/config.json") }
        fn seed(&self) {
            let prefix = self.root.path().join("local-daemon/anet");
            for (name, version) in [("agent-network", "2.3.0-preview.76"), ("agent-node", "2.5.0-preview.58")] {
                let pkg = prefix.join(format!("lib/node_modules/@sleep2agi/{name}"));
                fs::create_dir_all(pkg.join("dist")).unwrap();
                fs::write(pkg.join("package.json"), serde_json::json!({"version": version}).to_string()).unwrap();
                fs::write(pkg.join("dist/cli.js"), "fixture").unwrap();
            }
            fs::create_dir_all(prefix.join("bin")).unwrap();
            executable(&prefix.join("bin/anet"), include_str!("anet.py"));
            fs::create_dir_all(self.profile().parent().unwrap()).unwrap();
            fs::write(self.profile(), "{\"node_id\":\"old-daemon\",\"token\":\"old-token\"}").unwrap();
        }
        fn old_process(&self) -> i32 {
            let mut child = Command::new("sleep").arg("120").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
            let pid = child.id() as i32;
            fs::write(self.profile().with_file_name(".pid"), pid.to_string()).unwrap();
            thread::spawn(move || { let _ = child.wait(); });
            pid
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Only fixture-owned processes, isolated in the container, are signalled.
            if let Ok(raw) = fs::read_to_string(self.profile().with_file_name(".pid")) {
                if let Ok(pid) = raw.trim().parse::<i32>() { unsafe { libc::kill(pid, libc::SIGTERM); } }
            }
            self.server_done.store(true, Ordering::SeqCst);
            if let Some(server) = self.server.take() { server.join().unwrap(); }
            for (key, value) in &self.saved {
                match value { Some(value) => std::env::set_var(key, value), None => std::env::remove_var(key) }
            }
        }
    }
    fn executable(path: &Path, content: &str) {
        fs::write(path, content).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn initialization_upgrades_old_packages_and_stops_before_overwriting_config() {
        let f = Fixture::new("0.9.0-preview.128");
        f.seed();
        let old_pid = f.old_process();
        let scan = local_daemon::scan(Some(&f.session)).unwrap();
        let value = serde_json::to_value(scan).unwrap();
        assert_eq!(value["anetCompatible"], false);
        assert_eq!(value["agentNodeCompatible"], false);
        let report = local_daemon::install(&f.session).unwrap();
        assert!(report.ok, "{:?}", report.error);
        assert_ne!(unsafe { libc::kill(old_pid, 0) }, 0);
        let cfg: serde_json::Value = serde_json::from_slice(&fs::read(f.profile()).unwrap()).unwrap();
        assert!(cfg["daemonExtraPath"].as_array().unwrap().iter().any(|v| v.as_str().unwrap().ends_with("/tools")));
        let events = fs::read_to_string(f.root.path().join("events")).unwrap();
        assert!(events.starts_with("stop old-daemon\n"), "{events}");
        assert!(events.contains("agent-network@2.3.0-preview.172") && events.contains("agent-node@2.5.0-preview.138"), "{events}");
        assert!(!events.contains("@latest"));
        let start_env = fs::read_to_string(f.root.path().join("start-env")).unwrap();
        assert!(start_env.ends_with("agent-node/dist/cli.js"), "{start_env}");
        let first_pid = fs::read_to_string(f.profile().with_file_name(".pid")).unwrap();
        let second = local_daemon::install(&f.session).unwrap();
        assert!(second.ok, "{:?}", second.error);
        assert_eq!(second.node_id, report.node_id);
        assert_ne!(fs::read_to_string(f.profile().with_file_name(".pid")).unwrap(), first_pid);
        let events = fs::read_to_string(f.root.path().join("events")).unwrap();
        assert_eq!(events.matches("npm ").count(), 2, "compatible packages must be reused: {events}");
        println!("PASS: upgrade old latest packages, stop before init, persist tool PATH, pin actual daemon runtime");
        println!("PASS: repeated repair reuses compatible packages and retains the daemon identity");
    }

    #[test]
    fn stop_failure_or_a_still_live_process_keeps_original_configuration() {
        for mode in ["fail", "lie"] {
            let f = Fixture::new("0.9.0-preview.128");
            f.seed();
            f.old_process();
            fs::write(f.root.path().join("stop-mode"), mode).unwrap();
            let before = fs::read(f.profile()).unwrap();
            let report = local_daemon::install(&f.session).unwrap();
            assert!(!report.ok);
            assert_eq!(fs::read(f.profile()).unwrap(), before);
            let events = fs::read_to_string(f.root.path().join("events")).unwrap();
            assert_eq!(events, "stop old-daemon\n");
            println!("PASS: {mode} stop aborts without npm/init/start or credential replacement");
        }
    }

    #[test]
    fn incompatible_hub_fails_before_mutating_installation() {
        let f = Fixture::new("0.9.0-preview.66");
        f.seed();
        let before = fs::read(f.profile()).unwrap();
        let report = local_daemon::install(&f.session).unwrap();
        assert!(!report.ok && report.error.unwrap().contains("incompatible"));
        assert_eq!(fs::read(f.profile()).unwrap(), before);
        assert!(!f.root.path().join("events").exists());
        println!("PASS: incompatible Hub rejected before mutation");
    }

    #[test]
    fn successful_npm_exit_with_old_package_is_rejected() {
        let f = Fixture::new("0.9.0-preview.128");
        f.seed();
        fs::write(f.root.path().join("npm-mode"), "old-version").unwrap();
        let before = fs::read(f.profile()).unwrap();
        let report = local_daemon::install(&f.session).unwrap();
        assert!(!report.ok && report.error.unwrap().contains("CLI 版本不兼容"));
        assert_eq!(fs::read(f.profile()).unwrap(), before);
        assert!(!fs::read_to_string(f.root.path().join("events")).unwrap().contains("init"));
        println!("PASS: npm exit zero is insufficient; installed version must satisfy contract");
    }

    #[test]
    fn registry_etarget_uses_the_verified_main_archive_and_keeps_pairing() {
        let f = Fixture::new("0.9.0-preview.128");
        f.seed();
        fs::write(f.root.path().join("npm-mode"), "unavailable").unwrap();
        let report = local_daemon::install(&f.session).unwrap();
        assert!(report.ok, "{:?}", report.error);
        let events = fs::read_to_string(f.root.path().join("events")).unwrap();
        assert!(events.contains("anet-cli-2.3.0-preview.172.tgz"), "{events}");
        assert!(events.contains("agent-node@2.5.0-preview.138"), "{events}");
        assert_eq!(events.matches("agent-network@2.3.0-preview.172").count(), 1);
        assert!(!f.root.path().join("local-daemon/anet-cli-2.3.0-preview.172.tgz").exists());
        assert!(report.steps.iter().any(|s| s.output.contains("CLI SHA256 已校验")));
        println!("PASS: actual public main tarball download/hash -> npm archive path -> paired runtime -> init/start; npm/Hub are fixture adapters");
    }

    #[test]
    fn wrong_archive_hash_is_never_installed_or_used_to_initialize() {
        let f = Fixture::new("0.9.0-preview.128");
        f.seed();
        fs::write(f.root.path().join("npm-mode"), "unavailable").unwrap();
        let before = fs::read(f.profile()).unwrap();
        let report = local_daemon::install_with_cli_download(&f.session, || Ok(b"corrupted archive".to_vec())).unwrap();
        assert!(!report.ok);
        assert!(report.steps.iter().any(|s| s.output.contains("SHA256 校验失败")));
        assert_eq!(fs::read(f.profile()).unwrap(), before);
        let events = fs::read_to_string(f.root.path().join("events")).unwrap();
        assert!(!events.contains(".tgz") && !events.contains("init"), "{events}");
        println!("PASS: wrong digest never reaches npm archive install/init/start");
    }
}
