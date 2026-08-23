package com.homeplatform.dto;

import com.homeplatform.model.ReleaseChange;

import java.util.List;

/**
 * One release entry for the "What's New" tab. {@code releasedAt} is an ISO
 * {@code yyyy-MM-dd} date string; {@code changes} are the plain-language line
 * items ({@code type} = new|improved|fixed).
 */
public record ReleaseResponse(
        String version,
        String stage,
        String releasedAt,
        String title,
        String summary,
        List<ReleaseChange> changes
) {}
