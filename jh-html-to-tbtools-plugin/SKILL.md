---
name: jh-html-to-tbtools-plugin
description: 把 HTML / 静态网页工具打包成 TBtools 插件（.plugin），在 TBtools 内置的 JxBrowser 里作为标签页运行。只要用户提到 TBtools 插件、.plugin 文件、把网页 / HTML / 单文件工具装进或转成 TBtools，或想在 TBtools 里嵌入网页，就使用此技能，即使没明说"插件"。Packages an index.html-based web app as an installable TBtools plugin.
---

# HTML → TBtools 插件

Java 侧只是一层薄壳：用 TBtools 自带的 JxBrowser 面板，以 file:// 打开插件文件夹里的 `index.html`。附带脚本：

- `scripts/PluginInject.java`：通用入口类，插件名取插件文件夹名，不需要按应用修改。
- `scripts/build.sh`：编译并打包成 `.plugin`。
- `scripts/Verify.java`：用 TBtools 自己的解压和加载代码模拟安装。

## 环境

需要 JDK 11+（`javac`、`jar`）、`zip`，以及 TBtools 主 jar。编译只依赖这一个 jar，不需要 JxBrowser 的 jar。

判断是不是主 jar：`unzip -l <jar> | grep WebGuiJPanel.class` 能找到 `biocjava/GUIexcutors/WebGuiApp/WebGuiJPanel.class` 就是。

查找顺序：

1. 先看 TBtools home（含 `.Plugin/` 的目录）下的 `TBtools_JRE1.6.jar`，TBtools 生成快捷方式的代码引用的就是这个路径。
2. 没有就在安装目录里按上面的方法搜。
3. 还找不到就问用户，不要猜。

## 流程

### 1. staging

把应用复制到一个 staging 目录，所有修改都在副本里做，不动用户的原始仓库。

- 入口文件必须叫 `index.html`。
- 顶层不能有其他 `.jar`：TBtools 只加载找到的第一个 jar，build.sh 遇到会报错。
- 点开头的文件（`.git`、`.DS_Store` 等）会在打包时自动去掉。

### 2. 外部依赖本地化

页面跑在 file:// 下，先列出所有外链：

```bash
grep -noE '(src|href)="https?://[^"]+"' index.html
```

然后逐个按类型处理：

- **`<script src>` 和样式表**：下载到 `vendor/`，引用改成相对路径，同时删掉这个标签上的 `integrity` 和 `crossorigin`。
  - 原因：file:// 页面的 origin 是 opaque，带 `crossorigin` 的本地加载会被 Chromium 的 CORS 拦截，SRI 校验也会跟着失败。
  - 原标签带 SRI 时，删属性前先核对下载的文件：`openssl dgst -sha384 -binary <file> | base64`，结果应与原 SRI 一致。
  - CDN 连不上时，用 `npm pack <pkg>@<ver>` 从 npm registry 取同一个文件。
- **CDN CSS 里的相对 `url()`**（字体、图片）：一起下载，并保持原来的相对目录结构。
- **字体服务的 CSS**（如 Google Fonts）：可以保留，离线时回落到系统字体。
- **`<a href>`、远程 API 的 `fetch`**：不用处理。
- **`<script type="module" src>`、`import` 本地文件、`new Worker('x.js')`**：file:// 下都会被拦截。可以改成内联脚本或经典脚本；如果保留远程 URL，插件就只能联网使用，要告诉用户。

### 3. 打包

```bash
bash scripts/build.sh <tbtools_jar> <staging_dir> <name> [menu_path]
```

输出 `./<name>.plugin`。`<name>` 同时决定插件文件夹名、菜单名和标签页名，可以含空格。

`menu_path` 可选，用来把插件放进子菜单，多级之间用 tab 分隔，如 `$'Graphics\tSVG'`（要在 bash 里调用）。

### 4. 验证

```bash
java -Djava.awt.headless=true -cp <tbtools_jar> scripts/Verify.java <name>.plugin
```

只用主 jar 时，正常结果是 `OK: reached WebGuiJPanel, stopped at missing JxBrowser`。这说明插件结构和类加载都走通了，一直到创建浏览器那一步才停下。

有 Playwright 或其他 headless Chromium 的话，再以 file:// 打开 staging 里的 `index.html`，确认控制台没有报错，依赖的全局对象也已定义（如 `typeof Plotly`）。

### 5. 交付

`.plugin` 通过 TBtools 菜单里的 Install Plugin 安装。交付时把下面"已知限制"中和这个应用相关的几条告诉用户，请他实测。

## TBtools 插件机制（反编译所得）

- `.plugin` 就是一个 zip，安装时解压到 TBtools home 下的 `.Plugin/`。zip 内用正斜杠路径，各平台都能装。
- TBtools 用 URLClassLoader 加载插件文件夹里的第一个 `*.jar`，父加载器是 TBtools 自身，然后反射调用 `Plugin.PluginInject`。这个类需要：
  - 无参构造；
  - `JPanel generatePanel()`；
  - `String getPluginName()`。

  不需要实现接口，jar 也不需要 manifest。编译用 `--release 11`，与 TBtools 的 class 版本一致。
- 启动后，菜单项显示的是文件夹名；`getPluginName()` 只在刚安装的那一次用到。
- `MenuConfig.ini` 读入时不做 trim，结尾换行会变成菜单名的一部分，所以 build.sh 用 `printf` 写入。
- 插件面板加入后 TBtools 会调用 `pack()`。PluginInject 设了 preferredSize，不设的话窗口可能缩得很小。
- `biocjava.GUIexcutors.WebGuiApp.WebGuiJPanel(String url, boolean controlMenu)` 使用共享的静态 Engine（`getEngine()`，OFF_SCREEN 模式，用户数据在 TBtools home 下的 `.jxbrowser`），license 由它自己注入。`controlMenu=false` 时不显示导航栏。
- 卸载：在菜单里按住 Ctrl 点击插件项。

## 已知限制

- **下载**：`<a download>`、Blob、`Plotly.downloadImage` 等下载的文件都存到系统临时目录，完成后弹窗 "Download Finished. Browse It?"，没有"另存为"。另外，文件名以 `.zip` 或 `plugin` 结尾时，TBtools 会提示把它当插件安装。
  - 要改成"另存为"，需要自建 Browser：`WebGuiJPanel.getEngine().newBrowser()` 加 `BrowserView`，再设置 `StartDownloadCallback`。
  - 这需要对着 TBtools 安装目录里的 JxBrowser jar 编译。
  - 调用 `getEngine()` 之前先执行 `System.setProperty("jxbrowser.license.key", toolsKit.LicenseHub.GetLicense.getJxBroswerLicense())`。
- **打印和拖拽**：`window.print()` 和从文件管理器拖入文件在 OFF_SCREEN 模式下的表现未验证。
- **localStorage**：数据存在 TBtools 共享的 `.jxbrowser` 目录。所有 file:// 页面同源、可以互相读取，如果应用在里面存了 API key，要告诉用户。
- **不要用 data: URL 加载页面**：它的 origin 是 opaque，访问 localStorage 会抛 SecurityError。
- **更新**：只改了 `index.html`、且不需要重新本地化依赖时，可以直接替换 `.Plugin/<name>/index.html`；其他情况重新 build。
- **版本兼容**：插件只依赖 `WebGuiJPanel(String, boolean)` 这一个构造器。TBtools 升级后加载失败，先检查这个类还在不在。
