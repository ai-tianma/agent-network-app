// Tauri 2 shell (Vincent tg 824: 用 Tauri，替换 Electron).
// The http plugin backs the JS-side fetch patch — WKWebView enforces
// CORS and the hub sets no CORS headers, so requests go through Rust.
const SESSION_SERVICE: &str = "top.vansin.agentnetwork.desktop";
const SESSION_ACCOUNT: &str = "active-hub-session";
mod chat_notify;
mod hub_http;
mod tray;
mod local_credentials;
mod local_daemon;
// Historical TEST-ONLY162/128 policy; current installer lives in local_daemon.
#[cfg(test)]
mod local_daemon_packages;
mod local_hub;

#[cfg(windows)]
use atomicwrites::{AllowOverwrite, AtomicFile};
use futures_util::StreamExt;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};
use tauri::{Emitter, Manager};

static NETWORK_EVENT_TASKS: LazyLock<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PROFILE_STORE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum NetworkEventPayload {
    State {
        stream_id: String,
        state: String,
        error: Option<String>,
    },
    Event {
        stream_id: String,
        event: serde_json::Value,
    },
}

fn emit_stream_state(
    app: &tauri::AppHandle,
    event_name: &str,
    stream_id: &str,
    state: &str,
    error: Option<String>,
) {
    let _ = app.emit(
        event_name,
        NetworkEventPayload::State {
            stream_id: stream_id.to_owned(),
            state: state.to_owned(),
            error,
        },
    );
}

fn emit_network_state(app: &tauri::AppHandle, stream_id: &str, state: &str, error: Option<String>) {
    emit_stream_state(app, "network-event-stream", stream_id, state, error);
}

#[tauri::command]
fn start_network_event_stream(
    app: tauri::AppHandle,
    stream_id: String,
    server_url: String,
    token: String,
    network_id: String,
) -> Result<(), String> {
    if stream_id.is_empty() || stream_id.len() > 160 || network_id.is_empty() {
        return Err("invalid stream identity".into());
    }
    let base = reqwest::Url::parse(&server_url).map_err(|_| "invalid server URL")?;
    if !matches!(base.scheme(), "http" | "https") {
        return Err("server URL must use http or https".into());
    }
    let url = base
        .join(&format!(
            "events/network/{}",
            network_id.replace('/', "%2F")
        ))
        .map_err(|_| "invalid network event URL")?;

    if let Some(old) = NETWORK_EVENT_TASKS
        .lock()
        .map_err(|_| "stream registry poisoned")?
        .remove(&stream_id)
    {
        old.abort();
    }

    let task_id = stream_id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        emit_network_state(&app, &task_id, "connecting", None);
        let response = match reqwest::Client::new()
            .get(url)
            .bearer_auth(token)
            .header("Accept", "text/event-stream")
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                emit_network_state(&app, &task_id, "disconnected", Some(error.to_string()));
                return;
            }
        };
        if !response.status().is_success() {
            emit_network_state(
                &app,
                &task_id,
                "disconnected",
                Some(format!("HTTP {}", response.status().as_u16())),
            );
            return;
        }
        emit_network_state(&app, &task_id, "connected", None);

        let mut bytes = response.bytes_stream();
        let mut carry = String::new();
        while let Some(chunk) = bytes.next().await {
            let chunk = match chunk {
                Ok(value) => value,
                Err(error) => {
                    emit_network_state(&app, &task_id, "disconnected", Some(error.to_string()));
                    return;
                }
            };
            carry.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(end) = carry.find("\n\n") {
                let frame = carry[..end].replace("\r\n", "\n");
                carry.drain(..end + 2);
                let data = frame
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
                    .collect::<Vec<_>>()
                    .join("\n");
                if data.is_empty() {
                    continue;
                }
                let event = serde_json::from_str(&data).unwrap_or_else(|_| {
                    serde_json::json!({
                        "type": "unknown", "_raw": data,
                    })
                });
                let _ = app.emit(
                    "network-event-stream",
                    NetworkEventPayload::Event {
                        stream_id: task_id.clone(),
                        event,
                    },
                );
            }
        }
        emit_network_state(
            &app,
            &task_id,
            "disconnected",
            Some("server closed stream".into()),
        );
    });
    NETWORK_EVENT_TASKS
        .lock()
        .map_err(|_| "stream registry poisoned")?
        .insert(stream_id, handle);
    Ok(())
}

#[tauri::command]
fn stop_network_event_stream(stream_id: String) -> Result<(), String> {
    if let Some(handle) = NETWORK_EVENT_TASKS
        .lock()
        .map_err(|_| "stream registry poisoned")?
        .remove(&stream_id)
    {
        handle.abort();
    }
    Ok(())
}

#[tauri::command]
fn start_user_event_stream(
    app: tauri::AppHandle,
    stream_id: String,
    server_url: String,
    token: String,
    network_id: String,
) -> Result<(), String> {
    if stream_id.is_empty() || stream_id.len() > 160 || network_id.is_empty() {
        return Err("invalid stream identity".into());
    }
    let base = reqwest::Url::parse(&server_url).map_err(|_| "invalid server URL")?;
    if !matches!(base.scheme(), "http" | "https") {
        return Err("server URL must use http or https".into());
    }
    let mut url = base
        .join("events/users/me")
        .map_err(|_| "invalid user event URL")?;
    url.query_pairs_mut().append_pair("network_id", &network_id);

    if let Some(old) = NETWORK_EVENT_TASKS
        .lock()
        .map_err(|_| "stream registry poisoned")?
        .remove(&stream_id)
    {
        old.abort();
    }

    let task_id = stream_id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        emit_stream_state(&app, "user-event-stream", &task_id, "connecting", None);
        let response = match reqwest::Client::new()
            .get(url)
            .bearer_auth(token)
            .header("Accept", "text/event-stream")
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                emit_stream_state(
                    &app,
                    "user-event-stream",
                    &task_id,
                    "disconnected",
                    Some(error.to_string()),
                );
                return;
            }
        };
        if !response.status().is_success() {
            emit_stream_state(
                &app,
                "user-event-stream",
                &task_id,
                "disconnected",
                Some(format!("HTTP {}", response.status().as_u16())),
            );
            return;
        }
        emit_stream_state(&app, "user-event-stream", &task_id, "connected", None);

        let mut bytes = response.bytes_stream();
        let mut carry = String::new();
        while let Some(chunk) = bytes.next().await {
            let chunk = match chunk {
                Ok(value) => value,
                Err(error) => {
                    emit_stream_state(
                        &app,
                        "user-event-stream",
                        &task_id,
                        "disconnected",
                        Some(error.to_string()),
                    );
                    return;
                }
            };
            carry.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(end) = carry.find("\n\n") {
                let frame = carry[..end].replace("\r\n", "\n");
                carry.drain(..end + 2);
                let data = frame
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
                    .collect::<Vec<_>>()
                    .join("\n");
                if data.is_empty() {
                    continue;
                }
                let event = serde_json::from_str(&data).unwrap_or_else(|_| {
                    serde_json::json!({
                        "type": "unknown", "_raw": data,
                    })
                });
                let _ = app.emit(
                    "user-event-stream",
                    NetworkEventPayload::Event {
                        stream_id: task_id.clone(),
                        event,
                    },
                );
            }
        }
        emit_stream_state(
            &app,
            "user-event-stream",
            &task_id,
            "disconnected",
            Some("server closed stream".into()),
        );
    });
    NETWORK_EVENT_TASKS
        .lock()
        .map_err(|_| "stream registry poisoned")?
        .insert(stream_id, handle);
    Ok(())
}

#[tauri::command]
fn stop_user_event_stream(stream_id: String) -> Result<(), String> {
    stop_network_event_stream(stream_id)
}

fn session_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SESSION_SERVICE, SESSION_ACCOUNT).map_err(|error| error.to_string())
}

// 语音输入(豆包 ASR)凭据:与登录 token 同一个 keyring service、独立 account。只在本机,
// 不进 profile 目录的明文文件、不上传 hub。JSON 形状由前端 voice-credentials-model.ts 规整;
// 这里只做大小上限,不解析、不打日志。
const VOICE_CREDENTIALS_ACCOUNT: &str = "voice-asr-v1";
const VOICE_CREDENTIALS_MAX_BYTES: usize = 8 * 1024;

fn voice_credentials_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SESSION_SERVICE, VOICE_CREDENTIALS_ACCOUNT).map_err(|error| error.to_string())
}

fn check_voice_credentials_size(json: &str) -> Result<(), String> {
    if json.is_empty() || json.len() > VOICE_CREDENTIALS_MAX_BYTES {
        return Err("voice credentials payload size out of range".into());
    }
    Ok(())
}

#[tauri::command]
fn save_voice_credentials(json: String) -> Result<(), String> {
    check_voice_credentials_size(&json)?;
    voice_credentials_entry()?
        .set_password(&json)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_voice_credentials() -> Result<Option<String>, String> {
    match voice_credentials_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn clear_voice_credentials() -> Result<(), String> {
    match voice_credentials_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[derive(Clone, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileMetadata {
    profile_id: String,
    server_url: String,
    username: String,
    network_id: Option<String>,
    display_name: Option<String>,
    #[serde(default)]
    requires_reauth: bool,
    created_at: u64,
    updated_at: u64,
}

#[derive(Default, serde::Deserialize, Serialize)]
struct ProfileIndex {
    schema_version: u32,
    active_profile_id: Option<String>,
    profiles: Vec<ProfileMetadata>,
}

#[derive(serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSessionInput {
    profile_id: Option<String>,
    server_url: String,
    token: String,
    network_id: Option<String>,
    username: Option<String>,
    display_name: Option<String>,
}

#[derive(serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSessionOutput {
    profile_id: String,
    server_url: String,
    token: String,
    network_id: Option<String>,
    username: String,
    display_name: Option<String>,
}

fn app_root() -> Result<PathBuf, String> {
    if std::env::var("ANET_PACKAGED_SMOKE").as_deref() == Ok("1") {
        if let Some(root) = std::env::var_os("ANET_PACKAGED_SMOKE_ROOT") {
            return Ok(PathBuf::from(root));
        }
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "home directory unavailable".to_string())?;
    Ok(PathBuf::from(home).join(".anet").join("app"))
}

fn profile_index_path() -> Result<PathBuf, String> {
    Ok(app_root()?.join("profiles").join("index.json"))
}

fn read_profile_index() -> Result<ProfileIndex, String> {
    let path = profile_index_path()?;
    read_profile_index_at(path)
}

fn read_profile_index_at(path: PathBuf) -> Result<ProfileIndex, String> {
    if !path.exists() {
        return Ok(ProfileIndex {
            schema_version: 1,
            ..Default::default()
        });
    }
    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    match serde_json::from_str(&raw) {
        Ok(index) => Ok(index),
        Err(_) => {
            // Never overwrite corrupt user state. Quarantine it beside the
            // registry, then recover to an empty versioned index so the app
            // can still open and the user can sign in again.
            let backup = path.with_file_name(format!(
                "index.corrupt-{}-{}.json",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|error| error.to_string())?
                    .as_secs(),
                uuid::Uuid::new_v4()
            ));
            fs::rename(&path, backup).map_err(|error| error.to_string())?;
            Ok(ProfileIndex {
                schema_version: 1,
                ..Default::default()
            })
        }
    }
}

#[derive(Serialize)]
struct StorageDiagnostics {
    root: String,
    schema_version: u32,
    profile_count: usize,
    active_profile_id: Option<String>,
    corrupt_backups: Vec<String>,
}

#[tauri::command]
fn desktop_storage_diagnostics() -> Result<String, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let root = app_root()?;
    let index = read_profile_index()?;
    let profiles_dir = root.join("profiles");
    let mut corrupt_backups = if profiles_dir.exists() {
        fs::read_dir(&profiles_dir)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.starts_with("index.corrupt-") && name.ends_with(".json"))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    corrupt_backups.sort();
    serde_json::to_string_pretty(&StorageDiagnostics {
        root: root.display().to_string(),
        schema_version: index.schema_version,
        profile_count: index.profiles.len(),
        active_profile_id: index.active_profile_id,
        corrupt_backups,
    })
    .map_err(|error| error.to_string())
}

fn write_private_atomic(path: &Path, value: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "invalid profile path".to_string())?;
    ensure_private_dir(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let tmp = parent.join(format!(".write-{}.tmp", uuid::Uuid::new_v4()));
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|error| error.to_string())?;
        file.write_all(value).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&tmp, path).map_err(|error| error.to_string())?;
    }
    #[cfg(windows)]
    {
        AtomicFile::new(path, AllowOverwrite)
            .write(|file| file.write_all(value))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn ensure_private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn save_profile_index(index: &ProfileIndex) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(index).map_err(|error| error.to_string())?;
    write_private_atomic(&profile_index_path()?, &bytes)?;
    write_private_atomic(
        &app_root()?.join("schema.json"),
        br#"{
  "schema_version": 1,
  "storage": "agent-network-app-profiles"
}
"#,
    )
}

fn profile_entry(profile_id: &str) -> Result<keyring::Entry, String> {
    if profile_id.is_empty()
        || profile_id.len() > 80
        || !profile_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("invalid profile id".into());
    }
    keyring::Entry::new(SESSION_SERVICE, &format!("hub-profile-{profile_id}"))
        .map_err(|error| error.to_string())
}

fn profile_data_path(profile_id: &str, relative_path: &str) -> Result<PathBuf, String> {
    profile_entry(profile_id)?; // reuse strict immutable-id validation
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("invalid profile data path".into());
    }
    Ok(app_root()?.join("profiles").join(profile_id).join(relative))
}

#[tauri::command]
fn write_desktop_profile_file(
    profile_id: String,
    relative_path: String,
    contents: String,
) -> Result<(), String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile store lock poisoned")?;
    write_private_atomic(
        &profile_data_path(&profile_id, &relative_path)?,
        contents.as_bytes(),
    )
}

#[tauri::command]
fn read_desktop_profile_file(
    profile_id: String,
    relative_path: String,
) -> Result<Option<String>, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile store lock poisoned")?;
    let path = profile_data_path(&profile_id, &relative_path)?;
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn output_for(profile: &ProfileMetadata) -> Result<ProfileSessionOutput, String> {
    let token = profile_entry(&profile.profile_id)?
        .get_password()
        .map_err(|error| error.to_string())?;
    Ok(ProfileSessionOutput {
        profile_id: profile.profile_id.clone(),
        server_url: profile.server_url.clone(),
        token,
        network_id: profile.network_id.clone(),
        username: profile.username.clone(),
        display_name: profile.display_name.clone(),
    })
}

fn save_desktop_profile_unlocked(session_json: String) -> Result<String, String> {
    let input: ProfileSessionInput =
        serde_json::from_str(&session_json).map_err(|error| error.to_string())?;
    let profile_id = input
        .profile_id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut index = read_profile_index()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let created_at = index
        .profiles
        .iter()
        .find(|p| p.profile_id == profile_id)
        .map(|p| p.created_at)
        .unwrap_or(now);
    let profile = ProfileMetadata {
        profile_id: profile_id.clone(),
        server_url: input.server_url.trim_end_matches('/').to_owned(),
        username: input.username.unwrap_or_default(),
        network_id: input.network_id,
        display_name: input.display_name,
        requires_reauth: false,
        created_at,
        updated_at: now,
    };
    profile_entry(&profile_id)?
        .set_password(&input.token)
        .map_err(|error| error.to_string())?;
    ensure_private_dir(&app_root()?.join("profiles").join(&profile_id))?;
    index.profiles.retain(|p| p.profile_id != profile_id);
    index.profiles.push(profile.clone());
    index.active_profile_id = Some(profile_id);
    index.schema_version = 1;
    save_profile_index(&index)?;
    serde_json::to_string(&output_for(&profile)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_desktop_profile(session_json: String) -> Result<String, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    save_desktop_profile_unlocked(session_json)
}

#[tauri::command]
fn list_desktop_profiles() -> Result<String, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    serde_json::to_string(&read_profile_index()?).map_err(|error| error.to_string())
}

#[tauri::command]
fn switch_desktop_profile(profile_id: String) -> Result<String, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let mut index = read_profile_index()?;
    let profile = index
        .profiles
        .iter()
        .find(|p| p.profile_id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    let output = output_for(&profile)?;
    index.active_profile_id = Some(profile_id);
    save_profile_index(&index)?;
    serde_json::to_string(&output).map_err(|error| error.to_string())
}

// 应用多开(Vincent 2026-09-07「允许多个不同账号的 UI 同时存在」):给某个账号开独立工作区
// 窗口时,只读这个 profile 的会话,**不改** active_profile_id —— 主窗口的「当前账号」不受影响。
// switch_desktop_profile 是「切换」,这个是「借用」。
#[tauri::command]
fn load_desktop_profile(profile_id: String) -> Result<String, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let index = read_profile_index()?;
    let profile = index
        .profiles
        .iter()
        .find(|p| p.profile_id == profile_id)
        .ok_or_else(|| "profile not found".to_string())?;
    let output = output_for(profile)?;
    serde_json::to_string(&output).map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_desktop_profile(profile_id: String) -> Result<(), String> {
    if local_hub::is_local_profile(&profile_id) {
        return Err("local workspace cannot be removed as a normal account; use the explicit local-data reset flow".into());
    }
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    remove_desktop_profile_unlocked(&profile_id)
}

fn remove_desktop_profile_unlocked(profile_id: &str) -> Result<(), String> {
    let mut index = read_profile_index()?;
    if !index.profiles.iter().any(|p| p.profile_id == profile_id) {
        return Ok(());
    }
    match profile_entry(profile_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(error.to_string()),
    }
    index.profiles.retain(|p| p.profile_id != profile_id);
    if index.active_profile_id.as_deref() == Some(profile_id) {
        index.active_profile_id = index.profiles.first().map(|p| p.profile_id.clone());
    }
    let profile_dir = app_root()?.join("profiles").join(profile_id);
    if profile_dir.exists() {
        fs::remove_dir_all(profile_dir).map_err(|error| error.to_string())?;
    }
    save_profile_index(&index)
}

fn remove_local_profile_data() -> Result<(), String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    remove_desktop_profile_unlocked(local_hub::LOCAL_PROFILE_ID)
}

#[tauri::command]
fn mark_desktop_profile_requires_reauth(profile_id: String, required: bool) -> Result<(), String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let mut index = read_profile_index()?;
    set_profile_requires_reauth(&mut index, &profile_id, required)?;
    save_profile_index(&index)
}

fn set_profile_requires_reauth(
    index: &mut ProfileIndex,
    profile_id: &str,
    required: bool,
) -> Result<(), String> {
    let profile = index
        .profiles
        .iter_mut()
        .find(|profile| profile.profile_id == profile_id)
        .ok_or_else(|| "profile not found".to_string())?;
    profile.requires_reauth = required;
    Ok(())
}

// 设置 → 账号 →「编辑」(Vincent 2026-09-30「账号 支持一下复制 编辑」):原地改显示名 / Hub 地址。
// 只动这一行的元数据 —— 钥匙串里的令牌按 profile id 存,不动;不改 active_profile_id、不改顺序
// (save_desktop_profile 是「登录后保存并设为当前」,会把它挪到末尾)。新地址能不能用由前端先验过再调。
#[tauri::command]
fn update_desktop_profile(
    profile_id: String,
    server_url: String,
    display_name: Option<String>,
) -> Result<(), String> {
    if local_hub::is_local_profile(&profile_id) {
        return Err("local workspace address is managed by the app".into());
    }
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let mut index = read_profile_index()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    apply_profile_edit(&mut index, &profile_id, &server_url, display_name, now)?;
    save_profile_index(&index)
}

fn apply_profile_edit(
    index: &mut ProfileIndex,
    profile_id: &str,
    server_url: &str,
    display_name: Option<String>,
    now: u64,
) -> Result<(), String> {
    let server_url = server_url.trim().trim_end_matches('/');
    if !(server_url.starts_with("http://") || server_url.starts_with("https://")) {
        return Err("invalid server url".into());
    }
    let profile = index
        .profiles
        .iter_mut()
        .find(|profile| profile.profile_id == profile_id)
        .ok_or_else(|| "profile not found".to_string())?;
    profile.server_url = server_url.to_owned();
    profile.display_name = display_name
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty());
    profile.updated_at = now;
    Ok(())
}

#[tauri::command]
fn load_active_desktop_profile() -> Result<Option<String>, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let mut index = read_profile_index()?;
    if let Some(id) = index.active_profile_id.clone() {
        if let Some(profile) = index.profiles.iter().find(|p| p.profile_id == id) {
            return serde_json::to_string(&output_for(profile)?)
                .map(Some)
                .map_err(|error| error.to_string());
        }
    }
    // One-time migration from v0.2.11+ single-session credential. The old
    // entry is deleted only after the new profile credential + index commit.
    let legacy = match session_entry()?.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut input: ProfileSessionInput =
        serde_json::from_str(&legacy).map_err(|error| error.to_string())?;
    input.profile_id = None;
    let saved = save_desktop_profile_unlocked(
        serde_json::to_string(&input).map_err(|error| error.to_string())?,
    )?;
    index = read_profile_index()?;
    if index.active_profile_id.is_some() {
        let _ = session_entry()?.delete_credential();
    }
    Ok(Some(saved))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_credentials_size_is_bounded() {
        assert!(check_voice_credentials_size("").is_err());
        assert!(check_voice_credentials_size(&"x".repeat(VOICE_CREDENTIALS_MAX_BYTES + 1)).is_err());
        assert!(check_voice_credentials_size(r#"{"accessToken":"t"}"#).is_ok());
    }

    #[test]
    fn download_name_is_basename_only() {
        assert_eq!(sanitize_download_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_download_name("C:\\Users\\x\\a.pptx"), "a.pptx");
        assert_eq!(sanitize_download_name("  report.pdf "), "report.pdf");
        assert_eq!(sanitize_download_name(""), "download");
        assert_eq!(sanitize_download_name(".."), "download");
    }

    #[test]
    fn download_path_dedupes_before_extension() {
        let dir = Path::new("/d");
        let taken = |p: &Path| p == Path::new("/d/a.pdf") || p == Path::new("/d/a (2).pdf");
        assert_eq!(dedupe_download_path(dir, "a.pdf", &taken), PathBuf::from("/d/a (3).pdf"));
        assert_eq!(dedupe_download_path(dir, "b.pdf", &taken), PathBuf::from("/d/b.pdf"));
        let noext = |p: &Path| p == Path::new("/d/README");
        assert_eq!(dedupe_download_path(dir, "README", &noext), PathBuf::from("/d/README (2)"));
    }

    // Same-Entry round trips also pass with keyring's mock backend. Reject it
    // explicitly and reopen the identity before claiming native persistence.
    #[test]
    fn desktop_session_round_trip_uses_native_store() {
        let account = format!("ci-session-{}", std::process::id());
        let entry = keyring::Entry::new(SESSION_SERVICE, &account)
            .expect("native credential-store backend must be installed");
        assert!(
            entry.get_credential().downcast_ref::<keyring::mock::MockCredential>().is_none(),
            "a native credential backend must be enabled for this platform"
        );
        let value = r#"{"serverUrl":"https://example.invalid","token":"test-token"}"#;

        entry
            .set_password(value)
            .expect("write native credential store");
        assert_eq!(
            entry.get_password().expect("read native credential store"),
            value
        );
        let reopened = keyring::Entry::new(SESSION_SERVICE, &account)
            .expect("reopen native credential-store entry");
        assert_eq!(
            reopened.get_password().expect("read a separately created entry"),
            value
        );
        entry
            .delete_credential()
            .expect("delete native credential store fixture");
        assert!(matches!(reopened.get_password(), Err(keyring::Error::NoEntry)));
    }

    #[test]
    fn profile_registry_metadata_never_serializes_secrets() {
        let profile = ProfileMetadata {
            profile_id: "91f0f5df-0eef-486a-b302-1a15f501a1cf".into(),
            server_url: "https://hub.example".into(),
            username: "admin".into(),
            network_id: Some("net_test".into()),
            display_name: None,
            requires_reauth: false,
            created_at: 1,
            updated_at: 2,
        };
        let json = serde_json::to_string(&ProfileIndex {
            schema_version: 1,
            active_profile_id: Some(profile.profile_id.clone()),
            profiles: vec![profile],
        })
        .expect("serialize registry");
        assert!(!json.contains("token"));
        assert!(!json.contains("password"));
        assert!(json.contains("profileId"));
    }

    #[test]
    fn corrupt_profile_registry_is_quarantined_without_data_loss() {
        let fixture = std::env::temp_dir().join(format!(
            "agent-network-profile-recovery-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&fixture).expect("create recovery fixture");
        let index_path = fixture.join("index.json");
        let corrupt_bytes = b"{not-valid-json";
        fs::write(&index_path, corrupt_bytes).expect("write corrupt registry");

        let recovered = read_profile_index_at(index_path.clone()).expect("recover registry");
        assert_eq!(recovered.schema_version, 1);
        assert!(recovered.profiles.is_empty());
        assert!(!index_path.exists());

        let backups = fs::read_dir(&fixture)
            .expect("read recovery fixture")
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);
        assert!(backups[0]
            .file_name()
            .to_string_lossy()
            .starts_with("index.corrupt-"));
        assert_eq!(
            fs::read(backups[0].path()).expect("read backup"),
            corrupt_bytes
        );

        fs::remove_dir_all(fixture).expect("remove recovery fixture");
    }

    #[test]
    fn revoked_profile_marker_is_isolated() {
        let make_profile = |profile_id: &str| ProfileMetadata {
            profile_id: profile_id.into(),
            server_url: format!("https://{profile_id}.example"),
            username: "admin".into(),
            network_id: None,
            display_name: None,
            requires_reauth: false,
            created_at: 1,
            updated_at: 1,
        };
        let mut index = ProfileIndex {
            schema_version: 1,
            active_profile_id: Some("profile-b".into()),
            profiles: vec![make_profile("profile-a"), make_profile("profile-b")],
        };

        set_profile_requires_reauth(&mut index, "profile-b", true).expect("mark profile b");
        assert!(!index.profiles[0].requires_reauth);
        assert!(index.profiles[1].requires_reauth);
        assert_eq!(index.active_profile_id.as_deref(), Some("profile-b"));
    }

    #[test]
    fn profile_edit_updates_one_row_in_place() {
        let make_profile = |profile_id: &str| ProfileMetadata {
            profile_id: profile_id.into(),
            server_url: format!("https://{profile_id}.example"),
            username: "admin".into(),
            network_id: Some("net_test".into()),
            display_name: Some("old".into()),
            requires_reauth: false,
            created_at: 1,
            updated_at: 1,
        };
        let mut index = ProfileIndex {
            schema_version: 1,
            active_profile_id: Some("profile-a".into()),
            profiles: vec![make_profile("profile-a"), make_profile("profile-b"), make_profile("profile-c")],
        };

        apply_profile_edit(&mut index, "profile-b", " https://new.example/ ", Some(" Work ".into()), 9)
            .expect("edit profile b");
        let ids: Vec<_> = index.profiles.iter().map(|p| p.profile_id.as_str()).collect();
        assert_eq!(ids, ["profile-a", "profile-b", "profile-c"]);
        assert_eq!(index.active_profile_id.as_deref(), Some("profile-a"));
        assert_eq!(index.profiles[1].server_url, "https://new.example");
        assert_eq!(index.profiles[1].display_name.as_deref(), Some("Work"));
        assert_eq!(index.profiles[1].username, "admin");
        assert_eq!(index.profiles[1].created_at, 1);
        assert_eq!(index.profiles[1].updated_at, 9);
        for untouched in [&index.profiles[0], &index.profiles[2]] {
            assert_eq!(untouched.display_name.as_deref(), Some("old"));
            assert_eq!(untouched.updated_at, 1);
        }

        apply_profile_edit(&mut index, "profile-b", "https://new.example", Some("  ".into()), 10)
            .expect("clear label");
        assert_eq!(index.profiles[1].display_name, None);
        assert!(apply_profile_edit(&mut index, "profile-b", "ftp://x", None, 11).is_err());
        assert!(apply_profile_edit(&mut index, "missing", "https://x.example", None, 11).is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 0.2.82: 托盘面板是独立 webview,读不到主窗口的 unread-store;
        // 主窗口推上来的模型存这里,面板再来取。
        .manage(tray::TrayModelState::default())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            // 先于任何通知登记 bundle id,否则 macOS 弹「Where is use_default?」(见 chat_notify.rs)
            chat_notify::init_notification_app(app.handle());
            // 0.2.76 系统栏常驻项;失败只记日志,不能拖垮主窗口
            if let Err(error) = tray::init(app.handle()) {
                eprintln!("[tray] init failed: {error}");
            }
            // 0.2.81(Vincent:「这个地方在 Windows 上也很难看」):Windows 去掉系统标题栏,
            // 改由前端自绘(src/win-title-bar.tsx)。
            // 🔴 只能在这里按平台关,不能写进 tauri.conf.json —— 那里的 `decorations` 是
            //    跨平台的,关掉会连 macOS 的红黄绿灯一起没了(macOS 走的是 Overlay 标题栏,
            //    要保留 decorations)。
            #[cfg(target_os = "windows")]
            {
                for (label, window) in app.webview_windows() {
                    if let Err(error) = window.set_decorations(false) {
                        eprintln!("[window] {label}: set_decorations(false) failed: {error}");
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_desktop_profile,
            list_desktop_profiles,
            switch_desktop_profile,
            load_desktop_profile,
            remove_desktop_profile,
            mark_desktop_profile_requires_reauth,
            update_desktop_profile,
            load_active_desktop_profile,
            write_desktop_profile_file,
            read_desktop_profile_file,
            desktop_storage_diagnostics,
            save_voice_credentials,
            load_voice_credentials,
            clear_voice_credentials,
            start_network_event_stream,
            stop_network_event_stream,
            start_user_event_stream,
            stop_user_event_stream,
            local_hub::start_local_hub,
            local_hub::local_hub_status,
            local_hub::stop_local_hub,
            local_hub::restart_local_hub,
            local_hub::open_local_hub_logs,
            local_hub::backup_local_hub_data,
            local_hub::delete_local_hub_data,
            local_daemon_scan,
            local_daemon_install,
            save_download,
            tray::tray_update,
            tray::tray_panel_model,
            tray::tray_open_chat,
            tray::tray_dismiss_all,
            tray::tray_panel_hide,
            chat_notify::show_chat_notification,
            hub_http::pooled_fetch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    let _ = local_hub::stop_local_hub_inner();
}

pub fn run_packaged_local_hub_smoke() -> Result<(), String> {
    local_hub::packaged_smoke()
}

pub fn run_packaged_local_hub_migration_smoke() -> Result<(), String> {
    local_hub::packaged_migration_smoke()
}

pub fn run_packaged_local_hub_failed_migration_smoke() -> Result<(), String> {
    local_hub::packaged_failed_migration_smoke()
}

pub fn run_packaged_local_hub_crash_recovery_smoke() -> Result<(), String> {
    local_hub::packaged_crash_recovery_smoke()
}

/// 桌面端附件下载(Vincent 2026-09-07「点击了没反应」):WKWebView/WebView2 里 `<a download>` 不会真的
/// 下载,而非图片附件此前根本没接点击。前端带凭据拿到字节后交给这里,写进系统「下载」目录,
/// 返回落盘路径(同名自动加 (2)、(3)…)。文件名只取 basename,拒绝路径分隔符。
fn sanitize_download_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let cleaned: String = base.chars().filter(|c| !c.is_control()).collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." { "download".into() } else { cleaned }
}

fn dedupe_download_path(dir: &Path, name: &str, exists: &dyn Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(name);
    if !exists(&first) { return first; }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 2..10_000 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !exists(&candidate) { return candidate; }
    }
    dir.join(format!("{stem}-{}{ext}", std::process::id()))
}

/// `target_path` 来自系统「另存为」对话框(Vincent 2026-09-07「支持一下选择保存文件夹路径」):给了就写到
/// 那里(对话框已经处理了覆盖确认),没给就落到「下载」目录并自动去重。
#[tauri::command]
fn save_download(app: tauri::AppHandle, name: String, bytes_base64: String, target_path: Option<String>) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64.as_bytes())
        .map_err(|error| format!("bad payload: {error}"))?;
    if let Some(chosen) = target_path.filter(|p| !p.trim().is_empty()) {
        let target = PathBuf::from(chosen);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&target, &bytes).map_err(|error| format!("write failed: {error}"))?;
        return Ok(target.display().to_string());
    }
    let dir = app.path().download_dir().map_err(|error| format!("no download dir: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let target = dedupe_download_path(&dir, &sanitize_download_name(&name), &|p| p.exists());
    fs::write(&target, &bytes).map_err(|error| format!("write failed: {error}"))?;
    Ok(target.display().to_string())
}

#[tauri::command]
fn local_daemon_scan() -> Result<String, String> {
    let session = local_hub::local_daemon_session()?;
    serde_json::to_string(&local_daemon::scan(session.as_ref())?).map_err(|error| error.to_string())
}

/// npm install 可能跑 1–2 分钟:放到阻塞线程池,别卡主线程/UI。
#[tauri::command]
async fn local_daemon_install() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<String, String> {
        let session = local_hub::local_daemon_session()?
            .ok_or_else(|| "本地 Hub 还没启动或没有会话;先切到 Local workspace 让本地 Hub 运行起来".to_string())?;
        serde_json::to_string(&local_daemon::install(&session)?).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn run_packaged_local_daemon_install_smoke() -> Result<(), String> {
    local_hub::packaged_local_daemon_install_smoke()
}

pub fn run_packaged_local_hub_lost_credential_smoke() -> Result<(), String> {
    local_hub::packaged_lost_credential_smoke()
}

pub fn run_packaged_local_hub_stale_takeover_smoke() -> Result<(), String> {
    local_hub::packaged_stale_hub_takeover_smoke()
}

pub fn run_packaged_local_hub_corrupt_data_smoke() -> Result<(), String> {
    local_hub::packaged_corrupt_data_smoke()
}

pub fn run_packaged_multihub_smoke() -> Result<(), String> {
    local_hub::packaged_multihub_smoke()
}

pub fn run_packaged_multihub_cold_start_verify() -> Result<(), String> {
    local_hub::packaged_multihub_cold_start_verify()
}
