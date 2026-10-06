import java.io.File;
import java.lang.reflect.InvocationTargetException;
import java.nio.file.Files;

// usage: java -Djava.awt.headless=true -cp <tbtools_jar> Verify.java <name>.plugin
public class Verify {
    public static void main(String[] a) throws Exception {
        File d = Files.createTempDirectory("plg").toFile();
        biocjava.bioDoer.FileUtils.ZipTools2.unzipFile(new File(a[0]).getAbsolutePath(), d.getAbsolutePath());
        File[] dirs = d.listFiles(File::isDirectory);
        if (dirs == null || dirs.length != 1) throw new IllegalStateException("zip must contain exactly one top-level folder");
        try {
            Object[] r = Plugin.PluginUtils.readPluginDirJAR(dirs[0]);
            if (r == null) throw new IllegalStateException("TBtools rejected the plugin (see stderr)");
            System.out.println("OK: loaded [" + r[0] + "]");
        } catch (InvocationTargetException e) {
            Throwable c = e.getCause();
            if (!(c instanceof NoClassDefFoundError && String.valueOf(c.getMessage()).startsWith("com/teamdev/jxbrowser"))) throw e;
            System.out.println("OK: reached WebGuiJPanel, stopped at missing JxBrowser (" + c.getMessage() + ")");
        }
    }
}
