package Plugin;

import biocjava.GUIexcutors.WebGuiApp.WebGuiJPanel;
import java.awt.Dimension;
import java.io.File;
import javax.swing.JPanel;

public class PluginInject {

    private final File dir;

    public PluginInject() throws Exception {
        dir = new File(PluginInject.class.getProtectionDomain().getCodeSource().getLocation().toURI()).getParentFile();
    }

    public JPanel generatePanel() {
        JPanel p = new WebGuiJPanel(new File(dir, "index.html").toPath().toUri().toString(), false);
        p.setPreferredSize(new Dimension(1280, 800));
        return p;
    }

    public String getPluginName() {
        return dir.getName();
    }
}
