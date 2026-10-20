package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/**
 * Finds, for every HA camera, the sibling entities on the same HA device — battery
 * level, charging, motion, person — and its go2rtc stream name. The eufy-sdk
 * integration names entities after the device's own properties, so matching is by
 * device class (and the property name where HA has no class for it), never by a
 * hard-coded entity ID.
 *
 * <p>HA's REST API has no device registry, so {@link #TEMPLATE} asks HA to render
 * the mapping as JSON. The stream name is the device serial: eufy-sdk's camera
 * streams from {@code rtsp://<bridge>:8554/<serial>}, and go2rtc names the stream
 * the same way.
 */
public final class CameraLinker {

    /** Renders {@code [{"camera": id, "serial": sn|null, "entities": [ids]}]}. */
    public static final String TEMPLATE = """
            [{%- for s in states.camera -%}
            {%- set d = device_id(s.entity_id) -%}
            {{ {'camera': s.entity_id,
                'serial': (device_attr(d, 'serial_number') if d else none),
                'entities': (device_entities(d) if d else [])} | tojson }}{{ ',' if not loop.last }}
            {%- endfor -%}]""";

    /** go2rtc stream names we'll hand to nginx — alphanumeric serials only. */
    private static final Pattern STREAM_NAME = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");

    public record Link(String cameraEntityId, String streamName, String batteryEntityId,
                       String chargingEntityId, String motionEntityId, String personEntityId) {}

    private CameraLinker() {}

    /**
     * Parse the rendered template. Entities missing from {@code states} are ignored
     * (HA lists disabled entities in the registry but has no state for them).
     *
     * @throws HomeAssistantException.InvalidResponse when the text isn't the expected JSON
     */
    public static List<Link> parse(String rendered, ObjectMapper mapper, Map<String, HaEntityState> states) {
        JsonNode root;
        try {
            root = mapper.readTree(rendered == null ? "" : rendered.trim());
        } catch (Exception e) {
            throw new HomeAssistantException.InvalidResponse("Camera template returned invalid JSON", e);
        }
        if (root == null || !root.isArray()) {
            throw new HomeAssistantException.InvalidResponse("Camera template did not return a JSON array");
        }
        List<Link> out = new ArrayList<>();
        for (JsonNode n : root) {
            String camera = n.path("camera").asText("");
            if (!camera.startsWith("camera.")) continue;
            List<HaEntityState> siblings = new ArrayList<>();
            for (JsonNode e : n.path("entities")) {
                HaEntityState s = e.isTextual() ? states.get(e.asText()) : null;
                if (s != null) siblings.add(s);
            }
            siblings.sort((a, b) -> a.entityId().compareTo(b.entityId()));
            String serial = n.path("serial").isTextual() ? n.path("serial").asText().trim() : null;
            out.add(new Link(
                    camera,
                    serial != null && STREAM_NAME.matcher(serial).matches() ? serial : null,
                    first(siblings, s -> "sensor".equals(s.domain()) && deviceClass(s, "battery")),
                    charging(siblings),
                    first(siblings, s -> "binary_sensor".equals(s.domain()) && deviceClass(s, "motion")),
                    first(siblings, s -> "binary_sensor".equals(s.domain()) && s.entityId().contains("person"))));
        }
        return out;
    }

    /** A battery_charging binary sensor, else an enum sensor named after charging. */
    private static String charging(List<HaEntityState> siblings) {
        String binary = first(siblings, s -> "binary_sensor".equals(s.domain()) && deviceClass(s, "battery_charging"));
        if (binary != null) return binary;
        return first(siblings, s -> "sensor".equals(s.domain()) && !deviceClass(s, "battery")
                && s.entityId().contains("charg"));
    }

    private static boolean deviceClass(HaEntityState s, String cls) {
        JsonNode dc = s.attributes().get("device_class");
        return dc != null && cls.equals(dc.asText());
    }

    private static String first(List<HaEntityState> states, Predicate<HaEntityState> p) {
        Optional<HaEntityState> hit = states.stream().filter(p).findFirst();
        return hit.map(HaEntityState::entityId).orElse(null);
    }

    // ── state interpretation ──

    /** Battery level 0–100 from a sensor state, or null when unknown. */
    public static Double batteryPercent(HaEntityState s) {
        if (s == null || !s.isAvailable()) return null;
        try {
            double v = Double.parseDouble(s.state().trim());
            return Double.isFinite(v) && v >= 0 && v <= 100 ? v : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Charging from either a binary sensor ({@code on}/{@code off}) or an enum label
     * ("Solar charging", "Charging", "Unplugged", "Not charging", "Plugged"…). Null when
     * the state says nothing either way.
     */
    public static Boolean charging(HaEntityState s) {
        if (s == null || !s.isAvailable()) return null;
        String v = s.state().trim().toLowerCase();
        if ("binary_sensor".equals(s.domain())) {
            return "on".equals(v) ? Boolean.TRUE : "off".equals(v) ? Boolean.FALSE : null;
        }
        if (v.contains("discharg") || v.contains("not") || v.contains("unplug")) return false;
        if (v.contains("charg")) return true;
        if (v.contains("full") || v.contains("plugged")) return false;
        return null;
    }

    /** The enum label worth showing (sensors only; a binary sensor's on/off isn't). */
    public static String chargingLabel(HaEntityState s) {
        if (s == null || !s.isAvailable() || !"sensor".equals(s.domain())) return null;
        String v = s.state().trim();
        return v.isEmpty() ? null : v.length() > 60 ? v.substring(0, 60) : v;
    }
}
