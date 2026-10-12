//! 本机 daemon 一键扫描与安装(Vincent 2026-09-06:「本地的也可以自动启动 local 的 daemon 吧」
//! →「不要自己启动的吧,有个一键扫描和安装按钮」)。
//!
//! 「选服务器」空状态里那句「先在那台机器上跑 anet daemon up」在 Local workspace 场景下说的
//! 就是这台机器。这里把它做成按钮:扫描本机有没有 Node / npm / anet CLI / 已注册的 daemon,
//! 缺 anet 就 `npm install -g`,然后用本地 Hub 的凭据执行 `anet daemon init` + `anet daemon start`,
//! 最后向 Hub 确认 host_supervisor 在线且可以创建节点。**不自己偷偷起**:每一步都由用户点按钮触发。
//!
//! 凭据隔离:`anet daemon init` 从 `$HOME/.anet/config.json` 读 hub/token/network_id 并往
//! `$cwd/.anet/nodes/<name>/config.json` 写 daemon 配置。用户自己的 `~/.anet/config.json`
//! 可能指向别的 Hub,所以 init 这一步用一个私有 HOME(`~/.anet/app/local-daemon/home`),
//! 写好的 daemon 配置里已经带了 hub/token/network_id;`daemon start` 用用户真实 HOME 跑,
//! 它派生出来的节点才看得到用户的 claude/codex 等工具。
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{app_root, ensure_private_dir, write_private_atomic};

pub const LOCAL_DAEMON_NAME: &str = "local-daemon";
const ANET_PACKAGE: &str = "@sleep2agi/agent-network@2.3.0-preview.172";
// Same bytes as the formal main release, independent of npm processing delays.
const ANET_TARBALL_URL: &str = "https://github.com/sleep2agi/agent-network/releases/download/cli-v2.3.0-preview.172/sleep2agi-agent-network-2.3.0-preview.172.tgz";
const ANET_TARBALL_SHA256: &str = "6f19a3b63ce70d5157cf2ea1f5b036662a4f47920f857e5eecb7f755d3ec759a";
/// Desktop features require the preview runtime, not npm's older `latest` tag.
const AGENT_NODE_PACKAGE: &str = "@sleep2agi/agent-node@2.5.0-preview.138";
const MIN_HUB_VERSION: &str = "0.9.0-preview.128";
static INSTALL_LOCK: Mutex<()> = Mutex::new(());
const NPM_MIRROR: &str = "https://registry.npmmirror.com";
/// 私有 Node 运行时:缺 Node 或版本太低时从 nodejs.org 下 v22 最新 LTS 到 ~/.anet/app/local-daemon/node,
/// 不动系统、不动 nvm、不要 sudo(Vincent 2026-09-06「node 也自动安装一下?」)。
const NODE_DIST_LATEST_V22: &str = "https://nodejs.org/dist/latest-v22.x";
const NODE_DIST_MIRROR_V22: &str = "https://npmmirror.com/mirrors/node/latest-v22.x";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub path: String,
    pub version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonScan {
    pub supported: bool,
    pub reason: Option<String>,
    pub shell: String,
    pub node: Option<ToolInfo>,
    pub npm: Option<ToolInfo>,
    pub anet: Option<ToolInfo>,
    pub anet_compatible: bool,
    pub agent_node_compatible: bool,
    /// ~/.anet/app/local-daemon/node 里已经下好的私有 Node(有则优先用它)。
    pub private_node: Option<ToolInfo>,
    /// 私有 prefix 里与 anet 同目录的 agent-node(daemon 真正用的运行时外壳)。
    pub agent_node: Option<ToolInfo>,
    /// 登录 shell PATH 上另有的 agent-node(Vincent 2026-09-07:nvm v20 里的旧版被 daemon 用上了)。
    pub agent_node_on_path: Option<String>,
    pub daemon_dir: String,
    pub daemon_name: String,
    pub profile_exists: bool,
    pub node_id: Option<String>,
    pub hub_endpoint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepReport {
    pub name: String,
    pub ok: bool,
    pub output: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonInstallReport {
    pub ok: bool,
    pub node_id: Option<String>,
    pub steps: Vec<StepReport>,
    pub error: Option<String>,
}

/// 本地 Hub 的会话(endpoint / utok / network_id),由 local_hub 提供。
pub struct LocalHubSession {
    pub endpoint: String,
    pub token: String,
    pub network_id: Option<String>,
}

fn daemon_root() -> Result<PathBuf, String> {
    Ok(app_root()?.join("local-daemon"))
}

fn isolated_home() -> Result<PathBuf, String> {
    Ok(daemon_root()?.join("home"))
}

fn daemon_profile_path(name: &str) -> Result<PathBuf, String> {
    Ok(daemon_root()?.join(".anet").join("nodes").join(name).join("config.json"))
}

/// GUI 进程拿不到用户 shell 的 PATH(nvm / homebrew / npm prefix 都在 rc 文件里),
/// 所以一律经登录 shell 跑命令。
fn login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.trim().is_empty() && Path::new(shell).is_file())
        .unwrap_or_else(|| if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/sh".into() })
}

struct CommandOutcome {
    code: Option<i32>,
    output: String,
    timed_out: bool,
}

/// 经登录 shell 跑一条命令,stdout/stderr 合并,带超时(超时后 kill 这条 shell;
/// 它 detached 派生出去的子进程不受影响)。
///
/// 🔴 读输出的线程**不能无条件 join**:`anet daemon start` 派生出去的 daemon 会继承这条管道的
/// 写端,shell 退出后管道也不会 EOF —— 0.2.50 首轮发版闸的 macOS job 就是这样挂在
/// `reader.join()` 上 27 分钟以上。现在:输出攒在共享缓冲里,shell 退出后最多再等 2 秒收尾,
/// 然后带着已经读到的内容返回;读线程自己会在管道最终关闭时结束。
fn run_shell(
    command: &str,
    cwd: Option<&Path>,
    env: &[(&str, String)],
    timeout: Duration,
) -> Result<CommandOutcome, String> {
    let shell = login_shell();
    let mut cmd = Command::new(&shell);
    // -l -i:登录 + 交互。nvm / homebrew 的 PATH 多半写在 .zshrc / .bashrc(交互 rc)里,只 -l 读不到
    // (Vincent 2026-09-06:终端里 node v20.12 在,app 扫描四行全 ✗)。TERM=dumb + stdin 关掉,
    // rc 里的提示符/补全不会挂住;输出里可能夹着 "Now using node …" 之类噪音,parse_tool_probe 会跳过。
    cmd.args(["-l", "-i", "-c", &format!("{command} 2>&1")])
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    for (key, value) in env {
        cmd.env(key, value);
    }
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("cannot start {shell}: {error}"))?;
    let mut stdout = child.stdout.take().ok_or_else(|| "no stdout pipe".to_string())?;
    let buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let done = Arc::new(AtomicBool::new(false));
    {
        let buffer = Arc::clone(&buffer);
        let done = Arc::clone(&done);
        thread::spawn(move || {
            let mut chunk = [0u8; 4096];
            loop {
                match stdout.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Ok(mut guard) = buffer.lock() {
                            guard.extend_from_slice(&chunk[..n]);
                        }
                    }
                }
            }
            done.store(true, Ordering::SeqCst);
        });
    }
    let started = Instant::now();
    let code = loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => break Some(status.code().unwrap_or(-1)),
            None if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            None => thread::sleep(Duration::from_millis(100)),
        }
    };
    let settle = Instant::now();
    while !done.load(Ordering::SeqCst) && settle.elapsed() < Duration::from_secs(2) {
        thread::sleep(Duration::from_millis(50));
    }
    let output = buffer
        .lock()
        .map(|guard| String::from_utf8_lossy(&guard).into_owned())
        .unwrap_or_default();
    Ok(CommandOutcome {
        code,
        output,
        timed_out: code.is_none(),
    })
}

/// 去掉终端控制序列(交互 shell 的 rc 可能往 stdout 吐颜色/光标码)。
pub fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&n) = chars.peek() {
                    chars.next();
                    if ('@'..='~').contains(&n) { break; }
                }
            }
            continue;
        }
        if c != '\r' { out.push(c); }
    }
    out
}

/// `command -v X` + `X --version` 的输出:路径行以 `/` 开头;版本取路径之后第一行像版本号的
/// (`v22.1.0` / `10.5.0` / `2.3.0-preview.76`)。其它行(nvm 的 "Now using node …" 等)一律跳过。
pub fn parse_tool_probe(output: &str) -> Option<ToolInfo> {
    let clean = strip_ansi(output);
    let mut lines = clean.lines().map(str::trim).filter(|line| !line.is_empty());
    let path = lines.find(|line| line.starts_with('/') && !line.contains(char::is_whitespace))?;
    let version = lines
        .map(|line| line.trim_start_matches('v'))
        .find(|line| line.len() < 40 && line.chars().next().is_some_and(|c| c.is_ascii_digit()) && line.contains('.'))
        .map(str::to_string);
    Some(ToolInfo { path: path.to_string(), version })
}

fn probe_tool(tool: &str, version_flag: &str) -> Option<ToolInfo> {
    let command = format!("command -v {tool} && {tool} {version_flag} 2>/dev/null | head -1");
    let outcome = run_shell(&command, None, &[], Duration::from_secs(20)).ok()?;
    if outcome.code != Some(0) {
        return None;
    }
    parse_tool_probe(&outcome.output)
}

/// `anet daemon init` 的输出里有一行 `node_id:    node_daemon_xxxx`。
pub fn parse_daemon_node_id(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            let rest = trimmed.strip_prefix("node_id:")?;
            let id = rest.trim();
            (!id.is_empty() && !id.contains(char::is_whitespace)).then(|| id.to_string())
        })
}

fn node_id_from_profile(name: &str) -> Option<String> {
    let raw = fs::read_to_string(daemon_profile_path(name).ok()?).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json.get("node_id")?.as_str().map(str::to_string)
}

/// npm 报错里像注册表/网络问题的信号(与 docs-site/public/install.sh 同一份清单)。
pub fn looks_like_registry_failure(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    [
        "etimedout",
        "enotfound",
        "econnreset",
        "econnrefused",
        "eai_again",
        "network",
        "registry",
        "fetch failed",
        "socket hang up",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn cli_package_unavailable(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    looks_like_registry_failure(text)
        || ["etarget", "e404", "no matching version"].iter().any(|s| lower.contains(s))
}

fn verify_cli_tarball(bytes: &[u8], expected: &str) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > 16 * 1024 * 1024 {
        return Err("CLI 下载大小不符合预期".into());
    }
    if format!("{:x}", Sha256::digest(bytes)) != expected {
        return Err("CLI SHA256 校验失败，未安装下载包".into());
    }
    Ok(())
}

fn fetch_verified_cli_tarball() -> Result<Vec<u8>, String> {
    let response = reqwest::blocking::Client::new().get(ANET_TARBALL_URL)
        .timeout(Duration::from_secs(60)).send()
        .and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    response.take(16 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    verify_cli_tarball(&bytes, ANET_TARBALL_SHA256)?;
    Ok(bytes)
}

fn private_node_dir() -> Result<PathBuf, String> {
    Ok(daemon_root()?.join("node"))
}

fn private_anet_prefix() -> Result<PathBuf, String> {
    Ok(daemon_root()?.join("anet"))
}

fn private_agent_node_package() -> Result<PathBuf, String> {
    Ok(private_anet_prefix()?.join("lib").join("node_modules").join("@sleep2agi").join("agent-node"))
}

fn probe_private_agent_node() -> Option<ToolInfo> {
    let pkg = private_agent_node_package().ok()?.join("package.json");
    if !pkg.parent()?.join("dist/cli.js").is_file() { return None; }
    let raw = fs::read_to_string(&pkg).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let version = json.get("version")?.as_str()?.to_string();
    Some(ToolInfo { path: pkg.parent()?.display().to_string(), version: Some(version) })
}

fn probe_private_anet() -> Option<ToolInfo> {
    let prefix = private_anet_prefix().ok()?;
    let bin = prefix.join("bin").join("anet");
    if !bin.is_file() { return None; }
    let raw = fs::read_to_string(prefix.join("lib/node_modules/@sleep2agi/agent-network/package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    Some(ToolInfo { path: bin.display().to_string(), version: Some(json.get("version")?.as_str()?.to_string()) })
}

fn version_key(version: &str) -> Option<(u32, u32, u32, u32)> {
    let version = version.trim().trim_start_matches('v').split('+').next()?;
    let (core, prerelease) = version.split_once('-').map_or((version, None), |(core, pre)| (core, Some(pre)));
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() { return None; }
    let preview = match prerelease {
        None => u32::MAX,
        Some(pre) => pre.strip_prefix("preview.")?.parse().ok()?,
    };
    Some((major, minor, patch, preview))
}

fn package_compatible(info: Option<&ToolInfo>, package: &str) -> bool {
    let required = package.rsplit('@').next().and_then(version_key);
    let actual = info.and_then(|info| info.version.as_deref()).and_then(version_key);
    matches!((actual, required), (Some(actual), Some(required)) if actual >= required)
}

fn configured_daemon_pid() -> Result<Option<i32>, String> {
    let path = daemon_profile_path(LOCAL_DAEMON_NAME)?.with_file_name(".pid");
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("cannot read daemon PID: {error}")),
    };
    let pid = raw.trim().parse::<i32>().ok().filter(|pid| *pid > 1)
        .ok_or_else(|| "invalid local-daemon PID; refusing to overwrite its configuration".to_string())?;
    Ok(Some(pid))
}

fn pid_alive(pid: i32) -> Result<bool, String> {
    #[cfg(unix)]
    {
        if unsafe { libc::kill(pid, 0) } == 0 { return Ok(true); }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) { return Ok(false); }
        return Err(format!("cannot verify daemon PID {pid}: {error}"));
    }
    #[cfg(not(unix))]
    Err("local daemon requires POSIX process checks".into())
}

fn stop_existing_daemon(anet: &Path, daemon_dir: &Path, path_prefix: &str) -> Result<String, String> {
    let Some(pid) = configured_daemon_pid()? else { return Ok("No previous daemon PID".into()); };
    if !pid_alive(pid)? { return Ok(format!("Previous daemon PID {pid} has exited")); }
    if !anet.is_file() || !daemon_profile_path(LOCAL_DAEMON_NAME)?.is_file() {
        return Err("existing daemon is running but its launcher/configuration is missing".into());
    }
    let command = format!("export PATH={}:\"$PATH\"; {} node stop {}", shell_quote(path_prefix), shell_quote(&anet.display().to_string()), LOCAL_DAEMON_NAME);
    let stop = run_shell(&command, Some(daemon_dir), &[], Duration::from_secs(30))?;
    if stop.code != Some(0) || stop.timed_out {
        return Err(format!("cannot stop previous daemon; configuration retained: {}", tail(&stop.output, 400)));
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while pid_alive(pid)? {
        if Instant::now() >= deadline {
            return Err(format!("previous daemon PID {pid} is still alive; configuration retained"));
        }
        thread::sleep(Duration::from_millis(100));
    }
    Ok(format!("Previous daemon PID {pid} exited"))
}

fn require_compatible_hub(session: &LocalHubSession) -> Result<(), String> {
    let body: serde_json::Value = reqwest::blocking::Client::new()
        .get(format!("{}/health", session.endpoint))
        .timeout(Duration::from_secs(10)).send().map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?.json().map_err(|e| e.to_string())?;
    let actual = body["version"].as_str().and_then(version_key);
    if !matches!((actual, version_key(MIN_HUB_VERSION)), (Some(actual), Some(required)) if actual >= required) {
        return Err(format!("local Hub {} is incompatible; desktop requires Hub >= {MIN_HUB_VERSION}", body["version"].as_str().unwrap_or("unknown")));
    }
    Ok(())
}

fn probe_private_node() -> Option<ToolInfo> {
    let node = private_node_dir().ok()?.join("bin").join("node");
    if !node.is_file() { return None; }
    let output = Command::new(&node).arg("-v").output().ok()?;
    if !output.status.success() { return None; }
    let version = String::from_utf8_lossy(&output.stdout).trim().trim_start_matches('v').to_string();
    Some(ToolInfo { path: node.display().to_string(), version: Some(version) })
}

/// nodejs.org 的 SHASUMS256.txt 里挑出本平台的 tar.gz:返回 (文件名, sha256)。
pub fn pick_node_tarball(shasums: &str, os: &str, arch: &str) -> Option<(String, String)> {
    let suffix = format!("-{os}-{arch}.tar.gz");
    shasums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let sha = parts.next()?;
        let name = parts.next()?;
        (name.starts_with("node-v") && name.ends_with(&suffix) && sha.len() == 64).then(|| (name.to_string(), sha.to_string()))
    })
}

pub fn node_platform() -> Option<(&'static str, &'static str)> {
    let os = match std::env::consts::OS { "macos" => "darwin", "linux" => "linux", _ => return None };
    let arch = match std::env::consts::ARCH { "aarch64" => "arm64", "x86_64" => "x64", _ => return None };
    Some((os, arch))
}

fn fetch_text(url: &str) -> Result<String, String> {
    reqwest::blocking::Client::new()
        .get(url)
        .timeout(Duration::from_secs(60))
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .map_err(|error| error.to_string())
}

fn fetch_bytes(url: &str) -> Result<Vec<u8>, String> {
    reqwest::blocking::Client::new()
        .get(url)
        .timeout(Duration::from_secs(600))
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .bytes()
        .map(|b| b.to_vec())
        .map_err(|error| error.to_string())
}

/// 下载并校验私有 Node v22(nodejs.org,失败退 npmmirror 镜像),解压到 ~/.anet/app/local-daemon/node。
fn install_private_node(log: &mut String) -> Result<ToolInfo, String> {
    let (os, arch) = node_platform().ok_or_else(|| format!("不支持的平台 {}/{}", std::env::consts::OS, std::env::consts::ARCH))?;
    let mut last_error = String::new();
    for base in [NODE_DIST_LATEST_V22, NODE_DIST_MIRROR_V22] {
        let attempt = (|| -> Result<ToolInfo, String> {
            let shasums = fetch_text(&format!("{base}/SHASUMS256.txt"))?;
            let (name, expected) = pick_node_tarball(&shasums, os, arch)
                .ok_or_else(|| format!("SHASUMS256.txt 里没有 {os}-{arch} 的 tar.gz"))?;
            log.push_str(&format!("下载 {base}/{name}\n"));
            let bytes = fetch_bytes(&format!("{base}/{name}"))?;
            let actual = format!("{:x}", Sha256::digest(&bytes));
            if actual != expected {
                return Err(format!("{name} SHA256 不符:期望 {expected},实际 {actual}"));
            }
            log.push_str(&format!("SHA256 校验通过({} 字节)\n", bytes.len()));
            let root = daemon_root()?;
            ensure_private_dir(&root)?;
            let tmp = root.join("node-download.tar.gz");
            fs::write(&tmp, &bytes).map_err(|error| error.to_string())?;
            let extracted = root.join(name.trim_end_matches(".tar.gz"));
            let _ = fs::remove_dir_all(&extracted);
            let status = Command::new("tar").args(["-xzf"]).arg(&tmp).arg("-C").arg(&root).status().map_err(|error| error.to_string())?;
            let _ = fs::remove_file(&tmp);
            if !status.success() {
                return Err(format!("tar 解压失败:{status}"));
            }
            let target = private_node_dir()?;
            let _ = fs::remove_dir_all(&target);
            fs::rename(&extracted, &target).map_err(|error| format!("放置私有 Node 失败:{error}"))?;
            probe_private_node().ok_or_else(|| "解压后的 node 无法执行".to_string())
        })();
        match attempt {
            Ok(info) => return Ok(info),
            Err(error) => { log.push_str(&format!("{base}: {error}\n")); last_error = error; }
        }
    }
    Err(format!("私有 Node 下载失败:{last_error}"))
}

pub fn scan(session: Option<&LocalHubSession>) -> Result<DaemonScan, String> {
    let daemon_dir = daemon_root()?;
    let supported = cfg!(unix);
    let reason = if supported {
        None
    } else {
        Some("anet 的 host_supervisor daemon 目前只支持 macOS / Linux(Windows 请用 WSL)".to_string())
    };
    let (node, npm, anet) = if supported {
        (
            probe_tool("node", "-v"),
            probe_tool("npm", "-v"),
            probe_tool("anet", "--version"),
        )
    } else {
        (None, None, None)
    };
    let profile_exists = daemon_profile_path(LOCAL_DAEMON_NAME)?.is_file();
    let private_node = if supported { probe_private_node() } else { None };
    let agent_node = if supported { probe_private_agent_node() } else { None };
    let private_anet = if supported { probe_private_anet() } else { None };
    let anet_compatible = package_compatible(private_anet.as_ref(), ANET_PACKAGE);
    let agent_node_compatible = package_compatible(agent_node.as_ref(), AGENT_NODE_PACKAGE);
    let anet = private_anet.or(anet);
    let agent_node_on_path = if supported {
        run_shell("command -v agent-node", None, &[], Duration::from_secs(20)).ok()
            .filter(|o| o.code == Some(0))
            .and_then(|o| strip_ansi(&o.output).lines().map(str::trim).find(|l| l.starts_with('/')).map(str::to_string))
    } else { None };
    Ok(DaemonScan {
        supported,
        reason,
        shell: login_shell(),
        node,
        npm,
        anet,
        anet_compatible,
        agent_node_compatible,
        private_node,
        agent_node,
        agent_node_on_path,
        daemon_dir: daemon_dir.display().to_string(),
        daemon_name: LOCAL_DAEMON_NAME.into(),
        profile_exists,
        node_id: if profile_exists { node_id_from_profile(LOCAL_DAEMON_NAME) } else { None },
        hub_endpoint: session.map(|s| s.endpoint.clone()),
    })
}

fn tail(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let skip = trimmed.chars().count() - max_chars;
    format!("…{}", trimmed.chars().skip(skip).collect::<String>())
}

fn daemon_registered(session: &LocalHubSession, node_id: &str) -> Result<bool, String> {
    let mut url = format!("{}/api/host-supervisors", session.endpoint);
    if let Some(network) = &session.network_id {
        url.push_str(&format!("?network_id={network}"));
    }
    let body: serde_json::Value = reqwest::blocking::Client::new()
        .get(url)
        .bearer_auth(&session.token)
        .timeout(Duration::from_secs(10))
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json()
        .map_err(|error| error.to_string())?;
    supervisor_ready(&body, node_id)
}

fn supervisor_ready(body: &serde_json::Value, node_id: &str) -> Result<bool, String> {
    let Some(daemon) = body["daemons"].as_array()
        .and_then(|daemons| daemons.iter().find(|d| d["daemon_node_id"] == node_id)) else { return Ok(false); };
    if daemon["online"].as_bool() != Some(true) { return Ok(false); }
    match daemon["can_create_nodes"].as_bool() {
        Some(true) => Ok(true),
        Some(false) => Err(format!("daemon cannot create nodes: {}", daemon["create_nodes_blocked_reason"].as_str().unwrap_or("unknown"))),
        None => Err("daemon registered without reporting node-creation capability".into()),
    }
}

pub fn install(session: &LocalHubSession) -> Result<DaemonInstallReport, String> {
    install_with_cli_download(session, fetch_verified_cli_tarball)
}

pub(crate) fn install_with_cli_download(session: &LocalHubSession, download_cli: fn() -> Result<Vec<u8>, String>) -> Result<DaemonInstallReport, String> {
    let mut steps: Vec<StepReport> = Vec::new();
    let fail = |steps: Vec<StepReport>, error: String| {
        Ok(DaemonInstallReport {
            ok: false,
            node_id: None,
            steps,
            error: Some(error),
        })
    };
    let _install_guard = match INSTALL_LOCK.try_lock() {
        Ok(guard) => guard,
        Err(_) => return fail(steps, "本机 daemon 正在安装,请等待本次安装完成。".into()),
    };
    if !cfg!(unix) {
        return fail(steps, "anet 的 host_supervisor daemon 只支持 macOS / Linux".into());
    }
    if let Err(error) = require_compatible_hub(session) {
        return fail(steps, error);
    }
    let first = scan(Some(session))?;
    steps.push(StepReport {
        name: "扫描本机".into(),
        ok: true,
        output: format!(
            "shell: {}\nnode: {}\nnpm: {}\nanet: {}",
            first.shell,
            describe(&first.node),
            describe(&first.npm),
            describe(&first.anet)
        ),
    });
    let daemon_dir = daemon_root()?;
    ensure_private_dir(&daemon_dir)?;

    // 1. Node 运行时:系统的 ≥ 22.13 就用系统的;否则用/下私有 Node 22
    let node_bin_dir: PathBuf = match (&first.node, &first.private_node) {
        (Some(node), _) if node_version_ok(node.version.as_deref()) => {
            steps.push(StepReport { name: "Node.js".into(), ok: true, output: format!("用系统的 {} ({})", node.version.as_deref().unwrap_or("?"), node.path) });
            Path::new(&node.path).parent().map(Path::to_path_buf).unwrap_or_default()
        }
        (_, Some(private)) if node_version_ok(private.version.as_deref()) => {
            steps.push(StepReport { name: "Node.js".into(), ok: true, output: format!("用私有的 {} ({})", private.version.as_deref().unwrap_or("?"), private.path) });
            Path::new(&private.path).parent().map(Path::to_path_buf).unwrap_or_default()
        }
        _ => {
            let mut log = String::new();
            match install_private_node(&mut log) {
                Ok(private) => {
                    log.push_str(&format!("私有 Node {} 就绪:{}", private.version.as_deref().unwrap_or("?"), private.path));
                    steps.push(StepReport { name: "下载私有 Node 22(不动系统)".into(), ok: true, output: tail(&log, 1500) });
                    Path::new(&private.path).parent().map(Path::to_path_buf).unwrap_or_default()
                }
                Err(error) => {
                    steps.push(StepReport { name: "下载私有 Node 22(不动系统)".into(), ok: false, output: tail(&log, 1500) });
                    return fail(steps, format!("{error}。也可以自己装 Node.js ≥ 22.13(https://nodejs.org)后再点一次。"));
                }
            }
        }
    };
    let npm_bin = node_bin_dir.join("npm");
    if !npm_bin.is_file() {
        return fail(steps, format!("{} 里没有 npm", node_bin_dir.display()));
    }

    // 2. anet CLI:装进私有 prefix(不需要 sudo,不碰系统的全局 node_modules)
    let anet_prefix = private_anet_prefix()?;
    ensure_private_dir(&anet_prefix)?;
    let anet_bin = anet_prefix.join("bin").join("anet");
    let path_prefix = format!("{}:{}", node_bin_dir.display(), anet_prefix.join("bin").display());
    let with_path = |cmd: &str| format!("export PATH={}:\"$PATH\"; {cmd}", shell_quote(&path_prefix));
    // Stop before replacing packages or forcing init: the old process must
    // still have its original configuration and launcher available to stop.
    match stop_existing_daemon(&anet_bin, &daemon_dir, &path_prefix) {
        Ok(output) => steps.push(StepReport { name: "停止并确认旧 daemon 已退出".into(), ok: true, output }),
        Err(error) => return fail(steps, error),
    }
    if !package_compatible(probe_private_anet().as_ref(), ANET_PACKAGE) {
        let install_cmd = |registry: Option<&str>| with_path(&format!(
            "{} install -g --prefix {} {ANET_PACKAGE}{}",
            shell_quote(&npm_bin.display().to_string()),
            shell_quote(&anet_prefix.display().to_string()),
            registry.map(|r| format!(" --registry {r}")).unwrap_or_default()
        ));
        let primary = run_shell(&install_cmd(None), Some(&daemon_dir), &[], Duration::from_secs(600))?;
        let mut output = primary.output.clone();
        let mut ok = primary.code == Some(0);
        // A registry 404/ETARGET is not repaired by retrying an equally stale mirror.
        // Download the exact formal main tarball, check its pinned hash, then use
        // the same private prefix and the unchanged runtime pairing below.
        if !ok && !primary.timed_out && cli_package_unavailable(&primary.output) {
            output.push_str("\n--- exact CLI package via GitHub release ---\n");
            match download_cli().and_then(|bytes| {
                verify_cli_tarball(&bytes, ANET_TARBALL_SHA256)?;
                let file = daemon_dir.join("anet-cli-2.3.0-preview.172.tgz");
                write_private_atomic(&file, &bytes)?;
                let cmd = with_path(&format!("{} install -g --prefix {} {}",
                    shell_quote(&npm_bin.display().to_string()),
                    shell_quote(&anet_prefix.display().to_string()), shell_quote(&file.display().to_string())));
                let result = run_shell(&cmd, Some(&daemon_dir), &[], Duration::from_secs(600));
                let _ = fs::remove_file(&file);
                result
            }) {
                Ok(result) => {
                    output.push_str("CLI SHA256 已校验\n");
                    output.push_str(&result.output);
                    ok = result.code == Some(0);
                }
                Err(error) => output.push_str(&format!("独立下载未完成: {error}\n")),
            }
        }
        if !ok && !primary.timed_out && looks_like_registry_failure(&primary.output) {
            let mirror = run_shell(&install_cmd(Some(NPM_MIRROR)), Some(&daemon_dir), &[], Duration::from_secs(600))?;
            output.push_str("\n--- retry via npmmirror ---\n");
            output.push_str(&mirror.output);
            ok = mirror.code == Some(0);
        }
        steps.push(StepReport { name: format!("npm install -g --prefix {} @sleep2agi/agent-network", anet_prefix.display()), ok, output: tail(&output, 1500) });
        if !ok {
            return fail(steps, if primary.timed_out { "npm 安装超时(10 分钟)。".into() } else { "npm 安装失败,见上面的输出。".into() });
        }
        if !anet_bin.is_file() {
            return fail(steps, format!("npm 装完了但 {} 不存在", anet_bin.display()));
        }
    }
    let anet = match probe_private_anet().filter(|info| package_compatible(Some(info), ANET_PACKAGE)) {
        Some(info) => info,
        None => return fail(steps, format!("私有 anet CLI 版本不兼容,需要 {ANET_PACKAGE}")),
    };
    let probe = run_shell(&with_path(&format!("{} --version", shell_quote(&anet.path))), None, &[], Duration::from_secs(30))?;
    if probe.code != Some(0) {
        return fail(steps, format!("私有 anet CLI 无法执行: {}", tail(&probe.output, 400)));
    }
    steps.push(StepReport { name: "anet CLI 版本确认".into(), ok: true, output: describe(&Some(anet.clone())) });

    // 2b. agent-node 也装进同一个私有 prefix(anet 的 sibling,#1813 sibling-first)。
    //    Vincent 2026-09-07 的日志:私有 anet 起 daemon 时从 PATH 捡到了 nvm v20 里的旧 agent-node,
    //    以普通节点身份注册,快照没有 role → 永远进不了 host_supervisor 列表。
    let agent_node = match probe_private_agent_node().filter(|info| package_compatible(Some(info), AGENT_NODE_PACKAGE)) {
        Some(info) => {
            steps.push(StepReport { name: "agent-node(私有,与 anet 同目录)".into(), ok: true, output: format!("已安装 {} ({})", info.version.as_deref().unwrap_or("?"), info.path) });
            info
        }
        None => {
            let install_cmd = |registry: Option<&str>| with_path(&format!(
                "{} install -g --prefix {} {AGENT_NODE_PACKAGE}{}",
                shell_quote(&npm_bin.display().to_string()),
                shell_quote(&anet_prefix.display().to_string()),
                registry.map(|r| format!(" --registry {r}")).unwrap_or_default()
            ));
            let primary = run_shell(&install_cmd(None), Some(&daemon_dir), &[], Duration::from_secs(600))?;
            let mut output = primary.output.clone();
            let mut ok = primary.code == Some(0);
            if !ok && !primary.timed_out && looks_like_registry_failure(&primary.output) {
                let mirror = run_shell(&install_cmd(Some(NPM_MIRROR)), Some(&daemon_dir), &[], Duration::from_secs(600))?;
                output.push_str("\n--- retry via npmmirror ---\n");
                output.push_str(&mirror.output);
                ok = mirror.code == Some(0);
            }
            steps.push(StepReport { name: format!("npm install -g --prefix {} @sleep2agi/agent-node", anet_prefix.display()), ok, output: tail(&output, 1500) });
            if !ok {
                return fail(steps, if primary.timed_out { "agent-node 安装超时(10 分钟)。".into() } else { "agent-node 安装失败,见上面的输出。".into() });
            }
            match probe_private_agent_node().filter(|info| package_compatible(Some(info), AGENT_NODE_PACKAGE)) {
                Some(info) => info,
                None => return fail(steps, format!("私有 agent-node 版本不兼容,需要 {AGENT_NODE_PACKAGE}")),
            }
        }
    };

    // 2. 私有 HOME 里写 anet 全局配置(只给 daemon init 用)
    let home = isolated_home()?;
    let anet_dir = home.join(".anet");
    ensure_private_dir(&home)?;
    ensure_private_dir(&anet_dir)?;
    let config = serde_json::json!({
        "hub": session.endpoint,
        "token": session.token,
        "network_id": session.network_id,
    });
    write_private_atomic(&anet_dir.join("config.json"), serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?.as_slice())?;
    steps.push(StepReport { name: "写入本地 Hub 凭据(私有 HOME)".into(), ok: true, output: format!("{}  hub={}", anet_dir.join("config.json").display(), session.endpoint) });

    // 3. anet daemon init(HOME=私有)
    let init_env = [("HOME", home.display().to_string())];
    let init = run_shell(
        &with_path(&format!("{} daemon init {} --force", shell_quote(&anet.path), LOCAL_DAEMON_NAME)),
        Some(&daemon_dir),
        &init_env,
        Duration::from_secs(90),
    )?;
    let init_ok = init.code == Some(0);
    steps.push(StepReport { name: format!("anet daemon init {LOCAL_DAEMON_NAME}"), ok: init_ok, output: tail(&init.output, 1500) });
    if !init_ok {
        return fail(steps, if init.timed_out { "anet daemon init 超时".into() } else { "anet daemon init 失败,见上面的输出。".into() });
    }
    let node_id = parse_daemon_node_id(&init.output).or_else(|| node_id_from_profile(LOCAL_DAEMON_NAME));
    let Some(node_id) = node_id else {
        return fail(steps, "daemon 初始化成功但没拿到 node_id".into());
    };

    // Preserve the login shell's tool locations for minimalEnv child launches.
    let path_probe = run_shell(&with_path("printf 'ANET_DAEMON_PATH=%s\\n' \"$PATH\""), None, &[], Duration::from_secs(20))?;
    if path_probe.code != Some(0) { return fail(steps, "无法读取 daemon 的工具搜索路径。".into()); }
    let extra_path = path_probe.output.lines().rev().find_map(|line| line.strip_prefix("ANET_DAEMON_PATH="))
        .ok_or_else(|| "daemon PATH probe returned no path".to_string())?;
    let cfg_path = daemon_profile_path(LOCAL_DAEMON_NAME)?;
    let mut cfg: serde_json::Value = serde_json::from_slice(&fs::read(&cfg_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if !cfg.is_object() || cfg["node_id"].as_str() != Some(&node_id) {
        return fail(steps, "daemon 配置与初始化返回的 node_id 不一致,未启动。".into());
    }
    cfg["daemonExtraPath"] = serde_json::json!(extra_path.split(':').filter(|path| Path::new(path).is_absolute() && Path::new(path).is_dir()).collect::<Vec<_>>());
    write_private_atomic(&cfg_path, &serde_json::to_vec_pretty(&cfg).map_err(|e| e.to_string())?)?;

    // 4. anet daemon start —— 🔴 它是**前台**命令,不会自己返回(DEV 对 0.9.0-preview.45 实测:60s 后被
    //    timeout 打死,daemon 随之 shutting down)。0.2.52 之前这里等满 60s 才开始问 Hub,而且靠 kill shell
    //    让 daemon 侥幸活下来。现在:setsid + nohup 放到后台,输出进 start.log,立刻返回去轮询 Hub。
    let start_log = daemon_dir.join("start.log");
    let start = run_shell(
        &with_path(&detached_start_command(&anet.path, LOCAL_DAEMON_NAME, &start_log)),
        Some(&daemon_dir),
        &[("ANET_AGENT_NODE_BIN", Path::new(&agent_node.path).join("dist/cli.js").display().to_string())],
        Duration::from_secs(20),
    )?;
    steps.push(StepReport {
        name: format!("anet daemon start {LOCAL_DAEMON_NAME}(后台)"),
        ok: start.code == Some(0),
        output: format!("{}\n日志:{}", tail(&start.output, 600), start_log.display()),
    });
    if start.code != Some(0) {
        return fail(steps, "anet daemon start 没能放到后台,见上面的输出。".into());
    }

    // 5. 向 Hub 确认注册(最多 90s);没出现时说清是「会话都没上线」还是「上线了但没进 host_supervisors」
    let deadline = Instant::now() + Duration::from_secs(90);
    let mut registered = false;
    let mut last_error = String::new();
    while Instant::now() < deadline {
        match daemon_registered(session, &node_id) {
            Ok(true) => {
                if configured_daemon_pid()?.is_some_and(|pid| pid_alive(pid).unwrap_or(false)) {
                    registered = true;
                    break;
                }
                last_error = "Hub 上有记录,但本机 daemon 进程未存活".into();
            }
            Ok(false) => {}
            Err(error) => last_error = error,
        }
        thread::sleep(Duration::from_secs(2));
    }
    let diagnosis = if registered {
        format!("daemon_node_id={node_id}")
    } else {
        let session_state = session_online(session, LOCAL_DAEMON_NAME);
        let start_tail = fs::read_to_string(&start_log).map(|t| tail(&t, 800)).unwrap_or_default();
        format!(
            "90 秒内 daemon {node_id} 未达到在线且可创建节点的状态(network {})。会话 {LOCAL_DAEMON_NAME} 在 /api/status 里:{}。{}\n--- start.log ---\n{}",
            session.network_id.as_deref().unwrap_or("(none)"),
            session_state,
            if last_error.is_empty() { String::new() } else { format!("最后一次查询错误:{last_error}") },
            start_tail
        )
    };
    steps.push(StepReport {
        name: "Hub 确认 daemon 在线且可创建节点".into(),
        ok: registered,
        output: diagnosis,
    });
    Ok(DaemonInstallReport {
        ok: registered,
        node_id: Some(node_id),
        steps,
        error: if registered { None } else if !last_error.is_empty() { Some(last_error) } else { Some("daemon 未确认在线且可创建节点,见上面的状态和启动日志。".into()) },
    })
}

/// 只给打包 smoke 用:停掉刚起的 daemon(`anet node stop <name>`),失败不算错。
pub fn stop_for_smoke() -> Result<(), String> {
    let daemon_dir = daemon_root()?;
    let anet = private_anet_prefix()?.join("bin").join("anet");
    let node_bin = private_node_dir()?.join("bin");
    let cmd = format!("export PATH={}:{}:\"$PATH\"; {} node stop {LOCAL_DAEMON_NAME}", shell_quote(&node_bin.display().to_string()), shell_quote(&anet.parent().unwrap().display().to_string()), if anet.is_file() { shell_quote(&anet.display().to_string()) } else { "anet".into() });
    let _ = run_shell(&cmd, Some(&daemon_dir), &[], Duration::from_secs(30))?;
    Ok(())
}

/// 把 `anet daemon start <name>` 放到后台:有 setsid(Linux)就 setsid + nohup,没有(macOS)就 nohup;
/// 输出进日志文件,shell 立刻返回。
///
/// 🔴 0.2.53 首轮发版闸(macOS)红在这里:原来写成 `(command -v setsid && setsid nohup … &) || (nohup … &)`,
/// 而 `&` 作用于整个 `A && B` 列表 —— macOS 上 `command -v setsid` 失败后整个列表异步退出、子 shell 返回 0,
/// `||` 那半永远不跑,daemon 根本没起来(start.log 空)。所以先 if/else 选定,再 `&`。
pub fn detached_start_command(anet_path: &str, name: &str, log: &Path) -> String {
    let a = shell_quote(anet_path);
    let l = shell_quote(&log.display().to_string());
    format!(
        "if command -v setsid >/dev/null 2>&1; then setsid nohup {a} daemon start {name} >{l} 2>&1 </dev/null & else nohup {a} daemon start {name} >{l} 2>&1 </dev/null & fi; sleep 1; echo started"
    )
}

/// 诊断用:该 alias 在 Hub /api/status 里的状态(拿不到就说拿不到)。
fn session_online(session: &LocalHubSession, alias: &str) -> String {
    let body: Result<serde_json::Value, String> = reqwest::blocking::Client::new()
        .get(format!("{}/api/status", session.endpoint))
        .bearer_auth(&session.token)
        .timeout(Duration::from_secs(10))
        .send()
        .map_err(|e| e.to_string())
        .and_then(|r| r.json().map_err(|e| e.to_string()));
    match body {
        Ok(json) => json["sessions"]
            .as_array()
            .and_then(|list| list.iter().find(|s| s["alias"] == alias))
            .map(|s| format!("status={} version={}", s["status"].as_str().unwrap_or("?"), s["version"].as_str().unwrap_or("?")))
            .unwrap_or_else(|| "没有这个会话(daemon 没起来或没注册)".into()),
        Err(error) => format!("查不到(/api/status:{error})"),
    }
}

fn describe(tool: &Option<ToolInfo>) -> String {
    match tool {
        Some(info) => format!("{} ({})", info.version.as_deref().unwrap_or("?"), info.path),
        None => "缺".into(),
    }
}

pub fn node_version_ok(version: Option<&str>) -> bool {
    let Some(version) = version else { return false };
    let mut parts = version.trim_start_matches('v').split('.').map(|part| part.parse::<u32>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    major > 22 || (major == 22 && minor >= 13)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_requires_the_exact_online_create_capable_daemon() {
        let snapshot = |id: &str, online: bool, capability: Option<bool>| {
            serde_json::json!({"daemons": [{"daemon_node_id": id, "online": online, "can_create_nodes": capability, "create_nodes_blocked_reason": "runtime unavailable"}]})
        };
        assert!(!supervisor_ready(&snapshot("old-id", true, Some(true)), "new-id").unwrap());
        assert!(!supervisor_ready(&snapshot("new-id", false, Some(true)), "new-id").unwrap());
        assert!(supervisor_ready(&snapshot("new-id", true, Some(false)), "new-id").unwrap_err().contains("runtime unavailable"));
        assert!(supervisor_ready(&snapshot("new-id", true, None), "new-id").is_err());
        assert!(supervisor_ready(&snapshot("new-id", true, Some(true)), "new-id").unwrap());
    }

    #[test]
    fn duplicate_install_is_rejected_before_any_mutation() {
        let _guard = INSTALL_LOCK.lock().unwrap();
        let session = LocalHubSession { endpoint: "http://127.0.0.1:1".into(), token: String::new(), network_id: None };
        let report = install(&session).unwrap();
        assert!(!report.ok && report.steps.is_empty());
        assert!(report.error.unwrap().contains("正在安装"));
    }

    #[test]
    fn old_latest_packages_do_not_satisfy_desktop_contract() {
        let info = |version: &str| ToolInfo { path: "/fixture/package".into(), version: Some(version.into()) };
        assert!(!package_compatible(Some(&info("2.3.0-preview.76")), ANET_PACKAGE));
        assert!(!package_compatible(Some(&info("2.5.0-preview.58")), AGENT_NODE_PACKAGE));
        assert!(package_compatible(Some(&info("2.3.0-preview.172")), ANET_PACKAGE));
        assert!(!package_compatible(Some(&info("2.5.0-preview.135")), AGENT_NODE_PACKAGE));
        assert!(package_compatible(Some(&info("2.5.0-preview.138")), AGENT_NODE_PACKAGE));
        assert!(package_compatible(Some(&info("2.5.0")), AGENT_NODE_PACKAGE));
        assert!(!package_compatible(Some(&info("2.5.0-preview.12")), AGENT_NODE_PACKAGE));
        assert!(!package_compatible(Some(&info("2.5.0-preview.bad")), AGENT_NODE_PACKAGE));
        assert!(!package_compatible(None, AGENT_NODE_PACKAGE));
    }

    #[test]
    fn probe_skips_nvm_noise_and_ansi() {
        let noisy = "\u{1b}[32mNow using node v20.12.2 (npm v10.5.0)\u{1b}[0m\r\n/Users/v/.nvm/versions/node/v20.12.2/bin/node\r\nv20.12.2\r\n";
        let info = parse_tool_probe(noisy).unwrap();
        assert_eq!(info.path, "/Users/v/.nvm/versions/node/v20.12.2/bin/node");
        assert_eq!(info.version.as_deref(), Some("20.12.2"));
        assert_eq!(strip_ansi("a\u{1b}[1;31mb\u{1b}[0m"), "ab");
    }

    #[test]
    fn picks_platform_tarball_from_shasums() {
        let shasums = "61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6  node-v22.23.2-darwin-arm64.tar.gz\n58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026  node-v22.23.2-darwin-x64.tar.gz\n013b59cfd2819703a6f4a14ab891fc46fc2a4e3f5bcd92de3fb4929b43e35b30  node-v22.23.2-linux-arm64.tar.gz\nb294a556e639d64338823920e5866c21c02741742d2e1529ee1a225c1ec9252a  node-v22.23.2-linux-x64.tar.gz\nzzz  node-v22.23.2-darwin-arm64.tar.xz\n";
        assert_eq!(pick_node_tarball(shasums, "darwin", "arm64"), Some(("node-v22.23.2-darwin-arm64.tar.gz".into(), "61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6".into())));
        assert_eq!(pick_node_tarball(shasums, "linux", "x64").map(|t| t.0), Some("node-v22.23.2-linux-x64.tar.gz".into()));
        assert_eq!(pick_node_tarball(shasums, "win", "x64"), None);
        // Windows 没有 daemon(POSIX-only),node_platform 也按设计返回 None。
        assert_eq!(node_platform().is_some(), cfg!(unix));
    }

    #[test]
    fn parses_tool_probe_path_and_version() {
        let info = parse_tool_probe("/opt/homebrew/bin/node\nv22.14.0\n").unwrap();
        assert_eq!(info.path, "/opt/homebrew/bin/node");
        assert_eq!(info.version.as_deref(), Some("22.14.0"));
        let bare = parse_tool_probe("/usr/local/bin/anet\n").unwrap();
        assert_eq!(bare.version, None);
        assert!(parse_tool_probe("zsh: command not found: anet\n").is_none());
        assert!(parse_tool_probe("").is_none());
    }

    #[test]
    fn parses_daemon_node_id_from_init_output() {
        let output = "[anet daemon] ✓ created host_supervisor daemon \"local-daemon\"\n              config:     .anet/nodes/local-daemon/config.json\n              node_id:    node_daemon_0a1b2c3d4e5f\n";
        assert_eq!(parse_daemon_node_id(output).as_deref(), Some("node_daemon_0a1b2c3d4e5f"));
        assert_eq!(parse_daemon_node_id("nothing here"), None);
    }

    #[test]
    fn node_version_gate_matches_install_sh() {
        assert!(node_version_ok(Some("v22.13.0")));
        assert!(node_version_ok(Some("24.1.0")));
        assert!(!node_version_ok(Some("v22.12.9")));
        assert!(!node_version_ok(Some("v20.20.0")));
        assert!(!node_version_ok(None));
    }

    #[test]
    fn registry_failure_signals_match_install_sh() {
        assert!(looks_like_registry_failure("npm ERR! code ETIMEDOUT\nnpm ERR! network request to https://registry.npmjs.org failed"));
        assert!(!looks_like_registry_failure("npm ERR! code EACCES\nnpm ERR! syscall mkdir"));
    }

    /// 复现 0.2.50 首轮发版闸的挂死:shell 退出了,但它后台派生的进程还握着 stdout 管道。
    #[cfg(unix)]
    #[test]
    fn run_shell_returns_when_a_detached_grandchild_keeps_the_pipe_open() {
        let started = Instant::now();
        let outcome = run_shell("echo before; (sleep 20 &) ; echo after; exit 0", None, &[], Duration::from_secs(30)).unwrap();
        assert!(started.elapsed() < Duration::from_secs(10), "took {:?}", started.elapsed());
        assert_eq!(outcome.code, Some(0));
        assert!(!outcome.timed_out);
        assert!(outcome.output.contains("before") && outcome.output.contains("after"), "{}", outcome.output);
    }

    #[cfg(unix)]
    #[test]
    fn run_shell_times_out_and_reports_partial_output() {
        let outcome = run_shell("echo partial; sleep 30", None, &[], Duration::from_secs(1)).unwrap();
        assert!(outcome.timed_out && outcome.code.is_none());
        assert!(outcome.output.contains("partial"), "{}", outcome.output);
    }

    #[test]
    fn detached_start_command_backgrounds_and_logs() {
        let cmd = detached_start_command("/p/anet", "local-daemon", Path::new("/d/start.log"));
        assert!(cmd.starts_with("if command -v setsid >/dev/null 2>&1; then setsid nohup '/p/anet' daemon start local-daemon >'/d/start.log' 2>&1 </dev/null & else nohup '/p/anet' daemon start local-daemon >'/d/start.log' 2>&1 </dev/null & fi"), "{cmd}");
        assert!(cmd.trim_end().ends_with("echo started"));
    }

    /// 语义测试:真的跑这条命令。两种环境都要起来 —— 有 setsid(PATH 里有)与没有 setsid(macOS 的形状,
    /// 用一个只含假 anet 的 PATH 模拟)。0.2.53 首轮的 bug 在第二种下:daemon 从没被执行,日志为空。
    #[cfg(unix)]
    #[test]
    fn detached_start_command_actually_starts_the_daemon_with_and_without_setsid() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("anet");
        fs::write(&fake, "#!/bin/sh\necho \"fake-daemon $*\"; sleep 30\n").unwrap();
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
        // 「没有 setsid」的环境(macOS 的形状):PATH 只放一个目录,里面有 nohup/sleep/sh,没有 setsid。
        let no_setsid_bin = dir.path().join("bin");
        fs::create_dir_all(&no_setsid_bin).unwrap();
        for tool in ["nohup", "sleep", "sh"] {
            let found = ["/usr/bin", "/bin"].iter().map(|d| Path::new(d).join(tool)).find(|p| p.exists()).expect(tool);
            std::os::unix::fs::symlink(found, no_setsid_bin.join(tool)).unwrap();
        }
        for (label, path_env) in [("with-setsid", std::env::var("PATH").unwrap_or_default()), ("without-setsid", no_setsid_bin.display().to_string())] {
            let log = dir.path().join(format!("{label}.log"));
            let cmd = detached_start_command(&fake.display().to_string(), "local-daemon", &log);
            let status = Command::new("/bin/sh").arg("-c").arg(&cmd).env("PATH", &path_env).status().unwrap();
            assert!(status.success(), "{label}: shell must return 0");
            let mut content = String::new();
            for _ in 0..40 {
                content = fs::read_to_string(&log).unwrap_or_default();
                if content.contains("fake-daemon daemon start local-daemon") { break; }
                thread::sleep(Duration::from_millis(50));
            }
            assert!(content.contains("fake-daemon daemon start local-daemon"), "{label}: daemon never ran, log={content:?}");
        }
        let _ = Command::new("pkill").args(["-f", &fake.display().to_string()]).status();
    }

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("/a/b c"), "'/a/b c'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }
}
