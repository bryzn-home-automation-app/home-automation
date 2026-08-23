package com.homeplatform.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Live cleaning-coverage payload. {@code coverage} is the robot's coverage.geojson
 * FeatureCollection passed through unchanged as parsed JSON (features carry an
 * {@code operatingModes} property distinguishing vacuumed vs traveled area).
 */
public record RoombaCoverageResponse(
        String robotId,
        String missionId,
        JsonNode coverage,
        String updatedAt
) {}
