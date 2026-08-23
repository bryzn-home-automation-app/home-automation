package com.homeplatform.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One line item in a release's notes. Stored inside {@link AppRelease#getChanges()}
 * as a JSONB array element.
 *
 * <p>{@code type} is one of {@code "new"} (a feature that didn't exist before),
 * {@code "improved"} (something existing got better), or {@code "fixed"} (a bug
 * squashed). {@code text} is the plain-language, non-technical description shown
 * to household members.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ReleaseChange {
    private String type;
    private String text;
}
