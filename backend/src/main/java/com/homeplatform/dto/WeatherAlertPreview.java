package com.homeplatform.dto;

/**
 * What a weather alert would say from the forecast right now. {@code when} is the next check
 * ("Tonight at 8 PM"), {@code hours} the hours it covers ("8 PM – 8 AM", null for warnings).
 * {@code title}/{@code message}/{@code severity} are set when it would alert; {@code summary}
 * always says what was found.
 */
public record WeatherAlertPreview(
        String when,
        String hours,
        String severity,
        String title,
        String message,
        String summary
) {}
