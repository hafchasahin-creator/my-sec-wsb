import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.util.*;

/**
 * Guards against the one real hazard of building without Google's SDK.
 *
 * The app compiles against a full AOSP framework jar, which also contains
 * methods hidden from the public SDK - those would compile here and then throw
 * NoSuchMethodError on a real device. This resolves every framework member the
 * compiled app actually references against a genuine public android.jar and
 * reports anything missing, so each one can be confirmed as a documented API
 * added after that jar's level.
 *
 *   java ApiCheck <public-android.jar> <app-classes-dir> <aosp.jar> <refs-file>
 *
 * Refs are "Q|owner|member|desc" for a direct reference, or
 * "U|enclosingClass|member|desc" for an unqualified one, which is only checked
 * once the class that really declares it turns out to be part of the framework.
 */
public class ApiCheck {

    public static void main(String[] args) throws Exception {
        File publicJar = new File(args[0]);
        URLClassLoader publicApi = new URLClassLoader(new URL[]{publicJar.toURI().toURL()}, null);
        URLClassLoader appApi = new URLClassLoader(new URL[]{
                new File(args[1]).toURI().toURL(), new File(args[2]).toURI().toURL()}, null);

        Set<String> unresolved = new TreeSet<String>();
        Set<String> unknownClass = new TreeSet<String>();
        int checked = 0, ok = 0, skippedOwn = 0;

        BufferedReader r = new BufferedReader(new FileReader(args[3]));
        String line;
        while ((line = r.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty()) continue;
            String[] p = line.split("\\|", 4);
            if (p.length < 4) continue;
            String owner = p[1].replace('/', '.');
            String member = p[2];
            String desc = p[3];

            if ("U".equals(p[0])) {
                // Find where this member is really declared, walking up from the
                // app class that called it. Only framework declarations matter.
                String declaring = declaringClass(appApi, owner, member, desc);
                if (declaring == null || !isFramework(declaring)) { skippedOwn++; continue; }
                owner = declaring;
            }
            if (!isFramework(owner)) { skippedOwn++; continue; }

            checked++;
            Class<?> c;
            try {
                c = Class.forName(owner, false, publicApi);
            } catch (Throwable e) {
                unknownClass.add(owner);
                continue;
            }
            if (resolves(c, member, desc)) ok++;
            else unresolved.add(owner + "." + member + "  " + desc);
        }
        r.close();

        System.out.println("framework references checked : " + checked);
        System.out.println("resolved on " + publicJar.getName() + "   : " + ok);
        System.out.println("app's own members skipped    : " + skippedOwn);
        System.out.println();
        if (unknownClass.isEmpty() && unresolved.isEmpty()) {
            System.out.println("Nothing outside the public API.");
            return;
        }
        if (!unknownClass.isEmpty()) {
            System.out.println("CLASSES newer than this API level (" + unknownClass.size() + "):");
            for (String s : unknownClass) System.out.println("   " + s);
            System.out.println();
        }
        if (!unresolved.isEmpty()) {
            System.out.println("MEMBERS newer than this API level (" + unresolved.size() + "):");
            for (String s : unresolved) System.out.println("   " + s);
        }
    }

    private static boolean isFramework(String cls) {
        return cls.startsWith("android.") || cls.startsWith("com.android.")
                || cls.startsWith("dalvik.");
    }

    /** Name of the class that declares a member, searching from {@code from} upwards. */
    private static String declaringClass(ClassLoader cl, String from, String member, String desc) {
        try {
            Class<?> c = Class.forName(from, false, cl);
            for (Class<?> k = c; k != null; k = k.getSuperclass()) {
                if (hasMember(k, member, desc)) return k.getName();
            }
        } catch (Throwable ignored) {
            // A class we cannot load tells us nothing; treat it as not framework.
        }
        return null;
    }

    private static boolean resolves(Class<?> c, String member, String desc) {
        if ("<init>".equals(member)) {
            for (Constructor<?> k : c.getDeclaredConstructors()) {
                if (descriptorOf(k.getParameterTypes(), void.class).equals(desc)) return true;
            }
            return false;
        }
        for (Class<?> k = c; k != null; k = k.getSuperclass()) {
            if (hasMember(k, member, desc)) return true;
            for (Class<?> i : k.getInterfaces()) {
                if (resolves(i, member, desc)) return true;
            }
        }
        return false;
    }

    private static boolean hasMember(Class<?> c, String member, String desc) {
        if ("<init>".equals(member)) {
            for (Constructor<?> k : c.getDeclaredConstructors()) {
                if (descriptorOf(k.getParameterTypes(), void.class).equals(desc)) return true;
            }
            return false;
        }
        if (desc.startsWith("(")) {
            for (Method m : c.getDeclaredMethods()) {
                if (!m.getName().equals(member)) continue;
                if (descriptorOf(m.getParameterTypes(), m.getReturnType()).equals(desc)) return true;
            }
        } else {
            for (Field f : c.getDeclaredFields()) {
                if (f.getName().equals(member) && sig(f.getType()).equals(desc)) return true;
            }
        }
        return false;
    }

    private static String descriptorOf(Class<?>[] params, Class<?> ret) {
        StringBuilder sb = new StringBuilder("(");
        for (Class<?> p : params) sb.append(sig(p));
        sb.append(')').append(sig(ret));
        return sb.toString();
    }

    private static String sig(Class<?> c) {
        if (c == void.class) return "V";
        if (c == int.class) return "I";
        if (c == long.class) return "J";
        if (c == float.class) return "F";
        if (c == double.class) return "D";
        if (c == boolean.class) return "Z";
        if (c == byte.class) return "B";
        if (c == char.class) return "C";
        if (c == short.class) return "S";
        if (c.isArray()) return "[" + sig(c.getComponentType());
        return "L" + c.getName().replace('.', '/') + ";";
    }
}
