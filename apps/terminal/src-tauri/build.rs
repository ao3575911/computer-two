fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["open_shell", "write_pty", "resize_pty"]),
    ))
    .expect("failed to run tauri-build");
}
