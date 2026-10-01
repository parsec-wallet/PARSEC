fn main() {
    // Android: align the native library to 16 KB pages. Phones with 16 KB memory pages
    // (Android 15+ flagships) load the library straight from the APK (extractNativeLibs is
    // false), and a library linked for 4 KB pages is refused there — the install fails with
    // "App not installed". 16 KB alignment also runs on 4 KB devices. Set here rather than
    // in .cargo/config.toml because the Tauri Android build exports its own
    // CARGO_TARGET_<triple>_RUSTFLAGS, which overrides a config's rustflags.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
    tauri_build::build()
}
