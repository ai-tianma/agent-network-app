//! Exact desktop daemon package pair. Keep aligned with the backend's
//! agent-network/src/opencode-agent-node-pair.ts; never resolve floating tags.
pub const ANET_VERSION: &str = "2.3.0-preview.162";
pub const AGENT_NODE_VERSION: &str = "2.5.0-preview.128";
pub const ANET_PACKAGE: &str = "@sleep2agi/agent-network@2.3.0-preview.162";
pub const AGENT_NODE_PACKAGE: &str = "@sleep2agi/agent-node@2.5.0-preview.128";

pub fn require_success(code: Option<i32>, timed_out: bool) -> Result<(), String> {
    if timed_out || code != Some(0) {
        return Err(format!("private package probe failed (exit={code:?}, timeout={timed_out})"));
    }
    Ok(())
}

pub fn validate_cli_probe(code: Option<i32>, timed_out: bool, output: &str) -> Result<String, String> {
    require_success(code, timed_out)?;
    let versions: Vec<_> = output.lines().filter_map(|line| line.trim().strip_prefix("anet v")).collect();
    if versions.as_slice() != [ANET_VERSION] {
        return Err(format!("private anet must be exactly {ANET_PACKAGE}; existing installation was not replaced"));
    }
    Ok(ANET_VERSION.into())
}

pub fn validate_agent_node_manifest(
    name: Option<&str>, version: Option<&str>, bin: Option<&str>, entry_exists: bool,
) -> Result<(), String> {
    if name != Some("@sleep2agi/agent-node") || version != Some(AGENT_NODE_VERSION)
        || bin != Some("dist/cli.js") || !entry_exists
    {
        return Err(format!("private agent-node must be an intact {AGENT_NODE_PACKAGE}; existing installation was not replaced"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_pair_specs_are_not_floating() {
        assert_eq!(ANET_PACKAGE, format!("@sleep2agi/agent-network@{ANET_VERSION}"));
        assert_eq!(AGENT_NODE_PACKAGE, format!("@sleep2agi/agent-node@{AGENT_NODE_VERSION}"));
    }
    #[test]
    fn cli_accepts_exact_banner_with_login_shell_noise() {
        assert_eq!(validate_cli_probe(Some(0), false, &format!("Now using node v22\nanet v{ANET_VERSION}\nComponents: ...")), Ok(ANET_VERSION.into()));
    }
    #[test]
    fn failed_process_cannot_pass_with_a_correct_banner() {
        for (code, timed_out) in [(Some(1), false), (None, false), (Some(0), true)] {
            assert!(validate_cli_probe(code, timed_out, &format!("anet v{ANET_VERSION}")).unwrap_err().contains("probe failed"));
        }
    }
    #[test]
    fn old_future_missing_and_ambiguous_cli_versions_fail() {
        for output in ["anet v2.3.0-preview.76", "anet v2.3.0-preview.163", "", ANET_VERSION,
            "anet v2.3.0-preview.162\nanet v2.3.0-preview.76"] {
            assert!(validate_cli_probe(Some(0), false, output).is_err(), "{output}");
        }
    }
    #[test]
    fn exact_agent_node_manifest_passes() {
        assert!(validate_agent_node_manifest(Some("@sleep2agi/agent-node"), Some(AGENT_NODE_VERSION), Some("dist/cli.js"), true).is_ok());
    }
    #[test]
    fn old_future_wrong_missing_or_partial_agent_node_fails() {
        for (name, version, bin, exists) in [
            (Some("@sleep2agi/agent-node"), Some("2.5.0-preview.58"), Some("dist/cli.js"), true),
            (Some("@sleep2agi/agent-node"), Some("2.5.0-preview.129"), Some("dist/cli.js"), true),
            (Some("other"), Some(AGENT_NODE_VERSION), Some("dist/cli.js"), true),
            (None, Some(AGENT_NODE_VERSION), Some("dist/cli.js"), true),
            (Some("@sleep2agi/agent-node"), None, Some("dist/cli.js"), true),
            (Some("@sleep2agi/agent-node"), Some(AGENT_NODE_VERSION), Some("../other.js"), true),
            (Some("@sleep2agi/agent-node"), Some(AGENT_NODE_VERSION), Some("dist/cli.js"), false),
        ] {
            assert!(validate_agent_node_manifest(name, version, bin, exists).is_err());
        }
    }
}
