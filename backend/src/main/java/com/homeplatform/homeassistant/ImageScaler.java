package com.homeplatform.homeassistant;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageOutputStream;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

/**
 * Shrinks camera stills for the tiles. The S340 sends 2880×1616 JPEGs (~650 KB) for a
 * tile that's at most ~1,100 device pixels wide on a phone — over LTE that was most of
 * the Cameras tab's load time. Best-effort: anything it can't decode is returned as is.
 */
final class ImageScaler {

    static final int MAX_WIDTH = 1280;
    private static final float QUALITY = 0.82f;

    private ImageScaler() {}

    static HomeAssistantClient.CameraImage fit(HomeAssistantClient.CameraImage img, int maxWidth) {
        if (img == null || img.bytes() == null || !String.valueOf(img.contentType()).contains("jpeg")) return img;
        try {
            BufferedImage src = ImageIO.read(new ByteArrayInputStream(img.bytes()));
            if (src == null || src.getWidth() <= maxWidth) return img;
            BufferedImage scaled = downscale(src, maxWidth);
            byte[] out = jpeg(scaled);
            return out.length < img.bytes().length ? new HomeAssistantClient.CameraImage(out, "image/jpeg") : img;
        } catch (Exception | LinkageError e) {
            return img;
        }
    }

    /** Halve until within 2× of the target, then one bilinear step — avoids the aliasing of a single big jump. */
    private static BufferedImage downscale(BufferedImage src, int maxWidth) {
        BufferedImage cur = src;
        while (cur.getWidth() / 2 >= maxWidth) {
            cur = resize(cur, cur.getWidth() / 2, cur.getHeight() / 2);
        }
        int h = Math.max(1, Math.round(cur.getHeight() * (maxWidth / (float) cur.getWidth())));
        return resize(cur, maxWidth, h);
    }

    private static BufferedImage resize(BufferedImage src, int w, int h) {
        BufferedImage dst = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = dst.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.drawImage(src, 0, 0, w, h, null);
        } finally {
            g.dispose();
        }
        return dst;
    }

    private static byte[] jpeg(BufferedImage img) throws Exception {
        ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ImageOutputStream ios = ImageIO.createImageOutputStream(out)) {
            writer.setOutput(ios);
            ImageWriteParam p = writer.getDefaultWriteParam();
            p.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            p.setCompressionQuality(QUALITY);
            writer.write(null, new IIOImage(img, null, null), p);
        } finally {
            writer.dispose();
        }
        return out.toByteArray();
    }
}
