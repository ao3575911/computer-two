use std::path::PathBuf;
use std::process::{Command, Stdio};

#[tauri::command]
pub fn run_failing_add_check() -> Result<String, String> {
    run_node_script(
        "observe-cli.ts",
        "The failing-add check is not available in this build.",
    )
}

#[tauri::command]
pub fn show_failing_add_diff() -> Result<String, String> {
    run_node_script(
        "diff-cli.ts",
        "The failing-add diff is not available in this build.",
    )
}

fn run_node_script(script_name: &str, missing: &str) -> Result<String, String> {
    let repo = repo_root()?;
    let script = repo.join("packages/sandbox/src").join(script_name);
    if !script.is_file() {
        return Err(missing.to_string());
    }
    let output = Command::new("node")
        .arg("--experimental-strip-types")
        .arg(&script)
        .arg(&repo)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("node could not start the check: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let trimmed = detail.trim();
        if trimmed.is_empty() {
            return Err("The check could not run.".to_string());
        }
        return Err(format!("The check could not run. {trimmed}"));
    }
    String::from_utf8(output.stdout)
        .map_err(|_| "The check returned bytes that are not UTF-8.".to_string())
}

fn repo_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .map_err(|error| error.to_string())
}
