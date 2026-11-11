package com.homeplatform.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Live cleaning-coverage payload. {@code coverage} is the robot's coverage.geojson
 * FeatureCollection passed through unchanged as parsed JSON (features carry an
 * {@code operatingModes} property distinguishing vacuumed vs traveled area).
 * {@code passes} is the area cleaned twice or more this mission,
 * {@code {"v":1,"cell":0.05,"rects":[[ix,iy,w,h],...]}} in grid cells (metres =
 * value * cell), or null when there is none for this mission yet.
 */
public record RoombaCoverageResponse(
        String robotId,
        String missionId,
        JsonNode coverage,
        String updatedAt,
        JsonNode passes
) {}
