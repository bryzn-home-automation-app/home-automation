package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Converts HA {@code climate.*} states into {@link ThermostatSnapshot}. This is the only
 * place that knows HA's climate attribute names, so the rest of the app never does.
 *
 * <p>HA climate semantics: the entity <em>state</em> is the HVAC mode; {@code temperature}
 * is the single target in heat/cool mode, and {@code target_temp_low/high} are the range
 * in heat_cool (auto) mode.
 */
public final class EntityMapper {

    public static final String DEFAULT_UNIT = "°F";

    /** Plausible indoor-thermostat temperature range in either unit; outside → treated as bad data. */
    private static final double MIN_PLAUSIBLE_TEMP = -50;
    private static final double MAX_PLAUSIBLE_TEMP = 150;

    static final Set<String> KNOWN_HVAC_MODES = Set.of("off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only");

    private EntityMapper() {}

    public static ThermostatSnapshot toThermostat(HaEntityState s, String temperatureUnit) {
        JsonNode a = s.attributes();
        boolean available = s.isAvailable();
        String unit = temperatureUnit == null || temperatureUnit.isBlank() ? DEFAULT_UNIT : temperatureUnit;
        Instant recordedAt = s.lastUpdated() != null ? s.lastUpdated()
                : s.lastChanged() != null ? s.lastChanged() : Instant.now();

        if (!available) {
            // Keep capabilities if HA still reports them, but no live readings.
            return new ThermostatSnapshot(false, null, null, null, null, null, null, null, null, unit,
                    temperature(a, "min_temp"), temperature(a, "max_temp"),
                    stringList(a, "hvac_modes"), stringList(a, "preset_modes"), recordedAt);
        }

        String mode = KNOWN_HVAC_MODES.contains(s.state()) ? s.state() : null;
        Double target = temperature(a, "temperature");
        Double low = temperature(a, "target_temp_low");
        Double high = temperature(a, "target_temp_high");

        Double heat = null;
        Double cool = null;
        if ("heat".equals(mode)) {
            heat = target;
        } else if ("cool".equals(mode)) {
            cool = target;
        } else if ("heat_cool".equals(mode) || "auto".equals(mode)) {
            heat = low;
            cool = high;
        }

        return new ThermostatSnapshot(
                true,
                temperature(a, "current_temperature"),
                percent(a, "current_humidity"),
                target,
                heat,
                cool,
                mode,
                text(a, "hvac_action"),
                text(a, "preset_mode"),
                unit,
                temperature(a, "min_temp"),
                temperature(a, "max_temp"),
                stringList(a, "hvac_modes"),
                stringList(a, "preset_modes"),
                recordedAt);
    }

    // ── value helpers (all null-safe, reject non-numeric / non-finite / implausible) ──

    static Double number(JsonNode a, String key) {
        JsonNode n = a == null ? null : a.get(key);
        if (n == null || n.isNull()) return null;
        double v;
        if (n.isNumber()) {
            v = n.asDouble();
        } else if (n.isTextual()) {
            try {
                v = Double.parseDouble(n.asText().trim());
            } catch (NumberFormatException e) {
                return null;
            }
        } else {
            return null;
        }
        return Double.isFinite(v) ? v : null;
    }

    static Double temperature(JsonNode a, String key) {
        Double v = number(a, key);
        return v == null || v < MIN_PLAUSIBLE_TEMP || v > MAX_PLAUSIBLE_TEMP ? null : v;
    }

    static Double percent(JsonNode a, String key) {
        Double v = number(a, key);
        return v == null || v < 0 || v > 100 ? null : v;
    }

    static String text(JsonNode a, String key) {
        JsonNode n = a == null ? null : a.get(key);
        if (n == null || !n.isTextual()) return null;
        String t = n.asText().trim();
        return t.isEmpty() || "unknown".equals(t) || "unavailable".equals(t) ? null : t;
    }

    static List<String> stringList(JsonNode a, String key) {
        JsonNode n = a == null ? null : a.get(key);
        if (n == null || !n.isArray()) return List.of();
        List<String> out = new ArrayList<>();
        for (JsonNode e : n) {
            if (e.isTextual() && !e.asText().isBlank()) out.add(e.asText());
        }
        return List.copyOf(out);
    }
}
