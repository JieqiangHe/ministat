package Plugin;

import biocjava.GUIexcutors.WebGuiApp.WebGuiJPanel;
import java.awt.AWTEvent;
import java.awt.Component;
import java.awt.Container;
import java.awt.Dialog;
import java.awt.Dimension;
import java.awt.EventQueue;
import java.awt.FileDialog;
import java.awt.Frame;
import java.awt.Toolkit;
import java.awt.Window;
import java.awt.event.HierarchyEvent;
import java.awt.event.HierarchyListener;
import java.awt.event.InputMethodEvent;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;
import java.nio.file.Path;
import java.text.AttributedCharacterIterator;
import java.text.CharacterIterator;
import java.util.Optional;
import javax.swing.JComponent;
import javax.swing.JPanel;
import javax.swing.SwingUtilities;

public class PluginInject {

    private interface Handler { void on(Object params, Object tell) throws Exception; }

    private interface Saver { void to(Path file) throws Exception; }

    private static final String CB = "com.teamdev.jxbrowser.browser.callback.";
    private static File lastDir;
    private static boolean queued;
    private final File dir;

    public PluginInject() throws Exception {
        dir = new File(PluginInject.class.getProtectionDomain().getCodeSource().getLocation().toURI()).getParentFile();
    }

    public JPanel generatePanel() {
        JPanel p = new WebGuiJPanel(new File(dir, "index.html").toPath().toUri().toString(), false);
        p.setPreferredSize(new Dimension(1280, 800));
        if (!hook(p)) p.addHierarchyListener(new HierarchyListener() {
            public void hierarchyChanged(HierarchyEvent e) {
                if ((e.getChangeFlags() & HierarchyEvent.SHOWING_CHANGED) == 0 || !p.isShowing()) return;
                if (hook(p)) p.removeHierarchyListener(this);
                else System.err.println("PluginInject: no JxBrowser Browser found in the panel; downloads and printing left to TBtools");
            }
        });
        return p;
    }

    public String getPluginName() {
        return dir.getName();
    }

    private static boolean hook(JPanel p) {
        try {
            Class<?> B = Class.forName("com.teamdev.jxbrowser.browser.Browser", false, PluginInject.class.getClassLoader());
            Object found = browser(B, p);
            for (Class<?> k = p.getClass(); found == null && k != JPanel.class; k = k.getSuperclass())
                for (Field f : k.getDeclaredFields())
                    if (found == null && B.isAssignableFrom(f.getType())) { f.setAccessible(true); found = f.get(p); }
            if (found == null) return false;
            Object b = found;
            p.putClientProperty(PluginInject.class, b);
            if (System.getProperty("os.name", "").startsWith("Mac")) ime();
            set(b, "StartDownloadCallback", (pa, tell) -> save(p, (String) call(call(call(pa, "download"), "target"), "suggestedFileName"), tell, f -> call(tell, "download", f)));
            if (set(b, "PrintHtmlCallback", (pa, tell) -> save(p, pdfName(b), tell, f -> pdf(pa, tell, f)))) set(b, "PrintCallback", (pa, tell) -> call(tell, "print"));
            else System.err.println("PluginInject: no PrintHtmlCallback in this JxBrowser, printing left to TBtools");
        } catch (Throwable e) {
            e.printStackTrace();
        }
        return true;
    }

    private static synchronized void ime() {
        if (queued) return;
        queued = true;
        Toolkit.getDefaultToolkit().getSystemEventQueue().push(new EventQueue() {
            private boolean composing;

            protected void dispatchEvent(AWTEvent e) {
                if (e instanceof InputMethodEvent && e.getID() == InputMethodEvent.INPUT_METHOD_TEXT_CHANGED) try {
                    InputMethodEvent m = (InputMethodEvent) e;
                    String s = text(m.getText());
                    boolean was = composing;
                    composing = s.length() > m.getCommittedCharacterCount();
                    if (!was && !composing && !s.isEmpty() && insert(m.getSource(), s)) return;
                } catch (Throwable x) {
                    x.printStackTrace();
                }
                super.dispatchEvent(e);
            }
        });
    }

    private static String text(AttributedCharacterIterator it) {
        if (it == null) return "";
        StringBuilder b = new StringBuilder();
        for (char c = it.first(); c != CharacterIterator.DONE; c = it.next()) b.append(c);
        it.first();
        return b.toString();
    }

    private static boolean insert(Object source, String s) throws Exception {
        Object b = null, f = null;
        for (Object c = source; b == null && c instanceof Component; c = ((Component) c).getParent())
            if (c instanceof JComponent) b = ((JComponent) c).getClientProperty(PluginInject.class);
        if (b == null) return false;
        for (String w : new String[]{"focusedFrame", "mainFrame"}) if (f == null) try {
            f = call(b, w);
            if (f instanceof Optional) f = ((Optional<?>) f).orElse(null);
        } catch (NoSuchMethodException x) {
        }
        if (f == null) return false;
        StringBuilder js = new StringBuilder("document.execCommand('insertText',false,'");
        for (char c : s.toCharArray()) js.append(String.format("\\u%04x", (int) c));
        return Boolean.TRUE.equals(call(f, "executeJavaScript", js.append("')").toString()));
    }

    private static Object browser(Class<?> B, Component c) {
        try {
            Object b = c.getClass().getMethod("getBrowser").invoke(c);
            if (B.isInstance(b)) return b;
        } catch (Exception e) {
        }
        if (c instanceof Container) for (Component x : ((Container) c).getComponents()) {
            Object b = browser(B, x);
            if (b != null) return b;
        }
        return null;
    }

    private static boolean set(Object browser, String name, Handler h) throws Exception {
        ClassLoader cl = PluginInject.class.getClassLoader();
        Class<?> c;
        try {
            c = Class.forName(CB + name, false, cl);
        } catch (ClassNotFoundException e) {
            return false;
        }
        call(browser, "set", c, Proxy.newProxyInstance(cl, new Class<?>[]{c}, (px, m, a) -> {
            if (m.getDeclaringClass() == Object.class)
                return m.getName().equals("equals") ? px == a[0] : m.getName().equals("hashCode") ? System.identityHashCode(px) : "PluginInject." + name;
            if (a != null && a.length == 2) try {
                h.on(a[0], a[1]);
            } catch (Throwable e) {
                e.printStackTrace();
                cancel(a[1]);
            }
            return null;
        }));
        return true;
    }

    private static void save(Component owner, String name, Object tell, Saver s) {
        SwingUtilities.invokeLater(() -> {
            try {
                Window w = SwingUtilities.getWindowAncestor(owner);
                FileDialog d = w instanceof Dialog ? new FileDialog((Dialog) w, "Save", FileDialog.SAVE) : new FileDialog(w instanceof Frame ? (Frame) w : null, "Save", FileDialog.SAVE);
                if (lastDir != null) d.setDirectory(lastDir.getPath());
                d.setFile(name);
                d.setVisible(true);
                if (d.getFile() == null) { cancel(tell); return; }
                lastDir = new File(d.getDirectory());
                s.to(new File(lastDir, d.getFile()).toPath());
            } catch (Throwable e) {
                e.printStackTrace();
                cancel(tell);
            }
        });
    }

    private static void pdf(Object params, Object tell, Path f) throws Exception {
        Object printer = call(call(params, "printers"), "pdfPrinter"), s = call(call(printer, "printJob"), "settings");
        call(s, "pdfFilePath", f);
        for (String o : new String[]{"enablePrintingBackgrounds", "disablePrintingHeaderFooter"}) try {
            call(s, o);
        } catch (NoSuchMethodException e) {
        }
        call(s, "apply");
        call(tell, "proceed", printer);
    }

    private static String pdfName(Object browser) {
        String t = "";
        try {
            t = String.valueOf(call(browser, "title"));
        } catch (Exception e) {
        }
        t = t.replaceFirst("^[•*\\s]+", "").split(" [—|-] ")[0].replaceFirst("\\.\\w{1,5}$", "").replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return (t.isEmpty() ? "page" : t) + ".pdf";
    }

    private static void cancel(Object tell) {
        try {
            call(tell, "cancel");
        } catch (Throwable e) {
            e.printStackTrace();
        }
    }

    private static Object call(Object o, String name, Object... a) throws Exception {
        Method m = null;
        for (Class<?> k = o.getClass(); m == null && k != null; k = k.getSuperclass())
            for (Class<?> i : k.getInterfaces()) if (m == null && Modifier.isPublic(i.getModifiers())) m = find(i.getMethods(), name, a);
        if (m == null && (m = find(o.getClass().getMethods(), name, a)) != null) m.setAccessible(true);
        if (m == null) throw new NoSuchMethodException(o.getClass().getName() + "." + name);
        return m.invoke(o, a);
    }

    private static Method find(Method[] ms, String name, Object[] a) {
        for (Method m : ms) {
            if (!m.getName().equals(name) || m.getParameterCount() != a.length) continue;
            boolean ok = true;
            for (int i = 0; i < a.length; i++) ok &= m.getParameterTypes()[i].isInstance(a[i]);
            if (ok) return m;
        }
        return null;
    }
}
