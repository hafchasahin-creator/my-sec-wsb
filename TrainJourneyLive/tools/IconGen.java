import java.awt.*;
import java.awt.geom.*;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/**
 * Generates the legacy (pre-API-26) launcher PNGs so the project has no binary
 * assets checked in that cannot be regenerated from source.
 * Usage: java IconGen.java <res-dir>
 */
public class IconGen {
    public static void main(String[] args) throws Exception {
        String res = args.length > 0 ? args[0] : "app/src/main/res";
        int[] sizes = {48, 72, 96, 144, 192};
        String[] dirs = {"mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"};
        for (int i = 0; i < sizes.length; i++) {
            File d = new File(res, "mipmap-" + dirs[i]);
            if (!d.exists() && !d.mkdirs()) throw new IllegalStateException("mkdir " + d);
            ImageIO.write(render(sizes[i], false), "png", new File(d, "ic_launcher.png"));
            ImageIO.write(render(sizes[i], true), "png", new File(d, "ic_launcher_round.png"));
        }
        System.out.println("icons written under " + res);
    }

    private static BufferedImage render(int px, boolean round) {
        BufferedImage img = new BufferedImage(px, px, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
        double s = px / 108.0;
        g.scale(s, s);

        Shape clip = round ? new Ellipse2D.Double(0, 0, 108, 108)
                           : new RoundRectangle2D.Double(4, 4, 100, 100, 24, 24);
        g.setClip(clip);
        g.setColor(new Color(0x0E2A52));
        g.fill(clip);
        g.setColor(new Color(0x16386B));
        g.fill(new Rectangle2D.Double(30, 0, 48, 108));
        g.setColor(new Color(0x1E4A87));
        g.fill(new Rectangle2D.Double(35, 0, 3, 108));
        g.fill(new Rectangle2D.Double(70, 0, 3, 108));
        for (int y = 10; y < 108; y += 18) g.fill(new Rectangle2D.Double(32, y, 44, 3));

        g.setColor(Color.WHITE);
        g.fill(body());
        g.setColor(new Color(0x1E6FE8));
        g.fill(windscreen());
        g.setColor(new Color(0x0E2A52));
        g.fill(new Rectangle2D.Double(46, 53, 6.2, 11));
        g.fill(new Rectangle2D.Double(55.8, 53, 6.2, 11));
        g.fill(new Rectangle2D.Double(46, 69, 16, 6));
        g.setColor(new Color(0xFFC53D));
        g.fill(new Ellipse2D.Double(46.3, 27.3, 4.4, 4.4));
        g.fill(new Ellipse2D.Double(57.3, 27.3, 4.4, 4.4));
        g.dispose();
        return img;
    }

    private static Shape body() {
        Path2D.Double p = new Path2D.Double();
        p.moveTo(54, 26);
        p.curveTo(60, 26, 67, 33, 67, 42);
        p.lineTo(67, 76);
        p.curveTo(67, 80.4, 63.4, 84, 59, 84);
        p.lineTo(49, 84);
        p.curveTo(44.6, 84, 41, 80.4, 41, 76);
        p.lineTo(41, 42);
        p.curveTo(41, 33, 48, 26, 54, 26);
        p.closePath();
        return p;
    }

    private static Shape windscreen() {
        Path2D.Double p = new Path2D.Double();
        p.moveTo(54, 31);
        p.curveTo(58, 31, 63, 36.5, 63, 42.5);
        p.lineTo(63, 47);
        p.lineTo(45, 47);
        p.lineTo(45, 42.5);
        p.curveTo(45, 36.5, 50, 31, 54, 31);
        p.closePath();
        return p;
    }
}
