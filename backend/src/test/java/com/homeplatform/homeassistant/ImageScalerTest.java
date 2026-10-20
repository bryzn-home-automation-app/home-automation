package com.homeplatform.homeassistant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;

import static org.junit.jupiter.api.Assertions.*;

class ImageScalerTest {

    private static byte[] jpeg(int w, int h) throws Exception {
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = img.createGraphics();
        g.setPaint(new GradientPaint(0, 0, Color.DARK_GRAY, w, h, Color.ORANGE));
        g.fillRect(0, 0, w, h);
        for (int x = 0; x < w; x += 7) { g.setColor(new Color(x % 255, 80, 160)); g.drawLine(x, 0, w - x, h); }
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "jpeg", out);
        return out.toByteArray();
    }

    @Test
    @DisplayName("a 3K still is shrunk to 1280 px wide, keeping the aspect ratio")
    void shrinks() throws Exception {
        byte[] big = jpeg(2880, 1616);
        var out = ImageScaler.fit(new HomeAssistantClient.CameraImage(big, "image/jpeg"), ImageScaler.MAX_WIDTH);
        BufferedImage img = ImageIO.read(new ByteArrayInputStream(out.bytes()));
        assertEquals(1280, img.getWidth());
        assertEquals(718, img.getHeight(), 1);
        assertTrue(out.bytes().length < big.length, "smaller file");
        assertEquals("image/jpeg", out.contentType());
    }

    @Test
    @DisplayName("small, non-JPEG or undecodable images pass through untouched")
    void passThrough() throws Exception {
        var small = new HomeAssistantClient.CameraImage(jpeg(640, 360), "image/jpeg");
        assertSame(small, ImageScaler.fit(small, ImageScaler.MAX_WIDTH));
        var png = new HomeAssistantClient.CameraImage(new byte[]{1, 2, 3}, "image/png");
        assertSame(png, ImageScaler.fit(png, ImageScaler.MAX_WIDTH));
        var junk = new HomeAssistantClient.CameraImage(new byte[]{1, 2, 3}, "image/jpeg");
        assertSame(junk, ImageScaler.fit(junk, ImageScaler.MAX_WIDTH));
    }
}
