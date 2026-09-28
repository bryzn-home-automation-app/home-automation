package com.homeplatform.dto;

/**
 * One maintenance counter for the Roomba tab, derived from {@code roomba_parts}
 * (see {@code RoombaService#toPartResponse}).
 *
 * <ul>
 *   <li>{@code label} / {@code hint} — friendly name + one-line care note (catalogued per
 *       part id, with a fallback by {@code countType}).</li>
 *   <li>{@code action} — {@code replace} (replacement part) or {@code clean} (maintenance
 *       task), or null.</li>
 *   <li>{@code unit} — how {@code countRemaining}/{@code countUsed} should be read:
 *       {@code hours} (values are minutes), {@code missions}, {@code empties} (dock
 *       evacuations), {@code washes} or {@code count}.</li>
 *   <li>{@code pctRemaining} — remaining / (remaining + used), 0–100, or null.</li>
 *   <li>{@code status} — {@code ok} | {@code due_soon} | {@code overdue} | {@code unknown}.</li>
 * </ul>
 */
public record RoombaPartResponse(
        String partId,
        String label,
        String hint,
        String countType,
        String counterCategory,
        String action,
        String resetBy,
        String unit,
        Integer countRemaining,
        Integer countUsed,
        Integer minutesRemaining,
        Integer pctRemaining,
        String status,
        String lastUpdatedAt,
        String updatedAt
) {}
