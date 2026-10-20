package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.time.format.DateTimeParseException;

/**
 * One HA entity state, as returned by {@code GET /api/states} or carried in a
 * {@code state_changed} event's {@code new_state}. {@code raw} is the original JSON.
 */
public record HaEntityState(
        String entityId,
        String state,
        JsonNode attributes,
        Instant lastChanged,
        Instant lastUpdated,
        JsonNode raw
) {

    /** "unavailable"/"unknown" are HA's markers for an entity it can't currently read. */
    public boolean isAvailable() {
        return state != null && !"unavailable".equals(state) && !"unknown".equals(state);
    }

    public String domain() {
        int dot = entityId.indexOf('.');
        return dot < 0 ? "" : entityId.substring(0, dot);
    }

    /** Friendly name from attributes, falling back to the entity ID. */
    public String friendlyName() {
        JsonNode n = attributes.get("friendly_name");
        return n != null && n.isTextual() && !n.asText().isBlank() ? n.asText() : entityId;
    }

    /**
     * Parse an HA state object. Throws {@link HomeAssistantException.InvalidResponse}
     * when {@code entity_id} is missing — everything else is tolerated (null/absent).
     */
    public static HaEntityState fromJson(JsonNode node) {
        if (node == null || !node.isObject()) {
            throw new HomeAssistantException.InvalidResponse("HA state is not a JSON object");
        }
        JsonNode id = node.get("entity_id");
        if (id == null || !id.isTextual() || id.asText().isBlank()) {
            throw new HomeAssistantException.InvalidResponse("HA state has no entity_id");
        }
        JsonNode state = node.get("state");
        JsonNode attrs = node.get("attributes");
        ObjectNode safeAttrs = attrs != null && attrs.isObject()
                ? (ObjectNode) attrs
                : JsonNodeFactory.instance.objectNode();
        return new HaEntityState(
                id.asText(),
                state == null || state.isNull() ? null : state.asText(),
                safeAttrs,
                parseInstant(node.get("last_changed")),
                parseInstant(node.get("last_updated")),
                node);
    }

    static Instant parseInstant(JsonNode n) {
        if (n == null || !n.isTextual()) return null;
        try {
            // HA emits ISO-8601 with an offset, e.g. 2026-10-19T21:04:05.123456+00:00
            return java.time.OffsetDateTime.parse(n.asText()).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
