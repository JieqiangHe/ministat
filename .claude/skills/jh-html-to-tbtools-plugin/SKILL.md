---
name: jh-html-to-tbtools-plugin
description: Package an HTML / static web tool as an installable TBtools plugin (.plugin) that runs as a tab in TBtools' built-in JxBrowser. Use this skill whenever the user mentions a TBtools plugin or .plugin file, installing or converting a web page / HTML / single-file tool into TBtools, or embedding a web page in TBtools — even without saying "plugin".
---

# HTML → TBtools plugin

The Java side is just a thin shell: it opens the plugin folder's `index.html` via file:// using TBtools' own JxBrowser panel. Bundled scripts:

- `scripts/PluginInject.java`: generic entry class; the plugin name is taken from the plugin folder name — no per-app modification needed.
- `scripts/build.sh`: compiles and packages everything into a `.plugin`.
- `scripts/Verify.java`: simulates installation using TBtools' own unzip-and-load code.

## Environment

Requires JDK 11+ (`javac`, `jar`), `zip`, and the TBtools main jar. Compilation depends on that jar only — no JxBrowser jar needed.

To tell whether a jar is the main jar: `unzip -l <jar> | grep WebGuiJPanel.class` should find `biocjava/GUIexcutors/WebGuiApp/WebGuiJPanel.class`.

Lookup order:

1. First check `TBtools_JRE1.6.jar` under the TBtools home (the directory containing `.Plugin/`) — this is the path referenced by TBtools' shortcut-generation code.
2. If absent, search the installation directory using the check above.
3. If still not found, ask the user — do not guess.

## Workflow

### 1. Staging

Copy the app into a staging directory and make all modifications in the copy; never touch the user's original repo.

- The entry file must be named `index.html`.
- No other `.jar` at the top level: TBtools loads only the first jar it finds, and build.sh errors out on any extra one.
- Dot-prefixed files (`.git`, `.DS_Store`, etc.) are dropped automatically during packaging.

### 2. Localizing external dependencies

The page runs under file://, so first list all external links:

```bash
grep -noE '(src|href)="https?://[^"]+"' index.html
```

Then handle each one by type:

- **`<script src>` and stylesheets**: download into `vendor/`, rewrite the reference to a relative path, and drop `integrity` and `crossorigin` from the tag.
  - Why: a file:// page has an opaque origin, so a local load carrying `crossorigin` is blocked by Chromium's CORS, and SRI verification fails with it.
  - If the original tag carried SRI, verify the downloaded file before removing the attributes: `openssl dgst -sha384 -binary <file> | base64` must match the original SRI digest.
  - If the CDN is unreachable, fetch the same file from the npm registry with `npm pack <pkg>@<ver>`.
- **Relative `url()`s inside CDN CSS** (fonts, images): download them as well, keeping the original relative directory layout.
- **Font-service CSS** (e.g. Google Fonts): can stay as is; offline it falls back to system fonts.
- **`<a href>` and `fetch` to remote APIs**: nothing to do.
- **`<script type="module" src>`, `import` of local files, `new Worker('x.js')`**: all blocked under file://. Rewrite as inline or classic scripts; if a remote URL is kept, the plugin only works online — tell the user.

### 3. Packaging

```bash
bash scripts/build.sh <tbtools_jar> <staging_dir> <name> [menu_path]
```

Outputs `./<name>.plugin`. `<name>` determines the plugin folder name, the menu name, and the tab title; it may contain spaces.

`menu_path` is optional and nests the plugin in a submenu; levels are tab-separated, e.g. `$'Graphics\tSVG'` (call from bash).

### 4. Verification

```bash
java -Djava.awt.headless=true -cp <tbtools_jar> scripts/Verify.java <name>.plugin
```

With only the main jar on the classpath, the expected result is `OK: reached WebGuiJPanel, stopped at missing JxBrowser` — plugin structure and class loading have both worked, stopping only at browser creation.

If Playwright or another headless Chromium is available, also open the staged `index.html` via file:// and confirm the console is error-free and all depended-on globals are defined (e.g. `typeof Plotly`).

### 5. Delivery

The `.plugin` is installed through Install Plugin in the TBtools menu. On delivery, tell the user the items under Known limitations below that apply to this app, and ask them to test it themselves.

## TBtools plugin mechanics (from decompilation)

- A `.plugin` is just a zip; installation extracts it to `.Plugin/` under the TBtools home. Use forward-slash paths inside the zip so it installs on every platform.
- TBtools loads the first `*.jar` in the plugin folder with a URLClassLoader (parented to TBtools itself), then reflectively invokes `Plugin.PluginInject`. That class needs:
  - a no-arg constructor;
  - `JPanel generatePanel()`;
  - `String getPluginName()`.

  No interface needs implementing, and the jar needs no manifest. Compile with `--release 11`, matching TBtools' class-file version.
- After startup, the menu item shows the folder name; `getPluginName()` is used only once, right after installation.
- `MenuConfig.ini` is read without trimming, so a trailing newline would become part of the menu name — hence build.sh writes it with `printf`.
- Once the plugin panel is added, TBtools calls `pack()`. PluginInject sets a preferredSize; without one the window may shrink to something tiny.
- `biocjava.GUIexcutors.WebGuiApp.WebGuiJPanel(String url, boolean controlMenu)` uses a shared static Engine (`getEngine()`, OFF_SCREEN mode, user data under `.jxbrowser` in the TBtools home) and injects its license itself. With `controlMenu=false` the navigation bar is hidden.
- Uninstall: Ctrl-click the plugin's item in the menu.

## Known limitations

- **Downloads**: files downloaded via `<a download>`, Blob, `Plotly.downloadImage`, etc. land in the system temp directory, followed by a "Download Finished. Browse It?" popup — there is no "Save As". Additionally, when a filename ends in `.zip` or `plugin`, TBtools prompts to treat it as a plugin install.
  - To get "Save As" instead, build your own Browser: `WebGuiJPanel.getEngine().newBrowser()` plus `BrowserView`, then set a `StartDownloadCallback`.
  - This requires compiling against the JxBrowser jar in the TBtools installation directory.
  - Before calling `getEngine()`, run `System.setProperty("jxbrowser.license.key", toolsKit.LicenseHub.GetLicense.getJxBroswerLicense())`.
- **Printing and drag-and-drop**: `window.print()` and dragging files in from a file manager are unverified in OFF_SCREEN mode.
- **localStorage**: data lives in TBtools' shared `.jxbrowser` directory. All file:// pages share one origin and can read each other's data — if the app stores an API key there, tell the user.
- **Do not load the page from a data: URL**: its origin is opaque and localStorage access throws SecurityError.
- **Updates**: if only `index.html` changed and dependencies need no re-localization, replace `.Plugin/<name>/index.html` in place; otherwise rebuild.
- **Version compatibility**: the plugin depends on the single constructor `WebGuiJPanel(String, boolean)`. If loading breaks after a TBtools upgrade, first check that this class still exists.
