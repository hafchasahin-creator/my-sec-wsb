package com.trainjourney.live.map;

/**
 * Where map imagery comes from.
 *
 * All of these are open raster tile services built on OpenStreetMap data, used
 * under their public terms with a real User-Agent and light, cached traffic.
 * Attribution is drawn on the map itself, as those terms require.
 */
public final class TileSource {

    public static final TileSource STANDARD = new TileSource(
            "standard", "Street",
            new String[]{"https://tile.openstreetmap.org/%d/%d/%d.png"},
            0, 19, false, "© OpenStreetMap contributors");

    public static final TileSource TERRAIN = new TileSource(
            "topo", "Terrain",
            new String[]{"https://a.tile.opentopomap.org/%d/%d/%d.png",
                         "https://b.tile.opentopomap.org/%d/%d/%d.png",
                         "https://c.tile.opentopomap.org/%d/%d/%d.png"},
            0, 17, false, "© OpenStreetMap, SRTM | OpenTopoMap (CC-BY-SA)");

    /** Transparent overlay drawing signals, gauges and railway detail. */
    public static final TileSource RAILWAY_OVERLAY = new TileSource(
            "railway", "Railway detail",
            new String[]{"https://a.tiles.openrailwaymap.org/standard/%d/%d/%d.png",
                         "https://b.tiles.openrailwaymap.org/standard/%d/%d/%d.png",
                         "https://c.tiles.openrailwaymap.org/standard/%d/%d/%d.png"},
            2, 19, true, "OpenRailwayMap");

    /** Selectable base layers, in the order the layer button cycles them. */
    public static final TileSource[] BASE_LAYERS = {STANDARD, TERRAIN};

    /** Stable id, used as the cache directory name. */
    public final String id;
    /** Shown in the layer switcher. */
    public final String label;
    public final int minZoom;
    public final int maxZoom;
    /** True for a transparent overlay drawn on top of a base layer. */
    public final boolean overlay;
    public final String attribution;

    private final String[] templates;

    private TileSource(String id, String label, String[] templates,
                       int minZoom, int maxZoom, boolean overlay, String attribution) {
        this.id = id;
        this.label = label;
        this.templates = templates;
        this.minZoom = minZoom;
        this.maxZoom = maxZoom;
        this.overlay = overlay;
        this.attribution = attribution;
    }

    /** Spreads requests over the available hosts, as those services ask. */
    public String url(int z, int x, int y) {
        String t = templates[Math.abs(x + y) % templates.length];
        return String.format(java.util.Locale.US, t, Integer.valueOf(z),
                Integer.valueOf(x), Integer.valueOf(y));
    }

    public static TileSource byId(String id) {
        if (TERRAIN.id.equals(id)) return TERRAIN;
        if (RAILWAY_OVERLAY.id.equals(id)) return RAILWAY_OVERLAY;
        return STANDARD;
    }
}
